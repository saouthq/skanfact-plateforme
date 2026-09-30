// Les textes du module Achats (14 § 5) : ce que font ses gestes. Déclarés dès que le module est chargé.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.achats.pieces.voir': 'voir les achats et les fournisseurs',
  'geste.achats.facture.lire': 'lire une facture d\'achat en photo ou en PDF',

  // La lecture d'une facture d'achat (brique 84 ; 14 § 2.3) : ce qui se refuse…
  'achats.lecture.indisponible': 'la lecture des factures n\'est pas branchée sur ce serveur : rien n\'a été lu. Saisis la facture à la main',
  'achats.lecture.format': 'le fichier « {nom} » n\'est ni une photo (JPEG, PNG, WEBP) ni un PDF : rien n\'a été lu',
  'achats.lecture.trop_lourd': 'le fichier « {nom} » fait {taille} Mo : au-delà de {limite} Mo, il ne se lit pas. Prends une photo moins lourde',
  'achats.lecture.occupe': 'le lecteur de factures est occupé : réessaie dans une minute',
  'achats.lecture.echec': 'le fichier « {nom} » ne se lit pas (le fichier est peut-être abîmé ou protégé) : rien n\'a été lu. Saisis la facture à la main',
  'achats.lecture.trop_long': 'la lecture de « {nom} » prend trop de temps : rien n\'a été lu. Réessaie avec une photo plus nette, ou saisis la facture à la main',
  'achats.lecture.vide': 'aucun texte ne se lit sur « {nom} » : vérifie que c\'est bien la facture, nette, droite et bien éclairée',
  // … et ce que la relecture dit (deux chemins, un chiffre).
  'achats.lecture.total_juste': 'recompté depuis les montants lus, le total fait {total} : c\'est celui de la pièce',
  'achats.lecture.total_ecart': 'recompté depuis les montants lus ({detail}), le total fait {calcule} ; la pièce annonce {lu}. SkanFact ne choisit pas : vérifie ces montants sur la pièce',
  'achats.lecture.total_absent': 'le total de la pièce ne se lit pas : recompté depuis les montants lus, il fait {calcule}. Vérifie-le sur la pièce',
  'achats.lecture.total_seul': 'le total de la pièce se lit ({lu}), mais pas assez de ses montants pour le recompter : vérifie le hors-taxes et la TVA',
  'achats.lecture.part_ht': 'hors taxes {montant}',
  'achats.lecture.part_tva': 'TVA {montant}',
  'achats.lecture.part_timbre': 'timbre {montant}',
  'achats.lecture.part_fodec': 'FODEC {montant}',
  'achats.lecture.tva_ecart': 'la TVA à {taux} % se lit {lu} ; {taux} % de {base} font {calcule}',
  'achats.lecture.tva_total_ecart': 'les TVA lues taux par taux font {somme}, et la pièce annonce une TVA totale de {total}',
  'achats.lecture.ligne_taux': 'montant hors taxes soumis à la TVA à {taux} %',
  'achats.lecture.lignes_par_taux': 'les lignes de la pièce ne se lisent pas avec assez de sûreté (leur total ne tombe pas sur le hors-taxes) : SkanFact propose une ligne par taux de TVA, depuis les bases lues. Tu peux les détailler',
  'achats.lecture.lignes_absentes_par_taux': 'les lignes de la pièce ne se lisent pas : SkanFact propose une ligne par taux de TVA, depuis les bases lues. Tu peux les détailler',
  'achats.lecture.taux_absent_un': 'le taux de TVA d\'une ligne ne se lit pas : vérifie-le avant de valider',
  'achats.lecture.taux_absent': 'le taux de TVA de {n} lignes ne se lit pas : vérifie-les avant de valider',
  'achats.lecture.taux_absent_bases_un': 'le taux de TVA d\'une ligne ne se lit pas : vérifie-le avant de valider (la pièce annonce {bases})',
  'achats.lecture.taux_absent_bases': 'le taux de TVA de {n} lignes ne se lit pas : vérifie-les avant de valider (la pièce annonce {bases})',
  'achats.lecture.base_au_taux': '{montant} à {taux} %',
  'achats.lecture.taux_deduit': 'le taux de TVA ne se lit pas : {tva} de TVA sur {ht} hors taxes font {taux} %. Vérifie-le',
  'achats.lecture.autre_acheteur': 'la pièce porte le matricule {matricule}, et pas celui de ta société : vérifie qu\'elle t\'est bien adressée',
  'achats.lecture.fodec': 'la pièce porte un FODEC de {montant} : il est compté avec le timbre, dans « Timbre et frais ». À VÉRIFIER avec ton comptable',
  'achats.lecture.retenue': 'la pièce déduit une retenue à la source de {montant} : SkanFact la compte au règlement, pas sur la facture',
  'achats.lecture.devise': 'la pièce est en {devise} : saisis le taux de change sur l\'achat avant de l\'enregistrer',
  'achats.lecture.presque_rien': 'presque rien ne se lit sur ce fichier (ni matricule, ni date, ni total) : vérifie que la photo est nette, droite et bien éclairée, ou saisis la facture à la main',
});
