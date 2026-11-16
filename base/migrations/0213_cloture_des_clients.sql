-- La période qu'un client sur SkanFact a clôturée chez lui, lue par son cabinet (1.362.5, bout en bout 29). Nour clôture
-- de décembre à octobre ; le cabinet lui réclamait encore « juillet, août et septembre · rien reçu » et « 8 mois sans
-- écriture », pour des mois qu'elle venait de déclarer finis — et vides. La clôture est la promesse faite au comptable
-- (« ce mois ne bougera plus ») : elle doit lui parvenir. Seul ce jour sort (et quand il a été posé), la fiche du dossier
-- reste fermée, et seulement des entreprises sous mandat actif d'un cabinet dont la personne est membre active. Le jour
-- sort en texte : un jour impossible (le 30 février) se refuse au serveur, il ne fait pas tomber tout le portefeuille.
create function socle.cloture_de_mes_clients() returns table (entreprise uuid, jusqua text, le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.entreprise, d.contenu #>> '{}', d.modifie_le
    from socle.dossier_v10 d
   where d.collection = '_racine' and d.cle = 'closedUntil'
     and jsonb_typeof(d.contenu) = 'string' and (d.contenu #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
     and d.entreprise in (select x.entreprise from socle.mandat x
                            join socle.membre m on m.organisation = x.cabinet and m.utilisateur = socle.moi() and m.actif
                           where x.statut = 'actif' and x.debut <= current_date and (x.fin is null or x.fin >= current_date))
$$;
revoke all on function socle.cloture_de_mes_clients() from public;
grant execute on function socle.cloture_de_mes_clients() to skanfact_app;
