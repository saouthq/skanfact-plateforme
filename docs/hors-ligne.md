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

**Reste à faire** : le Cabinet hors ligne (les dossiers emportés). (Le stockage persistant et la durée
des droits hors ligne : brique 75, H11 et H12.)

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
il dit **qu'il est retiré, et d'effacer** (`effacer: true`, par l'empreinte du jeton : 0043). L'appareil
efface alors, avant toute autre chose (sauf remettre ce qui attendait le réseau : H10), ce que le poste
garde (la copie, ce qui attendait, leur clé, la session) : l'écran de l'entreprise le fait, et l'entrée,
si c'est elle qui l'apprend, y passe d'abord (quel que soit l'écran qui a appelé) ; puis l'entrée le
dit : « Cet appareil a été retiré de
ton compte : ce qu'il gardait pour travailler sans réseau est effacé ; reconnecte-toi pour
continuer. » Une session simplement finie (12 heures sans rien faire) ne reçoit jamais cet ordre : ce
que le poste garde y reste, pour la même personne (H8). **Limite honnête** : un appareil qui ne se
reconnecte jamais garde sa copie, chiffrée (H3) ; le retirer ne l'atteint qu'à sa reconnexion.
Ce qui attendait le réseau n'est pas perdu : il est d'abord remis au serveur, en quarantaine (H10).

**Les tests** : par l'API (`tests/socle/appareils.test.ts`) — la liste ne montre que ses appareils,
celui-ci marqué, un retiré dit ; le jeton d'un appareil retiré reçoit l'ordre d'effacer, une session
fermée jamais ; à la souris (`tests/web/appareils.test.ts`) — le bureau voit ses trois appareils,
retire le portable après la question ; le portable, rouvert sur son entreprise, se retrouve à
l'entrée, sans copie ni session, et l'entrée le dit ; le Mac, retiré à son tour et rouvert par
l'entrée, pareil, puis se reconnecte avec le code et revient comme un appareil neuf, au nom lisible.

## Brique 74 bis : la quarantaine (fait le 30/09/2026)

**H10. Ce qu'un appareil retiré avait fait hors ligne est remis, jamais appliqué d'office ; le
propriétaire décide** (par délégation ; 04 § 7 : « reçus mais mis en quarantaine, jamais appliqués
d'office… rien n'est perdu, rien n'est cru sur parole »). Quand le serveur dit à un appareil qu'il est
retiré, l'écran de l'entreprise remet d'abord au serveur ce qui attendait le réseau (les changements,
par rapport à ce que le poste avait vu), PUIS efface ce que le poste garde. Si l'application se rouvre
sur l'entrée, l'entrée passe par l'entreprise gardée pour que cette remise ait lieu. Si la remise ne
passe pas (le réseau retombe, le serveur trébuche), **rien ne s'efface** : l'écran le dit, et
« Réessayer » recommence. Le serveur n'accepte une remise que par le jeton d'une session encore
ouverte au retrait, dans une entreprise dont la personne est membre, une seule fois par session
(0044) ; l'entrée dit ensuite à l'appareil combien de ses changements sont mis de côté.

Chez l'entreprise : à l'ouverture, le bandeau dit « Un appareil retiré a remis 2 changements faits
hors ligne : ils attendent ta décision. » ; « Voir » mène à Paramètres → Données et sécurité →
« Remis par un appareil retiré » : qui, depuis quel appareil, quand, et chaque changement en clair
(« Client « Café des Arts » ajouté »). **Accepter** applique chaque changement comme s'il arrivait
maintenant, avec la révision que l'appareil avait vue : ce qui a changé depuis (ou que le serveur
refuse, une facture émise par exemple) est **mis de côté et dit**, la version du serveur gardée —
jamais deux versions fusionnées en une troisième. **Rejeter…** demande d'abord, puis n'applique rien.
Dans les deux cas la remise reste au serveur, décidée, et ne se réécrit jamais. Décident ceux qui
enregistrent le dossier (propriétaire, administrateur).

**Limite honnête** : seule l'entreprise ouverte (ou gardée pour l'entrée) remet ce qui l'attendait ;
un poste qui aurait des changements en attente dans deux entreprises à la fois (ce que l'écran ne
permet pas sans réseau) ne remettrait que ceux de la première.

**Les tests** : par l'API (`tests/socle/quarantaine.test.ts`) — remis, jamais appliqué d'office ; renvoyé,
rien ne se double ; un jeton valable, une session fermée avant le retrait, une entreprise d'un autre :
rien ; l'entrée dit le nombre remis ; accepté, c2 et le réglage s'appliquent, c1 changé depuis est mis
de côté et dit ; décidé une fois ; jamais réécrit ; rejeté, rien ne s'applique ; une autre entreprise ne
voit rien, même dans la base. À la souris (`tests/web/quarantaine.test.ts`) — le portable perdu, rouvert
sur l'entrée : une remise qui échoue n'efface rien et le dit ; « Réessayer » remet, efface, et l'entrée
le dit ; au bureau, le bandeau, « Voir », le panneau, « Rejeter… » qui demande, « Accepter » : le client
créé arrive, le renommage (changé depuis au bureau) est mis de côté et dit, et l'écran rechargé montre le
client arrivé.


## Brique 75 : les limites du hors-ligne (fait le 30/09/2026)

**H11. On n'enregistre sans réseau que si le navigateur promet de garder** (par délégation ; 04 § 4 :
« si le navigateur le refuse, l'écran le dit, et le hors-ligne est limité à la consultation »). Le
navigateur peut vider ce qu'un site garde (Safari après sept jours sans visite, Chromium quand le
disque se remplit) : sur « mon ordinateur », le poste lui demande le **stockage persistant**. Accordé
(l'application installée, en général), on enregistre sans réseau comme avant. Refusé, le poste garde
sa copie pour qu'on **consulte**, mais **rien ne s'enregistre** sans réseau : on ne promet pas de
garder ce qui peut disparaître. Le bandeau le dit dès la coupure (« Ce navigateur peut vider ce que
ce poste garde : sans réseau, tu consultes, mais rien ne s'enregistre. Pour enregistrer sans réseau,
installe l'application (menu du navigateur, « Installer SkanFact »). »), et la fenêtre « Rien n'a été
enregistré » répète pourquoi. **À VÉRIFIER** (04 § 11.2) : ce que chaque navigateur accorde (Chromium
ne l'accorde pas à une page non installée et peu visitée ; Safari et Firefox restent à mesurer) ; le
nom exact du geste d'installation dans chaque navigateur.

**H12. Les droits gardés hors ligne valent 72 heures** (par délégation ; 04 § 7, 03 D8). Le poste
note le dernier contact avec le serveur (une réponse, pas le simple retour du réseau : un portail
d'hôtel ou un serveur en panne n'en sont pas). Plus de 72 heures après, **rien de neuf ne
s'enregistre** sans réseau, le temps que le serveur revoie les droits ; on consulte, et ce qui
attendait **partira** au retour. Le bandeau et la fenêtre le disent (« Plus de 72 heures sans contact
avec le serveur : rien de neuf ne s'enregistre sur ce poste tant qu'il n'a pas revu tes droits ; tu
consultes. »). Le serveur revenu, le compte repart. (La caisse aura 7 jours, avec la caisse.)

**Les tests** (`tests/web/hors-ligne-limites.test.ts`, à la souris, le serveur arrêté pour de vrai) :
un navigateur qui ne promet pas de garder — le bandeau le dit, un client créé sans réseau est refusé
et la fenêtre dit pourquoi, rien n'attend sur le poste, et la copie se consulte encore après un
rechargement ; l'application qui demande à garder (un premier lancement) — accordé, elle enregistre ;
à 71 heures on enregistre encore, à 72 heures et 5 minutes non, et le bandeau dit à la fois ce qui
attend et la limite ; le réseau revenu sans le serveur ne remet pas le compte à zéro ; le serveur
revenu, ce qui attendait part (avec ce qui était resté à l'écran), et le compte repart. Les parcours
hors ligne des briques 72 à 74 bis jouent l'application installée (le stockage persistant accordé).

## Brique 76 : un membre retiré (fait le 30/09/2026)

**H13. Une personne retirée de l'équipe : ses postes effacent ce qu'ils gardaient de CETTE entreprise,
après avoir remis ce qui l'attendait** (par délégation ; 03 D8 : « un membre retiré voit les données
de cette entreprise effacées de ses postes à leur reconnexion »). Quand son poste rouvre l'entreprise
avec le réseau, le serveur ne la lui montre plus : l'écran remet d'abord ce qui l'attendait (en
quarantaine, comme un appareil retiré, H10 : sa session est valable, et la base vérifie qu'elle a été
membre et ne l'est plus, 0045), puis efface la copie, ce qui attendait et le souvenir de cette
entreprise — **les autres entreprises du poste restent** —, et le bandeau le dit (« Cette entreprise ne
t'est plus ouverte (tu as été retiré de son équipe, ou elle n'existe plus) : ce que ce poste en gardait
est effacé, et ton changement fait hors ligne est remis à son propriétaire, qui décidera. »), avec
« Continuer », qui mène à l'entrée. Une remise qui échoue n'efface rien, et l'écran le dit. Le
propriétaire décide de la remise comme pour un appareil retiré.

**Les tests** : par l'API (`tests/socle/quarantaine.test.ts`) — encore membre, rien n'est reçu ; retiré,
sa session valable remet ; jamais membre, rien ; le propriétaire voit qui et depuis quel appareil. À la
souris (`tests/web/membre-retire.test.ts`) — Karim, administrateur de l'épicerie et patron de sa propre
entreprise, crée un client sans réseau ; Nadia le retire ; son portable rouvre l'épicerie : une remise
qui échoue n'efface rien, « Réessayer » remet, la copie et l'attente de l'épicerie s'effacent (celle de
son entreprise reste), l'entrée ne la rouvrira plus sans réseau, et « Continuer » ouvre son entreprise ;
Nadia voit la remise.

## Brique 108 : le compte juste des changements en attente (fait le 01/10/2026)

Sans réseau, le bandeau dit combien de changements attendent. Le parcours du jalon J2 a montré « 2 changements
attendent le réseau » pour un seul client noté hors ligne. Le second était un achat fait plus tôt, sur l'autre
poste : la v10 crée un achat sans sa devise et la lui pose au chargement suivant (`migrateData`, 10.1.0 : la
devise de la société, au taux de 1). Sur le poste qui rouvrait le dossier, ce retouchage partait avec le premier
enregistrement et se comptait comme un geste de la personne : une phrase affichée que rien ne tient.

Un achat naît maintenant avec sa devise, comme le chargement la lui aurait posée (`web/v10/compte-hors-ligne.txt`) :
rien ne change d'un millime, il n'y a plus rien à retoucher, et le bandeau dit « Un changement attend le réseau ».
Le parcours J2 l'exige mot pour mot ; sa preuve retire la devise à la naissance de l'achat, et le parcours tombe.

Un filtre plus large (ne pas compter une fiche qui n'a fait que changer de place dans sa liste) a été essayé puis
retiré : il ne faisait rien tomber, donc rien ne le justifiait. D'autres retouchages du chargement pourraient
exister sur d'autres objets anciens : chacun se corrige à la naissance de l'objet, quand un parcours le montre.
