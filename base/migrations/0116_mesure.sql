-- 0116 : la mesure (1.23.0 ; docs/console.md C39 ; skanfact docs/cadrage/10-console.md § 2.9 ; la maquette « Mesure »).
-- Ce que la console sait déjà compter sans rien envoyer de nouveau : les pièces émises de chaque entreprise ces trente
-- derniers jours (le même compte que l'usage de la liste des clients : une pièce émise, au jour de son fuseau), et le
-- temps de la première réponse du support à chaque demande. Le reste de l'écran (l'abonnement, les inscriptions, les
-- membres) se lit dans la liste des entreprises de la console (plateforme.console_entreprises), par le serveur.
--
-- Ce qui ne se compte pas ici, et que l'écran dit « pas encore mesuré » : les écrans ouverts, les parcours, les refus,
-- le motif d'un départ. Il y faudrait des événements envoyés par l'application, dont la liste n'est pas encore décidée
-- (règle du projet : jamais une donnée de plus vers un serveur sans liste comptée et décidée).
--
-- La direction seule : un taux de transformation et des départs sont les comptes de l'entreprise SkanFact.

create function plateforme.console_mesure(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  if p_jour is null then perform socle.refus('le jour de la mesure manque'); end if;
  return jsonb_build_object(
    -- Les pièces émises ces trente derniers jours, aujourd'hui compris, par entreprise (celles qui en ont).
    'piecesTrente', (select coalesce(jsonb_object_agg(x.entreprise, x.n), '{}'::jsonb) from (
        select p.entreprise, count(*) n from ventes.piece p join socle.entreprise e on e.id = p.entreprise
         where not e.essai and p.statut = 'emise' and (p.emise_le at time zone e.fuseau)::date between p_jour - 29 and p_jour
         group by p.entreprise) x),
    -- Les demandes de support ouvertes depuis le premier jour du mois d'avant : quand, sa priorité, sa première réponse.
    -- Une demande notée par l'équipe (reçue ailleurs) compte comme les autres : elle attend aussi sa réponse.
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('ouverteLe', d.ouverte_le, 'priorite', d.priorite,
                    'reponduLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
                    'closeLe', d.close_le) order by d.ouverte_le), '[]'::jsonb)
                   from plateforme.demande_support d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.ouverte_le >= (date_trunc('month', p_jour) - interval '1 month')),
    -- Les urgentes depuis toujours (une panne bloquante est rare : son compte se lit depuis l'ouverture).
    'urgentes', (select coalesce(jsonb_agg(jsonb_build_object('ouverteLe', d.ouverte_le,
                    'reponduLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'))
                    order by d.ouverte_le), '[]'::jsonb)
                   from plateforme.demande_support d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.priorite = 'urgente'));
end $$;

revoke execute on function plateforme.console_mesure(date) from public;
grant execute on function plateforme.console_mesure(date) to skanfact_app;
