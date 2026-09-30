# Les listes de prix, par client ou par catégorie de clients

*30/09/2026, brique 93. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 (au lancement :
« Prix par client ou par catégorie ») et `01-modele-de-donnees.md` § 5 (`liste_prix` : « prix par client ou par
catégorie de client, avec dates d'effet »), dans le dépôt `skanfact`. Décisions prises par délégation, le
30/09/2026.*

## Ce que fait la brique 93

**L1. Une page « Listes de prix »** (famille « Vendre ») : chaque liste a un nom, s'applique à **une catégorie
de clients** ou à **des clients choisis**, vaut **à partir d'une date** (et, si on veut, jusqu'à une autre), et
porte le prix hors taxes de certains articles (en dinars ; le prix du catalogue est rappelé en face).

**L2. La catégorie se saisit sur la fiche du client** (« Catégorie de prix » : revendeur, chantier…), avec les
catégories déjà employées proposées. Elle se reconnaît sans tenir compte des majuscules ni des espaces.

**L3. Le prix d'un article pour un client, à une date** (`prixArticlePour`) : celui de la première liste qui
le porte, parmi celles qui valent ce jour-là, **celles qui nomment le client d'abord**, puis celles de sa
catégorie, la plus récente d'abord ; sinon le palier de sa quantité (brique 92) ; sinon le prix de l'article.
Un article absent d'une liste garde son prix du catalogue.

**L4. Sur un devis ou une facture**, un article choisi prend ce prix ; la quantité le fait suivre (paliers).
**Les lignes déjà faites gardent leur prix** : changer une liste ou la catégorie d'un client ne réécrit aucune
pièce. Une ligne d'avant ces règles, à un autre prix que le leur, ne bouge pas quand on change sa quantité
(le prix qu'elle porte a été choisi).

## Ce qui part au serveur

Une collection de plus dans le dossier (`priceLists` : nom, catégorie ou clients, dates, prix par article) et un
champ sur la fiche du client (`categorieTarif`).

## Les tests

- Le moteur (`tests/v10/listes-prix.test.ts`) : les listes qui valent à une date (commencée, finie, future),
  l'ordre (le client nommé d'abord, même plus ancien ; puis la plus récente), la catégorie écrite autrement, le
  prix d'un article selon la liste, le palier ou le catalogue.
- À la souris (`tests/web/listes-prix.test.ts`) : la liste « Revendeurs » créée, le ciment à 19,500 sur la
  facture d'un revendeur et à 21 sur celle d'un particulier, puis le particulier devenu revendeur : sa nouvelle
  ligne à 19,500, l'ancienne à 21. Deux écrans regardés.
- 9 preuves (`tests/preuves.sh`, brique 93).

## Reste connu

- Changer le **client** d'une pièce en cours ne reprend pas les prix de ses lignes (elles gardent le leur) :
  **À VÉRIFIER** avec des commerçants s'il faut le proposer (« Appliquer les prix de ce client »).
- La caisse ne suit pas encore les listes de prix.
- Une liste ne porte que des prix fixes : pas encore de **remise en pourcentage** sur tout le catalogue pour une
  catégorie.
