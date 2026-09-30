-- Ce qu'un membre du cabinet lit du dossier v10 d'un client (brique 60, 30/09/2026 ; docs/cabinet.md,
-- C50). Le dossier v10 (0011) est tout ce que le SkanFact du client écrit : ses pièces, ses clients et
-- leurs coordonnées, ses réglages, sa paie. Jusqu'ici la sécurité par ligne l'ouvrait en entier à qui
-- voit l'entreprise — un membre du cabinet compris, par une requête directe, quand les routes, elles, ne
-- le lui ouvraient pas. Désormais, qui ne voit l'entreprise QUE par son cabinet n'en lit que ce que le
-- serveur y lit pour lui :
--   - le plan du client (ses comptes, ses auxiliaires, ses clients et ses fournisseurs : chaque écriture
--     les contrôle), quel que soit le mandat ;
--   - la paie (les salariés, les bulletins, les avances), si le mandat comprend la paie.
-- Le reste (les pièces, les réglages de la société, les documents) n'est plus visible du cabinet, ni en
-- lecture ni en écriture. Les personnes de l'entreprise et ses clés de l'API voient tout, comme avant.

-- Les entreprises que je vois EN ENTIER : pas seulement par mon cabinet.
create function socle.mes_entreprises_entieres() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e where socle.perimetre_cabinet(e) is null
$$;
-- Celles que je vois par mon cabinet, avec cette case au mandat.
create function socle.mes_entreprises_au_perimetre(p_case text) returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e where p_case = any(socle.perimetre_cabinet(e))
$$;
revoke execute on function socle.mes_entreprises_entieres(), socle.mes_entreprises_au_perimetre(text) from public;
grant execute on function socle.mes_entreprises_entieres(), socle.mes_entreprises_au_perimetre(text) to skanfact_app;

drop policy visible on socle.dossier_v10;
create policy visible on socle.dossier_v10 using (
  entreprise in (select socle.mes_entreprises_entieres())
  or ((collection in ('accounts', 'clients', 'suppliers') or (collection = '_racine' and cle in ('chartAccounts', 'auxiliaires')))
      and entreprise in (select socle.mes_entreprises()))
  or (collection in ('employees', 'payslips', 'advances') and entreprise in (select socle.mes_entreprises_au_perimetre('paie'))));
