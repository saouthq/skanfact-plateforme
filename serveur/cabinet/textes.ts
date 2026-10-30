// Les textes du cabinet (brique 36) : ce que ses champs attendent.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  // (1.178.0) La promesse d'un client et le rappel d'une conversation.
  'cabinet.promesse.passee': 'le jour promis est déjà passé : choisis aujourd\'hui ou un jour à venir',
  'cabinet.rappel.passe': 'un rappel se pose pour un jour à venir : demain au plus tôt',
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
  // (1.173.0, 0181) La suite du classeur : la jumelle d'un double, le mois choisi, la lecture, l'export, l'e-mail.
  'cabinet.classeur.jumelle': 'cette jumelle n\'est pas une autre pièce de ce dossier',
  'cabinet.classeur.mois': 'une pièce se range dans un mois (AAAA-MM), ou revient au mois de son arrivée',
  'cabinet.classeur.lecture_coupee': 'ce client a coupé la lecture de ses photos par l\'IA (ses réglages, « Lire les photos avec l\'IA ») : la pièce se lit à l\'œil',
  'cabinet.classeur.lecture_accord': 'la pièce part à la lecture de l\'IA seulement si tu le confirmes, pour ce fichier',
  'cabinet.classeur.lecture_indisponible': 'la lecture par l\'IA n\'est pas branchée sur ce serveur : la pièce se lit à l\'œil',
  'cabinet.classeur.lecture_echec': 'l\'IA n\'a pas pu lire « {nom} » : réessaie plus tard, ou lis la pièce à l\'œil',
  'cabinet.classeur.lecture_pas_facture': '« {nom} » ne ressemble pas à une facture ni à un ticket : rien n\'a été lu',
  'cabinet.classeur.export_lourd': 'l\'export dépasse 200 Mo : exporte un mois, ou le dossier permanent à part',
  'cabinet.classeur.export_expire': 'ce lien d\'export a passé ses sept jours : exporte à nouveau',
  'cabinet.classeur.sans_adresse': 'la fiche de ce dossier n\'a pas d\'adresse e-mail : ajoute-la sur la fiche du dossier, ou demande par la conversation',
  'cabinet.classeur.sans_courriel': 'ce serveur n\'envoie pas d\'e-mails : la demande est dans la conversation, envoie-la par ta messagerie',
  'cabinet.classeur.courriel.objet': '{cabinet} te demande une pièce',
  'cabinet.classeur.courriel.texte': 'Bonjour,\n\n{cabinet} te demande, pour ton dossier :\n\n« {demande} »\n\nTu réponds dans SkanFact, « Mon comptable » : une photo suffit, elle arrive directement à ton cabinet.\n\n{lien}',
  'cabinet.classeur.courriel.bouton': 'Envoyer la pièce dans SkanFact',
});
