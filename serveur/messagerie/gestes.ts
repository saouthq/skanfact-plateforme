// Les gestes de la messagerie entre l'entreprise et son cabinet (lot messagerie, 09/10/2026 ; docs/messagerie.md). Le
// module les DÉCLARE (02 M1) ; la porte ne connaît que ces déclarations.
//
// Côté entreprise : ceux qui répondent déjà aux questions du cabinet (le propriétaire, l'administrateur, la
// comptabilité interne). Côté cabinet : chacun de ses rôles, sur un dossier qu'il voit. Un mandat ouvre la messagerie
// quel qu'en soit le périmètre (un cabinet qui ne fait que la paie parle aussi à son client). Jamais à une clé de
// l'API : la messagerie se tient entre personnes. La base le garde aussi (messagerie.exiger, 0078).

import { declarerGestes, type Geste } from '../porte/gestes.ts';
import './textes.ts';

const QUI = { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui', paie: 'oui' } as const;
const TOUT_MANDAT = ['comptabilite', 'declarations', 'saisie_achats', 'paie'];

export const GESTES_MESSAGERIE: Geste[] = [
  { code: 'messagerie.lire', module: 'messagerie', ecrit: false, horsCle: true, perimetre: TOUT_MANDAT, roles: QUI },
  { code: 'messagerie.ecrire', module: 'messagerie', ecrit: true, horsCle: true, perimetre: TOUT_MANDAT, roles: QUI },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesMessagerie(): void {
  if (declares) return;
  declarerGestes(GESTES_MESSAGERIE);
  declares = true;
}
