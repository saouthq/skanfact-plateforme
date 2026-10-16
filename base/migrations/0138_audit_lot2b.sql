-- 0138 : l'audit de la console 1.42.0, lot 2b (1.46.0 ; docs/console.md C62) : deux constats.
--   - A04 : une contestation se clôturait « par un avoir » ou « remboursée » sur une référence libre (« remboursement à
--     faire » passait), et la sortie d'un client aussi. Désormais :
--       · un AVOIR est celui qu'on nomme par son numéro : émis dans SkanFact, et qui corrige CETTE facture ; un avoir ne
--         régularise qu'une contestation ; son montant est le sien, la régularisation dit s'il couvre toute la facture ;
--       · un REMBOURSEMENT se déclare avec son montant (jamais plus que la facture), son jour (aujourd'hui ou avant) et sa
--         référence ; il reste « déclaré » tant que SkanFact n'a pas noté sur la facture un règlement négatif qui le
--         couvre, puis il est « rapproché » — lu à chaque fois, jamais coché à la main ;
--       · la sortie d'un client : « rendu » se déclare de même (montant, jour, référence), rapproché par les règlements
--         négatifs notés sur ses factures d'abonnement depuis l'ouverture de la sortie, ou par un avoir émis sur l'une
--         d'elles dont la référence est le numéro.
--   - A08 : l'e-mail d'une invitation se notait seulement après l'envoi ; un arrêt du serveur entre l'invitation et
--     l'envoi ne laissait aucune trace. L'état « à envoyer » s'écrit maintenant DANS la transaction de l'invitation ; la
--     lecture dit « sans réponse » d'un e-mail resté à envoyer ou en attente du relais au-delà de dix minutes, et l'écran
--     propose d'en refaire le lien. Le lien n'est jamais gardé (la base n'a que son empreinte) : il ne se renvoie pas
--     tout seul, il se refait.

-- ── A04 : la contestation régularisée par un vrai avoir, ou un remboursement déclaré puis rapproché ─────────────────
alter table plateforme.contestation
  add column avoir uuid references ventes.piece(id),
  -- Le remboursement déclaré : son montant (en millimes, dans la devise de la facture) et son jour ; l'avoir : son montant.
  add column montant bigint check (montant is null or montant > 0),
  add column rembourse_le date,
  -- Une régularisation d'avant la 1.46.0 n'a ni avoir ni montant : la fonction exige les deux depuis.
  add check (rembourse_le is null or issue = 'remboursement');
-- Un avoir ne régularise qu'une contestation.
create unique index contestation_avoir on plateforme.contestation (avoir) where avoir is not null;

drop function plateforme.console_regulariser(uuid, text, text, text, timestamptz);
create function plateforme.console_regulariser(p_contestation uuid, p_issue text, p_reference text, p_montant bigint, p_le date,
  p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  c plateforme.contestation; p ventes.piece; a ventes.piece; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_montant bigint; v_le date;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_issue is null or p_issue not in ('avoir', 'remboursement', 'maintenue', 'retiree') then
    perform socle.refus('une contestation se clôt par un avoir, un remboursement, la facture maintenue, ou retirée');
  end if;
  -- L'argent est à la direction : le support ne note que la contestation retirée.
  if v_role <> 'direction' and p_issue <> 'retiree' then
    perform socle.refus('la direction seule régularise une contestation par un avoir, un remboursement ou en maintenant la facture');
  end if;
  if p_issue in ('avoir', 'remboursement') and v_ref is null then
    perform socle.refus('un avoir ou un remboursement se retrouve par sa référence : le numéro de l''avoir, la référence du virement');
  end if;
  if v_ref is not null and length(v_ref) > 60 then perform socle.refus('une référence : soixante caractères au plus'); end if;
  select * into c from plateforme.contestation where id = p_contestation for update;
  if not found then perform socle.refus('cette contestation n''existe pas'); end if;
  if c.close_le is not null then perform socle.refus('cette contestation est déjà régularisée'); end if;
  select x.* into p from plateforme.facture_abonnement f
    join ventes.piece x on x.entreprise = f.editeur and x.ref_v10 = f.piece_v10 and x.type = 'facture' and x.statut = 'emise'
   where f.id = c.facture;
  if p_issue = 'avoir' then
    -- L'avoir nommé : émis, et il corrige cette facture.
    select x.* into a from ventes.piece x
     where p.id is not null and x.entreprise = p.entreprise and x.type = 'avoir' and x.statut = 'emise' and x.corrige = p.id
       and upper(x.numero_texte) = upper(v_ref);
    if a.id is null then
      perform socle.refus('cet avoir n''est pas émis sur cette facture : donne le numéro d''un avoir émis dans SkanFact qui la corrige');
    end if;
    if exists (select 1 from plateforme.contestation x where x.avoir = a.id) then
      perform socle.refus('cet avoir régularise déjà une autre contestation');
    end if;
    v_montant := a.net_a_payer; v_ref := a.numero_texte;
  elsif p_issue = 'remboursement' then
    if p_montant is null or p_montant <= 0 then perform socle.refus('le montant remboursé : plus que zéro'); end if;
    if p.id is not null and p_montant > p.net_a_payer then perform socle.refus('un remboursement ne dépasse pas la facture'); end if;
    if p_le is null or p_le > (p_maintenant at time zone 'Africa/Tunis')::date then
      perform socle.refus('le jour du remboursement : aujourd''hui ou avant');
    end if;
    v_montant := p_montant; v_le := p_le;
  end if;
  update plateforme.contestation
     set close_le = p_maintenant, close_par = socle.moi(), issue = p_issue,
         reference = case when p_issue in ('avoir', 'remboursement') then v_ref end, close_motif = btrim(p_motif),
         avoir = case when p_issue = 'avoir' then a.id end, montant = v_montant, rembourse_le = v_le
   where id = c.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'paiements.regulariser', c.entreprise, btrim(p_motif), jsonb_build_object('facture', p.numero_texte),
            jsonb_build_object('facture', p.numero_texte, 'issue', p_issue, 'reference', case when p_issue in ('avoir', 'remboursement') then v_ref end,
                               'montant', v_montant::text, 'le', v_le));
end $$;
revoke execute on function plateforme.console_regulariser(uuid, text, text, bigint, date, text, timestamptz) from public;
grant execute on function plateforme.console_regulariser(uuid, text, text, bigint, date, text, timestamptz) to skanfact_app;

-- Ce que les remboursements notés dans SkanFact couvrent d'une facture : la somme des règlements négatifs (0012).
create function plateforme.rembourse_sur(p_piece uuid, p_depuis date default null) returns bigint
language sql stable security definer set search_path = pg_catalog, ventes as $$
  select coalesce(-sum(r.montant), 0)::bigint from ventes.reglement r
   where r.piece = p_piece and r.montant < 0 and (p_depuis is null or r.date_reglement >= p_depuis)
$$;
revoke execute on function plateforme.rembourse_sur(uuid, date) from public;

-- La liste des contestations (0129), avec ce qui rapproche chaque régularisation : le montant de la facture, celui de
-- l'avoir ou du remboursement, et, pour un remboursement, s'il est couvert par ce que SkanFact a noté sur la facture.
create or replace function plateforme.console_contestations(p_maintenant timestamptz, p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'facture', f.id, 'piece', f.piece_v10, 'numero', p.numero_texte, 'net', p.net_a_payer::text, 'timbre', p.timbre::text,
      'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
      'canal', c.canal, 'dit', c.dit, 'ouverteLe', c.ouverte_le, 'ouvertePar', (select u.nom from socle.utilisateur u where u.id = c.ouverte_par),
      'close', case when c.close_le is null then null else jsonb_build_object('le', c.close_le, 'issue', c.issue, 'reference', c.reference,
                 'motif', c.close_motif, 'par', (select u.nom from socle.utilisateur u where u.id = c.close_par),
                 'montant', c.montant::text, 'rembourseLe', c.rembourse_le,
                 'rembourseNote', case when c.issue = 'remboursement' and p.id is not null then plateforme.rembourse_sur(p.id)::text end) end)
      order by (c.close_le is null) desc, coalesce(c.close_le, c.ouverte_le) desc), '[]'::jsonb)
    from plateforme.contestation c
    join plateforme.facture_abonnement f on f.id = c.facture
    join socle.entreprise e on e.id = c.entreprise
    left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
   where case when p_entreprise is null then c.close_le is null or c.close_le >= p_maintenant - interval '90 days'
              else c.entreprise = p_entreprise end);
end $$;

-- ── A04 : la sortie d'un client, son remboursement déclaré puis rapproché ──────────────────────────────────────────
alter table plateforme.sortie
  add column remboursement_montant bigint check (remboursement_montant is null or remboursement_montant > 0),
  add column remboursement_rendu_le date,
  add check (remboursement = 'fait' or (remboursement_montant is null and remboursement_rendu_le is null));

drop function plateforme.console_sortie_remboursement(uuid, text, text, text, timestamptz);
create function plateforme.console_sortie_remboursement(p_sortie uuid, p_remboursement text, p_reference text, p_montant bigint, p_le date,
  p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  s plateforme.sortie; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_remboursement is null or p_remboursement not in ('aucun', 'fait') then
    perform socle.refus('le remboursement d''une sortie : rien à rendre, ou rendu');
  end if;
  if p_remboursement = 'fait' and v_ref is null then
    perform socle.refus('un remboursement se retrouve par sa référence : le numéro de l''avoir, la référence du virement');
  end if;
  if v_ref is not null and length(v_ref) > 60 then perform socle.refus('la référence d''un remboursement : soixante caractères au plus'); end if;
  if p_remboursement = 'fait' then
    if p_montant is null or p_montant <= 0 then perform socle.refus('le montant remboursé : plus que zéro'); end if;
    if p_le is null or p_le > (p_maintenant at time zone 'Africa/Tunis')::date then
      perform socle.refus('le jour du remboursement : aujourd''hui ou avant');
    end if;
  end if;
  select * into s from plateforme.sortie where id = p_sortie for update;
  if not found then perform socle.refus('cette sortie n''existe pas'); end if;
  if s.close_le is not null then perform socle.refus('cette sortie est close'); end if;
  update plateforme.sortie
     set remboursement = p_remboursement, remboursement_reference = case when p_remboursement = 'fait' then v_ref end,
         remboursement_montant = case when p_remboursement = 'fait' then p_montant end,
         remboursement_rendu_le = case when p_remboursement = 'fait' then p_le end,
         remboursement_le = p_maintenant, remboursement_par = socle.moi()
   where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.sortie_remboursement', s.entreprise, btrim(p_motif),
            case when s.remboursement is null then null else jsonb_build_object('remboursement', s.remboursement, 'reference', s.remboursement_reference,
              'montant', s.remboursement_montant::text, 'le', s.remboursement_rendu_le) end,
            jsonb_build_object('remboursement', p_remboursement, 'reference', case when p_remboursement = 'fait' then v_ref end,
              'montant', case when p_remboursement = 'fait' then p_montant::text end, 'le', case when p_remboursement = 'fait' then p_le end));
end $$;
revoke execute on function plateforme.console_sortie_remboursement(uuid, text, text, bigint, date, text, timestamptz) from public;
grant execute on function plateforme.console_sortie_remboursement(uuid, text, text, bigint, date, text, timestamptz) to skanfact_app;

-- Ce qui rapproche le remboursement d'une sortie : les règlements négatifs notés sur ses factures d'abonnement depuis
-- l'ouverture de la sortie, ou l'avoir émis sur l'une d'elles dont la référence est le numéro (son montant).
create function plateforme.sortie_rembourse_note(s plateforme.sortie) returns bigint
language sql stable security definer set search_path = pg_catalog, ventes, plateforme as $$
  select greatest(
    coalesce((select sum(plateforme.rembourse_sur(p.id, (s.ouverte_le at time zone 'Africa/Tunis')::date))
                from plateforme.facture_abonnement f
                join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
               where f.entreprise = s.entreprise), 0),
    coalesce((select max(a.net_a_payer) from plateforme.facture_abonnement f
                join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                join ventes.piece a on a.entreprise = p.entreprise and a.corrige = p.id and a.type = 'avoir' and a.statut = 'emise'
               where f.entreprise = s.entreprise and upper(a.numero_texte) = upper(s.remboursement_reference)), 0))::bigint
$$;
revoke execute on function plateforme.sortie_rembourse_note(plateforme.sortie) from public;

create or replace function plateforme.sortie_lue(s plateforme.sortie, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'id', s.id, 'cause', s.cause, 'dit', s.dit, 'ouverteLe', s.ouverte_le,
    'ouvertePar', (select u.nom from socle.utilisateur u where u.id = s.ouverte_par),
    'contrat', c.v,
    -- Le dernier téléchargement de toutes ses données, par qui (la trace de son journal ; jamais le fichier).
    'export', (select jsonb_build_object('le', a.instant, 'par', (select u.nom from socle.utilisateur u where u.id = a.utilisateur))
                 from socle.audit a where a.entreprise = s.entreprise and a.geste = 'socle.export_complet'
                order by a.instant desc limit 1),
    -- 0138 : le montant et le jour d'un remboursement déclaré, et ce que SkanFact en a noté (le rapprochement).
    'remboursement', case when s.remboursement is null then null else jsonb_build_object('sorte', s.remboursement,
                       'reference', s.remboursement_reference, 'le', s.remboursement_le,
                       'par', (select u.nom from socle.utilisateur u where u.id = s.remboursement_par),
                       'montant', s.remboursement_montant::text, 'renduLe', s.remboursement_rendu_le,
                       'note', case when s.remboursement = 'fait' then plateforme.sortie_rembourse_note(s)::text end) end,
    -- La conservation : la copie gardée à la clôture, sinon le terme d'aujourd'hui (le contrat peut encore bouger).
    'conserverJusquAu', coalesce(s.conserver_jusqu_au, ((c.v->>'fin')::date + plateforme.sortie_conservation())::date),
    'close', case when s.close_le is null then null else jsonb_build_object('le', s.close_le, 'issue', s.issue, 'motif', s.close_motif,
               'par', (select u.nom from socle.utilisateur u where u.id = s.close_par), 'finContrat', s.fin_contrat) end)
  from (select plateforme.sortie_contrat(s.entreprise, p_jour) v) c
$$;

-- Clore une sortie (0131) : « partie » attend aussi que le remboursement déclaré soit rapproché.
create or replace function plateforme.console_clore_sortie(p_sortie uuid, p_issue text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  s plateforme.sortie; v_contrat jsonb; v_fin date;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_issue is null or p_issue not in ('partie', 'reste') then
    perform socle.refus('une sortie se clôt de deux façons : le client est parti, ou il reste');
  end if;
  select * into s from plateforme.sortie where id = p_sortie for update;
  if not found then perform socle.refus('cette sortie n''existe pas'); end if;
  if s.close_le is not null then perform socle.refus('cette sortie est close'); end if;
  -- Le contrat, lu sous verrou : un paiement concurrent qui le prolonge attend la fin de ce geste.
  perform 1 from plateforme.abonnement where entreprise = s.entreprise for update;
  v_contrat := plateforme.sortie_contrat(s.entreprise, (p_maintenant at time zone 'Africa/Tunis')::date);
  v_fin := (v_contrat->>'fin')::date;
  if p_issue = 'partie' then
    if not (v_contrat->>'arrete')::boolean or v_fin is null then
      perform socle.refus('son abonnement se renouvelle encore : résilie-le d''abord, il ira au bout de ce qui est payé');
    end if;
    if s.remboursement is null then
      perform socle.refus('le remboursement n''est pas réglé : dis s''il n''y a rien à rendre, ou la référence de ce qui a été rendu');
    end if;
    -- 0138 : un remboursement déclaré se rapproche avant que le client parte (ce que SkanFact en a noté le couvre).
    if s.remboursement = 'fait' and s.remboursement_montant is not null and plateforme.sortie_rembourse_note(s) < s.remboursement_montant then
      perform socle.refus('le remboursement déclaré n''est pas encore noté dans SkanFact : note-le sur sa facture (un règlement négatif, ou son avoir), puis clos la sortie');
    end if;
  end if;
  update plateforme.sortie
     set close_le = p_maintenant, close_par = socle.moi(), issue = p_issue, close_motif = btrim(p_motif),
         fin_contrat = case when p_issue = 'partie' then v_fin end,
         conserver_jusqu_au = case when p_issue = 'partie' then (v_fin + plateforme.sortie_conservation())::date end
   where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.sortie_close', s.entreprise, btrim(p_motif), null,
            jsonb_build_object('issue', p_issue, 'finContrat', case when p_issue = 'partie' then v_fin end,
                               'conserverJusquAu', case when p_issue = 'partie' then (v_fin + plateforme.sortie_conservation())::date end));
end $$;


-- ── A08 : l'e-mail d'une invitation, noté dès l'invitation ─────────────────────────────────────────────────────────
alter table socle.invitation drop constraint invitation_courriel_check;
alter table socle.invitation add constraint invitation_courriel_check check (courriel in ('a_envoyer', 'parti', 'refuse', 'en_attente', 'sans_relais'));
alter table plateforme.invitation_console drop constraint invitation_console_courriel_check;
alter table plateforme.invitation_console add constraint invitation_console_courriel_check check (courriel in ('a_envoyer', 'parti', 'refuse', 'en_attente', 'sans_relais'));

-- « À envoyer » s'écrit dans la transaction de l'invitation, ou d'un nouveau lien (la route l'appelle avant de valider :
-- l'empreinte est celle du lien neuf) ; ensuite, l'envoi le remplace (parti, refusé, en attente, sans relais), et une
-- réponse tardive du relais remplace « en attente » ; rien ne revient vers « en attente ».
create or replace function socle.noter_courriel_invitation(p_empreinte text, p_etat text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if p_etat not in ('a_envoyer', 'parti', 'refuse', 'en_attente', 'sans_relais') then perform socle.refus('cet état d''un e-mail n''existe pas'); end if;
  update socle.invitation set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
  update plateforme.invitation_console set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
end $$;
