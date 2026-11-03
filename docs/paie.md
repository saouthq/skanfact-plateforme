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
- Le Cabinet tient la paie d'un dossier bulletin par bulletin, ~~avec une seule prime~~ (toutes les lignes d'un bulletin
  depuis la 1.63.0, « Le Cabinet ne perd rien d'un bulletin », plus bas) : les primes de chaque mois de la fiche, le
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

## Le Cabinet ne perd rien d'un bulletin (19/10/2026, 1.63.0)

*Une règle apprise d'un côté se vérifie de l'autre : les lots de la paie (1.59 à 1.62) refaits depuis le Cabinet, sur un
bulletin que le client a établi dans son SkanFact.*

### Les défauts

Sur la plateforme, le bulletin que le Cabinet tient est **celui du SkanFact de son client** (`web/public/plateforme/
pont-cabinet.js` le lit et le réécrit dans la paie du dossier). Refait à la souris :

1. **L'onglet Paie s'ouvrait vide** : « Aucun salarié déclaré », à côté de l'écriture de paie de leurs bulletins. Le livre
   qu'ouvre le Cabinet ne lisait pas la paie du dossier ; elle n'apparaissait qu'après un geste de paie, et le livre
   qu'un autre geste renvoyait (valider une écriture, lettrer…) la faisait disparaître. Un comptable qui ouvre le dossier
   d'un client dont il fait la paie ne la voyait donc pas.
2. **Un bulletin ne se corrigeait jamais au Cabinet** : le menu ne proposait « Modifier » et « Supprimer » que tant que
   l'écriture du mois n'était pas passée (la règle de la v10), et sur la plateforme le serveur la passe toujours.
3. **Le formulaire n'en montrait qu'une prime et qu'une retenue**, et l'enregistrement effaçait les autres. Depuis la
   1.59.0, les primes de chaque mois de la fiche entrent dans chaque bulletin : un bulletin modifié au Cabinet pour une
   absence aurait perdu ses primes, et le salarié son net.
4. **Le moteur du Cabinet réécrivait chaque prime à son nom, son montant et sa case « imposable »** (`ajouterBulletin`) :
   une prime d'heures supplémentaires perdait sa majoration (le journal de paie la rangeait dans les indemnités, et
   reprendre le pointage l'aurait comptée deux fois), une prime au jour ses jours ; et il calculait **sans le prorata du
   mois** (1.62.0) : une absence du mois d'une entrée s'y retirait encore au prorata.

### Ce que le lot fait (`web/v10/paie-cabinet.txt`, `pont-cabinet.js`)

- **Le livre s'ouvre avec la paie du dossier** (ses salariés, ses bulletins de l'année), et chaque livre que l'écran
  reçoit la garde telle qu'on l'a lue. Un mandat qui ne comprend pas la paie ne ferme pas le livre : l'onglet Paie reste
  vide, et le serveur dit pourquoi au premier geste.
- **Un bulletin se corrige tant que l'exercice n'est pas clos**, comme dans le SkanFact du client : l'écriture de paie
  du mois suit (le serveur la réécrit ; validée, elle se contre-passe, au brouillard, et la nouvelle s'écrit à côté, au
  premier jour ouvert). La fenêtre le dit **avant** le geste quand l'écriture du mois est validée.
- **Le formulaire montre toutes les lignes** (ajouter, retirer, modifier), dans la disposition de l'entreprise ; une prime
  au jour dit ses jours et les suit quand l'absence change ; un montant retapé à la main ne la dit plus « au jour ».
- **Le moteur garde les marques de chaque prime** (`marquesDePrime` : heures supplémentaires, au jour) **et le prorata**
  tant que le brut est le sien (`prorataDuBulletin`) : le Cabinet calcule comme l'entreprise, au millime, et le serveur
  le refait.

### Ce qui le prouve

- `tests/moteur/paie-cabinet.test.ts` : un bulletin à trois primes (au jour, heures supplémentaires, non imposable) et
  deux retenues réécrit par le moteur du Cabinet garde tout, se calcule comme l'entreprise (1 300 × 2 / 26 retirés), et
  le journal range toujours les heures supplémentaires ; un brut retouché perd son prorata.
- `tests/web/cabinet-paie.test.ts`, « un bulletin du client à trois primes et deux retenues, modifié au Cabinet » : le
  bulletin listé dès l'ouverture du livre, la fenêtre et ses cinq lignes, la prime au jour qui suit l'absence,
  l'avertissement sur l'écriture validée, puis au serveur : les lignes, leurs marques, le prorata, le calcul de
  l'entreprise, le même net, et la contre-passation de l'écriture validée.
- Refait à la souris (un cabinet et un dossier inventés) : l'onglet Paie plein à l'ouverture, « Modifier le bulletin »,
  trois primes et deux retenues, l'absence portée à 3 jours (la prime au jour passe à 11 jours), enregistré au même net
  que le serveur, toujours là après rechargement.
- Neuf preuves (`tests/preuves.sh`, « 1.63.0 »).

### Ce qui reste

- ~~Les primes de chaque mois de la fiche ne se proposent pas encore dans un **nouveau** bulletin du Cabinet (elles se
  tapent)~~ : depuis la 1.68.0 (« Les primes de chaque mois au Cabinet », plus bas) ; ~~le bulletin imprimé, le journal de paie et les états restent à l'entreprise~~ : au Cabinet depuis la 1.65.0
  (« Les documents de la paie au Cabinet », plus bas).

## Un bulletin modifié au Cabinet garde son barème (19/10/2026, 1.64.0)

*Trouvé en relisant la 1.63.0 : le calcul du Cabinet, refait sur le bulletin d'un client dont les taux ne sont pas ceux
par défaut.*

### Le défaut

Le Cabinet calcule un bulletin avec les réglages de paie du dossier **au Cabinet** (les taux par contrat, sur le barème
par défaut). Un bulletin que le client a établi dans son SkanFact porte **ses** taux : l'accident du travail (de 0,4 % à
plusieurs pour cent selon le risque de l'activité), la TFP (1 % ou 2 % selon l'activité), le régime d'un contrat (un CIVP
sans charge patronale CNSS). Modifié au Cabinet, pour une absence par exemple, il se recalculait au taux par défaut, **en
silence** : ses charges patronales, l'état récapitulatif CNSS et la déclaration du mois changeaient sans que personne le
voie.

### Ce que le lot fait (`web/v10/paie-cabinet-bareme.txt`)

- **Un bulletin modifié garde le barème figé avec son calcul** (`calcul.bareme`, la règle 5.0.0 : une pièce garde ce qui
  a servi à la calculer), donc les taux du client **ce mois-là** (`baremesDuBulletin`, compta.js) ; l'aperçu de la
  fenêtre, son juge et l'enregistrement calculent avec le même.
- **Le régime de son contrat** (`calcul.regime`) s'applique de nouveau, à l'identique, pour le même contrat ; si le
  contrat a changé depuis, ce que le régime fixait revient des réglages du dossier, et les autres taux du client restent.
- **Un bulletin nouveau** prend les réglages du dossier au Cabinet, comme avant.
- *(1.66.0)* Dans un dossier **tenu** (le client n'a pas SkanFact), les taux réglés au Cabinet sont les siens : la
  fenêtre d'un bulletin modifié offre une case qui lui donne ceux d'aujourd'hui (« Les taux propres d'un dossier au
  Cabinet ») ; sans elle, il garde son barème, comme ici.

### Ce qui le prouve

- `tests/moteur/paie-cabinet.test.ts`, « un bulletin modifié au Cabinet garde le barème figé avec son calcul » : un
  bulletin du client (accident du travail 2 %, TFP 1 %), en CDI puis en CIVP, modifié avec le barème par défaut du
  Cabinet : le même calcul que l'entreprise, ses taux, le régime du CIVP (sans CNSS patronale ni IRPP) ; un bulletin
  nouveau aux réglages du dossier ; un contrat changé depuis.
- `tests/web/cabinet-paie.test.ts` : le bulletin du client à 2 % et 1 %, modifié à la souris, garde ses taux au serveur ;
  le net que l'aperçu annonce avant le geste est celui que le serveur enregistre.
- Quatre preuves (`tests/preuves.sh`, « 1.64.0 »).

### Ce qui reste

- ~~Les taux **généraux** d'un dossier tenu par le Cabinet (son accident du travail, sa TFP) ne se règlent pas encore au
  Cabinet (seuls les taux par contrat)~~ : fait en 1.66.0 (« Les taux propres d'un dossier au Cabinet »). Un bulletin
  **nouveau** d'un client qui fait sa paie dans SkanFact ne lit pas encore ses réglages (le serveur ne les montre pas au
  Cabinet).

## Les documents de la paie au Cabinet (19/10/2026, 1.65.0)

*Le Cabinet tenait la paie d'un dossier sans pouvoir en sortir un document.*

### Ce que le lot fait (`web/v10/paie-cabinet-documents.txt`, `pont-cabinet.js`)

- **Le bulletin imprimé**, dans le menu de chaque bulletin (« Imprimer le bulletin ») : celui de l'entreprise, sur une
  page (1.62.0), au nom de l'employeur (le dossier : son nom, son matricule fiscal, son numéro d'employeur CNSS), sans
  l'avertissement « À faire valider par votre comptable » (c'est le comptable qui l'imprime).
- **Le journal de paie du mois** (« Journal de paie », à côté des gestes du mois) et **l'état récapitulatif des salaires
  déclarés du trimestre** (« Imprimer l'état récapitulatif », sous la déclaration CNSS) : ceux de l'entreprise (1.61.0),
  au même millime, dans la même forme.
- Ils lisent la paie du dossier telle que l'entreprise la tient (`paieDuDossierV10`), celle que le livre a lue. Leur
  moteur (core.js) se charge la première fois qu'on imprime : le Cabinet n'en a pas besoin pour le reste, et sa page
  reste légère ; la fenêtre s'ouvre dans le geste (un navigateur bloque celle qu'on ouvre après une attente).

### Ce qui le prouve

- `tests/web/cabinet-paie.test.ts` : le bulletin modifié au Cabinet, imprimé (l'employeur, le salarié, la prime au jour,
  l'absence sur le salaire du contrat, le net, pas d'avertissement au comptable), le journal de septembre, l'état du
  3e trimestre.
- Refait à la souris : le bulletin, le journal (en largeur) et l'état, chacun sur une page.
- Six preuves (`tests/preuves.sh`, « 1.65.0 »).

### Ce qui reste

- Le journal en CSV au Cabinet (l'entreprise l'a) ; l'adresse de l'employeur sur les documents (le Cabinet ne la tient
  pas dans la fiche d'un dossier).

## Les taux propres d'un dossier au Cabinet (19/10/2026, 1.66.0)

*Le Cabinet ne réglait que les taux d'un contrat ; ceux qui dépendent de l'entreprise restaient ceux du barème.*

### Le défaut

L'accident du travail dépend de l'activité de l'entreprise (la CNSS lui notifie son taux) ; la TFP est de 1 % pour une
industrie manufacturière, de 2 % sinon ; une entreprise peut être exonérée du FOPROLOS (**À VÉRIFIER** sur ses avis et
avec les textes de l'année). Le Cabinet ne savait régler que les taux d'un **contrat** (« Taux par contrat… » : CIVP,
Karama, saisonnier) : chaque bulletin qu'il établissait pour un dossier prenait l'accident du travail, la TFP et le
FOPROLOS du barème par défaut. Pour un dossier **tenu** (le client n'a pas SkanFact), il n'y avait aucun moyen d'avoir
les siens : les charges patronales, l'état CNSS et la déclaration du mois étaient faux à chaque bulletin.

### Ce que le lot fait (`web/v10/paie-cabinet-taux.txt`, `pont-cabinet.js`, `serveur/cabinet/routes.ts`)

- **Une seule fenêtre, « Taux de la paie… »** (l'ancien « Taux par contrat… », au-dessus de la liste des salariés) :
  d'abord **les taux de ce client** (accident du travail, TFP, FOPROLOS ; une case vide suit le barème, en gris), puis
  les taux par contrat. Un taux du client devient, en gris, le taux général des cases de chaque contrat, pendant la
  frappe. Chaque case se refuse sur elle-même (un taux entre 0 et 100, quatre décimales au plus), comme celles d'un
  contrat ; chaque taux porte son aide (« i ») et la visite les explique.
- **La fiche du dossier les garde** (`FICHE.paie` : `accidentRate`, `tfpRate`, `foprolosRate`, en texte décimal à quatre
  décimales au plus, à côté de `regimesContrat`) ; aucun autre taux (les taux de la CNSS et la solidarité sont ceux du
  régime, pas d'une entreprise). Le pont les lit tels quels, comme ceux d'un contrat : le moteur les compte en nombres.
- **Le panneau des salariés les dit** (« Ce client : Accident du travail 2,5 %, TFP 1 % · CIVP : … »).
- Chaque bulletin **nouveau** du dossier les suit, et les fige avec son calcul (règle 5.0.0) ; un bulletin que le client
  a établi dans son SkanFact garde les siens (1.64.0).
- **Dans un dossier tenu**, ces taux sont ceux du client. Un bulletin **modifié** garde ceux de son calcul (un bulletin
  de septembre, les taux de septembre : les barèmes ne sont pas datés, 1.59.0, P2) ; quand ses taux diffèrent de ceux
  d'aujourd'hui, sa fenêtre offre une case, **décochée**, qui les dit chacun (« Prendre les taux de la paie
  d'aujourd'hui : TFP 2 % (1 % sur ce bulletin) ») : cochée, l'aperçu calcule avec eux, et l'enregistrement aussi
  (`ajouterBulletin(…, { tauxDuJour })`, compta.js ; le pont ne l'accepte que pour un dossier tenu). Le comptable qui
  règle après coup le bon taux d'accident du travail refait ainsi septembre ; rien ne change sans ce geste. Le dossier
  d'un client qui tient sa paie dans SkanFact n'a pas cette case : les taux du dossier au Cabinet ne sont pas les siens
  (règle de la 1.64.0).
- *Corrigé avant l'envoi* : une première version recalculait d'office un bulletin modifié aux taux du jour (avec un
  avertissement) ; un taux changé depuis le mois du bulletin l'aurait réécrit à tort. La case rend le choix au comptable.

### Ce qui le prouve

- `tests/cabinet/guides.test.ts` : la fiche garde les trois taux, dans leur forme ; une autre forme, un taux du régime
  sont refusés.
- `tests/web/cabinet-paie-regimes.test.ts` : à la souris, un taux du client trop fin refusé sur sa case, la case grise
  d'un contrat qui suit le taux du client, la fiche du serveur, le panneau, la fenêtre rouverte, et le barème que le
  serveur garde avec le bulletin d'un salarié en CIVP (accident du travail 2,5 %, TFP 1 %, FOPROLOS du barème) ; une
  case vidée qui revient au barème ; le bulletin de mars modifié : la case dit la TFP qui change, décochée ; enregistré
  sans elle, il garde ses taux ; avec elle, il prend la TFP d'aujourd'hui, et le coût employeur de l'aperçu est celui du
  serveur.
- `tests/web/cabinet-paie.test.ts` : le bulletin modifié de la 1.64.0 l'est désormais dans le dossier d'un vrai client
  sur SkanFact (une entreprise, son mandat, comptabilité et paie), qui garde son barème, sans la case.
- Seize preuves (`tests/preuves.sh`, « 1.66.0 »).

### Ce qui reste

- ~~Un bulletin **nouveau** établi au Cabinet pour un client qui fait sa paie dans SkanFact prend les taux réglés au
  Cabinet, pas encore ceux de ses réglages~~ : fait en 1.67.0 (« Le Cabinet lit les réglages de paie du client »).

## Le Cabinet lit les réglages de paie du client (19/10/2026, 1.67.0)

*Deux chemins, deux chiffres : le Cabinet calculait les bulletins d'un client sur SkanFact avec d'autres taux que les siens.*

### Le défaut

Un client qui tient sa paie dans son SkanFact y règle ses taux (**Paie › Barèmes** : l'accident du travail de son
activité, sa TFP, ses taux par contrat, son barème). Ils vivent à la racine de son dossier (`payrollSettings`), que la
base ne laissait pas lire au cabinet (0035 ne lui ouvre que le plan et, sous un mandat de paie, les salariés et les
bulletins). Sous un mandat de paie, chaque bulletin que le Cabinet établissait pour lui prenait donc les taux par défaut,
ou ceux qu'un comptable avait réglés dans la fiche du dossier (1.66.0) : un autre chiffre que celui du SkanFact du client.

### Ce que le lot fait (migration `0148`, `serveur/paie/routes.ts`, `pont-cabinet.js`, `web/v10/paie-cabinet-reglages.txt`)

- **La base** (0148) laisse le cabinet **lire** `_racine/payrollSettings` sous un mandat qui comprend la paie, et rien
  d'autre de la racine du dossier ; la règle ne vaut que pour la lecture : il ne peut ni le modifier, ni l'effacer.
- **La route de la paie** (`GET …/paie/dossier`) le rend avec les salariés et les bulletins ; son écriture reste
  limitée aux salariés et aux bulletins.
- **Le pont** pose ces réglages dans le livre (`L.reglagesPaie`) pour le dossier d'un client sur SkanFact (un objet
  vide s'il n'a rien réglé : ce sont alors les taux par défaut, comme dans son SkanFact) ; un dossier **tenu** n'en a
  pas (ses réglages restent ceux de sa fiche au Cabinet). Chaque bulletin du client s'enregistre avec eux.
- **L'écran** : le panneau des salariés dit « **Réglés dans son SkanFact** — Ce client : Accident du travail 2,25 %,
  TFP 1 % · CIVP : … » ; « Voir les taux de la paie… » ouvre une fenêtre **en lecture** (ses taux, « le sien » ou « le
  barème général », ses taux par contrat), qui dit où il les règle ; la fenêtre d'un bulletin calcule avec eux ; la case
  « Prendre les taux de la paie d'aujourd'hui » (1.66.0) s'offre aussi quand le client a changé un taux depuis le
  bulletin ; l'aperçu dit qu'un régime de contrat est « réglé dans son SkanFact ».
- **Ce qui part au serveur** : rien de plus. Ce qui en revient au Cabinet, compté : un objet de plus, les réglages de paie
  du client, sous le seul mandat de paie (docs/cabinet.md, C50).

### Décidé par délégation (19/10/2026)

- Le Cabinet **lit** les réglages de paie du client et ne les **change pas** : le mandat de paie ouvre ses salariés et
  ses bulletins, pas ses réglages, et le Cabinet n'écrit jamais chez un client sans son accord. Pour en corriger un, le
  comptable le demande au client ; la fenêtre le dit.
- Les documents imprimés lisent le calcul figé de chaque bulletin : rien n'y change.

### Ce qui le prouve

- `tests/cabinet/paie.test.ts` : dans la base, sous un mandat de comptabilité, le cabinet ne lit pas les réglages de paie ;
  sous un mandat de paie, il les lit, ni la société ni le reste de la racine ; il ne les modifie ni ne les efface ; la
  route les rend, et refuse de les écrire.
- `tests/web/cabinet-paie-reglages.test.ts` : à la souris, sur un vrai client SkanFact (accident du travail 2,25 %, TFP
  1 %, un CIVP sans CNSS patronale) : le panneau, la fenêtre en lecture (aucune case), un bulletin d'octobre établi au
  Cabinet à ses taux (le barème que le serveur garde ; l'aperçu au millime du serveur) ; puis le client remet sa TFP à
  2 % : le bulletin rouvert garde la sienne (l'aperçu au coût que le serveur garde), la case lui donne la nouvelle ; ses
  réglages et la fiche du dossier au Cabinet sont restés intacts.
- Douze preuves (`tests/preuves.sh`, « 1.67.0 »), et quatre anciennes reprises.

### Ce qui reste

- Les **heures supplémentaires** : les majorations du client (`hsMaj1` à `hsMaj3`) se lisent désormais, mais le Cabinet
  n'a pas de pointage (celui de l'entreprise, 1.60.0) ; un bulletin du Cabinet reprend les primes d'heures
  supplémentaires qu'on y tape.

## Les primes de chaque mois au Cabinet (20/10/2026, 1.68.0)

*Une prime posée une fois sur la fiche, que chaque bulletin reprend : l'entreprise l'avait depuis la 1.59.0, le Cabinet
non.*

### Le défaut

L'entreprise pose sur la fiche d'un salarié ses primes de chaque mois (une prime de présence, de transport ; « au jour »
ou fixe), et chaque bulletin nouveau les reprend, une prime au jour au prorata des jours payés (1.59.0). Au Cabinet, la
fiche du salarié n'avait pas ces primes : un bulletin nouveau partait sans elles, et le comptable les retapait chaque
mois, ou les oubliait. Pire, pour un client sur SkanFact, le Cabinet lisait la fiche sans ses primes : elles
n'apparaissaient nulle part de son côté.

### Ce que le lot fait (`web/v10/paie-cabinet-primes.txt`, `pont-cabinet.js`)

- **Le calcul** (`primesDuMois`) passe dans le moteur commun (`compta.js`, que le Cabinet charge) ; `core.js` le reprend
  tel quel : une seule copie, qui ne peut pas diverger (ses quatre preuves de la 1.59.0 l'ont suivi).
- **La fiche du salarié** au Cabinet a son panneau « Primes de chaque mois (DT) » : un libellé, un montant, « imposable »,
  « au jour » (cochée d'office, comme dans l'entreprise) ; « + Prime », « ✕ ». Un montant illisible ou négatif se refuse
  sur sa case (« Une prime ne peut pas être négative : une retenue se saisit sur le bulletin. »). Une ligne sans libellé ni
  montant ne se garde pas. La fenêtre est large dès l'ouverture, comme celle de l'entreprise (vu à l'écran : la première
  prime la faisait passer de 580 à 860 pixels, et « + Prime » fuyait sous le curseur).
- **La liste des salariés** dit, sous le brut, « + 105,500 DT de primes » (celles d'un mois entier), comme l'entreprise ;
  le menu d'un salarié dit que sa fiche porte ses primes.
- **Le pont** lit et écrit ces primes dans la forme de l'entreprise (`primes` : `label`, `amount`, `taxable`,
  `parJour`) : celles d'un client sur SkanFact apparaissent sur la fiche du Cabinet, et se gardent quand il la modifie.
- **Un bulletin nouveau** part des primes du salarié proposé ; elles suivent le salarié choisi, comme le brut, tant qu'on
  n'y a pas touché (une prime retouchée, retirée ou ajoutée à la main reste) ; une prime au jour suit ensuite les jours
  payés (deux jours d'absence sur 26 : 52 → 48,000). Le bulletin garde, avec chaque prime au jour, le montant de la fiche
  et les jours qui l'ont proratisée (1.63.0).
- **Ce qui part au serveur** : sur la fiche du salarié, le champ `primes` que l'entreprise écrit déjà (rien de nouveau
  dans sa forme) ; compté dans `docs/cabinet.md`, brique 43.
- L'aide (« i ») et la visite de la fiche disent ce qu'est une prime de chaque mois, et « au jour ».

### Ce qui le prouve

- `tests/web/cabinet-paie-primes.test.ts` : à la souris, dans un dossier tenu : une prime négative refusée sur sa case,
  rien d'écrit ; la fiche gardée au serveur avec ses deux primes (transport au jour, panier fixe non imposable) ; un
  bulletin nouveau qui les reprend d'office ; les primes qui suivent le salarié choisi ; deux jours d'absence qui font
  48,000 ; le bulletin enregistré avec ses marques ; la fiche rouverte avec ses primes et ses cases ; une prime retouchée
  qui reste au changement de salarié ; la liste qui dit « + 82,000 DT de primes » ; la fenêtre qui garde sa largeur à la
  première prime.
- Douze preuves (`tests/preuves.sh`, « 1.68.0 »), et cinq anciennes reprises : les quatre du calcul (1.59.0), qui le
  suivent dans le moteur commun, et celle de la largeur de la fiche de l'entreprise.

### Refait à la souris (20/10/2026)

Sur le client inventé du cabinet d'essai : deux primes posées sur la fiche (présence au jour 45,500, transport fixe 60),
relues après rechargement, et dites sous le brut ; un bulletin de novembre à trois jours d'absence qui les reprend
(40,250 = 45,500 × 23 / 26, et 60) : brut 1 118,000, net 923,867 DT, coût employeur 1 350,768 DT, au serveur comme à
l'aperçu.

### Ce qui reste

- ~~Le **pointage** au Cabinet (celui de l'entreprise, 1.60.0) : les heures supplémentaires d'un client s'y tapent encore
  en primes~~ : fait en 1.69.0 (« Le pointage au Cabinet », ci-dessous).
- À VÉRIFIER avec le comptable : quelles primes la convention collective proratise.

## Le pointage au Cabinet (20/10/2026, 1.69.0)

*L'entreprise pointe ses salariés depuis la 1.60.0 ; le Cabinet tenait la paie de ses clients bulletin par bulletin, sans
grille, et un bulletin nouveau ignorait l'entrée ou la sortie du mois.*

### Le défaut

Au Cabinet, un bulletin nouveau partait du brut de la fiche, sans absence : le comptable comptait à la main les jours
d'absence du mois et les heures supplémentaires (qu'il tapait en primes), et un salarié entré le 14 recevait un mois
plein (l'entreprise proratise depuis la 10.12.0). Les congés qu'un client sur SkanFact saisit, le Cabinet ne les voyait
pas : son bulletin et celui du client pouvaient différer d'une absence.

### Ce que le lot fait (migration `0149`, `serveur/paie/routes.ts`, `pont-cabinet.js`, `web/v10/paie-cabinet-pointage.txt`)

- **Le moteur** du pointage (la grille d'un mois, les jours payés, les heures supplémentaires, la reprise sur un
  bulletin) passe dans le moteur commun (`compta.js`, que le Cabinet charge), avec les natures de congé et celles qui sont
  payées ; `core.js` le reprend, une seule copie. Une fonction nouvelle, `saisieDuMois`, donne la saisie d'un bulletin
  nouveau lue sur la grille du mois : c'est celle de l'entreprise (`payslipInputFor`), ~~sans les avances~~ (avec elles
  depuis la 1.71.0, « Les avances au Cabinet », plus bas), au millime.
- **La base** (0149), sous un mandat qui comprend la paie : le cabinet tient le pointage du client (`timesheets` : il le
  lit et l'écrit, comme les salariés et les bulletins), et **lit** ses congés (`leaves`), sans les écrire. Rien d'autre.
- **La route de la paie** rend le pointage et les congés avec la paie, et écrit le pointage.
- **L'écran** : sous les bulletins du mois, « Le pointage d'octobre 2026 » — la grille de l'entreprise : une case par
  salarié et par jour, au clic (le code suivant), à la lettre (P, ½ par D, A, C, M, F, R) et aux flèches ; les jours
  payés et non payés de chacun ; une colonne par majoration d'heures supplémentaires réglée. Les congés du client s'y
  posent d'eux-mêmes ; un jour hors contrat ne se pointe pas ; un dimanche ne prend que « Repos » ou « Présent », et le
  dit. Chaque geste s'écrit au serveur, l'un après l'autre ; seul le panneau se redessine, et le curseur reste sur sa
  case. Un exercice clos se lit sans se changer. La grille tient dans la page du Cabinet, plus étroite que celle de
  l'entreprise (vu à l'écran : elle débordait de 70 pixels dès une colonne d'heures supplémentaires) ; au-delà, elle
  défile, le nom du salarié restant en place.
- **Un bulletin nouveau part du mois du salarié** : son entrée ou sa sortie (le brut proratisé sur les jours ouvrables hors
  contrat), ses absences non payées (ses congés, son pointage), ses primes de chaque mois au jour sur les jours payés
  (1.68.0), ses heures supplémentaires pointées. Ce qui est proposé suit le salarié et le mois choisis tant qu'on n'y a
  pas touché, et une note dit d'où vient le brut (« Brut proratisé : entrée le 14/10/2026, 15 jours sur 26 ») et que le
  mois est pointé. Une absence d'une demi-journée se tape.
- **Un bulletin déjà établi qui ne suit plus le pointage** le dit sous la grille (« 3,5 jours non payés au bulletin, 4,5 au
  pointage »), et « Reprendre le pointage dans le bulletin » le met à jour — un bulletin payé demande d'abord.
- **Les majorations** : celles d'un client sur SkanFact sont celles qu'il règle (Paie › Barèmes), et la fenêtre de ses
  taux les dit ; pour un dossier tenu, « Taux de la paie… » a sa section « Les heures supplémentaires » (les heures d'un
  mois complet, trois majorations), et la grille, sans majoration, y amène d'un bouton (« Régler les heures
  supplémentaires… »). Aucune n'est écrite d'avance.
- **Ce qui part au serveur**, compté : le pointage du client (dans sa forme : jours pointés, heures supplémentaires), et,
  dans la fiche d'un dossier tenu, quatre champs de plus (`paie.heuresMois`, `hsMaj1` à `hsMaj3`, en texte décimal).
  Ce qui en revient : ses congés, sous le seul mandat de paie (`docs/cabinet.md`, C50).

### Décidé par délégation (20/10/2026)

- Le pointage est tenu des deux côtés, dans le même objet : le client le voit dans son SkanFact, le Cabinet dans le sien.
  Les congés restent au client (le Cabinet les lit) : un congé se saisit là où on le décide.
- Le moteur du pointage ne lit de `data` que la paie : l'exception à la règle de `compta.js` (une fonction qui prend
  `data` reste dans `core.js`), écrite dans son en-tête, plutôt qu'une copie.
- Un bulletin nouveau au Cabinet proratise l'entrée et la sortie, comme l'entreprise : c'était un écart entre les deux.

### Ce qui le prouve

- `tests/moteur/paie-pointage-cabinet.test.ts` : deux chemins, un chiffre — la saisie du Cabinet et celle de
  l'entreprise, au millime, sur une entrée en cours de mois avec un congé sans solde, le même mois pointé (une absence,
  une demi-journée, six heures à +25 %), une sortie, un mois plein où la maladie ne se retire pas.
- `tests/cabinet/paie.test.ts` : dans la base, le pointage et les congés ne se lisent que sous un mandat de paie ; le
  pointage s'y modifie et s'y ajoute, les congés ni ne se modifient, ni ne s'effacent, ni ne s'ajoutent ; la route rend
  les deux, écrit le pointage et refuse d'écrire un congé ; le client voit le pointage du cabinet.
- `tests/web/cabinet-paie-pointage.test.ts` : à la souris et au clavier, sur un client sur SkanFact (sa grille, son congé,
  son dimanche, ses heures, le pointage relu après rechargement, un bulletin nouveau au net du serveur, puis l'écart et sa
  reprise), et sur un dossier tenu (la majoration réglée depuis la grille, refusée illisible, gardée dans la fiche, sa
  colonne, la grille d'octobre qui tient sans défiler, et son bulletin à 33,924).
- Vingt-six preuves (`tests/preuves.sh`, « 1.69.0 »), et seize anciennes reprises : les treize du pointage (1.60.0), qui le
  suivent dans le moteur commun, celles de la fiche, de la route de la paie et du bulletin nouveau (1.68.0).

### Refait à la souris (20/10/2026)

Sur le client inventé du cabinet d'essai : une demi-journée, une absence et un congé pointés en octobre au clic et au
clavier ; le bulletin d'octobre qui ne suivait plus le pointage, repris d'un geste (brut 1 084,125 DT, net 900,293 DT,
au serveur comme à l'écran) ; un bulletin de décembre établi après deux absences pointées (la prime de présence à 42,000,
24 jours sur 26 ; net 955,879 DT, coût 1 406,345 DT, au serveur comme à l'aperçu). Sur le dossier tenu : la majoration
de 25 % réglée depuis la grille (la fenêtre amène à sa case), sa colonne, quatre heures pointées. Vu et corrigé : la
grille qui débordait, le libellé « Heures d'un mois complet » qui décalait sa case, la note du bulletin qui parlait
d'heures supplémentaires quand il n'y en avait pas.

### Ce qui reste

- Le repos de la semaine est le dimanche, des deux côtés : contrairement à ce que cette ligne disait, aucun barème de
  l'entreprise ne le règle (corrigé en 1.70.0, avec l'aide qui l'annonçait).
- ~~Les congés d'un dossier tenu ne se saisissent pas au Cabinet : une absence se pointe~~ : fait en 1.70.0 (« Les congés
  au Cabinet », ci-dessous).
- Les heures supplémentaires au jour près, et l'import d'une pointeuse.

## Les congés au Cabinet (20/10/2026, 1.70.0)

*L'entreprise saisit les congés et absences de ses salariés depuis la 5.1.0, et en suit le solde ; le Cabinet lisait ceux
d'un client sur SkanFact (1.69.0), sans solde, et un dossier tenu n'en avait pas.*

### Le défaut

Pour un dossier tenu, le comptable pointait une absence jour par jour dans la grille : un congé de deux semaines faisait
douze cases, rien ne gardait sa nature ni son motif, et aucun compteur ne disait ce qui restait au salarié de son droit
annuel. Pour un client sur SkanFact, le Cabinet posait ses congés sur la grille, mais ne montrait ni leur liste ni le
solde de chacun. L'aide de l'entreprise annonçait un repos de la semaine « réglable dans les barèmes » : aucun barème ne
le règle.

### Ce que le lot fait (migration `0150`, `serveur/paie/routes.ts`, `FICHE.paie`, `pont-cabinet.js`, `web/v10/paie-cabinet-conges.txt`)

- **Le moteur** des congés (leurs jours ouvrables, leur part dans chaque mois, la liste de l'année, le solde) passe dans le
  moteur commun (`compta.js`, que le Cabinet charge) ; `core.js` le reprend, une seule copie.
- **La base** (0150) : le cabinet qui **tient** un dossier (`tenue_par`, 0019) en écrit les congés (`leaves`) sous le
  mandat de paie, et lui seul ; ceux d'un client sur SkanFact restent lus sans être écrits (0149), même par un cabinet qui
  aurait un mandat de paie sur un dossier tenu par un autre.
- **La route de la paie** écrit les congés d'un dossier tenu, et refuse ceux d'un client sur SkanFact en le disant
  (« Les congés d'un client sur SkanFact se saisissent dans son SkanFact… »), avant que la base ne le refuse.
- **L'écran** : sous le pointage, « Les congés et absences de 2025 » — le droit annuel et d'où il vient, le solde de
  chaque salarié en poste (acquis au prorata des mois travaillés, pris, solde ; la maladie et le sans-solde à part), puis
  la liste de l'année (paginée). Pour un dossier tenu, « + Congé ou absence… » ouvre la fenêtre de l'entreprise (le
  salarié, la nature, l'effet sur le salaire, du … au … en JJ/MM/AAAA, le motif), qui dit **avant** d'enregistrer les jours
  ouvrables, ce que l'absence fait au salaire et, pour un congé payé, le solde d'avant et d'après ; une ligne s'ouvre au
  clic ou au clavier pour se corriger ou se supprimer (la fenêtre demande). Chaque congé se pose de lui-même sur la grille
  du pointage ; un bulletin établi ensuite retire du brut une absence non payée, et un bulletin déjà établi qui ne suit
  plus le pointage le dit (1.69.0). Pour un client sur SkanFact, tout se lit, sans geste pour le changer.
- **Le droit annuel** d'un dossier tenu se règle dans « Taux de la paie… » (section « Les congés payés », de 1 à 60 jours
  ouvrables ; vide : celui du barème), où le panneau amène d'un bouton ; celui d'un client sur SkanFact est le sien, et la
  fenêtre de ses taux le dit.
- **Vu à l'écran et corrigé, dans les deux applications** (`web/v10/fenetre-entree.txt`) : dans une fenêtre qui porte
  « Supprimer » (rouge, à gauche) et « Enregistrer », **Entrée dans un champ cliquait « Supprimer »** — la règle commune
  prenait le premier bouton principal *ou* rouge — et la question qui suit se validait d'Entrée aussi : Entrée, Entrée
  supprimait ce qu'on voulait enregistrer. Entrée vise désormais le bouton principal, et le rouge seulement quand il est le
  seul geste (une confirmation). Les fenêtres touchées : une absence (l'entreprise et le Cabinet), un abonnement, la fiche
  d'un dossier, un guide de saisie. Et une absence hors du contrat du salarié (avant son entrée, après sa sortie), qui ne se
  posait sur aucun pointage mais entamait son compteur, se refuse des deux côtés (au Cabinet, l'annonce le dit avant) ; la
  fenêtre du Cabinet propose l'entrée du salarié plutôt qu'un jour d'avant.
- **Ce qui part au serveur**, compté : un congé d'un dossier tenu, dans la forme que l'entreprise écrit déjà (sept champs :
  `id`, `employeeId`, `kind`, `from`, `to`, `paid`, `note`) ; dans la fiche d'un dossier tenu, un champ de plus
  (`paie.leaveDaysPerYear`, en texte décimal).

### Décidé par délégation (20/10/2026)

- Les congés se saisissent là où on les décide : chez le client sur SkanFact (le Cabinet les lit), au Cabinet pour un
  dossier tenu (personne d'autre ne les saisirait). Seul le cabinet qui tient le dossier les écrit.
- Le repos de la semaine reste le dimanche des deux côtés : un réglage n'aurait de sens que s'il existait aussi chez
  l'entreprise. L'aide qui le disait réglable est corrigée. À VÉRIFIER avec le comptable : les entreprises qui chôment un
  autre jour.
- Le report d'une année sur l'autre (`leaveCarry`) que le moteur sait lire, aucun écran ne le saisit, ni chez l'entreprise
  ni au Cabinet : la colonne « Reporté » n'est pas montrée au Cabinet.

### Ce qui le prouve

- `tests/moteur/paie-conges-cabinet.test.ts` : deux chemins, un chiffre — le moteur commun et celui de l'entreprise, le
  même solde et la même liste ; le droit gardé en texte par la fiche (« 21.5 ») compte comme le nombre ; un congé à cheval
  sur juillet et août (cinq et six jours), une entrée le 16 mars (sept mois, 12,542 jours), une sortie le 30 juin
  (−1,25).
- `tests/cabinet/paie.test.ts` : un dossier tenu — le cabinet qui le tient y saisit, corrige et retire un congé, par la
  route et dans la base ; un autre cabinet n'y touche pas, même sous un mandat de paie ; la route refuse un congé d'un
  client sur SkanFact, en le disant. `tests/cabinet/guides.test.ts` : le droit annuel gardé dans la fiche, les formes
  fausses refusées.
- `tests/web/cabinet-paie-conges.test.ts` : à la souris et au clavier, sur un dossier tenu (les soldes, un congé saisi et
  lu avant d'enregistrer, refusé illisible, posé sur la grille, une absence sans solde qu'un bulletin nouveau retire, la
  correction au clavier, la suppression, le droit annuel réglé depuis le panneau, rien qui déborde) et sur un client sur
  SkanFact (son droit, ses congés et son solde, lus sans geste). `tests/web/paie-absence-fenetre.test.ts` : dans
  l'entreprise, Entrée dans le motif d'une absence l'enregistre, sans question de suppression ; une absence avant l'entrée
  du salarié se refuse.
- Trente preuves (`tests/preuves.sh`, « 1.70.0 » et « 1.70.0 (suite) »), et six de la 1.69.0 reprises sur leur ligne
  d'aujourd'hui.

### Refait à la souris (20/10/2026)

Sur le dossier tenu du cabinet d'essai (un salarié entré le 15 septembre, 18 jours au barème : 1,5 acquis) : un congé
payé du 22 au 24 septembre saisi dans la fenêtre (trois jours, le solde d'avant et d'après lu avant d'enregistrer, −1,5
dit en orange), posé sur la grille (C les 22, 23 et 24) ; corrigé au 23 au clavier ; une date avant l'entrée refusée, et
la fenêtre abandonnée d'Échap après sa question ; le droit annuel réglé à 24 jours depuis le panneau (2 acquis, solde 0).
Sur le client sur SkanFact : ses congés et son droit lus, sans geste. Vu et corrigé : **Entrée qui cliquait
« Supprimer »** (les deux applications, ci-dessus), le 1er septembre proposé pour un salarié entré le 15, « −1,5 jour »
au singulier quand « 1,5 jours » ne l'était pas, et le renvoi vers l'onglet du client (« Paie › Congés et absences »).

### Ce qui reste

- Une absence pointée « C » à la main sur la grille, sans être saisie comme congé, n'entame pas le compteur — des deux côtés,
  comme dans l'entreprise depuis la 1.60.0. À VÉRIFIER avec le comptable s'il faut les rapprocher.
- Le report d'une année sur l'autre (`leaveCarry`) ne se saisit nulle part.

## Les avances au Cabinet (20/10/2026, 1.71.0)

*L'entreprise prête de l'argent à ses salariés depuis la 5.1.0 : une avance, remboursée par retenues mensuelles sur les
bulletins, dont chaque bulletin nouveau propose l'échéance ; le serveur en écrit le versement (brique 34). Le Cabinet ne
les lisait pas.*

### Le défaut

Un bulletin que le Cabinet établissait pour un client sur SkanFact ne retenait rien d'une avance du client : l'échéance
se tapait à la main, ou s'oubliait, et l'avance restait ouverte chez le client mois après mois. Un dossier tenu ne pouvait
pas en saisir du tout. Dans la base, depuis la brique 60 (0035), le cabinet sous un mandat de paie pouvait **écrire** les
avances de tout client — aucune route ne le faisait, mais la règle le permettait. Et l'aide de l'entreprise disait que le
versement d'une avance « n'apparaît ni dans ta Trésorerie ni dans les écritures », faux depuis la 10.14.0 (l'aide de son
mode disait déjà le contraire).

### Ce que le lot fait (migration `0151`, `serveur/paie/routes.ts`, `pont-cabinet.js`, `web/v10/paie-cabinet-avances.txt`)

- **Le moteur** des avances (ce qui reste de chacune, lu sur les retenues marquées de son numéro dans les bulletins de son
  salarié, de toutes les années ; l'échéance d'un mois) passe dans le moteur commun (`compta.js`, que le Cabinet charge) ;
  `core.js` le reprend, une seule copie. La saisie d'un bulletin nouveau du Cabinet (`saisieDuMois`) porte désormais les
  échéances, comme celle de l'entreprise.
- **La base** (0151), comme pour les congés (0150) : le cabinet **lit** les avances d'un client sur SkanFact sous un
  mandat de paie (c'est le client qui verse l'argent), et n'**écrit** que celles d'un dossier qu'il tient. La règle de
  0035 est réécrite sans `advances`, le reste mot pour mot.
- **La route de la paie** lit et écrit les avances d'un dossier tenu (leur versement s'écrit par le même chemin que celui
  du client : journal de banque, ou de caisse pour des espèces), et refuse celles d'un client sur SkanFact en le disant
  (« Les avances d'un client sur SkanFact se saisissent dans son SkanFact… »), avant que la base ne le refuse.
- **L'écran** : sous les congés, « Les avances sur salaire de 2025 » — celles versées dans l'année, ou avant et encore à
  rembourser (ou remboursées en partie dans l'année) : le salarié, le jour, le mode, l'avancé, la retenue de chaque mois,
  ce qui a été retenu, ce qui reste (« soldée »), la note ; combien sont en cours et ce qui reste à retenir. Pour un dossier
  tenu, « + Avance sur salaire… » ouvre la fenêtre de l'entreprise (le salarié, versée le, le mode, le montant, la retenue
  mensuelle, la note), qui dit **avant** d'enregistrer en combien de mois elle se rembourse et la part du net habituel du
  salarié (au-delà de 30 % : « c'est beaucoup », À VÉRIFIER) ; une ligne s'ouvre au clic ou au clavier pour se corriger
  ou se supprimer (la fenêtre demande, et dit ce qui reste sur les bulletins). Pour un client sur SkanFact, tout se lit,
  sans geste pour le changer.
- **Le bulletin nouveau** du Cabinet propose l'échéance de chaque avance en cours du salarié (« Remboursement d'avance du
  05/10/2025 », la retenue convenue, jamais plus que ce qui reste), marquée du numéro de l'avance ; elle suit le salarié et
  le mois choisis tant qu'on n'a pas touché aux retenues, et se change ou se retire comme toute retenue.
- **Ce que la fenêtre refuse**, et pourquoi : une date hors de l'année regardée (le livre du Cabinet est celui d'une année :
  « change d'année en haut de la page ») ; une date après la sortie du salarié (aucun bulletin ne la retiendrait) ; un
  montant illisible, nul ; une retenue nulle ; une fois des retenues faites, un montant sous ce qui a été retenu, et un
  changement de salarié (ce qui est remboursé se lit sur les bulletins de SON salarié : chez un autre, elle se lirait non
  remboursée). **Les trois dernières règles valent aussi dans la fenêtre de l'entreprise** (une règle apprise d'un côté se
  vérifie de l'autre), qui les laissait passer.
- **Un défaut de la 1.63.0, corrigé** : le bulletin du Cabinet (établi ou modifié, `ajouterBulletin`) gardait les marques
  de ses primes, pas celle de ses retenues : le numéro de l'avance que chacune rembourse était jeté. Un bulletin d'un
  client sur SkanFact modifié au Cabinet ne remboursait donc plus son avance — elle restait ouverte chez le client, et le
  bulletin suivant en reproposait l'échéance. Trouvé par le parcours à la souris de ce lot.
- **Enregistrer ou supprimer une avance relit le livre de l'année**, comme un bulletin : le brouillard compte le versement
  écrit ou retiré sans qu'on recharge la page.
- **L'aide** du montant d'une avance, dans l'entreprise, dit où se lit son versement (la Trésorerie, les écritures).
- **Ce qui part au serveur**, compté : une avance d'un dossier tenu, dans la forme que l'entreprise écrit déjà (sept
  champs : `id`, `employeeId`, `date`, `amount`, `monthly`, `method`, `note`) ; une retenue de bulletin garde le numéro de
  son avance (`advanceId`, que le bulletin de l'entreprise y met déjà).

### Décidé par délégation (20/10/2026)

- Les avances se saisissent là où on les décide, comme les congés : chez le client sur SkanFact (c'est lui qui verse
  l'argent ; le Cabinet les lit et en retient l'échéance sur les bulletins qu'il établit), au Cabinet pour un dossier tenu.
- Une avance du Cabinet se saisit dans l'année regardée ; ses modes sont ceux d'un versement à un salarié (virement,
  chèque, espèces) — un mode venu d'ailleurs se garde tel quel.

### Ce qui le prouve

- `tests/moteur/paie-avances-cabinet.test.ts` : deux chemins, un chiffre — le moteur commun et celui de l'entreprise
  disent le même reste ; la saisie du bulletin nouveau du Cabinet porte les retenues de celle de l'entreprise, mois par
  mois ; 1 000,750 à 300,125 par mois (la dernière échéance ne prend que 100,375), une avance de novembre retenue
  jusqu'en février, une autre sans retenue convenue (retenue en entier), une retenue posée sur le bulletin d'un autre
  salarié qui ne rembourse rien ; l'aide du montant.
- `tests/cabinet/paie.test.ts` : un client sur SkanFact — ses avances lues avec la paie, jamais écrites (la porte le dit,
  la base refuse de les modifier, effacer ou ajouter) ; un dossier tenu — le cabinet qui le tient en saisit une, son
  versement s'écrit à la banque puis, corrigée en espèces, à la caisse, un bulletin en retient l'échéance, retirée elle
  quitte les écritures ; un autre cabinet, même sous un mandat de paie, la lit sans l'écrire.
- `tests/web/cabinet-paie-avances.test.ts` : à la souris et au clavier, sur un dossier tenu (une avance saisie, sa durée
  et la part du net lues avant d'enregistrer, les refus sur leur case, son versement écrit, le bulletin nouveau qui en
  retient l'échéance et la reprend en changeant de salarié, retenu et reste, la correction au clavier — ni sous ce qui a
  été retenu, ni d'un salarié à l'autre —, la suppression, rien qui déborde) et sur un client sur SkanFact (lue sans geste,
  retenue par le bulletin du Cabinet, et le SkanFact du client lit le même reste). `tests/web/paie-avance-fenetre.test.ts` :
  dans l'entreprise, les trois refus appris au Cabinet.
- Vingt-quatre preuves (`tests/preuves.sh`, « 1.71.0 »), et dix anciennes reprises sur leur texte d'aujourd'hui (la règle
  de 0035 réécrite par 0151, la liste des collections de la paie, la saisie du mois, la ligne des congés au clavier).

### Refait à la souris (20/10/2026)

Sur le dossier tenu du cabinet d'essai (un salarié entré le 15 septembre 2026, 1 300 DT brut) : « + Avance sur
salaire… » propose le 15/09, son entrée ; 1 200 DT à 400 par mois s'annoncent en orange (38,1 % du net habituel de
1 050,523 DT, « C'est lourd », À VÉRIFIER), ramenés à 300 ; l'avance s'enregistre d'Entrée depuis la note ; son
versement entre au brouillard (BQ, le 15/09, « Avances sur salaire — 09/2026 », 1 200,000). Le bulletin d'octobre
établi ensuite propose « Remboursement d'avance du 15/09/2026 — 300,000 » (net 750,523) ; après lui, la ligne dit
300 retenus et 900 de reste. Rouverte au clavier : le salarié grisé, un montant de 200 refusé sur sa case, la fenêtre
abandonnée d'Échap après sa question ; puis supprimée, après une question qui dit ce qui reste sur les bulletins.

Vu et corrigé : la date proposée avant l'entrée du salarié (le 1er septembre) ; l'annonce d'une retenue lourde qui
poussait « Enregistrer » de 17 points vers le bas (resserrée en trois lignes, la place qu'elle garde) ; l'annonce qui
disait l'avance « soldée » devant un montant qu'on allait refuser ; le brouillard qui ne comptait ni ne retirait le
versement avant qu'on recharge la page (le livre de l'année revient relu, comme après un bulletin). Et, trouvé par le
parcours à la souris automatique avant l'essai humain : **le bulletin du Cabinet jetait le numéro de l'avance** de
chaque retenue — un défaut de la 1.63.0 : un bulletin d'un client sur SkanFact modifié au Cabinet ne remboursait plus
son avance, qui restait ouverte chez le client et dont le bulletin suivant reproposait l'échéance.

### Ce qui reste

- Le compte de trésorerie d'une avance d'un dossier tenu (le Cabinet ne tient pas les comptes de trésorerie de
  l'entreprise) : le mode décide, banque ou caisse.
- Les avances n'ont pas d'état imprimé au Cabinet (l'entreprise non plus : elles se lisent sur les bulletins).

## Les documents du personnel au Cabinet (20/10/2026, 1.72.0)

*L'entreprise imprime depuis la 5.1.0 l'attestation de travail, le certificat de travail et le solde de tout compte d'un
salarié. Le Cabinet ne le pouvait pas.*

### Le manque, et ce que le chemin a montré

Un cabinet qui tient la paie d'un client établit aussi ses documents du personnel ; le Cabinet n'en avait aucun. En les
portant, trois défauts sont apparus :

- **La civilité** : les documents lisaient `gender` pour accorder (« immatriculée », « employée », « l'intéressée ») ;
  aucun écran ne l'écrivait, ni dans l'entreprise ni au Cabinet. Une salariée y était « employé », « l'intéressé ».
- **Deux chiffres pour une ligne** : l'indemnité de congés non pris se comptait dans la fenêtre au jour de la fenêtre et,
  sans bulletin, sur la fiche ; dans le document au jour du document et sur le dernier bulletin seul (zéro sans bulletin).
  Un solde préparé avant la sortie imprimait sous « Solde de congés non pris » un autre chiffre que sa propre ligne.
- **L'identité CNSS** : l'entreprise l'écrit `cnssName` (son fichier du trimestre la lit là) ; le point de contact du
  Cabinet lisait et écrivait `identiteCnss`, que l'entreprise ignore. Celle d'un client sur SkanFact n'arrivait pas au
  fichier CNSS du Cabinet (qui reprenait le nom), et celle saisie au Cabinet n'arrivait pas au sien.

### Ce que le lot fait (`compta.js`, `FICHE`, `pont-cabinet.js`, `web/v10/paie-cabinet-documents-personnel.txt`)

- **Le moteur commun** reçoit la liste des documents (`HR_DOCS`, déménagée de `core.js`, qui la reprend), la civilité
  (`CIVILITES` : Monsieur, Madame), l'indemnité de congés non pris (`indemniteConges`) et les lignes que le solde propose
  (`lignesDuSolde`). L'indemnité : le solde des congés **au jour de la sortie** (sans sortie, au jour du document), au
  salaire d'un jour du **dernier bulletin du salarié** (son brut sur les jours ouvrables d'un mois complet, 26 au barème),
  à défaut de bulletin de sa fiche ; un solde négatif n'indemnise rien. La fenêtre la propose, le document l'imprime : une
  fonction, un chiffre. *À VÉRIFIER avec le comptable : la base de l'indemnité (le dernier salaire, la moyenne de l'année).*
- **Au Cabinet**, le menu d'un salarié porte « Attestation, certificat, solde… » : la fenêtre de l'entreprise (le document,
  la date en JJ/MM/AAAA, le salaire sur l'attestation), imprimée par le moteur des documents de l'entreprise (`core.js`,
  `hrDocumentHtml`), au nom du client. Pour le solde, les lignes proposées se retouchent, s'ajoutent, se retirent ; le net
  à percevoir suit ; un montant illisible se refuse sur sa case, une ligne à montant sans libellé aussi.
- **Ce qui manque se dit avant d'imprimer**, avec le geste qui le renseigne : le gérant (« Le document dira « Je soussigné »
  sans nom » → la fiche du dossier, sur la case), la civilité (→ la fiche du salarié, sur la case ; enregistrée, le
  document se rouvre), la date de sortie (le certificat et le solde porteraient la date du jour). Les mêmes avertissements
  dans l'entreprise, qui disait déjà le gérant ; la civilité et la sortie s'y renseignent de même. Enregistrée, la fiche
  (du salarié ou du dossier) rend la main au document, sur le document qu'on avait choisi.
- **Le solde dit ce qui reste dû sur les avances**, sans le retenir : une avance retenue sur ce document resterait ouverte
  dans la paie (seul un bulletin la rembourse), et le bulletin de la sortie la retiendrait une seconde fois. *À VÉRIFIER
  avec le comptable : ce qui peut se retenir au départ.*
- **L'indemnité proposée suit la date du document** (sans sortie, c'est elle qui arrête le compte), tant qu'on n'a pas
  touché à la ligne ; retouchée, elle ne bouge plus. Dans les deux applications.
- **La fiche du dossier** gagne l'adresse et le gérant du client (`FICHE.adresse`, 300 caractères ; `FICHE.gerant`, 200) :
  l'adresse s'imprime en tête du bulletin (qui n'en avait pas au Cabinet) et des documents du personnel, et sa dernière
  ligne fait la ville du « Le Bardo, le … » ; le gérant signe « Pour la société ». La fiche d'un dossier, au chargement, ne
  garde que les champs qu'elle connaît (`migrateDossier`) : les deux y sont, sinon ils seraient jetés (vu par le parcours
  à la souris : le gérant enregistré, le document le réclamait encore).
- **La civilité** entre dans la fiche d'un salarié des deux côtés (« — à préciser — », Monsieur, Madame) ; les documents
  disent « Madame Salariée Numéro Une » et accordent ; non précisée, ni « Madame » ni « Monsieur », et l'accord reste au
  masculin.
- **L'identité CNSS** se lit sous les deux noms (un dossier tenu l'a sous l'ancien) et s'écrit sous celui de l'entreprise.
- **Les documents de la paie du Cabinet** (le bulletin, le journal, l'état CNSS, les documents du personnel) prennent les
  réglages du dossier — ceux du SkanFact du client s'il y tient sa paie — et sa paie avec ses congés et ses avances.
- **Ce qui part au serveur**, compté : deux champs de la fiche du dossier (l'adresse et le gérant, que le cabinet écrit
  sur son client) ; un champ du salarié (`gender`, « m » ou « f », ou vide), dans la forme que l'entreprise écrit ;
  l'identité CNSS d'un salarié écrite par le Cabinet sous le nom de l'entreprise (`cnssName`) au lieu d'un autre.

### Décidé par délégation (20/10/2026)

- Le solde de tout compte ne retient pas les avances : il dit ce qui reste dû ; un bulletin les rembourse. Aucune règle
  « tout le reste au départ » n'est posée sur le bulletin de la sortie : la part du salaire qui peut se retenir est À
  VÉRIFIER, et la valeur par défaut d'une règle inconnue est celle qui ne fait rien.
- La civilité, deux valeurs et l'inconnu ; l'accord par défaut reste celui de la v10 (le masculin), mais il se dit.
- L'adresse et le gérant d'un client sur SkanFact se tapent aussi dans la fiche du dossier : le cabinet ne lit pas la
  fiche société du client (son mandat de paie ouvre ses salariés et ses bulletins, pas son identité).

### Ce qui le prouve

- `tests/moteur/paie-documents-personnel.test.ts` : l'indemnité au jour de la sortie, quel que soit le jour du document
  (10,5 jours à 50,048, sur le dernier bulletin de ce salarié — ni le plus ancien, ni celui, plus gros et plus récent, d'un
  autre) ; sans sortie, la date arrête le compte ; sans bulletin, la fiche ; des congés pris d'avance n'indemnisent rien ;
  deux chemins, un chiffre (la ligne proposée et le document, préparé avant la sortie) ; la civilité et ses accords ; la
  fiche du Cabinet garde la civilité, rien d'autre.
- `tests/cabinet/guides.test.ts` : l'adresse et le gérant se gardent dans la fiche ; trop longs ou d'une autre forme,
  refusés.
- `tests/web/cabinet-documents-personnel.test.ts` : à la souris sur un dossier tenu — les deux avertissements, la civilité
  renseignée depuis le document (la fiche ouverte sur la case, le document qui revient), écrite `gender`, l'identité CNSS
  gardée `cnssName` ; le gérant et l'adresse renseignés depuis le document ; le solde proposé (525,504 pour 10,5 jours, la
  même que l'entreprise), les avances dites, un montant illisible refusé sans fenêtre d'impression, une ligne ajoutée ; le
  solde et le certificat imprimés (« Madame », « employée », « l'intéressée », le gérant, l'adresse, la ville).
  `tests/web/paie-documents-personnel.test.ts` : dans l'entreprise, la civilité renseignée depuis le document ; l'indemnité
  qui suit la date du document (225,216 au 31 mars, 450,432 au 30 juin), qui ne bouge plus une fois retouchée ; les
  avances dites.
- Trente-six preuves (`tests/preuves.sh`, « 1.72.0 »), et une ancienne reprise sur son texte d'aujourd'hui (le nom du
  salarié écrit par le Cabinet).

### Refait à la souris (20/10/2026)

Sur le dossier tenu du cabinet d'essai (un salarié entré le 15 septembre 2026, sans civilité ni sortie ; un droit
annuel de 24 jours, deux jours de congé pris) : le menu du salarié porte « Attestation, certificat, solde… » ; la fenêtre
dit les deux manques, le gérant et la civilité, chacun avec son bouton. « Renseigner sa civilité… » ouvre la fiche du
salarié sur la case ; « Monsieur » choisi, enregistrée, le document revient sans l'alerte. « Renseigner le gérant… » ouvre
la fiche du dossier sur la case ; l'adresse s'écrit sur deux lignes (Entrée y passe à la ligne, sans enregistrer). Le
solde, sans sortie, propose « congés non pris (0 jour) » — juste : 2 jours acquis au 20 octobre, 2 pris, ce que dit le
panneau des congés ; « Renseigner sa sortie… » ouvre la fiche dans la date ; le 31/10/2026 tapé et enregistré d'Entrée, le
solde revient avec « 2 jours », 100,000 (deux mois de droit à 24 jours, moins les deux pris, à 50 par jour). Le salaire du
mois ajouté, le document imprimé : l'adresse en tête, « et Monsieur … employé du 15/09/2026 au 31/10/2026 en qualité de
Serveur », 1 400,000 de net, la phrase des congés qui redit 2 jours et 100,000, « Le Bardo, le 20/10/2026 ».

Vu et corrigé : la fiche du dossier ne rendait pas la main au document (il fallait repasser par le menu), quand celle du
salarié la rendait ; la sortie absente était la seule des trois alertes sans bouton (les deux applications) ; un document
rouvert après une fiche revenait sur l'attestation au lieu du document choisi ; la fiche de l'entreprise ouverte pour une
date mettait le curseur dans le champ caché. Et, par le parcours à la souris automatique : la fiche d'un dossier jetait au
chargement l'adresse et le gérant (la liste des champs gardés ne les connaissait pas). Vu sans défaut : le « Net à
percevoir » s'écrit avec l'espace fine des milliers, comme partout dans l'application.

### Ce qui reste

- Le solde de tout compte ne s'enregistre pas : c'est un document, comme dans l'entreprise. Ses montants (préavis, fin de
  contrat) restent à celui qui l'établit.
- L'adresse et le gérant d'un client sur SkanFact ne viennent pas de sa fiche société (fermée au cabinet).

## La déclaration annuelle d'employeur au Cabinet (20/10/2026, 1.73.0)

*La Liasse du Cabinet ne donnait que les masses du livre, et disait : « Le détail par bénéficiaire demande les bulletins de
paie, que le cabinet ne reçoit pas. » Sur la plateforme, il les a.*

### Le manque, et ce que le chemin a montré

La déclaration annuelle d'employeur porte, pour les salaires, une ligne par salarié ; l'entreprise la prépare depuis la
v10 (Paie › Déclarations), le Cabinet n'en donnait que les masses, avec une phrase devenue fausse : la paie d'un dossier
— celle que le Cabinet tient, ou celle du SkanFact du client — est dans son livre depuis la 1.63.0. En la portant, deux
défauts sont apparus :

- **Les retenues étaient le solde du compte.** La case « Retenues à la source sur salaires » lisait le solde créditeur du
  4321, et celle des fournisseurs celui du 4322. Chaque versement au Trésor débite le compte : au 31 décembre, il ne reste
  que la retenue du dernier mois. La déclaration aurait porté décembre pour l'année ; celle des fournisseurs, rien.
- **Deux chiffres sous un nom, dans l'entreprise.** La colonne « Net versé » de la déclaration additionnait tous les
  bulletins de l'année, payés ou non ; la tuile « Net versé » de la même page ne compte que les bulletins payés.

### Ce que le lot fait (`compta.js`, `core.js`, `web/v10/paie-cabinet-declaration-employeur.txt`)

- **L'état des salaires de l'année par salarié passe dans le moteur commun** (`salairesDeLAnnee`, déménagé de
  `employerAnnual` de `core.js`, qui la reprend) : par salarié, les mois de bulletin, le brut, la CNSS retenue, l'IRPP, la
  contribution sociale de solidarité, le net ; le total de chaque colonne est la somme de ses lignes. Ses colonnes
  (`COLONNES_SALAIRES_ANNEE`) font le fichier CSV des deux applications.
- **Au Cabinet, la Liasse** porte, sous « Déclaration annuelle d'employeur », **les salaires par salarié** — lus sur les
  bulletins de l'exercice, par la fonction de l'entreprise ; une CIN manquante se dit « à renseigner », et ce mot ouvre la
  fiche du salarié sur la case —, exportables en CSV avec leur total ; puis **les masses du livre**. Sans bulletin, l'état le dit (une paie établie ailleurs se confronte
  aux masses).
- **Chaque masse dit son écart aux bulletins** (`ecartsEmployeur`) : les salaires (le 64 hors charges sociales) face au
  brut des bulletins, les retenues sur salaires (le 4321, où l'écriture de paie porte l'IRPP et la contribution sociale)
  face à ce que les bulletins retiennent. Dans son sens, avec ce qui le fait d'ordinaire : le livre porte moins, une
  écriture de paie au brouillard ou pas encore passée ; il porte plus, une charge de personnel ou une retenue saisie à la
  main. Un écart ne bloque rien ; quand le livre porte moins, « Ouvrir la saisie » mène au brouillard, où la paie se
  valide.
- **Les retenues sont celles de l'exercice** : ce que ses écritures ont porté au crédit du compte, moins ce que leurs
  contre-passations et extournes en ont retiré ; les à-nouveaux (le reste de l'an passé) n'en sont pas, les versements au
  Trésor non plus. Pour les salaires comme pour les fournisseurs.
- **Dans l'entreprise**, la colonne s'appelle « Net des bulletins », et le CSV de la déclaration porte son total.
- L'aide de la Liasse (`li.employeur`) dit où se lit le détail par salarié, et ce que sont les retenues.
- **Ce qui part au serveur** : rien de plus. Le Cabinet lit ce qu'il avait déjà (les bulletins et les salariés du dossier).

### Décidé par délégation (20/10/2026)

- Un débit du compte de retenues qui n'est pas un miroir (contre-passation, extourne) est un versement : une
  régularisation passée en débit direct ne se retranche donc pas des retenues de l'année. *À VÉRIFIER au premier dossier
  réel.*
- L'état par salarié reste celui de la v10 (les colonnes de l'entreprise) : le formulaire officiel de la déclaration
  (l'annexe des salaires, ses codes et ses colonnes) ne s'écrit qu'avec un vrai fichier en main, jamais en devinant.
- Les comptes lus sont ceux du plan par défaut (64, 645 et 647, 4321, 4322), comme la v10.

### Ce qui le prouve

- `tests/moteur/paie-declaration-employeur.test.ts` : les salaires de l'année par salarié (deux salariés aux mois
  différents, un bulletin d'une autre année, des montants au millime) ; deux chemins, un chiffre — la déclaration de
  l'entreprise compte avec la fonction du Cabinet ; les retenues de l'exercice sur un livre qui a des à-nouveaux, deux
  versements au Trésor, un mois contre-passé puis réécrit, un brouillard (901,693, quand le solde dirait 482,662) et une
  retenue sur fournisseur versée (15, quand le solde ne dirait rien) ; les écarts, dans leur sens, avec leur cause.
- `tests/web/cabinet-declaration-employeur.test.ts` : à la souris sur un dossier tenu — sans bulletin, l'état le dit et
  la phrase de la v10 a disparu ; les bulletins écrits, l'état porte chaque salarié et les totaux du moteur commun ; la paie
  au brouillard, les deux masses disent leur écart ; validée, plus d'écart ; un versement au Trésor ne change pas les
  retenues ; le CSV, aux colonnes de l'entreprise, avec son total. `tests/web/parcours.test.ts` : dans l'entreprise, « Net
  des bulletins » et le CSV de la déclaration avec son total.
- Vingt-six preuves (`tests/preuves.sh`, « 1.73.0 »).

### Refait à la souris (20/10/2026)

Sur le dossier tenu du cabinet d'essai (un salarié entré le 15 septembre 2026 ; ses bulletins de septembre, au prorata,
et d'octobre ; la paie des deux mois au brouillard) : la Liasse, sous « Déclaration annuelle d'employeur », porte le
salarié (2 mois, 1 975,127 de brut, 135,673 d'IRPP, 7,945 de contribution sociale, 1 266,801 de net), sa CIN « à
renseigner », et les deux masses du livre vides, chacune avec son écart (« Le livre porte moins : une écriture de paie au
brouillard ou pas encore passée »). « à renseigner » ouvre la fiche du salarié, le curseur dans la CIN ; tapée, enregistrée
d'Entrée, la Liasse la montre aussitôt. « Ouvrir la saisie » mène au brouillard, deux pièces de paie ; « Valider les 2 pièces
de PAIE » valide septembre et garde octobre au brouillard, en le disant (une écriture du 31/10 ne se valide pas avant son
jour). Revenue à la Liasse : 675,127 de salaires au livre pour 1 975,127 sur les bulletins — l'écart de 1 300,000 est le
brut d'octobre —, et 19,981 de retenues pour 143,618 (l'écart, 123,637, est la retenue d'octobre). Le CSV : l'en-tête, la
ligne du salarié avec sa CIN, le total.

Vu et corrigé : « à renseigner » était un texte sans geste, et l'écart « au brouillard » n'offrait pas d'aller à la saisie.
Vu sans défaut propre au lot : dans la phrase d'écart, l'espace fine des milliers (celle de toute l'application) se
dessine presque sans largeur avec la police de la machine d'essai, hors des colonnes de chiffres.

### Ce qui reste

- Le formulaire officiel de la déclaration annuelle (l'annexe des salaires, ses codes) : avec un vrai fichier en main.
- Un tableur qui ouvre le CSV d'un double-clic peut retirer le zéro de tête d'une CIN : l'importer en texte. *À VÉRIFIER
  avec les pilotes, sur leur tableur.*
- Les comptes du plan propre à un dossier (un compte de retenues autre que 4321) ne sont pas suivis : ceux du plan par
  défaut, comme la v10.

## Payer les salaires du mois (20/10/2026, 1.74.0)

*Un bulletin se marquait payé un par un, aujourd'hui, sur le compte par défaut. Aucun ordre de virement à remettre à la
banque ; le RIB d'un salarié ne se contrôlait pas (celui de la société, si).*

### Ce que le lot fait (`core.js`, `app.js`, `guide.js`, `web/v10/paie-virement-salaires.txt`)

- **« Payer les salaires… »** paraît dans « Bulletins du mois » tant qu'un bulletin du mois n'est pas payé ; tous les
  bulletins établis, c'est le bouton principal (l'étape suivante). Il ouvre la fenêtre du mois : une ligne par bulletin
  non payé (le salarié, le mode de paiement, son RIB, son net), cochée ; le jour du paiement (aujourd'hui) et le compte
  d'où l'argent part (celui par défaut) ; le nombre de salaires cochés et leur total.
- **Le moteur** (`salairesAPayer`) : les bulletins non payés du mois, le mode du bulletin (sinon celui de la fiche), le
  RIB du salarié et son net ; ce qui manque à un virement se dit sur sa ligne — pas de RIB, ou un RIB que sa clé refuse
  (`verifRib`, le contrôle du RIB de la société).
- **Ce qui manque se dit avant le geste**, avec le bouton qui le règle : un salarié sans RIB, ou au RIB faux (« à
  renseigner », « à corriger » ouvre sa fiche, le curseur dans le RIB ; enregistrée, la fenêtre revient comme on l'a
  laissée — les cases, le jour, le compte) ; le compte sans RIB (« Renseigner son RIB… » ouvre la fiche du compte sur la
  case) ; le nom de la société absent (« Renseigner ta fiche… » ouvre Paramètres › Mon entreprise sur la raison sociale :
  l'ordre ne dirait pas qui l'envoie, il est éteint). Les salariés que l'ordre ne portera pas sont nommés — payés en
  espèces, ou sans RIB valable —, cochés ou non : cocher ou décocher une ligne ne change rien à la hauteur de la fenêtre.
- **L'ordre de virement** (`ordreDeVirementHtml`) : la société (nom, adresse, matricule fiscal), « À l'attention de » sa
  banque, l'objet (« virement des salaires de septembre 2026 »), le compte à débiter, une ligne par bénéficiaire (son RIB,
  son net), le total en chiffres et en lettres, la ville et le jour, « Pour la société » et le gérant, la place du cachet.
  Il porte les lignes cochées payées par virement à un RIB valable. *À VÉRIFIER avec la banque : certaines demandent leur
  propre formulaire, ou un fichier.*
- **« Marquer payés »** pose le jour et le compte du paiement sur chaque bulletin coché : l'argent sort de la trésorerie,
  une seule fois (le bulletin payé fait le mouvement, comme « Marquer payé » d'une ligne). « Annuler » le défait.
- **Le RIB d'un salarié se contrôle à la saisie**, comme celui de la société : « clé incorrecte », « 19 chiffres sur 20 ».
- L'aide du RIB d'un salarié dit qu'il s'imprime sur l'ordre de virement ; celle de la fenêtre dit ce que font ses deux
  gestes.
- **Ce qui part au serveur** : rien de nouveau — le jour et le compte du paiement d'un bulletin (`paidDate`,
  `accountId`), que « Marquer payé » écrivait déjà.

### Décidé par délégation (20/10/2026)

- L'ordre de virement est une lettre d'usage, pas un fichier de banque : le format des fichiers de virement des banques
  tunisiennes ne s'écrit qu'avec un vrai fichier en main, jamais en devinant.
- Le Cabinet n'a pas ce geste : il ne tient pas les comptes en banque d'un client, ni les RIB de ses salariés.
- Le jour proposé est aujourd'hui : le jour où l'on paie, pas la fin du mois du bulletin.

### Ce qui le prouve

- `tests/moteur/paie-virement.test.ts` : les salaires à payer (un bulletin payé et un d'un autre mois écartés ; le mode du
  bulletin qui l'emporte sur la fiche ; sans RIB, au RIB faux, en espèces) ; l'ordre (les lignes, le compte à débiter, le
  total en chiffres — la somme des nets — et en lettres, la ville et le jour, le gérant ; un salarié sans RIB absent).
- `tests/web/paie-virement.test.ts` : à la souris dans l'entreprise — sans nom de société, l'ordre éteint et la fiche
  ouverte sur la raison sociale ; « Payer les salaires… » bouton principal ; les manques dits ; décocher ne pousse rien ;
  le RIB d'un salarié renseigné depuis la fenêtre (une clé fausse dite à la saisie), la fenêtre revenue comme on l'a
  laissée ; le RIB du compte, la fiche ouverte sur la case ; l'ordre imprimé ; « Marquer payés » au serveur (le jour, le
  compte, et rien sur la ligne décochée) ; « Annuler ».
- Vingt-cinq preuves (`tests/preuves.sh`, « 1.74.0 »), et une de la 1.73 reprise sur son texte d'aujourd'hui.

### Refait à la souris (20/10/2026)

Sur une entreprise d'essai (trois salariés : Amel par virement avec son RIB, Karim par virement sans RIB, Nour en
espèces ; leurs bulletins de septembre non payés ; un compte en banque sans RIB) : la Paie s'ouvre sur octobre (ses
bulletins à établir) ; septembre choisi, « Payer les salaires… » est le bouton principal. La fenêtre nomme Karim (RIB à
renseigner) et Nour (espèces), et le compte sans RIB. « à renseigner » ouvre la fiche de Karim dans le RIB ; une clé fausse
dite aussitôt (« clé incorrecte »), corrigée, Entrée : la fenêtre revient avec son RIB. Nour décoché ; le RIB du compte
renseigné depuis la fenêtre ; l'ordre imprimé sur une page (« Deux mille vingt-trois dinars et six cent vingt-sept
millimes », Amel et Karim, le compte à débiter, « Le Bardo, le 20/10/2026 », le gérant). « Marquer payés » : Amel et Karim
payés au 20/10/2026, la tuile « Net versé » à 2 023,627 DT (801,426 restent à verser) ; Nour payé seul (« 1 salaire …
marqué payé »), le bouton disparaît ; « Annuler » le remet.

Vu et corrigé : décocher Nour retirait sa ligne de l'avertissement, qui rétrécissait, et le bouton « Renseigner son
RIB… » remontait sous le curseur (le clic suivant tombait à côté) ; la fiche du compte s'ouvrait dans son nom, pas dans
son RIB ; l'ordre s'imprimait sans le nom de la société (la fiche de l'entreprise d'essai n'en avait pas).

### Ce qui reste

- Le fichier de virement d'une banque (au format de chacune) : avec un vrai fichier en main.
- La date de valeur du virement, le libellé que la banque reporte sur le relevé du salarié : à la main, sur la lettre.

## La paie appliquée — lot 1 : « Le mois » (01/11/2026, 1.222.0)

*La maquette de la paie de l'entreprise (`docs/maquettes/paie.html`, revue en quatre passes : `docs/maquettes/revue-paie.md`)
entre dans l'application par lots. Demande de Skander (01/11/2026) : « avant de passer à celle de cabinet on va d'abord
implémenter celle-ci en entier, et comble le manque que tu trouveras ». Ce lot pose la page d'entrée : le mois.*

### Ce que le lot fait (`core.js`, `app.js`, `paie.css`)

- **L'en-tête porte UN geste principal, calculé** : « Établir les N bulletins » tant qu'il en manque, puis « Payer les
  salaires · total », puis « Remettre les N bulletins ». Les autres vues gardent le leur (un salarié, un congé, une avance).
  Le menu ⋯ porte le journal de paie, le registre du personnel et les réglages.
- **Six vues au lieu de neuf onglets** : Le mois, Pointage, Salariés (avec le registre), Congés et absences (avec les
  avances et prêts), Déclarations, L'année ; « Réglages » à droite. Le choix du mois et de l'année est à gauche des vues.
- **La frise du mois** (`paieDuMois`) : pointer, bulletins, payer, remettre, déclarer — chaque étape déduite des faits
  (bulletins établis, payés, remis ; la déclaration CNSS du trimestre), une seule « ici ».
- **« À traiter »** (`paieATraiter`) : ce qui manque aux fiches (un RIB pour un virement, un n° CNSS, un CDD qui finit dans
  60 jours) ; « Compléter » ouvre la fiche le curseur sur la bonne case. La pastille de « Salariés » compte ces choses-là,
  jamais l'effectif.
- **Trois chiffres** : le net (« à verser », ou « versé » quand tout est payé ; virement et espèces), le coût de la paie
  (brut + charges, et l'écart avec le mois d'avant), ce qui va à l'État (retenue du mois, CNSS du trimestre).
- **Les bulletins** : ceux qui changent d'abord (« Ce qui change ce mois »), puis « Comme septembre » ; l'écart du net sur
  chaque ligne ; « Payé par » ; un statut que tous partagent se dit une fois, sur la ligne du total.
- **« Remettre les bulletins »** : la fenêtre nomme chacun (à envoyer, ou à imprimer faute d'e-mail), prépare les PDF et
  pose `remisLe` sur chaque bulletin ; « Annuler » le retire.
- **« L'année »** : les quatre chiffres de l'année (coût, net versé, CNSS, impôt retenu) et le coût mois par mois.
- **Ce qui part au serveur** : un seul champ nouveau, `remisLe` (le jour de la remise) sur un bulletin.

### Ce qui le prouve

- `tests/web/paie-mois.test.ts` (écran ET serveur, photos en clair, en sombre et au téléphone) ; six preuves
  « paie 1.222 a à f » dans `tests/preuves.sh`. Les tests de la paie déjà là suivent les nouvelles places (avances sous
  Congés, registre sous Salariés, aucun bouton principal dans le corps).

### Ce qui reste (lots suivants)

- L2 : les documents en aperçu fidèle ; L3 : le pointage à la main ; L4 : salariés et fiche ; L5 : congés, avances,
  déclarations, l'année, réglages, qui fait la paie ; L6 : le téléphone, le bon à payer, la correction proposée par le
  cabinet.

## La paie appliquée — lot 2 : les documents en aperçu fidèle (01/11/2026, 1.223.0)

*Demande de Skander : « pouvoir voir le vrai document à exporter (aperçu) », et les documents qui manquaient (fiche de
paie, attestation de travail, etc.).*

### Ce que le lot fait (`compta.js`, `core.js`, `app.js`, `paie.css`)

- **L'aperçu est le document lui-même** (`poserApercu`, `apercuDocument`) : la feuille A4 telle que le PDF la sortira,
  à droite ; à gauche ce que c'est et d'où viennent les montants ; « Exporter en PDF » en bas.
- **Le bulletin** : « Voir le bulletin » dans le menu de sa ligne ; « Voir avant d'imprimer » dans « Remettre ».
- **Le journal de paie** (« Voir le document ») et **l'ordre de virement** s'ouvrent aussi en aperçu.
- **La fenêtre des documents du personnel** montre la feuille à droite, et elle suit chaque choix (document, date,
  mention du salaire, lignes du solde).
- **Cinq documents nouveaux** (`HR_DOCS`, `hrDocumentHtml`), dans l'entreprise comme au Cabinet : le contrat et
  l'avenant (en PROJET, à signer des deux, depuis la fiche), l'attestation de salaire (les trois derniers bulletins,
  brut et net), l'attestation de salaires et de retenues de l'année (la somme des bulletins de l'année), la fin de
  période d'essai. *Les modèles et mentions obligatoires : À VÉRIFIER avec le comptable.*
- **Ce qui part au serveur** : rien de nouveau.

### Ce qui le prouve

- `tests/web/paie-documents.test.ts` (photos `paie-apercu-bulletin.png`, `paie-apercu-attestation-salaire.png`) ;
  preuves « paie 1.223 a à d ». `paie-virement` passe par l'aperçu de l'ordre.

## La paie appliquée — lot 3 : le pointage à la main (01/11/2026, 1.224.0)

*Demande de Skander : « il faut pouvoir faire le pointage manuellement si on n'a pas de pointeuse ».*

### Ce que le lot fait (`app.js`, `paie.css`)

- **« Pas de pointeuse ? Tu pointes à la main »** : chacun est présent par défaut, selon ses jours de travail ; on note
  ce qui change.
- **« Aujourd'hui : qui n'est pas là ? »** : un geste par salarié (présent, absent, congé, malade, demi-journée), posé
  sur le jour même ; « Annuler » le défait. Un jour de repos le dit.
- **« Noter une période »** : un salarié, un code, du… au… : chaque jour ouvrable prend le code, jours à venir compris
  (une semaine de congé d'un coup) ; les jours de repos restent du repos ; « Annuler » défait tout.
- **Trois sous-vues** du Pointage : le mois (la grille, déjà là), **par salarié** (son mois jour par jour, d'où vient
  chaque code — ses jours de travail, un congé saisi, un pointage à la main —, chaque jour se corrige, ses totaux), **les
  horaires** (les jours de travail, le mois complet, les heures du mois, les majorations ; ce qui n'est pas réglé le
  dit ; la pointeuse : « pas encore »).
- **Ce qui part au serveur** : rien de nouveau (les codes du pointage, comme la grille).

### Pas encore (dit à l'écran)

- Lire le fichier d'une pointeuse ; les horaires d'équipe à l'heure près ; les jours fériés posés d'eux-mêmes.

### Ce qui le prouve

- `tests/web/paie-pointage-main.test.ts` (photos `paie-pointage-main.png`, `paie-pointage-salarie.png`) ; preuves
  « paie 1.224 a à d ».

## La paie appliquée — lot 4 : les salariés et la fiche d'un salarié (01/11/2026, 1.225.0)

### Ce que le lot fait (`app.js`, `paie.css`)

- **La liste** : « En poste » et « Partis » (avec leur nombre), une recherche (nom, CIN, n° CNSS, poste), le bandeau d'un
  CDD qui finit dans les deux mois, un tableau (contrat, n° CNSS, RIB « à demander », brut de base, coût par mois) et un pied
  qui compte ce qui reste à compléter.
- **La fiche d'un salarié** (`#/salarie/<id>`) : un en-tête avec sa pastille (à compléter, CDD qui finit, parti) et UN geste
  principal calculé (compléter, renouveler, son certificat, un congé), le menu ⋯ ; ce qui manque en bandeaux ; à gauche ses
  onglets (bulletins, congés, avances, documents, son départ, l'historique), à droite son contrat, son identité, comment le
  payer. L'historique se déduit de ce que la paie garde : aucune trace inventée.

## La paie appliquée — lot 5 : congés demandés, calendrier, prêts, qui fait la paie (01/11/2026, 1.226.0)

### Ce que le lot fait (`compta.js`, `core.js`, `app.js`, `paie.css`)

- **Une demande de congé** (`statut: 'demande'`) ne compte nulle part (solde, pointage, bulletin) tant qu'elle n'est pas
  acceptée (`congeRetenu`, une seule règle pour les deux applications). « Accepter », « D'autres dates… », « Refuser… » (la
  raison reste écrite, avec sa date).
- **Le calendrier du mois** : qui est absent, quel jour (congé, maladie, absence, demande en attente).
- **Les prêts** : une avance peut être un prêt, avec le mois de sa première retenue (`debut`) ; l'échéancier se lit.
- **Qui fait ma paie** : le cabinet la tient, je la fais et il la vérifie, ou seul ; le choix vaut à partir du mois suivant
  (`paieModeDes`), le mois en cours finit comme il a commencé (`paieModeAvant`). Les déclarations disent qui dépose.
- **Réglages** : l'état de chaque réglage (réglé, valeur par défaut, à vérifier).

## La paie appliquée — lot 6 : le bon à payer et la correction proposée (01/11/2026, 1.227.0)

*Fait à la suite des lots 1 à 5, puis comparé à la maquette en photos (clair, sombre, téléphone), fonctions comprises ;
les écarts trouvés sont comblés dans le même lot (demande de Skander : « compare la maquette au réel avec des captures
d'écran […] n'oublie pas les fonctionnalités aussi »).*

### Ce que le lot fait

- **Le bon à payer** : quand l'entreprise a ÉCRIT que son cabinet tient la paie (jamais déduit d'un cabinet relié), un
  bulletin se paie après son accord. L'en-tête dit « J'approuve les N bulletins » ; l'étape « Bulletins » de la frise dit
  « N à approuver » ; aucune ligne n'offre « Marquer payé » et la fenêtre « Payer » refuse en disant pourquoi. Approuver
  écrit `bonAPayerLe` sur chaque bulletin ; « Annuler » défait. Un bulletin changé après l'accord se réapprouve.
- **Les contrôles** (« Ce que SkanFact a contrôlé », `controlesDuMois`) tant qu'il reste à payer : un bulletin par salarié,
  aucun net négatif, les écarts sur le mois d'avant, le pointage repris, les avances retenues, l'entrée au prorata, les
  taux de l'année, les contrats, le n° CNSS, le RIB. Ceux qui demandent un geste en tête. Le SMIG n'est pas contrôlé : il
  n'est pas un réglage de la paie (À VÉRIFIER : l'ajouter, avec sa date).
- **La correction proposée par le cabinet** : un bulletin qui porte `correction` (qui, quand, pourquoi, les lignes avant/
  après, le net corrigé, les champs qu'elle change) montre un bandeau rouge et le tableau avant/après ; « Accepter la
  correction » (le geste principal) applique les champs, recalcule le bulletin et garde la trace (`reponse`, `reponduLe`) ;
  « Refuser, je m'en occupe » garde la raison. **Pas encore** : l'écran du Cabinet qui écrit la correction (la revue du
  Cabinet vient après) ; l'entreprise sait déjà la lire, l'accepter ou la refuser.
- **Demander une correction** (quand un cabinet est relié) et **« Écrire à mon comptable »** en haut : la demande part dans
  la conversation, déjà écrite, relue avant d'être envoyée (`prepare.texte`, côté entreprise : le texte seul).
- **Écarts comblés après les photos** : le nom du mois en entier ; le mode de la paie dans le sous-titre ; « Son arrivée »
  sur la fiche d'une entrée de moins de deux mois (ce qui est fait, ce qui est à demander, ce qui est À VÉRIFIER) ; « Pas de
  RIB : payé en espèces » ; la pastille de la fiche en étiquette ; « Ce que tu verses, et quand » dans les déclarations ;
  le récapitulatif de l'année et « Où va la paie du mois » par poste (la fiche n'a pas d'équipe : le poste en tient lieu) ;
  le calendrier des congés sur toute la largeur, un seul bouton plein par écran.
- **Téléphone** : le geste du mois tient en bas, au-dessus de la barre, sous le pouce ; la paie et la fiche d'un salarié
  n'affichent plus « Pensée pour un ordinateur ».
- **Ce qui part au serveur** : `bonAPayerLe` et la réponse à une correction, sur le bulletin ; `paieModeAvant` sur la fiche
  de l'entreprise. Rien d'autre.

### Ce qui le prouve

- `tests/web/paie-bon-a-payer.test.ts` (photos `paie-bon-a-payer.png`, `paie-correction.png`) ; preuves « paie 1.227 ».

## Revue de la paie — lot R1 : l'argent juste (01/11/2026, 1.228.0)

*La revue métier et UI/UX (`docs/revue-paie.md`, demande de Skander) a trouvé que la CNSS et la retenue payées ne sortaient
jamais de la trésorerie, et que le grand livre gardait leurs dettes pour toujours.*

- **Déposée et payée** : la CNSS d'un trimestre (`cnss-AAAA-TQ`) et les retenues et taxes sur les salaires d'un mois
  (`dm-AAAA-MM`) se notent dans une fenêtre : le montant de la déclaration (calculé par `montantSocial`, jamais retapé ;
  une pénalité se note à part), le jour, le compte, le mode, la référence. « Annuler » défait. La déclaration annuelle
  d'employeur, qui ne fait rien payer, garde son simple « Marquer déposée ».
- **Trésorerie** : une déclaration payée est une sortie (`source: 'social'`), qui se pointe sur le relevé.
- **Grand livre** : le paiement débite le 4531 (CNSS) ou, pour le mois, le 4321 (IRPP et solidarité) et le 4335 (TFP et
  FOPROLOS) selon les parts figées au paiement ; la banque ou la caisse au crédit. Le trimestre et ses trois mois payés
  ramènent ces dettes à zéro, au millime (deux chemins, un chiffre).
- **Un virement de salaire rejeté** : « Annuler le paiement… » (menu ⋯ d'un bulletin payé) remet le salaire à payer ; la
  raison et l'ancien paiement restent écrits sur le bulletin (`paiementsAnnules`). Un salaire pointé sur un relevé se
  dépointe d'abord.
- **Ce que tu verses, et quand** dit « payée le » pour la CNSS et pour le mois.
- **Ce qui part au serveur** : sur une déclaration, le jour du paiement, le montant, ses parts, le compte, le mode, la
  référence ; sur un bulletin, la trace d'un paiement annulé. Rien d'autre.

### Ce qui le prouve

- `tests/moteur/paie-declarations-payees.test.ts` (trésorerie et grand livre au millime) ; `tests/web/paie-bon-a-payer.test.ts`
  (« la retenue du mois déposée et payée ; un virement de salaire rejeté redevient à payer ») ; preuves « paie 1.228 ».


## Revue de la paie — lot R2 : la fiche complète, un salaire daté (01/11/2026, 1.229.0)

- **La fiche** porte l'e-mail (celui de « Remettre »), la date de naissance, l'adresse, le téléphone, la catégorie ou
  l'échelon, la fin de la période d'essai et l'horaire d'un temps partiel (À VÉRIFIER : la liste exacte que le registre et
  la déclaration annuelle demandent). L'e-mail et l'horaire se contrôlent à la saisie.
- **Un salaire qui change à une date** : sur un salarié déjà payé, changer le brut demande « à partir de » (un mois) ; la
  fiche garde `salaires` ([{ des, brut, avant, le }]). Le brut d'un mois est celui du dernier changement entré en vigueur
  ce mois-là ou avant (`brutDuMois`, `employeAuMois` dans `compta.js`, que les deux chemins lisent : `payslipInputFor` et
  `saisieDuMois`). Un bulletin d'un mois passé, refait plus tard, garde l'ancien brut. L'historique de la fiche le dit.

## Revue de la paie — lot R3 : corriger sans réécrire (01/11/2026, 1.230.0)

- **Régulariser** : un bulletin payé n'offre plus « Modifier » tout court mais « Régulariser sur un mois suivant… ». La
  somme (à ajouter ou à retirer, imposable ou non, avec son motif) se porte sur le premier mois suivant qui n'est pas payé
  (`employee.regularisations`, `regulsDuMois` dans `compta.js`). Si son bulletin existe, il la reçoit et se recalcule (il
  perd son bon à payer) ; sinon, elle l'attend. Le bulletin payé ne change pas. À VÉRIFIER : l'impôt d'un rappel se
  calcule-t-il sur le mois qui le paie (ce que fait SkanFact) ou se répartit-il sur les mois qu'il couvre ?
- **Le rappel d'une augmentation passée** : un salaire daté d'un mois passé refait les bulletins de ces mois pas encore
  payés, et propose, pour ceux déjà payés, un rappel de la différence sur le premier mois libre (« Annuler » défait).
- **La saisie sur salaire** (une décision de justice, une pension alimentaire) : sur la fiche, le créancier, le total, la
  retenue de chaque mois, à partir de quand (`employee.saisies`, `saisiesOf`/`saisiesDuMois`). La retenue se fait seule sur
  chaque bulletin nouveau, jamais au-delà du total. « Verser au créancier » sort l'argent de la trésorerie
  (`source: 'saisie'`, pointable) et du 425 au grand livre (À VÉRIFIER : un compte d'oppositions distinct ; la part du
  salaire que la loi permet de saisir n'est pas plafonnée ici).
- **Combien coûte une embauche ?** (menu ⊕ de la paie) : le brut, le contrat et la situation donnent le net et le coût par
  le calcul des bulletins ; rien ne s'enregistre ; « Ajouter ce salarié… » ouvre la fiche pré-remplie.

## Revue de la paie — lot R4 : l'arrêt maladie, l'import (01/11/2026, 1.231.0)

- **L'arrêt maladie** : la fenêtre d'une absence de cette nature montre le certificat reçu le et l'envoi à la CNSS ; qui
  paie ces jours se dit par « Effet sur le salaire » (rien n'est inventé : À VÉRIFIER avec la convention collective, les
  jours de carence, le délai du certificat). « À traiter » rappelle un arrêt des trois derniers mois sans certificat.
- **Importer ses salariés depuis un tableur** (page vide, menu ⊕, recherche) : le moteur d'import des clients et des
  fournisseurs (`planImport`/`appliquerImport`, type `salaries`) ; titres des tableaux de paie reconnus, dates jour/mois/année
  (ou le numéro de jour d'Excel), refus dits (nom, embauche, brut), un CIN déjà là reconnu, jamais doublé.

## Revue de la paie — lot R5 : la plateforme autour (01/11/2026, 1.232.0)

- **Aide** : les textes des vues (Le mois, pointage, horaires, l'année, déclarations) disent ce qu'elles font aujourd'hui.
- **Recherche** : les salariés par leur nom, leur poste, leur CIN ; « Payer », « Établir », « Remettre », « Approuver les
  bulletins du mois », « Nouveau salarié », « Importer mes salariés », « Combien coûte une embauche ? ».
- **Lecture seule** : un membre qui ne peut pas écrire la paie ne voit ni le bouton principal, ni « Marquer payé », ni les
  gestes des bandeaux, ni ceux de la fiche ; un bandeau dit pourquoi.
- **Hors ligne** : la paie reste en ligne (`docs/hors-ligne.md`) et le dit ; son geste principal attend la connexion.
- **Accueil** : une correction proposée, des bulletins à approuver (le cabinet tient la paie), une demande de congé.

## Revue de la paie — lot R6 : finitions (01/11/2026, 1.233.0)

- Au téléphone, un bulletin du mois est une carte simple (qui, ce qui change, le net) ; le geste du mois reste en bas.
- Le pointage prend son mois à côté de l'année : il n'a plus de second sélecteur dans sa carte.

### Ce qui prouve R2 à R6

- `tests/moteur/paie-corriger-sans-reecrire.test.ts` (salaire daté, régularisation, saisie et ses deux chemins, import,
  accueil et « À traiter ») ; `tests/web/paie-revue-ecrans.test.ts` (régulariser, saisie, simulation, recherche, import,
  arrêt maladie, un seul mois au pointage) ; preuves « paie 1.229 » à « paie 1.233 ».
- **Ce qui part au serveur** (sur la fiche du salarié) : ses coordonnées et son historique de salaire, ses régularisations,
  ses saisies et leurs versements ; sur une absence, les dates du certificat et de son envoi. Rien vers un tiers.

## L'interface de la paie au plus près de sa maquette (01/11/2026, 1.234.0)

Skander : « Y'a encore beaucoup d'écart d'interface entre la maquette et notre app. » Chaque écran de la paie a été
photographié à côté de son état dans `docs/maquettes/paie.html`, puis rapproché. Ce qui a changé :

- **Partout** : les bandeaux d'information en bleu (ambre pour ce qui attire, gris pour ce qui est neutre) ; les titres de
  colonne en casse ordinaire sur fond papier ; l'unité « DT » petite et grise après un montant ; le sous-titre dit
  « N salariés · qui tient la paie · le jour » ; un compteur sur l'onglet Déclarations (ce qui est en retard ou dû sous
  31 jours, `C.socialDue`).
- **Le mois** : les contrôles ne se montrent qu'avant le bon à payer (ou tant que rien n'est payé) ; une demande de congé
  arrive dans « À traiter » (`C.paieATraiter`, geste « Répondre ») ; chaque ligne dit ce qui change (heures sup, jours sans
  solde, prorata, avance, saisie, régularisation, ou « comme septembre ») et porte « Bulletin » ; **« Marquer payé » vit
  dans le menu de la ligne** (il n'est plus un bouton sur la ligne) ; le pied dit « 5 bulletins d'octobre · septembre : N ».
- **Payer les salaires** : la colonne « Comment » (le mode, puis le RIB masqué « ··· 2359 · contrôlé ») remplace le RIB
  en entier ; le pied dit le détail (« 4 virements … · espèces … ») ; le bouton porte le montant.
- **Salariés** : plus de sous-onglets (le registre du personnel est dans le menu ⋯) ; le pied tient sur une ligne
  (« 5 en poste · 1 à compléter · aucun départ en 2026 »).
- **La fiche** : « Préparer sa sortie… » pour un CDD qui finit ; le contrat court ; l'identité sans lignes vides ; le RIB
  masqué et dit contrôlé ; l'onglet Avances montre une barre par retenue.
- **Congés et absences** : plus de sous-onglets ; le calendrier a ses avatars ; « Les congés » (Acquis, Pris, Reste, Sans
  solde ; le report et la maladie sous le chiffre ; le total des jours restants, « à prendre, ou à payer au départ ») ;
  dessous, « Les avances et les prêts » en cours, une barre par retenue (la liste entière, soldées comprises, par
  « Toutes… »). Sans début choisi, une retenue part du mois de l'avance, comme au bulletin (`C.paieDuMois`).
- **Déclarations** : le panneau rouge « À déposer » disparaît : « Marquer déposée et payée… » vit sur la ligne de « Ce que
  tu verses » (ce qui reste dû d'avant s'ajoute en tête, avec le même geste) ; la déclaration du mois devient « La
  déclaration d'octobre, sa part paie », avec son pied « À verser au Trésor ».
- **L'année** : le récapitulatif sous le graphique tient dans sa carte ; les montants sans unité répétée.
- **Pointage** : une case vide est un jour de présence (la lettre reste pour le clavier et les lecteurs d'écran) ; le repos
  en colonne grise ; l'avatar devant le nom ; les totaux à droite ; la légende dessous ; le bandeau « à la main » en gris.

**Ce qui part au serveur** : rien de nouveau (des écrans).

## La paie du Cabinet : cinq vues, l'accord, la vérification, la correction proposée (01/11/2026, 1.235.0)

Les lots C1, C2 et C3 de `docs/revue-paie-cabinet.md`, et ses trois défauts.

- **Le Cabinet sait qui fait la paie.** L'entreprise écrit son choix (« Qui fait ma paie » : `paieMode`, `paieModeDes`,
  `paieModeAvant`) sur sa fiche, que le Cabinet ne lisait pas. La fonction `socle.mode_de_paie` (migration 0186) lui en
  donne ces trois champs et le nom du gérant, sous un mandat de paie, et rien d'autre de la fiche ; la route
  `GET /entreprises/:id/paie/dossier` les renvoie (`modePaie`).
- **Cinq vues** (Le mois, Salariés, Congés et avances, CNSS du trimestre, L'année ; le pointage s'ouvre de la première étape
  de la frise) au lieu d'une page de sept écrans. L'en-tête dit qui fait la paie ; la frise donne les cinq étapes et leur
  date ; **un seul bouton principal**, l'étape suivante, calculée par `parcoursPaie` ; quatre chiffres ; les bulletins rangés
  « Ce qui change ce mois » / « Comme <mois d'avant> », avec la raison sur la ligne ; le bulletin ouvert à droite (d'où vient
  chaque ligne, « Pourquoi cet IRPP ? », lu du calcul gardé avec le bulletin) ; ↑ ↓ et Entrée au clavier.
- **L'accord (paie tenue)** : « Envoyer à <client> pour accord » écrit `pourAccordLe` ; l'entreprise n'approuve (son bon à
  payer) que ce qui lui est envoyé : avant, son bouton dit « Ton cabinet prépare les N bulletins », éteint ; « Valider les N
  bulletins » écrit `valideLe` : un bulletin validé ne se modifie plus, ni au Cabinet (menu, pont) ni chez l'entreprise.
  Un bulletin dont le net change au Cabinet perd l'accord et la vérification (ils portaient sur l'autre).
- **La paie du client vérifiée** : plus de « Modifier » ni de « Supprimer » sur un bulletin du client (D3, la règle « le
  cabinet n'écrit jamais chez un client sans son accord ») ; « Vérifié » par bulletin ou pour tous ; « Proposer une
  correction… » (une retenue oubliée, une prime, des jours sans solde, et pourquoi) écrit `correction` sur le bulletin sans
  le changer : avant/après, le net qu'il aurait (le même moteur, le barème du bulletin), et les champs dans les termes de
  l'entreprise, qu'elle applique d'un geste si elle accepte (1.227.0) ; « La relancer », « Retirer la proposition » ; la
  réponse se lit en bandeau.
- **Paie faite par le client seul** : le Cabinet la lit et la passe en comptabilité ; aucun geste de paie.
- **D1** : une demande de congé pas encore acceptée se dit « demandée, pas encore acceptée » (« refusée » si refusée), plus
  « payée ». **D2** : « Passer l'écriture de paie », toujours éteint, a disparu ; la frise dit où en est l'écriture.

Tests : `tests/web/cabinet-paie-parcours.test.ts` (les trois parcours), `tests/web/paie-bon-a-payer.test.ts` (« tant que le
cabinet prépare »), et les tests de la paie du Cabinet qui changent de vue. Preuves `paie cabinet 1.235 a` à `g`, `paie 1.235 h`.

**Reste des lots** (C4 à C6) : « Les bulletins sont faits » (les envoyer, le rappel de paiement, déclarer), l'écriture de
paie compte par compte, régulariser après validation, le virement rejeté ; les vues Salariés, Congés, CNSS et L'année
telles que la maquette (pour l'instant les panneaux d'avant, rangés dans leur vue), le paramétrage, les écarts ligne à
ligne ; « La paie de tous mes dossiers », le pointage attendu (« Le demander »), le téléphone en cartes. Le rappel de
salaire attend la décision de Skander.

## La paie du Cabinet, après la validation, l'année, le pointage attendu (01/11/2026, 1.236.0)

Les lots C4 à C6 de `docs/revue-paie-cabinet.md`, ce qui s'en fait sans fonction nouvelle au serveur.

- **« Les bulletins <mois> sont faits »** (C4), une fois validés (ou vérifiés, pour une paie faite par le client) : 1. les
  remettre aux salariés (le bouton principal, « Marquer les N bulletins remis aux salariés », écrit `remisLe`) ; 2. les
  salaires, payés par le client (« N sur M payés »), et « Lui rappeler » (la demande dans la conversation, la même
  fenêtre que « Demander une pièce ») ; 3. les déclarer (« Ouvrir les déclarations »).
- **L'écriture de paie, compte par compte** : celle que le serveur tient au fil des bulletins, lue du livre, avec son état,
  sa date, ses lignes et son équilibre ; ouverte d'office quand les bulletins sont validés.
- **L'année, mois par mois** (C5) : le coût de chaque mois (bulletins, brut, net, coût employeur, une barre), et deux
  chemins, un chiffre : les douze mois additionnés doivent faire l'année calculée d'un coup (`#pa-annee-juste`).
- **Salariés** : la date de fin d'un contrat sous le contrat ; un CDD qui finit dans les 45 jours se dit en tête, avec ce
  qui reste **À VÉRIFIER** (l'indemnité de fin de contrat).
- **Le pointage attendu** (C6) : la frise dit combien de salariés sont pointés ; un mois sans bulletin ni pointage offre
  « Le demander à <client> » (paie tenue, client relié) et « Le saisir moi-même ».

Tests : `tests/web/cabinet-paie-parcours.test.ts` (le parcours « tenue » jusqu'à la remise, l'année, le CDD, le mois
attendu). Preuves `paie cabinet 1.236 a` à `e`.

**Pas encore fait** : les PDF des bulletins déposés dans les documents du client (le serveur ne range pas encore de
document chez lui pour le cabinet) ; régulariser après validation depuis cet écran (le bulletin du mois suivant le fait,
à la main) ; le virement rejeté ; le paramétrage du dossier et les écarts ligne à ligne ; « La paie de tous mes dossiers »
(il faut une lecture du serveur pour tous les dossiers d'un coup, à écrire) ; la fiche du salarié à droite et le projet
de sortie. Le rappel de salaire attend la décision de Skander.


## La paie du Cabinet, tout ce que montrent les maquettes (02/11/2026, 1.237.0)

Skander : « Y'a des fonctionnalités que t'oublies dans les maquettes ». L'inventaire, état par état, est au § 8 de
`docs/revue-paie-cabinet.md` ; ce lot fait tout ce qui s'y fait sans fonction nouvelle au serveur.

- **L'avance oubliée** (paie faite par le client) : une échéance de remboursement du mois que le bulletin ne retient pas
  se trouve d'elle-même (`KC.echeancesDuMois`). Un bandeau le dit, avec le net qu'il aurait ; le bouton principal devient
  « Proposer la correction à <client> », la fenêtre préremplie (la retenue, son montant, sa raison) ; acceptée, la
  retenue rembourse l'avance (elle garde `advanceId`).
- **Les contrôles du mois** (`#pa-controles`) : ce qui demande un geste d'abord, les justes ensuite, avec leur nombre :
  net négatif ou nul, écarts de plus de 5 % expliqués, pointage repris, avances retenues, prorata, heures sup (plafond
  **À VÉRIFIER**), taux du dossier (**À VÉRIFIER**), le SMIG (pas réglé dans SkanFact : **À VÉRIFIER**), bulletins
  égaux à l'écriture au millime ; un matricule CNSS qui manque se demande d'un geste.
- **Deux vues nouvelles** ouvertes depuis les contrôles : **les écarts ligne à ligne** (chaque rubrique de chaque salarié
  face au mois d'avant, avec sa source ; la somme des écarts doit faire l'écart du brut, au millime) et **le paramétrage
  du dossier** (ce qui est réglé, ce qui ne l'est pas, la convention d'abord).
- **Le volet du bulletin** : la situation (poste, contrat, fin, famille), l'état, le mode de paiement et le RIB masqué
  (« ··· 1234 » ou « RIB à demander »), « Le bulletin en PDF », « Modifier » seulement sur une paie tenue au cabinet.
- **Le mois** : un nombre sur Salariés et sur CNSS (les matricules qui manquent), le coût expliqué, le poste sous le nom,
  la touche P, l'écriture regroupée par compte, le mois d'avant en bas ; sans pointage, « Préparer sans pointage » et
  les entrées du mois.
- **L'année** : le brut des bulletins validés face au compte 640 du livre (validé), et la fin de l'année en cinq points
  avec le lien vers la déclaration annuelle d'employeur.
- **Salariés** : le résumé (en poste, contrats qui finissent, sortis), l'ancienneté, la colonne RIB, « Ses documents de
  sortie… » sur un CDD qui finit, « Les demander » pour ce qui manque à une fiche.
- **Congés et avances** : les absences des 60 prochains jours, et à qui revient la décision d'une demande.

Tests : `tests/web/cabinet-paie-parcours.test.ts` (« 1.237.0 — l'inventaire de la maquette… »). Preuves
`paie cabinet 1.237 a` à `e`.

**Pas encore fait** (serveur, ou décision) : « La paie de tous mes
dossiers » ; le rappel de salaire (décision de Skander).

## La paie du Cabinet, ce qui restait des maquettes (02/11/2026, 1.238.0)

La suite de l'inventaire (§ 8 de `docs/revue-paie-cabinet.md`), toujours sans fonction nouvelle au serveur.

- **L'échéancier d'une avance** (Congés et avances) : mois par mois, ce qui est retenu (lu sur les bulletins), ce qui ne
  l'est pas alors que le bulletin du mois est fait (« pas retenu »), et ce qui reste à venir, à la retenue convenue.
- **La ligne d'un bulletin** dit où en est l'avance : « avance : 2e retenue sur 3 · il restera 100,000 en novembre ».
- **Le volet** : le calcul des heures sup (heures × salaire d'une heure × majoration, le salaire d'une heure étant le brut
  sur les heures du mois des réglages) et « Contrôlé : … » (net positif, pointage repris, avance retenue, prorata).
- **« Lui rappeler »** les salaires propose le dernier jour du mois comme date (s'il n'est pas passé), et le message dit
  combien de salaires sont marqués payés.
- **La CNSS du trimestre face au livre** : ce que les écritures validées du trimestre font naître au compte CNSS (4531,
  ou celui du plan du dossier), contre le total à verser des bulletins (deux chemins, un chiffre) ; un écart se dit
  (écritures encore au brouillard, ou une écriture passée hors de la paie), et ce qui a été versé le trimestre suivant.
- **Un mois validé** : si le pointage change après la validation, le bulletin ne bouge pas (« Reprendre le pointage » n'est
  plus offert) ; le mois le dit, avec ce qui a changé, et la régularisation sur le mois suivant.
- **Le pointage** : son en-tête dit combien de salariés sont pointés, par qui, et ceux qui diffèrent d'un mois complet ;
  « Établir les bulletins » se fait d'ici.
- **Un CDD qui finit** : « Me le rappeler le JJ/MM » pose MON rappel sur le dossier (quinze jours avant la fin ; le client
  ne le lit pas) et une note pour l'équipe ; un rappel déjà posé plus tôt reste.

Tests : `tests/web/cabinet-paie-parcours.test.ts` (le parcours « tenue » : le rappel, le CDD, la CNSS, le pointage changé
après la validation ; l'inventaire : le volet, l'échéancier). Preuves `paie cabinet 1.238 a` à `g`.

## La paie du Cabinet : le clavier et la fiche du salarié (02/11/2026, 1.240.0)

- **Ctrl + Entrée** sur une ligne de bulletin fait l'étape suivante, c'est-à-dire le bouton principal : envoyer pour
  accord, valider les bulletins, les marquer remis. Entrée seule ouvre toujours le bulletin, et la validation demande
  encore une confirmation. La maquette disait « Entrée valider le mois » ; une touche seule ne valide pas un mois par
  mégarde. Le pied de la liste dit la touche et ce qu'elle fera (« Ctrl Entrée valider les 5 bulletins »).
- **La fiche du salarié, à droite** de la vue Salariés (la maquette « paiesalaries ») : un clic ou Entrée sur une ligne
  l'ouvre, la croix la ferme. Elle dit ce qui manque d'abord (« 2 choses à compléter » : le n° CNSS et le RIB), puis le
  contrat et sa fin, le salaire de base et les primes de chaque mois, la situation (chef de famille, enfants), le n° CNSS,
  la CIN, le RIB masqué (« ··· 0918 », ou « payé en espèces »), les congés de l'année (acquis, pris, reste). Ses gestes :
  « Demander à … son n° CNSS et son RIB » (par la conversation ; seulement quand l'un manque, pas pour une paie tenue
  seule au cabinet) et « Modifier… ». Un champ vide le dit ; rien n'y est inventé.

Tests : `tests/web/cabinet-paie-parcours.test.ts` (la validation se fait au clavier ; l'inventaire ouvre et ferme la
fiche). Preuves `paie 1.240 a` et `b`.

## La paie du Cabinet : le départ d'un CDD (02/11/2026, 1.241.0)

Un salarié dont la fiche porte une date de sortie (un CDD qui finit) a **« Préparer son départ »**, dans le bandeau du CDD
et sur sa fiche. Le départ dit, comme la maquette « paiesortie » :

- **son dernier bulletin en projet** : le salaire du mois de sa sortie, **au prorata** s'il part avant la fin du mois
  (le calcul du bulletin lui-même, `KC.saisieDuMois` : « 15 j sur 22 (sortie le 22/11/2026) ») ; l'indemnité de congés
  pas pris (`KC.indemniteConges`, le même chiffre que le solde de tout compte : le solde au jour de sa sortie, × son brut
  sur les jours d'un mois complet ; un solde négatif n'indemnise rien) ; l'indemnité de fin de contrat **laissée vide**
  (À VÉRIFIER : son contrat et la convention collective) ; le brut du dernier bulletin = salaire + congés ;
- **ce que son départ demande** : le certificat de travail, le solde de tout compte signé, l'attestation de salaires de
  l'année, sa sortie dans la déclaration CNSS du trimestre, l'indemnité de congés au livre comme un salaire (le compte :
  À VÉRIFIER) ;
- **ses gestes** : « Envoyer le projet à … » (par la conversation, sauf une paie tenue seule au cabinet), « Le certificat
  de travail… » et « Le solde de tout compte… » (les documents du personnel, déjà là depuis la 1.72.0, ouverts sur le bon
  document). Rien ne s'écrit dans les livres.

Tests : `tests/web/cabinet-paie-parcours.test.ts` (le CDD finit dans 20 jours, jamais un dernier jour de mois : son salaire
est toujours au prorata). Preuves `paie 1.241 a` (le salaire d'un mois complet) et `b` (les congés oubliés du brut).

## La paie du Cabinet : « Annuler » après la validation (02/11/2026, 1.242.0)

Valider les bulletins du mois montre le toast de la maquette « paieapres » : « 5 bulletins validés : ils ne changent plus.
L'écriture de paie d'octobre reste au brouillard. » avec **« Annuler »** (6 secondes). Annuler efface la validation du
jour et rien d'autre ; les bulletins se modifient de nouveau. Le pont (`marquerBulletins`, `annulerValidation`) n'accepte
cette exception que pour la validation de ce jour-là, d'un bulletin ni remis ni payé ; passé le toast, un bulletin validé
ne change plus (une correction passe par une régularisation sur un mois suivant). Test : le parcours « tenue » valide,
annule, valide de nouveau. Preuve `paie 1.242 a`.

## La paie du Cabinet : l'accusé de la CNSS du trimestre (02/11/2026, 1.243.0)

La vue « CNSS du trimestre » dit si la déclaration a son accusé de dépôt (la maquette « paiecnss » : « déposé le 15/10,
l'accusé est dans le classeur »). Sans accusé : « Déposée sur le portail de la CNSS ? Range son accusé » et **« Ranger
l'accusé… »** (la fenêtre de dépôt du classeur, préremplie « L'accusé CNSS du 4e trimestre 2026 »). Avec : « Déposée ·
l'accusé est dans le classeur (rangé le …) » et **« Ouvrir l'accusé »** (en grand, sans quitter la Paie). SkanFact ne dépose
rien : l'accusé est la preuve que le cabinet a déposé.

Le classeur range un accusé par mois (0180) : celui de la CNSS va au dernier mois du trimestre, reconnu à son titre. La
déclaration mensuelle du même mois ne le prend plus pour **son** accusé (`estAccuseCnss`) : un accusé CNSS rangé en
septembre se faisait passer pour celui de la TVA de septembre. *Écart qui reste* : ce garde-fou n'a pas de test qui le
fasse tomber (le jeu d'essai n'a pas de déclaration mensuelle au mois d'un accusé CNSS).

Test : le parcours « tenue » range l'accusé depuis la Paie, le voit, l'ouvre en grand. Preuves `paie 1.243 a` et `b`.

**Pas encore fait** (serveur, ou décision) : la régularisation écrite d'un geste ; le rappel de salaire (décision de Skander).

## La paie du Cabinet : la paie de tous mes dossiers (02/11/2026, 1.244.0)

Depuis « L'année », **« La paie de tous mes dossiers »** montre, pour le mois choisi, une ligne par dossier qui a une paie :
le pointage (« reçu · 4 salariés pointés », « attendu », « fait par le client »), les bulletins (préparés, chez le client
pour accord, approuvés, vérifiés, validés, remis) et un état en clair. Un clic sur la ligne ouvre la paie de ce dossier.
Un dossier en tenue dont le pointage n'est pas arrivé a **« Relancer »** (la fenêtre « Demander au client », préremplie).

Le serveur lit (`GET /cabinets/:cabinet/paie?mois=AAAA-MM`) : les dossiers actifs du portefeuille dont le cabinet tient la
paie, **et seulement pour un membre qui a le rôle paie ou supervision** (la sécurité par ligne laisse voir la paie à tout
membre du périmètre ; un collaborateur comptable n'apprend rien ici). Qui n'est pas du cabinet reçoit « introuvable ». Rien
n'est écrit.

Tests : `tests/cabinet/paie.test.ts` (les comptes d'un mois, le mois sans rien, le collaborateur comptable, le mois faux,
l'étranger), le parcours « tenue » (`tests/web/cabinet-paie-parcours.test.ts`). Preuves `paie 1.244 a`, `b`, `c`.
*Écart qui reste* : les salaires payés se comptent en bulletins, pas encore en montant rapproché du relevé.

## La paie du Cabinet : les bulletins envoyés au client (02/11/2026, 1.245.0)

Les bulletins du mois validés, l'étape « Les remettre aux salariés » a **« Les envoyer à Sarra »** (la maquette, paieapres) :
chaque bulletin part en PDF (fait par le serveur) dans le classeur du dossier, rubrique Paie du mois, « envoyé au client »,
rien à saisir (l'écriture de paie est déjà faite). Le client les lit dans ce que son cabinet a rangé (« Mon comptable »).
L'étape dit ensuite « les 5 dans les documents de Sarra (le 02/11/2026) » et le bouton devient **« Les renvoyer »** : un
bulletin renvoyé remplace le précédent (gardé, marqué remplacé ; le client ne voit que le dernier). Si l'envoi s'arrête en
route, le message dit combien sont partis.

Aucune route nouvelle : le PDF du serveur (`POST /pdf`) et le dépôt au classeur (1.209.0, comme l'état de rapprochement).

Test : le parcours « tenue » envoie, lit les 5 PDF côté client, renvoie (5 en cours, 5 remplacés), ouvre le classeur en
octobre › Paie. Preuves `paie 1.245 a` (renvoyer sans remplacer) et `b` (rangé hors de la Paie).

## La paie du Cabinet : le paramétrage, qui l'a réglé et le copier (02/11/2026, 1.246.0)

Pour un dossier tenu au cabinet (un client relié règle sa paie dans son SkanFact, le cabinet la lit), le paramétrage dit
**« réglé au cabinet par Anis le 02/11/2026 »**, et **« copié de Garage Ennasr »** s'il vient d'un autre dossier. C'est le
**serveur** qui l'écrit, quand la paie de la fiche change (ce que le poste envoie à cette place est remplacé ; une fiche
réécrite sans changer la paie garde le réglage d'avant).

**« Copier le paramétrage d'un autre dossier… »** propose les dossiers tenus du portefeuille dont la paie est réglée, avec
ce que chacun règle (« 173,33 h · heures sup + 25 % · TFP 1 % · accident 3 % »). Le régime horaire, les heures sup, les
congés, la TFP, le FOPROLOS et les taux par contrat sont copiés ; le **taux d'accident du travail** ne l'est que si on le
coche (il dépend de l'activité : celui de l'avis de la CNSS du client, À VÉRIFIER). Le serveur refuse une copie depuis le
dossier lui-même ou depuis une entreprise hors du portefeuille (`cabinet.paie.copie`).

Tests : `tests/cabinet/paie.test.ts` (le poste qui prétend, la fiche réécrite, la copie, l'étranger) et le parcours des taux
(`tests/web/cabinet-paie-regimes.test.ts`). Preuves `paie 1.246 a`, `b`, `c`.

## La paie du Cabinet : le virement de salaire revenu (02/11/2026, 1.247.0)

Quand le relevé importé porte une ligne **au crédit**, du **net exact** d'un bulletin marqué payé (au millime), datée du
paiement ou dans les **60 jours** qui suivent, et dont le libellé dit le rejet (rejet, retour, impayé, annulé, refusé), la
Paie du mois le dit : **« Un virement de salaire est revenu sur le compte. Karim Riahi : 911,428 DT, payé le 28/09, revenu le
02/10 (« REJET VIR … ») »**, avec **« Le dire à Sarra »** (le message préparé : vérifier le RIB, payer de nouveau). La frise et
l'étape « Les salaires » ne disent plus « payés ». Une ligne ne répond qu'à un bulletin ; à net égal, celui dont le salarié
est nommé dans le libellé l'emporte. SkanFact ne change rien au bulletin : c'est un constat (`KC.virementsRevenus`, compta.js).

*Écart qui reste* : le relevé lu est celui de l'année ouverte (un salaire de décembre revenu en janvier se voit l'année
suivante) ; un salaire payé de nouveau ne se marque pas encore « repayé » (le client le marque payé dans son SkanFact).

Tests : `tests/moteur/paie-virement-revenu.test.ts` (le nommé, deux rejets, ce qui n'en est pas un, les accents, le 60e
jour) et le parcours « tenue ». Preuves `paie 1.247 a`, `b`.

## La paie de l'entreprise : la recette à la souris (02/11/2026, 1.248.0)

Skander : « ouvre le module paie entreprise comme un humain… juge ce qu'il manque, ce qui n'est pas pratique », puis
« corrige au fur et à mesure ». Recette faite sur l'écran virtuel, en Sarra (Boulangerie El Amal, 5 salariés, sans
cabinet), d'octobre à novembre : établir, payer, remettre, déclarer, congés, CDD.

**Le métier (corrigé)**
- **Un salarié sorti en cours de mois n'avait aucun bulletin.** `missingPayslips` lisait le dernier jour du mois : le
  CDD de Karim, qui finit le 20/11, sortait de la paie de novembre. Règle : en poste UN jour du mois suffit (comme au
  Cabinet) ; le bulletin se fait au prorata (« sortie le 20/11 · 18 j sur 26 »).
- **La sortie du mois se contrôle** (« La sortie de Karim au prorata », comme l'entrée) et l'écart avec le mois d'avant
  dit « sortie le 20/11/2026 », plus « brut changé ».
- **Deux salariés sur le même RIB** (payés par virement) ou **le même n° CNSS** (avec ou sans tiret) : deux contrôles du
  mois. La fenêtre « Payer les salaires » ne dit plus « contrôlé » sur ces lignes : elle dit « le même RIB qu'un autre
  salarié » et le redit au-dessus des boutons.
- **Renouveler un CDD** ouvrait toute la fiche « Modifier le salarié ». Une fenêtre à elle : prolonger jusqu'à une date
  (un an proposé) ou passer en CDI, l'ancienneté en CDD dite, « À VÉRIFIER : la durée totale permise et le nombre de
  renouvellements » ; puis l'avenant s'ouvre. Le bulletin du mois de l'ancienne fin, pas encore payé et fait au
  prorata, se refait au mois complet (primes et retenues gardées) ; payé, le message dit de le régulariser.
  « Préparer sa sortie » mène à l'onglet « Son départ » (il ouvrait la fiche).
- **Sans cabinet relié, la paie ne parle plus d'un cabinet.** L'en-tête disait « tu la fais, ton cabinet la vérifie » et
  les Déclarations « faites par ton cabinet · ton cabinet la prépare » : le mode écrit restait d'avant. Quand le
  serveur dit qu'aucun cabinet n'est relié ET qu'aucun bulletin n'est jamais venu d'un cabinet, la paie se fait seule
  (en-tête, Déclarations, bon à payer).
- **Un trimestre CNSS sans aucun bulletin** n'est plus « 0,000 DT, en retard » : « aucun bulletin dans SkanFact pour ce
  trimestre : la paie était tenue ailleurs ? », sans montant ni retard.
- **« Écarts sur septembre »** ne se dit plus « juste » quand septembre n'a aucun bulletin (rien à comparer).

**L'ergonomie (corrigé)**
- La page vide « Aucun bulletin » renvoyait au « bouton en haut » : le bouton est dans la carte.
- « Établir les bulletins » demandait par un mur de texte : la fenêtre montre chaque salarié, son brut et son net, et
  « jusqu'au 20/11 » ou « depuis le … » quand il y a prorata.
- Après la remise, plus aucun bouton principal alors que la frise disait « Déclarer » : « Préparer les déclarations ».
- Payer sans aucun compte de banque : « — compte par défaut — » ne disait rien ; la fenêtre dit qu'aucun compte n'existe
  et offre « Créer le compte de ta banque… ».
- L'étape « Pointer » cochée disait « pas pointé » : elle dit « sauté : chacun payé au mois complet ».
- L'onglet du navigateur disait « KRKarim Riahi » : les initiales d'un avatar sont décoratives (`aria-hidden`).

**Vu, laissé pour la suite** (`docs/revue-paie.md` § 5) : la Paie est sous « Piloter » dans la barre (elle s'épingle) ;
« Yassine : n° CNSS » dit deux fois (contrôle et À traiter) ; « Modifier le bulletin » montre le brut avec un point et
ne montre pas le net en direct ; la remise « à envoyer à … » ne fait que préparer les PDF ; un CDD de 3,6 ans n'est pas
signalé (durée légale À VÉRIFIER) ; la page s'ouvre sur octobre quand novembre attend.

Tests : `tests/moteur/paie-recette-1248.test.ts` (4 cas) ; `tests/web/paie-bon-a-payer.test.ts` (les doublons du jeu
d'essai, la variante « le cabinet prépare » a un mois d'avant venu du cabinet). Preuves `paie 1.248 a` à `e`.

## La paie de l'entreprise : la recette à la souris, suite (02/11/2026, 1.248.1)

Demande de Skander : « fais tout et continue […] couvrir 100 % de la paie, teste tout, et que ce soit ergonomique », en
critiquant le métier, l'ergonomie et l'interface sur chaque capture. Corrigé :

- **Les montants s'écrivent comme partout** (« 1 100,125 ») : le brut et les lignes du bulletin, la fiche du salarié, une
  avance, le barème de l'impôt (« 5000.000 » avant), les plafonds et déductions des Réglages. Le bulletin montre en haut,
  pendant qu'on tape, le net, le brut et le coût.
- **Le même n° CNSS ou le même RIB sur deux fiches** : la liste le marque « en double », la fiche le dit sous le numéro
  (au lieu de « contrôlé, clé juste »), « À traiter » compte la fiche du second (la pastille de l'onglet et le pied de la
  liste disent le même chiffre), et le **fichier CNSS refuse** deux salariés sous le même n° d'assuré
  (`compta.js`, partagé avec le Cabinet).
- **Le fichier CNSS** : son compte de corrections ne compte plus le matricule de l'entreprise déjà dit au-dessus ; les
  fiches au même manque (CIN, identité) se disent en une phrase, un bouton par personne.
- **Les onglets de la paie ne bougent plus** : le choix du mois ou de l'année vient après eux (posé devant, il apparaissait
  ou changeait de largeur selon la vue, et un clic sur « Déclarations » ouvrait « Congés et absences »).
- **Ce que tu verses** : une déclaration notée payée garde sa référence et « Retirer la mention… » sur sa ligne.
- **Réglages** : chaque ligne du tableau mène à sa case (l'impôt mène au barème) ; une case de taux ou de jours reste près
  de son libellé.
- **Remettre** : on coche qui, le bouton dit combien ; la phrase dit que SkanFact n'envoie rien.
- **Un bulletin pas encore payé se supprime** depuis son menu, avec « Annuler ».
- **Le mois de paie** : le mois précédent tout payé et le mois en cours établi, c'est le mois en cours qui s'ouvre.
- **La fiche du salarié** : « poste à préciser » au lieu de « — » ; les avances disent « Modifier… » ; la première retenue se
  choisit dans une liste de mois (la case du navigateur affichait « ---------- ---- ») ; « Fin de période d'essai » n'est
  proposée qu'avec une période d'essai notée ; « Son départ » dit que le solde ne retient pas l'avance ; le menu ⋯ a une
  icône et une phrase pour chaque geste.
- **Renouveler un CDD** : la date vient après les deux choix (elle ne fait plus sauter « Passer en CDI » sous la souris), le
  bouton dit ce qu'il fait, au-delà de quatre ans en CDD un avertissement (À VÉRIFIER) ; le renouvellement s'inscrit dans
  l'historique (`renouvellements` de la fiche) ; **l'avenant** dit le passage en CDI ou l'ancienne et la nouvelle fin, à
  compter du lendemain de l'ancienne fin (il disait « à compter d'aujourd'hui » et ne parlait pas du CDI).
- L'avertissement « pas de date de sortie » ne s'affiche plus que pour le certificat et le solde de tout compte.

Tests : `tests/moteur/paie-recette-1248-1.test.ts`, `tests/v10/cnss-fichier.test.ts` (le doublon refusé ; sa donnée
donnait le même n° à un salarié sur dix). Preuves : `paie 1.248.1 a` à `d`.


## La paie de l'entreprise : les retours de Skander sur la fiche, le bulletin et le pointage (02/11/2026, 1.249.0)

Skander a ouvert la fiche d'un salarié sur dev.skanfact.tn et noté ce qui manquait ; tout est repris, vu à l'écran.

- **Tous les documents du salarié, sur sa fiche** (onglet Documents) : ses fichiers (copie de CIN, contrat signé,
  certificats… gardés comme les autres pièces jointes, glisser-déposer ou clic), les certificats des arrêts maladie, ses
  bulletins (Voir, PDF), **les documents faits** (chaque export daté s'inscrit, avec « Refaire »), puis les documents à
  préparer, en cartes.
- **Un bulletin s'ouvre en lecture** (clic ou Entrée sur sa ligne, dans le mois comme sur la fiche) : son résumé (net,
  brut, coût, les retenues) et la feuille A4 à côté ; « Modifier le bulletin » s'il n'est ni payé ni validé,
  « Régulariser… » s'il est payé. Il ouvrait le formulaire, même payé. **Le formulaire** est refait sur deux colonnes
  (le mois, les primes, les retenues, le paiement ; le calcul à droite, qui suit la saisie) ; « Supprimer » n'existe que
  pour un bulletin pas encore payé.
- **La fenêtre Document** : les huit documents en cartes, la date, ce qui manque (gérant, civilité, CIN, poste), chacun avec
  le bouton qui le renseigne et rouvre le document ; à droite, **la page A4 elle-même**, en page entière ou pleine largeur.
- **L'arrêt maladie** : le certificat médical se joint (photo ou PDF) dans la fenêtre du congé, s'ouvre et se retire ; joint,
  il compte comme reçu. La liste des congés dit « fichier » ou « certificat ? ».
- **La pagination** : l'historique, les bulletins et les congés de la fiche, les bulletins du mois, les avances, le registre
  du personnel et sa liste de documents (la barre n'apparaît qu'au-delà d'une page). Les déclarations restent sans
  pagination : douze mois et quatre trimestres par an.
- **Le pointage s'ouvre sur le mois du jour** (il suivait le mois de paie : octobre, le 2 novembre). On change de mois par
  ‹ ›, « Ce mois-ci » y revient, la largeur ne bouge pas. Si la paie en cours est celle d'un autre mois (octobre, pas
  encore établi ou payé), un bandeau le dit et y mène d'un clic. « Aujourd'hui : qui n'est pas là ? » ne s'affiche que sur
  le mois du jour.
- **Les horaires se règlent sur place** : les jours de travail (un bouton par jour), le mois complet, les heures du mois,
  les trois majorations (À VÉRIFIER). Rien ne s'enregistre sans un jour de travail ; « Annuler » revient en arrière ; les
  bulletins déjà établis ne bougent pas. Les Réglages de la paie, enregistrés ensuite, **gardent les jours de repos** (ils
  les effaçaient : `offDays` n'était dans aucune case). « Régler les heures sup », sous la grille, mène à la case.
- **« Par salarié » en calendrier** : une case par jour, sa couleur dit le code, « pointé » ou « saisi » dit d'où il vient ;
  on choisit un jour (clic, flèches, Début/Fin), la barre au-dessus le change d'un clic ou d'une lettre, avec « Annuler ».
  Quatre chiffres en haut (jours payés, non payés, congés et maladie, heures sup) ; ‹ › passe d'un salarié à l'autre.
- **Les sous-vues du pointage** (Toute l'équipe, Par salarié, Les horaires) sont trois cartes avec une icône et ce qu'elles
  montrent.

Tests : `tests/web/paie-pointage-main.test.ts` (calendrier au clavier, horaires, Réglages qui gardent le repos),
`tests/web/paie-revue-ecrans.test.ts` (mois du jour, ‹ ›, largeur stable), `tests/web/parcours.test.ts` (le pointage du
mois de paie par le bandeau, les heures sup réglées dans les horaires), `tests/web/paie-documents*.test.ts` (les cartes).
Preuves : `paie 1.249 a` à `e`, et huit preuves reprises sur le code nouveau. Sans test : la pagination des bulletins du
mois, des avances et du registre (elle n'apparaît qu'au-delà de 25 lignes).

## La paie de l'entreprise : la recette pendant la vérification (02/11/2026, 1.250.0)

Pendant que la vérification de la 1.249.0 tournait, la recette à la souris a continué ; ce qu'elle a trouvé :

- **Le bulletin au téléphone** : le calcul passait devant les cases (on ne voyait plus ce qu'on saisissait) ; les cases
  viennent d'abord, le calcul suit.
- **« Par salarié »** : un jour présent reste une case vide, comme dans la grille de l'équipe (seules les exceptions se
  lisent) ; au téléphone, ni lettres-raccourcis (pas de clavier) ni « hors contrat » écrit dans la case (les hachures le
  disent).
- **Le journal de paie** : « Exporter en PDF » (il faisait un PDF sous le nom « Imprimer ») ; une légende des sigles sous le
  tableau (S. cotisable, H.S., AT, CNSS pat.…) ; les totaux à zéro en « — » comme les lignes ; le salarié en poste sans
  bulletin du mois est nommé, avec l'accord juste (« Amel n'a pas encore de bulletin de novembre ») ; une ligne s'ouvre sur
  son bulletin (clic ou Entrée).
- **Nouveau salarié** : les 23 cases en trois parties titrées (Qui est-ce, Son contrat, Son salaire et son paiement).
- **Guide-moi sur le pointage** : une visite « Pointer à la main » (le mois par ‹ ›, aujourd'hui, une période, les horaires,
  puis une case de la grille). La visite « Établir un document » visait un bouton disparu (`#hr-doc`) et une liste qui
  n'existe plus : elle suit désormais la fenêtre refaite (le bouton de la fiche, les cartes, le salaire, la page A4).
  Aucun test ne joue encore les étapes des visites : vues à l'écran, jusqu'à « Visite terminée ».
- **Le calendrier des congés** : le mois se change par ‹ ›, comme le pointage (une liste ici, des flèches là : deux gestes pour
  la même chose) ; une case libre se clique et ouvre « Congé ou absence » à ce jour, pour ce salarié.

Tests : `tests/web/parcours.test.ts` (la légende, une ligne du journal qui ouvre son bulletin), `tests/web/paie-mois.test.ts`
(‹ › du calendrier des congés, une case libre qui ouvre la fenêtre au bon jour ; ses salariés ont chacun leur n° CNSS et leur
RIB, puisque deux fiches qui les partagent se signalent désormais). Preuves : `paie 1.250 a` à `d`. Sans test : le
bulletin au téléphone, la case présente vide, l'accord du journal et les sections du nouveau salarié (vus à l'écran).

Restent notés pour le lot suivant : le mois des **Déclarations** par ‹ › (une liste aujourd'hui), et la déclaration du mois en
cours absente de « Ce que tu verses » (la dire « en cours », comme la CNSS du trimestre).

## La paie de l'entreprise : un seul mois pour toute la page (02/11/2026, 1.251.0)

Skander, le 02/11 : quatre façons de choisir un mois (une liste dans « Le mois », ‹ › au pointage, ‹ › au calendrier des
congés, une liste aux déclarations) qui ne se suivaient pas : octobre dans un onglet, novembre dans l'autre. Il a choisi, sur
le modèle de la saisie du Cabinet, **la bande des douze mois** :

- **Sous les onglets, les douze mois de l'année**, l'année entre ‹ › à gauche, « Toute l'année » au bout (elle ouvre l'onglet
  de l'année). Chaque mois dit où en est sa paie, lu des mêmes fonctions que « À traiter » et « Ce que tu verses » :
  « déclarée » ou « payée » (vert), « à faire » (un bulletin manque), « à payer », « à déclarer » (ambre), « en retard » (la
  date de la déclaration est passée, rouge), « en cours » (le mois du jour), « à venir ». Avant le premier bulletin fait dans
  SkanFact, un mois se tait (« — ») : la paie était tenue ailleurs, rien n'y est « à faire » (comme la CNSS d'un trimestre
  sans bulletin, 1.248.0).
- **Le mois choisi vaut pour toute la page** : bulletins, pointage, calendrier des congés, déclaration du mois ; le trimestre
  CNSS suit. Les choix de mois des cartes ont disparu.
- **Le mois d'entrée se fixe en arrivant** (le « mois à traiter ») ; il ne se recalcule plus en route : établir les bulletins
  le faisait avancer, et la page sautait au mois suivant sous les yeux (vu par les tests en écrivant la bande). Le pointage,
  tant qu'on n'a choisi aucun mois, montre le mois du jour (recette du 02/11, 1.249.0).
- **Au téléphone**, la bande défile au doigt, le mois choisi au milieu, l'année reste à gauche.
- **Aujourd'hui se voit** dans la grille du pointage et le calendrier des congés : « auj. » au-dessus du numéro cerclé et une
  teinte sur la colonne (Skander : « on ne sait pas quel jour on est »).
- **Les tableaux des cartes** n'ont plus de second cadre collé à celui de la carte ; leurs colonnes s'alignent sur le titre.
  Au téléphone, plus de carte dans la carte, et le texte va à la ligne au lieu de sortir ou de se couper en « … ».
- **« Ce que tu verses »** montre la déclaration du mois en cours, « en cours : N bulletins jusqu'ici », comme la CNSS du
  trimestre en cours ; « Déclaration d'octobre » prend l'élision.

Tests : `tests/web/paie-mois.test.ts` (l'état des mois, le calendrier qui suit la bande, les cadres, le téléphone),
`tests/web/paie-revue-ecrans.test.ts` (le pointage sur le mois du jour, aujourd'hui dans la grille), `tests/web/parcours.test.ts`
et les autres tests de la paie passent par la bande. Preuves : `paie 1.251 a` à `g`, et deux reprises (1.233 a, 1.250 d). Vu
à l'écran seulement : aujourd'hui dans le calendrier des congés.

Viendra (1.252.0, décidé avec Skander le 02/11) : quatre onglets au lieu de six (Le mois, Présences, Salariés, Déclarations).


## La paie de l'entreprise : la critique d'ergonomie, premier lot (02/11/2026, 1.252.0)

« À traiter » (les gestes) passe avant « Ce que SkanFact a contrôlé » ; la pastille de la fiche dit ce qui manque pour payer
et déclarer (« Son n° CNSS manque ») au lieu d'un nombre que sa liste contredisait ; établir le bulletin d'un mois pas fini le
dit avant le geste ; les lettres-raccourcis restent lisibles sur le bouton choisi ; « Repos » n'est plus écrit dans chaque
dimanche du calendrier d'un salarié ; les congés suivent l'ordre du calendrier ; la bande garde sa place sur les horaires (les
cartes ne remontent plus sous la souris) ; « Pas de pointeuse ? » se range d'un « Compris » ; au téléphone, « Réglages » vit
dans le menu ⋯, l'année épinglée de la bande a une ombre et des flèches de 44 points ; « Net versé » de l'année dit le net
de l'année. Tests : `paie-mois`, `paie-bon-a-payer`, `paie-pointage-main`, `rendu`.

## La paie de l'entreprise : la revue métier et ergonomie, page par page (02/11/2026, 1.253.0)

Skander, le 02/11 : « une revue métier et ergonomie de tout le module paie, page par page et fenêtre par fenêtre », avec le
droit d'améliorer l'interface. Ce que la revue a trouvé, et ce qui change :

- **La frise du mois en cours** cochait « Pointer : le mois est pointé » le 2 novembre. Le mois en cours se pointe jusqu'à son
  dernier jour : l'étape dit « en cours, jusqu'au 30/11/2026 » et reste l'étape où l'on est. Un mois fini dit, comme avant,
  « le mois est pointé » ou « sauté : chacun payé au mois complet ».
- **« À traiter »** montrait neuf lignes, dont sept répétaient « X : le même n° CNSS que Hamza Mejri ». Les fiches qui
  partagent un n° CNSS ou un RIB tiennent sur une ligne : « Le même n° CNSS sur 5 fiches », avec les noms et ce qui se
  passerait ; « Corriger » ouvre la première fiche à reprendre. Le moteur dit de qui chaque doublon est le double (`double`).
- **La pastille de « Salariés »** disait « 9 » à côté de « 6 salariés » : elle compte désormais les **fiches** à compléter
  (« 5 fiches à compléter »), comme le pied de la liste.
- **Le tableau des congés** suit enfin l'ordre du calendrier juste au-dessus (la 1.252.0 triait une liste que la page ne lisait pas).
- **La déclaration d'un mois qui n'est pas fini** ne se note plus « déposée et payée » : le bouton est grisé et la raison est
  écrite à côté (« Novembre 2026 se termine le 30/11/2026 : on le déclare une fois terminé… »), comme la CNSS du trimestre en cours.
- **La fenêtre du bulletin** : la case du haut s'appelle « Salaire de base » (elle disait « Salaire brut 820,500 » quand le
  calcul à droite disait « Salaire brut 788,942 », absence retirée) ; sous les absences, une ligne dit qu'elles viennent du
  pointage et qu'on les corrige là ; sans compte créé, le paiement part du « Compte principal » (« aucun compte créé » ne
  menait nulle part), comme dans « Déposée et payée ».
- **Les fenêtres** : l'avance et le prêt se lisent en entier (« une avance » / « un prêt », le détail au survol) ; la
  simulation d'embauche écrit le brut comme partout (« 1 200,000 »), le contrat sans « … », et « chef de famille » s'aligne
  sur la case des enfants ; la case « C'est une demande du salarié » porte son explication dessous, pas en seconde colonne ;
  les champs de « Déposée et payée » ne se touchent plus.

Tests : `tests/moteur/paie-revue-1253.test.ts` (la frise du mois en cours, le doublon qui nomme son double),
`tests/web/paie-bon-a-payer.test.ts` (deux lignes pour quatre fiches en double, la pastille à 5), `tests/web/paie-mois.test.ts`
(l'ordre du tableau des congés) ; preuves « paie 1.253 a » à « e ». Vu à l'écran le 02/11 (Le mois, la fenêtre du bulletin, la
déclaration de novembre, la simulation d'embauche, la fenêtre du congé, le tableau des congés).

## La revue de la paie, suite : L'année, les Réglages, la fiche d'un salarié (02/11/2026, 1.254.0)

- **L'année** : « Où va la paie de novembre » sous « Coût de la paie 2026 » devient **« Où va la paie de 2026 »** : chaque
  poste, son coût de l'année et sa part ; un salarié compte une fois par poste (le livreur parti en octobre y compte encore).
  « Toute l'année » choisie dans la bande se voit comme un mois choisi (un anneau), sans changer de taille.
- **Les Réglages** : les taux s'écrivent à la française (« 9,68 », « 0,4 ») comme le tableau des contrats juste dessous ; la
  case du navigateur écrivait « 9.68 ». « 0,45 » tapé s'enregistre 0,45.
- **La fiche d'un salarié** : l'historique disait « Brut de novembre 2026 : 820,500 → 788,942 », daté du 30/11, le 2
  novembre (une absence, lue comme une baisse de salaire à venir). Il dit désormais le **salaire de base** qui change, au
  premier jour de son mois (« Salaire de base dès novembre 2026 : 1 450,375 → 1 500,500 ») ; une absence n'y paraît plus.
  L'onglet **Congés** disait « Aucun congé ni absence » alors qu'une absence était pointée : il dit maintenant « Au pointage
  de 2026 : 1 jour d'absence non payée (02/11) ; il se retire du bulletin de son mois ».

Tests : `tests/web/paie-revue-ecrans.test.ts` (la fiche : la base qui change, l'absence pointée), `tests/web/paie-bon-a-payer.test.ts`
(les postes de l'année), `tests/web/paie-pointage-main.test.ts` (« 0,45 » enregistré) ; preuves « paie 1.254 a » à « d ».
Vu à l'écran le 02/11 (L'année, les Réglages, la fiche de Hamza : Congés, Historique).

## La revue de la paie, fin : les fenêtres qui restaient et le téléphone (02/11/2026, 1.255.0)

Rappel de Skander (02/11) : sur `dev`, ni version ni envoi à chaque correction ; ce lot regroupe toute la fin de la revue.
La comparaison avec les concurrents et le métier est dans `docs/etudes/paie-concurrents.md` (ce qui manque encore, par ordre
de priorité, pour le prochain gros lot).

- **La sortie d'un salarié** : « Préparer sa sortie… » ne faisait qu'ouvrir l'onglet « Son départ », sans rien demander.
  C'est maintenant une fenêtre : le **dernier jour** et le **motif** (démission, fin de CDD, licenciement, rupture d'un
  commun accord, fin de la période d'essai, retraite, autre), obligatoires, une note, et l'**ancienneté au dernier jour** calculée
  sous les yeux. L'onglet « Son départ » dit le motif et l'ancienneté. Le préavis et l'indemnité de licenciement ne se
  calculent pas : « À VÉRIFIER avec ton comptable » (Code du travail, convention collective) ; la valeur par défaut est
  celle qui ne fait rien.
- **La saisie sur salaire** : le premier mois de retenue se choisit dans une liste en toutes lettres (« dès le prochain
  bulletin », « novembre 2026 »…) ; la case du navigateur écrivait « November 2026 ». Les montants s'écrivent à la française.
- **Régulariser** : « Régulariser le bulletin d'octobre 2026 » (l'élision), le montant à la française.
- **Les horaires** : la bande des mois s'estompe (les horaires valent pour tous les mois), et le dit au survol.
- **L'icône « modifier »** manquait : « Modifier sa sortie… » et « Modifier le bulletin » s'affichaient sans dessin.
- **Au téléphone** : le pointage de l'équipe (31 colonnes) devient une **liste** (jours payés, non payés, « Son mois » qui
  ouvre le pointage du salarié) ; les gestes d'un bulletin passent **sous** son nom au lieu de le recouvrir.

Tests : `tests/web/paie-revue-ecrans.test.ts` (« la sortie d'un salarié… ») ; preuves « paie 1.255 a » à « f ».
`tests/web/paie-avance-fenetre.test.ts` était rouge depuis que la question « Abandonner cette saisie ? » nomme son bouton
« Abandonner la saisie » : il cherchait « Abandonner » tout court, et il le cherche maintenant par son vrai nom. Vu à l'écran
le 02/11 (la sortie de Karim avec son motif et son ancienneté, la saisie, la régularisation, le pointage au téléphone).

## Les manques du métier et la maquette reprise telle quelle (02/11/2026, 1.256.0)

Accord de Skander (02/11) sur les sept points de `docs/etudes/paie-concurrents.md`, puis : « reprends les écrans de la
maquette et adapte-les : elle est soignée ». Le relevé des écarts, état par état et fenêtre par fenêtre, est dans
`docs/paie-ecarts-maquette.md`.

**Le style de la maquette, tel quel.** `scripts/maquette/paie-css.py` extrait la feuille de style de
`docs/maquettes/paie.html` dans `web/public/plateforme/paie-maquette.css` : chaque règle est préfixée `.pm` (la page Paie
seule), ses couleurs passent par les jetons de la charte (`--sb-*`, le thème sombre sous `body.dark .pm`), les règles nues
des boutons et des champs sont laissées (elles agrandissaient les onglets). `scripts/maquette/paie-adapte.css`, ajouté au
bout, tient ce que l'application change : la fenêtre (`.fen`, sa croix, son pied collé en bas, « Annuler » à gauche), les
petits tableaux en lecture (`table.mini.lu`), les sous-onglets soulignés, et le téléphone (une colonne, la frise serrée).
Sur `#/paie` et `#/salarie`, `modal()` pose d'elle-même la fenêtre de la maquette (sauf les menus et l'aperçu A4).

**Le mois, au balisage de la maquette** : la frise (`.et`, son état dans `data-etat`), « À traiter » (`.apy`), les trois
tuiles, le tableau des bulletins (groupes « Ce qui change ce mois », « dont avance X » sous les retenues, le pied « les N »),
les bandeaux (`bandeau info|ambre|rouge|gris`). Sans cabinet : « Personne ne vérifie tes bulletins » et « Voir les
contrôles » (la fenêtre des contrôles, ceux qui demandent un geste en tête). Le menu ⋯ en quatre groupes (Ce mois, Les
salariés, Calculer, Réglages) : le journal de paie et l'ordre de virement y passent (le bouton « Journal » à part s'en va).
Les fenêtres Payer les salaires, Le bulletin en grand, Une avance ou un prêt, Choisir un salarié reprennent la maquette.

**Les sept points du métier**
- **Quatre vues** : Le mois, Présences (pointage, par salarié, congés et absences, horaires), Salariés (l'équipe, avances
  et prêts), Déclarations (les déclarations, l'année).
- **Partir du net** (`brutPourNet`, compta.js) : le plus petit brut, au millime, dont le net atteint le net voulu, par le
  calcul même des bulletins (sa situation, ses primes) ; dans « Combien coûte une embauche ? » et sur la fiche.
- **Augmenter les salaires en lot** : ceux qu'on coche, + x % ou + x DT, dès un mois ; la fiche garde l'ancien salaire ; un
  mois déjà payé donne un rappel sur le bulletin suivant, montré avant d'être porté ; « Annuler » défait tout.
- **La fin de la période d'essai** dans « À traiter » (quinze jours avant, quinze après) : le confirmer dans son poste (la
  date sur la fiche, le courrier prêt à signer) ou préparer sa sortie (motif « fin de la période d'essai »).
- **Le préavis et l'indemnité de licenciement** : réglages vides par défaut (0 ne fait rien) ; l'indemnité
  (`indemniteLicenciement`) compte jours × années (les mois commencés au douzième) × le salaire d'un jour. À VÉRIFIER.
- **La prime d'ancienneté** par tranches (`trancheAnciennete`, `primeAncienneteDuMois`) : vide = rien ; une tranche sans
  taux ne compte pas ; au prorata des jours payés. À VÉRIFIER (la convention).
- **Les primes et retenues du mois** (`variablesDuMois`) : une grille, un salarié par ligne, une rubrique par colonne
  (réglée une fois : prime ou retenue, imposable ou non), « Une autre rubrique… », « Coller depuis un tableur » ; le
  bulletin établi, pas payé ni validé, se refait tout de suite.

**Et la maquette encore** : le virement rejeté (repayer, nouveau RIB), les heures oubliées après validation (sur le mois
suivant), la demande de congé plus longue que le solde (« Accepter : N jours payés, N sans solde »), ce que chaque absence
fait au bulletin, la fin de l'année (ce que décembre et janvier demandent), la page d'un rôle sans le droit Paie, le reçu
d'un salaire payé en espèces (`recuSalaireEspecesHtml`).

Tests : `tests/moteur/paie-1256.test.ts` (le moteur), `tests/web/paie-1256-gestes.test.ts` (la fin d'essai, la grille du
mois, l'augmentation en lot, à la souris) ; les tests de la paie retournés vers le nouveau balisage ; preuves « paie 1.256
a » à « j ». Neuf anciennes preuves suivent le code d'aujourd'hui (le journal au menu ⋯, les primes d'ancienneté et les
variables dans les bulletins des deux côtés, les avances sous « Salariés »).

## Le pointage tel que la maquette (02/11/2026, 1.257.0)

Demande de Skander (02/11) : « il faut vraiment tout faire, rien oublier », et le lot 1.257 de
`docs/paie-ecarts-maquette.md` (équipes, horaires, fériés, retards, compteurs, validation et versions, anomalies, pointeuse,
semaine heure par heure, minimum par équipe, l'année par équipe). Chaque écran vu à la souris pendant le travail, les tests
et les preuves à la fin du lot (consigne de Skander du 02/11).

**Les équipes** (`payrollSettings.equipes`, Présences › Les horaires) : un nom, l'heure d'arrivée et de départ (« HH:MM »),
les jours de travail, comment elle pointe (à la main ou à la pointeuse), le minimum de présents, qui en est. Les jours de
travail de l'équipe font les jours de repos de ceux qui en sont (`joursReposDe`) ; sans équipe, ce sont les horaires de
l'entreprise. L'équipe se choisit aussi sur la fiche (« Son équipe », avec le n° de badge) et s'y lit (« Son contrat »).

**Les jours fériés** (`payrollSettings.feries`) : la liste de l'année, réglable ; « Proposer les N fériés à date fixe » ajoute
ceux à date fixe (À VÉRIFIER : la liste, et les fêtes religieuses, à poser à la main). Un férié se pose de lui-même dans la grille,
payé (`F`), jamais sur un jour de repos ; une case posée à la main gagne.

**La case du pointage** (O20) : un clic ouvre la fenêtre qui dit ce que chaque choix fait (une absence non payée coûte un
jour de salaire, un congé payé prend sur le solde), le **retard** du jour en minutes, et « Au » pour poser plusieurs jours
d'un coup ; « Annuler » défait. Au clavier, la lettre pose encore le code d'un coup. Un retard se voit d'un point ambre.

**La pointeuse** (O06) : « Importer la pointeuse… » lit un fichier de badges (`lireBadges` : « badge ; date ; heure », la
date en JJ/MM/AAAA ou AAAA-MM-JJ, les zéros devant le n° ignorés, l'en-tête sauté, les lignes illisibles comptées). Avant le
geste, la fenêtre dit ce que le fichier donnerait (lus, rattachés par le n° de badge de la fiche, déjà importés, badges
inconnus, anomalies), calculé sur une copie : rien n'est écrit avant « Importer les N badges ». Un passage déjà importé
s'ignore ; la main gagne toujours (un congé posé reste).

**La journée lue sur les badges** (`journeeBadges`) : l'arrivée, le départ, le travaillé ; le **retard** dès le seuil réglé
(« Un retard compte dès », 0 = à la minute) ; ce qui passe la fin du planning, arrondi au pas réglé (« Heures sup des badges,
arrondies à »). « La semaine de X, heure par heure » (Par salarié) le montre jour par jour, et met d'un geste
ses heures sup du mois dans la grille (+25 %).

**Les anomalies** (« À régler avant de valider ») : l'entrée sans sortie (« Mettre la sortie à 11:00 », la fin du
planning), les jours de travail sans badge ni justificatif (« Choisir… » : sans solde, congé payé, maladie, ou il était là).

**Valider le pointage** (et non « l'envoyer » : sans cabinet, personne ne le reçoit) : le mois se **verrouille** ; une case
le refuse et dit comment le rouvrir. « Corriger : une nouvelle version » rouvre ; la version validée reste gardée et se voit
(« Voir la version 1 ») ; valider à nouveau dit ce qui a changé. Le bouton reste éteint tant qu'il reste une anomalie.

**Les totaux du mois et les compteurs** : présent, payés, heures sup par majoration, sans solde, retards, « à savoir » ; les
heures sup de l'année face au plafond (réglage vide par défaut : « aucun plafond réglé », À VÉRIFIER), les retards du mois
(« aucun n'est retenu sur la paie » : le réglage qui les retiendrait n'existe pas encore), les heures de nuit (pas encore
comptées, dit tel quel).

**Le minimum par équipe** : avant d'accepter un congé, la fenêtre du congé et la demande disent si l'équipe passerait sous
son minimum (« il ne resterait que Mourad »), et laissent poser quand même.

**L'année par équipe** (Déclarations › L'année, « Où va la paie ») : par équipe quand il y en a, avec ce que les bulletins
ont payé en heures sup et retenu en sans solde, et les retards du pointage.

**Les fenêtres reprises de la maquette** dans ce lot : renouveler un CDD (O15 : la suite, CDD ou CDI, la nouvelle fin, le
salaire, le jour où le lui dire, ses CDD bout à bout face à la durée maximale, À VÉRIFIER), une saisie sur salaire (O07 :
le nombre de mois et le dernier bulletin), les jours sans badge (O26), remettre les bulletins (O03 : par e-mail par toi, ou
imprimé ; SkanFact n'envoie rien).

Tests : `tests/moteur/paie-1257.test.ts` (équipes, fériés, badges, journée, anomalies), `tests/web/paie-1257-gestes.test.ts`
(la case à la souris ; la pointeuse, l'anomalie, la validation, le verrou, la correction) ; les tests de la paie retournés
vers la fenêtre de la case et les nouvelles cartes ; preuves « paie 1.257 a » à « k ». La preuve de la déclaration du mois
des bulletins vise désormais la ligne qui choisit le mois montré.

## Les fenêtres qui restaient, la journée validée, les retards et la nuit (02/11/2026, 1.258.0)

Le dernier lot de la maquette paie de l'entreprise (`docs/paie-ecarts-maquette.md`, lot 1.258.0). Chaque fenêtre a été vue
à l'écran à côté de sa capture de la maquette.

**La journée validée** (demande de Skander, 02/11 : « es-ce que c'est pas mieux de valider un pointage du jour ? ») : sous
« Aujourd'hui : qui n'est pas là ? », « Valider la journée du 02/11 ». Une journée validée ne se change plus : sa case, une
période qui la couvre ou un « sans badge » qui la touche refusent, et le refus offre « Rouvrir la journée » (la journée
rouverte garde la trace de sa validation). **Le réglage** (Présences › Les horaires, décidé avec Skander le 02/11 : il
demandait un réglage, et c'est le bon choix pour une boutique qui pointe à la main chaque soir) : « Le mois se valide quand
chaque journée l'est », **éteint par défaut**. Allumé, « Valider le mois » dit combien de journées passées restent et ouvre
leur liste, « Valider ces N journées ». Éteint, le mois se valide d'un coup, comme après l'import de la pointeuse. Tant que le
mois n'est pas fini, le bouton principal est « Valider la journée » ; celui du mois passe second.

**Les fenêtres** : le rappel d'une augmentation (O05 : qui, combien par mois, combien de mois payés, le rappel brut, porté
sur le premier mois pas encore payé) ; le document d'un salarié (O08 : « Pour » un autre salarié, « Prêt », un **numéro**
AAAA-NNN par année, né quand le document est fait, imprimé sur le document, « Imprimer ») ; la déclaration du mois sans
cabinet (O17 : ce qu'elle reporte, ligne par ligne, avec la base ou le taux, le total qui fait le montant, le tableur) ; le
bulletin et le journal en document (O18, O19 : « Pour » le bulletin d'un autre salarié du mois, les documents du salarié ou du
mois à côté, « Prêt », « Imprimer », « Le remettre à … » quand il est payé et pas encore remis ; le journal, un A4 paysage,
se pose enfin en paysage) ; « Demander une correction » (O25 : la ligne du bulletin qui ne va pas, et la règle : ton
comptable corrige et te renvoie le bulletin à approuver, rien ne change sans que tu le voies) ; « Le mois » avant ses
bulletins (O28 : le pointage du mois en lecture, ce qui reste à régler avant, les primes et retenues du mois). O27 (les
anomalies de la pointeuse) était fait en 1.257.0.

**La retenue des retards** (Les horaires, éteinte par défaut ; À VÉRIFIER : ce qui peut se retenir) : les minutes de retard
du mois au prix d'une heure de la fiche (le brut divisé par les heures d'un mois complet, comme les heures sup), en une ligne
imposable négative du bulletin, « Retenue pour retards : 47 min » : le brut baisse, la CNSS et l'impôt suivent. Un bulletin
repris ne la double jamais.

**Les heures de nuit** (Les horaires ; À VÉRIFIER : la plage légale et la majoration, Code du travail et convention) : une
plage (vide par défaut : rien ne se compte) qui peut passer minuit, et sa majoration (vide : comptées, rien ne s'ajoute). Elles
se lisent sur les badges du jour, ou sans badge sur l'horaire de l'équipe ; le compteur du pointage dit celles du mois. La
majoration en fait une prime imposable : le prix d'une heure fois les heures de nuit fois la majoration (l'heure elle-même est
déjà dans le salaire).

Tests : `tests/moteur/paie-1258.test.ts` (rien par défaut, les retards retenus, les heures de nuit),
`tests/web/paie-1258-gestes.test.ts` (la journée validée et le réglage ; le rappel ; les documents, le numéro, le journal en
paysage ; la déclaration du mois, le mois avant ses bulletins, les réglages ; la correction demandée avec un cabinet relié) ;
preuves « paie 1.258 a » à « n ». Trois preuves anciennes visent les lignes que ce lot a changées (la reprise du pointage, le
document noté).

## La refonte du pointage : la journée, le mois en relecture, une seule règle (02/11/2026, 1.259.0)

Skander demandait un pointage plus simple que la grille du mois (« soit objectif et donne moi un meilleur système »). La
maquette `docs/maquettes/pointage.html` a été validée (« Ca me vas go refonte dans l'application »), puis reprise telle quelle.

**La journée** (premier sous-onglet de Présences, celui qui s'ouvre) : une ligne par salarié en poste, rangée par équipe,
avec ses horaires et ses badges du jour. Six choix : Présent, Absent, Congé, Maladie, Retard, Heures sup. Chaque ligne dit ce
que le choix fait sur le bulletin, au millime : « − 33,851 DT sur son brut » (un jour du brut), « + 2 h à +25 % · + 17,432 DT »
(le prix d'une heure de la fiche, majoré), « en minutes ; noté, pas retenu » si le réglage des retards est éteint. Absent,
Congé, Maladie et Retard ouvrent la case du jour, déjà choisie, pour la confirmer. Les heures sup d'**un jour** s'ajoutent à
celles du mois de la même majoration (c'est le total du mois que le bulletin paie) : elles se relisent jour par jour, se
remplacent, se retirent, et le mois ne descend jamais sous zéro. « Présent » remet la journée à la normale (le retard et les
heures sup du jour s'en vont). Une entrée badgée sans sortie se règle sur la ligne. On passe d'un jour à l'autre par la bande
de la semaine. « Valider la journée » la fige (ses choix ne se cliquent plus) ; « Rouvrir la journée » la rend. Un jour à
venir ou un jour de repos le dit, au lieu d'offrir de valider. Au téléphone, les choix se cachent : le nom touché les ouvre en
grand, avec ce que chacun fait.

**Le mois** (deuxième sous-onglet) se **relit** : sa période, ses fériés, la barre des journées validées, puis **« À régler »**,
une seule liste de tout ce qui bloque le mois, chacune avec son bouton — les anomalies de la pointeuse (sortie oubliée, jours
sans badge), les journées à la main pas encore validées (« Les relire et les valider… » les valide d'un geste, après les
avoir montrées), les demandes de congé sans réponse. L'onglet « Le mois » porte le même chiffre (une seule fonction pour la
liste et le compteur). Dessous, « Ce qui change » : seuls les salariés dont le mois n'est pas « présent, à ses horaires »,
avec leurs absences, retards et heures sup ; la grille du mois reste à un clic (« Voir la grille »), et revient.

**Une seule règle de validation** (remplace le réglage de 1.258.0, « le mois se valide quand chaque journée l'est », retiré) :
ceux qui pointent à la main valident leurs journées ; ceux de la pointeuse n'ont rien à valider par jour (les badges font foi,
leurs anomalies vont dans « À régler ») ; le mois se valide **après sa dernière journée**, quand « À régler » est vide. Avant,
le bouton dit pourquoi et mène à la liste (« Régler les 2 choses, puis valider le mois », « Valider le mois le 30, après sa
dernière journée »).

**Les 4 questions** : au premier passage, un bandeau propose « Le pointage se règle en 4 questions » (aussi dans Les horaires).
Qui pointe (à la main, à la pointeuse, les deux selon l'équipe), les jours de travail, les retards (notés, ou retenus : À
VÉRIFIER), la nuit (la plage, qui va par deux). Rien ne s'écrit avant « C'est réglé » ; « Annuler » remet tout. « Plus tard »
range le bandeau.

**Défaut trouvé par les tests et corrigé** : dans la grille, cliquer une case d'une journée validée disait « La journée du
31/10 est validée » (la dernière du mois) au lieu de la sienne ; seule la case vérifie maintenant son jour, et le mois
verrouillé refuse d'abord.

**Trouvés par la batterie complète et corrigés** : en offre Essentiel, le bandeau « fait partie de l'offre Complet » ne
venait plus sur la paie (son en-tête est dans `.pm` depuis 1.256.0 : le poser sur la vue levait une erreur) ; il se pose
maintenant à côté de l'en-tête, où qu'il soit (preuve « paie 1.259 k »). Le test des guides du Cabinet attendait le
paramétrage de la paie sans « qui l'a réglé et quand » (ajouté en 1.246.0) : il l'attend maintenant.

**Encore rouge, pas de ce lot** : la première ouverture pèse 1 354 Ko pour un seuil de 1 300 (`tests/web/leger.test.ts`) ;
elle dépassait déjà avant ce lot (environ 1 331 Ko, estimé), qui ajoute environ 22 Ko compressés. Le levier noté dans
`docs/leger.md` est de charger les visites guidées seulement quand on en lance une (environ 120 Ko compressés) : un lot à
part, le seuil ne bouge pas. Et le Tableau de bord du Cabinet (`tests/web/tableau-de-bord.test.ts`, la fiche d'un mois qui
ne se referme pas d'un clic sur le titre) tombe sans qu'aucun fichier de ce lot ne le touche : à reprendre à part.

Tests : `tests/moteur/paie-1259.test.ts` (les heures sup d'un jour : ajoutées, relues, remplacées, retirées, jamais sous zéro,
refusées sans majoration ou après la sortie), `tests/web/paie-1259-gestes.test.ts` (la journée et le téléphone ; le mois,
« À régler », l'onglet, la journée validée refusée dans la grille, la validation ; les 4 questions et « Annuler ») ; preuves
« paie 1.259 a » à « j ». Les tests et preuves anciens qui passaient par la grille d'abord y vont maintenant par « Le mois » ›
« Voir la grille ». Le pointage par QR code est noté au cadrage, pour plus tard.

## Les corrections urgentes du Personnel (03/11/2026, à partir de 1.266.2)

Le cadrage du module Personnel (`docs/cadrage/16-module-personnel.md` § 10.1) a relevé treize défauts qui faussent
l'argent ou perdent des données. Ils se réparent dans les gros fichiers (exception « correction urgente » de la règle du
`CLAUDE.md`), chacun avec son test vu rouge puis vert et sa preuve, et chacun noté pour la sortie du module.

- **1.266.2 — « Un départ… » du menu ⋯** (point 11). Depuis 1.259.0, la fenêtre de l'heure de sortie du pointage portait
  le même nom que la fenêtre du départ (`sortieFenetre`) et, déclarée dans la page Paie, la cachait : choisir le salarié
  fermait la fenêtre et rien ne s'ouvrait (« iso.slice is not a function »). Elle s'appelle désormais
  `heureSortieFenetre`. Test : `tests/web/paie-1256-gestes.test.ts` (les deux chemins, chacun sa fenêtre) ; preuves
  `paie 10.1-11 a` et `b`.
- **1.266.3 — La CSS s'arrête avec sa règle** (point 1, en partie). La contribution sociale de solidarité de 0,5 % ne
  vaut que pour 2026 (loi de finances 2026 art. 87 ; Rapporté, **À VÉRIFIER** avec un comptable, comme sa reconduction en
  2027). Sa règle porte maintenant sa date de fin (`CSS_JUSQU_AU`, compta.js) ; après elle, sans règle suivante posée, le
  bulletin n'en retient aucune, quel que soit son taux (livré, réglé, régime d'un contrat), et le dit (« non retenue, sa
  règle s'arrête le 31/12/2026 » sur le bulletin imprimé, son aperçu et son formulaire). Le mois vient du bulletin : chaque
  chemin qui enregistre un bulletin le donne au calcul (établir, formulaire, correction du cabinet acceptée, reprise du
  pointage, augmentation, Cabinet, exemple). Un mois après la dernière loi de finances relue (`BAREMES_RELUS_JUSQU_AU`),
  la page et la fenêtre « Établir » disent « Barèmes de 2027 pas encore relus », sans bloquer, et le contrôle « Les taux de
  l'année » ne se dit plus juste. **Le serveur lit la même règle** dans le moteur de l'écran et refuse un bulletin de 2027
  qui retient encore la CSS (un onglet resté sur l'ancien code), avec le geste qui débloque. Une loi de finances relue
  avance ces deux dates dans une nouvelle version. Un salaire de décembre 2026 payé en janvier garde la CSS (le mois du
  bulletin fait foi : À VÉRIFIER). Reste à faire : comparer tout le barème aux règles du mois ; les estimations sans mois
  (fiche, coût d'une heure, trésorerie) gardent la CSS (environ 0,4 % d'écart avec le bulletin de janvier). Tests :
  `tests/moteur/paie-css-2027.test.ts`, `tests/v10/paie.test.ts`, `tests/web/paie-1256-gestes.test.ts` (février 2027 à la
  souris) ; preuves `paie 10.1-1 a` à `m`.
- **1.266.4 — Le pointage se fusionne case par case** (point 2). Il n'était pas dans la fusion : dès qu'un enregistrement
  était refusé pour un conflit, même sur une autre pièce (un client changé par un collègue), en ligne ou au retour du
  réseau, le poste reprenait tout le pointage du serveur et perdait le sien sans un mot. La fusion (`fusionnerPointage`,
  core.js) rassemble maintenant les journées, les retards, les heures sup du jour, les passages de la pointeuse (tous
  gardés), les heures sup du mois (refaites : la part notée au mois plus celles des journées), les journées validées, les
  versions validées, les imports de la pointeuse et les mois rouverts. Elle lit ce que la page avait du serveur (le pont le
  rend avec le conflit) : une case effacée d'un côté reste effacée. Une même case changée des deux côtés garde la version
  du serveur, l'autre est mise de côté et dite. Un pointage par salarié et par mois porte un identifiant qui en découle
  (`pt-<salarié>-<année>-<mois>`) : deux postes qui ouvrent le même mois écrivent le même objet (avant, deux objets dont un
  seul se lisait). Au retour du réseau, le pointage fusionné repart dans la révision du serveur. Tests :
  `tests/moteur/paie-pointage-fusion.test.ts`, `tests/web/pointage-fusion.test.ts`, `tests/web/hors-ligne-envoi.test.ts` ;
  preuves `urgence 2 a` à `o`.
- **1.266.5 — « Retirer déposée » dit que le paiement part** (point 6). Une déclaration sociale notée déposée et payée
  (1.228.0) porte son paiement : la sortie de trésorerie et l'écriture qui solde la CNSS ou la retenue naissent d'elle.
  « Retirer la mention » (Paie › Déclarations) les effaçait sans le dire, et le calendrier fiscal ne demandait même pas.
  Une seule porte (`retirerDeclarationSociale`) pour les deux : la question dit le montant, la date, le compte et la
  référence qui partent, et que la déclaration redevient à payer ; « Annuler » remet la même ligne ; un paiement pointé sur
  un relevé ou daté d'un mois clos ne se retire pas (le refus le dit). Tests : `tests/web/paie-bon-a-payer.test.ts`
  (« urgence 6 », Paie et calendrier) ; preuves `paie 10.1-6 a` à `f`.

