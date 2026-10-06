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

## À décider avec Skander

- **Le prix TTC sur un devis ou une facture.** Deux claviers à 35 DT TTC font 70,000 DT à la caisse (le prix
  d'étiquette fait foi depuis le lot caisse 3) et 70,001 DT sur un devis ou une facture (calculés hors taxes d'abord) :
  deux chiffres pour la même vente. Proposer « prix TTC » sur une pièce à un particulier ? À VÉRIFIER avec un comptable.
- **Inviter son équipe.** Le serveur sait inviter un collaborateur dans l'entreprise ; aucun écran ne le propose encore
  (un commerçant ne peut pas donner un accès à son vendeur).
- **Télécharger toutes ses données.** Rien côté entreprise ne le propose (« jamais de données en otage »).

## À VÉRIFIER

- « Déclaration CNSS trimestrielle le 15/10 » s'affiche alors que le seul salarié est entré le 06/10 (rien à déclarer
  pour juillet-septembre ?).
- Le bulletin d'octobre au prorata de l'embauche du 6 (846,154 brut, 720,317 net).

## Pour les lots suivants

Gênants : l'aide de « Raison sociale » et du matricule (où le trouver), le code du téléphone sans « plus tard »,
« Relier ton comptable » qui parle encore du paquet de la v10, la visite qui saute le régime fiscal, le curseur absent
des cases éclairées par les visites, « Catalogue / Prestations » pour un commerçant qui vend des produits, le prix TTC
absent de la visite d'un article, la visite qui se met en pause quand on ouvre la liste demandée, le coût du stock de
départ à 0, les visites trop longues (devis : 24 étapes), le bandeau d'une facture émise qui déborde, une dépense sans
fournisseur, l'avoir qui ne reprend pas les lignes de la facture. Petits : le point dans « 0.000 », « Encaissé » TTC
face au « Facturé HT », la fiche salarié au net, le compte d'où part un salaire, l'avertissement DigiGo après le geste,
et le reste du journal.
