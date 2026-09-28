// Les textes de l'entrée (14 § 5) : se connecter, créer son compte, le code du téléphone, la porte de
// la première fois. Chaque phrase qu'une personne lit vient du catalogue commun. Ceux de
// l'application elle-même sont ceux de la v10, dans son code repris tel quel (public/v10).
import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'ecran.explication': 'explication : {sujet}',
  'ecran.quest_ce': 'qu\'est-ce que c\'est ?',
  'ecran.fermer': 'fermer',
  'ecran.erreur_reseau': 'le serveur ne répond pas : vérifie ta connexion, puis réessaie',
  'ecran.erreur_serveur': 'le serveur a rencontré une erreur : réessaie dans un instant',
  'ecran.deconnexion': 'se déconnecter',
  // La phrase d'accueil de la v10, sous le titre de chaque carte.
  'ecran.accueil.sous': 'tes devis, tes factures et ta gestion, en main dès aujourd\'hui',

  'ecran.connexion.titre': 'se connecter à SkanFact',
  'ecran.connexion.email': 'adresse e-mail',
  'ecran.connexion.email_aide': 'celle avec laquelle tu as créé ton compte',
  'ecran.connexion.mot_de_passe': 'mot de passe',
  'ecran.connexion.mot_de_passe_aide': 'il n\'est jamais gardé en clair, pas même par nous',
  'ecran.connexion.poste_autre': 'je suis sur le poste de quelqu\'un d\'autre',
  'ecran.connexion.poste_autre_aide': 'la session se fermera après 30 minutes sans activité, et cet appareil ne sera pas retenu',
  'ecran.connexion.bouton': 'se connecter',
  'ecran.connexion.creer_compte': 'je n\'ai pas encore de compte',

  'ecran.inscription.titre': 'créer ton compte',
  'ecran.inscription.nom': 'ton nom',
  'ecran.inscription.nom_aide': 'tel que ton équipe le lira',
  'ecran.inscription.mot_de_passe_aide': 'au moins {min} caractères ; un mot de passe déjà volé ailleurs est refusé',
  'ecran.inscription.bouton': 'créer mon compte',
  'ecran.inscription.deja': 'j\'ai déjà un compte',
  'ecran.inscription.faite': 'ton compte est créé : connecte-toi',

  'ecran.code.titre': 'le code de ton téléphone',
  'ecran.code.application': 'ouvre ton application d\'authentification et tape le code de SkanFact',
  'ecran.code.sms': 'nous venons de t\'envoyer un code par SMS',
  'ecran.code.champ': 'code',
  'ecran.code.champ_aide': 'six chiffres, ou l\'un de tes codes de secours',
  'ecran.code.bouton': 'valider le code',
  'ecran.code.retour': 'retour à la connexion',

  'ecran.code_requis.titre': 'mets en place le code sur ton téléphone',
  'ecran.code_requis.aide': 'ton rôle l\'exige : sans ce code, personne ne peut agir à ta place, même avec ton mot de passe',
  'ecran.code_requis.bouton': 'mettre en place le code',
  'ecran.code_pose.titre': 'ajoute SkanFact à ton application d\'authentification',
  'ecran.code_pose.application': 'dans ton application, ajoute un compte avec cette adresse',
  'ecran.code_pose.secours': 'tes codes de secours, à garder à part : ils ne se montreront plus',
  'ecran.code_pose.bouton': 'j\'ai noté mes codes',

  // La porte de la v10 (10.14.0), pour qui n'a encore aucune entreprise.
  'ecran.porte.titre': 'bienvenue dans SkanFact',
  'ecran.porte.deux_facons': 'deux façons de commencer — et tu peux faire l\'une puis l\'autre',
  'ecran.porte.recommande': 'recommandé',
  'ecran.porte.essai_titre': 'découvrir avec une entreprise d\'essai',
  'ecran.porte.essai_texte': 'une entreprise à part, avec trois clients d\'exemple : tu essaies tout, factures comprises, sans rien risquer. Elle reste une entreprise d\'essai pour toujours',
  'ecran.porte.essai_meta': '3 clients d\'exemple',
  'ecran.porte.essai_bouton': 'commencer la découverte',
  'ecran.porte.demarrer_titre': 'commencer avec mon entreprise',
  'ecran.porte.demarrer_texte': 'ta raison sociale et ton matricule fiscal : ce qui s\'imprimera en haut de chaque facture. Le reste se règle ensuite dans l\'application',
  'ecran.porte.demarrer_meta': 'une question',
  'ecran.porte.entreprise_titre': 'ton entreprise',
  'ecran.porte.entreprise_sous': 'ce qui s\'imprimera en haut de chaque document',
  'ecran.porte.raison': 'raison sociale',
  'ecran.porte.raison_aide': 'le nom exact de l\'entreprise, forme juridique comprise',
  'ecran.porte.matricule': 'matricule fiscal',
  'ecran.porte.matricule_aide': 'il est obligatoire sur une facture en Tunisie : si tu ne l\'as pas encore, laisse vide et complète-le avant ta première facture',
  'ecran.porte.retour': 'retour',
  'ecran.porte.creer': 'créer mon entreprise',
});
