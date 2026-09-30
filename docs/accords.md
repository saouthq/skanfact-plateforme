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

## Reste connu (les briques suivantes)

- **Brique 99, les droits geste par geste dans le dossier** : aujourd'hui, un commercial n'écrit rien dans le
  dossier (le geste « modifier le dossier » est réservé au propriétaire et à l'administrateur), et la première
  facture d'une entreprise (qui crée sa série de numéros) ne s'émet que par eux. Tant que ce n'est pas fait, le
  parcours d'un commercial à l'écran n'est pas possible.
- **Brique 100, les écrans** : le réglage dans les Paramètres, « Demander l'accord » dans le refus de l'émission,
  la liste des demandes pour le responsable (accorder, refuser), l'état de la demande sur la pièce.
- Le « code d'un responsable » sur le même poste (la caisse, étape 4) et la notification à distance.
- Les autres seuils de D11 (remise, commande fournisseur, retour).
