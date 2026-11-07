-- L'échéance d'une facture d'achat, lue par qui lit les livres du client (1.310.0 ; les Achats joués le 07/11/2026, décidé
-- par délégation). La pendante de 0195 côté fournisseurs : la balance âgée du Cabinet (collectif 401) range une pièce selon
-- son échéance quand elle en porte une, selon sa date sinon ; les écritures d'achat n'en portaient pas, si bien qu'une
-- facture de carrelage à 60 jours, reçue il y a 20 jours, tombait dans « 1 à 30 jours » au lieu de « pas encore échu ». Le
-- cabinet ne lit pas les achats du client : seule la date d'échéance sort (et compta.achats_justifies, 0173, dit seulement
-- s'il y a un justificatif), pour les pièces d'une entreprise dont la personne lit les livres (compta.mes_entreprises).
create function compta.echeances_des_achats(p_entreprise uuid, p_pieces uuid[]) returns table (piece uuid, echeance date)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p.id, p.echeance
    from achats.piece p
   where p.entreprise = p_entreprise and p.id = any(p_pieces) and p.echeance is not null
     and p_entreprise in (select compta.mes_entreprises())
$$;
revoke all on function compta.echeances_des_achats(uuid, uuid[]) from public;
grant execute on function compta.echeances_des_achats(uuid, uuid[]) to skanfact_app;
