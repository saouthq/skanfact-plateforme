# Le pont de la v10 : ce que l'interface demandait à l'ordinateur, et ce que la plateforme en fait

*28/09/2026, brique 28. Tenu à jour à chaque fonction branchée.*

Dans la v10, dès qu'un écran a besoin de l'ordinateur (lire le fichier de données, enregistrer un
CSV, ouvrir un mail, imprimer…), il le demande à son « pont » (`window.skanfact`). Sur la
plateforme, ce pont est `web/public/plateforme/pont.js` : c'est **le seul endroit** où le
branchement change ; les écrans restent le code de la v10.

L'inventaire complet (lu dans le code par quatre lecteurs, le 28/09/2026) compte **94 fonctions**
côté entreprise et **145** côté Cabinet. Ce document dit où en est chacune, côté entreprise ; le
Cabinet n'est pas encore repris.

## 1. Branché au serveur

| Fonction | Ce qu'elle fait sur la plateforme | Prouvé par |
|---|---|---|
| `loadData` | Lit le dossier de l'entreprise sur le serveur (amorcé la première fois par sa fiche et ses clients) | `tests/v10/dossier.test.ts` |
| `saveData` | N'envoie que les objets changés, avec leur révision ; si un autre a changé le même objet, la v10 reçoit un conflit, fusionne, le dit, et la version du serveur gagne (l'autre est mise de côté) | `dossier.test.ts`, parcours « deux onglets » |
| `emettre` (nouvelle) | La facture s'émet par le serveur : numéro de la série FAC, net à payer vérifié au millime de l'écran, pièce scellée | `dossier.test.ts`, parcours à la souris |
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
cabinet, abonnement, import d'un fichier qui remplace tout, nommer l'appareil, retirer une
entreprise de la liste. Le refus dit ce qui n'existe pas encore et que **rien n'a été fait**.

## 4. Caché : sans objet sur la plateforme

Panneaux des Paramètres (et leurs entrées de la palette Ctrl K) : dossiers de l'ordinateur,
sauvegardes du disque, copie externe, mot de passe du fichier, lecture par photo, « Tout effacer »,
cabinet (appairage par fichier), mises à jour, licence, éditeur, pièces jointes, dépannage.
« Modifier quand même… » sur une facture émise a disparu : le serveur la scelle.

## 5. Reste à faire (connu, écrit ici pour ne pas l'oublier)

- **Les PDF** : `exportPdfSilent` et `exportPdfMany` ne font rien ; un envoi par mail ou WhatsApp
  part sans le PDF. À faire : les PDF fabriqués par le serveur.
- **Les sauvegardes d'UNE entreprise** vues par la personne (`createBackup`, `listBackups`,
  `peekBackup`, `restoreBackup`) : le serveur sait exporter et restaurer une entreprise, pas encore
  depuis l'écran.
- **Hors ligne** : le pont ne garde pas encore les changements faits pendant une coupure
  (`docs/cadrage/04-hors-ligne-et-synchro.md` du dépôt `skanfact`).
- **Les gros dossiers** : le dossier se charge en entier ; à mesurer (la règle : toute liste se
  pagine).
- **L'avoir** s'émet encore par la v10 : le serveur le refuse et le dit (`v10.avoir_pas_encore`).
- La version affichée au pied de la barre (« vdev »), le journal des erreurs du serveur
  (`supportInfo`, `supportErreur`), l'historique des nouveautés (`changelog`).
- **Le Cabinet** : ses 145 fonctions demandent d'abord un livre comptable d'un dossier sur le
  serveur. C'est un chantier à part, pas un branchement.
