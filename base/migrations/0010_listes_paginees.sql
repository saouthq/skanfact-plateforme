-- Les listes des écrans se paginent (règle du projet : toute liste qu'on nomme se pagine) : la page
-- suivante se demande par un curseur, (jour, identifiant) pour les pièces, (nom, identifiant) pour
-- les clients. Les index suivent cet ordre jusqu'à l'identifiant, qui départage deux lignes égales
-- (jamais une ligne sautée ni vue deux fois).

drop index ventes.piece_entreprise;
create index piece_entreprise on ventes.piece (entreprise, type, date_piece, id);

drop index socle.tiers_entreprise;
create index tiers_entreprise on socle.tiers (entreprise, raison_sociale, id);
