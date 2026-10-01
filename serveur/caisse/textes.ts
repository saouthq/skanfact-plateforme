// Les textes du module Caisse (14 § 5) : ce que font ses gestes, et ce qu'il refuse.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.caisse.ticket.encaisser': 'encaisser un ticket de caisse',
  'caisse.pas_un_ticket': 'seul un ticket de caisse (une vente au comptoir, sans numéro) s\'encaisse ici : rien n\'a été vendu',
  'caisse.paiement_manquant': 'le paiement du ticket ({paye}) n\'est pas son total ({total}) : rien n\'a été vendu',
  'caisse.client_inconnu': 'le client choisi n\'est pas dans le dossier : rien n\'a été vendu. Recharge la page',
  'caisse.comptoir': 'Vente au comptoir',
});
