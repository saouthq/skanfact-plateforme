// Les gestes du module Caisse (03 § 2.1, tableau « Caisse » ; brique 115 ; docs/caisse.md). Le module les DÉCLARE
// (02 M1) ; la porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs pièces) : le retour avec le code d'un responsable.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_CAISSE: Geste[] = [
  // Encaisser un ticket : une personne au comptoir, jamais une clé de l'API.
  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } },
  // La session (brique 116) : l'ouvrir avec le fond de caisse, la fermer en comptant le tiroir (le Z). Une personne au
  // comptoir, sur l'appareil qui tient la caisse.
  { code: 'caisse.session.ouvrir', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } },
  { code: 'caisse.session.fermer', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } },
  // Voir la caisse, sa session et ses Z (03 § 2.1 : la comptabilité interne et la lecture voient).
  { code: 'caisse.voir', module: 'caisse', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui', comptabilite_interne: 'voir', lecture: 'voir' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesCaisse(): void {
  if (declares) return;
  declarerGestes(GESTES_CAISSE);
  declares = true;
}
