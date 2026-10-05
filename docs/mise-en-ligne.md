# La mise en ligne

*Ce qu'il faut pour qu'un serveur SkanFact soit joignable sur internet. Le cadrage fait foi :
`docs/cadrage/06-securite-et-hebergement.md` du dépôt `skanfact` (hébergement en Tunisie, site de secours,
sauvegardes). Décisions prises par délégation de Skander, le 05/10/2026, sauf mention.*

## Où on en est (05/10/2026)

Aucun serveur n'est encore en ligne : la plateforme tourne sur la machine de travail. Le nom de domaine
**skanfact.tn** (chez OVH) existe ; l'application vivra à **app.skanfact.tn** (une sous-adresse, sans achat).
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
**vérifiée en vert** (tous ses contrôles finis, aucun rouge, au moins les 8 de `verifier.yml`), jamais une plus
ancienne que celle qui tourne. C'est la pratique des grandes plateformes (« GitOps » : le serveur tire la version
vérifiée) : personne ne retouche un serveur à la main ; tout passe par le dépôt, tracé et vérifié. La main sur le
serveur, c'est donc la main sur le dépôt : **la double vérification du compte GitHub de Skander** en est la clé.

**B2. Une installation** : la version prise dans le dépôt, ses dépendances (`npm ci`), ses écrans construits à part,
les migrations de la base (par le compte d'administration local, sans mot de passe), les écrans remplacés d'un coup,
le programme redémarré, puis son état vérifié (il doit répondre dans la minute). **Un échec revient à la version
d'avant** (la base, elle, ne recule pas : une migration ne se défait pas), se dit dans l'état, et cette version n'est
plus retentée.

**B3. Les tâches d'entretien** (`exploitation/taches/NNNN-nom.sh`) : chacune tourne une fois, après une installation
réussie ; c'est par elles que Claude règle le serveur sans s'y connecter.

**B4. L'état du serveur** se lit à `https://app.skanfact.tn/etat.json` (servi par le frontal, même si le programme
est arrêté) : la version en service, la plus récente vue, l'échec éventuel (sa version, son étape, son message), les
tâches faites et leur sortie. Rien de secret.

**B5. La première installation** : une ligne, une fois, en root, dans la console du VPS (espace client OVH) :
`curl -fsSL https://raw.githubusercontent.com/saouthq/skanfact-plateforme/main/exploitation/installer.sh | bash -s app.skanfact.tn`.
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

Code : `exploitation/installer.sh`, `exploitation/suivre.sh`, `exploitation/suivre.ts`. Test :
`tests/exploitation/suivre.test.ts` (la règle : quelle version installer).

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

**C5. Ce qu'elle ne fait pas encore** : la copie **hors de la machine**. Sur le serveur d'essai (données inventées), un
disque perdu ne perd rien qui compte. Pour les pilotes et le lancement, la copie part chaque nuit vers le second centre
de données tunisien (`06` § 2.3), avant la première donnée réelle d'un client.

**Remettre une sauvegarde** (une seule fois par incident, par une tâche d'entretien écrite pour lui) : arrêter le service
`skanfact`, `pg_restore --clean --if-exists -d skanfact <fichier>` en compte `postgres`, relancer. Une entreprise seule se
remet par son export (`base/entreprise.ts`), pas par la sauvegarde entière.

Code : `exploitation/sauvegarder.sh`, `exploitation/taches/0001-sauvegardes.sh`, `exploitation/suivre.ts` (l'état).
Test : `tests/exploitation/sauvegarder.test.ts`.

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

## Reste à faire avant les testeurs

- Une fiche pour les testeurs.
