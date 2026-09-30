# Le hors-ligne sur la plateforme

*30/09/2026, brique 72. Le cadrage fait foi : `docs/cadrage/04-hors-ligne-et-synchro.md` du dépôt
`skanfact` (ce qui marche pendant une coupure, ce que le poste garde, la file d'envoi). Ce document dit
ce qui en est fait, décision par décision.*

## Brique 72 : l'application installable, qui s'ouvre et se consulte sans réseau (fait le 30/09/2026)

**H1. L'application s'installe, et ses écrans se gardent sur le poste** (par délégation). Un manifeste
(`web/public/manifest.webmanifest`, ses icônes dans `web/public/icones/`) et un service des écrans
(`web/public/sw.js`) : il garde les **écrans** (pages, scripts, styles, icônes), **jamais les données**
— l'API (`/v1`) ne passe jamais par lui. Réseau d'abord : en ligne, la dernière version (gardée au
passage, pour qu'un écran périmé ne s'ouvre jamais sans réseau) ; sans réseau, celle gardée. Les pages
d'entrée et ce qu'elles chargent se gardent dès l'installation.

**H2. Sur « mon ordinateur », la session se garde dans le navigateur ; sur l'ordinateur d'un autre,
dans l'onglet seulement** (par délégation). Jusqu'ici la session vivait dans l'onglet : l'application
refermée demandait de se reconnecter, et ne pouvait donc pas se rouvrir sans réseau. La case « je suis
sur le poste de quelqu'un d'autre » de l'entrée décide : cochée, rien n'est gardé (03 § 6). Le serveur
ferme toujours une session inactive (12 heures, 30 minutes sur l'ordinateur d'un autre). Se
déconnecter efface ce que le poste gardait, même sans réseau ; **une autre personne** qui se connecte
aussi (H8, qui remplace « une nouvelle connexion efface tout »).

**H3. Une copie de l'entreprise, chiffrée, sur « mon ordinateur » seulement** (par délégation). Après
chaque lecture et chaque enregistrement, le point de contact garde ce que le serveur a (les objets du
dossier et leurs révisions), chiffré en AES-GCM par une clé de l'appareil que le navigateur ne laisse
jamais sortir (`extractable: false`), dans la base du navigateur (`web/public/plateforme/poste.js`).
Sans réseau, l'entreprise s'ouvre dessus, et l'entrée ouvre d'elle-même la dernière entreprise dont le
poste a une copie. **Limite honnête** (04 § 2) : le chiffrement protège un disque volé, pas un poste
allumé et ouvert ; la parade, c'est de retirer l'appareil (brique 74, H9). **À VÉRIFIER** (04 § 11.2) :
le stockage persistant, que Chromium n'accorde pas à une page non installée.

**H4. Le bandeau dit ce qu'on voit et ce qui attend** (par délégation). Sans réseau : « Hors ligne
depuis 14 h 32. Tu consultes la copie de ce poste, du 30/09/2026 à 11 h 58. » (ou « Ce que tu vois
reste à l'écran » si la page était ouverte avant la coupure), puis ce qui attend (brique 73 : « Un
changement attend le réseau : gardé sur ce poste, il partira seul à son retour. »). Le réseau revenu sur une copie : « Recharger ». Sans copie : la raison,
et « Réessayer ». Le menu des entreprises reste ouvert sans réseau (l'entreprise ouverte), pour que
« Se déconnecter » y soit toujours.

Le Cabinet n'a pas encore son hors-ligne (04 § 2 : les dossiers qu'on choisit d'emporter).

**Les tests** (`tests/web/hors-ligne.test.ts`, dans un vrai navigateur ; le réseau se coupe pour de
vrai — le serveur s'arrête et revient au même port, car le service des écrans passe à côté de la
coupure que le navigateur simule) : la copie est sur le poste, le nom d'un client ne s'y lit pas, la
clé n'est pas exportable, et une relecture la refait ; sans réseau, la page se recharge et l'entreprise
se consulte, le bandeau le dit ; l'application refermée se rouvre depuis l'entrée ; le réseau revenu,
« Recharger » montre ce qu'un autre a ajouté ; se déconnecter sans réseau efface la copie, sa clé et la
session ; une page mise à jour vue en ligne est celle qui s'ouvre sans réseau ; sur l'ordinateur d'un
autre, rien n'est gardé et l'écran le dit ; par l'entrée, la case décide où vit la session, et une
nouvelle connexion efface les copies de la précédente.

## Brique 73 : enregistrer sans réseau (fait le 30/09/2026)

**H5. Ce qui attend, c'est l'état enregistré, par rapport à la copie** (par délégation). Le cadrage
(04 § 4) décrit une file de GESTES. Sur la plateforme, l'écran est celui de la v10, qui enregistre
l'ÉTAT de son dossier : le point de contact envoie ce qui diffère de ce que le serveur a, objet par
objet, avec la révision qu'il en connaît (01 R15). Sans réseau, sur « mon ordinateur », c'est donc cet
état qui se garde (chiffré comme la copie), et la copie reste la base : ses révisions disent au
serveur ce que le poste avait vu. Les garanties du cadrage tiennent : **rien ne se perd** (gardé avant
que l'écran ne continue, relu si la page se recharge ou se rouvre sans réseau), **rien ne se double**
(un objet enregistré ne diffère plus de ce que le serveur a), **jamais deux versions d'une même pièce
fusionnées en une troisième** (ce qui a changé ailleurs revient en conflit, et la v10 fusionne comme
elle l'a toujours fait : la version du serveur gardée, l'autre mise de côté dans le dossier et dite).
Sur l'ordinateur d'un autre, rien ne se garde : un enregistrement sans réseau est refusé, et la v10 le
dit (« Rien n'a été enregistré »).

**H6. Au retour du réseau, ça part seul** (par délégation) : dès que le navigateur retrouve le réseau
(et toutes les 30 secondes tant que quelque chose attend), l'écran réenregistre ; à l'ouverture avec le
réseau, ce qui attendait part d'abord, et une pièce changée ailleurs se fusionne de même (le point de
contact fait ce que la v10 fait). Le bandeau le dit : « Le réseau est revenu : tes 2 changements faits
hors ligne sont enregistrés. Une pièce avait changé ailleurs : la version du serveur est gardée, la
tienne est mise de côté, rien n'est perdu. » Il compte ce que la personne a fait (pièces et fiches),
jamais les réglages du dossier qui changent avec elles.

**H7. Ce qui attend le réseau ne se perd pas sans qu'on le demande** (par délégation) : se déconnecter
avec des changements qui attendent pose d'abord la question (« Attendre le réseau » ou « Me déconnecter
quand même ») ; une facture ou un avoir ne s'émet jamais sans réseau (04 § 3.3 : son numéro et son sceau
viennent du serveur) — l'écran propose de l'enregistrer en brouillon.

**Les tests** (`tests/web/hors-ligne-envoi.test.ts`, à la souris, le serveur arrêté pour de vrai) : un
client créé sans réseau — aucune fenêtre « Rien n'a été enregistré », le bandeau dit « Un changement
attend le réseau », gardé chiffré, encore là après un rechargement, parti seul au retour du réseau, et
rien de doublé à la réouverture ; un client changé sans réseau et ailleurs, la page ouverte (la v10
dit « Modifications des deux côtés ») comme rouverte plus tard (le bandeau le dit) : la version du
serveur gardée, la mienne dans ce que le dossier met de côté ; se déconnecter avec des changements qui
attendent : la question, « Attendre le réseau » ne perd rien, et ça part au retour.

**Reste à faire** : le Cabinet hors ligne (les dossiers emportés) ; le stockage persistant demandé
(04 § 4, À VÉRIFIER) ; la durée des droits hors ligne (04 § 7 : 72 heures).

**H8. Ce que le poste garde est à une personne, pas à une session** (par délégation, 30/09/2026 ; défaut
trouvé en relisant la brique 73). Une coupure de plus de 12 heures ferme la session au serveur : à la
reconnexion, l'entrée demande de se reconnecter. Si une nouvelle connexion effaçait le poste (ce que
disait H2), les changements faits hors ligne se perdaient à ce moment précis. Désormais, l'entrée note
à qui est ce que le poste garde : la même personne, reconnectée, le retrouve et ce qui attendait part ;
une autre personne qui se connecte sur ce navigateur le trouve effacé. Test : la session finie au
serveur pendant la coupure, la personne se reconnecte par l'entrée, et son client créé sans réseau
arrive au serveur ; Amel reconnectée retrouve sa copie, Béchir connecté ensuite la trouve effacée.

## Brique 74 : tes appareils ; l'appareil retiré efface ce qu'il garde (fait le 30/09/2026)

**H9. Un appareil perdu, volé ou donné se retire, et oublie tout à sa reconnexion** (par délégation ;
04 § 7, 03 § 6). Paramètres → Données et sécurité → « Tes appareils » : chaque navigateur ou
téléphone où la personne s'est connectée, sous un nom qu'on lit (« Chrome sur Windows », donné par
l'entrée à la connexion), sa dernière activité, celui où l'on est marqué (il ne se retire pas d'ici :
on s'en déconnecte). « Retirer… » demande d'abord (« « Chrome sur Windows » ne pourra plus rien ouvrir,
et ce qu'il garde s'effacera à sa prochaine connexion. »), puis « Oui, le retirer » : ses sessions se
ferment. Quand l'appareil retiré se présente ensuite, le serveur ne dit pas seulement « connecte-toi » :
il dit **qu'il est retiré, et d'effacer** (`effacer: true`, par l'empreinte du jeton : 0043). L'entrée
efface alors, avant toute autre chose, ce que le poste garde (la copie, ce qui attendait le réseau,
leur clé, la session), quel que soit l'écran qui a appelé, et le dit : « Cet appareil a été retiré de
ton compte : ce qu'il gardait pour travailler sans réseau est effacé ; reconnecte-toi pour
continuer. » Une session simplement finie (12 heures sans rien faire) ne reçoit jamais cet ordre : ce
que le poste garde y reste, pour la même personne (H8). **Limite honnête** : un appareil qui ne se
reconnecte jamais garde sa copie, chiffrée (H3) ; le retirer ne l'atteint qu'à sa reconnexion.
**Pas encore** (brique 74 bis) : ce qui attendait le réseau sur l'appareil retiré s'efface avec le
reste, alors que le cadrage (04 § 7) veut qu'il soit d'abord **reçu et mis en quarantaine**, pour que
le propriétaire décide (les ventes d'une caisse retirée par erreur, ou ce qu'a fait un voleur).

**Les tests** : par l'API (`tests/socle/appareils.test.ts`) — la liste ne montre que ses appareils,
celui-ci marqué, un retiré dit ; le jeton d'un appareil retiré reçoit l'ordre d'effacer, une session
fermée jamais ; à la souris (`tests/web/appareils.test.ts`) — le bureau voit ses trois appareils,
retire le portable après la question ; le portable, rouvert sur son entreprise, se retrouve à
l'entrée, sans copie ni session, et l'entrée le dit ; le Mac, retiré à son tour et rouvert par
l'entrée, pareil, puis se reconnecte avec le code et revient comme un appareil neuf, au nom lisible.
