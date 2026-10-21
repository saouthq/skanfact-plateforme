-- La sécurité par ligne de plateforme.offre_choisie (0158), FORCÉE comme pour chaque table (le garde-fou de
-- tests/socle/cloisonnement.test.ts, rouge sur GitHub pour 1.85.0) : 0158 l'activait sans la forcer. Comme
-- plateforme.contestation (0129), aucune politique : la table ne se lit et ne s'écrit que par les fonctions de 0158.
alter table plateforme.offre_choisie force row level security;
