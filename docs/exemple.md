# L'exemple rempli, et « Faire une facture » pas à pas

*Retour de Skander du 05/10/2026, corrigé d'un envoi. Ce document dit ce qui n'allait pas, ce qui se passe maintenant,
pourquoi, et ce qui le prouve.*

## Le retour

Skander, sur un compte neuf, sur app.skanfact.tn : « le jeu d'exemple ne marche pas, il me dit tu es déjà dans
l'exemple mais il n'y a rien dessus afin de faire la visite guidée, et l'assistant de remplissage (guide) ne guide pas
pour une facture, il le fait pour un devis ».

## Ce qui se passait

- **L'exemple était vide.** Sur la plateforme, l'exemple est l'entreprise d'essai (jamais une pièce inventée dans une
  vraie entreprise). Elle ne contenait que trois clients. La découverte de la v10 (« Découvrir SkanFact avec un
  exemple ») est écrite pour l'exemple de cinq ans de la v10 : elle n'avait rien à montrer, et « Charger l'exemple »
  répondait seulement « Tu es dans ton entreprise d'essai : c'est elle, l'exemple ».
- **« Guide-moi » sur une facture ne proposait rien à faire.** La v10 a une visite « Faire un devis » pas à pas, mais
  pas de « Faire une facture » : sur une nouvelle facture, « Guide-moi » ne proposait que la visite de la page.
- En refaisant la découverte en entier sur un exemple rempli, on a trouvé en plus : une bulle perdue (« Les mises à
  jour », dont le panneau n'existe pas en ligne), cinq bulles qui décrivaient l'application de bureau (l'exemple qui
  « rend tes données », le paquet du comptable, ses réponses « dans le paquet du mois », sa clôture par fichier, la
  copie vers une clé USB), une fin qui parlait de licence, neuf visites de « Guide-moi » qui attendaient un panneau
  absent en ligne, et, dans Paramètres → Données et sécurité, cinq puces du sommaire qui menaient à des panneaux cachés.

## Ce qui se passe maintenant

### L'exemple, versé par le serveur (`serveur/v10/exemple.ts`, `POST /entreprises/{id}/exemple`)

- Le serveur remplit l'entreprise d'essai du **jeu de la v10** (le même code que les écrans : `demo.js`), au jour du
  versement : clients, devis, factures, avoirs, achats, paie, trésorerie, clôtures.
- Les **factures et les avoirs émis sont émis par le serveur**, un à un, dans l'ordre de leurs dates : numérotés dans
  la série de l'entreprise, sans trou dans chaque année, au millime de la v10, scellés et chaînés comme une vraie
  facture ; leurs règlements sont ensuite tenus comme ceux d'une vraie facture. Le reste s'écrit comme un
  enregistrement de l'écran, et ses suivis jouent (achats, paie, écritures).
- Le **timbre** des années de l'exemple d'avant la règle commune (2023) vient d'une règle de **cette** entreprise,
  datée jusqu'à la veille de la règle commune (motif : « Le timbre de l'exemple, dans l'entreprise d'essai »).
- Il ne se verse **qu'une fois** (une seconde demande ne fait rien), **jamais dans une vraie entreprise**, **jamais dans
  une entreprise d'essai qui a déjà ses propres pièces** (ses numéros suivraient les tiens, ses relances parleraient de
  tes clients), jamais chez un autre. Chaque refus dit pourquoi et que rien n'a été fait.
- Le dossier se lit verrouillé pendant le versement : un enregistrement de la page parti au même moment attend la fin
  au lieu de le faire échouer. Défense en plus : la page attend son propre enregistrement en cours avant de demander,
  et redemande une fois après un conflit.

### À l'écran (`web/v10/exemple.txt`, `pont.js`, `Porte.tsx`)

- **La porte** : « Commencer la découverte » crée l'entreprise d'essai et l'ouvre ; une fenêtre « L'exemple se
  prépare » dit d'attendre une minute ; la page s'ouvre toute seule sur l'exemple, et la découverte démarre.
- **Depuis une vraie entreprise** : Paramètres → Données et sécurité → « Ouvrir l'exemple » ouvre l'entreprise
  d'essai (remplie au besoin), sans rien écrire dans la vraie.
- **La fin de la découverte** : « Passer à ma vraie entreprise » ouvre ta vraie entreprise ; sans elle encore, une
  fenêtre demande sa raison sociale (« Créer et ouvrir »), et la visite « Démarrer dans ma vraie entreprise » y démarre.
  Une fenêtre fermée sans créer ne laisse aucune visite en attente. Le bandeau « Quitter l'exemple » fait de même,
  sans visite.
- **« Faire une facture »**, pas à pas, comme « Faire un devis » : du client (créé depuis la liste s'il n'existe pas) à
  « Enregistrer le brouillon », en passant par la date, l'échéance, l'objet, le brouillon sans numéro, la remise, la
  retenue à la source, le timbre, les lignes, la TVA, les totaux, les notes et l'aperçu (25 étapes, 5 min). « Guide-moi »
  la propose sur une nouvelle facture ; à la fin, « Émettre une facture » et « Envoyer » la suivent.
- **« Guide-moi » en ligne** ne propose plus les visites sans objet ici (`visitesAbsentes`, au point de contact) :
  les sauvegardes, revenir à une sauvegarde, les fichiers de l'ordinateur, les mises à jour, la licence, le dossier
  partagé entre deux ordinateurs, la clôture reçue en fichier ; ni celles d'un geste pas encore en ligne, qui
  reviennent avec leur brique : joindre un justificatif, signaler un problème avec le journal de l'ordinateur.
- **La découverte** dit ce qui est vrai en ligne : « Quitter l'exemple » ouvre ta vraie entreprise ; ton cabinet tient
  tes livres ici même ; il lit ta réponse dès que tu l'enregistres ; tes données vivent sur le serveur (ce qui se règle
  ici, ce sont tes appareils) ; les mises à jour se font sur le serveur (la version se lit au pied du menu) ; et, à la
  fin, abonnement réglé ou pas, tu gardes la lecture, l'impression et l'export (`docs/cadrage/00`, « Payer mon
  abonnement » : sans paiement, lecture seule). L'étape des pièces jointes du devis se saute quand le panneau n'est pas là.
- **Paramètres** : la puce du sommaire et le résultat de recherche d'un panneau absent en ligne se cachent avec lui.

## Ce qui reste (À FAIRE)

- **Une entreprise d'essai déjà utilisée ne reçoit pas l'exemple.** Il faudra un geste « recommencer mon entreprise
  d'essai » (effacer ses pièces, ou en ouvrir une neuve) : à décider.
- **L'exemple vieillit** : il est daté du jour du versement. La v10 le refaisait sur le mois en cours ; en ligne, ses
  factures sont émises et scellées : on ne les réécrit pas. À décider avec le geste précédent.
- La progression des visites (« faite ») vit sur l'appareil, comme dans la v10 : deux comptes sur le même navigateur
  la partagent.
- Le versement prend environ une minute sur le serveur d'essai ; il bloque le dossier de l'entreprise d'essai pendant
  ce temps (pas les autres).

## Ce qui le prouve

- `tests/v10/exemple.test.ts` (serveur) : le jeu entier, les factures émises par le serveur au millime de la v10,
  numérotées sans trou par série et par année, les règlements tenus, les achats et les bulletins suivis, une seule
  fois ; jamais dans une vraie entreprise, ni dans une entreprise d'essai déjà essayée, ni chez un autre, et un refus
  n'écrit rien.
- `tests/v10/pont-exemple.test.ts` (le point de contact devant un serveur imité) : depuis une vraie entreprise, rien ne
  se verse ; pas deux fois ; la fenêtre d'attente, le rechargement sur la visite, le conflit redemandé une fois ; un
  refus lu en entier ; l'entreprise d'essai créée au besoin, et une création refusée qui ne laisse aucune visite en
  attente ; quitter l'exemple avec ou sans vraie entreprise, et la visite qui part avec l'entreprise créée.
- `tests/v10/visites-en-ligne.test.ts` : aucune visite proposée en ligne n'attend un élément absent ; la découverte ne
  décrit pas l'application de bureau.
- `tests/web/exemple.test.ts` (à la souris, un compte neuf) : la porte, l'exemple qui se prépare puis s'ouvre, la
  découverte jusqu'au bout sans bulle perdue, la vraie entreprise créée et ses premiers pas, « Faire une facture »
  jusqu'au brouillon (12 × 18,750 à 19 %, timbre 1,000 → 268,750 DT), « Me guider » sans les visites absentes, les puces
  des Paramètres, « Ouvrir l'exemple » qui ramène à l'exemple sans rien reverser ni rien écrire dans la vraie.
- `tests/web/parcours.test.ts` : le premier parcours commence maintenant par « Commencer avec mon entreprise » ; les
  réglages de l'ordinateur et leurs puces n'apparaissent pas.
- Les preuves de `tests/preuves.sh`, section « L'exemple rempli, et « Faire une facture » pas à pas » : chaque
  correction, défaut remis, fait tomber son test.
