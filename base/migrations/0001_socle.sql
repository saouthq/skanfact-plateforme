-- 0001 — Le socle : qui est qui, et qui voit quoi (cadrage : docs/cadrage/01-modele-de-donnees.md § 4,
-- docs/cadrage/03-droits.md D1 et § 9, dans le dépôt saouthq/skanfact).
--
-- La règle qui compte ici (01 R2, 03 D1) : **la base elle-même** refuse de montrer une ligne à qui
-- n'y a pas droit. Le programme serveur se connecte avec le rôle `skanfact_app`, qui ne passe jamais
-- au-dessus de la sécurité par ligne, et dit à chaque transaction QUI agit (`app.utilisateur`). Sans
-- ce nom, il ne voit rien.

create schema socle;

-- ── Les identifiants : UUID version 7 (01 R1) ────────────────────────────────────────────────────
-- Ordonnés dans le temps, créés d'ordinaire par le poste. Celle-ci sert quand le serveur crée.
create function socle.uuidv7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
        from 1 for 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

-- ── Les tables ───────────────────────────────────────────────────────────────────────────────────

-- Une organisation : un groupe, un cabinet, ou une entreprise seule (01 § 4 : un seul chemin).
create table socle.organisation (
  id uuid primary key default socle.uuidv7(),
  type text not null check (type in ('groupe', 'cabinet', 'independant')),
  nom text not null check (length(trim(nom)) > 0),
  -- Le code qu'un cabinet donne à ses clients (00) : court, unique.
  code_cabinet text unique check (code_cabinet is null or code_cabinet ~ '^[A-Z0-9]{6,10}$'),
  cree_le timestamptz not null default now(),
  check (type = 'cabinet' or code_cabinet is null)
);

-- Une entreprise : une société, un matricule fiscal, une comptabilité.
create table socle.entreprise (
  id uuid primary key default socle.uuidv7(),
  organisation uuid not null references socle.organisation(id),
  raison_sociale text not null check (length(trim(raison_sociale)) > 0),
  forme_juridique text,
  -- Matricule fiscal tunisien : 7 chiffres, une lettre de contrôle, puis code TVA, catégorie et
  -- établissement (ex. 1234567A/A/M/000). Le contrôle fin (lettre de contrôle) est dans le moteur.
  matricule_fiscal text check (matricule_fiscal is null or matricule_fiscal ~ '^[0-9]{7}[A-Z]/?[A-Z]/?[A-Z]/?[0-9]{3}$'),
  devise_base char(3) not null default 'TND' check (devise_base ~ '^[A-Z]{3}$'),
  fuseau text not null default 'Africa/Tunis',
  -- Début d'exercice : un jour de calendrier, jamais un instant (01 R5).
  debut_exercice_mois smallint not null default 1 check (debut_exercice_mois between 1 and 12),
  debut_sur_skanfact date not null default current_date,
  active boolean not null default true,
  cree_le timestamptz not null default now()
);
-- Deux comptes actifs pour la même société : une erreur signalée, pas un refus silencieux (01 § 4).
-- La base, elle, refuse le doublon ; l'écran dira qui tient déjà ce matricule.
create unique index entreprise_matricule_actif on socle.entreprise (matricule_fiscal)
  where active and matricule_fiscal is not null;

create table socle.etablissement (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  code text not null,
  nom text not null,
  type text not null default 'siege' check (type in ('siege', 'point_de_vente', 'depot', 'succursale')),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (entreprise, code)
);

-- Une personne, un compte, pour toutes ses entreprises et tous ses cabinets.
create table socle.utilisateur (
  id uuid primary key default socle.uuidv7(),
  email text not null,
  nom text not null,
  telephone text,
  telephone_verifie_le timestamptz,
  langue text not null default 'fr' check (langue in ('fr', 'en')),
  empreinte_mot_de_passe text,
  cree_le timestamptz not null default now()
);
create unique index utilisateur_email on socle.utilisateur (lower(email));

-- Les rôles (03 § 2 et § 3). Un membre est rattaché à une organisation OU à une entreprise.
create table socle.membre (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  organisation uuid references socle.organisation(id),
  entreprise uuid references socle.entreprise(id),
  roles text[] not null check (cardinality(roles) > 0 and roles <@ array[
    -- dans une entreprise (03 § 2)
    'proprietaire', 'administrateur', 'commercial', 'caissier', 'serveur', 'magasinier',
    'comptabilite_interne', 'paie', 'lecture',
    -- dans un cabinet (03 § 3)
    'supervision', 'revision', 'saisie'
  ]::text[]),
  -- Établissements autorisés : vide = tous (01 § 4).
  etablissements uuid[] not null default '{}',
  actif boolean not null default true,
  invite_par uuid references socle.utilisateur(id),
  depuis timestamptz not null default now(),
  check ((organisation is null) <> (entreprise is null))
);
create unique index membre_unique_entreprise on socle.membre (utilisateur, entreprise) where entreprise is not null;
create unique index membre_unique_organisation on socle.membre (utilisateur, organisation) where organisation is not null;
-- Un seul propriétaire actif par entreprise (01 § 4, 03 D4).
create unique index membre_un_proprietaire on socle.membre (entreprise)
  where actif and entreprise is not null and 'proprietaire' = any(roles);

-- Le mandat : un cabinet sur une entreprise cliente, accordé par le client (01 § 4, 03 § 3.4).
create table socle.mandat (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  accorde_par uuid references socle.utilisateur(id),
  debut date not null,
  fin date,
  -- Périmètre : la paie est décochée par défaut (03 § 3.4, D5).
  perimetre text[] not null default array['comptabilite', 'declarations', 'saisie_achats']
    check (perimetre <@ array['comptabilite', 'declarations', 'saisie_achats', 'paie']::text[]),
  statut text not null default 'propose' check (statut in ('propose', 'actif', 'termine')),
  cree_le timestamptz not null default now(),
  check (fin is null or fin >= debut)
);

-- Qui, dans le cabinet, tient quel dossier (03 § 3 : un rôle sur un dossier l'emporte).
create table socle.mandat_affectation (
  mandat uuid not null references socle.mandat(id),
  membre uuid not null references socle.membre(id),
  role text not null check (role in ('supervision', 'revision', 'saisie', 'paie')),
  primary key (mandat, membre)
);

-- Un poste ou un navigateur installé (hors ligne, révocation : 04 § 7).
create table socle.appareil (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  nom text not null,
  type text not null check (type in ('navigateur', 'bureau', 'telephone')),
  premier_vu timestamptz not null default now(),
  dernier_vu timestamptz,
  reconnu_jusqu_au timestamptz,
  revoque_le timestamptz,
  cle_publique text
);

-- La trace des migrations appliquées (base/migrer.ts). Une migration appliquée ne change plus.
create table socle.migration (
  numero int primary key,
  nom text not null,
  empreinte text not null,
  appliquee_le timestamptz not null default now()
);

-- ── Qui agit : le nom posé par le serveur au début de chaque transaction ─────────────────────────
create function socle.moi() returns uuid
language sql stable as $$
  select nullif(current_setting('app.utilisateur', true), '')::uuid
$$;

-- Les fonctions qui suivent lisent les tables du socle pour décider ; elles s'exécutent avec les
-- droits de leur propriétaire (sinon la règle d'une table se relirait elle-même sans fin). Elles
-- ne rendent que des identifiants, et toujours pour `socle.moi()`, jamais pour un autre.

-- Les organisations dont je suis membre actif.
create function socle.mes_organisations() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select m.organisation from socle.membre m
   where m.utilisateur = socle.moi() and m.actif and m.organisation is not null
$$;

-- Les entreprises que je vois (03 D1, première question) :
--   1. je suis membre de l'entreprise ;
--   2. je suis membre de son organisation (un groupe) ;
--   3. je suis dans un cabinet qui a un mandat ACTIF sur elle, à la date du jour, et je supervise
--      le cabinet ou le dossier m'est confié.
create function socle.mes_entreprises() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select m.entreprise from socle.membre m
   where m.utilisateur = socle.moi() and m.actif and m.entreprise is not null
  union
  select e.id from socle.entreprise e
   where e.organisation in (select socle.mes_organisations())
     and exists (select 1 from socle.organisation o where o.id = e.organisation and o.type <> 'cabinet')
  union
  select d.entreprise from socle.mandat d
    join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
   where d.statut = 'actif'
     and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
     and ('supervision' = any(m.roles)
          or exists (select 1 from socle.mandat_affectation a where a.mandat = d.id and a.membre = m.id))
$$;

-- Les personnes que je peux voir : moi, et celles qui partagent une entreprise ou une organisation
-- avec moi (l'équipe). Jamais tout l'annuaire.
create function socle.mes_collegues() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select socle.moi()
  union
  select m.utilisateur from socle.membre m
   where m.entreprise in (select socle.mes_entreprises())
      or m.organisation in (select socle.mes_organisations())
$$;

-- ── La sécurité par ligne ────────────────────────────────────────────────────────────────────────
-- FORCE : elle s'applique aussi au propriétaire des tables. Seul un super-utilisateur (les
-- migrations, l'exploitation) passe au-dessus ; le serveur ne l'est jamais.
alter table socle.organisation enable row level security;
alter table socle.organisation force row level security;
create policy visible on socle.organisation
  using (id in (select socle.mes_organisations())
         or id in (select e.organisation from socle.entreprise e where e.id in (select socle.mes_entreprises())));

alter table socle.entreprise enable row level security;
alter table socle.entreprise force row level security;
create policy visible on socle.entreprise
  using (id in (select socle.mes_entreprises()));

alter table socle.etablissement enable row level security;
alter table socle.etablissement force row level security;
create policy visible on socle.etablissement
  using (entreprise in (select socle.mes_entreprises()));

alter table socle.utilisateur enable row level security;
alter table socle.utilisateur force row level security;
create policy visible on socle.utilisateur
  using (id in (select socle.mes_collegues()));

alter table socle.membre enable row level security;
alter table socle.membre force row level security;
create policy visible on socle.membre
  using (entreprise in (select socle.mes_entreprises())
         or organisation in (select socle.mes_organisations()));

alter table socle.mandat enable row level security;
alter table socle.mandat force row level security;
create policy visible on socle.mandat
  using (entreprise in (select socle.mes_entreprises())
         or cabinet in (select socle.mes_organisations()));

alter table socle.mandat_affectation enable row level security;
alter table socle.mandat_affectation force row level security;
create policy visible on socle.mandat_affectation
  using (mandat in (select d.id from socle.mandat d
                     where d.entreprise in (select socle.mes_entreprises())
                        or d.cabinet in (select socle.mes_organisations())));

-- Ses appareils, on ne voit que les siens.
alter table socle.appareil enable row level security;
alter table socle.appareil force row level security;
create policy visible on socle.appareil
  using (utilisateur = socle.moi());

-- ── Les deux gestes qui ne peuvent pas passer par la règle ordinaire ─────────────────────────────
-- Créer son compte : personne n'est encore « moi ». Le serveur l'appelle à l'inscription.
create function socle.creer_utilisateur(p_email text, p_nom text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  insert into socle.utilisateur (email, nom) values (lower(trim(p_email)), trim(p_nom)) returning id into v;
  return v;
end $$;

-- Créer son entreprise : on n'en est pas encore membre, la règle ordinaire refuserait. Le créateur
-- en devient le propriétaire (03 D5), avec le siège (01 § 4 : au moins un établissement).
create function socle.creer_entreprise(p_raison_sociale text, p_matricule_fiscal text default null)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid;
begin
  if socle.moi() is null then
    raise exception 'personne n''est connecté : impossible de créer une entreprise' using errcode = '42501';
  end if;
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal)
    values (v_org, p_raison_sociale, p_matricule_fiscal) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.membre (utilisateur, entreprise, roles) values (socle.moi(), v_ent, array['proprietaire']);
  return v_ent;
end $$;

-- ── Le rôle du serveur ───────────────────────────────────────────────────────────────────────────
-- Sans connexion ni mot de passe ici : l'exploitation crée le compte de connexion du serveur et le
-- rattache à ce rôle (jamais de secret dans le dépôt). Il ne passe jamais au-dessus de la sécurité
-- par ligne, et il ne touche pas à la trace des migrations.
do $$ begin
  if not exists (select from pg_roles where rolname = 'skanfact_app') then
    create role skanfact_app;
  end if;
end $$;
-- Le rôle peut exister d'avant (il vaut pour tout le serveur PostgreSQL, pas pour une base) : on
-- remet toujours ses attributs d'aplomb, au lieu de croire ce qu'on trouve.
alter role skanfact_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
grant usage on schema socle to skanfact_app;
grant select, insert, update on socle.organisation, socle.entreprise, socle.etablissement,
  socle.utilisateur, socle.membre, socle.mandat, socle.appareil to skanfact_app;
grant select, insert, delete on socle.mandat_affectation to skanfact_app;
grant execute on function socle.moi(), socle.mes_organisations(), socle.mes_entreprises(),
  socle.mes_collegues(), socle.uuidv7(), socle.creer_utilisateur(text, text),
  socle.creer_entreprise(text, text) to skanfact_app;
-- Une fonction se lance par tout le monde tant qu'on ne l'a pas retiré : on le retire.
revoke execute on function socle.creer_utilisateur(text, text), socle.creer_entreprise(text, text),
  socle.mes_organisations(), socle.mes_entreprises(), socle.mes_collegues() from public;
revoke all on socle.migration from skanfact_app;
