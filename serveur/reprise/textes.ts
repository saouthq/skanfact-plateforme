// Les textes de la reprise de la v10 (brique 62) : ce que le rapport dit d'une écriture qui ne se
// reprendrait pas telle quelle.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'reprise.montant': 'un montant ne se lit pas au millime',
  'reprise.date': 'la date ne se lit pas',
  'reprise.hors_exercice': 'la date tombe hors de l\'exercice ({du} au {au})',
  'reprise.journal': 'le journal « {journal} » n\'existe pas sur la plateforme (VT, AC, BQ, CA, OD, PAIE, AN)',
  'reprise.deux_lignes': 'une écriture a au moins deux lignes',
  'reprise.un_cote': 'une ligne va au débit ou au crédit, jamais aux deux ni à aucun',
  'reprise.compte': 'le compte « {compte} » ne s\'écrit pas en chiffres',
  'reprise.desequilibre': 'elle n\'est pas équilibrée : {debit} au débit, {credit} au crédit',
  'reprise.sans_numero': 'validée sans numéro',
  'reprise.numero_pris': 'le numéro {numero} est déjà celui d\'une autre écriture',
});
