# Revue Saisie et Banque du Cabinet (31/10/2026)

Demande de Skander : « faire une revue de saisie et banque, comparer avec ce que fait la plateforme aujourd'hui et améliorer
en restant dans le métier », avant de passer aux autres écrans de « Saisir » (Paie d'abord).

Comparé : la maquette `comptabilite.html` (états Saisie, Au kilomètre, Banque, Écrire, Ventiler) et le Cabinet de la
plateforme (`web/public/v10/cabinet/app.js` : `vueSaisie`, `brancherSaisie`, `vueBanque`, `brancherBanque`,
`ecrireDepuisBanque`, `releveForm`).

## Verdict

La maquette est en avance sur la plateforme pour la saisie et la banque. Une fois les ajouts ci-dessous faits (le 31/10, dans
la maquette), on a ce qu'il faut pour passer aux autres écrans. **Mais trois points demandent du travail au serveur ou une
décision**, avant d'appliquer la maquette (§ 4).

## 1. Ce que la maquette apporte (la plateforme ne l'a pas)

| Sujet | Plateforme aujourd'hui | Maquette |
|---|---|---|
| Saisir une pièce | Une grille vide (journal, date, pièce, libellé, compte, débit, crédit) ; la pièce du classeur se joint, rien n'est lu | « Face à la pièce » : la photo en grand, la fiche pré-remplie, chaque champ dit d'où il vient (lu, habitude du fournisseur, calculé) |
| Saisir vite une série | La même grille, une pièce à la fois | « Au kilomètre » : le compte du fournisseur et le TTC suffisent, la charge et la TVA se proposent, la pièce se solde seule |
| Une pièce déjà saisie par le client | La pièce reçue est marquée « déjà saisie » dans Pièces reçues | La comparaison « la photo dit / FA-0919 dit », et « Joindre à FA-0919 » d'un geste |
| Le lien avec la banque | Aucun depuis la saisie | « Payée par carte le 24/09 » : la pièce se rapproche de sa ligne du relevé en s'enregistrant |
| Ce qui est proposé | Une ligne de relevé à la fois (« Rapprocher automatiquement », puis chaque ligne) | « Confirmer les 3 proposées » et « Écrire les 2 frais d'après leurs règles », d'un coup |
| Les règles | « Les mots retenus » en bas de page | Les règles dites sur chaque ligne (« Sa règle : 6278… ») et « Gérer les règles » à côté du relevé |
| Le règlement d'un fournisseur avec retenue | L'écriture se fait à la main | « net de la retenue de 27,693 » : la retenue se voit sur la ligne proposée |
| Le compte d'attente | « Demander au client ce qu'est cette ligne » | La ligne au 471, la question en face, « Relancer », puis « Imputer » depuis sa réponse |

## 2. Ce que la plateforme fait déjà et que la maquette avait oublié

À garder tel quel en appliquant la maquette (ajouté à la maquette le 31/10 quand ça se voit à l'écran) :

- **Le chèque émis pas encore payé dans l'écart** (« Les suspens », côté livre) : ajouté (CHQ 0041207, Hygiène Plus,
  245,000 DT ; relevé + sans écriture − chèque = livre, vérifié par la page).
- **Plusieurs comptes en banque**, un relevé par compte (le choix du relevé) : ajouté (« 532 BIAT ▾ », 2 comptes).
- **Les guides d'écritures** (loyer, Z de caisse, emprunt, paie : le montant suffit) : ajouté (« Guides 4 » au brouillard).
- Sans changement visible, à garder : la date proposée, Tab / Entrée / Solder / Recopier / Dupliquer / Valider (touches
  réglables) ; le refus qui se lit avant le bouton ; un compte neuf qui se nomme en italique ; la pièce commencée pour un
  autre dossier qui se gare ; le bandeau « ce mois est déjà déclaré » ; l'exercice clos ; les écritures datées après
  aujourd'hui ; la saisie sans réseau (« attend le réseau ») ; la validation par lot (par journal, par mois) ; « Reprendre
  dans la grille » ; contre-passer et extourner ; « Choisir l'écriture en face », « Défaire le rapprochement », « Défaire
  tous les rapprochements », « Retirer ce relevé » ; le doublon de relevé reconnu à l'import.

## 3. Ce qui manquait aux deux, côté métier

Ajouté à la maquette le 31/10 :

1. **Une ligne de la banque, plusieurs pièces** : une remise de 3 chèques (1 342,500 DT) se ventile sur trois factures
   ouvertes qui font la somme au millime, chaque chèque lettre sa facture (état « Banque : une remise de 3 chèques »).
2. **Les frais bancaires avec leur TVA** : la règle « FRAIS TENUE » ventile 6278 + 4366 (À VÉRIFIER : la TVA des
   commissions bancaires et sa déductibilité).
3. **L'état de rapprochement à imprimer** (PDF) pour le dossier de révision.

À ajouter en appliquant (pas encore dessinés) :

4. **Une règle plus fine qu'un mot** : le sens (débit ou crédit), une fourchette de montant, la TVA et le journal ; avant
   d'enregistrer une règle, « elle s'appliquerait à N lignes d'avant ».
5. **Le numéro de la pièce d'un fournisseur déjà saisi** (même fournisseur, même numéro) : averti à la saisie, avant le geste.
6. **Le timbre fiscal et la FODEC** dans « Au kilomètre » quand la pièce les porte (comptes À VÉRIFIER).
7. **Une pièce en devises** (une facture en euros) : le taux du jour, et la différence de change au règlement (À VÉRIFIER).

## 4. Ce qui demande le serveur ou une décision

- **La lecture des pièces au Cabinet** (« lue en 3 secondes ») : elle existe côté entreprise (photo d'un achat, avec
  l'accord de l'entreprise), pas côté Cabinet. Lire au Cabinet envoie les pièces du client au service de lecture : **c'est
  une donnée de plus qui part vers un serveur**, donc une décision de Skander, et l'accord du client (à demander dans la
  lettre de mission ?).
- **Le relevé en PDF** : la plateforme lit l'Excel et le CSV de la banque. Beaucoup de banques tunisiennes donnent le relevé
  en PDF (À VÉRIFIER, banque par banque). Le lire demande la même lecture que les pièces.
- **Confirmer et écrire en masse** : il faut côté serveur un geste « confirmer ces N propositions » et « écrire ces N lignes
  d'après leurs règles », qui refuse ligne par ligne en nommant la ligne (comme la validation par lot).

## 5. Le rapprochement, un système (31/10/2026)

Skander : un comptable lui a dit « si tu veux que ton logiciel marche, il faut le meilleur système de rapprochement », et
« ce n'est pas qu'un écran, c'est un système implémenté un peu partout ». Dessiné dans la maquette (états « Banque : le mode
rafale » et « Banque : septembre rapproché ») :

- **Trouver seul presque tout** : le règlement net de retenue à la source, une ligne pour plusieurs factures (remise de
  chèques), plusieurs lignes pour une facture, les petits écarts (frais, arrondi) avec leur écriture ; pour un dossier relié,
  tout ce que le client encaisse ou paie dans SkanFact est déjà une écriture. Chaque proposition dit **pourquoi**.
- **Le mode rafale** : une ligne à la fois, en grand ; une touche par geste (Entrée valider et lettrer, E écrire autre chose,
  Q demander au client, A compte d'attente, → plus tard) ; la barre se remplit ; la fin le dit, et l'état de rapprochement
  s'imprime. Au téléphone, la carte passe sur une colonne et les boutons prennent la largeur.
- **Partout** : valider passe la pièce « payée » chez le client, solde le fournisseur, lettre, fait avancer la frise du mois et
  le Tableau de bord du cabinet ; une règle ne se crée jamais sans le comptable, et dit à combien de lignes d'avant elle aurait
  servi.
- **La question au client** : les lignes inconnues du mois partent en un seul message ; il répond d'un toucher (un client,
  un prêt, un apport, autre) et l'écriture se passe d'elle-même.
- À construire au serveur : les correspondances à plusieurs pièces et nettes de retenue, le score et le « pourquoi », les
  gestes en masse, la réponse d'un toucher côté entreprise. Les taux de retenue : À VÉRIFIER.
