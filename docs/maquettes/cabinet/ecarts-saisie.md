# La Saisie du Cabinet contre sa maquette : les écarts (31/10/2026)

Relevé écran par écran, à 1 440 pixels, la maquette `comptabilite.html` (ses dix états « Saisie… », « Au kilomètre »,
« Le brouillard », « Valider le brouillard ») ouverte à côté de l'application (1.210.0), sur la boulangerie de l'exemple.
Demande de Skander : « fais une revue pour les écarts ». Le texte de chaque état de la maquette a été relu mot à mot contre
celui de l'application.

Légende : ✅ comme la maquette · ◐ en partie · ❌ manque · ⚪ écart voulu (la raison est dite).

## A. La bande et la pièce (commun à « Face à la pièce »)

| # | Maquette | Application (1.210.0) | État |
|---|---|---|---|
| A1 | « Pièce 1 sur 6 », ‹ ›, une pastille par pièce du mois (icône photo ou PDF, nom court, couleur de ce qu'elle demande), l'active en sarcelle | pareil | ✅ |
| A2 | Les six pièces de septembre, **la photo illisible comprise** (IMG_8790, en rouge) et celle en double (IMG_8841, grisée) | la pièce en double y est ; la pièce **illisible n'y est pas** (elle attend la nouvelle photo du client) | ◐ |
| A3 | « Face à la pièce » / « Au kilomètre » à droite de la bande | pareil | ✅ |
| A4 | En-tête de la pièce : « envoyée par Sarra **hier** à 18 h 12 · « La facture STEG d'août, je l'avais oubliée » » | « envoyée par Sarra le 30/10 » ou « aujourd'hui à 21 h 16 » : jamais « hier » | ◐ |
| A5 | −, 100 %, +, Tourner (photo), En grand | pareil | ✅ |
| A6 | Ce que SkanFact a lu, **surligné sur la pièce** ; « un clic sur un champ de droite montre où il l'a lu » | rien de surligné | ⚪ la lecture ne rend pas où elle a lu (pas de positions) ; à reprendre si la lecture les rend un jour |
| A7 | Sous le titre de la fiche : « reçue hier · lue en 3 secondes » | « lue par SkanFact le 31/10 : chaque champ lu se vérifie sur la pièce » | ◐ (la durée de lecture n'est pas gardée) |
| A8 | Une pièce que SkanFact n'a pas encore lue : (la maquette suppose toujours une pièce lue) | la fiche part des habitudes du fournisseur ; **aucun bouton « Lire la pièce »** alors que le classeur l'a (avec l'accord du client) | ❌ |

## B. Une pièce à saisir (le ticket de carburant, vu par Rim et par Leïla)

| # | Maquette | Application | État |
|---|---|---|---|
| B1 | Fournisseur : « **Total Ennasr 401TO** » (son compte à côté du nom) | le nom seul ; le compte (401 ou celui de ses écritures d'avant) n'apparaît que dans l'écriture | ◐ |
| B2 | D'où vient chaque champ : « lu sur la pièce », « lu », « comme ses 4 tickets », « = numéro suivant » | pareil (« lu sur la pièce », « lu », « comme ses N factures / tickets », « numéro suivant · AC », « date d'arrivée : mets celle de la pièce ») | ✅ |
| B3 | TVA « Sans TVA récupérable, comme ses 4 tickets » et l'aide : « Le gasoil d'un véhicule de livraison : TVA récupérable ou non selon le régime du client, À VÉRIFIER. **Une fois changé ici, les prochains tickets suivent.** » | « un ticket n'est pas une facture : À VÉRIFIER » ; la phrase « les prochains suivent » n'est pas dite (c'est pourtant vrai : les habitudes viennent des écritures) | ◐ |
| B4 | Compte « 6066 Carburants · véhicule de livraison » | « 6066 » et son nom au plan | ✅ |
| B5 | Pièce « **TK-0924** · journal AC » : les tickets ont leur série | « FA-0920 » : le numéro qui suit le dernier du journal, ticket ou facture | ◐ |
| B6 | « Payée par carte le 24/09 » : le règlement s'écrit et se rapproche du même geste | pareil, vérifié à la souris (AC + BQ, la ligne du relevé rapprochée) | ✅ |
| B7 | L'écriture qui s'écrit, « Ouvrir en lignes » | pareil | ✅ |
| B8 | Les gestes selon qui saisit : **Rim** (saisie) « Enregistrer au brouillard ↵ · Anis valide le brouillard » ; **Leïla** (direction) « **Enregistrer et valider ↵** · Au brouillard » | « Enregistrer au brouillard ↵ » pour tous, « Autre chose… » ; **pas de « Enregistrer et valider »**, pas de « Anis valide » | ❌ |
| B9 | Les touches : « ↵ enregistre et ouvre la pièce suivante **(Minoterie du Cap Bon)** » | la pièce suivante n'est pas nommée | ◐ |
| B10 | — | « Autre chose… » (rien à saisir, déjà saisie, en double) : un geste de plus que la maquette | ✅ (en plus) |

## C. La pièce déjà au livre (la photo STEG)

| # | Maquette | Application | État |
|---|---|---|---|
| C1 | « Elle est déjà au livre : FA-0919, sans justificatif », la comparaison « La photo dit / FA-0919 dit » coche par coche, « Joindre à FA-0919 ↵ », « Ce n'est pas la même : la saisir » | pareil ; « Peut-être déjà au livre » et « déjà saisie ? » quand le seul indice est le nom du fichier | ✅ |
| C2 | La ligne TVA comparée (29,765 / 29,765 · 4366) | « à lire sur la pièce » : la lecture ne rend pas la TVA | ⚪ (la lecture du Cabinet rend fournisseur, numéro, date, total, devise) |
| C3 | Après le geste : « ✓ La photo est jointe à FA-0919 · **29,765 DT de TVA récupérable** · **5 pièces attendent** · Annuler » | « La pièce est jointe à FA-0919 : l'achat a son justificatif. · Annuler » | ◐ |

## D. La pièce que le client a saisie lui-même (la Minoterie, à vérifier)

| # | Maquette | Application | État |
|---|---|---|---|
| D1 | « Sarra l'a saisie elle-même », puis les contrôles : fournisseur et compte, la charge comme ses 11 factures d'avant, la TVA lue = la TVA écrite, le numéro saisi une fois, « Payée le 08/09, rapprochée · net de sa retenue » | pareil, plus « le total lu = le total écrit » ; « payée, pas encore rapprochée » quand la ligne du relevé attend | ✅ |
| D2 | « Le certificat de retenue à remettre … **Le préparer** » | la ligne seule (quand l'écriture porte une retenue), **sans « Le préparer »** | ❌ (le certificat ne se prépare pas encore au Cabinet) |
| D3 | Les gestes : « Marquer vérifiée ↵ », « **Corriger…** », « Demander à Sarra » | « Marquer vérifiée ↵ », « Demander à Sarra » ; **pas de « Corriger… »** | ❌ (l'achat du client suit sa pièce : corriger, c'est le lui demander, ou contre-passer au cabinet une écriture validée) |
| D4 | La confiance chiffrée : « **11 pièces de Sarra vérifiées sans correction depuis janvier.** Ses achats de la Minoterie : ne plus me les faire vérifier » | « Les factures de Minoterie du Cap Bon passent toujours ? Ne plus me faire vérifier … » (sans le compte) | ◐ |
| D5 | Les touches : « ↵ marque vérifiée et ouvre la pièce suivante (Hygiène Plus) · C corriger · Alt+→ la passe » | pas de ligne de touches sur cette fiche | ◐ |
| D6 | — | « de confiance » et « Marquer vérifiées les N de confiance » : en plus | ✅ (en plus) |

## E. La pièce au mauvais mois (Hygiène Plus)

| # | Maquette | Application | État |
|---|---|---|---|
| E1 | « La facture est du 02/09, l'écriture du 31/08 », la TVA d'une facture se déduit le mois de sa date (À VÉRIFIER) | pareil | ✅ |
| E2 | Les deux mois : TVA déductible avant → après **et TVA à payer avant → après** | la TVA déductible seulement | ◐ |
| E3 | Le mois de la pièce : « écriture FA-0902 · 02/09 · **se dépose aujourd'hui** » | « l'écriture FA-0914 · 29/08 », sans la date de dépôt | ◐ |
| E4 | « Déplacer en septembre ↵ » / « Laisser en août » | un achat du client : « Demander à Sarra de la dater du 29/08 ↵ » / « La date est la bonne : vérifiée » ; une écriture du cabinet : « Déplacer au 29/08 » | ⚪ (la base refuse de changer l'écriture d'un achat du client : elle suit sa pièce ; le cabinet n'écrit pas chez le client sans lui) |
| E5 | Les touches : « ↵ déplace et ouvre la pièce suivante · la déclaration d'août se met à jour toute seule » | pas de ligne de touches | ◐ |

## F. La facture en euros (Matfer)

| # | Maquette | Application | État |
|---|---|---|---|
| F1 | Montant « 2 350,00 EUR », taux, « Au livre, en dinars 7 945,820 DT », l'écriture sans TVA | pareil, la contre-valeur en entiers | ✅ |
| F2 | « Taux du 20/09 · **BCT** (À VÉRIFIER) » | « Taux du 20/09 (À VÉRIFIER) », tapé (le dernier retenu proposé) | ⚪ (d'où vient le taux : décision de Skander en attente) |
| F3 | « Au paiement, l'écart de change **s'écrit seul** » | « … s'écrit à part » | ⚪ (il ne s'écrit pas encore seul : la phrase serait fausse) |
| F4 | Libellé de l'écriture : « Moules Matfer · 2 350,00 € à 3,3812 » | « Matfer Bourgeat · FR-26-118842 · **2350,00** EUR à 3,3812 » (le montant pas mis en forme) | ◐ |
| F5 | « Enregistrer et valider ↵ / Au brouillard » | comme B8 | ❌ |

## G. Au kilomètre

| # | Maquette | Application | État |
|---|---|---|---|
| G1 | **Le journal du mois** : les achats de septembre, une pièce par ligne (jour, pièce, compte du fournisseur, libellé, TTC), sa charge et sa TVA dessous en gris, la ligne en cours, « 5 pièces · débit = crédit ✓ », l'icône du justificatif de chaque ligne (ou l'alerte « sans justificatif ») | la grille d'**une** écriture à la fois (journal, date, pièce, libellé, lignes), le brouillard plus bas | ❌ |
| G2 | « AC · Achats ⌄ », « Septembre 2026 ⌄ » et la phrase « Le compte du fournisseur et le TTC suffisent : la charge et la TVA se proposent d'après ses pièces d'avant, la pièce se solde seule » | le journal se choisit dans la grille ; **rien ne se propose d'après les pièces d'avant** quand on tape le 401 et le TTC | ❌ |
| G3 | Le compte se cherche par son nom (« tot » trouve 401TO) | pareil (numéro ou nom) | ✅ |
| G4 | Les touches : Tab, ↵ pièce suivante, F2, F4, ↑ ↓, Ctrl+↵, « les pièces se rangent par date » | Tab, Entrée ligne suivante, F2, F4, Ctrl+Entrée (réglables) | ◐ |
| G5 | À droite, « La pièce de la ligne où tu es » ; « FA-0919 n'a pas de justificatif : la photo STEG l'attend dans « Face à la pièce » » | « La pièce à côté », « La saisir dans la grille », la même phrase pour les achats qui attendent leur pièce | ✅ |
| G6 | — | le même numéro dans le même journal, dit pendant la frappe (S4) | ✅ (en plus) |

## H. Le brouillard (sous la fiche)

| # | Maquette | Application | État |
|---|---|---|---|
| H1 | « Le brouillard **de septembre** · 3 écritures », la liste **du mois** | « Le brouillard · 23 écritures, dont 13 de septembre », la liste de **tout l'exercice** | ◐ |
| H2 | « Écritures qui reviennent 2 », « **Guides 4** », « Valider les 3 de septembre » | « Écritures qui reviennent », « Valider les 13 de septembre » ; pas de « Guides » (le guide se choisit dans la grille) | ◐ |
| H3 | Colonnes DATE · JOURNAL · PIÈCE · LIBELLÉ · **PAR** (qui l'a saisie) · MONTANT · ⋯ | DATE · JOURNAL · PIÈCE · LIBELLÉ · TOTAL · ÉTAT · « Actions ⌄ » ; pas de « Par », un bouton « Actions » plutôt que ⋯ | ◐ |
| H4 | Sous une ligne : « **au compte d'attente : Sarra n'a pas encore dit ce que c'est** » | rien | ❌ |
| H5 | — | une rangée de plus : « Valider les 8 pièces d'AC », « … de BQ », …, « … d'août 2026 » | ◐ (en plus ; la maquette n'en garde qu'un) |
| H6 | Rim (saisie) : « Anis les valide » à la place du bouton | le bouton pour tous ; le serveur refuse si le droit manque | ❌ |

## I. Valider le brouillard (la fenêtre)

| # | Maquette | Application | État |
|---|---|---|---|
| I1 | « Valider les 3 écritures de septembre ? » et **la liste** (pièce, libellé, montant) | « Valider 13 écritures de septembre 2026 ? », sans la liste | ◐ |
| I2 | Un encadré par cas à part : « BQ-0914-03 est au compte d'attente · validée, elle y reste jusqu'à la réponse de Sarra » | l'encadré du justificatif manquant (FA-0919) ; rien pour le compte d'attente | ◐ |
| I3 | « Toutes sont équilibrées ; aucune ne tombe sur un mois déposé » (vérifié avant) ; « **Valider les 3 écritures** » | « Celles qui ne tombent pas juste ne seront pas validées, et te seront nommées » ; « Valider » | ◐ |

## J. Un mois sans pièce (octobre)

| # | Maquette | Application | État |
|---|---|---|---|
| J1 | « Octobre : aucune pièce à saisir pour l'instant », la phrase, « Demander les pièces d'octobre à Sarra » | pareil | ✅ |
| J2 | « Une écriture à la main », « Au kilomètre », l'aperçu grisé derrière | la grille visible dessous | ⚪ (une écriture à la main reste à un clic de moins) |
| J3 | Le pied : « **Septembre : 6 pièces saisies** · 3 écritures attendent au brouillard » ; « Ses ventes et sa caisse arrivent seules au livre » | « N écritures attendent au brouillard » ; ni le bilan du mois d'avant, ni la phrase des ventes | ◐ |

## K. Au téléphone

| # | Maquette | Application | État |
|---|---|---|---|
| K1 | La bande sans pastilles, la pièce (300 px) puis la fiche, les touches cachées | pareil ; boutons de 44 px | ✅ |

## Le bilan

**Mise à jour du 31/10/2026 (1.211.0) : le lot S7 est fait.** A2, A4, A8, B1, B3, B5, B8, B9, C3, D3, D4, D5, E2, E3, E5,
F4, F5 et H6 passent à ✅ (B5 : la série des tickets quand le dossier en a une ; D3 : « Corriger… » demande la correction au
client, son achat suivant sa pièce ; D4 : « déjà vérifiées », sans prétendre « sans correction »). Le détail :
`docs/cabinet.md` (« La Saisie : la fiche finie »). Restent S8, S9 et les écarts voulus.

- **Comme la maquette** : 16 lignes ; **en plus** : 4 (Autre chose…, de confiance, le même numéro, payée pas encore rapprochée).
- **Écarts voulus** (8) : le surlignage de la lecture (A6), la TVA lue (C2), la demande au client au lieu de déplacer son
  achat (E4), la source du taux et l'écart de change (F2, F3), la grille visible sous un mois vide (J2).
- **À faire** — proposition, dans l'ordre de ce qui sert le plus au comptable :
  1. **Lot S7 « la fiche finie »** (rien de neuf au serveur, sauf le droit de valider lu pour les gestes) : « Enregistrer et
     valider » selon le droit de la personne et « Anis valide le brouillard » (B8, F5, H6) ; « Lire la pièce » quand elle
     n'est pas lue (A8) ; le compte du fournisseur à côté de son nom (B1) ; « Corriger… » (D3) ; la confiance chiffrée (D4) ;
     le message après « Joindre » (C3) ; la TVA à payer et la date de dépôt des deux mois (E2, E3) ; les lignes de touches
     qui nomment la pièce suivante (B9, D5, E5) ; « hier » (A4) ; la série des tickets (B5) ; le libellé en euros (F4) ;
     l'aide « les prochains suivent » (B3) ; la pièce illisible dans la bande, avec « Relancer » (A2).
  2. **Lot S8 « le brouillard du mois »** : la liste du mois choisi (H1), « Par » et ⋯ (H3), le compte d'attente dit (H4),
     « Guides » (H2), les lots repliés dans ⋯ (H5), la fenêtre de validation qui liste les écritures et ses cas (I1 à I3),
     le bilan du mois d'avant sous un mois vide (J3).
  3. **Lot S9 « Au kilomètre, le journal du mois »** (le plus gros) : une ligne par pièce, la charge et la TVA proposées
     d'après les pièces d'avant du fournisseur, la pièce qui se solde seule, le justificatif de chaque ligne (G1, G2, G4).
  4. Plus tard, avec une décision ou un outil : le certificat de retenue au Cabinet (D2), le surlignage de la lecture (A6).
