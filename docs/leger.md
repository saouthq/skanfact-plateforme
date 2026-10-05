# Léger sur une connexion lente

*01/10/2026, brique 118. Demandé par Skander : « que tout notre projet ne soit pas lourd à charger et à afficher, la
connexion internet en Tunisie est un peu lente ». Règle du projet (`VISION-ARCHITECTURE.md` § 6) : les seuils
s'écrivent **avant** de mesurer ; une mesure qui dépasse change le plan, pas le seuil.*

## Les seuils (écrits le 01/10/2026, avant la mesure ; journal du cadrage)

La connexion lente de référence : **1 Mbit/s** descendant, **300 ms** d'aller-retour, partagés par toutes les
connexions du navigateur.

| | Seuil | Avant (mesuré) | Après (mesuré) |
|---|---|---|---|
| **S1** première ouverture de l'entreprise, rien de gardé | ≤ 1 300 Ko par le fil, utilisable en moins de 15 s | 10 727 Ko, 87 s | **947 Ko, 9,9 s** (copie pour le hors-ligne comprise : 949 Ko ; 05/10/2026, après L6. Le 01/10 : 1 242 Ko, 12,1 s ; le 05/10 avant L6 : 1 302 Ko) |
| **S2** ouverture suivante | ≤ 30 Ko par le fil, utilisable en moins de 2 s | 4 199 Ko, 43 s | **4 Ko, 1,8 s** |
| **S3** tout envoi de plus de 1 Ko compressé | écrans et réponses de l'API | rien de compressé | brotli, sinon gzip |
| **S4** le dossier ne se relit que pour ce qui a changé | sur « mon ordinateur » | tout le dossier à chaque ouverture | **fait** (brique 119) : 1 500 pièces, 695 Ko en entier, **1,2 Ko** après une pièce de plus (avant compression) |

Mesuré par `tests/web/leger.test.ts` : un vrai navigateur (profil sur le disque), derrière un relais qui bride le fil
(`tests/lien-lent.ts` : chaque paquet retardé d'un demi aller-retour, un seul débit partagé par toutes les connexions),
compte les octets reçus et le temps jusqu'à l'écran utilisable. Les chiffres du dernier passage :
`dist/mesures/leger.txt`.

## Ce qui pesait (constaté le 01/10/2026)

1. **Les écrans de la v10 partaient « à ne jamais garder »** : leur adresse (`/v10/…`) commence comme celle de l'API
   (`/v1`), et la règle « une réponse de l'API ne se garde dans aucun cache » (brique 113 bis) les prenait pour elle.
   Chaque ouverture retéléchargeait 4 Mo. Corrigé : `/v1` seul ou `/v1/…`, jamais `/v10/…` (`serveur/app.ts`).
2. **Rien n'était compressé** : 4,1 Mo de scripts et de styles, environ 1 Mo en brotli.
3. **Le service des écrans retéléchargeait tout** à son installation (sans réutiliser ce que la page venait de
   recevoir), et gardait aussi le Cabinet chez qui ne l'ouvre jamais (450 Ko de plus).
4. **Les scripts arrivaient un par un** : Chrome ne demande les scripts du bas de la page qu'un à la fois tant que ceux
   du haut ne sont pas arrivés ; chacun coûtait un aller-retour de plus.

## Ce que fait la brique 118

- **L1. La compression** (`serveur/compression.ts`) : brotli quand le navigateur le connaît, sinon gzip, sinon tel
  quel ; un envoi de 1 Ko ou moins part tel quel. Les écrans sont compressés une fois (brotli 9) puis gardés en
  mémoire ; une réponse de l'API, à chaque fois (brotli 4, rapide).
- **L2. L'empreinte** (`serveur/ecrans.ts`) : chaque fichier a son empreinte (le début de son SHA-256). Le serveur
  l'écrit dans chaque page HTML sur les fichiers qu'elle charge (`app.js?v=3f9c…`) : à cette adresse, le navigateur
  garde le fichier **un an sans redemander** ; une nouvelle version a une nouvelle adresse, donc jamais d'écran
  périmé. Sans empreinte, le fichier se revalide (« ETag » : une réponse vide, 304, s'il n'a pas changé). La page
  elle-même se revalide à chaque ouverture (une réponse vide si elle n'a pas changé).
- **L3. Les scripts s'annoncent** dès le début de la page (`<link rel="preload">`) : le navigateur les demande
  ensemble.
- **L4. Le service des écrans** (`web/public/sw.js`) garde, à son installation, l'entrée et **la page qui l'installe**
  (l'entreprise ; jamais le Cabinet chez qui ne l'ouvre pas) ; il réutilise ce que le navigateur vient de recevoir
  (rien ne repart) ; l'ancienne version d'un fichier s'efface de sa copie.
- **L5. Les écrans de la v10 ne sont pas l'API** : ils se gardent ; les réponses de l'API, jamais (`no-store`).

## L6 : les écrans partent sans leurs commentaires (05/10/2026)

Le 05/10/2026, GitHub a mesuré S1 à **1 302 Ko** pour un seuil de 1 300 : l'exemple rempli et la visite « Faire une
facture » avaient fait grossir les écrans (1 244 Ko le 01/10). Une mesure qui dépasse change le plan, pas le seuil.
Trois leviers pesés, mesurés sur les fichiers du jour :

| Levier | Gain sur S1 | Ce qu'il coûte |
|---|---|---|
| Brotli 11 au lieu de 9 | environ 80 Ko | 7 s de calcul pour compresser les écrans (à chaque démarrage du programme, ou à chaque construction) |
| Les visites guidées à la demande | environ 110 Ko (`visite.js`, `visites.js` ; `guide.js` porte aussi les bulles « i » de chaque champ, il reste) | réécrire la façon dont la v10 lance ses visites et dessine « Guide-moi » sur chaque page |
| **Les écrans sans leurs commentaires** | **environ 355 Ko** | rien de réécrit ; 0,6 s de plus à la construction (37 fichiers, 6,0 Mo → 4,5 Mo avant compression) |

Retenu : le troisième. Le code de la v10 et de la plateforme est écrit pour être relu : compressé, plus d'un tiers de
son poids est fait de commentaires en français, dont le navigateur n'a que faire.

- **Comment** (`web/alleger.ts`, branché sur la construction par `web/vite.config.ts`) : Vite copie `public/` tel
  quel, puis chaque script et chaque feuille de style de nos écrans (`v10`, `plateforme`, `espace`) perd ses
  commentaires, **et rien d'autre** : ni code réécrit, ni noms raccourcis. Les commentaires d'un script, c'est
  l'analyseur que Vite embarque qui les trouve (oxc, par rolldown) : un « // » dans une chaîne, un gabarit ou une
  expression régulière n'en est pas un. Ceux d'une feuille de style, une lecture qui saute les chaînes, les adresses
  sans guillemets et les caractères échappés.
- **Chaque ligne reste à sa place** : un commentaire de plusieurs lignes laisse autant de lignes vides ; une erreur
  signalée depuis un poste pointe donc la ligne du dépôt (et, en JavaScript, un « return » suivi d'un tel commentaire
  rend toujours « undefined »). Un commentaire au milieu d'une ligne laisse une espace : deux mots ne se collent pas.
- **Un script que l'analyseur ne sait pas lire arrête la construction** : il ne part pas à moitié.
- **Le code d'un tiers** (`tiers/`, le dessin des codes QR) part tel quel, avec sa licence ; les pages HTML aussi
  (petites, refaites à chaque demande).
- **Mesuré** : S1 **947 Ko en 9,9 s** (949 Ko avec la copie gardée pour le hors-ligne) ; S2 inchangé (4 Ko, 1,8 s).
  Les deux autres leviers restent en réserve.

## Ce qui reste (et pourquoi)

- **S4 sur l'ordinateur d'un autre** : sans copie gardée (la session ne vit que dans l'onglet), tout le dossier repart à
  chaque ouverture (compressé). Voulu : rien ne reste sur un poste partagé.
- **Les traces de retrait** (`socle.dossier_v10_retire`) ne se purgent pas encore ; à purger après un délai (un poste
  dont la marque est plus ancienne relirait alors tout), quand leur volume le demandera.
- **Le Cabinet** ne s'installe pas encore pour s'ouvrir sans réseau (il n'enregistre pas le service des écrans) ; il
  profite de la compression et des empreintes.
- **HTTP/2** : en production, derrière HTTPS, le serveur parlera HTTP/2 (plusieurs fichiers sur une seule connexion) ;
  la mesure se fait en HTTP/1.1, le cas le plus lent.
- **Brotli 11 à la construction** : environ 8 % de moins encore (mesuré avant L6 : 80 Ko de S1, pour 7 s de calcul) ;
  quand on préparera la mise en production.
- **Les visites guidées** (`visite.js`, `visites.js` : environ 80 Ko compressés après L6 ; `guide.js` porte aussi les
  bulles « i » de chaque champ) pourraient ne se charger qu'à la demande ; pas nécessaire pour tenir les seuils, à
  reconsidérer si un écran neuf les fait dépasser.

## Ce que fait la brique 119 : relire le dossier par différence (S4, 01/10/2026)

- **R1. La marque d'une lecture** est le « xmin » de son instantané : la plus petite transaction encore en cours.
  Chaque objet du dossier porte la transaction qui l'a écrit en dernier (`xid`, 0059). La lecture suivante redemande
  ce qu'une transaction au moins aussi récente a écrit : une écriture encore en cours pendant une lecture a un numéro
  au moins égal à la marque, elle repart la fois suivante, **jamais perdue** (un numéro de séquence ne le garantirait
  pas : il se prend avant le « commit », dans le désordre). Relire deux fois un objet ne coûte que lui.
- **R2. Ce qui a été retiré** laisse une trace (`socle.dossier_v10_retire`, écrite par la base elle-même) ; un objet
  recréé efface sa trace.
- **R3. La différence ne complète que la copie qu'elle peut compléter** : la lecture rend son « profil » (l'identité de
  la base, `socle.instance`, et les rôles) ; une autre base (une entreprise restaurée ailleurs), d'autres rôles, une
  marque « de l'avenir » : tout repart. Un numéro « de l'avenir » (une entreprise restaurée garde les numéros de sa base
  d'origine, pour se ré-exporter à l'identique) n'entre pas dans une différence.
- **R4. Ce qu'un rôle ne voit pas** ne repart pas plus par différence : ni ses objets, ni ses retraits.
- **R5. Le poste** (`pont.js`, « mon ordinateur ») garde la marque et le profil dans sa copie chiffrée ; à l'ouverture,
  il demande `?depuis=…&profil=…`, applique les retraits puis les objets à sa copie, et l'écran s'ouvre dessus.
- Ce qui part au serveur : la marque et le profil que le serveur a lui-même donnés ; rien de plus.

## Les tests

`tests/web/leger.test.ts` : S3 (compression des écrans et de l'API, un petit envoi tel quel, l'empreinte et sa
garde d'un an, la revalidation à vide, l'annonce des scripts) ; S1 et S2 sur la connexion lente, et ce que le poste
garde dès la première visite (l'entreprise, pas le Cabinet). 15 preuves (`tests/preuves.sh`, brique 118), dont les
trois du hors-ligne reciblées.

L6 (05/10/2026), dans le même fichier : un commentaire part, rien d'autre (un script joué avant et après rend la même
chose : ce qui ressemble à un commentaire dans une chaîne, une expression régulière ou un gabarit en reste, « typeof/* */u »
ne colle pas ses deux mots, un « return » suivi d'un bloc de deux lignes rend toujours « undefined » ; une feuille de
style et ses pièges ; un script illisible arrête la construction) ; nos écrans construits n'ont plus un commentaire,
chaque ligne à sa place, le même arbre de syntaxe que le dépôt nœud pour nœud, la même feuille de style relue par un
autre analyseur (lightningcss), et le code d'un tiers intact. 11 preuves (`tests/preuves.sh`, « Les écrans sans leurs
commentaires »).

Brique 119 : `tests/v10/relecture.test.ts` (rien de changé, rien ne repart ; un client noté, retiré, recréé ; l'écriture
en cours pendant une lecture, rendue à la suivante ; une autre base, une marque de l'avenir ; Karim, commercial, qui ne
reçoit ni la paie ni ses retraits ; un numéro d'une autre base ; 1 500 pièces : 695 Ko en entier, 1,2 Ko de différence),
`tests/web/relecture.test.ts` (sur « mon ordinateur », un client ajouté et un autre retiré d'un autre poste : rouvrir ne
fait repartir qu'eux, et l'écran les montre). 13 preuves.
