# Les lots : numéro de lot et date de péremption

*30/09/2026, brique 97. Le cadrage fait foi : `docs/cadrage/02-modules.md` (module Stock : « lots ») et
`docs/cadrage/14-fonctions-et-integrations.md` (Stock au lancement) du dépôt `skanfact`. Décisions prises par
délégation, le 30/09/2026.*

## Ce que fait la brique 97

**L1. Un article se suit par lot** (« Suivre par lot (numéro et date de péremption) » sur sa fiche) : pour ce
qui se périme ou se rappelle. Cocher la case coche aussi « Suivi en stock » ; un article non suivi ne se suit
pas par lot.

**L2. Chaque entrée dit son lot** : la ligne d'achat d'un tel article (en destination « stock ») porte, sous sa
désignation, le numéro de lot et la date de péremption ; le stock de départ aussi (« Lot du départ »,
« Péremption du départ », figés une fois que des mouvements s'y appuient).

**L3. Chaque sortie dit de quel lot elle part** : sous la ligne d'une facture, d'un bon de livraison ou d'un
avoir, « Quel lot ? » propose les lots en stock, avec leur péremption et leur quantité. Avant l'émission,
SkanFact avertit (sans refuser) : une ligne sans lot (en conseillant le plus ancien qui n'est pas périmé), un
lot périmé à la date de la pièce, un lot qui n'en a pas assez. Une ligne laissée sans lot sort « sans lot ».

**L4. Le stock se lit lot par lot** : la page de l'article dit « Par lot : L-0901 8 pots (périme le 05/10/2026)
· L-0910 50 pots (…) », les lots qui périment le plus tôt d'abord ; son historique nomme le lot de chaque
mouvement. La péremption d'un lot est celle que son entrée a dite.

**L5. « À faire » prévient 30 jours avant** : « 2 lots périment dans les 30 jours », ou, s'il y en a de
périmés encore en stock, « 1 lot périmé encore en stock » (en alerte). Le geste ouvre l'article du premier.

## Ce qui part au serveur

Dans le dossier : `parLot` sur l'article, `initialLot` et `initialPeremption` pour son départ, `lot` et
`peremption` sur une ligne d'achat, `lot` sur une ligne de vente. Rien de plus.

## Les tests

- Le moteur (`tests/v10/lots.test.ts`) : le lot et la péremption des mouvements, le stock par lot aujourd'hui
  et avant l'achat, le lot conseillé avant et après une péremption, « À faire » (information puis alerte), les
  avertissements d'une pièce (sans lot, lot court, lot périmé).
- À la souris (`tests/web/lots.test.ts`) : le lot saisi sur l'achat, le stock par lot, « À faire », la
  facture qui avertit puis sort du lot choisi, l'historique, un nouvel article suivi par lot avec son départ.
  Deux écrans regardés.
- 17 preuves (`tests/preuves.sh`, brique 97).

## Reste connu

- La **réception** d'une commande fournisseur ne saisit pas encore le lot (l'achat direct, si).
- Les **transferts** entre dépôts et les **ajustements** manuels ne choisissent pas encore de lot ; le stock
  par lot est celui de toute l'entreprise, pas dépôt par dépôt.
- Le **ticket de caisse** ne choisit pas de lot (la caisse attend l'étape 4).
- Une ligne ne se partage pas toute seule entre deux lots : on la duplique (⧉) et on répartit la quantité.
- **À VÉRIFIER** avec des commerçants : 30 jours d'avance pour « À faire » conviennent-ils à tous les métiers
  (frais, pharmacie, cosmétique) ?
