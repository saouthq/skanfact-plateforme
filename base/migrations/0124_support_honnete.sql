-- 0124 : l'invitation, le support et sa mesure, honnêtes (1.30.0 ; l'audit de la console 1.26.0, C07, C08, C09 et C12 ;
-- docs/console.md C46).
--   - C07 : l'e-mail d'une invitation part APRÈS que l'invitation est écrite (plus jamais un lien envoyé pour une
--     invitation annulée ensuite), et la réponse du relais est attendue un moment : l'écran dit ce qui est vrai — parti
--     (le relais l'a accepté ; ce n'est pas encore la preuve qu'il est arrivé), refusé, en attente du relais, ou sans
--     relais. L'invitation garde cet état, et l'heure ; la liste de l'équipe SkanFact le montre.
--   - C08 : une demande attend depuis le premier mot du client resté sans réponse, plus depuis son dernier : une relance
--     (« vous avez vu mon message ? ») ne fait plus disparaître une demande en retard des urgences ;
--   - C09 : une réponse de l'équipe porte l'identifiant de sa commande (un par réponse écrite, gardé quand on renvoie après
--     une coupure) : la même commande deux fois ne fait qu'un message, et rend le premier ;
--   - C12 : la Mesure lit les demandes ouvertes comme la file du Support (l'attente actuelle n'est plus celle d'une demande
--     close, ni limitée au mois d'avant) ; une demande close sans réponse avant son délai ne compte ni tenue ni manquée.

-- ── C07 : l'état de l'e-mail de chaque invitation ─────────────────────────────────────────────────────────────────────
alter table socle.invitation
  add column courriel text check (courriel in ('parti', 'refuse', 'en_attente', 'sans_relais')),
  add column courriel_le timestamptz,
  add constraint invitation_courriel_le check ((courriel is null) = (courriel_le is null));
alter table plateforme.invitation_console
  add column courriel text check (courriel in ('parti', 'refuse', 'en_attente', 'sans_relais')),
  add column courriel_le timestamptz,
  add constraint invitation_console_courriel_le check ((courriel is null) = (courriel_le is null));

-- Noté par le serveur, après l'envoi (hors de la transaction de l'invitation, déjà validée) : l'invitation se retrouve par
-- l'empreinte de son lien. Une réponse tardive du relais remplace « en attente » ; rien ne revient en arrière vers lui.
create function socle.noter_courriel_invitation(p_empreinte text, p_etat text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if p_etat not in ('parti', 'refuse', 'en_attente', 'sans_relais') then perform socle.refus('cet état d''un e-mail n''existe pas'); end if;
  update socle.invitation set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte and (p_etat <> 'en_attente' or courriel is null);
  update plateforme.invitation_console set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte and (p_etat <> 'en_attente' or courriel is null);
end $$;
revoke execute on function socle.noter_courriel_invitation(text, text, timestamptz) from public;
grant execute on function socle.noter_courriel_invitation(text, text, timestamptz) to skanfact_app;

-- La liste de l'équipe SkanFact (0118) : chaque invitation dit ce que son e-mail est devenu.
create or replace function plateforme.console_invitations(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'inviteeLe', i.invitee_le,
            'expireLe', i.expire_le, 'expiree', i.expire_le <= p_maintenant, 'invitePar', u.nom,
            'courriel', i.courriel, 'courrielLe', i.courriel_le) order by i.invitee_le desc), '[]'::jsonb)
    from plateforme.invitation_console i join socle.utilisateur u on u.id = i.invite_par
   where i.acceptee_le is null and i.annulee_le is null and i.expire_le > p_maintenant - interval '30 days');
end $$;

-- ── C08 : depuis quand une demande attend ─────────────────────────────────────────────────────────────────────────────
create or replace function plateforme.support_ligne(d plateforme.demande_support) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal, 'ouverteLe', d.ouverte_le,
    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'essai', e.essai),
    'demandeur', jsonb_build_object('id', p.id, 'nom', p.nom),
    'noteePar', (select u.nom from socle.utilisateur u where u.id = d.notee_par),
    'suiviePar', (select u.nom from socle.utilisateur u where u.id = d.suivie_par), 'suivieParId', d.suivie_par, 'priorite', d.priorite,
    'technique', case when d.technique_le is null then null else jsonb_build_object('le', d.technique_le, 'motif', d.technique_motif) end,
    'dernierClientLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'),
    -- 0124 (l'audit C08) : le premier mot du client resté sans réponse — après notre dernier mot, et (s'il a réécrit pendant
    -- l'attente de la technique) après le début de cette attente. Une relance du client ne remet rien à zéro.
    'attendClientLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'
        and m.ecrit_le > coalesce((select max(e.ecrit_le) from plateforme.message_support e where e.demande = d.id and e.cote = 'equipe'), '-infinity')),
    'attendClientApresTechniqueLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'
        and m.ecrit_le > greatest(coalesce((select max(e.ecrit_le) from plateforme.message_support e where e.demande = d.id and e.cote = 'equipe'), '-infinity'),
                                  coalesce(d.technique_le, '-infinity'))),
    'dernierEquipeLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
    'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
    'messages', (select count(*) from plateforme.message_support m where m.demande = d.id),
    'close', case when d.close_le is null then null else jsonb_build_object('le', d.close_le, 'cote', d.close_cote,
               'par', (select u.nom from socle.utilisateur u where u.id = d.close_par), 'motif', d.close_motif) end)
    from socle.entreprise e, socle.utilisateur p
   where e.id = d.entreprise and p.id = d.demandeur
$$;

-- ── C09 : une réponse, une fois ───────────────────────────────────────────────────────────────────────────────────────
alter table plateforme.message_support add column commande uuid;
create unique index message_support_commande on plateforme.message_support (demande, commande) where commande is not null;

drop function plateforme.console_repondre_demande(uuid, text, text, timestamptz);
create function plateforme.console_repondre_demande(p_demande uuid, p_texte text, p_article text, p_maintenant timestamptz, p_commande uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v plateforme.demande_support; v_id uuid; v_texte text := btrim(coalesce(p_texte, ''));
begin
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une réponse : de trois à quatre mille caractères'); end if;
  if p_article is not null and p_article !~ '^[a-z][a-z0-9_-]{0,39}$' then perform socle.refus('cet article de l''Aide n''existe pas'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  -- La même commande, déjà passée (un renvoi après une coupure, deux envois au même moment : la demande verrouillée les
  -- range l'un après l'autre) : la réponse est déjà là, on la rend.
  if p_commande is not null then
    select m.id into v_id from plateforme.message_support m where m.demande = p_demande and m.commande = p_commande;
    if v_id is not null then return v_id; end if;
  end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la pour y répondre'); end if;
  insert into plateforme.message_support (demande, cote, auteur, texte, article, ecrit_le, commande)
    values (p_demande, 'equipe', socle.moi(), v_texte, p_article, p_maintenant, p_commande)
    returning id into v_id;
  update plateforme.demande_support set suivie_par = coalesce(suivie_par, socle.moi()) where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.repondre', v.entreprise, v.sujet, null,
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'article', p_article));
  return v_id;
end $$;
revoke execute on function plateforme.console_repondre_demande(uuid, text, text, timestamptz, uuid) from public;
grant execute on function plateforme.console_repondre_demande(uuid, text, text, timestamptz, uuid) to skanfact_app;

-- ── C12 : la Mesure lit la file comme le Support ─────────────────────────────────────────────────────────────────────
create or replace function plateforme.console_mesure(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  if p_jour is null then perform socle.refus('le jour de la mesure manque'); end if;
  return jsonb_build_object(
    -- Les pièces émises ces trente derniers jours, aujourd'hui compris, par entreprise (celles qui en ont).
    'piecesTrente', (select coalesce(jsonb_object_agg(x.entreprise, x.n), '{}'::jsonb) from (
        select p.entreprise, count(*) n from ventes.piece p join socle.entreprise e on e.id = p.entreprise
         where not e.essai and p.statut = 'emise' and (p.emise_le at time zone e.fuseau)::date between p_jour - 29 and p_jour
         group by p.entreprise) x),
    -- Les demandes de support ouvertes depuis le premier jour du mois d'avant : quand, sa priorité, sa première réponse.
    -- Une demande notée par l'équipe (reçue ailleurs) compte comme les autres : elle attend aussi sa réponse.
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('ouverteLe', d.ouverte_le, 'priorite', d.priorite,
                    'reponduLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
                    'closeLe', d.close_le) order by d.ouverte_le), '[]'::jsonb)
                   from plateforme.demande_support d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.ouverte_le >= (date_trunc('month', p_jour) - interval '1 month')),
    -- 0124 (l'audit C12) : les demandes ouvertes aujourd'hui, quel que soit leur âge, lues comme la file du Support les lit
    -- (plateforme.support_ligne) : l'attente actuelle est la sienne, au même chiffre.
    'ouvertes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.ouverte_le, d.id), '[]'::jsonb)
                   from plateforme.demande_support d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.close_le is null),
    -- Les urgentes depuis toujours (une panne bloquante est rare : son compte se lit depuis l'ouverture).
    'urgentes', (select coalesce(jsonb_agg(jsonb_build_object('ouverteLe', d.ouverte_le,
                    'reponduLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'), 'closeLe', d.close_le)
                    order by d.ouverte_le), '[]'::jsonb)
                   from plateforme.demande_support d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.priorite = 'urgente'));
end $$;
