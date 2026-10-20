-- Le pointage au Cabinet (20/10/2026, 1.69.0 ; docs/paie.md, « Le pointage au Cabinet »). L'entreprise pointe ses
-- salariés depuis la 1.60.0 (`timesheets` : une case par salarié et par jour, les heures supplémentaires du mois), et un
-- bulletin établi ensuite reprend ses absences non payées et ses heures supplémentaires ; les congés et absences qu'elle
-- saisit (`leaves`) se posent d'eux-mêmes sur la grille. Sous un mandat qui comprend la paie, le cabinet établit les
-- bulletins du client : il tient désormais son pointage (lire et écrire, comme ses salariés et ses bulletins, 0035), et
-- LIT ses congés, sans les écrire, pour que sa grille soit celle du client. Rien d'autre du dossier ne s'ouvre.
create policy pointage_au_cabinet on socle.dossier_v10 using (
  collection = 'timesheets' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
create policy conges_au_cabinet on socle.dossier_v10 for select using (
  collection = 'leaves' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
