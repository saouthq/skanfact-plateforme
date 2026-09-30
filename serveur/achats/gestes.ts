// Les gestes du module Achats (03 § 2.1, tableau « Achats »). Le module les DÉCLARE (02 M1) ; la
// porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs routes) : enregistrer un achat, régler un
// fournisseur et son certificat de retenue, créer ou modifier un fournisseur et son RIB. Aujourd'hui,
// tout cela s'enregistre avec le dossier v10, que seuls le propriétaire et l'administrateur ouvrent.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_ACHATS: Geste[] = [
  { code: 'achats.pieces.voir', module: 'achats', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', lecture: 'voir', supervision: 'voir', revision: 'voir', saisie: 'voir' } },
  // Lire une facture en photo ou en PDF, puis la confirmer (03 § 2.3, ajouté par le 14 § 2.3) : la
  // lecture ne range rien, mais elle prépare un achat ; c'est une création (une licence expirée la bloque).
  { code: 'achats.facture.lire', module: 'achats', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesAchats(): void {
  if (declares) return;
  declarerGestes(GESTES_ACHATS);
  declares = true;
}
