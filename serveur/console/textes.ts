// Les textes de la console, côté serveur (docs/console.md ; skanfact docs/cadrage/10-console.md). Les écrans de la
// console ont les leurs (web/console/src/textes.ts) : le serveur rend des faits et des codes, l'écran les dit.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  // Les gestes de la console (serveur/console/gestes.ts) : ce que le refus dira, « ton rôle ne permet pas de … ».
  'geste.console.session': 'ouvrir ta session de la console',
  'geste.console.accueil.voir': 'voir l\'accueil de la console',
  'geste.console.clients.voir': 'voir les clients et leurs abonnements',
  'geste.console.abonnement.prolonger': 'prolonger un essai',
  'geste.console.abonnement.offrir_mois': 'offrir un mois sur la prochaine facture',
  'geste.console.abonnement.gerer': 'gérer un abonnement (paiement reçu, résiliation, suspension, abonnement offert)',
  'geste.console.journal.voir': 'lire le journal de la console',
  'geste.console.journal.exporter': 'exporter la sélection du journal',
  'geste.console.equipe.voir': 'voir l\'équipe SkanFact',
  'geste.console.equipe.gerer': 'gérer l\'équipe SkanFact',
  'geste.console.service.voir': 'voir l\'état du service',
  'geste.console.service.remise': 'préparer la remise d\'une entreprise à une minute (la console compose les commandes, elle ne les exécute pas)',
  'geste.console.service.gerer': 'gérer les alertes et les incidents du service (prendre une alerte en charge, une sourdine, une alerte d\'essai ; ouvrir, suivre et clore un incident, ses suites ; annoncer une maintenance)',
  'geste.console.reglages.voir': 'voir les réglages de la plateforme (les prix, les règles communes, le message aux clients)',
  'geste.console.reglages.gerer': 'changer les réglages de la plateforme (noter la relecture d\'une règle, afficher ou retirer le message aux clients, allumer ou éteindre une nouveauté)',
  'geste.console.support.voir': 'lire les demandes de support',
  'geste.console.support.repondre': 'répondre à une demande de support (répondre, noter une demande reçue ailleurs, clore, rouvrir)',
  'geste.console.support.acces': 'demander l\'accès au dossier d\'un client et le lire pendant qu\'il court (en lecture seulement, chaque page tracée)',
  'geste.console.factures.preparer': 'préparer la facture d\'un abonnement dans le dossier de l\'entreprise SkanFact',
  'geste.console.paiements.voir': 'voir les paiements de nos factures et les coûts du mois',
  'geste.console.mesure.voir': 'voir la mesure : l\'entonnoir, les départs, ce qu\'on promet',
  'geste.console.factures.voir': 'voir nos factures, leur dépôt à la TTN et leur paiement',
  'geste.console.paiements.couts': 'saisir ou retirer un coût du mois',
  'geste.console.contestations': 'noter ou régulariser la contestation d\'une facture',
  'geste.console.clients.exporter': 'exporter la sélection de la liste des clients',
  'geste.console.clients.appeler': 'noter un appel sur la fiche d\'un client',
  'geste.console.clients.ecrire': 'écrire au contact d\'un client, dans son application',
  'geste.console.clients.sortie': 'mener la sortie d\'un client (l\'ouvrir, régler son remboursement, la clore)',
  'geste.console.clients.reprise': 'mener la procédure de reprise d\'une entreprise (l\'ouvrir, noter les pièces vues, la clore, la confirmer)',
  // Le message à la propriétaire quand une procédure de reprise s'ouvre (0112) : dans son application, l'alerte par e-mail
  // sans le texte. « %JUSQU_AU% » : la date que la base pose.
  'console.reprise.sujet': 'Une demande de reprise de {entreprise}',
  'console.reprise.texte': 'Bonjour,\n\n{repreneur} nous demande de devenir propriétaire de {entreprise} dans SkanFact. Rien ne change tant que nous n\'avons pas vérifié les pièces (l\'acte, le registre du commerce, sa pièce d\'identité), et un second membre de notre direction confirme avant que quoi que ce soit ne s\'applique.\n\nSi tu t\'y opposes, réponds simplement à ce message avant le {jusquAu} inclus : la procédure s\'arrête.\n\nL\'équipe SkanFact',
  // Les rôles de l'équipe SkanFact (03 § 5).
  'role.direction': 'direction',
  'role.support': 'support',
  'role.technique': 'technique',
  // L'entrée de la console : une connexion à part, le code du téléphone à chaque fois.
  'console.connexion_requise': 'connecte-toi à la console',
  'console.role_refuse': 'ton rôle dans l\'équipe SkanFact ({role}) ne permet pas {de:geste}',
  'console.code_obligatoire': 'la console demande le code du téléphone, par SMS ou par une application, à chaque connexion. Mets-le en place dans l\'application, écran « Ton compte », puis reviens ici',
  // Rejoindre l'équipe par une invitation (0118, C41).
  'console.invitation.perimee': 'ce lien d\'invitation ne vaut plus (déjà servi, annulé, remplacé par un plus récent, ou passé) : demande un nouveau lien à la direction',
  'console.invitation.nom_manque': 'écris ton nom : il signe tes gestes dans le journal de l\'équipe',
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
  // Un paiement reçu hors de la plateforme (0113) : chaque refus nomme sa case.
  'console.recu.facture': 'dis le numéro de la facture faite ailleurs que ce paiement règle : quarante caractères au plus',
  'console.recu.montant': 'le montant reçu s\'écrit en dinars, toutes taxes comprises, avec trois décimales au plus : « 2 380 » ou « 2 380,500 »',
  'console.recu.moyen': 'dis comment l\'argent est arrivé : un virement, un chèque ou des espèces',
  'console.recu.jour': 'le jour du paiement est aujourd\'hui ou un jour passé, qui existe au calendrier',
  'console.secret.jour': 'un jour qui existe au calendrier, écrit comme 2026-10-15',
  'console.secret.nom': 'le nom d\'un secret : de trois à quatre-vingts caractères',
  'console.secret.role': 'à quoi sert ce secret, en quelques mots',
  'console.secret.ou': 'où vit ce secret : le serveur, Cloudflare… jamais sa valeur',
  'console.secret.rotation': 'un rythme de renouvellement : d\'un jour à dix ans',
  // Préparer un prix (docs/abonnement.md C14) : chaque refus nomme sa case.
  'console.reglages.prix_illisible': 'le prix s\'écrit en dinars hors taxes, avec trois décimales au plus : « 420 » ou « 420,500 »',
  'console.reglages.nouveaute_inconnue': 'la version en service ne porte pas cette nouveauté : elle n\'existe que dans une version à venir, ou elle est devenue la règle pour tous',
  'console.reglages.jour_illisible': 'ce jour n\'existe pas au calendrier : choisis-en un dans le calendrier',
  // Les coûts du mois (docs/console.md C30) : chaque refus nomme sa case.
  'console.paiements.libelle_illisible': 'nomme le coût en deux à quatre-vingts caractères : « Serveurs en Tunisie », « SMS »',
  'console.paiements.montant_illisible': 'le montant s\'écrit en dinars, toutes taxes comprises, avec trois décimales au plus : « 186 » ou « 186,500 »',
  'console.paiements.d_apres_court': 'dis d\'après quelle facture reçue (le fournisseur, son numéro) : trois caractères au moins',
  'console.paiements.d_apres_long': 'la facture reçue se dit en deux cents caractères au plus',
  'console.paiements.mois_illisible': 'un coût se saisit pour le mois en cours ou un mois passé',
  // Le support (docs/support.md) : chaque refus nomme sa case.
  'console.support.sujet_court': 'le sujet dit en quelques mots ce que la personne demande : trois caractères au moins',
  'console.support.version_illisible': 'une version s\'écrit comme « 1.32.0 » : trois nombres séparés par des points',
  'console.support.sujet_long': 'le sujet tient sur une ligne : cent quarante caractères au plus',
  'console.support.sans_balise': 'le sujet s\'écrit sans les signes < ni >',
  'console.support.acces_motif_court': 'demander l\'accès dit pourquoi, au client qui le lira : trois caractères au moins',
  'console.support.acces_motif_long': 'le motif tient en quelques lignes : trois cents caractères au plus',
  'console.support.acces_motif_balise': 'le motif s\'écrit sans les signes < ni >',
  'console.support.texte_court': 'note ce que la personne a demandé, avec ses mots : trois caractères au moins',
  'console.support.reponse_courte': 'une réponse : trois caractères au moins',
  'console.contestation.dit_court': 'écris ce que le client conteste (trois caractères au moins)',
  'console.support.article_inconnu': 'cet article n\'est pas dans l\'Aide de l\'application : choisis-en un parmi les réponses types',
});
