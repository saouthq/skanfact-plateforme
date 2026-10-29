// Les textes du cabinet (brique 36) : ce que ses champs attendent.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'cabinet.champ.perimetre': 'le périmètre : comptabilite, declarations, saisie_achats ou paie, chacun une fois',
  'cabinet.fiche_changee': 'la fiche de ce dossier a été changée par quelqu\'un d\'autre entre-temps : recharge-la, rien n\'a été enregistré',
  'cabinet.reglages_changes': 'les réglages du cabinet ont été changés par quelqu\'un d\'autre entre-temps : recharge-les, rien n\'a été enregistré',
  'cabinet.champ.banques': 'cinquante banques au plus',
  'cabinet.champ.code': 'le code du cabinet : six à dix lettres ou chiffres',
  'cabinet.champ.depuis': 'le premier jour d\'un mois (AAAA-MM-01)',
  'cabinet.champ.annee': 'une année sur quatre chiffres',
  'cabinet.champ.email': 'une adresse e-mail, comme « amine@cabinet.tn »',
  'cabinet.champ.periode': 'une année (AAAA) ou un mois (AAAA-MM)',
  // (1.172.0, 0180) Le classeur d'un client.
  'cabinet.classeur.categorie': 'une pièce du dossier permanent se range dans une catégorie (juridique, fiscal, contrats, banque, cabinet) ; les autres n\'en ont pas',
  'cabinet.classeur.periode': 'un accusé de dépôt ou une pièce du mois se range dans son mois (AAAA-MM)',
  'cabinet.classeur.trop_lourd': '« {nom} » dépasse 10 Mo : une photo plus légère, ou le PDF en plusieurs fichiers',
  'cabinet.classeur.format': '« {nom} » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF : il ne se range pas',
  'cabinet.classeur.deja_remplace': 'ce document a déjà été remplacé : recharge le classeur, rien n\'a été enregistré',
  'cabinet.classeur.classement': 'une pièce se joint à une écriture nommée ; les autres raisons n\'en nomment pas, et défaire n\'a pas de raison',
  'cabinet.classeur.pas_a_classer': 'cette pièce n\'est pas à classer : quelqu\'un l\'a classée entre-temps',
  'cabinet.classeur.pas_classee': 'cette pièce n\'est pas classée',
});
