-- 0132 : le risque de départ d'un client (1.40.0 ; la liste des fonctions qui manquent, 7 : « suivi de la satisfaction
-- et du risque de départ : retours, insatisfaction et baisse d'utilisation » ; docs/console.md C56). Version légère : la
-- console lit des signes dans ce qu'elle sait déjà (l'abonnement, les contestations, l'activité) ; ici, le seul chiffre
-- qui lui manquait — l'usage de chaque entreprise sur deux fois trente jours : les pièces émises des trente derniers
-- jours (aujourd'hui compris) et celles des trente d'avant, au jour de son fuseau, par la même règle que la mesure (0116,
-- « piecesTrente »). Des nombres, jamais ce qu'ils comptent. La satisfaction, elle, ne se mesure pas encore : il y
-- faudrait une question posée aux clients, dont la liste n'est pas décidée.
create function plateforme.console_usage_trente(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la mesure manque'); end if;
  return (select coalesce(jsonb_object_agg(x.entreprise, jsonb_build_object('trente', x.trente, 'avant', x.avant)), '{}'::jsonb) from (
    select p.entreprise,
           count(*) filter (where (p.emise_le at time zone e.fuseau)::date between p_jour - 29 and p_jour)::int trente,
           count(*) filter (where (p.emise_le at time zone e.fuseau)::date between p_jour - 59 and p_jour - 30)::int avant
      from ventes.piece p join socle.entreprise e on e.id = p.entreprise
     where not e.essai and p.statut = 'emise' and p.emise_le >= (p_jour - 61)::timestamp
     group by p.entreprise) x);
end $$;
revoke execute on function plateforme.console_usage_trente(date) from public;
grant execute on function plateforme.console_usage_trente(date) to skanfact_app;
