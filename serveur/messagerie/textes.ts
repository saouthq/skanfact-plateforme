// Les textes de la messagerie entre l'entreprise et son cabinet (lot messagerie, 09/10/2026 ; docs/messagerie.md).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.messagerie.lire': 'lire les messages échangés avec le cabinet',
  'geste.messagerie.ecrire': 'écrire dans la messagerie avec le cabinet',
  'messagerie.champ.cote': 'le côté de la messagerie : « entreprise » ou « cabinet »',
  'messagerie.champ.curseur': 'la suite d\'un fil, telle que le serveur l\'a donnée',
  'messagerie.fichier.trop_lourd': 'Le fichier « {nom} » pèse {taille} Mo : un fichier joint pèse {limite} Mo au plus',
  'messagerie.fichier.format': 'Le fichier « {nom} » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF : il ne se joint pas',
  // L'alerte par e-mail : ni le message, ni le nom de l'entreprise, ni celui du cabinet (décidé le 09/10/2026).
  'messagerie.alerte.objet': 'Un nouveau message t\'attend dans SkanFact',
  'messagerie.alerte.entreprise': 'Bonjour,\n\nTon cabinet comptable t\'a écrit dans SkanFact. Le message t\'attend là-bas, et nulle part ailleurs :\n\n{lien}\n\nPour ne plus recevoir cette alerte : décoche « Me prévenir par e-mail », dans Mon comptable.',
  'messagerie.alerte.cabinet': 'Bonjour,\n\nUn de tes clients t\'a écrit dans SkanFact. Le message t\'attend là-bas, et nulle part ailleurs :\n\n{lien}\n\nPour ne plus recevoir cette alerte : décoche « Me prévenir par e-mail », dans la conversation de ce client.',
});
