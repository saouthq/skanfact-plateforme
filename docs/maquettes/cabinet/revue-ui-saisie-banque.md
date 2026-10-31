# Revue UI/UX de la Saisie, de la barre de la comptabilité et de la Banque (31/10/2026, 1.214.0)

Demande de Skander : « fais une revue UI/UX de la Saisie, la barre, la Banque, etc. ; quand on aura fini, on passera à la
paie ». Faite après les lots S7 à S9, à l'écran (captures lues) à 1 440, 1 280, 1 024 et 390 pixels, avec Leïla (direction)
et Rim (saisie), sur la boulangerie de l'exemple. À lire avec `ecarts-saisie.md` (la maquette, point par point) et
`revue-saisie-banque.md` (le métier).

Légende : ✅ corrigé dans 1.214.0 · ⚪ gardé exprès (la raison) · ◐ à reprendre plus tard.

## Ce qui se voyait et ce qui est fait

| # | Où | Ce qui n'allait pas | État |
|---|---|---|---|
| U1 | Saisie, portable de 1 024 px | La pièce et sa fiche s'empilaient sous 1 100 px : la fiche partait sous la pièce, à 900 px du haut ; « Face à la pièce » perdait son sens | ✅ côte à côte jusqu'à 900 px |
| U2 | Frise des mois, sous 1 240 px | « en retard » devenait « en ret… » : l'état d'un mois, la seule chose à lire, coupé | ✅ l'état se lit entier (sur deux lignes au besoin) |
| U3 | Frise au téléphone | Les douze mois prenaient trois rangées (≈ 170 px) avant le contenu, ouverts sur janvier | ✅ une rangée qui défile au doigt, ouverte sur le mois choisi, en retard ou à déposer |
| U4 | En-tête de la page | « 2 mois à valider » se coupait en « 2 » / « mois à valider » à 1 024 px | ✅ ne se coupe plus |
| U5 | Bande des pièces | Six pièces ou plus repoussaient « Face à la pièce · Au kilomètre » sur une seconde ligne | ✅ la bande défile, le choix du mode reste à droite |
| U6 | Banque › Les règles | Le champ des taux de retenue prenait toute la largeur de la page pour « 1,5 » | ✅ un champ court, le bouton à côté |
| U7 | Saisie, « Au kilomètre » | La grille restait visible sous la fiche après un geste (corrigé en 1.211.0) | ✅ |
| U8 | Saisie, ligne en cours du journal | « Le fournisseur manque » s'affichait avant toute frappe (1.213.0) | ✅ |
| U9 | Les deux navigations (la barre de gauche du dossier et les onglets de la page) | Disent la même chose deux fois | ⚪ la maquette les garde toutes les deux : la barre suit le dossier d'un écran à l'autre, les onglets restent sous les yeux |
| U10 | Fil d'Ariane de la Banque | « Comptabilité › Saisir » sur la page Banque | ⚪ c'est le groupe (la maquette) ; le titre dit l'écran |
| U11 | Brouillard | Chaque ligne en italique, un bouton « Actions ⌄ » par ligne (la maquette : ⋯) | ◐ le bouton est le menu commun à toutes les listes du Cabinet : le changer, c'est changer toutes les listes ; à décider avec les autres listes |
| U12 | Banque, filtres | « 0 En attente de Sarra » montré même à zéro | ⚪ dit qu'il n'y a rien en attente du client : un chiffre, pas un bruit |
| U13 | Banque, liste à 1 280 px | Les libellés de la banque passent sur deux ou trois lignes (la colonne de droite prend 390 px) | ◐ lisible ; à revoir si les comptables s'en plaignent |

## Ce qui va bien (à garder)

- Un seul bouton principal par fiche, et il dit l'étape suivante (« Joindre à FA-0919 », « Demander à Sarra de la dater du
  29/08 », « Enregistrer et valider ») ; la ligne des touches nomme la pièce suivante.
- Chaque chiffre proposé dit d'où il vient (lu sur la pièce, comme ses pièces d'avant, numéro suivant).
- La Banque : la ligne choisie et « Le livre en face », le bilan du relevé au millime en bas, les règles qui proposent sans
  écrire.
- La collaboratrice en saisie voit qui fait ce qu'elle ne fait pas, au lieu de boutons qui refusent.

## Les essais

`tests/web/cabinet-saisie-piece.test.ts` : un parcours à 1 024 px (la pièce face à sa fiche, aucun état coupé, la bande sur
une ligne, rien qui déborde) et, au téléphone, la frise sur une rangée qui s'ouvre d'elle-même sur le bon mois. Preuves
« saisie 35 » à « saisie 39 ».
