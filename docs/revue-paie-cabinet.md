# Revue de la paie du Cabinet, face à sa maquette et à l'entreprise (01/11/2026)

*Demande de Skander : « go revue complète et mets-la en face de notre app ; il faut que tous les parcours soient cohérents,
compréhensibles et ergonomiques ». La maquette : `docs/maquettes/cabinet/comptabilite.html`, la Paie (18 états, dessinée le
01/11/2026). L'écran réel : `vuePaie` dans `web/public/v10/cabinet/app.js`, photographié au bureau (1440 px) et au
téléphone (390 px) sur trois dossiers (paie tenue par le cabinet, faite par le client seul, une correction en cours).*

## 1. Le constat en une phrase

**Le Cabinet ne voit pas le parcours que l'entreprise vit.** Les trois dossiers photographiés donnent exactement le même
écran : le Cabinet ne sait pas qui fait la paie, ne voit pas l'accord du client, ne peut ni proposer ni suivre une correction.
Et son écran est encore l'ancienne longue page (bulletins, pointage, congés, avances, salariés, CNSS, masse salariale
empilés, environ 7 écrans de défilement), là où la maquette en fait cinq vues, une frise et un seul bouton principal.

## 2. Les parcours, des deux côtés

La paie d'un mois traverse les deux applications. Chaque étape doit se lire **au même endroit, avec les mêmes mots**, chez
Sarra (l'entreprise) et chez Anis (le cabinet). Aujourd'hui :

### 2.1 La paie tenue par le cabinet (le client a écrit « mon cabinet la tient »)

| Étape | Chez Sarra (entreprise) | Chez Anis (Cabinet), aujourd'hui | Ce qu'attend la maquette |
|---|---|---|---|
| 1. Le pointage | elle pointe, il part avec la paie | lu dans la grille, sans dire d'où ni quand il est arrivé | « reçu de Sarra le 27/10 » ; attendu → « Le demander à Sarra » |
| 2. Les bulletins | — | établis un à un (« + Bulletin… ») | « Préparer les 5 bulletins » d'un geste, rangés par ce qui change |
| 3. L'accord | « J'approuve les 5 bulletins » **dès qu'ils existent**, même à moitié préparés | **rien** : il ne voit pas l'accord, ne peut pas l'attendre | « Envoyer à Sarra pour accord » ; puis « approuvés par Sarra à 11 h 40 » |
| 4. Figer | — | rien ne fige un bulletin | « Valider les 5 bulletins » : ils ne bougent plus, l'écriture passe au brouillard |
| 5. Payer | « Payer les salaires » | rien | « par Sarra, d'ici le 31/10 » ; « Lui rappeler le 30/10 » |
| 6. Remettre | « Bulletin » en PDF | « Exporter le bulletin » un par un | « Les envoyer » : les 5 PDF dans les documents de Sarra |
| 7. Déclarer | « Ce que tu verses, et quand » | la CNSS en bas de la page | « Déclarés » dans la frise ; « Ouvrir les déclarations » |

**Incohérence majeure (P1)** : Sarra peut approuver des bulletins que le cabinet n'a pas fini de préparer, et le cabinet ne
le sait jamais. Le bon à payer doit attendre l'envoi du cabinet, et l'accord doit se lire au Cabinet.

### 2.2 La paie faite par le client, vérifiée par le cabinet

| Étape | Chez Sarra | Chez Anis, aujourd'hui | Maquette |
|---|---|---|---|
| Vérifier | — | rien ne dit « faite par Sarra » ; le Cabinet peut **réécrire** son bulletin sans son accord | « faite par Sarra · le cabinet la vérifie, et la corrige avec son accord » |
| Corriger | elle sait déjà lire, accepter ou refuser une correction (1.227.0) | **aucun écran ne l'écrit** | « Proposer la correction à Sarra » (avant, après) → « En attente de Sarra », « La relancer », « Retirer la proposition » |
| La réponse | « Accepter la correction » / « Refuser, je m'en occupe » | invisible | acceptée : le bulletin change, la trace reste ; refusée : une remarque |

**Incohérence majeure (P1)** : la règle « le cabinet n'écrit jamais chez un client sans son accord » (CLAUDE.md) n'est pas
tenue ici : le menu d'un bulletin du client offre « Modifier » au Cabinet, qui réécrit le bulletin directement.

### 2.3 La paie faite par le client seul

Le Cabinet la lit et la passe en comptabilité. Aujourd'hui rien ne le dit ; la page offre « + Salarié… » et « + Bulletin… »
comme s'il la tenait.

## 3. Écran par écran (maquette → réel)

| État de la maquette | Ce qu'il montre | Le réel | Écart |
|---|---|---|---|
| **paie** (le mois, prêt à envoyer) | en-tête « 5 salariés · tenue au cabinet par Anis · le pointage est arrivé le 27/10 » ; 5 vues ; frise 5 étapes ; un bouton « Envoyer à Sarra pour accord » ; 4 chiffres ; « Les contrôles avant l'envoi » (12, dont SMIG, férié, plafond HS, bulletins = journal = écriture) ; bulletins rangés « Ce qui change ce mois / Comme septembre » avec la raison sur la ligne ; le bulletin ouvert à droite (chaque ligne dit d'où elle vient, « Pourquoi cet IRPP ? ») ; raccourcis ↑ ↓ Espace Entrée P | une barre « Mois + Salarié + Bulletin + Passer l'écriture (toujours éteint : le serveur l'écrit déjà) + Journal » ; 1 contrôle (n° CNSS) ; un tableau de 7 colonnes à « DT » répété ; tout le reste empilé dessous | **tout** |
| **paievide** | « Le pointage d'octobre n'est pas encore là » : Le demander · Le saisir moi-même · Préparer sans pointage | « Aucun bulletin… » + « Établir un bulletin… » | état absent |
| **paiepointage** | la grille lue (version 1, verrouillée, sa source, ses anomalies réglées), « Préparer les 5 bulletins » ; le cabinet **ne change pas** le pointage de Sarra, il lui demande | une grille éditable sans dire d'où elle vient ; P écrit dans chaque case | source et verrou absents ; case vide = présent (fait côté entreprise en 1.234.0) |
| **paieaccord** | « approuvée par Sarra à 11 h 40 » ; « Valider les 5 bulletins » | invisible | absent (P1) |
| **paieecarts** | les écarts sur le mois d'avant, rubrique par rubrique, avec leur source ; « L'écart du brut, expliqué en entier, égal au millime » | absent | absent |
| **paieapres** | « Les bulletins d'octobre sont faits » : 1. Les envoyer · 2. Les salaires (Lui rappeler) · 3. Déclarer ; l'écriture de paie, compte par compte | « au brouillard » + « La valider dans la saisie » | absent |
| **paieapresval** | après validation : 4 h sup arrivées après (« Sur novembre » / « Un rectificatif ») ; virement rejeté (« Le dire à Sarra ») ; la règle « un mois validé ne se rouvre pas en silence » | rien (le bulletin se modifie, l'écriture se contre-passe) | absent |
| **paieverif** | « faite par Sarra · le cabinet la vérifie » ; l'avance oubliée d'Hamza ; « Proposer la correction à Sarra » | absent | absent (P1) |
| **paiepropose** | « En attente de Sarra » ; le tableau avant/après ; La relancer · Retirer | absent | absent (P1) |
| **paierappel** | un rappel de salaire (+5 % depuis mai) calculé salarié par salarié, posé sur novembre | absent | fonction nouvelle |
| **paiesalaries** | les salariés (contrat, n° CNSS, brut, RIB masqué), le CDD qui finit « Me le rappeler le 01/12 », la fiche à droite (ce qui manque, « Demander à Sarra… ») | un tableau (nom, n° CNSS, poste, contrat, brut) en bas de page | à refaire |
| **paiesortie** | le départ d'un CDD : le dernier bulletin (congés pas pris, indemnité À VÉRIFIER), les documents, « Envoyer le projet à Sarra » | les documents du personnel existent (1.72.0), pas le projet | à composer |
| **paieconges** | « Congés et avances » : les congés (Acquis, Pris, Reste, Sans solde) et les avances en barres | deux tableaux en bas de page ; **une demande de congé non acceptée s'y dit « payée »** (défaut D1) | à refaire + D1 |
| **paieabsences** | les absences du mois prochain déjà connues, leur effet sur le bulletin, qui décide | absent | absent |
| **paiecnss** | le trimestre déposé (accusé, paiement rapproché), le suivant (ce qui empêche le fichier), salarié par salarié, et le 4531 du livre | la déclaration CNSS, l'état et le fichier (déjà justes, 1.65 et 10.14.1) | mise en page ; le livre en face |
| **paieannee** | le coût mois par mois ; « Les bulletins et le livre disent le même chiffre » (640) ; la déclaration annuelle ; la fin d'année | la masse salariale de l'exercice | à composer |
| **paieparam** | le paramétrage du dossier : 5 réglés · 7 à régler (convention collective d'abord), qui l'a réglé et quand | « Voir les taux de la paie… » (lecture) | à composer |
| **paiedossiers** | la paie du mois de **tous mes dossiers** : pointage, bulletins, salaires, « Relancer » | absent | absent |

**Au téléphone** : la page dit « Pensé pour un ordinateur » et commence par une barre de mois ; la maquette donne une carte
par salarié et le bouton du mois sous le pouce (ce que l'entreprise a reçu en 1.233.0).

## 4. Défauts trouvés en passant

- **D1** — Une demande de congé que Sarra n'a pas acceptée se lit « payée » dans la liste des congés du Cabinet (le solde et
  le pointage, eux, l'ignorent bien : `congeRetenu`). Deux écrans, deux vérités.
- **D2** — « Passer l'écriture de paie » est toujours éteint sur la plateforme (le serveur écrit l'écriture du mois) : un
  bouton qui ne sert jamais, et sa phrase d'excuse au-dessus de la page.
- **D3** — Le Cabinet propose « Modifier le bulletin » sur une paie faite par le client (voir § 2.2).

## 5. Ce qui reste « À VÉRIFIER » et ne se montre pas comme fait

Le SMIG (aucun réglage daté : à ajouter avant de le contrôler), le jour férié posé tout seul, le plafond des heures sup,
l'imposition d'un rappel de plusieurs mois, l'indemnité de fin de CDD, la remise électronique des bulletins aux salariés,
la facturation au bulletin (lettre de mission). Chacun s'écrit « À VÉRIFIER » à l'écran, ou ne s'écrit pas encore.

## 6. Les lots

| Lot | Contenu | Côté |
|---|---|---|
| **C1** | La paie en **cinq vues** (Le mois, Salariés, Congés et avances, CNSS du trimestre, L'année) ; l'en-tête qui dit **qui fait la paie** ; la frise ; **un seul bouton principal**, l'étape suivante ; les 4 chiffres ; les bulletins rangés par ce qui change, leur raison sur la ligne ; le bulletin ouvert à droite (d'où vient chaque ligne, « Pourquoi cet IRPP ? ») ; D1, D2 | Cabinet |
| **C2** | **L'accord** : « Envoyer à Sarra pour accord » (le cabinet) ; l'entreprise n'approuve qu'après l'envoi ; « approuvés par Sarra » au Cabinet ; « Valider les N bulletins » (figés) ; « Vérifié » par bulletin | les deux |
| **C3** | **La paie du client vérifiée** : plus de « Modifier » (D3) ; « Proposer la correction » (avant/après, écrite sur le bulletin du client, que l'entreprise lit déjà) ; « En attente de Sarra », relancer, retirer ; la réponse lue | les deux |
| **C4** | **Après** : « Les bulletins sont faits » (les envoyer, le rappel de paiement, déclarer) ; l'écriture de paie compte par compte ; après validation : régulariser ou rectifier, le virement rejeté | Cabinet |
| **C5** | Les vues Salariés (fiche à droite, CDD, sortie), Congés et avances (barres, absences à venir), CNSS (le livre en face), L'année (bulletins = 640), Paramétrage, Écarts ligne à ligne | Cabinet |
| **C6** | « La paie de tous mes dossiers » ; le pointage attendu (« Le demander ») ; le téléphone | Cabinet |

Le rappel de salaire (`paierappel`) est une fonction nouvelle : il attend la décision de Skander (le construire maintenant, ou
plus tard).
