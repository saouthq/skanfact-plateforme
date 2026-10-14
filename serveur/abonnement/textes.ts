// Les textes de l'abonnement (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  // Le refus d'un geste en lecture seule : ce qui est refusé, pourquoi, et ce qui rouvre (règle du projet).
  'abonnement.lecture_seule.essai_termine': 'cette entreprise est en lecture seule depuis le {depuis} : son essai est terminé. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en choisissant une offre (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.non_renouvele': 'cette entreprise est en lecture seule depuis le {depuis} : son abonnement n\'a pas été renouvelé. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en renouvelant l\'abonnement (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.resilie': 'cette entreprise est en lecture seule depuis le {depuis} : son abonnement a été résilié. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Le propriétaire ou un administrateur la rouvre en choisissant une offre (Paramètres, Ton abonnement)',
  'abonnement.lecture_seule.suspendu': 'cette entreprise est en lecture seule depuis le {depuis} : SkanFact a suspendu son abonnement. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Écris-nous à contact@skanfact.tn pour la rouvrir',
  // Un module que l'offre ne contient pas (14c ; serveur/abonnement/offre.ts) : ce qui est refusé, ce qui reste, et qui
  // l'ouvre (règle du projet).
  'abonnement.offre.paie': 'la paie n\'est pas dans l\'offre Essentiel : les salariés, les bulletins, les absences et les avances qui existent se lisent, s\'impriment et se corrigent, mais rien de nouveau ne s\'y crée. Le propriétaire ou un administrateur l\'ouvre en passant à Complet (Paramètres, Ton abonnement)',
  'abonnement.offre.compta': 'la comptabilité complète n\'est pas dans l\'offre Essentiel : les immobilisations qui existent se lisent, s\'impriment et se corrigent, mais aucune nouvelle ne se crée. Ta TVA, tes déclarations, tes écritures et le paquet de ton comptable restent ouverts. Le propriétaire ou un administrateur l\'ouvre en passant à Complet (Paramètres, Ton abonnement)',
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
  // Les gestes de SkanFact sur un abonnement (serveur/abonnement/gestes.ts : l'outil de l'exploitation et la console).
  'abonnement.geste.sans_ligne': 'cette entreprise n\'a pas d\'abonnement (une restauration dans une autre base) : ouvre-lui d\'abord un essai (« prolonger »)',
  'abonnement.geste.jours': 'un essai se prolonge d\'un nombre entier de jours, de 1 à 365',
  'abonnement.geste.offre': 'l\'offre est « essentiel » ou « complet »',
  'abonnement.geste.periodicite': 'la périodicité est « annuel » ou « mensuel »',
  'abonnement.geste.deja_resilie': 'l\'abonnement est déjà résilié (le {le})',
  'abonnement.geste.pas_resilie': 'l\'abonnement n\'est pas résilié',
  'abonnement.geste.deja_suspendu': 'l\'abonnement est déjà suspendu (le {le})',
  'abonnement.geste.pas_suspendu': 'l\'abonnement n\'est pas suspendu',
  'abonnement.geste.deja_offert': 'l\'abonnement est déjà offert',
  'abonnement.geste.pas_offert': 'l\'abonnement n\'est pas offert',
  'abonnement.geste.inconnu': 'ce geste sur un abonnement n\'existe pas',
  // Nos factures (docs/abonnement.md B1–B4).
  'abonnement.facture.tenu_par_cabinet': 'ce dossier est tenu par un cabinet : c\'est le cabinet qui le paie, et sa facture viendra avec l\'abonnement des cabinets',
  'abonnement.facture.editeur_lui_meme': 'l\'entreprise SkanFact ne se facture pas à elle-même',
  'abonnement.facture.sans_prix': 'aucun prix du jour pour cette offre et cette périodicité : la grille se règle dans les Réglages de la console',
  'abonnement.facture.deja_emise': 'la facture de cette période est déjà émise ({numero}) : elle ne se refait pas',
  'abonnement.facture.deja_preparee': 'la facture de cette période est déjà préparée : elle attend son émission dans SkanFact (pour la refaire, supprime d\'abord son brouillon)',
  // Ce que la facture d'un abonnement écrit (en français : sa langue).
  'abonnement.facture.objet': 'Abonnement SkanFact du {du} au {au}',
  'abonnement.facture.ligne': 'SkanFact {offre} — abonnement {periodicite}',
  'abonnement.facture.periode': 'Du {du} au {au}',
  'abonnement.facture.offre.essentiel': 'Essentiel',
  'abonnement.facture.offre.complet': 'Complet',
  'abonnement.facture.periodicite.annuel': 'annuel',
  'abonnement.facture.periodicite.mensuel': 'mensuel',
  // L'abonné règle sa facture (docs/abonnement.md B5).
  'abonnement.facture.inconnue': 'cette facture n\'est pas une facture émise de ton abonnement',
});
