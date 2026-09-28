-- 0005 — La file d'opérations (cadrage : 04-hors-ligne-et-synchro.md § 4 à § 6, 01 § 17).
--
-- Chaque geste venu d'un poste est une opération : un identifiant créé sur le poste (envoyée deux
-- fois, elle ne compte qu'une fois), un numéro d'ordre propre à l'appareil (le serveur rejoue dans
-- l'ordre et voit s'il en manque une), l'instant sur le poste et l'instant de réception.
-- Une opération refusée ou mise de côté n'est jamais jetée : elle attend dans « À reprendre », qui
-- ne se vide que par un geste.

-- Où en est la file de chaque appareil.
create table socle.file_appareil (
  appareil uuid primary key references socle.appareil(id),
  utilisateur uuid not null references socle.utilisateur(id),
  dernier_ordre bigint not null default 0 check (dernier_ordre >= 0)
);
alter table socle.file_appareil enable row level security;
alter table socle.file_appareil force row level security;
create policy lire on socle.file_appareil for select using (utilisateur = socle.moi());
grant select on socle.file_appareil to skanfact_app;

-- À REVOIR à la mesure de charge (étape 2) : découper par mois, ou purger les opérations acceptées
-- après un délai, une fois décidé ce qu'on en garde (la trace, elle, garde tout).
create table socle.operation (
  id uuid primary key,                        -- créé sur le poste (UUIDv7)
  appareil uuid not null references socle.appareil(id),
  utilisateur uuid not null references socle.utilisateur(id),
  entreprise uuid references socle.entreprise(id),
  ordre bigint not null check (ordre >= 1),
  geste text not null,
  format int not null check (format >= 1),
  revision_vue bigint,
  instant_poste timestamptz not null,
  recu_le timestamptz not null default now(),
  -- L'horloge du poste s'écartait de plus de 5 minutes de celle du serveur (04 § 6).
  horloge_ecartee boolean not null default false,
  charge jsonb not null,
  statut text not null check (statut in ('acceptee', 'refusee', 'mise_de_cote', 'en_attente_decision')),
  motif text,
  resultat jsonb,
  resolue_le timestamptz,
  resolue_par uuid references socle.utilisateur(id),
  resolution text,
  unique (appareil, ordre),
  check (statut = 'acceptee' or motif is not null),
  check ((resolue_le is null) = (resolution is null))
);
create index operation_a_reprendre on socle.operation (entreprise, recu_le) where statut <> 'acceptee' and resolue_le is null;
alter table socle.operation enable row level security;
alter table socle.operation force row level security;
-- Chacun voit ses gestes ; le propriétaire et l'administrateur, ceux de toute l'entreprise.
create policy lire on socle.operation for select using (
  utilisateur = socle.moi()
  or (entreprise in (select socle.mes_entreprises())
      and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]));
grant select on socle.operation to skanfact_app;

-- Une opération notée ne se réécrit pas ; seule sa résolution s'ajoute, une fois.
create function socle.operation_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.resolue_le is null and new.resolue_le is not null
     and (to_jsonb(new) - 'resolue_le' - 'resolue_par' - 'resolution') = (to_jsonb(old) - 'resolue_le' - 'resolue_par' - 'resolution') then
    return new;
  end if;
  raise exception 'une opération reçue ne se modifie pas et ne s''efface pas' using errcode = '42501';
end $$;
create trigger operation_intouchable before update or delete on socle.operation
  for each row execute function socle.operation_intouchable();

-- Prendre la file d'un appareil : la ligne reste verrouillée jusqu'à la fin de la transaction
-- (les gestes d'un appareil passent un par un, dans l'ordre). Rend le dernier numéro traité.
create function socle.file_prendre(p_appareil uuid) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v bigint;
begin
  if not exists (select 1 from socle.appareil a where a.id = p_appareil and a.utilisateur = socle.moi() and a.revoque_le is null) then
    perform socle.refus('appareil inconnu ou révoqué');
  end if;
  insert into socle.file_appareil (appareil, utilisateur) values (p_appareil, socle.moi()) on conflict do nothing;
  select dernier_ordre into v from socle.file_appareil where appareil = p_appareil for update;
  return v;
end $$;

-- Une opération déjà reçue (même identifiant) : ce qui lui a été répondu.
create function socle.operation_recue(p_id uuid)
returns table (appareil uuid, ordre bigint, statut text, motif text, resultat jsonb)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select o.appareil, o.ordre, o.statut, o.motif, o.resultat from socle.operation o where o.id = p_id
$$;

-- Noter une opération traitée, et avancer la file de son appareil. Seulement le numéro suivant :
-- jamais un trou, jamais deux fois le même.
create function socle.noter_operation(
  p_id uuid, p_appareil uuid, p_entreprise uuid, p_ordre bigint, p_geste text, p_format int, p_revision_vue bigint,
  p_instant_poste timestamptz, p_charge jsonb, p_statut text, p_motif text, p_resultat jsonb
) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare dernier bigint; ecart boolean;
begin
  select f.dernier_ordre into dernier from socle.file_appareil f where f.appareil = p_appareil and f.utilisateur = socle.moi() for update;
  if not found then perform socle.refus('file introuvable'); end if;
  if p_ordre <> dernier + 1 then perform socle.refus(format('l''opération attendue porte le numéro %s', dernier + 1)); end if;
  ecart := abs(extract(epoch from (now() - p_instant_poste))) > 300;
  insert into socle.operation (id, appareil, utilisateur, entreprise, ordre, geste, format, revision_vue, instant_poste,
    horloge_ecartee, charge, statut, motif, resultat)
  values (p_id, p_appareil, socle.moi(), p_entreprise, p_ordre, p_geste, p_format, p_revision_vue, p_instant_poste,
    ecart, p_charge, p_statut, p_motif, p_resultat);
  update socle.file_appareil set dernier_ordre = p_ordre where appareil = p_appareil;
end $$;

-- Sortir une opération de « À reprendre » : par un geste, avec un mot (04 § 5.2). Son auteur, ou
-- le propriétaire et l'administrateur de l'entreprise.
create function socle.resoudre_operation(p_id uuid, p_resolution text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare o record;
begin
  select * into o from socle.operation where id = p_id for update;
  if not found or not (o.utilisateur = socle.moi()
      or (o.entreprise in (select socle.mes_entreprises()) and socle.mes_roles(o.entreprise) && array['proprietaire', 'administrateur']::text[])) then
    perform socle.refus('opération introuvable');
  end if;
  if o.statut = 'acceptee' then perform socle.refus('cette opération a été acceptée : il n''y a rien à reprendre'); end if;
  if o.resolue_le is not null then perform socle.refus('cette opération a déjà été reprise'); end if;
  if length(trim(coalesce(p_resolution, ''))) = 0 then perform socle.refus('dis en quelques mots ce qui a été fait'); end if;
  update socle.operation set resolue_le = now(), resolue_par = socle.moi(), resolution = p_resolution where id = p_id;
  perform socle.tracer(o.entreprise, 'socle.operation.resoudre', 'operation', p_id,
    jsonb_build_object('statut', o.statut, 'motif', o.motif), jsonb_build_object('resolution', p_resolution));
end $$;

revoke execute on function socle.file_prendre(uuid), socle.operation_recue(uuid),
  socle.noter_operation(uuid, uuid, uuid, bigint, text, int, bigint, timestamptz, jsonb, text, text, jsonb),
  socle.resoudre_operation(uuid, text) from public;
grant execute on function socle.file_prendre(uuid), socle.operation_recue(uuid),
  socle.noter_operation(uuid, uuid, uuid, bigint, text, int, bigint, timestamptz, jsonb, text, text, jsonb),
  socle.resoudre_operation(uuid, text) to skanfact_app;
