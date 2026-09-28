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
  établissements, personnes, membres, mandats, appareils, sécurité par ligne) et ses tests.

## Les règles de ce dépôt

**La base**
- **Toute table de données porte son entreprise** et a sa sécurité par ligne **activée et forcée**.
  Un test parcourt le catalogue et tombe si une table l'oublie.
- Le serveur ne touche la base **que par `enTantQue`** (`serveur/base.ts`) : une transaction, le nom
  de la personne posé pour cette transaction seulement. Jamais de connexion administrateur dans le
  serveur.
- Une fonction `security definer` est une porte dérobée : elle ne rend que ce qui concerne
  `socle.moi()`, fixe son `search_path`, et son droit d'exécution est retiré à `public`.
- **Une migration appliquée ne se modifie jamais** : on en écrit une nouvelle (`base/migrer.ts` le
  refuse). Deux temps pour retirer quelque chose (ajouter, puis retirer plus tard).
- L'argent en **entiers** (`bigint`, millimes ou centimes), les taux et prix unitaires en entiers à
  six décimales (01 R3). Une date de pièce est un `date`, un geste est un `timestamptz` (01 R5).

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

Dans une session Claude : PostgreSQL 16 tourne sur `127.0.0.1:5433`
(`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgproto/data -o '-p 5433' start"`
s'il est arrêté), donc `PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres`.
