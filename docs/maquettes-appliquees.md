# Les maquettes appliquées à l'application

*Commencé le 26/10/2026. Skander : « On va commencer à appliquer sur notre app les maquettes qu'on a faites, on
commence par quoi tu recommandes, c'est quoi ton plan » ; puis « 1 : à toi de décider [la police] ; 2 : notre vrai
projet c'est sur skanfact-plateforme, c'est là qu'il faut l'appliquer ».*

## Les maquettes

Elles sont dans `docs/maquettes/` (pages autonomes, données inventées ; chacune porte, en bas, son tableau « Rien de
perdu » — ce que fait l'écran de la v10 et où il le retrouve — et « Ce que dit la recherche ») :

| Fichier | L'écran |
|---|---|
| `barre-v3.html` | La coquille : la barre de gauche et la barre du bas au téléphone, dans tous leurs états |
| `charte.html` | La charte : couleurs, tons (calme, attire, alerte), statuts, boutons, menus, bandeaux, la méthode |
| `liste.html` | La liste des factures |
| `facture.html` | La facture (brouillon, émise, payée, avoir, El Fatoora) |
| `devis.html` | Le devis |
| `achat.html` | L'achat, avec la lecture par l'IA (facultative, décision du 24/10/2026) |
| `accueil.html` | L'accueil |

## Comment on les applique

- **Dans ce dépôt, en modifiant directement le code des écrans** (`web/public/v10`, décidé le 26/10/2026 : la copie de la
  v10 ne se reprend plus, `web/v10/LISEZMOI.md`). Ce qui s'ajoute autour (une barre, un menu, une feuille de style) vit dans
  `web/public/plateforme/`. On ne réécrit pas les écrans en React : ils perdraient tout ce que la v10 sait faire (le
  hors-ligne, les visites, les droits, les cas limites), et les maquettes disent elles-mêmes, ligne à ligne, ce qui ne doit
  pas se perdre.
- **Le résultat de la maquette EN LIGNE** (l'artefact, pas une copie plus ancienne), à l'unité près : Skander, le
  26/10/2026, « je veux le même résultat que sur la maquette ». D'où **Inter**, la police des maquettes, servie par le
  serveur (`web/public/plateforme/polices/`, licence OFL), et les mesures et couleurs de la maquette recopiées telles
  quelles. Ce qui n'existe pas dans l'application pour la maquette se développe.
- **Par lots**, chacun vérifié à la souris, en clair, en sombre, au téléphone et à la tablette, avec ses tests et leurs
  preuves :
  0. ranger les maquettes ici (fait le 26/10/2026) ;
  1. **la coquille** (1.151.0, ci-dessous), puis la barre du Cabinet (lot 1 b) ;
  2. les composants de la charte (statuts, bouton principal et sa phrase, menu « ⋯ » unique, toast de 6 s avec
     « Annuler », bandeaux, en-tête, « Brouillon ») ;
  3. la liste des factures ;
  4. la facture ;
  5. le devis ;
  6. l'achat (6 b : la lecture par l'IA, derrière un interrupteur éteint tant que l'autorisation de l'INPDP et la clé
     de l'API ne sont pas là) ;
  7. l'accueil, en dernier (Skander, 26/10/2026).

## Lot 1 : la coquille de l'entreprise (1.151.0)

`drawNav` (`web/public/v10/app.js`) dessine la liste ; `web/public/plateforme/barre.js` et `barre.css` font le reste ;
le poste (`poste.js`) dit son état à la puce « Hors ligne » ; le point de contact donne le profil (`profil`, `pont.js`).
Test : `tests/web/barre.test.ts` ; preuves « barre 1 » à « barre 25 ».

| Ce qui se voit | Comment |
|---|---|
| La tête : les initiales de l'entreprise, son nom, son métier ; la cloche | Les initiales se calculent du nom (« Boulangerie El Amal » → BE). Le clic ouvre « Tes entreprises » (la sienne cochée, les autres, « Ajouter une entreprise », « Réglages de cette entreprise »). La cloche réunit ce qui attend : les questions et demandes du cabinet, la réponse du support, l'abonnement, les factures et achats en retard, ce qui attend le réseau, la mise à jour ; « lu » se garde sur l'appareil |
| « Hors ligne · N en attente » | L'état du poste (`SkanPoste.etat`, l'événement `skanposte`) |
| « Créer » (touche N) | Les pièces du MÉTIER que le rôle peut faire : commerce (vente, facture, photo d'un achat, article), restauration (ticket, photo, dépense, pointage), bâtiment (devis, facture, photo, client), services (facture, devis, dépense, client), santé (encaissement, facture, dépense, client). Une lettre choisit. Jamais dans un champ, ni à la caisse. Le caissier a « Vente au comptoir » (touche V), qui ouvre la caisse ; le rôle « Lecture » une puce « Lecture · rien ne se change ». En lecture seule (l'abonnement) : un cadenas, et le menu dit pourquoi et « Régler ma facture » |
| La recherche (Ctrl K) | La palette de la v10 |
| « Au quotidien » | L'accueil, puis les pages du métier (la boulangerie : caisse, factures, achats, stock ; le menuisier : devis, factures, achats, clients…), celles qu'on épingle, et « Mon comptable » (ou « Inviter mon comptable »). Un chiffre seul dit ce qui attend : ambre à voir, rouge en retard, un point vert pour la caisse ouverte ; la phrase se lit au survol. « Ranger » : on glisse les entrées ; l'ordre et les épingles se gardent sur l'appareil, par rôle et métier |
| « Tout le reste » | Une ligne par famille (Vendre, Acheter, Piloter) avec le compte de ce qui y attend ; son volet s'ouvre À CÔTÉ de la barre, posé sur la page. Chaque page y a sa phrase et son épingle ; une page épinglée n'y est qu'un bouton qui y mène. « Ajouter un module » au bout (la propriétaire) |
| Le pied | « Mise à jour prête · Recharger » (la page servie a changé), l'abonnement (son état et ce qu'il faut faire, calme, ambre ou rouge ; seulement pour qui le règle, sauf la lecture seule), « Changer de caissier » (le code à 4 chiffres de la brique 123, sur le poste de la caisse), la personne (son menu : profil et sécurité, équipe, abonnement, raccourcis, « Découvrir la barre », se déconnecter, la version), Paramètres, Me guider, Aide |
| La barre repliée | Touche [ ou le bouton rond ; 68 px, les dessins seuls, un point pour ce qui attend, une bulle au survol (posée sur la page). Se garde sur l'appareil |
| Les raccourcis | N, Ctrl K, G puis A (accueil), G puis F (factures), [, Échap, ? (leur liste) ; jamais dans un champ, par-dessus une fenêtre, ni à la caisse |
| La visite de la barre | Trois étapes (Créer et la recherche, « Au quotidien », « Tout le reste »), dans les cartes de visite de la v10 ; elle part de « Découvrir la barre », dans le menu de la personne |
| À la tablette (761 à 1100 px) | Un rail de 84 px : l'entreprise, « + », l'accueil, cinq pages du jour avec leur compte, « Plus » (qui ouvre la barre entière par-dessus), la cloche et la personne |
| Au téléphone | Le haut : l'entreprise et la cloche (avec son nombre), puis les pastilles (hors ligne, abonnement, mise à jour). Les onglets du bas : l'accueil, deux pages du métier, « + » (la feuille « Créer », « Photo d'une pièce » d'abord), « Plus » (la recherche, les pages récentes, chaque famille en liste, « Mon compte », Paramètres, Me guider, Aide, la version). « Mes onglets » choisit les deux pages à côté du « + ». Les onglets se cachent à la caisse ; la page garde sa place au-dessus d'eux |

**Ce qui s'écarte de la maquette, et pourquoi** :
- la visite de la barre ne part pas seule au premier lancement : l'assistant de démarrage et les visites de la v10 y ont
  déjà la parole ; elle part de « Découvrir la barre » ;
- la cloche ne dit pas « il y a 1 h » : rien ne date aujourd'hui ces nouvelles ; elle dit où chacune mène ;
- au téléphone, la cloche et les pastilles se touchent sur 44 points (la règle des cibles au doigt), leur dessin garde
  la mesure de la maquette.

## Lot 1 b : la barre du Cabinet

À venir, dans le même lot : la barre à deux niveaux de la maquette (« Mon cabinet », le dossier ouvert), les pages qui
manquent (Priorités, Pièces reçues, Avancement), le changement de dossier (favoris, Ctrl 1 à 9, la saisie gardée).
