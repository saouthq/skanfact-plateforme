// Les textes de la console, côté serveur (docs/console.md ; skanfact docs/cadrage/10-console.md). Les écrans de la
// console ont les leurs (web/console/src/textes.ts) : le serveur rend des faits et des codes, l'écran les dit.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  // Les gestes de la console (serveur/console/gestes.ts) : ce que le refus dira, « ton rôle ne permet pas de … ».
  'geste.console.session': 'ouvrir ta session de la console',
  'geste.console.accueil.voir': 'voir l\'accueil de la console',
  'geste.console.clients.voir': 'voir les clients et leurs abonnements',
  'geste.console.abonnement.prolonger': 'prolonger un essai',
  'geste.console.abonnement.gerer': 'gérer un abonnement (paiement, résiliation, suspension, abonnement offert)',
  'geste.console.journal.voir': 'lire le journal de la console',
  'geste.console.equipe.voir': 'voir l\'équipe SkanFact',
  'geste.console.equipe.gerer': 'gérer l\'équipe SkanFact',
  'geste.console.service.voir': 'voir l\'état du service',
  'geste.console.service.gerer': 'gérer les alertes du service (les prendre en charge, les mettre en sourdine, envoyer une alerte d\'essai)',
  // Les rôles de l'équipe SkanFact (03 § 5).
  'role.direction': 'direction',
  'role.support': 'support',
  'role.technique': 'technique',
  // L'entrée de la console : une connexion à part, le code du téléphone à chaque fois.
  'console.connexion_requise': 'connecte-toi à la console',
  'console.role_refuse': 'ton rôle dans l\'équipe SkanFact ({role}) ne permet pas {de:geste}',
  'console.code_obligatoire': 'la console demande le code du téléphone, par SMS ou par une application, à chaque connexion. Mets-le en place dans l\'application, écran « Ton compte », puis reviens ici',
  // Les gestes : un motif, et rien d'écrasé.
  'console.motif_requis': 'un geste de la console demande son motif, trois caractères au moins : il reste dans son histoire',
  'console.abonnement_change': 'cet abonnement a changé depuis que tu l\'as ouvert : relis-le avant de refaire le geste',
});
