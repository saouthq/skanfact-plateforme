-- La fiche d'un dossier au cabinet (brique 37, 29/09/2026 ; docs/cabinet.md) : ce que le cabinet
-- note sur son client et qui n'est PAS la comptabilité du client : comment le joindre, son régime,
-- la période de TVA, le début de mission, les honoraires, le matricule CNSS employeur, une note
-- interne, l'archivage. Elle appartient au cabinet (le client ne la voit pas) ; la liste de ses
-- champs est fixée par le serveur (serveur/cabinet/routes.ts), jamais un fourre-tout.

create schema cabinet;
grant usage on schema cabinet to skanfact_app;

create table cabinet.fiche (
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  contenu jsonb not null check (jsonb_typeof(contenu) = 'object' and socle.sans_virgule(contenu)),
  revision bigint not null default 1,
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  primary key (cabinet, entreprise)
);
alter table cabinet.fiche enable row level security;
alter table cabinet.fiche force row level security;
-- La lit et l'écrit qui est du cabinet ET voit le dossier (l'associé, un collaborateur à qui il est
-- confié, par un mandat actif).
create policy visible on cabinet.fiche
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
grant select, insert, update on cabinet.fiche to skanfact_app;

-- Le nom et le code du cabinet à qui l'entreprise a confié son dossier : le client les lit dans
-- « Ton cabinet comptable », alors que la fiche du cabinet (socle.organisation) ne lui est pas
-- ouverte. Rien d'autre du cabinet, et seulement pour un mandat d'une entreprise que je vois.
create function socle.cabinet_du_mandat(p_mandat uuid) returns table (nom text, code text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select o.nom, o.code_cabinet from socle.mandat d join socle.organisation o on o.id = d.cabinet
   where d.id = p_mandat and d.entreprise in (select socle.mes_entreprises())
$$;
revoke execute on function socle.cabinet_du_mandat(uuid) from public;
grant execute on function socle.cabinet_du_mandat(uuid) to skanfact_app;
