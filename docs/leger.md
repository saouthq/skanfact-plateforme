# Léger sur une connexion lente

*01/10/2026, brique 118. Demandé par Skander : « que tout notre projet ne soit pas lourd à charger et à afficher, la
connexion internet en Tunisie est un peu lente ». Règle du projet (`VISION-ARCHITECTURE.md` § 6) : les seuils
s'écrivent **avant** de mesurer ; une mesure qui dépasse change le plan, pas le seuil.*

## Les seuils (écrits le 01/10/2026, avant la mesure ; journal du cadrage)

La connexion lente de référence : **1 Mbit/s** descendant, **300 ms** d'aller-retour, partagés par toutes les
connexions du navigateur.

| | Seuil | Avant (mesuré) | Après (mesuré) |
|---|---|---|---|
| **S1** première ouverture de l'entreprise, rien de gardé | ≤ 1 300 Ko par le fil, utilisable en moins de 15 s | 10 727 Ko, 87 s | **1 242 Ko, 12,1 s** (copie pour le hors-ligne comprise : 1 244 Ko) |
| **S2** ouverture suivante | ≤ 30 Ko par le fil, utilisable en moins de 2 s | 4 199 Ko, 43 s | **4 Ko, 1,8 s** |
| **S3** tout envoi de plus de 1 Ko compressé | écrans et réponses de l'API | rien de compressé | brotli, sinon gzip |
| **S4** le dossier ne se relit que pour ce qui a changé | brique suivante | tout le dossier à chaque ouverture | (à faire) |

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

## Ce qui reste (et pourquoi)

- **S4, le dossier** : à chaque ouverture, tout le dossier de l'entreprise repart du serveur (petit pour une entreprise
  neuve, plusieurs Mo pour cinq ans d'activité, avant compression). Brique suivante : le poste garde sa copie (il le
  fait déjà, chiffrée, sur « mon ordinateur ») et ne demande que ce qui a changé depuis.
- **Le Cabinet** ne s'installe pas encore pour s'ouvrir sans réseau (il n'enregistre pas le service des écrans) ; il
  profite de la compression et des empreintes.
- **HTTP/2** : en production, derrière HTTPS, le serveur parlera HTTP/2 (plusieurs fichiers sur une seule connexion) ;
  la mesure se fait en HTTP/1.1, le cas le plus lent.
- **Brotli 11 à la construction** : environ 8 % de moins encore ; quand on préparera la mise en production.
- **Les visites guidées** (`guide.js`, `visite.js`, `visites.js` : environ 200 Ko compressés) pourraient ne se charger
  qu'à la demande ; pas nécessaire pour tenir les seuils, à reconsidérer si un écran neuf les fait dépasser.

## Les tests

`tests/web/leger.test.ts` : S3 (compression des écrans et de l'API, un petit envoi tel quel, l'empreinte et sa
garde d'un an, la revalidation à vide, l'annonce des scripts) ; S1 et S2 sur la connexion lente, et ce que le poste
garde dès la première visite (l'entreprise, pas le Cabinet). 15 preuves (`tests/preuves.sh`, brique 118), dont les
trois du hors-ligne reciblées.
