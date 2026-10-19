-- La recette de la console à la souris et au clavier (19/10/2026, 1.58.0 ; docs/console.md C70) : ce que la console
-- montre deux fois dit le même chiffre.
--
-- Journal : le chiffre « Gestes de l'équipe » ouvre la liste des gestes, et la liste montre aussi ceux de l'outil de
-- l'exploitation (le membre ajouté sur la machine, sans personne connectée à la console). La tuile disait 4 pour une liste
-- de 7 ; elle compte désormais ce que sa liste montre : tous les gestes pour la direction, les siens pour le support.
create or replace function plateforme.console_journal_chiffres(p_depuis timestamptz, p_reserves text[], p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v_moi uuid := socle.moi();
begin
  return jsonb_build_object(
    'gestes', (select count(*) from plateforme.geste_console g where g.le >= p_depuis and (v_role = 'direction' or g.qui = v_moi)),
    'reserves', case when v_role = 'direction' then (select count(*) from plateforme.geste_console g where g.le >= p_depuis and g.geste = any(p_reserves)) end,
    'systeme', case when v_role = 'direction' then
      (select count(*) from plateforme.relance_abonnement r where r.partie_le >= p_depuis)
      + (select count(*) from plateforme.evenement_abonnement v where v.nature = 'paye' and v.par = 'systeme' and v.le >= p_depuis) end,
    'accesOuverts', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.raison_sociale, 'fin', a.fin) order by a.fin), '[]'::jsonb)
                       from plateforme.acces_support a join socle.entreprise e on e.id = a.entreprise
                      where plateforme.acces_support_etat(a, p_maintenant) = 'actif' and (v_role = 'direction' or a.demandeur = v_moi)));
end $$;
