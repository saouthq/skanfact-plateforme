# Ce qu'une console partenaire lit de la facturation

*01/10/2026, brique 127. Demandé par Skander le 01/10/2026 : SkanEcom (sa plateforme de boutiques en ligne, dépôt
`saouthq/skanecom`) ne refait pas la facturation dans sa console : elle facture **dans SkanFact** et lit ce qu'il lui
faut par l'API. La liste vient de la session qui construit SkanEcom (P1 : lister les factures à payer d'un client, sa
situation en un appel, le retrouver par son matricule, des événements « règlement enregistré » et « facture réglée »,
un lien vers l'écran de SkanFact ; P2 : les factures périodiques). Elle servira à toute console partenaire.*

La brique 127 fait les **lectures** (S1 à S5), la brique 128 les **événements** (S6), la brique 129 les **factures
périodiques émises seules** (S7).

## Comment la console lit

Avec **une clé de l'API** de l'entreprise (`POST /v1/entreprises/:e/cles-api`, montrée une seule fois), envoyée en
`Authorization: Bearer skf_…`. Pour lire, une clé n'a besoin que du geste **`ventes.pieces.voir`**. Une clé ne signe
pas, n'envoie rien à la TTN, ne crée pas de lien de partage et ne touche pas aux réglages du paiement : ces gestes
restent à une personne.

L'argent sort toujours **en texte décimal**, avec les décimales de sa devise (`"1073.190"` en dinars, `"100.00"` en
euros), jamais en nombre à virgule. Une date est un **jour** (`AAAA-MM-JJ`).

## S1. Retrouver un client par son matricule

`GET /v1/entreprises/:e/clients?identifiant=1234567A/M/000`

Les espaces et la casse ne comptent pas, ni dans ce qui est cherché, ni dans ce qui est rangé (`1234567 a/M/000` est
trouvé). La réponse est la liste des clients (`{ clients: [...], suite }`), chacun avec `id`, `raison_sociale`,
`nature`, `identifiant` (tel qu'il est rangé), `pays`, `devise` et **`ecran`** (S5). Aucun client : une liste vide.

## S2. Les factures d'un client qui restent à payer

`GET /v1/entreprises/:e/ventes?type=facture&client=<id>&aPayer=1`

- `client` : l'`id` du client (S1). Un `id` mal écrit est refusé (400, `champ: "client"`).
- `aPayer=1` : seulement les factures émises qui doivent encore quelque chose (règlements et avoirs retranchés, par la
  même fonction que l'écran d'une facture). Il ne vaut que pour `type=facture` (sinon 400, `champ: "aPayer"`). Un
  brouillon ne doit jamais rien.
- Les plus récentes d'abord, par pages (`limite`, 50 par défaut, 200 au plus) ; `suite` est le curseur de la page
  suivante (`&avant=<suite>`), `null` à la fin. Avec `aPayer`, `total` vaut `null` (il faudrait tout relire pour le
  dire) ; sans, c'est le nombre de pièces du client.

Chaque ligne : `id`, `numero`, `datePiece`, **`echeance`**, `devise`, `symbole`, `netAPayer`, **`reste`**,
**`clientId`**, `client` (le nom figé sur la facture), `objet`, `statut`, `type`, **`ecran`** (S5).

## S3. La situation d'un client en un appel

`GET /v1/entreprises/:e/clients/:client/situation`

```json
{
  "client": { "id": "…", "raisonSociale": "Menuiserie du Lac", "identifiant": "1234567 a/M/000", "ecran": "/v10/?e=…#/client/…" },
  "au": "2026-10-01",
  "soldes": [
    { "devise": "TND", "reste": "2919.570", "echu": "1846.380", "facturesAPayer": 3, "facturesEchues": 2 },
    { "devise": "EUR", "reste": "100.00", "echu": "0.00", "facturesAPayer": 1, "facturesEchues": 0 }
  ],
  "retard": { "depuis": "2026-08-17", "jours": 45, "numero": "FAC-2026-003", "ecran": "/v10/?e=…#/doc/…" },
  "dernierReglement": { "date": "2026-09-21", "montant": "1000.000", "devise": "TND", "facture": "FAC-2026-002" }
}
```

- **`au`** : le jour où le calcul est fait, à Tunis. Une facture est **échue** quand son échéance est **avant** ce jour
  (le jour même de son échéance, elle ne l'est pas encore).
- **`soldes`** : une ligne **par devise** ; des euros ne s'additionnent jamais à des dinars. Aucune facture à payer :
  une liste vide.
- **`retard`** : la facture échue à l'échéance la plus ancienne, et depuis combien de jours ; `null` si rien n'est échu.
- **`dernierReglement`** : le plus récent par sa date (le même jour, le dernier saisi) ; un remboursement y compte, en
  négatif. `null` s'il n'y en a aucun.
- Ce qui n'est pas un client de l'entreprise (un fournisseur, le client d'une autre entreprise, un `id` mal écrit)
  n'existe pas : 404.

**Deux chemins, un chiffre** : `reste` d'une devise est la somme des `reste` des factures de S2 dans cette devise.

## S4. Ce que la console ne peut pas faire

Lire n'écrit rien. Une clé ne voit que son entreprise. Pour émettre une facture, la console passe par
`POST /v1/entreprises/:e/ventes` puis `POST /v1/entreprises/:e/ventes/:piece/emettre` (geste `ventes.facture.emettre` sur la clé) ; la signature et
l'envoi à la TTN restent à une personne, dans SkanFact.

## S5. Le lien vers l'écran de SkanFact

`ecran` est une adresse **relative** au serveur de SkanFact (`/v10/?e=<entreprise>#/doc/<pièce>` ou
`…#/client/<client>`) : la console la préfixe de l'adresse qu'elle appelle déjà. La personne qui l'ouvre se connecte
à SkanFact avec **son** compte (le lien ne donne aucun droit) : la connexion la ramène à la page du lien, dans
l'entreprise du lien, qui devient celle qui s'ouvre la fois suivante. Le lien d'une entreprise qui n'est pas la sienne
mène à son accueil habituel (`tests/web/lien-ecran.test.ts`). Seules les pièces et les fiches nées des écrans en ont
un ; les autres : `null`.

## S6. Les événements : « règlement enregistré » et « facture réglée » (brique 128)

La console s'abonne une fois (`POST /v1/entreprises/:e/avis-abonnements`, une personne, pas une clé :
`{ "url": "https://…", "evenements": ["reglement.enregistre", "facture.reglee"] }`), garde le secret montré une seule
fois, et reçoit chaque avis signé (`skanfact-signature: t=…,v1=…`, comme `facture.emise`). Un avis naît dans la
transaction du fait : ce qui est refusé n'annonce rien ; un échec de livraison se renvoie (1 min, 5 min, 30 min…).

**`reglement.enregistre`** : chaque règlement **nouveau** d'une facture, d'où qu'il vienne (l'écran, le paiement en
ligne) ; un règlement modifié, ou renvoyé tel quel, n'en refait pas. Pas pour un ticket de caisse (payé dans son
geste).

```json
{ "id": "…", "date": "2026-09-20", "montant": "300.000", "mode": "virement", "reference": "VIR 17", "devise": "TND",
  "facture": { "id": "…", "numero": "FAC-2026-001", "ecran": "/v10/?e=…#/doc/…" },
  "client": { "id": "…", "raisonSociale": "Menuiserie du Lac" }, "reste": "773.190" }
```

**`facture.reglee`** : une facture qui devait encore quelque chose et ne doit plus rien, **une seule fois** (un
trop-perçu ensuite ne la re-règle pas). `par` dit comment : `"reglement"` (`date` : le jour du règlement le plus
récent) ou `"avoir"` (un avoir qui la solde ; `date` : le jour de l'avoir).

```json
{ "id": "…", "numero": "FAC-2026-001", "ecran": "/v10/?e=…#/doc/…", "client": { "id": "…", "raisonSociale": "…" },
  "devise": "TND", "netAPayer": "1073.190", "date": "2026-09-20", "par": "reglement" }
```

Un règlement retiré qui fait de nouveau devoir la facture n'a pas (encore) d'événement : la console relit la
situation (S3) si elle en a besoin. **À VÉRIFIER** avec la session SkanEcom : en a-t-elle besoin ?

## S7. Les factures périodiques émises seules (brique 129)

Un contrat de **Facturation récurrente** (l'écran de la v10 : client, période mensuelle, trimestrielle ou annuelle, jour
du mois, lignes, objet avec `{mois}` et `{annee}`) peut être **« Émise seule »** : à sa date, SkanFact fabrique la
facture comme « Générer les brouillons » la fabrique, puis **l'émet lui-même**, avec le numéro de sa série, au nom du
propriétaire. La console reçoit `facture.emise` (puis `reglement.enregistre` et `facture.reglee` quand elle est payée).

- **Qui** : seuls le propriétaire et l'administrateur cochent ou décochent « Émise seule » (refusé jusque dans la base
  pour les autres ; la case est grisée pour eux). Émettre engage l'entreprise : un numéro légal ne se reprend pas.
- **Quand** : le serveur fait son tour au démarrage, puis **chaque heure**. Une période manquée (le serveur arrêté) se
  rattrape, une facture par période, **12 au plus par tour** (comme la v10). Le « 31 du mois » devient le dernier jour
  d'un mois plus court, puis revient au 31.
- **Jamais deux fois** : l'identifiant de la facture dit son contrat et sa date (`contrat-<contrat>-<date>`) ; un
  second tour, ou une date de contrat remise en arrière, ne la refait pas.
- **Un refus** (un client supprimé, une fiche incomplète pour la facture électronique…) n'émet rien : la fiche du
  contrat dit pourquoi (« La facture du … n'a pas pu être émise : … »). Corrigé (« Modifier »), le contrat se retente au
  tour suivant ; sinon, le lendemain.
- **Ce qui reste à une personne** : la signature et l'envoi à la TTN, comme pour toute facture.
- Un contrat émis seul ne propose plus de brouillon (ni dans sa fiche, ni dans le compteur du menu).

**À VÉRIFIER** (avec le comptable et l'avocat) : qu'une facture puisse être émise sans qu'une personne la relise ; le
délai pour la signer et la déposer à la TTN quand l'entreprise y est soumise ; la date d'une facture rattrapée (celle de
sa période, comme la v10, ou celle du jour de l'émission).

**Pour SkanEcom** : un contrat par boutique abonnée, dans l'entreprise qui facture (SkanEcom), « Émise seule ». La
création des contrats par l'API (sans passer par l'écran) n'est pas encore là : une brique suivante, si la console en
a besoin.

## Les preuves

`tests/v10/api-situation.test.ts`, `tests/web/lien-ecran.test.ts`, `tests/v10/api-evenements.test.ts`,
`tests/v10/contrats-seuls.test.ts` et `tests/web/contrats-seuls.test.ts`, et 82 défauts réintroduits (`tests/preuves.sh`, « Brique 127 ») : le matricule
cherché ou rangé avec ses espaces ou ses minuscules, les factures réglées gardées, un brouillon chiffré compté, la page
qui déborde ou relit le même lot, les euros additionnés aux dinars, une facture échue le jour de son échéance, le retard
compté depuis la mauvaise facture, le dernier règlement d'un autre client ou le plus ancien, un lien d'écran inventé,
le lien oublié pendant la connexion ou suivi vers l'entreprise d'un autre, un ticket annoncé, une facture réglée deux
fois ou datée du plus ancien règlement, un avoir qui solde sans avis, un contrat ordinaire ou suspendu émis, treize
périodes d'un coup, une facture refaite, un trimestre avancé d'un mois, le 31 septembre, un commercial qui coche
« Émise seule », un serveur redémarré qui attend une heure…

## Vu à la main (01/10/2026)

Sur l'écran virtuel : la console lit la situation de « Menuiserie du Lac » (773,190 DT dus, échus depuis 16 jours,
dernier règlement de 300 DT) ; son lien, tapé dans la barre d'adresse **sans être connecté**, menait à la connexion
puis à **l'Accueil** — le lien était perdu. Réparé : la connexion ramène à la facture FAC-2026-001.
