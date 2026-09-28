-- 0003 — L'équipe et la trace de tout (cadrage : 03-droits.md D4 à D7, § 7 ; 01 R10, § 4 `invitation`).
--
-- Les rôles ne s'écrivent QUE par ces fonctions, qui appliquent les règles :
--   D4 : une entreprise a toujours un propriétaire ; on ne retire pas le dernier, on transfère, et
--        le nouveau propriétaire doit accepter ;
--   D5 : tout invité reçoit ce qu'on lui donne, jamais plus ;
--   D6 : personne ne se donne un droit à soi-même ; un administrateur invite jusqu'à
--        administrateur, jamais un propriétaire, et ne touche ni à son rôle ni à celui du
--        propriétaire.
-- Chaque geste laisse sa trace dans `socle.audit`, qui ne se modifie ni ne s'efface.

-- ── Mes rôles dans une entreprise (D7 : l'union de mes rôles) ────────────────────────────────────
create function socle.mes_roles(p_entreprise uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce(array_agg(distinct r), '{}') from (
    select unnest(m.roles) r from socle.membre m
     where m.utilisateur = socle.moi() and m.actif and m.entreprise = p_entreprise
    union all
    select unnest(m.roles) from socle.membre m join socle.entreprise e on e.organisation = m.organisation
     where m.utilisateur = socle.moi() and m.actif and e.id = p_entreprise
       and exists (select 1 from socle.organisation o where o.id = e.organisation and o.type <> 'cabinet')
  ) t
$$;

-- ── La piste d'audit (01 R10, 03 § 7) ────────────────────────────────────────────────────────────
-- Découpée par mois ; une partition par défaut garde toute ligne qui tomberait hors des mois créés
-- (une trace ne se perd jamais).
create table socle.audit (
  id uuid not null default socle.uuidv7(),
  instant timestamptz not null default now(),
  entreprise uuid,                 -- vide pour un geste personnel (se connecter, ses appareils)
  utilisateur uuid,                -- vide pour un geste d'une clé d'API (plus tard)
  appareil uuid,
  geste text not null,
  objet_type text,
  objet_id uuid,
  avant jsonb,
  apres jsonb,
  lecture boolean not null default false,   -- les lectures des données sensibles (D10)
  primary key (id, instant)
) partition by range (instant);

create table socle.audit_defaut partition of socle.audit default;
-- Chaque partition a aussi sa sécurité, sans aucune règle : on ne la lit jamais en direct, seulement
-- par la table mère (et ses règles).
alter table socle.audit_defaut enable row level security;
alter table socle.audit_defaut force row level security;

create function socle.creer_partitions_audit(p_debut date, p_mois int) returns void
language plpgsql volatile as $$
declare d date := date_trunc('month', p_debut)::date; i int; nom text;
begin
  for i in 0 .. p_mois - 1 loop
    nom := 'audit_' || to_char(d + (i || ' months')::interval, 'YYYY_MM');
    execute format('create table if not exists socle.%I partition of socle.audit for values from (%L) to (%L)',
      nom, d + (i || ' months')::interval, d + ((i + 1) || ' months')::interval);
    execute format('alter table socle.%I enable row level security', nom);
    execute format('alter table socle.%I force row level security', nom);
  end loop;
end $$;
select socle.creer_partitions_audit(date '2026-09-01', 24);

create index audit_entreprise on socle.audit (entreprise, instant);
create index audit_utilisateur on socle.audit (utilisateur, instant);

-- Qui lit la trace (03 § 7) : le propriétaire et l'administrateur, toute celle de l'entreprise ;
-- chacun, sa propre activité.
alter table socle.audit enable row level security;
alter table socle.audit force row level security;
create policy lire on socle.audit for select using (
  utilisateur = socle.moi()
  or (entreprise in (select socle.mes_entreprises())
      and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]));
-- On n'écrit que sa propre trace, dans une entreprise qu'on voit (ou sans entreprise).
create policy ecrire on socle.audit for insert with check (
  utilisateur = socle.moi() and (entreprise is null or entreprise in (select socle.mes_entreprises())));

-- Ni modifiée ni effacée, même par le propriétaire des tables (seul un super-utilisateur, en
-- exploitation, pourrait passer outre, et cela se verrait).
create function socle.refuser_modification() returns trigger
language plpgsql as $$
begin
  raise exception 'la trace ne se modifie pas et ne s''efface pas (01 R10)' using errcode = '42501';
end $$;
create trigger audit_intouchable before update or delete on socle.audit
  for each row execute function socle.refuser_modification();

grant select, insert on socle.audit to skanfact_app;

-- Écrire une trace depuis une fonction de la base (au nom de moi()).
create function socle.tracer(p_entreprise uuid, p_geste text, p_objet_type text, p_objet_id uuid, p_avant jsonb, p_apres jsonb)
returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.audit (entreprise, utilisateur, geste, objet_type, objet_id, avant, apres)
  values (p_entreprise, socle.moi(), p_geste, p_objet_type, p_objet_id, p_avant, p_apres)
$$;

-- ── Les invitations (01 § 4) ─────────────────────────────────────────────────────────────────────
create table socle.invitation (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  email text not null,
  roles text[] not null,
  jeton_empreinte text not null unique,
  invite_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  acceptee_le timestamptz,
  annulee_le timestamptz
);
alter table socle.invitation enable row level security;
alter table socle.invitation force row level security;
-- Les invitations se voient par ceux qui gèrent l'équipe. Elles n'exposent jamais la liste des
-- membres à l'invité (01 § 4).
create policy lire on socle.invitation for select using (
  entreprise in (select socle.mes_entreprises())
  and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]);
grant select on socle.invitation to skanfact_app;

-- Le transfert de propriété, en attente de l'acceptation du nouveau propriétaire (D4).
create table socle.transfert_propriete (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  de uuid not null references socle.utilisateur(id),
  vers uuid not null references socle.utilisateur(id),
  demande_le timestamptz not null default now(),
  accepte_le timestamptz,
  annule_le timestamptz
);
create unique index un_transfert_ouvert on socle.transfert_propriete (entreprise) where accepte_le is null and annule_le is null;
alter table socle.transfert_propriete enable row level security;
alter table socle.transfert_propriete force row level security;
create policy lire on socle.transfert_propriete for select using (de = socle.moi() or vers = socle.moi());
grant select on socle.transfert_propriete to skanfact_app;

-- ── Les règles de l'équipe ───────────────────────────────────────────────────────────────────────
-- Les rôles qu'on peut donner dans une entreprise (le propriétaire ne se donne pas : il se transfère).
create function socle.roles_donnables(p_entreprise uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, socle as $$
  select case
    when 'proprietaire' = any(socle.mes_roles(p_entreprise)) then
      array['administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture']
    when 'administrateur' = any(socle.mes_roles(p_entreprise)) then
      array['administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture']
    else array[]::text[] end
$$;

create function socle.refus(p_message text) returns void
language plpgsql as $$ begin raise exception '%', p_message using errcode = '42501'; end $$;

-- Inviter quelqu'un : rend l'identifiant de l'invitation. Le jeton (dans le lien envoyé) est fait
-- par le serveur ; la base n'en garde que l'empreinte.
create function socle.inviter(p_entreprise uuid, p_email text, p_roles text[], p_jeton_empreinte text, p_expire_le timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if cardinality(socle.roles_donnables(p_entreprise)) = 0 then
    perform socle.refus('ton rôle ne permet pas d''inviter quelqu''un dans l''équipe');
  end if;
  if cardinality(p_roles) = 0 or not (p_roles <@ socle.roles_donnables(p_entreprise)) then
    perform socle.refus('tu ne peux pas donner ce rôle');
  end if;
  if lower(trim(p_email)) = (select lower(email) from socle.utilisateur where id = socle.moi()) then
    perform socle.refus('personne ne s''invite soi-même');
  end if;
  insert into socle.invitation (entreprise, email, roles, jeton_empreinte, invite_par, expire_le)
  values (p_entreprise, lower(trim(p_email)), p_roles, p_jeton_empreinte, socle.moi(), p_expire_le)
  returning id into v;
  perform socle.tracer(p_entreprise, 'socle.equipe.inviter', 'invitation', v, null,
    jsonb_build_object('email', lower(trim(p_email)), 'roles', p_roles));
  return v;
end $$;

-- Accepter une invitation : il faut être connecté avec la MÊME adresse que l'invitation.
create function socle.accepter_invitation(p_jeton_empreinte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i record; v_membre uuid; v_email text;
begin
  select email into v_email from socle.utilisateur where id = socle.moi();
  select * into i from socle.invitation where jeton_empreinte = p_jeton_empreinte for update;
  if not found or i.acceptee_le is not null or i.annulee_le is not null or i.expire_le <= p_maintenant then
    perform socle.refus('cette invitation n''est plus valable : demande-en une nouvelle');
  end if;
  if lower(v_email) <> i.email then
    perform socle.refus('cette invitation a été envoyée à une autre adresse');
  end if;
  -- Le propriétaire ne perd jamais son rôle par une invitation (D4).
  if exists (select 1 from socle.membre where utilisateur = socle.moi() and entreprise = i.entreprise and actif and 'proprietaire' = any(roles)) then
    perform socle.refus('tu es le propriétaire de cette entreprise : ton rôle ne change pas par une invitation');
  end if;
  insert into socle.membre (utilisateur, entreprise, roles, invite_par)
  values (socle.moi(), i.entreprise, i.roles, i.invite_par)
  on conflict (utilisateur, entreprise) where entreprise is not null
  do update set roles = excluded.roles, actif = true
  returning id into v_membre;
  update socle.invitation set acceptee_le = p_maintenant where id = i.id;
  perform socle.tracer(i.entreprise, 'socle.equipe.accepter', 'membre', v_membre, null, jsonb_build_object('roles', i.roles));
  return v_membre;
end $$;

-- Changer les rôles d'un membre (D6).
create function socle.changer_roles(p_membre uuid, p_roles text[]) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m record;
begin
  select * into m from socle.membre where id = p_membre and entreprise is not null for update;
  if not found or m.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('membre introuvable'); end if;
  if m.utilisateur = socle.moi() then perform socle.refus('personne ne change son propre rôle'); end if;
  if 'proprietaire' = any(m.roles) then perform socle.refus('le rôle du propriétaire ne se change pas : il se transfère'); end if;
  if cardinality(p_roles) = 0 or not (p_roles <@ socle.roles_donnables(m.entreprise)) then
    perform socle.refus('tu ne peux pas donner ce rôle');
  end if;
  update socle.membre set roles = p_roles where id = p_membre;
  perform socle.tracer(m.entreprise, 'socle.equipe.changer_role', 'membre', p_membre,
    jsonb_build_object('roles', m.roles), jsonb_build_object('roles', p_roles));
end $$;

-- Retirer un membre : l'accès tombe aussitôt, tout ce qu'il a fait reste signé de son nom (03 § 6).
create function socle.retirer_membre(p_membre uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m record;
begin
  select * into m from socle.membre where id = p_membre and entreprise is not null for update;
  if not found or m.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('membre introuvable'); end if;
  if 'proprietaire' = any(m.roles) then
    perform socle.refus('on ne retire pas le propriétaire : il transfère d''abord la propriété');
  end if;
  if m.utilisateur <> socle.moi() and cardinality(socle.roles_donnables(m.entreprise)) = 0 then
    perform socle.refus('ton rôle ne permet pas de retirer un membre');
  end if;
  if 'administrateur' = any(m.roles) and m.utilisateur <> socle.moi()
     and not ('proprietaire' = any(socle.mes_roles(m.entreprise)) or 'administrateur' = any(socle.mes_roles(m.entreprise))) then
    perform socle.refus('ton rôle ne permet pas de retirer un administrateur');
  end if;
  update socle.membre set actif = false where id = p_membre;
  perform socle.tracer(m.entreprise, 'socle.equipe.retirer', 'membre', p_membre, jsonb_build_object('roles', m.roles, 'actif', true), jsonb_build_object('actif', false));
end $$;

-- Transférer la propriété : demandé par le propriétaire, vers un membre actif ; il doit accepter.
create function socle.demander_transfert(p_entreprise uuid, p_vers uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if not ('proprietaire' = any(socle.mes_roles(p_entreprise))) then
    perform socle.refus('seul le propriétaire transfère la propriété');
  end if;
  if not exists (select 1 from socle.membre where entreprise = p_entreprise and utilisateur = p_vers and actif) then
    perform socle.refus('la propriété se transfère à un membre de l''équipe');
  end if;
  if p_vers = socle.moi() then perform socle.refus('tu es déjà le propriétaire'); end if;
  -- Une nouvelle demande remplace celle qui attendait encore.
  update socle.transfert_propriete set annule_le = now() where entreprise = p_entreprise and accepte_le is null and annule_le is null;
  insert into socle.transfert_propriete (entreprise, de, vers) values (p_entreprise, socle.moi(), p_vers) returning id into v;
  perform socle.tracer(p_entreprise, 'socle.propriete.demander_transfert', 'transfert_propriete', v, null, jsonb_build_object('vers', p_vers));
  return v;
end $$;

-- Accepter : l'ancien propriétaire devient administrateur (il n'est pas enfermé dehors, D4).
create function socle.accepter_transfert(p_transfert uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare t record;
begin
  select * into t from socle.transfert_propriete where id = p_transfert for update;
  if not found or t.vers <> socle.moi() or t.accepte_le is not null or t.annule_le is not null then
    perform socle.refus('ce transfert n''est plus valable');
  end if;
  -- Il faut être encore membre, et que le demandeur soit encore le propriétaire : sinon
  -- l'entreprise resterait sans propriétaire (D4).
  if not exists (select 1 from socle.membre where entreprise = t.entreprise and utilisateur = t.vers and actif)
     or not exists (select 1 from socle.membre where entreprise = t.entreprise and utilisateur = t.de and actif and 'proprietaire' = any(roles)) then
    perform socle.refus('ce transfert n''est plus valable');
  end if;
  update socle.membre set roles = array['administrateur'] where entreprise = t.entreprise and utilisateur = t.de and 'proprietaire' = any(roles);
  update socle.membre set roles = array(select distinct r from unnest(array_append(roles, 'proprietaire')) r)
   where entreprise = t.entreprise and utilisateur = t.vers and actif;
  update socle.transfert_propriete set accepte_le = p_maintenant where id = t.id;
  perform socle.tracer(t.entreprise, 'socle.propriete.accepter_transfert', 'transfert_propriete', t.id,
    jsonb_build_object('proprietaire', t.de), jsonb_build_object('proprietaire', t.vers));
end $$;

revoke execute on function socle.mes_roles(uuid), socle.tracer(uuid, text, text, uuid, jsonb, jsonb), socle.roles_donnables(uuid),
  socle.inviter(uuid, text, text[], text, timestamptz), socle.accepter_invitation(text, timestamptz),
  socle.changer_roles(uuid, text[]), socle.retirer_membre(uuid), socle.demander_transfert(uuid, uuid),
  socle.accepter_transfert(uuid, timestamptz), socle.creer_partitions_audit(date, int) from public;
grant execute on function socle.mes_roles(uuid), socle.tracer(uuid, text, text, uuid, jsonb, jsonb), socle.roles_donnables(uuid),
  socle.inviter(uuid, text, text[], text, timestamptz), socle.accepter_invitation(text, timestamptz),
  socle.changer_roles(uuid, text[]), socle.retirer_membre(uuid), socle.demander_transfert(uuid, uuid),
  socle.accepter_transfert(uuid, timestamptz) to skanfact_app;

-- ── Le code sur le téléphone se juge à chaque requête (03 § 6) ───────────────────────────────────
-- Une session ouverte AVANT de recevoir un rôle qui exige le code (créer son entreprise, accepter
-- une invitation d'administrateur, être promu) ne garde pas l'accès sans code : le serveur le
-- redemande à chaque requête, au lieu de s'en tenir à ce qui était vrai à la connexion.
create function socle.code_manquant() returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select u.code_methode is null from socle.utilisateur u where u.id = socle.moi()), false)
     and exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['proprietaire', 'administrateur', 'paie', 'supervision', 'revision', 'saisie']::text[])
$$;
revoke execute on function socle.code_manquant() from public;
grant execute on function socle.code_manquant() to skanfact_app;
