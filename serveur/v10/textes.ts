// Les textes du dossier v10 tenu par le serveur (14 § 5) : ses refus, et ce que font ses gestes.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'v10.conflit': 'quelqu\'un d\'autre vient de modifier ce dossier : recharge-le, tes changements ne sont pas perdus tant que la fenêtre reste ouverte',
  'v10.emission_par_le_serveur': 'une facture ou un avoir ne s\'émet qu\'avec le bouton « Émettre » : c\'est le serveur qui lui donne son numéro',
  'v10.avoir_ne_se_modifie_plus': 'l\'avoir {numero} est émis : il ne se modifie plus',
  'v10.avoir_ne_s_efface_pas': 'l\'avoir {numero} est émis : il ne s\'efface jamais',
  'v10.annulee': 'la facture {numero} est émise : elle ne s\'annule pas, on la corrige par un avoir (un avoir total la solde)',
  'v10.reglement_sur_brouillon': 'un paiement ne s\'enregistre que sur une facture émise : émets-la d\'abord',
  'v10.reglement_sans_identifiant': 'un paiement de la facture {numero} n\'a pas d\'identifiant : rien n\'a été enregistré',
  'v10.reglement_double': 'deux paiements de la facture {numero} portent le même identifiant : rien n\'a été enregistré',
  'v10.reglement_date': 'un paiement de la facture {numero} n\'a pas de date valable : rien n\'a été enregistré',
  'v10.reglement_montant': 'un paiement de la facture {numero} n\'a pas de montant : rien n\'a été enregistré',
  'v10.reglement_decimales': 'un paiement en {devise} se compte à {decimales} décimales au plus ({montant}) : rien n\'a été enregistré',
  'v10.reglement_cours': 'le taux du jour d\'un paiement de la facture {numero} est illisible : rien n\'a été enregistré',
  'v10.reglement_ailleurs': 'ce paiement appartient déjà à une autre facture : rien n\'a été enregistré',
  'v10.emise_ne_se_modifie_plus': 'la facture {numero} est émise : elle ne se modifie plus, on la corrige par un avoir',
  'v10.emise_ne_s_efface_pas': 'la facture {numero} est émise : elle ne s\'efface jamais, on la corrige par un avoir',
  'v10.client_manquant': 'cette facture n\'a pas de client : choisis-le avant de l\'émettre',
  'v10.ecart_montant': 'le serveur ne trouve pas le même net à payer que l\'écran ({ecran} à l\'écran, {serveur} au serveur) : rien n\'a été émis. Vérifie le timbre et les taux, puis réessaie',
});
