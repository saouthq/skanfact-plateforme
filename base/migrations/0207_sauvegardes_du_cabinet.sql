-- 0207 — Les sauvegardes, vues du cabinet (1.333.0 ; docs/sauvegardes-ecran.md).
--
-- Réglages › Données et sécurité du Cabinet ne gardait, en ligne, qu'un bouton « Se déconnecter » : le panneau des
-- sauvegardes de l'application de bureau (une copie sur une clé USB, une clé de secours) est sans objet, et rien ne le
-- remplaçait. L'entreprise lit depuis 0161 ce que la veille a vu des copies du serveur (la nuit, hors de la machine,
-- l'essai de restauration) ; le cabinet lit les MÊMES faits, sur les mêmes tables : ils ne sont à personne, ce sont ceux
-- du serveur qui garde les livres de tous.
--
-- Ce qui diffère : le contrôle (un membre actif du cabinet, jamais une clé de l'API) et les remises — un cabinet n'en a
-- pas à lui : revenir en arrière se demande au support (Écrire au support, 0206), l'équipe fait d'abord l'essai.

create function plateforme.mes_sauvegardes_cabinet(p_cabinet uuid, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not exists (
       select 1 from socle.membre m join socle.organisation o on o.id = m.organisation
        where m.organisation = p_cabinet and o.type = 'cabinet' and m.utilisateur = socle.moi() and m.actif) then
    perform socle.refus('les sauvegardes se lisent par une personne du cabinet');
  end if;
  return jsonb_build_object(
    'nuit', (select jsonb_build_object('jour', jour, 'sauvegarde', sauvegarde, 'copieDeBase', copie_de_base)
               from plateforme.service_nuit where sauvegarde is not null order by jour desc limit 1),
    'reussie', (select jsonb_build_object('jour', jour, 'le', sauvegarde->>'le')
                  from plateforme.service_nuit where (sauvegarde->>'ok')::boolean order by jour desc limit 1),
    'exercice', (select jsonb_build_object('jour', jour, 'le', restauration->>'le', 'ok', (restauration->>'ok')::boolean)
                   from plateforme.service_nuit where restauration is not null order by jour desc limit 1),
    'veille', (select jsonb_build_object('minute', minute, 'archivage', copies->'archivage', 'horsMachine', copies->'horsMachine')
                 from plateforme.service_releve order by minute desc limit 1),
    'remises', '[]'::jsonb);
end $$;
revoke execute on function plateforme.mes_sauvegardes_cabinet(uuid, timestamptz) from public;
grant execute on function plateforme.mes_sauvegardes_cabinet(uuid, timestamptz) to skanfact_app;
