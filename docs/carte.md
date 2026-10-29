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
  (1.136.0) L'ouverture qui tarde le dit (« Ouverture de ton entreprise… », plus de dix secondes : « plus long que
  d'habitude ») ; refusée par le serveur, elle le dit, avec « Réessayer » et la page d'état (`poste.js`, « L'ouverture »).
- **La lecture d'une facture d'achat en photo ou en PDF** (brique 84, `docs/achats.md`) : par l'IA de Claude
  seulement (`serveur/achats/lecture-ia.ts`), avec l'accord de la personne pour chaque fichier, même écrite à la
  main ; le fichier jamais gardé ; une proposition que la v10 fait relire, chaque champ avec l'endroit où il a été
  lu, ses doutes, le total recompté. La lecture sur nos serveurs (Tesseract) est retirée le 27/10/2026 : elle se
  trompait trop.
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
  posé par une autre ; elle s'ancre avant son début (règle d'avant la 1.151.0).
- **Les kits** (brique 96, `docs/kits.md`, `web/v10/kits.txt`) : un article non suivi qui porte `composants`
  ([{ itemId, qty }], des articles suivis) ; `lignesDeStock` déplie la ligne d'un kit en ses composants (pour
  `stockImpact`), `stockMovements` sort chaque composant ; `kitsPossibles`, `coutDuKit`.
- **Les lots** (brique 97, `docs/lots.md`, `web/v10/lots.txt`) : `parLot` sur l'article ; `lot`/`peremption` sur
  les lignes d'entrée, `lot` sur les lignes de sortie ; `stockMovements` pose `lot`, `peremption` (celle de
  l'entrée) ; `stockParLot`, `lotConseille`, `lotsAPerimer`, `lotsDeLaPiece`.
- **Les fiches reprises d'un autre logiciel** (1.51.0, `docs/reprise-fiches.md`, `web/v10/reprise-fiches.txt`) : la
  fenêtre d'import de la v10 reprend aussi les fournisseurs (`IMPORT_CHAMPS.fournisseurs` : banque, RIB ;
  `fournisseurVierge`), la référence d'un article (`code`, qui décide du même article quand les deux en ont une), et
  les titres d'Odoo et de Sage ; l'import se refuse avant pour qui lit seulement. Tests `tests/v10/reprise-fiches.test.ts`,
  `tests/web/fournisseurs-tableur.test.ts`, `tests/web/lecture-seule.test.ts`.
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
  `src/renderer` (branche `beta`, figés depuis le 13/10/2026 dans `web/v10/source`) ont été copiés dans
  `web/public/v10`, avec les retouches de `web/v10/adaptations.mjs`. Depuis la 1.151.0 (26/10/2026), ce code
  est le nôtre et se modifie directement : la reprise et le test de provenance sont retirés
  (`web/v10/LISEZMOI.md`) ; une correction urgente de la v10 en entretien se reporte à la main. Aucun lien vivant
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
    Le métier de la paie de 2026 (1.59.0, `docs/paie.md`) : les taux des documents réels (CNSS 9,68 % et
    17,07 %, CSS 0,5 %), les primes de chaque mois sur la fiche, au jour (`web/v10/paie-2026.txt`) ; un vrai
    journal de paie recalculé au millime, sans un nom (`tests/moteur/paie-journal-reel.test.ts`). Le pointage
    (1.60.0) : une grille par mois, les heures supplémentaires, le bulletin qui le suit (`web/v10/paie-pointage.txt`,
    collection `timesheets` de la paie ; `tests/moteur/paie-pointage.test.ts`). Le journal de paie et les états
    (1.61.0) : le journal du mois, l'état récapitulatif CNSS du trimestre, ce que la paie ajoute à la déclaration
    mensuelle (`web/v10/paie-etats.txt` ; `tests/moteur/paie-etats.test.ts`, les montants réels dans
    `tests/moteur/paie-reel.ts`). L'absence du mois d'une entrée (1.62.0) : au taux du salaire du contrat, à l'écran
    (`web/v10/paie-absence.txt`) et au serveur (`brutDuMois`, `paie.bulletin.brut_du_mois`, 0147). Le bulletin imprimé
    tient sur une page (1.62.0 ; `web/v10/paie-impression.txt`, ses pages comptées dans un navigateur :
    `tests/v10/bulletin-imprime.test.ts`). Le Cabinet ne perd rien d'un bulletin (1.63.0) : la paie lue à l'ouverture du
    livre (`pont-cabinet.js`, `poserLaPaie`), toutes les lignes et leurs marques (`web/v10/paie-cabinet.txt` ;
    `tests/moteur/paie-cabinet.test.ts`, `tests/web/cabinet-paie.test.ts`). Un bulletin modifié au Cabinet garde son
    barème (1.64.0 ; `web/v10/paie-cabinet-bareme.txt`, `baremesDuBulletin`). Les documents de la paie au Cabinet
    (1.65.0 ; `web/v10/paie-cabinet-documents.txt`, `paieDuDossierV10`) : le bulletin, le journal, l'état CNSS. Les
    taux propres d'un dossier au Cabinet (1.66.0 ; `web/v10/paie-cabinet-taux.txt`, `FICHE.paie`) : accident du
    travail, TFP, FOPROLOS. Le Cabinet lit les réglages de paie du client (1.67.0 ; migration 0148, `GET …/paie/dossier`,
    `reglagesDuClient` et `L.reglagesPaie`, `web/v10/paie-cabinet-reglages.txt`). Les primes de chaque mois au Cabinet
    (1.68.0 ; `web/v10/paie-cabinet-primes.txt`, `primesDuMois` dans `compta.js`, `salarieDe`/`employeDe`). Le pointage
    au Cabinet (1.69.0 ; migration 0149, `web/v10/paie-cabinet-pointage.txt`, le moteur du pointage et `saisieDuMois` dans
    `compta.js`, `savePointage`, `L.pointages` et `L.conges`). Les congés au Cabinet (1.70.0 ; migration 0150,
    `web/v10/paie-cabinet-conges.txt`, le moteur des congés dans `compta.js`, `saveConge`/`supprimerConge`, `FICHE.paie.leaveDaysPerYear`).
    Les avances au Cabinet (1.71.0 ; migration 0151, `web/v10/paie-cabinet-avances.txt`, le moteur des avances dans
    `compta.js`, `saveAvance`/`supprimerAvance`, `L.avances` et `L.remboursements`). Les documents du personnel au Cabinet
    (1.72.0 ; `web/v10/paie-cabinet-documents-personnel.txt`, `HR_DOCS`/`indemniteConges`/`lignesDuSolde`/`CIVILITES` dans
    `compta.js`, `FICHE.adresse`/`FICHE.gerant`, `paieDuDossierV10`). La déclaration annuelle d'employeur au Cabinet
    (1.73.0 ; `web/v10/paie-cabinet-declaration-employeur.txt`, `salairesDeLAnnee`/`COLONNES_SALAIRES_ANNEE`/`ecartsEmployeur`
    dans `compta.js`, la Liasse). Payer les salaires du mois, dans l'entreprise (1.74.0 ; `web/v10/paie-virement-salaires.txt`,
    `salairesAPayer`/`ordreDeVirementHtml` dans `core.js`, la fenêtre « Payer les salaires… »).
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
  - **La balance d'ouverture lue dans un FEC** (1.50.0, C61 ; l'étude `docs/etudes/FORMATS-REPRISE.md`) : le
    lecteur `web/public/plateforme/fec.js` (`SkanFec` : lire, les soldes au premier jour par `anouveauxDe`
    recomptés en millimes, le rapport) ; `importerBalance` et `reprendre` dans `pont-cabinet.js` ; adaptations
    `web/v10/reprise-fec.txt` ; tests `tests/v10/fec.test.ts`, `tests/web/cabinet-reprise-fec.test.ts`.
  - **Les écritures d'un FEC dans le livre** (1.52.0, C62) : `SkanFec.versLeLivre` (les lignes de l'exercice, les
    journaux traduits, au format du tableur du livre) et `rapportLivre` ; `lireEcrituresTableur` dans `pont-cabinet.js` ;
    adaptations `web/v10/reprise-fec-livre.txt` ; test `tests/web/cabinet-fec-livre.test.ts`.
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
    paie et `saveBulletin` du point de contact calculent avec eux (`paieDuDossier`). Depuis la 1.66.0, les taux
    propres au client à côté (`paie.accidentRate`, `tfpRate`, `foprolosRate` ; `savePaie(id, regimes, taux)`),
    lus tels quels comme ceux des contrats.
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
  - **La reprise du Cabinet v10** (briques 62 à 70, C52 à C60) : **retirée le 20/10/2026** (1.76.0, décision de
    Skander ; migration 0152). Son histoire reste dans `docs/cabinet.md` ; la reprise d'un FEC (C61) reste.
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
    d'écrire » : la page relit toutes les 30 secondes, page visible. (1.115.0, après la revue UI/UX du 22/10/2026,
    `docs/revue-messagerie.md` ; `0167`) « Mon comptable » dans le pied fixe du menu ; la boîte du cabinet en deux
    colonnes, la conversation à droite, ↑/↓ ; le fil à la hauteur de l'écran ; « Envoyer la pièce » en fenêtre (photo
    vue, ou pièce déjà saisie) ; au téléphone, un bouton de bulle à côté de « Menu » (`telephone.js`, 7). (1.116.0,
    `0168`) La pièce demandée a une date « pour le » et se relance par e-mail, sans rien de la demande (le jour venu,
    puis chaque semaine, trois au plus : `messagerie.relances_dues`, `relancerLesDemandes` dans `postier.ts`) ;
    plusieurs pièces en une demande, la même à plusieurs clients ; « Ouvrir » et « Saisir cette pièce » chez le cabinet
    (adaptation de `web/v10/messagerie.txt`). (1.117.0, `0169`) Les modèles du cabinet (`messagerie.modele`, hors de
    l'export), chercher dans un fil (`/messages/recherche`, `messagerie.plier`) et un client dans la boîte, la pastille
    des messages sur la liste des dossiers du Cabinet. (1.123.0 à 1.135.0 ; `docs/revue-mois-client.md`,
    `web/v10/mois-client.txt`, `web/v10/achats-confies.txt`, `web/v10/ce-mois-cabinet.txt`, `web/v10/invitation-d-abord.txt`, `web/v10/visites-une-fois.txt`, `web/v10/envoyer-par-email.txt`, `web/v10/valider-sans-fenetre.txt`, `web/v10/fiche-courte.txt`, `web/v10/lecture-piece.txt`) La photo jointe à l'achat que la demande cite ; la date de la pièce dans l'« À faire »
    (`pourLe`) ; « Ce mois-ci » dans « Mon comptable » (`GET /compta/resume`) ; au Cabinet, le oui ou non du
    justificatif d'un achat (`compta.achats_justifies`, `0173`), « Demander le justificatif » depuis la ligne, la
    validation qui le dit ; la page Achats qui, les achats confiés au cabinet (`achatsConfies`), envoie d'abord la photo ; « Ce mois-ci » dans le Suivi d'un dossier au Cabinet, avec son geste ; l'invitation du comptable d'abord, son vert là où est le curseur ; une proposition de visite par ouverture, et « Ne plus me proposer de visites » ; « Envoyer par e-mail… » quand un cabinet lit déjà tout ; la validation d'un lot qui finit sur l'étape suivante ; une fiche neuve en quatre cases ; une facture émise qui se lit (son résumé, et son écriture au journal des ventes : `GET /compta/ecritures?piece=`) ; (1.135.0, `0174`, `web/v10/justificatif-cabinet.txt`, `web/v10/declaration-mois-avant.txt`) au Cabinet, le justificatif d'une écriture qui s'ouvre (`GET /compta/ecritures/:e/justificatifs`), et le mois d'avant le livre qui se déclare à sa date. (1.136.0 à 1.139.0) L'ouverture qui tarde ou que le serveur refuse le dit (`poste.js`) ; au Cabinet, les lectures refusées disent « Réessayer » (`web/v10/etats-cabinet.txt`) ; l'Accueil d'une entreprise qui facture déjà, dans l'ordre du travail (`web/v10/accueil-au-travail.txt`).
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
  - **La recette d'une entreprise neuve** (1.75.0, 20/10/2026 ; `docs/recette.md`, `web/v10/recette-entreprise.txt`) : la
    touche Tab sans les « i » d'aide (`Info.tsx`, `info()` de l'application et du Cabinet), le message de l'entrée en haut
    (`entree.css`), la ville de la porte dans l'adresse (`serveur/v10/dossier.ts`), la pièce neuve qui prend le seul
    client, le refus d'un montant qui dit ce qui est attendu, le signe moins et les propositions du navigateur hors des
    champs de nombre (`virgule.js`), ce qui reste des premiers pas (`restesDesPremiersPas`), l'adresse du comptable
    renommée, deux prix voisins écrits pareil (`abonnement.js`).
  - **La recette du Cabinet et de la console** (1.76.0, 20/10/2026 ; `docs/recette.md`, `web/v10/recette-cabinet.txt`) :
    Dossiers relu au retour (`relirePortefeuille`), les phrases du mois en cours et du brouillard, « Écritures qui
    reviennent », « Adresse du client », la version du serveur au pied (`pont-cabinet.js`) ; l'e-mail et le téléphone
    de la fiche d'un client sous mandat actif (`socle.coordonnees_de_mes_clients`, 0153 ; `coordonnees` du
    portefeuille) ; à la console, « Pièces émises » d'une entreprise née ce mois-ci (`Fiche.tsx`).
  - **Inviter son comptable par e-mail** (1.77.0 ; 0154 ; `docs/recette.md`) : `socle.invitation_comptable` et ses quatre
    fonctions ; les routes `/entreprises/:e/mandat/invitation`, `/invitations-comptable/apercu`,
    `/cabinets/:c/invitations-comptable/rejoindre` (`serveur/cabinet/routes.ts`) ; l'e-mail `invitation.comptable`
    (`invitation-courriel.ts`, `lienComptable`) ; l'entrée (`App.tsx`, `?comptable=`, `VitrineComptable`, la porte
    `pourUnClient`) ; le panneau (`pont.js`, `dessinerInvitationComptable`, `.mandat-chemins`) ; la proposition en tête
    de Dossiers (`web/v10/inviter-comptable.txt`).
  - **Le client tenu rejoint son dossier** (1.78.0 ; 0155 ; `docs/recette.md`) : `socle.invitation_client_tenu` et ses
    quatre fonctions ; les routes `/cabinets/:c/dossiers/:dossier/invitation`, `/invitations-dossier/apercu` et
    `/rejoindre` ; l'e-mail `invitation.dossier` (`lienDossier`) ; l'entrée (`App.tsx`, `?dossier=`, `VitrineDossier`) ;
    le panneau du dossier tenu (`pont-cabinet.js`, `dessinerRejoindre` ; `web/v10/rejoindre-dossier.txt`).
  - **La recette alpha** (1.79.0 ; 0156 ; `docs/recette.md`) : les mouvements de trésorerie (`serveur/compta/mouvements.ts`,
    branché dans `serveur/v10/dossier.ts`) ; l'écart du Z (`noterEcartDuZ`, `serveur/caisse/routes.ts`) ; l'invitation
    des visites, le pied des fenêtres, l'achat réglé, la rangée de la caisse, la case de date qui se sélectionne
    (`web/v10/visite-proposee.txt`) ; le livre du Cabinet relu quand il a bougé (`relireLeLivreSiChange`,
    `web/v10/livre-a-jour.txt`).
  - **La recette alpha, suite** (1.80.0 ; `docs/recette.md`) : le choix du Stock (`choisirArticleAStocker`) et « Relancer »
    sur la ligne (`web/v10/stock-choisir.txt`) ; l'échéance pas prête et le calendrier vide du Cabinet
    (`web/v10/echeance-avant.txt`).
  - **La recette alpha, suite** (1.81.0 ; `docs/recette.md`) : pas de pièce négative, à l'écran (`montantNonEmettable`,
    `web/v10/montant-negatif.txt`) et au serveur (`emettre`, `serveur/ventes/pieces.ts`) ; le client « à valider » d'une
    échéance du Cabinet et sa saisie (`web/v10/echeance-valider.txt`).
  - **L'offre choisie dans l'application** (1.84.0 ; `docs/abonnement.md` C19) : `plateforme.offre_choisie`
    (`base/migrations/0158_offre_choisie.sql`), `POST /entreprises/:e/abonnement/choisir` (`serveur/abonnement/routes.ts`),
    les choix de « Ton abonnement » (`brancherChoix`, `web/public/plateforme/abonnement.js`), la ligne `offre_choisie`
    d'« À décider » (`serveur/console/decider.ts`). (1.118.0, après la revue du 22/10/2026, `docs/revue-abonnement.md`,
    `docs/abonnement.md` C20 ; `0170`) Le bandeau de l'accueil (`bandeau`, `web/v10/abonnement-revue.txt`, `aFaire` de
    `/abonnement/etat`), un bouton par offre confirmé sous lui, la prochaine facture (`plateforme.ma_prochaine_facture`,
    `aRenouveler`), les rappels déjà partis (`plateforme.mes_rappels`), les e-mails « facture prête » et « paiement reçu »
    (`serveur/abonnement/courriels.ts`, `plateforme.factures_a_annoncer`, avec le postier). (1.119.0, `docs/abonnement.md`
    C21 ; `0171`) La facture au choix (`serveur/abonnement/facturier.ts` : `facturerLesChoix`, `facturerBientot`,
    `plateforme.choix_a_facturer`, `noter_facture_au_choix`, `choix_refuse`), le prix TTC (`netDUneOffre`,
    `serveur/abonnement/factures.ts`), « Ne pas renouveler » (`POST /abonnement/renouvellement`,
    `plateforme.mon_renouvellement`), un module ouvert tout de suite (`POST /abonnement/module`,
    `plateforme.mon_module_ouvrir`), et dans l'écran `brancherRenouvellement`, `brancherModules`.
  - **L'abonnement des cabinets** (1.120.0 ; `docs/abonnement.md` C22 ; `base/migrations/0172_abonnement_cabinet.sql`) :
    les règles datées (`plateforme.regle_cabinet`), les dossiers comptés (`plateforme.dossiers_du_cabinet`), l'état
    (`plateforme.etat_cabinet`), le calcul de la facture (`plateforme.calcul_facture_cabinet`), la facture émise seule
    (`serveur/abonnement/cabinet.ts`), la lecture seule des payants (`serveur/abonnement/condition.ts`), « Ton
    abonnement » du Cabinet (`web/public/plateforme/abonnement-cabinet.js`, `web/v10/abonnement-cabinet.txt`, le pont
    `licenceStatus`, `dessinerAbonnementCabinet`, `creationDossier`), et la console (`Reglages.tsx`, « L'abonnement des
    cabinets » ; `Cabinet.tsx`, « Son abonnement » ; la ligne `facture_cabinet` d'« À décider »).
  - **L'abonnement de bout en bout** (1.83.0 ; `docs/recette.md`) : la première abonnée d'un groupe est celle qui a payé
    (`plateforme.remise_de`, `base/migrations/0157_la_premiere_abonnee.sql`) ; « à facturer » dans « À décider »
    (`A_FACTURER_JOURS`, `serveur/console/decider.ts`, les factures qui attendent par `argentADecider`,
    `serveur/console/paiements.ts`) ; les personnes d'un groupe comptées une fois (`plateforme.console_personnes`).
  - **La recette alpha, suite** (1.82.0 ; `docs/recette.md`) : le nom du tiers de chaque écriture (`tiersNom`,
    `serveur/compta/routes.ts`, porté sur les lignes par `web/public/plateforme/pont-cabinet.js`) ; l'en-tête du dossier
    qui suit ses validations (`majAValider`, `web/v10/entete-a-valider.txt`) ; « Ce qui reste dû » sans les soldés
    (`web/v10/agee-sans-zero.txt`) ; la TFP d'un mois sans paie (`web/v10/declaration-paie-a-venir.txt`) ; l'écart du Z
    rendu avec le Z (`noterEcartDuZ`, `serveur/caisse/routes.ts`) et ajouté à l'écran (`fermerCaisse`, `pont.js`).
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
    un refus pris à « Enregistrer » jette la saisie ; l'état vide d'une liste dont la création attend mène à
    l'abonnement, et un « + Nouveau… » de tête n'y est plus vert (1.134.0, `web/v10/lecture-seule-listes.txt`). Les relances (15 j, 7 j, la veille, la lecture seule ; une fois par
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
  - **Nos factures** (1.18.0 ; `docs/console.md` C31, `0109`, `serveur/console/nosfactures.ts`, pur) : l'écran de la
    console, la direction seule. Les factures d'abonnement émises d'un mois et les avoirs qui les corrigent ; où chacune
    en est hors du dossier (le fichier, la signature, le dépôt, acceptée ou refusée et ce que la TTN a répondu) ; son
    paiement par la règle de toutes les factures ; le résumé et les filtres comptés par la fonction qui filtre ; si la
    fiche de l'entreprise SkanFact la dit soumise à la facture électronique. Le sélecteur de mois est commun aux
    paiements (`web/console/src/mois.tsx`) (`tests/console/nosfactures.test.ts`, `tests/web/console-nosfactures.test.ts`).
  - **La liste des clients sans écart avec sa maquette** (1.19.0 ; `docs/console.md` C32, `0110`,
    `serveur/console/clients.ts`, pur) : les filtres comptés par la fonction qui filtre, ce que chaque ligne dit en plus
    lu en un passage (`plateforme.console_clients_en_plus` : pièces émises du mois, durée de l'essai et ce qui l'a
    prolongé, facture qui attend), une date écrite une fois par ligne, le menu « … » avec les gestes de la fiche par la
    même règle (`gestesDeLaListe`) et leur fenêtre posée sur la liste, l'export de la sélection (la direction, motif au
    journal, jamais les lignes), les pages numérotées (`tests/console/clients.test.ts`, `tests/console/console.test.ts`,
    `tests/web/console-clients.test.ts`).
  - **Qui est le client, nos échanges, les gestes qui manquaient, la reprise** (1.19.0 ; `docs/console.md` C33–C35) :
    le numéro de client et la ville (`0110`, `plateforme.numero_client`, `socle.poser_ville`) ; une ligne par organisation
    (`serveur/console/organisations.ts`, pur : entreprise seule, groupe, dossier tenu, cabinet) et la fiche d'un groupe
    (`web/console/src/ecrans/FicheGroupe.tsx`) ; les notes d'appel, intouchables, et le message au contact dans son
    application (`plateforme.note_appel`, `web/console/src/ecrans/Echanges.tsx`) ; accorder un délai, offrir un mois,
    changer d'offre (`0111`, la règle dans `serveur/abonnement/gestes.ts`) ; la procédure de reprise sur pièces, confirmée
    par l'autre membre de la direction (`0112`, `web/console/src/ecrans/Reprise.tsx`) (`tests/abonnement/gestes-0111.test.ts`,
    `tests/console/echanges.test.ts`). Les pièces communes de `web/console/src/ui.tsx` : un menu qui se parcourt au
    clavier comme sur le Mac (`parcourirMenu`, le menu « … » et « Gestes ▾ »), en sections par société (`section`) ; des
    pastilles qui se cochent comme des boutons radio (`Pilules`) ; le client nommé au-dessus du titre d'une fenêtre
    (`Dialogue`, `pour`).
  - **L'argent juste** (1.20.0 ; `docs/abonnement.md` C18, `docs/console.md` C36, `0113`) : un mois offert sur la
    prochaine facture (`abonnement.mois_offerts`, `facture_abonnement.mois_offert`), le support une fois sur douze mois ;
    un paiement reçu hors de la plateforme et sa preuve (`MOYENS_RECUS`, `console_paiements.horsPlateforme`) ; le
    rattrapage au prorata d'un module ouvert en cours (`plateforme.rattrapage_modules`) et le module retiré qui part au
    renouvellement (`modules_a_retirer`) ; un renouvellement compté par la règle de la facture, en un passage
    (`plateforme.console_renouvellements`, `serveur/console/renouvellements.ts`, `htDeLaPeriode`) ; l'argent qui attend
    dans « À décider » (`aDecider`, `argentADecider` : payée puis défaite, à émettre, trop-perçu)
    (`tests/abonnement/gestes-0111.test.ts`, `tests/console/factures.test.ts`, `tests/console/clients.test.ts`,
    `tests/console/decider.test.ts`).
  - **Des chiffres et des accès justes** (1.21.0 ; `docs/console.md` C37, `0114`) : « a servi » compte les pièces
    créées (`plateforme.pieces_creees`, `aServi`) ; la dernière activité notée par entreprise et par membre
    (`socle.activite`, `socle.noter_activite`, `serveur/activite.ts`), qu'une relecture automatique de l'écran ne
    prolonge pas (`x-console-auto`, `qui_est_console(…, p_prolonger)`) ; le journal filtré, ses chiffres, les gestes
    du système, les accès aux dossiers et l'export (`plateforme.console_journal`, `console_journal_chiffres`,
    `console_acces_tous`, `serveur/console/journal.ts`, `web/console/src/ecrans/Journal.tsx`) ; les appareils et
    sessions d'un membre, fermer et oublier (`console_appareils_membre`, `console_fermer_session`,
    `console_oublier_appareil`) ; les demandes closes par pages (`CLOSES_PAR_PAGE`) ; un avoir sans timbre qui annule
    une facture, et le coût du mois provisoire (`annuleeParSesAvoirs`, `couts`) (`tests/console/chiffres-justes.test.ts`,
    `tests/console/journal.test.ts`, `tests/console/paiements.test.ts`, `tests/console/factures.test.ts`).
  - **Le support et les travaux suivis** (1.22.0 ; `docs/console.md` C38, `0115`) : qui suit une demande, sa priorité,
    l'attente de la technique (`plateforme.console_suivre_demande`, `console_priorite_demande`, `console_attente_technique` ;
    `delaiDe`, `etatDe` dans `serveur/console/support.ts` ; la barre « Suivi » de `web/console/src/ecrans/Support.tsx`) ;
    reprendre un envoi arrêté sur une panne (`plateforme.console_reessayer_envoi`, « Reprendre maintenant… » de
    `Travaux.tsx`) ; la trace des e-mails (`plateforme.courriel_trace`, `avecTrace` dans `serveur/courriel.ts`) ; les
    chaînes d'empreintes relues seules (`socle.verifier_chaine`, `plateforme.relire_chaines`, `console_chaines`,
    `serveur/service/chaines.ts`, `serveur/console/chaines.ts`, la règle « chaine » et la brique « chaînes » de
    `exploitation/veille.ts`, la carte de `Securite.tsx`) (`tests/console/suivi.test.ts`, `tests/support/rangement.test.ts`).
  - **La mesure** (1.23.0 ; `docs/console.md` C39, `0116`) : l'entonnoir, les inscriptions, les départs, les offres et ce
    qu'on promet, par offre et sans nom (`plateforme.console_mesure` ; `mesurer`, `bornes` dans `serveur/console/mesure.ts` ;
    `web/console/src/ecrans/Mesure.tsx`) ; ce qui demanderait des événements de l'application dit « pas encore mesuré »
    (`tests/console/mesure.test.ts`).
  - **Ton compte** (1.24.0 ; `docs/console.md` C40, `0117`) : chacun son compte, ses trois gestes (mot de passe, code,
    codes de secours) par les fonctions de l'application (`serveur/compte.ts`), et leur trace (`plateforme.console_mon_compte`,
    `console_mon_compte_change` ; les routes `/console/moi/…` ; `web/console/src/ecrans/TonCompte.tsx`, `SesAppareils` en
    page) (`tests/console/compte.test.ts`, `tests/web/console-compte.test.ts`).
  - **Inviter quelqu'un** (1.25.0 ; `docs/console.md` C41, `0118`) : l'invitation et son lien (`plateforme.invitation_console`,
    `console_inviter`, `console_renvoyer_invitation`, `console_annuler_invitation`, `apercu_invitation_console`,
    `accepter_invitation_console` ; `serveur/console/invitations.ts` ; `web/console/src/ecrans/Invitation.tsx`), le premier
    code posé à la connexion (le défi « pose », `peut_poser_code_console`, `poserCode` dans `serveur/console/connexion.ts`,
    l'étape de `Entree.tsx`) (`tests/console/invitations.test.ts`, `tests/web/console-invitation.test.ts`).
  - **L'invitation par e-mail** (1.26.0 ; `docs/console.md` C42, `0119`) : `serveur/invitation-courriel.ts` (les trois
    portes : `serveur/routes/socle.ts`, `serveur/cabinet/routes.ts`, `serveur/console/routes.ts`),
    `console_invitation_pour_courriel`, les phrases `invitation.*` de `textes/socle.ts` (`tests/socle/invitation-courriel.test.ts`).
  - **Les nouveautés qu'on allume** (1.27.0 ; `docs/console.md` C43, `0120`) : `serveur/nouveautes.ts` (la liste du code,
    `nouveauteAllumee`, la route de l'application), `plateforme.nouveaute_entreprise`, `plateforme.nouveaute_tous`, les
    gestes `console_allumer_nouveaute`… ; l'onglet « Nouveautés allumées » de `Reglages.tsx` (`tests/console/nouveautes.test.ts`,
    `tests/web/console-reglages.test.ts`).
  - **Les droits à leur date, le mot de passe qui ferme tout** (1.28.0 ; `docs/abonnement.md` B6, `docs/console.md` C44,
    `0121`, `0122`) : les colonnes `a_venir_*` de `plateforme.abonnement`, `plateforme.basculer_abonnement(s)` (le tour
    « echeances » de `serveur/principal.ts`), `offreAu` et `lireAVenir` de `serveur/abonnement/etat.ts`, le « payer »
    d'avance de `serveur/abonnement/gestes.ts` ; `socle.conclure_reinitialisation` et `socle.changer_mot_de_passe` ferment
    aussi la console ; la route `/console/moi/mot-de-passe` change dans sa propre transaction (`compte.ts`, `tx` en
    option) (`tests/console/factures.test.ts`, `tests/console/compte.test.ts`, `tests/abonnement/gestes-0111.test.ts`,
    `tests/web/offre-compte.test.ts`).
  - **Le gel tenu, l'équipe en concurrence** (1.29.0 ; `docs/console.md` C45, `0123`) : `consignesDuTour` et
    `LectureConsignes` de `exploitation/suivre.ts`, `consignesIllisibles` (l'état du suiveur, `serveur/console/versions.ts`,
    l'écran Versions) ; `plateforme.verrou_equipe` et l'index `invitation_console_une_en_attente`, le verrou dans
    `base/equipe.ts` (`tests/console/versions.test.ts`, `tests/console/invitations.test.ts`, `tests/web/console-versions.test.ts`).
  - **L'invitation, le support et sa mesure, honnêtes** (1.30.0 ; `docs/console.md` C46, `0124`) : `envoyerInvitation` et
    `enMots` de `serveur/invitation-courriel.ts`, `apres` (la suite d'une route, après sa transaction) dans `serveur/app.ts`,
    `socle.noter_courriel_invitation` ; `attendClientLe` de `plateforme.support_ligne` et `etatDe` (`serveur/console/support.ts`) ;
    la `commande` de `plateforme.console_repondre_demande` (l'écran Support la tire) ; `ouvertes` de `plateforme.console_mesure`
    et `mesurer` (`tests/socle/invitation-courriel.test.ts`, `tests/support/support.test.ts`, `tests/support/rangement.test.ts`,
    `tests/console/mesure.test.ts`).
  - **Les sauvegardes honnêtes** (1.31.0 ; `docs/console.md` C47, `0125`) : `leReleve`, `lArchivage` et `horsDeLaMachine`
    (avec l'heure) et `laRemise` de `serveur/console/sauvegardes.ts` ; `essaiSecondes` de `remettre` (`base/entreprise.ts`,
    `--essai-secondes`) et la durée de l'essai dans `exploitation/remettre-entreprise.sh` ; `mesuree` de
    `plateforme.console_service_sauvegardes` (`tests/console/sauvegardes.test.ts`, `tests/console/console.test.ts`,
    `tests/socle/export-entreprise.test.ts`, `tests/web/console-service.test.ts`).
  - **Une demande liée à son incident et à sa correction** (1.32.0 ; `docs/console.md` C48, `0126`) : `incident` et
    `correction` de `plateforme.demande_support`, `plateforme.console_lier_incident`, `plateforme.console_noter_correction`,
    `plateforme.console_incidents_a_lier`, les `demandes` de `plateforme.console_service_incidents` ; `versionAtteinte` de
    `serveur/console/support.ts` (`tests/console/demandes-incidents.test.ts`, `tests/web/support.test.ts`,
    `tests/web/console-incidents.test.ts`).
  - **Le guet extérieur** (1.33.0 ; `docs/console.md` C49, `docs/mise-en-ligne.md` I bis) : `exploitation/guetter.ts` et
    `.github/workflows/guet-exterieur.yml` ; `guetDuPassage`, `relireLeGuet` et les problèmes `guet` et `guet-reglage` de
    `exploitation/veille.ts`, la lecture de GitHub dans `exploitation/veiller.ts` (`tests/exploitation/guetter.test.ts`).
  - **L'arrivée des nouveaux clients** (1.34.0 ; `docs/console.md` C50, `0127`) : `serveur/console/arrivee.ts`, la vue
    `arrivees` de `serveur/console/clients.ts`, `premiereFactureLe` de `plateforme.console_clients_en_plus` ; la carte
    « Son arrivée » de `web/console/src/ecrans/Fiche.tsx` (`tests/console/arrivee.test.ts`, `tests/console/console.test.ts`,
    `tests/web/console.test.ts`).
  - **Prévenir d'un coup les clients d'un incident** (1.35.0 ; `docs/console.md` C51, `0128`) :
    `plateforme.console_repondre_incident`, la route `POST /console/support/incidents/:incident/repondre`, la fenêtre
    « Prévenir les clients de cet incident » de `web/console/src/ecrans/Incidents.tsx` (`tests/console/demandes-incidents.test.ts`,
    `tests/web/console-incidents.test.ts`).
  - **Les contestations de nos factures** (1.36.0 ; `docs/console.md` C52, `0129`) : `plateforme.contestation`,
    `plateforme.console_contester`, `plateforme.console_regulariser`, `plateforme.console_contestations` ;
    `serveur/console/contestations.ts`, la ligne `contestation` de `serveur/console/decider.ts` ;
    `web/console/src/ecrans/Contestations.tsx` (`tests/console/contestations.test.ts`, `tests/web/console-paiements.test.ts`).
  - **Les secrets et leur échéance** (1.37.0 ; `docs/console.md` C53, `0130`) : `plateforme.secret_suivi` et ses gestes,
    `serveur/console/secrets.ts`, la ligne `secret` de `serveur/console/decider.ts`, `web/console/src/ecrans/Secrets.tsx`
    (`tests/console/secrets.test.ts`, `tests/web/console-securite.test.ts`).
  - **La sortie d'un client et la conservation** (1.38.0 ; `docs/console.md` C54, `0131`) : `plateforme.sortie`,
    `plateforme.sortie_contrat`, `plateforme.sortie_conservation`, `plateforme.console_ouvrir_sortie`,
    `plateforme.console_sortie_remboursement`, `plateforme.console_clore_sortie`, `plateforme.console_sortie(s)` ;
    `serveur/console/sortie.ts`, la ligne `sortie` de `serveur/console/decider.ts` ; `web/console/src/ecrans/Sortie.tsx`
    (`tests/console/sortie.test.ts`, `tests/web/console-clients.test.ts`).
  - **Ce qui doit rentrer** (1.39.0 ; `docs/console.md` C55) : `serveur/console/previsions.ts` (`prevoir`), lu par
    `GET /console/paiements` ; la carte `CeQuiDoitRentrer` de `web/console/src/ecrans/Paiements.tsx`
    (`tests/console/previsions.test.ts`, `tests/console/paiements.test.ts`, `tests/web/console-paiements.test.ts`).
  - **Le risque de départ** (1.40.0 ; `docs/console.md` C56) : base `0132_risque.sql` (`plateforme.console_usage_trente`) ;
    `serveur/console/risque.ts` (`risqueDe`, `avecRisque`), posé par `selectionClients` et la fiche de `serveur/console/routes.ts` ;
    la vue `a_risque` de `serveur/console/clients.ts` ; la vue et la colonne de `web/console/src/ecrans/Clients.tsx`, la carte
    `SonRisque` de `web/console/src/ecrans/Fiche.tsx` (`tests/console/risque.test.ts`, `tests/web/console.test.ts`).
  - **La documentation interne du support** (1.41.0 ; `docs/console.md` C57) : base `0133_doc_support.sql` (notes privées,
    fiches, leurs gestes) ; `serveur/console/docsupport.ts` (`lireDocs`, `reponsesOffertes`, `poserReponse`) et ses routes
    dans `serveur/console/routes.ts` ; `web/console/src/ecrans/DocSupport.tsx` (`Documentation`, `NotesPrivees`), branchés
    dans `web/console/src/ecrans/Support.tsx` (`tests/console/docsupport.test.ts`, `tests/web/support.test.ts`).
  - **Les demandes d'évolution** (1.42.0 ; `docs/console.md` C58) : base `0134_evolutions.sql` ; `serveur/console/evolutions.ts`
    (`lireEvolutions`, `aEtudier`) et ses routes dans `serveur/console/routes.ts` ; `web/console/src/ecrans/Evolutions.tsx`
    (`Evolutions`, `FenetreRattacher`), branché dans `web/console/src/ecrans/Support.tsx` (`tests/console/evolutions.test.ts`,
    `tests/web/support.test.ts`).
  - **L'accès d'urgence de l'équipe** (1.43.0 ; `docs/console.md` C59) : base `0135_acces_urgence.sql` ; `serveur/console/urgence.ts`
    (lecture prudente, ce qui remonte à l'accueil), `serveur/console/connexion.ts` (un accès ouvert mène à la pose d'un
    nouveau code), `base/equipe.ts` et `exploitation/equipe.sh` (« urgence », par la machine) ; écrans `Equipe.tsx`,
    `Entree.tsx`, `Accueil.tsx` ; tests `tests/console/urgence.test.ts`, `tests/web/console-urgence.test.ts`.
  - **L'audit de la console 1.42.0, lot 1** (1.44.0 ; `docs/console.md` C60) : base `0136_audit_lot1.sql` ; `secondChangement`
    (`serveur/abonnement/etat.ts`, gestes et factures) ; la transaction de la route dans `serveur/compte.ts` ; la version
    lue des fiches (`DocSupport.tsx`) ; la commande gardée avec le brouillon (`Support.tsx`).
  - **L'audit de la console 1.42.0, lot 2a** (1.45.0 ; `docs/console.md` C61) : base `0137_audit_lot2a.sql` (le motif
    d'un geste sur un secret contrôlé, `arrivee_close`, le hors-taxes des factures préparées) ; `serveur/console/previsions.ts`
    (trois lignes par mois, les mois d'un mensuel), `serveur/console/arrivee.ts` (l'arrivée jusqu'à son issue) ; écrans
    `Arrivee.tsx` (clore, rouvrir), `Fiche.tsx`, `Paiements.tsx` (un bloc par mois), `Secrets.tsx`.
  - **L'audit de la console 1.42.0, lot 2b** (1.46.0 ; `docs/console.md` C62) : base `0138_audit_lot2b.sql` (l'avoir nommé
    vérifié, le remboursement déclaré puis rapproché, l'e-mail d'invitation « à envoyer » dans sa transaction) ;
    `serveur/console/contestations.ts` et `sortie.ts` (le rapprochement lu), `serveur/invitation-courriel.ts` (`etatVu`,
    « sans réponse ») ; écrans `Contestations.tsx`, `Sortie.tsx`, `Equipe.tsx`, `web/public/plateforme/equipe.js`, le
    patron `web/v10/equipe.txt` (cabinet).
  - **La communication ciblée** (1.47.0 ; `docs/console.md` C63) : base `0139_messages_cibles.sql` (le public d'un
    message, sa diffusion) ; `serveur/console/diffusion.ts` (pur : les publics d'une entreprise, ce que chacun atteint),
    `serveur/console/message-clients.ts` (la lecture qui compare, la diffusion notée) ; écran `Reglages.tsx` (« À qui »,
    « vu dans… ») ; `web/public/plateforme/message.js` et `pont.js` (montré, caché).
  - **L'effet de chaque version** (1.48.0 ; `docs/console.md` C64) : base `0140_impact_versions.sql` (ce que la base sait
    de chaque période) ; `serveur/console/impact.ts` (pur : les périodes, la lecture, ce qui est pire qu'avant) ; écran
    `Versions.tsx` (« L'effet de chaque version »).
  - **Le coût des listes** (1.49.0 ; `docs/console.md` C65 ; l'audit A09) : base `0141_cout_des_listes.sql` (le compte des
    pièces tenu à jour, des index, la fiche qui ne lit que la sienne) ; `serveur/console/instantane.ts` (le calcul de la
    liste partagé par l'équipe, une minute) ; le banc `banc/console/mesurer.ts` (`npm run banc:console` : 5 000 entreprises,
    cinq personnes, 95 % sous 300 ms).
  - **La charge des clients** (1.110.0 ; VISION § 6) : le banc `banc/clients/mesurer.ts` (`npm run banc:clients` :
    500 utilisateurs au travail sur 60 entreprises de cinq ans, le programme en deux exemplaires) ; base
    `0165_equilibree_sans_detour.sql` (le contrôle d'équilibre des écritures sans la sécurité par ligne).
  - **Le plancher des navigateurs** (1.112.0 ; VISION § 4.1) : `commun/navigateurs.ts` (Chrome et Edge 111, Firefox 121,
    Safari et iOS 16.4), visé par `web/vite.config.ts` ; `tests/web/navigateurs.test.ts` relit tout ce qui est servi (la
    syntaxe ES2022, les fonctions plus jeunes, les feuilles de style). Le plus petit téléphone (320 points) :
    `tests/web/telephone-commercant.test.ts`. Les vrais appareils : `docs/repetition-generale.md`, 5 bis.
  - **Le contenu des pièces relu contre son empreinte** (1.53.0 ; `docs/console.md` C66) : base `0142_relire_contenus.sql`
    (l'état du contenu de chaque chaîne, les pièces rendues au serveur seul, la relecture demandée, ce que la console et la
    veille en lisent) ; `serveur/service/contenus.ts` (la relecture : chaque heure après les liens, et celle qu'on demande),
    `serveur/ventes/pieces.ts` (`pieceDeLaLigne`, la pièce lue comme à l'émission) ; écrans `Securite.tsx` (« Relire
    maintenant… », la jauge, la rupture en mots, « Ouvrir l'incident ») et `Incidents.tsx` (la fiche « une chaîne
    d'empreintes cassée », la fenêtre remplie).
  - **Les adresses à l'entrée** (1.54.0 ; `docs/console.md` C67) : base `0143_adresses.sql` (ce que l'entrée a refusé ou
    freiné par adresse et par heure, trente jours ; les blocages) ; `serveur/adresses.ts` (le compte en mémoire, la liste
    appliquée à l'entrée), `serveur/app.ts` (l'entrée fermée à une adresse bloquée, comptée) ; `serveur/console/adresses.ts`
    (pur) ; écran `Securite.tsx` (« Les adresses à l'entrée », bloquer, débloquer).
  - **Les données personnelles** (1.55.0 ; `docs/console.md` C68 ; `docs/conservation.md`) : base `0144_effacement.sql`
    (le registre des demandes d'effacement, `socle.effacer_personne`, la trace qui ne recopie plus d'adresse) ;
    `serveur/console/donnees.ts` (pur : ce que SkanFact garde, l'état d'une demande) ; écran `Donnees.tsx` (noter,
    décider, effacer, la preuve) ; « À décider » (`decider.ts`).
  - **La suite des travaux** (1.56.0 ; `docs/console.md` C69) : base `0145_travaux.sql` (la pause d'un partenaire, le
    débit heure par heure, les envois à la TTN qui ne partent plus) ; `serveur/service/pauses.ts` (lue par le facteur,
    `serveur/v10/envoi.ts`, et les relances, `serveur/abonnement/relances.ts`) ; `serveur/console/travaux.ts` (pur) ;
    écran `Travaux.tsx` (« 14 jours · 24 heures », « Mettre en pause… », « Reprendre… »).
  - **Le second guet** (1.57.0 ; `docs/mise-en-ligne.md` I ter) : `exploitation/guet-second/worker.ts` et son
    `wrangler.toml` (un Worker de Cloudflare, toutes les dix minutes, qui reprend `exploitation/guetter.ts`) ; la liste de
    la répétition générale : `docs/repetition-generale.md`.
  - Un écran se prouve par l'instrument de rendu (`tests/web/rendu.test.ts` : l'entrée en français
    et en langue factice, les pages du quotidien de la v10 au téléphone et à l'ordinateur) ET par
    les parcours à la souris (`tests/web/parcours.test.ts`), et ses photos (`dist/photos`) se
    regardent.
- L'entreprise d'essai des développeurs (`0009`, 28/09/2026, par délégation) : une par personne,
  trois clients d'exemple, essai pour toujours ; « Commencer la découverte » la remplit de l'exemple de cinq ans
  (05/10/2026, `docs/exemple.md` : une fois, jamais si elle a déjà ses propres pièces) ; depuis `0011`, ses factures suivent la série
  « FAC » de la v10 (l'écran de la v10 annonce ce préfixe). À respecter plus tard : jamais facturée
  par l'abonnement, jamais transmise à la TTN, « ESSAI » sur chaque document.
- **Les maquettes appliquées** (depuis 1.151.0, `docs/maquettes-appliquees.md` ; les maquettes dans `docs/maquettes/`) :
  par lots, le code des écrans (`web/public/v10`) modifié directement, au résultat de la maquette en ligne. Lot 1, la
  coquille de la maquette « Barre v3 » : `drawNav` (app.js) dessine « Au quotidien » (les pages du MÉTIER, rangées en
  glissant) et « Tout le reste » ; `web/public/plateforme/barre.js` et `barre.css` font le reste (Créer, volets, cloche,
  menus, barre repliée, raccourcis, visite, rail de la tablette, onglets et « Plus » du téléphone), en Inter. Règles
  apprises : **une page n'a qu'un lien dans la barre** (une page épinglée n'est, dans son volet, qu'un bouton qui y mène)
  — l'accueil d'un rôle et les lecteurs d'écran lisent la liste des liens ; **ce qui s'ouvre de la barre se pose sur la
  page** (sa liste défile et s'efface aux bords : un volet ou une bulle y serait coupé). Lot 1 b (1.152.0), la barre du
  Cabinet : la même coquille (`barre.js` lit `app: 'cabinet'` dans `__barreInfos`), `drawNav` du Cabinet
  (`v10/cabinet/app.js` : « Mon cabinet », le dossier ouvert et son changement, les pages Priorités et Pièces reçues),
  `plateforme/barre-cabinet.css` ; les pièces reçues au serveur (0175 : `messagerie.classer_piece`, `GET
  /cabinets/:cabinet/pieces` ; 0179 : la raison du classement, les demandes en cours), leur page telle que la maquette
  (1.167.0 : `drawPieces`, `plateforme/pieces-recues.css` ; 1.168.0 : `fenDouble`, `fenDejaSaisie`, le choix de plusieurs,
  `nonConfiee` lu du `perimetre` du mandat), les Échéances telles que la maquette (1.168.0 : `drawEcheances`,
  `plateforme/echeances.css`, `api.relancerDossier`, `api.declarerHorsLivre` ; la route de production rend l'état de chaque
  déclaration), les Dossiers tels que la maquette (1.169.0 : `drawDossiersCd`, `ficheCd`, `menuLigneCd`, `popConfier`,
  `fenNoterRelance`, `plateforme/dossiers.css` ; la fiche garde `forme`, `ville`, `activite`, `fonction` ; le bandeau des
  propositions, `bandeauMandats` du pont), la fiche du dossier telle que la maquette (1.170.0 : `drawFicheFd`, `lireLivreFd`,
  `etatMoisFd`, `popMoisFd`, `menuFicheFd`, `fenNoteFd`, `introuvableFd`, `plateforme/fiche-dossier.css` ; l'ancienne page
  du dossier à `#/dossier/<id>/suivi`), le classeur du client (1.171.0 : `drawClasseur`, `modeleCl`, `chargerClasseur`,
  `plateforme/classeur.css`, `#/dossier/<id>/classeur`) et l'aperçu des PDF commun aux deux applications
  (`plateforme/apercu-pdf.js`). Lot 2 (1.153.0), la charte : `plateforme/charte.css` (statuts, boutons, menu ⋯, toast,
  bandeaux, en-tête), chargée après `style.css` par les deux applications ; le menu prend un titre (`rowmenu.js`,
  `opts.titre`) ; le toast sa barre de temps (`toast`, `toastUndo` des deux `app.js`).
  Lot 3 (1.154.0), la liste des factures : `listeFactures` et `actionsFacture` (`v10/app.js`), `plateforme/liste.css` ;
  la tuile « À signer » et les états El Fatoora en colonne viennent du point de contact (`dessinerASigner`, `poserEtat`,
  `etatsTtnDe`). Lot 4 (1.155.0), la facture : `routes.doc` (`charte`, `teteCharte`, `champsCharte`, `gesteCharte`,
  `friseCharte`, `dessinerAvant`, `dessinerBandeaux`, `bandeauEmise`, `choisirPassage`, `prixCalculCharte`,
  `coupureEmission`), `plateforme/piece.css` ; la FODEC (0177, `ventes.ligne.fodec`, `ventes.piece.fodec`, règle
  `fodec.taux`, `moteur/piece.ts` `tauxFodec`, compte `fodec` du plan, TEIF I-1603) ; au téléphone `dessinerLignesTel`,
  `feuilleLigne`, `feuilleAjoutTel`, `scannerCode` ; l'affichage compact par défaut sous 1 600 px (`barre.js`) ;
  la remise par ligne (0176, `ventes.ligne.taux_remise`, `moteur/piece.ts`),
  le seuil de la retenue (règle `retenue.seuil`) et le client de passage (`doc.passage`, le tiers du comptoir au serveur,
  `serveur/v10/dossier.ts`).
- **La mise en ligne** (briques 142-143, `docs/mise-en-ligne.md`, 05/10/2026) : le serveur d'essai est un VPS OVH en
  France (données inventées seulement), à `app.skanfact.tn`. **Personne ne s'y connecte** : il suit `main` tout seul
  (`exploitation/suivre.ts`, toutes les deux minutes) et installe la plus récente version que GitHub a vérifiée en
  vert ; un réglage du serveur passe par une tâche d'entretien (`exploitation/taches/NNNN-nom.sh`, une fois chacune).
  Son état se lit à `https://app.skanfact.tn/etat.json` (serveur d'essai seulement ; `/etat`, la page publique, partout).
  (1.106.0) **Deux branches, deux serveurs** (`docs/mise-en-ligne.md`, L) : le travail arrive sur `dev`
  (`dev.skanfact.tn`) ; `main` (`app.skanfact.tn`) ne reçoit qu'une version de `dev` passée par toutes les preuves
  (`tests/promouvoir.sh`).
  (1.107.0) **« Maintenance en cours »** (`docs/mise-en-ligne.md`, M ; `docs/console.md`, C24 bis) : le frontal la
  sert quand le programme ne répond pas (`exploitation/maintenance.html`, tâche 0012) ; la console ferme
  l'application aux clients pendant un geste risqué, et la rouvre (base 0164, `serveur/fermeture.ts`).
  (1.108.0) **Les pages à part dans la DA** (`commun/page-a-part.ts`, `docs/mise-en-ligne.md`, M bis) : les deux
  maintenances, la page d'état et le mot « sans JavaScript », d'un seul habit ; `node scripts/pages-a-part.ts` les écrit.
  (1.109.0) **Le carnet de crise** (`web/console/src/carnet.ts`, `docs/console.md` C24 ter) : un fichier hors ligne, écrit
  avec les textes de la console ; `node scripts/carnet-de-crise.ts` l'écrit hors de la console.
  (1.114.0) **La page d'état de secours** (`exploitation/guet-second/secours.ts`, `docs/mise-en-ligne.md` I quater) :
  `etat.skanfact.tn`, chez Cloudflare, dans le Worker du second guet ; elle répond quand SkanFact ne répond plus, et
  porte le mot de l'équipe (écrit avec la clé de secours).
  (1.113.0) **Les exercices de crise** (base 0166, `docs/console.md` C24 quater) : une fiche jouée à blanc, chronométrée,
  close par son compte rendu ; le lancement (J5) veut les dix réussies dans l'année.
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
