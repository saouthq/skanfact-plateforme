-- (1.177.0, maquette « Messages » de Mon cabinet) La note pour l'équipe : écrite dans la conversation d'un client, lue par
-- les membres du cabinet qui voient ce dossier, JAMAIS par l'entreprise (« Rim, impute l'avoir en octobre »). Elle reste
-- dans le dossier du cabinet, avec sa date et son auteur ; elle ne part pas avec l'export de l'entreprise (elle appartient
-- au cabinet, comme la fiche et les modèles : base/entreprise.ts, « hors »). Une note ne se change ni ne s'efface : elle se
-- relit telle qu'elle a été écrite. Ce qui part vers le serveur : le texte, l'auteur et le dossier — la même liste qu'un
-- message (décidé pour la maquette).
create table cabinet.note (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  auteur uuid not null references socle.utilisateur(id),
  auteur_nom text not null check (length(auteur_nom) between 1 and 200),
  texte text not null check (length(texte) between 1 and 4000),
  ecrit_le timestamptz not null default clock_timestamp()
);
create index note_dossier on cabinet.note (cabinet, entreprise, ecrit_le);
alter table cabinet.note enable row level security;
alter table cabinet.note force row level security;
-- La lit et l'écrit qui est du cabinet ET voit le dossier (la même règle que la fiche) ; écrite en son nom seulement.
create policy visible on cabinet.note for select
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
create policy ecrire on cabinet.note for insert
  with check (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises())
    and auteur = socle.moi());
grant select, insert on cabinet.note to skanfact_app;
