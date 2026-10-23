# 07 — Offres et prix

*Décidé le 28/09/2026 par Claude, **par délégation de Skander** (« je te laisse décider à ma place
c'est quoi le meilleur moyen »). **Révisable après les entretiens terrain** (questionnaire en annexe
de `docs/etudes/ETUDE-MARCHE.md`). Rien ici ne concerne l'application actuelle (v10), dont les prix
restent ceux de `docs/application-actuelle/TARIFS-REFERENCE.md` (dépôt `skanfact`, archivé). **Révisé le même jour** (par
délégation, `14` § 6) pour s'aligner sur Hesabi : le stock et une caisse entrent dans Essentiel, les
modules de métier entrent dans Complet, les caissiers et serveurs ne comptent pas comme
utilisateurs. **Révisé le 14/10/2026 par Skander** : plus aucune offre ne compte les utilisateurs ; les deux remises de
20 % (groupe, cabinet) ne s'additionnent pas ; **tout se règle depuis la console** (plus bas).*

## Les principes

1. **Un prix par entreprise, jamais par utilisateur** (décision du 27/09/2026). Grandir en nombre de
   personnes ne doit jamais coûter cher.
2. **Aucune obligation légale n'est vendue en option.** La facture électronique signée et envoyée à
   la TTN, la retenue à la source avec ses certificats TEJ, et la déclaration de TVA prête à copier
   sont dans **toutes** les offres payantes. C'est la règle de la 10.7.0 (« une offre peut fermer un
   confort, jamais une case de déclaration »), et l'étude de marché confirme que c'est aussi le bon
   argument de vente.
3. **Le comptable ne paie pas pour les clients qui paient déjà.** Le cabinet est le canal de vente le
   plus puissant (Pennylane, étude § « Canaux ») ; lui faire payer l'accès à ses propres clients
   freinerait exactement ce canal.
4. **Un prix se lit en une ligne.** Pas de devis sur demande, pas de prix caché : c'est l'argument de
   transparence face au circuit Sage.
5. **Au prix de Hesabi Starter (390 DT/an), avec ce que Hesabi vend 790 DT** : Essentiel a le stock
   et la caisse comme leur Starter, plus la facture électronique signée, TEJ, la lecture de documents
   et l'API de leur Pro ; et en plus, le hors-ligne et le comptable gratuit (`14` § 1).

## La grille

Prix hors taxes. La TVA s'ajoute (**À VÉRIFIER** : taux applicable à un abonnement logiciel).

| Offre | Par an | Par mois | Ce qu'elle contient |
|---|---|---|---|
| **Essai** | 0 | — | **30 jours**, sans carte, **tout ouvert**, avec l'exemple à découvrir |
| **Essentiel** | **390 DT** | 39 DT | Devis, factures, avoirs, clients, catalogue ; commandes, livraisons ; achats, commandes fournisseurs, réceptions, dépenses, fournisseurs ; **stock** ; **une caisse** (au comptoir ; le mode restaurant s'y ajoute en vague 1) ; banque et trésorerie ; relances ; tableau de bord, statistiques, marges et balance âgée ; **facture électronique signée et envoyée à la TTN** ; **retenue à la source et certificats TEJ** ; **déclaration du mois prête** (TVA, retenues, taxes sur les salaires) ; **espace client et paiement en ligne** ; **lecture des factures en photo ou en PDF** ; **API** ; le comptable dans les mêmes données ; web, téléphone, installée, bureau, hors ligne ; **utilisateurs illimités** (depuis le 14/10/2026) ; 1 établissement |
| **Complet** | **690 DT** | 69 DT | Tout Essentiel **+ tous les modules** : paie (jusqu'à 20 salariés), comptabilité complète, et les modules de métier à leur sortie (Réservations, Production, Projets : `02` § 2) ; **2 caisses** ; **utilisateurs illimités** ; 2 établissements |

**Les modules, pour qui prend Essentiel** (par an, hors taxes) :

| Module | Prix | Pourquoi ce prix |
|---|---|---|
| Caisse supplémentaire | + 120 DT par caisse | Une caisse de plus = un poste de vente de plus (la première est dans Essentiel) |
| Paie | + 150 DT jusqu'à 10 salariés, puis + 12 DT par salarié et par an | La paie coûte en travail de mise à jour (lois de finances, CNSS) |
| Comptabilité complète (grand livre, états, clôture d'exercice, liasse) | + 150 DT | Pour l'entreprise **sans** cabinet ; avec un cabinet, c'est le cabinet qui tient la comptabilité |
| Réservations, Production, Projets (à leur sortie : vague 1, puis vague 3) | + 120 DT chacun | Un métier de plus, au prix d'un module |

Paie et comptabilité complète prises ensemble coûtent 300 DT, soit **le prix de Complet** (390 + 300
= 690 DT) : Complet est donc **toujours au moins aussi avantageux** dès qu'on en veut deux, avec en
plus une caisse et un établissement.

**Au-delà de l'offre** :
- ~~Utilisateur supplémentaire (Essentiel) : 30 DT par an~~ — **retiré le 14/10/2026 par Skander** : une petite
  entreprise a 1 à 3 personnes au bureau (les caissiers et le comptable ne comptaient déjà pas), ce prix ne rapportait
  presque rien, compliquait l'équipe (compter, prévenir avant d'inviter) et contredisait le premier principe. Les
  utilisateurs sont illimités dans toutes les offres.
- Établissement supplémentaire : **120 DT par an** (avec sa série de tickets ; la caisse se paie à part).
- Salarié au-delà de 20 (Complet) : **12 DT par an**.

**Mensuel ou annuel** : l'annuel est proposé d'abord (deux mois offerts). Le mensuel existe parce
qu'une petite boutique paie souvent au mois. Il n'y a pas de prélèvement automatique en Tunisie :
chaque échéance est annoncée avant, et se paie en un clic (Konnect) ou par virement.

## Les groupes

Chaque société a son abonnement. **À partir de la deuxième société du même groupe : − 20 %** sur
chacune des suivantes (confirmé par Skander le 14/10/2026).

**Les remises ne s'additionnent pas** (Skander, 14/10/2026) : une société qui aurait droit à deux remises (le groupe
et le parrainage de son cabinet) a la plus forte, jamais leur somme.

Précisé par Skander le 14/10/2026 (fait en 1.15.0, `docs/abonnement.md` C17) :
- **le groupe se déclare dans la console**, par la direction, avec son motif (rien ne se devine) ; la console propose
  les sociétés qui ont la même propriétaire, et en trouve une autre par son nom, son matricule ou son propriétaire. Une
  société n'est que dans un groupe à la fois ; elle y entre et en sort à son jour ;
- **la première abonnée paie le prix normal** : la société du groupe dont la première période payée est la plus
  ancienne ; les autres ont la remise, pour chaque période qui commence pendant qu'elles sont dans le groupe ;
- **la remise porte sur toute la facture hors taxes** : l'offre et ce qui s'y ajoute (modules achetés seuls, caisses,
  établissements, salariés au-delà de l'offre) ; arrondie au millime le plus proche, comme la remise d'une pièce de la v10.

## Les cabinets comptables

| Ce que le cabinet a | Prix |
|---|---|
| Les dossiers de ses clients **abonnés** à SkanFact | **Gratuit, sans limite** |
| Les dossiers qu'il **tient lui-même** (client pas abonné) | **3 gratuits**, puis **60 DT HT par dossier et par an** |
| Plafond | **Jamais plus de 1 990 DT HT par an**, quel que soit le nombre de dossiers (sous les 2 490 DT de Hesabi) |
| Collaborateurs | **Illimités** |
| Lettres de mission, **facturation de ses honoraires** (factures électroniques à ses clients), dépôts groupés (`14` § 2.4) | **Compris** (Hesabi vend son offre cabinet 2 490 DT) |

**Un dossier tenu qui devient abonné devient gratuit** le jour même : le cabinet a intérêt à faire
venir ses clients, et le client a intérêt à rejoindre son dossier.

**Parrainage** : un client qui arrive par son cabinet (avec le code du cabinet) a **− 20 % la première année**
(confirmé par Skander le 14/10/2026, puis le prix normal). **Jamais de commission versée au comptable** (déontologie,
décision de la 7.33.0, **À VÉRIFIER** avec l'Ordre).

Comment SkanFact sait qu'un client « arrive par son cabinet » : Skander a demandé le 14/10/2026 ce qui était le mieux ;
choisi par délégation (fait en 1.15.0) : **un client confie son dossier à un cabinet avec le code du cabinet AVANT son
premier paiement** (le mandat accepté, en cours ou arrêté depuis). C'est un fait que la plateforme connaît déjà (le
mandat, avec sa date), que le client a fait lui-même (rien à déclarer ni à contrôler à la main), et qui ne se fabrique
pas après coup : un client déjà abonné qui confie ensuite son dossier n'est pas « venu par » son cabinet. La première
année se compte depuis sa première période payée : chaque période qui commence dans les douze mois a la remise.
Reprendre un dossier que le cabinet tenait déjà (un client qui devient abonné, plus haut) n'existe pas encore dans la
plateforme ; il s'y branchera quand il existera.

### Comment l'abonnement du cabinet s'applique (Skander, 23/10/2026)

Proposé par Claude, accepté par Skander (« oui d'accord go », 23/10/2026). Le cabinet est le canal de vente : l'argent
vient des entreprises ; le prix du cabinet sert surtout à le pousser à faire abonner ses clients.

1. **Le prix** reste celui de la grille : 3 dossiers tenus gratuits, puis 60 DT HT par dossier tenu et par an, jamais plus
   de 1 990 DT HT par an. Comme tout prix, il vit dans la base, daté, et la direction le change dans la console.
2. **Quand facturer : une facture par an, et un rattrapage.** L'abonnement du cabinet commence le jour où il a plus de
   dossiers tenus que de gratuits (le 4ᵉ) : ce jour devient son anniversaire. Chaque année à cette date, une facture compte
   les dossiers tenus payants ce jour-là. Un dossier ajouté en cours d'année se rattrape au prorata des jours sur la
   facture suivante (la règle du module ouvert en cours de période, 0113). Pas de facture au mois pour un cabinet.
3. **Le 4ᵉ dossier : jamais bloqué, prévenu avant.** Le dossier se crée librement ; avant le geste, l'écran dit ce qu'il
   coûtera (« ce dossier est ton 4ᵉ dossier tenu : il sera facturé 60 DT par an »).
4. **Sans paiement : jamais de données en otage, jamais les clients du cabinet en difficulté.** Les dossiers de ses
   clients abonnés restent entiers (ils paient eux-mêmes) ; les 3 dossiers gratuits aussi. Après l'échéance et la grâce,
   les dossiers tenus payants passent en lecture seule (tout se lit, s'imprime, s'exporte) et la création d'un nouveau
   dossier tenu se ferme ; le paiement rouvre tout.
5. **Un dossier tenu que son client rejoint** (il devient abonné, 0155) ne se compte plus à la facture suivante. Choix de
   Claude dans le détail : la période déjà payée ne se rembourse pas.

**À VÉRIFIER aux entretiens** : 60 DT par dossier tenu (question 2 plus bas), le nombre de dossiers d'un cabinet type
(au-delà de 36, le plafond joue), et, avec l'Ordre, qu'un comptable peut pousser ses clients à s'abonner (jamais de
commission versée).

## Après l'essai, et en cas d'impayé

- À la fin de l'essai ou d'une période payée sans renouvellement : **lecture seule**. On voit tout, on
  exporte tout, on ne crée plus rien. Jamais de données en otage (6.4.0).
- Les données sont gardées **au moins 10 ans** (obligation de conservation des pièces, **À VÉRIFIER**
  avec un juriste), et l'export complet reste possible à tout moment.
- Un rappel **15 jours**, **7 jours** et **la veille** de l'échéance, puis **7 jours de grâce** pendant
  lesquels tout marche encore, avant la lecture seule.

## Tout se règle depuis la console (Skander, 14/10/2026)

« Je dois avoir la main sur tout à partir de la console : si je veux changer quelque chose, on passe par la console et
pas par le code. » Tout ce qui fait le prix et l'abonnement vit donc dans la base, **daté**, et la direction le change
dans la console (Réglages), avec son motif et sa ligne au journal ; le code ne garde que la façon de calculer :
- les prix des offres et de chaque ajout (à l'année ; au mois, un dixième par défaut) ;
- ce que chaque offre comprend (modules, caisses, établissements, salariés) ;
- les remises (groupe, parrainage) ;
- l'essai, la grâce, les rappels avant l'échéance ;
- **le préavis d'un nouveau prix : 30 jours** (Skander, 14/10/2026), lui aussi réglable dans la console. Un prix
  préparé aujourd'hui ne peut commencer qu'au bout de ce délai, et l'application l'annonce aux clients.

Fait dans la plateforme : les prix des offres et des ajouts, et le préavis (1.12.0, 14/10/2026 ; la facture d'une période
se prend au prix de son premier jour) ; l'essai, la grâce et les rappels (1.13.0, 14/10/2026 ; l'essai se fixe à la
création de l'entreprise, la grâce d'une échéance est celle de son lendemain : une règle changée ne touche jamais ce
qui a commencé) ; ce que chaque offre comprend (1.14.0, 14/10/2026 ; un changement se prépare avec le préavis d'un
prix, choix de Claude à confirmer par Skander, et une période garde ce qu'elle comprend, sur sa facture comme pour ses
modules ; Skander a confirmé ce préavis le 14/10/2026) ; les remises (1.15.0, 14/10/2026 ; leur taux, et pour le cabinet sa durée en mois, se préparent avec le
préavis d'un prix ; la facture d'une période porte la remise de son premier jour). Les places de fondateur, prévues
ensuite, sont abandonnées (Skander, 14/10/2026, plus bas).

## Les premiers clients (fondateurs) — abandonné

*Décidé au cadrage (27/09/2026) : les 100 premières entreprises et les 20 premiers cabinets gardaient leur prix deux
ans, quoi qu'il arrive à la grille.* **Abandonné par Skander le 14/10/2026** (« ça va nous rajouter du travail pour
rien ») : aucun prix n'est garanti à personne ; tout le monde paie la grille du premier jour de sa période, moins sa
remise de groupe ou de cabinet s'il y a lieu. Rien ne se promet donc aux premiers clients sur le prix (ni dans
l'application, ni sur le site, ni à l'oral).

## Ce qui n'est pas dans le prix

- **Le certificat de signature** (DigiGo ou clé USB TunTrust) : il appartient à l'entreprise et se
  paie à TunTrust. **À VÉRIFIER** : son prix, pour l'annoncer honnêtement sur la page des tarifs.
- **Le matériel de caisse** (imprimante de tickets, tiroir, douchette, imprimantes de cuisine) : on
  dit lequel marche, on ne le vend pas.
- **Les frais des partenaires** que l'entreprise choisit : la commission de Konnect sur un paiement
  en ligne, et plus tard les SMS de relance, WhatsApp automatique, les sociétés de livraison. Chacun
  est annoncé **avant** d'être allumé, jamais caché dans notre prix.

## Ce que les entretiens doivent confirmer

1. 390 DT par an est-il accepté par un indépendant ou une petite entreprise ? (entretiens, § A)
2. Un cabinet accepterait-il 60 DT par dossier tenu au-delà de trois ? (entretiens, § B, question 7)
3. Le mensuel à 39 DT : combien le préféreraient ? (entretiens)
4. Le stock et une caisse dans Essentiel : un commerçant ou un restaurateur trouve-t-il 390 DT juste
   pour sa caisse ? Les caisses tunisiennes spécialisées se vendent en licence ou à la journée
   (entretiens, `14` § 3.1).
