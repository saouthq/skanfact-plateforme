// Les textes du module Ventes (14 § 5) : ses refus, ses vérifications, et ce que fait chacun de ses
// gestes. Déclarés dès que le module est chargé.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.ventes.pieces.voir': 'voir les devis, commandes et factures',
  'geste.ventes.brouillon.modifier': 'créer ou modifier un brouillon de vente',
  'geste.ventes.facture.emettre': 'émettre une facture',
  'geste.ventes.avoir.emettre': 'émettre un avoir',
  'geste.ventes.facture.signer': 'signer une facture électronique',
  'geste.ventes.efacture.regler': 'désigner le signataire de la facture électronique',
  'geste.ventes.client.modifier': 'créer ou modifier un client',
  'geste.ventes.lien.partager': 'donner à un client le lien de ses pièces, ou le retirer',

  'geste.ventes.paiement.regler': 'brancher ou débrancher le paiement en ligne',

  'paiement.pas_en_ligne': 'cette entreprise ne propose pas le paiement en ligne : écris-lui pour régler autrement',
  'paiement.devise': 'le paiement en ligne se fait en dinars : cette facture est dans une autre devise, écris à l\'entreprise pour la régler',
  'paiement.rien_a_payer': 'il ne reste rien à payer sur cette facture',
  'paiement.prestataire_indisponible': 'le paiement en ligne ne répond pas pour le moment : réessaie dans un instant, ou règle autrement',
  'paiement.retour_inconnu': 'ce paiement est inconnu : reviens à ton espace par le lien que l\'entreprise t\'a donné',
  'paiement.description': 'Facture {numero}',
  'paiement.compte_nom': 'Konnect — paiement en ligne',
  'paiement.non_enregistre': 'le paiement est reçu, mais il n\'a pas pu s\'ajouter à la facture : ajoute-le à la main',
  'paiement.konnect_refuse': 'Konnect a refusé la demande (réponse {statut}){message}',
  'paiement.konnect_illisible': 'Konnect a répondu quelque chose d\'illisible',
  'paiement.konnect_injoignable': 'Konnect ne répond pas',
  'paiement.cle_illisible': 'la clé de Konnect ne s\'ouvre plus sur ce serveur : pose-la de nouveau',
  'paiement.konnect_autre_commande': 'Konnect a confirmé le paiement d\'une autre commande : il n\'est pas enregistré',
  'paiement.konnect_autre_montant': 'Konnect a confirmé {recu} millimes au lieu de {attendu} : le paiement n\'est pas enregistré',

  'espace.lien_invalide': 'ce lien n\'est plus valable : demande un nouveau lien à l\'entreprise qui te l\'a envoyé',
  'espace.piece_non_emise': 'seule une facture ou un avoir émis se partage avec le client : émets la pièce d\'abord',

  'ventes.devise_inconnue': 'la devise {devise} n\'est pas connue',
  'ventes.emise_ne_se_modifie_plus': 'une pièce émise ne se modifie plus : on la corrige par un avoir',
  'ventes.emise_ne_s_efface_pas': 'une pièce émise ne s\'efface jamais : on la corrige par un avoir',
  'ventes.deja_emise': 'cette facture est déjà émise',
  'ventes.seule_facture': 'seuls une facture et un avoir s\'émettent pour l\'instant',
  'ventes.avoir_sans_facture': 'un avoir corrige une facture : indique laquelle',
  'ventes.avoir_facture_non_emise': 'un avoir ne corrige qu\'une facture émise',
  'ventes.avoir_autre_client': 'un avoir corrige une facture de SON client : la facture choisie est celle d\'un autre client',
  'ventes.avoir_autre_devise': 'un avoir se fait dans la devise de la facture qu\'il corrige ({devise})',
  'ventes.sans_ligne': 'une facture sans ligne ne s\'émet pas',
  'ventes.timbre_manquant': 'le timbre fiscal n\'est pas renseigné au {date} : la facture ne s\'émet pas sans lui',
  'ventes.sans_serie': 'aucune série de factures n\'existe encore : crée-la dans les réglages',
  'ventes.avertissement_timbre': 'le timbre fiscal n\'est pas renseigné à cette date : la facture ne pourra pas être émise',

  'ventes.champ.decimal': 'un nombre à {dec} décimales au plus, écrit avec une virgule ou un point (« 2,525 »)',
  'ventes.champ.pourcentage': 'un pourcentage entre 0 et 100',
  'ventes.champ.cours_requis': 'une pièce en devise porte son cours',
  'ventes.champ.identifiant_et_type': 'un identifiant va avec son type',
});
