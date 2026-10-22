-- 0168 — Les pièces demandées : une date, et des relances (1.116.0 ; docs/revue-messagerie.md, lot 2, point 6).
--
-- Revue du 22/10/2026 : une pièce demandée attendait sans date ni relance (seule l'alerte « un message t'attend »
-- partait, une fois). Les outils des cabinets (Karbon, Pennylane) datent la demande et relancent seuls. Décidé par
-- délégation : la demande porte une date « pour le » (facultative ; l'écran propose dans sept jours) ; restée sans
-- réponse à cette date, elle se relance par e-mail ce jour-là, puis une fois par semaine, trois relances au plus.
-- L'e-mail ne porte rien de la demande (ni la pièce, ni le cabinet, ni l'entreprise) : la règle de l'alerte (0078).
-- Une demande sans date ne se relance pas : le cabinet garde la main.

alter table messagerie.message
  add column demande_pour date,
  add column relances int not null default 0,
  add column relance_le timestamptz,
  add constraint message_pour check (demande_pour is null or demande is not null),
  add constraint message_relances check (relances between 0 and 3 and (relances = 0) = (relance_le is null));

-- Écrire : la date « pour le » d'une pièce demandée, aujourd'hui ou plus tard (le reste ne change pas depuis 0167).
create or replace function messagerie.ecrire(p_entreprise uuid, p_cote text, p_message jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare
  v_cabinet uuid; v_id uuid; v_texte text; v_demande text; v_fichier uuid; v_repond uuid; v_nom text;
  v_genre text; v_piece text; v_libelle text; v_pour date; f record;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  v_texte := trim(coalesce(p_message->>'texte', ''));
  v_demande := nullif(trim(coalesce(p_message->>'demande', '')), '');
  v_fichier := nullif(p_message->>'fichier', '')::uuid;
  v_repond := nullif(p_message->>'repondA', '')::uuid;
  if coalesce(p_message->>'pour', '') !~ '^(\d{4}-\d{2}-\d{2})?$' then perform socle.refus('une date « pour le » s''écrit en jour, mois et année'); end if;
  v_pour := nullif(p_message->>'pour', '')::date;
  if v_demande is not null and p_cote <> 'cabinet' then perform socle.refus('seul le cabinet demande une pièce'); end if;
  if v_pour is not null and v_demande is null then perform socle.refus('une date « pour le » va avec une pièce demandée'); end if;
  if v_pour < (clock_timestamp() at time zone 'Africa/Tunis')::date then
    perform socle.refus('une pièce se demande pour aujourd''hui ou plus tard');
  end if;
  if length(v_texte) = 0 and v_fichier is null and v_demande is null and jsonb_typeof(p_message->'piece') is distinct from 'object' then
    perform socle.refus('un message vide n''apprend rien');
  end if;
  if length(v_texte) > 4000 then perform socle.refus('un message tient en 4 000 caractères'); end if;
  if v_demande is not null and length(v_demande) > 300 then perform socle.refus('une pièce demandée se nomme en 300 caractères'); end if;
  if jsonb_typeof(p_message->'piece') = 'object' then
    v_genre := p_message->'piece'->>'genre';
    v_piece := trim(coalesce(p_message->'piece'->>'id', ''));
    v_libelle := trim(coalesce(p_message->'piece'->>'libelle', ''));
    if coalesce(v_genre, '') not in ('facture', 'avoir', 'devis', 'achat') or length(v_piece) not between 1 and 100
       or length(v_libelle) not between 1 and 300 then
      perform socle.refus('cette pièce ne se reconnaît pas : une facture, un avoir, un devis ou un achat, avec son libellé');
    end if;
  end if;
  if v_fichier is not null then
    select * into f from messagerie.fichier x where x.id = v_fichier and x.entreprise = p_entreprise and x.cabinet = v_cabinet for update;
    if not found or f.depose_par <> socle.moi() then perform socle.refus('ce fichier n''est pas là : dépose-le d''abord'); end if;
    if exists (select 1 from messagerie.message m where m.fichier = v_fichier) then perform socle.refus('ce fichier est déjà joint à un message'); end if;
  end if;
  -- La pièce demandée, envoyée en réponse (un fichier, ou la pièce du dossier qui l'est) : la demande est reçue.
  if v_repond is not null then
    if p_cote <> 'entreprise' or (v_fichier is null and v_genre is null) then perform socle.refus('on répond à une pièce demandée en l''envoyant'); end if;
    update messagerie.message set demande_recue_le = clock_timestamp(), demande_recue_par = socle.moi()
     where id = v_repond and entreprise = p_entreprise and cabinet = v_cabinet and demande is not null and demande_recue_le is null;
    if not found then perform socle.refus('cette pièce demandée n''attend plus rien'); end if;
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.message (entreprise, cabinet, cote, auteur, auteur_nom, texte, piece_genre, piece_id, piece_libelle, demande, demande_pour, fichier, repond_a)
  values (p_entreprise, v_cabinet, p_cote, socle.moi(), v_nom, v_texte, v_genre, nullif(v_piece, ''), nullif(v_libelle, ''), v_demande, v_pour, v_fichier, v_repond)
  returning id into v_id;
  perform messagerie.marquer_lu(p_entreprise, v_cabinet, p_cote);
  perform socle.tracer(p_entreprise, 'messagerie.ecrire', 'message', v_id, null, jsonb_build_object('cote', p_cote,
    'piece', case when v_genre is null then null else v_genre || ':' || v_piece end, 'demande', v_demande, 'pour', v_pour, 'fichier', v_fichier));
  return v_id;
end $$;

-- ── Les relances à envoyer (le serveur, chaque minute, hors de toute personne) ────────────────────
-- Les pièces demandées pas encore reçues dont la date est venue (jour de Tunis), sous un mandat actif, relancées moins
-- de trois fois et pas depuis sept jours ; pour chacune, les personnes de l'entreprise qui lisent le fil, à une adresse
-- vérifiée, qui n'ont pas décoché « Me prévenir par e-mail » pour ce fil. Ce qui en sort : l'adresse, la langue, et de
-- quoi noter la relance ; ni la pièce, ni le nom de l'entreprise, ni celui du cabinet.
create function messagerie.relances_dues(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  with dues as (
    select m.id, m.entreprise, m.cabinet from messagerie.message m
     where m.demande is not null and m.demande_recue_le is null and m.demande_pour is not null
       and m.demande_pour <= (p_maintenant at time zone 'Africa/Tunis')::date
       and m.relances < 3 and (m.relance_le is null or m.relance_le <= p_maintenant - interval '7 days')
       and exists (select 1 from socle.mandat d where d.entreprise = m.entreprise and d.cabinet = m.cabinet and d.statut = 'actif'
                     and d.debut <= (p_maintenant at time zone 'Africa/Tunis')::date
                     and (d.fin is null or d.fin >= (p_maintenant at time zone 'Africa/Tunis')::date))
  )
  select coalesce(jsonb_agg(jsonb_build_object('message', x.id, 'utilisateur', mb.utilisateur, 'email', u.email, 'langue', u.langue,
           'entreprise', x.entreprise, 'cabinet', x.cabinet) order by x.entreprise, x.id, mb.utilisateur), '[]'::jsonb)
    from dues x
    join socle.membre mb on mb.entreprise = x.entreprise and mb.actif
     and mb.roles && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
    join socle.utilisateur u on u.id = mb.utilisateur and u.adresse_verifiee_le is not null
    left join messagerie.alerte al on al.utilisateur = mb.utilisateur and al.entreprise = x.entreprise and al.cabinet = x.cabinet
   where socle.moi() is null and coalesce(al.active, true)
$$;

-- La relance est partie : la demande en compte une de plus, et attend sept jours avant la suivante.
create function messagerie.relance_partie(p_message uuid, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une relance partie'); end if;
  update messagerie.message set relances = relances + 1, relance_le = p_le
   where id = p_message and demande is not null and demande_recue_le is null and relances < 3;
end $$;

revoke execute on function messagerie.relances_dues(timestamptz), messagerie.relance_partie(uuid, timestamptz) from public;
grant execute on function messagerie.relances_dues(timestamptz), messagerie.relance_partie(uuid, timestamptz) to skanfact_app;
