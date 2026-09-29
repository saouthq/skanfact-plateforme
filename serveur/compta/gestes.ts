// Les gestes du module Comptabilité (03 § 2.1, tableau « Comptabilité complète »). Le module les
// DÉCLARE (02 M1) ; la porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs routes) : saisir une OD, lettrer, valider une
// période, clôturer l'exercice. Aujourd'hui, les écritures naissent des pièces que le serveur tient.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_COMPTA: Geste[] = [
  { code: 'compta.livres.voir', module: 'compta', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', lecture: 'voir' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesCompta(): void {
  if (declares) return;
  declarerGestes(GESTES_COMPTA);
  declares = true;
}
