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

Suivant : la suite de la revue des modules.
