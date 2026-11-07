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

### Fait en 1.304.0 (07/11/2026) : la période validée dite dans la trésorerie, et avant de supprimer ce qui y tombait

Rejoué avec le même grossiste de Sousse et sa comptable, septembre validé jusqu'au 30/09/2026 : début novembre, on fait le
ménage. Un impôt payé le 20/09 et jamais noté (retenues à la source d'août, 1 286,400 DT), saisi dans la trésorerie puis
corrigé (1 312,600 DT) ; des frais bancaires du 10/09 saisis deux fois, supprimés ; un paiement noté par erreur le 26/09 sur
la facture du Café des Arts, le règlement du 25/09 à Emballages du Centre, un achat du 18/09 saisi à tort (c'était le
devis), une assurance passée deux fois en opération diverse le 12/09 : supprimés. Puis la comptable ouvre son livre-journal.
Des frais d'octobre supprimés, et une entreprise sans cabinet, ne disent rien.

| # | Trouvé | Fait |
|---|---|---|
| C19 | Un mouvement de la trésorerie (un impôt, des frais, un apport) daté dans la période validée s'enregistrait sans un mot : la trésorerie était la dernière saisie datée qui ne le disait pas. | La même phrase sous le formulaire, pendant la saisie de la date (« Ce mouvement est daté du 20/09/2026, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : chez lui, il s'écrira au 01/10/2026… »), et « Le dire à mon comptable » après. Rouvert sans rien changer de ce qui s'écrit chez lui (date, nature, montant, compte, contrepartie, compte qui reçoit), rien : un libellé ou une référence ne change pas ses livres. Le montant corrigé, la phrase parle de la correction. |
| C20 | **Supprimer** ce qui tombait dans la période validée (un mouvement, le paiement d'une facture, le règlement d'un achat, un achat, une opération diverse) ne disait rien, alors que chez le cabinet l'écriture validée se contre-passe au premier jour encore ouvert : la comptable découvrait l'annulation sans savoir d'où elle venait. | La question qui demande avant de supprimer le dit : « Il est daté du 10/09/2026, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : chez lui, son annulation s'écrira au 01/10/2026, le premier jour encore ouvert. » Rien n'est bloqué. Supprimé, « Le dire à mon comptable » ouvre la conversation, le message écrit (« je viens de supprimer un mouvement daté du 10/09/2026 (…) : il tombait dans la période que tu as validée…, son annulation s'écrit donc chez toi au 01/10/2026 »). Vérifié chez la comptable : l'écriture validée reste au 10/09, sa contre-passation arrive au 01/10, au brouillard, et le message dans sa conversation. |
| C21 | La question d'une suppression doit savoir AVANT de demander : la date validée se lit au serveur, et au tout premier geste d'une page elle n'était pas encore là. | La suppression attend la réponse un instant (deux secondes au plus) ; sans cabinet, ou déjà lue, elle répond tout de suite. Une lecture qui échoue ne bloque plus les suivantes. |

Limites connues : la paie (bulletins, salaires payés, avances) et la caisse ne disent pas encore la période validée (le
mouvement créé depuis le relevé de la banque, lui, passe par la même fenêtre et le dit) ; une opération diverse saisie avant 1.303.0 n'arrive chez le cabinet qu'à
sa prochaine modification ; la date validée se relit au plus toutes les 30 secondes.

Suivant : la même phrase dans la paie (1.305), puis le module suivant de la revue.

### Fait en 1.305.0 (07/11/2026) : la période validée dite dans la paie

Rejoué avec le même grossiste de Sousse, qui fait sa paie lui-même (son cabinet tient la comptabilité et les déclarations,
pas la paie), septembre validé jusqu'au 30/09/2026 : début novembre, on découvre que les bulletins de septembre d'Amel
(vendeuse) et de Sami (livreur), entrés le 01/09, n'ont jamais été établis. On les établit, on ajoute la prime de rendement
d'Amel (85,500 DT), on paie les deux salaires au 30/09 ; puis Sami n'est jamais venu : son paiement s'annule (« payé par
erreur ») et son bulletin se supprime. L'avance de Karim du 15/09, notée deux fois, se supprime ; une autre avance, ramenée
au 25/09, le dit pendant la saisie. Puis la comptable ouvre son livre-journal. Une entreprise sans cabinet n'en dit rien.

| # | Trouvé | Fait |
|---|---|---|
| C22 | La paie était la dernière saisie datée qui ne disait pas la période validée : établir des bulletins oubliés, corriger un bulletin, payer les salaires, annuler un paiement, supprimer un bulletin, saisir ou supprimer une avance, tout s'enregistrait sans un mot, alors que chez le cabinet la paie du mois se réécrit au premier jour encore ouvert. | La même phrase, au même endroit que partout ailleurs : sous la fenêtre « Établir les 2 bulletins » (« Ces bulletins sont datés du 30/09/2026… chez lui, ils s'écriront au 01/10/2026… »), sous le bulletin pendant la saisie (« …la correction s'écrira au 01/10/2026 »), sous « Payer les salaires » quand la date tombe dans la période, dans « Annuler le paiement », dans les questions « Supprimer ce bulletin ? » et « Supprimer cette avance ? », sous l'avance pendant la saisie, et sous « Noter déposée et payée », « Retirer la mention » et le versement d'une saisie sur salaire. Rien n'est bloqué ; après, « Le dire à mon comptable » ouvre la conversation, le message écrit (« je viens d'établir les 2 bulletins de septembre 2026 (Amel Jaziri, Sami Ferchichi), datés du 30/09/2026 (net 1 590,612 DT) : ils tombent dans la période… »). Rouvert sans rien changer de ce qui fait ses montants, un bulletin ou une avance ne le redit pas ; une ligne de prime encore vide non plus. |
| C23 | Supprimer un bulletin depuis la liste demandait « Supprimer le bulletin de undefined pour septembre 2026 ? » : la question lisait un nom que le bulletin rangé ne porte pas. | Elle nomme le salarié de sa fiche. |
| C24 | Une avance rouverte sans rien changer se disait « changée » quand l'entreprise n'a qu'un compte (la fenêtre ne montre alors pas la case du compte). | Une case que la fenêtre ne montre pas garde la valeur de l'avance, comme à l'enregistrement. |
| C25 | Le message au comptable écrivait « le bulletin de Amel » ; celui des bulletins établis taisait la devise. | « d'Amel », « d'octobre 2026 » ; « net 1 590,612 DT ». |

Vérifié chez la comptable : la paie et les salaires de septembre qu'elle avait validés restent au 30/09 ; au 01/10, au
brouillard, leur contre-passation et la paie réécrite (le brut des bulletins du mois, la prime comprise ; les salaires de
Karim et d'Amel, sans Sami) ; les 600 DT d'avances validés restent au 15/09, leur contre-passation et les 300 DT qui restent
arrivent au 01/10.

Limites connues : au livre-journal du Cabinet, la contre-passation et la paie réécrite (même pièce, même jour) se lisent dans
un seul bloc, sous l'étiquette « contre-passation » ; « Payé le » saisi dans le bulletin lui-même, la déclaration payée,
la mention retirée et le versement d'une saisie sur salaire disent la phrase mais ne sont pas encore joués par un scénario ;
la régularisation sur un mois suivant et la caisse ne la disent pas encore ; un mois qui a des bulletins manquants ne propose
« Payer les salaires » qu'une fois établis (le patron qui ne veut pas payer quelqu'un supprime d'abord son bulletin).

Suivant : le module suivant de la revue.

## Les devis

### Fait en 1.306.0 (07/11/2026) : le devis changé après l'envoi, la réponse notée de toutes les portes

Joué comme un menuisier de Sfax (« Menuiserie El Amen ») et ses deux clients. Ines Ben Ammar a reçu le devis de son
dressing par e-mail il y a douze jours ; elle demande une porte miroir : la pose passe de 350 à 420 DT, sur un devis déjà
chez elle. Hatem l'enregistre, le renvoie, puis note depuis la fiche d'Ines qu'elle a dit oui au téléphone la veille.
L'Hôtel Thyna a un devis expiré (ses portes, qu'il veut encore réfléchir : on prolonge) et un devis parti par WhatsApp
(son comptoir, parti chez un concurrent : refusé, avec son pourquoi) ; il revient pour un autre comptoir : on duplique.

| # | Trouvé | Fait |
|---|---|---|
| D1 | Un devis déjà parti chez le client se changeait sans un mot : même numéro, nouveaux prix, et rien ne disait que personne ne l'avait prévenu. Son lien montre la version du jour (l'espace lit le dossier), mais le message qu'il a reçu disait l'autre. | « Ce que le client a reçu » le dit pendant la saisie (« Déjà envoyé à Ines Ben Ammar le 26/10 : enregistré, personne ne lui aura dit ces changements. Renvoie-le ensuite, il garde son numéro. »), à l'enregistrement (« Enregistré : DEV-2026-021 — personne ne l'a dit à Ines Ben Ammar », avec « Le renvoyer »), puis jusqu'au prochain envoi (« Modifié le 07/11, après l'envoi du 26/10 : personne ne l'a dit à Ines Ben Ammar. » et « Le renvoyer par e-mail », par le canal du dernier envoi). Ne comptent que ce que le client lit (dates, objet, remise, notes, lignes : texte, quantité, prix, TVA, remise) ; retaper le même prix ne dit rien. Reparti par e-mail ou par WhatsApp, la marque s'efface. Rien n'est bloqué. |
| D2 | Depuis la fiche d'un client (et d'un contrat, et de l'accueil), « Le client a accepté » passait par une fenêtre à elle, qui ne notait ni la date, ni le canal, ni le pourquoi d'un refus : la frise du devis disait « Accepté » sans dire quand, le motif se perdait, et « Prolonger sa validité » n'y existait pas. | Un devis a le même menu partout : celui de la liste des devis (la réponse du client, la facture qui suit, les envois, la pièce), avec la même fenêtre que le devis (quand, comment, pourquoi). |
| D3 | Le devis partait par l'ancienne fenêtre d'envoi (une adresse à taper, une case du lien), hors de la DA de la facture. | La fenêtre de la facture : les adresses du client cochées, une autre adresse, la copie pour soi, WhatsApp ou le lien seul ; sans ce qui ne regarde que la facture (le fichier El Fatoora, la signature) ; « Le lien seul » n'est pas offert à un devis encore en brouillon (l'espace ne le montre jamais) ; une relance de devis s'y titre « Relancer le devis … ». |
| D4 | La carte du client disait « premier document pour ce client » à l'Hôtel Thyna, qui avait déjà deux devis : elle ne regardait que les factures. | « Premier document » seulement s'il n'en a aucun autre ; une facture pour qui n'avait que des devis dit « première facture pour ce client ». |
| D5 | « Accepté le » et « Prolonger » prenaient la date du navigateur, pas le champ de date à la française de la plateforme ; une acceptation se notait avant la date du devis. | Le champ JJ/MM/AAAA de partout ; une date avant celle du devis, ou dans le futur, se refuse en montrant le champ (« Le devis est daté du 26/10/2026 : il n'a pas pu être accepté avant. »). |
| D6 | « Dupliquer » un devis refusé recopiait son refus et son pourquoi ; une commande tirée d'un devis accepté (« Transformer ») portait son acceptation. | Le nouveau devis naît sans réponse ni marque ; une pièce tirée d'un devis non plus. |

Vérifié côté Cabinet et pont : un devis n'entre pas dans les livres, et la comptable le lit dit (« Un devis n'entre pas
dans les livres : il n'a pas d'écriture à ouvrir. ») ; « Écrire au cabinet sur ce devis » porte son numéro, son client et
son total du jour. Ce que voit le client par son lien reste « En attente de ta réponse » : il ne répond pas en ligne.

Limites connues : SkanFact ne sait pas quelle version le client a lue (son lien montre toujours la dernière) ; la marque
ne se pose que sur un devis encore en attente (envoyé ou expiré) ; la fenêtre WhatsApp reste l'ancienne (pour la facture
aussi) ; un devis changé ne propose pas encore de garder sa version envoyée en pièce jointe.

### Fait en 1.307.0 (07/11/2026) : du devis à la facture, tel que la maquette

Le même menuisier, la suite. Ines a reçu la nouvelle version (la pose à 420 DT), dit oui au téléphone et verse 40 % à la
commande ; le dressing posé, Hatem fait la facture de solde. L'Hôtel Thyna commande son comptoir par téléphone : Hatem
le facture tout de suite, sans noter la réponse, puis, le lendemain, ouvre « Refacturer la totalité » par erreur.

| # | Trouvé | Fait |
|---|---|---|
| G1 | Le devis changé après l'envoi ne gardait pour étape suivante que « Le client a accepté… » ; « Le renvoyer » vivait dans un coin, et le message reparti était celui du premier envoi (« Voici notre devis… »). | La pastille dit « Envoyé · modifié depuis » ; le bouton principal est « Renvoyer la nouvelle version » (par le canal du dernier envoi), avec « Son lien montre déjà cette version ; le message lui dit qu'elle remplace la précédente. Il garde son numéro. », la réponse du client juste dessous. La fenêtre s'appelle « Renvoyer DEV-… », et le message est un modèle à lui (« Nouvelle version du devis … — … Elle remplace celle que nous vous avions envoyée. »), réglable dans Paramètres › Envois comme les autres. Reparti, le devis redit « Envoyé · attend la réponse ». |
| G2 | La fenêtre d'acompte était un formulaire nu : un pourcentage à taper, le montant découvert après. | En pourcentage ou en dinars TTC, d'un clic (30, 40, 50 %) ; l'acompte et « le solde, plus tard » côte à côte, tels qu'ils naîtront (même calcul que la facture) ; le second timbre dit avant (« Deux factures, donc deux timbres : le client paiera … en tout, 1,000 DT de plus qu'en une seule facture. ») ; hors du devis, le bandeau rouge le dit et le refus montre le champ. |
| G3 | « Facture de solde » faisait le brouillon sans montrer ce qu'il déduisait. | Avant le brouillon, la fenêtre de la maquette : taux par taux, le devis HT, l'acompte déduit, le solde HT ; quel acompte (numéro, date, part) ; ce que le client paiera (TTC, timbre, retenue). |
| G4 | Facturé sans que la réponse soit notée (le cas du téléphone), le devis passait « accepté » sans dire quand : la frise restait vide. | La facture faite note l'acceptation du jour, et qui l'a faite ; une réponse déjà notée n'est pas réécrite. |
| G5 | « Refacturer la totalité » demandait par une boîte de texte, sans le chemin sûr. | La fenêtre « Refacturer la totalité ? » : ce que le devis a déjà donné, en bandeau ; le chemin sûr selon le cas (la facture de solde s'il y a un acompte ; la corriger si elle est encore en brouillon ; un avoir si elle est émise) ; « Voir » la première facture ; « Refacturer quand même » reste possible. |
| G6 | (vu sur la photo) Les deux boutons de la réponse dépassaient de leur carte de 14 px. | « Il a accepté… » et « Il a refusé » tiennent dans la carte ; le test le mesure. |

Vérifié côté Cabinet et pont : les factures d'acompte et de solde sont celles d'avant (mêmes lignes, une ligne négative
par taux pour l'acompte déduit, même écriture), donc rien ne change à ce que la comptable lit ; un devis n'entre toujours
pas dans les livres.

Limites connues : le solde d'un devis à plusieurs acomptes les déduit tous, sans choisir ; un acompte se rembourse
encore par un avoir à la main.

## Les factures

### Fait en 1.308.0 (07/11/2026) : encaisser, relancer, corriger par un avoir

Joué par le même menuisier de Sfax et sa comptable au Cabinet Ennour. L'Hôtel Thyna (retenue à la source de 1,5 %) paie
ses quatre portes en deux fois : un chèque de 2 000 DT, puis le reste par virement. Ines Ben Ammar n'a rien payé de son
dressing, échu depuis 15 jours (facture remise de la main à la main, jamais partie par SkanFact). Le Café El Medina rend
une chaise abîmée : un avoir d'une chaise, puis il paie le reste en espèces. Enfin la comptable ouvre le livre-journal.

| # | Trouvé | Fait |
|---|---|---|
| F1 | Après l'avoir d'une chaise, la facture du café se disait « Payée en partie » et « 172,848 DT reçus » : il n'avait rien payé. Et une facture échue réduite par un avoir ne se disait plus en retard. | Un avoir diminue ce qui est dû, ce n'est pas un paiement (décision D6 de `docs/avoirs-reglements.md`) : la facture reste « Émise » (ou « En retard »), et dit « Rien de reçu, 172,848 DT retirés par avoir, reste 1 317,437 DT ». La même règle dans les deux moteurs (écrans et serveur), donc dans la liste, la fiche du client, l'espace client et la console ; l'écart avec la v10 est tranché dans le banc des règlements. La frise dit « rien de reçu · reste … ». |
| F2 | La facture d'Ines, échue depuis 15 jours, disait « Rien de reçu · échéance le 23/10 », avec « Enregistrer un paiement » pour seule étape ; son menu n'offrait pas « Relancer » (il ne le faisait que pour une facture partie par SkanFact), alors que la page Relances la comptait « à relancer ». | Une facture échue le dit (« en retard de 15 jours ») et son bouton principal devient « Relancer Ines Ben Ammar… » (le rappel courtois du bon niveau, le même message que la page Relances), le paiement juste dessous ; le menu ⋯ l'offre aussi. Relancée, elle dit « Relancée le 07/11 : on attend sa réponse jusqu'au 14/11 », comme la page Relances, et le paiement redevient l'étape suivante. |
| F3 | « Paiements et situation » disait « Les relances commencent une fois la facture envoyée au client » : faux, une facture échue se relance qu'elle soit partie ou non. | « En retard de 15 jours : « Relancer » prépare le rappel. », ou, avant l'échéance, « Si rien n'arrive, elle passera dans les relances le 05/12. » |

Vérifié en jouant : le paiement en deux fois avec retenue tombe juste (30,452 puis 58,825 DT gardés par l'hôtel, 89,277 en
tout, chaque part dite avant d'enregistrer et comptée en retenue subie de novembre) ; la case « Attestation de retenue
à la source reçue » apparaît ; l'avoir se prépare depuis la facture (« Retour de marchandise », une chaise) et dit avant
d'émettre ce que la facture laissera à payer. Côté Cabinet et pont : le livre-journal montre chaque paiement avec sa part
de retenue au 4358, l'avoir qui recrédite le client (411) et annule sa vente et sa TVA, les espèces en caisse (54).

Limites connues : un chèque reçu va au compte de la banque (532) dès qu'il est noté, sans passer par « chèques à
encaisser » tant qu'il n'est pas remis (À VÉRIFIER avec un comptable) ; l'avoir ne rend pas le timbre (À VÉRIFIER).

Le rouge GitHub de la 1.307.0, réparé ici : sur une machine lente, la visite « Confier mon dossier à mon comptable »
finissait sur « Ce n'est pas encore fait ». « Suivant », cliqué avant que le panneau du cabinet ait fini de se charger,
faisait sauter les étapes qui le décrivent. Désormais la première étape attend que le panneau soit dessiné, et un
« Suivant » cliqué pendant qu'une étape prépare son écran se garde et se joue juste après (pour toutes les visites, de
l'entreprise et du Cabinet). Le test le rejoue en ralentissant exprès la lecture du mandat.

## Les clients

### Fait en 1.309.0 (07/11/2026) : qui ils sont, ce qu'ils doivent, et le même chiffre chez le comptable

Joué par une quincaillerie de Sousse (Mourad) et sa comptable au Cabinet Sahel Conseil (Sonia), avec cinq clients :
Bâtir Plus SARL, une entreprise du bâtiment (retenue de 1,5 %, encours autorisé de 6 000 DT, deux factures en retard et
une à venir, puis un avoir de 5 m² de carrelage cassé) ; Karim Trabelsi, un particulier sans matricule ni e-mail ; le
Café Boujaafar, qui paie 520 DT une facture de 500,800 DT ; Atelier Provence SARL, à Marseille, facturé en euros ;
l'Hôtel Marhaba, qui ne commande plus et doit encore une facture du printemps. Mourad crée aussi deux fiches : une
« Bâtir Plus » (le matricule de la même société) et Nadia Gharbi, une particulière, avec son CIN.

| # | Trouvé | Fait |
|---|---|---|
| K1 | La fiche disait « te doit 7 567,822 DT » ; la balance auxiliaire de la comptable, 7 683,022 DT pour le même client. L'écart (115,200 DT) est la retenue que le client gardera en payant : son 411 est débité du brut. Rien ne le disait (seul l'onglet Paiements en parlait, et seulement après un paiement). | Sous l'en-tête : « En payant, il gardera aussi 115,200 DT de retenue à la source pour l'État : son compte chez ton comptable porte 7 683,022 DT. » Le test lit ce chiffre sur la fiche et dans la balance du Cabinet : le même. |
| K2 | Au Cabinet, « Ce qui reste dû, par ancienneté » rangeait les factures selon leur date, pas leur échéance : la peinture à 30 jours, émise il y a 5 jours, tombait dans « 1 à 30 jours » ; la colonne « Pas encore échu » ne tenait que ce qui était daté du jour. | L'écriture d'une vente porte l'échéance de sa facture (migration 0195 : le serveur la donne à qui lit les livres, rien d'autre de la vente) ; le pont et le livre la gardent ; la balance âgée range selon elle. La peinture est « pas encore échue », l'hôtel « plus de 90 jours ». |
| K3 | L'avoir de carrelage, avant l'émission : « Encours : 1 948,770 DT au-delà de ce qui est permis pour ce client », comme si l'avoir s'ajoutait à ce qu'il doit. | Un avoir diminue l'encours : il ne le dépasse jamais (le moteur, pour toutes les pièces). |
| K4 | Archiver l'Hôtel Marhaba, qui doit 1 064,860 DT depuis 170 jours, ne disait rien de cet argent. | Le toast le dit : « Il te doit encore 1 064,860 DT : ses factures restent dans les relances. » (Annuler reste offert ; la page Relances le garde.) |
| K5 | Le matricule de Bâtir Plus tapé sans sa fin (« 1456789K ») disait seulement que la forme était fausse ; celui d'un autre de ses établissements (« 1456789K/B/M/001 ») ne disait rien. | « Même société que « Bâtir Plus SARL » (1456789K/A/M/000) : un autre de ses établissements ? Sinon, ouvrir sa fiche. » Sans bloquer : un second établissement a sa fiche. |
| K6 | Chercher Karim par le numéro de sa carte, « 98 765 », sortait aussi le café : « 98 » et « 765 » sont dans son matricule (0987654L). | Un numéro tapé avec ses espaces se cherche d'un bloc, dans le téléphone. |
| K7 | Atelier Provence « te doit 2 848,505 DT » : le client doit des euros. | « te doit 850,30 EUR, soit 2 848,505 DT ». |

Vérifié en jouant, sans rien à changer : la liste (filtre « En retard », recherche par matricule, le total de la
sélection) ; le relevé de compte de Bâtir Plus (ses trois factures, « dont 5 475,120 DT échu ») ; le bandeau du
plafond (« une nouvelle facture le dira avant l'émission ; tu émets quand même si tu veux ») ; le paiement de trop du
café, annoncé avant (« Enregistrer · un trop-perçu », puis « Enregistrer quand même ? ») et dit ensuite partout (la
liste « 19,200 en sa faveur », la fiche et son bandeau, le 411 créditeur de 19,200 DT au Cabinet) ; « Supprimer »
refusé pour un client qui a des pièces (« archive-le plutôt ») ; un CIN de 8 chiffres accepté sans remarque.

Limites connues : une facture à l'export en euros porte le timbre converti (0,30 €) : la mention d'exonération et le
timbre à l'export sont À VÉRIFIER avec un comptable (déjà dit sur la fiche). La retenue d'un avoir sur une facture qui en
porte (2,901 DT ici) suit celle de la facture (À VÉRIFIER). La balance âgée range une écriture saisie au Cabinet (sans
échéance) selon sa date.

Les deux preuves restées vertes la nuit 53 (06/11/2026), réparées ici : « les listes de filtre d'une page sans nom »
visait la Comptabilité, qui nomme ses listes Année et Mois elle-même depuis la 1.302 ; le seul endroit qui dépend
encore de `nommerFiltres` (telephone.js) est la liste des statuts des autres pièces, et le test de cette page le lit
désormais. « Des repères d'axe jamais éclaircis » dépendait de l'heure : certaines nuits, les étiquettes sous les
graphiques de la console sont assez courtes pour tenir toutes au téléphone. Le test resserre aussi chaque axe à 90
pixels, où elles ne tiennent jamais toutes. Les deux sont prouvées.

Le rouge GitHub de 1.308.0 (Node 22), réparé ici : dans la recette d'une entreprise neuve, « Enregistrer un paiement »
restait couvert par une fenêtre. Ce qui est coché « juste après l'émission » (signer par DigiGo, l'envoyer par e-mail)
s'ouvre 400 ms après l'émission ; plus rapide que ça sur cette machine, le test passait. Rejoué ici avec 800 ms
d'attente : la même panne. Le test décoche ces gestes avant d'émettre, comme celui de la charte de la facture, et garde
les 800 ms ; la recette alpha, qui clique « Corriger par un avoir… » juste après l'émission, fait de même.

## Les achats

### Fait en 1.310.0 (07/11/2026) : ce qu'on doit, ce qu'on garde pour l'État, et ce que lit la comptable

Joué par la même quincaillerie de Sousse et sa comptable, côté fournisseurs. Céramique du Sahel SARL (retenue de 1,5 %,
paie à 60 jours) : le carrelage, échu depuis 15 jours, payé en partie par un chèque de 3 000 DT ; la faïence, à payer
dans 40 jours ; un avoir de 20 m² cassés au déchargement. Ferramenta Milano, à Milan, facture en euros. La STEG, payée
par virement. Transport Ben Salah, à payer dans le mois. Mourad règle le reste du carrelage par virement, rattache
l'avoir, puis tape par erreur le numéro du carrelage sur la facture de faïence. Sonia ouvre la balance auxiliaire et
la balance âgée des fournisseurs.

| # | Trouvé | Fait |
|---|---|---|
| A1 | « À payer » disait « dont 4 660,000 DT en retard » ; la puce « En retard » disait 0, son filtre ne montrait rien, la liste des fournisseurs ne trouvait pas Céramique en retard, et sa fiche ne le disait pas. Le carrelage, payé en partie, a le statut « partiel » : seul « À payer » le comptait en retard. | En retard n'est pas un statut de plus, c'est un fait : échue et pas soldée, même payée en partie. Une règle (`achatEnRetard`, dans le moteur), lue par « À payer », la puce, le filtre, la liste et la fiche du fournisseur. La fiche dit « dont 4 660,000 DT en retard », le badge « En retard », et son bouton principal devient « Régler CS-26-1104 ». |
| A2 | La fiche disait « tu lui dois 6 785,108 DT », la balance auxiliaire de la comptable 6 888,435 DT : l'écart est la retenue qu'on gardera pour l'État en le payant (son 401 est crédité du brut). | Sous l'en-tête : « En le payant, tu garderas aussi 103,327 DT de retenue à la source pour l'État : son compte chez ton comptable porte 6 888,435 DT. » Après le virement, 2 157,470 DT : le test lit le même chiffre dans la balance du Cabinet. |
| A3 | Sur la pièce en retard, « tu lui dois 7 117,999 DT » ; sur la fiche, 6 785,108 DT : la pièce oubliait l'avoir de casse. | La pièce lit ce que dit la fiche (le même calcul). |
| A4 | « Tu paies 4 660,000 DT et tu retiens 116,650 DT » : le premier chèque avait déjà gardé 45,685 DT ; la fenêtre du règlement, elle, comptait juste. | La phrase dit la retenue qui reste à garder : 70,965 DT, comme la fenêtre. |
| A5 | L'avoir, libre, disait « L'avoir ne trouve plus rien à déduire » alors que la faïence de Céramique est à payer. | « Il n'est déduit d'aucune facture : CS-26-1187 est à payer. Choisis-la dans « Facture concernée » pour l'en déduire, ou enregistre le remboursement quand il te rend l'argent. » (et, s'il n'y en a aucune, il le dit). |
| A6 | Au Cabinet, la balance âgée des fournisseurs rangeait selon la date de la pièce : la faïence à 60 jours, reçue il y a 20 jours, tombait dans « 1 à 30 jours ». | L'écriture d'un achat porte son échéance (migration 0196, la pendante de 0195 : seule la date d'échéance sort, pour qui lit les livres) ; la faïence est « pas encore échue ». |
| A7 | Ferramenta Milano : « tu lui dois 4 225,000 DT », et deux bandeaux lui demandaient un matricule fiscal tunisien et un RIB à 20 chiffres. | « tu lui dois 1 250,00 EUR, soit 4 225,000 DT » ; pour un fournisseur à l'étranger, ni matricule ni RIB ne se disent « à renseigner » : « à l'étranger, il se paie sur son IBAN : note-le dans ses notes internes » (décidé par délégation le 07/11/2026). La STEG, tunisienne, garde la demande de son matricule. |

Vérifié en jouant, sans rien à changer : la fenêtre du règlement dit avant d'enregistrer « Ce règlement retient
70,965 DT (1,5 %) » ; après le virement, « 1 attestation de retenue à lui remettre — CS-26-1104 · 116,650 DT
retenus » ; l'avoir rattaché à la faïence dit « Il retire 53,960 DT de TVA de celle que tu récupères », la faïence
reste à payer 2 125,108 DT, et la fiche ne dit plus l'avoir « à toi » ; le même numéro sur une autre facture pose la
question avant d'enregistrer (« Cette facture est déjà saisie … celle du …, de 7 776,650 DT TTC, réglée le … ») ; la
balance auxiliaire du Cabinet porte Milan en dinars, au taux de sa facture.

Limites connues : la retenue d'un avoir suit celle de sa facture (À VÉRIFIER avec un comptable) ; la retenue sur un
fournisseur à l'étranger (non-résident) n'est pas calculée à part (À VÉRIFIER) ; la fiche n'a pas de champ IBAN (il va
dans les notes internes) ; le prélèvement n'est pas un mode de règlement (la STEG se note en virement).

## Les fournisseurs

### Fait en 1.311.0 (07/11/2026) : un seul compte par fournisseur, sa devise, et ceux qu'on ne prend plus

Joué par la même quincaillerie de Sousse. Mourad crée un « Céramique Sahel Gros » en tapant le matricule de Céramique du
Sahel SARL, puis le dépôt de Sfax du même grossiste (un autre établissement). Ferramenta Milano, importé sans devise,
devient un fournisseur en euros. Le transporteur Ben Salah, qu'on ne prend plus depuis l'été, s'archive ; Céramique, à
qui on doit la faïence, s'archive par erreur, puis « Annuler ». Sonia ouvre la balance auxiliaire des fournisseurs.

| # | Trouvé | Fait |
|---|---|---|
| R1 | La fiche d'un fournisseur ne relisait pas son matricule : le même que Céramique s'enregistrait, et son compte se coupait en deux (ce qu'on lui doit, ses retenues, ses attestations). Le client le faisait depuis la 1.201. | La même règle que le client : « Déjà la fiche de « Céramique du Sahel SARL » · ouvrir sa fiche » pendant la frappe, et l'enregistrement refusé en le disant ; le dépôt de Sfax (« Même société que… : un autre de ses établissements ? ») et une forme fausse se disent sans bloquer. |
| R2 | La devise d'un fournisseur ne se réglait nulle part (seulement par un import) : Milan restait « tunisien », sa fiche lui demandait un matricule fiscal et un RIB, chaque achat chez lui partait en dinars. | « Devise de ses factures » sur sa fiche ; un achat neuf chez lui, ou choisi pour une pièce en dinars encore sans règlement, prend l'euro, le taux à saisir. La fiche dit « tu lui dois 1 250,00 EUR, soit 4 225,000 DT ». |
| R3 | Sur un achat chez Milan, « Avant d'enregistrer » disait « Le fournisseur n'a pas de matricule » et sa carte « sans matricule ». | « Fournisseur à l'étranger : pas de matricule tunisien », coché ; la carte dit « à l'étranger ». |
| R4 | Un fournisseur ne pouvait ni s'archiver ni se supprimer s'il avait une pièce : le transporteur qu'on ne prend plus encombrait la liste et chaque choix d'un achat. | « Archiver » (menu ⋯ de la liste et de la fiche), comme un client : il sort de la liste, de ses compteurs et des choix d'un achat ou d'une commande (celui qu'une pièce porte déjà y reste) ; « Archivés » le montre ; sa fiche le dit, avec « Le remettre dans la liste ». « Supprimer » le propose (« archive-le plutôt »). |
| R5 | Archiver un fournisseur qu'on paie encore ne devait pas faire oublier la dette. | Le toast le dit (« Tu lui dois encore 2 457,999 DT : ses pièces restent dans « À payer » »), la fiche aussi ; « Annuler » le remet. |

Vérifié en jouant : le transporteur archivé garde sa pièce (elle s'ouvre, sa carte le nomme) ; au Cabinet, rien ne
change : son compte reste dans la balance auxiliaire, Milan y est en dinars au taux de sa facture. L'archivage ne part
pas chez la comptable : il ne range que la liste de l'entreprise.

Limites connues : la retenue d'un fournisseur à l'étranger (non-résident) reste À VÉRIFIER avec un comptable ; la fiche
n'a toujours pas de champ IBAN (il va dans les notes internes).

Le rouge GitHub de 1.309.0, réparé ici : le contrôle des frontières refuse qu'un vieux fichier hors de `modules/`
grandisse, et les trois lignes de l'échéance portaient le pont du Cabinet (`pont-cabinet.js`) à 2 800 lignes pour 2 797
permises. L'échéance tient sur la ligne voisine : le fichier ne grandit plus, la preuve du pont tombe toujours. La brique
locale ne jouait pas ce contrôle quand un écran change : elle le joue désormais, avec la barre et le rendu.

## L'accueil

### Fait en 1.312.0 (07/11/2026) : chaque chiffre du matin est celui de la page qu'il ouvre

Joué par la même quincaillerie de Sousse, un lundi matin. On lui doit : Bâtir Plus, en retard sur son ciment et payé en
partie (1 500 DT par virement), sa peinture du mois (il rend quatre seaux : un avoir), le café, l'atelier de Marseille en
euros, l'hôtel qui ne paie plus depuis le printemps. Elle doit : la faïence de Céramique (et un avoir de Céramique pour la
faïence cassée, déduit d'aucune facture), Milan en euros, le transporteur en retard et payé en partie. Un devis attend sa
réponse, un autre a expiré, un troisième est accepté. Mourad clique chaque carte et compare ; puis il archive le
transporteur ; Sonia ouvre la fiche du dossier et la balance auxiliaire.

| # | Trouvé | Fait |
|---|---|---|
| H1 | L'accueil, les Relances et les Clients disaient « 2 factures en retard, 1 800,916 DT » ; la page Factures, qu'ouvre la carte, disait « En retard · 1 facture, 1 064,860 DT », rangeait les 736,056 DT de Bâtir Plus « à échoir » et sa tranche « 1 à 30 j » vide : elle ne comptait que le statut « En retard », pas une facture échue payée en partie. | Une règle au moteur (`factureEnRetard`, celle des Relances) que la tuile, son filtre, ses âges, la puce du téléphone, « Relancer » et le menu ⋯ lisent tous : la facture payée en partie et échue est en retard, et se relance d'un clic. |
| H2 | « Tu dois · 3 achats » ouvrait la liste des achats filtrée sur le statut « À payer » : deux achats (le transporteur, payé en partie, n'y était pas). | Un choix « Tout ce qui reste à payer » (la liste du bloc « À payer ») : la carte l'ouvre, il montre les trois. |
| H3 | L'accueil disait « Tu dois 7 105,249 DT », la liste des fournisseurs « 6 832,138 » : l'avoir de Céramique (273,111 DT) était déduit d'un côté seulement. | Le chiffre du compte du fournisseur, partout (`detteFournisseurs`) : « 6 832,138 DT · 3 achats, avoir déduit ». Le bloc « À payer » le dit (« Céramique te doit déjà 273,111 DT … tu dois en fait 6 832,138 DT ») avec « Rattacher l'avoir », qui ouvre l'avoir. Le crédit d'un fournisseur ne diminue plus ce qu'on doit à un autre dans le total de la liste. |
| H4 | Un fournisseur archivé qu'on paie encore sortait du total de la liste des fournisseurs, pas de « Tu dois » : les deux chiffres divergeaient sans le dire. | Sous le total : « Et 422,250 DT que tu dois encore à « Transport Ben Salah », archivé : ses pièces restent dans « À payer ». » |
| H5 | La carte des devis disait d'un devis expiré « à refaire », « À faire » disait « relance ou classe-le en refusé ». | « + 1 expiré sans réponse » : le fait, le geste est dans la page. |

Vérifié en jouant : « Facturé en novembre » (2 107,400 DT HT, l'avoir déduit) est le chiffre du journal des ventes du mois
et celui de la barre du mois dans la fiche du dossier au Cabinet ; le chiffre de l'année du graphique est celui de la
tuile « Chiffre d'affaires » du Cabinet ; « Devis en attente » ouvre le seul devis du café, l'expiré ouvre le sien ; le
compte de Céramique dans la balance auxiliaire (2 218,160 DT, l'avoir déduit, la retenue à opérer comprise) est celui
que sa fiche annonce. Au téléphone, les quatre chiffres tiennent dans leur carte.

Limites connues : une dépense sans fournisseur qui reste à payer compte dans « Tu dois » mais dans aucune ligne de la
liste des fournisseurs (elle n'a pas de fournisseur) ; « Tu dois » ne dit pas la retenue que les règlements garderont pour
l'État (la fiche de chaque fournisseur la dit).

Suivant : la caisse.

## La caisse, vue de partout (seconde passe)

### Fait en 1.313.0 (07/11/2026) : le tiroir compté est la caisse de la Trésorerie, du livre et du comptable

Joué par une épicerie de Sfax, un samedi. Nour ouvre la caisse avec 50 DT de monnaie apportée de chez elle (la Trésorerie
n'a rien pour la caisse) ; elle vend deux pains et une huile en espèces (un billet de 20, 2,557 DT rendus), trois laits par
carte, deux huiles par chèque ; une cliente rapporte un pain ; le soir, le tiroir compté billet par billet donne 66 DT pour
66,159 attendus. Elle rouvre pour une course tardive en gardant 6 DT pour elle. Puis elle regarde l'accueil, la
comptabilité, la Trésorerie, les factures ; Sonia ouvre la fiche du dossier et la balance.

| # | Trouvé | Fait |
|---|---|---|
| K1 | Le fond tapé à l'ouverture (50 DT) n'entrait nulle part : le Z comptait un tiroir de 66 DT, la Trésorerie, le livre et le Cabinet gardaient 16 DT pour la caisse. | Sous le champ, avant le geste : « Ta caisse, dans la Trésorerie, a 0,000 DT : les 50,000 DT de plus y entrent à l'ouverture », et d'où ils viennent (apportés par le gérant, retirés d'une banque). L'ouverture le note dans la Trésorerie (un apport, un virement). Le soir, la caisse de la Trésorerie et le 54 du Cabinet valent le tiroir compté. |
| K2 | Un fond plus petit que la caisse de la Trésorerie (le gérant garde 6 DT) restait sans trace. | La même phrase (« les 6,000 DT qui manquent en sortent ») et où ils sont allés : versés à une banque, pris par le gérant, un manque. |
| K3 | Le retour d'un pain (l'avoir du ticket) se nommait « — » dans les dernières pièces de l'accueil, la liste des factures et le journal des ventes. | Il se nomme comme son ticket : « Vente au comptoir ». |

Vérifié en jouant : le bilan du jour, le Z, l'accueil (« Facturé en novembre 45,751 DT HT · 54,300 TTC »), le journal des
ventes et la barre du mois au Cabinet disent les mêmes chiffres, le retour déduit ; la carte et le chèque vont à la banque
(38,141 DT), le manque du Z (0,159 DT) sort de la caisse ; l'huile vendue sans stock monte dans « À faire » (stock négatif).

Limites connues : les ventes d'une épicerie vont, par défaut, au compte 706 (prestations de services) et non au 707 (ventes
de marchandises) : le compte se règle dans le plan comptable du dossier, À VÉRIFIER avec un comptable (une règle par
article, bien ou service, serait plus juste) ; le manque du Z va au 658, À VÉRIFIER aussi ; la caisse vend un article suivi
en stock qui n'en a plus sans le dire au comptoir.

Suivant : les immobilisations (le stock a été joué en 1.284).

## Les immobilisations

### Fait en 1.314.0 (07/11/2026) : un seul registre pour l'entreprise et son comptable

Joué par l'épicerie de Sfax sur l'exercice passé. Nour crée la fiche de la vitrine réfrigérée achetée en mars (une ligne
d'achat marquée « immobilisation », posée le 15/03, cinq jours après la facture), garde l'utilitaire de l'an d'avant, revend
la vieille balance 120 DT fin septembre à l'épicerie voisine et lui en émet la facture. Sonia, sa comptable, ouvre les
immobilisations du dossier, reprend les fiches, passe les écritures d'inventaire ; Nour change ensuite deux fois d'avis sur
la durée de la vitrine (7 ans, puis 6).

| # | Trouvé | Fait |
|---|---|---|
| I1 | Deux registres pour une entreprise (« à réunir », 29/09/2026) : le Cabinet ne voyait aucune des fiches que le client tient dans son SkanFact ; il recréait chaque bien de mémoire (« Aucun bien sur cet exercice »), avec le risque de deux plans d'amortissement pour un seul bien. | Le Cabinet LIT les biens du client (règle de la base 0197, sous un mandat qui comprend la comptabilité ; jamais il ne les écrit) : « Les biens tenus par … dans son SkanFact », avec le plan que le client voit (le même moteur), et pour chacun « Reprendre sa fiche… » (le formulaire s'ouvre avec sa durée, sa mise en service, sa valeur, sa sortie ; rien ne s'enregistre sans « Ajouter »). La ligne de l'achat au compte 22 dont le client a déjà la fiche dit « Reprendre la fiche du client… ». |
| I2 | Un plan qui diverge ne se voyait d'aucun côté. | « même plan », ou « plan différent » et ce qui diffère (« 5 ans ici, 7 ans chez le client »), avec « Reprendre son plan… » (le nom que le comptable a donné au bien reste le sien : il se reconnaît par l'achat d'où il est né). Une dotation déjà passée le dit avant le geste (« retire-la d'abord de la Saisie ») ; le refus de la v10 reste. |
| I3 | La facture qui revend un bien (née de sa fiche) s'écrivait en ventes (706), chez l'entreprise comme chez le comptable. | Aux produits des cessions d'immobilisations (775), des deux côtés (le journal de l'entreprise et les écritures du serveur, base 0197) ; la carte « Facturé » de l'accueil dit « dont 120,000 de revente d'un bien ». |
| I4 | La fiche d'un bien montrait le plan de l'ancienne date de mise en service (727,500 DT au lieu de 715,000) tant qu'on ne tapait rien d'autre ; la fenêtre de sortie, la valeur nette de l'ancienne date de sortie. | L'aperçu suit la date validée en quittant son champ. |

Vérifié en jouant : le tableau de l'exercice de l'entreprise (66 500,000 DT, dotation 13 212,500 DT, cumul 25 032,778 DT,
VNC 41 467,222 DT) est celui du Cabinet au millime, puis 13 008,214 DT des deux côtés quand la vitrine passe à 7 ans ; la
sortie de la balance (VNC 86,667 DT, plus-value 33,333 DT) et sa facture se retrouvent dans « Sorties et cessions » ; les
écritures d'inventaire passent (quatre : trois dotations et la sortie) ; la balance du Cabinet et le journal de l'entreprise
portent 120,000 DT au 775, rien au 706.

Limites connues : les comptes 775 et 675 sont ceux du plan par défaut, À VÉRIFIER avec un comptable (le plan du dossier les
règle) ; la TVA sur la revente d'un bien d'occasion reste à confirmer (À VÉRIFIER) ; le livre du Cabinet ne porte la valeur
d'un bien acheté avant SkanFact qu'avec sa balance d'ouverture (reprise ou FEC), pas depuis la fiche du client ;
l'entreprise ne voit pas encore le plan que son cabinet a retenu quand il diffère du sien ; « Passer les écritures
d'inventaire (3) » compte les biens, le message compte les écritures (quatre : la balance a une dotation et une sortie).

Suivant : les récurrentes (facturation récurrente).

## La facturation récurrente

### Fait en 1.315.0 (07/11/2026) : la facture du mois, même rattrapée, et le comptable qui sait quel mois elle couvre

Joué par une société de maintenance informatique de Tunis (« Tunis Réseaux SARL ») : la maintenance mensuelle de la
clinique, en retard de trois mois (450 DT, retenue 1,5 %) ; l'hébergement trimestriel d'une société de logistique ;
le support à distance d'un atelier de Lyon en euros (120 € au taux de 3,35 noté au contrat) ; l'entretien d'une école,
contrat fini fin septembre ; la caisse et le wifi d'un café, suspendus depuis septembre puis repris. Hédi génère les
brouillons, émet celui d'août depuis la fiche du contrat ; Sonia, sa comptable, lit le journal des ventes.

| # | Trouvé | Fait |
|---|---|---|
| R1 | « À générer » disait 1 (les contrats), la phrase « 1 brouillon à préparer », la fenêtre « Générer 2 brouillons » : le bouton en prépare cinq (quatre mois de la clinique, un de l'atelier). | Un seul calcul (`periodesDues`) pour la tuile, le bandeau et la fenêtre : « 5 brouillons à préparer — voir les 2 contrats ». |
| R2 | Les mois rattrapés partaient datés dans leur mois (le 01/08 pour la facture d'août, émise le 07/11) : une facture numérotée en novembre avant celles de septembre, et dans un mois de TVA peut-être déjà déclaré. | Une période rattrapée part datée du jour où elle part (échéance comptée de ce jour) ; son objet dit le mois qu'elle couvre, son identifiant sa période (`periode`) ; pareil au serveur pour les contrats émis seuls. |
| R3 | Le comptable perdait ce mois : « Facture FAC-2026-001 — Clinique Les Oliviers » en novembre, rien de l'août qu'elle facture. | Le livre le dit, au Cabinet comme chez l'entreprise : « … · période d'août 2026 » (base 0198, `docs/ecritures.md` D4 bis), seulement quand le mois diffère. |
| R4 | La fiche d'un contrat prenait le nom de sa prochaine facture (« — décembre 2026 »), même terminé en septembre ou suspendu ; la liste montrait le gabarit brut (« — {mois} ») et « trimestre de » sans mois. | Le contrat se nomme par son objet (« Hébergement des serveurs — trimestre ») ; sous le titre, la prochaine facture seulement s'il y en aura une. |
| R5 | Les factures d'un contrat dans le désordre ; « Émettre la facture » ne disait pas laquelle. | Les brouillons d'abord, puis par numéro et période ; « Émettre la facture d'août 2026 », le plus ancien d'abord, « (et 2 autres) ». |
| R6 | Le brouillon en euros reprend le taux noté au contrat, sans le dire. | « Avant d'émettre » : « Le taux est celui du contrat (1 EUR = 3,35 DT) : vérifie celui du jour » (sans bloquer). |

Vérifié en jouant : cinq brouillons, tous datés du jour, août à novembre pour la clinique ; la facture d'août émise
(FAC-2026-001, 528,467 DT net, échéance à 30 jours du jour) ; la fiche passe au brouillon de septembre ; le café repris
repart en décembre (les mois de pause ne se facturent pas, « Générer maintenant » reste là) ; le journal du Cabinet et
celui de l'entreprise portent le même libellé et les mêmes montants (536,500 DT au 411, 450,000 DT au 706).

Limites connues : un contrat émis seul en devise part au serveur au taux du contrat, sans personne pour le relire ; la
période d'un contrat trimestriel ou annuel se dit par son premier mois ; les produits facturés d'avance sur un autre
exercice (un an d'hébergement facturé en octobre) restent au comptable (À VÉRIFIER : produits constatés d'avance).

Suivant : proforma, bons et contrats.

## Proforma, bons et contrats

### Fait en 1.316.0 (07/11/2026) : le stock sort une fois, au bon ; ce qu'on ajoute sur la facture sort aussi

Joué par un négoce de matériaux de Sousse (« Matériaux du Sahel SARL ») : la commande d'un chantier (100 sacs de ciment,
2,5 t de fer, un transport) livrée en deux bons, puis les deux bons facturés en une facture où Lotfi ajoute les 10 sacs de
plâtre que le chef de chantier a pris au comptoir ; une proforma pour le dossier de crédit d'un particulier, puis sa
facture ; un contrat d'approvisionnement envoyé à un hôtel. Amira, sa comptable, lit le journal des ventes.

| # | Trouvé | Fait |
|---|---|---|
| A1 | La facture des bons criait au manque : « stock : 0, il en manque 100 » sur la ligne, « Stock : il manque 100 » avant d'émettre, « le stock passerait à -100 » dans la fenêtre d'émission — alors que les bons avaient déjà sorti le ciment. La marque prévue pour le dire (`fromBon`) n'était posée nulle part. | Chaque ligne venue d'un bon porte son bon (« BL-2026-001, BL-2026-002 · déjà sorti du stock » ; « livré avec BL-2026-001 » pour un transport) ; ni la ligne, ni « Avant d'émettre », ni la fenêtre d'émission ne comptent ce qui est parti avec un bon. |
| A2 | Les 10 sacs de plâtre ajoutés sur la facture des bons ne sortaient jamais du stock (30 avant, 30 après) : toute la facture était laissée au bon. | Ligne par ligne (`sortieAuBon`) : seules les lignes d'un bon ne ressortent pas ; le plâtre passe à 20. Une facture d'avant 1.316 (lignes sans marque) reste entière au bon, comme avant ; une copie (« Dupliquer ») ou un avoir ne reprend pas la marque. |
| A3 | Au rechargement d'une page après celle du stock, « Modifications des deux côtés : 3 pièces modifiées » (les trois articles, dits « prestation ») : la page avait complété les fiches (seuil, série, garantie) et le serveur les rendait dans un autre ordre de champs ; la fusion comparait le texte. | La fusion compare le contenu, quel que soit l'ordre des champs : deux fiches identiques ne sont jamais en conflit ; un vrai conflit sur un article se dit « article du catalogue ». |

Vérifié en jouant : 100 → 40 → 0 sacs de ciment et 3 → 1,75 → 0,5 t de fer aux deux bons, rien de plus à la facture ;
le plâtre 30 → 20 ; la facture des bons au serveur (9 367,341 DT) et au journal du Cabinet (7 870,875 DT au 706) ; la
facture de la proforma reprend ses 150 sacs et 40 sacs, et la proforma dit « Facturée en brouillon ».

Limites connues : une ligne d'un bon dont on augmente la quantité sur la facture ne sort pas la différence (elle reste
« partie avec le bon ») ; le contrôle « le client n'a pas de matricule (obligatoire pour une entreprise) » vaut aussi pour
un particulier tant que sa fiche ne dit pas qu'il en est un ; la proforma et le contrat ne réservent pas le stock.

Suivant : les listes de prix.

## Les listes de prix

### Fait en 1.317.0 (07/11/2026) : chacun son prix, au comptoir comme sur la facture

Joué par une droguerie de l'Ariana (« Droguerie El Amen ») : la liste des artisans (une catégorie, « Artisans 2026 » : le
pot de peinture à 78 DT au lieu de 89, le silicone à 10,900), une hausse à venir, la liste de l'hôtel des Jasmins à son
nom pour la saison (le pot à 74) et sa liste du printemps terminée ; les vis en boîte à 4,900, 4,200 dès 10, 3,900 dès 50.
Hédi facture le plombier (rangé en « artisans », en minuscules), commence une facture pour une particulière puis
s'aperçoit qu'elle est pour l'hôtel, facture le devis que l'hôtel avait accepté avant sa liste, puis tient le comptoir :
le plombier y prend deux pots et douze boîtes de vis, un passant un pot. Inès, sa comptable, lit les ventes.

| # | Trouvé | Fait |
|---|---|---|
| L1 | À la caisse, la liste du client et les paliers ne comptaient pas : le plombier payait 89 DT le pot que sa liste met à 78, et les douze boîtes de vis 4,900 au lieu de 4,200 ; la tuile disait aussi le prix du catalogue. | Le panier prend le prix d'une facture au même client (`prixDuPanier`, la règle de `prixArticlePour`) à chaque dessin : le client choisi, la quantité changée, la vente reprise. La ligne dit d'où vient son prix (« prix « Artisans 2026 » », « prix par quantité ») ; la tuile dit le prix du client. |
| L2 | Dans la barre d'ajout de la facture, « prix du client (Artisans 2026) » s'affichait à côté de 89,000 (le prix du catalogue), et la ligne se posait à 78. | Le choix dit le prix que la ligne prendra, et le premier palier plus bas (« 4,200 DT dès 10 »). |
| L3 | Une facture commencée pour un client puis passée à un autre (« Changer ») gardait les prix de l'ancien : les pots restaient à 89 pour l'hôtel. | Les lignes du catalogue posées au prix de l'ancien client prennent celui du nouveau, et un message le dit ; un prix tapé à la main ne change pas ; dans une autre devise, rien ne se convertit tout seul (M-10, inchangé). |
| L4 | La fiche du plombier disait « aucune liste de prix pour elle : les prix du catalogue » (sa catégorie en minuscules, la liste en majuscule) ; celle de l'hôtel « ceux du catalogue », à côté de la liste à son nom ; le nom d'une liste ne s'affichait jamais. | La fiche lit la liste par la règle du moteur, à la date du jour : « la liste « Artisans 2026 » remplace les prix du catalogue », « une liste à son nom … jusqu'au 31/12/2026 », avec le lien vers la liste ; une liste à venir le dit. |
| L5 | La facture du devis accepté avant la liste de l'hôtel garde les prix du devis (89 DT) sans rien dire. | Le prix convenu reste ; « Avant d'émettre » dit « 2 lignes plus chères que sa liste « Hôtel Les Jasmins — saison » … » avec « Reprendre ses prix », qui les pose d'un geste si on le veut. |
| L6 | Le client d'une liste payait plus cher qu'un passant au-delà d'un palier (une liste à 4,600 la boîte, le palier de 10 à 4,200 pour tous). | Décidé par délégation : au-delà d'un palier plus bas que sa liste, c'est le palier (moteur, donc aussi la remise contrôlée par le serveur). |

Vérifié en jouant : la facture du plombier 78 / 4,200 / 10,900 (166,767 DT à payer) ; l'hôtel 74 après « Changer », le
pinceau tapé à 6 resté à 6 ; la facture du devis 89 puis 74 et 11 après « Reprendre ses prix » ; au comptoir 245,616 DT
pour le plombier (2 × 92,820 et 12 × 4,998), 105,910 pour le passant ; le ticket porte 78 et 4,2 au serveur ; au journal
du Cabinet, 139,300 au 706 pour la facture, 206,400 pour le ticket du plombier, 89,000 pour celui du passant.

Limites connues : une liste ne porte qu'un prix par article (pas de paliers propres à la liste) ; un brouillon dont on
change la date ne reprend pas les prix d'une liste qui commence ou finit entre les deux dates ; le Cabinet ne voit pas
les listes de prix (il n'en a pas besoin pour ses écritures).

Suivant : le catalogue.

## Le catalogue

*Joué le 07/11/2026 (1.318.0) par la Droguerie El Amen (Ariana) : la peinture qu'elle revend et compte en stock, les brosses
qu'elle revend sans les compter, la pose qu'elle facture à l'heure, le mastic qu'elle fait elle-même ; la facture de l'hôtel
avec 5 % de remise sur deux taux ; la peinture qu'elle ne veut plus vendre ; puis sa comptable au Cabinet.*

**Ce qui n'allait pas**
- Toute vente partait au 706 (prestations de services), même la peinture revendue : l'achat de la marchandise allait au 607,
  sa revente au 706, et la comptable devait reclasser chaque mois au 707 (ventes de marchandises), le mastic fabriqué au 701.
  Le chiffre d'affaires d'un commerce et sa marge commerciale (707 − 607) étaient faux dans les livres des deux côtés.
- « Supprimer » un article déjà vendu, ou encore en stock, l'effaçait : son stock disparaissait de l'inventaire (et de la
  valeur du stock de fin d'année), sa fiche des pièces qui le portaient.
- Le code-barres déjà pris par un autre article était déjà refusé (rien à changer).

**Ce qui change (1.318.0)**
- « Ce que tu vends » sur la fiche d'un article : une marchandise revendue telle quelle (707), une prestation (706), un
  produit que je fabrique (701), chaque choix avec le numéro du plan de l'entreprise. Proposé d'après « Suivi en stock » (et
  la FODEC) tant qu'on ne l'a pas choisi ; une fois choisi, il ne bouge plus.
- La nature se fige sur chaque ligne quand le serveur émet la facture ou l'avoir (celle que la ligne porte déjà, sinon celle
  de son article) ; le ticket la porte dès le panier, chaîné tel quel par le poste de caisse. La base de chaque taux se
  ventile (le reste d'arrondi à la plus grosse part) ; la FODEC garde son compte. Le moteur de l'entreprise et celui du
  serveur disent la même écriture ligne à ligne (test du moteur, et le Cabinet au millime de l'entreprise).
- Une pièce d'avant, sans nature sur ses lignes, ne change pas (tout au 706 ; ni ses montants, ni son empreinte).
- Un article qui a une histoire s'archive au lieu de s'effacer (« Il ne s'efface pas : archive-le »), avec « Annuler » ;
  archivé, il quitte la liste (« Archivés (n) » en haut), les propositions d'une pièce et les tuiles de la caisse ; son stock,
  sa valeur et ses pièces restent ; sa fiche le remet d'un geste.
- Les chiffres en tête du catalogue comptent ce que la liste montre (les articles en vente, ou les archivés quand on les
  regarde) : ils comptaient l'article archivé avec ceux qu'on vend (« 4 articles » au-dessus d'une liste de trois).

**À VÉRIFIER** avec un comptable : 701, 706, 707 ; un article suivi en stock qu'on fabrique sans FODEC (le pain d'une
boulangerie) se dit « produit fabriqué » sur sa fiche.

## Le stock, jusqu'au bilan

*Joué le 07/11/2026 (1.319.0) par la Droguerie El Amen (Ariana) à la clôture de 2025 : 40 pots de peinture à 61 puis 20 à 63,
23 sortis en juin ; le mastic qu'elle fait ; le vernis tout parti ; une casse de décembre oubliée ; puis sa comptable au Cabinet.
Le côté entreprise du stock (commandes, inventaire, fiche d'un article) a été joué en 1.284 : cette passe suit le stock jusqu'au
bilan.*

**Ce qui n'allait pas**
- Le serveur n'écrit jamais la variation de stock dans les livres d'un client SkanFact (le moteur de l'entreprise la calcule pour
  son propre journal, pas pour le livre du Cabinet). La comptable devait recopier l'inventaire, ligne à ligne, depuis un tableur :
  sans ce geste, le bilan d'un commerce n'avait pas de stock et son résultat comptait toute la marchandise achetée comme vendue.
- Recopié, l'inventaire ne valait pas la page Stock du client : le coût moyen s'arrondit à chaque sortie, et la quantité fois le
  coût moyen arrondi n'est pas la valeur du stock (37 pots : 2 281,679 au lieu de 2 281,659).
- Une ligne collée dont la référence est vide (une tabulation en tête) perdait cette case : avec une colonne de plus, les
  colonnes se décalaient.
- Les cartes posées dans l'onglet Inventaire collaient leur texte au bord.

**Ce qui change (1.319.0)**
- Stock › Inventaire : « L'état du stock pour ton comptable », quand un cabinet est relié. Le 31 décembre passé est proposé
  (s'il y avait du stock), la date se change ; la carte dit le nombre d'articles et la valeur au coût moyen, et « Envoyer l'état
  du … ». Envoyé, elle le dit (« c'est l'état d'aujourd'hui ») ; si le stock de cette date a changé depuis (une casse saisie en
  retard), elle le dit en orange avec « Renvoyer », qui remplace l'état chez la comptable. « Le dire à mon comptable » ouvre la
  conversation avec le résumé prêt ; « Prévenir mon comptable » après un inventaire envoie aussi l'état du jour compté.
- L'état (`etatsStock` du dossier, module Stock) : chaque article suivi qui a du stock ce jour-là, sa quantité, sa valeur au
  millime de la page Stock et son coût unitaire (la valeur divisée par la quantité) ; ni le prix de vente, ni le fournisseur.
  Le Cabinet le lit sous mandat comptable, jamais il ne l'écrit (base 0200).
- Au Cabinet, l'onglet Inventaire montre « L'état du stock envoyé par … » (date, articles, valeur, quand) ; « Le reprendre comme
  inventaire… » remplit la saisie (cinq colonnes : la dernière est la valeur), qu'elle relit puis enregistre ; ensuite « ✓
  L'inventaire de 2025 est celui que le client a envoyé », ou, s'il diffère, l'écart dit. La variation de stock s'écrit à ce
  millime (2 194,325 au 37 et au 603, le compte de stock étant à zéro).
- Une ligne d'inventaire peut dire sa valeur (cinquième colonne, collée aussi depuis un tableur) : elle doit rester la quantité
  fois le coût unitaire, à un demi-millime par unité près ; le Cabinet et la base refusent sinon, en le disant.

**À VÉRIFIER** avec un comptable : les comptes 37 / 603 pour un commerce, et l'inventaire au coût moyen pondéré.

## Les commandes fournisseurs, jusqu'au bilan

*1.320.0, 07/11/2026. Jouées par la droguerie de l'Ariana (« Droguerie El Amen ») à la clôture de 2025 : 30 pots de
peinture commandés au Grossiste Sfax et reçus le 28 décembre, dont la facture n'arrive que le 8 janvier ; 12 brosses de la
Quincaillerie du Nord reçues le 30, sans facture ; 10 pots reçus le 15 et facturés le 20. Puis sa comptable, au Cabinet.*

**Ce qui n'allait pas**
- Au 31 décembre, la marchandise reçue était dans le stock compté (la réception la fait entrer), mais sa charge n'était dans aucun
  livre de l'année : la facture du fournisseur arrive en janvier. Le bénéfice de 2025 était trop haut de 1 949,850, et rien ne
  le disait à la comptable, qui devait le chercher bon de réception par bon de réception. Ce qui reste à facturer
  aujourd'hui (`receptionsAFacturer`) ne le dit pas non plus : une fois la facture de janvier saisie, la réception de
  décembre n'y est plus, alors qu'au 31 décembre elle était reçue sans facture.

**Ce qui change (1.320.0)**
- `C.receptionsSansFactureAu(data, date)` : les réceptions validées ce jour-là ou avant, qu'aucune facture d'achat datée ce
  jour-là ou avant ne couvre, chacune à sa valeur hors taxes au prix de la commande, ramenée en dinars ; une réception en
  brouillon n'a rien reçu, une réception d'après la date n'y est pas. `C.etatDuStock` la porte (`sansFacture`).
- La carte « L'état du stock pour ton comptable » dit, sous le résumé : « Reçu sans facture à cette date : 2 réceptions,
  1 949,850 DT HT (BR-… de …). La marchandise est dans ton stock, sa facture n'est pas encore arrivée : ton comptable la passe
  en facture non parvenue. Elle part avec l'état. » Envoyé, l'état porte ces réceptions ; si seul ce qui est reçu sans facture
  a changé depuis (la facture des brosses arrive, datée du 31), la carte le dit tel quel, avec « Renvoyer ».
- Au Cabinet, l'onglet Inventaire montre sous l'état envoyé « Reçu sans facture au 31/12/2025 » (chaque réception, son
  fournisseur, sa valeur) et « Passer en factures non parvenues… » : la fenêtre montre l'écriture (607 au débit pour le total,
  408 au crédit, un par fournisseur), puis la pose au brouillard, au jour de l'état (pièce FNP-2025) ; elle se relit, son
  compte de charge se change, elle se valide, et « Extourner » la retourne au 1er janvier. Passée, la ligne le dit et le geste
  s'en va : la repasser compterait la charge deux fois.
- La preuve : `tests/moteur/commandes-1320.test.ts` (3 règles), `tests/web/commandes-1320.test.ts` (l'entreprise, le
  téléphone, le Cabinet, l'écriture lue au serveur au millime), preuves `commandes 1.320 a-n`.

**À VÉRIFIER** avec un comptable : 607 / 408 pour une marchandise reçue sans facture, et la TVA de ces factures (rien, ou un
compte de TVA à régulariser).

## Les relances, jusqu'au bilan

*1.321.0, 07/11/2026. Jouées par une société d'ascenseurs de Sousse (« Ascenseurs du Sahel », Nadia) : Bâtiments Ezzahra
doit encore 1 976 sur sa facture de maintenance de septembre (2 976, 1 000 versés), relancée deux fois, et la conteste
(« 8 cabines reçues sur 10 ») ; l'Hôtel Le Golfe doit sa facture de novembre (1 001,195). Puis sa comptable, Inès, au Cabinet.*

**Ce qui n'allait pas**
- Une facture que le client conteste se relançait comme les autres, au ton « Dernière relance » : on réclamait ce qu'on
  discute, et rien ne gardait ce que le client avait dit.
- À la clôture, la comptable ne savait rien de ce que l'entreprise sait de ses clients : ses livres disent qu'une facture
  est due, pas qu'elle est contestée ni combien de fois elle a été réclamée. Le jugement d'une provision pour créance
  douteuse se faisait au téléphone, ou pas du tout.
- La page Relances ne se redessinait pas quand elle apprenait qu'un cabinet est relié : ce qui dépend du cabinet n'y
  apparaissait qu'après un changement de page.

**Ce qui change (1.321.0)**
- `C.litigeDe(doc)` : un litige est ce que dit le client (une note vide n'en est pas un) et depuis quand.
  `C.overdueInvoices` le porte ; `C.aRelancer` écarte une facture contestée. Dans Relances, « Le client conteste… » (menu
  de la ligne) le note, champ obligatoire ; la facture se range dans « Contestées par le client » (ce que dit le client,
  depuis quand) ; « Le litige est réglé » la remet dans les relances, avec « Annuler ». La facture elle-même n'offre plus le
  paiement comme étape suivante d'une relance.
- La tuile « Plus de 45 jours » compte toujours la contestée (c'est un retard) mais ne lui promet plus de relance : « au
  ton « Dernière relance » · dont 1 contestée ».
- `C.etatDesImpayes(data, company, today)` : chaque facture en retard, ce qui en reste toutes taxes et hors taxes (au
  prorata de la facture : 1 976 × 2 500 / 2 976 = 1 659,946), son retard, ses relances (la dernière), le litige ; la
  contestée d'abord, puis la plus en retard. La carte « L'état des impayés pour ton comptable » l'envoie (un seul état, celui
  du jour ; le renvoyer le remplace) ; envoyé, elle dit « ✓ c'est l'état d'aujourd'hui », ou qu'un paiement, une relance ou
  un litige l'a changé depuis, avec « Renvoyer ».
- Au Cabinet, l'onglet Inventaire montre « Les impayés de … » (ce que dit le client sous son nom) et « Provisionner… » pour
  une facture contestée ou en retard de plus de 90 jours : la fenêtre propose le reste hors taxes, refuse plus (en le
  disant, le bouton éteint), montre l'écriture (6817 / 491 au dernier jour de l'exercice, pièce PROV-numéro) et la pose au
  brouillard. Passée, la ligne le dit et le geste s'en va : la reprovisionner compterait la charge deux fois.
- Le serveur rend au cabinet le dernier état envoyé (base 0201 : le cabinet du dossier le lit, rien d'autre), nettoyé
  champ par champ.
- La preuve : `tests/moteur/relances-1321.test.ts` (3 règles), `tests/web/relances-1321.test.ts` (l'entreprise, le
  téléphone, le Cabinet, l'écriture lue au serveur au millime), preuves `relances 1.321 a-z`.

**À VÉRIFIER** avec un comptable : les comptes 6817 / 491, la provision sur la base hors taxes, et le seuil de 90 jours (il
ne fait que proposer le geste ; la comptable juge).

## Les garanties, jusqu'au bilan

*1.322.0, 07/11/2026. Jouées par un installateur de climatisation de Sousse (« Clim et Froid Jlassi », Walid) à la clôture
de 2025 : deux climatiseurs garantis deux ans chez l'Hôtel Le Golfe et la Clinique Les Pins (le second remisé de 5 %), un
onduleur garanti un an livré le 20 décembre (remise globale de 5 %), un vieux climatiseur dont la garantie a fini en
novembre, un autre en stock ; la Clinique rend ensuite son climatiseur. Puis sa comptable, Inès, au Cabinet.*

**Ce qui n'allait pas**
- Les réparations que Walid fera gratuitement sur ce qu'il a déjà vendu sont une charge à venir : rien ne la disait à sa
  comptable. Elle ne savait ni combien d'appareils étaient encore garantis au 31 décembre, ni ce qu'ils avaient été vendus ;
  le jugement d'une provision pour garanties se faisait de mémoire, ou pas du tout.
- Un client appelle avec une panne : la recherche des Garanties trouvait l'appareil, mais sa fiche ne s'ouvrait pas d'ici
  (pour noter qu'il est rendu, changer son client ou sa garantie).

**Ce qui change (1.322.0)**
- `C.etatDesGaranties(data, date)` : par article, les appareils livrés ce jour-là ou avant dont la garantie court encore
  (un appareil rendu n'y est plus), leur valeur de vente hors taxes (la ligne de la pièce qui les a livrés, remise de la
  ligne et remise globale comprises, ramenée en dinars : 2 380,500 − 5 % = 2 261,475 ; 1 890,333 − 5 % = 1 795,816), la
  plus longue garantie ; et les appareils garantis vendus dans l'année. Ni client ni numéro de série.
- Sur la page Garanties, la carte « Le parc sous garantie pour ton comptable » propose le 31 décembre passé, dit « 3
  appareils sous garantie chez 2 clients, vendus 6 507,291 DT HT ; la plus longue garantie court jusqu'au 09/06/2027 », et
  l'envoie ; envoyé, elle dit « ✓ c'est l'état d'aujourd'hui », ou qu'un appareil livré ou rendu l'a changé, avec
  « Renvoyer » (qui remplace l'état de cette date). La date se change.
- Dans la recherche, « Ouvrir le numéro… » ouvre la fiche de l'appareil trouvé.
- Au Cabinet, l'onglet Inventaire montre « Les garanties en cours chez les clients de … » (par article : appareils, vendus
  HT, garantis jusqu'au) et « Provisionner les garanties… » : la case part vide (c'est la comptable qui juge), refuse plus
  que la valeur de vente (en le disant, le bouton éteint), montre l'écriture (6815 / 1512 au jour de l'état, pièce
  PROV-GAR-2025) et la pose au brouillard. Passée, la ligne le dit et le geste s'en va.
- Le serveur rend au cabinet le parc envoyé pour l'exercice, à la date la plus tardive (base 0202), nettoyé champ par champ ;
  le pont du Cabinet le porte sans grandir (une seule table pour ce que le client envoie : impayés et garanties).
- La preuve : `tests/moteur/garanties-1322.test.ts` (3 règles, dont une facture en euros arrondie au centime),
  `tests/web/garanties-1322.test.ts` (l'entreprise, le téléphone, le Cabinet, l'écriture lue au serveur au millime),
  preuves `garanties 1.322 a-ab`.

**À VÉRIFIER** avec un comptable : les comptes 6815 / 1512, et la provision sur la base hors taxes.

## Les statistiques, jusqu'au comptable

*1.323.0, 07/11/2026. Jouées par une boulangerie de Monastir (« Boulangerie El Amen », Amel) : elle livre l'Hôtel Les Dunes
(40 croissants rendus, un avoir) et le Restaurant La Marina (une remise de 3 %), vend au comptoir, revend son vieux four à la
boulangerie Jaziri depuis sa fiche (« Facturer la cession ») et achète un four neuf. Puis son comptable, Hichem, au Cabinet.*

**Ce qui n'allait pas**
- La revente du four (9 450,500 DT HT) comptait comme une vente : « Vendu HT » disait 10 355,549 DT quand le comptable, dans
  ses livres, lisait 905,049 DT de chiffre d'affaires (le prix d'un bien revendu va aux produits des cessions, 775, pas aux
  comptes 70). La boulangerie Jaziri devenait le meilleur client (« pèse 91 % du chiffre d'affaires »), le four « ce qui se
  vend le mieux », novembre un mois record, et la page Marges en faisait une vente sans coût connu (marge surestimée).
- Le four neuf (38 500,750 DT) gonflait « Acheté HT » sans que rien dise qu'il n'est pas une charge de l'année.
- Au Cabinet, chaque mois tiré des livres d'un client relié portait la mention « exemple », comme les paquets inventés du
  cabinet d'exemple, à côté d'un chiffre d'affaires bien réel.

**Ce qui change (1.323.0)**
- `C.ventesDuMetier` : les pièces émises sans la revente d'un bien (la facture née de sa fiche et l'avoir qui la corrige), la
  base de « Vendu HT », des factures et du comptoir, du mois par mois, de ce qui se vend le mieux, des meilleurs clients
  (Statistiques et Accueil), des nouveaux clients et de la page Marges. La règle même du serveur (`ventes.ts`) : deux chemins,
  un chiffre.
- `C.cessionsSur` dit la revente à part : par bien, ses pièces, son HT et sa TVA. La carte « Vendu HT » ajoute « hors revente
  d'un bien : 9 450,500 DT » ; l'onglet Ventes dit « Cette revente n'est pas une vente de ton métier : Four à sole 6 bouches
  (FAC-…), 9 450,500 DT HT. Ton comptable la passe à part, aux produits des cessions (775) » (le bien s'ouvre sur sa fiche) ;
  la TVA collectée garde celle de la revente et le dit (« dont 1 795,595 DT sur la revente d'un bien »). L'export aussi.
- L'onglet Achats dit « Dont 38 500,750 DT de matériel gardé dans l'entreprise : ton comptable le met au bilan et le déduit un
  peu chaque année (l'amortissement), ce n'est pas une charge de 2026 », avec le lien vers les immobilisations.
- Au Cabinet, le mois d'un client relié s'ouvre sur ses écritures (« Voir les écritures ») au lieu de se dire « exemple ».
  Le chiffre d'affaires que le comptable y lit est celui de la carte « Vendu HT ».
- La preuve : `tests/moteur/statistiques-1323.test.ts` (5 règles, dont le livre du comptable : 903,174 aux comptes 70,
  9 000,300 au 775), `tests/web/statistiques-1323.test.ts` (la revente facturée depuis la fiche du four, les Statistiques,
  l'export, le téléphone, le Cabinet et son journal), preuves `statistiques 1.323 a-x`.

**À VÉRIFIER** avec un comptable : la TVA sur la revente d'un bien dont la TVA n'a pas été déduite à l'achat.
