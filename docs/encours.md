# L'encours autorisé d'un client

*30/09/2026, brique 91. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 du dépôt
`skanfact` (au lancement : « Encours autorisé par client : au-delà, SkanFact avertit ou demande l'accord d'un
responsable »). Cette brique fait l'avertissement ; l'accord d'un responsable viendra avec les droits geste par
geste. Décisions prises par délégation, le 30/09/2026.*

## Ce que fait la brique 91

**E1. Le plafond se saisit sur la fiche du client** : « Encours autorisé (DT) », en dinars ; vide, pas de
plafond (rien n'est jamais averti).

**E2. L'encours d'un client** (`encoursClient`, dans le moteur de la v10) : le reste à payer de ses factures
émises (ni brouillon ni annulée), ramené en dinars, **plus** ce qui lui est livré sans être facturé (ses bons
de livraison à facturer, toutes taxes comprises, par la fonction de la brique 86). Livrer, c'est déjà faire
crédit.

**E3. Émettre au-delà se dit AVANT** : dans la fenêtre « Émettre la facture … ? », avec les chiffres
(« Chantier Ennasr dépasserait son encours autorisé de 157,680 DT : il doit déjà 799,680 DT (factures non
réglées et bons livrés à facturer), cette pièce en ajoute 358,000 DT, pour 1 000,000 DT autorisés »). La
personne décide : « Émettre quand même » émet, par le serveur, comme toute facture. Une facture tirée de bons
déjà comptés comme livrés ne les compte pas deux fois (`depassementEncours`).

**E4. La page du client le dit** : sous ses cartes, « Encours : … sur … autorisés, dont … livrés à facturer »,
en orange et « dépassé de … » au-delà du plafond.

## Ce qui part au serveur

Un champ de plus sur la fiche du client, dans son dossier : `creditLimit` (en dinars).

## Les tests

- Le moteur (`tests/v10/encours.test.ts`) : l'encours (un règlement partiel, une facture en euros, un bon à
  facturer, ni brouillon ni autre client), le dépassement et ses chiffres, sous le plafond, la facture d'un bon
  qui ne le compte pas deux fois (plafond serré à 1 200 pour que ça se voie), le client sans plafond.
- À la souris (`tests/web/encours.test.ts`) : le plafond saisi sur la fiche, l'encours sur la page du client,
  l'avertissement dans la fenêtre d'émission, « Émettre quand même », puis « dépassé ». Deux écrans regardés.
- 9 preuves (`tests/preuves.sh`, brique 91).

## Reste connu

- **L'accord d'un responsable** au-delà du plafond (14 § 3.2, `03-droits.md` § 1) : il viendra avec les droits
  appliqués geste par geste. Aujourd'hui, qui peut émettre peut émettre quand même.
- Un **bon de livraison** s'émet par son statut, sans cette fenêtre : le livrer au-delà du plafond n'est pas
  encore averti (l'encours le compte, la page du client le dit).
- La commande d'un client (le bon de commande reçu) n'avertit pas non plus.
- **À VÉRIFIER** avec des commerçants : faut-il compter aussi les chèques remis mais pas encore encaissés, ou
  les effets à échéance ?
