# L'inventaire des écrans qui restent à changer (02/11/2026, après la paie)

Demande de Skander (02/11/2026) : « on va finir déjà la paie, après on fait l'inventaire de ce qu'il nous reste à changer
comme écran ». La paie (entreprise et Cabinet) est finie jusqu'à la 1.247.0, sauf **le rappel de salaire** (une
augmentation qui compte depuis un mois passé), qui attend la décision de Skander.

Trois états :

- **Fait** : l'écran est tel que sa maquette (`docs/maquettes-appliquees.md`).
- **Maquette, écarts** : une maquette existe, appliquée en partie ; il reste des écarts listés.
- **Sans maquette** : l'écran vient de la v10, dans la charte (barre, boutons, bandeaux), mais personne ne l'a dessiné.
  Règle : on dessine d'abord, Skander valide, puis on applique.

## L'ordre de Skander (03/11/2026)

« On va finir d'abord les écrans déjà commencés », la liste des devis en premier, puis, dans la nouvelle DA et sans maquette
à part : les marges, la trésorerie, la commande fournisseur, la fiche fournisseur (le retour d'une facture ouverte depuis la
fiche ramène aux Achats), le stock, les immobilisations, la facturation récurrente, les proformas, bons et contrats (encore la
page de l'ancienne DA), les listes de prix, le catalogue, les relances.

## L'application de l'entreprise

| Écran | État | Ce qui reste |
|---|---|---|
| La barre (coquille), la charte | Fait | — |
| L'accueil | Fait | — |
| Les factures (liste, facture, avoir) | Fait | — |
| Le devis | Maquette, écarts | la liste est faite (1.260.0, comme celle des factures, sans tuiles) ; reste la fin du lot 5 sur la pièce |
| Les achats (liste, achat, lecture IA) | Maquette, écarts | les états et fenêtres de l'achat (lots 6c, 6d) |
| Les fournisseurs (liste, fiche) | Fait | — |
| Les clients (liste, fiche) | Fait | — |
| La paie | Fait | le rappel de salaire (décision) |
| Mon comptable, facture électronique reçue | Fait (`complements.html`) | — |
| **La caisse** (vente au comptoir, tickets, clôture) | Sans maquette | tout l'écran |
| **Le stock, le catalogue, la fiche d'un article** | Sans maquette | tout |
| **Les commandes fournisseurs, la réception** | Sans maquette | tout |
| **Les contrats, les affaires** | Sans maquette | tout |
| **La trésorerie** | Sans maquette | tout |
| **Les relances** | Sans maquette | tout |
| Le module Marges (affaires, fiche, où est la marge, contrats, seuil, fenêtres) | Fait (1.261.0 et 1.262.0, sans maquette à part) ; la marge juste en 1.263.0 (stock, lignes réparties, heures, prévu et réel, mois par mois, export) ; l'interface en 1.264.0 (frise du chantier, graphe des mois, grille de la semaine) | — |
| **Les statistiques** | Sans maquette | tout (les grands chiffres retirés des listes y vont, Skander 30/10) |
| **Les listes de prix, les garanties** | Sans maquette | tout |
| **Les immobilisations** (entreprise) | Sans maquette | tout |
| **La comptabilité de l'entreprise** (`#/compta`) | Sans maquette | tout |
| **Les paramètres** (entreprise, équipe, modules) | Sans maquette | tout |
| L'abonnement (Ton abonnement) | Revu (`revue-abonnement.md`) | pas de maquette dessinée |
| L'aide, le guide, le support | Sans maquette | tout |
| Le groupe d'entreprises, les accords | Sans maquette | tout |

## Le Cabinet

| Écran | État | Ce qui reste |
|---|---|---|
| La barre du Cabinet | Fait | — |
| Pièces reçues | Maquette, écarts | la revue état par état (tâche en cours) |
| Échéances | Maquette, écarts | la revue état par état (tâche en cours) |
| Dossiers du cabinet | Fait | la revue métier (à faire) |
| La fiche d'un dossier | Fait | la revue métier ; les lettres de mission (à faire) |
| Tout le dossier (le classeur) | Maquette, écarts | « Classeur 2 » : en-tête, arbre, lignes, colonne de droite, fenêtres |
| Messages | Fait | — |
| Tableau de bord | Fait | — |
| Compta › Saisie | Fait | le timbre et la FODEC lus sur la pièce ; la lecture des pièces (décision) |
| Compta › Banque | Fait | le relevé en PDF (décision : la lecture) ; le taux de change (décision) |
| Compta › Paie | Fait | le rappel de salaire (décision) |
| **Compta › Consulter** : livre-journal, balance, grand livre, lettrage, recherche | Maquette (`comptabilite.html`), pas appliquée | tout : ces écrans sont ceux de la v10 |
| **Compta › Déclarer et clôturer** : la déclaration du mois et « déposée », la révision du mois, la liasse, l'exercice | Maquette, pas appliquée | tout |
| **Compta › Immobilisations, Inventaire** | Maquette, pas appliquée | tout |
| **Priorités** | Sans maquette validée | Skander ne l'a pas validée |
| **Les réglages du cabinet** | Sans maquette validée | Skander ne l'a pas validée (revue contre cab7 à faire) |

## La console de l'éditeur

Tous ses écrans ont leur maquette et sont appliqués (Clients, fiche, Abonnements, Paiements, Nos factures, Réglages,
Support, le service en huit vues, Équipe, Journal). Reste la recette complète à la souris et au clavier.

## L'ordre proposé

1. **Le Cabinet, la comptabilité** : Consulter (5 écrans), puis Déclarer et clôturer (4), puis Immobilisations et
   Inventaire. La maquette existe ; c'est le cœur du métier du cabinet.
2. **Les écarts qui restent sur des écrans déjà commencés** : le devis, l'achat, le classeur, Pièces reçues, Échéances.
3. **L'entreprise, sans maquette** : la caisse d'abord (les commerces au lancement), puis le stock et le catalogue, la
   trésorerie et les relances, les statistiques ; chacun dessiné puis validé par Skander avant d'être appliqué.
4. **Les paramètres**, l'aide, le groupe.

Décisions qui attendent Skander : le rappel de salaire ; la lecture des pièces au Cabinet ; le taux de change ; Priorités
et les réglages du cabinet ; l'ordre ci-dessus.
