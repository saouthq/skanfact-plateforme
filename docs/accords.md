# L'accord d'un responsable au-delà de l'encours

*30/09/2026, brique 98. Le cadrage fait foi : `docs/cadrage/03-droits.md` D11 et § 2.3 (« Vendre au-delà de
l'encours autorisé d'un client : P, A ; C et K : accord »), `docs/cadrage/14-fonctions-et-integrations.md` § 3.2
du dépôt `skanfact`. Décisions prises par délégation, le 30/09/2026.*

## Ce que fait la brique 98 (le serveur)

**A1. Le réglage.** L'entreprise choisit ce qui se passe au-delà de l'encours autorisé d'un client
(`creditLimit`, brique 91) : avertir seulement (par défaut : la valeur qui ne change rien, D11), ou **demander
l'accord d'un responsable** (`encoursAccord` sur sa fiche).

**A2. Le serveur calcule lui-même.** À l'émission d'une facture, le serveur recalcule le dépassement avec **le
même code que l'écran** (`depassementEncours` de `core.js`, chargé comme `teif.js`), sur le dossier qu'il lit en
base : la fiche du client, ses factures, ses bons. Seule la pièce à émettre vient de la demande, et son net à
payer est de toute façon vérifié à l'émission. Deux chemins, une règle.

**A3. Sans accord, pas d'émission au-delà** pour qui n'est ni propriétaire ni administrateur. Le refus dit ses
chiffres (« Chantier Ennasr dépasserait son encours autorisé de 156,680 DT (799,680 DT déjà dus, 357,000 DT
pour cette facture, 1 000,000 DT autorisés) ») et le geste qui débloque (`ventes.accord.demander`). Le
propriétaire et l'administrateur émettent sans accord.

**A4. L'accord se demande, se donne ou se refuse** (`ventes.accord`) : la demande garde les chiffres du serveur ;
redemander le même montant ne la double pas ; seul un responsable décide (geste `ventes.accord.donner`), jamais
sa propre demande, et une demande décidée ne change plus. Un accord couvre **un montant** : la pièce grossie
après l'accord redemande l'accord. La dernière décision prise sur la pièce compte (un refus après un accord
l'annule).

**A5. La pièce porte les deux noms** (`accordEncours` : qui a demandé, qui a accordé, quand), et la table garde
la trace de chaque demande (qui, quand, pourquoi le refus).

**A6. Les seuils se règlent par un responsable, jusque dans la base.** Le plafond d'un client et le réglage de
l'entreprise ne changent que par le propriétaire ou un administrateur : un déclencheur de la base le refuse à
toute autre personne, même en écrivant par-dessus les routes.

## Ce qui part au serveur

Une demande d'accord : la pièce (sa clé), son client (sa clé), trois montants calculés par le serveur (la pièce,
l'encours sans elle, le plafond), qui demande, qui décide, quand, le motif d'un refus.

## Les tests

- `tests/v10/accords.test.ts` : le refus avec ses chiffres, la demande (sans doublon), le commercial qui ne décide
  pas, le refus puis l'accord, l'accord qui ne couvre pas un montant plus grand, les deux noms sur la pièce, la base
  qui refuse de réécrire une décision ou de faire naître un accord ; le propriétaire qui émet sans accord, sa propre
  demande qu'il ne décide pas, l'entreprise sans le réglage, le plafond et le réglage refusés à un commercial en base.
- 15 preuves (`tests/preuves.sh`, brique 98).

## Ce que fait la brique 100 (les écrans, 30/09/2026)

`web/v10/accords.txt`, par délégation :

**E1. Le réglage** : Paramètres → Documents → Règles de facturation, « Au-delà de l'encours d'un client : l'accord
d'un responsable » (oui ou non ; non par défaut). La case est grisée pour qui n'est ni propriétaire ni
administrateur (le dossier le dit à l'écran : `droits.responsable`), comme l'encours autorisé sur la fiche d'un
client : l'écran ne propose pas ce que la base refuserait.

**E2. Avant le geste** : l'avertissement de l'encours dit au commercial qu'au-delà une facture demande l'accord (et
non plus « émets quand même »), ou que l'accord est déjà donné.

**E3. Le refus propose le geste qui débloque** : quand le serveur refuse l'émission (`ventes.accord.demander`), une
question reprend ses chiffres et propose « Demander l'accord ». La facture reste en brouillon (enregistrée).

**E4. La facture dit où en est sa demande** (bandeau) : en attente, accordée (qui, quand, pour combien), refusée
(qui, quand, son mot). Le responsable y trouve ses deux gestes : « Accorder », « Refuser… » (avec un mot, facultatif).

**E5. L'accueil le dit** : au responsable, les demandes qui attendent sa décision (en premier sur la page) ; à qui a
demandé, la décision de la semaine tant que la facture est encore en brouillon, avec « Ouvrir la facture ».

**E6. La page « Demandes d'accord »** (`#/accords`) : celles qui attendent d'abord, puis les 50 dernières décidées ;
une pièce faite sur un autre poste depuis l'ouverture de celui-ci le dit (« pas encore sur ce poste ») avec
« Recharger ».

Rien de plus ne part au serveur : la demande envoie la pièce, comme l'émission.

Tests : `tests/web/accords.test.ts` (Nadia règle, Karim demande, Nadia refuse depuis la facture, Karim redemande,
Nadia accorde depuis la page, Karim émet ; la pièce porte les deux noms), `tests/v10/droits-dossier.test.ts`
(`responsable`). 9 preuves (`tests/preuves.sh`, brique 100).

## Ce que fait la brique 103 : l'accord au-delà d'une remise (01/10/2026)

D11 (`03`) : « une remise, une vente au-delà de l'encours d'un client, une commande fournisseur, un retour ». Par
délégation :

**R1. Le réglage** : Paramètres → Documents, « Remise permise sans accord (%) » ; vide, pas de seuil (la valeur qui ne
change rien). La base le réserve au propriétaire et à l'administrateur (`0054`, comme l'encours autorisé).

**R2. Le serveur lit le seuil en base** et compare la remise globale de la facture (`discountRate`) ; au-delà, sans
accord, un commercial n'émet pas : « Café El Walima : la remise de 15 % dépasse les 10 % permis sans accord… », avec
le même geste qui débloque. Au seuil même, rien à demander. Le propriétaire et l'administrateur remisent sans accord.

**R3. La demande porte sur la remise** (`ventes.accord`, geste `remise`, taux et seuil en centièmes de pour cent,
figés comme le reste de la demande) ; un accord couvre **ce taux**, pas plus. Une facture qui dépasse à la fois la
remise et l'encours demande la remise d'abord, puis l'encours. La pièce émise porte `accordRemise` (les deux noms).

**R4. Les écrans** : l'avertissement le dit avant d'émettre ; la facture, l'accueil et la page « Demandes d'accord »
disent « une remise de 15 % (10 % permis sans accord) » à côté des demandes d'encours.

Tests : `tests/v10/accords.test.ts` (la remise), `tests/web/accords.test.ts` (Nadia règle, Karim demande, Nadia accorde
depuis la facture, Karim émet). 12 preuves.

## Reste connu (les briques suivantes)

- Un prix de ligne baissé sous celui du catalogue est aussi une remise : il n'est pas encore compté (D11).
- Les autres seuils de D11 : la commande fournisseur, le retour.

- **Brique 99, les droits geste par geste dans le dossier** : faite (`docs/droits-dossier.md`).
- Les autres postes ne se mettent pas à jour tout seuls : une demande faite ailleurs se voit en rouvrant la page
  (ou « Recharger »). La notification à distance viendra avec les avis (étape suivante).
- Le « code d'un responsable » sur le même poste (la caisse, étape 4) et la notification à distance.
