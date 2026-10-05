-- Le premier code de l'application d'authentification, essayé avant de quitter l'écran (brique 145 ;
-- docs/mise-en-ligne.md, D). Le compte de l'application ne lit pas les secrets des codes (0002) : cette fonction rend
-- à la personne connectée SON secret seulement, et seulement s'il est celui d'une application. Le serveur s'en sert
-- pour dire si le code tapé correspond ; il ne le rend jamais à l'écran.
create function socle.mon_secret_d_application() returns text
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.code_secret from socle.utilisateur u where u.id = socle.moi() and u.code_methode = 'application'
$$;
revoke execute on function socle.mon_secret_d_application() from public;
grant execute on function socle.mon_secret_d_application() to skanfact_app;
