-- La caisse sans réseau (brique 120 ; 04 § 3.1 ; docs/caisse.md, H1 à H4). Le poste qui tient la caisse numérote ses
-- tickets et les chaîne lui-même, même sans réseau ; au retour, le serveur émet chaque ticket comme en ligne et
-- compare : le numéro imprimé et celui de la série, la chaîne du poste. Un écart n'est jamais corrigé en silence :
-- c'est une alerte. À VÉRIFIER avec le cahier des charges NACEF.

-- 1. Ce que le poste a fait de chaque ticket : le numéro qu'il a imprimé, la précédente et l'empreinte de sa chaîne
--    (empreinte = sha256(précédente || sha256(ticket)), en hexadécimal), l'heure de l'encaissement au comptoir, et
--    s'il a été encaissé sans réseau.
alter table caisse.ticket
  add column numero_poste text check (numero_poste is null or length(numero_poste) between 1 and 60),
  add column precedente text check (precedente is null or precedente ~ '^[0-9a-f]{64}$'),
  add column empreinte_poste text check (empreinte_poste is null or empreinte_poste ~ '^[0-9a-f]{64}$'),
  add column encaisse_le timestamptz,
  add column hors_ligne boolean not null default false;
create index ticket_session_ordre on caisse.ticket (session, cree_le, piece);

-- 2. Les alertes de caisse : ce que le serveur a constaté en recevant un ticket, sans rien corriger.
--    numero : le numéro imprimé n'est pas celui de la série ; chaine : la précédente n'est pas la dernière empreinte de
--    la session ; empreinte : l'empreinte ne se recalcule pas ; apres_fermeture : le ticket arrive après le Z.
create table caisse.alerte (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  session uuid not null references caisse.session(id),
  piece uuid references ventes.piece(id),
  nature text not null check (nature in ('numero', 'chaine', 'empreinte', 'apres_fermeture')),
  numero_poste text,
  numero_serie text,
  detail jsonb not null default '{}',
  cree_le timestamptz not null default now()
);
create index alerte_entreprise on caisse.alerte (entreprise, cree_le);
alter table caisse.alerte enable row level security;
alter table caisse.alerte force row level security;
create policy visible on caisse.alerte using (entreprise in (select socle.mes_entreprises()));
grant select, insert on caisse.alerte to skanfact_app;
