// Les textes du cabinet (brique 36) : ce que ses champs attendent.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'cabinet.champ.perimetre': 'le périmètre : comptabilite, declarations, saisie_achats ou paie, chacun une fois',
  'cabinet.champ.matricule': 'le matricule fiscal, comme « 1234567A/P/M/000 »',
  'cabinet.fiche_changee': 'la fiche de ce dossier a été changée par quelqu\'un d\'autre entre-temps : recharge-la, rien n\'a été enregistré',
  'cabinet.champ.code': 'le code du cabinet : six à dix lettres ou chiffres',
  'cabinet.champ.depuis': 'le premier jour d\'un mois (AAAA-MM-01)',
});
