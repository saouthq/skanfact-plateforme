-- Les écritures des achats tenues par le serveur (brique 33, 29/09/2026 ; docs/ecritures.md) : un
-- achat (facture, dépense, avoir, acompte), l'imputation d'un acompte sur sa facture, et chaque
-- règlement fournisseur. Leur famille : la facture (ou la dépense), ses avoirs et acomptes, et tous
-- leurs règlements ; une pièce libre est sa propre famille.

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur'));
