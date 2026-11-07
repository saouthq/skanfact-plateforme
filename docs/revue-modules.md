# La revue complète des modules (05/11/2026)

Demande de Skander (05/11/2026) : pour chaque module qui reste, « le mettre à jour suite aux nouvelles fonctionnalités
qu'on a, comme la messagerie, mais aussi faire la refonte et voir ce qu'il manque et ce qu'on peut améliorer, afin de
faire des pages fonctionnelles pour travailler avec, et complètes métier, comme on fait avec les autres modules déjà
traités ». Les huit pages passées dans la nouvelle DA du 04 au 05/11 (1.277.0 à 1.283.0) n'avaient reçu que l'habillage
(en-tête, quatre chiffres, carte, téléphone) : elles repassent par cette grille.

## La grille (la même pour chaque module)

**A. Les fonctions de la plateforme, branchées** — chacune se vérifie à l'écran, ou s'écrit « sans objet » avec sa
raison :

1. **Le comptable** : ce que le module produit et qui intéresse le cabinet (un inventaire, un écart, une pièce douteuse)
   se lui dit d'un geste, depuis la page, dans la conversation (`ecrireAuComptable`, la messagerie) ; ce que le cabinet
   demande à propos d'une pièce du module y mène.
2. **Les justificatifs** : une pièce du module qui en a un le montre, et l'ouvre en grand.
3. **Le brouillon gardé** : un formulaire qu'on peut quitter garde sa saisie, et « Reprendre » la rend.
4. **La présence** : une pièce ouverte par deux personnes le dit (« Karim regarde aussi »).
5. **L'aide** : chaque champ a sa bulle « i » ; la page a sa visite guidée, aux fins honnêtes.
6. **Les droits** : ce que le rôle ne peut pas faire ne s'affiche pas en bouton actif ; le refus dit pourquoi.
7. **Les états** : vide (avec le geste), chargement, refus, lecture seule (abonnement), hors ligne.
8. **La navigation** : le menu à six familles, les vues de la page, la recherche globale, le retour.
9. **L'export** : ce qu'on regarde s'exporte, et l'export suit l'onglet.
10. **Les listes** : toute liste qu'on nomme se pagine ; un compteur et sa liste se calculent par la même fonction.

**B. Le métier** : ce qu'un commerçant, un artisan ou une PME tunisienne attend de ce module pour y travailler chaque
jour (le geste qui suit, les chiffres qui décident, ce que font Odoo et Hesabi), ce qui manque, ce qui est faux.

**C. L'ergonomie** : un seul bouton principal (l'étape suivante), des refus qui montrent le champ et le bouton qui
débloque, rien qui pousse sous le curseur, le téléphone complet.

**D. La preuve** : un test par règle, retourné vers la règle ; une preuve qui le fait tomber ; des captures lues ; la
doc.

**E. Joué comme un vrai utilisateur** (Skander, 05/11/2026 : « avant de valider un module faut le jouer comme un vrai
utilisateur avec des scénarios et des cas différents ») : avant qu'un module soit dit fini, il se joue **à la souris** sur
l'écran virtuel (`scripts/humain/`), avec une entreprise du métier préparée (un script qui ne montre aucun secret), en
plusieurs scénarios qui se suivent comme une vraie journée : le cas simple, le cas qui revient le lendemain (ce qui est
déjà fait doit se voir), le cas limite (zéro, négatif, sans fournisseur, un seul fournisseur), le retour en arrière, le
téléphone. Chaque trouvaille s'écrit (F1, F2…), se corrige ou se renvoie au module qu'elle concerne, puis se rejoue ; elle
gagne un test et une preuve. Un test vert ne remplace pas le jeu : les défauts F3, F4 et l'oubli du fournisseur unique du
Stock étaient tous sous des tests verts.

## Le Stock, le catalogue et la fiche d'un article

### Ce qui existe déjà (et tient)

État du stock au coût moyen pondéré, mouvements de l'année (tous venus des pièces), inventaire physique tapé puis
appliqué d'un geste (avec la clôture et la licence vérifiées), alertes (négatif, rupture, sous le seuil), numéros de
série, lots et péremptions (brique 97), dépôts et transferts (briques 94-95), kits, export par onglet, pagination des
onglets, les quatre chiffres (1.277.0).

### Ce qui manque ou ne va pas

| # | Constat | Grille | Décision (par délégation, 05/11/2026) |
|---|---|---|---|
| S1 | « Ce qu'il faut recommander » ouvre une **facture d'achat** : on paie avant d'avoir commandé. Le module Commandes fournisseurs existe ; le geste d'un article sous son seuil est de le **commander**. | B | Le bouton d'une ligne sous le seuil (ou en rupture) prépare un **bon de commande fournisseur** : l'article, la quantité, son dernier coût d'achat, et le **fournisseur de son dernier achat**. Un stock négatif garde « Saisir l'achat oublié ». |
| S2 | « À commander » remonte **au seuil** : la commande reçue, l'article est de nouveau sur la ligne d'alerte. | B | Un champ facultatif « Stock à atteindre » sur l'article ; sans lui, la quantité reste celle d'avant (le seuil) : la règle inconnue ne fait rien. |
| S3 | Plusieurs articles à recommander chez le même fournisseur : un bon par article. | B, C | « Commander tout ce qui manque » : **un bon par fournisseur**, chacun avec ses lignes ; les articles sans fournisseur connu dans un bon à part, fournisseur à choisir. |
| S4 | La fiche d'un article est dans **l'ancienne DA** (titre seul, tuiles), son historique des mouvements **n'est pas paginé** (règle des listes). | A10, C | La fiche passe dans la nouvelle DA (chemin, titre, phrase, quatre chiffres, carte) ; l'historique se pagine. |
| S5 | La fiche ne dit ni **d'où vient** l'article (dernier fournisseur, dernier prix, date) ni **combien il se vend** — les deux chiffres qui décident d'une commande. | B | Deux lignes sur la fiche : « Dernier achat » (fournisseur, prix, date, lien) et « Vendu sur 12 mois » (quantité, chiffre HT). |
| S6 | Un inventaire appliqué change la valeur du stock : c'est ce que le comptable passe en variation de stock à la clôture. Rien ne le lui dit. | A1 | Après l'inventaire, « Prévenir mon comptable » ouvre la conversation avec le résumé prêt (date, articles comptés, écart en valeur) — seulement quand un cabinet est relié. |
| S7 | « Écrire au comptable » existe dans le code (`ecrireAuComptable`) et **aucun écran ne l'appelle**. | A1 | Branché par S6 ; les modules suivants s'en servent aussi. |

### Fait en 1.284.0 (05/11/2026)

- **S1-S3** : « Commander… » d'une ligne sous le seuil ouvre un bon de commande fournisseur prérempli, chez le fournisseur
  du dernier achat ou de la dernière réception (`C.fournisseurDeLArticle`), au prix HT de cette ligne (le coût d'entrée
  compte la TVA non déductible : ce n'est pas un prix d'achat ; en devise, le coût ramené en dinars). Un stock négatif garde
  « Saisir l'achat oublié… ». « Commander tout ce qui manque » prépare un bon **en brouillon et numéroté** par fournisseur
  connu ; les articles sans fournisseur font un bon ouvert à l'écran, où le fournisseur se choisit. Un seul article : le bon
  s'ouvre à l'écran, rien n'est enregistré tant qu'on n'a pas relu.
- **S2** : le champ « Stock à atteindre (facultatif) » (`stockCible`, avec sa bulle) ; `C.quantiteACommander` commande
  jusqu'à lui, sinon jusqu'au seuil (la règle d'avant) ; une cible sous le seuil ne baisse pas la commande. L'export des
  alertes dit la même quantité que l'écran (la même fonction).
- **S4-S5** : la fiche d'un article dans la nouvelle DA (chemin Accueil › Stock › article, phrase, quatre chiffres dont « En
  stock » qui dit ce qu'il faut commander), une carte « Dernier achat » (fournisseur, prix HT, date, la pièce) et « Vendu sur
  12 mois » (`C.ventesDeLArticle` : factures émises moins avoirs, remise globale comprise, par article et non par libellé),
  l'historique paginé (25 par page). Un seul bouton principal : « Commander… » sous le seuil, « Saisir l'achat oublié… » en
  négatif, sinon « + Mouvement ».
- **S6-S7** : l'inventaire appliqué laisse son résumé à l'écran (date, articles comptés, écarts, valeur au coût moyen — lue
  **avant** les mouvements, sinon elle vaut toujours 0 : le test l'a attrapé) ; avec un cabinet relié, « Prévenir mon
  comptable » ouvre la conversation avec ce résumé prêt (`ecrireAuComptable`, enfin appelé).
- La preuve : `tests/moteur/stock-commander.test.ts` (6 règles), `tests/web/stock-revue.test.ts` (le parcours, l'inventaire,
  le téléphone), preuves `stock 1.284 a-f` ; les tests des lots, dépôts, kits et commandes fournisseurs lisent la nouvelle
  fiche.

À noter pour les tests : une facture émise **par l'API** derrière l'application, puis un enregistrement à l'écran, fait
refuser l'enregistrement (« La facture … est émise ») : l'application renvoie la facture remise à sa forme. Ce n'est pas un
geste qu'un client fait (ses factures s'émettent depuis l'écran) ; « Vendu sur 12 mois » se prouve donc au moteur.

### Joué à la souris (1.284.2, 05/11/2026)

Une quincaillerie préparée (trois fournisseurs, cinq articles : ciment sous son seuil avec deux fournisseurs successifs,
sable, gravier jamais acheté, peinture à −3, carrelage au-dessus du seuil), jouée en sept scénarios : commander une ligne,
revenir le lendemain, tout commander, l'achat oublié, l'inventaire, le stock à atteindre, compléter un brouillon.

| # | Trouvé en jouant | Suite |
|---|---|---|
| F1 | Le refus « Choisis le fournisseur… » du bon de commande ne montre pas le champ. | Corrigé en 1.285.0 : le champ s'entoure de rouge et prend le curseur (`refus`), comme les lignes et le taux de change. |
| F2 | Un bon en brouillon a « Recevoir » pour bouton principal : l'étape suivante est de l'**envoyer**. | Corrigé en 1.285.0 : « Envoyer au fournisseur… » (le PDF joint au courriel prêt, puis « envoyée », l'accord demandé avant s'il le faut) ; « Recevoir » reste à côté pour une commande passée par téléphone. |
| F3 | Un article commandé restait « 4 à commander » : un second clic faisait une seconde commande. | Corrigé : ce qui est en commande (bon pas encore reçu, réception partielle comprise) se retire (`C.commandesEnCoursDeLArticle`) ; la ligne dit « Déjà en commande : 4 — BCF-… » et son bouton devient « Voir la commande ». |
| F4 | « Tout ce qui manque » faisait un second bon chez un fournisseur qui avait déjà un brouillon ; et, quand tout allait chez un seul fournisseur, ouvrait un bon neuf à côté du sien (trouvé par le test écrit après le jeu). | Corrigé : le brouillon ouvert se complète, la ligne d'un article déjà dessus grandit (4 + 15 = 19, une seule ligne). |
| F5 | L'achat oublié d'un stock à −3 proposait 1. | Corrigé : il propose 3 (« en stock : −3 → 0 »). |
| F6 | La flèche de cet achat menait aux Achats, une liste qu'on n'avait pas vue. | Corrigé : elle ramène au Stock (ou à la fiche de l'article). |
| F7 | L'inventaire (3 comptés, 2 écarts, −46,025 DT) : la valeur du stock passe de 1 230,800 à 1 184,775 DT. | Juste. |
| F8 | Le titre « Historique des mouvements » touchait le bord de sa carte. | Corrigé. |
| F9 | « Modifier la prestation » sur un article suivi en stock (une entreprise sans métier choisi). | Corrigé : « Modifier l'article ». |

La preuve : `stock-commander.test.ts` (7 règles), un second parcours dans `stock-revue.test.ts`, preuves `stock 1.284 g-l`.

Reste à examiner pour ce module : la visite guidée du stock (ses fins), la lecture seule et le hors ligne sur l'inventaire
et sur « Commander tout ce qui manque », « Prévenir mon comptable » vu avec un vrai cabinet relié.

## Les commandes fournisseurs

### Fait en 1.285.0 et 1.286.0 (05/11/2026)

- **F1, F2 du Stock** : le refus montre le champ ; un bon en brouillon a pour étape suivante « Envoyer au fournisseur… »
  (PDF joint au courriel prêt, puis « envoyée », l'accord demandé avant s'il le faut).
- **La DA de la facture et du devis** (Skander, 05/11/2026 : « il faut respecter la DA de ce qu'on a déjà fait avec
  facture et devis ») : le bon de commande prend le squelette de l'achat — en-tête de pièce (‹, chemin, titre et sa
  pastille, le fournisseur dessous), frise « Préparée → Envoyée → Reçue (x sur y, en retard) → Facturée » avec le geste de
  l'étape qui attend, à gauche la commande, les lignes, les réceptions et les notes, à droite les totaux et **un seul grand
  bouton** (envoyer, recevoir, saisir la facture, ou « Enregistrer la commande » quand elle est neuve) ; les autres gestes
  en secondaires dessous, « Enregistrer » caché tant que rien n'a changé (comme le devis).
- Joué à la souris : brouillon → envoyer (le message dit où trouver le PDF à joindre) → recevoir 2 sur 4 (frise « Reçue en
  partie », « Saisir la facture » apparaît) ; la désignation des lignes gardait 164 px dans la colonne plus étroite : les
  autres colonnes sont resserrées.

### Fait en 1.287.0 (05/11/2026) : la réception, et ce que le jeu a trouvé

- **La réception dans le squelette des pièces** : ‹ (vers la liste des réceptions), chemin « Commandes fournisseurs ›
  BCF-… › Réception », titre et pastille, le fournisseur et la commande dessous ; frise « Commandée → Arrivée → En stock →
  Facturée » avec son geste ; à droite le résumé (lignes reçues, dépôt, valeur reçue HT) et **un seul grand bouton** :
  « Valider la réception », puis « Saisir la facture du fournisseur », puis un état calme (« Reçue et facturée », « Voir la
  facture »). Une quantité modifiée fait paraître « Enregistrer le brouillon » en principal (la règle de la facture).

Joué à la souris (ordinateur puis téléphone), une commande de 40 sacs de ciment et 3 m³ de sable :

| # | Trouvé | Fait |
|---|---|---|
| G1 | La frise de la commande disait « Reçue 0 sur 43 » : elle additionnait des sacs et des mètres cubes. | Une seule unité se compte en quantités (« 60 sur 100 sac ») ; plusieurs, en lignes reçues en entier (« 1 ligne sur 2 en entier »). |
| G2 | 30 sacs reçus au lieu de 40 : la « Valeur reçue HT » restait celle de 40 (807,000 DT au lieu de 639,000). | Le résumé suit la saisie. |
| G3 | Au téléphone, la frise restait en quatre colonnes et débordait (page de 438 px sur 390) : une règle posée plus loin dans `piece.css` écrasait celle du téléphone — sur l'achat aussi. | La règle du téléphone est reposée après elle. |

### Fait en 1.288.0 (05/11/2026) : la demande de prix comparée et le téléphone

Joué à la souris : deux fournisseurs ont répondu (Grossiste Sfax 807,000 DT HT, Matériaux du Cap Bon 789,000 DT HT).

| # | Trouvé | Fait |
|---|---|---|
| H1 | La colonne de droite disait « Rien n'attend » avec une coche ; le seul bouton vert était au fond du tableau des réponses. | Le grand bouton est « Commander chez » le moins cher pour l'ensemble, avec son total ; le tableau garde un bouton par fournisseur, sans vert. |
| H2 | Commander chez l'un passait la commande « envoyée » (et proposait déjà « Recevoir ») sous un toast qui demandait de l'envoyer. | Elle devient la commande en brouillon ; son grand bouton est « Envoyer au fournisseur… » (PDF joint, puis « envoyée »). |
| H3 | Au téléphone, les lignes d'une commande défilaient dans leur cadre : prix, TVA et total cachés à droite. | Une carte par ligne, comme l'achat (désignation, puis quantité, unité, prix, puis TVA, total). |
| H4 | « 0 ligne sur 2 en entier » se lisait mal. | « 0 sur 2 lignes en entier ». |

Le module des commandes fournisseurs est joué en entier (stock → commande → envoi → réception → facture ; demande de
prix comparée ; téléphone). Suivant : les immobilisations.

### Fait en 1.289.0 (05/11/2026) : les immobilisations

La fiche d'un bien prend le squelette des pièces (règle de Skander : « respecter la DA de ce qu'on a déjà fait avec
facture et devis ») : ‹ vers la liste, chemin, titre et pastille (en service, amorti, sorti) ; frise Mis en service →
Amortissement (la part amortie) → Fin du plan ou Sorti ; à gauche la sortie, le plan, l'achat d'origine, les notes ; à
droite ce que le bien vaut (valeur, durée, amorti, valeur nette comptable). Un bien en service n'a pas d'étape suivante :
la colonne de droite le dit (« Rien à faire : le plan court seul »), sans bouton vert.

Joué à la souris : une camionnette de 48 500 DT vendue 15 000 DT, une imprimante achetée à immobiliser, une fiche
entièrement amortie.

| # | Trouvé | Fait |
|---|---|---|
| I1 | Un bien vendu ne disait pas qu'il restait à facturer l'acheteur, et rien ne l'aidait. | « Facturer la cession » est le grand bouton d'un bien vendu : la facture s'ouvre avec « Cession : … », une quantité et le prix de vente, et garde le lien au bien. Préparée, le bouton mène à elle (« Émettre la facture de la cession ») ; émise, la fiche montre son numéro. Le taux de TVA reste celui de la ligne, à confirmer avec le comptable (À VÉRIFIER) : un message le dit à l'ouverture. |
| I2 | Le tableau des sorties ne disait pas quelles ventes étaient facturées. | Une colonne « Facture » : son numéro, « brouillon » ou « à facturer ». |
| I3 | Une copie de facture aurait recopié le lien au bien vendu. | La copie l'efface, comme les autres liens d'une pièce. |

Vérifié : « Créer la fiche du bien… » depuis la ligne d'achat (famille → durée proposée, 89,954 DT de dotation pour 67
jours de 2026, le bandeau et le compteur « À immobiliser » s'éteignent) ; au téléphone, la fiche tient dans 390 px.

Le rouge GitHub de 1.288.0 réparé dans la même version : l'instrument du rendu n'ouvrait qu'un achat neuf (sans lignes,
depuis 6b) et aucune « autre pièce » ; il ouvre maintenant un achat rempli, une pro forma et les statistiques, et y a
trouvé trois cases trop petites pour un doigt au téléphone (devise et frais de l'achat, destination d'une ligne) et un
bandeau « pensée pour un ordinateur » faux sur les statistiques — corrigés. Les preuves de la flèche de la réception et
de « Recevoir le reste » visent le code d'aujourd'hui ; celle d'une demande de prix « qu'on peut recevoir » est retirée
(le défaut ne s'atteint plus) ; la fin du test des alertes de la console a le temps de s'arrêter.

**Preuves à recouvrir** (retirées le 05/11/2026, chacune parce que les écrans testés n'atteignent plus sa règle ;
la règle reste, à couvrir d'un test qui l'atteint ou à retirer si plus rien ne s'en sert) : le montant à huit chiffres
d'une carte `.stat` (accueil, comptabilité, statistiques) ; le défilement d'une liste large et le bouton « Envoyer au
comptable… » à 768 px ; « Actions » sur une carte de liste (plus aucune liste n'en dessine) ; les filtres du Cabinet au
téléphone ; la bulle d'un filtre (Marges et Catalogue ont leur mise en page). Toutes dans `telephone.css`.

Suivant : les factures récurrentes.

## Les factures récurrentes

### Fait en 1.290.0 (06/11/2026) : la fiche d'un contrat, et la fin d'un contrat

La fiche d'un contrat prend le squelette des pièces : ‹ vers la liste, chemin, titre et pastille (actif, suspendu, émise
seule, terminé) ; frise Contrat (sa période, sa fin) → Prochaine facture → Encaissé ; à gauche ce qu'il facture et les
factures qu'il a faites ; à droite son résumé (par facture HT et TTC, facturé depuis le début, encaissé, reste à
encaisser), un seul bouton vert qui suit l'étape, et l'aperçu de la prochaine facture. Les autres gestes restent à côté
(Modifier, Suspendre ou Reprendre, Générer maintenant, Fiche client) ; supprimer est un lien discret sous les factures.

Joué à la souris : un entretien d'ascenseurs dû (généré, puis émis), une maintenance dont le brouillon attend, un
nettoyage suspendu (repris), une location de photocopieur terminée (prolongée), un hébergement en euros ; au téléphone.

| # | Trouvé | Fait |
|---|---|---|
| R1 | Un contrat ne pouvait pas finir : un entretien de douze mois facturait pour toujours. | « Fin du contrat (facultatif) » dans le formulaire. Passé sa dernière échéance, le contrat est « terminé » : il ne prépare plus rien, ne compte plus « à générer », et le serveur n'émet plus ses factures « émises seules » (la base ne le relit plus, migration 0192). Une seule règle pour tous : `contratTermine`. Reculer la fin le prolonge. Une fin avant la prochaine facture est refusée sur le champ, sauf pour retoucher un contrat déjà terminé. |
| R2 | Après « Générer », la fiche proposait encore de générer, sans voir le brouillon qui attendait. | Le bouton vert devient « Émettre la facture de <mois> » et ouvre le brouillon ; la liste marque « brouillon à émettre ». |
| R3 | Un contrat suspendu promettait sa première facture à une date passée. | « Aucune facture pour l'instant : le contrat est suspendu. » ; un contrat terminé ne propose plus « Suspendre ». |
| R4 | « 1 brouillons à préparer — voir lesquels ». | Le singulier quand il n'y en a qu'un. |

La liste a un filtre « Terminés » ; un contrat terminé ne compte ni parmi les actifs ni dans ce qu'ils rapportent.

Suivant : les autres pièces (pro forma, bons, contrats signés).

## Les autres pièces (pro forma, bon de livraison, commande client, contrat de prestation)

### Fait en 1.291.0 (06/11/2026) : leur fiche dans la mise en page des pièces

Les quatre pièces sans valeur comptable prennent le squelette de la facture et du devis : ‹ vers « Proforma, bons et
contrats », titre et pastille, une frise selon ce qu'elles sont, les puces sous le client (Langue, Devise, Statut, et
pour le bon « Prix »), à droite le total (« rien n'est dû sur le bon : seule la facture se paie », sauf la pro forma qui
dit son net à payer), un seul bouton vert qui suit l'étape, « Avant d'enregistrer » tant qu'elles sont en brouillon.

| Pièce | Frise | Le bouton vert, étape par étape |
|---|---|---|
| Pro forma | Créée → Envoyée → (Livrée) → Facturée | Enregistrer → Envoyer → Facturer → Émettre la facture (le brouillon tiré d'elle) |
| Bon de livraison | Préparé → Signé → Facturé | Imprimer le bon à faire signer → Facturer (« Le client a signé » à côté) |
| Commande client | Reçue → Livrée → Facturé | Livrer (puis « Livrer le reste », qui reprend exactement ce qui manque) → Facturer |
| Contrat de prestation | Rédigé → Envoyé → Signé | Envoyer → Le client a signé ; signé, « Le facturer à date fixe… » |

Joué à la souris (Résidence Les Jasmins) : une pro forma envoyée puis facturée ; un bon en brouillon à faire signer,
ses prix passés de « masqués » à « imprimés » ; une commande de 4 cabines et 6 portes livrée en partie (le reste,
2 cabines et 6 portes, en un geste) ; un contrat de maintenance envoyé, signé, puis facturé chaque mois ; une pro
forma annulée ; au téléphone.

| # | Trouvé | Fait |
|---|---|---|
| A1 | Ces pièces gardaient l'ancienne page (statut et « Transformer ▾ » en haut, trois boutons de même poids). | La mise en page des pièces, un seul bouton vert ; « Transformer » passe dans la colonne de droite. |
| A2 | Une pro forma facturée en brouillon ne disait pas que la facture attendait. | Le vert devient « Émettre la facture » et ouvre le brouillon ; la frise marque « Facturée » à moitié. |
| A3 | Un contrat signé ne menait nulle part : la facturation mensuelle se refaisait à la main. | « Le facturer à date fixe… » ouvre la facturation récurrente préremplie (client, lignes, objet « Contrat CTR-… — {mois} ») ; préparée, la colonne y mène. |
| A4 | La signature d'un contrat ou d'un bon se notait en changeant un menu de statut. | « Le client a signé », d'un geste. |
| A5 | Masquer les prix d'un bon était une case à cocher perdue en bas. | La puce « Prix » (masqués ou imprimés), comme les autres puces. |
| A6 | La retenue, le timbre et le dépôt s'affichaient sur un contrat ou une commande, où ils n'ont pas de sens. | Retenue et timbre sur la pro forma seulement ; le dépôt sur le bon (c'est lui qui sort le stock). |
| A7 | Dans les bulles des puces, le libellé chevauchait sa phrase d'explication. | Le libellé et sa phrase l'un sous l'autre (toutes les bulles). |

Suivant : les listes de prix.

## Les listes de prix

### Fait en 1.292.0 (06/11/2026) : la fiche d'une liste dans la mise en page des pièces

La fiche prend le squelette des pièces : ‹ vers les listes, chemin, titre et pastille (brouillon, en vigueur, à venir,
terminée) ; frise Préparée → En vigueur → Fin ; à gauche à qui elle s'applique et ses prix (avec l'écart au catalogue) ;
à droite son résumé (articles, écart moyen, clients concernés et leurs noms), un seul bouton vert qui suit l'étape, et
« Dupliquer » à côté.

Joué à la souris (deux revendeurs, un chantier nommé, une promotion d'hiver, la liste de l'an passé) et au téléphone.

| # | Trouvé | Fait |
|---|---|---|
| L1 | Rien ne disait qu'une autre liste passait avant celle-ci pour un client (la règle du moteur : celle qui nomme le client, puis la plus récente). | Un bandeau le dit, client par client, le jour où elle commence ET chaque jour où une autre liste commence pendant sa durée (« Promo hiver … à partir du 01/12/2026 »). Une liste finie n'en a plus. |
| L2 | Une liste qui finit ne préparait rien : on recopiait tout à la main pour l'année suivante. | Dans les 30 jours de sa fin, ou finie : « Préparer la liste suivante » reprend ses clients et ses prix, du lendemain de la fin pour un an, et avance l'année du nom (« Revendeurs 2026 » → « Revendeurs 2027 »). Rien n'existe avant « Enregistrer ». |
| L3 | Une liste dont la suivante existait poussait encore à la refaire. | La colonne le dit et y mène (« Sa suivante : Revendeurs 2027, dès le 21/11/2026 ») ; la page des listes ne met plus en alerte une fin déjà relayée (« la suivante est prête »). |
| L4 | Un revendeur à −10 % sur tout le catalogue se saisissait article par article. | « Tout le catalogue à −x % » remplit chaque article qui a un prix, au millime ; « Annuler le remplissage » rend les prix d'avant. Sans remise valable, c'est refusé et dit. |
| L5 | Un prix de liste sous le coût de l'article passait sans un mot. | L'écart au catalogue sur chaque ligne et, sous le coût, « sous son coût (2 210,000 DT) » en rouge. |
| L6 | Un article deux fois dans une liste était enregistré ; le moteur prenait la première ligne sans le dire. | Refusé, sur la ligne : « « Ciment gris 50 kg » est deux fois dans la liste ». |
| L7 | Quitter le champ du prix pour cliquer « Enregistrer » redessinait le bouton sous le curseur : le clic se perdait. | La colonne ne se redessine que si elle change. |
| L8 | Au téléphone, le tableau des prix serrait le prix à deux chiffres ; la phrase de l'état disparaissait (seul « Dupliquer » restait). | Les prix en cartes (l'article, puis le catalogue, le prix de la liste et l'écart) ; la phrase calme reste lisible au téléphone, sur toutes les pièces. |

Suivant : les relances.


## Les relances

### Fait en 1.293.0 (06/11/2026) : relancer un client d'un message, et attendre sa réponse

La page était déjà dans la nouvelle mise en page (1.283.0). Jouée comme une gérante d'ascenseurs : Bâtiments Ezzahra
doit trois factures (60, 30 et 10 jours de retard), l'Hôtel Le Golfe une, Mme Trabelsi promet un chèque au téléphone,
la Clinique Les Pins a une échéance dans 3 jours et un devis sans réponse.

| # | Trouvé | Fait |
|---|---|---|
| R1 | Une facture relancée restait dans « À relancer » avec le même bouton : rien ne disait que c'était fait, et on pouvait relancer le lendemain un client qui a peut-être déjà payé. | Relancée il y a moins de 7 jours, elle passe dans « Relancées, en attente de réponse » avec « on te la remontre le … », et revient seule. Le chiffre « À relancer », celui du menu et la ligne de l'accueil passent par la même règle (`aRelancer`) ; « Relancer quand même » reste dans son menu. |
| R2 | Un client qui doit trois factures recevait trois messages. | « Par client » : une ligne par client (ses factures nommées, le plus grand retard et son ton, le reste dû), « Relancer les 3 » : UN message qui liste chaque facture et le total, au ton du plus grand retard (qu'on change), factures à cocher. Noté sur chaque facture cochée quand on dit « Je l'ai envoyé ». Par e-mail ou WhatsApp. « Relevé » à côté. |
| R3 | Au ton ferme, le message disait « Malgré nos précédentes relances » à un client jamais relancé. | La phrase ne se dit que s'il y a eu une relance ; sinon « Ces factures sont échues depuis longtemps ». À VÉRIFIER : le modèle d'une seule facture au ton « Dernière relance » (Paramètres → Envois) dit encore la même chose ; c'est un texte que l'entreprise règle, laissé tel quel. |
| R4 | Le chiffre du menu gardait l'ancien compte après un appel noté, un report ou une relance. | Il suit la page à chaque dessin. |
| R5 | « Plus de 45 jours : 0 — aucun retard ancien » alors qu'une facture avait 60 jours de retard (relancée). | Le chiffre dit le retard : elle y reste, « relancée, elle attend sa réponse ». |
| R6 | La dernière relance disait « niveau 2 » ; le canal WhatsApp se notait « email ». | « 06/11/2026 · WhatsApp · Relance · 3ᵉ » : le canal réellement utilisé (même quand on bascule d'e-mail à WhatsApp dans la fenêtre), le ton en mots. « Niveau » devient « Ton » dans l'appel noté. |
| R7 | Les colonnes bougeaient quand une relance apparaissait ; « Actions » était rogné à droite. | Largeurs fixes, les mêmes dans les quatre tableaux. |

Suivant : la caisse.


## La caisse

### Fait en 1.294.0 (06/11/2026) : compter le tiroir sans perdre un chiffre, l'arrondi de la monnaie, les tickets du jour

Jouée comme une épicière (Épicerie Ben Salah, 5 articles avec leur code-barres) : ouverture avec 100 DT de fond, un
article lu à la douchette, une remise de 10 %, un paiement en espèces avec monnaie rendue, un autre par carte ; sans
compte bancaire, le refus dit pourquoi et propose de le créer, la vente continue ; tickets du jour, aperçu d'un ticket,
comptage à l'aveugle, Z. Les montants étaient justes partout.

| # | Trouvé | Fait |
|---|---|---|
| C1 | Le Z disait « Il manque de l'argent dans le tiroir », en alerte, pour 1 millime d'écart : 4,629 DT ne se rendent pas en pièces, la monnaie s'arrondit au comptoir. | Un écart plus petit que la plus petite pièce en usage (10 millimes) s'écrit en clair, sans alarme : « Écart de 0,009 DT, moins que la plus petite pièce (10 millimes) : l'arrondi de la monnaie rendue suffit à l'expliquer. » Le chiffre reste écrit, le Z reste figé. Dans la liste des Z, seul un vrai manque reste en alerte. |
| C2 | Le comptage s'ouvre depuis le menu : rien n'avait le focus, le premier chiffre tapé au clavier se perdait. | Sur grand écran, la coupure choisie reçoit le focus : on tape tout de suite, Entrée passe à la suivante. (Au téléphone, rien ne prend le focus : le clavier s'ouvrirait pour rien.) |
| C3 | « Tickets du jour » gardait les tuiles et les panneaux d'avant. | Dans la DA des listes : les quatre chiffres (ventes, espèces, carte, chèques) dans une carte, la liste du jour avec son choix du jour dans la sienne, les Z dans la leur ; un jour sans ticket le dit et mène à la vente. Au téléphone, les chiffres deux par deux et les lignes en cartes. |

À VÉRIFIER avec un comptable :
- une facture faite pour un ticket déjà encaissé : le chiffre d'affaires et la TVA ne doivent pas compter deux fois ;
- l'arrondi de la monnaie rendue (4,629 DT encaissés, 4,620 DT reçus en pièces) : comment il veut voir ces millimes ;
- la pièce de 5 millimes, encore émise mais rare : elle n'est pas dans le comptage du tiroir.

Suivant : les garanties.


## Les garanties

### Fait en 1.295.0 (06/11/2026) : proposer la maintenance une fois, et la retrouver

Jouées comme un installateur de climatisation et d'informatique (Clim et Info Jlassi) : l'Hôtel Le Golfe a quatre
climatiseurs dont la garantie finit (trois dans 13 jours, un dans 38), la Clinique Les Pins un onduleur, un onduleur est
parti sans fiche client, un PC est hors garantie, Mme Trabelsi a un climatiseur garanti jusqu'en 2028, deux sont en stock.

| # | Trouvé | Fait |
|---|---|---|
| G1 | « Proposer un contrat » ouvrait un devis vide de toute ligne, et rien ne gardait qu'on l'avait fait : le lendemain, la même ligne, le même bouton, et l'accueil comptait toujours la garantie. | La proposition (un contrat de maintenance, ou un devis par le menu) naît avec une ligne par appareil — désignation courte, « N° de série … · à partir du … », prix à donner — et garde les numéros qu'elle couvre. L'appareil passe dans « Déjà proposées » avec la pièce et son état ; la page, l'accueil et la fiche du client comptent par la même fonction (`garantiesAProposer`). Une pièce annulée rend l'appareil à proposer. |
| G2 | Un client qui a quatre appareils en fin de garantie : quatre lignes, quatre devis. | Une ligne par client (ses appareils l'un sous l'autre, la fin la plus proche), « Proposer un contrat (4) », et une fenêtre pour cocher lesquels et choisir contrat ou devis. |
| G3 | La page partait sur 90 jours, la ligne de l'accueil qui y mène sur 60 : deux chiffres pour la même chose. | La page part sur 60 jours ; la fenêtre reste au choix. |
| G4 | Un client appelle avec une panne : rien ne permettait de chercher son appareil. | La recherche (numéro, article, client, sur tous les numéros) dit « Garantie jusqu'au … », « Hors garantie depuis le … », « Sans garantie » ou « En stock », et la proposition faite. |
| G5 | « Déjà hors garantie » coupé à 30 lignes ; pas d'export. | Chaque liste se pagine ; « Exporter » donne le parc entier (article, numéro, client, livraison, fin, état, proposition). |
| G6 | Un appareil livré sans fiche client n'offrait aucun geste. | « Rattacher un client… » ouvre le numéro ; il n'y a pas de bouton « Proposer » sans client. |
| G7 | Ancienne mise en page (panneaux, sélecteur à côté du titre). | La DA des listes : chemin Accueil › Stock › Garanties, quatre chiffres qui mènent à leur section, une carte avec la recherche et la fenêtre ; un seul bouton principal, sur le premier client à qui l'on peut proposer. Au téléphone, le geste passe en bas de la carte. |
| G8 | La fiche du client disait « 1 garantie se termine… » même quand le contrat était déjà proposé, sans geste. | La phrase ne compte que ce qui reste à proposer, avec « Proposer un contrat » ; la colonne dit « maintenance proposée : CTR-… (état) ». |

L'article d'aide « Savoir qui a quoi » dit maintenant ce que fait la page.

Les deux rouges GitHub de 1.293.0, réparés à la racine :
- la visite « Ajouter au catalogue » reprenait le curseur à qui tapait déjà le prix TTC (la case qu'elle éclaire comme
  alternative) quand l'écran tardait à poser le sien : « 11.9 » partait dans le HT. Elle laisse désormais le curseur dans
  la case qu'elle éclaire ; le test tape lentement, l'écran ralenti, comme une machine lente ;
- le test des écrans vides mesurait au téléphone la carte des Achats, encore affichée un instant, au lieu de celle de la
  Paie : il attend la carte de la paie elle-même (la preuve « la paie garde ses deux colonnes » retombe).

## Les statistiques

### Fait en 1.296.0 (06/11/2026) : vendu, encaissé, gagné, acheté — dans la DA des listes

Jouées comme une quincaillerie qui facture des chantiers et vend au comptoir (Quincaillerie Ben Youssef, Sfax) : dix
factures sur deux ans, un avoir, trois tickets du jour, huit devis dont quatre refusés (« Trop cher » deux fois, écrit de
deux façons, « Un concurrent », un sans motif), des achats chez un grossiste, la STEG, une station-service, un acompte
versé, une dépense sans fournisseur ni catégorie ; la même page en année, en mois, au téléphone, et pour une entreprise
neuve.

| # | Trouvé | Fait |
|---|---|---|
| S1 | Ancienne mise en page : quatre tuiles, puis neuf panneaux les uns sous les autres. | La DA des listes : chemin Accueil › Statistiques, phrase, « Exporter » ; quatre chiffres dans une carte ; quatre onglets (Ventes, Devis, Clients, Achats), la période à droite comme l'année des Marges. Chaque chiffre ouvre l'onglet qui le détaille (la marge ouvre la page Marges). |
| S2 | Les chiffres ne disaient que le facturé (« ils ne disent pas ce que tu as gagné », écrivait l'aide). | Quatre chiffres : Vendu HT, Encaissé (le journal des encaissements de la période, l'argent rendu en moins, avec ce qu'on doit encore aujourd'hui), Marge estimée (le calcul de la page Marges, « ≈ » quand des coûts manquent), Acheté HT. Chacun comparé à la même période de l'an dernier ; la flèche des achats reste grise. |
| S3 | Les tickets de caisse comptaient comme des factures : « 312 factures émises » pour une épicerie, un panier moyen qui mélangeait un ticket de 4 DT et un chantier de 5 000 DT. | « Factures et comptoir » : les deux canaux, chacun avec ses pièces, ses avoirs (un retour au comptoir reste au comptoir) et son panier moyen ; la somme est le chiffre de la carte. La TVA collectée sous le tableau. |
| S4 | Les répartitions des achats, retirées de la liste des achats (Skander, 30/10/2026 : « elles iront à la page Statistiques »), n'y étaient pas. | L'onglet Achats : par fournisseur (la ligne ouvre sa fiche) et par catégorie, HT en dinars, un avoir en moins, un acompte dehors (sa facture le reprend), la casse ne sépare pas « marchandises » de « Marchandises » ; paginé ; le même total des deux côtés. |
| S5 | Le motif noté au refus d'un devis (« Trop cher », « Un concurrent »…) ne servait nulle part. | « Pourquoi les clients refusent » : les refus de la période rangés par motif, sans tenir compte des majuscules, un refus sans motif à part ; « « Trop cher » revient dans 2 refus sur 3 » quand un motif fait au moins la moitié. Le taux d'acceptation et l'entonnoir y restent (Skander, 03/11/2026). |
| S6 | Des phrases que rien ne tenait : le délai moyen « — », la note sur les acomptes sans acompte, l'aide qui disait les achats absents. | Le délai ne s'écrit que s'il existe ; la note des acomptes seulement s'il y en a ; l'article d'aide « Lire tes statistiques » décrit la page telle qu'elle est, et dit ce que la marge n'est pas (le loyer et les salaires n'y sont pas). |
| S7 | Au téléphone, des tableaux qui débordaient de leur carte. | Les petits tableaux restent des tableaux, en pleine largeur ; la colonne la moins utile se cache (la part, la date de première facture), les titres passent à la ligne ; rien ne déborde, onglet après onglet. |
| S8 | L'export ne disait pas tout. | L'export ajoute le comptoir, l'encaissé, la marge, les achats par fournisseur et par catégorie, et les motifs de refus. |

Un payeur plus lent que le délai annoncé s'écrit en ambre. Une entreprise neuve lit, onglet par onglet, ce qui remplira
la page, jamais « tout est encaissé » quand rien n'a été facturé. À VÉRIFIER avec un comptable : la marge estimée suit le
coût de revient du catalogue, pas le coût réel des achats (celui-là se lit dans la fiche d'une affaire).

## Les preuves de la nuit qui restaient vertes

### Fait en 1.297.0 (06/11/2026) : seize preuves, deux vrais défauts

La nuit du 05 au 06/11/2026 (« Toutes les preuves ») a laissé seize preuves vertes : on remettait le défaut, et le test
passait quand même. Chacune a été reprise une par une, puis rejouée ici, défaut remis.

- **Le test ne regardait pas assez** (il se retourne vers la règle) : la relance envoyée depuis la conversation, la
  messagerie hors ligne (avec la messagerie chargée, et le Cabinet seul), l'archive d'avant lue par la propriétaire,
  le portable retiré (mesuré au sortir de son effacement : l'entrée efface elle aussi la base, et une base recréée par
  la page de l'entreprise y passait inaperçue), la remise d'une pièce, le badge pâle du Cabinet hors ligne, le
  Cabinet qui déborde sous le bandeau (mesuré au retour du réseau, quand le bandeau est en entier), la caisse hors ligne
  (sa place exacte sous le bandeau, rien qui dépasse), et la facture imprimée avec un long libellé et un gros prix
  unitaire.
- **La règle avait déménagé** (la preuve vise celle qui travaille vraiment) : le retrait du lien des premiers pas (dans
  piece.css depuis l'accueil), la fiche du fournisseur à 1 366 px (dans liste.css depuis 1.205.0 ; la liste s'y garde deux
  fois, elle défile d'elle-même et sa case peut rétrécir, donc la preuve retire les deux ; et avec deux achats courts elle
  tenait dans sa carte quoi qu'il arrive : le test pose exprès une liste plus large que la carte), le message de relance
  du Cabinet (écrit par la fenêtre des relances depuis 1.184.0), le montant d'un paiement (une case de texte avec ses
  propres gardes depuis 1.155.0).
- **La règle ne servait plus à rien** (retirée avec sa preuve) : la grille des lignes de la v10 au téléphone (toutes les
  pièces ont les cartes de la facture), la colonne pleine largeur de la fiche fournisseur, le retrait du corps propre au
  Cabinet (la barre commune le fait déjà).

Deux vrais défauts, trouvés en reprenant ces preuves :
- **La caisse poussée deux fois sous le bandeau du poste.** Hors ligne, le corps de la page descendait de la hauteur du
  bandeau (la barre commune), puis la caisse redescendait d'autant : le bas de la caisse sortait de l'écran. Le corps ne
  descend plus en mode caisse ; la caisse se place elle-même.
- **Les chiffres de l'accueil jamais resserrés au téléphone.** Un montant de dix chiffres (« Tu dois 1 469 391,770 »)
  devait passer à une taille plus petite, mais la règle des cartes de l'accueil l'emportait : il sortait de sa carte. Les
  deux crans du resserrement s'appliquent maintenant aussi dans l'accueil (la preuve casse les deux : le second cran seul
  suffit à faire tenir le montant).

Les deux rouges GitHub de 1.295.0 : les tests de la caisse et du caissier lisaient le chiffre des ventes par l'ancienne
tuile (`.stat`), retirée par la revue de la caisse ; ils le lisent maintenant par son nom (`#cs-ventes`). La preuve « la
barre de la caisse sous le bandeau du poste » retombe : le test de la caisse hors ligne mesure sa place exacte.

## La trésorerie

### Fait en 1.298.0 (06/11/2026) : la remise de chèques, le loyer oublié, et le relevé jusqu'au comptable

Jouée comme une menuiserie de Sousse (Menuiserie Ben Salah) : un compte BIAT et une caisse, six factures dont quatre
payées (un virement, trois chèques déposés ensemble à la banque), trois achats (deux réglés, un en retard), un loyer
mensuel marqué « se répète », un acompte provisionnel ; le relevé d'octobre de la BIAT importé tel que la banque le
donne (CSV, solde final compris), un 6 novembre, soit le lendemain du loyer. Puis la même page au téléphone.

| # | Trouvé | Fait |
|---|---|---|
| T1 | La ligne « REMISE CHEQUES 3 CHQ » du relevé (3 495,923 DT) passait pour **absente de SkanFact** : les trois chèques y sont un par un, chacun sur sa facture. « Créer le mouvement » comptait l'encaissement deux fois. | L'import cherche, pour une ligne restée seule, deux à quatre encaissements pas encore pointés, du même sens, des vingt jours qui la précèdent, dont la somme fait la ligne au millime. Une seule combinaison possible : elle se propose (« Une ligne du relevé, plusieurs mouvements : une remise »), cochée, et ses chèques se pointent avec elle. Deux combinaisons, ou plus de quatre chèques : rien n'est proposé, la ligne reste à décider. Bulle d'aide sur la remise. |
| T2 | Le loyer du 5, lu le 6 sans avoir été noté, était **cru payé** : ni dans la prévision ni nulle part (1 200 DT de trop dans la caisse, sans une question). | Une dépense qui revient, passée sans être notée (sur les trois derniers mois), se compte aujourd'hui, « déjà échue (le 05/11/2026) ». « Où j'en suis » la demande (« Loyer de l'atelier du 05/11/2026 : 1 200,000 DT, pas encore noté ») avec « Noter comme payé », qui ouvre le mouvement prérempli à la date du loyer. Un mouvement du même compte, de même nature et de même montant, saisi à la main à sept jours près, vaut aussi pour elle (sans quoi le loyer noté à la main sortait deux fois). |
| T3 | Les frais créés depuis le relevé (« FRAIS TENUE DE COMPTE ») tombaient en « Autre sortie ». | La nature se devine du libellé : FRAIS, COMMISSION, AGIOS, TENUE DE COMPTE donnent « Frais bancaires » ; IMPOT, TVA, CNSS, RECETTE DES FINANCES, ACOMPTE PROVISIONNEL donnent « Impôts et taxes ». Une entrée n'est jamais classée en frais. Ce n'est qu'une proposition, à relire dans la fenêtre. |
| T4 | Les salaires en retard et les dépenses qui reviennent se rangeaient avec les fournisseurs en retard. | Les retards se rangent par sorte : clients, fournisseurs, salaires (« À surveiller » ouvre la paie), dépenses qui reviennent. |
| T5 | L'état de rapprochement fini n'allait nulle part : le comptable le redemande à chaque fin de mois. | « Envoyer l'état à mon comptable » (écart nul) ou « Demander à mon comptable » (un écart qu'on ne trouve pas) ouvre la conversation avec le résumé prêt à relire. Sans comptable relié, les deux boutons ne paraissent pas (ils menaient à la page d'invitation, et le texte se perdait) ; « Exporter l'état » suffit. |
| T6 | La prévision ne s'exportait pas : c'est le tableau qu'on montre à son banquier avant un trou. | « Exporter » dans « Ce qui arrive » : la prévision telle qu'on la lit (horizon, façon d'attendre les clients, essai compris), avec la note « estimé » ou « déjà échue le … ». |
| T7 | Les mouvements libres (loyer, impôts, frais) n'ont que leur justificatif pour se prouver, et rien ne retrouvait ceux qui n'en ont pas. | « Sans justificatif » dans l'onglet Mouvements, à côté du sens ; le solde après se cache tant que la liste est filtrée. |
| T8 | Au téléphone, les cartes des mouvements sortaient de l'écran à droite : la rangée des titres en pastilles élargissait la colonne de l'onglet. | La règle posée en 1.278.0 pour le Stock et la Caisse vaut maintenant pour tout onglet (fiches client et fournisseur comprises) : un bloc d'onglet tient dans sa largeur, ce qui est plus large défile en lui. Les chèques d'une remise s'alignent, montant à droite. |

Ce qui tenait déjà, rejoué : le relevé retrouvé ligne à ligne à cinq jours près, le solde final recopié, l'état de
rapprochement à écart nul, le loyer noté qui sort de « À surveiller » et des chiffres, l'export du relevé. À VÉRIFIER
avec un comptable : les montants estimés (salaires des mois sans bulletin, déclaration du mois) restent des ordres de
grandeur, marqués « estimés ».

### Fait en 1.299.0 (06/11/2026) : le pont — la remise de chèques jusqu'au Cabinet, l'état jusqu'au comptable

La même menuiserie, jouée des deux côtés : Youssef encaisse trois chèques un par un (1 011,500, 1 755,845 et 728,637 DT,
les 24, 25 et 27 octobre), importe son relevé BIAT (la remise du 28 octobre, 3 495,982 DT, et des frais de tenue de
compte de 18,500 DT), pointe et envoie l'état à sa comptable ; Leïla, au Cabinet Ennour, importe le même relevé dans la
Banque du dossier. Puis la Banque au téléphone.

| # | Trouvé | Fait |
|---|---|---|
| P1 | Au Cabinet, la ligne de la remise restait **« Rien dans le livre en face »** : le pont avait écrit les trois encaissements un par un, et une ligne du relevé ne savait répondre que d'**une** écriture. L'écrire d'après la règle ou à la main comptait l'encaissement deux fois au 532. | Une ligne du relevé peut répondre de plusieurs écritures (une remise) : dans le calcul, dans la base (migration 0193 : une ligne du relevé, plusieurs lignes d'écriture, chacune ne répondant toujours que d'une ligne), dans le serveur et dans le pont. La Banque propose « Remise de 3 écritures · leur somme fait la ligne au millime », les trois cochées ; « Rapprocher les 3 », ou « Valider les 2 » avec le reste. Même règle que l'import de l'entreprise : deux à quatre écritures du même sens, des vingt jours d'avant la ligne, et seulement quand une seule combinaison fait la ligne. |
| P2 | Deux combinaisons possibles, ou une remise que le calcul ne voit pas : rien ne permettait d'en poser une soi-même. | « Plusieurs écritures font cette ligne ? » ouvre les écritures du même sens des vingt jours, à cocher ; la somme et l'écart se lisent avant le geste (« Les 2 écritures cochées font 2 767,345 DT, la ligne 3 495,982 DT »). Deux combinaisons : les écritures en jeu se montrent, rien n'est coché d'office. « Une seule écriture » ramène au choix habituel. |
| P3 | Rien n'empêchait, au serveur, une remise fausse. | La base refuse une remise dont les écritures ne font pas la ligne au millime, une écriture choisie deux fois, une écriture qui répond déjà d'une autre ligne, ou d'un autre compte ; « Tout défaire » compte les lignes (une remise en est une). Une écriture d'une remise ne se modifie ni ne se supprime en douce, comme celle d'un rapprochement simple. |
| P4 | Rapprochée, la remise se lisait par son premier chèque seul (« encaissement de c1 »), et le message disait « chacune avec l'écriture proposée ». | La ligne dit « avec FAC-2026-001 et 2 autres écritures (une remise) · encaissement de c1, c2, c3 » ; en face, les trois écritures, chacune avec « Ouvrir », et la somme. Le message dit ce que chaque ligne a reçu (« 1 avec l'écriture proposée, une remise avec ses 3 écritures »). « Défaire » rend la ligne à traiter, « Annuler » repose la remise entière. |
| P5 | Le pont, vérifié de bout en bout : les frais créés depuis le relevé de l'entreprise (1.298.0, « Frais bancaires ») arrivent bien au **627** du Cabinet ; l'état de rapprochement envoyé par l'entreprise arrive dans la conversation du cabinet (« solde du relevé 3 477,482 DT, aucun écart »). | Rien à corriger ; un parcours le tient désormais, des deux côtés. |

Une preuve de 1.297.0 est restée verte sur GitHub après la 1.298.0 : la règle générale « un bloc d'onglet tient dans sa
largeur » (1.298.0) faisait déjà ce que faisait la garde propre à la fiche du fournisseur. La garde est retirée, la
preuve vise la règle qui travaille.

Limite connue, à reprendre avec la Comptabilité : avant que la remise soit rapprochée, le pied de la Banque lit les
chèques écrits avant la première ligne du relevé comme « d'avant le relevé » et parle d'un premier relevé qui « ne part
pas du solde du livre » ; une fois la remise rapprochée, l'écart est expliqué au millime.

Suivant : les Marges, puis la Comptabilité de l'entreprise (chacune avec son côté Cabinet et le pont).

### Fait en 1.300.0 (06/11/2026) : les Marges — l'électricien et ses trois chantiers, l'état des chantiers jusqu'au comptable

Joué comme un électricien de Tunis (« Électricité Ben Ammar », un salarié, deux fournisseurs) : la villa Karoui à Gammarth
(devis 12 450 DT, acompte de 30 %, solde, achats, 72 h — terminée, rentable), l'immeuble Ennasr (16 900 DT au devis,
17 540 facturés, 17 759 DT de câbles et coffrets — terminé à perte), les bureaux du Lac 2 (devis 26 300 DT, acompte de
7 890 DT, 9 874 DT de câbles, 46 h — en cours), et l'entretien mensuel de la résidence Les Orangers (six factures de
385 DT). Sa comptable, au Cabinet Ennour, reçoit l'état des chantiers.

| # | Trouvé | Fait |
|---|---|---|
| M1 | Le chantier en cours, qui suit son devis, s'affichait **en rouge** (« − 2 325,558 · −29,5 % ») et sa fiche disait **« Cette affaire perd de l'argent »** : ses câbles et ses heures arrivent avant ses factures. Son « Prévu et réel » peignait aussi en rouge le « − 18 410 » qui reste simplement à facturer. | Un chantier en cours se lit **à l'avancement** (une seule fonction, `avancementAffaire`, pour la liste, la fiche et l'état) : coût engagé rapporté au coût prévu de ses devis, travaux faits, reste à facturer, marge attendue à la fin. La liste dit « en cours · attendue 8 449,600 » sans rouge ; la fiche dit « Marge à ce jour … attendue à la fin : 8 449,600 DT (32,1 %) » et « Chantier en cours : 57,2 % du coût prévu est engagé … 7 161,157 DT restent à facturer ». Le rouge ne vient que d'une perte attendue (« Ce chantier va perdre de l'argent »). Sans devis chiffré, rien ne s'invente. À VÉRIFIER : la méthode à l'avancement. |
| M2 | Le Cabinet ne voyait **rien** des chantiers : à la clôture, la comptable n'avait ni le coût des chantiers pas finis, ni ce qui en restait à facturer, ni la perte à provisionner. | **L'état des chantiers à une date** (Marges › « État des chantiers ») : pour chaque chantier pas fini à la date, le facturé, le coût engagé sur le prévu, l'avancement, les travaux faits, le reste à facturer (ou facturé d'avance) et la perte attendue ; seules comptent les pièces et les heures datées au plus tard ce jour (au 20 octobre, l'immeuble Ennasr n'était pas fini : 1 748,888 DT de perte attendue). Il s'exporte en CSV, et **« Envoyer à mon comptable »** l'ouvre, chiffres compris, dans la conversation du cabinet — c'est l'entreprise qui l'envoie. Vérifié de bout en bout : le message arrive au Cabinet, lisible ligne par ligne. |
| M3 | En jouant : taper la date puis **Entrée** ouvrait la conversation (le geste principal de la fenêtre). | Entrée pose la date et redessine l'état ; elle n'envoie rien. |
| M4 | « Où est la marge » donnait **100 %** de marge, sans « ≈ », au client qui n'avait reçu qu'un acompte (les bureaux du Lac). | Sans prestation facturée, pas de taux : « — ». Le reste ne change pas. |
| M5 | Le seuil de rentabilité, sans aucune charge fixe notée (ni loyer, ni bulletin), annonçait un minimum de **0,000 DT** et « Tu l'as dépassé de 40 190 DT ». | « Aucune charge fixe n'est notée en 2026 … le seuil ne se calcule pas encore », et où les noter. |
| M6 | Au téléphone, les cartes des marges montraient **quatre nombres sans nom**. | Chaque montant porte son nom (Vendu HT, Coût, Marge, En caisse ; Facturé, Par mois pour les contrats). |
| M7 | Trouvé en préparant le jeu : une facture émise dont les prix sont écrits « 385.000 » (un appel de l'API, un import) revenait de la page en « 385 » ; le serveur comparait le texte et **refusait tout l'enregistrement du dossier** (« Rien n'a été enregistré »), et plus rien ne s'enregistrait. | Un nombre scellé se compare par sa valeur ; un autre prix reste refusé. |

Limite connue : l'état des chantiers part dans la conversation en texte ; il ne propose pas encore l'écriture d'en-cours ou
de provision au Cabinet (la comptable la passe en Saisie). La marge d'un chantier n'est pas encore lue dans le livre du
Cabinet (l'axe « Affaires » sur les lignes d'écriture, prévu au cadrage 01, reste à faire).

Suivant : la Comptabilité de l'entreprise (avec son côté Cabinet et le pont).


## La comptabilité de l'entreprise

### Fait en 1.301.0 (07/11/2026) : ce que le cabinet a déclaré et validé, et l'achat oublié après le dépôt

Joué comme un grossiste en produits d'entretien de Sousse (« Hygiène Plus Sahel ») avec sa comptable au Cabinet Ennour, sur
deux mois : en septembre, un gros achat chez Sahel Chimie (retenue de 1,5 % opérée en payant) et deux factures, donc un
crédit de TVA ; en octobre, trois factures (l'hôtel retient 1,5 % en payant), un avoir, du carburant à TVA non déductible,
des emballages. La comptable dépose la TVA de septembre le 27/10 et valide septembre dans ses livres ; le grossiste saisit
ensuite un achat de septembre oublié (des bidons, 507 DT HT). Puis il clôture septembre, le rouvre avec un motif. Une
entreprise sans cabinet a fait le même tour. Les chiffres tiennent des deux côtés (chiffre d'affaires 2026 : 16 095,420 DT
HT ici et dans le dossier du Cabinet).

| # | Trouvé | Fait |
|---|---|---|
| C1 | L'ancienne mise en page : un titre seul, des onglets gris, des tuiles et des panneaux empilés. | La DA des listes, comme les Statistiques : le chemin, une phrase (« … et ce que ton cabinet en a fait » quand il y en a un), les onglets dans leur barre et la période à droite, chaque onglet dans sa carte, ses panneaux séparés d'un trait. Au téléphone, la barre défile dans sa carte. L'intérieur des onglets garde son dessin (lot suivant). |
| C2 | La comptable a déposé la TVA de septembre : la Comptabilité de l'entreprise n'en savait rien, ni l'onglet TVA, ni le calendrier. | L'onglet TVA lit les livres du cabinet : « Déposée par ton cabinet le 27/10/2026 (réf. TEJ-2026-0927) », et « déposée » au mois dans le tableau de l'année. Un mois terminé pas encore déposé : « Ton cabinet ne l'a pas encore déposée : il a jusqu'au 28/11/2026 » (ou « la date limite était le … ») et « Lui écrire ». |
| C3 | L'achat de septembre saisi après le dépôt changeait la TVA de septembre **sans un mot** : 4 222,769 DT de déductible ici, 4 126,439 DT déclarés par le cabinet. | L'écart se dit, au millime (« ton cabinet en a déclaré 4 126,439 DT (+ 96,330 DT) »), et « Le dire à mon comptable » ouvre la conversation, le message écrit. Une case que le cabinet n'a pas remplie ne fait pas d'écart. À VÉRIFIER : la reprise d'une pièce oubliée sur une déclaration suivante. |
| C4 | Le calendrier faisait « Marquer déposée » une TVA que le cabinet dépose, et la TVA de septembre, passée, n'y était plus nulle part. | « Tes déclarations de TVA, chez ton cabinet » : chaque mois terminé, sa date limite (la règle du calendrier), déposée le…, en retard, à préparer ; « Lui écrire », « Voir la TVA ». Dans « Ce qui arrive » : « Ton cabinet la dépose », et le client garde « Je l'ai déposée moi-même ». Le serveur dit si les déclarations sont confiées au cabinet. |
| C5 | Les clôtures disaient « Aucune période n'est clôturée » à un client dont le cabinet avait validé septembre. | « Ton cabinet a validé tes livres jusqu'au 30/09/2026 : ses écritures de cette période ne bougent plus chez lui », ce qui peut encore changer chez soi, et clôturer pareil d'un seul bouton (le même que « Clôturer septembre » quand c'est le mois suivant). |
| C6 | « Rouvrir » disait de prévenir son comptable soi-même (« le motif ne part pas chez lui ») alors que la conversation est à côté. | Après une clôture ou une réouverture, « Le dire à mon comptable » ouvre la conversation, le message prêt (motif compris) ; la dernière ligne du journal le redit, le bandeau passé. Vérifié : les trois messages arrivent au Cabinet. |
| C7 | Les écritures proposaient « Envoyer au comptable » (un e-mail) à un cabinet qui les lit en direct. | « Envoyer par e-mail… », et la phrase qui le dit, comme pour les ventes ; le livre-journal dit que ce sont celles que le cabinet lit. |
| C8 | « Voir les ventes de octobre », un résultat à perte écrit « -335 % ». | « d'octobre », « −335 % ». |
| C9 | En jouant : « Ton cabinet la dépose » collé à son bouton ; deux boutons pour clôturer le même septembre ; au téléphone, la barre des onglets élargissait la page (217 px) et le journal des clôtures était coupé. | L'espace, un seul bouton, la barre et les tableaux défilent dans leur carte. |

Le rouge GitHub de 1.299.0, réparé dans le même envoi : le contrôle des frontières (F12) refusait le pont du Cabinet grandi
de neuf lignes. La remise de chèques change une traduction que ce pont faisait déjà : son plafond passe de 2 788 à 2 797
lignes, avec sa raison. La lecture neuve de ce lot (les livres du cabinet) ne fait pas grandir le pont de l'entreprise : elle
vit dans `modules/declarations/pont/entreprise.js`, assemblé à la suite du pont, qui pose sa porte au socle
(`Socle.porte('pont').appel`) ; c'est le premier morceau de pont d'un module (cadrage 17, journal du 07/11/2026).

Sans cabinet, rien de ce qui précède : la phrase d'en-tête est la sienne, le calendrier garde « Marquer déposée ».

Limites connues : l'intérieur des onglets (les quatre tuiles des ventes et des achats, les tableaux des journaux, du grand
livre, de la balance et des états) garde son dessin d'avant ; un achat daté dans une période que le cabinet a validée
s'enregistre sans avertissement au moment de la saisie (la TVA le dit ensuite) ; les déclarations lues sont celles de la
TVA mensuelle.

Suivant : l'intérieur des onglets de la Comptabilité dans la DA (chiffres en carte, journaux, grand livre, balance, états,
téléphone), puis l'avertissement à la saisie d'une pièce dans une période validée par le cabinet.

### Fait en 1.302.0 (07/11/2026) : l'intérieur des onglets dans la DA, et l'achat daté dans une période validée, dit avant

Rejoué avec le même grossiste de Sousse et sa comptable : septembre déposé puis validé par le cabinet jusqu'au 30/09/2026,
chaque onglet lu au bureau puis au téléphone (390 px), puis l'achat de septembre oublié (des bidons chez Emballages du
Centre, 603,330 DT TTC) saisi à la souris. Une entreprise sans cabinet a fait la même saisie.

| # | Trouvé | Fait |
|---|---|---|
| C10 | Dans la nouvelle carte de chaque onglet, l'intérieur gardait l'ancien dessin : des tuiles en boîtes ombrées aux coins ronds (ventes, achats, TVA), des tableaux encadrés à titres en capitales, en retrait du bord de la carte. | Les chiffres comme ceux des Marges et des Statistiques : quatre cases séparées d'un trait, sans boîte, le nom en gris et le montant en gras (vert ce qui est réglé, rouge ce qui est dû). Les tableaux des journaux, du grand livre, de la balance et des états vont d'un bord à l'autre de la carte, titres en clair, sans cadre. Les deux colonnes (bilan, résultat) séparées d'un trait. |
| C11 | Les vues de la balance (générale, auxiliaires, lettrage) étaient une deuxième rangée d'onglets, pareille à celle de la page. | Des boutons segmentés, comme ailleurs dans les écrans de la DA. |
| C12 | Au téléphone, le tableau de l'année de la TVA faisait douze cartes, dont huit de zéros (janvier à août) : une page de 4 500 px. | Les mois sans rien (ni vente, ni achat, ni crédit, ni déclaration déposée) ne font plus leur carte, et la phrase les nomme : « Au téléphone, les mois sans rien ne s'affichent pas : janvier à août. » (2 873 px). Au bureau, les douze lignes restent. Les chiffres passent sur deux colonnes, rien ne déborde. |
| C13 | Un achat daté du 15/09, dans la période que le cabinet a validée, s'enregistrait sans un mot (la TVA le disait ensuite). | Pendant la saisie, sous la date : « Cette pièce est datée du 15/09/2026, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : elle lui arrivera comme une correction, à reprendre sur un mois ouvert. En l'enregistrant, tu pourras le lui dire. » Rien n'est bloqué. Enregistré, « Le dire à mon comptable » ouvre la conversation, le message écrit (la date, le fournisseur, le numéro, le montant). Une pièce déjà enregistrée rouverte ne le redit que si on la change ; une date d'octobre ne dit rien ; sans cabinet, rien. Aussi au téléphone. |

Le rouge GitHub de 1.301.0, réparé dans le même envoi : le test de l'assemblage exigeait que chaque pont n'ait que son
unique morceau, l'état d'avant le premier morceau de pont d'un module ; il dit maintenant la règle (le pont d'abord, puis
les morceaux des modules, chacun dans son dossier `pont/`), et sa preuve remet le morceau du module avant le pont.

Limites connues : l'avertissement de C13 n'est que dans la saisie d'un achat, d'une dépense ou d'un avoir reçu (pas encore
dans une facture de vente, un règlement ni une opération diverse) ; la date validée se relit au plus toutes les 30 secondes ;
les déclarations lues restent celles de la TVA mensuelle.

Suivant : le même avertissement dans les autres saisies (facture de vente, règlement, opération diverse), puis le module
suivant de la revue.

### Fait en 1.303.0 (07/11/2026) : la période validée dite partout où l'on saisit, et l'opération diverse jusqu'au cabinet

Rejoué avec le même grossiste de Sousse et sa comptable, septembre validé par le cabinet jusqu'au 30/09/2026 : fin octobre,
on rattrape ce que septembre a oublié. Une facture restée en brouillon (Clinique Les Oliviers, 698,340 DT), émise à la
souris ; le paiement d'une facture de septembre (Café des Arts, 491,875 DT) noté à sa vraie date, puis rouvert ; le
règlement d'un achat (Emballages du Centre, EC-4410) ; deux autres achats du même fournisseur réglés en un seul virement ;
l'assurance du local avancée par le gérant (845,300 DT, 616 contre 4421), saisie en opération diverse. Puis la comptable
ouvre son livre-journal au Cabinet. Une entreprise sans cabinet a fait la même opération diverse.

| # | Trouvé | Fait |
|---|---|---|
| C14 | Une facture ou un avoir émis à une date de la période validée partait sans un mot (C13 ne valait que pour les achats). | La fenêtre d'émission le dit avec ses autres avertissements : « Cette facture est datée du 29/09/2026, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : chez lui, elle s'écrira au 01/10/2026, le premier jour encore ouvert. En l'émettant, tu pourras le lui dire. » Rien n'est bloqué. Émise, « Le dire à mon comptable » ouvre la conversation, le message écrit (le numéro, la date, le client, le montant). |
| C15 | Le paiement d'une facture, le règlement d'un achat et le virement qui règle plusieurs achats, datés dans la période validée, s'enregistraient sans un mot (et leur remboursement aussi). | La même phrase sous le formulaire, pendant la saisie de la date ; « Le dire à mon comptable » après. Un paiement rouvert sans changer ni sa date, ni son montant, ni son mode, ni son compte ne dit rien (une référence ajoutée ne change rien chez le comptable) ; sa date touchée, la phrase revient et parle de la correction (« chez lui, la correction s'écrira au 01/10/2026 »). Le message envoyé arrive dans la conversation du cabinet. |
| C16 | L'opération diverse aussi (un loyer sans facture, une charge avancée par le gérant). | La même phrase sous l'écriture, sous « Débit = crédit », et « Le dire à mon comptable » après ; rouverte sans changement, rien. |
| C17 | **Le pont** : l'opération diverse que le client saisit ne quittait jamais son livre. Le serveur ne l'écrivait nulle part, et le cabinet, qui lit les livres du serveur, ne la voyait jamais, alors que l'onglet Écritures dit au client que son cabinet les lit en direct. | Chaque opération devient une famille d'écritures du serveur (0194, `serveur/compta/operations.ts`), comme un mouvement de trésorerie : les mêmes lignes que la v10 (comptes, libellés, montants au millime, journal, numéro de pièce), et seulement si elle tombe juste. Corrigée, elle se réécrit ; supprimée, elle quitte le brouillard. Dans une période validée, elle s'écrit au premier jour encore ouvert ; validée puis changée, elle se contre-passe à ce jour-là. Au Cabinet, elle se lit dans le livre-journal du client, au brouillard, en lecture seule (une pièce du client). |
| C18 | La phrase de C13 disait « elle lui arrivera comme une correction, à reprendre sur un mois ouvert » : c'était inexact. Le serveur l'écrit lui-même au premier jour encore ouvert, la comptable n'a rien à reprendre à la main. | Toutes les phrases disent ce qui se passe vraiment : « chez lui, elle s'écrira au 01/10/2026, le premier jour encore ouvert », et le message « elle s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ? ». La phrase des Clôtures aussi. |

Le rouge GitHub de 1.302.0, réparé dans le même envoi (`cabinet-revision`, sous Node 24 seulement) : au Cabinet, la fenêtre
« Une question au client » plaçait le curseur au bout de la phrase proposée un tour de boucle après son ouverture. Sur une
machine lente, ce tour arrivait après le premier geste de la comptable (cliquer, tout sélectionner) : la sélection se
défaisait, et ce qu'elle tapait s'ajoutait à la suite de la phrase proposée, jusque chez le client. Le curseur ne se place
plus quand on est déjà dans le champ ; le test joue maintenant ce geste sur une page ralentie, et sa preuve retire la garde.

Limites connues : une opération diverse saisie avant 1.303.0 n'arrive chez le cabinet qu'à sa prochaine modification (la
réécriture de toutes est prête, `reecrireLesOperations`, et n'est pas encore lancée sur les dossiers existants) ; les
mouvements de la trésorerie, la caisse et la paie ne disent pas encore la période validée ; la date validée se relit au
plus toutes les 30 secondes.

Suivant : la même phrase dans les mouvements de la trésorerie et la paie, puis le module suivant de la revue.
