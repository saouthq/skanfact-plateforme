  // ---------- paie (5.0.0) ----------
  // Le module où une erreur coûte juridiquement cher. Trois principes, dans cet ordre :
  //
  //  1. AUCUN TAUX N'EST ÉCRIT EN DUR dans un calcul. Tout vient de `payrollSettings(data)`, que
  //     l'utilisateur modifie : les barèmes changent à chaque loi de finances, et une application qui
  //     les fige devient fausse en silence l'année suivante.
  //  2. Les valeurs livrées sont INDICATIVES. Elles portent un « À VÉRIFIER avec ton comptable » visible
  //     partout où elles servent, et les premiers bulletins portent une mention imprimée.
  //  3. Le bulletin garde une COPIE de ce qui a servi à le calculer. Changer un barème ne doit jamais
  //     réécrire l'histoire d'un bulletin déjà remis à un salarié.

  // Le moteur de paie vit dans `compta.js` depuis la 10.3.0, et core.js le réexporte à l'identique.
  // La règle de découpage de la 9.1.0, relue dans les deux sens (9.6.1) : ces fonctions prennent un
  // SALARIÉ et une SAISIE, jamais `data`. Elles étaient du mauvais côté depuis la 5.0.0, et ça ne
  // s'était jamais vu parce que personne d'autre n'en avait besoin — le Cabinet, lui, en a besoin
  // pour tenir la paie des dossiers qui ne sont PAS sur SkanFact, et il ne charge pas core.js.
  // La seule alternative au déménagement était la recopie, et une copie diverge, toujours.
  const CONTRACT_TYPES = Compta.CONTRACT_TYPES;
  // Le jour LOCAL d'un instant (10.12.0) : la même fonction que le Cabinet, jamais une copie.
  const jourDeLInstant = Compta.jourDeLInstant;
  const contractLabel = Compta.contractLabel;
  const DEFAULT_PAYROLL = Compta.DEFAULT_PAYROLL;

  function payrollSettings(data) {
    const regle = (data && data.payrollSettings) || {};
    const r = Compta.baremesPaie(regle);
    // La TFP du métier, PROPOSÉE (9.1.1) : seulement tant que personne n'a réglé le taux à la main
    // — ni en le saisissant (`tfpRate` présent), ni en touchant le champ (`tfpTouche`). C'est le
    // motif de `regimeTouche` (7.25.0) et de la durée proposée par la famille d'un bien : proposer
    // ne veut rien dire si la proposition écrase ensuite ce qu'on a décidé.
    if (regle.tfpRate === undefined && !regle.tfpTouche) {
      const p = tfpSuggere(((data && data.company) || {}).activity);
      if (p !== null) r.tfpRate = p;
    }
    return r;
  }

  const irppAnnual = Compta.irppAnnual;
  const computePayslip = Compta.computePayslip;
  const saisiePaieValide = Compta.saisiePaieValide;
  const employerChargesOf = Compta.employerChargesOf;

  const activeEmployees = (data, dateIso) => {
    const t = dateIso || today();
    return (data.employees || []).filter(e => (!e.hireDate || e.hireDate <= t) && (!e.endDate || e.endDate >= t));
  };

  // Un bulletin porte sa propre copie du calcul : rejouer le barème d'aujourd'hui sur un bulletin de
  // l'an dernier donnerait un autre chiffre que celui remis au salarié.
  function payslipView(slip, data) {
    const emp = (data.employees || []).find(e => e.id === slip.employeeId) || {};
    const c = slip.computed || computePayslip(emp, slip, payrollSettings(data));
    return { ...slip, employeeName: emp.name || '', employee: emp, c };
  }

  function payslipsOf(data, year, month) {
    return (data.payslips || [])
      .filter(p => (!year || Number(p.year) === Number(year)) && (!month || Number(p.month) === Number(month)))
      .map(p => payslipView(p, data))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month) || (a.employeeName || '').localeCompare(b.employeeName || '', 'fr'));
  }

  // La date d'un bulletin, pour les périodes : le dernier jour du mois concerné.
  function payslipDate(slip) {
    const y = Number(slip.year), m = Number(slip.month);
    if (!y || !m) return '';
    return addDays(`${y}-${String(m).padStart(2, '0')}-01`, daysInMonth(y, m) - 1);
  }

  // Ce que la paie coûte vraiment sur une période : le coût employeur, pas le net versé.
  function payrollCost(data, period) {
    return round3((data.payslips || []).filter(p => inPeriod(payslipDate(p), period && period.from, period && period.to))
      .reduce((s, p) => s + ((p.computed || {}).employerCost || 0), 0));
  }

  function payrollSummary(data, year) {
    const rows = payslipsOf(data, year);
    const sum = f => round3(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
    return {
      count: rows.length,
      employees: new Set(rows.map(r => r.employeeId)).size,
      gross: sum(r => r.c.gross), net: sum(r => r.c.net),
      cnssEmployee: sum(r => r.c.cnssEmployee), cnssEmployer: sum(r => r.c.cnssEmployer),
      irpp: sum(r => r.c.irpp), css: sum(r => r.c.css), accident: sum(r => r.c.accident),
      tfp: sum(r => r.c.tfp), foprolos: sum(r => r.c.foprolos),
      cost: sum(r => r.c.employerCost),
      // Ce qui est VRAIMENT versé : un bulletin établi et pas encore payé n'a rien versé (10.12.0).
      netPaid: round3(rows.filter(r => r.paidDate).reduce((s, r) => s + (Number(r.c.net) || 0), 0)),
      unpaid: rows.filter(r => !r.paidDate).length,
      rows
    };
  }

  // Les bulletins du mois qui manquent : un salarié actif sans bulletin, c'est un oubli, pas un choix.
  // Les bulletins IMPOSSIBLES (rapport QA E-04). La 10.10.0 a fermé la porte — une absence plus
  // longue que le mois, une retenue plus grosse que le salaire, et le bulletin est refusé — mais elle
  // ne nettoie pas ce qui est passé AVANT : un bulletin à net négatif reste enregistré, son écriture
  // est inversée, et la déclaration CNSS du trimestre l'additionne (« − 168,970 DT », prête à être
  // marquée déposée). On le lit sur la COPIE figée du calcul (`computed`, règle 5.0.0) : c'est elle
  // qui a été remise et déclarée. Un bulletin sans copie (antérieur à la 5.0.0) n'est pas jugé ici.
  function bulletinsImpossibles(data) {
    return (data.payslips || []).filter(p => p && p.computed
      && (Number(p.computed.net) < 0 || !(Number(p.computed.gross) > 0)))
      .map(p => ({ id: p.id, employeeId: p.employeeId, year: p.year, month: p.month,
        net: round3(Number(p.computed.net) || 0), gross: round3(Number(p.computed.gross) || 0) }));
  }

  function missingPayslips(data, year, month) {
    const done = new Set((data.payslips || []).filter(p => Number(p.year) === Number(year) && Number(p.month) === Number(month)).map(p => p.employeeId));
    const first = `${year}-${String(month).padStart(2, '0')}-01`, last = addDays(first, daysInMonth(year, month) - 1);
    // (1.248.0) En poste UN jour du mois suffit, comme au Cabinet : un CDD qui finit le 20 a son bulletin du 1er au 20
    // (au prorata). La règle lisait le dernier jour du mois : le salarié sorti en cours de mois n'avait aucun bulletin.
    return (data.employees || []).filter(e => (!e.hireDate || e.hireDate <= last) && (!e.endDate || e.endDate >= first) && !done.has(e.id));
  }

  // Les années que la Paie propose (10.14.1) : celles qui portent des bulletins, l'année en cours, ET
  // chaque année où un salarié était en poste. La liste ne portait que les années qui avaient DÉJÀ
  // des bulletins : un salarié embauché en 2023, et « Clôturer jusqu'à… » annonçait quarante-quatre
  // bulletins à établir pendant que la Paie n'offrait que l'année en cours — aucune porte vers le
  // manque qu'elle nommait (7.15.0). Un salarié sans date d'embauche ne remonte pas plus loin que les
  // bulletins qu'il a déjà.
  function anneesDePaie(data, todayIso) {
    const cette = Number((todayIso || today()).slice(0, 4));
    const ans = new Set([cette]);
    (data.payslips || []).forEach(p => { const y = Number(p.year); if (y > 1900 && y <= 9999) ans.add(y); });
    (data.employees || []).forEach(e => {
      const entree = Number(String(e.hireDate || '').slice(0, 4));
      if (!(entree > 1900)) return;
      const sortie = Number(String(e.endDate || '').slice(0, 4)) || cette;
      // Le nombre d'années se compte d'avance, et se borne (règle 5.2.3).
      for (let y = entree, n = 0; y <= Math.min(sortie, cette) && n < 100; y++, n++) ans.add(y);
    });
    return [...ans].sort((a, b) => b - a).map(String);
  }

  // 10.12.0 — le mois sur lequel s'ouvre l'onglet Bulletins. C'était toujours le mois PRÉCÉDENT : une
  // menuiserie qui embauche son premier ouvrier le 24 septembre ouvrait la Paie sur août, lisait
  // « Aucun salarié en poste en août 2026 : il n'y a pas de bulletin à établir », et rien ne menait à
  // septembre. On ouvre là où il y a quelque chose à faire (U-12 : jamais un mois futur) : le mois
  // précédent s'il lui manque un bulletin, sinon le mois en cours s'il a quelqu'un en poste, sinon
  // le précédent.
  function moisDePaie(data, todayIso) {
    const t = todayIso || today();
    const courant = t.slice(0, 7) + '-01';
    const avant = addMonths(courant, -1, 1);
    const ym = iso => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });
    const a = ym(avant), c = ym(courant);
    if (missingPayslips(data, a.year, a.month).length) return a;
    // (1.355.0) Le mois d'avant établi et pas encore payé : c'est lui qui attend, même si le bulletin du mois en cours manque
    // (il ne se prépare qu'en fin de mois). La page s'ouvrait sur novembre, vide, pendant qu'octobre attendait d'être payé.
    if (payslipsOf(data, a.year, a.month).some(x => !x.paidDate)) return a;
    if (missingPayslips(data, c.year, c.month).length || payslipsOf(data, c.year, c.month).length) {
      if (!payslipsOf(data, a.year, a.month).length || missingPayslips(data, c.year, c.month).length) return c;
      // (1.248.1) Le mois d'avant tout payé, le mois en cours déjà établi : c'est lui qui attend (recette du 02/11 : la page
      // restait sur octobre, payé et remis, pendant que novembre attendait d'être payé).
      if (payslipsOf(data, a.year, a.month).every(x => x.paidDate) && payslipsOf(data, c.year, c.month).some(x => !x.paidDate)) return c;
    }
    return a;
  }

  // (plateforme) 1.222.0 — l'état d'un mois de paie, pour sa frise et ses trois chiffres (docs/paie.md, « La paie appliquée »).
  // Chaque étape se DÉDUIT des faits (bulletins établis, payés, remis ; CNSS du trimestre déposée) : rien n'est écrit d'avance.
  const MOIS_PAIE = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // (1.330.0) « la déclaration d'octobre », jamais « de octobre » (avril, août aussi).
  const deMoisPaie = m => (/^[aeiouéè]/i.test(MOIS_PAIE[m - 1]) ? 'd’' : 'de ') + MOIS_PAIE[m - 1];
  function paieDuMois(data, year, month, opts) {
    const y = Number(year), m = Number(month), cur = (data.company || {}).currency || 'TND';
    const L = payslipsOf(data, y, m), manque = missingPayslips(data, y, m), n = L.length + manque.length;
    const payes = L.filter(x => x.paidDate), remis = L.filter(x => x.remisLe);
    const somme = f => round3(L.reduce((a, x) => a + (Number(f(x.c)) || 0), 0));
    const net = somme(c => c.net), cout = somme(c => c.employerCost), brut = somme(c => c.gross);
    const especes = round3(L.filter(x => x.method === 'especes').reduce((a, x) => a + x.c.net, 0));
    const impots = somme(c => c.irpp + c.css + (c.tfp || 0) + (c.foprolos || 0));
    const cnss = somme(c => c.cnssEmployee + (c.cnssEmployer || 0) + (c.accident || 0));
    const ma = m === 1 ? 12 : m - 1, ya = m === 1 ? y - 1 : y;
    const avant = {}; payslipsOf(data, ya, ma).forEach(x => { avant[x.employeeId] = x.c.net; });
    const coutAvant = round3(payslipsOf(data, ya, ma).reduce((a, x) => a + x.c.employerCost, 0));
    // (1.355.0) Le pointage validé (une version du mois, non rouverte) est un mois pointé : l'étape disait « sauté : chacun
    // payé au mois complet » d'un mois qu'on venait de valider, dès que son bulletin existait.
    const ymP = `${y}-${String(m).padStart(2, '0')}`;
    const pointe = (data.timesheets || []).some(t => Number(t.year) === y && Number(t.month) === m)
      || ((data.pointageVersions || []).some(v => v.ym === ymP) && !(data.pointageOuverts || []).includes(ymP));
    const finMois = addDays(`${y}-${String(m).padStart(2, '0')}-01`, daysInMonth(y, m) - 1), enCours = today() <= finMois;
    const q = Math.ceil(m / 3), cnssDeposee = (data.socialFilings || []).some(f => f.id === `cnss-${y}-T${q}`);
    const tousPayes = L.length > 0 && !manque.length && payes.length === L.length, tousRemis = tousPayes && remis.length === L.length;
    const jours = [...new Set(payes.map(x => x.paidDate))];
    const bap = !!(opts && opts.bap), aApprouver = L.filter(x => !x.paidDate && !x.bonAPayerLe).length;
    const corrige = L.filter(x => x.correction && !x.correction.reponse && !x.paidDate).length;
    const etapes = [
      // (1.248.0) Passée sans pointage, l'étape ne se dit pas « pointée » : elle dit ce qui a servi (recette du 02/11).
      // (1.253.0) Le mois en cours se pointe jusqu'à son dernier jour : il n'est ni « pointé » ni « sauté » avant.
      { titre: 'Pointer', fait: L.length > 0 && !enCours, dit: enCours ? `en cours, jusqu'au ${fmtDate(finMois)}` : pointe ? 'le mois est pointé' : L.length ? 'sauté : chacun payé au mois complet' : 'facultatif : absences et heures sup' },
      // (plateforme) 1.227.0 — le bon à payer et la correction proposée se lisent sur l'étape des bulletins (la maquette) :
      // établis ne suffit plus quand le cabinet tient la paie, il faut aussi ton accord ; une correction en attente se dit.
      { titre: 'Bulletins', fait: n > 0 && !manque.length && !corrige && (!bap || !aApprouver), dit: !n ? 'aucun salarié en poste' : manque.length ? `${L.length} sur ${n} établis`
        : corrige ? `${n} établi${n > 1 ? 's' : ''} : ${corrige} correction${corrige > 1 ? 's' : ''} proposée${corrige > 1 ? 's' : ''}`
          : bap && aApprouver ? `${n} établi${n > 1 ? 's' : ''} · ${aApprouver > 1 ? `${aApprouver} à approuver` : '1 à approuver'}` : `${n} établi${n > 1 ? 's' : ''}${bap ? ' · approuvés' : ''}` },
      { titre: 'Payer', fait: tousPayes, dit: !L.length ? 'après les bulletins' : tousPayes ? (jours.length === 1 ? `payés le ${fmtDate(jours[0])}` : 'tous payés') : `${L.length - payes.length} à payer · ${money(round3(L.filter(x => !x.paidDate).reduce((a, x) => a + x.c.net, 0)), cur)}` },
      { titre: 'Remettre', fait: tousRemis, dit: !L.length ? 'un bulletin à chaque salarié' : tousRemis ? 'chacun a son bulletin' : `${L.length - remis.length} à remettre` },
      { titre: 'Déclarer', fait: tousRemis && cnssDeposee, dit: cnssDeposee ? `CNSS du ${q}${q === 1 ? 'er' : 'e'} trimestre déposée` : `la retenue avec la déclaration ${deMoisPaie(m)} · la CNSS au trimestre` }
    ];
    // Une seule étape « ici » : la première qui n'est pas faite.
    let ici = false;
    etapes.forEach(e => { e.etat = e.fait ? 'fait' : ici ? '' : 'ici'; if (!e.fait) ici = true; });
    return {
      etapes, net, cout, brut, impots, cnss, etat: round3(impots + cnss), avant, moisAvant: ma,
      netDit: especes ? `${money(round3(net - especes), cur)} par virement, ${money(especes, cur)} en espèces` : 'par virement',
      coutDit: `brut ${money(brut, cur)} + charges ${money(round3(cout - brut), cur)}${coutAvant ? ` · ${Math.abs(round3(cout - coutAvant)) < 0.0005 ? `comme ${MOIS_PAIE[ma - 1]}` : `${money(Math.abs(round3(cout - coutAvant)), cur)} de ${cout > coutAvant ? 'plus' : 'moins'} qu’en ${MOIS_PAIE[ma - 1]}`}` : ''}`,
      etatDit: `${money(impots, cur)} avec la déclaration ${deMoisPaie(m)} · ${money(cnss, cur)} de CNSS au trimestre`
    };
  }
  // Ce qui attend un geste sur les fiches des salariés en poste : un RIB qui manque à un virement, un n° CNSS, un CDD qui finit
  // dans les deux mois. Chaque ligne nomme son salarié et la case de sa fiche à remplir (`focus`).
  const PAIE_COULEURS = ['#0e7c96', '#7c5ad6', '#c2700f', '#3f6fd8', '#c0417a', '#1c8f5a'];
  const initialesDe = nom => String(nom || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
  const couleurDe = nom => PAIE_COULEURS[[...String(nom || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PAIE_COULEURS.length];
  // (plateforme) 1.227.0 — les contrôles des bulletins d'un mois, avant le bon à payer (la maquette, « Ce que … a contrôlé ») :
  // chacun dit s'il est juste (`ok`) ou ce qu'il faut savoir, et nomme le salarié. Aucun seuil inventé : le SMIG n'est pas
  // un réglage de la paie, il n'est donc pas contrôlé ici (À VÉRIFIER : l'ajouter aux réglages avec sa date).
  function controlesDuMois(data, year, month) {
    const y = Number(year), m = Number(month), ym = `${y}-${String(m).padStart(2, '0')}`;
    const debut = `${ym}-01`, fin = addDays(debut, daysInMonth(y, m) - 1);
    const L = payslipsOf(data, y, m), manque = missingPayslips(data, y, m), out = [];
    if (!L.length) return out;
    const add = (id, ok, titre, dit) => out.push({ id, ok, titre, dit: dit || '' });
    const noms = l => l.length > 3 ? `${l.slice(0, 3).join(', ')} et ${l.length - 3} autre${l.length > 4 ? 's' : ''}` : l.join(', ');
    add('bulletins', !manque.length, 'Un bulletin pour chaque salarié en poste', manque.length ? `${noms(manque.map(e => e.name))} : pas encore établi` : `${L.length} sur ${L.length}`);
    const neg = L.filter(x => !(x.c.net > 0));
    add('net', !neg.length, 'Aucun net négatif ni nul', neg.length ? `${noms(neg.map(x => x.employeeName))} : une absence ou une retenue dépasse le mois` : '');
    const ma = m === 1 ? 12 : m - 1, ya = m === 1 ? y - 1 : y, avant = {};
    payslipsOf(data, ya, ma).forEach(x => { avant[x.employeeId] = x; });
    const ecarts = L.filter(x => avant[x.employeeId] && Math.abs(x.c.net - avant[x.employeeId].c.net) >= 0.0005).map(x => {
      const a = avant[x.employeeId], d = round3(x.c.net - a.c.net), pq = [];
      if ((Number(x.absentDays) || 0) !== (Number(a.absentDays) || 0)) pq.push(`${Number(x.absentDays) || 0} j d'absence`);
      // (1.248.0) Le brut d'un mois d'entrée ou de sortie change par le prorata : on dit pourquoi, pas « brut changé ».
      const sortie = x.employee.endDate && x.employee.endDate >= debut && x.employee.endDate < fin, entree = x.employee.hireDate && x.employee.hireDate > debut && x.employee.hireDate <= fin;
      if (round3(x.gross) !== round3(a.gross)) pq.push(sortie ? `sortie le ${fmtDate(x.employee.endDate)}` : entree ? `entrée le ${fmtDate(x.employee.hireDate)}` : 'brut changé');
      const prime = l => round3((l || []).reduce((s, b) => s + (Number(b.amount) || 0), 0));
      if (prime(x.bonuses) !== prime(a.bonuses)) pq.push('primes');
      if (prime(x.deductions) !== prime(a.deductions)) pq.push('retenues');
      return `${x.employeeName.split(/\s+/)[0]} ${d > 0 ? '+' : '−'} ${money(Math.abs(d), (data.company || {}).currency || 'TND').replace(/\s*(DT|TND)$/, '')}${pq.length ? ` : ${pq.join(', ')}` : ''}`;
    });
    // (1.248.0) Sans bulletin le mois d'avant, il n'y a rien à comparer : le contrôle ne se dit pas « juste » (recette du 02/11).
    if (Object.keys(avant).length) add('ecarts', true, `Écarts sur ${MOIS_PAIE[ma - 1]}`, ecarts.length ? ecarts.slice(0, 3).join(' · ') + (ecarts.length > 3 ? ' …' : '') : 'aucun : les nets sont les mêmes');
    // (1.248.0) Un même RIB pour deux salariés payés par virement : une erreur de saisie, ou un virement détourné.
    const parRib = {};
    L.forEach(x => { const e = (data.employees || []).find(z => z.id === x.employeeId) || {}; const r = String(e.iban || '').replace(/\s/g, '');
      if (r && (x.method || e.method) !== 'especes') (parRib[r] = parRib[r] || []).push(x.employeeName); });
    const doubles = Object.values(parRib).filter(l => l.length > 1);
    add('rib-double', !doubles.length, 'Pas deux salariés sur le même RIB', doubles.length ? doubles.map(l => `${noms(l)} : le même RIB`).join(' · ') + ' ; à vérifier avant de payer' : '');
    if ((data.timesheets || []).some(ts => Number(ts.year) === y && Number(ts.month) === m)) {
      const ecart = L.filter(x => { const r = pointageSurBulletin(data, x); return r && (Number(r.absentDays) || 0) !== (Number(x.absentDays) || 0); });
      add('pointage', !ecart.length, 'Le pointage repris sur chaque bulletin', ecart.length ? `${noms(ecart.map(x => x.employeeName))} : le bulletin ne suit pas le pointage` : '');
    }
    const avOublie = [], avRetenu = [];
    L.forEach(x => advancesOf(data, x.employeeId).filter(a => a.date <= fin && (!a.debut || a.debut <= ym)).forEach(a => {
      const ici = (x.deductions || []).some(d => d.advanceId === a.id);
      if (ici) avRetenu.push(x.employeeName.split(/\s+/)[0]); else if (!a.done) avOublie.push(x.employeeName);
    }));
    if (avOublie.length || avRetenu.length) add('avances', !avOublie.length, avOublie.length ? 'Une avance pas retenue' : 'Les avances retenues', avOublie.length ? `${noms(avOublie)} : rien retenu ce mois alors qu'il reste à rendre` : noms(avRetenu));
    // (1.248.0) Une sortie dans le mois se proratise aussi : un mois plein payé à qui part le 20 se voit ici.
    const sortis = L.filter(x => x.employee.endDate && x.employee.endDate >= debut && x.employee.endDate < fin);
    const sortiPlein = sortis.filter(x => !x.prorata && round3(x.gross) >= round3(Number(x.employee.grossSalary) || 0));
    if (sortis.length) add('prorata-sortie', !sortiPlein.length, sortis.length > 1 ? 'Les sorties du mois au prorata' : `La sortie de ${sortis[0].employeeName.split(/\s+/)[0]} au prorata`, sortiPlein.length ? `${noms(sortiPlein.map(x => x.employeeName))} : payé au mois plein, sorti le ${fmtDate(sortiPlein[0].employee.endDate)}` : `jusqu'au ${fmtDate(sortis[0].employee.endDate)}${sortis.length > 1 ? ' …' : ''}`);
    const entres = L.filter(x => x.employee.hireDate && x.employee.hireDate > debut && x.employee.hireDate <= fin);
    if (entres.length) {
      const plein = entres.filter(x => !x.prorata && round3(x.gross) >= round3(Number(x.employee.grossSalary) || 0));
      add('prorata', !plein.length, entres.length > 1 ? 'Les entrées du mois au prorata' : `L'entrée de ${entres[0].employeeName.split(/\s+/)[0]} au prorata`, plein.length ? `${noms(plein.map(x => x.employeeName))} : payé au mois plein, entré le ${fmtDate(plein[0].employee.hireDate)}` : '');
    }
    const vieux = tauxAvant2026(data);
    // (plateforme) 1.266.3 — un mois après la dernière loi de finances relue (cadrage 16 § 3.7) : le contrôle ne se dit plus juste.
    const nonRelus = Compta.baremesNonRelus(y, m);
    add('taux', !vieux.length && !nonRelus, 'Les taux de l’année', nonRelus
      ? `Barèmes de ${nonRelus.annee} pas encore relus : aucune contribution sociale de solidarité retenue, les autres taux sont ceux des réglages (À VÉRIFIER avec ton comptable)`
      : vieux.length ? `encore d'avant 2026 : ${vieux.map(v => v.libelle).join(', ')}` : 'CNSS, accident du travail, TFP, FOPROLOS des réglages');
    const cdd = L.filter(x => x.employee.contract === 'cdd' && x.employee.endDate && x.employee.endDate >= debut && x.employee.endDate <= addDays(fin, 62));
    add('contrats', true, 'Contrats en cours', cdd.length ? cdd.map(x => `le CDD de ${x.employeeName.split(/\s+/)[0]} finit le ${fmtDate(x.employee.endDate)}`).join(' · ') : 'aucun contrat ne finit dans les deux mois');
    const sansCnss = L.filter(x => !String(x.employee.cnss || '').trim());
    add('cnss', !sansCnss.length, 'N° CNSS de chaque salarié', sansCnss.length ? `${noms(sansCnss.map(x => x.employeeName))} : à demander, avant la déclaration du trimestre` : '');
    // (1.248.0) Un même n° CNSS sur deux salariés : la déclaration du trimestre mettrait leurs salaires sur une seule personne.
    const parCnss = {};
    L.forEach(x => { const c = String(x.employee.cnss || '').replace(/[\s-]/g, ''); if (c) (parCnss[c] = parCnss[c] || []).push(x.employeeName); });
    const cnssDoubles = Object.values(parCnss).filter(l => l.length > 1);
    if (cnssDoubles.length) add('cnss-double', false, 'Pas deux salariés sur le même n° CNSS', cnssDoubles.map(l => `${noms(l)} : le même n°`).join(' · ') + ' ; à corriger avant la déclaration du trimestre');
    const sansRib = L.filter(x => x.method !== 'especes' && !String(x.employee.iban || '').trim());
    const especes = L.filter(x => x.method === 'especes');
    add('rib', !sansRib.length, 'RIB de chaque salarié payé par virement', sansRib.length ? `${noms(sansRib.map(x => x.employeeName))} : à demander` : especes.length ? `${noms(especes.map(x => x.employeeName.split(/\s+/)[0]))} payé${especes.length > 1 ? 's' : ''} en espèces, contre reçu` : '');
    // Ceux qui demandent un geste en tête, puis les justes.
    return out.filter(c => !c.ok).concat(out.filter(c => c.ok));
  }
  function paieATraiter(data, todayIso) {
    const t = todayIso || today(), dans60 = addDays(t, 60), L = [];
    // (1.248.1) Le même n° CNSS ou le même RIB (virement) qu'un salarié déjà listé : la fiche du second se corrige. La liste
    // des salariés le montrait « en double » en rouge, et sa pastille disait « 2 à compléter » sans le compter (recette du 02/11).
    const nu = v => String(v || '').replace(/[\s-]/g, ''), premier = { cnss: {}, iban: {} };
    (data.employees || []).filter(e => e.active !== false && !(e.endDate && e.endDate < t)).forEach(e => {
      const base = { salarie: e.id, vue: 'salaries', initiales: initialesDe(e.name), couleur: couleurDe(e.name) };
      if ((e.method || 'virement') !== 'especes' && !String(e.iban || '').trim()) L.push({ ...base, focus: 'iban', titre: `${e.name} : RIB à demander`, dit: 'payé par virement : sans RIB, le salaire ne peut pas partir', geste: 'Compléter' });
      if (!String(e.cnss || '').trim()) L.push({ ...base, focus: 'cnss', titre: `${e.name} : n° CNSS à demander`, dit: 'la déclaration du trimestre l\'attend', geste: 'Compléter' });
      [['cnss', 'n° CNSS', 'la déclaration du trimestre mettrait leurs deux salaires sur un seul assuré'], ['iban', 'RIB', 'son salaire partirait sur le compte d\'un autre']].forEach(([k, quoi, dit]) => {
        if (k === 'iban' && (e.method || 'virement') === 'especes') return;
        const v = nu(e[k]); if (!v) return;
        if (premier[k][v]) L.push({ ...base, focus: k, titre: `${e.name} : le même ${quoi} que ${premier[k][v]}`, dit, geste: 'Corriger', double: { de: premier[k][v], nom: e.name, quoi } });
        else premier[k][v] = e.name;
      });
      if (e.contract === 'cdd' && e.endDate && e.endDate >= t && e.endDate <= dans60) L.push({ ...base, focus: '', titre: `Le CDD de ${e.name} finit le ${fmtDate(e.endDate)}`, dit: 'le renouveler, ou préparer sa sortie', geste: 'Décider' });
      // (plateforme) 1.256.0 — la FIN DE PÉRIODE D'ESSAI, dans les quinze jours (ou finie depuis moins de quinze jours) et pas
      // encore confirmée : le confirmer dans son poste (le courrier), ou préparer sa sortie. Une sortie déjà notée la tait.
      if (e.trialEnd && !e.essaiConfirmeLe && !e.endDate && e.trialEnd >= addDays(t, -15) && e.trialEnd <= addDays(t, 15)) {
        L.push({ ...base, focus: '', essai: true, titre: e.trialEnd >= t ? `La période d'essai de ${e.name} finit le ${fmtDate(e.trialEnd)}` : `La période d'essai de ${e.name} a fini le ${fmtDate(e.trialEnd)}`,
          dit: 'le confirmer dans son poste (le courrier est prêt), ou préparer sa sortie', geste: 'Décider' });
      }
      // (plateforme) 1.234.0 — une demande de congé sans réponse (la maquette, « À traiter ») : combien de jours, ce qui lui reste.
      (data.leaves || []).filter(l => l.employeeId === e.id && l.statut === 'demande').forEach(l => {
        const jours = workingDays(l.from, l.to, payrollSettings(data).offDays), reste = leaveBalance(data, e.id, Number(String(l.from).slice(0, 4))).remaining;
        const prenom = String(e.name || '').split(' ')[0];
        L.push({ ...base, vue: 'conges', focus: '', conge: l.id, demande: true, titre: `${prenom} demande un congé du ${fmtDate(l.from).slice(0, 5)} au ${fmtDate(l.to).slice(0, 5)}`,
          dit: `${jours} jour${jours > 1 ? 's' : ''} ; il lui en reste ${String(reste).replace('.', ',')}${l.demandeLe ? ` · demandé le ${fmtDate(l.demandeLe).slice(0, 5)}` : ''}`, geste: 'Répondre' });
      });
      // (plateforme) 1.231.0 — un arrêt maladie des trois derniers mois sans son certificat ; une saisie sur salaire dont la
      // retenue attend d'être versée au créancier.
      (data.leaves || []).filter(l => l.employeeId === e.id && l.kind === 'maladie' && l.statut !== 'demande' && l.statut !== 'refuse' && !l.certificatLe && l.to >= addDays(t, -92) && l.from <= t)
        .forEach(l => L.push({ ...base, vue: 'conges', focus: '', conge: l.id, titre: `${e.name} : le certificat de son arrêt du ${fmtDate(l.from)}`, dit: 'à garder, et à transmettre à la CNSS (À VÉRIFIER : le délai)', geste: 'Noter' }));
      Compta.saisiesOf(data, e).filter(x => x.aVerser > 0).forEach(x => L.push({ ...base, focus: '', saisie: x.id, titre: `${e.name} : ${money(x.aVerser, data.company && data.company.currency)} à verser à ${x.creancier || 'son créancier'}`, dit: 'retenus sur ses bulletins pour une saisie sur salaire', geste: 'Verser' }));
    });
    return L;
  }

  // 10.12.0 — la première pièce datée APRÈS un mois (vente émise, achat, bulletin). Un paquet vide
  // disait « commence par émettre une facture » à une entreprise qui en avait émis en septembre :
  // un état vide dit SA raison, et le jour où ça changera (E-06).
  function premierePieceApres(data, moisIso) {
    const fin = addDays(moisIso.slice(0, 7) + '-01', daysInMonth(Number(moisIso.slice(0, 4)), Number(moisIso.slice(5, 7))) - 1);
    const dates = []
      .concat((data.documents || []).filter(d => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon').map(d => d.date))
      .concat((data.purchases || []).map(p => p.date))
      .concat((data.payslips || []).map(p => payslipDate(p)))
      .filter(d => d && d > fin);
    return dates.length ? dates.sort()[0] : '';
  }

  // Le bulletin imprimé. Même langage visuel que les factures (accent de la société, cases claires),
  // mais un contenu réglementé : identité complète, période, détail des cotisations, cumuls de l'année.
  // La mention d'avertissement s'imprime tant que l'utilisateur ne l'a pas retirée (voir `payrollSettings`).
  function payslipHtml(slip, data, company, opts) {
    opts = opts || {};
    const emp = (data.employees || []).find(e => e.id === slip.employeeId) || {};
    const s = payrollSettings(data);
    const c = slip.computed || computePayslip(emp, slip, s);
    const cur = company.currency || 'DT';
    const dec = decimalsFor(cur);
    const fmt = n => money(n, null, dec, 'fr');
    const ink = company.primaryColor || '#1b2430';
    const accent = company.accentColor || '#0f9d8f';
    const hex = accent.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tint = a => `rgba(${r}, ${g}, ${b}, ${a})`;
    const pct = n => String(n).replace('.', ',');
    const period = payslipDate(slip);
    const label = monthLabel(period);

    // Cumuls de l'année jusqu'à ce bulletin inclus : c'est ce qu'attend l'administration.
    const ytd = (data.payslips || [])
      .filter(p => p.employeeId === slip.employeeId && Number(p.year) === Number(slip.year) && Number(p.month) <= Number(slip.month))
      .reduce((a, p) => {
        const k = p.computed || {};
        return { gross: round3(a.gross + (k.gross || 0)), cnss: round3(a.cnss + (k.cnssEmployee || 0)),
          irpp: round3(a.irpp + (k.irpp || 0) + (k.css || 0)), net: round3(a.net + (k.net || 0)) };
      }, { gross: 0, cnss: 0, irpp: 0, net: 0 });

    const row = (lib, base, taux, salarie, patron, cls) => `<tr class="${cls || ''}">
      <td>${escapeHtml(lib)}</td>
      <td class="n">${base == null ? '' : fmt(base)}</td>
      <td class="n">${taux == null ? '' : pct(taux) + ' %'}</td>
      <td class="n">${salarie == null ? '' : fmt(salarie)}</td>
      <td class="n">${patron == null ? '' : fmt(patron)}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Bulletin de paie ${escapeHtml(emp.name || '')} ${escapeHtml(label)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 9.5pt; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 15mm; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 12px; border-bottom: 2px solid ${tint(0.35)}; }
  .co-name { font-size: 14pt; font-weight: 700; }
  .co-sub, .small { font-size: 8pt; color: #6a7480; line-height: 1.5; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 17pt; letter-spacing: .4px; color: ${accent}; }
  .title .per { font-size: 10pt; font-weight: 600; margin-top: 2px; }
  .who { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
  .box { border: 1px solid ${tint(0.3)}; border-radius: 8px; padding: 10px 12px; background: ${tint(0.05)}; }
  .box h2 { margin: 0 0 6px; font-size: 8pt; text-transform: uppercase; letter-spacing: .6px; color: ${accent}; }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 8.5pt; padding: 1.5px 0; }
  .kv span:first-child { color: #6a7480; }
  table.pay { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.pay th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5px; color: ${accent}; border-bottom: 1px solid ${tint(0.4)}; padding: 5px 6px; }
  table.pay td { padding: 4px 6px; border-bottom: 1px solid #eef1f4; }
  table.pay td.n, table.pay th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.sec td { background: ${tint(0.07)}; font-weight: 600; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; padding-top: 7px; }
  .net { margin-top: 14px; display: flex; justify-content: space-between; align-items: center; border: 1.5px solid ${accent}; border-radius: 10px; padding: 12px 16px; background: ${tint(0.08)}; }
  .net .lbl { font-size: 10pt; font-weight: 600; }
  .net .val { font-size: 18pt; font-weight: 800; color: ${accent}; font-variant-numeric: tabular-nums; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
  .warn { margin-top: 14px; border-left: 3px solid #c98a12; background: #fdf6e7; padding: 9px 12px; border-radius: 0 6px 6px 0; font-size: 8pt; color: #6a5320; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 22px; }
  .sign .s { border: 1px dashed ${tint(0.5)}; border-radius: 8px; min-height: 60px; padding: 6px 10px; font-size: 8pt; color: #6a7480; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #eef1f4; font-size: 7.5pt; color: #8b949e; text-align: center; }
  /* (plateforme) 1.62.0 — le bulletin tient sur UNE page A4, même chargé (dix-huit lignes de rubriques) : des lignes
     serrées comme celles d'un bulletin, le pied en bas de la page. Plus long, il se coupe entre deux lignes (l'en-tête
     du tableau revient, chaque page garde ses marges) et les signatures restent avec le pied. */
  .page { display: flex; flex-direction: column; padding: 12mm 14mm 10mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .head { padding-bottom: 9px; }
  .who, .cols { margin-top: 10px; }
  .box { padding: 7px 10px; }
  .box h2 { margin-bottom: 3px; }
  .kv { padding: .5px 0; line-height: 1.3; }
  table.pay { margin-top: 10px; }
  table.pay th { padding: 3px 6px; }
  table.pay td { padding: 1.5px 6px; line-height: 1.3; }
  tr.tot td { padding-top: 4px; }
  .net { margin-top: 10px; padding: 7px 14px; }
  .net .val { line-height: 1.2; }
  .warn { margin-top: 10px; padding: 6px 10px; line-height: 1.35; }
  .sign { margin-top: 14px; margin-bottom: 10px; break-after: avoid; }
  .foot { margin-top: auto; padding-top: 6px; break-before: avoid; }
  table.pay tr, .who, .net, .cols, .warn, .sign, .foot { break-inside: avoid; }
</style></head>
<body><div class="page">
  <div class="head">
    <div>
      <div class="co-name">${escapeHtml(company.name || '')}</div>
      <div class="co-sub">${escapeHtml(company.address || '').replace(/\n/g, '<br>')}
        ${company.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(company.matricule))}` : ''}
        ${company.cnss ? `<br>CNSS : ${escapeHtml(company.cnss)}` : ''}</div>
    </div>
    <div class="title"><h1>Bulletin de paie</h1><div class="per">${escapeHtml(label)}</div>
      <div class="small">Établi le ${fmtDate(slip.issuedAt || period)}</div></div>
  </div>

  <div class="who">
    <div class="box"><h2>Salarié</h2>
      <div class="kv"><span>Nom</span><span><b>${escapeHtml(emp.name || '')}</b></span></div>
      ${emp.position ? `<div class="kv"><span>Poste</span><span>${escapeHtml(emp.position)}</span></div>` : ''}
      ${emp.cin ? `<div class="kv"><span>CIN</span><span>${escapeHtml(emp.cin)}</span></div>` : ''}
      ${emp.cnss ? `<div class="kv"><span>N° CNSS</span><span>${escapeHtml(emp.cnss)}</span></div>` : ''}
      ${emp.hireDate ? `<div class="kv"><span>Embauché le</span><span>${fmtDate(emp.hireDate)}</span></div>` : ''}
      <div class="kv"><span>Contrat</span><span>${escapeHtml(contractLabel(emp.contract || 'cdi'))}</span></div>
      <div class="kv"><span>Situation</span><span>${emp.headOfFamily ? 'Chef de famille' : 'Célibataire'}${Number(emp.children) ? ` · ${plFr(emp.children, 'enfant')} à charge` : ''}</span></div>
    </div>
    <div class="box"><h2>Période</h2>
      <div class="kv"><span>Mois</span><span><b>${escapeHtml(label)}</b></span></div>
      <div class="kv"><span>Jours ouvrables</span><span>${pct(c.workedDays)}</span></div>
      ${/* (plateforme) 1.59.0 — les jours payés, la colonne « J. » du journal de paie (le même calcul que le journal, 1.61.0). */''}
      <div class="kv"><span>Jours payés</span><span>${pct(joursPayesDuBulletin(slip))}</span></div>
      ${c.absentDays ? `<div class="kv"><span>Jours d'absence</span><span>${pct(c.absentDays)}</span></div>` : ''}
      <div class="kv"><span>Salaire de base</span><span>${fmt(c.baseGross)}</span></div>
      ${slip.prorata ? `<div class="kv"><span>Proratisé</span><span>${escapeHtml(slip.prorata.motif)} · ${pct(slip.prorata.jours)} j sur ${pct(slip.prorata.sur)}</span></div>` : ''}
      <div class="kv"><span>Payé le</span><span>${slip.paidDate ? fmtDate(slip.paidDate) : '—'}</span></div>
      ${slip.method ? `<div class="kv"><span>Mode</span><span>${escapeHtml((PAYMENT_METHODS.find(m => m[0] === slip.method) || [, slip.method])[1])}</span></div>` : ''}
    </div>
  </div>

  <table class="pay">
    <thead><tr><th>Désignation</th><th class="n">Base</th><th class="n">Taux</th><th class="n">Part salarié</th><th class="n">Part employeur</th></tr></thead>
    <tbody>
      ${row('Salaire de base', null, null, c.baseGross, null)}
      ${/* (plateforme) 1.62.0 — le mois d'une entrée, l'absence se retire du salaire du contrat : la ligne le dit. */''}
      ${c.absenceCut ? row(`Absence (${pct(c.absentDays)} jour${sAccord(c.absentDays)})`, c.brutDuMois && c.brutDuMois !== c.baseGross ? c.brutDuMois : null, null, -c.absenceCut, null) : ''}
      ${c.bonuses.map((b, i) => {
        // (plateforme) 1.59.0 — une prime au jour dit ses jours, comme la colonne « Nombre » d'un bulletin.
        const x = (slip.bonuses || [])[i] || {};
        const auJour = x.parJour && round3(Number(x.amount) || 0) === b.amount ? ` (${pct(x.jours)} j sur ${pct(x.sur)})` : '';
        return row(b.label + auJour + (b.taxable ? '' : ' (non imposable)'), null, null, b.amount, null);
      }).join('')}
      <tr class="sec"><td>Salaire brut</td><td class="n"></td><td class="n"></td><td class="n">${fmt(c.gross)}</td><td class="n"></td></tr>
      ${row('CNSS', c.cnssBase, c.rates.cnssEmployee, -c.cnssEmployee, c.cnssEmployer)}
      ${c.accident ? row('Accident du travail', c.cnssBase, c.rates.accidentRate, null, c.accident) : ''}
      ${c.tfp ? row('Taxe de formation professionnelle (TFP)', c.cnssBase, c.rates.tfpRate, null, c.tfp) : ''}
      ${c.foprolos ? row('FOPROLOS', c.cnssBase, c.rates.foprolosRate, null, c.foprolos) : ''}
      ${row('Impôt sur le revenu (IRPP)', round3(c.annualTaxable / 12), null, -c.irpp, null)}
      ${c.css ? row('Contribution sociale de solidarité', round3(c.annualTaxable / 12), c.rates.solidarity, -c.css, null) : c.cssFinie ? row(`Contribution sociale de solidarité : non retenue, sa règle s'arrête le ${fmtDate(c.cssFinie)}`, null, null, 0, null) : ''}
      ${c.deductions.map(d => row(d.label, null, null, -d.amount, null)).join('')}
      <tr class="tot"><td>Total des retenues</td><td class="n"></td><td class="n"></td>
        <td class="n">${fmt(round3(c.cnssEmployee + c.irpp + c.css + c.otherDeductions))}</td>
        <td class="n">${fmt(employerChargesOf(c))}</td></tr>
    </tbody>
  </table>

  <div class="net"><div class="lbl">Net à payer</div><div class="val">${fmt(c.net)} ${escapeHtml(cur)}</div></div>

  <div class="cols">
    <div class="box"><h2>Cumuls ${escapeHtml(String(slip.year))}</h2>
      <div class="kv"><span>Brut</span><span>${fmt(ytd.gross)}</span></div>
      <div class="kv"><span>CNSS salarié</span><span>${fmt(ytd.cnss)}</span></div>
      <div class="kv"><span>Impôt et solidarité</span><span>${fmt(ytd.irpp)}</span></div>
      <div class="kv"><span>Net perçu</span><span><b>${fmt(ytd.net)}</b></span></div>
    </div>
    <div class="box"><h2>Coût pour l'employeur</h2>
      <div class="kv"><span>Salaire brut</span><span>${fmt(c.gross)}</span></div>
      <div class="kv"><span>Charges patronales</span><span>${fmt(employerChargesOf(c))}</span></div>
      <div class="kv"><span>Coût total du mois</span><span><b>${fmt(c.employerCost)}</b></span></div>
    </div>
  </div>

  ${opts.notice === false ? '' : `<div class="warn"><b>À faire valider par votre comptable.</b> Ce bulletin est calculé à partir de barèmes saisis dans l'application (CNSS ${pct(c.rates.cnssEmployee)} % / ${pct(c.rates.cnssEmployer)} %, IRPP au barème progressif). Ces taux changent à chaque loi de finances : faites contrôler les premiers bulletins avant de les remettre.</div>`}

  <div class="sign">
    <div class="s">L'employeur</div>
    <div class="s">Le salarié — reçu pour solde du mois</div>
  </div>

  <div class="foot">${escapeHtml(company.name || '')}${company.matricule ? ' — MF ' + escapeHtml(matriculeLisible(company.matricule)) : ''} · Bulletin ${escapeHtml(Compta.deMois(label))} · ${escapeHtml(emp.name || '')}</div>
</div></body></html>`;
  }

  // ---------- congés, absences et avances (5.1.0) ----------
  // Ce que la 5.0.0 laissait à la main : d'où viennent les jours d'absence d'un bulletin, et d'où vient
  // la retenue d'une avance. Les deux se saisissent une fois, au moment où ils arrivent, et le bulletin
  // du mois les reprend tout seul — c'est la même règle que partout ailleurs dans SkanFact.

  // (plateforme) 1.69.0 — dans le moteur commun (compta.js), que le pointage du Cabinet lit aussi : une seule copie.
  // (plateforme) 1.70.0 — et les congés : leurs jours ouvrables, leur liste, le solde (le Cabinet les tient aussi).
  const { LEAVE_KINDS, leaveKindLabel, leaveIsPaid, workingDays, leaveDaysInMonth, leavesOf, leaveBalance } = Compta;

  // Les avances : une somme prêtée, remboursée par retenues mensuelles sur le bulletin.
  // (plateforme) 1.71.0 — dans le moteur commun (compta.js), que le Cabinet lit aussi : une seule copie.
  const { advancesOf, advanceBalance, echeancesDuMois } = Compta;

  // Ce qu'un bulletin doit reprendre tout seul : les absences non payées du mois, et l'échéance des
  // avances en cours. C'est ce qui évite de ressaisir la même information deux fois.
  // (plateforme) 1.60.0 — un mois POINTÉ (onglet Pointage) donne au bulletin ses jours d'absence non payés, et ses heures
  // supplémentaires en primes ; les primes au jour suivent les jours payés. Sans pointage, rien ne change.
  function payslipInputFor(data, employee0, year, month) {
    // (plateforme) 1.229.0 — le brut du MOIS (un salaire qui change à une date), pas celui d'aujourd'hui.
    const employee = Compta.employeAuMois(employee0, year, month);
    const i = payslipInputForSansPointage(data, employee, year, month);
    if (!pointageEnregistre(data, employee.id, year, month)) return i;
    const pm = pointageDuMois(data, employee, year, month);
    return { ...i, ...reprisePointage(i, pm, heuresSupDuMois(data, employee, year, month), retardsDuMois(data, employee, year, month, pm).concat(heuresDeNuitDuMois(data, employee, year, month, pm).lignes)) };
  }
  function payslipInputForSansPointage(data, employee, year, month) {
    const s = payrollSettings(data);
    const off = s.offDays;
    const absentDays = round3((data.leaves || [])
      .filter(l => l.employeeId === employee.id && Compta.congeRetenu(l) && !(l.paid != null ? l.paid : leaveIsPaid(l.kind)))
      .reduce((a, l) => a + leaveDaysInMonth(l, year, month, off), 0));
    // (plateforme) 1.71.0 — l'échéance de chaque avance en cours, par le moteur commun (celle du bulletin du Cabinet).
    // (plateforme) 1.230.0 — et chaque saisie sur salaire en cours (le moteur commun, celui du Cabinet).
    // (plateforme) 1.256.0 — et les retenues du mois importées d'un tableur (`Compta.variablesDuMois`).
    const vars = Compta.variablesDuMois(employee, year, month);
    const deductions = [...echeancesDuMois(data, employee.id, year, month), ...Compta.saisiesDuMois(data, employee, year, month), ...vars.deductions];
    // 10.12.0 — une entrée ou une sortie en cours de mois se PRORATISE. Le brut de la fiche était
    // repris en entier : un ouvrier embauché le 24 septembre recevait un mois plein pour six jours, et
    // celui qui part le 5 aussi. Les jours hors contrat se comptent en jours ouvrables (le repos
    // hebdomadaire des barèmes), sur la base des jours ouvrables du mois réglée dans les barèmes.
    // Le brut proposé reste MODIFIABLE, et `prorata` dit d'où il vient. À VÉRIFIER avec le comptable :
    // la méthode de proratisation retenue (jours ouvrables, calendaires ou 30e).
    const total = Number(s.workedDays) || 26;
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = addDays(first, daysInMonth(year, month) - 1);
    let hors = 0;
    const motifs = [];
    if (employee.hireDate && employee.hireDate > first && employee.hireDate <= last) {
      hors += workingDays(first, addDays(employee.hireDate, -1), off);
      motifs.push(`entrée le ${fmtDate(employee.hireDate)}`);
    }
    if (employee.endDate && employee.endDate >= first && employee.endDate < last) {
      hors += workingDays(addDays(employee.endDate, 1), last, off);
      motifs.push(`sortie le ${fmtDate(employee.endDate)}`);
    }
    hors = Math.min(hors, total);
    const brutFiche = round3(Number(employee.grossSalary) || 0);
    const gross = hors ? round3(brutFiche * (total - hors) / total) : employee.grossSalary;
    const prorata = hors ? { jours: round3(total - hors), sur: total, motif: motifs.join(', '), brutFiche, brut: gross } : null;
    // (plateforme) 1.59.0 — les primes de la fiche, « au jour » sur les jours payés du mois : ceux du contrat
    // (l'entrée, la sortie) moins les absences non payées.
    // (plateforme) 1.230.0 — avec les régularisations portées sur ce mois (un bulletin payé corrigé, un rappel).
    // (plateforme) 1.256.0 — la prime d'ancienneté des réglages (au jour, comme une prime de la fiche) et les primes du mois
    // importées d'un tableur.
    return { gross, workedDays: total, absentDays, bonuses: [...primesDuMois(employee, total - hors - absentDays, total), ...Compta.primeAncienneteDuMois(employee, s, year, month, total - hors - absentDays, total), ...Compta.regulsDuMois(employee, year, month), ...vars.bonuses], deductions, prorata };
  }

  // (plateforme) 1.59.0 — les primes de chaque mois, posées sur la fiche du salarié (`employee.primes` :
  // { label, amount, taxable, parJour }). Une prime « au jour » suit les jours payés : le journal de paie
  // réel de septembre 2026 prorate ainsi la prime de présence et celle de transport (80 sur 26 jours, 60
  // pour 19,5 jours), arrondies au millime. Une prime fixe passe entière. Le bulletin garde, avec le montant
  // du mois, le montant de la fiche et les jours qui l'ont proratisé (`mensuel`, `jours`, `sur`).
  // À VÉRIFIER avec le comptable : quelles primes la convention collective proratise.
  // (plateforme) 1.68.0 — dans le moteur commun (compta.js), que le Cabinet charge aussi : une copie diverge.
  const primesDuMois = Compta.primesDuMois;
  // Ce qu'une fiche coûte un mois plein (la liste des salariés, la fiche, l'aide de la fenêtre) : ses primes
  // comprises, sinon le « net estimé » d'un salarié qui touche deux primes chaque mois serait faux.
  const saisieDeLaFiche = (employee, settings) => {
    const t = Number((settings || {}).workedDays) || 26;
    return { bonuses: primesDuMois(employee, t, t) };
  };
  // Les taux livrés AVANT la 1.59.0, encore gardés dans les barèmes de l'entreprise : « Enregistrer les
  // barèmes » écrit chaque taux, et une entreprise qui l'a fait garde les anciens. On le lui dit (l'onglet
  // Bulletins, les Barèmes) au lieu de les changer à sa place.
  const TAUX_AVANT_2026 = [['cnssEmployee', 'CNSS salarié', 9.18], ['cnssEmployer', 'CNSS employeur', 16.57], ['solidarity', 'solidarité', 1]];
  function tauxAvant2026(data) {
    const r = (data && data.payrollSettings) || {};
    return TAUX_AVANT_2026.filter(([k, , ancien]) => r[k] !== undefined && Number(r[k]) === ancien && Number(DEFAULT_PAYROLL[k]) !== ancien)
      .map(([k, libelle, ancien]) => ({ cle: k, libelle, garde: ancien, livre: Number(DEFAULT_PAYROLL[k]) }));
  }

  // ---------- le pointage (plateforme, 1.60.0) ----------
  // (plateforme) 1.69.0 — dans le moteur commun (compta.js) : le Cabinet pointe aussi, et une copie diverge.
  const { CODES_POINTAGE, CODES_REPOS, libellePointage, pointageEnregistre, pointageDuMois, poserPointage, poserHeuresSup,
    majorationsHs, heuresSupDuMois, retardsDuMois, heuresDeNuitDuMois, reprisePointage, pointageSurBulletin } = Compta;

  // ---------- documents du personnel (5.1.0) ----------
  // (plateforme) 1.72.0 — leur liste, la civilité et l'indemnité de congés non pris du solde viennent du moteur commun
  // (compta.js) : le Cabinet les imprime aussi, une seule copie.
  const { HR_DOCS, hrDocLabel, CIVILITES, indemniteConges, lignesDuSolde } = Compta;

  function hrDocumentHtml(kind, employee, data, company, opts) {
    opts = opts || {};
    const e = employee || {};
    const t = opts.date || today();
    const cur = company.currency || 'DT';
    const fmt = n => money(n, null, decimalsFor(cur), 'fr');
    const ink = company.primaryColor || '#1b2430';
    const accent = company.accentColor || '#0f9d8f';
    const hex = accent.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tint = a => `rgba(${r}, ${g}, ${b}, ${a})`;
    const city = (company.address || '').split('\n').pop().replace(/^\d+\s*/, '').trim();
    // (plateforme) 1.72.0 — le solde des congés au départ et son indemnité : ceux que la fenêtre du document propose
    // (compta.js, `indemniteConges` ; deux chemins, un chiffre).
    const ic = indemniteConges(data, e.id, t);
    const bal = { remaining: ic.solde };
    const leavePay = ic.montant;
    // (plateforme) 1.72.0 — sa civilité devant son nom ; non précisée, rien (et l'accord reste au masculin).
    const civ = e.gender === 'f' ? 'Madame ' : e.gender === 'm' ? 'Monsieur ' : '';

    const body = {
      attestation: `
        <p>Je soussigné${company.managerName ? `, <b>${escapeHtml(company.managerName)}</b>,` : ''} agissant en qualité de représentant légal de la société <b>${escapeHtml(company.name || '')}</b>${company.matricule ? `, matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : ''}, atteste par la présente que :</p>
        <p class="who"><b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, titulaire de la carte d'identité nationale n° ${escapeHtml(e.cin)}` : ''}${e.cnss ? `, immatriculé${e.gender === 'f' ? 'e' : ''} à la CNSS sous le n° ${escapeHtml(e.cnss)}` : ''},</p>
        <p>fait partie du personnel de notre société depuis le <b>${fmtDate(e.hireDate)}</b>, en qualité de <b>${escapeHtml(e.position || '—')}</b>, dans le cadre d'un <b>${escapeHtml(contractLabel(e.contract || 'cdi').split(' —')[0])}</b>.</p>
        ${opts.withSalary ? `<p>Son salaire brut mensuel s'élève à <b>${fmt(e.grossSalary)} ${escapeHtml(cur)}</b>.</p>` : ''}
        <p>Cette attestation lui est délivrée pour servir et valoir ce que de droit.</p>`,
      certificat: `
        <p>Je soussigné${company.managerName ? `, <b>${escapeHtml(company.managerName)}</b>,` : ''} agissant en qualité de représentant légal de la société <b>${escapeHtml(company.name || '')}</b>${company.matricule ? `, matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : ''}, certifie que :</p>
        <p class="who"><b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, titulaire de la carte d'identité nationale n° ${escapeHtml(e.cin)}` : ''},</p>
        <p>a été employé${e.gender === 'f' ? 'e' : ''} au sein de notre société du <b>${fmtDate(e.hireDate)}</b> au <b>${fmtDate(e.endDate || t)}</b>, en qualité de <b>${escapeHtml(e.position || '—')}</b>.</p>
        <p>L'intéressé${e.gender === 'f' ? 'e' : ''} est libre de tout engagement envers notre société à compter de cette date.</p>
        <p>Le présent certificat lui est délivré pour servir et valoir ce que de droit.</p>`,
      solde: `
        <p>Entre la société <b>${escapeHtml(company.name || '')}</b>${company.matricule ? `, matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : ''}, d'une part,</p>
        <p>et <b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, CIN n° ${escapeHtml(e.cin)}` : ''}, employé${e.gender === 'f' ? 'e' : ''} du ${fmtDate(e.hireDate)} au <b>${fmtDate(e.endDate || t)}</b> en qualité de ${escapeHtml(e.position || '—')}, d'autre part.</p>
        <p>Il a été arrêté le solde de tout compte suivant :</p>
        <table class="sum">
          ${(opts.lines || []).map(l => `<tr><td>${escapeHtml(l.label)}</td><td class="n">${fmt(l.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Net à percevoir</td><td class="n">${fmt(round3((opts.lines || []).reduce((a, l) => a + (Number(l.amount) || 0), 0)))} ${escapeHtml(cur)}</td></tr>
        </table>
        <p class="small">Solde de congés non pris au départ : <b>${pctFr(bal.remaining)} jour${sAccord(bal.remaining)}</b>${leavePay > 0 ? `, soit ${fmt(leavePay)} ${escapeHtml(cur)} sur la base du dernier salaire` : ''}.</p>
        <p>Le présent solde est établi en double exemplaire. <em>À VÉRIFIER : les indemnités de fin de contrat dépendent du motif de la rupture et de la convention collective applicable — faites relire ce document avant signature.</em></p>`,
      // (plateforme) 1.223.0 — les documents de la maquette. Les montants viennent des bulletins établis, jamais tapés.
      salaire: (() => {
        const L = bulletinsDe(data, e.id, t).slice(-3);
        return `
        <p>Nous attestons que <b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, CIN n° ${escapeHtml(e.cin)}` : ''}${e.cnss ? `, n° CNSS ${escapeHtml(e.cnss)}` : ''}, est employé${e.gender === 'f' ? 'e' : ''} par notre société depuis le <b>${fmtDate(e.hireDate)}</b> en qualité de <b>${escapeHtml(e.position || '—')}</b>, sous ${escapeHtml(contractLabel(e.contract || 'cdi').split(' —')[0])}, et a perçu les salaires suivants :</p>
        ${L.length ? `<table class="sum"><tr><td><b>Mois</b></td><td class="n"><b>Salaire brut</b></td><td class="n"><b>Net versé</b></td></tr>
          ${L.map(x => `<tr><td>${MOIS_DOC[x.month - 1]} ${x.year}</td><td class="n">${fmt(x.c.gross)}</td><td class="n">${fmt(x.c.net)}</td></tr>`).join('')}</table>`
          : '<p class="small">Aucun bulletin établi à ce jour : il n\'y a pas encore de salaire à attester.</p>'}
        <p>Cette attestation lui est délivrée à sa demande, pour servir et valoir ce que de droit.</p>`;
      })(),
      annuelle: (() => {
        const an = Number(String(opts.annee || t).slice(0, 4));
        const L = bulletinsDe(data, e.id, t).filter(x => Number(x.year) === an);
        const som = f => round3(L.reduce((a, x) => a + (Number(x.c[f]) || 0), 0));
        return `
        <p>Salarié${e.gender === 'f' ? 'e' : ''} : <b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? ` · CIN ${escapeHtml(e.cin)}` : ''}${e.cnss ? ` · CNSS ${escapeHtml(e.cnss)}` : ''} · ${escapeHtml(e.position || '—')}</p>
        <table class="sum"><tr><td><b>Année ${an}${L.length ? ` · ${L.length} bulletin${L.length > 1 ? 's' : ''}` : ''}</b></td><td class="n"><b>Montant</b></td></tr>
          <tr><td>Salaire brut</td><td class="n">${fmt(som('gross'))}</td></tr>
          <tr><td>Retenue CNSS (part du salarié)</td><td class="n">${fmt(som('cnssEmployee'))}</td></tr>
          <tr><td>Impôt sur le revenu retenu à la source (IRPP)</td><td class="n">${fmt(som('irpp'))}</td></tr>
          <tr><td>Contribution sociale de solidarité</td><td class="n">${fmt(som('css'))}</td></tr>
          <tr class="tot"><td>Net versé</td><td class="n">${fmt(som('net'))} ${escapeHtml(cur)}</td></tr></table>
        <p class="small">Les montants reprennent les bulletins de l'année, tels qu'établis.${L.length ? '' : ' Aucun bulletin cette année.'} <em>À VÉRIFIER : la forme de cette attestation (le certificat de retenue de l'administration fiscale peut être exigé).</em></p>`;
      })(),
      contrat: `
        <p class="projet">PROJET — à relire, compléter et signer des deux parties</p>
        <p>Entre la société <b>${escapeHtml(company.name || '')}</b>${company.matricule ? `, matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : ''}${company.managerName ? `, représentée par <b>${escapeHtml(company.managerName)}</b>` : ''}, d'une part,</p>
        <p>et <b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, CIN n° ${escapeHtml(e.cin)}` : ''}, d'autre part, il est convenu ce qui suit :</p>
        <p><b>Article 1 · Engagement.</b> ${civ}${escapeHtml(e.name || '')} est engagé${e.gender === 'f' ? 'e' : ''} en qualité de <b>${escapeHtml(e.position || '—')}</b>.</p>
        <p><b>Article 2 · Durée.</b> ${e.contract === 'cdd' ? `Contrat à durée déterminée, du <b>${fmtDate(e.hireDate)}</b> au <b>${e.endDate ? fmtDate(e.endDate) : '……'}</b>.` : `${escapeHtml(contractLabel(e.contract || 'cdi').split(' —')[0])}, à compter du <b>${fmtDate(e.hireDate)}</b>.`}</p>
        <p><b>Article 3 · Rémunération.</b> Un salaire brut mensuel de <b>${fmt(e.grossSalary)} ${escapeHtml(cur)}</b>, payé ${e.method === 'especes' ? 'en espèces, contre reçu' : 'par virement'}.</p>
        <p><b>Article 4 · Période d'essai, horaires, congés.</b> Selon la convention collective applicable et le code du travail.</p>
        <p class="small"><em>À VÉRIFIER avec ton comptable : la catégorie, la convention collective, la période d'essai et les mentions obligatoires.</em></p>`,
      avenant: `
        <p class="projet">PROJET — à relire, compléter et signer des deux parties</p>
        <p>Au contrat de travail conclu le <b>${fmtDate(e.hireDate)}</b> entre la société <b>${escapeHtml(company.name || '')}</b> et <b>${civ}${escapeHtml(e.name || '')}</b>${e.cin ? `, CIN n° ${escapeHtml(e.cin)}` : ''}.</p>
        ${/* (1.248.1) L'avenant d'un renouvellement (fait dans le mois) dit ce qui a été décidé, à sa date : le passage en CDI
              ne s'écrivait nulle part, et l'effet tombait au jour du document au lieu du lendemain de l'ancienne fin
              (recette du 02/11). */''}
        ${(() => {
          const ren = (e.renouvellements || []).slice(-1)[0];
          const recent = ren && ren.le && ren.le >= addDays(t, -31) && ren.le <= t;
          const effet = recent ? addDays(ren.ancienneFin, 1) : t;
          const art = [`À compter du <b>${fmtDate(effet)}</b>, ${civ}${escapeHtml(e.name || '')} occupe le poste de <b>${escapeHtml(e.position || '—')}</b>, pour un salaire brut mensuel de <b>${fmt(e.grossSalary)} ${escapeHtml(cur)}</b>.`];
          if (recent && ren.cdi) art.push(`Le contrat à durée déterminée, qui prenait fin le <b>${fmtDate(ren.ancienneFin)}</b>, se poursuit à compter du <b>${fmtDate(effet)}</b> en <b>contrat à durée indéterminée</b>.`);
          else if (e.contract === 'cdd') art.push(`Le contrat à durée déterminée${recent ? `, qui prenait fin le <b>${fmtDate(ren.ancienneFin)}</b>,` : ''} est prolongé jusqu'au <b>${e.endDate ? fmtDate(e.endDate) : '……'}</b>.`);
          art.push('Les autres clauses du contrat restent inchangées.');
          return art.map((x, i) => `<p><b>Article ${i + 1}.</b> ${x}</p>`).join('');
        })()}
        <p class="small"><em>À VÉRIFIER : le renouvellement d'un CDD a ses limites (durée, nombre) ; fais relire avant signature.</em></p>`,
      essai: `
        <p>${civ}${escapeHtml(e.name || '')},</p>
        <p>Votre période d'essai, commencée le <b>${fmtDate(e.hireDate)}</b>, s'achève. Nous avons le plaisir de vous confirmer dans votre poste de <b>${escapeHtml(e.position || '—')}</b>${e.contract === 'cdd' && e.endDate ? ` : votre contrat se poursuit jusqu'au <b>${fmtDate(e.endDate)}</b>` : ''}.</p>
        <p>Nous vous prions d'agréer nos salutations distinguées.</p>
        <p class="small"><em>À VÉRIFIER : la durée de la période d'essai et son renouvellement dépendent de la convention collective.</em></p>`
    }[kind] || '';

    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>${escapeHtml(hrDocLabel(kind))} — ${escapeHtml(e.name || '')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 10.5pt; line-height: 1.65; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 20mm 20mm; background: #fff; display: flex; flex-direction: column; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 14px; border-bottom: 2px solid ${tint(0.35)}; }
  .co-name { font-size: 14pt; font-weight: 700; }
  .co-sub { font-size: 8pt; color: #6a7480; line-height: 1.5; }
  h1 { text-align: center; font-size: 15pt; letter-spacing: 1.2px; text-transform: uppercase; color: ${accent}; margin: 26px 0 22px; }
  .who { margin: 16px 0; padding: 10px 14px; background: ${tint(0.07)}; border-left: 3px solid ${accent}; border-radius: 0 6px 6px 0; }
  p { margin: 10px 0; text-align: justify; }
  .small { font-size: 8.5pt; color: #6a7480; }
  table.sum { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.sum td { padding: 6px 8px; border-bottom: 1px solid #eef1f4; }
  table.sum td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.sum tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; font-size: 11.5pt; }
  .sign { margin-top: auto; padding-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  .sign .s { border: 1px dashed ${tint(0.5)}; border-radius: 8px; min-height: 70px; padding: 7px 11px; font-size: 8.5pt; color: #6a7480; }
  .place { text-align: right; margin: 20px 0 0; font-size: 9.5pt; }
  .foot { margin-top: 14px; padding-top: 8px; border-top: 1px solid #eef1f4; font-size: 7.5pt; color: #8b949e; text-align: center; }
  .projet { text-align: center; font-weight: 700; letter-spacing: 1px; color: #b45309; border: 1.5px dashed #b45309; border-radius: 6px; padding: 4px 8px; }
</style></head>
<body><div class="page">
  <div class="head">
    <div><div class="co-name">${escapeHtml(company.name || '')}</div>
      <div class="co-sub">${escapeHtml(company.address || '').replace(/\n/g, '<br>')}
        ${company.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(company.matricule))}` : ''}
        ${company.cnss ? `<br>CNSS : ${escapeHtml(company.cnss)}` : ''}</div></div>
    <div class="co-sub" style="text-align:right">${opts.numero ? `<b>n° ${escapeHtml(String(opts.numero))}</b><br>` : ''}${company.phone ? escapeHtml(company.phone) + '<br>' : ''}${company.email ? escapeHtml(company.email) : ''}</div>
  </div>
  <h1>${escapeHtml(hrDocLabel(kind))}</h1>
  ${body}
  <p class="place">${city ? escapeHtml(city) + ', le ' : 'Le '}${fmtDate(t)}</p>
  <div class="sign">
    ${kind === 'solde' ? '<div class="s">Le salarié — lu et approuvé, bon pour solde de tout compte</div>' : ['contrat', 'avenant'].includes(kind) ? '<div class="s">Le salarié — lu et approuvé</div>' : '<div></div>'}
    <div class="s">Pour la société${company.managerName ? '<br>' + escapeHtml(company.managerName) : ''}</div>
  </div>
  <div class="foot">${escapeHtml(company.name || '')}${company.matricule ? ' — MF ' + escapeHtml(matriculeLisible(company.matricule)) : ''}</div>
</div></body></html>`;
  }

  const pctFr = n => String(n).replace('.', ',');
  // (plateforme) 1.223.0 — les bulletins d'un salarié établis jusqu'à un jour, du plus ancien au plus récent.
  const MOIS_DOC = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function bulletinsDe(data, employeeId, jusquA) {
    const lim = String(jusquA || today()).slice(0, 7);
    return payslipsOf(data).filter(x => x.employeeId === employeeId && `${x.year}-${String(x.month).padStart(2, '0')}` <= lim)
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  }

  // Le registre du personnel : la liste que l'inspection du travail peut demander.
  function staffRegister(data, todayIso) {
    const t = todayIso || today();
    return (data.employees || []).slice()
      .sort((a, b) => (a.hireDate || '').localeCompare(b.hireDate || ''))
      .map((e, i) => ({
        n: i + 1, id: e.id, name: e.name || '', cin: e.cin || '', cnss: e.cnss || '',
        position: e.position || '', contract: contractLabel(e.contract || 'cdi').split(' —')[0],
        hireDate: e.hireDate || '', endDate: e.endDate || '',
        active: (!e.hireDate || e.hireDate <= t) && (!e.endDate || e.endDate >= t),
        grossSalary: Number(e.grossSalary) || 0
      }));
  }

  // ---------- déclarations sociales (5.2.0) ----------
  // Deux formulaires que tout employeur doit déposer, et qu'on remplit à la main en recopiant des
  // chiffres qu'on a déjà : la déclaration CNSS du trimestre, et la déclaration annuelle d'employeur.
  // SkanFact ne dépose rien — il prépare le tableau, à recopier ou à exporter pour le comptable.
  // À VÉRIFIER avec le comptable : la forme exacte, les dates et les modalités de dépôt.

  const QUARTERS = [[1, '1er trimestre', [1, 2, 3]], [2, '2e trimestre', [4, 5, 6]],
    [3, '3e trimestre', [7, 8, 9]], [4, '4e trimestre', [10, 11, 12]]];
  const quarterMonths = q => (QUARTERS.find(x => x[0] === Number(q)) || [, , []])[2];
  const quarterLabel = q => (QUARTERS.find(x => x[0] === Number(q)) || [, ''])[1];

  // La déclaration CNSS d'un trimestre : un salarié par ligne, avec son assiette et les deux parts.
  function cnssDeclaration(data, year, quarter) {
    const months = quarterMonths(quarter);
    const slips = (data.payslips || []).filter(p => Number(p.year) === Number(year) && months.includes(Number(p.month)));
    const byEmp = {};
    slips.forEach(p => {
      const c = p.computed || {};
      const e = byEmp[p.employeeId] || (byEmp[p.employeeId] = {
        employeeId: p.employeeId, name: '', cnss: '', months: 0, days: 0,
        base: 0, employee: 0, employer: 0, accident: 0, total: 0
      });
      const emp = (data.employees || []).find(x => x.id === p.employeeId) || {};
      e.name = emp.name || ''; e.cnss = emp.cnss || '';
      e.months += 1;
      e.days = round3(e.days + Math.max(0, (Number(c.workedDays) || 0) - (Number(c.absentDays) || 0)));
      e.base = round3(e.base + (c.cnssBase || 0));
      e.employee = round3(e.employee + (c.cnssEmployee || 0));
      e.employer = round3(e.employer + (c.cnssEmployer || 0));
      e.accident = round3(e.accident + (c.accident || 0));
      e.total = round3(e.employee + e.employer + e.accident);
    });
    const rows = Object.values(byEmp).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    const sum = f => round3(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
    // Échéance : le jour réglé au calendrier fiscal (le 15 par défaut) du mois suivant la fin du
    // trimestre. À VÉRIFIER. Une seule source pour la Paie et le calendrier (10.14.0).
    const dueDate = dateLimiteSociale(data, 'cnss', year, quarter);
    return {
      year: Number(year), quarter: Number(quarter), label: quarterLabel(quarter), months, dueDate,
      employees: rows.length, slips: slips.length,
      base: sum(r => r.base), employee: sum(r => r.employee), employer: sum(r => r.employer),
      accident: sum(r => r.accident), total: sum(r => r.total), rows
    };
  }

  // 10.14.1 (DECL D2) — le fichier de télédéclaration CNSS du trimestre (format « DS » 2012), par le
  // MÊME moteur que le Cabinet (`compta.fichierCnss`) : le fichier du client et celui de son
  // comptable ne peuvent pas diverger. Le salaire déclaré est l'ASSIETTE du trimestre, lue dans la
  // déclaration que la page affiche juste au-dessus — un seul calcul pour le tableau et le fichier.
  function fichierCnssEntreprise(data, company, year, quarter) {
    const cn = cnssDeclaration(data, year, quarter);
    const c = company || {};
    return Compta.fichierCnss({
      employeur: c.cnss, code: c.cnssCode, annee: cn.year, trimestre: cn.quarter,
      lignes: cn.rows.map(r => {
        const e = (data.employees || []).find(x => x.id === r.employeeId) || {};
        return { salarieId: r.employeeId, nom: r.name, identite: e.cnssName || '', cnss: r.cnss, cin: e.cin || '', salaire: r.base };
      })
    });
  }

  // ---------- le journal de paie et les états de la paie (plateforme, 1.61.0) ----------
  // Ce que le vrai logiciel imprime chaque mois et chaque trimestre (un journal de paie, un état récapitulatif CNSS et
  // une paie de septembre réels, reçus le 19/10/2026). Tout se lit dans la copie FIGÉE des bulletins (5.0.0).

  // Les jours qu'un bulletin paie (la colonne « J. » du journal de paie) : le mois complet des barèmes, moins les jours
  // hors contrat (l'entrée, la sortie), moins les absences non payées.
  function joursPayesDuBulletin(slip) {
    const c = (slip && slip.computed) || {};
    const total = Number(c.workedDays != null ? c.workedDays : slip.workedDays) || 26;
    const hors = slip.prorata ? Math.max(0, Number(slip.prorata.sur) - Number(slip.prorata.jours)) : 0;
    const absences = Number(c.absentDays != null ? c.absentDays : slip.absentDays) || 0;
    return round3(Math.max(0, total - hors - absences));
  }
  // Les colonnes du journal, dans l'ordre du journal réel : [clé, libellé, en-tête court].
  const COLONNES_JOURNAL = [
    ['jours', 'Jours payés', 'J.'], ['base', 'Salaire de base', 'Base'], ['hs', 'Heures supplémentaires', 'H.S.'],
    ['indemnites', 'Primes et indemnités', 'Indemnités'], ['brut', 'Salaire brut', 'Brut'],
    ['cotisable', 'Salaire cotisable', 'S. cotisable'], ['cnss', 'CNSS salarié', 'CNSS'],
    ['imposable', 'Salaire imposable', 'S. imposable'], ['irpp', 'Impôt sur le revenu', 'IRPP'],
    ['css', 'Contribution sociale de solidarité', 'CSS'], ['salaireNet', 'Salaire net', 'S. net'],
    ['retenues', 'Autres retenues', 'Retenues'], ['net', 'Net à payer', 'Net à payer'],
    ['tfp', 'Taxe de formation professionnelle', 'TFP'], ['foprolos', 'FOPROLOS', 'FOPROLOS'],
    ['accident', 'Accident du travail', 'AT'], ['patronal', 'CNSS patronale', 'CNSS pat.']
  ];
  // Le journal de paie d'un mois : une ligne par bulletin, dans l'ordre du registre du personnel (son numéro tient lieu
  // de matricule) ; le total de chaque colonne est la somme de ses lignes.
  function journalDePaie(data, year, month) {
    const rang = {};
    staffRegister(data).forEach(r => { rang[r.id] = r.n; });
    const lignes = payslipsOf(data, year, month).map(x => {
      const c = x.c || {};
      const v = k => Number(c[k]) || 0;
      // Les heures supplémentaires du pointage sont des primes marquées (`hs`) : elles ont leur colonne.
      const hs = round3((x.bonuses || []).filter(b => b && b.hs).reduce((a, b) => a + (Number(b.amount) || 0), 0));
      return {
        id: x.id, employeeId: x.employeeId, n: rang[x.employeeId] || 0, name: x.employeeName, matriculeCnss: (x.employee || {}).cnss || '',
        jours: joursPayesDuBulletin(x), base: round3(v('baseGross') - v('absenceCut')), hs,
        indemnites: round3(v('taxableBonus') + v('freeBonus') - hs), brut: v('gross'), cotisable: v('cnssBase'),
        cnss: v('cnssEmployee'), imposable: v('afterCnss'), irpp: v('irpp'), css: v('css'),
        salaireNet: round3(v('net') + v('otherDeductions')), retenues: v('otherDeductions'), net: v('net'),
        tfp: v('tfp'), foprolos: v('foprolos'), accident: v('accident'), patronal: v('cnssEmployer')
      };
    }).sort((a, b) => (a.n - b.n) || (a.name || '').localeCompare(b.name || '', 'fr'));
    const totaux = {};
    COLONNES_JOURNAL.forEach(([k]) => { totaux[k] = round3(lignes.reduce((a, l) => a + (Number(l[k]) || 0), 0)); });
    return { year: Number(year), month: Number(month), lignes, totaux, nombre: lignes.length };
  }
  // (plateforme) 1.74.0 — les salaires d'un mois qui restent à payer : un bulletin non payé par ligne, avec son mode (celui
  // du bulletin, sinon de la fiche), le RIB du salarié et son net. Ce qui manque à un virement se dit sur sa ligne : pas de
  // RIB, ou un RIB que sa clé refuse (`verifRib`, le contrôle du RIB de la société). Le total d'un ordre de virement est la
  // somme des nets qu'il porte : ce que la trésorerie sortira quand les bulletins seront marqués payés.
  function salairesAPayer(data, year, month) {
    return payslipsOf(data, year, month).filter(x => !x.paidDate).map(x => {
      const e = x.employee || {};
      const mode = x.method || e.method || 'virement';
      const rib = String(e.iban || '').trim();
      const v = verifRib(rib);
      const manque = mode !== 'virement' ? '' : !rib ? 'rib' : v.ok ? '' : 'rib-douteux';
      return { id: x.id, employeeId: x.employeeId, name: x.employeeName, mode, rib, net: round3(Number((x.c || {}).net) || 0),
        manque, raison: manque === 'rib-douteux' ? v.raison : '' };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
  }

  // (plateforme) 1.74.0 — l'ordre de virement des salaires d'un mois, à remettre à la banque : la société, sa banque, le
  // compte à débiter, une ligne par bénéficiaire (son RIB, son net), le total en chiffres et en lettres, la ville et le jour,
  // la signature. Une lettre d'usage, pas un formulaire officiel : À VÉRIFIER, une banque peut demander le sien, ou un
  // fichier. `o` : { year, month, date, compte: { bank, rib }, lignes: [{ name, rib, net }] }.
  // (1.256.0) Le reçu d'un salaire payé en espèces (la maquette, « Payer les salaires » : « Reçu de Salma ») : le salarié signe
  // qu'il a reçu son net du mois ; la caisse se justifie par ce papier. Une ligne par salarié payé en espèces.
  function recuSalaireEspecesHtml(company, o) {
    const co = company || {};
    const lignes = (o && o.lignes) || [];
    const cur = co.currency || 'DT';
    const fmt = n => money(n, null, decimalsFor(cur), 'fr');
    const ink = co.primaryColor || '#1b2430';
    const accent = co.accentColor || '#0f9d8f';
    const periode = monthLabel(`${o.year}-${pad2(o.month)}-01`);
    const ville = (co.address || '').split('\n').pop().replace(/^\d+\s*/, '').trim();
    const recu = l => `<section class="recu">
    <div class="head"><div class="co-name">${escapeHtml(co.name || '')}</div><div class="co-sub">${escapeHtml(co.address || '').replace(/\n/g, '<br>')}${co.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(co.matricule))}` : ''}</div></div>
    <h1>Reçu de salaire payé en espèces</h1>
    <p>Je soussigné(e) <b>${escapeHtml(l.name || '')}</b>${l.cin ? `, CIN n° ${escapeHtml(l.cin)}` : ''}${l.poste ? `, ${escapeHtml(l.poste)}` : ''}, reconnais avoir reçu de <b>${escapeHtml(co.name || 'mon employeur')}</b> la somme de <b>${fmt(l.net)} ${escapeHtml(normCurrency(cur))}</b> (<em>${escapeHtml(amountToWords(l.net, cur))}</em>), en espèces, au titre de mon salaire net ${escapeHtml(Compta.deMois(periode))}.</p>
    <div class="deux"><div>Fait${ville ? ` à ${escapeHtml(ville)}` : ''} le ${fmtDate((o && o.date) || today())}<br>Pour l'employeur${co.managerName ? `<br>${escapeHtml(co.managerName)}` : ''}<div class="sig"></div></div><div>Le salarié<br>« reçu la somme ci-dessus »<div class="sig"></div>Signature</div></div>
  </section>`;
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Reçu de salaire en espèces — ${escapeHtml(Compta.deMois(periode))}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 10pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm; background: #fff; display: grid; gap: 14mm; align-content: start; }
  .recu { border: 1px solid #d9dee5; border-radius: 3mm; padding: 9mm; }
  .head { padding-bottom: 8px; border-bottom: 2px solid ${accent}; }
  .co-name { font-size: 12pt; font-weight: 700; }
  .co-sub { font-size: 8.5pt; color: #6a7480; }
  h1 { margin: 14px 0 10px; font-size: 13pt; color: ${accent}; }
  .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 14px; }
  .sig { height: 20mm; }
  .pied { font-size: 7.5pt; color: #6a7480; }
</style></head>
<body><div class="page">
  ${lignes.map(recu).join('')}
  <div class="pied">Établi avec SkanFact le ${fmtDate(today())}. À garder avec la caisse : il justifie la sortie d'argent (durée de conservation : À VÉRIFIER).</div>
</div></body></html>`;
  }
  function ordreDeVirementHtml(company, o) {
    const co = company || {};
    const lignes = (o && o.lignes) || [];
    const compte = (o && o.compte) || {};
    const cur = co.currency || 'DT';
    const fmt = n => money(n, null, decimalsFor(cur), 'fr');
    const total = round3(lignes.reduce((s, l) => s + (Number(l.net) || 0), 0));
    const ink = co.primaryColor || '#1b2430';
    const accent = co.accentColor || '#0f9d8f';
    const periode = monthLabel(`${o.year}-${pad2(o.month)}-01`);
    const ville = (co.address || '').split('\n').pop().replace(/^\d+\s*/, '').trim();
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Ordre de virement — salaires ${escapeHtml(Compta.deMois(periode))}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 10pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm; background: #fff; }
  .head { padding-bottom: 10px; border-bottom: 2px solid ${accent}; }
  .co-name { font-size: 13pt; font-weight: 700; }
  .co-sub { font-size: 8.5pt; color: #6a7480; line-height: 1.5; }
  .dest { margin: 18px 0 0 auto; width: 75mm; }
  h1 { margin: 22px 0 4px; font-size: 15pt; letter-spacing: .3px; color: ${accent}; }
  .objet { margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 6px; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .3px; color: ${accent}; border-bottom: 1px solid ${ink}; padding: 5px 4px; text-align: left; }
  th.n, td.n { text-align: right; }
  td { padding: 5px 4px; border-bottom: 1px solid #e6e9ee; }
  td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rib { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9pt; white-space: nowrap; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; }
  .sign { margin: 28px 0 0 auto; width: 80mm; text-align: center; }
  .cachet { height: 26mm; }
  .pied { margin-top: 16px; font-size: 7.5pt; color: #6a7480; }
</style></head>
<body><div class="page">
  <div class="head">
    <div class="co-name">${escapeHtml(co.name || '')}</div>
    <div class="co-sub">${escapeHtml(co.address || '').replace(/\n/g, '<br>')}${co.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(co.matricule))}` : ''}</div>
  </div>
  <div class="dest">À l'attention de<br><b>${escapeHtml(compte.bank || 'notre banque')}</b></div>
  <h1>Ordre de virement</h1>
  <p class="objet"><b>Objet :</b> virement des salaires ${escapeHtml(Compta.deMois(periode))}</p>
  <p>Nous vous prions de bien vouloir virer, par le débit de notre compte${compte.rib ? ` n° <b class="rib">${escapeHtml(compte.rib)}</b>` : ''}, les sommes suivantes aux bénéficiaires désignés ci-dessous.</p>
  <table><thead><tr><th>N°</th><th>Bénéficiaire</th><th>RIB / IBAN</th><th class="n">Montant (${escapeHtml(normCurrency(cur))})</th></tr></thead><tbody>
    ${lignes.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(l.name || '')}</td><td class="rib">${escapeHtml(l.rib || '')}</td><td class="n">${fmt(l.net)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3">Total (${lignes.length} virement${lignes.length > 1 ? 's' : ''})</td><td class="n">${fmt(total)}</td></tr>
  </tbody></table>
  <p>Arrêté le présent ordre à la somme de : <em>${escapeHtml(amountToWords(total, cur))}</em>.</p>
  <div class="sign">${ville ? `${escapeHtml(ville)}, le` : 'Le'} ${fmtDate((o && o.date) || today())}<br>Pour la société${co.managerName ? `<br>${escapeHtml(co.managerName)}` : ''}<div class="cachet"></div>Cachet et signature</div>
  <div class="pied">Établi avec SkanFact le ${fmtDate(today())}.</div>
</div></body></html>`;
  }

  // Les colonnes du fichier CSV du journal : une ligne de total à la fin (jours vides).
  const colonnesCsvJournal = () => [{ key: 'n', label: 'N°' }, { key: 'name', label: 'Salarié' }, { key: 'matriculeCnss', label: 'N° CNSS' }]
    .concat(COLONNES_JOURNAL.map(([key, label]) => key === 'jours'
      ? { key, label, get: r => r.jours === '' || r.jours == null ? '' : String(r.jours).replace('.', ',') }
      : { key, label, type: 'money' }));
  // Le journal imprimé : une page A4 en largeur, les colonnes du journal réel, les totaux, le nombre de salariés.
  function journalDePaieHtml(data, company, year, month) {
    const co = company || {};
    const j = journalDePaie(data, year, month);
    const dec = decimalsFor(co.currency || 'DT');
    const fmt = n => money(n, null, dec, 'fr');
    const ink = co.primaryColor || '#1b2430';
    const accent = co.accentColor || '#0f9d8f';
    const label = monthLabel(`${year}-${pad2(month)}-01`);
    const cellule = (k, v) => `<td class="n">${k === 'jours' ? String(v).replace('.', ',') : Math.abs(v) < 0.0005 ? '' : fmt(v)}</td>`;
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Journal de paie ${escapeHtml(label)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 7.5pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 297mm; min-height: 210mm; padding: 10mm 9mm; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 8px; border-bottom: 2px solid ${accent}; }
  .co-name { font-size: 12pt; font-weight: 700; }
  .co-sub { font-size: 7.5pt; color: #6a7480; line-height: 1.5; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 15pt; letter-spacing: .3px; color: ${accent}; }
  .title .per { font-size: 10pt; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { font-size: 6.5pt; text-transform: uppercase; letter-spacing: .3px; color: ${accent}; border-bottom: 1px solid ${ink}; padding: 4px 3px; text-align: right; vertical-align: bottom; }
  th.g, td.g { text-align: left; }
  td { padding: 3px; border-bottom: 1px solid #e6e9ee; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; padding-top: 5px; }
  .pied { display: flex; justify-content: space-between; margin-top: 8px; font-size: 7.5pt; color: #6a7480; }
</style></head>
<body><div class="page">
  <div class="head">
    <div>
      <div class="co-name">${escapeHtml(co.name || '')}</div>
      <div class="co-sub">${escapeHtml(co.address || '').replace(/\n/g, '<br>')}${co.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(co.matricule))}` : ''}${co.cnss ? `<br>N° CNSS : ${escapeHtml(co.cnss)}` : ''}</div>
    </div>
    <div class="title"><h1>Journal de paie</h1><div class="per">${escapeHtml(label)}</div></div>
  </div>
  <table>
    <thead><tr><th class="g">N°</th><th class="g">Salarié</th>${COLONNES_JOURNAL.map(([, l, court]) => `<th title="${escapeHtml(l)}">${escapeHtml(court)}</th>`).join('')}</tr></thead>
    <tbody>
      ${j.lignes.map(l => `<tr><td class="g">${l.n ? String(l.n).padStart(4, '0') : ''}</td><td class="g">${escapeHtml(l.name)}</td>${COLONNES_JOURNAL.map(([k]) => cellule(k, l[k])).join('')}</tr>`).join('')}
      <tr class="tot"><td class="g" colspan="2">Totaux</td>${COLONNES_JOURNAL.map(([k]) => k === 'jours' ? '<td></td>' : `<td class="n">${fmt(j.totaux[k])}</td>`).join('')}</tr>
    </tbody>
  </table>
  <div class="pied"><span>Nombre de salariés : ${j.nombre}</span><span>Établi avec SkanFact le ${fmtDate(today())}</span></div>
</div></body></html>`;
  }

  // L'état récapitulatif des salaires déclarés d'un trimestre (le formulaire de la CNSS) : les salaires de la déclaration,
  // et les cotisations calculées sur leur TOTAL au taux du régime, comme l'état réel du 3e trimestre 2026 (29 119,268 ×
  // 26,75 % = 7 789,404 ; × 0,50 % = 145,596). Si le taux n'est pas le même sur tous les bulletins du trimestre (un régime
  // particulier, un taux changé en cours de trimestre), un seul taux ne dirait rien : l'état reprend la somme des
  // bulletins. Le total des salaires s'écrit en lettres (« arrêtée à la somme de »). À VÉRIFIER avec le comptable.
  function etatRecapitulatifCnss(data, company, year, quarter) {
    const cn = cnssDeclaration(data, year, quarter);
    const co = company || {};
    const slips = (data.payslips || []).filter(p => Number(p.year) === Number(year) && cn.months.includes(Number(p.month)));
    const unique = f => { const v = [...new Set(slips.map(p => round3(f(((p.computed || {}).rates) || {}))))]; return v.length === 1 ? v[0] : null; };
    const tSecu = unique(r => (Number(r.cnssEmployee) || 0) + (Number(r.cnssEmployer) || 0));
    const tAt = unique(r => Number(r.accidentRate) || 0);
    const secu = tSecu !== null ? round3(cn.base * tSecu / 100) : round3(cn.employee + cn.employer);
    const accident = tAt !== null ? round3(cn.base * tAt / 100) : cn.accident;
    const total = round3(secu + accident);
    return {
      year: cn.year, quarter: cn.quarter, label: cn.label, dueDate: cn.dueDate, salaries: cn.employees,
      employeur: String(co.cnss || '').trim(),
      code: String(co.cnssCode == null || co.cnssCode === '' ? '0' : co.cnssCode).trim().padStart(2, '0'),
      salaires: cn.base,
      lignes: [
        { cle: 'secu', libelle: 'Sécurité sociale', taux: tSecu, montant: secu },
        { cle: 'accident', libelle: 'Accidents du travail et maladies professionnelles', taux: tAt, montant: accident }
      ],
      total, bulletins: cn.total, ecart: round3(total - cn.total),
      enLettres: amountToWords(cn.base, 'DT')
    };
  }
  // L'état imprimé, dans l'ordre du formulaire réel ; les pénalités, la date et la signature restent à remplir à la main.
  function etatRecapitulatifCnssHtml(data, company, year, quarter) {
    const co = company || {};
    const e = etatRecapitulatifCnss(data, co, year, quarter);
    const fmt = n => money(n, null, 3, 'fr');
    const taux = n => n === null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    const ink = co.primaryColor || '#1b2430';
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>État récapitulatif des salaires déclarés ${escapeHtml(e.label)} ${e.year}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 10pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm; background: #fff; }
  h1 { margin: 0 0 14px; font-size: 15pt; text-align: center; }
  .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cadre { border: 1px solid ${ink}; padding: 10px 12px; }
  .lib { font-size: 8pt; color: #555f6b; text-transform: uppercase; letter-spacing: .4px; }
  .kv { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .gros { font-size: 15pt; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: .4px; text-align: left; border-bottom: 1px solid ${ink}; padding: 5px 6px; }
  td { padding: 6px; border-bottom: 1px solid #dde2e8; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; }
  .mt { margin-top: 14px; }
  .ligne { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dotted #9aa3ad; }
  .arrete { margin-top: 18px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 24px; }
  .sign .s { border: 1px dashed #9aa3ad; min-height: 70px; padding: 6px 10px; font-size: 8.5pt; color: #555f6b; }
  .foot { margin-top: 18px; font-size: 7.5pt; color: #8b949e; text-align: center; }
</style></head>
<body><div class="page">
  <h1>État récapitulatif des salaires déclarés</h1>
  <div class="deux">
    <div class="cadre">
      <div class="kv"><span>Numéro d'employeur</span><b>${escapeHtml(e.employeur) || '…'}</b></div>
      <div class="kv"><span>Code d'exploitation</span><b>${escapeHtml(e.code)}</b></div>
      <div class="kv"><span>Trimestre</span><b>${e.quarter}</b></div>
      <div class="kv"><span>Année</span><b>${e.year}</b></div>
    </div>
    <div class="cadre"><div class="lib">Nom et adresse de l'employeur</div>
      <div><b>${escapeHtml(co.name || '')}</b><br>${escapeHtml(co.address || '').replace(/\n/g, '<br>')}</div></div>
  </div>
  <div class="deux mt">
    <div class="cadre"><div class="lib">Salaires déclarés</div><div class="gros">${fmt(e.salaires)}</div>
      <div>${plFr(e.salaries, 'salarié')}</div></div>
    <div class="cadre"><div class="lib">Cotisations</div>
      <table><thead><tr><th>Régime</th><th class="n">Taux</th><th class="n">Montant</th></tr></thead><tbody>
        ${e.lignes.map(l => `<tr><td>${escapeHtml(l.libelle)}</td><td class="n">${taux(l.taux)}</td><td class="n">${fmt(l.montant)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="2">Total</td><td class="n">${fmt(e.total)}</td></tr>
      </tbody></table></div>
  </div>
  <div class="mt">
    <div class="ligne"><span>Nombre de jours de retard</span><span></span></div>
    <div class="ligne"><span>Montant des pénalités de retard</span><span></span></div>
    <div class="ligne"><span>Montant à payer</span><span></span></div>
  </div>
  <p class="arrete">La présente déclaration de salaires, certifiée sincère et conforme à nos documents comptables, est arrêtée à la somme de : <b>${escapeHtml(e.enLettres)}</b>.</p>
  <div class="sign"><div>Fait à ……………………… le ………………</div><div class="s">Signature et cachet de l'employeur</div></div>
  <div class="foot">Établi avec SkanFact le ${fmtDate(today())}, d'après les bulletins du ${escapeHtml(e.label)} ${e.year}.</div>
</div></body></html>`;
  }

  // Ce que la paie d'un mois ajoute à la déclaration mensuelle (« Déclaration mensuelle d'employeur et de TVA » du
  // calendrier fiscal) : l'IRPP retenu sur les salaires, la contribution sociale de solidarité, la TFP et le FOPROLOS,
  // avec leurs bases. Les montants sont ceux du journal de paie du mois (la même fonction, le même chiffre), pour les
  // bulletins du mois. À VÉRIFIER avec le comptable : la base que le formulaire demande, et le mois où se déclare une
  // paie versée le mois suivant.
  function declarationMensuelleSalaires(data, year, month) {
    const y = Number(year), m = Number(month);
    const j = journalDePaie(data, y, m);
    const slips = payslipsOf(data, y, m);
    const unique = f => { const v = [...new Set(slips.map(x => round3(Number(((x.c || {}).rates || {})[f]) || 0)))]; return v.length === 1 ? v[0] : null; };
    // La solidarité se calcule sur le revenu imposable après les déductions (celui du barème, ramené au mois), comme le
    // bulletin l'imprime.
    const apresDeductions = round3(slips.reduce((a, x) => a + round3((Number((x.c || {}).annualTaxable) || 0) / 12), 0));
    const lignes = [
      { cle: 'irpp', libelle: 'Retenue à la source sur les salaires (IRPP)', base: j.totaux.imposable, taux: null, bareme: true, montant: j.totaux.irpp },
      { cle: 'css', libelle: 'Contribution sociale de solidarité', base: apresDeductions, taux: unique('solidarity'), montant: j.totaux.css },
      { cle: 'tfp', libelle: 'Taxe de formation professionnelle (TFP)', base: j.totaux.cotisable, taux: unique('tfpRate'), montant: j.totaux.tfp },
      { cle: 'foprolos', libelle: 'FOPROLOS', base: j.totaux.cotisable, taux: unique('foprolosRate'), montant: j.totaux.foprolos }
    ];
    // L'échéance : le jour réglé au calendrier fiscal pour la déclaration mensuelle (le 28 par défaut), le mois suivant.
    const r = fiscalDeadlines(data).find(x => x.id === 'tva') || {};
    const ny = m >= 12 ? y + 1 : y, nm = m >= 12 ? 1 : m + 1;
    return {
      year: y, month: m, salaries: j.nombre, lignes, total: round3(lignes.reduce((a, l) => a + l.montant, 0)),
      dueDate: `${ny}-${pad2(nm)}-${pad2(Math.min(Number(r.day) || 28, daysInMonth(ny, nm)))}`
    };
  }

  // (plateforme) 1.228.0 — ce qu'une déclaration sociale fait payer, et ses parts : `cnss-AAAA-TQ` (le trimestre CNSS) ou
  // `dm-AAAA-MM` (les retenues et taxes sur les salaires d'un mois). La même fonction pour la fenêtre qui le note et pour
  // ce que l'écran annonce.
  function montantSocial(data, id) {
    let m = /^cnss-(\d{4})-T([1-4])$/.exec(id || '');
    if (m) { const c = cnssDeclaration(data, Number(m[1]), Number(m[2])); return { montant: c.total, parts: { cnss: c.total }, echeance: c.dueDate }; }
    m = /^dm-(\d{4})-(\d{2})$/.exec(id || '');
    if (m) {
      const d = declarationMensuelleSalaires(data, Number(m[1]), Number(m[2]));
      const v = k => (d.lignes.find(l => l.cle === k) || {}).montant || 0;
      return { montant: d.total, parts: { irpp: round3(v('irpp') + v('css')), tfp: round3(v('tfp') + v('foprolos')) }, echeance: d.dueDate };
    }
    return null;
  }
  // La déclaration annuelle d'employeur : le récapitulatif des salaires versés et des retenues opérées.
  // Elle porte sur deux choses distinctes que l'on confond souvent : les salaires, et les retenues à la
  // source pratiquées sur des fournisseurs (honoraires, loyers…).
  // (plateforme) 1.73.0 — les salaires de l'année par salarié et les colonnes de leur état : le moteur commun (compta.js),
  // que le Cabinet lit aussi pour la déclaration de ses clients. (L'adaptation commence sous la première ligne de ce
  // commentaire : celle de la 1.61.0 finit dessus.)
  const { salairesDeLAnnee, COLONNES_SALAIRES_ANNEE } = Compta;
  function employerAnnual(data, year, company) {
    const y = Number(year);
    const sal = salairesDeLAnnee(data, y);
    const rows = sal.rows;

    // Retenues à la source opérées sur des fournisseurs dans l'année : l'autre moitié du formulaire.
    // Celles des RÈGLEMENTS de l'année (10.14.0) : une facture de décembre payée en janvier appartient
    // à la déclaration de l'année du paiement — celle que dit l'attestation remise au fournisseur.
    const co = company || (data.company || {});
    const operees = {};
    supplierPayments(data, co, { from: `${y}-01-01`, to: `${y}-12-31` }).forEach(r => {
      if (!r.rs) return;
      const o = operees[r.purchaseId] || (operees[r.purchaseId] = { rs: 0, date: '' });
      o.rs = round3(o.rs + r.rs);
      if ((r.date || '') > o.date) o.date = r.date;
    });
    // Un avoir posé après le règlement régularise la retenue l'année où il est posé (10.14.0).
    regularisationsRetenueAchats(data, co, { from: `${y}-01-01`, to: `${y}-12-31` }).forEach(r => {
      const o = operees[r.purchaseId] || (operees[r.purchaseId] = { rs: 0, date: '' });
      o.rs = round3(o.rs + r.rs);
      if (!o.date) o.date = r.date;
    });
    Object.keys(operees).forEach(k => { if (Math.abs(operees[k].rs) <= 0.0005) delete operees[k]; });
    const held = (data.purchases || [])
      .filter(p => operees[p.id])
      .map(p => {
        const t = purchaseTotals(p, co);
        const sup = (data.suppliers || []).find(s2 => s2.id === p.supplierId) || {};
        const o = operees[p.id];
        // L'assiette de ce qui a été retenu cette année : la part de la pièce que ses règlements ont
        // soldée — celle d'une retenue à 1,5 % sur 1 000 DT réglés à moitié est 500.
        const part = t.base.withholding ? o.rs / t.base.withholding : 0;
        return { purchaseId: p.id, supplier: sup.name || '—', matricule: sup.matricule || '',
          number: p.number || '', date: o.date, dateFacture: p.date, base: round3((t.base.totalTTC - t.base.fees) * part),
          rate: Number(p.withholdingRate) || 0, amount: o.rs, certificate: !!p.withholdingCertificate };
      })
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const heldBySupplier = {};
    held.forEach(x => {
      const k = x.supplier + '|' + x.matricule;
      const e = heldBySupplier[k] || (heldBySupplier[k] = { supplier: x.supplier, matricule: x.matricule, count: 0, base: 0, amount: 0, missing: 0 });
      e.count += 1; e.base = round3(e.base + x.base); e.amount = round3(e.amount + x.amount);
      if (!x.certificate) e.missing += 1;
    });

    return {
      year: y, employees: rows.length, rows,
      gross: sal.gross, cnss: sal.cnss, irpp: sal.irpp, css: sal.css, net: sal.net,
      held, heldBySupplier: Object.values(heldBySupplier).sort((a, b) => (a.supplier || '').localeCompare(b.supplier || '', 'fr')),
      heldTotal: round3(held.reduce((s, x) => s + x.amount, 0)),
      heldMissing: held.filter(x => !x.certificate).length,
      dueDate: dateLimiteSociale(data, 'employeur', y)     // échéance du calendrier — À VÉRIFIER
    };
  }

  // La date limite d'une déclaration sociale suit la RÈGLE du calendrier fiscal (10.14.0). La Paie
  // écrivait le 15 et le 30 avril en dur, pendant que le calendrier laisse régler le jour de chaque
  // échéance : réglée au 20, la même CNSS était due le 15 dans la Paie et « À faire », le 20 au
  // calendrier — deux écrans, deux dates pour une déclaration.
  function dateLimiteSociale(data, kind, year, quarter) {
    const r = fiscalDeadlines(data).find(x => x.id === kind) || {};
    const jour = (y, m) => `${y}-${pad2(m)}-${pad2(Math.min(Number(r.day) || (kind === 'cnss' ? 15 : 30), daysInMonth(y, m)))}`;
    if (kind === 'cnss') {
      const m = Number(quarter) * 3 + 1;
      return m > 12 ? jour(Number(year) + 1, 1) : jour(Number(year), m);
    }
    return jour(Number(year) + 1, Number(r.month) || 4);
  }
  // Celle d'une déclaration désignée par son identifiant (`cnss-2026-T2`, `employeur-2025`) — c'est
  // ainsi qu'une déclaration déposée se range : sans elle, le calendrier écrivait « — » à côté.
  function dateLimiteDeclarationSociale(data, id) {
    const c = /^cnss-(\d{4})-T([1-4])$/.exec(String(id || ''));
    if (c) return dateLimiteSociale(data, 'cnss', Number(c[1]), Number(c[2]));
    const e = /^employeur-(\d{4})$/.exec(String(id || ''));
    return e ? dateLimiteSociale(data, 'employeur', Number(e[1])) : '';
  }

  // Le calendrier fiscal, tel que l'écran le montre : ce qui arrive, et d'abord ce qui est EN
  // RETARD (10.14.0). Une occurrence passée disparaissait du calendrier — `upcomingFiscal` ne regarde
  // que devant —, et la CNSS d'un trimestre jamais déposée n'était ni « à venir » ni « déposée » :
  // nulle part, sur la page faite pour ne rien oublier. Seules les déclarations sociales ont un
  // retard qu'on SAIT (`socialDue` connaît les bulletins) ; une TVA non pointée peut avoir été
  // déposée sans être pointée, et la crier en retard chaque mois serait du bruit.
  function calendrierFiscal(data, todayIso, withinDays) {
    const t = todayIso || today();
    const retards = socialDue(data, t).filter(x => x.late).map(x => ({ id: x.kind, label: x.label, note: '',
      date: x.dueDate, days: daysBetween(t, x.dueDate), filingId: '', socialId: x.id, fin: '', enCours: false,
      retard: true, amount: x.amount }));
    return retards.concat(upcomingFiscal(data, t, withinDays).map(x => ({ ...x, retard: false })));
  }

  // Les déclarations sociales dues et pas encore marquées déposées.
  // Ce que la CNSS d'une année porte encore de NON déclaré (10.14.0) : la carte de la Paie disait
  // « CNSS à reverser » au-dessus du total de l'année, trimestres déjà déposés compris — un reste dû
  // quatre fois trop grand en décembre. Le total reste le total ; ce qui n'est pas déposé se compte.
  function cnssNonDeclaree(data, year) {
    const done = socialesDeposees(data);
    return round3(QUARTERS.reduce((t, [q]) => done.has(`cnss-${year}-T${q}`) ? t : t + cnssDeclaration(data, year, q).total, 0));
  }

  function socialDue(data, todayIso) {
    const t = todayIso || today();
    if (!(data.employees || []).length) return [];
    const done = socialesDeposees(data);
    const out = [];
    const y = Number(t.slice(0, 4));
    // 10.14.1 (SOC-01) — toutes les années que les bulletins connaissent, pas les deux dernières. Un
    // trimestre de 2022 jamais déposé disparaissait de « À faire », du calendrier et de la Paie le
    // jour où il passait l'an dernier : un pense-bête qui ne regarde que devant oublie ce qui est
    // passé sans être fait (10.14.0). Les bulletins disent qu'il était dû ; seul « Marquer déposée »
    // dit qu'il ne l'est plus.
    const annees = (data.payslips || []).map(sl => Number(sl.year)).filter(n => n > 1900 && n <= y);
    const debut = Math.min(y - 1, ...annees);
    for (let yy = debut; yy <= y; yy++) (yy => {
      QUARTERS.forEach(([q]) => {
        const d = cnssDeclaration(data, yy, q);
        if (!d.slips || d.dueDate > addDays(t, 45)) return;       // pas encore d'actualité
        // 10.12.0 — un trimestre ne se déclare qu'une fois TERMINÉ. Le 24 septembre, « 1 déclaration
        // sociale à déposer : CNSS 3e trimestre » invitait à déposer — et à « Marquer déposée » — une
        // déclaration à laquelle manqueraient les bulletins de la fin du mois.
        const finTrimestre = addDays(`${yy}-${String(q * 3).padStart(2, '0')}-01`, daysInMonth(yy, q * 3) - 1);
        if (t <= finTrimestre) return;
        const id = `cnss-${yy}-T${q}`;
        if (done.has(id)) return;
        out.push({ id, kind: 'cnss', year: yy, quarter: q, label: `Déclaration CNSS ${quarterLabel(q)} ${yy}`,
          dueDate: d.dueDate, late: d.dueDate < t, amount: d.total });
      });
      const a = employerAnnual(data, yy, data.company);
      if (a.rows.length && a.dueDate <= addDays(t, 60)) {
        const id = `employeur-${yy}`;
        if (!done.has(id)) out.push({ id, kind: 'employeur', year: yy, label: `Déclaration annuelle d'employeur ${yy}`,
          dueDate: a.dueDate, late: a.dueDate < t, amount: round3(a.irpp + a.css) });
      }
    })(yy);
    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

