  // ---------- la paie (10.3.0, déménagée de core.js) ----------
  // Le moteur de paie prend un SALARIÉ et une SAISIE, jamais `data` : il était du mauvais côté
  // depuis la 5.0.0 (règle de découpage de la 9.1.0, relue dans les deux sens en 9.6.1). Le Cabinet
  // en a besoin pour tenir la paie des dossiers qui ne sont PAS sur SkanFact — un cabinet a soixante
  // clients dont deux utilisent SkanFact — et il ne charge pas core.js. La seule alternative était
  // la recopie ; core.js le réexporte à l'identique, et un test compare les OBJETS, jamais leurs
  // résultats (9.6.1).
  //
  // Les trois principes de la 5.0.0 ne bougent pas : aucun taux n'est écrit en dur dans un calcul,
  // les valeurs livrées sont INDICATIVES (« À VÉRIFIER avec le comptable »), et un bulletin garde
  // une COPIE de ce qui a servi à le calculer.

  // H4 (10.15.0) — le contrat SAISONNIER et le CIVP, qui a pris la suite du SIVP. La clé `sivp` reste :
  // des salariés la portent, et un contrat en cours garde le nom sous lequel il a été signé.
  const CONTRACT_TYPES = [
    ['cdi', 'CDI — contrat à durée indéterminée'],
    ['cdd', 'CDD — contrat à durée déterminée'],
    ['saisonnier', 'Saisonnier — contrat pour une saison ou une campagne'],
    ['civp', 'CIVP — contrat d\'initiation à la vie professionnelle'],
    ['sivp', 'SIVP (ancien dispositif) — stage d\'initiation à la vie professionnelle'],
    ['karama', 'Contrat Karama'],
    ['stage', 'Stage'],
    ['autre', 'Autre']
  ];
  const contractLabel = k => (CONTRACT_TYPES.find(x => x[0] === k) || [, k])[1];

  // Le RÉGIME d'un type de contrat (H4, 10.15.0) : les taux qui s'écartent du barème général pour ce
  // contrat, et l'exonération d'impôt. Un CIVP, un contrat Karama peuvent être exonérés de charges —
  // la règle dépend du dispositif, de l'année et parfois de l'entreprise, donc AUCUNE n'est écrite ici :
  // la table part VIDE (la valeur par défaut d'une règle qu'on ne connaît pas est celle qui ne fait
  // rien, 9.1.1), le comptable la règle une fois, et chaque bulletin de ce contrat la suit. Une case
  // vide veut dire « comme le barème général », jamais zéro. À VÉRIFIER avec le comptable.
  const REGIME_TAUX = [
    ['cnssEmployee', 'CNSS salarié'], ['cnssEmployer', 'CNSS employeur'], ['accidentRate', 'Accident'],
    ['tfpRate', 'TFP'], ['foprolosRate', 'FOPROLOS'], ['solidarity', 'Solidarité']
  ];
  const contratRegle = k => CONTRACT_TYPES.some(c => c[0] === k) && k !== 'cdi';
  function regimeDuContrat(baremes, contrat) {
    const r = (((baremes || {}).regimesContrat) || {})[contrat];
    const out = {};
    if (!r || typeof r !== 'object' || !contratRegle(contrat)) return out;
    REGIME_TAUX.forEach(([k]) => {
      const v = r[k];
      if (v === '' || v == null) return;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 100) out[k] = n;
    });
    if (r.sansIrpp === true) out.sansIrpp = true;
    return out;
  }
  // Le régime en mots, pour le dire là où il agit (l'aperçu d'un bulletin, la fiche du salarié) : un
  // taux qui diffère du barème sans explication se lit comme une erreur de calcul.
  function libelleRegime(regime) {
    const r = regime || {};
    const morceaux = REGIME_TAUX.filter(([k]) => r[k] != null)
      .map(([k, lab]) => `${lab} ${String(r[k]).replace('.', ',')} %`);
    if (r.sansIrpp) morceaux.push('sans IRPP');
    return morceaux.join(', ');
  }
  // Ce qui s'enregistre : les seuls contrats connus, les seuls taux connus, rien de vide. Un régime
  // qui ne change rien n'est pas gardé — il ferait croire au bulletin qu'un régime s'applique.
  function normaliserRegimes(x) {
    const out = {};
    Object.keys(x || {}).forEach(k => {
      const r = regimeDuContrat({ regimesContrat: x }, k);
      if (Object.keys(r).length) out[k] = r;
    });
    return out;
  }

  // Valeurs de départ, toutes modifiables. Régime tunisien, secteur non agricole.
  // À VÉRIFIER avec le comptable : chacune de ces lignes peut changer d'une loi de finances à l'autre.
  const DEFAULT_PAYROLL = {
    // (plateforme) 1.59.0 — les taux d'un journal de paie et d'un état CNSS réels de 2026 (reçus le 19/10/2026,
    // non gardés) : 9,68 % et 17,07 %, soit 26,75 % sur l'état du trimestre. Avant : 9,18 % et 16,57 %. La date
    // où ils ont changé est À VÉRIFIER (une source la donne au 1er janvier 2025, avec l'assurance chômage).
    cnssEmployee: 9.68,        // part salarié
    cnssEmployer: 17.07,       // part employeur
    accidentRate: 0.4,         // accident du travail : dépend de l'activité
    tfpRate: 2,                // taxe de formation professionnelle : 2 % (1 % pour les industries manufacturières) — 9.0.0
    foprolosRate: 1,           // FOPROLOS (logement social) : 1 % de la masse salariale — 9.0.0
    // (plateforme) 1.59.0 — 0,5 % de la base imposable sur le journal réel de 2026 (la loi de finances 2023 l'a
    // ramenée de 1 % à 0,5 % ; reconduite en 2026 : À VÉRIFIER). Elle s'y applique aussi sous 5 000 DT par an.
    solidarity: 0.5,           // contribution sociale de solidarité, en points sur la base imposable
    proRate: 10,               // frais professionnels : % du salaire imposable…
    proCap: 2000,              // …plafonnés à ce montant par an
    headOfFamily: 300,         // déduction annuelle chef de famille
    perChild: 100,             // déduction annuelle par enfant à charge
    maxChildren: 4,
    workedDays: 26,            // jours ouvrables d'un mois complet
    offDays: [0],              // jours chômés de la semaine (0 = dimanche) — semaine de six jours
    leaveDaysPerYear: 18,      // droit annuel à congé payé, en jours ouvrables
    // (plateforme) 1.60.0 — les heures supplémentaires du pointage : les heures d'un mois complet (26 jours de 8 heures),
    // et jusqu'à trois majorations en %, à 0 tant qu'on ne les a pas réglées (aucune n'est écrite d'avance : À VÉRIFIER).
    heuresMois: 208,
    hsMaj1: 0, hsMaj2: 0, hsMaj3: 0,
    // (plateforme) 1.256.0 — la sortie et l'ancienneté (docs/etudes/paie-concurrents.md, points 4 et 5). Rien n'est écrit
    // d'avance : 0 et une liste vide ne font rien, tant que l'entreprise (ou son comptable) ne les a pas réglés. À VÉRIFIER :
    // le Code du travail et la convention collective du secteur.
    convention: '',            // (1.257.0) le nom de la convention collective du secteur ; vide : rien n'est dit réglé
    preavisJours: 0,           // préavis d'une démission ou d'un licenciement, en jours calendaires
    indemniteJoursParAn: 0,    // indemnité de licenciement : jours de salaire par année d'ancienneté
    anciennete: [],            // prime d'ancienneté : [{ ans, taux }] — le taux (en % du salaire de base) de la tranche atteinte
    // (1.257.0) Le pointage tel que la maquette : rien n'est écrit d'avance, une liste vide et 0 ne font rien.
    equipes: [],               // [{ id, nom, debut 'HH:MM', fin 'HH:MM', jours [1..6, 0], pointe 'main'|'pointeuse', minimum }]
    feries: [],                // [{ date 'AAAA-MM-JJ', nom }] : posés « Jour férié » dans la grille, payés (À VÉRIFIER chaque année)
    retenirRetards: false,     // un retard se note toujours ; il ne se retient du salaire que si ce réglage le dit (À VÉRIFIER)
    hsArrondi: 0,              // les heures sup lues à la pointeuse s'arrondissent à l'inférieur à ce pas (minutes) ; 0 : à la minute
    joursAValider: false,       // (1.258.0) le mois ne se valide que quand chaque journée passée l'est ; faux : d'un coup
    retardMinimum: 0,          // un retard lu à la pointeuse compte dès ce nombre de minutes ; 0 : dès la première
    hsPlafondAn: 0,            // plafond d'heures supplémentaires par an : 0, pas de plafond dit (À VÉRIFIER)
    // (1.258.0) Les heures de nuit : une plage ('HH:MM', vide : rien ne se compte) et sa majoration en % (0 : comptées,
    // rien ne s'ajoute au bulletin). La plage légale et la majoration : À VÉRIFIER (Code du travail, convention collective).
    nuitDebut: '',
    nuitFin: '',
    nuitMajoration: 0,
    // Barème IRPP annuel progressif : `upTo` en dinars (null = au-delà), `rate` en %.
    brackets: [
      { upTo: 5000, rate: 0 },
      { upTo: 10000, rate: 15 },
      { upTo: 20000, rate: 25 },
      { upTo: 30000, rate: 30 },
      { upTo: 40000, rate: 33 },
      { upTo: 50000, rate: 36 },
      { upTo: 70000, rate: 38 },
      { upTo: null, rate: 40 }
    ]
  };

  // (plateforme) 1.266.3 — les barèmes de la paie n'étaient pas datés (cadrage 16 § 10.1, point 1) : la CSS de 0,5 % ne
  // vaut que pour 2026 (LF 2026 art. 87 ; Rapporté, À VÉRIFIER). Deux faits datés, lus par l'écran ET le serveur
  // (serveur/v10/paie.ts). Après la fin d'une règle, sans règle suivante posée, le bulletin n'en retient AUCUNE et le dit.
  // Une loi de finances relue AVANCE ces dates (nouvelle version, relue et prouvée) ; un bulletin établi garde son barème.
  const CSS_JUSQU_AU = '2026-12-31';
  const BAREMES_RELUS_JUSQU_AU = '2026-12-31';
  const moisLu = (annee, mois) => { const a = Number(annee), m = Number(mois);
    return Number.isInteger(a) && a > 0 && Number.isInteger(m) && m >= 1 && m <= 12 ? `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-01` : null; };
  // Sans mois (une estimation), rien ne se coupe : seul un bulletin a un mois.
  function cssPoseePour(annee, mois) { const j = moisLu(annee, mois); return j === null || j <= CSS_JUSQU_AU; }
  function baremesNonRelus(annee, mois) { const j = moisLu(annee, mois); return j === null || j <= BAREMES_RELUS_JUSQU_AU ? null : { annee: Number(annee), relusJusquAu: BAREMES_RELUS_JUSQU_AU }; }

  // Impôt annuel sur un revenu imposable, barème progressif par tranches.
  function irppAnnual(base, brackets) {
    const total = Math.max(0, Number(base) || 0);
    let from = 0, tax = 0;
    for (const b of brackets) {
      const to = b.upTo == null ? Infinity : Number(b.upTo);
      // La tranche ne porte que sur la part du revenu comprise entre `from` et `to` — surtout pas sur
      // toute la tranche quand le revenu s'arrête au milieu (c'est l'erreur classique du barème).
      const slice = Math.max(0, Math.min(total, to) - from);
      if (slice > 0) tax += slice * (Number(b.rate) || 0) / 100;
      from = to;
      if (from >= total) break;
    }
    return round3(tax);
  }

  // Le calcul d'un bulletin. `input` porte ce qui varie d'un mois à l'autre :
  // { gross, bonuses:[{label, amount, taxable}], deductions:[{label, amount}], absentDays, workedDays }
  // Retourne TOUT le détail, pour que le bulletin imprimé et l'écran disent exactement la même chose.
  function computePayslip(employee, input, settings) {
    const i = input || {};
    const emp = employee || {};
    // H4 — le régime du contrat remplace les taux qu'il fixe, et eux seuls. L'app entreprise nomme le
    // champ `contract`, le Cabinet `contrat` : le moteur lit les deux.
    const contrat = String(emp.contract || emp.contrat || 'cdi');
    const regime = regimeDuContrat(settings, contrat);
    const s = { ...(settings || DEFAULT_PAYROLL), ...regime };
    // (plateforme) 1.266.3 — la CSS s'arrête avec sa règle, quel que soit son taux (livré, réglé, régime) ; le mois vient
    // de la saisie. `s` est un objet neuf : les taux et le barème figés disent 0, et le serveur recalcule la même chose.
    const cssFinie = Number(s.solidarity) > 0 && !cssPoseePour(i.year, i.month);
    if (cssFinie) s.solidarity = 0;
    const baseGross = round3(Number(i.gross != null ? i.gross : emp.grossSalary) || 0);
    const workedDays = Number(i.workedDays) || 26;      // jours ouvrables du mois, modifiable
    const absent = Math.max(0, Number(i.absentDays) || 0);
    // Absence non rémunérée : le brut est réduit au prorata des jours.
    // (plateforme) 1.62.0 — au taux journalier du salaire du CONTRAT : le mois d'une entrée ou d'une sortie, le brut est
    // déjà proratisé (`prorata`), et l'absence s'en retirait encore au prorata (650 × 2 / 26 au lieu de 1 300 × 2 / 26 :
    // 50 de trop). Un brut retouché à la main n'est plus proratisé : l'absence se retire de lui.
    const brutDuMois = i.prorata && Number(i.prorata.brutFiche) > 0 && round3(Number(i.prorata.brut)) === baseGross
      ? round3(Number(i.prorata.brutFiche)) : baseGross;
    const absenceCut = absent > 0 && workedDays > 0 ? round3(brutDuMois * absent / workedDays) : 0;

    const bonuses = (i.bonuses || []).map(b => ({ label: b.label || 'Prime', amount: round3(Number(b.amount) || 0), taxable: b.taxable !== false }));
    const taxableBonus = round3(bonuses.filter(b => b.taxable).reduce((a, b) => a + b.amount, 0));
    const freeBonus = round3(bonuses.filter(b => !b.taxable).reduce((a, b) => a + b.amount, 0));

    const gross = round3(baseGross - absenceCut + taxableBonus + freeBonus);
    const cnssBase = round3(baseGross - absenceCut + taxableBonus);   // les primes non imposables sont hors assiette
    const cnssEmployee = round3(cnssBase * (Number(s.cnssEmployee) || 0) / 100);

    // Base imposable mensuelle → annualisée pour appliquer le barème, puis ramenée au mois.
    const afterCnss = round3(cnssBase - cnssEmployee);
    const annualAfterCnss = round3(afterCnss * 12);
    const pro = round3(Math.min(annualAfterCnss * (Number(s.proRate) || 0) / 100, Number(s.proCap) || 0));
    const children = Math.min(Number(emp.children) || 0, Number(s.maxChildren) || 0);
    const family = round3((emp.headOfFamily ? (Number(s.headOfFamily) || 0) : 0) + children * (Number(s.perChild) || 0));
    const annualTaxable = round3(Math.max(0, annualAfterCnss - pro - family));
    const irppYear = regime.sansIrpp ? 0 : irppAnnual(annualTaxable, s.brackets || DEFAULT_PAYROLL.brackets);
    const irpp = round3(irppYear / 12);
    const css = round3(annualTaxable * (Number(s.solidarity) || 0) / 100 / 12);

    const deductions = (i.deductions || []).map(d => ({ label: d.label || 'Retenue', amount: round3(Number(d.amount) || 0) }));
    const otherDeductions = round3(deductions.reduce((a, d) => a + d.amount, 0));

    const net = round3(gross - cnssEmployee - irpp - css - otherDeductions);
    const cnssEmployer = round3(cnssBase * (Number(s.cnssEmployer) || 0) / 100);
    const accident = round3(cnssBase * (Number(s.accidentRate) || 0) / 100);
    // 9.0.0 : la TFP et le FOPROLOS sont des taxes patronales sur la masse salariale, déclarées
    // chaque mois avec la TVA. Elles entrent dans le coût employeur, jamais dans le net.
    const tfp = round3(cnssBase * (Number(s.tfpRate) || 0) / 100);
    const foprolos = round3(cnssBase * (Number(s.foprolosRate) || 0) / 100);
    const employerCharges = round3(cnssEmployer + accident + tfp + foprolos);
    const employerCost = round3(gross + employerCharges);

    return {
      baseGross, absenceCut, absentDays: absent, workedDays,
      bonuses, taxableBonus, freeBonus, gross,
      cnssBase, cnssEmployee, afterCnss, pro, family, children,
      annualTaxable, irppYear, irpp, css,
      deductions, otherDeductions, net,
      cnssEmployer, accident, tfp, foprolos, employerCharges, employerCost,
      // (plateforme) 1.62.0 — le salaire d'un mois complet sur lequel l'absence s'est retirée : le serveur le relit.
      brutDuMois,
      // Le régime appliqué est FIGÉ avec le calcul (5.0.0) : changer la table plus tard ne réécrit
      // pas un bulletin remis, et le bulletin dit pourquoi ses taux diffèrent du barème.
      contrat, regime: Object.keys(regime).length ? regime : null,
      rates: {
        cnssEmployee: Number(s.cnssEmployee) || 0, cnssEmployer: Number(s.cnssEmployer) || 0,
        accidentRate: Number(s.accidentRate) || 0, solidarity: Number(s.solidarity) || 0,
        tfpRate: Number(s.tfpRate) || 0, foprolosRate: Number(s.foprolosRate) || 0
      },
      // (plateforme) Le barème ENTIER de ce calcul et la situation du salarié ce mois-là : le bulletin
      // les garde, et le serveur le recalcule avec eux.
      bareme: {
        cnssEmployee: Number(s.cnssEmployee) || 0, cnssEmployer: Number(s.cnssEmployer) || 0, accidentRate: Number(s.accidentRate) || 0,
        tfpRate: Number(s.tfpRate) || 0, foprolosRate: Number(s.foprolosRate) || 0, solidarity: Number(s.solidarity) || 0,
        proRate: Number(s.proRate) || 0, proCap: Number(s.proCap) || 0, headOfFamily: Number(s.headOfFamily) || 0,
        perChild: Number(s.perChild) || 0, maxChildren: Number(s.maxChildren) || 0, sansIrpp: !!regime.sansIrpp,
        brackets: (s.brackets || DEFAULT_PAYROLL.brackets).map(b => ({ upTo: b.upTo == null ? null : Number(b.upTo), rate: Number(b.rate) || 0 }))
      },
      situation: { headOfFamily: !!emp.headOfFamily, children: Number(emp.children) || 0 },
      ...(cssFinie ? { cssFinie: CSS_JUSQU_AU } : {})
    };
  }
  // Les charges patronales d'un bulletin, telles qu'il les a FIGÉES (5.0.0) : un bulletin d'avant la
  // 9.0.0 n'a ni TFP ni FOPROLOS, et ne doit pas en gagner après coup.
  const employerChargesOf = c => round3((Number(c.cnssEmployer) || 0) + (Number(c.accident) || 0) + (Number(c.tfp) || 0) + (Number(c.foprolos) || 0));


  // La fusion des barèmes, pure : les valeurs livrées, écrasées par ce que l'utilisateur a réglé.
  // `core.payrollSettings(data)` l'appelle puis ajoute la TFP PROPOSÉE par le métier (9.1.1), qui
  // demande `data.company` — c'est la moitié qui reste du côté de l'entreprise.
  function baremesPaie(reglages) {
    const s = reglages || {};
    return {
      ...DEFAULT_PAYROLL, ...s,
      brackets: Array.isArray(s.brackets) && s.brackets.length ? s.brackets : DEFAULT_PAYROLL.brackets
    };
  }

  // ---------- la paie d'un DOSSIER du cabinet (10.3.0) ----------
  //
  // Ce que le Cabinet ne savait pas faire, et que ses clients lui demandent tous les mois. Un
  // cabinet a soixante clients dont deux utilisent SkanFact : pour les cinquante-huit autres — ceux
  // qui PAIENT — il n'existait aucun moyen de tenir la paie. Le comptable établissait les bulletins
  // ailleurs et retapait l'écriture à la main dans SkanFact Cabinet.
  //
  // Le moteur est celui de l'app entreprise, déménagé juste au-dessus : `computePayslip`. Deux
  // chemins, un seul résultat — c'est la même exigence que la parité des balances (9.1.0).
  //
  // Les comptes proposés suivent l'usage ; À VÉRIFIER. Ils sont surchargeables par le dossier, et
  // aucun numéro de compte n'est une vérité (règle 6.3.0).
  const COMPTES_PAIE = {
    salairesBruts: '640',        // Rémunérations du personnel
    chargesPatronales: '645',    // Charges sociales patronales
    taxesSalaires: '661',        // TFP et FOPROLOS : impôts et taxes sur rémunérations (charge)
    tfpFoprolos: '4335',         // TFP et FOPROLOS à payer (dette envers l'État)
    cnss: '4531',                // CNSS (part salariale + part patronale + accident)
    irpp: '4321',                // IRPP et contribution sociale retenus à la source
    personnel: '425'             // Personnel — rémunérations dues
  };
  const MOIS_PAIE = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const moisPaie = m => MOIS_PAIE[Number(m) - 1] || '';
  const TRIMESTRES_PAIE = [[1, '1er trimestre', [1, 2, 3]], [2, '2e trimestre', [4, 5, 6]],
    [3, '3e trimestre', [7, 8, 9]], [4, '4e trimestre', [10, 11, 12]]];

  // (plateforme) 1.59.0 — les primes de chaque mois, posées sur la fiche du salarié (`primes` : { label, amount,
  // taxable, parJour }). Une prime « au jour » suit les jours payés : le journal de paie réel de septembre 2026 prorate
  // ainsi la prime de présence et celle de transport, arrondies au millime. Une prime fixe passe entière. Le bulletin
  // garde, avec le montant du mois, le montant de la fiche et les jours qui l'ont proratisé (`mensuel`, `jours`, `sur`).
  // (plateforme) 1.68.0 — déménagé de core.js : le Cabinet en a besoin, et une copie diverge. À VÉRIFIER avec le
  // comptable : quelles primes la convention collective proratise.
  function primesDuMois(employee, payes, total) {
    const t = Number(total) || 26;
    const p = Number(payes);
    const j = Number.isFinite(p) ? Math.max(0, Math.min(t, round3(p))) : t;
    return ((employee && employee.primes) || [])
      .filter(x => x && Number(x.amount) > 0)
      .map(x => {
        const mensuel = round3(Number(x.amount) || 0);
        const label = String(x.label || '').trim() || 'Prime';
        return x.parJour
          ? { label, amount: round3(mensuel * j / t), taxable: x.taxable !== false, parJour: true, mensuel, jours: j, sur: t }
          : { label, amount: mensuel, taxable: x.taxable !== false };
      });
  }

  // (plateforme) 1.69.0 — pour le pointage, que le Cabinet tient aussi : les natures de congé (5.1.0) et celles qui sont
  // payées (core.js les reprend : une seule liste), le nombre de jours d'un mois (en UTC pur, règle 5.2.3) et
  // l'identifiant d'un objet du dossier (core.js garde les siens, deux lignes chacun : des essais le chargent sans le
  // moteur commun).
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }   // month 1-12
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  const LEAVE_KINDS = [
    ['conges', 'Congé payé', true],
    ['maladie', 'Arrêt maladie', true],
    ['maternite', 'Congé de maternité', true],
    ['autorisation', 'Autorisation d\'absence', true],
    ['sans-solde', 'Absence sans solde', false],
    ['abandon', 'Absence injustifiée', false]
  ];
  const leaveIsPaid = k => { const f = LEAVE_KINDS.find(x => x[0] === k); return f ? f[2] : true; };
  // (plateforme) 1.70.0 — les congés et absences (5.1.0), déménagés de core.js dans le moteur commun : le Cabinet les
  // saisit pour un dossier tenu, et en montre le solde ; core.js les reprend tels quels. Comme le pointage, ils ne lisent
  // de `data` que la paie (les salariés, les congés, les réglages).
  const leaveKindLabel = k => (LEAVE_KINDS.find(x => x[0] === k) || [, k])[1];
  // Le nombre de jours entre deux jours du calendrier, en UTC pur (règle 5.2.3).
  const joursEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  // Jours ouvrables entre deux dates incluses. `offDays` = jours de la semaine chômés (0 = dimanche).
  // Par défaut le dimanche seul : c'est la semaine de six jours encore courante en Tunisie, et c'est
  // cohérent avec les 26 jours ouvrables du bulletin. À VÉRIFIER avec le comptable.
  function workingDays(fromIso, toIso, offDays) {
    if (!fromIso || !toIso || toIso < fromIso) return 0;
    const off = Array.isArray(offDays) ? offDays : [0];
    // On compte sur des instants UTC, jamais en avançant une chaîne jour par jour : c'est cette
    // boucle-là qui ne finissait jamais dès que l'ordinateur n'était pas réglé en UTC. Et une borne,
    // parce qu'une absence de trente ans est une faute de saisie, pas un calcul à faire.
    const start = Date.parse(fromIso + 'T00:00:00Z'), end = Date.parse(toIso + 'T00:00:00Z');
    if (isNaN(start) || isNaN(end)) return 0;
    const span = Math.min(Math.round((end - start) / 86400000), 366 * 30);
    let n = 0;
    for (let i = 0; i <= span; i++) {
      if (!off.includes(new Date(start + i * 86400000).getUTCDay())) n++;
    }
    return n;
  }

  // Les jours d'un congé qui tombent dans un mois donné : un congé à cheval sur deux mois se répartit
  // entre les deux bulletins, sinon le salarié serait retenu deux fois ou pas du tout.
  function leaveDaysInMonth(leave, year, month, offDays) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = ajouterJoursIso(first, daysInMonth(year, month) - 1);
    const from = leave.from > first ? leave.from : first;
    const to = leave.to < last ? leave.to : last;
    if (to < from) return 0;
    return workingDays(from, to, offDays);
  }

  // (plateforme) 1.226.0 — une demande de congé (la maquette de la paie) : écrite, elle ne compte nulle part (ni solde, ni
  // pointage, ni bulletin) tant qu'elle n'est pas acceptée ; refusée, elle reste écrite avec sa raison et sa date.
  const congeRetenu = l => !l.statut || l.statut === 'accepte';
  function leavesOf(data, employeeId, year) {
    return (data.leaves || [])
      .filter(l => (!employeeId || l.employeeId === employeeId)
        && (!year || (l.from || '').slice(0, 4) === String(year) || (l.to || '').slice(0, 4) === String(year)))
      .map(l => ({ ...l, days: workingDays(l.from, l.to, (data.payrollSettings || {}).offDays),
        // (1.274.0, audit du 04/11/2026, G10) Les jours qui tombent DANS l'année demandée : un congé du 30/12 au 02/01 en
        // compte une part à chaque année, jamais tous ses jours aux deux. Sans année, ce sont tous ses jours.
        joursAnnee: year ? workingDays(l.from > `${year}-01-01` ? l.from : `${year}-01-01`, l.to < `${year}-12-31` ? l.to : `${year}-12-31`, (data.payrollSettings || {}).offDays) : undefined,
        paid: l.paid != null ? l.paid : leaveIsPaid(l.kind), kindLabel: leaveKindLabel(l.kind), retenu: congeRetenu(l) }))
      .sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  }

  // Le compteur de congés : acquis au prorata des mois travaillés, moins ce qui a été pris.
  // Le droit annuel se règle dans les barèmes — il dépend de la convention collective.
  function leaveBalance(data, employeeId, year, todayIso) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const emp = (data.employees || []).find(e => e.id === employeeId) || {};
    const t = todayIso || jourDeLInstant(Date.now());
    const y = Number(year) || Number(t.slice(0, 4));
    const start = `${y}-01-01`, end = `${y}-12-31`;
    // Mois effectivement travaillés dans l'année, bornés par l'embauche, la sortie et aujourd'hui.
    const from = emp.hireDate && emp.hireDate > start ? emp.hireDate : start;
    const stop = [emp.endDate || end, end, t > end ? end : t].filter(Boolean).sort()[0];
    const months = stop < from ? 0 : Math.max(0, Math.min(12, Math.round((joursEntre(from, stop) + 1) / 30.4)));
    const perYear = Number(s.leaveDaysPerYear) || 0;
    const acquired = round3(perYear * months / 12);
    const carry = Number((emp.leaveCarry || {})[y]) || 0;
    const list = leavesOf(data, employeeId, y).filter(l => l.retenu);
    const taken = round3(list.filter(l => l.kind === 'conges').reduce((a, l) => a + l.joursAnnee, 0));
    const byKind = {};
    LEAVE_KINDS.forEach(([k]) => { byKind[k] = round3(list.filter(l => l.kind === k).reduce((a, l) => a + l.joursAnnee, 0)); });
    return { year: y, months, acquired, carry, taken, byKind,
      remaining: round3(acquired + carry - taken), perYear, list };
  }

  // ---------- documents du personnel (5.1.0) ----------
  // (plateforme) 1.72.0 — déménagés de core.js dans le moteur commun : le Cabinet imprime aussi l'attestation, le certificat
  // de travail et le solde de tout compte d'un salarié, et une copie diverge. core.js les reprend.
  // (plateforme) 1.223.0 — la maquette de la paie (docs/maquettes/paie.html) : le contrat et son avenant (en PROJET, à
  // signer), l'attestation de salaire (3 derniers mois), l'attestation annuelle de salaires et de retenues, la fin de
  // période d'essai. Les modèles et mentions obligatoires : À VÉRIFIER avec le comptable.
  const HR_DOCS = [
    ['contrat', 'Contrat de travail', 'Le contrat, depuis sa fiche : poste, date d\'entrée, durée, salaire. Un PROJET, à relire et à signer des deux.'],
    ['avenant', 'Avenant au contrat', 'Ce qui change (salaire, poste, date de fin d\'un CDD), depuis sa fiche : un PROJET, daté, signé des deux.'],
    ['attestation', 'Attestation de travail', 'Atteste qu\'une personne fait partie du personnel aujourd\'hui. Demandée par une banque, un bailleur, une administration.'],
    ['certificat', 'Certificat de travail', 'Remis à la fin du contrat. Obligatoire : il indique les dates et l\'emploi occupé, rien d\'autre.'],
    ['salaire', 'Attestation de salaire', 'Son salaire des trois derniers mois établis (brut et net versé) : pour sa banque, un crédit, un loyer.'],
    ['annuelle', 'Attestation de salaires et de retenues', 'Ce qu\'il a gagné dans l\'année et ce qui a été retenu (CNSS, impôt), bulletin par bulletin : pour sa déclaration.'],
    ['essai', 'Fin de période d\'essai', 'Confirmer son poste à la fin de sa période d\'essai, par écrit.'],
    ['solde', 'Solde de tout compte', 'Récapitule ce qui reste dû au départ : salaire du mois, congés non pris, indemnités.']
  ];
  const hrDocLabel = k => (HR_DOCS.find(x => x[0] === k) || [, k])[1];
  // La civilité d'un salarié (1.72.0) : elle précède son nom sur ces documents, et en fait l'accord (« employée »).
  const CIVILITES = [['m', 'Monsieur'], ['f', 'Madame']];

  // (plateforme) 1.72.0 — l'indemnité de congés non pris d'un salarié à son départ : le solde de ses congés au jour de sa
  // sortie (sans sortie, au jour donné), au salaire d'un jour de son dernier bulletin (son brut sur les jours ouvrables d'un
  // mois complet, 26 au barème), à défaut de bulletin de sa fiche. Ce que la fenêtre du solde de tout compte propose ET ce
  // que le document imprime (core.js, `hrDocumentHtml`), dans l'entreprise comme au Cabinet : une fonction, un chiffre. Le
  // document comptait au jour du document et sur le dernier bulletin seul, la fenêtre au jour de la fenêtre et sur la fiche
  // à défaut de bulletin : deux chiffres pour la même ligne. Un solde négatif (des congés pris d'avance) n'indemnise rien.
  // À VÉRIFIER avec le comptable : la base de l'indemnité (le dernier salaire, la moyenne de l'année).
  function indemniteConges(data, employeeId, dateIso) {
    const e = (data.employees || []).find(x => x.id === employeeId) || {};
    const jour = String(e.endDate || dateIso || jourDeLInstant(Date.now()));
    const solde = leaveBalance(data, employeeId, Number(jour.slice(0, 4)), jour).remaining;
    const dernier = (data.payslips || []).filter(p => p.employeeId === employeeId && p.computed)
      .sort((a, b) => (Number(b.year) - Number(a.year)) || (Number(b.month) - Number(a.month)))[0];
    const ouvrables = Number(baremesPaie((data && data.payrollSettings) || {}).workedDays) || 26;
    const journalier = round3((dernier ? Number(dernier.computed.gross) || 0 : Number(e.grossSalary) || 0) / ouvrables);
    const jours = Math.max(0, solde);
    return { solde, jours, journalier, montant: round3(journalier * jours) };
  }

  // Les lignes que le solde de tout compte propose : le salaire du mois, l'indemnité de congés non pris (`cle: 'conges'`, que
  // la fenêtre fait suivre la date tant qu'on n'y touche pas), le préavis, la fin de contrat. Les montants sont à celui qui
  // l'établit : seule l'indemnité de congés se calcule.
  function lignesDuSolde(data, employeeId, dateIso) {
    const ic = indemniteConges(data, employeeId, dateIso);
    const lic = indemniteLicenciement(data, employeeId, dateIso);
    return [
      { label: 'Salaire du mois en cours', amount: 0 },
      { label: `Indemnité de congés non pris (${String(round3(ic.jours)).replace('.', ',')} jour${ic.jours >= 2 ? 's' : ''})`, amount: ic.montant, cle: 'conges' },
      { label: 'Indemnité de préavis', amount: 0 },
      lic ? { label: lic.label, amount: lic.montant, cle: 'licenciement' } : { label: 'Indemnité de fin de contrat', amount: 0 }
    ];
  }
  // (plateforme) 1.256.0 — l'indemnité de LICENCIEMENT : seulement quand le motif de sortie est un licenciement. Les jours
  // de salaire par année d'ancienneté viennent des réglages (0 par défaut : la ligne se dit, à zéro, et dit où se règle le
  // barème) ; les années comptent les mois commencés au douzième (3 ans et 7 mois : 3,58). Le salaire d'un jour est celui de
  // l'indemnité de congés (le dernier bulletin). À VÉRIFIER avec le comptable : le barème du Code du travail et de la
  // convention, les exclusions (faute grave), le plafond.
  function indemniteLicenciement(data, employeeId, dateIso) {
    const e = (data.employees || []).find(x => x.id === employeeId) || {};
    if (e.sortieMotif !== 'licenciement') return null;
    const s = baremesPaie((data && data.payrollSettings) || {});
    const jpa = Number(s.indemniteJoursParAn) || 0;
    const fin = String(e.endDate || dateIso || jourDeLInstant(Date.now()));
    const ans = anneesAnciennete(e, fin);
    let mois = 0;
    if (e.hireDate) { const m = (Number(fin.slice(0, 4)) - Number(e.hireDate.slice(0, 4))) * 12 + Number(fin.slice(5, 7)) - Number(e.hireDate.slice(5, 7)) - (fin.slice(8, 10) < e.hireDate.slice(8, 10) ? 1 : 0); mois = Math.max(0, m - ans * 12); }
    const annees = Math.round((ans + mois / 12) * 100) / 100;
    const ic = indemniteConges(data, employeeId, dateIso);
    const montant = jpa > 0 ? round3(ic.journalier * jpa * annees) : 0;
    const v = n => String(n).replace('.', ',');
    return { jpa, annees, journalier: ic.journalier, montant,
      label: jpa > 0 ? `Indemnité de licenciement (${v(jpa)} j × ${v(annees)} an${annees >= 2 ? 's' : ''})` : 'Indemnité de licenciement (barème à régler dans les réglages de la paie)' };
  }

  // ---------- le pointage (plateforme, 1.60.0) ----------
  // (plateforme) 1.69.0 — déménagé de core.js dans le moteur commun : le Cabinet pointe aussi les salariés d'un dossier,
  // et une copie diverge. L'exception à la règle de ce fichier (une fonction qui prend `data` reste dans core.js) : ces
  // fonctions ne lisent de `data` que la paie (`employees`, `leaves`, `timesheets`, `payrollSettings`), que l'entreprise y
  // tient et que le Cabinet compose dans la même forme. core.js les reprend telles quelles.
  // Une case par salarié et par jour. Les codes : P présent, D demi-journée (la moitié non payée), A absent non payé,
  // C congé payé, M maladie, F férié, R repos ; « - » hors contrat (avant l'entrée, après la sortie), qui ne se pointe
  // pas. Une maladie et un férié sont payés, comme les congés de la v10 (`leaveIsPaid`). À VÉRIFIER avec le comptable.
  const CODES_POINTAGE = [['P', 'Présent'], ['D', 'Demi-journée'], ['A', 'Absent, non payé'], ['C', 'Congé payé'],
    ['M', 'Maladie'], ['F', 'Jour férié'], ['R', 'Repos']];
  // Un jour de repos de la semaine se pointe « Repos », ou « Présent » s'il a été travaillé (ses heures se paient en
  // heures supplémentaires) : il n'est ni payé ni retiré du mois complet.
  const CODES_REPOS = ['R', 'P'];
  const libellePointage = code => code === '-' ? 'Hors contrat' : (CODES_POINTAGE.find(x => x[0] === code) || [, code])[1];
  // (16 § 10.1, urgence 2) Un objet par salarié et par mois, sous un identifiant qui en découle : deux postes qui ouvrent le
  // même mois écrivent le même objet, et le serveur le dit (un conflit, que la fusion rassemble case par case) au lieu d'en
  // garder deux dont un seul se lit.
  const idPointage = (employeeId, year, month) => `pt-${employeeId}-${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
  const pointageEnregistre = (data, employeeId, year, month) => (data.timesheets || [])
    .find(t => t.employeeId === employeeId && Number(t.year) === Number(year) && Number(t.month) === Number(month)) || null;
  // La grille d'un mois : ce qui a été pointé à la main, sinon le congé ou l'absence saisis, sinon le calendrier (le
  // repos de la semaine des barèmes). Les jours payés suivent la règle du bulletin : le mois complet des barèmes (26),
  // moins les jours ouvrables hors contrat, moins les absences non payées.
  // (1.257.0) L'équipe d'un salarié (ses horaires, ses jours de travail) ; sans équipe, les horaires de l'entreprise.
  function equipeDe(settings, employee) {
    const L = Array.isArray(settings && settings.equipes) ? settings.equipes : [];
    return (employee && employee.equipeId && L.find(q => q && q.id === employee.equipeId)) || null;
  }
  function joursReposDe(settings, employee) {
    const q = equipeDe(settings, employee);
    if (q && Array.isArray(q.jours) && q.jours.length) return [0, 1, 2, 3, 4, 5, 6].filter(i => !q.jours.includes(i));
    return Array.isArray(settings && settings.offDays) ? settings.offDays : [0];
  }
  function ferieDu(settings, iso) {
    return (Array.isArray(settings && settings.feries) ? settings.feries : []).find(f => f && f.date === iso) || null;
  }
  function pointageDuMois(data, employee, year, month) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const off = joursReposDe(s, employee);
    const total = Number(s.workedDays) || 26;
    const premier = `${year}-${String(month).padStart(2, '0')}-01`;
    const t = pointageEnregistre(data, employee.id, year, month);
    const conges = (data.leaves || []).filter(l => l.employeeId === employee.id && congeRetenu(l));
    const jours = [];
    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const iso = ajouterJoursIso(premier, d - 1);
      const wd = new Date(iso + 'T00:00:00Z').getUTCDay();
      let code = off.includes(wd) ? 'R' : 'P', source = 'calendrier';
      if ((employee.hireDate && iso < employee.hireDate) || (employee.endDate && iso > employee.endDate)) code = '-';
      else {
        const l = code === 'P' ? conges.find(x => x.from <= iso && iso <= x.to) : null;
        if (l) { code = !(l.paid != null ? l.paid : leaveIsPaid(l.kind)) ? 'A' : l.kind === 'maladie' ? 'M' : 'C'; source = 'conge'; }
        // (1.257.0) Un férié de la liste se pose de lui-même sur un jour de travail, comme un congé saisi.
        const fe = code === 'P' ? ferieDu(s, iso) : null;
        if (fe) { code = 'F'; source = 'ferie'; }
        const o = t && t.jours ? t.jours[String(d)] : null;
        if (o && CODES_POINTAGE.some(x => x[0] === o)) { code = o; source = 'pointe'; }
      }
      const rm = t && t.retards ? Math.max(0, Math.round(Number(t.retards[String(d)]) || 0)) : 0;
      // Le retard noté à la main gagne ; sinon celui que lit la pointeuse (l'arrivée après le début du planning).
      const rb = !rm && code === 'P' && t && t.badges && t.badges[String(d)] ? (journeeBadges(data, employee, iso) || {}).retard || 0 : 0;
      const rt = rm || rb;
      jours.push({ jour: d, iso, wd, code, source, repos: off.includes(wd), ...(rt ? { retard: rt } : {}), ...(rb ? { retardBadge: true } : {}), ...(t && t.badges && t.badges[String(d)] ? { badge: true } : {}), ...(code === 'F' && ferieDu(s, iso) ? { ferie: ferieDu(s, iso).nom || '' } : {}) });
    }
    const retards = jours.reduce((a, j) => a + (j.retard || 0), 0);
    // Une absence ne se compte que sur un jour ouvrable : le repos de la semaine n'est pas payé en plus, il ne se retire
    // pas non plus (poserPointage n'y pose que « Repos » ou « Présent »).
    const absences = round3(jours.reduce((a, j) => a + (j.repos ? 0 : j.code === 'A' ? 1 : j.code === 'D' ? 0.5 : 0), 0));
    const hors = Math.min(total, jours.filter(j => j.code === '-' && !off.includes(j.wd)).length);
    const payes = round3(Math.max(0, total - hors - absences));
    const hs = {};
    Object.keys((t && t.hs) || {}).forEach(k => { const h = round3(Number(t.hs[k]) || 0); if (h > 0) hs[k] = h; });
    return { jours, absences, payes, total, hs, retards, pointe: !!t };
  }
  // (1.257.0) LA POINTEUSE. Son fichier (texte ou tableur) : une ligne par passage, « badge ; date ; heure » (séparés par
  // ; , une tabulation ou des espaces ; la date en JJ/MM/AAAA ou AAAA-MM-JJ ; l'heure en HH:MM, les secondes ignorées).
  // Une ligne qu'on ne sait pas lire se compte, sans rien deviner.
  function lireBadges(texte) {
    const passages = [];
    let illisibles = 0;
    String(texte || '').split(/\r?\n/).forEach(l0 => {
      const l = l0.trim();
      if (!l) return;
      const m = /^"?([A-Za-z0-9-]{1,20})"?[\s;,\t]+"?(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})"?[\sT;,\t]+"?(\d{1,2})[:h](\d{2})(?::\d{2})?/.exec(l)
        || /^"?([A-Za-z0-9-]{1,20})"?[\s;,\t]+"?(\d{4})-(\d{2})-(\d{2})"?[\sT;,\t]+"?(\d{1,2})[:h](\d{2})(?::\d{2})?/.exec(l);
      if (!m) { if (!/badge|matricule|date|heure/i.test(l)) illisibles++; return; }
      const iso = m[4].length === 4 ? `${m[4]}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}` : `${m[2]}-${m[3]}-${m[4]}`;
      const hh = Number(m[5]), mi = Number(m[6]);
      if (hh > 23 || mi > 59 || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) { illisibles++; return; }
      passages.push({ badge: m[1].replace(/^0+(?=\d)/, ''), iso, heure: `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}` });
    });
    return { passages, illisibles };
  }
  const minutesDe = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  // Ce qu'un import ferait, sans rien écrire (`ecrire` faux), ou l'écrit : chaque passage va au salarié dont la fiche porte
  // ce n° de badge ; un jour garde sa première et sa dernière heure ; un passage déjà importé s'ignore. Les cases pointées à
  // la main ne bougent pas : les badges se gardent à côté (`timesheet.badges`).
  function importerBadges(data, passages, ecrire) {
    const norm = b => String(b || '').trim().replace(/^0+(?=\d)/, '');
    const parBadge = new Map((data.employees || []).filter(e => norm(e.badge)).map(e => [norm(e.badge), e]));
    const r = { lus: passages.length, rattaches: 0, deja: 0, inconnus: [], jours: 0, du: '', au: '' };
    const groupes = new Map();
    passages.forEach(p => {
      const e = parBadge.get(norm(p.badge));
      if (!e) { if (!r.inconnus.includes(p.badge)) r.inconnus.push(p.badge); return; }
      r.rattaches++;
      if (!r.du || p.iso < r.du) r.du = p.iso; if (!r.au || p.iso > r.au) r.au = p.iso;
      const k = `${e.id}|${p.iso}`; if (!groupes.has(k)) groupes.set(k, { e, iso: p.iso, h: [] }); groupes.get(k).h.push(p.heure);
    });
    groupes.forEach(({ e, iso, h }) => {
      const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = String(Number(iso.slice(8, 10)));
      let t = pointageEnregistre(data, e.id, y, m);
      const avant = t && t.badges && t.badges[d] ? t.badges[d] : null;
      const vus = new Set(avant ? avant.h || [] : []);
      const neufs = [...new Set(h)].filter(x => !vus.has(x));
      r.deja += h.length - neufs.length;
      if (!neufs.length) return;
      r.jours++;
      if (!ecrire) return;
      if (!t) { if (!Array.isArray(data.timesheets)) data.timesheets = []; t = { id: idPointage(e.id, y, m), employeeId: e.id, year: y, month: m, jours: {}, hs: {} }; data.timesheets.push(t); }
      t.badges = t.badges || {};
      const tout = [...vus, ...neufs].sort();
      t.badges[d] = { h: tout, ...(avant && avant.sortieMain ? { sortieMain: avant.sortieMain } : {}) };
    });
    return r;
  }
  // La journée d'un salarié lue sur ses badges : l'arrivée, le départ (la sortie posée à la main, si le badge l'a oubliée),
  // le temps passé, le retard sur le planning de son équipe et ce qui dépasse le planning. `null` sans badge ce jour-là.
  function journeeBadges(data, employee, iso) {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = String(Number(iso.slice(8, 10)));
    const t = pointageEnregistre(data, employee.id, y, m), b = t && t.badges ? t.badges[d] : null;
    if (!b || !(b.h || []).length) return null;
    const s = baremesPaie((data && data.payrollSettings) || {}), q = equipeDe(s, employee);
    const arrivee = b.h[0], depart = b.h.length > 1 ? b.h[b.h.length - 1] : (b.sortieMain || '');
    const a = minutesDe(arrivee), dp = minutesDe(depart);
    const travaille = a != null && dp != null ? (dp >= a ? dp - a : dp + 1440 - a) : null;
    const debut = q ? minutesDe(q.debut) : null, fin = q ? minutesDe(q.fin) : null;
    const prevu = debut != null && fin != null ? (fin > debut ? fin - debut : fin + 1440 - debut) : null;
    const seuil = Math.max(1, Math.round(Number(s.retardMinimum) || 0));
    const retard = debut != null && a != null && a - debut >= seuil && a - debut < 240 ? a - debut : 0;
    // Au-delà du planning : ce qui passe la fin prévue (une arrivée en avance ne compte pas), arrondi à l'inférieur au pas
    // réglé (`hsArrondi`, en minutes ; 0 : à la minute).
    const apres = fin != null && dp != null && depart ? (dp - fin + 1440) % 1440 : 0;
    const pas = Math.max(1, Math.round(Number(s.hsArrondi) || 0));
    const au_dela = apres > 0 && apres < 720 ? Math.floor(apres / pas) * pas : 0;
    return { arrivee, depart, sortieMain: !!(b.h.length < 2 && b.sortieMain), travaille, prevu, retard, auDela: au_dela, passages: b.h.length };
  }
  // À régler avant d'envoyer le pointage d'un mois : une entrée sans sortie (« Mettre la sortie à 11:00 »), et les jours de
  // travail passés sans badge ni rien pour les justifier (ni congé saisi, ni férié, ni case changée à la main) chez ceux qui
  // pointent à la pointeuse. Les jours avant le premier badge importé du mois, ou après le dernier, ne se comptent pas.
  function anomaliesPointage(data, year, month, jourIso) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const out = [];
    (data.employees || []).forEach(e => {
      const t = pointageEnregistre(data, e.id, year, month);
      const B = t && t.badges ? t.badges : null;
      const q = equipeDe(s, e);
      if (!B || !Object.keys(B).length) return;
      const jours = Object.keys(B).map(Number).sort((a, b) => a - b);
      const p = pointageDuMois(data, e, year, month);
      jours.forEach(d => { const b = B[String(d)]; if ((b.h || []).length === 1 && !b.sortieMain) out.push({ sorte: 'sortie', employeeId: e.id, jour: d, entree: b.h[0], proposee: q && q.fin ? q.fin : '' }); });
      if (!q || q.pointe !== 'pointeuse') return;
      const sans = p.jours.filter(j => j.jour >= jours[0] && j.jour <= jours[jours.length - 1] && (!jourIso || j.iso <= jourIso)
        && !j.repos && j.code === 'P' && j.source === 'calendrier' && !B[String(j.jour)]).map(j => j.jour);
      if (sans.length) out.push({ sorte: 'sansBadge', employeeId: e.id, jours: sans });
    });
    return out;
  }
  function poserSortie(data, employee, year, month, jour, heure) {
    const t = pointageEnregistre(data, employee.id, year, month), b = t && t.badges ? t.badges[String(jour)] : null;
    if (!b || minutesDe(heure) == null) return false;
    b.sortieMain = heure;
    return true;
  }
  // (1.257.0) Un retard, en minutes, sur un jour du mois (0 l'efface). Il se note toujours ; il ne se retient que si le
  // réglage `retenirRetards` le dit.
  function poserRetard(data, employee, year, month, jour, minutes) {
    const naturel = pointageDuMois(data, employee, year, month).jours.find(j => j.jour === Number(jour));
    if (!naturel || naturel.code === '-') return false;
    let t = pointageEnregistre(data, employee.id, year, month);
    const mn = Math.max(0, Math.min(600, Math.round(Number(minutes) || 0)));
    if (!t) {
      if (!mn) return true;
      if (!Array.isArray(data.timesheets)) data.timesheets = [];
      t = { id: idPointage(employee.id, year, month), employeeId: employee.id, year: Number(year), month: Number(month), jours: {}, hs: {} };
      data.timesheets.push(t);
    }
    t.retards = t.retards || {};
    if (mn) t.retards[String(jour)] = mn; else delete t.retards[String(jour)];
    return true;
  }
  // Poser le code d'un jour : seul ce qui diffère de ce que le calendrier et les congés donneraient se garde. Un jour hors
  // contrat, ou un code qu'un jour de repos ne prend pas, se refuse sans rien écrire.
  function poserPointage(data, employee, year, month, jour, code) {
    if (!CODES_POINTAGE.some(x => x[0] === code)) return false;
    let t = pointageEnregistre(data, employee.id, year, month);
    const garde = t && t.jours ? t.jours[String(jour)] : undefined;
    if (garde !== undefined) delete t.jours[String(jour)];
    const naturel = pointageDuMois(data, employee, year, month).jours.find(j => j.jour === Number(jour));
    if (!naturel || naturel.code === '-' || (naturel.repos && !CODES_REPOS.includes(code))) {
      if (garde !== undefined) t.jours[String(jour)] = garde;
      return false;
    }
    if (!t) {
      if (!Array.isArray(data.timesheets)) data.timesheets = [];
      t = { id: idPointage(employee.id, year, month), employeeId: employee.id, year: Number(year), month: Number(month), jours: {}, hs: {} };
      data.timesheets.push(t);
    }
    t.jours = t.jours || {};
    if (naturel.code !== code) t.jours[String(jour)] = code;
    // (1.271.0) Le « Pourquoi ? » d'une absence s'en va avec elle.
    if (code !== 'A' && code !== 'D' && t.motifs && t.motifs[String(jour)] !== undefined) { delete t.motifs[String(jour)]; if (!Object.keys(t.motifs).length) delete t.motifs; }
    return true;
  }
  // Les heures supplémentaires du mois, par majoration (en %).
  function poserHeuresSup(data, employee, year, month, majoration, heures) {
    let t = pointageEnregistre(data, employee.id, year, month);
    if (!t) {
      if (!Array.isArray(data.timesheets)) data.timesheets = [];
      t = { id: idPointage(employee.id, year, month), employeeId: employee.id, year: Number(year), month: Number(month), jours: {}, hs: {} };
      data.timesheets.push(t);
    }
    t.hs = t.hs || {};
    const h = round3(Number(heures) || 0);
    if (h > 0) t.hs[String(majoration)] = h; else delete t.hs[String(majoration)];
    return true;
  }
  // (1.259.0) Les heures sup notées sur UNE journée (« La journée », docs/maquettes/pointage.html) : gardées jour par jour
  // (`timesheet.hsJours`, pour les relire et les défaire), et ajoutées à celles du mois de la même majoration — c'est le
  // total du mois que le bulletin paie (`heuresSupDuMois`). 0 les retire, du jour et du mois ; une autre majoration
  // remplace celle du jour. Jamais négatif : un total du mois retouché à la main plus bas ne descend pas sous zéro.
  function heuresSupDuJour(data, employee, year, month, jour) {
    const t = pointageEnregistre(data, employee.id, year, month), x = t && t.hsJours ? t.hsJours[String(jour)] : null;
    return x && Number(x.heures) > 0 ? { majoration: Number(x.majoration), heures: round3(Number(x.heures)) } : null;
  }
  function poserHeuresSupDuJour(data, employee, year, month, jour, majoration, heures) {
    const naturel = pointageDuMois(data, employee, year, month).jours.find(j => j.jour === Number(jour));
    if (!naturel || naturel.code === '-') return false;
    const h = round3(Math.max(0, Number(heures) || 0)), maj = Number(majoration);
    if (h > 0 && !(maj > 0)) return false;
    let t = pointageEnregistre(data, employee.id, year, month);
    if (!t) {
      if (!h) return true;
      if (!Array.isArray(data.timesheets)) data.timesheets = [];
      t = { id: idPointage(employee.id, year, month), employeeId: employee.id, year: Number(year), month: Number(month), jours: {}, hs: {} };
      data.timesheets.push(t);
    }
    t.hs = t.hs || {}; t.hsJours = t.hsJours || {};
    const avant = t.hsJours[String(jour)];
    const ajouter = (k, d) => { const v = round3(Math.max(0, (Number(t.hs[String(k)]) || 0) + d)); if (v > 0) t.hs[String(k)] = v; else delete t.hs[String(k)]; };
    if (avant && Number(avant.heures) > 0) ajouter(avant.majoration, -Number(avant.heures));
    if (h > 0) { t.hsJours[String(jour)] = { majoration: maj, heures: h }; ajouter(maj, h); } else delete t.hsJours[String(jour)];
    return true;
  }
  const majorationsHs = s => [s && s.hsMaj1, s && s.hsMaj2, s && s.hsMaj3].map(Number).filter(x => x > 0);
  // (1.274.0, audit du 04/11/2026, G09) Les heures d'un mois complet DE CE SALARIÉ : celles du réglage pour un temps plein ;
  // pour un temps partiel (heures par semaine sur sa fiche), celles de son contrat, sur 52 semaines rapportées au mois
  // (24 h par semaine : 104 h). Son brut est celui de ces heures : l'heure sup, la retenue d'un retard et l'heure de nuit
  // se valorisent sur elles. À VÉRIFIER avec le comptable : les heures complémentaires d'un temps partiel et leur majoration.
  function heuresDuMoisDe(s, employee) {
    const h = Number(employee && employee.weeklyHours) || 0;
    return h > 0 ? round3(h * 52 / 12) : (Number(s && s.heuresMois) || 0);
  }
  // Une prime imposable par majoration : le brut de la fiche divisé par les heures d'un mois complet, majoré.
  function heuresSupDuMois(data, employee, year, month) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const t = pointageEnregistre(data, employee.id, year, month);
    const heuresMois = heuresDuMoisDe(s, employee);
    if (!t || !t.hs || !(heuresMois > 0)) return [];
    const brut = round3(Number(employee.grossSalary) || 0);
    const pct = n => String(n).replace('.', ',');
    return majorationsHs(s).filter(x => Number(t.hs[String(x)]) > 0).map(x => {
      const h = round3(Number(t.hs[String(x)]));
      return { label: `Heures supplémentaires : ${pct(h)} h à +${pct(x)} %`, amount: round3(brut * h * (100 + x) / 100 / heuresMois), taxable: true, hs: x, heures: h };
    }).filter(b => b.amount > 0);
  }
  // Ce que le pointage change à une saisie de bulletin : les absences non payées, les primes au jour (sur les jours
  // payés), les heures supplémentaires (celles d'avant s'en vont). Le reste de la saisie ne bouge pas.
  // (1.258.0) La retenue des retards du mois, quand le réglage `retenirRetards` le dit (éteint par défaut ; À VÉRIFIER : ce
  // qui peut se retenir) : les minutes du mois au taux horaire de la fiche (le brut divisé par les heures d'un mois
  // complet, comme les heures sup), en une ligne imposable négative : le brut baisse, la CNSS et l'impôt suivent.
  function retardsDuMois(data, employee, year, month, p) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const heuresMois = heuresDuMoisDe(s, employee), mn = Math.round(Number((p || pointageDuMois(data, employee, year, month)).retards) || 0);
    if (!s.retenirRetards || !(heuresMois > 0) || !(mn > 0)) return [];
    const montant = round3(round3(Number(employee.grossSalary) || 0) * mn / 60 / heuresMois);
    return montant > 0 ? [{ label: `Retenue pour retards : ${mn} min`, amount: -montant, taxable: true, retard: true, minutes: mn }] : [];
  }
  // (1.258.0) Les heures de nuit du mois : chaque jour travaillé (présent), de l'arrivée au départ lus sur les badges, ou,
  // sans badge, l'horaire de son équipe ; ce qui tombe dans la plage de nuit réglée (elle peut passer minuit). Sans plage
  // réglée, rien. La majoration réglée en fait une prime imposable : le brut de la fiche divisé par les heures d'un mois
  // complet, fois les heures de nuit, fois la majoration (l'heure elle-même est déjà dans le salaire).
  function heuresDeNuitDuMois(data, employee, year, month, p) {
    const s = baremesPaie((data && data.payrollSettings) || {});
    const ns = minutesDe(s.nuitDebut), ne = minutesDe(s.nuitFin);
    if (ns == null || ne == null || ns === ne) return { minutes: 0, lignes: [], reglee: false };
    const fenetre = [ns, ne > ns ? ne : ne + 1440];
    const q = equipeDe(s, employee);
    const recouvre = (a, d) => [-1440, 0, 1440].reduce((t, k) => t + Math.max(0, Math.min(d, fenetre[1] + k) - Math.max(a, fenetre[0] + k)), 0);
    let minutes = 0;
    for (const j of (p || pointageDuMois(data, employee, year, month)).jours) {
      if (j.code !== 'P' || j.repos) continue;
      const b = j.badge ? journeeBadges(data, employee, j.iso) : null;
      const a = minutesDe(b ? b.arrivee : q && q.debut), d0 = minutesDe(b ? b.depart : q && q.fin);
      if (a == null || d0 == null) continue;
      minutes += recouvre(a, d0 > a ? d0 : d0 + 1440);
    }
    const heuresMois = heuresDuMoisDe(s, employee), maj = Number(s.nuitMajoration) || 0, h = round3(minutes / 60);
    const pc = n => String(n).replace('.', ',');
    const montant = maj > 0 && heuresMois > 0 ? round3(round3(Number(employee.grossSalary) || 0) * h * maj / 100 / heuresMois) : 0;
    return { minutes, reglee: true, lignes: montant > 0 ? [{ label: `Heures de nuit : ${pc(h)} h à +${pc(maj)} %`, amount: montant, taxable: true, nuit: true, heures: h }] : [] };
  }
  function reprisePointage(i, p, hs, rt) {
    const total = Number(i.workedDays) || 26;
    const hors = i.prorata ? Math.max(0, Number(i.prorata.sur) - Number(i.prorata.jours)) : 0;
    const absentDays = p.absences;
    const j = Math.max(0, Math.min(total, round3(total - hors - absentDays)));
    const bonuses = (i.bonuses || []).filter(b => !b.hs && !b.retard && !b.nuit)
      .map(b => b.parJour ? { ...b, amount: round3(Number(b.mensuel) * j / total), jours: j, sur: total } : b)
      .concat(hs, rt || []);
    return { absentDays, bonuses };
  }
  // Un bulletin établi qui ne suit plus le pointage de son mois : ce qu'il deviendrait. `null` sans pointage.
  function pointageSurBulletin(data, slip) {
    const e = (data.employees || []).find(x => x.id === slip.employeeId);
    if (!e || !pointageEnregistre(data, e.id, slip.year, slip.month)) return null;
    const pm = pointageDuMois(data, e, slip.year, slip.month);
    const r = reprisePointage(slip, pm, heuresSupDuMois(data, e, slip.year, slip.month), retardsDuMois(data, e, slip.year, slip.month, pm).concat(heuresDeNuitDuMois(data, e, slip.year, slip.month, pm).lignes));
    const empreinte = l => JSON.stringify((l || []).map(b => [b.label, round3(Number(b.amount) || 0)]));
    const avant = round3(Number(slip.absentDays) || 0);
    // Ce qui diffère, pour le dire : les absences, les heures supplémentaires (les primes au jour suivent les absences).
    const absences = avant !== r.absentDays;
    const heures = empreinte((slip.bonuses || []).filter(b => b.hs)) !== empreinte(r.bonuses.filter(b => b.hs));
    const change = absences || empreinte(slip.bonuses) !== empreinte(r.bonuses);
    return { ...r, change, avant, absences, heures };
  }

  // (plateforme) 1.71.0 — les avances sur salaire (celles de l'entreprise, 5.1.0) : une somme prêtée au salarié, remboursée
  // par retenues mensuelles sur ses bulletins. Dans le moteur commun, que le Cabinet lit aussi : une seule copie (core.js la
  // reprend). Ce qui est remboursé se lit sur les bulletins eux-mêmes : leurs retenues marquées du numéro de l'avance.
  function advancesOf(data, employeeId) {
    return (data.advances || [])
      .filter(a => !employeeId || a.employeeId === employeeId)
      .map(a => {
        const monthly = round3(Number(a.monthly) || 0);
        const amount = round3(Number(a.amount) || 0);
        const repaid = round3((data.payslips || [])
          .filter(p => p.employeeId === a.employeeId)
          .reduce((s2, p) => s2 + ((p.deductions || []).filter(d => d.advanceId === a.id).reduce((x, d) => x + (Number(d.amount) || 0), 0)), 0));
        return { ...a, amount, monthly, repaid, remaining: round3(Math.max(0, amount - repaid)), done: repaid >= amount - 0.0005 };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function advanceBalance(data, employeeId) {
    return round3(advancesOf(data, employeeId).reduce((s, a) => s + a.remaining, 0));
  }

  // Les avances d'une année, telles que le Cabinet les montre : versées cette année-là, ou avant et encore à rembourser, ou
  // remboursées en partie dans l'année (une avance de décembre se retient sur les bulletins de janvier). Une avance soldée
  // avant l'année, ou versée après, n'en est pas.
  function avancesDeLAnnee(data, year) {
    const y = String(year);
    const retenueEn = new Set((data.payslips || []).filter(p => String(p.year) === y)
      .flatMap(p => (p.deductions || []).map(d => d.advanceId).filter(Boolean)));
    return advancesOf(data, '').filter(a => String(a.date || '').slice(0, 4) === y
      || (String(a.date || '') < `${y}-01-01` && (!a.done || retenueEn.has(a.id))));
  }

  // L'échéance de chaque avance en cours d'un salarié sur le bulletin d'un mois : la retenue convenue, jamais plus que ce qui
  // reste (la dernière solde l'avance) ; une avance versée après ce mois n'en a pas encore. Ce que le bulletin de
  // l'entreprise propose depuis la 6.0 (core.js, `payslipInputFor`), et celui du Cabinet depuis la 1.71.0.
  function echeancesDuMois(data, employeeId, year, month) {
    const jjmmaaaa = iso => String(iso).split('-').reverse().join('/');
    // (plateforme) 1.226.0 — un prêt commence ses retenues au mois convenu (`debut`, AAAA-MM), pas avant.
    return advancesOf(data, employeeId).filter(a => !a.done && a.date <= `${year}-${String(month).padStart(2, '0')}-31` && (!a.debut || a.debut <= `${year}-${String(month).padStart(2, '0')}`))
      .map(a => ({ label: `Remboursement d'avance du ${jjmmaaaa(a.date)}`, amount: round3(Math.min(a.monthly || a.remaining, a.remaining)), advanceId: a.id }))
      .filter(d => d.amount > 0);
  }

  // (plateforme) 1.69.0 — la saisie d'un bulletin NOUVEAU, lue sur la grille du mois du salarié : son entrée ou sa sortie
  // (le brut proratisé sur les jours ouvrables hors contrat, 10.12.0), ses absences non payées (ses congés, ou son
  // pointage), ses primes de chaque mois (au jour sur les jours payés, 1.59.0) et, le mois pointé, ses heures
  // supplémentaires. C'est la saisie de l'entreprise (core.js, `payslipInputFor`) : un essai compare les deux (deux
  // chemins, un chiffre). (plateforme) 1.71.0 — avec les échéances de ses avances, que le Cabinet lit désormais.
  // (plateforme) 1.229.0 — un salaire qui change à une DATE : la fiche garde `salaires` ([{ des: 'AAAA-MM', brut, avant }]).
  // Le brut d'un mois est celui du dernier changement entré en vigueur ce mois-là ou avant ; un mois d'avant le premier
  // changement garde l'ancien salaire (`avant`). Sans historique, le brut de la fiche. Un bulletin d'un mois passé, refait
  // plus tard, ne prend donc jamais l'augmentation d'après.
  // (1.274.0, audit du 04/11/2026, G08) Ce qu'une augmentation qui compte depuis un mois passé doit rappeler pour un bulletin
  // déjà payé (ou d'un mois clos) : le brut que ce mois aurait eu au salaire d'aujourd'hui, moins celui qu'il a eu, moins ce
  // qu'un rappel d'avant a déjà porté pour ce mois (`rappelDe`, gardé par le rappel). Le mois d'une entrée ou d'une sortie, son
  // prorata se refait au nouveau salaire (le salaire du contrat ET le brut proratisé) : avec l'ancien, le moteur ne le
  // reconnaît plus et retire l'absence du brut proratisé (1 300 → 1 400 DT, 14 jours sur 26, 2 jours d'absence : 95,858 DT
  // au lieu de 46,154). La façon d'imposer un rappel : À VÉRIFIER avec le comptable.
  function ecartDeRappel(employee, slip, settings) {
    const e = employee || {}, p = slip || {}, y = Number(p.year), m = Number(p.month);
    const fiche = brutDuMois(e, y, m);
    const g = p.prorata ? round3(fiche * Number(p.prorata.jours) / Number(p.prorata.sur)) : fiche;
    const prorata = p.prorata ? { ...p.prorata, brutFiche: fiche, brut: g } : null;
    const c0 = p.computed || computePayslip(e, p, settings);
    const c1 = computePayslip(e, { year: p.year, month: p.month, gross: g, workedDays: p.workedDays, absentDays: p.absentDays, bonuses: p.bonuses || [], deductions: p.deductions || [], prorata }, settings);
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const deja = (Array.isArray(e.regularisations) ? e.regularisations : []).filter(r => r && r.rappel && Array.isArray(r.rappelDe))
      .reduce((a, r) => a + r.rappelDe.filter(x => x && x.mois === ym).reduce((t, x) => t + (Number(x.brut) || 0), 0), 0);
    return round3(Number(c1.gross) - Number(c0.gross) - round3(deja));
  }
  function brutDuMois(employee, year, month) {
    const e = employee || {}, L = Array.isArray(e.salaires) ? e.salaires.filter(x => x && /^\d{4}-\d{2}$/.test(x.des)).slice().sort((a, b) => a.des.localeCompare(b.des)) : [];
    if (!L.length) return round3(Number(e.grossSalary) || 0);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const vu = L.filter(x => x.des <= ym).pop();
    return round3(Number(vu ? vu.brut : L[0].avant) || 0);
  }
  // (plateforme) 1.230.0 — CORRIGER SANS RÉÉCRIRE (docs/revue-paie.md, M5 et M6). Un bulletin payé et remis ne change plus
  // en silence : l'écart se porte sur un mois suivant, en RÉGULARISATION (`employee.regularisations` : { id, pourMois
  // 'AAAA-MM', label, amount signé, taxable, motif, deBulletin, le }). Un rappel d'augmentation passée est une
  // régularisation positive et imposable. Le bulletin du mois la reprend comme une prime (négative : un trop-perçu) ;
  // imposable, elle entre dans l'assiette de la CNSS et de l'impôt. À VÉRIFIER avec le comptable : l'impôt d'un rappel
  // se calcule-t-il sur le mois qui le paie (ce que fait ce calcul) ou se répartit-il sur les mois qu'il couvre ?
  // (plateforme) 1.256.0 — NET → BRUT (« il veut 1 000 DT net : quel brut ? », le geste d'une embauche négociée). Le net
  // croît avec le brut (chaque tranche de l'impôt prend moins d'un dinar par dinar) : on cherche, au millime, le plus petit
  // brut dont le net atteint celui qu'on vise, par le calcul même des bulletins (`computePayslip`). Le net trouvé peut
  // dépasser le net visé de quelques millimes (les arrondis) : il se dit tel qu'il est. `null` si aucun brut n'y arrive.
  function brutPourNet(employee, netVise, settings, input) {
    const vise = round3(Number(netVise) || 0);
    if (!(vise > 0)) return null;
    const netDe = mil => computePayslip({ ...(employee || {}), grossSalary: mil / 1000 }, { ...(input || {}), gross: mil / 1000 }, settings).net;
    let bas = 0, haut = Math.round(Math.max(1000, vise * 3) * 1000);
    if (netDe(haut) < vise) return null;
    while (haut - bas > 1) { const m = Math.floor((bas + haut) / 2); if (netDe(m) >= vise) haut = m; else bas = m; }
    return { gross: round3(haut / 1000), net: netDe(haut) };
  }
  // (plateforme) 1.256.0 — l'ANCIENNETÉ : des années pleines, de l'embauche au jour donné (un jour de calendrier, sans
  // heure). Le 10/03/2023 → le 09/03/2026 : 2 ans ; le 10/03/2026 : 3 ans.
  function anneesAnciennete(employee, jourIso) {
    const d0 = String((employee && employee.hireDate) || ''), d1 = String(jourIso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(d0) || !/^\d{4}-\d{2}-\d{2}/.test(d1) || d1 < d0) return 0;
    const a = Number(d1.slice(0, 4)) - Number(d0.slice(0, 4));
    return d1.slice(5, 10) < d0.slice(5, 10) ? a - 1 : a;
  }
  // La tranche de la prime d'ancienneté atteinte : la plus haute dont les années sont atteintes. Une tranche sans taux, ou
  // une liste vide, ne donne rien.
  function trancheAnciennete(settings, ans) {
    const L = (((settings || {}).anciennete) || []).map(t => ({ ans: Number(t && t.ans), taux: Number(t && t.taux) }))
      .filter(t => t.ans > 0 && t.taux > 0).sort((a, b) => a.ans - b.ans);
    return L.filter(t => t.ans <= ans).pop() || null;
  }
  // La prime d'ancienneté d'un mois : le taux de la tranche atteinte au dernier jour du mois, sur le salaire de base du
  // mois, au jour comme une prime « au jour » (le pointage, l'entrée, la sortie la proratisent). Imposable et cotisable.
  // À VÉRIFIER avec le comptable : la base (salaire de base ou brut), les tranches et les taux de la convention.
  function primeAncienneteDuMois(employee, settings, year, month, payes, total) {
    const e = employee || {};
    const fin = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    const ans = anneesAnciennete(e, fin), t = trancheAnciennete(settings, ans);
    if (!t) return [];
    const mensuel = round3((Number(e.grossSalary) || 0) * t.taux / 100);
    const j = Math.max(0, Math.min(Number(total) || 26, Number(payes)));
    const amount = Number(total) > 0 && j < Number(total) ? round3(mensuel * j / Number(total)) : mensuel;
    if (!(amount > 0)) return [];
    return [{ label: `Prime d'ancienneté (${ans} ans, ${String(t.taux).replace('.', ',')} %)`, amount, taxable: true, parJour: true, mensuel, jours: j, sur: Number(total) || 26, anciennete: { ans, taux: t.taux } }];
  }
  // (plateforme) 1.256.0 — les VARIABLES DU MOIS importées d'un tableur (`employee.variables` : { id, mois 'AAAA-MM', sorte
  // 'prime' | 'retenue', label, amount, taxable, le }) : une prime entre au brut (imposable sauf mention), une retenue se
  // retire du net. Le bulletin du mois les reprend ; un bulletin déjà établi et pas payé les reçoit tout de suite.
  function variablesDuMois(employee, year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const L = ((employee && employee.variables) || []).filter(v => v && v.mois === ym && Number(v.amount) > 0);
    return {
      bonuses: L.filter(v => v.sorte !== 'retenue').map(v => ({ label: String(v.label || '').trim() || 'Prime du mois', amount: round3(Number(v.amount)), taxable: v.taxable !== false, variableId: v.id })),
      deductions: L.filter(v => v.sorte === 'retenue').map(v => ({ label: String(v.label || '').trim() || 'Retenue du mois', amount: round3(Number(v.amount)), variableId: v.id }))
    };
  }
  function regulsDuMois(employee, year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return ((employee && employee.regularisations) || []).filter(r => r && r.pourMois === ym && Number(r.amount))
      .map(r => ({ label: String(r.label || '').trim() || 'Régularisation', amount: round3(Number(r.amount)), taxable: r.taxable !== false, regulId: r.id }));
  }
  // (plateforme) 1.230.0 — la SAISIE SUR SALAIRE (une opposition, une pension alimentaire : `employee.saisies` : { id,
  // creancier, total, monthly, debut 'AAAA-MM', reference, versements: [{ id, date, amount, accountId, method }] }).
  // L'employeur retient chaque mois la somme convenue, jamais plus que ce qui reste, et la verse au créancier. Ce qui est
  // retenu se lit sur les bulletins (leurs retenues marquées du numéro de la saisie), ce qui est versé sur la saisie.
  // À VÉRIFIER avec le comptable : la part du salaire que la loi permet de saisir (la retenue n'est pas plafonnée ici :
  // elle est celle que la décision du tribunal fixe).
  function saisiesOf(data, employee) {
    const e = employee || {};
    return (Array.isArray(e.saisies) ? e.saisies : []).filter(x => x && x.id).map(x => {
      const total = round3(Number(x.total) || 0), monthly = round3(Number(x.monthly) || 0);
      const retenu = round3((data.payslips || []).filter(p => p.employeeId === e.id)
        .reduce((s, p) => s + (p.deductions || []).filter(d => d.saisieId === x.id).reduce((a, d) => a + (Number(d.amount) || 0), 0), 0));
      const verse = round3((x.versements || []).reduce((s, v) => s + (Number(v.amount) || 0), 0));
      return { ...x, total, monthly, retenu, verse, reste: round3(Math.max(0, total - retenu)), aVerser: round3(Math.max(0, retenu - verse)), done: total > 0 && retenu >= total - 0.0005 };
    });
  }
  function saisiesDuMois(data, employee, year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return saisiesOf(data, employee).filter(x => !x.done && (!x.debut || x.debut <= ym))
      .map(x => ({ label: `Saisie sur salaire — ${String(x.creancier || '').trim() || 'créancier'}`, amount: round3(Math.min(x.monthly || x.reste, x.reste)), saisieId: x.id }))
      .filter(d => d.amount > 0);
  }
  const employeAuMois = (employee, year, month) => (employee && Array.isArray(employee.salaires) && employee.salaires.length
    ? { ...employee, grossSalary: brutDuMois(employee, year, month) } : employee);
  function saisieDuMois(data, employee0, year, month) {
    const employee = employeAuMois(employee0, year, month);
    const p = pointageDuMois(data, employee, year, month);
    const total = p.total;
    const hors = Math.min(total, p.jours.filter(j => j.code === '-' && !j.repos).length);
    const premier = `${year}-${String(month).padStart(2, '0')}-01`;
    const dernier = ajouterJoursIso(premier, daysInMonth(year, month) - 1);
    const jjmmaaaa = iso => String(iso).split('-').reverse().join('/');
    const motifs = [];
    if (employee.hireDate && employee.hireDate > premier && employee.hireDate <= dernier) motifs.push(`entrée le ${jjmmaaaa(employee.hireDate)}`);
    if (employee.endDate && employee.endDate >= premier && employee.endDate < dernier) motifs.push(`sortie le ${jjmmaaaa(employee.endDate)}`);
    const brutFiche = round3(Number(employee.grossSalary) || 0);
    const gross = hors ? round3(brutFiche * (total - hors) / total) : employee.grossSalary;
    const prorata = hors ? { jours: round3(total - hors), sur: total, motif: motifs.join(', '), brutFiche, brut: gross } : null;
    // (plateforme) 1.256.0 — la prime d'ancienneté et les variables du mois, comme le bulletin de l'entreprise (core.js,
    // `payslipInputForSansPointage`) : une règle des deux côtés, un chiffre.
    const vars = variablesDuMois(employee, year, month), st = baremesPaie((data && data.payrollSettings) || {});
    const i = { gross, workedDays: total, absentDays: p.absences, bonuses: [...primesDuMois(employee, total - hors - p.absences, total), ...primeAncienneteDuMois(employee, st, year, month, total - hors - p.absences, total), ...regulsDuMois(employee, year, month), ...vars.bonuses], prorata,
      deductions: [...echeancesDuMois(data, employee.id, year, month), ...saisiesDuMois(data, employee, year, month), ...vars.deductions] };
    return p.pointe ? { ...i, ...reprisePointage(i, p, heuresSupDuMois(data, employee, year, month), retardsDuMois(data, employee, year, month, p).concat(heuresDeNuitDuMois(data, employee, year, month, p).lignes)) } : i;
  }

  // Un salarié se REFUSE tant qu'il manque ce sans quoi aucun bulletin n'est possible. Le reste —
  // CIN, numéro CNSS, poste — se complète plus tard : on ne bloque pas une paie parce qu'un numéro
  // manque, on le signale.
  function salarieValide(sal) {
    const e = sal || {};
    if (!String(e.nom || '').trim()) return { ok: false, motif: 'Le nom du salarié est obligatoire.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.embauche || ''))) return { ok: false, motif: 'La date d\'embauche est obligatoire.' };
    if (e.sortie && String(e.sortie) < String(e.embauche)) return { ok: false, motif: 'La date de sortie précède l\'embauche.' };
    if (!(Number(e.brut) > 0)) return { ok: false, motif: 'Le salaire brut mensuel doit être supérieur à zéro.' };
    return { ok: true, motif: '' };
  }

  // La forme d'un salarié est FIXÉE, comme celle d'une écriture : ce qu'on ne connaît pas est jeté,
  // sinon chaque appelant y glisserait ses champs à lui (même règle qu'`ajouterEcriture`).
  function normaliserSalarie(sal, id) {
    const e = sal || {};
    return {
      id: String(id || e.id || ''), nom: String(e.nom || '').trim(),
      cin: String(e.cin || '').trim(), cnss: String(e.cnss || '').trim(),
      // 10.14.1 (DECL D2) — l'identité telle que la CNSS l'écrit : « prénom, prénom du père, nom »,
      // comme sur la carte d'assuré. Vide, le fichier du trimestre reprend `nom` et le dit.
      identiteCnss: String(e.identiteCnss || '').trim(),
      poste: String(e.poste || '').trim(),
      // (plateforme) 1.72.0 — sa civilité (« m », « f »), qui fait l'accord des documents du personnel ; inconnue, vide.
      genre: CIVILITES.some(c => c[0] === e.genre) ? e.genre : '',
      contrat: CONTRACT_TYPES.some(c => c[0] === e.contrat) ? e.contrat : 'cdi',
      embauche: String(e.embauche || ''), sortie: String(e.sortie || ''),
      brut: round3(Number(e.brut) || 0),
      chefDeFamille: !!e.chefDeFamille, enfants: Math.max(0, Number(e.enfants) || 0),
      actif: e.actif !== false, note: String(e.note || ''),
      // (plateforme) 1.68.0 — ses primes de chaque mois (celles de l'entreprise, 1.59.0) : un bulletin nouveau les
      // reprend. Une ligne sans nom ni montant ne se garde pas.
      primes: (Array.isArray(e.primes) ? e.primes : []).filter(p => p && (String(p.label || '').trim() || Number(p.amount) > 0))
        .map(p => ({ label: String(p.label || '').trim() || 'Prime', amount: round3(Number(p.amount) || 0), taxable: p.taxable !== false, parJour: !!p.parJour }))
    };
  }

  function ajouterSalarie(livre, salarie, qui, quand) {
    const v = salarieValide(salarie);
    if (!v.ok) return { ok: false, motif: v.motif };
    const s = normaliserSalarie(salarie, (salarie && salarie.id) || ('sal-' + (Number(quand) || 0) + '-' + livre.salaries.length));
    const dejaLa = livre.salaries.findIndex(x => x.id === s.id);
    // D'où vient la fiche (10.14.0) est un FAIT de la fiche, pas une donnée du formulaire : corriger
    // le salaire d'un salarié repris de l'exercice précédent ne le fait pas naître ici.
    if (dejaLa >= 0 && livre.salaries[dejaLa].reporteDe) s.reporteDe = livre.salaries[dejaLa].reporteDe;
    if (dejaLa >= 0) livre.salaries[dejaLa] = s; else livre.salaries.push(s);
    trace(livre, qui, dejaLa >= 0 ? 'salarie-modifie' : 'salarie-ajoute', s.nom, quand);
    return { ok: true, salarie: s };
  }

  // On ne SUPPRIME pas un salarié : son nom vit sur des bulletins, et un bulletin remis ne se
  // réécrit pas. Il devient inactif — même règle que `retiree: true` sur une clé de signature.
  function retirerSalarie(livre, id, qui, quand) {
    const s = livre.salaries.find(x => x.id === id);
    if (!s) return { ok: false, motif: 'Salarié introuvable.' };
    s.actif = false;
    trace(livre, qui, 'salarie-retire', s.nom, quand);
    return { ok: true };
  }

  const salariesActifs = (livre, dateIso) => (livre.salaries || []).filter(s =>
    (!s.embauche || s.embauche <= dateIso) && (!s.sortie || s.sortie >= dateIso));

  const bulletinsDuMois = (livre, annee, mois) => (livre.bulletins || [])
    .filter(b => Number(b.annee) === Number(annee) && Number(b.mois) === Number(mois));

  // Le SEUL juge d'un bulletin, et l'écran l'appelle pendant la frappe pour éteindre son bouton :
  // un contrôle recopié dans l'écran finirait par diverger de celui qui refuse (9.4.5).
  //
  // 10.10.0 (C-11) — un bulletin à salaire NÉGATIF devenait une écriture validée. Quarante jours
  // d'absence sur vingt-six ouvrables — la confusion la plus banale du formulaire — donnaient un
  // brut de −646 DT, et le moteur comptable, irréprochable, inversait les colonnes : 640 Salaires
  // au CRÉDIT, 425 Personnel DÉBITEUR, une pièce équilibrée au millime et parfaitement plausible
  // dans un journal de cent pièces. Ce qui manquait n'était pas un calcul, c'était une saisie
  // refusée. Et le refus dit les DEUX chiffres, parce que c'est leur rapport qui est faux.
  // (plateforme) 1.63.0 — ce qu'une prime porte en plus de son nom, de son montant et de sa case « imposable », et que
  // le Cabinet garde en réécrivant le bulletin du SkanFact de son client : une prime d'heures supplémentaires (sa
  // majoration, ses heures : le journal la range dans sa colonne, et reprendre le pointage la remplace au lieu de
  // l'ajouter une seconde fois), une prime au jour (son montant d'un mois plein, ses jours payés, ceux du mois).
  const MARQUES_DE_PRIME = ['hs', 'heures', 'parJour', 'mensuel', 'jours', 'sur'];
  const marquesDePrime = p => Object.fromEntries(MARQUES_DE_PRIME.filter(k => p && p[k] != null && p[k] !== '').map(k => [k, p[k]]));
  // Le prorata d'une entrée ou d'une sortie que porte le bulletin (1.62.0), tant que son brut est celui que le prorata
  // a calculé : retouché à la main, il n'est plus proratisé (la règle de l'entreprise).
  const prorataDuBulletin = x => (x && x.prorata && Number(x.prorata.brutFiche) > 0
    && round3(Number(x.prorata.brut)) === round3(Number(x.brut) || 0) ? x.prorata : null);

  function bulletinValide(b, livre, baremes) {
    const x = b || {};
    const s = (livre.salaries || []).find(y => y.id === x.salarieId);
    if (!s) return { ok: false, motif: 'Choisis un salarié.' };
    const m = Number(x.mois);
    if (!(m >= 1 && m <= 12)) return { ok: false, motif: 'Le mois doit être compris entre 1 et 12.' };
    if (Number(x.annee) !== Number(livre.exercice.annee)) {
      return { ok: false, motif: `Ce bulletin est daté de ${x.annee} et ce livre porte l'exercice ${livre.exercice.annee}.` };
    }
    const jumeau = (livre.bulletins || []).find(y => y.id !== x.id && y.salarieId === x.salarieId
      && Number(y.annee) === Number(x.annee) && Number(y.mois) === Number(m));
    if (jumeau) return { ok: false, motif: `${s.nom} a déjà un bulletin pour ${moisPaie(m)} ${x.annee}.` };
    return saisiePaieValide({
      year: Number(x.annee), month: Number(x.mois),
      gross: x.brut, workedDays: x.joursTravailles, absentDays: x.joursAbsence,
      bonuses: (x.primes || []).map(p => ({ label: p.label, amount: p.amount, taxable: p.taxable !== false })),
      deductions: (x.retenues || []).map(d => ({ label: d.label, amount: d.amount })),
      prorata: prorataDuBulletin(x)
    }, { grossSalary: s.brut, headOfFamily: s.chefDeFamille, children: s.enfants, contrat: s.contrat }, baremesPaie(baremes));
  }

  // La saisie d'un mois de paie, dans les termes du MOTEUR (`computePayslip`) : c'est ce qui permet
  // aux DEUX applications de l'appeler — le Cabinet par `bulletinValide`, l'app entreprise depuis
  // son formulaire de bulletin. Le moteur de paie est partagé depuis la 10.3.0 ; son garde-fou
  // l'est donc aussi, sinon l'une des deux laisserait passer ce que l'autre refuse (7.3.0).
  function saisiePaieValide(saisie, salarie, baremes) {
    const i = saisie || {};
    if (!(Number(i.gross) > 0)) return { ok: false, motif: 'Le brut du mois doit être supérieur à zéro.' };
    const ouvrables = i.workedDays == null || i.workedDays === '' ? 26 : Number(i.workedDays);
    if (!(ouvrables >= 1 && ouvrables <= 31)) {
      return { ok: false, motif: 'Les jours ouvrables du mois se comptent entre 1 et 31.' };
    }
    const absence = i.absentDays == null || i.absentDays === '' ? 0 : Number(i.absentDays);
    if (!(absence >= 0)) return { ok: false, motif: 'Les jours d\'absence ne peuvent pas être négatifs.' };
    if (absence > ouvrables) {
      return { ok: false, motif: `${plFr(absence, 'jour')} d'absence pour ${plFr(ouvrables, 'jour ouvrable', 'jours ouvrables')} dans le mois : une absence ne retient pas plus que le mois entier.` };
    }
    if ((i.bonuses || []).concat(i.deductions || []).some(p => !(Number(p && p.amount) >= 0))) {
      return { ok: false, motif: 'Une prime ou une retenue se saisit en positif : c\'est sa ligne qui dit dans quel sens elle joue.' };
    }
    // Et le calcul lui-même : une retenue plus grosse que le salaire rend un net négatif, que rien
    // d'autre ci-dessus ne peut voir. On calcule avec le MÊME moteur que l'enregistrement.
    const c = computePayslip(salarie || {}, { ...i, gross: Number(i.gross), workedDays: ouvrables, absentDays: absence }, baremes);
    if (!(c.gross > 0)) return { ok: false, motif: 'Le brut du mois, absences déduites, doit rester supérieur à zéro.' };
    if (c.net < 0) {
      return { ok: false, motif: `Les retenues (${fmtMontant(round3(c.gross - c.net))}) dépassent le brut du mois (${fmtMontant(c.gross)}) : le net serait négatif. Une avance se rembourse sur plusieurs mois.` };
    }
    return { ok: true, motif: '' };
  }

  // (plateforme) 1.64.0 — le barème d'un bulletin que le Cabinet MODIFIE : celui figé avec son calcul, les taux du client
  // ce mois-là (accident du travail, TFP, FOPROLOS…). Recalculé avec les réglages du dossier au Cabinet, un bulletin que
  // le client avait établi changeait de taux en silence. Ce qu'un régime de contrat fixait revient du régime : le sien,
  // figé, pour le même contrat ; celui du dossier, si le contrat a changé. Un bulletin nouveau prend les réglages du dossier.
  function baremesDuBulletin(livre, bulletin, baremes) {
    const r = baremes || {};
    const avant = bulletin && bulletin.id ? ((livre && livre.bulletins) || []).find(x => x.id === bulletin.id) : null;
    const c = avant && avant.calcul;
    if (!c || !c.bareme || typeof c.bareme !== 'object') return r;
    const taux = { ...c.bareme };
    delete taux.sansIrpp;
    const regime = c.regime && typeof c.regime === 'object' ? c.regime : null;
    if (regime) Object.keys(regime).forEach(k => { delete taux[k]; });
    const regimesContrat = regime && c.contrat ? { ...(r.regimesContrat || {}), [c.contrat]: { ...regime } } : r.regimesContrat;
    return { ...r, ...taux, ...(regimesContrat ? { regimesContrat } : {}) };
  }

  // Le bulletin garde une COPIE de son calcul (règle 5.0.0) : changer un barème ne doit jamais
  // réécrire un bulletin déjà remis à un salarié.
  function ajouterBulletin(livre, bulletin, baremesDuDossier, qui, quand, opts) {
    // (plateforme) 1.64.0 — un bulletin modifié se recalcule avec son barème figé (baremesDuBulletin). 1.66.0 — ou avec
    // les taux du jour du dossier, quand on le demande (`opts.tauxDuJour` : la case de la fenêtre d'un dossier tenu).
    const baremes = opts && opts.tauxDuJour ? (baremesDuDossier || {}) : baremesDuBulletin(livre, bulletin, baremesDuDossier);
    const v = bulletinValide(bulletin, livre, baremes);
    if (!v.ok) return { ok: false, motif: v.motif };
    const s = livre.salaries.find(y => y.id === bulletin.salarieId);
    const saisie = {
      // (plateforme) 1.266.3 — le mois du bulletin, pour la règle datée de la CSS : `b` recopie les champs un à un.
      year: Number(bulletin.annee), month: Number(bulletin.mois),
      gross: round3(Number(bulletin.brut) || 0),
      workedDays: Number(bulletin.joursTravailles) || 26,
      absentDays: Math.max(0, Number(bulletin.joursAbsence) || 0),
      // (plateforme) 1.63.0 — chaque prime garde ses marques (heures supplémentaires, au jour), et le bulletin son prorata.
      bonuses: (bulletin.primes || []).map(p => ({ label: String(p.label || 'Prime'), amount: round3(Number(p.amount) || 0), taxable: p.taxable !== false, ...marquesDePrime(p) })),
      // (plateforme) 1.71.0 — et chaque retenue le numéro de l'avance qu'elle rembourse (`advanceId`, que le bulletin de
      // l'entreprise y met) : il était jeté, et un bulletin établi ou MODIFIÉ au Cabinet ne remboursait rien — l'avance
      // restait ouverte chez le client, et le bulletin suivant en proposait de nouveau l'échéance.
      deductions: (bulletin.retenues || []).map(d => ({ label: String(d.label || 'Retenue'), amount: round3(Number(d.amount) || 0),
        ...(typeof d.advanceId === 'string' && d.advanceId ? { advanceId: d.advanceId } : {}) })),
      prorata: prorataDuBulletin(bulletin)
    };
    const emp = { grossSalary: s.brut, headOfFamily: s.chefDeFamille, children: s.enfants, contrat: s.contrat };
    const b = {
      id: String(bulletin.id || ('bul-' + (Number(quand) || 0) + '-' + livre.bulletins.length)),
      salarieId: s.id, annee: Number(bulletin.annee), mois: Number(bulletin.mois),
      brut: saisie.gross, joursTravailles: saisie.workedDays, joursAbsence: saisie.absentDays,
      primes: saisie.bonuses, retenues: saisie.deductions, prorata: saisie.prorata,
      calcul: computePayslip(emp, saisie, baremesPaie(baremes)),
      payeLe: String(bulletin.payeLe || ''), ecritureId: null,
      creeLe: Number(quand) || 0, auteur: String(qui || '')
    };
    const dejaLa = livre.bulletins.findIndex(x => x.id === b.id);
    if (dejaLa >= 0) {
      // Un bulletin dont l'écriture est PASSÉE ne se réécrit pas : l'écriture ferait mentir le
      // livre. On contre-passe, puis on refait — même règle que pour une dotation (9.7.0).
      if (livre.bulletins[dejaLa].ecritureId) {
        return { ok: false, motif: `L'écriture de paie de ce mois est déjà passée : ${gesteQuiLibere(livre, livre.bulletins[dejaLa].ecritureId)}.` };
      }
      b.ecritureId = null;
      livre.bulletins[dejaLa] = b;
    } else livre.bulletins.push(b);
    trace(livre, qui, dejaLa >= 0 ? 'bulletin-modifie' : 'bulletin-ajoute', `${s.nom} ${moisPaie(b.mois)} ${b.annee}`, quand);
    return { ok: true, bulletin: b };
  }

  function supprimerBulletin(livre, id, qui, quand) {
    const i = livre.bulletins.findIndex(b => b.id === id);
    if (i < 0) return { ok: false, motif: 'Bulletin introuvable.' };
    if (livre.bulletins[i].ecritureId) return { ok: false, motif: `L'écriture de paie de ce mois est déjà passée : ${gesteQuiLibere(livre, livre.bulletins[i].ecritureId)}.` };
    const b = livre.bulletins[i];
    livre.bulletins.splice(i, 1);
    trace(livre, qui, 'bulletin-supprime', `${b.salarieId} ${moisPaie(b.mois)} ${b.annee}`, quand);
    return { ok: true };
  }

  // La masse salariale d'un lot de bulletins. Tout se lit sur la COPIE figée (`calcul`) : un
  // bulletin d'avant la 9.0.0 n'a ni TFP ni FOPROLOS, et ne doit pas en gagner après coup.
  // 10.12.0 (U-21) — ce que le livre SAIT de la qualité d'employeur d'un dossier, mois par mois :
  // `true` si le mois porte un bulletin ou une écriture sur les rémunérations ou la CNSS, `false`
  // si le mois a des écritures et aucune de personnel. Un mois sans écriture n'a PAS de clé : ne pas
  // savoir n'est pas « non » (règle 9.6.0). Le calendrier ne retire un client de la CNSS que sur un
  // trimestre entièrement saisi sans une ligne de personnel — jamais sur un livre qui commence.
  function moisEmployeur(livre) {
    const out = {};
    if (!livre) return out;
    const compteDe = role => txt((((livre.plan || []).find(c => c.role === role)) || {}).compte) || COMPTES_PAIE[role];
    const prefixes = [compteDe('salairesBruts'), compteDe('cnss')].filter(Boolean);
    (livre.ecritures || []).forEach(e => {
      if (e.statut === 'contrepassee') return;
      const m = String(e.mois || String(e.date || '').slice(0, 7));
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      const perso = (e.lignes || []).some(l => prefixes.some(p => txt(l.compte).startsWith(p)));
      out[m] = !!(out[m] || perso);
    });
    (livre.bulletins || []).forEach(b => {
      const m = `${b.annee}-${String(b.mois).padStart(2, '0')}`;
      if (/^\d{4}-\d{2}$/.test(m)) out[m] = true;
    });
    return out;
  }

  function masseSalariale(bulletins) {
    const z = { brut: 0, cnssSalarie: 0, irpp: 0, css: 0, retenues: 0, net: 0,
      cnssEmployeur: 0, accident: 0, tfp: 0, foprolos: 0, chargesPatronales: 0, cout: 0, assiette: 0 };
    (bulletins || []).forEach(b => {
      const c = b.calcul || {};
      z.brut = round3(z.brut + (c.gross || 0));
      z.assiette = round3(z.assiette + (c.cnssBase || 0));
      z.cnssSalarie = round3(z.cnssSalarie + (c.cnssEmployee || 0));
      z.irpp = round3(z.irpp + (c.irpp || 0));
      z.css = round3(z.css + (c.css || 0));
      z.retenues = round3(z.retenues + (c.otherDeductions || 0));
      z.net = round3(z.net + (c.net || 0));
      z.cnssEmployeur = round3(z.cnssEmployeur + (c.cnssEmployer || 0));
      z.accident = round3(z.accident + (c.accident || 0));
      z.tfp = round3(z.tfp + (c.tfp || 0));
      z.foprolos = round3(z.foprolos + (c.foprolos || 0));
      z.chargesPatronales = round3(z.chargesPatronales + employerChargesOf(c));
      z.cout = round3(z.cout + (c.employerCost || 0));
    });
    z.count = (bulletins || []).length;
    return z;
  }

  // (plateforme) 1.247.0 — Le virement d'un salaire revenu sur le compte (docs/revue-paie-cabinet.md, « le virement
  // rejeté ») : une ligne du relevé au CRÉDIT, du montant net exact d'un bulletin marqué payé (au millime), datée du
  // paiement ou dans les 60 jours qui suivent, et dont le libellé le dit (rejet, retour, impayé, annulé, refusé). Le relevé
  // le dit ; SkanFact ne le devine pas d'un montant seul (un salaire au même net qui rentre n'est pas un rejet). Une ligne ne
  // répond qu'à un bulletin : si deux bulletins ont le même net, celui dont le salarié est nommé dans le libellé l'emporte,
  // sinon le plus ancien. Rien n'est écrit : c'est un constat, que le cabinet dit au client.
  const MOTS_DU_REJET = /\b(rejet|rejete|retour|retourne|impaye|annul|annule|refus|refuse|return|reject)/;
  function virementsRevenus(releves, bulletins, nomDe) {
    const mill = x => Math.round(Number(x || 0) * 1000);
    const jours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
    const payes = (bulletins || []).filter(b => b.payeLe && mill((b.calcul || {}).net) > 0)
      .slice().sort((a, b) => String(a.payeLe).localeCompare(String(b.payeLe)) || String(a.id).localeCompare(String(b.id)));
    const pris = new Set(), out = [];
    const lignes = [];
    (releves || []).forEach(r => (r.lignes || []).forEach(l => lignes.push({ r, l })));
    lignes.sort((x, y) => String(x.l.date).localeCompare(String(y.l.date)) || String(x.l.id).localeCompare(String(y.l.id)));
    for (const { r, l } of lignes) {
      if (mill(l.montant) <= 0) continue;
      const lib = sansAccents(`${l.libelle || ''} ${l.reference || ''}`);
      if (!MOTS_DU_REJET.test(lib)) continue;
      const candidats = payes.filter(b => !pris.has(b.id) && mill((b.calcul || {}).net) === mill(l.montant)
        && String(l.date) >= String(b.payeLe).slice(0, 10) && jours(String(b.payeLe).slice(0, 10), String(l.date)) <= 60);
      if (!candidats.length) continue;
      const nomme = candidats.find(b => { const n = sansAccents(nomDe ? nomDe(b.salarieId) : '').split(/\s+/).filter(m => m.length > 2); return n.length && n.some(m => lib.includes(m)); });
      const b = nomme || candidats[0];
      pris.add(b.id);
      out.push({ bulletin: b.id, salarieId: b.salarieId, net: round3((b.calcul || {}).net), payeLe: String(b.payeLe).slice(0, 10), date: String(l.date), libelle: String(l.libelle || ''), releve: r.id, ligne: l.id });
    }
    return out;
  }

  // L'écriture de paie du mois, en BROUILLARD. Les comptes sont ceux du dossier quand il en a, et
  // le schéma est EXACTEMENT celui de l'app entreprise (`journalEntries`, section `paie`) : deux
  // moteurs divergent, et le client et son comptable auraient alors deux écritures pour le même
  // mois sans savoir laquelle croire.
  function ecritureDePaie(livre, annee, mois, opts) {
    const o = opts || {};
    const comptes = { ...COMPTES_PAIE, ...(o.comptes || {}) };
    const lot = bulletinsDuMois(livre, annee, mois).filter(b => !b.ecritureId);
    if (!lot.length) return { ok: false, motif: 'Aucun bulletin à passer pour ce mois.' };
    // Un bulletin enregistré AVANT la 10.10.0 a pu passer avec un brut ou un net négatif (C-11).
    // Il ne devient jamais une écriture : elle inverserait les colonnes et resterait plausible.
    const faux = lot.filter(b => !((b.calcul || {}).gross > 0) || (b.calcul || {}).net < 0);
    if (faux.length) {
      const noms = faux.map(b => ((livre.salaries || []).find(s => s.id === b.salarieId) || {}).nom || 'un salarié');
      return { ok: false, motif: `Le bulletin de ${noms.join(', ')} porte un salaire négatif : corrige-le avant de passer l'écriture de paie.` };
    }
    const dernier = new Date(Date.UTC(Number(annee), Number(mois), 0)).getUTCDate();
    const date = o.date || `${annee}-${String(mois).padStart(2, '0')}-${String(dernier).padStart(2, '0')}`;
    const nomDe = id => ((livre.salaries || []).find(s => s.id === id) || {}).nom || '';
    const set = entrySet({ date, journal: o.journal || 'PAIE', piece: `PAIE-${annee}-${String(mois).padStart(2, '0')}` });
    lot.forEach(b => {
      const c = b.calcul || {};
      const qui = nomDe(b.salarieId);
      const label = `Salaire ${qui} ${moisPaie(mois)} ${annee}`;
      set.debit(comptes.salairesBruts, label, c.gross);
      set.debit(comptes.chargesPatronales, `Charges patronales — ${qui}`, round3((c.cnssEmployer || 0) + (c.accident || 0)));
      set.debit(comptes.taxesSalaires, `TFP et FOPROLOS — ${qui}`, round3((c.tfp || 0) + (c.foprolos || 0)));
      set.credit(comptes.tfpFoprolos, `TFP et FOPROLOS à payer — ${qui}`, round3((c.tfp || 0) + (c.foprolos || 0)));
      set.credit(comptes.cnss, `CNSS — ${qui}`, round3((c.cnssEmployee || 0) + (c.cnssEmployer || 0) + (c.accident || 0)));
      set.credit(comptes.irpp, `IRPP et contribution sociale — ${qui}`, round3((c.irpp || 0) + (c.css || 0)));
      set.credit(comptes.personnel, label, round3((c.net || 0) + (c.otherDeductions || 0)));
    });
    return {
      ok: true, date, lot: lot.map(b => b.id),
      ecriture: {
        date, journal: o.journal || 'PAIE', piece: `PAIE-${annee}-${String(mois).padStart(2, '0')}`,
        libelle: `Paie ${deMois(moisPaie(mois))} ${annee}`, source: 'saisie',
        lignes: set.done().map(l => ({ compte: l.account, libelle: l.label, debit: l.debit, credit: l.credit }))
      }
    };
  }

  // L'écriture est passée : chaque bulletin du lot la porte. Sans ce report, le bouton se
  // rallumerait et la paie du mois serait comptée deux fois (défaut de la dotation, 9.7.0).
  function noterEcriturePaie(livre, ids, ecritureId, qui, quand) {
    (ids || []).forEach(id => {
      const b = (livre.bulletins || []).find(x => x.id === id);
      if (b) b.ecritureId = ecritureId;
    });
    trace(livre, qui, 'paie-ecriture', plFr((ids || []).length, 'bulletin'), quand);
    return { ok: true };
  }

  // La déclaration CNSS d'un trimestre : un salarié par ligne, son assiette et les deux parts.
  // SkanFact ne DÉPOSE rien et ne se connecte à aucune administration (règle 5.2.0) : c'est un
  // tableau à recopier. L'échéance proposée est le 15 du mois qui suit le trimestre — À VÉRIFIER.
  function cnssDuTrimestre(livre, annee, trimestre) {
    const t = TRIMESTRES_PAIE.find(x => x[0] === Number(trimestre)) || TRIMESTRES_PAIE[0];
    const dans = (livre.bulletins || []).filter(b => Number(b.annee) === Number(annee) && t[2].includes(Number(b.mois)));
    const par = {};
    dans.forEach(b => {
      const s = (livre.salaries || []).find(x => x.id === b.salarieId) || {};
      const k = b.salarieId;
      par[k] = par[k] || { salarieId: k, nom: s.nom || '', cnss: s.cnss || '', cin: s.cin || '', identite: s.identiteCnss || '', mois: 0, assiette: 0, partSalarie: 0, partEmployeur: 0, accident: 0 };
      const c = b.calcul || {};
      par[k].mois++;
      par[k].assiette = round3(par[k].assiette + (c.cnssBase || 0));
      par[k].partSalarie = round3(par[k].partSalarie + (c.cnssEmployee || 0));
      par[k].partEmployeur = round3(par[k].partEmployeur + (c.cnssEmployer || 0));
      par[k].accident = round3(par[k].accident + (c.accident || 0));
    });
    const lignes = Object.keys(par).map(k => par[k]).sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
    const som = k => round3(lignes.reduce((s, l) => s + l[k], 0));
    const finMois = t[2][2] + 1;
    return {
      annee: Number(annee), trimestre: Number(trimestre), libelle: t[1], mois: t[2],
      lignes, salaries: lignes.length, bulletins: dans.length,
      assiette: som('assiette'), partSalarie: som('partSalarie'), partEmployeur: som('partEmployeur'),
      accident: som('accident'),
      total: round3(som('partSalarie') + som('partEmployeur') + som('accident')),
      // Le 4e trimestre bascule sur l'année suivante : `finMois` vaut alors 13.
      echeance: finMois > 12 ? `${Number(annee) + 1}-01-15` : `${annee}-${String(finMois).padStart(2, '0')}-15`
    };
  }

  // ---------- Le fichier de télédéclaration CNSS (format « DS », nouvelle version 2012) ----------
  // Le document de la CNSS fixe un enregistrement de 122 caractères par salarié : employeur
  // (matricule 8 + clé 2), code d'exploitation (4), trimestre (1) et année (4), n° de page (3) et de
  // ligne (2) — exactement 12 lignes par page, sans trou ni doublon —, assuré (matricule 8 + clé 2),
  // identité (60, en majuscules, « prénom, prénom du père, nom » comme sur la carte d'assuré), CIN
  // (8), salaire du trimestre en millimes sans virgule (10) et une zone vierge (10). Le nom du fichier
  // est « DS » + employeur sur 10 chiffres + code sur 4 + « . » + trimestre + année.
  // SkanFact ne DÉPOSE rien (règle 5.2.0) : il fabrique le fichier que le portail demande. Et il n'en
  // fabrique AUCUN tant qu'une ligne est fausse — un fichier rejeté le jour de l'échéance coûte plus
  // cher qu'un refus qui nomme la case à corriger. Le format porte sa version : quand la CNSS en
  // publiera une autre, c'est ici qu'elle s'écrira, et l'écran le dit.
  const FORMAT_CNSS = { nom: 'CNSS 2012', longueur: 122, lignesParPage: 12 };

  // Un matricule CNSS s'écrit « 123456-72 » : le matricule, puis sa clé sur deux chiffres. Sans
  // séparateur, les deux derniers chiffres sont la clé. On ne CALCULE pas la clé (la règle n'est pas
  // publiée ici) : on vérifie seulement la forme.
  function lireMatriculeCnss(txt) {
    const brut = String(txt == null ? '' : txt).trim();
    if (!brut) return { ok: false, motif: 'manquant' };
    const parts = brut.split(/[\s\-/.]+/).filter(Boolean);
    let mat, cle;
    if (parts.length === 2) { mat = parts[0]; cle = parts[1]; }
    else if (parts.length === 1) { mat = parts[0].slice(0, -2); cle = parts[0].slice(-2); }
    else return { ok: false, motif: 'forme' };
    if (!/^\d{1,8}$/.test(mat) || !/^\d{2}$/.test(cle)) return { ok: false, motif: 'forme' };
    return { ok: true, matricule: mat.padStart(8, '0'), cle, texte: mat.padStart(8, '0') + cle };
  }

  // L'identité passe en MAJUSCULES sans accents (le fichier est en ASCII : aucun encodage à deviner).
  // Ce qui n'est pas une lettre latine — un nom saisi en arabe — ne se translittère pas au hasard :
  // on le refuse, et la fiche du salarié a un champ pour l'écrire comme sur sa carte d'assuré.
  function identiteCnss(txt) {
    const t = String(txt == null ? '' : txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      // La virgule SÉPARE ce que la CNSS demande (« prénom, prénom du père, nom ») : c'est ainsi
      // que l'invite du champ l'écrit, donc ainsi qu'on le tape. Refuser la virgule qu'on vient de
      // souffler, c'était dire « pas en lettres latines » d'une identité qui l'est (test humain).
      .replace(/[’`]/g, '\'').replace(/[,;/]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!t) return { ok: false, motif: 'manquant' };
    if (!/^[A-Z][A-Z '.-]*$/.test(t)) {
      // Le refus NOMME ce qui ne passe pas : « lettres latines » ne se corrige pas sans savoir quoi.
      const hors = [...new Set(t.replace(/[A-Z '.-]/g, ''))].join(' ');
      return { ok: false, motif: 'latin', car: hors };
    }
    if (t.length > 60) return { ok: false, motif: 'long' };
    return { ok: true, texte: t };
  }

  const MOTIFS_CNSS = {
    employeur: {
      manquant: 'Le matricule CNSS de l\'employeur manque.',
      forme: 'Le matricule CNSS de l\'employeur n\'a pas la forme 123456-72 (huit chiffres au plus, puis la clé sur deux).'
    },
    code: { forme: 'Le code d\'exploitation doit tenir en quatre chiffres (0000 pour le code ordinaire).' },
    cnss: {
      manquant: 'Son numéro d\'assuré CNSS manque.',
      forme: 'Son numéro d\'assuré CNSS n\'a pas la forme 12345678-90 (huit chiffres au plus, puis la clé sur deux).'
    },
    identite: {
      manquant: 'Son identité manque.',
      latin: 'Son identité doit s\'écrire en lettres latines, comme sur sa carte d\'assuré.',
      long: 'Son identité dépasse les 60 caractères que le fichier accepte.'
    },
    cin: { forme: 'Son numéro de CIN doit compter huit chiffres.' },
    salaire: {
      negatif: 'Son salaire du trimestre est négatif.',
      trop: 'Son salaire du trimestre dépasse ce que le fichier peut écrire (dix chiffres en millimes).'
    }
  };

  // La phrase d'un refus d'identité, pour le fichier ET pour la fiche du salarié (qui refuse à la
  // saisie) : deux phrases pour le même refus finiraient par ne pas dire la même chose.
  function motifIdentiteCnss(id) {
    const r = id || {};
    if (r.ok) return '';
    if (r.motif === 'latin' && r.car) return `Son identité contient « ${r.car} » : seules les lettres latines, l'espace, le tiret, le point et l'apostrophe passent dans le fichier, comme sur sa carte d'assuré.`;
    return MOTIFS_CNSS.identite[r.motif] || MOTIFS_CNSS.identite.latin;
  }

  function fichierCnss(o) {
    const e = o || {};
    const refus = [];
    const avertissements = [];
    const emp = lireMatriculeCnss(e.employeur);
    if (!emp.ok) refus.push({ champ: 'employeur', motif: MOTIFS_CNSS.employeur[emp.motif] });
    const codeTxt = String(e.code == null || e.code === '' ? '0' : e.code).trim();
    const code = /^\d{1,4}$/.test(codeTxt) ? codeTxt.padStart(4, '0') : null;
    if (!code) refus.push({ champ: 'code', motif: MOTIFS_CNSS.code.forme });
    const annee = Number(e.annee);
    const trimestre = Number(e.trimestre);
    if (!(annee >= 1000 && annee <= 9999) || ![1, 2, 3, 4].includes(trimestre)) refus.push({ champ: 'periode', motif: 'La période déclarée est invalide.' });
    const lignes = (e.lignes || []).filter(l => l);
    if (!lignes.length) refus.push({ champ: 'lignes', motif: 'Aucun salaire à déclarer sur ce trimestre.' });
    if (lignes.length > 999 * FORMAT_CNSS.lignesParPage) refus.push({ champ: 'lignes', motif: 'Trop de salariés pour un seul fichier.' });
    let total = 0;
    const vus = new Map();
    const faites = lignes.map((l, i) => {
      const qui = { salarieId: l.salarieId || '', nom: l.nom || '' };
      const nt = refus.length;
      const cn = lireMatriculeCnss(l.cnss);
      if (!cn.ok) refus.push({ ...qui, champ: 'cnss', motif: MOTIFS_CNSS.cnss[cn.motif] });
      // (1.248.1) Deux salariés sous le même n° d'assuré : le fichier mêlerait leurs salaires sur un seul compte CNSS
      // (recette du 02/11 : cinq fiches recopiées sur la première, et le fichier sortait). Le second se corrige.
      else if (vus.has(cn.texte)) refus.push({ ...qui, champ: 'cnss', motif: `Son n° CNSS est déjà celui de ${vus.get(cn.texte) || 'un autre salarié'} : chaque salarié a le sien, sur sa carte d'assuré.` });
      else vus.set(cn.texte, l.nom || '');
      const id = identiteCnss(l.identite || l.nom);
      if (!id.ok) refus.push({ ...qui, champ: 'identite', motif: motifIdentiteCnss(id) });
      else if (!String(l.identite || '').trim()) avertissements.push({ ...qui, champ: 'identite', motif: 'Son identité reprend son nom tel qu\'il est saisi : la CNSS demande « prénom, prénom du père, nom », comme sur sa carte d\'assuré (le nom de jeune fille pour une femme mariée). À VÉRIFIER.' });
      const cinTxt = String(l.cin == null ? '' : l.cin).replace(/\s+/g, '');
      if (cinTxt && !/^\d{8}$/.test(cinTxt)) refus.push({ ...qui, champ: 'cin', motif: MOTIFS_CNSS.cin.forme });
      if (!cinTxt) avertissements.push({ ...qui, champ: 'cin', motif: 'Son numéro de CIN manque : la case part vide. À VÉRIFIER — le portail peut la refuser.' });
      const millimes = Math.round((Number(l.salaire) || 0) * 1000);
      if (millimes < 0) refus.push({ ...qui, champ: 'salaire', motif: MOTIFS_CNSS.salaire.negatif });
      else if (millimes > 9999999999) refus.push({ ...qui, champ: 'salaire', motif: MOTIFS_CNSS.salaire.trop });
      if (refus.length > nt || !emp.ok || !code) return null;
      total += millimes;
      const page = Math.floor(i / FORMAT_CNSS.lignesParPage) + 1;
      const ligne = (i % FORMAT_CNSS.lignesParPage) + 1;
      return emp.texte + code + String(trimestre) + String(annee) +
        String(page).padStart(3, '0') + String(ligne).padStart(2, '0') +
        cn.texte + id.texte.padEnd(60, ' ') + (cinTxt || '').padEnd(8, ' ') +
        String(millimes).padStart(10, '0') + ' '.repeat(10);
    });
    const ok = !refus.length;
    return {
      ok, format: FORMAT_CNSS.nom, refus, avertissements,
      lignes: lignes.length, total: round3(total / 1000),
      nom: ok ? `DS${emp.texte}${code}.${trimestre}${annee}` : '',
      // Chaque salarié sur sa ligne, chaque ligne finie par un retour chariot (l'ancien format le
      // précise, le nouveau ne le contredit pas).
      contenu: ok ? faites.map(r => r + '\r\n').join('') : ''
    };
  }

  // Le fichier d'un trimestre, depuis le LIVRE : la même fonction pour l'écran (qui annonce les
  // refus avant le geste) et pour le processus principal (qui écrit le fichier) — deux calculs
  // finiraient par ne pas dire la même chose. Le salaire déclaré est l'ASSIETTE du trimestre.
  function fichierCnssDuLivre(livre, employeur, annee, trimestre) {
    const t = cnssDuTrimestre(livre, annee, trimestre);
    const e = employeur || {};
    return fichierCnss({
      employeur: e.matricule, code: e.code, annee: t.annee, trimestre: t.trimestre,
      lignes: t.lignes.map(l => ({ salarieId: l.salarieId, nom: l.nom, identite: l.identite, cnss: l.cnss, cin: l.cin, salaire: l.assiette }))
    });
  }

  // Ce qui manque avant de déclarer ou de passer l'écriture. On NOMME, on ne bloque jamais
  // (règle 6.0.0) : un mois déclaré avec deux manques signalés vaut mieux qu'un mois jamais déclaré.
  function controlesPaie(livre, annee, mois) {
    const out = [];
    const add = (id, niveau, quoi, detail, n) => out.push({ id, niveau, quoi, detail, count: n });
    const fin = `${annee}-${String(mois).padStart(2, '0')}-28`;
    const attendus = salariesActifs(livre, fin).filter(s => s.actif);
    const faits = bulletinsDuMois(livre, annee, mois);
    const sans = attendus.filter(s => !faits.some(b => b.salarieId === s.id));
    if (sans.length) add('bulletins-manquants', 'warn', `${plFr(sans.length, 'salarié')} sans bulletin`,
      sans.map(s => s.nom).join(', '), sans.length);
    const sansCnss = attendus.filter(s => !s.cnss);
    // On NOMME (10.3.0) : « 1 salarié sans numéro CNSS » ne se traduit en aucun geste, « Yassine
    // Gharbi » si — et `ids` permet à l'écran d'ouvrir sa fiche (vu au test humain, 10.12.0).
    if (sansCnss.length) {
      add('cnss-manquant', 'warn', `${plFr(sansCnss.length, 'salarié')} sans numéro CNSS`,
        `${sansCnss.map(s => s.nom).join(', ')} — la déclaration trimestrielle demande le numéro de chaque salarié.`, sansCnss.length);
      out[out.length - 1].ids = sansCnss.map(s => s.id);
    }
    const negatifs = faits.filter(b => !((b.calcul || {}).gross > 0) || (b.calcul || {}).net < 0);
    if (negatifs.length) add('bulletin-negatif', 'err', `${plFr(negatifs.length, 'bulletin')} à salaire négatif`,
      negatifs.map(b => ((livre.salaries || []).find(s => s.id === b.salarieId) || {}).nom || '').filter(Boolean).join(', ')
        + ' — l\'absence ou une retenue dépasse le mois : à corriger avant l\'écriture.', negatifs.length);
    // Le net dû au personnel se LIT dans le livre (10.12.0). « 2 bulletins non réglés — tant que le
    // règlement n'est pas noté » promettait un geste qu'aucun écran du Cabinet n'offre : `payeLe` vient
    // du modèle de l'app entreprise, et rien ne le pose ici. Chaque bulletin du Cabinet se disait donc
    // « non réglé » pour toujours, y compris sur un compte du personnel soldé. Ce que le comptable veut
    // savoir, c'est ce que ce compte porte encore à la fin du mois — et il ne porte rien tant que
    // l'écriture de paie n'est pas passée : c'est alors l'étape suivante, pas un impayé.
    const cPers = txt(((livre.plan || []).find(c => c.role === 'personnel') || {}).compte) || COMPTES_PAIE.personnel;
    const finMois = `${annee}-${String(mois).padStart(2, '0')}-${String(new Date(Date.UTC(Number(annee), Number(mois), 0)).getUTCDate()).padStart(2, '0')}`;
    const mp = mouvementCompte(livre, cPers, (livre.exercice || {}).du || '', finMois);
    const duPersonnel = round3(mp.credit - mp.debit);
    if (duPersonnel > 0) add('non-payes', 'info', `${fmtMontant(duPersonnel, 'DT')} dus au personnel`,
      `le compte ${cPers} porte ce net au ${fmtJour(finMois)} : le règlement des salaires n'est pas encore écrit.`, 1);
    return out;
  }

