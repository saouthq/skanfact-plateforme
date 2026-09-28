-- Le dossier v10 d'une entreprise, tenu par le serveur (décision de Skander, 28/09/2026 : la
-- plateforme reprend le CODE de l'interface v10). L'interface travaille sur le dossier entier, comme
-- dans la v10 (ses clients, ses pièces, son catalogue, ses réglages…) ; le serveur en garde chaque
-- objet, le vérifie à chaque changement, et reste SEUL à numéroter et à émettre une facture : une
-- facture émise vit aussi dans ventes.piece (son numéro, ses montants en entiers, son maillon), et sa
-- copie dans le dossier ne peut plus changer ce qui y a été scellé.
--
--   - un objet d'une liste (un client, une pièce…) est une ligne : (collection, sa clé v10) ;
--   - une valeur seule du dossier (la fiche société, les compteurs…) est une ligne de la
--     collection « _racine », sous le nom du champ ;
--   - jamais un nombre à virgule en base (01 R3) : l'interface écrit un nombre non entier en texte
--     exact, { "~n": "450.5" }, et le relit en nombre ;
--   - chaque objet porte sa révision : un changement fait sur une version dépassée est refusé
--     (quelqu'un d'autre l'a modifié entre-temps), jamais écrasé.

create table socle.dossier_v10 (
  entreprise uuid not null references socle.entreprise(id),
  collection text not null check (collection ~ '^[A-Za-z_][A-Za-z0-9_]{0,60}$'),
  cle text not null check (length(cle) between 1 and 200),
  contenu jsonb not null check (socle.sans_virgule(contenu)),
  -- La place de l'objet dans sa liste : la v10 relit ses listes dans l'ordre où elle les a écrites.
  rang integer check (rang >= 0),
  revision bigint not null default 1 check (revision >= 1),
  modifie_le timestamptz not null default now(),
  modifie_par uuid references socle.utilisateur(id),
  primary key (entreprise, collection, cle)
);
alter table socle.dossier_v10 enable row level security;
alter table socle.dossier_v10 force row level security;
create policy visible on socle.dossier_v10 using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on socle.dossier_v10 to skanfact_app;

-- Le lien entre une pièce ou un client du dossier v10 et sa ligne du serveur : la clé v10 (l'identifiant
-- que l'interface lui a donné), une seule fois par entreprise.
alter table ventes.piece add column ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200);
create unique index piece_ref_v10 on ventes.piece (entreprise, ref_v10) where ref_v10 is not null;
alter table socle.tiers add column ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200);
create unique index tiers_ref_v10 on socle.tiers (entreprise, ref_v10) where ref_v10 is not null;

-- L'entreprise d'essai numérote comme la v10 (« FAC-2026-001 ») : le code de la v10 écrit ce préfixe,
-- et une entreprise d'essai qui annoncerait un numéro et en recevrait un autre mentirait à l'écran.
-- Son caractère d'essai se lit sur la marque de la barre (et se lira sur ses documents). Décidé par
-- délégation le 28/09/2026 ; remplace le préfixe « ESSAI » de 0009 pour les entreprises créées ensuite.
create or replace function socle.creer_entreprise_essai() returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid; v_nom text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if exists (select 1 from socle.entreprise e join socle.membre m on m.entreprise = e.id
              where e.essai and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles)) then
    perform socle.refus('tu as déjà une entreprise d''essai');
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into socle.organisation (type, nom) values ('independant', 'Essai de ' || v_nom) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, essai) values (v_org, 'Entreprise d''essai de ' || v_nom, true) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.membre (utilisateur, entreprise, roles) values (socle.moi(), v_ent, array['proprietaire']);
  insert into socle.serie (entreprise, type, prefixe, legale) values (v_ent, 'facture', 'FAC', true);
  insert into socle.tiers (entreprise, nature, raison_sociale, identifiant, type_identifiant, adresse, email) values
    (v_ent, 'societe', 'Menuiserie du Lac (exemple)', '1234567A', 'matricule', '12 rue du Lac, Tunis', 'contact@exemple.tn'),
    (v_ent, 'personne', 'Amel Ben Salah (exemple)', null, null, 'Sfax', null),
    (v_ent, 'etranger', 'Atelier Lumière (exemple)', null, null, 'Lyon', null);
  update socle.tiers set pays = 'FR', devise = 'EUR' where entreprise = v_ent and nature = 'etranger';
  perform socle.tracer(v_ent, 'socle.entreprise.creer', 'entreprise', v_ent, null, jsonb_build_object('essai', true));
  return v_ent;
end $$;
