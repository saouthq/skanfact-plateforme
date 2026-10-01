-- Relire le dossier par différence (brique 119 ; docs/leger.md, S4). Sur une connexion lente, un poste qui a déjà sa
-- copie ne redemande que ce qui a changé depuis sa dernière lecture.
--
-- La marque d'une lecture est le « xmin » de son instantané : la plus petite transaction encore en cours à ce moment.
-- Chaque objet porte la transaction qui l'a écrit en dernier (`xid`) ; la lecture suivante redemande tout ce qu'une
-- transaction au moins aussi récente que la marque a écrit. Une transaction qui écrivait pendant la lecture (pas encore
-- visible) a un numéro au moins égal à la marque : elle sera relue la fois suivante, jamais perdue. Un numéro de
-- séquence ne le garantirait pas (il se prend avant le « commit », dans le désordre). Relire un objet deux fois ne
-- coûte que lui.
alter table socle.dossier_v10 add column xid xid8 not null default pg_current_xact_id();
create index dossier_v10_xid on socle.dossier_v10 (entreprise, xid);

create function socle.dossier_v10_marquer() returns trigger
language plpgsql as $$
begin
  new.xid := pg_current_xact_id();
  return new;
end $$;
create trigger dossier_v10_marquer before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_marquer();

-- Ce qui a été retiré du dossier, et quand : la relecture le dit au poste, qui le retire de sa copie. Un objet recréé
-- sous la même clé efface sa trace. Écrit par les déclencheurs seuls (personne ne l'écrit à la main).
create table socle.dossier_v10_retire (
  entreprise uuid not null references socle.entreprise(id),
  collection text not null,
  cle text not null,
  xid xid8 not null default pg_current_xact_id(),
  retire_le timestamptz not null default now(),
  primary key (entreprise, collection, cle)
);
create index dossier_v10_retire_xid on socle.dossier_v10_retire (entreprise, xid);
alter table socle.dossier_v10_retire enable row level security;
alter table socle.dossier_v10_retire force row level security;
create policy visible on socle.dossier_v10_retire using (entreprise in (select socle.mes_entreprises()));
grant select on socle.dossier_v10_retire to skanfact_app;

-- Les déclencheurs écrivent la trace pour le compte de la base (une restauration, une suppression par le serveur lui-même,
-- sans personne connectée, doivent aussi la laisser).
create function socle.dossier_v10_retirer() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  insert into socle.dossier_v10_retire (entreprise, collection, cle) values (old.entreprise, old.collection, old.cle)
    on conflict (entreprise, collection, cle) do update set xid = pg_current_xact_id(), retire_le = now();
  return old;
end $$;
create trigger dossier_v10_retirer after delete on socle.dossier_v10
  for each row execute function socle.dossier_v10_retirer();

create function socle.dossier_v10_revenu() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  delete from socle.dossier_v10_retire where entreprise = new.entreprise and collection = new.collection and cle = new.cle;
  return new;
end $$;
create trigger dossier_v10_revenu after insert on socle.dossier_v10
  for each row execute function socle.dossier_v10_revenu();

-- L'identité de cette base : une copie faite sur une autre base (une entreprise restaurée ailleurs, 06 § 4.4) ne se
-- complète jamais par différence ; le poste relit tout. Une entreprise restaurée garde les numéros de transaction de sa
-- base d'origine (la ré-exporter donne le même fichier) : un numéro « de l'avenir » ici n'entre pas dans une différence.
create table socle.instance (
  id uuid primary key default socle.uuidv7(),
  cree_le timestamptz not null default now()
);
insert into socle.instance default values;
alter table socle.instance enable row level security;
alter table socle.instance force row level security;
-- Lisible de tous : elle ne dit rien d'une entreprise.
create policy lisible on socle.instance for select using (true);
grant select on socle.instance to skanfact_app;
