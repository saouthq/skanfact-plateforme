# SkanFact, la plateforme — consignes pour Claude

*Créé le 28/09/2026, au premier code de la plateforme (J0 → étape 1).*

## Qui, quoi, où est la règle

- **Propriétaire** : Skander Ben Amor (saouthq). **Français, tutoiement**, mots simples : il ne tape
  pas de commandes ; Claude fait le travail (code, tests, commits, envois) et l'explique sans jargon.
- **Le cadrage fait foi, et il vit dans l'autre dépôt** : `saouthq/skanfact`
  (`/home/user/skanfact`) : `VISION-ARCHITECTURE.md`, `docs/cadrage/` (01 modèle de données,
  03 droits, 04 hors-ligne, 09 feuille de route, 12 pile technique…), et son `CLAUDE.md` (les
  leçons de la v10, qui valent ici). On **applique** le cadrage ; une décision nouvelle s'écrit
  **là-bas**, avec sa date. Ce qui est incertain (fiscal, légal) s'écrit « À VÉRIFIER ».
- **Où on en est** : étape 1, le socle (mois 1 à 4). Fait le 28/09/2026 : le dépôt, ses
  vérifications automatiques, la migration `0001_socle` (organisations, entreprises,
  établissements, personnes, membres, mandats, appareils, sécurité par ligne) et ses tests ; la
  connexion (`0002`, `serveur/connexion.ts`) ; l'équipe, la porte des droits et la trace (`0003`,
  `serveur/porte/`, `serveur/app.ts`, `serveur/routes/socle.ts`) ; les règles fiscales datées,
  la numérotation et le journal inaltérable (`0004`, `serveur/regles.ts`, `numeros.ts`,
  `journal.ts`) ; la file d'opérations des postes (`0005`, `serveur/file.ts`) ; le moteur commence :
  le calcul d'une pièce en entiers (`moteur/`) et le banc qui le compare à la v10 au millime
  (`banc/v10/`) ; les tiers et la facture de vente du brouillon à l'émission (`0006`,
  `serveur/ventes/`), avec **la première moitié du jalon J1** : les 273 factures de l'exemple de
  cinq ans émises par le serveur au millime de la v10 (`tests/ventes/j1-exemple.test.ts`).
  Kysely est branché (`requetes(tx)`, `base/types.ts` écrit par `base/generer-types.ts`) ;
  l'export et la restauration d'une entreprise (`base/entreprise.ts`). **Le jalon J1 est atteint.**
  Le catalogue des textes et la langue factice (`textes/`). Les clés de l'API, les adresses `/v1`
  et la documentation générée (`0007`, `serveur/cles.ts`, `GET /v1/documentation`). Le moteur
  d'écritures commence : l'écriture d'une facture de vente, au millime de la v10
  (`moteur/ecritures.ts`) ; ses règlements : la retenue née à chaque encaissement, le reste à payer,
  le statut, l'écriture de l'encaissement (`moteur/reglements.ts`) ; l'écriture d'un avoir (même
  fichier que la facture) ; les achats : calcul, écriture, imputation d'un acompte, règlements, reste et statut
  (`moteur/achats.ts`) ; la paie : le bulletin, ses écritures et la CNSS du trimestre
  (`moteur/paie.ts`) ; la TVA du mois lue dans les écritures (`moteur/declarations.ts`), égale à celle de la v10 sur cinq ans (deux chemins, un chiffre).
- **Le hors-ligne** (briques 72 à 75, `docs/hors-ligne.md`) : l'application s'installe
  (`web/public/sw.js`, le manifeste) ; sur « mon ordinateur », la session se garde dans le navigateur et
  une copie chiffrée de l'entreprise (`web/public/plateforme/poste.js`, clé non exportable) la rouvre
  sans réseau ; ce qu'on y enregistre attend et part seul au retour — si le navigateur promet de garder
  (stockage persistant : les tests le jouent en « application installée ») et moins de 72 heures après
  le dernier contact avec le serveur ; jamais sur l'ordinateur d'un autre. Un appareil retiré (« Tes appareils ») remet ce qui attendait en quarantaine (0044), puis
  efface tout ; le propriétaire décide. Un test hors ligne coupe le réseau en ARRÊTANT le serveur : le
  service des écrans passe à côté de la coupure que le navigateur simule (ou on le bloque dans le
  contexte du navigateur, `serviceWorkers: 'block'`, quand le parcours n'a pas à rouvrir sans réseau).
- **La lecture d'une facture d'achat en photo ou en PDF** (brique 84, `docs/achats.md`) : sur NOS serveurs
  (Tesseract, Poppler : `serveur/achats/lecteur.ts`, une file de deux lectures), le fichier jamais gardé ;
  une proposition que la v10 fait relire, chaque champ avec la ligne où il a été lu, le total recompté
  (`serveur/achats/lecture-facture.ts`) ; aucun taux supposé. Le seuil (9 sur 10 sur de vraies factures)
  reste à mesurer : la lecture de photo ne s'annonce pas avant.
- **Les commandes livrées en plusieurs fois** (brique 86, `docs/livraisons.md`) : le bon tiré d'une commande
  reprend ce qui reste (lignes rattachées : `ligneCommande`) ; UNE fonction compte ce qui est livré
  (`suiviCommande`, core.js) ; « Facturer des bons… » fait une facture de plusieurs bons, chaque ligne de
  commande en une ligne ; ses bons (`bonsLivraison`) sont scellés par le serveur à l'émission.
- **Les commandes fournisseurs et leurs réceptions** (brique 87, `docs/commandes-fournisseurs.md`) : dans le
  dossier (`supplierOrders`, `receptions`), jamais parmi les achats ; « Recevoir » reprend ce qui reste, UNE
  fonction compte ce qui est reçu (`suiviCommandeFournisseur`) ; une réception VALIDÉE fait entrer le stock
  au prix de la commande en dinars ; la facture saisie depuis les réceptions marque ses lignes `recue` (le
  stock n'entre pas deux fois) ; une commande qui a une réception, même en préparation, fige ses lignes.
  Les écarts facture/réceptions (brique 88, `ecartsAchatReceptions`, par la ligne de commande `origine`)
  se disent sous les lignes et sur la commande ; rien n'est refusé.
  La demande de prix (brique 89) : le statut « demande » (même série BCF, imprimée sans prix) ; ses copies
  chez d'autres fournisseurs partagent un `groupe` ; `comparerDemandes` les compare en dinars.
  « À faire » (brique 90) : bons à facturer, réceptions sans facture, commandes en retard, comptés par les
  fonctions des listes qu'ils ouvrent.
- **L'encours autorisé** (brique 91, `docs/encours.md`) : `creditLimit` sur la fiche du client ;
  `encoursClient` (factures non réglées + bons livrés à facturer, en dinars) ; au-delà, la fenêtre d'émission
  le dit avant, avec les chiffres ; la personne décide.
- **Le prix par quantité** (brique 92, `docs/prix-quantite.md`, `web/v10/prix-quantite.txt`) : `paliers`
  sur l'article ; la ligne suit le palier de sa quantité tant que son prix n'est pas tapé (`prixManuel`).
- **Les listes de prix** (brique 93, `docs/listes-prix.md`, `web/v10/listes-prix.txt`) : `priceLists` (catégorie
  `categorieTarif` du client ou clients choisis, dates d'effet) ; `prixArticlePour` : liste qui nomme le client,
  puis sa catégorie, puis palier, puis catalogue ; les lignes déjà faites gardent leur prix.
- **Le stock par dépôt** (briques 94-95, `docs/depots.md`, `web/v10/depots.txt`) : le dépôt principal (`principal`)
  plus `depots` ; chaque mouvement porte le `depotId` de sa pièce (réception, facture, BL, avoir, achat : le champ
  « Dépôt » n'apparaît qu'à partir de deux dépôts) ; `stockImpact` lit le dépôt de la pièce ; un transfert = deux ajustements sans coût (`transfertId`),
  supprimés ensemble. Une seule adaptation par texte : une adaptation ne s'ancre jamais au milieu du texte
  posé par une autre (le test de provenance le refuse) ; elle s'ancre avant son début.
- **Les kits** (brique 96, `docs/kits.md`, `web/v10/kits.txt`) : un article non suivi qui porte `composants`
  ([{ itemId, qty }], des articles suivis) ; `lignesDeStock` déplie la ligne d'un kit en ses composants (pour
  `stockImpact`), `stockMovements` sort chaque composant ; `kitsPossibles`, `coutDuKit`.
- **Les lots** (brique 97, `docs/lots.md`, `web/v10/lots.txt`) : `parLot` sur l'article ; `lot`/`peremption` sur
  les lignes d'entrée, `lot` sur les lignes de sortie ; `stockMovements` pose `lot`, `peremption` (celle de
  l'entrée) ; `stockParLot`, `lotConseille`, `lotsAPerimer`, `lotsDeLaPiece`.
- **L'accord d'un responsable** (brique 98, `docs/accords.md`, `serveur/v10/accords.ts`, `0052`) : le serveur calcule
  le dépassement d'encours avec `core.js` (chargé par `codeDeLEcran`, comme `teif.js`) sur le dossier en base ;
  `ventes.accord` ; un déclencheur réserve `creditLimit` et `encoursAccord` aux responsables. Les écrans (brique 100,
  `web/v10/accords.txt`) : réglage, « Demander l'accord » dans le refus, bandeau de la facture, accueil, `#/accords` ;
  `droits.responsable` grise à l'écran ce que la base refuserait.
  La remise (brique 103, `0054`) : `remiseAccordAuDela` (%) sur la fiche ; geste `remise` (taux, seuil en centièmes de
  %) ; `controlerRemise` avant `controlerEncours` ; la pièce émise porte `accordRemise`.
- **Les droits dans le dossier** (brique 99, `docs/droits-dossier.md`, `serveur/v10/droits.ts`) : chaque partie du
  dossier a un geste pour la lire et un pour l'écrire ; le GET filtre et rend `droits` (`cachees`, `lectureSeule`,
  `ecrivables`, `tout`, `responsable`) ; `appliquer` refuse une partie interdite ; `pont.js` ne renvoie que la liste blanche (ni
  modification ni suppression du reste) ; l'écran refuse avant le geste (`peutEcrireDossier`, `web/v10/droits.txt`).
  Une nouvelle partie du dossier (une nouvelle liste de la v10) **doit** recevoir sa règle, sinon seuls P et A la voient.
  Le menu selon le rôle (brique 101, `web/v10/menu-role.txt`) : une page déclare ses parties (`PARTIES_DES_PAGES`) ;
  cachée, elle quitte le menu et son adresse dit pourquoi. Une nouvelle page **doit** y déclarer les siennes.
  Les pages en lecture seule (brique 102, `web/v10/lecture-seule.txt`) : bandeau, et un geste qui modifierait une
  partie en lecture refuse avant (`enLecture`, `refusLecture`) : jamais un « Enregistré » que le serveur n'a pas reçu.
- Les limites d'appels par clé (`serveur/limites.ts`, 28/09/2026) : 600 par minute, rafales de 60,
  un seau par clé dans la mémoire du programme (à partager le jour où il y aura plusieurs programmes).
- Les avis d'événement signés (`0008`, `serveur/avis.ts`, 28/09/2026) : l'avis naît dans la
  transaction du fait, part signé, se renvoie puis s'abandonne. Le livreur (`livrerAvis`) tourne
  dans le programme serveur.
- La sauvegarde et l'exercice de restauration (`base/sauvegarde.ts`, 06 § 4.3) : dans les tests,
  sur une base à part (d'autres tests cassent des chaînes exprès dans la base commune). Ouvert :
  l'archivage continu à la minute, l'exercice mensuel sur le serveur de test et son rapport à la
  console.
- Le programme serveur (`serveur/principal.ts`, `npm run serveur`) : configuration par
  l'environnement, refus de démarrer si elle est fausse ; en production, exige un fournisseur de SMS
  (pas encore choisi : 03 § 6, 12) ; les messages à l'exploitant (`ConfigurationFausse`,
  `console.*`) sont hors du catalogue.
- **L'application web EST le code de la v10** (Skander, 28/09/2026 : « récupérer le même code et
  l'adapter », `VISION-ARCHITECTURE.md` § 4.8 du dépôt `skanfact`). Les fichiers de
  `src/renderer` (branche `beta`) sont copiés TELS QUELS dans `web/public/v10` par
  `npm run reprendre-v10 -- /chemin/de/skanfact` ; seules les retouches écrites dans
  `web/v10/adaptations.mjs` (chacune avec sa raison) y sont appliquées, et
  `tests/v10/provenance.test.ts` refuse toute retouche à la main. La copie s'est faite une fois ;
  la plateforme est désormais la seule maison des écrans (une correction urgente de la v10 en
  entretien se reporte à la main, par une nouvelle reprise ou une adaptation). Aucun lien vivant
  avec le dépôt `skanfact`.
  - **Le pont** (`web/public/plateforme/pont.js`) remplace ce que la v10 demandait à l'ordinateur
    (`window.skanfact`) : le dossier vient du serveur et y repart objet par objet
    (`serveur/v10/`, table `socle.dossier_v10`, 0011), avec sa révision ; un objet changé ailleurs
    revient à la v10 comme un conflit (`{ conflict, disk }`) qu'elle fusionne et dit, la version du
    serveur gagnant ; jamais un nombre à virgule (`{ "~n": "450.5" }`). Une facture s'émet par le
    serveur (numéro de la série FAC, net à payer vérifié au millime de l'écran, pièce scellée).
    Ce qui n'existe pas encore en ligne se refuse avec sa phrase (`pasEncore`) ; les panneaux des
    Paramètres sans objet (sauvegardes du disque, mot de passe du fichier, licence…) sont cachés
    (`panneauxAbsents`) ; « Voir un exemple » ouvre l'entreprise d'essai, jamais des pièces
    inventées dans une vraie. L'inventaire des ~240 fonctions du pont (entreprise et Cabinet) et
    leur état : `docs/pont-v10.md`.
  - **L'avoir et les règlements** (brique 29, `docs/avoirs-reglements.md`) : l'avoir s'émet par
    le serveur (série AVO, lié à sa facture, `ventes.piece.corrige`, route et geste à lui) ; les
    paiements d'une facture émise sont vérifiés et tenus par le serveur (`ventes.reglement`, 0012,
    `serveur/ventes/reglements.ts`), chaque geste tracé ; reste, statut et retenue au fil se
    déduisent par le moteur et se lisent par l'API. Une facture émise ne s'annule pas (un avoir la
    corrige) ; la caisse se refuse avec sa phrase jusqu'à l'étape 4.
  - **Les achats** (brique 30, `docs/achats.md`) : chaque achat du dossier (facture fournisseur,
    dépense, avoir, acompte), ses lignes et ses règlements sont vérifiés, calculés par le moteur et
    tenus par le serveur (`achats.*`, 0013, `serveur/v10/achats.ts`), une fois tout l'envoi écrit ;
    les fournisseurs ont leur fiche (`socle.tiers`, rôle « fournisseur ») ; l'API lit la liste et
    chaque achat (reste, statut, retenue de chaque règlement : `serveur/achats/`, un seul calcul pour
    les deux). La tenue des règlements (`serveur/reglements.ts`) et la lecture des paiements de la
    v10 (`serveur/v10/lecture.ts`) sont partagées par les ventes et les achats.
  - **La paie** (brique 31, `docs/paie.md`) : chaque bulletin du dossier est RECALCULÉ par le
    serveur (`serveur/v10/paie.ts`) avec le barème et la situation du salarié qu'il a figés (une
    adaptation de `computePayslip`) et comparé montant par montant à l'écran ; tenu dans
    `paie.bulletin` (0014), les salariés dans `paie.salarie` (ni CIN ni RIB). Données sensibles
    (03 D10) : la base ne montre la paie qu'au propriétaire, à l'administrateur, au rôle Paie
    (`paie.mes_entreprises()`) ; chaque lecture se trace avec l'objet lu (`objetLu` d'une route) ;
    la masse salariale, sans nom, par `paie.masse_salariale`. Dans un test, l'écran de la
    plateforme se charge par `ecranDeLaPlateforme` (tests/moteur/v10.ts).
  - **Les écritures** (brique 32, `docs/ecritures.md`) : le serveur TIENT les écritures des ventes
    (`compta.ecriture`/`ligne`, 0015), en brouillard, écrites avec la pièce dans la même
    transaction ; l'unité qui se réécrit est la FAMILLE d'une facture (ses avoirs, tous leurs
    règlements : `serveur/compta/ventes.ts`), par le seul chemin `compta.ecrire_famille` (un
    commercial émet sans lire les livres). Le plan : défauts de la v10 (`moteur/comptes.ts`) +
    `chartAccounts`, auxiliaires, trésorerie du dossier (`serveur/compta/plan.ts`) ; un plan changé
    réécrit le brouillard. La base refuse une écriture déséquilibrée et toute retouche d'une
    écriture validée. Les achats (brique 33, `serveur/compta/achats.ts`) : la famille d'une facture
    d'achat ou d'une dépense (ses avoirs et acomptes rattachés, tous leurs règlements ; une pièce
    libre est la sienne), réécrite avant ET après chaque envoi du dossier (`reecrireFamillesDAchat`).
    La paie (brique 34, `serveur/compta/paie.ts`) : EN TOTAUX DU MOIS, sans un nom (03 § 2.1) ; le
    mois est la famille ; salaires versés et avances en un total par jour et par compte ; seul qui
    voit la paie la réécrit. La validation (brique 35, 0018) : `compta.valider` numérote par journal
    et par année, scelle dans la chaîne des livres, ferme la période ; ensuite `ecrire_famille`
    garde une écriture validée identique, contre-passe celle qui ne tient plus, et n'écrit jamais
    dans la période close (premier jour ouvert). `compta.controler` recalcule la chaîne.
  - **Le cabinet** (brique 36, 0019, `docs/cabinet.md`) : mandat proposé par le propriétaire (code
    du cabinet, périmètre), accepté par l'associé ; dossiers tenus ; portefeuille ; le rôle d'une
    personne par son cabinet dans `socle.mes_roles` et le périmètre dans `socle.perimetre_cabinet`,
    gardés par la porte (`PERIMETRE_DU_MODULE`) ET par la base. Une fonction redéfinie par une
    migration plus récente : ses preuves visent la définition EN VIGUEUR.
  - **Les écrans du Cabinet** (brique 37) : le code du Cabinet v10 copié dans
    `web/public/v10/cabinet/`, branché par `web/public/plateforme/pont-cabinet.js` ; la fiche d'un
    dossier (0020, champs comptés, révision vérifiée dans l'écriture) ; le client confie son dossier
    par le code du cabinet (Paramètres → Envois) ; `/moi` dit `parCabinet` : l'entrée n'ouvre jamais
    l'entreprise d'un client comme la sienne. Sans paquets (C4) : ce qui en parlait est caché ou
    retiré, par la liste du point de contact ou une adaptation.
  - **La saisie du cabinet** (brique 38, 0021) : saisir, modifier (révision, `SK409` → 409),
    supprimer un brouillard ; valider une écriture ou un lot ; contre-passer, extourner une écriture
    SAISIE (miroir validé, jamais dans la période close) ; lettrer des écritures validées. Qui peut :
    `compta.peut`, dans la base ET à la porte. Une écriture née d'une pièce suit sa pièce (C6). Le
    tableau du portefeuille lit `GET /cabinets/:c/mois` (les mois des livres, en « paquets »).
  - **Le Cabinet sans paquets, dans les mots** (brique 38 bis, C14, C15) : un mois écrit, validé, à
    valider (le travail du cabinet, jamais une relance), manquant (le seul qu'on relance). Les
    adaptations de texte s'écrivent telles quelles dans `web/v10/sans-paquets.txt`. Un parcours lit
    chaque écran, un test lit chaque bulle, article et visite : aucun mot de paquet, sauf ce que la
    version en ligne ne montre jamais, nommé avec sa raison. La relance se note dans la fiche.
  - **La reprise d'un client** (brique 39, 0022, C16, C17) : l'exercice s'ouvre sur le serveur, une
    fois (`compta.ouvrir_exercice` : son année, son premier jour — le 1er janvier, ou plus tard pour
    un premier exercice —, le 31 décembre), avec sa balance d'ouverture : UNE écriture AN
    « OUVERTURE » posée ET validée d'un geste, ou rien. Les à-nouveaux ne sont l'activité d'aucun
    mois (`mois_du_portefeuille` redéfinie en 0022 ; l'alerte du livre de même) ; un brouillard écrit
    son mois. La balance se lit dans un CSV ou un classeur Excel, dans le navigateur (le ZIP s'ouvre
    par `DecompressionStream`) ; seules ses lignes partent au serveur. Adaptations :
    `web/v10/reprise.txt`.
  - **Les écritures par tableur** (brique 39 bis, C18) : les CSV du livre et le FEC se téléchargent
    (rien ne part au serveur) ; le réimport lit le fichier dans le navigateur, l'analyse de la v10 le
    compare au livre du serveur et la fenêtre dit tout avant le clic ; une pièce qui ne tombe pas juste
    se refuse ; les pièces partent en lots (`POST …/ecritures/lot`, un point de reprise par pièce) ; une
    validée changée se corrige d'un geste (`…/:id/corriger` : contre-passation + version au brouillard).
  - **La banque** (brique 40, 0023, C19 à C21) : un relevé (lu dans le navigateur, son empreinte
    d'octets, bouclé au millime, rangé dans le livre d'une année) ; un rapprochement lie une ligne du
    relevé à UNE ligne d'écriture du même compte (`compta.rapprochement`, qui tombe avec la ligne d'un
    brouillard qui change) ; l'automatique juge dans le navigateur (la v10) et pose au serveur ; les
    banques et les mots retenus : `cabinet.reglages` (champs comptés, révision).
  - **La déclaration du mois** (brique 41, 0024, C22 à C24) : le moteur de la v10 la déduit, dans le
    navigateur, du livre du serveur ; le serveur garde la déclaration préparée (`compta.declaration` :
    ses cases en millimes ou vides, une par période, pas refaite une fois déposée), les pense-bêtes
    déposée / payée, et le lien vers l'écriture du mois (au brouillard par `compta.saisir` ; un
    complément ne remplace pas le lien ; contre-passée, le lien ne vaut plus). Qui peut :
    `compta.peut_declarer` ; un geste peut porter son propre périmètre de mandat (`Geste.perimetre`,
    ici « les déclarations »). Le serveur ne recalcule pas la déclaration : l'écart avant un dépôt se
    juge dans le point de contact.
  - **La page Écritures** (brique 41 bis, C25) : les mois où les clients ont des écritures (plus de
    fichier reçu : `web/v10/ecritures.txt`) ; l'export lit les livres au serveur, colonnes du
    livre-journal + état, regroupées par `mergeEcritures` de la v10, téléchargées.
  - **La liasse et l'annuel** (brique 41 ter, 0025, C26, C27) : calculés par la v10 sur le livre du
    serveur ; `compta.annuel` garde par année les retraitements (millimes) et le taux d'impôt (entier
    à six décimales), avec une révision ; le modèle de rubriques dans `cabinet.reglages` (`liasse`) ;
    au cabinet, l'associé seul (`compta.peut_liasse`).
  - **Les immobilisations** (brique 42, 0026, C28, C29) : `compta.immobilisation`, une fiche par bien
    pour toute la vie de l'entreprise (montants en millimes, durée en centièmes d'année, révision) ;
    `compta.immobilisation_ecriture` lie (bien, année, dotation ou sortie) à son écriture ; écrite, le
    plan ne change plus et la fiche ne se supprime pas ; le plan se calcule par la v10.
  - **L'inventaire de stock** (brique 42 bis, 0027, C30) : `compta.inventaire` par année (quantités en
    millièmes, coûts en millimes, total calculé au serveur) ; la variation au brouillard, liée.
  - **La paie tenue par le cabinet** (brique 43, C31) : les salariés et bulletins s'écrivent dans le
    dossier du client (`employees`, `payslips`) par `GET/POST /entreprises/:e/paie/dossier` (ces deux
    collections seulement, gestes `paie.dossier.*`, périmètre « paie ») ; recalculés au serveur ;
    l'écriture de paie du mois suit d'elle-même.
  - **La révision et les questions au client** (brique 44, 0028, C32, C33) : `cabinet.revision`, le
    dossier de travail du cabinet par (dossier, période), gardé entier avec sa révision
    (`GET/PUT /cabinets/:c/revisions/:dossier`) ; `compta.question`, dans les livres du client : posée
    (qui saisit), invisible au client jusqu'à son envoi (qui valide ; chaque envoi se compte),
    retirée si jamais envoyée, fermée sinon, répondue par l'entreprise (`compta.questions.*`) ; le
    questionnaire et les cycles, réglages du cabinet.
  - **Les questions chez le client** (brique 44 bis, C34) : `pont.js` lit les questions envoyées et
    non fermées dans `data.questionsCabinet` (jamais écrites dans le dossier v10) et envoie chaque
    réponse nouvelle au serveur ; l'onglet Cabinet de la Comptabilité porte les questions et le mandat.
  - **La clôture de l'exercice** (brique 45, 0029, C35) : `compta.cloturer_exercice` valide la période
    jusqu'au 31 décembre (exercice fini, aucun brouillard) et le marque clos ; `compta.rouvrir_exercice`
    (motif) remet la période close où elle était avant (`jusqua_avant`), jamais si des jours d'après
    sont validés ; `compta.reouverture` les garde. Geste `compta.exercice.cloturer` (au cabinet,
    l'associé). Les à-nouveaux : le geste de la v10 joué sur l'année d'après, écrit en brouillard.
    Le livre du point de contact porte un geste par enregistrement (`livre.audit`) : les onglets s'y relisent.
  - **L'équipe du cabinet** (brique 46, 0030, C36) : `socle.invitation` vaut aussi pour un cabinet
    (`organisation`) ; `socle.inviter_au_cabinet`, `annuler_invitation_cabinet`, `changer_role_cabinet`,
    `retirer_du_cabinet` (un associé ; jamais sur soi-même) ; `GET /cabinets/:c/equipe`. L'entrée React
    accepte `/?invitation=<jeton>` après la connexion. Les collaborateurs de la v10 sont les membres
    (id = utilisateur) ; « Saisie et validation » = `revision` ; les droits d'un dossier = les affectations.
    Une lecture d'onglet retient le livre qu'elle a lu (`relectures.txt`) : jamais deux relectures par geste.
  - **La fiche du cabinet** (brique 47, 0031, C37) : `socle.renommer_cabinet` (un associé) et
    `PUT /cabinets/:c/nom` ; l'adresse, le téléphone et les réglages de la v10 dans `cabinet.reglages`
    (liste `REGLAGES_V10` du point de contact, forme fixée par `REGLAGES`). `saveCabinet` fusionne comme
    la v10 (`cab:saveCabinet`), normalise par `migrate`, écrit les réglages puis le nom.
  - **La production** (brique 48, C38) : `GET /cabinets/:c/production?depuis=` (mois hors AN, validées,
    brouillards, dernier geste ; déclarations ; révisions d'un mois ; exercices). Le point de contact en
    refait l'index d'un livre v10 (`indexDesLivres`) pour `production` ET `questionsEnAttente` (les
    dossiers tenus et les mois déclarés des Échéances). Le tableau se relit à chaque entrée sur la page.
  - **Le fichier CNSS** (brique 49, C39) : `fichierCnss` du point de contact = `fichierCnssDuLivre` sur
    `livreEtPaie` + la fiche du dossier (`cnssEmployeur`, `cnssCode`), puis `telecharger` ; rien au serveur.
  - **Les guides d'écritures** (brique 50, C40) : `guides` dans `cabinet.reglages` (montant et taux en
    texte décimal) ; `dernierJournal` dans la fiche ; `poserFiche` tient la fiche lue à jour. La
    correspondance des comptes reste sans objet (C4).
  - **Les abonnements** (brique 51, C41) : `abonnements` dans la fiche (montant en texte décimal) ;
    `genererAbonnements` sérialisé (`generation`), pièces au brouillard par la saisie du serveur, mois
    faits notés même en cas de refus, pièce déjà au livre (numéro + date) jamais réécrite.
  - **Une liste de clients collée** (brique 52, C42) : `importDossiers` = `parseDossierLines`, tous les
    matricules contrôlés avant d'écrire (forme du serveur), puis `newDossier` ligne par ligne.
  - **La CNSS des seuls employeurs** (brique 54, C44) : `employeurs` dans la production (un mois dont une
    écriture hors AN touche 640… ou 4531…, contre-passations exclues) ; l'index du point de contact le
    range en `employeur`, que `questionsEnAttente` rend à la carte CNSS des Échéances.
  - **Les taux de paie par contrat** (brique 55, C45) : `paie.regimesContrat` dans la fiche (taux en texte
    décimal, quatre décimales au plus, jamais le CDI) ; `savePaie` normalise par `normaliserRegimes` ; la
    paie et `saveBulletin` du point de contact calculent avec eux (`paieDuDossier`).
  - **Retirer un dossier** (brique 56, 0032, C46) : `deleteDossier` = arrêter le mandat ; `arreter_mandat`
    refuse un dossier tenu qui a une écriture (le refus dit d'archiver). Rien ne s'efface.
  - **Le nom et le matricule d'un dossier tenu** (brique 57, 0033, C47) : `socle.renommer_dossier_tenu` et
    `PUT /cabinets/:c/dossiers/:d` (un associé ; jamais un client sur SkanFact) ; `saveDossier` les envoie
    avant la fiche ; un matricule déjà pris se refuse en le disant (`exiger_matricule_libre`).
  - **Un geste réservé au cabinet sous mandat** (brique 58, C48) : `auCabinet` sur un geste (la validation :
    `comptabilite`) ; la porte refuse alors à l'entreprise en nommant le cabinet, sans liste ni bouton.
  - **La liasse d'un exercice clos** (brique 59, 0034, C49) : `poser_annuel` refuse une année close ;
    l'onglet Liasse le dit avant le geste (`liasse-close.txt`, drapeau `clos` de la liasse, lu au serveur).
  - **Le dossier v10 vu du cabinet** (brique 60, 0035, C50) : la sécurité par ligne n'ouvre au cabinet
    que le plan (`accounts`, `clients`, `suppliers`, `_racine` chartAccounts/auxiliaires) et, sous un
    mandat de paie, la paie. Une nouvelle lecture du dossier v10 pour le cabinet passe par cette liste.
  - **Ce qui a changé dans l'équipe** (brique 61, 0036, C51) : `socle.trace_de_l_equipe` (un associé) et
    `GET /cabinets/:c/equipe/trace` ; les phrases sont écrites par le point de contact (`phraseDeLEquipe`).
  - **La reprise du Cabinet v10, l'essai à blanc** (brique 62, C52) : `serveur/reprise/livre-v10.ts` lit un
    `livre-AAAA.json` (montants au millime exact, anomalies nommées) ; `POST /cabinets/:c/reprise/livre/essai`
    (un associé, 32 Mo : `limiteCorps` d'une route) rend le rapport sans rien créer. Règle de numérotation
    de la reprise (C52) : le numéro de la v10 gardé, `<journal>-<année>-<numéro sur six chiffres>`.
  - **La reprise d'un livre dans un dossier tenu** (brique 63, 0037, C53) : `POST /cabinets/:c/reprise/livre`
    → `compta.reprendre_livre_v10` (dossier tenu, exercice vide, numéros v10, chaîne dans leur ordre,
    compteurs, période validée jusqu'à la veille du premier brouillard, empreinte du fichier dans la
    trace) ; la balance relue dans la base doit être celle du livre, sinon tout se défait.
  - **L'écran de reprise** (brique 64, C54) : « Reprendre son livre de SkanFact Cabinet v10… » sur un dossier
    tenu sans livre (`reprise-v10.txt`) ; `essaiRepriseV10` (fichier choisi, rapport) puis `repriseV10`.
  - **Le téléphone** : la même page, une mise en page de plus (`web/public/plateforme/telephone.css`
    et `telephone.js`, sous 760 points) ; sur un ordinateur, c'est la v10 au pixel près. Depuis la brique 105
    les deux pages de la v10 disent leur largeur (`<meta name="viewport">`, `web/v10/telephone.txt`) : sans elle,
    un vrai téléphone les affichait comme un ordinateur réduit, et l'instrument de rendu (qui ne simulait
    qu'une fenêtre étroite) ne le voyait pas. Il simule maintenant un vrai téléphone (`isMobile`), et repère
    un texte écrasé (plus de 60 lettres dans moins de 140 points). Depuis la brique 106 il passe 16 pages du
    quotidien, sur une entreprise qui a des données (une facture émise, un devis, un achat, un salarié) :
    sur des pages vides, il ne mesurait aucun tableau.
  - **Le parcours du jalon J2** (brique 107, `tests/web/jalon-j2.test.ts`) : une entreprise, d'un bout à l'autre, à la
    souris, contre TTN, DigiGo et Konnect simulés : fiche et comptes, devis facturé, facture signée, acceptée par la
    TTN, payée en ligne par le client (au téléphone) ; achat lu en photo, réglé depuis la banque ; TVA du mois de
    l'écran égale aux livres du serveur ; une coupure du réseau ; la facture relue au téléphone. C'est la répétition
    générale : le jalon lui-même attend les accès de test réels (El Fatoora, DigiGo).
  - **L'entrée** (se connecter, créer son compte, le code du téléphone, la porte de la première
    fois) : les seuls écrans écrits pour la plateforme, en React (`web/src`), à l'habillage de la
    v10 ; leurs phrases viennent du catalogue. Le jeton de session vit dans l'onglet
    (sessionStorage) : décidé par délégation ; **À VÉRIFIER** le passage à un cookie que le
    JavaScript ne lit pas.
  - Un écran se prouve par l'instrument de rendu (`tests/web/rendu.test.ts` : l'entrée en français
    et en langue factice, les pages du quotidien de la v10 au téléphone et à l'ordinateur) ET par
    les parcours à la souris (`tests/web/parcours.test.ts`), et ses photos (`dist/photos`) se
    regardent.
- L'entreprise d'essai des développeurs (`0009`, 28/09/2026, par délégation) : une par personne,
  trois clients d'exemple, essai pour toujours ; depuis `0011`, ses factures suivent la série
  « FAC » de la v10 (l'écran de la v10 annonce ce préfixe). À respecter plus tard : jamais facturée
  par l'abonnement, jamais transmise à la TTN, « ESSAI » sur chaque document.
- **Ouvert** : les gestes « À reprendre » encore ouverts sont comptés dans l'export mais pas
  restaurés (à revoir avec la file, étape 2) ; la remise en place d'une entreprise **par-dessus**
  son état abîmé (06 § 4.4) n'existe pas encore : on ne restaure que là où elle n'est pas.

## Les règles de ce dépôt

**La base**
- **Toute table de données porte son entreprise** et a sa sécurité par ligne **activée et forcée**.
  Un test parcourt le catalogue et tombe si une table l'oublie.
- Le serveur ne touche la base **que par `enTantQue`** (`serveur/base.ts`) : une transaction, le nom
  de la personne posé pour cette transaction seulement. Jamais de connexion administrateur dans le
  serveur.
- Dans cette transaction, les requêtes d'un module s'écrivent avec **Kysely** : `requetes(tx)`
  (elles refusent de servir après la fin de leur transaction). Les appels aux fonctions du socle et
  les états lourds restent en SQL écrit à la main (`sql` de Kysely ou `tx.query`), toujours avec
  des paramètres, jamais du texte collé. La trace d'un geste : `tracer()` (`serveur/trace.ts`).
- **Après chaque migration** : `npm run types:base` réécrit `base/types.ts` (un test le vérifie).
- **Une table nouvelle se range** dans `CLASSEMENT` (`base/entreprise.ts`) : part avec
  l'entreprise, désignée par elle (sans secret), commune, ou jamais (avec sa raison). Sinon l'export
  refuse et un test tombe. Un lien sans clé étrangère que l'export doit suivre se déclare dans
  `LIENS_SANS_CONTRAINTE`.
  Un type de colonne nouveau se déclare d'abord dans `base/generer-types.ts`.
- Un entier de 64 bits se lit en `bigint` (jamais en texte à convertir, jamais en nombre à
  virgule) et sort de l'API en texte.
- Une fonction `security definer` est une porte dérobée : elle ne rend que ce qui concerne
  `socle.moi()`, fixe son `search_path`, et son droit d'exécution est retiré à `public`.
- Les fonctions `security definer` appartiennent au rôle qui applique les migrations : il doit
  passer au-dessus de la sécurité par ligne (super-utilisateur ou `bypassrls`), sinon elles ne voient
  rien. Un test le vérifie, avec le chemin fixé et le droit retiré au public.
- **Aucun taux dans le code ni dans les migrations** : les règles communes se chargent avec leur
  source (texte de loi), jamais inventées ; les tests utilisent des codes `essai.*`.
- **Une migration appliquée ne se modifie jamais** : on en écrit une nouvelle (`base/migrer.ts` le
  refuse). Deux temps pour retirer quelque chose (ajouter, puis retirer plus tard).
- Une migration qui **redéfinit** une fonction (`create or replace`) rend l'ancienne définition
  morte : les preuves qui la visaient se réorientent vers la nouvelle (sinon elles restent vertes,
  et `preuves.sh` les dit « non prouvées », comme le 28/09/2026 avec `mes_entreprises`).
  **De même pour une contrainte** (`drop constraint` / `add constraint`) : le 30/09/2026, 0037 a
  redéfini la liste des origines d'une écriture, trois preuves visaient encore 0021 et GitHub est
  resté rouge quatre envois de suite sans qu'on le voie. Depuis, le **contrôle éclair**
  (`npm run preuves:eclair`, une seconde) nomme toute preuve qui vise une fonction, une règle, un
  déclencheur, un index ou une contrainte qu'une migration plus récente remplace : la réorienter
  vers la définition en vigueur.
- L'argent en **entiers** (`bigint`, millimes ou centimes), les taux et prix unitaires en entiers à
  six décimales (01 R3). Une date de pièce est un `date`, un geste est un `timestamptz` (01 R5).

**Les textes (14 § 5)**
- **Aucune phrase écrite en dur** dans le serveur : chaque texte qu'une personne peut lire est une clé
  du catalogue (`t(cle, valeurs)` pour un morceau, `motif(cle, valeurs)` pour une phrase entière ;
  `new Refus(cle, { valeurs, bouton })`). Le socle déclare ses textes dans `textes/socle.ts`, un
  module dans son propre `textes.ts` (chargé avec le module). Un test fait tomber la construction.
- Un texte se rend au dernier moment, dans la langue de celui qui lit (`rendreTout` dans
  `serveur/app.ts`). Ce qui est gardé en base pour être relu plus tard (le motif d'un geste « À
  reprendre ») s'y écrit en français.
- Une phrase écrite par la **base** (`socle.refus`, une règle de table) s'ajoute mot pour mot à
  `textes/base.ts`, avec la clé qui la dit : un test compare les migrations et cette liste.
- Chaque geste a son texte `geste.<code>` et chaque rôle `role.<code>` : un geste sans texte ne se
  déclare pas. Une vérification des données reçues donne une clé comme message (`'champ.jour'`,
  `cleDeVerification(cle, valeurs)`), jamais une phrase : le message anglais de la bibliothèque ne
  paraît jamais.
- La **langue factice** (`x-langue: factice`) : 40 % plus longue, accentuée ; elle servira à
  photographier les écrans (ce qui déborde, ce qui a échappé au catalogue).

**Le serveur**
- Une **clé de l'API** agit comme une personne : sa transaction est ouverte à SON nom
  (`enTantQueCle`, `app.cle_api`), jamais à celui de son créateur ; ses pièces portent le nom du
  créateur, sa trace le nom de la clé. Un geste qui gouverne l'entreprise porte `horsCle: true`
  (jamais donné à une clé). Toute adresse commence par `VERSION` (`/v1`).
- Une phrase qui place une valeur après « de » l'écrit `{de:nom}` : le catalogue élide
  (« d'émettre », « de voir »).
- **Chaque route déclare son geste** (`serveur/porte/gestes.ts`, recopié du tableau 03 § 2.1) ;
  sinon le serveur ne démarre pas. Un geste d'entreprise porte `:entreprise` dans son chemin.
- Une écriture sensible (rôles, équipe, propriété) passe par une **fonction de la base** qui applique
  la règle et **trace** ; le serveur n'a pas le droit d'écrire ces tables en direct.
- Une pièce légale : les contrôles, PUIS `prendreNumero` et `sceller` dans **la même transaction**
  que l'émission. Le contenu scellé passe par `canonique()` (clés triées, entiers seulement) ;
  `empreinte = sha256(précédente || contenu)`, la première précédente valant 64 « 0 ».
- Un module qui reçoit des gestes des postes déclare un `traitement()` (geste, formats lus, charge,
  `fait` si l'argent a bougé) ; le geste doit exister dans la porte, sinon le serveur ne démarre
  pas. Un objet changé depuis la lecture du poste : `throw new MiseDeCote(...)`, jamais écraser.
- Toute liste se **pagine** (curseur `instant|id` pour la trace, jamais une date seule).
- Un refus du métier se lève avec `serveur/erreurs.ts` : `Refus(message, bouton)` (ce qui est
  refusé, pourquoi, le geste qui débloque), `Introuvable` (404, sans dire si l'objet existe
  ailleurs), `Perimee` (409 : l'objet a changé depuis sa lecture, on ne l'écrase pas).
- L'argent entre et sort de l'API **en texte décimal** (« 1250.500 »), jamais en nombre à virgule ;
  un nombre saisi avec plus de décimales que sa précision est refusé, pas arrondi en silence.
- Une pièce émise se **relit** telle qu'elle a été émise (montants et copie stockés), jamais
  recalculée ; seul un brouillon se calcule à la lecture.

**Le moteur (`moteur/`)**
- Porté de `core.js` / `compta.js` fonction par fonction, **tests d'abord** ; chaque test garde la
  version de la v10 où sa règle est née (« 10.14.1 : … »).
- Tout en `bigint` : montants dans la plus petite unité de la devise, prix unitaires, taux et cours à
  six décimales, quantités en millièmes. L'ordre des arrondis est celui de la v10.
- Une écriture s'équilibre **exactement** : elle n'avale jamais un écart (un déséquilibre est un
  défaut, et il s'arrête). Les comptes lui sont donnés (le plan de l'entreprise) ; ses lignes disent
  leur nature (client, ventes, TVA, timbre, change, trésorerie, retenue), les libellés viendront du
  catalogue.
- Un écart de change se range selon son **sens** (un gain au crédit du 755, une perte au débit du
  655), comme la v10, jamais en contre-passant le compte de la pièce corrigée : la perte de conversion
  d'une facture devient un gain sur l'avoir identique.
- Une écriture d'achat en devise met son écart de **conversion** au change, comme les ventes
  (10.14.1) : la v10 l'avale encore sur la plus grosse ligne (écart tranché le 28/09/2026, vérifié
  ligne à ligne par le banc des écritures d'achat).
- Un montant **en devise** s'arrondit à l'unité de sa devise (le centime), jamais au millième :
  la v10 tient encore la part de retenue d'un règlement en euros au millième d'euro (écart tranché
  le 28/09/2026, au plus un centime par règlement, vérifié par le banc des règlements).
- Le **banc** (`tests/moteur/banc-v10.test.ts`, `ecritures-v10.test.ts`, `reglements-v10.test.ts`,
  `avoirs-v10.test.ts`, `achats-v10.test.ts`, `achats-ecritures-v10.test.ts`,
  `reglements-achats-v10.test.ts`, `paie-v10.test.ts` ;
  outils communs dans
  `tests/moteur/v10.ts`) compare chaque fonction portée à la v10 figée dans
  `banc/v10/` (jamais modifiée ; remplacée quand la v10 reçoit une correction de calcul) : l'exemple
  de cinq ans et 20 000 pièces tirées au hasard. Un écart ne se tolère pas : il se **tranche** (en
  fractions exactes), s'écrit dans la liste du banc avec sa raison, et sa situation devient un test.

**Les tests**
- Contre un **vrai PostgreSQL** (`PG_ADMIN`), jamais contre une imitation.
- **Chaque test se prouve** : `tests/preuves.sh` remet le défaut et vérifie que le test tombe. Un test
  nouveau vient avec sa ligne dans ce script, **avant le bilan** (ses deux dernières lignes : une
  preuve écrite après lui ne fait pas échouer le lot — c'est arrivé aux briques 66 à 70, trouvé le
  30/09/2026 ; le contrôle éclair le refuse). On ne retire jamais une preuve pour aller plus vite.
- **Vérifier ciblé, GitHub vérifie tout** (décision de Skander, 30/09/2026 : avancer et livrer plus
  par jour). Pendant le travail et avant un envoi : `npm run verifier:brique` (une minute ou deux) —
  types, lint (0 erreur, 0 avertissement), contrôle éclair des preuves, les tests des fichiers de
  test changés depuis `origin/main` (et ceux qu'on ajoute : `-- tests/x.test.ts`), puis les preuves
  **nouvelles ou changées** (`npm run preuves:nouvelles`). Lire le **code de sortie**. Tous les
  tests et toutes les preuves tournent sur GitHub à chaque envoi (preuves en quatre groupes sur quatre
  machines, `PARTIE=k/4`). **Avant chaque envoi, lire le verdict du précédent** (`npm run verdict`,
  qui nomme le test ou la preuve qui tombe) : une construction rouge se répare d'abord, jamais on ne
  la contourne ni n'empile par-dessus. Une brique qui touche au socle de tout (le serveur, la
  connexion, la sécurité par ligne) ajoute les fichiers de test concernés à `verifier:brique`.

**Sécurité (sans exception)**
- Dépôt **public** : jamais de secret, de jeton, de mot de passe réel ni de donnée de client. Les
  mots de passe de test sont tirés au hasard à chaque lancement.
- Jamais le nom ni le matricule de la société de Skander dans le code, les exemples ou les textes
  (règle détaillée dans le `CLAUDE.md` de l'application).
- Jamais une donnée de plus dans ce qui part vers un serveur tiers sans que la liste soit comptée et
  décidée.

**Git**
- Branche **`main`** pour l'instant (dépôt neuf, pas encore de publication). Pas de PR sans demande.
- Messages de commit en français, terminés par les lignes `Co-Authored-By` et `Claude-Session`
  fournies par la session. Aucun identifiant de modèle dans ce qui est envoyé.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run verifier` | Types, lint, tests (il faut `PG_ADMIN`) |
| `npm run preuves` | Chaque défaut remis dans une copie, chaque test doit tomber (`SEULES`, `FICHIERS`, `PARTIE=k/n`) |
| `npm run preuves:paralleles` | Les mêmes, en `GROUPES` groupes côte à côte (4 par défaut) |
| `npm run verifier:brique` | La vérification ciblée d'une brique (types, lint, contrôle éclair, tests changés, preuves nouvelles) |
| `npm run preuves:nouvelles` | Les seules preuves nouvelles ou changées depuis `origin/main` (`BASE`, `GROUPES`, `NOMS`) |
| `npm run preuves:eclair` | Le contrôle éclair des preuves, sans rien lancer (`DETAIL=1` pour le détail) |
| `npm run verdict` | Le verdict de GitHub sur le dernier envoi (ou `-- <commit>`) : 0 vert, 1 rouge, 3 pas fini |
| `npm run migrer` | Applique les migrations sur la base de `PG_ADMIN` |
| `npm run entreprise -- exporter <id> <fichier>` / `restaurer <fichier>` | Exporte une entreprise, ou la restaure là où elle n'est pas (`PG_ADMIN`) |
| `npm run types:base` | Réécrit `base/types.ts` à partir des migrations (base jetable sur `PG_ADMIN`) |
| `npm run reprendre-v10 -- <dépôt skanfact>` | Recopie l'interface v10 (`src/renderer`, branche `beta`) dans `web/public/v10` et y applique `web/v10/adaptations.mjs` |

Les tests demandent aussi xmllint, Tesseract (avec le français) et Poppler (la facture électronique, la
lecture des factures d'achat, brique 84) : `apt-get install -y libxml2-utils tesseract-ocr tesseract-ocr-fra
poppler-utils` s'ils manquent (GitHub les installe à chaque envoi). `npm run banc:lecture -- <lot>` mesure la
lecture sur un lot de vraies factures, gardé HORS du dépôt (`docs/achats.md`, brique 84).

Dans une session Claude : PostgreSQL 16 tourne sur `127.0.0.1:5433`
(`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgproto/data -o '-p 5433' start"`
s'il est arrêté), donc `PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres`.
