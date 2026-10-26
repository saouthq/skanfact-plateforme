# SkanFact, la plateforme — consignes pour Claude

*Créé le 28/09/2026. **Ce fichier est relu à chaque échange de chaque session : il reste court** (32 000 octets au
plus, tenu par `tests/socle/consignes.test.ts`). Le 13/10/2026, les deux `CLAUDE.md` relus à chaque échange pesaient
860 Ko, et la conversation se compactait toutes les dix minutes. Ce qui est fait, brique par brique, et la règle que
chaque brique a apprise vivent dans **`docs/carte.md`** et dans le `docs/<domaine>.md` de chaque domaine. Ici n'entre
qu'une règle qui vaut pour TOUT le dépôt, en une ou deux lignes.*

## Qui, quoi, où est la règle

- **Propriétaire** : Skander Ben Amor (saouthq). **Français, tutoiement**, mots simples : il ne tape
  pas de commandes ; Claude fait le travail (code, tests, commits, envois) et l'explique sans jargon.
- **Le cadrage fait foi, et il vit ici** (déménagé du dépôt `skanfact` le 13/10/2026) : `VISION-ARCHITECTURE.md`,
  `docs/cadrage/` (01 modèle de données, 03 droits, 04 hors-ligne, 09 feuille de route, 12 pile technique… ; son
  `README.md` porte le journal des décisions), `docs/etudes/`. On **applique** le cadrage ; une décision nouvelle s'écrit
  dans ce journal, avec sa date. Les leçons de la v10 valent ici : `docs/lecons-v10.md` (on y cherche une règle, on ne
  le relit pas). Ce qui est incertain (fiscal, légal) s'écrit « À VÉRIFIER ».
- **Le dépôt `skanfact` est archivé** (13/10/2026 : personne n'utilise plus la v10). Une session s'ouvre sur CE dépôt ;
  rien ici ne dépend plus de l'autre.
- **Où on en est** : étape 1, le socle (le jalon J1 est atteint depuis le 28/09/2026). La plateforme porte déjà les
  ventes, les achats, la paie, les écritures et la clôture (le serveur fait foi ; le moteur, en entiers, tombe au
  millime de la v10) ; le Cabinet complet, sans paquets ; la caisse (tactile, sans réseau) ; le hors-ligne et le
  téléphone ; l'entrée, l'équipe, la messagerie, l'abonnement ; la console de l'équipe SkanFact. **Avant de toucher un
  domaine : sa ligne dans `docs/carte.md`, puis son document.**
- **L'application web EST notre code** (repris de la v10 le 28/09/2026, `web/public/v10` ; le Cabinet dans `cabinet/`) :
  **depuis le 26/10/2026 il se modifie directement** (Skander : « la vraie version à jour est dans skanfact-plateforme ») ;
  les fiches de retouche d'avant (`web/v10/`) ne sont plus qu'une archive, à ne plus rejouer. Le pont
  (`web/public/plateforme/pont.js`) remplace ce que la v10 demandait à l'ordinateur ; la coquille (barre, menus) vit dans
  `web/public/plateforme/barre.js`. Les écrans écrits pour la plateforme (l'entrée, la console) sont en React.
- **Les serveurs** (`docs/mise-en-ligne.md`, B et L) : chacun suit sa branche tout seul. `app.skanfact.tn` (données
  inventées) suit **`main`**, les versions validées ; `dev.skanfact.tn` (données inventées) suit **`dev`**, le travail du
  jour, dès qu'il est envoyé ; personne ne s'y connecte, sauf Claude
  par `scripts/serveur.sh '<commande>'` (clé de la session, hors dépôt) ; un réglage du serveur passe par une tâche
  d'entretien (`exploitation/taches/`). Les serveurs des pilotes (vraies données) : **jamais l'accès de Claude**.
- L'entreprise d'essai des développeurs (`0009`) : jamais facturée par l'abonnement, jamais transmise à la TTN,
  « ESSAI » sur chaque document.

## Ce qu'une chose NOUVELLE exige

*Sinon un test tombe — ou pire, rien ne tombe.*

- **Une table** : son entreprise, la sécurité par ligne activée ET forcée, sa place dans `CLASSEMENT`
  (`base/entreprise.ts`) ; une table que l'export de l'entreprise désigne a sa fonction (`REFERENCES_PAR_FONCTION`) ;
  `npm run types:base` ; `tests/socle` passe.
- **Un geste** : déclaré dans `serveur/porte/gestes.ts`, avec son texte `geste.<code>` et sa décision de lecture seule
  (`POLITIQUE_LECTURE_SEULE` : fermé, ouvert, ou décidé par la route). **Un geste de la console** : `GESTES_CONSOLE` au
  serveur ET `plateforme.exiger_role_console` dans la base (une preuve qui veut ouvrir retire les deux étages).
- **Une partie du dossier v10** (une nouvelle liste) : sa règle de droits (`serveur/v10/droits.ts`, sinon seuls P et A
  la voient) ; **une page** de la v10 : ses parties dans `PARTIES_DES_PAGES` ; **une lecture du dossier par un
  cabinet** : la liste de `0035`.
- **Une demande que la page fait à l'ouverture**, sans dépendre du dossier : dans l'attente commune de `pont.js`
  (`tests/v10/pont-ouverture.test.ts`), jamais après une réponse dont elle ne dépend pas.
- **Un e-mail** : ses phrases au catalogue (jamais dans `serveur/courriel.html`), un `…_bouton` s'il porte un lien,
  rien de chargé à distance ; une alerte ne porte RIEN du contenu, part une fois, à une adresse vérifiée.
- **Un texte du catalogue** ne nomme ses valeurs qu'en lettres (`{p95}` ne se remplit jamais).
- **Un écran** : la DA (plus bas), clair ET sombre ; l'instrument de rendu (`tests/web/rendu.test.ts` ; au téléphone,
  `tests/instrument-rendu.ts`) ET un parcours à la souris ; ses photos se regardent ; puis l'essai à l'écran.
- **Une brique livrée** : sa ligne dans `docs/carte.md` et son `docs/<domaine>.md` — jamais un paragraphe ici.

Trois principes que les briques ont appris, et qui valent partout : **on garde des FAITS, un état se déduit** à la
lecture (au jour de Tunis : un état écrit se périme à minuit) ; **jamais d'ordre de base supposé** (la langue de la
base rangeait « _racine » après « accounts ») : un ordre qui compte se trie explicitement ; **un refus prévisible se
dit avant le geste** (à l'ouverture d'un éditeur), jamais à « Enregistrer », qui jetterait la saisie.

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
  **De même pour une contrainte** (`drop constraint` / `add constraint`) : le 30/09/2026, 0037 a
  redéfini la liste des origines d'une écriture, trois preuves visaient encore 0021 et GitHub est
  resté rouge quatre envois de suite sans qu'on le voie. Depuis, le **contrôle éclair**
  (`npm run preuves:eclair`, une seconde) nomme toute preuve qui vise une fonction, une règle, un
  déclencheur, un index ou une contrainte qu'une migration plus récente remplace : la réorienter
  vers la définition en vigueur.
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
  nouveau vient avec sa ligne dans ce script, **avant le bilan** (ses deux dernières lignes : une
  preuve écrite après lui ne fait pas échouer le lot — c'est arrivé aux briques 66 à 70, trouvé le
  30/09/2026 ; le contrôle éclair le refuse). On ne retire jamais une preuve pour aller plus vite.
- **Vérifier ciblé, GitHub vérifie tout** (décision de Skander, 30/09/2026 : avancer et livrer plus
  par jour). Pendant le travail et avant un envoi : `npm run verifier:brique` (une minute ou deux) —
  types, lint (0 erreur, 0 avertissement), contrôle éclair des preuves, les tests des fichiers de
  test changés depuis `origin/dev` (et ceux qu'on ajoute : `-- tests/x.test.ts`), puis les preuves
  **nouvelles ou changées** (`npm run preuves:nouvelles`). Lire le **code de sortie**. Tous les
  tests et toutes les preuves tournent sur GitHub à chaque envoi (depuis le 05/10/2026, décidé par Skander
  pour ne plus attendre une heure : à chaque envoi, les tests en deux moitiés par Node et les **preuves du
  changement** — nouvelles, changées, ou dont le fichier visé a changé, `tests/preuves-du-changement.sh` — sur six
  machines, une dizaine de minutes ; **toutes** les preuves chaque nuit à 1 h 30 de Tunis et avant la production,
  `preuves-completes.yml`, quatorze groupes, `PARTIE=k/14`. Une nuit rouge se répare d'abord, le matin). **Le serveur d'essai n'attend pas GitHub** (Skander, 05/10/2026) : il installe chaque
  envoi dans les deux minutes ; c'est donc **avant** d'envoyer que tout se vérifie ici (`verifier:brique`, et le
  parcours à l'écran). GitHub vérifie en arrière-plan : **lire son verdict** (`npm run verdict`, qui nomme le test ou
  la preuve qui tombe) dès qu'il arrive, et un rouge se répare aussitôt, avant le travail suivant ; jamais on ne le
  contourne. Une brique qui touche au socle de tout (le serveur, la
  connexion, la sécurité par ligne) ajoute les fichiers de test concernés à `verifier:brique`.
  **Une brique qui ajoute une migration passe aussi `tests/socle`** (les garde-fous de la base : sécurité par ligne
  forcée, portes dérobées fermées au public, phrases au catalogue) : deux rouges du 01/10/2026 venaient de là.
  **Reconfirmé par Skander le 01/10/2026** (« les tests prennent beaucoup de temps ») : jamais de relance
  complète sur le poste, sauf un changement qui touche tout ; jamais attendre GitHub les bras croisés.
- **Tester comme un humain, à l'écran** (demandé par Skander le 01/10/2026 : « comme un vrai humain, et voir l'écran
  comme un vrai humain ») : chaque brique qui touche un écran se joue aussi **à la souris et au clavier sur un écran
  virtuel**, en lisant les captures, avant d'être annoncée ou envoyée. `PG_ADMIN=… scripts/humain/lancer.sh` (écran
  1440×900, base neuve, serveur sur le port 8090, Chromium ouvert) ; `node scripts/humain/exemple-caisse.ts
  http://127.0.0.1:8090` (une boulangerie : Nadia propriétaire, Sami et Leila caissiers ; les comptes dans
  `/tmp/skanfact-humain-plateforme/comptes.txt`, jamais dans le dépôt ; `node scripts/humain/code.ts` donne le code du
  téléphone de Nadia) ; puis `scripts/humain/ecran.sh capture | clic X Y | taper … | touche … | defiler …` (de vrais
  événements du système : un bouton recouvert ne reçoit pas le clic). Après un changement d'écran : reconstruire
  (`npx vite build --config web/vite.config.ts --outDir /tmp/skanfact-humain-plateforme/web`) et recharger.
  **La méthode, PAR LOT** (Skander, 05/10/2026, précisée le même jour : « fais le parcours de chaque lot en entier et
  après corrige par lot, c'est mieux que point par point ; commit à chaque lot, comme ça on avance vite ») : raisonner
  comme un commerçant ou un comptable tunisien qui découvre l'écran. Un lot = un domaine parcouru de bout en bout (la
  facture, la caisse, les achats, le téléphone…). **1. Faire tout le parcours du lot soi-même**, à la souris, en notant
  chaque problème vu (sans s'arrêter pour corriger) ; **2. corriger tout le lot** ; **3. écrire les tests et leurs
  preuves** une fois le parcours corrigé revu à l'écran ; **4. un seul envoi pour le lot**, puis revoir sur le serveur
  d'essai. Seule exception : un défaut qui bloque la suite du parcours (on ne peut pas aller plus loin) se répare tout
  de suite. D'abord sur la machine de travail, puis sur le serveur d'essai (`https://app.skanfact.tn`, joignable depuis
  la session), avec des comptes nommés « essai ».
  Le premier passage (brique 125) a trouvé sept défauts que les tests verts ne voyaient pas (`docs/caisse.md`) :
  chaque défaut vu à l'écran devient une assertion et sa preuve.

**Les écrans**
- **Tout écran neuf suit la DA des maquettes validées, et se veut premium** (Skander, 12/10/2026 : « quand tu développes
  de l'UI il faut respecter notre nouvelle DA, celle de notre dernière maquette […] il faut que ça soit toujours
  premium ») : `docs/entree.md`, « Le dessin ». La sarcelle (#0F9D8F, #0B7A70 sur les boutons) ; le vert presque noir
  quadrillé de la vitrine (#0B2724, menthe #7FE0D3, brume #A9C6C1) pour le haut d'un écran qui dit un état ; Bricolage
  Grotesque pour les titres, Instrument Sans pour le texte, IBM Plex Mono pour les codes et les dates d'une liste
  (servies par le serveur, `web/public/plateforme/polices/`) ; des cartes arrondies (20 px) ; le reste par les
  variables de la v10. Un haut sombre reste sombre en thème sombre (un filet menthe le détache de son panneau).
  Exemples : `premiers-pas.css`, `messagerie.css`, `abonnement.css`. **Chaque écran se regarde en clair ET en sombre**,
  à la souris, avant d'être envoyé.
- **Une fenêtre de la console où l'on a tapé demande avant de jeter la saisie** : son bouton d'annulation porte `ferme`
  (`Bouton ferme`), qui le fait passer par la garde de `Dialogue` comme Échap et la croix. Un refus de motif reste
  jusqu'au clic suivant (docs/console.md, « Décidé par délégation »).
- **Un refus se lit au-dessus des boutons, même dans une longue fenêtre** : `Dialogue` colle la phrase du refus juste
  au-dessus du pied et réserve sa hauteur au défilement ; le champ refusé vient à l'écran au-dessus d'elle, le curseur
  dedans (`useFaute`). Vu le 13/10/2026 sur « Écrire un message » : le refus d'un motif tombait sous le bas de l'écran.
- **Un geste du journal de la console a deux parties** (`reglages.message_retire`, jamais `reglages.message.retire`) :
  la table les refuse, et le geste ENTIER échouait. `tests/console/journal.test.ts` lit toutes les migrations et
  exige aussi le libellé de chaque geste dans l'écran du journal.
- **Un droit de la console a son libellé et sa phrase dans l'écran Équipe** (`console.ecran.equipe.droit.<code>` et
  `<code>_sous`) : sans eux, le tableau des droits ne s'affichait plus du tout (vu le 13/10/2026 par la vérification
  avant l'envoi, avec les droits des réglages). `tests/console/journal.test.ts` relie chaque droit du serveur à ses textes.
- **Le registre des formats officiels s'écrit dans le code** (`serveur/console/formats.ts`, C28), à côté de ce qu'il
  décrit : un format change avec une nouvelle version, relue et prouvée, jamais depuis la console. Ses chiffres viennent
  de la base (`plateforme.console_formats`, 0094) : des comptes, toutes entreprises ensemble, sans les entreprises
  d'exemple, jamais une pièce, un nom ni un montant. Chaque phrase du registre se vérifie dans le code qu'elle décrit.
- **Un test qui compte des lignes communes (le journal de la console, les messages aux clients) ne compte que les
  siennes** (`qui = any(...)`, ou l'écart avant/après) : les fichiers de tests passent l'un après l'autre sur la MÊME
  base, dans un ordre qui change d'un lancement à l'autre ; un compte global tombait le jour où un écran passait avant.
  Chaque fichier nomme aussi ses membres à lui (deux « Karim Essai » au journal rendaient un clic ambigu).
- **L'instrument de la console vit en un exemplaire** (`tests/web/instrument-console.ts`, `mesurerLaConsole`) : chaque
  fichier lui donne ses écrans et sa façon de les ouvrir, et un écran PLEIN (un incident ouvert, un retour demandé) se
  mesure dans le fichier qui sait le remplir. Un geste y trouve son bouton par la structure de l'écran, jamais par son
  texte (en langue factice, le texte change). **Un écran mesuré vide laisse passer ses données non marquées** : le
  registre des règles ne montrait ses codes et ses sources hors catalogue que si un autre fichier avait posé une règle —
  l'instrument pose ce qu'il mesure. Une donnée affichée porte `data-donnee`, une fenêtre la dit (`titreDonnee`,
  `sousDonnee`).
- **Ce qu'un en-tête commun montre d'après la vue (le compte d'un onglet) se garde d'une vue à l'autre** : pendant que
  la vue suivante se lit, l'onglet garde le compte qu'il montrait — sinon il disparaît puis revient, et les onglets qui
  le suivent glissent sous le curseur à chaque clic. De même, une rangée qui montre un contrôle dans certaines vues
  seulement (la période) garde sa hauteur dans les autres. Vu le 13/10/2026 sur le service, mesuré onglet par onglet.

**Sécurité (sans exception)**
- Dépôt **public** : jamais de secret, de jeton, de mot de passe réel ni de donnée de client. Les
  mots de passe de test sont tirés au hasard à chaque lancement.
- Jamais le nom ni le matricule de la société de Skander dans le code, les exemples ou les textes
  (règle détaillée dans `docs/lecons-v10.md`).
- Jamais une donnée de plus dans ce qui part vers un serveur tiers sans que la liste soit comptée et
  décidée.

**Git**
- **Deux branches** (décidé avec Skander le 22/10/2026 ; `docs/mise-en-ligne.md`, L). On travaille et on envoie sur
  **`dev`** (`git push origin dev`) ; **`main`** ne reçoit qu'une version de `dev` que GitHub a vérifiée en entier (la
  vérification de l'envoi ET toutes les preuves de la nuit, ou lancées sur elle) : `bash tests/promouvoir.sh` la fait
  avancer, jamais à la main, jamais en la réécrivant. Une nuit rouge sur `dev` se répare avant tout passage. Pas
  d'autre PR sans demande.
- **La revue de Codex, chaque semaine** (Skander, 23/10/2026 ; ni branche par fonction ni PR par envoi). Claude ouvre
  une PR « Revue de la semaine » de `dev` vers `main`, jamais fusionnée : elle se ferme d'elle-même quand `main`
  rattrape `dev` ; sinon Claude la ferme et ouvre la suivante. Skander y écrit `@codex review`. Sur « lis la revue » :
  lire le résumé ET les remarques posées sur les lignes (outils GitHub de la session ; `gh` n'y est pas), corriger ce
  qui est juste sur `dev` par le chemin habituel (tests, preuves, envoi), et répondre dans la PR à chaque remarque
  écartée, avec sa raison. Une revue de tout le dépôt se lance dans Codex (tâche sur `dev`) : Skander colle le rapport.
- Messages de commit en français, terminés par les lignes `Co-Authored-By` et `Claude-Session`
  fournies par la session. Aucun identifiant de modèle dans ce qui est envoyé.
- **Chaque envoi relève le numéro de version** (`version` de `package.json`, « 1.4.2 » ; décidé par Skander le
  13/10/2026) : correctif x.y.Z, fonction x.Y.0, rupture X.0.0. C'est le nom que la console donne à la version en
  service, et celui que le pied du menu de l'application des clients écrit (« v1.1.1 », l'envoi au survol) ; `npm run verifier:brique` refuse un envoi qui change autre chose que la documentation sans l'avoir relevé
  (docs/mise-en-ligne.md B7).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run verifier` | Types, lint, tests (il faut `PG_ADMIN`) |
| `npm run preuves` | Chaque défaut remis dans une copie, chaque test doit tomber (`SEULES`, `FICHIERS`, `PARTIE=k/n`) |
| `npm run preuves:paralleles` | Les mêmes, en `GROUPES` groupes côte à côte (4 par défaut) |
| `npm run verifier:brique` | La vérification ciblée d'une brique (types, lint, contrôle éclair, tests changés, preuves nouvelles) |
| `npm run preuves:nouvelles` | Les seules preuves nouvelles ou changées depuis `origin/dev` (`BASE`, `GROUPES`, `NOMS`) |
| `npm run preuves:eclair` | Le contrôle éclair des preuves, sans rien lancer (`DETAIL=1` pour le détail) |
| `npm run verdict` | Le verdict de GitHub sur le dernier envoi (ou `-- <commit>`) : 0 vert, 1 rouge, 3 pas fini |
| `npm run migrer` | Applique les migrations sur la base de `PG_ADMIN` |
| `npm run entreprise -- exporter <id> <fichier>` / `restaurer <fichier>` | Exporte une entreprise, ou la restaure là où elle n'est pas (`PG_ADMIN`) |
| `npm run types:base` | Réécrit `base/types.ts` à partir des migrations (base jetable sur `PG_ADMIN`) |

Les tests demandent aussi xmllint, Tesseract (avec le français) et Poppler (la facture électronique, la
lecture des factures d'achat, brique 84) : `apt-get install -y libxml2-utils tesseract-ocr tesseract-ocr-fra
poppler-utils` s'ils manquent (GitHub les installe à chaque envoi). `npm run banc:lecture -- <lot>` mesure la
lecture sur un lot de vraies factures, gardé HORS du dépôt (`docs/achats.md`, brique 84).

Dans une session Claude : PostgreSQL 16 tourne sur `127.0.0.1:5433`, donc
`PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres`. Le démarrage de chaque session
(`.claude/hooks/session-start.sh`, 1.107.0) pose ce qui manque : les outils des tests, les dépendances, la base
(créée, ou relancée si la machine a redémarré) et `PG_ADMIN`. À la main, s'il le faut : relancer ce script.
