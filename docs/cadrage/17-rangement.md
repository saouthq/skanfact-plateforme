# 17 — Le rangement de SkanFact

*Proposé le 03/11/2026, **validé par Skander le même jour** (« Je suis d'accord avec tout ce que tu m'as dit ») : les quatre décisions de l'En bref sont prises
selon la recommandation de Claude. Point de départ : deux décisions de Skander du même jour. D'abord « je suis
d'accord avec toi sur le fond et sur le menu aussi » : le menu de l'entreprise passe à six familles, une seule liste de
modules, un dossier par module. Ensuite « oui je suis d'accord alors de tout sortir , il faut faire ce qu'on a deja fait
la refonte et paie aussi. et note le comme regle afin que les prochains savent » : **tout** sort des gros fichiers, y
compris les écrans déjà refaits, et c'est une règle permanente (`CLAUDE.md`, « Le code : un dossier par module »). Ce
document suit `02-modules.md` (§ 2 la liste et le sens des dépendances, § 4 les portes, § 9 le rangement du code), et
`16-module-personnel.md`, le premier module à sortir. Il a été écrit après une étude du code (cinq lectures : le
chargement des écrans, `app.js`, le moteur, les tests et preuves, le Cabinet ; trois plans indépendants, prudent, cible
et par les risques ; un jugement qui a vérifié leurs chiffres et retenu le meilleur), lue au commit `68b5779`.*

## En bref (pour Skander)

- **Le problème.** Presque tout l'écran de SkanFact tient dans quelques très gros fichiers : `app.js` (33 186 lignes),
  le Cabinet (`cabinet/app.js`, 22 048 lignes), le moteur (`core.js`, `compta.js`), l'aide et les visites. Tous les
  modules s'y mélangent : changer la paie peut casser une facture, et personne ne voit où commence et où finit un module.
- **Ce qu'on fait.** Chaque module part dans **son dossier** (`modules/personnel/`, `modules/ventes/`…) avec ses écrans,
  son moteur, son aide, ses visites et ses tests, et **une seule porte**. Au début, on déplace sans rien changer : **les
  fichiers que reçoit ton navigateur restent identiques à l'octet près**, ils sont recollés à la construction à partir
  des dossiers. Ensuite seulement, module par module, on ferme les portes : un module ne peut plus toucher l'intérieur
  d'un autre, et un contrôle automatique le refuse.
- **Ce que tu verras.** Rien, pendant le rangement : mêmes écrans, mêmes chiffres, même hors-ligne. Puis le **nouveau
  menu en six familles** (Vendre, Acheter, Articles et stock, Personnel, Argent, Piloter), fait dans un lot à part, après
  sa maquette.
- **Combien.** 47 lots obligatoires, plus celui du menu. **Avant que la paie refaite (le `16`) commence, 10 lots de
  préparation** : les outils, le déménagement des gros fichiers, la sortie du Personnel côté entreprise. Les chantiers
  commencés avant ta règle (devis, achat, pointage) posent une question (décision 2).
- **Un défaut trouvé en chemin, à corriger tout de suite** : enregistrer un achat en devise **sans taux de change**
  provoque une erreur au lieu d'afficher le refus prévu (« Indique le taux de change… »). Une ligne à corriger (lot V1).
- **La première ouverture est trop lourde** : 1 354 Ko pour un seuil de 1 300 (mesure du 02/11). Pendant les
  déménagements, rien ne change (octets identiques) ; ensuite, chaque lot qui ferme une porte peut ajouter 1 Ko au plus,
  mesuré (environ 25 Ko au pire) ; on la réduit à part (§ 4.3).

**Ce que tu as décidé le 03/11/2026** (chaque fois selon la recommandation entre parenthèses) :

1. **Valider ce plan.** Le `16` l'exige avant de sortir le Personnel. (Oui.)
2. **Le calendrier, et une exception à ta règle.** La paie refaite attend environ 10 lots de préparation (refaire la
   paie dans le gros fichier puis la déménager coûterait deux fois). Les chantiers commencés avant ta règle du 03/11 (le
   lot 5 des devis, les lots 6c et 6d de l'achat, la suite du pointage) touchent encore `app.js`, alors que la règle n'y
   permet que les corrections urgentes. Deux choix : les finir avant le déménagement de leur module (une seconde
   exception, écrite datée au `CLAUDE.md`), ou les reprendre dans le dossier du module après son déménagement. (Les
   finir : ils sont presque faits, et l'outil qui déménage les emporte tels quels. Aucun autre travail de paie n'entre
   dans `app.js`.)
3. **Les visites guidées chargées seulement quand on en lance une** : environ 74 Ko de moins à la première ouverture,
   sans doute nécessaire pour repasser sous 1 300 Ko. Ce que ça change : sur un ordinateur neuf, une visite jamais lancée
   avec internet ne se lance pas sans internet. (Oui.)
4. **Charger chaque module seulement à son ouverture** (« phase C ») : la première ouverture est plus légère, mais sur un
   ordinateur neuf, un écran jamais ouvert avec internet ne s'ouvre pas sans internet, sauf ce qu'on garde d'avance (la
   caisse, les pièces, le brouillard, et ce que le `16` § 7 promet sans réseau : noter la journée, voir le planning,
   noter une demande, l'avance du soir depuis la caisse) ; et le garder d'avance annule le gain sur la mesure qui compte
   la copie gardée pour le hors-ligne. (Pas maintenant : on en reparle quand le rangement est fini, avec la mesure en
   main.)

---

## 1. Le menu : six familles

Accepté sur le fond le 03/11/2026 (journal du `README`). Il part de la barre v5 mise de côté le 31/10
(`docs/maquettes/barre-v5.html`), qui avait **« Au quotidien »** (les pages épinglées, réglables, avec leur état : « 2 en
retard », « ouverte ») et trois familles (Vendre, Acheter, Piloter). Les trois familles deviennent six :

| Famille | Ses pages | Ce qui change par rapport à la barre v5 |
|---|---|---|
| **Vendre** | Devis ; Factures (avec les factures en retard) ; Caisse ; Clients ; Autres pièces (proforma, bons, contrats, facturation récurrente) | « Relances » devient la vue « en retard » des Factures ; « Proforma, bons et contrats » et « Facturation récurrente » se rangent sous « Autres pièces » ; Catalogue et Listes de prix partent dans Articles et stock |
| **Acheter** | Achats ; Commandes fournisseurs ; Fournisseurs | Stock et Immobilisations partent |
| **Articles et stock** | Catalogue ; Listes de prix ; Stock | Nouvelle famille |
| **Personnel** | Une seule page, avec les trois onglets proposés au `16` § 2 (Aujourd'hui, Le mois, L'équipe) | Sort de Piloter |
| **Argent** | Trésorerie ; Comptabilité (avec les déclarations et les immobilisations) | Nouvelle famille ; Trésorerie et Comptabilité sortent de Piloter |
| **Piloter** | Marges ; Statistiques | Ne garde que le pilotage |

**Les règles** (la première vient de Skander, la deuxième du `02` ; les autres sont proposées) :
- **Aucune fonction ne disparaît** (journal du 03/11/2026).
- **Une offre ne masque jamais rien ; un menu ne ferme jamais rien** (`02` § 1). Un module fermé par l'offre reste au
  menu, qu'il ait des données ou non : ses pages s'ouvrent en lecture seule et disent pourquoi, avec le bouton qui le
  rouvre (`02` § 6, M5). Un module masqué par préférence quitte le menu ; la palette et son adresse y mènent toujours, et
  si l'on y enregistre quelque chose, il revient au menu et l'application le dit (`02` § 6).
- **Aucune adresse ne disparaît** : `#/relances` ouvre les Factures sur « en retard » ; `#/autres` et `#/contrats`
  ouvrent « Autres pièces » sur leur onglet ; `#/immos` ouvre la Comptabilité sur les immobilisations. Les liens, la
  palette Ctrl K et les favoris continuent de mener au même écran.
- **« Au quotidien » reste** en tête, réglable, et garde ce que chacun y a épinglé.
- Une famille d'une seule page (Personnel) garde le geste de la barre v5 : son panneau montre sa page, avec sa ligne
  d'explication et son épingle (l'ouvrir directement serait une exception, à montrer dans la maquette). Au téléphone, la
  barre du bas garde ses onglets réglables d'aujourd'hui, et les six familles sont dans « Plus » (à dessiner).

**Comment il se fait** : la maquette d'abord (la barre v5 passée à six familles, au bureau et au téléphone, dans tous
ses états : règle des écrans) ; puis un lot à part, **après** les registres du socle (lot B0, § 5), jamais mêlé à un lot
de rangement. Le menu lit alors, dans la fiche de chaque module (§ 2.2), la famille de **chacune de ses pages**, au lieu
de la liste écrite en dur d'aujourd'hui (`PAGES` dans `core.js`).

---

## 2. Une seule liste de modules

### 2.1 Laquelle

**La liste du `02` § 2 fait foi**, pour le cadrage, l'application et l'abonnement. Aujourd'hui l'application a sa propre
liste (`MODULES` de `core.js`, dix entrées) qui regroupe autrement (« Trésorerie, marges, statistiques » en un seul
module, les immobilisations à part…) ; le `02` § 10 dit déjà ce que devient chacune. Le rangement les aligne :

| Module (`02` § 2) | Dossier | Sa famille au menu | Aujourd'hui dans `MODULES` |
|---|---|---|---|
| Socle (fiches communes, accueil, barre, palette, aide, visites, réglages, équipe, abonnement) | `socle/` | Vendre (Clients), Articles et stock (Catalogue) | « Clients et catalogue » (toujours) |
| Ventes | `ventes/` | Vendre (et Listes de prix sous Articles et stock) | « Devis et factures », « Proforma, bons et contrats » |
| Achats | `achats/` | Acheter | « Achats et fournisseurs » |
| Trésorerie | `tresorerie/` | Argent | une part de « Trésorerie, marges, statistiques » |
| Déclarations | `declarations/` | Argent (dans Comptabilité) | une part de « Comptabilité » (toujours) |
| Pilotage | `pilotage/` | Piloter | une part de « Trésorerie, marges, statistiques » |
| Stock | `stock/` | Articles et stock | « Stock et garanties » |
| Caisse | `caisse/` | Vendre | « Caisse » |
| Personnel (code `paie`) | `personnel/` | Personnel | « Salariés et paie » |
| Comptabilité complète | `compta-complete/` | Argent (dans Comptabilité) | « Immobilisations », les onglets payants de « Comptabilité » |
| Cabinet | `cabinet/` | (l'application du cabinet) | — |
| Les modules des vagues (Réservations, Production, Projets, Groupe, Intégrations, Hôtellerie) | un dossier chacun, le jour venu | — | — |

**Un module porte les écrans des deux applications.** La paie du dossier d'un client, vue au Cabinet, vit dans
`modules/personnel/ecrans/cabinet/`, pas dans le dossier du Cabinet. Le dossier `cabinet/` ne garde que ce qui est au
cabinet lui-même : tableau de bord, pièces reçues, dossiers, fiche du dossier, classeur, échéances, réglages. Le `02` § 2
(« le Cabinet dépend de la Comptabilité complète ») redevient ainsi vrai dans le code.

### 2.2 La fiche d'un module (`module.json`)

Chaque dossier a sa fiche (`02` M1) : son nom et ce qu'il fait en une phrase ; ses pages et la famille de chacune ; ses
tables et les collections de données dont il est le **propriétaire** ; ses gestes (`03`) ; **ses dépendances** (la
colonne « Dépend de » du `02` § 2) ; sa porte (ce qu'il rend public) ; les points qu'il déclare et ceux qu'il remplit ;
les emplacements où il se pose ; les événements qu'il annonce et ceux qu'il écoute ; ses migrations ; son aide et ses
visites ; ses tests et ses preuves. Ce qui n'est pas dans la fiche, le socle refuse de le charger.

---

## 3. Un dossier par module

### 3.1 La forme finale

```
modules/
  ordre.json               l'ordre du 02 § 2 : la seule source du sens des dépendances
  assemblage.json          pour chaque fichier servi, la liste ordonnée de ses morceaux
  frontieres-connues.json  le cliquet : les écarts qui restent, qui ne peuvent que baisser (§ 4.2)
  socle/      module.json · registres.js · ecrans/{entreprise,cabinet,commun}/ · moteur/ · aide/ · visites/
              styles/ · heritage-bureau/ (le code de l'application de bureau, caché mais qui s'exécute encore)
  personnel/  module.json · etat.js · ecrans/entreprise/ · ecrans/cabinet/ · moteur/ · styles/ · aide/ · visites/
              tests/ · serveur/ (à la fin)
  ventes/ achats/ tresorerie/ declarations/ pilotage/ stock/ caisse/ compta-complete/ cabinet/
commun/assemblage.ts       assembler(fichier servi) · origine(fichier, ligne) · morceaux d'un module
outils/rangement/          déménager, vérifier un déplacement pur, contrôler les frontières, faire suivre les preuves,
                           comparer les écrans, comparer le moteur
```

**Les fichiers servis ne changent ni de nom ni d'adresse** (`/v10/app.js`, `core.js`, `compta.js`, `cabinet/app.js`,
`guide.js`, `visites.js`, `cabinet/cabguide.js`, `cabinet/cabvisites.js`, les feuilles de style). Ils n'existent plus
comme sources : ils sont **assemblés** à partir des dossiers. Aucun fichier assemblé n'est gardé dans le dépôt (sinon tout
changement apparaîtrait deux fois, et une preuve viserait le fichier qu'on ne doit pas toucher).

### 3.2 La porte

- **Pour les écrans** : le code de chaque module est mis dans une boîte, à l'intérieur du fichier d'aujourd'hui. Il voit
  encore ce qui est commun, ses données (`data`) restent les mêmes, son texte ne change pas, mais il ne montre aux autres
  que sa porte (un objet figé, enregistré au socle par `Socle.declarer(nom, porte)`) ; le reste devient réellement
  invisible aux autres.
- **L'état que lisent les registres du socle** (par exemple l'onglet ouvert de la paie, lu 35 fois hors de la paie) est
  assemblé avec le socle (`etat.js`), pas caché dans le module.
- **Pour le moteur** : aucune boîte. Le moteur de chaque module est **rangé** dans son dossier, mais il est **servi
  comme un seul moteur** (un `SkanCore`, un `SkanCompta`) ; sa porte est déclarée dans la fiche et tenue par le contrôle.
  C'est ce qui concilie le `02` § 9 (un dossier par module) avec M3 (un seul chemin de calcul, jamais recopié) : on ne
  réécrit pas le code d'argent pour le ranger.

### 3.3 Comment les modules se parlent

Les trois sortes de points de branchement du `02` § 4 (les fonctions de la porte et les points, les emplacements, les
événements), dans le sens du `02` § 2 :
- **vers un module placé au-dessus** : par sa porte (`Tresorerie.enregistrerMouvement(…)`) ;
- **d'un module du haut qui a besoin d'un chiffre d'un module du bas** : par un **point** que le module du haut déclare et
  que celui du bas remplit (« sorties prévues » de la Trésorerie, « charges du mois » du Pilotage) ; un point vide rend une
  liste vide, et l'écran le dit ;
- **du socle vers un module** : par un **emplacement** (une ligne dans « À faire », une entrée de la palette, un bouton
  « Créer », un onglet). Ils remplacent les listes écrites en dur dans `app.js` (`TODO_ACTIONS`, la palette,
  `window.__creer`, `PAGE_LABELS`, `PARTIES_DES_PAGES`, `METIERS`, `IMPORTS`, les onglets de la comptabilité, le panneau
  Cabinet des paramètres). **Chaque entrée garde son rang d'aujourd'hui**, pour que l'ordre affiché ne bouge pas ;
- **les événements** : à l'écran, `Socle.annoncer` et `Socle.ecouter`, seulement après la réponse du serveur ; ce qui se
  fait « dans la même opération » reste au serveur. Les trois événements d'aujourd'hui gardent leur nom.

**Les données** : chaque collection de `data` a un propriétaire, déclaré dans sa fiche ; un autre module la lit par la
porte ou par un point, jamais en direct.

**Les deux ponts** (`pont.js`, `pont-cabinet.js`, qui relient les écrans au serveur) ne se découpent qu'à la fin ; d'ici
là, ce qu'un module leur demande de neuf s'écrit dans son dossier (`modules/<m>/pont/`), assemblé à la suite du pont, et
rien de nouveau n'entre dans les ponts eux-mêmes (le Personnel y a déjà environ 200 lignes).

### 3.4 Le serveur et la base

Le serveur suit **à la fin** : `serveur/<module>/` passe dans `modules/<module>/serveur/` avec une `porte.ts`, et les 62
importations directes entre dossiers du serveur sont résorbées. **Les migrations de la base restent une seule suite
numérotée** (186 aujourd'hui) : l'ordre de la base l'exige ; chaque module déclare les siennes dans sa fiche.

---

## 4. La construction, le contrôle, le poids

### 4.1 L'assemblage

- **À la construction (Vite)** : dans la même étape que l'allègement (le retrait des commentaires), et avant lui ; les
  octets servis restent ceux d'aujourd'hui.
- **En développement** : un intermédiaire sert le fichier assemblé à la volée, sans rien garder.
- **Dans Node** (le serveur lit `core.js` pour le TEIF, `guide.js` pour le support ; les tests lisent le moteur) : un seul
  chargeur, qui passe par l'assemblage, remplace les 17 chargeurs recopiés à la main.
- **Les numéros de ligne** d'une erreur signalée se retrouvent dans le bon morceau (`origine(fichier, ligne)`), pour la
  console du support.

### 4.2 Le contrôle des frontières

Le `02` § 9 renvoyait au `12` pour l'outil ; le `12` n'en nomme aucun. **Décision proposée : un outil maison**, écrit
avec acorn et eslint-scope (déjà installés), parce que les outils du marché ne lisent que des `import`, alors que tout
notre code vit dans des fermetures.

| Code | Ce qu'il refuse | Estimé le 03/11/2026, pour la coupe prévue |
|---|---|---|
| F0 | Une coupe au milieu d'une instruction (ou d'une entrée de l'aide) ; une ligne absente ou en double ; un morceau non déclaré | 0 |
| F1 | Un nom introuvable | 1 (`charte`, le défaut du lot V1) |
| F2 | Un nom d'un autre module lu hors de sa porte | 535 lectures entre modules, plus 231 du socle vers un module |
| F3 | Une dépendance dans le mauvais sens (`ordre.json`), ou non déclarée dans la fiche | 60 lectures et 26 liens dans `app.js` ; 37 dans `core.js` |
| F4 | Le socle qui nomme un module | 231 dans `app.js` ; 58 dans `core.js` |
| F5 | Une fonction du moteur appelée par un module qui n'y a pas droit | à mesurer |
| F6 | Une collection de données d'un autre module lue en direct | à mesurer |
| F7 | Écrire chez un autre (une variable, une table d'icônes) | 15 variables ; 3 ajouts à la table d'icônes |
| F8 | Une définition en double dans une même page | 0 |
| F9 | Un module qui, à l'ouverture de la page, se sert d'un nom défini plus loin (appels faits au chargement compris) ; deux réactions au même geste qui changeraient d'ordre | 0 référence directe ; les appels faits au chargement (au plus 99 fonctions dans `app.js`, 531 au Cabinet) sont à mesurer au lot R0c, avant A1 |
| F10 | Un nom posé sur la page entière, ou une réaction à un geste, qu'aucune fiche ne déclare | 38 globaux ; 9 écouteurs |
| F11 | Un événement non déclaré, ou une écoute vers le bas | — |
| F12 | Un gros fichier qui grandit ; puis, après le lot A1, tout écran hors de `modules/` | — |
| F13 | Au serveur, importer un fichier interne au lieu de la `porte.ts` | 62 |

**Mesuré par l'outil** (lot R0c, 03/11/2026, 1.266.9 ; `outils/rangement/frontieres.ts`), sur le code d'aujourd'hui,
où tout est encore au socle : F0, F1, F2, F3, F4, F7, F8 et F9 à **0** (les écarts entre modules naissent au lot A1,
quand le code passe dans son dossier ; le déplacement les inscrit, voir le cliquet). F9 suit ce qui s'exécute à
l'ouverture : 306 fonctions sur la page de l'entreprise, 2 594 au Cabinet, aucune lecture trop tôt. F12 : les lignes des
dix gros fichiers, au plus (33 245 pour `app.js`). F13 : **51** imports (l'estimation disait 62 ; l'outil compte un import
par fichier et par cible, avec les dossiers du serveur que les fiches déclarent, champ « serveur » : `serveur/compta` à
la Comptabilité complète, comme son schéma, À DÉCIDER avec les autres propriétaires du § 9). La mesure lit 32 scripts et
154 667 lectures de noms sur la page de l'entreprise, 25 et 106 166 au Cabinet ; un test exige qu'elle les atteigne. F5,
F6, F10 et F11 viennent avec les lots qui les rendent mesurables (les portes du moteur et des données, les registres du
lot B0).

**Le cliquet** : les écarts d'aujourd'hui sont listés (`frontieres-connues.json`). Un écart nouveau fait tomber le
contrôle ; un écart disparu mais encore listé aussi. La liste ne peut que baisser (`npm run frontieres -- --ecrire`) ; un
module est « sorti » quand il n'y a plus aucune ligne. **Un lot A** (un déplacement à l'identique) révèle des écarts qui
existaient déjà : il les inscrit avec `--ecrire --deplacement`, et seulement si les écrans servis n'ont pas changé d'un
octet depuis la dernière écriture de la liste (son empreinte) ; on écrit donc la liste avant de déplacer.
**F12** garde, pour chaque gros fichier, ses lignes hors de `modules/` au plus, avec la raison ; une correction urgente
qui doit le faire grandir relève le plafond, avec sa raison, dans le même envoi.

**Où il tourne** : dans `npm test` et `npm run frontieres` ; comme garde de l'installation, avant la construction ; sur
GitHub à chaque envoi ; et dans toute construction qui pose `SKANFACT_CONTROLE=1` (le suiveur la pose ; sur GitHub, le contrôle tourne dans `npm test`) : le
« à chaque construction » du `02` § 9 est ainsi tenu pour les vraies constructions. **Jamais dans les constructions des tests de navigateur** (203 tests construisent le web) : sinon
une preuve dont le défaut déclenche un refus tomberait pour une autre raison, et compterait « prouvée » à vide. Son refus
dit ce qui est refusé, pourquoi, et ce qui débloque.

### 4.3 Le poids de la première ouverture

La première ouverture pèse 1 354 Ko pour un seuil de 1 300 (`docs/paie.md`, mesure du 02/11) ; le test l'exige deux fois
(la page, et la copie gardée pour le hors-ligne). Le rangement ne doit pas l'alourdir : **+1 Ko au plus par lot**, mesuré.
À part (lot L9), on charge à la demande ce qui **demande internet de toute façon** (l'abonnement, le support, l'équipe,
les accès, l'assistant : environ 44 Ko, à mesurer fichier par fichier), et l'héritage de l'application de bureau une fois
prouvé qu'il ne s'affiche jamais (environ 29 Ko). Cela ne suffit sans doute pas sur GitHub (environ 1 311 Ko) : d'où la
décision 3 (les visites à la demande, −74 Ko). Le pointage reste gardé d'avance : le `16` § 7 promet de noter la journée
sans réseau.

---

## 5. L'ordre des lots

| Lot | Ce qu'il fait |
|---|---|
| **V0** | Partir d'un état connu : la liste figée de ce qui est rouge aujourd'hui (preuves de la nuit, poids, tests), avec le texte exact de chaque échec |
| **V1** | Le défaut `charte` (`app.js:17134`) : un test (un achat en devise sans taux est refusé, sans erreur), la correction d'une ligne, l'essai à l'écran. Correction urgente |
| **R0a à R0e** | Les outils : faire suivre les preuves (§ 6) ; l'assembleur partout, d'abord « à l'identique » ; le contrôle des frontières (mesure, puis cliquet) ; la comparaison des écrans (42 routes et leurs onglets, 11 routes du Cabinet, au bureau et au téléphone) et du moteur (sur l'exemple de cinq ans) ; les onze fiches `module.json` (le socle et les dix modules du lancement), la ligne du `12`, la correction du `02` § 9, les documents périmés. *R0a fait le 03/11/2026 (1.266.8) : `commun/assemblage.ts`, `modules/assemblage.json` (13 fichiers servis, chacun son unique morceau), la construction (avant l'allègement), le développement (à la volée), le chargeur de Node `lireEcran` (25 lecteurs recopiés remplacés) ; construit avant et après : 216 fichiers identiques à l'octet, dont 81 copies compressées. R0e fait le même jour : `modules/ordre.json` et les onze fiches `module.json` (pages et familles, collections, noms de gestes, schémas, dépendances ; portes, points, emplacements et événements posés vides pour B0), leur test (`tests/commun/fiches-modules.test.ts`), le `12` § 1 et § 8, le `02` § 9, `VISION-ARCHITECTURE.md` § 4.8, `eslint.config.js`. R0c fait le même jour (1.266.9) : `outils/rangement/frontieres.ts` (acorn et eslint-scope, ce dernier désormais en dépendance directe), `modules/frontieres-connues.json` (51 écarts, tous F13, et les plafonds F12), `npm run frontieres`, la garde de la construction (`SKANFACT_CONTROLE=1`, posée par le suiveur), le champ « serveur » des fiches, et son test (`tests/commun/frontieres.test.ts` : chaque code prouvé sur un petit dépôt, 41 preuves). R0b fait le même jour (1.266.10) : `outils/rangement/deplacer.ts` et `outils/rangement/preuves.ts` (§ 6), le contrôle éclair et le choix des preuves nouvelles qui s'en servent, 22 preuves. R0d fait le 04/11/2026 (1.266.12), après A1 : la photo du moteur (`outils/rangement/moteur.ts` : 846 fonctions jouées sur l'exemple de cinq ans, au 15/06/2026) et la comparaison des écrans (`outils/rangement/ecrans.ts` et `tests/web/ecrans-comparer.test.ts` : 49 pages de l'entreprise et 17 du Cabinet, leurs onglets, la palette et « Créer », au bureau et au téléphone) ; A1, comparé à R0b, les passe : le même moteur, les mêmes écrans.* |
| **A1** | `app.js`, `cabinet/app.js`, `core.js` et `compta.js` passent entiers sous `modules/socle/`, avec `guide.js`, `visites.js`, `cabinet/cabguide.js` et `cabinet/cabvisites.js`. **Le Personnel est coupé à l'identique** dans chacun, et ses styles (`paie.css`, `paie-maquette.css`, `paie-cabinet.css`) passent dans `modules/personnel/styles/`, servis à leur adresse : environ 10 500 lignes de code et 2 300 de styles, 1 648 chemins de preuves réécrits. *Fait le 04/11/2026 (1.266.11), d'un seul geste de `outils/rangement/deplacer.ts` : 19 morceaux (le socle en deux morceaux par fichier coupé, `app-1.js` et `app-2.js`, `core-1.js` et `core-2.js`… jusqu'à ce que les lots A2 à A6 les coupent à leur tour ; l'aide sous `modules/socle/aide/`, les visites sous `modules/socle/visites/`), 10 400 lignes de code et 2 294 de styles au Personnel, 1 749 preuves suivies, toutes équivalentes, 361 écarts révélés et inscrits (263 F4, le socle qui nomme la paie ; 98 F7, une écriture d'un côté à l'autre), aucun F0, F1, F8 ni F9 ; plus une ligne des huit fichiers hors de `modules/` (F12). Les deux ponts restent à leur place (lots de fin).* |
| **A2 à A6** | Les autres modules, coupés à l'identique (Ventes et Achats après les chantiers en cours ; puis Trésorerie, Déclarations, Pilotage, Stock, Caisse, Comptabilité complète, Cabinet) ; le socle rangé en sous-dossiers ; ce qui est partagé remonte au socle (les icônes, les menus de ligne, les noms de pièces, les mois…) |
| **B0** | Les registres du socle (points, emplacements, événements), posés vides : aucun module ne s'en sert encore. *Fait le 04/11/2026 (1.266.13) : `modules/socle/registres.js`, servi sous `plateforme/registres.js`, le premier script des deux pages ; la porte (`Socle.declarer`, `Socle.porte`), les points (`declarerPoint`, `remplir`, `lire`), les neuf emplacements du § 3.3 (`poser`, `entrees`, chaque entrée à son rang), les événements (`annoncer`, `ecouter`) ; vides, aucun écran ne s'en sert (§ 6).* |
| **P1b** | Le Personnel ferme sa porte côté entreprise (ses emplacements, le point de la Trésorerie, sa boîte). *Fait le 04/11/2026 (1.266.14) : le morceau de la paie de l'entreprise dans sa boîte (une fonction appelée sur-le-champ, posée autour du morceau sans en réindenter le code) : ses noms ne se voient plus du socle. Ce que le socle écrivait pour lui en dur passe par les registres, chaque entrée à son rang d'aujourd'hui : ses deux pages (`pages` : la Paie et la fiche d'un salarié, la route, ce qui la dessine, les onglets que lit la palette), six lignes de « À faire » (« Voir les bulletins » sert aussi aux contrôles avant clôture), le pointage de « Créer », huit gestes de la palette. Il remplit deux points, que les écrans de leur module, encore au socle, déclarent : `sorties-prevues` (la Trésorerie : ses salaires et ses avances, et comment ouvrir chacun) et `declarations-sociales` (le calendrier fiscal : la CNSS et la déclaration d'employeur, où les préparer, comment retirer « déposée »). `montantU` passe au socle (les marges et la trésorerie s'en servent), `manqueEquipe` au Personnel ; le texte prêt pour la conversation passe par `ecrireAuComptable`. Sa porte reste vide : aucun autre module ne le lit à l'écran. Le cliquet baisse de 147 : plus aucun écart du Personnel côté entreprise (53 F4, 94 F7).* |
| *(la paie refaite du `16` peut commencer ici, directement dans `modules/personnel/`)* | |
| **P1c, P1d** | Côté Cabinet, puis son moteur, en alternance avec les lots P2 et P3 du `16` (et la revue de la paie du Cabinet) |
| **Menu** | Les six familles (§ 1), après leur maquette |
| **B ×9** | Les autres boîtes, dans cet ordre : Caisse, Stock, Pilotage, Cabinet côté entreprise, Comptabilité complète, Déclarations, Trésorerie, Achats, **Ventes en dernier** (tout le monde en dépend) |
| **B-compta ×2, B-paramètres, B-moteur ×4, B-Cabinet ×4** | La comptabilité découpée par onglet ; le panneau Cabinet des paramètres ; les calculs qui rassemblent tous les modules (le journal des écritures, « À faire », la clôture, la prévision, le résultat) demandent à chacun sa part, dans l'ordre d'aujourd'hui, au lieu d'aller la lire chez lui ; les sections du Cabinet (Banque, Saisie et livres, Déclaration, Portefeuille) |
| **Fin** | Les tests rangés dans les dossiers ; le serveur dans `modules/<m>/serveur` avec ses portes ; le lint et les types étendus au code rangé ; les deux ponts découpés ; le cliquet supprimé |
| **L9** | Le poids (§ 4.3), en parallèle |
| **C** | Le chargement à la demande d'un module : seulement si Skander dit oui (décision 4) |

**L'effort** : 7 lots préalables, 6 lots A, 24 lots B (B0 ; P1b à P1d ; 9 boîtes ; B-compta ×2 ; B-paramètres ;
B-moteur ×4 ; B-Cabinet ×4), 8 lots de fin, 2 lots de poids : **47 lots obligatoires**, plus celui du menu. Les
lots A sont faits par l'outil et coûtent surtout de la vérification ; un lot B demande une à deux sessions ; la
comptabilité et le moteur sont les plus longs. Chaque lot coûte environ 70 minutes de machine pour la batterie, plus les
preuves du changement (pour le Personnel : environ 25 minutes). **Avant la paie refaite : V0, V1, R0a à R0e, A1, B0 et
P1b, soit 10 lots.** En même temps, dans la même session : les corrections urgentes du `16` § 10.1 avec les lots R0.

---

## 6. Comment chaque lot se prouve, et comment les preuves suivent

| Lot | Ce qui le prouve (les seuils s'écrivent dans le lot, avant de commencer) |
|---|---|
| R0 | Les fichiers construits identiques octet pour octet à ceux d'avant, copies compressées comprises ; le chargeur de Node rend le même texte ; la batterie complète, avec la liste des rouges connus inchangée |
| A | **La même empreinte** pour chaque fichier servi, et zéro différence dans ce qui est construit ; chaque preuve déplacée **équivalente** (ci-dessous) ; sur dev.skanfact.tn, les mêmes versions de chaque script ; un essai à la souris des parcours du module dans les deux applications (pour A1 : la journée, le mois, un bulletin, et l'impression d'un bulletin au Cabinet) |
| B | Deux commits. **Le premier** pose la photo des écrans prise **avant** le code (le contenu de la page, les pixels, et l'ordre des registres : palette, À faire, Créer, compteurs, onglets du téléphone) ; il doit tomber si aucune route n'est mesurée. **Le second** pose le code : la photo doit rester égale. Puis : seuls les noms annoncés changent ; le cliquet baisse exactement du nombre annoncé ; F1, F8 et F9 à zéro ; le poids à +1 Ko au plus ; toutes les preuves du module ; un essai à la souris dans les deux applications, en clair, en sombre et au téléphone ; chaque route ouverte directement par son adresse |
| Moteur | Chaque fonction du moteur, jouée sur l'exemple de cinq ans à date fixe, donne le même résultat avant et après ; plus les invariants « deux chemins, un chiffre » (`verite-comptable`) et les bancs qui comparent le moteur du serveur au moteur des écrans |

**Les preuves suivent le code** (5 926 preuves aujourd'hui, dont 1 648 sur ces quatre fichiers) :
1. L'outil qui déménage réécrit, **dans le même commit**, le fichier visé par chaque preuve ; chaque motif doit se
   trouver **une seule fois** dans sa famille (entreprise, Cabinet, moteur, aide).
2. **L'équivalence** : pour chaque preuve déplacée, assembler le morceau avec le défaut posé doit donner, octet pour octet,
   l'ancien fichier avec le même défaut posé. C'est la preuve que le déplacement ne l'a pas affaiblie, obtenue en quelques
   millisecondes ; GitHub les rejoue quand même (pour A1, environ 1 h 45, une fois). Aucune preuve n'est retirée.
3. Les contrôles des preuves apprennent les nouveaux pièges : un motif présent dans plusieurs fichiers (une copie morte
   qui garderait une preuve verte), un fichier non assemblé, une définition en double, une preuve qui viserait les outils
   du rangement.
4. Un morceau changé choisit ses preuves ; un changement de l'**ordre** d'un fichier assemblé choisit toutes les preuves
   de ce fichier.

**Fait au lot R0b** (03/11/2026, 1.266.10) : `outils/rangement/deplacer.ts` coupe un fichier servi selon un plan (des
morceaux par lignes, sous `modules/<module>/`), d'un seul geste et tout ou rien : le contrôle des frontières vert avant,
les morceaux et la table, l'ancien fichier retiré, chaque fichier servi identique à l'octet, chaque preuve suivie
(`outils/rangement/preuves.ts` : le morceau de sa famille qui porte son motif, une seule fois ; réécrite à la ligne de son
appel, que `tests/lister-preuves.sh` donne avec `LIGNES=1` ; une variable comme `$APP` devient le chemin du morceau),
l'équivalence de chacune, puis les écarts révélés inscrits (`--deplacement`, qui n'inscrit **jamais** F0, F1, F8 ni F9).
Au moindre refus (un motif coupé ou en double, une boucle de preuves partagée entre deux morceaux, un fichier qui n'est
pas sur la ligne de son appel, une coupe au milieu d'une instruction), chaque fichier reprend son contenu. Les familles :
entreprise (`app.js`, le pont), Cabinet (son `app.js`, son pont), moteur (`core.js`, `compta.js`), aide (les deux guides,
les deux visites), styles (les trois feuilles de la paie). Le contrôle éclair (`tests/verif-preuves.sh`) dit désormais un
motif présent dans plusieurs fichiers de sa famille (4 preuves l'étaient, leurs motifs sont allongés), un morceau que la
table ignore, un défaut qui casse la syntaxe du fichier **assemblé**, une preuve d'un outil du rangement qui vise un autre
test que ceux de `tests/commun/`. Le point 4 est lu ainsi (décision du 03/11/2026, proposée) : un fichier servi dont la
**liste** de morceaux change (un morceau nouveau, retiré ou déplacé, ou l'ordre) choisit toutes ses preuves ; un morceau
dont seul le contenu change garde la règle d'aujourd'hui (ses preuves changées seules, GitHub rejoue toutes les autres),
sinon chaque correction du socle choisirait un millier de preuves.

**Fait au lot A1** (04/11/2026, 1.266.11) : le plan (`app.js` coupé aux lignes 18 344 et 23 314, le Cabinet à 10 660 et 13 223, `core.js` à 4 260 et 5 600, `compta.js` à 6 295 et 7 822 : de l'en-tête de la paie à celui du module suivant) est passé d'un geste, essayé d'abord sur une copie du dépôt. Ce qui le prouve ici : chaque fichier servi identique à l'octet (l'outil), chaque preuve déplacée équivalente (l'outil), la construction de production identique avant et après (216 fichiers à l'octet, copies compressées comprises), le contrôle éclair et le contrôle des frontières verts, les tests qui lisent ces fichiers ; GitHub rejoue les preuves déplacées. Ce qui a suivi à la main : la preuve R0a h (son motif est la ligne du Cabinet dans la table), le test du lot R0a retourné vers la règle d'après (`tests/commun/assemblage.test.ts`), trois tests qui lisaient encore un fichier à son ancienne adresse (l'aide du Cabinet, l'allègement des écrans, la mesure F12), le lint qui laisse de côté exactement les morceaux de la v10 que la table nomme (le code neuf d'un module reste contrôlé), la vérification d'une brique qui relance le rendu des écrans quand un morceau de `modules/` change.

**Fait au lot R0d** (04/11/2026, 1.266.12) : deux instruments, chacun prouvé sur un petit cas qui doit le faire tomber
(`tests/commun/comparer.test.ts`). **La photo du moteur** (`node outils/rangement/moteur.ts --photo F [RACINE]`, puis
`--comparer A B`) charge `core.js` et `compta.js` assemblés dans un bac à sable, la date figée au 15/06/2026 à 10 h et le
hasard tiré d'une graine, remplit l'exemple de cinq ans (`demo.js`) et un grand livre du premier trimestre, puis joue
chaque fonction rendue publique trois fois, ses arguments choisis par le nom du paramètre (un mois pour `month`,
l'exemple pour `data`…), chaque appel sur sa propre copie ; elle garde l'empreinte de ce qui est rendu **et** de ce que
la fonction a écrit dans ce qu'on lui passe. Elle refuse de comparer une photo qui n'a pas atteint le moteur (au moins
700 fonctions et 1 000 appels rendus, seuils écrits avant de mesurer) et dit une fonction nouvelle, disparue, ou dont un
appel ne rend plus la même chose. Mesurée : 846 fonctions, 2 538 appels (2 237 rendus, 301 refusés par le moteur, les
mêmes des deux côtés), une minute et demie. **La comparaison des écrans** (`SKANFACT_COMPARER_AVEC=<commit> npx vitest run
tests/web/ecrans-comparer.test.ts`, que `npm test` saute faute de référence) construit les écrans du commit (dans une
copie de travail git) et ceux du dépôt, sert chacun sur sa copie de la même base (`create database … template` : un
compte, son entreprise remplie de l'exemple, un cabinet qui la tient par mandat), l'horloge du navigateur figée au même
instant, et compare chaque page (49 de l'entreprise : chaque route de `PAGE_LABELS` et une fiche de chaque sorte ; 17 du
Cabinet : ses routes et un dossier ouvert dans chacune de ses parties), chacun de ses onglets, la palette et « Créer »,
à 1 440 et à 390 : le texte, la structure (chaque élément, sa classe, son rôle, son état), les pixels, et l'ordre des
registres (l'adresse, la barre, la barre du bas, les onglets). Chaque page prouve d'abord qu'elle est la bonne (son
adresse, sa vue remplie) ; une route qu'on n'ouvre pas s'écrit avec sa raison (trois de l'entreprise, une du Cabinet),
et le test dit une route neuve ni comparée ni écrite ; un témoin (les écrans d'après, un seul style changé) doit tomber.
Ce que la première mesure a appris (A1 contre R0b, deux constructions identiques à l'octet, donc toute différence
venait de l'instrument) : une photo prise trop tôt (l'aperçu d'un devis encore en train de se dessiner) ; une page
atteinte depuis la précédente, qui en garde des traces ; l'invitation « Première fois sur cette page ? », placée avant
que l'en-tête soit posé (sous « Exporter » au lieu de « Guide-moi » au Tableau de bord du Cabinet, au téléphone : un
défaut de l'application, à reprendre) ; au Cabinet, l'espace fine avant « : » posée par un passage de typographie qui
manque le texte arrivé après lui (le Tableau de bord, la paie d'un dossier : selon le moment, la phrase l'a ou ne l'a
pas ; un défaut de l'application, à reprendre) ; quelques pixels de lissage sur le bord d'une lettre, qui changent d'une
prise à l'autre. D'où la règle de l'instrument : chaque page s'ouvre de zéro par son adresse ; elle se photographie
quand elle ne bouge plus (deux lectures de suite identiques, au plus neuf secondes, sinon elle est dite), sur toute sa
hauteur ; l'invitation est éteinte des deux côtés ; deux photos sont les mêmes à 32 pixels près, un pixel ne comptant que si sa
couleur bouge de plus de 16 niveaux sur 255 (`outils/rangement/pixels.ts` ; la tolérance de couleur ajoutée au lot B0) ; une paire qui diffère est reprise de zéro, des deux côtés, jusqu'à quatre fois (une vraie
différence revient à chaque fois, celle qui tient au moment disparaît ; le bilan dit les pages reprises) ; le texte et la
structure de chaque photo s'écrivent à côté d'elle. A1, comparé à R0b : 396 comparaisons (49 pages de
l'entreprise et 17 du Cabinet, leurs onglets, la palette et « Créer », à 1 440 et à 390), toutes atteintes, aucune
différence ; sept reprises (l'aide du Cabinet en a demandé cinq, la limite : le point fragile de l'instrument) ; le
témoin tombe ; 27 minutes.

**Fait au lot B0** (04/11/2026, 1.266.13) : les registres du socle (`modules/socle/registres.js`, `window.Socle`), du code
neuf, contrôlé comme les scripts de la plateforme (le lint, les types), servi sous `plateforme/registres.js` et chargé
avant tout autre script sur les deux pages (la table de l'assemblage, les deux `index.html`). Ce qu'ils tiennent :
la porte d'un module (`declarer`, une fois, une copie figée ; `porte`, qui dit le module qui ne l'a pas déclarée) ; les
points (`declarerPoint` par le module qui en a besoin, `remplir` par les autres, jamais par lui-même ni deux fois ;
`lire` rend la suite de leurs listes, une liste vide si personne ne remplit, et refuse une part qui n'est pas une liste) ;
les neuf emplacements du § 3.3 (`a-faire`, `palette`, `creer`, `pages`, `parties-des-pages`, `metiers`, `imports`,
`onglets-compta`, `parametres-cabinet` : `poser` exige le rang d'aujourd'hui et refuse deux rangs égaux, `entrees` les
rend rangées) ; les événements (`annoncer` et `ecouter`, qui rend de quoi cesser) : ceux de la page (`window`), pour que
les trois d'aujourd'hui (`skanposte`, `skanfact-questions`, `skanfact-tickets-remis`) gardent leur nom et leurs écoutes.
Chaque refus dit ce qui est refusé, pourquoi et ce qui débloque ; `Socle.etat()` dit ce qu'ils tiennent. Posés vides :
aucun écran ne s'en sert (le test le dit ; le lot P1b sera le premier). Prouvé par `tests/commun/registres.test.ts`
(5 tests, chaque règle sur des modules d'essai, dans un bac à sable qui charge le fichier servi) et
`tests/web/registres.test.ts` (les deux pages construites : le fichier servi, chargé le premier, les registres là et
vides, sans erreur), 17 preuves, le contrôle des frontières tenu, et la comparaison des écrans contre R0d :
396 comparaisons, toutes atteintes, aucune différence, une seule reprise (le Tableau de bord du Cabinet), le
témoin tombe, 24 minutes. Le poids : la première ouverture pèse 1 584 octets de plus (le fichier, 1,3 Ko compressé une fois
resserré, et sa demande), au-delà du +1 Ko par lot du § 4.3 : écrit au § 9, à décider. Fait en chemin : le test de R0d
(`tests/commun/comparer.test.ts`) écrivait son petit moteur sous `web/public/v10/`, ce que la règle de l'assemblage
refuse ; il passe désormais par la table, comme le vrai ; et la comparaison de B0 a montré deux écarts de
lissage plus larges que 32 pixels (l'en-tête de la barre du Cabinet, 37 pixels, et le contour du champ d'écriture des
Messages, jusqu'à 259 pixels), aux couleurs décalées de 3 à 15 niveaux quand un vrai changement (le témoin) les décale
jusqu'à 218 : un pixel ne compte plus que s'il bouge de plus de 16 niveaux.

**Fait au lot P1b** (04/11/2026, 1.266.14) : le premier module qui se sert des registres. Le morceau de la paie de
l'entreprise (`modules/personnel/ecrans/entreprise/paie.js`) est mis dans sa boîte : une fonction appelée sur-le-champ,
posée autour du morceau sans en réindenter le code (les motifs des preuves restent ceux d'hier) ; ses noms ne se voient
plus du socle, et il pose ses entrées en bas de la boîte, une fois ses noms définis. Le rang d'une entrée est sa place
dans la liste que le socle écrivait en dur ce matin : le socle insère les entrées des modules à leur rang, puis retire
celles qui disent ne pas se voir (`visible`, pour les gestes du mois qui demandent un salarié) ; l'ordre affiché ne
bouge pas. Une page porte sa route, ce qui la dessine et, si la palette lit ses onglets, leur liste et leur rang
(`pages`) ; le routeur cherche une route inconnue de lui parmi les pages des modules avant de renvoyer à l'accueil. Une
ligne de « À faire » peut porter aussi son geste des contrôles avant clôture (`controle`). Les points d'un module encore
au socle (la Trésorerie, les Déclarations) sont déclarés par le code du socle, au nom de leur module : ils le suivront
quand sa boîte sera faite. L'outil des frontières suit deux choses de plus : une constante qui nomme la fenêtre
(`const w = window`) est la fenêtre ; un module qui écrit dans le dossier (`data`) sous une collection ou une racine
que sa fiche lui donne écrit chez lui, pas chez le socle. Ce qui reste écrit au socle au nom du Personnel, et attend son
lot : les liens vers `#/paie` et les noms de pages (`PAGE_LABELS`), les métiers (`pointage`, `paie`) et l'import des
salariés (les emplacements `metiers` et `imports`, au lot du menu), l'écriture de `data.socialFilings` par le calendrier
fiscal (F6, au lot des Déclarations). L'aide et les visites de la paie restent au socle : elles sortiront avec P1c,
qui les coupe des deux côtés d'un même geste. Prouvé par `tests/commun/registres.test.ts` (ce que les écrans posent dans
les registres, lu dans le code servi, et la fiche de chaque module qui le dit ; la boîte du Personnel, une seule
expression, qui pose après ses définitions), `tests/commun/frontieres.test.ts` (la constante et le dossier, sur un petit
dépôt), `tests/web/registres.test.ts` (les deux pages construites : l'état des registres, la Paie et la fiche d'un
salarié ouvertes par leur adresse, la palette, les deux points), 10 preuves, le cliquet baissé de 147 (412 → 265 : plus
aucun écart du Personnel côté entreprise), et la comparaison des écrans contre B0 : 396 comparaisons, toutes atteintes, aucune différence, aucune reprise, le témoin tombe, 24 minutes. Le poids : `app.js`
pèse 612 octets de plus compressé (brotli), sous le +1 Ko du § 4.3. Fait en chemin : la vérification de la brique a fait tomber `tests/web/registres.test.ts` une fois sur une machine chargée ; la cause, reproduite en ralentissant la page vingt fois : après la redirection de la fiche d'un salarié inconnu vers la Paie, l'adresse change avant que la page soit redessinée (le dessin attend la prochaine image, 80 ms au plus), et ce dessin referme la palette qu'on vient d'ouvrir ; le test rouvre désormais la palette tant qu'elle n'est pas là, et passe sous le même frein. Essayé à la souris sur l'exemple de cinq ans : la ligne « 1 déclaration sociale à déposer » de « À faire » mène aux déclarations de la Paie ; la fiche d'un salarié s'ouvre par son adresse ; la palette montre « Payer les salaires du mois » quand il y a des salariés, et le geste mène au mois ; en restauration, « Créer » propose le pointage à sa place (quatrième) et il ouvre les présences ; la Trésorerie ouvre le bulletin d'une échéance de salaire et mène à la Paie depuis un salaire estimé ; le calendrier fiscal prépare la CNSS dans la Paie et pose sa question avant de retirer « déposée ». Pas rejoué à la souris : « Demander une correction », qui ne se montre que sur un mois que le cabinet prépare (le texte passe par `ecrireAuComptable`, les deux mêmes instructions qu'avant).

---

## 7. Les risques, et leur parade

| Risque | Parade |
|---|---|
| Une preuve qui « passe » parce que la construction est refusée | Aucun contrôle dans les constructions des tests (§ 4.2) |
| Une copie morte qui garde une preuve verte | « Motif dans plusieurs fichiers » ; F8 |
| Un nom pas encore défini au démarrage, après un regroupement | F9 suit aussi les appels faits au chargement ; chaque route ouverte par son adresse ; les erreurs de page surveillées dans les 203 tests |
| L'ordre des écouteurs (le clavier, les clics, le redimensionnement) | L'ordre est figé par cible et par événement (F9) |
| L'ordre des entrées de l'aide | Un morceau par bloc en A ; en B, un test « mêmes clés, même ordre » |
| Du travail en cours au moment de la coupe (pointage, devis, achat) | Selon la décision 2 : il arrive avant le lot A de son module, ou il reprend dans le dossier ; un outil reporte un correctif écrit sur l'ancien fichier ; F12 |
| Un morceau qui passe d'une application à l'autre (le Cabinet tourne en mode strict, l'entreprise non) | Aucun morceau ne change d'application : `ecrans/entreprise/` et `ecrans/cabinet/` restent séparés ; les 110 noms recopiés entre les deux `app.js` s'unifient plus tard, dans un lot à part, après un seuil de poids écrit pour le Cabinet |
| Le mélange de versions (un onglet resté sur l'ancienne version) | Ne compte qu'en phase C, avec ses trois parades (empreintes servies depuis la version précédente, purge du cache des écrans, repli sur la copie gardée après une erreur du serveur) |
| Le poids qui grandit (+106 Ko en 36 heures récemment) | +1 Ko au plus par lot ; lot L9 |
| L'héritage de l'application de bureau, caché mais exécuté | Rangé à part ; retiré seulement avec la preuve qu'il ne s'affiche jamais |

---

## 8. Ce que ce document change ailleurs (à sa validation)

- `02` § 9 : l'outil de contrôle est choisi ici (un contrôle maison) ; « à chaque construction » devient « à chaque
  installation, à chaque envoi et à chaque vraie construction, jamais dans celles des tests » ; un module porte les écrans
  des deux applications ; les migrations restent dans la suite unique de la base, la fiche les nomme. `02` § 2 et M3 : un
  seul moteur, servi par le socle, ses morceaux rangés dans le dossier du module qui les possède. `02` § 10 : la
  correspondance avec `MODULES` du § 2.1.
- `12` : la ligne de l'outil de contrôle des frontières et de l'assemblage.
- `16` § 10.2 : le lot P1 devient A1 puis P1b, P1c, P1d (§ 5).
- `CLAUDE.md` : la règle « Le code : un dossier par module » nomme tous les gros fichiers (le Cabinet, l'aide, les
  visites, les deux ponts) : posée dès maintenant avec ce document, puisque la règle vient de Skander ; si la décision 2
  ouvre une seconde exception, elle s'y écrit, datée.
- Les documents périmés, au lot R0e : `VISION-ARCHITECTURE.md` (les « 19 000 lignes de `src/renderer/app.js` »),
  `docs/leger.md`, `eslint.config.js` (le code de la v10 « repris tel quel », qui ne le restera pas), la carte du
  `CLAUDE.md`.
- `docs/maquettes/barre-v5.html` : la maquette passe à six familles (§ 1).
- `README.md` : le document 17 et son entrée au journal.

---

## 9. Décisions de ce document

*Le 03/11/2026, Skander a validé le document entier (« Je suis d'accord avec tout ce que tu m'as dit ») : chaque ligne « proposé » et « à décider » ci-dessous
est décidée selon la recommandation de Claude : on finit les chantiers commencés avant leur déménagement (seconde
exception, écrite au `CLAUDE.md`), les visites guidées se chargent à la demande, et le chargement à la demande des
modules attend la fin du rangement.*

| Date | Décision |
|---|---|
| 03/11/2026 (**Skander** : « je suis d'accord avec toi sur le fond et sur le menu aussi ») | Le menu en six familles ; une seule liste de modules ; un dossier par module |
| 03/11/2026 (**Skander** : « oui je suis d'accord alors de tout sortir , il faut faire ce qu'on a deja fait la refonte et paie aussi. et note le comme regle afin que les prochains savent ») | Tout sort des gros fichiers, y compris ce qui est déjà refait ; règle permanente au `CLAUDE.md` |
| 03/11/2026 (proposé) | On déplace les sources, pas les fichiers servis : assemblés à la construction, identiques à l'octet pendant les lots A |
| 03/11/2026 (proposé) | La porte : une boîte par module pour les écrans ; le moteur rangé par module mais servi comme un seul (M3) |
| 03/11/2026 (proposé) | Un module porte les écrans des deux applications ; le Cabinet ne garde que le portefeuille |
| 03/11/2026 (proposé) | Un contrôle des frontières maison, avec un cliquet qui ne fait que baisser, jamais dans les constructions des tests ; fait au lot R0c (1.266.9) : seul un déplacement à l'identique, prouvé par l'empreinte des écrans servis, agrandit la liste |
| 03/11/2026 (proposé) | Les preuves qui suivent (R0b, 1.266.10) : un déplacement est tout ou rien ; il n'inscrit jamais F0, F1, F8 ni F9 ; une liste de morceaux qui change choisit toutes les preuves de son fichier, un contenu qui change garde la règle d'aujourd'hui |
| 03/11/2026 (proposé) | Les preuves suivent le code dans le même commit, avec l'équivalence octet pour octet ; aucune n'est retirée |
| 03/11/2026 (proposé) | L'ordre des lots du § 5 ; Personnel le premier, Ventes la dernière boîte ; le menu dans un lot à part |
| 03/11/2026 (proposé) | Les migrations restent une seule suite numérotée |
| 03/11/2026 (proposé) | Le poids (L9) : charger à la demande ce qui demande internet de toute façon ; retirer l'héritage du bureau seulement avec la preuve qu'il ne s'affiche jamais |
| 03/11/2026 (proposé) | La règle du `CLAUDE.md` nomme tous les gros fichiers (le Cabinet, l'aide, les visites, les deux ponts) ; le nom des dossiers du § 3.1 ; ce qu'un module demande aux ponts s'écrit dans son dossier |
| 03/11/2026 (proposé, lot R0e) | Qui possède quoi, dans les fiches : les fiches communes (`clients`, `suppliers`, `catalog`) et la validation du mois (`clotures`, `closedUntil`, `closureLog`) au socle, la page des fournisseurs aux Achats ; la page Comptabilité aux Déclarations, ses immobilisations (`assets`) et ses OD à la Comptabilité complète ; `projectTime` aux Ventes (les affaires) ; les gestes des Déclarations, encore sous « compta », changent de nom au lot de leur boîte |
| 04/11/2026 (proposé, lot A1) | Les morceaux du socle gardent un nom de place (`app-1.js`, `app-2.js`…) jusqu'à ce que leurs modules en sortent ; l'aide et les visites vont au socle entières (leurs articles de la paie sortiront avec P1b) ; le lint ignore les morceaux de la v10 nommés par la table, rien d'autre ; un lot A se prouve ici par l'outil, la construction identique et les contrôles, GitHub rejouant ses preuves |
| 04/11/2026 (à décider par Skander, lot B0) | Les registres alourdissent la première ouverture de 1,5 Ko (1 584 octets mesurés : le fichier, 1,3 Ko compressé, et sa demande), au-delà du +1 Ko par lot du § 4.3. Proposé : l'accepter, parce que c'est du code neuf qui portera les listes aujourd'hui écrites en dur, pas un déplacement, et le reprendre au lot L9 (le poids) ; l'autre voie, le servir dans un fichier déjà demandé, n'existe pas proprement (les deux pages ne partagent aucun script avant les ponts) |
| 04/11/2026 (proposé, lot B0) | Les registres du socle sont du code neuf, contrôlé (lint et types), servis sous `plateforme/registres.js` et chargés avant tout autre script ; les événements du socle sont ceux de la page (`window`), pour que les trois d'aujourd'hui gardent leur nom et leurs écoutes ; un point rend toujours une liste et ne se remplit pas par son propre module ; une entrée d'emplacement porte son rang, deux rangs égaux sont refusés ; une porte est une copie figée, déclarée une fois |
| 04/11/2026 (proposé, lot R0d) | La photo du moteur se prend au 15/06/2026, le hasard tiré d'une graine, sur l'exemple de cinq ans ; elle compare ce que chaque appel rend et ce qu'il écrit dans ses arguments ; ses seuils (700 fonctions, 1 000 appels rendus) refusent une photo vide. La comparaison des écrans ne tourne pas dans `npm test` (une demi-heure, et il lui faut un commit de référence) : un lot B la lance contre le commit qui le précède, un lot A peut la lancer ; une route qu'elle n'ouvre pas s'écrit avec sa raison |
| 04/11/2026 (proposé, lot P1b) | La boîte d'un module est une fonction appelée sur-le-champ, posée autour de son morceau sans en réindenter le code (les motifs des preuves restent), et il pose ses entrées en bas de la boîte ; le rang d'une entrée est sa place dans la liste que le socle écrivait en dur, le socle insère les entrées à leur rang puis retire celles qui disent ne pas se voir ; une page porte sa route, ce qui la dessine et, si la palette les lit, ses onglets à leur rang ; une ligne de « À faire » porte aussi son geste des contrôles avant clôture ; le point d'un module encore au socle est déclaré par le code du socle, à son nom, et le suit à sa boîte ; un module qui écrit sa propre collection ou sa racine du dossier écrit chez lui (pas un F7), le socle qui écrit la collection d'un module attend le lot de sa boîte (F6) ; l'aide et les visites de la paie sortent avec P1c, des deux côtés d'un même geste |
| 03/11/2026 (à décider par Skander) | Finir les chantiers commencés dans les gros fichiers avant leur déménagement, ou les reprendre dans le dossier (décision 2) |
| 03/11/2026 (à décider par Skander) | Les visites guidées chargées à la demande (décision 3) ; le chargement à la demande des modules (décision 4) |
