// Les gestes du module Comptabilité (03 § 2.1, tableau « Comptabilité complète »). Le module les
// DÉCLARE (02 M1) ; la porte ne connaît que ces déclarations.
//
// La base garde elle-même chacun de ces gestes (compta.peut, 0021).

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
  // Préparer la déclaration du mois, la marquer déposée et payée, en écrire l'écriture (brique 41 ;
  // 03 § 2.1 « Déclarations » et § 3.1). La base le garde aussi (compta.peut_declarer, 0024).
  { code: 'compta.declarations.preparer', module: 'compta', ecrit: true, perimetre: ['declarations'],
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
  // Préparer la liasse de l'année : ses retraitements, son taux d'impôt (brique 41 ter ; 03 § 3.1 :
  // au cabinet, l'associé seul). La base le garde aussi (compta.peut_liasse, 0025).
  { code: 'compta.liasse.preparer', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui' } },
  // Les questions du cabinet au client (brique 44) : les poser, les préciser, les fermer, les retirer
  // (qui saisit, comme la v10) ; les envoyer (qui valide) ; y répondre (l'entreprise). La base le garde
  // aussi (compta.poser_question et les suivantes, 0028).
  { code: 'compta.questions.poser', module: 'compta', ecrit: true,
    roles: { supervision: 'oui', revision: 'oui', saisie: 'oui' } },
  { code: 'compta.questions.envoyer', module: 'compta', ecrit: true,
    roles: { supervision: 'oui', revision: 'oui' } },
  { code: 'compta.questions.repondre', module: 'compta', ecrit: true, horsCle: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui' } },  // Clôturer l'exercice, le rouvrir avec un motif (brique 45) : qui valide ; au cabinet, l'associé
  // seulement (la v10 : « supervision »). La base le garde aussi (compta.exiger_cloture, 0029).
  { code: 'compta.exercice.cloturer', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui' } },
];

let declares = false;
// Au démarrage du serveur (et une seule fois).
export function declarerGestesCompta(): void {
  if (declares) return;
  declarerGestes(GESTES_COMPTA);
  declares = true;
}
