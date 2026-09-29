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
| 37 | Les écrans du Cabinet copiés et chargés ; le portefeuille et le livre d'un dossier lus au serveur (la balance que calcule l'écran égale celle du serveur : deux chemins, un chiffre) ; tout le reste répond « pas encore en ligne ». |
| 38 | La saisie : écritures saisies par le cabinet (brouillard, modification, suppression), validation d'une écriture ou d'un lot, contre-passation, extourne, lettrage ; le mois validé par le cabinet (C8). |
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
