-- (1.178.0, maquette « Messages » de Mon cabinet, lot 3) Deux suivis de la conversation d'un client, côté cabinet seulement
-- (l'entreprise n'en lit rien ; ils ne partent pas avec son export : base/entreprise.ts, « hors »).
--
-- La promesse du client : « je vous envoie tout vendredi », notée d'un geste. Tant que rien n'arrive du client, la
-- conversation compte dans « Attend le client » ; passé le jour promis sans rien, elle revient seule dans « À traiter ».
-- Un message du client après la promesse la rend caduque (elle ne compte plus). Une seule par dossier : la noter de nouveau
-- la remplace ; elle se retire. Ce qui part vers le serveur : le jour promis, ce qui est promis, qui l'a notée.
create table cabinet.promesse (
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  pour date not null,
  quoi text not null check (length(quoi) between 1 and 200),
  par uuid not null references socle.utilisateur(id),
  par_nom text not null check (length(par_nom) between 1 and 200),
  notee_le timestamptz not null default clock_timestamp(),
  primary key (cabinet, entreprise)
);
alter table cabinet.promesse enable row level security;
alter table cabinet.promesse force row level security;
-- Lue et posée par qui est du cabinet ET voit le dossier (la règle des notes) ; posée en son nom.
create policy visible on cabinet.promesse for select
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
create policy poser on cabinet.promesse for insert
  with check (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()) and par = socle.moi());
create policy changer on cabinet.promesse for update
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()))
  with check (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()) and par = socle.moi());
create policy retirer on cabinet.promesse for delete
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on cabinet.promesse to skanfact_app;

-- « Me le remontrer demain » : la conversation quitte MON « À traiter » jusqu'au jour dit ; celui des autres ne bouge pas.
create table cabinet.rappel (
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  utilisateur uuid not null references socle.utilisateur(id),
  le date not null,
  pose_le timestamptz not null default clock_timestamp(),
  primary key (cabinet, entreprise, utilisateur)
);
alter table cabinet.rappel enable row level security;
alter table cabinet.rappel force row level security;
-- Le sien seulement, sur un dossier qu'on voit.
create policy le_mien on cabinet.rappel for all
  using (utilisateur = socle.moi() and cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()))
  with check (utilisateur = socle.moi() and cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on cabinet.rappel to skanfact_app;
