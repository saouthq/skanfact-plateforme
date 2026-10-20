-- Les mouvements libres de la trésorerie dans les livres tenus par le serveur (1.79.0 ; recette du 20/10/2026 ;
-- docs/ecritures.md, « Les mouvements de trésorerie »). Un frais bancaire, un impôt payé, un apport, un virement entre
-- deux comptes, l'écart d'un Z de caisse : la v10 les écrivait dans son livre, le serveur nulle part. Chacun est une
-- famille d'écritures (serveur/compta/mouvements.ts), d'origine « mouvement ».

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'mouvement', 'contre_passation', 'saisie', 'extourne', 'reprise_v10'));
