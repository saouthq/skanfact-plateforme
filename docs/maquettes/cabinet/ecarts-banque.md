# La Banque du Cabinet contre sa maquette : les écarts (31/10/2026)

Relevé écran par écran, à 1 440 pixels, la maquette `comptabilite.html` (ses quatorze états « Banque… ») ouverte à côté de
l'application (1.206.0, lot B1). Demande de Skander : « finir la maquette de banque avant de tout tester ». Chaque ligne
se coche quand l'écran de l'application la montre comme la maquette, photo à l'appui.

## A. Autour de la Banque : la page de la comptabilité (commun aux quatorze écrans)

| # | Maquette | Application aujourd'hui | Fait |
|---|---|---|---|
| A1 | En-tête de la page : « Dossier ouvert · Boulangerie El Amal · Comptabilité › Saisir », la pastille BE, le titre **Banque** et sa bulle, la ligne d'état (août en retard · septembre à déposer · 3 écritures au brouillard · tenue par Anis), les gestes « Guide-moi », « Exercice 2026 ⌄ », « + Une écriture », « ⋯ » | L'en-tête de la fiche du dossier (« ← Dossiers », matricule, « Modifier la fiche », « Actions »), les onglets Suivi / Comptabilité, puis la ligne « Période · Le livre de 2026 · Reprendre les soldes… · N écritures validées · Compter N écritures en brouillard » | ✅ 1.207.0 (fil, pastille, titre de l'écran, ligne d'état, Exercice, « + Une écriture », ⋯ qui reprend la fiche, le suivi, les paquets, la relance et les gestes du relevé) |
| A2 | Une carte : le segment « Saisir 14 · Consulter · Déclarer 6 », puis les pilules « Saisie 6 · Banque 8 · Paie · Immobilisations · Inventaire » (bordées, l'active en sarcelle) | Le segment, puis des onglets soulignés | ✅ 1.207.0 (la carte, le segment, les pilules ; « Déclarer et clôturer » garde son nom entier) |
| A3 | La frise des douze mois de l'exercice (déposé, en retard, à déposer, en cours, à venir) et « Toute l'année » | absente | ✅ 1.207.0 (frise lue comme la fiche du dossier ; un mois ouvre ce mois et son relevé ; « Toute l'année ») |
| A4 | La barre de gauche, dossier ouvert : Fiche du dossier, Le classeur, Pièces du dossier, Messages, puis **COMPTABILITÉ** (épingler, actualiser, replier) avec le même segment et la liste Saisie / Banque / Paie / Immobilisations / Inventaire, et Tout le dossier | Écritures, Pièces du dossier, Banque, Déclarations, Tout le dossier | ✅ 1.207.0 (Fiche du dossier, Le classeur, Pièces du dossier, Messages, « Comptabilité · Banque » avec ses trois groupes et ses écrans comptés) — sans les trois modes de la barre (toujours ouverte, la maquette les laisse au choix) |

## B. La carte de la Banque

| # | Maquette | Application aujourd'hui | Fait |
|---|---|---|---|
| B1 | Libellés de la banque en `ui-monospace` 12,5 px, espacement 0,5 px, majuscules | une autre chasse fixe (IBM Plex Mono), plus grasse : **la police** | ✅ 1.207.0 |
| B2 | Le tableau sans cadre autour, l'en-tête DATE / LA BANQUE / MONTANT sur le fond de la carte | un cadre arrondi autour du tableau | ✅ 1.207.0 |
| B3 | Montants « − 1 818,507 » / « + 2 380,400 » (une espace après le signe) | « −1 818,507 » | ✅ 1.207.0 |
| B4 | Sous-ligne : la pièce en gras, puis le tiers (« FA-0919 · STEG · même montant · « STEG » ») | le code du journal devant (« BQ BQ-0922 · … ») | ✅ 1.207.0 |
| B5 | En-tête de la carte : « importé ce matin (Excel de la BIAT) · 43 mouvements », deux boutons (Les règles · 6, Importer un relevé…) | « importé le 31/10/2026 · 9 mouvements · du … au … » et un troisième bouton « Ce relevé ⌄ » | ✅ 1.207.0 (« Ce relevé » passe dans le ⋯ de la page) |
| B6 | Pastille « En attente de Sarra » (le contact du client) | « En attente du client » | ✅ 1.207.0 (le prénom du contact, sinon « du client ») |
| B7 | Le livre en face : des **cases à cocher** (une ou plusieurs pièces), « La ligne … · **cochées** … · ✓ écart 0 », puis **l'écriture qui sera passée** (COMPTE / LIBELLÉ / DÉBIT / CRÉDIT), et « Rapprocher **et lettrer** » quand une facture se lettre | un bouton radio (une seule), « en face … », pas d'écriture montrée pour une pièce trouvée, « Rapprocher » | ✅ 1.208.0 (les factures non réglées en face, à cocher ; la somme ; l'écriture qui sera passée ; « Rapprocher et lettrer (les N) » quand elles sont validées, « Écrire et rapprocher » au brouillard sinon) |
| B8 | La pièce en face dit d'où elle vient : « STEG · électricité et gaz · même montant · « STEG » · la seule non réglée » | « Versement espèces · même montant · même jour » | ✅ 1.208.0 (« FA-0919 · STEG · même montant · « STEG » · la seule non réglée », comme la maquette) |
| B9 | Menu ⋯ d'une ligne : icône, deux lignes (le geste, ce qu'il fait), lettre du clavier : Écrire autre chose… (E), Choisir une autre pièce en face (P), Partager entre plusieurs pièces, Mettre au compte d'attente 471 (A), Demander à Sarra ce que c'est (D), Retenir une règle d'après cette ligne (R), Défaire le rapprochement (grisé, avec sa raison) | quatre lignes simples, sans icône, ni explication, ni lettre | ✅ 1.207.0 (icônes, deux lignes, lettres E P A D R qui marchent au clavier, « Défaire » grisé qui dit pourquoi ; « Partager entre plusieurs pièces » marche depuis la 1.208.0 : toutes les factures non réglées en face) |
| B10 | Après Entrée : un bandeau sombre **dans la carte** (« ✓ PRLV STEG rapproché. FA-0919 est payée chez Sarra, lettrée au 401ST ; la ligne suivante est choisie. Annuler ») | le message au bas de l'écran | ✅ 1.207.0 (dans la carte, avec « Annuler ») |
| B11 | Les rapprochées ouvertes : « avec FV-2026-0379 · Café Jasmin » et l'origine en étiquette (encaissée par Sarra dans SkanFact, règle « PRLV SONEDE », la paie d'août, versement de la caisse), « … et 29 autres · Tout septembre · Défaire tous les rapprochements du mois » | origine « d'office / à la main » seulement (lot B6) | ✅ 1.208.0 (« Défaire » au survol, « Défaire tous… » en pied ; ce que la rapprochée paie ou porte, lu dans son écriture : « la paie d'août », « versement de la caisse », « encaissement de FV-… », « règle « FRAIS » », puis qui l'a posée) |
| B12 | La remise de chèques : trois factures cochées, l'écriture ventilée 532 / 411CJ / 411DJ / 411EN, « Rapprocher et lettrer les 3 » | absente (lot B2) | ✅ 1.208.0 (une remise se propose quand UNE seule combinaison de 2 à 4 factures tombe juste ; l'écriture ventilée, une ligne par facture ; « Rapprocher et lettrer les 3 ») |
| B13 | Une ligne au net de sa retenue (« net de sa retenue 27,693 », « certificat à demander ») | absente (lot B2) | ✅ 1.208.0 (au millime, à un taux réglé dans « Les règles de la banque » ; la retenue au 4358 subie ou 4352 opérée, comptes et assiette À VÉRIFIER ; « certificat à demander / à remettre ») |

## C. Les écrans de la Banque

| # | Maquette | Application aujourd'hui | Fait |
|---|---|---|---|
| C1 | Relevé absent : le squelette grisé, la carte « Le relevé de septembre n'est pas encore là », Importer le relevé… / Le demander à Sarra, « Le relevé en PDF : bientôt (À VÉRIFIER) » | à revoir à côté (même idée) | ✅ 1.206.0 |
| C2 | Importer : **une page**, pas une fenêtre : le fichier reconnu, les colonnes reconnues, « Avant d'importer » (la période, le solde de début, chaque ligne refait le solde, aucun doublon, ce qui va se passer), « Importer les 46 lignes » | une fenêtre (lot B4 pour les contrôles) | ⏳ lot B4 (reste une fenêtre) |
| C3 | Import refusé : « Ce relevé est celui de novembre : celui d'octobre manque », les trois cases (dernier importé / manquant / ce fichier), « Importer d'abord celui d'octobre… », « Le demander à Sarra », « Garder ce fichier pour après » | absent (lot B4) | ⏳ lot B4 |
| C4 | Banque nouvelle : nommer chaque colonne une fois, « Retenir ce modèle et continuer » | absent (lot B4) | ⏳ lot B4 |
| C5 | Les règles : **une page** avec le tableau (libellé, sens, compte, TVA, a servi N fois / la dernière le …) et « Nouvelle règle » (libellé, sens, montant, compte, TVA, journal ; « aurait servi à 14 lignes depuis janvier ») | une fenêtre avec les mots retenus (lot B5 pour les règles fines) | ⏳ fenêtre (lot B5) ; aussi dans le ⋯ de la page |
| C6 | L'état de rapprochement : **une page** avec la feuille (côté banque, côté livre, PROVISOIRE en filigrane), « Retour au relevé », « Joindre au dossier de révision », « Télécharger le PDF » | une fenêtre (« Joindre » : lot B3) | ⏳ fenêtre ; « Joindre » : lot B3 |
| C7 | Écart non expliqué : la pastille rouge « 12,000 d'écart non expliqué » en haut, le pied rouge, les pistes avec leurs boutons (« Ouvrir OD-0931 », « Chercher 12,000 ») | pistes en texte, sans bouton par piste | ◐ « L'ouvrir » et « Chercher » par piste ; le pied rouge |
| C8 | Septembre rapproché : la carte « Septembre est rapproché à la BIAT » au milieu, L'état de rapprochement (PDF) / Importer le relevé d'octobre / Revoir septembre, et le pied | un bandeau en haut de la liste | ✅ 1.207.0 (la carte au milieu, PDF, importer le suivant, « Revoir ») |
| C9 | Écrire d'après une règle : « Rien dans le livre pour cette ligne. Sa règle « FRAIS TENUE » propose l'écriture ; elle sert aussi aux AGIOS du relevé », l'écriture, « Écrire et rapprocher » | proche ; la phrase et la TVA à part (« À VÉRIFIER ») à reprendre | ✅ 1.207.0 (la règle, et les autres lignes qu'elle sert) |

## D. Ce qui n'est pas dans un lot fait

B11 (lot B6), B12 et B13 (B2), C2 à C5 (B4, B5), le « Joindre » de C6 (B3) demandent du serveur : ils restent dans leur lot,
mais leur **écran** se pose maintenant comme la maquette, le geste qui manque dit « bientôt » et ne fait rien en silence.

## E. Le 31/10 au soir (1.207.0)

La carte, la coquille de la page et cinq écrans sont comme la maquette, photos à l'appui (l'application à 1 440 pixels, à côté de la maquette). Restent, dans leur lot : plusieurs pièces cochées, la remise ventilée et le net de retenue (B2), « Joindre au dossier de révision » (B3), l'import en page avec ses contrôles (B4), les règles fines en page (B5), les origines des rapprochées (B6).

## F. Le 31/10, plus tard (1.208.0)

Le lot B2 est fait : une ligne du relevé paie des factures encore ouvertes (B7, B8, B12, B13 cochés). Les origines des
rapprochées aussi (B11, lot B6). Restent, dans leur lot : « Joindre au dossier de révision » (B3), l'import en page avec
ses contrôles (B4), les règles fines en page (B5), l'état et les pistes en page (C6, C7).
