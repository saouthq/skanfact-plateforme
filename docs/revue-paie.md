# Revue métier et UI/UX de la paie de l'entreprise (01/11/2026, après 1.227.0)

*Demande de Skander : « les maquettes ne respectent pas forcément notre plateforme, donc il faut une revue métier et
UI/UX, car je suis sûr qu'il manque beaucoup d'écrans ». La maquette `docs/maquettes/paie.html` a été appliquée
(lots 1 à 6) ; cette revue part de l'APPLICATION et de ce que fait le reste de la plateforme (trésorerie, comptabilité,
cabinet, équipe et droits, lecture seule, hors ligne, aide, recherche), pas de la maquette.*

Chaque point : ce qui manque ou ce qui est faux, pourquoi c'est grave pour une entreprise tunisienne, et le lot qui
le traite. Ce qui est incertain (droit du travail, CNSS, fiscal) est écrit **À VÉRIFIER**.

## 1. Les trous métier (ce qu'un employeur fait et que SkanFact ne sait pas faire)

| # | Manque | Pourquoi c'est grave | Lot |
|---|---|---|---|
| M1 | **Payer la CNSS et la retenue à la source ne sort pas l'argent de la trésorerie.** « Marquer déposée » ne garde que la date ; aucun montant, aucun compte, aucun mouvement. | Le solde de trésorerie ment chaque trimestre (des milliers de dinars) ; le rapprochement bancaire trouve un prélèvement CNSS sans pièce. Les salaires, eux, sortent (« payé »). | R1 |
| M2 | **Un salaire ne peut pas changer à une date.** Le brut est un seul chiffre sur la fiche ; le changer change tout de suite les estimations, sans date d'effet ni trace. | Une augmentation, un passage d'échelon, une revalorisation du SMIG ont une date. Le bulletin d'un mois passé refait plus tard prendrait le nouveau salaire. | R2 |
| M3 | **La fiche du salarié est incomplète** : ni e-mail (alors que la fiche affiche « E-mail — pour lui envoyer ses bulletins » et que « Remettre » dit « à envoyer à… »), ni date de naissance, ni adresse, ni téléphone, ni catégorie/échelon, ni période d'essai, ni temps partiel. | Une phrase que rien ne tient (l'e-mail) ; le registre du personnel, le contrat et la déclaration annuelle demandent ces informations (À VÉRIFIER : la liste exacte). | R2 |
| M4 | **Défaire un paiement** (un virement rejeté par la banque) n'existe qu'au toast « Annuler » des 6 secondes. | Un virement rejeté arrive des jours plus tard : il faut pouvoir remettre « à payer », avec la raison, et le mouvement de trésorerie qui s'efface. | R1 |
| M5 | **Un bulletin payé ne se corrige pas proprement** : aucun « rectificatif » daté ; la seule voie est de modifier le bulletin payé. | Un bulletin remis au salarié et payé ne doit pas changer en silence (la leçon de la v10 : une pièce émise se corrige, elle ne se réécrit pas). | R3 |
| M6 | **Pas de rappel** quand une augmentation compte depuis un mois passé, **pas de saisie sur salaire** (opposition, pension alimentaire), **pas de simulation** « combien coûte une embauche ». | Trois situations courantes que la maquette décrivait et que l'application n'a pas ; la saisie sur salaire a des plafonds légaux (À VÉRIFIER). | R3 |
| M7 | **Pas d'arrêt maladie distinct** (avec ses jours de carence et ce que paie la CNSS : À VÉRIFIER) : la maladie est un code du pointage et une nature de congé, rien de plus. | Le bulletin d'un salarié en arrêt est faux si l'on ne sait pas qui paie quoi. | R4 |
| M8 | **Pas d'import des salariés depuis un tableur** (les fournisseurs et les articles l'ont). | Une entreprise de 20 salariés qui arrive ne retape pas 20 fiches. | R4 |
| M9 | **La déclaration mensuelle n'a pas de « déposée et payée »** (seule la CNSS trimestrielle se marque). | « Ce que tu verses, et quand » ne peut pas dire ce qui est réglé. | R1 |

## 2. Les trous avec le reste de la plateforme

| # | Manque | Lot |
|---|---|---|
| P1 | **L'aide intégrée est d'avant les lots** : les textes de « Guide-moi » décrivent les anciens onglets ; rien sur le pointage, « Par salarié », « Les horaires », « L'année », le bon à payer, les contrôles, « Qui fait ma paie ». | R5 |
| P2 | **La recherche (Ctrl K)** connaît les vues de la paie mais pas les salariés par leur nom, ni « Payer les salaires », « Remettre les bulletins », « Approuver ». | R5 |
| P3 | **Le cabinet** ne peut pas encore écrire une correction ni voir le bon à payer (écrans du Cabinet, revue suivante) ; l'entreprise ne reçoit aucune alerte quand une correction arrive. | Cabinet |
| P4 | **Les droits de l'équipe** : un membre « lecture seule » de la paie voit encore les boutons (approuver, accepter une correction, demander) ; le refus arrive au clic. La règle de la plateforme : un geste qu'on ne peut pas faire ne s'offre pas, ou se dit avant. | R5 |
| P5 | **Hors ligne** : approuver, accepter une correction ou payer pendant une coupure n'est pas décrit ; ce sont des gestes officiels (à faire passer par le serveur, comme numéroter ou émettre). À VÉRIFIER avec `docs/hors-ligne.md`. | R5 |
| P6 | **L'accueil** ne dit rien du bon à payer, d'une correction proposée ni d'une demande de congé en attente. | R5 |

## 3. UI/UX (vu en photos, ordinateur et téléphone)

| # | Écart | Lot |
|---|---|---|
| U1 | **Au téléphone, les bulletins sont des cartes lourdes** (« Marquer payé » et « Actions » sur chacune) ; la maquette montre une carte simple (avatar, nom, ce qui change, net) et un seul geste en bas. | R6 |
| U2 | **Le pointage du mois a deux sélecteurs de mois** (celui de la page et celui de la carte) ; l'un ou l'autre ment quand ils diffèrent. | R6 |
| U3 | **La fiche du salarié au téléphone** n'a pas encore été photographiée (ses sept onglets, ses blocs de droite). | R6 |
| U4 | **Les états vides et premières fois** : « Première fois » de la maquette (aucun salarié) existe ; mais un mois sans bulletin dans un mois passé, un salarié sans aucun bulletin, une année sans paie n'ont pas été revus. | R6 |
| U5 | **Le sombre** n'a été photographié que sur « Le mois ». | R6 |

## 4. Les lots proposés, dans l'ordre

1. **R1 — l'argent juste** (fait, 1.228.0) : payer la CNSS et la retenue (montant, compte, mouvement de trésorerie, « Annuler ») ;
   la déclaration mensuelle marquée déposée et payée ; un virement rejeté remis « à payer » avec sa raison.
2. **R2 — la fiche complète** (fait, 1.229.0) : e-mail, naissance, adresse, téléphone, catégorie/échelon, période d'essai, temps
   partiel ; un salaire qui change à une date, avec son historique.
3. **R3 — corriger sans réécrire** (fait, 1.230.0) : le bulletin rectificatif daté, le rappel d'une augmentation passée, la saisie sur
   salaire, la simulation d'une embauche.
4. **R4 — les cas du quotidien** (fait, 1.231.0) : l'arrêt maladie, l'import des salariés par tableur.
5. **R5 — la plateforme autour** (fait, 1.232.0) : aide et visites à jour, recherche, droits avant le geste, hors ligne, accueil.
6. **R6 — finitions UI/UX** (fait, 1.233.0 ; photos de la vérification finale) : téléphone, pointage, fiche, états vides, sombre ; nouvelles photos contre la maquette.

Ensuite seulement : la revue du Cabinet (écrire une correction, voir le bon à payer).
