// Les textes du module Achats (14 § 5) : ce que font ses gestes. Déclarés dès que le module est chargé.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.achats.pieces.voir': 'voir les achats et les fournisseurs',
  'geste.achats.facture.lire': 'lire une facture d\'achat en photo ou en PDF',

  // La lecture d'une facture d'achat (brique 84 ; 14 § 2.3) : ce qui se refuse…
  // (27/10/2026) Seule l'IA de Claude lit les pièces : sans elle, rien ne se lit.
  'achats.lecture.indisponible': 'la lecture par l\'IA n\'est pas branchée sur ce serveur : rien n\'a été lu. Joins la pièce et saisis-la à la main',
  'achats.lecture.ia_coupee': 'la lecture par l\'IA est coupée dans les paramètres de l\'entreprise : rien n\'a été lu. Rallume-la dans Paramètres › Lecture des factures d\'achat, ou saisis la pièce à la main',
  'achats.lecture.ia_accord': 'la pièce ne part chez l\'IA qu\'avec ton accord pour ce fichier : rien n\'a été lu. Clique sur « Lire avec l\'IA » pour la lire',
  'achats.lecture.format': 'le fichier « {nom} » n\'est ni une photo (JPEG, PNG, WEBP) ni un PDF : rien n\'a été lu',
  'achats.lecture.trop_lourd': 'le fichier « {nom} » fait {taille} Mo : au-delà de {limite} Mo, il ne se lit pas. Prends une photo moins lourde',
  // … et ce que la relecture dit (deux chemins, un chiffre).
  'achats.lecture.total_juste': 'recompté depuis les montants lus, le total fait {total} : c\'est celui de la pièce',
  'achats.lecture.total_ecart': 'recompté depuis les montants lus ({detail}), le total fait {calcule} ; la pièce annonce {lu}. SkanFact ne choisit pas : vérifie ces montants sur la pièce',
  'achats.lecture.total_absent': 'le total de la pièce ne se lit pas : recompté depuis les montants lus, il fait {calcule}. Vérifie-le sur la pièce',
  'achats.lecture.total_seul': 'le total de la pièce se lit ({lu}), mais pas assez de ses montants pour le recompter : vérifie le hors-taxes et la TVA',
  'achats.lecture.part_ht': 'hors taxes {montant}',
  'achats.lecture.part_tva': 'TVA {montant}',
  'achats.lecture.part_timbre': 'timbre {montant}',
  'achats.lecture.part_fodec': 'FODEC {montant}',
  'achats.lecture.taux_absent_un': 'le taux de TVA d\'une ligne ne se lit pas : vérifie-le avant de valider',
  'achats.lecture.taux_absent': 'le taux de TVA de {n} lignes ne se lit pas : vérifie-les avant de valider',
  'achats.lecture.autre_acheteur': 'la pièce porte le matricule {matricule}, et pas celui de ta société : vérifie qu\'elle t\'est bien adressée',
  'achats.lecture.fodec': 'la pièce porte un FODEC de {montant} : il est compté avec le timbre, dans « Timbre et frais ». À VÉRIFIER avec ton comptable',
  'achats.lecture.retenue': 'la pièce déduit une retenue à la source de {montant} : SkanFact la compte au règlement, pas sur la facture',
  'achats.lecture.devise': 'la pièce est en {devise} : saisis le taux de change sur l\'achat avant de l\'enregistrer',
  // La lecture par l'IA de Claude (Anthropic), hors de Tunisie (24/10/2026, branchée le 27/10/2026 : lecture-ia.ts).
  'achats.lecture.ia_sans_designation': 'ligne sans désignation lisible',
  'achats.lecture.ia_echec': 'l\'IA n\'a pas pu lire « {nom} » : rien n\'a été lu. Réessaie dans un moment, ou saisis la facture à la main',
  'achats.lecture.ia_refus': 'l\'IA a refusé de lire « {nom} » : rien n\'a été lu. Saisis la facture à la main',
  'achats.lecture.ia_pas_facture': 'l\'IA ne voit pas de facture d\'achat sur « {nom} » : vérifie que c\'est bien la pièce, nette et entière',
});
