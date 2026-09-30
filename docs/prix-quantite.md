# Le prix par quantité

*30/09/2026, brique 92. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 du dépôt
`skanfact` (au lancement : « prix par quantité (à partir de 10, de 100…) »). Décisions prises par délégation,
le 30/09/2026.*

## Ce que fait la brique 92

**Q1. Les paliers se saisissent sur la fiche de l'article** : « Prix par quantité », comme on le dirait :
« 10 : 20,500 ; 100 : 19 » (20,500 à partir de 10, 19 à partir de 100 ; sous 10, le prix unitaire). Ils se
lisent et se trient (`lirePaliers`) ; un palier illisible, nul ou en double se refuse en disant lequel, le
curseur dans le champ. Ils sont en dinars, comme le prix de l'article.

**Q2. Sur un devis ou une facture, la ligne d'un article suit le palier que sa quantité atteint**
(`prixCataloguePourQuantite`) : 12 sacs à 20,500, 150 à 19. Dans une autre devise, le prix du palier se
convertit au taux de la pièce, comme tout prix du catalogue. Choisir un article sur une ligne qui a déjà une
quantité prend le prix de son palier.

**Q3. Un prix tapé est une décision** : dès qu'on tape le prix d'une ligne, la quantité ne le change plus
(`prixManuel`). Choisir de nouveau l'article le rend au palier.

## Ce qui part au serveur

Un champ de plus sur un article du catalogue (`paliers`) et un sur une ligne (`prixManuel`), dans le dossier.
Rien ne change de ce que le serveur tient d'une facture émise : le prix est celui de la ligne.

## Les tests

- Le moteur (`tests/v10/prix-quantite.test.ts`) : le palier atteint (au seuil exact, entre deux, au-delà,
  une quantité à décimales), un palier sans prix ignoré, ce qu'on tape (virgules, espaces de milliers, désordre),
  les refus.
- À la souris (`tests/web/prix-quantite.test.ts`) : le refus d'un palier illisible, les paliers enregistrés,
  la ligne qui suit 12 puis 150 sacs (2 850 HT), puis le prix tapé que la quantité ne change plus. Deux écrans
  regardés.
- 8 preuves (`tests/preuves.sh`, brique 92).

## Reste connu

- Les paliers ne valent que pour la vente (pas pour les achats), et ne dépendent pas du client : le **prix
  par client ou par catégorie** (14 § 3.2, `01` § 5) est une brique suivante.
- La caisse ne suit pas encore les paliers.
- La ligne ne dit pas qu'elle est « au prix de 100 et plus » : **À VÉRIFIER** avec des commerçants si
  l'imprimé doit le dire.
