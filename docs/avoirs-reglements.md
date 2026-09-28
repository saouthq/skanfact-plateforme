# Brique 29 : l'avoir et les règlements de vente par le serveur

*Conception du 28/09/2026. Ce document dit ce que la brique fait, pourquoi, et ce qui la prouve.*

## Où on en est avant la brique

- La facture de la v10 s'émet par le serveur (brique 28) : numéro de la série FAC, net à payer
  vérifié au millime de l'écran, pièce scellée.
- **L'avoir** : le serveur le refuse (`ventes.seule_facture`). La v10 ne peut donc pas corriger
  une facture émise sur la plateforme.
- **Les règlements** : ils vivent dans la facture du dossier (`documents[].payments`), comme dans
  la v10. Le serveur les enregistre sans rien en vérifier ni en garder la trace.
- **« Marquer annulée »** : la v10 le permet ; le cadrage l'interdit (`01` § 7, validé le
  28/09/2026 : une facture émise ne s'annule jamais, un avoir total la solde et « annulée » se
  déduit).
- **La caisse** : un ticket est une facture numérotée sur l'ordinateur ; le serveur la refuse, et
  l'écran finit sur « Rien n'a été enregistré ».

## Ce que la brique fait

### 1. L'avoir s'émet par le serveur

- Migration `0012` : `ventes.piece.corrige` (la facture qu'un avoir corrige ; seul un avoir en a
  une). Posée sur le brouillon, elle est scellée avec l'avoir à l'émission (elle n'entre dans le
  contenu scellé que pour un avoir : les empreintes des factures déjà émises ne changent pas).
- `emettre` (serveur/ventes/pieces.ts) émet une facture **ou un avoir** ; chaque pièce prend un
  numéro dans une série de **son type** (un avoir ne peut plus prendre un numéro FAC). Un avoir
  exige sa facture : émise, de la même entreprise, du même client, dans la même devise. Le geste
  `ventes.avoir.emettre` est déclaré au tableau des droits : propriétaire et administrateur
  (`03` § 2.1 : le commercial prépare l'avoir, il ne l'émet pas).
- Dans la v10 : l'avoir s'émet par `bridge.emettre`, comme la facture (l'adaptation existe déjà) ;
  le pont prend la route `POST /dossier-v10/emettre-avoir`. Le serveur retrouve la facture visée
  (`creditOf`) dans le dossier et sur le serveur, numérote dans la série **AVO** (celle de la v10,
  créée au premier avoir), vérifie le net à payer de l'écran au millime, et rend l'avoir « émis ».
- Scellés en plus dans le dossier : `creditOf` (à quelle facture l'avoir se rattache) et
  `creditReason` (le motif imprimé). Sans eux, un avoir émis pourrait changer de facture sans trace.

### 2. Les règlements sont tenus par le serveur

- Migration `0012` : `ventes.reglement` : la facture, la date (un jour du calendrier), le montant
  **en entier dans l'unité de la devise de la facture** (négatif : un remboursement), le cours du
  jour s'il y en a un, le mode, le compte, la référence, la note, et l'identifiant que la v10 lui a
  donné (`ref_v10`, unique par entreprise). Sécurité par ligne forcée ; la base refuse un
  règlement sur autre chose qu'une facture émise de la même entreprise.
- À chaque enregistrement du dossier, pour une facture émise, le serveur **vérifie** chaque paiement
  et **tient sa table au même état**, dans la même transaction : un paiement nouveau s'insère, un
  paiement modifié se met à jour, un paiement retiré s'efface ; **chaque geste laisse sa trace**
  (inaltérable). Un paiement refusé fait refuser tout l'envoi : rien n'est écrit.
- Refusé (avec sa phrase) : un paiement sur un brouillon ou sur un avoir ; un montant nul ; une date
  qui n'est pas un jour ; **un montant plus précis que sa devise** (un euro se compte au centime ;
  la v10 acceptait le millième d'euro) ; un cours illisible ; un identifiant en double.
- L'écran dit le refus des décimales **sur son champ**, avant d'enregistrer (adaptation de
  `paymentForm`), au lieu de le découvrir à l'enregistrement.
- La lecture d'une facture par l'API (`GET /ventes/:piece`) donne ses règlements, ses avoirs, le
  **reste à payer**, le **statut** et la **retenue née de chaque règlement**, calculés par le moteur
  (`moteur/reglements.ts`, comparé à la v10 depuis l'étape 1). Deux chemins, un chiffre : le reste
  du serveur est celui que l'écran de la v10 affiche (test à la souris).

### 3. « Marquer annulée » disparaît

L'adaptation retire « Marquer annulée… » et « Rétablir » de l'écran d'une facture émise ; le
serveur refuse le statut « annulée » sur une facture émise. On corrige par un avoir
(« Corriger par un avoir… » reste). Une facture que ses avoirs couvrent en entier s'affiche
« annulée » : la v10 le déduit déjà.

### 4. La caisse dit qu'elle n'est pas encore en ligne

« Encaisser » et le retour d'un ticket se refusent avec leur phrase (rien n'est vendu, rien n'est
écrit), jusqu'à l'étape 4 (la caisse et son homologation).

## Décisions (par délégation, 28/09/2026)

- **D1.** Un avoir se numérote dans la série AVO (préfixe de la v10), créée au premier avoir.
- **D2.** Un règlement se modifie et se supprime comme dans la v10 (tant que sa période n'est pas
  clôturée) ; chaque geste laisse sa trace. Quand les écritures seront tenues par le serveur
  (étape suivante), une modification passera par une contre-passation dans le journal.
- **D3.** Un règlement se compte à l'unité de sa devise (le centime pour l'euro). Écart avec la v10,
  qui acceptait le millième d'euro.
- **D4.** Pas de plafond ajouté par le serveur : un règlement au-delà du reste (trop-perçu) et un
  avoir au-delà de la facture restent possibles, comme dans la v10, qui prévient avant.
- **D5.** Un avoir n'annonce pas encore d'avis d'événement (seule « facture.emise » existe) ; il
  viendra avec les autres événements de l'API.

## Ce qui reste hors de la brique

Les écritures comptables des règlements et des avoirs tenues par le serveur (étape suivante) ; le
règlement groupé (la v10 n'en a pas) ; le compte de trésorerie tenu par le serveur ; la caisse
(étape 4) ; les règlements ouverts à d'autres rôles que propriétaire et administrateur (le dossier
v10 ne s'ouvre qu'à eux).

## Ce qui la prouve

- `tests/v10/dossier.test.ts` : l'avoir émis par le serveur (numéro AVO, lien scellé et vu au
  contrôle de la chaîne s'il est trafiqué, refus : sans facture, facture non émise, par la route de
  la facture) ; « annulée » refusé et déduit d'un avoir total ; les règlements tenus au même état
  que le dossier (ajouter, modifier, retirer, trace), la retenue née de chacun (8,042, 4,564, puis
  16,083 en tout, calculés à la main), chaque refus sans rien écrire ; la base refuse elle-même un
  règlement sur une pièce qui n'est pas une facture émise.
- `tests/web/parcours.test.ts` : à la souris, un paiement partiel (un montant trop précis refusé
  sur son champ) puis un avoir sur la facture émise ; le reste affiché par l'écran (237,095 DT)
  égale celui du serveur ; « Marquer annulée » n'existe plus ; « Encaisser » se refuse avec sa
  phrase, et rien n'est écrit.
- Chaque test est prouvé en réintroduisant son défaut (`tests/preuves.sh`).
