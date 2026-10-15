-- 0127 : l'arrivée des nouveaux clients (1.34.0 ; la liste des fonctions qui manquent, 6 ; docs/console.md C50). De son
-- inscription à sa première utilisation réelle — sa première facture émise —, la console suit chaque nouvelle entreprise
-- marche par marche (serveur/console/arrivee.ts). Ce que la liste des clients dit en plus de chaque ligne (0113) porte
-- désormais le jour de sa première facture émise ; le reste se lit dans ce que la console sait déjà.

create or replace function plateforme.console_clients_en_plus(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
      'piecesMois', (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
                       and (p.emise_le at time zone e.fuseau)::date between date_trunc('month', p_jour)::date and p_jour),
      'prolonge', (select coalesce(sum((v.apres ->> 'jours')::int), 0) from plateforme.evenement_abonnement v
                    where v.entreprise = e.id and v.nature = 'essai_prolonge' and jsonb_typeof(v.apres -> 'jours') = 'number'),
      'essaiJours', (select (v.apres ->> 'essaiJusquAu')::date - (v.le at time zone e.fuseau)::date from plateforme.evenement_abonnement v
                      where v.entreprise = e.id and v.nature = 'essai_commence' and v.apres ->> 'essaiJusquAu' ~ '^\d{4}-\d{2}-\d{2}$'
                      order by v.le limit 1),
      'prolongeUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'moisOffertRecent', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'mois_offert'
                                    and v.le > (p_jour - 365)::timestamptz),
      -- 0127 : le jour (de son fuseau) de sa première facture émise — une note d'honoraires compte —, sa première
      -- utilisation réelle (serveur/console/arrivee.ts).
      'premiereFactureLe', (select (min(p.emise_le) at time zone e.fuseau)::date from ventes.piece p
                             where p.entreprise = e.id and p.type in ('facture', 'note_honoraires') and p.statut = 'emise'),
      'factures', case when exists (select 1 from plateforme.facture_abonnement f where f.entreprise = e.id and f.payee_le is null)
                       then plateforme.console_factures_abonnement(e.id) else '[]'::jsonb end)), '{}'::jsonb)
    from socle.entreprise e
   where not e.essai);
end $$;
