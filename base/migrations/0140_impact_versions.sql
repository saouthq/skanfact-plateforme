-- 0140 : l'effet de chaque version (1.48.0 ; la liste des fonctions qui manquent, 38 : « suivi des versions et de leur
-- impact : incidents, performances et clients concernés » ; docs/console.md C64 ; décidé par délégation le 16/10/2026).
-- Rien de neuf n'est enregistré : pour chaque période où une version a tourné (le serveur la donne, lue dans l'histoire
-- des installations), la base additionne ce qu'elle sait déjà — les requêtes, leurs pannes et leurs temps (service_heure,
-- 0085, à l'heure près ; les requêtes de la console n'y sont pas : ce sont les nôtres), les incidents ouverts (0089) et, pour la direction seule, les demandes au support ouvertes et
-- le nombre de clients qui les ont posées (0095). La technique lit le service, jamais une donnée de client (03 § 5) : pour
-- elle, les demandes valent rien.

create function plateforme.console_impact_versions(p_periodes jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  if jsonb_typeof(p_periodes) <> 'array' or jsonb_array_length(p_periodes) > 20 then
    perform socle.refus('l''effet des versions se lit sur vingt périodes au plus');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'version', p.version, 'debut', p.debut, 'fin', p.fin,
      'requetes', coalesce((select sum(h.n) from plateforme.service_heure h where h.heure >= date_trunc('hour', p.debut) and h.heure < p.fin and h.sorte <> 'console'), 0),
      'pannes', coalesce((select sum(h.pannes) from plateforme.service_heure h where h.heure >= date_trunc('hour', p.debut) and h.heure < p.fin and h.sorte <> 'console'), 0),
      'seaux', (select to_jsonb(plateforme.somme_seaux(h.seaux))
                  from plateforme.service_heure h where h.heure >= date_trunc('hour', p.debut) and h.heure < p.fin and h.sorte <> 'console'),
      'incidents', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'annee', i.annee, 'numero', i.numero, 'titre', i.titre, 'gravite', i.gravite,
                                                                 'ouvertLe', i.ouvert_le) order by i.ouvert_le), '[]'::jsonb)
                      from plateforme.service_incident i where i.ouvert_le >= p.debut and i.ouvert_le < p.fin),
      'demandes', case when v_role = 'direction' then (select count(*) from plateforme.demande_support d where d.ouverte_le >= p.debut and d.ouverte_le < p.fin) end,
      'clients', case when v_role = 'direction' then (select count(distinct d.entreprise) from plateforme.demande_support d where d.ouverte_le >= p.debut and d.ouverte_le < p.fin) end
    ) order by p.debut desc), '[]'::jsonb)
    from jsonb_to_recordset(p_periodes) as p(version text, debut timestamptz, fin timestamptz)
   where p.debut is not null and p.fin is not null and p.fin > p.debut);
end $$;

revoke execute on function plateforme.console_impact_versions(jsonb) from public;
grant execute on function plateforme.console_impact_versions(jsonb) to skanfact_app;
