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
  primes au jour, elles, comptent juste (les jours du contrat moins l'absence). Le pointage (1.60.0) fera des jours
  payés la seule source du mois, et corrigera ce cas.
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
