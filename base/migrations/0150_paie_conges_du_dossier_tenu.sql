-- Les congés d'un dossier tenu (20/10/2026, 1.70.0 ; docs/paie.md, « Les congés au Cabinet »). Sous un mandat de paie, le
-- cabinet LIT les congés et absences du client (`leaves`, 0149) : un client sur SkanFact les saisit lui-même, et son
-- cabinet ne les change pas. Un dossier TENU (03 § 3.5 : un client qui n'est pas sur SkanFact, `tenue_par`, 0019) n'a
-- personne d'autre pour les saisir : le cabinet qui le tient, et lui seul, les écrit (lire, poser, corriger, retirer).
create function socle.mes_dossiers_tenus_au_perimetre(p_case text) returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises_au_perimetre(p_case) e
   where exists (select 1 from socle.entreprise x where x.id = e and x.tenue_par in (select socle.mes_organisations()))
$$;
revoke execute on function socle.mes_dossiers_tenus_au_perimetre(text) from public;
grant execute on function socle.mes_dossiers_tenus_au_perimetre(text) to skanfact_app;

create policy conges_du_dossier_tenu on socle.dossier_v10 using (
  collection = 'leaves' and entreprise in (select socle.mes_dossiers_tenus_au_perimetre('paie')));
