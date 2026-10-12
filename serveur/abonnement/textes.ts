// Les textes de l'abonnement (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  // Le refus d'un geste en lecture seule : ce qui est refusé, pourquoi, et ce qui rouvre (règle du projet).
  'abonnement.lecture_seule.essai_termine': 'cette entreprise est en lecture seule depuis le {depuis} : son essai est terminé. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en choisissant une offre (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.non_renouvele': 'cette entreprise est en lecture seule depuis le {depuis} : son abonnement n\'a pas été renouvelé. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en renouvelant l\'abonnement (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.resilie': 'cette entreprise est en lecture seule depuis le {depuis} : son abonnement a été résilié. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en choisissant une offre (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.suspendu': 'cette entreprise est en lecture seule depuis le {depuis} : SkanFact a suspendu son abonnement. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Écris-nous à contact@skanfact.tn pour la rouvrir',
  // Les relances par e-mail. Ce qui part chez le relais, compté et décidé (règle du projet ; décidé le 12/10/2026, comme
  // l'alerte de la messagerie du 09/10/2026) : l'adresse de qui gère l'abonnement, un objet, la date d'échéance et
  // l'adresse de l'application. Ni le nom de l'entreprise, ni un identifiant, ni un montant.
  'abonnement.relance.quand.jours': 'dans {jours} jours',
  'abonnement.relance.quand.demain': 'demain',
  'abonnement.relance.quand.aujourdhui': 'aujourd\'hui',
  'abonnement.relance.objet.essai': 'Ton essai de SkanFact se termine {quand}',
  'abonnement.relance.objet.abonnement': 'Ton abonnement à SkanFact se termine {quand}',
  'abonnement.relance.objet.lecture_seule': 'Une de tes entreprises est passée en lecture seule sur SkanFact',
  'abonnement.relance.texte.essai': 'Bonjour,\n\nL\'essai de SkanFact d\'une de tes entreprises se termine le {date}. Pour continuer sans interruption, choisis ton offre dans SkanFact : Paramètres, puis Ton abonnement.\n\nAprès cette date, tout marche encore sept jours. Ensuite, l\'entreprise passe en lecture seule : tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Tes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  'abonnement.relance.texte.abonnement': 'Bonjour,\n\nL\'abonnement à SkanFact d\'une de tes entreprises se termine le {date}. Pour continuer sans interruption, renouvelle-le dans SkanFact : Paramètres, puis Ton abonnement.\n\nAprès cette date, tout marche encore sept jours. Ensuite, l\'entreprise passe en lecture seule : tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Tes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  'abonnement.relance.texte.lecture_seule': 'Bonjour,\n\nUne de tes entreprises est passée en lecture seule sur SkanFact le {date}. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Pour la rouvrir, choisis une offre dans SkanFact : Paramètres, puis Ton abonnement.\n\nTes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  'abonnement.relance.bouton': 'Ouvrir SkanFact',
});
