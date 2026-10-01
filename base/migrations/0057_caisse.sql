-- La caisse et sa session (brique 116 ; 01 § 10 ; 03 § 2.1 « Caisse » ; 04 § 3.1 ; docs/caisse.md). Une caisse n'est
-- tenue que par UN appareil à la fois : deux postes hors ligne sur la même série prendraient le même numéro ; c'est le
-- seul moyen sûr de l'empêcher (04 § 3.1). La session s'ouvre avec le fond de caisse sur un appareil, qui tient la
-- caisse jusqu'à la fermeture ; changer d'appareil se fait après la fermeture. La fermeture compte le tiroir, dit
-- l'écart et fige le Z (le rapport de clôture). À VÉRIFIER avec le cahier des charges NACEF (le Z électronique exigé).
create schema caisse;
grant usage on schema caisse to skanfact_app;

-- 1. La caisse : son nom et l'appareil qui la tient (celui de sa dernière session).
create table caisse.caisse (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  nom text not null check (length(nom) between 1 and 100),
  appareil uuid references socle.appareil(id),
  active boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (entreprise, nom)
);
alter table caisse.caisse enable row level security;
alter table caisse.caisse force row level security;
create policy visible on caisse.caisse using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on caisse.caisse to skanfact_app;

-- 2. La session : ouverte avec le fond (en millimes, dans la devise de l'entreprise), fermée avec le comptage des
--    espèces, ce que le tiroir devait contenir, l'écart, et le Z figé. Une seule session ouverte par caisse.
create table caisse.session (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  caisse uuid not null references caisse.caisse(id),
  appareil uuid not null references socle.appareil(id),
  -- Le nom de l'appareil à l'ouverture, gardé : les autres membres ne lisent pas les appareils d'une personne.
  appareil_nom text not null check (length(appareil_nom) between 1 and 200),
  ouverte_par uuid not null references socle.utilisateur(id),
  ouverte_le timestamptz not null default now(),
  fond bigint not null check (fond >= 0),
  fermee_par uuid references socle.utilisateur(id),
  fermee_le timestamptz,
  compte bigint check (compte is null or compte >= 0),
  attendu bigint,
  ecart bigint,
  z jsonb,
  check ((fermee_le is null) = (fermee_par is null)),
  check ((fermee_le is null) = (z is null)),
  check ((fermee_le is null) = (compte is null))
);
create unique index session_ouverte on caisse.session (caisse) where fermee_le is null;
create index session_caisse on caisse.session (caisse, ouverte_le);
alter table caisse.session enable row level security;
alter table caisse.session force row level security;
create policy visible on caisse.session using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on caisse.session to skanfact_app;

-- Une session fermée ne change plus : son Z est un fait (01 R6). Une session ouverte ne change que pour se fermer.
create function caisse.session_figee() returns trigger
language plpgsql as $$
begin
  if old.fermee_le is not null then
    raise exception 'Une session de caisse fermée ne change plus.' using errcode = '42501';
  end if;
  if (new.entreprise, new.caisse, new.appareil, new.appareil_nom, new.ouverte_par, new.ouverte_le, new.fond)
     is distinct from (old.entreprise, old.caisse, old.appareil, old.appareil_nom, old.ouverte_par, old.ouverte_le, old.fond) then
    raise exception 'Une session de caisse fermée ne change plus.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger session_figee before update on caisse.session
  for each row execute function caisse.session_figee();

-- 3. Le ticket dans sa session : la pièce émise (série TIC) et la session où il a été encaissé.
create table caisse.ticket (
  piece uuid primary key references ventes.piece(id),
  entreprise uuid not null references socle.entreprise(id),
  session uuid not null references caisse.session(id),
  cree_le timestamptz not null default now()
);
create index ticket_session on caisse.ticket (session);
alter table caisse.ticket enable row level security;
alter table caisse.ticket force row level security;
create policy visible on caisse.ticket using (entreprise in (select socle.mes_entreprises()));
grant select, insert on caisse.ticket to skanfact_app;
