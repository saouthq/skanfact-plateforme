# La répétition générale

*Écrite le 19/10/2026 (1.57.0 ; décidée par délégation, Skander : « prends la décision à ma place »). Avant la première
donnée réelle d'un client, on joue tout ce qui peut arriver à un serveur des pilotes, sur une machine neuve, **avec des
données inventées**. Chaque ligne se coche avec sa date et ce qu'on a vu ; une ligne qui ne passe pas se répare, puis se
rejoue. Rien ne s'ouvre aux pilotes tant qu'une ligne n'est pas cochée.*

Qui fait quoi : **S** = Skander (ce qui demande son compte chez l'hébergeur, Cloudflare, GitHub ou un téléphone) ;
**C** = Claude (par les tâches d'entretien et les tests, jamais en se connectant à un serveur aux vraies données : sur
la machine de la répétition, l'accès de Claude n'existe pas non plus, `docs/mise-en-ligne.md` F).

## 1. La machine

| | Qui | Le geste | Ce qu'on doit voir |
|---|---|---|---|
| 1.1 | S | Une machine neuve, installée en `pilotes` (`docs/mise-en-ligne.md` B5, B bis) | L'installation finit ; `SKANFACT_ENVIRONNEMENT=production` ; le serveur refuse de démarrer sans relais d'e-mails |
| 1.2 | S | Le relais d'e-mails (H1) et qui prévenir (I3) pendant l'installation | Un e-mail d'essai arrive ; un SMS d'essai arrive |
| 1.3 | C | Lire l'état de la machine dans la console (Service › Versions) | Le suiveur attend **toutes les preuves** (« toutes ») ; aucune version sans elles ne s'installe |
| 1.4 | S | Ouvrir `https://<adresse>/etat.json` depuis un navigateur | **Refusé** : l'état détaillé ne se lit que dans la console |
| 1.5 | S | La console à son adresse (J) | L'entrée de la console s'ouvre ; l'application des clients, à côté, aussi |
| 1.6 | C | **La charge** (1.110.0) : `npm run banc:clients 500 60 60` sur cette machine, avant toute donnée réelle (une base à part, détruite ensuite) | Tous les seuils tiennent (VISION § 6) ; sinon la machine se change avant les pilotes, pas les seuils |

## 2. Les copies

| | Qui | Le geste | Ce qu'on doit voir |
|---|---|---|---|
| 2.1 | — | Attendre la première nuit | Service › Sauvegardes : la sauvegarde réussie, **restaurée à part et comptée** (C2) |
| 2.2 | S | Le stockage hors de la machine (C bis 5) | Service › Sauvegardes : les copies partent chaque minute, la dernière il y a moins de cinq minutes |
| 2.3 | — | Le premier exercice du mois (C bis 3) | Réussi, avec ses lignes et ses migrations comptées, et sa durée |
| 2.4 | S + C | **Le jour où le serveur est perdu** (C bis 6) : une seconde machine neuve, `rapatrier.sh`, `restaurer.sh --jusqua` | Tout revient à la minute dite ; les mêmes comptes que la machine d'origine. **Noter la durée** (de la machine neuve au service rouvert) : c'est notre temps de reprise réel (`06` § 4.3, à comparer à l'objectif) |
| 2.5 | S + C | Remettre UNE entreprise à une minute (C bis 7) | Elle seule revient ; ses voisines ne bougent pas ; la chaîne d'empreintes se relit sans rupture |

## 3. La veille et les guets

| | Qui | Le geste | Ce qu'on doit voir |
|---|---|---|---|
| 3.1 | S | Arrêter le programme (`sudo systemctl stop skanfact`) cinq minutes, puis le relancer | E-mail et SMS en moins de deux minutes ; la page d'état passe au rouge, puis au vert ; « Service › Alertes » garde l'histoire |
| 3.2 | S | La variable `SKANFACT_GUET` sur GitHub, avec cette adresse (I bis) | Le guet de GitHub passe toutes les dix minutes ; la veille ne dit plus « ce serveur n'est pas guetté » |
| 3.3 | S | Le second guet (I ter) : le Worker de Cloudflare, sa variable et son jeton | Un passage toutes les dix minutes dans le journal du Worker |
| 3.4 | S | Couper la machine du réseau vingt minutes (le pare-feu de l'hébergeur) | **Deux** tickets s'ouvrent sur GitHub (« Le guet extérieur : … », « Le second guet : … ») et partent par e-mail ; au retour, les deux se ferment seuls |
| 3.5 | S | Remplir le disque à 90 % (un fichier, puis l'effacer) | L'alerte du disque, puis son retour |

## 4. La console

| | Qui | Le geste | Ce qu'on doit voir |
|---|---|---|---|
| 4.1 | S | Deux personnes de la direction, chacune avec son code et ses codes de secours imprimés (Équipe) | Chacune entre ; la dernière direction ne se retire pas |
| 4.2 | S | Un accès d'urgence (C59) : un téléphone « perdu » | L'accès s'ouvre, sert une fois, se dit dans « À décider » ; l'ancien code ne vaut plus |
| 4.3 | S | **Un incident joué** : l'ouvrir sur la fiche « le service ne répond plus », publier sur la page d'état, prévenir les clients touchés, le clore avec son compte rendu et une suite | La page d'état le montre puis l'efface ; le compte rendu se relit ; la suite est dans « À décider » à son jour |
| 4.4 | S | Mettre la TTN en pause une heure, puis la reprendre (C69) | Rien ne part pendant la pause ; tout repart au tour suivant |
| 4.5 | S | Une demande d'effacement sur un compte d'essai (C68) : notée, décidée, faite | La preuve compte ce qui a été fait ; le compte ne se connecte plus |
| 4.6 | S | Bloquer une adresse internet une heure, puis la débloquer (C67) | L'entrée refuse cette adresse et dit jusqu'à quand ; une autre passe |
| 4.7 | — | Le lendemain : Sécurité › Les chaînes d'empreintes | Tout relu, contenu compris, **aucune rupture** |
| 4.8 | S | Les secrets et leur échéance (C53) : chacun noté, avec où il vit | Aucun « en retard » ; le plus proche dans « À décider » trente jours avant |

## 5. Les partenaires

| | Qui | Le geste | Ce qu'on doit voir |
|---|---|---|---|
| 5.1 | S | L'accès d'essai d'El Fatoora (démarche en cours) : une facture d'essai signée et déposée | Acceptée, sa référence et son code QR gardés (`docs/facture-electronique.md`) |
| 5.2 | S | Un paiement d'essai par Konnect (son bac à sable) | Encaissé, la facture payée, le reçu envoyé |
| 5.3 | S | Le code de connexion par SMS (WinSMS) | Reçu en moins d'une minute ; Service › Travaux le compte |

## 6. Signer la répétition

Quand tout est coché : une ligne datée dans `docs/cadrage/README.md` (« répétition générale passée »), avec le temps de
reprise mesuré en 2.4. **Puis** seulement : l'INPDP (`05` § 4), et le premier pilote. La répétition se rejoue **deux
fois par an** (2.4 au moins), et après tout changement de machine ou d'hébergeur.
