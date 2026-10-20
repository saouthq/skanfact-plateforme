-- Les avances au Cabinet (20/10/2026, 1.71.0 ; docs/paie.md, « Les avances au Cabinet »). L'entreprise prête de l'argent
-- à ses salariés depuis la 5.1.0 (`advances` : le jour du versement, le montant, la retenue de chaque mois) ; chaque
-- bulletin nouveau en retient l'échéance, et le serveur écrit le versement (brique 34). Depuis la brique 60 (0035), sous un
-- mandat qui comprend la paie, le cabinet LISAIT et ÉCRIVAIT les avances de tout client, avec ses salariés et ses
-- bulletins ; aucune route ne les écrivait. Désormais, comme les congés (0150) : une avance se saisit là où on la
-- décide. Le cabinet LIT celles d'un client sur SkanFact (c'est lui qui verse l'argent), et son bulletin en retient
-- l'échéance ; il n'ÉCRIT que celles d'un dossier qu'il tient. Le reste de la règle de 0035 ne change pas d'un mot.
drop policy visible on socle.dossier_v10;
create policy visible on socle.dossier_v10 using (
  entreprise in (select socle.mes_entreprises_entieres())
  or ((collection in ('accounts', 'clients', 'suppliers') or (collection = '_racine' and cle in ('chartAccounts', 'auxiliaires')))
      and entreprise in (select socle.mes_entreprises()))
  or (collection in ('employees', 'payslips') and entreprise in (select socle.mes_entreprises_au_perimetre('paie'))));
create policy avances_au_cabinet on socle.dossier_v10 for select using (
  collection = 'advances' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
create policy avances_du_dossier_tenu on socle.dossier_v10 using (
  collection = 'advances' and entreprise in (select socle.mes_dossiers_tenus_au_perimetre('paie')));
