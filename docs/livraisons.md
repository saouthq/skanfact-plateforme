# Les commandes livrées en plusieurs fois, et plusieurs bons de livraison en une facture

*30/09/2026, brique 86. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 du
dépôt `skanfact` (les commerces, grossistes et distributeurs, au lancement : « commandes clients livrées
en plusieurs fois, reliquats suivis, plusieurs bons de livraison en une facture »). Ce document dit ce
qui en est fait, décision par décision ; toutes sont prises par délégation, le 30/09/2026.*

## Ce que la v10 faisait

Une commande se transformait en UN bon de livraison, copie de toute la commande. Le grossiste qui livre
ce qu'il a en stock et le reliquat la semaine suivante n'avait aucun moyen de suivre ce qui restait : le
menu de la commande disait « Voir BL-… » dès le premier bon, comme si tout était parti. Et un bon ne se
facturait que seul, en sa propre facture (« Facturer » depuis le bon).

## Ce que fait la brique 86

**B1. Le bon d'une commande reprend ce qui reste à livrer.** « Établir le bon de livraison », puis
« Livrer le reste » (le menu de la commande, son bouton « Transformer ▾ », son panneau) : le bon naît en
brouillon avec, ligne par ligne, ce qui n'est ni livré ni déjà dans un bon en préparation ; on ajuste
les quantités à ce qui part vraiment. Chaque ligne du bon garde le rang de SA ligne de commande
(`ligneCommande`). Rien ne reste : « Rien ne reste à livrer sur BC-… : tout est livré, ou dans un bon en
préparation. »

**B2. Ce qui est livré se compte par UNE fonction** (`suiviCommande`, dans le moteur de la v10) : les
bons **émis ou signés** ont livré ; un bon **en brouillon** est « en préparation » (il ne livre rien,
mais le bon suivant ne reprend pas ce qu'il porte) ; un bon **annulé** ne compte pas. Le statut, le
panneau, le menu et le bon suivant lisent la même fonction : deux écrans, un chiffre. Livré en plus de la
commande : dit (« 5 de plus »), jamais compté comme un reste négatif. Un bon tiré d'une commande avant ce
rattachement (aucune ligne ne porte `ligneCommande`) se lit ligne à ligne, au même rang et à la même
désignation — c'est le cas de l'exemple de cinq ans.

**B3. Le statut d'une commande reçue se déduit de ses bons** : « livrée en partie », puis « livrée »,
comme celui d'une facture se déduit de ses paiements. « Livrée », choisie à la main, reste le geste qui
**clôt** une commande dont le reste ne partira pas (le panneau le dit : « le reste n'est plus proposé »).
La liste des commandes filtre sur le statut qu'elle montre (« Livrée en partie » y est un filtre).

**B4. Le panneau « Livraisons » d'une commande** (dès qu'elle a un bon) : ligne par ligne, commandé,
livré (et ce qui est en préparation), reste ; ses bons, cliquables, avec leur statut et leur date ; et
« Livrer le reste » avec ce qui reste (« Reste à livrer sur 2 lignes : Ciment gris 50 kg (40 sac), … »).
Au téléphone, son tableau défile dans son cadre.

**B5. Plusieurs bons d'un client, une facture.** « Facturer des bons… » en tête de la liste des bons de
livraison (le bouton principal tant qu'un bon attend sa facture), ou « Facturer avec d'autres bons… »
dans le menu d'un bon : les bons émis ou signés d'un client qu'aucune facture ne couvre, cochés ; la
facture naît en brouillon (on la relit avant de l'émettre). Des bons de deux devises ne vont pas sur une
facture : la fenêtre le dit et le bouton attend. **Une même ligne de commande livrée en plusieurs fois se
facture en UNE ligne**, sa quantité totale au même prix : 2,5 t de fer livrées 1,25 + 1,25 à 2 350,750
se factureraient sinon deux fois 2 938,438 — un millime de plus que la commande, chaque ligne s'arrondissant.
La fenêtre annonce le montant de LA facture, calculé sur elle, et dit pourquoi il peut avoir un millime de
moins que la somme des bons. Une ligne changée sur un bon (un autre prix) reste à part.

**B6. La facture nomme ses bons, et le serveur les scelle.** Elle imprime « Bons de livraison :
BL-…, BL-… » (le client rapproche la facture de ses bons signés) ; son historique nomme chacun, cliquable,
et l'historique de chaque bon montre la facture. À l'émission, la liste des bons est **scellée** avec la
facture (`SCELLE`, `serveur/v10/dossier.ts`) : elle s'imprime, et elle décide que le stock ne sort pas une
seconde fois. Une pièce tirée de cette facture (un bon, par « Transformer ») ne reprend pas ses bons, ni
une copie de la facture.

**B7. La facture qui couvre un bon** : celle qui le nomme (plusieurs bons, ou « Facturer » depuis le bon),
sinon une facture de la même vente qui ne vient d'aucun bon (tirée du devis, de la proforma ou de la
commande : elle facture toute la vente). Chaque bon d'une commande livrée en plusieurs fois se facture
donc à part : la facture du premier bon ne couvre pas le second. Une facture d'acompte ne facture pas la
marchandise ; une facture que ses avoirs annulent ne couvre rien. L'index se construit une fois par lot
(une liste de cent bons ne relit pas cent fois toutes les pièces).

**B8. Le stock sort par les bons, jamais une seconde fois par la facture** (la règle de la v10 : une
facture tirée d'un bon ne sort rien ; la facture de plusieurs bons est tirée du premier).

## Ce qui part au serveur

Rien de nouveau : les bons, les commandes et les factures sont les objets du dossier, comme avant ;
deux champs s'y ajoutent, `ligneCommande` sur une ligne de bon et `bonsLivraison` (numéro et identifiant
de chaque bon) sur une facture.

## Les tests

- Le moteur (`tests/v10/livraisons.test.ts`, le code de la v10 chargé tel quel) : le bon qui reprend ce
  qui reste, le brouillon en préparation, le bon annulé, « livrée en partie » puis « livrée », « livrée »
  à la main, le bon d'avant le rattachement, la facture de deux bons égale à la commande au millime
  (7 786,875 HT), les bons de deux clients ou de deux devises refusés, le bon facturé qui ne se propose
  plus, le stock sorti par les bons seuls, la facture de chaque bon, l'acompte, la facture de toute la vente.
- À la souris (`tests/web/livraisons.test.ts`) : la commande livrée en deux fois, le panneau, le menu, le
  filtre, « Facturer des bons… », la facture émise par le serveur au même net (9 267,381), ses bons
  scellés, une copie de la facture qui ne les reprend pas, puis le panneau au téléphone.
- Le scellé (`tests/v10/dossier.test.ts`) : une facture émise ne change plus ses bons.
- 27 preuves (`tests/preuves.sh`, brique 86) : chaque défaut remis fait tomber son test.

## Reste connu

- Un bon qui livre plus que commandé se dit sur le panneau de la commande, mais rien n'avertit AVANT de
  l'enregistrer.
- « À faire » ne compte pas encore les bons qui attendent leur facture (le bouton principal de la liste
  des bons, oui).
- La facture de plusieurs bons ne dit pas, ligne par ligne, de quel bon vient chaque quantité (la liste
  des bons est en tête). **À VÉRIFIER** avec un comptable : est-ce attendu sur une facture tunisienne ?
- Le fichier TEIF ne porte pas les numéros des bons. **À VÉRIFIER** : la TTN les attend-elle ?
- Côté achats, les commandes fournisseurs et les réceptions (même partielles) : une brique suivante.
