# SkanFact, la plateforme — consignes pour Claude

*Créé le 28/09/2026, au premier code de la plateforme (J0 → étape 1).*

## Qui, quoi, où est la règle

- **Propriétaire** : Skander Ben Amor (saouthq). **Français, tutoiement**, mots simples : il ne tape
  pas de commandes ; Claude fait le travail (code, tests, commits, envois) et l'explique sans jargon.
- **Le cadrage fait foi, et il vit dans l'autre dépôt** : `saouthq/skanfact`
  (`/home/user/skanfact`) : `VISION-ARCHITECTURE.md`, `docs/cadrage/` (01 modèle de données,
  03 droits, 04 hors-ligne, 09 feuille de route, 12 pile technique…), et son `CLAUDE.md` (les
  leçons de la v10, qui valent ici). On **applique** le cadrage ; une décision nouvelle s'écrit
  **là-bas**, avec sa date. Ce qui est incertain (fiscal, légal) s'écrit « À VÉRIFIER ».
- **Où on en est** : étape 1, le socle (mois 1 à 4). Fait le 28/09/2026 : le dépôt, ses
  vérifications automatiques, la migration `0001_socle` (organisations, entreprises,
  établissements, personnes, membres, mandats, appareils, sécurité par ligne) et ses tests ; la
  connexion (`0002`, `serveur/connexion.ts`) ; l'équipe, la porte des droits et la trace (`0003`,
  `serveur/porte/`, `serveur/app.ts`, `serveur/routes/socle.ts`) ; les règles fiscales datées,
  la numérotation et le journal inaltérable (`0004`, `serveur/regles.ts`, `numeros.ts`,
  `journal.ts`) ; la file d'opérations des postes (`0005`, `serveur/file.ts`) ; le moteur commence :
  le calcul d'une pièce en entiers (`moteur/`) et le banc qui le compare à la v10 au millime
  (`banc/v10/`) ; les tiers et la facture de vente du brouillon à l'émission (`0006`,
  `serveur/ventes/`), avec **la première moitié du jalon J1** : les 273 factures de l'exemple de
  cinq ans émises par le serveur au millime de la v10 (`tests/ventes/j1-exemple.test.ts`).
  Kysely est branché (`requetes(tx)`, `base/types.ts` écrit par `base/generer-types.ts`) ;
  l'export et la restauration d'une entreprise (`base/entreprise.ts`). **Le jalon J1 est atteint.**
  Le catalogue des textes et la langue factice (`textes/`). Les clés de l'API, les adresses `/v1`
  et la documentation générée (`0007`, `serveur/cles.ts`, `GET /v1/documentation`). Le moteur
  d'écritures commence : l'écriture d'une facture de vente, au millime de la v10
  (`moteur/ecritures.ts`) ; ses règlements : la retenue née à chaque encaissement, le reste à payer,
  le statut, l'écriture de l'encaissement (`moteur/reglements.ts`) ; l'écriture d'un avoir (même
  fichier que la facture) ; les achats : calcul, écriture, imputation d'un acompte, règlements, reste et statut
  (`moteur/achats.ts`) ; la paie : le bulletin, ses écritures et la CNSS du trimestre
  (`moteur/paie.ts`) ; la TVA du mois lue dans les écritures (`moteur/declarations.ts`), égale à celle de la v10 sur cinq ans (deux chemins, un chiffre).
- Les limites d'appels par clé (`serveur/limites.ts`, 28/09/2026) : 600 par minute, rafales de 60,
  un seau par clé dans la mémoire du programme (à partager le jour où il y aura plusieurs programmes).
- Les avis d'événement signés (`0008`, `serveur/avis.ts`, 28/09/2026) : l'avis naît dans la
  transaction du fait, part signé, se renvoie puis s'abandonne. Le livreur (`livrerAvis`) tourne
  dans le programme serveur.
- La sauvegarde et l'exercice de restauration (`base/sauvegarde.ts`, 06 § 4.3) : dans les tests,
  sur une base à part (d'autres tests cassent des chaînes exprès dans la base commune). Ouvert :
  l'archivage continu à la minute, l'exercice mensuel sur le serveur de test et son rapport à la
  console.
- Le programme serveur (`serveur/principal.ts`, `npm run serveur`) : configuration par
  l'environnement, refus de démarrer si elle est fausse ; en production, exige un fournisseur de SMS
  (pas encore choisi : 03 § 6, 12) ; les messages à l'exploitant (`ConfigurationFausse`,
  `console.*`) sont hors du catalogue.
- **L'application web** (`web/`, étape 2 commencée le 28/09/2026) : React, Tailwind, Base UI. Le
  jeton de session vit dans l'onglet (sessionStorage), l'appareil reconnu dans le navigateur
  (localStorage) : décidé par délégation ; **À VÉRIFIER** le passage à un cookie que le JavaScript
  ne lit pas. Un écran se prouve par l'instrument de rendu (`tests/web/rendu.test.ts`) ET par un
  parcours à la souris (`tests/web/parcours.test.ts`), et ses photos (`dist/photos`) se regardent.
  Un bouton se trouve par ce qu'il dit (le catalogue), un écran par son titre.
- L'entreprise d'essai des développeurs (`0009`, 28/09/2026, par délégation) : une par personne,
  trois clients d'exemple, numéros « ESSAI », essai pour toujours. À respecter plus tard : jamais
  facturée par l'abonnement, jamais transmise à la TTN, « ESSAI » sur chaque document.
- **Ouvert** : les gestes « À reprendre » encore ouverts sont comptés dans l'export mais pas
  restaurés (à revoir avec la file, étape 2) ; la remise en place d'une entreprise **par-dessus**
  son état abîmé (06 § 4.4) n'existe pas encore : on ne restaure que là où elle n'est pas.

## Les règles de ce dépôt

**La base**
- **Toute table de données porte son entreprise** et a sa sécurité par ligne **activée et forcée**.
  Un test parcourt le catalogue et tombe si une table l'oublie.
- Le serveur ne touche la base **que par `enTantQue`** (`serveur/base.ts`) : une transaction, le nom
  de la personne posé pour cette transaction seulement. Jamais de connexion administrateur dans le
  serveur.
- Dans cette transaction, les requêtes d'un module s'écrivent avec **Kysely** : `requetes(tx)`
  (elles refusent de servir après la fin de leur transaction). Les appels aux fonctions du socle et
  les états lourds restent en SQL écrit à la main (`sql` de Kysely ou `tx.query`), toujours avec
  des paramètres, jamais du texte collé. La trace d'un geste : `tracer()` (`serveur/trace.ts`).
- **Après chaque migration** : `npm run types:base` réécrit `base/types.ts` (un test le vérifie).
- **Une table nouvelle se range** dans `CLASSEMENT` (`base/entreprise.ts`) : part avec
  l'entreprise, désignée par elle (sans secret), commune, ou jamais (avec sa raison). Sinon l'export
  refuse et un test tombe. Un lien sans clé étrangère que l'export doit suivre se déclare dans
  `LIENS_SANS_CONTRAINTE`.
  Un type de colonne nouveau se déclare d'abord dans `base/generer-types.ts`.
- Un entier de 64 bits se lit en `bigint` (jamais en texte à convertir, jamais en nombre à
  virgule) et sort de l'API en texte.
- Une fonction `security definer` est une porte dérobée : elle ne rend que ce qui concerne
  `socle.moi()`, fixe son `search_path`, et son droit d'exécution est retiré à `public`.
- Les fonctions `security definer` appartiennent au rôle qui applique les migrations : il doit
  passer au-dessus de la sécurité par ligne (super-utilisateur ou `bypassrls`), sinon elles ne voient
  rien. Un test le vérifie, avec le chemin fixé et le droit retiré au public.
- **Aucun taux dans le code ni dans les migrations** : les règles communes se chargent avec leur
  source (texte de loi), jamais inventées ; les tests utilisent des codes `essai.*`.
- **Une migration appliquée ne se modifie jamais** : on en écrit une nouvelle (`base/migrer.ts` le
  refuse). Deux temps pour retirer quelque chose (ajouter, puis retirer plus tard).
- Une migration qui **redéfinit** une fonction (`create or replace`) rend l'ancienne définition
  morte : les preuves qui la visaient se réorientent vers la nouvelle (sinon elles restent vertes,
  et `preuves.sh` les dit « non prouvées », comme le 28/09/2026 avec `mes_entreprises`).
- L'argent en **entiers** (`bigint`, millimes ou centimes), les taux et prix unitaires en entiers à
  six décimales (01 R3). Une date de pièce est un `date`, un geste est un `timestamptz` (01 R5).

**Les textes (14 § 5)**
- **Aucune phrase écrite en dur** dans le serveur : chaque texte qu'une personne peut lire est une clé
  du catalogue (`t(cle, valeurs)` pour un morceau, `motif(cle, valeurs)` pour une phrase entière ;
  `new Refus(cle, { valeurs, bouton })`). Le socle déclare ses textes dans `textes/socle.ts`, un
  module dans son propre `textes.ts` (chargé avec le module). Un test fait tomber la construction.
- Un texte se rend au dernier moment, dans la langue de celui qui lit (`rendreTout` dans
  `serveur/app.ts`). Ce qui est gardé en base pour être relu plus tard (le motif d'un geste « À
  reprendre ») s'y écrit en français.
- Une phrase écrite par la **base** (`socle.refus`, une règle de table) s'ajoute mot pour mot à
  `textes/base.ts`, avec la clé qui la dit : un test compare les migrations et cette liste.
- Chaque geste a son texte `geste.<code>` et chaque rôle `role.<code>` : un geste sans texte ne se
  déclare pas. Une vérification des données reçues donne une clé comme message (`'champ.jour'`,
  `cleDeVerification(cle, valeurs)`), jamais une phrase : le message anglais de la bibliothèque ne
  paraît jamais.
- La **langue factice** (`x-langue: factice`) : 40 % plus longue, accentuée ; elle servira à
  photographier les écrans (ce qui déborde, ce qui a échappé au catalogue).

**Le serveur**
- Une **clé de l'API** agit comme une personne : sa transaction est ouverte à SON nom
  (`enTantQueCle`, `app.cle_api`), jamais à celui de son créateur ; ses pièces portent le nom du
  créateur, sa trace le nom de la clé. Un geste qui gouverne l'entreprise porte `horsCle: true`
  (jamais donné à une clé). Toute adresse commence par `VERSION` (`/v1`).
- Une phrase qui place une valeur après « de » l'écrit `{de:nom}` : le catalogue élide
  (« d'émettre », « de voir »).
- **Chaque route déclare son geste** (`serveur/porte/gestes.ts`, recopié du tableau 03 § 2.1) ;
  sinon le serveur ne démarre pas. Un geste d'entreprise porte `:entreprise` dans son chemin.
- Une écriture sensible (rôles, équipe, propriété) passe par une **fonction de la base** qui applique
  la règle et **trace** ; le serveur n'a pas le droit d'écrire ces tables en direct.
- Une pièce légale : les contrôles, PUIS `prendreNumero` et `sceller` dans **la même transaction**
  que l'émission. Le contenu scellé passe par `canonique()` (clés triées, entiers seulement) ;
  `empreinte = sha256(précédente || contenu)`, la première précédente valant 64 « 0 ».
- Un module qui reçoit des gestes des postes déclare un `traitement()` (geste, formats lus, charge,
  `fait` si l'argent a bougé) ; le geste doit exister dans la porte, sinon le serveur ne démarre
  pas. Un objet changé depuis la lecture du poste : `throw new MiseDeCote(...)`, jamais écraser.
- Toute liste se **pagine** (curseur `instant|id` pour la trace, jamais une date seule).
- Un refus du métier se lève avec `serveur/erreurs.ts` : `Refus(message, bouton)` (ce qui est
  refusé, pourquoi, le geste qui débloque), `Introuvable` (404, sans dire si l'objet existe
  ailleurs), `Perimee` (409 : l'objet a changé depuis sa lecture, on ne l'écrase pas).
- L'argent entre et sort de l'API **en texte décimal** (« 1250.500 »), jamais en nombre à virgule ;
  un nombre saisi avec plus de décimales que sa précision est refusé, pas arrondi en silence.
- Une pièce émise se **relit** telle qu'elle a été émise (montants et copie stockés), jamais
  recalculée ; seul un brouillon se calcule à la lecture.

**Le moteur (`moteur/`)**
- Porté de `core.js` / `compta.js` fonction par fonction, **tests d'abord** ; chaque test garde la
  version de la v10 où sa règle est née (« 10.14.1 : … »).
- Tout en `bigint` : montants dans la plus petite unité de la devise, prix unitaires, taux et cours à
  six décimales, quantités en millièmes. L'ordre des arrondis est celui de la v10.
- Une écriture s'équilibre **exactement** : elle n'avale jamais un écart (un déséquilibre est un
  défaut, et il s'arrête). Les comptes lui sont donnés (le plan de l'entreprise) ; ses lignes disent
  leur nature (client, ventes, TVA, timbre, change, trésorerie, retenue), les libellés viendront du
  catalogue.
- Un écart de change se range selon son **sens** (un gain au crédit du 755, une perte au débit du
  655), comme la v10, jamais en contre-passant le compte de la pièce corrigée : la perte de conversion
  d'une facture devient un gain sur l'avoir identique.
- Une écriture d'achat en devise met son écart de **conversion** au change, comme les ventes
  (10.14.1) : la v10 l'avale encore sur la plus grosse ligne (écart tranché le 28/09/2026, vérifié
  ligne à ligne par le banc des écritures d'achat).
- Un montant **en devise** s'arrondit à l'unité de sa devise (le centime), jamais au millième :
  la v10 tient encore la part de retenue d'un règlement en euros au millième d'euro (écart tranché
  le 28/09/2026, au plus un centime par règlement, vérifié par le banc des règlements).
- Le **banc** (`tests/moteur/banc-v10.test.ts`, `ecritures-v10.test.ts`, `reglements-v10.test.ts`,
  `avoirs-v10.test.ts`, `achats-v10.test.ts`, `achats-ecritures-v10.test.ts`,
  `reglements-achats-v10.test.ts`, `paie-v10.test.ts` ;
  outils communs dans
  `tests/moteur/v10.ts`) compare chaque fonction portée à la v10 figée dans
  `banc/v10/` (jamais modifiée ; remplacée quand la v10 reçoit une correction de calcul) : l'exemple
  de cinq ans et 20 000 pièces tirées au hasard. Un écart ne se tolère pas : il se **tranche** (en
  fractions exactes), s'écrit dans la liste du banc avec sa raison, et sa situation devient un test.

**Les tests**
- Contre un **vrai PostgreSQL** (`PG_ADMIN`), jamais contre une imitation.
- **Chaque test se prouve** : `tests/preuves.sh` remet le défaut et vérifie que le test tombe. Un test
  nouveau vient avec sa ligne dans ce script.
- Avant tout envoi : `npm run verifier` (types, lint 0 erreur 0 avertissement, tests) et
  `npm run preuves`. Lire le **code de sortie**. GitHub refait tout à chaque envoi ; une construction
  rouge ne se contourne jamais.

**Sécurité (sans exception)**
- Dépôt **public** : jamais de secret, de jeton, de mot de passe réel ni de donnée de client. Les
  mots de passe de test sont tirés au hasard à chaque lancement.
- Jamais le nom ni le matricule de la société de Skander dans le code, les exemples ou les textes
  (règle détaillée dans le `CLAUDE.md` de l'application).
- Jamais une donnée de plus dans ce qui part vers un serveur tiers sans que la liste soit comptée et
  décidée.

**Git**
- Branche **`main`** pour l'instant (dépôt neuf, pas encore de publication). Pas de PR sans demande.
- Messages de commit en français, terminés par les lignes `Co-Authored-By` et `Claude-Session`
  fournies par la session. Aucun identifiant de modèle dans ce qui est envoyé.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run verifier` | Types, lint, tests (il faut `PG_ADMIN`) |
| `npm run preuves` | Chaque défaut remis dans une copie, chaque test doit tomber |
| `npm run migrer` | Applique les migrations sur la base de `PG_ADMIN` |
| `npm run entreprise -- exporter <id> <fichier>` / `restaurer <fichier>` | Exporte une entreprise, ou la restaure là où elle n'est pas (`PG_ADMIN`) |
| `npm run types:base` | Réécrit `base/types.ts` à partir des migrations (base jetable sur `PG_ADMIN`) |

Dans une session Claude : PostgreSQL 16 tourne sur `127.0.0.1:5433`
(`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgproto/data -o '-p 5433' start"`
s'il est arrêté), donc `PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres`.
