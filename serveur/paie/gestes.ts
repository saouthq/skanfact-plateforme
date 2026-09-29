// Les gestes du module Paie (03 § 2.1, tableau « Paie »). Le module les DÉCLARE (02 M1) ; la porte
// ne connaît que ces déclarations.
//
// Des données sensibles (03 D10) : même une LECTURE d'un bulletin ou d'une déclaration se trace.
// La masse salariale est un total sans nom : la comptabilité interne la voit, la lecture aussi.
//
// Pas encore déclarés ici (ils viendront avec leurs routes) : établir, remettre un bulletin, les
// congés et les avances. Aujourd'hui, tout cela s'enregistre avec le dossier v10, que seuls le
// propriétaire et l'administrateur ouvrent.

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

export const GESTES_PAIE: Geste[] = [
  { code: 'paie.bulletins.voir', module: 'paie', ecrit: false, sensible: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', paie: 'oui', supervision: 'oui' } },
  { code: 'paie.declarations.voir', module: 'paie', ecrit: false, sensible: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', paie: 'oui', supervision: 'oui' } },
  // Les salariés et les bulletins du dossier, lus et tenus par qui fait la paie (brique 43 ; 03 § 3.1 :
  // au cabinet, l'associé et le collaborateur Paie, si le mandat comprend la paie). Ils s'enregistrent
  // dans le même dossier que ceux du client, et le serveur les recalcule de la même façon.
  { code: 'paie.dossier.voir', module: 'paie', ecrit: false, sensible: true, horsCle: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', paie: 'oui', supervision: 'oui' } },
  { code: 'paie.dossier.modifier', module: 'paie', ecrit: true, horsCle: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', paie: 'oui', supervision: 'oui' } },
  { code: 'paie.masse.voir', module: 'paie', ecrit: false,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', paie: 'oui', lecture: 'voir', supervision: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesPaie(): void {
  if (declares) return;
  declarerGestes(GESTES_PAIE);
  declares = true;
}
