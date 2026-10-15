-- 0125 : les sauvegardes honnêtes (1.31.0 ; l'audit de la console 1.26.0, C10 et C11 ; docs/console.md C47).
--   - C10 se règle dans le serveur (serveur/console/sauvegardes.ts) : un relevé de la veille de plus de cinq minutes ne
--     dit plus l'état de l'archivage ni de la copie hors de la machine — non mesurés, avec l'heure du relevé.
--   - C11 : une remise d'entreprise ne prouve la promesse « une entreprise revient en 4 h, sans rien perdre » qu'avec sa
--     durée mesurée (exploitation/remettre-entreprise.sh la mesure, base/entreprise.ts l'écrit dans la piste d'audit),
--     sa minute (PostgreSQL refuse de s'ouvrir avant d'avoir atteint la minute visée : la remise revient à elle), et
--     récente. Cette lecture rend la dernière remise mesurée, et la durée de chacune pour la direction.

create or replace function plateforme.console_service_sauvegardes(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'nuits', (select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'sauvegarde', sauvegarde, 'copieDeBase', copie_de_base,
                'restauration', restauration) order by jour desc), '[]'::jsonb) from plateforme.service_nuit),
    'dernier', (select jsonb_build_object('minute', minute, 'archiveLe', archive_le, 'copies', copies)
                  from plateforme.service_releve order by minute desc limit 1),
    'retards', (select coalesce(jsonb_agg(jsonb_build_array(heure, plus_long, lues) order by heure), '[]'::jsonb) from (
                 select date_trunc('hour', minute) heure,
                        max(case when copies->'horsMachine'->>'attenteDepuis' is null then 0
                                 else greatest(0, extract(epoch from minute - (copies->'horsMachine'->>'attenteDepuis')::timestamptz)) end)::int plus_long,
                        count(*)::int lues
                   from plateforme.service_releve
                  where minute > p_maintenant - interval '24 hours' and coalesce((copies->'horsMachine'->>'regle')::boolean, false)
                  group by 1) r),
    'exemplaires', (select count(distinct exemplaire)::int from plateforme.service_minute where minute > p_maintenant - interval '1 hour'),
    'remisesFaites', (select jsonb_build_object('n', count(*), 'derniere', max(instant),
                         -- La dernière remise qui a mesuré sa durée (C11) : la seule qui peut prouver la promesse.
                         'mesuree', (select jsonb_build_object('le', m.instant, 'secondes', (m.apres->>'secondes')::int, 'minute', m.apres->>'minute')
                                       from socle.audit m
                                      where m.geste = 'socle.entreprise.remettre' and m.instant > p_maintenant - interval '400 days'
                                        and jsonb_typeof(m.apres->'secondes') = 'number'
                                      order by m.instant desc limit 1))
                       from socle.audit
                       where geste = 'socle.entreprise.remettre' and instant > p_maintenant - interval '400 days'),
    'remises', case when v_role = 'direction' then (
                 select coalesce(jsonb_agg(jsonb_build_object('le', a.instant, 'entreprise', a.entreprise, 'nom', e.raison_sociale,
                          'motif', a.apres->>'motif', 'minute', a.apres->>'minute',
                          'secondes', case when jsonb_typeof(a.apres->'secondes') = 'number' then (a.apres->>'secondes')::int end,
                          'numerosRetires', coalesce(jsonb_array_length(a.apres->'numerosRetires'), 0),
                          -- Qui l'a préparée dans la console : le même client, le même motif, avant la remise.
                          'preparee', (select jsonb_build_object('par', u.nom, 'le', g.le) from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui
                                        where g.geste = 'service.remise' and g.entreprise = a.entreprise and g.motif = a.apres->>'motif' and g.le <= a.instant
                                        order by g.le desc limit 1)) order by a.instant desc), '[]'::jsonb)
                   from socle.audit a join socle.entreprise e on e.id = a.entreprise
                  where a.geste = 'socle.entreprise.remettre' and a.instant > p_maintenant - interval '400 days') end);
end $$;
