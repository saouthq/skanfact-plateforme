// Les textes de l'application fermée pendant une maintenance (serveur/fermeture.ts) : la réponse de l'API, et la page
// que voit un client (1.108.0).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'fermeture.motif': 'maintenance en cours : SkanFact revient vers {fin}, et rien n\'a été fait. {texte}',
  'fermeture.page.onglet': 'Maintenance en cours — SkanFact',
  'fermeture.page.pastille': 'Maintenance en cours',
  'fermeture.page.titre': 'SkanFact revient vers {fin}.',
  'fermeture.page.chapo': 'L\'équipe fait une maintenance : l\'application est fermée le temps qu\'elle dure, pour que rien ne s\'écrive à moitié.',
  'fermeture.page.retour': 'Retour prévu',
  'fermeture.page.tunis': 'Heure de Tunis.',
  'fermeture.page.mot': 'Le mot de l\'équipe',
  'fermeture.page.donnees': 'Tes données sont en sécurité',
  'fermeture.page.donnees_dit': 'Rien ne se perd pendant la maintenance.',
  'fermeture.page.envoi': 'Ce que tu envoyais n\'est pas parti',
  'fermeture.page.envoi_dit': 'Rien n\'a été enregistré à moitié : refais-le au retour.',
  'fermeture.page.revient': 'Cette page revient seule',
  'fermeture.page.revient_dit': 'Elle se recharge chaque minute ; l\'application réapparaît d\'elle-même.',
  'fermeture.page.affichee': 'Affichée à {heure}',
  'fermeture.page.etat': 'Page d\'état',
  'fermeture.page.vitrine': 'Gestion, caisse, paie et comptabilité, avec ton cabinet comptable.',
});
