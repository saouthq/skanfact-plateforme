# La revue de la messagerie entre l'entreprise et son cabinet (22/10/2026)

*Demandée par Skander le 22/10/2026 : « en tant que développeur designer UI/UX, vérifier le pont entre entreprise et
cabinet pour la messagerie, si c'est pratique, comment les deux parlent ensemble, si c'est ergonomique et si c'est ce qui
se fait dans d'autres boîtes. Il faut que ce soit parfait. » Faite à la souris sur l'écran virtuel (1440×900), version
1.114.1, données inventées : Amine (Gharbi Informatique SARL), son comptable Sonia (Cabinet Ben Youssef), et une seconde
cliente (Boulangerie du Lac) ; puis au téléphone (390 px). Le fonctionnement : `docs/messagerie.md`.*

## Le verdict

**La base est bonne, au niveau des meilleurs sur le fond** : un seul fil par entreprise et par cabinet, en style
messagerie ; les questions de la révision et les pièces demandées arrivent DANS le fil et se répondent sur place ;
« En attente de toi » dit au client ce qu'on attend de lui ; la boîte du cabinet range ses clients en « À traiter »,
« Attend le client », « Tout » (la logique de Karbon) ; l'alerte par e-mail ne dit rien du contenu ; « Lue » sous ses
messages ; « Parler d'une pièce » joint une facture ou un achat du dossier. Tout ce qui a été essayé a marché.

**Mais ce n'est pas encore « parfait »** : cinq défauts gênent vraiment au quotidien (ci-dessous, P1), et il manque ce que
les outils des cabinets font tous pour la fin de mois : une date limite et des relances automatiques sur les pièces
demandées, et la demande groupée (P2).

## P1 — ce qui gêne vraiment (à corriger d'abord)

1. **Entreprise : « Mon comptable » est caché.** Il est tout en bas du menu, sous « Acheter » et « Piloter » : à
   l'ouverture (900 px de haut), il est hors de l'écran ; la pastille « 2 » ne se voit qu'en faisant défiler le menu.
   *À faire* : un bouton « Messages » permanent en haut de l'écran (icône et pastille), et « Mon comptable » dans la
   partie fixe du bas du menu (avec Paramètres et Aide).
2. **Cabinet : deux étapes pour lire un message.** La boîte montre la liste ; un clic montre un aperçu (le dernier
   message seulement) ; il faut encore « Ouvrir la conversation », qui change de page. Les outils du métier (Karbon,
   Front, et toute messagerie) ouvrent la conversation entière à droite de la liste, d'un clic, et passent au client
   suivant au clavier. *À faire* : liste à gauche, conversation complète à droite, ↑/↓ pour passer d'un client à l'autre.
3. **Téléphone : le champ d'écriture et « Envoyer » sont sous l'écran.** Il faut faire défiler toute la conversation
   pour écrire. *À faire* : la zone d'écriture collée en bas de l'écran, comme WhatsApp ; le fil défile au-dessus.
4. **La pièce demandée part sans confirmation, et ne peut pas venir des achats.** « Envoyer la pièce… » ouvre le choix
   du fichier et l'envoie dès qu'il est choisi : pas d'aperçu, pas d'« Annuler » (un mauvais fichier part chez le
   comptable). Et le client ne peut pas répondre avec une pièce déjà saisie : « La facture STEG d'août » était déjà
   dans ses achats (F-8841), il a dû renvoyer un fichier. *À faire* : une petite fenêtre « Envoyer la pièce » : une
   photo ou un PDF (avec aperçu et un mot facultatif), **ou** « Elle est déjà dans mes achats » (choisir la pièce, sa
   photo jointe part avec).
5. **Le fil est trop petit sur ordinateur.** Il fait 400 px de haut, la page a de la place vide en dessous, et le début
   d'une carte est coupé en haut. *À faire* : le fil prend toute la hauteur de l'écran ; la zone d'écriture reste en bas.

## P2 — ce que font les autres et qui nous manque (le métier des cabinets)

6. **Une date limite et des relances automatiques sur les pièces demandées.** Karbon : une demande a une échéance ;
   relance douce 7 jours avant, le jour même, puis chaque jour en retard, cinq relances au plus. Pennylane : rappels
   automatiques le 1er et le 15 du mois, et un tableau des pièces reçues, en attente, à valider. Chez nous, une pièce
   demandée attend sans date et sans relance (seule l'alerte « un message t'attend » part, une fois). *Proposition* :
   « pour le … » sur chaque demande, relance automatique (une par semaine, trois au plus, réglable), le retard visible
   des deux côtés, et dans la boîte du cabinet.
7. **La demande groupée.** Plusieurs pièces en une fois (une liste à cocher : relevé BIAT de septembre, facture STEG,
   facture Ooredoo), et la même demande à plusieurs clients en fin de mois (les relevés bancaires) : Pennylane a les
   demandes récurrentes. *Proposition* : « Demander des pièces » = une liste ; « Demande du mois » envoyée à tous les
   clients choisis.
8. **Le cabinet ne peut pas agir sur ce qu'il reçoit.** Une pièce citée (« Achat F-8841 ») n'a pas « Ouvrir » côté
   cabinet (elle l'a côté entreprise) ; une photo reçue n'a que « Ouvrir » et « Enregistrer », pas « Saisir cette
   pièce » vers le brouillard. *À faire* : ouvrir la pièce dans les livres du client ; « Saisir cette pièce » depuis le
   message.
9. **Des modèles de messages** pour le cabinet (« Il me manque les pièces de … », « Ta déclaration est déposée ») :
   un comptable écrit les mêmes phrases à soixante clients.
10. **Chercher.** Dans la boîte (un client par son nom) et dans un fil (« STEG »).
11. **La liste des dossiers ignore les messages.** Une ligne de client ne dit pas qu'il a écrit ; la pastille n'est que
    dans le menu « Messages ». *À faire* : la pastille sur la ligne du dossier.

## P3 — les finitions

12. Les questions sont signées « Ton cabinet », les messages « Sonia Ben Youssef » : signer pareil (le nom de la personne).
13. Une question répondue perd son étiquette (« Attend ta réponse » disparaît sans rien à la place) : afficher « Répondue ».
14. « Pièce demandée · » finit sa ligne par un point ; au téléphone, « Achat · » est coupé de son numéro.
15. Un message envoyé ne dit rien avant « Lue » : afficher « Envoyé », puis « Lue ».
16. « Répondre » dans « En attente de toi » fait défiler jusqu'à la pièce sans la mettre en évidence.
17. Joindre une pièce au message fait descendre le bouton « Envoyer » (la règle : ce qui apparaît ne pousse rien sous
    le curseur).
18. La fenêtre « Parler d'une pièce » a une ligne vide en bas ; les pièces n'y ont pas de date.
19. Cabinet : « Rien à faire ? » et un petit bouton « C'est traité » : dire « Marquer comme traité », près du fil.
20. Boîte du cabinet : la pastille « 4 » et l'étiquette « À traiter » disent deux fois la même chose ; la pastille suffit.

## Ce qui n'a pas été vérifié ici

- L'e-mail d'alerte réellement reçu (le serveur d'essai n'a pas de relais d'e-mails) ; un vrai téléphone (les captures
  au téléphone viennent d'un navigateur réglé à 390 px) ; le passage complet au clavier seul.
- **Hesabi** : sa collaboration avec les cabinets n'est pas documentée en ligne (À VÉRIFIER sur un compte d'essai).
  Pennylane et Karbon : d'après leurs pages publiques (les sources ci-dessous), pas d'un compte d'essai.

## Ce qui est fait

- **Lot 1, 1.115.0 (22/10/2026)** : P1 (1 à 5) et les finitions P3 (12 à 20), vérifiés à la souris et au téléphone
  (390 px). En chemin, deux défauts trouvés par les tests : une pièce du dossier envoyée sans un mot était refusée par
  la base (la table exigeait un texte, un fichier ou une demande), et une question arrivée avant tout message restait
  signée « Ton cabinet » (les noms passaient par le fil, qui ne naît qu'au premier message). Le détail :
  `docs/messagerie.md` (M4, M7 bis, « Les écrans »).

## Le plan proposé

- **Lot 1 (P1, 1–5)** : l'entrée visible, la conversation à droite de la boîte, l'écriture collée en bas au téléphone,
  la fenêtre « Envoyer la pièce » (fichier avec aperçu, ou pièce déjà saisie), le fil à pleine hauteur ; avec les
  finitions P3 qui touchent les mêmes écrans.
- **Lot 2 (P2, 6–8)** : date limite et relances des pièces demandées, demande de plusieurs pièces et demande du mois,
  agir sur une pièce reçue côté cabinet.
- **Lot 3 (P2, 9–11)** : modèles de messages, recherche, pastille sur la liste des dossiers.

## Sources

- Pennylane, la GED et la collaboration client : https://www.pennylane.com/fr/expert-comptable/ged-collaboration
- Pennylane, les nouveautés de l'interface client : https://www.pennylane.com/fr/blog/produit/nouveautes-interface-client
- Karbon, les demandes aux clients et leurs relances : https://intercom.help/karbon/en/articles/1524688-send-client-requests
- Karbon, la gestion des clients : https://karbonhq.com/solution/client-management/
