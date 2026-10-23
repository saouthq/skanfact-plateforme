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
- **Aucune fonction ne se ferme selon l'offre avant 14c** : Essentiel et Complet ouvraient alors la même chose (14c, plus
  bas, ferme la paie et la comptabilité complète en Essentiel).

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
- **14c** (ses deux premières parties sont faites, plus bas) : ce qui distingue Essentiel et Complet (la paie, la
  comptabilité complète, les caisses, les établissements, le nombre d'utilisateurs).
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

**B6. Payée en avance, une période attend son premier jour** (1.28.0 ; base 0121 ; l'audit de la console 1.26.0, C01 ;
choisi par délégation le 15/10/2026). Une facture se règle avant le premier jour de sa période (c'est même ce qu'on
espère). Jusqu'ici, ce règlement appliquait aussitôt ce que la nouvelle période change : payée le 15 octobre pour une
période qui commence le 1er novembre, la Comptabilité que le client avait décidé d'arrêter en novembre partait le 15, et
un passage de Complet à Essentiel s'appliquait le 15 — alors que la période payée allait jusqu'au 31.
- Désormais, payée **avant son premier jour**, la nouvelle période garde ce qu'elle change (son offre, sa périodicité, les
  modules qui partent) **pour ce jour-là** ; la période qui court va au bout avec ce qu'elle avait. Le jour venu, la
  **bascule** l'applique : au démarrage du serveur puis chaque heure (le tour « les périodes payées d'avance qui
  commencent », dans Service · Travaux), et avant tout geste sur cet abonnement. Un client garde au pire une heure de
  plus ce qu'il avait payé, jamais une heure de moins. L'histoire de l'abonnement le dit (« période payée commencée »).
- Payée **le jour même ou en retard** (en grâce), rien n'attend : elle s'applique tout de suite, comme avant. Un **premier
  paiement pendant l'essai** aussi (il n'y a pas de période payée à protéger).
- **La même règle** pour la facture de SkanFact (B4) et pour le paiement reçu ailleurs (« Noter un paiement ») ; et la même
  **facture reçue deux fois** (un double clic, deux personnes) ne paie pas deux périodes : la seconde est refusée.
- Ce qui se fait pendant l'attente : un module qui part avec la période payée ne se retire pas deux fois, et ne se rouvre
  qu'à partir de son jour (la période l'a comptée sans lui) ; un changement d'offre se règle par rapport à l'offre payée
  pour la période qui vient ; la facture suivante ne compte plus les modules qui partent. La fiche du client le dit : « la
  période suivante est déjà payée : elle commence le …, en …, sans … ; d'ici là, rien ne change ».
- **Deux périodes payées d'avance** (1.44.0 ; base 0136 ; l'audit de la console 1.42.0, A01). Jusqu'ici, elles se
  fondaient en une attente, au premier des deux jours, avec l'offre de la plus tardive : un client Complet qui payait
  novembre en Complet puis décembre en Essentiel passait en Essentiel dès le 1er novembre. Un seul changement attend son
  jour, et désormais (`secondChangement`, serveur/abonnement/etat.ts, la même règle dans la base) : ce qui attend sans
  rien changer (une période de plus dans l'offre qui court) se **déplace** au premier jour de la nouvelle ; la nouvelle
  qui change **la même chose** (même offre, même durée, aucun module de plus qui part) ne bouge rien ; **deux changements
  différents** se refusent **avant tout argent** — la facture ne se prépare pas, le paiement ne se note pas (« une période
  déjà payée attend son premier jour, le …, en … ») : on la prépare dans la même offre, ou une fois ce jour passé. Une
  facture préparée avant qu'un second changement n'arrive (deux personnes, deux gestes) et réglée quand même paie sa
  période ; le premier changement attend seul, la période plus tardive garde ce qu'il donne (jamais moins que payé), et
  l'histoire de l'abonnement le dit (« à régler »).

**Ce que 14b ne fait pas**, et pourquoi : un règlement retiré après coup ne fait pas reculer l'abonnement tout seul (un
fait posé ne se défait pas sans quelqu'un : la direction le voit et décide) ; l'avoir préparé depuis la console (SkanFact
l'émet dans son application ; l'abonné le voit sous sa facture), le prorata d'un changement d'offre (10 § 2.4) et la facture préparée toute seule à quinze jours de l'échéance viennent une
fois les premières factures relues par le comptable ; « À décider » ne compte pas encore les brouillons préparés et pas
émis (la fiche les montre ; la ligne viendra avec la facture préparée toute seule).

**À VÉRIFIER** (avec le comptable, avant la première facture) : la TVA et le timbre de l'abonnement (aujourd'hui, la
règle de l'entreprise SkanFact) ; la période qui figure sur la facture quand l'abonné paie après le début de la lecture
seule (la période de la facture fait foi) ; les conditions de vente.

## 14c — Ce que l'offre ouvre (première partie, 14/10/2026)

*Décisions prises par délégation le 14/10/2026, sur le cadrage : `07` (la grille), `02` § 1 (une offre ne masque jamais
rien), § 6 (fermer = lecture seule dans le module) et § 8 (le cabinet et les modules).*

**C1. Ce que l'offre ouvre** (`serveur/abonnement/offre.ts`, une seule règle pour le serveur et l'écran) : l'essai,
Complet, un abonnement offert et ce qu'on ne connaît pas ouvrent tout. **Essentiel** ferme la **paie** et la
**comptabilité complète** — pendant la période payée, et pendant la grâce qui la suit (l'offre payée décide encore). La
lecture seule garde sa propre porte.

**C2. Fermé ne cache rien** : tout ce qui existe dans ces modules se lit, s'imprime, s'exporte, se corrige et se
supprime ; rien de NEUF ne s'y crée. Paie : un salarié, un bulletin, une absence, une avance, une déclaration sociale.
Comptabilité complète : une immobilisation ; et, à l'écran seulement (ce sont des lectures calculées dans le
navigateur), le grand livre, la balance et les états financiers. **Jamais fermés** : la TVA, les retenues, les
déclarations, les clôtures, les écritures et le paquet du comptable (`07` : aucune obligation légale n'est vendue en
option).

**C3. Le serveur refuse lui-même** un objet nouveau dans ces parties du dossier, quoi que l'écran envoie (le dossier, et
la route de la paie, qui passe par le même chemin), en disant ce qui est fermé, ce qui reste, et qui l'ouvre (« Voir
l'abonnement »).

**C4. Le cabinet** qui a le mandat d'un dossier y a toujours la paie et la comptabilité complète, quelle que soit l'offre
du client (`02` § 8) ; le client, lui, suit son offre.

**C5. L'écran** reprend les portes de la v10 (7.33.0 : le cadenas de la barre, le bandeau d'entrée, la fenêtre ; 9.1.0 :
les trois onglets de la comptabilité), dans les mots de l'abonnement (« l'offre Complet », « Voir l'abonnement »). La
porte se ferme à l'**ouverture** d'un formulaire nouveau (un salarié, un bulletin, une absence, une avance, une
immobilisation), jamais après la saisie. « Tous les modules » étiquette les deux modules ; la carte Essentiel de « Ton
abonnement » dit ce qui reste dans Complet.

**Ce que 14c-1 ne fait pas** (14c-2) : les quantités — les caisses (1 en Essentiel, 2 en Complet, + 120 DT), les
utilisateurs (3, puis + 30 DT ; retiré le 14/10/2026 : C13), les établissements (1 /
2, + 120 DT), les salariés au-delà de 20 en Complet (+ 12 DT) ; les modules achetés seuls sur Essentiel (paie + 150 DT,
comptabilité complète + 150 DT) et leurs lignes sur la facture de l'abonnement ; passer à Complet en libre-service (on
écrit à contact@skanfact.tn, comme en 14a).

Le prix au mois d'un module acheté seul (`07` ne donne que l'année) : décidé avec la deuxième partie, plus bas.

## 14c — Ce que l'offre compte (deuxième partie, 14/10/2026)

*Le prix au mois de chaque ajout : un dixième de son prix à l'année, le rapport des offres (390/39) ; proposé le
14/10/2026 (15 DT par mois pour un module), accepté d'un « go » de Skander le même jour. Le reste suit la grille de `07`
(« Au-delà de l'offre »). Les utilisateurs ne se comptent plus depuis la 1.11.0 (C13).*

**C6. Un module acheté seul sur Essentiel** (la paie, la comptabilité complète) est un geste de la direction dans la
console (« Ouvrir un module acheté seul », « Retirer un module acheté seul »), avec son motif, son histoire et sa ligne
au journal, comme les autres gestes sur l'abonnement (une seule règle : `serveur/abonnement/gestes.ts`). Il s'ouvre
aussitôt chez le client (C1 suit `plateforme.abonnement.modules`) ; sa ligne vient sur la prochaine facture. Complet le
contient déjà : refusé, en le disant. L'aperçu du geste dit les modules d'après (l'état, lui, ne change pas). Rien ne
s'achète en libre-service : on écrit à contact@skanfact.tn, comme en 14a.

**C7. La facture compte**, le jour où elle se prépare et pour la période qu'elle paie (`plateforme.lignes_en_plus`,
`0099`, refaite en `0100` puis `0102`) :
- les **caisses** actives (1 en Essentiel, 2 en Complet) et les **établissements** actifs (1 / 2) ;
- les **salariés** présents (sans date de sortie, ou sortis après le jour de la facture), quand la paie est là : 10 avec
  la paie achetée sur Essentiel, 20 en Complet ;
- chaque **module acheté seul**.

Jamais les **utilisateurs** : sans limite dans toutes les offres (C13).

Chaque ligne est au prix du jour de sa ligne (`plateforme.prix_option`, daté comme `plateforme.prix`). Une ligne sans
prix posé refuse la facture : rien n'est inventé. La base rejoue le total à l'enregistrement (`console_noter_facture`) :
un total qui n'est pas celui du jour est refusé, et le journal garde les lignes en plus (leur nom, leur quantité). La
pièce, dans le dossier de SkanFact, porte une ligne par ajout (« Salarié au-delà de l'offre — 11 au total, dont 10
dans l'offre ; du … au … »).

| Ajout (HT) | À l'année | Au mois |
|---|---|---|
| Caisse au-delà de l'offre | 120 DT | 12 DT |
| Établissement au-delà de l'offre | 120 DT | 12 DT |
| Salarié au-delà de l'offre (avec la paie) | 12 DT | 1,200 DT |
| La paie, achetée seule sur Essentiel | 150 DT | 15 DT |
| La comptabilité complète, achetée seule sur Essentiel | 150 DT | 15 DT |

**C8. Le client voit les prix AVANT** de les payer : sous les offres de « Ton abonnement », « Au-delà de ce que l'offre
comprend » liste chaque ajout, ce que chaque offre en comprend, et son prix du jour (`plateforme.prix_options_du_jour`),
et que l'équipe, elle, n'a pas de limite (C13). « Un prix par entreprise, jamais par utilisateur », retiré en 1.8.0
quand l'utilisateur de plus se payait, s'affiche de nouveau au-dessus des offres depuis la 1.11.0 : c'est vrai.

**C9. Un compteur, une fonction** (`0100`, `0102`) : ce que l'entreprise utilise (`plateforme.comptes_de_l_entreprise`) et ce
que chaque offre comprend (`plateforme.inclus_de_l_offre`) vivent une fois dans la base ; la facture
(`plateforme.lignes_en_plus`, refaite sur elles) et l'écran de l'entreprise (`plateforme.ce_que_l_offre_compte`, pour
le propriétaire et un administrateur seulement) les lisent toutes deux. Rien ne se compte pendant l'essai ni pour un
abonnement offert : rien ne s'y facture.

**C10. Inviter ne coûte rien** (révisé en 1.11.0, C13) : « Inviter quelqu'un » et « Changer ses rôles » ne parlent
d'aucun prix, quelle que soit la taille de l'équipe. L'avertissement d'avant la quatrième invitation (1.9.0) est parti
avec le prix de l'utilisateur.

**C11. Ce qui est pris** : dans « Au-delà de ce que l'offre comprend », sous chaque ajout, ce que l'entreprise en
utilise aujourd'hui sur ce que son offre comprend (« Aujourd'hui : 11 salariés, 1 de plus que ton offre. », en orange
quand ça dépasse) ; un module acheté seul le dit. Aucune ligne pour les utilisateurs.

**C12. La console lit la grille des ajouts** (1.10.0 ; `0101`) : Réglages › Offres et prix, sous la grille des offres,
chaque ajout, ce que chaque offre en comprend, ses prix datés (en vigueur, à venir) et, pour un module, les abonnés
Essentiel du jour qui l'ont acheté. Rien ne s'y modifie : un prix neuf se pose en base, daté, comme celui d'une offre.

**C13. Des utilisateurs sans limite dans toutes les offres** (Skander, 14/10/2026 ; 1.11.0, `0102` ; `07`, `03`
§ 4.1 révisé). Une petite entreprise a une à trois personnes au bureau ; les caissiers et le comptable ne comptaient déjà
pas. Le prix d'un utilisateur de plus ne rapportait presque rien, compliquait l'équipe (un avertissement, des rôles qui
« comptent » ou non) et contredisait le premier principe de `07` : un prix par entreprise, jamais par personne. Essentiel
a donc, comme Complet, des utilisateurs sans limite : `0102` refait les trois fonctions sans eux (ce que l'entreprise
utilise, ce que l'offre comprend, les lignes de la facture), efface le prix de l'utilisateur de plus (aucune facture
réelle ne l'avait encore porté) et ferme l'option dans la table des prix. L'écran (« Ton abonnement », l'équipe), la
console (la grille des ajouts, l'aperçu d'une facture) et la bulle d'aide suivent.

**C14. Un nouveau prix se prépare dans la console** (1.12.0 ; `0103` ; `07` « Tout se règle depuis la console »,
Skander, 14/10/2026). Jusqu'ici un prix neuf s'écrivait dans une migration ; la direction le prépare maintenant dans
Réglages › Offres et prix, avec son motif et sa ligne au journal (`reglages.prix_prepare`) :
- **ce qui a un prix** : les deux offres et chaque ajout (C7), à l'année ou au mois ;
- **le préavis** : un prix commence au plus tôt trente jours après le jour où il est préparé (Skander, 14/10/2026). Le
  préavis vit lui-même dans la base (`plateforme.regle_abonnement`, datée, intouchable) et se règle dans la console
  (« Changer le préavis… », journal `reglages.preavis`) ; il vaut dès aujourd'hui pour les prix préparés ensuite, un
  prix déjà préparé garde sa date ;
- **un seul prix à venir par choix** ; jamais le prix déjà en vigueur ;
- l'aperçu du serveur dit, avant le geste, le prix d'aujourd'hui, le nouveau, l'écart (« une hausse de 7,7 % », calculé
  par le serveur, jamais par l'écran) et qui l'a aujourd'hui (les abonnés de l'offre à cette périodicité, ou ceux qui
  ont acheté le module) ;
- un prix à venir **se retire** avant sa date (« Le retirer avant sa date… », journal `reglages.prix_retire` avec le
  prix retiré) ; un prix en vigueur ou passé **ne change ni ne disparaît jamais** : la base refuse de le réécrire ou de
  l'effacer, quoi qu'on lui demande (`plateforme.prix_intouchable`) ;
- **la facture d'une période se prend au prix en vigueur à son premier jour** : un nouveau prix vaut pour les périodes
  qui commencent à sa date ou après, et ne touche jamais une période commencée. Ce qui dépasse l'offre se compte
  toujours le jour où la facture se prépare (C7), au prix du premier jour de la période ; la base rejoue le total de la
  même façon (`console_noter_facture`) ;
- **le client le lit** dès qu'il est préparé : sous le prix d'aujourd'hui de l'offre ou de l'ajout, « À partir du
  01/01/2027 : 420 DT HT par an. », et au-dessus des offres, qu'un nouveau prix vaut pour les périodes qui commencent à
  sa date (`plateforme.prix_a_venir`, sans le motif, qui est une note de SkanFact).

Ce que 1.12.0 ne fait pas encore : l'e-mail qui annonce un nouveau prix aux abonnés concernés (et « le prix ne change
pas » s'il est retiré après l'annonce) ; le contenu des offres et les remises réglables (`07`
« Tout se règle depuis la console » : la suite ; les places de fondateur sont abandonnées depuis, Skander, 14/10/2026).

**C15. L'essai, la grâce et les relances se règlent dans la console** (1.13.0 ; `0104` ; `07` « Tout se règle depuis
la console », Skander, 14/10/2026). Trente jours d'essai, sept de grâce et les relances à quinze jours, sept jours et la
veille ne s'écrivent plus dans le code : ce sont des règles datées (`plateforme.regle_abonnement`, comme le préavis),
que la direction pose dans Réglages › Offres et prix, sous la frise des échéances (« Changer l'essai… », « Changer les
relances… », « Changer la grâce… »), avec son motif et sa ligne au journal (`reglages.regle_abonnement`, la règle
d'avant et la nouvelle). Une règle posée vaut dès aujourd'hui, ne se réécrit ni ne s'efface (la base le refuse) ; la
dernière posée un même jour l'emporte. Les bornes, tenues par la base : l'essai de 7 à 90 jours ; la grâce de 0 à 30
jours (0 : la lecture seule dès le lendemain de l'échéance) ; une à cinq relances, chacune de 1 à 60 jours avant
l'échéance, à des jours différents. Ce que chaque règle touche, et ce qu'elle ne touche jamais :
- **l'essai** d'une entreprise se fixe à sa création, par la règle de ce jour-là : un essai commencé garde sa date de
  fin (une prolongation reste un geste de la fiche) ;
- **la grâce** d'une échéance est celle de la règle en vigueur le **lendemain de l'échéance**, son premier jour : une
  grâce commencée garde sa durée ; l'état (`serveur/abonnement/etat.ts`), l'application, la console et l'e-mail de
  relance lisent la même, dans l'histoire des règles que la base joint aux faits (`plateforme.regles_abonnement_histoire`) ;
  une grâce qu'on ne connaît pas ne ferme rien (l'état dit « hors », comme une entreprise sans ligne) ;
- **les relances** qui partent un jour sont celles de la règle de ce jour-là ; une relance déjà partie pour une échéance
  compte encore sous une règle nouvelle (rien de moins pressant ne repart). La base choisit les échéances à examiner
  d'après la règle du jour et la grâce de chacune.
L'application ne dit plus aucun de ces nombres d'elle-même : « Ton abonnement » dit la durée de SON essai (la jauge
« 5 jours sur 30 »), le premier rappel, les rappels et la grâce de son échéance (« 10 jours de grâce », « Pas de grâce »),
lus dans la réponse du serveur ; l'e-mail de relance dit la grâce de son échéance (« tout marche encore 3 jours », « dès
le lendemain, l'entreprise passe en lecture seule »).

**C16. Ce que chaque offre comprend se règle dans la console** (1.14.0 ; `0105` ; `07` « Tout se règle depuis la
console », Skander, 14/10/2026). Une caisse et un établissement en Essentiel, deux en Complet ; dix salariés avec la
paie en Essentiel, vingt en Complet ; la paie et la comptabilité complète comprises en Complet, achetées seules en
Essentiel : ce contenu ne s'écrit plus dans le code (`MODULES_DE_COMPLET`, `inclus_de_l_offre` à deux arguments, les
textes des cartes) ni dans une migration. Il vit dans `plateforme.contenu_offre`, daté comme un prix (une ligne par offre
et par élément : un nombre ; pour un module, 1 compris, 0 acheté seul), et la direction le change dans Réglages › Offres
et prix, « Ce que chaque offre comprend » (« Préparer un changement… »), avec son motif et sa ligne au journal
(`reglages.contenu_prepare`, de ce que l'offre comprenait au nouveau) :
- **un changement se prépare comme un prix** : au plus tôt après le même préavis (choix de Claude le 14/10/2026, à
  confirmer par Skander : un contenu qui diminue est un changement de prix déguisé) ; un seul à venir par ligne ; jamais
  ce que l'offre comprend déjà ; il se retire avant sa date (`reglages.contenu_retire`) ; en vigueur, il ne change ni ne
  disparaît (la base le refuse, `plateforme.contenu_intouchable`) ;
- **une période garde ce qu'elle comprend** : la facture compte au contenu du premier jour de la période, comme son prix
  (`lignes_en_plus`, `ce_que_l_offre_compte`), et la porte des modules (`modulesFermes`) lit le contenu du premier jour
  de la période qui court : un changement n'ouvre ni ne ferme rien au milieu d'une période. Un contenu qu'on ne connaît
  pas ne ferme rien ;
- **l'aperçu dit avant le geste** ce qui change (« Complet : 2 caisses comprises → 3 caisses comprises »), combien
  d'entreprises ont l'offre aujourd'hui, et ce qui demande un regard : une offre Essentiel qui comprendrait plus que
  Complet (dont la carte dit « Tout Essentiel ») ; un module retiré d'une offre qui a des abonnés (à leur prochaine
  période, il se ferme chez eux, sauf acheté seul depuis leur fiche) ;
- **le client le lit** dès qu'il est préparé, sur la carte de l'offre (« À partir du 13/11/2026 : trois caisses
  comprises. », sans le motif) ; les lignes de chaque carte (« Une caisse au comptoir », « La paie, jusqu'à vingt
  salariés ») et de « Au-delà de ce que l'offre comprend » (« Essentiel en comprend une ; Complet, deux. ») viennent des
  nombres du jour ; la carte de son offre dit ce qu'elle ne contient pas d'après la même fonction que la porte du
  serveur ;
- la grille des ajouts de la console dit, sous chaque ajout, ce que chaque offre en comprend aujourd'hui ; « acheté
  aujourd'hui » compte les abonnés dont l'offre ne contient pas le module.
Ce que 1.14.0 ne fait pas : l'e-mail qui annonce un changement aux abonnés concernés (comme pour un prix) ; le message
de la porte qui dit « fait partie de l'offre Complet » suppose encore que Complet contient la paie et la comptabilité
complète (vrai au départ ; à revoir si la direction les en retire).

**C17. Les remises : celle du groupe et celle du cabinet, jamais additionnées** (1.15.0 ; `0106` ; `07` « Les groupes »
et « Parrainage », décisions de Skander du 14/10/2026). Deux remises, réglées dans Réglages › Offres et prix, « Les
remises », comme un prix : leur taux (de 0 à 90 %), et pour le cabinet sa durée (de 1 à 60 mois) se préparent au plus tôt
après le préavis d'un prix, une seule à venir par remise, jamais l'identique ; elles se retirent avant leur date ; en
vigueur, la base refuse de les changer ou de les effacer (`plateforme.regle_remise`, départ : 20 % et 20 % pendant 12
mois ; journal `reglages.remise_preparee` / `remise_retiree`).
- **Le groupe se déclare** dans la fiche d'un client, onglet « L'abonnement », carte « Groupe et remise », par la
  direction et avec son motif : créer un groupe (son nom, qui paraît dans la note de la facture ; les sociétés de la
  même propriétaire proposées, cochées ; une autre se cherche par son nom, son matricule ou son propriétaire), y mettre
  une société, l'en retirer. Une société n'est que dans un groupe à la fois ; elle y entre et en sort le jour du geste
  (journal `groupes.entree` / `groupes.sortie`, sur sa fiche). Chaque geste montre d'abord **l'aperçu** : les sociétés
  du groupe après lui, la première abonnée d'abord, « Prix normal » ou « −20 % » (`plateforme.console_groupe_apercu`).
- **La première abonnée paie le prix normal** : la société du groupe dont la première période payée est la plus
  ancienne (à égalité, la plus ancienne créée) ; les autres ont la remise pour chaque période qui commence pendant
  qu'elles sont dans le groupe. Une société qui a payé passe toujours avant une société qui n'a jamais payé, même si
  sa période payée commence plus tard que celle qu'on facture à l'autre (1.83.0, `0157`, recette du 20/10/2026 : les
  deux payaient le prix normal). Tant qu'aucune n'a payé, celle qu'on facture paie le prix normal.
- **Le cabinet** : un client qui a confié son dossier à un cabinet (un mandat accepté, en cours ou arrêté depuis) qui
  commence **avant son premier paiement** a la remise pour chaque période qui commence dans la durée de la règle depuis
  sa première période payée (choix par délégation du 14/10/2026, Skander ayant demandé « c'est quoi le mieux ? » : un
  fait que la plateforme connaît, fait par le client lui-même, qui ne se fabrique pas après coup). Reprendre un dossier
  que le cabinet tenait déjà n'existe pas encore : il s'y branchera.
- **Jamais additionnées** : la plus forte s'applique (à égalité, celle du groupe, qui dure), l'autre se dit à côté
  (`plateforme.remise_de`).
- **La facture d'une période porte la remise de son premier jour, sur tout son hors taxes** (l'offre et ce qui
  s'ajoute) : la pièce de la v10 la porte comme sa remise globale (`discountRate`), avec une note qui dit laquelle et
  pourquoi ; arrondie au millime le plus proche, le même chiffre au serveur, dans la base et dans la pièce (« deux
  chemins, un chiffre », `tests/abonnement/remise.test.ts`) ; la base la rejoue en notant la facture et la garde
  (`facture_abonnement.remise_*`). L'aperçu de « Préparer la facture » dit la ligne de remise, sa raison et son montant.
- **Qui le lit** : la fiche dit la remise de la prochaine période et pourquoi (« −20 % sur sa prochaine facture »,
  « Remise de groupe (Famille Kitab) : Librairie Al Kitab, la première société abonnée du groupe, paie le prix
  normal. ») ; les échéances et le revenu annuel de « Abonnements » la déduisent et le disent ; le client la lit dans
  « Ton abonnement », au-dessus des offres, sans le nom d'une autre société (`plateforme.ma_remise`), et sait que les
  prix des cartes sont ceux d'avant la remise.
Ce que 1.15.0 ne fait pas : un e-mail qui annonce une remise (ou sa fin) au client ; la remise d'un dossier repris d'un
cabinet. Les places de fondateur, prévues ensuite, sont abandonnées (Skander, 14/10/2026 : `07`).

**Ce que 14c ne fait pas** : passer à Complet ou acheter un module en libre-service (on écrit à contact@skanfact.tn,
comme en 14a).

**C18. L'argent juste** (1.20.0 ; `0113` ; l'audit du 14/10/2026 ; Skander : « le support peut le faire » pour le mois
offert, et pour le reste « décide à ma place ce qui est le mieux d'après notre projet »). Quatre règles, en un seul
endroit chacune (`serveur/abonnement/gestes.ts`, `serveur/abonnement/factures.ts`, la base qui les revérifie) :
- **Offrir un mois va sur la prochaine facture** : elle couvre un mois de calendrier de plus, **au même prix**, et le dit
  (« Du 12/11/2027 au 11/12/2028, dont un mois offert »). Rien ne s'allonge avant elle : un mois offert n'est jamais une
  gratuité sans fin, et il laisse sa trace sur une pièce. **Un seul attend à la fois** (`abonnement.mois_offerts`, 0 ou
  1) ; la facture préparée le consomme (`facture_abonnement.mois_offert`), comme un paiement noté. À un abonné dont
  l'offre est choisie, qui se renouvelle (ni résilié, ni suspendu) : en cours, en grâce ou non renouvelé — pour celui-ci,
  c'est un geste pour qu'il revienne. **Le support l'offre aussi** (Skander, 14/10/2026), **une fois par entreprise sur
  douze mois** ; au-delà, la direction. Le cadrage disait « un avoir sur la prochaine facture » (`10` § 2.4) : choisi par
  délégation, une période plus longue au même prix, sans avoir à émettre — son traitement fiscal est **À VÉRIFIER** avec
  le comptable.
- **Un paiement reçu hors de la plateforme** (une facture faite ailleurs, réglée par virement, chèque ou espèces) **dit
  sa preuve** : le numéro de cette facture, le montant reçu, son moyen et son jour (aujourd'hui ou avant). Sans elle,
  rien n'est payé (le serveur, puis la base). Paiements le compte dans l'encaissé de son jour, sous son moyen (des
  espèces, sous « autrement »), et le liste à part ; le journal et l'histoire de l'abonnement le gardent.
- **Un module acheté s'ouvre tout de suite ; la prochaine facture rattrape**, au prorata des jours, la période payée qui
  courait quand il s'est ouvert (`plateforme.rattrapage_modules` : le prix de la période × jours utilisés ÷ jours de la
  période, au millime le plus proche ; une fois). **Un module retiré pendant une période payée reste ouvert jusqu'à sa
  fin**, puis part : rien n'est perdu, rien n'est à rembourser, et la facture suivante ne le compte plus. Le rouvrir avant
  annule le retrait. Le rattrapage (sa règle fiscale) est **À VÉRIFIER** avec le comptable.
- **Le renouvellement applique ce qui était prévu** : le module qui part, l'offre changée pour l'échéance (0111), que
  rien n'appliquait.
- **Un seul chiffre** : ce que la prochaine facture coûtera se calcule par la règle de la facture (le prix du premier jour
  de sa période, ce qui s'y ajoute, la remise de la période, l'offre choisie pour l'échéance), en un passage pour toute la
  liste (`plateforme.console_renouvellements`, `serveur/console/renouvellements.ts`). La liste des clients (par an), les
  échéances (le montant, « Ce qui revient chaque année »), la fiche (« Prochaine facture : … ») disent ce chiffre-là ; un
  mensuel compte douze mois, sans le rattrapage qui ne se paie qu'une fois.

**C19. L'offre se choisit dans l'application** (1.84.0 ; `0158` ; recette du 20/10/2026, décidé par délégation : les
rappels par e-mail disaient déjà « choisis ton offre dans SkanFact : Paramètres, puis Ton abonnement », que rien ne
tenait — « T'abonner » demandait d'écrire à contact@skanfact.tn).
- **Dans « Ton abonnement »**, qui peut payer l'abonnement (la propriétaire, l'administratrice) coche une offre et sa
  périodicité parmi les prix du jour et clique « Je choisis cette offre » (éteint tant que rien n'est coché). Le choix
  ne paie rien et ne change pas l'abonnement : la facture préparée puis réglée le fait, comme avant. L'onglet dit
  ensuite « Tu as choisi Complet, à l'année », le jour (de Tunis) et qui, et que la facture arrive ici ; « Changer de
  choix » rouvre les choix ; un nouveau choix remplace le précédent (`plateforme.offre_choisie`, jamais réécrite).
- **Refusé** quand une facture de l'abonnement attend son paiement (« Ta facture … attend déjà son paiement : règle-la
  … Pour changer d'offre ensuite, écris-nous »), et pour une entreprise sans abonnement à choisir (offerte, tenue par
  son cabinet, un exemple).
- **La console** (la direction) le lit dans « À décider » et « Ce qui attend » : « … a choisi Complet, à l'année »,
  par qui et quand ; il tient lieu de « à facturer ». « Préparer sa facture… » s'ouvre sur cette offre ; préparée, la
  ligne s'éteint des deux côtés. Le geste est tracé (`socle.abonnement.payer`, `choix`).

**C20. Après la revue de l'abonnement, lot 1** (1.118.0 ; `0170` ; `docs/revue-abonnement.md` ; Skander, « go 1 et 2 »,
22/10/2026 ; décidé par délégation dans le détail) :
- **L'accueil le dit** (`web/v10/abonnement-revue.txt`, `bandeau` de `abonnement.js`) : quand la pastille de la barre
  attire ou alerte (l'essai dans sa dernière semaine, la grâce, la lecture seule, une échéance payée à quinze jours),
  un bandeau en haut de l'accueil dit l'état, la date et ce qui attend, avec un seul bouton : « Choisir mon offre »,
  « Régler ma facture », « Renouveler », « Voir mon abonnement » (la facture se prépare), « Écrire à SkanFact » pour
  une entreprise suspendue ; à qui ne règle pas l'abonnement, « Qui le règle ? ». En grâce et en lecture seule, c'est le
  bouton principal de l'écran : « + Nouvelle facture » n'est plus vert, les premiers pas se taisent ; en lecture seule,
  l'en-tête ne propose plus de créer. Ce qui attend (`aFaire` de `/abonnement/etat` : « payer », « attendre ») ne se lit
  que pour qui gère l'abonnement, et seulement quand l'échéance est proche.
- **« Ton abonnement »** : l'état propose l'étape suivante (« Choisir mon offre », qui mène aux offres ; « Écrire à
  SkanFact » pour une suspension) ; chaque carte a ses boutons (« Choisir Essentiel à l'année », « ou au mois » ;
  « Renouveler » et « Passer à … » pendant un abonnement payé), et le choix se confirme sous eux (le prix, la remise,
  quand la période commence ; « Annuler ») : rien ne part au premier clic ; les quatre cases et « Je choisis cette
  offre » n'existent plus. « Tu as choisi … » vient juste sous l'état. Sous les prix : « À l'année, deux mois offerts »,
  calculé sur les prix du jour (des mois entiers, sinon l'économie en dinars ; rien si l'année ne coûte pas moins).
  « Ce qui peut s'ajouter à l'offre » est replié, ouvert quand l'entreprise dépasse son offre.
- **Les phrases exactes** : ce qui rouvre se dit tel que ça se passe (« Choisis ton offre : ta facture arrive ici, et
  dès qu'elle est réglée, tout se rouvre », ou « Règle ta facture, juste en dessous »), jamais « abonne-toi : tout se
  rouvre aussitôt » ; une entreprise suspendue lit « écris-nous », jamais « abonne-toi » ; « À régler » seulement quand
  une facture attend son paiement (sinon « Essai terminé » ou « Abonnement échu ») ; la grâce se dit sur sa durée
  (« Encore 5 jours de grâce, sur 7 ») ; l'essai prolongé dit les jours qui restent (« 19 jours restants »), jamais un
  total faux ; le rappel déjà parti se dit avec son jour, et le prochain qui partira (`plateforme.mes_rappels`).
- **La prochaine facture** d'un abonnement payé qui se renouvelle : son montant hors taxes, par la règle de la facture
  et de la console (`aRenouveler`, `htDeLaPeriode`, `plateforme.ma_prochaine_facture`), sa période et sa remise.
- **Deux e-mails par facture** (`serveur/abonnement/courriels.ts`, le postier, chaque minute) : émise, « Ta facture
  d'abonnement SkanFact est prête » (son échéance) ; payée, « Ton paiement à SkanFact est bien reçu » (le jour jusqu'où
  l'abonnement est payé). À qui gère l'abonnement, une fois par facture et par nature ; un brouillon ne s'annonce pas ;
  payée avant d'être annoncée, seul le reçu part ; un envoi raté se retente ; les factures d'avant 0170 ne s'annoncent
  pas. Ce qui part chez le relais, compté et décidé comme les rappels : l'adresse, un objet, une date, l'adresse de
  l'application ; ni le montant, ni le numéro, ni le nom de l'entreprise.

## Revu à la souris (14/10/2026, C17 : les remises)

Sur l'essai de l'outil humain, la base passée en `0106`, dans la console (Amira, direction). Une seconde société pour
Walid, « Papeterie Al Kitab » ; sa fiche, onglet « L'abonnement » : « Aucune remise sur sa prochaine facture. Elle n'est
dans aucun groupe, et aucun cabinet ne l'a amenée avant son premier paiement. », et « Les autres sociétés de Walid
Kitab, dans aucun groupe : Librairie Al Kitab ». « Créer un groupe » : le nom tapé, la Librairie cochée d'avance, « Café
El Medina » trouvé en tapant « medina » (sans accent) et ajouté puis décoché ; l'aperçu suit chaque case : Librairie Al
Kitab (première période payée : 24/10/2026) « Prix normal », Papeterie « −20 % ». Créé : « −20 % sur sa prochaine
facture », avec la raison ; « Retirer du groupe » montre ce qui suivrait (« Librairie Al Kitab reste seule dans le
groupe : elle paie le prix normal ») et s'annule à Échap. « Préparer la facture… » : Complet à l'année 690,000, « Remise
de groupe (20 %) » −138,000 et sa raison, hors taxes 552,000, TVA 104,880, net 657,880. Réglages : « Les remises » (20 %
sans limite, 20 % pendant 12 mois, qui les a posées) ; la remise du cabinet préparée à 15 % (« 20 % pendant 12 mois →
15 % pendant 12 mois »), à venir avec qui et pourquoi, retirée ; le journal dit les deux gestes, de quoi à quoi, et les
deux entrées dans le groupe. Chez Walid, « Ton abonnement » de la Papeterie : « −20 % sur ta prochaine facture » et sa
raison au-dessus des offres. Au téléphone, la carte se lit d'une colonne. Corrigé pendant le parcours : la fiche d'un
client tombait quand l'entreprise SkanFact n'était pas désignée (la base l'exigeait pour écarter SkanFact des voisines :
elle se lit maintenant sans l'exiger) ; « Dans aucun groupe » qui répétait la phrase du dessus ; les sociétés proposées
nommées par leur propriétaire (« Les autres sociétés de Walid Kitab ») et en majuscule ; les cases à cocher décalées
sous leur texte (elles prenaient le style des champs) ; « abonnée depuis le 24/10/2026 » pour une date à venir (« première
période payée : … ») ; la pastille « Groupes » du journal sans couleur ; « tant qu'elle est dans le groupe » trop long
(« sans limite ») ; la durée du cabinet qui poussait la date sur une autre ligne (elle vient dessous), et qui, remplie
d'avance, faisait demander « ce que tu viens de taper sera perdu » sans rien avoir tapé (vide, elle garde celle
d'aujourd'hui).

## Revu à la souris (14/10/2026, C16 : ce que chaque offre comprend)

Sur l'essai de l'outil humain, la base passée en `0105`, dans la console (Amira, direction) : Réglages › Offres et prix,
« Ce que chaque offre comprend » : 1 et 2 caisses, 1 et 2 établissements, 10 et 20 salariés, la paie et la comptabilité
« Achetée seule » en Essentiel et « Comprise » en Complet. « Préparer un changement… », Complet · caisses comprises, 3
tapé au clavier : « Complet : 2 caisses comprises → 3 caisses comprises », 2 entreprises ont Complet ; préparé avec son
motif : la case de Complet dit « → 3 le 13/11/2026 », et dessous qui l'a préparé et pourquoi. Chez Walid (Librairie Al
Kitab, Essentiel, la paie achetée), « Ton abonnement » : la carte Complet annonce « À partir du 13/11/2026 : trois
caisses comprises. », Essentiel « Aucun changement annoncé. », et la sienne dit que la paie est achetée en plus
d'Essentiel et que la comptabilité complète est dans Complet. Retiré avec son motif ; le journal dit « Changement de
contenu préparé » puis « retiré », de quoi à quoi. Corrigé pendant le parcours : « achetée seule » et « comprise » écrits
dans la police des chiffres (devenus des pastilles), l'annonce dans la case aussi (raccourcie en « → 3 le … »), les
colonnes qui s'élargissaient quand un changement s'annonce (largeur fixe), le bouton rejeté sous le titre (« Préparer
un changement… »), et dans la fenêtre, la case du nombre plus haute que celle de la date (les deux cases alignées en
haut, pour la fenêtre d'un prix aussi). Repris après la remarque de Skander (« salarié », pas clair : est-ce un
utilisateur ?) : la ligne s'appelle « Salariés dans la paie » et dit que ce sont les employés dont l'entreprise fait la
fiche de paie, pas les personnes qui utilisent SkanFact (sans limite) ; l'ajout, « Un salarié de plus dans la paie », dans
la console comme chez le client. La fenêtre choisit l'offre puis ce qui change (deux listes courtes au lieu de dix choix
d'un coup) ; un module s'y propose d'emblée dans l'autre état que le sien (la paie de Complet, comprise, se propose
« Achetée seule, en plus », avec ce que les abonnés de Complet perdraient, en rouge) ; une liste choisie sans rien taper
ne demande plus « Ce que tu viens de taper sera perdu » ; au téléphone, chaque ligne devient une fiche (Essentiel : 1,
Complet : 2) au lieu d'une colonne Complet cachée à droite.

## Revu à la souris (14/10/2026, 1.11.0 : des utilisateurs sans limite)

Sur l'essai de l'outil humain, la base passée en `0102` : chez Walid (Librairie Al Kitab, Essentiel, la paie achetée),
« Les offres » dit de nouveau « Un prix par entreprise, jamais par utilisateur » ; la carte Essentiel, « Des
utilisateurs sans limite, un établissement » ; « Au-delà de ce que l'offre comprend » commence par la caisse (plus de
ligne pour les utilisateurs) et dit que l'équipe n'a pas de limite ; « L'équipe », avec deux invitations qui attendent,
ouvre « Inviter quelqu'un » sans un mot de prix (avant, c'est là qu'il s'affichait). Dans la console, en direction :
Réglages › Offres et prix (« jamais par utilisateur » sous la grille, cinq ajouts, « Les utilisateurs ne s'y comptent
jamais ») ; l'aperçu d'une facture de la Clinique Dentaire Amri, l'offre seule. Le brouillon de l'Atelier Mejri, préparé
le matin même avec l'ancienne règle (58,200 DT HT, dont 3 DT pour un utilisateur), reste tel quel : ce sont des données
d'essai, et aucune facture réelle n'avait porté ce prix.

## Revu à la souris (14/10/2026, 14c deuxième partie, b)

Sur l'essai de l'outil humain, en Walid (Librairie Al Kitab, Essentiel, la paie achetée) : « Ton abonnement » dit
« Aujourd'hui : 1 utilisateur sur 3 compris », « 0 caisse sur 1 comprise », « 0 salarié sur 10 compris » et « Achetée
pour ton abonnement » sous la paie ; « L'équipe » : deux invitations (un commercial, une magasinière) sans un mot du prix,
puis, à la troisième, la fenêtre dit avant le bouton que l'offre comprend 3 utilisateurs, que l'équipe en compte 1 et
que 2 invitations attendent, et ce que coûtera une personne de plus. Corrigé pendant le parcours : « 0 caisse sur 1
compris » ; « tu en as déjà 1, et 2 invitations attendent », qui se lisait mal ; l'espace avant les deux-points.

## Revu à la souris (14/10/2026, C15 : l'essai, la grâce et les relances)

Sur l'essai de l'outil humain, dans la console (Amira, direction) : Réglages › Offres et prix, sous la frise « Autour
d'une échéance », les trois règles de départ et leur motif ; « Changer la grâce… » : la fenêtre ouvre sur la règle
d'aujourd'hui (7), dit qu'elle ne changerait rien et garde « Poser cette règle » éteint ; 10 tapé : l'aperçu barre
« 7 jours de grâce », dit « 10 jours de grâce » et qu'aucune entreprise n'est en grâce aujourd'hui, sans pousser le
motif ; posée : la frise et la ligne disent 10 jours, réglée par Amira, et le journal « 7 jours → 10 jours ».
« Changer les relances… » : « 10 3 3 » refusé à la place de l'aperçu, « 10 3 » accepté (« 15 jours avant l'échéance,
7 jours avant et la veille → 10 jours avant l'échéance et 3 jours avant »), abandonné sans rien poser. Chez Walid
(Essentiel au mois, payé jusqu'au 23/11/2026) : « Un rappel part par e-mail 15 jours avant l'échéance », et sous « À
l'échéance », les rappels en mots et « 10 jours de grâce ». Corrigé pendant le parcours : « La règle de départ : « La
règle de départ (07)… » », dit deux fois (le motif des règles de départ dit maintenant « Cadrage 07 (27/09/2026) ») ;
l'aperçu des relances qui répétait sa première ligne.

## Revu à la souris (14/10/2026, C14 : un nouveau prix)

Sur l'essai de l'outil humain, dans la console (Amira, direction) : « Préparer un nouveau prix… », Essentiel à l'année,
420 DT à partir du 13/11/2026 (le premier jour après le préavis), motif « Grille 2027 annoncée aux pilotes » ; l'aperçu
(390 barré, 420, une hausse de 7,7 %, qui l'a aujourd'hui), la pastille « À venir » sous Essentiel et la carte du prix
à venir sous la grille ; chez Walid, « Ton abonnement » à l'ordinateur et au téléphone : « À partir du 13/11/2026 :
420 DT HT par an. » sous le prix d'Essentiel ; le prix retiré (« Grille 2027 repoussée après les pilotes »), la grille
qui reste, et les deux gestes au journal, de quoi à quoi ; la fenêtre au téléphone. Corrigé pendant le parcours : l'aperçu qui arrivait en poussant le motif
vers le bas (il a sa place dès l'ouverture, et un prix déjà préparé pour ce choix s'y dit, sans rien pousser) ; la
liste de Complet qui commençait plus bas que celle d'Essentiel quand une seule offre annonçait un prix (les cartes
partagent leurs lignes, et l'autre dit « Aucun nouveau prix annoncé. ») ; 450 DT tapés pour Complet au mois (69 DT
aujourd'hui) passaient sans un mot : un écart de moitié ou plus dit maintenant, en couleur, « vérifie que c'est bien le
prix au mois » ; la suggestion du navigateur qui cachait le prix d'aujourd'hui sous la case ; « le prix de Essentiel »
au journal, devenu « le prix d'Essentiel ».

## Revu à la souris (14/10/2026, 14c deuxième partie)

Sur l'essai de l'outil humain, dans la console (Amira, direction) : la Librairie Al Kitab, « Ouvrir un module acheté
seul » (la paie), l'aperçu qui dit les modules d'après, la fiche « Modules achetés seuls : Paie », son histoire avec le
motif ; l'Atelier Mejri, la paie ouverte, quatre invités (un commercial, une magasinière, un caissier qui lit aussi, une
caissière seule) et douze salariés dont un sorti : « Préparer la facture… » dit 39 + 15 (la paie) + 3 (un utilisateur
au-delà de trois, sur quatre comptés) + 1,200 (un salarié au-delà de dix, sur onze) = 58,200 DT HT, 70,258 DT à payer ;
le brouillon, dans le dossier de SkanFact, porte les quatre lignes et leur période. Chez Walid : la paie s'ouvre (plus de
cadenas, le formulaire du salarié s'ouvre), les immobilisations restent fermées ; la carte Essentiel dit que la paie est
achetée ; l'histoire « Module acheté (la paie) » ; « Au-delà de ce que l'offre comprend » à l'ordinateur et au téléphone.
Corrigé pendant le parcours : l'aperçu du geste ne disait rien du module (l'état ne change pas) ; « jamais par
utilisateur », devenu faux, et les prix des ajouts, que le client ne voyait nulle part avant de les payer ; au
téléphone, la liste des ajouts en colonne de mots coupés.

## Revu à la souris (14/10/2026, 14c première partie)

Sur l'essai de l'outil humain, en Walid (Librairie Al Kitab, Essentiel) : la Paie porte son cadenas ; sa page le dit à
l'entrée ; « Créer mon premier salarié » ouvre la fenêtre de l'offre, et « Voir l'abonnement » mène à la carte Essentiel,
qui dit ce qui reste dans Complet ; « Tous les modules » étiquette la paie et les immobilisations ; les trois onglets de
la comptabilité complète, affichés, portent leur cadenas et disent ce qui reste ouvert. Corrigé pendant le parcours : le
formulaire du salarié s'ouvrait en entier et ne refusait qu'à l'enregistrement (la porte se ferme maintenant à
l'ouverture, pour les cinq formulaires) ; « option payante » et « pas dans ta licence » sur la page des modules.

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
