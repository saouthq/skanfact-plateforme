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
