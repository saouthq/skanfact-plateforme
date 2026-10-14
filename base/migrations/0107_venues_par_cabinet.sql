-- Les clients venus par un cabinet (docs/console.md C17, la sixième carte de Clients ; skanfact docs/cadrage/07
-- « Parrainage ») : un mandat accepté (en cours ou arrêté depuis) qui commence avant le premier paiement de l'entreprise
-- — ou, tant qu'elle n'a rien payé, un mandat accepté. La même règle que la remise du cabinet (0106,
-- plateforme.remise_de) ; une entreprise d'exemple n'en est jamais. Pour chacune : son premier cabinet et le jour où son
-- mandat commence.

create function plateforme.console_venues_par_cabinet() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return (select coalesce(jsonb_object_agg(x.entreprise, jsonb_build_object('cabinet', x.nom, 'depuis', x.debut)), '{}'::jsonb)
    from (select distinct on (d.entreprise) d.entreprise, o.nom, d.debut
            from socle.mandat d join socle.organisation o on o.id = d.cabinet join socle.entreprise e on e.id = d.entreprise
           where not e.essai and d.statut in ('actif', 'termine')
             and (plateforme.premier_paiement(d.entreprise) is null or d.debut <= plateforme.premier_paiement(d.entreprise))
           order by d.entreprise, d.debut) x);
end $$;

revoke execute on function plateforme.console_venues_par_cabinet() from public;
grant execute on function plateforme.console_venues_par_cabinet() to skanfact_app;
