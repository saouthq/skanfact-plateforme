# La revue de l'abonnement, côté entreprise et côté cabinet (22/10/2026)

*Demandée par Skander le 22/10/2026 : « fait une revue complète de l'abonnement cabinet et entreprise ! ». Faite à la
souris sur l'écran virtuel (1440×900), version 1.117.1, avec l'exemple de la console (`scripts/humain/exemple-console.ts`,
données inventées) : douze entreprises, une par état de l'abonnement (essai, essai prolongé, essai fini en grâce,
lecture seule après l'essai, payée à l'année, payée au mois, offerte, suspendue, lecture seule après une période payée,
résiliée), trois d'entre elles aussi au téléphone (390 px) ; puis le Cabinet (Cabinet Ben Youssef, sa collaboratrice) et
la console. Le fonctionnement : `docs/abonnement.md` ; les prix : `docs/cadrage/07-offres-et-prix.md`.*

## Le verdict

**Côté entreprise, le fond est solide** : l'état de l'abonnement est juste dans tous les cas essayés (essai, grâce,
lecture seule, payé, offert, suspendu, résilié), la lecture seule ne prend jamais les données en otage (tout se lit,
s'imprime et s'exporte), les prix sont ceux de la console, la remise du cabinet se voit (« −20 % sur ta prochaine
facture », avec sa date de fin), les factures se règlent en ligne dans l'onglet, et les rappels partent par e-mail.

**Mais le chemin pour payer est long et caché**, et deux phrases promettent ce qui n'arrive pas : une entreprise qui
veut s'abonner doit trouver l'onglet, descendre sous les offres et les ajouts, choisir, puis **attendre qu'une personne
de SkanFact prépare sa facture** dans la console, sans être prévenue quand elle arrive.

**Côté cabinet, l'abonnement n'existe pas encore.** Le cadrage (`07`) fixe un prix (trois dossiers tenus gratuits, puis
60 DT HT par dossier et par an, jamais plus de 1 990 DT HT par an), mais rien ne le compte, ne le facture ni ne le
montre : un dossier tenu par un cabinet est « hors abonnement », gratuit pour toujours, quel que soit leur nombre. Le
Cabinet n'a aucun écran qui en parle ; la console compte les dossiers tenus de chaque cabinet, sans prix.

## P1 — ce qui gêne vraiment

1. **L'accueil ne dit rien quand l'essai finit ou que l'entreprise est fermée.** En grâce ou en lecture seule, le seul
   signe est une petite pastille orange en bas du menu (« Lecture seule — voir l'abonnement »). L'accueil d'une
   entreprise en lecture seule propose encore « Prends ta gestion en main », « Tes premiers pas », « + Nouveau devis »
   et « + Nouvelle facture » : des gestes qu'elle ne peut plus faire. *À faire* : en haut de l'accueil, un bandeau qui
   dit l'état, la date, et un seul bouton « Choisir mon offre » ; en lecture seule, les boutons de création se
   remplacent par ce bouton, et les premiers pas se taisent.
2. **« Ton abonnement » n'a pas de bouton en tête.** L'encadré du haut dit l'état (« L'essai est terminé depuis le
   20/10/2026 ») mais ne propose rien ; « T'abonner » et « Je choisis cette offre » sont tout en bas, après les deux
   offres, leurs listes et la grille des ajouts (au téléphone, à plusieurs écrans de défilement). Les cartes des offres
   n'ont pas de bouton « Choisir ». *À faire* : un bouton principal dans l'encadré du haut (il descend aux offres) ;
   un bouton « Choisir Essentiel » / « Choisir Complet » dans chaque carte, avec l'année ou le mois juste au-dessus.
3. **« Abonne-toi : tout se rouvre aussitôt » n'est pas vrai.** Le choix ne fait que prévenir la console : une
   personne prépare la facture, qui doit ensuite être payée. Rien ne se rouvre « aussitôt ». Et pour une entreprise
   **suspendue** par SkanFact, la même phrase invite à s'abonner alors qu'il faut d'abord nous écrire. *À faire* : dire
   ce qui se passe vraiment (« Choisis ton offre : ta facture arrive ici, et tout se rouvre dès qu'elle est réglée ») ;
   pour une suspension, seulement « écris-nous ».
4. **Après « Je choisis cette offre », il faut attendre un humain, sans être prévenu.** La facture se prépare à la main
   dans la console (« À décider ») ; aucun e-mail ne part quand elle est prête. Un client qui choisit un samedi soir
   attend lundi, et doit revenir voir. *À faire* (décision de Skander, plus bas) : la facture se prépare et s'émet
   d'elle-même au choix, et le bouton « Payer » s'ouvre aussitôt ; la console garde la main sur les cas à part.
5. **Le cabinet ne paie rien et ne voit rien** (le verdict, plus haut). *À faire* : le lot 3, après les décisions de
   Skander.

## P2 — ce que font les autres et qui nous manque

Les outils d'abonnement en ligne (les logiciels de gestion vendus au mois, Hesabi compris, `docs/etudes/ETUDE-HESABI.md`)
font presque tous la même chose : un bandeau d'essai partout avec les jours qui restent et « S'abonner » ; une carte
par offre avec son bouton ; le paiement qui ouvre le compte tout de suite ; la facture et le reçu envoyés par e-mail ;
« Prochaine facture : tel montant, le tel jour » ; « Résilier » sur la même page.

6. **« À régler » sans rien à régler.** Une entreprise en grâce lit « À régler » alors qu'aucune facture n'existe : il
   faut d'abord choisir. *À faire* : « Choisis ton offre » tant qu'il n'y a pas de facture ; « À régler » quand il y en a
   une, avec son bouton « Payer ».
7. **Pas d'e-mail quand la facture est prête, ni de reçu après le paiement.** *À faire* : un e-mail « Ta facture
   d'abonnement est prête » (le lien vers l'onglet, rien d'autre dans l'e-mail, comme les alertes de la messagerie), et
   un reçu après le paiement.
8. **L'abonné ne voit pas sa prochaine facture.** « Payé jusqu'au 01/11/2026. Encore 10 jours. » ne dit ni le montant
   (avec la remise et les ajouts) ni ce qu'il doit faire : rien (une facture viendra) ou choisir. *À faire* :
   « Prochaine facture : 31,200 DT HT le 01/11/2026 (Essentiel au mois, −20 %) ; elle arrivera ici ».
9. **Le rappel annoncé est peut-être déjà parti.** Walid, à 10 jours de l'échéance, lit « Un rappel part par e-mail
   15 jours avant l'échéance » : il est parti il y a cinq jours. *À faire* : « Un rappel t'a été envoyé le … » quand
   c'est le cas.
10. **L'année n'est pas mise en valeur.** 390 DT l'an contre 39 DT le mois (468 DT l'an) : deux mois offerts, que
    l'écran ne dit pas. *À faire* : « à l'année, deux mois offerts » sur chaque carte.
11. **Pas de prix TTC.** « Hors taxes : la TVA s'ajoute » ; un indépendant veut savoir ce qu'il paiera. *À faire* :
    le TTC en petit sous le HT (le taux de TVA vient des réglages, **À VÉRIFIER** avec un comptable).
12. **Résilier, changer d'offre : seulement en nous écrivant.** *À faire* (décision de Skander) : « Ne pas
    renouveler » dans l'onglet (l'abonnement va jusqu'au bout de la période payée, puis lecture seule ; il se reprend
    d'un clic) ; passer d'Essentiel à Complet en cours de période (la console sait déjà facturer au prorata).
    **À VÉRIFIER** : ce que la loi tunisienne demande pour résilier un abonnement en ligne.

## P3 — les finitions

13. La jauge de l'essai prolongé dit « 19 jours sur 30 » alors que l'essai dure 44 jours (30 + 14 offerts par la
    console) : dire « 19 jours restants », ou compter sur la vraie durée.
14. « 5 jours de grâce » en tête, « 7 jours de grâce » dans l'explication plus bas : dire « encore 5 jours de grâce,
    sur 7 ».
15. La grille des ajouts montre à tous des lignes qui ne les concernent pas (des établissements en plus, des caisses en
    plus) : les replier sous « Ce qui peut s'ajouter ».

## Ce qui n'a pas été vérifié ici

- Le paiement réel par Konnect (le bac à sable seulement, déjà essayé à la souris le 20/10/2026).
- Les e-mails de rappel tels qu'ils arrivent dans une vraie boîte (leur texte est lu dans le code).
- Le droit : la TVA sur l'abonnement, ce qu'une résiliation en ligne doit permettre, la facture électronique de nos
  propres factures (**À VÉRIFIER**).

## Le plan proposé

**Lot 1 — l'entreprise, sans aucune décision de prix** (P1 1 à 3, P2 6 à 10, P3) : le bandeau de l'accueil et les
gestes de création remplacés en lecture seule ; le bouton principal de l'onglet et un bouton par carte ; les phrases
honnêtes (suspendue, « aussitôt », « À régler ») ; l'e-mail « facture prête » et le reçu ; la prochaine facture et
son montant ; le rappel déjà envoyé ; les deux mois offerts ; les finitions. Tests, preuves, essai à la souris et au
téléphone.

**Lot 2 — payer sans attendre** (P1 4, P2 11 et 12), **après l'accord de Skander** sur trois points :
- la facture préparée **et émise** d'elle-même au choix de l'offre (sans un humain), la console prévenue et gardant les
  cas à part ;
- le prix TTC affiché à côté du HT ;
- « Ne pas renouveler » et « Passer à Complet » faits par le client lui-même.

**Lot 3 — l'abonnement des cabinets** (P1 5), **après les décisions de Skander** (le prix est déjà au cadrage ; ce qui
manque, c'est comment il s'applique) :
- *Quand* : une facture par an, à la date anniversaire du cabinet, sur les dossiers tenus ce jour-là ? Ou chaque
  dossier tenu au-delà de trois facturé au prorata dès qu'il est créé ?
- *Le quatrième dossier* : il se crée librement et se facture ensuite, ou le Cabinet demande d'abord de choisir ?
- *Sans paiement* : comme une entreprise, jamais de données en otage ; proposé : les dossiers tenus restent lisibles et
  exportables, seule la création d'un dossier tenu de plus se ferme.
- *Un dossier tenu qui devient abonné* : gratuit pour le cabinet le jour même (`07`) ; le client « reprend » son
  dossier (ce chemin n'existe pas encore, `07`).
- Ce que le lot ferait : le compte des dossiers tenus (trois gratuits, le plafond de 1 990 DT HT), un onglet « Ton
  abonnement » dans les Réglages du Cabinet (ce qui est compté, la prochaine facture, les factures à régler en ligne),
  les factures du cabinet dans la console (« À décider », la fiche du cabinet), les rappels par e-mail.
- Le prix de 60 DT par dossier attend encore la confirmation des entretiens (`07`, question 2).

## Ce qui est fait

- **Lot 1 (1.118.0)** : le bandeau de l'accueil et les gestes de création retirés en lecture seule ; le bouton de l'état
  et un bouton par offre, confirmé avant de partir ; les phrases exactes (suspendue, « aussitôt », « À régler », la
  grâce sur sa durée, l'essai prolongé, le rappel déjà parti) ; les e-mails « facture prête » et « paiement reçu » ; la
  prochaine facture et son montant ; « deux mois offerts » ; ce qui peut s'ajouter replié. `docs/abonnement.md` C20.

## Sources

Les captures et les textes de chaque état (dans le dossier de travail de la session, non versés) ; le code :
`serveur/abonnement/` (l'état, le choix, les factures, les rappels), `web/public/plateforme/abonnement.js` (l'onglet),
`serveur/console/cabinets.ts` (le compte des dossiers d'un cabinet) ; `docs/abonnement.md` (C19 : le choix de l'offre) ;
`docs/cadrage/07-offres-et-prix.md` (les cabinets, le parrainage) ; `docs/etudes/ETUDE-HESABI.md`.
