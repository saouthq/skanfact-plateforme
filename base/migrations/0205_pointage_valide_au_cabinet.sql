-- (1.330.0) Le pointage VALIDÉ au Cabinet. L'entreprise valide son pointage du mois (depuis la 1.257.0 : une version
-- figée, `pointageVersions`, le mois verrouillé ; « Corriger » le rouvre, `_racine/pointageOuverts`). Pointer à la main,
-- c'est noter ce qui change : un salarié présent à ses horaires n'a aucune grille (`timesheets`). Le Cabinet ne lisait que
-- les grilles : la boulangerie avait validé octobre, et il disait « 1 sur 2 salariés pointés » et « Un mois sans
-- pointage » (joué au Cabinet, 09/11/2026). Sous un mandat qui comprend la paie, il LIT désormais les versions validées
-- et les mois rouverts, sans jamais les écrire : une validation reste le geste du client.
create policy pointage_valide_au_cabinet on socle.dossier_v10 for select using (
  collection = 'pointageVersions' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
create policy pointage_rouvert_au_cabinet on socle.dossier_v10 for select using (
  collection = '_racine' and cle = 'pointageOuverts' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
