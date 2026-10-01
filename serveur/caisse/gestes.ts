// Les gestes du module Caisse (03 § 2.1, tableau « Caisse » ; brique 115 ; docs/caisse.md). Le module les DÉCLARE
// (02 M1) ; la porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs pièces) : ouvrir et fermer sa session (le Z), le retour avec le
// code d'un responsable, voir les sessions de tous les caissiers.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_CAISSE: Geste[] = [
  // Encaisser un ticket : une personne au comptoir, jamais une clé de l'API.
  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesCaisse(): void {
  if (declares) return;
  declarerGestes(GESTES_CAISSE);
  declares = true;
}
