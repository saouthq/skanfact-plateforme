# La paie de l'entreprise face à sa maquette : ce qui manque encore (02/11/2026 ; lots 1.256.0 et 1.257.0 faits)

Remarque de Skander (02/11) : « tu as oublié encore beaucoup d'écrans, d'états, d'Ouvrir de la maquette paie de
l'entreprise ». Relue état par état (les 37 « État ») et fenêtre par fenêtre (les 28 « Ouvrir ») de
`docs/maquettes/paie.html`, contre le code de `web/public/v10/app.js`. Ce qui est déjà là n'est pas relisté ; seuls les
manques (❌) et les morceaux à moitié faits (◐). Les décisions prises depuis la maquette gardent la main : quatre onglets
(Le mois, Présences, Salariés, Déclarations, décidé le 02/11), la bande des douze mois.

Les sept points de `docs/etudes/paie-concurrents.md` (accord de Skander du 02/11) sont dans le premier lot.

## La méthode (demande de Skander, 02/11/2026)

« Au lieu de refaire les états, écrans et Ouvrir manquants, reprends ceux de la maquette et adapte-les : la maquette est
soignée par rapport à ce que tu fais sur notre app. » Et : « devant chacun sa capture d'écran identique ou en mieux ».

1. **Le style de la maquette, tel quel** : sa feuille de style est reprise dans `web/public/plateforme/paie-maquette.css`,
   limitée à la page Paie (tout est préfixé `.pm`), avec ses couleurs, ses cartes, ses tableaux, ses pastilles, ses fenêtres.
2. **Ses écrans, un par un** : chaque fonction de dessin de la maquette (`mois`, `bulletins`, `pointage`, `salaries`,
   `fiche`, `conges`, `declarations`, `annee`, et chacune de ses fenêtres) est reprise dans `app.js`, branchée sur les vraies
   données (les bulletins, le pointage, les congés…) au lieu des données d'exemple de la maquette. Les gestes restent ceux
   de l'application (enregistrer, défaire, refuser avec sa raison).
3. **Ce qui a été décidé depuis la maquette garde la main** : quatre onglets (Le mois, Présences, Salariés, Déclarations),
   la bande des douze mois.
4. **La planche** : pour chacun des 37 états et des 28 « Ouvrir », la capture de la maquette et celle de l'application,
   côte à côte (`scratchpad/maq/img/` pour la maquette ; la planche se publie à la fin du lot).

## Lot 1.256.0 — le mois, les salariés, les congés, l'année

| Maquette | Ce qui manquait | État (1.256.0) |
|---|---|---|
| (accord du 02/11) | Quatre onglets : Présences (pointage, par salarié, congés et absences, horaires), Salariés (l'équipe, avances et prêts), Déclarations (les déclarations, l'année) | ✅ |
| « Combien coûte une embauche ? » | Partir du **net** voulu (net → brut), aussi sur la fiche | ✅ |
| (concurrents) | **Augmentation en lot** : choisir les salariés, + x % ou + x DT, dès un mois, les rappels | ✅ |
| « Fiche : une entrée » | La **fin de période d'essai** dans « À traiter » : confirmer (le courrier) ou préparer la sortie | ✅ |
| « Un départ » | Le **préavis** (dernier jour proposé) et l'**indemnité de licenciement**, en réglages vides par défaut | ✅ |
| « Réglages et convention » | La **prime d'ancienneté** par tranches (vide = rien) ; la ligne « Convention collective » dit ce qui est réglé | ✅ |
| « Les primes et retenues du mois » | La **grille du mois** : un salarié par ligne, une **rubrique** par colonne (prime exceptionnelle, panier, commission, retenue diverse), chaque rubrique réglée une fois (CNSS, impôt) ; « Une autre rubrique… » ; **coller depuis un tableur** | ✅ |
| « Sans cabinet : le mois » | « Personne ne vérifie tes bulletins : SkanFact les a contrôlés » et « Voir les contrôles » | ✅ |
| « Un virement de salaire rejeté » | Les gestes : **Repayer** (espèces contre reçu, ou nouveau virement), **Saisir son nouveau RIB**, la trace du paiement | ✅ |
| « Des heures oubliées après validation » | **Mettre les heures sur le mois suivant** (régularisation au taux du mois) ou **Demander un rectificatif** au cabinet ; la trace au pointage | ✅ |
| « Une demande de congé (solde trop court) » | « **Accepter : 3 jours payés, 3 sans solde** », « Proposer d'autres dates », « Refuser » ; ce que la demande donne sur le bulletin | ✅ |
| « Un arrêt maladie » | « Les autres absences et ce qu'elles font » : accident du travail, maternité, congés exceptionnels, sans justificatif (À VÉRIFIER) | ✅ |
| « L'année » | **La fin de l'année** : prime de fin d'année (si la convention), départs prévus, attestations de salaires, déclaration annuelle, congés reportés, régularisation de l'impôt | ✅ |
| « Une vendeuse sans le droit Paie » | La page qui le dit (« La paie se voit avec le droit Paie »), et « Écrire à » la direction | ✅ |

## Lot 1.257.0 — le pointage tel que la maquette

| Maquette | Ce qui manquait | État (1.257.0) |
|---|---|---|
| « Les horaires d'équipe » | Plusieurs **équipes** (le fournil la nuit, la boutique le matin, l'après-midi) : horaires, jours, qui ; l'équipe sur la fiche du salarié | ✅ |
| « Comment chaque équipe pointe » | Une équipe à la pointeuse, une autre à la main | ✅ |
| « Les jours fériés de 2026, posés d'eux-mêmes » | La liste de l'année, réglable, posée dans la grille | ✅ |
| « Le mois, ses totaux » | Le tableau complet : présent, payés, heures sup, sans solde, **retards**, « à savoir » ; la ligne des totaux | ✅ |
| « Les compteurs » | Heures sup de l'année et plafond, retards du mois, heures de nuit (réglages vides par défaut) | ✅ (la nuit dite « pas encore comptée ») |
| « Pointer une case » | Le **retard** (minutes, retenu ou non selon le réglage) | ✅ (jamais retenu : le réglage viendra) |
| « Envoyé, verrouillé » | **Envoyer le pointage** au cabinet : verrouillé ; « Corriger : une nouvelle version » ; « Voir la version envoyée » | ✅ (« Valider » : sans cabinet, rien ne s'envoie) |
| « Ses anomalies » | « À régler avant d'envoyer » : sortie oubliée (« Mettre la sortie à 11:00 »), jours sans badge ni justificatif (« sans solde ou congé payé ») | ✅ |
| « Importer la pointeuse » | Le fichier de badges : rattaché par **n° de badge** (sur la fiche), doublons ignorés, la main gagne toujours | ✅ |
| « La semaine de Mourad, heure par heure » | Arrivée, départ, travaillé, ce qui va au bulletin (heures sup au-delà du planning, arrondi, retards non retenus) | ✅ |
| « Où va la paie » (L'année) | Par **équipe**, avec les absences, heures sup et retards du mois | ✅ |
| « Novembre : qui est absent » | Le minimum par équipe (« le fournil tient la nuit à deux ») dit avant d'accepter un congé | ✅ |

Fenêtres reprises dans ce lot : renouveler un CDD (O15), une saisie sur salaire (O07), la case du pointage (O20),
importer la pointeuse (O06), les jours sans badge (O26), remettre les bulletins (O03). Restent pour le lot suivant : O05
(rappel), O08 (document), O17 (déclaration sans cabinet), O18/O19 (aperçus), O25 (correction), O27/O28 (téléphone) ;
la retenue des retards et les heures de nuit (réglages à venir).

Tout ce qui touche à une règle de droit (préavis, indemnité, ancienneté, plafonds, nuit, fériés, absences particulières)
reste un **réglage vide par défaut** et s'écrit « À VÉRIFIER ».
