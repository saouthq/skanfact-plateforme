# Brique 30 : les achats et les règlements fournisseurs par le serveur

*Conception du 29/09/2026. Ce document dit ce que la brique fait, pourquoi, et ce qui la prouve.*

## Où on en est avant la brique

- La v10 sur la plateforme saisit ses achats (facture fournisseur, dépense, avoir, acompte) et ses
  fournisseurs dans son dossier (`purchases`, `suppliers`). Le serveur les garde **sans rien en
  vérifier ni en calculer** : pour lui, ce ne sont que des objets.
- Le moteur des achats existe depuis l'étape 1 (`moteur/achats.ts` : le calcul, l'imputation d'un
  avoir ou d'un acompte, le reste, le statut, les écritures), comparé à la v10 sur l'exemple de cinq
  ans et sur 20 000 achats tirés au hasard. Il n'était branché à rien.

## Ce que la brique fait

### 1. Les tables des achats (migration `0013`)

- `achats.piece` : la nature, le fournisseur (`socle.tiers`), **son** numéro (l'entreprise ne
  numérote rien : c'est la pièce du fournisseur), la date, l'échéance, la devise et son cours, le taux
  de retenue, les frais, « récupérer la TVA », la pièce à laquelle un avoir ou un acompte est
  rattaché (`lie`), et les montants calculés par le moteur, **en entiers dans l'unité de la devise
  de la pièce**.
- `achats.ligne` : désignation, quantité (millièmes), prix (six décimales), taux de TVA,
  destination (charge, stock, immobilisation), TVA non déductible, et le HT, la TVA et le TTC de la
  ligne.
- `achats.reglement` : le jumeau de `ventes.reglement` (0012).
- Sécurité par ligne forcée sur les trois ; la base refuse elle-même un fournisseur d'une autre
  entreprise, un rattachement à autre chose qu'une facture ou une dépense de la même entreprise, un
  règlement qui change de pièce. Les trois tables partent avec l'export d'une entreprise.

### 2. Chaque enregistrement du dossier tient les achats au même état

Une fois **tout** l'envoi écrit (une facture et son avoir, un achat et son fournisseur arrivent
souvent ensemble), `serveur/v10/achats.ts` :

1. tient la fiche de chaque fournisseur changé (rôle « fournisseur ») ;
2. lit et vérifie chaque achat **qui a vraiment changé** (une pièce qui n'a fait que changer de
   place dans la liste ne se recalcule pas et ne laisse pas de trace), le calcule par le moteur, et
   tient sa pièce, ses lignes et ses règlements, chaque geste avec sa trace
   (`achats.piece.enregistrer`, `modifier`, `supprimer`, `achats.reglement.*`) ;
3. pose les rattachements quand toutes les pièces de l'envoi existent ;
4. supprime ce qui a été retiré, sauf une pièce à laquelle une autre reste rattachée (D2) ;
5. vérifie que chaque rattachement touché relie une pièce à une facture ou une dépense de **sa**
   devise (D3).

Un seul refus, et rien de l'envoi n'est écrit. La tenue des règlements (`serveur/reglements.ts`) et
la lecture des paiements (`serveur/v10/lecture.ts`) sont **partagées** avec les ventes : une seule
façon de faire, deux côtés.

### 3. L'API lit un achat comme l'écran

- `GET /v1/entreprises/:e/achats` : la liste, la plus récente d'abord, page après page (`nature`
  pour n'en voir qu'une sorte), avec le reste et le statut de chacun.
- `GET /v1/entreprises/:e/achats/:piece` : les lignes, les montants dans la devise de la pièce et
  **en dinars** (signés : un avoir retire), ce qu'il doit encore, ce que ses pièces rattachées en
  couvrent, son statut, la retenue due, celle déjà opérée, et **la retenue née de chaque règlement**.
- Un seul calcul pour les deux (`serveur/achats/etat.ts`, en lot pour une page entière) : la liste
  et la lecture disent le même chiffre.
- Le geste `achats.pieces.voir` : propriétaire, administrateur, comptabilité interne ; la lecture le
  voit ; le commercial non (`03` § 2.1).

### 4. Dans l'écran de la v10 (trois adaptations)

- Un règlement fournisseur plus précis que sa devise se refuse **sur son champ**, avant
  d'enregistrer (comme le paiement d'une vente, brique 29).
- Des frais d'achat plus précis que leur devise, de même.
- « Supprimer » un achat auquel un avoir ou un acompte est rattaché le dit **avant** la question
  « Supprimer ? », avec ce qu'il faut faire.

### 5. Au passage : la liste des factures de vente

Elle annonçait « reste = net à payer » : une phrase que rien ne tenait depuis que les règlements
existent (brique 29). Elle retranche maintenant les règlements et les avoirs, par la même fonction
que la lecture d'une facture.

## Décisions (par délégation, 29/09/2026)

- **D1.** Un achat se modifie et se supprime comme dans la v10 (tant que sa période n'est pas
  close) ; chaque geste laisse sa trace. Quand les écritures seront tenues par le serveur, une
  modification passera par une contre-passation.
- **D2.** Un achat auquel un avoir ou un acompte est rattaché ne se supprime pas : on le détache
  d'abord. *Écart avec la v10*, qui le laissait faire : l'avoir restait « imputé » à une facture
  qui n'existait plus, et ne se déduisait plus de rien.
- **D3.** Un avoir ou un acompte se rattache à une facture ou une dépense **de sa devise** (l'éditeur
  de la v10 le refuse déjà depuis la 10.2.0 ; le serveur le garantit).
- **D4.** Les nombres au format du moteur : quantité à trois décimales, prix à six, taux à quatre ;
  frais et règlements à l'unité de la devise (le centime pour l'euro). *Écart avec la v10*, qui
  acceptait le millième d'euro.
- **D5.** Un achat en devise porte son taux de change (l'éditeur de la v10 l'exige déjà) : sans lui,
  la TVA déductible et les charges compteraient une unité de la devise pour un dinar.
- **D6.** « Récupérer la TVA » : la valeur de la pièce ; sans elle, le régime de l'entreprise le jour
  de l'enregistrement (forfaitaire et exonéré ne la récupèrent pas). La pièce le garde : un
  changement de régime ne réécrit pas les achats d'avant.
- **D7.** Un fournisseur retiré du dossier garde sa fiche au serveur (la v10 ne retire qu'un
  fournisseur sans achat, et la trace peut encore le nommer).

## Ce qui reste hors de la brique

Les écritures des achats et des règlements tenues par le serveur (étape suivante) ; les routes pour
enregistrer un achat ou régler un fournisseur par l'API (les gestes du tableau `03` § 2.1 viendront
avec elles) ; le certificat de retenue ; la comptabilité interne qui ouvre la v10 (le dossier entier
ne s'ouvre qu'au propriétaire et à l'administrateur) ; un premier enregistrement de plus de 500 objets,
qui part en plusieurs paquets (un achat pourrait arriver avant son fournisseur : il se refuserait,
avec sa phrase) ; un achat enregistré dans un dossier AVANT la brique n'est repris par le serveur qu'à
son prochain changement (la plateforme n'a pas encore de données réelles).

## Ce qui la prouve

- `tests/v10/achats.test.ts` :
  - les **181 achats de l'exemple de cinq ans** (176 règlements, dont des retenues), envoyés au
    serveur, s'y calculent au millime de l'écran de la v10 : montants dans leur devise et en dinars,
    reste, statut, retenue de chaque règlement ;
  - **200 achats tirés au hasard** (devises, TVA non déductible, destinations, frais, retenue) : les
    mêmes montants qu'à l'écran ;
  - modifier, supprimer, la trace de chaque geste, une pièce seulement déplacée qui ne se recalcule
    pas ; le régime de l'entreprise quand la pièce ne dit rien, gardé sur la pièce ;
  - un avoir et un acompte rattachés, calculés à la main (reste 421,927) ; la suppression refusée ;
    une autre devise refusée ; détacher puis supprimer dans le même envoi ;
  - chaque refus (taux manquant, frais trop précis, ligne illisible, date, fournisseur absent,
    règlement trop précis ou nul) sans rien écrire ;
  - la liste page après page, le même reste que la lecture ; le commercial ne la voit pas ;
  - la base refuse elle-même ce qui mélangerait deux entreprises.
- `tests/web/parcours.test.ts` : à la souris, une facture fournisseur (des frais trop précis refusés
  sur leur champ), un règlement (trop précis, refusé sur son champ), un avoir depuis la liste ; le
  reste de l'écran (221,927 DT) égale celui du serveur ; la facture ne se supprime pas sous son avoir.
- Chaque test est prouvé en réintroduisant son défaut (`tests/preuves.sh`).

---

# Brique 84 : lire une facture d'achat en photo ou en PDF, sur nos serveurs

*Conception du 30/09/2026 (par délégation ; cadrage `14` § 2.3, `12` § 3 et § 10 point 7, `03` § 2.3).*

La v10 envoyait la photo d'une facture à un service à l'étranger, avec une clé saisie dans les Paramètres ;
cette lecture était en pause depuis la 8.7.0. Sur la plateforme, **le serveur de SkanFact lit lui-même**, en
Tunisie : aucune image ne sort.

## Ce que fait la brique

**L1. Le moteur, sur nos serveurs** (`serveur/achats/lecteur.ts`). Un PDF écrit par un logiciel porte son
texte : Poppler le lit tel quel (`pdftotext`, rien n'est deviné). Une photo (JPEG, PNG, WEBP), ou un PDF
scanné page par page (`pdftoppm`, trois pages au plus), passe à **Tesseract en français** (5.3.4). Le type
d'un fichier se lit sur ses premiers octets, jamais sur son nom. Le fichier vit dans un dossier temporaire le
temps de la lecture, puis s'efface : il n'est **ni gardé, ni écrit dans le journal**. Chaque programme est
lancé sans interpréteur de commandes, avec sa limite de temps (60 secondes).

**L2. La file de la lecture.** Au plus deux lectures à la fois par serveur (`SKANFACT_LECTURES`), les suivantes
attendent leur tour (huit au plus, 90 secondes au plus) ; au-delà : « le lecteur de factures est occupé :
réessaie dans une minute ». Un serveur sans Tesseract (avec le français) ou sans Poppler n'a pas la lecture,
et le dit (le bouton ne paraît pas ; l'API répond « pas branchée »). À la mise en service, la lecture tournera
sur son propre serveur, sans accès à la base (`09` § 4).

**L3. Une proposition, jamais un enregistrement** (`POST /entreprises/:e/achats/lecture`, geste
`achats.facture.lire` : propriétaire, administrateur, comptabilité interne, `03` § 2.3). La réponse dit le
fournisseur, son matricule, le numéro, la date, l'échéance, l'objet, la devise, le timbre (et le FODEC), le
hors-taxes, le total et les lignes (quantité, prix, taux) ; les montants en **texte exact** (01 R3). Rien n'entre
dans les données : la fenêtre de la v10 (« Ce que SkanFact a lu ») les fait relire, puis « Utiliser ces
informations » pré-remplit l'achat, qui ne s'enregistre qu'à « Enregistrer ».

**L4. Chaque champ dit où il a été lu** (`ou`) : sous chaque champ de la fenêtre, « Lu : « … » », la ligne de la
pièce (et celle des étiquettes, quand les valeurs sont écrites sous elles) ; sous le total des lignes, la ligne
du hors-taxes. Elle se lit en entier, même sur un téléphone.

**L5. Deux chemins, un chiffre** (`serveur/achats/lecture-facture.ts`). Le total se **recompte** depuis les
montants lus (hors taxes, TVA taux par taux, timbre, FODEC) : s'il tombe sur le total lu (le TTC, ou le net à
payer retenue rajoutée), la fenêtre le dit ; sinon, elle dit les deux chiffres et « SkanFact ne choisit pas :
vérifie ces montants sur la pièce » — le total lu reste celui de la pièce, rien n'est « corrigé ». Chaque TVA
se recompte aussi sur sa base ; un total illisible, ou seul lisible, se dit.

**L6. Aucun taux supposé.** Un taux se lit sur la pièce, tel qu'elle l'imprime (aucun taux n'est écrit dans le
code du serveur). Une ligne sans taux lisible le reçoit :
- de la seule répartition des lignes qui refait EXACTEMENT les bases annoncées par la pièce (plusieurs
  répartitions possibles, ou aucune : rien n'est choisi) ;
- sinon, la remarque le dit, avec les bases que la pièce annonce ; la fenêtre de la v10 met alors la ligne
  au taux d'une ligne neuve, et le dit (un taux non lu n'est **jamais** une TVA à 0 % : défaut de la v10,
  corrigé en passant) ;
- un taux lu que SkanFact ne propose pas se dit aussi.
Sans détail de lignes lisible, un seul hors-taxes et une TVA qui tombe juste sur un nombre entier de
pour-cent donnent une ligne à ce taux, et la remarque le dit.

**L7. Les lignes de la pièce.** Le tableau se reconnaît à son en-tête (même coupé sur deux lignes) ; chaque
rangée se lit par « quantité × prix = total » : les traits du tableau (« | ») ne sont pas des mots, une unité
(« kg ») reste dans la désignation, une remise par ligne donne le prix net, une colonne « Remise 0 % » n'est
pas une TVA à 0 %, « 1 500,000 » est mille cinq cents. Une quantité que le moteur n'a pas lue se retrouve quand
un vrai prix (écrit avec ses décimales) divise exactement le total. Si les lignes lues ne refont pas le
hors-taxes, la proposition est **une ligne par taux**, depuis les bases lues, et la remarque le dit.

**L8. Le fournisseur.** Son matricule : le premier de la pièce qui **n'est pas celui de l'entreprise** (la fiche
de l'entreprise le donne au serveur) ; la v10 reconnaît le fournisseur par ce matricule, sinon par son nom,
et ne crée jamais une fiche toute seule. Une pièce qui porte un autre matricule que le nôtre (et pas le nôtre)
se dit : « vérifie qu'elle t'est bien adressée ».

**L9. Dans l'écran de la v10** (`web/v10/lecture-photo.txt`, huit adaptations ; `web/public/plateforme/pont.js`).
« Lire une photo… » paraît sur un **achat neuf** quand le serveur sait lire (une pièce saisie ne se relit pas
par-dessus, comme la facture électronique) ; le sélecteur propose l'appareil photo sur un téléphone. Pas de
question avant la lecture (elle existait pour un service à l'étranger) ; le bouton attend la réponse. Un échec
se dit avec la phrase du serveur, sans proposer de joindre la photo (les pièces jointes ne sont pas encore en
ligne ; la lecture n'essaie pas non plus de l'y ranger). Les Paramètres de la clé d'un service étranger
restent cachés.

**L10. Sur un téléphone** (`telephone.css`). Photographier une facture est un écran du quotidien (`14` § 2.6) :
l'écran d'achat entre dans l'instrument des écrans du téléphone (`tests/web/rendu.test.ts`) ; le tableau des
lignes d'un achat défile dans son cadre, jamais la page, et ses cases font la taille d'un doigt.

## Le seuil, et le banc qui le mesure

Le cadrage fixe le seuil d'avance : le moteur est retenu s'il lit juste **le matricule, la date et le total sur
au moins 9 factures sur 10** d'un lot de vraies factures tunisiennes, prêtées avec l'accord de leurs
propriétaires. Le banc est prêt : `npm run banc:lecture -- /chemin/du/lot [matricule de l'acheteur]`
(`banc/lecture/mesurer.ts`), avec un `attendu.json` écrit à la main ; il dit, facture par facture, ce qui est
juste et ce qui ne l'est pas, puis le verdict (code 0 si le seuil est atteint). Un lot vide ne passe pas. **Le
lot ne vient jamais dans le dépôt** (une vraie facture ne s'y met pas).

Sur nos six pièces d'essai (inventées : `tests/donnees/lecture`, fabriquées par `fabriquer.mjs` — une facture
de la v10 en PDF, photographiée de travers et floue, scannée ; un fournisseur de matériaux ; un bureau
d'études avec retenue ; un fournisseur étranger en euros) : **6 sur 6**.

**À VÉRIFIER** : la mesure sur le vrai lot (tant qu'elle n'est pas faite, la lecture de photo ne s'annonce
pas : ni sur le site, ni dans les offres) ; PaddleOCR contre Tesseract sur ce même lot (`12` § 10, point 7) ;
les mentions de TVA propres à certains fournisseurs (FODEC compté avec le timbre, comme la lecture d'une
facture TEIF, À VÉRIFIER avec un comptable).

## Ce qui reste hors de la brique

Les pièces jointes en ligne (le fichier lu ne se range pas encore avec l'achat) ; le serveur de lecture à
part ; les factures en arabe (arabe abandonné, 28/09/2026) ; les tickets de caisse ; un modèle de facture
appris par fournisseur (la lecture d'une deuxième facture du même fournisseur ne profite pas de la première).

## Ce qui la prouve

- `tests/achats/lecture-facture.test.ts` : les cinq textes d'essai lus JUSTE, champ par champ, ligne par ligne,
  taux compris (la photo : deux quantités et deux taux perdus, retrouvés) ; et chaque règle sur un texte écrit
  pour elle (notre matricule lu le premier, un total faux, une TVA fausse, un total seul ou illisible, des lignes
  illisibles, un taux déduit ou jamais supposé, une répartition ambiguë, les étiquettes au-dessus des valeurs,
  une date de livraison, une pièce adressée à un autre, le FODEC, un texte qui n'est pas une facture).
- `tests/achats/lecture.test.ts` : le VRAI moteur sur la photo, le PDF et le scan ; rien ne reste sur le
  serveur, rien n'est enregistré ; le matricule de l'acheteur vient de la fiche ; un fichier qui n'est ni
  une photo ni un PDF (quel que soit son nom), ou de 11 Mo, se refuse avec sa phrase ; un serveur sans
  moteur le dit ; au-delà de la file, « occupé », et le créneau se rend ; un commercial ne lit pas.
- `tests/achats/banc-lecture.test.ts` : le banc lit les six pièces justes, et il sait dire non.
- `tests/v10/lecture-v10.test.ts` : dans la v10, un taux non lu n'est pas une TVA à 0 %.
- `tests/web/lecture-photo.test.ts` : à la souris, Nadia photographie la facture ; la fenêtre dit ce qui a
  été lu, où, et le total recompté ; enregistré, l'achat calculé par le serveur tombe **au millime** sur le
  total lu (332,222 DT) ; un fichier qui n'est pas une facture se refuse ; sur un téléphone, tout tient dans
  l'écran et le parcours va jusqu'à l'achat pré-rempli. Photos dans `dist/photos/lecture-*.png`.
- `tests/web/rendu.test.ts` : l'écran d'achat, au téléphone et à l'ordinateur.
- 44 preuves (`tests/preuves.sh`, brique 84) : chaque défaut remis fait tomber son test.
