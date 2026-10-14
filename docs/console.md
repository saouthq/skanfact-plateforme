# La console de l'équipe SkanFact

*13/10/2026, Console 1 (le lot « les fonctions qui manquent », deuxième partie). Le cadrage fait foi :
`docs/cadrage/10-console.md` (§ 1, § 2.1 à 2.4, § 2.8 pour une part, § 2.10, ses règles C1 à C3 et la
liste fermée du § 4), avec `03` § 5 (les rôles) et `06` § 3 (la connexion). Les écrans suivent les maquettes validées par
Skander. Ce document dit ce qui en est fait ; les décisions marquées « par délégation » sont prises le 13/10/2026.*

Avant ce lot, **personne ne voyait les clients sans se connecter au serveur** : les gestes de SkanFact sur un abonnement
passaient par un script en root (`exploitation/abonnement.sh`, `docs/abonnement.md`, A6), et rien ne disait le matin ce
qui demandait une décision.

Le code : la base `base/migrations/0083_console.sql` (l'équipe, les défis et les sessions de la console, le journal de ses
gestes, les fonctions qui lisent les clients et font les gestes), l'outil du premier membre `base/equipe.ts` et
`exploitation/equipe.sh` ; le serveur `serveur/console/` (`gestes.ts` les gestes et leurs rôles, `connexion.ts` l'entrée,
`decider.ts` « À décider », le tableau du matin et la liste, pur, `routes.ts`, `textes.ts`), la règle de chaque geste
sur un abonnement `serveur/abonnement/gestes.ts` (l'outil de l'exploitation et la console la jouent tous les deux), la
session de la console à la porte (`serveur/app.ts`) ; les écrans `web/console/` (React, construits à part dans
`dist/web/console`, servis sous `/console/`). Les tests : `tests/console/decider.test.ts` (pur),
`tests/console/console.test.ts` (contre la base), `tests/web/console.test.ts` (à la souris : l'entrée, l'accueil, un
geste, le support, la technique, puis chaque écran en clair et en sombre, à l'ordinateur et au téléphone, et en langue
factice) ; soixante-neuf preuves. La deuxième partie (les échéances et les cabinets, plus bas) en ajoute trente-trois.

## Ce que fait le lot

**C1. Qui entre, et comment** (10 § 1, 06 § 3).
- **Seule l'équipe SkanFact** : une personne avec son compte SkanFact (celui de l'application) et un rôle dans
  `plateforme.equipe` (la direction, le support, la technique). Le premier membre se pose par l'outil, sur le serveur
  (« Mettre en route », plus bas) ; ensuite, la direction gère l'équipe depuis la console.
- **L'entrée en deux temps** : l'adresse et le mot de passe (la même attente qui s'allonge après cinq erreurs que
  l'application, et comptée avec elle : c'est le même mot de passe), puis le code du téléphone (SMS ou application) **à
  chaque connexion, même sur un appareil reconnu** ; un code de secours le remplace, une fois. Sans code du téléphone en
  place, la console le dit et renvoie à « Ton compte », sans marquer le mot de passe faux (il était bon).
- **À qui n'est pas de l'équipe, la réponse d'un mot de passe faux**, champ compris : la console ne dit pas qui en fait
  partie.
- **Une session à elle** : son jeton n'ouvre rien dans l'application, celui de l'application n'ouvre pas la console. Une
  heure sans geste, douze heures au plus ; « Se déconnecter » la ferme ; retirer un membre ferme ses sessions aussitôt.
- **La base garde, et le serveur aussi.** Chaque fonction de la console vérifie qu'elle tourne dans une session de la
  console, ouverte, à un membre encore actif, avec le rôle voulu (`exiger_role_console`) : une transaction de
  l'application n'y ouvre rien, même au nom d'un membre de l'équipe. Le serveur refuse de son côté une route hors du rôle
  (`GESTES_CONSOLE`, une troisième famille de gestes, qui vivent sous `/console/` et nulle part ailleurs). Les preuves
  qui veulent ouvrir une porte retirent les deux étages : un seul ne fait rien tomber, et c'est voulu.

**C2. Qui voit quoi** (03 § 5).

| Rôle | Écrans | Gestes |
|---|---|---|
| Direction | tous | tous les gestes sur un abonnement, l'équipe |
| Support | « À décider » (les clients), Clients et leur fiche, les cabinets et leur fiche, les abonnements | prolonger un essai, de 7 à 30 jours, une fois par entreprise |
| Technique | « À décider » (le service), Service | aucun ; **aucune donnée de client**, ni la liste, ni une fiche, ni leurs chiffres |

Un écran hors du rôle dit « Cet écran n'est pas dans ton rôle », et le menu ne le propose pas.

**C3. L'accueil : le tableau du matin et « À décider »** (10 § 2.1, 2.2).
- **Le tableau** : les inscriptions des sept derniers jours (aujourd'hui compris), les essais en cours, les abonnements
  actifs par offre, les entreprises en retard, en lecture seule ; les revenus du mois disent « non mesuré »
  avec leur raison (les paiements viennent en 14b) ; le support compte ses demandes ouvertes et celles qui attendent
  notre réponse depuis plus de vingt-quatre heures (C29) ; le service dit « non mesuré » sans veille ou
  quand elle se tait, sinon ses problèmes. **Rien n'est vert sans mesure** (C2). **Chaque chiffre ouvre la liste qu'il
  compte, calculée par la même fonction** (C3) : « Inscriptions » ouvre les clients avec le filtre « inscrites ces 7
  derniers jours », qui se voit et se retire.
- **« À décider »**, le plus urgent en haut : un problème grave du service, la veille qui se tait depuis plus de cinq
  minutes, une entreprise en grâce (celle dont la lecture seule approche d'abord), une lecture seule de cette semaine
  (pas une suspension : c'est une décision de SkanFact), un essai qui finit dans trois jours sans une pièce créée ; puis
  les petits problèmes du service. Chaque ligne ouvre la fiche du client ou le Service ; les filtres gardent les clients
  ou le service. **Une console où rien ne se passe affiche une liste vide**, et le dit : elle n'invente pas de travail.
  La pastille de « À décider », dans le menu, se recompte après un geste.

**C4. Les clients** (10 § 2.3).
- **La liste** : le plus urgent en haut (la grâce qui finit, la lecture seule de la semaine, l'essai ou l'abonnement qui
  finit bientôt, puis le reste), filtrée par état avec le compte de chaque état (la même fonction que le filtre), cherchée
  sans accents ni casse (le nom, le matricule, l'organisation, le propriétaire et son adresse, le cabinet), paginée. Les
  entreprises d'exemple (celle que chaque personne ouvre pour découvrir) n'y sont pas, et n'ont pas de fiche.
- **La fiche dit la liste fermée du § 4**, et rien d'autre : qui elle est (raison sociale, matricule, forme, devise,
  création, organisation, cabinet qui la tient), son abonnement (les faits, l'état déduit, son histoire avec le motif et
  l'auteur de chaque geste de SkanFact), ses membres (nom, adresse, rôles, depuis quand, dernière connexion), des comptes
  qui ne révèlent rien (établissements, caisses, salariés, pièces créées, pièces émises par mois sur douze mois).
  **Jamais le contenu d'un dossier** : un test fixe la liste de ses clés, et un champ de plus le fait tomber.

**C5. Les gestes sur un abonnement** (10 § 2.4, C1). Prolonger l'essai, payer (l'offre et la périodicité), résilier,
annuler la résiliation, suspendre, reprendre, offrir, retirer l'offert : la règle de chacun est celle de l'outil de
l'exploitation (`serveur/abonnement/gestes.ts`), en un seul endroit. Le menu ne propose que les gestes que le rôle peut
faire aujourd'hui, et dit pourquoi quand il n'y en a pas. **L'état d'après se montre avant le geste**, calculé par le
serveur ; **un motif est exigé** (trois caractères au moins) et reste dans l'histoire ; **un abonnement changé depuis
qu'on l'a ouvert ne s'écrase pas** (« relis-le ») ; le geste laisse son événement et sa ligne au journal, liés.
Le support prolonge un essai de 7 à 30 jours, une fois par entreprise ; hors des bornes, l'aperçu le dit à sa place et
le geste s'éteint.

**C6. Le journal** (C1) : chaque geste de la console et de l'outil de l'exploitation, qui (et avec quel rôle), quand,
quoi, sur qui, pourquoi, et ce qu'il a changé ; filtré par personne et par entreprise ; le plus récent en haut, regroupé
par jour ; la suite se demande à partir du dernier lu (une ligne neuve ne décale rien). **Rien ne s'y modifie ni ne s'y
efface** : la base le refuse. La direction seule.

**C7. L'équipe** (10 § 2.10) : la direction ajoute une personne qui a déjà son compte SkanFact, change son rôle, la
retire, chaque fois avec un motif. **Jamais sur soi-même ; l'équipe garde toujours quelqu'un à la direction** (la base le
tient). Un membre sans code du téléphone est signalé : la console le lui demandera. Un membre retiré ne s'efface pas :
son nom reste sur ses gestes.

**C8. Le service** (10 § 2.8, première partie) : ce que la veille du serveur (`exploitation/veiller.ts`) écrit chaque
minute dans `/var/lib/skanfact/veille.json` (`SKANFACT_VEILLE_FICHIER`) : ses problèmes, les graves d'abord, avec ce
qu'il faut faire. Sans veille (un poste de développement) : « non mesuré » ; une veille qui n'a rien écrit depuis plus de
cinq minutes se dit silencieuse.

**C9. Les écrans** suivent la DA des maquettes : le haut vert presque noir et quadrillé, Bricolage Grotesque pour les
titres, Instrument Sans pour le texte, IBM Plex Mono pour les codes et les dates, des cartes arrondies ; en clair et en
sombre (le choix se garde sur l'ordinateur), à l'ordinateur et au téléphone (des cibles de 44 px). Les textes viennent
du catalogue (`web/console/src/textes.ts`, `serveur/console/textes.ts`), et **la typographie française se pose à
l'affichage** (`web/console/src/langue.ts`) : une espace fine insécable devant « : ; ? ! » et dans les guillemets, et un
nombre reste avec son deux-points ; sans elle, « : » commençait une ligne. **Une fenêtre ne se ferme pas d'un clic à
côté** (Échap ou « Annuler ») : un motif tapé ne se perd pas. **Le service des écrans de l'application ne garde jamais la
console** : un outil en ligne, rien n'en reste sur un poste.

## Deuxième partie : les échéances et les cabinets (Console 2, 13/10/2026)

Le code : la base `base/migrations/0084_console_cabinets.sql` (`console_cabinets`, `console_echeances`, la direction et
le support seulement) ; le serveur `serveur/console/echeances.ts` et `serveur/console/cabinets.ts` (purs), leurs routes
dans `serveur/console/routes.ts` ; les écrans `web/console/src/ecrans/Abonnements.tsx`, `Cabinets.tsx` et
`Cabinet.tsx`. Les tests : `tests/console/echeances.test.ts` (pur), les deux nouveaux cas de
`tests/console/console.test.ts` (contre la base) et de `tests/web/console.test.ts` (à la souris).

**C10. Les abonnements** (10 § 2.4).
- **Un chiffre de l'année en tête** : ce qui revient chaque année, au prix du jour, hors taxes — les abonnements actifs
  qui se renouvellent, un mensuel compté douze fois, sans les résiliés ; une offre sans prix du jour se compte à part,
  jamais pour zéro.
- **Six cartes, et chacune ouvre la liste qu'elle compte** (C3, par la même fonction `vue`) : « À venir » (la fin d'un
  essai ou d'une période payée dans les trente jours, aujourd'hui compris), puis une par état. Les cinq états refont le
  portefeuille. La vue vit dans l'adresse (`#/abonnements?vue=essai`).
- **Une ligne par échéance** : le jour et dans combien de temps, ce qui se passe (la prolongation d'un essai avec son
  motif et son auteur, un « offert », une suspension), le montant d'un paiement hors taxes au prix du jour — jamais
  pour un essai, une résiliation ou une suspension, et « — » avec sa raison — et les relances.
- **Une relance dit ce que le serveur fera** : partie, prévue, part dans l'heure, sautée (une plus pressante part à sa
  place), manquée (l'échéance est passée sans elle, ou l'entreprise est désactivée). Seules comptent celles de
  l'échéance d'AUJOURD'HUI : après une prolongation ou un paiement, les anciennes ne disent plus rien. La règle est
  prouvée jour après jour contre celle des envois (`relanceDue`) : celle que l'écran dit « dans l'heure » est celle qui
  part. Chaque état porte un signe en plus de sa couleur.
- **Les règles se disent en pied**, lues au serveur (les jours des relances, la grâce) : écrites une seconde fois dans
  les textes, elles divergeraient au premier réglage.

**C11. Les cabinets** (10 § 2.3).
- **Sous « Clients », deux onglets** : les entreprises et les cabinets, sous un même en-tête (une phrase propre à chaque
  onglet changeait sa hauteur, et les onglets descendaient sous le curseur au moment du clic).
- **La liste** : chaque cabinet, ses associés, ses clients abonnés (un mandat actif), ses dossiers tenus, ceux qui
  attendent son accord (un mandat proposé), son équipe, sa dernière connexion ; cherchée par son nom ou par un associé
  (nom ou adresse), sans accents ni casse ; paginée.
- **La fiche** : qui il est, **ce qu'il paie aujourd'hui (rien** : ses clients paient leur abonnement, et le prix des
  dossiers tenus n'est pas encore en place), trois cartes qui comptent ses dossiers par place et filtrent la liste, ses
  dossiers (dits comme dans la liste des clients : leur nom et leur abonnement, jamais leurs livres), qui y travaille
  (rôle, depuis quand, dernière connexion). La liste et la fiche comptent les mêmes dossiers, par la même règle
  (`placeDe`) ; un dossier que la liste des clients ne connaît pas (une entreprise d'exemple) ne compte nulle part.
- **La fiche d'une entreprise nomme son cabinet** (celui qui la tient, ou à qui elle a donné ou proposé son mandat), et
  y mène ; « tenue par » aussi. Une adresse qui ne mène à aucun cabinet, ou à aucune entreprise, le dit et mène à la
  liste (« Réessayer » n'y changerait rien).

**Écarts aux maquettes, voulus.** Les cartes « Essai » et « Actif » ouvraient « À venir » : chacune ouvre ici sa propre
liste (C3). Les cabinets étaient une sorte d'organisation dans la liste des clients : ils ont leur onglet, parce qu'une
ligne de cabinet ne dit pas la même chose qu'une ligne d'entreprise (des dossiers, une équipe). La fiche d'un cabinet ne
montre ni son prix, ni son parrainage, ni ses demandes de support, ni son journal : rien de tout cela n'existe encore.

## Troisième partie : le service (Console 3, 13/10/2026)

Le code : les mesures du serveur `serveur/service/mesures.ts` (pur) et `serveur/service/collecte.ts` (la collecte,
branchée dans `serveur/app.ts` et `serveur/principal.ts`) ; la base `base/migrations/0085_service.sql` (`service_minute`,
`service_heure`, `service_route`, `service_releve`, `service_alerte`, `service_nuit`, écrites par `noter_requetes` et
`noter_veille`, lues par `console_service_serie` et `console_service_veille`) ; la veille qui y confie ce qu'elle
relève (`exploitation/veille.ts`, `pourLaConsole` ; `exploitation/veiller.ts`) ; la lecture de la console
`serveur/console/service.ts` (pure) et sa route `GET /console/service` ; l'écran `web/console/src/ecrans/Service.tsx`
et ses graphiques `web/console/src/graphes.tsx`. Les tests : `tests/service/mesures.test.ts` et `collecte.test.ts`
(purs), `tests/console/service.test.ts` (pur), les nouveaux cas de `tests/console/console.test.ts` (contre la base) et
`tests/web/console-service.test.ts` (à la souris, sur des mesures envoyées par une vraie collecte).

**C12. Le service** (10 § 2.8 ; 06 § 4 et § 7 ; VISION-ARCHITECTURE.md § 6 pour les budgets).
- **Le serveur se mesure lui-même, à chaque réponse** : combien de requêtes, combien de pannes (un 5xx ; un refus écrit
  n'en est pas une), et la durée de chacune, rangée dans un des 47 seaux (`SEAUX_MS`, un pas de 25 % au plus). Chaque
  budget écrit (200 ms, 300 ms, 1 s) est une borne de seau : « 95 % sous le budget » se lit exactement, et une durée se
  dit par la borne de son seau, jamais par un chiffre qu'on n'a pas mesuré. Deux histogrammes s'additionnent, jamais deux
  moyennes. **Jamais une donnée de client** : une route se dit par son MODÈLE de chemin
  (`GET /entreprises/:entreprise/ventes/factures`), et la base refuse un chemin qui porte un nombre ou un identifiant.
  Ces mesures sont à la plateforme : les six tables du service ne partent jamais avec l'export d'une entreprise
  (`CLASSEMENT`, « hors », chacune avec sa raison).
- **Une sorte par route, et son budget** : lecture (300 ms), caisse (200 ms), comptes (1 s), dossier, écriture et
  console (aucun budget écrit : on n'en invente pas un pour colorer un chiffre). Les routes dont la sorte n'est pas celle
  de leur méthode sont écrites une fois (`SORTE_PAR_ROUTE`), et un test exige que chacune existe.
- **Rien ne se perd entre deux envois, rien ne se compte deux fois** : chaque minute, ce qui s'est ajouté part dans la
  base, qui l'ADDITIONNE ; une base qui ne répond pas, on garde et on renvoie (deux heures de minutes au plus) ; le
  dernier envoi part à l'arrêt. Une minute perdue se dit « non mesurée », jamais zéro.
- **La veille confie à la base ce qu'elle relève** (chaque minute) : le service répond-il, la charge, la mémoire, les
  disques, les alertes CONFIRMÉES (un service qui revient avant la seconde minute n'est pas une alerte, ni à la page
  d'état, ni dans l'histoire, ni à l'accueil de la console), et les nuits (la sauvegarde, la copie hors de la machine,
  la copie de base, l'exercice de restauration). Une base qui ne répond pas n'arrête rien : la veille d'abord.
- **Rien n'est vert sans mesure** (C2) : sans veille, « non mesuré » avec sa raison ; une veille muette depuis cinq
  minutes, « la veille ne répond plus » ; une période sans lecture n'a pas de temps de réponse, et le dit.
- **La disponibilité ne compte que les minutes relevées**, et dit sur combien elle porte ; un jour sans relevé est
  « non mesuré », jamais « bon ». Elle est vue du serveur lui-même, et l'écran le dit : vu de l'extérieur, non mesuré.
- **Un centile se lit sur au moins vingt lectures** (`LECTURES_POUR_UN_CENTILE`) : sous ce compte, le pas est une bande
  hachurée « trop peu », jamais un pic. Un pas mesuré seul entre deux pas sans mesure est un **point**, sinon il
  disparaîtrait.
- **Le trafic d'en ce moment glisse sur les minutes FINIES de la dernière heure** (`traficRecent`) : l'heure de
  l'horloge disait 0,0 requête par minute à 9 h 01.
- **Une mise en ligne se repère sur les graphiques, dans l'ordre du temps**, et un **retour** à une version déjà vue se
  dit « retour à », jamais « mise en ligne ».
- **Ce qui vient de se passer** : les alertes ouvertes et réglées, chaque mise en ligne, et chaque nuit en UNE ligne
  (ses étapes dans l'ordre du temps, datée de la dernière). Une sauvegarde en échec n'a rien envoyé hors de la machine :
  sa copie est « sans objet », jamais « arrivée ». Quatre filtres, et chacun compte ce qu'il montre.
- **Les repères d'un axe se mesurent dans la page** (`eclaircir`) : un sur k, depuis le plus récent, jamais deux à
  moins de huit points ; ils restent réguliers, à l'ordinateur comme au téléphone.
- **Une pastille d'état reste sur la ligne de son titre** : c'est le titre qui se replie, jusqu'à la plus étroite des
  deux colonnes (1101 points), où le test la mesure.
- **L'écran ne refait aucun calcul du serveur** : centiles, parts, état des jours et des briques arrivent faits ; il les
  écrit, les range en graphiques, et les rend lisibles à la souris ET au clavier (chaque graphique se prend au clavier,
  et les chiffres de la période se lisent aussi en tableau). Il se relit chaque minute tant que quelqu'un le regarde,
  jamais pour une page oubliée.
- **Ce que la veille écrit (un titre, ce qu'il faut faire, un disque, une version) est une donnée** : ses mots s'affichent
  tels quels, avec la typographie de l'écran.

**Les alertes** (Console 3c, 13/10/2026). Le code : la base `base/migrations/0086_service_alertes.sql` (`service_envoi`,
`service_sourdine`, `service_demande` ; la règle, les étapes et la prise en charge d'une alerte ; qui est prévenu et ce
que les règles des requêtes ont lu, au relevé ; `noter_veille` à quatre arguments, `veille_lire`, et pour la console
`console_service_alertes`, `console_prendre_alerte`, `console_sourdine`, `console_lever_sourdine`,
`console_demander_essai`) ; la veille (`exploitation/veille.ts` : `decider` avec les sourdines et l'aggravation,
`requetes`, `REGLES`, `regleDe`, `masquerCourriel`, `masquerTelephone`, `envoisDe`, `garderANoter`, des étapes au lieu
d'une phrase ; `exploitation/veiller.ts` : ce qu'elle lit de la base, ce qui attend dans `veille.json`) ; la lecture de
la console `serveur/console/alertes.ts` (pure) et ses routes (`GET /console/service/alertes`,
`POST /console/service/alertes/:alerte/prendre`, `POST /console/service/sourdines`,
`POST /console/service/sourdines/:sourdine/lever`, `POST /console/service/essai`) ; l'écran
`web/console/src/ecrans/Alertes.tsx`. Les tests : `tests/exploitation/veille.test.ts` et `tests/console/alertes.test.ts`
(purs), `tests/exploitation/veiller.test.ts` (le veilleur lancé pour de vrai, avec la base), les cas « les alertes du
service (0086) » de `tests/console/console.test.ts` (contre la base) et `tests/web/console-alertes.test.ts` (à la souris).

**C13. Les alertes du service** (10 § 2.8 ; 06 § 7).
- **L'alerte en cours dit ce qu'il faut faire, étape par étape**, et ce qu'on tape (une commande, un chemin) se copie
  d'un geste ; l'e-mail lit les mêmes étapes, à la suite. La procédure écrite (`docs/mise-en-ligne.md`, I) est toujours
  la dernière. L'enjeu (ce qu'on risque) se dit une fois, sous le titre : jamais redit dans une étape.
- **Un problème qui DEVIENT grave se redit aussitôt, par SMS aussi** (la copie hors de la machine passe l'heure de
  retard, le disque les 90 %) : sans cela il attendait le rappel des six heures, et l'exploitant croyait encore à une
  simple alerte. Le rappel suivant part de l'aggravation. Un message qui n'est parti par aucun moyen se redit grave à la
  minute suivante ; une `veille.json` d'avant (sans `diteGrave`) vaut ce qu'elle était. La chronologie le dit :
  « devenue grave ».
- **Qui s'en occupe** : la direction et la technique prennent une alerte en charge, avec un motif ; leur nom s'affiche et
  le geste va au journal (`service.prendre`). Rien ne change sur le serveur : les rappels continuent. Une alerte réglée
  ne se prend plus ; une alerte prise par quelqu'un d'autre se reprend (la fenêtre et le journal disent qui l'avait).
  **Une alerte ne se marque jamais « réglée » à la main** : elle se lève quand la veille ne voit plus le problème.
- **La sourdine se pose sur une RÈGLE, jamais sur une alerte** (« les disques » tait chaque disque) : d'un quart d'heure
  à un jour, **quatre heures au plus quand la règle a une alerte grave** (la veille borne aussi une alerte qui le devient
  pendant la sourdine), une à la fois. La règle regarde toujours : ce qu'elle voit reste dans la console et sur la page
  d'état. Un problème qui se règle pendant la sourdine se dit s'il avait été dit (c'est une bonne nouvelle, et elle ferme
  ce qu'on avait annoncé) ; à la fin, ce qui n'a jamais été dit se dit, et les rappels reprennent. Seules les règles
  branchées se mettent en sourdine. **La fin dite est celle que le serveur a posée** (la fenêtre l'estimait à son
  ouverture : une minute d'écart avec la chronologie). Levée avant sa fin, la veille prévient dès la minute suivante.
  Journal : `service.sourdine`, `service.sourdine_levee`. **Au journal, un geste du service dit sur quoi il porte** (la
  règle visée, l'alerte d'essai) et jusqu'à quand une sourdine devait courir — celle d'une sourdine levée est sa fin
  PRÉVUE, gardée dans l'« avant » du geste (l'« après » porte la minute de la levée).
- **La console ne touche jamais au serveur** : l'alerte d'essai est une DEMANDE que la veille lit la minute suivante,
  envoie par chaque moyen réglé, et dont elle dit ce qui est parti ; une seule attend à la fois (`service.essai`).
- **Ce qui est parti, message par message, et par quel moyen** : « remis » au relais d'e-mails ou à WinSMS, jamais
  « reçu » (la veille n'en sait pas plus). Des échecs de suite (un relais en panne : la veille réessaie chaque minute)
  se disent en une ligne, avec leur nombre. Ce que la base n'a pas pris attend dans `veille.json` (deux cents au plus) ;
  **une panne de la base elle-même s'écrit à son retour**, finie, depuis son début : sans cela, la panne la plus grave
  n'existait pas dans l'histoire. Le prochain rappel se compte depuis le dernier message REMIS.
- **Qui est prévenu, MASQUÉ** (« v•••@•••.tn », « +216 •• ••• 456 ») : jamais une adresse ni un numéro entiers dans la
  base, ni dans ce que la veille lui confie. Les destinataires se règlent sur le serveur (`exploitation/alertes.sh`),
  jamais dans la console ; une adresse sans le relais d'e-mails, un numéro sans WinSMS, le disent : « rien ne part ».
- **Deux règles lues dans la base, sur les mesures de la console** : les pannes (plus de 1 % chacune des cinq minutes,
  grave à une sur dix) et le temps de réponse (moins de 95 % sous 300 ms chacune des dix minutes, avec vingt lectures au
  moins ; jamais grave : lent n'est pas en panne). La minute en cours et celle d'avant ne se jugent pas (à moitié
  rangées). Une minute sans requête ne juge rien (« trop peu », la nuit) ; une base pas lue ne règle rien de ce qui
  était ouvert, et n'ouvre rien.
- **Les règles de la veille, toutes** : quatorze branchées, six que 06 § 7 prévoit et que rien ne mesure encore
  (« pas branchée » : la console le dit plutôt que d'afficher du vert). Chaque clé que la veille peut poser a sa règle
  (un test les essaie toutes) ; ses seuils viennent des constantes du programme. **Rien n'est « calme » sans relevé
  récent** (cinq minutes) : « non lu ».
- **L'histoire des trente derniers jours** : chacune, sa gravité (celle qu'elle a eue), sa durée (« jusqu'à maintenant »
  pour une ouverte), et comment elle s'est réglée — seule, après une prise en charge, ou pas encore. Elle se filtre par
  règle depuis la ligne de la règle (« voir ses alertes passées »), sans redire le nom de la règle sous chaque alerte.
- **L'écran** : un seul bouton principal (« Prendre en charge » de l'alerte la plus urgente que personne n'a prise ; il
  passe à la suivante) ; un refus s'efface dès qu'on corrige (de même sur la fiche d'un client et dans l'équipe) ; un
  menu de ligne s'ouvre vers le haut quand la place manque dessous, sans faire défiler la page ; **un filtre qui raccourcit une liste au bas de la
  page ne fait pas glisser ses pilules** (la carte garde sa hauteur tant qu'on reste sur le même sujet) ; au téléphone,
  les faits tiennent en une boîte et une commande défile au lieu de se casser au milieu d'un chemin.
- Les trois tables sont à la plateforme : elles ne partent jamais avec l'export d'une entreprise (`CLASSEMENT`, « hors »).

**C14. Les sauvegardes du service** (10 § 2.8 ; 06 § 4). `#/service/sauvegardes`, la direction et la technique.
- **Quatre chiffres** : la sauvegarde de la nuit (faite et relue, ses lignes comptées), l'archivage à la minute, la copie
  hors de la machine (son retard, ce qu'on perdrait si le site brûlait) et le dernier exercice de restauration.
- **Ce qu'on promet de pouvoir reprendre** (06 § 4.1, écrit d'avance) : pour chaque malheur, la perte et le retour promis,
  la mesure du jour et ce qui la prouve. **Une promesse ne se dit tenue qu'avec une mesure ET une preuve faite sur ce
  serveur** (la base : l'archivage en marche et un exercice réussi sous l'heure ; une entreprise : une remise faite) ;
  sans preuve, « à prouver ». Le site perdu n'est jamais tenu tant qu'il n'existe pas de site de secours ; le verrou de la
  copie chez le fournisseur est « invérifiable d'ici ».
- **Où sont les copies** (3-2-1-1), **nuit par nuit** (sauvegarde, lignes recomptées, copie de base, arrivée hors de la
  machine à la minute où la veille l'a vue, exercice), **l'archivage** (le plus ancien point où revenir, le retard de la
  copie heure par heure sur 24 heures contre son seuil), **les exercices** (durée, lignes, migrations, le prochain).
- **La console ne touche jamais au serveur** : relancer un exercice, pousser la copie, remettre une entreprise sont des
  commandes à copier dans la console du serveur. « Préparer une remise… » (la direction seule, parce qu'elle nomme le
  client) vérifie le client, la minute (à l'heure de Tunis, couverte par les copies gardées, jamais future) et le motif
  (entre apostrophes : rien ne s'y interprète), compose l'essai puis la remise, et entre au journal
  (`service.remise`). La remise, faite sur le serveur, écrit sa minute dans la piste d'audit de l'entreprise
  (`base/entreprise.ts remettre --minute`) ; l'écran dit qui l'avait préparée.
- La veille range l'état des copies à chaque relevé (`service_releve.copies`, 0087) et garde la minute d'arrivée d'une
  copie hors de la machine ; elle ne confie que des nombres (lignes, migrations, secondes), jamais un message ni un chemin.

**C15. Les performances du service** (10 § 2.8 ; VISION-ARCHITECTURE.md § 6). `#/service/performances`, la direction et
la technique. Rien de neuf n'est relevé : la console lit ce que le serveur et la base savent déjà (0088).
- **La période en chiffres** (1 h, 24 h, 7 j, 30 j) : le 95e centile et la médiane des lectures, les requêtes par minute
  (la dernière heure), les pannes, et les requêtes lentes (plus d'une seconde) des sept derniers jours.
- **Les budgets de temps** écrits par la vision, en face du 95e centile mesuré : la part du budget (moins de 80 % bon,
  jusqu'au budget « près du budget », au-delà dépassé) et la courbe de la période. **Rien n'est vert sans une mesure** :
  trop peu de requêtes pour un centile (moins de vingt), un budget qui se mesure sur le poste du client (ouvrir
  l'application, saisir une ligne) ou qu'aucune sorte ne sépare encore (la balance consolidée d'un cabinet, le
  rattrapage d'une journée de coupure) se disent « non mesuré », avec leur raison.
- **Le temps de réponse sorte par sorte** (listes et fiches, caisse, comptes), chacune sur son échelle avec son budget ;
  **le trafic et les pannes** contre la période d'avant (la même durée, juste avant). Sur trente jours, la période d'avant
  n'est plus gardée (les heures se gardent trente-cinq jours) : l'écran le dit, sans courbe à zéro. Les totaux de la
  période d'avant ne comptent que ses pas, et son dernier pas se compte entier (`periodeDAvant`).
- **Les routes du serveur sur sept jours** : par modèle de chemin (jamais une valeur, jamais un client), leurs appels,
  médiane, 95e et 99e centiles, pannes et lentes ; triables, cherchables, filtrées par sorte. **Les requêtes lentes** se
  comptent route par route ; **leur trace (où est passé le temps) n'est pas gardée**, l'écran le dit.
- **La base PostgreSQL** (`pg_stat_database`, depuis sa dernière remise à zéro) : connexions, lu en mémoire, taille,
  blocages mutuels, fichiers temporaires, transactions annulées — des nombres. Ce qui occupe la base requête par requête
  n'est pas mesuré (`pg_stat_statements` n'est pas installé) ; la réplique non plus (il n'y en a pas).
- **Les exemplaires du programme** qui ont envoyé leurs mesures dans l'heure : vu dans les cinq dernières minutes, il
  sert ; plus loin, il s'est tu (arrêté, ou plus rien ne lui arrive : la console ne sait pas les distinguer). Leur
  processeur et leur mémoire ne sont pas mesurés à part.
- **Vu de l'extérieur : non mesuré**, et la décision qui manque (le service et les deux villes) est écrite à l'écran.

**C16. L'en-tête commun du service, et la coquille** (recalés sur les maquettes, 13/10/2026). Chaque vue du service
porte le même en-tête : le fil (Console › La plateforme › Service, ou Console › Service › la vue), et en face l'écran
**en direct** — « relu il y a 12 s », compté depuis l'arrivée de la lecture sur ce poste, et **Pause** (l'écran cesse
de se relire de lui-même ; « Reprendre » le relit tout de suite ; la pause vaut pour toutes les vues, le temps de la
page). Puis le titre et l'état des briques sur une ligne, et en face **la période** quand la vue en a une (la vue
d'ensemble, les performances) ; les onglets dans l'ordre de la maquette (jamais un onglet vers un écran pas écrit) ; et,
sur les vues autres que les alertes, **l'alerte ouverte la plus urgente en une ligne** (une grave avant une autre, puis
la plus ancienne ; `alertesOuvertes`, la même fonction que le compte de l'onglet), qui mène à la page des alertes — en
grand sur la vue d'ensemble, où son geste est le seul bouton principal. « En ce moment » ne redit plus une alerte : il
ne montre que la veille absente ou muette, et ce qu'elle voit sans l'avoir encore confirmé (une clé qu'aucune alerte
ouverte ne porte).
- **La recherche d'un client** ne vit plus qu'en tête de l'accueil, comme la maquette (chaque liste a la sienne) ;
  **Ctrl K** (⌘ K sur un Mac) y mène de partout : sur l'accueil, dans ce champ ; ailleurs, dans celui de Clients.

**C17. Clients, recalé sur sa maquette** (13/10/2026). Au-dessus de la liste, **six vues du métier** (cinq, puis six en 1.16.0), chacune sa carte,
son compte et sa phrase (`serveur/console/clients.ts`, `dansLaVue` — la même fonction compte la carte et filtre la liste
qu'elle ouvre, C3) :
- **tout le portefeuille** ;
- **à appeler** : un essai qui finit dans la semaine sans une pièce émise, ou une grâce d'après l'essai sans offre
  choisie — quelqu'un qui n'a pas vu ce que l'application lui apporte : un appel, pas une relance ;
- **l'argent attendu** : une offre choisie, l'échéance passée, rien de payé (jamais la lecture seule : elle a sa puce) ;
- **les silencieux** : en essai ou abonnés, jamais ouverts ou pas depuis dix jours — comptés en **jours de Tunis** ;
- **tenus à convertir** : les dossiers qu'un cabinet tient pour son client, sans abonnement ;
- **venus par un cabinet** (1.16.0 ; `0107`) : un mandat accepté qui commence avant leur premier paiement, la règle de
  la remise du cabinet (`0106`) ; la ligne dit par quel cabinet et la date du mandat. Un dossier que le cabinet tient
  sans abonnement n'en est pas (il est « à convertir »).

Une carte est un raccourci : elle ouvre toute sa liste (la puce d'état choisie avant s'efface), et les puces d'état
comptent ensuite cette vue-là. La vue et l'ordre vivent dans l'adresse (`#/clients?vue=a_appeler&tri=echeance`).
- **Deux colonnes de plus.** **Échéance** : le prochain jour où quelque chose change (la fin de l'essai, la fin de la
  période payée, le passage en lecture seule d'une grâce) et dans combien de jours ; ce qu'il change seulement quand la
  puce ne le dit pas (« lecture seule dans 5 jours », « résilié, fin dans 12 jours »). Une entreprise déjà en lecture
  seule n'en a plus : la colonne État dit depuis quand, et **la date ne s'écrit qu'une fois** (la colonne État ne redit
  plus l'échéance ; la raison d'un « hors abonnement » est dans la colonne Abonnement). **Par an, HT** : ce qu'un
  abonnement rapporte au prix du jour (un mensuel compte douze mois) ; une offre choisie pas encore payée se lit en gris,
  « quand ce sera payé » ; sans offre ou sans prix du jour, « — », jamais un montant deviné. Depuis 1.16.0, la remise de
  sa prochaine période (`0106`) s'y déduit de chaque période et se dit dessous (« remise du cabinet déduite (−20 %) ») :
  le même chiffre que « Ce qui revient chaque année » de l'écran Abonnements.
- **La ligne de compte** au-dessus du tableau : combien d'entreprises la liste montre, et ce que rapportent par an les
  abonnements actifs de la sélection (ce qui est attendu n'y entre pas : il n'est pas encore payé). Le pied ne garde
  que de quoi tourner les pages.
- **Le tri** : le plus urgent d'abord (par défaut), l'échéance la plus proche, ce qui rapporte le plus, le nom, le plus
  récemment ouvert. À égalité, l'urgence départage ; ce qui n'a pas de valeur (pas d'échéance, rien par an, jamais
  ouvert) reste en bas.
- **Huit colonnes tiennent dans le cadre** à 1440 et à 1280 points : sur un portable, « Ouvrir » ne garde que sa flèche
  (son nom reste lu), et les six cartes restent sur une rangée.
- **Pas encore** : l'export de la sélection, le menu « … » d'une ligne et les filtres par type, offre et cabinet ne sont
  pas écrits (la sixième carte de la maquette, « venus par un cabinet », l'est depuis 1.16.0).

**C18. Abonnements, recalé sur sa maquette** (13/10/2026). La liste et, à côté, ce qui l'explique :
- **Une échéance sur deux rangées** : le jour, ce qui se passe et le montant ; dessous, les relances de son échéance et
  sa fiche. La liste prend la place de la maquette (deux tiers), la colonne d'à côté le reste ; sous 1100 points, elle
  passe sous la liste.
- **Ce qui revient chaque année** quitte l'en-tête pour la colonne d'à côté, une seule fois ; **les relances** y ont leur
  légende, chaque puce avec sa phrase (partie : le jour et l'heure au survol ; part dans l'heure ; prévue ; sautée, une
  plus proche de l'échéance part à sa place ; manquée, à regarder) ; puis **ce que le serveur fait seul** (les jours des
  relances, la grâce, la lecture seule), lu dans ses règles.
- **Le compte est dans le titre de la liste** : le pied ne se montre que pour tourner les pages.
- **Les six cartes restent sur une rangée** jusqu'à 1180 points (la liste ne descend pas sous le bas d'un portable).
- **Pas encore** : le montant « TVA et timbre compris » de la maquette attend la décision sur la TVA et le timbre
  (À DÉCIDER) ; la console dit le montant hors taxes, au prix du jour. Le bouton « Appeler » attend un numéro de
  téléphone que la fiche ne porte pas.

**C19. Le journal, recalé sur sa maquette** (13/10/2026). **Qui se choisit d'un clic** : une pilule par membre de
l'équipe, avec ses initiales, au lieu d'une liste déroulante. Chaque ligne dit **qui** (ses initiales, son nom, son rôle
en clair), **le geste et sa famille** (abonnements, l'équipe, le service — lue dans le nom du geste), **sur quoi** (un
lien), **le motif** entre guillemets, et **ce qui a changé** : chaque case sur ses lignes, la valeur d'avant barrée
au-dessus de la nouvelle, jamais « — → … » pour une case qui était vide. **Un jour se dit comme on le dit** :
« Aujourd'hui · mardi 13 octobre · 3 gestes », « Hier · … », l'année seulement quand ce n'est pas celle d'aujourd'hui ;
le compte d'un jour ne s'écrit que s'il est entier (le dernier jour lu peut continuer dans la suite).
- **Pas encore** : les cartes de la maquette (gestes de l'équipe, réservés à la direction, accès aux dossiers, le système
  seul), la période, la recherche, le filtre par sorte de geste, l'onglet des accès aux dossiers et l'export — ils
  demandent au serveur des comptes et des filtres qu'il ne rend pas encore.

**C20. L'équipe, recalée sur sa maquette** (13/10/2026). Les boutons à droite du titre (une règle de l'en-tête, pour
tous les écrans : le texte se resserre avant que les boutons passent dessous). Trois cartes — l'équipe, le code du
téléphone, qui est en ligne — et **« À régler dans l'équipe »** quand quelqu'un n'a pas son code, avec **« Le lui
rappeler… »** (un message à son adresse, depuis la messagerie de celui qui l'envoie : la console n'envoie rien). **Les
membres** ont leur titre dans la carte ; « (toi) » à côté de son nom ; les gestes d'une ligne dans son menu à trois
points (`MenuLigne`, le même que les règles des alertes). **Le menu se pose sur la fenêtre** (position fixe), plus
dans le tableau : la carte d'une liste coupe ce qui la dépasse, et un menu ouvert vers le haut sur la deuxième ligne
n'y montrait que sa moitié ; il se ferme quand la page bouge. **Ce que chaque rôle ouvre** est un tableau lu dans la
liste des gestes du serveur (`serveur/console/gestes.ts`, rendue par `GET /console/equipe` dans `droits`) : écrit une
seconde fois à l'écran, il dirait un jour autre chose que ce que le serveur laisse faire. Une nuance (le support
prolonge un essai une fois par entreprise ; « À décider » ne lui montre que ses lignes) se dit à la place du « oui ».
- **Pas encore** : les codes de secours, les appareils reconnus, les gestes des trente derniers jours (par membre et
  en carte) et les invitations en attente — la base ne les compte pas encore pour la console.

**C21. La fiche d'un client, recalée sur sa maquette** (13/10/2026). **« Ce qui attend, pour ce client »** en tête :
les lignes d'« À décider » qui le nomment, calculées par la MÊME fonction (`aDecider`, sur la liste telle que l'accueil la
lit — C3), dites sans son nom (c'est sa fiche) et avec le geste qui y répond : noter un paiement reçu (ou prolonger,
selon le rôle) pour une échéance passée ou une lecture seule, écrire au propriétaire d'un essai qui n'a pas servi.
Depuis 14b (1.5.0), quand nos factures naissent dans l'entreprise SkanFact et qu'on en est la propriétaire, une échéance
passée répond par **sa facture** : la préparer, l'émettre, l'ouvrir dans SkanFact (`docs/abonnement.md` B3) ; l'onglet
« L'abonnement » porte « Ses factures SkanFact » (une par période, son état et son reste ; au téléphone, une par carte).
La fiche se relit quand on revient dans son onglet. **Le
premier est le seul vert de la fiche** : le menu des gestes ne l'est plus jamais, et « Écrire… » est à côté de lui. Puis
**des onglets**, dans l'adresse (`?onglet=`) : l'aperçu (son entreprise — son offre, son matricule, l'échéance en
couleur quand elle presse —, ses comptes, à qui parler, son cabinet avec « Ouvrir la fiche du cabinet »), l'abonnement,
les membres, et le journal de son abonnement (« Son histoire », avec « Ses gestes au journal » pour la direction). Son
nom et son état ne se répètent pas dans la carte de son entreprise : ils sont en tête de la fiche.
- **Pas encore** : un groupe de plusieurs entreprises sur une même fiche, les factures et paiements, le support et ses
  échanges, « Noter un appel », l'accès à son dossier avec son accord, la procédure de reprise — ils demandent des
  briques qui n'existent pas encore (paiements, support, accès accordé).

**C22. La fiche d'un cabinet, recalée sur sa maquette** (13/10/2026). **Un bandeau** sombre en tête : son nom, son
nombre de dossiers, ses associés, sa date d'inscription, l'adresse de son premier associé, et ce qu'il paie aujourd'hui
(rien, et pourquoi). Puis **des onglets**, dans l'adresse (`?onglet=`) : l'aperçu — ses clients abonnés et les dossiers
qu'il tient, côte à côte, chacun nommant ses trois premiers et comptant le reste, et les mandats qu'on lui propose s'il y
en a ; chaque carte mène à la liste de ses dossiers **déjà filtrée** (`?place=`) —, ses dossiers (les trois cartes qui
filtrent, puis la liste, C3) et ses collaborateurs.
- **Pas encore** : ses factures et paiements, le support, le prix des dossiers qu'il tient (« ce qu'il paierait ») et
  le parrainage — ils demandent des briques ou des décisions qui n'existent pas encore.

**C23. L'accueil, recalé sur sa maquette** (13/10/2026). Le tableau du matin ne montre plus deux tuiles « non mesuré » :
une seule, sur deux places, dit ce qui n'est pas encore mesuré et pourquoi (l'encaissé du mois, le support), et rend la
place aux chiffres (sur deux colonnes, elle passe en dernier). « À décider » tient les deux tiers ; à côté, **les
relances parties depuis hier** : celles que le serveur a envoyées tout seul (la même table que l'écran Abonnements),
nommées, la plus récente d'abord — pour que personne ne relance une seconde fois à la main. La technique ne les reçoit
pas (elles nomment des clients). Un titre venu de la veille commence par sa majuscule.

**C24. Les incidents du service et la page d'état** (10 § 2.8 ; 06 § 9 ; base 0089). `#/service/incidents`, la
direction et la technique (aucune donnée de client). Un **incident** s'ouvre quand des clients risquent de sentir un
problème — une alerte n'en est pas un tant que personne n'en souffre. Il porte un numéro de l'année (INC-2026-006, sans
trou : la base verrouille la table le temps de le prendre), une gravité (mineur, majeur, critique : **elle monte, elle
ne descend pas**, la base refuse), la fiche réflexe qu'il suit, ses points dans l'ordre, et ce que la **page d'état**
publique en dit. Il se **clôt** avec son compte rendu — l'effet sur les clients, la cause, ce qui change — et ses
**suites**, chacune avec une personne de l'équipe et une date ; une suite se marque faite ou se repousse (plus tard, avec
son motif, et le compte de ses reports se garde). Les **maintenances** s'annoncent avant de commencer, douze heures au
plus, et s'annulent tant qu'elles n'ont pas commencé ; les mises en ligne que la veille a vues s'y lisent aussi, avec les
minutes sans réponse relevées autour d'elles (dix minutes de part et d'autre). Les **incidents passés** se lisent sur
trente jours ou sur l'année, avec ce que la veille a mesuré (l'arrêt complet, la disponibilité ; « — » sans relevé). Chaque
geste demande son motif et entre au journal avec le numéro de l'incident.
- **La page d'état ne passe jamais au vert à la main** : ses lignes restent celles de la veille. La console ne fait
  qu'y poser une **annonce** — le message public de l'incident ouvert le plus grave, la maintenance en cours ou dans les
  quarante-huit heures — que la veille lit chaque minute (`plateforme.veille_lire`) ; un incident majeur ou critique fait
  dire « Incident en cours », un mineur « Un incident en cours » (orange), une maintenance commencée « Maintenance en
  cours ». Le texte n'accepte ni « < » ni « > », et la page l'échappe quand même. Sans la base, la page garde la dernière
  annonce (une maintenance finie s'efface d'elle-même).
- **L'aperçu montré par la console est la page elle-même** : la veille écrit à côté de son fichier ce que la page dit,
  ligne pour ligne (`page-etat.json`, hors du dossier public), et la console le relit tel quel. Sans ce fichier, l'écran
  dit que la veille n'a pas encore écrit la page.
- **La page ne change qu'au passage de la veille, et l'écran le dit dans les deux sens** : ce qui vient d'être annoncé
  (un message publié, une maintenance entrée dans ses quarante-huit heures) « n'y est pas encore » ; ce qui n'a plus lieu
  d'être (incident clos, message retiré, maintenance annulée ou finie) y reste jusqu'au passage suivant, et l'écran le
  dit au lieu de laisser croire qu'on l'a oublié. Une maintenance y porte son créneau, comme sur la page publique.
- Une fenêtre qui annule quelque chose (« Annuler la maintenance ») nomme sa sortie (« Garder la maintenance ») :
  deux « Annuler » côte à côte se lisent comme le même geste.
- **Les règles d'un incident** (qui est prévenu, à quel rythme on parle aux clients) sont montrées **à décider** : la
  console ne prévient personne d'elle-même (les alertes de la veille, si). **Les fiches réflexes** (neuf, quatre temps
  chacune : contenir, dire, réparer, écrire) disent quand chacune a servi pour la dernière fois ; trois portent un
  « à décider » ou un « à vérifier » (le site de secours, l'INPDP).

**C25. Les travaux et les envois du service** (10 § 2.8 ; base 0090). `#/service/travaux`, la direction et la technique.
Ce que le serveur fait seul, et ce qu'il envoie aux partenaires : quatre chiffres (ce qui attend son dépôt à la TTN, ce
qui est parti aujourd'hui chez tous les partenaires comptés, ce qui reste à regarder, le dernier tour du facteur) ; une
carte par partenaire qui laisse une trace (la TTN, la signature, les SMS, les paiements en ligne, les relances
d'abonnement), quatorze jours, une barre par jour dont la part rouge est ce qui a été refusé ; la liste des **envois à
regarder** ; les **tâches programmées**.
- **Rien n'est inventé** : les e-mails, la TEJ et la CNSS n'ont pas de trace qu'on puisse compter ; l'écran les nomme
  « sans trace », jamais à zéro. Une TTN sans adresse (le contexte porte toujours son coffre) ou des relances sans relais
  d'e-mails sont « pas branchées », et leur tour ne tourne pas : jamais « bon ».
- **Un envoi à regarder** : une facture TTN pas finie après un essai ou retenue, refusée cette semaine ; une signature
  ou un paiement échoué cette semaine. Une entreprise d'essai n'est jamais à regarder. Il se dit par une **clé courte**
  — la FIN de son identifiant : le début d'un uuidv7 est son heure, deux envois de la même seconde y porteraient la même
  clé — jamais par sa pièce ni son montant. **Qui attend** : une panne se réessaie seule (« Prochain essai … ») ; un
  refus, un compte El Fatoora retenu (« retenue », pas « en attente ») ou un échec attendent l'entreprise.
- **Le nom de l'entreprise et le texte du motif sont pour la direction** ; la technique lit un numéro (E-xxxxxx) et la
  nature du motif dite par la console. Un motif rangé par une version plus ancienne qui n'est plus au catalogue n'a pas
  de texte : la page dit l'état de l'envoi, elle ne tombe pas pour une ligne.
- **Chaque tour du serveur note son passage** (`plateforme.noter_tour`, sans identité) : son heure, sa durée, s'il a
  réussi, et ce qu'il a fait en nombres nommés seulement ; un échec garde sa **nature** (un code, le nom d'une classe),
  jamais son message, qui peut citer un client. Noter ne fait jamais échouer le tour. Un tour qui n'est pas passé depuis
  trois fois son rythme s'est **arrêté** ; une tâche de la nuit pas faite depuis vingt-six heures (quarante jours pour
  l'exercice de restauration) ne passe plus, même si sa dernière fois a réussi.
- « N envois à regarder » d'un partenaire filtre la liste à lui seul, et se retire ; au téléphone, chaque envoi est un
  bloc qui se lit en entier, sans défilement de côté.

## Mettre en route

La personne crée d'abord son compte SkanFact, puis met en place le code de son téléphone (« Ton compte »,
dans l'application). Sur le serveur, en root :

```
sudo bash /opt/skanfact/depot/exploitation/equipe.sh voir
sudo bash /opt/skanfact/depot/exploitation/equipe.sh ajouter <adresse> <direction|support|technique> "<motif>"
sudo bash /opt/skanfact/depot/exploitation/equipe.sh retirer <adresse> "<motif>"
```

Chaque geste de l'outil demande son motif et laisse sa ligne au journal (sans auteur : l'exploitation). L'outil sert à
poser le premier membre, et à rendre la direction à quelqu'un si plus personne ne peut se connecter ; ensuite, tout se
fait depuis l'écran « Équipe ». La console s'ouvre à `https://<le serveur>/console/` ; sur le serveur d'essai, aussi à `https://console.skanfact.tn`
(docs/mise-en-ligne.md, J).

## Décidé par délégation (13/10/2026)

- **Le code du téléphone à chaque connexion**, même sur un appareil reconnu : le cadrage demandait le code ET un appareil
  reconnu ; un poste reconnu ne dispense de rien ici.
- **Une session : une heure sans geste, douze heures au plus.**
- **À qui n'est pas de l'équipe, la réponse d'un mot de passe faux.**
- **Le support prolonge un essai de 7 à 30 jours, une fois par entreprise** ; une seconde prolongation, et tout le reste,
  sont à la direction. « Offrir un mois » (un avoir sur la prochaine facture, 10 § 2.4) attend nos factures (14b).
- **L'adresse : `/console/` du même serveur** ; sur le serveur d'essai, aussi `console.skanfact.tn`, par le frontal.
- **« Inscriptions » compte les sept derniers jours, aujourd'hui compris**, et ouvre la liste avec ce filtre.
- **Une fenêtre ne se ferme pas d'un clic à côté. Et une fenêtre où l'on a TAPÉ demande avant de jeter la saisie**
  (13/10/2026) : Échap, la croix et son bouton « Annuler » passent par la même garde (`Dialogue`, `Bouton ferme`) et
  posent « Abandonner cette saisie ? » à la place des boutons, le curseur sur « Reprendre la saisie » (Entrée ne jette
  rien ; Échap, encore, reprend). Choisir dans une liste n'est pas taper : une fenêtre où l'on n'a fait que choisir se
  ferme sans question, même quand ce choix remplace un champ vide par une liste (14/10/2026 : chaque champ se reconnaît à
  son identifiant, un champ vide ne compte pas). L'instantané se prend à l'ouverture, ce que la fenêtre préremplit ne
  compte pas ; un geste réussi la referme sans rien demander. **Le refus d'un motif reste jusqu'au clic suivant** : effacé à la frappe, il ferait
  remonter les boutons sous le curseur.
- **La console n'est pas l'API des partenaires** : ses routes n'entrent pas dans la documentation de l'API.
- **Les montants des échéances sont hors taxes, au prix du jour** : la TVA et le timbre de nos factures viennent avec
  elles (14b). Aucune remise n'existe encore.
- **« À venir » couvre trente jours, aujourd'hui compris** ; la carte d'arrivée est la sienne.
- **Une relance d'une échéance passée ne compte plus** après une prolongation ou un paiement.

## À DÉCIDER (Skander)

- **Qui entre dans l'équipe, et avec quel rôle.** Le premier membre se pose sur le serveur des pilotes par l'outil, en
  root : jamais par Claude.
- **Les règles d'un incident** (C24) : les trois gravités, qui est prévenu et à quel rythme on parle aux clients. Elles
  sont montrées comme une proposition ; rien ne les applique tant qu'elles ne sont pas décidées.
- **Un site de secours** (la fiche « le site principal est perdu ») : aujourd'hui, la bascule se fait en montant un
  serveur neuf depuis la copie hors machine ; rien n'est prêt d'avance.
- **Un second destinataire des alertes** : une seule adresse et un seul numéro sont prévenus ; s'ils ne répondent pas,
  personne d'autre ne le saura. L'écran des alertes le dit ; le second se règle sur le serveur (`exploitation/alertes.sh`).
- **Le délai d'annonce d'un nouveau prix** (C28) : combien de jours avant qu'il ne s'applique, et comment les clients
  en sont prévenus (un message aux clients, un e-mail). Aujourd'hui, un prix se pose en base, daté, et la console le
  montre « à venir ».

**C26. La sécurité du service** (10 § 2.8, 03 § 6 ; base 0091). `#/service/securite`, la direction et la technique. Ce
que les règles de connexion ont fait, lu dans ce qu'elles écrivent déjà — **rien de neuf n'est enregistré** : quatre
chiffres (les connexions réussies des vingt-quatre heures, les codes faux tapés après un mot de passe bon, les comptes
freinés, les jours qui restent au certificat) ; **ce qui demande un regard** ; les connexions heure par heure ; les
règles et leurs chiffres ; les clés qui peuvent commander le serveur ; l'équipe et ses appareils.
- **Ce qui demande un regard, par ordre d'urgence** : trois codes faux ou plus après un mot de passe BON (quelqu'un
  connaît ce mot de passe, la personne doit le savoir) d'abord ; le même cas qui a fini par aboutir ensuite ; un compte
  freiné par des mots de passe faux en dernier (la règle a fait son travail). L'équipe passe devant à urgence égale : un
  accès à la console vaut tous les dossiers. Un appareil nouveau se dit.
- **Une adresse de client est masquée pour la technique** (h…@exemple.tn) ; la direction la lit en entier ; une
  personne de l'équipe se nomme toujours. Un compte freiné se désigne par l'empreinte de son adresse, jamais l'adresse.
- **Lever l'attente** d'un compte freiné (la personne a appelé, c'était bien elle) : direction ou technique, avec son
  motif, au journal (`service.lever_attente`, l'empreinte et le nombre d'erreurs effacées, jamais l'adresse). Un compte
  qui n'attend plus se refuse avec sa phrase. Le refus d'un motif trop court reste affiché jusqu'au clic suivant : effacé
  à la frappe, il ferait remonter le bouton sous le curseur.
- **Les règles sont celles du code**, recopiées pour être dites et confrontées par un test à la base (`socle.noter_erreur`,
  `socle.sms_permis`) et aux limites du serveur : une règle dont le serveur ne garde pas le compte (ses seaux vivent en
  mémoire) dit « pas compté », jamais zéro.
- **Les clés qui commandent le serveur** (`exploitation/acces-cles.json`) : leur nom et si elles sont retirées, jamais
  la clé, même publique. Le certificat se lit sur le dernier relevé de la veille ; sans relevé, « — ».
- Ce que l'écran ne prétend pas : la chaîne du journal n'est **pas encore relue** (l'écran le dit) ; l'accès d'urgence,
  bloquer une adresse et la date des autres secrets n'existent pas encore et ne sont pas montrés.

**C27. Les versions du service** (10 § 2.8 ; base 0092 ; docs/mise-en-ligne.md B7). `#/service/versions`, la direction
et la technique. Ce que le suiveur a installé et ce qu'il va faire, lu dans l'état qu'il écrit à chaque tour
(`etat.json`), dans la base (les migrations, les versions vues par la veille, les consignes) et sur la machine.
- **Chaque version se nomme par son numéro** (« v1.4.2 », `version` de `package.json`, lu par le suiveur) ; son
  identifiant de commit se lit au survol. Une version d'avant la numérotation se dit par son identifiant court.
- **Quatre chiffres** : la version en service (et depuis quand), le dernier tour du suiveur (au-delà de six minutes de
  silence : « plus rien ne s'installe », en grave), la prochaine et où elle en est, la dernière migration de la base.
- **La version en service et celle d'avant** : installée quand, en combien de temps, par le suiveur ou par un retour
  demandé, ses migrations ; « revenir à … » si celle d'avant est encore parmi les trente dernières du dépôt (la base,
  elle, ne recule jamais : une migration ne se défait pas).
- **La prochaine version**, étape par étape : envoyée au dépôt, la vérification de l'envoi, toutes les preuves (selon
  ce que ce serveur attend), l'installation ici (prête, en attente, retenue, gelée, rouge).
- **Trois consignes au suiveur**, chacune avec son motif et au journal (`versions.geler`, `versions.retenir`,
  `versions.revenir`, `versions.lever`) : **geler** les installations jusqu'à une date (quatorze jours au plus ; un retour
  passe quand même) ; **retenir** une version, avec celles d'avant elle (la suivante s'installera) ; **revenir** à une
  version d'avant (la quittée est retenue, pour ne pas se réinstaller au tour suivant). Une consigne se lève avec son
  motif ; un retour fait (ou impossible) se note par le suiveur, avec sa raison. Une version retenue ne se propose plus
  pour un retour : on lève d'abord sa consigne.
- **L'historique** des installations (les quarante dernières, réussies ou non, à quelle étape), complété de ce que la
  veille a vu tourner ; **les tâches d'entretien** du dépôt et ce que le suiveur en a noté ; **la machine** (le système,
  Node, PostgreSQL, les correctifs automatiques, un redémarrage demandé).
- Ce que l'écran ne prétend pas : les versions installées chez nos clients (l'application de bureau), la pré-production
  et les deux exemplaires n'existent pas encore et ne sont pas montrés ; relancer les preuves d'une version se fait sur
  GitHub, pas d'ici.

**C28. Les réglages de la plateforme** (10 § 2.9 ; base 0093). `#/reglages`, dans « La plateforme » : la direction et
le support le lisent (le support, pour répondre à un client sur un prix), **seule la direction y fait un geste**, et
l'écran le dit en tête au support. Quatre onglets, l'adresse garde l'onglet (`?onglet=regles`, `?onglet=formats`,
`?onglet=messages`).
- **Offres et prix** : la grille du jour, lue dans les prix datés (`plateforme.prix`, 0082) comme l'application des
  clients les lit — chaque offre, à l'année et au mois, hors taxes, depuis quand ; ce qui est daté après aujourd'hui se
  dit « à venir » sous l'offre, jamais dans la case ; une case sans prix posé reste « — ». Les abonnés de chaque offre se
  comptent par le **même état** que la liste des clients (une période payée qui court ; un retard n'en est pas), l'essai
  à part. La frise des échéances (les relances, l'échéance, la grâce, la lecture seule) dit les règles du jour, que la
  direction règle dessous (1.13.0 ; `0104` ; `docs/abonnement.md` C15) : la durée de l'essai, les relances, la grâce,
  chacune avec qui l'a posée et pourquoi, et son geste (« Changer l'essai… », « … les relances… », « … la grâce… ») ; la
  fenêtre dit ce que la règle touche et ne touche pas, et son aperçu, à sa place dès l'ouverture, la règle d'avant
  barrée, la nouvelle en mots et, pour la grâce, les entreprises qui y sont aujourd'hui (elles gardent la leur). **Un nouveau prix s'y prépare** (1.12.0 ; `0103` ;
  `docs/abonnement.md` C14) : « Préparer un nouveau prix… » (une offre ou un ajout, à l'année ou au mois, le montant, la
  date), avec l'aperçu du serveur (le prix d'aujourd'hui barré, le nouveau, l'écart, qui l'a aujourd'hui), au plus tôt
  après le préavis (30 jours, réglable : « Changer le préavis… ») ; sous la grille, chaque prix à venir dit qui l'a
  préparé, quand et pourquoi, et se retire avant sa date. Un prix en vigueur ne change plus. Sous la grille, **« Ce que
  chaque offre comprend »** (1.14.0 ; `0105` ; `docs/abonnement.md` C16) : les caisses, les établissements, les salariés
  avec la paie (des nombres), la paie et la comptabilité complète (comprise ou achetée seule, en pastille), pour
  Essentiel et Complet ; les salariés sont ceux dont l'entreprise fait la fiche de paie, jamais les personnes qui
  utilisent SkanFact (la ligne le dit). Un changement se prépare comme un prix (« Préparer un changement… » : l'offre,
  puis ce qui change, deux listes courtes ; un module s'y propose dans l'autre état que le sien ; même préavis), se
  dit dans sa case (« → 3 le 13/11/2026 ») et sous la grille avec qui l'a préparé et pourquoi, et se retire avant sa
  date ; l'aperçu dit qui a l'offre aujourd'hui, et avertit avant le geste d'une offre Essentiel qui comprendrait plus que
  Complet, ou d'un module retiré à des abonnés. Ensuite, **« Ce qui s'ajoute à l'offre »** (14c, 1.10.0 ; `0101`,
  `plateforme.console_ajouts`) : chaque ajout que la facture compte (une caisse, un établissement, un salarié de plus,
  la paie ou la comptabilité complète achetée seule ; jamais un utilisateur, sans limite depuis 1.11.0), ce que chaque offre en comprend (lu dans le contenu du jour),
  ses prix datés (`plateforme.prix_option`) rangés comme ceux des offres, et pour un module, les abonnés du jour dont
  l'offre ne le contient pas et qui l'ont acheté (le même état que la liste des clients). Puis **« Les remises »**
  (1.15.0 ; `0106` ; `docs/abonnement.md` C17) : celle du groupe (son taux, sans limite de durée, et combien de sociétés
  sont dans un groupe) et celle du cabinet (son taux et sa durée en mois), chacune avec qui l'a posée et pourquoi ; un
  changement se prépare comme un prix (« Préparer un changement… » : la remise, le taux et la date sur une ligne, la
  durée du cabinet dessous, vide pour garder celle d'aujourd'hui ; même préavis), se dit sous sa remise (« → 25 % pendant
  6 mois le … ») et sous la grille, et se retire avant sa date. Dans la **fiche d'un client**, onglet « L'abonnement »,
  la carte **« Groupe et remise »** dit la remise de sa prochaine période et pourquoi, son groupe (la première abonnée
  d'abord, « Prix normal » ou « −20 % ») et les autres sociétés de sa propriétaire ; la direction y crée un groupe, y met
  une société ou l'en retire, toujours avec l'aperçu de qui paiera quoi, puis son motif (journal `groupes.entree`,
  `groupes.sortie`) ; le support la lit. Sous la frise, **« Nos factures »** (14b, 1.5.0 ; `docs/abonnement.md`
  B1) : l'entreprise SkanFact où nos factures naissent, désignée une fois par sa propriétaire de la direction (motif,
  journal `factures.editeur`), avec qui l'a désignée et combien de factures y sont préparées ; elle se change tant
  qu'aucune ne l'est.
- **Règles fiscales** : le registre des règles communes (`socle.regle_fiscale`, posé depuis `base/regles-communes.json`),
  chacune avec sa valeur dans son unité quand on la connaît (le timbre : des millimes), son début, sa fin, sa source telle
  qu'elle est écrite. **La relecture par un comptable s'écrit à côté de la règle, jamais dans la règle** (une règle ne se
  modifie pas) : qui l'a relue (son nom et son cabinet, tels qu'on les écrit), son avis (juste telle quelle, ou à
  corriger), ce qu'il en dit ; elle ne se modifie ni ne s'efface (la base le refuse), on en note une nouvelle. La plus
  récente décide : une règle jamais relue, ou relue « à corriger », est **à relire** (l'onglet les compte). Au journal :
  `reglages.relire`, la règle par son code et l'avis. Une règle se corrige dans le dépôt, par une nouvelle règle datée
  avec sa source ; l'écran dit aussi ce qui n'est pas au registre (la paie, la TVA, la retenue, les échéances : chaque
  entreprise les règle elle-même) et ce qu'on fait quand paraît une loi de finances.
- **Formats officiels** (base 0094 ; `serveur/console/formats.ts`) : les fichiers que l'administration attend — la facture
  électronique (TEIF), sa signature (XAdES, DigiGo), l'envoi à la TTN, les attestations de retenue (TEJ), la CNSS du
  trimestre, la liasse, l'export des écritures, les tickets de caisse — chacun avec sa version, ce que SkanFact en fait,
  contre quoi c'est vérifié, où on en est, et ce qui reste **À VÉRIFIER**, sur sa ligne. **Le registre s'écrit dans le
  code**, à côté de ce qu'il décrit : un format change avec une nouvelle version, relue et prouvée, jamais depuis la
  console ; la version du TEIF est celle du code qui écrit le fichier. Les chiffres viennent de la base
  (`plateforme.console_formats`), toutes entreprises ensemble et sans les entreprises d'exemple : celles qui se disent
  soumises, les fichiers écrits (ceux d'une version plus ancienne, gardés tels quels, comptés à part), les pièces signées
  et celles qui attendent leur signature, et l'envoi à la TTN comme la liste des factures le dit à l'entreprise (en route,
  retenue, déposée, acceptée, refusée, signée sans partir). **Jamais une pièce, un nom ni un montant.** Une pièce retenue
  ou refusée demande un geste chez son client : l'onglet les compte, la ligne de la TTN le dit en couleur. Un service dont
  ce serveur n'a pas l'adresse (la TTN, DigiGo) le dit : ses pièces attendent. Rien ne s'y modifie.
- **Messages aux clients** : le message affiché en haut de l'application de **tous** les clients
  (`plateforme.message_clients`) — une nouveauté (vert d'eau) ou une maintenance prévue (bleu), une ou deux lignes sans
  balise, daté du jour où il paraît au jour où il disparaît (au calendrier de Tunis, **trente jours au plus**, jamais
  dans le passé). **Jamais plus d'un à la fois** : un nouveau remplace celui qui s'affiche ou qui attend, qui va dans les
  messages passés (« remplacé le … par le suivant ») ; deux écrits au même instant ne se laissent pas l'un l'autre en
  cours. Il se **retire** avec son motif ; fini, il ne se retire plus. La fenêtre montre ce que les clients verront,
  pendant qu'on tape. Au journal : `reglages.message_affiche`, `reglages.message_retire`, avec leurs deux jours. Un
  incident ne passe pas par ici : il se publie depuis Service · Incidents, sur la page d'état.
- **Chez le client** (`web/public/plateforme/message.js`, posé par l'adaptation `web/v10/message-clients.txt`) : la
  route `GET /entreprises/:entreprise/message` rend le message du jour — son texte, sa sorte et ses deux jours, **jamais
  qui l'a écrit ni son motif**. Le pont le relit avec l'abonnement (au chargement, chaque heure, au retour au premier
  plan) et le repose à chaque page, au-dessus du bandeau de l'exemple. « Plus tard » le cache **sur cet appareil, pour ce
  message** : un message neuf reparaît. Le bandeau caché garde sa place jusqu'à la page suivante, avec sa phrase (« Message
  caché sur cet appareil ») : il ne fait pas remonter la page sous le curseur.
- Ce que l'écran ne fait pas encore : la déclaration annuelle d'employeur au registre des formats, les nouveautés
  allumées une à une, préparer un nouveau prix depuis l'écran (une offre ou un ajout), les remises, la colonne TTC (14b).
  Depuis : le nouveau prix se prépare dans Réglages (1.12.0), les remises aussi (1.15.0) ; les offres de fondateur sont
  abandonnées (Skander, 14/10/2026).

## Quatrième partie : le support (Support S1, 13/10/2026)

**C29. Le support** (10 § 2.7 ; base 0095 ; `docs/support.md`). `#/support`, dans « Chaque jour » : la direction et le
support le lisent et y répondent ; la technique n'y lit rien. Les règles des demandes (qui lit quoi, ce qui part avec une
demande, l'alerte par e-mail sans contenu) sont dans `docs/support.md` ; ici, l'écran.
- **Deux colonnes, qui tiennent dans la fenêtre** (revu le 13/10/2026, à la demande de Skander : trois colonnes
  serraient la conversation, et la réponse tombait sous le bas de l'écran). À gauche, la liste (les ouvertes, la plus
  urgente en haut ; les closes à un clic), puis **une** carte « le client et la personne » : le client (son abonnement,
  sa vie dans l'application, sa fiche, ses demandes) puis la personne (son nom, ses rôles, son adresse, la page et la
  version d'où elle a écrit). À droite, large, la conversation : le sujet
  dans ses mots, qui et d'où, où elle en est, puis les messages (le dernier en bas, sous les yeux) et la réponse. À
  l'ordinateur, **la page ne défile pas** : la grille prend la hauteur qui reste sous l'en-tête (mesurée), chaque
  colonne défile seule, et le dernier message, le champ et « Envoyer » restent à l'écran — à 1440×900 comme à 1280×800.
  Au téléphone : la liste d'abord (aucune demande ne s'ouvre d'elle-même), choisir une demande amène sa conversation,
  et chaque cible fait 44 points.
- **La réponse** : les réponses types sont les articles de l'Aide du client (trois à l'écran ; celui de la page d'où il a
  écrit d'abord) ; un clic joint l'article et, sur une réponse vide, pose « Bonjour {prénom}, » avec le curseur sur la
  ligne vide ; tout autre article se joint en pied ; Ctrl + Entrée envoie. Un refus qui ne porte pas sur le texte (la
  demande close entre-temps) relit l'écran, la réponse reste gardée.
- **L'écran se relit toutes les trente secondes et au retour sur l'onglet**, avec la pastille de « À décider », sauf
  **sous les doigts** (une fenêtre ouverte, une réponse en train de s'écrire). Une réponse commencée est **gardée par
  demande** ; si la personne clôt la demande pendant qu'on écrit, l'écran le dit et « Rouvrir… » la rend.
- **Clore** et **rouvrir** demandent un motif ; **noter une demande reçue ailleurs** se fait depuis l'onglet « Ses
  demandes » de la fiche du client, au nom d'un membre actif de son entreprise. Chaque geste entre au journal, sans le
  texte des messages.
- **L'accueil et « À décider »** : une demande sans réponse depuis vingt-quatre heures est une décision (« Répondre »
  ouvre la demande) ; la tuile du support, la barre, la fiche et la page comptent par la même fonction (`compter`).
- **L'accès au dossier** (Support S2, version 1.4.0 ; base 0096 ; les règles dans `docs/support.md`) : sous l'en-tête
  de la conversation, une **bande d'une seule rangée** dit où en est l'accès au dossier de ce client — rien (« le
  support ne voit pas son dossier sans son accord », « Demander l'accès… »), une demande qui attend (« Retirer ma
  demande »), un accès qui court (« Accès au dossier jusqu'à… », ce qui reste, les pages lues, qui l'a accordé ;
  « Ouvrir en lecture », « J'ai fini »), ou le dernier accès fermé (« Redemander… »). Son titre est caché : l'état dit
  lui-même qu'il s'agit du dossier (vu le 14/10/2026 : sur deux rangées, à 1280×800, elle poussait « Envoyer » sous le
  bord). « Envoyer » reste le seul bouton principal de l'écran. La **même** chose, en carte, au pied de l'onglet « Ses
  demandes » de la fiche du client, où « Ouvrir le dossier (lecture) » est le geste principal (`AccesDossier`, un
  composant pour les deux). « Demander l'accès » ouvre une fenêtre qui dit ce que le client verra
  et attend un motif (3 à 300 caractères). Le journal : « accès au dossier demandé », « accès au dossier rendu ».

## Cinquième partie : les paiements (1.17.0, 14/10/2026)

**C30. Les paiements de nos factures, et les coûts du mois** (10 § 2.2 et § 2.6 ; base 0108 ; la maquette Paiements).
`#/paiements`, dans « Chaque jour », **la direction seule** : ce sont les comptes de SkanFact (le support répond à un
client sur sa fiche, qui montre ses factures ; la technique ne lit aucune donnée de client). La console **ne note aucun
règlement** : un virement, un chèque se notent dans l'application de SkanFact, sur leur facture (10 § 2.5, « la console
ne refait pas ») ; l'abonnement suit tout seul (14b B4). D'ici, chaque ligne y mène.
- **Un mois à la fois** : « ‹ Septembre », « Octobre 2026 », « Novembre › » (jamais un mois à venir) ; l'adresse le
  garde (`#/paiements?mois=2026-09`). Les deux boutons gardent leur largeur d'un mois à l'autre : un second clic tombe
  au même endroit.
- **L'encaissé du mois**, dans une bande sombre : les règlements notés sur nos factures, **à leur date**, remboursements
  déduits ; par Konnect, par virement, par chèque, autrement (espèces, carte, traite). **Konnect seulement avec la
  preuve du prestataire** (le paiement en ligne prouvé, 0047) : un « en ligne » sans preuve se range dans « autrement ».
  Dans la devise de l'entreprise SkanFact ; un règlement dans une autre devise se dit à part, **jamais additionné**. La
  tuile « encaissé ce mois » de l'accueil dit le même montant, **par la même fonction** (`encaisseDuMois`), et y mène ;
  sans entreprise SkanFact désignée, elle dit « non mesuré » et pourquoi (C2), jamais 0 ; le support ne la voit pas.
- **À encaisser** : nos factures émises qui doivent encore, la plus en retard d'abord ; le reste, l'échéance (« à payer
  avant le… », « en retard de 5 jours »), ce qui est **déjà venu en déduction** (« 20,000 DT déjà reçus », « un avoir de
  11,900 DT déduit » : une facture corrigée par un avoir ne se dit pas « payée en partie »), et ce que devient
  l'abonnement (« passe en lecture seule le 23/10 ») : qui appeler d'abord. « Noter son règlement » ouvre **sa** pièce
  dans SkanFact, à côté ; c'est l'étape suivante de l'écran (le seul bouton vert). Au-dessus, les factures préparées
  qui attendent d'être émises (« elles ne doivent rien encore »), avec « L'émettre ».
- **Trop payé** (seulement s'il y en a) : ce qui dépasse le net moins les avoirs, et une facture annulée par ses avoirs
  réglée quand même. Un trop-perçu ne se garde jamais en silence : il se rembourse (un règlement négatif) ou se déduit
  par un avoir, dans SkanFact.
- **Reçus en {mois}** : chaque règlement du mois, le plus récent d'abord (sa date, le client, la facture, la référence,
  le montant, le moyen ; « Konnect a confirmé aujourd'hui, 02:24 »). La liste se pagine par cinquante.
- **Les coûts du mois**, à côté : saisis à la main par la direction, **d'après la facture reçue** (le fournisseur et
  son numéro : c'est le motif du journal), **toutes taxes comprises**, comme l'encaissé est ce qu'on a reçu. Un coût
  **ne se modifie pas** et ne s'efface pas (la base le refuse) : il se **retire** avec son motif (il reste, barré, sous
  la liste, avec qui et quand), puis se saisit de nouveau. Le mois se choisit (le mois en cours ou un des onze d'avant).
  **Ce qui reste** (l'encaissé moins les coûts, le point mort de 13 § 7) ne se dit **que si le mois a des coûts
  saisis** : sans eux, ce serait l'encaissé, un zéro qui passerait pour une mesure.
- **Le journal** : « coût du mois saisi », « coût du mois retiré », la famille « paiements » ; « Sur quoi » ouvre les
  coûts de leur mois.
- **Décidé par délégation** (14/10/2026), à la place de la maquette : la colonne « À pointer » de la maquette lisait le
  relevé de la banque ; **aucune banque n'est branchée**, et la console ne lit pas un relevé qu'on ne lui donne pas :
  elle montre ce qui reste à encaisser, et l'écran le dit. La retenue à la source sur nos factures attend le `05` § 4.2
  (**À VÉRIFIER**) : pas montrée.

## Sixième partie : nos factures (1.18.0, 14/10/2026)

**C31. Nos factures** (10 § 2.5 ; base 0109 ; la maquette Nos factures). `#/nos-factures`, dans un groupe à part de la
barre, « Notre entreprise », **la direction seule** (comme les paiements : ce sont les comptes de SkanFact). Les
factures d'abonnement que l'entreprise SkanFact a émises dans un mois, et les avoirs qui les corrigent ; rien d'autre de
son dossier. La console **les montre, ne les refait pas** : chaque numéro ouvre sa pièce dans l'application de SkanFact,
à côté, et « Ouvrir notre entreprise dans SkanFact » ouvre le dossier entier.
- **Un mois à la fois**, avec le même sélecteur que les paiements (`web/console/src/mois.tsx`) ; l'adresse garde le mois
  et le filtre (`#/nos-factures?mois=2026-09&filtre=refusees`).
- **Le résumé** : combien de factures (et d'avoirs), le **montant émis** et celui des avoirs, **ce qui reste à
  encaisser** de ces factures (le reste de chacune, par la règle de toutes les factures ; « tout est encaissé » quand
  rien ne reste), et **la TTN** en une barre et une phrase (« 3 acceptées · une déposée, en attente de la TTN · une
  refusée »). Dans la devise de l'entreprise SkanFact ; une pièce d'une autre devise se dit à part, jamais additionnée.
- **Où chaque pièce en est hors du dossier**, dans l'ordre d'une facture : pas de fichier de facture électronique, à
  signer, signée à envoyer, déposée (en attente), acceptée, refusée. Le dépôt dit son état ; sans dépôt, la signature ;
  sans elle, le fichier (`etatTtn`).
- **Une refusée vient en tête**, dans une carte : ce qu'elle était, si elle est déjà payée, **ce que la TTN a répondu**
  (ses accusés, tels quels), et « Ouvrir sa facture dans SkanFact ». Ce que la TTN demande après un refus (refaire la
  facture, ou la renvoyer corrigée) : **À VÉRIFIER**, et la carte le dit.
- **Ce qui attend un geste, avec sa raison** : des pièces **sans fichier** quand la fiche de l'entreprise SkanFact ne la
  dit pas soumise à la facture électronique (une pièce s'émet alors sans fichier quand une fiche ne le permet pas : le
  matricule, l'identifiant du client ; soumise, plus aucune ne s'émet sans lui) → « Ouvrir sa fiche dans SkanFact » ;
  qui est soumis et depuis quand : **À VÉRIFIER** avec le comptable de SkanFact (loi de finances 2026, art. 53). Des
  pièces **à signer** → « Les signer dans SkanFact » (la liste des factures, « Signer les N pièces en attente… »).
  **Un seul bouton principal** : la première de ces étapes (une refusée, puis la fiche, puis la signature).
- **La liste**, la plus récente d'abord, avec les noms de ses colonnes (pièce, client et période, montant, TTN,
  paiement) : le numéro et sa date, le client (sa fiche) et ce que la pièce paie (l'offre, la périodicité, la période ;
  un avoir dit la facture qu'il corrige), le montant (un avoir en moins), la TTN, le paiement (« payée », « à payer
  avant le… », « en partie : reste… », « en retard depuis le… » ; un avoir : « déduit de FAC-… »). Quatre filtres :
  toutes, refusées par la TTN, pas encore acceptées, pas encore payées ; **chacun compte ce qu'il ouvre, par la fonction
  qui filtre** (`dansLeFiltre`, C3). La liste se pagine par cinquante. Au téléphone, une ligne se lit comme un courrier
  (le numéro et sa date, le montant en face ; le client ; la TTN ; le paiement) et les noms des colonnes s'effacent.
- **Un mois sans pièce ne dit qu'une chose** : « Aucune facture émise en septembre 2026. » (ni résumé à zéro, ni
  filtres vides).

**La densité de la console** (Skander, 14/10/2026 : « zoomée par rapport aux maquettes… privilégier la quantité
d'information »). Le grand écran se resserre sur les mesures des maquettes : le texte à 14,5 points, le titre d'un écran
à 32, la barre de gauche à 248 points de large avec des entrées de 36 (la liste défile seule quand la fenêtre est basse :
la marque et la carte de la personne restent à leur place), les boutons à 38, les cartes à 20 × 24 de marge, les
cellules des tableaux à 11 × 12, la page à 24 × 32 et jusqu'à 1 440 points de large. **Le téléphone garde ses cibles de
44 points.**

## Ce que le lot ne fait pas

La suite de la console : le relevé de la banque lu et pointé (aucune banque branchée ; les paiements, C30, montrent ce qui reste à encaisser), la retenue à la source sur nos factures (`05` § 4.2), la suite du service (la
sécurité : l'accès d'urgence, bloquer une adresse, la chaîne du journal relue, la date des secrets ; le débit des travaux heure par heure, et les envois des e-mails, de la TEJ et de la CNSS, qui n'ont pas encore
de trace), la mesure, la suite des réglages (les nouveautés allumées ; un prix se prépare depuis la 1.12.0, C28), et le filtre du journal par geste et par période. L'écran
« Application de bureau » de la maquette (les licences, les postes, la fin de vie et le passage à la plateforme de la v10)
ne se construit pas : **la v10 n'est installée chez personne** (Skander, 14/10/2026). Celui de la nouvelle application de
bureau (la coque et son agent local : les postes qui l'ont, leur version, ce que l'agent voit, ses erreurs) se dessinera
quand elle sera distribuée aux clients (`09` étape 4). Le service ne se voit encore que du serveur
lui-même : aucune vérification de l'extérieur (06 § 7, depuis deux villes) ; l'écran le dit.

## À VÉRIFIER

- Sur chaque serveur, la console lit `veille.json` : sinon son Service dit « non mesuré » (c'est la règle, pas une
  panne), et la veille se vérifie à part. La veille confie aussi ses relevés à la base (`SKANFACT_BASE`, lue dans
  `/etc/skanfact/serveur.env`) : sans elle, la disponibilité, les briques et les nuits restent « non mesurées ».
- La TVA et le timbre fiscal de nos factures (14b, avec le comptable) : les montants des échéances restent hors taxes
  d'ici là.

## Revu à la souris (13/10/2026)

Sur l'essai de l'outil humain (`scripts/humain/exemple-console.ts` : une direction, un support, une technique sans code,
huit entreprises dans chaque état, une veille qui signale deux problèmes ; `code-console.ts` donne le code du téléphone),
en direction, en support et en technique ; en clair et en sombre ; à 1440 et à 390. Corrigé pendant le parcours : la
fenêtre d'un geste qui sautait pendant qu'on tapait le nombre de jours (l'aperçu a sa place), et qu'un clic à côté
fermait avec le motif tapé ; la pastille de « À décider » qui ne se recomptait pas après un geste ; le mot de passe
marqué faux pour un membre sans code ; une phrase qui commençait par un nombre ; « : » seul en début de ligne ; un
tableau qui faisait déborder le téléphone ; des cibles de moins de 44 px ; les noms de l'équipe pris pour des textes
hors du catalogue dans le filtre du journal.

La deuxième partie, sur le même essai (douze entreprises, deux cabinets : l'un avec ses deux collaborateurs, un client
abonné, un dossier tenu et un mandat en attente, l'autre vide), en direction ; en clair et en sombre ; à 1440 et à 390.
Corrigé pendant le parcours : les onglets qui descendaient de 24 points d'un onglet à l'autre ; « 2 Personnes » et « 6
Pièces » (une majuscule derrière un nombre, sur la liste des clients aussi) ; au téléphone, le nom d'une échéance, cible
de 22 points ; la marge des cartes de liste comptée deux fois (36 points perdus de chaque côté, la liste des clients et
« À décider » compris) ; les mois du graphique d'une fiche qui se chevauchaient (un mois sur deux, le mois en cours
toujours nommé) ; un montant pris pour un texte du catalogue ; « Réessayer » sur une adresse qui ne mène à rien.

La troisième partie, sur `scripts/humain/exemple-service.ts` (un mois de mesures passées par la vraie collecte et la
vraie veille : une mise en ligne qui ralentit tout puis une coupure de 37 minutes, le retour à la version d'avant, une
sauvegarde ratée, une copie hors de la machine en retard, un disque qui se remplit ; `--calme` : les deux dernières
réglées), en direction ; sur chaque période ; en clair et en sombre ; à 1440 et à 390 ; à la souris et au
clavier. Corrigé pendant le parcours : les repères d'un axe éclaircis au plus pressé (« mer. 7 jeu. 8 ven. 9 », puis un
trou) ; la pastille des pannes qui sautait d'une période à l'autre, et la légende qui remontait à côté du titre sur
trente jours ; « cette heure-ci » à 0,0 au début de chaque heure ; les mises en ligne d'un même pas dites à l'envers, et
un retour dit comme une mise en ligne ; une sauvegarde ratée dont la copie se disait « arrivée hors de la machine » ;
une nuit datée de l'heure où sa copie a été vérifiée ; un pas mesuré seul qui ne se dessinait pas ; le cadre du clavier
posé sur les graduations ; « {p95} » écrit tel quel (une valeur nommée avec un chiffre ne se remplit jamais).

Les alertes (3c), sur le même essai rejoué avec `--suivre` (la veille continue minute par minute, et les gestes de la
console lui arrivent pour de vrai : la sourdine se lit, l'essai part), en direction, à la fenêtre réelle de 1432 points
et à 390 ; en sombre et en clair. Corrigé pendant le parcours : un refus de motif qui restait affiché une fois le motif
corrigé (sur la fiche d'un client et dans l'équipe aussi) ; la fin d'une sourdine dite à une minute près entre le
message et la chronologie (la fenêtre l'estimait, c'est le serveur qui la pose) ; deux boutons principaux à l'écran ; le
menu de la dernière règle coupé par le bas de la page, puis qui faisait sauter la page de 440 points en s'ouvrant (son
premier choix prenait le clavier en la faisant défiler) ; le tableau des règles qui débordait et cachait ses menus ; une
alerte devenue grave dite comme un simple rappel ; l'enjeu du disque redit dans « que faire » ; le nom de la règle redit
sous chaque alerte de son histoire filtrée ; les pilules de l'histoire qui glissaient de 90 points sous la souris quand
le filtre raccourcissait la liste au bas de la page ; au téléphone, les trois faits empilés sur 240 points et les
commandes cassées au milieu d'un chemin (« skanfact-↵hors-machine »).

Les réglages (C28), sur l'essai de la console, en direction puis en support ; un message écrit, remplacé puis retiré, et
regardé dans l'application d'une entreprise de l'essai ; en sombre ; à la souris et au clavier. Corrigé pendant le
parcours : le geste « reglages.message.ecrire » que la table du journal refusait (trois parties au lieu de deux : le
message ne s'écrivait jamais, l'écran disait « le serveur a rencontré une erreur » ; un test lit désormais chaque geste
des migrations, sa forme et son libellé) ; la phrase d'un refus qui tombait sous le bas d'une longue fenêtre (seul le
cadre rouge du champ se voyait) — dans **toutes** les fenêtres de la console, elle reste au-dessus des boutons et le
champ refusé s'arrête au-dessus d'elle ; « Pourquoi le retirer avant le {au} » écrit tel quel ; « 19:21:. » (un point
derrière les deux-points) ; « Aucun message n'a encore été affiché » sous un message affiché ; « affiché du 13 au 20 »
pour un message remplacé le 13 (la colonne dit « prévu ») ; une nouveauté et une maintenance de la même couleur chez le
client (la maquette les distingue) ; « Plus tard » qui faisait remonter la page sous le curseur (le second clic d'un
double clic tombait sur « + Nouvelle facture ») ; deux messages ou deux relectures du même instant rangés au hasard.

Les formats officiels (C28), sur le même essai (ses envois à la TTN, et six factures électroniques de deux entreprises
soumises), en direction ; en sombre puis en clair ; à 1440 et à 390. Corrigé pendant le parcours : le nom d'un format sur
trois lignes dans une colonne trop étroite ; « le dernier aujourd'hui, 19:25 » (la date s'accorde à ce qu'elle date : le
dernier écrit, la dernière signée, la dernière acceptée) ; « 20 » et « 000 » séparés en fin de ligne ; une phrase qui
disait le fichier écrit pour chaque facture (il l'est dès que la fiche de l'entreprise le permet) ; une pièce signée sans
envoi dite « signée avant l'envoi » (elle l'a été avant que l'envoi existe). Trouvé par la vérification avant l'envoi,
et corrigé : l'écran Équipe sans le libellé des deux droits des réglages — le tableau des droits ne s'affichait plus du
tout (un test relie désormais chaque droit du serveur à ses deux textes).

Ce qui s'ajoute à l'offre (C28, 14c, 1.10.0), sur le même essai, en direction : les six ajouts, ce que chaque offre en
comprend, leurs prix du 28/09/2026, et « la paie, achetée seule : 2 entreprises » (la Librairie Al Kitab et l'Atelier
Mejri, toutes deux en Essentiel) ; à 1440 et à 390. Corrigé pendant le parcours : « depuis le 28/09/2026 » coupé sur
deux lignes ; au téléphone, un tableau qui débordait (une fiche par ajout, comme les formats officiels), puis ses
chiffres alignés à droite sous des textes alignés à gauche.

La fin du service (3f), sur le même essai, en direction ; d'onglet en onglet à la souris ; en clair et en sombre ; à 1440
et à 390. L'instrument de la console vit désormais en un exemplaire (`tests/web/instrument-console.ts`) et mesure aussi
les incidents (un incident ouvert, ses huit fenêtres : un point, le compte rendu avec une suite, un autre incident, une
fiche réflexe, repousser une suite, relire un compte rendu, annoncer une maintenance) et les versions (un retour demandé,
un gel levé, leurs fenêtres), en langue factice comme en vrai. Corrigé : la barre d'onglets du service qui sautait à
chaque clic — le compte des alertes disparaissait pendant la lecture de la vue suivante puis revenait (les onglets qui
le suivent glissaient de 29 points, deux fois), et les vues sans période remontaient leurs onglets de deux points ; des
données prises pour des textes du catalogue (le titre d'un incident sous ses fenêtres, la page d'état de la veille, le
titre d'une tâche d'installation, le code, la valeur, la source et les relectures d'une règle commune — ces dernières
ne se voyaient que si un autre fichier de tests avait posé une règle : l'instrument pose maintenant la sienne).

Les paiements (C30), sur l'essai de la console (l'entreprise SkanFact désignée, trois factures d'abonnement : une réglée
par deux virements, une par Konnect prouvé, une corrigée par un avoir et qui doit encore, et un brouillon préparé), en
direction ; en clair et en sombre ; à 1440 et à 390 ; à la souris et au clavier ; un coût saisi, refusé d'abord sans sa
facture reçue, puis retiré. Corrigé pendant le parcours : une facture corrigée par un avoir dite « payée en partie », et
son échéance qui disparaissait ; « ce qui reste » affiché sans aucun coût saisi ; les règlements du mois dont les
colonnes se chevauchaient, puis dont les montants ne s'alignaient pas d'une ligne à l'autre ; le nom d'un coût sur trois
lignes dans la colonne de côté ; les boutons des mois qui bougeaient sous la souris (« ‹ Août », « ‹ Septembre ») ; « ce
mois-ci » et « le même chiffre que le tableau du matin » dits d'un mois passé ; « les coûts de octobre » (« d'octobre ») ;
le curseur posé sur le mois au lieu du nom du coût ; « un coût retiré » sans majuscule ni flèche.
