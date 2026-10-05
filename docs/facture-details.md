# Les détails de la facture

*Lot du 05/10/2026 (méthode par lot : le parcours entier d'un commerçant en notant chaque problème, puis tout le lot
corrigé, puis les tests et leurs preuves, un seul envoi). Ce document dit ce qui n'allait pas, ce qui se passe
maintenant, pourquoi, et ce qui le prouve.*

## Le parcours

Samia tient une pâtisserie à Sfax. Elle a créé son entreprise sans matricule ni RIB (« je les mettrai plus tard ») et
fait sa première facture à un hôtel de Sousse, payable par virement, avec une retenue à la source de 1 % : l'aperçu,
l'émission, le PDF, le lien envoyé au client, un premier paiement, un avoir, le paiement du reste ; puis elle complète
sa fiche et refait une facture.

## Ce qui n'allait pas

- **F1.** La pièce imprimait « MF » suivi de rien sous le nom de l'entreprise (brouillon comme pièce émise) quand le
  matricule manquait, et une ligne vide quand l'adresse manquait.
- **F2.** « Paiement par virement bancaire » s'imprimait sans RIB : le client ne savait pas où virer. La fenêtre
  d'émission le disait (« Aucun RIB n'est renseigné… »), sans le geste qui règle.
- **F3.** Le tampon « Brouillon » (ou « Payée », « Annulée ») était posé à 62 mm du haut de la page : il couvrait
  l'objet de la pièce.
- **F4.** L'avertissement avant d'émettre disait « Ta fiche société est incomplète (raison sociale ou matricule
  fiscal) » à qui avait sa raison sociale, renvoyait à Paramètres → Mon entreprise (on quittait la pièce), et n'offrait
  aucun bouton.
- **F5.** Un matricule mal formé (« 1234567 », sans lettres ni codes) passait partout sans un mot.
- **F6.** Un refus du serveur à l'émission (« Le timbre fiscal n'est pas renseigné… ») passait dans un bandeau de trois
  secondes : on n'avait pas le temps de le lire, ni de savoir si la facture était émise.
- **F7.** La fiche complétée ne changeait rien au serveur : l'entreprise gardait le nom de sa création et aucun
  matricule. La copie figée des factures suivantes, la liste des entreprises et le portefeuille du cabinet lisaient
  cette identité-là : une facture émise après avoir complété la fiche était scellée **sans** matricule.
- **F8.** Après l'émission d'une facture avec une retenue choisie dans la liste, **plus aucun enregistrement du dossier
  ne passait** (« La facture FAC-2026-001 est émise ») : ni la fiche, ni un paiement. La liste écrit le taux en texte
  (« 1 ») ; la v10 le relit en nombre (1) à chaque chargement de la page ; le serveur y voyait un champ scellé changé.
- **F9.** « une retenue subie de octobre 2026 », « de août » : le mois ne s'élidait pas.
- **F10.** Le menu d'une ligne promettait « Le PDF est joint au message » (un navigateur ne joint rien) et proposait de
  « modifier » une pièce émise.
- **F11.** L'espace client ne disait que le reste à payer : le client ne voyait ni ce qu'il avait déjà payé, ni l'avoir.

## Ce qui se passe maintenant

- **D1. Rien de vide ne s'imprime** (`web/v10/facture-details.txt`, `documentHtml`) : sans matricule, pas de « MF » ;
  sans adresse, pas de ligne vide.
- **D2. Le tampon comme une encre** : grand, pâle (16 %), en travers du milieu de la première page, il se multiplie avec
  ce qu'il couvre (un texte noir reste noir, le blanc prend sa couleur) ; il se voit sans rien cacher.
- **D3. Ce qui manque se nomme, et se règle dans la fenêtre même.** Trois avertissements précis (la raison sociale,
  le matricule absent, le matricule mal formé, en citant ce qui est écrit), et le RIB pour une facture qui attend un
  virement ; sous eux, **« Compléter ma fiche… »** ouvre les seuls champs qui manquent (raison sociale, matricule,
  banque et RIB), les enregistre, puis la fenêtre d'émission se relit : plus rien ne manque, le bouton redevient
  « Émettre » (au lieu d'« Émettre quand même »). Un refus du serveur se lit dans la fenêtre, sous son champ marqué en
  rouge, et la fiche reprend ce qu'elle avait ; le rouge part dès qu'on retouche le champ. « Exporter en PDF » d'un
  brouillon passe par la même fenêtre.
- **D4. Un matricule mal formé manque autant qu'un matricule absent**, à l'écran comme au serveur, avec **la même
  forme** : sept chiffres, la lettre-clé, le code TVA, la catégorie et l'établissement (1234567A/A/M/000) ; les
  séparateurs ne comptent pas (« 1234567 a / b / m / 000 » est bien formé). La fiche le nomme (accueil, Paramètres,
  avant l'émission : « un matricule fiscal valide »).
- **D5. Un refus du serveur à l'émission se lit dans une fenêtre qui reste** : « La facture n'est pas émise », le
  motif du serveur en entier, puis « Rien n'a été émis : elle reste en brouillon, sans numéro » (sans le répéter quand
  le motif le dit déjà).
- **D6. L'identité de l'entreprise suit sa fiche** (`serveur/v10/identite.ts`, migration `0071`,
  `socle.porter_identite`). La raison sociale et le matricule que la fiche porte **sont** ceux de l'entreprise : quand
  un enregistrement de la fiche les change, le serveur les porte à l'entreprise dans la même transaction, et la trace
  le dit (`socle.entreprise.identite`, avant et après). Le matricule se garde sous sa forme lisible
  (1234567A/A/M/000). Un matricule mal formé ne se porte pas (l'entreprise garde le sien, l'écran le dit). Un matricule
  déjà porté par une autre entreprise se refuse en le disant (« relis-le sur ta carte d'identification fiscale. Rien
  n'a été enregistré ») ; le refus du cabinet (brique 57) parle de mandat, celui-ci parle à un commerçant. Seuls le
  propriétaire et un administrateur les changent (la base le redit). **Ne suivent pas** : l'entreprise d'essai (l'exemple
  y écrit une fiche inventée) et un dossier tenu par un cabinet (son associé les corrige, brique 57).
- **D7. Le taux de retenue d'une pièce émise se compare tel que la v10 le relit** (`serveur/v10/dossier.ts`,
  `scellee`) : « 1 », 1 et { "~n": "1" } sont le même taux ; un autre taux reste refusé. Et la page émet désormais le
  taux en nombre (`issue`), comme elle le relira.
- **Les détails** : « d'octobre », « d'avril », « d'août » ; le menu d'une ligne dit ce que fait son geste ici (« Voir
  la facture émise et ses paiements » ; une facture ou un avoir émis part avec son lien ; le reste part sans pièce
  jointe, le PDF s'enregistre à part ; l'application de bureau garde ses phrases) ; l'espace client écrit « Reste à
  payer : 128,373 DT · Payé : 100,000 DT » (et les avoirs).

## Vérifié sur le serveur d'essai (05/10/2026)

Le lot installé sur app.skanfact.tn (données fictives), le parcours refait à la souris : l'exemple versé puis la visite,
« Faire une facture », la sortie vers une vraie entreprise, les avertissements précis, « Compléter ma fiche… », la
facture émise avec son RIB. Trois défauts de plus, corrigés dans l'envoi suivant :

- **E1. Une réponse qui ne vient pas du serveur s'affichait telle quelle.** Le versement de l'exemple prend une minute ;
  un relais sur le chemin (celui de notre poste de travail ; demain le proxy d'une entreprise, un opérateur mobile)
  a coupé la demande et renvoyé « upstream request timeout ». La page l'a lu comme du JSON et a affiché « Unexpected
  token 'u', "upstream r"… is not valid JSON ». Maintenant, aux trois portes (l'entreprise, `plateforme/pont.js` ; le
  Cabinet, `plateforme/pont-cabinet.js` ; les écrans d'entrée, `web/src/api.ts`), une réponse qui n'est pas du serveur
  (un texte, une page HTML, un 502, 503 ou 504 vide) se dit « Le serveur n'a pas répondu à temps : réessaie dans un
  instant. » (aux écrans d'entrée : « le serveur ne répond pas »), jamais par son texte. L'exemple, lui, redemande
  (jusqu'à quatre fois, une seconde et demie d'écart) : le serveur va au bout du versement, la demande suivante attend
  sa fin puis le trouve fait, et la page s'ouvre sur la visite ; coupé à chaque fois, il le dit : « La connexion au
  serveur a coupé avant la fin : rouvre la page dans une minute ; si l'exemple n'y est pas, recommence. »
- **E2. Le matricule s'imprimait tel qu'il avait été tapé** (« 1357913 b / a / m / 000 »), en tête de la facture comme
  au pied. Chaque pièce imprimée l'écrit désormais sous la forme que le serveur garde (1357913B/A/M/000) : la facture,
  le devis et l'avoir (en tête, au pied, et le matricule du client), le ticket de caisse, le bulletin de paie,
  l'attestation et le certificat de travail, le solde de tout compte, le relevé de compte, la page de garde du paquet.
  Ce qui n'est pas un matricule (une carte d'identité, un identifiant étranger) reste tel quel. La fenêtre « Compléter
  ma fiche » enregistre aussi la forme lisible.
- **E3. La lettre-clé I, O ou U passait à l'écran et au serveur**, puis le fichier El Fatoora la refusait (la règle de
  `teif.js`). L'écran (`core.js`), le serveur (`serveur/v10/identite.ts`) et le fichier disent maintenant la même chose,
  et les messages le disent : « sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et
  établissement ».

Et le rouge de GitHub sur cet envoi : deux preuves anciennes (la ligne lue sous les champs d'une facture photographiée,
la case du lien d'un e-mail) posaient un défaut qui cassait la syntaxe de l'écran ; elles « prouvaient » en faisant
tomber la page entière. Depuis que la construction lit chaque écran (L6, `web/alleger.ts`), elle refuse le fichier et
le test ne tourne plus : la preuve restait verte. Les deux sont réécrites en vrais défauts, et le contrôle éclair
(`tests/verif-preuves.sh`) refuse désormais toute preuve dont le défaut casse la syntaxe d'un écran (« SYNTAXE
CASSÉE ») : il relit, comme le navigateur, la plus petite fonction qui contient le défaut (cinq secondes pour les
2 363 preuves).

## Ce qui reste (À FAIRE)

- **E4. La même règle à toutes les entrées du matricule** (vu en corrigeant E3) : la porte (« Créer mon entreprise »,
  `POST /entreprises`), le dossier tenu d'un cabinet (création et correction) et la reprise d'un portefeuille acceptent
  encore la lettre-clé I, O ou U, et gardent le matricule tel qu'il est écrit, avec ou sans barres. Or l'unicité (un
  matricule, une seule entreprise active : D6) compare les textes : 1234567AAM000 et 1234567A/A/M/000 peuvent coexister.
  À faire au lot suivant : la forme lisible du serveur (`matriculeCanonique`) aux trois entrées, et les matricules déjà
  gardés remis sous cette forme.

- **Un devis envoyé part sans pièce jointe** : il n'a pas de lien dans l'espace client (seules les factures et les
  avoirs émis en ont). À faire avec la brique « les devis dans l'espace client » (déjà proposée à Skander).
- **Les PDF faits par le serveur** : un navigateur ne joint pas de PDF à un e-mail ; le serveur devra fabriquer le PDF
  d'une pièce pour l'envoyer lui-même.
- **Une facture émise avant la fiche complétée** garde, dans sa copie figée, l'identité du jour de son émission (sans
  matricule) ; la réimpression lit la fiche du jour. **À VÉRIFIER avec un comptable** : faut-il annuler une facture
  émise sans matricule par un avoir et la refaire ?
- **Un matricule déjà pris, écrit dans Paramètres → Mon entreprise**, fait refuser chaque enregistrement de la fiche
  tant qu'il n'est pas corrigé (le motif dit pourquoi) ; la fenêtre « Compléter ma fiche » le dit sous le champ, mais
  Paramètres pas encore : le contrôle du champ dans Paramètres est à faire.
- **La forme du matricule** (sept chiffres, une lettre, trois codes) est celle de la carte d'identification fiscale ;
  les valeurs permises de chaque code (TVA, catégorie) ne sont pas contrôlées : **À VÉRIFIER**.

## Ce qui le prouve

- `tests/v10/identite.test.ts` : le nom et le matricule écrits dans la fiche deviennent ceux de l'entreprise, sous leur
  forme lisible (« 2718281 a / b / m / 000 » → 2718281A/B/M/000), la trace le dit, et la facture suivante les fige ;
  un matricule mal formé ne se porte pas ; celui d'une autre entreprise se refuse en le disant, et rien n'est écrit ;
  l'entreprise d'essai garde les siens.
- `tests/v10/matricule.test.ts` : l'écran (`matriculeBienForme`) et le serveur (`matriculeCanonique`) disent la même
  chose de dix-neuf matricules écrits comme on les recopie (dont la lettre-clé I, O ou U), et les écrivent pareil sous
  leur forme lisible ; la fiche nomme un matricule mal formé comme un matricule absent ; chaque pièce imprimée (facture,
  ticket, bulletin, attestation, certificat, solde de tout compte, relevé, page de garde du paquet) porte les
  matricules sous leur forme lisible, nulle part tels qu'ils ont été tapés (E2).
- `tests/v10/pont-exemple.test.ts` et `tests/v10/reponse-coupee.test.ts` (E1) : une réponse coupée en route, l'exemple
  redemande et s'ouvre sur la visite ; coupée à chaque fois, une phrase qui dit quoi faire ; aux trois portes, une
  réponse qui ne vient pas du serveur (504 « upstream request timeout », une page HTML, un 503 vide) ne s'affiche
  jamais telle quelle, et un vrai refus garde sa phrase.
- `tests/v10/dossier.test.ts` : une facture émise avec la retenue en texte reste la même une fois relue en nombre (ses
  règlements s'enregistrent), un autre taux non.
- `tests/web/facture-details.test.ts` (à la souris) : Samia, sans matricule ni RIB : l'aperçu sans « MF » et le tampon
  qui ne couvre ni l'en-tête, ni le client et l'objet (pâle, multiplié) ; les avertissements et « Compléter ma fiche… » ; un matricule mal formé, puis
  celui d'une autre entreprise, refusés sous leur champ sans rien écrire ; la fiche complétée, la fenêtre qui se relit ;
  la facture émise avec son matricule (tapé « 1357913 b a m 000 », imprimé 1357913B/A/M/000 en tête et au pied, gardé
  ainsi dans la fiche) et son RIB, son taux en nombre ; « d'août », « d'octobre » ; le menu ; l'espace client ; un refus
  du serveur qui reste à l'écran. Photos : `dist/photos/facture-details-*.png`.
- Les preuves de `tests/preuves.sh`, sections « Le lot facture » et « Vu sur le serveur d'essai après le lot facture » :
  chaque correction, défaut remis, fait tomber son test.
- **Les tests partagent une base** : depuis D6, un matricule n'y est celui que d'une entreprise à la fois. Un test qui
  donne un matricule à son entreprise en prend un à lui ; celui que lui impose ce qu'il rejoue (celui de Nadia, imprimé
  sur les factures photographiées et connu de la TTN simulée ; celui de la quincaillerie) se reprend d'abord à
  l'entreprise d'un test précédent (`tests/matricule-libre.ts`). Vu en rejouant toute la suite dans une seule base :
  sept fichiers tombaient (six qui écrivent une fiche société, un qui crée un dossier avec le matricule de Nadia).
