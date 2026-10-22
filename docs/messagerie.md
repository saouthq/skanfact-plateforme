# La messagerie entre l'entreprise et son cabinet

*09/10/2026, lot messagerie. Décidée par Skander le 09/10/2026 sur deux maquettes validées : « Mon comptable »
(l'entreprise) et « Les messages de tes clients » (le cabinet) ; le cadrage fait foi :
`docs/cadrage/14-fonctions-et-integrations.md` § 2.4. Ce document dit ce qui en est fait, décision par
décision ; celles marquées « par délégation » sont prises le 09/10/2026.*

Le code : la base `base/migrations/0078_messagerie.sql` (schéma `messagerie`), le serveur `serveur/messagerie/`
(routes, gestes, textes, et le postier des alertes), l'écran partagé `web/public/plateforme/messagerie.js` et
`messagerie.css`, branché dans l'entreprise (`web/public/v10/app.js`, page `#/comptable`, et `pont.js`) et dans le
Cabinet (`web/public/v10/cabinet/app.js`, page `#/messages`, et `pont-cabinet.js`). Les tests :
`tests/messagerie/messagerie.test.ts` (l'API) et `tests/web/messagerie.test.ts` (à la souris).

## Ce que fait le lot

**M1. Un fil par entreprise et par cabinet, qui appartient à l'entreprise** (par délégation). Ses messages, ses
fichiers et l'état de lecture vivent avec l'entreprise : ils partent avec elle à l'export (`base/entreprise.ts`). Un
nouveau cabinet ne lit pas ce que l'ancien s'est dit avec elle ; l'entreprise, elle, relit tous ses fils (« Tes cabinets
d'avant »). Un mandat arrêté ferme le fil au cabinet : il ne le lit plus, et l'entreprise ne peut plus y écrire.

**M2. Qui lit et écrit** (par délégation). Côté entreprise : le propriétaire, un administrateur, la comptabilité
interne — ceux qui répondent déjà aux questions du cabinet. Côté cabinet : ceux de ses membres qui voient le dossier
(la supervision, ou le membre à qui il est confié), sous un mandat actif, **quel qu'en soit le périmètre** (un cabinet
qui ne fait que la paie parle aussi à son client). Jamais une clé de l'API : la messagerie se tient entre personnes.
La base le garde elle-même (`messagerie.exiger`, sécurité par ligne sur chaque table) ; un commercial, la voisine ou un
collaborateur sans le dossier ne lisent aucune ligne, même directement.

**M3. Les questions de la révision sont dans le fil, sans y être recopiées.** Elles vivent dans les livres
(`compta.question`, brique 44) : le fil les montre à leur date d'envoi, avec leur pièce, leur montant et ce que le cabinet
attend, et leur réponse à sa date. L'entreprise y répond sur place (le même chemin que le bandeau d'une pièce,
`repondreA`). Le cabinet les pose toujours depuis la révision : « Question sur une pièce » y mène.

**M4. Une pièce, une photo, une pièce demandée.** Un message peut :
- **parler d'une pièce** (« Parler d'une pièce » : une facture, un avoir, un devis ou un achat du dossier ; le message
  garde son libellé du moment, « Ouvrir » la retrouve) ;
- **demander une pièce** (le cabinet) : la demande attend jusqu'à ce que le client l'envoie, ou que le cabinet la dise
  « Reçue autrement ». (1.115.0) « Envoyer la pièce… » ouvre une fenêtre : **une photo ou un PDF** (vu avant de partir,
  « Changer », « Annuler »), **ou la pièce déjà dans le dossier** (une facture, un avoir, un devis ou un achat, à
  chercher, avec sa date), et un mot facultatif ; rien ne part avant « Envoyer à mon cabinet » ;
- **porter une photo (JPEG, PNG, WebP) ou un PDF**, 10 Mo au plus, reconnu à ses premiers octets par le serveur (jamais à
  son nom), gardé sur nos serveurs avec l'entreprise, joint à un seul message ; déposé mais pas encore joint, seul celui
  qui l'a déposé le lit ;
- **être rangé dans les achats** : « Ranger dans mes achats… » ouvre un nouvel achat et y fait lire la photo par le
  serveur (la lecture de la brique 84 ; sans elle, l'achat se saisit à la main) ; enregistré, le message dit où la
  pièce est rangée (« rangée dans tes achats (STEG, 85,400 DT) »).

**M4 bis. Une pièce demandée a une date, et se relance** (1.116.0 ; décidé par délégation après la revue du 22/10/2026,
`docs/revue-messagerie.md` point 6). La demande porte une date « pour le » (facultative ; l'écran propose dans sept
jours, jamais avant aujourd'hui, jour de Tunis). Passée sans réponse, elle est **en retard** des deux côtés : la carte
le dit (« En retard », en rouge), l'encart aussi (« (dont 1 en retard) »), et la boîte du cabinet a une pastille
« N en retard » sur la ligne du client (`attente` et la boîte comptent avec les mêmes lignes). Restée sans réponse à sa
date, elle **se relance par e-mail** ce jour-là, puis une fois par semaine, **trois relances au plus** ; une demande sans
date ne se relance jamais (le cabinet garde la main), une demande reçue non plus, ni un dossier dont le mandat s'est
arrêté, ni une personne qui a décoché « Me prévenir par e-mail » pour ce fil. L'e-mail suit la règle de M5 : ni la
pièce, ni l'entreprise, ni le cabinet, un objet et un texte fixes (« Ton cabinet attend une pièce dans SkanFact ») ;
une personne reçoit un seul e-mail par tour, quel que soit le nombre de demandes. Le cabinet voit sous la carte
« Relancée 2 fois par e-mail, la dernière le … » ; le client ne voit que la date (la relance est un e-mail, pas un
reproche dans le fil). Le serveur seul note une relance partie (`messagerie.relance_partie`).

**M4 ter. Plusieurs pièces, plusieurs clients** (1.116.0). « Demander une pièce » prend une liste (« + Une autre
pièce », dix au plus) : un message par pièce, le mot sur la première, la même date, **toutes ou aucune** (une seule
transaction). La boîte du cabinet a « Demander à plusieurs clients… » : les mêmes pièces, la même date et le même mot,
envoyés à chaque client coché, chacun dans son fil (jamais un fil commun : un client ne voit pas les autres) ; un client
qui refuse (mandat arrêté entre-temps) est nommé, les autres partent et leur case se décoche.

**M4 quater. Le cabinet agit sur ce qu'il reçoit** (1.116.0). Une pièce citée par le client (« Achat F-8841 ») a
« Ouvrir » chez le cabinet aussi : les livres du client, au livre-journal, son numéro cherché, brouillard compris (le
Cabinet ne voit pas la facture elle-même, mais ses écritures ; un devis n'en a pas, une pièce sans numéro non plus : on
le dit). Une photo ou un PDF du client a « Saisir cette pièce » : la photo s'ouvre dans un autre onglet, la saisie du
client à l'année du message en face. Le justificatif ne s'y joint pas seul (le Cabinet en ligne ne joint pas encore de
fichier à une écriture) : la photo reste dans le fil, à sa date.

**M4 quinquies. Les modèles de messages du cabinet** (1.117.0 ; décidé par délégation, revue du 22/10/2026, point 9).
Le cabinet garde ses phrases (un titre de 80 caractères, un texte de 4 000), partagées par toute son équipe, cinquante au
plus, deux jamais sous le même titre (majuscules comprises). « Modèles » (sous le champ, chez le cabinet) ouvre la
fenêtre : en prendre un le pose dans le champ, là où est le curseur, où il se relit et se change avant de partir ; en
ajouter, le changer, le retirer (après « Oui, le retirer »). Deux mots se remplacent au moment de le prendre :
**{client}** (le nom du client) et **{mois}** (le mois qui vient de finir, jour de Tunis). Dans « Demander à plusieurs
clients… », {client} devient le nom de chacun. Vide, la fenêtre propose trois exemples. Les modèles appartiennent au
cabinet (`messagerie.modele`, 0169) : ils ne partent pas avec l'export d'une entreprise. La base garde les règles
(`messagerie.modele_poser`, `messagerie.modele_retirer`) ; un autre cabinet ne les lit ni ne les touche.

**M4 sexies. Chercher** (1.117.0, point 10). Dans un fil, « Chercher » (des deux côtés) : les messages dont le texte, la
pièce demandée, la pièce citée ou le nom du fichier contiennent les mots, sans tenir compte des majuscules ni des
accents (`messagerie.plier`), trente au plus, du plus récent ; un message choisi se montre dans le fil, éclairé (les
pages plus anciennes se lisent jusqu'à lui). Les questions de la révision ne sont pas cherchées (elles vivent dans les
livres). Dans la boîte du cabinet, « Chercher un client » : par son nom, parmi tous les clients, quel que soit le filtre.

**M4 septies. La pastille sur la liste des dossiers** (1.117.0, point 11). Dans le Cabinet, la ligne d'un client « À
traiter » porte la pastille de ses messages (le nombre de non-lus, ou la bulle seule s'il a répondu à une question) ;
elle mène à sa conversation. Une ligne a la pastille exactement quand le client compte dans celle du menu « Messages »
(la même lecture du serveur).

**M5. L'alerte par e-mail, sans contenu** (décidé par Skander le 09/10/2026 ; détails par délégation). Chaque minute,
le serveur cherche qui a, **depuis plus de cinq minutes**, quelque chose à lire dans un fil (un message de l'autre côté,
une question envoyée, la réponse du client à une question), et le prévient **une fois** ; plus rien avant qu'il ait relu
le fil. L'e-mail ne porte **ni le message, ni son auteur, ni le nom de l'entreprise ou du cabinet, ni un identifiant** :
un objet et un texte fixes, et l'adresse de l'application. Il ne part qu'à une **adresse vérifiée** (une adresse que
personne n'a prouvée ne reçoit rien : l'alerte dirait à un inconnu qu'un compte existe), et seulement si le serveur a un
relais d'e-mails. Elle est **cochée par défaut** ; « Me prévenir par e-mail » la décoche, fil par fil. Une personne
reçoit au plus un e-mail par tour et par côté, quel que soit le nombre de fils qui l'attendent.

**M6. « À traiter », « Attend le client », « Rien à faire » : calculés au serveur** (par délégation). Un client est
**à traiter** quand il a écrit ou répondu depuis la dernière réponse du cabinet (ou depuis que le cabinet a dit « C'est
traité ») ; sinon il **attend le client** s'il reste une question sans réponse ou une pièce demandée pas reçue ; sinon,
**rien à faire**. La boîte s'ouvre sur ce qui attend (« À traiter » s'il y a lieu, sinon « Attend le client », sinon
« Tout »). La boîte, ses compteurs et la pastille du menu sortent des mêmes lignes ; « ce qui attend » un fil
(non lus, questions sans réponse, pièces demandées) est une seule fonction (`attente`), pour la pastille de « Mon
comptable », l'encart du fil et la boîte.

**M7. Pas de « en train d'écrire »** (décidé par Skander). La page ouverte relit le fil toutes les 30 secondes tant
qu'elle est visible ; un message arrive dans la minute. La pastille de « Mon comptable » se relit au même rythme ; celle
des « Messages » du Cabinet, chaque minute. Ouvrir le fil le marque lu (une pièce demandée comprise, même si elle compte
dans les pièces demandées plutôt que dans les non-lus) ; l'autre côté voit « Lue » sous son message. Chaque message se
range du côté de qui l'a écrit, signé « Toi » pour ses propres messages et du nom de l'auteur sinon (un collègue du
cabinet, un administrateur de l'entreprise).

**M7 bis. Les noms de qui pose et de qui répond aux questions** (1.115.0). Une question se signe du nom de la personne
qui l'a posée, comme un message (elle se disait posée par « Ton cabinet » à côté d'un message signé « Sonia Ben
Youssef ») ; sa réponse, du nom de qui a répondu. Les noms seuls (jamais l'adresse), lus par
`messagerie.noms_des_questions` pour un fil qu'on lit, ou côté entreprise pour son cabinet (une question peut arriver
avant le premier message). Une question répondue le dit : « Répondue ».

**M8. Ce qui part vers le serveur, compté** (règle du projet). Un message : son texte, la pièce dont il parle (genre,
identifiant, libellé), la pièce demandée et sa date « pour le », le fichier déposé, la demande à laquelle il répond. Un fichier : son nom et ses
octets. Rien d'autre. Ce qui part chez le relais d'e-mails (l'alerte comme la relance) : l'adresse de la personne, l'objet et le texte
fixes.

## Les écrans

- **Entreprise — « Mon comptable »** : (1.115.0) une entrée **dans le pied du menu**, qui ne défile jamais (avec
  « Tous les modules », « Paramètres », « Aide »), qui paraît quand un cabinet tient le dossier (ou l'a tenu), avec sa
  pastille (non lus + questions sans réponse + pièces demandées). Le haut : le cabinet, « tient ta comptabilité depuis
  le … ». Le fil par jour, **à la hauteur de l'écran**, la zone d'écriture en bas ; à côté, « En attente de toi »
  (« Répondre » y mène et éclaire la carte), « Ce que voit ton cabinet » (et le mandat), « Me prévenir par e-mail ».
  Écrire : « Joindre une photo ou un PDF », « Parler d'une pièce », « Envoyer » (Entrée envoie, Maj+Entrée va à la
  ligne ; au téléphone, le bouton). Ce qui est joint se range sous les boutons (« Envoyer » ne bouge pas). Sous ses
  messages : « Envoyé », puis « Lue ».
- **Cabinet — « Messages »** : (1.115.0) la boîte, filtres « À traiter (n) », « Attend le client (n) », « Tout (n) » ;
  **la liste à gauche, la conversation entière du client choisi à droite** (comme Karbon, Front et toute messagerie :
  il fallait un aperçu, puis « Ouvrir la conversation », sur une autre page) ; ↑ et ↓ passent d'un client à l'autre ;
  un client traité ou qui a reçu une réponse reste dans la liste tant qu'on le lit ; la pastille des non-lus suffit (pas
  d'étiquette « À traiter » en plus). Au-dessus du fil, un bandeau : ce qui attend le client, « Marquer comme traité »,
  « Question sur une pièce (révision) », « Me prévenir par e-mail ». « Ouvrir en grand » mène à la page du client
  (`#/messages/<entreprise>`), qui a « Demander une pièce », « Reçue autrement », « Marquer comme traité ».
  (1.116.0) « Demander une pièce » ouvre, au-dessus du champ (rien ne pousse les boutons), la liste des pièces et
  « Pour le » ; en haut de la boîte, « Demander à plusieurs clients… » ; sur une ligne, la pastille d'état et, en
  dessous, « N en retard ». Sous une pièce citée, « Ouvrir » ; sous une photo du client, « Saisir cette pièce ».
  (1.117.0) « Modèles » sous le champ ; « Chercher » en haut de la conversation ; « Chercher un client » en haut de la
  liste ; au téléphone, « Modèles » et « Chercher » en icône seule, les gestes en mots courts dès que la zone est étroite.
- **Au téléphone** (1.115.0) : un bouton de bulle à côté de « Menu », avec la même pastille, mène à « Mon comptable »
  ou aux « Messages » (dans le menu replié, la pastille ne se voyait pas) ; le fil et la zone d'écriture tiennent dans
  l'écran, « Envoyer » sous le pouce, les gestes en mots courts (« Joindre », « Une pièce », « Demander ») ; une ligne
  de la boîte ouvre la conversation sur sa page.

## À VÉRIFIER

- **La durée de garde des messages et des fichiers** (INPDP) : aujourd'hui, ils vivent aussi longtemps que l'entreprise.
- **Les mentions** à faire figurer dans les conditions du service sur la messagerie (ce que le cabinet voit, ce que
  l'entreprise garde).
