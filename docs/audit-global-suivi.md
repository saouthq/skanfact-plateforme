# Le suivi de l'audit global du 4 novembre 2026

Le rapport lui-même : [`audit-global-2026-11-04.md`](audit-global-2026-11-04.md). Il a été fait par une relecture
extérieure (ChatGPT, transmis par Skander le 04/11/2026), sur le commit `95d67eb` de `dev` (paquet 1.266.14). Chaque
constat garde son identifiant. On ne recopie pas un constat sans le vérifier sur le code du jour : la colonne
« Vérifié » dit ce qu'on a constaté nous-mêmes, avant de corriger.

Pour chaque correction, on écrit d'abord une recette de comportement, qui reproduit le défaut. Puis on corrige dans les
vraies sources. Enfin, une **preuve** (`tests/preuves.sh`) remet le défaut en place et vérifie que la recette tombe.

| ID | Constat | Vérifié sur `dev` | Correction | Recette | État |
|---|---|---|---|---|---|
| G01 | Une facture émise renvoyée en « devis » passait le contrôle, puis s'effaçait | Oui, à la lecture : `verifierPiece` lisait le type **après** | 1.273.0 : la nature se juge sur la pièce émise d'avant ; une liste de pièces écrite à la racine du dossier est refusée (variante trouvée en relisant) | `tests/v10/dossier.test.ts`, « G01 : … » (devis, autre type, sans type, chaîne, liste ; brouillon libre) | Corrigé |
| G02 | Le salaire et les saisies lisibles par un commercial dans les versions écartées | Oui, à la lecture : `conflictArchive` suivait la règle technique | 1.273.0 : une version écartée se lit et s'écrit avec les droits de ce qu'elle copie (`kind`) ; la liste renvoyée garde ce que l'écrivain ne voyait pas ; l'empreinte des règles change, donc les copies des postes repartent en entier | `tests/v10/dossier.test.ts`, « G02 : … » | Corrigé |
| G03 | La facture de l'espace client recalculée sans remise de ligne ni FODEC | Oui : la recette tombait avant la correction | 1.273.0 : `fodecRate`, `prixTtc`, `export`, `seuilRetenue` et, par ligne, `discount`, `fodec`, `kind` | `tests/v10/espace-client.test.ts` : impression identique, et montants identiques au millime | Corrigé |
| G04 | Les bases de TVA après remise ne refont pas le HT | À vérifier | Lot B | | Ouvert |
| G05 | Un bulletin payé et validé reste modifiable | À vérifier | Lot B | | Ouvert |
| G06 | Deux bulletins ordinaires pour un salarié et un mois | À vérifier | Lot B | | Ouvert |
| G07 | La régularisation négative refusée au serveur | À vérifier | Lot B | | Ouvert |
| G08 | Le rappel trop élevé sur un mois proratisé avec absence | À vérifier | Lot B | | Ouvert |
| G09 | Le temps partiel ignoré dans le taux des heures supplémentaires | À vérifier ; la règle légale est **À VÉRIFIER** | Lot B | | Ouvert |
| G10 | Un congé à cheval sur deux années compté deux fois | À vérifier | Lot B | | Ouvert |
| G11 | La lecture IA garde une connexion à la base pendant l'appel | À vérifier | Lot C | | Ouvert |
| G12 | Pas de partage équitable des travaux lourds (PDF) entre utilisateurs | À vérifier | Lot C | | Ouvert |
| G13 | La reprise sur machine neuve ne rend pas la clé du coffre | À vérifier | Lot C | | Ouvert |
| G14 | La restauration à une date peut choisir une copie pas encore cohérente | À vérifier | Lot C | | Ouvert |
| G15 | L'installation se fait sous le serveur en marche | À vérifier | Lot C | | Ouvert |
| G16 | Des alertes de sécurité sur des dépendances | À vérifier | Lot D | | Ouvert |
| G17 | Trois chemins rompus dans `docs/carte.md` | Oui : trois chemins ne menaient à rien | 1.273.0 : les trois chemins remis | `tests/socle/consignes.test.ts`, « chaque fichier que les consignes et la carte citent existe » | Corrigé |
| G18 | Une cible tactile de tri de 41 px dans la console | À vérifier | Lot D | | Ouvert |
| G19 | La première ouverture au-dessus de 1 300 Ko | Oui : 1 397 Ko le 04/11 | 1.273.0 : L9, l'aide et les visites à la demande (`docs/leger.md`) | `tests/web/leger.test.ts` (S1 1 243 Ko) et `tests/web/visites-une-fois.test.ts`, « L9 : … » | Corrigé |
| G20 | Une recette cassée par la majuscule de « Facturé » | Oui | 1.272.0 | `tests/web/recette-alpha.test.ts` | Corrigé |

## Les données déjà là

La plateforme ne porte pas encore de données réelles (les pilotes n'ont pas commencé). Les corrections ne réécrivent donc
aucune donnée. Elles valent aussi pour ce qui est déjà en base :

- **G02** : le filtre s'applique à la lecture, et les versions écartées d'avant sont filtrées comme les neuves.
- **G01** : on ne trouve une facture déjà effacée de cette façon qu'en comparant les pièces émises du serveur
  (`ventes.piece`) au dossier. La requête de lecture seule qui les liste attend la première base réelle ; elle ne corrige rien
  d'elle-même.
