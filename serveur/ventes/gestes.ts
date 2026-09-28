// Les gestes du module Ventes (03 § 2.1, tableau « Ventes »). Le module les DÉCLARE (02 M1) ; la
// porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs pièces) : les bons de livraison du magasinier,
// l'avoir, le règlement, la relance, le compte auxiliaire que la comptabilité interne règle sur une
// fiche client, et la condition du § 2.2 sur l'émission par un commercial.

import { declarerGestes, type Geste } from '../porte/gestes.ts';

export const GESTES_VENTES: Geste[] = [
  { code: 'ventes.pieces.voir', module: 'ventes', libelle: 'voir les devis, commandes et factures', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', comptabilite_interne: 'voir', lecture: 'voir' } },
  { code: 'ventes.brouillon.modifier', module: 'ventes', libelle: 'créer ou modifier un brouillon de vente', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  { code: 'ventes.facture.emettre', module: 'ventes', libelle: 'émettre une facture', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  { code: 'ventes.client.modifier', module: 'ventes', libelle: 'créer ou modifier un client', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', lecture: 'voir' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesVentes(): void {
  if (declares) return;
  declarerGestes(GESTES_VENTES);
  declares = true;
}
