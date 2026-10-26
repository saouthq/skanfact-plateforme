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

## Lot 2 : les composants de la charte (1.153.0)

La charte (`docs/maquettes/charte.html`, la même que la maquette en ligne) dit « une seule façon de faire ». Elle vit dans
`web/public/plateforme/charte.css`, chargée après `style.css` par les deux applications (l'entreprise et le Cabinet) : elle
change le dessin des composants, pas leurs gestes. Tests : `tests/web/charte.test.ts`, `tests/web/tons.test.ts` ; preuves
« charte 1 » à « charte 9 ».

| Ce qui se voit | Comment |
|---|---|
| Les statuts | Cinq couleurs, chacune un sens : bleu, la pièce est chez l'autre (émise, envoyée, à payer) ; vert, c'est fini et c'est bien (payée, accepté) ; ambre, un geste t'attend (payée en partie, expiré) ; rouge, ça coûte maintenant (en retard) ; gris, rien à faire (brouillon, annulée, refusé). En pilule de 12 px |
| Les boutons | Blancs à bordure fine au repos, 36 px, 13,5 px gras ; le principal, sarcelle, est le seul plein. `.av-geste` : la phrase sous le bouton principal |
| Le menu ⋯ | Le même partout (`rowmenu.js`) : un titre en haut qui nomme ce qu'on touche (`opts.titre` ; « DEV-2026-007 · Hôtel du Lac » sur les pièces), des groupes nommés en petites capitales, chaque geste avec sa phrase |
| Le toast | En bas, sombre (clair en thème sombre), une coche ou un signe d'alerte, une barre de temps ; 6 secondes au moins (le temps de lire, jusqu'à 8). « Annuler » seulement quand le geste se défait, 6 secondes (8 avant) |
| Les bandeaux | Ambre (un geste attend, par défaut), bleu (`info`, à savoir), rouge (`danger`, ça bloque), gris (`gris`, rien à faire). L'icône du ton à gauche ; le titre en gras dit le fait ; le texte part juste après l'icône, le premier bouton se range au bout |
| L'en-tête d'une page | Le titre à 26 px, gras, son statut à côté ; une phrase dessous (`.sous`) |

**Ce qui change de règle** : une pièce **annulée** (et un devis refusé) se dit en gris calme, comme un brouillon : elle était
rouge depuis la 1.146.0. La charte réserve le rouge à ce qui coûte maintenant (en retard, refusée par El Fatoora).

**Ce qui vient avec les lots suivants** (la charte le demande, l'écran qui le porte le fera) : le chemin « Accueil ›
Factures › FAC-… » et l'ordre des gestes de l'en-tête (↶, Aperçu, PDF, ⋯) avec la facture et le devis ; les groupes du
menu d'une pièce (Envoyer · Légal · Suite · La pièce · Corriger) et le bouton ⋯ des lignes avec la liste des factures ; la
phrase sous chaque bouton principal avec chaque pièce ; « Payée en partie » au lieu de « partiellement payée » avec la
liste (le libellé sert aussi aux exports).


## Lot 3 : la liste des factures (1.154.0)

`listeFactures` (`web/public/v10/app.js`) remplace, pour les factures, la liste commune aux devis (`listView`, que le devis
garde jusqu'à son lot) ; le style vit dans `web/public/plateforme/liste.css` ; le point de contact donne la tuile « À
signer » (`dessinerASigner`), les états El Fatoora en colonne (`poserEtat`, `data-forme="colonne"`) et ceux des pièces dues
(`etatsTtnDe`, une demande partagée avec la liste). Tests : `tests/web/liste-factures.test.ts`, `tests/web/ttn-liste.test.ts`,
`tests/web/telephone-commercant.test.ts` ; preuves « liste 1 » à « liste 16 ».

| Ce qui se voit | Comment |
|---|---|
| L'en-tête | « Accueil › Factures », le titre, « Ce qu'on te doit, ce qui est payé, ce qui part à El Fatoora » ; « Nouvel avoir » (pas pour un commercial) et « Nouvelle facture N F », le seul bouton plein |
| Les tuiles, des filtres | « À encaisser » sur toutes les années : la barre à échoir / bloqués par un refus d'El Fatoora / en retard, et ce qui est en devise compté au taux de la facture. « En retard » et l'âge des retards (1 à 30, 31 à 60, plus de 60 jours). « À signer pour El Fatoora » : le nombre, les numéros (la plus ancienne d'abord) et « Signer les N pièces… » (un refus du serveur le dit sans compter ; une entreprise non soumise n'a pas la tuile). « Brouillons » : le nombre, ce qu'ils valent, ceux « à redater » (mois clôturé, ou daté avant la dernière facture émise de son année). Une tuile choisie s'entoure ; recliquée, la liste revient |
| Les filtres | La recherche (« / ») lit le numéro, le client, l'objet, le montant (« 674,77 ») et le nom des pièces jointes, sans les accents ; Tout / Factures / Avoirs ; le statut avec son nombre ; l'année (choisie d'office au-delà de 25 pièces). Chaque filtre posé est une puce qui se retire, « Tout effacer » ; « N sur M pièces » à droite. Rien ne correspond : « Chercher dans toutes les années » et « Tout revoir » |
| Le tableau | Rangé par mois, brouillons d'abord (chaque mois dit combien de pièces et ce qu'elles valent, sur toute la sélection) ; trié par une colonne, il ne se range plus. Une case pour choisir ; le numéro, « Avoir », le trombone et son nombre ; la pastille du client et l'objet ; l'échéance (« dans 6 j », « 45 j de retard » en rouge, « payée le », « par AVO-… », « sur FAC-… ») ; le statut (« Payée en partie », « Payée en trop ») ; El Fatoora (une coche quand c'est accepté, des mots sinon) ; le net, et sa conversion pour une pièce en devise ; le reste, ou « … à son crédit ». Au survol, « Enregistrer un paiement » ; le menu ⋯ |
| Le menu ⋯ | Il nomme la pièce et son client, puis : Ouvrir, Enregistrer un paiement ; Envoyer (e-mail, WhatsApp, Relancer une facture en retard) ; Légal (Signer par DigiGo, un refus d'El Fatoora) ; La pièce (PDF, Dupliquer) ; Corriger (Créer un avoir). Un brouillon : Ouvrir, PDF, Supprimer le brouillon (la même question que l'éditeur) |
| Le pied | « Total de la sélection » : les pièces émises, leur HT, les brouillons à part ; le net et le reste ; puis les pages |
| Plusieurs pièces | La barre sombre en bas : combien, ce qui reste dû ; « Télécharger les PDF », « Relancer », « Signer », chacun avec le nombre de pièces qu'il touche ; « Ne plus rien choisir » (Échap) |
| Le clavier | « / » cherche, ↑ ↓ passent d'une pièce à l'autre, Entrée l'ouvre, X la choisit, Échap ne choisit plus rien ; N puis F, la barre |
| La première fois | « Réclamer l'argent du travail fait », ses deux boutons, et les étapes (écrire, émettre, signer, encaisser) |
| Au téléphone | La recherche, la synthèse « À encaisser », deux puces (À encaisser, En retard) et « Filtres » qui ouvre une feuille (type, statut, année, « Voir N pièces ») ; chaque pièce en carte ; « ‹ Accueil » ; la facture se crée par le « + » |

**Ce qui s'écarte de la maquette, et pourquoi** :
- « Relancer » sur plusieurs pièces mène à la page Relances : chaque relance y garde son niveau et son message ;
- à la tablette, le tableau défile dans son cadre (la colonne des gestes reste collée au bord) ;
- l'aperçu à droite d'une pièce (la maquette v3) viendra avec le lot de la facture, qui en fait le contenu.

## Lot 4 : la facture (1.155.0)

La page d'une facture et d'un avoir (`routes.doc`, `web/public/v10/app.js`, `charte = isInv || isAv`) ; le style vit dans
`web/public/plateforme/piece.css`. Les champs gardent leur nom et leur formulaire (`#f-head`, que `formValues` lit), les
gestes leur identifiant (`#issue`, `#save`, `#pay`, `#pdf`, `#more-btn`…) : les devis et les autres pièces gardent leur page
jusqu'à leur lot. Tests : `tests/web/facture-charte.test.ts`, `tests/web/telephone-commercant.test.ts` ; preuves « facture
1 » à « facture 11 ».

| Ce qui se voit | Comment |
|---|---|
| L'en-tête | « Accueil › Factures › FAC-… », le titre et son statut (« Brouillon · numéro à l'émission »), « ✓ enregistré » (qui se tait tant qu'une modification attend) ; Aperçu, PDF, et ⋯ qui porte tous les autres gestes, l'e-mail en tête |
| Le client | Une carte : sa pastille, son matricule, sa ville, son e-mail ; ce qu'il doit (ou ce qu'il a à son crédit), son délai de paiement constaté, sa dernière facture et « la refaire » ; « Changer » rouvre la liste, « Fiche » corrige sa fiche sur place |
| La pièce | Date, échéance et objet sur une rangée ; puis des puces : la langue, la devise, la retenue (« · du client » quand c'est celle de sa fiche), le timbre, le dépôt, « + Affaire », « + Référence », le taux d'une devise |
| Les lignes | Leur nombre ; le catalogue, les modèles, « + Ligne vide », « Calculer les prix… » ; sous la désignation, le dernier prix fait à ce client, le stock, la marge de la ligne ; ⋯ au bout de chaque ligne (monter, descendre, dupliquer, retirer) ; Entrée sur la dernière ligne en ajoute une ; au pied, la remise de toute la pièce |
| À droite | Les totaux : la TVA par taux et sur quelle base, le timbre, le total TTC, la retenue en rouge, le net à payer en grand (« le montant en lettres est écrit sur la facture »). Puis LE geste : « Émettre la facture » et sa phrase, « Garder le brouillon », « En grand » ; une facture émise et due : « Enregistrer un paiement ». « Avant d'émettre » : la fiche de l'entreprise, le matricule du client, la TVA des lignes. L'aperçu, tel que le client le recevra |
| La facture émise | Le bandeau court (« Émise : elle ne se modifie plus. ») et « Corriger par un avoir… » ; la frise Émise, Signée (« Signer »), El Fatoora (lue au serveur), Envoyée (« Envoyer »), Payée ; le résumé (client, date, net, situation, envois, comptabilité) ; les paiements en quatre cases (net à payer, avoirs, reçu, reste) |
| En dessous de 1 120 px | Une colonne : les totaux et le geste suivent les lignes ; une facture émise met son geste juste sous son résumé |
| Au téléphone | « ‹ Factures », la frise en colonne, et le geste dans une barre au bas de l'écran (au-dessus des onglets) avec le net à payer |

**Ce qui s'écarte de la maquette, et pourquoi** :
- le titre garde « Facture FAC-… » et « Facture (brouillon) » (la maquette : « FAC-… », « Nouvelle facture ») : d'autres
  écrans et la recherche le lisent ainsi ;
- la saisie hors taxes / toutes taxes et la remise par ligne ne sont pas dans l'application : elles viendront avec leur
  propre lot (le calcul, la pièce imprimée et le fichier TEIF en dépendent) ;
- « Annuler » (↶) en tête et le glisser-déposer des lignes : « Monter » et « Descendre » sont dans le ⋯ de la ligne ;
- la douchette ne tape pas encore dans la barre d'ajout.
