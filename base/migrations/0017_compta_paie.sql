-- Les écritures de la paie tenues par le serveur (brique 34, 29/09/2026 ; docs/ecritures.md), EN
-- TOTAUX DU MOIS (03 § 2.1) : la paie du mois (la somme de ses bulletins), les salaires versés et les
-- avances sur salaire, un total par jour et par compte de trésorerie. Aucune ne nomme un salarié.
-- Leur famille : le mois.

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance'));
