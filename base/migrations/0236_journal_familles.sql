-- 0236 — Chaque geste du journal de la console tombe dans une famille que l'écran sait dire (1.388.85).
--
-- Les adresses de la console (0234, « console.adresse_ajoutee »…) et l'ouverture des modules (0229, « modules.etat »…)
-- tombaient dans des familles « console » et « modules » que l'écran du journal ne connaît pas : il s'arrêtait sur
-- « Cet écran n'a pas pu s'afficher » dès qu'un de ces gestes était dans la page. Les adresses de la console vont avec le
-- service (comme la lecture seule et la version minimale), l'ouverture d'un module avec les réglages.
create or replace function plateforme.sorte_du_geste(p_geste text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case
    when p_geste like 'support.acces%' then 'acces'
    when p_geste like 'abonnement.%' or p_geste like 'groupes.%' then 'abonnements'
    when p_geste like 'service.%' or p_geste like 'versions.%' or p_geste like 'console.%' then 'service'
    when p_geste like 'modules.%' then 'reglages'
    when p_geste like 'systeme.%' then 'systeme'
    else split_part(p_geste, '.', 1) end
$$;
