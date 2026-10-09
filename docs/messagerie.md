# La messagerie entre l'entreprise et son cabinet

*09/10/2026, lot messagerie. Décidée par Skander le 09/10/2026 sur deux maquettes validées : « Mon comptable »
(l'entreprise) et « Les messages de tes clients » (le cabinet) ; le cadrage fait foi :
`docs/cadrage/14-fonctions-et-integrations.md` § 2.4 du dépôt `skanfact`. Ce document dit ce qui en est fait, décision par
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
- **demander une pièce** (le cabinet) : la demande attend jusqu'à ce que le client l'envoie (« Envoyer la pièce… »,
  une photo ou un PDF, qui y répond), ou que le cabinet la dise « Reçue autrement » ;
- **porter une photo (JPEG, PNG, WebP) ou un PDF**, 10 Mo au plus, reconnu à ses premiers octets par le serveur (jamais à
  son nom), gardé sur nos serveurs avec l'entreprise, joint à un seul message ; déposé mais pas encore joint, seul celui
  qui l'a déposé le lit ;
- **être rangé dans les achats** : « Ranger dans mes achats… » ouvre un nouvel achat et y fait lire la photo par le
  serveur (la lecture de la brique 84 ; sans elle, l'achat se saisit à la main) ; enregistré, le message dit où la
  pièce est rangée (« rangée dans tes achats (STEG, 85,400 DT) »).

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

**M8. Ce qui part vers le serveur, compté** (règle du projet). Un message : son texte, la pièce dont il parle (genre,
identifiant, libellé), la pièce demandée, le fichier déposé, la demande à laquelle il répond. Un fichier : son nom et ses
octets. Rien d'autre. Ce qui part chez le relais d'e-mails : l'adresse de la personne, l'objet et le texte fixes.

## Les écrans

- **Entreprise — « Mon comptable »** : une entrée en bas du menu, qui paraît quand un cabinet tient le dossier (ou l'a
  tenu), avec sa pastille (non lus + questions sans réponse + pièces demandées). Le haut : le cabinet, « tient ta
  comptabilité depuis le … ». Le fil par jour ; à côté, « En attente de toi », « Ce que voit ton cabinet » (et le
  mandat), « Me prévenir par e-mail ». Écrire : « Joindre une photo ou un PDF », « Parler d'une pièce », « Envoyer »
  (Entrée envoie, Maj+Entrée va à la ligne ; au téléphone, le bouton).
- **Cabinet — « Messages »** : la boîte, filtres « À traiter (n) », « Attend le client (n) », « Tout (n) » ; une ligne
  par client en ligne (pas les dossiers tenus seul au cabinet) ; le client choisi à côté, avec « Ouvrir la
  conversation », « Demander une pièce », « Question sur une pièce ». La conversation : « Demander une pièce », « Reçue
  autrement », « C'est traité », « Me prévenir par e-mail ».

## À VÉRIFIER

- **La durée de garde des messages et des fichiers** (INPDP) : aujourd'hui, ils vivent aussi longtemps que l'entreprise.
- **Les mentions** à faire figurer dans les conditions du service sur la messagerie (ce que le cabinet voit, ce que
  l'entreprise garde).
