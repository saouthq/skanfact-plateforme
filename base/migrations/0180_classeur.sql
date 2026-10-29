-- Le classeur du client au Cabinet (« Tout le dossier », maquette docs/maquettes/cabinet/classeur.html ; 1.172.0, le
-- 29/10/2026 ; Skander : « y'a encore énormément d'écart entre la maquette et la page »). Deux choses qui manquaient :
--
-- 1. JOINDRE une pièce reçue à une écriture déjà dans ses livres : Sarra a saisi l'achat de la STEG sans justificatif,
--    puis envoie la photo ; le cabinet la joint à cet achat au lieu d'en saisir un second (l'électricité ne compte qu'une
--    fois). La pièce est alors classée (« jointe »), l'écriture la porte comme justificatif, et l'achat n'est plus « sans
--    justificatif » pour qui lit les livres. Détacher, c'est défaire ce classement : tout revient comme avant.
--
-- 2. Les DOCUMENTS que le cabinet range lui-même dans le classeur d'un client : le dossier permanent (statuts, RNE,
--    attestations, contrats, lettre de mission), les courriers de l'administration, l'accusé de dépôt d'une déclaration,
--    et les pièces qu'on lui a données en main propre, par e-mail ou par WhatsApp (« Déposer des pièces »). Ils
--    appartiennent au cabinet, comme sa fiche du dossier (0020) : le client ne les lit pas ici. Un document ne s'efface
--    jamais ; il se classe, ou un autre le remplace (l'ancien reste, marqué remplacé).

-- ── 1. Joindre une pièce reçue ───────────────────────────────────────────────────────────────────────
alter table messagerie.message
  add column jointe_ecriture uuid,
  drop constraint message_classee_raison,
  add constraint message_classee_raison check (classee_raison is null
    or (classee_le is not null and classee_raison in ('saisie', 'verifiee', 'rien', 'double', 'illisible', 'banque', 'client', 'jointe'))),
  add constraint message_jointe check ((jointe_ecriture is not null) = (classee_raison is not distinct from 'jointe'));

-- Classer (0179) ne joint pas : « jointe » vient seulement de joindre_piece, qui nomme l'écriture. Défaire un classement
-- détache aussi.
drop function messagerie.classer_piece(uuid, uuid, boolean, text, text);
create function messagerie.classer_piece(p_entreprise uuid, p_message uuid, p_classee boolean, p_raison text, p_note text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  if not p_classee and (p_raison is not null or p_note is not null) then
    perform socle.refus('une pièce qu''on remet à classer n''a pas de raison');
  end if;
  if p_raison = 'jointe' then perform socle.refus('une pièce se joint à une écriture nommée'); end if;
  update messagerie.message
     set classee_le = case when p_classee then clock_timestamp() end, classee_par = case when p_classee then socle.moi() end,
         classee_raison = case when p_classee then p_raison end, classee_note = case when p_classee then nullif(btrim(p_note), '') end,
         jointe_ecriture = null
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null
     and (classee_le is null) = p_classee;
  if not found and p_classee then
    perform socle.refus('cette pièce n''est pas à classer');
  elsif not found then
    perform socle.refus('cette pièce n''est pas classée');
  end if;
  perform socle.tracer(p_entreprise, case when p_classee then 'messagerie.classer' else 'messagerie.declasser' end, 'message', p_message,
    null, case when p_raison is null then null else jsonb_build_object('raison', p_raison) end);
end $$;
revoke all on function messagerie.classer_piece(uuid, uuid, boolean, text, text) from public;
grant execute on function messagerie.classer_piece(uuid, uuid, boolean, text, text) to skanfact_app;

-- Joindre : une pièce encore à classer, à une écriture de SES livres (ni contre-passée, ni des à-nouveaux).
create function messagerie.joindre_piece(p_entreprise uuid, p_message uuid, p_ecriture uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  if not exists (select 1 from compta.ecriture e where e.entreprise = p_entreprise and e.id = p_ecriture and e.journal <> 'AN') then
    perform socle.refus('cette écriture n''est pas dans ses livres');
  end if;
  update messagerie.message
     set classee_le = clock_timestamp(), classee_par = socle.moi(), classee_raison = 'jointe', classee_note = null, jointe_ecriture = p_ecriture
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null and classee_le is null;
  if not found then perform socle.refus('cette pièce n''est pas à classer'); end if;
  perform socle.tracer(p_entreprise, 'messagerie.joindre', 'message', p_message, null, jsonb_build_object('ecriture', p_ecriture));
end $$;
revoke all on function messagerie.joindre_piece(uuid, uuid, uuid) from public;
grant execute on function messagerie.joindre_piece(uuid, uuid, uuid) to skanfact_app;

-- ── 2. Les documents du classeur ──────────────────────────────────────────────────────────────────────
create table cabinet.document (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  -- permanent : ce qui ne change pas d'une année à l'autre ; courrier : de l'administration, d'un contrôle ; accuse : l'accusé
  -- de dépôt d'une déclaration (sa période) ; piece : une pièce du mois déposée par le cabinet.
  rubrique text not null check (rubrique in ('permanent', 'courrier', 'accuse', 'piece')),
  categorie text check (categorie is null or categorie in ('juridique', 'fiscal', 'contrats', 'banque', 'cabinet')),
  periode text check (periode is null or periode ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
  titre text not null check (length(titre) between 1 and 200),
  detail text check (detail is null or length(detail) <= 300),
  echeance date,
  -- D'où il vient : « WhatsApp de Sarra », « en main propre », « par e-mail »…
  provenance text check (provenance is null or length(provenance) between 1 and 100),
  nom text not null check (length(nom) between 1 and 200),
  type text not null check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  taille int not null check (taille between 1 and 10485760),
  contenu bytea not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  depose_par uuid not null references socle.utilisateur(id),
  depose_le timestamptz not null default now(),
  -- Remplacé par un autre document : il reste, et se lit dans l'historique.
  remplace_par uuid references cabinet.document(id),
  -- Une pièce déposée se classe comme une pièce reçue (0179), ou se joint à une écriture.
  classee_le timestamptz,
  classee_par uuid references socle.utilisateur(id),
  classee_raison text check (classee_raison is null or classee_raison in ('saisie', 'verifiee', 'rien', 'double', 'illisible', 'banque', 'jointe')),
  jointe_ecriture uuid,
  check (octet_length(contenu) = taille),
  check ((categorie is not null) = (rubrique = 'permanent')),
  check (rubrique not in ('accuse', 'piece') or periode ~ '^\d{4}-\d{2}$'),
  check ((classee_le is null) = (classee_par is null)),
  check (classee_raison is null or (classee_le is not null and rubrique = 'piece')),
  check ((jointe_ecriture is not null) = (classee_raison is not distinct from 'jointe'))
);
create index document_dossier on cabinet.document (cabinet, entreprise, rubrique, depose_le desc);
alter table cabinet.document enable row level security;
alter table cabinet.document force row level security;
-- Le lit et l'écrit qui est du cabinet ET voit le dossier (comme sa fiche, 0020). Jamais d'effacement.
create policy visible on cabinet.document
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
grant select, insert, update on cabinet.document to skanfact_app;

-- ── 3. Ce qu'une écriture porte comme justificatif ─────────────────────────────────────────────────────
-- Ceux du client (0174), puis les pièces que le cabinet lui a jointes : une pièce reçue (le client l'a envoyée) ou un
-- document déposé par le cabinet (lu seulement par qui est de ce cabinet).
create or replace function compta.justificatifs_ecriture(p_entreprise uuid, p_ecriture uuid) returns table (fichier uuid, nom text, type text, taille int)
language sql stable security definer set search_path = pg_catalog, socle as $$
  with e as (
    select origine, origine_type from compta.ecriture
     where entreprise = p_entreprise and id = p_ecriture and origine_type in ('achat', 'vente')
  ), pieces as (
    select d.contenu from e
      join achats.piece a on e.origine_type = 'achat' and a.entreprise = p_entreprise and a.id = e.origine
      join socle.dossier_v10 d on d.entreprise = p_entreprise and d.collection = 'purchases' and d.cle = a.ref_v10
    union all
    select d.contenu from e
      join ventes.piece v on e.origine_type = 'vente' and v.entreprise = p_entreprise and v.id = e.origine
      join socle.dossier_v10 d on d.entreprise = p_entreprise and d.collection = 'documents' and d.cle = v.ref_v10
  ), tous as (
    select j.id, j.nom, j.type, j.taille, j.depose_le
      from pieces
      cross join lateral jsonb_array_elements(case when jsonb_typeof(pieces.contenu -> 'attachments') = 'array'
        then pieces.contenu -> 'attachments' else '[]'::jsonb end) as fiche(x)
      join socle.piece_jointe j on j.entreprise = p_entreprise and j.id::text = fiche.x ->> 'file'
    union all
    select fi.id, fi.nom, fi.type, fi.taille, m.classee_le
      from messagerie.message m join messagerie.fichier fi on fi.id = m.fichier
     where m.entreprise = p_entreprise and m.jointe_ecriture = p_ecriture
    union all
    select d.id, d.nom, d.type, d.taille, d.classee_le
      from cabinet.document d
     where d.entreprise = p_entreprise and d.jointe_ecriture = p_ecriture and d.cabinet in (select socle.mes_organisations())
  )
  select id, nom, type, taille from tous
   where p_entreprise in (select compta.mes_entreprises())
   order by depose_le, id
$$;

create or replace function compta.justificatif_ecriture(p_entreprise uuid, p_ecriture uuid, p_fichier uuid) returns table (nom text, type text, contenu bytea)
language sql stable security definer set search_path = pg_catalog, socle as $$
  with permis as (select l.fichier from compta.justificatifs_ecriture(p_entreprise, p_ecriture) l where l.fichier = p_fichier)
  select j.nom, j.type, j.contenu from socle.piece_jointe j where j.entreprise = p_entreprise and j.id in (select fichier from permis)
  union all
  select fi.nom, fi.type, fi.contenu from messagerie.fichier fi where fi.entreprise = p_entreprise and fi.id in (select fichier from permis)
  union all
  select d.nom, d.type, d.contenu from cabinet.document d where d.entreprise = p_entreprise and d.id in (select fichier from permis)
$$;

-- L'achat porte-t-il un justificatif (0173) : le sien, ou une pièce que le cabinet a jointe à son écriture.
create or replace function compta.achats_justifies(p_entreprise uuid, p_pieces uuid[]) returns table (piece uuid, justifie boolean)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p.id, coalesce(case when jsonb_typeof(d.contenu -> 'attachments') = 'array' then jsonb_array_length(d.contenu -> 'attachments') > 0 end, false)
      or exists (select 1 from compta.ecriture e
                  where e.entreprise = p.entreprise and e.origine_type = 'achat' and e.origine = p.id
                    and (exists (select 1 from messagerie.message m where m.entreprise = p.entreprise and m.jointe_ecriture = e.id)
                      or exists (select 1 from cabinet.document c where c.entreprise = p.entreprise and c.jointe_ecriture = e.id)))
    from achats.piece p
    join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'purchases' and d.cle = p.ref_v10
   where p.entreprise = p_entreprise and p.id = any(p_pieces)
     and p_entreprise in (select compta.mes_entreprises())
$$;
