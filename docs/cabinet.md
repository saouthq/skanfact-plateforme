# Le Cabinet sur la plateforme (briques 36 à 46)

*Conception du 29/09/2026 (par délégation : Skander, « toi fait la partie concevoir »). Ce document
dit comment le Cabinet v10 devient celui de la plateforme, dans quel ordre, et pourquoi.*

## Où on en est

- **Le Cabinet v10** (`src/cabinet/` du dépôt `skanfact`, branche `beta`) est une application de
  bureau à part : ≈ 12 000 lignes d'écrans (`renderer/app.js`), son moteur (`cabcore.js`, et
  `compta.js` partagé avec l'entreprise), son magasin chiffré (`cabstore.js`) et ≈ 130 appels vers
  son processus principal (`preload.js` : `window.cabinet.*`). Le cabinet y tient, **dans ses propres
  fichiers**, un livre par dossier et par année ; il le remplit en important les **paquets** que ses
  clients lui envoient (`.skanpack`).
- **La plateforme** tient déjà, pour chaque entreprise, ses pièces et **ses livres** : les écritures
  des ventes, des achats et de la paie, au millime de la v10, validées par période, numérotées,
  scellées dans une chaîne, et contre-passées quand une pièce change (briques 32 à 35,
  `docs/ecritures.md`). Le socle connaît déjà les cabinets, les mandats et leurs affectations
  (`socle.organisation` de type `cabinet`, `socle.mandat`, `socle.mandat_affectation`) : un
  collaborateur voit les entreprises de ses mandats actifs (`socle.mes_entreprises`).

Ce que Skander a décidé (28/09/2026) : **les écrans du Cabinet sont le code du Cabinet v10**, copié
une fois comme celui de l'entreprise, **sans la partie « paquets »** : le cabinet travaille dans les
mêmes données que son client.

## Les principes

- **C1. Un dossier est une entreprise.** Le portefeuille d'un cabinet, ce sont les entreprises dont
  il a un mandat actif, et les **dossiers tenus** (un client pas encore sur SkanFact : une entreprise
  sans membre côté client, créée par le cabinet, `03` § 3.5).
- **C2. Une seule comptabilité par entreprise.** Le « livre du dossier » que le Cabinet v10 tenait
  dans ses fichiers, ce sont **les livres du serveur** de l'entreprise : les écritures que le serveur
  tient au fil des pièces du client, **plus** celles que le cabinet saisit (opérations diverses,
  reprise, à-nouveaux, dotations, inventaire, régularisations). Le client et son cabinet lisent le
  même chiffre ; il n'y a plus rien à envoyer, ni à « relire ».
- **C3. Le code des écrans, copié tel quel.** `src/cabinet/renderer` (et ce qu'il charge de
  `src/renderer`) est copié par `npm run reprendre-v10`, avec la liste de ses adaptations, comme
  l'entreprise (`docs/pont-v10.md`). Un **point de contact neuf** (`pont-cabinet.js`) remplace
  `window.cabinet` : chaque appel devient une route du serveur, ou répond honnêtement « pas encore
  dans la version en ligne : rien n'a été fait ».
- **C4. Plus de paquets.** Ce qui importait, listait, relisait ou supprimait un paquet disparaît de
  l'écran (adaptation). Ce qui lisait le livre d'un dossier le lit au serveur.
- **C5. Les gestes du cabinet sont ceux de `03` § 3.** Associé (`supervision`), Collaborateur
  (`revision`), Assistant (`saisie`), Paie (`paie`) ; un rôle posé sur un dossier l'emporte. La base
  les garde elle-même : `socle.mes_roles` connaîtra le rôle d'un collaborateur sur un dossier.
- **C6. Ce que le cabinet ne fait jamais chez son client** (`03` § 3.3) : émettre ou modifier une
  pièce de vente, encaisser, toucher la caisse, l'équipe, l'abonnement ou les réglages du client,
  faire l'export complet. Il corrige un **compte** avant validation, jamais un montant d'une pièce.
- **C7. Le périmètre du mandat décide** (`03` § 3.4) : comptabilité, déclarations, saisie des
  achats, paie (décochée par défaut).
- **C8. Avec un mandat de comptabilité, c'est le cabinet qui valide le mois** (`03` § 2) ; le client
  voit l'état et peut le demander.

## Ce que devient chaque appel du Cabinet v10

| Appels (`window.cabinet`) | Sur la plateforme |
|---|---|
| `status`, `unlock`, `lock`, `state`, `changePassword`, `exportRecovery`… | La connexion de la plateforme (compte, code du téléphone) : le mot de passe unique du Cabinet disparaît (`03` § 7) |
| `saveCabinet`, `newDossier`, `deleteDossier`, `importDossiers`, `demo` | Le cabinet (fiche, code), ses dossiers : mandats et dossiers tenus |
| `importPack`, `listPack`, `openInPack`, `extractPack`, `inbox*`, `relireLesPaquets`, `deletePack`, `exportPairing` | **Disparaissent** (C4) |
| `livres`, `livre`, `livreIndex` | Les livres du serveur de l'entreprise, rendus dans la forme que l'écran attend |
| `saisir`, `modifierEcriture`, `supprimerEcriture`, `valider`, `validerLot`, `contrepasser`, `extourner`, `prevoirExtourne`, `lettrer`, `lettrageAuto` | La saisie du cabinet dans les livres du serveur (brouillard, validation, contre-passation, lettrage) |
| `reprendre`, `importerPlan`, `importerBalance`, `lireEcrituresTableur`, `importerEcrituresTableur` | La reprise (plan, balance d'ouverture, écritures par tableur) |
| `lireReleve`, `ajouterReleve`, `rapprocher*`, `saveBanque` | La banque : relevés et rapprochement |
| `declaration`, `poserDeclaration`, `pointerDeclaration`, `ecrireDeclaration`, `liasse`, `fiscalAnnuel`, `exportFec`, `exportEcritures`, `exportCsv` | Les déclarations et les exports |
| `immobilisations*`, `ecrireDotations`, `inventaire*`, `ecrireVariationStock` | Les travaux d'inventaire |
| `paie`, `saveSalarie`, `saveBulletin`, `ecrirePaie`, `cnss` | La paie tenue par le cabinet (mandat Paie) : celle de la brique 31 |
| `revision`, `signerCompte`, `noteRevue`, `questionnaire`, `question*`, `production`, `arreterRevision` | La révision et les questions au client |
| `cloture`, `cloturer`, `rouvrir`, `ouvrirSuivant`, `ecrireCloture` | La clôture de l'exercice |
| `collaborateurs`, `saveCollaborateur`, `retirerCollaborateur`, `saveDroits`, `jeSuis` | L'équipe du cabinet et ses affectations (invitations, `03` § 3.2) |
| `backups`, `restore`, `mirrorNow`, `licence*`, `upd*`, `openLog`, `openDataDir`… | **Disparaissent** : le serveur sauvegarde ; pas de licence d'ordinateur ; pas de mise à jour à installer |

## Le découpage

| Brique | Ce qu'elle fait |
|---|---|
| **36** | Le cabinet côté serveur : créer un cabinet ; le mandat (proposé par le propriétaire, accepté par l'associé, arrêté par l'un ou l'autre) et son périmètre ; les dossiers tenus ; le portefeuille ; le rôle d'un collaborateur sur un dossier et le périmètre, gardés par la porte **et** par la base ; la validation au cabinet quand il a le mandat de comptabilité. |
| **37** | Les écrans du Cabinet copiés et chargés ; le portefeuille et le livre d'un dossier lus au serveur (la balance que calcule l'écran égale celle du serveur : deux chemins, un chiffre) ; tout le reste répond « pas encore en ligne ». |
| **38** | La saisie : écritures saisies par le cabinet (brouillard, modification, suppression), validation d'une écriture ou d'un lot, contre-passation, extourne, lettrage ; le mois validé par le cabinet (C8). |
| **38 bis** | Le Cabinet sans paquets, dans les mots : le tableau, les relances, la fiche, les guides et les visites réécrits pour des livres tenus en direct ; la relance notée dans la fiche. |
| **39** | La reprise : l'exercice et sa balance d'ouverture (à-nouveaux), tapée ou lue dans un CSV ou un classeur Excel. |
| **39 bis** | Les écritures par tableur, l'aller-retour : exporter le livre-journal (et le FEC), le corriger, le réimporter. |
| **40** | La banque : relevés (lus dans le navigateur, bouclés, une fois), rapprochement (automatique et à la main), l'écriture manquante depuis la ligne ; ce que la banque apprend, dans les réglages du cabinet. |
| **41** | La déclaration du mois (TVA, timbre, retenues) : calculée par la v10 sur le livre du serveur, préparée au serveur, déposée et payée (deux pense-bêtes), son écriture au brouillard et son complément. |
| **41 bis** | La page Écritures : les écritures de tous les clients d'une période, en un fichier. |
| **41 ter** | La liasse et le résultat fiscal de l'année. |
| **42** | Les immobilisations : fiches des biens au serveur, dotations et sorties au brouillard, liées à leur bien. |
| **42 bis** | L'inventaire de stock et sa variation. |
| **43** | La paie tenue par le cabinet (mandat Paie) : les salariés et les bulletins du client, dans son propre dossier. |
| **44** | La révision (feuilles maîtresses, comptes signés, notes, questionnaire, révision arrêtée) et les questions au client, posées puis envoyées. |
| **44 bis** | Le client lit les questions de son cabinet dans son SkanFact, en face de la pièce, et y répond. |
| **45** | La clôture de l'exercice, sa réouverture (avec un motif), l'exercice suivant. |
| **46** | L'équipe du cabinet : invitations, rôles, affectations par dossier, trace de l'équipe. |
| **47** | La fiche et les réglages du cabinet : son nom (un associé le change), son adresse, son téléphone, les jours, la saisie, le thème, les régimes. |
| **48** | La page Production : chaque dossier, chaque mois, son étape (à saisir, à réviser, à déclarer, déclaré), comptée au serveur pour tout le portefeuille ; les dossiers tenus entrent dans les Échéances. |
| **49** | Le fichier CNSS du trimestre : fabriqué par le moteur de la v10 sur la paie du serveur, téléchargé sous le nom du format. |

Chaque brique a ses tests « deux chemins » (ce que calcule l'écran du Cabinet contre ce que tient
le serveur), ses preuves, et un parcours joué à la souris.

## Brique 37 : les écrans du Cabinet, copiés et branchés (fait le 29/09/2026)

**Les écrans** : `src/cabinet/renderer` et `cabcore.js` (branche `beta` de `skanfact`) copiés tels
quels dans `web/public/v10/cabinet/` par `npm run reprendre-v10`, avec les fichiers qu'ils partagent
avec l'entreprise pris dans la **même** copie (`../compta.js`, `../reglages.js`…). Les adaptations
sont listées, chacune avec sa raison, dans `web/v10/adaptations.mjs` ; l'adresse est
`/v10/cabinet/?c=<cabinet>`.

**Le point de contact** (`web/public/plateforme/pont-cabinet.js`) :
- la session de la plateforme ouvre le cabinet : ni mot de passe du cabinet, ni écran de
  verrouillage (qui ne se montre même pas le temps du chargement) ; « Verrouiller » ferme la
  session ;
- les dossiers sont le **portefeuille** du serveur (mandats actifs, dossiers tenus) ; « Nouveau
  client… » crée un dossier tenu ;
- le livre d'un dossier est celui du serveur (numéro de la chaîne, brouillard / validée /
  contre-passée) ; les mois vont de janvier de la première année jusqu'au mois courant, sans
  « mois manquants » inventés. **Deux chemins, un chiffre** : la balance que l'écran calcule
  (`compta.js`) est celle de `GET compta/balance`, compte par compte ;
- les dossiers confiés au cabinet s'annoncent sur la page Dossiers (« … te confie son dossier :
  la comptabilité, les déclarations et la saisie des achats », Accepter / Refuser) ; le **code du
  cabinet** se lit dans « Comment un client arrive jusqu'ici » (portefeuille vide) et dans
  Réglages → Mon cabinet → « Le code de ton cabinet » ;
- tout le reste répond « Pas encore dans la version en ligne de SkanFact Cabinet : rien n'a été
  fait. », sauf ce que le Cabinet envoie sans attendre de réponse (le signalement d'une erreur),
  qui ne doit jamais échouer (sinon l'échec se signale à son tour, sans fin).

**La fiche d'un dossier** (migration `0020`, `cabinet.fiche`) : ce que le cabinet note sur son
client et qui n'est pas sa comptabilité. **Les champs, comptés** (`FICHE`, serveur/cabinet/routes.ts) :
e-mail, téléphone, contact, note, archivé, début de mission, régime, période de TVA, honoraires
(entier, en millimes), matricule CNSS employeur, code CNSS ; tout autre champ se refuse. Elle
appartient au cabinet (ni le client, ni un collaborateur à qui le dossier n'est pas confié, ni un
autre cabinet ne la lisent) ; une fiche changée ailleurs n'est jamais écrasée (la révision se
vérifie dans l'écriture elle-même : deux postes au même instant, un seul passe).

**Côté entreprise** : Paramètres → Envois → « Ton cabinet comptable » : le propriétaire tape le
code de son cabinet, coche ce qu'il lui confie (la paie décochée), puis voit « … tient tes livres
depuis le … » ; arrêter se demande d'abord. `GET /entreprises/:e/mandat` donne le nom et le code
du cabinet par `socle.cabinet_du_mandat` (la fiche du cabinet reste fermée au client).

**L'entrée** : `GET /moi` distingue les entreprises de la personne de celles qu'elle voit par son
cabinet (`parCabinet`) et donne ses cabinets. L'entrée ouvre ce qui a été ouvert la dernière fois
sur ce navigateur, à défaut la première entreprise de la personne, puis son premier cabinet :
**jamais l'entreprise d'un client comme la sienne**. La porte de la première fois a un troisième
choix, « Je suis un cabinet comptable » (le nom du cabinet ; puis le code du téléphone, que le
rôle d'associé exige).

**Sans paquets (C4), caché ou retiré** : importer un paquet, l'onglet des paquets ; dans
« Tes premiers pas », l'appairage, la clé de secours, la copie sur un disque et « recevoir un
premier paquet » ; dans les Réglages, la licence, la boîte de réception, les sauvegardes de
l'ordinateur, les mises à jour, et du panneau Sécurité tout sauf « Verrouiller » (panneaux, leurs
pastilles, leurs résultats de recherche et la palette).

**Reste connu, pour la brique 38** : le tableau du portefeuille compte encore en « mois reçus »
(dernier mois reçu, mois manquants, « aucun paquet », « a envoyé ses mois clôturés ») : il se
rebranche sur les mois du serveur (écritures, mois validés) avec la saisie et la validation par le
cabinet ; l'exemple à six clients fictifs n'est pas encore en ligne (le bouton le dit).

## Brique 38 : la saisie du cabinet dans les livres du serveur (fait le 29/09/2026)

**La base** (migration `0021`) — chaque geste y est contrôlé, et gardé par `compta.peut` :
- **Saisir** (`compta.saisir`) : une écriture au brouillard, sa propre famille (origine « saisie »),
  avec les contrôles de la v10 (`ecritureValide`) avant toute écriture : la date, le journal, deux
  lignes au moins, un compte en chiffres, un côté par ligne, un montant, l'équilibre (« Débit 10,000
  ≠ crédit 9,000 »), et jamais dans la période close. **C12** : une ligne sans libellé prend celui de
  l'écriture, une écriture sans libellé celui de sa première ligne ; sans aucun, elle est refusée dès
  le brouillard (la v10 l'acceptait au brouillard et le réclamait à la validation : le serveur garde
  ainsi une seule règle, et la validation d'une période ne scelle jamais une écriture muette).
- **Modifier, supprimer** un brouillard saisi, avec la révision vue : un brouillard changé ailleurs
  entre-temps n'est jamais écrasé (erreur `SK409`, rendue en 409 « recharge-le »).
- **Valider** une écriture ou un lot (`compta.valider_ecritures`) : le numéro de son journal et de son
  année, le maillon de la chaîne, qui et quand ; dans l'ordre des dates ; une écriture refusée (déjà
  validée, datée de demain, inconnue) est nommée avec sa raison et ne troue pas la numérotation.
- **Contre-passer** (`compta.contrepasser`) et **extourner** (`compta.extourner`) une écriture SAISIE :
  le miroir est posé et validé d'un geste (comme la v10) ; la contre-passation au jour demandé,
  jamais avant l'écriture ni dans la période close (premier jour ouvert) ; l'extourne au premier du
  mois suivant, refusée si ce jour est clos, jamais pour des à-nouveaux ni une écriture contre-passée.
- **Lettrer** (`compta.lettrer`, tables `compta.lettrage` et `compta.ligne_lettree`) des écritures
  validées d'un même compte dont la somme fait zéro (« il reste 690,000 » sinon), une lettre unique
  par entreprise (A, B… AA…), et **délettrer**. **C13** : un brouillard ne se lettre pas (la v10 le
  permettait) : sur le serveur, un brouillard peut changer sous le cabinet quand le client modifie sa
  pièce, et le lettrage désignerait des lignes réécrites.
- **C6 rendu concret** : une écriture née d'une pièce de l'entreprise ne se modifie, ne se supprime,
  ne se contre-passe ni ne s'extourne à la main ; elle suit sa pièce (le serveur la contre-passe
  lui-même quand la pièce change). Elle se **valide** et se **lettre**. **Corriger une imputation**
  (le compte d'une écriture née d'une pièce, avant validation : `03` § 3.1) viendra à part : la
  correction doit survivre à la réécriture de la famille.
- Qui (`03` § 2.1 et § 3.1) : saisir, la comptabilité de l'entreprise (propriétaire, administrateur,
  comptabilité interne) et tout le cabinet (associé, collaborateur, assistant) ; valider,
  contre-passer, extourner et lettrer, la comptabilité de l'entreprise (valider : sans mandat de
  comptabilité, C8) et l'associé ou le collaborateur ; une clé de l'API, si elle porte le geste. Les
  gestes déclarés : `compta.ecritures.saisir`, `compta.ecritures.valider`, `compta.lettrage.poser`.

**Le tableau du portefeuille** : `GET /cabinets/:c/mois` donne, pour chaque dossier dont on lit les
livres, chaque mois qui a des écritures (combien, combien au brouillard, le chiffre d'affaires des
comptes 70, le dernier mouvement). Le point de contact en fait les « paquets » que le tableau du
Cabinet v10 compte : un mois écrit est reçu, **définitif** quand plus rien n'y est au brouillard. Un
mois sans écriture n'a pas de paquet (rien n'est inventé).

**L'écran** : la grille de saisie, « Enregistrer en brouillard », « Enregistrer et valider », les lots
(par journal, par mois), le menu d'une écriture (valider, reprendre, supprimer ; contre-passer,
extourner), le lettrage automatique (la règle de la v10, `lettrageAuto`, calculée sur le livre du
serveur ; chaque paire est posée par le serveur) : chacun va au serveur puis relit le livre. Le menu
ne propose pas à une écriture née d'une pièce ce que le serveur refuserait ; l'extourne d'une écriture
de décembre se pose directement au 1er janvier (les livres du serveur ne s'arrêtent pas au 31
décembre). Le numéro affiché d'une écriture validée est son rang dans la chaîne des livres (le numéro
unique de la v10) ; son numéro de journal (« OD-2026-000004 ») est celui du serveur.

**Reste connu** :
- ~~Le vocabulaire des paquets~~ : fait à la brique 38 bis (ci-dessous).
- Un écran déjà ouvert ne voit pas un changement fait ailleurs avant d'être rouvert.
- Les justificatifs joints à une écriture, la reprise, la banque : briques suivantes.

## Brique 38 bis : le Cabinet sans paquets, dans les mots et les gestes (fait le 29/09/2026)

Le Cabinet v10 parlait partout de paquets : « 2 paquets reçus », « n'a envoyé que du provisoire »,
« dernier paquet le … », des relances qui demandaient de « clôturer le mois et renvoyer le paquet ».
Sur la plateforme, les livres de chaque client sont tenus en direct : ces phrases mentaient.

**C14. Les mots d'un Cabinet sans paquets** (par délégation) :
- un mois **écrit** a des écritures dans les livres du client (il était « reçu ») ;
- il est **validé** quand plus rien n'y est au brouillard (« définitif ») ;
- il est **à valider** tant qu'il y reste des brouillards (« provisoire ») : c'est le travail du
  cabinet (C8), **jamais une relance** ; « À faire » le dit (« 1 dossier a des écritures à valider »),
  et « Valider » ouvre la saisie du dossier sur l'exercice de ce mois ;
- il est **manquant** quand un mois passé (après le jour de relance) n'a **aucune écriture** : c'est
  lui, et lui seul, qu'on relance — « Il me manque vos pièces de mai et juin 2026 … Il vous suffit de
  les enregistrer dans SkanFact : je les vois dans vos livres dès qu'elles y sont » ;
- « Reçu le » devient « Mis à jour » (la dernière écriture enregistrée ou validée du dernier mois).

**C15. Les relances notées dans la fiche** (par délégation) : la relance faite depuis le Cabinet (le
message s'ouvre dans la messagerie, ou WhatsApp ; un appel se note à la main) se garde dans la fiche du
dossier au cabinet (`cabinet.fiche`). **Les champs, comptés** : l'instant, le moyen (e-mail,
téléphone, WhatsApp, autre), les mois réclamés, une note de 500 caractères au plus ; les cinquante
dernières. Tout autre champ se refuse (`RELANCE`, serveur/cabinet/routes.ts). Elle reste, comme la
fiche, au cabinet seul.

**Comment** : les adaptations sont du texte ; elles s'écrivent **telles quelles** dans
`web/v10/sans-paquets.txt` (un bloc « avant », un bloc « après », sans rien à échapper), lues par
`sans-paquets.mjs` et ajoutées à la liste de `adaptations.mjs`. Chaque « avant » doit toujours se
trouver une fois exactement dans la v10.

**Ce qui change à l'écran** : le tableau du portefeuille (cartes, « À faire », légende, colonnes « À
valider » et « Mis à jour », export CSV) ; la fiche d'un dossier (son état, ses douze mois : un mois
écrit s'ouvre dans ses livres — sa saisie s'il reste à valider, son livre-journal sinon ; un mois
manquant porte la relance) ; la page Relances (le client dont un mois est vide, seul) ; les échéances ;
la page Écritures (« pas encore dans la version en ligne », et le chemin vers les livres) ; les
réglages (le nom du cabinet, le code du cabinet) ; « Tes premiers pas » (« Tenir un premier livre »,
qui ouvre la saisie d'un client) ; les bulles, l'Aide et les visites.

**Retiré en ligne (C4)** : l'exemple à six clients fictifs (son bouton, son panneau, sa découverte),
la correspondance des comptes (elle traduisait les comptes d'un paquet importé), la clé de secours
(plus jamais réclamée : « on ne sait pas » reste la réponse) ; les articles « Ne rien perdre »,
« Changer d'ordinateur », « La licence », « Les mises à jour » ; les visites sans objet (découvrir
l'exemple, l'appairage, la clé de secours, la copie, recevoir et lire un paquet, la boîte de
réception, les sauvegardes, changer d'ordinateur, les mises à jour, la licence, le mot de passe du
cabinet, envoyer la clôture, la correspondance, l'écran des paquets), et celles d'un geste **pas
encore en ligne**, qui reviennent avec leur brique (nommer le cabinet, commencer un livre par sa
reprise — revenue à la brique 39 bis —, exporter les écritures, suivre la production).

**Les tests** : un parcours lit, à la souris, **chaque écran** du Cabinet et chaque bulle qu'il porte
(texte, champs, infobulles, « À faire » déplié, après un second dessin) : aucun mot de paquet. Un
autre lit **tout ce que le Cabinet peut montrer sans qu'on l'ouvre** : chaque bulle, chaque article,
chaque visite proposée en ligne, ce qu'une visite dit d'un écran, d'un bouton ou d'un champ ; ce que
la version en ligne ne montre jamais y est nommé un par un, avec sa raison, et la liste ne peut pas
nommer un disparu. Un troisième joue la relance : « À faire », « Valider », la page Relances, le mail
dans la messagerie, la relance notée au serveur, les mois du Suivi ouverts dans les livres.

**Reste connu** :
- Les réglages du cabinet (son nom, son e-mail, le jour de relance) ne s'enregistrent pas encore en
  ligne : le jour de relance est celui par défaut (le 10), et « À faire » dit encore « Tu as fixé le
  10 ».
- Un mois sans aucune activité reste « manquant » : la clôture d'une période, quand le cabinet l'aura
  à l'écran, le comptera comme fait.
- Les écrans pas encore en ligne (banque, déclarations, immobilisations, paie, révision, clôture,
  production) gardent le texte de la v10 : chacun se relit, à la souris, avec sa brique.

## Brique 39 : l'exercice et sa balance d'ouverture (fait le 29/09/2026)

Le Cabinet v10 « commençait le livre » d'un dossier : son exercice (l'année, ses bornes) et, pour un
client qui arrive d'un autre cabinet ou d'un autre logiciel, sa balance d'ouverture. Sur la plateforme,
les livres existent déjà (C2) : ce qui manquait au serveur, c'est l'exercice lui-même et ses
à-nouveaux.

**C16. L'exercice s'ouvre sur le serveur, une fois** (par délégation) : son année ; son premier jour,
le 1er janvier, ou plus tard pour un premier exercice (une société créée en cours d'année) ; son
dernier, le 31 décembre (la v10 ne tient que des exercices civils — **À VÉRIFIER** avec un comptable
pour un client dont l'exercice est décalé, d'avril à mars par exemple). L'ouvrir revient à qui valide :
avec un mandat de comptabilité, le cabinet (C8) ; gardé à la porte et dans la base
(`compta.ouvrir_exercice`, migration `0022`). Deux ouvertures au même instant : une seule passe,
l'autre lit sa phrase.

**C17. La balance d'ouverture est une écriture du journal AN** (par délégation) : pièce
« OUVERTURE », datée du premier jour de l'exercice, posée **et validée** d'un geste avec lui, dans la
même transaction — ou rien : déséquilibrée, un compte qui n'est pas un numéro, datée d'un jour à
venir, dans une période validée, ni l'exercice ni l'écriture n'existent. Vide pour un client qui
démarre. Fausse, elle se contre-passe, et la bonne se saisit au journal AN. **Les à-nouveaux ne sont
l'activité d'aucun mois** : la balance d'ouverture dit ce que les comptes portaient AVANT le premier
jour ; janvier n'en devient pas « écrit » (le tableau du portefeuille, `mois_du_portefeuille` redéfinie
en `0022`, et l'alerte du livre les écartent tous deux). Et un mois au brouillard est écrit : à
valider, jamais réclamé (C14) — l'alerte du livre le comptait encore comme manquant.

**Ce qui part au serveur** (compté) : l'année, le premier jour, et les lignes de la balance (compte,
libellé, débit, crédit). Un CSV ou un classeur Excel se lit **dans le navigateur**, par le lecteur de
la v10 (`compta.js`) ; le ZIP d'un classeur s'ouvre par `DecompressionStream`, ses seuls fichiers XML,
et plus de 20 Mo pour une entrée, ou de 60 Mo pour le classeur, se refuse avec sa raison. Rien ne part
avant « Créer le livre » (ou « Ouvrir l'exercice »), et rien d'autre du fichier.

**À l'écran** :
- un client sans écriture (tenu, ou sur SkanFact sans rien d'enregistré) : « Commencer le livre de
  2026… », la fenêtre de la v10 (l'exercice, ses bornes, la balance d'ouverture, l'écart qui se lit
  pendant la frappe, « Importer depuis Excel ou CSV… ») et « Créer le livre » ; la saisie s'ouvre
  ensuite ;
- un client sur SkanFact dont les pièces sont déjà dans ses livres : « Reprendre les soldes
  d'ouverture… » dans la barre du livre, tant que son exercice n'est pas ouvert ; la même fenêtre dit
  « Reprendre les soldes d'ouverture de … » et « Ouvrir l'exercice » ;
- un livre sans écriture, pour un client sur SkanFact, dit « Aucune écriture pour l'instant » (il
  disait « Aucun paquet reçu ») ; la bulle de l'exercice ne promet plus « Ouvrir N+1 » (la clôture,
  brique 45).

**Les adaptations** : `web/v10/reprise.txt`, au format de `sans-paquets.txt`.

**Les tests** : par l'API et dans la base (`tests/compta/exercice.test.ts`) ; à la souris
(`tests/web/cabinet-reprise.test.ts`) : un client tenu commence son livre avec la balance d'un CSV (un
titre au-dessus, une ligne qui n'est pas un compte — ignorée et dite —, un total dessous), l'écriture
AN au millime du fichier, la balance de l'écran égale à celle du serveur ; un client qui démarre le
1er juin 2025, sans balance ; un client sur SkanFact reprend ses soldes depuis un classeur Excel (un
classeur trop gros une fois ouvert se refuse), refusés tant qu'ils ne tombent pas juste (rien n'est
ouvert), puis ouverts ; janvier n'est pas écrit
par la balance d'ouverture, un mois au brouillard n'est pas réclamé.

**Reste connu** :
- ~~Les écritures par tableur (« Réimporter depuis un tableur… »), et la visite « Commencer le livre
  d'un client »~~ : faits à la brique 39 bis (ci-dessous).
- L'exercice suivant (« Ouvrir N+1 », ses à-nouveaux calculés à la clôture) : brique 45.
- Au début d'un mois, avant le jour de relance, l'en-tête d'un dossier ne compte pas encore le mois
  qui vient de finir, et l'alerte du livre si (héritage de la v10) : à accorder avec les réglages du
  cabinet.

## Brique 39 bis : les écritures par tableur, l'aller-retour (fait le 29/09/2026)

Le Cabinet v10 rendait la main au tableur : exporter le livre-journal, corriger dans Excel une
comptabilité mal tenue, réimporter — ce que le comptable pilote fait déjà avec Sage. Sur la plateforme,
le même aller-retour, au serveur.

**Les fichiers du livre** : le tableau CSV de chaque vue (livre-journal, grand livre, balance, lettrage ;
et le tableau du portefeuille) et le fichier des écritures (FEC) se **téléchargent** par le navigateur,
au nom et au contenu de la v10 (le BOM qu'Excel en français attend ; le FEC sans les brouillards, avec
leur date de validation). Rien ne part au serveur.

**C18. Le réimport d'un tableur** (par délégation) : le fichier choisi est lu dans le navigateur (CSV
ou Excel, le lecteur de la brique 39) et comparé au livre du serveur par l'analyse de la v10 (une pièce
par numéro, sinon par journal, pièce et date) ; la fenêtre dit **avant le clic** ce que l'import fera.
Puis :
- une pièce nouvelle entre **au brouillard** ; un brouillard que le fichier change est remplacé (sa
  révision est vérifiée : un brouillard changé ailleurs n'est jamais écrasé) ; une pièce identique ne
  bouge pas ; une écriture du livre absente du fichier ne bouge pas ;
- une **validée** que le fichier change ne se modifie jamais : si on le demande (la case de la
  fenêtre), elle se **contre-passe** et sa version corrigée attend au brouillard — les deux d'un geste,
  ou rien (`POST …/ecritures/:id/corriger`, qui revient à qui valide) ;
- une pièce qui **ne tombe pas juste se refuse**, nommée avec son écart, avant le clic : sur le serveur,
  un brouillard tombe juste (brique 38) — la v10 la faisait entrer au brouillard ;
- le serveur refait chaque contrôle : les pièces partent en lots de cinq cents
  (`POST …/ecritures/lot`, qui revient à qui saisit) ; chacune entre, ou est nommée avec la raison de
  son refus (la période validée, un compte qui n'est pas un numéro, une écriture née d'une pièce du
  client, qui se corrige dans sa pièce), sans laisser de trace — les autres entrent quand même.

**Ce qui part au serveur** (compté) : pour chaque pièce, sa date, son journal, sa référence, son
libellé et ses lignes (compte, libellé, tiers, débit, crédit) — ce que la saisie envoie déjà. Le
lettrage d'un fichier n'est pas repris (il se pose sur des écritures validées, brique 38).

**La visite « Commencer le livre d'un client »** revient (sa fin propose le tableur) ; elle ne choisit
qu'un client hors SkanFact, ce qu'elle annonce.

**Les tests** : par l'API et dans la base (`tests/compta/import.test.ts`) ; à la souris
(`tests/web/cabinet-tableur.test.ts`) : l'export téléchargé, corrigé comme dans un tableur (un
brouillard changé, une validée changée, une pièce nouvelle, une pièce qui ne tombe pas juste sur un
compte nouveau), réimporté ; ce que la fenêtre annonce, ce que le serveur tient ensuite ; le FEC,
autant de lignes que les écritures validées du serveur ; la visite dans « Me guider ».

**Reste connu** :
- Le plan comptable propre d'un client (ses sous-comptes et leurs noms, tenus sur le serveur) : le plan
  d'un livre, ce sont les comptes que ses écritures portent, nommés par le plan de référence.
- L'export des écritures de **tous** les clients d'un mois (la page Écritures) : brique 41.

## Brique 40 : la banque, relevés et rapprochement (fait le 29/09/2026)

Le Cabinet v10 importait le relevé d'un compte bancaire dans le livre d'un dossier, puis rapprochait
chaque ligne du relevé de la ligne d'écriture qui lui répond ; ce qui reste de part et d'autre (les
suspens) explique l'écart entre la banque et le livre. Sur la plateforme, les mêmes écrans, au serveur.

**C19. Un relevé** (par délégation) : son compte (532…), sa banque, ses dates, ses deux soldes, le nom
du fichier et l'**empreinte de ses octets** (le même fichier ne s'importe pas deux fois : c'est dit dès
qu'on le choisit, puis refusé par le serveur). Il se range dans le livre de l'année où on l'importe,
comme la v10 le rangeait. Il doit **se boucler** (solde de début + mouvements = solde de fin, au
millime), sinon il manque des lignes et il se refuse, avec l'écart. Le fichier se lit **dans le
navigateur**, par le lecteur de la v10 (CSV ou Excel, les lignes au-dessus du tableau et les totaux
reconnus) ; ce qui part au serveur (compté) : le compte, la banque, le nom du fichier, son empreinte,
les deux soldes, et pour chaque ligne sa date, son libellé, sa référence et son montant.

**C20. Un rapprochement** (par délégation) : une ligne du relevé et **la** ligne d'écriture qui lui
répond, sur le même compte ; une ligne d'écriture ne répond que d'une ligne de relevé. Un brouillard
peut être rapproché (le comptable écrit depuis le relevé et valide ensuite, comme dans la v10) ; s'il
change, ses lignes renaissent et **le rapprochement tombe avec elles** : la ligne du relevé redevient
« sans réponse », à l'écran, jamais un rapprochement vers une ligne qui n'existe plus (la v10 refusait
de modifier un brouillard rapproché ; ici, un client qui corrige sa pièce n'est jamais bloqué par le
travail de son cabinet). L'automatique juge comme la v10 (un seul candidat au bon montant à ± 3 jours :
posé ; plusieurs : « probable » ou « à confirmer », gardé sur la ligne, **rien n'est posé**) ; le
comptable tranche, écrit l'écriture manquante depuis la ligne (un brouillard, rapproché du même geste),
défait une ligne ou tout le relevé, retire un relevé (les écritures restent). Importer, rapprocher,
retirer : qui saisit, à la porte et dans la base (`compta.importer_releve`, `compta.rapprocher`,
`compta.derapprocher`, `compta.retirer_releve`, migration `0023`).

**C21. Ce que la banque apprend** (par délégation) : l'association des colonnes **par banque** et les
**mots retenus** (un mot d'un libellé → le compte proposé) valent pour tous les clients du cabinet :
les **réglages du cabinet** (`cabinet.reglages`, leurs champs comptés, jamais écrasés : une révision) ;
le compte bancaire d'un dossier et sa banque vont dans sa **fiche**. Les lit et les écrit qui est du
cabinet.

**Les tests** : par l'API et dans la base (`tests/compta/banque.test.ts`) ; à la souris
(`tests/web/cabinet-banque.test.ts`) : un relevé CSV importé (un titre au-dessus du tableau), les
colonnes et le compte retenus ; l'automatique qui pose le virement et garde les deux chèques du même
montant sans rien poser ; l'ambiguïté tranchée à la main ; l'écriture manquante écrite depuis la ligne,
rapprochée, et son mot retenu ; tout défait, le relevé retiré, les écritures restées.

**Reste connu** :
- « Relevé retiré : N écritures gardées » ne compte pas les écritures nées d'un relevé (le serveur ne
  garde pas ce lien) : le compte rendu dit seulement « Relevé retiré », et la question avant le geste
  dit bien que ces écritures restent.
- Les autres réglages du cabinet (son nom, son e-mail, le jour de relance) : en ligne depuis la brique 47.

## Ce qui reste à décider avec Skander ou un comptable

- **À VÉRIFIER** (Ordre des experts-comptables) : à qui appartient le travail d'un dossier tenu quand
  le client ne l'a jamais rejoint et que le mandat s'arrête (`03` § 3.5).
- **À VÉRIFIER** (comptable) : les écritures de paie en totaux du mois conviennent-elles au cabinet
  et en cas de contrôle (`03`, question 3 ; D8 de `docs/ecritures.md`).

## Brique 36 : le cabinet côté serveur (fait le 29/09/2026)

**La base** (migration `0019`) :
- `socle.creer_cabinet` : son créateur en est l'associé ; son code (huit lettres ou chiffres) est
  ce que le client donne pour le choisir.
- Le mandat : `proposer_mandat` (le **propriétaire** seul, par le code, avec le périmètre ; la paie
  décochée par défaut ; un seul cabinet à la fois), `accepter_mandat` (un **associé**),
  `arreter_mandat` (le propriétaire ou un associé), `changer_perimetre` (le propriétaire seul).
- `creer_dossier_tenu` : l'entreprise d'un client pas encore sur SkanFact (`tenue_par`), sans membre
  côté client, mandat actif, périmètre complet.
- `confier_dossier`, `reprendre_dossier` : le rôle d'un membre de l'équipe **sur** un dossier.
- `socle.portefeuille` : tous les dossiers (et les propositions) pour un associé ; les dossiers
  confiés pour un collaborateur.
- `socle.mes_roles` connaît maintenant le rôle d'une personne **par son cabinet** : celui posé sur
  le dossier, sinon « supervision » pour un associé (un rôle posé l'emporte, `03` § 3) ; le rôle
  Paie ne vaut que si le mandat comprend la paie. `socle.perimetre_cabinet` dit le périmètre du
  mandat par lequel on agit (vide pour un membre de l'entreprise).
- Les livres (`compta.mes_entreprises`), la paie (`paie.mes_entreprises`) et la masse salariale
  s'ouvrent au cabinet **selon le périmètre**, dans la base elle-même.
- `compta.valider` : avec un mandat de comptabilité, c'est le cabinet (associé, collaborateur) qui
  valide ; ni le client, ni l'assistant de saisie (C8).

**La porte** : qui n'agit que par son cabinet agit dans le périmètre du mandat ; un module qu'il
n'ouvre pas se refuse avec sa phrase (« le mandat de ton cabinet ne comprend pas la paie : seul le
propriétaire de l'entreprise peut l'ouvrir »). Un module absent de la table (l'équipe, les
réglages, les ventes à émettre) est fermé au cabinet (C6).

**L'API** : `POST /cabinets`, `GET /cabinets`, `GET /cabinets/:c/portefeuille`,
`POST /cabinets/:c/dossiers` (dossier tenu), `POST /cabinets/:c/mandats/:m/accepter|arreter`,
`PUT|DELETE /cabinets/:c/mandats/:m/affectations/:membre` ; côté entreprise,
`GET|POST|DELETE /entreprises/:e/mandat` et `PUT /entreprises/:e/mandat/perimetre`. Chaque
changement d'un mandat se trace chez l'entreprise.

**Décisions (par délégation)** :
- **C9.** Le mandat naît chez le client (le propriétaire propose, par le code du cabinet) et
  s'active quand l'associé l'accepte ; il commence ce jour-là.
- **C10.** Les pièces de vente et d'achat du client se voient au cabinet avec la comptabilité (et
  les achats aussi avec la saisie des achats) ; la paie seulement avec la paie ; la masse salariale
  (un total) avec la comptabilité ou la paie, puisque les totaux de la paie sont déjà dans les
  livres.
- **C11.** L'équipe du cabinet (inviter un collaborateur) viendra à la brique 46 ; d'ici là, les
  tests posent les membres dans la base.

## Brique 41 : la déclaration du mois (fait le 29/09/2026)

Le Cabinet v10 préparait la déclaration mensuelle d'un dossier (TVA, timbre, retenues) en la
**déduisant** de son livre (`compta.js`, `declarationMensuelle`), l'enregistrait, y posait deux
pense-bêtes (déposée, payée) et proposait l'écriture du mois au brouillard. Sur la plateforme, le même
onglet Déclaration, branché sur le serveur.

**C22. Le calcul reste celui de la v10** (par délégation) : le moteur de la v10 tourne dans le
navigateur sur le livre du serveur, comme il tournait dans le processus principal de la v10 ; rien ne
se saisit à côté du livre. **Deux chemins, un chiffre** : la TVA collectée que l'écran déclare est le
mouvement du 4367 que le serveur tient (`GET compta/balance`). Ce que la v10 ne calcule pas encore sur
la plateforme : la TFP, le FOPROLOS et l'IRPP lus sur les bulletins (la paie tenue par le cabinet,
brique 43) ; sans eux, ces cases disent pourquoi elles restent vides, comme la v10.

**C23. La déclaration préparée se garde au serveur** (par délégation, migration `0024`) : ses cases
(la liste de la v10, chacune en millimes, ou vide quand elle ne se sait pas), qui l'a préparée et
quand. Une période n'en a qu'une : la refaire la remplace, sauf une fois marquée **déposée**
(dé-pointe-la d'abord : deux chiffres auraient porté le même dépôt). Les deux pense-bêtes : déposée
(le jour, une référence), payée (le jour) ; on ne paie pas ce qu'on n'a pas déposé ; dé-pointer le
dépôt dé-pointe le paiement, et l'écran le dit. **Ce qui part au serveur** (compté) : la période, les
cases (montant ou vide), et pour un pointage le jour et la référence. SkanFact ne dépose rien et ne se
connecte à aucune administration.

**C24. L'écriture du mois** entre au **brouillard** par la saisie (`compta.saisir`), datée dans le
mois, et se lie à sa déclaration ; la repasser se refuse (la TVA du mois compterait deux fois) ;
supprimée ou contre-passée, le lien ne vaut plus et elle se refait. Une pièce saisie **après** : les
chiffres ont changé, l'écran le dit, le dépôt s'éteint ; recalculée, le **complément** pose ce qui
manque, au brouillard, sans remplacer le lien — jamais une seconde écriture entière.

**Qui peut** : préparer, pointer, écrire l'écriture — le propriétaire, l'administrateur, la
comptabilité interne ; au cabinet, l'associé et le collaborateur, **si le mandat comprend les
déclarations** (03 § 3.1 et § 3.4) ; jamais l'assistant. La porte le garde (un geste peut maintenant
porter son propre périmètre de mandat, `perimetre` : ici « les déclarations », pas « la
comptabilité ») et la base aussi (`compta.peut_declarer`). La déclaration se lit dans les livres : le
cabinet doit aussi avoir la comptabilité.

**La forme d'un montant copié pour le portail** (point, virgule, millimes) est un réglage du cabinet
(`cabinet.reglages`, champ `formatCopie`). Le reste de la fiche du cabinet (son nom, son e-mail…) est
en ligne depuis la brique 47.

**Les tests** : par l'API et dans la base (`tests/compta/declaration.test.ts`) ; à la souris
(`tests/web/cabinet-declaration.test.ts`) : mars avec une vente et un achat, les cases (190,125 de TVA
collectée, 140,870 à décaisser), préparée au millime, l'écriture du mois au brouillard, validée ; une
vente oubliée saisie après — les chiffres ont changé, le dépôt s'éteint (et le point de contact le
refuse, même appelé sans le bouton) ; recalculée, le complément ; déposée, payée, dé-pointée ; la forme
copiée retenue.

**Reste connu** :
- Le serveur **ne recalcule pas** la déclaration : il garde ce que le moteur de la v10 a déduit du
  livre, et c'est le point de contact qui refuse un dépôt sur des chiffres qui ont changé. Refaire le
  calcul au serveur (le moteur porté en TypeScript) viendra avec le portage du moteur.

## Brique 41 bis : la page Écritures (fait le 29/09/2026)

Le Cabinet v10 rassemblait sur cette page les écritures que les **paquets** de ses clients portaient,
pour les importer d'un coup dans le logiciel de production du cabinet. Sur la plateforme, les livres
de chaque client sont au serveur : la même page, sans paquets.

**C25. Les écritures de tous les clients d'une période, en un fichier** (par délégation) : la page
propose les mois où au moins un client a des écritures ; le plan de la v10 (`ecrituresPlan`) dit avant
le clic quels clients et quels mois entreront, lesquels sont **à valider** (une écriture y est encore
au brouillard ; le mot de C14, plus « provisoire ») et quels clients n'ont **aucune écriture** sur la période — un client hors SkanFact
compris : ses livres sont au serveur comme ceux des autres (la v10 les laissait dehors, faute de
paquet). L'export lit les livres au serveur, écrit les colonnes du livre-journal de SkanFact (numéro
de la chaîne, date, journal, pièce, compte, tiers, libellé, débit, crédit, lettrage, **état** :
validée, au brouillard, contre-passée) et les regroupe comme la v10 (`mergeEcritures` : Client,
Matricule, Mois devant chaque ligne, le BOM qu'Excel attend) ; le fichier se télécharge. Rien ne part
au serveur. Le compte rendu compte des **lignes** d'écriture (la v10 disait « écritures »). La visite
« Exporter les écritures vers mon logiciel » revient. Adaptations : `web/v10/ecritures.txt`.

**Les tests** : à la souris (`tests/web/cabinet-ecritures.test.ts`) : trois clients hors SkanFact (un
mois validé, un mois au brouillard, un sans rien) ; ce que la page nomme avant le clic ; le fichier
téléchargé, ligne à ligne, sans le mois d'après ; sur deux mois, chaque ligne sous son mois ; la visite
dans « Me guider ».

**Reste connu** : créer un dossier tenu avec un matricule qu'une autre entreprise active porte déjà
répond « une erreur est survenue » (l'index unique du matricule, brique 36) au lieu d'un refus qui dit
pourquoi — et dire pourquoi révélerait qu'une entreprise porte ce matricule : la phrase est à décider.

## Brique 41 ter : la liasse et le résultat fiscal (fait le 29/09/2026)

Le Cabinet v10 déduisait la liasse de la balance par une table de rubriques modifiable, montrait ce
qu'aucune rubrique ne capte, et calculait le résultat fiscal à partir du résultat comptable et de
retraitements saisis un à un, avec un taux d'impôt qui se saisit (vide : l'impôt s'écrit « — », jamais
un taux deviné). Sur la plateforme, le même onglet Liasse.

**C26. Le calcul reste celui de la v10** (par délégation) : la liasse, le résultat fiscal et la
déclaration d'employeur se déduisent dans le navigateur du livre du serveur (`liasseDepuisLignes`,
`resultatFiscal`, `employeurAnnuel`). **Deux chemins, un chiffre** : le résultat comptable de la liasse
est celui des comptes 6 et 7 que le serveur tient.

**C27. Ce qui se saisit se garde au serveur** (par délégation, migration `0025`, `compta.annuel`) :
par année, les **retraitements** (nature connue, libellé, montant positif en millimes : la nature dit
le sens) et le **taux d'impôt**, un entier à six décimales comme tout taux (25 % = 250000), ou rien.
Ce qui n'est pas envoyé ne change pas ; une révision : changé ailleurs, jamais écrasé. **Ce qui part au
serveur** (compté) : pour chaque retraitement sa nature, son libellé, son montant et son identifiant ;
le taux. Le **modèle de rubriques** vaut pour tous les clients du cabinet : `cabinet.reglages`, champ
`liasse` (code, état, libellé, comptes, sens, déduit, charge, résultat, deux sens ; rien d'autre).

**Qui peut** : le propriétaire, l'administrateur, la comptabilité interne ; au cabinet, **l'associé
seul** (03 § 3.1 : « états financiers, liasse »), si le mandat comprend la comptabilité — la v10 le
donnait à qui valide. La porte et la base (`compta.peut_liasse`).

**Les tests** : par l'API et dans la base (`tests/compta/annuel.test.ts`) ; à la souris
(`tests/web/cabinet-liasse.test.ts`) : 6 800,500 de résultat, pris aux comptes du serveur, la liasse
qui tombe juste ; le taux à 25 %, une réintégration de 1 000,125 : 7 800,625 de résultat fiscal et
1 950,156 d'impôt, que le serveur tient ; le retraitement retiré ; le modèle repris, une rubrique
renommée, et la liasse qui la montre.

**Reste connu** :
- La déclaration annuelle d'employeur ne lit que les comptes (les bulletins de la paie tenue par le
  cabinet : brique 43).
- Un exercice clos (la clôture : brique 45) ne verrouille pas encore la liasse.

## Brique 42 : les immobilisations (fait le 29/09/2026)

Le Cabinet v10 tenait, dans le livre de chaque exercice, les fiches des biens d'un dossier : leur plan
d'amortissement se calcule, les dotations, les reprises de subvention et les sorties d'actif s'écrivent
au brouillard, et chaque ligne du plan retient l'écriture qui la porte. Sur la plateforme, le même
onglet Immobilisations.

**C28. Une fiche par bien, pour toute la vie de l'entreprise** (par délégation, migration `0026`,
`compta.immobilisation`) : plus de « bien repris » d'un exercice à l'autre — le registre est celui de
l'entreprise, et chaque exercice le lit. Le plan se calcule par la v10 (`planDuBien`), dans le
navigateur. **Ce qui part au serveur** (compté) : le libellé, les trois comptes, les deux dates, la
valeur, la valeur résiduelle et la TVA (en millimes), la méthode, la durée (en centièmes d'année), le
taux dégressif (entier à quatre décimales), la bascule, la subvention (montant et deux comptes), la
sortie (date, prix, cession ou rebut) et l'origine (l'acquisition du livre d'où la fiche est née). Une
révision : changée ailleurs, jamais écrasée. Poser une fiche : qui saisit.

**C29. Une dotation écrite est liée à son bien** (`compta.immobilisation_ecriture`) : les dotations,
reprises de subvention et sorties d'une année entrent au brouillard (qui valide les écrit, comme la
v10), datées dans l'année ; une dotation ou une sortie déjà passée ne se repasse pas. Tant qu'une
dotation est écrite, ce qui fait le plan (valeur, durée, dates, méthode…) ne change pas, une sortie ne
se pose pas sous elle, et la fiche ne se supprime pas — le refus de la v10 d'abord, mot pour mot, puis
celui du serveur. Supprimée ou contre-passée, l'écriture ne vaut plus, et le lien avec elle.

**Les tests** : par l'API et dans la base (`tests/compta/immobilisations.test.ts`) ; à la souris
(`tests/web/cabinet-immobilisations.test.ts`) : l'acquisition d'une camionnette (36 000,600) proposée,
sa fiche créée sur cinq ans, la dotation de 2025 écrite au millime (6 000,100 : dix mois sur douze),
liée ; puis la durée qui ne change plus et le bien qui ne se supprime pas.

**Reste connu** :
- Les immobilisations que l'**entreprise** tient dans son propre SkanFact (son écran « Immobilisations »
  de la v10) ne sont pas encore ce registre : deux registres pour une entreprise, à réunir.
- Une reprise de subvention n'est pas liée à son bien (comme dans la v10) : elle se propose tant que
  l'année a une dotation ou une sortie à écrire.

## Brique 42 bis : l'inventaire de stock (fait le 29/09/2026)

Le Cabinet v10 gardait l'inventaire compté au dernier jour de l'exercice (référence, désignation,
quantité, coût unitaire, collés depuis un tableur) et proposait la variation de stock : ce que le
compte de stock portait, contre ce qu'on vient de compter. Sur la plateforme, le même onglet Inventaire.

**C30. L'inventaire d'une année se garde au serveur** (par délégation, migration `0027`,
`compta.inventaire`) : ses lignes (la quantité en **millièmes** — un stock se compte aussi en kilos —,
le coût unitaire en millimes) et son **total, calculé au serveur** (chaque ligne arrondie au millime,
puis la somme ; l'écran montre ce total). **Ce qui part au serveur** (compté) : la date, le compte de
stock, et pour chaque ligne sa référence, sa désignation, sa quantité et son coût. Refait, il remplace
le précédent, sauf une fois sa variation passée en écriture. La variation se calcule par la v10 sur le
livre du serveur, entre au brouillard (qui valide l'écrit), datée dans l'année, et se lie à
l'inventaire ; repassée, elle se refuse ; supprimée ou contre-passée, le lien ne vaut plus.

**Les tests** : par l'API et dans la base (`tests/compta/inventaire.test.ts`), avec une ligne dont la
valeur s'arrondit vers le haut (12,345 × 1,779 = 21,961755 → 21,962) ; à la souris
(`tests/web/cabinet-inventaire.test.ts`) : l'inventaire collé, 203,282 au serveur ; la variation de
+53,282 contre les 150,000 du compte ; dessous, l'inventaire qui ne se refait pas, et le refus de la v10.

**Reste connu** : le stock d'ouverture d'une année se lit dans ses écritures ; sans les à-nouveaux de
la clôture (brique 45), l'année suivante ne voit pas le stock de l'année d'avant.

## Brique 43 : la paie tenue par le cabinet (fait le 29/09/2026)

Le Cabinet v10 tenait, dans le livre de chaque dossier, ses salariés et ses bulletins (le calcul de
`compta.js`, celui de l'entreprise) et y passait l'écriture de paie du mois. Sur la plateforme, le même
onglet Paie.

**C31. Une seule paie par entreprise** (par délégation) : les salariés et les bulletins que le cabinet
établit s'écrivent dans le **dossier du client** (`employees`, `payslips`), les mêmes que son SkanFact
écrit, par le même chemin d'enregistrement (`appliquer`, brique 31) : chaque bulletin y est
**recalculé** par le moteur du serveur (un millime d'écart : refusé), la paie du serveur le tient, et
l'**écriture de paie du mois suit d'elle-même** (en totaux du mois, brique 34) — « Passer l'écriture de
paie » n'a plus rien à faire, l'écran le dit. Le client voit dans son SkanFact les bulletins que son
cabinet établit, et l'inverse. Une route à part (`GET/POST /entreprises/:e/paie/dossier`) n'ouvre que
ces deux collections ; **ce qui part au serveur** : la fiche du salarié et le bulletin, dans la forme
de l'entreprise (ce que la v10 du client y met, comme son RIB, reste tel quel). Modifier ou supprimer
un bulletin d'un mois déjà écrit n'est plus refusé : le serveur réécrit le mois.

**Qui peut** : le propriétaire, l'administrateur, le rôle Paie de l'entreprise ; au cabinet,
l'associé et le collaborateur Paie, **si le mandat comprend la paie** (décochée par défaut, 03 § 3.4)
— la porte, et la base, qui ne laisse écrire la paie qu'à ceux qui la font (`paie.mes_entreprises`).

**Les tests** : par l'API (`tests/cabinet/paie.test.ts`) : sans la paie au mandat, rien ; avec, un
bulletin faux d'un millime refusé et rien d'écrit, puis le juste, tenu au serveur, son écriture de mars
au journal PAIE, et le client qui voit le même dossier ; le collaborateur comptable refusé, jusque dans
la base. À la souris (`tests/web/cabinet-paie.test.ts`) : un salarié déclaré, son bulletin de mars
avec une prime, le même net à l'écran et au serveur, l'écriture du mois déjà là.

**Reste connu** :
- Le fichier CNSS du trimestre (`fichierCnss`) : en ligne depuis la brique 49.
- La base laisse encore un membre du cabinet lire par une requête directe tout le dossier v10 d'un
  client dont il a un mandat (les routes, elles, ne l'ouvrent pas) : resserrer sa sécurité par ligne
  demande de revoir ce que les écritures du serveur y lisent (le plan, les avances). À décider.
- Les barèmes de paie propres à un dossier (le réglage « paie » de sa fiche au Cabinet v10) : le
  barème général s'applique.

## Brique 44 : la révision et les questions au client (fait le 29/09/2026)

Le Cabinet v10 tenait, dans le livre de chaque exercice, son dossier de travail — les feuilles
maîtresses par cycle, les comptes signés, les notes de revue, le questionnaire de fin d'exercice, la
révision arrêtée — et les questions posées au client, qui partaient dans un fichier `.skanask` (signé,
scellé au besoin) et revenaient avec leurs réponses dans le paquet suivant. Sur la plateforme, le même
onglet Révision.

**C32. La révision est le dossier de travail du cabinet** (par délégation, migration `0028`) : elle
appartient au **cabinet** (comme la fiche d'un dossier, elle ne part pas avec l'entreprise), par
dossier et par période (l'exercice, ou un mois), et se garde **entière**, dans la forme de la v10, avec
une révision : deux postes qui écrivent en même temps, le second relit (rien n'est écrasé). Les
feuilles maîtresses se calculent par la v10 sur le livre du serveur ; signer un compte, écrire ou lever
une note, poser et remplir le questionnaire, arrêter ou rouvrir la révision : la fonction de la v10,
puis la révision de la période au serveur, **au nom de qui l'a fait**. Qui révise : l'associé et le
collaborateur, sur un dossier dont le mandat comprend la comptabilité — jamais l'assistant ni le
client, qui ne la lit pas (`cabinet.peut_reviser`). Le **questionnaire** et les **cycles** du cabinet
sont des réglages du cabinet (`cabinet.reglages`), écrits une fois pour tous ses dossiers.

**C33. Une question appartient à l'entreprise** (par délégation) : elle se range dans ses livres, en
face de sa pièce (`compta.question`). Le cabinet la **pose** (qui saisit, l'assistant aussi, comme la
v10) ; elle reste chez lui jusqu'à ce qu'il l'**envoie** (qui valide) : plus de fichier, l'envoi la rend
visible au client, et **chaque envoi se compte** comme chaque fichier se comptait — deux envois sans
réponse, elle remonte dans « À faire ». Jamais envoyée, elle se retire sans trace ; envoyée, elle se
ferme (et se rouvre), elle ne s'efface plus ; elle se précise tant qu'elle n'a pas sa réponse. Le
client y répond (le propriétaire, l'administrateur, la comptabilité interne — jamais le cabinet à sa
place), tant qu'elle n'est pas fermée ; répondue, elle ne se réécrit plus. **Ce qui part au serveur**
(compté) : la période, le cycle, le compte, l'écriture et la pièce visées, le montant (en millimes),
l'objet, le texte, ce qu'elle attend ; la réponse du client, en texte. Rien de tout cela ne touche aux
chiffres du client. Le journal de l'entreprise trace chaque geste (posée, précisée, retirée, envoyée,
répondue, fermée, rouverte).

**Un défaut de la v10, corrigé ici** : après avoir écrit le questionnaire dans les Réglages, l'onglet
Révision du dossier montrait encore « Écrire le questionnaire… » (le dossier de révision ne se relisait
que si le livre avait bougé) ; il se relit maintenant aussi quand la méthode du cabinet change. La v10
en entretien garde ce défaut (il ne touche aucun chiffre).

**Les tests** : par l'API et dans la base (`tests/cabinet/revision.test.ts`) : la révision gardée
entière, jamais écrasée, refusée à l'assistant, au client et sans la comptabilité au mandat ; une
question posée par l'assistant, invisible au client, retirée avant l'envoi, envoyée deux fois (« À
faire » : à relancer), refusée à l'effacement, précisée, répondue par le client seul, fermée,
rouverte, et le journal de l'entreprise qui le dit. À la souris (`tests/web/cabinet-revision.test.ts`) :
un compte signé, une note écrite puis levée, le questionnaire écrit dans les Réglages, posé et rempli,
une question depuis la ligne du 471 (hors cycle), envoyée, lue par le client, sa réponse revenue sur
l'écran du cabinet, la révision arrêtée « par associe ».

**Reste connu** :
- **Le client lit et répond dans son SkanFact** : brique 44 bis, ci-dessous.
- Une réponse du client n'emporte pas encore de pièce jointe (le serveur ne garde pas encore les
  fichiers) : elle est en texte.
- Le « Suivi » de production (la période marquée révisée) viendra avec le tableau de production.

## Brique 44 bis : les questions du cabinet chez le client (fait le 29/09/2026)

SkanFact v10 recevait les questions du comptable dans un fichier `.skanask`, les posait en face de la
pièce qu'elles visent et dans l'onglet Cabinet de la Comptabilité, et renvoyait les réponses dans le
paquet suivant. Sur la plateforme, les mêmes écrans.

**C34. Les questions arrivent d'elles-mêmes, les réponses partent aussitôt** (par délégation) : le
point de contact de l'entreprise lit, dans ses livres (`GET compta/questions`), celles que le cabinet
lui a **envoyées** et n'a **pas fermées**, dans la forme de la v10 (chaque envoi compte une réception :
la règle des deux envois vaut des deux côtés) ; qui ne lit pas les livres ne les voit pas. Elles ne
vont **jamais** dans le dossier de l'entreprise (le dossier v10 garde une liste vide). La réponse
enregistrée part au serveur (`POST …/repondre`) avant le reste du dossier, et elle seule : rien d'autre
de la question ne se change ici. **L'onglet Cabinet** de la Comptabilité ne fabrique plus de paquet :
il porte les questions, et dit à qui le dossier est confié (le même panneau que Paramètres → Envois).
Les textes (« À faire », les bulles, la fenêtre de réponse) disent l'envoi et la lecture en direct,
plus le paquet ; une pièce jointe à une réponse n'est pas encore en ligne, et la fenêtre ne la promet
plus.

**Les tests** : à la souris (`tests/web/questions-client.test.ts`) : quatre questions — deux envoyées,
une fermée, une jamais partie ; le client voit les deux premières seulement, et son cabinet ; il
répond à l'une depuis l'onglet Cabinet, à l'autre en face de l'achat qu'elle vise (le bandeau
disparaît) ; les deux réponses sont au serveur, et son dossier ne contient aucune question.

La visite guidée « Répondre aux questions de mon comptable » dit la même chose (plus de fichier à
importer, plus d'étape « elle part dans le paquet »).

**Reste connu** :
- Les autres visites et pages de l'entreprise qui parlent encore du paquet du mois (fabriquer,
  envoyer au comptable) sont à revoir avec la partie entreprise (hors des briques du Cabinet).

## Brique 45 : la clôture de l'exercice, sa réouverture, l'année d'après (fait le 29/09/2026)

Le Cabinet v10 clôturait un exercice après ses contrôles (qui nomment sans bloquer) : plus rien n'y
bougeait, et le rouvrir exigeait un motif, gardé avec la clôture qu'il défaisait. « Ouvrir N+1 » posait
les à-nouveaux dans l'année d'après, en brouillard, à refaire tant qu'ils n'étaient pas validés. Sur la
plateforme, le même onglet Exercice.

**C35. Clôturer, c'est fermer la période jusqu'au dernier jour** (par délégation, migration `0029`) :
les livres du serveur ont déjà leur période close (brique 35 : validée jusqu'à un jour, plus rien ne s'y
écrit, une pièce qui change s'écrit au premier jour ouvert). Clôturer l'exercice valide la période
jusqu'au 31 décembre et le marque clos (qui, quand). Deux différences avec la v10, dites **avant** la
question : l'exercice doit être **fini** (une période ne se valide qu'une fois passée), et **aucune
écriture ne doit rester au brouillard** jusque-là — la clôture ne valide rien en silence ; le contrôle
« Les pièces encore en brouillard » mène au brouillard. **Rouvrir** exige un motif (cinq caractères au
moins, comme la v10) : la période close revient où elle était **avant** la clôture (rien de validé :
plus de période close ; validée jusqu'au 30 septembre : le 30 septembre), et la réouverture se garde
(quand, qui, pourquoi, la clôture qu'elle défait) ; jamais si des jours d'après l'exercice sont déjà
validés (les rouvrir aussi n'est pas ce qu'on demande). Une écriture validée ne bouge pas pour autant :
elle se contre-passe. Qui : qui valide ; au cabinet, **l'associé** seulement (la v10 : « supervision »),
à la porte et dans la base.

**L'année d'après** : « Ouvrir N+1 » joue le geste de la v10 (`ouvrirExerciceSuivant`) sur le livre de
l'année d'après et écrit au serveur ce qu'il y change — les à-nouveaux au 1er janvier, au journal AN, en
**brouillard** (relus, puis validés), ceux qu'il remplace retirés ; l'exercice d'après s'ouvre s'il ne
l'est pas. « Refaire », « Ajuster » (les à-nouveaux complémentaires quand l'exercice a changé après leur
validation) et « Voir » suivent l'état que la v10 calcule.

**Un défaut de la plateforme, corrigé ici** : les onglets qui se relisent « quand le livre a bougé »
(Déclaration, Révision, Liasse, Exercice) guettaient la piste d'audit du livre, que le point de contact
laissait vide : valider un brouillard dans la Saisie laissait l'Exercice sur ses contrôles d'avant. Le
livre porte maintenant un geste par enregistrement fait depuis l'ouverture.

Sans objet en ligne : « Réunir le livre d'un autre poste » (un seul livre, au serveur) disparaît.

**Les tests** : par l'API et dans la base (`tests/compta/cloture-exercice.test.ts`) : la clôture refusée
sur un brouillard et sur un exercice qui court encore, faite (validée jusqu'au 31 décembre, au nom de
l'associé), refaite (« déjà clos »), plus rien ne s'y écrit ; la réouverture sans motif refusée, avec
motif gardée, la période revenue à rien, puis au 30 septembre validé avant ; refusée quand janvier
d'après est validé ; le collaborateur refusé à la porte et dans la base, l'entreprise sous mandat aussi.
À la souris (`tests/web/cabinet-cloture.test.ts`) : la clôture refusée avant la question sur un
brouillard, le brouillard validé dans la Saisie et l'Exercice relu sans recharger, la clôture, les
à-nouveaux de 2026 au 1er janvier au millime, la réouverture et son motif à l'écran.

**Reste connu** :
- « Le dossier pour le client » (le fichier de clôture signé, avec ses états en PDF) n'est pas encore en
  ligne : le client lit ses livres en direct ; ses états arrêtés viendront avec les documents du serveur.
- La porte, sous un mandat de comptabilité, écrit « Peuvent le faire : » le propriétaire, que la base
  refuse ensuite (c'est le cabinet qui valide) : sa liste ne connaît pas encore les mandats.
- Une ligne d'à-nouveau lettrée ne garde pas sa lettre (la saisie du serveur ne la prend pas) : elle se
  relettre dans l'année d'après.
- Prévoir l'extourne d'une écriture de décembre à l'ouverture (`prevoirExtourne`) n'est pas en ligne :
  l'extourne se pose directement (brique 38).

## Brique 46 : l'équipe du cabinet (fait le 29/09/2026)

Le Cabinet v10 déclarait ses collaborateurs par leur **nom** — une identité déclarée sur un poste, sans
mot de passe (celui du cabinet ouvrait déjà toute la base) — et posait des droits dossier par dossier.
Sur la plateforme, le même panneau (Réglages → Mon cabinet → L'équipe) et la même fiche de dossier.

**C36. Chacun son compte ; on rejoint un cabinet par une invitation** (par délégation, migration
`0030`) : un **associé** invite une personne par son **adresse**, avec un rôle — associé
(« Supervision »), collaborateur (« Saisie et validation »), assistant de saisie (« Saisie »). Le lien
se transmet à la personne (SkanFact n'envoie pas encore de courriel : l'écran le montre, à copier) ;
elle l'ouvre, se connecte avec **cette adresse** — ou crée son compte avec elle — et rejoint le cabinet
(l'invitation de l'entreprise, 0003, étendue aux cabinets ; une fois, sept jours). Plus d'identité
déclarée par poste : « Je suis » disparaît, l'écran dit sous quel nom on est connecté. Un associé
change le rôle d'un membre ou le **retire** (il n'est pas effacé : son nom reste sur ce qu'il a fait ;
il n'ouvre plus le cabinet ni ses dossiers) ; **personne ne change son propre rôle ni ne se retire** —
un autre associé le fait, et le cabinet garde donc toujours un associé. Une invitation qui attend
s'annule. **Confier un dossier** : dans sa fiche (onglet Suivi), un rôle posé sur une personne le lui
confie (`confier_dossier`, brique 36) ; sans rôle posé, le dossier ne lui est pas ouvert — seuls les
associés voient tous les dossiers (la v10 : « son rôle général » s'appliquait partout). Chaque geste
se trace au nom du cabinet.

**L'entrée** (l'écran de connexion de la plateforme) garde le lien d'invitation le temps de se
connecter, l'accepte, et ouvre ce qu'il fait rejoindre ; refusée (une autre adresse, un lien qui ne vaut
plus), la raison se lit, et « Continuer » reprend le chemin habituel. Elle vaut aussi pour une
invitation dans une entreprise.

**Les tests** : par l'API et dans la base (`tests/cabinet/equipe.test.ts`) : l'invitation acceptée par
la bonne adresse seulement, une fois ; le dossier confié dans le portefeuille ; le membre retiré qui
n'ouvre plus rien ; la trace ; seul un associé invite, change ou retire (jusque dans la base) ; on ne
s'invite pas soi-même, ni deux fois ; on ne se rétrograde ni ne se retire ; une invitation annulée ne vaut
plus. À la souris (`tests/web/cabinet-equipe.test.ts`) : l'invitation écrite dans le panneau, son lien,
ouvert par la personne connectée — elle arrive dans le Cabinet ; le dossier confié depuis sa fiche ; son
rôle changé, puis retirée ; pas de menu sur sa propre ligne.

**Reste connu** :
- SkanFact n'envoie pas encore le courriel d'invitation : le lien se copie et se transmet à la main.
- La visite guidée « Travailler à plusieurs » se réécrira pour l'invitation (elle se termine chez
  l'invité) : elle n'est pas proposée en ligne.
- L'état du cabinet se lit à l'ouverture : un membre qui vient de rejoindre apparaît dans la fiche des
  dossiers après avoir rouvert la page (le panneau L'équipe, lui, se relit à chaque affichage).
- La trace de l'équipe est gardée au serveur ; elle ne se lit pas encore à l'écran.

**Un défaut de la brique 45, corrigé ici** : depuis que les onglets se relisent quand la piste du livre
s'allonge, un geste faisait relire l'écran **deux fois** (sa propre relecture, puis celle de la piste
allongée) ; un clic tombé pendant la seconde se perdait (vu sur la vérification en ligne : l'inventaire,
la déclaration, la révision). Une lecture retient désormais le livre qu'elle a lu, et ne se refait pas
pour lui ; un livre quitté pendant une lecture ne fait plus d'erreur. Les seize parcours du Cabinet
passent côte à côte.

## Brique 47 : la fiche et les réglages du cabinet (fait le 29/09/2026)

Le Cabinet v10 gardait sa fiche (nom, adresse, téléphone) et ses réglages (le jour des relances, les
jours de dépôt TVA et CNSS, la grille de saisie, le thème, les régimes et leurs échéances, les
échéances pointées) dans son fichier. Sur la plateforme, les mêmes écrans (Réglages → Mon cabinet,
Comptabilité, L'application ; la page Échéances ; l'assistant de bienvenue).

**C37. Le nom du cabinet est un geste d'associé ; le reste de sa fiche est un réglage du cabinet**
(par délégation, migration `0031`) : le nom signe les relances et se lit chez chaque client quand il
confie son dossier ; **seul un associé le change** (`socle.renommer_cabinet`, un à deux cents
caractères), et le changement se trace au nom du cabinet (avant, après). L'adresse, le téléphone et les
réglages de la v10 vivent dans les réglages du cabinet (`cabinet.reglages`, 0023, une révision : jamais
écrasés par un autre poste). **Ce qui part au serveur, compté** — ces champs, et rien d'autre (le
serveur refuse tout autre champ, et toute valeur hors de sa forme) :
`email` (une adresse, ou rien), `phone` (40 caractères), `relanceDay` (1 à 28), `deadlines` (`tvaDay`,
`cnssDay` : 1 à 31), `saisie` (le journal proposé, la date complète, la validation par lot, les cinq
touches, la date du réglage), `theme` (clair, sombre, comme le système), `depots` (les échéances
pointées, « tva-m@2026-05-28 »), `regimes` (cinquante au plus : leur nom, leur TVA, la CNSS, trente
échéances annuelles chacun), avec `formatCopie` (brique 41). Les règles de fusion sont celles de la
v10 : ce qui n'est pas fourni ne change pas ; la saisie se fusionne touche par touche ; les régimes et
les échéances pointées se remplacent (retirer, dépointer sont des gestes) ; puis la v10 normalise
(`migrate`), et c'est ce qui s'enregistre. Un réglage que le serveur ne garde pas se dit « pas encore en
ligne », et rien ne part. Le nom part **en dernier** : un collaborateur qui enregistre la fiche garde
ses réglages, et lit pourquoi le nom n'a pas changé.

**L'écran** dit sur le champ, avant d'envoyer, qu'un nom est vide ou qu'une adresse ne se lit pas (le
serveur le refuserait). La visite « Nommer mon cabinet » se montre de nouveau, sans parler du fichier
d'appairage (il n'y en a plus : le client confie son dossier par le code du cabinet).

**Les tests** : par l'API et dans la base (`tests/cabinet/fiche.test.ts`) : l'associé renomme, un
collaborateur et une personne hors du cabinet ne le peuvent pas, un nom vide est refusé, la trace ;
chaque réglage se garde et se relit, chaque forme fausse est refusée (adresse, jours, thème, échéance
pointée, régime, journal, champ inconnu). À la souris (`tests/web/cabinet-fiche.test.ts`) : le nom vide
et l'adresse illisible refusés sur leur champ, sans rien envoyer ; la fiche enregistrée, le nom en haut
de l'écran ; la grille de saisie ; le thème appliqué tout de suite et gardé ; tout relu après
rechargement ; la visite jouée jusqu'au bout.

**Un défaut de la brique 46, corrigé ici** : la liste de l'équipe se triait par nom selon la langue de
la base ; « associe » et « Nour » ne venaient pas dans le même ordre sur la machine de travail et sur
GitHub. Elle se trie désormais sans tenir compte des majuscules.

**Reste connu** :
- Le téléphone et l'adresse du cabinet ne partent encore nulle part d'eux-mêmes : SkanFact n'envoie pas
  de courriel (les relances s'écrivent dans la messagerie du comptable, comme dans la v10).

## Brique 48 : la page Production (fait le 29/09/2026)

Le Cabinet v10 rangeait à côté de chaque livre un **index** : pour chaque mois, combien d'écritures,
validées, au brouillard, qui y a fait le dernier geste et quand, et si le mois est révisé, déclaré
(`cabstore.js`, `productionDuLivre`). Le tableau de production le lisait sans ouvrir un seul livre ; les
Échéances aussi (les mois d'un dossier tenu au cabinet, les mois déclarés).

**C38. La production se compte au serveur, pour tout le portefeuille, en une fois** (par délégation ;
pas de migration) : `GET /cabinets/:c/production?depuis=` rend, pour les dossiers actifs du
portefeuille et depuis le premier jour d'un mois — par mois, les écritures **hors à-nouveaux** (une
balance d'ouverture n'est pas une saisie), validées et au brouillard, **qui** a fait le dernier geste
(celui qui a validé, sinon celui qui a saisi) et **quand** ; les déclarations (déposée ou non) ; les
révisions d'un **mois** (arrêtée ou non) ; les exercices ouverts. Quatre lectures groupées, la sécurité
par ligne dit qui lit (un autre cabinet n'en lit rien). Le point de contact en refait l'index de la v10
(`indexDesLivres`) : un mois qui a une écriture, une déclaration ou une révision existe, « révisé » et
« déclaré » y valent non tant que rien ne les pose ; chaque année a son exercice — ouvert au serveur,
sinon celui du calendrier —, et c'est lui qui donne ses mois à un dossier tenu. Le tableau est celui de
la v10 (`production`), au même calcul que le portefeuille.

**Le même index nourrit les Échéances** (le résumé `questionsEnAttente` de la v10) : un dossier tenu
au cabinet y entre avec ses mois à saisir, et un mois dont la déclaration est déposée y compte déposé.
Jusqu'ici, sur la plateforme, un dossier tenu n'y entrait pas, et les visites qui cherchent « un
dossier qui a son livre » n'en trouvaient qu'après en avoir ouvert un. Ce que le livre sait des
salariés (la CNSS des seuls employeurs) n'est pas encore lu : la CNSS reste comptée par prudence, et
la carte le dit.

**Les mots** : ceux du Cabinet sans paquets (C14). Un mois passé sans aucune écriture est
« manquant » (il était « pas encore reçu ») ; le détail d'une case dit « écrit » ou « manquant ». Le
tableau **se relit chaque fois qu'on entre sur la page** : la v10 le lisait une fois, et un mois saisi
dans la journée y restait « à saisir » jusqu'au lendemain (le défaut existe aussi dans la v10 en
entretien, où il n'est pas corrigé). La visite « Suivre la production du cabinet » se montre ; la bulle
« i » de la page et le résumé de la page dans « Me guider » disent les étapes sans « reçu » ni paquets.

**Les tests** : par l'API et dans la base (`tests/cabinet/production.test.ts`) : les mois comptés
(hors à-nouveaux, validées, brouillards, dernier geste et son auteur), la déclaration déposée ou
préparée, la révision arrêtée ou ouverte (celle de l'année ne compte pas pour un mois), l'exercice ;
rien d'avant la date, rien d'un autre cabinet, rien d'un dossier sans livre. À la souris
(`tests/web/cabinet-production.test.ts`) : chaque case dit son étape et son détail ; « à saisir » compte
les mois dus d'un dossier tenu, et se relit en revenant ; la page ne dit ni « paquet » ni « reçu » ; les
Échéances nomment le dossier tenu ; la ligne ouvre la comptabilité ; la visite se joue jusqu'au bout.

**Reste connu** :
- La CNSS des seuls employeurs : ce que la Paie ou les comptes de rémunération disent des salariés
  n'est pas encore compté au serveur ; chaque client déposant reste compté par prudence.

## Brique 49 : le fichier CNSS du trimestre (fait le 29/09/2026)

Le Cabinet v10 fabriquait, depuis l'onglet Paie d'un dossier, le fichier de télédéclaration des
salaires du trimestre (le format « CNSS 2012 » : un enregistrement de 122 caractères par salarié, douze
par page, un nom de fichier imposé), et l'enregistrait par une fenêtre « Enregistrer sous ».

**C39. Le fichier CNSS se fabrique dans le navigateur et se télécharge** (par délégation ; rien de
neuf au serveur) : le moteur de la v10 (`fichierCnssDuLivre`) sur le livre et la paie que le serveur
tient pour le dossier (salariés, bulletins de l'année, brique 43), avec le matricule employeur et le
code d'exploitation de la fiche du dossier (`cnssEmployeur`, `cnssCode`, déjà gardés au serveur depuis
la brique 36). Refusé, il nomme chaque case à corriger avec le geste qui la lève (la v10, inchangée).
Accepté, il se **télécharge** sous le nom que le format exige (`DS` + matricule + code + trimestre +
année) ; rien ne part au serveur. L'écran le dit : le fichier est dans les téléchargements, et il faut
lui garder exactement ce nom — le portail refuse un fichier renommé, et un navigateur ajoute « (1) » au
nom d'un fichier déjà téléchargé.

**Les tests** : à la souris (`tests/web/cabinet-cnss.test.ts`) : une salariée avec sa fiche CNSS
complète et son bulletin de mars ; sans matricule employeur, le fichier ne sort pas et la case est
nommée ; le matricule posé depuis ce refus (gardé au serveur) ; le fichier téléchargé sous son nom, en
ASCII, un enregistrement de 122 caractères, dont le salaire est l'assiette que le serveur déclare pour
le trimestre (deux chemins, un chiffre) ; le message qui dit de garder le nom. Le format lui-même : les tests du moteur de la v10
(`test/suites/cnss-fichier.js`) portés sur l'écran de la plateforme (`tests/v10/cnss-fichier.test.ts`) —
chaque champ à sa place (positions écrites depuis le document), douze lignes par page, le salaire en
millimes arrondi, aucun fichier tant qu'une ligne est fausse, le fichier tiré du livre.

**Deux parcours rendus sûrs sur GitHub** (plus lent que la machine de travail) : la visite « Nommer mon
cabinet » (brique 47) tapait le nom pendant que la page finissait de se dessiner, et la frappe se
perdait — le parcours retape le nom tant qu'il n'est pas resté dans la case, et vérifie que l'étape
n'est pas déclarée « déjà faite » ; le parcours de la banque (brique 40) lisait la fiche du dossier
juste après les réglages, alors qu'elle s'écrit en second — il l'attend.

**Reste connu** :
- Le format est celui que la v10 a écrit d'après le document de la CNSS : **À VÉRIFIER** sur le
  portail avec le comptable pilote, comme dans la v10.
