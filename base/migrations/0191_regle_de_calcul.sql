-- (1.275.0, audit du 04/11/2026, G04) La règle de calcul d'une pièce, gardée avec elle. 1 : celle de la v10 (la remise
-- arrondie ligne à ligne, la TVA d'un taux arrondie à chaque ligne ajoutée), pour toute pièce d'avant : elle se relit et se
-- recompare à son empreinte comme on l'a scellée. 2 : la remise répartie exactement (par les cumuls, sans reliquat), la
-- TVA d'un taux calculée sur sa base entière (moteur/piece.ts). Une pièce neuve naît en 2. À VÉRIFIER avec un comptable :
-- la règle d'arrondi de la TVA sur une facture.
alter table ventes.piece add column calcul smallint not null default 1 check (calcul in (1, 2));
