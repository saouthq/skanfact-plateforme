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
  1. **la coquille** (1.151.0, ci-dessous), puis **la barre du Cabinet** (lot 1 b, 1.152.0) ;
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

## Lot 1 b : la barre du Cabinet (1.152.0)

La même coquille que l'entreprise (`plateforme/barre.js`, généralisé : `__barreInfos` y dit `app: 'cabinet'`, sa page
d'arrivée et ses réglages), avec ce qui est au Cabinet seul : `drawNav` et les pages nouvelles dans
`web/public/v10/cabinet/app.js`, le style dans `plateforme/barre-cabinet.css`, la boîte des pièces reçues au serveur
(migration 0175, `GET /cabinets/:cabinet/pieces`, `POST …/messages/:message/classee`). Tests :
`tests/web/barre-cabinet.test.ts`, `tests/messagerie/messagerie.test.ts` (« les pièces reçues du cabinet ») ; preuves
« barre cabinet 1 » à « barre cabinet 14 ».

| Ce qui se voit | Comment |
|---|---|
| La tête : l'ardoise du cabinet et ses initiales, son nom, « Cabinet · N dossiers » ; la cloche | Le menu du cabinet : son code à donner aux clients (« Copier »), tous les dossiers, la production, l'équipe et les dossiers confiés, les modèles de messages, l'abonnement du cabinet, les réglages (l'équipe, l'abonnement et les réglages du cabinet : l'associé). La cloche : les priorités urgentes, les pièces reçues, les clients qui attendent une réponse, les échéances de la semaine |
| « Créer » (touche N) | Dans le dossier ouvert : Écriture (E ; « au brouillard » pour l'assistant de saisie), Importer un relevé (R), Demander une pièce (D, un dossier relié), Nouveau dossier (O, l'associé) |
| « Mon cabinet » | Priorités (la page d'arrivée), Pièces reçues, Échéances, Avancement (la production), Messages ; chacun son chiffre, le même que sa page. « Les miens / Tous » pour l'associé (les dossiers qu'on lui confie, ou tout le cabinet ; gardé sur l'appareil). On range en glissant. « Le cabinet » ouvre son volet à côté de la barre : tous les dossiers (le portefeuille), les relances, l'export des écritures, l'équipe, les modèles de messages, les réglages |
| Le dossier ouvert | Le dernier où l'on est entré (sinon celui qui attend le plus) : sa couleur sur le bord, relié ou tenu, son dernier mois écrit (validé, ou au brouillard). Ses entrées : Écritures (les mois à valider), Pièces du dossier (celles à classer), Banque, Déclarations (pas pour l'assistant de saisie), puis « Tout le dossier » (banque et lettrage, paie, les livres, révision, bilan et clôture, la fiche du client) |
| Changer de dossier | Un clic sur sa carte : chercher (Entrée ouvre le premier), les favoris en haut (l'étoile), puis les dossiers qui attendent d'abord, chacun avec Ctrl 1 à 9 (Alt + chiffre aussi). On garde l'écran où l'on est (la banque d'un dossier ouvre la banque de l'autre). Une écriture commencée et pas enregistrée : la question avant de partir (« Rester » ou « Passer à … ») ; elle attend dans son dossier |
| Priorités | « Bonjour », puis « Urgent » et « À voir » : ce que la liste « À faire » du Cabinet savait déjà (mois sans écriture, à valider, questions sans réponse, échéance proche, jour de relance, tes premiers pas), une ligne par dossier, et ce qui est neuf : les clients qui ont écrit, les pièces reçues à classer. Chaque ligne a son geste, qui mène là où l'on agit. Trois chiffres : dossiers à jour, pièces à classer, échéances des sept jours |
| Pièces reçues | Les photos et PDF que les clients envoient dans leur conversation, tous dossiers confondus (ou ceux d'un dossier : « Pièces du dossier »), avec ce que le client en dit (la pièce demandée à laquelle elle répond, l'achat où il l'a rangée, son mot). Voir, Saisir (la saisie du dossier), Classer (« Annuler » la remet) ; « Classées » dit qui et quand |
| À la tablette, au téléphone | Le rail a la marque du cabinet, « + », les pages de « Mon cabinet » et le dossier ouvert. Au téléphone : Priorités, Messages, « + », Échéances, Plus (« Le cabinet », « Tout le dossier », « Mon compte ») |

**Ce qui s'écarte de la maquette, et pourquoi** :
- les pièces reçues n'ont pas encore la proposition de compte « sûr à 92 % » : la lecture des pièces n'est branchée que
  côté entreprise (« Lire avec l'IA », derrière son interrupteur) ; ici, on voit la pièce et on la saisit ;
- « Banque » ne dit pas encore « 88 % rapprochée » : ce chiffre demande de lire le livre du dossier à chaque dessin de
  la barre ; il viendra avec la page Banque ;
- « Créer » ne se ferme pas en lecture seule au Cabinet : seuls les dossiers payants le sont, et le serveur refuse
  l'écriture d'un dossier fermé en disant pourquoi ;
- le carnet du dossier (« septembre clos ») dit le dernier mois écrit, validé ou au brouillard : la v10 ne clôt pas un
  mois, elle valide ses écritures ;
- dans un onglet du navigateur, Ctrl + chiffre peut rester au navigateur (ses onglets) : Alt + chiffre fait la même
  chose ; dans l'application installée, Ctrl + chiffre marche.
