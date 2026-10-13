# La console de l'équipe SkanFact

*13/10/2026, Console 1 (le lot « les fonctions qui manquent », deuxième partie). Le cadrage fait foi :
`docs/cadrage/10-console.md` du dépôt `skanfact` (§ 1, § 2.1 à 2.4, § 2.8 pour une part, § 2.10, ses règles C1 à C3 et la
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
  actifs par offre, les entreprises en retard, en lecture seule ; les revenus du mois et le support disent « non mesuré »
  avec leur raison (les paiements viennent en 14b, le support ensuite) ; le service dit « non mesuré » sans veille ou
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

**C17. Clients, recalé sur sa maquette** (13/10/2026). Au-dessus de la liste, **cinq vues du métier**, chacune sa carte,
son compte et sa phrase (`serveur/console/clients.ts`, `dansLaVue` — la même fonction compte la carte et filtre la liste
qu'elle ouvre, C3) :
- **tout le portefeuille** ;
- **à appeler** : un essai qui finit dans la semaine sans une pièce émise, ou une grâce d'après l'essai sans offre
  choisie — quelqu'un qui n'a pas vu ce que l'application lui apporte : un appel, pas une relance ;
- **l'argent attendu** : une offre choisie, l'échéance passée, rien de payé (jamais la lecture seule : elle a sa puce) ;
- **les silencieux** : en essai ou abonnés, jamais ouverts ou pas depuis dix jours — comptés en **jours de Tunis** ;
- **tenus à convertir** : les dossiers qu'un cabinet tient pour son client, sans abonnement.

Une carte est un raccourci : elle ouvre toute sa liste (la puce d'état choisie avant s'efface), et les puces d'état
comptent ensuite cette vue-là. La vue et l'ordre vivent dans l'adresse (`#/clients?vue=a_appeler&tri=echeance`).
- **Deux colonnes de plus.** **Échéance** : le prochain jour où quelque chose change (la fin de l'essai, la fin de la
  période payée, le passage en lecture seule d'une grâce) et dans combien de jours ; ce qu'il change seulement quand la
  puce ne le dit pas (« lecture seule dans 5 jours », « résilié, fin dans 12 jours »). Une entreprise déjà en lecture
  seule n'en a plus : la colonne État dit depuis quand, et **la date ne s'écrit qu'une fois** (la colonne État ne redit
  plus l'échéance ; la raison d'un « hors abonnement » est dans la colonne Abonnement). **Par an, HT** : ce qu'un
  abonnement rapporte au prix du jour (un mensuel compte douze mois) ; une offre choisie pas encore payée se lit en gris,
  « quand ce sera payé » ; sans offre ou sans prix du jour, « — », jamais un montant deviné.
- **La ligne de compte** au-dessus du tableau : combien d'entreprises la liste montre, et ce que rapportent par an les
  abonnements actifs de la sélection (ce qui est attendu n'y entre pas : il n'est pas encore payé). Le pied ne garde
  que de quoi tourner les pages.
- **Le tri** : le plus urgent d'abord (par défaut), l'échéance la plus proche, ce qui rapporte le plus, le nom, le plus
  récemment ouvert. À égalité, l'urgence départage ; ce qui n'a pas de valeur (pas d'échéance, rien par an, jamais
  ouvert) reste en bas.
- **Huit colonnes tiennent dans le cadre** à 1440 et à 1280 points : sur un portable, « Ouvrir » ne garde que sa flèche
  (son nom reste lu), et les cinq cartes restent sur une rangée.
- **Pas encore** : la sixième carte de la maquette (« venus par un cabinet », la remise de parrainage) attend que le
  parrainage existe dans les faits de l'abonnement ; l'export de la sélection, le menu « … » d'une ligne et les filtres
  par type, offre et cabinet ne sont pas écrits.

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
fait depuis l'écran « Équipe ». La console s'ouvre à `https://<le serveur>/console/`.

## Décidé par délégation (13/10/2026)

- **Le code du téléphone à chaque connexion**, même sur un appareil reconnu : le cadrage demandait le code ET un appareil
  reconnu ; un poste reconnu ne dispense de rien ici.
- **Une session : une heure sans geste, douze heures au plus.**
- **À qui n'est pas de l'équipe, la réponse d'un mot de passe faux.**
- **Le support prolonge un essai de 7 à 30 jours, une fois par entreprise** ; une seconde prolongation, et tout le reste,
  sont à la direction. « Offrir un mois » (un avoir sur la prochaine facture, 10 § 2.4) attend nos factures (14b).
- **L'adresse : `/console/` du même serveur** pour l'instant ; `console.skanfact.tn` viendra par le frontal.
- **« Inscriptions » compte les sept derniers jours, aujourd'hui compris**, et ouvre la liste avec ce filtre.
- **Une fenêtre ne se ferme pas d'un clic à côté.**
- **La console n'est pas l'API des partenaires** : ses routes n'entrent pas dans la documentation de l'API.
- **Les montants des échéances sont hors taxes, au prix du jour** : la TVA et le timbre de nos factures viennent avec
  elles (14b). Aucune remise n'existe encore.
- **« À venir » couvre trente jours, aujourd'hui compris** ; la carte d'arrivée est la sienne.
- **Une relance d'une échéance passée ne compte plus** après une prolongation ou un paiement.

## À DÉCIDER (Skander)

- **Qui entre dans l'équipe, et avec quel rôle.** Le premier membre se pose sur le serveur des pilotes par l'outil, en
  root : jamais par Claude.
- **`console.skanfact.tn`** : le nom à créer dans le DNS, puis le frontal le branche.
- **Un second destinataire des alertes** : une seule adresse et un seul numéro sont prévenus ; s'ils ne répondent pas,
  personne d'autre ne le saura. L'écran des alertes le dit ; le second se règle sur le serveur (`exploitation/alertes.sh`).

## Ce que le lot ne fait pas

La suite de la console : les paiements et nos factures (14b), le support, la suite du service (ses sauvegardes, sa file
de travaux, ses incidents et la page d'état, sa sécurité, ses versions), la
mesure, les réglages de la plateforme, l'application de bureau (les licences de la v10), l'accès accordé par un client
(48 heures, en lecture), et le filtre du journal par geste et par période. Le service ne se voit encore que du serveur
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
