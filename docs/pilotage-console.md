# Le pilotage depuis la console — ce qui reste à faire (décidé par Skander, 25/11/2026)

« Ok go et note-les, n'oublie pas : on va tous les faire. » Tout est réservé au **titulaire de la console** (1.388.70) :
les collaborateurs lisent, ne changent rien. Chaque geste a son motif et sa ligne au journal.

Déjà fait : les modules (ouvert / bêta / à venir / fermé), l'exception par entreprise, la pause qui ne cache jamais les
données, le message de maintenance par module, le titulaire (1.388.69 → 1.388.70).

| # | Quoi | Ce que ça fait | État |
|---|------|----------------|------|
| 1 | Ouverture progressive | ouvrir un module à 10 %, 50 %, 100 % des entreprises (tirage stable par entreprise) | à faire |
| 2 | Volontaires bêta | une case « je veux essayer les nouveautés » chez le client ; la bêta s'ouvre à eux seuls | à faire |
| 3 | État programmé | « la caisse s'ouvre le 1er décembre à 8 h », une maintenance de 22 h à 23 h qui se lève seule | à faire |
| 4 | Retour automatique | un état posé pour un essai revient de lui-même après N jours | à faire |
| 5 | Lecture seule générale | tout le site en lecture pendant une grosse opération sur la base | à faire |
| 6 | Version minimale imposée | recharger les écrans trop anciens après une correction importante | à faire |
| 7 | Réglages à distance | limites, textes, délais changés sans nouvelle version | à faire |
| 8 | Droits par offre | quels modules chaque offre ouvre, réglés depuis la console | à faire |
| 9 | Console limitée à des adresses IP | la console ne s'ouvre que depuis les connexions du titulaire | à faire |
| 10 | Historique et annulation | chaque changement d'état revu, et « revenir à l'état d'avant » d'un clic | à faire |

Ordre retenu : 10, 3 et 4 (ils partagent la même table), 2, 1, 5, 6, 7, 8, 9. Une version par point, testée à l'écran avec
captures, mise en production quand GitHub est vert.
