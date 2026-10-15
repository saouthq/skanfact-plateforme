-- 0129 : les contestations de nos factures et leur régularisation (1.36.0 ; la liste des fonctions qui manquent, 13 ;
-- docs/console.md C52). Un client conteste une facture d'abonnement (un montant, une période, une offre qu'il dit ne pas
-- avoir choisie) : la console le note — ce qu'il conteste, par quel canal —, la facture le dit dans Paiements, et la
-- contestation attend sa régularisation, qui la clôt d'une de quatre façons :
--   - par un avoir (son numéro, émis dans SkanFact) ;
--   - par un remboursement (sa référence : le virement, le chèque) ;
--   - maintenue (la facture était juste : le client la doit) ;
--   - retirée (le client s'est rétracté).
-- La direction seule régularise par un avoir, un remboursement ou en maintenant la facture (c'est de l'argent) ; le
-- support note une contestation et la dit retirée. Rien ne s'écrit dans la facture elle-même : l'avoir et le
-- remboursement se font dans l'application de SkanFact, comme toute pièce ; la contestation en garde la trace.

create table plateforme.contestation (
  id uuid primary key default socle.uuidv7(),
  -- Une facture d'abonnement ne s'efface jamais (aucun code ne le fait) ; seuls les essais vident la table : la
  -- contestation la suit.
  facture uuid not null references plateforme.facture_abonnement(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  canal text not null check (canal in ('telephone', 'courriel', 'whatsapp', 'support', 'autre')),
  -- Ce que le client conteste, dans ses mots (ni pièce jointe, ni coordonnées).
  dit text not null check (length(btrim(dit)) between 3 and 1000),
  ouverte_le timestamptz not null,
  ouverte_par uuid not null references socle.utilisateur(id),
  close_le timestamptz,
  close_par uuid references socle.utilisateur(id),
  issue text check (issue in ('avoir', 'remboursement', 'maintenue', 'retiree')),
  -- Le numéro de l'avoir, ou la référence du remboursement : ce qui permet de retrouver la régularisation.
  reference text check (reference is null or length(btrim(reference)) between 1 and 60),
  close_motif text,
  check ((close_le is null) = (close_par is null) and (close_le is null) = (issue is null) and (close_le is null) = (close_motif is null)),
  check (issue is null or (issue in ('avoir', 'remboursement')) = (reference is not null))
);
-- Une seule contestation en cours par facture.
create unique index contestation_en_cours on plateforme.contestation (facture) where close_le is null;
create index contestation_entreprise on plateforme.contestation (entreprise, ouverte_le desc);
alter table plateforme.contestation enable row level security;
alter table plateforme.contestation force row level security;

-- Noter une contestation, sur une facture d'abonnement émise dans le dossier de SkanFact.
create function plateforme.console_contester(p_facture uuid, p_canal text, p_dit text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  f plateforme.facture_abonnement; v_numero text; v_id uuid;
begin
  if length(btrim(coalesce(p_dit, ''))) not between 3 and 1000 then
    perform socle.refus('ce que le client conteste : de trois à mille caractères');
  end if;
  if p_canal is null or p_canal not in ('telephone', 'courriel', 'whatsapp', 'support', 'autre') then
    perform socle.refus('le canal d''une contestation : téléphone, e-mail, WhatsApp, support ou autre');
  end if;
  select fa.* into f from plateforme.facture_abonnement fa where fa.id = p_facture for update;
  if not found then perform socle.refus('cette facture n''existe pas'); end if;
  select p.numero_texte into v_numero from ventes.piece p
   where p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise';
  if v_numero is null then perform socle.refus('seule une facture émise se conteste'); end if;
  if exists (select 1 from plateforme.contestation c where c.facture = f.id and c.close_le is null) then
    perform socle.refus('cette facture est déjà contestée : la contestation en cours attend sa régularisation');
  end if;
  insert into plateforme.contestation (facture, entreprise, canal, dit, ouverte_le, ouverte_par)
    values (f.id, f.entreprise, p_canal, btrim(p_dit), p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'paiements.contester', f.entreprise, btrim(p_dit), null,
            jsonb_build_object('facture', v_numero, 'canal', p_canal));
  return v_id;
end $$;

-- La régulariser : la clore par son issue, avec le motif (et la référence de l'avoir ou du remboursement).
create function plateforme.console_regulariser(p_contestation uuid, p_issue text, p_reference text, p_motif text, p_maintenant timestamptz)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  c plateforme.contestation; v_numero text; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
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
  select p.numero_texte into v_numero from plateforme.facture_abonnement f
    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
   where f.id = c.facture;
  update plateforme.contestation
     set close_le = p_maintenant, close_par = socle.moi(), issue = p_issue,
         reference = case when p_issue in ('avoir', 'remboursement') then v_ref end, close_motif = btrim(p_motif)
   where id = c.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'paiements.regulariser', c.entreprise, btrim(p_motif), jsonb_build_object('facture', v_numero),
            jsonb_build_object('facture', v_numero, 'issue', p_issue, 'reference', case when p_issue in ('avoir', 'remboursement') then v_ref end));
end $$;

-- Les contestations que Paiements montre : celles en cours, et celles régularisées depuis quatre-vingt-dix jours ; pour
-- la fiche d'une entreprise (p_entreprise), toutes les siennes.
create function plateforme.console_contestations(p_maintenant timestamptz, p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'facture', f.id, 'piece', f.piece_v10, 'numero', p.numero_texte,
      'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
      'canal', c.canal, 'dit', c.dit, 'ouverteLe', c.ouverte_le, 'ouvertePar', (select u.nom from socle.utilisateur u where u.id = c.ouverte_par),
      'close', case when c.close_le is null then null else jsonb_build_object('le', c.close_le, 'issue', c.issue, 'reference', c.reference,
                 'motif', c.close_motif, 'par', (select u.nom from socle.utilisateur u where u.id = c.close_par)) end)
      order by (c.close_le is null) desc, coalesce(c.close_le, c.ouverte_le) desc), '[]'::jsonb)
    from plateforme.contestation c
    join plateforme.facture_abonnement f on f.id = c.facture
    join socle.entreprise e on e.id = c.entreprise
    left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
   where case when p_entreprise is null then c.close_le is null or c.close_le >= p_maintenant - interval '90 days'
              else c.entreprise = p_entreprise end);
end $$;

revoke execute on function plateforme.console_contester(uuid, text, text, timestamptz), plateforme.console_regulariser(uuid, text, text, text, timestamptz),
  plateforme.console_contestations(timestamptz, uuid) from public;
grant execute on function plateforme.console_contester(uuid, text, text, timestamptz), plateforme.console_regulariser(uuid, text, text, text, timestamptz),
  plateforme.console_contestations(timestamptz, uuid) to skanfact_app;
