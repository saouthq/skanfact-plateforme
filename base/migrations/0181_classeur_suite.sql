-- Ce que le classeur du Cabinet laissait de côté (1.173.0, le 29/10/2026 ; Skander : « d'abord faire ce qui reste avant de
-- repasser sur messages du cabinet », et ses trois choix du même jour) :
--
-- 1. Une pièce EN DOUBLE nomme sa jumelle (une pièce reçue ou un document du cabinet) : l'écran les montre côte à côte.
-- 2. Une pièce se RANGE dans un autre mois que celui de son arrivée (rangée au mauvais endroit) : elle garde sa date
--    d'arrivée, le mois choisi s'écrit à côté.
-- 3. La LECTURE d'une pièce (le fournisseur, le numéro, la date, le total) faite par l'IA, avec le même accord que la
--    lecture des achats côté entreprise (company.lectureIA, et la question posée avant chaque envoi) : gardée ici pour
--    le cabinet, une fois, pour que la ligne la dise sans relire.
-- 4. L'EXPORT du classeur, gardé 7 jours sur le serveur pour un lien qu'on ouvre ou qu'on transmet (un contrôle, la
--    banque) ; il s'efface ensuite.
-- 5. Le CLIENT lit ce que son cabinet a rangé dans son dossier (Skander : « oui, tout ») : les documents déposés, et les
--    pièces jointes à ses achats (un achat ainsi justifié l'est aussi chez lui).

-- ── 1 et 2. La jumelle d'une pièce en double, le mois choisi ─────────────────────────────────────────────
alter table messagerie.message
  add column double_de uuid,
  add column double_de_sorte text check (double_de_sorte is null or double_de_sorte in ('message', 'document')),
  add column mois_classeur text check (mois_classeur is null or mois_classeur ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add constraint message_double check ((double_de is null) = (double_de_sorte is null)
    and (double_de is null or classee_raison is not distinct from 'double'));
alter table cabinet.document
  add column double_de uuid,
  add column double_de_sorte text check (double_de_sorte is null or double_de_sorte in ('message', 'document')),
  add constraint document_double check ((double_de is null) = (double_de_sorte is null)
    and (double_de is null or classee_raison is not distinct from 'double'));

-- Classer en double EN NOMMANT la jumelle : une pièce encore à classer, et une jumelle du même dossier, autre qu'elle.
create function messagerie.doubler_piece(p_entreprise uuid, p_message uuid, p_sorte text, p_jumelle uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  if p_jumelle = p_message then perform socle.refus('une pièce n''est pas le double d''elle-même'); end if;
  if p_sorte = 'message' then
    if not exists (select 1 from messagerie.message m where m.id = p_jumelle and m.entreprise = p_entreprise and m.cabinet = v_cabinet and m.fichier is not null) then
      perform socle.refus('cette jumelle n''est pas dans ce dossier');
    end if;
  elsif p_sorte = 'document' then
    if not exists (select 1 from cabinet.document d where d.id = p_jumelle and d.entreprise = p_entreprise and d.cabinet = v_cabinet) then
      perform socle.refus('cette jumelle n''est pas dans ce dossier');
    end if;
  else
    perform socle.refus('une jumelle est une pièce reçue ou un document');
  end if;
  update messagerie.message
     set classee_le = clock_timestamp(), classee_par = socle.moi(), classee_raison = 'double', classee_note = null,
         jointe_ecriture = null, double_de = p_jumelle, double_de_sorte = p_sorte
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null and classee_le is null;
  if not found then perform socle.refus('cette pièce n''est pas à classer'); end if;
  perform socle.tracer(p_entreprise, 'messagerie.doubler', 'message', p_message, null, jsonb_build_object('jumelle', p_jumelle, 'sorte', p_sorte));
end $$;
revoke all on function messagerie.doubler_piece(uuid, uuid, text, uuid) from public;
grant execute on function messagerie.doubler_piece(uuid, uuid, text, uuid) to skanfact_app;

-- Défaire un classement (0180) efface aussi la jumelle : la contrainte l'exige.
create or replace function messagerie.classer_piece(p_entreprise uuid, p_message uuid, p_classee boolean, p_raison text, p_note text) returns void
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
         jointe_ecriture = null, double_de = null, double_de_sorte = null
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

-- Ranger une pièce reçue dans un autre mois (null : celui de son arrivée).
create function messagerie.ranger_mois(p_entreprise uuid, p_message uuid, p_mois text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  update messagerie.message set mois_classeur = p_mois
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null;
  if not found then perform socle.refus('cette pièce n''est pas dans ce dossier'); end if;
  perform socle.tracer(p_entreprise, 'messagerie.ranger_mois', 'message', p_message, null, jsonb_build_object('mois', p_mois));
end $$;
revoke all on function messagerie.ranger_mois(uuid, uuid, text) from public;
grant execute on function messagerie.ranger_mois(uuid, uuid, text) to skanfact_app;

-- ── 3. La lecture d'une pièce ─────────────────────────────────────────────────────────────────────────
create table cabinet.lecture (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  message uuid references messagerie.message(id),
  document uuid references cabinet.document(id),
  fournisseur text check (fournisseur is null or length(fournisseur) <= 200),
  numero text check (numero is null or length(numero) <= 100),
  date_piece date,
  -- Le total, au millième de l'unité de la pièce, en texte (« 186.420 ») : jamais un nombre à virgule.
  total text check (total is null or total ~ '^\d{1,12}(\.\d{1,3})?$'),
  devise text check (devise is null or devise in ('TND', 'EUR', 'USD')),
  lu_par uuid not null references socle.utilisateur(id),
  lu_le timestamptz not null default now(),
  check ((message is null) <> (document is null)),
  unique (cabinet, message),
  unique (cabinet, document)
);
alter table cabinet.lecture enable row level security;
alter table cabinet.lecture force row level security;
create policy visible on cabinet.lecture
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
-- Relire remplace la lecture d'avant.
grant select, insert, update on cabinet.lecture to skanfact_app;

-- ── 4. L'export, sept jours ───────────────────────────────────────────────────────────────────────────
create table cabinet.export (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  nom text not null check (length(nom) between 1 and 200),
  quoi text not null check (length(quoi) between 1 and 100),
  taille int not null check (taille between 1 and 209715200),
  contenu bytea not null,
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null default now() + interval '7 days',
  check (octet_length(contenu) = taille)
);
create index export_dossier on cabinet.export (cabinet, entreprise, cree_le desc);
alter table cabinet.export enable row level security;
alter table cabinet.export force row level security;
create policy visible on cabinet.export
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
-- Passé sept jours, il s'efface (le serveur le fait à chaque nouvel export du cabinet).
grant select, insert, delete on cabinet.export to skanfact_app;

-- ── 5. Ce que le client lit de son cabinet ────────────────────────────────────────────────────────────
-- Les documents que le cabinet a rangés dans SON dossier (sans leur contenu), et les pièces jointes à ses écritures
-- d'achat, avec l'achat qu'elles justifient. Pour qui répond au cabinet côté entreprise (messagerie.cote_entreprise).
create function cabinet.ce_que_mon_cabinet_a_range(p_entreprise uuid) returns table (
  sorte text, id uuid, rubrique text, categorie text, periode text, titre text, nom text, type text, taille int,
  depose_le timestamptz, depose_nom text, cabinet_nom text, jointe_le timestamptz, achat uuid, achat_ref text, ecriture_piece text, fichier uuid)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select 'document', d.id, d.rubrique, d.categorie, d.periode, d.titre, d.nom, d.type, d.taille, d.depose_le, u.nom, o.nom,
         case when d.classee_raison = 'jointe' then d.classee_le end, a.id, a.ref_v10, e.piece, null::uuid
    from cabinet.document d
    join socle.organisation o on o.id = d.cabinet
    left join socle.utilisateur u on u.id = d.depose_par
    left join compta.ecriture e on e.id = d.jointe_ecriture and e.entreprise = d.entreprise
    left join achats.piece a on a.entreprise = d.entreprise and e.origine_type = 'achat' and a.id = e.origine
   where d.entreprise = p_entreprise and d.remplace_par is null and messagerie.cote_entreprise(p_entreprise)
  union all
  select 'message', m.id, 'piece', null, null, fi.nom, fi.nom, fi.type, length(fi.contenu), m.ecrit_le, null, o.nom,
         m.classee_le, a.id, a.ref_v10, e.piece, fi.id
    from messagerie.message m
    join messagerie.fichier fi on fi.id = m.fichier
    join socle.organisation o on o.id = m.cabinet
    join compta.ecriture e on e.id = m.jointe_ecriture and e.entreprise = m.entreprise
    left join achats.piece a on a.entreprise = m.entreprise and e.origine_type = 'achat' and a.id = e.origine
   where m.entreprise = p_entreprise and m.classee_raison = 'jointe' and messagerie.cote_entreprise(p_entreprise)
$$;
revoke all on function cabinet.ce_que_mon_cabinet_a_range(uuid) from public;
grant execute on function cabinet.ce_que_mon_cabinet_a_range(uuid) to skanfact_app;

-- Un document de son cabinet, pour le client : son contenu.
create function cabinet.document_pour_le_client(p_entreprise uuid, p_document uuid) returns table (nom text, type text, contenu bytea)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.nom, d.type, d.contenu from cabinet.document d
   where d.entreprise = p_entreprise and d.id = p_document and messagerie.cote_entreprise(p_entreprise)
$$;
revoke all on function cabinet.document_pour_le_client(uuid, uuid) from public;
grant execute on function cabinet.document_pour_le_client(uuid, uuid) to skanfact_app;

-- Le client a-t-il coupé la lecture de ses pièces par l'IA (company.lectureIA) ? Le cabinet ne lit pas la fiche de la
-- société (0151) : il n'en apprend que ce réglage, pour un dossier de son portefeuille.
create function cabinet.lecture_ia_coupee(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select d.contenu->'lectureIA' = 'false'::jsonb from socle.dossier_v10 d
                    where d.entreprise = p_entreprise and d.collection = '_racine' and d.cle = 'company'), false)
   where p_entreprise in (select socle.mes_entreprises())
$$;
revoke all on function cabinet.lecture_ia_coupee(uuid) from public;
grant execute on function cabinet.lecture_ia_coupee(uuid) to skanfact_app;
