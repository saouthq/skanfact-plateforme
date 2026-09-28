# SkanFact — la plateforme

La nouvelle version de SkanFact : gestion commerciale, caisse, paie et comptabilité pour les
entreprises tunisiennes, avec leur cabinet comptable dans les mêmes données. Un serveur qui fait
foi, une application web installable qui marche pendant les coupures, hébergée en Tunisie.

**En construction** (étape 1, « le socle », commencée le 28/09/2026). Pas de lancement public avant
que la plateforme soit complète. L'application actuelle (v10) vit dans
[`saouthq/skanfact`](https://github.com/saouthq/skanfact), avec **tout le cadrage** :
`VISION-ARCHITECTURE.md` et `docs/cadrage/` (modèle de données, droits, hors-ligne, pile technique,
feuille de route…). Ce dépôt applique ce cadrage ; il ne le réécrit pas.

## Ce qui existe

| Où | Quoi |
|---|---|
| `base/migrations/` | Les migrations de la base, numérotées. `0001_socle.sql` : organisations, entreprises, établissements, personnes, membres et leurs rôles, mandats des cabinets, appareils, et la **sécurité par ligne** |
| `base/migrer.ts` | Applique les migrations dans l'ordre ; refuse une migration déjà appliquée puis modifiée |
| `serveur/base.ts` | Le seul accès du serveur à la base : `enTantQue(personne, travail)` |
| `base/migrations/0002_connexion.sql`, `serveur/connexion.ts` | Se connecter : mot de passe (Argon2id, liste de mots de passe volés gardée chez nous), attente qui s'allonge après 5 erreurs, code sur le téléphone (SMS ou application), 10 codes de secours, appareils reconnus 30 jours, sessions (12 h d'inaction, 30 min sur le poste d'un autre), révocation |
| `base/migrations/0003_equipe_et_trace.sql` | L'équipe (inviter, accepter, changer un rôle, retirer, transférer la propriété) avec ses règles : toujours un propriétaire, personne ne se donne un droit ; et la **trace** de chaque geste, découpée par mois, qui ne se modifie ni ne s'efface |
| `serveur/porte/` | La **porte des droits** : chaque geste déclaré avec les rôles qui le font (le tableau du cadrage), et `peut()` qui répond toujours ce qui est refusé, pourquoi, et qui peut |
| `serveur/app.ts`, `serveur/routes/` | Le serveur web : une route qui ne déclare pas son geste empêche le démarrage ; chaque route passe par la porte, travaille au nom de la personne connectée, et rend un refus lisible |
| `base/migrations/0004_regles_numeros_chaine.sql`, `serveur/regles.ts`, `serveur/numeros.ts`, `serveur/journal.ts` | Les **règles fiscales datées** (une loi de finances ajoute des lignes, une règle inconnue vaut « non renseignée », jamais un chiffre inventé), la **numérotation** (prise dans la transaction qui émet : un refus ne troue jamais la série ; une série commencée ailleurs continue) et le **journal inaltérable** (chaque pièce scellée est un maillon d'une chaîne d'empreintes ; modifier, retirer ou réécrire le passé se voit au contrôle) |
| `tests/` | Les tests, contre un vrai PostgreSQL, et `preuves.sh` qui remet chaque défaut pour vérifier que son test tombe |

À venir dans l'étape 1 (`docs/cadrage/09-feuille-de-route.md` dans le dépôt de l'application) : le moteur de calcul porté avec
ses tests et le banc qui le compare à la v10 au millime, la file d'opérations, le catalogue de
textes, les clés de l'API, l'export et la restauration d'une entreprise.

## Comment la base protège les données

Le serveur se connecte avec un compte rattaché au rôle `skanfact_app`, qui ne passe **jamais**
au-dessus de la sécurité par ligne. À chaque transaction, il dit qui agit
(`app.utilisateur`) ; la base ne lui montre alors que les entreprises de cette personne :
- celles dont elle est membre, ou dont elle est membre de l'organisation (un groupe) ;
- pour un cabinet : celles où il a un **mandat actif**, si le dossier est confié à la personne ou
  si elle supervise le cabinet.

Sans nom, la base ne montre rien. Les tests le prouvent table par table, et chaque protection se
prouve en la retirant (`npm run preuves`).

## Lancer les vérifications

Il faut Node.js 22.18 ou plus récent, et un PostgreSQL 16 dont on donne l'adresse d'un compte
d'administration (les tests créent et jettent une base `skanfact_test`) :

```bash
npm install
export PG_ADMIN=postgres://postgres@127.0.0.1:5432/postgres
npm run verifier        # types, lint, tests
npm run preuves         # chaque défaut remis, chaque test doit tomber
```

GitHub fait la même chose à chaque envoi (`.github/workflows/verifier.yml`), avec en plus une
recherche de secrets : ce dépôt est public, **aucun secret n'y entre jamais**.
