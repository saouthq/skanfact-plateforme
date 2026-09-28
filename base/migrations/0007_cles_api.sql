-- Les clés de l'API (03 § 8, 14 § 2.5, 01 § 17) : une clé se traite comme une personne.
--   - elle appartient à UNE entreprise et porte une liste de gestes, comme un rôle ;
--   - seuls le propriétaire et l'administrateur la créent ; elle ne se montre qu'une fois (la base
--     n'en garde que l'empreinte), elle expire, elle se révoque ;
--   - ses gestes passent par la même porte, et leur trace porte la clé (et, par elle, qui l'a créée).
--
-- Une clé qui agit pose `app.cle_api` (et jamais `app.utilisateur`) pour sa transaction : elle ne
-- voit que son entreprise, tant qu'elle n'est ni révoquée ni expirée.

create table socle.cle_api (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  nom text not null check (length(trim(nom)) between 1 and 100),
  -- Le début de la clé, pour la reconnaître dans une liste (« skf_Ab3dE6… ») ; jamais la clé.
  prefixe text not null check (prefixe ~ '^skf_[A-Za-z0-9_-]{6}$'),
  empreinte text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  gestes text[] not null check (cardinality(gestes) > 0),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  revoquee_le timestamptz,
  revoquee_par uuid references socle.utilisateur(id),
  derniere_utilisation timestamptz,
  check (expire_le > cree_le)
);
create index cle_api_entreprise on socle.cle_api (entreprise);
alter table socle.cle_api enable row level security;
alter table socle.cle_api force row level security;
-- Seuls ceux qui gèrent les clés les voient (le propriétaire et l'administrateur).
create policy visible on socle.cle_api for select
  using (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']);
grant select (id, entreprise, nom, prefixe, gestes, cree_par, cree_le, expire_le, revoquee_le, revoquee_par, derniere_utilisation)
  on socle.cle_api to skanfact_app;

-- La clé qui agit dans cette transaction (posée par le serveur, comme `app.utilisateur`).
create function socle.ma_cle() returns uuid
language sql stable as $$
  select nullif(current_setting('app.cle_api', true), '')::uuid
$$;
grant execute on function socle.ma_cle() to skanfact_app;

-- La trace porte la clé qui a agi.
alter table socle.audit add column cle_api uuid;

create or replace function socle.tracer(p_entreprise uuid, p_geste text, p_objet_type text, p_objet_id uuid, p_avant jsonb, p_apres jsonb)
returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.audit (entreprise, utilisateur, cle_api, geste, objet_type, objet_id, avant, apres)
  values (p_entreprise, socle.moi(), socle.ma_cle(), p_geste, p_objet_type, p_objet_id, p_avant, p_apres)
$$;

-- Les entreprises que je vois : celles de la personne, et celle de la clé qui agit, si elle est
-- encore valable.
create or replace function socle.mes_entreprises() returns setof uuid
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
  union
  select k.entreprise from socle.cle_api k
   where k.id = socle.ma_cle() and k.revoquee_le is null and k.expire_le > now()
$$;

-- Reconnaître une clé à son empreinte (avant toute transaction à son nom) : rend ce qu'il faut
-- pour agir, seulement si elle est valable, et note son dernier usage.
create function socle.cle_api_valable(p_empreinte text) returns table (id uuid, entreprise uuid, gestes text[], cree_par uuid)
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.cle_api k set derniere_utilisation = now()
   where k.empreinte = p_empreinte and k.revoquee_le is null and k.expire_le > now()
  returning k.id, k.entreprise, k.gestes, k.cree_par
$$;

-- Créer une clé : seuls le propriétaire et l'administrateur. (Que chaque geste soit permis à celui
-- qui crée la clé, le serveur le vérifie avec la porte, qui connaît les gestes ; la base vérifie le
-- rôle.)
create function socle.creer_cle_api(p_entreprise uuid, p_nom text, p_prefixe text, p_empreinte text, p_gestes text[], p_expire_le timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les clés de l''API');
  end if;
  insert into socle.cle_api (entreprise, nom, prefixe, empreinte, gestes, cree_par, expire_le)
  values (p_entreprise, p_nom, p_prefixe, p_empreinte, p_gestes, socle.moi(), p_expire_le)
  returning id into v_id;
  perform socle.tracer(p_entreprise, 'socle.cle_api.creer', 'cle_api', v_id, null,
    jsonb_build_object('nom', p_nom, 'prefixe', p_prefixe, 'gestes', p_gestes, 'expire_le', p_expire_le));
  return v_id;
end $$;

create function socle.revoquer_cle_api(p_cle uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v socle.cle_api;
begin
  select * into v from socle.cle_api where id = p_cle;
  if v.id is null or not (v.entreprise in (select socle.mes_entreprises())) then perform socle.refus('clé introuvable'); end if;
  if not (socle.mes_roles(v.entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les clés de l''API');
  end if;
  if v.revoquee_le is not null then perform socle.refus('cette clé est déjà révoquée'); end if;
  update socle.cle_api set revoquee_le = now(), revoquee_par = socle.moi() where id = p_cle;
  perform socle.tracer(v.entreprise, 'socle.cle_api.revoquer', 'cle_api', p_cle, jsonb_build_object('nom', v.nom), null);
end $$;

revoke execute on function socle.cle_api_valable(text), socle.creer_cle_api(uuid, text, text, text, text[], timestamptz),
  socle.revoquer_cle_api(uuid) from public;
grant execute on function socle.cle_api_valable(text), socle.creer_cle_api(uuid, text, text, text, text[], timestamptz),
  socle.revoquer_cle_api(uuid) to skanfact_app;
