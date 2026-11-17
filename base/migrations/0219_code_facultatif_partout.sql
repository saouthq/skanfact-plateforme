-- Le code d'authentification devient facultatif, et recommandé (décision de Skander, 17/11/2026, 1.379.3).
--
-- Deux codes pouvaient barrer la route :
--   1. le code du téléphone (application ou SMS), exigé de tout comptable d'un cabinet sept jours après son premier vrai
--      dossier (0076, 0216) ;
--   2. le code envoyé par e-mail à chaque connexion depuis un appareil inconnu (0076), pour qui n'a pas le premier.
-- Les deux protègent bien, et les deux arrêtent un nouveau venu au pire moment : avant qu'il ait rien vu. Ils restent
-- proposés et recommandés (« Mon compte »), jamais exigés d'office. Ce qui ne change pas : l'adresse e-mail se prouve une fois, à
-- la création du compte (sans elle, un mot de passe oublié ne se retrouve pas) ; et qui a mis un code en place le tape.

-- 1. Le code du téléphone n'est plus exigé d'office. Un cabinet peut le demander à ses comptables (`code_exige`, éteint
--    au départ) : la règle de la 0216 ne vaut plus que pour lui — sept jours après son premier vrai dossier.
alter table socle.organisation add column code_exige boolean not null default false;

create or replace function socle.code_exige_le_de(p_utilisateur uuid) returns timestamptz
language sql stable security definer set search_path = pg_catalog, socle as $$
  select min(socle.premier_vrai_dossier(m.organisation) + interval '7 days')
    from socle.membre m join socle.organisation o on o.id = m.organisation and o.code_exige
   where m.utilisateur = p_utilisateur and m.actif and m.roles && array['supervision', 'revision', 'saisie']::text[]
$$;

-- 2. Le code par e-mail sur un appareil inconnu : un choix de la personne (éteint au départ).
alter table socle.utilisateur add column code_courriel boolean not null default false;

create function socle.veut_code_courriel(p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select u.code_courriel from socle.utilisateur u where u.id = p_utilisateur), false)
      or socle.code_exige_de(p_utilisateur)
$$;
revoke execute on function socle.veut_code_courriel(uuid) from public;
grant execute on function socle.veut_code_courriel(uuid) to skanfact_app;

-- Le régler : soi-même seulement.
create function socle.regler_code_courriel(p_oui boolean) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.utilisateur set code_courriel = coalesce(p_oui, false) where id = socle.moi()
$$;
revoke execute on function socle.regler_code_courriel(boolean) from public;
grant execute on function socle.regler_code_courriel(boolean) to skanfact_app;
