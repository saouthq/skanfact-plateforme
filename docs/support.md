# Le support de SkanFact

*Support S1, 13/10/2026 (version 1.3.0) ; l'accès au dossier, Support S2 (version 1.4.0). Le cadrage : `docs/cadrage/10-console.md` § 2.7 (le support), 01 § 18
(« ticket_support »), 03 § 5 (qui voit quoi). La console : `docs/console.md` C29.*

Une personne d'une entreprise écrit à l'équipe SkanFact depuis son application ; l'équipe lui répond depuis la console ;
la réponse se lit dans l'application. Une demande arrivée ailleurs (un e-mail, un message WhatsApp, un appel) se **note**
dans la console, au nom d'une personne de l'entreprise, qui la retrouve dans son application avec la réponse.
**Le support ne voit rien du dossier d'un client** — seulement ce que la personne a écrit — **tant que le client ne l'a
pas accordé** (Support S2, plus bas) : l'équipe le demande depuis la console, avec son motif ; le propriétaire ou un
administrateur l'accorde dans son application, quelques heures, en lecture ; chaque page lue est notée et se relit.

## Où ça vit

| Quoi | Où |
|---|---|
| Les demandes, leurs messages, chaque contrôle | `base/migrations/0095_support.sql` |
| Les routes de la personne | `serveur/support/routes.ts`, ses gestes `serveur/support/gestes.ts` |
| L'alerte par e-mail | `serveur/support/postier.ts` (le tour du postier de la messagerie) |
| Les routes de la console, ce qu'elle lit et range | `serveur/console/routes.ts`, `serveur/console/support.ts` (pur) |
| L'écran de la console | `web/console/src/ecrans/Support.tsx` ; l'onglet « Ses demandes » de la fiche d'un client |
| Côté client | `web/v10/support.txt` (la fenêtre de l'Aide, la pastille, la page), `web/public/plateforme/support.js` et `.css` |
| L'accès au dossier (S2) : la base | `base/migrations/0096_acces_support.sql` (les accès, chaque page lue, intouchable) |
| … le serveur | `serveur/support/acces.ts` (pur), les routes des deux côtés (`serveur/support/routes.ts`, `serveur/console/routes.ts`) |
| … la console | `web/console/src/ecrans/AccesDossier.tsx` (la bande d'une conversation, la carte de la fiche) |
| … l'application de l'entreprise | `web/v10/acces-support.txt`, `web/public/plateforme/acces.js` et `.css` (le bandeau, le panneau) |
| … la lecture du support | `web/public/plateforme/pont.js` (le mode lecture), `poste.js` (rien sur le poste) |
| Les tests | `tests/support/` (l'API, la lecture pure, `acces.test.ts`), `tests/web/support.test.ts` et `tests/web/acces.test.ts` (à la souris) |

## Les règles

- **Une demande appartient à une entreprise ET à la personne qui la pose.** Chacun ne lit que SES demandes, dans
  l'entreprise de la route : ni un collègue (on élargit un droit en le décidant, 03 D4), ni la voisine, ni une autre
  entreprise de la même personne. Jamais une clé de l'API : le support se tient entre personnes. La base le tient
  (`support_exiger`, `support_ma_demande`), les routes ne font que l'appeler.
- **Ce qui part avec une demande, compté et décidé** : le sujet (3 à 140 caractères, sans `<` ni `>`), le texte, la
  version de l'application et le **nom** de la page où était la personne (« factures »). Jamais un identifiant, jamais
  une donnée du dossier. Un champ de plus est refusé.
- **Un double envoi n'ouvre pas deux demandes** : le même sujet et le même texte, dans les cinq minutes, rendent la
  demande déjà posée.
- **Un message ne se modifie ni ne s'efface** (la base le refuse) : on en écrit un autre. Une réponse de l'équipe peut
  citer un **article de l'Aide** de l'application, par son identifiant seulement (le texte vit dans l'Aide, une seule
  source) ; un article que l'Aide n'a pas est refusé.
- **Close par la personne** (« C'est réglé ») ou **par l'équipe** (avec son motif) ; une demande close **se rouvre quand
  la personne réécrit**, avec tout ce qui s'est déjà dit. L'équipe ne répond pas à une demande close : elle la rouvre
  d'abord, avec son motif.
- **Une entreprise en lecture seule écrit quand même au support** (`support.ecrire` est ouvert dans la politique de
  lecture seule) : c'est souvent là qu'on en a besoin.
- **L'alerte par e-mail ne porte rien de la réponse** : un objet et un texte fixes, l'adresse de l'application ; ni la
  réponse, ni son auteur, ni le sujet, ni l'entreprise (comme l'alerte de la messagerie). Elle part **cinq minutes**
  après une réponse non lue, **une fois par réponse**, un seul e-mail par personne et par tour, à une **adresse
  vérifiée** d'une personne **encore membre** de l'entreprise. Une demande close ne prévient plus.

## Dans l'application de l'entreprise

- **« Écrire au support »** dans l'Aide (la fenêtre de la v10, réécrite par `web/v10/support.txt`) : le sujet, ce qui se
  passe, puis la page de la demande. « Tes demandes au support » (`#/support`) : la liste, la conversation, la réponse
  (Ctrl + Entrée envoie), « C'est réglé ».
- **Ce qui attend se voit partout** : la pastille de l'Aide compte les réponses à lire ; un bandeau en haut de chaque
  page nomme la demande et mène à « Lire la réponse ». Relu chaque minute tant que la page est visible ; la page des
  demandes se relit toutes les trente secondes et au retour sur l'onglet.
- **Une réponse se marque lue quand elle est à l'écran**, page visible — et une **seconde** réponse sur la même demande
  aussi : la lecture se note par demande ET par nombre de messages (vu le 13/10/2026 : notée une fois par demande, la
  pastille restait allumée sur une réponse ouverte à l'écran).

## Dans la console (C29)

- **La page Support** (`#/support`, la direction et le support ; la technique n'y lit rien) : à gauche la liste (les
  ouvertes, la plus urgente en haut ; les closes à un clic) et, sous elle, une carte « le client et la personne » ; à
  droite, large, la conversation, la réponse et « Envoyer ». **À l'ordinateur, l'écran tient dans la fenêtre** : la page
  ne défile pas, chaque colonne défile seule, et le dernier message, le champ et « Envoyer » restent à l'écran (vu le
  13/10/2026 : trois colonnes serraient la conversation, la réponse tombait sous le bas). Au téléphone, la liste d'abord ;
  choisir une demande amène sa conversation.
- **Le rang** (`ranger`) : les demandes **sans réponse depuis 24 heures** d'abord (la plus ancienne), puis celles qui
  attendent notre réponse, puis celles qui attendent le client (la plus récente), puis les closes. Une demande attend
  depuis le **dernier** mot du client, pas depuis son ouverture. L'accueil, la barre et la fiche comptent par la même
  fonction (`compter`).
- **Les réponses types sont les articles de l'Aide que le client a sous les yeux** (lus dans `web/public/v10/guide.js`) :
  celui de la page d'où il a écrit, puis ceux qui partagent des mots avec sa demande (sans les accents ni les petits
  mots) ; trois à l'écran. Un clic joint l'article et, sur une réponse vide, pose « Bonjour {prénom}, » avec le curseur
  sur la ligne vide ; tout autre article se joint en pied.
- **L'écran se relit toutes les trente secondes et au retour sur l'onglet** (`useRelireQuandOnRegarde`), avec la
  pastille de « À décider » — **sauf sous les doigts** : une fenêtre ouverte, ou une réponse en train de s'écrire.
- **Une réponse commencée est gardée par demande** : changer de demande ne la perd pas ; si la personne clôt la demande
  pendant qu'on écrit, l'écran le dit (« ta réponse commencée est gardée ») et « Rouvrir… » la rend.
- **Noter une demande reçue ailleurs** : depuis l'onglet « Ses demandes » de la fiche du client, au nom d'un membre
  actif de son entreprise, avec le canal (e-mail, WhatsApp, téléphone).
- **Le journal** garde chaque geste (`support.noter`, `support.repondre`, `support.clore`, `support.rouvrir`) avec le
  sujet ou le motif — **jamais le texte des messages**.

## L'accès au dossier (Support S2)

« Ma TVA de septembre ne tombe pas juste » ne se répond pas sans voir les chiffres. Le support les **demande** ; le client
**décide**.

- **Demander** (console : la direction et le support ; la technique et le commercial non) : depuis la conversation d'une
  demande (une bande sous son en-tête) ou depuis l'onglet « Ses demandes » de la fiche du client, avec un **motif** de
  3 à 300 caractères, que le client lit tel quel. Une seule demande en cours, ou un seul accès qui court, **par membre et
  par entreprise**. Celui qui a demandé (ou la direction) **retire sa demande** ou **rend l'accès** (« J'ai fini »).
- **Décider** (application : le **propriétaire** ou un **administrateur**, une personne, jamais une clé de l'API) : la
  demande s'affiche **en haut de chaque page**, avec qui demande et pourquoi, et trois boutons — **2, 24 ou 48 heures**
  (la base accepte de 1 à 48) — ou « Refuser ». Un accès qui court reste dit en haut de chaque page, avec l'heure de fin,
  « Voir ce qu'il a lu » et « Retirer ». Le panneau **« Le support de SkanFact »** (Paramètres › L'équipe) garde chaque
  accès, son motif, sa réponse, et **chaque page lue avec l'heure**.
- **Lire** : « Ouvrir le dossier (lecture) » (« Ouvrir en lecture » dans la bande d'une conversation) ouvre **la même
  application que le client**, dans un nouvel onglet, sur
  l'adresse de la console (`/v10/?e=…&support=…`) ; la session de la console passe à cet onglet, jamais dans l'adresse.
  Une bande ambrée en haut de chaque page dit à qui est ce dossier, jusqu'à quand, et que rien ne s'enregistre ; la page
  n'invite pas à sa visite guidée (elle n'est pas celle de qui la lit).
- **En lecture seulement, et ce que lit un membre « Lecture »** : le serveur filtre le dossier par ce rôle (jamais la
  paie) ; le pont refuse tout autre appel et toute écriture (« rien ne s'enregistre ici, et rien ne part chez le
  client ») ; le poste n'écrit rien (aucune copie locale, aucune base du navigateur) ; la messagerie et le support du
  client n'existent pas dans cet onglet. Personne chez SkanFact n'écrit dans les données d'un client (03 § 5).
- **Chaque page lue est notée** : son **nom** (« factures ») et l'instant — ni le contenu, ni un identifiant. Une page
  relue dans la minute ne se note pas deux fois. Ces lectures ne se modifient ni ne s'effacent (la base le refuse) :
  c'est la trace que l'entreprise relit.
- **L'accès se ferme tout seul à sa fin** (l'état se déduit de l'heure, personne n'a à le fermer) ; retiré par le client,
  il se ferme **tout de suite** : la lecture suivante est refusée, et l'onglet du support le dit et se vide. Échu, retiré,
  refusé ou rendu, la console le dit en une ligne (« Dernier accès au dossier retiré aujourd'hui, 14:05 par Lina ») et propose
  de redemander.
- **Le journal** : côté console `support.acces_demander` et `support.acces_clore` (avec le motif) ; côté entreprise
  `socle.support.autoriser` (accorder, refuser, retirer, avec l'état avant et après). Jamais le contenu d'une page lue.

## Ce que le support ne fait pas

Les pièces jointes ; une réponse en anglais (l'alerte part en français) ; la répartition des demandes entre membres de
l'équipe (le premier qui répond la suit) ; écrire dans le dossier d'un client, même avec son accord ; prévenir le client
par e-mail d'une demande d'accès (elle l'attend en haut de chaque page de son application).

## À VÉRIFIER

- Le délai de 24 heures avant « sans réponse » est une promesse au client : à confirmer avec Skander avant de l'écrire
  sur le site.
- Les durées proposées (2, 24, 48 heures) et le plafond de 48 heures (le cadrage dit « 48 heures ») : à confirmer.
- Le support lit ce que lit un membre « Lecture » (jamais la paie) : est-ce assez pour aider sur des chiffres, ou faut-il
  un jour que le client choisisse ce qu'il ouvre ?
- Une demande d'accès ne prévient pas le client par e-mail : s'il n'ouvre pas son application, la demande attend. À
  décider s'il faut une alerte (sans le motif, comme celle d'une réponse).
