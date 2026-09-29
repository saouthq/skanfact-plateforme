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
   126.794 à l'écran, 126.793 au serveur ») ;
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
  - un bulletin calculé **à la main** (net 1 120,270) ; une loi de finances plus tard, il se relit et
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
