-- Les déclencheurs de la relecture par différence (0059) écrivent pour le compte de la base : comme toute porte
-- dérobée, personne ne les appelle à la main (01 R13 ; tests/socle/regles-numeros-chaine.test.ts).
revoke execute on function socle.dossier_v10_retirer() from public;
revoke execute on function socle.dossier_v10_revenu() from public;
