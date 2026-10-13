-- Les performances du service, à la console (Console 3e, 13/10/2026 ; skanfact docs/cadrage/10-console.md § 2.8,
-- VISION-ARCHITECTURE.md § 6 pour les budgets ; docs/console.md C15). Rien de neuf n'est relevé : la console lit en une
-- fois ce que le serveur et la base savent déjà —
--   - les routes du serveur sur une période (service_route, jour par jour, 0085) : leurs requêtes, leurs pannes et leurs
--     seaux de durée, par modèle de chemin (jamais une valeur, jamais un client) ;
--   - les exemplaires du programme qui ont répondu dans l'heure (service_minute), avec leurs requêtes et leur dernière
--     minute ;
--   - ce que PostgreSQL compte de la base elle-même (pg_stat_database, depuis sa dernière remise à zéro) : des nombres,
--     jamais le texte d'une requête ni une valeur.
create function plateforme.console_service_performances(p_depuis_routes date, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return jsonb_build_object(
    'routes', (select coalesce(jsonb_agg(jsonb_build_array(route, sorte, n, pannes, seaux) order by route), '[]'::jsonb) from (
                 select route, min(sorte) sorte, sum(n)::int n, sum(pannes)::int pannes, plateforme.somme_seaux(seaux) seaux
                   from plateforme.service_route where jour >= p_depuis_routes group by route) r),
    'exemplaires', (select coalesce(jsonb_agg(jsonb_build_array(exemplaire, n, pannes, minutes, derniere) order by exemplaire), '[]'::jsonb) from (
                      select exemplaire, sum(n)::int n, sum(pannes)::int pannes, count(distinct minute)::int minutes, max(minute) derniere
                        from plateforme.service_minute where minute > p_maintenant - interval '1 hour' group by exemplaire) e),
    'base', (select jsonb_build_object('connexions', d.numbackends, 'maxConnexions', current_setting('max_connections')::int,
               'commits', d.xact_commit, 'annulations', d.xact_rollback, 'lusEnMemoire', d.blks_hit, 'lusSurDisque', d.blks_read,
               'blocages', d.deadlocks, 'fichiersTemporaires', d.temp_files, 'octetsTemporaires', d.temp_bytes,
               'depuis', d.stats_reset, 'taille', pg_database_size(d.datid))
               from pg_stat_database d where d.datname = current_database()));
end $$;
revoke execute on function plateforme.console_service_performances(date, timestamptz) from public;
grant execute on function plateforme.console_service_performances(date, timestamptz) to skanfact_app;
