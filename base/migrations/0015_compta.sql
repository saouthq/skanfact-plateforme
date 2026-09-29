-- Les écritures comptables tenues par le serveur (brique 32, 29/09/2026 ; docs/ecritures.md). Le
-- serveur écrit les écritures de chaque pièce qu'il tient, dans la même transaction que la pièce :
-- en brouillard (sans numéro), réécrites avec leur famille tant qu'elles ne sont pas validées. Une
-- écriture validée (brique 35) ne se modifie plus jamais : elle se contre-passe.

create schema compta;
grant usage on schema compta to skanfact_app;

-- Les entreprises dont je lis les livres (03 § 2.1, « Livres, balance ») : parmi les miennes, celles
-- où j'ai un rôle qui les tient ou les lit, et celle de la clé qui agit si elle porte un geste de la
-- comptabilité.
create function compta.mes_entreprises() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e
   where socle.mes_roles(e) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'lecture']::text[]
      or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = e
                   and exists (select 1 from unnest(k.gestes) g where g like 'compta.%'))
$$;
revoke execute on function compta.mes_entreprises() from public;
grant execute on function compta.mes_entreprises() to skanfact_app;

-- ── L'écriture ───────────────────────────────────────────────────────────────────────────────────
create table compta.ecriture (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  journal text not null check (journal in ('VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN')),
  date_ecriture date not null,
  -- Ce qui l'a faite : une pièce de vente (facture, avoir) ou un encaissement ; et sa famille (la
  -- facture, ses avoirs et tous leurs règlements), l'unité qui se réécrit (docs/ecritures.md § 2).
  origine_type text not null check (origine_type in ('vente', 'encaissement')),
  origine uuid not null,
  famille uuid not null,
  rang int not null default 0 check (rang >= 0),      -- l'ordre de l'écriture dans sa famille
  piece text check (piece is null or length(piece) <= 200),
  tiers uuid references socle.tiers(id),
  libelle text not null check (length(libelle) between 1 and 500),
  statut text not null default 'brouillard' check (statut in ('brouillard', 'validee')),
  -- Le numéro naît à la validation (brique 35), jamais avant.
  numero text check (numero is null or length(numero) <= 40),
  cree_le timestamptz not null default now(),
  check (statut = 'validee' or numero is null)
);
create index ecriture_date on compta.ecriture (entreprise, date_ecriture, id);
create index ecriture_famille on compta.ecriture (entreprise, famille);
create unique index ecriture_origine on compta.ecriture (entreprise, origine_type, origine) where statut = 'brouillard';
alter table compta.ecriture enable row level security;
alter table compta.ecriture force row level security;
create policy visible on compta.ecriture using (entreprise in (select compta.mes_entreprises()));
grant select on compta.ecriture to skanfact_app;

-- ── Ses lignes ───────────────────────────────────────────────────────────────────────────────────
create table compta.ligne (
  id uuid primary key default socle.uuidv7(),
  ecriture uuid not null references compta.ecriture(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  rang int not null check (rang >= 1),
  compte text not null check (compte ~ '^[0-9A-Za-z]{1,20}$'),
  libelle text not null check (length(libelle) between 1 and 500),
  -- En millimes (la devise de la comptabilité) : un côté, et un seul, jamais zéro.
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  taux_tva bigint check (taux_tva is null or taux_tva between 0 and 1000000),
  check ((debit = 0) <> (credit = 0)),
  unique (ecriture, rang)
);
create index ligne_compte on compta.ligne (entreprise, compte);
alter table compta.ligne enable row level security;
alter table compta.ligne force row level security;
create policy visible on compta.ligne using (entreprise in (select compta.mes_entreprises()));
grant select on compta.ligne to skanfact_app;

-- Une écriture validée ne se modifie ni ne s'efface : elle se contre-passe (01 R6).
create function compta.ecriture_intouchable() returns trigger
language plpgsql as $$
begin
  if old.statut = 'validee' then
    raise exception 'une écriture validée ne se modifie pas : elle se contre-passe' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger ecriture_intouchable before update or delete on compta.ecriture
  for each row execute function compta.ecriture_intouchable();

-- Une ligne appartient à l'entreprise de son écriture, et les lignes d'une écriture validée ne
-- bougent plus.
create function compta.ligne_de_son_ecriture() returns trigger
language plpgsql as $$
declare e record;
begin
  if tg_op = 'DELETE' then
    select entreprise, statut into e from compta.ecriture where id = old.ecriture;
    if found and e.statut = 'validee' then
      raise exception 'une écriture validée ne se modifie pas : elle se contre-passe' using errcode = '42501';
    end if;
    return old;
  end if;
  select entreprise, statut into e from compta.ecriture where id = new.ecriture;
  if found and e.statut = 'validee' then
    raise exception 'une écriture validée ne se modifie pas : elle se contre-passe' using errcode = '42501';
  end if;
  if not found or e.entreprise <> new.entreprise then
    raise exception 'une ligne appartient à l''entreprise de son écriture' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ligne_de_son_ecriture before insert or update or delete on compta.ligne
  for each row execute function compta.ligne_de_son_ecriture();

-- Une écriture est équilibrée et a au moins deux lignes. Vérifié à la FIN de la transaction : elle
-- s'écrit ligne par ligne, et n'est juste qu'une fois toutes ses lignes posées.
create function compta.equilibree() returns trigger
language plpgsql as $$
declare v_id uuid; n int; d bigint; c bigint;
begin
  if tg_table_name = 'ecriture' then v_id := new.id;
  elsif tg_op = 'DELETE' then v_id := old.ecriture;
  else v_id := new.ecriture;
  end if;
  if not exists (select 1 from compta.ecriture where id = v_id) then return null; end if;
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into n, d, c from compta.ligne where ecriture = v_id;
  if n < 2 then
    raise exception 'une écriture a au moins deux lignes' using errcode = '42501';
  end if;
  if d <> c then
    raise exception 'une écriture est équilibrée : ses débits égalent ses crédits' using errcode = '42501';
  end if;
  return null;
end $$;
create constraint trigger ligne_equilibree after insert or update or delete on compta.ligne
  deferrable initially deferred for each row execute function compta.equilibree();
create constraint trigger ecriture_equilibree after insert on compta.ecriture
  deferrable initially deferred for each row execute function compta.equilibree();

-- ── Écrire une famille ───────────────────────────────────────────────────────────────────────────
-- Le brouillard d'une famille, remplacé d'un bloc par ce que le moteur a écrit (`p_ecritures` : les
-- écritures, chacune avec ses lignes ; les montants en texte). Celui qui fait un geste sur une pièce
-- (un commercial qui émet une facture) écrit ainsi son écriture SANS lire les livres : cette
-- fonction est le seul chemin d'écriture, et elle ne touche jamais une écriture validée.
create function compta.ecrire_famille(p_entreprise uuid, p_famille uuid, p_ecritures jsonb)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare e jsonb; l jsonb; v_id uuid; r int;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then
    perform socle.refus('entreprise introuvable');
  end if;
  -- Une famille dont une écriture est validée ne se réécrit pas : son brouillard compterait la pièce
  -- deux fois. Elle se corrige par une contre-passation (brique 35).
  if exists (select 1 from compta.ecriture where entreprise = p_entreprise and famille = p_famille and statut = 'validee') then
    perform socle.refus('cette pièce a une écriture validée : elle se corrige par une contre-passation');
  end if;
  delete from compta.ecriture where entreprise = p_entreprise and famille = p_famille and statut = 'brouillard';
  for e in select value from jsonb_array_elements(p_ecritures) loop
    insert into compta.ecriture (entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, tiers, libelle)
    values (p_entreprise, e->>'journal', (e->>'date')::date, e->>'origine_type', (e->>'origine')::uuid, p_famille,
            (e->>'rang')::int, e->>'piece', (e->>'tiers')::uuid, e->>'libelle')
    returning id into v_id;
    r := 0;
    for l in select value from jsonb_array_elements(e->'lignes') loop
      r := r + 1;
      insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, taux_tva)
      values (v_id, p_entreprise, r, l->>'compte', l->>'libelle', (l->>'debit')::bigint, (l->>'credit')::bigint, (l->>'taux_tva')::bigint);
    end loop;
  end loop;
end $$;
revoke execute on function compta.ecrire_famille(uuid, uuid, jsonb) from public;
grant execute on function compta.ecrire_famille(uuid, uuid, jsonb) to skanfact_app;
