# La carte de la plateforme : ce qui est fait, brique par brique

*Sortie de `CLAUDE.md` le 13/10/2026 : ce fichier-là est relu à chaque échange de chaque session, et ce catalogue
(57 Ko) faisait compacter la conversation toutes les dix minutes. Chaque domaine dit ici ce qui est fait, où il vit
(fichiers, migrations, documents) et la règle qu'il a apprise. **Avant de toucher un domaine, lire sa ligne ici, puis
son `docs/<domaine>.md`.** Une brique livrée ajoute ou complète SA ligne ; dans `CLAUDE.md` n'entre qu'une règle qui
vaut pour tout le dépôt.*

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
  La commande fournisseur (brique 114, `0055`) : `commandeAccordAuDela` (HT, devise de l'entreprise) ; geste `commande`
  (`client_v10` = le fournisseur, `plafond` = le seuil) ; `controlerCommandes` dans `appliquer` refuse « envoyée »
  au-delà sans accord (une commande déjà partie qui ne grossit pas passe) ; `montantCommandeFournisseur` de `core.js`.
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
  sur une base à part (d'autres tests cassent des chaînes exprès dans la base commune). **Sur les serveurs** (lot « prêt
  pour les pilotes », 12/10/2026, `docs/mise-en-ligne.md` C bis et I) : l'archivage à la minute, la copie de base de la
  nuit, l'exercice de restauration du mois, la copie hors de la machine chiffrée par age (la clé qui relit ne vit
  jamais sur le serveur ; le stockage objet chez l'hébergeur de secours est À DÉCIDER par Skander), la remise d'UNE
  entreprise à une minute (`exploitation/remettre-entreprise.sh` : un essai d'abord, toujours) ; la veille de chaque
  minute (`exploitation/veiller.ts`) prévient l'exploitant par e-mail et SMS et tient la page d'état publique `/etat`.
- Le programme serveur (`serveur/principal.ts`, `npm run serveur`) : configuration par
  l'environnement, refus de démarrer si elle est fausse ; en production, exige le relais d'e-mails
  (`SKANFACT_SMTP` : le code de connexion part par e-mail par défaut) ; le SMS (`SKANFACT_SMS=winsms`,
  `exploitation/sms.sh`) est facultatif (Skander, 12/10/2026 ; 0081) ; les messages à l'exploitant
  (`ConfigurationFausse`, `console.*`) sont hors du catalogue.
- **L'application web EST le code de la v10** (Skander, 28/09/2026 : « récupérer le même code et
  l'adapter », `VISION-ARCHITECTURE.md` § 4.8). Les fichiers de
  `src/renderer` (branche `beta`, figés depuis le 13/10/2026 dans `web/v10/source`) sont copiés TELS QUELS dans
  `web/public/v10` par `npm run reprendre-v10` ; seules les retouches écrites dans
  `web/v10/adaptations.mjs` (chacune avec sa raison) y sont appliquées, et
  `tests/v10/provenance.test.ts` refuse toute retouche à la main. La copie s'est faite une fois ;
  la plateforme est désormais la seule maison des écrans (une correction urgente de la v10 en
  entretien se reporte à la main, par une nouvelle reprise ou une adaptation). Aucun lien vivant
  avec le dépôt `skanfact`. **À la construction**, nos scripts et nos styles (`v10`, `plateforme`, `espace`) perdent leurs
  commentaires et rien d'autre, chaque ligne à sa place (`web/alleger.ts`, 05/10/2026, `docs/leger.md` L6 : la
  première ouverture dépassait son seuil) ; un test relit l'arbre de syntaxe de chaque écran construit contre le
  dépôt. Une erreur signalée depuis un poste pointe donc la ligne du dépôt.
  - **Le pont** (`web/public/plateforme/pont.js`) remplace ce que la v10 demandait à l'ordinateur
    (`window.skanfact`) : le dossier vient du serveur et y repart objet par objet
    (`serveur/v10/`, table `socle.dossier_v10`, 0011), avec sa révision ; un objet changé ailleurs
    revient à la v10 comme un conflit (`{ conflict, disk }`) qu'elle fusionne et dit, la version du
    serveur gagnant ; jamais un nombre à virgule (`{ "~n": "450.5" }`). Une facture s'émet par le
    serveur (numéro de la série FAC, net à payer vérifié au millime de l'écran, pièce scellée).
    La raison sociale et le matricule de la fiche société deviennent ceux de l'entreprise (`serveur/v10/identite.ts`,
    `0071`, lot facture du 05/10/2026, `docs/facture-details.md` D6 ; jamais l'entreprise d'essai ni un dossier tenu).
    Ce qui n'existe pas encore en ligne se refuse avec sa phrase (`pasEncore`) ; les panneaux des
    Paramètres sans objet (sauvegardes du disque, mot de passe du fichier, licence…) sont cachés
    (`panneauxAbsents`), et les visites de « Guide-moi » sans objet en ligne aussi (`visitesAbsentes`) ; « Voir un
    exemple » ouvre l'entreprise d'essai, que le serveur remplit une fois de l'exemple de cinq ans de la v10 (ses
    factures émises par lui ; `docs/exemple.md`), jamais des pièces inventées dans une vraie. L'inventaire des ~240 fonctions du pont (entreprise et Cabinet) et
    leur état : `docs/pont-v10.md`.
    Deux postes sur le même dossier (brique 112, `docs/pont-v10.md` § 4 bis) : chaque objet part avec la
    révision que la PAGE a eue (`base`), pas avec la dernière lecture du serveur : un objet qu'elle n'a jamais
    eu ne se supprime pas, un objet changé ailleurs fait un conflit au lieu d'être écrasé (vu en CI : le compte
    Konnect créé par le serveur supprimé par la page ; `tests/web/enregistrement-concurrent.test.ts`).
    **L'ordre du dossier reçu** (01/10/2026, § 4 ter) : la vraie cause des rouges vus seulement en CI était la langue
    de la base (« en_US » range « _racine » après « accounts ») : une liste vide restée à la racine recouvrait ses
    objets. Le serveur rend la racine d'abord (rangée en « C »), `assembler` pose la racine d'abord, et la base des
    tests range comme « en_US » (ICU `en-US-u-ka-shifted`, `tests/preparer-base.ts`). Jamais d'ordre de base supposé.
  - **La caisse** (brique 115, `docs/caisse.md`, commencée le 01/10/2026 sur décision de Skander) : « Encaisser »
    passe par `POST …/dossier-v10/ticket` (geste `caisse.ticket.encaisser` : P, A, caissier) ; le serveur numérote dans
    la série TIC (`0056`), scelle comme une facture (`emettreDepuisV10(…, { ticket: true })`) et tient le paiement dans
    le même geste ; un passant est « Vente au comptoir ». Le cahier des charges NACEF reste **À VÉRIFIER** (pas encore
    lu). La session (brique 116, `0057`, `serveur/caisse/routes.ts`) : ouverte avec le fond sur UN appareil, qui seul
    encaisse ; fermée en comptant le tiroir (sans voir l'attendu), le serveur fige le Z (attendu = fond + espèces de
    la session, écart) ; un Z ne change plus en base. **Sans réseau** (brique 120, `0060`, `serveur/caisse/chaine.ts`) :
    le poste qui tient la caisse numérote (forme de la série apprise du serveur) et chaîne
    (`sha256(précédente || sha256(ticket))`, la même formule dans `pont.js`), garde ses tickets chiffrés, les remet dans
    l'ordre avant le dossier ; le serveur compare et ne corrige jamais : `caisse.alerte` (numero, chaine, empreinte,
    apres_fermeture), vue du propriétaire ; 7 jours au plus sans le serveur. **La caisse tactile** (05/10/2026,
    maquette validée par Skander ; `web/v10/caisse-tactile.txt`, `plateforme/caisse.css`, `plateforme/ecran-client.*`) :
    tout l'écran (`body.mode-caisse`, posé par `render`) ; fermée, elle s'ouvre d'abord (`drawFermee`) ; vendre,
    encaisser, la monnaie et le comptage sont des écrans (`caisseState.ecran`), le panier et les ventes en attente
    vivent en mémoire ; le comptage part avec le total (`comptage` : [{valeur, nombre}], qui doit y tomber au millime,
    sinon `caisse.comptage_faux`) et le Z le garde ; l'écran du client écoute `BroadcastChannel('skanfact-ecran-client:<e>')`
    et ne lit rien au serveur. En dessous de 920 px, une coupure touchée demande son nombre dans une fenêtre.
  - **Supprimer un brouillon : les siens** (brique 117, `0058`, `docs/droits-dossier.md`) : chaque objet du dossier
    retient son auteur (`cree_par`) ; une pièce, une commande fournisseur ou une réception ne se supprime que par son
    auteur, P ou A (sans auteur connu : P ou A) ; le serveur, la base et l'écran (avant la question, par `autrui`) le
    disent avec la même phrase.
  - **Léger sur une connexion lente** (brique 118, `docs/leger.md`, demandé par Skander) : seuils écrits avant la
    mesure (1 Mbit/s, 300 ms : première ouverture ≤ 1 300 Ko et < 15 s, suivante ≤ 30 Ko et < 2 s), mesurés par
    `tests/web/leger.test.ts` derrière un fil bridé (`tests/lien-lent.ts`). Compression (brotli/gzip, au-delà de 1 Ko),
    empreinte de chaque fichier dans la page (`?v=`, gardé un an ; `serveur/ecrans.ts`), scripts annoncés en tête ;
    **`/v10/…` n'est pas l'API** (`deLApi` dans `serveur/app.ts`). **Ce que la page attend avant son premier dessin
    sans dépendre du dossier part avec lui** (13/10/2026, `plateforme/pont.js` : questions du cabinet, remises,
    abonnement ; trois allers-retours l'un après l'autre avaient fait passer S2 à 2,23 s sur GitHub) : une demande
    nouvelle à l'ouverture se pose dans cette attente commune, jamais après une réponse dont elle ne dépend pas
    (`tests/v10/pont-ouverture.test.ts`). S4 (brique 119, `0059`) : le dossier se relit par
    différence sur « mon ordinateur » (`?depuis=<xmin>&profil=<base/rôles>` ; `xid` par objet, traces de retrait) ;
    jamais une marque prise après la lecture (une écriture en cours serait perdue).
  - **Le tableau de bord du groupe** (brique 113, `docs/groupe.md`) : depuis le menu des entreprises, les sociétés de
    la personne côte à côte, avec les chiffres de leurs livres (70, 411, 401, classe 5) et un total par devise ; une
    société sans les livres pour son rôle est nommée sans chiffres. La consolidation vient en vague 4.
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
    sur des pages vides, il ne mesurait aucun tableau. Il mesure contre la largeur de l'écran, pas `innerWidth` :
    un vrai téléphone dézoome une page trop large, `innerWidth` grandit avec elle, et deux preuves de débordement
    ne tombaient plus (vu par la CI, brique 108). Un clic qui échoue dans un test dit ce qui était sous le doigt
    (`tests/cliquer.ts`) : la CI ne montre pas son écran. Depuis la brique 109, il mesure aussi la caisse sur une
    tablette (820 points, au doigt) : la taille du doigt suit l'écran tactile (`pointer: coarse`), pas la largeur
    (`telephone.css` a deux blocs : la mise en page sous 760 points, la taille du doigt au téléphone ET sur tout
    écran tactile). Les pages pensées pour un ordinateur (comptabilité, paie, salarié, immobilisations,
    statistiques, marges : 14 § 2.6) le disent sous leur titre au téléphone (`web/v10/petit-ecran.txt`). Le
    Cabinet aussi, depuis la brique 110 (`web/v10/cabinet-telephone.txt`) : sa page ne chargeait pas la mise en
    page du téléphone ; elle la charge, et `tests/web/cabinet-telephone.test.ts` le passe au même instrument
    (`tests/instrument-rendu.ts`, partagé). Un lien DANS une phrase est exempté de la taille du doigt (WCAG 2.5.8).
  - **Le parcours du jalon J2** (brique 107, `tests/web/jalon-j2.test.ts`) : une entreprise, d'un bout à l'autre, à la
    souris, contre TTN, DigiGo et Konnect simulés : fiche et comptes, devis facturé, facture signée, acceptée par la
    TTN, payée en ligne par le client (au téléphone) ; achat lu en photo, réglé depuis la banque ; TVA du mois de
    l'écran égale aux livres du serveur ; une coupure du réseau ; la facture relue au téléphone. C'est la répétition
    générale : le jalon lui-même attend les accès de test réels (El Fatoora, DigiGo). Il exige « Un changement
    attend le réseau » pour un seul client noté hors ligne (brique 108) : un objet que le chargement de la v10
    retouche (`migrateData`) partait du poste suivant compté comme un geste de la personne ; un tel objet naît
    maintenant complet (l'achat et sa devise : `web/v10/compte-hors-ligne.txt`).
  - **L'entrée** (se connecter, créer son compte, le code du téléphone, la porte de la première
    fois ; `docs/entree.md`) : les seuls écrans écrits pour la plateforme, en React (`web/src`), à l'habillage de la
    v10 ; leurs phrases viennent du catalogue. Le jeton de session vit dans l'onglet
    (sessionStorage) : décidé par délégation ; **À VÉRIFIER** le passage à un cookie que le
    JavaScript ne lit pas. **Le code de connexion au choix** (Skander, 12/10/2026 ; `0081`) : par e-mail par défaut,
    par SMS (WinSMS) ou par une application ; avec le relais d'e-mails, le code par e-mail suffit aussi au comptable
    d'un cabinet. **Le code du téléphone** (Skander, 09/10/2026 ; `0076`) : exigé du seul comptable d'un
    cabinet (depuis le 12/10, d'un serveur sans e-mails), recommandé à tous les autres ; il s'active en deux temps (rien ne change avant le premier code juste) dans
    **Ton compte**, premier onglet des Paramètres et des Réglages du Cabinet (`plateforme/compte.js`, partagé), qui porte
    aussi l'adresse, le mot de passe et « Tes appareils ». Un serveur qui sait envoyer des e-mails vérifie l'adresse à
    l'inscription et un appareil inconnu par un code à six chiffres (« Vérifie ton e-mail », « C'est bien toi ? »).
    **L'assistant de démarrage** (lot onboarding, 09/10/2026 ; `plateforme/assistant.js`, `web/v10/assistant.txt`) :
    l'entreprise créée par la porte s'ouvre sur « Où te joindre ? », puis le métier, la TVA et le menu, au dessin de
    l'entrée ; il écrit par `OB.applySetup` de la v10 et montre la vraie facture et le vrai menu, jamais recomposés.
    **Les premiers pas** (même lot ; `plateforme/premiers-pas.js`, `web/v10/premiers-pas.txt`) remplacent
    `C.firstSteps` sur la plateforme, sous sa forme (l'accueil, la jauge des visites et « Me guider » les lisent) : le
    compte (l'adresse à vérifier en tête quand le serveur sait envoyer le code ; « Vérifier mon adresse » dans Ton compte,
    `0077`), l'entreprise, l'activité, le RIB si l'on attend un virement, le code de connexion (recommandé : il ne
    retient pas le panneau ; fait d'emblée quand le serveur envoie des e-mails), le premier client, le premier devis ;
    facultatifs, la facture à son image et le cabinet.
    Ce qui vit sur le serveur arrive par `etatDuDemarrage`, relu à chaque retour sur l'accueil.
    **L'exemple puis la vraie entreprise** (même lot ; `ExemplePrepare.tsx`, `EntrepriseNeuve.tsx`, `docs/exemple.md`) :
    « On prépare l'exemple » (`/?exemple=<visite>`) crée et remplit l'entreprise d'essai en disant où il en est (une
    entreprise d'essai vide y repart d'elle-même) ; « Ta vraie entreprise » et « Une nouvelle entreprise »
    (`/?entreprise=exemple|menu&retour=…`) les créent, la visite demandée voyageant dans l'adresse ; le bandeau de
    l'exemple dit « Créer ma vraie entreprise » tant qu'il n'y en a pas ; « Le groupe » attend deux vraies sociétés.
  - **La messagerie entre l'entreprise et son cabinet** (lot messagerie, 09/10/2026, maquettes validées ;
    `docs/messagerie.md`, `0078`, `serveur/messagerie/`, `web/public/plateforme/messagerie.js`) : un fil par entreprise et
    par cabinet, qui appartient à l'entreprise ; « Mon comptable » dans le menu de l'entreprise (sa pastille : non lus,
    questions sans réponse, pièces demandées, chacune une fois), « Messages » dans le Cabinet (la boîte « À traiter »,
    « Attend le client », « Tout », comptés au serveur avec la même règle). Les questions de la révision y paraissent sans
    y être recopiées ; une pièce demandée se reçoit quand le client l'envoie ; une photo ou un PDF (10 Mo, reconnus à
    leurs octets) se range dans les achats. L'alerte par e-mail ne porte RIEN du message (ni nom, ni identifiant),
    part une fois cinq minutes après, à une adresse vérifiée (`postier.ts`, `SKANFACT_ALERTES_MS`). Pas de « en train
    d'écrire » : la page relit toutes les 30 secondes, page visible.
  - **Les e-mails du serveur sont habillés** (12/10/2026, maquette validée par Skander ; `serveur/courriel.ts`,
    `serveur/courriel.html`) : la version HTML dit EXACTEMENT le texte (qui part aussi), le code en grand, le lien en
    bouton qui nomme son geste (`…_bouton` au catalogue : un e-mail neuf qui porte un lien en déclare un, un test le
    lit), la marque et un pied fixes, l'expéditeur « SkanFact ». Jamais une image ni rien de chargé à distance (une
    image distante dirait qui a ouvert, et d'où), jamais une phrase dans `courriel.html` : elles vont au catalogue.
  - **L'équipe de l'entreprise** (lot équipe, 12/10/2026 ; `docs/equipe.md`, `0079`, `web/public/plateforme/equipe.js`,
    `web/v10/equipe-entreprise.txt`) : l'onglet « L'équipe » des Paramètres, pour le propriétaire et un administrateur
    seuls (03 D3). Inviter coche des rôles, aucun d'avance (D5) ; une invitation par adresse (la nouvelle remplace
    l'ancienne : « Donner un nouveau lien ») ; ni sa propre ligne ni celle du propriétaire n'ont de menu (D6, D4). Le
    lien se montre une fois et part par les moyens de qui invite (copier, WhatsApp, sa messagerie) : le serveur
    n'envoie RIEN. Qui ouvre le lien sans compte voit où il va, qui l'invite et l'adresse réservée
    (`POST /invitations/apercu`, public, `socle.apercu_invitation`) et arrive sur « Créer un compte », l'adresse remplie.
    Depuis 1.9.0, la fenêtre d'invitation dit avant le bouton ce que coûtera une personne de plus (03 § 4.1). Pas fait : le drapeau
    `prevenirProprietaire` des gestes n'a aucun lecteur.
  - **Toutes les données de l'entreprise** (même lot, 12/10/2026 ; `docs/export-complet.md`, `0080`) : « Télécharger toutes
    les données », en tête de l'onglet « Données et sécurité », pour le propriétaire et un administrateur. Le fichier est
    celui de l'outil d'exploitation au caractère près (`exporterDans`, lecteur « entreprise » ; un test compare les deux
    chemins) et se restaure ; le serveur le fabrique au nom de la personne, sous la sécurité par ligne, dans une
    transaction « instantanée » (`instantane` d'une route). Ce que ses lignes désignent ailleurs (le cabinet, ses
    collaborateurs, les appareils d'autrui, le support) vient de quatre fonctions de la base, pour les seuls identifiants
    demandés et parmi ceux qui touchent l'entreprise : **une table de référence nouvelle a sa fonction**
    (`REFERENCES_PAR_FONCTION`), sinon l'export de l'entreprise refuse. Deux brouillons du cabinet ne partent plus (une
    question non envoyée, un fichier non joint).
  - **Le lot débutant (2)** (12/10/2026 ; `docs/debutant.md`, `web/v10/debutant-2.txt`) : les gênants d'un commerçant
    qui débute, refaits à la souris sur une quincaillerie. Le mot du catalogue suit le métier (`motsCatalogue` :
    « article » pour le commerce, la restauration, l'artisanat) ; une dépense sans fournisseur se range sous UNE fiche
    « Dépenses diverses » (`divers: true`, créée à l'enregistrement, `fournisseurDivers`) ; l'avoir neuf reprend les
    lignes de sa facture tant que rien n'est tapé ; le coût du stock de départ suit le coût de revient tant qu'on n'y a
    pas touché. Visites : une étape à lire sur une case de texte y met le curseur ; un clic dans ce qu'elle éclaire (ou
    la liste qu'elle ouvre) n'ouvre pas l'essai (`dansSaCase`) ; les cases déjà remplies d'un en-tête se lisent dans UNE
    étape `liste`. **Ce qu'une étape éclaire à côté de sa cible existe en ligne** : une étape facultative sur un panneau
    absent se saute, ce qu'elle éclaire en plus ne se saute pas (vu en fusionnant les notes et les pièces jointes ; un
    test le tient). Et **ce qui change de hauteur pendant la frappe garde sa place** : « Ton entreprise » empile les
    quatre phrases du matricule, invisibles, dans la même case (`AideMatricule`).
  - **L'abonnement de l'entreprise** (lot des fonctions qui manquent, 14a, 12/10/2026 ; `docs/abonnement.md`, `0082`,
    `serveur/abonnement/`, `web/public/plateforme/abonnement.js`, `web/v10/abonnement-essai.txt`) : un essai de trente
    jours né avec l'entreprise, sept jours de grâce après l'échéance, puis la lecture seule. **On garde des faits, l'état
    se déduit du jour de Tunis** (`etatAbonnement`) : un état écrit se périmerait à minuit. **Chaque geste qui écrit a SA
    décision de lecture seule** (`POLITIQUE_LECTURE_SEULE` : fermé à la porte, ouvert, ou décidé par la route ; un test
    l'exige pour tout geste neuf) : la porte ferme ce qui crée de la valeur ou engage (émettre, ouvrir la caisse, lire
    une facture d'achat), jamais une lecture, un export ni ce que la loi demande pour l'existant. **L'écran retient la
    création AVANT le geste**, à l'ouverture de l'éditeur ou de la caisse (`licenceBlock` de la v10 nourri par l'état) :
    un refus pris à « Enregistrer » jette la saisie. Les relances (15 j, 7 j, la veille, la lecture seule ; une fois par
    échéance) ne disent pas le nom de l'entreprise. Les gestes de SkanFact (`exploitation/abonnement.sh`, et la console
    depuis Console 1, une seule règle : `serveur/abonnement/gestes.ts`) exigent un motif et laissent un événement qu'on
    ne modifie ni n'efface ; l'entreprise ne voit jamais le motif. Le paiement en ligne est venu en 14b ; ce qui
    distingue les offres en 14c (ci-dessous).
  - **La console de l'équipe SkanFact** (Console 1, 13/10/2026 ; `docs/console.md`, `0083`, `serveur/console/`,
    `web/console/`, servie sous `/console/`) : une connexion à part, réservée à l'équipe (`plateforme.equipe` : direction,
    support, technique ; le premier membre par `exploitation/equipe.sh`), le code du téléphone **à chaque connexion**,
    une session à elle (une heure sans geste, douze au plus) dont le jeton n'ouvre rien dans l'application ; à qui n'en
    est pas, la réponse d'un mot de passe faux. **La base garde chaque fonction de la console** (`exiger_role_console` :
    une session de la console ouverte, au membre actif, avec le rôle) **et le serveur aussi** (`GESTES_CONSOLE`, une
    troisième famille de gestes, sous `/console/` et nulle part ailleurs) : une preuve qui veut ouvrir retire les deux
    étages. L'accueil est **pur** (`decider.ts`) : chaque chiffre du tableau du matin ouvre la liste qu'il compte, par la
    même fonction ; rien n'est vert sans mesure (« non mesuré », avec sa raison) ; une console où rien ne se passe
    affiche une liste vide. La fiche d'un client dit la **liste fermée** (10 § 4 ; un test fixe ses clés), jamais le
    contenu d'un dossier. Chaque geste sur un abonnement montre l'état d'après, exige un motif, refuse un abonnement
    changé depuis la lecture et laisse son événement et sa ligne au journal, qu'on ne modifie ni n'efface ; le support
    prolonge un essai de 7 à 30 jours, une fois. Les textes passent par `web/console/src/langue.ts` (la typographie
    française à l'affichage) ; une fenêtre ne se ferme pas d'un clic à côté. Pas encore : paiements, nos factures,
    support, le service complet, la mesure, les réglages, l'application de bureau, `console.skanfact.tn`.
  - **Les échéances et les cabinets** (Console 2, 13/10/2026 ; `docs/console.md` C10-C11, `0084`,
    `serveur/console/echeances.ts`, `serveur/console/cabinets.ts`, purs) : six cartes d'abonnements, **chacune ouvre la
    liste qu'elle compte**, du même nombre (C3 ; un écart voulu à la maquette, où deux cartes ouvraient « À venir ») ; le
    montant d'une échéance se dit hors taxes au prix du jour, jamais pour un essai (« — » avec sa raison). **Une relance
    dit ce que le serveur fera** (partie, prévue, dans l'heure, sautée, manquée), et la règle est prouvée jour après jour
    contre `relanceDue` : écrire l'état à côté de la règle d'envoi, c'est deux règles qui divergent. Les cabinets ont
    leur onglet sous « Clients » (un en-tête commun : une phrase propre à chaque onglet faisait descendre les onglets
    sous le curseur) ; la liste et la fiche comptent les mêmes dossiers par la même règle (`placeDe`) ; la fiche d'une
    entreprise nomme son cabinet et y mène. Une adresse qui ne mène à rien le dit et mène à la liste : une 404 n'a pas de
    « Réessayer ». `maj()` met la majuscule à la première LETTRE, jamais après un chiffre (« 2 personnes »).
  - **Le service mesuré** (Console 3, première partie, 13/10/2026 ; `docs/console.md` C12, `0085`, `serveur/service/`,
    `serveur/console/service.ts`, purs) : le serveur se mesure à chaque réponse (requêtes, pannes, durée rangée dans
    un des 47 seaux dont chaque budget est une borne), par MODÈLE de route — jamais une donnée de client, la base refuse
    un chemin qui porte un nombre ; la base ADDITIONNE ce que chaque minute envoie (une base qui ne répond pas : on
    garde deux heures, on renvoie) ; la veille y confie ses relevés, ses alertes CONFIRMÉES et ses nuits. **Un centile se
    lit sur vingt lectures au moins**, sinon le pas dit « trop peu » ; **un pas mesuré seul est un point** ; la
    disponibilité ne compte que les minutes relevées ; **le trafic d'en ce moment glisse sur les minutes finies** (l'heure
    de l'horloge disait 0 à 9 h 01) ; une mise en ligne et un **retour** se disent dans l'ordre du temps ; une nuit est
    UNE ligne, et la copie d'une sauvegarde en échec est « sans objet ». **Les repères d'un axe se mesurent dans la
    page** (un sur k depuis le plus récent, huit points au moins entre deux) : éclaircir au plus pressé les rendait
    irréguliers. **Une mise en page se mesure là où la place manque** : la pastille des pannes se teste aussi à 1101
    points, la plus étroite des deux colonnes — à 1440 la place suffisait même sans la règle, et sa preuve restait
    verte. Un texte du catalogue ne nomme ses valeurs qu'en lettres (`{p95}` ne se remplit jamais : un test lit tous
    les catalogues) ; un titre qui commence par un nombre ne prend pas de majuscule (`majuscule`).
  - **Les alertes du service** (Console 3c, 13/10/2026 ; `docs/console.md` C13, `0086`, `serveur/console/alertes.ts`,
    pur) : l'alerte en cours dit ce qu'il faut faire **en étapes** (ce qu'on tape se copie d'un geste ; l'e-mail lit les
    mêmes) ; **un problème qui DEVIENT grave se redit aussitôt, SMS compris** (`diteGrave` : sans lui, il attendait le
    rappel des six heures). La console **ne touche jamais au serveur** : prendre en charge n'y change rien, la sourdine
    se pose sur une RÈGLE (quatre heures au plus sur une alerte grave, la veille la borne aussi) et l'essai est une
    DEMANDE que la veille lit la minute suivante. Ce qui est parti se dit « remis », jamais « reçu » ; **une panne de la
    base s'écrit à son retour** (la veille garde ce que la base n'a pas pris) ; les destinataires n'arrivent à la base
    que MASQUÉS. Deux règles neuves se jugent sur les mesures de la console (les pannes, le temps de réponse) : la minute
    pas encore rangée ne se juge pas, une base pas lue ne règle rien. **La fin d'une sourdine se dit par le serveur qui
    l'a posée**, jamais par l'estimation de la fenêtre. **Un filtre qui raccourcit une liste au bas de la page ne fait
    pas glisser ses pilules** (`useHauteurGardee`) ; un menu de ligne s'ouvre vers le haut quand la place manque ; un
    refus s'efface dès qu'on corrige. Un test du veilleur tourne **avec la base** (sourdine, essai, base en panne puis
    revenue) : sans elle, rien ne prouvait le chemin qui compte.
  - **Le support** (Support S1, 13/10/2026, 1.3.0 ; `docs/support.md`, `docs/console.md` C29, `0095`, `serveur/support/`,
    `serveur/console/support.ts`, `web/public/plateforme/support.js`) : une demande appartient à une entreprise ET à la
    personne qui la pose (ni un collègue, ni la voisine : la base le tient) ; elle n'emporte que le sujet, le texte, la
    version et le NOM de la page ; l'alerte par e-mail ne porte rien de la réponse. **Une lecture se note par message, pas
    par demande** (une seconde réponse ouverte à l'écran laissait la pastille allumée). La page de la console **tient
    dans la fenêtre** (deux colonnes, chaque colonne défile seule) et **se relit quand on la regarde**, jamais sous les
    doigts (`useRelireQuandOnRegarde`) ; une réponse commencée se garde par demande.
  - **L'accès au dossier** (Support S2, 1.4.0 ; `docs/support.md`, `0096`, `serveur/support/acces.ts`,
    `web/public/plateforme/acces.js`, le mode lecture de `pont.js`) : le support ne voit rien d'un dossier tant que le
    client ne l'a pas **accordé** — il le DEMANDE (motif), le propriétaire ou un administrateur l'ACCORDE (1 à 48 heures)
    ou le refuse, et le RETIRE quand il veut. La lecture est **la même application que le client**, ouverte depuis la
    console, qui ne lit que ce que lit un membre « Lecture » (jamais la paie), n'écrit rien (ni au serveur, ni sur le
    poste) et **note chaque page** (son nom, l'instant), que l'entreprise relit. L'état d'un accès se déduit de l'heure :
    une fin passée n'a besoin de personne pour fermer la porte.
  - **Nos factures** (abonnement 14b, première partie, 1.5.0 ; `docs/abonnement.md` B1–B4, `0097`,
    `serveur/abonnement/factures.ts`) : SkanFact est une entreprise de sa propre plateforme. La direction la désigne
    (Réglages › « Nos factures » ; seulement une entreprise dont elle est propriétaire ; offerte ; fixe une fois une
    facture préparée). Depuis la fiche d'un client, « Préparer sa facture… » écrit **dans le dossier de l'entreprise
    SkanFact**, par le même moteur que toutes les factures, la fiche du client et un brouillon (la période suit la même
    règle que « Noter un paiement », le prix est celui du jour, l'aperçu dit ce que la facture dira) ; elle s'émet et
    s'encaisse dans l'application de SkanFact, et **réglée en entier, elle paie l'abonnement** jusqu'à la fin de sa
    période, une fois (jamais en partie, jamais annulée par son avoir).
  - **L'abonné et ses factures** (abonnement 14b, seconde partie, 1.6.0 ; `docs/abonnement.md` B5, `0098`,
    `serveur/abonnement/routes.ts`, `web/public/plateforme/abonnement.js`, `web/v10/abonnement-factures.txt`) : dans
    « Ton abonnement », le propriétaire et les administrateurs lisent les factures que l'entreprise SkanFact leur a
    émises et leurs avoirs, réduits à ce qu'ils impriment (les listes fermées de l'espace client), et règlent le reste
    en ligne, sur le Konnect de l'entreprise SkanFact, même en lecture seule : la même règle que l'espace client
    (`ventes.paiement_noter`, `serveur/v10/paiement.ts`), puis B4 fait suivre l'abonnement. Le retour de Konnect
    ramène à l'onglet « Ton abonnement ».
  - **Ce que l'offre ouvre** (abonnement 14c, première partie, 1.7.0 ; `docs/abonnement.md` « 14c »,
    `serveur/abonnement/offre.ts`, `web/v10/offre-complet.txt`) : en Essentiel, la paie et la comptabilité complète
    sont fermées — tout ce qui existe se lit, s'imprime, s'exporte et se corrige, rien de NEUF ne s'y crée (02 § 6). Le
    serveur refuse lui-même un salarié, un bulletin, une absence, une avance ou une immobilisation nouveaux ; l'écran
    retient la création à l'ouverture du formulaire (les portes de la v10, 7.33.0, avec les mots de l'abonnement). Ce que
    la loi demande n'est dans aucun module fermé ; le cabinet sous mandat a toujours la paie et la comptabilité (02 § 8).
  - **Ce que l'offre compte** (abonnement 14c, deuxième partie, 1.8.0 ; `docs/abonnement.md` « 14c », `0099`) : un
    module acheté seul sur Essentiel (la paie, la comptabilité complète) est un geste de la direction dans la console,
    avec son motif ; la facture de l'abonnement compte, le jour où elle se prépare, ce qui dépasse l'offre (caisses,
    établissements, salariés présents) et chaque module acheté, au prix du jour de
    sa ligne (`plateforme.prix_option` ; au mois, un dixième de l'année) ; la base rejoue le total. Le client lit ces
    prix sous les offres de « Ton abonnement » avant de les payer. Depuis 1.9.0 (`0100`), ce que l'entreprise utilise et
    ce que l'offre comprend se comptent en une fonction que la facture et l'écran lisent toutes deux : « Ton abonnement »
    dit ce qui est pris. Depuis 1.10.0 (`0101`), la console lit cette grille dans Réglages › Offres et prix, avec les
    modules achetés. Depuis 1.11.0 (`0102`), plus aucune offre ne compte les utilisateurs (Skander, 14/10/2026) : ni la
    facture, ni l'écran, ni l'équipe n'en parlent plus. Depuis 1.12.0 (`0103`), la direction prépare un nouveau prix
    dans la console, au plus tôt après le préavis (réglable), et le retire avant sa date ; un prix en vigueur ne change
    plus ; la facture d'une période se prend au prix de son premier jour ; le client lit le prix à venir. Depuis 1.13.0
    (`0104`), l'essai, la grâce et les relances sont des règles datées que la direction pose dans la console : l'essai
    se fixe à la création de l'entreprise, la grâce d'une échéance est celle de son lendemain, les relances d'un jour
    celles de ce jour-là ; plus aucun de ces nombres n'est écrit dans le code (`tests/abonnement/regles.test.ts`).
    Depuis 1.14.0 (`0105`), ce que chaque offre comprend (caisses, établissements, salariés, la paie, la comptabilité
    complète) est daté dans `plateforme.contenu_offre` et se change dans la console comme un prix ; la facture et la
    porte des modules lisent le contenu du premier jour de la période (`tests/abonnement/contenu.test.ts`).
    Depuis 1.15.0 (`0106`), deux remises datées (`plateforme.regle_remise`) : celle d'un groupe déclaré dans la console
    (`plateforme.groupe`, `groupe_membre` ; la première abonnée paie le prix normal) et celle du cabinet (un mandat
    d'avant le premier paiement, pendant la durée de la règle), jamais additionnées (`plateforme.remise_de`) ; la facture
    porte celle de son premier jour sur tout son hors taxes (`tests/abonnement/remises.test.ts`, `remise.test.ts`).
  - **Les paiements de nos factures** (1.17.0 ; `docs/console.md` C30, `0108`, `serveur/console/paiements.ts`, pur) :
    l'écran Paiements de la console, la direction seule. L'encaissé d'un mois (les règlements de nos factures à leur
    date, par moyen ; Konnect seulement prouvé ; une autre devise jamais additionnée), la tuile « encaissé ce mois » de
    l'accueil par la même fonction ; qui doit encore et qui a trop payé, par la règle du solde de toutes les factures
    (`moteur/reglements.ts`) ; les coûts du mois saisis à la main (`plateforme.cout_du_mois` : retirés, jamais modifiés)
    et ce qui reste. La console ne note aucun règlement : il se note sur sa facture, dans l'application de SkanFact
    (`tests/console/paiements.test.ts`, `tests/web/console-paiements.test.ts`).
  - Un écran se prouve par l'instrument de rendu (`tests/web/rendu.test.ts` : l'entrée en français
    et en langue factice, les pages du quotidien de la v10 au téléphone et à l'ordinateur) ET par
    les parcours à la souris (`tests/web/parcours.test.ts`), et ses photos (`dist/photos`) se
    regardent.
- L'entreprise d'essai des développeurs (`0009`, 28/09/2026, par délégation) : une par personne,
  trois clients d'exemple, essai pour toujours ; « Commencer la découverte » la remplit de l'exemple de cinq ans
  (05/10/2026, `docs/exemple.md` : une fois, jamais si elle a déjà ses propres pièces) ; depuis `0011`, ses factures suivent la série
  « FAC » de la v10 (l'écran de la v10 annonce ce préfixe). À respecter plus tard : jamais facturée
  par l'abonnement, jamais transmise à la TTN, « ESSAI » sur chaque document.
- **La mise en ligne** (briques 142-143, `docs/mise-en-ligne.md`, 05/10/2026) : le serveur d'essai est un VPS OVH en
  France (données inventées seulement), à `app.skanfact.tn`. **Personne ne s'y connecte** : il suit `main` tout seul
  (`exploitation/suivre.ts`, toutes les deux minutes) et installe la plus récente version que GitHub a vérifiée en
  vert ; un réglage du serveur passe par une tâche d'entretien (`exploitation/taches/NNNN-nom.sh`, une fois chacune).
  Son état se lit à `https://app.skanfact.tn/etat.json` (serveur d'essai seulement ; `/etat`, la page publique, partout).
  **Deux sortes de serveurs** (`installer.sh <adresse> essai|pilotes`, B bis) : l'essai (données inventées) et les
  pilotes (vraies données : relais d'e-mails exigé, aucun état détaillé public, **jamais l'accès de Claude**).
  **Claude a la main dessus** (Skander, 05/10/2026) :
  `scripts/serveur.sh 'commande'` l'exécute en root sur le serveur, signée par la clé de la session
  (`~/.skanfact-acces/`, hors dépôt ; une session neuve se donne une clé neuve, déclarée dans
  `exploitation/acces-cles.json`, l'ancienne marquée `retiree`) ; `docs/mise-en-ligne.md`, F. Donc **un `main` rouge n'arrive jamais sur le serveur**, et
  les migrations poussées s'appliquent à sa base. Les routes sans session sont limitées par adresse
  (`LIMITES_PAR_ADRESSE`) ; derrière le frontal, `SKANFACT_PROXY=1`.
- **Ouvert** : les gestes « À reprendre » encore ouverts sont comptés dans l'export mais pas
  restaurés (à revoir avec la file, étape 2). La remise **par-dessus** son état abîmé (`remettre`, 06 § 4.4) remplace
  ses lignes, garde sa piste d'audit entière, fait relire tout le dossier à ses postes (les déclencheurs se taisent
  pendant la remise : elle pose elle-même les marques de relecture) et nomme les numéros de pièces qu'elle retire.
