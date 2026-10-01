-- Le retour à la caisse, avec le code d'un responsable (brique 124 ; 03 § 2.1 « Caisse » ; docs/caisse.md, T1 à T5).
-- Un client rapporte un article : un avoir s'établit sur le ticket (un ticket encaissé ne s'annule jamais, 01 R6), et
-- l'argent rendu sort du tiroir de la session ouverte. Le caissier fait le geste ; un propriétaire ou un administrateur
-- présent tape SON code de responsable sur le même poste ; l'avoir porte les deux noms.
--
-- Le code de responsable n'est pas le code de caisse (0062) : il n'ouvre AUCUNE session, il approuve un geste, sur
-- l'appareil de la caisse. Il se pose par la personne elle-même, se garde en empreinte, et se respecte comme lui
-- (5 erreurs, une attente).

create table caisse.code_responsable (
  entreprise uuid not null references socle.entreprise(id),
  utilisateur uuid not null references socle.utilisateur(id),
  empreinte text not null,
  pose_le timestamptz not null default now(),
  primary key (entreprise, utilisateur)
);
-- Personne ne lit les empreintes : seules les fonctions ci-dessous les touchent.
alter table caisse.code_responsable enable row level security;
alter table caisse.code_responsable force row level security;

create function caisse.est_responsable(p_entreprise uuid, p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.membre m where m.entreprise = p_entreprise and m.utilisateur = p_utilisateur and m.actif
                    and m.roles && array['proprietaire', 'administrateur']::text[])
$$;

-- Poser son propre code de responsable (moi seulement, propriétaire ou administrateur de l'entreprise).
create function caisse.poser_code_responsable(p_entreprise uuid, p_empreinte text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or not caisse.est_responsable(p_entreprise, socle.moi()) then
    raise exception 'Seul un responsable pose un code de responsable.' using errcode = '42501';
  end if;
  insert into caisse.code_responsable (entreprise, utilisateur, empreinte) values (p_entreprise, socle.moi(), p_empreinte)
  on conflict (entreprise, utilisateur) do update set empreinte = excluded.empreinte, pose_le = now();
end $$;

-- Les responsables qui approuvent à la caisse de cette entreprise (ceux qui ont posé leur code), pour un membre.
create function caisse.responsables(p_entreprise uuid) returns table (utilisateur uuid, nom text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.nom from caisse.code_responsable c join socle.utilisateur u on u.id = c.utilisateur
   where c.entreprise = p_entreprise and p_entreprise in (select socle.mes_entreprises())
     and caisse.est_responsable(p_entreprise, c.utilisateur)
   order by u.nom
$$;

-- L'empreinte d'un code de responsable, pour approuver un geste sur l'appareil qui tient la caisse. Rien sinon.
create function caisse.code_responsable_pour(p_entreprise uuid, p_utilisateur uuid, p_appareil uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle as $$
  select c.empreinte from caisse.code_responsable c
   where c.entreprise = p_entreprise and c.utilisateur = p_utilisateur
     and p_entreprise in (select socle.mes_entreprises())
     and caisse.est_responsable(p_entreprise, p_utilisateur)
     and exists (select 1 from caisse.caisse k where k.entreprise = p_entreprise and k.active and k.appareil = p_appareil)
$$;

-- La série des avoirs (AVO) pour un retour à la caisse : le caissier la prend aussi (il n'émet pas d'autre avoir : la
-- route des avoirs garde son geste). Créée au premier besoin, comme 0053 et 0056.
create function caisse.serie_retour(p_entreprise uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if p_entreprise not in (select socle.mes_entreprises())
     or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'caissier']::text[]) then
    perform socle.refus('ton rôle ne permet pas d''émettre une pièce');
  end if;
  select id into v from socle.serie where entreprise = p_entreprise and type = 'avoir' and prefixe = 'AVO' and legale and active;
  if found then return v; end if;
  insert into socle.serie (entreprise, type, prefixe, legale, remise, format)
  values (p_entreprise, 'avoir', 'AVO', true, 'annuelle', '{P}-{AAAA}-{N:3}')
  returning id into v;
  perform socle.tracer(p_entreprise, 'socle.serie.creer', 'serie', v, null,
    jsonb_build_object('type', 'avoir', 'prefixe', 'AVO', 'legale', true, 'par', 'retour'));
  return v;
end $$;

-- Le retour dans sa session : l'avoir, le ticket qu'il corrige, l'argent rendu (en entiers de la devise) et comment,
-- qui l'a fait et qui l'a approuvé. Le Z de la session le compte (l'argent rendu sort du tiroir).
create table caisse.retour (
  piece uuid primary key references ventes.piece(id),
  entreprise uuid not null references socle.entreprise(id),
  session uuid not null references caisse.session(id),
  ticket uuid not null references ventes.piece(id),
  montant bigint not null check (montant > 0),
  mode text not null check (mode in ('especes', 'carte', 'cheque')),
  fait_par uuid not null references socle.utilisateur(id),
  approuve_par uuid references socle.utilisateur(id),
  cree_le timestamptz not null default now()
);
create index retour_session on caisse.retour (session);
alter table caisse.retour enable row level security;
alter table caisse.retour force row level security;
create policy visible on caisse.retour using (entreprise in (select socle.mes_entreprises()));
grant select, insert on caisse.retour to skanfact_app;

revoke execute on function caisse.est_responsable(uuid, uuid), caisse.poser_code_responsable(uuid, text), caisse.responsables(uuid),
  caisse.code_responsable_pour(uuid, uuid, uuid), caisse.serie_retour(uuid) from public;
grant execute on function caisse.poser_code_responsable(uuid, text), caisse.responsables(uuid),
  caisse.code_responsable_pour(uuid, uuid, uuid), caisse.serie_retour(uuid) to skanfact_app;
