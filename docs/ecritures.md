# Les écritures comptables tenues par le serveur (briques 32 à 35)

*Conception du 29/09/2026. Ce document dit ce que ces briques font, pourquoi, et ce qui les prouve.*

## Où on en est

- La v10 ne garde **aucune** écriture côté entreprise : elle les recalcule à chaque lecture depuis
  ses pièces (`journalEntries`, `core.js`). Seul le Cabinet garde des écritures validées.
- Le moteur de la plateforme écrit déjà chaque pièce au millime de la v10 (`moteur/ecritures.ts`,
  `reglements.ts`, `achats.ts`, `paie.ts`, comparés pièce par pièce depuis l'étape 1), et lit la TVA
  du mois dans des écritures (`moteur/declarations.ts`). Il n'était branché à rien.
- Le serveur tient maintenant toutes les pièces : factures et avoirs émis, leurs règlements
  (brique 29), les achats et leurs règlements (30), les bulletins (31).

Le cadrage (`VISION-ARCHITECTURE.md`, leçons du `CLAUDE.md`) : une écriture **validée** ne se
modifie jamais, elle se contre-passe ; un **numéro** naît à la validation ; le journal est
inaltérable (chaîne d'empreintes) ; la TVA se lit dans les livres (deux chemins, un chiffre).

## Le découpage

| Brique | Ce qu'elle fait |
|---|---|
| **32** | Les tables de la comptabilité ; les écritures des **ventes** (facture, avoir, encaissements) tenues au fil des pièces ; les livres lus par l'API (journal, balance, grand livre). |
| **33** | Les écritures des **achats** (facture, dépense, avoir, acompte, imputation) et des règlements fournisseurs ; la TVA du mois lue dans les livres du serveur. |
| 34 | La **paie** en totaux du mois, sans un nom de salarié (`03` § 2.1), et les salaires versés. |
| 35 | La **validation** : numéros par journal, chaîne d'empreintes, période close, contre-passation. |

## Brique 32 : les écritures des ventes

### 1. Les tables (migration `0015`)

- `compta.ecriture` : l'entreprise, le **journal** (VT, BQ, CA ; les autres viendront), la date,
  l'**origine** (la facture, l'avoir ou le règlement qui l'a faite), la **famille** (voir 2), la
  pièce qu'elle cite (son numéro), le tiers, un libellé, le **statut** (`brouillard`, puis
  `validee` à la brique 35) et le numéro (vide tant qu'elle n'est pas validée).
- `compta.ligne` : le compte, le libellé, le débit **ou** le crédit (en millimes, jamais les deux,
  jamais zéro), le taux de TVA d'une ligne de TVA ou de vente.
- La base refuse elle-même une écriture **déséquilibrée** (vérifié à la fin de la transaction :
  une écriture s'écrit ligne par ligne), une écriture sans ligne, et **toute** modification d'une
  écriture validée ou de ses lignes (« elle se contre-passe »).
- Qui les voit (`03` § 2.1, « Livres, balance ») : propriétaire, administrateur, comptabilité
  interne ; la lecture en lecture seule. La base le garde elle-même (sécurité par ligne).

### 2. La famille : l'unité qui se réécrit

Une écriture de vente dépend de ses voisines : l'avoir se crédite au cours de **sa facture** et
régularise la retenue des règlements **de sa facture** ; la part de retenue de chaque encaissement
dépend de tous les règlements et avoirs de la facture. L'unité de réécriture est donc la
**famille** : une facture émise, ses avoirs, et tous leurs règlements.

Quand un membre change (la facture s'émet, un avoir s'émet, un règlement s'ajoute, change ou part),
le serveur **réécrit toutes les écritures en brouillard de la famille**, dans la même transaction
que le geste. Jamais une écriture validée (brique 35 : la contre-passation).

### 3. Ce qui s'écrit, comme la v10

- **La facture** (journal VT, à sa date) : D client le TTC ; C ventes la base de chaque taux ; C TVA
  collectée ; C timbre ; l'écart de conversion d'une pièce en devise au change (`ecritureDeVente`).
- **L'avoir** (VT, à sa date) : l'envers, crédité au cours de sa facture (l'écart au change), avec
  la régularisation de la retenue déjà gardée par le client, à sa date (10.14.0).
- **Chaque encaissement** (BQ ou CA, à sa date) : D trésorerie ce que la banque a reçu ; C client ce
  qu'il verse plus la retenue qu'il garde ; D retenue subie sa part (elle **naît** ici) ; l'écart
  entre le cours du jour et celui de la facture au change (`ecritureDEncaissement`).
- Les montants viennent de la pièce **scellée** (ses totaux et sa TVA par taux, gardés à
  l'émission) : l'écriture ne recalcule pas une pièce émise.

### 4. Le plan de l'entreprise

- Les comptes par défaut sont ceux de la v10 (`DEFAULT_ACCOUNTS`) : `moteur/comptes.ts`, qu'un test
  confronte à la v10. Ce sont les numéros du plan comptable, pas des taux.
- Ce que l'entreprise a réglé dans son dossier les remplace (`chartAccounts`) ; les comptes
  auxiliaires (411 + le code du client) quand elle les a demandés (`auxiliaires`).
- Le journal d'un encaissement : celui du compte de trésorerie choisi, sinon du compte par défaut,
  sinon du premier ; sans aucun compte, les espèces vont à la caisse (`journalDeCompte`).
- Changer le plan, les comptes auxiliaires ou un compte de trésorerie **réécrit toutes les
  écritures en brouillard** de l'entreprise, dans le même enregistrement (elles suivent le plan tant
  qu'elles ne sont pas validées ; une écriture validée garde ses comptes).

### 5. L'API lit les livres

- `GET /v1/entreprises/:e/compta/ecritures?du=&au=&journal=` : le journal, dans l'ordre des dates,
  page après page, chaque écriture avec ses lignes.
- `GET /v1/entreprises/:e/compta/balance?du=&au=` : chaque compte, ses débits, ses crédits, son solde ;
  et les totaux, qui doivent être égaux.
- `GET /v1/entreprises/:e/compta/grand-livre?compte=&du=&au=` : les lignes d'un compte (et de ses
  sous-comptes), le solde avant la période, le solde après chaque ligne, page après page.
- Le geste `compta.livres.voir` : propriétaire, administrateur, comptabilité interne ; la lecture
  le voit ; ni le commercial, ni le caissier, ni la paie.

### Décisions (par délégation, 29/09/2026)

- **D1.** Les écritures sont **tenues** par le serveur (écrites avec la pièce, dans la même
  transaction), pas recalculées à chaque lecture comme dans la v10 : la balance et le grand livre
  se lisent dans la base, et la validation (35) aura des écritures à sceller.
- **D2.** L'unité de réécriture est la **famille** d'une facture (ses avoirs, tous leurs règlements).
- **D3.** Une écriture en brouillard suit le plan de l'entreprise ; changer le plan réécrit tout le
  brouillard ; une écriture validée ne bouge plus.
- **D4.** Le libellé d'une écriture garde le nom du client tel que la pièce émise l'a figé (la copie
  scellée), pas celui du jour.
- **D5.** Le lettrage n'est pas encore tenu (il se déduira des soldes, brique 33 ou 35) : la v10 le
  calcule, il n'entre pas dans les montants.

### Ce qui la prouve

- Les factures, avoirs et encaissements de **l'exemple de cinq ans**, émis et réglés par le serveur :
  chaque écriture de chaque famille est celle de la v10 (journal, date, compte, débit, crédit, dans
  l'ordre) ; la balance est équilibrée ; la TVA collectée de chaque mois, lue dans les écritures du
  serveur, est celle que la v10 déclare (avec les timbres et les retenues subies) ; le plan par
  défaut est celui de la v10.
- Un parcours à la main (`tests/compta/livres.test.ts`) : la retenue de chaque encaissement (7,607
  puis 9,128), l'encaissement qui passe de la caisse à la banque quand un compte bancaire arrive, la
  régularisation de l'avoir égale à celle que la lecture de la facture annonce, le solde du client
  dans la balance (29,488 moins cette régularisation), le grand livre page après page ; une famille
  qui a une écriture validée ne se réécrit plus (la contre-passation viendra à la brique 35).
- La famille réécrite à chaque geste (un règlement ajouté, modifié, retiré ; un avoir émis), jamais
  en double ; le plan changé réécrit le brouillard.
- La base refuse une écriture déséquilibrée, une ligne à zéro ou des deux côtés, et toute
  modification d'une écriture validée ; le commercial ne lit pas les livres, même dans la base.
- Chaque test est prouvé en réintroduisant son défaut (`tests/preuves.sh`).

## Brique 33 : les écritures des achats

### 1. La famille d'un achat

Le même principe que les ventes (D2) : une **famille** est une facture d'achat ou une dépense, les
avoirs et acomptes qui y sont **rattachés**, et tous leurs règlements. Un avoir ou un acompte
**libre** est sa propre famille. La part de retenue de chaque règlement dépend de ce que les pièces
rattachées couvrent (un acompte dès l'origine, un avoir à SA date) : toute la famille se réécrit
quand l'une de ses pièces change.

Quand l'écran de la v10 enregistre des achats (`serveur/v10/achats.ts`), le serveur réécrit, dans
la même transaction, chaque famille **touchée** : celle de chaque pièce **avant** l'envoi et celle
d'**après** (un avoir détaché quitte sa facture, un avoir rattaché la rejoint). Une famille qui n'a
plus de tête (pièce retirée, ou rattachée ailleurs) se vide d'abord ; puis chaque famille qui a sa
tête se réécrit : une écriture ne vit que dans une famille. Un fournisseur renommé réécrit les
familles de ses achats (le libellé suit son nom : un achat n'a pas de copie scellée, il se modifie).
Changer le plan réécrit tout le brouillard des achats comme celui des ventes (D3).

### 2. Ce qui s'écrit, comme la v10

- **L'achat** (journal AC, à sa date ; `ecritureDAchat`) : D charges, stock ou immobilisations le HT
  de chaque destination ; D frais accessoires ; D TVA déductible ; la TVA non déductible grossit la
  destination ; C fournisseur le **brut** (la retenue naît au règlement). Un acompte va aux avances
  (409). Un avoir s'écrit à l'envers ; rattaché, il règle le fournisseur au cours de sa facture et
  régularise la retenue déjà opérée, à sa date.
- **L'imputation d'un acompte** (OD, à la date de la facture ; `ecritureDImputationAcompte`) : D
  fournisseur le brut de l'acompte ; C avances et TVA déductible, que l'acompte avait posées.
- **Chaque règlement fournisseur** (BQ ou CA, à sa date ; `ecritureDeReglementFournisseur`) : D
  fournisseur ce qu'on verse plus la retenue qu'on garde ; C trésorerie ; C retenue opérée sa part
  (elle **naît** ici) ; l'écart de cours au change. Porté par un avoir, c'est un remboursement :
  l'argent entre.
- Les montants sont recalculés par le moteur depuis la pièce tenue (`achats.piece`, `achats.ligne`) :
  ce sont les mêmes que l'écran (brique 30, deux chemins). Une pièce dont tout est nul n'écrit rien.

### Décisions (par délégation, 29/09/2026)

- **D6.** L'origine d'une imputation est l'**acompte** imputé (un acompte ne s'impute que sur une
  facture) ; sa famille, celle de la facture.
- **D7.** Une famille d'achat qui a une écriture validée refuse l'enregistrement qui la changerait
  (403, « elle se corrige par une contre-passation ») : rien de l'envoi n'est écrit. La
  contre-passation viendra à la brique 35.

### Ce qui la prouve

- Les 181 achats de **l'exemple de cinq ans** et leurs règlements, enregistrés par le dossier comme
  l'écran les envoie : chaque écriture d'achat, chaque imputation et chaque règlement est celui de la
  v10 (journal, date, compte, débit, crédit, dans l'ordre), l'achat en euros compris ; la TVA
  déductible et les retenues opérées de chaque mois, lues dans les écritures du serveur, sont celles
  que la v10 déclare.
- **150 familles tirées au hasard** (factures et dépenses en dinars, avoirs posés après des
  règlements, acomptes, remboursements) : les mêmes écritures que la v10. Les familles en devise ont
  leur banc au moteur, qui vérifie un à un les deux écarts tranchés.
- Un parcours à la main : la part de retenue du règlement (9,129, puis 11,453 quand l'acompte
  arrive), l'imputation de l'acompte, la régularisation de l'avoir (0,332) égale à celle que la
  lecture de la facture annonce, l'avoir détaché qui devient sa propre famille, le fournisseur
  renommé, l'avoir retiré, les comptes auxiliaires (401001), la famille validée qui refuse.
