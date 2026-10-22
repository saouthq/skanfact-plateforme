-- 0165 — Le contrôle d'équilibre des écritures, sans repasser par la sécurité par ligne (1.110.0 ; banc/clients).
--
-- Le banc des clients (500 utilisateurs au travail, chacun sur cinq ans d'historique) a trouvé le ticket de caisse au-delà
-- de son budget (95 % sous 200 ms, VISION § 6) : 252 ms. Le premier coût était ce contrôle. Il tourne à la validation, pour
-- CHAQUE ligne d'écriture écrite ou effacée (une facture en réécrit plusieurs, un ticket deux familles), et ses deux
-- lectures (l'écriture existe-t-elle encore ; ses lignes s'équilibrent-elles) passaient par la sécurité par ligne de la
-- personne : 1 à 2 ms chacune, pour relire ce que la même transaction venait d'écrire.
--
-- Il tourne désormais avec les droits du propriétaire, comme compta.ecrire_famille : il ne lit que l'écriture qu'on vient
-- de toucher (par son identifiant, venu de la ligne elle-même), ne renvoie rien et ne fait que refuser. Rien de plus ne
-- se voit ; la règle (deux lignes au moins, débits égaux aux crédits) est la même. Mesuré : le ticket à 179 ms.

alter function compta.equilibree() security definer set search_path = pg_catalog, compta;
revoke execute on function compta.equilibree() from public;
