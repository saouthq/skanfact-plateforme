-- Le nom du cabinet (brique 47, 29/09/2026 ; docs/cabinet.md, C37). Il signe les relances et se lit
-- chez chaque client (« Ton cabinet comptable ») : seul un associé le change, et le changement se trace
-- au nom du cabinet. Le reste de sa fiche (son adresse e-mail, son téléphone) et ses réglages vivent
-- dans `cabinet.reglages` (0023), dont la liste des champs est fixée par le serveur.

create function socle.renommer_cabinet(p_cabinet uuid, p_nom text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_nom text := btrim(coalesce(p_nom, '')); v_avant text;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change son nom'); end if;
  if length(v_nom) = 0 or length(v_nom) > 200 then perform socle.refus('le nom du cabinet s''écrit en un à deux cents caractères'); end if;
  select nom into v_avant from socle.organisation where id = p_cabinet and type = 'cabinet' for update;
  update socle.organisation set nom = v_nom where id = p_cabinet;
  perform socle.tracer(null, 'cabinet.renommer', 'cabinet', p_cabinet, jsonb_build_object('nom', v_avant), jsonb_build_object('nom', v_nom));
end $$;
revoke execute on function socle.renommer_cabinet(uuid, text) from public;
grant execute on function socle.renommer_cabinet(uuid, text) to skanfact_app;
