# Les fichiers des autres logiciels : ce qu'ils exportent, ce que SkanFact en lit

*Étude du 19/10/2026 (demande de Skander : « go pour la reprise des données d'autre logiciel, cherche sur
internet le format qu'il utilise »). Elle suit `docs/cadrage/08-reprise-de-l-existant.md` § 3 : on reprend
l'essentiel d'abord (fiches, ce qui est encore ouvert, soldes d'ouverture), l'historique si on le veut, et
**rien d'inventé**. Ce qui n'est sûr qu'à moitié est écrit **À VÉRIFIER** ; un format réel s'apprend sur un
vrai fichier fourni par un pilote, jamais en devinant (08 § 3.2).*

## En bref (pour Skander)

- **Presque tous les logiciels comptables savent sortir un même fichier : le FEC** (« fichier des écritures
  comptables »). C'est une norme française que Sage, Ciel, EBP, Odoo, Dolibarr et Hesabi suivent. Il contient
  **toutes les écritures d'un exercice**, ligne par ligne, avec les comptes, les clients et fournisseurs, les
  montants et le lettrage. C'est la porte d'entrée la plus sûre pour un cabinet qui quitte son logiciel.
- **Depuis la 1.50.0, le Cabinet lit un FEC** pour reprendre les soldes d'ouverture d'un client : il calcule
  les à-nouveaux par la même règle que la clôture de SkanFact, recompte chaque compte d'une seconde façon, et
  montre un rapport avant de toucher à quoi que ce soit (`docs/cabinet.md`, C61).
- **Les logiciels de gestion commerciale tunisiens** (Hesabi, Swiver, Megasoft…) exportent surtout des
  **tableurs Excel** de clients, de produits et de factures, chacun avec ses colonnes. SkanFact reconnaît déjà
  les colonnes d'un tableur par leur titre ; il faudra des fichiers réels des pilotes pour les apprendre tous.
- **Sage 100 a son propre format** (fichiers « PNM »), non publié : on ne le lira qu'avec des fichiers réels.
  Sage sait de toute façon exporter un FEC.

## 1. Le FEC

**Le texte** : article A47 A-1 du livre des procédures fiscales (français) et arrêté du 29 juillet 2013 ;
commentaires de l'administration au BOFiP (leur référence exacte : **À VÉRIFIER**). Il ne s'impose pas en Tunisie, mais les
logiciels vendus ici (Sage, Ciel, EBP, Odoo) le savent produire, et la v10 l'écrit déjà (H3).

**Sa forme** (ce que SkanFact lit, `web/public/plateforme/fec.js`) :

| | Ce que dit le texte | Ce que SkanFact accepte |
|---|---|---|
| Lignes | une ligne de titres, puis une ligne par ligne d'écriture | la même chose ; les lignes vides se sautent |
| Séparateur | tabulation ou barre verticale « \| » | les deux, et le point-virgule d'un FEC repassé par un tableur (un libellé entre guillemets garde son séparateur) |
| Colonnes | 18, dans un ordre fixé | reconnues **par leur nom**, jamais par leur rang : Dolibarr en écrit 21, d'autres en ajoutent |
| Dates | AAAAMMJJ | AAAAMMJJ, et aussi AAAA-MM-JJ ou JJ/MM/AAAA (un tableur les réécrit) ; un jour qui n'existe pas se refuse |
| Montants | Debit et Credit, ou Montant et Sens (D/C) (**À VÉRIFIER** dans le texte même) | les deux formes ; virgule ou point décimal ; plus de trois décimales qui comptent se refusent |
| Encodage | UTF-8, ISO 8859-15 ou ASCII selon les sources (**À VÉRIFIER**) | UTF-8, sinon Windows-1252 (le lecteur partagé de la v10) : le « € » d'un fichier ISO 8859-15 s'y lit « ¤ », dans un libellé seulement |

**Les 18 colonnes**, dans l'ordre du texte : JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum,
CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet,
ValidDate, Montantdevise, Idevise. SkanFact exige JournalCode, EcritureNum, EcritureDate, CompteNum et les
montants ; il se sert aussi de CompteLib (le libellé de la ligne d'ouverture), CompAuxNum et CompAuxLib (le
tiers), PieceRef et EcritureLet (le lettrage).

**Ce que chaque logiciel en fait** (lu dans leur code ou leur documentation) :
- **Odoo** (module `l10n_fr_fec`) : barres verticales, virgule décimale, ses à-nouveaux dans un journal
  d'ouverture (« OUV ») daté du premier jour. Odoo sait aussi **lire** un FEC (`l10n_fr_fec_import`).
- **Dolibarr** (`htdocs/accountancy/class/accountancyexport.class.php`) : tabulations, 21 colonnes (s'y
  ajoutent DateLimitReglmt, NumFacture, FichierFacture), point décimal.
- **Sage 100** : « Fichier › Exporter › Format trésorerie Sage, Ciel et FEC » (**À VÉRIFIER** sur une version
  récente) ; son format natif PNM n'est pas publié.
- **Ciel, EBP** : exportent un FEC (obligation française) ; leurs formats d'échange propres sont décrits au § 3.
- **Hesabi** : exporte un FEC en UTF-8 sur ses offres payantes (Pro et plus), selon sa page de fonctions
  (**À VÉRIFIER** sur un fichier réel).

**Les à-nouveaux** : chaque logiciel les range dans son journal d'ouverture, sous son propre code — AN, RAN,
ANO, OUV, « À nouveaux », « Reports à nouveau ». SkanFact reconnaît ces codes et ces libellés, et le rapport
nomme le journal qu'il a pris.

**Les comptes de tiers** : normalement le compte collectif (411, 401) dans CompteNum et le client dans
CompAuxNum/CompAuxLib. Un logiciel sans comptes auxiliaires écrit parfois « 411DUPONT » dans CompteNum :
SkanFact le range sur 411, au nom du tiers, et le rapport le dit.

## 2. Ce que SkanFact en fait (1.50.0) : la balance d'ouverture

Le comptable ouvre « Commencer le livre » (ou « Reprendre les soldes d'ouverture ») et choisit le FEC du
dernier exercice de son client. Les règles (`docs/cabinet.md`, C61) :
1. **Tout se lit, ou rien n'est repris** : une ligne illisible refuse le fichier, nommée avec son numéro.
2. **Un seul exercice avant le premier jour** : deux années additionnées compteraient deux résultats.
3. **La règle de la clôture** : les classes 1 à 5 se reportent, le net des classes 6 et 7 va au compte 13
   (résultat de l'exercice, plan comptable tunisien), un client ou un fournisseur non soldé rouvre sur sa
   propre ligne avec son nom — exactement ce que SkanFact pose à la clôture d'un exercice.
4. **Deux calculs, un chiffre** : chaque compte se recompte en millimes sur le fichier ; un écart d'un millime
   refuse la reprise.
5. **Un rapport avant tout** : la période, les écritures, le total, la balance qui sera reprise, le résultat,
   ce qui n'est pas pris (les mouvements du nouvel exercice) ; « Annuler » ne touche à rien.
6. **Rien ne part au serveur** avant « Créer le livre » : seules les lignes de la balance (compte, libellé,
   tiers, débit, crédit).

**Ce qui reste à faire** (dans cet ordre) :
- **R2 — l'historique d'un FEC** : fait en 1.52.0 (`docs/cabinet.md` C62) : les écritures de l'exercice entrent
  au brouillard, les journaux traduits vers ceux de SkanFact ; restent les fiches de tiers d'un dossier sur SkanFact
  (CompAuxNum) et la marque d'origine de ces écritures (**À VÉRIFIER** avec un comptable pilote).
- **R3 — l'entreprise** : les fournisseurs par tableur, la référence des articles et les titres d'Odoo et de Sage
  sont faits en 1.51.0 (`docs/reprise-fiches.md`) ; restent les titres de Hesabi (un export réel) et les factures
  encore ouvertes (un modèle à décider avec un comptable).
- **Les formats propres** (§ 3) : seulement quand un pilote en apporte un.

## 3. Les autres formats rencontrés

| Logiciel | Format | Ce qu'on en sait | Décision |
|---|---|---|---|
| Ciel (Sage 50) | XIMPORT.TXT : largeur fixe, sans titres, CRLF ; numéro de pièce, journal, dates, compte, libellé, montant, sens D/C | sa disposition exacte est écrite dans le code de Dolibarr (`exportCiel`) | pas avant un fichier réel : Ciel sait sortir un FEC |
| EBP | texte séparé par des virgules, sans titres : ligne, date JJMMAAAA, journal, compte, libellé, pièce, montant, sens | écrit dans le code de Dolibarr (`exportEbp`) | idem |
| Quadratus | largeur fixe, enregistrements « M » (montant en centimes) et « C » | documenté par Dolibarr | idem |
| Sage 100 | PNM/PNC natifs ; un « format paramétrable » depuis la v9 | non publié | **À VÉRIFIER** sur un fichier réel |
| Hesabi | import et export Excel/CSV (clients, fournisseurs, produits, factures, achats), colonnes reconnues ; doublons repérés par matricule fiscal, référence ou numéro ; FEC en UTF-8 | sa documentation publique ; les noms exacts des colonnes ne sont pas publiés | **À VÉRIFIER** : un export réel |
| Swiver | import des clients par un modèle Excel envoyé au support | les colonnes de ses exports ne sont pas publiées | **À VÉRIFIER** |
| Megasoft, Tassaruf, PGPRO, DUX-ERP… | logiciels tunisiens installés, exports Excel le plus souvent | rien de publié | **À VÉRIFIER** auprès des pilotes |

**Le matricule fiscal** (pour reconnaître un client ou un fournisseur repris deux fois) : sept chiffres, une
lettre de contrôle (jamais I, O ni U), puis le code TVA, la catégorie et le numéro d'établissement sur trois
chiffres (`NNNNNNNX/X/X/NNN`) ; la v10 le contrôle déjà.

## Sources

- [La Fabrique du Net — le fichier des écritures comptables, ses 18 champs](https://www.lafabriquedunet.fr/logiciels/tendances/fichier-des-ecritures-comptables-fec)
- [Spendesk — FEC : format, champs, conformité](https://www.spendesk.com/fr/blog/fec-comptable-2026-format-checklist-et-conformite/)
- [Hayot Expertise — structure technique du FEC (séparateur, encodage, dates)](https://hayot-expertise.fr/blog/fec-fichier-des-ecritures-comptables)
- [Dolibarr — la classe d'export comptable (FEC, Ciel, EBP, Quadratus…)](https://www.dolibarr.fr/doxygen/dolibarr_17.0/build/html/d0/d78/accountancyexport_8class_8php_source.html)
- [Dolibarr — le module d'export comptable](https://wiki.dolibarr.org/index.php/Module_AccountingExport)
- [Odoo 17 — localisation française (export et import du FEC)](https://odoo.com/documentation/17.0/fr/applications/finance/fiscal_localizations/france.html)
- [Tryton — module comptable français (journal d'ouverture du FEC, « OUV »)](https://tryton-doc-text.readthedocs.io/en/latest/modules/account/modules-account-fr.html)
- L'étude du marché et celle de Hesabi : `docs/etudes/ETUDE-MARCHE.md`, `docs/etudes/ETUDE-HESABI.md`.
