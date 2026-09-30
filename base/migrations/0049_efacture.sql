-- La facture électronique (brique 80 ; docs/facture-electronique.md ; 05 § 3.1). Le fichier TEIF de chaque
-- facture et de chaque avoir émis, écrit par le serveur à l'émission : c'est lui qui sera signé et envoyé à
-- la TTN (briques suivantes), et qui se garde dix ans (05 § 3.8). Il s'écrit UNE fois : le compte du serveur
-- peut l'ajouter, jamais le changer ni l'effacer.
create table ventes.efacture (
  piece uuid primary key references ventes.piece(id),
  entreprise uuid not null references socle.entreprise(id),
  -- Le nom du fichier (TEIF_<matricule>_<numéro>.xml), le fichier, et son empreinte (SHA-256).
  nom text not null check (length(nom) between 1 and 200),
  xml text not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  version text not null,
  ecrit_le timestamptz not null,
  ecrit_par uuid not null references socle.utilisateur(id)
);
create index efacture_entreprise on ventes.efacture (entreprise, ecrit_le);
alter table ventes.efacture enable row level security;
alter table ventes.efacture force row level security;
create policy visible on ventes.efacture using (entreprise in (select socle.mes_entreprises()));
grant select, insert on ventes.efacture to skanfact_app;
