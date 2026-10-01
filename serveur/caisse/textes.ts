// Les textes du module Caisse (14 § 5) : ce que font ses gestes, et ce qu'il refuse.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.caisse.ticket.encaisser': 'encaisser un ticket de caisse',
  'caisse.pas_un_ticket': 'seul un ticket de caisse (une vente au comptoir, sans numéro) s\'encaisse ici : rien n\'a été vendu',
  'caisse.paiement_manquant': 'le paiement du ticket ({paye}) n\'est pas son total ({total}) : rien n\'a été vendu',
  'caisse.client_inconnu': 'le client choisi n\'est pas dans le dossier : rien n\'a été vendu. Recharge la page',
  'caisse.comptoir': 'Vente au comptoir',
  'geste.caisse.session.ouvrir': 'ouvrir la caisse (sa session, avec le fond de caisse)',
  'geste.caisse.session.fermer': 'fermer la caisse (compter le tiroir, le Z)',
  'geste.caisse.voir': 'voir la caisse et ses Z',
  'caisse.nom_par_defaut': 'Caisse 1',
  'caisse.fermee': 'la caisse est fermée : ouvre-la avec ton fond de caisse avant d\'encaisser. Rien n\'a été vendu',
  'caisse.ouverte_ailleurs': 'la caisse est ouverte sur un autre appareil ({appareil}, par {qui}) : une caisse n\'est tenue que par un appareil à la fois. Ferme-la là-bas, puis ouvre-la ici. Rien n\'a été vendu',
  'caisse.deja_ouverte': 'la caisse est déjà ouverte ({appareil}, par {qui}, depuis {depuis}) : on la ferme avant de la rouvrir',
  'caisse.sans_appareil': 'la caisse s\'ouvre depuis un appareil connecté (un navigateur, l\'application) : rien n\'a été ouvert',
  'caisse.pas_ouverte': 'la caisse n\'est pas ouverte : il n\'y a rien à fermer',
  'caisse.fermer_ailleurs': 'la caisse se ferme sur l\'appareil qui la tient ({appareil}), ou par le propriétaire ou un administrateur',
  'caisse.session_inconnue': 'la session de caisse de ce ticket n\'existe pas dans cette entreprise : rien n\'a été enregistré',
  'caisse.pas_ce_poste': 'ce ticket a été encaissé sur la caisse d\'un autre appareil : seul l\'appareil qui la tenait le remet. Rien n\'a été enregistré',
  'caisse.montant_illisible': 'le montant « {valeur} » ne se lit pas : tape-le comme 150 ou 150,500',
});
