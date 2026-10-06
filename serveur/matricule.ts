// La forme d'un matricule fiscal tunisien, la même partout où un matricule entre (lot facture, 05/10/2026 ;
// docs/facture-details.md, D6, E3 et E4) : la fiche société (serveur/v10/identite.ts), la porte (« Créer mon
// entreprise »), le dossier tenu d'un cabinet (création, correction) et la reprise d'un portefeuille de la v10. Sept
// chiffres, la lettre-clé (jamais I, O ni U : la règle du fichier El Fatoora, teif.js), le code TVA, la catégorie et
// l'établissement. Il se garde sous sa forme lisible (1234567A/A/M/000), quelle que soit la façon de l'écrire
// (1234567 a a m 000, 1234567AAM000) : un matricule ne s'écrit qu'une fois, et l'unicité (un matricule, une seule
// entreprise active : 0071) le reconnaît sous toutes ses écritures. La même règle que l'écran (`matriculeBienForme`,
// `matriculeLisible` de web/public/v10/core.js) : tests/v10/matricule.test.ts.

import { motif } from '../textes/index.ts';

// La règle elle-même vit dans commun/matricule.ts : l'écran de la porte la dit pendant la frappe (lot entrée).
export { matriculeCanonique } from '../commun/matricule.ts';

// Un matricule mal formé se refuse sur son champ, en disant ce qu'il faut pour en être un (il partait tel quel, et la
// base répondait par une erreur du serveur : E4).
export function refusDuMatricule(ecrit: unknown, champ = 'matriculeFiscal') {
  return { statut: 400, corps: { motif: motif('socle.matricule_forme', { matricule: String(ecrit ?? '').trim() }), champ } };
}
