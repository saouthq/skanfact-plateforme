# Le pont de la v10 : ce que l'interface demandait à l'ordinateur, et ce que la plateforme en fait

*28/09/2026, brique 28. Tenu à jour à chaque fonction branchée.*

Dans la v10, dès qu'un écran a besoin de l'ordinateur (lire le fichier de données, enregistrer un
CSV, ouvrir un mail, imprimer…), il le demande à son « pont » (`window.skanfact`). Sur la
plateforme, ce pont est `web/public/plateforme/pont.js` : c'est **le seul endroit** où le
branchement change ; les écrans restent le code de la v10.

L'inventaire complet (lu dans le code par quatre lecteurs, le 28/09/2026) compte **94 fonctions**
côté entreprise et **145** côté Cabinet. Ce document dit où en est chacune, côté entreprise ; le
Cabinet a son propre point de contact (`pont-cabinet.js`), décrit dans `docs/cabinet.md`.

## 1. Branché au serveur

| Fonction | Ce qu'elle fait sur la plateforme | Prouvé par |
|---|---|---|
| `loadData` | Lit le dossier de l'entreprise sur le serveur (amorcé la première fois par sa fiche et ses clients) | `tests/v10/dossier.test.ts` |
| `saveData` | N'envoie que les objets changés, avec leur révision ; si un autre a changé le même objet, la v10 reçoit un conflit, fusionne, le dit, et la version du serveur gagne (l'autre est mise de côté) | `dossier.test.ts`, parcours « deux onglets » |
| `emettre` (nouvelle) | La facture et l'avoir s'émettent par le serveur (brique 29 pour l'avoir) : numéro de la série FAC ou AVO, net à payer vérifié au millime de l'écran, pièce scellée ; l'avoir lié à sa facture | `dossier.test.ts`, parcours à la souris |
| `saveData` (règlements) | Les paiements d'une facture émise sont vérifiés et tenus par le serveur (`ventes.reglement`), avec leur trace ; reste, statut et retenue lus par l'API (brique 29, `docs/avoirs-reglements.md`) | `dossier.test.ts`, parcours à la souris |
| `saveData` (achats) | Chaque achat (facture fournisseur, dépense, avoir, acompte), ses lignes et ses règlements sont vérifiés, calculés en entiers et tenus par le serveur (`achats.*`), avec leur trace ; les fournisseurs ont leur fiche ; reste, statut et retenue lus par l'API (brique 30, `docs/achats.md`) | `achats.test.ts`, parcours à la souris |
| `saveData` (paie) | Chaque bulletin est recalculé par le serveur avec le barème qu'il a figé et comparé montant par montant à l'écran (un millime d'écart, rien n'est écrit) ; bulletins et salariés tenus par le serveur (`paie.*`), chaque geste tracé ; bulletins, déclaration CNSS du trimestre et masse salariale lus par l'API, chaque lecture tracée (brique 31, `docs/paie.md`) | `paie.test.ts`, parcours à la souris |
| `listDossiers`, `switchDossier`, `addDossier` | Les « dossiers » de la v10 sont les entreprises du compte : les voir, basculer, en créer une | parcours |
| `deconnecter` (nouvelle) | « Se déconnecter », dans le menu du haut (à la place de « Partager » et « Rejoindre ») | parcours |
| `exemple` (nouvelle) | « Voir un exemple » ouvre l'entreprise d'essai ; jamais de pièces inventées dans une vraie entreprise | parcours « vraie entreprise » |
| `externalBackupInfo` | L'étape « Mettre tes données à l'abri » est faite : les données sont sur le serveur | — |

## 2. Fait par le navigateur

| Fonction | Sur la plateforme |
|---|---|
| `saveText`, `saveTextSilent`, `exportData` | Le fichier (CSV, XML El Fatoora, export complet) se **télécharge** sous son nom |
| `openText`, `pickLogo` | Le sélecteur de fichier du navigateur (un classeur .xlsx se refuse avec sa phrase : l'enregistrer en CSV) |
| `composeMail` | Le message s'ouvre dans la messagerie de l'appareil (lien « mailto »), **sans pièce jointe** |
| `ouvrirWhatsApp` | La conversation WhatsApp s'ouvre dans un nouvel onglet |
| `setDirty` | Fermer l'onglet en pleine saisie : le navigateur demande d'abord |
| `exportPdf`, `imprimerTicket` | La fenêtre d'impression du navigateur (« Enregistrer au format PDF ») : le repli de la v10 |

## 3. Refusé avec sa phrase (pas encore en ligne)

Pièces jointes (le panneau est caché), lecture des factures par photo, paquet et réponses du
cabinet, **la caisse** (« Encaisser » et le retour d'un ticket, jusqu'à l'étape 4), abonnement, import d'un fichier qui remplace tout, nommer l'appareil, retirer une
entreprise de la liste. Le refus dit ce qui n'existe pas encore et que **rien n'a été fait**.

## 4. Caché : sans objet sur la plateforme

Panneaux des Paramètres (et leurs entrées de la palette Ctrl K) : dossiers de l'ordinateur,
sauvegardes du disque, copie externe, mot de passe du fichier, lecture par photo, « Tout effacer »,
mises à jour, licence, éditeur, pièces jointes, dépannage.
Le panneau « Ton cabinet comptable » ne parle plus d'appairage : le propriétaire y confie son
dossier par le code du cabinet (brique 37).
Un panneau de plus en tête de l'onglet « Données et sécurité » : **« Tes appareils »** (brique 74,
dessiné par le pont, `dessinerAppareils`) : chaque appareil où la personne s'est connectée, celui-ci
marqué ; « Retirer… » demande d'abord, puis l'appareil ne peut plus rien ouvrir, et ce qu'il garde
s'efface à sa prochaine connexion (`docs/hors-ligne.md`, H9).
« Modifier quand même… » et « Marquer annulée… » sur une facture émise ont disparu : le serveur la
scelle, et un avoir la corrige (un avoir total la solde : « annulée » se déduit).

## 5. Reste à faire (connu, écrit ici pour ne pas l'oublier)

- **Les PDF** : `exportPdfSilent` et `exportPdfMany` ne font rien ; un envoi par mail ou WhatsApp
  part sans le PDF. À faire : les PDF fabriqués par le serveur.
- **Les sauvegardes d'UNE entreprise** vues par la personne (`createBackup`, `listBackups`,
  `peekBackup`, `restoreBackup`) : le serveur sait exporter et restaurer une entreprise, pas encore
  depuis l'écran.
- **Hors ligne** : l'application s'installe, s'ouvre et se consulte sans réseau depuis la brique 72,
  garde ce qu'on enregistre pendant une coupure et l'envoie au retour depuis la brique 73, et un
  appareil retiré efface ce qu'il garde depuis la brique 74 (`docs/hors-ligne.md`) ; reste le Cabinet
  hors ligne.
- **Les gros dossiers** : le dossier se charge en entier ; à mesurer (la règle : toute liste se
  pagine).
- La version affichée au pied de la barre (« vdev »), le journal des erreurs du serveur
  (`supportInfo`, `supportErreur`), l'historique des nouveautés (`changelog`).
- **Le Cabinet** : repris à la brique 37 (`docs/cabinet.md`) ; ses gestes arrivent brique par
  brique (38 à 46).
