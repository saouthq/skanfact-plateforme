-- La signature de la facture électronique (brique 81 ; docs/facture-electronique.md ; vision § 5). DigiGo
-- (TunTrust) signe à distance : le certificat du signataire reste chez TunTrust ; SkanFact ouvre une session
-- pour lui, il reçoit un code sur SON téléphone, et ce code autorise la signature des fichiers de la session.

-- 1. Qui signe, pour l'entreprise : son identifiant DigiGo (À VÉRIFIER : la pièce d'identité que DigiGo
--    attend pour ouvrir une session).
create table ventes.signataire (
  entreprise uuid primary key references socle.entreprise(id),
  identifiant text not null check (length(identifiant) between 4 and 60),
  pose_le timestamptz not null,
  pose_par uuid not null references socle.utilisateur(id)
);
alter table ventes.signataire enable row level security;
alter table ventes.signataire force row level security;
create policy visible on ventes.signataire using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on ventes.signataire to skanfact_app;

-- 2. Chaque demande de signature : les pièces, la session DigiGo, où elle en est.
create table ventes.signature_demande (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  pieces uuid[] not null check (cardinality(pieces) between 1 and 100),
  identifiant text not null,
  session text not null,
  titulaire text,
  statut text not null default 'code_envoye' check (statut in ('code_envoye', 'signee', 'echouee')),
  essais integer not null default 0 check (essais >= 0),
  motif jsonb,
  cree_le timestamptz not null,
  cree_par uuid not null references socle.utilisateur(id)
);
create index signature_demande_entreprise on ventes.signature_demande (entreprise, cree_le);
alter table ventes.signature_demande enable row level security;
alter table ventes.signature_demande force row level security;
create policy visible on ventes.signature_demande using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on ventes.signature_demande to skanfact_app;

-- 3. Le fichier signé : écrit UNE fois (le compte du serveur peut l'ajouter, jamais le changer ni l'effacer),
--    comme le fichier qu'il enveloppe.
create table ventes.efacture_signee (
  piece uuid primary key references ventes.efacture(piece),
  entreprise uuid not null references socle.entreprise(id),
  xml text not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  titulaire text,
  demande uuid not null references ventes.signature_demande(id),
  signe_le timestamptz not null,
  signe_par uuid not null references socle.utilisateur(id)
);
alter table ventes.efacture_signee enable row level security;
alter table ventes.efacture_signee force row level security;
create policy visible on ventes.efacture_signee using (entreprise in (select socle.mes_entreprises()));
grant select, insert on ventes.efacture_signee to skanfact_app;
