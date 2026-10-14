# L'abonnement de l'entreprise

*12/10/2026, lot « les fonctions qui manquent », première partie (14a). Le cadrage fait foi : `docs/cadrage/07-offres-et-prix.md`
(l'essai, les offres, les prix, la lecture seule) et `10-console.md` § 2.4 (les gestes de SkanFact sur un abonnement). Ce document dit ce qui en est fait ; les décisions marquées « par délégation » sont prises le 12/10/2026.*

Avant ce lot, **rien ne s'arrêtait jamais** : une entreprise travaillait pour toujours sans rien payer, et l'écran parlait
encore de la « licence » de la v10 de bureau (une clé qu'on colle), qui n'a pas de sens en ligne.

Le code : la base `base/migrations/0082_abonnement.sql` (le schéma `plateforme`, celui de la console : l'abonnement,
ce qui lui est arrivé, les relances parties, les prix datés ; l'essai qui naît avec l'entreprise ; quatre lectures, chacune
par une fonction), le serveur `serveur/abonnement/` (`etat.ts` déduit l'état, `condition.ts` la lecture seule à la porte,
`relances.ts`, `routes.ts`, `textes.ts`), les gestes de l'exploitant `base/abonnement.ts` et `exploitation/abonnement.sh`,
l'écran `web/public/plateforme/abonnement.js` et `abonnement.css`, branché dans la v10 par `web/v10/abonnement-essai.txt` et
`pont.js` (`lireAbonnement`, `dessinerAbonnement`, `licenceStatus`, `pastilleAbonnement`). Les tests :
`tests/abonnement/etat.test.ts` (l'état, les relances, la période d'un paiement, dates comptées à la main),
`politique.test.ts` (chaque geste qui écrit a sa décision de lecture seule) et `abonnement.test.ts` (contre la base : l'essai,
la porte, les relances, les gestes de l'exploitant).

## Ce que fait le lot

**A1. Un essai de trente jours, tout ouvert, sans carte, né avec l'entreprise** (07). Le jour de sa création il en reste
trente, le dernier compris, au fuseau de l'entreprise. **Les entreprises d'avant ce lot ont leurs trente jours à partir du
jour où il arrive sur leur serveur** (jamais moins qu'à partir de leur création). L'abonnement n'est pas une donnée de
l'entreprise : il ne part pas dans son export, et une remise ne le fait jamais revenir en arrière (un paiement noté après
la minute remise reste noté). Une entreprise restaurée dans une **autre** base n'a pas d'abonnement : rien ne s'y ferme
(on ne ferme pas sur ce qu'on ne connaît pas) tant que l'exploitant ne lui en ouvre pas un (`prolonger`, puis `payer`).

**A2. On garde des faits ; l'état se déduit, du jour qu'il est à Tunis.** Un état écrit se périmerait à minuit. Les faits :
le dernier jour de l'essai, le dernier jour payé (avec l'offre et la périodicité), une résiliation, une suspension, un
abonnement offert. Les états :

| État | Quand | Ce qui marche |
|---|---|---|
| Sans échéance | l'entreprise d'essai d'un développeur, un dossier tenu par un cabinet (c'est lui qui paie), un abonnement offert | tout, pour toujours |
| Essai | jusqu'au dernier jour de l'essai | tout |
| Actif | jusqu'au dernier jour payé (la plus tardive des deux dates fait l'échéance) | tout |
| En retard | les sept jours qui suivent l'échéance, celle de l'essai comme celle d'une période payée (07 les nomme ensemble) : un commerçant qui a oublié la fin de son essai ne trouve pas sa caisse fermée le lendemain matin | tout ; l'écran dit le jour de la lecture seule |
| Lecture seule | ensuite ; le lendemain de l'échéance pour une résiliation (sans grâce) ; le jour même d'une suspension par SkanFact | lire, imprimer, exporter, ce que la loi demande (plus bas) |

**A3. La lecture seule : ce qui ferme une pièce nouvelle, jamais les données.** Chaque geste qui écrit a SA décision
(`POLITIQUE_LECTURE_SEULE`, un test l'exige ; un geste nouveau reçoit la sienne, comme une table nouvelle reçoit sa place
dans l'export) :

- **Fermé par le serveur**, quoi que l'écran envoie : émettre une facture ou un avoir, ouvrir la caisse, rendre un ticket,
  lire une facture d'achat en photo. Le refus dit depuis quand, pourquoi, et le geste qui rouvre (`socle.abonnement.payer`).
- **Décidé par la route**, sur ce qu'elle reçoit : un ticket encaissé sans réseau **avant** la lecture seule se reçoit (la
  vente est faite, le ticket imprimé) ; une commande en ligne nouvelle ne se facture plus, ses paiements si.
- **Retenu par l'écran, AVANT le geste** : un devis, une facture, un achat, un bulletin neufs (la porte de la v10,
  `licenceBlock`, sur chaque point de création). Le refus arrive **à l'ouverture**, avec un bandeau dans l'éditeur et sur
  la caisse fermée, jamais après la saisie : un refus pris à « Enregistrer » jetait ce qu'on venait de taper (vu à la
  souris, corrigé).
- **Toujours ouvert** : lire, imprimer, exporter (jamais de données en otage) ; corriger une pièce existante ; noter un
  paiement sur une pièce émise ; payer et changer d'offre ; l'équipe, le cabinet, les clés ; ce que la loi demande pour ce
  qui existe déjà (signer et déposer une facture émise, la clôture de la caisse, la comptabilité, les déclarations : 07,
  aucune obligation légale n'est vendue) ; parler à son comptable.

**A4. Ce que voit l'entreprise.**
- **La pastille** en bas de la barre latérale : « Essai — 23 jours » en gris, en orange les sept derniers jours ; rien
  pour un abonnement payé, sauf ses quinze derniers jours ; « Essai terminé — lecture seule le … » pendant la grâce ;
  « Lecture seule — voir l'abonnement » ensuite. La carte de l'essai de l'accueil suit le même état.
- **L'onglet « Ton abonnement »** des Paramètres, après « L'équipe », pour le propriétaire et un administrateur : l'état en
  tête (le haut sombre de la vitrine, et la jauge des jours qui comptent), les deux offres (Essentiel 390 DT HT par an ou
  39 par mois, Complet 690 ou 69 ; ce que chacune comprend ; « Ton offre » sur la sienne), comment s'abonner, ce qui se
  passe à l'échéance (les rappels, la grâce, la lecture seule), et l'histoire de l'abonnement — **jamais le motif** d'un
  geste de SkanFact, qui est une note de l'exploitant.
- **Les autres rôles** (un commercial, un caissier) voient la pastille et la lecture seule, et « Qui le règle ? » leur dit
  que c'est le propriétaire, à prévenir. Ni l'onglet, ni son entrée dans la palette.
- L'ancien panneau « Licence » de la v10 ne se montre plus (déjà absent du pont) ; son mot, « licence », mène à l'onglet
  par la recherche des réglages.

**A5. Les relances par e-mail** : quinze jours, sept jours et la veille de l'échéance, puis le jour où l'entreprise passe en
lecture seule. **Une fois chacune par échéance** : une échéance nouvelle (un paiement, un essai prolongé) a les siennes.
Le serveur regarde chaque heure ; un serveur arrêté ne rattrape pas les relances manquées, il envoie la plus pressante
que le jour atteint. Rien pendant la grâce, rien pour une résiliation, une suspension, un abonnement offert ou sans
échéance. Elles partent au propriétaire et aux administrateurs ; un envoi qui échoue n'est pas noté et se retente au tour
suivant ; sans relais d'e-mails, rien ne part (l'état, lui, reste vrai). **Ce qui part chez le relais**, compté et décidé
(par délégation, comme l'alerte de la messagerie) : l'adresse, un objet, la date, l'adresse de l'application. **Ni le nom
de l'entreprise** (« une de tes entreprises »), ni un identifiant, ni un montant.

**A6. Les gestes de SkanFact** (10 § 2.4), depuis la console (`docs/console.md`, depuis Console 1) ou, sur le serveur,
en root :

```
sudo bash /opt/skanfact/depot/exploitation/abonnement.sh <entreprise> voir
sudo bash /opt/skanfact/depot/exploitation/abonnement.sh <entreprise> prolonger <jours> "<motif>"
sudo bash /opt/skanfact/depot/exploitation/abonnement.sh <entreprise> payer <essentiel|complet> <annuel|mensuel> "<motif>"
sudo bash /opt/skanfact/depot/exploitation/abonnement.sh <entreprise> resilier|annuler-resiliation|suspendre|reprendre|offrir|retirer-offert "<motif>"
```

Chaque geste demande son motif (trois caractères au moins) et laisse son événement : quoi, quand, par qui, pourquoi. **Un
événement ne se modifie pas et ne s'efface pas** (la base le refuse). Un paiement couvre une période : payé avant la
lecture seule, elle commence le lendemain de l'échéance (aucun jour d'essai ni de grâce ne se perd, et la grâce ne
s'offre pas un second mois) ; payé après, le jour du paiement ; un renouvellement prend la suite de la période payée. Un
mois est un mois de calendrier : du 31 janvier, la période d'un mois finit la veille du 28 février.

**A7. Les prix sont datés** (`plateforme.prix`, hors taxes, en millimes) : l'écran montre ceux du jour, et un prix nouveau
ne touchera jamais une période déjà payée.

## Décidé par délégation (12/10/2026)

- Une résiliation va au bout de ce qui est payé, puis la lecture seule, sans grâce ni relance ; une suspension par
  SkanFact ferme le jour même (« écris-nous »).
- Les relances ne nomment pas l'entreprise ; le motif d'un geste de SkanFact ne se montre jamais à l'entreprise.
- **14a : on s'abonne par e-mail** (contact@skanfact.tn, l'offre choisie) ; SkanFact envoie la facture, on la règle par
  virement ou par chèque, et l'exploitant note le paiement. Le paiement en ligne vient en 14b.
- **Aucune fonction ne se ferme selon l'offre avant 14c** : Essentiel et Complet ouvrent aujourd'hui la même chose.

L'écran suit la DA des maquettes validées (`docs/entree.md`, « Le dessin » ; la règle de Skander du 12/10/2026 : « il faut
que ça soit toujours premium ») : le haut vert presque noir et quadrillé, Bricolage Grotesque pour les titres, les cartes
arrondies ; vérifié en clair et en sombre.

## À DÉCIDER (Skander)

- **Les entreprises qui existent déjà** (dont les pilotes) reçoivent trente jours d'essai le jour où ce lot arrive sur leur
  serveur. Les pilotes : leur offrir l'abonnement le temps du pilote (`offrir`), ou les laisser dans l'essai puis noter
  leur paiement (`payer`) ? Rien ne se ferme avant trente-sept jours (l'essai, puis la grâce), et une relance part quinze
  jours avant.

## Ce que le lot ne fait pas

- **14b** : payer en ligne (le Konnect de l'éditeur, `docs/paiement-en-ligne.md` pour celui des entreprises), et les
  factures de l'abonnement préparées en brouillon chez SkanFact.
- **14c** : ce qui distingue Essentiel et Complet (la paie, la comptabilité complète, les caisses, les établissements, le
  nombre d'utilisateurs, que rien ne compte encore).
- **La console** (10) : voir les abonnements et faire ces gestes depuis un écran, avec la liste « À décider ». Faite
  ensuite, en première partie (Console 1, `docs/console.md`).
- Le prix gardé deux ans des cent premières entreprises (07, « les premiers clients ») : avec les factures, en 14b.
- L'anglais des relances (avec son catalogue, vague 4).

## À VÉRIFIER

- Les conditions de vente de l'abonnement (durée, résiliation, remboursement d'une période commencée), avant la première
  facture.
- La TVA et le timbre sur la facture de l'abonnement : 14b, avec le comptable.

## 14b — Nos factures, et l'abonnement payé par sa facture (plan du 14/10/2026)

*Décisions prises par délégation le 14/10/2026. Le cadrage fait foi : `10-console.md` § 2.5 (« nos factures sont celles
de l'entreprise SkanFact, émises par le même moteur ; la console ne les refait pas ») et § 2.6 (Konnect, preuve reposée
au prestataire), `01` § 18.*

**B1. L'entreprise SkanFact.** SkanFact est une entreprise de sa propre plateforme. La direction la désigne une fois,
dans la console (Réglages › « Nos factures »), et seulement une entreprise dont elle est **propriétaire** (le compte de
la console est celui de l'application) : nos factures naissent dans SON dossier, avec son moteur, sa numérotation, sa
TVA (son régime et son taux, jamais un taux écrit dans le code), sa facture électronique et sa comptabilité. Tant
qu'elle n'est pas désignée, rien ne se facture, et la console le dit au lieu d'un bouton qui ne mène nulle part.
Désignée, son propre abonnement passe « offert » (elle ne se facture pas à elle-même ; l'événement le dit). Une fois une
facture préparée, l'entreprise SkanFact ne se change plus (ses factures y vivent).

**B2. La facture d'une période.** Depuis la fiche d'un client de la console, « Préparer la facture… » (la direction) :
l'offre et la périodicité, la période (la même règle que « Noter un paiement » : la suite de l'échéance, ou aujourd'hui
si la lecture seule a commencé), le prix du jour (`plateforme.prix`), et ce que la facture dira **avant** le geste (HT,
TVA, timbre, net à payer, calculés par le moteur de l'entreprise SkanFact). Le serveur écrit, au nom de la personne,
dans le dossier de l'entreprise SkanFact : la fiche du client (la raison sociale, le matricule, l'e-mail du
propriétaire de l'abonné ; une seule fiche par abonné, reprise ensuite, donc ce que SkanFact y complète — l'adresse —
reste), puis la facture en **brouillon**. Une facture par abonné et par début de période (son identifiant le dit : deux
clics n'en font jamais deux).

**B3. L'émission reste dans l'application de SkanFact.** La console montre le brouillon « à émettre » et l'ouvre dans
`app.skanfact.tn`, dans un autre onglet (on s'y connecte avec son propre compte, celui de la propriétaire) : Skander la
relit, l'émet, la signe, l'envoie, comme n'importe quelle facture (C4 : la console ne refait pas l'émission). La console
suit ensuite son état : à émettre, à payer (le reste), payée en partie, en retard, payée, annulée ; et la fiche se relit
quand on revient dans son onglet (on vient d'émettre ou d'encaisser ailleurs). Une échéance passée a pour étape suivante
**sa facture** : dans « Ce qui attend », le bouton vert devient « Préparer sa facture… », puis « Émettre sa facture dans
SkanFact », puis « Ouvrir sa facture dans SkanFact » ; « Noter un paiement reçu » reste dans « Gestes ». Tant qu'une
facture attend un geste, on n'en prépare pas une autre (la même période serait refusée) : le bouton disparaît.

**B4. Payée, l'abonnement suit tout seul.** Quand le reste d'une facture d'abonnement tombe à zéro (un règlement noté
dans l'application de SkanFact, ou un paiement en ligne prouvé), l'abonnement est payé jusqu'à la fin de **sa** période,
à l'offre et à la périodicité de la facture : un événement « payé », par le système, qui nomme la facture (la fiche dit
« SkanFact, quand sa facture a été réglée »). Une seule fois par facture. Une couverture qui va déjà au-delà ne bouge pas
(rien n'est posé deux fois). Une facture que ses avoirs couvrent est **annulée** : réglée quand même (le client avait
déjà viré), elle ne paie pas l'abonnement — c'est un remboursement à décider, pas une période payée. « Noter un paiement » de la
console reste pour ce qui se paie sans facture de la plateforme.

**B5. L'abonné voit et règle sa facture** (seconde partie, faite le 14/10/2026 ; base 0098). Dans « Ton abonnement », qui
gère l'abonnement (le propriétaire, un administrateur ; un autre rôle n'y entre pas, et la base le refuse aussi) lit
« Tes factures » : celles que l'entreprise SkanFact lui a **émises** (jamais un brouillon, jamais celles d'un autre
abonné) et les avoirs émis qui les corrigent, la plus récente d'abord, avec le numéro, la période payée, le montant, le
reste et l'état. Chacune est réduite à ce qu'elle imprime (les listes fermées de l'espace client : la fiche de SkanFact
et celle du client ne partent jamais entières) ; « Voir » l'ouvre telle qu'elle s'imprime. Quand une facture doit encore,
la section passe juste sous l'état (c'est ce qu'il y a à faire), avec un seul bouton vert, sur la plus ancienne qui doit.
« Payer en ligne » demande le **reste** (avoirs et règlements déduits) au Konnect de l'entreprise SkanFact, par la règle
de l'espace client (`ventes.paiement_noter` : deux clics, une seule demande ; brique 78 : la preuve redemandée au
prestataire, jamais une page de retour), même en lecture seule — c'est elle qui rouvre ; le geste est tracé
(`socle.abonnement.payer`, avec le numéro). La page de retour propose ensuite « Revenir à ton abonnement », qui rouvre
l'onglet (payé jusqu'au…, la facture « payée ») ; l'entreprise de l'abonné n'est jamais dans l'adresse de retour (elle
attend dans l'onglet). Ce qui part chez Konnect ne change pas : le montant, la devise et l'identifiant de notre demande.
Sans prestataire branché chez SkanFact, rien ne s'offre en ligne, et « T'abonner » dit que la facture se règle par
virement ou par chèque.

**Ce que 14b ne fait pas**, et pourquoi : un règlement retiré après coup ne fait pas reculer l'abonnement tout seul (un
fait posé ne se défait pas sans quelqu'un : la direction le voit et décide) ; l'avoir préparé depuis la console (SkanFact
l'émet dans son application ; l'abonné le voit sous sa facture), le prorata d'un changement d'offre (10 § 2.4) et la facture préparée toute seule à quinze jours de l'échéance viennent une
fois les premières factures relues par le comptable ; « À décider » ne compte pas encore les brouillons préparés et pas
émis (la fiche les montre ; la ligne viendra avec la facture préparée toute seule).

**À VÉRIFIER** (avec le comptable, avant la première facture) : la TVA et le timbre de l'abonnement (aujourd'hui, la
règle de l'entreprise SkanFact) ; la période qui figure sur la facture quand l'abonné paie après le début de la lecture
seule (la période de la facture fait foi) ; les conditions de vente.

## Revu à la souris (14/10/2026, 14b seconde partie)

Sur l'essai de l'outil humain, en Walid (propriétaire de la Librairie Al Kitab) : FAC-2026-002, émise par l'entreprise
SkanFact, vue dans « Ton abonnement » (juste sous l'état, avec son bouton vert), ouverte telle qu'elle s'imprime, payée
chez Konnect (simulé), puis « Revenir à ton abonnement » : payé jusqu'au 23/11/2026, la facture « payée », l'historique
qui la nomme ; FAC-2026-003, la période suivante, corrigée par un avoir de dix jours (AVO-2026-001, émis dans
l'application de SkanFact) : l'avoir se lit au-dessus, « corrige la facture FAC-2026-003 », et le bouton vert ne demande
plus que 35,510 DT ; en clair et en sombre, à l'ordinateur et au téléphone. Corrigé pendant le parcours : « réglée »
répété à côté de « Payée » ; l'historique qui disait « payé » sans nommer la facture ; au téléphone, la facture ouverte
cachée sous la barre du haut, et les numéros coupés à leur tiret (« FAC-2026- » puis « 003 »).

## Revu à la souris (14/10/2026, 14b première partie)

Sur l'essai de l'outil humain : l'entreprise SkanFact désignée dans les Réglages (motif, offerte), la facture de
l'Atelier Mejri préparée depuis sa fiche (l'aperçu suit l'offre et la périodicité : 822,100 en Complet à l'année,
465,100 en Essentiel à l'année, 47,410 au mois ; sans motif, le refus montre la case), émise dans l'application de
SkanFact (FAC-2026-001), réglée en deux fois ; la Librairie Al Kitab en renouvellement (la période suit la couverture, à
régler la veille) ; en clair et en sombre, à l'ordinateur et au téléphone. Corrigé pendant le parcours : la carte « Ses
factures » sans ses marges ; le vert de « Ce qui attend » qui proposait encore « Noter un paiement reçu » ; « Préparer »
offert sur une facture qui attendait déjà (refusé ensuite) ; la fiche restée sur « brouillon » après l'émission (elle se
relit au retour) ; la page qui glissait de quinze pixels quand la barre de défilement disparaissait ; la période coupée
sur deux lignes ; « à régler avant » sur une facture payée ; le journal qui disait « période payée » d'une facture
seulement préparée, sans son montant ; « SkanFact, à la création » sous un paiement par facture ; au téléphone, un
tableau qui défilait de côté et cachait l'état et le geste. Trouvé par la vérification avant l'envoi, et corrigé : le
nouveau droit (« préparer la facture d'un abonnement ») sans ses deux textes dans l'écran Équipe, dont le tableau des
droits ne s'affichait plus ; « désigner l'entreprise SkanFact » nommé sous le droit des réglages qui le porte.

## Revu à la souris (12/10/2026)

Sur la boulangerie de l'outil humain, l'essai a été avancé jour après jour dans la base : l'essai (30 jours, puis les sept
derniers), la grâce, la lecture seule, un paiement noté, une suspension puis sa reprise ; en propriétaire et en caissière ;
la caisse, un devis neuf ; en clair et en sombre. Corrigé pendant le parcours : le refus qui n'arrivait qu'à
« Enregistrer » (la saisie perdue) ; des phrases qui parlaient de l'essai à une entreprise payée ; l'onglet refait dans la
DA ; en sombre, un filet menthe détache le haut de son panneau.
