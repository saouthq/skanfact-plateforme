// Les gestes du module Ventes (03 § 2.1, tableau « Ventes »). Le module les DÉCLARE (02 M1) ; la
// porte ne connaît que ces déclarations.
//
// Pas encore déclarés ici (ils viendront avec leurs pièces) : les bons de livraison du magasinier,
// le règlement par une route à lui (il s'enregistre aujourd'hui avec le dossier v10), la relance, le compte auxiliaire que la comptabilité interne règle sur une
// fiche client, et la condition du § 2.2 sur l'émission par un commercial.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_VENTES: Geste[] = [
  { code: 'ventes.pieces.voir', module: 'ventes', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', comptabilite_interne: 'voir', lecture: 'voir', supervision: 'voir', revision: 'voir', saisie: 'voir' } },
  { code: 'ventes.brouillon.modifier', module: 'ventes', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  { code: 'ventes.facture.emettre', module: 'ventes', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  // L'avoir : le commercial le prépare, il ne l'émet pas (03 § 2.1).
  { code: 'ventes.avoir.emettre', module: 'ventes', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
  // L'accord d'un responsable au-delà de l'encours d'un client (brique 98 ; 03 § 2.3, D11) : c'est une personne
  // qui l'engage, jamais une clé de l'API.
  { code: 'ventes.accord.donner', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
  { code: 'ventes.client.modifier', module: 'ventes', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', lecture: 'voir' } },
  // L'espace client (brique 77) : un lien secret vers les pièces émises d'un client. Jamais pour une clé
  // de l'API : c'est une personne qui donne un accès à un tiers.
  { code: 'ventes.lien.partager', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  // Le paiement en ligne (brique 78) : brancher le compte de l'entreprise chez le prestataire (sa clé),
  // ou le débrancher. L'argent de l'entreprise : le propriétaire et l'administrateur seulement.
  { code: 'ventes.paiement.regler', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
  // La facture électronique (brique 81) : désigner qui signe, et signer. Signer est l'acte d'une personne
  // (le code arrive sur SON téléphone) : jamais une clé de l'API.
  { code: 'ventes.efacture.regler', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
  { code: 'ventes.facture.signer', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
  // L'envoi à la TTN (brique 82) : il part de lui-même une fois la pièce signée ; renvoyer une pièce refusée
  // est une décision (une personne).
  { code: 'ventes.facture.envoyer', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesVentes(): void {
  if (declares) return;
  declarerGestes(GESTES_VENTES);
  declares = true;
}
