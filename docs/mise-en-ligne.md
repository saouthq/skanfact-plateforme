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

## Reste à faire avant les testeurs

- Les sauvegardes automatiques de la base sur le serveur d'essai, et une restauration essayée.
- Vérifier le parcours sans SMS et sans e-mail (la connexion par l'application de code).
- Une fiche pour les testeurs.
