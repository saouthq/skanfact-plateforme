# Le téléphone et la tablette du comptoir

La mise en page du téléphone vit dans `web/public/plateforme/telephone.css` et `telephone.js` (briques 105 à 110 : la
barre du haut et son « Menu », la taille du doigt, les lignes d'une pièce, le Cabinet) ; celle de la caisse dans
`web/public/plateforme/caisse.css`. Elles ne changent rien au-delà de 760 points, sauf la taille du doigt sur un écran
tactile (`pointer: coarse`). Ce que l'écran doit porter pour elles passe par les adaptations de la v10
(`web/v10/telephone.txt`, `petit-ecran.txt`, `telephone-commercant.txt`).

## Le lot téléphone (06/10/2026)

Le parcours d'un commerçant tunisien, au téléphone (390 × 844, au doigt), sur le serveur d'essai, avec un compte
fictif : entrer, l'accueil, un client, un devis puis son envoi par WhatsApp, une facture émise et réglée, la photo
d'une facture d'achat (lue, fournisseur créé, achat enregistré), les listes, les relances ; puis la caisse sur la
tablette du comptoir (1 180 × 820) et sur un écran tactile de 1 024 × 768 (vendre, rendre la monnaie, le Z). Ce qui
gênait, et ce qui a changé :

| Vu | Changé |
|---|---|
| Les listes (factures, clients, devis, documents récents) : statut, montant et reste dû coupés à droite ; il fallait deviner qu'on fait glisser le tableau ; un client sur un mot par ligne | Au téléphone, une liste d'au moins quatre colonnes devient des **cartes** : ce qui nomme la ligne en haut, puis chaque case sous le titre de sa colonne, sur deux colonnes ; « Actions » en haut à droite ; les titres qui trient restent, en pastilles sur une rangée qui défile. `telephone.js` n'écrit que des attributs (`data-cartes`, `data-label`, `data-tel`) et les réécrit quand la liste se redessine ; les mêmes cases, les mêmes gestes |
| Une fenêtre longue (nouveau client, nouveau fournisseur, ce que SkanFact a lu) : « Enregistrer » au bout, à 1 161 points sur un écran de 844 | Ses boutons restent au bas de l'écran pendant qu'on la parcourt ; ils se partagent la rangée, « * obligatoire » passe au-dessus |
| « Plus ▾ » sortait de l'écran par la gauche quand son bouton était à gauche | Au téléphone, il s'ouvre au bas de l'écran, sur toute sa largeur (comme « Facturer ▾ », « Transformer ▾ ») |
| La barre d'une page : des boutons seuls au bord d'une rangée ; l'étape suivante au milieu | Chaque rangée se remplit ; le bouton principal (l'étape suivante) passe en tête, sur toute la largeur |
| WhatsApp caché dans « Plus ▾ », Email au premier plan | Au téléphone, « WhatsApp » se montre à côté d'« Email », et envoie de la même façon ; à l'ordinateur, rien ne change |
| Des bulles « i » seules sur leur ligne (barre d'un achat, sous les filtres) ; celle de « Lire une photo… » visible quand le bouton est caché | Une bulle part avec son bouton ou sa case ; celle d'un bouton caché se cache avec lui (partout) |
| Les lignes d'un achat et d'une photo relue : prix, TVA et total cachés à droite | Elles se rangent comme les lignes d'une pièce : la désignation sur toute la largeur, les chiffres dessous |
| Le bandeau d'une pièce émise prenait la moitié de l'écran | Au téléphone : la phrase, sa bulle (qui dit le pourquoi) et « Corriger par un avoir… » |
| À la première émission, « Je facturais déjà : continuer ma numérotation » sortait de la fenêtre | Un bouton d'une fenêtre passe à la ligne |
| « les 1 dernières pièces sur 1 » (accueil) | « ta seule pièce », « tes 4 pièces », « la dernière pièce sur 12 » |
| « Ctrl K » dans la recherche du menu, au téléphone | Un raccourci de clavier ne se montre pas au doigt |
| « glisse-le ensuite dans la conversation » (le PDF d'un devis, par WhatsApp) | « joins-le ensuite à la conversation » : un geste du téléphone comme de l'ordinateur |
| Caisse à 1 180 points : la pastille « Ouverte par … · fond 53,400 D » tranchée | Entre 1 101 et 1 340 points : « Ouverte · fond … » (qui et quand dans sa bulle), « ‹ Vente », le nom de l'entreprise se tait ; s'il manque encore de place, « … » |
| Comptage du tiroir à 1 180 : « billets » / « pièces » tranchés par la case du nombre | Une colonne trop étroite ne dit pas le mot (la forme de la coupure et le titre le disent) |
| Comptage à 1 024 × 768 : la phrase sous le pavé passait sous « Fermer la caisse et faire le Z » | Sur un écran de 820 points de haut ou moins, le panneau se resserre et tient |

Vu et juste : la lecture de la photo (total recompté), le fournisseur créé depuis la lecture, l'achat enregistré, le
devis, le règlement, la virgule tapée (`virgule.js`), la caisse (vente, monnaie rendue, Z juste).

**Pas dans ce lot** : un devis envoyé par WhatsApp dit « Veuillez trouver ci-joint » sans rien de joint ni de lien,
parce que le devis n'est pas encore dans l'espace client (le lot suivant : « le devis par son lien »). Le bouton
« PDF » ouvre l'impression du navigateur ; un PDF fait par le serveur, à partager depuis le téléphone, reste à faire.
**À VÉRIFIER** sur de vrais téléphones (Android, iPhone) : l'impression en PDF depuis le bouton « PDF », et la feuille
« Plus ▾ » sous le clavier ouvert.

**Tests** : `tests/web/telephone-commercant.test.ts` (au doigt : les listes en cartes et à l'ordinateur en tableau ;
la fenêtre longue et « Plus ▾ » ; une pièce : l'étape suivante, WhatsApp, les bulles, le bandeau ; les lignes d'un
achat et d'une photo relue ; la première émission, « Ctrl K », « ta seule pièce » ; la caisse à 1 180 × 820 et
1 024 × 768). `tests/web/livraisons.test.ts` (le panneau des livraisons en cartes), `tests/web/envois.test.ts`
(« joins-le »). L'instrument de rendu (`tests/web/rendu.test.ts`, `cabinet-telephone.test.ts`) passe toutes les pages
du quotidien avec les cartes. 24 preuves nouvelles, 4 reciblées (`tests/preuves.sh`, section « Le lot téléphone »).
