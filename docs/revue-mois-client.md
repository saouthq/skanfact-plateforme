# Le mois d'un client, vu des deux côtés (23/10/2026)

*Demandée par Skander le 23/10/2026 : « comment on peut améliorer l'expérience utilisateur entre l'entreprise et le
cabinet, et même partout dans nos app » ; puis « note tout dans le backlog car ça doit être fait ; l'essentiel : une
meilleure expérience dans les parcours, mais aussi une UI qui donne envie de travailler dessus ». Faite à la souris sur
l'écran virtuel (1440×900), version 1.122.0, une capture par geste, données inventées : Sarra Mansour (Boulangerie El
Amal, Sfax) et son comptable Hatem Jlassi (Cabinet Jlassi Conseil), deux comptes neufs. Le parcours entier, dans l'ordre
où il se vit : l'invitation, l'acceptation, la fiche, une facture, un achat, ce que voit le cabinet, la pièce demandée et
envoyée, la validation du mois, la déclaration, et ce que voit le client à la fin.*

## Le verdict

**Le fond est solide** : l'invitation par lien marche, un comptable qui a déjà SkanFact Cabinet voit la demande en haut
de ses dossiers et l'accepte d'un clic ; la facture et l'achat de Sarra arrivent tout seuls au brouillard du cabinet,
équilibrés ; la pièce demandée porte sa date limite et son rappel ; la cliente répond avec une photo (aperçu, « Changer »,
un mot) ; le cabinet valide le mois en un geste ; la déclaration dit honnêtement qu'octobre n'est pas fini. Les calculs
sont justes au millime (120 × 1,850 = 222,000 HT ; TVA 42,180 ; 265,180 à payer).

**Ce qui manque, c'est le fil qui relie les deux côtés** : chaque écran fait bien sa part, mais aucun ne dit à l'autre ce
qui vient de se passer. Sarra ne sait pas que son comptable a validé octobre ; sa photo ne retrouve pas l'achat déjà saisi ;
la demande du comptable ne dit pas sa date limite ; et le cabinet dit « tout est à jour » à côté d'une ligne « à
valider ».

## P1 — ce qui gêne vraiment (le lot 1)

1. **Une pièce reçue ne retrouve pas la pièce déjà saisie, des deux côtés.** Hatem demande « la facture GMS-26-4471 des
   Grands Moulins » : l'achat GMS-26-4471 est déjà dans les achats de Sarra et au brouillard du cabinet, sans
   justificatif. Sarra envoie la photo ; on lui propose « Ranger dans mes achats… », qui ouvre une facture d'achat **neuve
   et vide** (un doublon si elle la remplit). Chez Hatem, « Saisir cette pièce » ouvre aussi une écriture neuve. *À
   faire* : quand un achat du dossier porte le numéro cité (ou le même fournisseur et le même montant), la photo se
   **joint à cet achat** d'un geste, des deux côtés (« Joindre à l'achat GMS-26-4471, déjà saisi ») ; « Ranger dans mes
   achats » ne reste que pour une pièce que rien ne porte.
2. **La demande du comptable dans l'« À faire » de l'accueil : sans sa date, et pas toujours.** Ouvert comme le fait tout
   le monde (« Ton cabinet attend 1 pièce », avec « Répondre »), l'« À faire » la porte depuis la 1.102.0, mais sans la
   date limite ni le retard ; et ouvert par l'adresse « #/ », il ne la montrait pas (le rafraîchissement ne reconnaissait
   que « #/dashboard »), seul le « 1 » du menu la disait. *À faire* : la date « pour le » la plus proche, ou le retard en
   rouge, et l'Accueil reconnu par le routeur.
3. **Le cabinet dit « tout est à jour » à côté d'une ligne « à valider ».** Le bandeau vert : « Tout est à jour : ton
   client sur SkanFact n'a aucun mois passé vide ni à valider » ; juste dessous, « octobre 2026 · à valider », avec un
   point **vert** alors que la légende réserve l'orange à « à valider ». Le bandeau ne compte que les mois passés, mais rien
   ne le dit. *À faire* : le point suit l'état de la ligne ; la phrase dit les deux (« Rien en retard. 1 client a des
   écritures d'octobre à valider. »).
4. **Sarra ne voit rien de ce que fait son comptable.** Après la validation d'octobre, « Mon comptable » montre le fil et
   « Rien n'attend ta réponse » ; rien sur le mois. *À faire* : une carte « Ce mois-ci » dans « Mon comptable » : les
   pièces du mois (ventes, achats, achats sans justificatif), ce que le cabinet a validé, et la prochaine déclaration,
   **à la même date que celle du cabinet** (voir 10).
5. **Deux boutons verts à la fois, des deux côtés.** Entreprise : après l'invitation par e-mail, « Confier mon dossier »
   (le chemin du code, que Sarra n'a pas pris) reste vert ; le geste suivant est « Copier le lien ». Cabinet : « Ajouter mes
   clients… » reste vert en haut pendant qu'une entreprise attend « Accepter ». *À faire* : un seul vert, l'étape suivante.

## P2 — ce qui rend le lien naturel (le lot 2)

6. **Les achats confiés au cabinet ne le disent pas.** Sarra a confié « la saisie des achats » ; la page Achats l'invite
   pourtant à tout saisir elle-même. *À faire* : avec ce mandat, l'état vide et l'en-tête proposent d'abord « Envoyer la
   photo à mon comptable » (le fil, pièce jointe), la saisie restant possible.
7. **Le cabinet ne peut pas réclamer le justificatif depuis la ligne du brouillard.** Le menu de la ligne offre « Voir ses
   lignes », « Valider », « Joindre un justificatif… » ; il faut passer par les Messages et retaper le numéro. *À faire* :
   « Demander le justificatif à Boulangerie El Amal », la pièce citée d'avance ; et un repère « sans justificatif » sur la
   ligne.
8. **La validation ne prévient pas d'un achat sans justificatif**, alors qu'une photo attend dans les messages. *À
   faire* : la fenêtre le dit avant (« 1 achat sans justificatif : la photo reçue à 15:06 peut s'y joindre »).
9. **L'onglet « Suivi » d'un dossier ne dit rien du mois.** Il montre le calendrier, les relances, qui travaille dessus ;
   pas « ce mois-ci : 1 vente, 1 achat, 2 écritures au brouillard », ni le bouton pour les valider. *À faire* : la même
   carte « Ce mois-ci » que chez le client, vue du cabinet, avec son geste.
10. **Deux écrans, deux dates de déclaration** (À VÉRIFIER avec un comptable). L'accueil de Sarra annonce « Déclaration
    mensuelle d'employeur et de TVA le 28/10/2026 » (celle de septembre) ; le cabinet : « rien avant dans ce livre : ce
    sera sa première déclaration », octobre, au plus tard le 28/11/2026. Faut-il une déclaration « néant » pour un mois
    sans activité, avant l'arrivée sur SkanFact ? La réponse décide la phrase ; les deux écrans doivent dire la même.
11. **L'invitation, avant le lien.** Sans cabinet, la carte vide « Les questions de ton comptable » passe avant
    l'invitation ; le curseur attend dans l'e-mail (à droite) quand le vert est sur le code (à gauche). Et le texte du
    cabinet (« dans Paramètres → Envois → Ton cabinet comptable ») ne nomme pas le chemin pris par Sarra (Comptabilité ›
    Cabinet, depuis « Tes premiers pas »). *À faire* : l'invitation d'abord ; le texte nomme le chemin réel.
12. **Un appel refusé à chaque ouverture d'un dossier sans paie.** Le Cabinet demande la paie du dossier (403) alors que
    le mandat ne la confie pas. Rien ne se voit ; l'appel ne doit pas partir.
13. **Le cabinet ne voit pas, sur l'écriture, le justificatif que le client a joint à son achat** (vu en corrigeant
    le point 1, le 23/10/2026). Le Cabinet lit les justificatifs du client dans les anciens « paquets » de la v10 ; en
    ligne, l'écriture GMS-26-4471 n'en montre aucun, alors que la photo est jointe à l'achat de Sarra. Elle reste dans le
    fil (« Ouvrir »). *À faire* : l'écriture née d'un achat ou d'une facture montre les pièces jointes de sa pièce, et
    « Joindre un justificatif… » marche en ligne.

## P3 — une UI qui donne envie (le lot 3, avec UX 3)

14. **La facture émise reste un formulaire grisé.** Une pièce qui ne se modifie plus mérite une vraie page de lecture :
    la pièce, son état (émise, payée en partie, réglée), ses paiements, son historique, et ce qu'en a fait le comptable.
15. **Créer un client ou un fournisseur depuis une pièce ouvre douze cases.** Le nom, le matricule et l'adresse suffisent
    sur le moment ; le reste derrière « Plus de détails ».
16. **« Première fois sur cette page ? » trois fois en cinq minutes.** *À faire* : « Ne plus me proposer de visites »
    d'un geste, et une proposition par session au plus.
17. **« Envoyer au comptable… »** (Comptabilité › Ventes) envoie par e-mail à quelqu'un d'autre, alors que la phrase
    dessous dit que le cabinet lit tout en direct : il s'appelle « Envoyer par e-mail… » quand un cabinet est relié.
18. **La validation finit sur une fenêtre à fermer.** Un message bref suffit, avec l'étape suivante (« Octobre est
    validé. Prochaine étape : la déclaration, avant le 28/11. »).

## Ce qui a été vérifié et va bien

L'accueil du cabinet après « Accepter » (1 client suivi, à jour) ; le brouillard rempli tout seul par les pièces du client ;
la demande de pièce avec date limite et rappel (« une fois par semaine, trois au plus ») ; « En attente de toi » des deux
côtés ; la fenêtre « Envoyer la pièce demandée » (photo avec aperçu, ou « Elle est déjà dans SkanFact ») ; « Reçue » chez le
cabinet, « Lue » chez la cliente ; la validation des deux pièces d'un geste, numérotées 1 et 2 ; la déclaration qui dit
qu'octobre n'est pas fini ; la recherche Ctrl K, déjà là dans l'entreprise.

## Les lots

- **Lot 1 (P1, 1–5)**. *Fait en 1.123.0, sauf le 4 (la carte « Ce mois-ci »), qui suit seul :*
  - **1** : quand la demande à laquelle la photo répond cite le numéro d'un achat du dossier (un seul), le fil propose
    « Joindre à l'achat GMS-26-4471 · Grands Moulins de Sfax · 577,150 DT » ; la photo s'ajoute aux pièces jointes de
    cet achat, sans en créer un autre, et le fil dit où elle est rangée. « C'est un autre achat… » garde l'ancien chemin.
    Chez le cabinet, une photo rangée dans un achat offre « Voir l'écriture » (le livre-journal, brouillard compris,
    cherché sur son numéro) au lieu de « Saisir cette pièce ». Le cabinet ne voit pas encore la photo sur l'écriture :
    c'est le point 13.
  - **2** : la ligne « Ton cabinet attend… » de l'« À faire » dit « Elle est attendue pour le 25/10/2026 » (« La
    première… » quand il y en a plusieurs), ou le retard, en rouge ; le serveur donne la date (`pourLe`) avec le reste de
    ce qui attend ; l'Accueil ouvert par « #/ » se redessine comme « #/dashboard ».
  - **3** : le bandeau dit « Rien en retard. Ton client a des écritures du mois en cours à valider. » quand c'est le cas,
    et le point de la ligne passe à l'orange de la légende. La carte « 1 / 1 à jour, aucun retard » au-dessus reste
    juste (elle compte les retards), mais se lit encore vite comme « rien à faire » : à revoir avec UX 3 (les tons).
  - **5** : après l'invitation par e-mail, « Copier le lien » est le seul vert ; au Cabinet, « Ajouter mes clients… »
    cède le vert à « Accepter » tant qu'une entreprise attend.
  - Tenu par `tests/web/mois-client.test.ts` (le parcours de Sarra et Hatem, à la souris) et onze preuves
    « mois 123 » ; vu à l'écran le 23/10/2026.
- **Lot 2 (P2, 6–13)**, sauf le 10 qui attend la réponse d'un comptable (À VÉRIFIER).
- **Lot 3 (P3, 14–18)**, avec la passe visuelle UX 3 du carnet.

Les captures : `m01` à `m48` de la recette (scratchpad de la session, non versées).
