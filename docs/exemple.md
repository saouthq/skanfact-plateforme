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
- **Une réponse coupée en route** (vu sur le serveur d'essai le 05/10/2026 : un relais a coupé la demande d'une minute
  et l'écran a montré « Unexpected token 'u'… is not valid JSON ») : le serveur, lui, va au bout du versement. L'écran
  « On prépare l'exemple » redemande, jusqu'à quatre fois : la demande suivante attend la fin du versement (le dossier
  est verrouillé), le trouve fait, et l'exemple s'ouvre. Coupée à chaque fois, l'écran le dit : « La connexion au
  serveur a coupé avant la fin : réessaie, ce qui est déjà fait est gardé », avec « Réessayer » (docs/facture-details.md,
  E1).

### À l'écran (lot onboarding, 09/10/2026 : `ExemplePrepare.tsx`, `EntrepriseNeuve.tsx`, `pont.js`, `web/v10/exemple.txt`)

Vu sur le serveur d'essai le 09/10/2026 : choisir l'exemple ouvrait une page blanche, puis l'accueil d'une entreprise
vide sous une fenêtre « L'exemple se prépare » qui durait une minute ; « Quitter l'exemple », sans vraie entreprise,
ouvrait une petite fenêtre à un seul champ. Les deux ont maintenant leur page, au dessin de l'entrée (maquettes validées
par Skander le 09/10/2026).

- **« On prépare l'exemple »** (`/?exemple=<visite>`) : la porte (« Commencer la découverte »), « Voir un exemple »,
  « Ouvrir l'exemple » des Paramètres et une visite qui se joue sur l'exemple y mènent. L'écran crée l'entreprise
  d'essai s'il le faut, demande au serveur de la remplir, et coche ce qui est vraiment fait : ton compte, puis les cinq
  ans d'activité, puis la visite, qui part d'un bouton (« Commencer la visite » ; « Ouvrir l'exemple » quand on ne
  demande que l'exemple). Un exemple déjà là ne fait pas attendre : l'entreprise d'essai s'ouvre aussitôt.
- **Une réponse coupée** (un relais qui coupe, avec son texte ou sans un mot) se redemande, quatre fois ; un
  enregistrement qui croise le versement (un conflit), deux fois. Coupée à chaque fois : « Réessayer ». Un refus se lit
  en entier ; celui d'une entreprise d'essai qui a déjà ses pièces propose de l'ouvrir telle quelle. Une préparation
  abandonnée (l'écran quitté, « Réessayer ») s'arrête à sa prochaine étape : jamais deux qui demandent le versement en
  même temps.
- **Une entreprise d'essai encore vide** (sa préparation coupée, l'onglet fermé pendant la minute) ne s'ouvre plus sur
  un accueil vide : la page repart vers « On prépare l'exemple », la visite demandée avec elle. Celle qui a ses propres
  pièces, ou que l'on a choisi d'ouvrir telle quelle, s'ouvre sans repasser par là, et sans premiers pas : ce n'est
  pas la vraie entreprise.
- **Le bandeau de l'exemple** : tant que le compte n'a pas de vraie entreprise, son bouton dit « Créer ma vraie
  entreprise » ; ensuite, « Quitter l'exemple ».
- **« Ta vraie entreprise »** (`/?entreprise=exemple&retour=…`) : la même page que « Ton entreprise » de la porte (la
  raison sociale, le matricule, le haut de la facture qui se dessine pendant la frappe ; `composants/Fiche.tsx`), avec
  « Revenir à l'exemple ». Créée, elle s'ouvre sur l'assistant de démarrage, puis la visite demandée y démarre
  (« Passer à ma vraie entreprise », à la fin de la découverte : « Tes premiers pas »). La visite voyage dans
  l'adresse : quitter la page sans créer ne laisse rien en attente.
- **« Nouvelle entreprise… »** (le menu des entreprises) mène à la même page, « Une nouvelle entreprise », avec
  « Revenir à l'entreprise ouverte ». **« Le groupe »** ne s'y offre qu'avec deux vraies sociétés : l'exemple n'en est
  pas une. « Gérer les dossiers… » n'y est plus : son panneau (les dossiers de l'ordinateur) n'existe pas en ligne, et
  le bouton ne menait nulle part (vu le 09/10/2026).
- **Une entreprise que ce compte n'a pas** (une adresse venue d'ailleurs, un autre compte sur le même navigateur) :
  « Cette entreprise ne t'est pas ouverte : ton compte ne fait pas partie de son équipe, ou elle n'existe pas. », sans
  parler d'un retrait qui n'a pas eu lieu (vu le 09/10/2026).
- **« Confier mon dossier à mon comptable »** remplace « Relier mon comptable » (son adresse et son fichier
  d'appairage, pour des paquets qui n'existent plus en ligne) : Comptabilité → Cabinet, le code de son cabinet, ce que
  tu lui confies, et « Confier mon dossier » ; « Me guider » la propose sur l'étape « Invite ton comptable » des premiers
  pas. « Envoyer le mois à mon comptable » (le paquet) n'est plus proposée.
- **« Faire une facture »**, pas à pas, comme « Faire un devis » : du client (créé depuis la liste s'il n'existe pas) à
  « Enregistrer le brouillon », en passant par la date, l'échéance, l'objet, le brouillon sans numéro, la remise, la
  retenue à la source, le timbre, les lignes, la TVA, les totaux, les notes et l'aperçu (25 étapes, 5 min). « Guide-moi »
  la propose sur une nouvelle facture ; à la fin, « Émettre une facture » et « Envoyer » la suivent.
- **« Guide-moi » en ligne** ne propose plus les visites sans objet ici (`visitesAbsentes`, au point de contact) :
  les sauvegardes, revenir à une sauvegarde, les fichiers de l'ordinateur, les mises à jour, la licence, le dossier
  partagé entre deux ordinateurs, la clôture reçue en fichier ; ni celles d'un geste pas encore en ligne, qui
  reviennent avec leur brique : joindre un justificatif, signaler un problème avec le journal de l'ordinateur.
- **La découverte** dit ce qui est vrai en ligne : le bouton du bandeau mène à ta vraie entreprise (« Quitter
  l'exemple » l'ouvre, « Créer ma vraie entreprise » la crée) ; ton cabinet tient
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
- `tests/v10/pont-exemple.test.ts` (le point de contact devant un serveur imité) : l'exemple déjà là s'ouvre tel quel ;
  ailleurs, la page part vers « On prépare l'exemple », la visite dans son adresse, sans rien créer ni verser d'ici ;
  l'entreprise d'essai vide y repart (la visite avec elle), celle qui a ses pièces s'ouvre telle quelle, et une vraie
  entreprise au travail ne fait pas lire le compte ; le bandeau sait s'il y a une vraie entreprise ; quitter l'exemple,
  avec ou sans elle (la page qui la crée, et rien qui attende avant) ; « Nouvelle entreprise… » ; le menu qui sait
  laquelle est l'entreprise d'essai ; le compte lu une fois pour un même instant, et pas gardé après un échec.
- `tests/v10/visites-en-ligne.test.ts` : aucune visite proposée en ligne n'attend un élément absent ; la découverte ne
  décrit pas l'application de bureau ; « Confier mon dossier à mon comptable » ne vise que le panneau du mandat, et le
  paquet du mois n'est plus proposé.
- `tests/v10/premiers-pas.test.ts` : jamais de premiers pas dans une entreprise d'essai, même essayée sans l'exemple.
- `tests/web/exemple.test.ts` (à la souris, un compte neuf) : la porte, « On prépare l'exemple » (une première réponse
  coupée par un relais se redemande, jamais son texte), « Commencer la visite », le bandeau « Créer ma vraie
  entreprise », la découverte jusqu'au bout sans bulle perdue, « Ta vraie entreprise » et ses premiers pas, pas de
  « groupe » avec l'exemple seul, « Faire une facture » jusqu'au brouillon (12 × 18,750 à 19 %, timbre 1,000 →
  268,750 DT), « Me guider » sans les visites absentes, les puces des Paramètres, « Ouvrir l'exemple » qui ramène à
  l'exemple aussitôt, sans rien reverser ni rien écrire dans la vraie, son bandeau disant alors « Quitter l'exemple ».
- `tests/web/exemple-puis-vraie.test.ts` (à la souris, sans attendre le versement) : l'entreprise d'essai vide qui
  repart vers sa préparation, coupée (avec ou sans le texte du relais), le conflit redemandé, le refus lu, « telle
  quelle » ; celle qui a ses pièces ; une entreprise d'un autre compte ; « Nouvelle entreprise… », son lien de retour,
  l'assistant, « Le groupe » à deux vraies sociétés, pas de « Gérer les dossiers… » ; l'exemple déjà là, son bandeau, « Ta vraie entreprise » et son
  lien de retour, et « Confier mon dossier à mon comptable » lancée depuis l'exemple, qui démarre dans l'entreprise
  créée, après l'assistant.
- `tests/web/parcours.test.ts` : le premier parcours commence maintenant par « Commencer avec mon entreprise » ; les
  réglages de l'ordinateur et leurs puces n'apparaissent pas.
- Les preuves de `tests/preuves.sh`, section « L'exemple rempli, et « Faire une facture » pas à pas » : chaque
  correction, défaut remis, fait tomber son test.
