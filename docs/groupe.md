# Le tableau de bord du groupe (brique 113, 01/10/2026)

**Pourquoi** : 14 § 3.6 (« les chiffres de toutes les sociétés d'un groupe, dans la devise de base », au lancement) ;
13, cible n° 6 (les groupes de sociétés : plusieurs matricules, les mêmes personnes).

**Ce que voit la personne** : depuis le menu des entreprises (« Le groupe », dès deux sociétés), ses sociétés côte à
côte. Pour chacune : le chiffre d'affaires hors taxes du mois et de l'exercice en cours, ce que les clients doivent
encore, ce qui reste à payer aux fournisseurs, la trésorerie ; puis le total. Le nom d'une société l'ouvre.

**D'où viennent les chiffres** (`serveur/groupe.ts`, `GET /v1/moi/groupe`) : des livres de chaque société, au serveur,
brouillard compris, comme la balance : comptes 70 (chiffre d'affaires, crédit moins débit), 411 (clients, débit moins
crédit), 401 (fournisseurs, crédit moins débit), classe 5 (banque et caisse). L'exercice commence le 1er du mois de
début de la société. Le test compare chaque chiffre à la balance de la société (deux chemins, un chiffre).

**Les règles** :
- une société dont le rôle de la personne ne montre pas les livres (`compta.livres.voir`) est nommée sans ses chiffres,
  avec la phrase de la porte ; elle ne compte pas dans le total ;
- deux devises ne s'additionnent pas : un total par devise ;
- ni l'entreprise d'essai (ce ne sont pas des données) ni une société vue seulement par le mandat d'un cabinet.

**Pas encore** : la consolidation (ventes entre sociétés du groupe éliminées) et les fiches partagées entre sociétés
viennent avec le groupe complet, en vague 4 (14 § 3.6). Un total qui additionne deux sociétés qui se facturent
l'une l'autre compte deux fois ces ventes : la page ne dit pas « consolidé ». **À VÉRIFIER** avec un comptable : la
présentation attendue d'un groupe tunisien.

Tests : `tests/socle/groupe.test.ts` (serveur), `tests/web/groupe.test.ts` (à la souris, ordinateur et téléphone) ;
5 preuves.
