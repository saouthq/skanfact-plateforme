# Toutes les données de l'entreprise

*12/10/2026, second envoi du lot « a » (« Télécharger toutes mes données »). Le cadrage fait foi : `docs/cadrage/03-droits.md`
du dépôt `skanfact` (« Export complet » : le propriétaire et l'administrateur, qui prévient le propriétaire), `04` (« il
doit contenir tout, pas ce que le poste a »), `07` (« jamais de données en otage » : l'export reste possible en lecture
seule, à tout moment) et la vision § 10 (la réversibilité, un format ouvert). Les décisions marquées « par délégation »
sont prises le 12/10/2026.*

L'onglet « Données et sécurité » ne proposait aucun moyen de récupérer ses données : la plateforme cache les panneaux de
la v10 de bureau qui le faisaient (le fichier sur le disque, ses sauvegardes), et rien ne les remplaçait. L'outil
d'exploitation savait exporter une entreprise depuis le jalon J1 (`base/entreprise.ts`), avec un compte
d'administration ; le serveur, lui, n'a jamais de connexion d'administration.

Le code : la base `base/migrations/0080_export_complet.sql`, l'export `base/entreprise.ts` (`exporterDans`, le lecteur
« entreprise »), la route `GET /entreprises/:entreprise/export` (`serveur/routes/socle.ts`), l'option `instantane` de
`enTantQue` (`serveur/base.ts`, `serveur/app.ts`), le panneau `dessinerExport` (`web/public/plateforme/pont.js`) branché
par `web/v10/export-complet.txt`. Les tests : `tests/socle/export-complet.test.ts` (deux chemins, un fichier) et
`tests/web/export-complet.test.ts` (à la souris).

## Ce que fait l'envoi

**X1. Le panneau « Toutes les données de l'entreprise »**, en tête de l'onglet « Données et sécurité » des Paramètres, pour
le propriétaire et un administrateur (03 ; ce qui n'est jamais à portée ne se montre pas, D3). « Télécharger toutes les
données » enregistre un fichier `skanfact-<raison sociale>-<jour>.jsonl` ; la ligne dessous dit son nom et son poids, dans
une place réservée (rien ne bouge sous le clic). Hors ligne, le refus le dit : l'export demande le serveur (04).

**X2. Le fichier est celui de l'outil d'exploitation, au caractère près** (deux chemins, un fichier). Un en-tête (le
format, l'entreprise, sa raison sociale, l'heure, les migrations de la base), puis chaque table : ses lignes telles que
PostgreSQL les écrit en JSON, et la fin, scellée par l'empreinte de tout ce qui précède. Il **se restaure à
l'identique** (`npm run entreprise -- restaurer <fichier>`, sur une base au même niveau de migrations). Il ne porte
aucun mot de passe, aucune clé d'appareil, aucun code de cabinet, aucun secret de connexion (`CLASSEMENT`).

**X3. Fabriqué au nom de la personne, sous la sécurité par ligne** (règle du dépôt : jamais de connexion
d'administration dans le serveur). Elle y voit toutes les lignes de son entreprise ; elle ne voit pas ce qu'elles
désignent ailleurs, et qui part avec elles comme une **référence** (sans secret) : le cabinet qui la tient ou l'a tenue,
ses collaborateurs, les personnes et les appareils qui ont agi chez elle sans en être membres (le support), les
appareils de ses collègues. Quatre fonctions de la base les rendent (`socle.export_membres`, `export_organisations`,
`export_utilisateurs`, `export_appareils`), pour le propriétaire et l'administrateur seulement, **pour les seuls
identifiants que le serveur demande** — ceux que les lignes de l'entreprise désignent — **et parmi ceux qui touchent
l'entreprise** (membre d'elle, de son groupe ou d'un cabinet qui a eu un mandat sur elle, ou nommé par sa trace) : une
fonction ne rend jamais une personne étrangère à l'entreprise, même si on la lui demande. Une cinquième rend la liste des
migrations, que l'en-tête porte.

**X4. Les transferts de propriété de l'entreprise se lisent par le propriétaire et l'administrateur** (par délégation).
Seuls celui qui transfère et celui qui reçoit les lisaient : l'export d'un administrateur, ou d'un propriétaire arrivé
par un second transfert, les aurait perdus. La trace les nommait déjà.

**X5. Deux brouillons du cabinet ne partent pas, ni par l'entreprise ni par l'exploitation** (par délégation) : une
question qu'il n'a pas encore envoyée (elle reste avec sa révision, qui lui appartient, comme `cabinet.revision`), un
fichier déposé sans être joint à un message (un dépôt en cours, que seul son auteur lit). L'entreprise ne les lit pas ;
les emporter aurait fait deux fichiers différents.

**X6. Une photographie de la base** : la route le déclare (`instantane`), et sa transaction lit tout au même instant
(« repeatable read ») : une facture émise pendant l'export ne part pas sans ses lignes.

**X7. Tracé, dans le fichier même.** Le geste `socle.export_complet` est une lecture sensible (03 D10) : sa trace est
écrite avant l'export, au nom de qui télécharge et avec son appareil, et part dans le fichier.

**X8. Ce qui part vers le serveur** : rien de plus que la demande. Ce qui en revient : le nom du fichier, son contenu et
son poids.

## Ce qui n'est pas fait, et pourquoi

- **Prévenir le propriétaire** quand un administrateur télécharge (03 D7, « un export complet » dans la liste de ce qui
  prévient). Le geste le déclare (`prevenirProprietaire`), comme les autres gestes sensibles ; **rien ne lit ce drapeau**,
  pour aucun geste (déjà noté au lot équipe). À brancher sur l'alerte par e-mail, sans contenu, une fois pour tous.
- **Une version lisible sans outil** (les pièces en PDF, les journaux en tableur). Le fichier complet est la garantie :
  tout y est, dans un format ouvert, et il se remet en place. Les PDF et les tableurs restent dans l'application, pièce
  par pièce et journal par journal. À décider avec Skander si un client qui part doit les recevoir d'un coup.
- **La lecture seule de fin d'abonnement** n'existe pas encore (aucune condition de la porte au socle) ; le jour où elle
  viendra, elle devra laisser passer `socle.export_complet` (07 : l'export reste possible à tout moment).
