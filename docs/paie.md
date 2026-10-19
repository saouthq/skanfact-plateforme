# Brique 31 : la paie par le serveur

*Conception du 29/09/2026. Ce document dit ce que la brique fait, pourquoi, et ce qui la prouve.*

## Où on en est avant la brique

- La v10 sur la plateforme saisit ses salariés et leurs bulletins dans son dossier (`employees`,
  `payslips`). Le serveur les garde **sans rien en vérifier ni en calculer**.
- Le moteur de la paie existe depuis l'étape 1 (`moteur/paie.ts` : le bulletin, ses écritures, la
  CNSS du trimestre), comparé à la v10 sur l'exemple de cinq ans et sur 20 000 bulletins tirés au
  hasard. Il n'était branché à rien.
- **Un défaut de la v10** : un bulletin ne gardait qu'une partie de ce qui l'a calculé (six taux et
  le régime du contrat), ni le barème de l'IRPP, ni les frais professionnels, ni les déductions de
  famille, ni la situation du salarié ce mois-là. Relu après une loi de finances, il ne pouvait plus
  se recalculer : la règle « une pièce garde une copie de ce qui a servi à la calculer » (01 R7) ne
  tenait qu'à moitié.

## Ce que la brique fait

### 1. Le bulletin garde son barème entier (une adaptation de l'écran)

Le moteur de paie de l'écran (`computePayslip`, `compta.js`) fige maintenant, **avec** le calcul, le
barème entier qui l'a fait (les taux, les tranches de l'IRPP, les frais professionnels, les
déductions de famille, « sans IRPP ») et la situation du salarié (chef de famille, enfants). Une
seule retouche, là où tous les bulletins naissent (le formulaire, « Établir les bulletins du
mois ») ; les montants de l'écran ne bougent pas d'un millime (le test le vérifie sur l'exemple de
cinq ans).

### 2. Les tables de la paie (migration `0014`)

- `paie.salarie` : ce que la paie calcule et déclare, **rien de plus** (le nom, le matricule CNSS,
  le poste, le contrat, la situation de famille, les dates d'entrée et de sortie) : ni la CIN, ni le
  RIB, qui restent dans le dossier.
- `paie.bulletin` : la période, la saisie (brut de base, jours en millièmes, primes et retenues), la
  situation du salarié ce mois-là, **le barème en entiers** (JSON sans nombre à virgule), et chaque
  montant du moteur en millimes ; le versement (payé le, mode, référence).
- La base refuse elle-même un bulletin au brut nul ou au net négatif, un net qui ne dit pas « brut
  moins les retenues », un coût qui oublie une charge, un bulletin qui change de salarié ou dont le
  salarié est d'une autre entreprise.
- **Des données sensibles (03 D10)** : la sécurité par ligne ne montre la paie qu'à ceux qui la font
  (propriétaire, administrateur, rôle Paie, une clé de l'API qui a un geste de la paie), même par une
  requête directe. La masse salariale, un total sans nom, se lit par sa fonction
  (`paie.masse_salariale`), que la comptabilité interne et la lecture ont le droit d'appeler.

### 3. Chaque enregistrement du dossier tient la paie au même état

Une fois **tout** l'envoi écrit (un bulletin et son salarié arrivent souvent ensemble),
`serveur/v10/paie.ts` :

1. tient la fiche de chaque salarié changé (seul un changement de ce qu'elle garde la touche : un
   nouveau RIB ne laisse pas de trace de paie) ;
2. relit chaque bulletin **qui a vraiment changé**, le **recalcule** par le moteur avec le barème et
   la situation qu'il a figés, et compare chacun de ses 22 montants à ceux de l'écran : un seul
   millime d'écart, et l'envoi est refusé, en disant lequel (« l'impôt sur le revenu du mois vaut
   125.236 à l'écran, 125.235 au serveur ») ;
3. refuse ce que le formulaire de la v10 refuse (un brut nul, un net négatif), quel que soit le
   chemin : « Établir les bulletins du mois » ne passait pas par ce contrôle ;
4. tient le bulletin (`paie.bulletin.etablir`, `modifier`, `supprimer`, chacun avec sa trace).

Un seul refus, et rien de l'envoi n'est écrit.

### 4. L'API lit la paie

- `GET /v1/entreprises/:e/paie/bulletins` : les bulletins, le mois le plus récent d'abord, page après
  page (`annee`, `mois` pour les restreindre).
- `GET /v1/entreprises/:e/paie/bulletins/:bulletin` : la saisie, la situation, le barème (taux en
  pour cent, montants en dinars), chaque montant, le versement.
- `GET /v1/entreprises/:e/paie/cnss?annee=&trimestre=` : la déclaration CNSS du trimestre, par
  salarié (mois, jours, assiette, parts), rangée par nom, et ses totaux.
- `GET /v1/entreprises/:e/paie/masse?du=&au=` : la masse salariale (brut, net, charges, coût),
  sans un nom ; un bulletin compte au dernier jour de son mois, comme dans la v10.
- Les gestes (`03` § 2.1) : `paie.bulletins.voir` et `paie.declarations.voir` (propriétaire,
  administrateur, Paie), **sensibles** : chaque lecture se trace, et la trace d'un bulletin lu dit
  **lequel** (la porte sait maintenant nommer l'objet d'une lecture) ; `paie.masse.voir`
  (propriétaire, administrateur, comptabilité interne, Paie ; la lecture la voit).

## Décisions (par délégation, 29/09/2026)

- **D1.** Le bulletin fige son barème entier et la situation du salarié (adaptation de l'écran) ;
  le serveur le recalcule avec eux, jamais avec les réglages du jour. Un bulletin de janvier se
  marque payé en mars, après une loi de finances, sans changer d'un millime.
- **D2.** Un bulletin sans barème figé se refuse, avec ce qu'il faut faire (« ouvre-le et
  enregistre-le à nouveau »). Sur la plateforme, tous les bulletins naissent de l'écran adapté ; la
  reprise des dossiers de la v10 installée aura son propre chemin.
- **D3.** Le serveur refuse un brut nul ou un net négatif, comme le formulaire de la v10 (10.10.0),
  quel que soit le chemin. *Écart avec la v10*, dont « Établir les bulletins du mois » ne vérifiait
  pas : une avance plus grosse qu'un salaire proratisé y faisait un net négatif. Le refus nomme le
  salarié et le mois, et dit quoi corriger.
- **D4.** Un bulletin se modifie et se supprime comme dans la v10 (qui prévient : « mieux vaut le
  corriger ») ; chaque geste laisse sa trace. Quand les écritures seront tenues par le serveur, une
  modification passera par une contre-passation.
- **D5.** Les nombres au format du moteur : les montants au millime, les jours au millième, les taux
  à quatre décimales du pour cent ; un taux plus précis se refuse (« barème illisible ») au lieu de
  s'arrondir en silence.
- **D6.** La fiche du salarié au serveur ne garde ni la CIN ni le RIB : la paie n'en a pas besoin
  pour calculer ni pour déclarer à la CNSS. Un salarié retiré du dossier garde sa fiche (ses
  bulletins la nomment ; la v10 ne retire qu'un salarié sans bulletin).
- **D7.** La base elle-même cache la paie aux rôles qui ne la font pas (03 D10), et la comptabilité
  interne lit la masse salariale sans un nom (03 § 2.1, « un total, sans nom »).

## Ce qui reste hors de la brique

Les écritures de la paie tenues par le serveur (étape suivante, **en totaux du mois**, `03` § 2.1) ;
les routes pour établir un bulletin, les congés et les avances par l'API ; la déclaration d'employeur
annuelle ; le Cabinet et son rôle Paie (le mandat) ; le rôle Paie qui ouvre l'écran de la v10 (le
dossier entier ne s'ouvre qu'au propriétaire et à l'administrateur). Le serveur ne vérifie pas encore
que le barème figé est celui des réglages de l'entreprise ce jour-là (deux onglets, dont l'un n'a pas
vu un changement de barème) : viendra quand les barèmes seront des règles du serveur
(`socle.regle_entreprise`). « Établir les bulletins du mois » ne vérifie toujours pas chaque bulletin
**avant** de les établir (la v10 telle quelle) : le serveur refuse l'envoi, avec le nom du salarié et
quoi corriger.

## Ce qui la prouve

- `tests/v10/paie.test.ts` :
  - les **78 bulletins de l'exemple de cinq ans** : l'écran adapté calcule les mêmes montants que la
    v10 ; le serveur les recalcule au millime, chacun de leurs montants ; **chaque trimestre**, la
    déclaration CNSS du serveur est celle de la v10, salarié par salarié, et la masse salariale est
    le coût que la v10 compte sur la même période ;
  - **200 bulletins tirés au hasard** (barèmes, régimes de contrat, absences, primes, retenues,
    familles) : les mêmes montants qu'à l'écran ;
  - un bulletin calculé **à la main** (net 1 120,386 au barème de 2026 depuis la 1.59.0) ; une loi de finances plus tard, il se relit et
    se marque payé sans changer, et le mois suivant prend le nouveau barème ;
  - chaque refus (un millime d'écart, sans barème, net négatif, brut nul, taux trop précis, enfants
    illisibles, salarié absent, date, mois) sans rien écrire ;
  - modifier, supprimer, déplacer, la fiche du salarié qui ne suit que ce qu'elle garde ;
  - la liste page après page, chaque lecture tracée avec le bulletin lu ; la comptabilité interne et
    le commercial ne lisent pas un bulletin, même en direct dans la base ; la masse salariale se lit
    sans un nom ; le rôle Paie lit tout ;
  - la base refuse elle-même ce qui mélangerait deux entreprises ou des montants qui ne se tiennent
    pas.
- `tests/web/parcours.test.ts` : à la souris, le premier salarié, le bulletin du mois, une prime,
  une loi de finances dans les barèmes, le bulletin marqué payé (inchangé), le mois suivant au nouveau
  barème ; l'écran et le serveur disent le même net.
- Chaque test est prouvé en réintroduisant son défaut (`tests/preuves.sh`).

## Le métier de la paie, premier lot (19/10/2026, 1.59.0)

*Demande de Skander, le 19/10/2026 : « pour le module paie, ajouter le pointage des salariés, CSS, FOPROLOS, etc. comme
le vrai logiciel, car il nous manque encore le métier de paie ». Il a donné trois documents réels de 2026 : le bulletin
de juin d'un salarié, le journal de paie de septembre (douze salariés) et l'état récapitulatif CNSS du 3e trimestre
d'une entreprise tunisienne, sortis d'un logiciel de paie du marché. Ils ne sont **jamais** gardés dans le dépôt ; le
test qui s'en sert ne garde que des montants, sans un nom, un matricule ni un numéro.*

**Ce que SkanFact savait déjà** : la CSS, la TFP, le FOPROLOS, l'accident du travail, l'IRPP au barème annuel, les
frais professionnels, les déductions de famille, les congés, les avances, la déclaration CNSS du trimestre et son
fichier, la déclaration d'employeur, le registre du personnel. Recalculé par notre moteur, le journal réel tombe au
millime sur toutes ses colonnes (CNSS, imposable, IRPP, CSS, net, TFP, FOPROLOS, accident, CNSS patronale), aux écarts
d'un millime près expliqués plus bas. **Ce qui manquait**, en trois lots :

1. **1.59.0 (ce lot)** : les taux de 2026 et les primes de chaque mois, au jour ;
2. **1.60.0** : le pointage des salariés (la grille du mois, les heures supplémentaires), qui donne les jours payés ;
3. **1.61.0** : le journal de paie (les colonnes du logiciel réel), l'état récapitulatif CNSS (le montant en lettres),
   la déclaration mensuelle des retenues (IRPP, CSS, TFP, FOPROLOS).

### Ce que le lot fait

- **Les taux livrés sont ceux de 2026** (une adaptation de `DEFAULT_PAYROLL`, `web/v10/paie-2026.txt`) : CNSS 9,68 %
  pour le salarié et 17,07 % pour l'employeur (26,75 % à eux deux, comme sur l'état CNSS), contribution sociale de
  solidarité 0,5 % de la base imposable. Avant : 9,18 %, 16,57 % et 1 %. Une entreprise qui n'a jamais réglé ses
  barèmes prend les nouveaux taux d'elle-même ; un bulletin établi garde le barème qui l'a calculé (D1).
- **Des barèmes enregistrés avec les taux d'avant 2026 se disent** (« Enregistrer les barèmes » écrit chaque taux :
  une entreprise qui l'a fait garde les anciens). L'onglet Bulletins le dit en tête, avec « Voir les barèmes » ; les
  Barèmes disent lesquels et offrent « Prendre les taux de 2026 », qui les écrit dans leurs cases sans rien garder
  avant « Enregistrer les barèmes ». Seul un taux égal à l'ancienne valeur livrée se signale : un taux choisi autrement
  (un régime, une autre décision du comptable) ne se signale jamais.
- **Les primes de chaque mois se posent sur la fiche du salarié** (présence, transport, panier…) : libellé, montant
  pour un mois plein, imposable ou non, **au jour** ou fixe. Une prime au jour suit les jours payés du mois (ceux du
  contrat, moins l'absence non payée) : 80 DT pour 26 jours en donnent 60 pour 19,5 jours, comme le journal réel.
  « Établir les bulletins du mois » et un bulletin nouveau les reprennent ; dans la fenêtre du bulletin, elles suivent
  les jours d'absence tapés et disent d'où vient leur montant (« 30,000 DT au jour : 19,5 j payés sur 26 ») ; un
  montant retapé à la main n'est plus au jour. Le bulletin imprimé dit les jours payés et ceux de chaque prime au jour.
  La liste des salariés, leur page et l'aide de la fiche estiment le net et le coût **avec** les primes ; sous le brut
  de la liste, « + 80,000 DT de primes » dit ce que le net estimé compte.
- **Vu à l'écran, avant l'envoi** (la boulangerie de l'outil humain, un salarié à 612 DT et ses deux primes, six jours
  et demi d'absence : le bulletin tombe sur la ligne du journal réel, net 465,869) : la fiche passait de 580 à 860 pixels
  à la première prime, et « + Prime » fuyait sous le curseur — les deux fenêtres qui portent des primes sont larges dès
  l'ouverture ; sur un bulletin, primes et retenues côte à côte réduisaient « Prime de présence » à « Prime d » et le
  prorata à quatre lignes — elles se suivent maintenant, chacune de la largeur de la fenêtre.
- **Le calcul du bulletin ne change pas** : une prime au jour arrive au bulletin avec son montant du mois, comme une
  prime tapée à la main ; le serveur le recalcule comme avant (brique 31), et le banc contre la v10 figée ne bouge pas.

### Décidé par délégation (19/10/2026)

- **P1.** Les taux de 2026 viennent des documents réels (un journal et un état CNSS sortis d'un logiciel de paie, tenus
  par un comptable) : la règle « un format réel s'apprend de vrais fichiers, jamais en devinant » vaut pour un taux.
  **À VÉRIFIER** : la date où 9,68 % et 17,07 % ont pris effet (une source la donne au 1er janvier 2025, avec
  l'assurance chômage) ; la reconduction de la CSS à 0,5 % en 2026 (loi de finances 2026, article 87 selon la presse) ;
  et la CSS sous 5 000 DT de revenu annuel : le journal réel l'applique à tous (des salariés à 0,179 DT), une source
  dit qu'elle en exonère. SkanFact fait comme le journal, et le dit.
- **P2.** Les barèmes ne sont pas datés : un barème par entreprise, que chaque bulletin fige. Un bulletin en retard de
  2024 se calculerait aux taux de 2026 ; il se corrige dans les barèmes avant de l'établir. Des barèmes datés
  viendront avec les règles du serveur (`socle.regle_entreprise`, « Ce qui reste hors de la brique »).
- **P3.** Une prime nouvelle est **au jour** d'office (la case cochée) : la présence et le transport le sont dans le
  journal réel, et c'est l'usage des conventions collectives (**À VÉRIFIER**). Une prime de rendement se décoche.
- **P4.** **Un millime par montant, au plus, sur un mois proratisé — tranché.** Le logiciel du journal garde les
  fractions de millime jusqu'à l'affichage : 30 × 10,5 / 26 + 50 × 10,5 / 26 = 32,3077, imprimé 32,308. SkanFact
  arrondit chaque prime au millime (12,115 + 20,192 = 32,307), et chaque montant du bulletin aussi, pour que ses
  lignes fassent ses totaux et que le net soit le brut moins les retenues (une règle de la base, 0014). Les totaux du
  journal réel ne sont d'ailleurs pas la somme de ses lignes (cotisable : 7 271,575 imprimé, 7 271,577 en additionnant
  ses lignes ; CSS : 28,721 pour 28,722). Sur les douze lignes, seize montants diffèrent d'un millime, tous nommés dans
  le test avec leur raison ; aucun de plus d'un millime. Le net du bulletin de juin : 1 000,566 chez SkanFact, 1 000,567
  (imprimé 1 000,57) dans le logiciel.

### Ce qui reste (prochains lots)

- **Un mois où le salarié entre (ou sort) ET s'absente sans solde** : le brut proratisé à l'entrée est ensuite réduit
  de l'absence sur 26 jours du brut **proratisé** (la v10 telle quelle), au lieu de 26 jours du brut de la fiche. Les
  primes au jour, elles, comptent juste (les jours du contrat moins l'absence). Le pointage (1.60.0) ne le corrige pas :
  la retenue d'absence se calcule dans le moteur que le serveur refait (brique 31). ~~Le journal de paie (1.61.0) ne la
  corrige pas non plus~~ : **corrigé en 1.62.0** (« L'absence du mois d'une entrée », plus bas), l'écran et le serveur
  ensemble.
- Le Cabinet tient la paie d'un dossier bulletin par bulletin, avec une seule prime : les primes de chaque mois, le
  pointage et le journal y viendront après l'entreprise.

### Ce qui le prouve

- `tests/moteur/paie-journal-reel.test.ts` : les taux livrés ; les douze lignes du journal réel par l'écran (les primes
  de la fiche au jour, puis `computePayslip`) et par le moteur du serveur, montant par montant, chaque écart d'un
  millime nommé ; les totaux ; les règles d'une prime au jour (arrondie, bornée, une prime vide ignorée) ; le bulletin
  du mois après une absence et après une entrée en cours de mois ; le bulletin imprimé ; les taux d'avant 2026.
- `tests/web/parcours.test.ts`, « les primes de chaque mois à la souris » : la fiche et ses deux primes (le curseur
  dans la nouvelle ligne, une prime sans montant refusée sur sa case), le net estimé avec les primes, le bulletin du
  mois, six jours et demi d'absence qui proratisent les primes, un montant retapé, le serveur au même net que l'écran,
  puis des barèmes d'avant 2026 dits et repris.
- `tests/v10/paie.test.ts` et le parcours de la paie : le bulletin calculé à la main au barème de 2026 (net 1 120,386).
- Vingt-huit preuves (`tests/preuves.sh`, « 1.59.0 »).

## Le pointage des salariés (19/10/2026, 1.60.0)

*Deuxième lot de la demande de Skander (« ajouter le pointage des salariés […] comme le vrai logiciel »). Le journal de
paie réel compte, pour chaque salarié, les jours payés du mois (« J. » : 26, 19,5, 10,5…) : c'est sur eux que le brut et
les primes au jour se proratisent. Le pointage les donne.*

### Ce que le lot fait (`web/v10/paie-pointage.txt`)

- **L'onglet Pointage de la Paie**, juste après les bulletins : une grille par mois, une case par salarié et par jour.
  Les codes : **P** présent, **½** demi-journée (la moitié non payée), **A** absent non payé, **C** congé payé, **M**
  maladie, **F** jour férié, **R** repos ; « · » hors contrat (avant l'entrée, après la sortie), qui ne se pointe pas.
  Sans rien pointer, la grille est le calendrier (le repos de la semaine des Barèmes) et les congés et absences saisis
  s'y posent d'eux-mêmes ; seul ce qu'on change se garde (`timesheets`), si bien qu'une absence saisie plus tard se
  pose encore sur les jours qu'on n'a pas touchés.
- **À la souris et au clavier** : un clic passe au code suivant ; une lettre pose son code ; les flèches passent d'une
  case à l'autre (un jour hors contrat se saute) ; le curseur reste sur la case. Un jour de repos ne prend que
  « Repos » ou « Présent » (travaillé : ses heures vont en heures supplémentaires) ; une absence s'y refuse, et le dit.
- **Les jours payés et les jours non payés** de chaque salarié se lisent juste après son nom, recalculés à chaque
  geste : le mois complet des Barèmes (26), moins les jours ouvrables hors contrat, moins les absences non payées
  (une demi-journée en compte une moitié ; une absence ne se compte jamais un jour de repos). Ce sont ceux du bulletin.
- **Les heures supplémentaires** : jusqu'à trois majorations, réglées dans les Barèmes (« Heures supplémentaires » :
  les heures d'un mois complet, 208 = 26 jours de 8 heures, et les majorations en %) ; **aucune n'est écrite d'avance**
  (deux sources donnent des taux différents : **À VÉRIFIER**). Chaque majoration réglée a sa colonne dans la grille ;
  sans majoration, la grille dit où les régler et « Ouvrir les Barèmes » amène à la case. Une heure vaut le brut de la
  fiche divisé par les heures d'un mois complet, majoré : 6 h à +25 % sur 1 234,567 font 44,516 DT, une prime imposable
  (« Heures supplémentaires : 6 h à +25 % »). Comme dans un tableur, Entrée passe au salarié suivant.
- **Le bulletin suit le pointage** : un mois pointé donne à « Établir les bulletins » et à un bulletin nouveau ses jours
  d'absence non payés et ses heures supplémentaires ; les primes au jour suivent ses jours payés. Un bulletin déjà
  établi qui ne suit plus le pointage le dit, sous la grille (« 1 jour non payé au bulletin, 0 au pointage » ; « pas
  les mêmes heures supplémentaires »), et « Reprendre le pointage dans le bulletin » le met à jour — un bulletin déjà
  payé demande d'abord. Les heures reprises remplacent les anciennes, elles ne s'y ajoutent pas.
- **Les droits et l'offre** : le pointage est de la paie (le rôle Paie l'écrit, le commercial non, et le refus le
  nomme : « le pointage des salariés ») ; l'offre Essentiel, qui n'a pas la paie, n'en crée pas de nouveau.
- **Le calcul du bulletin ne change pas** : une absence et une heure supplémentaire arrivent au bulletin comme si on
  les avait tapées ; le serveur recalcule le bulletin comme avant, au même millime que l'écran.

### Vu à l'écran, avant l'envoi

Sur l'outil humain (la boulangerie de Nadia, trois salariés inventés et une absence sans solde) : les cases faisaient
48 pixels (une règle de l'application l'emportait sur celle de la grille), et « Payés » était caché derrière le
défilement — les cases font 22 pixels, les jours payés viennent juste après le nom, qui reste en place quand les jours
défilent, et les trente et un jours d'octobre tiennent à 1440 ; après Tab dans une case d'heures, la grille se
redessinait et le curseur se perdait (la frappe suivante n'allait nulle part) — il revient à la case où Tab l'a posé ;
« Ouvrir les Barèmes » arrivait en haut d'une longue page — il amène à la case ; l'alerte d'un bulletin qui ne suit plus
apparaissait au-dessus de la grille et la poussait sous la souris — elle vient dessous ; « Établir les bulletins »
ne disait pas qu'il reprend le pointage — il le dit. Les bruts des trois bulletins, recalculés à la main, tombent au
millime, et le serveur les recalcule à l'identique ; en sombre, la grille se lit.

### Décidé par délégation (19/10/2026)

- **Q1.** Une maladie, un congé et un jour férié sont payés (comme les congés de la v10, `leaveIsPaid`) ; seuls
  l'absence et la demi-journée retirent des jours. **À VÉRIFIER** avec le comptable : la maladie (la CNSS prend le
  relais après un délai de carence) et les jours fériés chômés et payés.
- **Q2.** Les majorations ne sont pas écrites d'avance : le Code du travail et les conventions collectives donnent des
  taux qui changent selon le régime horaire et le moment (nuit, repos, jour férié) — **À VÉRIFIER**. Trois colonnes au
  plus.
- **Q3.** Un bulletin établi ne se réécrit jamais tout seul quand le pointage change : il le dit, et c'est un geste
  (« Reprendre le pointage dans le bulletin ») qui le met à jour.

### Ce qui reste

- Le Cabinet n'a pas encore le pointage (il tient la paie d'un dossier bulletin par bulletin).
- Les heures supplémentaires au jour près (la grille garde le total du mois par majoration) et l'import d'une pointeuse.
- ~~Le journal de paie, l'état récapitulatif CNSS et la déclaration mensuelle~~ : faits en 1.61.0 (ci-dessous).

### Ce qui le prouve

- `tests/moteur/paie-pointage.test.ts` (dix essais) : la grille par défaut, les congés qui s'y posent, ce qui se garde,
  le repos, le hors contrat (les jours payés du pointage sont ceux du bulletin proratisé), les heures supplémentaires
  au millime, le bulletin du pointage contre le même bulletin tapé à la main, la reprise sans doublon.
- `tests/web/parcours.test.ts`, « le pointage à la souris et au clavier » : la grille, les lettres et les flèches, le
  dimanche refusé, les Barèmes, Entrée d'un salarié à l'autre, le curseur rendu après Tab, le bulletin du mois, puis
  l'alerte sous la grille et la reprise, le serveur au même net que l'écran.
- `tests/v10/droits-dossier.test.ts` (la paie écrit le pointage, le commercial non) ; `tests/abonnement/offre.test.ts`
  (Essentiel n'en crée pas).
- Vingt-quatre preuves (`tests/preuves.sh`, « 1.60.0 »).

## Le journal de paie et les états (19/10/2026, 1.61.0)

*Troisième lot de la demande de Skander (« CSS, FOPROLOS, etc. comme le vrai logiciel »). Ce que le logiciel de paie
réel imprime chaque mois et chaque trimestre, d'après ses documents (le journal de paie de septembre 2026 et l'état
récapitulatif CNSS du 3e trimestre, reçus le 19/10/2026, non commités ; seuls leurs montants sont gardés, dans
`tests/moteur/paie-reel.ts`).*

### Ce que le lot fait (`web/v10/paie-etats.txt`)

- **Le journal de paie du mois** (« Journal de paie », à côté du mois des bulletins, quand le mois en a) : une ligne par
  bulletin, dans l'ordre du registre du personnel (son numéro, 0001, 0002…, tient lieu de matricule), avec les colonnes
  du journal réel : jours payés, salaire de base (moins l'absence), heures supplémentaires (à part, comme le journal),
  primes et indemnités, brut, salaire cotisable, CNSS, salaire imposable, IRPP, CSS, salaire net, autres retenues, net
  à payer, TFP, FOPROLOS, accident du travail, CNSS patronale. Le total de chaque colonne est la **somme de ses lignes**
  (celui du journal réel ne l'est pas : il additionne des fractions de millime). À l'écran pour le relire (les dix-sept
  colonnes tiennent à 1440 points), **imprimé** (une page A4 en largeur, le nombre de salariés au pied) et **en CSV**
  pour le comptable (les jours en « 19,5 », une ligne de total).
- **L'état récapitulatif des salaires déclarés** du trimestre, dans la déclaration CNSS : les salaires déclarés, la
  sécurité sociale et l'accident du travail **calculés sur leur total**, au taux du régime, comme l'état réel
  (29 119,268 × 26,75 % = 7 789,404 ; × 0,50 % = 145,596 ; total 7 935,000), et le total des salaires **en lettres**
  (« arrêtée à la somme de : Vingt-neuf mille cent dix-neuf dinars et deux cent soixante-huit millimes », par la même
  fonction que les factures). Calculé sur le total, il peut différer de quelques millimes de la somme des bulletins,
  arrondis un par un : l'écran le dit, chiffres à l'appui. Si le taux n'est pas le même sur tous les bulletins du
  trimestre (un régime particulier, un taux changé en cours de route), un seul taux ne dirait rien : l'état reprend la
  somme des bulletins, sans taux. **Imprimé**, il suit l'ordre du formulaire réel (numéro d'employeur, code
  d'exploitation, trimestre, année, nom et adresse ; salaires, cotisations ; jours de retard, pénalités et montant à
  payer laissés à remplir à la main ; « arrêtée à la somme de » ; signature et cachet).
- **Ce que la paie d'un mois ajoute à la déclaration mensuelle** (celle de la TVA, « Déclaration mensuelle
  d'employeur et de TVA » du calendrier fiscal), dans les déclarations : l'IRPP retenu sur les salaires (sur les
  salaires imposables, au barème), la contribution sociale de solidarité (sur le revenu imposable après déductions,
  celui du bulletin), la TFP et le FOPROLOS (sur le salaire cotisable), et le total à reverser. Les montants sont ceux
  du journal de paie du même mois — deux chemins, un chiffre. L'échéance suit le jour réglé au calendrier fiscal (le
  28 du mois suivant par défaut). La déclaration s'ouvre sur le mois qu'on déclare maintenant (le mois écoulé), et
  s'exporte en CSV.
- **Les jours payés d'un bulletin** se calculent par une seule fonction (`joursPayesDuBulletin`) : le bulletin imprimé
  et le journal disent le même chiffre.

### Vu à l'écran, avant l'envoi

Sur l'outil humain (la boulangerie de Nadia, septembre) : le journal débordait à 1440 points — l'accident du travail
et la CNSS patronale restaient derrière un défilement, parce que les en-têtes en capitales, sur une ligne, élargissaient
chaque colonne ; ils passent sur deux lignes et tout tient. La déclaration mensuelle, le 19 octobre, s'ouvrait sur
octobre, vide (elle suivait le mois de l'onglet Bulletins), quand celle de septembre était à déposer avant le 28 ; elle
s'ouvre sur le mois écoulé. Les montants de la déclaration sont ceux du journal (IRPP 360,992 ; CSS 15,902 ; TFP 78,251 ;
FOPROLOS 39,126) ; l'état du 3e trimestre dit 1 062,259 DT pour 1 062,258 DT de bulletins, et le dit ; l'état et le
journal imprimés tiennent chacun sur une page.

### Décidé par délégation (19/10/2026)

- **Q1.** Le journal garde **une ligne par bulletin et des totaux qui sont la somme des lignes** ; il n'additionne pas
  de fractions de millime comme le logiciel réel (dont les totaux ne sont pas la somme de ses lignes imprimées).
- **Q2.** L'état récapitulatif calcule les cotisations **sur le total des salaires**, comme l'état réel et comme la
  CNSS, et dit l'écart avec la somme des bulletins au lieu de le cacher. Les montants « À déposer » et la carte « CNSS »
  de la paie restent la somme des bulletins (ce que la comptabilité a passé) ; l'écart d'arrondi se règle au paiement.
  **À VÉRIFIER** avec le comptable.
- **Q3.** La déclaration mensuelle compte **les bulletins du mois**, quelle que soit leur date de paiement. **À
  VÉRIFIER** avec le comptable : la base que le formulaire demande pour la retenue sur les salaires, et le mois où se
  déclare une paie versée le mois suivant. SkanFact ne dépose rien et ne se connecte à aucune administration.
- **Q4.** Le montant en lettres s'écrit en mots (« deux cent soixante-huit millimes »), par la fonction des factures ;
  l'état réel écrit les millimes en chiffres et « Cents » au pluriel devant un nombre, ce que SkanFact ne reprend pas.

### Ce qui reste

- ~~Le cas « entrée et absence le même mois »~~ : corrigé en 1.62.0 (ci-dessous).
- Le Cabinet n'a ni le journal ni les états (il tient la paie d'un dossier bulletin par bulletin).
- Le numéro de matricule propre à chaque salarié (le journal prend le rang du registre) ; les heures supplémentaires et
  les retenues par rubrique dans le journal (une colonne chacune aujourd'hui).

### Ce qui le prouve

- `tests/moteur/paie-etats.test.ts` (six essais) : le journal de septembre contre le journal réel, colonne par colonne,
  avec les mêmes écarts d'un millime que la 1.59.0, et ses totaux ; une ligne qui se tient (heures supplémentaires,
  prime non imposable, retenue, entrée en cours de mois) ; le journal imprimé et son CSV ; l'état du 3e trimestre au
  millime de l'état réel, l'écart avec les bulletins, le total en lettres, l'état imprimé ; un taux qui varie ; la
  déclaration mensuelle contre le journal et contre les bulletins, et son échéance.
- `tests/web/parcours.test.ts`, « le journal de paie et les états à la souris » : le journal du mois (l'ordre, les
  colonnes, les totaux des bulletins, tout à l'écran à 1440 points), imprimé et en CSV ; la déclaration mensuelle sur le
  mois écoulé même quand on regarde un autre mois des bulletins, ses montants, son échéance, son CSV, un mois vide ;
  l'état récapitulatif, ses lettres, imprimé.
- Dix-huit preuves (`tests/preuves.sh`, « 1.61.0 »).

## L'absence du mois d'une entrée (19/10/2026, 1.62.0)

*Le défaut que le premier lot avait laissé ouvert, et que le journal de paie rendait visible (des jours payés qui ne
donnaient pas la base).*

### Le défaut

Le mois d'une entrée ou d'une sortie, la v10 proratise le brut de base du bulletin (10.12.0) ; une absence sans solde du
même mois s'en retirait **encore** au prorata. Embauché le 14 pour 1 300 (13 jours sur 26 : 650) et absent deux jours, le
salarié recevait 650 − 650 × 2 / 26 = **600**, au lieu de 1 300 × 11 / 26 = **550** : 50 de trop, et le journal disait
11 jours payés pour une base de 600. Les primes au jour, elles, comptaient juste.

### Ce que le lot fait (`web/v10/paie-absence.txt`, `moteur/paie.ts`, `serveur/v10/paie.ts`, migration `0147`)

- **L'absence se retire au taux journalier du salaire du contrat** (le brut de la fiche) tant que le brut du bulletin est
  celui que le prorata a calculé : 1 300 × 2 / 26 = 100, et la base du mois vaut 1 300 × 11 / 26. Un brut retouché à la
  main n'est plus « proratisé » (la v10 efface déjà le prorata) : l'absence se retire de lui, comme avant.
- **Le calcul garde ce salaire** (`brutDuMois`) ; la fenêtre du bulletin calcule avec le prorata du mois (rouvrir un
  bulletin et l'enregistrer ne change rien) ; le bulletin imprimé dit, sur la ligne de l'absence, le salaire dont elle
  s'est retirée.
- **Le serveur** relit ce salaire, refait le bulletin avec lui (`calculerBulletin`, `brutDuMois`) et le garde
  (`paie.bulletin.brut_du_mois`, vide pour un mois sans prorata et pour les bulletins d'avant) ; l'API le rend dans la
  saisie du bulletin. Un calcul qui dirait l'avoir retirée d'un autre salaire ne tombe pas juste, et se refuse.
- **Les bulletins déjà établis ne se réécrivent pas** (une pièce garde son calcul) : un bulletin d'un mois d'entrée avec
  absence, établi avant, se corrige en le rouvrant (« Modifier le bulletin », puis Enregistrer) ou avec un rappel le mois
  suivant. **À VÉRIFIER** avec le comptable : la méthode (jours ouvrables du mois complet) et le traitement d'un mois déjà
  payé.

### Ce qui le prouve

- `tests/moteur/paie-etats.test.ts`, « une entrée et une absence le même mois » : le bulletin du mois (entré le 8
  septembre pour 612, deux jours sans solde) : 47,077 retenus, une base de 612 × 18 / 26 = 423,692 dans le journal,
  la ligne imprimée ; un brut retouché.
- `tests/v10/paie.test.ts`, « le mois d'une entrée, une absence sans solde se retire au taux du salaire du contrat » :
  l'écran et le serveur au même millime, le salaire gardé (et rendu par l'API), un brut retouché qui n'en garde pas, un
  calcul faux refusé.
- `tests/web/parcours.test.ts`, « l'absence du mois d'une entrée à la souris » : établi, rouvert et enregistré, le
  serveur au même net, le journal dont la base suit les jours payés.
- Sept preuves (`tests/preuves.sh`, « 1.62.0 »).

## Le bulletin imprimé tient sur une page (19/10/2026, 1.62.0)

*Vu à l'impression, en refaisant à la souris le bulletin d'un salarié entré le 15 septembre et absent deux jours.*

### Le défaut

Le bulletin sortait sur **deux pages**, la seconde ne portant que le pied de page : son contenu mesurait 305 mm pour une
feuille de 297. Le bulletin de la v10 est aéré (7 mm par ligne de rubrique, 16 mm de marge en haut et en bas) ; les
lignes ajoutées depuis (les jours payés, le prorata, l'absence) l'ont fait déborder. Un bulletin chargé (la fiche entière,
une entrée, une absence, six primes et deux retenues : dix-huit lignes de rubriques) mesurait 362 mm. Le bulletin d'un
logiciel de paie tient sur une page : c'est elle qu'on remet au salarié et qu'il signe.

### Ce que le lot fait (`web/v10/paie-impression.txt`)

- **Des lignes serrées comme celles d'un bulletin** : 5,4 mm par rubrique, des marges de 12 mm en haut et 10 mm en bas,
  des intervalles plus courts ; les tailles des caractères ne changent pas, ni le cadre des signatures.
- **Le pied se pose en bas de la page**, quelle que soit la longueur du bulletin (il flottait au milieu d'un bulletin
  court).
- **Plus long qu'une page** (au-delà de dix-neuf rubriques, mesuré dans le navigateur d'essai ; un bulletin courant en
  a de dix à seize), la suite passe sur une deuxième page, coupée entre deux lignes ; l'en-tête du tableau revient,
  chaque page garde ses marges, et les signatures restent avec le pied (vu à l'œil sur un bulletin de quarante-deux
  rubriques ; le navigateur ne laisse pas mesurer où il coupe).

### Ce qui le prouve

- `tests/v10/bulletin-imprime.test.ts` : le bulletin ouvert dans un vrai navigateur, le PDF qu'il en tire et ses pages
  **comptées** : celui vu à l'impression et le bulletin chargé tiennent sur une page, leur pied à 10 mm du bas, avec de
  la marge (4 mm pour une police plus large que celle du navigateur d'essai) ; un bulletin de quarante-deux rubriques
  passe sur deux pages, il ne se tronque pas.
- Refait à la souris : « Exporter le bulletin en PDF », l'aperçu d'impression annonce une page.
- Trois preuves (`tests/preuves.sh`, « 1.62.0 : le bulletin imprimé ») : les rubriques aérées comme la v10, le pied au
  milieu de la page, un bulletin trop long tronqué à une page.
