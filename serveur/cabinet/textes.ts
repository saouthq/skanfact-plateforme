// Les textes du cabinet (brique 36) : ce que ses champs attendent.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'cabinet.champ.perimetre': 'le périmètre : comptabilite, declarations, saisie_achats ou paie, chacun une fois',
  'cabinet.champ.matricule': 'le matricule fiscal, comme « 1234567A/P/M/000 »',
  'cabinet.reprise.pas_un_livre': 'ce fichier n\'est pas le livre d\'un exercice du Cabinet v10 (livre-AAAA.json) : rien n\'a été lu',
  'cabinet.reprise.associe': 'seul un associé du cabinet reprend les livres de la v10',
  'cabinet.reprise.anomalies': 'des écritures de ce livre ne se reprendraient pas telles quelles ({n}) : le rapport les nomme, écriture par écriture ; rien n\'a été écrit',
  'cabinet.reprise.ecart': 'la balance écrite ne tombe pas sur celle du livre de la v10 : rien n\'a été écrit',
  'cabinet.fiche_changee': 'la fiche de ce dossier a été changée par quelqu\'un d\'autre entre-temps : recharge-la, rien n\'a été enregistré',
  'cabinet.reglages_changes': 'les réglages du cabinet ont été changés par quelqu\'un d\'autre entre-temps : recharge-les, rien n\'a été enregistré',
  'cabinet.champ.banques': 'cinquante banques au plus',
  'cabinet.champ.code': 'le code du cabinet : six à dix lettres ou chiffres',
  'cabinet.champ.depuis': 'le premier jour d\'un mois (AAAA-MM-01)',
  'cabinet.champ.annee': 'une année sur quatre chiffres',
  'cabinet.champ.email': 'une adresse e-mail, comme « amine@cabinet.tn »',
  'cabinet.champ.periode': 'une année (AAAA) ou un mois (AAAA-MM)',
});
