// Les gestes du module Comptabilité (03 § 2.1, tableau « Comptabilité complète »). Le module les
// DÉCLARE (02 M1) ; la porte ne connaît que ces déclarations.
//
// Pas encore déclaré ici (il viendra avec ses routes) : clôturer l'exercice. La base garde elle-même
// chacun de ces gestes (compta.peut, 0021).

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_COMPTA: Geste[] = [
  { code: 'compta.livres.voir', module: 'compta', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', lecture: 'voir', supervision: 'oui', revision: 'oui', saisie: 'oui' } },
  // Valider une période (brique 35) : les numéros, la chaîne, la période close. La base le garde aussi.
  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
  // Saisir une écriture au brouillard, la modifier, la supprimer (brique 38 ; 03 § 2.1 et § 3.1).
  { code: 'compta.ecritures.saisir', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } },
  // Lettrer des écritures validées d'un compte, délettrer.
  { code: 'compta.lettrage.poser', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesCompta(): void {
  if (declares) return;
  declarerGestes(GESTES_COMPTA);
  declares = true;
}
