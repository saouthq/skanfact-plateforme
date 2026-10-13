// Les gestes du support de SkanFact, côté entreprise (Support S1 ; docs/support.md ; 0095). Le module les DÉCLARE (02
// M1) ; la porte ne connaît que ces déclarations.
//
// Écrire au support et relire ses demandes : chaque personne de l'entreprise, quel que soit son rôle (même en lecture :
// on peut avoir besoin d'aide sans rien écrire dans le dossier) ; jamais une clé de l'API, ni un cabinet par son mandat
// (il a son propre support). Chacun ne lit que SES demandes : la base le tient (plateforme.support_exiger, 0095).

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

const TOUS = { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', caissier: 'oui', serveur: 'oui', magasinier: 'oui', comptabilite_interne: 'oui', paie: 'oui', lecture: 'oui' } as const;

export const GESTES_SUPPORT: Geste[] = [
  { code: 'support.ecrire', module: 'support', ecrit: true, horsCle: true, roles: TOUS },
  { code: 'support.voir', module: 'support', ecrit: false, horsCle: true, roles: TOUS },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesSupport(): void {
  if (declares) return;
  declarerGestes(GESTES_SUPPORT);
  declares = true;
}
