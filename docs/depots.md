# Le stock par dépôt, et les transferts

*30/09/2026, briques 94 et 95. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 du dépôt
`skanfact` (au lancement : « Stock par dépôt, transferts »). Décisions prises par délégation, le 30/09/2026.*

## Ce que fait la brique 94

**D1. Les dépôts se nomment depuis la page Stock** (« Dépôts… ») : le dépôt principal est toujours là et se
renomme (« Magasin de Tunis ») ; les autres s'ajoutent. Deux dépôts ne portent pas le même nom. **Tant qu'il n'y
a qu'un dépôt, rien ne change à l'écran.**

**D2. Chaque mouvement appartient à un dépôt** : celui de sa réception (on le choisit sur la réception), de sa
pièce ou de son ajustement ; le stock de départ, celui de l'article ; sinon le dépôt principal. La page d'un
article dit son stock dépôt par dépôt (`stockParDepot`), et son historique le dépôt de chaque mouvement.

**D3. « Transférer… »** fait passer de la marchandise d'un dépôt à l'autre (`transfertStock`) : deux mouvements,
la sortie et l'entrée, **sans coût imposé** — la quantité totale et le coût moyen ne bougent pas, le résultat non
plus. La sortie passe un instant avant l'entrée : l'historique ne montre jamais un stock total gonflé.
On ne transfère pas ce que le dépôt n'a pas à cette date (le refus dit combien il en a), ni vers lui-même.
Un transfert se supprime **entier** : ses deux mouvements partent ensemble.

**D4. Corrigé en passant** (défaut de la brique 87) : la ligne d'une réception dans l'historique d'un article menait
à une page de vente ; elle mène à la réception.

## Ce que fait la brique 95 : le dépôt sur les ventes et les achats

**D5. Une facture, un bon de livraison, un avoir et un achat choisissent leur dépôt** (le champ « Dépôt » de
l'en-tête, seulement à partir de deux dépôts ; le principal par défaut). La marchandise sort de ce dépôt (y
rentre, pour un avoir ou un achat). Une facture tirée d'un bon de livraison n'en a pas : c'est le bon qui sort le
stock, et « Transformer » recopie son dépôt. Une pièce émise garde le sien (champ en lecture seule).

**D6. L'avoir rentre la marchandise là d'où elle était sortie** : tiré d'une facture, ou quand on choisit la
facture concernée, il prend le dépôt de cette facture (qu'on peut encore changer avant de l'émettre).

**D7. « Stock insuffisant » regarde le dépôt de la pièce** (`stockImpact`) : « il en reste 20 sacs dans Dépôt
principal ». Quand les autres dépôts en ont assez, l'avertissement le dit et propose de choisir le bon dépôt ou de
transférer d'abord, plutôt que de soupçonner un achat oublié. Comme avant, c'est un avertissement : on peut
émettre quand même.

## Ce qui part au serveur

Dans le dossier : la liste des dépôts (`depots`, `depotPrincipalNom`), le dépôt d'une réception, d'une pièce de
vente ou d'un achat (`depotId`), et
les mouvements de transfert (`stockAdjustments`, `source: 'transfert'`, liés par `transfertId`).

## Les tests

- Le moteur (`tests/v10/depots.test.ts`) : le dépôt de chaque mouvement (départ, achat, réception, facture, bon),
  le stock par dépôt à une date, le transfert qui garde la quantité, la valeur et le coût moyen, les refus.
- À la souris (`tests/web/depots.test.ts`) : les dépôts nommés, la réception entrée à Sfax, le stock par dépôt, le
  transfert trop grand refusé puis 25 sacs transférés, l'historique, la suppression du transfert entier, le lien
  de la réception. Un écran regardé.
- Brique 95 : le moteur (le stock insuffisant lu dans le dépôt de la pièce, et le total quand il n'y a qu'un dépôt) ;
  à la souris, l'achat rangé à Sfax, l'avertissement du principal qui propose le transfert (écran regardé), la
  facture émise depuis Sfax, l'avoir qui reprend le dépôt de sa facture.
- 11 preuves pour la brique 94, 7 pour la 95 (`tests/preuves.sh`).

## Reste connu

- La **caisse** vend depuis le dépôt principal (pas de choix au ticket) ; un bon de commande client ne porte pas
  encore de dépôt (le bon de livraison le choisit).
- Le **seuil d'alerte** reste global, pas par dépôt.
- La valeur du stock est au **coût moyen de l'entreprise**, pas un coût par dépôt. **À VÉRIFIER** avec un
  comptable : est-ce attendu pour l'inventaire du 31 décembre ?
- Un transfert se fait en un geste : pas de marchandise « en route » entre deux dépôts.
