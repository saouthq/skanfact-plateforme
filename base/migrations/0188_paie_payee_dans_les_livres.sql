-- Ce que la paie PAIE entre dans les livres tenus par le serveur (03/11/2026, 1.266.6 ; cadrage 16 § 10.1, point 3 ;
-- correction urgente, notée pour la sortie du Personnel). Le serveur écrivait la paie du mois, les salaires versés et les
-- avances ; il oubliait deux sorties d'argent que l'écran écrit depuis 1.228.0 et 1.230.0 : la déclaration sociale payée
-- (la CNSS du trimestre, l'IRPP et les taxes du mois) et le versement d'une saisie sur salaire au créancier. Dans les livres
-- lus par le Cabinet et la comptabilité interne, les dettes envers l'État et la CNSS restaient dues pour toujours, et la
-- banque trop haute. Deux origines nouvelles (serveur/compta/paie.ts) : « saisie » reste la saisie à la main du comptable
-- (la base la laisse modifier, 0021), elle ne se réemploie pas pour une saisie sur salaire.
alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'mouvement', 'contre_passation', 'saisie', 'extourne', 'reprise_v10', 'declaration_sociale', 'saisie_salaire'));
