// Les textes du socle : ce que le serveur dit de lui-même (connexion, porte, file, champs), les noms
// des rôles et ce que fait chacun des gestes du socle. Un module déclare les siens de la même façon.

import { declarerTextes } from './textes.ts';

declarerTextes({
  // ── Le serveur ──────────────────────────────────────────────────────────────────────────────
  'commun.introuvable': 'introuvable',
  'commun.refuse': 'refusé',
  'commun.erreur_serveur': 'une erreur est survenue de notre côté. Elle est notée ; réessaie dans un instant',
  'commun.connexion_requise': 'connecte-toi pour continuer',
  'commun.code_requis': 'mets d\'abord en place le code sur ton téléphone : ton rôle l\'exige',
  'commun.perimee': 'cette pièce a changé depuis que tu l\'as ouverte : recharge-la avant de la modifier',
  'commun.champ_invalide': 'le champ « {champ} » ne va pas : {raison}',

  // ── Ce qu'un champ a de travers (les vérifications des données reçues) ──────────────────────
  'champ.manquant': 'il manque',
  'champ.type': 'ce n\'est pas le bon genre de valeur',
  'champ.trop_court': 'il faut au moins {min} caractère(s)',
  'champ.trop_long': 'pas plus de {max} caractères',
  'champ.trop_petit': 'la valeur doit être au moins {min}',
  'champ.trop_grand': 'la valeur doit être au plus {max}',
  'champ.pas_assez': 'il en faut au moins {min}',
  'champ.trop_nombreux': 'pas plus de {max}',
  'champ.email': 'une adresse e-mail est attendue',
  'champ.identifiant': 'un identifiant est attendu',
  'champ.format': 'la forme ne va pas',
  'champ.choix': 'la valeur doit être l\'une de : {valeurs}',
  'champ.inconnus': 'champs inconnus : {cles}',
  'champ.valeur': 'valeur invalide',
  'champ.jour': 'un jour du calendrier (AAAA-MM-JJ)',
  'champ.code_regle': 'un code de règle (ex. « rs.taux »)',
  'champ.prefixe': '1 à 10 lettres majuscules ou chiffres',

  // ── La connexion ────────────────────────────────────────────────────────────────────────────
  'connexion.refusee': 'l\'adresse ou le mot de passe ne correspond pas',
  'connexion.trop_essais_une': 'trop d\'essais : réessaie dans {minutes} minute. Ton compte n\'est pas bloqué',
  'connexion.trop_essais': 'trop d\'essais : réessaie dans {minutes} minutes. Ton compte n\'est pas bloqué',
  'connexion.sms': 'Ton code SkanFact : {code}',
  'connexion.code_perime': 'ce code n\'est plus valable : recommence la connexion',
  'connexion.code_faux': 'ce code ne correspond pas',
  'mot_de_passe.trop_court': 'ton mot de passe doit faire au moins {min} caractères',
  'mot_de_passe.vole': 'ce mot de passe figure dans une liste de mots de passe déjà volés : choisis-en un autre',

  // ── La porte des droits ─────────────────────────────────────────────────────────────────────
  'porte.geste_inconnu': 'geste inconnu : {geste}',
  'porte.role_refuse': 'ton rôle ({roles}) ne permet pas {de:geste}',
  'porte.role_refuse_qui': 'ton rôle ({roles}) ne permet pas {de:geste}. Peuvent le faire : {noms}',
  'porte.aucun_role': 'aucun rôle ici',
  'porte.cle_refuse': 'cette clé de l\'API ne permet pas {de:geste}',
  'porte.cle_personnelle': 'une clé de l\'API n\'agit pas pour une personne : ce geste lui est fermé',
  'api.trop_d_appels': 'trop d\'appels avec cette clé : réessaie dans {secondes} secondes',
  'api.trop_d_appels_une': 'trop d\'appels avec cette clé : réessaie dans une seconde',

  // ── La documentation de l'API ───────────────────────────────────────────────────────────────
  'doc.public': 'sans connexion',
  'doc.personnel': 'pour la personne connectée, sur son compte',
  'doc.jeton': 'le jeton d\'une session (après connexion), ou une clé de l\'API (skf_…)',

  // ── Les clés de l'API (03 § 8) ──────────────────────────────────────────────────────────────
  'cles.geste_inconnu': 'geste inconnu : {geste}',
  'cles.geste_ferme': 'le geste {geste} ne se donne jamais à une clé de l\'API',
  'cles.geste_non_permis': 'tu ne peux pas donner à une clé le geste {geste} : ton rôle ne le permet pas',
  'cles.expiration': 'une clé expire dans l\'année : entre demain et {jours} jours',

  // ── La file des postes ──────────────────────────────────────────────────────────────────────
  'file.sans_appareil': 'cette session n\'est rattachée à aucun appareil : reconnecte-toi depuis le poste',
  'file.autre_appareil': 'cet identifiant de geste appartient à un autre appareil',
  'file.ordre_servi': 'le numéro d\'ordre {ordre} a déjà servi à un autre geste de cet appareil',
  'file.manque': 'il manque le geste n° {numero} de cet appareil : il faut l\'envoyer d\'abord',
  'file.geste_inconnu': 'ce serveur ne connaît pas le geste « {geste} » : l\'application est peut-être plus récente que lui',
  'file.format_inconnu': 'le format {format} de ce geste n\'est pas lu par ce serveur',
  'file.illisible': 'le geste est illisible : le champ « {champ} » ne va pas ({raison})',
  'file.plus_membre': 'tu ne fais plus partie de cette entreprise',
  'file.erreur': 'une erreur est survenue de notre côté ; le geste n\'a pas été noté, il repartira tout seul',

  // ── Le journal inaltérable ──────────────────────────────────────────────────────────────────
  'journal.piece_disparue': 'une pièce scellée a disparu',
  'journal.piece_modifiee': 'une pièce a été modifiée après son scellé',

  // ── Les règles et les séries ────────────────────────────────────────────────────────────────
  'regles.code_et_date': 'il faut un code de règle et une date (AAAA-MM-JJ)',
  'regles.non_renseignee': 'règle non renseignée à cette date',
  'series.date_requise': 'il faut la date de la pièce (AAAA-MM-JJ)',
  'series.annee_requise': 'une série qui repart à 1 chaque année écrit l\'année dans son numéro ({AAAA})',

  // ── Les rôles (03 § 2 et § 3) ───────────────────────────────────────────────────────────────
  'role.proprietaire': 'Propriétaire',
  'role.administrateur': 'Administrateur',
  'role.commercial': 'Commercial',
  'role.caissier': 'Caissier',
  'role.serveur': 'Serveur',
  'role.magasinier': 'Magasinier',
  'role.comptabilite_interne': 'Comptabilité interne',
  'role.paie': 'Paie',
  'role.lecture': 'Lecture',
  'role.supervision': 'Associé',
  'role.revision': 'Collaborateur',
  'role.saisie': 'Assistant de saisie',

  // ── Ce que fait chaque geste du socle (« ton rôle ne permet pas de … ») ────────────────────
  'geste.socle.accueil.voir': 'voir l\'accueil',
  'geste.socle.fiche_societe.modifier': 'modifier la fiche de la société',
  'geste.socle.rib_societe.modifier': 'modifier le RIB de la société',
  'geste.socle.reglages_fiscaux.modifier': 'modifier le régime fiscal, l\'exercice ou les séries',
  'geste.socle.equipe.gerer': 'inviter, retirer un membre ou changer un rôle',
  'geste.socle.propriete.transferer': 'transférer la propriété',
  'geste.socle.offre.changer': 'changer d\'offre ou acheter un module',
  'geste.socle.abonnement.payer': 'payer une échéance de l\'abonnement',
  'geste.socle.cabinet.choisir': 'choisir le cabinet ou arrêter son mandat',
  'geste.socle.support.autoriser': 'accorder un accès au support',
  'geste.socle.export_complet': 'exporter toute l\'entreprise',
  'geste.socle.audit.lire': 'lire la trace de toute l\'entreprise',
  'geste.socle.abonnement.resilier': 'résilier l\'abonnement',
  'geste.socle.cles_api.gerer': 'gérer les clés de l\'API',
});
