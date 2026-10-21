# Les sauvegardes, vues de l'entreprise

*21/10/2026, lot Fonctions 3 (1.90.0). Le cadrage fait foi : `docs/cadrage/06-securite-et-hebergement.md` § 4 (ce qu'on
promet de pouvoir reprendre), § 4.4 (remettre UNE entreprise). Ce document dit ce qui en est fait.*

## Ce qui change pour la personne

La v10 de bureau montrait ses copies du disque ; la plateforme cachait ce panneau, et rien ne disait au propriétaire que
ses données étaient gardées. Dans **Paramètres › Données et sécurité**, sous « Toutes les données de l'entreprise », le
panneau **« Tes sauvegardes »**, pour le propriétaire et un administrateur :

- ce que SkanFact fait : une copie chaque nuit à 3 h 30 (heure de Tunis), les 14 dernières nuits gardées, de quoi revenir
  à n'importe quelle minute des 35 derniers jours, et un essai de restauration le 1er de chaque mois ;
- ce que la surveillance du serveur (la veille) a vu, **tel quel** : la dernière copie de la nuit, réussie ou **échouée**
  (avec alors la dernière réussie), la copie hors de la machine (à jour, en attente depuis…, ou **pas encore en place**),
  le dernier essai de restauration (ou « pas encore fait »), un archivage à la minute arrêté ; une surveillance muette
  depuis plus de 5 minutes se dit (« ces informations datent du… ») au lieu d'un état ancien lu comme celui de maintenant ;
- les retours en arrière déjà faits pour l'entreprise : quand, à quelle minute, pourquoi ;
- **« Demander de revenir en arrière… »** : le jour, l'heure (Tunis) et le motif. La fenêtre dit d'abord ce qui
  disparaîtrait (tout ce qui a été fait après cette minute ; les autres entreprises ne bougent pas). Rien ne change :
  la demande part au support (« Tes demandes au support ») ; l'équipe fait d'abord l'essai, qui ne change rien et nomme
  les pièces numérotées qui disparaîtraient, puis le dit à la personne avant de faire quoi que ce soit.

## Comment

- **La base** (migration 0161) : `plateforme.mes_sauvegardes(entreprise, maintenant)` lit ce que la veille a écrit
  (`service_nuit`, le dernier `service_releve`) et les remises de cette entreprise dans sa piste d'audit ; rien d'autre (ni
  une autre entreprise, ni un chemin, ni une adresse de la machine). Le propriétaire ou un administrateur, en personne
  (`plateforme.sauvegardes_exiger`).
- **Les routes** (`serveur/sauvegardes.ts`) : `GET /entreprises/:e/sauvegardes` (geste `socle.sauvegardes.voir`),
  `POST /entreprises/:e/sauvegardes/revenir` (geste `socle.sauvegardes.demander`) : une minute passée et dans les 35 jours
  gardés, sinon un refus qui dit pourquoi ; la demande au support porte la minute et le motif (`page` : `sauvegardes`).
- **L'écran** : `dessinerSauvegardes` (plateforme/pont.js) ; l'entrée du panneau et sa bulle « i » (web/v10/sauvegardes-ecran.txt).
- Les horaires et la garde viennent des mêmes constantes que la console (`serveur/console/sauvegardes.ts`, que des tests
  relient aux tâches d'entretien).

## Décisions (par délégation, 21/10/2026)

- **Pas de retour en arrière d'un clic** : il efface ce qui a été fait depuis. La personne le demande ; l'équipe le fait
  avec la remise d'une entreprise (essai d'abord, 06 § 4.4), préparée depuis la console.
- **Rien d'interne** : la personne lit l'état des copies, jamais où elles sont ni comment le serveur s'appelle.
- **Le propriétaire et un administrateur** seulement, comme « Toutes les données de l'entreprise ».

## Ce qui n'est pas couvert

- La personne ne choisit pas une nuit dans une liste : la minute suffit (l'équipe choisit la copie qui y mène).
- Le Cabinet ne voit pas ce panneau (il ne voit pas l'entreprise en entier).

## Tests

`tests/socle/sauvegardes-ecran.test.ts` (ce que lisent le propriétaire et un administrateur ; un commercial et la voisine
refusés ; la veille muette ; la demande et ses refus) et `tests/web/sauvegardes-ecran.test.ts` (le panneau à la souris,
la fenêtre, le refus sans motif qui montre la case, la demande envoyée ; un commercial sans panneau). Preuves dans
`tests/preuves.sh`.
