-- L'e-mail et le téléphone d'un client sur SkanFact, lus par son cabinet (1.76.0 ; recette du 20/10/2026 : le dossier
-- disait « email à renseigner » alors que la fiche société du client les porte). La fiche entière reste fermée au
-- cabinet (règle « visible ») : seuls ces deux champs sortent, et seulement des entreprises sous mandat actif d'un
-- cabinet dont la personne est membre active.
create function socle.coordonnees_de_mes_clients() returns table (entreprise uuid, email text, telephone text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.entreprise, nullif(btrim(d.contenu ->> 'email'), ''), nullif(btrim(d.contenu ->> 'phone'), '')
    from socle.dossier_v10 d
   where d.collection = '_racine' and d.cle = 'company'
     and d.entreprise in (select x.entreprise from socle.mandat x
                            join socle.membre m on m.organisation = x.cabinet and m.utilisateur = socle.moi() and m.actif
                           where x.statut = 'actif' and x.debut <= current_date and (x.fin is null or x.fin >= current_date))
$$;
revoke all on function socle.coordonnees_de_mes_clients() from public;
grant execute on function socle.coordonnees_de_mes_clients() to skanfact_app;
