# Les fiches de l'entreprise reprises d'un autre logiciel

*Fait le 19/10/2026 (1.51.0), par délégation (Skander : « go pour la reprise des données d'autre logiciel »). Suit
`docs/cadrage/08-reprise-de-l-existant.md` § 3.1 (les fiches d'abord) et l'étude des formats
`docs/etudes/FORMATS-REPRISE.md`. Les adaptations : `web/v10/reprise-fiches.txt`.*

## En bref (pour Skander)

Une entreprise qui arrive d'un autre logiciel (Hesabi, Sage, Odoo, un tableur) colle ou ouvre sa liste : SkanFact
reconnaissait déjà ses **clients** et son **catalogue** ; il reprend maintenant ses **fournisseurs** (avec leur
banque et leur RIB), la **référence** de chaque article (le code que la douchette lit à la caisse), et les titres de
colonnes qu'Odoo et Sage écrivent. Même fenêtre, mêmes règles : on voit tout avant de cliquer, rien de ce qui est
déjà rempli ne change, et « Annuler » rend tout.

## Les règles

**F1. Une liste de fournisseurs se reprend comme une liste de clients.** Ses colonnes se reconnaissent à leur titre
(celles d'un client, sans celles qui ne nomment qu'un client — « Client », « Customer » —, plus « Fournisseur »,
« Supplier », « Vendor ») ou, sans titres, à leur contenu (un email, un matricule, un RIB à ses vingt chiffres) ;
s'y ajoutent la **banque** et le **RIB**. Un fournisseur se reconnaît à son matricule, sinon à son nom (la règle des
clients, `memeClient`) : un doublon de la liste ne passe pas deux fois ; une fiche qui existe déjà se **complète**
(ses cases vides seulement, la banque et le RIB compris) ; une ligne sans nom se refuse, nommée. Un RIB qui n'a pas
les vingt chiffres d'un RIB tunisien se garde tel quel (un IBAN étranger) et se dit **avant** le clic. Un tarif
collé dans la fenêtre des fournisseurs se reconnaît, comme dans celle des clients. Le fournisseur importé naît du
même modèle vierge que sa fiche (`fournisseurVierge`).

**F2. Une référence d'article se reprend, et décide.** « Référence », « Référence interne », « Code article »,
« SKU », « Code-barres », « EAN »… (titre exact seulement : « Code TVA » n'en est pas une). Deux articles qui ont
chacun une référence sont le même **si et seulement si** elle est la même — deux « T-shirt » M et L restent deux
articles, et une même référence est le même article quelle que soit sa désignation ; sans référence d'un côté, la
désignation décide (comme avant). Un article qui n'avait pas de référence prend celle de la liste.

**F3. Les titres d'autres logiciels se reconnaissent.** Odoo en anglais : « Display Name », « Street2 » (en français,
« Nom affiché » et « Rue 2 » se lisaient déjà par leurs mots) ; « Unité de mesure », « Quantité disponible » ; Sage : « N° identifiant » ; un coût moyen pondéré (« PMP », « CUMP ») est un coût de
revient. Ces titres viennent de la documentation des logiciels, pas encore d'un fichier réel (**À VÉRIFIER** sur
l'export d'un pilote). Les exports de Hesabi, Swiver et des logiciels tunisiens installés attendent des fichiers réels des
pilotes (**À VÉRIFIER**, 08 § 3.2).

**F4. Le geste se refuse avant, pour qui ne peut pas écrire.** Un rôle qui lit seulement les fournisseurs (ou les
clients, ou le catalogue) voit l'import refusé au clic, avec la phrase de la brique 102, au lieu d'un « importé »
que le serveur n'aurait pas reçu ; un nouveau fournisseur passe par le garde-fou de l'offre, comme sur sa fiche.

**Ce qui part au serveur** : rien de neuf — les fiches, comme si elles avaient été tapées (`suppliers`, `catalog`,
`clients` du dossier).

**Ce qui reste** : les factures encore ouvertes d'un autre logiciel (un impayé repris sans être réémis, hors
numérotation et hors TVA : un modèle à décider avec un comptable, **À VÉRIFIER**) ; l'historique d'un FEC dans le
livre du Cabinet (R2).

**Les tests** : `tests/v10/reprise-fiches.test.ts` (fournisseurs, RIB sans titres, tarif dans la mauvaise fenêtre,
références, titres d'Odoo et de Sage) ; à la souris `tests/web/fournisseurs-tableur.test.ts` (la page vide, l'aperçu,
l'import, le serveur champ par champ, « Annuler »).
