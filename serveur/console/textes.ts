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
  'geste.console.service.remise': 'préparer la remise d\'une entreprise à une minute (la console compose les commandes, elle ne les exécute pas)',
  'geste.console.service.gerer': 'gérer les alertes et les incidents du service (prendre une alerte en charge, une sourdine, une alerte d\'essai ; ouvrir, suivre et clore un incident, ses suites ; annoncer une maintenance)',
  'geste.console.reglages.voir': 'voir les réglages de la plateforme (les prix, les règles communes, le message aux clients)',
  'geste.console.reglages.gerer': 'changer les réglages de la plateforme (noter la relecture d\'une règle, afficher ou retirer le message aux clients)',
  'geste.console.support.voir': 'lire les demandes de support',
  'geste.console.support.repondre': 'répondre à une demande de support (répondre, noter une demande reçue ailleurs, clore, rouvrir)',
  // Les rôles de l'équipe SkanFact (03 § 5).
  'role.direction': 'direction',
  'role.support': 'support',
  'role.technique': 'technique',
  // L'entrée de la console : une connexion à part, le code du téléphone à chaque fois.
  'console.connexion_requise': 'connecte-toi à la console',
  'console.role_refuse': 'ton rôle dans l\'équipe SkanFact ({role}) ne permet pas {de:geste}',
  'console.code_obligatoire': 'la console demande le code du téléphone, par SMS ou par une application, à chaque connexion. Mets-le en place dans l\'application, écran « Ton compte », puis reviens ici',
  // Les gestes : un motif, et rien d'écrasé.
  // Préparer la remise d'une entreprise (docs/console.md C14) : chaque refus nomme sa case.
  'console.remise.entreprise_introuvable': 'choisis le client dans la liste : il se désigne par son identifiant',
  'console.remise.minute_illisible': 'la minute s\'écrit « 2026-10-12 14:03 », à l\'heure de Tunis, et doit exister au calendrier',
  'console.remise.minute_futur': 'la minute visée est la dernière AVANT le dégât : elle est passée',
  'console.remise.minute_trop_vieille': 'on ne peut revenir qu\'à une minute que les copies de base gardées couvrent (le plus ancien point est dit sur l\'écran)',
  'console.remise.motif_court': 'une remise demande son motif, trois caractères au moins : il entre dans la piste d\'audit de l\'entreprise',
  'console.remise.motif_illisible': 'le motif tient sur une ligne, trois cents caractères au plus',
  'console.sans_balise': 'ce texte part sur la page d\'état publique : sans les signes < ni >',
  'console.motif_requis': 'un geste de la console demande son motif, trois caractères au moins : il reste dans son histoire',
  // Les versions du service (docs/console.md C27).
  'console.versions.hors_depot': 'le suiveur n\'installe qu\'une des trente dernières versions du dépôt : celle-ci n\'en est plus',
  'console.versions.en_service_inconnue': 'le suiveur n\'a pas encore dit quelle version est en service : on ne peut pas revenir en arrière sans le savoir',
  'console.versions.retenir_en_service': 'cette version est en service : pour la quitter, reviens à une version d\'avant',
  'console.abonnement_change': 'cet abonnement a changé depuis que tu l\'as ouvert : relis-le avant de refaire le geste',
  // Le support (docs/support.md) : chaque refus nomme sa case.
  'console.support.sujet_court': 'le sujet dit en quelques mots ce que la personne demande : trois caractères au moins',
  'console.support.sujet_long': 'le sujet tient sur une ligne : cent quarante caractères au plus',
  'console.support.sans_balise': 'le sujet s\'écrit sans les signes < ni >',
  'console.support.texte_court': 'note ce que la personne a demandé, avec ses mots : trois caractères au moins',
  'console.support.reponse_courte': 'une réponse : trois caractères au moins',
  'console.support.article_inconnu': 'cet article n\'est pas dans l\'Aide de l\'application : choisis-en un parmi les réponses types',
});
