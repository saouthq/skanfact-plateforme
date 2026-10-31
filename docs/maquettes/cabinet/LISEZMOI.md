# Les maquettes de « Mon cabinet » (validées le 28/10/2026)

Les sept écrans du Cabinet que la plateforme doit reproduire **exactement** : mêmes textes, mêmes boutons, même mise en
page, mêmes états (pour la direction, la tenue et la saisie ; au bureau et au téléphone). Les chiffres de l'exemple
(le cabinet Jlassi Conseil, ses 12 dossiers, le mercredi 28 octobre 2026) cèdent la place aux vrais.

| Fichier | Écran |
|---|---|
| `pieces-recues.html` | Pièces reçues |
| `echeances.html` | Échéances |
| `dossiers.html` | Dossiers du cabinet |
| `fiche-du-dossier.html` | La fiche d'un dossier |
| `classeur.html` | Tout le dossier : le classeur du client (une rubrique à la fois) |
| `messages.html` | Messages |
| `tableau-de-bord.html` | Tableau de bord |

Hors de cette liste tant que Skander ne les a pas validées : **Priorités** et **Réglages du cabinet**.

**Proposée le 31/10/2026, à valider par Skander** : `comptabilite.html`, la comptabilité d'un dossier (les quatorze
écrans de Saisir, Consulter, Déclarer et clôturer, sur Boulangerie El Amal). Elle se reconstruit depuis le socle de
`classeur.html` ; tant qu'elle n'est pas validée, rien ne s'en applique dans la plateforme. Revue le 31/10/2026 après
la remarque de Skander (« la saisie n'est pas pratique ») : deux façons de saisir, « Face à la pièce » (la pièce en grand,
une fiche pré-remplie dont chaque champ dit d'où il vient) et « Au kilomètre » (le journal au clavier, la charge et la
TVA proposées) ; la banque confirme et écrit en masse d'après des règles visibles ; ce que font les concurrents est
résumé dans la page, avec ses sources.

## L'ordre de construction (Skander, 28/10/2026)

0. Ces maquettes rangées ici, et les décisions écrites au journal du cadrage.
1. Le socle commun : la barre de gauche (pastilles, « Les miens / Tous », le dossier ouvert, épingler et ranger),
   le guide (« Guide-moi », visite, fin honnête), les états (chargement, refus, sans réseau, lecture seule), le téléphone.
2. Pièces reçues · 3. Échéances · 4. Dossiers du cabinet · 5. Fiche du dossier · 6. Classeur · 7. Messages ·
   8. Tableau de bord (il additionne les autres, il vient en dernier).

Pour chaque écran : la liste des écarts (maquette et plateforme côte à côte, chaque état, chaque personne, bureau et
téléphone), le serveur d'abord s'il manque une donnée, l'écran, les tests et les preuves, l'essai à la souris avec
une planche avant / maquette / après, puis un envoi sur `dev`. Ce que la plateforme ne sait pas encore faire n'est
jamais montré comme fait : l'écart est signalé à Skander, qui décide (le construire, ou ne pas le montrer encore).

**Règle des écrans vides (Skander, 31/10/2026)** : un écran vide montre la page qu'il deviendra, grisée derrière, et devant
le geste qui la remplit (« Importer le relevé… », « Demander les pièces à Sarra »). Exemples dans `comptabilite.html` : la
banque sans relevé, la saisie sans pièce. Elle vaut pour toutes les maquettes qui viennent.
