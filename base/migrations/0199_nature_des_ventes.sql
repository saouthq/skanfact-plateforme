-- (1.318.0) Ce que vend une ligne de vente : une marchandise revendue telle qu'achetée, un produit que l'entreprise
-- fabrique, ou (absente) une prestation de services. Jusqu'ici toute vente allait au compte des ventes (706, prestations) :
-- la quincaillerie qui achète sa marchandise au 607 la revendait au 706, et son comptable reclassait chaque mois. La base
-- de chaque taux se ventile désormais (moteur/piece.ts, moteur/ecritures.ts) : 707 pour les marchandises, 701 pour les
-- produits fabriqués, 706 pour le reste. La nature se fige sur la ligne à l'émission, depuis l'article du catalogue ; nulle
-- pour une pièce d'avant, donc rien ne change pour elles (ni leurs comptes, ni leurs montants, ni leur empreinte :
-- serveur/ventes/pieces.ts ne la scelle que quand elle existe). À VÉRIFIER avec un comptable : 701, 706, 707.
alter table ventes.ligne add column nature text check (nature is null or nature in ('marchandises', 'produits'));
