// Les textes du dossier v10 tenu par le serveur (14 § 5) : ses refus, et ce que font ses gestes.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'v10.conflit': 'quelqu\'un d\'autre vient de modifier ce dossier : recharge-le, tes changements ne sont pas perdus tant que la fenêtre reste ouverte',
  'v10.emission_par_le_serveur': 'une facture ne s\'émet qu\'avec le bouton « Émettre » : c\'est le serveur qui lui donne son numéro',
  'v10.emise_ne_se_modifie_plus': 'la facture {numero} est émise : elle ne se modifie plus, on la corrige par un avoir',
  'v10.emise_ne_s_efface_pas': 'la facture {numero} est émise : elle ne s\'efface jamais, on la corrige par un avoir',
  'v10.avoir_pas_encore': 'l\'émission d\'un avoir n\'est pas encore branchée sur le serveur : garde-le en brouillon pour l\'instant',
  'v10.client_manquant': 'cette facture n\'a pas de client : choisis-le avant de l\'émettre',
  'v10.ecart_montant': 'le serveur ne trouve pas le même net à payer que l\'écran ({ecran} à l\'écran, {serveur} au serveur) : rien n\'a été émis. Vérifie le timbre et les taux, puis réessaie',
});
