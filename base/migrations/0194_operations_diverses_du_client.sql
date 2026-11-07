-- Les opérations diverses que le client saisit lui-même, dans les livres tenus par le serveur (07/11/2026, 1.303.0 ;
-- serveur/compta/operations.ts ; docs/ecritures.md, « Les opérations diverses du client »). Un loyer sans facture, une
-- charge avancée par le gérant, une régularisation : la v10 les écrivait dans son livre, le serveur nulle part, et le
-- cabinet, qui lit les livres du serveur, ne les voyait jamais — alors que l'onglet Écritures du client dit qu'il les lit en
-- direct. Chacune est une famille d'écritures, d'origine nouvelle : « saisie » reste la saisie à la main du comptable (la
-- base la laisse modifier au brouillard, 0021) ; l'opération du client, elle, se réécrit par sa famille, comme un
-- mouvement de trésorerie (0156).

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'mouvement', 'contre_passation', 'saisie', 'extourne', 'reprise_v10', 'declaration_sociale', 'saisie_salaire',
                          'operation_diverse'));
