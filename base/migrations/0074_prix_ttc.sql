-- Au comptoir, le prix d'étiquette fait foi (lot caisse 3, 06/10/2026 ; docs/caisse.md). Une pièce « prix TTC » (le
-- ticket de caisse, et l'avoir de son retour) se calcule TTC d'abord : la ligne est la quantité × le prix unitaire TTC,
-- la TVA s'extrait du TTC par taux (moteur/piece.ts, calculerPieceTtc). Deux paquets à 1,200 DT faisaient 2,399 DT.
-- La pièce garde sa façon de se calculer : scellée avec elle, elle refait le même chiffre à chaque relecture. Les pièces
-- d'avant ne changent pas (faux par défaut).
alter table ventes.piece add column prix_ttc boolean not null default false;
