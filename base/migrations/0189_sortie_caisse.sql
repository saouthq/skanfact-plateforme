-- La sortie de caisse de la paie (16 § 3.8 et § 10.1, urgence 5 ; docs/caisse.md). Un salaire ou une avance payés en
-- espèces depuis le tiroir pendant que la caisse est ouverte : les livres les sortent déjà de la caisse (la paie), et le Z,
-- qui ne les connaissait pas, en faisait un manque et le sortait une seconde fois contre le 658. La Paie note la sortie dans
-- la session ouverte (02 § 2 : le Personnel appelle la Caisse, jamais l'inverse) ; le Z la retire de ce que le tiroir
-- devait contenir. Une sortie ne nomme personne : sa nature, le paiement qui l'a faite (sa clé du dossier), son montant.
create table caisse.sortie (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  session uuid not null references caisse.session(id),
  nature text not null check (nature in ('salaire', 'avance')),
  origine text not null check (length(origine) between 1 and 300),
  montant bigint not null check (montant > 0),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  unique (session, origine)
);
create index sortie_session on caisse.sortie (session);
alter table caisse.sortie enable row level security;
alter table caisse.sortie force row level security;
create policy visible on caisse.sortie using (entreprise in (select socle.mes_entreprises()));
grant select, insert, delete on caisse.sortie to skanfact_app;
