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
  // Choisir son offre (1.84.0, 0158) : ce qui est refusé, pourquoi, et ce qui débloque.
  'abonnement.choix.hors': 'cette entreprise n\'a pas d\'abonnement à choisir (offert par SkanFact, tenu par son cabinet, ou un exemple)',
  'abonnement.choix.facture_a_payer': 'ta facture {numero} attend déjà son paiement : règle-la dans « Tes factures », juste au-dessus. Pour changer d\'offre ensuite, écris-nous à contact@skanfact.tn',
  // Les relances par e-mail. Ce qui part chez le relais, compté et décidé (règle du projet ; décidé le 12/10/2026, comme
  // l'alerte de la messagerie du 09/10/2026) : l'adresse de qui gère l'abonnement, un objet, la date d'échéance et
  // l'adresse de l'application. Ni le nom de l'entreprise, ni un identifiant, ni un montant.
  'abonnement.relance.quand.jours': 'dans {jours} jours',
  'abonnement.relance.quand.demain': 'demain',
  'abonnement.relance.quand.aujourdhui': 'aujourd\'hui',
  'abonnement.relance.objet.essai': 'Ton essai de SkanFact se termine {quand}',
  'abonnement.relance.objet.abonnement': 'Ton abonnement à SkanFact se termine {quand}',
  'abonnement.relance.objet.lecture_seule': 'Une de tes entreprises est passée en lecture seule sur SkanFact',
  'abonnement.relance.texte.essai': 'Bonjour,\n\nL\'essai de SkanFact d\'une de tes entreprises se termine le {date}. Pour continuer sans interruption, choisis ton offre dans SkanFact : Paramètres, puis Ton abonnement.\n\n{apres} Tes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  'abonnement.relance.texte.abonnement': 'Bonjour,\n\nL\'abonnement à SkanFact d\'une de tes entreprises se termine le {date}. Pour continuer sans interruption, renouvelle-le dans SkanFact : Paramètres, puis Ton abonnement.\n\n{apres} Tes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  'abonnement.relance.texte.lecture_seule': 'Bonjour,\n\nUne de tes entreprises est passée en lecture seule sur SkanFact le {date}. Tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée. Pour la rouvrir, choisis une offre dans SkanFact : Paramètres, puis Ton abonnement.\n\nTes données restent à toi, et tu peux tout exporter à tout moment.\n\n{lien}',
  // Ce qui suit l'échéance, selon la grâce de cette échéance-là (0104 : une règle de la console, jamais un nombre écrit ici).
  'abonnement.relance.apres.grace_n': 'Après cette date, tout marche encore {jours} jours. Ensuite, l\'entreprise passe en lecture seule : tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée.',
  'abonnement.relance.apres.grace_1': 'Après cette date, tout marche encore un jour. Ensuite, l\'entreprise passe en lecture seule : tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée.',
  'abonnement.relance.apres.sans_grace': 'Dès le lendemain, l\'entreprise passe en lecture seule : tout se lit, s\'imprime et s\'exporte, mais rien de nouveau ne se crée.',
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
  'abonnement.geste.delai_jours': 'un délai se donne en jours entiers, de 1 à {max}',
  'abonnement.geste.delai_etat': 'un délai se donne à une entreprise en grâce, ou en lecture seule après un essai ou une échéance manquée : une suspension se reprend, une résiliation s\'annule',
  'abonnement.geste.mois_actif': 'un mois s\'offre à un abonné dont l\'offre est choisie : il va sur sa prochaine facture',
  'abonnement.geste.mois_resilie': 'cet abonnement est résilié ou suspendu : il n\'a pas de prochaine facture où offrir un mois',
  'abonnement.geste.changer_sans_offre': 'changer d\'offre se fait sur un abonnement payé : pour un essai, l\'offre se choisit en préparant sa facture',
  'abonnement.geste.changer_resilie': 'cet abonnement est résilié : il n\'a plus de prochaine échéance, annule d\'abord la résiliation',
  'abonnement.geste.changer_meme': 'c\'est déjà son offre : choisis-en une autre',
  // Les modules achetés seuls sur Essentiel (14c ; 0099).
  'abonnement.module.paie': 'la paie',
  'abonnement.module.compta': 'la comptabilité complète',
  'abonnement.geste.module': 'le module est « paie » ou « compta »',
  'abonnement.geste.module_complet': 'l\'offre Complet contient déjà la paie et la comptabilité complète : rien à acheter',
  'abonnement.geste.module_deja': '{module} est déjà achetée pour cet abonnement',
  'abonnement.geste.module_pas': '{module} n\'est pas achetée pour cet abonnement',
  'abonnement.geste.module_part_deja': '{module} part déjà au renouvellement',
  'abonnement.geste.module_part_avec_la_periode': '{module} part le {le}, avec la période déjà payée : il se rouvre à partir de ce jour',
  'abonnement.geste.mois_deja': 'un mois offert attend déjà la prochaine facture : un seul à la fois',
  'abonnement.geste.paiement_preuve': 'un paiement reçu dit sa facture (son numéro), le montant reçu, son moyen (virement, chèque, espèces) et son jour : sans eux, rien n\'est payé',
  // Nos factures (docs/abonnement.md B1–B4).
  'abonnement.facture.tenu_par_cabinet': 'ce dossier est tenu par un cabinet : c\'est le cabinet qui le paie, et sa facture viendra avec l\'abonnement des cabinets',
  'abonnement.facture.editeur_lui_meme': 'l\'entreprise SkanFact ne se facture pas à elle-même',
  'abonnement.facture.sans_prix': 'aucun prix du jour pour cette offre et cette périodicité : la grille se règle dans les Réglages de la console',
  'abonnement.facture.deja_emise': 'la facture de cette période est déjà émise ({numero}) : elle ne se refait pas',
  'abonnement.facture.deja_preparee': 'la facture de cette période est déjà préparée : elle attend son émission dans SkanFact (pour la refaire, supprime d\'abord son brouillon)',
  // Deux périodes payées d'avance (l'audit de la console 1.42.0, A01) : un seul changement attend son jour.
  'abonnement.facture.deux_changements': 'une période déjà payée attend son premier jour, le {le}, en {offre} : une facture d\'une autre offre (ou d\'une autre durée) se prépare une fois ce jour passé, ou dans la même offre',
  'abonnement.geste.deux_changements': 'une période déjà payée attend son premier jour, le {le}, en {offre} : un paiement d\'une autre offre (ou d\'une autre durée) se note une fois ce jour passé, ou dans la même offre',
  // Ce que la facture d'un abonnement écrit (en français : sa langue).
  'abonnement.facture.objet': 'Abonnement SkanFact du {du} au {au}',
  'abonnement.facture.ligne': 'SkanFact {offre} — abonnement {periodicite}',
  'abonnement.facture.periode': 'Du {du} au {au}',
  'abonnement.facture.periode_offert': 'Du {du} au {au}, dont un mois offert',
  'abonnement.facture.offre.essentiel': 'Essentiel',
  'abonnement.facture.offre.complet': 'Complet',
  'abonnement.facture.periodicite.annuel': 'annuel',
  'abonnement.facture.periodicite.mensuel': 'mensuel',
  // Ce qui s'ajoute à l'offre sur la facture (14c ; 0099).
  'abonnement.facture.option.module_paie': 'Module Paie (acheté seul)',
  'abonnement.facture.option.module_compta': 'Module Comptabilité complète (acheté seul)',
  'abonnement.facture.option.salarie': 'Salarié au-delà de l\'offre',
  'abonnement.facture.option.caisse': 'Caisse au-delà de l\'offre',
  'abonnement.facture.option.etablissement': 'Établissement au-delà de l\'offre',
  'abonnement.facture.au_dela': '{compte} au total, dont {inclus} dans l\'offre ; du {du} au {au}',
  // Le rattrapage d'un module ouvert pendant la période payée (0113) : au prorata de ses jours.
  'abonnement.facture.option.rattrapage_paie': 'Module Paie, ouvert en cours de période (rattrapage)',
  'abonnement.facture.option.rattrapage_compta': 'Module Comptabilité complète, ouvert en cours de période (rattrapage)',
  'abonnement.facture.rattrapage': 'Du {du} au {au} : {jours} jours sur {sur}, au prorata',
  'abonnement.facture.remise.groupe': 'Remise de groupe de {taux} % ({groupe}) : la première société abonnée du groupe paie le prix normal.',
  'abonnement.facture.remise.cabinet': 'Remise de {taux} % la première année : client venu par le cabinet {cabinet}.',
  // L'abonné règle sa facture (docs/abonnement.md B5).
  'abonnement.facture.inconnue': 'cette facture n\'est pas une facture émise de ton abonnement',
});
