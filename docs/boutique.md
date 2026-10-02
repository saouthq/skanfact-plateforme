# La boutique en ligne facturée dans SkanFact

*01/10/2026, brique 131. Demandé par Skander le 01/10/2026 : les commerçants qui ont une boutique en ligne SkanEcom
tiennent leur facturation et leur comptabilité dans SkanFact. SkanEcom ne refait ni l'un ni l'autre : chaque commande
de la boutique devient une facture dans le SkanFact **du commerçant**.*

## B0. « Connecter ma boutique » : le commerçant relie sa boutique en un clic

*Brique 133, 01/10/2026 (décision de Skander : SkanEcom relié à SkanFact dès maintenant).*

Le commerçant ne copie aucune clé. Comme « Se connecter avec… » :

1. Dans sa console, SkanEcom envoie le commerçant sur
   `https://<SkanFact>/connecter?partenaire=skanecom&retour=<adresse de retour>&etat=<valeur au hasard>`.
2. Le commerçant se connecte à SkanFact (ou crée son compte, puis son entreprise : la page le guide). La page
   « Relier SkanEcom à SkanFact » dit ce que SkanEcom pourra faire ; il choisit son entreprise (seulement celles dont il
   est propriétaire ou administrateur, jamais une entreprise d'essai) et clique **Autoriser**.
3. Il revient sur l'adresse de retour de SkanEcom avec `?code=…&etat=…` (ou `?erreur=refusee&etat=…` s'il a refusé).
   SkanEcom vérifie que `etat` est bien celui qu'il a envoyé.
4. Le serveur de SkanEcom échange le code, **dans les dix minutes, une seule fois** :
   `POST /v1/partenaires/skanecom/echanger`, en-tête `Authorization: Bearer <secret de SkanEcom>`, corps `{ "code": "…" }`
   → `{ cle, entreprise, nom, gestes, expireLe }`. La clé vaut **un an** ; ensuite, le commerçant reclique « Connecter ».
5. SkanEcom garde la clé (chiffrée chez lui) et l'identifiant de l'entreprise : c'est avec eux qu'il appelle B1 à B4.

**SkanEcom est déclaré** (02/10/2026, valeurs données par la session SkanEcom) : retour
`https://skanecom-apercu-console.skanbenamor10.workers.dev/skanfact/retour` (la console d'aperçu ; l'adresse de la
console définitive s'ajoutera à `retours` quand elle existera), empreinte du secret `6297c73b…40ce0a`, gestes
`ventes.boutique.facturer` et `ventes.pieces.voir`. Le secret lui-même n'est connu que de SkanEcom.

Ce que SkanFact garantit :

- **Un partenaire déclaré** seulement : dans `serveur/partenaires.json` (le dépôt), ou `SKANFACT_PARTENAIRES` (JSON) qui le
  remplace : son code, son
  nom, ses adresses de retour (https, exactes), l'**empreinte** (SHA-256) de son secret — jamais le secret —, et les
  gestes de sa clé (pour SkanEcom : `ventes.boutique.facturer`, `ventes.pieces.voir`). Une adresse de retour non
  déclarée n'est jamais suivie : la page dit que la demande n'est pas valable.
- **Le code n'est pas la clé** : la clé se calcule à partir du code avec une clé que seul le serveur connaît, et la base
  ne garde que des empreintes. Quelqu'un qui lit le code dans un historique n'en fait rien sans le secret de SkanEcom.
- Avant l'échange, la clé ne vaut que **dix minutes** : un code jamais échangé laisse une clé qui expire seule. Une clé
  révoquée entre-temps ne revit pas.
- **Ce qui part chez SkanEcom, compté** : la clé, l'identifiant et le nom de l'entreprise, les gestes de la clé, sa date
  de fin. Rien d'autre.
- L'autorisation (par qui) et l'échange se tracent dans le journal de l'entreprise.

**Services connectés** (brique 134) : dans SkanFact, Paramètres → Données et sécurité, le commerçant voit chaque service
qui agit pour son entreprise (« SkanEcom (connexion) »), ce qu'il peut faire en mots, depuis quand et jusqu'à quand, et
sa dernière action. « Couper l'accès… » demande d'abord, puis coupe : la clé ne vaut plus rien tout de suite (SkanEcom
reçoit 401), et ce qui a déjà été fait reste. Une clé coupée ou expirée ne s'y montre plus. Les jours s'y disent à
l'heure de Tunis, même depuis un navigateur réglé ailleurs.

## B1. Une commande devient une facture

`POST /v1/entreprises/:e/commandes-en-ligne`

```json
{ "reference": "SK-1001", "date": "2026-10-01",
  "client": { "nom": "Amel Ben Salah", "ref": "C-77", "email": "amel@exemple.tn", "telephone": "+216 22 000 111",
              "adresse": "Rue de Marseille, Tunis", "matricule": "" },
  "lignes": [
    { "designation": "Collier argent", "code": "COL925", "quantite": "1", "prixUnitaireTTC": "29.900", "tauxTva": "19" },
    { "designation": "Livraison", "quantite": "1", "prixUnitaireTTC": "7.000", "tauxTva": "7" } ],
  "timbre": true,
  "paiement": { "id": "pay-1", "mode": "en_ligne", "montant": "37.900", "date": "2026-10-01", "reference": "KONNECT-55" },
  "totalAttendu": "37.900" }
```

→ 201 `{ reference, deja: false, client, facture: { id, numero, date, netAPayer, reste, ecran } }`.

- **Une facture émise** par le serveur (numéro de la série FAC), dans le dossier du commerçant : il la voit dans
  « Factures », comme les siennes. Ses **écritures** (la vente, l'encaissement) et ses **avis** (`facture.emise`,
  `reglement.enregistre`, `facture.reglee`) suivent, comme pour toute facture.
- **Le client** : le même d'une commande à l'autre — par sa référence chez la boutique (`ref`), sinon son e-mail (la
  casse ne compte pas), sinon son nom. Il entre une fois dans les clients du commerçant ; ce que le commerçant y change
  ensuite n'est jamais écrasé par une commande.
- **Les prix** : TTC (`prixUnitaireTTC`, au millime) ou HT (`prixUnitaire`, six décimales), l'un ou l'autre par ligne.
  Pour un prix TTC, le serveur retrouve le HT qui redonne **exactement** ce TTC avec la TVA arrondie ligne par ligne.
  Quand aucun HT ne le peut (le TTC tombe entre deux marches de la TVA arrondie : environ une fois sur cinq à 19 %),
  il manque un millime : il va sur une ligne **« Arrondi » à 0 %**, et la facture fait le total payé, au millime.
  **À VÉRIFIER** avec un comptable : cette ligne d'arrondi à 0 % (dans la déclaration de TVA et le fichier TEIF).
- **Le timbre** (`timbre`) : obligatoire dans la commande, la boutique décide s'il s'applique. **À VÉRIFIER** : le
  timbre fiscal d'une facture de vente en ligne à un particulier.
- **Deux chemins, un chiffre** : le total de la facture doit être celui de la commande (`totalAttendu`, ou la somme
  des TTC plus le timbre quand toutes les lignes sont en TTC). Sinon **rien n'est facturé, et aucun numéro n'est pris** :
  403, « La facture ferait … et la commande … ».
- **Le stock** : une ligne avec un `code` reconnu dans le catalogue du commerçant (espaces et casse ignorés, comme la
  douchette de la caisse) est cet article : le stock baisse à l'émission, comme pour une facture de l'écran.
- **Renvoyée** (la réponse perdue en route) : la même commande rend la même facture (200, `deja: true`) ; jamais une
  seconde facture, jamais un second paiement.
- Une quantité dont aucun prix HT à six décimales ne redonne le montant (au-delà de mille unités, rarement) est
  refusée : l'envoyer en plusieurs lignes.

## B2. Lire une commande facturée

`GET /v1/entreprises/:e/commandes-en-ligne/:reference` → la même réponse (le reste à jour), ou 404.

## B3. Un paiement plus tard (à la livraison, en plusieurs fois)

`POST /v1/entreprises/:e/commandes-en-ligne/:reference/paiements`
`{ "id": "livraison-1", "mode": "especes", "montant": "9.005", "date": "2026-10-05", "reference": "" }`
→ la commande, avec son reste. Le même `id` envoyé deux fois ne compte qu'une fois. Modes : `carte`, `en_ligne`,
`especes`, `virement`, `cheque`, `autre`.

## B4. Un retour, une commande annulée, l'argent rendu

*Brique 132, 01/10/2026.*

`POST /v1/entreprises/:e/commandes-en-ligne/:reference/retours`

```json
{ "id": "retour-1", "date": "2026-10-04", "motif": "Taille", "timbre": false,
  "lignes": [ { "designation": "Collier argent", "code": "COL925", "quantite": "1", "prixUnitaireTTC": "29.900", "tauxTva": "19" } ],
  "remboursement": { "mode": "en_ligne", "montant": "29.900", "reference": "KONNECT-R-9" } }
```

→ 201 `{ reference, client, facture: { …, reste }, retour: { id, deja, avoir: { id, numero, date, montant, ecran }, rembourse } }`.

- **Un retour est un avoir** de la facture de la commande (série AVO, numéro du serveur), au client de la commande. Les
  lignes rendues se donnent comme celles d'une commande (TTC au millime, ou HT) ; un article reconnu à son `code`
  **revient au stock**. Sans `lignes`, c'est **toute la commande**, telle qu'elle a été facturée (seulement si rien
  n'en est encore rendu : sinon 409, il faut dire les lignes).
- Le `motif` est celui de l'avoir (« Motif de l'avoir » à l'écran) ; l'avoir porte le numéro de la facture qu'il
  corrige, et son document le dit (« Cet avoir vient en déduction de la facture FAC-… »).
- **Une commande refusée à la livraison** (jamais payée) : un retour de toute la commande avec `"timbre": true`, sans
  remboursement ; la facture est soldée.
- **Le timbre** (`timbre`, obligatoire) : la boutique dit si le retour le rend. Il ne se rend que si la facture en a
  un, et une seule fois. **À VÉRIFIER** avec un comptable : rendre le timbre fiscal par un avoir.
- **L'argent rendu** (`remboursement`, facultatif) s'enregistre sur la facture, comme dans l'application : un règlement
  **négatif** (l'encaissement s'inverse dans les écritures). Jamais plus que ce que le client a payé au-delà de ce qu'il
  doit, sinon rien n'est enregistré (403).
- **Renvoyé** : le même `id` rend le même avoir (200, `deja: true`) ; s'il arrive avec un `remboursement` qui n'avait
  pas encore été fait (l'argent rendu plus tard), celui-ci s'ajoute, une seule fois.
- **Deux chemins, un chiffre** : le total de l'avoir doit être celui du retour (`totalAttendu`, ou la somme des TTC
  plus le timbre). Un retour plus grand que ce qui reste de la commande à rendre est refusé. Dans les deux cas rien
  n'est émis, et aucun numéro n'est pris.

## À venir

- Les **remises** et les codes promo : la boutique envoie chaque ligne **au prix réellement payé** (remise déjà
  déduite) ; une remise sur toute la commande se répartit sur ses lignes (au millime, la dernière ligne prend le
  reste), et `totalAttendu` reste ce que le client a payé. Une ligne « Remise » négative n'est pas acceptée : une
  facture ne porte pas de ligne de prix négatif. Une remise affichée à part sur la facture : à décider avec Skander
  si les commerçants la demandent.
- **À VÉRIFIER** : une facture à un particulier sans matricule, quand l'entreprise est soumise à la facture
  électronique (le serveur refuse aujourd'hui une pièce dont le fichier TEIF serait refusé).

## Les preuves

`tests/v10/boutique.test.ts`, `tests/v10/boutique-retours.test.ts`, `tests/socle/partenaires.test.ts` et
`tests/web/connecter.test.ts`, `tests/web/services-connectes.test.ts`, et 79 défauts réintroduits (`tests/preuves.sh`,
« Brique 131 » à « Brique 134 ») : une commande renvoyée qui ferait une seconde facture, un client créé à chaque commande ou reconnu sans sa référence, un TTC jamais redonné, le
millime perdu, un total faux facturé quand même, le timbre oublié ou imposé, un paiement compté deux fois, un article
jamais relié au catalogue, une clé sans geste d'émission, ou qui prendrait la série des tickets (une clé révoquée ou
expirée, elle, ne voit déjà plus l'entreprise), un retour qui ferait un second avoir ou rendrait l'argent deux fois,
plus que la commande ou plus que ce qui a été payé, le timbre rendu sans avoir été payé ou deux fois, un article
rendu qui ne revient pas au stock, une adresse de retour non déclarée suivie, un faux secret accepté, un code
échangé deux fois, expiré ou pour un autre partenaire, une clé qui se lit dans le code…
