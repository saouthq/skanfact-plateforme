-- La remise d'une ligne (1.155.0 ; maquette de la facture, docs/maquettes/facture.html, « Remise par ligne ») : un
-- pourcentage de la ligne, retiré de son montant arrondi avant la remise globale (moteur/piece.ts). Les lignes d'avant
-- n'en ont pas (zéro par défaut) : leurs montants et leur empreinte ne changent pas, la remise ne se scelle que quand
-- elle existe (serveur/ventes/pieces.ts, contenuScelle).
alter table ventes.ligne add column taux_remise bigint not null default 0 check (taux_remise between 0 and 1000000);
