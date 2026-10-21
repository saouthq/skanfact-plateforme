-- Les sauvegardes, vues de l'entreprise (lot Fonctions 3, 21/10/2026 ; docs/sauvegardes-ecran.md). Dans la v10 de
-- bureau, « Sauvegardes » montrait les copies du disque et en remettait une ; sur la plateforme, le panneau était caché
-- et rien ne disait au propriétaire que ses données étaient gardées. Il lit maintenant ce que la veille a vu (0085, 0087) :
-- la dernière copie de la nuit, la copie hors de la machine, le dernier essai de restauration, et les remises faites de
-- SON entreprise. Rien d'autre : ni le nom d'une autre entreprise, ni un chemin, ni une adresse de la machine.
--
-- Revenir à une minute ne se fait pas d'un clic : la remise efface ce qui a été fait depuis (06 § 4.4). Le propriétaire
-- le DEMANDE, avec la minute et le motif : la demande part au support, l'équipe fait d'abord l'essai (qui nomme les
-- pièces qui disparaîtraient) et revient vers lui avant tout changement.

-- Le propriétaire ou un administrateur, en personne (pas une clé de l'API), voit et demande.
create function plateforme.sauvegardes_exiger(p_entreprise uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('les sauvegardes de l''entreprise se voient par son propriétaire et ses administrateurs');
  end if;
end $$;

create function plateforme.mes_sauvegardes(p_entreprise uuid, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.sauvegardes_exiger(p_entreprise);
  return jsonb_build_object(
    -- La dernière nuit où la sauvegarde a tourné, réussie ou non, et la dernière réussie.
    'nuit', (select jsonb_build_object('jour', jour, 'sauvegarde', sauvegarde, 'copieDeBase', copie_de_base)
               from plateforme.service_nuit where sauvegarde is not null order by jour desc limit 1),
    'reussie', (select jsonb_build_object('jour', jour, 'le', sauvegarde->>'le')
                  from plateforme.service_nuit where (sauvegarde->>'ok')::boolean order by jour desc limit 1),
    'exercice', (select jsonb_build_object('jour', jour, 'le', restauration->>'le', 'ok', (restauration->>'ok')::boolean)
                   from plateforme.service_nuit where restauration is not null order by jour desc limit 1),
    -- Ce que la veille a vu à son dernier passage : la minute, l'archivage à la minute (en marche), et la copie hors de la
    -- machine (réglée, en attente depuis).
    'veille', (select jsonb_build_object('minute', minute, 'archivage', copies->'archivage', 'horsMachine', copies->'horsMachine')
                 from plateforme.service_releve order by minute desc limit 1),
    -- Les remises de cette entreprise (sa piste d'audit) : quand, à quelle minute, pourquoi.
    'remises', (select coalesce(jsonb_agg(jsonb_build_object('le', a.instant, 'minute', a.apres->>'minute', 'motif', a.apres->>'motif')
                  order by a.instant desc), '[]'::jsonb)
                  from socle.audit a where a.entreprise = p_entreprise and a.geste = 'socle.entreprise.remettre'
                   and a.instant > p_maintenant - interval '400 days'));
end $$;

revoke execute on function plateforme.sauvegardes_exiger(uuid), plateforme.mes_sauvegardes(uuid, timestamptz) from public;
grant execute on function plateforme.sauvegardes_exiger(uuid), plateforme.mes_sauvegardes(uuid, timestamptz) to skanfact_app;
