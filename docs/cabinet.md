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
| 39 | La reprise : plan, balance d'ouverture (à-nouveaux), écritures par tableur. |
| 40 | La banque : relevés, rapprochement, lettrage automatique. |
| 41 | Les déclarations (TVA, retenues), la liasse, le FEC et les exports. |
| 42 | Immobilisations et dotations, inventaire et variation de stock. |
| 43 | La paie tenue par le cabinet (mandat Paie). |
| 44 | La révision, le questionnaire, les questions au client et ses réponses. |
| 45 | La clôture de l'exercice, sa réouverture (avec un motif), l'exercice suivant. |
| 46 | L'équipe du cabinet : invitations, rôles, affectations par dossier, trace de l'équipe. |

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
reprise, exporter les écritures, suivre la production).

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
