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

## Le jour d'un geste, entre minuit et une heure (1.323.1)

*08/11/2026. Le rouge GitHub de 1.322.0 : le test des relances a tourné à 23 h 30 en temps universel, déjà le 8 novembre
à Tunis ; la carte disait « Envoyé le 07/11/2026 ».*

- L'heure d'un geste (envoyer un état au comptable, proposer ou accepter une correction de bulletin, importer la pointeuse,
  poser une question, importer un relevé, demander une date, déposer une déclaration, noter une relance, commander une
  offre, supprimer un brouillon) est gardée en temps universel ; l'écran en coupait les dix premiers caractères. Entre
  minuit et une heure à Tunis, c'était la veille — et « lue le 07/11 à 00 h 30 » mêlait le jour universel et l'heure locale.
- Tous ces endroits, dans l'entreprise, la paie et le Cabinet, passent désormais par `jourDeLInstant` (la règle 5.2.3,
  qui existait : les cartes « pour ton comptable » des 1.319 à 1.322 ne s'en servaient pas). Un jour de calendrier
  (« 2026-11-08 ») y reste ce jour, à l'ouest comme à l'est.
- La preuve : `tests/moteur/jour-local-1323.test.ts` (Tunis, São Paulo, Tokyo), `tests/web/jour-local-1323.test.ts`
  (les deux navigateurs réglés sur 0 h 30 le 8 novembre à Tunis : l'entreprise et le Cabinet disent le 8), preuves
  `jour local 1.323.1 a-d`.

## Le groupe, jusqu'au comptable (1.324.0)

*08/11/2026. Joué par Hédi Ben Salah, à Sfax : sa Huilerie presse l'huile et la vend à sa Distribution, qui la revend aux
épiceries ; son Transport livre la Huilerie. Sa comptable, au Cabinet, tient la Huilerie et la Distribution.*

Ce qui n'allait pas, vu comme un chef d'entreprise qui tient trois sociétés, puis comme sa comptable :

- La page « Le groupe » additionnait les livres des sociétés. L'huile vendue par la Huilerie à la Distribution, puis par la
  Distribution aux épiceries, comptait deux fois : 12 471,875 DT de chiffre d'affaires pour 5 217,500 DT vendus au dehors.
  Ce que la Distribution doit à la Huilerie était à la fois « à encaisser » et « à payer » du groupe.
- Rien ne disait que les deux livres d'une même dette ne disaient pas le même montant : la Distribution avait oublié une
  facture de la Huilerie et mal recopié le prix d'une autre (41,357 au lieu de 41,375) ; la comptable ne le découvrait qu'en
  rapprochant les comptes à la main, à la clôture.
- La page était dans l'ancienne présentation (un tableau seul).

Ce qui est fait :

- Au serveur (`serveur/groupe.ts`, `entreSocietes`) : une société sœur se reconnaît parmi les clients et les fournisseurs
  d'une autre à son matricule (sept chiffres et lettre-clé, quelle que soit l'écriture : la Distribution avait noté la
  Huilerie sous son établissement 001, sans barres), ou, sur une fiche sans matricule, à son nom exact (« TRANSPORT BEN
  SALAH »). Pour chaque société, ce qu'elle vend à ses sœurs (70), ce qu'elles lui doivent (411) et ce qu'elle leur doit
  (401), par les écritures rattachées à ces fiches. Le total retire ce qui reste entre elles : le groupe, sans compter deux
  fois. Puis, pour chaque paire, ce que l'une doit à l'autre selon chacune, l'écart, et les pièces qui l'expliquent (une
  facture absente des achats de l'autre, un achat sans facture de ce numéro chez le vendeur, la même pièce à deux montants),
  appariées par le numéro de la facture ; le reste de l'écart se dit (un règlement noté d'un seul côté, une écriture sans
  la fiche).
- La page « Le groupe » dans la DA des listes : l'en-tête, quatre chiffres du groupe (vendu, ce que les clients doivent, ce
  que le groupe doit, la trésorerie), les sociétés avec, sous chacune, « dont avec tes sociétés » ; le total des livres, ce
  qui reste entre les sociétés, et le groupe. « Entre tes sociétés » : ce qu'elles se sont vendu, puis chaque dette lue des
  deux côtés, l'écart et ses pièces, avec « Ouvrir » pour aller corriger. Sans rien entre elles, une seule ligne de total.
  Au téléphone, « dont avec tes sociétés » se colle sous la carte de sa société.
- Au Cabinet (`groupeDuDossier`, onglet Inventaire) : « Les sociétés du même groupe » que le dossier, parmi les dossiers
  que la comptable tient (un dossier qu'elle ne tient pas n'y est pas) : les ventes de l'exercice entre elles (à retirer
  d'un chiffre d'affaires consolidé), et chaque dette lue des deux côtés, au dernier jour de l'année (ou aujourd'hui), avec
  la même phrase que l'entreprise (`KC.phraseEntreSocietes`, moteur partagé) et « Ouvrir » vers l'inventaire de l'autre
  dossier. Le pont passe le groupe avec les impayés et les garanties ; il ne grandit pas.
- Hédi a corrigé dans la Distribution (le prix, la facture oubliée) : la page et le Cabinet disent « Les deux livres disent
  le même montant ». Le Transport, qui n'a pas facturé la livraison, reste à l'écart, et la page le dit.
- La preuve : `tests/socle/groupe-1324.test.ts` (les chiffres au millime, l'établissement 001, le nom sans matricule, les
  deux écarts, le Cabinet par l'inventaire, deux chemins : le groupe est la somme des ventes au dehors, lues pièce par
  pièce), `tests/moteur/groupe-1324.test.ts` (la phrase), `tests/web/groupe-1324.test.ts` (la page, la correction, le Cabinet
  et son « Ouvrir », le téléphone), preuves `groupe 1.324 a-r` ; quatre preuves anciennes repointées.

**À VÉRIFIER** avec un comptable : des comptes de groupe dédiés plutôt que 411 / 401 ; la date du rapprochement au Cabinet
(le dernier jour de l'exercice de chaque société, quand les exercices diffèrent).

## La facture électronique reçue, jusqu'au comptable (1.325.0)

*08/11/2026. Joué par Hédi Ben Salah (Quincaillerie Ben Salah, Sfax) : son grossiste lui envoie le fichier El Fatoora de sa
facture (deux taux de TVA, une remise sur une ligne, le timbre), puis l'avoir d'une perceuse rendue ; le même fichier
arrive deux fois ; une facture papier saisie à la main reçoit ensuite son fichier signé ; une facture en euros. Puis par
Leïla Trabelsi, au Cabinet, qui tient le Café des Arts de Rim Gharbi : Rim lui envoie par la messagerie les fichiers de son
grossiste, dont une facture adressée par erreur à une clinique et un fichier incomplet.*

Ce qui n'allait pas :

- La messagerie refusait le fichier El Fatoora (« ni une photo ni un PDF ») : le client devait l'imprimer ou le photographier,
  et le comptable ressaisissait à l'œil ce que le fichier disait au millime.
- Glissé deux fois, le même fichier créait deux achats ; la facture saisie d'après le papier ne pouvait pas recevoir son
  fichier signé (il fallait la ressaisir) ; la remise d'une ligne se perdait (le prix net seul restait).
- Un avoir rattaché disait « Réglée » dans son en-tête et « Imputé » dans la liste ; la facture que seul un avoir
  diminuait se disait « Partiel », comme si l'avoir était un paiement.
- Au Cabinet, le fichier ne s'ouvrait pas (« ce fichier ne se dessine pas ici ») et ne se lisait que par l'IA (le fichier
  sortait de Tunisie pour dire ce qu'il dit déjà) ; la fiche de la Saisie ne connaissait qu'un taux : une facture à 19 % et
  7 % ne s'écrivait pas d'un geste, et une écriture à deux taux faisait proposer « TVA 18,6 % » (le rapport de ses totaux,
  qui n'est aucun taux). Au téléphone, le choix de la TVA était trop petit pour le pouce.

Ce qui est fait :

- Chez l'entreprise : le fichier déjà dans les achats le dit avant tout (« FA-2026-1187 est déjà dans tes achats ») et
  propose « Ouvrir FA-2026-1187 » ; la facture saisie d'après le papier, aux mêmes montants au millime, propose « Joindre à
  FA-2026-1203 » (le fichier rejoint ses justificatifs, sa référence TTN ses notes) ; « Saisir quand même une autre pièce »
  reste possible. La remise de chaque ligne et son prix brut sont gardés. Un avoir dit « Imputé » (ou « À imputer »,
  « Remboursé ») comme la liste ; un avoir n'est pas un paiement : sans règlement ni acompte, la facture reste « À payer »
  (ou « En retard »), à l'écran comme au serveur (`purchaseStatus`, `statutAchat`).
- La messagerie accepte le fichier El Fatoora, reconnu à son contenu (son en-tête et son élément TEIF, jamais à son nom ;
  ni script, ni SVG) ; il se dit « Facture électronique (XML) » et sa vignette « XML ». Base `0203` : le type
  `application/xml` pour les fichiers des messages et les documents du classeur ; `cabinet.lecture` garde d'où vient une
  lecture (`source` : l'IA ou le fichier) et ce que le fichier dit de plus (`detail`).
- Au serveur (`serveur/cabinet/efacture.ts`) : le fichier se lit sans l'IA, avec la lecture de l'écran de l'entreprise
  (`teif.js`) : le fournisseur, le numéro, la date, le total, et chaque taux avec sa base, le timbre, les lignes et leurs
  remises, la signature et la référence TTN, l'avoir et la facture qu'il diminue, à qui il est adressé. Les montants en
  texte au millième. Ni la clé de l'IA, ni l'accord du client ne sont en jeu : rien ne sort. Un fichier incomplet se
  refuse en disant pourquoi.
- Au Cabinet : la pièce se lit dès qu'elle s'ouvre, dans la Saisie, le classeur, « Pièces reçues » et « En grand », et
  se montre comme la facture qu'elle est (une feuille : lignes, TVA par taux, timbre, total TTC, « rien n'est passé par
  l'IA »). La fiche part du fichier : le total, le timbre et « Celles du fichier : 19 % et 7 % » ; l'écriture a une ligne
  de TVA par taux, au millime du fichier, la charge prend le reste ; un total changé n'est plus celui du fichier et ne
  s'écrit pas (« remets-le, ou choisis un taux ») ; l'avoir s'écrit à l'envers. La fiche dit à qui le fichier est adressé
  quand ce n'est pas le dossier, s'il n'est pas signé, et l'avoir. Une écriture à plusieurs taux n'en propose aucun. Au
  téléphone, les cases de la fiche font 44 points.
- Joué : 1 002,950 DT (845,000 HT, 154,850 de TVA à 19 % sur 815,000, 2,100 à 7 % sur 30,000, 1,000 de timbre) écrits
  6071 846,000 / 4366 154,850 / 4366 2,100 / 401 1 002,950, validés ; l'avoir 91,035 à l'envers ; aucune lecture partie
  chez l'IA.
- À VÉRIFIER avec un comptable : la TVA d'une facture électronique non signée se déduit-elle ; les autres taxes du fichier
  (FODEC) vont avec la charge (la charge prend tout ce qui n'est ni la TVA ni le timbre).
- (1.325.1) Le justificatif El Fatoora d'un achat du client, ouvert au Cabinet depuis son écriture (le menu de la ligne du
  livre-journal, ou « Son justificatif » au classeur), se montre en feuille, lue sur le serveur comme au classeur (le
  matricule du dossier compris : une facture adressée à une autre société le dit) ; « Le fichier XML » garde le fichier
  lui-même à un clic. Un PDF ou un fichier incomplet se refusent en se nommant (« « TEIF_incomplet.xml » ne se lit pas comme
  une facture électronique : … »). Au passage : une phrase qui commence par un nom cité entre guillemets ne lui met plus
  de majuscule (« facture-papier.pdf », jamais « Facture-papier.pdf ») ; et le rouge GitHub de 1.325.0 : au téléphone, le
  nom de la dernière migration (« facture_electronique_au_cabinet », un seul mot) sortait de l'écran Versions de la
  console — il se coupe dans sa tuile.
- La preuve : `tests/cabinet/efacture-1325.test.ts` (la lecture au millime, taux par taux, deux chemins : la somme des
  bases et de la TVA redonne le total ; l'avoir, l'autre société, le fichier incomplet, le XML qui n'est pas une facture,
  le classeur), `tests/web/efacture-recue-1325.test.ts` (Hédi : les quatre fichiers ; Leïla : la messagerie, la Saisie, les
  deux écritures, l'autre société, le fichier incomplet, le téléphone), `tests/moteur/achats.test.ts` et
  `reglements-achats-v10.test.ts` (l'avoir n'est pas un paiement), `tests/v10/achats.test.ts` (les 181 achats de l'exemple
  de cinq ans : la plateforme se sépare de la v10 là, exprès, pour la facture que seul un avoir réduit, et nulle part
  ailleurs), preuves `efacture 1.325 a-t` ; six preuves anciennes repointées. (1.325.1) La même lecture, depuis l'écriture
  (`tests/cabinet/efacture-1325.test.ts` : deux chemins, une lecture — la route et le classeur rendent la même pour le même
  fichier ; `tests/web/efacture-recue-1325.test.ts` : Leïla ouvre la feuille depuis le livre-journal, puis le XML),
  `tests/socle/textes.test.ts` (la majuscule), preuves `efacture 1.325.1 a-h`.

## Mon comptable, côté client (1.326.0)

*09/11/2026. Joué par Sarra (Boulangerie El Amal), que Jlassi Conseil tient depuis le matin : son cabinet lui demande
l'attestation CNSS du 3e trimestre, elle répond par une photo et un PDF, ouvre ce que le cabinet a rangé dans son
dossier, puis refait tout au téléphone. Puis Leïla, au Cabinet, ouvre le même fil au doigt. À la souris, au clavier, et
mesuré par l'instrument de rendu à 1440 et à 390.*

Ce qui n'allait pas :

- La carte « Ce mois-ci · novembre » disait « aucune vente ni aucun achat » le 9 du mois, alors qu'octobre était saisi et
  qu'une écriture y attendait au brouillard : elle ne parlait pas du mois que le cabinet travaille.
- Cette carte portait la classe des pastilles de mois de la liste des clients : centrée, grisée, en gras, avec un point de
  couleur perdu au-dessus du titre.
- « Inviter mon comptable » restait dans le menu à côté de « Mon comptable » alors qu'un cabinet tient le dossier, puis
  disparaissait au dessin suivant : tout le menu remontait de 31 points sous la souris.
- « Envoyer la pièce demandée » sans fichier écrivait son refus, sans montrer le bouton qui choisit la pièce.
- « Ce que ton cabinet a rangé » n'avait aucune règle de style (une classe posée par le code, inconnue de la feuille) :
  des puces par défaut, la nature et la date collées au titre, repliées n'importe où au téléphone.
- Au téléphone, la messagerie n'avait jamais été mesurée : le menu d'une vignette faisait 20 points, « Ouvrir »,
  « Enregistrer », « Joindre », « Une pièce », « Envoyer », « Répondre », « Voir le mandat » et « Chercher » de 25 à 42, des
  deux côtés (Mon comptable, et les Messages du cabinet) ; et la rangée des gestes, un texte, se lisait comme une phrase
  écrasée.

Ce qui est fait :

- La carte montre le mois en cours s'il a des pièces, sinon le DERNIER MOIS REMPLI (« Ton dernier mois rempli · octobre
  2026 »), arrêté à son vrai dernier jour (U-12 : un écran de travail s'ouvre sur le dernier mois qui a des données). Elle
  a sa propre classe (`msg-ce-mois`), alignée sur les autres cartes.
- « Inviter mon comptable » suit ce qu'on apprend du dossier : caché dès qu'un cabinet le tient, sans attendre le dessin
  suivant, et le menu se réajuste.
- Le refus marque et met le curseur sur « Choisir la pièce » (`msg-manque`, la règle du refus qui montre).
- « Ce que ton cabinet a rangé » : le titre, puis sa nature et sa date dessous, sans puce.
- Au téléphone, chaque cible du fil fait 44 points des deux côtés ; le menu d'une vignette grandit dans ses marges, la
  vignette ne bouge pas. La rangée des gestes est un bloc (`div`), plus un texte.
- Pour le test à la main : l'exemple du Cabinet pose la date de la pièce demandée par rapport au jour (une date écrite en
  dur passait, et la plateforme refuse une pièce demandée « pour » hier) et garde la session des gérants (« Mon comptable »
  se joue côté client sans retaper ni montrer un mot de passe).
- Écarté, avec sa raison : le fichier choisi qui fait descendre « Envoyer à mon cabinet » de 20 points (le déplacement a
  lieu pendant que la fenêtre de choix du système est ouverte, jamais sous un clic en cours) ; proposer « Ranger dans mes
  achats » d'après le texte de la demande (on ne devine pas la nature d'un fichier d'après une phrase) ; l'aide « Entrée
  envoie » coupée sur deux lignes au téléphone (elle ne s'affiche qu'à la souris : au doigt, `pointer: coarse` la retire —
  c'est la capture sans écran tactile qui la montrait).
- La preuve : `tests/web/mon-comptable-1326.test.ts` (Sarra : la carte du dernier mois au mot près, le menu sans
  « Inviter », le refus qui montre, le rangé sans puce ; le même fil à 390 côté client et côté cabinet, l'instrument de
  rendu sans aucun problème), `tests/web/mois-client.test.ts`, `messagerie.test.ts`, `messages-cabinet.test.ts` rejoués ;
  preuves `mon comptable 1.326.0 a-g`.

## Les Paramètres de l'entreprise, et ce qui se dit au cabinet (1.327.0)

*09/11/2026. Joué par Sarra (Boulangerie El Amal), que Jlassi Conseil tient : sa fiche remplie à la main (un matricule
incomplet, une adresse e-mail sans « @ », un RIB de dix chiffres, puis le bon), la numérotation reprise d'un carnet (FAC-047),
une caissière invitée, toutes les données téléchargées, la recherche des réglages, le thème sombre, une sortie sans
enregistrer ; puis un changement de régime fiscal par erreur et son retour. Au Cabinet, Leïla lit la fiche du client et
ses propres réglages. À la souris, au clavier, et mesuré par l'instrument de rendu à 1440 et à 390.*

Ce qui n'allait pas :

- Un matricule incomplet (« 1472411D ») se refusait à « Enregistrer » par un message de trois secondes ; la case
  redevenait normale, avec la valeur fausse, et plus rien ne disait pourquoi.
- Une adresse e-mail sans « @ » s'enregistrait sans un mot — elle s'imprime en haut de chaque devis et facture.
- En bas de page, « Enregistrer » faisait disparaître sa barre : la page raccourcissait et tout descendait de 73 points
  sous la souris.
- Dans Envois, la phrase sous « Email du comptable » disait « Relie-le plutôt dans Ton cabinet comptable » à une
  entreprise dont le cabinet est relié juste en dessous.
- **Le pont** : Sarra passait au forfait (sans TVA) ; Jlassi Conseil, qui fait ses déclarations, n'en savait rien — sa
  fiche gardait « TVA mensuelle », et aucun écran ne proposait de le lui dire.
- Au téléphone, la recherche des réglages s'arrêtait aux trois quarts de sa rangée, sa phrase coupée (« timbre, lo ») :
  la règle des champs d'une barre d'actions (quatre sélecteurs) battait celle du téléphone.
- Un rôle qui ne règle pas l'entreprise (un commercial) tapait dans les vingt cases de la fiche, et n'apprenait qu'à
  « Enregistrer » que rien n'était permis : tout ce qu'il venait de taper, perdu.

Ce qui est fait :

- Le matricule et l'e-mail de la fiche se vérifient pendant la frappe, comme le RIB : la remarque vit dans la ligne du
  libellé (« forme : 1234567A/A/M/000 », « pas une adresse e-mail ») et reste tant que la valeur est fausse. Seul le
  matricule se refuse à l'enregistrement (il décide de la licence et de ce que le serveur porte) ; l'e-mail prévient.
- Enregistrée, la barre se tait sans rendre sa place : rien ne bouge sous la souris.
- La phrase d'Envois dit ce qui est vrai, et suit ce qu'on apprend du cabinet.
- Un régime changé alors qu'un cabinet tient le dossier le dit AVANT d'enregistrer (« Ton cabinet fait tes
  déclarations : ce régime change ce qu'il dépose pour toi ») ; l'enregistrement propose « Le dire à mon comptable », qui
  ouvre la conversation avec le message prêt, relu avant d'envoyer (« j'ai changé mon régime fiscal… : « Forfaitaire — non
  assujetti à la TVA » (avant : « Réel — assujetti à la TVA ») »). Joué : le message arrive dans « Ce qui attend » de la
  fiche du cabinet. On prévient, on ne bloque pas : changer de régime reste à l'entreprise.
- Au téléphone, la recherche prend sa rangée (par son identifiant).
- Un rôle sans le droit de régler l'entreprise lit ses réglages sans pouvoir les changer : les cases sont fermées, et
  chaque onglet qui les porte le dit (« Tu lis ces réglages sans pouvoir les changer… ») ; son compte reste à lui. Le
  serveur refuse de toute façon.
- Écarté, avec sa raison : l'initiale de l'avatar (« S » dans l'équipe, « SM » dans la barre) — deux tailles de pastille,
  laissé ; la case « accord d'un responsable » dont la bulle se pose au bout de la cellule — elle reste lisible ; les
  onglets sur trois rangées au téléphone — ils restent tous atteignables d'un doigt, l'instrument ne trouve rien.
- À VÉRIFIER : la fiche du cabinet tient sa propre périodicité de TVA ; le régime de l'entreprise n'y remonte pas encore
  tout seul (le message le dit au comptable, qui corrige sa fiche).
- La preuve : `tests/web/parametres-1327.test.ts` (Sarra : le matricule et l'e-mail pendant la frappe, l'enregistrement en
  bas de page qui ne bouge pas, la phrase d'Envois, la remarque puis la proposition du régime, le message prêt dans la
  conversation ; le téléphone mesuré), `tests/web/droits-dossier.test.ts` retourné vers la règle (les cases fermées
  avant le geste) ; preuves `parametres 1.327.0 a-i`, deux preuves anciennes repointées.

## Les accords d'un responsable, joués à deux (1.328.0)

Joué à la souris par la boulangerie : Sarra (propriétaire) règle « au-delà de l'encours d'un client : l'accord d'un
responsable » ; Karim (commercial) facture 12 plateaux de viennoiseries à l'Hôtel Le Belvédère (500 DT autorisés).

Ce qui n'allait pas :

- Le bouton vert disait « Émettre la facture » sur une facture qui ne pouvait pas s'émettre : un clic confirmait
  « Émettre la facture FAC-2026-048 ? Émettre quand même », puis le serveur refusait, puis une seconde question proposait
  de demander l'accord. Deux questions, et la première annonçait un geste impossible.
- Karim passait à 20 plateaux APRÈS sa demande (643,600 → 1 072,000 DT) : l'écran disait toujours « Accord demandé
  (643,600 DT) », sans rien proposer. Le serveur, lui, n'aurait couvert que l'ancien montant.
- Chez Sarra, la demande annonçait 643,600 DT, sa fenêtre disait « Karim émet la facture telle quelle », et proposait
  « Accorder » : elle aurait accordé un montant qui ne couvrait plus la facture. La facture, faite sur un autre poste
  depuis l'ouverture de sa page, ne pouvait pas s'ouvrir depuis la fenêtre.
- Une facture redescendue sous le plafond (8 plateaux) restait derrière « Accord demandé », bouton éteint ; émise un
  jour, sa demande restait pour toujours sur l'accueil du responsable. Une demande refaite laissait l'ancienne en attente
  à côté (« 2 demandes d'accord attendent »).
- La page de Karim ne voyait l'accord qu'en rechargeant ; accordé, le récapitulatif disait encore « Émettre quand même »
  avec l'encours en avertissement, et « Avant d'émettre » le marquait comme un manque.

Ce qui est fait :

- `accordAttendu` (app-1) calcule ce que le serveur refusera (la remise d'abord, puis l'encours, la règle d'`accords.ts`) :
  le bouton dit « Demander l'accord », et le clic le demande en UNE question, avec les chiffres. La pastille, le bandeau,
  la fenêtre du responsable et l'accueil lisent cette seule fonction.
- Une demande couvre son montant : la facture qui grossit après devient « Redemander l'accord » (bouton, pastille,
  bandeau qui dit le montant d'aujourd'hui), pendant la frappe et sans perdre le curseur ; celle qui redescend redevient
  « Émettre », et le bandeau dit « Plus d'accord à attendre ».
- Chez le responsable : une demande périmée se lit avec le montant d'aujourd'hui, sans « Accorder » (« Émettre moi-même »
  sur la facture, « Ouvrir la facture » dans la fenêtre) ; une pièce d'un autre poste se relit (« Recharger pour la
  lire »). Le serveur ne montre que la dernière demande d'une pièce et seulement tant qu'elle attend ; décider une demande
  remplacée ou sans objet se refuse, avec sa phrase.
- La page d'une facture qui attend relit les demandes toutes les trente secondes et au retour sur l'onglet (jamais sous
  la frappe) ; un accord donné n'est plus un avertissement d'émission, et « Avant d'émettre » coche l'encours accordé.
- Une facture qui attend son accord s'exporte en PDF de brouillon, sans proposer « Émettre et exporter ».
- Le bandeau orange de l'encours ne redit plus « ou demande l'accord » quand une demande existe.
- Trouvé en jouant, traité à part (1.329.0) : le récapitulatif annonçait FAC-2026-048 (la suite que l'entreprise a posée,
  « Je facturais déjà », 47) et le serveur a donné FAC-2026-001 — la suite n'atteint jamais la série du serveur.
- Noté, pas changé : les bandeaux de l'éditeur (encours, stock) apparaissent pendant la frappe et poussent le formulaire
  (88 points) ; c'est le dessin de tous les bandeaux de la pièce, à reprendre d'un bloc.
- La preuve : `tests/web/accords-1328.test.ts` (Karim demande en une question, fait grossir, redemande, redescend et émet ;
  Nadia ne peut pas accorder l'ancien montant ; l'ancienne demande et la demande sans objet refusées au serveur),
  `tests/web/accords.test.ts` suit le geste neuf (et reçoit l'accord sans recharger) ; preuves `accords 1.328.0 a-n`, trois
  preuves anciennes repointées.

## « Je facturais déjà », jusqu'au serveur (1.329.0)

Trouvé en jouant les accords (1.328.0), joué ensuite par Sarra sur une pâtisserie neuve et par Karim, commercial.

Ce qui n'allait pas :

- La suite qu'une entreprise annonce (« Je facturais déjà », 47, depuis la fenêtre d'émission ou Paramètres → Documents →
  Numérotation) ne vivait que dans le dossier (`counters`). La fenêtre annonçait FAC-2026-048, le serveur donnait
  FAC-2026-001 : deux factures « 001 » la même année, l'une dans le carnet, l'autre ici. Rien ne le disait.
- Le bouton « Je facturais déjà » était proposé au commercial, alors que continuer une série est un réglage fiscal.
- Le lanceur des tests à la souris (`lancer.sh --garder`) ne migrait pas la base gardée : l'émission y tombait sur une
  fonction pas encore créée, une panne qu'aucun client n'aurait.

Ce qui est fait :

- À l'émission, la première facture (ou le premier avoir) d'une année encore VIERGE au serveur part de la suite annoncée
  (base 0204, `ventes.reprendre_v10`, tracée « socle.serie.reprendre » avec `par: emission`) ; une année où un numéro a
  été donné ne bouge jamais. Le ticket et le retour à la caisse ont leurs propres séries et ne sont pas concernés.
- Écrire la suite d'une facture ou d'un avoir est refusé à qui n'a pas le geste des réglages fiscaux (propriétaire,
  administrateur), et à tous pour une année déjà numérotée au serveur, avec la phrase qui dit pourquoi
  (`serveur/v10/numerotation.ts`, `garderLaNumerotation`). La suite d'un devis (numéroté sur le poste) reste libre.
- La fenêtre d'émission annonce le numéro que le serveur DONNERA (`GET …/dossier-v10/prochain-numero`, lu dans la série,
  sinon dans la suite annoncée) ; hors ligne, la règle de l'écran. Un dossier où l'écran et le serveur divergeaient
  (une suite posée avant 1.329.0, une année déjà commencée) annonce le numéro du serveur.
- Le commercial lit, à la place du bouton, qu'il revient au propriétaire ou à un administrateur de continuer la
  numérotation avant la première pièce.
- `scripts/humain/base.ts --migrer`, appelé par `lancer.sh --garder` : la base gardée reçoit les migrations écrites depuis.
- La preuve : `tests/v10/numerotation-1329.test.ts` (048 puis 049, commercial refusé, avoirs à part, année commencée),
  `tests/web/numerotation-1329.test.ts` (Karim sans le bouton, Sarra annoncée et émise à 048, Karim à 049 ; l'annonce du
  serveur sur un dossier divergent) ; preuves `numérotation 1.329.0 a-i`.

## La paie de la boulangerie, et ce qu'en lit le cabinet (1.330.0)

Jouée à la souris par Sarra (propriétaire) : Hédi, boulanger en CDI (1 250 DT brut, chef de famille, deux enfants), Amira,
vendeuse en CDD à temps partiel (600 DT), deux jours de maladie, le mois d'octobre pointé et validé, les deux bulletins
établis, payés par virement puis remis ; puis lue au Cabinet par Leïla (Jlassi Conseil). Les montants tombent juste des
deux côtés (net 1 555,175, charges 378,695, coût 2 228,695 : deux chemins, un chiffre).

Ce qui n'allait pas :

- Skander : « je n'aime pas les 4 cards, ce n'est pas intuitif ni ergonomique et ça porte à confusion, on ne comprend pas
  la page ». Quatre cartes de même poids, dont deux allumées à la fois (l'étape en cours, et celle qu'on regarde), ne
  disaient ni qu'elles se suivent, ni que cliquer change le bas de la page.
- Le brut prérempli à 0,000, un clic à gauche du chiffre aligné à droite, « 1250 » tapé : 12 500 DT. La règle qui
  sélectionne un nombre prérempli (10.12.0) ne visait que les cases `type=number` ; les montants sont des cases de
  texte en français depuis la 1.155.0. Le Cabinet la portait déjà ; l'entreprise, non.
- L'étape « Pointer » se disait « facultatif » au-dessus de « Les bulletins attendent : 1 chose à régler dans le
  pointage » (27 journées pas validées) ; validé, le mois laissait encore « Pointer » en cours et « facultatif ».
- « Une absence sur plusieurs jours » ouverte depuis octobre proposait le 09/11.
- « Renseigner le RIB… » posait le curseur dans une case cachée sous le pied de la fenêtre.
- Le RIB gardait ses espaces : sa fin se lisait « ··· 0 52 » sur les bulletins, « 9052 » sur l'équipe.
- Le navigateur proposait le CIN de Hédi dans la fiche d'Amira (son historique de la case).
- Au Cabinet : « 1 sur 2 salariés pointés » et « Un mois sans pointage » alors que Sarra avait validé octobre (pointer
  à la main, c'est noter ce qui change : Hédi, présent à ses horaires, n'avait pas de grille, et le Cabinet ne lisait
  que les grilles) ; deux paires « Le demander à Sarra / Le renseigner… » sans dire à qui ; « préparé » sur deux
  bulletins payés et remis.

Ce qui est fait :

- « Le mois » en frise, comme celle du Cabinet : un trait relie les quatre étapes et se remplit avec ce qui est fait ; le
  rond dit l'état (coche : fait ; cerclé : en cours) ; un seul repère, souligné comme un onglet, dit l'étape affichée
  dessous. Quand l'étape affichée n'est pas celle du moment, une ligne le dit et y mène (« Tu regardes Pointer, fait.
  L'étape du moment : Bulletins — 0 sur 2 établis. Aller à « Bulletins » »). Au téléphone, seule l'étape affichée et
  l'étape en cours gardent leur phrase.
- « Pointer » dit ce qui retient (« 1 chose à régler avant les bulletins ») ou « le mois est validé », et un mois validé
  est une étape faite, même avant les bulletins.
- Valider le mois (ou une journée, ou le rouvrir) redessine la frise et l'en-tête sur-le-champ : sous un mois tout juste
  validé, « Pointer » disait encore « 1 chose à régler » jusqu'au clic suivant (trouvé par le test qui joue le geste).
- « la déclaration d'octobre » (et d'avril, d'août), plus « de octobre ».
- Un montant prérempli (`.num`, `data-montant`) se sélectionne quand on y entre, au clic comme à Tab.
- Une absence notée depuis un mois passé (ou à venir) propose son 1er ; depuis le mois en cours, aujourd'hui.
- Une fenêtre dont le pied reste collé en bas réserve sa hauteur quand elle amène une case à l'écran. Le défaut vu à la
  souris (« Renseigner le RIB… ») ne se reproduit dans aucun test — Chrome centre la case qui reçoit le curseur — : la
  marge reste, sans preuve, et deux tests vérifient que la case se voit, dont le vrai geste de la fenêtre de paiement.
- Au téléphone, le bandeau du mois validé et ses deux gestes (« Voir la version validée », « Corriger : une nouvelle
  version ») passent sous la phrase : la page débordait de 28 px de côté. La coche de « Tu regardes » reste à côté de sa
  phrase.
- Le RIB s'enregistre sans espaces ; sa fin se lit sans espaces partout. CIN, matricule et identité CNSS ne se
  remplissent plus de mémoire.
- Le Cabinet lit les versions validées du pointage et les mois rouverts, sans pouvoir les écrire (base 0205, route de la
  paie du dossier, pont) : un salarié de la version validée compte pointé, la frise dit « validé par Sarra le 09/11 »,
  le tableau de la paie des dossiers compte le mois validé ; un mois rouvert ne l'est plus. Plusieurs salariés sans
  n° CNSS : chaque bouton nomme le sien. Un bulletin payé (et remis) par le client le dit.
- Écarté : le PDF du second bulletin enregistré sous « download » ; c'est le navigateur de la machine de test, lancé
  sans langue UTF-8, qui ne sait pas écrire « é » dans un nom de fichier.
- À VÉRIFIER avec le comptable : la maladie est payée par l'employeur (les jours restent payés sur le bulletin) pendant
  que la fenêtre d'absence dit « la CNAM indemnise » : selon la convention, l'un des deux est à revoir.
- Le rouge GitHub de la 1.328.0, réparé ici : quatre preuves des accords restaient vertes, parce que le récapitulatif
  d'émission ne parlait plus d'accord à personne (depuis la 1.328.0, le bouton vert le demande avant). Les deux phrases
  mortes sont retirées ; les preuves visent la règle là où elle vit (`accordAttendu`), et le refus du serveur — le seul
  chemin de secours encore vivant, quand l'écran ne savait pas — a son test (la règle activée pendant que Karim a sa
  facture ouverte). Et un bouton mesuré 43,9998 px au téléphone de GitHub se juge au pixel près.
- La preuve : `tests/web/paie-1330.test.ts` (la frise et ses états, la ligne « Tu regardes », l'absence du mois regardé,
  le brut tapé après un clic, la case du RIB au-dessus du pied, le RIB sans espaces), `tests/cabinet/paie-1330.test.ts`
  (le Cabinet lit sans écrire ; la paie des dossiers compte le mois validé ; rouvert, plus rien ; la base ne lui ouvre
  rien d'autre de la racine), `tests/web/cabinet-paie-1330.test.ts` (« validé par », plus de « mois sans pointage »,
  les boutons nommés, « payé, remis »), `tests/moteur/paie-1330.test.ts` (« d'octobre ») ; preuves `paie 1.330.0 a-r` (sans g).

## L'Aide, le guide et le support, des deux côtés (1.331.0)

Jouée à la souris par Sarra (Boulangerie El Amal) : une question tapée comme on la pose (« comment valider le
pointage »), une autre sans réponse, l'article de l'abonnement et son geste, celui de l'équipe, celui des clôtures, puis
une clôture du mois et son journal ; au Cabinet, Leïla relit l'article de l'équipe et l'onglet Exercice.

Ce qui n'allait pas :

- La recherche ne trouvait pas une question posée en français : « comment valider le pointage » cherchait aussi
  « comment » et « le », ne connaissait pas « valides » pour « valider », et rangeait les articles dans l'ordre du
  fichier. L'article de la paie ne disait d'ailleurs plus « pointage ».
- Rien trouvé : « Aucun article », et rien d'autre à faire. La question tapée était perdue.
- L'en-tête de l'Aide : six boutons, sans le chemin des autres pages ; « ← Accueil » à côté d'un chemin qui y mène
  déjà ; le fil de l'article redisait « Aide » sous l'en-tête.
- « Nouveautés de la version » ouvrait « Historique indisponible » en ligne.
- Une dizaine d'articles décrivaient l'application de bureau : une licence SKAN1 à coller, des données « sur ton
  ordinateur » avec une copie externe, « Travailler à deux » par un dossier partagé, des numéros de version, « pas de
  pointage », « pas de remise au comptoir », « pas de lots ni de dépôts » (tout cela existe en ligne), ⌘P.
- Le geste d'un article ouvrait les Paramètres en haut de « Ton compte », pas le panneau qu'il nomme ; « Clôturer un
  mois » ouvrait la Comptabilité sur son premier onglet.
- Le journal des clôtures écrivait « cet ordinateur » et ne disait ni le jour du geste, ni qui l'avait fait.
- La page « Tes demandes au support » n'avait pas le chemin des autres pages.
- Au Cabinet : l'article de l'équipe parlait de postes et de copie externe ; « Le dossier pour le client… » (le
  fichier .skanclose à envoyer) ne savait que refuser en ligne.

Ce qui est fait :

- La recherche retire les petits mots (« comment », « le », « de »…), compare les racines (« valider » trouve
  « valides », « congés » trouve « congé »), range d'abord les articles qui ont tous les mots, puis ceux qui en ont une
  partie (« Avec une partie de tes mots »), et le compte le dit. Le mot entier se surligne, jamais sa racine seule.
- Rien trouvé : « Pose ta question au support : l'équipe SkanFact te répond ici, en général dans la journée », avec
  « Poser ma question au support » ; la fenêtre s'ouvre avec la question déjà écrite et le curseur à sa fin, et se
  referme sans question si l'on n'y a rien changé.
- L'en-tête suit les autres pages : le chemin (Accueil › Aide › le thème › l'article), le titre, sa phrase ;
  « Tes demandes au support » et « Écrire au support ». « Proposer une idée » passe dans une bande au bas de
  l'accueil de l'Aide ; « Nouveautés » ne se montre que là où l'historique existe.
- Les articles disent ce que fait l'application en ligne : « Ton abonnement » (Paramètres → Ton abonnement), « Tes
  données » (le serveur, une sauvegarde chaque nuit, l'export de toutes les données), « Travailler à plusieurs »
  (Paramètres → L'équipe → Inviter quelqu'un…, les huit rôles), « Faire découvrir SkanFact », la lecture d'une facture
  d'achat, les congés et le pointage du mois, la remise au comptoir, les lots et les dépôts ; plus aucun numéro de
  version.
- Un geste d'article peut viser un panneau des Paramètres ou un onglet de la Comptabilité : l'abonnement ouvre
  « Ton abonnement », l'équipe « L'équipe », la clôture l'onglet des clôtures.
- Le journal des clôtures a les colonnes « Le » (le jour du geste, à Tunis) et « Par » (le nom du compte, sinon son
  adresse) ; les trois gestes (clôturer, clôturer jusqu'à, rouvrir) l'écrivent.
- « Tes demandes au support » a son chemin (Accueil › Aide › Tes demandes au support) et sa phrase.
- Au Cabinet : l'article de l'équipe dit Réglages → Mon cabinet → L'équipe → Inviter un collaborateur…, les trois rôles
  et les dossiers confiés ; « Le dossier pour le client… » ne se montre plus en ligne, et l'article de l'exercice dit
  que le client lit la validation de son cabinet dans ses Clôtures (son sous-titre et la fin de la visite « Clôturer
  l'exercice » aussi).
- Le rouge GitHub de la 1.330.0, réparé ici : `tests/web/facture-charte.test.ts` décochait les cases de la fenêtre
  d'émission avant qu'elle soit là (elle attend le numéro du serveur depuis la 1.329.0) ; « Signer par DigiGo » restait
  coché, et sa fenêtre recouvrait la suite. Le test attend la fenêtre ; l'application n'avait rien de faux.
- Trouvé en jouant, traité à part (1.332.0) : au Cabinet, « Signaler un problème… » montre un rapport de l'application
  de bureau (« Système : · Electron », « Dossiers : 0 » sur douze, une copie externe, « Ouvrir le journal technique »)
  et n'envoie rien ; « Proposer une amélioration… » dit « SkanFact Cabinet ? · ? ». Un cabinet n'a pas encore de
  support : il faut lui en donner un, comme à l'entreprise.
- Pas fait, noté : la phrase « Barèmes → » de la paie (l'écran de la paie, pas l'Aide) ; les Paramètres sans le chemin
  des autres pages.
- La preuve : `tests/web/aide-1331.test.ts` (la question, rien trouvé et le support, le chemin et les gestes, le journal
  des clôtures), `tests/v10/aide-en-ligne.test.ts` (aucun article ne décrit le bureau ; l'Aide du Cabinet ne promet ni
  fichier ni poste) ; preuves `aide 1.331.0 a-o`.

## L'Aide et le support du Cabinet (1.332.0)

Jouée à la souris par Leïla, associée d'un cabinet : une question tapée comme on la pose dans l'Aide du Cabinet, une
autre sans réponse, puis « Signaler un problème… » et « Proposer une amélioration… » dans les Réglages ; à la console,
Karim (support) lit la demande et répond.

Ce qui n'allait pas (trouvé en jouant la 1.331.0) :

- « Signaler un problème… » montrait le rapport de l'application de bureau (« Système : · Electron », « Dossiers : 0 »,
  une copie externe, « Ouvrir le journal technique ») et n'envoyait rien : un cabinet n'avait aucun moyen d'écrire à
  l'équipe SkanFact. « Proposer une amélioration… » préparait un mail signé « SkanFact Cabinet ? · ? », en vouvoyant.
- La recherche de l'Aide du Cabinet exigeait chaque mot tapé : « comment valider une écriture » ne trouvait rien, et la
  palette (Ctrl K) cherchait encore autrement. Deux recherches sur le même genre de corpus, trois résultats différents.
- L'Aide n'avait pas l'en-tête des autres pages, et son pied renvoyait à « Réglages → L'application → Aide et
  dépannage » pour un rapport qui ne partait nulle part.

Ce qui est fait :

- Un vrai support pour le Cabinet, le même qu'une entreprise (docs/support.md, « Dans le Cabinet ») : la base 0206,
  six routes `/cabinets/:cabinet/support…`, la pièce du pont `modules/socle/pont/cabinet.js`, la page « Tes demandes au
  support » partagée, la pastille et le bandeau ; la console dit « cabinet » et nomme sa page avec les mots du Cabinet.
- Trouvé à la souris, à la console : Karim se voyait proposer l'Aide de l'ENTREPRISE (« La TVA ») pour répondre à
  Leïla, un article qu'elle ne peut pas ouvrir. La console lit l'Aide du Cabinet pour une demande de cabinet (sans les
  quatre articles du bureau que le Cabinet en ligne n'affiche pas : les sauvegardes, changer d'ordinateur, la licence, les
  mises à jour), et refuse à la réponse un article qui n'est pas dans l'Aide que le demandeur a sous les yeux.
- Une seule recherche pour les deux applications (`modules/socle/aide/recherche.js`, `window.AideRecherche`) : les petits
  mots ne cherchent rien, un mot se cherche par sa racine (« lettrer » trouve « lettrage »), les articles qui ont tous
  les mots passent devant, et le mot entier se surligne. L'Aide de l'entreprise, celle du Cabinet et la palette du
  Cabinet l'appellent ; aucune ne garde la sienne.
- L'Aide du Cabinet a l'en-tête des autres pages (Tableau de bord › Aide › l'article), « Tes demandes au support » et
  « Écrire au support » ; rien trouvé, la question part au support telle quelle, le curseur à sa fin ; une bande
  « Une idée pour le Cabinet ? » au bas de l'accueil ; le pied dit d'écrire au support.
- Les Réglages (Aide et dépannage) disent le support en ligne ; « Proposer une amélioration » part à l'équipe avec ses
  deux questions, en tutoyant ; la visite « Écrire au support » et les bulles le disent aussi.
- La preuve : `tests/support/support-cabinet-1332.test.ts` (par l'API : écrire, le double clic, chacun ses demandes, la
  console qui répond, l'alerte, l'entreprise inchangée), `tests/web/support-cabinet-1332.test.ts` (à la souris : l'en-tête,
  la question qui trouve son article, rien trouvé et le support, la réponse annoncée puis lue, les Réglages et l'idée, la
  page dite par la console), `tests/v10/aide-recherche.test.ts` (la recherche partagée) ; preuves `support 1.332.0 a-s`,
  et `aide 1.331.0 a-c` visent désormais le module partagé.
- Pas fait, noté : « Ne rien perdre » (le bureau : copie externe, clé de secours) est retiré en ligne, mais rien ne le
  remplace — aucun article du Cabinet ne dit ce qui garde ses livres (le serveur, la copie de chaque nuit, l'export),
  quand l'entreprise l'a depuis la 1.331.0. À reprendre avec la revue des Réglages du Cabinet (1.333.0).

## Les Réglages du Cabinet en ligne (1.333.0)

Joués à la souris par Leïla, associée, et par Rim, en Saisie, onglet par onglet : Ton compte, Mon cabinet, Comptabilité,
Données et sécurité, L'application.

Ce qui n'allait pas :

- **Données et sécurité** ne gardait qu'un bouton « Se déconnecter » : rien ne disait au cabinet que les livres de ses
  dossiers sont copiés chaque nuit, ni comment les reprendre, ni à qui demander de défaire une erreur. (Noté à la 1.332.0.)
- **La grille de saisie** acceptait la même touche pour deux gestes : F2 posé sur « Solder la pièce », alors que
  « Recopier la ligne du dessus » l'avait déjà, s'enregistrait sans un mot — et dans la grille, un seul des deux se fait.
- **Le pied de la barre** disait « Direction » pour celle que la liste de l'équipe dit « Supervision », et « Tenue des
  dossiers » pour « Saisie et validation » : deux noms pour un rôle.
- **Les jours de dépôt** (TVA, CNSS, relances) étaient un nombre nu : « 28 » — le 28 de quel mois ?
- **« Comment un client arrive »** nommait au client un chemin qu'il ne voit pas (« Comptabilité › Cabinet (ou
  Paramètres › Envois) ») : dans son menu, le geste s'appelle « Inviter mon comptable ».
- **Rim**, en Saisie, pouvait taper un nouveau nom de cabinet et ne l'apprenait qu'à l'enregistrement : refusé.

Ce qui est fait :

- « Tes données » (docs/sauvegardes-ecran.md, « Dans le Cabinet ») : les mêmes faits que l'entreprise, lus par la base
  0207 et la route `GET /cabinets/:cabinet/sauvegardes`, dits par un seul module pour les deux applications ; reprendre ses
  livres (l'export du livre-journal) ; « Défaire une erreur : écrire au support… », prérempli, le curseur sur le dossier.
  L'article de l'Aide « Tes livres » et sa bulle.
- Une touche ne fait qu'un geste : la règle vit dans le moteur (`CabCore.toucheEnDouble`, sans distinguer la casse) ;
  la frappe la refuse en nommant le geste qui l'a ; l'enregistrement la refuse (l'écran et le pont) ; une grille réglée
  avant, avec une touche double, se signale au-dessus de « Enregistrer », et l'avertissement dit « Corrigé » sur place.
- Le pied de la barre dit le nom de rôle de la liste de l'équipe (`libelleRole`, une seule table).
- Les jours de dépôt se lisent « le [28] du mois suivant », « le [15] du mois qui suit le trimestre ».
- Le chemin du client : « dans son menu, Inviter mon comptable (Comptabilité › Cabinet) », partout où le Cabinet le dit
  (Réglages, Aide, bulles).
- Le nom du cabinet ne se change que par un associé : pour les autres rôles le champ est fermé, et il le dit.
- Et le rouge GitHub de la 1.331.0 : l'article des raccourcis range ses touches en trois tableaux ;
  tests/web/recette-alpha.test.ts lisait le premier seul (en mode strict, trois éléments : refus).
- La preuve : `tests/support/reglages-cabinet-1333.test.ts` (deux chemins, un état : le cabinet et l'entreprise lisent les
  mêmes copies ; un collaborateur aussi ; ni une personne hors du cabinet, ni un groupe de sociétés ; la
  règle des touches), `tests/web/reglages-cabinet-1333.test.ts` (à la souris : Tes données et la demande au support, la
  touche refusée à la frappe, signalée puis refusée à l'enregistrement, corrigée ; les jours de dépôt ; Rim) ; preuves
  `réglages 1.333.0 a-q`, et deux preuves anciennes des sauvegardes visent le module partagé.

## Les Échéances et les Relances du Cabinet, et le pont (1.334.0)

Jouées à la souris par Leïla, associée (les Échéances, les Relances, le Tableau de bord), et par Rim, en Saisie ; côté
client, par Amel (la librairie) et Hédi (la menuiserie), qui lisent ce que la relance leur demande.

Ce qui n'allait pas :

- **Trois écrans, trois réponses** à la même question (« à qui manque-t-il des pièces ? ») : les Échéances disaient du café
  « 2 pièces reçues, à classer » pendant que les Relances proposaient de lui écrire en vert et que le Tableau de bord
  disait « Demander… » ; un client relancé le matin même restait l'étape suivante partout.
- **Relancer deux fois** laissait au client deux demandes ouvertes pour la même pièce (« Vos relevés bancaires de
  septembre », deux fois, chacune avec sa date).
- **Un client sur SkanFact** se voyait demander « Vos ventes et vos achats de septembre, enregistrés dans SkanFact » comme
  une pièce à joindre : la carte lui proposait d'en envoyer une photo, alors que le cabinet les lit dans ses livres.
- **Une relance partie dans la conversation** se notait « autre » (la fiche refusait le moyen) : la page disait « Autre ».
- **Après une relance** depuis la page Relances ou le Tableau de bord, la page ne se redessinait pas : le client restait
  « à relancer », le vert sur lui (seules les Échéances se redessinaient).
- **La légende** d'une déclaration disait « 2 prêtes à déposer » quand l'une restait à préparer ; **la barre** d'une
  échéance lointaine (la TVA d'octobre, dans dix-neuf jours) était toute rouge sous une carte grise.
- **En « Les miens »**, les Relances et leur pastille comptaient encore tous les dossiers du cabinet (Rim, en Saisie, ne
  reçoit du serveur que ses dossiers : pour elle, rien ne débordait).
- La date « pour le » d'une relance se calculait en instant (`toISOString`) : à Tunis, entre minuit et une heure, la veille.

Ce qui est fait :

- Un client qui a envoyé des pièces attend qu'on les classe ; un client relancé aujourd'hui attend sa réponse. Ni le vert,
  ni « Relancer tout le monde » (qui devient « Relancer N clients » quand il en laisse), ni « À faire maintenant » ne les
  visent : la ligne du café porte « Ouvrir les pièces » (Relances) et « Classer » (Tableau de bord), celle du client
  relancé « Sa conversation », à voir. La page Relances le dit sous son titre : « 4 clients à qui il manque un mois · 1 relancé
  aujourd'hui · 1 a envoyé des pièces, à classer ».
- Une pièce déjà demandée et pas encore reçue ne se redemande pas (serveur, `POST /entreprises/:id/messages`) : même
  texte, sans les majuscules ni les espaces autour ; le message part, la demande ouverte reste la seule, la réponse la
  nomme (`deja`) et l'écran le dit (la relance : « 1 pièce déjà demandée, pas redemandée » ; la conversation : « « … » est
  déjà demandée et pas encore reçue »). Reçue, la pièce se redemande.
- Un client sur SkanFact ne se voit demander que ses relevés bancaires ; le message lui dit d'enregistrer ses ventes et
  ses achats.
- La fiche garde le moyen « conversation » (serveur et pont) ; une relance d'avant, notée « autre » avec la note
  « Relance envoyée dans… », se lit « dans la conversation ». Partout, le moyen se dit en mots (« Par e-mail », « Au
  téléphone ») et la date de la dernière relance en jours (« relancé aujourd'hui », « hier », « le 27/10 »).
- La page d'où l'on relance se redessine (Relances, Tableau de bord, Dossiers), sauf pendant une tournée.
- La légende dit « 1 préparée, à déposer » et « 1 à préparer » ; ce qui reste à faire n'est rouge que si l'échéance presse.
- Les Relances et leurs deux pastilles ne comptent que les dossiers de la portée (« Les miens », « Tous ») ; la page porte
  le fil « Mon cabinet · … » des autres pages.
- L'exemple humain (`scripts/humain/exemple-cabinet.ts`) donne à chaque dossier ses propres montants, mois par mois.
- La preuve : `tests/messagerie/relances-1334.test.ts` (la pièce déjà demandée, en majuscules et avec des espaces ; une
  demande seule déjà ouverte n'écrit rien ; reçue, elle se redemande ; un autre client n'est pas confondu ; la fiche et le
  moyen « conversation »), `tests/web/relances-cabinet-1334.test.ts` (à la souris : six clients, la phrase, le groupe, le
  vert, la relance partie puis repartie sans redemander, la légende, la barre grise du 9 novembre, le Tableau de bord,
  Leïla en « Les miens » et Rim) ; trois tests anciens lisent « relancé aujourd'hui », « Par e-mail » et la demande déjà
  ouverte de la conversation ; preuves `relances 1.334.0 a-z`, et six preuves anciennes visent le code d'aujourd'hui.
- Et les rouges GitHub de la 1.332.0 : le Cabinet pose la porte du pont depuis qu'il a ses morceaux de pont
  (tests/web/registres.test.ts l'attendait vide) ; tests/web/support-cabinet-1332.test.ts tapait la suite de la question
  avant que le curseur soit au bout (« je xylophone tablettecherche… ») : il attend le curseur.

À VÉRIFIER : une pièce se reconnaît « déjà demandée » à son texte exact (sans majuscules ni espaces autour) ; « Relevés
de septembre » et « Vos relevés bancaires de septembre » restent deux demandes. La fenêtre de relance ne prévient qu'après
l'envoi : elle pourrait le dire avant.

## La maquette de la paie à la demande, et l'onglet sans la pastille (1.334.1)

Le rouge GitHub de la 1.333.0 et de la 1.334.0 : la première ouverture de SkanFact pesait 1 302 Ko pour un seuil de 1 300
(`tests/web/leger.test.ts`). Une mesure qui dépasse change le plan, pas le seuil (`docs/leger.md`, L10).

Ce qui est fait :

- La feuille de la maquette de la paie (`plateforme/paie-maquette.css`, 148 Ko, toute sous `.pm`) ne part plus avec la
  page. La Paie et la fiche d'un salarié l'attendent (« Un instant… », puis la page), une fois ; elle se pose juste après
  `paie.css`, à sa place dans la cascade. Sans réseau et jamais chargée, la Paie le dit (« La paie n'est pas encore sur
  ce poste, et le réseau manque : elle s'ouvre dès qu'il revient. ») et se dessine seule au retour du réseau. Mesuré :
  1 284 Ko en 14,5 s (la marge est de 16 Ko).
- Joué à la souris (Sarra, la boulangerie) : l'accueil ne charge pas la feuille ; « Paie » au menu l'amène et la page est
  la même qu'avant ; la fenêtre « Une avance ou un prêt » garde sa croix et son pied ; la fiche de Hédi s'ouvre.
- Vu en jouant : l'onglet du navigateur disait « Hédi Trabelsi Son n° CNSS et son RIB manquent — SkanFact » (la pastille
  d'état posée dans le titre de la fiche), et « Bois du Sahel Nouveau » pour un fournisseur neuf. Il dit le nom.
- La preuve : `tests/web/paie-maquette-1334.test.ts` (la première ouverture sans la feuille, la Paie sans réseau puis au
  retour du réseau, la place dans la cascade, la croix d'une fenêtre, la fiche ouverte par son adresse, les deux onglets) ;
  les 30 tests d'écran qui ouvrent la Paie passent ; preuves `paie 1.334.1 a-h`, et « P1b g » vise le code d'aujourd'hui.

À VÉRIFIER : la marge du poids n'est plus que de 16 Ko. Le prochain levier est le code de la paie lui-même (dans
`app.js`), qui demande de charger `app.js` en morceaux.

## Les Pièces reçues du Cabinet, et le pont (1.335.0)

Joué à la souris : Leïla (le cabinet) devant dix-sept pièces de quatre clients, puis Sarra (la boulangerie) dans « Mon
comptable », qui envoie les pièces que son comptable lui a demandées.

Ce qui est fait :

- **La pièce suivante parcourt toutes les pièces à classer.** Au-delà de quinze pièces, seuls les deux premiers dossiers
  s'ouvrent d'office ; la visionneuse ne comptait que ceux-là, la flèche ↓ s'arrêtait à la
  dernière pièce des dossiers ouverts, et après un classement on revenait à la pièce d'avant au lieu de passer au dossier
  replié suivant. Elle compte maintenant toutes les pièces (« 1 sur 17 »), passe d'un dossier à l'autre, et ouvre le
  dossier de la pièce où elle arrive. Un dossier qu'on a replié soi-même reste sauté : c'est un choix.
- **Une pièce qui répond à une demande garde le mot du client.** « Répond à ta demande : « L'attestation CNSS… » » cachait
  ce que Sarra avait écrit en l'envoyant ; les deux se lisent, l'un après l'autre.
- **« Tes demandes »** au lieu de « Demandes en cours » : la ligne montre aussi les demandes reçues ces trois derniers
  jours, cochées.
- **L'avertissement du client qui saisit lui-même ses achats se lit avant la pièce**, avec les autres, et non sous le
  document, sous la barre des gestes, hors de l'écran — c'est lui qui explique le vert « Lui laisser la saisie ».
- **Côté client, la carte d'une pièce demandée ne dit plus « reçue » trois fois** (« … · reçue », « Reçue 09/11 »,
  « Reçue ») : le titre redevient la demande.
- **Le pont, dans l'autre sens** : des pièces arrivées APRÈS l'ouverture des Relances ou des Échéances (un réseau lent, une
  machine chargée) laissaient le client « à relancer », le vert et le groupe sur lui (« Relancer 3 clients »). Les deux
  pages se redessinent quand la liste des pièces change — jamais sous une fenêtre ouverte ni pendant qu'on tape. Trouvé
  parce que le test de la 1.334.0 tombait sous une machine chargée : ce n'était pas le test, c'était l'écran.
- La preuve : `tests/web/barre-cabinet.test.ts` (plus de quinze pièces, le mot du client, « Tes demandes », la place de
  l'avertissement), `tests/web/relances-cabinet-1334.test.ts` (les pièces qui arrivent après les Relances et les
  Échéances), `tests/web/messagerie.test.ts` (la carte côté client) ; preuves `pièces 1.335.0 a-g, i-k`.

À VÉRIFIER : les Relances et les Échéances se redessinent quand une pièce ARRIVE ou PART de la liste ; une pièce dont
seul l'état change (sans arriver ni partir) ne les redessine pas. Vu en jouant et laissé : une pièce classée qui en
remplace une autre (la photo refaite de IMG_8790) ne le dit pas dans les pièces classées.

## Les Messages du Cabinet, et le pont (1.336.0)

Joué à la souris : Leïla dans la boîte des Messages (la boulangerie, l'institut, le garage), Sarra de l'autre côté dans
« Mon comptable », qui reçoit la réponse.

Ce qui est fait :

- **« Saisir cette pièce », sous une photo du fil, passe par la même porte que « Pièces reçues ».** Elle ouvrait une
  grille vide, et le commentaire disait encore que le Cabinet ne joint pas de fichier à une écriture (il le fait depuis
  la 1.174.5). La pièce restait donc « à classer » une fois saisie depuis la conversation, et se saisissait une seconde
  fois depuis « Pièces reçues » — deux chemins, deux écritures. La saisie s'ouvre maintenant préparée (« Saisie de
  « IMG_8790-bis.jpg » · la conversation : enregistrée, l'écriture la prend pour justificatif… », « Retour à la
  conversation ») ; enregistrée, la pièce s'y joint et sort des pièces à classer, et l'écran revient à la conversation.
- **Une pièce déjà classée ne se propose plus à la saisie.** Le fil ne savait pas ce que « Pièces reçues » en avait fait :
  il proposait « Saisir cette pièce » sous une pièce saisie, en double ou jointe. Le serveur le dit au fil du cabinet (la
  raison et le jour, rien de plus) et le fil l'écrit sous la pièce (« Jointe à son écriture », « En double »…). Le client
  n'en reçoit rien : c'est le rangement du cabinet, pas le sien.
- **La pièce montrée à côté de la grille est celle qu'on saisit.** Elle prenait la première pièce à traiter de l'année —
  une autre facture — sous le titre « Saisie de » celle-ci ; et quand la grille s'ouvrait avant que les pièces soient
  lues, aucune pièce ne venait jamais à côté. Les deux venaient aussi de « Pièces reçues ».
- **Le dossier à côté nomme tous les mois en retard** : « Août et septembre en retard », et non « Septembre en retard »
  au-dessus de deux mois échus, à côté de « 2 mois en retard » dans la liste.
- **« 15 pièces à classer »** dans le résumé de la boîte, le mot de « Pièces reçues » : « 15 photos à saisir » comptait
  aussi les PDF.
- **« de Yasmine »**, pas « d'Yasmine » : un Y devant une voyelle se prononce comme une consonne (« la promesse de
  Yasmine », « On attend de Yasmine ») ; « d'Yves » reste.
- La preuve : `tests/web/messages-cabinet-1336.test.ts` (la saisie depuis le fil jusqu'à la pièce jointe, la pièce à
  côté parmi deux, le fil qui dit « Jointe à son écriture », les mois en retard, « de Yasmine »),
  `tests/messagerie/messagerie.test.ts` (le classement dit au cabinet, jamais au client) ; preuves
  `messages 1.336.0 a-j`, et « « Saisir cette pièce » qui ne mène pas à la saisie » vise le code d'aujourd'hui.

Et le rouge GitHub de la 1.334.1 : `tests/web/relances-cabinet-1334.test.ts` attendait « 1 a envoyé des pièces, à
classer » sur une machine chargée — les pièces arrivaient après la page des Relances, qui ne se redessinait pas. C'est
le défaut que la 1.335.0 corrige (poussée avec cette version).

À VÉRIFIER : une pièce saisie depuis le fil prend la date de son arrivée, comme depuis « Pièces reçues » (la saisie le
dit : « mets celle de la facture ») ; reste à jouer une pièce arrivée en janvier pour une facture de décembre (quel
exercice s'ouvre). « Saisir les N pièces » (plusieurs photos d'un coup) ne compte plus les pièces classées, mais n'a pas
son propre test.

## Le pont des Messages, côté client : la photo saisie par le cabinet (1.337.0)

Vu en relisant la 1.336.0 du côté de Sarra : sous IMG_8790-bis.jpg, que Leïla venait de saisir et de joindre à son
écriture, « Mon comptable » proposait encore « Ranger dans mes achats… ». Rangée, la facture serait entrée dans les achats
de la boulangerie — donc dans ses livres — à côté de l'écriture du cabinet : deux fois.

Ce qui est fait :

- Le serveur dit au fil du client un seul fait : la photo est jointe par son cabinet à une écriture. Le client le voit
  déjà dans son classeur (« Ce que ton cabinet a rangé : IMG_8790-bis.jpg, jointe à ton achat FS-2026-0812 ») ; le reste
  du rangement du cabinet (en double, rien à saisir, illisible…) ne lui parvient pas.
- Sous la photo : « Lue · saisie par ton cabinet », et plus « Ranger dans mes achats… » (ni « Joindre à l'achat… »). Une
  photo que personne n'a saisie se range comme avant.
- Joué à la souris (Sarra, après la saisie de Leïla) ; la preuve : `tests/messagerie/messagerie.test.ts` (le fait pour
  la photo jointe, rien pour le ticket classé en double), `tests/web/messages-cabinet-1336.test.ts` (côté Yasmine : la
  facture saisie ne se range plus, le ticket oui) ; preuves `messages 1.337.0 a-d`.

À VÉRIFIER : une page « Mon comptable » restée ouverte avant la saisie du cabinet propose encore « Ranger » jusqu'à sa
prochaine lecture du fil ; le serveur ne refuse pas le rangement, qui suit l'enregistrement de l'achat. Une pièce classée « Déjà saisie » ou « En double » par le cabinet se
range encore côté client.

## Le Tableau de bord du Cabinet, et le pont (1.338.0)

Joué à la souris (Leïla, le portefeuille de l'exemple, au 9 novembre) : la campagne d'octobre, la grille des dossiers, la
fiche d'un mois, « Quand les pièces arrivent », la charge de chacun, les prochaines dates.

Ce qui se contredisait :

- Cinq clients avaient envoyé leurs pièces d'octobre par « Mon comptable » (Café Dar Zitouna, Pharmacie El Menzah,
  Institut Yasmine, Studio Photo Lumière, Atelier Numérique Sfax). La campagne les disait « Sans pièces » (9), la grille
  « pièces manquantes », et « Quand les pièces arrivent » « aucune pièce depuis 5 mois » pour Café — pendant que « À faire »
  disait, dix centimètres plus haut, « 2 pièces reçues, à classer ». Le panneau des arrivées ne comptait que les ventes,
  les achats et les relevés saisis dans SkanFact : un client qui n'envoie que des photos n'y arrivait jamais.
- « 0 sur 12 · 10 pas encore prêtes » : les deux personnes physiques (Studio Photo, Institut Yasmine), dues le 15/11 —
  avant les autres —, n'étaient dites nulle part dans la campagne ; seules « Les prochaines dates », en bas de page, les
  nommaient.
- La date limite de la campagne se lisait sur le premier dossier de la liste : un dossier trimestriel en tête, et la
  campagne d'octobre aurait annoncé le 28 janvier.

Ce qui est fait :

- La règle du classeur (1.239.1) vaut au tableau de bord : un mois sans écriture dont les pièces sont arrivées est
  « à saisir », pas « sans pièces ». Le mois d'une pièce : celui où le cabinet l'a rangée ; sinon le mois d'avant son
  arrivée, tant qu'il est de la mission et pas déposé (le client envoie en novembre les tickets d'octobre) ; sinon celui de
  son arrivée. La grille, la campagne, les puces (« Pièces manquantes 5 », « À saisir 7 »), la charge de chacun et le menu
  ⋯ (plus de « Relancer » pour un mois dont les pièces sont là) lisent la même règle.
- La fiche d'un mois dit « Pièces reçues · 2 pièces reçues, à classer », et son bouton vert « Classer les 2 pièces » ouvre
  les pièces du client.
- « Quand les pièces arrivent » compte aussi les photos envoyées par « Mon comptable » et les pièces que le cabinet dépose
  pour un client (WhatsApp, e-mail, papier), dans leur mois, par la même règle ; une pièce « en double » n'arrive pas deux
  fois. Sur l'exemple : 5 clients après le seuil ou rien du tout, au lieu de 10.
- La campagne nomme les personnes physiques : « aucune prête à déposer · 10 pas encore prêtes · 2 personnes physiques au
  15/11, dans 6 jours » (« déjà en retard » passé le 15) ; sa date limite est la plus proche des dossiers mensuels.
- La preuve : `tests/web/tableau-de-bord-1338.test.ts` (une photo de Café, une pièce déposée pour la librairie, un garage,
  un studio photo personne physique, un atelier trimestriel) ; preuves `tableau 1.338.0 a-l`.

À VÉRIFIER : une pièce envoyée sans mois se range au mois d'avant son arrivée tant qu'il n'est pas déposé — la règle du
classeur ; un ticket du jour envoyé le jour même se compte donc au mois d'avant, jusqu'à ce que le cabinet le range.
« Quand les pièces arrivent » compte une pièce déposée par le cabinet au jour du dépôt, pas au jour où le client l'a
envoyée sur WhatsApp. Les chiffres du jeu d'exemple (les achats de la boulangerie, tous saisis le jour de la création de
l'exemple) font dire à la boulangerie « plus d'un mois après » : c'est l'exemple, pas la règle.

## Deux rouges GitHub qui n'étaient pas des défauts de l'application (1.338.1)

- 1.335.0 : `tests/web/cabinet-saisie.test.ts` (une écriture validée pas vue en 10 secondes). Rien dans la version ne touche
  la saisie ; le test passe cinq fois ici, dont trois en même temps, et il est repassé sur GitHub avec la 1.338.0. Pas de
  cause trouvée : À VÉRIFIER s'il revient.
- 1.338.0 : `tests/web/devis-1307.test.ts` lisait la pièce enregistrée au serveur dès que l'écran disait « Envoyé », sans
  attendre l'enregistrement. Prouvé en ralentissant d'une seconde et demie les envois au serveur : l'ancienne lecture tombe
  exactement comme sur GitHub (« [devis] » au lieu de « [devis, devisModifie] »), la nouvelle, qui attend, passe.

## La fiche du dossier et le classeur du Cabinet, et le pont (1.339.0)

Joués à la souris sur l'exemple, comme Leïla qui ouvre la boulangerie : la fiche (identité, mission, historique, relances),
puis le classeur mois par mois, et une attestation envoyée par Sarra depuis « Mon comptable ».

- L'historique de la fiche datait une déclaration déposée de sa date limite : « Juillet déposé » le 28/08 quand le dépôt
  avait été pointé le 26/08. Il prend le jour du dépôt ; la date limite n'est plus qu'un repli quand le jour n'est pas connu.
- Une attestation, un contrat, une assurance envoyés par le client : la ligne du classeur disait « à ranger » (geste
  « Ranger »), et le panneau de droite disait « À saisir : c'est une dépense nouvelle » avec « La saisir dans Écritures ».
  Le panneau dit maintenant « À ranger : ce n'est pas un achat », son geste principal est « La ranger… » (il ouvre les
  pièces du client, où elle se range au dossier permanent ou se classe sans saisie) ; « La saisir quand même » reste à côté,
  si le nom trompe.
- Le pont, côté client : rien ne change dans « Mon comptable » — le client envoie, le cabinet range ; le client voit la
  pièce rangée comme avant.
- La preuve : `tests/web/classeur-1339.test.ts` (septembre déposé le 25/10 pour une limite au 28/10, une attestation CNSS
  envoyée par la boulangerie) ; preuves `classeur 1.339.0 a-c`.

À VÉRIFIER : le genre « document » se devine sur le nom du fichier (attestation, contrat, bail, statuts, assurance,
registre, patente) ; une facture nommée « contrat-maintenance.pdf » se dira « à ranger » — d'où « La saisir quand même ».

## Le portefeuille du Cabinet (« Tous les dossiers »), et le pont (1.340.0)

Joué à la souris sur l'exemple, comme Leïla le 9 novembre : la liste, ses vues, le menu d'une ligne, « Ajouter un
client… », l'archivage.

- « Pièces manquantes » annonçait 10 clients et mettait « Relancer » sur chacun. Cinq avaient envoyé leurs pièces par
  « Mon comptable » (elles attendaient dans « Pièces reçues ») ; trois étaient « en retard » parce que le CABINET n'avait
  pas déposé : leurs écritures étaient là, et la relance partait vide (« Bonjour Sami, »). La vue ne réclame plus qu'un
  mois dont rien n'est arrivé — la règle des Échéances (`manquants`) et celle des Relances (un client qui a envoyé n'est
  pas « à relancer ») : 2 clients sur l'exemple, tous deux relancés le matin même.
- Sous le mois, la ligne d'un client qui a envoyé dit « 4 pièces reçues, à classer », un lien vers ses pièces ; un mois
  sans écriture dont les pièces sont arrivées se dit « à saisir », et non « sans pièces ». Son menu propose « Classer ses
  pièces » ; « Relancer… » ne s'offre qu'à qui doit quelque chose.
- La vue dit ceux qu'elle écarte (« Café Dar Zitouna a envoyé des pièces : elles attendent d'être classées. Les
  classer »), et « Relancer le premier… » devient « Relancer le suivant… » : il saute le client relancé aujourd'hui.
  Quand tous l'ont été, le bouton se tait.
- « Ajouter un client… » créait « garage triki » à côté de « Garage Triki » sans un mot. Même nom (casse, accents et
  ponctuation mis à part) ou même matricule : la question avant de créer — « Ouvrir son dossier », « Créer quand même »
  (deux homonymes existent), ou revenir.
- « Archiver le dossier… » ouvrait la fiche en haut, la case « Dossier archivé » douze champs plus bas : elle est
  amenée à l'écran, le curseur dedans (la ligne, la fiche, son menu).
- Le pont : la liste se redessine quand des pièces arrivent (comme les Relances et les Échéances), jamais sous une
  fenêtre ni pendant qu'on tape. Rien ne change côté client.
- La preuve : `tests/web/portefeuille-1340.test.ts` (un client relancé le matin, un qui envoie une photo, un dont les
  écritures sont là, un qui n'a rien envoyé ; le doublon ; l'archivage) ; preuves `portefeuille 1.340.0 a-i`.

À VÉRIFIER : « Pièces manquantes » écarte un client dès qu'une pièce attend d'être classée, même s'il ne les a pas toutes
envoyées — la règle des Relances : on classe avant de relancer.

## L'export des écritures du Cabinet, et le pont (1.341.0)

Joué à la souris, comme Leïla qui sort les écritures du mois pour son logiciel : la période, ce qui manque, le fichier.

- La page s'ouvrait sur novembre — le mois en cours, pas fini —, et « Le dernier mois » y ramenait. Elle s'ouvre sur le
  dernier mois FINI qui a des écritures (octobre), et le bouton s'appelle « Le dernier mois fini » (U-12).
- « 11 clients n'ont aucune écriture sur cette période … Les relancer » mélangeait trois cas. La liste les sépare : tenu
  au cabinet (« à saisir par toi »), des pièces reçues par « Mon comptable » (« à classer », avec le lien), rien reçu
  (« Les relancer »). Sur le mois en cours, rien ne se relance : « Le mois n'est pas fini ». La même règle que le
  portefeuille (1.340.0).
- « Mois de livres : 1 · 1 mois » se lit « 1 sur 1 mois » : le nombre de livres mensuels, et sur combien de mois.
- Le fichier, ouvert : les sept lignes de la paie d'octobre de la boulangerie, débit et crédit égaux (2 228,695), le
  client, le matricule et le mois devant chaque ligne.
- La preuve : `tests/web/ecritures-1341.test.ts` (un garage qui a des écritures le mois fini et ce mois-ci, un café qui
  envoie une photo, une librairie qui n'envoie rien, une menuiserie tenue au cabinet) ; preuves `écritures 1.341.0 a-d`.

## La Saisie d'un dossier au Cabinet, et le pont (1.342.0)

Joué au clavier et à la souris, comme Leïla puis Anis qui saisissent les pièces d'un client, une à une, face à la pièce.

- Anis révise SARL Mansour Distribution : la fiche ne lui proposait qu'« Enregistrer au brouillard », et « La direction
  valide le brouillard ». Le serveur nomme ce droit « revision », le pont le rend « validation » ; l'écran ne
  reconnaissait que le premier mot. Les deux valent : il valide, et le serveur l'y autorisait déjà.
- Sur un dossier qui n'a encore aucun achat taxé, la liste de TVA ne proposait que « Sans TVA » et « Autre taux… » : 19 %
  passait par une saisie libre. Les taux que SkanFact propose aussi au client (7, 13, 19 %) y sont toujours, le chiffre
  en tête (« 19 % de TVA ») : taper « 19 » le choisit. « Autre taux… » reste ouvert (la liste propose, elle n'enferme pas).
- Taper « Sans » dans la TVA s'arrêtait à « S » : la fiche se redessinait à chaque touche. Pendant le choix, seule
  l'écriture suit ; la fiche se redessine quand on quitte la liste.
- « ↵ enregistre, valide et ouvre la pièce suivante » : la pièce suivante s'ouvrait hors de l'écran (la page restait sur
  le brouillard), et le curseur restait sur la page — la frappe suivante partait dans un raccourci (« N » ouvrait
  « Nouveau dossier client »). La barre « Pièce 1 sur 2 » revient sous les onglets, le curseur dans le fournisseur.
- La date proposée (celle de l'arrivée) ne se remplaçait pas : « 31/10/2026 » devenait « 31/10/202602/10/2026 ». Le champ
  rendu avec sa valeur la sélectionne ; et sa note « date d'arrivée : mets celle de la pièce » s'efface quand on tape.
- Un ticket payé en espèces n'avait aucun geste : le fournisseur restait dû pour toujours. « Payée en espèces, le jour de
  la pièce » écrit son règlement en caisse (54), le même jour.
- La colonne « Par » du brouillard disait « le cabinet » pour tout le monde. Le serveur rend `saisiePar` (un identifiant
  d'utilisateur, rien d'autre) ; l'écran nomme le collaborateur qui a saisi.
- « 1 écriture · elles n'entrent dans aucun chiffre… » : le singulier. Et un « … » court du message passager ne se
  coupe plus après son guillemet (« Déclarer et clôturer »), sans changer un caractère du texte.
- Le rouge GitHub de la 1.341.0 : l'export des écritures se dessinait avant l'arrivée des pièces reçues (une machine
  lente), rangeait le café dans « Rien reçu » et ne se redessinait jamais. Il se redessine quand elles arrivent, comme
  les Relances et le portefeuille ; `ecritures-1341` ralentit désormais leur lecture de deux secondes et demie.
- La preuve : `tests/web/saisie-1342.test.ts` (Anis, au clavier, sur un café qui envoie deux pièces) ; preuves
  `saisie 1.342.0 a-o`.

## La Banque d'un dossier au Cabinet, et le pont (1.343.0)

Jouée à la souris et au clavier sur la Boulangerie El Amal : un relevé BIAT de septembre, une question posée à Sarra sur
un chèque, sa réponse, puis les quatre proposées, les deux lignes à règle et le plein de carburant, jusqu'à l'état de
rapprochement en PDF.

- L'annonce d'un geste (« Rapprocher », « Écrire et rapprocher ») naissait au-dessus de la liste et poussait le bouton
  qu'on allait viser. La bande a sa place réservée : au repos elle rappelle les touches (↑ ↓, Espace, Entrée, /, ⋯), et
  l'annonce la prend à la même hauteur — la liste ne bouge plus d'un pixel.
- Une ligne au panneau haut (une remise de chèques) mettait « Rapprocher » sous le bas de l'écran : Entrée agissait hors de
  la vue. La rangée des gestes du livre en face colle au bas de la page.
- Filtrer sur « En attente de Sarra » laissait le panneau de droite sur un virement que le filtre cachait — et Entrée l'aurait
  rapproché. La ligne choisie est toujours une ligne montrée. Une pastille à zéro est éteinte ; un filtre que le geste a
  vidé se lève, au lieu de « Aucune ligne dans cet état ». La pastille choisie le reste sous le curseur (le survol la
  repeignait comme éteinte).
- Le pont : Sarra répond « C'est le chèque au fournisseur de farine, la Minoterie ». Le panneau disait encore « Tant qu'il
  n'a pas répondu » sous sa réponse ; il dit « Sa réponse est là ». La fenêtre cherchait le nom ENTIER du fournisseur
  (« Minoterie du Cap Bon ») et s'ouvrait sur « 101 Capital social » : elle reconnaît maintenant le nom entier, le numéro
  d'une pièce du livre, ou un mot du nom qu'aucun autre tiers ne porte (« Sahel » nomme deux fournisseurs : personne).
  Le compte 401 et le nom du fournisseur sont proposés, et partent sur la ligne pour le lettrage.
- Entrée dans la liste des comptes choisissait 606 ET enregistrait la fenêtre, avant qu'on ait relu le mot retenu. Une
  Entrée qu'un champ a déjà prise ne valide plus la fenêtre — la règle de l'app entreprise, portée au Cabinet.
- « Écrire d'après sa réponse » finissait sur un message en bas de l'écran, le panneau sur la ligne terminée ; il
  s'annonce dans la carte et choisit la ligne suivante, comme « Rapprocher ».
- « Revoir septembre » montrait le panneau d'une ligne repliée : quand tout est rapproché, les lignes se déplient.
- L'état de rapprochement en PDF sortait avec l'ombre de la carte d'écran, collé au bord droit de l'A4 : la feuille se pose
  à plat. Un numéro de facture (« FA-0901 ») ne se coupe plus à son trait d'union, et le guillemet fermant ne part plus
  seul à la ligne.
- La preuve : `tests/web/banque-1343.test.ts` (un client qui répond par le pont, un relevé de quatre lignes, trois
  fournisseurs dont deux « du Sahel ») ; preuves `banque 1.343.0 a-j`.
- Le rouge GitHub de la 1.342.0 : deux tests décrivaient l'état d'avant mes versions — `cabinet-ecritures` attendait le
  client sans écriture nommé seul (la 1.341.0 dit « Tenu au cabinet, à saisir par toi »), `mois-client` un mois « à
  réviser » sans la photo du client, qui reste à classer chez le cabinet (1.338.0). Retournés vers la règle.

## La Paie d'un dossier au Cabinet, et le pont (1.344.0)

Jouée à la souris et au clavier sur la Boulangerie El Amal : la paie d'octobre (deux salariés sans n° CNSS), les deux
bulletins validés, l'écriture de paie, la déclaration du mois, la CNSS du trimestre, l'année — puis Sarra qui répond à la
demande du n° CNSS de son côté, et le cabinet qui le reporte sur la fiche.

- Le contrôle « 2 salariés sans n° CNSS » portait quatre boutons (« Le demander » et « Le renseigner » par salarié), et
  rien ne disait que la demande était déjà partie. Une seule demande pour tous les numéros qui manquent ; celle qui est
  partie se dit (« Demandé à Sarra le 10/11 »), et la réponse aussi (« Sarra a répondu le 10/11 : « 12345678-90 » »).
- « La valider dans la saisie » menait au brouillard d'une grille de trente-trois pièces, où il fallait retrouver la
  sienne. L'écriture de paie a son étape dans « Les bulletins sont faits », entre les salaires et la déclaration, et se
  valide en place, par la même question que la grille. Un seul vert : remettre les bulletins d'abord, puis l'écriture.
- « 2 entrées » sous le coût du mois se lisait comme deux écritures : « 2 embauches ce mois ». « Salaires payés · payés »
  disait deux fois la même chose.
- L'année disait 1 850 DT de salaires sur un exercice qui en porte 31 854 au 640 : la paie de janvier à juillet avait été
  passée au journal, avant que le cabinet ne fasse les bulletins ici, et le contrôle l'accusait d'être « une écriture
  passée hors de la paie ». Un mois SANS bulletin ici dont le 640 bouge a sa paie ailleurs (au journal, ou faite par le
  client dans SkanFact) : le tableau le dit (« au journal », « au brouillard »), le contrôle l'ajoute (« égaux au
  millime »), la masse salariale dit le total de l'exercice. Un 640 qui bouge dans un mois QUI A ses bulletins reste un
  écart, et le dit.
- La CNSS du trimestre : un trimestre en cours proposait « Déposée ? Range son accusé » dix lignes au-dessus de « on le
  déclare une fois terminé » ; il ne le propose plus. Le fichier disait « Ouvrir la fiche de Amira », puis une seconde
  ligne et un second bouton pour la même fiche : une ligne par salarié (son refus, puis « Aussi : son identité CNSS
  reprend le nom de sa fiche »), « la fiche d'Amira », et la demande déjà faite au client.
- Le pont : une demande ne se réglait qu'avec une photo ou une pièce du dossier — Sarra devait photographier un numéro
  qu'elle pouvait écrire, ou l'écrire dans un message pendant que la demande restait « à envoyer » et se relançait. La
  fenêtre de réponse propose « Je l'écris » (choisi d'avance quand la demande nomme un numéro), la base l'accepte
  (migration 0208 : une réponse écrite, choisie exprès et non vide ; un « la voilà » sans fichier reste refusé), et la
  réponse revient au cabinet avec la demande. « Renseigner Hédi… » ouvre sa fiche le numéro proposé dans sa case, avec sa
  provenance : il reste à le vérifier et à enregistrer.
- La preuve : `tests/web/paie-1344.test.ts` (un dossier tenu au cabinet, la paie de janvier passée au journal, une
  salariée sans n° CNSS) et `tests/messagerie/messagerie.test.ts` (la réponse écrite) ; preuves `paie 1.344.0 a-h`.
  `cabinet-pas-avant-son-jour` et `cabinet-paie-parcours` retournés vers la règle (l'écriture se valide en place ; un
  trimestre en cours ne propose pas son accusé ; le vert passe à l'écriture une fois les bulletins remis).

## Les Immobilisations d'un dossier au Cabinet, et le pont (1.345.0)

Joué à la souris : Leïla qui tient le registre de la Boulangerie (un four saisi à la main, puis son achat arrivé au
livre ; une cession ; une camionnette que Sarra a saisie dans son SkanFact), puis la Saisie d'une facture de février.

- **Un achat déjà au registre se RATTACHE à sa fiche.** Une fiche saisie à la main, puis l'achat de même montant au
  223 : l'écran proposait en vert « Créer la fiche du bien… », un clic et le four s'amortissait deux fois. Une seule
  fiche libre de même valeur (`ficheARattacher`) propose « Rattacher à « Four à sole électrique »… » ; la fenêtre dit
  le compte que la fiche prend (celui que l'achat a débité, pour que la sortie crédite le même), ou qu'elle garde le
  sien si ses écritures sont passées, et offre « Non, un autre bien… ». Deux candidates : c'est au comptable de choisir.
- **La dotation d'un bien sorti se date du jour de sa sortie** (`ecrituresImmobilisations`), comme dans l'app
  entreprise : datée du 31/12 après une sortie au 30/09, elle laissait le 28 débiteur d'octobre à décembre.
- **Une sortie annonce sa plus ou moins-value avant d'enregistrer**, par `resultatCession` (celle du plan), à la
  place de « première dotation, dernière, VNC finale » qui ne dit rien d'un bien qu'on sort.
- **La famille propose son compte** (`compteDeFamille` : 2283, 213, 2282, 2284, 223, 224, 228, 222 — À VÉRIFIER)
  comme sa durée, tant qu'on n'y a pas touché ; la fiche reprise du client garde sa famille (le pont la transmettait,
  `ficheDuClient` la perdait).
- « Voir le plan d'amortissement » amène le plan à l'écran ; un seul vert sur l'état vide ; une invite neutre.
- **La Saisie dit la période validée avant le geste.** Une pièce du 20/02 dans une période validée jusqu'au 31/07
  n'était refusée qu'au clic (« Enregistrement impossible », Fermer seul) sous un encadré qui promettait le contraire.
  Le serveur rend `valideJusqua` avec les exercices, le pont le pose sur le livre, `verdictSaisie` éteint les deux
  boutons en disant « Date-la du 01/08/2026 ou après » ; l'encadré « déjà déclaré » se tait dans cette période.
- Le pont, joué : la camionnette saisie par Sarra paraît au Cabinet avec son plan (5 250 DT), « Reprendre sa fiche »
  donne « même plan » ; sortie ici, l'écart se dit (« sorti le 31/10/2026 ici, toujours à l'actif chez le client »).
- Tombé : le plan en direct de « Ajouter un bien » existait déjà ; le contrôle « tableau ↔ 28 » existe à la clôture.
- La preuve : `tests/web/immobilisations-1345.test.ts` ; preuves `immos 1.345.0 a-l` ; la preuve « la ligne au
  compte 22 ignore la fiche que le client a déjà » réancrée.

## L'Inventaire d'un dossier au Cabinet, et le pont (1.346.0)

Joué à la souris des deux côtés : Leïla qui prépare l'inventaire de la Boulangerie, et Sarra (la cliente) qui reçoit
la demande dans « Mon comptable ».

- **L'état du stock se DEMANDE au client relié** au lieu de se recompter. Le pont existait (1.319.0 : le client envoie
  son état, le Cabinet le reprend d'un geste), mais rien ne le réclamait : sans état reçu, l'écran n'offrait que
  « Saisir l'inventaire… ». Le panneau « L'état du stock de … » propose « Lui demander son état du stock… » (le vert
  quand rien n'est saisi) ; la demande dit le chemin chez lui (Stock, onglet Inventaire, « L'état du stock pour ton
  comptable »), et ce qu'il fait s'il ne suit pas son stock dans SkanFact (sa liste, une photo). Avant la fin de
  l'exercice, elle est pour le premier jour ouvré après le 1er janvier (férié) ; l'aide dit où arrive l'état, pas
  « sa photo arrive dans Pièces reçues ». Demandé, le panneau le dit (« Demandé le …, pour le … »).
- **Côté client, la carte de la demande mène au geste** : « Envoyer mon état du stock… » ouvre sa page Stock, onglet
  Inventaire, à la date demandée — rien à photographier. **L'envoi à cette date RÉPOND à la demande** (elle passe
  « reçue », comme une réponse écrite, 0208). Une date pas encore passée ne s'envoie pas : le stock peut encore bouger.
  Sans article suivi, la carte reste « Envoyer la pièce… » : la page Stock serait vide (vu à la souris sur la
  Boulangerie, qui ne suivait aucun article).
- **La fenêtre annonce la variation avant d'enregistrer**, par le moteur qui l'écrira (`variationDeStock`) : « Les
  comptes portent 0,000 DT au 37 : variation de +910,000 DT ».
- **Un inventaire dont la variation est déjà écrite dit son refus à l'ouverture** (`poserInventaire`, le même motif,
  avec le geste qui débloque), pas au clic sur « Enregistrer » une fois la saisie faite.
- Une invite neutre (« Référence, Désignation, Quantité, Coût unitaire »).
- Tombé : « 1148,000 DT sans séparateur » — l'espace fine est là (U+202F), seulement étroite à 11 px.
- La preuve : `tests/web/inventaire-1346.test.ts` ; preuves `inventaire 1.346.0 a-k` ; `stock-1319` attend l'annonce,
  et sa preuve « s » est réancrée.
- Le rouge GitHub de la 1.344.0, réglé au passage : deux tests de paie décrivaient l'état d'avant (« Le renseigner
  (Amira)… », et plus aucun vert après la remise alors que l'écriture de paie au brouillard reste l'étape suivante),
  retournés vers la règle ; la ligne du Café dans la liste des clients se lit en attendant le paiement (une lecture
  sans attente, qui tombait en CI).

## Consulter : les livres d'un dossier au Cabinet (1.347.0)

Joué à la souris sur la Boulangerie El Amal : Leïla parcourt le livre-journal, le grand livre, la balance, le lettrage
des clients PUIS des fournisseurs, et cherche une pièce comme on s'en souvient (un fournisseur, un montant arrondi).

- **Le grand livre dit un solde dans le SENS du compte** : « Solde créditeur 526,980 DT » sur le 401, jamais « Solde
  −526,980 DT » ; chaque ligne et le pied d'un compte déplié portent leur montant suivi de D ou C. Un comptable lit un
  solde fournisseur comme créditeur ; le signe moins se lisait comme une anomalie.
- **421 et 425 ne portent plus le même nom** : deux « Personnel — rémunérations dues » dans un même grand livre. Le plan
  propose 421 « Personnel — avances et acomptes » et 425 « Personnel — rémunérations dues » (À VÉRIFIER) ; un compte
  nommé à l'import se renomme à la lecture, un compte nommé par le cabinet jamais. Le jeu d'exemple passe les salaires au
  425. La production reconnaît une écriture de paie sur l'un ou l'autre.
- **Un sous-compte qui n'a pas de nom à lui le dit** : 6066 s'affichait comme 606 ; il se lit « … (détail du 606) »
  quand le 606 est aussi au livre. Un sous-compte nommé (541, 7071) n'est pas touché.
- **Le lettrage nomme ses comptes et ne propose le 411 qu'une fois** (« 411 — Clients », puis « 401 — Fournisseurs
  d'exploitation »…).
- **Le lettrage d'un fournisseur se lit dans le sens du compte** : « Ce qui reste à payer, par ancienneté », « Reste à
  payer 12 600,083 DT », le verdict « … 17 272,484 DT créditeur ». Tout s'affichait en négatif. Côté clients : « Reste
  dû ». Un montant qui reste négatif après coup (une avance au fournisseur) garde son signe : c'est l'exception.
- **La recherche trouve un montant tapé sans ses millimes** : « 1846 » trouve 1 846,199 ; « 1 846,199 » copié de
  l'écran reste une recherche exacte, et l'invite le dit.
- Vu, laissé : les lignes 7071 du livre-journal sans tiers (une donnée du paquet, pas de l'écran) ; « D 0,000 DT » en
  tête d'un compte qui n'a mouvementé qu'un côté (la colonne garde sa place).
- La preuve : `tests/web/consulter-1347.test.ts` ; preuves `consulter 1.347.0 a-g`.
- La passe complète des preuves (sur la 1.344.0) laissait deux preuves vertes : « une clé de l'appareil par lecture »
  tombe ici (une course, rejouée deux fois en CI), et « efacture 1.325.1 h » ne pouvait plus tomber — le nom de la
  dernière migration est devenu court, et le test ne mesurait que la page. `console-versions` pose le nom le plus long
  dans la tuile et mesure chaque tuile.
- `achats-1310` lit la balance âgée des fournisseurs dans le sens du compte (« Ce qui reste à payer », 2 495,430 DT à
  payer, l'avoir de casse −337,960 DT), et attend que la fiche se redessine après le règlement au lieu de la lire à
  l'instant (elle était lue pendant son fondu).

## La Révision d'un dossier au Cabinet, et le pont (1.348.0)

Joué à la souris sur la Boulangerie El Amal : Leïla ouvre les feuilles maîtresses, signe la trésorerie, écrit une note
de revue, prépare l'arrêt de la révision, puis écrit le questionnaire de son cabinet dans les Réglages.

- **Chaque compte tombe dans son cycle.** La table proposée mettait « 43 » au personnel ET au fiscal (à longueur égale,
  le premier gagnait : la retenue à la source sur les fournisseurs, 4352, se révisait avec les salaires), laissait la
  CNSS (4531) « hors cycle », et rangeait les charges financières (65) aux achats. Désormais (À VÉRIFIER) : 43 au fiscal,
  45 et 4321 au personnel, 44 et 65 aux capitaux et emprunts, 63 aux achats.
- **Une table enregistrée telle que SkanFact l'avait proposée suit la proposition du jour.** Enregistrer le
  questionnaire enregistre aussi la table affichée : un cabinet qui n'a jamais touché à ses cycles en gardait une copie
  que la correction n'aurait pas atteinte. Une table changée, même d'un préfixe, reste celle du cabinet
  (`cyclesEcrits`, `cyclesEnVigueur`).
- **Les cartes et la feuille disent leur solde dans le sens du compte** : « 97 121,435 DT créditeur », « 68 107,900 D »,
  comme le grand livre de la 1.347.0 — plus de « −97 121,435 DT ».
- **Une question posée sur un compte dit son solde en mots** (« solde 6,980 DT créditeur », plus « solde −55,500 DT »).
- **« Signer » est un bouton de la ligne** : un clic au lieu de « Actions » puis « Signer ce compte » ; le menu garde
  la note, la question et le retrait de la signature.
- **Arrêter la révision d'un exercice qui court le dit avant** (« L'exercice 2026 n'est pas terminé : il court jusqu'au
  31/12/2026… ») ; « Ces points ne bloquent pas » au lieu d'un « Ils » sans antécédent ; « Poser la question de ton
  cabinet » au lieu de « Poser les 1 question ».
- **La question neuve reçoit le curseur** (et la ligne neuve d'un cycle aussi). Vu à la souris : la frappe partait sur
  la page, « N » ouvrait le menu « Créer », un « é » choisissait « Écriture », et la question finissait dans la pièce
  d'une écriture de la Saisie.
- Vu, laissé : la colonne « Identifiant » des cycles dans les Réglages (technique, mais modifiable par le cabinet).
- La visite « Réviser » fait signer par le bouton de la ligne, et le bouton a son explication.
- La preuve : `tests/web/revision-1348.test.ts` ; preuves `révision 1.348.0 a-k`.

## L'exercice et la clôture d'un dossier au Cabinet (1.349.0)

Joué à la souris sur la Boulangerie El Amal et les autres dossiers de l'exemple : l'onglet Exercice (contrôles avant
clôture, états financiers, soldes intermédiaires, à-nouveaux), la clôture et le dossier remis au client.

- **Le jeu d'exemple ne se contredit plus** : sur chacun de ses douze dossiers, le contrôle « Les déclarations et le
  livre d'aujourd'hui » annonçait que les déclarations déposées ne correspondaient plus au livre (« TVA collectée :
  341,132 DT → 0,000 DT ») — des montants inventés, qu'aucune vente du livre ne portait. Chaque mois déclaré porte
  désormais la vente qui fait sa TVA ; la boulangerie, dont le livre est tenu au cabinet, déclare ce que ses écritures
  disent (collectée, déductible des achats du client, crédit reporté). Un faux signal au premier regard d'un comptable
  sur la vitrine.
- **« Clôturer l'exercice… » ne s'offrait que pour refuser** : sur un exercice qui court encore (2026 en novembre), le
  bouton paraissait actif ; le clic répondait par un message de deux secondes. Il est désormais éteint, et sa raison
  s'écrit dessous, avant le clic : « L'exercice 2026 n'est pas fini : il se clôture à partir du 01/01/2027. » — ou le
  nombre de pièces encore au brouillard. Une seule fonction (`motifPasDeCloture`) dit les deux, pour le bouton et sa
  phrase ; le bouton éteint perd sa couleur (un vert ne se promet pas sur un geste impossible).
- **« Le dossier pour le client… » n'est plus offert en ligne** : le fichier de clôture s'écrit sur le disque d'un poste,
  ce que la version en ligne ne fait pas. Le bouton n'est posé que si le pont sait l'écrire (`ecrireCloture`).
- Vu, laissé : les états financiers et les soldes intermédiaires de la boulangerie tombent juste (valeur ajoutée, EBE
  recalculés à la main) ; « Ouvrir 2027 (à-nouveaux)… » reste offert, ce qui est voulu (on prépare l'exercice suivant
  avant la clôture du précédent).
- La preuve : `tests/web/cloture-1349.test.ts`, `tests/web/cabinet-cloture.test.ts` (le brouillard dit sous le bouton
  éteint) ; preuves `clôture 1.349.0 a-d`, et l'ancienne preuve du brouillard ré-ancrée sur la règle.

## La Déclaration d'un dossier au Cabinet (1.350.0)

Joué à la souris sur la Boulangerie El Amal : la déclaration d'un mois déposé (juillet), puis août de bout en bout —
valider le brouillard, préparer, écrire l'écriture du mois, la valider, marquer déposée, marquer payée.

- **Un crédit de TVA que l'entreprise n'a jamais eu** : septembre annonçait « Crédit du mois précédent 2 505,389 DT »
  alors que chaque mois de janvier à juillet était à payer. Le crédit se lit sur le 4366 (la règle depuis toujours),
  ce qui suppose que chaque mois précédent a passé son écriture de déclaration — c'est elle qui retire du compte la TVA
  déductible déjà imputée. Quand la TVA collectée (4367) n'est pas soldée à l'ouverture du mois, le crédit se refait
  maintenant d'une déclaration à l'autre, mois par mois, et la case le dit ; quand le compte est tenu, il fait foi (un
  crédit remboursé ne se reporte plus). C'est un chiffre que le comptable recopie sur le portail. À VÉRIFIER avec le
  comptable : la règle du report quand un mois d'avant n'a pas été déclaré du tout.
- **Le jeu d'exemple passe ses écritures de déclaration**, comme un cabinet le fait chaque mois : les sept mois tenus de
  la boulangerie avant la validation de sa période, et chaque mois déposé des autres dossiers.
- **Deux mois sur la même page** : cliquer « juil. » dans la frise passait la période à juillet et laissait la
  déclaration de septembre à l'écran. Un mois de la frise ouvre sa déclaration ; le mois choisi dans la liste déplace
  la frise et la période ; et la frise cercle le mois déclaré dès l'ouverture (comme le mois du relevé sur la Banque).
- **L'écran s'ouvrait sur le dernier mois saisi** (septembre) pendant qu'août, en retard, attendait : quand des mois
  sont déjà déposés, il s'ouvre sur le plus ancien mois fini qui a des écritures après le dernier dépôt.
- **Le vert sautait une étape** : l'écriture du mois créée au brouillard, le message disait « relis-la, puis Valider
  l'écriture du mois » et le bouton vert était « Marquer déposée ». Le vert est sur la validation.
- **L'écran reste sur son mois** : après « Marquer déposée », le mois proposé change ; l'écran, lui, garde le mois qu'on
  travaille, où « Marquer payée » attend (défaut né de la règle d'ouverture ci-dessus, vu à la souris dans la minute).
- Vérifié à la main sur août : 1 195,168 collectés (hôtel 157,336 + caisse 1 037,832), 430,155 déductibles (quatre
  achats du client), 765,013 à payer ; les douze dossiers de l'exemple gardent « Les déclarations et le livre
  d'aujourd'hui : rien à signaler ».
- Vu, laissé : l'état « saisi » reste affiché après « Préparée » (la préparation n'est pas un état du mois, c'est la
  rangée d'étapes qui la dit).
- La preuve : `tests/moteur/declaration-report-1350.test.ts`, `tests/web/declaration-1350.test.ts`,
  `tests/web/cabinet-declaration.test.ts` ; preuves `déclaration 1.350.0 a-k`.
- **Le rouge GitHub de la 1.348.0** (`cabinet-guides`, une machine sur quatre) était un vrai défaut de la Saisie : deux
  choix de journal qui se suivent sans attendre — les flèches du clavier sur la liste — partaient tous sur la même
  révision de la fiche ; le second était refusé en silence, et le dossier retenait un journal périmé. Ils s'écrivent
  maintenant l'un après l'autre (une file dans le pont). Le test pose trois choix dans le même instant : il ne dépend
  plus de la vitesse de la machine. Preuve `déclaration 1.350.0 l`.

## La Liasse d'un dossier au Cabinet (1.351.0)

Jouée à la souris sur la Boulangerie El Amal : bilan, état de résultat, résultat fiscal (un taux saisi, une
réintégration ajoutée), déclaration annuelle d'employeur.

- **Les retenues sur fournisseurs lues sur un compte que rien n'écrit** : la déclaration annuelle d'employeur lisait
  le 4322 ; tout le logiciel écrit une retenue opérée au 4352 (la déclaration du mois, la Banque). La case répondait
  « Aucun mouvement sur 4322 » à un dossier qui avait retenu toute l'année. Elle lit le compte du rôle, comme l'IRPP.
  Le test du moteur posait sa retenue au 4322 : il décrivait le défaut, il suit la règle.
- « Enregistrer le taux » flottait neuf pixels au-dessus de sa case : il est aligné sur elle.
- Vérifié à la main : bilan équilibré (106 120,100 des deux côtés), résultat 79 242,741 ; impôt à 15 % = 11 886,411 ;
  avec 500 réintégrés, résultat fiscal 79 742,741 et impôt 11 961,411.
- La preuve : `tests/web/liasse-1351.test.ts`, `tests/moteur/paie-declaration-employeur.test.ts` ; preuves
  `liasse 1.351.0 a-b`.

## La pagination dans toutes les listes (1.352.0)

Demande de Skander : « n'oublie pas la pagination dans toutes les listes ». Mesuré, pas relu : un dossier plein au
Cabinet (890 écritures, un relevé de 400 mouvements, 120 biens, un inventaire de 300 lignes) et une entreprise pleine
(300 clients, 1 800 pièces, 700 achats, 80 affaires, 90 listes de prix), puis chaque écran et chaque onglet visités, et
toute liste de plus de soixante lignes sans pied de page relevée.

**Au Cabinet**, sept listes s'affichaient d'un seul tenant :

- **la Banque** : 400 mouvements, vingt écrans. Cinquante par page ; les groupes gardent leur compte entier ; les
  flèches ↑ ↓ passent d'une page à l'autre, et la page tournée choisit sa première ligne ;
- **les Immobilisations** (120 biens) et **l'Inventaire** (300 lignes) : le pied garde le total de TOUTE la liste ;
- **les à-nouveaux** de l'exercice suivant (779 lignes), la section reste ouverte quand la page tourne ;
- **les pièces d'une case** de la déclaration ;
- **la Recherche** coupait aux 200 premières (« précise ta recherche ») : elle rend tout ce qui correspond, et se
  feuillette ; changer de filtre repart de la première page ;
- **le Classeur** : « Ce qui manque » (266 lignes), « À traiter, dans l'ordre », une rubrique dépliée, et les pièces d'un
  exercice — qui coupaient à quarante sans le dire. Une page par liste ; elle suit la pièce choisie.

Vu à l'écran au passage : sous **chaque** tableau du Cabinet, « 25 par page » s'étirait sur toute la largeur, seul sur
sa rangée (1 193 px). Il prend la largeur de son texte.

**Dans l'app entreprise**, sept autres :

- **Marges** : les affaires (80) et la rentabilité des contrats ; chercher repart de la première page ;
- **la fiche d'une affaire** : ses ventes, ses achats, ses heures (seize écrans pour 300 pièces) ;
- **les fiches client et fournisseur** : paiements, factures en retard, relances faites, affaires, contrats, matériel ;
  règlements, commandes, retenues — un seul mécanisme (`feuilletFiche`), une page par liste et par fiche ;
- **les listes de prix**, et **les prix d'une liste** : le rang d'une ligne reste celui de toute la liste (retirer la
  vingt-sixième retire la vingt-sixième), « + Article » amène à la dernière page, un refus montre sa ligne ;
- **les Immobilisations** : le tableau, les lignes à immobiliser, les sorties.

Laissés tels quels, et pourquoi : le grand livre du Cabinet (chaque compte est replié, et montre 300 lignes puis
« Montrer 300 lignes de plus ») ; le sélecteur de clients d'une liste de prix (une boîte de choix à hauteur fixe, avec
sa recherche) ; les grilles de saisie d'une pièce.

Deux preuves que la machine de GitHub n'avait pas su prouver sur la 1.350.0, rendues indépendantes de la machine :

- le journal retenu : trois choix partis ensemble arrivent au serveur dans un ordre que la machine décide. Le test
  compte les écritures de la fiche **refusées** (aucune avec la file, deux sans) ;
- le refus du pont avant de refaire un inventaire : depuis la 1.346.0 le bouton est éteint, le test n'atteignait plus
  le pont. Il l'appelle, et vérifie qu'aucune écriture ne part vers le serveur (qui répond la même phrase).

- La preuve : `tests/web/pagination-1352.test.ts` (Cabinet), `tests/web/pagination-entreprise-1352.test.ts` ; preuves
  `pagination 1.352.0 a-q`.

## La pagination, suite (1.352.1)

La première mesure n'avait pas rempli tous les écrans. Reprise sur un cabinet de 163 dossiers, onglet par onglet, puis
les fenêtres et les pages de réglage qui portent une liste.

- **Le tableau de bord, onglets « Révision » et « Bilans »** : les 163 dossiers s'affichaient d'un seul tenant (dix
  écrans). Vingt-cinq par page ; la ligne « Le cabinet » garde le total de tout le portefeuille ; changer d'onglet, de
  filtre ou de recherche repart de la première page.
- **La Banque, « Choisir une autre pièce en face »** : « Les autres écritures du compte · 800 écritures » n'en montrait
  que soixante, sans le dire — celle qu'on cherchait pouvait ne jamais paraître. Elles se feuillettent, et une écriture
  de la deuxième page se choisit.
- **Les règles de la banque** : elles s'accumulent pour tout le cabinet. Vingt-cinq par page ; « Modifier » ouvre bien
  la règle de la ligne, pas celle du même rang sur la première page.
- Vu au passage : « 1 mouvements sur 1 ont leur écriture » sur un relevé d'un seul mouvement. La phrase s'accorde.

Regardés et laissés, avec la raison : les Z de caisse (déjà lus vingt par vingt, « Plus de Z… ») ; les demandes
d'accord (les cinquante plus récentes, et l'écran le dit) ; les ventes de la console à facturer (une file d'attente,
pas une liste) ; « Rattacher des pièces » d'une affaire (une liste à cocher avec sa recherche, où « tout cocher » porte
sur ce qui est affiché) ; « Pas encore passées en banque » (une boîte à hauteur fixe, avec son total) ; le plan
d'amortissement d'un bien (une ligne par année).

**La console d'exploitation**, mesurée sur la même base, écran par écran et onglet par onglet. Ses grandes listes
(clients, abonnements, paiements, journal, support) se feuillettent déjà côté serveur, et les écrans du service sont
bornés par leur fenêtre de temps (quatorze ou trente jours). Une liste arrivait entière : **la fiche d'un cabinet**,
ses dossiers (165 lignes) et ses collaborateurs. Elle se feuillette avec le pied des autres listes (« lignes 1 à 25
sur 165 », précédente, suivante) ; allumer une carte de filtre repart de la première page. Le mécanisme
(`useFeuillets`, `feuilleter` dans `web/console/src/ui.tsx`) sert à toute liste de la console lue en entier.

- La preuve : `tests/web/pagination-1352-1.test.ts`, `tests/web/console.test.ts` (« la fiche d'un grand cabinet ») ;
  preuves `pagination 1.352.1 a-i`.

## Bout en bout : le premier mois d'une épicerie neuve (1.353.0)

Joué à la souris, d'un compte neuf : « Épicerie fine du Lac » se crée, ajoute un client et un fournisseur, saisit un
achat de 40 bouteilles (entrées en stock, l'article créé depuis la ligne), émet sa première facture (358,000 DT), note
200 DT reçus par virement, crée sa caisse et vend deux bouteilles au comptoir. Les chiffres du mois ont été refaits à la
main et comparés à l'écran et aux écritures du serveur : ventes 350,000 HT, TVA collectée 66,500, déductible 136,800,
stock 26 × 18,000 = 468,000. Ce que le parcours a trouvé :

- **Un virement tombait dans le tiroir.** Le paiement de 200 DT, noté avant d'avoir un compte de trésorerie, n'avait pas
  de compte ; la caisse créée ensuite, seul compte donc compte par défaut, le recevait : l'ouverture de la caisse
  proposait 250 DT de fond pour 50, et le serveur repassait l'encaissement au journal de caisse (compte 54). Règle
  nouvelle, la même des deux côtés (`compteSansNom`, core.js ; `compteDeTresorerie`, plan.ts) : sans compte nommé, un
  règlement qui n'est pas en espèces ne va jamais dans une caisse par défaut ; il va au premier compte qui n'est pas une
  caisse, et sans un tel compte il reste sans compte (à la banque dans les écritures). Des espèces, un compte choisi à la
  main, ou un règlement sans mode connu : rien ne change.
- **L'argent sans compte n'était compté nulle part.** La Trésorerie annonçait « Disponible 109,500 DT » et un solde
  sous zéro de 200 DT trop bas. `cashPosition` le compte (`sansCompte`) et la page le nomme, avec le bouton « Créer le
  compte bancaire… » ; la fenêtre de paiement dit la même chose quand la caisse est le seul compte.
- **L'émission cochait d'avance « Signer par DigiGo »** sur un serveur où la signature n'est pas branchée : la fenêtre
  suivante répondait « rien n'a été signé ». La case n'est proposée que si la signature est prête (branchée, et un
  signataire désigné) ; le geste reste dans la frise et le menu de la pièce.
- **Deux gestes cochés, un seul ouvert.** « Signer » et « Ouvrir l'enregistrement d'un paiement » cochés ensemble : le
  paiement était oublié. Ce qui est coché s'ouvre l'un après l'autre, tant qu'on reste sur la pièce.
- **Ce qui bougeait sous le curseur** : la puce « Utiliser mon adresse » de l'assistant (elle garde sa place), et la
  carte du fournisseur qui remplace son champ dans l'achat (même hauteur).

Laissé tel quel, noté : le fond de caisse n'a pas d'écriture au compte 54 (déjà « À DÉCIDER » dans docs/caisse.md) ; le
bouton « Créer l'article… » d'une ligne en stock passe par une liste d'une seule entrée ; le total de l'achat gagne une
ligne (« toute déductible ») au premier montant et fait descendre « Enregistrer » de 32 px ; le téléphone tapé sans
espaces s'imprime sans groupes ; la barre latérale dit encore « Inviter mon comptable » quand une demande est en attente.
Le parcours côté Cabinet (accepter le dossier, comparer la TVA et les livres) reste à rejouer : le poste de test a
redémarré au milieu.

Tests : `tests/moteur/caisse-virement-1353.test.ts`, `tests/web/bout-en-bout-1353.test.ts` ; huit preuves.

### 1.353.1 : deux tests qui tombaient avec le calendrier

GitHub a refusé la 1.352.1 et la 1.353.0 sur le même test (`tests/web/messages-cabinet.test.ts`) : il demandait une pièce
« pour le 2026-11-10 », écrit en dur. Passé minuit le 11 novembre (heure de Tunis), le serveur refuse une échéance déjà
passée, et le test tombait sans qu'une ligne du produit ait bougé. La date se calcule (dans dix jours) ; le même défaut
attendait le 16 novembre dans `tests/messagerie/messagerie.test.ts`. Aucun code du produit ne change.

### 1.353.2 : le même mois, vu du Cabinet

Le côté Cabinet du parcours, rejoué dans le navigateur et tenu par le test : le dossier confié, ses trois écritures du
mois arrivent au brouillard (achats, banque, ventes), le comptable valide le lot du mois en un geste. La déclaration du
Cabinet dit les chiffres de l'entreprise : 57,000 DT de TVA due, 136,800 déductible, un crédit de 79,800, un timbre. Sa
balance porte le virement à la banque (532 : 200,000) et rien à la caisse ; le client doit encore 158,000. Deux chemins,
un chiffre : aucun écart. Aucun code du produit ne change (`tests/web/bout-en-bout-1353.test.ts`, second parcours).

## Les finitions du bout en bout (1.354.0)

Les quatre points laissés de côté par la 1.353.0, rejoués à la souris puis tenus par un troisième parcours du test :

- **« Inviter mon comptable » pendant que la demande attend.** La barre latérale invitait encore alors que le dossier
  était déjà proposé à un cabinet : on invitait une seconde fois. Le serveur dit maintenant à qui le dossier est proposé
  (`propose` dans la réponse de `/messages/attente`, lu par `socle.cabinet_du_mandat` : l'entreprise ne lit pas la table
  des organisations), et le lien devient « Comptable : en attente », en gris, avec « Jlassi Conseil n'a pas encore
  accepté ton dossier » au survol. Le libellé se relit à chaque réponse, pas seulement quand un cabinet apparaît. Une
  entreprise qui a déjà des messages garde « Mon comptable » : c'est voulu, ses messages restent lisibles.
- **Le premier montant poussait « Enregistrer l'achat ».** La ligne « toute déductible » naissait sous le total et
  descendait le bouton de 32 px au moment où on le visait. Sa place est réservée dès l'ouverture (une ligne vide de même
  hauteur), et le sous-total net aussi : le bouton ne bouge plus que d'un pixel.
- **« Créer l'article… » passait par une liste d'une seule entrée.** Quand aucun article du catalogue ne ressemble à la
  ligne, le bouton ouvre directement « Nouvel article », la désignation déjà tapée et « Suivi en stock » coché ;
  enregistré, la ligne s'y rattache et l'avertissement disparaît. S'il y a des articles proches, il reste « Choisir
  l'article… ».
- **Le téléphone tapé d'un bloc** (« 71222333 ») s'enregistre « +216 71 222 333 », comme on le lit ; ce qui est tapé
  avec ses espaces ou avec un indicatif reste tel quel.

Et la carte du fournisseur, dans l'achat, a la hauteur exacte de la ligne qui l'entoure (82 px) ; les invites des champs
« Numéro de la facture » et « Référence de l'acompte » disent ce qu'on y met (« Celui de sa facture », « Reçu, virement… »).

**La preuve qui dépendait du hasard.** GitHub a refusé « Toutes les preuves » sur une seule : « une clé de l'appareil
par lecture gardée en même temps » restait verte. Le défaut (chaque lecture gardée fabrique sa propre clé de chiffrement,
la dernière écrite gagne) ne se voit que si plusieurs lectures partent avant que la première clé soit rangée : c'est
le hasard de l'ouverture du Cabinet qui décidait. Le test retire maintenant la clé rangée, garde six lectures en même
temps, remet la clé, et exige que les six se relisent : le défaut tombe à chaque fois. Aucun code du produit ne change.

Tests : `tests/web/bout-en-bout-1353.test.ts` (troisième parcours), `tests/web/assistant.test.ts`,
`tests/web/cabinet-hors-ligne.test.ts` ; cinq preuves de plus, deux anciennes remises sur leur nouvelle ancre.

## Bout en bout : le premier salarié (1.355.0)

Joué à la souris : la Librairie Ennour (mandat sans la paie) embauche Sami Gharbi, vendeur, au 1er octobre, 1 200 DT
brut ; valide le pointage d'octobre, établit le bulletin, le paie ; puis le Cabinet ouvre le dossier. Les chiffres,
refaits à la main : CNSS salariale 110,160 (9,18 %), patronale 198,840 (16,57 %), accident 16,800, soit 325,800 au
trimestre ; TFP et FOPROLOS 30,000 ; coût 1 445,640 ; net 980,932, le même sur la fiche, la fenêtre « Établir » et le
bulletin. Au Cabinet, l'écriture de paie (PAIE-2026-10, 1 445,640) et le paiement (980,932 à la banque) arrivent au
brouillard : deux chemins, un chiffre. Ce que le parcours a trouvé :

- **La Paie vide avait deux onglets qui s'allumaient sur rien** (« La journée », « Congés et absences », sous l'état
  vide). Sans salarié, ils ne sont plus posés.
- **Le net s'annonçait loin du brut** : après les Notes, hors de la fenêtre pendant la frappe. Il vit sous la rangée du
  salaire.
- **Entré le 1er, « au prorata »** : 26 jours payés sur 26 se disaient au prorata. Un mois payé en entier dit « mois
  entier ».
- **Le pointage validé devenait « sauté »** dès le bulletin établi : « sauté : chacun payé au mois complet », d'un mois
  qu'on venait de valider. Le moteur (`paieDuMois`) compte maintenant la version validée du mois, comme l'ancien
  pointage ; l'écran dit « le mois est validé » avant comme après le bulletin.
- **Rouverte, la Paie s'ouvrait sur novembre, vide**, pendant qu'octobre attendait d'être payé. `moisDePaie` : le mois
  d'avant établi et pas encore payé passe avant le bulletin du mois en cours qui manque (il ne se prépare qu'en fin de
  mois).
- **« Compte principal »** dans « Depuis le compte » alors qu'aucun compte n'existe (l'encadré juste dessous le disait).
  L'option dit « Aucun compte créé : la banque », ce que les écritures font (règle de la 1.353.0).
- **Au Cabinet, l'onglet Paie d'un client qui fait sa paie lui-même** disait « Aucun salarié déclaré : c'est par là
  qu'une paie commence », avec « Déclarer un salarié… » en vert. Le suivre comptait la paie deux fois : l'écriture du
  client arrive déjà au journal de paie. Quand le mandat ne comprend pas la paie (et que le livre n'en porte aucune),
  l'onglet le dit, et son bouton mène à Saisie.

Tests : `tests/web/paie-1355.test.ts` (le parcours côté entreprise), `tests/moteur/paie-recette-1248-1.test.ts` (le mois
pointé, le mois à payer), `tests/web/bout-en-bout-1353.test.ts` (l'onglet Paie du Cabinet) ; neuf preuves, une ancienne
remise sur sa nouvelle ancre.

### 1.355.1 : l'absence d'un salarié

La suite du même salarié, à la souris : Sami prend deux jours sans solde en novembre.
- **Le bouton disait « Poser le congé »** pour une absence sans solde ou un arrêt maladie. Il dit ce qu'il pose : « Poser
  le congé », « Poser l'arrêt maladie », « Poser l'absence ».
- **La fenêtre rapetissait de 82 px** en changeant la nature (le tableau du solde, propre au congé, disparaissait) : le
  bouton remontait sous la souris. Chaque nature a maintenant son petit tableau de même hauteur.
- **« Le brut sera réduit au prorata »** sans dire de combien. Le tableau le dit avant de poser : 1 200,000 − 92,308 =
  1 107,692 DT (1 200 ÷ 26 × 2, calculé à la main), le même brut que le moteur du bulletin de novembre.
- **« Octobre n'est pas fini »**, lu le 11 novembre, disait le contraire du calendrier : c'est la PAIE d'octobre qui
  n'est pas finie (un bulletin à remettre, la déclaration à déposer). Le bandeau le dit ainsi.

Tests : `tests/web/paie-1355.test.ts` (sixième étape), `tests/web/paie-mois.test.ts` (le bandeau) ; quatre preuves, une
ancienne remise sur sa nouvelle ancre.

### 1.355.2 : le bulletin remis

Octobre est payé ; il reste à remettre le bulletin de Sami. Joué à la souris, du bandeau d'« Aujourd'hui » à la fiche de
l'entreprise :
- **Le bulletin disait « matricule fiscal : celui de ta fiche »** sur une fiche qui n'en avait pas, et taisait le n° CNSS
  employeur. Chacun dit maintenant « à renseigner », et ce lien mène à sa case dans la fiche de l'entreprise.
- **Rien ne réclamait le n° CNSS employeur**, que chaque bulletin et la déclaration du trimestre portent. Dès que
  l'entreprise emploie, « À ne pas oublier » le dit (« N° CNSS employeur manquant », bouton « Renseigner ») et les
  contrôles du mois aussi. Le Cabinet le réclamait déjà sur ses dossiers ; celui d'un client qui fait sa paie lui-même
  n'a rien à en dire.
- **Le lien laissait une fenêtre sur les Paramètres** : le bulletin s'ouvre par-dessus « Remettre le bulletin », et seule
  la fenêtre du dessus se fermait. Partir vers la fiche referme toute la pile (une fenêtre qui pose sa question garde
  la main).
- **« Remettre les bulletins d'octobre »** au-dessus de « 1 bulletin à remettre » : le bandeau, la ligne et la fenêtre
  comptent leurs bulletins. Et le bouton du bandeau FAIT son geste (la fenêtre de la remise ou du paiement s'ouvre) au
  lieu de déposer sur le mois où il fallait recliquer un bouton du même nom.
- **« jour(s) sans solde »** et « jour(s) » des congés pas pris : « 1,5 jour », « 2 jours ». La case d'une ligne de la
  remise tombait 15 px à droite de celle de l'en-tête (elle prenait la largeur d'un champ).

Tests : `tests/web/paie-1355.test.ts` (septième étape), `tests/moteur/paie-recette-1248-1.test.ts` (deux tests),
`tests/web/paie-mois.test.ts` (le bandeau et sa fenêtre) ; six preuves.

### 1.355.3 : les parcours qui décrivaient la paie d'avant

GitHub, rouge sur les 1.355.1 et 1.355.2, et ce sont les tests qui avaient raison de tomber :
- `paie-bon-a-payer` comptait onze contrôles ; le n° CNSS de l'employeur en fait douze, dont six à reprendre (son jeu
  d'essai n'a pas ce numéro) ;
- `cabinet-hors-ligne` ouvrait la Paie d'un dossier dont le mandat ne comprend pas la paie, et attendait « Aucun salarié
  déclaré » : depuis la 1.355.0, l'écran dit « La paie n'est pas confiée au cabinet », avec et sans réseau ;
- la preuve « paie 1.251 e » ne tombait plus : la page qui saute au mois suivant a deux gardes depuis la 1.355.0 (le mois
  qu'on regarde, et le mois de paie qui ne quitte plus des bulletins pas payés). Elle retire maintenant les deux.

### 1.355.4 : la paie du Cabinet s'ouvre sur le mois qui attend son bulletin

Joué au Cabinet sur la boulangerie, paie confiée : Hédi, embauché le 1er octobre par l'entreprise, sans bulletin. Lu le
11 novembre, la Paie du dossier s'ouvrait sur novembre (« le dernier mois qui a des bulletins, sinon le mois courant »),
et octobre attendait derrière une page vide. L'app entreprise s'ouvre depuis la 1.355.0 sur le mois à traiter
(`moisDePaie`) ; le Cabinet ne l'avait pas reçu — le jumeau manquant.
- `KC.moisPaieEnRetard(livre, annee, aujourdhui)` (moteur de la paie, posé dans les ajouts du module) rend le mois
  TERMINÉ de l'exercice regardé (le précédent, ou décembre d'un exercice fini) quand ses contrôles nomment un salarié
  sans bulletin, sinon 0 ; l'écran ne revient à sa règle d'avant que dans ce cas. Le mois en cours n'est jamais réclamé,
  ni un mois d'avant l'embauche, ni un salarié retiré.
- Le pont : le salarié écrit par l'entreprise est celui que le Cabinet attend ; son bulletin établi au Cabinet donne le
  net et le coût que l'équipe de l'entreprise affiche (839,704 et 1 204,700 DT pour un brut de 1 000).
- Le bulletin validé au Cabinet, puis payé par Sarra : un seul bulletin parlait au pluriel partout — « 1 validés »,
  « 1 préparés », « Les bulletins d'octobre sont validés : ils ne bougent plus », « Validés, ils… » dans la question,
  « Marquer le bulletin remis aux salariés », « Les bulletins sont établis » chez le client, « Marquer payés » et
  « payés le » pour un salaire. Chaque phrase s'accorde sur le nombre de bulletins ; le geste de remise nomme le salarié.
- « À ne pas oublier » coupait le titre de chaque ligne (« Hédi Mansouri : RIB à deman… », « N° CNSS employeur
  manqu… ») : c'est lui qui dit le geste. Il passe à la ligne ; l'explication dessous garde sa ligne et son infobulle.
- Tests : `tests/moteur/paie-cabinet-1355-4.test.ts` (quatre cas), la Paie ouverte au Cabinet sur le mois terminé dans
  `cabinet-paie-1330` (le mois lu sur l'horloge du test : en janvier, décembre de l'exercice d'avant), puis le même
  salarié au bulletin payé — la frise dit « 1 préparé » et « le seul » ; « payé le » / « payés le » dans
  `paie-recette-1248-1` ; « Marquer payé · » et aucun titre coupé dans `paie-1355`. Six preuves.

### 1.355.5 : le mois de paie payé

Octobre payé et remis par Sarra, sans que ses journées aient été validées une à une (« sauté : chacun payé au mois
complet ») :
- l'étape « Pointer », cochée, portait une pastille orange « 1 chose à régler » ; la carte disait « tout ce qui bloque le
  mois » et le cadenas « Régler la dernière chose ». Les bulletins du mois établis, plus rien ne bloque : ce qui reste se
  RELIT. La pastille garde son chiffre (un compteur dit le chiffre de sa liste, 1.259.0) mais passe en gris, et la carte,
  la ligne du mois, le cadenas et son refus disent « à relire » ; les journées restent là, validables. Le parcours de la
  1.259.0 jouait justement un mois payé : il est relu vers la règle (« Relis d'abord la chose de « À relire » ») ;
- « Les salaires sont payés ; 1 bulletin à remettre » pour un seul salaire, « 0 sur 1 établis », « approuvés » : au
  singulier quand il n'y en a qu'un.
- Tests : un mois payé sans pointage validé dans `paie-1355` (pastille grise « 1 chose à relire », « À relire », « Relire
  la dernière chose, puis valider le mois », « Le salaire est payé »), « 0 sur 1 établi » dans `paie-recette-1248-1`.
  Six preuves (celle de la pastille retire ses deux poses : le dessin de la frise et sa mise à jour) ; la preuve « paie
  1.259 f » suit sa ligne.

### 1.355.6 : la paie confiée, et la déclaration du mois des deux côtés

Joué à la souris, la boulangerie de Sarra dont la paie est confiée au cabinet de Leïla : le cabinet dépose la déclaration
d'octobre (93,496 DT), Sarra la paie, le Cabinet voit le paiement.
- La Paie de l'entreprise ne suivait pas la mission : sans choix écrit dans la fiche, elle disait « Tu déclares toi-même »
  à une entreprise dont le mandat comprend la paie. Le serveur dit maintenant `paieConfiee` (le périmètre de la mission),
  et la Paie s'en sert quand aucun choix n'est écrit ; un choix écrit gagne toujours, le bon à payer reste explicite.
- Le trimestre précédent demandait « la paie était tenue ailleurs ? » alors que personne n'était encore embauché : la
  ligne ne paraît que si un salarié était présent ce trimestre-là.
- La déclaration que le cabinet a déposée se lit dans la Paie (`depotDuCabinet`, une porte du socle qui lit les livres
  du cabinet, une fois toutes les trente secondes) : la ligne dit « déposée le … par ton cabinet · il te reste à la
  verser », le bouton « Marquer payée… », la fenêtre « Ton cabinet l'a déposée le … » et « Noter payée ». La mention garde
  la date du dépôt du cabinet et `parCabinet` ; la retirer ne retire que le paiement (« Retirer le paiement… »), le dépôt
  reste celui du cabinet. Avant, Sarra « déposait » une seconde fois ce que son cabinet avait déposé, à la date du jour.
- L'étape « Déclarer » de la frise dit « la retenue déposée le … / payée le … · la CNSS au trimestre » une fois la
  déclaration du mois faite ; celle d'un autre mois ne compte pas.
- Le paiement arrive au brouillard de la banque du Cabinet sous « Retenues et taxes sur salaires 10/2026 payées » (et
  « CNSS du 3e trimestre 2026 payée ») — plus « Déclaration DM-2026-10 payée », l'identifiant de l'écran.
- Au Cabinet, l'étape de la déclaration dit « Sarra a payé la part paie le … » avec son montant et l'état de son
  écriture (au brouillard ou validée), et « Marquer payée » prend la date du client au lieu d'aujourd'hui. L'en-tête du
  dossier se relit après chaque geste de la déclaration, mois déposés compris (« 1 mois à valider » restait après coup).
- Le lien « Déclarer » de la paie du Cabinet garde le mois de la paie.
- Phrases : « ce que le bulletin y ajoute » / « les 3 bulletins y ajoutent », « Le bulletin d'octobre… » au singulier ;
  la mention s'appelle « les retenues et taxes sur les salaires d'octobre 2026 ».
- Tests : `paie-pont-1355-6` (les deux applications sur une même base : la mission suivie, le dépôt du cabinet lu, payé
  à une autre date, retiré, et le Cabinet qui voit le paiement), `messagerie` (`paieConfiee`), `paie` (les libellés du
  livre), `paie-1330` (l'étape « Déclarer »), `cabinet-paie-parcours` (le mois du lien). Douze preuves ; trois anciennes
  suivent leur nouvelle ancre (« paie 1.234 b », « paie 1.270 h », « 1 mois à valider »).

### 1.355.7 : un mois déclaré se coche, et la pastille dit ce que le cabinet a déposé

Joué à la souris, la suite : octobre payé, remis, sa retenue déposée par le cabinet puis payée par Sarra.
- L'étape « Déclarer » d'octobre restait « en cours » jusqu'à la CNSS de janvier, sous une pastille « déclarée », et la
  retenue du mois ne comptait pas (la CNSS déposée suffisait). L'étape est maintenant faite quand ce qui se déclare à ce
  jour l'est : la retenue du mois (un mois qui ne retient rien n'a rien à noter), et la CNSS une fois son trimestre fini.
  Fini et non déposé, l'étape dit « la CNSS du 4e trimestre avant le 15/01/2027 » (la date du calendrier).
- Le cabinet a déposé, Sarra n'a pas encore payé : la pastille du mois disait « à déclarer » au-dessus de la ligne
  « déposée par ton cabinet ». Elle dit « à verser » (« en retard » après la date), et l'étape « la retenue déposée le … par
  ton cabinet, à verser ».
- Les livres du cabinet se relisent toutes les trente secondes ; la relecture garde ce qu'on savait (plus de « à
  déclarer » le temps de la réponse) et ne redessine la page que si un dépôt a changé. Une seule fonction de redessin
  pour la frise, la pastille et les déclarations.
- Une fenêtre plus haute que l'écran s'ouvrait défilée jusqu'à son premier champ, titre et croix coupés (« Ta
  déclaration d'octobre » ouverte sur « Payée le ») : elle s'ouvre sur son haut, le curseur dans le champ — dans les deux
  applications.
- Tests : `paie-1330` (le trimestre qui court, le trimestre fini, la CNSS seule, le dépôt du cabinet, un mois sans
  retenue ; les années 2099 et 2020 rendent ces cas indépendants du jour du test), `paie-pont-1355-6` (la pastille « à
  verser », l'étape, puis « déclarée » et faite ; la fenêtre sur un écran bas). Neuf preuves ; « paie 1.355.6 h » suit sa
  ligne.

### 1.355.8 : au Cabinet, le mois de paie déclaré se coche aussi

Le jumeau de la 1.355.7, vu à la souris dans la Paie de la boulangerie au Cabinet : la rangée des mois disait « oct.
déposé », et la frise gardait « Déclarés — IRPP et CSS avec octobre » à faire, comme la ligne « Les déclarer » (la
valeur était écrite en dur).
- `paieDeclares` lit la déclaration du mois dans le livre (déposée, payée) et, le trimestre fini, l'accusé CNSS rangé au
  classeur. La frise et « Les déclarer » s'en servent : « déposée le 11/11, payée le 11/11 · CNSS au trimestre », cochées
  tant que le trimestre court ; fini, la CNSS se dit « à déposer » jusqu'à son accusé.
- Test : `cabinet-paie-parcours` dépose la déclaration du mois et lit les deux étapes. Trois preuves.

### 1.355.9 : la TVA du mois dit que la même déclaration porte la part paie

Vu à la souris dans la Comptabilité de la boulangerie, onglet TVA, octobre : « Déposée par ton cabinet » sous un crédit
de TVA, et rien ne rappelait les 93,496 DT de retenues et taxes sur les salaires que la même déclaration faisait verser.
- Une ligne le dit maintenant sous la déclaration du mois : la part paie, son montant, et « payée le … » ou « à verser
  avant le … » (« la date limite était le … » une fois passée). Un mois sans bulletin n'en dit rien.
- « Voir la part paie » ouvre la Paie sur CE mois, dans ses déclarations (« La déclaration d'octobre, sa part paie »).
  Le premier jet ouvrait la Paie sur « Aujourd'hui ».
- C'est le module de la paie qui lit ses bulletins et ouvre son mois : il remplit le point « déclarations sociales » du
  socle avec `partDuMois` et `ouvrirMois`. Le socle n'écrit ni ne lit rien de la paie (frontières tenues).
- Test : `paie-pont-1355-6` lit la ligne « à verser » avant le paiement, son absence sur le mois d'avant, « payée le »
  après, puis suit le lien (la page rechargée à chaque fois, pour que l'onglet ouvert plus tôt ne fasse pas paraître le
  lien juste). Quatre preuves.

### 1.356.0 : bout en bout 5, la caisse de la boulangerie jusqu'au Cabinet

Une journée de caisse jouée à la souris dans la boulangerie de Sarra (caisse ouverte, quatre tickets dont un à la carte,
un écart au Z), puis lue au Cabinet. Le Z, les comptes 701 / 4367 / 54 / 532 / 658 de l'entreprise et le brouillard du
Cabinet disent les mêmes chiffres. Quatre défauts trouvés en route :
- « + Créer cet article », depuis une recherche qui ne trouve rien, ouvrait « Modifier la prestation » avec « Supprimer »,
  et le croissant enregistré entrait dans le ticket sans jamais entrer au catalogue : à recréer le lendemain. La fenêtre
  s'ouvre maintenant en création (« Nouvel article », sans « Supprimer ») et l'article est rangé au catalogue.
- Au comptoir, la nature proposée était « Une prestation · compte 706 ». Elle se décide par `natureProposee` : le métier
  d'abord (commerce : une marchandise, 707 ; artisanat et restauration : un produit fabriqué, 701), sinon une
  marchandise au comptoir, une prestation au catalogue (l'ancien défaut, inchangé). Elle reste modifiable. Elle ne vaut
  que pour une fiche NEUVE : une fiche existante sans nature montre ce qu'elle est (une prestation, vendue au 706) — le
  premier jet montrait « marchandise » sur la brosse de la droguerie, qui se vendait encore au 706. Et « Suivi en stock »
  décoché rend la proposition, plus une prestation d'office.
- Le HT recalculé depuis le TTC s'écrivait « 0.8403361344537815 », puis « 1 » au lieu de « 1.000 » : il s'écrit aux
  décimales de la devise (trois pour le dinar), dans les deux sens.
- Le solde de départ d'un compte de trésorerie (la banque, la caisse) n'arrivait jamais au Cabinet : le brouillard
  commençait à zéro pendant que l'entreprise montrait son fond de caisse. Il arrive maintenant au brouillard, au journal
  du compte, contre le 471 (ce qu'il représente — un apport, un retrait de la banque, un solde déjà repris — se décide au
  cabinet), sous la pièce « OUVERTURE ». Jamais pour un compte ouvert avant le premier jour du livre tenu au cabinet (il est
  dans ses soldes d'ouverture repris : le compter encore ferait la banque deux fois), ni dans la période close ; un
  découvert change de colonne ; renommer, modifier ou supprimer le compte réécrit ou retire la pièce.
- Tests : `catalogue-1318` (la nature proposée sur sept cas), `caisse-premier-article` (la création au comptoir, tapée au
  clavier, lue dans le dossier), `compta/mouvements` (le solde de départ : l'exemple, la borne du livre, la période close,
  le découvert, la suppression). Dix preuves, et cinq anciennes réécrites sur le code qui a bougé.
- Deux parcours retournés vers la règle : `bout-en-bout-1353` (la caisse de l'épicerie porte son fond de 50 DT au
  brouillard du Cabinet : une pièce de CA de plus dans le lot, 50 au 54 et au 471 dans la balance) et
  `cabinet-pas-avant-son-jour` (le 21/10, la Paie s'ouvre sur septembre, le mois terminé qui attend son bulletin — la règle
  de la 1.355.4, que ce parcours décrivait d'avant : il choisit octobre, comme le comptable).
- GitHub : depuis la 1.355.4, chaque vérification tombait sur l'installation du navigateur des tests (« Temporary failure
  resolving 'azure.archive.ubuntu.com' », trente minutes, trois essais d'apt), sans qu'un seul test tourne — c'est ainsi
  que le second parcours ci-dessus n'avait jamais été vu tomber. `.github/miroir-ubuntu.sh` passe apt aux miroirs
  officiels quand celui d'Azure ne se résout pas ; il tourne avant le navigateur dans les trois tâches qui l'installent.

### 1.356.1 : la bande vide sous le Cabinet

Vu à la souris au Cabinet, dans la saisie de la boulangerie : « Voir le brouillard » amenait le brouillard de novembre, et
une bande vide de 213 points se posait sous l'application, la barre latérale coupée avec elle. Ce n'était pas l'écran qui
défilait, c'était le DOCUMENT : les noms cachés aux yeux de la colonne « Par » (un par ligne, `.sr`, en position absolue)
n'avaient aucun parent positionné et se rangeaient contre la page entière, qu'ils allongeaient d'autant.
- Le nom caché se range dans sa pastille (`.sx-par` en position relative).
- L'instrument de rendu (`problemes`, partagé par treize parcours) gagne une sonde : quand l'écran défile dans son cadre
  (`#view`), le document ne dépasse jamais la fenêtre — et elle nomme le premier coupable. Les autres écrans des deux
  applications ont été mesurés sur les données de l'essai humain : seule la saisie du Cabinet dépassait.
- Test : `saisie-1342` appelle la sonde au bas d'un long brouillard (752 points de trop avant la correction, « dépasse :
  <span.sr> « Leïla Jlassi » »). Une preuve, posée sur le défaut réel.

### 1.356.2 : bout en bout 6, le four de la boulangerie jusqu'au Cabinet

Sarra achète un four à sole (18 000 HT, 21 420 TTC, en immobilisation chez Equipements Ben Ali), en paie la moitié par
chèque, puis Leïla le reçoit au Cabinet. L'achat, le règlement, la fiche du bien (3 600 par an, 500 la première année, au
prorata de cinquante jours) et le Cabinet disent les mêmes chiffres : 22 / 4366 / 401 au livre, 401 / 532 à la banque,
« même plan » au registre. Neuf défauts trouvés en route :
- Le prix unitaire d'un four (« 18000.000 ») était coupé dans sa case : elle se réserve dix chiffres.
- La fenêtre « La fiche du bien » : sa phrase passait de deux à trois lignes au choix de la famille, et « Garder ces
  réglages » descendait de 13 points sous le curseur (place réservée) ; une durée VIDE se disait « proposée pour la
  famille » ; la durée de la famille gardée telle quelle se disait ensuite « choisie par toi ».
- La frise de l'achat montrait l'étape « Au cabinet » juste après l'enregistrement, et plus après un rechargement : le
  cabinet s'apprend APRÈS la page (une réponse du serveur), et la frise était dessinée une fois. Elle se redessine quand
  on l'apprend.
- Payé à moitié, l'achat disait « À payer » en tête et « Réglée · échéance 11/12 » dans sa frise, sous « Réglé 10 710 ·
  reste dû 10 710 ». L'en-tête dit « Réglée en partie » (le mot de la liste, `purchaseStatus`), et l'étape « Réglée en
  partie · 10 710,000 sur 21 420,000 DT », en ambre (le jumeau de la frise d'une vente).
- Au Cabinet, au kilomètre comme face à la pièce, le « numéro suivant » du journal se lisait sur TOUTES ses pièces, celles
  venues de SkanFact comprises : après EBA-2611 (le numéro de la facture du fournisseur), la ligne suivante proposait
  « EBA-2612 », une facture que personne n'a faite, sur la pièce d'un autre fournisseur. La suite ne se lit plus que sur
  les pièces que le cabinet a numérotées ; sans elles, la case reste vide (« n° pièce »).
- Une liste d'une fenêtre (« Outillage et matériel technique (5 ans) ») passait sous sa flèche : le dessin commun des
  champs de fenêtre écrasait la place que la liste réserve au chevron (les deux applications).
- La fiche reprise du client, rouverte au Cabinet (« Modifier la fiche »), disait « — » en famille, comme si elle s'était
  perdue : la famille ne s'enregistre pas (1.345.0), celle du bien du client se relit.
- Test : `four-1356` (le cabinet appris deux secondes après la page, l'achat payé à moitié, la case du prix, la fenêtre de
  la fiche mesurée au pixel, puis le Cabinet : la pièce face à la pièce et au kilomètre, la liste de la fenêtre, la fiche
  rouverte, la fenêtre du règlement). Quinze preuves.
- La seconde moitié du four : la fenêtre du règlement coupait « · reste » de son montant, sur deux lignes. Un montant ne
  se sépare plus de son mot (espaces insécables) ; la ligne se coupe aux « · ».
- En corrigeant la frise, un défaut plus ancien : le bandeau d'un achat redessiné (après un règlement, ou le cabinet appris
  après la page) perdait « Hatem, de ton cabinet, te l'a demandé le … », écrit une seule fois dans l'ancien bandeau. Il se
  relit dans le fil à chaque dessin (le parcours `achat-ecarts` l'a vu tomber, dans le lot de vérification).
- GitHub, enfin vert sur l'installation du navigateur (1.356.0), a montré deux parcours que la 1.355.4 et la 1.356.0 avaient
  fait tomber sans qu'aucun ne tourne :
  - `paie-1344` : la Paie du Cabinet s'ouvre depuis la 1.355.4 sur le mois qui attend son bulletin (décembre), et son onglet
    CNSS prenait le trimestre de ce mois : « Aucun bulletin sur ce trimestre : il n'y a rien à déclarer », au-dessus d'un
    1er trimestre plein, à déclarer. Sans choix, la CNSS s'ouvre sur le trimestre du mois s'il porte des bulletins, sinon
    sur le dernier avant lui qui en porte — UNE fonction (`trimestreCnss`) pour l'écran, le fichier de télédéclaration et
    l'état imprimé, qui avaient chacun leur calcul ; une ancienne preuve réécrite sur elle.
  - un parcours tombait, `statistiques-1323`, qui comptait « 1 mois »
  au Cabinet. Depuis la 1.356.0, le fond de caisse du 1er janvier (50 DT) y arrive : janvier porte cette écriture
  d'ouverture, sans chiffre d'affaires, et le pied dit « 2 mois 905,049 DT ». Retourné vers la règle (un mois au livre est
  un mois qui porte une écriture) ; en janvier, les deux tombent dans le même mois.

### 1.356.3 : les trois restes du four

Trois choses vues en jouant le four (1.356.2), laissées de côté pour ne pas mélanger les lots.

- Au Cabinet, au kilomètre : « Achats de novembre · 4 pièces à traiter » au-dessus d'une grille qui n'en saisit qu'une. Le
  kilomètre ne prend que les pièces « à saisir » (et en devises) ; une pièce à vérifier, illisible, en double ou déjà
  saisie se traite face à la pièce. Le compte le dit : « 4 pièces à traiter · 1 se saisit ici, 3 face à la pièce ». Et
  la pièce à côté de la grille s'ouvrait sur celle qu'on regardait face à la pièce — « à vérifier : elle se traite
  Face à la pièce », au-dessus d'une ligne vide. Le kilomètre s'ouvre sur la première pièce qu'il saisit ; les
  flèches mènent toujours aux autres.
- « Valider un autre lot (8) », sous « 13 écritures » : le chiffre comptait les BOUTONS du lot (par journal, par mois),
  et se lisait comme un nombre d'écritures. Il dit « 8 choix, par journal ou par mois ».
- Côté entreprise, la fiche d'un bien proposait sa famille d'après les mots d'un atelier (perceuse, compresseur) et
  rien pour le matériel d'un métier : « Four à sole », « Pétrin spirale », « Réfrigérateur » restaient « à choisir ».
  La table gagne le matériel des métiers de bouche et de santé (four, pétrin, laminoir, chambre froide, réfrigérateur,
  trancheuse, autoclave…), le fourgon et l'utilitaire, la caisse enregistreuse. Le mot qui vient le PREMIER dans la
  désignation décide (« Réfrigérateur de comptoir » est un réfrigérateur, pas un comptoir), et la raison cite le mot
  entier de la désignation (« réfrigérateur », jamais la racine « réfrigérat » de la table). Une proposition, jamais
  une décision : la famille et la durée restent à VÉRIFIER avec le comptable.
- Test : `four-1356` s'enrichit (une photo illisible à côté de la facture du gaz, le compte du kilomètre, la pièce à côté,
  le résumé des lots, le réfrigérateur) ; son bien « sans mot connu » devient un bac à levain. Six preuves.

### 1.356.4 : la facture de l'hôtel, jusqu'au Cabinet

Bout en bout 7 : la boulangerie facture l'Hôtel Les Palmiers SA (six paniers, 1 260 HT, 239,400 de TVA, timbre),
avec sa retenue à la source à 1 %. L'hôtel règle en deux fois (700 par virement, 785,406 par chèque), garde 14,994 DT
de retenue et remet son attestation. Les deux chemins disent les mêmes chiffres : au livre de la boulangerie et au
Cabinet, la vente 411 / 706 / 4367 / 4368, puis chaque règlement crédite le 411 de ce qu'il verse PLUS sa part de
retenue (707,066 puis 793,334 : 1 500,400 en tout), et le 4358 porte 7,066 + 7,928 = 14,994. Le lettrage du Cabinet
solde l'hôtel. (Le chèque passe au 532 comme un virement : un 5113 « chèques à encaisser » est une question au
comptable, À VÉRIFIER.) Ce qui a été corrigé en chemin :
- La pastille « Retenue » de la facture restait « 1 % · sous le seuil » une fois la ligne posée (1 499,400 TTC hors
  timbre, au-dessus du seuil de 1 000) : les étiquettes n'étaient dessinées qu'au changement de client. Elles suivent
  chaque nouveau total, et ne se redessinent que si elles ont changé (une étiquette ouverte reste ouverte).
- L'adresse manquante : le panneau « Avant d'émettre » disait « il manque l'adresse » (il l'ajoutait de son côté),
  et le bandeau des Paramètres, ouvert juste après par « Compléter », ne la comptait pas — deux listes pour une fiche.
  Elle vit dans `companyGaps`, que les deux lisent ; et « Compléter ma fiche… » (fenêtre d'émission), qui lit la même
  liste, gagne sa case « Adresse » — sinon il s'ouvrait sur une fenêtre sans aucune case. Et la facture derrière la
  fenêtre relit la fiche une fois complétée : « Avant d'émettre » disait encore « il manque l'adresse », et l'aperçu
  imprimait l'en-tête d'avant. Le serveur n'en fait pas une condition d'émission : on prévient, on ne bloque pas.
- « Compléter » menait aux Paramètres, et rien n'y ramenait à la facture : les Paramètres ouverts depuis une pièce
  portent un bouton retour ; sa bulle nomme le brouillon par son client (« Facture (brouillon) — Hôtel Les Palmiers
  SA »), un brouillon n'ayant pas de numéro.
- Le libellé d'un champ et sa bulle « i » (« Retenue à la source appliquée par ce client (i) ») : la bulle passait seule
  sur la ligne suivante, ou coupait le dernier mot — un libellé était une boîte flex, où la règle « la bulle part avec
  son dernier mot » ne s'applique pas. Il coule maintenant comme une phrase (`fl-lbl`, les deux applications), et le
  libellé dit « Sa retenue à la source ».
- La recherche d'article disait « 0 article · prix de Hôtel Les Palmiers SA » : elle dit « Aucun article de ce nom » et
  « prix pour … ». Le nom d'un tiers s'élide devant une voyelle ou un h (`deNom` : « Actions d'Hôtel… », « La fiche
  d'Amel… », « les pièces d'Hôtel… ») ; les deux phrases du prix d'un client disent « le prix convenu avec … » — un
  test gravait « le prix de Hôtel Les Jasmins » depuis la 1.317.0.
- « paie en 0 jour en moyenne » pour un client qui règle à l'émission : « paie le jour même, en moyenne ».
- La liste des clients : le total « Te doit » n'avait pas sa devise, quand « Facturé HT » à côté l'avait (`liste-clients`
  gravait le pied sans elle : retourné vers la règle).
- Test : `hotel-1356` (une facture déjà réglée le jour même, puis le brouillon de l'hôtel : la pastille avant et après la
  ligne, la recherche vide, « Ta fiche », « Compléter » et le retour, une livraison offerte qui avertit à l'émission et
  « Compléter ma fiche… » sur la case de l'adresse, les libellés de la fiche du client, la liste) ; `prix-1317` retourné
  vers « le prix convenu avec ». Treize preuves.

### 1.356.5 : le devis de l'hôtel, son acompte et son solde, jusqu'au Cabinet

Bout en bout 8 : la boulangerie fait à l'Hôtel Les Palmiers SA (retenue 1 %) le devis des petits-déjeuners d'un séminaire,
900 croissants à 1,200 (1 080 HT, 1 285,200 TTC hors timbre : au-dessus du seuil de la retenue). L'hôtel verse 30 %
d'acompte, puis le solde. Les deux factures sont chacune sous le seuil (1 000 DT TTC, règle `retenue.seuil`, À VÉRIFIER) :
aucune ne porte de retenue. Les deux chemins disent les mêmes chiffres : l'acompte 411 386,560 = 706 324,000 + 4367
61,560 + 4368 1,000 ; le solde 411 900,640 = 706 756,000 + 4367 143,640 + 4368 1,000 — 1 080 HT au 706, le devis entier,
et deux timbres ; chaque règlement solde son 411. Ce qui a été corrigé en chemin :
- « Si le devis devient une facture » annonçait une retenue sur un devis sous le seuil (− 8,568 DT sur 856,800) : la
  facture que le devis donnera porte le seuil du jour, comme celle que l'éditeur pose.
- La fenêtre de l'acompte annonçait 382,704 DT pour une facture de 386,560 (la retenue d'un devis entier, appliquée à une
  part sous le seuil), et « TTC + timbre » ajoutait le timbre une seconde fois au TTC qui le contient : « 386,560 DT TTC,
  dont timbre 1,000 DT », le TTC que la facture dira. L'écart avec une seule facture se dit par ce qui le fait (deux
  timbres, la retenue qu'aucune ne porte). La fenêtre de solde dit pareil.
- « la retenue se fera au paiement si le client en règle plusieurs pour ce montant » (fenêtre d'acompte, « Avant
  d'émettre ») promettait un geste qui n'existe pas : rien ne calcule une retenue sur un paiement groupé. L'écran dit
  que réglées d'un seul paiement, la retenue peut s'appliquer — À VÉRIFIER avec le comptable. (Saisir la retenue d'un
  paiement groupé reste à faire : c'est une règle de droit et une écriture au 4358, pas une phrase.)
- L'acompte facturé, l'encadré du devis annonçait encore la facture entière (1 273,348) : il annonce LA FACTURE DE SOLDE
  (l'acompte déduit en TTC hors timbre, le timbre du solde, ce que le client paiera : 900,640), par le constructeur de
  « Facture de solde » ; le devis facturé en entier n'annonce plus rien.
- La frise d'un devis accepté sans avoir été envoyé (l'acompte facturé) disait « marqué envoyé » : « aucun envoi noté ».
- Le devis facturé en deux fois disait « Facturé : FAC-2026-003 » (le seul solde), et son menu proposait encore « Facture
  d'acompte… » : il nomme ses deux factures (« acompte FAC-2026-002, solde FAC-2026-003 »), sous le bouton comme dans la
  frise, sans couper un numéro sur son tiret ; le menu ne garde que « Refacturer la totalité… », la porte assumée.
- La recherche d'article suit les mots du métier (1.356.3) : une entreprise de services lit « Aucune prestation de ce
  nom » et « Créer la prestation « … »… », jamais « article ».
- Le test « cabinet appris après le dessin de l'achat » (rouge GitHub de 1.356.2) retenait la réponse du cabinet trois
  secondes : sur une machine lente la pièce se dessinait après, et le cas n'était plus joué. La réponse attend que la
  pièce soit dessinée sans la demande ; et la preuve retire les deux chemins qui la remplissent (1.356.2 en a ajouté un).
- Test : `acompte-1356` (le seuil posé comme règle de l'entreprise du test, que l'écran et le serveur lisent tous deux —
  servi au seul navigateur, l'émission tombait : 386,560 à l'écran, 382,704 au serveur ; l'acompte émis, l'encadré du
  solde, la frise, la fenêtre de solde, le solde créé, puis le devis qui nomme ses deux factures). Treize preuves, plus la
  preuve reprise.

### 1.356.6 : l'avoir partiel sur une facture qui porte sa retenue

Bout en bout 9 : 200 des 1 200 croissants de la facture FAC-2026-001 de l'Hôtel Les Palmiers SA (1 499,400 TTC hors timbre,
au-dessus du seuil : 14,994 DT de retenue, déjà réglée) n'ont pas été livrés. Un avoir partiel de 130 HT, 154,700 TTC.
- L'avoir tombait « sous le seuil » (154,700 < 1 000) et ne reprenait rien de la retenue de sa facture, alors que
  l'annulation totale la reprenait : le client gardait 14,994 DT retenus sur une base diminuée. Le seuil se juge sur la
  FACTURE : si elle porte une retenue, son avoir reprend sa part (1 % de 154,700 : 1,547) ; si elle n'en porte pas, son
  avoir, plus petit qu'elle, n'en porte pas non plus. À l'écran (le brouillon de l'avoir) et au serveur (le calcul de la
  pièce), sinon l'émission tombe sur deux nets différents.
- Le récapitulatif d'émission annonce 153,153 DT à rendre : la facture payée, l'avoir laisse ce trop-perçu, qui se
  rembourse d'un geste (« Rembourser 153,153 DT au client… »).
- Les deux chemins : au Cabinet, l'avoir crédite le 411 de 154,700 (706 130,000, 4367 24,700) ; le remboursement le
  débite de 153,153 (532) ; la retenue de la facture se recalcule sur la base diminuée, 13,447 au 4358 (1 % de 1 344,700) —
  posée le même jour que les règlements, l'avoir passe avant eux et leurs parts sont recalculées ; un autre jour, l'écart
  se régularise à SA date (`retenueAuFil`). Le 411 de l'hôtel revient à zéro. (Que le client corrige sa déclaration de
  retenue, ou que l'écart reste à régulariser auprès de l'État : À VÉRIFIER avec le comptable.)
- « Avant d'émettre » d'un avoir sous le seuil disait « pas de retenue sur la facture » et promettait un paiement
  groupé : un avoir ne se règle pas. Il dit « pas de retenue sur l'avoir, comme sur sa facture ».
- L'onglet Paiements de la fiche du client comptait le remboursement comme un versement : « 2 paiements · 1 332,253 DT
  reçus » (1 485,406 − 153,153). Il sépare ce qui est reçu de ce qui est rendu : « 1 paiement · 1 485,406 DT reçus ·
  1 remboursement · 153,153 DT rendus » — un net se lit comme ce que le client a versé, et ce n'est pas ce qu'il a versé.
- Test : `avoir-1356` (la grande facture émise avec sa retenue, l'avoir partiel qui reprend 1,547 et que le serveur émet,
  le remboursement, la fiche du client, la petite facture sous le seuil et son avoir). Quatre preuves.

### 1.356.7 : « Annuler » qui ramène la pièce à ce qui est enregistré ne laisse rien à enregistrer

Bout en bout 10 : la boulangerie fait repeindre sa boutique et son laboratoire. Un nouveau fournisseur, Peinture Ksibi, avec
sa retenue à opérer de 1,5 % (À VÉRIFIER : le taux d'une prestation de travaux), reprise sur la pièce « de sa fiche » ;
facture PK-2611-07 de 2 400 HT, 456 de TVA, 1 de timbre : 2 857 TTC, 42,840 retenus (1,5 % de 2 856, hors timbre),
2 814,160 à payer. Les montants tombent juste ; « 2,5 » tapé dans la quantité donne 2,5 (6 000 HT).
- En corrigeant le numéro puis en cliquant ↶, la pièce revenait exactement à ce qui est enregistré (le bouton ↶ s'éteint)
  et l'en-tête disait encore « Modifications non enregistrées », « Enregistrer les modifications » en vert, et quitter
  posait la question. Deux causes sur l'achat : la page redessinée par « Annuler » était toujours « sale », et sa
  dernière ligne remarquait modifiée toute pièce reprise. L'achat retient son état d'ouverture ; les justificatifs et
  les règlements, qui ont leurs propres gestes, n'y comptent pas.
- L'éditeur de facture et de devis a son propre « Annuler » : même défaut, même règle. Ce qui est enregistré est retenu à
  l'ouverture et à chaque enregistrement (y compris l'enregistrement automatique d'une facture en brouillon, qui ne
  redessine pas la page) ; ramené là, l'en-tête redevient celui de l'ouverture (`enregistrerRendLaMain` rend le vert à
  l'étape suivante). « Rétablir » la remarque modifiée.
- Test : `annuler-1356` (le devis, la facture en brouillon enregistrée toute seule, la facture d'achat du peintre ; et
  quitter sans question). `achat-ecarts` retourné : il exigeait la marque sur une pièce revenue à ce qui est enregistré.
  Cinq preuves.
- Au passage, le rouge GitHub de la 1.356.5 : `pagination-1352-1` ouvrait le menu ⋯ de la banque dès que l'en-tête de la
  fiche paraissait ; « Les règles de la banque » n'y entre qu'une fois le relevé dessiné, et sous Node 22 le menu s'ouvrait
  avant. Le test attend les lignes du relevé.

### 1.356.8 : la retenue opérée après un avoir fournisseur, et l'avoir d'une facture déjà payée

Bout en bout 10, la suite : la facture du peintre (PK-2611-07) payée en entier, 2 814,160 virés et 42,840 retenus,
l'attestation remise ; puis le peintre envoie un avoir de 400 HT (PK-AV-2611-02, 476 TTC, 7,140 de retenue, 468,860 net),
rattaché à la facture déjà payée. Le moteur comptait juste depuis la 1.356.6 (retenue 35,700, soit 1,5 % de 2 380 ; la
facture « à récupérer » de 468,860) ; ce sont les écrans qui disaient autre chose.
- L'attestation imprimait un brut de 2 856,000 à côté d'une retenue de 35,700 : le fournisseur ne refaisait pas le calcul.
  Le brut est l'assiette de la retenue (`C.assietteRetenueAchat`, TTC hors timbre moins les avoirs et acomptes rattachés),
  et la ligne dit d'où il vient (« 2 856,000 DT moins l'avoir PK-AV-2611-02 »). L'onglet « Retenues » du fournisseur
  montre la même base, et l'avoir rattaché n'y a plus sa propre ligne « pas encore payée · 5,355 DT à venir ».
- Une attestation déjà remise ne disait plus ce qui a été reversé, et rien ne le signalait. Cocher « remise » retient
  désormais son montant (`withholdingCertificateAmount`) ; un avoir qui change ensuite la retenue la rend « corrigée, à
  remettre » (`C.attestationCorrigee`) : sur la pièce, une ligne ambre avec « l'imprimer » et « corrigée remise » ; dans
  « À faire », « 1 attestation de retenue à remettre (dont 1 corrigée) » ; sur la fiche du fournisseur, « Imprimer la
  corrigée ». Une remise d'avant cette version n'a pas de montant : on ne sait pas ce qu'elle disait, elle n'est jamais
  réclamée. « Voir la liste » de cette ligne menait à la comptabilité des achats, qui ne montre aucune attestation : un seul
  fournisseur concerné, elle ouvre l'onglet « Retenues » de sa fiche.
- La carte des totaux disait « tu reverses 42,840 DT » : elle dit « 35,700 DT · 7,140 DT de moins avec PK-AV-2611-02 ». La
  tuile « Retenue » garde 42,840 (elle s'additionne avec le net à payer) et dit dessous « 35,700 DT après PK-AV-2611-02 ».
- La page de l'avoir disait « Réglée : plus rien n'est dû » et « plus rien à récupérer » pendant que le fournisseur doit
  468,860 DT. Elle le dit (bouton vert « Enregistrer le remboursement », qui s'enregistre sur la facture ; frise
  « Remboursé · 468,860 DT attendus sur PK-2611-07 » ; la section « Remboursement ») ; une fois remboursé : « Déduit de
  PK-2611-07 : plus rien à récupérer », et le bandeau « le fournisseur t'a remboursé le trop-payé » (il disait encore « te
  doit ce montant »). Sur la facture, la phrase du remboursement parlait de « solder l'avoir » ; elle dit d'où vient le trop
  (l'avoir déduit d'une facture déjà payée). Le bouton de la fenêtre disait « l'avoir sera soldé » sur une facture : « plus
  rien à récupérer ».
- La pastille du fournisseur disait « ne lui dois rien » : elle dit « 468,860 DT en ta faveur ».
- Les deux fenêtres de règlement fournisseur (une pièce, « Régler ensemble ») écrivaient « 2814.16 » dans une case
  numérique : elles écrivent et relisent en français (« 2 814,160 », « 400,5 »), comme le paiement d'une facture.
- L'écriture du remboursement s'intitulait « Règlement fournisseur PK-2611-07 » dans le moteur de l'application ; le moteur
  du serveur, que lit le Cabinet, écrit « Remboursement PK-2611-07 — Peinture Ksibi ». Le même mot des deux côtés (et
  « Remboursement fournisseur » dans le journal de trésorerie).
- Deux chemins, un chiffre, après le remboursement (468,860 reçus par virement) : 401 soldé, banque −2 345,300, 4352
  35,700, 4366 380,000, 606 2 000,000, des deux côtés.
- Au passage, sur l'accueil : « Voir les 1 autres » sous « À faire » (« Voir l'autre »), et sur ordinateur un chevron seul
  sous la liste quand toutes les lignes y tiennent (la règle des boutons d'un panneau l'emportait sur celle qui le cache).
- Test : `avoir-fournisseur-1356`. `fiche-fournisseur` retourné : il attendait « 410.479 » dans la case du règlement. Dix-sept
  preuves ; le motif d'une ancienne preuve (le montant d'un paiement), que les deux cases neuves répétaient, rendu unique.
- Le rouge GitHub de la 1.356.7 : la preuve « écarts 17 » (un « change » qui ne change rien n'entre pas dans la pile de
  « Annuler ») restait verte. Sans la garde, « Rétablir » pose une entrée vide dans la pile ; Ctrl Z refait dans les 0,7 s
  la retirait (le regroupement des frappes), et le test enchaînait trop vite pour le voir. Il attend désormais une seconde,
  comme quelqu'un qui relit avant de redéfaire : sans la garde, Ctrl Z défait ce rien et le numéro ne bouge pas.


### 1.356.9 : les cases chiffrées s'écrivent en français, même sur un navigateur en anglais

Vu sur la facture du peintre (PK-2611-07, capture de Skander) : « P.U. HT 2400.000 », « Timbre et frais 1.000 DT ». Une case
numérique (`type=number`) montre sa valeur à la façon du NAVIGATEUR, pas de l'application : réglé en anglais, il écrit
« 2400.000 » pour 2 400 DT et « 2.500 » pour 2,5 DT — qu'un lecteur tunisien lit deux mille cinq cents. La règle H-1 du
Cabinet (« 250.000 » lu deux cent cinquante mille), ici dans l'app entreprise. La saisie, elle, était juste (« 2,5 » tapé
donnait 2,5) : c'est la lecture qui trompait.
- Les montants, les taux, les quantités et les pourcentages sont des cases de TEXTE (`data-montant`, la règle des paiements
  depuis la 1.155.0) : écrites en français par `frChiffre` (« 2 400,000 », « 2,5 »), relues par `lireChiffre`. On complète,
  on n'arrondit jamais. Un montant (`.montant`) montre les décimales de sa devise, celle de la pièce qui le porte (« 2,500 »
  en dinars, « 2,50 » en euros) ; une pièce qui change de devise les réécrit.
- En quittant une case, son nombre s'écrit en français : « 2400.5 » tapé à l'anglaise devient « 2 400,500 », « 1200,5 »
  devient « 1 200,5 ». Des milliers groupés se lisent (« 1.200,500 », « 1,200.50 », « 1.200.500 ») ; ce qui ne se lit pas
  (« 12,,5 ») reste illisible et se marque, au lieu de valoir zéro en silence.
- Partout : la facture d'achat (lignes, timbre et frais, montant payé d'une dépense, taux), le devis et la facture (taux de
  change, remise de toute la pièce, la feuille d'une ligne au téléphone), l'acompte, l'encours d'un client, le catalogue (prix,
  coût, prix TTC, kits, listes de prix), les modèles, les contrats, le bon de commande et sa réception, le stock (mouvements,
  inventaire, transferts, consommation), la caisse, la trésorerie (solde d'un relevé, qui peut être négatif), les OD, les
  biens, les réglages, les licences, et la paie (primes, heures sup, horaires, barèmes, taux par régime) ; au Cabinet, les
  heures sup et les jours sans solde de la paie d'un client. `field(…, 'number', …)` le fait tout seul pour un pas décimal ;
  les cases de nombres entiers (jours, années, numéros) ne changent pas.
- La seule exception est nommée : la grille des lignes d'une facture et d'un devis garde ses cases numériques, avec la vue
  en français posée par-dessus quand on n'y est pas (1.155.3).
- Test : `montants-fr-1356-9`, sur un navigateur en anglais (en-US) — sinon il mesurerait l'égalité de deux défauts. Huit
  preuves ; huit anciennes recalées sur le code neuf (les quantités d'une commande et d'une réception, l'encours, le coût
  d'un kit, le prix TTC, le coût du stock de départ, les pourcentages de l'acompte, le HT calculé depuis la caisse).
- Douze tests attendaient l'ancien affichage (« 3.398 », « 2.5 », « 137.445 »…) : retournés vers l'écriture française
  (`commandes-fournisseurs`, `achat-ecarts`, `cabinet-paie-pointage`, `caisse-premier-article`, `debutant`, `debutant-2`,
  `demandes-prix`, `kits`, `lecture-ia`, `liste-fournisseurs`, `listeprix-fiche`). Une case encore sous le curseur garde ce
  qu'on y a tapé (« 11.9 ») : elle ne s'écrit en français qu'en la quittant.
- Le rouge GitHub de la 1.356.8 : `liste-fournisseurs` attendait « 137.445 » dans la case de « Régler ensemble », que la
  1.356.8 écrit justement en français (« 137,445 ») ; le test décrivait l'ancien défaut.

### 1.357.0 : la facture d'achat enregistrée se lit en résumé

Demandé par Skander, deux captures à l'appui (la facture du peintre PK-2611-07, la facture de vente de Lemon Beach au
téléphone) : « pourquoi la facture reste comme ça quand elle est enregistrée, et pas comme facture, avec le nouvel écran et
le résumé ? ». Une facture de vente émise se lit depuis la 1.133.0 ; la facture d'achat enregistrée restait le formulaire de
saisie, douze cases à relire pour savoir ce qu'elle dit.
- Une pièce d'achat enregistrée (facture, dépense, avoir, acompte) s'ouvre en résumé, comme la facture émise : la carte du
  fournisseur, puis la date et l'échéance (et le retard), la facture concernée d'un avoir ou d'un acompte, comment une dépense
  a été payée, l'objet, la catégorie, le montant (TTC, retenue, timbre et frais, taux d'une devise), l'affaire et les notes ;
  ses lignes se lisent comme du texte ; à droite, le geste suivant (régler, joindre le justificatif, se faire rembourser).
  Ce qui manque ne prend pas de ligne.
- Elle n'est pas verrouillée pour autant : rien n'est émis, c'est la pièce du fournisseur. « Modifier la pièce » rouvre le
  formulaire à sa propre adresse (`#/achat/<id>/modifier`, le chemin le dit : « … › PK-2611-07 › Modifier ») ;
  l'enregistrement y ramène au résumé, et « Voir le résumé » demande avant de jeter une modification. Passer de l'un à l'autre
  remplace la page : le retour mène à la liste, jamais d'un état à l'autre de la même pièce.
- Un mois clôturé ne se modifie pas : sa pièce reste en résumé, sans « Modifier la pièce ».
- Une pièce neuve enregistrée arrive sur son résumé.
- Ce qui renvoyait à une case du formulaire le dit : l'avoir qui n'est déduit d'aucune facture conseille « Modifie la pièce et
  choisis-la dans « Facture concernée » » ; le régime de TVA d'aujourd'hui s'applique depuis le résumé d'un geste, et la pièce
  s'enregistre.
- Au téléphone : le résumé, puis le règlement dans la barre du bas ; « Modifier la pièce » en tête, rien ne déborde.
- Vu en jouant la dépense : « DT » de « Montant payé (TTC) » tombait sous la case depuis qu'elle est une case de texte
  (1.356.9) ; la devise reste à côté.
- Test : `achat-resume-1357` (le résumé, la modification enregistrée, la modification abandonnée, le téléphone, une pièce neuve).
  Huit preuves. Les tests qui modifiaient une pièce enregistrée passent par « Modifier la pièce » ou son adresse
  (`achat-ecarts`, `achats-1310`, `annuler-1356`, `compta-1302`, `depots`, `lots`, `telephone-commercant`,
  `montants-fr-1356-9`) ; ceux qui ne faisaient que la lire la lisent désormais en résumé.
- Les rouges GitHub de la 1.356.9 :
  - deux tests attendaient encore l'affichage d'avant la 1.356.9 (`four-1356` : « 18000 » ; `stock-revue` : un prix relu
    avec `Number`) : retournés vers l'écriture française ;
  - `inventaire-1346` (Node 24) : au Cabinet, « Variation de stock passée en brouillard » s'affichait AVANT que l'onglet
    Inventaire soit rechargé ; un clic rapide sur « Saisir l'inventaire… » ouvrait une fenêtre construite sur l'inventaire
    d'avant, qui ignorait la variation écrite (la fenêtre aurait laissé refaire l'inventaire). Le message vient après le
    rechargement ;
  - `acompte-1356` (Node 24) : le seuil de la retenue et le taux de la FODEC se lisent au serveur sans être attendus ; un
    devis dessiné avant leur réponse annonçait « Retenue 1 % du client − 8,568 » sous le seuil, et ne se refaisait jamais.
    Le pont dit quand les deux règles sont lues (`reglesLues`) ; la pièce encore à l'écran les reprend et refait ses
    totaux, sans passer pour modifiée. Le test retarde désormais la règle de 2,5 s, comme une machine lente.

### 1.357.1 : la barre d'ajout d'une pièce ne propose plus de créer un double, et surligne ce qu'Entrée fera

Vu en rejouant le devis de l'hôtel à la souris (après la 1.357.0) : « Croissant » tapé dans la barre d'ajout d'un devis montrait
la prestation Croissant, et juste dessous « Créer la prestation « Croissant »… ». Un clic de travers, et le catalogue avait
deux Croissant, chacun avec ses prix et ses ventes.
- La barre d'ajout suit la règle des lignes (`propositionsCatalogue`) : quand un article porte déjà le nom tapé (accents et
  majuscules confondus), « Créer … » ne se propose pas ; « ou garder une ligne libre » reste.
- Le choix surligné est celui qu'Entrée fera. Rien ne correspond : Entrée garde une ligne libre — c'est le geste rapide d'une
  désignation libre, que la visite guidée et la reprise d'une pièce utilisent —, et c'est désormais elle qui se surligne
  (avant : « Créer … » surligné, pendant qu'Entrée ajoutait la ligne libre). « Créer … » se choisit à la flèche, et Entrée y
  ouvre la fiche de l'article, son nom repris, comme le clic (avant : une ligne libre du même nom, l'article jamais créé).
- Vu en vérifiant, pas un défaut : sur un poste qui ne garde rien, recharger un devis neuf demande d'abord (« Reload
  site? »), et le quitter pose « Quitter sans enregistrer ? » avec sa raison.
- Test : `hotel-1356` (sans correspondance, la ligne libre surlignée ; la flèche sur « Créer … » ; Entrée ouvre la fiche
  « zzz » ; « Panier de viennoiseries » tapé ne propose pas de le créer). Trois preuves. `reprendre` et `exemple`, qui
  tapent une désignation libre et Entrée, passent tels quels.

### 1.357.2 : la commande fournisseur dit un seul état, et la facture qui en vient nomme sa commande

Bout en bout 11, joué à la souris par la boulangerie : 10 sacs de farine commandés à la Minoterie du Cap Bon (l'article créé
depuis la commande), reçus en deux fois (6 puis 4), la facture MCB-8812 tirée des deux réceptions, réglée par chèque ; puis
20 sacs commandés par téléphone, 12 reçus, le reste soldé, et la facture MCB-8840.
- Une commande reçue en entier et facturée disait trois choses : « reçue » dans son titre (et dans la liste), « Envoyée »
  dans sa case Statut, et une frise cochée jusqu'à « Facturée ». Le titre et les listes disent « reçue et facturée » ; la
  case Statut garde le statut choisi qu'elle enregistre, mais son option se lit comme ce que disent les réceptions (« Reçue
  en partie », « Reçue et facturée »). Seuls « Soldée » et « Annulée » restent des choix à la main ; sur une commande
  soldée, l'option qui la rouvre se lit comme l'état qu'elle lui rendrait, pas « Envoyée ». Le statut du moteur ne change
  pas : les listes « en cours » et les relances le lisent toujours.
- Une commande soldée à 12 sacs sur 20 disait « Tout est reçu : la facture se pré-remplit… ». Elle dit ce qui est reçu et
  pourquoi le reste n'est plus proposé (« le reste n'est plus attendu », « la commande est annulée », « le reste est dans une
  réception en préparation »).
- Une quantité corrigée dans une réception faisait passer « Enregistrer le brouillon » en vert, devant « Valider la
  réception » : l'étape suivante devenait un brouillon de plus. « Valider » enregistre aussi (H-E19) et reste vert ; le
  brouillon paraît en secondaire.
- Le résumé d'une facture d'achat tirée d'une commande ne disait pas d'où elle venait : il porte « Commande BCF-2026-002 ·
  1 réception », la commande en lien.
- La désignation d'une ligne de commande ne cherchait rien dans le catalogue (seul le menu « Ajouter depuis le catalogue »
  le faisait) : elle propose les articles comme la facture d'achat, au coût d'achat ; un article absent se crée depuis la
  ligne, suivi en stock, et se pose sur elle. Le menu du catalogue propose aussi « + Nouvel article ».
- Dans toutes les listes de désignation (`suggererCatalogue` : pièces, achats, commandes), « + Créer … au catalogue » ne
  se choisissait qu'à la souris, et Entrée dessus ne faisait rien : la flèche y descend, il se surligne, Entrée ouvre la
  fiche.
- Le rouge GitHub de la 1.357.0 : `plateforme/pont.js` avait grandi de 6 lignes (le contrôle des frontières le tient à
  3 127 tant que le pont n'est pas découpé). Les lignes de `reglesLues` sont resserrées, sans relever la limite.
- Au Cabinet (deux chemins, un chiffre) : MCB-8812 s'écrit 401 au crédit 500,800 = 607 420,000 + timbre 1,000 (608) +
  TVA 79,800 ; MCB-8840, 599,760 = 504,000 + 95,760 — les montants de l'application. Mais la vue « Au kilomètre » ne savait
  pas montrer un avoir fournisseur : l'avoir de la peinture (476 DT, bout en bout 10) s'y lisait « 0,000 » au crédit, sans
  aucune ligne dessous (seuls les débits y passaient). Il se lit désormais le fournisseur au débit, sa charge et sa TVA au
  crédit, « · avoir » à côté du nom, et sa TVA garde son taux. Même famille : les habitudes d'un fournisseur (ce que la
  ligne au kilomètre propose) se lisaient sur sa dernière pièce ; un avoir venu en dernier n'a pas de charge au débit, et la
  proposition restait vide. Elles se lisent sur ses factures.
- À VÉRIFIER avec le cabinet pilote (bêta, moteur comptable) : un achat en stock s'écrit toujours au 607 (marchandises) ;
  la farine d'une boulangerie est une matière première (601). Le choix ne se fait nulle part aujourd'hui.
- Tests : `commandes-fournisseurs` (« Sable 0/4 » créé au clavier depuis la désignation ; « Valider » reste vert ; le résumé
  nomme la commande ; la liste, le titre et la case disent « reçue et facturée »), `achats-lot` (la case « Reçue en
  partie », la commande soldée et sa phrase, rouverte), `cabinet-saisie-piece` (un avoir de la Minoterie au kilomètre, et la
  proposition qui reste celle de sa facture). Douze preuves. La preuve de la 1.287.0 « une modification de la réception qui
  laisse « Valider » principal » est retournée : c'est désormais la règle (H-E19).

### 1.357.3 : la tournée d'une boulangerie, du bon signé à la facture du mois

Bout en bout 12, joué à la souris par la boulangerie : deux bons de livraison pour l'Hôtel Les Palmiers (120 baguettes et
40 croissants, puis 100 et 30), imprimés, signés, facturés ensemble en FAC-2026-004 (128 DT HT, 15,960 de TVA à 19 % sur
84, 1 de timbre : 144,960), réglée par virement ; puis le Cabinet.
- Un bon imprimé attendait sa signature sans geste pour la noter : la phrase renvoyait à la case Statut. « Le client a
  signé » est à côté de « Imprimer le bon à faire signer », et le note.
- Un bon sans ligne disait « Net à payer » et « le montant en lettres est écrit sur le bon », puis, dès sa première ligne,
  « Total TTC » et « rien n'est dû sur le bon » : la carte dit la même chose avant et après.
- Le client avait un second bon signé à facturer, et le vert d'un bon disait « Facturer » : ce bon seul. Deux factures pour
  une tournée, ou la facture groupée cherchée dans « Autres pièces ». Quand le client a d'autres bons remis ou signés sans
  facture, le vert dit « Facturer les 2 bons de ce client », la phrase les nomme, et « Facturer ce bon seul » reste à côté
  (U-11 : l'étape suivante se calcule). Un bon d'un autre client, ou déjà facturé, n'en est pas.
- La fenêtre « Facturer des bons de livraison » montrait une colonne « Objet » vide sur chaque bon et ne disait que le HT :
  la colonne ne paraît que si un bon a un objet, et la phrase dit ce que le client paiera (« 128,000 DT HT, 144,960 DT à
  payer, timbre compris »).
- La facture émise promettait « Chaque bon sera marqué « facturé » », et la liste des bons disait encore « signé ». Un bon
  dont la facture est émise se dit « facturé » dans les listes (le badge), en tête du bon (la pastille) et dans la puce et la
  case Statut (« Signé · facturé »). Le statut du moteur ne change pas (le filtre et `bonsAFacturer` le lisent) : c'est le
  MOT qui suit la facture, comme la commande fournisseur « reçue et facturée » (1.357.2). Un bon dont la facture attend en
  brouillon reste « signé ».
- Au Cabinet (deux chemins, un chiffre) : FAC-2026-004 s'écrit 411 au débit 144,960 = 701 44,000 (le pain à 0 %) + 706
  84,000 (les croissants à 19 %) + TVA 15,960 + timbre 1,000 ; le virement solde le 411. Les montants de l'application.
- À VÉRIFIER : le croissant s'écrit au 706 (prestations) parce que sa fiche le dit « prestation » ; la boulangerie de
  l'exemple de test n'a pas de métier réglé, donc un article créé à la volée ne s'y propose pas « produit fabriqué » (701).
  Dans une vraie entreprise, le métier choisi à l'assistant le propose (1.356.0). Le pain à 0 % (exonéré) — À VÉRIFIER avec
  le cabinet pilote.
- Tests : `autres-fiche` (« les bons d'une tournée » : le bon vide, la signature notée d'un geste, le vert qui groupe les
  deux bons du client et pas celui d'un autre client ni le bon déjà facturé, la fenêtre sans colonne vide et son montant à
  payer, la facture de deux bons, la liste et le bon facturé qui le disent), `livraisons` (la fenêtre dit aussi ce que le
  client paiera : 9 267,381, le chiffre que l'émission rend ensuite). Treize preuves.

### 1.357.4 : le relevé BIAT de novembre, du solde de départ corrigé à l'état envoyé au comptable

Bout en bout 13, joué à la souris par la boulangerie : le compte BIAT créé sans solde de départ (0 au 11/11, la banque
disait 48 250), treize mouvements pointés un à un sur le relevé, le solde du relevé saisi (25 403,573), l'écart cherché
puis trouvé (le solde de départ), l'état envoyé au comptable ; puis le Cabinet.
- Le solde de départ se LIT dans « Ton relevé face à SkanFact », et l'écart de 48 250 venait de lui. Pour le corriger, il
  fallait repartir dans « Où j'en suis › Actions › Modifier le compte ». « corriger » est sous le chiffre ; la fiche du
  compte s'ouvre le curseur dans la case et la valeur sélectionnée (la première frappe la remplace, 9.4.5) — au clavier
  aussi : au clic, la règle générale des montants sélectionnait déjà (le clic est une entrée de la personne), mais Entrée
  sur « corriger » laissait le curseur derrière « 0,000 » et « 48250 » s'y ajoutait. Et la page
  ENTIÈRE se redessine : mon premier jet ne redessinait que le rapprochement, et le disponible du haut, la prévision et le
  bandeau « sous zéro » gardaient l'ancien solde (vu à la souris : « Disponible − 22 393 » en rouge à côté d'un écart nul).
- « Envoyer l'état au comptable » écrivait « L'état de rapprochement est dans SkanFact (Trésorerie, Rapprochement) » : un
  écran que le comptable n'a pas (sa Banque travaille sur les relevés qu'il importe). Le message PORTE l'état : les
  mouvements pas encore passés à la banque, un par ligne et par date (dix au plus, puis « … et N autres »), puis le solde
  de SkanFact et son calcul — « 48 250,000 DT (= 48 800,000 DT + 300,000 DT − 850,000 DT) », l'écart en plus quand il en
  reste un. Le comptable le refait de tête. Ses lignes arrivent telles quelles dans les Messages du Cabinet.
- Au Cabinet (deux chemins, un chiffre) : le solde de départ arrive au brouillard (1.356.0), 532 au débit contre le compte
  d'attente 471, au montant CORRIGÉ — 48 250,000, la correction a remplacé l'écriture d'avant. C'est le comptable qui décide
  ce que l'attente représente (apport, retrait de caisse, solde déjà repris).
- Tests : `tresorerie-1357` (neuf : le message avec l'écart, « corriger » qui sélectionne la valeur, le disponible qui
  suit, ouvert au clavier, le message sans écart et ses deux mouvements en attente, le même texte au Cabinet, l'écriture
  d'ouverture à 48 000 puis à 48 250), `pont-remise-1299` (le message d'un relevé tout pointé finit sur « Solde dans
  SkanFact : 3 477,482 DT. »). Huit preuves.

### 1.357.5 : l'inventaire de fin de mois d'une boulangerie, la farine comptée

Bout en bout 14, joué à la souris par la boulangerie : la farine (22 sacs à 42 DT, achetés en novembre) n'est pas notée à
chaque fournée ; on compte ce qui reste — 15, puis 12, puis 10 sacs — et on prévient le comptable ; puis le Cabinet.
- La question avant d'enregistrer disait « Enregistrer 1 mouvement d'inventaire au 12/11/2026 ? Le stock théorique sera
  aligné… », sans dire quel article ni combien, avec le bouton rouge d'une suppression. Elle s'intitule « Enregistrer
  l'inventaire du 12/11/2026 ? », dit article par article ce qui change (« Farine : 15 → 12 (−3), − 126,000 DT au coût
  moyen ») et ce que ça fait (ce qui manque compte comme utilisé ou perdu : sa valeur entre dans le coût du mois ; ce qui est
  en plus revient au stock), et son bouton est vert : un mouvement d'inventaire se corrige, il ne détruit rien. Le texte de
  la page nomme aussi la matière utilisée sans être notée, à côté de la casse et de l'oubli.
- « Prévenir mon comptable » écrivait « 1 écart, soit 126,000 DT en moins » : lequel ? Le message nomme chaque écart, un par
  ligne (dix au plus) — « Farine : 12 → 10 (−2), − 84,000 DT » —, comme l'état du relevé (1.357.4) : le comptable n'a pas
  l'écran de l'inventaire.
- Au Cabinet (deux chemins, un chiffre) : l'état envoyé arrive avec le même chiffre (1 article, 420,000 DT = 10 × 42). Mais
  il était proposé EN VERT comme « l'inventaire de 2026 », alors qu'il est daté du 12/11 : le reprendre écrivait la
  variation 37/603 sur le stock de mi-novembre. Un état daté avant la fin de l'exercice le dit (« pas celui de la fin de
  l'exercice (31/12/2026) : le stock bougera d'ici là »), le reprendre reste possible sans être vert (une situation
  intermédiaire), et « Lui demander son état au 31/12/2026… » est à côté — vert une fois l'exercice fini ; demandé, la ligne
  le dit.
- Vérifié : ranger la farine au 607 (marchandises) plutôt qu'au 601 (matières premières) ne change aucun total — l'état de
  résultat et la liasse lisent le compte 60 entier (« Achats consommés »), et les SIG ne calculent pas de marge
  commerciale. Le classement reste À VÉRIFIER avec le cabinet pilote (noté en 1.357.2).
- Tests : `inventaire-1357` (neuf : la question chiffrée sur deux articles, un manque et un surplus, et son bouton vert
  ; le résumé ; le message qui nomme les deux écarts et l'état envoyé, 702,000 = 15 × 42 + 6 × 12 ; au Cabinet, l'état
  de mi-mois qui le dit, le reprendre sans vert, la demande au 31/12 puis « demandé le »). Sept preuves.

### 1.357.6 : les espèces du comptoir versées à la BIAT, et le tiroir qui se compte

Bout en bout 15, joué à la souris par la boulangerie : la caisse ouverte avec un fond, des ventes au comptoir, 50 DT
versés à la BIAT, une dépense payée « à la caisse », puis le Z ; puis le Cabinet.
- Le Z ne connaissait que les tickets et la paie : il annonçait le soir **50 DT de manque** pour les 50 DT versés le
  matin, et le livre les sortait une seconde fois contre le 658. Tout ce qui entre ou sort du tiroir hors des tickets, la
  caisse ouverte, se note maintenant dans la session (migration 0209) — mouvements de la Trésorerie, règlements
  fournisseurs, factures encaissées au comptoir, dans les deux sens — et le Z les nomme : « Sorti du tiroir ailleurs »,
  « Entré dans le tiroir ailleurs ». Vérifié : le Z du versement tombe juste, écart 0.
- Un règlement en espèces partait de la **BIAT** : sans compte nommé, les livres et la Trésorerie prennent le compte par
  défaut. Le compte suit maintenant le mode tant que personne ne l'a choisi à la main — espèces → la caisse, carte ou
  virement → la banque — dans le règlement d'un client, d'un fournisseur, le règlement groupé, le bulletin et l'avance ;
  une dépense « payée à la caisse le jour même » part de la caisse.
- « Verser des espèces à la banque… » dans le menu de la caisse : un virement prérempli de la caisse vers la banque.
- Une **caisse se compte**, elle ne se rapproche pas : elle n'a pas de relevé. L'onglet Rapprochement la propose comme un
  tiroir (« Caisse du comptoir · tiroir à compter ») : ce que SkanFact garde pour elle, le total compté, le verdict pendant
  la frappe (« Il manque 0,500 DT dans le tiroir »), et « Noter l'écart dans la caisse » (658 / 758, À VÉRIFIER) ; la
  carte du compte dit « Comptée le … » et propose « Compter le tiroir ». Les mouvements de caisse ne comptent plus dans
  « non pointé » ni dans les contrôles de clôture.
- La carte d'une dépense disait **« Payé 6,000 DT »** après la suppression de son règlement, au-dessus de l'étape
  « reste 6,000 DT » : elle dit « À payer » tant que la dépense ne l'est pas (et suit le choix « Payée » d'une dépense
  neuve) ; la question de suppression la nomme (« La dépense redeviendra due de 2,500 DT »), et le menu d'une pièce dit
  ce que « Supprimer » emporte (« elle et son justificatif »).
- Au Cabinet (deux chemins, un chiffre) : le versement arrive en 532 / 54 (50,000 DT), l'écart du comptage en 658 / 54, et
  le 54 finit à 3,000 DT, comme la caisse de la Trésorerie.
- Rouge GitHub de 81fe8cb (Node 22) : `dossiers-cabinet` lisait une seule fois l'opacité d'un bouton pendant que la liste
  se redessinait à l'arrivée de ses données (une ligne détachée rend « ») ; le test attend la ligne stable.
- Tests : `caisse-flux-tiroir` (serveur, neuf : le versement, la monnaie, la levure, la facture de l'hôtel, la pièce
  changée ou supprimée, l'ouverture, l'ancien Z et la veille hors du compte ; l'avoir remboursé et le trop-perçu rendu ;
  les contraintes de 0209) ; `tiroir-1357` (écran, neuf : le comptage, l'écart noté et parti au Cabinet, le compte qui suit
  le mode, la dépense « À payer »). Quinze preuves.

### 1.357.7 : le prêt du four, d'avant le solde de départ, et sa première échéance

Bout en bout 16, joué à la souris par la boulangerie : le prêt BIAT de 18 000 DT pour le four, reçu le 02/11 — avant le
solde de départ de la BIAT (48 250 DT au 11/11), qui le comprend déjà —, puis la première échéance ; puis le Cabinet.
- Le prêt figurait dans la liste des mouvements, **compté dans la variation du pied** (+ 18 000 DT), mais pas dans le solde
  de la BIAT : l'écran se contredisait. Et les livres l'écrivaient à la banque, dans les deux moteurs : le 532 à 66 250 DT
  pour un compte qui en a 48 250. Un flux daté avant le solde de départ de son compte (`compteAvantDepart`, une règle pour
  les écritures, la liste et les fenêtres) passe maintenant en opération diverse contre la contrepartie du solde de départ
  (12 chez le client, 471 sur le serveur) : la banque ne bouge pas, le prêt entre au 16.
- La fenêtre du mouvement le dit **avant** d'enregistrer (« Daté avant le solde de départ de « BIAT compte courant »
  (48 250,000 DT au 11/11/2026) : ce mouvement y est déjà compris, et ne le fera pas bouger. Passé après ton relevé de
  départ ? Corrige sa date. ») ; les fenêtres de règlement (client, fournisseur, virement groupé) aussi. La liste marque la
  ligne « Déjà dans le solde de départ du … », grise son montant, et son pied ne la compte plus (« hors 1 mouvement déjà
  compris dans le solde de départ »).
- La fenêtre du compte disait seulement « tout ce qui est saisi après s'y ajoute » : déplacer la date du départ du 11/11 au
  01/11 faisait passer la BIAT de 25 853 à 43 853 DT **sans un mot**. Elle dit maintenant ce que la date englobe (« Avant le
  11/11/2026 : 1 mouvement (+ 18 000,000 DT), déjà compris dans ce solde de départ ») et ce que le changement ferait au
  solde d'aujourd'hui. Changer cette date réécrit le brouillard au pont (`planChange`) : c'est par là que le prêt écrit
  avant cette version a rejoint le 471. **À VÉRIFIER** : un brouillard écrit avant la 1.357.7 ne se corrige qu'à la
  prochaine modification de la pièce ou du plan de trésorerie (aucune réécriture à la montée de version).
- **L'échéance d'emprunt** envoyait tout au 16 : 1 635 DT dont 135 d'intérêts diminuaient la dette de 1 635 et oubliaient
  135 DT de charges — le résultat trop beau, la dette trop basse. « Dont intérêts » n'existe que pour cette nature, juste
  sous le montant ; le capital se calcule pendant la frappe (« Capital remboursé : 1 500,000 DT · les intérêts sont une
  charge. ») ; des intérêts plus grands que l'échéance sont refusés en montrant la case ; une échéance qui se répète les
  reprend (à corriger chaque mois). L'écriture : 16 1 500 / 651 135 / 532 1 635, la même au pont ; le résultat et le seuil
  comptent les 135. La liste dit « dont 135,000 DT d'intérêts ». Rôle neuf `interets` (651, **À VÉRIFIER**) dans les deux
  plans.
- L'invite du libellé suit la nature (« Échéance mensuelle du prêt », « Prêt de la banque pour le matériel »…) au lieu de
  « Salaires de septembre » partout.
- Au Cabinet (deux chemins, un chiffre) : le prêt arrive en OD 471 / 16, l'échéance en 16 / 651 / 532 ; hors l'historique
  saisi par le cabinet, le 532 du pont tombe sur la BIAT de la Trésorerie (25 853,413 DT avant l'échéance).
- Tests : `tests/moteur/emprunt-1357` (les deux moteurs : la règle partagée, le prêt d'avant le départ, le jour du départ,
  le virement dont un côté ou les deux précèdent, les intérêts bornés, l'échéance à trois lignes, le résultat) ;
  `tests/web/emprunt-1357` (écran : la ligne marquée et le pied, la fenêtre du mouvement, celle du compte, l'échéance et son
  refus, le pont).
- Rouge GitHub de la 1.357.6 (b0e64c1), réparé ici. (1) Le serveur reconnaissait deux saisies de l'écran à leur phrase
  française (« Ouverture de la caisse », « Rendu sur le ticket ») : le catalogue des textes l'interdit. L'ouverture porte sa
  marque `ouverture: true` ; l'argent rendu sur un retour ne peut être que sur un ticket, déjà écarté. (2) Un retour de
  ticket prenait un numéro d'avoir SUR LE POSTE alors que le serveur numérote : le compteur bougé partait au prochain
  enregistrement — le comptage du tiroir avant le Z, ajouté en 1.357.6 — et le serveur refusait (« SkanFact a déjà donné
  AVO-2026-001 »), le Z restait sous la question. Le numéro local se rend, comme pour un ticket (`encaisser`). Rejoué à la
  souris : vente, retour d'un pain (AVO-2026-002 donné par le serveur), comptage, Z sans question. (3) Deux tests recopiaient
  l'état d'avant : « elle et son justificatif » sur un achat qui n'en a pas (la 1.357.6 dit « la pièce entière ») ; et une
  fiche lue avant la fin de l'enregistrement (attente).
- Deux tests suivent la règle de la 1.357.7 : l'avance d'hier, avant le solde de départ de la caisse posé aujourd'hui, passe
  en OD au 471 ; les frais du mois dernier sur une BIAT ouverte aujourd'hui y passeraient aussi — le test recule le départ.


### 1.357.8 : le résumé de l'achat, comme celui de la facture

Demandé par Skander, deux captures à l'appui : l'achat PK-2611-07 « reste comme ça » (le formulaire) pendant que la facture de
vente se lit en résumé. La première capture datait d'avant la 1.357.0 (12/11 à 10 h 02 ; la 1.357.0 est arrivée à 17 h 12) ;
ce qui restait différent de la vente, cette version l'aligne, et le joue à la souris.
- **La ligne « Comptabilité »** du résumé, comme celle d'une facture émise : « Au journal des achats, au brouillard : ton
  cabinet la validera » ou « Validée par ton cabinet le …, écriture n° … », et « voir l'écriture » ouvre la MÊME fenêtre que la
  vente (`fenetreEcriture`, sortie de la page de la facture : journal, date, comptes, total équilibré).
- **Le pont ne trouvait jamais l'écriture d'un achat** : l'origine d'une écriture est l'identifiant SERVEUR de la pièce
  (`achats.piece.id`), l'écran cherchait le sien (`ref_v10`). La frise « Au cabinet » ne disait donc jamais « vue » ni
  « validée » depuis la 1.155.12 — rien ne le montrait, puisqu'aucun test ne lisait cette étape. L'identifiant d'abord ; sinon
  la SEULE écriture d'achat de ce numéro ; deux achats au même numéro (le « 001 » de deux fournisseurs) : rien, plutôt que
  l'écriture d'un autre.
- **Et la frise perdait la réponse** quand le cabinet est appris après la page : l'étape « Au cabinet » naît au redessin, et
  disait « attend le justificatif » à côté d'un résumé qui la savait au brouillard. L'écriture se lit UNE fois pour la page, et
  la frise la repose après chaque redessin. Le test retarde la réponse qui apprend le cabinet pour jouer ce cas.
- **La ligne « Affaire » est toujours là**, avec son geste : la MÊME bulle que la facture (recherche, la liste, « Nouvelle
  affaire » avec le nom tapé), et la pièce s'enregistre avec (`persist` : clôture et licence passent par leurs portes). La
  première version posait une liste fermée sur « Aucune affaire » quand l'entreprise n'en a pas : une impasse. Ranger ne touche
  ni un montant ni l'écriture.
- **Au téléphone, les lignes en liste** (désignation, montant, ce qui le fait — quantité, prix, TVA, stock ou immobilisation,
  TVA non déductible), comme la facture émise ; le tableau empilé se cache. La règle de telephone.css qui l'empile porte
  `:has(> #b-lines)` — un id compte dans la priorité d'un `:has` — et gagnait contre la première version : le tableau restait
  au-dessus de la liste. Vu sur la capture du téléphone, jamais dans un test de source.
- **Une affaire sans client** se disait « — · en cours » dans toutes les listes d'affaires (`clientName('')` rend un tiret) :
  le client ne s'écrit que s'il existe.
- Le test du résumé 1.357.0 suit la règle : le résumé finit par l'affaire, et la ligne « Comptabilité » s'y glisse quand
  l'écriture est lue.
- **Rouge GitHub de 8bd8be8 (1.357.7, Node 24), réparé** : acompte-1356 lisait sur la page du devis la frise d'une facture
  (« Émise aujourd'hui… El Fatoora partira après la signature »). Pas un test fragile : un vrai défaut, que la machine lente
  a montré. Trois rappels de la frise d'une vente (l'état El Fatoora, les deux « vue par le lien ») cherchaient `#ed-frise` au
  moment de la RÉPONSE ; arrivée après le départ vers le devis, celle de la facture d'acompte remplaçait la frise du devis par
  la sienne — le garde `isConnected` ne protégeait rien, la frise trouvée était déjà celle de la page d'arrivée (règle 10.5.0 :
  une réponse en retard ne repeint pas l'écran qu'on a quitté). La frise de la page se garde par son hôte. Le test retarde
  désormais la réponse El Fatoora pour jouer ce cas à chaque fois.

### 1.357.9 : payer à l'État la TVA que le cabinet a déclarée (bout en bout 17)

Joué à la souris dans l'environnement de test : une pâtisserie confiée au Cabinet Jlassi, octobre déposé par Leila le 10/11,
798,000 DT de TVA collectée, 351,500 de déductible, un timbre. Chez la gérante, la TVA d'octobre disait « Déposée par ton
cabinet le 10/11/2026 » et rien d'autre : ni le montant à verser, ni la date limite, ni où noter le virement — elle payait à la
recette des finances, et sa banque, dans SkanFact, ne le voyait jamais. Le cabinet, lui, n'avait que « Marquer payée » à
pointer de mémoire.
- **Ce que la déclaration fait verser, et avant quand** : « À verser au Trésor : 447,500 DT (446,500 DT de TVA + 1,000 DT de
  timbres), avant le 28/11/2026 », sous « Déposée par ton cabinet ». Le montant est la case « total à décaisser » du cabinet
  (TVA nette, timbres, retenues opérées ; la part paie se paie depuis la Paie, la ligne d'en dessous). Sa composition ne
  s'écrit que quand les cases du cabinet la refont au millime : un total de 447,500 sous « TVA à reverser 446,500 » faisait
  chercher le dinar qui manque. Une case vide ne réclame rien. La ligne garde l'encre du texte (l'ambre une fois la date
  passée) : dans la teinte de « Déposée », on la croyait faite.
- **« Noter le paiement… »** (le bouton principal, sauf quand une pièce a changé depuis le dépôt) ouvre le mouvement déjà
  rempli : Impôts et taxes, contre le 4365 (la TVA à décaisser que l'écriture du mois a créditée), le reste à verser, « TVA
  d'octobre 2026 », référence `TVA-2026-10`. Tout reste modifiable (le jour de la recette, le compte). La ligne dit ensuite
  « Versée au Trésor le 12/11/2026 : 447,500 DT, depuis BIAT · Voir le mouvement » ; un versement en deux fois dit ce qui
  reste ; payée d'après le cabinet sans rien de noté, elle propose de noter le paiement pour que la banque soit juste.
- **Le pont** : le mouvement part au cabinet comme tout mouvement (D 4365 / C la banque, au brouillard du journal BQ), et
  l'étape de la déclaration le dit : « Le client a versé la TVA du mois le 12/11/2026 : 447,500 DT — son versement attend au
  brouillard de la banque » ; « Marquer payée » prend la date du DERNIER versement du client (la part paie, la TVA). Une
  écriture de déclaration au journal OD porte la même pièce : seule une écriture de banque ou de caisse est un versement.
- **Les échéances** : la table « Tes déclarations de TVA, chez ton cabinet » dit « 447,500 DT à verser » ou « versée le … », et
  « Voir la TVA » mène au mois.
- **L'onglet TVA s'ouvre sur le mois qui se déclare** (règle U-12) : le 13 novembre, il ouvrait novembre, vide (« Rien à
  déclarer »), pendant qu'octobre — déposé, à payer avant le 28 — attendait plus bas dans le tableau. Tant qu'on n'a pas
  choisi de mois, il ouvre le mois d'avant quand celui-ci a des chiffres ; un mois choisi à la main ne bouge jamais. Vu à la
  souris, au premier clic.
- **Rouge GitHub de d8fbe44 (1.357.8), réparé** : « Ranger dans une affaire » faisait 15 points de haut au téléphone (la sonde
  des cibles, sur l'achat). Les liens des lignes du résumé, et ceux sous la TVA du mois, ont la taille du doigt.
- **Le poids (L11, `docs/leger.md`)** : ce que la version ajoute faisait passer le premier écran à 1 301 Ko pour un seuil de
  1 300. La feuille de la caisse ne part plus avec la page : la Caisse l'attend à sa première ouverture (« Un instant… »),
  et la garde ensuite pour le hors-ligne. Mesuré : 1 295 Ko. La marge n'est plus que de 5 Ko, et le levier suivant est
  choisi (la messagerie).
- À VÉRIFIER avec le comptable : la date limite de paiement (celle du dépôt, réglable dans le calendrier fiscal) et la façon de
  payer (recette des finances, télépaiement).

### 1.358.0 : un achat payé de la poche du gérant (bout en bout 18)

Joué à la souris dans l'environnement de test : la gérante de la pâtisserie achète des cartouches d'encre (59,500 DT TTC)
avec sa carte PERSONNELLE. La dépense proposait « à la caisse », « par carte » et « pas encore » : « par carte » sortait les
59,500 DT de la BIAT, qui ne les avait jamais payés, et l'entreprise ne disait nulle part qu'elle les devait à sa gérante. Le
relevé ne tombait plus juste, et le compte courant de la gérante (4421) ne gardait aucune trace de ce qu'elle avait avancé.
- **« de ta poche : l'entreprise te le doit »**, quatrième choix de « Payée » sur une dépense neuve. La dépense s'enregistre
  réglée (« le 13/11 · de ta poche »), mais rien ne sort de la caisse ni de la banque.
- **Le règlement d'une facture d'achat** propose « De ta poche » parmi les comptes — même quand l'entreprise n'a qu'une
  banque, puisqu'il y a alors deux réponses à « d'où vient l'argent ? ». Le mode reste choisi (la carte, les espèces) ; le
  tableau des règlements dit « Carte · De ta poche ».
- **Le moteur** : un compte réservé (`POCHE`, `@poche`), qui n'est pas un compte de trésorerie. `cashMovements` l'ignore
  (la Trésorerie, le rapprochement, la prévision ne le voient pas) ; `journalDeCompte` l'écrit en opérations diverses
  contre le compte courant d'associé : D 401 / C 4421, « Règlement fournisseur … (avancé par le gérant) ». La règle du
  solde de départ (1.357.7) ne s'y applique pas : la poche n'a pas de solde de départ.
- **Ce que l'entreprise doit** : la Trésorerie, sous « À surveiller », dit « 160,650 DT avancés de ta poche — 2 achats
  payés avec ton argent : l'entreprise te les doit » (`avancesDuGerant`), et « Te rembourser… » ouvre le mouvement
  prérempli de la nature neuve **« Remboursement de mes avances »** (D 4421 / C la banque). La ligne disparaît quand tout
  est rendu ; un remboursement partiel se dit (« 59,500 DT déjà rendus, l'entreprise te doit le reste »). Rembourser une
  note de frais n'est pas un « Retrait ou dividende » : la nature a son nom.
- **Le pont** : le serveur suit la même règle (`POCHE` dans `plan.ts`, la nature `avances` dans `mouvements.ts`, le
  libellé `reglement_fournisseur_poche`) ; au brouillard du Cabinet, l'avance arrive au journal OD, le remboursement au
  journal de banque, aux mêmes comptes et montants que dans l'application (deux chemins, un chiffre).
- À VÉRIFIER avec le comptable : un gérant qui n'est pas associé (salarié, gérant non associé d'une SARL) ne se range pas
  au 4421 ; le comptable choisira un autre compte de tiers. La bulle le dit.

### 1.358.1 : un achat en euros chez un fournisseur à l'étranger (bout en bout 19)

Joué à la souris dans l'environnement de test : la pâtisserie achète des moules en France, 420 € HT, facture au taux de
3,35, réglée par virement BIAT au taux du jour de 3,40. Le moteur faisait juste (1 407 DT à la facture, 1 428 DT payés, perte
de change de 21 DT au 655, les mêmes écritures des deux côtés du pont) ; trois défauts se trouvaient autour.
- **La ligne neuve partait à 19 % « toute déductible »** chez un fournisseur à l'étranger. Sa facture ne porte pas de TVA
  tunisienne : laissée telle quelle, elle faisait récupérer 79,80 € de TVA (267 DT) qu'aucune pièce ne montre. Une règle
  unique dans le moteur, `tauxAchatPropose` (et `fournisseurEtranger` : ses factures dans une autre devise que la nôtre),
  donne 0 % aux lignes neuves (la ligne vide, « + Ligne libre », un article du catalogue, une commande fournisseur), et les
  lignes encore vides suivent le fournisseur quand on le choisit. Une ligne déjà remplie garde son taux : « Avant
  d'enregistrer » dit « TVA sur 1 ligne : un fournisseur à l'étranger n'en facture pas », avec « Passer à 0 % ». Rien ne
  bloque : le taux reste modifiable.
- **La fenêtre de règlement d'un achat en devise écrasait le montant** : la phrase du taux portait la classe `span-2` dans
  une grille à une colonne, qui en créait une seconde, invisible. La case du montant tombait à 11 px (« 4: EUR » au lieu
  de 420,00), la date était coupée. Les deux fenêtres (paiement d'une facture, règlement d'un achat) passent par une seule
  rangée, `rangeeDateCompteTaux` : la date et le taux côte à côte, le compte, puis l'encadré qui dit ce qui passe à la
  banque et l'écart de change — et qui nomme la pièce réglée (« la facture », « l'avoir »).
- **Le taux gardait le nom « combien de DT pour 1 DT »** pour un lecteur d'écran, après le choix de l'euro.
- La bulle du taux de change dit le cas du fournisseur à l'étranger, la TVA payée à la douane (une pièce à part) et l'écart
  de change. À VÉRIFIER avec le comptable : comment saisir la TVA d'importation payée à la douane.
- **Rouges GitHub de d5b77f0 et de eb07c15 (1.357.9 et 1.358.0), réparés — une seule cause.** « Les achats 1.310 » et « la
  paie confiée au cabinet » tombaient sous Node 24, une fois sur deux. Ce n'était pas les tests : un enregistrement part au
  serveur APRÈS que l'écran a dit « Enregistré », et recharger la page dans la seconde coupait l'envoi en route — la pièce
  (ou le paiement noté) restait à l'écran, et le serveur ne l'avait jamais reçue. Chez quelqu'un qui ferme l'onglet juste
  après avoir enregistré, c'est une saisie perdue sans un mot. L'enregistrement en arrière-plan survit maintenant à la
  page qu'on ferme ou qu'on recharge (`keepalive`), dans la limite que le navigateur accorde (64 Ko en route) : au-delà —
  le premier enregistrement de tout un dossier, une pièce aux notes très longues —, l'envoi part comme avant. Les autres
  envois (une émission, l'ouverture de la caisse, une réponse au comptable) attendent leur réponse à l'écran : ils ne le
  demandent pas.
- Pour les tests : quand le service worker contrôle la page, Playwright ne voit plus un envoi `keepalive` par une
  interception posée sur la PAGE ; posée sur le CONTEXTE, si. Le test des enregistrements concurrents, qui ralentit exprès
  le premier envoi, passe par le contexte (sans quoi son ralenti ne s'appliquait plus, sans un mot). Le test de la 1.310
  attend désormais que les écritures en route soient arrivées avant de recharger.

### 1.358.2 : une facture de décembre réglée en janvier (bout en bout 20)

Joué à la souris dans l'environnement de test : un traiteur facture le buffet du réveillon à l'Hôtel Mouradi Gammarth le
18 décembre 2025 (3 571 DT). Le cabinet ouvre 2026, l'hôtel règle 2 000 DT le 10 janvier, et un avoir de 595 DT suit pour
des couverts non servis. Côté client, les chiffres tombaient juste : la TVA de janvier en crédit de 95 DT, les
à-nouveaux, 976 DT encore dus. Quatre défauts :
- **Au Cabinet, le même client comptait comme DEUX tiers au lettrage de 2026.** La ligne d'à-nouveaux ne gardait que le
  NOM du client, et son règlement de janvier son identifiant. Le lettrage les rangeait à part : la facture « due » d'un
  côté, le règlement « en trop » de l'autre. Une ligne d'écriture a maintenant une case pour son tiers
  (`compta.ligne.tiers`, migration 0210). La saisie et la contre-passation la gardent, un identifiant d'une autre
  entreprise est ignoré, et le pont l'envoie. Une ligne écrite avant (son nom seul) se range sous le seul tiers du livre
  qui porte ce nom. Quand deux tiers ont le même nom, elle garde son nom seul : on ne devine pas.
- **La grille de 2026 proposait la date du « 31/12/2025 ».** Une pièce vide reprend la date de la précédente (la saisie
  au kilomètre), mais pas d'un exercice à l'autre : elle propose une date de l'exercice affiché. Une pièce déjà commencée
  garde ce qu'on a tapé.
- **« Rien n'attend au brouillard » s'affichait au-dessus d'AN-2026.** Le compte des écritures au brouillard oubliait
  les à-nouveaux, que « Voir le brouillard » montre juste en dessous. Il compte maintenant tout le brouillard.
- **Côté entreprise**, la puce « dernière : FAC-2025-001 · 18/12 » se lisait en janvier comme le 18 décembre à venir.
  Une date d'une autre année s'écrit maintenant en entier (18/12/2025), dans la puce comme dans « dernière vente à ce
  client ». Et « Avant d'émettre » disait « Sous 1 000 DT : pas de retenue sur l'avoir, comme sur sa facture » pour un
  client SANS retenue, ce qui donnait une fausse raison. La phrase du seuil n'apparaît plus que si le client a une retenue.
- **En jetant le brouillon de l'avoir** (refait à la souris pour vérifier) : la question disait « Supprimer Avoir
  (brouillon) ? », avec une majuscule au milieu de la phrase et sans dire de quoi c'était le brouillon. Elle dit
  maintenant « Supprimer ce brouillon d'avoir ? », ou « Supprimer la pièce DEV-2026-004 ? » pour une pièce numérotée.
  Sur un poste qui ne garde rien (« mon ordinateur » non coché), une seconde question suivait : « Quitter sans
  enregistrer ? … cet avoir commencé est perdu », à propos d'une pièce qu'on venait de supprimer. La suppression libère
  maintenant l'éditeur, et la copie gardée sur l'appareil part avec la pièce. Pour un mois clôturé, le refus s'affiche
  désormais AVANT la question : avant, il arrivait une fois la suppression confirmée.
- À VÉRIFIER avec le comptable : au Cabinet, le numéro affiché d'une écriture continue d'un exercice à l'autre. C'est son
  rang dans la chaîne du dossier, une décision prise dans docs/cabinet.md ; si un cabinet veut repartir à 1 chaque
  1er janvier, il le dira. Autre point : à partir de quelle date la balance âgée de 2026 compte-t-elle l'âge d'une facture
  reprise en à-nouveaux, celle de la facture ou le 1er janvier ?
- Tests : `tests/compta/saisie.test.ts` (le tiers d'une ligne au serveur : gardé, refusé d'une autre entreprise, recopié
  par la contre-passation) et `tests/web/tiers-janvier-1358-2.test.ts` (tout le parcours, dans les deux applications) ;
  `tests/moteur/tiers-nom-unique-1358-2.test.ts` (deux homonymes : le nom reste seul) ; treize preuves « tiers de
  janvier 1.358.2 ».
- **Rouge GitHub de 0114d02 (1.358.1), réparé.** La règle F12 (un gros fichier ne grandit pas hors de `modules/`) refusait
  `plateforme/pont.js` : 3 142 lignes pour 3 127. L'envoi qui survit au rechargement (`keepalive`) est la fonction d'envoi
  elle-même : son plafond est relevé, avec la raison écrite dans `modules/frontieres-connues.json`. Le même contrôle aurait
  refusé ce lot-ci (`pont-cabinet.js`, 2 819 pour 2 806) : la règle « un nom que porte un seul tiers le désigne » vit
  maintenant dans le moteur partagé (`tiersParNomUnique`, compta.js), le pont ne fait que l'appeler, et il ne reste que
  trois lignes à relever (l'identifiant du tiers qui voyage avec chaque ligne).

### 1.359.0 : un chèque client revenu impayé (bout en bout 21)

Joué à la souris dans l'environnement de test : l'Hôtel Mouradi Gammarth règle la facture FAC-2025-001 du traiteur par
chèque (CHQ 4521873 ATB, le solde de 976 DT, remis début novembre). Le 6 novembre, la banque le rend impayé et prend
15 DT de frais. Avant cette version, SkanFact n'avait aucun geste pour ça. Il fallait supprimer le paiement, ce qui
effaçait toute trace du chèque, ou saisir un « remboursement » négatif : la facture redevenait due, mais la Trésorerie,
l'écriture du comptable et la relance parlaient d'un remboursement fait au client, ce qui est le contraire de ce qui
s'est passé.
- **« Le chèque est revenu impayé… »** dans le menu d'un paiement par chèque ou par effet. La fenêtre demande le jour où
  la banque l'a rendu et ses frais, et annonce avant d'enregistrer ce que la facture redeviendra due. Le paiement
  d'origine reste dans l'historique, marqué « revenu impayé le 06/11/2026 ». En face, une ligne « Chèque impayé »
  (« Effet impayé » pour une traite) reprend son montant, et la facture redevient due de ce montant. Le rejet est un
  paiement négatif qui désigne le paiement qu'il annule (`rejetDe`), et le serveur le garde (`rejet_de`, migration
  0211).
- **Le serveur refuse un rejet qui ne tient pas** : un rejet qui ne désigne aucun paiement reçu de la facture, qui n'en
  reprend pas le montant exact, ou un second rejet du même paiement. Rien n'est alors enregistré, et le refus le dit.
- **Les frais pris par la banque** partent en Trésorerie (« Frais de rejet CHQ 4521873 ATB ») et, chez le comptable, au
  compte de frais bancaires (627).
- **Chez le comptable**, l'écriture s'appelle « Chèque impayé FAC-2025-001 — Hôtel Mouradi Gammarth », datée du jour du
  rejet, et remet la somme au débit du client (411). Le lettrage du Cabinet dit 976 DT dus, comme la facture côté
  client : deux chemins, un chiffre.
- **La relance le dit au client d'abord** : « Votre chèque CHQ 4521873 ATB du 02/11/2026 (976,000 DT) nous est revenu
  impayé le 06/11/2026. » Cette phrase s'ajoute après la salutation, et le reste du modèle (que la personne a pu écrire
  elle-même) ne change pas. En anglais aussi. L'encart à côté de la facture le dit avant de proposer la relance.
- **Le chèque était bon finalement** (une erreur de la banque) : « Retirer ce rejet » remet le paiement comme reçu,
  après une question qui dit ce que la facture redeviendra. Supprimer le chèque lui-même emporte son rejet, et la
  question le dit (« Son rejet du 06/11/2026 part avec lui »).
- **Vu au passage** : l'encart d'une facture en retard disait « Le dernière relance est prêt à partir ». Il dit
  maintenant « Le rappel est prêt », « La relance est prête » ou « La dernière relance est prête ».
- **Rouge GitHub de 2737bda (1.358.2), réparé.** Le contrôle éclair des preuves en signalait six à reprendre. Cinq
  preuves visaient encore l'ancienne définition de la saisie au Cabinet, alors que la 0210 l'avait redéfinie (le tiers
  d'une ligne) : elles visent maintenant la 0210. La sixième (« avoir 1.356.6 c ») cherchait une ligne que la 1.358.2
  avait modifiée. Les six sont de nouveau prouvées.
- À VÉRIFIER avec le comptable : les frais de rejet se refacturent-ils au client (et avec quelle TVA) ? SkanFact ne les
  ajoute pas à la facture. Pour une facture avec retenue à la source, faut-il défaire aussi la retenue d'un paiement
  rejeté ? Pour une facture en devise, le rejet reprend le taux du paiement d'origine : est-ce le bon taux, ou celui du
  jour du rejet ?
- Tests : `tests/moteur/cheque-impaye-1359.test.ts` (la facture redevient due, la Trésorerie, la relance en français et
  en anglais) et `tests/web/cheque-impaye-1359.test.ts` (tout le parcours : deux rejets faux refusés au serveur, la
  fenêtre, la facture, la relance, l'écriture et les frais au Cabinet, le rejet retiré, puis le chèque supprimé avec son
  rejet) ; dix preuves « chèque impayé 1.359.0 ».

### 1.359.1 : la première relance d'une facture très en retard, et le client sans adresse

Suite du bout en bout 21, vue en relançant l'hôtel à la souris : la facture FAC-2025-001 avait 300 jours de retard et
n'avait jamais été relancée.
- **La première relance inventait des rappels.** Le modèle « Dernière relance » (choisi d'office au-delà de 45 jours de
  retard) commençait par « Malgré nos précédents rappels », alors que le client n'en avait reçu aucun. Le ton ferme
  vient du retard et reste ; la phrase sur les rappels n'apparaît plus tant que la facture n'a jamais été relancée (un
  appel noté compte comme un rappel). En anglais, « Despite our previous reminders » suit la même règle, et « Second
  reminder » devient « Reminder » pour une première relance. La relance groupée faisait déjà ainsi. Un modèle réécrit
  par la personne reste le sien, mot pour mot.
- **Un client sans adresse : la fenêtre ne le disait pas.** Elle montrait « À » au-dessus de rien, puis « + Une autre
  adresse » (il n'y en avait pas une première). Elle dit maintenant « Hôtel Mouradi Gammarth n'a pas d'adresse sur sa
  fiche : tape celle où l'envoyer » et montre directement la case. Envoyer sans adresse met cette case en rouge, avec
  « Tape l'adresse où l'envoyer : sa fiche n'en a pas. »
- **Retirer un rejet** : la question dit maintenant que les frais de rejet pris par la banque restent en Trésorerie, à
  retirer là-bas si la banque les rend.
- Tests : `tests/moteur/relance-premiere-1359-1.test.ts` (première relance ou non, en français et en anglais, note
  d'honoraires, modèle réécrit), `tests/web/relance-premiere-1359-1.test.ts` (la fenêtre de relance d'un client sans
  adresse) et `tests/web/cheque-impaye-1359.test.ts` (les frais) ; sept preuves « relance première 1.359.1 ».

### 1.360.0 : un client règle plusieurs factures d'un seul virement (bout en bout 22)

Joué à la souris dans l'environnement de test : l'Hôtel Mouradi Gammarth doit trois factures au traiteur (1 191 DT de
septembre, 596 DT d'octobre, 239 DT de novembre). Son comptable envoie un seul virement de 1 787 DT, qui règle les deux
plus anciennes. Avant cette version, la gérante ouvrait la facture d'octobre et tapait 1 787 : SkanFact proposait
seulement d'enregistrer un trop-perçu de 1 191 DT sur octobre, et septembre restait « en retard » à côté. Il fallait
deviner qu'on devait couper le virement en deux à la main.
- **« Plus que le reste de cette facture »** : quand le montant reçu dépasse le reste et que le client doit d'autres
  factures, la fenêtre le dit (« Hôtel Mouradi Gammarth doit encore 1 430,000 DT sur 2 autres factures ») et propose
  « Répartir sur ses factures », « Laisser un trop-perçu » ou « Corriger le montant ».
- **La fenêtre du paiement groupé** reprend le montant, la date, le compte, le mode et la référence déjà tapés. Elle
  liste les factures à encaisser de ce client, la plus ancienne d'abord, et montre ce que chacune reçoit pendant la
  frappe. La facture d'où l'on vient reste cochée. Le bouton dit ce qui suivra (« Enregistrer sur 2 factures · reste dû
  239,000 DT »). Un montant plus grand que ce que doivent les factures cochées est refusé, et le refus dit pourquoi.
- **Le même geste depuis la fiche du client** : « Un paiement pour plusieurs factures… » dans le menu Actions, dès que
  deux factures au moins sont à encaisser (« 3 factures à encaisser, 2 026,000 DT »).
- **Un règlement par facture**, chacun avec la même référence et une note qui dit le virement entier (« Un virement de
  1 787,000 DT pour 2 factures : FAC-2026-001, FAC-2026-002 »). Chez le comptable, deux écritures « Règlement
  FAC-2026-00x », chacune sur sa facture. Une fois validées, le lettrage automatique pose les deux lettres. La facture
  de novembre reste ouverte de 239 DT, comme chez le client : deux chemins, un chiffre.
- **Le lettrage automatique dit ce qui attend au brouillard.** Il disait « 3 lignes ouvertes » sous un tableau qui en
  montre cinq (le brouillard compté). Il dit maintenant « 3 lignes validées ouvertes… 2 lignes au brouillard ne se
  lettrent qu'une fois validées ».
- **Vu au passage** : au-dessus du reste, la fenêtre d'un paiement allumait « Une partie ». Ni « Tout le reste » ni
  « Une partie » ne s'allume plus quand le montant dépasse le reste.
- À VÉRIFIER avec le comptable : un paiement groupé à un client qui garde une retenue à la source. SkanFact la calcule
  facture par facture, au prorata de ce que chacune reçoit. La fenêtre l'annonce avant d'enregistrer. Est-ce ainsi
  que le client la déclare ? Les factures dans une autre devise, et le paiement par traite, ne sont pas dans ce geste
  groupé : ils se règlent encore facture par facture.
- Tests : `tests/moteur/lettrage-brouillard-1360.test.ts` (le brouillard compté à part, une ligne déjà lettrée non
  comptée) et `tests/web/paiement-groupe-1360.test.ts` (la fiche du client, le refus au-dessus du total, le surplus
  réparti depuis la facture, les règlements au serveur, puis le lettrage au Cabinet avant et après validation) ; douze
  preuves « paiement groupé 1.360.0 ».
  Deux preuves anciennes visaient une ligne que ce geste reprend du paiement groupé des achats : leurs motifs désignent
  maintenant ce seul endroit.

### 1.360.1 : une vente en euros à un client étranger, sans TVA, réglée à un autre taux (bout en bout 23)

Joué à la souris dans l'environnement de test : la pâtisserie vend des plateaux de petits-fours à une maison de Lyon
(2 500 €, facture au taux de 3,412). Le client règle au taux du jour de 3,380 : la banque reçoit 8 450 DT au lieu
des 8 530 DT de la facture. Ce qui était faux, et ce qui ne l'est plus :
- **Une facture « vente à l'exportation » comptait 19 % de TVA** (argent faux). La case remettait à 0 % les lignes déjà
  posées, mais une ligne ajoutée APRÈS prenait le taux par défaut : 2 500 € devenaient 2 975 € TTC sur une facture qui
  disait « sans TVA ». La case du taux était grisée, donc impossible à corriger. Le serveur reprenait le même taux. La
  règle vit maintenant dans le calcul d'une pièce encore en brouillon, dans l'éditeur ET au serveur : une vente à
  l'exportation n'a aucune TVA, quelle que soit la ligne.
- **La pièce gardée dans le dossier porte le taux scellé.** Une facture d'export qui arrive au serveur avec une ligne
  encore à 19 % (par un autre chemin que l'éditeur) est scellée sans TVA, et le serveur la range avec ses lignes à 0 % :
  elle s'affiche comme il l'a scellée (1 000 €, et non 1 190 €), et son fichier de facture électronique se calcule sur
  le même taux. Deux chemins, un chiffre.
- **Un client à l'étranger ne se voit plus réclamer un matricule tunisien.** « Avant d'émettre » disait qu'il manquait
  un matricule « obligatoire pour une entreprise ». Il dit maintenant « Client à l'étranger : sans matricule tunisien »,
  coché. La carte du client dit « à l'étranger », et non plus « sans matricule ».
- **« Avant d'émettre » ne signale plus une facture d'export comme « aucune ligne ne porte de TVA »** : elle est sans
  TVA par la loi. Il dit « Vente à l'exportation : aucune TVA ».
- **Le taux d'un règlement s'écrit à trois décimales** (« 3,380 », et non « 3,38 ») : dans la case, sous le paiement («
  = 8 450,000 DT au taux de 3,380 ») et dans l'annonce du change. C'est ainsi que la banque l'écrit.
- **« Enregistrer » ne bouge plus quand on change le taux.** L'annonce du change (« perte de change de 80,000 DT »)
  passait de deux à trois lignes et poussait le bouton de 17 px sous le curseur. Elle garde sa hauteur.
- **La liste des clients ne dit plus « 0 facture en 2026 »** d'un client qui n'a qu'un brouillon : elle dit « 1
  brouillon à émettre ».
- Chez le comptable, l'écriture de la vente est juste : 411 au débit, 706 au crédit pour 8 530 DT, sans TVA ni timbre.
  Le règlement passe 8 450 DT à la banque et 80 DT de perte de change au 655, contre 8 530 DT au 411.
- À VÉRIFIER avec le comptable : la déclaration mensuelle du Cabinet n'a pas de case « chiffre d'affaires à l'export /
  exonéré », et le 706 ne distingue pas l'export. Faut-il un compte à part (la TCL de 0,1 % sur l'export, par exemple) ?
  Une facture d'export doit-elle passer par El Fatoora ? L'export de services (une prestation rendue à l'étranger) est
  déjà noté À VÉRIFIER sur le bandeau de la facture. Une facture d'export émise AVANT cette version avec une ligne à 19
  % garde le calcul qu'elle a eu : c'est celui que le client a reçu.
- Tests : `tests/moteur/export-tva-1360-1.test.ts` (le brouillon d'export à 0 %, la pièce émise qui garde son calcul,
  l'export qui n'est pas un oubli) et `tests/web/export-euros-1360-1.test.ts` (l'émission par le serveur d'une pièce à
  19 % scellée sans TVA et rangée à 0 %, la facture tapée à l'écran, le règlement à un autre taux, la liste des clients,
  et l'écriture au Cabinet) ; douze preuves « export 1.360.1 ».

### 1.361.0 : un client règle par traite (bout en bout 24)

Joué à la souris dans l'environnement de test : l'Hôtel Mouradi Gammarth règle une facture de 477 DT par une traite
reçue le 13 novembre, à échéance du 15 janvier 2027. Côté achats, la pâtisserie remet une traite à la Minoterie du
Sahel pour une facture de farine de 1 190 DT, à échéance du 31 janvier. Ce qui était faux, et ce qui ne l'est plus :
- **Deux chemins, deux chiffres, pendant deux mois** (argent faux chez le comptable). Dans SkanFact, la facture est
  « payée » le jour où la traite est reçue : c'est vrai, la créance a changé de forme. Mais le serveur ne gardait que
  l'échéance, et le comptable ne voyait rien avant elle. Son lettrage disait que l'hôtel devait encore 477 DT au 411,
  pendant que l'entreprise disait la facture réglée. Si l'échéance tombe après le 31 décembre, le bilan de l'année
  portait la mauvaise créance.
- **Le règlement garde le jour de la traite.** Ce jour-là, une écriture d'opérations diverses fait passer la créance du
  client (411) aux effets à recevoir (413). À l'échéance, l'encaissement solde le 413 par la banque, et non plus le
  411. Au 31 décembre, l'hôtel ne doit plus rien au 411 ; la traite attend au 413. Côté achats, la dette passe du
  fournisseur (401) aux effets à payer (403) le jour où on remet la traite, et le paiement à l'échéance solde le 403.
- **Une traite notée sans le jour de sa réception, puis complétée,** est suivie par le serveur : le jour s'enregistre,
  et la famille d'écritures se réécrit.
- **La facture dit quand la banque bougera.** La boîte du geste disait « Réglée : plus rien n'est dû. » Elle dit
  maintenant « Réglée par traite : la banque l'encaisse le 15/01/2027. » La frise dit « par traite · à la banque le
  15/01/2027 ». La ligne du paiement montre le jour où la traite a été reçue (13/11/2026), et dessous « à la banque
  le 15/01/2027 » ; c'était l'échéance seule. Même chose pour la traite remise au fournisseur, dont la frise disait
  « Réglée · 31/01 · traite » : une date future sous une étape cochée. Elle dit « par traite · à la banque le
  31/01/2027 ».
- **Les listes ne disent plus « payée le 15/01 », une date à venir.** La liste des factures et celle des achats disent
  « traite au 15/01 » (« au 31/01 » pour la minoterie), et la phrase entière au survol.
- **La fenêtre du règlement nomme ses deux dates.** À côté de « Échéance de l'effet », la date s'appelle « Reçue le »
  (une facture) ou « Remise le » (un achat) ; elle disait « Date ». Elle redevient « Date » pour un virement.
- **Vu au passage** : en modifiant un règlement fournisseur, la ligne du haut disait « déjà réglé 1 190,000 DT · reste
  1 190,000 DT » sur une facture de 1 190 DT : elle comptait deux fois le règlement qu'on modifie. Elle dit « déjà réglé
  0,000 DT ».
- **« Le chèque (la traite) est revenu impayé » n'est plus proposé avant l'échéance.** Une traite ne revient impayée
  qu'une fois présentée à la banque. Le serveur refuse aussi un rejet daté avant le paiement qu'il annule, et le refus
  le dit.
- Les traites déjà saisies retrouvent le jour de leur réception (il était dans la pièce du dossier). Leur écriture du
  jour de réception suit à la prochaine modification de la pièce : sa famille d'écritures se réécrit alors.
- À VÉRIFIER avec le comptable : les comptes 413 (effets à recevoir) et 403 (effets à payer), et le journal des
  opérations diverses pour l'écriture du jour de la traite. La retenue à la source d'un règlement par traite naît à
  l'échéance, quand l'argent arrive : elle reste au 411 (au 401) jusque-là. Est-ce juste, ou naît-elle le jour de la
  traite ? La balance âgée du Cabinet lit le 413 avec l'échéance de la facture, pas celle de la traite. Une traite
  remise à l'escompte (la banque avance l'argent avant l'échéance) n'est pas dans ce geste.
- Tests : `tests/moteur/effet-1361.test.ts` (le plan 413/403, l'effet reçu puis encaissé, la retenue qui reste au
  client, la traite en euros et l'écart de change, la traite remise au fournisseur, l'avoir sans traite) et
  `tests/web/traite-1361.test.ts` (la traite notée puis complétée au serveur, le rejet daté avant l'échéance refusé, les
  quatre écritures et les soldes au 31 décembre, l'écran de la facture et celui de l'achat, les deux fenêtres de
  règlement et les deux listes) ; vingt-cinq preuves
  « traite 1.361.0 ».

### 1.362.0 : un contrat mensuel, de la facture générée jusqu'au Cabinet (bout en bout 25)

Joué à la souris dans l'environnement de test : la pâtisserie livre chaque matin les viennoiseries de l'Hôtel Mouradi
Gammarth (1 200 DT HT par mois), puis signe un second contrat avec la Maison Olivier, à Lyon, pour 300 € de pain par
mois, à l'export. Les deux brouillons du mois générés, relus, émis, l'hôtel réglé par virement, et le Cabinet qui lit
les mêmes ventes. Ce qui était faux, et ce qui ne l'est plus :
- **L'échéance de la facture d'un contrat** (date du paiement attendu). Une facture tapée à la main pour l'hôtel, réglé
  à soixante jours sur sa fiche, tombait à soixante jours ; celle que son contrat prépare chaque mois tombait à trente,
  le délai des réglages. La relance partait un mois trop tôt. La règle vit maintenant à un seul endroit du moteur
  (`echeancePour`) : la facture tapée, celle du contrat, celle que le serveur émet seul et une facture dupliquée suivent
  le délai de la fiche du client (fin de mois s'il le dit), sinon celui des réglages.
- **Un contrat pour un client à l'étranger** (vente à l'exportation). La case « Vente à l'exportation : sans TVA, sans
  droit de timbre » n'existait que sur la facture : chaque facture du mois partait à 19 %, et il fallait la corriger à
  chaque fois. Le contrat a maintenant la même case, avec la même phrase, quand sa devise n'est pas le dinar. Elle est
  proposée cochée si la dernière facture du client l'était, et elle passe les lignes à 0 %. Chaque facture du contrat la
  reprend, à l'écran comme au serveur. Le total du contrat le dit : « 300,00 EUR HT · 300,00 EUR TTC par facture · sans
  TVA ni timbre (export) ».
- **Le total du contrat attendait un taux déjà tapé** : « le TTC s'affichera avec le taux de change » sous « 3,4 », lu
  comme un nombre anglais. Il lit le taux comme il s'écrit.
- **L'étape suivante d'un contrat dû** : le vert passe de « Nouveau contrat » à « Générer le brouillon » quand une
  facture attend. La question qui précède n'est plus rouge (rien n'est détruit), et le message qui suit mène au brouillon
  (« Ouvrir le brouillon », ou « Voir les factures » pour plusieurs).
- **Le brouillon à émettre se retrouve depuis la liste** : le menu de la ligne propose « Ouvrir le brouillon à émettre »
  (le plus ancien d'abord), et la ligne dit « brouillon à émettre » dès la génération, sans changer de page.
- **La facture émise dit le contrat d'où elle vient** : une ligne « Origine » (« Le contrat Viennoiseries du
  petit-déjeuner · chaque mois · novembre 2026 ») y mène, comme la ligne d'un devis. Son taux de change s'écrit à trois
  décimales (« 1 € = 3,400 DT »), comme partout ailleurs.
- **La fiche du contrat lit ses factures par mois** : « Période » (Novembre 2026) au lieu de « Type » et de l'objet
  entier, qui passait sur cinq lignes.
- **Une liste ouverte dans une fenêtre qui défile** (le nouveau contrat, ses lignes et ses notes) faisait sortir
  « Annuler » et « Enregistrer » sous la fenêtre. La fenêtre garde son défilement ; la règle de la 1.80.0 (déborder
  pour ne pas couper une liste) ne vaut plus que pour une fenêtre basse, qui ne défile pas.
- L'invite de l'objet d'un contrat ne parle plus d'un autre métier (« Entretien des portes » chez une pâtisserie).
- Au Cabinet : la vente de l'hôtel au 411 (1 429 DT), 706, 4367 et 4368 ; l'encaissement au 532 ; la vente à l'export
  au 411 et au 706 (1 020 DT), sans TVA ni timbre.
- À VÉRIFIER avec le comptable : une vente à l'export au 706, ou à un compte de ventes à l'export à part ; et une
  prestation rendue à l'étranger n'est pas toujours exonérée (la bulle de la case le dit).
- Tests : `tests/moteur/contrat-1362.test.ts` (l'échéance de la fiche du client, à l'écran et au serveur, fin de mois
  comprise ; l'export du contrat repris par chaque facture) et `tests/web/contrat-mensuel-1362.test.ts` (le contrat à
  l'export créé à la souris, la fenêtre qui défile avec la liste ouverte, la génération, le menu, l'échéance, l'origine,
  la fiche, la duplication, le Cabinet) ; vingt-trois preuves « contrat 1.362.0 ».

### 1.362.1 : le rouge GitHub de la 1.360.1 (la bulle du taux, la paie rouverte trop tôt, le poids)

- **La bulle du taux se refermait sous les doigts.** Sur une facture en devise, la bulle « Devise et taux » s'ouvre
  depuis son étiquette. Taper le taux change le libellé de l'étiquette, qui se redessine : la bulle restait attachée à
  l'ancien bouton, retiré de la page, et le premier défilement la refermait. Sur GitHub, la page bougeait (le bandeau
  « le taux manque » disparaît) et la case « Vente à l'exportation » partait avec la bulle. La bulle suit maintenant le
  nouveau bouton de son étiquette (le même geste rouvre et referme, comme avant).
- **La paie rouverte avant que le bulletin soit au serveur.** Le test rechargeait la page dans la seconde où l'écran
  disait « 1 établi » : la page relisait le dossier pendant que l'envoi était encore en route, sans le bulletin. Le test
  attend maintenant le serveur avant de rouvrir, comme on rouvre la Paie plus tard. À VÉRIFIER : un rechargement dans
  la même seconde peut encore montrer la page d'avant l'envoi, qui arrive juste après ; le relire une fois suffit.
- **Le poids de la première ouverture** (1 302 Ko pour 1 300) : la feuille du fil de la messagerie part avec la
  messagerie (L12, `docs/leger.md`). Mesuré : 1 292 Ko.
- Tests : `tests/web/export-euros-1360-1.test.ts` (la bulle reste ouverte après le taux tapé et un défilement),
  `tests/web/paie-1355.test.ts`, `tests/web/messagerie.test.ts` (la feuille du fil absente de la première ouverture,
  la page sans réseau toujours en page, la feuille posée une fois, juste après `messagerie.css`), `tests/web/leger.test.ts` ;
  sept preuves « rouge 1.362.1 », et sept preuves anciennes repointées vers `messagerie-fil.css`.

### 1.362.2 : une facture émise deux fois, annulée par un avoir total (bout en bout 26)

Joué à la souris par la pâtisserie de Nour : la facture du mois de l'Hôtel Mouradi (1 200 HT + 228 de TVA + 1 de timbre
= 1 429 DT) refaite depuis la fiche du client, émise une seconde fois par erreur, puis annulée par un avoir total ; et le
Cabinet qui lit les deux pièces.

- **Le doublon se voit avant d'émettre.** Une facture de même client, même devise et même net à payer, datée à moins de
  soixante jours et pas annulée, s'annonce dans « Avant d'émettre » (« Un doublon ? FAC-2026-004 du 13/11 : même client,
  même montant, même objet », avec « L'ouvrir ») et dans la fenêtre d'émission. On peut émettre quand même : deux
  livraisons du même forfait existent.
- **« la refaire » demande avant, pas après.** Le lien de la dernière facture du client créait la copie PUIS posait
  « Quitter sans enregistrer ? » : « Annuler » laissait un brouillon orphelin. Sur une facture neuve où seul le client
  est choisi (la copie porte le même), la copie s'ouvre sans question ; quand quelque chose est tapé, la question est
  posée d'abord. « ← » ne menait déjà pas à la page vierge (la pile n'entre jamais une page de création, 10.12.0) : une
  première version passait une option de plus à `duplicateDoc`, que sa preuve a montrée inutile — retirée. La copie ne
  reprend plus la période du contrat (`periode`), comme elle ne reprenait déjà ni le contrat ni les bons de livraison.
- **L'avoir d'annulation totale reprend le timbre.** Sans lui, la facture « annulée » laissait 1 DT dû pour toujours :
  relances, retard, compte du client chez le comptable. Le motif « Annulation totale » coche le timbre quand la facture
  en porte un, et un autre motif le rend ; le menu « Avoir total » suit la même règle (il posait le motif sans le
  timbre). L'étiquette « Timbre » reste modifiable à la main. **À VÉRIFIER avec le comptable : la reprise du timbre fiscal
  par un avoir d'annulation totale.**
- **Un second avoir ne se crée plus en silence.** Chaque passage par « Créer un avoir » ouvrait un NOUVEAU brouillon : une
  facture finissait avec deux ou trois avoirs en attente. Quand un brouillon d'avoir attend déjà sur la facture, la
  fenêtre « Un avoir sur FAC-… attend déjà » propose de l'ouvrir ; en commencer un autre reste possible. Les cinq portes
  (bouton de la pièce, bandeau d'une pièce émise, menu de la pièce, menu de la liste, fenêtre de relance) passent par
  la même fonction (`avoirSur`).
- **Un brouillon d'avoir resté en double ne promet plus d'argent à rendre.** Sur une facture jamais payée, déjà annulée
  par AVO-2026-002, le bandeau annonçait « 1 429,000 DT à rendre au client ». La règle vit dans le moteur
  (`C.apresAvoir`), lue par le bandeau de l'éditeur ET la fenêtre d'émission : « à rendre » ne compte que ce que le
  client a PAYÉ ; ce qui dépasse ce que la facture porte encore se dit à part, en nommant l'avoir qui l'a déjà corrigée
  (« c'est presque toujours un brouillon en double »), avec le bouton « Supprimer ce brouillon ».
- **Le rouge GitHub de 36aa1da** : `plateforme/pont.js` avait 3 157 lignes pour 3 142 au plus (la feuille du fil de la
  1.362.1). Le chargement de la messagerie et de sa feuille passe par les portes de l'application
  (`SkanChargerMessagerie`, `chargerScript` et `chargerFeuille` dans `app-1.js`) : `pont.js` redescend à 3 129 lignes, et
  sa limite avec lui.
- Vérifié à la souris : l'avoir total à 1 429,000 (timbre compris), « Après cet avoir, FAC-2026-006 ne laisse plus rien
  à payer », la facture « Annulée par AVO-2026-002 : plus rien n'est dû », les relances qui ne la citent plus, l'écriture
  de l'avoir (411 au crédit 1 429, 706 1 200, 4367 228 et 4368 1 au débit) ; au Cabinet, FAC-2026-006 et AVO-2026-002 au
  brouillard, 1 429,000 chacune. Les brouillons restés de l'ancienne règle se sont retirés par leur nouveau bouton.
- À VÉRIFIER avec le comptable : une facture annulée garde « Signer » et « Envoyer » dans sa frise (El Fatoora : une
  facture numérotée puis annulée se transmet-elle avant son avoir ?).
- Tests : `tests/moteur/annulation-avoir-1362-2.test.ts` (à rendre, de trop, et les deux ensemble, comptés à la main),
  `tests/web/annulation-avoir-1362-2.test.ts` (le doublon, « la refaire » sans question après un client choisi à la main, l'avoir total et son timbre, le second avoir
  proposé, le brouillon en double retiré, le Cabinet) ; preuves « avoir 1.362.2 », les preuves « rouge 1.362.1 c/d »
  repointées vers `app-1.js`.

### 1.362.3 : une avance sur salaire retenue sur le bulletin, jusqu'au Cabinet (bout en bout 27)

Joué à la souris par la pâtisserie de Nour : 300 DT d'avance versés à Yassine le 05/11, retenus 150 DT sur ses bulletins
de novembre et de décembre ; la prévision de trésorerie côté entreprise, puis la Paie du Cabinet qui lit le même salarié.

- **La prévision ne sort plus l'avance deux fois.** Les salaires des mois sans bulletin s'estimaient au net de la fiche,
  sans la retenue : l'avance sortait le 05/11, puis une seconde fois dans le salaire entier du 30/11. Le salaire prévu
  retranche maintenant ce que le bulletin retiendra (`echeancesDuMois`), jamais plus que ce qui reste à rembourser d'un
  mois sur l'autre, et la ligne le dit (« Salaire novembre 2026 — Yassine Trabelsi (avance retenue : 150,000 DT) »).
  Deux chemins, un chiffre : le salaire prévu de novembre côté entreprise et le net du bulletin de novembre au Cabinet
  tombent tous deux sur 830,932 DT.
- **Les salariés qu'un mois attend : une règle, `salariesDuMois`.** Le contrôle des bulletins manquants jugeait sur le
  28 du mois : une entrée le 30 ou une sortie le 15 n'avaient pas leur bulletin réclamé. Et l'écran du Cabinet, quand rien
  ne manquait, retombait sur tous les salariés en poste aujourd'hui : janvier réclamait « Bulletins : 1 à faire » et
  « CNSS du 1er trimestre à déposer » pour un salarié entré le 1er novembre. Un salarié est attendu quand son contrat
  couvre au moins un jour du mois ; le pointage, « n à faire », « + Un bulletin… », la CNSS du trimestre et la retenue
  se comptent sur eux. Un mois sans personne le dit : « Personne n'est en poste en janvier : Yassine Trabelsi entre le
  01/11/2026. Aucun bulletin à faire. »
- **La comptabilité s'ouvre sur l'exercice qui a commencé.** Une écriture datée de janvier prochain au brouillard
  faisait ouvrir le dossier sur l'exercice suivant, douze mois « à venir ». Les mois et les exercices pris d'office sont
  ceux qui ont commencé ; un exercice futur ne s'ouvre que s'il n'y a rien d'autre.
- **Le mois regardé appartient à l'exercice où il a été choisi.** Passé de 2026 (novembre) à 2027, la Paie montrait
  novembre 2027, un mois qui n'existe pas encore. Changer d'exercice refait le mois — une garde au dessin, jamais une par
  porte.
- **Une réponse en retard ne repeint plus l'exercice qu'on regarde.** Passé à 2027 puis revenu sur 2026 avant que le
  livre de 2027 n'arrive, celui-ci s'installait sous l'étiquette « 2026 » : ses écritures, son brouillard, sa paie. Seul
  le livre de l'exercice qu'on regarde encore s'installe (règle 10.5.0).
- **La carte du dossier dit le dernier mois commencé.** La même écriture de janvier prochain faisait dire « janvier au
  brouillard » à la carte du dossier ouvert, et classait le dossier sur ce mois dans le portefeuille. Le dernier mois d'un
  dossier est le dernier qui a commencé (`dossierRow`) ; sans mois commencé, le premier à venir.
- **Les chemins cités dans le SkanFact du client existent.** Sous les avances de Yassine, le Cabinet écrivait « Ce client
  les saisit dans son SkanFact (Paie › Avances) », et ses taux « Paie › Barèmes » : aucun des deux n'existe dans la Paie de
  l'entreprise. Ils deviennent « Paie › L'équipe › Avances et prêts », « Paie › Réglages » et « Paie › Aujourd'hui ›
  Congés et absences » ; un test lit les noms des vues dans la source de l'entreprise et refuse un chemin qui n'y est pas.
- Vérifié à la souris : l'avance versée, la prévision à 830,932 DT en novembre (avance retenue nommée), octobre payé
  980,932 DT le 31/10 ; au Cabinet, « novembre au brouillard » sur la carte du dossier, l'avance de 300 DT dont 150
  retenus et 150 restants sous « Congés et avances », le bulletin de novembre à 830,932 DT, janvier « personne en poste ce mois »,
  l'exercice 2026 ouvert d'office malgré une écriture de janvier 2027.
- Tests : `tests/moteur/avance-prevision-1362-3.test.ts` (sans avance, 150 par mois, 200 par mois plafonné au reste,
  avance déjà remboursée en partie, avance de décembre, le libellé ; montants comptés à la main),
  `tests/moteur/paie-du-mois-1362-3.test.ts` (janvier, l'entrée du 30, la sortie du 15, février, le contrôle),
  `tests/web/cabinet-paie-1362-3.test.ts` (l'exercice et le mois d'ouverture, janvier sans personne en poste, le
  changement d'exercice, la réponse en retard retardée de 2,5 s), `tests/moteur/dernier-mois-dossier-1362-3.test.ts`,
  `tests/moteur/chemins-paie-cabinet-1362-3.test.ts` ; quatorze preuves « paie 1.362.3 ».
- **Le rouge de la nuit du 15/11/2026 (toutes les preuves, sur la 1.362.2) : sept preuves devenues muettes.** Aucune ne
  disait un défaut revenu : chacune visait un écran que les versions d'après avaient changé. (1) Les lignes d'un achat au
  téléphone : depuis la 1.357.0 la pièce enregistrée s'ouvre en résumé, l'instrument de rendu n'ouvrait plus son
  formulaire — il l'ouvre (`#/achat/p1/modifier`), et il y a trouvé un vrai défaut : le chemin gardait la pièce en lien de
  16 px au-dessus du formulaire. Au téléphone, le retour est désormais le DERNIER lien du chemin (le parent le plus proche :
  la pièce qu'on modifie, la commande d'une réception), les autres se cachent. (2) Le signe moins et les valeurs proposées :
  la remise de la pièce est une case de texte depuis la 1.356.9, l'instrument tape aussi dans la remise d'une ligne, une
  vraie case de nombre. (3) Le prix d'un article tapé « 12,500 » : la case est en texte, la preuve avale la virgule à la
  relecture du formulaire. (4) « Quitter sans enregistrer ? » après la suppression d'une pièce : la question arrive au
  changement d'adresse, une image plus tard ; le test attend d'être parti puis regarde un instant. (5) Le jour d'arrivée
  des pièces : le défaut posait « 15 », juste le 15 du mois ; il pose un jour de plus. Neuf preuves refaites.

### 1.362.4 : un client rend une partie de la marchandise, un autre obtient une remise (bout en bout 28)

Joué à la souris par la pâtisserie de Nour : 30 coffrets de chocolats en stock à 25 DT, 20 vendus à l'Hôtel Mouradi
(FAC-2026-007, 1 072 DT). Puis trois avoirs : 5 coffrets rendus, une remise de 5 DT sur les 20, 3 coffrets rendus encore.

- **Une remise remettait la marchandise en rayon.** Tout avoir émis rendait au stock la quantité de ses lignes, quel que
  soit son motif : la remise de 5 DT sur les 20 coffrets (rien n'est revenu du client) en remettait 20 en stock. Le stock
  montait à 45, et le coût des ventes du mois devenait négatif — une remise qui fabriquait de la marge. Chaque ligne d'un
  avoir porte maintenant `sansRetour` ; le moteur du stock la saute (`stockMovements`). Le motif choisit d'office :
  « Retour de marchandise » et « Annulation totale » remettent en stock, « Remise accordée », « Erreur de prix » et
  « Prestation non faite » non.
- **La ligne le dit, et se change.** Sous chaque ligne d'un article suivi : « revient en stock à l'émission : 25 → 28 »,
  avec « Ne revient pas en stock », ou « ne revient pas en stock » avec « La remettre en stock ». Un même avoir peut rendre
  une ligne et pas l'autre.
- **La fenêtre d'émission et l'avoir émis le disent.** Le dernier écran avant le geste irréversible récapitulait le client,
  la facture et le montant, jamais le stock : il porte une ligne « Stock » (« 3 remis en stock à l'émission (25 → 28) »,
  « ne revient pas en stock »), et l'avoir émis la garde dans son résumé.
- **Un avoir qui rendrait plus que la facture n'a vendu le dit avant.** « Corriger par un avoir » recopie les 20 coffrets
  de la facture, même quand 5 sont déjà revenus : la ligne dit « FAC-2026-007 en a vendu 20, dont 5 déjà remis en stock ».
  Une remise ne compte pas comme marchandise rendue.
- **La ligne d'un avoir ne parle plus de marge.** Une remise de 5 DT sur un coffret qui coûte 25 s'affichait « marge
  −400 % · tu vends à perte », et « Avant d'émettre » la signalait « vendue à perte » : un avoir ne vend rien, la marge de
  la vente se lit sur la facture.
- Le Cabinet lit les deux avoirs au journal des ventes, au brouillard : AVO-2026-004 (411 au crédit 119, 707 au débit 100,
  4367 19) et AVO-2026-005 (160,650 ; 135 ; 25,650). À VÉRIFIER avec le comptable : une remise accordée sur des
  marchandises va-t-elle au 709 (rabais, remises et ristournes accordés) plutôt qu'au débit du 707 ?
- Vérifié à la souris : le stock reste à 25 après la remise, passe à 28 après le retour de 3 coffrets (700 DT au coût moyen
  de 25) ; au Cabinet, les deux avoirs au journal des ventes.
- Tests : `tests/moteur/avoir-retour-stock-1362-4.test.ts` (le retour, la remise, les deux ensemble et le brouillon, une
  ligne rendue et l'autre non ; stock et coût des ventes comptés à la main), `tests/web/retour-stock-1362-4.test.ts` (le
  motif, la ligne changée dans les deux sens, la marge absente, la fenêtre d'émission, le retour de trop, le stock à 15) ;
  neuf preuves « stock 1.362.4 ». Deux d'entre elles restaient vertes au premier passage : l'article du test n'avait pas
  de coût au catalogue, donc aucune marge ne s'affichait et le contrôle ne pouvait rien voir — des données qui ne
  discriminent pas ne prouvent rien.

### 1.362.5 : Nour clôture jusqu'à octobre, et le Cabinet cesse de lui réclamer ce qu'elle a déclaré fini (bout en bout 29)

Joué à la souris par la pâtisserie de Nour : « Clôturer jusqu'à… » de décembre 2025 à octobre 2026, puis le Cabinet de
Jlassi Conseil le même jour.

- **La fenêtre nommait ses points sans les ouvrir.** « 1 point à regarder du 01/12/2025 au 31/10/2026 : 2 mouvements non
  pointés » — et aucun moyen d'aller les pointer, alors que la liste du mois suivant, juste derrière, porte ses boutons
  (7.15.0 : ce qu'un écran nomme, il l'ouvre). Chaque point porte maintenant son geste (« Pointer les mouvements », « Voir
  les brouillons »…), par la même table que la liste (`actionDeControle`) ; la fenêtre se ferme avant d'emmener.
- **Revenue de son point, la fenêtre repartait au premier mois.** On rouvre « Clôturer jusqu'à… » sur le mois qu'on avait
  choisi (`comptaState.clotChoisi`).
- **Le Cabinet ne savait pas que le client avait clôturé.** Le tableau de bord réclamait « 8 mois sans écriture » à Nour, la
  fiche « Juillet, août et septembre · rien reçu · Relancer le client… », pour des mois qu'elle venait de déclarer finis —
  et vides. La clôture est la promesse faite au comptable (« ce mois ne bougera plus ») : elle doit lui parvenir. Le
  serveur la lit sous le mandat actif (`socle.cloture_de_mes_clients`, 0213 : le jour seul et quand il a été posé, la fiche
  du client reste fermée ; un jour impossible ne sort pas), le portefeuille la porte (`clotureClient`), et le pont
  (`SkanMoisClos`, rangé dans `modules/socle/pont/cabinet.js` : le vieux fichier du pont ne grandit pas) fait de chaque
  mois clôturé sans écriture un mois **vide** (du premier mois de ses livres au dernier mois clos en entier,
  jamais le mois en cours). La fiche dit « sans activité » : rien à réclamer au client, mais la déclaration se dépose
  quand même, à zéro (À VÉRIFIER avec le comptable).
- **« Rien reçu depuis le 30/11 », au-dessus de juillet à septembre.** La dernière écriture était APRÈS les mois qui
  manquent : le trou est au milieu des livres. « Depuis » ne se dit plus que d'une écriture d'avant le premier mois vide ;
  sinon « Aucune écriture sur ces mois, alors que ses livres en ont après (la dernière le 15/10) ».
- **La grille disait « rien reçu » avant le début de la mission.** La fiche affiche « Début de mission : le premier mois
  de ses livres », et la grille de l'année marquait « rien reçu » de janvier à juin pour des livres qui commencent en
  juillet — ce que rien ne réclame par ailleurs. Elle prend le même début (`K.debutDeMission`).
- **Le rouge de la nuit du 16/11** (1.362.3) : « À voir · 3 », au tableau de bord du Cabinet, faisait 23 px de haut au
  téléphone (il ne paraît que les jours où il y a quelque chose « à voir ») ; il en fait 44. Et la preuve « tableau
  1.338.0 j » restait verte à partir du 16 : son défaut ne taisait que la branche « avant le 15 » des personnes physiques.
  Elle tait désormais la ligne entière, quel que soit le jour.
- Vérifié à la souris : la fenêtre, « Pointer les mouvements » vers le rapprochement, le retour sur octobre, la clôture et
  son journal ; au Cabinet, le tableau de bord sans la ligne de Nour, la fiche avec « sans activité » et sans « Rien reçu
  depuis ».
- Tests : `tests/web/cloture-client-1362-5.test.ts` (dans les deux applications, sur des mois lus sur l'horloge du test :
  avant la clôture, la phrase juste ; la fenêtre, son geste, son mois retrouvé ; après, « sans activité » et rien de
  réclamé ; la grille d'une année ouverte avec l'horloge de la page posée en décembre, pour que janvier existe avant les
  livres quel que soit le jour), et un test de `tests/cabinet/mandats.test.ts` (ce qui sort, à qui, et jamais un jour
  impossible) ; onze preuves « clôture 1.362.5 ».

### 1.363.0 : les ventes par carte, et la banque qui verse le net (bout en bout 30)

Joué à la souris par la pâtisserie de Nour : elle crée sa caisse, vend trois coffrets (deux tickets par carte, 107,100 et
53,550 DT, un en espèces), puis importe le relevé de la BIAT, où la banque verse les cartes en une ligne, moins sa
commission : « REMISE TPE 0042 · 158,270 DT ».

- **La remise de cartes passait pour « pas dans SkanFact ».** SkanFact porte chaque ticket payé par carte, un par un ; la
  banque verse le jour entier, moins sa commission : la somme ne fait jamais la ligne. Le seul geste proposé était « Créer
  le mouvement », en « Autre entrée » de 158,270 DT — les ventes comptées deux fois. `apparierReleve` rend maintenant
  `remisesCarte` : une ligne positive restée seule cherche, parmi les paiements par **carte** pas encore pointés des sept
  jours qui la précèdent (son jour compris), une suite de jours d'affilée dont la somme l'égale ou la dépasse d'au plus
  5 % (À VÉRIFIER : le taux se lit sur le contrat du terminal). Une seule suite possible, sinon rien ne se propose : une
  ambiguïté n'est jamais sûre. Un week-end versé en une fois, ou cinq tickets versés entiers (commission nulle), se
  retrouvent aussi.
- **La commission se note du même geste.** La fenêtre du relevé montre la ligne, ses ventes, la commission (− 2,380 DT) et
  le dit avant le clic ; « Pointer 2 mouvements et noter la commission » pointe les ventes et enregistre la commission en
  frais bancaires, déjà pointée, derrière les mêmes portes qu'un mouvement saisi à la main (offre, période clôturée).
  « Annuler » défait tout, la commission comprise. Les mouvements pointés font alors exactement la ligne de la banque.
  La commission part entière en frais bancaires (627) : sa TVA n'est pas distinguée — À VÉRIFIER avec le comptable.
- **Le pont.** Le Cabinet reçoit l'écriture « Commission carte — REMISE TPE 0042 » au brouillard (627 au débit, la banque
  au crédit) ; la banque de son livre fait 107,100 + 53,550 − 2,380 = 158,270, la ligne du relevé. Le jumeau du
  Cabinet (le comptable importe lui-même ce relevé) est fait en 1.363.1, juste dessous.
- **« — » sous chaque ticket du pointage.** Un ticket de caisse sans client se dit « Vente au comptoir ».
- **« Carte · versé par ta banque »**, au bilan du jour de la caisse, dit maintenant « moins sa commission ».
- Vérifié à la souris : la caisse créée et ouverte, les trois tickets, le bilan du jour, l'import du relevé avant (la
  ligne « absente », l'« Autre entrée ») et après (la remise, le bouton, « + 158,270 DT · 3 mouvements »), l'écriture
  au livre.
- Tests : `tests/moteur/tresorerie-1363.test.ts` (montants calculés à la main, la borne des 5 % au millime, le virement
  du bon montant qui ne se propose pas, l'ambiguïté, les sept jours, deux remises qui ne se volent pas leurs tickets) et
  `tests/web/carte-1363.test.ts` (à l'écran, puis « Annuler », puis le livre du Cabinet) ; quatorze preuves « carte
  1.363.0 ».

### 1.363.1 : la remise de cartes, vue du Cabinet (bout en bout 30, le jumeau)

Joué à la souris par Leïla, la comptable de Nour : elle importe le même relevé de la BIAT dans la Banque du dossier.

- **La ligne « REMISE TPE » restait « rien en face ».** Les écritures du Cabinet ne portent pas le mode de paiement :
  la règle du client ne se recopie pas. `remiseDeLigne` cherche autrement : une ligne positive restée seule se confronte
  aux écritures de banque encore libres des sept jours précédents, et ne se propose que si une écriture de **frais
  bancaires** (une sortie de banque dont la pièce porte un 627) fait, avec des encaissements, la ligne **au millime** :
  d'abord des jours entiers d'affilée, sinon une à quatre écritures. Une seule réponse, sinon rien : une ambiguïté n'est
  jamais sûre (9.5.0). Ici il n'y a pas de plafond de 5 % : la commission est une écriture qui existe, pas une
  estimation.
- **Sans écriture de frais bancaires, rien ne se propose** : une sortie au 613 du même montant n'est pas une commission.
  Une commission déjà rapprochée ailleurs ne sert pas deux fois.
- **L'écran le dit** : « Remise de 3 écritures · les ventes par carte, moins la commission de la banque : leur somme
  fait la ligne au millime ». Le geste reste celui d'une remise de chèques : on relit, on pose.
- Vérifié à la souris : le relevé importé, la proposition, les trois écritures en face, « Novembre 2026 est rapproché »,
  relevé 21 146,338 = attendu 21 146,338.
- Tests : `tests/moteur/banque-carte-1363.test.ts` (cinq cas, montants à la main) et la suite Cabinet de
  `tests/web/carte-1363.test.ts` ; six preuves « carte 1.363.0 o à t ».
- Vu en passant, regardé, laissé : la frise des mois du dossier dit février à juin « sans activité » et juillet à
  septembre « sans activité, en retard ». Ce n'est pas une contradiction : les livres de ce client commencent en janvier
  (deux écritures), et « en retard » ne se dit que des échéances que le calendrier du Cabinet regarde encore, les plus
  récentes. À VÉRIFIER avec un comptable : faut-il réclamer aussi les déclarations à zéro plus anciennes ?

### 1.364.0 : un bien d'avant la clôture, sa revente, et son entrée au Cabinet (bout en bout 31)

Joué à la souris par Nour, qui a clôturé jusqu'au 31/10/2026 : elle enregistre sa camionnette, en service depuis le
01/07/2026 (30 000 DT, 5 ans), puis la revend 28 500 DT le 16/11 au garage Triki. Leïla, sa comptable, reprend la fiche.
À la main, en base 360 : dotation jusqu'au 16/11 = 6 000 × 136 / 360 = 2 266,667 ; valeur comptable 27 733,333 ;
plus-value 766,667.

- **Le bien était refusé : « Période clôturée ».** Et le refus conseillait de « refaire la pièce à la date
  d'aujourd'hui » : une mise en service est un fait, la changer fausse le plan d'amortissement. Toute entreprise qui
  découvre les Immobilisations après avoir clôturé des mois était bloquée pour tous ses biens. Le bien s'enregistre
  maintenant avec sa vraie date ; une question le dit avant (« Un bien d'avant la clôture ») : son amortissement part de
  la mise en service, son entrée dans les livres se date au premier jour ouvert (`entreeLe`, figé sur la fiche). Rien ne
  s'écrit dans un mois clôturé. Les dotations des exercices déjà finis entrent avec lui, contre le report à nouveau.
  Ce qui est déjà entré dans un mois clôturé depuis, lui, reste protégé.
- **La fiche le redit** : « Mis en service 01/07/2026 · entré dans tes livres le 01/11/2026 ».
- **La revente** : la sortie, la plus-value annoncée avant d'enregistrer, « Facturer la cession » (411 / 775 / TVA /
  timbre) : rien à corriger, vérifié à la souris.
- **Au Cabinet, le compte du bien finissait créditeur de 30 000 DT.** La fiche reprise d'un bien que le client a saisi
  à la main (sans facture d'achat) n'a aucune ligne d'entrée dans le livre du Cabinet ; sa sortie créditait quand même
  le 224. L'écran des Immobilisations le dit maintenant (« n'est entré dans aucune écriture : le compte 224 n'a pas
  reçu ses 30 000,000 DT ») et un bouton passe l'entrée au brouillard, au jour où le client l'a fait entrer : la valeur
  au compte du bien, les amortissements des exercices finis, le reste au report à nouveau (le même compte que chez le
  client, 12). Elle ne se propose pas deux fois, pas pour un bien né d'un achat, et elle n'est pas prise pour une
  « ligne sans fiche » (le bien se serait amorti deux fois). Vaut aussi pour une fiche saisie à la main au Cabinet.
  Après : 224 et 28 soldés, 681 = 2 266,667, 675 = 27 733,333, 775 = 28 500 des deux côtés.
- **« Il manque 8 mois… relancer le client »** s'affichait au-dessus de huit mois dits « sans activité » (1.362.5) :
  un mois que le client a clôturé sans une écriture n'est plus compté manquant.
- Le serveur rend au Cabinet le jour d'entrée du bien (`entree`), lu sur la fiche du client. Rien de plus ne part.
- Second cas joué à la souris : un four en service depuis le 01/03/2024 (10 000 DT, 5 ans), enregistré après la
  clôture. Son entrée au 01/11/2026 : 22 = 10 000 ; 28 = 3 666,667 (2024 : 1 666,667 ; 2025 : 2 000) ; 12 = 6 333,333. Le
  tableau de 2026 part bien d'un cumul au 01/01 de 3 666,667.
- **1.364.1 — la limite fermée, et un trou trouvé en la fermant.** Jouée à la souris au Cabinet sur le four de 2024 :
  - la fiche d'un bien mis en service avant l'exercice porte « repris de N-1 », et une fiche reprise ne proposait
    jamais son entrée : le four n'entrait dans aucune écriture du cabinet. Elle se propose maintenant quand le client
    a fait entrer le bien CETTE année (01/11/2026 : 223 = 10 000 ; 28 = 3 666,667 ; 12 = 6 333,333) ;
  - en 2025, la dotation (2 000) reste au tableau, marquée « dans son entrée », mais ne s'écrit plus : ni bouton, ni
    pastille, et la phrase dit pourquoi. Aucune entrée ne se propose dans un exercice d'avant le jour d'entrée ;
  - le livre du Cabinet connaît les biens du client (`livre.biensClient`, posé par le pont) : une seule règle,
    `entreeTardive`, pour le tableau, les écritures, la pastille et l'entrée. Sept preuves (r → x).
  - Reste noté : un bien que le cabinet tient SEUL (dossier hors SkanFact), saisi des années après sa mise en
    service, n'a pas de « jour d'entrée » ; son entrée se propose au 1er janvier de l'exercice regardé. À VÉRIFIER
    avec le comptable pilote avant d'y poser une règle.
- Vu en passant, laissé : la fenêtre de sortie grandit de 15 px quand on saisit le prix (l'avertissement gagne une
  ligne). À VÉRIFIER avec un comptable : la contrepartie d'un bien entré sans facture (report à nouveau, compte 12) et
  la TVA à reverser sur une revente avant cinq ans, que la fenêtre signale déjà.
- Tests : `tests/moteur/cession-1364.test.ts` (onze cas, montants à la main) et `tests/web/cession-1364.test.ts`
  (l'écran du client, puis celui du Cabinet) ; dix-sept preuves « cession 1.364.0 ».

### 1.364.2 : le vieux four mis au rebut, jusqu'au Cabinet (bout en bout 32)

Joué à la souris : Nour sort son ancien four (10 000 DT, en service depuis le 01/03/2024, 5 ans) le 16/11/2026, sans
prix. Montants refaits à la main, base 360 : amorti à la sortie = 10 000 × 976 / 1 800 = 5 422,222 ; dotation 2026 =
5 422,222 − 3 666,667 = 1 755,555 ; valeur comptable = moins-value = 4 577,778.

- **Chez Nour** : 681 / 28 = 1 755,555 ; sortie : 28 = 5 422,222, 675 = 4 577,778, 22 = 10 000. Le 22 et le 28 sont soldés.
- **Au Cabinet** : la fiche dit « plan différent — sorti le 16/11/2026 chez le client, toujours à l'actif ici » ;
  « Reprendre son plan… » préremplit la date ; « Passer les écritures d'inventaire » écrit la dotation et la sortie
  au 16/11. Lu dans le livre du cabinet : les mêmes quatre montants, au millime (deux chemins, un chiffre).
- **Corrigé** :
  - la question « sort sans être vendu… C'est bien ça ? » s'intitulait « Oui, sans prix ? » : un bouton qui RÉPOND
    (« Oui, … », « Non, … ») n'est plus pris pour le nom d'un geste, et cette question porte son titre
    (« Une sortie sans prix de vente ») ;
  - au Cabinet, le bouton annonçait « (1) » et le message « 2 écritures passées » : le bouton compte les écritures.
- **Laissé, À VÉRIFIER** : l'avertissement « une sortie avant cinq ans peut imposer de reverser une partie de la TVA »
  s'affiche aussi pour un bien entré sans facture d'achat ; la règle dépend de ce qui a été déduit à l'époque.

### 1.365.0 : la cohérence des écrans — une identité d'une page à l'autre

Demandé par Skander le 16/11/2026 : « pas que chaque page soit différente : on garde une identité et on facilite la
création d'habitudes ». L'instrument de rendu juge une page seule (rien ne déborde, tout se touche) ; rien ne jugeait
les pages ENTRE ELLES.

- **L'instrument** (`tests/instrument-coherence.ts`) relève, dans la page, la forme de chaque famille d'objets — titre
  de page, titre de section, bouton, petit bouton, bouton principal, champ, pastille, en-tête de tableau, carte — et
  chaque couleur de texte, de fond et de trait. Une carte se reconnaît à ce qu'elle EST (un bloc aux coins arrondis qui
  se détache du fond), pas à un nom de classe : une carte dessinée à la main sous un autre nom est justement ce qu'il
  doit voir.
- **Le test** (`tests/web/coherence.test.ts`) ouvre 20 pages de l'entreprise et 17 du Cabinet sur des données qui
  dessinent leurs tableaux, et exige que chaque forme vue soit la RÈGLE de la maison ou un écart NOMMÉ
  (`tests/web/coherence-formes.json`), et que les couleurs hors charte ne dépassent pas leur plafond. Une forme nouvelle
  fait tomber le test en nommant la page et l'objet. Le relevé complet est rangé dans `dist/coherence.json`.
- **Ce qu'il a trouvé à sa première passe**, et ce qui est corrigé ici :
  - deux styles d'en-têtes de liste selon la page (12 px en clair chez les Factures, 11 px en capitales au Catalogue,
    au Stock, aux Réglages du Cabinet) : une liste a maintenant le même en-tête partout ;
  - deux gris de texte secondaire (celui de la v10 et celui de la charte) : un seul, celui de la charte.
- **Ce qui reste, nommé dans le fichier des formes** : 42 écarts marqués « dette », surtout les cartes (arrondis de 8 à
  20 selon l'écran, surtout au Cabinet), les champs (arrondi 9 ou 10, texte de 13 à 15 px), les titres de section (de
  14,5 à 26 px) et les couleurs écrites en dur (9 à l'entreprise, 24 au Cabinet). Cinq écarts sont voulus et le disent
  (le titre qui salue, le grand bouton « Émettre », la tuile de choix, la colonne triée).
- **La règle pour la suite** : un écran neuf ne passe que s'il parle la langue de la maison ; résorber une dette, c'est
  retirer sa ligne du fichier et baisser le plafond des couleurs. Le thème sombre et le téléphone ne sont pas encore
  relevés par cet instrument.

### 1.365.1 : le rouge GitHub de la 1.364.0 (deux tests d'écran)

- **Le résumé d'un relevé importé** (`tresorerie-1298`) : depuis la 1.363.0, « retrouvées » compte aussi les remises,
  et le détail suivait sans le dire — « 2 retrouvées · 1 remise en plusieurs mouvements · 1 absente » pour trois
  lignes se lisait comme quatre. Le détail dit « dont » (« 2 retrouvées, dont 1 remise en plusieurs mouvements »), et
  « déjà pointée » passe après lui. Le test de la 1.298.0 n'avait pas été rejoué avec la 1.363.0 : c'est la faute.
- **Une erreur de page vue une seule fois, sur GitHub** (`groupe-1324`, « reading 'classList' » de null), pas reproduite
  ici. Cause probable, non prouvée : la barre de sélection d'une liste (factures, achats) redessinée à l'arrivée d'une
  écriture alors que la page venait d'être quittée. Les trois dessins ne touchent plus que ce qui est là, et le test
  range désormais la PILE de l'erreur : si elle revient, elle dira sa ligne.

### 1.366.0 : la cohérence, les dettes résorbées (formes, cartes, couleurs)

La 1.365.0 avait posé l'instrument et NOMMÉ 47 exceptions. Il en reste 10, toutes voulues, plus aucune dette de forme.

- **Les champs** : un champ a les coins d'un bouton (10 px, contre 9), le même trait, et deux tailles de texte selon sa
  place (14 px dans un formulaire, 13,5 px dans une barre). Les cases d'une grille de saisie (écritures du Cabinet,
  lignes d'un achat) ont une forme à elles, la même des deux côtés (8 px, 13 px).
- **Les titres de section** : 15 px demi-gras partout (ils étaient 14,5 / 15 / 15,5 / 16, gras 650 ou 700) ; un bloc mis
  en avant monte à 18 px (le mois de paie, le nom d'une conversation — ils étaient à 20). La page vide qui accueille
  garde son grand titre, c'est écrit comme voulu.
- **Les boutons** : le bouton sans mot devient une famille (36, 32 dans une ligne de liste, 28 petit) ; le menu d'une
  ligne écrit à 13,5 px comme les autres ; le petit bouton de la paie fait 28 px de haut comme partout.
- **Les cartes** : un seul arrondi, 14 px (elles allaient de 8 à 20) ; quatre formes en tout — la carte (trait et ombre),
  le cadre posé à plat, le bloc intérieur à 12 px, le bandeau teinté à 12 px.
- **Les couleurs** : les gris et les teintes de l'ancienne feuille viennent maintenant de la charte (trois neutres ont
  reçu un nom : le fond, le creux, le vert doux). Hors charte : l'entreprise passe de 9 à 1, le Cabinet de 24 à 16 —
  ce qui reste, ce sont des mélanges tirés des jetons (les teintes sarcelle du dossier) et l'en-tête sombre de
  l'abonnement. Les plafonds du test sont abaissés d'autant.
- **L'instrument** lit mieux : l'en-tête d'un tableau est celui de son `thead` ; un champ sans trait (dessiné par son
  conteneur) et celui qui a le curseur ne comptent pas.
- **Le rouge GitHub de la 1.365.0** : quatre tests d'écran lisaient encore des en-têtes en capitales (« DÉSIGNATION »,
  « DATE », « 3 BIENS »). Les en-têtes sont en casse ordinaire depuis la 1.365.0 ; les tests le disent. La faute :
  seuls les tests de rendu avaient été rejoués, pas ceux qui LISENT un tableau.

### 1.367.0 : la cohérence, lue aussi en thème sombre et au téléphone

L'instrument lisait les écrans en clair, à l'ordinateur. Il les lit maintenant trois fois : les 37 pages en clair, en
sombre, et à la largeur d'un téléphone (390 px) — 111 lectures.

- **En sombre**, la règle est simple : le thème change les teintes, jamais une taille ni un arrondi. Les formes vues
  sont comparées à celles du clair, à la couleur près. Résultat : aucune différence, sauf l'en-tête de l'abonnement
  (un filet intérieur, nommé comme voulu). Les couleurs hors charte ont leur plafond propre (entreprise 5, Cabinet 18).
- **Au téléphone**, les formes ont leurs règles à elles (un bouton fait 44 px sous le doigt, un champ s'écrit à 16 px) :
  elles sont écrites à part dans `tests/web/coherence-formes.json`. Deux arrondis ramenés à la règle au passage
  (l'encart vert « c'est fait », le cadre des écrans de comptabilité du Cabinet au téléphone).
- **Une dette nommée, pas encore résorbée** : quelques zones de texte et sélecteurs restent à 13,5 px au téléphone
  (les notes d'une facture, le mois de la paie du Cabinet). Sous 16 px, un téléphone peut zoomer à la saisie —
  À VÉRIFIER sur un vrai téléphone avant de changer.
- Deux preuves « cohérence 1.367.0 a–b » (une forme qui change en sombre, un bouton trop bas au téléphone). Une
  troisième, sur les teintes sombres, a été écrite puis retirée : en sombre, l'ancienne feuille avait déjà les teintes
  de la charte, la preuve ne prouvait rien.

### 1.367.1 : au téléphone, tous les champs s'écrivent à 16 px

La dette nommée par la 1.367.0 est résorbée : les zones de texte (notes d'une facture, d'un client, d'un fournisseur)
et les sélecteurs restés à 13,5 px (statistiques, comptabilité, mois de la paie du Cabinet) passent à 16 px sous
760 px de large, comme les autres champs. Les écrans ne débordent pas (tests de rendu à 390 px rejoués). Il ne reste
plus aucune dette de forme, ni à l'ordinateur ni au téléphone. Une preuve « cohérence 1.367.1 a ».

### 1.368.0 : onglets, vues, filtres — trois composants, les mêmes dans les deux applications

Demande de Skander : « on a 3 différents des fois, donc pas cohérent ». Le relevé en a trouvé quatre familles et une
vingtaine de variantes ; la même forme voulait dire « filtrer » sur un écran et « changer d'écran » sur un autre.
Maquette validée le 16/11/2026, puis appliquée :

- **Un onglet est souligné** (40 px, trait vert d'eau sous le choix actif, sur un filet) : Paramètres, Réglages du
  Cabinet, Catalogue, Stock, Statistiques, Trésorerie, Comptabilité, Paie, fiche d'un client, pièces reçues, les
  groupes de la comptabilité d'un dossier. Le segment noir a disparu.
- **Une vue est un segment gris**, le choix actif en blanc, en deux tailles (26 px pour une page, 22 px dans une
  liste) : factures / en retard, les genres d'une liste, HT / TTC d'une facture, les sous-écrans de la comptabilité
  d'un dossier, « Les miens / Tous ».
- **Un filtre est une pastille** avec son nombre, le choix actif en vert doux : dossiers, tableau de bord, pièces
  reçues, messages.
- **Au doigt**, les trois font 44 px, et un rang trop long défile de côté au lieu de passer à la ligne.
- **À part, et voulu** : les frises de calendrier (les mois d'un dossier, les jours de pointage) montrent un état par
  case ; la caisse garde ses grandes touches.
- Les groupes gardent leurs classes et leur comportement : seule la forme est ramenée à la charte
  (`web/public/plateforme/charte.css`, bloc 1.368.0).
- **La vérification de cohérence** gagne la famille « groupe de choix » : elle reconnaît le genre à la forme du choix
  actif et refuse toute forme hors de ces trois, en clair, en sombre et au téléphone.
- Au passage : le survol d'un bouton discret en sombre prend la teinte de la charte ; et le rouge intermittent de la
  1.366.0 sur GitHub (vente en euros) venait du test, qui tapait parfois le taux pendant que la fenêtre posait le
  curseur dans « Montant » — il attend maintenant le curseur.
- Quatre preuves « cohérence 1.368.0 a–d ».

### 1.368.1 : le Cabinet d'un comptable dont aucun client n'est sur SkanFact

Un comptable veut essayer le Cabinet, et la plupart des cabinets n'auront aucun client sur SkanFact. Un cabinet neuf
(« Cabinet Gharbi », cinq dossiers tenus, aucun relié) a été joué à la souris : premier écran, création d'un dossier
tenu, liste collée, livre démarré avec sa balance d'ouverture, saisie au clavier, journal et balance, relevé de
banque importé et rapproché, salarié déclaré, puis les vingt-sept écrans d'un dossier — aucun ne tombe, aucune
erreur de console ni de serveur.

Ce qui parlait encore d'un cabinet qui reçoit des paquets, corrigé :

- la balance disait « ce livre part de zéro » sous une balance d'ouverture qu'on venait de saisir ;
- sans livre, le titre et le fil de la comptabilité restaient ceux de l'écran précédent ;
- « aucun de tes 1 client », « 1 tenus au cabinet » ;
- les Pièces reçues et les Pièces du dossier promettaient des envois d'un client qui n'est pas sur SkanFact ;
- chaque ligne de la balance d'ouverture proposait « Clients » comme libellé : elle propose le nom du compte tapé ;
- une liste collée avec un matricule illisible n'était refusée qu'après « Ajouter » : l'aperçu le dit avant, et le
  bouton reste éteint.

Sept preuves « cabinet sans client 1.368.1 a–g » ; les preuves « menu 1.269 f / i », que la 1.368.0 avait rendues
muettes, visent ses règles.

**À décider par Skander avant l'essai :**

- l'abonnement du Cabinet est en service : au quatrième dossier tenu, une facture part (60 DT HT par dossier et par
  an), et les dossiers payants passent en lecture seule si elle reste impayée. Aucun geste ne permet d'offrir un
  abonnement à un cabinet, et la fenêtre « coller une liste » ne dit pas que des dossiers seront payants ;
- un dossier dont le livre commence en janvier affiche dès le premier jour des mois « en retard » et des échéances
  échues ; la CNSS du trimestre est comptée « par prudence » sans salarié (règle 1.175.0, voulue).

**Pas rejoué ce jour-là :** l'inscription à la souris (compte créé par l'interface du serveur), le double facteur,
les courriels, le téléphone ; et les quarante-huit appels propres à l'application de bureau, dont on n'a pas vérifié
qu'aucun bouton ne reste à l'écran.

### 1.369.0 : tout importer le premier jour (le Cabinet d'un comptable qui arrive d'un autre logiciel)

Skander : « vérifie qu'on peut bien tout importer le premier jour et exporter ». Joué à la souris sur le cabinet
neuf, avec de vrais fichiers : une balance Excel de fin d'année, un journal CSV en Windows-1252, un FEC d'un an.

- **La balance d'un autre logiciel** se lit par ses SOLDES quand le fichier porte aussi les mouvements, ses titres
  longs sont reconnus (« N° de compte », « Intitulé du compte »), et chaque compte ouvre d'un seul côté. Avant, les
  intitulés étaient perdus, et une balance « Débit, Crédit, Solde débiteur, Solde créditeur » risquait d'ouvrir le
  livre sur ses mouvements.
- **Une balance de fin d'année** porte encore ses charges et ses produits : ils ne sont pas repris, et leur résultat
  va au compte 13 (À VÉRIFIER : le compte, si le résultat est déjà affecté). Un rapport le dit AVANT que la balance
  de la fenêtre change : comptes lus, colonnes prises, résultat reporté, total au débit et au crédit, équilibre.
- **Les sous-comptes gardent leur nom** : « 41100001 Client CNAM », « 53200000 BIAT ». Deux clients s'appelaient
  « Clients », deux banques « Banques ». Le sous-compte d'un client ou d'un fournisseur porte aussi son nom en tiers.
- **L'année d'avant reste offerte** : après avoir ouvert 2026 sur la balance, on peut encore ouvrir 2025 pour y
  reprendre l'historique (un FEC). Elle n'était plus proposée nulle part.
- **« Tout le brouillard »** : une année importée (36 écritures) se valide d'un geste ; il fallait douze mois ou trois
  journaux. Le bouton ne paraît que s'il valide plus qu'un lot seul.
- Le menu d'une ligne se referme quand on change d'écran par « Précédent ».
- **Vérifié sans rien changer** : le journal CSV en Windows-1252 (accents, dates JJ/MM/AAAA, virgules), le FEC en
  balance d'ouverture et en historique, l'aller-retour FEC (99 lignes, 127 098,000 au débit et au crédit, à
  l'identique), l'export de la balance.
- Les règles neuves vivent dans le moteur (`modules/socle/moteur/compta-1.js`), pas dans le pont, qui retrouve sa
  limite de taille (le rouge GitHub de la 1.368.1).
- Sept preuves « import 1.369.0 a–g ».

**Ce qui manque encore à l'import** : une liste de salariés et un tableau d'immobilisations à coller (aujourd'hui,
un par un).

### 1.370.0 : un dossier d'exemple complet, dans son propre cabinet

*Demandé par Skander le 16/11/2026, pour le premier comptable qui essaie le Cabinet : « la démo, il faut qu'elle
remplisse tout afin de tester complètement ».*

Un comptable qui ouvre SkanFact Cabinet le premier jour n'a aucun client à ouvrir, et la plupart de ses clients ne
seront pas sur SkanFact : un écran vide ne montre rien de ce que l'outil sait faire. L'exemple de l'ancienne
application (six clients fictifs et leurs paquets) n'avait plus de sens en ligne ; il revient sous une autre forme.

**Ce que c'est.** UN dossier tenu, « Exemple · Pâtisserie El Amal », chargé d'un clic dans le cabinet du comptable :

- le serveur le crée et lui seul le marque « exemple » (migration 0214) : il **ne compte jamais dans l'abonnement**
  (ni parmi les trois gratuits, ni parmi les payants), il n'y en a qu'un à la fois, seul un associé le charge ou le
  retire, et il se retire **avec ses livres** (un dossier tenu ordinaire qui a une écriture ne se retire pas) ;
- le Cabinet le **remplit par ses propres gestes** (`web/public/plateforme/exemple-cabinet.js`, chargé à la demande) :
  la reprise des soldes, la saisie par lot, la validation, la paie, la banque, les déclarations, l'inventaire, les
  dotations, la clôture. Ce que l'exemple montre est donc ce que l'outil fait ; une règle du moteur qui change le
  change avec elle. Une demi-minute, qui se dit dans une fenêtre (l'étape en cours) ;
- ses dates suivent le jour où on le charge : un exemple daté montrerait des retards qui n'existent pas.

**Ce qu'il contient.** L'exercice d'avant : repris sur ses soldes, tenu douze mois (ventes au comptoir, deux clients
à crédit, achats, loyer, électricité, emprunt, salaires), déclaré douze fois (préparé, écrit, déposé, payé), un bien
amorti, un inventaire et sa variation de stock, **clôturé**, ses à-nouveaux ouverts. L'exercice en cours : tenu
jusqu'au mois dernier, trois salariés et leurs bulletins (validés, payés ; une prime en juin, une absence en mars),
les retenues, la TFP et la CNSS payées à l'État, les déclarations déposées jusqu'à l'avant-dernier mois, un relevé de
banque entièrement rapproché. **Ce qui reste à faire**, comme un vrai matin : préparer la déclaration du mois
dernier, remettre ses bulletins, valider le brouillard du mois en cours, rapprocher le relevé du mois dernier (qui
porte des agios que le livre n'a pas : l'écriture se crée depuis la ligne), relancer le client qui paie en retard.
Les taux sont ceux d'un exemple (19 % partout) : ils montrent une TVA à payer chaque mois, pas une règle fiscale.

**Où il s'offre.** Sur le premier écran d'un cabinet sans dossier (la première ligne, le seul bouton vert), dans
« Tes premiers pas » (l'étape « Essayer sur un dossier d'exemple », facultative), et dans les Réglages
(« L'application », « Exemple ») où il se retire. Son bandeau (« Dossier d'exemple : rien ne compte ici ») ne se
pose **que sur ses pages à lui**, jamais sur le tableau de bord du cabinet. Il ne réclame aucun retard inventé (sa
CNSS des trimestres passés est payée dans ses livres : seule celle à venir se compte).

**Tests.** `tests/cabinet/exemple.test.ts` (le serveur : un seul, un associé de ce cabinet, hors abonnement, retiré
avec ses livres, jamais un dossier tenu ordinaire) et `tests/web/cabinet-exemple-1370.test.ts` (à la souris, depuis
le premier écran : la fenêtre d'attente, les deux exercices lus dans les livres, les déclarations, la paie, la
banque, l'équilibre de chaque écriture, le bandeau, l'abonnement, le retrait). Preuves « exemple 1.370.0 ».

**Ce qui reste pour l'essai d'un comptable** (suite de cette revue) : coller une liste de salariés et un tableau
d'immobilisations ; les alarmes « en retard » d'un dossier dont le livre vient d'être créé ; le nom des fichiers
exportés (le matricule plutôt que le nom du client) ; rejouer l'inscription, chaque visite « Me guider » et le
téléphone à la souris ; dire, avant le quatrième dossier tenu, que l'abonnement commence.

### 1.371.0 : le premier jour d'un client tenu au cabinet

*Skander, le 16/11/2026 : « fais attention au guide et à la simplicité, sinon il va être perdu et abandonner ;
vérifie qu'on peut bien tout importer le premier jour ». Joué à la souris sur un cabinet dont aucun client n'est
sur SkanFact : un client ajouté, son livre, ses salariés, ses biens, ses soldes, ses exports.*

**Ce qui perdait un comptable le premier jour.**

- **Dix mois « à saisir » en rouge pour un client créé il y a une minute.** Un client tenu au cabinet sans date de
  début de mission se voyait compter toute l'année. À la création, SkanFact demande maintenant « à partir de quand
  tiens-tu ce dossier ? » (ce mois-ci, depuis janvier, un autre mois : la fenêtre des clients sur SkanFact, la
  même). « Plus tard » reste possible : la fiche et « À voir » portent alors la question, et disent ce que le
  silence coûte. Une liste de clients collée pose la question **une fois pour tous** ; au-delà de trois dossiers
  sans réponse, « À voir » n'en fait qu'une ligne.
- **Une fiche vide qui ne disait pas par où commencer.** « Par où commencer avec… » : le livre d'abord (le seul
  bouton tant qu'il n'existe pas, puisque tout le reste en dépend), puis les soldes d'avant, les salariés, les
  biens, la banque, les pièces du mois. Chaque reprise faite se coche avec ce qu'elle a posé ; le panneau s'efface
  à la première pièce saisie.
- **Un livre créé « pour voir » ne pouvait plus recevoir sa balance.** L'exercice était « déjà ouvert » et la
  balance de l'ancien logiciel devait se retaper au journal AN. Le serveur (migration 0215) accepte la reprise
  tant que l'exercice n'a **aucune ouverture en vigueur** (ni balance, ni écriture au journal AN) et n'est pas
  clos ; une ouverture contre-passée ne compte plus, la bonne se reprend d'un geste. L'écran Exercice l'offre en
  tête (« Reprendre les soldes d'ouverture… »), et la fenêtre dit « Reprendre ces soldes », plus « Ouvrir
  l'exercice ».
- « La prochaine déclaration » d'une mission qui commence ce mois-ci annonçait celle du mois dernier, celle du
  prédécesseur. « Commencer le livre de Atelier… » s'élide.

**Ce qui se ressaisissait un par un.**

- **Une liste de salariés** se colle depuis un tableur (« Déclarer un salarié… », « Coller une liste de
  salariés… ») : nom, CIN, n° CNSS, poste, contrat, salaire brut, date d'embauche, enfants, dans n'importe quel
  ordre. Sans date d'embauche, le 1er janvier de l'exercice est posé et marqué « à préciser » ; un n° CNSS mal
  écrit n'arrête pas le salarié (il entre sans numéro, la ligne le dit).
- **Le tableau des immobilisations** se colle de même (« Ajouter un bien… », « Coller le tableau… ») : la durée se
  lit ou se déduit du taux (20 % : cinq ans) ; sans l'une ni l'autre, une famille reconnue par **tous** ses mots
  propose la sienne (dite « proposée »), sinon la ligne est refusée : une durée ne se devine pas. Linéaire, à
  vérifier avec le tableau d'origine.
- Dans les deux cas on voit ce qui entrera avant de valider ; une ligne illisible est refusée **avec son numéro
  et sa raison**, les autres entrent ; un doublon est ignoré et nommé ; une colonne inconnue est laissée de côté
  et nommée. La lecture vit dans le moteur du Cabinet (`parseSalariesLines`, `parseBiensLines`), l'écran
  enregistre par les gestes ordinaires.

**Les exports, rejoués** sur le dossier d'exemple : tableau des immobilisations, grand livre, balance, livre-journal,
FEC, liasse, écritures de tous les clients. Un défaut : **« Exporter le lettrage » sortait le grand livre entier**
(capital et TVA compris) sous le nom « lettrage ». Il exporte le compte montré (411 par défaut), et son fichier
le nomme.

**Reste à faire, noté.** L'exemple compte dans « Honoraires du cabinet » de la liste des dossiers ; le menu d'un
dossier tenu propose « Les paquets reçus » ; l'inscription, le code à usage unique et chaque visite « Guide-moi »
restent à rejouer à la souris, au téléphone aussi.


### 1.372.0 : le guide du Cabinet explique chaque écran

Demande de Skander : « Fais attention aussi au guide et à la simplicité de compréhension, sinon il va être perdu et
abandonner. » Chaque visite « Guide-moi » a été déroulée à la souris, écran par écran, sur le cabinet d'essai.

**Ce qui n'allait pas.** La visite d'une page se LIT sur l'écran, bloc par bloc ; elle ne connaissait que les blocs de
l'ancien Cabinet. Sur les écrans en ligne :

- le tableau de bord sautait « À faire maintenant » et la campagne du mois (4 étapes, dont deux utiles) ;
- la liste des dossiers se réduisait à « Chercher », sous une introduction qui décrivait l'ancien écran ;
- la fiche d'un dossier annonçait « deux onglets » qui n'existent plus, et n'expliquait que les relances ;
- toute la comptabilité d'un dossier vit dans UN panneau : la visite le lisait d'un bloc, ses onglets récités sous le
  titre « Le brouillard », et promettait « je vais te les ouvrir un par un » sans le faire ;
- les vingt-sept comptes repliés d'un grand livre étaient jugés invisibles (un volet replié) ;
- « Les prochaines dates » nommait une ligne par tout son texte collé — « Déclaration d'octobre 2026samedi 28/11 ·
  dans 12 jours7 dossiers » — et l'annonçait comme le nom d'une page.

**Ce qui est fait.**

- Le moteur (`web/public/v10/visite.js`) écoute l'hôte d'abord : un bloc NOMMÉ par une zone est une étape quelle que
  soit sa classe ; un conteneur que l'hôte dit de traverser (`descendre`) se lit partie par partie ; une `serie`
  (les comptes du grand livre) s'explique une fois ; un volet replié est à l'écran ; une ligne-lien se nomme par son
  premier morceau et dit la page où elle mène.
- Les zones du Cabinet (`modules/socle/visites/cabvisites.js`) : une phrase pour chaque bloc du tableau de bord, des
  dossiers, de la fiche, des quatorze écrans de comptabilité (la frise des mois, la grille, le brouillard, le relevé,
  la preuve de banque, les bulletins, le formulaire de déclaration, les feuilles maîtresses, la liasse…), du
  classeur, des pièces, des échéances, des messages et des relances. Chaque phrase a été vérifiée contre ce que
  l'écran FAIT (un clic sur une case détaille le mois, une étape de la campagne filtre la grille…).
- Mesuré : tableau de bord 4 → 6 étapes, dossiers 3 → 6, fiche 4 → 10, saisie 4 → 8, banque 4 → 9, paie 4 → 11.

**Le dossier d'exemple n'est pas un client.** Il gonflait « n clients » et les honoraires du cabinet (250 DT par mois
inventés). Il reste sur sa ligne, marqué, hors des totaux ; la phrase du portefeuille le dit.

**Tests.** `tests/web/cabinet-visites-1372.test.ts` : douze écrans du dossier d'exemple, chacun avec ses étapes et leur
phrase ; la visite du tableau de bord déroulée à la souris ; l'exemple hors des comptes. Dix preuves par
réintroduction (« visites 1.372.0 a–l »). Deux bouts de code que la preuve a montrés inutiles ont été retirés.

**L'inscription d'un comptable, jouée à la souris** (ordinateur et téléphone, base d'essai) : créer le compte, « Je suis
un cabinet comptable », le nom du cabinet, puis le code du téléphone, exigé de chaque comptable depuis le 09/10/2026.
C'est le seul passage où un testeur peut caler : il lui faut une application d'authentification AVANT de voir le
Cabinet. La règle de sécurité n'est pas touchée ; l'écran nomme maintenant deux applications. **À décider par Skander**
pour l'alpha : garder cette exigence dès la première minute, ou la demander à la première pièce d'un vrai client.

**Le menu d'un dossier tenu au cabinet** ne propose plus « Les paquets reçus », et son suivi ne parle plus de « mois
reçus » : ce client n'envoie rien.

**Reste à faire, noté.** Les parcours « geste guidé » (47) n'ont pas tous été joués un à un.

## 1.373.0 — L'entrée d'un comptable qui vient essayer (issue 3 de la revue du 16/11/2026)

Un comptable neuf s'arrêtait avant d'avoir vu le Cabinet : une porte qui ne parlait qu'aux entreprises, puis une
application d'authentification à installer avant le premier écran.

- **Le code du téléphone ne barre plus l'essai** (migration 0216). Il n'est exigé d'un comptable que lorsque son cabinet
  tient un vrai dossier, et **sept jours après le premier** : rien tant que le cabinet est vide ou n'a que son dossier
  d'exemple. La fenêtre « Nouveau dossier » l'annonce, un rappel en haut des pages du cabinet dit le jour et mène à
  « Ton compte », et passé le délai l'écran du code revient (règle de 0076, déplacée au moment où elle protège quelque
  chose). Le délai de sept jours est une décision de produit, à confirmer.
- **La porte** : trois cartes de même poids (l'essai, mon entreprise, **mon cabinet**). Le cabinet nommé, on choisit son
  départ : **découvrir avec un dossier d'exemple** (recommandé) ou **commencer avec mes clients**. L'exemple se charge en
  montrant son avancement (une barre, « une à deux minutes »), s'ouvre, et la visite de sa fiche part toute seule.
- **Un refus ne fait plus perdre le curseur** : après « Créer mon cabinet » à vide, la première lettre tapée rebâtissait
  le champ, et la suite partait dans le vide (un cabinet créé sous le nom « C »). Un nom de cabinet fait deux
  caractères au moins ; un champ vide se dit vide (plus de « au moins 1 caractère(s) »).
- **L'exemple vit à côté des vrais dossiers** : dès qu'un vrai dossier existe, il sort des comptes de la barre, du
  tableau de bord, de la campagne et des échéances ; seul, il y reste (c'est lui qui montre ces écrans). Il reste à un
  clic dans « Créer ».
- **Seul dans son cabinet**, « Les miens / Tous » n'apparaît plus (le fondateur n'a aucun dossier « confié »).
- « Inviter ton équipe » ne se coche plus toute seule ; la fiche dit la TVA telle qu'elle est réglée (« mensuelle par
  défaut, à préciser » quand elle ne l'est pas) et ne porte plus qu'une mention « À VÉRIFIER », adressée au comptable ;
  l'invitation « Première fois sur cet écran ? » ne se pose plus par-dessus le chargement de l'exemple.

Joué à la souris : compte neuf → porte → refus puis frappe continue → départ → exemple (31 s ici) → visite ; puis
« mes clients » → premier vrai dossier → rappel « d'ici 7 jours » → « Ton compte ». Test : `tests/web/cabinet-entree-1373.test.ts`.

Reste des issues 3 à 12 : voir la liste tenue dans la session (bloquants du portefeuille, de la saisie et de la banque
d'abord).


## 1.374.0 — Le portefeuille : les bloquants de l'issue 12 (revue du 16/11/2026)

- **« Rechercher… » s'ouvre au clic** (constat 3) : seul Ctrl K l'ouvrait ; le bouton de la barre, et « Rechercher »
  du menu « Plus » au téléphone, n'étaient branchés à rien.
- **Un mot tapé hors d'un champ ne crée plus rien** (constat 4) : une lettre qui suit le N dans la demi-seconde, ou qui
  ne choisit rien, referme « Créer », et les raccourcis à une lettre se taisent tant que la frappe continue (une seconde
  de silence les rend).
- **Les régimes** (constat 2) : une échéance annuelle mal écrite, ou une date qui n'existe pas (31-02), est refusée en la
  nommant, et la saisie reste. Le remplacement de `nom@JJ-MM` par deux champs reste à faire.
- **Le prix d'une liste collée** (constat 1) : « Ce que ça coûte » se lit au-dessus de l'aperçu, compté sur ce qui
  entrera (n gratuits, m payants, le prix d'un dossier). Rien ne se calcule à l'écran : le prix vient du serveur.
- **Un seul état d'abonnement** (constat 1) : le panneau, le menu du compte et le téléphone disent le même mot
  (« Gratuit : rien à régler », « Facture en préparation », « Payé jusqu'au … ») ; la facture en préparation annonce
  son montant et sa date quand le serveur les donne.
- **Les visites guidées** (constat 24) : « Tenir la fiche d'un client » suit la fiche d'aujourd'hui (elle ouvrait
  l'ancien écran « …/suivi ») ; « Démarrer mon cabinet » et « Suivre la production » ne montrent plus une étape dont le
  bloc n'est pas à l'écran ; le bouton s'appelle « Ajouter un client… » partout ; « Saisir une pièce » est possible dès
  qu'un dossier tenu existe.

Joué à la souris sur le cabinet d'essai. Tests : `tests/web/barre-cabinet.test.ts`, `cabinet-visites-1372`,
`cabinet-production`. Neuf preuves par réintroduction (« revue 1.374.0 a…i »).

Reste de l'issue 12 : constats 5 à 23 et 25 à 33 (un seul mot par état de mois, le retard en tête de « À faire »,
archiver en une petite fenêtre, la recherche sans accents…). Puis les issues 11, 10, 9, 6, 4, 5, 7, 8.

## 1.375.0 — La revue « saisie et banque » : les trois points qui faisaient de faux chiffres

Une autre session a revu la saisie et la banque du Cabinet (issue 11). Ses trois constats bloquants, corrigés ici :

- **Le modèle de colonnes d'une banque lisait de faux montants.** Retenu pour « BIAT », il s'appliquait à tout fichier
  nommé BIAT, même un export aux titres clairs rangés autrement : un virement reçu devenait une sortie, en vert. Le
  fichier se lit d'abord SEUL, à ses titres ; le modèle se range avec les titres du fichier qui l'a fait naître et ne
  vaut que pour eux (un modèle d'avant, sans titres, ne sert plus qu'à un fichier que ses titres ne disent pas).
  L'écran le DIT (« Colonnes lues d'après le modèle retenu pour BIAT »), avec « Revoir les colonnes » et « Oublier ce
  modèle ». Le serveur accepte `titres` dans le modèle.
- **La TVA d'une règle de banque ne partait pas.** L'écriture proposée montrait trois lignes (626 / 4366 / 532),
  Entrée n'en envoyait que deux : « débit ≠ crédit ». La ligne de TVA part avec l'écriture, depuis la touche Entrée
  comme depuis « Écrire autre chose… » tant que le compte proposé est gardé ; un autre compte reprend le montant entier.
- **Une validation refusée doublait la pièce.** « Enregistrer et valider » range d'abord au brouillard ; si la
  validation se refuse (date future, mois clos), la pièce restait dans la grille sous « Enregistrement impossible »,
  et un second clic l'enregistrait deux fois. La fenêtre dit « Gardée au brouillard, pas validée », avec la raison ;
  la grille se vide et le brouillard se relit.

Et un quatrième, trouvé en rejouant les tests : dans la saisie d'une pièce, le compte tapé d'un trait juste après la
TVA (Tab puis « 6241 ») perdait ses premiers chiffres (« 41 »), parce que la fiche redessinée sélectionnait ce qui
venait d'être tapé. Le curseur va au bout. Ce défaut dépend de la vitesse de la machine : il n'a pas de preuve stable
(le défaut remis, le test passe une fois sur deux), c'est dit ici plutôt que caché.

Test à la souris : `tests/web/cabinet-banque-1375.test.ts`. Six preuves « revue 1.375.0 a…f ».

## 1.375.1 — « Joindre un justificatif… » marche

Le bouton de la grille de saisie et l'entrée du menu d'une écriture appelaient un geste que le Cabinet en ligne n'avait
pas : « Justificatif impossible », partout (issue 11, point 9), alors qu'une visite guidée l'enseigne. Plutôt que de le
retirer, il fait ce qu'il dit : le fichier choisi va au classeur du dossier, au mois de l'écriture, joint à elle du même
geste (les deux appels existaient déjà, rien de neuf ne part au serveur). Preuve « revue 1.375.1 a ».

## 1.375.2 — La barre d'onglets collante de la comptabilité a un fond

Dans la comptabilité d'un dossier, la barre « Saisir · Consulter · Déclarer » reste collée en haut quand on descend
dans un long journal ; la charte lui avait retiré son fond, et les lignes se lisaient à travers (issue 11, point 14).
Elle porte le fond de la page. Preuve « revue 1.375.2 a ».

## 1.376.0 — La revue « paie, immobilisations, inventaire » : le paiement des salaires, l'avance

Une autre session a revu la paie, les immobilisations et l'inventaire du Cabinet (issue 10, 37 constats). Premier lot :

- **« Noter les salaires payés »** (bloquant) : « 01/01/2020 » passait, et l'écriture de banque tombait à une autre
  date. Le jour du paiement se refuse sur son champ s'il est avant le mois payé ou pas encore arrivé ; noté par
  erreur, il se défait d'« Annuler » dans le message (le jour s'efface, son écriture avec lui).
- **Avance sur salaire** : une retenue mensuelle plus grosse que l'avance se refuse sur son champ.

Reste de l'issue 10, à faire : l'absence posée après la validation (bloquant, demande un geste de régularisation),
les retenues au compte du personnel (avis du métier, À VÉRIFIER), le lot de bulletins, les immobilisations au niveau
de la paie. Quatre preuves « revue 1.376.0 a…d ».

## 1.376.1 — Un trimestre de CNSS payé ne crie plus « Date limite dépassée »

Dans la Paie › CNSS du trimestre, la ligne de la date limite disait en rouge « Date limite dépassée » deux lignes au-dessus
de « le trimestre est payé » (issue 10, point 11). Quand le livre porte, le trimestre suivant, un versement au moins égal
à ce qui est dû, la ligne dit « Payée : le versement est au livre ». Preuve « revue 1.376.1 a » (sur le dossier d'exemple).

## 1.376.2 — Le rouge GitHub de la 1.374.0 : le test de la barre du Cabinet

Sur la machine de GitHub (Node 24), le test « au bureau » de la barre du Cabinet dépassait ses 20 secondes. Deux
causes, dans le test seul : il n'avait pas de limite à lui depuis qu'il a grandi, et sa boucle « N puis D » se
piégeait elle-même — un D arrivé volet fermé compte pour une frappe (règle de la 1.374.0 : les raccourcis se taisent
une seconde), et le N suivant, rappuyé trop tôt, était avalé à chaque tour. Le test laisse passer ce silence, et porte
60 secondes. Le produit ne change pas.

## 1.377.0 — Une absence arrivée après la validation se régularise (issue 10, CABPAIE-1)

Le blocage de la revue de la paie du Cabinet : une absence sans solde posée APRÈS la validation du mois était dite
« retirée du salaire » et n'était jamais retenue, ni sur le mois validé (normal : il ne bouge plus), ni sur le suivant.

- **Le moteur de régularisation de l'entreprise (1.230.0) arrive au Cabinet.** La fiche d'un salarié garde ses
  `regularisations` (le pont et le moteur les jetaient en lisant la fiche) ; le bulletin du mois visé les propose de
  lui-même, comme l'échéance d'une avance. Leur ligne est signée par nature : le garde-fou « une prime se saisit en
  positif » la laisse passer, elle seule.
- **Le mois validé nomme la vraie différence et son montant** : « 0 jour non payé au bulletin, 1 dans « Congés et
  absences » — à retenir : 50,000 DT de brut », avec le geste **« Régulariser sur novembre »** (le premier mois où le
  salarié n'a pas encore de bulletin). Une question dit avant ce que le bulletin suivant proposera. « Annuler » la défait
  tant qu'aucun bulletin ne l'a reprise. Régularisé, le bandeau passe au gris et le dit.
- **Sans pointage enregistré, l'absence compte quand même** : le bandeau ne parlait que si la grille du mois avait été
  pointée ; une absence posée dans « Congés et absences » n'était alors vue de personne.
- **Le pointage se relit au salaire du bulletin**, pas à celui de la fiche d'aujourd'hui : une augmentation d'après la
  validation se disait « pas les mêmes heures supplémentaires ».
- **La fenêtre de l'absence le dit AVANT d'enregistrer** (« le bulletin d'octobre est déjà validé : il ne bouge pas… »),
  le message d'après le redit, et la liste écrit « pas retenue : à régulariser », puis « régularisée sur novembre » —
  jamais « retirée du salaire » tant que rien n'est retenu.
- **Élisions (CABPAIE-26)** : « l'absence d'Amel », « l'avance d'Hédi », « la fiche de Youssef » (le y ne s'élide pas).

Limites, dites : le geste n'existe que pour un dossier tenu au cabinet (pour un client sur SkanFact, la régularisation se
fait dans son SkanFact, et le bandeau le dit) ; la retenue réduit le brut du mois suivant, imposable et cotisable — la
façon d'imposer une régularisation reste À VÉRIFIER avec le comptable, comme pour un rappel. Essai :
`tests/web/cabinet-paie-regul-1377.test.ts` (écran et serveur, 1 300 DT sur 26 jours : 50,000 DT le jour). Sept preuves.

## 1.377.1 — La paie du Cabinet : le mois pas fini, et la sortie d'un salarié (issue 10, CABPAIE-7 et 9)

- **Un mois dont il reste des bulletins à établir ne se compare pas au mois d'avant** : « Coût… − 2 152,706 DT : 2 départs
  ce mois » s'affichait pour deux bulletins simplement pas encore faits. Tant qu'il en reste, les tuiles disent
  « 1 bulletin sur 4 : le mois n'est pas fini ».
- **« Noter la sortie… » demande le dernier jour travaillé** (aujourd'hui par défaut, refusé avant l'entrée). Le salarié
  reste compté dans les mois où il était là — son dernier bulletin reste attendu et il reste proposé pour ce mois —, puis
  n'est plus attendu. Un dernier jour à venir (un CDD qui finit) le laisse en poste jusque-là. **« Annuler la sortie »**
  le remet en poste. Sorti sans date par l'ancien geste, un salarié ne compte nulle part, comme avant.

Essais : `tests/web/cabinet-paie-regul-1377.test.ts` (second parcours) et `cabinet-paie-hors-skanfact.test.ts`. Quatre preuves.
Le motif de la sortie n'est pas demandé : rien ne le lit encore (les documents de sortie le demandent eux-mêmes).

## 1.377.2 — Le paramétrage de la paie, et la sortie ou la suppression d'un bien (issue 10, CABPAIE-12, 15, 18)

- **Le paramétrage ne compte « à régler » que ce qui se règle ici.** « 2 réglés · 11 à régler » comptait sept choses que
  SkanFact ne règle pas (convention, nuit, férié, maladie, ancienneté, fin d'année, grille) : elles sont dites « hors
  SkanFact », à vérifier dans la convention ou à porter à la main sur le bulletin. Le bandeau n'accuse plus les bulletins
  (« faux d'autant ») : il dit quoi faire.
- **Supprimer un bien : le refus se dit avant la question.** La fenêtre promettait « c'est une fiche qu'on retire », puis
  le geste refusait. Il se joue d'abord sur une copie du livre, par la fonction qui refusera.
- **« Céder ou mettre au rebut… » est au menu du bien** : la sortie se cachait au bas de « Modifier la fiche ». Le geste
  ouvre la fiche, le curseur sur la date de sortie.

Reste de CABPAIE-15, dit : le prix de cession n'est toujours pas montré en produit ni en plus ou moins-value à l'écran.
Essais : `cabinet-paie-parcours.test.ts`, `cabinet-immobilisations.test.ts`. Trois preuves.

## 1.377.3 — Les bulletins s'enchaînent (issue 10, CABPAIE-6)

« Établir les bulletins : 3 à faire… » ouvrait la fenêtre sur le premier salarié de la liste, déjà servi (bouton éteint) :
il fallait choisir le suivant à la main, à chaque fois. La fenêtre s'ouvre sur **le premier salarié qui n'a pas encore son
bulletin** ce mois-ci, et **« Enregistrer et passer au suivant »** la rouvre sur le suivant tant qu'il en reste (le dernier
n'a plus ce bouton). « Enregistrer le bulletin » ferme comme avant : on reste libre de s'arrêter.

Reste de CABPAIE-6, dit : pas de préparation de tous les bulletins d'un seul geste (la maquette « Préparer les 5 bulletins »).
Essai : `tests/web/cabinet-paie-regul-1377.test.ts`. Deux preuves.

## 1.377.4 — Une échéance d'avance oubliée se reporte (issue 10, CABPAIE-13)

L'échéancier d'une avance comptait comme remboursé un mois dont le bulletin existe SANS la retenue : 300 prêtés à 100 par
mois, un premier mois déjà validé, et il ne restait que 200 planifiés. Une échéance oubliée se dit toujours (« pas
retenu »), mais ne rembourse rien : les retenues à venir vont jusqu'au bout de l'avance. (La mensualité plus grosse que
l'avance est refusée depuis la 1.376.0.) Essai : `cabinet-paie-parcours.test.ts`. Une preuve.

## 1.377.5 — La frise du mois ne coche « Pointage » que s'il est passé (issue 10, CABPAIE-8)

La première étape de la frise de la paie était toujours cochée en vert, au-dessus de « Le pointage n'est pas encore là ».
Elle n'est cochée que si un pointage existe, ou si les bulletins sont partis sans lui (« sans pointage : des mois
complets ») ; sinon, c'est l'étape où l'on est. Reste de CABPAIE-8, dit : une absence tapée dans le bulletin ne se pose
pas sur la grille du pointage, et un jour pointé « C » ou « M » n'entre pas dans « Congés et avances » — trois sources
à réunir. Essai : `cabinet-paie-hors-skanfact.test.ts`. Une preuve.

## 1.377.6 — Les écarts et les contrôles de la paie voient le net (issue 10, CABPAIE-4)

Un salarié dont le net baissait de 15 % à cause d'une retenue était rangé sous « Comme octobre », et le contrôle disait
« Aucun écart de plus de 5 % » : seuls le brut, les heures sup, l'absence et l'avance étaient lus.

- **La ligne du bulletin dit la retenue et la prime tapées** (« retenue : Opposition 100,000 DT », « prime : … ») ; un net
  qui bouge sans raison lue se dit quand même (« net − 12,000 DT sur octobre »), jamais « comme octobre ».
- **Le contrôle des 5 % juge aussi le net**, ce que le salarié touche : « Écarts de plus de 5 % expliqués · Youssef Mejri
  − 12,1 % de net ».
- La phrase « un écart du net… serait une erreur de taux ou de barème » est retirée : une retenue change le net sans
  toucher au brut, et l'écran le dit.

Reste de CABPAIE-4, dit : dans « Les écarts ligne à ligne », la source d'une absence ou d'une prime tapée dans le bulletin
se dit encore « pointage » ou « fiche ». Essai : `cabinet-paie-regul-1377.test.ts`. Deux preuves.

## 1.378.0 — Deux portes dans la période validée (issue 9, CABDECLARER-1, -2 et -30)

Deux gestes ordinaires d'un cabinet se cognaient à « la période est validée jusqu'au… », sans aucune issue.

- **L'écriture de TVA d'un mois déjà validé s'écrit.** L'ordre naturel — je valide le mois, je déclare, je passe la TVA —
  aboutissait à un refus rouge, pour toujours, sous un bouton vert. L'écriture de déclaration n'est pas une saisie (le
  logiciel la calcule, elle ne change ni produit ni charge) : dans un mois validé, elle est **posée et validée d'un geste**,
  numérotée et scellée, par quelqu'un qui a le droit de valider. L'écran le dit : « Écriture du mois écrite et validée :
  mars 2026 était déjà validé, elle est entrée au livre telle quelle. » Hors période validée, rien ne change (brouillard).
  Une saisie ordinaire reste refusée dans le mois validé.
- **Un exercice clos se rouvre même quand des mois de l'année suivante sont validés** — le cas de tous les dossiers en mars.
  La période validée ne recule plus : seul l'exercice rouvert redevient écrivable, dans ses propres dates ; janvier et
  février restent fermés. Ce qu'on y écrit entre au brouillard, se valide pièce par pièce, et la clôture refaite referme la
  porte. Les à-nouveaux de l'année suivante se complètent à son premier jour (journal AN seulement).
  **À VÉRIFIER avec le comptable pilote** : c'est l'usage que j'ai retenu (rouvrir N sans dévalider N+1) ; un cabinet peut
  préférer passer la pièce tardive sur N+1.
- **Un motif de trois lettres** se voit répondre « au moins 5 caractères », plus « une réouverture demande un motif ».

Migration `0217_portes_de_la_periode_validee.sql`. Essais : `tests/compta/declaration.test.ts`,
`tests/compta/cloture-exercice.test.ts`, `tests/web/declaration-1350.test.ts`, `tests/web/cabinet-cloture.test.ts`.
Dix preuves. Et un rouge GitHub réparé : la preuve « jour1 1.371.0 c » restait verte sur une machine lente (l'essai
attendait trente secondes, le temps qu'un rafraîchissement de fond redessine la fiche) ; il attend quatre secondes.

## 1.378.1 — La fiche, l'export et la révision disent le vrai chiffre (issue 9, CABDECLARER-3, -4, -5)

- **La carte de la fiche s'appelle « Déclaré à l'État »** et porte le total des déclarations déposées (TVA, retenues,
  IRPP, TFP, FOPROLOS, timbre) — elle n'en montrait que la TVA, sous le mot « payé ». Elle dit combien sont notées payées.
  Dans la grille de l'année, un mois déposé dit « déclarés » ; « payés » seulement s'il est noté payé.
- **La fiche se met à jour tout de suite** : elle gardait sa première lecture du livre jusqu'au rechargement de
  l'application (« 9 déclarations » après en avoir déposé une dixième). Le livre que la comptabilité vient de modifier
  fait foi.
- **L'export pour un contrôle dit l'état réel de chaque mois.** Tout mois déposé partait « déposée et payée » (le dépôt
  et le paiement sont des objets datés, lus comme des oui/non). Le fichier porte maintenant le formulaire entier : la
  date du dépôt, celle du paiement, chaque case, le total.
- **La révision d'un mois montre les soldes de la balance** : la banque d'octobre s'ouvrait à 0 et son « solde » n'était
  que le mouvement du mois. Sur l'exercice, l'ouverture est l'à-nouveau, et la variation dit ce que l'année a fait.

Restes de CABDECLARER-4, dits : l'index en PDF de l'export (qui peut manquer sans que le compte rendu le dise), le compte
d'écritures annoncé par la fenêtre (brouillards compris), et les deux FEC qui ne nomment pas le tiers de la même façon.
Essais : `tests/web/declaration-1350.test.ts`, `tests/web/revision-1348.test.ts`. Sept preuves.

## 1.378.2 — Le dépôt se note à sa date, et ne s'annule plus d'un clic (issue 9, CABDECLARER-11 et -37)

- **« Marquer déposée » ouvre une fenêtre** : la date réelle du dépôt (aujourd'hui proposé, jamais une date à venir ni
  d'avant le mois déclaré) et le numéro de l'accusé, facultatif. « Marquer payée » demande la date du paiement.
- **Annuler un dépôt se confirme**, et la question dit que le paiement noté part avec lui. « Garder » ne touche à rien.
- **Un mois déposé ne propose plus « recalculer »** : le bouton est éteint et dit pourquoi, au lieu de refuser après le clic.

Reste de CABDECLARER-11, dit : glisser le fichier de l'accusé dans la même fenêtre (il se dépose aujourd'hui dans le
classeur). Essai : `tests/web/cabinet-declaration.test.ts`. Cinq preuves.

## 1.378.3 — Les livres s'ouvrent d'une ligne, et leurs fichiers disent ce que l'écran montre (issue 9, CABDECLARER-6, -9, -10, -16, -31, -33)

- **Une ligne s'ouvre** (CABDECLARER-6). Dans le journal, le grand livre et la Recherche, un clic sur une ligne ouvre
  l'écriture ENTIÈRE : toutes ses lignes, le nom de chaque compte, le tiers, la lettre, le total des deux colonnes, son
  état et son justificatif. Dans la balance, un clic sur un compte ouvre son grand livre sur la même période. Le bouton
  « Actions » garde son menu. La fenêtre ne modifie rien.
- **Le grand livre** montre le journal, le tiers et la lettre de chaque ligne ; son filtre propose aussi un compte qui
  n'a que son ouverture (CABDECLARER-33). Au journal, le nom d'un compte se lit au survol de son numéro.
- **L'export du grand livre est le grand livre** (CABDECLARER-9) : le compte choisi (ou tous), rangé par compte,
  l'ouverture en tête, le solde après chaque ligne et son sens. C'était le journal entier, sans solde. Chaque export
  dit le nom de son fichier et où il est.
- **Le FEC porte les tiers** (CABDECLARER-10) : sur un collectif nu (411, 401), « CompAuxNum » se tire du nom du tiers
  (411CAFEJASMIN) et « CompAuxLib » porte ce nom ; un sous-compte reste son propre auxiliaire. « DateLet » porte la date
  du lettrage, que le serveur envoie maintenant avec la lettre. Le FEC du classeur et celui du journal nomment les
  comptes de la même façon (reste de CABDECLARER-4).
- **Un mois sans mouvement montre ses soldes** (CABDECLARER-16) : la balance et le grand livre affichent les comptes
  reportés au lieu de « Aucune écriture… Saisir une première pièce ».
- **Une recherche sans résultat au journal le dit** (CABDECLARER-31), avec « Tout montrer ».

Restes, dits : le menu « voir le grand livre » depuis un compte de la Révision ; un PDF pour la balance, le grand livre
et les états (CABDECLARER-9, seconde moitié) ; le lettrage à la main (CABDECLARER-7). À VÉRIFIER : la forme du code
auxiliaire tiré du nom (aucune règle tunisienne ne la fixe).
Essais : `tests/web/livres-1378-3.test.ts`, `tests/moteur/fec-tiers-1378.test.ts`, `tests/compta/saisie.test.ts`.

## 1.378.4 — L'exercice suivant se demande, la question d'un dossier tenu dit où elle est (issue 9, CABDECLARER-15, -22, -25, -39)

- **« Ouvrir 2027 (à-nouveaux)… » demande avant d'écrire** quand l'exercice n'est pas fini : la fenêtre dit que les
  à-nouveaux d'aujourd'hui seront à refaire à la clôture. « Pas maintenant » n'écrit rien.
- **Une question posée à un client sans SkanFact** ne « part » nulle part : le contrôle de la révision dit qu'elle reste
  dans la révision, à poser de vive voix ou par e-mail — la même phrase que la fenêtre. Il ne passe plus devant la suite
  de la révision. Pour un client relié, la phrase ne mélange plus « votre » et « ton ».
- **Une balance importée nomme les lignes qu'elle écarte** (numéro et raison) dans le rapport lu AVANT de reprendre.
- **« de » s'élide** : « loyer d'octobre », « livraisons d'avril », « le classeur d'Exemple » (écrans du Cabinet et dossier
  d'exemple). Pas devant un y.

Essais : `tests/web/ouvrir-question-1378-4.test.ts`, `tests/web/cabinet-reprise.test.ts`,
`tests/web/cabinet-exemple-1370.test.ts`. Quatre preuves.

## 1.378.5 — Avant la clôture, les déclarations se lisent comme un comptable (issue 9, CABDECLARER-24)

- **Le mois en cours ne se réclame plus** : « 1 mois sans déclaration préparée (novembre) » s'affichait le 16 novembre.
  Un mois se réclame une fois fini.
- **Un mois déposé dont l'écriture de déclaration manque au livre est nommé** (« octobre 2026… Écris-la dans l'onglet
  Déclaration ») ; le contrôle disait « rien à signaler ». Un mois déposé sans TVA à écrire n'est pas réclamé.

Essai : `tests/moteur/controles-cloture-1378.test.ts`. Trois preuves.

## 1.378.6 — L'export des écritures dit vrai, la fiche dit ses brouillards (issue 9, CABDECLARER-17, -19, -20, -28)

- **Export des écritures du cabinet** : le compte rendu compte des clients (« Clients : 11 » pour un client et onze
  mois) ; la balance d'ouverture d'un client sans mouvement part dans le fichier comme les à-nouveaux des autres ; le
  dossier d'exemple n'y entre plus dès qu'un vrai client a des écritures (seul, il sert à essayer, et la page le dit) ;
  la page porte le nom du menu, et la carte dit « Clients dans le fichier ».
- **La fiche dit ses brouillards** : « lu dans ses livres · 9 brouillards compris », sur le chiffre d'affaires et la
  banque — ses chiffres se retrouvent dans la balance en cochant la case.
- **Une année proposée sans livre** se lit « 2024 — à ouvrir » ; son écran dit quels livres le dossier a, ramène au
  dernier d'un bouton, et la barre ne parle plus du livre d'une autre année. (Dossiers tenus au cabinet.)
- **« À VÉRIFIER avec le comptable »** ne s'affiche plus au comptable : dans le Cabinet, la mention renvoie aux textes
  en vigueur ; dans l'application du client, rien ne change.

Essais : `tests/moteur/export-ecritures-1378.test.ts`, `tests/moteur/a-verifier-lecteur-1378.test.ts`,
`tests/web/cabinet-ecritures.test.ts`, `tests/web/cabinet-reprise.test.ts`, `tests/web/cabinet-exemple-1370.test.ts`.
Six preuves.

## 1.378.7 — Les pièces d'une case disent leurs montants (issue 9, CABDECLARER-21, -23)

- **« D'où ça vient »** : sous une case de la déclaration, chaque pièce porte ce qu'elle met dans la case — et, pour la
  TVA, sa base hors taxes. Le pied porte la case entière (pas la page), et seulement quand la somme des pièces retombe
  sur la case. Une pièce de la liste s'ouvre entière d'un clic, comme une ligne du journal.
- **« Les paquets reçus »** quitte le menu « ⋯ » de la fiche : c'était un écran d'avant ; les mois du client se lisent
  sur sa fiche.

Essais : `tests/moteur/pieces-de-case-1378.test.ts`, `tests/web/pagination-1352.test.ts`. Quatre preuves.

## 1.378.8 — Un seul vocabulaire pour l'état d'un mois, une ancienneté qui ne ment pas (issue 9, CABDECLARER-8, -18)

- **L'état d'un mois** sur la Déclaration prend les mots de la frise et du tableau de bord : à saisir, en cours, à
  déposer, prêt à déposer (une fois préparée — il restait « saisi »), déposé, déposé et payé. « Déclaré » disparaît ; la
  bulle dit les mêmes mots, et les mois d'un dossier tenu aussi (à réviser, prêt à déposer, déposé).
- **« Ce qui reste dû, par ancienneté »** sur un compte pas encore lettré : par tiers, les règlements et avoirs non
  lettrés s'imputent aux pièces les plus anciennes ; seul le reste se range par âge, et l'écran le dit. Une facture de
  février réglée en juin ne paraît plus « à plus de 90 jours ».

Essais : `tests/moteur/anciennete-1378.test.ts`, `tests/web/cabinet-declaration.test.ts`. Quatre preuves.

## 1.378.9 — Lettrer à la main, voir les lettres, en retirer une (issue 9, CABDECLARER-7)

- **Lettrer à la main** : sur l'écran de lettrage, chaque pièce ouverte d'un tiers se coche ; la barre dit « 2 pièces
  cochées : elles se soldent » et le bouton « Lettrer la sélection » s'allume — ou elle dit l'écart, et le bouton
  reste éteint (la somme doit faire zéro).
- **Les lettres posées** se voient (lettre, date, tiers, pièces, montant), page par page, et chacune se retire par
  « Délettrer » : ses pièces redeviennent ouvertes.

Le serveur savait déjà lettrer et délettrer ; il manquait l'écran. Essai : `tests/web/cabinet-saisie.test.ts`.
Trois preuves.

## 1.379.0 — Les issues 4, 6 et 14 : l'entrée, le Cabinet à plusieurs, la visite qui dit vrai

**Le Cabinet (issue 6).**
- **CAB-1 (bloquant)** : une déclaration ne se prépare plus en silence sur un mois au brouillard. L'avertissement
  (« 3 pièces d'août attendent encore au brouillard ») se lit au-dessus des étapes, aucune étape n'est en vert, et
  « Préparer » demande d'abord : *Voir le brouillard*, *Préparer quand même* (on ne bloque pas) ou *Annuler*. Sur la
  fiche du dossier, le brouillard passe avant « prêt » : un mois préparé dont les pièces attendent reste « à réviser ».
- **CAB-5** : la palette vide dit où se cherchent une pièce et une écriture (Consulter › Recherche).
- **CAB-6** : une quatrième décimale tapée ne disparaît plus en silence, l'arrondi au millime se dit.
- **CAB-7** : le brouillon gardé d'une pièce reçue qui a été saisie depuis ne se repropose plus (« Reprendre » menait
  à une saisie en double).
- **CAB-8** : une fenêtre où l'on écrit un texte (« Demander à … ») demande avant de jeter la saisie.
- **CAB-9** : le refus d'un rôle du cabinet ne nomme plus les personnes de l'entreprise cliente ; il renvoie à la
  personne qui tient le dossier ou à la direction du cabinet.
- **CAB-11** : `#/equipe` mène à l'équipe ; la phrase qui citait l'onglet « Suivi » (disparu) est corrigée.
- **CAB-13** : côté client, « Arrêter le mandat… » offre « Non, garder mon cabinet ».
- **CAB-22** : « Importer depuis un tableur » (le titre disait « Réimporter » dès le premier import).
- Déjà faits depuis la revue (1.371 → 1.378) : CAB-2, CAB-3, CAB-4, CAB-12.

**L'entrée (issue 4).**
- **ENTREE-3 (bloquant)** : « Besoin d'aide ? » ne quitte plus SkanFact vers une page morte : il montre l'adresse
  `contact@skanfact.tn`, qui se copie. Il est aussi sur l'écran du code. Le pied des e-mails et l'e-mail « adresse
  changée » donnent la même adresse.
- **ENTREE-2 (bloquant, première moitié)** : une session fermée (ailleurs, ou finie) dit pourquoi on est dehors, et
  la page où l'on était se rouvre après la reconnexion. Garder la saisie en cours reste à faire.
- **ENTREE-6** : un téléphone en lettres ou un capital négatif sont refusés sur leur case dans l'assistant.
- **ENTREE-7** : sans matricule, le bouton mis en avant est « Compléter ma fiche… » ; « Émettre quand même » reste
  possible, en second.
- ENTREE-4 était réparé depuis la 1.373.0.

**Les visites (issue 14).**
- **ENTSOCLE-1** : la visite « Émettre une facture » juge son but sur la pièce. En ligne, la facture est émise après
  la fermeture du récapitulatif, et l'envoi par e-mail ouvre une fenêtre de plus : la visite concluait « la facture
  n'est pas émise » d'une facture numérotée.

Trouvé en passant : deux essais de la 1.378.5 et de la 1.378.6 lisaient `pont-cabinet.js` en direct (ils passent par
`lireEcran`), et `pont.js` revient à sa limite de lignes.

Essais : `tests/web/entree.test.ts`, `assistant.test.ts`, `facture-details.test.ts`, `cabinet-livre-a-jour.test.ts`,
`cabinet.test.ts`, `tests/v10/visites-en-ligne.test.ts`, `tests/compta/declaration.test.ts`, `annuel.test.ts`.
Neuf preuves.

## 1.379.1 — Les issues 14 et 16 : deux bloquants de la gestion, et la carte de fin d'une visite

- **GEST-1 (bloquant)** : « Un bulletin », sur la fiche d'un salarié entré ce mois-ci, proposait le mois dernier — un
  bulletin plein pour un mois où il n'était pas là. Le mois proposé reste dans le contrat : son premier mois s'il vient
  d'entrer, son dernier s'il est sorti. Un salarié qui n'est pas encore entré n'a pas de bulletin, et le bouton le dit
  (« Ines Mrad entre le … : son premier bulletin sera celui de ce mois-là »). Le formulaire lui-même refuse un mois
  entièrement hors du contrat, d'où qu'on vienne.
- **GEST-2 (bloquant)** : en Trésorerie, un mouvement enregistré relit toute la page. Avant, seul l'onglet se
  redessinait : « Disponible aujourd'hui » et les compteurs gardaient les chiffres d'avant, jusqu'à ce qu'on quitte la
  page. Vaut pour « + Mouvement », la modification d'un mouvement, le virement depuis un compte et l'occurrence d'un
  mouvement qui se répète.
- **ENTSOCLE-8** : la carte « Visite terminée » ne suit plus de page en page ; changer de page la ferme (moteur de
  visite partagé, donc les deux applications).

Essais : `tests/web/paie-bulletin-1379.test.ts` (neuf), `tests/web/tresorerie-1298.test.ts`,
`tests/web/cabinet-visites-1372.test.ts`. Quatre preuves.

## 1.379.2 — L'issue 13 (achats, fournisseurs, stock) : les deux bloquants, et trois chiffres qui trompaient

- **ENTACHATS-1 (bloquant)** : sur « Comment arrive cette pièce ? », cliquer la zone n'ouvrait que le choix d'un XML ;
  la photo ou le PDF choisi là était refusé comme « pas une facture électronique », et perdu. Le clic prend maintenant
  les trois (XML, photo, PDF), comme le glisser : la photo se joint à la pièce et la saisie s'ouvre. La zone le dit
  (« Tu as la photo ou le PDF de la facture ? Clique ici pour le choisir, ou glisse-le »).
- **ENTACHATS-2 (bloquant)** : fiche fournisseur › Règlements. Ce que le fournisseur a RENDU (le règlement d'un avoir)
  s'ajoutait au total « versés ». Il se retranche, la ligne dit « − 142,800 DT · reçu », et le total dit ce qu'il a
  retiré. Une ligne en devise écrit dessous ce qu'elle pèse en dinars dans ce total.
- **ENTACHATS-3** : sur un avoir, « en stock : 25 → 29 » montait alors que la marchandise ressort : la flèche descend.
  Une pièce déjà rangée, rouverte sans y toucher, dit un fait (« entré en stock : + 20 ») au lieu d'une projection qui
  changeait avec le stock du jour.
- **ENTACHATS-8** : une sortie plus grosse que le stock (casse de 100 pour 30) se demande d'abord (« Tu n'en as que
  30… »), avec « Enregistrer quand même » : on ne bloque pas. Un ajustement demande sa note en une phrase.

Reste de l'issue 13 : voir la liste des constats 4 à 7 et 9 à 24 (inventaire par dépôt, un seul coût par article,
valorisation au prix de la facture — À VÉRIFIER avec le comptable —, commande soldée, lots, téléphone).

Essais : `tests/web/complements.test.ts`, `fiche-fournisseur.test.ts`, `stock-revue.test.ts`. Cinq preuves.


## 1.379.3 — Avant de donner le lien au comptable (17/11/2026)

Quatre décisions de Skander, le même jour.

- **« Trop d'essais » après un seul essai.** Les erreurs de mot de passe ne s'oubliaient jamais : cinq fautes étalées
  sur des semaines suffisaient, et la sixième — la première du jour — faisait attendre. Elles s'oublient maintenant
  après vingt-quatre heures (`0218`). Une connexion réussie les efface toujours.
- **Le code d'authentification est facultatif, et recommandé** (`0219`). Plus aucun code n'est exigé d'office : ni le
  code du téléphone sept jours après le premier dossier d'un cabinet, ni le code par e-mail à chaque nouvel appareil.
  L'adresse se prouve toujours une fois, à la création du compte. « Ton compte » propose le code par e-mail
  (`#cpt-courriel`), le SMS et l'application. Un cabinet pourra le demander à ses comptables (`organisation.code_exige`,
  éteint ; pas encore de bouton à l'écran). **Les clés d'accès (passkeys) ne sont pas faites** : c'est le lot suivant.
- **L'inscription séparée.** `/cabinet` et `/entreprise` ouvrent chacun leur écran ; la page de connexion propose
  « Je gère une entreprise » et « Je suis comptable ». Le comptable tombe droit sur la création de son cabinet.
- **« À venir ».** La caisse et la facture électronique (El Fatoora) ne sont pas branchées en production : leur ligne
  reste au menu, grisée, avec une pastille ; leur page dit qu'elles arrivent ; « Créer » ne les propose pas. Un réglage
  du serveur les rouvre sans nouvelle version (`SKANFACT_A_VENIR`, `serveur/a-venir.ts`) ; les tests tournent ouverts.

À VÉRIFIER avec Skander : vingt-quatre heures pour oublier les erreurs ; le code par e-mail éteint au départ.


## 1.379.4 — La console : « Règles fiscales » ne blanchit plus (issue 5, CONSOLE-1)

Le serveur connaît trois règles (timbre, seuil de la retenue, FODEC) ; la console n'avait le nom que du timbre, et un
texte manquant faisait tomber toute la console. Les noms sont là, un taux se dit « 1 % » (plus « 1 %,000 DT »), et une
règle sans nom se montre par son code. Le test confronte la liste du serveur aux textes de la console. Le contrôle
éclair des preuves, rouge sur GitHub après la 1.379.3 (seize preuves visaient l'ancienne règle du code), est remis
d'accord ; le test du code demandé par un cabinet couvre de nouveau l'exemple, les sept jours et le rôle.


## 1.379.5 — La console dit la même chose d'un écran à l'autre (issue 5)

- CONSOLE-4 : Clients dit « aucune pièce émise », Abonnements « 28 pièces créées » — deux comptes, deux noms.
- CONSOLE-6 : « Tes appareils » ne promet plus trente jours sans code : la console le demande à chaque connexion.
- CONSOLE-9 : le journal et le message de fin reprennent le mot du geste (« passage en lecture seule », « réactivation »).
- Le rouge de GitHub sur la 1.379.4 : un import devenu inutile dans le test de l'entrée du Cabinet (lint).

Reste de l'issue 5 : CONSOLE-2, 3, 5, 7, 8, 10 à 20 (notés dans le carnet de la session).

## 1.379.6 — l'avoir d'une facture à retenue (issue 15, V-1)

- **Le bloquant** : un avoir sur une facture à retenue était refusé (« 210.987 à l'écran, 214.200 au serveur »). La facture
  avait été émise sans que son seuil de retenue soit gardé sur la pièce : l'écran lui prêtait une retenue que le serveur
  n'avait pas scellée, et l'avoir suivait l'écran.
- Le serveur garde maintenant sur la pièce le seuil qu'il vient d'appliquer ; l'écran juge une facture d'avant avec le seuil
  du jour, comme le serveur.
- Le refus d'écart écrit ses montants comme l'écran : « 210,987 DT ».
- Une facture d'avant, sous le seuil et sans seuil gardé, affichait encore sa retenue à l'écran : corrigé en 1.387.88 (migration 0222).
- **V-2** : un avoir dont le client est choisi ne propose plus que les factures de ce client ; changer de facture reprend
  les lignes et l'objet de la nouvelle tant que rien n'a été retouché. À VÉRIFIER : pas encore rejoué à la souris avec deux clients.
- **V-9** : une facture qui imprime « paiement par virement » sans RIB le dit avant d'émettre, même pour un métier qui
  encaisse sur place ; « Compléter ma fiche… » propose alors le RIB.
- **V-8** : le menu d'un devis envoyé dit « Supprimer ce devis envoyé — le client l'a reçu », et son PDF n'est plus dit
  « brouillon ». La suppression reste possible (on ne bloque pas) : À VÉRIFIER si un geste « Annuler ce devis » est préférable.
- **V-6** : dans une vue restée active, le geste principal d'une recherche vide est « Chercher dans tous les clients »
  (ou fournisseurs) ; « Créer » passe au second plan, pour ne pas fabriquer un doublon.
- Ces trois-là n'ont pas encore leur test propre ni leur preuve (les tests existants des écrans passent).
- **V-7** : la facture tirée d'un devis (totale, acompte, solde, « Transformer ») prend le délai de paiement de la fiche du client.
- **Rouges GitHub de la 1.379.5 réparés** : deux phrases de test (« Ton rôle au cabinet… »), le test des clients qui dépendait
  du jour du mois, et le poids de la première ouverture (le dessin des codes QR se charge à la demande, docs/leger.md L13).

## 1.379.7 — Le relevé de compte dit la situation du jour choisi (issue 15, V-3, V-4, V-5)

- **V-4** : arrêté à une date passée, le relevé compte les règlements et les avoirs jusqu'à ce jour-là seulement. Il disait
  « soldé » d'un client qui devait de l'argent à la date choisie.
- **V-5** : changer la date n'est plus « une saisie à abandonner » ; après « Envoyer au client… », la fenêtre reste ouverte.
- **V-3 (en partie)** : un titre de section n'est plus pris pour « une ligne à 0 » ; « quantité manquante ».
  Reste : l'acompte déduit hors des sections, et la remise qui ne tombe pas juste à l'œil sur la facture de solde.
- Rouge GitHub de la 1.379.6 : la preuve qui visait la ligne du QR retirée de la page est reprise.
- À VÉRIFIER : pas encore de test propre pour le relevé à une date passée.

## 1.379.8 — Un refus dans une fenêtre reste écrit sous son champ (issue 15, V-12)

- Le refus d'une fenêtre (un paiement trop grand, une date d'acceptation avant le devis…) s'écrit sous le champ en faute et
  y reste jusqu'à la correction ; le message du bas de l'écran s'effaçait avant d'être lu.
- Reste de V-12 : prévenir du trop-perçu dès la frappe, et proposer « garder en avance du client ».

## 1.379.9 — Les relances : un report ne se pose pas dans le passé (issue 15, V-15)

- « Ne pas relancer avant le… » refuse une date passée ou d'aujourd'hui, en le disant (elle était acceptée, puis changée
  en silence). « Relancer par e-mail » s'écrit comme partout.
- Reste de V-15 : la colonne « Retard » qui porte le ton à venir, et la page encore dans l'ancienne présentation.

## 1.379.10 — Une adresse e-mail, un seul contrôle (issue 15, V-14)

- La fenêtre d'émission et la fenêtre d'envoi jugent l'adresse de la même façon : « pas-un-email » n'est plus proposé.
- L'adresse tapée à l'envoi, quand la fiche n'en a pas de valable, est gardée sur la fiche du client (et c'est dit).
- Reste de V-14 : la fiche accepte encore une adresse mal formée (elle le signale seulement).

## 1.379.11 — Le Cabinet : des mots justes, une recherche sans accents (issue 12, constats 9, 13, 28)

- « la déclaration d'octobre », « Relevé bancaire d'avril », « Salaire d'août », « 3 écritures d'octobre au brouillard » : plus de « de octobre ».
- La recherche du tableau de bord, du portefeuille, des pièces reçues et des relances trouve « Hôtel » en tapant « hotel ».
- « Retirer l'exemple » du bandeau pose la même question que celui des Réglages.
- Pas de test neuf pour ces trois points (tests des écrans touchés rejoués, verts) : à couvrir avec le reste de l'issue 12.

## 1.380.0 — La console agit sur l'abonnement d'UN cabinet (demandé par Skander le 17/11/2026)

Jusqu'ici la console ne faisait que LIRE l'abonnement d'un cabinet, et tout se réglait pour tous les cabinets à la
fois (Réglages, « L'abonnement des cabinets »). Un comptable commence l'alpha test : il faut pouvoir lui ouvrir plus de
dossiers sans changer la règle de tout le monde. Migration `0220_gestes_cabinet.sql`.

Sur la fiche d'un cabinet, une carte « Ce que ce cabinet a reçu » : ce qui est posé pour lui, les gestes, et
l'histoire des gestes (qui, quand, le motif). La direction seule agit ; le support lit.

| Geste | Ce qu'il fait |
|---|---|
| Dossiers gratuits… | un nombre à lui (0 à 9999), jusqu'à une date ou sans fin, à la place des 3 de tout le monde |
| Revenir aux gratuits de tous | il reprend la règle ; ce qui dépasse devient payant et se facture |
| Offrir l'abonnement… / Retirer l'offert | aucun dossier payant, sans limite ; jusqu'à une date ou jusqu'au retrait |
| Accorder un délai… | pas de lecture seule avant la date choisie ; la facture reste due |
| Reporter la prochaine facture… / Annuler le report | aucune nouvelle facture avant la date |
| Suspendre / Reprendre | TOUS ses dossiers tenus en lecture seule, création fermée ; tout se lit et s'exporte |
| Prix par dossier… / Plafond annuel… (et leur retour) | son prix et son plafond, à la place de ceux de tout le monde |

Règles tenues :

- Chaque geste demande un motif, et s'écrit au journal de la console (« abonnement.cabinet-… », colonne `cabinet`).
- Une facture déjà émise ne change jamais : un geste vaut pour la suite (la fenêtre le dit avant).
- Un cabinet dont des dossiers deviennent payants sans dossier créé (ses gratuits ont pris fin, l'offert est retiré)
  commence son abonnement ce jour-là : sans cela il n'aurait jamais été facturé.
- Une période notée « rien à facturer » se retente dès qu'un dossier payant existe.
- Le cabinet lit le résultat dans « Ton abonnement » : « Ton abonnement est offert », « SkanFact t'a donné 10 dossiers
  gratuits », « SkanFact a suspendu ton cabinet » (et non « règle ta facture »). Il ne lit jamais le motif.
- Les autres cabinets ne bougent pas (le test tient un cabinet témoin).

À VÉRIFIER avec Skander :

- l'offert l'emporte sur une facture impayée : un cabinet offert n'est jamais en lecture seule, même avec une vieille
  facture due (elle reste due, à régler ou à annuler par un avoir) ;
- « Reporter » retarde la facture, il ne l'offre pas : à la date, la facture de la période en cours part entière ;
- « Suspendre » ferme aussi les dossiers gratuits (c'est une sanction, pas un impayé) ;
- seul le rôle « direction » agit ; le support lit.

Tests : `tests/abonnement/abonnement-cabinet.test.ts` (les treize gestes par l'API, un cabinet témoin),
`tests/web/console.test.ts` (à la souris : dix dossiers gratuits, suspendre, reprendre, le support sans geste ; rendu
clair, sombre, téléphone). Six preuves « gestes cabinet a…f ».

## 1.381.0 — « À venir » partout, et la paie en « Bêta » (demandé par Skander le 17/11/2026)

Skander : « le module caisse faut mettre à venir et on le lock, pour la paie la pastille bêta, et à venir pour ce qu'on
n'a pas branché, afin que le comptable et l'entreprise qui vont essayer comprennent », puis « traite tout et pas que
l'élément : dans "Ajouter un module" la caisse est toujours cochée », et « soigne les écrans d'à venir ».

- **Un second réglage du serveur, `SKANFACT_BETA`** (`serveur/a-venir.ts`, jumeau de `SKANFACT_A_VENIR`) : absent, la
  paie est en bêta ; vide, rien ne l'est. Il part dans `/moi` (`compte.beta`) et les deux applications le lisent
  (`window.__beta`). Les tests tournent avec les deux réglages vides, sauf celui qui les prouve.
- **La caisse est verrouillée partout où elle se montrait** : le menu (grisée, pastille), « Au quotidien » d'un
  commerce (elle n'y est plus), « Créer », la recherche (« Caisse (à venir) »), **« Ajouter un module »** (plus de case,
  plus de « Ouvrir » : la ligne s'annonce) et **l'assistant de départ** (elle n'est plus proposée cochée).
- **L'écran d'une page à venir** dit trois choses dans trois cadres : où on en est, quoi faire en attendant (pour la
  caisse : la facture, avec son bouton), et qu'elle s'ouvrira d'elle-même. Clair, sombre, téléphone.
- **La facture électronique** : tant qu'elle est à venir, « Signer par DigiGo » ne se propose plus (fenêtre d'émission,
  menu « Plus », frise) ; la frise d'une facture émise n'a plus qu'une étape « El Fatoora · À venir » au lieu de deux
  étapes « à faire » qu'on ne peut pas faire.
- **La paie porte « Bêta »** : la ligne du menu, le titre de la page, la ligne du module, l'assistant, et le titre de la
  paie d'un dossier au Cabinet. La bulle dit ce que ça veut dire : ça marche, on vérifie encore — relis tes premiers
  chiffres avec ton comptable.

Ce qui n'a pas changé, et pourquoi : le fichier CNSS du trimestre se fabrique déjà et porte son « À VÉRIFIER » ; les
attestations TEJ n'ont aucun écran dans les applications (rien à annoncer) ; la console dit déjà, format par format,
« contre un service simulé » ou « pas encore ».

À VÉRIFIER avec Skander : en production les deux réglages sont absents, donc la caisse et la facture électronique sont
« à venir » et la paie « bêta » dès la publication. Ouvrir la caisse : `SKANFACT_A_VENIR=efacture`. Sortir la paie de
la bêta : `SKANFACT_BETA=` (vide).

Tests : `tests/web/a-venir-1379.test.ts` (le titre et le menu de la paie, les trois cadres de l'écran, la ligne du
module sans case ni bouton, et rien de tout cela quand tout est ouvert), `tests/socle/a-venir.test.ts` (`enBeta`).

## 1.381.1 — « Dupliquer la pièce » sur une grille vide le dit (issue 11, constat 8)

La touche ne faisait rien, sans un mot, quand la grille de saisie était vide : elle dit maintenant « Rien à dupliquer »
et quoi faire. Pas de test neuf (une phrase) ; les tests de la saisie rejoués.

## 1.381.2 — Huit preuves retirées : elles ne pouvaient plus tomber

Le contrôle complet des preuves (les quatorze groupes, lancé avant la publication) a nommé huit preuves « non prouvées » (une au premier passage, sept au second) :
le défaut remis, leur test restait vert. Aucune ne signale un défaut de l'application ; chacune protégeait une chose
devenue double ou disparue. Elles sont retirées de `tests/preuves.sh`, chacune avec sa raison à sa place :

- trois de l'entrée du comptable (le rappel du code, l'annonce « sept jours », « il reste à taper le code ») : le code
  est facultatif depuis la 1.379.3, ces écrans ne s'affichent plus sur ce parcours ;
- trois de mise en page (onglets du stock au téléphone, gestes d'un dossier à 44 px, filtres gris) : la charte des
  onglets de la 1.368.0 pose déjà la même règle ;
- le motif d'un geste sur un cabinet : contrôlé deux fois, par la route puis par la base.

**À reposer** : « le client soldé compté dans Ce qui reste dû » (Cabinet, lettrage) — la garde est toujours dans le code,
mais le test ne la met plus à l'épreuve ; il faut un tiers soldé sans lettrage dans `cabinet-balance-tiers.test.ts`.
Et « il reste à taper le code », à reposer sur un test de « Ton compte ».

## 1.381.3 — Une preuve de course retirée

« déclaration 1.350.0 l » (les choix de journal qui se suivent) dépend de l'ordre d'arrivée de deux
enregistrements : sans la file, le dernier choix n'est perdu que si la machine est assez lente. Elle
passait ici et tombait chez GitHub. Une preuve qui tombe au hasard cesse d'être lue : retirée, avec
sa raison écrite à sa place. Le code ne change pas.

## 1.382.0 — La saisie : un compte mal tapé se demande, une règle de banque se décide (issue 11, constats 5 et 16)

- **Un compte mal tapé n'entre plus au plan sans un mot.** « 471471 » pour « 471 » créait un compte neuf à
  l'enregistrement. La grille demande maintenant, une fois, en nommant le compte : « Créer le compte 471471 ? » —
  « Corriger » ramène le curseur sur la ligne, rien n'est écrit. La question ne se pose que pour un compte inconnu de
  tout plan, ou un numéro long (cinq chiffres et plus) qui n'a aucun « frère » dans le plan du dossier : 411001 se
  demande une fois, 411002 jamais, 6132 (plan de référence) jamais. Le comptable reste libre de créer ses comptes.
- **Une règle de banque est une décision.** En écrivant une ligne de relevé, la case « Proposer ce compte aux lignes
  qui contiennent… » arrivait cochée : une règle se créait d'office, parfois sur un mot mal choisi. Elle arrive
  décochée.
- Test : `tests/web/cabinet-banque-1375.test.ts` ; preuve « saisie 1.382.0 a ».

## 1.382.1 — La touche réglée agit, une date illisible se dit (issue 11, constats 7 et 10)

- **La touche choisie pour « Solder » solde.** Régler « F9 » dans les Réglages ne changeait que la légende : c'est
  toujours Tab qui agissait. La grille lit maintenant le réglage, et l'invite de la dernière case nomme la touche.
- **Une date illisible se dit.** « 32/13 » rougissait la case, et la phrase sous la grille disait « la date manque »
  d'une case pleine. Elle dit ce qui est tapé et les trois formes acceptées (4, 4/3, 04/03/2026).
- Test : `tests/web/cabinet-banque-1375.test.ts` ; preuve « saisie 1.382.1 a ».

## 1.382.2 — La fiche d'un salarié refuse sur sa case (issue 10, CABPAIE-10)

- **Chaque refus se montre.** Au Cabinet, le nom, l'embauche, la sortie et le brut manquants passaient par un bandeau
  qui disparaissait : le curseur va maintenant dans la case fautive.
- **Deux saisies impossibles se refusent**, au Cabinet et côté entreprise : « 99 » enfants à charge (0 à 20), et une
  carte d'identité de chiffres qui n'en compte pas huit. Un passeport ou une carte de séjour, avec ses lettres, passe.
  À VÉRIFIER : huit chiffres pour la CIN tunisienne.
- Test : `tests/web/paie-1344.test.ts` ; preuves « paie 1.382.2 a » et « b ».

## 1.383.0 — La console : un prix trop tôt se refuse dans l'aperçu, « Offrir » dit ce qui s'ouvre (issue 5)

- **CONSOLE-14.** « Préparer un nouveau prix » avec une date d'avant le préavis affichait quand même la hausse et
  « vaudra à partir du 01/01/2020 », bouton actif, sous une aide qui disait le contraire. Le refus se lit maintenant
  dans l'aperçu, la case de la date est marquée, le bouton est éteint, et les phrases ne promettent plus la date
  refusée (les quatre fenêtres : prix, contenu d'une offre, remises). La preuve vise la garde de l'aperçu.
- **CONSOLE-8.** « Offrir l'abonnement » dit ce que le client pourra faire : tout est ouvert, la paie et la comptabilité
  complète comprises, comme avec l'offre Complet (c'est ce que fait `serveur/abonnement/offre.ts`).
- **CONSOLE-11.** Une invitation partie à la mauvaise adresse s'annule depuis la carte « À régler », à côté de
  « Renvoyer » : le geste n'existait que dans le menu « … » du tableau, plus bas.
- Reste de l'issue 5 : CONSOLE-2, 3, 5, 7, 10, 12, 13, 15 à 20.

## 1.383.1 — La console : le message écrit à un client se relit (issue 5, CONSOLE-3)

« Écrire… » depuis la fiche d'un client ouvre une demande que SkanFact commence (canal « skanfact », base 0110).
La liste des canaux du serveur ne le connaissait pas : la ligne était jetée à la lecture, et le message envoyé ne se
retrouvait ni dans « Support et échanges » de la fiche ni dans le Support — seul le Journal en gardait l'objet. Le
canal est connu, il se dit « écrit par SkanFact », et le test relit la fiche et le Support après l'envoi.
Preuve « console 1.383.1 a ».

## 1.383.2 — La console : deux libellés d'atelier en moins (issue 5, CONSOLE-18)

La colonne « Vu » des listes (clients, cabinets, groupe) dit « Dernière connexion » ; l'accueil ne dit plus « calculée
par la même fonction ». CONSOLE-2 n'est pas reproduit : avec une vraie veille, « Voir l'alerte » mène bien à l'alerte
(le test `console.test.ts` le joue) — la veille d'essai de la revue n'écrivait qu'une liste de problèmes.
Reste de l'issue 5 : CONSOLE-5, 7, 10, 12, 13, 15, 16, 17, 19, 20.

## 1.383.3 — La console : l'entrée « Clients » du menu remet la liste entière (issue 5, CONSOLE-17)

Partie de « #/clients », une recherche tapée restait dans la case après un clic sur « Clients » : l'adresse suit la
frappe sans prévenir le routeur, qui ne voyait donc aucun changement. L'écran écoute maintenant le retour à
« #/clients » et remet recherche, filtres et tri à leur départ. Test `console-clients.test.ts`, preuve
« console 1.383.3 a » (elle n'a tenu qu'une fois le test parti de l'adresse nue : c'est le cas de la revue).

## 1.383.4 — La console : « Précédent » ne jette plus la saisie d'une fenêtre (issue 5, CONSOLE-7)

Le bouton « Précédent » du navigateur changeait de page sous une fenêtre où l'on avait tapé : la saisie partait sans un
mot, alors que la croix, « Annuler » et Échap posent tous la question. Le routeur demande maintenant d'abord aux fenêtres
ouvertes (`retenuParUneFenetre`, `ui.tsx`) : s'il y a une saisie, l'adresse est remise et la même question se pose ;
sans saisie, la page change comme avant ; pendant un envoi, rien ne bouge. (Écouter l'événement « en capture » ne suffisait
pas : le routeur passait quand même le premier, et la fenêtre était déjà démontée.) Au passage, l'écouteur de la liste des
clients (1.383.3) lit l'adresse d'ARRIVÉE : retenu par une fenêtre, un départ de « Clients » ne remet plus les filtres.
Test : `console-versions` (la fenêtre de gel). Preuve « console 1.383.4 a ».

## 1.383.5 — La console au téléphone : le menu « Gestes » d'une fiche tient dans l'écran (issue 5, CONSOLE-5)

Sur la fiche d'un client, au téléphone, le bouton « Gestes » est à gauche ; son menu, aligné sur le bord droit du bouton,
sortait de 45 points par la gauche (mesuré : de −45 à 215 sur 390). Il se décale de ce qui dépasse avant de se montrer
(`MenuGestes`, `Fiche.tsx`). Le menu commun des lignes (`MenuLigne`) reçoit la même borne à gauche, et se mesure collé au
bord droit le temps d'être posé. Test : `console-recette` (au téléphone, le menu entier entre 8 et 382). Preuve
« console 1.383.5 a ».

## 1.383.6 — La console : l'écran « pas dans ton rôle » devient une carte (issue 5, CONSOLE-15)

Hors de son rôle, on lisait un titre, une phrase et un lien souligné sur une page vide ; une adresse inconnue donnait un
simple bandeau. Les deux sont maintenant la même carte (`Ferme`, `Console.tsx`) : une icône, le titre, ce qui se passe,
**qui ouvre l'écran** (lu dans la table des rôles, jamais recopié) et à qui demander, puis le bouton principal du retour.
Vue en capture (clair, ordinateur). Test : `console` (la technique devant Clients). Preuve « console 1.383.6 a ».

## 1.383.7 — La console : les messages aux clients suivent leur état (issue 5, CONSOLE-19)

Un message programmé pour plus tard paraissait sous « Le message affiché en ce moment » et « Ce que voient les clients » :
le titre devient « Le message à venir » et le libellé « Ce que verront les clients » tant que son premier jour n'est pas
arrivé. La colonne des messages passés s'appelait « Ce que les clients ont lu », y compris pour un message retiré avant
d'avoir paru : elle s'appelle « Le message ». Le Support renvoyait à l'onglet « Ses demandes » de la fiche, qui s'appelle
« Support et échanges » (CONSOLE-20). Laissé tel quel : le refus de date qui reste après la correction — c'est la règle
des fenêtres (un refus reste en retrait jusqu'au clic suivant, pour ne pas faire bouger le bouton sous le curseur).
Test : `console-reglages`. Preuve « console 1.383.7 a ».

## 1.383.8 — La console : le menu de la liste et celui de la fiche se répondent (issue 5, CONSOLE-10)

Le menu « … » d'une ligne et le menu « Gestes » de la fiche ne proposaient pas les mêmes choses, sans le dire : « Noter un
paiement », « Offrir », « Ouvrir un module » manquaient dans la liste ; « Noter un appel » manquait sur la fiche. Le
choix d'origine reste (ces trois gestes se font sur la fiche, où se lit ce qu'ils changent), mais il se **dit** : le
menu de la liste porte « Sur sa fiche… », dont la phrase nomme les gestes que la fiche ajoute pour CE client et CE rôle
(`gestesSurLaFiche`, par la même règle que la fiche — jamais une liste recopiée), et qui y mène. Le menu de la fiche
gagne « Noter un appel… », avant ce qui détruit ; au support qui a déjà prolongé, il reste ce choix et la phrase qui dit
pourquoi. Tests : `console-clients` (le contenu du menu, le parcours au clavier), `console` (la fiche du support).
Preuves « console 1.383.8 a » et « b ».

## 1.383.9 — La console : « À décider » ne propose plus de facture qu'on ne peut pas préparer (issue 5, CONSOLE-13)

Tant que l'entreprise SkanFact n'est pas désignée, aucune facture ne se prépare — et l'accueil alignait pourtant
« son renouvellement est à facturer », une ligne par client, qui menait à une fiche, puis aux Réglages. Sans elle, les
lignes bloquées (renouvellement à facturer, offre choisie dans l'application, facture de cabinet refusée) cèdent la place à
**une** ligne : « Désigner l'entreprise SkanFact, pour pouvoir facturer », qui dit combien de factures attendent et ouvre
l'onglet des Réglages où cela se fait. La fiche d'un client garde sa propre phrase (son onglet Factures le dit déjà).
Test : `decider` (deux lignes deviennent une, qui en compte deux ; rien à facturer, rien d'affiché). Preuve
« console 1.383.9 a ». **À VÉRIFIER par Skander** : désigner l'entreprise SkanFact dans la console de production avant de
vendre le premier abonnement.

## 1.384.0 — La console au téléphone : on cherche un client dès le premier écran (issue 5, CONSOLE-12)

Mesuré à 390 × 844 avant : les huit cartes prenaient 615 points, la recherche était à 1 108, le premier client à 1 491
(presque deux écrans), et chaque client en occupait 394. Après : les huit cartes tiennent en **une rangée qui défile du
doigt** (91 points ; leur phrase d'explication reste à l'ordinateur), la **recherche et ses trois filtres passent avant
les six états**, qui tiennent eux aussi sur une rangée, et la carte d'un client range ses cases **deux par deux**, le nom
de la case au-dessus de sa valeur. La recherche est à 425 points, le premier client à 814 — dans le premier écran.
Rien ne change à l'ordinateur ni à la tablette (règle bornée à 600 points de large, et aux écrans qui portent les huit
cartes). Vu en capture. Test : `console-recette` (les cartes sous 130 points, la recherche avant les états et dans le
premier écran, deux cases sur la même ligne, aucun débordement de côté). Preuve « console 1.384.0 a ».

## 1.384.1 — La console : trois petits défauts d'aspect (issue 5, CONSOLE-20)

- **Au téléphone, une barre d'onglets tient sur une rangée** qui défile du doigt (les huit du Service prenaient quatre
  lignes) ; l'onglet ouvert s'y amène, pour qu'on voie où l'on est en arrivant sur le dernier.
- **« Équipe » ouvre « Ton compte »** pour le support et la technique : l'entrée du menu porte ce nom pour eux.
- **« Inviter quelqu'un… »** s'écrit pareil en haut de l'écran et dans la carte (il ouvre une fenêtre : trois points).

Déjà réglés par les versions d'avant, relus : les messages « C'est fait : suspension. » (1.38x, un mot par geste), le
menu « … » qui s'ouvrait loin de sa ligne (il se pose sur la fenêtre, sous son bouton). Tests : `console-recette` (les
onglets au téléphone), `console` (le menu du support et de la technique). Preuves « console 1.384.1 a » et « b ».

## 1.384.2 — La banque : le double clic sur « Importer » (issue 11, CABSAISIE-22)

- **Deux envois du même relevé au même instant** : le second passait le contrôle « déjà importé » avant que le premier
  soit écrit, et tombait en panne (500). Il est refusé par une phrase — « ce fichier vient d'être importé : le second
  envoi n'a rien ajouté » — et un seul relevé est rangé.

## 1.384.3 — La banque : un relevé aux dates impossibles (issue 11, CABSAISIE-18)

- **« 32/13/2026 » n'est pas une date** : la ligne est écartée (« date illisible »), elle ne donne plus un mouvement
  « du 32/13 » sous une coche verte. Le 30 février non plus.
- **Aucune ligne lisible : « Ce fichier n'est pas un relevé »** — la fenêtre le dit, au lieu d'un aperçu vide.

## 1.384.4 — La saisie d'un exercice clos (issue 11, CABSAISIE-27)

- **« + Une écriture » sur un exercice clos** n'est plus un bouton sans effet : il mène à la raison (« L'exercice est
  clos : on n'y saisit plus »), et le curseur va au bouton qui suit.
- **« Rouvre-le » a son bouton** : « Voir l'exercice 2025 » ouvre l'onglet Exercice, où la réouverture demande son motif.

## 1.384.5 — La banque : des mots pour le comptable (issue 11, CABSAISIE-24 et 25)

- **« de la Attijari »** : un sigle prend l'article (« de la BIAT », « de l'UIB »), un nom non (« d'Attijari bank »).
- **Des notes de travail sorties de l'écran** : « Le relevé en PDF : pas encore. » (sans la parenthèse), la TVA d'une
  règle dit « à vérifier » avec sa raison au survol, et le refus d'un compte de TVA ne renvoie plus au « plan » en
  majuscules.

## 1.384.6 — L'import d'un relevé : le solde de début et l'écart (issue 11, CABSAISIE-22)

- **Changer de compte bancaire** recalcule le « Solde au début » proposé : il restait celui de l'ancien compte. Ce qu'on
  a tapé soi-même n'est pas touché.
- **Une fin tapée qui ne tombe pas juste** dit l'écart en chiffres : « début + mouvements donne 10 705,625 DT :
  5,625 DT d'écart avec cette fin ».

## 1.384.7 — La banque : « 14 à la main, 1 depuis SkanFact » (issue 11, CABSAISIE-17)

- **Le compte des rapprochées retombe sur son total** : l'écriture née dans SkanFact est l'une des quatorze, pas une de
  plus. Elle se dit « dont 1 sur une écriture venue de SkanFact ».
- Le test de l'écart d'une fin fausse (1.384.6) remplit la case sans la souris : le formulaire est caché à cet instant.

## 1.384.8 — Le Cabinet : l'exemple d'une case vide penche (issue 11, CABSAISIE-28)

- **« 607 », « 411 » dans une case vide** se prenaient pour des valeurs déjà saisies (chez le comptable, les cases
  portent des chiffres). L'exemple est en italique, la valeur tapée reste droite — dans tout le Cabinet.

## 1.384.9 — Les écritures qui reviennent : la date et « Supprimer » (issue 11, CABSAISIE-12)

- **« Depuis » s'écrit « 05/01/2026 »**, comme partout : la liste montrait « 2026-01-05 ».
- **« Supprimer cette écriture qui revient » est au menu de la ligne**, en dernier, avec sa question. Il n'était que
  dans la fenêtre « Modifier ». Ce qu'elle a déjà créé reste au livre.

## 1.385.0 — Les écritures qui reviennent : le double clic sur « Générer ce qui manque » (issue 11, CABSAISIE-12)

- **Une seule génération à la fois** : un double clic lançait la seconde par-dessus la première, et sa fenêtre disait
  « 0 écriture créée » alors qu'une venait de l'être. Le bouton s'éteint le temps du travail.
- **Quand il n'y a rien à générer**, la fenêtre le dit (« Rien de plus à générer… ») au lieu de « 0 écriture créée ».

## 1.385.1 — La grille de saisie : des cases qui se voient (issue 11, CABSAISIE-23)

- **Une case de la grille est blanche avec un bord**, en clair comme en sombre : grise et sans bord, elle se lisait
  « éteinte » en clair et se fondait dans la page en sombre. Le bord se renforce au survol de la ligne.

## 1.385.2 — La grille de saisie au téléphone (issue 11, CABSAISIE-23)

- **La case du compte a son étiquette** (« Compte »), comme Libellé, Débit et Crédit.
- **La carte d'une ligne se range** : le libellé sur toute la largeur, Débit et Crédit côte à côte, la croix en haut à
  droite, à la taille du doigt.
- **La légende des touches du clavier se cache** au doigt : elle n'aide personne sans clavier.

## 1.385.3 — Le total lu sur une pièce s'écrit comme un montant (issue 11, CABSAISIE-24)

- **« 1190,500 DT » devient « 1 190,500 DT »** partout où le Cabinet redit le total lu sur une pièce (la fenêtre de
  lecture, le message « Lue : … », le classeur, l'historique d'une pièce, la saisie face à la pièce) : une seule
  fonction (`totalLu`) au lieu de six écritures à la main.

## 1.385.4 — La comptabilité d'un dossier : les onglets ne sautent plus (issue 11, CABSAISIE-26)

- **La bande « Période » se range sous les onglets.** Posée au-dessus, elle les faisait descendre de soixante pixels en
  passant de « Saisir » (où elle se cache) à « Consulter » : le clic suivant tombait à côté.

## 1.385.5 — L'import d'un relevé : le titre nomme le mois du fichier (issue 11, CABSAISIE-22)

- **« Importer le relevé de décembre »** restait au-dessus d'un fichier de novembre : une fois le fichier lu, le titre
  nomme son mois (et le compte choisi).

## 1.385.6 — La fiche du dossier : un solde par compte de banque (issue 11, CABSAISIE-19 et 17)

- **Deux comptes de banque, deux soldes.** La tuile « Banque » fondait les comptes en un seul chiffre, sous le nom de
  la dernière banque importée : ce total ne se retrouvait sur aucun relevé. Elle dit « Banque · 2 comptes », le total,
  et le solde de chaque compte dessous (son numéro, son nom quand il le distingue).
- **« Le Tableau de bord le dit »** citait une phrase que le Tableau de bord n'écrit pas : la bande d'un mois rapproché
  reprend ses mots, « Banque rapprochée au … ».
- **Les rapprochées « à la main »** comptaient aussi les propositions acceptées en lot : le résumé dit « acceptées ou
  pointées par le cabinet ».

## 1.385.7 — Les écritures qui reviennent et la période validée (issue 11, CABSAISIE-12)

- **Le départ proposé est le premier jour ouvert** : le lendemain de la période validée, sinon le 1er janvier de
  l'exercice ouvert à l'écran (c'était toujours le 1er janvier de l'année en cours).
- **Générer écrit ce qui peut l'être.** Une occurrence tombée dans la période validée faisait refuser toute la
  génération : elle se passe, le compte rendu nomme ses mois, et les autres s'écrivent au brouillard.

## 1.385.8 — La banque d'un mois validé : écrire depuis une ligne (issue 11, CABSAISIE-11)

- **La fenêtre le dit avant le geste.** « Écrire autre chose… » sur une ligne d'un mois validé datait l'écriture du
  jour du relevé, et le refus tombait en bas de l'écran, hors de la fenêtre. Elle annonce la période validée, propose
  le premier jour ouvert, et rappelle que la ligne du relevé se rapproche quand même.
- **Le refus se lit dans la fenêtre** (une date remise dans la période validée, ou un refus du serveur), plus en bas
  de l'écran.

## 1.385.9 — La console au téléphone : la page ne s'élargit plus (rouge de la 1.385.0)

- **Un texte caché dans un onglet élargissait toute la page.** Depuis que les onglets tiennent sur une rangée qui
  défile (1.384.1), le petit texte réservé aux lecteurs d'écran (« 2 alertes ») sortait de la rangée : 575 points pour
  un écran de 390. Chaque onglet le retient désormais chez lui. Le défaut ne se voyait que lorsqu'un onglet portait un
  compteur — d'où des tests verts seuls et rouges à la suite.
- Le test du tiroir de caisse attend plus longtemps l'écriture de l'écart au Cabinet (elle arrive après le geste).

## 1.386.0 — Des Réglages, on revient au dossier (issue 11, CABSAISIE-20)

- **« Écrire un premier guide… »** quittait la saisie du dossier pour les Réglages, sans chemin de retour. Les Réglages
  affichent « ← Revenir à la saisie de … » au-dessus des onglets ; le retour s'oublie dès qu'on va ailleurs.

## 1.386.1 — La banque d'un client hors SkanFact : « demander » a son geste (issue 11, CABSAISIE-21)

- **Une ligne sans rien en face** invitait à « demander au client », sans bouton : un dossier tenu hors SkanFact n'a
  pas de conversation. La phrase propose le compte d'attente (471) le temps de demander, et le bouton « Mettre en
  attente (471) » est là.

## 1.386.2 — La saisie : un guide attend son montant (issue 11, CABSAISIE-13)

- **Choisi avant le montant, le guide s'appliquait pour zéro**, et le montant tapé ensuite partait dans le libellé. Le
  guide attend : le curseur va dans la case du montant (« Montant, puis Entrée »), Entrée l'applique. Le montant
  tapé d'abord, puis le guide, marche comme avant.

## 1.386.3 — Reprendre une écriture de banque ne défait plus son rapprochement (issue 11, CABSAISIE-15)

- **La promesse de la fenêtre est tenue.** « Reprendre dans la grille pour ventiler HT et TVA : la ligne 532 reste
  rapprochée » — or modifier l'écriture refaisait ses lignes, et le rapprochement partait avec l'ancienne : lever un
  compte d'attente (471 → 411) ou ventiler une TVA rendait la ligne du relevé « à traiter ». Le rapprochement retrouve
  désormais sa ligne quand la ligne de banque n'a pas changé (même compte, même montant). Si elle change, il tombe,
  comme avant. Migration `0221_reprise_garde_le_rapprochement.sql`.

## 1.386.4 — Le journal : une écriture et son miroir restent deux pièces (issue 11, CABSAISIE-4)

- **Contre-passée le jour même**, une écriture et son miroir portent le même journal, la même référence et la même
  date : le livre-journal les fondait en une seule pièce, sous un seul numéro, débit et crédit doublés. Les lignes du
  livre se groupent maintenant par écriture ; celles d'un paquet (sans identifiant) se groupent comme avant.

## 1.386.5 — La saisie retrouvée se propose tout de suite (issue 11, CABSAISIE-6)

- **Après un rechargement, « Écriture commencée…, pas encore enregistrée » arrivait après la grille** — jusqu'à cinq
  secondes plus tard, pendant qu'on tapait déjà. Le poste relit son brouillon dès que le dossier s'ouvre, une seule
  fois : le bandeau (« Reprendre » / « Le jeter ») est là avec la grille, et revenir à la saisie ne relit plus rien.

## 1.386.6 — Les mêmes mots pour les mêmes gestes (issue 11, CABSAISIE-24) ; le pont du Cabinet revient sous son plafond

- **Un écart se dit une fois.** Sous la grille, « Écart … Il manque … » était suivi de « Débit … ≠ crédit … » : la
  seconde phrase ne s'affiche plus (elle reste sur le bouton éteint).
- **Les messages se ressemblent** : « Écriture validée sous le n° … », « Écriture contre-passée sous le n° … »,
  « Écriture enregistrée au brouillard : elle sera numérotée à la validation » (« pas encore de numéro » se lisait
  comme le numéro de pièce qu'on venait de taper).
- **Rouge GitHub de la 1.385.9** : `pont-cabinet.js` dépassait son plafond de trois lignes (frontières, F12) depuis la
  1.385.7. Les mêmes instructions tiennent en trois lignes de moins ; le plafond n'a pas bougé.

## 1.386.7 — Les lignes du relevé ne se coupent plus dans leurs guillemets (issue 11, CABSAISIE-29)

- **« … même jour · « » en fin de ligne, « menzah » » à la suivante** : le pourquoi d'une ligne (à gauche comme en face)
  garde ses guillemets et sa ponctuation collés au mot, comme le reste des phrases du Cabinet.
- Laissé : le message du bas de l'écran recouvre le pied du relevé quelques secondes — c'est le même message partout
  dans les deux applications ; le déplacer pour un seul écran romprait l'habitude.

## 1.386.8 — Le brouillard : un seul mot, « écritures » (issue 11, CABSAISIE-24)

- **« 12 écritures » au brouillard, « Valider les 11 pièces de novembre » sur son bouton** : deux mots pour la même
  chose. Les boutons de lot disent « Valider les 11 écritures de novembre », « Valider la seule écriture de BQ »,
  comme le titre du brouillard et la fenêtre qui confirme.

## 1.386.9 — Le « ⋯ » de la Saisie ouvre ses outils (issue 11, CABSAISIE-20)

- **À côté de « + Une écriture », le menu n'ouvrait que les gestes du dossier** (modifier la fiche, appeler…). Sur la
  Saisie, il ouvre d'abord « Écritures qui reviennent », « Les guides d'écritures » et « Les touches de la grille » ;
  les deux derniers mènent aux Réglages, d'où « ← Revenir à la saisie de … » ramène au dossier.

## 1.387.0 — La paie : « d'Anis », « de Hamza », « de Youssef » (issue 10, finitions)

- **Les noms prennent la bonne liaison.** Au Cabinet, dix-sept phrases de la paie écrivaient « de » devant un prénom
  en voyelle (« le bulletin de Amel », « la fiche de Amira ») : elles élident. Un prénom en H ou en Y ne s'élide pas
  (« de Hamza », « de Youssef »), le nom d'un dossier en Y non plus.
- **Côté entreprise**, « Accepter la correction d'Anis » (c'était « de Anis »).

## 1.387.1 — Immobilisations : ce qui va s'écrire se montre d'abord (issue 10, CABPAIE-14 et 17)

- **« Passer son entrée au 01/07 » se proposait, puis se refusait** quand la période était validée au-delà. Le bouton
  propose le premier jour ouvert, et le dit ; une fenêtre montre l'écriture (le bien, ses amortissements antérieurs, sa
  contrepartie) avant de l'écrire.
- **« Passer les écritures d'inventaire (3) » écrivait tout d'un clic**, sous un nom qui se confondait avec l'onglet
  Inventaire. Il s'appelle « Passer les dotations et les sorties de 2026 » et montre la liste des écritures, lignes
  comprises, avant de les passer au brouillard.

## 1.387.2 — Immobilisations : le pied tombe juste, bien sorti compris (issue 10, CABPAIE-16)

- **« Cumul au 01/01 + dotation » ne retombait pas sur « cumul »** dès qu'un bien était sorti dans l'année : sa dotation
  restait dans le total, sa valeur et son cumul étaient « hors total ». Le pied tient maintenant en trois lignes : tous
  les biens, sorties comprises ; « dont N sorti en AAAA », en moins ; « À l'actif au 31/12 », ce qui reste au bilan.
  Chaque ligne s'additionne de gauche à droite (valeur − cumul = valeur nette).
- Les mentions « hors total » des lignes disparaissent : elles n'ont plus rien à expliquer.
- Sans bien sorti, le pied reste sur une ligne, comme avant. Le moteur ne change pas : c'est l'écran qui additionne.

## 1.387.3 — « Tout le dossier » : chaque page, sous le nom de son onglet (issue 10, CABPAIE-20)

- **Le volet portait sept entrées sous d'autres noms que les onglets** (« Banque et lettrage », « Paie du dossier »,
  « Bilan et clôture ») et oubliait la Saisie, les Immobilisations et l'Inventaire. Il se déduit maintenant des deux
  tables de la comptabilité : la fiche, le classeur, les pièces, les messages, puis les quatorze écrans rangés dans
  leurs trois groupes (Saisir, Consulter, Déclarer et clôturer), sur deux colonnes — tout tient sans défiler.
- Un collaborateur « Saisie » n'y voit pas le groupe « Déclarer et clôturer », comme dans la barre.
- La pastille « nouveau » du classeur part : il a plusieurs mois.

## 1.387.4 — Immobilisations au téléphone : la carte d'un bien garde son nom (issue 10, CABPAIE-21)

- **La carte d'un bien n'affichait que « repris de 2024 »** : la case du nom gardait sa largeur de tableau, et ses
  marques prenaient la place. En carte, le nom passe à la ligne, entier, ses marques dessous — dans les deux tableaux
  (les biens du client, les biens de l'exercice).
- **Le pied nomme ses chiffres** (Valeur, Cumul au 01/01, Dotation, Cumul, VNC), comme les cartes du dessus ; les cases
  vides ne prennent plus de place.

## 1.387.5 — « Commencer le livre » : les bornes en JJ/MM/AAAA (issue 10, CABPAIE-34)

- **La fenêtre montrait « 2026-01-01 »**, le format du navigateur, quand toutes les dates du Cabinet se lisent et se
  tapent en JJ/MM/AAAA. Les deux bornes sont des cases ordinaires : « 01/06/2025 », « 1/6 » ou « 010625 » se lisent
  pareil, et elles suivent toujours l'exercice tapé.
- Reste de ce constat, non rejoué : « repris de 2025 » sur un dossier né en 2026 (À VÉRIFIER sur le cas d'origine).

## 1.387.6 — Révision : signer aussitôt la période changée (rouge de GitHub sur la 1.386.6)

- **Le rouge n'était pas un test fragile, c'était une course à l'écran.** Changer de période puis cliquer « Signer »
  avant que la nouvelle période soit lue signait le compte sur l'ANCIENNE (celle encore affichée) : dans l'exercice, il
  restait « à revoir » après le message « Compte 532 signé. ». La signature porte maintenant sur la période choisie.
- **Une lecture en retard ne repeint plus l'écran** : seule la dernière demande de révision s'affiche.
- Le test rejoue la course exprès (les lectures ralenties de 900 ms), au lieu d'attendre qu'elle arrive par hasard.

## 1.387.7 — Paie du Cabinet : deux mots (issue 10, CABPAIE-27 et 28)

- **« Brut du mois (DT) » était le salaire de base** : les primes s'ajoutent en dessous, et le vrai brut se lit dans
  l'aperçu. La case s'appelle « Salaire de base du mois (DT) », et sa bulle le dit.
- **« Total équilibrée »** au pied de l'écriture de paie se lit « Total · écriture équilibrée ».
- Laissé tel quel, et dit : le signe moins s'écrit « − 159,000 » dans les phrases de la paie et « −159,000 » dans les
  colonnes de montants. Les unifier touche tous les montants des deux applications ; ce n'est pas une finition.

## 1.387.8 — Fiche d'un salarié : le CIN qui manque se compte (issue 10, CABPAIE-30)

- **La fiche se disait « complète » — ou « 2 choses à compléter » — au-dessus de « CIN à renseigner » en orange.** La
  pastille compte maintenant ce que la fiche montre à compléter : le n° CNSS, le CIN, le RIB.

## 1.387.9 — Inventaire du Cabinet : les refus dans l'ordre, et l'écriture qu'on nomme s'ouvre (issue 10, CABPAIE-35)

- **Les refus de lignes sortaient « 2, 4, 3 »** : ceux de la lecture (une quantité illisible) passaient tous avant ceux
  du contrôle (une désignation qui manque). Ils se lisent dans l'ordre des lignes ; ce qui ne tient à aucune ligne (la
  date) se dit d'abord.
- **« … (la variation de stock) : elle est encore au brouillard : supprime-la… »** portait deux deux-points et aucun
  lien. La phrase n'en porte qu'un, et le refus offre « Voir l'écriture ».
- Reste de ce constat : au téléphone, la carte d'une ligne d'inventaire est titrée par sa référence.

## 1.387.10 — « La paie de tous mes dossiers » : on sait où l'on est, et on en revient (issue 10, CABPAIE-32)

- La vue du cabinet entier s'ouvrait sous le titre d'un dossier, sans retour. Une ligne le dit (« Tu regardes tout le
  cabinet, pas seulement ce dossier ») et un bouton ramène à l'année du dossier d'où l'on vient.

## 1.387.11 — Paie du Cabinet : Échap ferme le panneau de droite (issue 10, CABPAIE-33)

- Un bulletin ouvert, la fiche d'un salarié ou un départ se ferment avec Échap, comme avec leur croix — sauf pendant une
  frappe dans une case, ou quand une fenêtre ou un menu est ouvert par-dessus (Échap leur appartient).
- Le test de la 1.387.7 visait la mauvaise fenêtre (la fiche du salarié au lieu du bulletin) : il est remis au bon
  endroit, et sa preuve rejouée.
- Reste de ce constat : les flèches à l'arrivée sur la page, et la ligne d'une avance qui s'ouvre sans le montrer.

## 1.387.12 — Le détail d'un bulletin proratisé dit ses jours (issue 10, CABPAIE-29)

- **« Brut de base 511,538 » ne disait pas d'où il venait.** La première ligne du détail du calcul s'appelle « Salaire
  de base », comme dans le bulletin ouvert à droite, et dit son prorata : « entrée le 14/10/2026 · 15 j sur 26 ».
- Reste de ce constat : au pointage, avec les colonnes d'heures supplémentaires, les derniers jours du mois sortent de
  la carte sans barre de défilement visible.

## 1.387.13 — Le pointage défile sans perdre le nom (issue 10, CABPAIE-29)

- **Les derniers jours du mois sortaient de la carte sans rien pour le dire.** La grille du pointage du Cabinet a sa
  barre de défilement toujours dessinée, et la colonne du nom reste collée à gauche : on sait toujours de qui on
  pointe le 31.
- Un navigateur de test ne réserve pas de place à la barre : le test vérifie que sa règle s'applique, pas ses pixels.

## 1.387.14 — Le fichier CNSS : un salarié par ligne, et le code d'exploitation dit avant (issue 10, CABPAIE-30)

- **Le même salarié paraissait deux fois dans les corrections** (un n° CNSS et un CIN faux : deux lignes, deux boutons
  vers la même fiche). Le moteur range désormais les refus par salarié (`refusParSalarie`), et les deux applications
  lisent ce champ : une ligne, ses motifs à la suite, un bouton.
- **Le code d'exploitation n'était jamais montré** alors qu'il part dans le nom et chaque ligne du fichier. Au Cabinet,
  la ligne « Code d'exploitation : 0000 (le code ordinaire…) · Changer le code… » se lit avant « Fabriquer le fichier ».
- Reste noté, À VÉRIFIER avec le pilote : l'état récapitulatif imprime le code sur deux chiffres (« 00 »), le fichier sur
  quatre ; l'état suit le formulaire réel reçu le 19/10, on ne le change pas sans le voir.

## 1.387.15 — Une seule liste d'étapes pour le mois de paie (issue 10, CABPAIE-31)

- **Deux listes d'étapes sur le même écran** : la frise (Pointage, Bulletins, Écriture de paie, Salaires payés, Déclarés)
  et « Les bulletins sont faits » (Les remettre, Les salaires, L'écriture, Les déclarer), numérotées 1, 2, 3 sous d'autres
  noms et dans un autre ordre ; le bouton principal servait une étape que la frise ne nommait pas. La seconde est
  désormais la suite de la frise : mêmes noms, même ordre, et le numéro de la frise (2 Bulletins remis, 3 Écriture de
  paie, 4 Salaires payés, 5 Déclarés). Chaque étape porte son identifiant (`#pa-f-…`) : les tests ne lisent plus un rang.

## 1.387.16 — Le clavier à l'arrivée sur la paie, et la ligne d'une avance (issue 10, CABPAIE-33)

- **À l'arrivée, ↑ ↓ faisaient défiler la page** : aucune ligne n'avait le curseur. Quand rien n'est sélectionné, ↓ prend
  la première ligne des bulletins et ↑ la dernière ; chaque ligne garde ensuite ses touches (↑ ↓ Entrée Espace P).
- **La ligne d'une avance s'ouvrait au clic sans rien qui le dise**, à côté de bulletins et de salariés qui ont leur bouton.
  Elle porte « Modifier… » (son unique geste, donc un vrai bouton).

## 1.387.17 — Au téléphone, une ligne d'inventaire se titre par sa désignation (issue 10, CABPAIE-35)

- **La carte s'appelait « FAR »** (la référence), la désignation venait en dernier. Une case peut désormais dire qu'elle
  ne titre pas sa carte (`data-tel-nomme="non"`, lu par `telephone.js`, commun aux deux applications) : la référence de
  l'inventaire la porte, et la carte se titre « Farine T55 ».

## 1.387.18 — La CNSS n'invente plus un retard sur un dossier créé ce matin (issue 10, CABPAIE-34)

- **« CNSS du 3ᵉ trimestre, en retard de 32 jours · compté par prudence »** sur un dossier créé le jour même. La règle de
  prudence reste (un dossier dont on ne sait pas s'il emploie est compté : une CNSS oubliée coûte plus qu'un rappel), mais
  pas pour un trimestre dont la date limite est passée AVANT que le dossier entre au cabinet. Dès que sa Paie dit qu'il
  emploie, il est compté comme les autres.

## 1.387.19 — Un livre commencé depuis la Paie ramène à la Paie (issue 10, CABPAIE-34)

- **« Commencer le livre », lancé depuis la Paie, déposait dans la Saisie** : la paie qu'on était venu faire était à
  rechercher. Le livre neuf s'ouvre sur l'écran d'où l'on est parti (Paie, Banque, Immobilisations…) ; depuis le livre
  lui-même, la Saisie reste l'étape suivante.
- Au téléphone, les vues de la Paie défilent de côté (CABPAIE-37) : c'est la règle de la charte (1.368.0) pour toutes
  les vues, gardée ; un indice de défilement commun est une question ouverte.

## 1.387.20 — La fenêtre d'un bien dégressif parle à un comptable (issue 10, CABPAIE-25)

- **« personne ne l'a confirmé », « nul n'a dit que c'est celui d'ici »** : des notes de travail lues par l'expert-comptable.
  Elles deviennent des consignes (« Saisis le taux dégressif qui s'applique à ce bien… », « À cocher si tu passes au
  linéaire… »), avec leur « À VÉRIFIER selon la règle en vigueur ». Le taux, obligatoire, porte son étoile.

### 1.387.21 — le bulletin imprimé au Cabinet porte la date de sa validation

Un bulletin validé le 31/10 s'imprimait « Établi le 16/11/2026 » : la fiche envoyée au client prenait la date du jour de l'envoi. Elle prend maintenant le jour de la validation ; un bulletin pas encore validé garde la date déjà connue. Test : `tests/moteur/bulletin-etabli-le-valide-1387.test.ts`, prouvé.

### 1.387.22 — la bande des mois commande la Paie (issue 10, CABPAIE-5)

Au Cabinet, cliquer « nov. » dans la bande des mois l'entourait, et la Paie restait sur octobre : seul le menu déroulant changeait le mois. Sur la Paie, la bande entoure maintenant le mois de paie regardé, et un clic le change. Et le mois choisi ne suit plus d'un dossier à l'autre : chaque dossier s'ouvre sur son mois à faire. Test : `cabinet-paie-parcours` (« tenue au cabinet »), prouvé (la bande ; le mois propre à chaque dossier n'a pas encore de test). Reste : la bande sur Immobilisations et Inventaire, sans effet.

### 1.387.23 — la Paie au téléphone sans l'avis « Pensé pour un ordinateur » (issue 10, CABPAIE-37)

La Paie d'un dossier est refaite en cartes au téléphone, mais l'avis « Pensé pour un ordinateur » s'ajoutait aux bandeaux et repoussait le mois sous un deuxième écran. Il ne se pose plus sur la Paie (il reste sur les autres écrans de comptabilité, qui sont à l'étroit). Test : `cabinet-paie-parcours` (« faite par le client seul… au téléphone »), prouvé. Reste ouvert : les onglets des vues coupés (la charte décide qu'une rangée trop longue défile de côté ; un indice de défilement est à proposer).

### 1.387.24 — un virement qui met le compte dans le rouge se demande (issue 16, constat 3)

Dans la Trésorerie de l'entreprise, un virement de 100 000 DT partait d'un compte à 50 000 sans un mot. Avant d'enregistrer, SkanFact dit ce que le compte de départ porte à la date du virement et ce qu'il porterait après, et demande « Enregistrer quand même ? » : un découvert autorisé existe, on ne bloque pas. Une modification d'un virement déjà rangé compte son montant d'avant. Test : `poche-1358` (étape 4 bis : 6 000 DT d'une BIAT à 4 839,350, la question, « Annuler » qui ne laisse rien, puis 100 DT qui passent), prouvé. V-11 de l'issue 15 (une lettre hors champ qui ouvre la Caisse) est couvert par la correction de l'issue 12 et la Caisse désactivée.

### 1.387.25 — des salaires notés payés avant leur mois se demandent (issue 16, constat 4)

Des salaires d'octobre notés payés le 05/09 passaient sans un mot. Avant le mois payé ou dans le futur, « Marquer payé » demande (« Ce jour de paiement surprend ») ; on ne bloque pas (une avance existe). Et la fenêtre « Période clôturée » ne dit plus « pour corriger une facture, c'est un avoir » d'un paiement de salaire, d'un mouvement ou d'une absence : elle dit de dater d'un jour encore ouvert. Test : `compta-1305` (05/08 pour des salaires de septembre, la question, « Annuler » qui ne note rien), prouvé. La phrase de la clôture n'a pas de test.

### 1.387.26 — le code du cabinet refusé en français (issue 16, constat 21)

Un code de cabinet de mauvaise forme renvoyait « Le champ « codeCabinet » ne va pas », le nom technique du champ. Les deux portes de « Mon comptable » (la page et les Réglages) refusent maintenant avant l'envoi : « Le code de ton cabinet compte six à dix lettres ou chiffres : recopie-le tel que ton comptable te l'a donné ». Un code dicté avec des espaces ou des tirets (« AB12 CD34 ») est compris. Test : `inviter-comptable`, prouvé sur la page « Mon comptable » (la porte des Réglages porte la même ligne, sans test propre).

### 1.387.27 — le solde de tout compte ne se dit plus « net » (issue 16, constat 13)

Le solde additionne des montants bruts (l'indemnité de congés non pris est calculée sur le dernier salaire brut ; les retenues se font sur le dernier bulletin) sous le titre « Net à percevoir ». Il s'appelle « Total du solde », sur le document imprimé et dans les deux fenêtres (entreprise, Cabinet). Test : `cabinet-documents-personnel`, prouvé. Le constat 15 (la somme en lettres de l'état CNSS) n'est pas changé : la formule « déclaration de salaires arrêtée à la somme de » vise les salaires déclarés — À VÉRIFIER avec le cabinet pilote.

### 1.387.28 — un CDD sans date de fin se demande (issue 16, constat 17)

La fiche d'un salarié acceptait un CDD sans date de fin : rien ne prévenait ensuite de son terme ni du dernier bulletin qui solde ses congés. À l'enregistrement, SkanFact demande « Enregistrer sans date ? » (un CDD en cours de renouvellement existe) ; « Annuler » ramène à la case de la date. La question ne revient pas à chaque modification d'une fiche déjà enregistrée ainsi. Test : `parcours` (« les primes de chaque mois… »), prouvé.

### 1.387.29 — un nombre négatif ne change plus en silence (issue 16, constat 18)

Taper « -5 » dans l'objectif donnait 5 : le navigateur refuse lui-même le signe moins dans une case de nombre au minimum positif, et les cases de montant le retiraient à la frappe — sans un mot. La page le DIT désormais (une fois par case). Et un nombre sous son minimum (un délai « endormi » à 0) se refuse à l'enregistrement des Paramètres en montrant sa case, avant d'écrire quoi que ce soit ; la fenêtre « Objectif » des Statistiques refuse de même. Test : `parcours` (« un nombre négatif dans les Paramètres… »), deux preuves.

### 1.387.30 — l'objectif se change là où on le lit, la TVA dit son mois, « Marquer reçue » (issue 16, constats 18 et 19)

Une fois l'objectif posé, le bouton des Statistiques disparaissait : il devient « Changer l'objectif… », et le pourcentage s'écrit en français (« 907 640 % », plus « 907640 % »). L'onglet « TVA à payer » s'ouvrait sur le mois d'avant sans le dire, et « Ventes » restait sur le mois en cours : la page dit maintenant pourquoi elle s'ouvre sur ce mois, et la période tient d'un onglet à l'autre. Le bouton des attestations de retenue à recevoir s'appelait « Attestation reçue », lu comme un état acquis : il dit le geste, « Marquer reçue » (et la visite le nomme pareil). Restent du constat 19 : le journal centralisateur montré au gérant, et les trois « résultats » des états. Tests : `parcours`, `tva-versee-1359`, `libelles-gest19-1387` ; trois preuves.

### 1.387.31 — la paie ne garde plus « Payer » sur un mois où rien n'est à payer (issue 16, constat 20)

De l'étape « Payer » d'octobre, choisir novembre ouvrait un écran vide : « Tu regardes Payer. L'étape du moment : Pointer ». Un mois où il n'y a encore rien à payer s'ouvre maintenant sur son étape du moment. Les autres étapes suivent comme avant (à venir, « Bulletins » et « Déclarer » disent ce qu'il reste à faire). Et « Toute l'année » ne montre plus les quatre étapes d'un mois au-dessus des chiffres de l'année. Test : `paie-1330` (« la frise du mois… »), deux preuves.

### 1.387.32 — la déclaration annuelle d'employeur n'a plus qu'une date (issue 16, constat 14)

La paie en donnait quatre (« début 2027 (À VÉRIFIER) », « février 2027 », « 30/04/2027 », et celle du calendrier fiscal). Tous les écrans lisent maintenant la date que le calendrier fiscal règle, par la même fonction (`dateLimiteSociale`) : la déplacer dans le calendrier la déplace partout. Test : `date-employeur-une-1387`, une preuve.

### 1.387.33 — « Vers le compte » porte son étoile (issue 16, constat 8)

Un virement entre comptes sans compte d'arrivée était refusé, mais rien ne disait que la case était obligatoire. Elle porte maintenant l'étoile, et le refus s'écrit dans la fenêtre, sous la case (la règle des fenêtres depuis la 1.379.8, qui couvre aussi la date de sortie d'un salarié). Test : `poche-1358`, une preuve.

### 1.387.34 — la preuve des deux générations d'abonnements retrouve sa prise (rouge GitHub de 92566058)

Depuis la 1.385.0, l'écran ne lance plus qu'une génération à la fois : le double-clic du test n'atteignait donc plus le pont, et la preuve qui retire la garde du pont (deux générations côte à côte qui doublent les mois) restait verte — elle ne prouvait plus rien. Le test appelle maintenant le pont deux fois en même temps, sur un abonnement de plus, et exige qu'aucun mois ne soit écrit deux fois. Les deux gardes sont tenues, chacune par son test.

### 1.387.35 — une retenue d'avance plus grande que le net se refuse ; « Annuler ce départ » (issue 16, constats 10 et 12)

La fenêtre d'une avance annonçait « la retenue en représente 207,8 % » et enregistrait quand même : le bulletin suivant aurait été négatif. Elle se refuse maintenant en montrant la case, et propose un étalement. Le bouton qui défait la sortie d'un salarié s'appelait « Il reste finalement », lu comme un titre : il dit le geste, « Annuler ce départ ». Tests : `paie-avance-fenetre`, `libelles-gest19-1387` ; deux preuves.

## 1.387.36 — La paie, constats 6 et 7 (issue 16)

- Avant le 25, le panneau vide de la paie ne propose plus « Établir » : un bulletin ne s'établit pas avant la fin du mois, et un bouton qui sera refusé ne se montre pas.
- « + H. sup » sans majoration réglée ne se contente plus d'un refus : la question dit pourquoi (« Les heures sup n'ont pas encore de majoration »), et « Régler les majorations » ouvre « Les horaires », le curseur dans la case. À VÉRIFIER : les taux de majoration auprès du comptable.
- Deux preuves : hs-mene-au-reglage, etablir-vide-avant-25.

## 1.387.37 — La fiche du salarié, constat 9 (issue 16), dans les deux applications

- Un CIN « abc » se refuse sur sa case : un numéro de pièce d'identité porte des chiffres (un passeport garde ses lettres).
- Un brut de plus de 50 000 DT par mois (99 999 999 999 tapé par erreur) se DEMANDE avant d'enregistrer, « Annuler » ramène à la case ; on ne refuse pas, un dirigeant peut gagner beaucoup. Même règle au Cabinet.
- Les enfants à charge (0 à 20) et un CIN de chiffres à huit chiffres étaient déjà contrôlés (1.382.2).
- Trois preuves : cin-sans-chiffre, brut-enorme-demande, cin-sans-chiffre-cabinet.

## 1.387.38 — Trésorerie et CNSS, constats 15 et 16 (issue 16)

- L'état récapitulatif CNSS : « Arrêtée à la somme de », posé sous « Total des cotisations », se lisait comme ces cotisations. La phrase dit désormais « Déclaration arrêtée au montant des salaires déclarés (…) », puis que les cotisations à payer sont le total au-dessus. À VÉRIFIER sur un vrai état avec le comptable.
- « + Mouvement » : quand la paie est tenue dans SkanFact, « Salaires et charges » passe en fin de liste, et le choisir affiche « Les salaires payés depuis la Paie sortent déjà de la banque : … sinon il compterait deux fois ». L'invite du libellé suit la nature (« Assurance du local » pour une autre sortie, plus « Salaires de septembre » partout).
- Deux preuves : salaire-pas-en-tete, cnss-arretee-salaires.

## 1.387.39 — Le solde de tout compte, constat 13 (issue 16)

- « Salaire du mois en cours 0,000 » se lisait « rien à payer » pour un salarié encore là jusqu'au 16. Le salaire du dernier mois se paie sur un BULLETIN (la CNSS et l'impôt s'y retiennent), pas dans le solde, qui est en brut. Quand ce bulletin manque, la fenêtre le dit : « Son bulletin de juin 2026 n'est pas encore fait : établis-le (au prorata, jusqu'au 30/06/2026)… ». La ligne du solde s'appelle « Salaire du mois en cours (s'il n'est pas sur un bulletin) », dans les deux applications (moteur commun).
- Le total s'appelait déjà « Total du solde » (plus « Net à percevoir »). À VÉRIFIER avec le comptable : ce qui se retient sur les indemnités.
- Une preuve : solde-dit-dernier-bulletin.

## 1.387.40 — Les jours payés d'un entrant ou d'un sortant, constat 11 (issue 16)

- Entré le 10 et parti le 20 du même mois, la ligne du pointage s'écrivait deux fois (« entrée », puis « départ »), et « 11 jours payés sur 26 » ne disait pas d'où venait le 11. Une seule ligne désormais (« entrée le 10/11, départ le 20/11 »), qui dit le compte : « 11 jours payés : 26 moins 15 hors de son contrat ». À VÉRIFIER avec le comptable : la règle du prorata (jours ouvrables, base 26).
- Deux preuves : une-ligne-entree-depart, jours-hors-contrat.

## 1.387.41 — Les mots de la paie, constat 22 (issue 16)

- La fenêtre d'un bulletin disait « Net versé » depuis janvier en comptant un mois pas encore payé : le cumul s'appelle « Net des bulletins ».
- « l'onglet Barèmes » (une bulle et la visite de la paie) nommait un onglet qui s'appelle « Réglages » : « dans les Réglages de la paie ».
- Déjà réglé avant : « Le salarié » accentué sur le bulletin imprimé, les élisions (« d'Ahmed »), « Total du solde ».
- Une preuve : net-des-bulletins.

## 1.387.42 — Le journal centralisateur replié pour le gérant, constat 19 (issue 16)

- Comptabilité › Écritures montrait au gérant un tableau « VT D / C · AC D / C · BQ D / C… » qui sortait de l'écran à 1440. C'est l'outil du comptable : il se replie sous « Voir le tableau par journal et par mois (l'outil de ton comptable) », et « Exporter le centralisateur » reste visible.
- Une preuve : centralisateur-replie.

## 1.387.43 — La régularisation d'un bulletin payé, constat 23 (issue 16)

- L'étoile « obligatoire » était sur « Sens » (une liste qui a toujours une valeur) alors que c'est le montant qui manque : elle passe sur le montant.
- Le refus « Le montant de la régularisation manque » restait affiché une fois le montant tapé : il s'efface dès qu'un montant est lu.
- Deux preuves : regul-refus-s-efface, regul-etoile-montant.

## 1.387.44 — Les mouvements de trésorerie, constats 16 et 24 (issue 16)

- « Tout 98 » pour « Entrées 25 » et « Sorties 71 » : les deux lignes d'un virement entre tes comptes ne sont ni l'un ni l'autre. Elles ont leur filtre, « Entre mes comptes », et les comptes tombent juste (Tout = Entrées + Sorties + Entre mes comptes).
- Un virement entre tes comptes ne compte plus dans « Sans justificatif » : l'argent change de poche, il n'y a pas de pièce à fournir.
- Deux preuves : virements-leur-filtre, virement-sans-justificatif.

## 1.387.45 — Le mode de paiement d'un salaire, constat 17 (issue 16)

- La fiche d'un salarié, le paiement d'un bulletin et une avance proposaient « Traite », « Carte », « Paiement en ligne » : un salaire se paie par virement, chèque ou espèces. Un mode déjà enregistré reste proposé, pour ne rien effacer en silence.
- Le CDD a sa date de fin demandée depuis la 1.387.28.
- Une preuve : modes-de-salaire.

## 1.387.46 — Un test patient (rouge GitHub de 43704f50)

- `cabinet-premier-jour-1371` attendait la fenêtre « Reprendre les soldes d'ouverture » après UN clic : sur une machine chargée, l'écran Exercice se redessinait à l'arrivée du livre et le clic tombait sur le bouton d'avant, sans son geste. Le test reclique tant que la fenêtre ne s'ouvre pas (deux passages verts en local avant comme après). Aucun changement de l'application.

## 1.387.47 — Le dernier bulletin dans « Son départ » (issue 16, constat 12)

- L'onglet « Son départ » d'un salarié dit maintenant où en est son dernier bulletin (celui du mois de sa sortie) : son net et s'il est payé, avec « Voir » ; ou, s'il manque, qu'il n'est pas encore fait (le salaire de ce mois va sur ce bulletin, pas dans le solde), avec « Établir son dernier bulletin… », qui ouvre le bulletin de ce mois-là, au prorata.
- Test : `paie-revue-ecrans` (la sortie d'un salarié). Une preuve : dernier-bulletin-au-depart.

## 1.387.48 — Le départ dit dans l'en-tête de la fiche (issue 16, constat 12, fin)

- L'en-tête de la fiche d'un salarié disait toujours « CDI depuis le … », sans son départ. Il dit maintenant « sortie prévue le … » ou « parti le … » ; pour un salarié parti, le coût mensuel ne s'y affiche plus.
- Test : `paie-revue-ecrans` (la sortie d'un salarié). Une preuve : depart-dit-en-tete.

## 1.387.49 — Les lettres des graphiques ne s'étirent plus (issue 16, constat 24)

- Les graphiques de l'application entreprise (accueil, statistiques) s'étirent à la largeur de leur carte : les barres s'étiraient, et les lettres de l'axe aussi (« janv. », « 23 k » élargis). Chaque texte est maintenant resserré autour de son point d'ancrage, au dessin et à chaque changement de taille de la carte.
- Test : `statistiques-1323`. Une preuve : graphique-lettres-droites.

## 1.387.50 — Les montants de « Ce que tu verses, et quand » en colonne (issue 16, constat 24)

- Chaque ligne de la carte était sa propre grille, avec des colonnes qui suivaient leur contenu : les montants d'une ligne sans bouton tombaient 7 px à côté de ceux d'une ligne qui en porte un. Les colonnes ont maintenant des largeurs fixes, la place du bouton réservée sur toutes les lignes (le téléphone garde sa disposition en une colonne).
- Test : `paie-bon-a-payer` (mesure les bords droits des montants). Une preuve : montants-verses-en-colonne.

## 1.387.51 — Les congés d'un bulletin passé (issue 16, constat 24)

- L'aperçu d'un bulletin lisait les congés acquis au jour où on le relit : le bulletin d'octobre, ouvert en novembre, comptait déjà novembre. Il les lit maintenant à la fin de son mois.
- Test : `libelles-gest19-1387`. Une preuve : conges-du-mois-du-bulletin.

## 1.387.52 — Un test qui dépendait du jour (rouge GitHub de 43704f50)

- `fiche-client` calculait le mois « client depuis » de l'école sur J-50, alors que sa première facture est datée de J-49. Le 19/11, ces deux jours tombent dans deux mois différents. Le test calcule maintenant sur le jour de la pièce. Aucun changement dans l'application.

## 1.387.53 — Le coût moyen après un avoir fournisseur (issue 13, ENTACHATS-7)

- Un avoir fournisseur rend la marchandise au prix de sa facture, pas au coût moyen : la valeur du stock baissait de ce prix, mais le coût moyen n'était pas recalculé. La fiche stock affichait « coût moyen après 64,333 » pendant que le stock valait 64,615 l'unité, et l'entrée suivante ne tombait juste qu'avec ce dernier. Une sortie à un autre coût que le coût moyen recalcule maintenant le coût moyen ; une vente (sortie au coût moyen) n'y change rien.
- La ligne de l'avoir se nomme « Avoir fournisseur » (elle disait « Achat »), dans l'historique de l'article, dans Stock › Mouvements et dans leur export. Elle garde sa source « achat » pour le moteur : le coût des ventes l'exclut toujours.
- Test : `cout-moyen-avoir-1387` (calcul à la main). Deux preuves : cmp-apres-avoir, origine-avoir-fournisseur.

## 1.387.54 — Créer l'article depuis la ligne d'un achat (issue 13, ENTACHATS-12)

- Premier achat de marchandise, catalogue vide : la liste disait « Rien à choisir pour l'instant », et il fallait quitter la facture pour créer l'article au Catalogue. La liste du catalogue de la facture d'achat porte maintenant « + Nouvel article », comme celle de la commande fournisseur : le nom tapé dans la recherche préremplit la fiche, suivie en stock, et la ligne se pose quand on l'enregistre.
- Test : `recette-alpha` (au Stock…). Une preuve : achat-cree-son-article.

## 1.387.55 — Le dernier prix d'achat proposé (issue 13, ENTACHATS-19)

- Un article suivi en stock, ajouté à une facture d'achat depuis le catalogue, arrivait au coût écrit sur sa fiche, même quand le dernier achat s'était fait à un autre prix. Il arrive maintenant au prix HT de son dernier achat (`fournisseurDeLArticle`), sur la facture d'achat comme sur la commande fournisseur, et la liste de la facture le dit : « suivi en stock · prix du dernier achat ». Sans achat connu, rien ne change : le coût de la fiche, sinon son prix.
- La liste du catalogue lit les mouvements de stock une seule fois pour tous les articles (dans un lot), pour rester rapide sur un gros catalogue.
- Test : `recette-alpha` (ENTACHATS-19). Deux preuves : achat-dernier-prix, commande-dernier-prix.

## 1.387.56 — La commande reçue en partie se solde, elle ne s'annule plus (issue 13, ENTACHATS-11)

- Une commande fournisseur dont une partie était reçue (et même facturée) pouvait passer « Annulée » sans une question : la frise devenait incohérente (« Annulée, plus rien n'est attendu » puis « Reçue en partie », « Facturée »). Dès qu'une réception est validée, « Annulée » n'est plus proposé : on solde, et l'option dit ce que ça fait (« Soldée — ne plus attendre le reste »).
- Solder une commande qui attend encore quelque chose pose la question en nommant le reste (« 25 sac Farine T55 ») ; « Annuler » laisse la commande ouverte.
- La liste des commandes n'engage plus que ce qui reste à recevoir (`montantResteCommandeFournisseur`, en dinars) : 15 sacs reçus sur 40 à 62,500, ce sont 1 562,500 DT HT engagés, pas 2 500,000. Le seuil d'accord des commandes (serveur) garde le montant entier : c'est la commande qu'on autorise.
- Tests : `commande-reste-engage-1387` (calcul à la main), `recette-alpha` (ENTACHATS-11). Trois preuves : commande-recue-sans-annuler, commande-solder-demande, commande-engage-le-reste.

## 1.387.57 — La date d'un achat se dit avant d'enregistrer (issue 13, ENTACHATS-17)

- Une facture d'achat datée de « 15/03/2031 » passait sans une remarque, et une date dans un mois clôturé ne se disait qu'au clic sur « Enregistrer » (la fenêtre « Période clôturée »), alors que tout était connu dès la frappe. La liste « Avant d'enregistrer » le dit maintenant : « Le 15 août est dans un mois clôturé : l'achat ne s'enregistrera pas à cette date », ou « Datée du 15/03/2031, dans plus de trois mois : est-ce bien l'année ? ». Les deux portent « Changer la date », qui ramène le curseur dans la date. Rien n'est bloqué : une facture datée loin peut être juste.
- Test : `recette-alpha` (ENTACHATS-17). Deux preuves : achat-date-mois-clos-dite, achat-date-lointaine-dite.

## 1.387.58 — Les lots : le lot conseillé posé d'office, la péremption dans les Alertes (issue 13, ENTACHATS-14)

- Une facture qui prenait un article suivi par lot laissait « — Quel lot ? — » ; émise quand même, elle restait « sans lot −10 » sur la fiche pour toujours. Une ligne de facture ou de bon de livraison prend d'office le lot conseillé (celui qui périme le plus tôt sans être périmé, `lotConseille`) ; il se change sur la ligne, et l'avertissement d'émission reste pour une ligne qu'on aurait vidée.
- Stock › Alertes disait « Rien à signaler » à neuf jours de la péremption d'un lot. Un panneau « Lots qui périment dans les 30 jours » (paginé, chaque ligne ouvre la fiche de l'article) suit la liste des articles, et la phrase vide ne dit « Rien à signaler » que s'il n'y a vraiment rien.
- Test : `lots` (étape ENTACHATS-14). Deux preuves : facture-lot-conseille, alertes-lots-perimes.

## 1.387.59 — Envoyer une commande à un fournisseur sans e-mail (issue 13, ENTACHATS-10)

- « Envoyer au fournisseur… » ouvrait un message vers personne pour un fournisseur sans adresse e-mail, et la commande passait « envoyée » d'un clic. La page le dit maintenant d'abord, et propose ce qui se fait vraiment : « Ajouter son e-mail… » (sa fiche s'ouvre), ou « Partie autrement » (téléphone, WhatsApp, papier) — le bon de commande se télécharge, et la commande passe « envoyée ». « Annuler » ne change rien. « Marquer envoyée » du bandeau d'accord reste un simple geste, sans question.
- Test : `recette-alpha` (ENTACHATS-10), `stock-revue` répond à la question. Une preuve : commande-sans-email-dite.

## 1.387.60 — Agir depuis Stock › Mouvements (issue 13, ENTACHATS-9)

- Un mouvement saisi à la main (casse, ajustement, inventaire, transfert) ne se retirait que depuis la fiche de l'article, par une croix ; la page Stock › Mouvements le montrait sans rien permettre. Il porte maintenant « Retirer… » sur sa ligne (la même question et la même règle qu'avant : un transfert part avec ses deux mouvements, un mois clôturé refuse) — une seule fonction pour les deux écrans.
- La liste se cherche (article, référence, note, nature) et se filtre par nature, comme la liste des achats ; le compte dit « n sur N ». Chaque ligne s'ouvre : la pièce qui a fait le mouvement, sinon la fiche de l'article.
- Reste à faire (noté) : « Transférer… » et un choix de dépôt en tête de la page Stock.
- Test : `recette-alpha` (ENTACHATS-9). Deux preuves : mouvements-retirer-depuis-stock, mouvements-filtre-nature.

## 1.387.61 — le journal centralisateur replié, bord à bord

Rouge GitHub de la 1.387.52 : depuis que le journal centralisateur (Comptabilité › Écritures) est rangé dans un
volet repliable (1.387.42), son tableau ne touchait plus les bords de la carte (15 px de marge). La règle « bord à
bord » des tableaux de la Comptabilité vise aussi un tableau posé dans un volet (`.panel > details > .scroll-x`),
au bureau comme au téléphone. Preuve : retirer cette extension fait tomber le parcours du grossiste.

## 1.387.62 — l'accueil d'une entreprise qui commence par acheter (ENTACHATS-13)

L'accueil ne montrait ses chiffres (« On te doit », « Tu dois »…) qu'après la première pièce de VENTE : une épicerie qui
avait saisi trois achats lisait « Bienvenue » et ses premiers pas, sans un mot sur les 1 500 DT qu'elle doit. Un achat
compte désormais comme du grain : « Tu dois » se lit dès le premier achat. Reste à faire : des premiers pas selon le
métier (« ton premier achat », « ton premier article » pour un commerce).

## 1.387.63 — la fiche du fournisseur depuis une pièce (ENTACHATS-18)

- Un téléphone sans chiffres (« xyz ») est refusé, chez un fournisseur comme chez un client, en montrant la case ; un
  numéro national ou international reste libre (seulement ce qui n'est pas un numéro est refusé).
- Sur une pièce (achat ou vente), le nom du tiers mène à sa PAGE (achats, règlements) ; « Fiche » corrige sa fiche sans
  quitter la pièce, et le dit au survol.
- Reste à faire : pays et IBAN/SWIFT pour un fournisseur étranger.

## 1.387.64 — l'inventaire d'un dépôt, et le comptage qui ne s'efface plus d'un toucher (ENTACHATS-4, -15)

- Avec deux dépôts ou plus, la feuille d'inventaire demande le **dépôt compté** : le stock théorique est celui de ce
  dépôt, et l'écart se pose sur lui (avant, tout était compté ensemble et l'écart tombait sur le dépôt principal). La
  question avant d'enregistrer nomme le dépôt et dit que les autres ne bougent pas ; changer de dépôt garde le comptage
  de chacun. L'export CSV suit le dépôt choisi.
- « Effacer le comptage » laisse « Annuler » sous la main et dit combien d'articles comptés il efface.
- Restent pour l'inventaire : la liste des inventaires passés (date, écarts, annuler d'un geste) et la saisie au
  téléphone (une ligne par article, recherche, pied fixe).

## 1.387.65 — trois rouges GitHub de la 1.387.61, côté tests

- `commandes-da` attendait encore l'ancien « engagé » (toute la commande) : depuis la 1.387.56, l'engagé est ce qui reste
  à recevoir (125,000 + 2 × 47,333 = 219,666, refait à la main).
- La preuve « l'alerte partie avant les cinq minutes » dépendait d'un écart d'horloge de quelques millisecondes entre la
  base et le test : le test vérifie maintenant qu'une minute après l'écriture, rien n'est parti.
- La preuve « la messagerie relit au retour du réseau » passait ou non selon la machine (le retour réel du réseau peut
  faire redessiner la page par un autre chemin) : le test donne le signal réseau encore coupé et compte la relecture.
- Deux rouges de la 1.387.64 : le nom du tiers sur une pièce, devenu un lien, fait 44 px de haut au téléphone (il se
  touche au doigt) ; le test de la clôture du client attend que les livres du dossier soient lus avant de juger la fiche.

## 1.387.66 — un seul coût par article (ENTACHATS-5)

Le catalogue, la liste de prix et la marge d'une ligne de vente lisaient le coût SAISI sur la fiche (62,500) pendant que
la fiche de stock montrait le coût moyen (64,333) : deux coûts et deux marges pour le même sac de farine. Une seule
règle, dans le moteur (`coutDeLArticle`) : un article suivi qui a du stock vaut son **coût moyen** ; sinon le coût de sa
fiche. Le catalogue l'affiche (avec « moyen », et le coût saisi au survol), la marge moyenne du catalogue, « sous son
coût » d'une liste de prix et « tu vends à perte » d'une ligne de vente le lisent. Un coût tapé sur la ligne d'une pièce
l'emporte toujours. Calculs refaits à la main dans les tests (1 930 / 30 = 64,333 ; 69,400 / 199,500 = 34,8 %).

## 1.387.67 — les mots du métier (ENTACHATS-22)

- Un commerce, un restaurant, un artisan importent des **articles** : l'aperçu (« 2 nouveaux articles »), le bouton
  (« Importer 2 articles ») et le compte rendu (« 2 articles importés ») suivent les mots du Catalogue ; un métier de
  service garde « prestations ». Les accords suivent le genre (« article existant », « article complété »).
- L'unité s'accorde au nombre dans l'inventaire (« 22 → 15 sacs »), l'avancement d'une commande et le message de stock
  insuffisant (`uniteAccordee`, la règle du moteur).
- Le fil d'un fournisseur accorde le participe : « Avoir … reçu », « Acompte … versé », « Dépense … enregistrée ».

## 1.387.68 — la dépense du comptoir au téléphone (ENTACHATS-16)

- Le « Montant payé (TTC) » d'une dépense neuve vient avant la recherche du catalogue ; au téléphone, tout le bloc des
  lignes (donc le montant) passe avant la fiche (référence, catégorie, options).
- Au téléphone, une page neuve s'ouvre en haut : c'est le document qui y défile, et la page suivante gardait la
  hauteur de la précédente (titre coupé).
- Le grand bouton n'écrit plus « Ctrl S » au téléphone.
- Le test de l'accueil ne dépend plus du jour du mois (rouge du 20/11).

## 1.387.69 — les unités de la marchandise (ENTACHATS-20, en partie)

- Six unités de plus : pièce, carton, paquet, sac, boîte, bouteille. Un métier d'articles (commerce, restauration,
  artisanat) les lit en tête de liste ; les autres métiers gardent l'ordre de toujours.
- « pièce » importé d'un tableur reste « pièce » (il devenait « u »).
- Au téléphone, le retour en haut ne se fait que quand la page change (un redessin de la même page ne déplace pas le
  lecteur).
- Reste d'ENTACHATS-20, à décider avec Skander : FODEC à l'achat (À VÉRIFIER avec le comptable), quantité refusée à la
  réception, relevé de compte fournisseur, image et variantes d'un article, promotions.

## 1.387.70 — les listes qui ne coupent plus rien (ENTACHATS-21, ENTACHATS-9 en partie)

Vu à l'écran, sur l'entreprise d'exemple à 1 440 px.

- La barre des filtres des listes ne coupe plus ses choix (« Avoirs » lu « A », « Toutes les a… ») : les filtres gardent
  leur largeur, la recherche se resserre, et la barre passe à la ligne quand la place manque.
- Liste des achats : « 357,000 pour toi » tient sur deux lignes dans sa colonne ; la référence interne et « sans
  justificatif » ont chacune leur ligne (« réf. SN-… · san… » coupait le mot qui compte).
- L'état du stock se trie par ses en-têtes (⇅), comme la liste des achats ; la ligne dit qu'elle ouvre la fiche.
- Dépense neuve : la phrase qui répétait la note du montant disparaît.

## 1.387.71 — le cycle de vente : un paiement pour plusieurs factures, le document imprimé (issue 15, V-13 et V-16 en partie)

- « Un paiement pour plusieurs factures » propose les mêmes moyens que la fenêtre d'une facture : la traite y est, et
  un chèque ou une traite a son « Échéance de l'effet » (la date devient « Reçu le »). Chaque part porte la même
  échéance et le jour de réception, comme un effet saisi sur une seule facture.
- Le document imprimé écrit « Remise 5 % », « TVA 19 % », « Retenue à la source 1,5 % » avec l'espace (insécable) du
  français ; l'anglais garde le signe collé.
- Le devis d'un commerce, d'un restaurant ou d'un artisan est signé « Le vendeur » (« Le prestataire » pour un service).
- Reste de l'issue 15 : V-10 (client à l'étranger : une case et un pays), le reste de V-16 à V-18 (finitions).

## 1.387.72 — Le client à l'étranger (issue 15, V-10)

- **Une facture en devise avec TVA ou timbre pose la question avant d'émettre.** L'exportation était une case au fond de
  la puce « Devise » : une facture en euros partait à 19 % avec un timbre. « Avant d'émettre » le dit (« une vente à
  l'exportation n'en porte pas ») et porte le geste « Passer en export » — on peut émettre quand même (un client
  étranger servi en Tunisie paie la TVA) : on prévient, on ne bloque pas.
- **Un numéro fiscal étranger ne se reproche plus.** Sur la fiche d'un client dont la devise n'est pas celle de
  l'entreprise, « FR 12 345678901 » ne déclenche plus « Ni un matricule ni un CIN » ; la note dit qu'il s'écrit tel quel,
  et elle suit le choix de la devise.
- Test : `tests/web/etranger-1387.test.ts` ; preuves `etranger-export-avant-emettre`, `etranger-numero-fiscal-tel-quel`.

## 1.387.73 — La fenêtre du client, et quelques mots (issue 15, V-17 et V-18)

- **La fenêtre d'un client qui a des pièces n'offre plus « Supprimer ce client » en rouge** (le bouton répondait
  « Impossible : 16 documents sont liés ») : elle offre « Archiver ce client », le même geste que le menu de sa fiche,
  avec son « Annuler ». Un client sans pièce se supprime toujours.
- **« E-mail » partout** : la fenêtre du client, du fournisseur et de l'entreprise disaient « Email », la fiche
  « E-mail » ; « Envoyer par e-mail », « Adresse e-mail invalide ».
- **Un devis vide** n'annonce plus « Le client paiera 1,000 » (le timbre seul).
- **« Reçu … puis 214,200 DT rendus au client »** : le « dont » se lisait comme une part du reçu.
- **Un avoir clos** : « Tu peux le lire… » (et non « la lire »).
- Laissé : « À VÉRIFIER » en capitales (la convention du projet — à décider avec Skander) ; la ville à part ; langue
  et devise sous le pli.

## 1.387.74 — Le document que le client reçoit (issue 15, V-16, suite)

- **Le prix unitaire s'imprime tel qu'il compte.** 850,555 € s'imprimait « 850,56 » : 2 × 850,56 = 1 701,12 quand le
  total dit 1 701,11. Un prix plus fin que la devise garde ses décimales (jusqu'à quatre) ; les autres ne changent pas.
- **« Capital 1 000 DT » ne se coupe plus** en deux lignes au pied (espaces insécables).
- **La case de signature resserrée** : moins de marge intérieure, le nom sur une ligne (coupé proprement s'il est
  long) — il n'est plus barré par le pointillé, la consigne « Date, signature et cachet du client » reste entière.
- Laissé : le sous-total d'une section sur la ligne de son titre (un choix de mise en page) ; la vignette « 2 pages »
  contre l'aperçu « 1 page (resserrée) » et l'aperçu à 125 % restent à voir à l'écran.

## 1.387.75 — La coquille : accueil, recherche, paramètres, modules (issue 14)

- **ENTSOCLE-4 — un montant, partout le même.** « Dernières pièces » de l'accueil écrit le net à payer avec sa devise,
  comme la liste et la recherche (un devis de 800 € s'écrivait « 800,000 », une facture à retenue par son TTC). La
  recherche écrit « 800,00 € », plus « 800,00 EUR ». Le statut d'un devis y prend sa majuscule, comme celui d'une facture.
- **ENTSOCLE-5 — la recherche trouve un montant et un compte.** « 2345,300 » ou « 2345 » trouvent la pièce (net à
  payer et reste dû) ; « BIAT » ouvre la Trésorerie ; « Paramètres → Ton abonnement » ne sort plus en double ;
  l'invite ne passe plus sous la touche « Échap ».
- **ENTSOCLE-7 — les Paramètres refusent une adresse e-mail fausse et un téléphone en lettres** avant d'écrire, en
  montrant le champ : ils s'imprimaient en haut de chaque facture.
- **ENTSOCLE-2 — « Tous les modules » dit où est la page** : « Relances (dans Factures) », « Immobilisations (dans
  Comptabilité) », et le message d'une case cochée dit la famille du menu ou l'onglet où elle vient d'apparaître.
- ENTSOCLE-1, 3 et 8 étaient déjà faits. Restent : 6, 9 à 23.
- Test : `tests/web/coquille-1387.test.ts`, huit preuves.

## 1.387.76 — La coquille, suite : la cloche, les mots, les réussites (issue 14)

- **ENTSOCLE-15 — la cloche ouvre ce qu'elle annonce.** « Factures : 2 en retard » ouvrait la liste entière ; le clic
  ouvre les relances, et pour les achats la liste filtrée sur « En retard ».
- **ENTSOCLE-21 — les phrases d'un autre produit.** « Tes réussites » ne parle plus de « copie automatique hors de
  cet ordinateur » ni de « paquet au comptable » en ligne : les données vivent en ligne, et la ligne du comptable
  (« Ton comptable relié ») se coche quand un cabinet est relié. Le guide et les visites ne promettent plus un PDF
  joint : le message porte le lien de la pièce. Le module Comptabilité dit « ce que ton comptable lit ».
- **ENTSOCLE-22 — les mots.** « E-mail » partout (bouton, bulles, « E-mail du comptable ») ; l'export dit ce qu'est
  un fichier JSON ; les deux lignes « À faire » des attestations disent leur geste (« Les réclamer », « Les remettre »).
- **ENTSOCLE-10 — les cases de la numérotation se nomment** (« Dernière facture émise », « Dernier avoir émis »,
  « Dernier devis émis ») pour un lecteur d'écran.
- Restent : 6, 9, 11 à 14, 16 à 20, 23.
- Tests : `tests/moteur/reussites-en-ligne-1387.test.ts`, `tests/web/coquille-1387.test.ts`.

## 1.387.77 — La coquille : où l'on est, où l'on était (issue 14)

- **ENTSOCLE-12 — la barre dit où l'on est.** Une page de « Tout le reste » (Clients, Catalogue, Stock…) allume sa
  famille (encre et icône ; le fond reste au volet ouvert).
- **ENTSOCLE-13 — recharger garde l'endroit.** L'onglet des Paramètres, l'année, le filtre et la page des listes de
  devis et de factures se reprennent après un rechargement, dans le même onglet du navigateur et pour la même entreprise.
- **ENTSOCLE-14 — chercher n'est pas modifier.** Une lettre tapée dans « Chercher un client » ou dans la barre d'ajout
  ne marque plus la pièce modifiée : on quitte sans question.
- **ENTSOCLE-22, suite.** « (et 2 autres valeurs) » ; « SkanFact est écrit par une seule personne » retiré de l'Aide.
- Test : `tests/web/coquille-1387.test.ts`.

## 1.387.78 — La coquille, fin : le conflit, l'accueil, « Créer », les raccourcis (issue 14)

- **ENTSOCLE-6 — deux onglets sur le même brouillon.** Le bandeau nomme ce que l'AUTRE a changé (lu contre la version
  de départ) ; il disait « a changé l'objet » quand c'était moi qui l'avais tapé. Tant que la version n'est pas
  choisie, ni « Brouillon enregistré » ni « ✓ enregistré » : le message dit de choisir dans le bandeau.
- **ENTSOCLE-21 — un seul vert sur l'accueil.** « À faire » ne prend le vert que pour une ligne qui presse, jamais
  pour « Quand tu peux », ni quand « Tes premiers pas » portent déjà l'étape suivante. Le nom de l'entreprise, coupé
  dans l'en-tête, se lit en entier au survol.
- **ENTSOCLE-20 — « Créer » garde ses quatre gestes.** Une entrée dont la page n'existe pas ici laissait le menu à
  moitié vide : la place revient aux gestes suivants du métier, sans deux fois la même touche.
- **ENTSOCLE-19 — les raccourcis d'une pièce figée** (émise, ou d'un mois clôturé) ne promettent plus « Ajouter un
  article » ni « Émettre ».
- **ENTSOCLE-22** — « -3 » dans la numérotation est refusé sur la ligne (vérifié par un test).
- Test : `tests/web/coquille-1387.test.ts` (deux tests de plus).

## 1.387.79 — Le document du client et les petits états du cycle de vente (issue 15, V-16 et V-18)

- **V-16 — la vignette disait « 2 pages », le grand aperçu « 1 page (resserrée) ».** La mise en page se faisait au
  zoom de l'aperçu : à 50 % ou à 125 %, le texte ne se coupe pas aux mêmes endroits. Elle se fait maintenant au zoom du
  PDF (1), puis l'aperçu reprend son zoom : la vignette, le grand aperçu (à tous ses zooms) et l'aperçu d'un contrat
  disent le même nombre de pages que le PDF. Le test cherche, avec le moteur de l'application, une longueur de facture
  qui se coupe autrement à 50 % ; sans elle, il tombe (la donnée ne discriminerait pas).
- **V-18 — la liste des devis.** « Valable jusqu'au » porte l'année quand ce n'est pas celle-ci ; un devis qui a reçu
  sa réponse dit « réponse le … » (le statut dit déjà « accepté » ou « refusé ») ; « expiré il y a 20 jours » tient sur
  une ligne.
- **V-18 — « Texte prêt » vide** renvoyait à « Paramètres → Textes », qui n'existe pas (les textes vivent au
  Catalogue) : « Écrire un texte prêt… » l'écrit sur place, et il part dans les notes.
- **V-18 — « Modèle » sans modèle** ne montre plus ni recherche ni « Ajouter à la suite / Remplacer les lignes ».
- **V-18 — « Calculer les prix »** sur des lignes toutes sans coût dit où le saisir (la fiche de l'article).
- **V-18 — la vue « Avoirs » des factures** propose les statuts d'un avoir (Brouillon, Avoir émis).
- **V-18** — la note de retenue de la fenêtre d'encaissement ne commence plus une ligne par « : une retenue subie » ;
  « Total de la sélection » tient sur une ligne ; « + Nouvelle proforma » porte la croix des autres pages ; le devis
  dit « Il a répondu au téléphone ? Note-le ici : la fenêtre propose aussi de faire la facture ».
- Gardé : « Il a accepté… » après une modification (le libellé long débordait de sa carte, preuve de la 1.307.0) ; le
  sous-total d'une section sur la ligne de son titre (règle du gabarit depuis la 1.155.0 ; À VÉRIFIER avec Skander).
- **ENTSOCLE-9 (en partie, issue 14)** — les visites citent les boutons tels qu'ils sont écrits (« Enregistrer le
  devis », le bouton du bandeau de l'exemple selon qu'une vraie entreprise existe ou non, le cadre des justificatifs).
- Tests : `tests/web/coquille-1387.test.ts` (deux tests de plus), `tests/web/liste-devis.test.ts`.

## 1.387.80 — L'aperçu « Ton menu » est le vrai menu ; l'onglet Données dit où demander (issue 14)

- **ENTSOCLE-11 — l'aperçu « Ton menu » de l'assistant** montrait les familles (« Vendre : Devis, Factures… ») quand la
  barre ouvre sur « Au quotidien » (l'accueil et les pages du métier) puis « Tout le reste ». L'aperçu range maintenant
  les pages comme la barre, par la même règle (`quotidienDe`, partagée par la barre et l'assistant) ; une vue que le
  métier met au quotidien (les Relances d'un prestataire) y est, comme dans la barre. Le test compare l'aperçu à la
  barre de l'entreprise ouverte, page par page, dans l'ordre.
- **ENTSOCLE-16 — l'onglet Données** promettait « SkanFact sait le remettre en place » sans aucun geste pour le faire :
  le panneau dit que la remise en place et l'effacement de l'entreprise se demandent au support (l'équipe vérifie que
  la demande vient bien de toi), et « Écrire au support » ouvre la demande, le sujet déjà posé.
- Tests : `tests/web/assistant.test.ts` (retourné vers la règle), `tests/web/export-complet.test.ts`.

## 1.387.81 — Le code d'authentification se lit ; le chemin et le bandeau de l'exemple sur toutes les pages (issues 4 et 14)

- **ENTREE-1 (bloquant) — la fenêtre « Activer le code d'authentification »**, commune à SkanFact et au Cabinet, posait
  ses étapes dans une liste `.cpt-etapes`, une classe que la feuille de « Mon comptable » (chargée après) range en trois
  colonnes. À l'ordinateur, les quatre étapes se tassaient sur une ligne ; au téléphone, chaque étape tombait à 24 px de
  large et les codes de secours se coupaient lettre par lettre. La liste a sa propre classe (`.cpt-etapes-code`),
  numérotée et empilée ; un test exige que les deux feuilles ne partagent que les deux classes nommées (la carte et le
  pied), et mesure la fenêtre à l'ordinateur puis à 390 px.
- **ENTSOCLE-18 — Paramètres, « Tous les modules » et « Me guider »** n'avaient pas le chemin « Accueil › … » que portent
  toutes les autres pages, et le bandeau de l'exemple disparaissait sur une page dessinée après coup : le routeur le
  repose une fois la page dessinée.
- Tests : `tests/web/compte.test.ts`, `tests/web/exemple.test.ts`.

## 1.387.82 — L'aide sur toute l'entrée, la session fermée qui ne perd rien, la console qui ne blanchit plus, le fond du caissier (issues 4, 5 et 7)

- **ENTREE-3 (bloquant) — « Besoin d'aide ? »** n'était que sur la connexion et l'écran du code. Il vit maintenant dans
  l'en-tête commun des écrans de l'entrée (la porte, le code à poser, le mot de passe oublié, le nouveau mot de passe,
  l'appareil inconnu, l'invitation) et à la main sur « Créer ton compte » et « Vérifie ton e-mail » ; une fois et une
  seule par écran, l'adresse de SkanFact à lire et à copier.
- **ENTREE-2 (bloquant) — la session fermée pendant la saisie.** « Enregistrer » qui recevait « session terminée »
  perdait ce qu'on venait d'enregistrer : la fenêtre était fermée, le dossier jamais parti. Sur « mon ordinateur », ce
  qui n'était pas encore parti est gardé, chiffré, avec la copie du poste, et part à la reconnexion ; le bandeau dit
  « Ce que tu enregistrais quand ta session s'est fermée est arrivé sur le serveur ». Sur l'ordinateur d'un autre, rien
  n'est gardé (docs/hors-ligne.md, H2) et l'entrée le dit. **À DÉCIDER (Skander)** : garder aussi, sur l'ordinateur
  d'un autre, la saisie d'une fenêtre encore ouverte (c'est une décision de confidentialité, pas un correctif).
- **CONSOLE-1 (bloquant) — un écran de la console qui tombe** (un texte qui manque, une réponse inattendue) blanchissait
  toute la console. Il n'emporte plus que lui : la barre reste, l'écran dit « Cet écran n'a pas pu s'afficher », propose
  de recharger, et choisir un autre écran le remet d'aplomb.
- **COLLAB-1 (bloquant) — le fond de caisse proposé au caissier** venait d'un solde qu'il ne peut pas lire en entier (ses
  tickets seulement) : 9,866 DT proposés pour 59,000 comptés au Z, puis un mouvement « noté dans la Trésorerie » qui ne
  partait jamais. Le caissier part du dernier compté du Z, l'écran le rappelle, un écart se confirme avant d'ouvrir, et
  rien n'est écrit dans la Trésorerie à sa place. Le propriétaire garde le solde du livre. **À DÉCIDER (Skander)** :
  prévenir la patronne d'un écart de fond saisi par un caissier (une alerte de plus).
- Tests : `tests/web/rendu.test.ts`, `tests/web/entree.test.ts`, `tests/web/hors-ligne-envoi.test.ts`,
  `tests/web/console-reglages.test.ts`, `tests/web/caissier.test.ts`, `tests/web/caisse-z.test.ts`.

## 1.387.83 — La paie et le classeur du Cabinet disent ce qui est (issues 9 et 10)

- **CABPAIE-1 (bloquant) — l'absence non payée posée après la validation** : la liste des congés disait déjà « pas
  retenue : à régulariser », mais le bloc « Les absences à venir » écrivait encore « retirée du salaire, au prorata »
  pour la même absence. Les deux lisent maintenant la même fonction (`effetAbsenceNonPayee`) ; une demande pas encore
  acceptée sur un mois validé dit « à régulariser : son mois est déjà validé ».
- **CABPAIE-2 (bloquant) — « Noter les salaires payés »** se défaisait seulement par le message de huit secondes. Le menu
  d'un bulletin payé d'un dossier tenu au cabinet propose « Annuler le paiement… » (refusé tant que le versement est
  rapproché d'une ligne de relevé, avec le geste qui débloque). Quand la période est validée, la fenêtre le dit AVANT :
  l'écriture de banque va au premier jour ouvert, le bulletin garde son jour. Les écritures d'un dossier hors SkanFact
  sont signées « le cabinet », jamais du prénom d'un client qui n'a rien saisi (brouillard, classeur, historique).
- **CABDECLARER-4 (bloquant) — l'export « pour un contrôle »** annonçait « l'index » même quand il n'y était pas, en HTML
  quand le PDF n'avait pas pu se faire, et taisait un FEC refusé. Le compte rendu dit l'index tel qu'il est (PDF, HTML ou
  rien), le nombre d'écritures du FEC, ou pourquoi il n'y a pas de FEC ; la fenêtre compte ce que le FEC portera (les
  écritures non brouillard) et dit « sans le FEC » quand la case est décochée. Les deux FEC (journal et classeur)
  nomment les comptes par la même fonction.
- Tests : `tests/web/cabinet-paie-regul-1377.test.ts`, `tests/web/cabinet-paie-hors-skanfact.test.ts`,
  `tests/web/declaration-1350.test.ts`.

## 1.387.84 — Les régimes du Cabinet se règlent sans rien taper de technique (issue 12)

- **CABPORTEFEUILLE-2 (bloquant) — Réglages → Mon cabinet → Régimes** demandait un « Identifiant » (un mot court sans
  espace, que personne ne sait inventer) et des échéances annuelles écrites `nom@JJ-MM;…` dans une seule case. Une
  échéance mal écrite était jetée en silence à l'enregistrement, et un régime sans nom disparaissait sans un mot.
  - L'identifiant est **interne** : il ne s'affiche plus. Un régime enregistré garde le sien (c'est lui que la fiche
    d'un client retient) ; un régime neuf le reçoit de son nom, en reprenant celui des trois régimes proposés quand le
    nom est l'un d'eux.
  - Une échéance annuelle se pose par « + une échéance » : un nom, une liste de jours, une liste de mois, et « Retirer »
    sur sa rangée. Le 31 février se refuse sur la case du jour ; une échéance sans nom, sans jour ou sans mois se refuse
    sur sa case ; un régime sans nom aussi, et deux régimes du même nom. Rien n'est enregistré tant qu'un refus tient,
    et la saisie reste là.
  - Les bulles de la visite et l'article d'aide décrivent les nouvelles cases ; l'ancienne forme `nom@JJ-MM` n'est plus
    nommée nulle part.
- Test : `tests/web/barre-cabinet.test.ts` (le 31 février, l'échéance sans nom, le régime sans nom, relu après un
  aller-retour). Preuves : `revue 1.374.0 c` et `d` (ancres mises à jour), `regime-sans-nom-jete-en-silence`.

## 1.387.85 — Au comptoir, le caissier ne crée plus un compte que le serveur jette (issue 7)

- **COLLAB-3 (bloquant)** : sans compte bancaire, la carte proposait au caissier « Créer mon compte bancaire », et au
  commercial « Créer la caisse ». Le formulaire s'ouvrait, se fermait sur « Caisse créée », et rien n'était enregistré :
  les comptes de trésorerie ne s'écrivent que par le propriétaire ou un administrateur, et le serveur jette la partie à
  l'envoi.
  - Les boutons « Créer mon compte bancaire », « Créer la caisse » (panneau du ticket, écran de paiement, caisse
    fermée) et « Créer le compte » de la fenêtre de paiement d'une facture ne se posent que pour qui peut créer un compte.
  - Sinon la phrase dit qui le crée et où : « Ton rôle ne crée pas de compte : <la gérante> le crée dans la Trésorerie.
    En attendant, encaisse en espèces. » (le nom vient de la fiche société, sinon « le propriétaire ou un
    administrateur »). Même chose pour un retour sans compte de caisse.
  - `creerCaisse` et `accountForm` refusent en tête, avant toute saisie, la création comme la modification (le solde
    de départ compris) : « Rien n'a été créé » / « Rien n'a été modifié ». Pour le propriétaire et l'administrateur,
    rien ne change.
  - « Valider » reste grisé pour la carte et le chèque tant que le compte bancaire n'existe pas : c'est la règle du
    moteur. **À DÉCIDER par Skander (option B)** : laisser encaisser la carte « sans compte » à qui ne crée pas de
    compte (le ticket se rattacherait à la banque dès sa création ; un retour par carte resterait refusé d'ici là).
- Test : `tests/web/caissier.test.ts` (Sami, caissier, sans compte bancaire : la phrase, aucun bouton, Valider grisé).
  Preuves : `collab3-bouton-banque-au-caissier`, `collab3-phrase-qui-demande-de-creer`.

## 1.387.86 — La magasinière ne se voit plus proposer ce qu'on lui refuse (issue 7)

- **COLLAB-2 (bloquant)** : le rôle Magasinier n'écrit que le stock (mouvements, inventaires, dépôts, numéros de série),
  pas le catalogue ni les achats. Pourtant « Créer » lui proposait « Article », et la page Stock, sans article suivi,
  lui tendait « + Nouvel article suivi » : la fiche se remplissait et se refusait à l'enregistrement, saisie perdue.
  - « Créer » ne propose une entrée que si sa page se voit ET si le rôle peut FINIR le geste (la partie que l'entrée
    écrit : pièces, achats, catalogue, clients, stock). La caisse garde sa propre porte. La règle vaut pour la liste
    du métier et pour celle qui la complète.
  - Deux gestes rejoignent « Créer » quand un article est suivi : « Mouvement de stock » (M) et « Inventaire » (I).
  - Un « Créer » qui n'a rien à proposer ne se montre plus (ordinateur et téléphone) — jamais au Cabinet, au caissier
    ni en lecture seule, qui ont leur propre bouton ou leur propre phrase.
  - Stock sans article suivi, pour qui n'écrit pas le catalogue : plus de bouton, les trois étapes et « demande-le à
    <la gérante> » ; même règle sur l'onglet « Numéros de série ». « + Mouvement » suit le droit du mouvement.
  - La promesse du rôle (invitation et Aide) dit ce qui s'ouvre vraiment : « mouvements, transferts entre dépôts,
    inventaires, numéros de série ». **À DÉCIDER par Skander** : le cadrage (docs/cadrage/03-droits.md) donnait aussi
    au magasinier la fiche article hors prix, les bons de livraison et les réceptions ; le serveur les refuse. Soit le
    serveur suit le cadrage (les écrans se rouvrent d'eux-mêmes), soit on garde la promesse resserrée.
  - Effet voulu ailleurs : la comptabilité interne ne voit plus Facture, Devis, Article ni Client dans « Créer » (tous
    refusés à l'enregistrement) ; elle garde Photo et Dépense. Propriétaire, administrateur et commercial : inchangés.
- Tests : `tests/web/menu-role.test.ts` (Hela, magasinière d'un commerce). `tests/web/recette-alpha.test.ts` : deux
  assertions remises à jour (la liste des devis dit « Facturé FAC-… » ; l'Aide est dessinée avant le geste du
  défilement — une course du test, pas de l'application). Preuves : quatre `collab2-*`.

## 1.387.87 — « Photo d'une pièce » ouvre le choix du fichier, avec ou sans IA (issue 13)

- **ENTACHATS-1 (bloquant, la moitié qui restait)** : depuis la 1.379.2, la zone « Tu as la photo ou le PDF de la
  facture ? » accepte photo, PDF et XML. Mais l'entrée « Photo d'une pièce » de « Créer » (téléphone ET ordinateur)
  cliquait le bouton de lecture par l'IA : sans IA, rien ne s'ouvrait et on arrivait sur un achat vide ; IA coupée par
  l'entreprise, on arrivait… dans les Paramètres.
  - Le geste ouvre la zone, qui sait tout faire : l'IA proposée se demande, coupée ou absente la pièce se joint et la
    saisie s'ouvre. Avec un cabinet relié, la photo part au cabinet, comme la ligne le promet.
  - La ligne de « Créer » dit ce qui est vrai sans IA : « Jointe à l'achat, tu saisis ».
  - Au doigt, la zone dit « Touche ici pour le choisir » (plus de « ou glisse-le » sur un téléphone).
  - **À VÉRIFIER sur un vrai iPhone** : le choix du fichier s'ouvre 0,4 s après le toucher, sous la limite de Safari.
- Test : `tests/web/complements.test.ts` (au téléphone puis à l'ordinateur, IA éteinte). Preuves : trois
  `entachats1-*`.

## 1.387.88 — Les factures d'avant la 1.379.6 disent le net que le serveur a scellé (issue 15)

- **V-1 (bloquant, ce qui restait)** : une facture émise avant la 1.379.6 sous le seuil de retenue, avec un taux de
  retenue, était scellée sans retenue au serveur (c'est la pièce légale, chaînée, et celle que lit le Cabinet), mais
  l'écran lui recalculait une retenue : net, reste dû, relevé et lettrage de l'entreprise ne disaient pas le chiffre
  scellé (par exemple 950,441 à l'écran pour 964,900 scellés). Cela touchait surtout les factures d'exemple, des
  contrats et de la boutique.
  - Migration `0222_seuil_retenue_pieces_anciennes.sql` : pose sur ces pièces le seuil que le serveur avait appliqué (la
    règle à la date de la pièce). Jamais une pièce dont la retenue scellée est > 0, jamais une pièce qui porte déjà son
    seuil, jamais une pièce sans règle à sa date ; rejouable ; la révision monte pour que les onglets ouverts relisent.
  - L'écran ne juge plus la facture corrigée par un avoir avec le seuil du jour : il la prend telle qu'elle est. L'ancien
    calcul se trompait sur une facture datée d'avant la règle (sa retenue est scellée) : son avoir partait sans
    retenue et le serveur le refusait.
  - Effet visible : une de ces factures déjà réglée au net « avec retenue » apparaît partielle, avec un reste égal à la
    retenue imprimée. Ce reste existait déjà au serveur et au 411 du Cabinet ; c'est l'écran qui ne le montrait pas.
  - **À DÉCIDER par Skander avec le comptable** : ce reste est-il dû par le client, ou le client a-t-il vraiment
    retenu ce montant (avec une attestation), à passer alors en retenue subie ? Rien n'est bloqué en attendant : le
    gérant peut faire l'un ou l'autre.
  - **À VÉRIFIER** (inchangé) : sur l'avoir d'une facture dont la retenue a été scellée, rembourse-t-on le brut ou le
    net de retenue ?
- Test : `tests/v10/retenue-seuil-1379.test.ts` (une pièce d'avant simulée, une pièce à retenue scellée intacte, la
  migration rejouée). Preuves : `V-1 0222 a/b/c` ; l'ancre de `avoir 1.356.6 a` suit le code.

## 1.387.89 — Deux tests remis d'aplomb avant l'envoi

- Le test des feuilles de « Ton compte » et de « Mon comptable » (1.387.82) lisait `compte.css` et `messagerie.css`
  directement sous `web/public/plateforme` : la règle de l'assemblage (aucun code de Node ne lit un fichier des écrans
  en direct) le refusait. Il passe par `lireEcran`, comme les autres.
- « En grâce, le bouton du bandeau est le seul vert » ne pouvait plus tomber depuis la 1.387.78 : son devis oublié en
  brouillon est une ligne « Quand tu peux », qui n'a plus de vert. Le devis est maintenant accepté et pas facturé
  (« Un geste t'attend ») : sans la grâce, sa ligne serait le vert de l'accueil, et la preuve tombe de nouveau.
- Sept preuves ré-ancrées sur le code du jour (les ancres avaient bougé avec les lots précédents) ; elles tombent toutes.

## 1.387.90 — « Annuler » ne jette plus ce qu'on a tapé (issue 6, CAB-8)

- **CAB-8** : dans « Demander à Sarra » (et dix autres fenêtres du Cabinet : déposer des pièces, joindre un PDF, le
  classeur, l'export…), la croix et « Annuler » étaient reliés deux fois : à la garde de saisie posée par `modal()`, qui
  ouvrait « Abandonner cette saisie ? », puis à `close`, qui fermait la fenêtre aussitôt dessous. La question s'ouvrait
  au-dessus de rien, et ce qu'on venait de taper était perdu. `modal()` retire ce raccourci après le montage : « Annuler »
  vaut Échap partout, il ferme tout seul quand rien n'a été tapé et demande sinon. Aucune des onze fenêtres n'avait de
  rappel de fermeture : rien d'autre ne change.
- Test : taper la pièce dans « Demander à », puis la croix et « Annuler » : chaque fois la question, « Annuler » garde la
  fenêtre et le texte. Preuve : retirer la ligne fait tomber le test.

## 1.387.91 — « Inviter un client… » invite, il ne crée pas de dossier (issue 12, CABPORTEFEUILLE-20)

- **CABPORTEFEUILLE-20** : dans Messages, « Inviter un client… » ouvrait la création d'un dossier — un dossier de plus,
  qui se paie — alors que l'invitation se fait sur la fiche d'un client déjà tenu au cabinet. Un seul client tenu : sa
  fiche s'ouvre à l'invitation, le curseur dans l'adresse. Plusieurs : « Quel client inviter ? » les liste (avec une
  recherche au-delà de six), et « Un nouveau client… » reste possible. Aucun : la création, comme avant.
- Test : le cabinet neuf, un client tenu, « Inviter un client… » mène à sa fiche, le curseur dans l'adresse, aucune
  fenêtre. Preuve : remettre la création fait tomber le test.

## 1.387.92 — Les modèles de l'équipe servent là où on écrit à un client (issue 12, CABPORTEFEUILLE-21)

- **CABPORTEFEUILLE-21** : les modèles de messages ne servaient que dans la conversation SkanFact. « Écrire à… » et
  « Relancer… » (par WhatsApp, e-mail, copie ou la messagerie) proposent maintenant « Partir d'un modèle… » : le modèle
  choisi remplace le message, rempli pour ce client — `{client}` son prénom (le nom du dossier sans contact), `{mois}` les
  mois relancés (le mois passé pour un simple mot) — et se relit avant de partir.
- « de {mois} » s'élide devant une voyelle : « ta déclaration d'octobre 2026 », jamais « de octobre ». La règle vit dans
  la messagerie partagée : « Mon comptable », côté entreprise, en profite aussi.
- Reste (finition) : l'aperçu du modèle montre encore `{client}` tel quel quand aucun client n'est choisi.
- Test : un modèle de l'équipe posé dans « Écrire à Transports Gabès », rempli, élidé ; `remplir` sur « avril 2026 ».
  Deux preuves : le bouton sans effet, et l'élision retirée.

## 1.387.93 — « Écrire » sur des dossiers tenus : une tournée, plus une coche qui dit non (issue 12, CABPORTEFEUILLE-22)

- **CABPORTEFEUILLE-22** : dans « Tous les dossiers », choisir des dossiers tenus au cabinet puis « Écrire » répondait par
  un message vert (« Les dossiers tenus… n'ont pas de conversation »), alors que chacun s'écrit très bien par WhatsApp ou
  e-mail depuis sa ligne. « Écrire » ouvre maintenant « Écrire à… » pour chacun, l'un après l'autre (« 1 sur 2 »), et
  « Passer » mène au suivant ; Échap arrête la tournée. Un seul dossier tenu : sa fenêtre, directement. Un dossier relié
  dans la sélection : sa conversation, comme avant.
- Test : deux dossiers tenus choisis, la tournée « 1 sur 2 » puis « 2 sur 2 », puis plus rien. Preuve : remettre le
  message vert fait tomber le test.

## 1.387.94 — « Écrire au support » ne part plus à vide (issue 12, CABPORTEFEUILLE-23)

- **CABPORTEFEUILLE-23** : « Défaire une erreur » (Réglages › Tes données) ouvre une demande au support préremplie d'un
  texte à trous (« Le dossier : / Ce qui s'est passé : / Le jour et l'heure… »). Ses libellés seuls passaient la règle des
  trois signes, et l'équipe recevait une demande vide. On compte maintenant ce qui a été écrit DANS les trous : moins de
  dix signes, le refus le dit sur la zone de texte, la fenêtre reste, rien ne part. Côté entreprise, aucun texte à trous :
  rien à changer.
- Test : « Envoyer au support » avec le modèle intact est refusé, la page ne change pas. Preuve : retirer la règle fait
  tomber le test.

## 1.387.95 — Le titre d'une visite qui attend s'écrit une fois ; « Ajouter un client » dit ce qu'il coûte (issue 12, CABPORTEFEUILLE-24)

- **CABPORTEFEUILLE-24** : la bulle « La visite t'attend » rééchappait le titre que la tête de la bulle échappe déjà :
  « Tenir la fiche d'un client » s'affichait « D&#39;UN CLIENT ». Le moteur des visites est partagé : les visites de
  l'app entreprise en profitent aussi. Un test lit chaque appel à la tête de la bulle et refuse qu'on lui passe du texte
  déjà échappé.
- La visite « Ajouter un client » montre, quand la fenêtre l'annonce, que le dossier se paie au-delà de ceux qu'offre
  l'abonnement (étape facultative : elle se saute quand il est offert). Elle citait déjà le vrai libellé « Ajouter un
  client… » (fait en 1.374.0).
- Preuve : remettre le double échappement fait tomber le test.

## 1.387.96 — La barre repliée garde Réglages, Me guider et Aide (issue 12, CABPORTEFEUILLE-26)

- **CABPORTEFEUILLE-26** : repliée, la barre gardait la personne et cachait les trois portes de secours (Réglages ou
  Paramètres, Me guider, Aide) — celles qu'on cherche quand on est perdu. Elles s'empilent maintenant en colonne sous la
  personne, dans les deux applications (la feuille de la barre est partagée).
- Au Cabinet, Relances avait la cloche des Nouvelles : elle a son dessin (une enveloppe qui repart).
- La cloche sans nouvelle ne montre plus « Tout marquer comme lu » ni la phrase des pastilles ; avec des nouvelles, la
  phrase dit ce que « lu » change (la nouvelle se tait, la pastille reste tant que la tâche n'est pas faite).
- Tests : barre repliée, les trois portes visibles dans la barre et Aide qui mène à sa page ; la cloche d'une entreprise
  neuve. Deux preuves.

## 1.387.97 — Ctrl K trouve une pièce reçue (issue 6, CAB-5)

- **CAB-5** : la palette du Cabinet (Ctrl K) cherchait les écrans, les clients, les gestes et l'aide, jamais les pièces,
  alors que les pièces à classer sont déjà lues pour la barre. Elle les trouve maintenant — par la même recherche que la
  page Pièces reçues (nom du fichier, qui l'envoie, son mot, la demande, l'achat, le dossier) — et un clic ouvre CETTE
  pièce dans son dossier, pas la première arrivée. Le champ le dit (« Chercher un client, une pièce reçue… »). Les
  écritures et les pièces déjà classées ne sont pas en mémoire : l'état vide dit où les chercher.
- Test : « agil » trouve « ticket-agil.png », rangée « pièce », et l'ouvre ; un mot qui ne correspond à rien dit où
  chercher une écriture. Deux preuves.

## 1.387.98 — L'invitation de visite ne reste plus sous une fenêtre ; au téléphone elle tient en petit (issue 6, CAB-16)

- **CAB-16** : la bulle « Veux-tu une visite de cette page ? » du Cabinet restait posée quand une fenêtre s'ouvrait par
  dessus (« Ajouter un client… », une relance), et son bouton se lisait derrière le voile. Elle ne s'affiche plus tant
  qu'une fenêtre est ouverte, et toute fenêtre qui s'ouvre la retire. Au téléphone, elle couvrait le haut de la liste :
  elle se réduit à sa question et à ses deux boutons.
- Tests : Entrée sur « Nouveau client » ouvre la fenêtre et l'invitation disparaît ; au téléphone, l'invitation ne
  dépasse pas 130 px. Deux preuves.

## 1.387.99 — « Relié depuis » et « mission depuis » : deux dates, deux mots (issue 6, CAB-14)

- **CAB-14** : la date d'un mandat est le jour où le client a accepté le lien, pas le début de la mission. Messages
  l'annonçait pourtant « tient ta comptabilité depuis le… » (côté client) et « Ton client depuis le… » (côté cabinet), et
  les Paramètres du client « tient tes livres depuis le… », pendant que la fiche du dossier disait « relié » sans date à
  côté de « mission depuis août 2026 ». Partout maintenant : « relié (à ton dossier) depuis le… » pour le lien, « mission
  depuis » pour le début de mission. La fiche porte la date du lien, comme le classeur.
- Tests : la fiche lit « relié depuis MM/AAAA … mission depuis août 2026 » ; Messages et les Paramètres du client lisent la
  nouvelle phrase. Une preuve.

## 1.388.0 — En saisie, la déclaration se lit : la page dit avant le clic à qui reviennent ses gestes (issue 6, CAB-9)

- **CAB-9** : une collaboratrice en « Saisie » sur un dossier voyait la déclaration du mois avec un bouton vert et ses
  quatre gestes (préparer, écrire l'écriture, marquer déposée, marquer payée) allumés — le serveur les refusait tous après
  le clic. La page le dit maintenant AVANT : aucun vert, les quatre boutons éteints avec une bulle (« Leïla le fait : ton
  rôle sur ce dossier te laisse lire la déclaration »), et une phrase au-dessus des boutons qui nomme son rôle et qui
  prépare. Le bandeau du brouillard ne lui dit plus « valide-les d'abord » : il nomme qui valide, et « Voir le brouillard »
  n'est plus vert. Lire, copier les cases et exporter restent ouverts.
- La barre et la page suivent la MÊME règle pour « Déclarer et clôturer » : le droit sur CE dossier, qui prime sur le rôle
  au cabinet (comme au serveur). La barre lisait le rôle au cabinet, la page ne regardait rien. Ouvert par son adresse, le
  groupe reste dans la rangée, pour qu'on sache où l'on est.
- Les refus du serveur nomment les rôles du cabinet comme Réglages › Équipe : « Saisie », « Saisie et validation »,
  « Supervision » (ils disaient « Assistant de saisie », « Collaborateur », « Associé »). Le premier pas « Invite ton
  équipe » cite les trois rôles que propose l'invitation.
- Tests : Rim (saisie) ne voit pas « Déclarer et clôturer », lit la phrase, aucun vert, quatre boutons éteints avec leur
  bulle ; sept tests serveur lisent le nouveau nom du rôle. Quatre preuves.

## 1.388.1 — La comptabilité d'un dossier se navigue une fois : dans la page (issue 6, CAB-15)

- **CAB-15** (décidé) : à l'ordinateur, la comptabilité d'un dossier se naviguait deux fois — dans la barre de gauche (trois
  groupes, puis les écrans du groupe ouvert) et dans la page (les mêmes groupes et écrans en onglets), et le même groupe
  portait deux noms (« Déclarer » dans la barre, « Déclarer et clôturer » dans la page). On garde la navigation de la PAGE :
  elle colle en haut, porte ce qui attend écran par écran, existe au téléphone, et c'est elle que suivent les visites. La
  barre garde une seule entrée, « Comptabilité », qui rouvre l'écran qu'on y avait laissé et dit ce qui attend (« 3 à
  traiter »). Pour un dossier sans livre, la barre listait cinq écrans qui menaient tous à « Commencer le livre » : elle
  n'en promet plus aucun.
- Vérifié à côté : le volet « Tout le dossier » suivait encore l'ancienne règle du rôle pour « Déclarer et clôturer » ; il
  suit le droit sur CE dossier, comme la page et le serveur (CAB-9).
- Test : la barre du dossier ouvert porte cinq entrées, dont « Comptabilité », et aucun groupe ni écran ; un seul lien vers
  la comptabilité visible ; l'entrée dit l'écran ouvert. Une preuve.

## 1.388.2 — « Les miens / Tous » : un seul mot, et une seule bascule à l'ordinateur (issue 6, CAB-10)

- **CAB-10** (décidé) : la même préférence (quels dossiers je regarde) avait quatre commandes et trois mots — la barre
  (« Les miens / Tous »), la tête de page (les mêmes), Messages (« Mes dossiers / Tout le cabinet ») et un texte « Mes
  dossiers » pour un collaborateur. Partout maintenant : « Les miens / Tous », les mots de la barre (les seuls qui tiennent
  dans son titre). À l'ordinateur, barre dépliée, une seule bascule : celle de la barre ; la tête de page ne la répète plus
  et Messages écrit seulement l'état (« Les miens » ou « Tous »). Barre repliée ou au téléphone, Messages reprend sa liste.
- La bascule de la barre remet à zéro ce que remettaient celles des pages (les coches des Relances, « le travail de qui »
  du tableau de bord).
- Seul dans son cabinet, la portée ne trie rien : Messages ne propose plus un choix qui ne faisait rien (« Mes dossiers »
  laissait la liste sur tout le cabinet) et dit « Tous ».
- La vue « Mes dossiers » de Tous les dossiers devient « Les miens » (c'est un filtre de la page, qui montre tout le
  portefeuille).
- Tests : à 1440 px, la barre porte « Les miens / Tous », la tête de page la cache, Messages dit « Les miens » sans sa
  liste ; au téléphone, Messages reprend sa liste ; un associé seul n'a pas de choix. Deux preuves.

## 1.388.3 — De la feuille maîtresse au grand livre du compte (issue 9, CABDECLARER-6)

- **CABDECLARER-6** : réviser un compte, c'est en regarder les lignes. Le menu « Actions » d'un compte de la Révision
  n'offrait que signer, écrire une note et poser une question : aucun chemin vers ses lignes. Il propose « Voir son grand
  livre » : le grand livre de CE compte, sur la période révisée (le mois s'allume dans la frise et la bande « Période » le
  dit), d'où une ligne ouvre son écriture. « ← » ramène à la Révision.
- Test : depuis avril, « Voir son grand livre » ouvre le 532, en avril, avec les agios d'avril ; le retour rend la Révision.
  Une preuve.
