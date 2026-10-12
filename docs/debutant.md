# Le parcours d'un commerçant qui débute (06/10/2026)

Un commerçant fictif, « Amine », crée sa toute première entreprise sur app.skanfact.tn, sans rien connaître à la
facturation ni à la comptabilité : un Chrome qui garde son profil, souris et clavier réels, 191 captures. Compte,
code du téléphone, fiche, visites guidées, client, catalogue et stock, devis, facture, paiement, caisse, lecture d'une
facture d'achat en photo, inventaire, dépense, comptabilité et calendrier fiscal, paie, Paramètres, cabinet, avoir et
remboursement, signature. Constats : 8 bloquants, 26 gênants, 26 petits.

## Le lot débutant (1) : ce qui est corrigé

| Constat | Correction | Où |
|---|---|---|
| Chrome posait le mot de passe de SkanFact dans « Mot de passe El Fatoora » et « Clé de l'API Konnect » (il ignore `autocomplete="off"` sur un mot de passe) : le débutant l'aurait envoyé à « Brancher » | `autocomplete="new-password"` sur les deux | `web/public/plateforme/pont.js` |
| Paramètres, recherche « sauvegarde » : « 4 réglages sur 28 » et une page vide (les panneaux de l'ordinateur, absents ici, étaient comptés) | la recherche n'indexe pas les panneaux absents ; la case donne en exemple « timbre, logo » | `web/v10/debutant.txt` (reglages.js, app.js) |
| Après « Enregistrer », le bandeau « Il manque… » gardait l'état d'avant (seul F5 le remettait à jour) | le bandeau se redessine à l'enregistrement | idem |
| La visite de la fiche finissait sur « Ta fiche est à jour » avec un matricule incomplet et un RIB à la clé fausse | la fin exige un matricule complet (1234567A/A/M/000) et un RIB juste, et le dit | idem (visites.js) |
| Une ligne lue en photo qui porte le nom d'un article suivi partait en « Charge » : le stock ne bougeait pas | elle part au stock, rattachée à l'article | idem (app.js) |
| Mouvements de stock : à date égale, « Stock après » se lisait 10, 18, 16, 20, 15 | à date égale, l'ordre où ils ont eu lieu | idem (core.js) |
| Calendrier fiscal : « Préparer » la TVA du 28/10 ouvrait octobre (l'échéance déclare septembre) | il ouvre le mois déclaré | idem (app.js) |
| Une dépense se saisissait en hors taxes : la facture STEG de 85,400 DT payés devenait 101,626 DT à payer et 16,226 DT de TVA inventée | une case « Montant payé (TTC) » : le hors taxes s'en déduit au millime, suit le taux choisi, et s'efface si on tape le hors taxes à la main | idem (app.js) |
| Un avoir émis sur une facture payée disait « à rendre » sans bouton pour rembourser | « Rembourser … au client… » sur l'avoir | idem (app.js) |
| « Email » marquait la pièce « envoyée » même quand aucune messagerie ne s'ouvrait (Gmail dans le navigateur) | « Le message est-il parti ? » : copier l'adresse, copier l'objet et le message ; l'envoi ne se note que sur « Je l'ai envoyé » | idem (app.js) |
| Écran du code : le curseur n'était pas dans la case ; rien ne parlait du téléphone perdu | le curseur y est ; la phrase des codes de secours est sous la case | `web/src/ecrans/Code.tsx`, `web/src/composants/Champ.tsx` |

Tests : `tests/web/debutant.test.ts` (quatre parcours à la souris), et les tests d'El Fatoora, de Konnect, du code,
des envois et de la lecture en photo, retournés vers la règle. Quinze preuves (`tests/preuves.sh`, « Le lot débutant
(1) ») : chacune remet son défaut et fait tomber son test.

## Le lot débutant (2) : ce qui est corrigé (12/10/2026)

Les gênants refaits à la souris sur une entreprise neuve (« Quincaillerie Gharbi SARL », au réel), en local, puis
revérifiés à la souris une fois corrigés. Les écrans de la v10 changent par `web/v10/debutant-2.txt`.

| Constat | Correction | Où |
|---|---|---|
| « Démarrer » faisait poser l'adresse du comptable dans Paramètres → Envois et importer son « fichier d'appairage » ; l'article du comptable décrivait le paquet du mois — rien de tout ça n'existe en ligne | « Confier ton dossier à ton comptable » : Comptabilité → Cabinet, le code de son cabinet, « Confier mon dossier » ; l'article est réécrit (il lit tes livres en direct, il valide tes mois, ses questions, « Mon comptable ») | `guide.js` |
| La visite « Compléter ma fiche société » sautait le régime fiscal, qui décide si les factures portent de la TVA | une étape « Ton régime fiscal », juste après l'adresse | `visites.js` |
| Une étape à lire posée sur une case (« Remplis la case éclairée si tu as l'information ») ne mettait pas le curseur dedans : la frappe partait nulle part | le curseur va dans la case de texte éclairée | `visite.js` |
| Une quincaillerie lisait « Prestations », « + Nouvelle prestation », « 3 prestations » sur ce qu'elle vend | le mot suit le métier : « article » pour le commerce, la restauration et l'artisanat, dans le catalogue, ses menus, ses recherches et les numéros de série (pas encore dans l'import d'un tableur) | `app.js` (`motsCatalogue`) |
| La visite d'un article ne parlait que du prix hors taxe ; un commerçant connaît le prix de l'étiquette | l'étape du prix éclaire aussi « Prix TTC » et le dit : le hors taxe se calcule tout seul | `visites.js` |
| Choisir dans la liste qu'une étape éclaire (l'unité, la TVA) rangeait la bulle dans un coin (« Vas-y, essaie ») : la visite paraissait se mettre en pause au moment où l'on faisait ce qu'elle demandait | un clic dans la case éclairée, dans celles qu'elle éclaire à côté, ou dans la liste qu'elle ouvre, est le geste de l'étape | `visite.js` (`dansSaCase`) |
| Le coût unitaire du stock de départ restait à 0 : dix marteaux entraient au stock pour 0 DT | il suit le coût de revient tant qu'on n'y a pas touché | `app.js` |
| « Faire un devis » comptait 24 étapes, « Faire une facture » 25 | les cases déjà remplies de l'en-tête se lisent ensemble, chacune avec sa bulle ; l'objet, la retenue et le timbre gardent leur étape ; l'unité se lit avec la TVA de la ligne (16 et 17 étapes au plus : celles qui ne concernent pas la pièce — le taux d'une autre devise, les pièces jointes en ligne — se sautent) | `visites.js` |
| Le bandeau d'une facture émise sortait de l'écran : la phrase entière collée à sa bulle « i » sur une ligne | seul ce qui touche la bulle reste collé ; la phrase passe à la ligne | `style.css` |
| Une dépense sans fournisseur (un ticket, un reçu) était refusée | elle se range sous une fiche unique « Dépenses diverses », créée au premier enregistrement ; la liste le dit (« — Aucun : dépenses diverses — ») ; une facture d'achat demande toujours son fournisseur | `app.js` (`fournisseurDivers`) |
| Un avoir neuf qui choisit sa facture n'en reprenait ni les lignes ni l'objet : on retapait ce qu'on annulait | il les reprend, comme « Créer un avoir… » sur la facture — sauf si une ligne est déjà tapée | `app.js` |
| « Ton entreprise » : la phrase du matricule passait de trois lignes à une au dernier caractère, et le bouton remontait de 39 px sous la souris | ses quatre phrases sont empilées, invisibles, dans la même case : la plus longue en donne la hauteur | `web/src/composants/Fiche.tsx` |

Déjà réglés avant ce lot : l'aide de la raison sociale et du matricule (où le trouver, lot entrée) ; le code du
téléphone, devenu facultatif. Vu en revérifiant : fusionner les notes et les pièces jointes d'un devis en une étape
faisait parler la bulle des pièces jointes, absentes en ligne ; les deux étapes sont restées séparées (celle des pièces
jointes se saute d'elle-même), et un test veut désormais que ce qu'une étape éclaire à côté de sa cible existe en ligne.

Tests : `tests/web/debutant-2.test.ts` (quatre parcours à la souris), `tests/v10/visites-en-ligne.test.ts` (quatre de
plus), `tests/v10/aide-en-ligne.test.ts`, et `tests/web/entree.test.ts` (le bouton sous le matricule). Dix-sept preuves
(`tests/preuves.sh`, « Le lot débutant (2) ») : chacune remet son défaut et fait tomber son test.

## À décider avec Skander

- **Le prix TTC sur un devis ou une facture.** Deux claviers à 35 DT TTC font 70,000 DT à la caisse (le prix
  d'étiquette fait foi depuis le lot caisse 3) et 70,001 DT sur un devis ou une facture (calculés hors taxes d'abord) :
  deux chiffres pour la même vente. Même chose sur une fiche du catalogue : 4,500 DT tapés en TTC donnent 3,782 DT hors
  taxe, et 4,501 DT sur la pièce. Proposer « prix TTC » sur une pièce à un particulier ? À VÉRIFIER avec un comptable.
- Inviter son équipe et télécharger toutes ses données : faits (lot équipe, 12/10/2026 ; `docs/equipe.md`,
  `docs/export-complet.md`).

## À VÉRIFIER

- « Déclaration CNSS trimestrielle le 15/10 » s'affiche alors que le seul salarié est entré le 06/10 (rien à déclarer
  pour juillet-septembre ?).
- Le bulletin d'octobre au prorata de l'embauche du 6 (846,154 brut, 720,317 net).

## Pour les lots suivants

Les gênants sont faits (lot débutant 2). Restent les petits : le point dans « 0.000 », « Encaissé » TTC face au
« Facturé HT », la fiche salarié au net, le compte d'où part un salaire, l'avertissement DigiGo après le geste, et le
reste du journal. Vus en revérifiant le lot 2 :

- « Le code de ton cabinet » (Comptabilité → Cabinet) n'a pas de bulle « i ».
- L'import d'un catalogue depuis un tableur dit encore « nouvelles prestations », « prestation existante » à un
  commerçant : ses phrases sont accordées au féminin, à reprendre avec le mot du métier (`IMPORTS.catalogue`).
- Dans « Me guider », « Envoyer un devis ou une facture » dit « il te faut d'abord un devis à envoyer » à une entreprise
  qui a déjà une facture émise.
- Les articles de l'Aide propres à l'application de bureau (deux postes, partager un dossier, la licence…) n'ont pas de
  moyen d'être cachés en ligne côté entreprise ; le Cabinet en a un (`articlesAbsents`).
- Page Stock, au téléphone : une carte `.stat` est en `overflow: hidden`, donc sa colonne ignore la largeur de son
  montant, et « 2 500,000 DT » dépasse de la carte quand la police est un peu plus large (vu sur la machine de
  développement, où `tests/web/rendu.test.ts` le signale déjà avant ce lot ; vert sur GitHub).
