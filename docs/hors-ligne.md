# Le hors-ligne sur la plateforme

*30/09/2026, brique 72. Le cadrage fait foi : `docs/cadrage/04-hors-ligne-et-synchro.md` du dépôt
`skanfact` (ce qui marche pendant une coupure, ce que le poste garde, la file d'envoi). Ce document dit
ce qui en est fait, décision par décision.*

## Brique 72 : l'application installable, qui s'ouvre et se consulte sans réseau (fait le 30/09/2026)

**H1. L'application s'installe, et ses écrans se gardent sur le poste** (par délégation). Un manifeste
(`web/public/manifest.webmanifest`, ses icônes dans `web/public/icones/`) et un service des écrans
(`web/public/sw.js`) : il garde les **écrans** (pages, scripts, styles, icônes), **jamais les données**
— l'API (`/v1`) ne passe jamais par lui. Réseau d'abord : en ligne, la dernière version (gardée au
passage, pour qu'un écran périmé ne s'ouvre jamais sans réseau) ; sans réseau, celle gardée. Les pages
d'entrée et ce qu'elles chargent se gardent dès l'installation.

**H2. Sur « mon ordinateur », la session se garde dans le navigateur ; sur l'ordinateur d'un autre,
dans l'onglet seulement** (par délégation). Jusqu'ici la session vivait dans l'onglet : l'application
refermée demandait de se reconnecter, et ne pouvait donc pas se rouvrir sans réseau. La case « je suis
sur le poste de quelqu'un d'autre » de l'entrée décide : cochée, rien n'est gardé (03 § 6). Le serveur
ferme toujours une session inactive (12 heures, 30 minutes sur l'ordinateur d'un autre). **Une nouvelle
connexion efface ce que le poste gardait de la précédente**, et se déconnecter l'efface aussi, même sans
réseau.

**H3. Une copie de l'entreprise, chiffrée, sur « mon ordinateur » seulement** (par délégation). Après
chaque lecture et chaque enregistrement, le point de contact garde ce que le serveur a (les objets du
dossier et leurs révisions), chiffré en AES-GCM par une clé de l'appareil que le navigateur ne laisse
jamais sortir (`extractable: false`), dans la base du navigateur (`web/public/plateforme/poste.js`).
Sans réseau, l'entreprise s'ouvre dessus, et l'entrée ouvre d'elle-même la dernière entreprise dont le
poste a une copie. **Limite honnête** (04 § 2) : le chiffrement protège un disque volé, pas un poste
allumé et ouvert ; la parade, c'est la révocation de l'appareil (à venir). **À VÉRIFIER** (04 § 11.2) :
le stockage persistant, que Chromium n'accorde pas à une page non installée.

**H4. Le bandeau dit ce qu'on voit et ce qui attend** (par délégation). Sans réseau : « Hors ligne
depuis 14 h 32. Tu consultes la copie de ce poste, du 30/09/2026 à 11 h 58. Enregistrer demande le
réseau : ce que tu changes maintenant ne part pas. » (ou « Ce que tu vois reste à l'écran » si la page
était ouverte avant la coupure). Le réseau revenu sur une copie : « Recharger ». Sans copie : la raison,
et « Réessayer ». Le menu des entreprises reste ouvert sans réseau (l'entreprise ouverte), pour que
« Se déconnecter » y soit toujours.

**Ce que la brique ne fait pas encore** : enregistrer sans réseau. Un enregistrement tenté pendant la
coupure est refusé, et la v10 le dit (« Rien n'a été enregistré », avec « Réessayer ») : rien n'est perdu
tant que l'onglet reste ouvert. **La brique suivante** : la file d'envoi (04 § 4), qui garde ces
changements sur le poste et les envoie seule au retour du réseau, et « À reprendre ». Le Cabinet n'a pas
encore son hors-ligne (04 § 2 : les dossiers qu'on choisit d'emporter).

**Les tests** (`tests/web/hors-ligne.test.ts`, dans un vrai navigateur ; le réseau se coupe pour de
vrai — le serveur s'arrête et revient au même port, car le service des écrans passe à côté de la
coupure que le navigateur simule) : la copie est sur le poste, le nom d'un client ne s'y lit pas, la
clé n'est pas exportable, et une relecture la refait ; sans réseau, la page se recharge et l'entreprise
se consulte, le bandeau le dit ; l'application refermée se rouvre depuis l'entrée ; le réseau revenu,
« Recharger » montre ce qu'un autre a ajouté ; se déconnecter sans réseau efface la copie, sa clé et la
session ; une page mise à jour vue en ligne est celle qui s'ouvre sans réseau ; sur l'ordinateur d'un
autre, rien n'est gardé et l'écran le dit ; par l'entrée, la case décide où vit la session, et une
nouvelle connexion efface les copies de la précédente.
