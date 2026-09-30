# Les kits

*30/09/2026, brique 96. Le cadrage fait foi : `docs/cadrage/02-modules.md` du dépôt `skanfact` (module Stock :
« recettes et kits (un article composé sort ses composants) »). Décisions prises par délégation, le 30/09/2026.*

## Ce que fait la brique 96

**K1. Un kit se compose sur la fiche d'un article** (« Composé de (kit) ») : un pack, un coffret, un lot vendu d'un
bloc. On choisit les articles **suivis en stock** qui le composent et combien il en faut par kit (une quantité à
décimales : 0,5 m³). Un composant sans article, sans quantité, ou deux fois le même article se refuse en le disant.

**K2. Un kit n'a pas de stock à lui** : la case « Suivi en stock » et des composants ensemble se refusent. Il en
reste ce que ses composants permettent de faire (`kitsPossibles` : le plus petit des « stock ÷ quantité par kit »,
arrondi en dessous). Le catalogue le dit dans sa colonne Stock : « 9 possibles, kit de 2 composants ».

**K3. Vendre un kit sort ses composants** : une facture émise, un bon de livraison, un ticket de caisse sortent de
chaque composant sa quantité par kit × la quantité vendue ; un avoir les rentre. L'historique d'un composant nomme
le kit (« Vente, kit « Pack chape 10 m² » »). Rien d'autre ne change : c'est la ligne du kit qui s'imprime.

**K4. « Stock insuffisant » regarde les composants** (`lignesDeStock`) : 11 packs demandent 33 sacs, il y en a 31 →
l'avertissement parle du ciment.

**K5. Le coût de revient d'un kit** est celui de ses composants au coût moyen du jour (`coutDuKit`) : la fiche le
pose tant qu'on n'en a pas tapé un autre, et la marge se lit tout de suite.

## Ce qui part au serveur

Dans le dossier : la liste des composants d'un article (`composants`, [{ itemId, qty }]). Rien de plus.

## Les tests

- Le moteur (`tests/v10/kits.test.ts`) : un kit vendu puis en partie rendu, les mouvements de ses composants, les
  kits possibles aujourd'hui et à une date passée, le coût du kit, « stock insuffisant » sur un composant.
- À la souris (`tests/web/kits.test.ts`) : le pack composé sur sa fiche (refus d'un composant sans article, d'un
  article en double, d'un kit suivi en stock), le coût et la marge posés, « 13 possibles », la facture émise,
  l'historique du ciment, « 9 possibles ». Deux écrans regardés.
- 13 preuves (`tests/preuves.sh`, brique 96).

## Reste connu

- Un kit **s'achète par ses composants** : une ligne d'achat d'un kit n'entre rien en stock.
- Pas de kit dans un kit (seuls des articles suivis sont proposés comme composants).
- Les **recettes** du restaurant (vague 1) reprendront ce mécanisme, avec les quantités à décimales et les pertes.
- Le coût de revient posé ne suit pas tout seul les prix d'achat des composants : il se repose en ouvrant la fiche
  (s'il n'a pas été tapé à la main).
