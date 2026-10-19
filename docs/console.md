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
- ~~Pas encore~~ : les codes de secours, les appareils reconnus et les gestes des trente derniers jours sont venus avec
  0114 (C37) ; les invitations en attente avec 0118 (C41).

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
sudo bash /opt/skanfact/depot/exploitation/equipe.sh urgence <adresse> "<motif>"
```

Chaque geste de l'outil demande son motif et laisse sa ligne au journal (sans auteur : l'exploitation). L'outil sert à
poser le premier membre, et à rendre la direction à quelqu'un si plus personne ne peut se connecter (« urgence » :
un nouveau code à poser, vingt-quatre heures, une fois, C59) ; ensuite, tout se
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
  Depuis : le nouveau prix se prépare dans Réglages (1.12.0), les remises aussi (1.15.0), les nouveautés s'allument
  (1.27.0, C43) ; les offres de fondateur sont abandonnées (Skander, 14/10/2026).

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

**C32. La liste des clients, sans écart avec sa maquette** (14/10/2026 ; base 0110 ; la maquette Clients, comparée
pleine page à la console). Le premier des lots qui ramènent chaque écran déjà fait à zéro écart avec sa maquette (les
suivants : le numéro de client, la ville et une ligne par organisation — groupes, cabinets ; la fiche ; nos échanges ;
les gestes qui manquent ; la procédure de reprise).
- **L'en-tête** dit ce qu'est une ligne, et porte **« Exporter la sélection… »** en haut à droite (la direction seule).
- **Les filtres** sous les puces d'état : la recherche (nom, matricule, contact, e-mail, groupe, cabinet), le type
  (entreprises seules, groupes, dossiers tenus), l'offre (Essentiel, Complet, pas d'offre), le cabinet qui la suit
  (celui qui tient son dossier, sinon celui par qui elle est venue). **Chaque option dit son compte, compté sur ce que
  les deux autres filtres laissent, par la fonction qui filtre** (C3) ; « Effacer les filtres » défait tout d'un geste ;
  l'adresse garde la sélection. Une vue qui demande un mot de plus (silencieux, tenus à convertir) le dit sous les
  filtres.
- **Une ligne dit sa date une seule fois** (Skander, les répétitions retirées des maquettes) : la colonne Échéance porte
  le jour et « dans 3 j », en orange à trois jours ou moins, ou « — en lecture seule », « — sans échéance » ; sous la puce
  d'état, **ce qui arrive ce jour-là** : la fin de l'essai (« n'a encore rien fait » quand il est à appeler, par la
  fonction de la carte), « 47,410 DT à payer » quand sa facture attend, « passe en lecture seule · aucune offre
  choisie », le renouvellement du mois ou de l'année, « depuis le… · essai fini sans offre ». La colonne Abonnement dit
  l'offre et ce qui la précise (« Essai, 30 jours · tout ouvert », « prolongé de 14 jours », « Essai · Essentiel
  choisi · au mois, dès la fin de l'essai », « Pas abonné · tenu par… »), et la remise de sa prochaine période en
  étiquette (jamais sur ce qui n'a pas de période). La durée d'un essai est celle qu'il avait **en commençant** (son
  premier événement), jamais recalculée d'une règle d'aujourd'hui.
- **« Usage d'octobre »** : les pièces émises du mois (au jour de l'entreprise, comme sa fiche), en orange quand il n'y
  en a aucune ; un dossier tenu dit « tenu par le cabinet ». Le tri « usage » trie par ce compte, l'export aussi.
  **« Vu »** en orange pour un client silencieux (la fonction de la carte).
- Ce que la liste dit en plus de chaque ligne se lit **en un passage pour toute la liste**
  (`plateforme.console_clients_en_plus`, jamais une lecture par ligne) : les pièces du mois, la durée de l'essai et ce
  qui l'a prolongé, et **la facture qui attend** (la plus ancienne préparée et pas encore réglée, son reste par la règle
  de toutes les factures). Un essai dont la facture attend est dans **« l'argent attendu »**, plus « à appeler ».
- **Le menu « … »** de chaque ligne (un nom et sa phrase, sans icône, comme la maquette) : « Pointer son paiement »
  quand une facture attend (il ouvre Paiements), puis **les gestes que sa fiche proposerait, par la même règle**
  (`gestesDisponibles`, sur la ligne d'abonnement que ses faits décrivent) — prolonger l'essai, réactiver, annuler la
  résiliation, et les gestes de C34 ; puis, après un trait, nos échanges (« Noter un appel… », « Écrire au contact… »,
  C33) ; après un trait et en rouge, ce qui détruit (passer en lecture seule, résilier, retirer l'abonnement offert) — et
  « Demander l'accès au dossier… ». **Chaque geste a le même nom partout** (le menu de la liste, celui de la fiche, le
  titre et le bouton de sa fenêtre : « Prolonger la grâce… », « Réactiver… »). Le menu se parcourt **au clavier comme sur
  le Mac** : il prend le clavier en s'ouvrant, les flèches passent d'un choix à l'autre, Début et Fin vont aux bouts,
  Échap rend le clavier au bouton ; la souris et le clavier partagent une seule sélection. Payer, offrir, un module restent sur la fiche, où se lit ce qu'ils
  changent. **Un geste ouvre la fenêtre de la fiche SUR la liste** (rien ne fait perdre sa place), sur la fiche relue à
  cet instant : la ligne d'abonnement lue part avec le geste (01 R15). **Chaque fenêtre qui touche un client le nomme
  au-dessus de son titre** (« LIBRAIRIE AL KITAB · E-0005 ») : ouverte d'une liste ou d'un groupe, elle ne laisse pas
  deviner sur quelle société le geste tombera. Au support, le menu de la liste et celui de la fiche disent **la même
  phrase** de ce qui revient à la direction.
- **La première carte** se dit « Tout le portefeuille » sans recherche ni filtre, **« Toute la sélection »** avec : les
  cartes comptent la recherche et les filtres (C3), son nom ne dit pas le contraire.
- **Exporter la sélection** : la direction seule, avec son motif ; le fichier est **la liste telle qu'elle est filtrée,
  toutes ses pages** (la même fonction que l'écran : ce qui s'exporte est ce qui se voit), pour un tableur (le
  point-virgule et la virgule décimale), téléchargé sur l'ordinateur — il ne part nulle part. Le journal garde le motif,
  le nombre de lignes et les filtres, **jamais les lignes** (`plateforme.console_noter_export`).
- **Les pages** : « Page 1 sur 6 », 25 par page (50, 100 au choix), « Précédente », les numéros (la première, la
  dernière, celles autour), « Suivante ». La note sous la carte dit ce que compte « Par an, HT » ; la TVA et le timbre
  restent **À VÉRIFIER**.
- **Ce que la maquette dit et que la console ne reprend pas** : les places de fondateur (abandonnées le 14/10/2026) ;
  le prorata d'un changement d'offre (C34) ; « Place occupée », « SMS envoyés », « Documents lus », « Appels à l'API » et
  les intégrations allumées de la fiche, dits **« pas encore mesuré »** (C2) tant que rien ne les mesure.

**C33. Qui est le client, et nos échanges avec lui** (14/10/2026 ; base 0110 ; les maquettes Clients et Fiche).
- **Un numéro de client**, donné à la création et jamais repris : E-0001 pour une entreprise, G-01 pour un groupe de la
  console, C-0001 pour un cabinet (`plateforme.numero_client`, une suite par sorte ; les entreprises d'exemple n'en ont
  pas). On se le dit au téléphone ; la recherche le trouve.
- **La ville**, facultative, se dit à la création de l'entreprise (« Ton entreprise » : « facultative : là où est ton
  entreprise ») ; la console la montre, **rien ne la devine** d'une adresse écrite librement (`socle.entreprise.ville`,
  `socle.poser_ville` : la propriétaire ou un administrateur, sans balise, 2 à 60 caractères). **La changer ensuite,
  depuis Paramètres, reste à faire** ; et l'étape suivante (« Où te joindre ? ») redemande l'adresse « puis code postal
  et ville » : la ville se tape deux fois (**À DÉCIDER** avec Skander : la garder ainsi, ou la tirer de l'adresse).
- **Une ligne par organisation** (`serveur/console/organisations.ts`, pur) : une entreprise seule, **un groupe** (ses
  sociétés ensemble, la plus urgente d'abord par l'urgence de la liste ; la ligne prend son état, dit « Essentiel +
  Complet », la remise de groupe, et son menu porte les gestes de chaque société, nommée), un dossier qu'un cabinet tient
  sans abonnement, **un cabinet** (ses dossiers, ses collaborateurs ; dans « tout » seulement). Les vues, les puces, les
  filtres et leurs comptes portent sur des lignes, par la fonction qui filtre (C3) ; une vue garde une ligne quand une de
  ses sociétés y est. L'export, lui, garde une ligne par entreprise (avec son numéro, sa ville et son groupe).
- **La fiche d'un groupe** (`#/clients/groupe/<id>`, `GET /console/groupes/:id`) : ses sociétés côte à côte, chacune
  comme la liste la dit et menant à **sa** fiche (chacune garde son abonnement, sa facture, son journal) ; ce que le
  groupe rapporte par an, ses pièces du mois, ses membres ; à qui parler ; « Gestes ▾ », le menu de ses sociétés,
  **chacune en tête de ses gestes** (une section par société, jamais « (Société) » répété sur chaque ligne). La fiche
  d'une de ses sociétés dit « Dans le groupe Famille Kitab » (un lien) et son fil passe par le groupe.
- **Plus de liste des cabinets à part** : un cabinet est une ligne de la liste des clients (sa maquette) ;
  `#/cabinets` mène à `#/clients?type=cabinets`, et la fiche d'un cabinet revient à « Clients ».
- **La fiche** suit la maquette : l'en-tête dit l'organisation, la ville, l'inscription et la propriétaire ; les onglets
  « Aperçu », « Abonnement », « Factures et paiements », « Support et échanges », « Membres », « Journal » ; « Son
  entreprise » (numéro et matricule, l'offre, ce qui va se passer, l'offre suivante, le délai accordé, l'essai prolongé,
  ses modules, établissements, caisses, salariés) ; **huit comptes** (pièces émises du mois et du mois d'avant, membres,
  salariés, caisses · établissements ; SMS, place occupée, documents lus, appels à l'API : « pas encore mesuré ») ;
  « À qui parler » avec **le téléphone vérifié de la propriétaire** (celui de ses codes de connexion, jamais un autre) ;
  le cabinet et son parrainage ; « Son dossier, avec son accord ».
- **Noter un appel** (la direction et le support, depuis la fiche ou le menu d'une ligne) : comment il s'est passé (on
  s'est parlé, pas de réponse, message laissé) et, quand on s'est parlé, ce qui s'est dit en deux lignes. La note se range
  dans « Nos échanges » ; **elle ne part jamais chez le client** et **ne se modifie ni ne s'efface** (on en écrit une
  autre). Le journal dit comment l'appel s'est passé, jamais ce qui s'est dit. « Dernier échange : … » à « À qui parler ».
- **Écrire au contact** : le message **s'ouvre dans l'application** de la personne choisie (la propriétaire d'abord),
  comme une demande au support que SkanFact commence (canal « skanfact ») ; l'alerte par e-mail la prévient **sans le
  texte** ; sa réponse revient dans le Support. L'objet et le début se proposent selon où en est son abonnement (essai,
  retard, lecture seule) : un brouillon qu'on relit. Le journal garde l'objet, jamais le texte.

**C34. Les gestes qui manquaient** (14/10/2026 ; base 0111 ; `serveur/abonnement/gestes.ts`, la règle en un seul endroit ;
la direction seule).
- **Accorder un délai** (« Prolonger la grâce… » pendant la grâce, « Réactiver… » en lecture seule après un essai ou une
  échéance manquée) : de 1 à 60 jours ; la lecture seule recule jusqu'au lendemain du dernier jour. **Le délai ne vaut que
  pour SON échéance** : payée, elle change, et il s'éteint ; il ne raccourcit jamais une grâce. Ni une suspension ni une
  résiliation (elles ont leur geste).
- **Offrir un mois** : remplacé en 1.20.0 (C36 ; `docs/abonnement.md` C18) — il va sur la prochaine facture, et le
  support l'offre aussi.
- **Changer d'offre** : **à la prochaine échéance** ; la période payée va au bout avec l'offre payée, rien n'est
  refacturé avant ; choisir l'offre qui court efface un changement prévu. Le prorata immédiat de la maquette (une facture
  ou un avoir tout de suite) **n'est pas fait** : sa règle fiscale est **À VÉRIFIER**.
- Chaque geste montre l'état d'après avant d'être fait, demande son motif, entre au journal et dans l'histoire de
  l'abonnement (« délai accordé », « mois offert », « offre changée »).

**C35. La procédure de reprise d'une entreprise** (14/10/2026 ; base 0112 ; `web/console/src/ecrans/Reprise.tsx` ; la
maquette Fiche, « Plus rare : la procédure de reprise »). Quand la propriétaire n'est plus joignable (départ, décès,
cession, conflit d'associés), l'entreprise change de propriétaire **sur pièces, jamais sur un simple appel**. La
direction seule, en trois temps :
1. **Ouvrir** : la cause, le repreneur (son nom, l'adresse de son compte SkanFact), le motif. La propriétaire actuelle est
   **prévenue dans son application** (une demande que SkanFact commence ; l'e-mail d'alerte ne porte pas le texte) et a
   **quinze jours pour s'y opposer** (**À VÉRIFIER** : le délai) ; la date limite est celle que la base pose.
2. **Les pièces** : l'acte de décès ou de cession, le registre du commerce, la pièce d'identité du repreneur. On note
   qu'elles sont **vues, par qui et quand — jamais les fichiers**. Une opposition reçue se note (avec son motif) et
   **clôt** la procédure ; la direction peut aussi la clore sans reprise.
3. **Confirmer** : **l'autre membre de la direction**, jamais celui qui l'a ouverte, une fois les trois pièces vues et le
   délai passé, le repreneur ayant son compte à cette adresse. Le repreneur devient propriétaire ; **l'ancienne
   propriétaire quitte l'équipe** (**À VÉRIFIER** selon la cause : une cession, un décès, un conflit). **Rien du dossier
   ne bouge** : ni pièce, ni écriture. Le changement entre au journal de la console **et à celui de l'entreprise**.
La carte de la fiche dit à chaque instant ce qui manque encore : une liste « Avant de confirmer » qui se coche (les
pièces, n sur 3 ; le délai ; le compte du repreneur ; un autre membre de la direction), le bouton qui débloque à côté de
chaque pièce, et « Confirmer la reprise » en vert seulement quand tout est coché ; une procédure à la fois. Sans
procédure, la carte « Plus rare » attend dans la colonne de droite ; une procédure en cours vient sous « Son entreprise ».
Les choix d'une fenêtre (la cause d'une reprise, comment s'est passé un appel) sont des pastilles qui se cochent **comme
des boutons radio** : la touche Tab entre sur la cochée, les flèches cochent la voisine.

**C36. L'argent juste, dans la console** (1.20.0 ; base 0113 ; `docs/abonnement.md` C18 ; l'audit du 14/10/2026).
- **Offrir un mois** : la direction **et le support** (geste `console.abonnement.offrir_mois`), un par entreprise sur
  douze mois pour le support ; la fenêtre dit la période que la prochaine facture couvrira, la fiche « un mois de plus
  offert » à côté de sa prochaine facture. Un second ne se propose pas tant que le premier attend.
- **Noter un paiement reçu** (la direction) : l'offre, la périodicité, puis **la preuve** — le n° de la facture faite
  ailleurs, le montant reçu (en dinars, toutes taxes comprises), le moyen, le jour — et le motif ; un refus nomme sa case,
  de haut en bas. **Paiements** compte ces paiements dans l'encaissé de leur jour et les liste dans « Reçus hors de la
  plateforme » (qui l'a noté) ; la phrase de l'encaissé dit « règlements reçus », plus « notés sur nos factures ».
- **Les modules** : « Retirer un module acheté » pendant une période payée dit jusqu'à quand il reste ouvert et la fiche
  le rappelle ; « Ouvrir un module » propose de rouvrir celui qui allait partir (le retrait s'annule) ; un module qui
  part déjà ne se retire pas deux fois. La confirmation dit ce qui s'est passé, pas « module retiré » quand il reste.
- **Une fenêtre dont le geste ne change rien aujourd'hui** (un mois offert, un module, une offre à l'échéance) montre une
  seule colonne, « aujourd'hui, et après le geste », et dessous ce qu'il fait ; jamais deux colonnes pareilles.
- **Le renouvellement** se lit partout au même chiffre (la règle de la facture) : « par an » dans la liste, le montant
  des échéances (« hors taxes, sa prochaine facture », et « en Complet, au mois » quand l'offre choisie pour l'échéance
  n'est pas celle qui court), « Ce qui revient chaque année », « Prochaine facture : … » sur la fiche.
- **« À décider » dit l'argent qui attend** (la direction seule, par les fonctions de Paiements) : une de nos factures
  **payée, puis défaite** — sa cause dit le geste : son règlement retiré (relancer le paiement, ou retirer la période) ;
  un avoir qui l'annule en entier (retirer la période, ou faire une nouvelle facture), et, payée quand même, la somme à
  rendre dans la même ligne (rembourser et retirer la période, ou garder la somme pour une nouvelle facture : un seul
  événement, une seule ligne, jamais une seconde pour son trop-perçu) ; une facture préparée qui **attend d'être émise**
  depuis deux jours ou plus ; un **trop-perçu** (le rembourser, ou garder la somme pour la prochaine facture). Chaque
  ligne s'ouvre sur l'écran qui la règle (la facture dans SkanFact, la fiche, Paiements) ; la fiche d'un client montre
  les siennes dans « Ce qui attend ». Paiements montre aussi « Payées, puis défaites », chacune avec sa cause.
- **Un avoir qui reprend tout sauf le timbre** (un avoir de SkanFact ne coche pas le timbre fiscal d'office) : en 1.20.0,
  la facture se lisait « payée, avec un trop-perçu » ; depuis 1.21.0, elle est défaite (C37). Le timbre d'un avoir reste
  **À VÉRIFIER** avec le comptable ; la règle du moteur (`moteur/reglements.ts`, ce que le client doit) ne change pas.
- **Un paiement reçu hors de la plateforme est à l'entreprise SkanFact du jour** (sa preuve la nomme) : l'encaissé d'une
  autre entreprise SkanFact (un autre essai de la même base) ne le compte pas.
- Ce que 1.20.0 ne fait pas : « Ton abonnement » du client ne dit pas encore le mois offert qui l'attend (sa prochaine
  facture le dira) ; les factures refusées par la TTN restent dans « Nos factures » (C31), pas dans « À décider ».

**C37. Des chiffres et des accès justes** (1.21.0 ; base 0114 ; l'audit du 14/10/2026, deuxième partie ; décidé par
délégation le 15/10/2026 — Skander : « faut faire tout ce qui manque »).
- **« A servi » n'a qu'une définition** (`plateforme.pieces_creees`, `aServi`) : une pièce créée dans l'entreprise — un
  devis, une facture, un achat de son dossier, ou une pièce que le serveur ou l'API ont faite sans pièce du dossier (une
  vente, un ticket, un achat). « À appeler », « n'a encore rien créé » (À décider) et les comptes de la fiche la lisent.
  La colonne « usage » de la liste reste ce qu'elle dit : les pièces **émises** du mois.
- **La dernière activité se compte par entreprise** (`socle.activite`, `serveur/activite.ts`) : le serveur note, après
  une requête acceptée sur une route de l'entreprise, au plus une fois toutes les cinq minutes, la personne,
  l'entreprise et l'instant — ni la page, ni le geste, ni l'adresse (10 § 4, ligne des membres, mise à jour). Avant, une
  entreprise prenait l'activité de ses membres ailleurs : le comptable qui tient dix dossiers les rendait tous « vus
  aujourd'hui ». La fiche dit, pour chaque membre, sa dernière connexion et son dernier geste **ici** ; son pied, la
  dernière activité de l'entreprise. Ce qui existait se reprend du dossier (le dernier changement de chacun). « Les
  silencieux » : personne n'y a travaillé depuis dix jours ; jamais ouverte, les dix jours partent de l'inscription.
- **La technique ne reçoit aucun identifiant de client** dans les travaux du service : la ligne dit « un client (son nom
  est à la direction) » et la clé courte de l'envoi.
- **Une relecture automatique ne prolonge pas la session** : une requête partie plus de dix secondes après le dernier
  geste humain (un clic, une touche, la molette, un doigt, le retour sur l'onglet) le dit (`x-console-auto`), et la base
  lit la session sans repousser son heure d'inaction. Un écran laissé ouvert qui se relit seul ne garde plus la console
  ouverte.
- **Fermer une session, oublier un appareil** (l'Équipe, « Ses appareils et ses sessions ») : la direction pour chacun,
  chacun pour lui-même, avec son motif, au journal (`equipe.session_fermee`, `equipe.appareil_oublie`). Fermer une
  session renvoie la personne à la connexion ; oublier un appareil le retire (toutes ses sessions, de la console comme
  de l'application, se ferment ; il repart de zéro, le code compris). La personne reste dans l'équipe. La liste des
  membres dit aussi ses codes de secours qui restent, ses appareils reconnus et ses gestes des trente jours.
- **Les demandes closes du support se lisent par pages de cinquante**, toutes comptées (« 51 à 100 sur 340 ») ; plus de
  limite à cent.
- **Le journal, exploitable** (la maquette Journal) : quatre chiffres sur trente jours — les gestes de l'équipe, ceux
  **réservés à la direction** (un geste dont le geste de la console n'est ouvert qu'à elle, lu dans la liste des gestes,
  jamais recopié), les accès aux dossiers ouverts en ce moment, ce que **le système a fait seul** (les relances parties,
  les paiements reconnus par le prestataire) — chacun ouvre la liste qu'il compte. Filtres : un mot (le motif, le client,
  la personne), la sorte de geste, la période (aujourd'hui, 7 jours, 30 jours, tout), qui, « seulement les réservés »,
  « montrer le système ». Un second onglet, **les accès aux dossiers** : chacun, son état, qui l'a demandé et pourquoi,
  qui l'a accordé, chaque page lue, « Fermer maintenant… ». **Exporter la sélection…** (la direction, avec son motif,
  cinq mille lignes au plus ; l'export entre au journal à son tour). **Le support lit le journal** : ses propres gestes et
  ses accès, jamais ceux des autres (la base le tient).
- **Ce qui reste du mois se dit provisoire** (Paiements) tant que le mois court, ou qu'un coût saisi le mois d'avant ne
  l'est pas encore (il est nommé).
- **Une de nos factures que ses avoirs annulent, timbre mis à part, est défaite** : « À décider » le dit en une ligne avec
  la somme à rendre, Paiements la range dans « Payées, puis défaites » et son trop-perçu « annulée par ses avoirs ». Le
  timbre d'un avoir reste **À VÉRIFIER** avec le comptable ; la règle du moteur (ce que le client doit encore) ne change
  pas.
- **La tuile « Inscriptions » compte les lignes de la liste qu'elle ouvre** (un groupe de deux sociétés nouvelles fait
  une ligne), par la fonction de la liste.

**C38. Le support et les travaux suivis** (1.22.0 ; base 0115 ; l'audit du 14/10/2026, troisième partie : F13, F18, F19,
F21 ; décidé par délégation le 15/10/2026 — Skander : « faut faire tout ce qui manque »).
- **Une demande a quelqu'un qui la suit** (F13). La première réponse la donne à qui l'écrit (comme avant) ; on la
  **prend** ou on la **confie** à un membre qui répond au support (la direction ou le support, jamais la technique, qui ne
  lit aucun client), avec son motif, au journal (`support.confiee`). Répondre à une demande qu'un autre suit reste
  possible : l'avertissement se lit au-dessus du champ, avant d'écrire. « À moi » filtre les ouvertes que je suis.
- **Une priorité** : normale (une réponse dans les vingt-quatre heures) ou **urgente** (dans les **deux** heures ;
  `SANS_REPONSE_HEURES_URGENTE`, **À VÉRIFIER** avec Skander avant de l'écrire sur le site). Une urgente passe en tête des
  demandes à répondre ; sans réponse au-delà de son délai, elle remonte à l'accueil comme les autres
  (`support.priorite`). Le client ne voit pas la priorité.
- **L'attente de la technique**, avec son motif (ce que la technique doit faire) : la demande quitte les demandes à
  répondre (l'accueil ne la compte plus) ; si le client réécrit, elle revient à nous ; « la technique a répondu » la
  rend au support (`support.technique`, `support.technique_levee`). Le motif se garde sur la demande.
- **Reprendre un envoi arrêté sur une panne** (F18 ; Travaux, « Reprendre maintenant… », la direction et la technique,
  avec son motif) : il repart au prochain tour du facteur, ses essais restent comptés, et le facteur demande d'abord à
  la TTN si elle a déjà la pièce (jamais deux dépôts). La base refuse un envoi fini (accepté, refusé : un refus se
  corrige chez l'entreprise), retenu par son compte El Fatoora, pris par un tour en ce moment, ou qui repart déjà
  (`service.envoi_repris`). Un refus ou un compte retenu : **« Prévenir l'entreprise… »** (la direction, l'e-mail de la
  fiche). Jamais « réessayer » un refus.
- **Les e-mails laissent une trace** (F19) : l'instant, et s'ils sont partis ou si le relais les a refusés — ni
  l'adresse, ni l'objet, ni l'entreprise (`plateforme.courriel_trace`, trente jours). Travaux les montre comme les autres
  partenaires, quatorze jours. La TEJ et la CNSS restent « pas encore branchées » : rien ne part du serveur.
- **Les chaînes d'empreintes se relisent seules** (F21 ; 01 R9) : un tour du serveur, chaque heure, relit deux cents
  chaînes, les moins récemment relues d'abord (`plateforme.relire_chaines`, `socle.verifier_chaine` — le même contrôle
  que la porte d'une personne) : chaque maillon suit le précédent, chaque empreinte se recalcule, la fin de la chaîne
  est là. Chaque chaîne garde son dernier contrôle **et son point de rupture** ; chaque relecture se compte
  (`plateforme.releve_chaines`). Service › Sécurité le montre : l'état, les chaînes et les maillons, ce qui n'a jamais
  été relu, trente jours en cases, chaque chaîne cassée (sa sorte, où elle casse ; l'entreprise pour la direction). **La
  veille** en fait une règle branchée (la brique « chaînes ») : une chaîne cassée, alerte grave ; la relecture arrêtée
  depuis vingt-six heures, alerte. **Pas encore mesuré** (l'écran le dit) : le contenu de chaque pièce recomparé à son
  empreinte (`serveur/journal.ts`, `controler`, qui demande au module de relire sa pièce). La caisse hors ligne contrôle
  chaque ticket à son arrivée ; le journal de la console ne se modifie pas (la base le refuse) mais n'est pas chaîné.
  Combien de chaînes un lot peut relire en une heure : **À VÉRIFIER** à la mesure de charge.

**C39. La mesure** (1.23.0 ; base 0116 ; la maquette « Mesure » ; 10-console § 2.9 ; décidé par délégation le 15/10/2026 —
Skander : « fait comme la maquette pour l'instant et note en non mesuré ce qu'on arrive pas à mesurer encore »).
- **L'écran de la maquette, entier**, sous « La plateforme » entre Service et Réglages, **pour la direction seule** (un
  taux de transformation et des départs sont les comptes de SkanFact, comme les paiements). Rien n'y est nommé : le
  serveur rend des comptes par offre, jamais un nom ni un identifiant d'entreprise.
- **Ce qui a ses chiffres** — ce que la base sait déjà, sans rien envoyer de nouveau :
  - **l'entonnoir** des essais dont le dernier jour est passé ces trente jours (hier compris, aujourd'hui non) : ceux qui
    ont émis une pièce, ceux qui en ont dix (`PIECES_HABITUDE`, le signe d'une habitude : **À VÉRIFIER** avec les
    pilotes), ceux qui ont un abonnement payé, par offre et par périodicité ;
  - **les inscriptions** de la période choisie (cette semaine depuis lundi, ce mois-ci, trente jours) contre la période
    d'avant, de même longueur ; des entreprises, pas des lignes de la liste des clients (la tuile du matin compte, elle,
    les lignes : un groupe y fait une ligne) ;
  - **les départs** : les résiliations depuis la première inscription, les abonnements non renouvelés (en lecture seule) ;
  - **par offre** : combien d'entreprises, la **médiane** des pièces émises en trente jours et des membres ; pour
    Essentiel, la part qui a acheté la paie ou la comptabilité complète en plus ;
  - **ce qu'on promet** : le support dans son délai (vingt-quatre heures, deux pour une urgente : C38), mois par mois
    (le mois d'avant et celui-ci) — une demande compte quand sa réponse arrive ou quand son délai passe sans elle ;
    les urgentes depuis l'ouverture ; la demande qui attend le plus, quand elle a passé son délai. Les deux promesses
    sont **« Proposé »** : rien n'est écrit au client tant que Skander ne les a pas validées.
  Toutes ne sont **ni une donnée de plus ni un envoi** : ce sont les comptes que la fiche d'un client montre déjà (les
  pièces émises, les membres, l'abonnement) et les demandes du support.
- **Pas encore mesuré** (l'écran le dit, jamais un zéro) : les écrans qui servent, où l'on s'arrête dans un parcours,
  les refus qui reviennent, le motif d'un départ (l'application ne le demande pas encore), la satisfaction des
  fondateurs (la question n'est pas écrite), et l'accord des entreprises. Tous demanderaient des **événements envoyés
  par l'application** ; leur liste — les quatorze de la maquette — est montrée **proposée, à décider** : **À DÉCIDER
  par Skander** (règle du projet : jamais une donnée de plus vers un serveur sans liste comptée et décidée). Aucun
  événement n'est envoyé.

**C40. Ton compte** (1.24.0 ; base 0117 ; la maquette « Équipe », la vue du support ; 10-console § 2.10 ; décidé par
délégation le 15/10/2026, dans « faut faire tout ce qui manque »).
- **Chaque membre lit son propre compte**, quel que soit son rôle. Le support et la technique qui ouvrent « Équipe »
  arrivent dessus (l'équipe et ses rôles restent à la direction) ; la direction y vient par « Ton compte », en tête de
  l'équipe, et revient par « L'équipe ». Jamais le compte d'un autre.
- **Ce qu'il montre** : le rôle (« donné par la direction »), le code (l'application, ou le SMS au numéro **masqué** :
  le serveur le masque avant l'écran), les codes de secours qui restent sur dix, le jour où le mot de passe a changé
  (le journal du compte, sinon le jour où le compte est né), depuis quand la personne est dans l'équipe ; ses appareils
  **dans la page** (les trois plus récents, les autres d'un clic : celui de cette session d'abord), avec les gestes de
  0114 (fermer une session, oublier un appareil, avec un motif) ; ses six derniers gestes et leur nombre sur trente
  jours ; ce que son rôle ouvre, lu dans la liste des gestes du serveur, avec ses nuances (une coche, ou la limite en
  orange). Jamais un secret, un code, un mot de passe ni le numéro entier.
- **Trois gestes, par les mêmes étapes que dans l'application** (`serveur/compte.ts`) — un membre de l'équipe n'a pas
  toujours une entreprise où les faire :
  - **changer son mot de passe** : l'actuel le prouve, la règle du serveur s'applique (dix caractères, pas un mot de
    passe volé) ; ses autres sessions se ferment, **dans la console comme dans l'application** ; celle-ci reste ;
  - **changer de code** (une application ou un SMS, jamais l'e-mail pour l'équipe) : le code actuel le prouve (celui de
    l'application, un code reçu par SMS, ou un code de secours) ; le nouveau se **prépare** (rien ne change), puis
    s'**active** par son premier code juste ; alors seulement l'ancien s'arrête, et dix nouveaux codes de secours se
    montrent une fois ;
  - **refaire ses codes de secours** : le code actuel d'abord ; les dix nouveaux se montrent une fois, les anciens ne
    marchent plus.
  Chacun entre **au journal de l'équipe** (`equipe.mon_mot_de_passe`, `equipe.mon_code` avec la méthode lue dans le
  compte, `equipe.mes_codes_secours`), sans secret. Son rôle, c'est la direction qui le change ; son code, **personne
  d'autre que lui** : on ne le réinitialise pas à sa place (la maquette).
- **Pas fait** : l'alerte de la maquette « 3 codes faux, depuis un appareil inconnu » (« Ce n'était pas moi / C'était
  moi ») — les refus de connexion se lisent dans Service · Sécurité ; les envoyer à la personne elle-même reste à faire.

**C41. Inviter quelqu'un dans l'équipe** (1.25.0 ; base 0118 ; la maquette « Équipe » ; 10-console § 2.10 ; décidé par
délégation le 15/10/2026). Jusqu'ici, la direction n'ajoutait qu'un compte SkanFact déjà créé dans l'application, et la
console ne s'ouvrait pas tant que le code du téléphone n'y était pas posé — ce qui se faisait dans l'application, où un
membre de l'équipe n'a pas toujours d'entreprise.
- **La direction invite** une adresse, avec un rôle et un motif (« Inviter quelqu'un », à la place d'« Ajouter
  quelqu'un »). Le lien vaut **sept jours** ; la base n'en garde que l'empreinte, et **il se montre une fois**, avec
  « Copier le lien », « Envoyer par WhatsApp » et « Envoyer par e-mail » (la messagerie de la direction, préremplie).
  *En 1.25.0, le serveur n'envoyait rien ; depuis la 1.26.0, l'e-mail part de SkanFact (C42, décidé par Skander) et le
  lien montré reste en secours.* Quelqu'un qui est déjà dans l'équipe ne s'invite pas (son rôle se change dans la
  liste).
- **L'invitation attend** dans la liste des membres (« invitation en attente », pas encore activé, jusqu'à quand vaut
  le lien) et dans « À régler » ; **« Renvoyer »** donne un lien neuf, sept jours de plus (l'ancien ne vaut plus) ;
  **« Annuler »** l'éteint. Une invitation à la même adresse remplace celle qui attendait.
- **L'invité ouvre le lien sans session** : qui l'invite, son rôle, jusqu'à quand. Il rejoint **avec son compte** (son
  mot de passe le prouve, compté avec les erreurs de connexion) ou **le crée** (son nom, un mot de passe selon la règle
  de l'application). L'adresse est toujours celle de l'invitation. Un lien qui ne vaut plus (servi, annulé, remplacé,
  passé, inventé) ne dit rien d'autre que cela, et mène à la connexion.
- **Le premier code, à la première connexion** : un membre arrivé depuis **moins de sept jours** sans code du téléphone
  le pose à l'entrée de la console — SkanFact à ajouter dans une application d'authentification (code QR et clé), ses
  dix codes de secours à mettre de côté (« Je les ai mis de côté », sans quoi rien), puis le premier code juste active
  le code et ouvre la session ; un code faux ou un code de secours n'activent rien. Passé sept jours sans code, la
  console le refuse comme avant, et « À régler » dit jusqu'à quand il peut le poser.
- Au journal : `equipe.inviter`, `equipe.invitation_renvoyee`, `equipe.invitation_annulee` (avec l'adresse et le
  rôle), `equipe.invitation_acceptee`, `equipe.premier_code` (la méthode lue dans le compte), sans jeton ni secret.

**C42. L'invitation part par e-mail, de SkanFact** (1.26.0 ; base 0119 ; `serveur/invitation-courriel.ts` ; **décidé par
Skander le 15/10/2026** : « fait ta recommandation », après l'explication de ce que font les autres services — l'e-mail
part du service, le lien copiable reste en secours). Les **trois portes** : l'équipe d'une entreprise, celle d'un cabinet,
l'équipe SkanFact.
- **Ce qui part chez le relais, compté et décidé** : l'adresse invitée, le nom de qui invite, où (l'entreprise, le
  cabinet, ou « l'équipe SkanFact »), le rôle, le lien et le jour où il cesse de valoir. **Rien d'autre** : ni le
  matricule, ni l'adresse de qui invite, ni les autres membres. L'objet : « Amira t'invite à rejoindre Quincaillerie
  Ben Salem sur SkanFact » (ou « … t'invite dans l'équipe SkanFact ») ; le bouton : « Rejoindre … ». Le lien d'une
  entreprise ou d'un cabinet mène à l'application (`/?invitation=…`), celui de l'équipe à la console
  (`SKANFACT_CONSOLE_ADRESSE`, sinon `/console` de l'adresse publique).
- **L'écran dit ce qui s'est passé** : « L'invitation est partie — un e-mail est parti à … avec le lien » ; le lien reste
  montré **une fois**, avec « Copier », WhatsApp et sa messagerie, « s'il ne trouve pas l'e-mail ». **Sans relais**
  (un serveur d'essai), rien ne part et l'écran le dit (« ce serveur n'envoie pas d'e-mails… ») : le lien se transmet
  à la main, comme avant.
- **Renvoyer** envoie le lien neuf ; **annuler** n'envoie rien. L'envoi n'attend pas le relais (un relais lent ne
  retient pas la réponse) ; chaque e-mail laisse sa trace (0115 : l'instant, parti ou refusé, sans l'adresse).
- Tests : `tests/socle/invitation-courriel.test.ts` (les trois portes, le lien égal au jeton rendu, aucune donnée de
  plus, renvoyer, annuler, sans relais).
- **Revue à la souris** (15/10/2026, un serveur d'essai dont le relais écrit dans un fichier) : la console, puis
  l'application d'une entreprise — la fenêtre « L'invitation est partie », et l'e-mail reçu avec le bon objet, le bon
  rôle et le lien qui mène à la bonne porte.

**C43. Les nouveautés qu'on allume** (1.27.0 ; base 0120 ; `serveur/nouveautes.ts` ; la maquette « Réglages », onglet
« Nouveautés allumées » ; `02-modules.md` § 7, 10-console § 2.11 ; **choisi par délégation le 15/10/2026**). Une nouveauté
s'allume d'abord pour des entreprises volontaires, avant tout le monde : c'est l'essai sans installation.
- **Elle n'existe que si la version en service la porte** : la liste des nouveautés vit dans le code
  (`NOUVEAUTES`, son nom et ce qu'elle fait, écrits avec le code qui la sert). La base ne tient que pour qui chacune
  est allumée, depuis quand, par qui et pourquoi ; un code que la liste ne porte plus, le serveur le tait, et le refuse
  avant la base. **Aucune nouveauté en service aujourd'hui** : l'onglet le dit (« la version en service ne porte aucune
  nouveauté à allumer ») ; la première qui viendra (la caisse en salle de la vague 1, par exemple) s'y déclarera.
- **Les quatre gestes**, la direction seule, chacun avec son motif et au journal de l'équipe : **allumer pour une
  entreprise**, désignée par son **numéro de client** (« E-0012 », jamais son nom ; un nom est refusé sur sa case, un
  numéro inconnu aussi) ; **l'éteindre** pour elle (la ligne garde qui l'avait allumée et qui l'a éteinte ; ce qu'elle a
  fait reste à elle) ; **l'ouvrir à toutes les entreprises** (bouton rouge : tout le monde la voit) ; **la refermer** (les
  volontaires d'avant la gardent, et la fenêtre dit combien). Le support lit, sans aucun bouton.
- **Ce que lit l'application** : `GET /entreprises/:entreprise/nouveautes` rend la liste des codes allumés pour cette
  entreprise (volontaire ou ouverte à tous), rien d'autre — ni qui, ni pourquoi ; la base refuse qui n'est pas de
  l'entreprise. Le code qui sert une nouveauté demande `nouveauteAllumee(tx, entreprise, code)`.
- Au journal : « nouveauté allumée / éteinte pour une entreprise » (sur : l'entreprise ; ce qui a changé : la
  nouveauté), « ouverte à toutes les entreprises », « refermée » (sur : la nouveauté).
- **Pas fait, et pourquoi** : la maquette disait « un message aux clients l'annonce » et « l'autre membre de la
  direction est prévenu » ; rien ne part tout seul — la fenêtre dit de l'annoncer dans « Messages aux clients » (le
  message s'écrit, il ne s'invente pas), et le geste est au journal. L'écran de l'application ne lit pas encore ses
  nouveautés : il n'en a aucune à servir ; il les lira avec la première.
- **Revue à la souris** (15/10/2026, un serveur d'essai portant deux nouveautés inventées) : allumée pour une
  pharmacie par « e3 » (un nom refusé, un numéro inconnu refusé), éteinte, ouverte à tous, refermée ; le journal ; au
  téléphone (une fiche par entreprise), en sombre, et vu par le support. Corrigé ce jour-là : « écrit par » sous la
  date (devenu « allumée par »), un « : . » en trop, « les volontaires d'avant (0) » (dit selon leur nombre), le
  tableau qui débordait au téléphone, les deux boutons collés.

**C44. L'audit de la console 1.26.0, première partie : les droits payés et les mots de passe** (1.28.0 ; bases 0121 et
0122 ; l'audit fait par Skander avec un autre assistant le 15/10/2026, vérifié ici point par point : ses treize constats
sont vrais ; corrigés dans l'ordre qu'il propose, un lot par version). Les trois premiers :
- **C01, payer en avance retirait trop tôt.** Une période payée avant son premier jour garde ce qu'elle change pour ce
  jour-là, et la bascule l'applique le jour venu (`docs/abonnement.md` B6) ; la même facture ne paie pas deux périodes.
- **C02, un nouveau mot de passe ne fermait pas la console.** Le changer dans l'application ferme aussi ses sessions de la
  console ; le réinitialiser (« mot de passe oublié ») ferme toutes ses sessions des deux espaces, et les défis de
  connexion de la console qui attendaient leur code. Changé depuis la console, celle-ci reste ouverte et les autres se
  ferment (C40).
- **C03, un changement à moitié.** Changé depuis la console, le mot de passe, la fermeture des autres sessions et le
  journal de l'équipe tiennent dans la transaction de la route : une panne n'en laisse aucun à moitié, un refus n'écrit
  que l'erreur comptée ; et la route ne prend plus une seconde connexion pendant qu'elle tient la sienne (un test le
  joue avec une seule connexion : il aboutit).
- Les anciens tests qui décrivaient le défaut (un paiement d'avance appliqué aussitôt) sont retournés vers la règle, et
  joués des deux côtés : payé en avance (rien ne change avant le jour) et payé en retard (tout s'applique aussitôt).

**C45. L'audit de la console 1.26.0, deuxième partie : le gel tenu, l'équipe en concurrence** (1.29.0 ; base 0123) :
- **C04, un gel perdu sur une panne de lecture.** Le suiveur distingue désormais des consignes lues, absentes (une base
  d'avant elles, qui doit pouvoir s'installer) et illisibles (la base ne répond pas, ou répond mal). Illisibles, il
  n'installe rien tant qu'une version tourne ; un serveur neuf, sans version, s'installe quand même. Les dernières
  consignes lues restent dans son état ; l'écran Versions dit l'heure du tour qui n'a pas pu les lire, et la prochaine
  version « en attente des consignes ».
- **C05, la dernière direction perdue à deux.** Chaque geste qui change l'équipe ou ses invitations (ajouter, changer un
  rôle, retirer, inviter, annuler, accepter ; et l'outil de l'exploitation) prend d'abord le même verrou, puis revérifie
  ce qu'il croit : le rôle de qui agit (il a pu changer pendant l'attente) et la direction qui reste. Deux directions qui
  se rétrogradent au même moment : une seule y arrive. L'outil ne rétrograde plus non plus la dernière direction.
- **C06, deux liens pour la même adresse.** Une seule invitation attend par adresse (un index unique) ; deux invitations
  au même moment : la seconde remplace la première, un seul lien vaut.

**C46. L'audit de la console 1.26.0, troisième partie : l'invitation, le support et sa mesure, honnêtes** (1.30.0 ;
base 0124) :
- **C07, « l'invitation est partie » sans qu'elle le soit.** L'e-mail part une fois l'invitation écrite (la suite de la
  route, après sa transaction : plus jamais un lien envoyé pour une invitation refusée), et la réponse du relais est
  attendue huit secondes. L'écran dit ce qui est vrai : partie (le relais l'a acceptée — ce n'est pas encore la preuve
  qu'elle est arrivée), refusée, en attente du relais, ou sans relais ; refusée ou en attente, le lien à transmettre passe
  devant. Chaque invitation garde cet état et son heure (une réponse tardive du relais se note) ; la liste de l'équipe
  SkanFact le montre. L'application garde son « Invitation partie », désormais vrai seulement quand le relais l'a acceptée.
- **C08, une relance qui effaçait le retard.** Une demande attend depuis le premier mot du client resté sans réponse :
  « vous avez vu mon message ? » ne la sort plus des urgences ; seule notre réponse remet le cycle à zéro.
- **C09, une réponse doublée après une coupure.** Chaque réponse écrite dans la console porte l'identifiant de sa commande,
  gardé quand on la renvoie : la même commande ne fait qu'un message (et rend le premier), même envoyée deux fois au même
  moment ; deux réponses différentes en font deux.
- **C12, une attente qui n'existait plus.** La Mesure lit les demandes ouvertes comme la file du Support (la même fonction,
  le même chiffre) : une demande close n'attend plus, une ancienne attend encore. Close sans réponse avant son délai (un
  doublon, une question réglée par le client), une demande ne compte ni tenue ni manquée ; après son délai, manquée
  (choisi par délégation).

**C47. L'audit de la console 1.26.0, quatrième partie : les sauvegardes honnêtes** (1.31.0 ; base 0125) :
- **C10, un relevé ancien qui restait vert.** Le dernier relevé de la veille ne dit l'état de l'archivage et de la copie
  hors de la machine que s'il a cinq minutes au plus (la veille relève chaque minute, le même seuil que les alertes).
  Plus vieux, les deux se disent non mesurés, avec l'heure du relevé (« trop ancien pour dire l'état de maintenant ») ;
  la promesse « la base tombe » redevient « à prouver », et les copies « sur le serveur » et « hors de la machine » non
  mesurées. L'heure du relevé n'est pas celle du dernier journal archivé : un serveur calme archive peu, ce n'est pas une
  panne. « En place » sur le serveur dit la nuit faite ET l'archivage qui tourne, les deux mesurés.
- **C11, une remise d'autrefois qui tenait la promesse.** Une entreprise revient en 4 h sans rien perdre : tenue
  seulement par une remise faite sur ce serveur depuis moins de 92 jours, dont la durée a été mesurée — de la base de la
  minute restaurée à côté jusqu'à la remise faite : le script mesure l'essai, la remise y ajoute la sienne, le total
  entre dans la piste d'audit — sous les 4 h, et revenue à une minute nommée (PostgreSQL ne s'ouvre pas avant d'avoir
  atteint la minute visée : rien d'après elle n'est perdu). Trop lente : pas tenue. Sans durée (une remise d'avant la
  1.31.0), sans minute ou trop vieille : à prouver, et la colonne « ce qui le prouve » dit pourquoi. La liste des remises
  montre la durée de chacune.

**C48. Une demande liée à son incident et à sa correction** (1.32.0 ; base 0126 ; la liste des fonctions qui manquent,
19, choisie le 15/10/2026). Dans Support, le menu d'une demande ouverte offre deux gestes de plus, chacun avec son motif et
sa ligne au journal (la direction et le support) :
- **Lier à un incident** : ceux ouverts, et ceux clos depuis trente jours au plus (une demande arrive souvent après la
  fin). La demande le dit sous son suivi (« INC-2026-002 · Les PDF sortent sans cachet · en cours ») ; l'incident compte
  ses demandes liées et combien restent ouvertes — jamais lesquelles ni de qui : la technique lit cet écran. Délier la
  retire.
- **Noter la version qui la corrige** (« 1.32.0 ») : la demande dit « correction attendue en 1.32.0 (en service : …) » ;
  quand la version en service (le numéro que le suiveur lit pour celle qui tourne) l'atteint — nombre par nombre, une
  préversion ne compte pas encore —, elle dit « corrigée en 1.32.0, en service » avec « à dire au client », et sa ligne
  de la liste porte « Corrigée ». Retirer la version la fait ne plus rien attendre.

**C49. Le guet extérieur** (1.33.0 ; la liste des fonctions qui manquent, 22 ; `docs/mise-en-ligne.md`, I bis). Une machine
de GitHub regarde chaque serveur de l'extérieur toutes les dix minutes et ouvre un ticket quand il ne répond plus. La
console le montre par la veille : la règle « vu de l'extérieur » (Service › Alertes, brique « le programme ») est
branchée — « le guet extérieur ne passe plus depuis … » (une heure), et, sur un serveur aux vraies données, « ce serveur
n'est pas guetté de l'extérieur ». La disponibilité et les performances disent toujours « vu de l'extérieur : non
mesuré » : le guet prévient, il ne compte pas.

**C50. L'arrivée des nouveaux clients** (1.34.0 ; base 0127 ; la liste des fonctions qui manquent, 6). Une carte de plus
en tête de Clients, « arrivées » : les entreprises inscrites depuis trente jours (celui de l'inscription compris), et
depuis la 1.45.0 celles qui n'ont pas encore d'issue (C61), jamais un dossier qu'un cabinet tient. Chacune franchit cinq marches, lues dans ce que la console sait déjà : **l'inscription** ;
**le premier passage** (quelqu'un y a travaillé, 0114) ; **la première pièce** (brouillon compris) ; **la première facture
émise** (une note d'honoraires compte ; son jour est celui de Tunis) — la première utilisation réelle ; **l'abonnement
payé**. Chaque marche est attendue dans un délai compté depuis l'inscription (deux jours, cinq, quatorze, trente :
décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place » ; à revoir sur les premiers vrais clients) ; la première marche manquante dont le délai est passé — le lendemain de
son dernier jour — rend l'arrivée « bloquée », avec ses jours de retard : c'est un appel, pas une relance. Dans la vue, la
colonne de l'usage devient « son arrivée » : cinq points (franchie, bloquée, à venir) et la phrase qui nomme la marche
(« bloquée : première facture émise · 1 j de retard », « prochaine : première pièce, d'ici le 18/10 ») — la couleur
n'est jamais seule. La fiche porte la carte « Son arrivée » (chaque marche, le jour où elle a été franchie quand on le
sait, sinon le jour avant lequel on l'attend), par la même fonction que la ligne. **Décidé par délégation** : l'équipe
invitée n'est pas une marche (un commerçant seul n'invite personne : ce ne serait jamais « bloqué » à juste titre) ; elle
se lit dans les comptes de la fiche.

**C51. Prévenir d'un coup les clients d'un incident** (1.35.0 ; base 0128 ; la liste des fonctions qui manquent, 19 — la
suite de C48). Quand des demandes sont liées à un incident, la direction et le support leur écrivent le même mot en une
fois : « Répondre aux N demandes ouvertes… » sur l'incident ouvert, et dans le compte rendu d'un incident clos (« c'est
réparé »). Chaque demande OUVERTE liée le reçoit comme une réponse ordinaire, avec sa ligne au journal, et son client en
est prévenu comme pour toute réponse ; une demande close n'est pas rouverte, et personne d'autre ne reçoit rien. La
fenêtre dit combien de demandes, rappelle que tous lisent le même mot (jamais le nom ni le détail d'un autre client) ;
l'identifiant de commande tiré par l'écran fait qu'un renvoi après une coupure n'écrit rien deux fois. Le journal garde
aussi le geste d'ensemble (« clients d'un incident prévenus d'un coup », l'incident et le nombre). La technique lit les
incidents, pas les demandes : elle ne prévient personne.

**C52. Les contestations de nos factures** (1.36.0 ; base 0129 ; la liste des fonctions qui manquent, 13 : « remboursements
et litiges financiers : trop-perçus, contestations et suivi des régularisations »). Un client conteste une facture
d'abonnement émise : depuis la ligne de cette facture sur sa fiche (onglet « Nos factures »), la direction ou le support
note ce qu'il conteste, dans ses mots, et par quel canal ; une facture n'a qu'une contestation en cours à la fois, et
une facture préparée se corrige avant d'être émise, elle ne se conteste pas. La ligne de la facture le dit (« contestée
le … par WhatsApp : elle attend sa régularisation », en orange et en mots) ; Paiements les liste (en cours, puis celles
régularisées depuis trois mois) ; au bout d'une semaine sans régularisation (décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place »), elle entre dans « À décider »
de la direction et dans « ce qui attend » de la fiche. Elle se régularise d'une de quatre façons : **par un avoir** (son
numéro), **par un remboursement** (sa référence : le virement, le chèque), la facture **maintenue**, ou **retirée** par le
client. L'avoir et le remboursement se font dans l'application de SkanFact, sur la facture, comme toute pièce ; la
contestation en garde la trace et ne touche jamais la facture. La base réserve à la direction l'avoir, le remboursement et
la facture maintenue (de l'argent) ; le support note une contestation et la dit retirée. Chaque geste au journal, avec
son motif. Les trop-perçus restent où ils étaient (C30) : la contestation ne les recalcule pas.

**C53. Les secrets et leur échéance** (1.37.0 ; base 0130 ; la liste des fonctions qui manquent, 32 : « suivi des
configurations et des secrets : état, rotation et renouvellement, sans exposition des secrets »). Dans Service › Sécurité,
la carte « Les secrets et leur échéance » tient le registre des clés et mots de passe du service (le relais d'e-mails,
les SMS, le stockage hors de la machine, le chiffrement des sauvegardes, le prestataire de paiement…) : le nom de chacun,
à quoi il sert, où il vit (le serveur et sa variable, Cloudflare, le compte du prestataire), quand il a été renouvelé,
quand il expire (si le prestataire le date) et tous les combien on le renouvelle (notre règle). **Jamais sa valeur** : la
console ne l'a pas, et la base refuse une phrase qui ressemble à une clé (une longue suite de lettres et de chiffres sans
espace). Son échéance est le premier des deux jours qu'il a ; aucun, il n'en a pas, et l'écran le dit. Le plus pressé
d'abord : en retard (rouge), bientôt — trente jours avant (décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place ») — (orange), à jour, sans échéance ; toujours dit
en mots. Bientôt dû ou en retard, il entre dans « À décider » de la direction et de la technique (jamais du support, qui
ne lit pas cet écran). La direction et la technique notent un secret, son renouvellement (le jour, la nouvelle date
d'expiration ; il ne vient jamais avant le précédent) ou qu'on ne le suit plus ; chaque geste au journal, avec son motif.
Le certificat https reste lu par la veille (C26).

**C54. La sortie d'un client et la conservation de ses données** (1.38.0 ; base 0131 ; la liste des fonctions qui
manquent, 8 : « gestion complète de la sortie client : contrat, restitution des données, remboursements et
conservation », et 33 : « gestion de la conservation et de la suppression des données »). Quand un client s'en va, la
direction ouvre sa sortie depuis sa fiche (« Plus rare : la sortie d'un client ») : pourquoi il s'en va (le prix, une
fonction qui manque, son activité qui ferme, un concurrent, autre chose) et ce qu'il en dit. La carte suit alors, dans
l'ordre, ce qui reste à faire :
  - **le contrat** : son abonnement ne se renouvelle plus (résilié, suspendu, ou une échéance passée sans paiement ; un
    abonnement offert ne s'arrête jamais tout seul). Son dernier jour est celui que le payé ou l'essai couvre ; l'entreprise
    passe ensuite en lecture seule. Le bouton « Résilier… » de la carte est le geste de l'onglet Abonnement ;
  - **ses données** : c'est LUI qui les télécharge (Réglages › Données › Toutes les données de l'entreprise, le
    propriétaire ou un administrateur). La console lit seulement la trace de ce téléchargement dans le journal de
    l'entreprise (`socle.export_complet`), jamais le fichier ; un téléchargement d'avant l'ouverture de la sortie ne compte
    pas (ce qu'il a fait depuis n'y est pas). Personne chez SkanFact n'en fait une copie pour lui ;
  - **le remboursement** : rien à rendre, ou rendu, avec la référence de l'avoir ou du virement (faits dans l'application
    de SkanFact, comme toute pièce) ;
  - **la conservation** : ses données restent sur nos serveurs, en lecture seule, jusqu'au dernier jour de son contrat
    plus **dix ans** (**À VÉRIFIER** : la durée que la loi impose à ce qu'il a tenu chez nous). Rien ne s'efface avant ce
    terme sans sa demande écrite ; l'effacement au terme est une opération de l'exploitation, hors de la console.
    **Sa procédure** (décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place ») : la direction l'accorde par écrit (un geste au journal, avec le client
    et le terme) ; la technique le mène sur la machine, avec l'outil de l'exploitation, et note qu'il est fait ; la copie
    de secours suit à sa rotation suivante. Le journal garde que l'effacement a eu lieu, jamais ce qui a été effacé.
    L'outil s'écrira avant la première échéance (pas avant 2036) : rien ne s'efface d'ici là.
La sortie se clôt de deux façons : **il est parti** (le contrat arrêté et le remboursement réglé ; la base le revérifie,
sous verrou de l'abonnement), ou **il reste** (il s'est ravisé ; rien ne change). Partir sans avoir pris ses données se
lit avant le geste, sans le bloquer : c'est son droit. Close « parti », la sortie garde une copie du dernier jour du
contrat et du terme de la conservation, et la fiche les dit. Une sortie en cours dont le contrat a pris fin entre dans
« À décider » de la direction et dans « ce qui attend » de la fiche, avec ce qui reste ; elle y remplace les lignes de
son échéance (on ne propose pas de facturer un client au moment où il part). La direction seule ouvre, règle et clôt ;
chaque geste entre au journal de la console avec son motif ; rien ne s'écrit dans le dossier du client.

**C55. Ce qui doit rentrer** (1.39.0 ; la liste des fonctions qui manquent, 14 : « prévisions de revenus et de trésorerie :
revenus attendus, impayés et échéances » ; version légère, sans table nouvelle). Dans Paiements, à côté des coûts du mois,
une carte pour la direction : à partir d'aujourd'hui (quel que soit le mois regardé), sur trois mois, le mois en cours
compris :
  - **les factures émises** qui restent dues, rangées par le mois de leur échéance (sans échéance : le premier jour de leur
    période), en **taxes comprises** — la liste « À encaisser » de l'écran, par la même fonction, jamais recomptée ; ce qui
    est déjà échu se dit au-dessus (« déjà en retard »), ce qui tombe après les trois mois en dessous (« plus tard ») ; une
    autre devise que celle de l'entreprise SkanFact n'entre pas dans ces montants ;
  - **les renouvellements attendus** qui n'ont pas encore leur facture (ni émise, ni préparée), rangés par le mois où leur
    période commence (ce mois-ci pour une période qui aurait dû commencer avant : une grâce), au prix de leur prochaine
    facture **hors taxes** (la règle de la facture, celle de la liste des clients et des échéances). Un renouvellement
    sans prix dans la grille se compte sans montant ; celui d'un client dont la sortie est ouverte (C54) est écarté.
Les colonnes ne s'additionnent jamais : l'une est taxes comprises, l'autre hors taxes (la facture ajoutera la TVA et
le timbre du jour). La carte le dit, et dit aussi que c'est une prévision, pas une promesse. **Depuis la 1.45.0 (C61)** :
une troisième ligne, les factures préparées pas encore émises, et les mois suivants d'un abonnement mensuel.

**C56. Le risque de départ d'un client** (1.40.0 ; base 0132 ; la liste des fonctions qui manquent, 7 : « suivi de la
satisfaction et du risque de départ : retours, insatisfaction et baisse d'utilisation » ; version légère). La console lit
des **signes** dans ce qu'elle sait déjà, jamais une note inventée ; seul un client qui **paie** en montre (abonné, ou une
échéance passée sans paiement après un abonnement) : un essai qui ne choisit pas d'offre n'est pas un départ, il est « à
appeler ». Les six signes, dans cet ordre :
  - **résiliation demandée** : il partira à son échéance ;
  - **paiement en retard** : son échéance est passée sans paiement ;
  - **conteste une facture** : une contestation (C52) encore ouverte ;
  - **plusieurs demandes ouvertes** : au moins deux demandes au support pas encore closes (ses retours) ;
  - **usage en baisse** : il émet au moins deux fois moins de pièces ces trente jours que les trente d'avant, sur au moins
    quatre pièces d'avant (0132 : `plateforme.console_usage_trente`, des nombres par entreprise, au jour de son fuseau,
    les seules pièces émises, jamais une entreprise d'exemple ; la direction et le support, jamais la technique) ;
  - **pas ouverte depuis dix jours** : la règle de la vue « Silencieux », par la même fonction (`silencieuse`).
Dans Clients, une huitième carte, **« à risque »**, ouvre les abonnés qui montrent au moins un signe ; dans cette vue, la
colonne de l'usage devient « ses signes de départ » (les signes en mots, et les pièces des deux fois trente jours). La
fiche a sa carte **« son risque de départ »** (un client qui paie seulement) : chaque signe et ce qu'il veut dire. Les deux
lisent le risque par la même fonction (`risqueDe`). La satisfaction elle-même **ne se mesure pas encore** (aucune question
n'est posée aux clients) : l'écran le dit. Les seuils (quatre pièces, la moitié, deux demandes) : décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place », à revoir
sur trois mois de vrais clients.

**C57. La documentation interne du support** (1.41.0 ; base 0133 ; la liste des fonctions qui manquent, 20 :
« documentation interne du support : procédures, notes privées et réponses validées » ; version légère). Dans l'écran
Support :
  - **les notes privées** d'une demande, dans la carte du client à côté de la conversation : ce que l'équipe se passe (ce
    qui a été essayé, à qui demander). Elles vivent dans une table à part que rien côté client ne lit : la personne ne les
    voit **jamais**. Une note se pose, elle ne se modifie ni ne s'efface ; le journal dit qu'une note a été posée, sur
    quelle demande, jamais son texte ;
  - **« Notre documentation »** (un bouton de l'en-tête, `#/support?vue=doc`) : des **réponses** (un texte prêt à envoyer ;
    « {prenom} » y devient le prénom de la personne) et des **procédures** (comment on fait). La direction et le support
    les écrivent ; une réponse ne s'offre dans le champ de réponse (« Réponse validée… ») qu'une fois **validée par la
    direction**, qui relit le texte tel qu'il partira ; la reprendre la **renvoie à valider** (l'écran le dit avant le
    geste) ; la direction **retire** ce qui ne vaut plus, avec son motif (la ligne reste). Un titre ne sert qu'une fois par
    sorte. Rien n'y nomme un client.
La direction et le support, jamais la technique (03 § 5) ; chaque geste au journal. Un geste nouveau, « valider ou
retirer une fiche » (`console.support.valider`), est réservé à la direction.

**C58. Les retours des clients et les demandes d'évolution** (1.42.0 ; base 0134 ; la liste des fonctions qui manquent, 35 :
« gestion des retours clients et des demandes d'évolution » ; version légère). Une **évolution** est une idée nommée
(« Exporter les factures en Excel ») ; l'équipe y **rattache** les demandes au support qui la réclament, depuis le menu de
la demande (« Rattacher à une évolution… » : une qui existe, ou une nouvelle) — une demande en réclame une au plus, la
rattacher ailleurs la déplace, et la détacher se fait d'un geste. La demande dit l'évolution qu'elle réclame et son état.
Dans Support, **« Les évolutions »** (`#/support?vue=evolutions`) les range par le nombre de **clients** qui les
demandent (deux demandes d'une même entreprise font un client), puis de demandes ; chacune dit son état et ouvre ses
demandes d'un clic. La **direction** décide de l'état : à étudier, prévue, **faite** (avec la version qui la livre, écrite
comme 1.42.0), **écartée** (avec sa raison, qui reste au journal). La direction et le support notent et rattachent ; la
technique ne lit rien (03 § 5) ; chaque geste au journal. Un geste nouveau, « décider de l'état d'une évolution »
(`console.support.evolutions`), est réservé à la direction. Prévenir les clients quand une évolution est faite viendra
plus tard.

**C59. L'accès d'urgence de l'équipe** (1.43.0 ; base 0135 ; la liste des fonctions qui manquent, 31 : « accès
d'urgence » ; décidé par délégation le 16/10/2026, Skander : « prends la décision à ma place »). Un membre qui a perdu son téléphone **et** ses codes de secours n'entrait plus dans la
console, et personne ne pouvait reposer son code à sa place (C40). Désormais :
  - **la direction** ouvre un accès d'urgence pour un **autre** membre, depuis le menu de sa ligne dans l'Équipe
    (« Ouvrir un accès d'urgence… »), avec son motif ; jamais pour elle-même. La fenêtre le dit avant le geste : à sa
    prochaine connexion, **après son mot de passe** (toujours exigé), il pose un **nouveau** code dans une application
    d'authentification, comme un premier code (C41) ; son ancien code et ses codes de secours cessent de valoir dès que le
    nouveau est actif ; ses sessions de la console se ferment tout de suite (le téléphone perdu peut en tenir une) ;
    l'accès vaut **vingt-quatre heures** et sert **une fois**. Avant d'ouvrir, on l'appelle à son numéro habituel ;
  - **la machine** (l'outil de l'exploitation, en root : `exploitation/equipe.sh urgence <adresse> "<motif>"`) l'ouvre
    pour n'importe quel membre, **la dernière personne de la direction comprise** : c'est la porte de qui n'a plus
    personne pour lui ouvrir. **Qui la tient** : la personne qui a l'accès root au serveur (Skander) ; jamais Claude ;
  - l'écran d'entrée dit « Pose ton nouveau code » et pourquoi ; un accès retiré ou passé pendant la pose n'active
    rien ; un accès nouveau remplace celui qui attendait ; un membre retiré de l'équipe n'en a plus ;
  - **ce qui se voit** : l'accès qui attend, dans « À régler » de l'Équipe (qui l'a ouvert, jusqu'à quand, « Retirer… »)
    et sur sa ligne ; à l'accueil de la direction, l'accès qui attend et celui qui a servi cette semaine (« si ce
    n'était pas lui, retire-le de l'équipe ») ; au journal, ouvert, retiré, servi (`equipe.urgence_ouverte`,
    `equipe.urgence_annulee`, `equipe.urgence_servie`), jamais un code ni un secret ;
  - **une seule personne à la direction** : « À régler » le dit, avec de quoi inviter une seconde personne. **Décidé** :
    deux personnes à la direction dès les pilotes (Skander et son père), pour que la console puisse toujours dépanner
    l'une par l'autre ; la machine reste le dernier recours.
Un mot de passe oublié passe par « Mot de passe oublié » de l'application (le même compte) ; l'accès d'urgence ne touche
que le code du téléphone.

**C60. L'audit de la console 1.42.0, lot 1** (1.44.0 ; base 0136 ; l'audit du 16/10/2026, « à corriger en premier »).
- **A01, deux périodes payées d'avance** : un second changement d'offre ne s'applique plus au premier des deux jours ; il
  se refuse avant tout argent, ou se déplace à son jour quand ce qui attendait ne changeait rien (docs/abonnement.md B6).
- **A02, le code du téléphone et les codes de secours d'un bloc** : changés depuis « Ton compte », ils tiennent dans la
  transaction de la route, comme le mot de passe depuis l'audit C03 (serveur/compte.ts) : un geste réussit ou échoue d'un
  bloc, son journal compris, et ne prend jamais une seconde connexion (une seule connexion suffit, un test le tient).
  Les erreurs de code se comptent quand même : un refus achève la transaction, il ne l'annule pas.
- **A03, une fiche validée est celle qu'on a lue** : la validation et la reprise d'une fiche de la documentation donnent
  l'instant de la version lue ; une fiche reprise depuis est refusée (« relis-la avant de la valider ») et rien n'est
  validé ni écrasé. Chaque validation garde le texte validé (`doc_support_validee`), et le journal son empreinte.
- **A07, la commande d'une réponse** : gardée avec le brouillon de sa demande (changer de demande et revenir renvoie la
  même, jamais une seconde réponse) ; la même commande avec un autre texte est refusée (409, et la base le refuse
  aussi) : l'écran le dit, garde ce qui est écrit, relit la conversation, et la réponse suivante a sa commande neuve.

**C61. L'audit de la console 1.42.0, lot 2a** (1.45.0 ; base 0137 ; l'audit du 16/10/2026, « avant les premiers clients
payants » ; décidé par délégation, Skander : « prends la décision à ma place »).
- **A05, une facture préparée ne disparaît plus des prévisions** : « Ce qui doit rentrer » (C55) dit, mois par mois, trois
  lignes qui ne s'additionnent jamais : les factures émises (le dû, taxes comprises), **les factures préparées pas encore
  émises** (le hors-taxes noté à leur préparation, par la règle de la facture : celui du renouvellement qu'elles
  remplacent) et les renouvellements (hors taxes). Préparer une facture la fait passer d'une ligne à l'autre au même mois et
  au même montant ; l'émettre la fait passer au dû. **Un abonnement mensuel qui court compte chaque mois des trois** (le
  premier au prix de la prochaine facture, rattrapage compris ; les suivants au prix d'un mois), jamais une période déjà
  facturée ; un abonnement qui attend déjà son paiement (une grâce, une période non renouvelée) ne compte que celle-là.
  Le prix des mois suivants est celui d'aujourd'hui : une remise qui finit dans les trois mois n'est pas devinée. Un bloc
  par mois, lisible dans la colonne de côté comme au téléphone.
- **A06, l'arrivée dure jusqu'à son issue** : passé ses trente jours, un client qui n'a jamais payé reste dans la vue
  « arrivées » (sa carte dit « jour 42 · après les 30 jours », la marche de l'abonnement bloquée depuis le lendemain de son
  délai) jusqu'à son issue : **il paie une période** (converti ; une échéance passée depuis ne le fait pas revenir), ou **un
  membre clôt son arrivée** depuis sa fiche (« Clore son arrivée… », la direction ou le support, avec le motif : ce qu'il a
  dit, à qui il est confié). Close, la fiche dit quand, par qui et pourquoi, et la rouvre (« Rouvrir son arrivée… », avec
  son motif) ; les deux gestes au journal (`clients.arrivee_close`, `clients.arrivee_rouverte`). Un dossier hors abonnement
  (bac à sable, tenu par un cabinet, offert) n'arrive pas au-delà de ses trente jours. **Décidé par délégation** : pas
  d'échéance de plus pour l'issue (le client attend jusqu'à ce qu'on décide) ; pas de responsable nommé (la direction et le
  support la voient, comme les autres vues).
- **A10, le motif d'un geste sur un secret** : il passe le même contrôle que le nom, le rôle et l'emplacement ; une suite
  qui ressemble à une clé est refusée avant d'être écrite, ni au registre ni au journal. L'écran le dit sous le motif. C'est
  une aide, pas une garantie. **Un secret collé quand même** (dans un texte qui n'est pas contrôlé) : on le tient pour
  exposé — on le change chez son prestataire, puis on note son renouvellement sur sa ligne ; le journal ne se réécrit pas
  (il est inaltérable), il garde seulement qu'un geste a eu lieu.

**C62. L'audit de la console 1.42.0, lot 2b** (1.46.0 ; base 0138 ; décidé par délégation, Skander : « prends la décision
à ma place »).
- **A04, une régularisation se rapproche d'une vraie opération** : une contestation close « par un avoir » nomme un avoir
  ÉMIS dans SkanFact qui corrige cette facture (son numéro, les majuscules ne comptent pas) ; sinon c'est refusé (« cet
  avoir n'est pas émis sur cette facture »), et un avoir ne régularise qu'une contestation. La ligne dit son montant et
  s'il couvre toute la facture ou une partie. Close « par un remboursement », elle dit son montant (jamais plus que la
  facture), son jour (aujourd'hui ou avant) et sa référence : il est **déclaré**, puis **rapproché** quand SkanFact a noté
  sur la facture des règlements négatifs qui le couvrent — lu à chaque fois, jamais coché à la main. Déclaré, il reste en
  orange et dans « À décider » de la direction (« un remboursement à noter dans SkanFact »). La sortie d'un client fait de
  même : « rendu » dit son montant et son jour, et se rapproche des règlements négatifs notés sur ses factures
  d'abonnement depuis l'ouverture de la sortie, ou de l'avoir émis sur l'une d'elles dont la référence est le numéro ;
  tant qu'il ne l'est pas, l'étape reste à faire et « il est parti » le refuse. Les montants se tapent en dinars (nos
  factures d'abonnement sont en dinars). Une régularisation d'avant la 1.46.0, qui n'avait que sa référence, se lit comme
  avant. **Décidé par délégation** : pas de case « vérifié » à cocher (c'est SkanFact qui fait foi) ; un remboursement
  partiel se dit, il ne se refuse pas.
- **A08, l'e-mail d'une invitation après une panne** : son état « à envoyer » s'écrit dans la transaction même de
  l'invitation (ou de son nouveau lien), avant l'envoi : un arrêt du serveur entre les deux en laisse la trace. Un e-mail
  resté « à envoyer » ou « en attente du relais » plus de dix minutes se lit **« sans réponse du relais »**, dans les trois
  listes d'invitations qui attendent (l'équipe SkanFact, l'équipe d'une entreprise, celle d'un cabinet), avec le geste qui
  le répare : renvoyer (un nouveau lien remplace l'ancien) ou transmettre le lien. **Décidé par délégation** : le lien
  n'est jamais gardé (la base n'en a que l'empreinte), donc il ne se renvoie pas tout seul — il se refait, à la main.

**C63. La communication ciblée, et le suivi de sa diffusion** (1.47.0 ; base 0139 ; la liste des fonctions qui manquent,
37 ; décidé par délégation, Skander : « prends la décision à ma place »). Le message aux clients (C28) reste UN à la fois
— un nouveau remplace celui qui s'affichait, quel que soit son public — et :
- **son public** : tous les clients, ou ceux en essai, les abonnés Essentiel, les abonnés Complet, les clients en retard
  de paiement, ceux en lecture seule. Il se choisit en l'écrivant (« À qui »), et chaque choix dit, avant le geste, combien
  d'entreprises il atteint aujourd'hui (le compte de la liste des clients). Le serveur compare le public à l'état de
  l'abonnement de l'entreprise de la page, par la même fonction que son onglet « Ton abonnement », à chaque lecture : une
  entreprise qui change d'état le voit, ou cesse de le voir, le jour même. L'entreprise ne reçoit que le message qui la
  vise, jamais son public. Le public entre au journal, avec le motif du message ;
- **sa diffusion** : l'application dit qu'elle l'a montré, puis qu'on l'a caché (« Plus tard »). **La liste comptée et
  décidée** de ce qui part : le message et l'entreprise (celle de la page, dans le chemin), et s'il est caché ; la base y
  ajoute l'instant. Jamais la personne, l'appareil ni l'adresse ; vu une fois, caché une fois (le premier instant seul) ;
  une entreprise d'exemple ne compte pas, ni une entreprise que le message ne vise pas, ni un message qui ne s'affiche
  plus ; le support qui lit un dossier en lecture seule n'envoie rien. La console dit, pour le message affiché et chaque
  message passé, « pour qui » et « vu dans N entreprises · caché dans M ».
**Décidé par délégation** : un seul public par message (une liste à un choix se lit d'un coup d'œil ; la base en accepte
plusieurs, pour plus tard) ; des entreprises comptées, jamais des personnes ; pas d'e-mail ni de SMS ici (le bandeau seul :
écrire à un client se fait depuis sa fiche, C33).

**C64. L'effet de chaque version** (1.48.0 ; base 0140 ; la liste des fonctions qui manquent, 38 : « suivi des versions
et de leur impact : incidents, performances et clients concernés » ; décidé par délégation, Skander : « prends la décision à
ma place »). L'écran Versions dit, pour chacune des dix dernières versions qui ont tourné, ce qui s'est passé pendant
qu'elle tournait : chaque installation réussie tourne jusqu'à la réussie qui la suit (une installation ratée ne coupe
rien), celle en service jusqu'à maintenant. **Rien de neuf n'est enregistré** : la base additionne ce qu'elle sait déjà
— les requêtes des clients, leurs pannes et leur 95e centile (les heures du service, 0085 ; les requêtes de la console
n'y sont pas, ce sont les nôtres), les incidents ouverts (0089) et, **pour la direction seule**, les demandes au support
ouvertes et le nombre de clients qui les ont posées (0095) ; la technique lit le service, jamais une donnée de client
(03 § 5). Ce qui est **pire qu'avec la version d'avant** se dit en orange : des pannes au moins deux fois plus fréquentes
et au-delà d'une requête sur deux cents ; un 95e centile plus lent d'un quart ; un incident majeur ou critique ; deux fois
plus de demandes par jour, trois au moins. Un centile ne se lit que sur assez de requêtes (vingt) : sinon « trop peu de
requêtes ». **Décidé par délégation** : ces seuils (écrits dans `serveur/console/impact.ts`), et rien de plus qu'un
constat — la console ne relie pas une panne à un changement du code, elle dit quand et combien.

**C65. Le coût des listes** (1.49.0 ; base 0141 ; l'audit 1.42.0 A09 : « la pagination limite l'affichage, pas le coût
du calcul » ; décidé par délégation le 19/10/2026). **Mesuré d'abord**, sur un seuil écrit d'avance (`VISION-ARCHITECTURE.md`
§ 6, « afficher une liste, une fiche ») : **95 % des réponses en moins de 300 ms côté serveur**, pour la liste des clients,
la fiche d'un client et l'accueil, avec **5 000 entreprises, deux millions de pièces émises sur l'année et cinq personnes
de l'équipe en même temps** (le volume, décidé par délégation : bien au-delà des 150 à 300 entreprises de la première année,
« plusieurs milliers de PME » par serveur). Le banc : `npm run banc:console` (`banc/console/mesurer.ts`, une base à part,
créée et détruite par lui, tout inventé). **Avant** : la liste répondait en 19 s, la fiche en 10 s, l'accueil en 22 s (95e
centile : 21 s, 11 s, 25 s). **Après** : 130 ms, 111 ms, 254 ms. Ce qui coûtait, et ce qui est fait :
- **la base** (0141) : le nombre de pièces de chaque entreprise se **tient à jour** à chaque pièce qui naît ou s'en va
  (`socle.compte_pieces`, par ses déclencheurs ; la restauration et la remise d'une entreprise, qui reposent ses lignes sans
  déclencheurs, le refont), au lieu d'être recompté à chaque liste ; des index sur les membres d'une entreprise, les pièces
  émises (par entreprise et par instant), les mandats et les dossiers tenus ; « émise ce mois », « sur trente jours » se
  cherchent par les instants qui bornent ces jours dans le fuseau de l'entreprise (le même compte, essai au bord de minuit) ;
- **la fiche d'un client** ne lit que la sienne (elle calculait l'usage, les identités, ce que la liste dit en plus de
  chaque client, et ne gardait que le sien) ; elle se lit **toujours à l'instant** ;
- **la liste se calcule une fois pour l'équipe** (`serveur/console/instantane.ts`) : ce que la liste sait de chaque
  organisation avant la recherche, les filtres et la page sert toute l'équipe **une minute** ; passée la minute, il sert
  encore une fois et se refait à côté (la réponse n'attend pas) ; au-delà de dix minutes, d'un jour à l'autre, ou après
  **un geste de la console qui écrit** (une fois sa transaction validée), la réponse attend le nouveau. Ce que les clients
  font de leur côté (une facture émise, une inscription) s'y voit donc à la minute suivante : **l'écran dit de quand datent
  ses chiffres** (« chiffres de 14:03 », et sur l'accueil « les clients, tels qu'ils étaient à 14:03 ») et propose
  « Actualiser ». Ce calcul ne sert qu'après que **la base a revérifié le rôle de la session qui le lit**
  (`plateforme.console_lire_la_liste` : la direction et le support ; la technique, jamais). Il vit dans le programme du
  serveur, qui tourne seul (`exploitation/installer.sh`) : plusieurs un jour, il passerait dans la base. Un essai l'éteint
  (`SKANFACT_CONSOLE_FRAIS_MS`, zéro sous `SKANFACT_ENVIRONNEMENT=test`) : il relit ce qu'il vient d'écrire ;
- **ce qu'une ligne dit d'elle-même** (son urgence, ses vues, ses cabinets, ce qu'elle rapporte, son texte de recherche)
  se calcule une fois et se garde avec elle ; le rang d'urgence de toute la liste, une fois par calcul partagé.
Les autres écrans qui lisent toute la clientèle (Abonnements, Cabinets, Mesure, Paiements, Support) gardent leur calcul :
le banc ne les mesure pas encore ; ils prendront ce chemin s'il les trouve au-delà du seuil.

**C66. Le contenu des pièces, relu contre son empreinte** (1.53.0 ; base 0142 ; l'audit 1.42.0 § 4 ; décidé par
délégation le 19/10/2026). La relecture de chaque heure (C38) refaisait les **liens** de chaque chaîne : elle ne voyait
pas une pièce retouchée par-dessous la base, dont le maillon n'a pas bougé. Désormais, au même tour, le **contenu** de
chaque pièce scellée est relu tel qu'il est aujourd'hui, recalculé **par la fonction qui l'a scellé** (deux chemins, un
chiffre : `contenuScelle` pour une pièce de vente, `compta.contenu_ecriture` pour une écriture validée) et comparé à
l'empreinte de son maillon (`serveur/service/contenus.ts`). Ce qui est fait :
- **chaque heure**, après les liens, le contenu de cinquante chaînes au plus (les moins récemment relues d'abord), par
  pas de cinq cents pièces, chaque pas dans sa transaction, deux minutes au plus par tour (le suivant reprend là ; à
  VÉRIFIER à la mesure de charge). Une chaîne garde la date, le résultat, le rang et le motif de sa dernière relecture
  (« pièce modifiée », « pièce disparue »), et jusqu'à quel maillon elle est allée : une pièce scellée après la relecture
  attend la suivante, et l'écran le dit (« une pièce scellée depuis : le prochain tour la relira »). Une sorte de pièce
  que la relecture ne sait pas encore lire n'est **jamais « intacte »** : « contenu relu en partie », avec son nombre ;
- **relire maintenant**, depuis Sécurité : toutes les chaînes (la direction ou la technique), ou celles d'**une
  entreprise** nommée par son numéro de client (« E-0012 », la direction seule : la technique ne reçoit aucun identifiant
  de client). Une seule à la fois ; le geste entre au journal de la console avec son motif ; le serveur la prend dans la
  minute, refait les liens puis le contenu de chaque chaîne, et dit où il en est (une jauge, chaîne par chaîne ; l'écran
  se relit toutes les cinq secondes tant qu'elle tourne). Un serveur arrêté en route la laisse ; un autre la reprend cinq
  minutes après, et l'écran dit qu'il n'en a plus de nouvelles. Elle compte comme une relecture des liens et du contenu ;
- **une chaîne cassée** (par ses liens ou par son contenu) dit **ce qui casse** et où ; la veille la compte (l'alerte
  grave de C38), et « À décider » ouvre désormais l'écran Sécurité. La carte n'offre qu'une étape : **ouvrir l'incident**,
  sur la nouvelle fiche réflexe « une chaîne d'empreintes cassée » (ne rien réparer, ne rien effacer ; garder une copie de
  la base ; relire l'entreprise ; prévenir l'entreprise touchée ; une pièce fiscale touchée se déclare À VÉRIFIER avec un
  comptable). La fenêtre s'ouvre remplie (le titre, « critique », la fiche) et le curseur attend le motif ; ouvert,
  l'incident est relié à la chaîne (« suivre INC-… »). Une ligne cassée se relit d'un clic (la direction).
Rien n'est écrit chez un client : la relecture lit, et note ce qu'elle trouve dans la chaîne. **Décidé par délégation** :
le rythme (cinquante chaînes, deux minutes, cinq cents pièces par pas), la fiche réflexe et sa gravité, le droit de la
technique à « tout relire ».

**C67. Les adresses à l'entrée : vues, et bloquées** (1.54.0 ; base 0143 ; l'audit 1.42.0 § 4 ; décidé par délégation
le 19/10/2026). La console voyait les comptes visés par des essais (un mot de passe connu, un compte freiné : C26),
jamais d'où ils venaient. Ce qui est fait :
- **l'entrée compte**, par adresse internet et par heure, ce qu'elle refuse (un mot de passe ou un code faux : la réponse
  401) et ce qu'elle freine (trop d'appels : 429), sur ses routes publiques seulement ; rien d'autre de la demande (ni le
  compte visé, ni ce qui a été tapé) ; la machine elle-même ne se compte pas. Le compte vit en mémoire et part à la base
  chaque demi-minute (`serveur/adresses.ts` ; au-delà de dix mille adresses entre deux passages, le reste se perd et se
  dit) ; un envoi raté se garde pour le suivant. **Trente jours se gardent** : une adresse internet est une donnée
  personnelle (05 § 4.3, la durée À VÉRIFIER avec l'INPDP) ;
- **Sécurité › Les adresses à l'entrée** : les vingt adresses qui ont le plus frappé ces vingt-quatre heures (refusées,
  freinées, la dernière fois), les blocages en cours, ceux finis cette semaine ;
- **bloquer** (la direction ou la technique ; le support, non) : une adresse seule (jamais une plage, jamais la machine),
  **une heure ou un jour**, avec un motif ; l'avertissement se lit avant le geste (une adresse peut être celle de tout un
  bureau, ou d'un opérateur mobile qui la partage). Le blocage ferme **l'entrée seule** (se connecter, s'inscrire, un
  code, un mot de passe oublié) : la personne lit pourquoi et jusqu'à quand ; une session déjà ouverte depuis l'adresse
  continue. Il s'applique tout de suite sur ce serveur (relu après le geste), au plus tard dans la demi-minute ailleurs ;
  il finit seul à son heure, ou se lève avant (« débloquer », avec un motif). Chaque geste entre au journal.
**Décidé par délégation** : l'entrée seule (pas les sessions), une heure ou un jour au plus, trente jours de comptes, la
technique qui bloque.

**C68. Les données personnelles : les demandes d'effacement, et ce que SkanFact garde** (1.55.0 ; base 0144 ;
`docs/conservation.md` ; l'audit 1.42.0 § 4, point 8 ; décidé par délégation le 19/10/2026). Une personne qui demandait
qu'on efface ses données n'avait ni registre, ni réponse suivie, ni preuve. Ce qui est fait, dans un écran **Données
personnelles** (barre de gauche, « Notre entreprise » ; la direction et le support, jamais la technique) :
- **noter une demande** (la direction ou le support) : le jour où elle est arrivée, par où, qui la fait, et ce qu'elle
  vise — le compte d'une personne (son adresse e-mail) ou les données d'une entreprise (son numéro de client). Elle prend
  un numéro (« EFF-2026-001 ») et une **échéance de réponse, trente jours** (À VÉRIFIER : la loi 2004-63, l'INPDP) ;
- **la décider** (la direction) : accordée, ou refusée avec sa raison, qui se répond à la personne. Sans décision à son
  échéance, elle entre en tête d'« À décider » ; avant, elle y attend avec son échéance ;
- **effacer le compte** (la direction, une demande accordée) : ce qui part et ce qui reste se lisent avant le geste, qui
  ne se défait pas. Le nom devient « Personne effacée », l'adresse e-mail une adresse qui n'existe pas, le téléphone, le
  mot de passe, les codes et les liens partent, les sessions se ferment et oublient leur adresse internet ; l'identifiant
  reste, pour que ce que la personne a fait reste juste. La **preuve** compte ce qui a été fait, jamais ce qui a été
  effacé. Une personne encore membre d'une entreprise, ou de l'équipe SkanFact, ne s'efface pas : on la retire d'abord ;
- **les données d'une entreprise** ne s'effacent pas d'ici : la demande accordée attend l'outil de l'exploitation (C54),
  et l'écran le dit ;
- **ce que SkanFact garde** : chaque sorte de données, sa durée (À VÉRIFIER pour six sur sept), et comment elle part.
Un test balaie chaque colonne de texte de la base après un effacement : ni le nom ni l'adresse ne restent. Il a trouvé
la trace des invitations (`socle.audit`, qui ne se modifie jamais) : depuis 1.55.0, **la trace désigne sans recopier**
(`socle.tracer` ne garde plus d'adresse e-mail ; l'invitation la garde, et l'effacement la remplace).
**Décidé par délégation** : le compte s'efface d'ici, une entreprise sur la machine ; trente jours pour répondre ;
l'anonymisation qui garde l'identifiant ; le nom du demandeur effacé avec le reste ; la direction seule décide et
efface, le support note. Aussi : un message passager ne couvre plus les boutons d'une fenêtre ouverte (il passe en haut).

**C69. Les travaux : un partenaire en pause, vingt-quatre heures, ce qui ne part plus** (1.56.0 ; base 0145 ; ce qui
manquait à la console avant la recette ; décidé par délégation le 19/10/2026). Travaux disait quatorze jours par
partenaire, et rien ne permettait d'arrêter un envoi pendant une maintenance. Ce qui est fait :
- **la pause d'un partenaire** (la direction ou la technique ; le support, non) : ce que le serveur envoie **seul** — le
  dépôt à la TTN (le facteur) et les relances d'échéance — se met en pause **une heure, quatre heures ou un jour**, avec
  un motif ; jamais plus (une pause oubliée ne bloque rien au-delà d'un jour), jamais deux à la fois. L'avertissement se
  lit avant le geste (pour la TTN : le délai légal de dépôt court toujours, **À VÉRIFIER**). Pendant la pause, rien ne
  part et **aucun essai ne se compte** ; à son heure, ou au geste « Reprendre… », tout repart au tour suivant (la TTN est
  d'abord interrogée : jamais deux dépôts). La carte du partenaire, la tuile du facteur et « À décider » de qui tient le
  service la disent, avec l'heure de reprise. Ce que les clients font eux-mêmes (signer, payer, recevoir un code) ne se
  met jamais en pause. Chaque geste entre au journal ;
- **vingt-quatre heures** : chaque carte se lit aussi heure par heure (« 14 jours · 24 heures »), avec les mêmes sources
  et les mêmes règles que ses quatorze jours ;
- **ce qui ne part plus** : la TTN ne cesse jamais d'essayer (une pièce signée doit se déposer), mais des envois en
  panne (ou sans réponse) depuis plus de **quatre heures** se disent en tête de Travaux et d'« À décider » du service,
  avec l'incident qu'on peut ouvrir (la fiche « un partenaire en panne »). Ni pièce ni entreprise : un nombre et l'heure
  du plus ancien.
**Décidé par délégation** : la TTN et les relances seules ; une heure, quatre heures ou un jour ; la technique qui met
en pause ; quatre heures avant de le dire ; jamais d'arrêt des essais de la TTN (un « nombre d'essais au plus » ferait
perdre une pièce que la loi demande de déposer).

**La densité de la console** (Skander, 14/10/2026 : « zoomée par rapport aux maquettes… privilégier la quantité
d'information »). Le grand écran se resserre sur les mesures des maquettes : le texte à 14,5 points, le titre d'un écran
à 32, la barre de gauche à 248 points de large avec des entrées de 36 (la liste défile seule quand la fenêtre est basse :
la marque et la carte de la personne restent à leur place), les boutons à 38, les cartes à 20 × 24 de marge, les
cellules des tableaux à 11 × 12, la page à 24 × 32 et jusqu'à 1 440 points de large. **Le téléphone garde ses cibles de
44 points.**

## Ce que le lot ne fait pas

La suite de la console : le relevé de la banque lu et pointé (aucune banque branchée ; les paiements, C30, montrent ce qui reste à encaisser), la retenue à la source sur nos factures (`05` § 4.2), la suite du service (les envois de la TEJ et de la CNSS, qui n'ont pas encore de trace ; le débit heure par heure, la
pause d'un partenaire et ce qui ne part plus sont faits en 1.56.0, C69 ; la relecture du contenu est faite en 1.53.0,
C66 ; bloquer une adresse, en 1.54.0, C67 ; les demandes d'effacement, en 1.55.0, C68), la mesure, la suite des réglages (un prix se prépare depuis la 1.12.0, C28 ; les nouveautés s'allument depuis la 1.27.0, C43). L'écran
« Application de bureau » de la maquette (les licences, les postes, la fin de vie et le passage à la plateforme de la v10)
ne se construit pas : **la v10 n'est installée chez personne** (Skander, 14/10/2026). Celui de la nouvelle application de
bureau (la coque et son agent local : les postes qui l'ont, leur version, ce que l'agent voit, ses erreurs) se dessinera
quand elle sera distribuée aux clients (`09` étape 4). Le guet extérieur (C49) vérifie le service depuis une autre
machine ; le second guet, depuis Cloudflare (1.57.0, `docs/mise-en-ligne.md` I ter), est écrit et reste à poser par Skander. Des constats de l'audit 1.42.0 restent
ouverts : aucun ; A04 et A08 sont faits en 1.46.0 (C62), le coût des listes (A09) en 1.49.0 (C65). La communication ciblée
est faite en 1.47.0 (C63) ; l'effet de chaque version, en 1.48.0 (C64).

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

## Revu à la souris et au clavier (14/10/2026, lot Clients)

La liste, la fiche (chaque onglet), la fiche d'un groupe, chaque fenêtre de geste et de reprise, en direction et en
support, en clair et en sombre, à 1440 et à 390, et la création d'une entreprise avec sa ville côté client. Corrigé
pendant le parcours, avec un œil de designer :
- le menu « … » et « Gestes ▾ » ne répondaient qu'à la touche Tab (le clavier restait sur le bouton : la liste encore
  cachée, le temps de mesurer sa place, refusait le focus) ; deux choix surlignés à la fois (la souris, le clavier) ;
  la note du bas alignée à droite, héritée de la cellule ;
- une fenêtre ouverte d'un groupe ne disait pas sur quelle société le geste tombait ; « Il le voit dans « Ton
  abonnement » » ne disait pas qui ;
- le nom lu du bouton « … » : « Ouvrir et gestes {pour:nom} », une valeur que le catalogue ne remplit pas (le test
  `catalogue-valeurs` la refuse : il n'avait pas été relancé) ;
- les pastilles d'un appel et d'une reprise, que les flèches ne cochaient pas ;
- l'onglet « Support et échanges » : « Nos échanges » sans marge, « Son dossier » dit deux fois, les deux vides pas
  alignés ; l'en-tête d'une société d'un groupe disait « Entreprise seule » ;
- la règle du support dite de deux façons (la liste, la fiche) ; la carte « Tout le portefeuille » qui comptait une
  recherche.

## Revu à la souris et au clavier (14/10/2026, 1.20.0 : l'argent juste)

Sur l'essai de l'outil humain, la base passée en `0113`, dans la console : Amira (direction) et Karim (support), en clair
et en sombre, à 1440 et à 390. Le support offre un mois (la fenêtre dit la période que la prochaine facture couvrira),
puis ne s'en voit plus proposer un second ; la direction note un paiement reçu hors de la plateforme, refusé d'abord
case par case (le numéro de facture, le montant, le moyen, le jour), puis noté : le journal et Paiements le disent ;
un module retiré pendant la période payée, puis rouvert ; la ligne « une facture attend d'être émise » à l'accueil ;
les montants de l'écran Abonnements, dont « Ce qui revient chaque année » refait à la main (la somme exacte des
lignes) ; puis, dans l'application de SkanFact, deux avoirs comme la direction les ferait : l'un qui reprend tout sauf
le timbre (la console le dit en trop-perçu), l'autre complet sur une facture payée (la console la dit défaite, avec ce
qui est à rendre) ; l'accueil, la fiche du client et Paiements en clair et en sombre, à 1440 et à 390. Corrigé pendant
le parcours, avec un œil de designer :
- une fenêtre dont le geste ne change rien aujourd'hui (un mois offert, un module) montrait deux colonnes identiques,
  « aujourd'hui » et « après le geste » : une seule colonne, et dessous ce que le geste fait ;
- la fiche disait deux fois la prochaine facture (deux lignes l'une sous l'autre) ;
- la case « Moyen » du paiement reçu, plus basse que ses voisines, et une fenêtre plus haute que l'écran à 1440×900 ;
- « Paie reste ouvert… » (« le module Paie reste ouvert… ») ; une confirmation « module retiré » quand il reste ouvert
  jusqu'à la fin de sa période, et « module acheté » pour une réouverture ; au journal, « module acheté » pour un
  module rouvert (« module ouvert ») ;
- « La facture de Atelier… » à l'accueil (« Atelier Mejri : une facture… ») ;
- « au prix du jour » là où le montant suit la règle de la facture ; « règlements notés sur nos factures » quand
  l'encaissé compte aussi les paiements reçus ailleurs (« règlements reçus ») ;
- une facture payée puis annulée par un avoir faisait deux lignes dans « À décider » (« payée, puis défaite » et « a payé
  47,410 DT de trop »), avec deux conseils différents : une seule ligne, qui dit la somme à rendre ;
- « son règlement a été retiré, ou un avoir l'annule » : la console le savait, la ligne dit maintenant laquelle, et le
  geste qui va avec (« relance le paiement » n'a pas de sens pour une facture annulée) ;
- « 4 règlements reçus, encaissés et pas facturés » se lisait comme des règlements jamais facturés : « l'argent arrivé,
  pas ce qui est facturé » ;
- au téléphone, le chiffre de l'encaissé (« 751,700 DT ») débordait de 18 points sur la tuile voisine : sa taille suit
  maintenant sa longueur et la largeur de la tuile, et l'instrument de la console mesure chaque chiffre dans sa tuile,
  sur un encaissé de 1 234 567,890 DT ;
- au téléphone, « Par chèque » restait seul sur sa rangée : le dernier moyen prend toute la largeur.

## Revu à la souris et au clavier (15/10/2026, 1.21.0 : des chiffres et des accès justes)

Sur l'essai de l'outil humain, la base passée en `0114`, dans la console : Amira (direction) et Karim (support), en clair
et en sombre, à 1440 et à 390. Le journal : ses quatre chiffres (la carte « le système, seul » dit 16, sa liste en
montre 16), chaque filtre (la recherche, la sorte, la période, la personne, les gestes réservés, ceux du système),
l'onglet des accès aux dossiers qui déplie les pages lues, l'export de la sélection ; l'équipe : les colonnes des
appareils reconnus, des gestes des trente jours et des codes de secours, le panneau des appareils d'un membre, une
session fermée (refusée d'abord sans motif, puis fermée) ; Paiements : une facture annulée par un avoir sans timbre,
rangée dans les défaites, et le coût du mois « Provisoire » ; la tuile des inscriptions égale à sa liste (15 et 15) ;
la fiche, qui dit la dernière activité de chaque membre dans cette entreprise. Corrigé pendant le parcours, avec un œil
de designer :
- le support n'avait pas l'écran Journal dans son menu (le serveur le lui ouvrait, l'écran disait « pas dans ton
  rôle ») : il y est, avec ses deux chiffres (« tes gestes », « accès aux dossiers ») et sans le filtre des personnes ;
- au téléphone, les quatre périodes du journal sortaient de la carte de 16 points : elles se rangent deux par deux
  (et « Tout » ne reste pas seul sur sa ligne) ; l'indication de la recherche, coupée (« un mot c… »), devient
  « Client, personne ou motif » ;
- au téléphone, « 6 appareils » et « Mes appareils » faisaient 21 points de haut : 44, comme toute cible au doigt ;
- au téléphone, le panneau des appareils écrasait le texte dans une colonne de 90 points à côté de son bouton : le
  bouton passe dessous ; « Oublier cet appareil… », en lien sans bord, décalé de son texte, prend le même bouton que
  « Fermer la session… » ;
- les sessions d'un appareil : le bouton passait sous la ligne (une grille, le texte et son geste) ;
- un membre qui ouvre ses propres appareils lit « Mes appareils et mes sessions », pas son propre nom à la troisième
  personne ; « fermer une session de Chrome sur Linux » plutôt que « la session » ;
- « les 50 plus récents » sans majuscule en tête de liste ;
- un paiement reconnu par le système n'a pas de montant dans le journal : la ligne dit la facture et le « payé
  jusqu'au ».

## Revu à la souris et au clavier (15/10/2026, 1.22.0 : le support et les travaux suivis)

Sur l'essai de l'outil humain, la base passée en `0115`, dans la console : Karim (support) et Amira (direction), en
clair et en sombre, à 1440 et à 390. Le support : prendre une demande, la marquer urgente (refusée d'abord sans motif),
la mettre en attente de la technique avec son motif, puis lever l'attente ; la puce « Urgente » et « suivie par Karim »
dans la liste, le filtre « À moi ». Travaux : un envoi de la TTN en panne repris (« Reprendre maintenant… », son motif,
puis « Prochain essai aujourd'hui » à l'instant, et plus de bouton) ; un compte El Fatoora retenu, qui n'offre
que « Prévenir l'entreprise… » ; la carte « Les e-mails » parmi les partenaires ; la phrase des partenaires sans trace
(la TEJ, la CNSS). Sécurité : la carte de la chaîne d'empreintes (« Relue », deux chaînes, six maillons, la dernière
relecture d'aujourd'hui, trente cases dont la dernière verte, ce qui est relu et ce qui ne l'est pas encore). Corrigé
pendant le parcours, avec un œil de designer :
- « Prévenir l'entreprise… » ouvrait un message sans sujet (« Un mot de l'équipe SkanFact ») : le brouillon nomme
  l'envoi (« une facture vers la TTN, référence 2EB5E87B ») dans l'objet et le message ;
- la fenêtre « Écrire au contact » demandait « Abandonner cette saisie ? » à Échap sans qu'on ait rien tapé : le
  prénom du brouillon, arrivé après l'ouverture, passait pour une saisie ; l'instantané se prend une fois les personnes
  lues ;
- la fenêtre de reprise promettait « une heure entre deux essais » et comptait « ses 1 essais » : le facteur reprend
  son rythme là où il en était (1, 5, 15 minutes, puis une heure) ; la phrase le dit sans chiffre faux ;
- au téléphone, les boutons des envois flottaient au milieu de la ligne : ils s'alignent à gauche, sous la suite ;
- au téléphone, le Support avec une seule demande laissait une bande sombre de cent points sous le logo (la grille
  donnait le vide à la barre du haut) : le vide reste en bas ;
- le nom d'un client coupé en plein mot (« Studi o Lina ») par les deux puces : elles passent dessous ;
- « Closes » seul sur sa ligne : les trois vues tiennent (« À moi ») ;
- le titre d'une fenêtre se terminait par « … » (repris du menu) : il ne le porte plus ;
- l'attente de la technique, en minuscule en tête de ligne : une majuscule.


## Revu à la souris et au clavier (15/10/2026, 1.23.0 : la mesure)

Sur l'essai de l'outil humain, la base passée en `0116`, dans la console : Amira (direction), en clair et en sombre, à
1440 et à 390. L'entrée « Mesure » sous « La plateforme », entre Service et Réglages ; le bandeau de l'entonnoir (deux
essais finis ces trente jours, un abonné : « 50 % ») et ses quatre étapes ; les inscriptions qui suivent la période
(« 13 cette semaine », puis « 13 ce mois-ci, 0 le mois dernier ») ; les départs ; les trois offres ; le support dans son
délai ; la liste des événements, « proposée, à décider ». Corrigé pendant le parcours :
- « 1 membres », « 0 pièces émises » : le singulier sous deux ;
- le « % » d'une promesse, détaché de son chiffre dans la police des chiffres : la police du texte, les chiffres alignés ;
- les modules d'une offre, une phrase de cinq lignes dans une case étroite : « en plus : la paie chez 0 %… » ;
- au téléphone, « 30 derniers jours » seul sous les deux autres périodes : les trois sur une ligne ; les quatre étapes
  deux par deux ;
- les périodes de l'en-tête décalées de 24 points à droite (la marge des pilules d'une carte) : alignées.

## Revu à la souris et au clavier (15/10/2026, 1.24.0 : ton compte)

Sur l'essai de l'outil humain, la base passée en `0117`, dans la console : Karim (support) en sombre et en clair, à 1440
et à 390 ; Amira (direction) de l'équipe à son compte et retour. « Équipe » ouvre « Ton compte » ; changer de code refait
**de bout en bout** à la souris (le refus sans code actuel sur son champ, le code QR et la clé, un code faux refusé, le
bon : les dix codes de secours, puis « Son code changé » dans les gestes récents) — Karim se reconnecte ensuite avec le
nouveau. Corrigé pendant le parcours :
- l'écran vide : le nom d'un geste du journal écrit avec un tiret (`abonnement.offrir-mois`) ne se trouvait pas au
  catalogue : le même nom que le journal ;
- « Ou tape à la main cette clé :. » : un point de trop ;
- par défaut, la méthode qu'on a déjà (le cas courant : un nouveau téléphone), pas l'autre ;
- huit appareils de l'essai poussaient « Tes gestes » sous l'écran : trois dans la page, les autres d'un clic.

## Revu à la souris et au clavier (15/10/2026, 1.25.0 : inviter quelqu'un)

Sur l'essai de l'outil humain, la base passée en `0118` : Amira (direction) invite une adresse inventée comme support ;
le lien se montre, se copie ; l'invitation attend dans la liste et dans « À régler ». Dans un autre navigateur, l'invitée
ouvre le lien, crée son compte, entre (l'adresse déjà remplie), pose son code (sans cocher « Je les ai mis de côté » :
refusé, la case rougit) puis arrive sur « Bonjour Nesrine ». Corrigé pendant le parcours :
- le serveur refusait de démarrer : une route publique sous `/console/` n'était permise qu'à la connexion — le lien
  d'une invitation aussi, désormais ;
- après « Entrer dans la console », l'adresse était à retaper : elle est remplie, le curseur va au mot de passe ;
- « À régler » disait d'aller poser le code dans l'application à un membre qui le pose maintenant à sa première
  connexion : il dit jusqu'à quel jour ;
- les étapes de la pose du code, décalées à droite sans leurs numéros : alignées sur le titre ;
- la page de l'invité plantait sur deux phrases du catalogue du serveur, que l'écran ne connaît pas : les siennes.


## La recette complète, à la souris et au clavier (19/10/2026, 1.58.0)

Demandée par Skander : « tu vas me tester toute la console […] comme un humain, clavier souris […] avec un regard d'un
senior designer UI/UX, et testeur senior de logiciel et de backoffice, et ingénieur ergonomie ». Sur la machine de l'outil
humain (`scripts/humain/lancer.sh`, l'exemple de la console et un mois de mesures inventées), la base passée en `0145` :
Amira (direction) entre (un mot de passe faux, puis un code faux, puis les bons), parcourt **chaque écran** à 1440 — À
décider, Clients et une fiche, Abonnements, Paiements, Support, Nos factures, Données personnelles, les huit vues du
Service, Mesure, Réglages, Équipe, Journal —, fait un geste de bout en bout (prolonger la grâce d'Atelier Mejri, au menu
« Gestes » parcouru aux flèches), passe en sombre, rétrécit la fenêtre à la largeur d'un téléphone, et se déconnecte.

Ce qui tient : l'entrée en deux étapes (chaque refus montre son champ), Ctrl+K, le menu des gestes au clavier (le geste
rouge à part), l'aperçu « aujourd'hui → après le geste », Échap qui demande avant de jeter une saisie (le curseur sur
« Reprendre »), les chiffres d'un écran à l'autre (la grâce prolongée se lit partout au même jour), l'honnêteté de ce qui
n'est pas mesuré, le sombre et le téléphone.

Corrigé dans la version :
- **Entrée** dans un champ d'une ligne valide la fenêtre (le bouton principal ; ⌘/Ctrl + Entrée depuis un motif) ; jamais
  un bouton rouge : un geste qui détruit se clique ;
- un refus reste à sa place jusqu'au clic suivant (rien ne remonte sous le curseur), mais **passe en retrait** dès qu'on
  retape : il ne dit plus le dernier mot ;
- le curseur entre dans le **premier champ qui reste à remplir** (le motif, quand le nombre de jours est déjà posé) ;
- Journal : « lecture seule reculée au 30/10 » pour un geste qui la mettait au 31/10 (la fiche, l'aperçu, Abonnements) —
  c'était le **dernier jour du délai**, il se dit ainsi ;
- Journal : « Gestes de l'équipe 4 » ouvrait une liste de 7 (les gestes de l'outil de l'exploitation) : le chiffre compte
  ce que sa liste montre (base 0146) ;
- Sécurité : « 1 code faux · à regarder · chacun se regarde ci-dessous » au-dessus de « rien ne demande un regard » : la
  tuile ne demande un regard que quand la liste en a un (trois codes faux de suite) ;
- Support sans demande : plus de grand cadre vide à droite ; la liste et son explication prennent la largeur ;
- Support : passer de « Ouvertes » à « À moi » (vide) gardait à côté la demande ouverte d'avant, qui n'est pas à moi (vu
  quand tous les essais ont tourné ensemble, avec des demandes des autres) : changer de vue ferme la demande qui n'y est
  pas, et la plus urgente **de la vue** s'ouvre ;
- Abonnements : un libellé court poussé à droite de sa carte, une rangée qui ne remplissait pas la largeur : le libellé à
  gauche et son point à droite (comme les Clients), six cartes en six colonnes ;
- Paiements : tant que l'entreprise SkanFact n'est pas désignée, c'est l'étape suivante (le bouton principal), pas
  « Ajouter un coût » ;
- Service : « 99,2 % sous le budget » puis « jamais au-dessus du budget » : c'est **la courbe des 95 %** qui ne l'a jamais
  dépassé ;
- Fiche : « sa prochaine période, qui commence le 17/10 », lu le 19 : « à partir du » ;
- Journal, pied : « ce qui concerne des personnes :. À VÉRIFIER » : la ponctuation ;
- au téléphone, **Échap** referme le menu ouvert.
- **l'entrée** (vu en refaisant la recette à l'écran, avant l'envoi) : sans adresse remplie d'avance, la première lettre
  tapée dans l'adresse envoyait le curseur au mot de passe, et la suite de l'adresse s'y écrivait. Le curseur se pose une
  fois, à l'ouverture (l'adresse, ou le mot de passe quand une invitation l'a remplie) ; il ne suit plus ce qu'on tape.

Expliqué, sans changement : l'accueil compte 13 inscriptions « ces 7 derniers jours » (une ligne par organisation), la
Mesure 11 « cette semaine » (depuis lundi, les seules entreprises) : deux questions, chacune nommée. Laissé pour plus tard :
des suggestions sous la recherche de l'accueil pendant la frappe (Entrée ouvre déjà les Clients filtrés).
