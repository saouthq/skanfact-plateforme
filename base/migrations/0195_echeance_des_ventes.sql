-- L'échéance d'une facture, lue par qui lit les livres du client (1.309.0 ; les Clients joués le 07/11/2026, décidé par
-- délégation). La balance âgée du Cabinet range une pièce selon son échéance quand elle en porte une, selon sa date sinon :
-- les écritures de vente n'en portaient pas, si bien qu'une facture émise il y a 40 jours et échue depuis 10 tombait dans
-- « 31 à 60 jours », et une facture à 30 jours émise hier dans « 1 à 30 jours », jamais dans « pas encore échu ». Le cabinet
-- ne lit pas les ventes du client (règle « visible » de ventes.piece) : seule la date d'échéance sort, pour les pièces d'une
-- entreprise dont la personne lit les livres (compta.mes_entreprises : la sienne, ou celle d'un client sous mandat actif).
create function compta.echeances_des_ventes(p_entreprise uuid, p_pieces uuid[]) returns table (piece uuid, echeance date)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p.id, p.echeance
    from ventes.piece p
   where p.entreprise = p_entreprise and p.id = any(p_pieces) and p.echeance is not null
     and p_entreprise in (select compta.mes_entreprises())
$$;
revoke all on function compta.echeances_des_ventes(uuid, uuid[]) from public;
grant execute on function compta.echeances_des_ventes(uuid, uuid[]) to skanfact_app;
