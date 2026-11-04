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
| G04 | Les bases de TVA après remise ne refont pas le HT | Oui : 5 100 de bases pour 5 050 de HT net, 1 000 de TVA au lieu de 960 | 1.275.0 : une **règle de calcul gardée avec la pièce** (`calcul`, colonne 0191, scellée à l'émission). Règle 2, pour toute pièce neuve : la remise répartie exactement par les cumuls (`repartir`, aucun reliquat), la TVA d'un taux sur sa base entière ; au comptoir, le TTC remisé aussi. Règle 1 (la v10) pour les pièces d'avant, qui se relisent au millime où elles ont été émises, et pour la facture d'une commande en ligne (la commande fait foi). Les deux moteurs (écran et serveur) tombent au millime. La règle d'arrondi de la TVA reste **À VÉRIFIER** avec un comptable | `tests/moteur/piece.test.ts`, « 1.275.0 : G04 … » (dont 60 pièces au hasard, écran contre serveur) ; `tests/v10/dossier.test.ts`, « G04 : … » ; `tests/web/facture-details.test.ts` | Corrigé |
| G05 | Un bulletin payé et validé reste modifiable | Oui : la sonde passait (HTTP 200) | 1.274.0 : au serveur (`garderLesBulletins`), un bulletin payé ne change plus de montant ni ne se retire ; validé, il ne change plus du tout ; la validation ne se pose ou ne se retire que par le cabinet. L'écran ne propose plus « Modifier le bulletin payé » (on régularise, ou on annule le paiement), le cabinet non plus | `tests/v10/paie.test.ts`, « G05 : … » | Corrigé |
| G06 | Deux bulletins ordinaires pour un salarié et un mois | Oui : la sonde passait | 1.274.0 : index unique (0190) sur l'entreprise, le salarié et le mois ; le refus de la base devient une phrase ; dans un envoi, les retraits passent d'abord, puis les bulletins qui existaient | `tests/v10/paie.test.ts`, « G06 : … » (deux envois au même instant compris) | Corrigé |
| G07 | La régularisation négative refusée au serveur | Oui : 403 | 1.274.0 : une prime peut être négative (régularisation d'un trop-perçu, retenue des retards) ; une retenue reste positive ; un brut soumis à la CNSS négatif se refuse | `tests/v10/paie.test.ts`, « G07 : … » | Corrigé |
| G08 | Le rappel trop élevé sur un mois proratisé avec absence | Oui : 95,858 DT au lieu de 46,154 | 1.274.0 : `ecartDeRappel` (moteur) refait le prorata au nouveau salaire et retire ce qu'un rappel d'avant a déjà porté pour ce mois (`rappelDe`, gardé par le rappel) ; un bulletin validé ne se refait pas | `tests/moteur/audit-paie-2026-11-04.test.ts`, « G08 : … » | Corrigé |
| G09 | Le temps partiel ignoré dans le taux des heures supplémentaires | Oui : 3,906 DT au lieu de 7,813 | 1.274.0 : `heuresDuMoisDe` : les heures du contrat d'un temps partiel (heures par semaine × 52 / 12), pour l'heure sup, le retard, l'heure de nuit, le coût d'une heure et l'effet affiché à l'écran. La règle légale (heures complémentaires) reste **À VÉRIFIER** | `tests/moteur/audit-paie-2026-11-04.test.ts`, « G09 : … » | Corrigé |
| G10 | Un congé à cheval sur deux années compté deux fois | Oui | 1.274.0 : chaque année ne compte que les jours du congé qui y tombent (`joursAnnee`) ; la liste montre toujours le congé entier | `tests/moteur/audit-paie-2026-11-04.test.ts`, « G10 : … » | Corrigé |
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
- **G04** : une pièce déjà là garde la règle 1, avec laquelle elle a été émise : rien ne se recalcule. Seules les pièces créées
  depuis 1.275.0 naissent en règle 2.
- **G05, G06** : les règles valent pour ce qui arrive. Un bulletin déjà doublé ou déjà réécrit avant 1.274.0 ne se voit qu'en
  base ; la migration 0190 s'arrête sur un doublon (aucun n'existe sans données réelles).
- **G01** : on ne trouve une facture déjà effacée de cette façon qu'en comparant les pièces émises du serveur
  (`ventes.piece`) au dossier. La requête de lecture seule qui les liste attend la première base réelle ; elle ne corrige rien
  d'elle-même.
