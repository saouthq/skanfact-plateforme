# Ce que SkanFact garde, combien de temps, et comment ça part

*Écrit le 19/10/2026 (1.55.0 ; base 0144 ; `docs/console.md` C68 ; l'audit 1.42.0 § 4, point 8). Décidé par délégation
(Skander, « prends la décision à ma place »). Chaque durée marquée **À VÉRIFIER** attend la confirmation de l'INPDP ou
d'un juriste (`docs/cadrage/05-obligations-legales.md` § 4.3) : rien ne s'efface plus tôt que la loi le permet, rien ne
se garde plus longtemps qu'elle le demande.*

La console montre ce tableau (Données personnelles › « Ce que SkanFact garde ») ; sa liste vit dans le code
(`serveur/console/donnees.ts`, `CONSERVATION`), un test la tient.

## Les deux rôles de SkanFact

- **Le compte d'une personne** (son nom, son adresse e-mail, son téléphone, son mot de passe, ses codes, ses appareils,
  ses sessions) : SkanFact en est **responsable**. Une demande d'effacement se décide et se fait depuis la console.
- **Les données d'une entreprise** (ses pièces, sa comptabilité, ses fiches, ses fichiers, ses demandes au support) :
  SkanFact les tient **pour elle**. Son propriétaire seul en demande l'effacement ; il se fait sur la machine, avec
  l'outil de l'exploitation (C54), jamais depuis la console. Les personnes que ces données nomment (les clients d'une
  entreprise, ses salariés) s'adressent à l'entreprise : c'est elle qui en répond.

## Le tableau

| Les données | Gardées | Comment elles partent |
|---|---|---|
| Le compte d'une personne | tant que le compte sert ; effacé à sa demande (**À VÉRIFIER**) | d'ici, à la demande de la personne |
| Les données d'une entreprise | jusqu'à la fin de son contrat, plus dix ans (**À VÉRIFIER**, C54) | sur la machine, avec l'outil de l'exploitation, à la demande de l'entreprise ou à son terme |
| Les adresses internet de l'entrée | trente jours (**À VÉRIFIER**, C67) | d'elles-mêmes, à leur terme |
| Les sessions et leur adresse internet | tant que le compte sert (**À VÉRIFIER**) | avec le compte |
| Les demandes au support | comme les données de son entreprise (**À VÉRIFIER**) | avec les données de l'entreprise |
| Les journaux et les traces | toujours (**À VÉRIFIER**) | jamais : la loi les garde ; elles ne nomment plus une personne effacée |
| Les copies de secours | trente jours, puis elles tournent | d'elles-mêmes, à leur terme |

## Une demande d'effacement

1. **Notée** (la direction ou le support) : le jour où elle est arrivée (jamais plus tard qu'aujourd'hui), par où
   (e-mail, courrier, téléphone, le support, autre), qui la fait, et ce qu'elle vise — un compte (son adresse e-mail) ou
   une entreprise (son numéro de client, « E-0012 »). Elle prend un numéro (« EFF-2026-001 ») et une **échéance de
   réponse : trente jours après son arrivée** (**À VÉRIFIER** : le délai de la loi 2004-63). Le motif reste au journal ;
   il ne recopie ni le nom ni l'adresse de la personne (la demande les porte déjà, et les perd à l'effacement).
2. **Décidée** (la direction seule) : accordée, ou refusée **avec sa raison**, qui se répond à la personne. Une demande
   sans décision à son échéance entre dans « À décider » en tête, juste après un service grave. Les exceptions qui
   justifient un refus (**À VÉRIFIER** avec un juriste) : l'identité de la personne n'est pas prouvée ; la loi impose de
   garder ce qu'elle demande d'effacer (une pièce comptable) ; elle est encore membre d'une entreprise (son entreprise la
   retire d'abord de son équipe).
3. **Faite** (la direction seule, une demande accordée) : `socle.effacer_personne`. Le geste ne se défait pas, et se dit
   avant :
   - **ce qui part** : son nom devient « Personne effacée », son adresse e-mail est remplacée par une adresse qui
     n'existe pas (`efface-…@efface.invalid` : l'adresse se libère, la personne peut revenir comme une inconnue), son
     téléphone, son mot de passe, ses codes, ses codes de secours, ses liens de mot de passe et ses SMS partent ; ses
     sessions se ferment et oublient leur adresse internet ; ses appareils perdent leur nom ; ses invitations, celles de
     la console et les reprises d'entreprise ne la nomment plus ; le nom qu'elle a donné en écrivant (le « demandeur »)
     part de chacune de ses demandes ;
   - **ce qui reste** : son identifiant, pour que ce qu'elle a fait (une facture émise, une trace) reste juste — il se lit
     « Personne effacée » ; la demande, avec son numéro, ses dates, sa décision et **sa preuve** : ce qui a été fait,
     compté (« l'identité, 3 sessions, 2 appareils… »), jamais ce qui a été effacé.
   Une personne encore membre d'une entreprise, ou de l'équipe SkanFact, ne s'efface pas : on la retire d'abord.
4. **Les données d'une entreprise**, une demande accordée : elle reste ouverte (« sur la machine ») jusqu'à ce que
   l'outil de l'exploitation l'efface et le note. Cet outil n'est pas encore écrit (C54 : pas avant la première
   échéance) ; d'ici là, rien ne s'efface et l'écran le dit.

Un test balaie **chaque colonne de texte de la base** après un effacement : ni le nom ni l'adresse de la personne n'y
restent (`tests/console/effacement.test.ts`).

## La trace ne recopie plus une adresse

La trace des entreprises (`socle.audit`) ne se modifie jamais (01 R10). Une adresse e-mail qu'on y écrirait ne pourrait
plus s'effacer : depuis 1.55.0, la trace **désigne sans recopier** (`socle.tracer` retire la clé `email` de ce qu'elle
reçoit). Une invitation se trace par son identifiant (l'invitation garde l'adresse, et l'effacement la remplace), un
changement d'adresse par le compte qui l'a fait. Les traces écrites avant cette version gardent la leur : aucune donnée
réelle n'existait alors. Le journal de la console garde l'adresse d'un membre invité dans l'équipe SkanFact (qui a eu
accès à la console) : une exception écrite, **À VÉRIFIER**.

## Les copies de secours

Une copie de secours est la base entière, chiffrée, hors de la machine ; elle ne se retouche pas. Ce qui est effacé de
la base l'est des copies **à leur rotation** (trente jours). Une base restaurée depuis une copie d'avant un effacement
fait revenir la personne : la procédure de restauration (06 § 5) devra relire, avant de rouvrir, les effacements faits
depuis la copie et les refaire (**à écrire**).
