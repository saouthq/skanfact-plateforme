# Les commandes fournisseurs et leurs réceptions, même partielles

*30/09/2026, brique 87. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 3.2 du
dépôt `skanfact` (au lancement : « Côté achats : demande de prix, commande fournisseur, réception (même
partielle), et la facture rapprochée de la réception (un écart de quantité ou de prix se signale) »).
Cette brique fait la commande, la réception et la facture saisie depuis les réceptions ; la demande de
prix et le signal des écarts viennent ensuite. Toutes les décisions sont prises par délégation, le
30/09/2026.*

## Ce que la v10 faisait

Côté achats, la v10 n'avait que les pièces comptables : la facture du fournisseur, la dépense, l'avoir,
l'acompte. Le grossiste qui commande 100 sacs de ciment et en reçoit 60, puis 40 la semaine suivante,
n'avait nulle part où écrire sa commande, ni ce qui restait à venir ; la marchandise n'entrait en stock
qu'avec la facture, souvent des jours après son arrivée.

## Ce que fait la brique 87

**C1. Une page « Commandes fournisseurs »** (famille « Acheter », module des achats), en deux onglets :
les commandes et les réceptions, paginés. La commande et la réception allument cette entrée du menu.

**C2. La commande** : le fournisseur, la date, la livraison souhaitée, une référence, la devise (et son
taux), les lignes (un article du catalogue arrive à son **coût d'achat** et à son taux de TVA d'achat ;
une ligne libre pour le transport) et des notes imprimées. Son statut se choisit : brouillon, envoyée,
soldée, annulée. Son numéro (**BCF-AAAA-NNN**, sa propre série) naît au premier enregistrement : le plus
grand numéro déjà porté ou le compteur, le plus grand des deux, plus un. Elle s'imprime pour le
fournisseur : « Bon de commande », adressée au « Fournisseur », avec la date, la livraison souhaitée, la
référence, et la demande de confirmer la commande, ses prix et sa date de livraison. Les quantités restent
des quantités (2,5 t, jamais « 2,500 » comme un montant).

**C3. « Recevoir » tire de la commande une réception qui reprend ce qui RESTE à recevoir** : ni reçu, ni
dans une réception en préparation. Elle naît en brouillon ; on y saisit ce qui est vraiment arrivé, ligne
par ligne. Chaque ligne garde le rang de SA ligne de commande (`ligneCommande`). Ce qui arrive en plus de
la commande se dit **avant** de valider (« … de plus que ce qui reste à recevoir ») ; il entre quand même
en stock. Rien ne reste : « Rien ne reste à recevoir sur BCF-… ».

**C4. Ce qui est reçu se compte par UNE fonction** (`suiviCommandeFournisseur`, dans le moteur de la
v10) : une réception **validée** a reçu ; **en brouillon**, elle est « en préparation » (elle ne reçoit
rien, mais la réception suivante ne reprend pas ce qu'elle porte) ; **annulée**, elle ne compte pas. Le
statut, le panneau « Réceptions » de la commande, son bouton et la réception suivante la lisent. Le statut
se déduit : « reçue en partie », puis « reçue » ; « soldée », choisie à la main, clôt une commande dont le
reste ne viendra pas ; « annulée » n'attend plus rien. Le bouton principal de la commande est l'étape
suivante : « Recevoir », puis « Recevoir le reste », puis « Saisir la facture du fournisseur ».

**C5. Une commande qui a une réception, même en préparation, ne change plus ses lignes** (ni son
fournisseur, ni sa devise) : ses réceptions s'y rattachent par leur rang, et retirer une ligne les
décalerait toutes. Le message dit comment débloquer : supprimer d'abord la réception en préparation. Une
commande qui a des réceptions ne se supprime pas : elle s'annule, ses réceptions restent.

**C6. Une réception validée fait entrer la marchandise suivie en stock**, à sa date, au **prix de la
commande ramené en dinars** (au millime, comme une ligne d'achat : 17,25 € × 3,3715 = 58,158). Elle prend
son numéro (**BR-AAAA-NNN**) à la validation. C'est une **entrée**, comme un achat, pas une charge du mois :
le coût des sorties ne la compte pas comme consommée. Annuler une réception validée fait ressortir sa
marchandise et la commande attend de nouveau ce qu'elle avait reçu ; c'est refusé tant qu'une facture la
couvre (on corrige d'abord la facture).

**C7. La facture du fournisseur se saisit depuis ses réceptions** (« Saisir la facture du fournisseur »,
sur la commande ou sur la réception) : un achat pré-rempli avec les réceptions validées de la commande
qu'aucune facture ne couvre encore. **Chaque ligne de commande y fait UNE ligne**, sa quantité reçue en tout
au prix de la commande (un arrondi, pas un par réception) ; un article suivi y va en « Stock ». Un bandeau
le dit : la marchandise est déjà entrée par les réceptions, ces lignes (marquées `recue`) ne l'y font pas
entrer une seconde fois ; une ligne ajoutée à la main, si. On saisit le numéro du fournisseur et on vérifie
les prix ; le serveur tient la facture au millime comme tout achat. Une réception couverte ne se propose
plus ; supprimer la facture la libère. **Une copie** de cette facture ne couvre aucune réception, et ses
lignes font entrer leur marchandise en stock comme n'importe quel achat ; de même une ligne copiée (⧉).
Chaque ligne reçue le dit sous sa destination : « reçue par une réception ».

**C8. Ni la commande ni la réception n'est une pièce comptable** : elles vivent dans le dossier
(`supplierOrders`, `receptions`), pas parmi les achats que le serveur tient au millime (`achats.piece`).
Seule la facture du fournisseur en est une, et elle seule passe au livre.

## Ce qui part au serveur

Rien vers un tiers. Deux collections nouvelles du dossier de l'entreprise, sur le serveur de SkanFact :
`supplierOrders` (la commande : fournisseur, dates, référence, statut, devise et taux, lignes, notes) et
`receptions` (la réception : commande, fournisseur, date, statut, lignes reçues avec `ligneCommande`,
notes) ; et deux champs sur un achat, `receptions` (identifiant et numéro de chaque réception couverte) et
`recue` sur une ligne.

## Les tests

- Le moteur (`tests/v10/commandes-fournisseurs.test.ts`, le code de la v10 chargé tel quel) : la
  réception qui reprend le reste, le brouillon en préparation, la réception annulée, « reçue en partie »
  puis « reçue », « soldée » et « annulée » à la main, les deux séries de numéros (et le changement
  d'année), le stock entré par les réceptions validées seules au prix en dinars, la facture qui n'y fait
  pas entrer une seconde fois ses lignes reçues (une ligne ajoutée à la main, si), le coût des sorties nul,
  la réception couverte qui ne se propose plus, la commande imprimée.
- À la souris (`tests/web/commandes-fournisseurs.test.ts`) : la commande créée depuis le catalogue,
  imprimée, reçue en deux fois (ses lignes figées pendant la préparation), le panneau, le stock de la fiche
  article, la facture saisie depuis les deux réceptions et tenue par le serveur (7 311,250 HT), le stock
  entré une seule fois, sa copie (et la copie d'une ligne) qui y entre, puis la commande au téléphone. Six écrans regardés.
- 39 preuves (`tests/preuves.sh`, brique 87) : chaque défaut remis fait tomber son test.

## Reste connu

- **Les écarts** entre la facture et les réceptions (une quantité ou un prix qui diffère) ne se signalent
  pas encore : c'est la brique suivante, avec la demande de prix.
- **Le prix du stock** : la marchandise entre au prix de la commande ; si la facture porte un autre prix
  (ou un autre cours de change), la valeur du stock n'est pas reprise. **À VÉRIFIER** avec un comptable :
  valoriser au prix de la facture (et recalculer le coût moyen) ?
- **Une réception non facturée à la clôture** : la marchandise est en stock (l'inventaire du 31 décembre
  la compte) alors que l'achat n'est pas au livre. **À VÉRIFIER** avec un comptable : une facture non
  parvenue (408) ? Rien ne s'écrit d'office aujourd'hui.
- **Les droits** : la commande et la réception s'écrivent avec le droit de modifier le dossier. La grille
  du cadrage (`03-droits.md` § 1 et § 2.3 : l'acheteur prépare une commande ; le magasinier valide une
  réception ; une commande au-delà d'un seuil demande un accord) n'est pas encore appliquée geste par geste.
- « À faire » ne compte pas les réceptions qui attendent leur facture ni les commandes en retard (livraison
  souhaitée dépassée).
- Une ligne saisie à la main sur un achat, pour une marchandise déjà reçue par une réception (sans passer
  par « Saisir la facture du fournisseur »), l'y ferait entrer deux fois : rien n'avertit encore.
- Une réception en préparation d'une commande annulée ensuite peut encore se valider (la marchandise est
  peut-être arrivée) : rien ne le dit.
