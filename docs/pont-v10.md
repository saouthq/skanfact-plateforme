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
| `dessinerPaiement` (nouvelle) | Paramètres → Documents → « Paiement en ligne » : brancher le compte Konnect de l'entreprise (la clé scellée par le serveur, jamais relue), voir les paiements demandés, arrêter (brique 78, `docs/paiement-en-ligne.md`) | `tests/v10/paiement-en-ligne.test.ts`, parcours à la souris |
| `lienClient` (nouvelle) | Sur une facture ou un avoir émis, « Plus » → « Lien pour le client… » : le lien de la pièce ou du compte, les liens déjà donnés (« Vu le … »), « Retirer » ; le client voit la pièce comme imprimée et ce qu'il doit (brique 77, `docs/espace-client.md`) | `tests/v10/espace-client.test.ts`, parcours à la souris |
| `ajouterLien`, `sansPieceJointe`, `lienBascule` (nouvelles) | « Envoyer par email… » et « Envoyer par WhatsApp… » d'une facture ou d'un avoir émis : la case « Ajouter le lien de la pièce » ; le lien se crée au clic qui ouvre le message et note son canal ; sa phrase se place avant la formule de politesse, et dit « la régler en ligne » quand le serveur le dit ; « Veuillez trouver ci-joint » devient « Voici » (brique 79, `docs/espace-client.md`, E7) | `tests/v10/espace-client.test.ts`, parcours à la souris (`tests/web/envois.test.ts`) |
| `teifDuServeur` (nouvelle) | « Fichier pour El Fatoora » télécharge le fichier TEIF que le serveur a écrit à l'émission (celui qui sera signé et envoyé) ; soumise à la facture électronique, une pièce dont le fichier serait refusé ne s'émet pas, et l'écran le dit avant le numéro (brique 80, `docs/facture-electronique.md`) | `tests/v10/efacture.test.ts`, parcours à la souris (`tests/web/efacture.test.ts`) |
| `dessinerSignataire` (nouvelle) | Paramètres → Documents → « Facture électronique (El Fatoora) » → « Qui signe les pièces (DigiGo) » : l'identifiant DigiGo du signataire, gardé par le serveur (un champ sans nom, hors de la fiche) (brique 81, `docs/facture-electronique.md`) | `tests/v10/signature.test.ts`, parcours à la souris (`tests/web/signature.test.ts`) |
| `signerPiece` (nouvelle) | Sur une facture ou un avoir émis, « Plus » → « Signer (DigiGo)… » : le code envoyé au signataire, tapé, signe le fichier du serveur ; les refus avec leur bouton (« Désigner le signataire », « Envoyer un nouveau code ») (brique 81) | `tests/v10/signature.test.ts`, parcours à la souris |
| `dessinerTtn` (nouvelle) | Paramètres → Documents → « Facture électronique (El Fatoora) » → « L'envoi à la TTN » : le compte El Fatoora de l'entreprise (le mot de passe scellé par le serveur, jamais relu), son dernier refus, les derniers envois (brique 82, `docs/facture-electronique.md`) | `tests/v10/ttn.test.ts`, parcours à la souris (`tests/web/ttn.test.ts`) |
| `ttnDansLaFenetre` (nouvelle) | Dans « Le fichier El Fatoora est prêt » d'une pièce signée : où en est son envoi à la TTN (en route et ce qui la retient, déposée, acceptée avec sa référence, refusée), et le bouton qui débloque (« Brancher le compte El Fatoora », « Renvoyer à la TTN ») (brique 82) | `tests/v10/ttn.test.ts`, parcours à la souris |
| `SkanQr` (nouveau fichier, `plateforme/qr.js`) | Le point d'extension du moteur qui dessine un code QR (`SkanCore.qrImage`), branché au chargement (`loadData`) et dans l'espace client : la pièce imprimée d'une facture acceptée par la TTN porte sa référence et son code QR (brique 83, `docs/facture-electronique.md`) ; le dessin vient de `tiers/qrcode.js`, recopié tel quel | `tests/v10/espace-client.test.ts`, `tests/socle/tiers.test.ts`, parcours à la souris (`tests/web/ttn.test.ts`, relu par un lecteur de QR) |
| `ocrStatus`, `ocrPick`, `ocrRead`, `lectureSurLeServeur`, `piecesJointes` | La lecture d'une facture d'achat en photo ou en PDF **par le serveur de SkanFact** (brique 84, `docs/achats.md`) : le serveur dit s'il sait lire (et si la personne a le geste) ; le fichier choisi (l'appareil photo sur un téléphone, 10 Mo au plus) part tel quel et revient une proposition (où chaque champ a été lu, le recomptage), que la fenêtre de la v10 fait relire ; les pièces jointes n'étant pas encore en ligne, la lecture n'essaie pas d'y ranger le fichier | `tests/achats/lecture.test.ts`, parcours à la souris (`tests/web/lecture-photo.test.ts`) |
| `externalBackupInfo` | L'étape « Mettre tes données à l'abri » est faite : les données sont sur le serveur | — |

## 2. Fait par le navigateur

| Fonction | Sur la plateforme |
|---|---|
| `saveText`, `saveTextSilent`, `exportData` | Le fichier (CSV, XML El Fatoora, export complet) se **télécharge** sous son nom |
| `openText`, `pickLogo` | Le sélecteur de fichier du navigateur ; un classeur Excel (.xlsx) se lit **dans le navigateur** (brique 85), par le lecteur que l'entreprise partage avec le Cabinet (`plateforme/tableur.js`, puis `lireFichierTexte` de la v10) : importer ses clients ou son catalogue (« Ouvrir un fichier Excel ou CSV… ») ; un classeur LibreOffice (.ods), un ancien .xls ou un classeur qui gonfle une fois ouvert se refusent avec la phrase de la v10 et le geste qui marche |
| `composeMail` | Le message s'ouvre dans la messagerie de l'appareil (lien « mailto »), **sans pièce jointe** ; pour une facture ou un avoir émis, il porte le lien de la pièce (`ajouterLien`, brique 79) ; aucune question « Mail ou une autre messagerie » |
| `ouvrirWhatsApp` | La conversation WhatsApp s'ouvre dans un nouvel onglet (ouvert pendant le geste quand le lien de la pièce se crée d'abord) ; défaut corrigé à la brique 79 : l'ouverture était toujours dite « bloquée » (`noopener` fait rendre null à `window.open`) |
| `setDirty` | Fermer l'onglet en pleine saisie : le navigateur demande d'abord |
| `exportPdf`, `imprimerTicket` | La fenêtre d'impression du navigateur (« Enregistrer au format PDF ») : le repli de la v10 |

## 3. Refusé avec sa phrase (pas encore en ligne)

Pièces jointes (le panneau est caché), la clé d'un service de lecture à l'étranger (la lecture des factures
se fait sur le serveur de SkanFact : brique 84), paquet et réponses du
cabinet, **la caisse** (« Encaisser » et le retour d'un ticket, jusqu'à l'étape 4), abonnement, import d'un fichier qui remplace tout, nommer l'appareil, retirer une
entreprise de la liste. Le refus dit ce qui n'existe pas encore et que **rien n'a été fait**.

## 4. Caché : sans objet sur la plateforme

Panneaux des Paramètres (et leurs entrées de la palette Ctrl K) : dossiers de l'ordinateur,
sauvegardes du disque, copie externe, mot de passe du fichier, la clé de la lecture par photo (un service
à l'étranger : sur la plateforme, c'est le serveur qui lit), « Tout effacer »,
mises à jour, licence, éditeur, pièces jointes, dépannage.
Le panneau « Ton cabinet comptable » ne parle plus d'appairage : le propriétaire y confie son
dossier par le code du cabinet (brique 37).
Un panneau de plus en tête de l'onglet « Données et sécurité » : **« Tes appareils »** (brique 74,
dessiné par le pont, `dessinerAppareils`) : chaque appareil où la personne s'est connectée, celui-ci
marqué ; « Retirer… » demande d'abord, puis l'appareil ne peut plus rien ouvrir, et ce qu'il garde
s'efface à sa prochaine connexion (`docs/hors-ligne.md`, H9). Au-dessus, quand un appareil retiré a
remis ce qu'il avait fait hors ligne : **« Remis par un appareil retiré »** (brique 74 bis,
`dessinerQuarantaine`), pour accepter ou rejeter (H10) ; le bandeau du poste y mène (« Voir », par
`window.__allerParametres`, posé par une adaptation).
« Modifier quand même… » et « Marquer annulée… » sur une facture émise ont disparu : le serveur la
scelle, et un avoir la corrige (un avoir total la solde : « annulée » se déduit).

## 4 bis. Deux postes sur le même dossier (brique 112, 01/10/2026)

Le point de contact garde ce que le serveur a de chaque objet (`vu`) et l'envoie avec sa révision ; le serveur
refuse un objet changé ailleurs (409), le point de contact relit le dossier et le rend à la v10, qui fusionne
(`mergeData`) puis réenregistre. Le défaut : la relecture remplaçait `vu` AVANT que la page ait fusionné. Un
enregistrement parti entre les deux (les données d'avant le conflit) se comparait au `vu` neuf :
- il **supprimait** ce qu'un autre poste venait de créer (la page ne l'avait jamais eu) ;
- il **écrasait** ce qu'un autre poste venait de changer (avec la révision du serveur : pas de conflit).
Vu en CI (un poste lent) : l'article posé par un autre disparaissait (`tests/web/accords.test.ts`), le compte Konnect
créé par le serveur aussi (`tests/web/jalon-j2.test.ts`) ; reproduit pas à pas, sans minutage, par
`tests/web/enregistrement-concurrent.test.ts`.

La règle : le point de contact retient la révision de chaque objet **telle que la page l'a eue** (`base`), et c'est
elle qui part. Elle naît quand la page reçoit le dossier (ouverture, copie du poste, reprise de ce qui attendait), et
suit chaque envoi réussi et chaque pièce émise ; un objet que la page a à l'identique du serveur (une fusion le lui a
donné) prend la révision du serveur. Un objet que la page n'a jamais eu ne se supprime pas ; un objet changé ailleurs
part avec la révision d'avant, et le serveur le refuse : conflit, fusion, rien d'écrasé.

## 4 ter. L'ordre du dossier reçu (01/10/2026)

La vraie cause des trois rouges vus seulement chez GitHub (l'article invisible de `tests/web/accords.test.ts`, le compte
Konnect supprimé du jalon J2, la suppression qui ne partait pas de `tests/web/enregistrement-concurrent.test.ts`) : la
**langue de la base**. Une liste vide s'enregistre à la racine (`_racine/accounts` = []) ; quand un objet y entre par
un autre chemin (le serveur crée le compte Konnect, un test pose un article), la liste vide reste. Le serveur rendait
le dossier rangé par `collection` : avec la langue « C » d'ici, « _racine » vient avant « accounts » ; avec « en_US »
(la base de GitHub, et de bien des serveurs), la ponctuation est ignorée et « _racine » vient **après** « accounts » et
« catalog ». La liste vide arrivait après ses objets et les recouvrait : la page ne les voyait pas, et son
enregistrement suivant les supprimait (le point de contact, lui, les avait dans `vu`).

La règle, des deux côtés :
- le serveur rend la racine d'abord, puis les listes, rangées en « C » (`lireDossier`) : un ordre qui ne dépend pas
  de la base ;
- le point de contact assemble la racine d'abord, quel que soit l'ordre reçu : une liste vide ne recouvre jamais les
  objets de sa liste ;
- la base des tests range désormais comme « en_US » (ICU, la ponctuation ignorée : `tests/preparer-base.ts`) : ce qui
  dépendrait de l'ordre de la base tombe ici aussi.

Tests : `tests/v10/ordre-dossier.test.ts` (la racine d'abord), `tests/web/ordre-dossier.test.ts` (la réponse remise
exprès dans le pire ordre : la page voit le compte et l'article, et son enregistrement ne supprime rien).

## 4 quater. La virgule des champs de nombre (05/10/2026)

Vu sur le serveur d'essai, en tapant une facture au clavier comme un commerçant : « 38,475 » tapé dans un prix devenait
**38 475**, et la facture 320 497,750 DT au lieu de 320,497 DT. Un champ `type=number` lit ce qu'on y tape dans la
langue du **navigateur**, pas dans celle de la page (`<html lang="fr">` n'y change rien) : réglé en anglais ou en
arabe, la virgule y est un séparateur de milliers, avalé sans un mot. La v10 l'avait déjà rencontré (10.12.0, H-E28)
et l'avait réglé en imposant le français à tout le programme de bureau (`--lang=fr-FR`) ; dans un navigateur, la page
ne choisit pas sa langue, et la plateforme avait perdu cette garantie.

Elle revient par `web/public/plateforme/virgule.js`, chargé avant tout le reste dans la page de l'entreprise : ce qu'on
tape ou colle dans un champ de nombre y passe d'abord ; la (dernière) virgule devient le point décimal, que tous les
navigateurs lisent pareil, et les points d'avant elle, qui séparaient les milliers (« 1.250,500 »), s'en vont ; le
point tapé sans virgule reste tel quel (« 1.250 » = un dinar deux cent cinquante, comme sur une étiquette). Aucun
écran de la v10 n'est touché. Le Cabinet ne le charge pas : ses champs de nombre sont tous entiers (jours, enfants,
mois), et ses montants sont des champs de texte qui lisent déjà la virgule eux-mêmes ; s'il gagne un champ de nombre
décimal, il le chargera.

Test : `tests/web/virgule.test.ts`, dans un navigateur lancé en anglais : « 2,5 » sacs à « 12,250 » tapés au clavier,
« 1 250,500 » collé d'un tableur et « 2.075,250 » d'un relevé ; la facture et le serveur comptent ces nombres-là.

## 4 quinquies. Les dates des champs du navigateur (05/10/2026)

Même cause, vue sur la péremption d'un article : un champ `type=date` s'affiche et se tape dans la langue du
**navigateur** ; réglé en anglais, « mm/dd/yyyy », où le 05/10 se lit le 10 mai. La v10 n'en a que quelques-uns (la
péremption du départ d'un article, celle d'un lot sur une ligne d'achat ; dans le Cabinet, les bornes d'un rapport, la
date d'un mouvement de banque, les dates d'un abonnement) : toutes ses autres dates sont déjà des champs texte
JJ/MM/AAAA. `web/public/plateforme/dates.js`, chargé dans les pages de l'entreprise ET du Cabinet, fait de chaque champ
`type=date` un champ texte JJ/MM/AAAA, quelle que soit la langue ; sa valeur, lue ou posée par le code de la v10, reste
le jour ISO (AAAA-MM-JJ), comme celle du champ du navigateur. Le jour se lit toujours d'abord (« 5/10/26 »,
« 05102026 ») ; un jour ISO collé tel quel se lit aussi ; un jour qui n'existe pas (31/02) vaut '' et le champ le dit en
quittant la saisie (bordure, bulle). Aucun écran de la v10 n'est touché.

Test : `tests/web/dates.test.ts` (navigateur en anglais : la péremption enregistrée s'affiche 05/11/2026, une date
impossible se voit, « 31122027 » devient 31/12/2027 et le serveur garde 2027-12-31) ; `tests/web/cabinet-abonnements.test.ts`
(la date d'un abonnement du Cabinet, JJ/MM/AAAA).

## 5. Reste à faire (connu, écrit ici pour ne pas l'oublier)

- **Les PDF** : `exportPdfSilent` et `exportPdfMany` ne font rien ; un envoi par mail ou WhatsApp
  part sans le PDF (une facture ou un avoir émis, avec son lien : brique 79). À faire : les PDF
  fabriqués par le serveur.
- **Les sauvegardes d'UNE entreprise** vues par la personne (`createBackup`, `listBackups`,
  `peekBackup`, `restoreBackup`) : le serveur sait exporter et restaurer une entreprise, pas encore
  depuis l'écran.
- **Hors ligne** : l'application s'installe, s'ouvre et se consulte sans réseau depuis la brique 72,
  garde ce qu'on enregistre pendant une coupure et l'envoie au retour depuis la brique 73, et un
  appareil retiré remet ce qui attendait (74 bis) puis efface ce qu'il garde (74) (`docs/hors-ligne.md`) ;
  reste le Cabinet hors ligne.
- **Les gros dossiers** : le dossier se charge en entier ; à mesurer (la règle : toute liste se
  pagine).
- ~~La version affichée au pied de la barre (« vdev »)~~ : faite le 05/10/2026, vue sur le serveur d'essai. Le serveur
  écrit dans chaque page la version du code qui la sert, le jour de l'envoi et le début de son empreinte
  (« v2026.10.05 · a42f308 », `serveur/ecrans.ts`, lue dans git au démarrage, ou donnée par `SKANFACT_VERSION`), et
  `updateVersion` la lit : c'est ce qu'un testeur recopie quand il signale un problème. Les nouveautés de la v10
  décrivent l'application de bureau : la plateforme ne les montre jamais (`sansNouveautesV10` ; vu le même jour, la
  carte « Nouveau dans SkanFact 10.15.0 » s'ouvrait chez qui avait retenu « vdev »). Les tests donnent leur version au
  serveur : les preuves tournent dans une copie sans git. Restent le journal des erreurs du serveur (`supportInfo`,
  `supportErreur`) et l'historique des nouveautés de la plateforme (`changelog`).
- **Le Cabinet** : repris à la brique 37 (`docs/cabinet.md`) ; ses gestes arrivent brique par
  brique (38 à 46).
