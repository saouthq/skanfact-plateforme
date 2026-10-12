# La mise en ligne

*Ce qu'il faut pour qu'un serveur SkanFact soit joignable sur internet. Le cadrage fait foi :
`docs/cadrage/06-securite-et-hebergement.md` du dépôt `skanfact` (hébergement en Tunisie, site de secours,
sauvegardes). Décisions prises par délégation de Skander, le 05/10/2026, sauf mention.*

## Où on en est (05/10/2026)

**Le serveur d'essai est installé** (05/10/2026, 13 h 15 UTC) : un VPS OVH en France, Ubuntu 24.04, installé par
Skander d'une seule ligne collée dans le Terminal (B5). L'application vit à **app.skanfact.tn** : une entrée `A` dans
la zone DNS de **skanfact.tn**, qui est chez **Cloudflare** (pas chez OVH, où le domaine est enregistré), en « DNS
only » (nuage gris) : derrière le relais de Cloudflare, le frontal ne pourrait pas obtenir seul son certificat, et
chaque visiteur aurait l'adresse de Cloudflare (la limite par adresse, A, les bloquerait tous ensemble). La session de
Claude joint `app.skanfact.tn` (domaine autorisé dans les réglages réseau de son environnement, par Skander) : elle lit
l'état du serveur et y joue les parcours comme un utilisateur.
Deux temps, décidés par Skander le 05/10/2026 (`06` § 13) :

1. **Le serveur d'essai** : un VPS chez OVH, en France (VPS-2 : 4 cœurs, 8 Go, 75 Go), **avec des données
   inventées seulement** : aucune vraie donnée de client n'y va jamais.
2. **Les pilotes et le lancement, avec de vraies données** : les serveurs dédiés décidés au cadrage (`06` § 2.3 :
   EO Data Center à Enfidha, secours chez Tunisie Telecom ou ATI à Tunis), sur devis (démarche du père de
   Skander), et la déclaration INPDP déposée avant la première donnée réelle d'un client.

## A. La limite d'appels par adresse (brique 142)

**A1. Toutes les routes sans session** (l'inscription, la connexion, l'espace client et son paiement, la remise
d'un appareil retiré, l'avis de Konnect, les appels d'un partenaire) comptent les appels **par adresse** de
l'appelant : 60 d'un coup, puis un par seconde (`LIMITES_PAR_ADRESSE`). La machine elle-même (ses outils, ses
tests) ne l'est pas. Assez pour une équipe entière qui se
connecte le matin derrière la même box ; trop peu pour essayer des mots de passe ou des liens d'espace client à
la chaîne. Au-delà : « Trop de demandes depuis ta connexion : réessaie dans N secondes » (429, avec l'attente
en secondes dans `retry-after`), avant tout travail : un appel refusé ne coûte rien. Elle s'ajoute aux
protections de la connexion elle-même (les essais d'un compte, `03`) et aux limites des clés de l'API (brique
20).

**A2. Personne ne choisit son adresse.** Derrière un frontal (le relais qui reçoit les visiteurs et parle au
serveur), l'adresse vraie est celle que le frontal a vue : `SKANFACT_PROXY` dit combien de relais de confiance se
tiennent devant le serveur (0 par défaut : le serveur est appelé en direct). Sans relais déclaré, l'adresse écrite
dans un en-tête (`X-Forwarded-For`) ne compte jamais ; derrière le relais déclaré, une fausse adresse écrite par le
visiteur devant la sienne ne change rien (le relais ajoute la vraie, c'est elle qui compte), et un visiteur ne se fait
jamais passer pour la machine. **En production, `SKANFACT_PROXY` est exigé** (même 0) : oublié derrière le frontal,
chaque visiteur aurait l'adresse de la machine, que la limite ne compte pas. (Trouvé en faisant tourner toute la
suite : sans l'exception de la machine, les tests, qui s'inscrivent des dizaines de fois depuis la machine, recevaient
« trop de demandes ».)

**A3. Pas d'exception.** L'avis de Konnect n'est pas signé (n'importe qui peut l'appeler : il déclenche une
question à Konnect) ; il est donc limité comme le reste. Konnect et un partenaire appellent rarement (un avis par
paiement, un appel par connexion de boutique).

**A4. Le seau vit dans la mémoire du programme** (comme celui des clés) : un seul programme serveur aujourd'hui.
Plusieurs programmes côte à côte partageront leurs seaux le jour où il y en aura plusieurs.

Code : `serveur/limites.ts`, `serveur/app.ts`, `serveur/principal.ts` (`SKANFACT_PROXY`). Test :
`tests/socle/limites-adresse.test.ts`.

## B. L'installation et le suiveur (brique 143)

**B1. Le serveur suit le dépôt.** La session de Claude ne peut pas se connecter à un serveur (la connexion à distance
lui est fermée, vérifié le 05/10/2026), et aucun mot de passe ne lui est transmis. Le serveur va donc chercher
lui-même la version à installer : toutes les deux minutes, le **suiveur** (`exploitation/suivre.ts`, minuteur
`skanfact-suivre`) regarde la branche `main` du dépôt public, et installe la plus récente version que GitHub a
**vérifiée en vert** (le dernier passage de sa vérification, `verifier.yml`, réussi), jamais une plus ancienne que
celle qui tourne, ni une d'avant le suiveur lui-même (sans `exploitation/suivre.ts` : installée, elle ne saurait plus se
mettre à jour ; un serveur neuf, quand la dernière version n'est pas encore vérifiée, attend plutôt). Les verdicts se
lisent **en un seul appel par tour** (les derniers passages de la vérification de la branche) : GitHub limite à 60 par
heure les appels sans compte, et un appel par version toutes les deux minutes les épuisait (vu à la première
installation, le 05/10/2026). C'est la pratique des grandes plateformes (« GitOps » : le serveur tire la version
vérifiée) : personne ne retouche un serveur à la main ; tout passe par le dépôt, tracé et vérifié. La main sur le
serveur, c'est donc la main sur le dépôt : **la double vérification du compte GitHub de Skander** en est la clé.

**B2. Une installation** : la version prise dans le dépôt, ses dépendances (`npm ci`), ses écrans construits à part,
les migrations de la base (par le compte d'administration local, sans mot de passe), les écrans remplacés d'un coup,
le programme redémarré, puis son état vérifié (il doit répondre dans la minute). **Un échec revient à la version
d'avant** (la base, elle, ne recule pas : une migration ne se défait pas), se dit dans l'état, et cette version n'est
plus retentée.

**B3. Les tâches d'entretien** (`exploitation/taches/NNNN-nom.sh`) : chacune tourne une fois, après une installation
réussie ; c'est par elles que Claude règle le serveur sans s'y connecter.

**B4. L'état du serveur.** Le détail (la version en service, la plus récente vue, l'échec éventuel avec son étape et
son message, les tâches faites et leur sortie) se lit à `https://app.skanfact.tn/etat.json` sur un serveur **d'essai**
seulement : le message d'une migration en échec peut citer une valeur d'un client, et un serveur aux vraies données ne
le publie pas (il se lit dans sa console : `/var/lib/skanfact/public/etat.json`). Partout, la **page d'état** publique
(`/etat`, I) dit ce qui marche, sans un détail de plus. Le frontal s'écrit en un seul endroit,
`exploitation/frontal.sh`, d'après les réglages du serveur (l'installation et les tâches d'entretien l'appellent).

**B5. La première installation** : une ligne, une fois, en root, dans la console du VPS (espace client OVH) :
`curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/installer.sh | sudo bash -s app.skanfact.tn`
(le `sudo` devant `bash`, pas devant `curl` : sinon le script tourne sans les droits, et le dit).
Elle pose PostgreSQL 16 et Caddy (ceux d'Ubuntu), Node 24 (de nodejs.org, son empreinte vérifiée), le compte du
service, la base et son compte (mot de passe tiré au hasard), les réglages (`/etc/skanfact/serveur.env`, lisible par
root et le service seulement : la clé du coffre tirée au hasard, `SKANFACT_PROXY=1`), le frontal (https, son
certificat demandé tout seul), les services, puis la première version verte. La relancer ne change aucun secret.

**B6. Essayée de bout en bout** le 05/10/2026, dans un Ubuntu 24.04 simulé (avec systemd), avec un dépôt local et un
faux GitHub qui répond « vert » : installation complète (la page en https, une inscription, une connexion, les 69
migrations, les secrets protégés) ; une nouvelle version et sa tâche d'entretien installées par le suiveur ; une
version cassée exprès **refusée**, l'ancienne restée en service, l'échec dit dans l'état et pas retenté. Deux écarts
propres au simulateur ont été contournés pour l'essai seulement (git refusait un dépôt local d'un autre propriétaire ;
Docker empêchait les services de démarrer) ; le second a fait ajouter à l'installation le démarrage explicite de la
base.

**B bis. Deux sortes de serveurs** (décidé par Skander le 12/10/2026), le second mot de la ligne d'installation :

| | `essai` (par défaut) | `pilotes` |
|---|---|---|
| Les données | inventées seulement | **les vraies données des clients** |
| `SKANFACT_ENVIRONNEMENT` | `test` | `production` (le serveur ne démarre pas sans relais d'e-mails) |
| Ce que le suiveur attend (E) | rien (`aucune`) : chaque version dès qu'elle est envoyée | **toutes les preuves** (`toutes`) : la vérification de l'envoi **et** les preuves complètes de la nuit, vertes |
| L'accès de Claude (F) | oui | **jamais** : ni son service, ni sa route ; la tâche 0004 ne pose rien et le dit |
| L'état détaillé (`/etat.json`) | publié | dans la console seulement |
| Pendant l'installation | — | le relais d'e-mails (H), puis qui prévenir (I) |

`… | sudo bash -s app.exemple.tn pilotes` installe un serveur des pilotes. Relancer l'installation ne change jamais la
sorte d'un serveur : un serveur d'essai ne devient pas, d'une ligne, celui des vraies données (il porte des données
inventées et l'accès de Claude) ; les vraies données s'installent sur une machine neuve.

Code : `exploitation/installer.sh`, `exploitation/frontal.sh`, `exploitation/suivre.sh`, `exploitation/suivre.ts`.
Tests : `tests/exploitation/suivre.test.ts` (la règle : quelle version installer, et ce qu'on attend),
`tests/exploitation/courriel.test.ts` et `tests/exploitation/alertes.test.ts` (les deux sortes, le frontal).

## C. La sauvegarde de la nuit (brique 144)

**C1. Chaque nuit à 3 h 30 (heure de Tunis)**, la base entière part dans un fichier (`pg_dump`, compressé), dans
`/var/lib/skanfact/sauvegardes` (lisible par le compte de la base seulement).

**C2. Chaque sauvegarde est restaurée** dans une base à part, comptée (toutes ses lignes, ses migrations), puis cette
base est jetée : une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Le résultat se lit dans l'état du
serveur (`/etat.json`, champ `sauvegarde` : quand, réussie ou non, combien de lignes). **Un échec, à n'importe quelle
étape, s'y dit** : jamais le « réussi » de la veille.

**C3. Les 14 dernières restent.** Les plus anciennes ne s'en vont qu'**après** une restauration réussie : une nuit
ratée n'efface jamais les bonnes d'avant.

**C4. Posée par la première tâche d'entretien** (`exploitation/taches/0001-sauvegardes.sh`), qui fait aussi une
première sauvegarde tout de suite : c'est la première fois que Claude règle le serveur par une tâche. Essayée le
05/10/2026 dans l'Ubuntu simulé : la tâche jouée après l'installation, la sauvegarde restaurée et comptée (69
migrations), le minuteur réglé pour la nuit, l'état montré par le frontal.

**C5. La copie hors de la machine et le retour à la minute** : C bis (12/10/2026). La sauvegarde de la nuit s'écrit
désormais à part (`….dump.partiel`) puis prend son nom d'un coup : la copie hors machine ne prend jamais un fichier à
moitié écrit.

**Remettre une sauvegarde** (une seule fois par incident, par une tâche d'entretien écrite pour lui) : arrêter le service
`skanfact`, `pg_restore --clean --if-exists -d skanfact <fichier>` en compte `postgres`, relancer. Une entreprise seule se
remet à une minute donnée, sans toucher aux autres : C bis 7.

Code : `exploitation/sauvegarder.sh`, `exploitation/taches/0001-sauvegardes.sh`, `exploitation/suivre.ts` (l'état).
Test : `tests/exploitation/sauvegarder.test.ts`.

## C bis. Revenir à la minute, et une copie hors de la machine (lot « prêt pour les pilotes », 12/10/2026)

Le cadrage (`06` § 4) : revenir à **n'importe quelle minute des 35 derniers jours**, une copie sur l'autre site,
chiffrée avec une clé qui ne voyage pas avec elle, et un exercice de restauration réel chaque mois. Posé par la tâche
d'entretien 0008, sur les deux sortes de serveurs (B bis).

**C bis 1. L'archivage continu.** PostgreSQL range lui-même chaque journal qu'il remplit (16 Mo, ou chaque minute au
plus quand la base a bougé : `archive_timeout = 60`) par `exploitation/archiver.sh`, compressé, dans
`/var/lib/skanfact/archives/wal`. Le script ne répond « fait » que quand la copie est entière sur le disque ; sinon
PostgreSQL garde le journal et réessaie, et la veille le dit (I). Un journal déjà archivé n'est jamais écrasé par un
autre. PostgreSQL appelle une **copie** du script, hors du dépôt (`/usr/local/lib/skanfact/archiver.sh`) : une
installation qui change le dépôt ne le change pas sous lui.

**C bis 2. La copie de base de chaque nuit** (2 h 45 UTC, `exploitation/copie-de-base.sh`, en compte `postgres`) : le
point de départ d'une restauration à la minute. Vérifiée fichier par fichier contre son manifeste (`pg_verifybackup`),
rangée compressée à côté du nom du premier journal dont elle a besoin ; seulement alors, les copies de plus de 35 jours
s'en vont (jamais les deux plus récentes), puis les journaux dont plus aucune copie n'a besoin.

**C bis 3. Restaurer à côté** (`exploitation/restaurer.sh`, en compte `postgres`) : la copie de base d'avant la minute
voulue, puis les journaux jusqu'à elle, dans un PostgreSQL **à part** (son dossier, son port, sans réseau) ; la base vive
n'est jamais touchée.
- **L'exercice de chaque mois** (le 1er, 4 h UTC, et un premier dès la tâche 0008) : jusqu'au dernier journal, toutes
  les lignes et les migrations comptées, le temps mesuré, puis jeté (`derniere-restauration.json`, que la veille lit).
- **À une minute** : `sudo -u postgres bash /opt/skanfact/depot/exploitation/restaurer.sh --jusqua "2026-10-12 14:03"`
  (heure de Tunis) ; la base de cette minute reste à part (port 5544) pour en extraire une entreprise ;
  `restaurer.sh arreter` la jette. Son résultat s'écrit à part : un geste fait à la main ne cache pas l'exercice.

**C bis 4. La copie hors de la machine** (`exploitation/hors-machine.sh`, chaque minute) : ce qui est nouveau — les
journaux, la copie de base, la sauvegarde de la nuit — part vers un **stockage objet** (S3, chez l'hébergeur de
secours, en Tunisie : `06` § 2.3), **chiffré** par age pour une clé **publique** seulement. La clé qui relit vit chez
l'exploitant, jamais sur le serveur ni avec les copies (`06` § 5) : qui vole le stockage ne lit rien. Chaque envoi se
vérifie (l'empreinte que rend le stockage est celle du fichier chiffré) avant de compter ; un échec arrête le tour, se
dit dans `hors-machine.json` et dans la veille, et la minute suivante reprend. Rien n'est jamais effacé là-bas d'ici.
Le secret du stockage passe à curl par son entrée, jamais par sa ligne de commande.

**C bis 5. Ce que fait Skander, une fois** (le stockage ouvert chez l'hébergeur de secours) :
`curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/regler-hors-machine.sh | sudo bash`,
puis l'adresse du stockage, sa région, le seau, la clé d'accès et son secret (il ne s'affiche pas). La première fois, le
script fabrique la clé de chiffrement et **montre une seule fois la clé qui relit** (`AGE-SECRET-KEY-…`) : la copier
dans le gestionnaire de mots de passe **et** sur papier, rangé ailleurs que l'ordinateur ; le script demande ses six
derniers caractères pour vérifier. Il envoie un fichier d'essai, le relit et le déchiffre, puis seulement écrit
`/etc/skanfact/hors-machine.env` (root seulement). **Chez le fournisseur**, une fois : le verrou des objets (« Object
Lock », mode conformité, 35 jours : personne, même avec ces clés, n'efface une copie avant) et leur effacement
automatique après 35 jours (12 mois pour le dossier `nuit` ; la garde sur 10 ans : **À VÉRIFIER** avec le juriste,
`06` § 4.2).

**C bis 6. Le jour où le serveur est perdu** : une machine neuve installée en `pilotes` (B bis), le stockage réglé
(C bis 5 : une clé neuve pour les copies suivantes), puis
`curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/rapatrier.sh | sudo bash` :
le nom de l'ancien serveur et **son ancienne clé de relecture** ; tout revient, déchiffré, là où `restaurer.sh` le
cherche. Puis `restaurer.sh --jusqua "<la dernière minute>"`, et la base restaurée à part remplace la base vive vide
(`pg_dump` de l'une, `pg_restore` dans l'autre, SkanFact arrêté). **À VÉRIFIER** : l'exercice complet sur une
machine neuve, deux fois par an (`06` § 4.3).

**C bis 7. Remettre UNE entreprise à une minute** (`exploitation/remettre-entreprise.sh`, en root ; `06` § 4.4) : une
erreur de manipulation ou un défaut a abîmé les données d'une entreprise, les autres vont bien. Deux temps, toujours :
- **L'essai** : `sudo bash /opt/skanfact/depot/exploitation/remettre-entreprise.sh <entreprise> "2026-10-12 14:03" "<motif>"`
  (l'identifiant de l'entreprise, la dernière minute AVANT le dégât à l'heure de Tunis, et le motif). La base de cette
  minute est restaurée à côté (C bis 3), l'entreprise en est exportée, la base d'à côté est jetée ; puis la remise est
  jouée dans la base vive et **annulée** : rien ne change, et l'écran dit ce qui changerait — les tables, et les
  **numéros de pièces** qui disparaîtraient (une facture émise après cette minute : sa série redonnera son numéro, il
  faut la refaire à l'identique).
- **La remise** : la même commande suivie de `--remettre`, sur le fichier de l'essai (sans essai, elle est refusée ;
  un essai vaut un jour : son fichier porte les données de l'entreprise, il ne traîne pas plus longtemps).
  Les lignes de l'entreprise sont remplacées par celles du fichier, en une transaction ; rien ne bouge des autres
  entreprises ; sa piste d'audit est gardée entière et dit la remise, son motif et les numéros retirés ; ses postes
  relisent tout leur dossier. La remise est refusée si une ligne d'ailleurs (le dossier de révision d'un cabinet…)
  désigne ce qu'elle ferait disparaître. L'état d'avant reste retrouvable à la minute que le script affiche : une
  remise se défait par une autre. **Essayée sur le serveur d'essai le 12/10/2026** (données inventées) : une écriture,
  puis l'essai de la remise à la minute d'avant — la base de cette minute restaurée à côté, l'entreprise exportée,
  l'essai joué et annulé, la base d'à côté vidée ; il a montré la piste d'audit comptée deux fois (corrigé).

Code : `exploitation/archiver.sh`, `exploitation/copie-de-base.sh`, `exploitation/restaurer.sh`,
`exploitation/hors-machine.sh`, `exploitation/regler-hors-machine.sh`, `exploitation/rapatrier.sh`,
`exploitation/remettre-entreprise.sh`, `base/entreprise.ts` (`remettre`), `exploitation/taches/0008-archivage.sh`,
`exploitation/taches/0009-premier-exercice.sh` (le premier exercice refait : sur le serveur d'essai, le 12/10/2026,
restaurer.sh effaçait son dossier pour le recréer, ce que postgres ne peut pas dans `/var/lib/skanfact` ; il le vide
désormais, et le test pose la même cloison). Test : `tests/exploitation/archivage.test.ts` (joué pour de vrai : un
PostgreSQL à part qui archive, une copie de base, une restauration à la seconde près, l'exercice, l'envoi chiffré vers
un faux stockage, le rapatriement et la même base restaurée ; age et PostgreSQL 16 sur les postes de GitHub) ;
`tests/socle/export-entreprise.test.ts` (la remise : l'essai, la remise, la voisine intacte, les refus, le script).

## D. Le parcours sans SMS ni e-mail (brique 145)

**D1. Essayé comme un testeur**, le 05/10/2026, à l'écran, sur un serveur réglé comme celui d'essai (aucun fournisseur
de SMS, aucun envoi d'e-mail) : créer son compte, se connecter, choisir la découverte. Le rôle de propriétaire exige
alors le code du téléphone (03 § 6), par une **application d'authentification** (Google Authenticator, Microsoft
Authenticator…), puisque le SMS n'est pas encore en service. Rien d'autre n'a besoin d'un SMS ni d'un e-mail : une
invitation se transmet par son lien (WhatsApp, par exemple).

**D2. Le défaut trouvé** : l'écran ne montrait qu'une adresse `otpauth://…`, que personne ne sait ajouter à la main dans
son application. Le testeur restait bloqué. Désormais :
- un **code QR** à scanner avec l'application ;
- la **clé en clair**, par groupes de quatre, pour qui la tape à la main ;
- le lien « déjà sur ton téléphone ? ouvrir dans l'application », pour qui s'inscrit depuis son téléphone ;
- les codes de secours, avec ce qu'ils font (chacun remplace une fois le code du téléphone) ;
- **le premier code essayé avant de partir** (`POST /v1/moi/code/essayer`) : un code faux est refusé sur son champ,
  avec la raison qui aide (« vérifie que tu as bien ajouté SkanFact… et que l'heure de ton téléphone est réglée
  automatiquement ») ; l'essai ne change rien. Le serveur lit le secret par `socle.mon_secret_d_application()`
  (migration `0070`) : celui de la personne connectée, seulement d'une application, jamais rendu à l'écran.

Revu à l'écran : le code QR relu comme par un téléphone (sur la capture) donne la clé affichée ; un faux code refusé ;
le bon code ouvre l'application.

**D3. Pas de « mot de passe oublié »** sans envoi d'e-mail. Sur le serveur d'essai, un testeur qui l'oublie recrée un
compte (les données sont inventées). Le « mot de passe oublié » vient avec le fournisseur d'e-mails, avant les pilotes.
Conseil aux testeurs : une adresse e-mail inventée suffit (rien n'y est jamais envoyé).

Code : `web/src/ecrans/CodeRequis.tsx`, `serveur/routes/socle.ts`, `serveur/connexion.ts` (`essayerCode`),
`base/migrations/0070_essayer_code.sql`. Tests : `tests/socle/code-essai.test.ts`, `tests/web/parcours.test.ts`.

## E. Deux vitesses de vérification (décidé par Skander le 05/10/2026)

« Pour le développement, j'ai envie de raccourcir le temps des tests ; c'est peut-être bien pour la prod, mais pas pour
le dev. » Toutes les preuves à chaque envoi prenaient 70 à 80 minutes avant qu'une version arrive sur le serveur.
Désormais :

- **À chaque envoi** (`verifier.yml`, une dizaine de minutes) : les types, le lint et tous les tests (deux Node, chacun
  en deux moitiés sur deux machines), et **les preuves du changement** (`tests/preuves-du-changement.sh` : les preuves
  nouvelles ou changées, et celles dont le fichier visé a changé depuis la version d'avant), sur six machines. Vert :
  le serveur d'essai l'installe.
- **Chaque nuit à 1 h 30 de Tunis, et sur demande avant la production** (`preuves-completes.yml`) : **toutes** les
  preuves, sur quatorze machines. Une nuit rouge se répare d'abord, le matin.
- Les serveurs des pilotes et de la production n'installeront qu'une version passée par toutes les preuves (à régler le
  jour où ils existent).

**E2. Le serveur d'essai n'attend plus GitHub** (Skander, le même jour : « ça m'énerve que GitHub teste ; on pourrait
pas tester nous-mêmes et éviter la vérification de GitHub pendant le dev ? »). `SKANFACT_VERIFICATION=aucune` dans
`/etc/skanfact/suivre.env` (posé par l'installation, et par la tâche d'entretien 0003 sur un serveur **d'essai**
seulement) : le suiveur installe la plus récente version **dès qu'elle est envoyée**, sans même interroger GitHub.
Claude la teste avant l'envoi (types, lint, tests et preuves de ce qu'il a touché, parcours à l'écran) ; GitHub la
vérifie quand même en arrière-plan, et un rouge se répare aussitôt. Ce qui protège encore le serveur d'essai : une
version qui ne démarre pas revient d'elle-même à celle d'avant (B2) ; jamais une version plus ancienne que celle qui
tourne, ni une d'avant le suiveur. Toute autre valeur que `aucune` attend GitHub : un serveur aux vraies données
l'attendra toujours.

## F. L'accès de Claude au serveur (demandé par Skander le 05/10/2026)

« Je voulais te donner l'accès au serveur, comme ça c'est plus rapide ; je ne veux pas attendre ! » La session de Claude
ne sort que par le web : SSH est impossible depuis elle, même avec un mot de passe (essayé le 05/10/2026 : le relais de
la session ne laisse passer que https). L'accès passe donc par le web :

- **Le service `skanfact-acces`** (`exploitation/acces.ts`, en root, sur 127.0.0.1:8081 ; le frontal lui passe
  `https://app.skanfact.tn/acces/…`) exécute une commande et rend sa sortie, ses erreurs et son code.
- **Seulement signée** par une clé déclarée dans `exploitation/acces-cles.json` (des clés **publiques** : rien de
  secret). La clé privée ne vit que dans la session de Claude (`~/.skanfact-acces/`, hors de tout dépôt). Une demande
  vaut deux minutes autour de son heure et porte un nombre tiré au hasard, jamais accepté deux fois : recopiée, elle ne
  sert plus. Une clé se retire en la marquant `retiree` dans le dépôt (le service relit la liste à chaque demande) ; une
  session nouvelle se donne une clé nouvelle de la même façon.
- **Tout se trace** : chaque commande acceptée s'écrit dans `/var/lib/skanfact/acces.log` (l'heure, la clé, la
  commande, son code).
- Côté Claude : `scripts/serveur.sh 'commande'` (signe, envoie, affiche).
- Posé par la tâche d'entretien 0004 (et par l'installation, pour un serveur neuf), **sur un serveur d'essai
  seulement** : Claude ne touche jamais un serveur aux vraies données (B bis).

Code : `exploitation/acces.ts`, `exploitation/acces-cles.json`, `scripts/serveur.ts`. Test :
`tests/exploitation/acces.test.ts` (8 preuves).

## G. Les règles de droit communes (05/10/2026)

Vu sur le serveur d'essai, en émettant une facture comme un commerçant : « le timbre fiscal n'est pas renseigné au
05/10/2026 : la facture ne s'émet pas sans lui ». Aucune facture ne pouvait s'émettre. Les règles de droit (timbre,
taux, barèmes) sont des **données datées**, jamais du code (01 R12) ; les tests posent leurs propres règles d'essai,
et rien ne les posait sur un vrai serveur.

- **Le registre** : `base/regles-communes.json`, dans le dépôt, chaque règle avec sa valeur, son premier jour, sa
  dernière date s'il y en a une, et sa **source**. Pour l'instant une seule : le timbre d'une facture, 1 dinar depuis
  le 01/01/2023 (loi de finances pour 2023, **À VÉRIFIER** avec un comptable : le texte, l'article et la date d'effet).
- **La pose** : `node base/regles-communes.ts`, à chaque installation (`exploitation/suivre.ts`, après les
  migrations), et une fois tout de suite par la tâche d'entretien 0005. Ce qui manque se pose ; une règle déjà posée
  avec une autre valeur, une autre source ou une autre fin **arrête l'installation** (une règle ne se réécrit pas :
  une loi de finances ajoute une ligne au registre et ferme la date de fin de celle qu'elle remplace) ; un lot refusé
  n'écrit rien.
- **Le garde-fou** : un test vérifie que chaque règle que le serveur lit (`regle(tx, …, 'code')`) est au registre et
  en vigueur aujourd'hui. Une règle nouvelle lue par le code sans entrée au registre fait tomber le test.
- **Ouvert** : marquer une règle « vérifiée » (qui, quand) une fois qu'un comptable l'a confirmée. La table a ces
  colonnes, mais une règle posée ne se modifie plus (seule sa date de fin se ferme) : à prévoir avec la console de
  l'éditeur.

Le refus dit désormais la date comme on l'écrit (« 05/10/2026 », plus « 2026-10-05 »). Test :
`tests/socle/regles-communes.test.ts` (6 preuves avec celle de la date).

## H. Le relais d'e-mails : Resend (décidé par Skander le 09/10/2026, gardé pour les vraies données le 12/10/2026)

L'étude est dans le dépôt `skanfact` (`docs/etudes/ENVOI-EMAILS.md`). Aucun service « tout prêt » n'annonce ses
serveurs en Tunisie. **Resend pour le serveur d'essai** (09/10/2026), puis **gardé aussi pour le serveur aux vraies
données** (Skander, 12/10/2026 : « pour les mails finalement on garde Resend ») : le code de connexion part par e-mail
par défaut (§ H bis), et **un serveur de production ne démarre pas sans relais d'e-mails** (`SKANFACT_SMTP`). Resend
garde ses données aux États-Unis : **À VÉRIFIER** l'autorisation de l'INPDP pour ce transfert (l'adresse et le code),
à demander avec la déclaration, avant la première donnée réelle. Le script accepte désormais tous les serveurs.

**H1. Ce que fait Skander, une fois.** Les e-mails partent de **`ne-pas-repondre@send.skanfact.tn`** : le domaine
`send.skanfact.tn` est déjà « Verified » chez Resend (celui de la console de la v10, qui y envoie les clés de licence
depuis `licences@send.skanfact.tn` ; ses lignes DNS : dépôt `skanfact`, `plateforme/DNS-skanfact-tn.md`). Rien à
ajouter chez Cloudflare (09/10/2026 : la capture de Resend envoyée par Skander le montre « Verified »).
1. Chez Resend, « API Keys » → « Create API Key » : nom « serveur d'essai », permission **« Sending access »** (envoi
   seulement), domaine **`send.skanfact.tn`**. Une clé à part de celle de la console : chacune se retire sans l'autre.
2. Dans la console du serveur (espace client OVH), en root :
   `curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/courriel.sh | sudo bash`
   (le `sudo` devant `bash` : « `sudo curl … | bash` » lance le script sans les droits, et il répond « À lancer en root »),
   puis coller la clé (elle ne s'affiche pas) et donner une adresse où recevoir l'e-mail d'essai.

**H2. Le script** (`exploitation/courriel.sh`) :
- il demande la clé **sans l'afficher** ;
- il envoie d'abord un **e-mail d'essai** avec elle : si Resend refuse (clé mal copiée, clé sans droit d'envoi sur
  `send.skanfact.tn`), rien ne change ;
- il écrit ensuite les deux réglages dans `/etc/skanfact/serveur.env`, lisible par root et le service seulement :
  `SKANFACT_SMTP=smtps://resend:<clé>@smtp.resend.com:465` et `SKANFACT_COURRIEL_DE=ne-pas-repondre@send.skanfact.tn` ;
- il redémarre SkanFact et vérifie que « Mot de passe oublié ? » est proposé.

La clé passe à curl par son entrée, jamais par sa ligne de commande. **Elle ne passe ni par le dépôt, ni par Claude.**

**H3. Ce qui part chez Resend**, compté et décidé (skanfact `docs/cadrage/03-droits.md` § 6) : l'adresse de la
personne, l'objet, et un texte qui ne porte que le code ou le lien. Ni son nom, ni son entreprise.

**H4. Les e-mails sont habillés** (12/10/2026, maquette validée par Skander ; `serveur/courriel.ts`, `serveur/courriel.html`) :
la marque « S SkanFact » dessinée en HTML, une carte blanche, le code en grand en deux groupes, un bouton qui dit ce
que fera le clic (et le lien en clair dessous), un pied fixe, l'expéditeur nommé « SkanFact », et le thème sombre pour
les messageries qui le comprennent. La version HTML dit EXACTEMENT le texte (qui part aussi, tel quel) ; aucune image
ni rien de chargé à distance (une image distante dirait qui a ouvert l'e-mail, et d'où). Ses phrases sont au
catalogue (`courriel.*`, et un `…_bouton` par e-mail qui porte un lien).

Tests : `tests/exploitation/courriel.test.ts` (6 preuves), joué avec des doublures de curl et de systemctl ;
`tests/socle/courriel-habille.test.ts` pour le rendu.

## H bis. Le code de connexion au choix, et le SMS par WinSMS (décidé par Skander le 12/10/2026)

**Le choix.** Chacun choisit où arrive son code de connexion, dans Paramètres → Ton compte (les Réglages du Cabinet) :
**par e-mail** (le choix par défaut : rien à installer, et le moins cher), **par SMS** ou **par une application**
d'authentification. Le comptable d'un cabinet aussi peut garder l'e-mail : avec un relais, le code par e-mail lui
tient lieu de code ; un serveur qui n'envoie pas d'e-mails exige encore de lui le SMS ou une application (0076).
« Protège ton compte », dans les premiers pas, est fait d'emblée quand le serveur envoie des e-mails.

**Le fournisseur.** WinSMS (winsmspro.com) : le plus utilisé et le moins cher des fournisseurs tunisiens comparés. Ce
que fait Skander, une fois :
1. créer le compte chez WinSMS, acheter un pack (1 500 SMS, environ 75 DT HT) ;
2. demander le nom d'expéditeur **« SkanFact »** (environ 18 jours ; en attendant, celui du compte sert) ;
3. dans la console du serveur (espace client OVH), en root :
   `curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/sms.sh | sudo bash`,
   puis coller la clé de l'API (elle ne s'affiche pas), le nom d'expéditeur (ou Entrée) et un mobile à soi.

**Le script** (`exploitation/sms.sh`) envoie d'abord un **SMS d'essai** et montre la réponse brute de WinSMS (sa forme
n'est pas publiée : **À VÉRIFIER** avec le compte réel) ; il demande si le SMS est arrivé ; **seulement alors** il écrit
`SKANFACT_SMS=winsms`, `SKANFACT_SMS_CLE` et `SKANFACT_SMS_EXPEDITEUR` dans `/etc/skanfact/serveur.env`, redémarre
SkanFact et vérifie que le SMS est proposé (`codeParSms` dans `GET /v1/connexion/options`). La clé passe à curl par
son entrée, jamais par sa ligne de commande. **Elle ne passe ni par le dépôt, ni par Claude.**

**Ce qui part chez WinSMS**, compté et décidé (skanfact `docs/cadrage/03-droits.md` § 6) : le numéro et un texte qui
ne porte que le code (« Ton code SkanFact : 482 913 »). Chaque SMS se compte, **5 par heure et 20 par jour au plus**
pour une même personne (À VÉRIFIER à l'usage) : à la connexion, à l'activation, pour une preuve (quitter le SMS,
changer de numéro, de nouveaux codes de secours) et pour un mot de passe oublié. Un SMS qui ne part pas se dit à
l'écran, avec le geste qui reste (renvoyer, ou un code de secours) ; il n'arrête jamais le serveur.

Les règles que tient le serveur (`base/migrations/0081_code_au_choix.sql`, `serveur/sms.ts`, `serveur/compte.ts`,
`serveur/connexion.ts`) : le SMS s'active en deux temps, comme l'application (un code part au numéro, rien ne change
avant qu'il soit tapé : 15 minutes, cinq essais) ; changer de numéro ou quitter le SMS se prouve par un code reçu à
l'ancien numéro (10 minutes, une fois) ou un code de secours ; le numéro ne s'écrit que par ces gestes, jamais
directement ; un mobile tunisien seulement (huit chiffres, 2, 4, 5 ou 9). Tests : `tests/socle/code-au-choix.test.ts`,
`tests/exploitation/sms.test.ts` (joué avec des doublures de curl et de systemctl), `tests/web/compte.test.ts` (le SMS
à la souris).

## I. La veille : les alertes et la page d'état (lot « prêt pour les pilotes », 12/10/2026)

**I1. Chaque minute**, le veilleur (`exploitation/veiller.ts`, minuteur `skanfact-veille`, en compte `skanfact`, posé
par la tâche d'entretien 0007) relève l'état du serveur et en tire les problèmes (les règles :
`exploitation/veille.ts` ; les seuils du cadrage, `06` § 7) :

| Ce qui ne va pas | Grave | Que faire (dans la console du serveur) |
|---|---|---|
| SkanFact ne répond plus, **deux minutes de suite** (un redémarrage dure moins) | oui | `sudo systemctl status skanfact`, puis `sudo journalctl -u skanfact -n 50` |
| La sauvegarde de la nuit absente, ratée, ou plus de 26 heures sans réussite | oui | `sudo systemctl status skanfact-sauvegarde` ; le détail : `/var/lib/skanfact/sauvegardes/derniere.json` |
| Une version qui n'a pas pu s'installer (l'ancienne tourne toujours) ; une tâche d'entretien ratée (sauf si une suivante, réussie, la **reprend** : « # Reprend : … » en tête de celle-ci) | non | le détail : `/var/lib/skanfact/public/etat.json` |
| Le suiveur des versions muet depuis plus de 30 minutes | non | `sudo systemctl status skanfact-suivre.timer` |
| Un disque plein à 75 % (grave à 90 %) | à 90 % | libérer de la place, ou agrandir le disque chez l'hébergeur |
| Le certificat https qui expire dans moins de 30 jours (grave à moins de 7) | à 7 jours | `sudo systemctl status caddy`, puis `sudo journalctl -u caddy -n 50` |
| L'archivage continu qui échoue (ou, sur un serveur aux vraies données, arrêté) | oui | `sudo journalctl -u postgresql -n 50` (C bis 1) |
| La copie de base absente, ratée ou de plus de 26 heures (quand l'archivage tourne) | oui | `sudo systemctl status skanfact-base` (C bis 2) |
| L'exercice de restauration raté (grave) ou de plus de 35 jours | raté | `sudo systemctl status skanfact-restauration` (C bis 3) |
| La copie hors de la machine en retard d'un quart d'heure (grave après une heure) ; pas réglée sur un serveur aux vraies données | après une heure | `sudo systemctl status skanfact-hors-machine` ; ou la régler (C bis 5) |

**I2. Prévenir, sans bavarder.** Un problème qui apparaît part tout de suite par **e-mail** (par le relais du serveur,
H : un seul e-mail par minute, qui dit tout et ce qu'il faut faire) et par **SMS** (WinSMS, H bis, s'il est branché :
le nouveau, et ce qui est grave). Tant qu'il dure, un **rappel toutes les six heures** ; quand il est réglé, **un mot**
(par SMS aussi s'il était grave). Rien n'est redit chaque minute. Une alerte qui n'est partie par **aucun** moyen se
redit à la minute suivante. **Ce qui part**, compté et décidé : l'adresse et le mobile de l'exploitant, le nom du
serveur, ce qui ne va pas et ce qu'il faut faire ; jamais une donnée d'un client, jamais un message d'erreur (celui
d'une migration peut citer une valeur).

**I3. Qui prévenir** se règle une fois, en root, dans la console du serveur (l'installation d'un serveur des pilotes le
demande d'elle-même) :
`curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/alertes.sh | sudo bash`.
Le script demande l'adresse e-mail et, si les SMS sont branchés, le mobile ; il envoie **d'abord une alerte d'essai**
par chaque moyen, demande si elle est arrivée, et seulement alors écrit `/etc/skanfact/veille.env` (lisible par root et
le service). L'adresse et le numéro ne passent ni par le dépôt, ni par Claude. Sans destinataire, la page d'état
s'écrit quand même, et rien ne part.

**I4. La page d'état publique**, `https://app.skanfact.tn/etat` (servie par le frontal, même si le programme est
arrêté ; revue chaque minute) : le service, la sauvegarde, l'entretien, chacun « fonctionne » ou non. Aucun message,
aucune version, aucun chemin : c'est elle qu'on donne aux clients pendant un incident. Elle ne dit « l'exploitant est
prévenu » que si l'alerte de chacun de ces problèmes est vraiment partie : un serveur sans destinataire (le serveur
d'essai) ne le prétend pas.

**I5. Ce qui reste** (cadrage `06` § 7) : une vérification **de l'extérieur**, depuis deux villes (un service qui
regarde l'adresse publique : à choisir, et à compter dans les flux qui sortent, `05` § 4.3) ; les temps de réponse et le
taux d'erreurs.

Code : `exploitation/veille.ts`, `exploitation/veiller.ts`, `exploitation/alertes.sh`, `exploitation/frontal.sh`,
`exploitation/taches/0007-veille.sh`. Tests : `tests/exploitation/veille.test.ts` (les règles),
`tests/exploitation/veiller.test.ts` (le veilleur lancé pour de vrai, avec un faux relais d'e-mails, un faux WinSMS et
un faux programme), `tests/exploitation/alertes.test.ts` (le réglage des destinataires, la tâche, le frontal).

## Reste à faire avant les testeurs

- ~~Une fiche pour les testeurs~~ : `docs/testeurs.md` (05/10/2026).
