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
| `serveur/base.ts` | Le seul accès du serveur à la base : `enTantQue(personne, travail)`, et dans cette transaction `requetes(tx)`, les requêtes écrites avec **Kysely**, vérifiées par les types |
| `base/types.ts`, `base/generer-types.ts` | La forme de chaque table, **écrite par notre script** à partir des migrations (`npm run types:base`) ; un test tombe si elle ne suit plus la base |
| `base/migrations/0002_connexion.sql`, `serveur/connexion.ts` | Se connecter : mot de passe (Argon2id, liste de mots de passe volés gardée chez nous), attente qui s'allonge après 5 erreurs, code sur le téléphone (SMS ou application), 10 codes de secours, appareils reconnus 30 jours, sessions (12 h d'inaction, 30 min sur le poste d'un autre), révocation |
| `base/migrations/0003_equipe_et_trace.sql` | L'équipe (inviter, accepter, changer un rôle, retirer, transférer la propriété) avec ses règles : toujours un propriétaire, personne ne se donne un droit ; et la **trace** de chaque geste, découpée par mois, qui ne se modifie ni ne s'efface |
| `serveur/porte/` | La **porte des droits** : chaque geste déclaré avec les rôles qui le font (le tableau du cadrage), et `peut()` qui répond toujours ce qui est refusé, pourquoi, et qui peut |
| `serveur/app.ts`, `serveur/routes/` | Le serveur web : une route qui ne déclare pas son geste empêche le démarrage ; chaque route passe par la porte, travaille au nom de la personne connectée, et rend un refus lisible |
| `base/migrations/0004_regles_numeros_chaine.sql`, `serveur/regles.ts`, `serveur/numeros.ts`, `serveur/journal.ts` | Les **règles fiscales datées** (une loi de finances ajoute des lignes, une règle inconnue vaut « non renseignée », jamais un chiffre inventé), la **numérotation** (prise dans la transaction qui émet : un refus ne troue jamais la série ; une série commencée ailleurs continue) et le **journal inaltérable** (chaque pièce scellée est un maillon d'une chaîne d'empreintes ; modifier, retirer ou réécrire le passé se voit au contrôle) |
| `base/migrations/0005_file.sql`, `serveur/file.ts`, `serveur/routes/file.ts` | La **file d'opérations** des postes : un geste envoyé deux fois ne compte qu'une fois, les gestes d'un appareil se rejouent dans l'ordre (un trou arrête la file et dit lequel manque), chacun passe par la porte ; un geste refusé ou mis de côté n'est jamais jeté mais va dans « À reprendre », qui ne se vide que par un geste ; un **fait** (ticket, règlement) n'est jamais refusé, il attend la décision du propriétaire |
| `moteur/` | **Le moteur de calcul**, porté de la v10 en TypeScript, **en entiers** (`bigint`) : `argent.ts` (l'arrondi, les nombres écrits) et `piece.ts` (le calcul d'une pièce : lignes, remise, TVA par taux, timbre, retenue, net à payer). Pur : il ne lit ni la base ni les règles |
| `moteur/ecritures.ts` | **Le moteur d'écritures commence** : l'écriture d'une facture de vente au journal des ventes (client au brut, ventes et TVA par taux, timbre en dinars, écart de conversion au change), équilibrée exactement, sans jamais avaler un écart. Et l'écriture d'un **avoir** : à l'envers, le client crédité au cours de SA facture (l'écart de cours au change), la retenue déjà née régularisée à la date de l'avoir. Les bancs (`tests/moteur/ecritures-v10.test.ts`, `avoirs-v10.test.ts`) les comparent à celles de la v10 : les 273 factures et les avoirs de l'exemple, 10 000 factures et 5 000 avoirs tirés au hasard, compte par compte, au millime |
| `moteur/reglements.ts` | **Les règlements d'une facture** : la retenue à la source que le client garde, née à chaque encaissement au prorata de ce qu'il verse (celui qui solde prend le reste ; un avoir posé après un règlement régularise à sa date, sans réécrire un mois déclaré) ; le reste à payer et le statut (payée, partielle, en retard, annulée par ses avoirs) ; l'écriture de l'encaissement (la banque au cours du jour, le client au cours de sa facture, l'écart au change, un remboursement à l'envers). Le banc (`tests/moteur/reglements-v10.test.ts`) : l'exemple de cinq ans et 5 000 factures tirées au hasard, avec avoirs, remboursements et cours du jour |
| `moteur/achats.ts` | **Les achats** : le calcul d'un achat (lignes au millime, TVA non déductible qui grossit le coût, frais, retenue ; les montants dans la devise de la pièce et en dinars, signés, un acompte qui n'est pas une charge mais une avance), son écriture (charges, stock ou immobilisations, frais, TVA déductible, fournisseur au brut ; un avoir rattaché réglé au cours de sa facture, la retenue régularisée) l'imputation d'un acompte sur sa facture, et ses **règlements** (la retenue opérée née à chaque paiement, le fournisseur soldé au cours de sa facture, la banque au cours du jour, un avoir remboursé à l'envers ; le reste et le statut). En devise, l'écart de conversion va au change (la v10 l'avalait sur la plus grosse ligne). Bancs : les achats de l'exemple, 20 000 achats et deux fois 3 000 factures d'achat tirées au hasard avec avoirs, acomptes, remboursements et règlements |
| `moteur/paie.ts` | **La paie** : le bulletin (absence au prorata des jours ouvrables, primes imposables ou non, CNSS, frais professionnels plafonnés, déductions de famille, IRPP au barème progressif annuel ramené au mois, contribution de solidarité, charges patronales), sans aucun taux écrit dans le code : le barème est donné, fusionné avec le régime du contrat ; l'écriture du bulletin et celle du salaire versé ; la **déclaration CNSS du trimestre**, dont le total est ce que le compte CNSS a reçu. Banc : les 78 bulletins de l'exemple, 20 000 bulletins tirés au hasard avec barèmes et régimes variés, et les écritures de 3 000 mois |
| `moteur/declarations.ts` | **Les déclarations lues dans les livres** : la TVA du mois (collectée, déductible, crédit reporté d'un mois sur l'autre, à payer), les timbres, les retenues subies et opérées, calculées à partir des écritures. Deux chemins, un chiffre : le banc (`tests/moteur/declarations-v10.test.ts`) reconstruit tout le journal de l'exemple avec le nouveau moteur (`tests/moteur/journal-v10.ts`) et exige, mois par mois sur cinq ans, le chiffre que la v10 obtient en additionnant les pièces |
| `banc/v10/` | Une copie figée du moteur de la v10 et de son exemple de cinq ans : le **banc** (`tests/moteur/banc-v10.test.ts`) fait calculer les mêmes pièces aux deux moteurs et exige le même millime ; un écart se tranche et s'écrit |
| `base/migrations/0006_tiers_et_ventes.sql`, `serveur/ventes/` | Les **tiers** (clients) et la **facture de vente**, du brouillon à l'émission : le brouillon se calcule à chaque lecture ; l'émission contrôle tout **avant** de prendre le numéro, garde une **copie** de ce qui a servi (société, client, timbre), fige les montants et scelle la facture dans la chaîne de sa série. Une facture émise ne se modifie ni ne s'efface plus (la base le refuse) ; un brouillon modifié par quelqu'un d'autre entre-temps n'est jamais écrasé |
| `tests/ventes/j1-exemple.test.ts` | **Le jalon J1** : les 273 factures de l'exemple de cinq ans de la v10, saisies en brouillon et émises par le serveur, portent au millime les montants de la v10 ; leurs numéros se suivent sans trou chaque année et leur chaîne se contrôle en relisant chaque facture |
| `base/entreprise.ts` | **Exporter UNE entreprise et la restaurer à l'identique** (`npm run entreprise -- exporter <id> <fichier>`, puis `restaurer <fichier>`) : chaque table de la base est rangée (part avec l'entreprise, désignée par elle, commune, ou jamais), aucun secret de connexion ne part, les lignes vont de la base au fichier et retour sans passer par JavaScript, un fichier abîmé ou une base à un autre niveau de migrations est refusé, tout lien restauré doit mener quelque part, et la restauration laisse sa trace |
| `base/migrations/0010_listes_paginees.sql` | **Les listes des écrans se paginent** : `GET /v1/entreprises/:e/ventes?type=facture&avant=…` (la plus récente d'abord ; une facture émise montre le client de sa copie figée et son net à payer) et `GET /v1/entreprises/:e/clients?apres=…` (par ordre alphabétique), par un curseur opaque qui garde l'identifiant de la dernière ligne vue : jamais une ligne sautée ni vue deux fois, même à clé égale |
| `base/migrations/0009_entreprise_essai.sql` | **L'entreprise d'essai des développeurs** (14 § 2.5) : `POST /v1/entreprises-essai`, une par personne, garnie de trois clients d'exemple (une société, une personne, un client étranger en euros), ses factures numérotées « ESSAI », marquée essai pour toujours (une vraie entreprise ne le devient jamais). Plus tard, elle ne sera jamais facturée ni transmise à la TTN |
| `base/sauvegarde.ts` | **La sauvegarde et l'exercice de restauration** (06 § 4.3) : `npm run sauvegarde -- sauvegarder <fichier>` fait la sauvegarde de toute la base et, dans le même instantané, son manifeste (migrations, lignes de chaque table, bout de chaque chaîne, empreinte du fichier) ; `npm run sauvegarde -- exercice <fichier>` la restaure sans aide dans une base vide, vérifie l'empreinte, les migrations, les lignes de chaque table, chaque chaîne d'empreintes maillon par maillon et que chaque série a scellé autant de maillons qu'elle compte de pièces émises, mesure le temps, et dit tout ce qui ne va pas |
| `base/migrations/0007_cles_api.sql`, `serveur/cles.ts` | **Les clés de l'API** (03 § 8) : créées par le propriétaire ou l'administrateur, montrées une seule fois (la base n'en garde que l'empreinte), une liste de gestes permis à leur créateur et jamais ceux qui gouvernent l'entreprise, une expiration dans l'année, la révocation ; une clé ne voit que son entreprise, et sa trace porte son nom. Toutes les adresses commencent par **`/v1`**, et **`GET /v1/documentation`** décrit chaque route (OpenAPI), écrite depuis le code. **Des limites d'appels par clé** (`serveur/limites.ts`) : 600 appels par minute, des rafales de 60 ; au-delà, « trop d'appels » (429) avec l'attente à respecter |
| `base/migrations/0008_avis.sql`, `serveur/avis.ts` | **Les avis d'événement** (14 § 2.5) : une entreprise abonne une adresse https à des événements (une facture émise, pour commencer) ; l'avis naît dans la transaction même du fait (une émission qui échoue n'annonce rien) ; il part **signé** (HMAC-SHA256 de l'horodatage et du corps, avec un secret montré une seule fois et que le serveur ne peut pas relire), l'argent en texte ; un échec se renvoie à 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, puis l'avis est abandonné et l'historique le dit ; deux livreurs n'envoient jamais le même avis ; aucune adresse privée ou locale n'est jamais atteinte |
| `serveur/principal.ts` | **Le programme serveur** (`npm run serveur`) : il lit sa configuration dans l'environnement (jamais dans le dépôt) et refuse de démarrer si elle est fausse, écoute, fait tourner le livreur des avis, s'arrête proprement. Tant que le fournisseur de SMS tunisien n'est pas choisi, il ne démarre qu'en test, et un code par SMS n'y part jamais en silence : la personne est invitée à choisir une application d'authentification |
| `textes/` | **Le catalogue des textes** (14 § 5) : chaque phrase qu'une personne peut lire vient d'une clé du catalogue (le socle ici, chaque module dans son `textes.ts`) ; les phrases que la base écrit elle-même y sont reconnues mot pour mot ; une **langue factice** 40 % plus longue (en-tête `x-langue: factice`) montre ce qui déborde et ce qui a échappé au catalogue. Un test fait tomber la construction si une phrase est écrite en dur dans le serveur |
| `web/` | **L'application web commence** (étape 2 ; 12 § 4 : React, Tailwind, Base UI, les outils de Slate) : se connecter, créer son compte, le code du téléphone, mes entreprises, l'entreprise d'essai ; **les factures** : la liste (la plus récente d'abord, par pages), la saisie d'un brouillon (nombres tapés à la tunisienne, taux de TVA proposés par la règle `tva.taux` du jour et jamais fermés), la relecture des montants calculés par le serveur, l'émission qui demande d'abord, un nouveau client. L'adresse dit l'écran (`#/e/…`) : le bouton « retour » du navigateur marche. **À venir : l'habillage de la v10** (décision de Skander, 28/09/2026 : sa feuille de style reprise telle quelle, chaque écran repris du sien). Chaque phrase vient du catalogue ; chaque champ a son « i » ; un refus se montre sur son champ ; un seul bouton principal par écran. Le programme serveur sert les écrans à côté de l'API (même origine), avec des en-têtes qui interdisent tout script venu d'ailleurs |
| `tests/web/` | **L'instrument de rendu** : chaque écran ouvert dans un vrai navigateur, à la largeur d'un téléphone (390) et d'un ordinateur (1 440), en français et en langue factice ; la construction tombe si une page déborde, si une cible fait moins de 44 points, si un texte est coupé ou si une phrase a échappé au catalogue ; chaque écran est photographié (`dist/photos`). Et **les parcours joués à la souris** : du compte créé au retour d'un autre appareil avec le code ; une facture du brouillon à l'émission (un taux illisible refusé sous son champ, une panne du serveur dite, une correction, l'émission qui demande d'abord, un nouveau client, un brouillon supprimé). `nombres.test.ts` : l'argent à l'écran, au millime |
| `tests/` | Les tests, contre un vrai PostgreSQL, et `preuves.sh` qui remet chaque défaut pour vérifier que son test tombe |

**Le jalon J1 est atteint** (28/09/2026) : les factures de l'exemple de cinq ans émises au millime de
la v10, l'entreprise exportée puis restaurée à l'identique, et la voisine qui ne lit rien, par aucune
table.

À venir dans l'étape 1 (`docs/cadrage/09-feuille-de-route.md` dans le dépôt de l'application) : la
suite du moteur porté (la déclaration d'employeur, les états de fin d'année) ; la sauvegarde
continue (à la minute) et l'exercice chaque mois sur le serveur de test, rapporté à la console
(06 § 4) ; le fournisseur de SMS (03 § 6, à choisir), sans lequel la production ne démarre pas.

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
npm run preuves:paralleles   # les mêmes, en quatre groupes côte à côte
npm run web             # construit l'application web (dist/web), que `npm run serveur` sert
```

Les tests des écrans ouvrent Chromium par Playwright : `npx playwright-core install chromium` la
première fois.

GitHub fait la même chose à chaque envoi (`.github/workflows/verifier.yml`), avec en plus une
recherche de secrets : ce dépôt est public, **aucun secret n'y entre jamais**.
