  // ---------- Paie (5.0.0) ----------
  // (plateforme, 17 § 3.2, lot P1b) La boîte du Personnel : rien de ce qui suit ne se voit plus du reste de la page. Le
  // Personnel voit encore ce qui est commun (le socle) ; il ne parle aux autres que par les registres du socle : ses
  // pages, ses lignes de « À faire », de la palette et de « Créer », et les points qu'il remplit (en bas de la boîte).
  (function () {
  const employeeById = id => data.employees.find(e => e.id === id);
  const payslipById = id => data.payslips.find(p => p.id === id);
  const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // (1.305.0) « d'Amel », « d'octobre 2026 », « de Karim » : ce qu'on écrit au comptable s'élide comme on le dirait.
  const deDit = x => window.SkanCompta.deMois(String(x || ''));
  // (1.257.0) Le minimum d'une équipe (« le fournil tient la nuit à deux ») : les jours d'un congé où, ce salarié parti,
  // il resterait moins de monde que le minimum réglé. Les autres absents se lisent sur leur pointage (congés saisis,
  // absences, maladies) ; une demande pas encore acceptée ne compte pas. Rien sans minimum réglé.
  function manqueEquipe(employeeId, du, au) {
    const st = C.payrollSettings(data), e = employeeById(employeeId), q = e && C.equipeDe(st, e);
    if (!q || !(Number(q.minimum) > 0) || !du || !au || au < du) return null;
    const autres = data.employees.filter(x => x.id !== e.id && x.equipeId === q.id && x.active !== false);
    const jours = [];
    for (let iso = du; iso <= au && jours.length < 62; iso = C.addDays(iso, 1)) {
      const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
      if (!(q.jours || []).includes(new Date(iso + 'T00:00:00Z').getUTCDay())) continue;
      const la = autres.filter(x => { const j = C.pointageDuMois(data, x, y, m).jours.find(k => k.jour === d); return j && j.code === 'P'; });
      if (la.length < Number(q.minimum)) jours.push({ iso, restent: la.map(x => String(x.name || '').split(' ')[0]) });
    }
    return jours.length ? { q, jours } : null;
  }

  // (plateforme) 1.230.0 — CORRIGER SANS RÉÉCRIRE (docs/revue-paie.md, lot R3). Un bulletin payé et remis ne se réécrit
  // plus : l'écart passe sur le premier mois suivant qui n'est pas encore payé, en régularisation. Le moteur commun
  // (compta.js, `regulsDuMois`) la reprend sur le bulletin de ce mois quand il s'établit ; s'il existe déjà, elle s'y ajoute.
  const ymDe = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  function moisLibreApres(empId, y, m) {
    let yy = Number(y), mm = Number(m);
    for (let k = 0; k < 36; k++) {
      mm += 1; if (mm > 12) { mm = 1; yy += 1; }
      const b = (data.payslips || []).find(p => p.employeeId === empId && Number(p.year) === yy && Number(p.month) === mm);
      // (plateforme, 03/11/2026 — 16 § 10.1, point 7) Un mois clos n'est pas libre : le serveur refuse d'y refaire un bulletin.
      if ((!b || (!b.paidDate && !b.valideLe)) && !C.isClosedDate(data, C.payslipDate({ year: yy, month: mm }))) return { year: yy, month: mm, bulletin: b || null };
    }
    return null;
  }
  function recalculerBulletin(b, emp) {
    // (plateforme) 1.266.3 — chaque chemin qui enregistre un bulletin donne son mois au calcul (la CSS est datée).
    const input = { year: b.year, month: b.month, gross: b.gross, workedDays: b.workedDays, absentDays: b.absentDays, bonuses: b.bonuses || [], deductions: b.deductions || [], prorata: b.prorata || null };
    b.computed = C.computePayslip(emp, input, C.payrollSettings(data));
    // Changé après son bon à payer : il se ré-approuve (1.227.0).
    delete b.bonAPayerLe;
  }
  // Porte une régularisation sur son mois ; rend de quoi la défaire (le toast « Annuler »).
  function porterRegularisation(emp, r) {
    emp.regularisations = [...(Array.isArray(emp.regularisations) ? emp.regularisations : []), r];
    const [yy, mm] = r.pourMois.split('-').map(Number);
    const b = (data.payslips || []).find(p => p.employeeId === emp.id && Number(p.year) === yy && Number(p.month) === mm && !p.paidDate && !p.valideLe);
    const avant = b ? { bonuses: deepCopy(b.bonuses || []), computed: b.computed, bonAPayerLe: b.bonAPayerLe } : null;
    if (b) { b.bonuses = [...(b.bonuses || []), { label: r.label, amount: r.amount, taxable: r.taxable, regulId: r.id }]; recalculerBulletin(b, emp); }
    return () => {
      const e2 = employeeById(emp.id); if (e2) e2.regularisations = (e2.regularisations || []).filter(x => x.id !== r.id);
      const b2 = b && payslipById(b.id);
      if (b2 && avant) { b2.bonuses = avant.bonuses; b2.computed = avant.computed; if (avant.bonAPayerLe) b2.bonAPayerLe = avant.bonAPayerLe; }
    };
  }
  function regularisationFenetre(slip, done, opts) {
    const b = payslipById(slip.id); if (!b) return;
    const emp = employeeById(b.employeeId); if (!emp) return;
    if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
    const cible = moisLibreApres(emp.id, b.year, b.month);
    if (!cible) { toast('Aucun mois libre dans les trois ans qui suivent : régularise sur un bulletin pas encore payé.', true); return; }
    const cur = company().currency, nomCible = `${MONTHS_LONG[cible.month - 1]} ${cible.year}`, nomDe = `${MONTHS_LONG[b.month - 1]} ${b.year}`;
    modal(`<h2>Régulariser le bulletin ${/^[aeiouyéè]/i.test(nomDe) ? 'd\'' : 'de '}${h(nomDe)}</h2>
      <p class="small muted">Ce bulletin est payé${b.remisLe ? ' et remis' : ''} : il ne change plus. Ce qui manquait (ou ce qui a été payé en trop) passe sur le bulletin de <b>${h(nomCible)}</b>, avec son motif${cible.bulletin ? ', qui se recalcule' : ', quand il s’établira'}.</p>
      <form id="rg" class="grid-2">
        <label class="field obligatoire">${lbl('Sens', 'pay.regulSens')}<select name="sens"><option value="plus">Il lui manquait (à ajouter)</option><option value="moins">Il a reçu en trop (à retirer)</option></select></label>
        ${field(lbl(`Montant (${h(C.normCurrency(cur))})`, 'pay.regulMontant'), 'amount', '', 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num" required')}
        ${field(lbl('Libellé sur le bulletin', 'pay.regulLabel'), 'label', `Régularisation ${nomDe}`, 'text', 'class="span-2"')}
        <label class="field span-2">${lbl('Motif', 'pay.regulMotif')}<input type="text" name="motif" placeholder="ex. heures supplémentaires oubliées"></label>
        <label class="check span-2"><input type="checkbox" name="taxable" checked> soumise à la CNSS et à l'impôt ${info('pay.regulImposable')}</label>
      </form>
      ${(() => {
        // (1.256.0) Des heures oubliées après la validation (la maquette, « Des heures oubliées après validation ») : le
        // montant se calcule au taux du mois payé (le brut du mois ÷ les heures d'un mois complet × les heures × la majoration).
        const st = C.payrollSettings(data), maj = C.majorationsHs(st), hm = C.heuresDuMoisDe(st, emp);
        if (!maj.length || !hm) return `<p class="small muted" id="rg-hs-non">Des heures sup oubliées ? Règle d'abord leurs majorations dans « Les horaires » : le montant se calculera ici.</p>`;
        return `<div class="rg-hs" id="rg-hs"><span class="small"><b>Des heures oubliées ?</b> Calcule le montant :</span><input type="text" inputmode="decimal" data-montant id="rg-hs-h" class="num" placeholder="4" aria-label="Le nombre d'heures"><span class="small">h à</span><select id="rg-hs-m" aria-label="La majoration">${maj.map(x => `<option value="${x}">+ ${pct(x)} %</option>`).join('')}</select><span class="small muted" id="rg-hs-r"></span></div>`;
      })()}
      <p class="small warn-text" id="rg-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions">${opts && opts.rectificatif && peutEcrireAuCabinet() ? '<button type="button" class="btn" id="rg-rect" style="margin-inline-end:auto" title="Ton cabinet refait le bulletin du mois, au lieu d\'une ligne sur le mois suivant">Demander un rectificatif…</button>' : ''}<button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="rg-ok">Porter sur ${h(nomCible)}</button></div>`, (root, fermer) => {
      if ($('#rg-hs', root)) {
        const calc = () => {
          const hh = lireMontant($('#rg-hs-h', root).value), mj = Number($('#rg-hs-m', root).value) || 0, st = C.payrollSettings(data), hm = C.heuresDuMoisDe(st, emp) || 208;
          const brut = C.brutDuMois(emp, Number(b.year), Number(b.month)) || Number(emp.grossSalary) || 0;
          const mt = hh > 0 ? C.round3(brut / hm * hh * (100 + mj) / 100) : 0;
          $('#rg-hs-r', root).textContent = mt ? `${C.money(brut, cur)} ÷ ${pct(hm)} h × ${pct(hh)} h × ${pct((100 + mj) / 100)} = ${C.money(mt, cur)}` : '';
          if (mt) { $('#rg [name=amount]', root).value = C.money(mt, null, 3); $('#rg [name=sens]', root).value = 'plus'; $('#rg [name=label]', root).value = `${pct(hh)} h sup à + ${pct(mj)} % (${nomDe})`; if (!$('#rg [name=motif]', root).value) $('#rg [name=motif]', root).value = 'heures supplémentaires oubliées'; }
        };
        $('#rg-hs-h', root).oninput = calc; $('#rg-hs-m', root).onchange = calc;
      }
      if ($('#rg-rect', root)) $('#rg-rect', root).onclick = () => { fermer(); opts.rectificatif(b); };
      $('#rg-ok', root).onclick = () => {
        const v = formValues($('#rg', root)), m = C.round3(Number(v.amount) || 0);
        const refus = $('#rg-refus', root);
        if (!(m > 0)) { refus.hidden = false; refus.textContent = 'Le montant de la régularisation manque : ce qui manquait, ou ce qui a été payé en trop.'; $('[name=amount]', root).focus(); return; }
        if (closedBlock(C.payslipDate({ year: cible.year, month: cible.month }), 'Cette régularisation')) return;
        const r = { id: C.uid(), pourMois: ymDe(cible.year, cible.month), label: String(v.label || '').trim() || `Régularisation ${nomDe}`, amount: v.sens === 'moins' ? -m : m,
          taxable: !!v.taxable, motif: String(v.motif || '').trim(), deBulletin: b.id, le: C.today() };
        const defaire = porterRegularisation(emp, r);
        save(true); fermer(); if (done) done();
        toastUndo(`${v.sens === 'moins' ? 'Retenue de ' : ''}${C.money(m, cur)} ${v.sens === 'moins' ? 'portée' : 'portés'} sur le bulletin de ${nomCible}`, () => { defaire(); save(true); if (done) done(); });
      };
    });
  }
  // Une augmentation qui compte depuis un mois PASSÉ : les bulletins de ces mois-là pas encore payés se refont au nouveau
  // salaire ; ceux déjà payés ne changent pas, la différence se propose en RAPPEL sur le premier mois libre.
  // (1.256.0) Le calcul du rappel, à part : il sert à l'augmentation d'un salarié ET à l'augmentation en lot. Les bulletins
  // pas encore payés se refont au nouveau salaire (c'est son effet de bord) ; ceux déjà payés donnent l'écart à rappeler.
  function calculRappel(e, desM) {
    const st = C.payrollSettings(data);
    const concernes = (data.payslips || []).filter(p => p.employeeId === e.id && ymDe(p.year, p.month) >= desM);
    if (!concernes.length) return { refaits: 0, payes: [], total: 0, cible: null, lesMois: '' };
    const brutDe = p => { const f = C.brutDuMois(e, Number(p.year), Number(p.month)); return p.prorata ? C.round3(f * Number(p.prorata.jours) / Number(p.prorata.sur)) : f; };
    // (plateforme, 03/11/2026 — 16 § 10.1, point 7) Un bulletin d'un mois clos ne se refait pas (le serveur le refuse) : il
    // se tient comme un bulletin payé, et son écart part en rappel sur le premier mois ouvert.
    // (1.274.0, audit G05) Validé par le cabinet, il ne se refait pas non plus.
    const tenu = p => p.paidDate || p.valideLe || C.isClosedDate(data, C.payslipDate(p));
    let refaits = 0;
    concernes.filter(p => !tenu(p)).forEach(p => {
      const g = brutDe(p); if (C.round3(g - Number(p.gross)) === 0) return;
      p.gross = g; if (p.prorata) p.prorata = { ...p.prorata, brutFiche: C.brutDuMois(e, Number(p.year), Number(p.month)), brut: g };
      recalculerBulletin(p, e); refaits++;
    });
    // (1.274.0, audit du 04/11/2026, G08) L'écart d'un mois payé se calcule au moteur (`ecartDeRappel`) : prorata refait au
    // nouveau salaire, moins ce qu'un rappel d'avant a déjà porté pour ce mois.
    const payes = concernes.filter(tenu).map(p => {
      return { p, ecart: C.ecartDeRappel(e, p, st) };
    }).filter(x => x.ecart !== 0).sort((a, b) => (a.p.year - b.p.year) || (a.p.month - b.p.month));
    const total = C.round3(payes.reduce((a, x) => a + x.ecart, 0));
    const der = payes.length ? payes[payes.length - 1].p : null, cible = der ? moisLibreApres(e.id, der.year, der.month) : null;
    return { refaits, payes, total, cible, lesMois: payes.map(x => MONTHS_LONG[x.p.month - 1]).join(', ') };
  }
  // (1.258.0) « Une augmentation qui compte depuis le 01/05 » (la maquette, O05) : avant de porter un rappel, la fenêtre
  // montre, salarié par salarié, l'écart par mois, le nombre de mois déjà payés, le rappel brut (un mois au prorata le dit),
  // et le mois qui le reçoit. Rend vrai si le rappel est accepté. La façon d'imposer un rappel sur plusieurs mois :
  // À VÉRIFIER avec le comptable.
  function rappelFenetre(liste, desM) {
    return new Promise(resolve => {
      const cur = company().currency, L = liste.filter(x => x.r && x.r.payes.length && x.r.total && x.r.cible);
      if (!L.length) { resolve(false); return; }
      const moisDes = `${MONTHS_LONG[Number(desM.slice(5, 7)) - 1]} ${desM.slice(0, 4)}`, dateDes = C.fmtDate(`${desM}-01`);
      const cibles = [...new Set(L.map(x => ymDe(x.r.cible.year, x.r.cible.month)))];
      const nomMois = ym => MONTHS_LONG[Number(ym.slice(5, 7)) - 1];
      const parMois = x => { const s = (x.e.salaires || []).find(v => v.des === desM); return s && Number(s.avant) > 0 ? C.round3(Number(s.brut) - Number(s.avant)) : null; };
      const note = x => x.r.payes.filter(y => y.p.prorata).map(y => `${MONTHS_LONG[y.p.month - 1]} au prorata : ${y.p.prorata.jours} jours sur ${y.p.prorata.sur}`).join(' · ');
      const total = C.round3(L.reduce((a, x) => a + x.r.total, 0)), une = cibles.length === 1 ? nomMois(cibles[0]) : '';
      let fini = false;
      const finir = v => { if (fini) return; fini = true; resolve(v); };
      modal(`<h2>Une augmentation qui compte depuis le ${h(dateDes)}</h2>
        <p class="sous-f rp-intro">Les bulletins déjà payés${L.some(x => x.r.payes.some(y => !y.p.paidDate)) ? ' ou d\'une période clôturée' : ''} depuis ${h(moisDes)} ne changent pas : la différence se met sur le bulletin du premier mois ouvert pas encore payé, en une ligne « Rappel de salaire ». Les mois pas encore payés, eux, se refont au nouveau salaire.</p>
        <table class="mini lu rp-t" id="rp-t"><thead><tr><th>Salarié</th><th class="r">+ par mois</th><th class="r">Mois</th><th class="r">Rappel brut</th></tr></thead><tbody>
          ${L.map(x => { const pm = parMois(x), n = note(x); return `<tr data-rp="${h(x.e.id)}"><td><b>${h(x.e.name)}</b>${n ? `<small>${h(n)}</small>` : ''}${cibles.length > 1 ? `<small>sur ${h(nomMois(ymDe(x.r.cible.year, x.r.cible.month)))}</small>` : ''}</td><td class="r">${pm != null ? h(C.money(pm, cur)) : '—'}</td><td class="r">${x.r.payes.length}</td><td class="r"><b>${h(C.money(x.r.total, cur))}</b></td></tr>`; }).join('')}
        </tbody><tfoot><tr><td colspan="3"><b>${une ? `Rappel ${/^[aeiouyéè]/i.test(une) ? 'd\'' : 'de '}${h(une)}, brut` : 'Les rappels, brut'}</b></td><td class="r"><b>${h(C.money(total, cur))}</b></td></tr></tfoot></table>
        <p class="regle">${lfIc('aide', 14)} Le rappel est un salaire : il porte la CNSS et l'impôt du mois qui le reçoit. La façon d'imposer un rappel sur plusieurs mois : À VÉRIFIER avec ton comptable.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="rp-ok">${lfIc('coche', 15, 2.4)} ${une ? `Mettre le rappel sur ${h(une)}` : `Porter les ${L.length} rappels`}</button></div>`, (root, fermer) => {
        $('#rp-ok', root).onclick = () => { finir(true); fermer(); };
      }, () => finir(false));
    });
  }
  // Porter le rappel calculé sur le bulletin libre qui suit (une régularisation imposable). Rend la fonction qui le défait.
  function porterRappel(e, desM, r) {
    // (1.274.0, G08) Le rappel garde, mois par mois, ce qu'il rappelle : une augmentation suivante ne le rappelle pas encore.
    return porterRegularisation(e, { id: C.uid(), pourMois: ymDe(r.cible.year, r.cible.month), label: `Rappel de salaire (${r.lesMois})`, amount: r.total, taxable: true,
      motif: `Augmentation à partir de ${MONTHS_LONG[Number(desM.slice(5, 7)) - 1]} ${desM.slice(0, 4)}`, rappel: true, le: C.today(),
      rappelDe: r.payes.map(x => ({ mois: ymDe(x.p.year, x.p.month), brut: x.ecart })) });
  }
  async function rappelApresAugmentation(e, desM, done) {
    const cur = company().currency;
    const { refaits, payes, total, cible, lesMois } = calculRappel(e, desM);
    if (refaits) save(true);
    if (!payes.length || !total) { if (refaits) toast(`${pl(refaits, 'bulletin')} pas encore ${refaits > 1 ? 'payés refaits' : 'payé refait'} au nouveau salaire.`); return; }
    if (!cible) return;
    const nomCible = `${MONTHS_LONG[cible.month - 1]} ${cible.year}`;
    const ok = await rappelFenetre([{ e, r: { payes, total, cible, lesMois } }], desM);
    if (!ok) return;
    const defaire = porterRappel(e, desM, { total, cible, lesMois });
    save(true); if (done) done();
    toastUndo(`Rappel de ${C.money(total, cur)} porté sur le bulletin de ${nomCible}`, () => { defaire(); save(true); if (done) done(); });
  }
  // (1.256.0) LES PRIMES ET RETENUES DU MOIS (la maquette, « Ouvrir : Les primes et retenues du mois » ; les concurrents,
  // point 6) : ce qui change un bulletin ce mois-ci, au-delà de la fiche et du pointage. Une RUBRIQUE se règle une fois (son
  // nom, prime ou retenue, imposable ou non) ; chaque mois, une case par salarié et par rubrique. Les montants vivent sur
  // la fiche (`employee.variables`, compta.js `variablesDuMois`) : le bulletin du mois les reprend, et un bulletin déjà
  // établi, pas payé ni validé, les reçoit tout de suite. Un bulletin payé ne change plus : sa case se lit, sans s'écrire.
  // Les quatre rubriques proposées sont celles de la maquette ; qu'elles portent la CNSS et l'impôt : À VÉRIFIER.
  const RUBRIQUES_PROPOSEES = [{ id: 'exceptionnelle', label: 'Prime exceptionnelle', sorte: 'prime', taxable: true }, { id: 'panier', label: 'Indemnité de panier', sorte: 'prime', taxable: true },
    { id: 'commission', label: 'Commission sur les ventes', sorte: 'prime', taxable: true }, { id: 'retenue', label: 'Retenue diverse', sorte: 'retenue', taxable: true }];
  const rubriquesPaie = () => { const r = (data.payrollSettings || {}).rubriques; return Array.isArray(r) && r.length ? r : RUBRIQUES_PROPOSEES; };
  function variablesCarte(y, m) {
    const cur = company().currency, ym = ymDe(y, m), mois = MONTHS_LONG[m - 1];
    const L = C.activeEmployees(data).flatMap(e => (e.variables || []).filter(v => v.mois === ym && Number(v.amount) > 0).map(v => ({ e, v })));
    const pr = C.round3(L.filter(x => x.v.sorte !== 'retenue').reduce((a, x) => a + Number(x.v.amount), 0)), re = C.round3(L.filter(x => x.v.sorte === 'retenue').reduce((a, x) => a + Number(x.v.amount), 0));
    return `<section class="pa-carte" id="pv-carte"><div class="pa-carte-t"><b>Les primes et retenues ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)}</b><span class="mu">${L.length ? `${pl(L.length, 'montant')} · ${pr ? `${C.money(pr, cur)} de primes` : ''}${pr && re ? ' · ' : ''}${re ? `${C.money(re, cur)} retenus` : ''}` : 'rien de plus ce mois : les primes de chaque mois viennent de la fiche, les heures et les absences du pointage'}</span>
      <button type="button" class="btn btn-sm" id="pv-carte-ouvrir">${lfIc('ecriture', 14)} ${L.length ? 'Modifier…' : 'Ajouter…'}</button></div>
      ${L.length ? `<ul class="pv-l">${L.slice(0, 6).map(({ e, v }) => `<li><span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}" aria-hidden="true">${h(C.initialesDe(e.name || ''))}</span><span><b>${h(e.name)}</b><small>${h(v.label)}</small></span><span class="num ${v.sorte === 'retenue' ? 'neg' : ''}">${v.sorte === 'retenue' ? '− ' : '+ '}${C.money(v.amount, cur)}</span></li>`).join('')}${L.length > 6 ? `<li class="muted small">et ${pl(L.length - 6, 'autre')}…</li>` : ''}</ul>` : ''}</section>`;
  }
  // (1.258.0, la maquette O28) « Le mois » avant ses bulletins : le pointage du mois en lecture (ce que chaque bulletin
  // reprendra : jours payés, heures sup, absences, retards) et ce qui reste à régler avant, chacun ouvrant le pointage.
  function moisPointageHtml(y, m) {
    const premier = `${y}-${String(m).padStart(2, '0')}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1), mois = MONTHS_LONG[m - 1];
    const emps = data.employees.filter(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier)).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    if (!emps.length) return '';
    const an = C.anomaliesPointage(data, y, m, C.today());
    const resume = p => { const hs = C.round3(Object.values(p.hs || {}).reduce((a, v) => a + Number(v), 0)); return [`${pct(p.payes)} j`, hs ? `${pct(hs)} h sup` : '', p.absences ? `${pct(p.absences)} A` : '', p.retards ? `${pct(p.retards)} min de retard` : ''].filter(Boolean).join(' · '); };
    const enCours = C.today() <= dernier;
    return `<section class="pa-carte" id="mp-pointage"><div class="pa-carte-t"><b>Le pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)}</b><span class="mu">${enCours ? `en cours, jusqu'au ${h(C.fmtDate(dernier))} : ` : ''}ce que les bulletins reprendront</span>
      <button type="button" class="btn btn-sm" data-mp-pointage>${lfIc('equipe', 14)} Ouvrir le pointage</button></div>
      ${an.length ? `<div class="bandeau ambre pa-bandeau pa-ambre mp-an" role="status">${lfIc('alerte', 18)}<span class="txt"><b>${an.length > 1 ? `${an.length} choses à régler` : 'Une chose à régler'} avant les bulletins</b><span>${h(an.slice(0, 2).map(a => { const e = emps.find(x => x.id === a.employeeId) || {}; return `${String(e.name || '').split(' ')[0]} : ${a.sorte === 'sortie' ? `une entrée sans sortie le ${a.jour}` : `${pl((a.jours || []).length, 'jour')} sans badge ni justificatif`}`; }).join(' ; '))}${an.length > 2 ? '…' : ''}</span></span><button type="button" class="btn btn-sm" data-mp-pointage>Les régler…</button></div>` : ''}
      <table class="mini lu mp-t" id="mp-t"><tbody>${emps.map(e => { const p = C.pointageDuMois(data, e, y, m); return `<tr><td><span class="cl-i">${pmAvDe(e.name)}<b>${h(e.name)}</b></span></td><td class="r">${h(resume(p))}</td></tr>`; }).join('')}</tbody></table></section>`;
  }
  // Le bulletin établi d'un mois reçoit les variables de ce mois (celles d'avant s'en vont) ; payé ou validé, il ne bouge pas.
  function appliquerVariables(e, y, m) {
    const b = (data.payslips || []).find(p => p.employeeId === e.id && Number(p.year) === Number(y) && Number(p.month) === Number(m));
    if (!b || b.paidDate || b.valideLe || C.isClosedDate(data, C.payslipDate(b))) return false;
    const v = C.variablesDuMois(e, y, m);
    b.bonuses = [...(b.bonuses || []).filter(x => !x.variableId), ...v.bonuses];
    b.deductions = [...(b.deductions || []).filter(x => !x.variableId), ...v.deductions];
    recalculerBulletin(b, e); return true;
  }
  function variablesFenetre(y, m, done) {
    if (enLecture('employees')) { toast(refusLecture('employees'), true); return; }
    const cur = company().currency, ym = ymDe(y, m), mois = `${MONTHS_LONG[m - 1]} ${y}`;
    const emps = C.activeEmployees(data).filter(e => !(e.endDate && e.endDate < `${ym}-01`) && !(e.hireDate && e.hireDate > `${ym}-31`)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    if (!emps.length) { toast(`Aucun salarié en poste en ${mois}.`, true); return; }
    const rub = deepCopy(rubriquesPaie());
    // La grille : valeur[e.id][rubrique.id] (un nombre, ou '' pour vide).
    const val = {};
    emps.forEach(e => { val[e.id] = {}; (e.variables || []).filter(v => v.mois === ym).forEach(v => { val[e.id][v.rubrique || v.id] = Number(v.amount) || ''; }); });
    // (16 § 10.1, point 7) Un bulletin d'un mois clos ne change plus non plus, comme un bulletin payé : sa case se lit.
    const fige = e => { const b = (data.payslips || []).find(p => p.employeeId === e.id && Number(p.year) === y && Number(p.month) === m); return b && (b.paidDate || b.valideLe || C.isClosedDate(data, C.payslipDate(b))) ? (b.paidDate ? 'payé' : b.valideLe ? 'validé' : 'd\'une période clôturée') : ''; };
    let modifie = false;
    modal(`<div class="pv-fen"><h2>Les primes et retenues ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)}</h2>
      <p class="small muted">Ce qui change un bulletin ce mois-ci, au-delà de la fiche et du pointage. Chaque rubrique est réglée une fois : elle sait si elle s'ajoute au salaire (et porte la CNSS et l'impôt) ou se retient du net. Une case vide : rien.</p>
      <div class="scroll-x"><table class="list compact pv-t" id="pv-t"></table></div>
      <div class="pv-actions"><button type="button" class="btn btn-sm" id="pv-rub">${lfIc('plus', 14)} Une autre rubrique…</button><button type="button" class="btn btn-sm" id="pv-coller">${lfIc('importer', 14)} Coller depuis un tableur…</button></div>
      <div id="pv-rub-f" class="pv-sous" hidden><input type="text" id="pv-rub-l" placeholder="Prime de rendement" aria-label="Le nom de la rubrique" maxlength="60"><select id="pv-rub-s" aria-label="Prime ou retenue"><option value="prime">s'ajoute au salaire</option><option value="retenue">se retient du net</option></select><label class="check small"><input type="checkbox" id="pv-rub-t" checked> porte la CNSS et l'impôt</label><button type="button" class="btn btn-sm btn-primary" id="pv-rub-ok">Ajouter la colonne</button></div>
      <div id="pv-coller-f" class="pv-sous" hidden><p class="small">Dans ton tableur, une ligne par salarié : son nom (ou son CIN) dans la première colonne, puis une colonne par rubrique, <b>avec la ligne des titres</b>. Copie, puis colle ici.</p><textarea id="pv-coller-t" rows="5" spellcheck="false" placeholder="Salarié&#9;Prime exceptionnelle&#9;Retenue diverse&#10;Mourad Trabelsi&#9;150,000&#9;&#10;Nadia Ben Salah&#9;&#9;20,000"></textarea><p class="small" id="pv-coller-r" role="status" aria-live="polite"></p><button type="button" class="btn btn-sm btn-primary" id="pv-coller-ok" disabled>Mettre dans la grille</button></div>
      <p class="small muted mt"><em>À VÉRIFIER avec ton comptable : ce que chaque rubrique porte (CNSS, impôt), et ce qui peut se retenir sur un salaire.</em></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="pv-ok">Enregistrer</button></div></div>`, (root, fermer) => {
      const dessiner = () => {
        $('#pv-t', root).innerHTML = `<thead><tr><th>Salarié</th>${rub.map(r => `<th class="r pv-th"><b>${h(r.label)}</b><small>${r.sorte === 'retenue' ? 'se retient du net' : r.taxable !== false ? 'porte la CNSS et l\'impôt' : 'sans CNSS ni impôt'}</small></th>`).join('')}</tr></thead>
          <tbody>${emps.map(e => { const f = fige(e); return `<tr data-pv="${h(e.id)}"><td class="nw"><b>${h(e.name)}</b>${f ? `<small class="muted"> bulletin ${f} : il ne change plus</small>` : ''}</td>${rub.map(r => `<td class="r"><input type="text" inputmode="decimal" data-montant autocomplete="off" class="num pv-c" data-pv-r="${h(r.id)}" value="${val[e.id][r.id] ? h(C.money(val[e.id][r.id], null, 3)) : ''}" placeholder="—" ${f ? 'disabled' : ''} aria-label="${h(e.name)} : ${h(r.label)}"></td>`).join('')}</tr>`; }).join('')}</tbody>
          <tfoot><tr class="total-row"><td><b>Total</b></td>${rub.map(r => `<td class="r nw" data-pv-tot="${h(r.id)}"></td>`).join('')}</tr></tfoot>`;
        totaux();
      };
      const totaux = () => rub.forEach(r => { const t = C.round3(emps.reduce((a, e) => a + (Number(val[e.id][r.id]) || 0), 0)); const c = $(`[data-pv-tot="${CSS.escape(r.id)}"]`, root); if (c) c.textContent = t ? C.money(t, cur) : '—'; });
      $('#pv-t', root).addEventListener('input', ev => { const c = ev.target.closest('[data-pv-r]'); if (!c) return; val[c.closest('tr').dataset.pv][c.dataset.pvR] = c.value.trim() === '' ? '' : lireMontant(c.value); modifie = true; totaux(); });
      // Entrée passe à la case du dessous, comme un tableur.
      $('#pv-t', root).addEventListener('keydown', ev => { if (ev.key !== 'Enter' || !ev.target.matches('.pv-c')) return; ev.preventDefault(); const td = ev.target.closest('td'), tr = td.closest('tr'), i = [...tr.children].indexOf(td); const nx = tr.nextElementSibling && tr.nextElementSibling.children[i]; const inp = nx && nx.querySelector('input:not([disabled])'); if (inp) { inp.focus(); inp.select(); } });
      dessiner();
      $('#pv-rub', root).onclick = () => { const f = $('#pv-rub-f', root); f.hidden = !f.hidden; $('#pv-coller-f', root).hidden = true; if (!f.hidden) $('#pv-rub-l', root).focus(); };
      $('#pv-rub-ok', root).onclick = () => {
        const l = $('#pv-rub-l', root).value.trim(); if (!l) { $('#pv-rub-l', root).focus(); return; }
        if (rub.some(r => r.label.toLowerCase() === l.toLowerCase())) { toast(`La rubrique « ${l} » existe déjà.`, true); return; }
        rub.push({ id: C.uid(), label: l, sorte: $('#pv-rub-s', root).value, taxable: $('#pv-rub-t', root).checked, cree: C.today() });
        modifie = true; $('#pv-rub-f', root).hidden = true; $('#pv-rub-l', root).value = ''; dessiner();
      };
      $('#pv-coller', root).onclick = () => { const f = $('#pv-coller-f', root); f.hidden = !f.hidden; $('#pv-rub-f', root).hidden = true; if (!f.hidden) $('#pv-coller-t', root).focus(); };
      let lu = null;
      const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      $('#pv-coller-t', root).oninput = () => {
        const lignes = $('#pv-coller-t', root).value.split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t'));
        const r0 = $('#pv-coller-r', root); lu = null;
        if (lignes.length < 2) { r0.textContent = lignes.length ? 'Il faut la ligne des titres, puis une ligne par salarié.' : ''; $('#pv-coller-ok', root).disabled = true; return; }
        const cols = lignes[0].slice(1).map(t => rub.find(r => norm(r.label) === norm(t)) || null);
        const inconnues = lignes[0].slice(1).filter((t, i) => t.trim() && !cols[i]);
        const pris = [], absents = [], illisibles = [];
        lignes.slice(1).forEach(c => {
          const qui = norm(c[0]); const e = emps.find(x => norm(x.name) === qui || (x.cin && norm(x.cin) === qui));
          if (!e) { absents.push(c[0]); return; }
          cols.forEach((r, i) => { if (!r) return; const t = String(c[i + 1] || '').trim(); if (!t) return; const n = lireMontant(t); if (!(n > 0) || C.round3(n) !== n) illisibles.push(`${e.name} : « ${t} »`); else pris.push({ e, r, n }); });
        });
        lu = pris;
        r0.innerHTML = `${pris.length ? `<b>${pl(pris.length, 'montant lu', 'montants lus')}</b>` : 'Aucun montant lu'}${inconnues.length ? ` · <span class="warn-text">colonne${inconnues.length > 1 ? 's' : ''} sans rubrique : ${h(inconnues.join(', '))} (crée-la d'abord, ou renomme le titre)</span>` : ''}${absents.length ? ` · <span class="warn-text">pas en poste en ${h(MONTHS_LONG[m - 1])} : ${h(absents.join(', '))}</span>` : ''}${illisibles.length ? ` · <span class="warn-text">illisible : ${h(illisibles.join(' ; '))}</span>` : ''}`;
        $('#pv-coller-ok', root).disabled = !pris.length;
      };
      $('#pv-coller-ok', root).onclick = () => { if (!lu) return; lu.filter(x => !fige(x.e)).forEach(x => { val[x.e.id][x.r.id] = x.n; }); modifie = true; $('#pv-coller-f', root).hidden = true; dessiner(); toast(`${pl(lu.length, 'montant')} dans la grille : relis, puis « Enregistrer ».`); };
      $('#pv-ok', root).onclick = () => {
        const avant = emps.map(e => ({ id: e.id, variables: deepCopy(e.variables || []) })), rubAvant = deepCopy((data.payrollSettings || {}).rubriques);
        const avantBul = deepCopy((data.payslips || []).filter(p => Number(p.year) === y && Number(p.month) === m));
        data.payrollSettings = { ...(data.payrollSettings || {}), rubriques: rub };
        let refaits = 0;
        emps.forEach(e => {
          if (fige(e)) return;
          const garde = (e.variables || []).filter(v => v.mois !== ym);
          rub.forEach(r => { const n = Number(val[e.id][r.id]) || 0; if (n > 0) garde.push({ id: `${ym}-${r.id}`, rubrique: r.id, mois: ym, sorte: r.sorte, label: r.label, amount: C.round3(n), taxable: r.taxable !== false, le: C.today() }); });
          e.variables = garde;
          if (appliquerVariables(e, y, m)) refaits++;
        });
        save(true); modifie = false; fermer(); if (done) done();
        toastUndo(`Les primes et retenues ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${mois} enregistrées${refaits ? ` · ${pl(refaits, 'bulletin')} refait${refaits > 1 ? 's' : ''}` : ''}`, () => {
          avant.forEach(a => { const e = employeeById(a.id); if (e) e.variables = a.variables; });
          data.payrollSettings = { ...(data.payrollSettings || {}), rubriques: rubAvant }; if (!rubAvant) delete data.payrollSettings.rubriques;
          avantBul.forEach(b => { const i = data.payslips.findIndex(p => p.id === b.id); if (i >= 0) data.payslips[i] = b; });
          save(true); if (done) done();
        });
      };
    }, null, { classe: 'pv-large' });
  }
  // (1.256.0) L'AUGMENTATION EN LOT (docs/etudes/paie-concurrents.md, point 2) : l'augmentation annuelle, une négociation, la
  // convention — pour tous ceux qu'on coche, + x % ou + x DT, dès un mois. Chaque fiche garde l'ancien salaire dans son
  // historique (comme « Changer son salaire »), les bulletins pas encore payés se refont, et ceux déjà payés donnent un
  // rappel sur le bulletin libre qui suit, montré avant d'être porté.
  function augmentationLot(done) {
    if (enLecture('employees')) { toast(refusLecture('employees'), true); return; }
    const cur = company().currency, mp = C.moisDePaie(data), defaut = ymDe(mp.year, mp.month);
    const emps = C.activeEmployees(data).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    if (!emps.length) { toast('Aucun salarié en poste à augmenter.', true); return; }
    const mois = Array.from({ length: 25 }, (_, i) => { const t = (mp.year * 12 + mp.month - 1) - 12 + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
    modal(`<h2>Augmenter les salaires</h2>
      <p class="small muted">Pour ceux que tu coches, le même geste : un pourcentage ou une somme, à partir d'un mois. L'ancien salaire reste écrit sur chaque fiche ; un mois déjà payé reçoit un rappel sur le bulletin suivant.</p>
      <form id="al" class="al-form">
        <div class="pa-seg al-sens" role="radiogroup" aria-label="Pourcentage ou somme"><label><input type="radio" name="sorte" value="pct" checked><span>+ un pourcentage</span></label><label><input type="radio" name="sorte" value="dt"><span>+ une somme</span></label></div>
        <label class="field"><span id="al-lbl">${lbl('Augmentation (%)')}</span><input type="text" name="valeur" inputmode="decimal" data-montant autocomplete="off" class="num" placeholder="3,5"></label>
        <label class="field">${lbl('À partir de', 'pay.salaireDes')}<select name="des">${mois.map(v => `<option value="${v}" ${v === defaut ? 'selected' : ''}>${h(MONTHS_LONG[Number(v.slice(5, 7)) - 1])} ${v.slice(0, 4)}${v < defaut ? ' (passé)' : ''}</option>`).join('')}</select></label>
      </form>
      <div class="scroll-x"><table class="list compact pa-liste al-t" id="al-t"><thead><tr><th><input type="checkbox" id="al-tous" checked aria-label="Tous les salariés"></th><th>Salarié</th><th class="r">Salaire de base</th><th class="r">Nouveau</th><th class="r">Écart par mois</th></tr></thead><tbody>
        ${emps.map(e => `<tr data-al="${h(e.id)}"><td><input type="checkbox" data-al-c="${h(e.id)}" checked aria-label="${h(e.name)}"></td><td><b>${h(e.name)}</b><small class="muted"> ${h(e.position || '')}</small></td><td class="r nw" data-al-av></td><td class="r nw" data-al-ap></td><td class="r nw" data-al-ec></td></tr>`).join('')}
      </tbody><tfoot><tr class="total-row"><td></td><td><b id="al-n"></b></td><td></td><td></td><td class="r nw"><b id="al-tot"></b></td></tr></tfoot></table></div>
      <p class="small warn-text" id="al-refus" role="status" aria-live="polite" hidden></p>
      <p class="small muted"><em>À VÉRIFIER avec ton comptable : une augmentation de la convention collective peut fixer un minimum par catégorie.</em></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="al-ok" disabled>Augmenter</button></div>`, (root, fermer) => {
      const lire = () => { const v = formValues($('#al', root)); return { sorte: v.sorte || ($('[name=sorte]:checked', root) || {}).value || 'pct', val: Number(v.valeur) || 0, des: v.des || defaut }; };
      const nouveauDe = (e, o) => { const av = C.brutDuMois(e, Number(o.des.slice(0, 4)), Number(o.des.slice(5, 7))) || C.round3(Number(e.grossSalary) || 0); return { av, ap: C.round3(o.sorte === 'pct' ? av * (1 + o.val / 100) : av + o.val) }; };
      const coches = () => $$('[data-al-c]', root).filter(c => c.checked).map(c => employeeById(c.dataset.alC)).filter(Boolean);
      const maj = () => {
        const o = lire(); let tot = 0;
        $('#al-lbl', root).innerHTML = lbl(o.sorte === 'pct' ? 'Augmentation (%)' : `Augmentation (${h(C.normCurrency(cur))} par mois)`);
        emps.forEach(e => {
          const tr = $(`tr[data-al="${CSS.escape(e.id)}"]`, root), on = $('[data-al-c]', tr).checked, n = nouveauDe(e, o);
          $('[data-al-av]', tr).textContent = C.money(n.av, cur);
          $('[data-al-ap]', tr).textContent = on && o.val > 0 ? C.money(n.ap, cur) : '—';
          $('[data-al-ec]', tr).textContent = on && o.val > 0 ? `+ ${C.money(C.round3(n.ap - n.av), cur)}` : '';
          tr.classList.toggle('al-off', !on);
          if (on && o.val > 0) tot = C.round3(tot + n.ap - n.av);
        });
        const n = coches().length;
        $('#al-n', root).textContent = pl(n, 'salarié coché', 'salariés cochés');
        $('#al-tot', root).textContent = o.val > 0 && n ? `+ ${C.money(tot, cur)}` : '';
        $('#al-tous', root).checked = n === emps.length; $('#al-tous', root).indeterminate = n > 0 && n < emps.length;
        $('#al-ok', root).disabled = !(o.val > 0 && n);
        $('#al-ok', root).textContent = o.val > 0 && n ? `Augmenter ${pl(n, 'salarié')}` : 'Augmenter';
      };
      $('#al', root).oninput = $('#al', root).onchange = maj;
      $$('[data-al-c]', root).forEach(c => c.onchange = maj);
      $('#al-tous', root).onchange = ev => { $$('[data-al-c]', root).forEach(c => { c.checked = ev.target.checked; }); maj(); };
      maj(); setTimeout(() => { const c = $('#al [name=valeur]', root); if (c) c.focus(); }, 0);
      $('#al-ok', root).onclick = async () => {
        const o = lire(), L = coches();
        const refus = t => { const r = $('#al-refus', root); r.hidden = false; r.textContent = t; };
        if (!(o.val > 0)) return refus('L\'augmentation manque : un pourcentage ou une somme.');
        if (o.sorte === 'pct' && o.val > 100) return refus('Plus de 100 % : vérifie le chiffre (un pourcentage, pas une somme ?).');
        const avant = L.map(e => ({ id: e.id, grossSalary: e.grossSalary, salaires: deepCopy(e.salaires || []) }));
        const avantBul = deepCopy((data.payslips || []).filter(p => L.some(e => e.id === p.employeeId)));
        L.forEach(e => {
          const n = nouveauDe(e, o);
          const H = (Array.isArray(e.salaires) ? e.salaires : []).filter(x => x.des !== o.des);
          H.push({ des: o.des, brut: n.ap, avant: n.av, le: C.today(), lot: true });
          e.salaires = H.sort((a, b) => a.des.localeCompare(b.des));
          e.grossSalary = C.brutDuMois(e, 9999, 12);
        });
        const rappels = L.map(e => ({ e, r: calculRappel(e, o.des) }));
        save(true); fermer();
        const aRappeler = rappels.filter(x => x.r.payes.length && x.r.total && x.r.cible);
        let defaits = [];
        if (aRappeler.length && await rappelFenetre(aRappeler, o.des)) {
          defaits = aRappeler.map(x => porterRappel(x.e, o.des, x.r)); save(true);
        }
        if (done) done();
        toastUndo(`${pl(L.length, 'salaire augmenté', 'salaires augmentés')} à partir ${/^[aeiouyéè]/i.test(MONTHS_LONG[Number(o.des.slice(5, 7)) - 1]) ? 'd\'' : 'de '}${MONTHS_LONG[Number(o.des.slice(5, 7)) - 1]} ${o.des.slice(0, 4)}${defaits.length ? ` · ${pl(defaits.length, 'rappel')}` : ''}`, () => {
          defaits.forEach(f => f());
          avant.forEach(a => { const e = employeeById(a.id); if (e) { e.grossSalary = a.grossSalary; e.salaires = a.salaires; } });
          avantBul.forEach(b => { const i = data.payslips.findIndex(p => p.id === b.id); if (i >= 0) data.payslips[i] = b; });
          save(true); if (done) done();
        });
      };
    });
  }
  // (1.257.0) « Changer son salaire » (la maquette, « Mourad · ce qui change ») : le nouveau brut à partir d'un mois, le poste,
  // la catégorie, ce que ça coûte en plus par mois ; l'ancien salaire reste dans son historique, les bulletins pas payés se
  // refont, un mois déjà payé reçoit un rappel montré avant d'être porté ; l'avenant se prépare dans la foulée.
  function changerSalaireFenetre(e0, done) {
    if (!e0) return;
    if (enLecture('employees')) { toast(refusLecture('employees'), true); return; }
    const cur = company().currency, st = C.payrollSettings(data), mp = C.moisDePaie(data), defaut = ymDe(mp.year, mp.month);
    const mois = Array.from({ length: 25 }, (_, i) => { const t = (mp.year * 12 + mp.month - 1) - 12 + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
    const actuel = C.round3(Number(e0.grossSalary) || 0);
    const coutDe = brut => C.computePayslip({ ...e0, grossSalary: brut }, C.saisieDeLaFiche({ ...e0, grossSalary: brut }, st), st).employerCost;
    modal(`<h2>${h(e0.name || '')} · ce qui change</h2><p class="sous-f">un changement de salaire ou de poste se date, et se signe dans un avenant</p>
      <form id="cs" class="grid-2">
        <label class="field">${lbl(`Salaire de base (${h(C.normCurrency(cur))})`, 'pay.gross')}<small class="cs-avant" id="cs-avant"></small><input type="text" inputmode="decimal" data-montant autocomplete="off" name="brut" value="${h(C.money(actuel, null, 3))}" class="num"></label>
        <label class="field">${lbl('À partir de', 'pay.salaireDes')}<small class="muted" id="cs-des-d"></small><select name="des">${mois.map(v => `<option value="${v}" ${v === defaut ? 'selected' : ''}>${h(MONTHS_LONG[Number(v.slice(5, 7)) - 1])} ${v.slice(0, 4)}${v < defaut ? ' (passé)' : ''}</option>`).join('')}</select></label>
        ${field(lbl('Poste', 'pay.position'), 'position', e0.position || '', 'text', 'placeholder="Chef boulanger"')}
        ${field(lbl('Catégorie et échelon', 'pay.categorie'), 'categorie', e0.categorie || '', 'text', 'placeholder="de la grille de ta convention"')}
      </form>
      <table class="mini lu" id="cs-t"></table>
      <p class="small warn-text" id="cs-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn" id="cs-ok">Enregistrer</button><button type="button" class="btn btn-primary" id="cs-av">${lfIc('pages', 15)} Enregistrer, préparer l'avenant</button></div>`, (root, fermer) => {
      const lire = () => { const v = formValues($('#cs', root)); return { brut: C.round3(Number(v.brut) || 0), des: v.des || defaut, position: String(v.position || '').trim(), categorie: String(v.categorie || '').trim() }; };
      const maj = () => {
        const o = lire(), d = C.round3(o.brut - actuel);
        $('#cs-avant', root).textContent = `aujourd'hui ${C.money(actuel, cur)}${d ? ` · ${d > 0 ? '+' : '−'} ${C.money(Math.abs(d), cur)}` : ''}`;
        const mo = MONTHS_LONG[Number(o.des.slice(5, 7)) - 1], av = MONTHS_LONG[(Number(o.des.slice(5, 7)) + 10) % 12];
        $('#cs-des-d', root).textContent = o.des < defaut ? `déjà passé : les mois payés recevront un rappel` : `${mo} le prendra ; ${av} ne bouge pas`;
        const dc = o.brut > 0 ? C.round3(coutDe(o.brut) - coutDe(actuel)) : 0;
        $('#cs-t', root).innerHTML = `<tbody><tr><td>Son coût par mois<small class="muted"> brut et charges</small></td><td class="r">${dc ? `${dc > 0 ? '+' : '−'} ${C.money(Math.abs(dc), cur)} environ` : '<span class="muted">inchangé</span>'}</td></tr>
          <tr><td>Le minimum de sa catégorie</td><td class="r muted">${o.categorie ? 'à comparer à la grille de ta convention (À VÉRIFIER)' : 'à saisir dans les réglages'}</td></tr></tbody>`;
      };
      $('#cs', root).oninput = $('#cs', root).onchange = maj; maj();
      const enregistrer = async avenant => {
        const o = lire(), refus = t => { const r = $('#cs-refus', root); r.hidden = false; r.textContent = t; };
        if (!(o.brut > 0)) return refus('Le salaire de base manque.');
        const x = employeeById(e0.id); if (!x) return fermer();
        const change = o.brut !== actuel;
        if (!change && o.position === (x.position || '') && o.categorie === (x.categorie || '')) { fermer(); return; }
        const avant = { grossSalary: x.grossSalary, salaires: deepCopy(x.salaires || []), position: x.position, categorie: x.categorie };
        const avantBul = deepCopy((data.payslips || []).filter(p => p.employeeId === x.id));
        x.position = o.position; x.categorie = o.categorie;
        let r = null;
        if (change) {
          const H = (Array.isArray(x.salaires) ? x.salaires : []).filter(z => z.des !== o.des);
          H.push({ des: o.des, brut: o.brut, avant: C.brutDuMois(x, Number(o.des.slice(0, 4)), Number(o.des.slice(5, 7))) || actuel, le: C.today() });
          x.salaires = H.sort((a, b) => a.des.localeCompare(b.des));
          x.grossSalary = C.brutDuMois(x, 9999, 12);
          r = calculRappel(x, o.des);
        }
        save(true); fermer();
        let defait = null;
        if (r && r.payes.length && r.total && r.cible && await confirmDialog(`${x.name} est déjà payé${x.civilite === 'f' ? 'e' : ''} depuis ${MONTHS_LONG[Number(o.des.slice(5, 7)) - 1]} : + ${C.money(r.total, cur)}.\n\nPorter ce rappel de salaire sur son prochain bulletin ?`, 'Porter le rappel')) { defait = porterRappel(x, o.des, r); save(true); }
        if (done) done();
        toastUndo(change ? `${x.name} : ${C.money(o.brut, cur)} à partir ${/^[aeiouyéè]/i.test(MONTHS_LONG[Number(o.des.slice(5, 7)) - 1]) ? 'd\'' : 'de '}${MONTHS_LONG[Number(o.des.slice(5, 7)) - 1]} ${o.des.slice(0, 4)}${defait ? ' · un rappel' : ''}` : `${x.name} : poste et catégorie enregistrés`, () => {
          if (defait) defait();
          const y = employeeById(e0.id); if (y) Object.assign(y, avant);
          avantBul.forEach(b => { const i = data.payslips.findIndex(p => p.id === b.id); if (i >= 0) data.payslips[i] = b; });
          save(true); if (done) done();
        });
        if (avenant) hrDocForm(employeeById(e0.id), done, 'avenant');
      };
      $('#cs-ok', root).onclick = () => enregistrer(false);
      $('#cs-av', root).onclick = () => enregistrer(true);
    });
  }
  // (1.257.0) « Compléter la fiche » (la maquette, « Salma · ce qui manque ») : seulement les cases vides qui bloquent (CIN,
  // n° CNSS, RIB), la clé du RIB contrôlée à la saisie ; « Le lui demander » prépare un petit papier à lui remettre.
  function completerFenetre(e0, done) {
    if (!e0) return;
    if (enLecture('employees')) { toast(refusLecture('employees'), true); return; }
    const manque = [!e0.cnss && 'cnss', !e0.iban && 'iban', !e0.cin && 'cin'].filter(Boolean);
    if (!manque.length) return employeeForm(e0, done);
    const prenom = (e0.name || '').split(/\s+/)[0] || 'lui';
    const sans = [manque.includes('iban') && 'payé' + (e0.civilite === 'f' ? 'e' : '') + ' en espèces', manque.includes('cnss') && 'absent' + (e0.civilite === 'f' ? 'e' : '') + ' du fichier CNSS du trimestre'].filter(Boolean);
    modal(`<h2>${h(e0.name || '')} · ce qui manque</h2>${sans.length ? `<p class="sous-f">sans eux : ${h(sans.join(', et '))}</p>` : ''}
      <form id="cf" class="grid-2">
        ${manque.includes('cnss') ? `<label class="field">${lbl('N° CNSS', 'pay.cnss')}<small class="muted">sur sa carte ; sinon, son immatriculation se demande à la CNSS (À VÉRIFIER : le délai)</small><input type="text" name="cnss" placeholder="10 chiffres" autocomplete="off"></label>` : ''}
        ${manque.includes('iban') ? `<label class="field">${lbl('RIB', 'pay.iban')}<small class="muted">la clé est contrôlée à la saisie : un RIB faux est refusé</small><input type="text" name="iban" placeholder="20 chiffres" autocomplete="off" inputmode="numeric"><small id="cf-rib" aria-live="polite"></small></label>` : ''}
        ${manque.includes('cin') ? `<label class="field">${lbl('CIN', 'pay.cin')}<small class="muted">8 chiffres, sur sa carte d'identité</small><input type="text" name="cin" placeholder="8 chiffres" autocomplete="off" inputmode="numeric"></label>` : ''}
      </form>
      <p class="regle">${lfIc('aide', 14)} Tu ne l'as pas sous la main ? « Le lui demander » prépare un petit papier à remettre à ${h(prenom)}.</p>
      <p class="small warn-text" id="cf-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn" id="cf-dem">Le lui demander</button><button type="button" class="btn btn-primary" id="cf-ok" disabled>${lfIc('coche', 15, 2.4)} Enregistrer</button></div>`, (root, fermer) => {
      const lire = () => { const v = formValues($('#cf', root)); return { cnss: String(v.cnss || '').trim(), iban: String(v.iban || '').replace(/\s+/g, ''), cin: String(v.cin || '').trim() }; };
      $('#cf', root).oninput = () => {
        const o = lire();
        if ($('#cf-rib', root)) { const r = C.verifRib(o.iban); $('#cf-rib', root).className = r.vide ? '' : r.ok ? 'small ok-text' : 'small warn-text'; $('#cf-rib', root).textContent = r.vide ? '' : r.ok ? `✓ contrôlé · banque ${o.iban.slice(0, 2)}, agence ${o.iban.slice(2, 5)}` : r.raison; }
        $('#cf-ok', root).disabled = !(o.cnss || o.iban || o.cin);
      };
      $('#cf-ok', root).onclick = () => {
        const o = lire(), refus = t => { const r = $('#cf-refus', root); r.hidden = false; r.textContent = t; };
        if (o.iban && !C.verifRib(o.iban).ok) return refus(`Le RIB est refusé : ${C.verifRib(o.iban).raison}`);
        if (o.cin && !/^\d{8}$/.test(o.cin)) return refus('Le CIN compte 8 chiffres.');
        const x = employeeById(e0.id); if (!x) return fermer();
        const avant = { cnss: x.cnss, iban: x.iban, cin: x.cin, method: x.method };
        if (o.cnss) x.cnss = o.cnss; if (o.cin) x.cin = o.cin;
        let virement = false;
        if (o.iban) { x.iban = o.iban; if ((x.method || 'virement') === 'especes') { x.method = 'virement'; virement = true; } }
        save(true); fermer(); if (done) done();
        const faits = [o.cnss && 'n° CNSS', o.iban && 'RIB', o.cin && 'CIN'].filter(Boolean);
        toastUndo(`${x.name} : ${faits.join(', ')} enregistré${faits.length > 1 ? 's' : ''}${virement ? ' · son salaire passe par virement' : ''}`, () => { const y = employeeById(e0.id); if (y) { Object.assign(y, avant); save(true); if (done) done(); } });
      };
      $('#cf-dem', root).onclick = () => {
        const co = company(), quoi = { cnss: 'ton numéro d\'assuré CNSS (sur ta carte CNSS)', iban: 'ton RIB (20 chiffres, sur un relevé ou une attestation de ta banque)', cin: 'ta carte d\'identité (CIN)' };
        const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{font:14px/1.5 system-ui,sans-serif;color:#1d2b2a;padding:40px 48px}h1{font-size:18px;margin:0 0 18px}li{margin:6px 0}.sig{margin-top:40px;color:#555}</style></head><body>
          <h1>${h(co.name || '')} · pour ta fiche de paie</h1><p>Bonjour ${h(prenom)},</p><p>Pour que ton salaire et ta déclaration CNSS soient faits correctement, il nous manque :</p>
          <ul>${manque.map(k => `<li>${h(quoi[k])}</li>`).join('')}</ul><p>Merci de nous les apporter, ou d'envoyer une photo.</p>
          <p class="sig">${h(co.managerName || '')}${co.managerName ? ', ' : ''}le ${h(C.fmtDate(C.today()))}</p></body></html>`;
        apercuDocument({ titre: `Ce qui manque à la fiche de ${e0.name || ''}`, html, fichier: `a-fournir-${String(e0.name || 'salarie').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf` });
      };
    });
  }
  // (plateforme) 1.230.0 — la SAISIE SUR SALAIRE : la décision reçue (créancier, total, retenue du mois), puis chaque
  // versement au créancier. La retenue se fait toute seule sur les bulletins (compta.js, `saisiesDuMois`).
  function saisieFenetre(emp, saisie, done) {
    if (enLecture('employees')) { toast(refusLecture('employees'), true); return; }
    const cur = company().currency, x = saisie || { id: C.uid(), creancier: '', total: '', monthly: '', debut: ymDe(C.moisDePaie(data).year, C.moisDePaie(data).month), reference: '', versements: [] };
    const etat = saisie ? C.saisiesOf(data, emp).find(s2 => s2.id === saisie.id) : null;
    // (1.257) La fenêtre de la maquette (O07) : ce qu'est une saisie en une phrase claire, le montant et le mois d'abord,
    // à qui elle se verse, puis ce que l'application tient en plus (le total, la référence) ; la règle en pied.
    modal(`<h2>${saisie ? 'La saisie sur salaire' : 'Une saisie sur salaire reçue'} · ${h(emp.name)}</h2>
      <p class="sz-intro">Une décision de justice (une pension alimentaire, une dette) te demande de retenir chaque mois une part de son salaire et de la verser à son bénéficiaire. SkanFact la pose sur ses bulletins comme une retenue à part, jusqu'au total fixé.</p>
      <form id="sz" class="grid-2">
        ${field(lbl(`Montant par mois (${h(C.normCurrency(cur))})`, 'pay.saisieMois'), 'monthly', x.monthly != null && x.monthly !== '' ? C.money(x.monthly, null, 3) : '', 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num" required')}
        <label class="field">${lbl('À partir de', 'pay.saisieDebut')}<select name="debut" aria-label="Le mois de la première retenue">${(() => {
          // (1.255.0) Les mois en toutes lettres, comme l'avance : la case « mois » du navigateur écrivait « November 2026 ».
          const d0 = C.today(), y0 = Number(d0.slice(0, 4)), m0 = Number(d0.slice(5, 7));
          const mois = Array.from({ length: 13 }, (_, i) => { const t = (m0 - 1) + i; return `${y0 + Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
          if (x.debut && !mois.includes(x.debut)) mois.unshift(x.debut);
          return `<option value="" ${x.debut ? '' : 'selected'}>dès le prochain bulletin</option>` + mois.map(v => `<option value="${v}" ${x.debut === v ? 'selected' : ''}>${h(MONTHS_LONG[Number(v.slice(5, 7)) - 1])} ${v.slice(0, 4)}</option>`).join('');
        })()}</select></label>
        ${field(lbl('Versée à', 'pay.saisieCreancier'), 'creancier', x.creancier, 'text', 'required placeholder="le bénéficiaire du jugement"').replace('<label class="field">', '<label class="field span-2">')}
        ${field(lbl(`Total à retenir (${h(C.normCurrency(cur))})`, 'pay.saisieTotal'), 'total', x.total != null && x.total !== '' ? C.money(x.total, null, 3) : '', 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num" required placeholder="celui que fixe la décision"')}
        ${field(lbl('Référence de la décision', 'pay.saisieRef'), 'reference', x.reference, 'text', 'placeholder="n° du jugement, tribunal"')}
      </form>
      <p class="small muted" id="sz-fin" role="status" aria-live="polite"></p>
      ${etat ? `<div class="pa-kv" id="sz-etat"><span>Retenu sur les bulletins</span><b>${C.money(etat.retenu, cur)}</b><span>Versé au créancier</span><b>${C.money(etat.verse, cur)}</b><span>À lui verser</span><b class="${etat.aVerser ? 'warn-text' : ''}">${C.money(etat.aVerser, cur)}</b><span>Reste à retenir</span><b>${C.money(etat.reste, cur)}</b></div>` : ''}
      <p class="small warn-text" id="sz-refus" role="status" aria-live="polite" hidden></p>
      <p class="regle small">${lfIc('aide', 13, 2)} La part du salaire qui peut être saisie, l'ordre entre une saisie et une avance, et le versement : À VÉRIFIER avec ton comptable. Le jugement se range dans ses documents (onglet « Documents » de sa fiche).</p>
      <div class="modal-actions">${etat && etat.aVerser ? `<button type="button" class="btn" id="sz-verser" style="margin-inline-end:auto">Verser ${h(C.money(etat.aVerser, cur))} au créancier…</button>` : ''}<button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="sz-ok">${saisie ? 'Enregistrer' : `${lfIc('coche', 15, 2.4)} Poser la retenue`}</button></div>`, (root, fermer) => {
      // Combien de mois, et le dernier : dit pendant la saisie, d'après le total et le montant par mois.
      const fin = () => {
        const v = formValues($('#sz', root)), t = C.round3(Number(v.total) || 0), m = C.round3(Number(v.monthly) || 0), el = $('#sz-fin', root);
        if (!(t > 0 && m > 0 && m <= t)) { el.textContent = ''; return; }
        const n = Math.ceil(C.round3(t / m) - 1e-9), d0 = v.debut || ymDe(C.moisDePaie(data).year, C.moisDePaie(data).month);
        const k = Number(d0.slice(0, 4)) * 12 + Number(d0.slice(5, 7)) - 1 + n - 1;
        el.textContent = `${n} mois de retenue : la dernière sur le bulletin de ${MONTHS_LONG[k % 12]} ${Math.floor(k / 12)}${C.round3(t - m * (n - 1)) !== m ? ` (${C.money(C.round3(t - m * (n - 1)), cur)}, le reste)` : ''}.`;
      };
      $('#sz', root).addEventListener('input', fin); $('#sz', root).addEventListener('change', fin); fin();
      if ($('#sz-verser', root)) $('#sz-verser', root).onclick = () => { fermer(); verserSaisieFenetre(emp, saisie, done); };
      $('#sz-ok', root).onclick = () => {
        const v = formValues($('#sz', root)), refus = (el, t) => { const r = $('#sz-refus', root); r.hidden = false; r.textContent = t; if (el) el.focus(); };
        const total = C.round3(Number(v.total) || 0), monthly = C.round3(Number(v.monthly) || 0);
        if (!String(v.creancier || '').trim()) return refus($('[name=creancier]', root), 'Le créancier manque : à qui l’argent retenu sera versé.');
        if (!(total > 0)) return refus($('[name=total]', root), 'Le total à retenir manque : celui que fixe la décision.');
        if (!(monthly > 0)) return refus($('[name=monthly]', root), 'La retenue de chaque mois manque.');
        if (monthly > total) return refus($('[name=monthly]', root), 'La retenue d’un mois dépasse le total à retenir.');
        const e2 = employeeById(emp.id); if (!e2) return;
        const avant = deepCopy(e2.saisies || []);
        const nv = { ...x, creancier: String(v.creancier).trim(), total, monthly, debut: String(v.debut || ''), reference: String(v.reference || '').trim(), versements: x.versements || [] };
        e2.saisies = [...(e2.saisies || []).filter(s2 => s2.id !== nv.id), nv];
        save(true); fermer(); if (done) done();
        toastUndo(saisie ? 'Saisie sur salaire enregistrée' : `Saisie sur salaire notée : ${C.money(monthly, cur)} se retiendront chaque mois`, () => { const e3 = employeeById(emp.id); if (e3) { e3.saisies = avant; save(true); if (done) done(); } });
      };
    });
  }
  function verserSaisieFenetre(emp, saisie, done) {
    const cur = company().currency, etat = C.saisiesOf(data, emp).find(s2 => s2.id === saisie.id);
    if (!etat || !etat.aVerser) return;
    modal(`<h2>Verser au créancier</h2><p class="small muted">${h(String(etat.creancier || ''))} reçoit ce que les bulletins ont retenu à ${h(emp.name)}. L'argent sort de la trésorerie ce jour-là.</p>
      <form id="vs" class="grid-2">
        ${dateFieldHtml(lbl('Versé le', 'pay.saisieVerseLe'), 'date', C.today(), { obligatoire: true })}
        <label class="field">${lbl('Compte', 'soc.compte')}<select name="accountId"><option value="">— compte par défaut —</option>${data.accounts.map(a => `<option value="${a.id}">${h(a.name)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Mode', 'soc.mode')}<select name="method">${C.PAYMENT_METHODS.map(([v2, l]) => `<option value="${v2}">${l}</option>`).join('')}</select></label>
        <div class="field"><span class="fl">Montant</span><b class="num">${h(C.money(etat.aVerser, cur))}</b></div>
      </form>
      ${avertValideHtml('vs-valide')}
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="vs-ok">Marquer versé</button></div>`, (root, fermer) => {
      // (1.305.0) Versé à une date de la période que le cabinet a validée : la phrase pendant la saisie de la date.
      const majValideVs = () => { const d = formValues($('#vs', root)).date; majAvertValide($('#vs-valide', root), d ? dateDansLaPeriodeValidee([d], majValideVs) : '', d, { sujet: 'Ce versement', fem: false, neuve: true, geste: 'En le marquant versé' }); };
      $('#vs', root).addEventListener('input', majValideVs);
      $('#vs', root).addEventListener('change', majValideVs);
      majValideVs();
      $('#vs-ok', root).onclick = () => {
        const v = formValues($('#vs', root));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ''))) return;
        if (closedBlock(v.date, 'Ce versement')) return;
        const e2 = employeeById(emp.id), s2 = e2 && (e2.saisies || []).find(z => z.id === saisie.id); if (!s2) return;
        const vt = { id: C.uid(), date: v.date, amount: etat.aVerser, accountId: v.accountId || '', method: v.method || 'virement' };
        const dvVs = dateDansLaPeriodeValidee([v.date]);
        s2.versements = [...(s2.versements || []), vt];
        save(true); fermer(); if (done) done();
        if (dvVs) { direAuComptableApres(`${C.money(etat.aVerser, cur)} versés à ${etat.creancier}`, { fait: 'd\'enregistrer', fem: false, quoi: `un versement de saisie sur salaire daté du ${C.fmtDate(dvVs)} (${C.money(etat.aVerser, cur)})` }); return; }
        toastUndo(`${C.money(etat.aVerser, cur)} versés à ${etat.creancier}`, () => { const e3 = employeeById(emp.id), s3 = e3 && (e3.saisies || []).find(z => z.id === saisie.id); if (s3) { s3.versements = (s3.versements || []).filter(z => z.id !== vt.id); save(true); if (done) done(); } });
      };
    });
  }
  // (plateforme) 1.230.0 — « Combien coûte une embauche ? » : le brut, le contrat et la situation donnent le net du
  // salarié et ce que l'entreprise paie, par le même calcul que les bulletins. Rien ne s'enregistre.
  function simulationEmbauche() {
    const cur = company().currency, st = C.payrollSettings(data);
    // (1.256.0) On négocie souvent en net (« il veut 1 000 DT net ») : la fenêtre part du brut ou du net, au choix.
    // (1.257.0) « Comme » (la maquette) : partir d'un salarié qui existe — son brut, son contrat, sa situation, ses primes.
    const modeles = C.activeEmployees(data).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    modal(`<h2 id="se-t">Combien coûte une embauche ?</h2><p class="small muted">Le même calcul que les bulletins, avec les taux de tes réglages. Rien ne s'enregistre.</p>
      <div class="pa-seg se-sens" role="radiogroup" aria-label="Partir du brut ou du net"><label><input type="radio" name="se-sens" value="brut" checked><span>Je connais le brut</span></label><label><input type="radio" name="se-sens" value="net"><span>Il veut un net</span></label></div>
      <form id="se" class="grid-2">
        ${modeles.length ? `<label class="field se-comme">${lbl('Comme')}<select name="comme"><option value="">personne en particulier</option>${modeles.map(e => `<option value="${h(e.id)}">${h(e.name)}${e.position ? ` · ${h(e.position)}` : ''}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span id="se-lbl">${lbl(`Salaire brut par mois (${h(C.normCurrency(cur))})`, 'pay.gross')}</span><input type="text" name="gross" value="${h(C.money(1200, null, 3))}" inputmode="decimal" data-montant autocomplete="off" class="num"></label>
        <label class="field">${lbl('Contrat', 'pay.contract')}<select name="contract">${C.CONTRACT_TYPES.map(([v, l]) => `<option value="${v}" title="${h(l)}">${h(l.split(' —')[0])}</option>`).join('')}</select></label>
        <label class="check se-chef"><input type="checkbox" name="headOfFamily"> chef de famille</label>
        ${field(lbl('Enfants à charge', 'pay.children'), 'children', '0', 'number', 'step="1" min="0" max="10" class="num"')}
      </form>
      <div id="se-res" class="mt"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Fermer</button><button type="button" class="btn btn-primary" id="se-ok">${lfIc('ajout', 15, 2.2)} Ajouter ce salarié…</button></div>`, (root, fermer) => {
      const sens = () => ($('[name=se-sens]:checked', root) || {}).value || 'brut';
      let brutTrouve = 0;
      const calc = () => {
        const v = formValues($('#se', root)), mod = v.comme ? employeeById(v.comme) : null;
        const e0 = { id: 'simulation', name: '', grossSalary: 0, contract: v.contract || 'cdi', headOfFamily: !!v.headOfFamily, children: Math.max(0, Number(v.children) || 0), primes: mod ? deepCopy(mod.primes || []) : [] };
        const r = sens() === 'net' ? C.brutPourNet(e0, Number(v.gross) || 0, st, C.saisieDeLaFiche(e0, st)) : null;
        if (sens() === 'net' && !r) { $('#se-res', root).innerHTML = '<p class="small muted">Saisis le net qu\'il veut toucher chaque mois.</p>'; brutTrouve = 0; return; }
        const e = { ...e0, grossSalary: r ? r.gross : C.round3(Number(v.gross) || 0) };
        brutTrouve = e.grossSalary;
        const c = C.computePayslip(e, C.saisieDeLaFiche(e, st), st);
        $('#se-res', root).innerHTML = `<div class="vat-box" id="se-calc" style="max-width:520px">
          ${r ? `<div class="vat-line total se-brut" id="se-brut"><span><b>Le brut à mettre sur sa fiche</b></span><span class="num"><b>${C.money(r.gross, cur)}</b></span></div>` : ''}
          <div class="vat-line"><span>Salaire brut</span><span class="num">${C.money(c.gross, cur)}</span></div>
          <div class="vat-line total ok"><span>Il touche (net)</span><span class="num">${C.money(c.net, cur)}</span></div>
          <div class="vat-line"><span>Charges de l'entreprise ${info('pay.employerCost')}</span><span class="num">${C.money(C.employerChargesOf(c), cur)}</span></div>
          <div class="vat-line"><span><b>Coût par mois</b></span><span class="num"><b>${C.money(c.employerCost, cur)}</b></span></div>
          <div class="vat-line sub-line"><span class="muted">sur un an (12 mois, sans prime)</span><span class="num muted">${C.money(C.round3(c.employerCost * 12), cur)}</span></div></div>
          <p class="small muted mt">${c.regime ? h(C.libelleRegime(c.regime)) + ' · ' : ''}<em>À VÉRIFIER avec ton comptable</em> : les taux viennent des réglages de la paie ; une prime, un 13e mois ou une convention collective changent ce coût.</p>`;
      };
      $$('#se input, #se select', root).forEach(el => { el.oninput = el.onchange = calc; });
      if ($('#se [name=comme]', root)) $('#se [name=comme]', root).onchange = () => {
        const mod = employeeById($('#se [name=comme]', root).value);
        $('#se-t', root).textContent = mod && mod.position ? `Combien coûte ${mod.civilite === 'f' ? 'une' : 'un'} ${mod.position.toLowerCase()} de plus ?` : 'Combien coûte une embauche ?';
        if (mod) {
          const brut = $('[name=se-sens][value=brut]', root); if (brut && !brut.checked) { brut.checked = true; $('#se-lbl', root).innerHTML = lbl(`Salaire brut par mois (${h(C.normCurrency(cur))})`, 'pay.gross'); }
          $('#se [name=gross]', root).value = C.money(C.round3(Number(mod.grossSalary) || 0), null, 3);
          $('#se [name=contract]', root).value = mod.contract || 'cdi';
          $('#se [name=headOfFamily]', root).checked = !!mod.headOfFamily;
          $('#se [name=children]', root).value = String(Number(mod.children) || 0);
        }
        calc();
      };
      $$('[name=se-sens]', root).forEach(r2 => r2.onchange = () => {
        const net = sens() === 'net', champ = $('#se [name=gross]', root);
        $('#se-lbl', root).innerHTML = lbl(net ? `Net voulu par mois (${h(C.normCurrency(cur))})` : `Salaire brut par mois (${h(C.normCurrency(cur))})`, 'pay.gross');
        // On garde la même somme d'un sens à l'autre : le net trouvé devient le brut de départ, et l'inverse.
        const c0 = C.computePayslip({ grossSalary: brutTrouve, contract: formValues($('#se', root)).contract || 'cdi', headOfFamily: !!formValues($('#se', root)).headOfFamily, children: Number(formValues($('#se', root)).children) || 0 }, {}, st);
        champ.value = C.money(net ? c0.net : brutTrouve, null, 3);
        calc(); champ.focus(); champ.select();
      });
      calc();
      $('#se-ok', root).onclick = () => { const v = formValues($('#se', root)); fermer(); const mod = v.comme ? employeeById(v.comme) : null; employeeForm(null, () => { paieState.tab = 'salaries'; render(); }, { preset: { grossSalary: brutTrouve || 0, contract: v.contract || 'cdi', headOfFamily: !!v.headOfFamily, children: Number(v.children) || 0, ...(mod ? { position: mod.position || '', primes: deepCopy(mod.primes || []) } : {}) } }); };
    });
  }

  function employeeForm(employee, done, opts) {
    if (!employee && licenceBlock('Créer une fiche de salarié', 'paie')) return;
    const e = employee || { id: C.uid(), name: '', cin: '', cnss: '', position: '', contract: 'cdi',
      hireDate: C.today(), endDate: '', grossSalary: 0, headOfFamily: false, children: 0,
      method: 'virement', iban: '', notes: '', ...((!employee && opts && opts.preset) || {}) };
    const cur = company().currency;
    // (plateforme) 1.59.0 — une COPIE des primes : « Annuler » ne doit rien garder de ce qu'on a tapé.
    const primes = deepCopy(e.primes || []);
    modal(`<h2>${employee ? 'Modifier le salarié' : 'Nouveau salarié'}</h2>
      <form id="ef" class="grid-2">
        <div class="span-2 pa-ef-sec pa-ef-sec1">Qui est-ce</div>
        <label class="field span-2 obligatoire">${lbl('Nom et prénom', 'pay.name')}<input type="text" name="name" value="${h(e.name)}" placeholder="Ahmed Ben Ali"></label>
        ${/* (1.330.0) Le navigateur proposait le CIN de l'autre salarié (son historique de la case « cin ») : ce qui dit QUI est le salarié ne se remplit pas de mémoire. */''}
        ${field(lbl('CIN', 'pay.cin'), 'cin', e.cin || '', 'text', 'autocomplete="off"')}
        ${field(lbl('Matricule CNSS', 'pay.cnss'), 'cnss', e.cnss || '', 'text', 'autocomplete="off"')}
        <label class="field span-2">${lbl('Identité CNSS (comme sur la carte d\'assuré)', 'pay.cnssName')}<input type="text" name="cnssName" value="${h(e.cnssName || '')}" autocomplete="off" placeholder="Prénom, prénom du père, nom"></label>
        ${/* (plateforme) 1.72.0 — la civilité : les documents du personnel la lisaient (`gender`), aucun écran ne l'écrivait —
             une salariée y était « employé », « l'intéressé ». */''}
        <label class="field">${lbl('Civilité', 'pay.gender')}<select name="gender"><option value="">— à préciser —</option>${C.CIVILITES.map(([v, l]) => `<option value="${v}" ${e.gender === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field(lbl('Poste', 'pay.position'), 'position', e.position || '', 'text', 'placeholder="Technicien"')}
        ${/* (1.257.0) Sa famille à part, comme la maquette : elle compte dans son impôt. */''}
        <div class="span-2 pa-ef-sec">Sa famille <small>elle compte dans son impôt</small></div>
        <label class="check"><input type="checkbox" name="headOfFamily" ${e.headOfFamily ? 'checked' : ''}> Chef de famille ${info('pay.family')}</label>
        ${field(lbl('Enfants à charge', 'pay.children'), 'children', e.children || 0, 'number', 'step="1" min="0" max="10" class="num"')}
        <div class="span-2 pa-ef-sec">Son contrat</div>
        <label class="field">${lbl('Contrat', 'pay.contract')}<select name="contract">${C.CONTRACT_TYPES.map(([v, l]) => `<option value="${v}" ${e.contract === v ? 'selected' : ''} title="${h(l)}">${h(l.split(' —')[0])}</option>`).join('')}</select></label>
        ${dateFieldHtml(lbl('Date d\'embauche', 'pay.hireDate'), 'hireDate', e.hireDate || '', { clearable: true })}
        ${dateFieldHtml(lbl('Date de sortie', 'pay.endDate'), 'endDate', e.endDate || '', { clearable: true })}
        ${/* 10.14.1 — obligatoire (« Enregistrer » refuse un brut nul), et il ne le disait pas : l'étoile se pose. */''}
        <div class="span-2 pa-ef-sec">Son salaire et son paiement</div>
        <label class="field obligatoire">${lbl(`Salaire brut mensuel (${h(C.normCurrency(company().currency))})`, 'pay.gross')}<input type="text" inputmode="decimal" data-montant autocomplete="off" name="grossSalary" value="${h(C.money(Number(e.grossSalary) || 0, null, 3))}" class="num"><button type="button" class="lien small ef-net-b" id="ef-net-b" aria-expanded="false">À partir d'un net…</button></label>
        <div class="span-2 ef-net" id="ef-net" hidden><span class="small">Il veut toucher</span><input type="text" inputmode="decimal" data-montant autocomplete="off" id="ef-net-v" class="num" aria-label="Le net voulu par mois" placeholder="1 000,000"><span class="small">net par mois</span><span class="small muted" id="ef-net-r"></span><button type="button" class="btn btn-sm" id="ef-net-ok" disabled>Mettre ce brut</button></div>
        <label class="field">${lbl('Mode de paiement', 'pay.method')}<select name="method">${C.PAYMENT_METHODS.map(([v, l]) => `<option value="${v}" ${e.method === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${/* (plateforme) 1.74.0 — sa clé se contrôle à la saisie, comme le RIB de la société : il s'imprime sur l'ordre de virement. */''}
        <label class="field"><span class="fl">RIB / IBAN ${info('pay.iban')}<span class="rib-note" aria-live="polite"></span></span><input type="text" name="iban" value="${h(e.iban || '')}" autocomplete="off" spellcheck="false"></label>
        ${/* (plateforme) 1.229.0 — ce que la fiche affichait sans pouvoir l'écrire (l'e-mail des bulletins), et ce que le
             registre, le contrat et la déclaration annuelle demandent (À VÉRIFIER : la liste exacte). */''}
        ${/* (1.355.0) Le net s'annonce sous le brut qu'on tape : posé après les Notes, il était hors de la fenêtre pendant la frappe. */''}
        <div class="span-2 annonce-stable" id="ef-hint"></div>
        <div class="span-2 pa-ef-sec">Pour le joindre</div>
        ${field(lbl('E-mail', 'pay.email'), 'email', e.email || '', 'email', 'placeholder="prenom@exemple.tn" autocomplete="off"')}
        ${field(lbl('Téléphone', 'pay.phone'), 'phone', e.phone || '', 'tel', 'placeholder="20 123 456"')}
        <label class="field span-2">${lbl('Adresse', 'pay.address')}<input type="text" name="address" value="${h(e.address || '')}" placeholder="Rue, ville"></label>
        ${dateFieldHtml(lbl('Date de naissance', 'pay.birthDate'), 'birthDate', e.birthDate || '', { clearable: true })}
        <div class="span-2 pa-ef-sec">Son contrat, en détail</div>
        ${field(lbl('Catégorie, échelon', 'pay.categorie'), 'categorie', e.categorie || '', 'text', 'placeholder="Ouvrier qualifié, échelon 3"')}
        ${dateFieldHtml(lbl('Fin de la période d\'essai', 'pay.trialEnd'), 'trialEnd', e.trialEnd || '', { clearable: true })}
        ${field(lbl('Heures par semaine', 'pay.weeklyHours'), 'weeklyHours', e.weeklyHours || '', 'number', 'step="0.5" min="0" max="60" class="num" placeholder="temps plein"')}
        ${/* (1.257.0) Son équipe (ses horaires, ses jours de travail) et son n° de badge (la pointeuse le reconnaît par lui). */''}
        ${(() => { const L = (C.payrollSettings(data).equipes || []); return L.length ? `<label class="field">${lbl('Son équipe', 'pay.equipe')}<select name="equipeId"><option value="">— les horaires de l'entreprise —</option>${L.map(q => `<option value="${h(q.id)}" ${e.equipeId === q.id ? 'selected' : ''}>${h(q.nom || 'Équipe')}</option>`).join('')}</select></label>` : ''; })()}
        ${field(lbl('N° de badge', 'pay.badge'), 'badge', e.badge || '', 'text', 'placeholder="sur la pointeuse" autocomplete="off"')}
        <label class="field" id="ef-des-l" hidden>${lbl('Le nouveau salaire vaut à partir de', 'pay.salaireDes')}<input type="month" name="salaireDes" value="${h((() => { const mp = C.moisDePaie(data); return `${mp.year}-${String(mp.month).padStart(2, '0')}`; })())}"></label>
        <label class="field span-2">${lbl('Notes', 'pay.empNotes')}<input type="text" name="notes" value="${h(e.notes || '')}"></label>
      </form>
      ${/* (plateforme) 1.59.0 — les primes de chaque mois : posées une fois, reprises par chaque bulletin. */''}
      <div class="panel" id="ef-primes-p"><h2>Primes de chaque mois (${h(C.normCurrency(company().currency))}) ${info('pay.primesFiche')}</h2><div id="ef-primes"></div>
        <button type="button" class="btn btn-sm mt" id="ef-add-prime">+ Prime</button></div>
      <div class="modal-actions">
        ${employee ? '<button class="btn btn-danger" id="del-emp" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        const hint = () => {
          const v = formValues($('#ef', root));
          const st = C.payrollSettings(data);
          const c = C.computePayslip({ ...e, ...v, children: Number(v.children) || 0 }, C.saisieDeLaFiche({ primes }, st), st);
          $('#ef-hint', root).innerHTML = Number(v.grossSalary) > 0
            ? `<span class="small muted">Sur ce brut${c.bonuses.length ? ' et ses primes' : ''} : net d'environ <b>${C.money(c.net, cur)}</b> pour le salarié, coût de <b>${C.money(c.employerCost, cur)}</b> pour l'entreprise${c.regime ? ` — ${h(C.contractLabel(c.contrat).split(' —')[0])} : ${h(C.libelleRegime(c.regime))} (Barèmes)` : ''}. <em>À VÉRIFIER avec ton comptable.</em></span>`
            : '<span class="small muted">Saisis le brut mensuel pour voir le net et le coût employeur.</span>';
        };
        // (plateforme) 1.59.0 — les primes de la fiche. Le tableau ne se redessine qu'à l'ajout ou au retrait
        // d'une ligne : pendant la frappe, seule la donnée change (le curseur reste dans sa case, 7.17.0).
        const dessinerPrimes = () => {
          $('#ef-primes', root).innerHTML = primes.length ? `<table class="lines-edit"><tbody>
            ${primes.map((x, i) => `<tr data-i="${i}">
              <td><input type="text" data-p="label" value="${h(x.label || '')}" placeholder="Prime de présence" aria-label="Prime ${i + 1} : libellé"></td>
              <td style="width:110px"><input type="number" class="num" data-p="amount" value="${x.amount || ''}" step="0.001" min="0" placeholder="0,000" aria-label="Prime ${i + 1} : montant du mois (${h(C.normCurrency(company().currency))})"></td>
              <td style="width:110px"><label class="check small"><input type="checkbox" data-p="taxable" ${x.taxable !== false ? 'checked' : ''}> imposable</label></td>
              <td style="width:130px"><label class="check small" title="Au prorata des jours payés du mois : 19,5 jours sur 26 en donnent les 19,5 vingt-sixièmes"><input type="checkbox" data-p="parJour" ${x.parJour ? 'checked' : ''}> au jour</label></td>
              <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-px="${i}" aria-label="Retirer la prime ${i + 1}">✕</button></td></tr>`).join('')}
          </tbody></table>` : '<p class="small muted">Aucune prime chaque mois. Une prime de présence, de transport : pose-la ici une fois, chaque bulletin la reprendra.</p>';
          $$('[data-p]', $('#ef-primes', root)).forEach(el => el.oninput = el.onchange = () => {
            const i = Number(el.closest('tr').dataset.i);
            primes[i][el.dataset.p] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value);
            hint();
          });
          $$('[data-px]', $('#ef-primes', root)).forEach(b => b.onclick = () => { primes.splice(Number(b.dataset.px), 1); dessinerPrimes(); hint(); });
        };
        $('#ef-add-prime', root).onclick = () => {
          primes.push({ label: '', amount: '', taxable: true, parJour: true });
          dessinerPrimes();
          const l = $$('#ef-primes [data-p=label]', root).pop(); if (l) l.focus();
        };
        dessinerPrimes();
        const aDesBulletins = !!employee && data.payslips.some(p => p.employeeId === e.id);
        const suivreBrut = () => { const v = formValues($('#ef', root)); $('#ef-des-l', root).hidden = !(aDesBulletins && Number(v.grossSalary) > 0 && C.round3(Number(v.grossSalary)) !== C.round3(Number(e.grossSalary) || 0)); };
        // (1.248.1) Un n° CNSS ou un RIB déjà sur la fiche d'un autre salarié en poste se dit sous sa case, pendant la frappe
        // (recette du 02/11 : la fiche l'acceptait sans un mot ; la déclaration du trimestre aurait mêlé deux salariés).
        const nuD = x => String(x || '').replace(/[\s-]/g, '');
        const doublon = () => ['cnss', 'iban'].forEach(k => {
          const champ = $(`[name=${k}]`, root); if (!champ) return;
          let note = champ.parentElement.querySelector(`[data-doublon="${k}"]`);
          const val = nuD(champ.value);
          const autre = val.length >= 6 ? (data.employees || []).find(x => x.id !== e.id && x.active !== false && !(x.endDate && x.endDate < C.today()) && nuD(x[k]) === val) : null;
          if (!autre) { if (note) note.remove(); return; }
          if (!note) { note = document.createElement('small'); note.className = 'warn-text'; note.dataset.doublon = k; note.setAttribute('role', 'status'); champ.insertAdjacentElement('afterend', note); }
          note.textContent = `${k === 'cnss' ? 'Ce n° CNSS' : 'Ce RIB'} est déjà sur la fiche de ${autre.name} : vérifie avant d'enregistrer.`;
        });
        $('#ef', root).oninput = $('#ef', root).onchange = () => { hint(); suivreBrut(); doublon(); }; hint(); suivreBrut(); doublon();
        // (1.256.0) Net → brut sur la fiche : le net voulu donne le brut, par le calcul des bulletins (sa situation, ses primes).
        let netBrut = 0;
        const netCalc = () => {
          const v = formValues($('#ef', root)), st = C.payrollSettings(data), vise = lireMontant($('#ef-net-v', root).value);
          const r = vise > 0 ? C.brutPourNet({ ...e, ...v, children: Number(v.children) || 0, headOfFamily: !!v.headOfFamily }, vise, st, C.saisieDeLaFiche({ primes }, st)) : null;
          netBrut = r ? r.gross : 0;
          $('#ef-net-r', root).textContent = r ? `→ brut de ${C.money(r.gross, cur)}${r.net !== vise ? ` (net exact : ${C.money(r.net, cur)})` : ''}` : '';
          $('#ef-net-ok', root).disabled = !r;
        };
        $('#ef-net-b', root).onclick = () => { const z = $('#ef-net', root); z.hidden = !z.hidden; $('#ef-net-b', root).setAttribute('aria-expanded', String(!z.hidden)); if (!z.hidden) $('#ef-net-v', root).focus(); };
        $('#ef-net-v', root).oninput = netCalc;
        $('#ef-net-ok', root).onclick = () => { if (!netBrut) return; const g = $('[name=grossSalary]', root); g.value = C.money(netBrut, null, 3); g.dispatchEvent(new Event('input', { bubbles: true })); $('#ef-net', root).hidden = true; $('#ef-net-b', root).setAttribute('aria-expanded', 'false'); g.focus(); };
        // Ouverte pour UNE case (celle que le fichier CNSS du trimestre réclame), elle y met le curseur.
        // (plateforme) 1.72.0 — une date est un couple (le champ caché nommé, le champ visible) : le curseur va dans le visible.
        if (opts && opts.focus) {
          const c0 = $(`[name=${opts.focus}]`, root);
          const c = c0 && c0.type === 'hidden' && c0.closest('.datefield') ? $('.d-txt', c0.closest('.datefield')) : c0;
          if (c) c.focus();
        }
        $('#ok', root).onclick = () => {
          if (enLecture('employees')) return refus('#ef input[name=name]', refusLecture('employees'));
          const v = formValues($('#ef', root));
          if (!v.name.trim()) return refus('#ef input[name=name]', 'Le nom du salarié est obligatoire : il figure sur chaque bulletin.');
          if (!(Number(v.grossSalary) > 0)) return refus($('[name=grossSalary]', root), 'Le salaire brut doit être supérieur à zéro.');
          if (v.endDate && v.hireDate && v.endDate < v.hireDate) return refus($('[name=endDate]', root), 'La sortie ne peut pas précéder l\'embauche.');
          // Ce que le fichier CNSS refuserait se refuse ICI, où l'on peut le corriger (10.14.1) : le
          // découvrir au moment de déclarer, c'est rouvrir la fiche sous l'échéance.
          if (String(v.cnss || '').trim() && !C.lireMatriculeCnss(v.cnss).ok) return refus($('[name=cnss]', root), 'Le matricule CNSS s\'écrit 12345678-90 : huit chiffres au plus, puis la clé sur deux (comme sur la carte d\'assuré).');
          if (String(v.cnssName || '').trim()) { const idc = C.identiteCnss(v.cnssName); if (!idc.ok) return refus($('[name=cnssName]', root), C.motifIdentiteCnss(idc)); }
          if (!employee && licenceBlock('Créer une fiche de salarié', 'paie')) return;
          // (plateforme) 1.59.0 — une ligne vide (ni libellé ni montant) s'en va ; un libellé sans montant se
          // refuse sur sa case : une prime à zéro chaque mois n'est pas une prime.
          const gardees = [];
          for (let i = 0; i < primes.length; i++) {
            const x = primes[i];
            const label = String(x.label || '').trim(), m = Number(x.amount);
            if (!label && !(m > 0)) continue;
            const caseDe = f => $(`#ef-primes tr[data-i="${i}"] [data-p=${f}]`, root);
            if (!(m > 0)) return refus(caseDe('amount'), `La prime « ${label} » n'a pas de montant : saisis ce qu'elle vaut pour un mois plein, ou retire la ligne.`);
            if (C.round3(m) !== m) return refus(caseDe('amount'), 'Un montant se saisit au millime : trois décimales au plus.');
            gardees.push({ label: label || 'Prime', amount: m, taxable: x.taxable !== false, parJour: !!x.parJour });
          }
          if (String(v.email || '').trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.email).trim())) return refus($('[name=email]', root), 'Cette adresse e-mail n\u2019est pas complète : prenom@exemple.tn.');
          if (v.weeklyHours !== '' && v.weeklyHours != null && !(Number(v.weeklyHours) > 0 && Number(v.weeklyHours) <= 60)) return refus($('[name=weeklyHours]', root), 'Entre 1 et 60 heures par semaine, ou laisse vide pour un temps plein.');
          // (plateforme) 1.229.0 — un brut changé sur un salarié déjà payé a une date d'effet ; l'ancien reste écrit.
          const ancien = C.round3(Number(e.grossSalary) || 0), nouveau = C.round3(Number(v.grossSalary) || 0);
          const desM = String(v.salaireDes || '');
          if (aDesBulletins && ancien !== nouveau) {
            if (!/^\d{4}-\d{2}$/.test(desM)) return refus($('[name=salaireDes]', root), 'Dis à partir de quel mois vaut le nouveau salaire.');
            const L = (Array.isArray(e.salaires) ? e.salaires : []).filter(x => x.des !== desM);
            L.push({ des: desM, brut: nouveau, avant: C.brutDuMois({ ...e, salaires: L }, Number(desM.slice(0, 4)), Number(desM.slice(5, 7))) || ancien, le: C.today() });
            e.salaires = L.sort((a, b) => a.des.localeCompare(b.des));
          }
          delete v.salaireDes;
          if (v.weeklyHours === '' || v.weeklyHours == null) delete v.weeklyHours; else v.weeklyHours = Number(v.weeklyHours);
          // (1.330.0) Le RIB s'enregistre sans ses espaces (« 08 123 … 52 ») : sa fin se lisait « ··· 0 52 » sur les bulletins.
          Object.assign(e, v, { iban: String(v.iban || '').replace(/\s+/g, ''), grossSalary: Number(v.grossSalary) || 0, children: Number(v.children) || 0, headOfFamily: !!v.headOfFamily, primes: gardees });
          if (!v.weeklyHours) delete e.weeklyHours;
          if (!employee) data.employees.push(e);
          save(true); close(); if (done) done(e);
          // (plateforme) 1.230.0 — une augmentation datée d'un mois passé : les bulletins d'après se refont ou se rappellent.
          if (aDesBulletins && ancien !== nouveau) rappelApresAugmentation(e, desM, done ? () => done(e) : null);
        };
        if ($('#del-emp', root)) $('#del-emp', root).onclick = async () => {
          if (enLecture('employees')) { toast(refusLecture('employees', 'supprimé'), true); return; }
          const n = data.payslips.filter(p => p.employeeId === e.id).length;
          if (n) return toast(`${pl(n, 'bulletin')} ${n > 1 ? 'existent' : 'existe'} pour ${e.name} : on ne supprime pas un salarié payé. Renseigne sa date de sortie.`, true);
          if (!await confirmDialog(`Supprimer ${e.name} ?`)) return;
          forget('employees', e.id, e.name);
          data.employees = data.employees.filter(x => x.id !== e.id);
          save(true); close(); navigate('#/paie');
        };
      });
  }

  // Établir ou modifier un bulletin. Le calcul est recalculé à chaque frappe et gardé dans le bulletin :
  // un barème changé l'an prochain ne doit pas réécrire un bulletin déjà remis.
  function payslipForm(slip, employee, year, month, done) {
    if (!slip && licenceBlock('Établir un nouveau bulletin', 'paie')) return;
    // (plateforme) 1.235.0 — un bulletin validé par le cabinet ne bouge plus : une correction passe par un mois suivant.
    if (slip && slip.valideLe) { toast('Ce bulletin est validé par ton cabinet : il ne change plus. Une correction passe par une régularisation sur un mois suivant ; demande-la à ton comptable.', true); return; }
    // (1.274.0, audit du 04/11/2026, G05) Payé, il ne change plus non plus (le serveur le refuse).
    if (slip && slip.paidDate) { toast('Ce bulletin est payé : il ne change plus. Ce qui manquait, ou a été payé en trop, passe par « Régulariser sur un mois suivant » (menu ⋯ du bulletin) ; un virement rejeté, par « Annuler le paiement ».', true); return; }
    const emp = employee || employeeById(slip.employeeId);
    const s = C.payrollSettings(data);
    const cur = company().currency;
    const auto = slip ? null : C.payslipInputFor(data, emp, year, month);
    const p = slip || { id: C.uid(), employeeId: emp.id, year, month, ...auto, paidDate: '', accountId: '',
      method: emp.method || 'virement', reference: '', issuedAt: C.today() };
    const bonuses = deepCopy(p.bonuses || []);
    const deductions = deepCopy(p.deductions || []);

    // (1.249.0) Refaite sur deux colonnes (Skander, 02/11 : « regarde ce qui s'affiche, l'UI n'est pas à la hauteur ») : à
    // gauche le mois, ses primes, ses retenues, son paiement ; à droite, collé, ce que ça donne — le net en grand, le détail
    // dessous. Plus de grandes cartes vides ; un bulletin payé le dit, et ne se supprime pas d'ici.
    const dv = C.normCurrency(company().currency);
    modal(`<h2>Bulletin de ${h(emp.name)} — ${h(MONTHS_LONG[Number(p.month) - 1])} ${h(String(p.year))}</h2>
      ${slip && slip.paidDate ? `<div class="bandeau ambre pa-bandeau pa-ambre bf-paye" id="bf-paye">${lfIc('coche', 16, 2.4)}<span class="txt"><b>Payé le ${C.fmtDate(slip.paidDate)}</b><span>Le changer change ce qui a été versé. Un écart se corrige d'habitude sur un mois suivant : « Régulariser », dans le menu du bulletin.</span></span></div>` : ''}
      <div class="bf-c"><div class="bf-g">
      <form id="bf">
        <fieldset class="bf-s"><legend>Le mois</legend><div class="bf-3">
        ${field(lbl(`Salaire de base (${h(dv)})`, 'pay.gross'), 'gross', C.money(p.gross != null ? p.gross : emp.grossSalary, null, 3), 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num"')}
        ${field(lbl('Jours ouvrables', 'pay.workedDays'), 'workedDays', p.workedDays || 26, 'number', 'step="0.5" min="1" max="31" class="num"')}
        ${field(lbl('Absences non payées', 'pay.absent'), 'absentDays', p.absentDays || 0, 'number', 'step="0.5" min="0" class="num"')}</div>
        ${C.pointageEnregistre(data, emp.id, Number(p.year), Number(p.month)) ? `<p class="small muted" id="bf-pointe">Les absences et les heures sup viennent du pointage de ${h(MONTHS_LONG[Number(p.month) - 1])} : corrige-les plutôt dans le pointage, le bulletin suivra.</p>` : ''}
        ${p.prorata ? `<p class="small muted" id="bf-prorata">Brut proratisé — ${h(p.prorata.motif)} : ${pl(p.prorata.jours, 'jour')} sur ${pct(p.prorata.sur)}, pour un brut de ${C.money(p.prorata.brutFiche, cur)} sur la fiche. <em>À VÉRIFIER avec ton comptable.</em></p>` : ''}
        </fieldset>
      </form>
      <section class="bf-s"><div class="bf-s-t"><b>Primes et indemnités</b> ${info('pay.bonus')}<button type="button" class="btn btn-sm btn-ghost" id="add-bon">${lfIc('croix', 13, 2.4)} Prime</button></div><div id="bf-bon"></div></section>
      <section class="bf-s"><div class="bf-s-t"><b>Retenues</b> ${info('pay.deduction')}<button type="button" class="btn btn-sm btn-ghost" id="add-ded">${lfIc('croix', 13, 2.4)} Retenue</button></div><div id="bf-ded"></div></section>
      <fieldset class="bf-s"><legend>Le paiement</legend><div class="bf-3" id="bf-pay">
        ${dateFieldHtml(lbl('Payé le', 'pay.paid'), 'paidDate', p.paidDate || '', { clearable: true })}
        <label class="field">${lbl('Compte', 'pay.account')}<select name="accountId"><option value="">${data.accounts.length ? '— le compte par défaut —' : 'Aucun compte créé : la banque'}</option>${data.accounts.map(a => `<option value="${a.id}" ${p.accountId === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Mode', 'pay.slipMethod')}<select name="method">${C.PAYMENT_METHODS.map(([v, l]) => `<option value="${v}" ${p.method === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      </fieldset>
      </div><aside class="bf-d"><div class="bf-resume" id="bf-resume" role="status" aria-live="polite"></div><div id="bf-calc"></div></aside></div>
      <p class="small warn-text" id="bf-refus" role="status" aria-live="polite" hidden></p>
      ${avertValideHtml('bf-valide')}
      <div class="modal-actions">
        ${slip && !slip.paidDate ? '<button class="btn btn-danger" id="del-slip" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        const input = () => {
          const v = formValues($('#bf', root));
          return { year: p.year, month: p.month, gross: Number(v.gross) || 0, workedDays: Number(v.workedDays) || 26,
            absentDays: Number(v.absentDays) || 0, bonuses, deductions,
            // (plateforme) 1.62.0 — le prorata d'une entrée ou d'une sortie : l'absence se retire au taux du contrat.
            prorata: p.prorata || null };
        };
        const drawSmall = (sel, list, kind) => {
          $(sel, root).innerHTML = list.length ? `<table class="lines-edit"><tbody>
            ${list.map((x, i) => `<tr data-i="${i}">
              <td><input type="text" data-f="label" value="${h(x.label || '')}" placeholder="${kind === 'bon' ? 'Prime de rendement' : 'Avance sur salaire'}">${kind === 'bon' && x.parJour ? `<div class="small muted" data-pj="${i}">au jour : ${pct(x.jours)} j payé${sPl(x.jours)} sur ${pct(x.sur)} · ${C.money(x.mensuel, cur)} pour un mois plein</div>` : ''}</td>
              <td style="width:130px"><input type="text" inputmode="decimal" data-montant autocomplete="off" class="num" data-f="amount" value="${h(C.money(Number(x.amount) || 0, null, 3))}" aria-label="Montant (${h(C.normCurrency(company().currency))})"></td>
              ${kind === 'bon' ? `<td style="width:110px"><label class="check small"><input type="checkbox" data-f="taxable" ${x.taxable !== false ? 'checked' : ''}> imposable</label></td>` : ''}
              <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-x="${i}">✕</button></td></tr>`).join('')}
          </tbody></table>` : `<p class="small muted bf-vide">${kind === 'bon' ? 'Aucune prime ce mois-ci.' : 'Aucune retenue ce mois-ci.'}</p>`;
          $$('[data-f]', $(sel, root)).forEach(el => el.oninput = el.onchange = () => {
            const i = Number(el.closest('tr').dataset.i);
            list[i][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.dataset.montant !== undefined ? lireMontant(el.value) : (el.type === 'number' ? Number(el.value) : el.value);
            // (plateforme) 1.59.0 — un montant retapé à la main n'est plus proratisé : le bulletin ne le prétend plus.
            if (el.dataset.f === 'amount' && list[i].parJour) {
              ['parJour', 'mensuel', 'jours', 'sur'].forEach(k => { delete list[i][k]; });
              const n = $(`[data-pj="${i}"]`, $(sel, root)); if (n) n.remove();
            }
            calc();
          });
          $$('[data-x]', $(sel, root)).forEach(b => b.onclick = () => { list.splice(Number(b.dataset.x), 1); drawSmall(sel, list, kind); calc(); });
        };
        // 10.10.0 (C-11) — le moteur de paie est partagé avec le Cabinet, son garde-fou aussi : une
        // absence plus longue que le mois, ou une retenue plus grosse que le salaire, rendait un net
        // NÉGATIF que rien ne refusait. Le bouton s'éteint par la même fonction que le Cabinet, et
        // le motif se lit au-dessus de lui, pendant la frappe (9.4.2, 9.4.5).
        const verdict = () => C.saisiePaieValide(input(), emp, s);
        // (1.305.0) Le mois que le cabinet a validé : chez lui, la paie du mois s'écrit au premier jour encore ouvert (0018). La
        // phrase pendant la saisie, comme une facture ou un achat. Rouvert sans rien changer de ce qui fait ses montants (le
        // brut, les jours, les primes, les retenues), rien ; « Payé le » dans cette période se dit aussi (le salaire versé).
        const empreinteB = () => { const i = input(); return JSON.stringify([C.round3(i.gross), i.workedDays, i.absentDays, i.bonuses.filter(x => C.round3(Number(x.amount) || 0)).map(x => [C.round3(Number(x.amount) || 0), x.taxable !== false]), i.deductions.map(x => C.round3(Number(x.amount) || 0)).filter(Boolean)]); };
        const empreinteB0 = slip ? empreinteB() : null;
        const valideDuBulletin = quandLu => {
          const dB = !slip || empreinteB() !== empreinteB0 ? dateDansLaPeriodeValidee([C.payslipDate(p)], quandLu) : '';
          if (dB) return { d: dB, sujet: 'Ce bulletin', neuve: !slip };
          const paye = formValues($('#bf-pay', root)).paidDate;
          const dP = paye ? dateDansLaPeriodeValidee([paye], quandLu) : '';
          return dP ? { d: dP, sujet: 'Ce paiement', neuve: true } : null;
        };
        const majValideB = () => { const x = valideDuBulletin(majValideB); majAvertValide($('#bf-valide', root), x ? x.d : '', x ? x.d : '', { sujet: x ? x.sujet : '', fem: false, neuve: !!(x && x.neuve), geste: 'En l\'enregistrant' }); };
        const calc = () => {
          majValideB();
          const v = verdict();
          const refus = $('#bf-refus', root);
          if (refus) { refus.hidden = v.ok; refus.textContent = v.ok ? '' : v.motif; }
          const okBtn = $('#ok', root);
          if (okBtn) { okBtn.disabled = !v.ok; okBtn.title = v.ok ? '' : v.motif; }
          const c = C.computePayslip(emp, input(), s);
          $('#bf-resume', root).innerHTML = `<span class="bf-net"><small>Net à payer</small><b>${C.money(c.net, cur)}</b></span><span><small>Brut</small><b>${C.money(c.gross, cur)}</b></span><span><small>Coût pour l'entreprise</small><b>${C.money(c.employerCost, cur)}</b></span>`;
          $('#bf-calc', root).innerHTML = `
            <div class="vat-box">
              <div class="vat-line"><span>Salaire brut</span><span class="num">${C.money(c.gross, cur)}</span></div>
              ${c.absenceCut ? `<div class="vat-line sub-line"><span class="muted">dont absence retirée</span><span class="num muted">− ${C.money(c.absenceCut, cur)}</span></div>` : ''}
              <div class="vat-line minus"><span>− CNSS salarié (${pct(c.rates.cnssEmployee)} %)</span><span class="num">${C.money(c.cnssEmployee, cur)}</span></div>
              <div class="vat-line minus"><span>− Impôt sur le revenu ${info('pay.irpp')}</span><span class="num">${C.money(c.irpp, cur)}</span></div>
              ${c.css ? `<div class="vat-line minus"><span>− Contribution sociale de solidarité</span><span class="num">${C.money(c.css, cur)}</span></div>` : ''}
              ${c.cssFinie ? `<div class="vat-line" id="bf-css-finie"><span>Contribution sociale de solidarité : non retenue</span><span class="small muted">sa règle s'arrête le ${C.fmtDate(c.cssFinie)}</span></div>` : ''}
              ${c.otherDeductions ? `<div class="vat-line minus"><span>− Autres retenues</span><span class="num">${C.money(c.otherDeductions, cur)}</span></div>` : ''}
              <div class="vat-line total ok"><span>Net à payer</span><span class="num">${C.money(c.net, cur)}</span></div>
              <div class="vat-line"><span>Charges patronales ${info('pay.employerCost')}</span><span class="num">${C.money(C.employerChargesOf(c), cur)}</span></div>
              ${c.tfp || c.foprolos ? `<div class="vat-line sub-line"><span class="muted">dont TFP ${C.money(c.tfp, cur)} et FOPROLOS ${C.money(c.foprolos, cur)} ${info('pay.tfp')}</span><span class="num muted"></span></div>` : ''}
              <div class="vat-line"><span><b>Coût pour l'entreprise</b></span><span class="num"><b>${C.money(c.employerCost, cur)}</b></span></div>
            </div>
            <p class="small muted mt">Barème appliqué : CNSS ${pct(c.rates.cnssEmployee)} % salarié / ${pct(c.rates.cnssEmployer)} % employeur, ${c.regime && c.regime.sansIrpp ? 'sans IRPP' : `IRPP progressif sur ${C.money(c.annualTaxable, cur)} imposables à l'année`}. <em>À VÉRIFIER avec ton comptable</em> — ces taux se règlent dans l'onglet Barèmes.</p>
            ${/* H4 — un taux qui s'écarte du barème sans explication se lit comme une erreur de calcul. */''}
            ${c.regime ? `<p class="small mt" id="bf-regime"><b>${h(C.contractLabel(c.contrat).split(' —')[0])}</b> : ${h(C.libelleRegime(c.regime))} — le régime réglé dans Barèmes → Les contrats aux règles particulières.</p>` : ''}`;
        };
        drawSmall('#bf-bon', bonuses, 'bon'); drawSmall('#bf-ded', deductions, 'ded'); calc();
        $('#add-bon', root).onclick = () => { bonuses.push({ label: '', amount: 0, taxable: true }); drawSmall('#bf-bon', bonuses, 'bon'); calc(); };
        $('#add-ded', root).onclick = () => { deductions.push({ label: '', amount: 0 }); drawSmall('#bf-ded', deductions, 'ded'); calc(); };
        // (plateforme) 1.59.0 — les primes au jour suivent les jours payés : ceux du mois, moins ce que le
        // contrat ne couvre pas (l'entrée, la sortie), moins l'absence non payée.
        const suivreLesJours = () => {
          const v = input();
          const hors = p.prorata ? Math.max(0, Number(p.prorata.sur) - Number(p.prorata.jours)) : 0;
          const payes = Math.max(0, C.round3(v.workedDays - hors - v.absentDays));
          let change = false;
          bonuses.forEach(x => {
            if (!x.parJour) return;
            const j = Math.min(v.workedDays, payes);
            const m = C.round3(x.mensuel * j / v.workedDays);
            if (m !== x.amount || j !== x.jours || v.workedDays !== x.sur) { Object.assign(x, { amount: m, jours: j, sur: v.workedDays }); change = true; }
          });
          if (change) drawSmall('#bf-bon', bonuses, 'bon');
        };
        $('#bf', root).oninput = $('#bf', root).onchange = () => { suivreLesJours(); calc(); };
        $('#bf-pay', root).addEventListener('input', majValideB);
        $('#bf-pay', root).addEventListener('change', majValideB);
        const nomDuMois = `${MONTHS_LONG[Number(p.month) - 1]} ${p.year}`;
        $('#ok', root).onclick = () => {
          const v = { ...formValues($('#bf', root)), ...formValues($('#bf-pay', root)) };
          const i = input();
          const juge = verdict();
          if (!juge.ok) return toast(juge.motif, true);
          if (closedBlock(C.payslipDate(p), 'Ce bulletin')) return;
          if (!slip && licenceBlock('Établir un nouveau bulletin', 'paie')) return;
          // Lu AVANT de ranger : `p` est le bulletin rangé lui-même quand on le modifie.
          const dvB = valideDuBulletin();
          Object.assign(p, v, i, { gross: i.gross, computed: C.computePayslip(emp, i, s), issuedAt: p.issuedAt || C.today() });
          // (plateforme) 1.227.0 — un bulletin changé après ton bon à payer se réapprouve : l'accord portait sur l'ancien.
          if (slip && p.bonAPayerLe) delete p.bonAPayerLe;
          // Un brut retouché à la main n'est plus « proratisé » : le bulletin ne doit pas le prétendre.
          if (p.prorata && C.round3(i.gross) !== C.round3(p.prorata.brut)) p.prorata = null;
          if (!slip) data.payslips.push(p);
          save(true); close();
          if (dvB) direAuComptableApres(dvB.sujet === 'Ce bulletin' ? (slip ? 'Bulletin modifié' : 'Bulletin enregistré') : 'Salaire marqué payé', { fait: slip && dvB.sujet === 'Ce bulletin' ? 'de modifier' : 'd\'enregistrer', fem: false,
            quoi: dvB.sujet === 'Ce bulletin' ? `le bulletin ${deDit(emp.name)} ${deDit(nomDuMois)}, daté du ${C.fmtDate(dvB.d)} (net ${C.money(p.computed.net, cur)})` : `le paiement du salaire ${deDit(emp.name)} ${deDit(nomDuMois)}, daté du ${C.fmtDate(dvB.d)} (${C.money(p.computed.net, cur)})` });
          if (done) done(p);
        };
        if ($('#del-slip', root)) $('#del-slip', root).onclick = async () => {
          // (1.305.0) D'un mois que le cabinet a validé : la question le dit, le message après offre de le lui dire.
          await periodeValideeLue();
          const dvSup = dateDansLaPeriodeValidee([C.payslipDate(p)]);
          if (!await confirmDialog(`Supprimer ce bulletin ? S'il a déjà été remis au salarié, mieux vaut le corriger que le faire disparaître.${dvSup ? ` ${phraseAnnulationValidee(dvSup, { sujet: 'Il', fem: false })}` : ''}`)) return;
          if (closedBlock(C.payslipDate(p), 'Ce bulletin')) return;
          forget('payslips', p.id, `${emp.name} ${p.month}/${p.year}`);
          data.payslips = data.payslips.filter(x => x.id !== p.id);
          save(true); close();
          if (dvSup) direAuComptableApres('Bulletin supprimé', { fait: 'de supprimer', fem: false, annule: true, quoi: `le bulletin ${deDit(emp.name)} ${deDit(nomDuMois)}, daté du ${C.fmtDate(dvSup)}` });
          if (done) done(null);
        };
      }, null, { classe: 'pa-bf' });
  }

  // (plateforme) 1.61.0 — le journal de paie du mois (docs/paie.md) : une ligne par bulletin, les colonnes du journal de
  // paie réel, les totaux. Les chiffres sont ceux des bulletins établis.
  function journalDePaieFenetre(year, month) {
    const j = C.journalDePaie(data, year, month);
    const dec = C.decimalsFor(company().currency);
    const montant = v => Math.abs(v) < 0.0005 ? '<span class="muted">—</span>' : C.money(v, null, dec);
    const periode = `${MONTHS_LONG[month - 1]} ${year}`;
    const nom = `Journal_de_paie_${year}-${String(month).padStart(2, '0')}`;
    modal(`<h2>Journal de paie — ${h(periode)} ${info('pay.journal')}</h2>
      <p class="small muted mb">${pl(j.nombre, 'bulletin')}, dans l'ordre du registre du personnel. Les montants sont ceux des bulletins établis ; le total de chaque colonne est la somme de ses lignes. Une ligne s'ouvre sur son bulletin.</p>
      ${(() => { const L = C.missingPayslips(data, year, month); return L.length ? `<div class="warn-box mb" id="jp-manque">${L.length > 1 ? `${L.length} salariés en poste n'ont` : `${h(L[0].name)} n'a`} pas encore de bulletin ${/^[aeiouyéè]/i.test(MONTHS_LONG[month - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[month - 1])}${L.length > 1 ? ` : ${h(L.map(e => e.name).join(', '))} ; le journal ne les compte pas` : ' ; le journal ne compte que les bulletins établis'}.</div>` : ''; })()}
      <div class="scroll-x"><table class="list compact jp-table" id="jp-table"><thead><tr><th>N°</th><th>Salarié</th>
        ${/* Les en-têtes passent à la ligne (pas de `nw`) : sur une seule, ils élargissaient chaque colonne. */''}
        ${C.COLONNES_JOURNAL.map(([, l, court]) => `<th class="r" title="${h(l)}">${h(court)}</th>`).join('')}</tr></thead><tbody>
        ${j.lignes.map(l => `<tr class="clickable" tabindex="0" data-jp="${h(l.employeeId)}" title="Ouvrir le bulletin de ${h(l.name)}"><td class="nw muted">${l.n ? String(l.n).padStart(4, '0') : ''}</td><td class="nw"><strong>${h(l.name)}</strong></td>
          ${C.COLONNES_JOURNAL.map(([k]) => `<td class="r nw" data-col="${k}">${k === 'jours' ? pct(l[k]) : montant(l[k])}</td>`).join('')}</tr>`).join('')}
        <tr class="total-row" data-jp-total><td colspan="2"><strong>Totaux</strong></td>
          ${C.COLONNES_JOURNAL.map(([k]) => `<td class="r nw" data-col="${k}">${k === 'jours' ? '' : Math.abs(j.totaux[k]) < 0.0005 ? '<span class="muted">—</span>' : `<strong>${C.money(j.totaux[k], null, dec)}</strong>`}</td>`).join('')}</tr>
      </tbody></table></div>
      <p class="small muted jp-legende" id="jp-legende">${C.COLONNES_JOURNAL.filter(([, l, c]) => l !== c && !['Base', 'Brut', 'Indemnités', 'Retenues'].includes(c)).map(([, l, c]) => `<b>${h(c)}</b> ${h(/^[A-Z]{2,}/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1))}`).join(' · ')}.</p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Fermer</button><button type="button" class="btn" id="jp-voir">${lfIc('oeil', 15)} Voir le document</button><button type="button" class="btn" id="jp-csv">Exporter en CSV</button><button type="button" class="btn btn-primary" id="jp-pdf">${lfIc('exporter', 15)} Exporter en PDF</button></div>`,
    (root) => {
      // (1.258.0, la maquette O19) Les documents du mois à côté du journal : l'ordre de virement et les reçus en espèces se
      // font dans « Payer les salaires » (ce qui reste à payer), le registre est la liste du personnel.
      const aPayer = C.salairesAPayer(data, year, month).length;
      $('#jp-voir', root).onclick = () => apercuDocument({ titre: `Journal de paie — ${periode}`, html: C.journalDePaieHtml(data, company(), year, month), fichier: nom + '.pdf', imprimer: true,
        docs: [{ label: 'Journal de paie', actif: true },
          { label: 'Ordre de virement', sous: aPayer ? `dans « Payer les salaires » : ${pl(aPayer, 'salaire')} à payer` : 'tous les salaires du mois sont payés', run: () => payerSalairesFenetre(year, month) },
          { label: 'Reçu de salaire en espèces', sous: 'pour qui est payé en espèces, dans « Payer les salaires »', run: () => payerSalairesFenetre(year, month) },
          { label: 'Registre du personnel', sous: 'la liste que l\'inspection du travail peut demander', run: () => { paieState.tab = 'registre'; if (location.hash === '#/paie') render(true); else location.hash = '#/paie'; } }],
        pret: `<b>Prêt</b><span>les montants viennent des ${pl(j.nombre, 'bulletin')}, jamais tapés</span><span>${h(periode)} · le total de chaque colonne est la somme de ses lignes</span>` });
      $('#jp-pdf', root).onclick = async () => {
        try {
          const f = await bridge.exportPdf(C.journalDePaieHtml(data, company(), year, month), nom + '.pdf');
          if (f) toast('PDF enregistré : ' + f.split(/[\\/]/).pop());
        } catch (e) { toast(e.message || 'Export impossible', true); }
      };
      $$('#jp-table tr[data-jp]', root).forEach(tr => { const ouvrir = () => { const x = (data.payslips || []).find(b => b.employeeId === tr.dataset.jp && Number(b.year) === year && Number(b.month) === month); if (x) apercuBulletin(x); }; tr.onclick = ouvrir; tr.onkeydown = ev => { if (ev.key === 'Enter') ouvrir(); }; });
      $('#jp-csv', root).onclick = async () => {
        const f = await bridge.saveText(nom + '.csv', C.toCsv(j.lignes.concat([{ name: 'Total', ...j.totaux, jours: '' }]), C.colonnesCsvJournal()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
    });
  }

  // (plateforme) 1.74.0 — payer les salaires du mois (docs/paie.md) : les bulletins non payés, cochés ; le jour et le compte
  // du paiement ; ce qui manque se dit avant le geste, avec son bouton ; l'ordre de virement à remettre à la banque ;
  // « Marquer payés » d'un geste, qu'« Annuler » défait. SkanFact ne fait aucun virement. `garde` : ce que la fenêtre
  // tenait (les cases, le jour, le compte), quand elle se rouvre après la fiche d'un salarié ou d'un compte.
  // (plateforme) 1.227.0 — quand le cabinet tient la paie (un choix écrit, valable pour ce mois), un bulletin se paie après
  // le bon à payer de l'entreprise : la fenêtre ne propose que les bulletins approuvés, et dit pourquoi les autres manquent.
  const bapExige = (y, m) => { if (sansCabinetRelie()) return false; const co = company(), ym = `${y}-${String(m).padStart(2, '0')}`; return (co.paieModeDes && ym < co.paieModeDes ? (co.paieModeAvant || '') : (co.paieMode || '')) === 'tenue'; };
  // (1.268.0) Qui fait la paie d'un mois, lu ici aussi par les fenêtres (« seule » : tu la fais, ton cabinet la vérifie).
  const verifieeLe = (y, m) => { if (sansCabinetRelie()) return false; const co = company(), ym = `${y}-${String(m).padStart(2, '0')}`; return (co.paieModeDes && ym < co.paieModeDes ? (co.paieModeAvant || '') : (co.paieMode || '')) === 'seule'; };
  // (1.268.0 ; Skander, 04/11/2026 : 16 § 9, décision 3) En Essentiel, quand le cabinet tient la paie, un congé et une avance
  // se notent : le client lui donne les faits qu'il est seul à connaître (le serveur le vérifie : serveur/abonnement/offre.ts).
  // La lecture seule d'un abonnement retient toujours.
  const tenueCeMois = () => { const t = C.today(); return bapExige(Number(t.slice(0, 4)), Number(t.slice(5, 7))); };
  const faitBloque = what => licenceBlock(what, tenueCeMois() ? null : 'paie');
  function payerSalairesFenetre(year, month, done, garde) {
    const tous = C.salairesAPayer(data, year, month);
    const lignes = bapExige(year, month) ? tous.filter(l => (payslipById(l.id) || {}).bonAPayerLe) : tous;
    if (!tous.length) { toast('Tous les bulletins du mois sont payés.'); if (done) done(); return; }
    if (!lignes.length) { toast(`${tous.length > 1 ? `Les ${tous.length} bulletins attendent` : 'Le bulletin attend'} ton bon à payer : approuve-${tous.length > 1 ? 'les' : 'le'} d'abord (le bouton en haut de « Le mois »).`, true); if (done) done(); return; }
    const g = garde || {};
    const coches = new Set(g.coches || lignes.map(l => l.id));
    const cur = company().currency;
    const comptes = data.accounts || [];
    const parDefaut = comptes.find(a => a.isDefault) || comptes[0] || null;
    const compteVu = g.accountId || (parDefaut && parDefaut.id) || '';
    const periode = `${MONTHS_LONG[month - 1]} ${year}`;
    const modeDe = v => (C.PAYMENT_METHODS.find(x => x[0] === v) || [, v])[1];
    const ribNu = l => String(l.rib || '').replace(/\s/g, '');
    const ribDouble = l => l.mode === 'virement' && ribNu(l) && lignes.filter(x => x.mode === 'virement' && ribNu(x) === ribNu(l)).length > 1;
    // (1.256.0) La fenêtre de la maquette (« Payer les salaires ») : les deux champs, le tableau, la règle en bas, et le pied
    // Annuler · Ordre de virement · Reçu (des espèces) · Marquer payés.
    const avanceDe = l => C.round3(((payslipById(l.id) || {}).deductions || []).filter(d => d.advanceId).reduce((a, d) => a + (Number(d.amount) || 0), 0));
    const prenom = n => String(n || '').split(/\s+/)[0];
    const especesL = lignes.filter(l => l.mode === 'especes');
    modal(`<h2>Payer les salaires ${h(window.SkanCompta.deMois(periode))} ${info('pay.payerMois')}</h2>
      <form id="ps" class="grid-2">
        ${dateFieldHtml(lbl('Payés le', 'pay.paid'), 'date', g.date || C.today(), {})}
        <label class="field">${lbl('Depuis le compte', 'pay.account')}<select name="accountId">${comptes.length ? '' : '<option value="">Aucun compte créé : la banque</option>'}${comptes.map(a => `<option value="${h(a.id)}" ${compteVu === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select></label>
      </form>
      ${/* (plateforme) 1.234.0 — la fenêtre comme sa maquette : « Comment » (le mode, le RIB masqué et contrôlé), le détail
           des virements et des espèces au pied, le montant sur le bouton. */''}
      <div class="scroll-x"><table class="mini lu" id="ps-table"><thead><tr><th style="width:28px"><input type="checkbox" id="ps-tous" aria-label="Tout cocher"></th><th>Salarié</th><th>Comment</th><th class="r">Net à verser</th></tr></thead><tbody>
        ${lignes.map(l => `<tr data-ps="${h(l.id)}"><td><input type="checkbox" data-ps-c="${h(l.id)}" aria-label="Payer ${h(l.name)}" ${coches.has(l.id) ? 'checked' : ''}></td>
          <td><b>${h(l.name)}</b>${avanceDe(l) ? `<small>avance retenue : ${C.money(avanceDe(l), '')}</small>` : ''}</td>
          <td class="ps-comment"><span class="${l.mode === 'virement' ? '' : 'ambre'}">${h(modeDe(l.mode).toLowerCase())}${l.mode === 'especes' ? ', contre reçu' : ''}</span>${l.rib ? `<small class="mono">··· ${h(String(l.rib).replace(/\s/g, '').slice(-4))}${l.manque || ribDouble(l) ? '' : ' · contrôlé'}</small>` : ''}${!l.manque && ribDouble(l) ? '<small class="warn-text">le même RIB qu\'un autre salarié</small>' : ''}${l.manque ? `<small><button type="button" class="montant-lien warn-text small" data-ps-rib="${h(l.employeeId)}">${l.manque === 'rib' ? 'RIB à renseigner' : 'RIB à corriger'}</button></small>` : ''}${l.raison ? `<small class="warn-text">${h(l.raison)}</small>` : ''}</td>
          <td class="r"><b>${C.money(l.net, '')}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td id="ps-compte"></td><td id="ps-detail"></td><td class="r"><span id="ps-total"></span></td></tr></tfoot></table></div>
      ${(() => { const nv = verifieeLe(year, month) ? lignes.filter(l => !(payslipById(l.id) || {}).verifieLe).length : 0;
        // (1.268.0 ; Skander, 04/11/2026 : 16 § 9) Ton cabinet vérifie ta paie : tu peux payer avant sa relecture ; la fenêtre le
        // dit avant le geste, et ce qu'il trouverait se corrige sur le bulletin suivant.
        return nv ? `<div class="bandeau ambre pa-bandeau" id="ps-pas-verifie" role="status">${lfIc('comptable', 18)}<span class="txt"><b>Ton cabinet n'a pas encore vérifié ${nv > 1 ? `${nv} de ces bulletins` : 'un de ces bulletins'}</b><span>Tu peux payer quand même. S'il trouve une erreur, elle se corrige sur le bulletin suivant.</span></span></div>` : ''; })()}
      <div id="ps-avert"></div>
      ${avertValideHtml('ps-valide')}
      <p class="regle">${lfIc('aide', 13, 2)} SkanFact ne fait aucun virement : l'ordre de virement se remet à ta banque (ou se téléverse sur son site). « Marquer payés » sort l'argent de la trésorerie au jour choisi ; la Banque le reconnaîtra sur ton relevé. Ne saisis pas en plus un mouvement « Salaires » : il compterait deux fois.${especesL.length ? ` Payé en espèces, chacun signe son reçu : ta caisse se justifie par lui.` : ''}</p>
      <div class="modal-actions"><button type="button" class="btn" data-close style="margin-inline-end:auto">Annuler</button><button type="button" class="btn" id="ps-ordre">${lfIc('oeil', 15)} Ordre de virement</button>${especesL.length ? `<button type="button" class="btn" id="ps-recu">${lfIc('oeil', 15)} ${especesL.length > 1 ? 'Reçus des espèces' : `Reçu de ${h(prenom(especesL[0].name))}`}</button>` : ''}<button type="button" class="btn btn-primary" id="ps-payer"></button></div>`,
    (root, close) => {
      const choisies = () => lignes.filter(l => $(`[data-ps-c="${l.id}"]`, root).checked);
      const compteChoisi = () => comptes.find(a => a.id === $('[name=accountId]', root).value) || null;
      const tenu = () => ({ coches: choisies().map(l => l.id), date: formValues($('#ps', root)).date, accountId: $('[name=accountId]', root).value });
      // L'ordre porte les lignes cochées payées par virement, au RIB valable ; les autres se disent avant le geste.
      const dansLOrdre = () => choisies().filter(l => l.mode === 'virement' && !l.manque);
      const maj = () => {
        const ch = choisies();
        $('#ps-tous', root).checked = ch.length === lignes.length;
        $('#ps-tous', root).indeterminate = ch.length > 0 && ch.length < lignes.length;
        $('#ps-compte', root).textContent = `${pl(ch.length, 'salaire')} sur ${lignes.length}`;
        const totalCh = C.money(C.round3(ch.reduce((s, l) => s + l.net, 0)), cur);
        $('#ps-total', root).textContent = totalCh;
        const vir = ch.filter(l => l.mode === 'virement'), aut = ch.filter(l => l.mode !== 'virement'), som = L => C.money(C.round3(L.reduce((s, l) => s + l.net, 0)), '');
        $('#ps-detail', root).textContent = [vir.length ? `${pl(vir.length, 'virement')} ${som(vir)}` : '', aut.length ? `${aut.length > 1 ? 'autres' : modeDe(aut[0].mode).toLowerCase()} ${som(aut)}` : ''].filter(Boolean).join(' · ');
        $('#ps-payer', root).innerHTML = `${lfIc('coche', 15, 2.4)} ${ch.length ? `Marquer payés · ${h(totalCh)}` : 'Marquer payés'}`;
        const compte = compteChoisi();
        // Tous ceux que l'ordre ne peut pas porter, cochés ou non (la phrase reste vraie) : cocher ou décocher une ligne ne
        // change rien à la hauteur de la fenêtre, et ne pousse pas ses boutons sous le curseur (vu à la souris).
        const horsOrdre = lignes.filter(l => l.mode !== 'virement' || l.manque);
        const motifs = [];
        // L'ordre dit qui l'envoie : sans le nom de la société, il ne vaut rien pour la banque (vu à la souris).
        const sansNom = !String(company().name || '').trim();
        if (sansNom) motifs.push(`<div class="ctrl-geste" id="ps-societe"><span>Le nom de ta société n'est pas sur ta fiche : l'ordre de virement ne dirait pas qui l'envoie.</span><button type="button" class="btn btn-sm" id="ps-societe-go">Renseigner ta fiche…</button></div>`);
        // (plateforme) 1.80.0 — chaque salarié au RIB manquant a son bouton, nommé (le seul bouton du cadre ouvrait le compte).
        if (horsOrdre.length) motifs.push(`<div class="ctrl-geste" id="ps-hors"><span>L'ordre de virement ne portera pas ${horsOrdre.map(l => `<b>${h(l.name)}</b> (${l.mode !== 'virement' ? h(modeDe(l.mode).toLowerCase()) : l.manque === 'rib' ? 'RIB à renseigner' : 'RIB à corriger'})`).join(', ')}.</span>${horsOrdre.filter(l => l.mode === 'virement' && l.manque).map(l => `<button type="button" class="btn btn-sm" data-ps-rib-cadre="${h(l.employeeId)}">${l.manque === 'rib' ? 'Renseigner' : 'Corriger'} le RIB de ${h(l.name)}…</button>`).join('')}</div>`);
        // (1.248.0) Deux salariés au même RIB : l'ordre enverrait deux salaires sur un seul compte (recette du 02/11 : chaque
        // ligne disait « contrôlé », le contrôle ne lisait que la clé du RIB).
        const parRib = {};
        lignes.filter(l => l.mode === 'virement' && l.rib && !l.manque).forEach(l => { const r = String(l.rib).replace(/\s/g, ''); (parRib[r] = parRib[r] || []).push(l); });
        Object.values(parRib).filter(l => l.length > 1).forEach(l => motifs.push(`<div class="ctrl-geste" data-ps-double><span>${l.map(x => `<b>${h(x.name)}</b>`).join(', ')} ont le même RIB (··· ${h(String(l[0].rib).replace(/\s/g, '').slice(-4))}) : vérifie leurs fiches avant de remettre l'ordre.</span></div>`));
        // (1.248.0) Sans compte de trésorerie, « — compte par défaut — » ne disait rien : on dit ce qui manque, et le bouton.
        if (!comptes.length) motifs.push(`<div class="ctrl-geste" id="ps-sans-compte"><span>Aucun compte de banque n'est créé : l'ordre ne dira pas quel compte débiter, et la trésorerie ne saura pas d'où sort l'argent.</span><button type="button" class="btn btn-sm" id="ps-creer-compte">Créer le compte de ta banque…</button></div>`);
        if (compte && compte.kind === 'caisse') motifs.push(`<div class="ctrl-geste" id="ps-caisse"><span>« ${h(compte.name)} » est une caisse : un ordre de virement se donne à une banque.</span></div>`);
        else if (compte && !String(compte.rib || '').trim()) motifs.push(`<div class="ctrl-geste" id="ps-compte-rib"><span>Le compte « ${h(compte.name)} » n'a pas de RIB : l'ordre ne dira pas quel compte débiter.</span><button type="button" class="btn btn-sm" id="ps-compte-go">Renseigner le RIB du compte…</button></div>`);
        $('#ps-avert', root).innerHTML = motifs.length ? `<div class="warn-box">${motifs.join('')}</div>` : '';
        const so = $('#ps-societe-go', root);
        if (so) so.onclick = () => { close(); allerParametres('societe', 'p-identite:name'); };
        // Le bouton du cadre fait le geste de la pastille du tableau (la fiche du salarié, puis la fenêtre comme on l'a laissée).
        $$('[data-ps-rib-cadre]', root).forEach(b => { b.onclick = () => { const p = $$('[data-ps-rib]', root).find(x => x.dataset.psRib === b.dataset.psRibCadre); if (p) p.click(); }; });
        const cc = $('#ps-creer-compte', root);
        if (cc) cc.onclick = () => { const t = tenu(); close(); accountForm(null, () => payerSalairesFenetre(year, month, done, t)); };
        const go = $('#ps-compte-go', root);
        if (go) go.onclick = () => { const t = tenu(); close(); accountForm(compte, () => payerSalairesFenetre(year, month, done, t), null, { focus: 'rib' }); };
        const ordre = $('#ps-ordre', root);
        const pourquoi = !dansLOrdre().length ? 'Aucune ligne cochée n\'est payée par virement à un RIB valable.' : compte && compte.kind === 'caisse' ? 'Un ordre de virement se donne à une banque.' : sansNom ? 'Le nom de ta société manque : l\'ordre ne dirait pas qui l\'envoie.' : '';
        ordre.disabled = !!pourquoi; ordre.title = pourquoi;
        $('#ps-payer', root).disabled = !ch.length;
      };
      // (1.305.0) Payés à une date de la période que le cabinet a validée : la phrase pendant la saisie de la date.
      const majValidePs = () => { const d = formValues($('#ps', root)).date; majAvertValide($('#ps-valide', root), d ? dateDansLaPeriodeValidee([d], majValidePs) : '', d, { sujet: 'Ce paiement', fem: false, neuve: true, geste: 'En le marquant payé' }); };
      $('#ps', root).addEventListener('input', majValidePs);
      $('#ps', root).addEventListener('change', majValidePs);
      majValidePs();
      $$('[data-ps-c]', root).forEach(c => { c.onchange = maj; });
      $('#ps-tous', root).onchange = e => { $$('[data-ps-c]', root).forEach(c => { c.checked = e.target.checked; }); maj(); };
      $('[name=accountId]', root).onchange = maj;
      // Le RIB d'un salarié se renseigne sur sa fiche, sur la case ; enregistrée, la fenêtre revient comme on l'a laissée.
      $$('[data-ps-rib]', root).forEach(b => { b.onclick = () => {
        const emp = employeeById(b.dataset.psRib); if (!emp) return;
        const t = tenu(); close();
        employeeForm(emp, () => payerSalairesFenetre(year, month, done, t), { focus: 'iban' });
      }; });
      // (plateforme) 1.223.0 — l'ordre de virement s'ouvre en aperçu : la lettre elle-même, puis « Exporter en PDF ».
      $('#ps-ordre', root).onclick = () => {
        const compte = compteChoisi() || {};
        const L = dansLOrdre();
        const html = C.ordreDeVirementHtml(company(), { year, month, date: formValues($('#ps', root)).date || C.today(),
          compte: { bank: compte.bank || company().bank || '', rib: compte.rib || company().rib || '' },
          lignes: L.map(l => ({ name: l.name, rib: l.rib, net: l.net })) });
        apercuDocument({ titre: `Ordre de virement · salaires de ${MONTHS_LONG[month - 1]} ${year}`, html,
          fichier: `Ordre_de_virement_salaires_${year}-${String(month).padStart(2, '0')}.pdf`,
          cote: `<div class="pa-doc-i"><b>${pl(L.length, 'bénéficiaire')}</b><span>les salariés cochés, payés par virement à un RIB valable</span></div>
            <div class="pa-doc-i"><b>À VÉRIFIER</b><span>certaines banques demandent leur propre formulaire, ou un fichier.</span></div>` });
      };
      // Le reçu de chaque salarié payé en espèces (coché), à faire signer : l'aperçu, puis « Exporter en PDF ».
      if ($('#ps-recu', root)) $('#ps-recu', root).onclick = () => {
        const L = choisies().filter(l => l.mode === 'especes');
        if (!L.length) { toast('Coche au moins un salarié payé en espèces : son reçu se prépare pour lui.', true); return; }
        const html = C.recuSalaireEspecesHtml(company(), { year, month, date: formValues($('#ps', root)).date || C.today(),
          lignes: L.map(l => { const e = employeeById(l.employeeId) || {}; return { name: l.name, cin: e.cin || '', poste: e.position || '', net: l.net }; }) });
        apercuDocument({ titre: `${L.length > 1 ? 'Reçus' : 'Reçu'} de salaire en espèces · ${MONTHS_LONG[month - 1]} ${year}`, html,
          fichier: `Recu_salaire_especes_${year}-${String(month).padStart(2, '0')}.pdf`,
          cote: `<div class="pa-doc-i"><b>${pl(L.length, 'reçu')}</b><span>un par salarié payé en espèces, à faire signer le jour du paiement</span></div>
            <div class="pa-doc-i"><b>À VÉRIFIER</b><span>la durée de conservation du reçu, avec ton comptable.</span></div>` });
      };
      $('#ps-payer', root).onclick = () => {
        const v = formValues($('#ps', root));
        if (!v.date) return refus($('[name=date]', root), 'Le jour du paiement est obligatoire.');
        if (closedBlock(v.date, 'Ce paiement de salaires')) return;
        const ids = choisies().map(l => l.id);
        if (!ids.length) return;
        const avant = ids.map(id => { const x = data.payslips.find(p => p.id === id); return { id, paidDate: x.paidDate || '', accountId: x.accountId || '' }; });
        const dvPs = dateDansLaPeriodeValidee([v.date]);
        ids.forEach(id => { const x = data.payslips.find(p => p.id === id); x.paidDate = v.date; x.accountId = v.accountId || ''; });
        save(true); close(); if (done) done();
        // (1.305.0) Dans la période validée : le message qui offre de le dire au comptable (le paiement se défait depuis le menu
        // de chaque bulletin, « Annuler le paiement »).
        if (dvPs) { direAuComptableApres(`${pl(ids.length, 'salaire')} ${window.SkanCompta.deMois(periode)} ${ids.length > 1 ? 'marqués payés' : 'marqué payé'}`, { fait: 'd\'enregistrer', fem: false,
          quoi: `le paiement des salaires ${window.SkanCompta.deMois(periode)}, daté du ${C.fmtDate(dvPs)} (${pl(ids.length, 'salarié')}, ${C.money(C.round3(lignes.filter(l => ids.includes(l.id)).reduce((s2, l) => s2 + l.net, 0)), cur)})` }); return; }
        toastUndo(`${pl(ids.length, 'salaire')} ${window.SkanCompta.deMois(periode)} ${ids.length > 1 ? 'marqués payés' : 'marqué payé'} le ${C.fmtDate(v.date)}`, () => {
          avant.forEach(a => { const x = data.payslips.find(p => p.id === a.id); if (x) { x.paidDate = a.paidDate; x.accountId = a.accountId; } });
          save(true); if (done) done();
        });
      };
      maj();
    });
  }

  // (plateforme) 1.223.0 — l'aperçu d'un document : la feuille elle-même, telle que le PDF la sortira (la maquette de la
  // paie, « l'aperçu est le document lui-même »). `poserApercu` met la page A4 à la largeur du cadre.
  // (1.249.0) `o.zoom` : « page » montre la page A4 entière dans le cadre (largeur ET hauteur), « largeur » la pose à la
  // largeur du cadre (on défile pour lire le bas).
  function poserApercu(cadre, html, o = {}) {
    if (!cadre) return;
    let f = $('iframe', cadre);
    if (!f) { f = document.createElement('iframe'); f.title = 'Aperçu du document'; f.setAttribute('tabindex', '-1'); cadre.appendChild(f); }
    // (1.258.0) Un document en paysage (le journal de paie : `@page { size: A4 landscape }`) se pose en paysage : posé en
    // portrait, son tableau débordait de la page.
    const paysage = /size:\s*A4\s+landscape/i.test(String(html).slice(0, 4000));
    const W = paysage ? 1123 : 794, H = paysage ? 794 : 1123;
    f.style.width = `${W}px`; f.style.height = `${H}px`;
    const kL = (cadre.clientWidth - 24) / W, kH = (cadre.clientHeight - 24) / H;
    const k = Math.min(1, Math.max(0.3, o.zoom === 'page' && kH > 0.2 ? Math.min(kL, kH) : kL));
    cadre.classList.toggle('pa-apercu-page', o.zoom === 'page');
    f.style.transform = `scale(${k})`;
    f.style.marginBottom = `${-Math.round(H * (1 - k))}px`;
    f.style.marginRight = `${-Math.round(W * (1 - k))}px`;
    f.srcdoc = html;
  }
  // (1.249.0) La vue d'un document : à gauche ce qu'il faut savoir et les gestes (`o.gestes` : [{ id, label, run }]), à droite la
  // page A4 entière (ou à sa largeur).
  // (1.258.0, la maquette O18/O19) À gauche aussi, quand on les donne : « Pour » (`o.pour` : { liste: [{ id, name }], id,
  // choisir }), les autres documents du même endroit (`o.docs` : [{ label, sous, actif, run }]), « Prêt » (`o.pret`, du
  // HTML) ; au pied, « Imprimer » (la fenêtre d'impression du navigateur) et les gestes du pied (`o.pied` : [{ id, label, run }]).
  function apercuDocument(o) {
    const pour = o.pour && o.pour.liste.length > 1 ? `<div class="hf-pour" role="group" aria-label="Pour quel salarié"><span class="small muted">Pour</span>${o.pour.liste.map(x => `<button type="button" class="pa-av hf-pour-b" data-ad-pour="${h(x.id)}" aria-pressed="${x.id === o.pour.id}" title="${h(x.name)}" style="--c:${h(C.couleurDe(x.name || ''))}">${h(C.initialesDe(x.name || ''))}</button>`).join('')}</div>` : '';
    const docs = (o.docs || []).length ? `<div class="ad-docs" aria-label="Les documents">${o.docs.map((d, i) => `<button type="button" class="ad-doc${d.actif ? ' on' : ''}" data-ad-doc="${i}"${d.actif ? ' aria-current="true"' : ''}><b>${h(d.label)}</b>${d.sous ? `<small>${h(d.sous)}</small>` : ''}</button>`).join('')}</div>` : '';
    modal(`<h2>${h(o.titre)}</h2><p class="small muted pa-doc-sous">l'aperçu est le document lui-même, au format A4 : ce que tu vois est ce qui sortira en PDF</p>
      <div class="pa-doc-c hf-c"><div class="pa-doc-g">${pour}${docs}${o.pret ? `<div class="hf-pret" id="ad-pret">${o.pret}</div>` : ''}${o.cote || ''}${(o.gestes || []).length ? `<div class="ad-gestes">${o.gestes.map(g => `<button type="button" class="btn" id="${g.id}">${g.label}</button>`).join('')}</div>` : ''}</div>
      <div class="hf-droite"><div class="hf-zoom" role="group" aria-label="Taille de l'aperçu"><span class="small muted">Aperçu A4</span><button type="button" class="btn btn-sm" data-ad-zoom="page" aria-pressed="true">Page entière</button><button type="button" class="btn btn-sm" data-ad-zoom="largeur" aria-pressed="false">Pleine largeur</button></div>
      <div class="pa-apercu hf-apercu" id="ad-apercu"></div></div></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Fermer</button>${(o.pied || []).map(g => `<button type="button" class="btn" id="${g.id}">${g.label}</button>`).join('')}${o.imprimer ? `<button type="button" class="btn" id="ad-imprimer">${lfIc('pages', 15)} Imprimer</button>` : ''}<button type="button" class="btn btn-primary" id="ad-pdf">${lfIc('exporter', 15)} Exporter en PDF</button></div>`, (root, close) => {
      let zoom = 'page';
      const poser = () => poserApercu($('#ad-apercu', root), o.html, { zoom });
      requestAnimationFrame(poser);
      $$('[data-ad-zoom]', root).forEach(b => b.onclick = () => { zoom = b.dataset.adZoom; $$('[data-ad-zoom]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); poser(); });
      (o.gestes || []).concat(o.pied || []).forEach(g => { $(`#${g.id}`, root).onclick = () => { close(); g.run(); }; });
      $$('[data-ad-pour]', root).forEach(b => b.onclick = () => { if (b.dataset.adPour === o.pour.id) return; close(); o.pour.choisir(b.dataset.adPour); });
      $$('[data-ad-doc]', root).forEach(b => b.onclick = () => { const d = o.docs[Number(b.dataset.adDoc)]; if (!d || d.actif) return; close(); d.run(); });
      if ($('#ad-imprimer', root)) $('#ad-imprimer', root).onclick = () => {
        const w = window.open('', '_blank');
        if (!w) { toast('Ton navigateur a bloqué la fenêtre d\'impression : autorise les fenêtres de ce site, puis recommence.', true); return; }
        w.document.write(o.html); w.document.close(); w.focus(); w.print();
      };
      $('#ad-pdf', root).onclick = async () => {
        try {
          const f = await bridge.exportPdf(o.html, o.fichier);
          if (f) toast('PDF enregistré : ' + f.split(/[\\/]/).pop());
        } catch (e) { toast(e.message || 'Export impossible', true); }
      };
    }, null, { classe: 'pa-doc' });
  }
  // (1.249.0) Cliquer un bulletin l'ouvre ICI, en lecture (Skander, 02/11 : un clic ouvrait le formulaire, même payé) : ce qu'il
  // dit, la page elle-même, et les gestes qui lui vont — le modifier tant qu'il n'est pas payé, le régulariser sinon.
  // (1.256.0) Le bulletin « en grand » de la maquette : qui paie, qui est payé, la période, ce qu'il gagne, ce qui est retenu,
  // ce que paie l'entreprise, depuis janvier ; « Le document » ouvre l'A4 (l'aperçu fidèle, puis le PDF).
  function apercuBulletin(slip, done) {
    const emp = employeeById(slip.employeeId) || {}, v = C.payslipsOf(data, slip.year, slip.month).find(x => x.id === slip.id) || slip;
    const cur = company().currency, c = v.c || slip.computed || {}, co = company(), st = C.payrollSettings(data);
    const f = n => C.money(Number(n) || 0, ''), pc = n => String(C.round3(Number(n) || 0)).replace('.', ',');
    const y = Number(slip.year), m = Number(slip.month), mo = MONTHS_LONG[m - 1];
    const fin = C.addDays(`${y}-${String(m).padStart(2, '0')}-01`, C.daysInMonth(y, m) - 1);
    const l = (t, val, sous, cl) => `<tr${cl ? ` class="${cl}"` : ''}><td>${t}${sous ? `<small>${sous}</small>` : ''}</td><td class="r">${val}</td></tr>`;
    const statut = v.valideLe ? `<span class="statut ok">validé par ton cabinet</span>` : v.paidDate ? `<span class="statut ok">payé le ${C.fmtDate(v.paidDate)}</span>` : correctionEnAttenteB(v) ? '<span class="statut alerte">à corriger</span>' : '<span class="statut">établi</span>';
    const sit = `${emp.headOfFamily ? 'chef de famille' : 'pas chef de famille'}${Number(emp.children) ? ` · ${pl(Number(emp.children), 'enfant')}` : ''}`;
    const base = Number(c.baseGross) || 0, total = Number(st.workedDays) || 26;
    const ytd = (data.payslips || []).filter(p => p.employeeId === slip.employeeId && Number(p.year) === y && Number(p.month) <= m)
      .reduce((a, p) => { const k = p.computed || {}; return { n: a.n + 1, gross: C.round3(a.gross + (k.gross || 0)), ret: C.round3(a.ret + (k.cnssEmployee || 0) + (k.irpp || 0) + (k.css || 0)), net: C.round3(a.net + (k.net || 0)) }; }, { n: 0, gross: 0, ret: 0, net: 0 });
    const cg = (() => { try { return C.leaveBalance(data, slip.employeeId, y); } catch (_) { return null; } })();
    const mode = (v.method || emp.method) === 'especes' ? 'espèces, contre reçu' : `virement${emp.iban ? `, ··· ${h(String(emp.iban).replace(/\s/g, '').slice(-4))}` : ''}`;
    const gestes = [];
    if (!v.paidDate && !v.valideLe) gestes.push(`<button type="button" class="btn" id="bg-mod">${lfIc('modifier', 15)} Modifier ses lignes…</button>`);
    if (v.paidDate) gestes.push(`<button type="button" class="btn" id="bg-reg" title="Un bulletin payé ne change plus : ce qui manquait se met sur un mois suivant">Régulariser…</button>`);
    modal(`<h2>${h(emp.name || v.employeeName || '')} · bulletin ${/^[aeiouyéè]/i.test(mo) ? 'd\'' : 'de '}${h(mo)} ${y} ${statut}</h2>
      <div class="bul-t"><div><b>${h(co.name || '')}</b><span>${co.matricule ? `MF ${h(co.matricule)}` : 'matricule fiscal : celui de ta fiche'}${co.cnss ? ` · CNSS employeur ${h(co.cnss)}` : ''}</span><span>accident du travail : ${pc((c.rates || {}).accidentRate)} % (le taux de ton dossier)</span></div>
        <div><b>${h(emp.name || '')}</b><span>${h(emp.position || 'poste à saisir')}${emp.categorie ? ` · ${h(emp.categorie)}` : ''}</span><span>${emp.cin ? `CIN ${h(emp.cin)}` : 'CIN à saisir'} · n° CNSS ${emp.cnss ? h(emp.cnss) : '<b class="ambre">à demander</b>'}</span><span>${h(String(C.contractLabel(emp.contract || 'cdi')).split(' —')[0])}${emp.hireDate ? ` · depuis ${C.fmtDate(emp.hireDate)}` : ''} · ${h(sit)}</span></div>
        <div><span>Période</span><b>du 01/${String(m).padStart(2, '0')} au ${C.fmtDate(fin)} · ${pct(Number(v.workedDays) || Number(c.workedDays) || 0)} jours payés sur ${total}</b></div><div><span>${v.paidDate ? 'Payé le' : 'Paiement'}</span><b>${v.paidDate ? `${C.fmtDate(v.paidDate)} · ` : 'pas encore payé · '}${mode}</b></div></div>
      <div class="bul-2"><table class="mini lu"><thead><tr><th>Ce qu'il gagne</th><th class="r"></th></tr></thead><tbody>${l('Salaire de base', f(base), Number(c.absenceCut) ? `${f(C.round3(base + Number(c.absenceCut)))} moins ${pct(Number(c.absentDays) || 0)} jour(s) sans solde` : '')}${(c.bonuses || []).map(b => l(h(b.label || 'Prime'), f(b.amount), b.taxable === false ? 'non imposable' : '')).join('')}</tbody><tfoot><tr><td>Brut</td><td class="r">${f(c.gross)}</td></tr></tfoot></table>
        <table class="mini lu"><thead><tr><th>Ce qui est retenu</th><th class="r"></th></tr></thead><tbody>${l('CNSS, sa part', `− ${f(c.cnssEmployee)}`, `${pc((c.rates || {}).cnssEmployee)} % du brut (À VÉRIFIER)`)}${l('<i>Salaire imposable</i>', `<i>${f(c.afterCnss)}</i>`, 'brut moins CNSS ; frais professionnels et déductions de famille appliqués par le barème')}${l('Impôt sur le revenu (IRPP)', `− ${f(c.irpp)}`, `barème de l'année · ${h(sit)}`)}${Number(c.css) ? l('Contribution sociale de solidarité', `− ${f(c.css)}`, `${pc((c.rates || {}).solidarity)} %`) : c.cssFinie ? l('Contribution sociale de solidarité', f(0), `non retenue : sa règle s'arrête le ${C.fmtDate(c.cssFinie)}`) : ''}${(c.deductions || []).map(d => l(h(d.label || 'Retenue'), `− ${f(d.amount)}`)).join('')}</tbody><tfoot><tr><td>Net à verser</td><td class="r">${montantU(Number(c.net) || 0, cur)}</td></tr></tfoot></table></div>
      <div class="bul-2"><table class="mini lu"><thead><tr><th>Ce que paie l'entreprise</th><th class="r"></th></tr></thead><tbody>${l('CNSS, sa part', f(c.cnssEmployer), `${pc((c.rates || {}).cnssEmployer)} % du brut (À VÉRIFIER)`)}${l('Accident du travail', f(c.accident), `${pc((c.rates || {}).accidentRate)} %`)}${l('TFP · FOPROLOS', f(C.round3((Number(c.tfp) || 0) + (Number(c.foprolos) || 0))), `${pc((c.rates || {}).tfpRate)} % · ${pc((c.rates || {}).foprolosRate)} %`)}</tbody><tfoot><tr><td>Coût total</td><td class="r">${montantU(Number(c.employerCost) || 0, cur)}</td></tr></tfoot></table>
        <table class="mini lu"><thead><tr><th>Depuis janvier</th><th class="r"></th></tr></thead><tbody>${l('Brut', f(ytd.gross), pl(ytd.n, 'mois', 'mois'))}${l('CNSS et impôt retenus', f(ytd.ret))}${l('Net versé', f(ytd.net))}${cg ? l('Congés', `${pct(cg.remaining)} j restants`, `${pct(cg.acquired)} acquis, ${pct(cg.taken)} pris`) : ''}</tbody></table></div>
      <p class="regle">${lfIc('coche', 13, 2.4)} Calculé avec les taux de tes réglages et le pointage du mois. À garder sans limite de durée ; les mentions obligatoires du bulletin : À VÉRIFIER avec ton comptable.</p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Fermer</button><button type="button" class="btn" id="bg-doc">${lfIc('oeil', 15)} Le document</button>${gestes.join('')}</div>`, (root, fermer) => {
      $('#bg-doc', root).onclick = () => documentBulletin(slip, done);
      if ($('#bg-mod', root)) $('#bg-mod', root).onclick = () => { fermer(); payslipForm(payslipById(slip.id) || slip, emp, slip.year, slip.month, done); };
      if ($('#bg-reg', root)) $('#bg-reg', root).onclick = () => { fermer(); regularisationFenetre(payslipById(slip.id) || slip, done); };
    }, null, { classe: 'pa-bul' });
  }
  function correctionEnAttenteB(x) { return !!(x && x.correction && !x.correction.reponse && !x.paidDate); }
  // L'A4 du bulletin (« Le document ») : l'aperçu fidèle, puis le PDF.
  function documentBulletin(slip, done) {
    const emp = employeeById(slip.employeeId) || {}, v = C.payslipsOf(data, slip.year, slip.month).find(x => x.id === slip.id) || slip;
    const safe = s2 => String(s2).replace(/[^\w\-àâäéèêëïîôöùûüç ]/gi, '').trim().replace(/\s+/g, '_');
    const cur = company().currency, c = v.c || slip.computed || {};
    const ligne = (t, m, cls) => `<div class="vat-line${cls ? ' ' + cls : ''}"><span>${t}</span><span class="num">${C.money(Number(m) || 0, cur)}</span></div>`;
    const brut = Number(c.gross) || 0, net = Number(c.net) || 0;
    const gestes = [];
    if (!v.paidDate && !v.valideLe) gestes.push({ id: 'ad-mod', label: `${lfIc('modifier', 15)} Modifier le bulletin`, run: () => payslipForm(payslipById(slip.id) || slip, emp, slip.year, slip.month, done) });
    if (v.paidDate) gestes.push({ id: 'ad-reg', label: 'Régulariser…', run: () => regularisationFenetre(payslipById(slip.id) || slip, done) });
    // (1.258.0, la maquette O18) « Pour » : le bulletin du même mois d'un autre salarié ; les documents du salarié à côté de
    // son bulletin (chacun ouvre sa fenêtre) ; « Prêt » dit d'où viennent les montants ; « Le remettre » quand il est payé.
    const prenom = String(emp.name || '').split(' ')[0] || emp.name || '';
    const duMois = C.payslipsOf(data, slip.year, slip.month).slice().sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'fr'));
    const hr = (k, sous) => ({ label: C.hrDocLabel(k), sous, run: () => hrDocForm(emp, done, k) });
    const pied = v.paidDate && !v.remisLe ? [{ id: 'ad-remettre', label: `${lfIc('envoi', 15)} Le remettre à ${h(prenom)}`, run: async () => {
      const b = payslipById(slip.id); if (!b) return;
      b.remisLe = C.today(); save(true); if (done) done();
      await exportPayslip(b);
      toastUndo(`Bulletin remis à ${prenom} aujourd'hui`, () => { const x = payslipById(slip.id); if (x) delete x.remisLe; save(true); if (done) done(); });
    } }] : [];
    apercuDocument({ titre: `${emp.name || 'Bulletin'} · bulletin de ${MONTHS_LONG[slip.month - 1]} ${slip.year}`, html: C.payslipHtml(slip, data, company(), {}),
      fichier: `Bulletin_${safe(emp.name)}_${slip.year}-${String(slip.month).padStart(2, '0')}.pdf`, gestes, pied, imprimer: true,
      pour: { liste: duMois.map(x => ({ id: x.id, name: x.employeeName || '' })), id: slip.id, choisir: id => { const x = payslipById(id); if (x) documentBulletin(x, done); } },
      docs: [{ label: 'Bulletin de paie', actif: true }, hr('attestation'), hr('salaire'), hr('annuelle'),
        hr('contrat', 'pour une arrivée'), hr('avenant', 'quand quelque chose change, ou un CDD qu\'on renouvelle'), hr('essai', 'pendant une période d\'essai'), hr('certificat', 'au départ'), hr('solde', 'au départ')],
      pret: `<b>Prêt</b><span>les montants viennent du bulletin ; il ne se modifie pas ici</span><span>${h(MONTHS_LONG[slip.month - 1])} ${slip.year}${v.issuedAt ? `, établi le ${h(C.fmtDate(v.issuedAt))}` : ''}${v.remisLe ? `, remis le ${h(C.fmtDate(v.remisLe))}` : ''} · rangé dans les documents de ${h(prenom)}</span>`,
      cote: `<div class="bf-resume ad-resume"><span class="bf-net"><small>Net ${v.paidDate ? 'versé' : 'à payer'}</small><b>${C.money(net, cur)}</b></span><span><small>Brut</small><b>${C.money(brut, cur)}</b></span><span><small>Coût pour l'entreprise</small><b>${C.money(Number(c.employerCost) || 0, cur)}</b></span></div>
        <div class="vat-box">${ligne('Salaire brut', brut)}${ligne('− CNSS salarié', c.cnssEmployee, 'minus')}${ligne('− Impôt sur le revenu', c.irpp, 'minus')}${c.css ? ligne('− Solidarité', c.css, 'minus') : ''}${c.otherDeductions ? ligne('− Autres retenues', c.otherDeductions, 'minus') : ''}${ligne('Net', net, 'total ok')}</div>
        <div class="pa-doc-i"><b>${v.paidDate ? 'Payé' : 'Établi'}</b><span>${v.paidDate ? `le ${C.fmtDate(v.paidDate)}` : 'pas encore payé'}${v.remisLe ? ` · remis le ${C.fmtDate(v.remisLe)}` : ''}${v.valideLe ? ` · validé par ton cabinet le ${C.fmtDate(v.valideLe)}` : ''}</span></div>
        <div class="pa-doc-i"><b>À VÉRIFIER</b><span>les mentions obligatoires du bulletin, avec ton comptable. À garder sans limite de durée.</span></div>` });
  }

  async function exportPayslip(slip) {
    const emp = employeeById(slip.employeeId) || {};
    const html = C.payslipHtml(slip, data, company(), {});
    const safe = s2 => String(s2).replace(/[^\w\-àâäéèêëïîôöùûüç ]/gi, '').trim().replace(/\s+/g, '_');
    const name = `Bulletin_${safe(emp.name)}_${slip.year}-${String(slip.month).padStart(2, '0')}.pdf`;
    try {
      const f = await bridge.exportPdf(html, name);
      if (f) toast('PDF enregistré : ' + f.split(/[\\/]/).pop());
    } catch (e) { toast(e.message || 'Export impossible', true); }
  }

  // On ouvre sur le MOIS ÉCOULÉ, pas sur le mois en cours : c'est celui dont les bulletins sont à
  // établir, et c'est lui que le panneau « À faire » réclame.
  const lastMonth = C.addMonths(C.today().slice(0, 7) + '-01', -1, 1);
  // ---------- congés, absences, avances et documents (5.1.0) ----------
  // 10.12.0 — la fenêtre annonçait le solde AVANT la demande (« 0 jour »), jamais celui d'après :
  // on découvrait « −3 » en rouge dans les compteurs, une fois l'absence enregistrée. Un
  // avertissement se lit avant le geste (9.4.2). Et quand on modifie une absence déjà comptée, le
  // solde du moteur l'inclut déjà : « avant » la lui rend, sinon elle serait retranchée deux fois.
  function soldeApresConge(restant, jours, deja, v) {
    const dejaCompte = deja && deja.kind === 'conges' && (deja.from || '').slice(0, 4) === (v.from || '').slice(0, 4)
      ? C.workingDays(deja.from, deja.to, C.payrollSettings(data).offDays) : 0;
    const avant = restant + dejaCompte, apres = avant - jours;
    const j = n => `${pct(n)} jour${sPl(n)}`;
    // (1.257.0) Le solde en petit tableau, comme la maquette : avant, ce congé, après.
    return `</span><table class="mini lu lf-solde" id="lf-solde" aria-label="Solde de congés"><tbody>
        <tr><td>Son solde avant</td><td class="r">${j(avant)}</td></tr><tr><td>Ce congé</td><td class="r">− ${j(jours)}</td></tr>
        <tr><td><b>Son solde après</b></td><td class="r"><b class="${apres < 0 ? 'warn-text' : ''}">${j(apres)}</b></td></tr></tbody></table><span class="small">`
      + (apres < 0 ? `<span class="warn-text">Il prendrait ${j(-apres)} de plus qu'il n'en a acquis : ce n'est pas interdit, mais il faut le savoir.</span>` : '');
  }

  // (1.355.1) Ce que l'absence fait, en un tableau de la MÊME hauteur que le solde d'un congé : changer la nature ne fait plus
  // rapetisser la fenêtre (le bouton remontait de 82 px sous la souris), et une absence non payée dit combien elle retient.
  function effetAbsence(emp, jours, paid, v, bal) {
    const j = n => `${pct(n)} jour${sPl(n)}`;
    const t = (a, b, c) => `</span><table class="mini lu lf-solde" id="lf-solde" aria-label="Ce que l'absence change"><tbody>
        <tr><td>${a[0]}</td><td class="r">${a[1]}</td></tr><tr><td>${b[0]}</td><td class="r">${b[1]}</td></tr>
        <tr><td><b>${c[0]}</b></td><td class="r"><b>${c[1]}</b></td></tr></tbody></table><span class="small">`;
    if (!paid && emp) {
      const y = Number((v.from || C.today()).slice(0, 4)), m = Number((v.from || C.today()).slice(5, 7)), cur = company().currency;
      const brut = C.brutDuMois(emp, y, m) || Number(emp.grossSalary) || 0;
      const retenu = C.round3(brut / (Number(C.payrollSettings(data).workedDays) || 26) * jours);
      return t(['Son brut du mois', C.money(brut, cur)], [`${j(jours)} non payé${sPl(jours)}`, `− ${C.money(retenu, cur)}`], ['Son brut après', C.money(C.round3(brut - retenu), cur)]);
    }
    if (bal) return t(['Son solde de congés', j(bal.remaining)], ['Cette absence', 'n\'y touche pas'], ['Son solde après', j(bal.remaining)]);
    return '';
  }
  const libellePoser = k => (k === 'conges' ? 'Poser le congé' : k === 'maladie' ? 'Poser l\'arrêt maladie' : 'Poser l\'absence');

  function leaveForm(leave, employeeId, done, jour) {
    if (!leave && faitBloque('Créer une absence')) return;
    const emps = data.employees.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (!emps.length) return toast('Crée d\'abord la fiche d\'un salarié.', true);
    const l = leave || { id: C.uid(), employeeId: employeeId || emps[0].id, kind: 'conges',
      from: jour || C.today(), to: jour || C.today(), paid: null, note: '' };
    modal(`<h2>${leave ? 'Modifier l\'absence' : 'Un congé ou une absence'}</h2>
      <form id="lf" class="grid-2">
        <div class="field span-2 obligatoire">${lbl('Salarié', 'hr.leaveEmployee')}
          ${combo({ name: 'employeeId', value: l.employeeId, items: emps.map(e => ({ v: e.id, label: e.name, sub: e.position || '', text: e.name })), placeholder: '— Choisir —', search: 'Rechercher un salarié…' })}
        </div>
        <label class="field">${lbl('Nature', 'hr.leaveKind')}<select name="kind">${C.LEAVE_KINDS.map(([v, lab, paid]) => `<option value="${v}" ${l.kind === v ? 'selected' : ''}>${lab}${paid ? '' : ' (non payée)'}</option>`).join('')}</select></label>
        <label class="field">${lbl('Effet sur le salaire', 'hr.paid')}<select name="paid">
          <option value="">selon la nature</option><option value="1" ${l.paid === true ? 'selected' : ''}>payée</option><option value="0" ${l.paid === false ? 'selected' : ''}>non payée</option></select></label>
        ${dateFieldHtml(lbl('Du', 'hr.leaveDates'), 'from', l.from, { obligatoire: true })}
        ${dateFieldHtml(lbl('Au', 'hr.leaveDates'), 'to', l.to, { obligatoire: true })}
        <label class="field span-2">${lbl('Motif', 'hr.leaveNote')}<input type="text" name="note" value="${h(l.note || '')}" placeholder="Certificat médical, congé annuel…"></label>
        ${/* (plateforme) 1.231.0 — l'ARRÊT MALADIE a ses papiers (docs/revue-paie.md, M7) : le certificat reçu, la déclaration à
             la CNSS. Qui paie ces jours dépend de la convention : « Effet sur le salaire » le dit, rien n'est inventé. */''}
        <fieldset class="span-2 pa-maladie" id="lf-maladie" ${l.kind === 'maladie' ? '' : 'hidden'}><legend>L'arrêt maladie</legend>
          <div class="grid-2">${dateFieldHtml(lbl('Certificat médical reçu le', 'hr.certificat'), 'certificatLe', l.certificatLe || '', { clearable: true })}
          ${dateFieldHtml(lbl('Envoyé à la CNSS le', 'hr.cnssMaladie'), 'cnssLe', l.cnssLe || '', { clearable: true })}</div>
          ${/* (1.249.0) Le certificat lui-même se joint ici (Skander, 02/11 : « il manque pouvoir joindre le certificat médical ») : il
                se garde dix ans, se retrouve dans les documents du salarié, et sa date de réception se pose seule. */''}
          <div class="lf-pj" id="lf-pj"></div>
          <p class="small muted">« Payée » : l'entreprise maintient son salaire. « Non payée » : ces jours se retirent du brut, et c'est la CNSS qui l'indemnise sur le certificat. <em>À VÉRIFIER avec ton comptable : ce que prévoit ta convention collective, les jours de carence, et le délai pour transmettre le certificat à la CNSS.</em></p>
        </fieldset>
        ${/* (plateforme) 1.226.0 — une demande du salarié : écrite, elle ne compte nulle part avant d'être acceptée. */''}
        <label class="check span-2 lf-demande"><input type="checkbox" name="demande" ${l.statut === 'demande' ? 'checked' : ''}><span><b>C'est une demande du salarié, pas encore acceptée</b><small class="muted">Elle ne touche ni son solde ni son salaire avant ta réponse.</small></span></label>
        <div class="span-2 annonce-stable" id="lf-hint"></div>
      </form>
      <div class="modal-actions">
        ${leave ? '<button class="btn btn-danger" id="del-lv" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">${leave ? 'Enregistrer' : `${lfIc('coche', 15, 2.4)} ${libellePoser(l.kind)}`}</button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=employeeId]', root), { items: emps.map(e => ({ v: e.id, label: e.name, text: e.name })), placeholder: '— Choisir —' });
        const hint = () => {
          const v = formValues($('#lf', root));
          const days = C.workingDays(v.from, v.to, C.payrollSettings(data).offDays);
          const paid = v.paid === '' ? C.leaveIsPaid(v.kind) : v.paid === '1';
          const bal = v.employeeId ? C.leaveBalance(data, v.employeeId, Number((v.from || C.today()).slice(0, 4))) : null;
          $('#lf-hint', root).innerHTML = `<span class="small ${days ? 'muted' : 'warn-text'}">`
            + (days ? `<b>${pct(days)} jour${sPl(days)} ouvrable${sPl(days)}</b>, dimanches exclus. ` : 'Aucun jour ouvrable dans cette période — vérifie les dates. ')
            + (paid ? 'Payée : le salaire du mois n\'est pas réduit.' : 'Non payée : retenue sur le brut du mois.')
            + (bal && v.kind === 'conges' ? soldeApresConge(bal.remaining, days, leave, v) : days ? effetAbsence(employeeById(v.employeeId), days, paid, v, bal) : '')
            + '</span>'
            + (() => { const r = v.employeeId ? manqueEquipe(v.employeeId, v.from, v.to) : null; return r ? `<span class="small warn-text lf-min" role="status">${lfIc('alerte', 13, 2)} ${h(manqueDit(r))} Tu peux le poser quand même.</span>` : ''; })();
        };
        $('#lf', root).oninput = $('#lf', root).onchange = () => {
          const k = formValues($('#lf', root)).kind;
          $('#lf-maladie', root).hidden = k !== 'maladie';
          if (!leave) $('#ok', root).innerHTML = `${lfIc('coche', 15, 2.4)} ${libellePoser(k)}`;
          hint();
        }; hint();
        const pjL = deepCopy(l.attachments || []);
        const dessinerPj = () => {
          $('#lf-pj', root).innerHTML = `${pjL.map(a => `<span class="lf-pj-f">${lfIc('piece', 14)}<b>${h(a.name || a.file)}</b><button type="button" class="btn btn-ghost btn-sm" data-lf-voir="${h(a.file)}">Ouvrir</button><button type="button" class="btn btn-ghost btn-sm" data-lf-x="${h(a.file)}" aria-label="Retirer ${h(a.name || a.file)}">✕</button></span>`).join('')}
            <button type="button" class="btn btn-sm" id="lf-pj-add">${lfIc('depot', 15)} ${pjL.length ? 'Joindre un autre fichier' : 'Joindre le certificat (photo ou PDF)'}</button>`;
          $('#lf-pj-add', root).onclick = async () => {
            try { const added = await bridge.addAttachments(l.id); if (added && added.length) { pjL.push(...added); dessinerPj(); } } catch (err) { toast(plainError(err), true); }
          };
          $$('[data-lf-voir]', root).forEach(b => b.onclick = () => { const a = pjL.find(x => x.file === b.dataset.lfVoir); if (a) ouvrirJustificatif(l.id, a, {}); });
          $$('[data-lf-x]', root).forEach(b => b.onclick = () => { const i = pjL.findIndex(x => x.file === b.dataset.lfX); if (i >= 0) { pjL.splice(i, 1); dessinerPj(); } });
        };
        dessinerPj();
        $('#ok', root).onclick = () => {
          const v = formValues($('#lf', root));
          const champ = n => $(`#lf [name=${n}]`, root);
          if (!v.employeeId) return refus($('[data-combo=employeeId] .combo-btn', root), 'Choisis le salarié.');
          if (!v.from) return refus(champ('from'), 'Indique le premier jour de l\'absence.');
          if (!v.to) return refus(champ('to'), 'Indique le dernier jour de l\'absence.');
          if (v.to < v.from) return refus(champ('to'), `La fin ne peut pas précéder le début (${C.fmtDate(v.from)}).`);
          // (plateforme) 1.70.0 — hors du contrat du salarié, une absence ne se pose sur aucun pointage ni aucun bulletin, mais
          // entamait son compteur : refusée, avec la date qui la borne (la règle de la fenêtre du Cabinet).
          const salarieLf = employeeById(v.employeeId) || {};
          if (salarieLf.hireDate && v.from < salarieLf.hireDate) return refus(champ('from'), `L'entrée de ${salarieLf.name} est le ${C.fmtDate(salarieLf.hireDate)} : une absence ne commence pas avant.`);
          if (salarieLf.endDate && v.to > salarieLf.endDate) return refus(champ('to'), `La sortie de ${salarieLf.name} est le ${C.fmtDate(salarieLf.endDate)} : une absence ne finit pas après.`);
          if (closedBlock([l.from, l.to, v.from, v.to], 'Cette absence')) return;
          if (!leave && faitBloque('Créer une absence')) return;
          const statut = v.demande ? 'demande' : (l.statut === 'demande' ? 'accepte' : l.statut);
          delete v.demande;
          if (v.kind !== 'maladie') { delete v.certificatLe; delete v.cnssLe; delete l.certificatLe; delete l.cnssLe; }
          else { if (!v.certificatLe) { delete v.certificatLe; delete l.certificatLe; } if (!v.cnssLe) { delete v.cnssLe; delete l.cnssLe; } }
          if (v.kind === 'maladie' && pjL.length && !v.certificatLe) v.certificatLe = C.today();
          Object.assign(l, v, { paid: v.paid === '' ? null : v.paid === '1' });
          if (v.kind === 'maladie' && pjL.length) l.attachments = pjL; else delete l.attachments;
          if (statut) l.statut = statut; else delete l.statut;
          if (statut === 'demande' && !l.demandeLe) l.demandeLe = C.today();
          if (!leave) data.leaves.push(l);
          save(true); close(); if (done) done();
        };
        if ($('#del-lv', root)) $('#del-lv', root).onclick = async () => {
          if (!await confirmDialog('Supprimer cette absence ? Les bulletins déjà établis ne changeront pas.')) return;
          if (closedBlock([l.from, l.to], 'Cette absence')) return;
          forget('leaves', l.id, C.leaveKindLabel(l.kind));
          data.leaves = data.leaves.filter(x => x.id !== l.id);
          save(true); close(); if (done) done();
        };
      });
  }

  function advanceForm(advance, employeeId, done) {
    if (!advance && faitBloque('Créer une avance sur salaire')) return;
    const emps = data.employees.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (!emps.length) return toast('Crée d\'abord la fiche d\'un salarié.', true);
    const a = advance || { id: C.uid(), employeeId: employeeId || emps[0].id, date: C.today(), amount: 0, monthly: 0, note: '' };
    const cur = company().currency;
    // (1.256.0) La fenêtre de la maquette : avance ou prêt en tête (deux boutons), les champs, la règle en bas.
    modal(`<h2>${advance ? (a.kind === 'pret' ? 'Modifier le prêt' : 'Modifier l\'avance') : 'Une avance ou un prêt'}</h2>
      <div class="segment petit" role="group" aria-label="Avance ou prêt" id="af2-sorte"><button type="button" data-sorte="avance" aria-pressed="${a.kind !== 'pret'}">Avance · rendue en quelques mois</button><button type="button" data-sorte="pret" aria-pressed="${a.kind === 'pret'}">Prêt · avec son échéancier</button></div>
      <form id="af2" class="grid-2">
        <div class="field span-2 obligatoire">${lbl('Salarié', 'hr.advanceEmployee')}
          ${combo({ name: 'employeeId', value: a.employeeId, items: emps.map(e => ({ v: e.id, label: e.name, sub: e.position || '', text: e.name })), placeholder: '— Choisir —', search: 'Rechercher un salarié…' })}
        </div>
        ${/* 10.12.0 — deux « 0 » proposés d'office (un zéro posé par le logiciel n'est pas un chiffre
             décidé), la phrase d'aide en gras parce qu'elle portait la classe d'un LIBELLÉ (« field »),
             et une demi-ligne vide à côté de la retenue. Les deux montants sont obligatoires : ils
             le disent avant qu'on appuie sur Enregistrer (7.20.0). */''}
        ${dateFieldHtml(lbl('Date de l\'avance', 'hr.advanceDate'), 'date', a.date, { obligatoire: true })}
        ${field(lbl(`Montant avancé (${h(C.normCurrency(company().currency))})`, 'hr.advanceAmount'), 'amount', a.amount ? C.money(a.amount, null, 3) : '', 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num" placeholder="Ce que tu lui prêtes"').replace('class="field"', 'class="field obligatoire"')}
        ${field(lbl(`Retenue mensuelle (${h(C.normCurrency(company().currency))})`, 'hr.monthly'), 'monthly', a.monthly ? C.money(a.monthly, null, 3) : '', 'text', 'inputmode="decimal" data-montant autocomplete="off" class="num" placeholder="Retenue sur chaque bulletin"').replace('class="field"', 'class="field obligatoire"')}
        <label class="field">${lbl('Mode', 'hr.advanceMethod')}<select name="method">${C.PAYMENT_METHODS.map(m => `<option value="${m[0]}" ${(a.method || 'virement') === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>
        ${accountFieldHtml(a.accountId)}
        <label class="field">${lbl('Note', 'hr.advanceNote')}<input type="text" name="note" value="${h(a.note || '')}" placeholder="Pourquoi, et ce qui a été convenu"></label>
        ${/* (plateforme) 1.226.0 — un prêt (la maquette) : plus long qu'une avance, son échéancier commence au mois convenu. */''}
        <input type="hidden" name="kind" value="${a.kind === 'pret' ? 'pret' : 'avance'}">
        ${/* (1.248.1) Une liste de mois écrits en toutes lettres : la case « mois » du navigateur affichait « ---------- ---- »
              sur une avance neuve, qu'on prenait pour une case cassée (recette du 02/11). */''}
        <label class="field">${lbl('Première retenue')}<select name="debut" aria-label="Le mois de la première retenue">${(() => {
          const d0 = String(a.date || C.today()), y0 = Number(d0.slice(0, 4)), m0 = Number(d0.slice(5, 7));
          const mois = Array.from({ length: 13 }, (_, i) => { const t = (m0 - 1) + i; return `${y0 + Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
          if (a.debut && !mois.includes(a.debut)) mois.unshift(a.debut);
          return `<option value="" ${a.debut ? '' : 'selected'}>dès le mois où il est versé</option>` + mois.map(v => `<option value="${v}" ${a.debut === v ? 'selected' : ''}>${h(MONTHS_LONG[Number(v.slice(5, 7)) - 1])} ${v.slice(0, 4)}</option>`).join('');
        })()}</select></label>
        <div class="span-2 annonce-stable" id="af2-hint"></div>
      </form>
      ${avertValideHtml('af2-valide')}
      <p class="regle">${lfIc('aide', 13, 2)} La retenue se pose toute seule sur ses prochains bulletins, jusqu'à la dernière. Au-delà de 30 % de son net, la fenêtre le dit avant d'enregistrer (À VÉRIFIER : la limite légale). Versée par la banque ou la caisse, elle se rapproche ensuite comme un paiement.</p>
      <div class="modal-actions">
        ${advance ? '<button class="btn btn-danger" id="del-av" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">${lfIc('coche', 15, 2.4)} <span id="af2-ok">${a.kind === 'pret' ? 'Enregistrer le prêt' : 'Enregistrer l\'avance'}</span></button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=employeeId]', root), { items: emps.map(e => ({ v: e.id, label: e.name, text: e.name })), placeholder: '— Choisir —' });
        const hint = () => {
          const v = formValues($('#af2', root));
          const amt = Number(v.amount) || 0, m = Number(v.monthly) || 0;
          const emp = employeeById(v.employeeId);
          const st = C.payrollSettings(data), net = emp ? C.computePayslip(emp, C.saisieDeLaFiche(emp, st), st).net : 0;
          $('#af2-hint', root).innerHTML = !amt || !m
            ? '<span class="small muted">Saisis le montant et la retenue mensuelle pour voir la durée du remboursement.</span>'
            : `<span class="small ${m > net * 0.3 ? 'warn-text' : 'muted'}">Remboursée en <b>${Math.ceil(amt / m)} mois</b> à ${C.money(m, cur)} par bulletin.`
              + (net ? ` Le net habituel de ce salarié est de ${C.money(net, cur)} : la retenue en représente ${pct(Math.round(m / net * 1000) / 10)} %.` : '')
              + (m > net * 0.3 ? ' C\'est beaucoup — une retenue trop lourde met le salarié en difficulté et se retourne contre toi. <em>À VÉRIFIER : la loi encadre la part du salaire qui peut être saisie.</em>' : '') + '</span>';
        };
        $('#af2', root).oninput = $('#af2', root).onchange = hint; hint();
        // (1.305.0) Versée à une date de la période que le cabinet a validée : la phrase pendant la saisie. Rouverte sans rien
        // changer de ce qui s'écrit chez lui (la date, le montant, le compte, le mode), rien : la retenue ne touche que les bulletins.
        const empreinteAv = x => JSON.stringify([x.date, C.round3(Number(x.amount) || 0), x.accountId || '', x.method || 'virement']);
        // Une case que la fenêtre ne montre pas (le compte, quand il n'y en a qu'un) garde la valeur de l'avance, comme à l'enregistrement.
        const valideDeLAvance = (v, quandLu) => (!advance || empreinteAv({ ...advance, ...v }) !== empreinteAv(advance) ? dateDansLaPeriodeValidee([v.date, advance && advance.date], quandLu) : '');
        const majValideAv = () => { const v = formValues($('#af2', root)); majAvertValide($('#af2-valide', root), valideDeLAvance(v, majValideAv), v.date, { sujet: v.kind === 'pret' ? 'Ce prêt' : 'Cette avance', fem: v.kind !== 'pret', neuve: !advance, geste: 'En l\'enregistrant' }); };
        $('#af2', root).addEventListener('input', majValideAv);
        $('#af2', root).addEventListener('change', majValideAv);
        majValideAv();
        $$('#af2-sorte [data-sorte]', root).forEach(b => b.onclick = () => {
          $$('#af2-sorte [data-sorte]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          $('#af2 [name=kind]', root).value = b.dataset.sorte;
          $('#af2-ok', root).textContent = b.dataset.sorte === 'pret' ? 'Enregistrer le prêt' : 'Enregistrer l\'avance';
        });
        $('#ok', root).onclick = () => {
          const v = formValues($('#af2', root));
          const champ = n => $(`#af2 [name=${n}]`, root);
          if (!v.employeeId) return refus($('[data-combo=employeeId] .combo-btn', root), 'Choisis le salarié.');
          if (!(Number(v.amount) > 0)) return refus(champ('amount'), 'Indique le montant avancé.');
          if (!(Number(v.monthly) > 0)) return refus(champ('monthly'), 'Indique la retenue mensuelle : c\'est elle qui rembourse l\'avance, bulletin après bulletin.');
          // (plateforme) 1.71.0 — les règles de la fenêtre du Cabinet, vérifiées ici aussi. Ce qui est remboursé se lit sur les
          // bulletins du salarié : une avance déjà retenue ne change plus de salarié (elle se lirait non remboursée chez
          // l'autre), et son montant ne descend pas sous ce qui a été retenu. Après la sortie, aucun bulletin ne la retiendrait.
          const retenu = advance ? (C.advancesOf(data, a.employeeId).find(x => x.id === a.id) || { repaid: 0 }).repaid : 0;
          if (retenu && v.employeeId !== a.employeeId) return refus($('[data-combo=employeeId] .combo-btn', root), `${C.money(retenu, cur)} ont déjà été retenus sur les bulletins de ${(employeeById(a.employeeId) || {}).name || 'ce salarié'} : l'avance ne change plus de salarié.`);
          if (Number(v.amount) < retenu - 0.0005) return refus(champ('amount'), `${C.money(retenu, cur)} ont déjà été retenus sur des bulletins : le montant avancé ne descend pas en dessous.`);
          const sortie = (employeeById(v.employeeId) || {}).endDate;
          if (sortie && v.date > sortie) return refus(champ('date'), `La sortie de ${employeeById(v.employeeId).name} est le ${C.fmtDate(sortie)} : aucun bulletin ne retiendrait une avance versée après.`);
          if (closedBlock([a.date, v.date], 'Cette avance')) return;
          if (!advance && faitBloque('Créer une avance sur salaire')) return;
          // Lu AVANT de ranger : `a` est l'avance rangée elle-même quand on la modifie.
          const dvAv = valideDeLAvance(v);
          Object.assign(a, v, { amount: Number(v.amount), monthly: Number(v.monthly) });
          if (!a.debut) delete a.debut;
          if (a.kind !== 'pret') delete a.kind;
          if (!advance) data.advances.push(a);
          save(true); close();
          if (dvAv) { const pret = a.kind === 'pret'; direAuComptableApres(`${pret ? 'Prêt' : 'Avance'} ${advance ? (pret ? 'modifié' : 'modifiée') : (pret ? 'enregistré' : 'enregistrée')}`, { fait: advance ? 'de modifier' : 'd\'enregistrer', fem: !pret,
            quoi: `${pret ? 'un prêt' : 'une avance sur salaire'} versé${pret ? '' : 'e'} le ${C.fmtDate(dvAv)} à ${(employeeById(a.employeeId) || {}).name || 'un salarié'} (${C.money(a.amount, cur)})` }); }
          if (done) done();
        };
        if ($('#del-av', root)) $('#del-av', root).onclick = async () => {
          const r = C.advancesOf(data, a.employeeId).find(x => x.id === a.id);
          // (1.305.0) Versée dans la période que le cabinet a validée : la question le dit, le message après.
          await periodeValideeLue();
          const dvSup = dateDansLaPeriodeValidee([a.date]);
          if (!await confirmDialog(`Supprimer cette avance ?${r && r.repaid ? ` ${C.money(r.repaid, cur)} ont déjà été retenus sur des bulletins : ces retenues resteront sur les bulletins concernés.` : ''}${dvSup ? ` ${phraseAnnulationValidee(dvSup, { sujet: 'Elle', fem: true })}` : ''}`)) return;
          if (closedBlock(a.date, 'Cette avance')) return;
          forget('advances', a.id, C.money(a.amount, cur));
          data.advances = data.advances.filter(x => x.id !== a.id);
          save(true); close();
          if (dvSup) direAuComptableApres('Avance supprimée', { fait: 'de supprimer', fem: true, annule: true, quoi: `une avance sur salaire versée le ${C.fmtDate(dvSup)} à ${(employeeById(a.employeeId) || {}).name || 'un salarié'} (${C.money(a.amount, cur)})` });
          if (done) done();
        };
      });
  }

  // Générer un document du personnel : on montre ce qu'il contiendra avant de produire le PDF.
  // (plateforme) 1.72.0 — rouverte après une fiche renseignée (la civilité, la sortie), elle reprend le document choisi.
  // (1.248.0) Renouveler un CDD : la décision elle-même (prolonger jusqu'à une date, ou passer en CDI), puis l'avenant à
  // signer. « Renouveler son contrat… » ouvrait toute la fiche « Modifier le salarié » (recette du 02/11) : on y cherchait
  // la case, rien ne disait ce qu'un renouvellement change, et l'avenant ne venait pas.
  const MOTIFS_SORTIE = [['demission', 'Démission'], ['fin-cdd', 'Fin de CDD'], ['licenciement', 'Licenciement'], ['commun', 'Rupture d\'un commun accord'],
    ['essai', 'Fin de la période d\'essai'], ['retraite', 'Départ à la retraite'], ['autre', 'Autre motif']];
  const motifSortie = k => (MOTIFS_SORTIE.find(x => x[0] === k) || [])[1] || '';
  // (1.257.0) Ce que chaque motif demande, sous son nom (la maquette, « Un départ ») ; ce qui touche au droit : À VÉRIFIER.
  const MOTIFS_AIDE = { demission: 'sa lettre, datée ; son préavis (À VÉRIFIER : ta convention)', 'fin-cdd': 'à sa date ; rien à envoyer', licenciement: 'motif, procédure, indemnité : à préparer avec ton comptable (À VÉRIFIER)',
    commun: 'un accord écrit et signé des deux côtés (À VÉRIFIER)', essai: 'par écrit, avant la fin de l\'essai', retraite: 'la date, les démarches à la CNSS (À VÉRIFIER)', autre: 'écris-le dans la note' };
  // L'ancienneté d'un salarié à une date, en années et mois (un jour de calendrier, jamais un instant).
  const ancienneteDe = (e, iso) => {
    if (!e.hireDate || !iso || iso < e.hireDate) return '';
    const [y1, m1, d1] = e.hireDate.split('-').map(Number), [y2, m2, d2] = iso.split('-').map(Number);
    let mois = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0); if (mois < 0) mois = 0;
    const a = Math.floor(mois / 12), r = mois % 12;
    return [a ? `${a} an${a > 1 ? 's' : ''}` : '', r ? `${r} mois` : ''].filter(Boolean).join(' et ') || 'moins d\'un mois';
  };
  // (1.256.0) La fin de la période d'essai (« À traiter », quinze jours avant) : le confirmer dans son poste — la date se
  // note, le courrier « Fin de période d'essai » s'ouvre en aperçu — ou préparer sa sortie, motif « fin de période d'essai ».
  function finEssaiFenetre(e, done) {
    if (!e || !e.trialEnd) return;
    const fini = e.trialEnd < C.today();
    modal(`<h2>La période d'essai de ${h(e.name || '')}</h2>
      <p class="small muted">Entré${e.civilite === 'f' ? 'e' : ''} le ${e.hireDate ? C.fmtDate(e.hireDate) : '—'} · ${h(e.position || '')} · l'essai ${fini ? 'a fini' : 'finit'} le <b>${C.fmtDate(e.trialEnd)}</b>. À la fin de l'essai, il reste dans son poste, ou il part sans préavis (À VÉRIFIER avec ton comptable : la durée, le renouvellement, ta convention).</p>
      <div class="pa-choix" id="fe">
        <button type="button" class="pa-choix-l" id="fe-ok"><span>${lfIc('coche', 18)}</span><span><b>Le confirmer dans son poste</b><small>la date se note sur sa fiche ; le courrier de confirmation s'ouvre, prêt à signer</small></span></button>
        <button type="button" class="pa-choix-l" id="fe-sortie"><span>${lfIc('retour', 18)}</span><span><b>Préparer sa sortie</b><small>fin de la période d'essai : son dernier jour, son dernier bulletin, ses documents</small></span></button>
      </div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Plus tard</button></div>`, (root, fermer) => {
      $('#fe-ok', root).onclick = () => {
        const x = employeeById(e.id); if (!x) return fermer();
        x.essaiConfirmeLe = C.today(); save(true); fermer(); if (done) done();
        toastUndo(`${x.name} confirmé${x.civilite === 'f' ? 'e' : ''} dans son poste le ${C.fmtDate(x.essaiConfirmeLe)}`, () => { const y = employeeById(e.id); if (y) { delete y.essaiConfirmeLe; save(true); if (done) done(); } });
        hrDocForm(x, done, 'essai');
      };
      $('#fe-sortie', root).onclick = () => { fermer(); sortieFenetre(employeeById(e.id), done, { motif: 'essai', jour: e.trialEnd < C.today() ? C.today() : e.trialEnd }); };
    });
  }
  function sortieFenetre(e, done, opts) {
    if (!e) return;
    const o = opts || {};
    const jour = e.endDate || o.jour || C.today(), motif = e.sortieMotif || o.motif || (e.contract === 'cdd' && e.endDate ? 'fin-cdd' : '');
    const stS = C.payrollSettings(data), preavis = Number(stS.preavisJours) || 0;
    modal(`<h2>La sortie de ${h(e.name || '')}</h2>
      <p class="small muted">Entré le ${e.hireDate ? C.fmtDate(e.hireDate) : '— (date d\'embauche à saisir)'} · ${h(e.contract === 'cdd' ? 'CDD' : (C.contractLabel(e.contract || 'cdi') || '').split(' —')[0])}. Le dernier bulletin, le solde de tout compte et le certificat de travail se préparent ensuite dans « Son départ ».</p>
      <form id="so" class="grid-2">
        ${/* (1.257.0) Le motif en cartes, ce qu'il demande dessous (la maquette) ; obligatoire. */''}
        <div class="pa-choix span-2 so-motifs" role="radiogroup" aria-label="Le motif de la sortie">${MOTIFS_SORTIE.filter(([k]) => k !== 'fin-cdd' || e.contract === 'cdd' || motif === 'fin-cdd').map(([k, l]) => `<label class="pa-choix-l"><input type="radio" name="motif" value="${k}" ${motif === k ? 'checked' : ''}><span><b>${h(l)}</b><small>${h(MOTIFS_AIDE[k] || '')}</small></span></label>`).join('')}</div>
        ${preavis ? dateFieldHtml(lbl('Notifiée le', 'pay.notifie'), 'notifie', e.sortieNotifieeLe || '', { clearable: true }) : ''}
        ${dateFieldHtml(lbl('Dernier jour', 'pay.endDate'), 'endDate', jour, { obligatoire: true })}
        <label class="field span-2">${lbl('Note')}<input type="text" name="note" maxlength="200" value="${h(e.sortieNote || '')}" placeholder="ex. lettre de démission reçue le 28/10, préavis d'un mois"></label>
        <p class="small span-2" id="so-anc"></p>
      </form>
      <div id="so-bul"></div>
      <p class="small muted" id="so-regles">${preavis ? `Préavis de tes réglages : <b>${pct(preavis)} jours</b> ; la date de notification propose le dernier jour.` : 'Aucun préavis réglé : <button type="button" class="lien" id="so-reg">le régler</button>.'} ${Number(stS.indemniteJoursParAn) > 0 ? `Un licenciement compte ${pct(stS.indemniteJoursParAn)} jours de salaire par année d'ancienneté (tes réglages).` : 'L\'indemnité de licenciement n\'est pas réglée.'} <em>À VÉRIFIER avec ton comptable : le Code du travail et ta convention collective.</em></p>
      <p class="small warn-text" id="so-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="so-ok">${lfIc('retour', 15)} Préparer son départ</button></div>`, (root, fermer) => {
      // (1.257.0) Ce que le départ ajoute à son dernier bulletin, par le moteur des bulletins (« Son départ » fait le reste).
      const curS = company().currency;
      const bulletinDe = () => {
        const v = formValues($('#so', root)), d = v.endDate; if (!d) { $('#so-bul', root).innerHTML = ''; return; }
        const ic = C.indemniteConges(data, e.id, d);
        const il = v.motif === 'licenciement' ? C.indemniteLicenciement({ ...data, employees: data.employees.map(x => (x.id === e.id ? { ...x, sortieMotif: 'licenciement', endDate: d } : x)) }, e.id, d) : null;
        const mo = MONTHS_LONG[Number(d.slice(5, 7)) - 1];
        $('#so-bul', root).innerHTML = `<div class="sect">Ce que son départ ajoute au bulletin ${/^[aeiouyéè]/i.test(mo) ? 'd\'' : 'de '}${h(mo)}</div>
          <table class="mini lu" id="so-bul-t"><tbody>
            <tr><td>Congés pas pris : ${pct(ic.jours)} jour${ic.jours > 1 ? 's' : ''}<small class="muted"> · ${C.money(ic.journalier, curS)} par jour (le calcul au jour ou au dixième : À VÉRIFIER)</small></td><td class="r">${C.money(ic.montant, curS)}</td></tr>
            ${il ? `<tr><td>${h(il.label)}</td><td class="r">${il.jpa > 0 ? C.money(il.montant, curS) : '<span class="muted">non réglée</span>'}</td></tr>` : ''}
          </tbody></table>
          <p class="small muted">Son salaire du mois, au prorata de ses jours, vient du bulletin lui-même, avec ses primes et ses retenues.</p>`;
      };
      const anc = () => { const d = formValues($('#so', root)).endDate; $('#so-anc', root).textContent = d && e.hireDate ? `Ancienneté au dernier jour : ${ancienneteDe(e, d)}.` : ''; bulletinDe(); };
      let notifAvant = (formValues($('#so', root)).notifie || '');
      $('#so', root).oninput = $('#so', root).onchange = () => {
        const n = formValues($('#so', root)).notifie || '';
        if (preavis && n && n !== notifAvant) poserDateField($('#so', root), 'endDate', C.addDays(n, preavis));
        notifAvant = n; anc();
      };
      anc();
      if ($('#so-reg', root)) $('#so-reg', root).onclick = () => { fermer(); paieState.tab = 'baremes'; if (location.hash === '#/paie') render(); else location.hash = '#/paie'; };
      $('#so-ok', root).onclick = () => {
        const v = formValues($('#so', root)), refus = (t, el) => { const r = $('#so-refus', root); r.hidden = false; r.textContent = t; if (el) el.focus(); };
        if (!v.endDate) return refus('Le dernier jour manque : la date de sortie.', $('[name=endDate]', root));
        if (e.hireDate && v.endDate < e.hireDate) return refus(`Le dernier jour est avant son embauche (${C.fmtDate(e.hireDate)}).`, $('[name=endDate]', root));
        if (!v.motif) return refus('Le motif manque : choisis-le dans les cartes ci-dessus.', $('[name=motif]', root));
        const x = employeeById(e.id); if (!x) return fermer();
        const avant = { endDate: x.endDate, sortieMotif: x.sortieMotif, sortieNote: x.sortieNote, sortieNotifieeLe: x.sortieNotifieeLe };
        x.endDate = v.endDate; x.sortieMotif = v.motif; x.sortieNote = String(v.note || '').trim();
        if (v.notifie) x.sortieNotifieeLe = v.notifie; else delete x.sortieNotifieeLe;
        save(true); fermer(); if (done) done();
        toastUndo(`Sortie de ${x.name} notée au ${C.fmtDate(v.endDate)} : ${motifSortie(v.motif).toLowerCase()}`, () => { const y = employeeById(e.id); if (y) { Object.assign(y, avant); save(true); if (done) done(); } });
      };
    });
  }
  function renouvelerCdd(e, done) {
    if (!e || e.contract !== 'cdd') return;
    const cur = company().currency;
    const fin = e.endDate || C.today();
    const propose = C.addMonths(fin, 12);
    const actuel = C.round3(C.brutDuMois(e, Number(fin.slice(0, 4)), Number(fin.slice(5, 7))) || Number(e.grossSalary) || 0);
    const n = (e.renouvellements || []).filter(r => !r.cdi).length + 1;
    // (1.257) La fenêtre de la maquette (O15) : la fin actuelle et la nouvelle, le salaire (une hausse va dans le même
    // avenant), le jour où le lui dire, ses CDD bout à bout et le motif ; le choix « Passer en CDI » de l'application reste.
    const duree = (de, a) => {
      if (!de || !a) return '';
      // Le dernier jour compte : du 01/07/2025 au 31/12/2027, c'est jusqu'au 01/01/2028 exclu, 2 ans 6 mois.
      const [y1, m1, d1] = de.split('-').map(Number), [y2, m2, d2] = C.addDays(a, 1).split('-').map(Number);
      let mo = (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 ? 0 : -1); if (mo < 0) mo = 0;
      const an = Math.floor(mo / 12), r = mo % 12;
      return [an ? `${an} an${an > 1 ? 's' : ''}` : '', r ? `${r} mois` : ''].filter(Boolean).join(' ') || 'moins d\'un mois';
    };
    modal(`<h2 id="rc-t">Renouveler le CDD de ${h(e.name || '')}</h2>
      <form id="rc">
        <div class="pa-choix rc-suite">
          <label class="pa-choix-l"><input type="radio" name="suite" value="cdd" checked> <span><b>Prolonger le CDD</b><small>une nouvelle date de fin</small></span></label>
          <label class="pa-choix-l"><input type="radio" name="suite" value="cdi"> <span><b>Passer en CDI</b><small>dès le ${C.fmtDate(C.addDays(fin, 1))}, sans date de fin</small></span></label>
        </div>
        <div class="grid-2 rc-g">
          <label class="field">Fin actuelle<input type="text" value="${C.fmtDate(fin)}" readonly tabindex="-1"></label>
          <div id="rc-date">${dateFieldHtml(lbl('Nouvelle fin', 'emp.end'), 'endDate', propose, {})}</div>
          <label class="field">${lbl(`Salaire de base (${h(C.normCurrency(cur))})`, 'pay.gross')}<small class="muted rc-aide">inchangé ; une hausse se met dans le même avenant</small><input type="text" inputmode="decimal" data-montant autocomplete="off" name="brut" value="${h(C.money(actuel, null, 3))}" class="num"></label>
          <div>${dateFieldHtml(`Le lui dire avant le <small class="muted rc-aide">délai de prévenance : À VÉRIFIER</small>`, 'prevenir', C.addMonths(fin, -1) < C.today() ? C.today() : C.addMonths(fin, -1), {})}</div>
        </div>
        <table class="mini lu rc-t">
          <tr><td>Ses CDD, bout à bout<small id="rc-bout-d"></small></td><td class="num"><b id="rc-bout"></b></td></tr>
          <tr><td>La durée maximale, renouvellements compris<small>au-delà, le contrat peut devenir un CDI</small></td><td class="num muted">À VÉRIFIER</td></tr>
          <tr><td>Le motif du CDD<small>les cas permis : À VÉRIFIER</small></td><td><input type="text" name="motif" maxlength="80" placeholder="surcroît d'activité, remplacement…" value="${h(e.cddMotif || '')}"></td></tr>
        </table>
      </form>
      <p class="small warn-text mt" id="rc-long" role="status" aria-live="polite" hidden></p>
      <p class="regle small" id="rc-regle"></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="rc-ok">${lfIc('pages', 15)}<span>Préparer l'avenant n° ${n}</span></button></div>`,
    (root, close) => {
      const suite = () => ($('[name=suite]:checked', root) || {}).value;
      const brutLu = () => C.round3(Number(formValues($('#rc', root)).brut) || 0);
      const maj = () => {
        const v = formValues($('#rc', root)), cdd = suite() === 'cdd', d = cdd ? v.endDate : '';
        $('#rc-date', root).style.visibility = cdd ? '' : 'hidden';
        $('#rc-bout', root).textContent = cdd ? duree(e.hireDate, d) : duree(e.hireDate, fin);
        $('#rc-bout-d', root).textContent = e.hireDate ? `du ${C.fmtDate(e.hireDate)} au ${C.fmtDate(cdd ? d : fin)}${cdd ? '' : ', puis le CDI'}` : 'sa date d\'entrée manque sur sa fiche';
        const hausse = brutLu() && brutLu() !== actuel;
        $('#rc-regle', root).innerHTML = `${lfIc('aide', 13, 2)} ${cdd ? `L'avenant n° ${n}` : 'L\'avenant qui le passe en CDI'} se prépare ensuite, à signer par vous deux, et se range dans ses documents${hausse ? ` ; il dit aussi son nouveau salaire, ${h(C.money(brutLu(), cur))} dès ${h(MONTHS_LONG[Number(C.addDays(fin, 1).slice(5, 7)) - 1])}` : ''}. Sa fiche prend la nouvelle ${cdd ? 'date' : 'situation'} dès maintenant.`;
        $('#rc-ok span', root).textContent = cdd ? `Préparer l'avenant n° ${n}` : 'Passer en CDI, préparer l\'avenant';
        // (1.248.1) Un CDD qui dépasserait quatre ans au total se dit avant le geste (la limite : À VÉRIFIER).
        const el = $('#rc-long', root), an = e.hireDate && d ? (Date.parse(d) - Date.parse(e.hireDate)) / (365.25 * 864e5) : 0;
        el.hidden = !(cdd && an > 4);
        el.textContent = el.hidden ? '' : `Avec cette date, ${e.name} serait en CDD depuis ${String(Math.floor(an * 10) / 10).replace('.', ',')} ans : au-delà de quatre ans, le contrat pourrait devoir passer en CDI (À VÉRIFIER avec ton comptable).`;
      };
      $('#rc', root).oninput = $('#rc', root).onchange = maj; maj();
      $('#rc-ok', root).onclick = () => {
        const x = employeeById(e.id); if (!x) return close();
        const v = formValues($('#rc', root)), brut = brutLu();
        const avant = deepCopy(x), avantBul = deepCopy((data.payslips || []).filter(p => p.employeeId === x.id));
        if (!(brut > 0)) { toast('Le salaire de base manque.', true); const f = $('[name=brut]', root); if (f) f.focus(); return; }
        if (suite() === 'cdd') {
          const d = v.endDate;
          if (!d || d <= fin) { const f = $('[name=endDate]', root); toast(`La nouvelle date de fin doit venir après le ${C.fmtDate(fin)}.`, true); if (f) f.focus(); return; }
          x.endDate = d;
        } else { x.contract = 'cdi'; x.endDate = ''; }
        x.cddMotif = String(v.motif || '').trim().slice(0, 80) || x.cddMotif || '';
        // Une hausse dans le même avenant : le nouveau salaire vaut dès le mois qui suit l'ancienne fin.
        const des = C.addDays(fin, 1).slice(0, 7);
        if (brut !== actuel) {
          const H = (Array.isArray(x.salaires) ? x.salaires : []).filter(z => z.des !== des);
          H.push({ des, brut, avant: actuel, le: C.today() });
          x.salaires = H.sort((a, b) => a.des.localeCompare(b.des));
          x.grossSalary = C.brutDuMois(x, 9999, 12);
        }
        // (1.248.1) Le renouvellement laisse sa trace sur la fiche : l'historique la montre (recette du 02/11 : rien ne
        // disait qu'un CDD avait été prolongé).
        x.renouvellements = (x.renouvellements || []).concat([{ le: C.today(), ancienneFin: fin, ...(v.prevenir ? { prevenirLe: v.prevenir } : {}), ...(brut !== actuel ? { brut } : {}), ...(x.contract === 'cdi' ? { cdi: true } : { nouvelleFin: x.endDate }) }]);
        // Le bulletin du mois de l'ancienne fin, établi au prorata de la sortie : pas encore payé, il se refait au mois
        // complet (ses primes et retenues gardées) ; payé, il se régularise (recette du 02/11 : il restait à 18 j sur 26).
        const ymFin = fin.slice(0, 7);
        const touche = (data.payslips || []).filter(p => p.employeeId === x.id && ymDe(p.year, p.month) === ymFin && p.prorata);
        let refait = '', paye = '', clos = '';
        touche.forEach(p => {
          if (p.paidDate || p.valideLe) { paye = MONTHS_LONG[Number(p.month) - 1]; return; }
          // (16 § 10.1, point 7) Dans une période clôturée, il ne se refait pas (le serveur le refuse) : il se régularise.
          if (C.isClosedDate(data, C.payslipDate(p))) { clos = MONTHS_LONG[Number(p.month) - 1]; return; }
          const f = C.payslipInputFor(data, x, Number(p.year), Number(p.month));
          p.gross = f.gross; p.workedDays = f.workedDays; p.prorata = f.prorata || null;
          recalculerBulletin(p, x); refait = MONTHS_LONG[Number(p.month) - 1];
        });
        save(true); close();
        // Ce qui se répare offre « Annuler » : la fiche et ses bulletins reviennent tels qu'avant.
        toastUndo(`${suite() === 'cdd' ? `CDD de ${x.name} prolongé jusqu'au ${C.fmtDate(x.endDate)}` : `${x.name} passe en CDI`}${brut !== actuel ? ` ; ${C.money(brut, cur)} dès ${MONTHS_LONG[Number(des.slice(5, 7)) - 1]}` : ''}${refait ? ` ; son bulletin de ${refait} refait au mois complet` : ''}${paye ? ` ; son bulletin de ${paye}, déjà payé au prorata, se régularise depuis son menu` : ''}${clos ? ` ; son bulletin de ${clos}, dans une période clôturée, se régularise depuis son menu` : ''}`, () => {
          const y = employeeById(e.id); if (y) { Object.keys(y).forEach(k => { delete y[k]; }); Object.assign(y, avant); }
          avantBul.forEach(b => { const i = data.payslips.findIndex(p => p.id === b.id); if (i >= 0) data.payslips[i] = b; });
          save(true); if (done) done();
        });
        if (done) done();
        hrDocForm(x, done, 'avenant');
      };
    });
  }
  function hrDocForm(employee, done, kindDemande, dateDemande) {
    const e = employee;
    const cur = company().currency;
    const st = C.payrollSettings(data);
    // (plateforme) 1.72.0 — les lignes proposées et l'indemnité de congés non pris viennent du moteur commun (compta.js) :
    // celles que le document imprime, et que le Cabinet propose aussi.
    const lines = C.lignesDuSolde(data, e.id, C.today());
    const bal = { remaining: C.indemniteConges(data, e.id, C.today()).solde };
    const resteAvances = C.round3(C.advancesOf(data, e.id).filter(a => !a.done).reduce((t, a) => t + a.remaining, 0));
    let dateVue = dateDemande || C.today();
    // (1.249.0) La fenêtre refaite (Skander, 02/11 : « je veux un vrai aperçu du document qui va être imprimé, et ce qui
    // manque ») : les documents en cartes à gauche, ce qui manque AVANT d'exporter avec le geste qui le renseigne, et la page
    // A4 entière à droite (ou à sa largeur). Chaque PDF exporté s'inscrit sur la fiche (« Documents faits »).
    const kind0 = C.HR_DOCS.some(x => x[0] === kindDemande) ? kindDemande : 'attestation';
    // (1.258.0, la maquette O08) Le numéro du document : AAAA-NNN, par année, sur tous les salariés de l'entreprise ; il
    // naît à l'export (un aperçu ne prend pas de numéro).
    const numeroSuivant = () => { const an = C.today().slice(0, 4); const n = data.employees.reduce((t, x) => t + (x.documentsFaits || []).filter(d => String(d.numero || '').startsWith(an + '-')).length, 0); return `${an}-${String(n + 1).padStart(3, '0')}`; };
    const autres = C.activeEmployees(data).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    modal(`<h2>Document pour ${h(e.name)}</h2><p class="small muted pa-doc-sous">l'aperçu est la page elle-même, au format A4 : ce que tu vois est ce qui sortira en PDF</p>
      <div class="pa-doc-c hf-c"><div class="pa-doc-g">
      ${autres.length > 1 ? `<div class="hf-pour" role="group" aria-label="Pour quel salarié"><span class="small muted">Pour</span>${autres.map(x => `<button type="button" class="pa-av hf-pour-b" data-hf-pour="${h(x.id)}" aria-pressed="${x.id === e.id}" title="${h(x.name)}" style="--c:${h(C.couleurDe(x.name || ''))}">${h(C.initialesDe(x.name || ''))}</button>`).join('')}</div>` : ''}
      <form id="hf">
        <input type="hidden" name="kind" value="${h(kind0)}">
        <div class="hf-cartes" role="radiogroup" aria-label="Le document">${C.HR_DOCS.map(([v, lab]) => `<button type="button" role="radio" class="hf-carte" data-hf-kind="${v}" aria-checked="${v === kind0}"><b>${h(lab)}</b></button>`).join('')}</div>
        <div class="hf-champs">${dateFieldHtml(lbl('Daté du', 'hr.docDate'), 'date', dateDemande || C.today(), {})}
        <label class="check hf-salaire"><input type="checkbox" name="withSalary"> Mentionner le salaire ${info('hr.withSalary')}</label></div>
      </form>
      <p class="small muted" id="hf-desc"></p>
      <div class="hf-pret" id="hf-pret"></div>
      <div id="hf-manque"></div>
      <div class="panel" id="hf-solde" hidden><h2>Solde de tout compte (${h(C.normCurrency(company().currency))})</h2>
        <p class="small muted mb">Ce que tu dois encore au salarié à son départ. Les montants sont à toi : SkanFact propose seulement l'indemnité de congés non pris, calculée sur son dernier salaire. <em>À VÉRIFIER : les indemnités dépendent du motif de la rupture et de la convention collective.</em></p>
        <div id="hf-lines"></div>
        ${bal.remaining < 0 ? `<p class="small warn-text mt">Il a pris ${pct(-bal.remaining)} jour${sPl(-bal.remaining)} de congé de plus qu'il n'en a acquis : l'indemnité ci-dessus vaut donc zéro. <em>À VÉRIFIER avec ton comptable : ces jours peuvent se retenir sur le solde.</em></p>` : ''}
        ${resteAvances > 0 ? `<p class="small mt" id="hf-avances">Il reste <b>${C.money(resteAvances, cur)}</b> à rembourser sur ses avances. Ce document ne les retient pas : un bulletin les rembourse, et ce qu'il ne peut pas retenir se règle avec lui. <em>À VÉRIFIER avec ton comptable : ce qui peut se retenir au départ.</em></p>` : ''}
      </div>
      </div><div class="hf-droite"><div class="hf-zoom" role="group" aria-label="Taille de l'aperçu"><span class="small muted">Aperçu A4</span><button type="button" class="btn btn-sm" data-hf-zoom="page" aria-pressed="true">Page entière</button><button type="button" class="btn btn-sm" data-hf-zoom="largeur" aria-pressed="false">Pleine largeur</button></div>
        <div class="pa-apercu hf-apercu" id="hf-apercu"></div></div></div>
      <div class="modal-actions"><span class="small muted hf-pied" id="hf-pied"></span><button class="btn" data-close>Annuler</button><button type="button" class="btn" id="hf-imprimer">${lfIc('pages', 15)} Imprimer</button><button class="btn btn-primary" id="ok">${lfIc('exporter', 15)} Exporter en PDF</button></div>`,
      (root, close) => {
        const total = () => C.round3(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
        let zoom = 'page';
        const drawLines = () => {
          $('#hf-lines', root).innerHTML = `<table class="lines-edit"><tbody>
            ${lines.map((l, i) => `<tr data-i="${i}">
              <td><input type="text" data-f="label" value="${h(l.label)}"></td>
              <td style="width:130px"><input type="text" inputmode="decimal" data-montant autocomplete="off" class="num" data-f="amount" value="${C.money(Number(l.amount) || 0, null, 3)}" aria-label="Montant (${h(C.normCurrency(company().currency))})"></td>
              <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-x="${i}" aria-label="Retirer la ligne">✕</button></td></tr>`).join('')}
          </tbody></table>
          <div class="inline mt"><button type="button" class="btn btn-sm" id="hf-add">+ Ligne</button>
            <span class="small muted">Net à percevoir : <b id="hf-total">${C.money(total(), cur)}</b></span></div>`;
          // Seul le total se recalcule à la frappe ; le tableau ne bouge qu'à l'ajout ou au retrait d'une ligne.
          $$('[data-f]', $('#hf-lines', root)).forEach(el => el.oninput = () => {
            const i = Number(el.closest('tr').dataset.i);
            lines[i][el.dataset.f] = el.dataset.f === 'amount' ? lireMontant(el.value) : el.value;
            lines[i].touche = true;
            $('#hf-total', root).textContent = C.money(total(), cur);
            apercu();
          });
          $$('[data-x]', $('#hf-lines', root)).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.x), 1); drawLines(); apercu(); });
          $('#hf-add', root).onclick = () => { lines.push({ label: '', amount: 0 }); drawLines(); };
        };
        const docHtml = () => { const v = formValues($('#hf', root)); return C.hrDocumentHtml(v.kind, e, data, company(), { date: v.date, withSalary: !!v.withSalary, lines, numero: numeroSuivant() }); };
        // Noter le document fait (son numéro, sa date) : à l'export comme à l'impression.
        const noter = v => { const x = employeeById(e.id); if (x) { x.documentsFaits = (x.documentsFaits || []).concat([{ id: C.uid(), kind: v.kind, date: v.date || C.today(), le: C.today(), numero: numeroSuivant() }]); save(true); } };
        const apercu = () => poserApercu($('#hf-apercu', root), docHtml(), { zoom });
        // Ce qui manque au document choisi, chacun avec le geste qui le renseigne ; rien ne bloque l'export.
        const MANQUE = [
          { id: 'hf-gerant', si: () => !company().managerName, dit: 'Le document dira « Je soussigné » <b>sans nom</b> : le nom du gérant n\'est pas renseigné.', geste: 'Renseigner le gérant…', fait: () => { close(); allerParametres('societe', 'p-identite:managerName'); } },
          { id: 'hf-civ', si: () => !e.gender, dit: `Le document parlera de ${h(e.name)} au masculin, sans « Madame » ni « Monsieur » : sa civilité n'est pas renseignée.`, geste: 'Renseigner sa civilité…', champ: 'gender' },
          { id: 'hf-cin', si: k => !e.cin && ['contrat', 'avenant', 'attestation', 'certificat', 'salaire', 'annuelle', 'solde'].includes(k), dit: 'Sa CIN n\'est pas sur sa fiche : la ligne « CIN n° … » ne s\'imprime pas.', geste: 'Renseigner sa CIN…', champ: 'cin' },
          { id: 'hf-poste', si: () => !e.position, dit: 'Son poste n\'est pas renseigné : le document écrit « — ».', geste: 'Renseigner son poste…', champ: 'position' },
        ];
        const sync = () => {
          const v = formValues($('#hf', root));
          $$('[data-hf-kind]', root).forEach(b => b.setAttribute('aria-checked', String(b.dataset.hfKind === v.kind)));
          const desc = (C.HR_DOCS.find(x => x[0] === v.kind) || [])[2] || '';
          $('#hf-desc', root).textContent = desc;
          $('#hf-solde', root).hidden = v.kind !== 'solde';
          // (plateforme) 1.72.0 — sans date de sortie, la date du document arrête le compte des congés : la ligne proposée la
          // suit (celle que le document imprimera), tant qu'on n'y a pas touché.
          if (v.date && v.date !== dateVue) {
            dateVue = v.date;
            const l = lines.find(x => x.cle === 'conges' && !x.touche), n = C.lignesDuSolde(data, e.id, v.date).find(x => x.cle === 'conges');
            if (l && n) { Object.assign(l, { label: n.label, amount: n.amount }); drawLines(); }
          }
          $('.hf-salaire', root).hidden = v.kind !== 'attestation';
          // (1.248.1) Seuls le certificat et le solde portent la date de sortie.
          if (['certificat', 'solde'].includes(v.kind) && !e.endDate) {
            $('#hf-desc', root).innerHTML = h(desc) + ` <span class="warn-text">${h(e.name)} n'a pas de date de sortie : le document portera la date du jour.</span> <button type="button" class="btn btn-sm" id="hf-sortie-go">Renseigner sa sortie…</button>`;
            $('#hf-sortie-go', root).onclick = () => { close(); employeeForm(e, () => hrDocForm(e, done, v.kind), { focus: 'endDate' }); };
          }
          const L = MANQUE.filter(m => m.si(v.kind));
          $('#hf-manque', root).innerHTML = L.length ? `<div class="hf-manque"><b>À compléter avant d'exporter</b>${L.map(m => `<div class="warn-box" id="${m.id}"><span>${m.dit}</span> <button type="button" class="btn btn-sm" id="${m.id}-go">${m.geste}</button></div>`).join('')}</div>`
            : '<p class="small ok-text hf-ok">' + lfIc('coche', 13, 2.6) + ' Tout ce que ce document imprime est renseigné.</p>';
          L.forEach(m => { $(`#${m.id}-go`, root).onclick = m.fait || (() => { const k = formValues($('#hf', root)).kind; close(); employeeForm(e, () => hrDocForm(e, done, k), { focus: m.champ }); }); });
          const tires = ['salaire', 'annuelle'].includes(v.kind) ? 'les montants viennent des bulletins, jamais tapés' : v.kind === 'solde' ? 'les lignes du solde se relisent ci-dessous, chacune modifiable' : 'ce qu\'il dit vient de sa fiche';
          $('#hf-pret', root).innerHTML = `<b>Prêt</b><span>${tires}</span><span>numéroté (n° ${h(numeroSuivant())}), daté du ${h(C.fmtDate(v.date || C.today()))}, rangé dans les documents de ${h(e.name.split(' ')[0] || e.name)}</span>`;
          const faits = (e.documentsFaits || []).filter(x => x.kind === v.kind);
          $('#hf-pied', root).textContent = faits.length ? `déjà fait ${faits.length > 1 ? `${faits.length} fois, ` : ''}le ${C.fmtDate(faits[faits.length - 1].le)}` : '';
        };
        drawLines(); sync(); requestAnimationFrame(apercu);
        $$('[data-hf-kind]', root).forEach(b => b.onclick = () => { $('#hf [name=kind]', root).value = b.dataset.hfKind; sync(); apercu(); });
        $$('[data-hf-zoom]', root).forEach(b => b.onclick = () => { zoom = b.dataset.hfZoom; $$('[data-hf-zoom]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); apercu(); });
        $('#hf', root).onchange = () => { sync(); apercu(); };
        $$('[data-hf-pour]', root).forEach(b => b.onclick = () => { if (b.dataset.hfPour === e.id) return; const o = employeeById(b.dataset.hfPour), v = formValues($('#hf', root)); if (!o) return; close(); hrDocForm(o, done, v.kind, v.date); });
        // « Imprimer » : la page dans la fenêtre d'impression du navigateur ; le document se note comme à l'export.
        $('#hf-imprimer', root).onclick = () => {
          const v = formValues($('#hf', root)), w = window.open('', '_blank');
          if (!w) { toast('Ton navigateur a bloqué la fenêtre d\'impression : autorise les fenêtres de ce site, puis recommence.', true); return; }
          w.document.write(docHtml()); w.document.close(); w.focus(); w.print();
          noter(v); toast(`${C.hrDocLabel(v.kind)} envoyée à l'impression · notée dans ses documents`); close(); if (done) done();
        };
        $('#ok', root).onclick = async () => {
          const v = formValues($('#hf', root));
          const html = docHtml();
          const safe = s2 => String(s2).replace(/[^\w\-àâäéèêëïîôöùûüç ]/gi, '').trim().replace(/\s+/g, '_');
          try {
            // (1.257.1) Vu par Skander sur dev.skanfact.tn le 02/11 : « j'ai exporté le document et rien n'a été pris en
            // compte ». Un serveur sans son outil de PDF rend la main à la fenêtre d'impression du navigateur (le point de
            // contact rend null) : le document n'était pas noté, la fenêtre restait ouverte. Il est noté dans les deux cas.
            const f = await bridge.exportPdf(html, `${safe(C.hrDocLabel(v.kind))}_${safe(e.name)}.pdf`);
            noter(v);
            toast(f ? `PDF enregistré : ${f.split(/[\\/]/).pop()} · noté dans ses documents`
              : 'Le document s\'ouvre pour l\'impression : choisis « Enregistrer en PDF » dans la fenêtre du navigateur. Il est noté dans ses documents.');
            close(); if (done) done();
          } catch (err) { toast(plainError(err), true); }
        };
      }, null, { classe: 'pa-doc' });
  }

  const paieState = { tab: 'pt-jour', year: lastMonth.slice(0, 4), month: String(Number(lastMonth.slice(5, 7))),
    quarter: String(Math.ceil(Number(lastMonth.slice(5, 7)) / 3)), salaries: { page: 1 }, compteurs: { page: 1 },
    // (1.249.0) Toute liste qu'on nomme se pagine (recette du 02/11) : les bulletins du mois, les avances, le registre.
    bul: { page: 1 }, av: { page: 1 }, reg: { page: 1 }, regDocs: { page: 1 } };
  // (plateforme) 1.222.0 — la Paie telle que sa maquette (docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée ») :
  // six vues ; les avances vivent sous « Congés et absences », le registre sous « Salariés », les réglages à droite.
  // PAIE_TABS garde TOUS les onglets : la recherche (Ctrl K) les propose tous, sous-vues comprises.
  // (1.256.0) Quatre vues au lieu de six (décidé avec Skander le 02/11/2026) : les congés passent sous « Présences » avec le
  // pointage, les avances sous « Salariés », l'année sous « Déclarations ». Chaque vue garde ses sous-vues, nommées.
  // (1.267.0) Trois vues (16 § 2.2, la maquette docs/maquettes/paie-v2.html ; Skander, 04/11 : « je ne trouve rien ») :
  // « Aujourd'hui » (la journée, les demandes, ce qu'il ne faut pas oublier, les gestes), « Le mois » en quatre étapes qu'on
  // clique (pointer, les bulletins, payer, déclarer), « L'équipe ». L'onglet « Aujourd'hui » garde l'identifiant `pointage`
  // de l'ancien « Présences » (il ouvrait déjà la journée) ; la vue `pointage` elle-même, la grille du mois, est l'étape 1.
  const PAIE_VUES = [['pointage', 'Aujourd\'hui'], ['bulletins', 'Le mois'], ['salaries', 'L\'équipe']];
  const PAIE_TABS = [['pt-jour', 'Aujourd\'hui'], ['bulletins', 'Le mois : les bulletins'], ['salaries', 'L\'équipe'], ['pointage', 'Le mois : le pointage'], ['payer', 'Le mois : payer les salaires'],
    ['declarations', 'Le mois : les déclarations'], ['conges', 'Congés et absences'], ['annee', 'L\'année'], ['avances', 'Avances et prêts'], ['registre', 'Registre du personnel'], ['baremes', 'Réglages de la paie'],
    ['pt-salarie', 'Pointage par salarié'], ['pt-horaires', 'Les horaires']];
  // (plateforme) 1.234.0 — « Salariés » n'a plus de sous-onglets (la maquette) : le registre du personnel est dans le menu ⋯.
  // 1.234.0 — ni « Congés et absences » : les avances en cours sont sous les congés, la liste entière par « Toutes… ».
  // (1.249.0) Chaque sous-vue dit ce qu'elle montre (une icône, un mot) : trois mots gris soulignés « ne donnaient pas envie ».
  // « Le mois » n'a pas de sous-vues nommées : ses quatre étapes (`etapesDuMois`) en tiennent lieu.
  const PAIE_SOUS = {
    pointage: [['pt-jour', 'La journée', 'coche', 'qui est là, ce qui change, puis valider'], ['conges', 'Congés et absences', 'echeance', 'calendrier, demandes, soldes']],
    salaries: [['salaries', 'L\'équipe', 'equipe', 'fiches, contrats, départs'], ['avances', 'Avances et prêts', 'carte', 'en cours, retenues']]
  };
  const PAIE_VUE_DE = { 'pt-jour': 'pointage', conges: 'pointage', pointage: 'bulletins', 'pt-salarie': 'bulletins', 'pt-horaires': 'bulletins', payer: 'bulletins', declarations: 'bulletins', annee: 'bulletins', avances: 'salaries', registre: 'salaries' };
  // L'étape du mois que chaque vue ouvre (la grille, « Par salarié » et « Les horaires » sont sous « Pointer »).
  const ETAPE_DE = { pointage: 'pointage', 'pt-salarie': 'pointage', 'pt-horaires': 'pointage', bulletins: 'bulletins', payer: 'payer', declarations: 'declarations' };
  Object.assign(LF_IC, { echeance: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' });
  // (1.255.0) « Modifier sa sortie… » et « Modifier le bulletin » appelaient une icône qui n'existait pas (bouton sans dessin).
  // (1.259.0) La vue grille du pointage, et une vraie croix pour « Absent » (`croix` est le plus de « Créer »).
  Object.assign(LF_IC, { grille: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', absent: '<path d="M6 6l12 12M18 6 6 18"/>' });
  // (1.267.0) Un billet, pour les espèces et les avances (« argent » n'était pas dans les icônes : le bouton restait sans dessin).
  Object.assign(LF_IC, { argent: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>' });
  Object.assign(LF_IC, { modifier: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>' });
  // Idem sur la Paie : la liste des salariés, les avances en cours et le registre du personnel sont
  // des états du jour, pas d'un exercice. Ils affichaient un sélecteur d'année qui ne faisait rien.
  const P_SANS_ANNEE = ['salaries', 'avances', 'registre', 'baremes', 'pt-horaires', 'pt-jour'];

  // (1.256.0) La page Paie reprend la maquette telle quelle (Skander, 02/11 : « reprends ses écrans, elle est soignée ») :
  // ses classes (`web/public/plateforme/paie-maquette.css`, sous `.pm`), branchées sur les vraies données. L'avatar d'un
  // salarié : ses initiales sur un dégradé de sa couleur.
  const pmAv = (initiales, couleur, cl) => `<span class="av${cl ? ` ${cl}` : ''}" style="background:linear-gradient(145deg, color-mix(in srgb, ${h(couleur)} 70%, #fff), ${h(couleur)})">${h(initiales)}</span>`;
  const pmAvDe = (nom, cl) => pmAv(C.initialesDe(nom || ''), C.couleurDe(nom || ''), cl);
  // (plateforme) 1.234.0 — une avance ou un prêt en cours : une barre par retenue, sous les congés et sur la fiche du salarié.
  // (plateforme, 03/11/2026 — correction urgente du 16 § 10.1, point 6 ; à sortir avec le Personnel, 17 lot A1) « Retirer
  // déposée » d'une déclaration sociale : LA porte de la Paie › Déclarations et du calendrier fiscal. Notée payée (1.228.0),
  // elle porte son paiement : la sortie de trésorerie et l'écriture qui solde la CNSS ou la retenue naissent d'elle. On les
  // retirait sans le dire (le calendrier ne demandait même pas). La question dit ce qui part ; « Annuler » remet la même
  // ligne. Pointé sur un relevé, ou daté d'un mois clos, le paiement ne part pas (comme « Annuler le paiement » d'un salaire).
  async function retirerDeclarationSociale(id, label, apres) {
    const f = (data.socialFilings || []).find(x => x.id === id);
    if (!f) return;
    if (enLecture('socialFilings')) { toast(refusLecture('socialFilings'), true); return; }
    const paye = !!(f.paidDate && Number(f.amount));
    if (paye && f.reconciled) { toast('Le paiement de cette déclaration est pointé sur un relevé de banque : la mention ne se retire pas sans lui. Dépointe-le d’abord dans la trésorerie.', true); return; }
    if (paye && closedBlock(f.paidDate, 'Ce paiement')) return;
    const compte = paye ? ((data.accounts || []).find(a => a.id === f.accountId) || {}).name : '';
    // (1.305.0) Payée dans la période que le cabinet a validée : chez lui, l'annulation du paiement s'écrit au premier jour ouvert.
    if (paye) await periodeValideeLue();
    const dvRet = paye ? dateDansLaPeriodeValidee([f.paidDate]) : '';
    const oui = paye
      ? await confirmDialog(`Le paiement noté pour ${label} part avec la mention : ${C.money(Number(f.amount), company().currency)}, payés le ${C.fmtDate(f.paidDate)}${compte ? ` depuis ${compte}` : ''}${f.reference ? ` (réf. ${f.reference})` : ''}. Il sort de la trésorerie et des écritures, et la déclaration redevient à payer.${dvRet ? ` ${phraseAnnulationValidee(dvRet, { sujet: 'Il', fem: false })}` : ''}`, 'Retirer la mention et le paiement', true, { titre: 'Retirer « déposée et payée » ?' })
      : await confirmDialog(`Retirer la mention « déposée » de ${label} ?`);
    if (!oui) return;
    data.socialFilings = data.socialFilings.filter(x => x.id !== id);
    save(true); apres();
    if (dvRet) { direAuComptableApres('Mention et paiement retirés', { fait: 'de retirer', fem: false, annule: true, quoi: `un paiement daté du ${C.fmtDate(dvRet)} (${label}, ${C.money(Number(f.amount), company().currency)})` }); return; }
    toastUndo(paye ? `Mention et paiement retirés : ${label}` : `${enTete(label)} n'est plus marquée déposée`, () => {
      data.socialFilings = (data.socialFilings || []).filter(x => x.id !== id).concat([f]);
      save(true); apres();
    });
  }
  function avanceLigneHtml(a, cur) {
    // L'année se dit dès qu'une retenue tombe hors de l'année en cours : « janvier » seul, à côté d'« octobre 2025 », tromperait.
    let avecAn = false;
    const mois = ym => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]}${avecAn ? ' ' + ym.slice(0, 4) : ''}`;
    const e = employeeById(a.employeeId) || {}, n = a.monthly > 0 ? Math.ceil(C.round3(a.amount / a.monthly) - 1e-9) : 0;
    const faites = a.monthly > 0 ? Math.min(n, Math.round(a.repaid / a.monthly)) : 0;
    const debut = a.debut || (a.date || '').slice(0, 7); // sans début choisi, la retenue part du mois de l'avance (C.paieDuMois)
    const mk = k => debut ? mois(C.addMonths(debut + '-01', k).slice(0, 7)) : '';
    avecAn = !!debut && n > 0 && [0, n - 1].some(k => C.addMonths(debut + '-01', k).slice(0, 4) !== C.today().slice(0, 4));
    const resteN = n - faites, derniere = debut && n ? mk(n - 1) : '';
    // (1.248.1) La ligne s'ouvre au clic, mais rien ne le disait : « Modifier… » le dit (recette du 02/11).
    return `<li class="clickable" data-av="${h(a.id)}" tabindex="0" title="Modifier, ou supprimer si rien n'est retenu"><div class="av-t"><b>${a.kind === 'pret' ? 'Prêt' : 'Avance'} à ${h((e.name || '').split(' ')[0])} : ${C.money(a.amount, cur)}, versé${a.kind === 'pret' ? '' : 'e'} le ${C.fmtDate(a.date)}${n ? `, à rendre en ${pl(n, 'fois', 'fois')}` : ''}</b>
      <span class="mu">reste ${C.money(a.remaining, cur)}${resteN > 0 && derniere ? ` · la dernière retenue en ${h(derniere)}` : ''} · <span class="av-mod">Modifier…</span></span></div>
      ${n && n <= 12 ? `<div class="av-b">${Array.from({ length: n }, (_, k) => `<span class="${k < faites ? 'fait' : ''}"><i></i><small>${h(mk(k))} · ${C.money(Math.min(a.monthly, C.round3(a.amount - k * a.monthly)), '')}${k < faites ? ' retenu' : ''}</small></span>`).join('')}</div>`
        : n ? `<div class="pa-ech">${Array.from({ length: Math.min(24, n) }, (_, k) => `<i class="${k < faites ? 'fait' : ''}"></i>`).join('')}</div><small class="mu">${pl(n, 'retenue')} de ${C.money(a.monthly, cur)}${debut ? ` · de ${h(mk(0))} à ${h(derniere)}` : ''}</small>` : ''}</li>`;
  }
  const pagePaie = () => {
    const cur = company().currency;
    const s = paieState;
    // Le mois s'ouvre là où il y a quelque chose à faire (`C.moisDePaie`) tant qu'on ne l'a pas
    // choisi : figé sur le mois précédent, un premier salarié embauché ce mois-ci n'avait nulle part
    // où recevoir son bulletin (10.12.0).
    // (1.251.0) Le pointage, tant qu'on n'a pas choisi de mois, s'ouvre sur le mois du jour (recette du 02/11, 1.249.0).
    // Le mois d'entrée se fixe en arrivant sur la page (établir les bulletins fait avancer le « mois à traiter » : recalculé
    // ensuite, la page sauterait au mois suivant sous les yeux). Le pointage, tant qu'aucun mois n'est choisi, montre le
    // mois du jour, et on retrouve le mois d'entrée en le quittant.
    const entree = C.moisDePaie(data);
    // (1.267.0) « Le mois » et ses quatre étapes lisent le même mois, celui qui est à traiter ; seul « Aujourd'hui » vit au jour.
    const moisParDefaut = () => { if (!s.moisTouche) { const mp = ['pt-jour', 'conges'].includes(s.tab) ? { year: Number(C.today().slice(0, 4)), month: Number(C.today().slice(5, 7)) } : entree; s.year = String(mp.year); s.month = String(mp.month); } };
    moisParDefaut();
    // Chaque année où un salarié était en poste, pas seulement celles qui portent déjà un bulletin :
    // sinon les bulletins en retard d'une année passée n'avaient aucune porte (10.14.1).
    const years = C.anneesDePaie(data);
    if (!years.includes(s.year)) s.year = years[0];
    // (1.251.0) UN mois pour toute la page, choisi dans la bande des douze mois (Skander, 02/11 : quatre façons de choisir
    // un mois — une liste ici, des flèches là — qui ne se suivaient pas : octobre dans un onglet, novembre dans l'autre).
    // Le pointage, le calendrier des congés et la déclaration lisent ce mois-là.
    // (1.267.0) La journée n'a plus la bande : elle lit son jour (celui qu'on a ouvert, sinon aujourd'hui) et passe d'un mois à
    // l'autre par ‹ ›.
    const syncMois = () => {
      s.ptY = Number(s.year); s.ptM = Number(s.month); s.moisCal = String(s.month); s.moisDeclare = String(s.month);
      if (s.tab === 'pt-jour') { const iso = s.ptJourIso || C.today(); s.ptY = Number(iso.slice(0, 4)); s.ptM = Number(iso.slice(5, 7)); }
    };
    syncMois();

    // L'en-tête suit l'onglet ouvert. Il était écrit UNE fois, hors du redessin : sur « Congés »,
    // le gros bouton vert en haut à droite disait « + Salarié » pendant que le vrai geste de
    // l'onglet — « + Congé ou absence » — était un bouton vert plus petit, dans le panneau. Deux
    // boutons verts sur un écran, et le mauvais à la place canonique. Le Catalogue sait faire ça
    // depuis la 1.9.0 (`head()` redessiné à chaque onglet) : on reprend son mécanisme.
    const P_ACTION = {
      salaries: ['new-emp', 'Un salarié'],
      conges: ['new-lv', 'Un congé ou une absence'],
      avances: ['new-av', 'Une avance']
    };
    // Le geste suivant du mois, calculé : établir ce qui manque, puis payer, puis remettre (la maquette, « un seul bouton
    // principal »). Ailleurs, le geste de la vue. Sans aucun salarié, « Un salarié » n'est pas vert : la carte vide porte
    // déjà « Mon premier salarié » en vert (U-11, 10.12.0).
    // (1.267.0) Le mois en quatre étapes (la maquette paie-v2, « Le mois ») : pointer, les bulletins, payer (et remettre chaque
    // bulletin), déclarer. Chacune se lit des étapes du moteur (`C.paieDuMois`), les mêmes faits que l'ancienne frise ; une seule
    // est « en cours », la première qui n'est pas faite. Fonctions déclarées : l'en-tête les lit avant le corps de la route.
    function etapesDuMois(y, m) {
      const [pt0, bu, pa, re, de] = C.paieDuMois(data, y, m, { bap: bapDuMois(y, m) }).etapes;
      // (1.330.0) Le pointage validé (verrouillé) est une étape FAITE, même avant les bulletins ; et l'étape ne se dit pas
      // « facultatif » quand ses journées non validées retiennent les bulletins (joué à la souris : « facultatif » au-dessus de
      // « Les bulletins attendent : 1 chose à régler dans le pointage », puis encore « facultatif » une fois le mois validé).
      const nRetient = ptEnvoye(y, m) ? 0 : bloquantsDe(y, m).length;
      const pt = ptEnvoye(y, m) ? { ...pt0, fait: true, dit: 'le mois est validé' }
        : nRetient && !pt0.fait ? { ...pt0, dit: `${pl(nRetient, 'chose')} à régler avant les bulletins` } : pt0;
      const paye = { titre: 'Payer', fait: pa.fait && re.fait, dit: !pa.fait || re.fait ? pa.dit : `${pa.dit} · ${re.dit}` };
      let ici = false;
      // (1.268.0 ; Skander, 04/11/2026) Avec un cabinet, chaque étape dit qui la fait : en paie tenue, tu pointes et tu paies,
      // ton comptable prépare les bulletins et dépose la déclaration ; en paie vérifiée, tu fais tout, il relit tes bulletins.
      // Pendant son tour, l'étape dit où il en est, au lieu d'un compte de bulletins « à établir » qui n'est pas à toi.
      const mode = modeDuMois(y, m), QUI = { tenue: { pointage: 'toi', bulletins: 'ton comptable', payer: 'toi', declarations: 'ton comptable' },
        seule: { pointage: 'toi', bulletins: 'toi, ton comptable vérifie', payer: 'toi', declarations: 'toi' } }[mode] || {};
      const dits = {};
      if (mode === 'tenue' && C.missingPayslips(data, y, m).length) dits.bulletins = ptEnvoye(y, m) ? 'il les prépare, puis te les envoie' : moisFini(y, m) ? 'après l\'envoi de ton pointage' : 'après la fin du mois et ton pointage';
      return [['pointage', pt], ['bulletins', bu], ['payer', paye], ['declarations', de]].map(([id, e]) => {
        const etat = e.fait ? 'fait' : ici ? '' : 'ici'; if (!e.fait) ici = true;
        return { id, titre: e.titre, dit: e.fait ? e.dit : dits[id] || e.dit, etat, qui: QUI[id] || '' };
      });
    }
    // Ce que le mois attend de toi, et à quelle étape : la correction proposée, ton accord, établir, payer, remettre. Rien quand
    // ton cabinet prépare (il te les envoie) ni quand tout est fait.
    // (1.267.0, morceau C) Ce qui retient les bulletins d'un mois (16 § 3.7, décision 4) : ce qui change un montant, la liste
    // « À régler » du pointage (une journée pas validée, une sortie que la pointeuse n'a pas reçue, une demande sans réponse),
    // tant que le pointage du mois n'est pas validé. La même fonction donne la liste, son compteur et le refus.
    // L'en-tête se dessine une première fois avant que les outils du pointage soient posés (plus bas) : il lit alors une liste
    // vide, et le dessin qui suit aussitôt (draw) dit la vraie.
    function bloquantsDe(y, m) {
      try { return ptVerrouille(ymPt(y, m)) ? [] : aReglerMois(y, m); } catch (_) { return []; }
    }
    // (1.268.0) Le pointage d'un mois est envoyé au cabinet quand il est validé (verrouillé) ; un mois est fini après son
    // dernier jour. Comme « À régler », l'en-tête les lit avant que les outils du pointage soient posés.
    function ptEnvoye(y, m) { try { return ptVerrouille(ymPt(y, m)); } catch (_) { return false; } }
    function moisFini(y, m) { return C.today() > C.addDays(`${y}-${String(m).padStart(2, '0')}-01`, C.daysInMonth(y, m) - 1); }
    // Les bulletins du mois en cours se préparent à partir du 25 (16 § 3.7) ; un mois à venir, jamais.
    function avant25(y, m) {
      const auj = C.today(), ym = `${y}-${String(m).padStart(2, '0')}`;
      return ym > auj.slice(0, 7) || (ym === auj.slice(0, 7) && Number(auj.slice(8, 10)) < 25);
    }
    // (1.267.0, morceau C) « Plus tard » sur un rappel (la maquette) : il revient lundi prochain. Une commodité de ce poste,
    // par entreprise (rien ne part au serveur) ; « À ne pas oublier » et la pastille d'« Aujourd'hui » lisent la même liste.
    function tardCle() { return `skanfact.paie-tard.${new URLSearchParams(location.search).get('e') || ''}`; }
    function tardsLus() { try { return JSON.parse(localStorage.getItem(tardCle()) || '{}') || {}; } catch (_) { return {}; } }
    function cleRappel(x) { return [x.focus || '', x.salarie || '', x.essai ? 'essai' : '', x.conge || '', x.saisie || '', x.titre || ''].join('|'); }
    function lundiProchain() { const t = C.today(), wd = new Date(t + 'T00:00:00Z').getUTCDay(); return C.addDays(t, ((8 - wd) % 7) || 7); }
    function rappelsDuJour() { const T = tardsLus(), auj = C.today(); return C.paieATraiter(data, auj).filter(x => !x.demande && !(T[cleRappel(x)] > auj)); }
    function actionDuMois(y, m) {
      const mo = C.payslipsOf(data, y, m), miss = C.missingPayslips(data, y, m), nom = MONTHS_LONG[m - 1];
      const de = /^[aeiouyéè]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
      const corr = mo.find(x => correctionEnAttente(x));
      if (!miss.length && corr) return { etape: 'bulletins', sorte: 'correction', ic: 'comptable', dit: `Voir la correction${corr.correction.par ? ` de ${corr.correction.par}` : ''}` };
      if (!miss.length && aApprouverDe(mo, y, m).length) return { etape: 'bulletins', sorte: 'approuver', ic: 'coche', dit: `Approuver les bulletins ${de}` };
      if (!miss.length && enPreparationDe(mo, y, m).length) return null;
      // (1.268.0 ; Skander, 04/11/2026) Ton cabinet tient la paie : ton geste est d'envoyer le pointage d'un mois fini (le
      // valider) ; les bulletins, il les prépare. Le bouton vert ne propose que tes gestes : rien tant que c'est son tour.
      if (miss.length && modeDuMois(y, m) === 'tenue') {
        if (!moisFini(y, m) || ptEnvoye(y, m)) return null;
        return bloquantsDe(y, m).length ? { etape: 'pointage', sorte: 'regler', ic: 'alerte', dit: `Régler le pointage ${de}` }
          : { etape: 'pointage', sorte: 'envoyer', ic: 'envoi', dit: `Envoyer le pointage ${de} au cabinet` };
      }
      // (1.267.0, morceau C) Un mois dont les bulletins ne s'établissent pas encore (avant le 25) n'attend rien d'eux ; ceux
      // qui sont établis se paient et se remettent.
      if (miss.length && !avant25(y, m)) {
        if (bloquantsDe(y, m).length) return { etape: 'pointage', sorte: 'regler', ic: 'alerte', dit: `Régler le pointage ${de}` };
        return { etape: 'bulletins', sorte: 'etablir', ic: 'pages', dit: `Établir les bulletins ${de}` };
      }
      if (mo.some(x => !x.paidDate)) return { etape: 'payer', sorte: 'payer', ic: 'carte', dit: `Payer les salaires ${de}` };
      if (mo.some(x => x.paidDate && !x.remisLe)) return { etape: 'payer', sorte: 'remettre', ic: 'envoi', dit: `Remettre les bulletins ${de}` };
      return null;
    }
    // Le bouton vert d'« Aujourd'hui », selon le jour (la maquette, « principal ») : d'abord le mois d'avant s'il n'est pas fini
    // (`avant` : il se dit dans un bandeau) ; puis le mois en cours, dès que ses bulletins existent, ou à partir du 25 pour les
    // établir (16 § 3.7 : les bulletins se préparent dès le 25). Le mois d'avant se lit lui-même : `C.moisDePaie` passe au mois
    // en cours dès qu'il lui manque un bulletin, salaires d'avant payés ou non. Avant le premier bulletin fait dans SkanFact,
    // la paie était tenue ailleurs : le mois d'avant n'a rien à finir ici (la règle de la bande des mois).
    function principalDuJour() {
      if (enLecture('payslips')) return null;
      const auj = C.today(), yA = Number(auj.slice(0, 4)), mA = Number(auj.slice(5, 7)), yP = mA === 1 ? yA - 1 : yA, mP = mA === 1 ? 12 : mA - 1;
      if (`${yP}-${String(mP).padStart(2, '0')}` >= premierMoisPaie) { const a = actionDuMois(yP, mP); if (a) return { ...a, y: yP, m: mP, avant: true }; }
      const a = actionDuMois(yA, mA);
      if (a && (!['etablir', 'regler'].includes(a.sorte) || Number(auj.slice(8, 10)) >= 25)) return { ...a, y: yA, m: mA };
      return null;
    }
    const pHead = () => {
      const y = Number(s.year), m = Number(s.month);
      const enPoste = data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today())).length;
      let prin = '';
      if (!data.employees.length) prin = `<button class="btn" id="new-emp">${lfIc('croix', 15, 2.4)} Un salarié</button>`;
      // (1.267.0) Sur « Le mois », le bouton vert est le geste suivant de l'étape ouverte : sur « Bulletins », établir ou
      // approuver, puis (les bulletins prêts) payer et remettre, l'étape suivante ; sur « Payer », payer puis remettre.
      // « Pointer » et « Déclarer » portent le leur dans leur carte (valider, déposer).
      else if (s.tab === 'bulletins' || s.tab === 'payer') {
        const miss = C.missingPayslips(data, y, m), mo = C.payslipsOf(data, y, m);
        const aPayer = mo.filter(x => !x.paidDate), aRemettre = mo.filter(x => x.paidDate && !x.remisLe);
        const corr = mo.find(x => correctionEnAttente(x)), aApprouver = aApprouverDe(mo, y, m), enPrep = enPreparationDe(mo, y, m);
        const avantPaie = !miss.length && corr ? `<button class="btn btn-primary" id="p-corr-ok">${lfIc('coche', 15, 2.4)} Accepter la correction${corr.correction.par ? ` de ${h(corr.correction.par)}` : ''}</button>`
          : !miss.length && enPrep.length && !aApprouver.length ? `<button class="btn btn-primary" id="p-prep" disabled title="Ton cabinet te les envoie quand ils sont prêts : tu les approuves alors">${lfIc('comptable', 15)} Ton cabinet prépare ${enPrep.length > 1 ? `les ${enPrep.length} bulletins` : 'le bulletin'}</button>`
            : !miss.length && aApprouver.length ? `<button class="btn btn-primary" id="p-bap">${lfIc('coche', 15, 2.4)} ${aApprouver.length > 1 ? `J'approuve les ${aApprouver.length} bulletins` : 'J’approuve le bulletin'}</button>`
              : miss.length && modeDuMois(y, m) === 'tenue' ? (ptEnvoye(y, m) ? `<button class="btn btn-primary" id="p-prep" disabled title="Ton cabinet te les envoie quand ils sont prêts : tu les approuves alors">${lfIc('comptable', 15)} Ton cabinet prépare ${miss.length > 1 ? `les ${miss.length} bulletins` : 'le bulletin'}</button>`
                : moisFini(y, m) ? `<button class="btn btn-primary" id="p-envoyer">${lfIc('envoi', 15)} Envoyer d'abord le pointage au cabinet</button>` : '')
              : miss.length && avant25(y, m) ? ''
              : miss.length && bloquantsDe(y, m).length ? `<button class="btn btn-primary" id="p-regler">${lfIc('alerte', 15)} Régler d'abord ${pl(bloquantsDe(y, m).length, 'chose')} du pointage</button>`
              : miss.length ? `<button class="btn btn-primary" id="p-gen">${lfIc('croix', 15, 2.4)} ${miss.length > 1 ? `Établir les ${miss.length} bulletins` : 'Établir le bulletin'}</button>` : '';
        prin = avantPaie ? (s.tab === 'bulletins' ? avantPaie : '')
          : aPayer.length ? `<button class="btn btn-primary" id="p-payer">${lfIc('carte', 15)} Payer les salaires · ${C.money(C.round3(aPayer.reduce((a, x) => a + x.c.net, 0)), cur)}</button>`
            : aRemettre.length ? `<button class="btn btn-primary" id="p-remettre">${lfIc('envoi', 15)} ${aRemettre.length > 1 ? `Remettre les ${aRemettre.length} bulletins` : 'Remettre le bulletin'}</button>` : '';
      } else if (s.tab === 'pt-jour') {
        // (1.267.0) « Aujourd'hui » : le geste du mois, quand c'est son jour (la maquette, « principal ») ; celui d'un mois
        // passé pas fini est dans son bandeau, sous les yeux ; sinon, le vert est « Valider la journée », dans sa carte.
        const p = principalDuJour();
        if (p && !p.avant) prin = `<button class="btn btn-primary" id="p-jour-go">${lfIc(p.ic, 15, 2.2)} ${h(p.dit)}</button>`;
      } else if (P_ACTION[s.tab]) prin = `<button class="btn btn-primary" id="${P_ACTION[s.tab][0]}">${lfIc('croix', 15, 2.4)} ${P_ACTION[s.tab][1]}</button>`;
      // (1.267.0) « Embaucher » sur chaque vue (la maquette) ; sur « L'équipe », c'est le vert « Un salarié ».
      const embaucher = data.employees.length && s.tab !== 'salaries' && s.tab !== 'baremes' && !enLecture('employees') ? `<button type="button" class="btn" id="p-embaucher">${lfIc('croix', 15, 2.4)} Embaucher</button>` : '';
      // (plateforme) 1.232.0 — un geste qu'on ne peut pas faire ne s'offre pas (docs/revue-paie.md, P4) : en lecture, aucun
      // bouton principal ; sans réseau, il se voit mais attend, et dit pourquoi (P5 : la paie reste en ligne, docs/hors-ligne.md).
      if (prin && enLecture('payslips')) prin = '';
      if (prin && navigator.onLine === false) prin = prin.replace('<button class="btn btn-primary"', '<button class="btn btn-primary" disabled title="Pas de réseau : ce geste passe par le serveur, il attend la connexion"');
      // (1.248.0) « ton cabinet » seulement quand un cabinet est relié (recette du 02/11 : la phrase le disait sans cabinet).
      const qui = !sansCabinetRelie() ? { tenue: 'tenue par ton cabinet', seule: 'tu la fais, ton cabinet la vérifie', sans: 'tu la fais seul' }[modeDuMois(y, m)] : 'tu la fais seul · aucun cabinet relié';
      // (plateforme) 1.234.0 — le sous-titre de la maquette : l'effectif, qui tient la paie, le jour. Le même sur chaque vue.
      const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const sous = data.employees.length ? `${pl(enPoste, 'salarié')}${qui ? ` · ${qui}` : ''} · ${jour}` : 'Tes salariés, leurs bulletins, ce que la paie te coûte';
      // (1.257.0) Les réglages ont leur titre, comme la maquette : « Accueil › Paie › Réglages », « Réglages de la paie ».
      const regl = s.tab === 'baremes';
      return `<div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}${regl ? `<a href="#/paie" id="p-chemin-paie">Paie</a>${ICONE_CHEVRON}<span>Réglages</span>` : '<span>Paie</span>'}</div><h1>${regl ? 'Réglages de la paie' : 'Paie'}</h1><p class="sous">${sous}</p></div>
        <div class="actions">${data.employees.length && peutEcrireAuCabinet() ? `<button type="button" class="btn" id="p-ecrire">${lfIc('message', 15)} Écrire à mon comptable</button>` : ''}${embaucher}${data.employees.length ? `<button type="button" class="btn btn-ghost pa-plus" id="p-plus" aria-haspopup="menu" aria-label="Autres gestes de la paie" title="Autres gestes de la paie">${lfIc('plus', 16)}</button>` : ''}${prin}</div>`;
    };
    // Le mois choisi, à gauche des vues : l'année partout où elle compte, le mois sur « Le mois ».
    // (plateforme) 1.233.0 — le pointage prend son mois ici, à côté de l'année : il avait un second sélecteur dans sa carte,
    // et les deux pouvaient se contredire (docs/revue-paie.md, U2).
    // (1.249.0) Le pointage a SON mois, celui du jour par défaut (recette du 02/11 : « j'atterris sur octobre alors qu'on
    // est en novembre » — il suivait le mois de paie, octobre tant qu'octobre n'est pas fini). On y passe d'un mois à
    // l'autre par ‹ ›, et « Ce mois-ci » y revient ; la largeur ne bouge pas (le bouton reste, grisé sur le mois du jour).
    const ptYm = () => `${s.ptY}-${String(s.ptM).padStart(2, '0')}`;
    // (1.251.0) L'état d'un mois de paie, lu des mêmes fonctions que « À traiter » et « Ce que tu verses » : fait (tout
    // payé, la retenue déclarée), à faire (un bulletin manque, un salaire reste à payer, la déclaration attend), en retard
    // (sa date de déclaration est passée), en cours (le mois du jour), à venir, ou rien (personne en poste).
    const etatMoisPaie = (y, m) => {
      const ym = `${y}-${String(m).padStart(2, '0')}`, mc = C.today().slice(0, 7);
      const premier = `${ym}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1);
      const enPoste = data.employees.some(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier));
      if (ym > mc) return ['vide', 'à venir'];
      if (!enPoste) return ['vide', '—'];
      // Avant le premier bulletin fait dans SkanFact, la paie était tenue ailleurs : rien à faire ici (un client arrivé en
      // octobre ne voit pas neuf mois « à faire »), comme la CNSS d'un trimestre sans bulletin (1.248.0).
      if (ym < premierMoisPaie) return ['vide', '—'];
      if (ym === mc) return ['', 'en cours'];
      if (C.missingPayslips(data, y, m).length) return ['ambre', 'à faire'];
      if (C.payslipsOf(data, y, m).some(b => !b.paidDate)) return ['ambre', 'à payer'];
      if (!(data.socialFilings || []).some(f => f.id === `dm-${ym}`)) {
        const dE = C.declarationMensuelleSalaires(data, y, m);
        if (!dE.salaries) return ['ok', 'payée'];
        return dE.dueDate < C.today() ? ['rouge', 'en retard'] : ['ambre', 'à déclarer'];
      }
      return ['ok', 'déclarée'];
    };
    const premierMoisPaie = (data.payslips || []).map(b => `${b.year}-${String(b.month).padStart(2, '0')}`).sort()[0] || C.today().slice(0, 7);
    const MOIS_CD = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const pMois = () => {
      const y = Number(s.year), annee = s.tab === 'annee', i = years.indexOf(s.year);
      const cases = MOIS_CD.map((nom, k) => {
        const [ton, dit] = etatMoisPaie(y, k + 1), on = !annee && Number(s.month) === k + 1;
        return `<button type="button" class="cp-mo ${ton}${on ? ' on' : ''}" data-p-mois="${k + 1}" aria-pressed="${on}" title="${h(`${MONTHS_LONG[k]} ${y} : ${dit}`)}"><b>${h(nom)}</b><small>${h(dit)}</small></button>`;
      }).join('');
      // Les années : ‹ › autour de l'année (les plus récentes d'abord dans `years`).
      return `<div class="cp-an pa-bande" role="group" aria-label="Le mois de la paie, ${y}"><span class="cp-an-t pa-bande-an">`
        + `<button type="button" class="pt-nav-b" id="p-an-prec" aria-label="Année précédente" ${i >= years.length - 1 ? 'disabled' : ''}>${ICONE_CHEVRON}</button>`
        + `<b id="p-an">${y}</b><button type="button" class="pt-nav-b pt-nav-s" id="p-an-suiv" aria-label="Année suivante" ${i <= 0 ? 'disabled' : ''}>${ICONE_CHEVRON}</button></span>`
        + `${cases}<button type="button" class="cp-ex${annee ? ' on' : ''}" data-p-mois="" aria-pressed="${annee}">Toute l'année</button></div>`;
    };
    // (plateforme) 1.226.0 — « Qui fait ta paie ? » (la maquette) : trois façons, ce que chacune change ; le choix vaut à
    // partir du mois suivant, les bulletins passés ne bougent pas, et on peut revenir en arrière.
    const PAIE_MODES = [['tenue', 'Mon cabinet la tient', 'tu pointes et tu paies ; ton comptable prépare, tu approuves, il valide et déclare'],
      ['seule', 'Je la fais, mon cabinet la vérifie', 'tu prépares les bulletins ; ton comptable les vérifie et propose ses corrections, que tu acceptes'],
      ['sans', 'Je la fais seul, sans cabinet', 'SkanFact contrôle tes bulletins ; tu déclares toi-même (déclaration du mois, fichier CNSS)']];
    // (plateforme) 1.227.0 — le mode qui vaut pour UN mois : le choix compte à partir de `paieModeDes`, avant c'est l'ancien.
    // Le bon à payer n'existe que si l'entreprise a dit que son cabinet tient la paie (un choix écrit, jamais déduit).
    const modeDuMois = (y, m) => { if (sansCabinetRelie()) return 'sans'; const co = company(), ym = `${y}-${String(m).padStart(2, '0')}`; return co.paieModeDes && ym < co.paieModeDes ? (co.paieModeAvant || '') : (co.paieMode || ''); };
    const bapDuMois = (y, m) => bapExige(y, m);
    // (plateforme) 1.235.0 — le bon à payer attend l'envoi du cabinet (docs/revue-paie-cabinet.md, P1) : un bulletin qu'il
    // prépare encore (sans `pourAccordLe`) ne s'approuve pas ; ceux qu'il a envoyés, oui. Un bulletin validé au cabinet est figé.
    const aApprouverDe = (mo, y, m) => (bapDuMois(y, m) ? mo.filter(x => !x.paidDate && !x.bonAPayerLe && x.pourAccordLe) : []);
    const enPreparationDe = (mo, y, m) => (bapDuMois(y, m) ? mo.filter(x => !x.paidDate && !x.bonAPayerLe && !x.pourAccordLe) : []);
    const paieMode = () => { if (sansCabinetRelie()) return 'sans'; const co = company(); return co.paieMode && PAIE_MODES.some(x => x[0] === co.paieMode) ? co.paieMode : (co.cabinet && co.cabinet.publicKey ? 'tenue' : 'sans'); };
    function quiFaitLaPaie() {
      const avant = paieMode();
      const des = C.addMonths(C.today().slice(0, 7) + '-01', 1, 1).slice(0, 7);
      modal(`<h2>Qui fait ta paie ?</h2><p class="small muted">aujourd'hui : ${h((PAIE_MODES.find(x => x[0] === avant) || [])[1] || '')}</p>
        <form id="qf" class="pa-choix">${PAIE_MODES.map(([k, n, d]) => `<label class="pa-choix-l"><input type="radio" name="mode" value="${k}" ${k === avant ? 'checked' : ''}><span><b>${h(n)}</b><small>${h(d)}</small></span></label>`).join('')}</form>
        <p class="small muted">Le changement vaut à partir de ${h(MONTHS_LONG[Number(des.slice(5, 7)) - 1])} : le mois en cours se finit comme il a commencé. Tes bulletins passés ne bougent pas, et tu peux revenir en arrière. Avec un cabinet, ce que dit ta lettre de mission compte (À VÉRIFIER avec lui).</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="qf-ok">${lfIc('coche', 15, 2.4)} <span>Garder ainsi</span></button></div>`, (root, fermer) => {
        // (1.257.0) Le bouton dit ce qu'il fait (la maquette) : « Garder ainsi » tant que rien ne change, « Enregistrer » sinon.
        $('#qf', root).onchange = () => { const m = formValues($('#qf', root)).mode; $('#qf-ok span', root).textContent = m && m !== avant ? 'Enregistrer' : 'Garder ainsi'; };
        $('#qf-ok', root).onclick = () => {
          const m = formValues($('#qf', root)).mode;
          if (!m || m === avant) { fermer(); return; }
          const co = company(), prec = { paieMode: co.paieMode, paieModeDes: co.paieModeDes, paieModeAvant: co.paieModeAvant };
          co.paieModeAvant = co.paieMode || ''; co.paieMode = m; co.paieModeDes = des;
          save(true); fermer(); draw();
          toastUndo(`À partir de ${MONTHS_LONG[Number(des.slice(5, 7)) - 1]} : ${(PAIE_MODES.find(x => x[0] === m) || [])[1]}`, () => { Object.assign(co, prec); ['paieMode', 'paieModeDes', 'paieModeAvant'].forEach(k => { if (prec[k] == null) delete co[k]; }); save(true); draw(); });
        };
      });
    }
    // Une pastille ne compte que ce qui est à faire, jamais un effectif (la maquette, « pastilles »).
    const aFaireSalaries = () => new Set(C.paieATraiter(data, C.today()).filter(x => x.vue === 'salaries').map(x => x.salarie)).size;
    $('#view').innerHTML = `<div class="pm" id="p-page">
      <div class="page-head lf-tete pa-tete" id="p-head">${pHead()}</div>
      ${data.employees.length ? '' : etatVide('Les salariés que tu paies', [
        'Ce module calcule les bulletins de paie à partir de barèmes que <b>tu règles toi-même</b> : CNSS, impôt sur le revenu, contribution de solidarité. Les valeurs livrées sont celles couramment appliquées en Tunisie, mais elles changent à chaque loi de finances — <em>fais valider les premiers bulletins par ton comptable avant de les remettre.</em>',
        'Commence par créer la fiche d\'un salarié, avec son brut mensuel.'],
        [['emp-first', '+ Créer mon premier salarié', true], ['emp-imp', 'Importer depuis un tableur']],
        { pied: 'Tes salariés sont déjà dans un tableau de paie ? Colle-le : toutes les fiches entrent d\'un coup, et tu vois ce qui manque avant d\'importer.' })}
      ${/* (1.248.1) Le mois (ou l'année) se choisit APRÈS les onglets : posé devant, il apparaissait sur certaines vues, pas
            sur d'autres, et changeait de largeur (« Novembre 2026 », « 2026 ») — les onglets glissaient sous la souris et un
            clic sur « Déclarations » ouvrait « Congés et absences » (recette du 02/11). */''}
      <div class="pa-vues" ${data.employees.length ? '' : 'hidden'}>
        <div class="pa-onglets" id="p-tabs"><div class="pa-seg" role="tablist" aria-label="La paie">${PAIE_VUES.map(([id, label]) =>
          `<button role="tab" data-tab="${id}" class="${id === (PAIE_VUE_DE[s.tab] || s.tab) ? 'active' : ''}" aria-selected="${id === (PAIE_VUE_DE[s.tab] || s.tab)}">${label}<small class="pa-af" data-af="${id}" hidden></small></button>`).join('')}</div>
          <button type="button" role="tab" data-tab="baremes" class="btn pa-reg${s.tab === 'baremes' ? ' active' : ''}" aria-selected="${s.tab === 'baremes'}">${lfIc('reglages', 15)} Réglages</button></div></div>
      <div class="pa-mois" id="p-mois"></div>
      <div id="p-sous"></div>
      <div id="p-body" class="pa"></div></div>`;

    // (plateforme) 1.222.0 — « Le mois », tel que la maquette : la frise du mois (pointer, établir, payer, remettre,
    // déclarer), « À traiter » (ce qui attend un geste), trois chiffres (le net à verser, le coût, l'État) et les bulletins,
    // ceux qui changent d'abord. Les chiffres de l'ANNÉE vivent dans « L'année ».
    // (plateforme) 1.227.0 — le bon à payer et la correction proposée par le cabinet (la maquette, lot 6).
    // Une correction vit sur le bulletin (`correction` : qui la propose, quand, pourquoi, les lignes avant/après, les champs
    // qu'elle change) ; elle ne s'applique que si l'entreprise l'accepte, et la trace reste écrite (qui, quand, la réponse).
    // Une fonction déclarée (et non une constante) : l'en-tête la lit avant que le corps de la route soit arrivé ici.
    function correctionEnAttente(x) { return !!(x && x.correction && !x.correction.reponse && !x.paidDate); }
    function bandeauxDuMois(month, y, m, bap) {
      const corr = month.find(x => correctionEnAttente(x));
      const mo = MONTHS_LONG[m - 1];
      if (corr) {
        const c = corr.correction, net0 = corr.c.net, lignes = Array.isArray(c.lignes) ? c.lignes : [];
        return `<div class="bandeau rouge pa-bandeau pa-rouge" id="p-corr" role="status">${lfIc('comptable', 18)}<span class="txt"><b>${h(c.par || 'Ton comptable')} propose une correction${c.titre ? ` : ${h(c.titre)}` : ` du bulletin de ${h(corr.employeeName)}`}</b><span>${c.le ? `Le ${h(C.fmtDate(C.jourDeLInstant(c.le)))}` : 'Proposée'}${c.motif ? ` : « ${h(c.motif)} »` : ''} Elle ne s'applique que si tu l'acceptes ; les autres bulletins ne bougent pas.</span></span><button type="button" class="btn" id="p-corr-non">Refuser, je m'en occupe</button></div>
          <section class="pa-carte" id="p-corr-detail"><div class="pa-carte-t"><b>La correction proposée · bulletin de ${h(corr.employeeName)}</b><span class="mu">avant, après</span></div>
          <div class="scroll-x"><table class="list compact"><thead><tr><th>Ligne</th><th class="r">Ton bulletin</th><th class="r">Corrigé</th></tr></thead><tbody>
          ${lignes.map(l => `<tr><td>${h(l.libelle || '')}</td><td class="r nw">${h(l.avant == null ? '—' : typeof l.avant === 'number' ? C.money(l.avant, cur) : l.avant)}</td><td class="r nw"><b>${h(l.apres == null ? '—' : typeof l.apres === 'number' ? C.money(l.apres, cur) : l.apres)}</b></td></tr>`).join('')}
          ${c.net != null ? `<tr><td>Net à verser</td><td class="r nw">${C.money(net0, cur)}</td><td class="r nw"><b>${C.money(Number(c.net), cur)}</b></td></tr>` : ''}
          </tbody></table></div><p class="small muted">Acceptée, la correction garde la trace de qui l'a proposée et de qui l'a acceptée, sur le bulletin.</p></section>`;
      }
      const acc = month.filter(x => x.correction && x.correction.reponse === 'acceptee').sort((a, b) => String(b.correction.reponduLe || '').localeCompare(String(a.correction.reponduLe || '')))[0];
      const aApprouver = aApprouverDe(month, y, m), enPrep = enPreparationDe(month, y, m);
      const demander = peutEcrireAuCabinet() ? '<button type="button" class="btn" id="p-dem-corr">Demander une correction…</button>' : '';
      if (enPrep.length && !aApprouver.length && !C.missingPayslips(data, y, m).length) return `<div class="bandeau info pa-bandeau" id="p-prep-b" role="status">${lfIc('comptable', 18)}<span class="txt"><b>${enPrep.length > 1 ? `Ton cabinet prépare tes ${enPrep.length} bulletins de ${h(mo)}` : `Ton cabinet prépare le bulletin de ${h(enPrep[0].employeeName)}`}</b><span>Il te les envoie quand ils sont prêts : tu les approuves alors (ton « bon à payer »), puis tu paies. Rien à faire d'ici là.</span></span>${demander}</div>`;
      if (aApprouver.length && !C.missingPayslips(data, y, m).length) return `<div class="bandeau info pa-bandeau" id="p-bap-b" role="status">${lfIc('comptable', 18)}<span class="txt"><b>${aApprouver.length > 1 ? `Tes ${aApprouver.length} bulletins de ${h(mo)} sont prêts : approuve-les avant de payer` : `Le bulletin de ${h(aApprouver[0].employeeName)} est prêt : approuve-le avant de payer`}</b><span>C'est ton « bon à payer » : tu regardes ce que chacun touchera et ce que la paie te coûte. Un bulletin changé après ton accord se réapprouve.${demander ? ' Un doute : demande une correction à ton comptable, il te répond dans votre conversation.' : ''}</span></span>${demander}</div>`;
      // (1.256.0) Un virement de salaire revenu (la maquette, « Un virement de salaire rejeté ») : qui, combien, pourquoi, et les
      // deux gestes — repayer (en espèces contre reçu, ou par un nouveau virement), saisir son nouveau RIB.
      const rev = month.find(x => !x.paidDate && Array.isArray(x.paiementsAnnules) && x.paiementsAnnules.length);
      if (rev) {
        const der = rev.paiementsAnnules[rev.paiementsAnnules.length - 1], e = employeeById(rev.employeeId) || {};
        return `<div class="bandeau rouge pa-bandeau pa-rouge" id="p-rev-b" role="status">${lfIc('alerte', 18)}<span class="txt"><b>Le salaire de ${h(rev.employeeName)} n'est pas arrivé : ${C.money(rev.c.net, cur)}</b><span>${h(der.raison || 'Paiement annulé')} le ${C.fmtDate(der.le)} (payé le ${C.fmtDate(der.paidDate)}). Son bulletin reste juste ; c'est le paiement qui est à refaire. Le retard se dit à ${h(String(rev.employeeName || '').split(' ')[0])} : c'est son salaire.</span></span>
          <button type="button" class="btn btn-sm" id="p-rev-rib">${lfIc('carte', 14)} ${e.iban ? 'Changer son RIB' : 'Saisir son RIB'}</button><button type="button" class="btn btn-sm btn-primary" id="p-rev-payer">Repayer ${h(String(rev.employeeName || '').split(' ')[0])} · ${C.money(rev.c.net, cur)}</button></div>`;
      }
      if (acc) return `<div class="bandeau info pa-bandeau" id="p-corr-acc" role="status">${lfIc('coche', 18)}<span class="txt"><b>Correction acceptée : le bulletin de ${h(acc.employeeName)}</b><span>Proposée par ${h(acc.correction.par || 'ton comptable')}${acc.correction.le ? ` le ${h(C.fmtDate(C.jourDeLInstant(acc.correction.le)))}` : ''}, acceptée par toi le ${h(C.fmtDate(C.jourDeLInstant(acc.correction.reponduLe || C.today())))} ; le bulletin le garde écrit.</span></span><button type="button" class="btn" id="p-corr-voir">Voir le bulletin</button></div>`;
      return '';
    }
    function lierBandeauxDuMois(month, y, m) {
      const corr = month.find(x => correctionEnAttente(x));
      if ($('#p-corr-non') && corr) $('#p-corr-non').onclick = () => refuserCorrection(corr);
      if ($('#p-dem-corr')) $('#p-dem-corr').onclick = () => demanderCorrection(month, y, m);
      const acc = $('#p-corr-voir') && month.find(x => x.correction && x.correction.reponse === 'acceptee');
      if (acc) $('#p-corr-voir').onclick = () => apercuBulletin(acc);
      const rev = month.find(x => !x.paidDate && Array.isArray(x.paiementsAnnules) && x.paiementsAnnules.length);
      if (rev && $('#p-rev-payer')) $('#p-rev-payer').onclick = () => payerSalairesFenetre(y, m, () => draw());
      if (rev && $('#p-rev-rib')) $('#p-rev-rib').onclick = () => { const e = employeeById(rev.employeeId); if (e) employeeForm(e, () => draw(), { focus: 'iban' }); };
    }
    function approuverBulletins(y, m) {
      const L = aApprouverDe(C.payslipsOf(data, y, m), y, m);
      if (!L.length) return;
      if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
      const jour = C.today(), ids = L.map(x => x.id);
      ids.forEach(id => { const p = payslipById(id); if (p) p.bonAPayerLe = jour; });
      save(true); draw();
      toastUndo(`${L.length > 1 ? `${L.length} bulletins approuvés` : 'Bulletin approuvé'} : tu peux payer · ${C.money(C.round3(L.reduce((a, x) => a + x.c.net, 0)), cur)}`, () => { ids.forEach(id => { const p = payslipById(id); if (p) delete p.bonAPayerLe; }); save(true); draw(); });
    }
    function accepterCorrection(x) {
      const p = payslipById(x.id), emp = employeeById(x.employeeId);
      if (!p || !emp || !correctionEnAttente(p)) return;
      if (closedBlock(C.payslipDate(p), 'Ce bulletin')) return;
      if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
      const st = C.payrollSettings(data), champs = p.correction.champs && typeof p.correction.champs === 'object' ? p.correction.champs : {};
      const avant = JSON.parse(JSON.stringify(p));
      const input = { year: p.year, month: p.month, gross: p.gross, workedDays: p.workedDays, absentDays: p.absentDays, bonuses: p.bonuses || [], deductions: p.deductions || [], ...champs };
      const juge = C.saisiePaieValide(input, emp, st);
      if (!juge.ok) { toast(`La correction ne s'applique pas : ${juge.motif}`, true); return; }
      Object.assign(p, champs, { computed: C.computePayslip(emp, input, st) });
      p.correction = { ...p.correction, reponse: 'acceptee', reponduLe: new Date().toISOString() };
      if (p.bonAPayerLe) delete p.bonAPayerLe;
      save(true); draw();
      toastUndo(`Correction acceptée : le bulletin de ${emp.name} passe à ${C.money(p.computed.net, cur)} net`, () => { const q = payslipById(x.id); if (q) { Object.keys(q).forEach(k => { delete q[k]; }); Object.assign(q, avant); save(true); draw(); } });
    }
    function refuserCorrection(x) {
      modal(`<h2>Refuser la correction</h2><p class="small muted">Le bulletin de ${h(x.employeeName)} reste le tien ; ton comptable le saura.</p>
        <form id="rc"><label class="field">${lbl('Ta raison', 'pay.raisonRefus')}<textarea name="raison" rows="3" maxlength="500" placeholder="Par exemple : je lui ai déjà retenu l'avance en espèces."></textarea></label></form>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="rc-ok">Refuser la correction</button></div>`, (root, fermer) => {
        $('#rc-ok', root).onclick = () => {
          const p = payslipById(x.id); if (!p || !correctionEnAttente(p)) { fermer(); return; }
          if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
          const raison = String(formValues($('#rc', root)).raison || '').trim().slice(0, 500);
          const avant = { ...p.correction };
          p.correction = { ...p.correction, reponse: 'refusee', reponduLe: new Date().toISOString(), ...(raison ? { raison } : {}) };
          save(true); fermer(); draw();
          toastUndo(`Correction refusée : le bulletin de ${x.employeeName} reste le tien${raison ? ', ta raison reste écrite' : ''}`, () => { const q = payslipById(x.id); if (q) { q.correction = avant; save(true); draw(); } });
        };
      });
    }
    function demanderCorrection(month, y, m) {
      if (!month.length) return;
      // (1.258.0, la maquette O25) La ligne du bulletin qui ne va pas (celles de CE bulletin), à côté du bulletin ; la règle
      // dit ce qui se passe ensuite : le comptable corrige, le bulletin revient à approuver, rien ne change sans toi.
      const lignesDe = x => { const c = x.c || {}; return ['Salaire de base', ...(c.bonuses || []).map(b => b.label || 'Prime'), 'Les jours payés (le pointage)', 'CNSS', 'Impôt sur le revenu (IRPP)', ...(Number(c.css) ? ['Contribution sociale de solidarité'] : []), ...(c.deductions || []).map(d => d.label || 'Retenue'), 'Autre chose'].filter((l, i, a) => a.indexOf(l) === i); };
      modal(`<h2>Demander une correction à ton comptable</h2><p class="small muted">ta demande part dans votre conversation, avec le bulletin concerné : tu la relis avant de l'envoyer</p>
        <form id="dco"><div class="grid-2"><label class="field">${lbl('Le bulletin', 'pay.bulletin')}<select name="bul">${month.map(x => `<option value="${h(x.id)}">${h(x.employeeName)} · ${h(MONTHS_LONG[m - 1])}</option>`).join('')}</select></label>
        <label class="field">${lbl('La ligne', 'pay.correctionLigne')}<select name="ligne" id="dco-ligne"></select></label></div>
        <label class="field obligatoire">${lbl('Ce qui ne va pas', 'pay.correction')}<textarea name="texte" rows="3" maxlength="800" placeholder="Par exemple : les 16 et 17 étaient des congés payés, pas sans solde."></textarea></label></form>
        <p class="regle">${lfIc('aide', 14)} Ton comptable corrige et te renvoie le bulletin à approuver. Rien ne change sans que tu le voies.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="dco-ok">${lfIc('message', 15)} Écrire à mon comptable</button></div>`, (root, fermer) => {
        const bul = () => month.find(b => b.id === $('#dco [name=bul]', root).value) || month[0];
        const majLignes = () => { $('#dco-ligne', root).innerHTML = lignesDe(bul()).map(l => `<option>${h(l)}</option>`).join(''); };
        majLignes();
        $('#dco [name=bul]', root).onchange = majLignes;
        $('#dco-ok', root).onclick = () => {
          const v = formValues($('#dco', root)), x = bul();
          const texte = String(v.texte || '').trim();
          if (!texte) { const z = $('textarea[name=texte]', root); z.focus(); toast('Écris ce qui ne va pas : c’est ce que ton comptable lira.', true); return; }
          const message = `Bulletin de ${x.employeeName}, ${MONTHS_LONG[m - 1]} ${y} (net ${C.money(x.c.net, cur)})${v.ligne && v.ligne !== 'Autre chose' ? `, la ligne « ${v.ligne} »` : ''} : ${texte}`;
          fermer(); ecrireAuComptable(message);
        };
      });
    }
    // (plateforme) 1.228.0 — déposée ET payée : le montant de la déclaration (jamais retapé), le jour, le compte, le mode.
    function payerDeclarationFenetre(id, label) {
      const m = C.montantSocial(data, id);
      if (!m) return;
      if (enLecture('socialFilings')) { toast(refusLecture('socialFilings'), true); return; }
      if (!(m.montant > 0)) { toast('Cette déclaration ne fait rien payer : aucun bulletin n’y entre.', true); return; }
      const comptes = data.accounts || [];
      const parDefaut = comptes.find(a => a.isDefault) || comptes[0] || null;
      // (1.258.0, la maquette O17) La déclaration du mois montre ce qu'elle reporte, ligne par ligne (les montants des
      // bulletins, la base de chacun), et son tableur ; le geste reste « Noter déposée et payée ».
      const dmYm = /^dm-(\d{4})-(\d{2})$/.exec(id), dmD = dmYm ? C.declarationMensuelleSalaires(data, Number(dmYm[1]), Number(dmYm[2])) : null;
      const pct = n => `${String(n).replace('.', ',')} %`;
      const sousLigne = r => r.bareme ? `base ${C.money(r.base, cur)}` : r.taux != null ? `${pct(r.taux)} de ${C.money(r.base, cur)}` : '';
      modal(`<h2>${dmD ? `Ta déclaration ${/^[aeiouyéè]/i.test(MONTHS_LONG[Number(dmYm[2]) - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[Number(dmYm[2]) - 1])}, la part paie` : 'Déposée et payée'}</h2><p class="small muted">${h(label.charAt(0).toUpperCase() + label.slice(1))} · à payer avant le ${h(C.fmtDate(m.echeance))} (À VÉRIFIER : l'échéance de ton dossier)</p>
        ${dmD ? `<table class="mini lu pd-t" id="pd-t"><thead><tr><th>À reporter</th><th class="r">Montant</th></tr></thead><tbody>
          ${dmD.lignes.filter(r => Number(r.montant) > 0).map(r => `<tr><td>${h(r.libelle)}${sousLigne(r) ? `<small>${h(sousLigne(r))}</small>` : ''}</td><td class="r">${h(C.money(r.montant, cur))}</td></tr>`).join('')}
          </tbody><tfoot><tr><td><b>À verser avant le ${h(C.fmtDate(m.echeance))}</b></td><td class="r"><b id="pd-montant">${h(C.money(m.montant, cur))}</b></td></tr></tfoot></table>
          <p class="regle">${lfIc('aide', 14)} Ces montants vont sur la même déclaration que ta TVA du mois. Tu la déposes et tu la paies sur le site des impôts (À VÉRIFIER : la marche à suivre), puis tu la marques ici, avec sa date et sa référence : la Banque reconnaîtra le paiement.</p>`
          : `<div class="pa-kv"><span>Montant</span><b id="pd-montant">${h(C.money(m.montant, cur))}</b></div>`}
        <p class="small muted">Le montant de la déclaration, calculé sur les bulletins : il ne se retape pas. Une pénalité de retard se note à part, en mouvement de trésorerie.</p>
        <form id="pd">${dateFieldHtml(lbl('Payée le', 'soc.payeLe'), 'paidDate', C.today(), { obligatoire: true })}
          <label class="field">${lbl('Depuis le compte', 'soc.compte')}<select name="accountId">${comptes.map(a => `<option value="${h(a.id)}" ${parDefaut && a.id === parDefaut.id ? 'selected' : ''}>${h(a.name)}</option>`).join('') || '<option value="">Compte principal</option>'}</select></label>
          <label class="field">${lbl('Mode', 'soc.mode')}<select name="method"><option value="virement">Virement</option><option value="cheque">Chèque</option><option value="especes">Espèces</option></select></label>
          <label class="field">${lbl('Référence', 'soc.ref')}<input name="reference" maxlength="80" placeholder="n° de quittance, de virement"></label></form>
        ${avertValideHtml('pd-valide')}
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button>${dmD ? `<button type="button" class="btn" id="pd-csv">${lfIc('exporter', 15)} Tableur</button>` : ''}<button type="button" class="btn btn-primary" id="pd-ok">${lfIc('coche', 15, 2.4)} Noter déposée et payée</button></div>`, (root, fermer) => {
        if ($('#pd-csv', root)) $('#pd-csv', root).onclick = async () => {
          const cols = [{ key: 'libelle', label: 'Impôt ou taxe' }, { key: 'base', label: 'Base', type: 'money' },
            { key: 'taux', label: 'Taux (%)', get: r => r.bareme ? 'barème' : r.taux == null ? '' : String(r.taux).replace('.', ',') }, { key: 'montant', label: 'Montant', type: 'money' }];
          const f = await bridge.saveText(`declaration-mensuelle-salaires-${dmYm[1]}-${dmYm[2]}.csv`, C.toCsv(dmD.lignes.concat([{ libelle: 'À reverser au Trésor', base: '', taux: null, montant: dmD.total }]), cols));
          if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
        };
        // (1.305.0) Payée à une date de la période que le cabinet a validée : la phrase pendant la saisie de la date.
        const majValidePd = () => { const d = formValues($('#pd', root)).paidDate; majAvertValide($('#pd-valide', root), d ? dateDansLaPeriodeValidee([d], majValidePd) : '', d, { sujet: 'Ce paiement', fem: false, neuve: true, geste: 'En le notant' }); };
        $('#pd', root).addEventListener('input', majValidePd);
        $('#pd', root).addEventListener('change', majValidePd);
        majValidePd();
        $('#pd-ok', root).onclick = () => {
          const v = formValues($('#pd', root));
          if (!v.paidDate) { toast('Dis quel jour elle a été payée.', true); return; }
          if (closedBlock(v.paidDate, 'Ce paiement')) return;
          const dvPd = dateDansLaPeriodeValidee([v.paidDate]);
          if (!Array.isArray(data.socialFilings)) data.socialFilings = [];
          data.socialFilings = data.socialFilings.filter(x => x.id !== id);
          data.socialFilings.push({ id, filedAt: C.today(), label, paidDate: v.paidDate, amount: m.montant, parts: m.parts, accountId: v.accountId || '', method: v.method || 'virement', reference: String(v.reference || '').trim() });
          save(true); fermer(); draw();
          if (dvPd) { direAuComptableApres('Déclaration notée payée', { fait: 'de noter', fem: false, quoi: `un paiement daté du ${C.fmtDate(dvPd)} (${label}, ${C.money(m.montant, cur)})` }); return; }
          toastUndo(`Noté : ${label} déposée et payée · ${C.money(m.montant, cur)} sortis de la trésorerie`, () => { data.socialFilings = (data.socialFilings || []).filter(x => x.id !== id); save(true); draw(); });
        };
      });
    }
    // (plateforme) 1.228.0 — un virement de salaire rejeté par la banque, des jours après : le bulletin redevient à payer,
    // la raison et l'ancien paiement restent écrits. Pointé sur un relevé, il se dépointe d'abord.
    async function annulerPaiementSalaire(x) {
      const p = payslipById(x.id); if (!p || !p.paidDate) return;
      if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
      if (p.reconciled) { toast('Ce salaire est pointé sur un relevé de banque : dépointe-le d’abord dans la trésorerie.', true); return; }
      if (closedBlock(p.paidDate, 'Ce paiement')) return;
      // (1.305.0) Payé dans la période que le cabinet a validée : chez lui, son annulation s'écrit au premier jour encore ouvert.
      await periodeValideeLue();
      const dvAp = dateDansLaPeriodeValidee([p.paidDate]);
      modal(`<h2>Annuler le paiement</h2><p class="small muted">Le salaire de ${h(x.employeeName)} (${h(C.money(x.c.net, cur))}, payé le ${h(C.fmtDate(p.paidDate))}) redevient à payer ; l'argent revient dans la trésorerie.</p>
        ${dvAp ? `<p class="cab-valide" id="ap-valide" role="status">${lfIc('aide', 15)}<span>${h(phraseAnnulationValidee(dvAp, { sujet: 'Il', fem: false }))}</span></p>` : ''}
        <form id="ap"><label class="field obligatoire">${lbl('Pourquoi', 'pay.annulePaiement')}<select name="raison"><option>Virement rejeté par la banque</option><option>RIB erroné</option><option>Payé par erreur</option><option>Autre</option></select></label></form>
        <div class="modal-actions"><button type="button" class="btn" data-close>Garder le paiement</button><button type="button" class="btn btn-primary" id="ap-ok">Annuler le paiement</button></div>`, (root, fermer) => {
        $('#ap-ok', root).onclick = () => {
          const q = payslipById(x.id); if (!q || !q.paidDate) { fermer(); return; }
          const avant = { paidDate: q.paidDate, accountId: q.accountId || '', paiementsAnnules: q.paiementsAnnules };
          q.paiementsAnnules = [...(Array.isArray(q.paiementsAnnules) ? q.paiementsAnnules : []), { paidDate: q.paidDate, accountId: q.accountId || '', le: C.today(), raison: String(formValues($('#ap', root)).raison || '') }];
          q.paidDate = ''; q.accountId = '';
          save(true); fermer(); draw();
          if (dvAp) { direAuComptableApres(`Paiement ${deDit(x.employeeName)} annulé`, { fait: 'd\'annuler', fem: false, annule: true, quoi: `le paiement du salaire ${deDit(x.employeeName)} ${deDit(`${MONTHS_LONG[Number(q.month) - 1]} ${q.year}`)}, daté du ${C.fmtDate(dvAp)} (${C.money(x.c.net, cur)})` }); return; }
          toastUndo(`Paiement de ${x.employeeName} annulé : son salaire est de nouveau à payer`, () => { const r = payslipById(x.id); if (r) { Object.assign(r, avant); if (!avant.paiementsAnnules) delete r.paiementsAnnules; save(true); draw(); } });
        };
      });
    }
    // (plateforme) 1.266.3 — un mois après la dernière loi de finances relue (cadrage 16 § 3.7, § 10.1 point 1) : la page et
    // la fenêtre « Établir » le disent avant le geste, sans bloquer. Une seule phrase pour les deux.
    const relusDit = (r, m) => `<b>Barèmes de ${r.annee} pas encore relus.</b> SkanFact n'a pas encore lu la loi de finances ${r.annee} : les bulletins ${/^[aeiouyéèh]/i.test(MONTHS_LONG[m - 1]) ? 'd’' : 'de '}${h(MONTHS_LONG[m - 1])} ne retiennent aucune contribution sociale de solidarité (sa règle s'arrête le ${C.fmtDate(C.CSS_JUSQU_AU)}) et gardent les autres taux de tes réglages. <em>À VÉRIFIER avec ton comptable avant de payer.</em>`;
    function drawSlips() {
      const y = Number(s.year), m = Number(s.month);
      const nonRelus = C.baremesNonRelus(y, m);
      const month = C.payslipsOf(data, y, m);
      const missing = C.missingPayslips(data, y, m);
      const mp = C.moisDePaie(data);
      const ailleurs = !month.length && !missing.length && (mp.year !== y || mp.month !== m)
        && (C.missingPayslips(data, mp.year, mp.month).length || C.payslipsOf(data, mp.year, mp.month).length) ? mp : null;
      const vieuxTaux = C.tauxAvant2026(data);
      const bap = bapDuMois(y, m);
      const r = C.paieDuMois(data, y, m, { bap });
      // (1.267.0) La frise du mois est devenue les quatre étapes, au-dessus (`etapesDuMois`) ; « À traiter » est passé sur
      // « Aujourd'hui » (« À ne pas oublier »). Les contrôles s'y réfèrent encore.
      const traiter = C.paieATraiter(data, C.today());
      const ban = bandeauxDuMois(month, y, m, bap);
      // (plateforme) 1.227.0 — les contrôles des bulletins, tant qu'il reste à payer : ceux qui demandent un geste en tête,
      // trois justes ensuite, les autres à un clic (la maquette, « Ce que … a contrôlé »).
      // (plateforme) 1.234.0 — les contrôles servent à décider : avant l'accord (bon à payer), ou, sans bon à payer, tant que rien
      // n'est payé (la maquette : approuvés, les bulletins ne les montrent plus).
      const ctl = month.length && (bap ? month.some(x => !x.paidDate && !x.bonAPayerLe) : month.some(x => !x.paidDate) && !month.some(x => x.paidDate)) ? C.controlesDuMois(data, y, m) : [];
      const ctlKo = ctl.filter(c => !c.ok), ctlVus = s.ctlTout ? ctl : ctlKo.concat(ctl.filter(c => c.ok).slice(0, 3));
      // (1.256.0) Sans cabinet, personne ne vérifie les bulletins : SkanFact le dit en tête, et mène à ses contrôles (la maquette,
      // « Sans cabinet : le mois »).
      const sansCab = modeDuMois(y, m) === 'sans';
      const banSans = ctl.length && sansCab && !ban ? `<div class="bandeau gris pa-bandeau" id="p-sans-b" role="status">${lfIc('coche', 18)}<span class="txt"><b>Personne ne vérifie tes bulletins : SkanFact les a contrôlés</b><span>${pl(ctl.length, 'contrôle')} avant que tu les paies (SMIG, écarts, férié, avance, CNSS, RIB) : ${ctlKo.length ? `${pl(ctlKo.length, 'chose')} à savoir` : 'tout est juste'}. Un cabinet peut les vérifier pour toi, chaque mois.</span></span><button type="button" class="btn" id="p-sans-voir">Voir les contrôles</button></div>` : '';
      // (1.256.0) La carte des contrôles, dans la page, sert au bon à payer (la maquette, « Bon à payer : approuver ») ; sans
      // cabinet, le bandeau gris ouvre la fenêtre de tous les contrôles (« Les 12 contrôles »).
      const controles = ctl.length && !sansCab ? `<div class="apy carte" id="p-ctrl"><div class="apy-t"><b>Ce que SkanFact a contrôlé</b><span class="mu">${pl(ctl.length, 'contrôle')} · ${pl(ctl.length - ctlKo.length, 'juste', 'justes')}${ctlKo.length ? ` · ${ctlKo.length} à savoir` : ''}</span></div>
        <ul class="apy-l">${ctlVus.map(c => {
          // (1.248.1) Un manque que « À traiter » porte déjà (son bouton « Compléter ») ne se répète pas ici, nom par nom.
          const dejaLa = !c.ok && ((c.id === 'cnss' && traiter.some(x => x.focus === 'cnss')) || (c.id === 'rib' && traiter.some(x => x.focus === 'iban')));
          const dit = dejaLa ? 'à compléter : chaque fiche est dans « À ne pas oublier », sur Aujourd\'hui, avec son bouton' : c.dit;
          return `<li class="${c.ok ? 'ok' : 'ko'}"><span class="apy-ok" style="justify-self:center;color:var(--${c.ok ? 'sarcelle-texte' : 'ambre-texte'})">${lfIc(c.ok ? 'coche' : 'aide', 16, 2.2)}</span><span class="apy-n"><b>${h(c.titre)}</b>${dit ? `<small title="${h(dit)}">${h(dit)}</small>` : ''}</span><span></span><span></span><span></span></li>`;
        }).join('')}</ul>
        ${ctl.length > ctlVus.length ? `<button type="button" class="apy-plus" id="p-ctrl-tout">${pl(ctl.length - ctlVus.length, 'autre contrôle juste', 'autres contrôles justes')} · tout voir</button>` : ''}</div>` : '';
      const tuile = (lbl, val, sub, aide) => `<div class="tuile fixe"><span class="tu-t">${lbl} ${info(aide)}</span><b class="tu-m">${montantU(val, cur)}</b><span class="tu-s">${sub}</span></div>`;
      const tuiles = month.length ? `<div class="tuiles t3" id="p-chiffres">${tuile(month.every(x => x.paidDate) ? 'Net versé' : 'Net à verser', r.net, r.netDit, 'pay.netVerse')}${tuile('Coût de la paie', r.cout, h(r.coutDit), 'pay.employerCost')}${tuile('Impôts et CNSS à verser', r.etat, h(r.etatDit), 'pay.impot')}</div>` : '';
      // Un statut que tous les bulletins partagent se dit une fois, en bas ; « Comment » s'appelle « Payé par ».
      const statut = x => correctionEnAttente(x) ? '<span class="statut alerte">correction proposée</span>' : bap && !x.paidDate && !x.bonAPayerLe ? (x.pourAccordLe ? '<span class="statut attire">à approuver</span>' : '<span class="statut">au cabinet</span>') : x.paidDate ? (x.remisLe ? `<span class="statut ok">payé, remis</span>` : `<span class="statut ok">payé le ${C.fmtDate(x.paidDate)}</span>`) : '<span class="statut bleu">à payer</span>';
      const uni = month.every(x => statut(x) === statut(month[0]));
      const paye = x => x.method === 'especes' ? '<span class="ambre">espèces</span><small>contre reçu</small>' : `virement${x.employee.iban ? `<small>··· ${h(String(x.employee.iban).replace(/\s/g, '').slice(-4))}</small>` : '<small class="ambre">RIB à demander</small>'}`;
      const ecart = x => { const a = r.avant[x.employeeId]; return a == null ? '<small>1er bulletin</small>' : Math.abs(x.c.net - a) < 0.0005 ? '' : `<small>${x.c.net > a ? '+' : '−'} ${C.money(Math.abs(C.round3(x.c.net - a)), cur)}</small>`; };
      // (plateforme) 1.234.0 — ce qui change ce mois, en étiquette sous le nom (la maquette) : les heures sup, l'absence non payée,
      // l'entrée ou la sortie au prorata, l'avance retenue, la saisie, la régularisation ; sinon « comme <mois d'avant> ».
      const nb = v => String(C.round3(v)).replace('.', ',');
      const quoi = x => {
        const L = [];
        const hs = (x.bonuses || []).filter(b => /suppl|h sup/i.test(b.label || ''));
        if (hs.length) L.push(['attire', hs.map(b => b.label).join(', ').replace(/^Heures supplémentaires/i, 'heures sup'), '']);
        if (Number(x.absentDays) > 0) L.push(['attire', `${nb(x.absentDays)} jour${Number(x.absentDays) > 1 ? 's' : ''} sans solde`, '']);
        if (x.prorata) L.push(['bleu', x.prorata.motif || 'prorata', `${nb(x.prorata.jours)} jours sur ${nb(x.prorata.sur)}`]);
        (x.deductions || []).filter(d => d.advanceId).forEach(d => L.push(['', 'avance retenue', C.money(d.amount, cur)]));
        (x.deductions || []).filter(d => d.saisieId).forEach(d => L.push(['', 'saisie sur salaire', C.money(d.amount, cur)]));
        (x.bonuses || []).filter(b => b.regulId).forEach(b => L.push(['bleu', 'régularisation', C.money(b.amount, cur)]));
        // (1.248.1) « comme octobre » ne se répète plus sur chaque ligne : le groupe « Comme octobre » le dit une fois.
        return L.slice(0, 2).map(([ton, t, d]) => `<small class="mu pa-quoi"><span class="statut ${ton}" style="font-size:11px;padding:1px 7px">${h(t)}</span>${d ? ` ${h(d)}` : ''}</small>`).join('');
      };
      // La retenue d'une avance se dit sous les retenues (« dont avance 100,000 »), comme la maquette.
      const avR = x => C.round3((x.deductions || []).filter(d => d.advanceId).reduce((a, d) => a + (Number(d.amount) || 0), 0));
      const lig = x => `<tr data-bul="${h(x.id)}"><td class="cl"><span class="cl-i">${pmAvDe(x.employeeName)}<span><b>${h(x.employeeName)}</b>${x.employee.position ? `<small>${h(x.employee.position)}</small>` : ''}${quoi(x)}</span></span></td>
        <td class="r m">${C.money(x.c.gross, '')}</td><td class="r m">${C.money(C.round3(x.c.gross - x.c.net), '')}${avR(x) ? `<small>dont avance ${C.money(avR(x), '')}</small>` : ''}</td><td class="r m"><b>${C.money(x.c.net, '')}</b>${ecart(x)}</td>
        <td class="nw pa-par">${paye(x)}</td>${uni ? '' : `<td>${statut(x)}</td>`}${rowMenuCell(x.id, `<button type="button" class="btn mini" data-voir-b="${h(x.id)}">${lfIc('oeil', 14)} Bulletin</button>`)}</tr>`;
      const change = month.filter(x => r.avant[x.employeeId] == null || Math.abs(x.c.net - r.avant[x.employeeId]) >= 0.0005), pareil = month.filter(x => !change.includes(x));
      // Une page à la fois, les deux groupes gardent leur titre (et leur compte entier) ; la barre dit où on est.
      const bulPage = paginate(change.concat(pareil), s.bul), chgP = bulPage.rows.filter(x => change.includes(x)), parP = bulPage.rows.filter(x => !change.includes(x));
      const nc = uni ? 6 : 7;
      $('#p-body').innerHTML = `
        ${vieuxTaux.length ? `<div class="warn-box mb" id="p-2026"><span>Tes barèmes gardent des taux d'avant 2026 (${vieuxTaux.map(x => `${h(x.libelle)} ${pct(x.garde)} %`).join(', ')}) : les bulletins que tu établis les appliquent.</span> <button type="button" class="btn btn-sm" id="p-2026-voir">Voir les réglages</button></div>` : ''}
        ${nonRelus ? `<div class="warn-box mb" id="p-relus"><span>${relusDit(nonRelus, m)}</span></div>` : ''}
        ${missing.length && avant25(y, m) ? `<div class="bandeau info pa-bandeau" id="p-25-b" role="status">${lfIc('echeance', 18)}<span class="txt"><b>Les bulletins ${/^[aeiouyéè]/i.test(MONTHS_LONG[m - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[m - 1])} se préparent à partir du 25/${String(m).padStart(2, '0')}</b><span>D'ici là, le pointage continue chaque jour. Le 25, les jours qui restent sont comptés présents, et ce qui change ensuite se régularise sur le mois suivant.</span></span></div>`
          : missing.length && bloquantsDe(y, m).length ? `<div class="bandeau ambre pa-bandeau pa-ambre" id="p-regler-b" role="status">${lfIc('alerte', 18)}<span class="txt"><b>Les bulletins attendent : ${pl(bloquantsDe(y, m).length, 'chose')} à régler dans le pointage</b><span>${bloquantsDe(y, m).length > 1 ? 'Chacune change un montant' : 'Elle change un montant'} : une journée pas validée, une sortie que la pointeuse n'a pas reçue, une demande sans réponse. L'étape « Pointer » les montre, chacune avec son bouton.</span></span></div>` : ''}
        ${ban}${banSans}${controles}${tuiles}
        ${!month.length && missing.length ? `${moisPointageHtml(y, m)}${variablesCarte(y, m)}` : ''}
        <div class="carte tab" id="p-bulletins">${month.length ? `<table class="liste list pa-liste"><thead><tr><th style="width:34%">Salarié</th><th class="r">Brut</th><th class="r">Retenues ${info('pay.impot')}</th><th class="r">Net à verser</th><th>Payé par</th>${uni ? '' : '<th>Statut</th>'}<th style="width:150px" class="row-actions-h"></th></tr></thead><tbody>
            ${chgP.length ? `<tr class="mois pa-groupe"><td colspan="${nc}"><b style="text-transform:none">Ce qui change ce mois</b> <span>${pl(change.length, 'salarié')}</span></td></tr>${chgP.map(lig).join('')}` : ''}
            ${parP.length ? `<tr class="mois pa-groupe"><td colspan="${nc}"><b style="text-transform:none">Comme ${h(MONTHS_LONG[r.moisAvant - 1])}</b> <span>${pl(pareil.length, 'salarié')}</span></td></tr>${parP.map(lig).join('')}` : ''}</tbody>
            <tfoot><tr class="pa-pied"><td><span class="pied-t"><b>${pl(month.length, 'bulletin')} ${/^[aeiouyéè]/i.test(MONTHS_LONG[m - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[m - 1])}</b>${(n => n ? `<span>${h(MONTHS_LONG[(m + 10) % 12])} : ${n}</span>` : '')(C.payslipsOf(data, m === 1 ? Number(s.year) - 1 : Number(s.year), m === 1 ? 12 : m - 1).length)}${missing.length ? `<span class="ambre">${pl(missing.length, 'bulletin')} encore à établir</span>` : ''}</span></td>
              <td class="r m">${C.money(C.round3(month.reduce((a, x) => a + x.c.gross, 0)), '')}</td>
              <td class="r m">${C.money(C.round3(month.reduce((a, x) => a + x.c.gross - x.c.net, 0)), '')}</td>
              <td class="r m"><b>${montantU(C.round3(month.reduce((a, x) => a + x.c.net, 0)), cur)}</b></td>
              <td colspan="${nc - 4}" class="nw">${uni ? `<span class="mu" style="font-size:12.5px;display:inline">${month.length > 1 ? `les ${month.length} :` : ''}</span> ${statut(month[0])}` : ''}</td></tr></tfoot>
          </table>${pagerBar(bulPage.pg, { noun: 'bulletin' })}`
            : `<div class="empty" id="p-vide">${missing.length
              ? modeDuMois(y, m) === 'tenue'
                ? `Aucun bulletin pour ${h(MONTHS_LONG[m - 1])} ${h(s.year)} : ton cabinet prépare les ${missing.length > 1 ? `${missing.length} bulletins` : 'bulletin'} ${ptEnvoye(y, m) ? (missing.length > 1 ? 'et te les envoie' : 'et te l\'envoie') : 'dès que tu lui envoies le pointage'}.`
                : `Aucun bulletin pour ${h(MONTHS_LONG[m - 1])} ${h(s.year)} : ${pl(missing.length, 'salarié')} à payer ce mois-là.${enLecture('payslips') ? ''
                : `<div class="mt"><button class="btn" id="p-gen-vide">Établir ${missing.length > 1 ? `les ${missing.length} bulletins` : 'le bulletin'}</button></div>`}`
              : `Aucun salarié en poste en ${h(MONTHS_LONG[m - 1])} ${h(s.year)} : il n'y a pas de bulletin à établir ce mois-là.${ailleurs
                ? `<div class="mt"><button class="btn btn-primary" id="p-vers-mois">Voir ${h(MONTHS_LONG[ailleurs.month - 1])} ${ailleurs.year}</button></div>` : ''}`}</div>`}
        </div>
        ${month.length ? `<p class="raccourcis">${lfIc('aide', 14)} Un bulletin marqué payé sort l'argent tout seul dans la <a href="#/tresorerie">trésorerie</a> : ne saisis pas en plus un mouvement « Salaires », il compterait deux fois. Le journal de paie du mois est dans le menu ⋯.</p>` : ''}`;
      if ($('#p-2026-voir')) $('#p-2026-voir').onclick = () => { const t = $('#p-tabs button[data-tab="baremes"]'); if (t) t.click(); };
      if ($('#p-gen-vide')) $('#p-gen-vide').onclick = () => etablirBulletins();
      if ($('#pv-carte-ouvrir')) $('#pv-carte-ouvrir').onclick = () => variablesFenetre(y, m, () => draw());
      $$('#p-body [data-mp-pointage]').forEach(b => b.onclick = () => { s.ptY = String(y); s.ptM = String(m); allerVue('pointage'); });
      if ($('#p-vers-mois')) $('#p-vers-mois').onclick = () => { const mp2 = C.moisDePaie(data); s.year = String(mp2.year); s.month = String(mp2.month); s.moisTouche = true; draw(); };
      lierBandeauxDuMois(month, y, m);
      if ($('#p-sans-voir')) $('#p-sans-voir').onclick = () => controlesFenetre(y, m, traiter);
      if ($('#p-ctrl-tout')) $('#p-ctrl-tout').onclick = () => { s.ctlTout = true; drawSlips(); };
      // (1.249.0) Une ligne s'ouvre en lecture (clic ou Entrée), avec les gestes du bulletin ; le formulaire n'est qu'un de ses gestes.
      if ($('#p-bulletins')) bindPager($('#p-bulletins'), s.bul, () => drawSlips(), '#p-bulletins');
      $$('#p-body tr[data-bul]').forEach(tr => {
        tr.tabIndex = 0; tr.classList.add('clickable');
        const ouvrir = () => { const x = payslipById(tr.dataset.bul); if (x) apercuBulletin(x, () => draw()); };
        tr.onkeydown = ev => { if (ev.key === 'Enter' && ev.target === tr) ouvrir(); };
        tr.onclick = ev => { if (!ev.target.closest('button, a, input, label, select')) ouvrir(); };
      });
      // (plateforme) 1.234.0 — « Bulletin » sur chaque ligne (la maquette) ; « Marquer payé » vit dans le menu de la ligne.
      $$('#p-body [data-voir-b]').forEach(b => b.onclick = ev => { ev.stopPropagation(); const x = payslipById(b.dataset.voirB); if (x) apercuBulletin(x, () => draw()); });
      const marquerPaye = id => {
        const x = payslipById(id); if (!x) return;
        const jour = C.today();
        if (closedBlock(jour, 'Ce paiement de salaire')) return;
        x.paidDate = jour;
        save(true); draw();
        const emp = employeeById(x.employeeId) || {};
        toastUndo(`Salaire de ${emp.name || 'ce salarié'} marqué payé aujourd'hui`, () => { const y2 = payslipById(x.id); if (y2) { y2.paidDate = ''; save(true); draw(); } });
      };
      // (plateforme) 1.232.0 — en lecture, les gestes d'écriture du mois ne s'offrent pas ; sans réseau, ils attendent.
      const lectureP = enLecture('payslips'), horsLigneP = navigator.onLine === false;
      if (lectureP) $$('#p-body [data-payer], #p-body #p-corr-non, #p-body #p-dem-corr, #p-body #p-bap-ok').forEach(b => b.remove());
      const tete = lectureP ? `<div class="bandeau info pa-bandeau" id="p-lecture" role="status">${lfIc('oeil', 18)}<span class="txt"><b>Tu consultes la paie</b><span>Ton rôle te la montre sans la changer : approuver, payer et corriger se font par un membre qui a le droit d'écrire la paie.</span></span></div>`
        : horsLigneP ? `<div class="bandeau ambre pa-bandeau pa-ambre" id="p-hors-ligne" role="status">${lfIc('horsligne', 18)}<span class="txt"><b>Pas de réseau : la paie se consulte, ses gestes attendent</b><span>Établir, approuver, payer et accepter une correction passent par le serveur : ils reviennent avec la connexion. Rien de ce qui est enregistré n'est perdu.</span></span></div>` : '';
      if (tete && $('#p-body')) $('#p-body').insertAdjacentHTML('afterbegin', tete);
      if (horsLigneP) $$('#p-body [data-payer], #p-body #p-corr-non, #p-body #p-bap-ok').forEach(b => { b.disabled = true; b.title = 'Pas de réseau : ce geste attend la connexion'; });
      bindRowMenus($('#p-body'), id => {
        const x = payslipById(id); if (!x) return [];
        const emp = employeeById(x.employeeId);
        if (lectureP) return [
          { icon: 'loupe', label: 'Voir le bulletin', hint: 'la feuille elle-même', run: () => apercuBulletin(x) },
          { icon: 'pdf', label: 'Exporter le bulletin en PDF', run: () => exportPayslip(x) }];
        return [
          ...(!x.paidDate && !(bapDuMois(Number(x.year), Number(x.month)) && !x.bonAPayerLe) && !horsLigneP ? [{ icon: 'argent', label: 'Marquer payé', hint: 'aujourd\'hui, au compte et au mode de sa fiche', run: () => marquerPaye(x.id) }] : []),
          // (1.248.1) « Voir le bulletin » est déjà le bouton de la ligne : le menu ne le répète pas.
          { icon: 'pdf', label: 'Exporter le bulletin en PDF', hint: 'À remettre au salarié', run: () => exportPayslip(x) },
          ...(x.paidDate ? [{ icon: 'restaurer', label: 'Régulariser sur un mois suivant…', hint: 'ce qui manquait, ou ce qui a été payé en trop : le bulletin payé ne change pas', run: () => regularisationFenetre(x, () => draw(), { rectificatif: b0 => demanderCorrection(C.payslipsOf(data, Number(b0.year), Number(b0.month)), Number(b0.year), Number(b0.month)) }) },
            // (1.274.0, audit G05) « Modifier le bulletin payé » n'existe plus : le serveur le refuse ; on régularise, ou on
            // annule le paiement d'un virement qui n'a pas eu lieu.
            ]
            : [{ icon: 'modifier', label: 'Modifier le bulletin', hint: 'Primes, retenues, date et compte du paiement', run: () => payslipForm(x, emp, x.year, x.month, () => draw()) },
              // (1.248.1) Un bulletin pas encore payé se supprime d'ici (il fallait l'ouvrir pour trouver « Supprimer ») ; « Annuler » le rend.
              ...(x.valideLe || horsLigneP ? [] : [{ icon: 'annuler', label: 'Supprimer le bulletin…', hint: 'pas encore payé : « Établir » le refait ensuite', run: async () => {
                // (1.305.0) D'un mois que le cabinet a validé : la question le dit, le message après offre de le lui dire.
                await periodeValideeLue();
                const dvSupB = dateDansLaPeriodeValidee([C.payslipDate(x)]);
                // Le bulletin rangé ne porte pas le nom : celui de la fiche (« de undefined » jusqu'à la 1.305.0).
                const nomB = (emp && emp.name) || 'ce salarié';
                if (!await confirmDialog(`Supprimer le bulletin ${deDit(nomB)} pour ${MONTHS_LONG[Number(x.month) - 1]} ${x.year} ? Il n'est pas payé : il se rétablit ensuite d'un clic.${dvSupB ? ` ${phraseAnnulationValidee(dvSupB, { sujet: 'Il', fem: false })}` : ''}`, 'Supprimer', true, { titre: 'Supprimer ce bulletin ?' })) return;
                if (closedBlock(C.payslipDate(x), 'Ce bulletin')) return;
                const garde = deepCopy(payslipById(x.id));
                data.payslips = data.payslips.filter(z => z.id !== x.id); save(true); draw();
                if (dvSupB) direAuComptableApres(`Bulletin ${deDit(nomB)} supprimé`, { fait: 'de supprimer', fem: false, annule: true, quoi: `le bulletin ${deDit(nomB)} ${deDit(`${MONTHS_LONG[Number(x.month) - 1]} ${x.year}`)}, daté du ${C.fmtDate(dvSupB)}` });
                else toastUndo(`Bulletin ${deDit(nomB)} supprimé`, () => { if (garde && !payslipById(garde.id)) { data.payslips.push(garde); save(true); draw(); } });
              } }])]),
          ...(x.paidDate ? [{ icon: 'annuler', label: 'Annuler le paiement…', hint: 'un virement rejeté par la banque : le salaire redevient à payer', run: () => annulerPaiementSalaire(C.payslipsOf(data, x.year, x.month).find(b => b.id === x.id) || x) }] : [])
        ];
      });
    }
    // (1.267.0) « À ne pas oublier » (la maquette paie-v2, « carteRappels » ; c'était « À traiter » sur « Le mois ») : ce qui
    // attend un geste sur les fiches (un RIB, un n° CNSS, une fin d'essai, un CDD qui finit), chacun avec son bouton. Les
    // fiches qui partagent un n° CNSS ou un RIB tiennent sur une ligne (1.253.0) : « Corriger » ouvre la première à reprendre.
    function aNePasOublierHtml(traiter) {
      const lignesT = [], doubles = {};
      traiter.forEach((x, i) => {
        if (!x.double) { lignesT.push({ x, i }); return; }
        const k = `${x.focus}|${x.double.de}`;
        if (doubles[k]) { doubles[k].noms.push(x.double.nom); return; }
        doubles[k] = { x, i, noms: [x.double.de, x.double.nom] }; lignesT.push(doubles[k]);
      });
      const nomsT = l => l.length > 4 ? `${l.slice(0, 3).join(', ')} et ${l.length - 3} autres` : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
      const ligneT = ({ x, i, noms }) => {
        if (!noms) return `<li>${pmAv(x.initiales, x.couleur)}<span class="apy-n"><b>${h(x.titre)}</b><small title="${h(x.dit)}">${h(x.dit)}</small></span><span class="pa-auj-g2"><button type="button" class="btn mini btn-ghost" data-tard="${i}" title="Le rappel revient lundi prochain" aria-label="Plus tard : ${h(x.titre)}, revient lundi">Plus tard</button><button type="button" class="btn mini" data-traiter="${i}">${h(x.geste)}</button></span></li>`;
        const titre = noms.length > 2 ? `Le même ${x.double.quoi} sur ${noms.length} fiches` : `${x.double.nom} : le même ${x.double.quoi} que ${x.double.de}`;
        const dit = `${noms.length > 2 ? `${nomsT(noms)} : ` : ''}${x.focus === 'cnss' ? `la déclaration du trimestre mettrait leurs salaires sur un seul assuré` : `leurs salaires partiraient sur un seul compte`}`;
        return `<li data-double="${h(x.focus)}">${pmAv(x.initiales, x.couleur)}<span class="apy-n"><b>${h(titre)}</b><small title="${h(dit)}">${h(dit)}</small></span><button type="button" class="btn mini" data-traiter="${i}" title="${h(`Ouvre la fiche de ${x.double.nom}`)}">${h(x.geste)}</button></li>`;
      };
      return `<div class="apy carte pa-auj-c" id="p-traiter"><div class="apy-t"><b>À ne pas oublier</b><span class="mu">${lignesT.length ? `${pl(lignesT.length, 'chose')} qui attend${lignesT.length > 1 ? 'ent' : ''} un geste` : 'rien en ce moment'}</span></div>
        ${lignesT.length ? `<ul class="apy-l pa-auj-l">${lignesT.map(ligneT).join('')}</ul>` : `<div class="pa-auj-vide">${lfIc('coche', 18)}<span>Rien à surveiller : un RIB ou un n° CNSS qui manque, une fin d'essai, un CDD qui finit arrivent ici, avec leur bouton.</span></div>`}</div>`;
    }
    // Chaque ligne mène à son geste : la fiche sur la bonne case, la fenêtre qui complète, la fin d'essai.
    function lierANePasOublier(traiter, apres) {
      $$('#p-body [data-tard]').forEach(b => b.onclick = () => {
        const x = traiter[Number(b.dataset.tard)]; if (!x) return;
        const T = tardsLus(), cle = cleRappel(x), avant = T[cle], l = lundiProchain();
        const ecrire = v => { const U = tardsLus(); if (v) U[cle] = v; else delete U[cle]; try { localStorage.setItem(tardCle(), JSON.stringify(U)); } catch (_) { /* poste sans stockage : le rappel reste */ } apres(); };
        ecrire(l);
        toastUndo(`« ${x.titre} » revient le lundi ${l.slice(8, 10)}/${l.slice(5, 7)}`, () => ecrire(avant || ''));
      });
      $$('#p-body [data-traiter]').forEach(b => b.onclick = () => {
        const x = traiter[Number(b.dataset.traiter)]; if (!x) return;
        const e = employeeById(x.salarie);
        if (x.demande) { s.tab = 'conges'; marquerVue(); return draw(); }
        if (x.essai && e) return finEssaiFenetre(e, apres);
        if (x.conge) return leaveForm((data.leaves || []).find(l => l.id === x.conge), null, apres);
        if (x.saisie && e) return saisieFenetre(e, (e.saisies || []).find(z => z.id === x.saisie), apres);
        if (x.focus && e && ['cnss', 'iban', 'cin'].includes(x.focus) && !(x.double)) return completerFenetre(e, apres);
        if (x.focus && e) return employeeForm(e, apres, { focus: x.focus });
        if (e) location.hash = `#/salarie/${encodeURIComponent(e.id)}`;
      });
    }
    // Aller au mois et à l'étape d'un geste (le bouton vert d'« Aujourd'hui »).
    function allerAuMois(p) {
      s.year = String(p.y); s.month = String(p.m); s.quarter = String(Math.ceil(p.m / 3)); s.moisTouche = true;
      s.tab = p.etape; marquerVue(); draw();
    }
    // (1.267.0) « Aujourd'hui » (la maquette paie-v2, « ongletJour ») : à gauche la journée (qui est là, ce qui change, la
    // valider) et les gestes de tous les jours ; à droite les demandes et ce qu'il ne faut pas oublier. Un mois passé qui n'est
    // pas fini se dit en tête, avec son bouton vert (il n'y en a qu'un sur la page).
    function drawAujourdhui() {
      const p = principalDuJour(), traiter = rappelsDuJour();
      let tete = '';
      if (p && p.avant) {
        const mo = C.payslipsOf(data, p.y, p.m), n = C.missingPayslips(data, p.y, p.m).length, nom = MONTHS_LONG[p.m - 1];
        const dE = C.declarationMensuelleSalaires(data, p.y, p.m), deposee = (data.socialFilings || []).some(f => f.id === `dm-${p.y}-${String(p.m).padStart(2, '0')}`);
        const quoi = { correction: 'une correction proposée par ton cabinet attend ta réponse, avant le paiement',
          approuver: 'ton cabinet a préparé les bulletins : ils attendent ton accord (ton « bon à payer »), puis tu paies',
          etablir: `${pl(n, 'bulletin')} à établir, puis à payer`,
          regler: `${pl(bloquantsDe(p.y, p.m).length, 'chose')} à régler dans le pointage (${bloquantsDe(p.y, p.m).length > 1 ? 'elles changent' : 'elle change'} un montant), puis ${modeDuMois(p.y, p.m) === 'tenue' ? 'tu l\'envoies à ton cabinet, qui prépare les bulletins' : `${pl(n, 'bulletin')} à établir`}`,
          envoyer: 'son pointage attend d\'être validé : c\'est l\'envoyer à ton cabinet, qui prépare les bulletins',
          payer: `les bulletins sont établis ; ${pl(mo.filter(x => !x.paidDate).length, 'salaire')} ${mo.filter(x => !x.paidDate).length > 1 ? 'ne sont' : 'n\'est'} pas encore payé${mo.filter(x => !x.paidDate).length > 1 ? 's' : ''}`,
          remettre: `les salaires sont payés ; ${pl(mo.filter(x => x.paidDate && !x.remisLe).length, 'bulletin')} à remettre` }[p.sorte];
        const decl = deposee || !dE.salaries ? '' : modeDuMois(p.y, p.m) === 'tenue' ? ` Sa déclaration, c'est ton cabinet qui la dépose, avant le ${C.fmtDate(dE.dueDate)}.` : ` Sa déclaration est à déposer avant le ${C.fmtDate(dE.dueDate)}.`;
        // (1.355.1) « Octobre n'est pas fini », lu le 11 novembre, disait que le mois n'était pas terminé : c'est sa PAIE.
        tete = `<div class="bandeau ambre pa-bandeau pa-ambre" id="pj-avant" role="status">${lfIc('alerte', 18)}<span class="txt"><b>${h(`La paie ${/^[aeiouyéè]/i.test(nom) ? `d'${nom}` : `de ${nom}`} n'est pas finie`)}</b><span>${h(capi(quoi))}.${h(decl)}</span></span><button type="button" class="btn btn-primary" id="pj-avant-go">${lfIc(p.ic, 15, 2.2)} ${h(p.dit)}</button></div>`;
      }
      const ecrit = !enLecture('employees');
      const gestes = ecrit ? [['pj-absence', 'echeance', 'Une absence prévue', 'congé, sur un ou plusieurs jours'], ['pj-avance', 'argent', 'Une avance', 'retenue sur la prochaine paie'],
        ['pj-document', 'pages', 'Un document', 'attestation, certificat…'], ['pj-depart', 'annuler', 'Un départ', 'fin de CDD, démission…']] : [];
      const dem = congesDemandes();
      $('#p-body').innerHTML = `${tete}<div class="pa-auj" id="p-auj"><div class="pa-auj-g"><div id="pj-jour"></div>
          ${gestes.length ? `<div class="pa-gestes" id="pj-gestes">${gestes.map(([id, ic, t, d]) => `<button type="button" class="pa-geste" id="${id}"><b>${lfIc(ic, 16)} ${t}</b><span>${d}</span></button>`).join('')}</div>` : ''}</div>
        <div class="pa-auj-d">${dem || `<section class="pa-carte pa-auj-c" id="cg-demandes-vide"><div class="pa-carte-t"><b>Les demandes</b><span class="mu">aucune en attente</span>${ecrit ? '<button type="button" class="btn btn-sm" id="pj-demande">Noter une demande…</button>' : ''}</div>
          <div class="pa-auj-vide">${lfIc('coche', 18)}<span>Rien en attente. Un salarié te demande un congé ? Note-le ici : il attend ta réponse sans se perdre, et rien ne compte avant.</span></div></section>`}${aNePasOublierHtml(traiter)}</div></div>`;
      drawPtJour();
      const apres = () => draw();
      if ($('#pj-avant-go')) $('#pj-avant-go').onclick = () => allerAuMois(p);
      if ($('#pj-absence')) $('#pj-absence').onclick = () => leaveForm(null, null, apres, s.ptJourIso || C.today());
      if ($('#pj-avance')) $('#pj-avance').onclick = () => advanceForm(null, null, apres);
      if ($('#pj-document')) $('#pj-document').onclick = () => choisirSalarie('Un document pour qui ?', e => hrDocForm(e, apres));
      if ($('#pj-depart')) $('#pj-depart').onclick = () => choisirSalarie('Qui part ?', e => sortieFenetre(e, apres));
      // « Noter une demande » : la fenêtre du congé, la case « c'est une demande » déjà cochée.
      if ($('#pj-demande')) $('#pj-demande').onclick = () => { leaveForm(null, null, apres, s.ptJourIso || C.today()); const c = document.querySelector('#modal-root #lf [name=demande]'); if (c) c.checked = true; };
      lierConges(apres);
      lierANePasOublier(traiter, apres);
    }
    // (1.267.0) L'étape « Payer » (la maquette paie-v2, « etapePayer ») : par virement (un seul ordre pour la banque, le RIB de
    // chacun), en espèces (contre un reçu), puis remettre à chacun son bulletin. Le bouton vert est en haut : payer, puis remettre.
    function drawPayer() {
      const y = Number(s.year), m = Number(s.month), cur = company().currency, mo = C.payslipsOf(data, y, m), nom = MONTHS_LONG[m - 1];
      const de = /^[aeiouyéè]/i.test(nom) ? `d'${nom}` : `de ${nom}`, bap = bapDuMois(y, m);
      const pasPrets = !mo.length || C.missingPayslips(data, y, m).length || mo.some(x => correctionEnAttente(x)) || (bap && mo.some(x => !x.paidDate && !x.bonAPayerLe));
      if (pasPrets && !mo.some(x => x.paidDate)) {
        $('#p-body').innerHTML = `<section class="pa-carte" id="p-payer-c"><div class="empty">${lfIc('argent', 18)} ${bap ? 'On paie après avoir approuvé les bulletins que ton cabinet prépare : c\'est l\'étape « Bulletins ».' : 'On paie après avoir établi les bulletins : c\'est l\'étape « Bulletins ».'}
          <div class="mt"><button type="button" class="btn" id="p-vers-bul">Aller aux bulletins</button></div></div></section>`;
        $('#p-vers-bul').onclick = () => allerVue('bulletins');
        return;
      }
      const somme = L => C.round3(L.reduce((a, x) => a + x.c.net, 0));
      const methode = x => x.method || (x.employee || {}).method || 'virement';
      const vir = mo.filter(x => methode(x) !== 'especes'), esp = mo.filter(x => methode(x) === 'especes');
      const sansRib = vir.filter(x => !x.paidDate && !String((x.employee || {}).iban || '').trim());
      const payes = mo.filter(x => x.paidDate), aRemettre = payes.filter(x => !x.remisLe);
      const jours = [...new Set(payes.map(x => x.paidDate))];
      const ban = bandeauxDuMois(mo, y, m, bap), rev = /id="p-rev-b"/.test(ban) ? ban : '';
      const prenoms = L => L.map(x => String(x.employeeName || '').split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' et $1');
      const ligne = (id, ic, titre, dit, gestes) => `<li id="${id}"><span class="apy-ic">${lfIc(ic, 18)}</span><span class="apy-n"><b>${titre}</b><small>${dit}</small></span><span class="pa-payer-g">${gestes}</span></li>`;
      $('#p-body').innerHTML = `${rev}<section class="apy carte" id="p-payer-c"><div class="apy-t"><b>Payer les salaires ${h(de)}</b><span class="mu">${payes.length === mo.length ? (jours.length === 1 ? `payés le ${C.fmtDate(jours[0])}` : 'tous payés') : `${C.money(somme(mo.filter(x => !x.paidDate)), cur)} à payer`}</span></div>
        <ul class="apy-l pa-payer-l">
          ${vir.length ? ligne('p-payer-vir', 'envoi', `Par virement · ${pl(vir.length, 'salarié')} · ${C.money(somme(vir), cur)}`, `un seul ordre de virement pour ta banque, avec le RIB de chacun${sansRib.length ? ` · <b class="warn-text">le RIB de ${h(prenoms(sansRib))} manque</b>` : ''}`,
            `${sansRib.length ? `<button type="button" class="btn btn-sm" data-rib="${h(sansRib[0].employeeId)}">Compléter le RIB</button>` : ''}<button type="button" class="btn btn-sm" id="p-ordre">${lfIc('pages', 14)} L'ordre de virement</button>`) : ''}
          ${esp.length ? ligne('p-payer-esp', 'argent', `En espèces · ${pl(esp.length, 'salarié')} · ${C.money(somme(esp), cur)}`, `contre un reçu que ${h(prenoms(esp))} signe${esp.length > 1 ? 'nt' : ''} : il se prépare avec le paiement`, '') : ''}
          ${ligne('p-payer-rem', 'pages', aRemettre.length ? `Remettre ${aRemettre.length > 1 ? `les ${aRemettre.length} bulletins` : 'le bulletin'}` : payes.length === mo.length ? 'Chacun a son bulletin' : 'Remettre les bulletins', aRemettre.length ? 'chacun en PDF, à donner en main propre ou à envoyer toi-même' : payes.length === mo.length ? 'remis, avec la date' : 'une fois payés : chacun reçoit le sien, en PDF', '')}
        </ul>
        <p class="pa-pied small muted">${lfIc('aide', 13)} Une fois l'argent parti, dis-le avec le bouton vert : la trésorerie et la comptabilité le voient, et le bulletin est marqué payé ; il ne se modifie plus (une erreur se corrige sur le bulletin suivant).${modeDuMois(y, m) === 'tenue' ? ' C\'est toi qui paies : ton cabinet n\'a pas ce geste.' : ''} Le journal de paie est dans le menu ⋯.</p></section>`;
      lierBandeauxDuMois(mo, y, m);
      if ($('#p-ordre')) $('#p-ordre').onclick = () => ordreVirementApercu(y, m);
      $$('#p-body [data-rib]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.rib); if (e) completerFenetre(e, () => draw()); });
    }
    // (1.256.0) Choisir le salarié d'un geste lancé du menu ⋯ (un document, une saisie, un départ) : ceux qui sont en poste.
    function choisirSalarie(titre, run) {
      const L = data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today())).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
      if (!L.length) { toast('Aucun salarié en poste.', true); return; }
      modal(`<h2>${h(titre)}</h2><p class="sous-f">${pl(L.length, 'salarié')} en poste</p>
        <ul class="apy-l fen-l" id="cs-l">${L.map(e => `<li data-cs="${h(e.id)}" style="cursor:pointer">${pmAvDe(e.name)}<span class="apy-n"><b>${h(e.name || '')}</b><small>${h(e.position || '')}${e.hireDate ? ` · depuis ${C.fmtDate(e.hireDate)}` : ''}</small></span><button type="button" class="btn mini" data-cs-b="${h(e.id)}">Choisir</button></li>`).join('')}</ul>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button></div>`, (root, fermer) => {
        $$('[data-cs]', root).forEach(li => li.onclick = () => { const e = employeeById(li.dataset.cs); fermer(); if (e) run(e); });
      });
    }
    // L'ordre de virement du mois, depuis le menu ⋯ : les salaires payés (ou à payer) par virement, au RIB valable.
    function ordreVirementApercu(y, m) {
      const L = C.payslipsOf(data, y, m).filter(x => (x.method || (x.employee || {}).method || 'virement') === 'virement');
      const lignes = L.map(x => ({ name: x.employeeName, rib: String((x.employee || {}).iban || '').trim(), net: C.round3(Number((x.c || {}).net) || 0) })).filter(l => l.rib && C.verifRib(l.rib).ok);
      if (!lignes.length) { toast('Aucun salaire de ce mois ne part par virement à un RIB valable.', true); return; }
      const compte = (data.accounts || []).find(a => a.isDefault) || (data.accounts || [])[0] || {};
      const html = C.ordreDeVirementHtml(company(), { year: y, month: m, date: C.today(), compte: { bank: compte.bank || company().bank || '', rib: compte.rib || company().rib || '' }, lignes });
      apercuDocument({ titre: `Ordre de virement · salaires de ${MONTHS_LONG[m - 1]} ${y}`, html, fichier: `Ordre_de_virement_salaires_${y}-${String(m).padStart(2, '0')}.pdf`,
        cote: `<div class="pa-doc-i"><b>${pl(lignes.length, 'bénéficiaire')}</b><span>les salariés payés par virement à un RIB valable</span></div><div class="pa-doc-i"><b>À VÉRIFIER</b><span>certaines banques demandent leur propre formulaire, ou un fichier.</span></div>` });
    }
    // (1.256.0) « Les contrôles des bulletins » (la maquette, O22) : tous, ceux qui demandent un geste en tête, chacun avec son
    // bouton quand il en a un (la fiche à compléter, la fiche du doublon).
    function controlesFenetre(y, m, traiter) {
      const L = C.controlesDuMois(data, y, m), ko = L.filter(c => !c.ok), mo = MONTHS_LONG[m - 1];
      const geste = c => {
        if (c.ok) return null;
        const t = (traiter || []).find(x => (c.id === 'cnss' && x.focus === 'cnss') || (c.id === 'rib' && x.focus === 'iban'));
        return t ? { libelle: 'Compléter', x: t } : null;
      };
      const lignes = ko.concat(L.filter(c => c.ok));
      modal(`<h2>Les ${L.length} contrôles des bulletins ${/^[aeiouyéè]/i.test(mo) ? 'd\'' : 'de '}${h(mo)}</h2><p class="sous-f">faits par SkanFact avant que tu les paies · ceux qui demandent un geste en tête</p>
        <ul class="apy-l fen-l" id="ctl-fen">${lignes.map((c, i) => { const g = geste(c); return `<li class="${c.ok ? 'ok' : 'ko'}"><span class="apy-ok" style="justify-self:center;color:var(--${c.ok ? 'sarcelle-texte' : 'ambre-texte'})">${lfIc(c.ok ? 'coche' : 'aide', 16, 2.2)}</span><span class="apy-n"><b>${h(c.titre)}</b><small title="${h(c.dit || 'juste')}">${h(c.dit || 'juste')}</small></span><span></span><span></span>${g ? `<button type="button" class="btn mini" data-ctl-g="${i}">${h(g.libelle)}</button>` : '<span></span>'}</li>`; }).join('')}</ul>
        <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Fermer</button></div>`, (root, fermer) => {
        $$('[data-ctl-g]', root).forEach(b => b.onclick = () => {
          const g = geste(lignes[Number(b.dataset.ctlG)]); if (!g) return;
          const e = employeeById(g.x.salarie); fermer();
          if (e) employeeForm(e, () => draw(), { focus: g.x.focus });
        });
      }, null, { classe: 'pv-large' });
    }
    // Établir les bulletins manquants : le bouton de l'en-tête (il était dans la carte avant 1.222.0).
    async function etablirBulletins() {
      const y = Number(s.year), m = Number(s.month);
      const missing = C.missingPayslips(data, y, m);
      if (!missing.length) return;
      // Les contrôles AVANT la grande question (règle 7.6.0).
      // (1.267.0, morceau C) Le mois en cours à partir du 25, jamais un mois à venir ; ce qui change un montant d'abord.
      { const nom = MONTHS_LONG[m - 1], de = /^[aeiouyéè]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
        if (avant25(y, m)) { toast(`Les bulletins ${de} se préparent à partir du 25/${String(m).padStart(2, '0')} : d'ici là, le pointage continue chaque jour. Un salarié qui part avant ? Son dernier bulletin se fait depuis « Son départ », sur sa fiche.`, true); return; }
        const bl = bloquantsDe(y, m);
        if (bl.length) { toast(`Les bulletins ${de} attendent : ${pl(bl.length, 'chose')} à régler dans le pointage, qui ${bl.length > 1 ? 'changent' : 'change'} un montant. « Pointer » les montre, chacune avec son bouton.`, true); allerVue('pointage'); return; } }
      if (licenceBlock('Créer les bulletins du mois', 'paie')) return;
      // (1.248.0) La question montre CE qui va s'établir (recette du 02/11 : un mur de texte, aucun nom ni montant) :
      // chaque salarié, son brut et son net du mois, puis ce qui est repris, en une ligne.
      const stA = C.payrollSettings(data);
      const apercu = missing.map(e => { const c = C.computePayslip(e, { ...C.payslipInputFor(data, e, y, m), year: y, month: m }, stA); return { e, c }; });
      const cur = data.settings && data.settings.currency;
      // (1.305.0) Un mois que le cabinet a validé (des bulletins oubliés, établis après coup) : la question le dit avant, sans
      // rien bloquer ; chez lui, la paie du mois s'écrit au premier jour encore ouvert.
      await periodeValideeLue();
      const dvEtab = dateDansLaPeriodeValidee([C.payslipDate({ year: y, month: m })]);
      const phraseEtab = !dvEtab ? '' : missing.length > 1
        ? `Ces bulletins sont datés du ${C.fmtDate(dvEtab)}, dans la période que ton cabinet a validée (jusqu'au ${C.fmtDate(valideCabinet.jusqua)}) : chez lui, ils s'écriront au ${C.fmtDate(premierJourOuvert())}, le premier jour encore ouvert. En les établissant, tu pourras le lui dire.`
        : phrasePeriodeValidee(dvEtab, dvEtab, { sujet: 'Ce bulletin', fem: false, neuve: true, geste: 'En l\'établissant' });
      const ok = await new Promise(resolve => {
        let fini = false;
        modal(`<h2>Établir ${missing.length > 1 ? `les ${missing.length} bulletins` : 'le bulletin'} ${/^[aeiouh]/i.test(MONTHS_LONG[m - 1]) ? 'd’' : 'de '}${h(MONTHS_LONG[m - 1])} ${h(s.year)}</h2>
          <div class="scroll-x"><table class="list compact" id="p-etab-liste"><thead><tr><th>Salarié</th><th class="r">Brut</th><th class="r">Net à payer</th></tr></thead><tbody>
          ${apercu.map(({ e, c }) => `<tr><td>${h(e.name || '')}${e.endDate && e.endDate.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}` ? ` <span class="small muted">· jusqu'au ${C.fmtDate(e.endDate)}</span>` : e.hireDate && e.hireDate.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}` ? ` <span class="small muted">· depuis le ${C.fmtDate(e.hireDate)}</span>` : ''}</td><td class="r nw">${C.money(c.gross, '')}</td><td class="r nw"><b>${C.money(c.net, cur)}</b></td></tr>`).join('')}
          </tbody></table></div>
          ${`${y}-${String(m).padStart(2, '0')}` === C.today().slice(0, 7) ? `<div class="warn-box mt" id="p-etab-encours"><b>${h(MONTHS_LONG[m - 1].charAt(0).toUpperCase() + MONTHS_LONG[m - 1].slice(1))} n'est pas fini.</b> Les jours qui restent, jusqu'au ${C.daysInMonth(y, m)}, sont comptés présents ; ce qui changera d'ici la fin du mois se régularise sur le bulletin du mois suivant (le bulletin le signalera, avec le bouton qui le met à jour).</div>` : ''}
          ${C.baremesNonRelus(y, m) ? `<div class="warn-box mt" id="p-etab-relus">${relusDit(C.baremesNonRelus(y, m), m)}</div>` : ''}
          <p class="small muted mt">Repris de chaque fiche : le brut (au prorata d'une entrée ou d'une sortie dans le mois), les primes, les absences non payées et les heures du pointage, les avances. Rien n'est payé : tu pourras encore modifier chaque bulletin.</p>
          ${phraseEtab ? `<p class="cab-valide" id="p-etab-valide" role="status">${lfIc('aide', 15)}<span>${h(phraseEtab)}</span></p>` : ''}
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Établir</button></div>`,
          (root, close) => { $('#ok', root).onclick = () => { fini = true; close(); resolve(true); }; $('[data-close]', root).onclick = () => { fini = true; close(); resolve(false); }; },
          () => { if (!fini) resolve(false); });
      });
      if (!ok) return;
      const st = C.payrollSettings(data);
      if (closedBlock(C.payslipDate({ year: y, month: m }), 'Ces bulletins')) return;
      missing.forEach(e => {
        const input = { ...C.payslipInputFor(data, e, y, m), year: y, month: m };
        data.payslips.push({ id: C.uid(), employeeId: e.id, ...input,
          computed: C.computePayslip(e, input, st), paidDate: '', accountId: '', method: e.method || 'virement',
          reference: '', issuedAt: C.today() });
      });
      save(true); draw();
      if (dvEtab) {
        // Le message dit la devise (l'aperçu de la fenêtre, en colonnes, la tait).
        const net = C.round3(apercu.reduce((a, x) => a + (Number(x.c.net) || 0), 0)), dev = company().currency;
        direAuComptableApres(`${pl(missing.length, 'bulletin')} établi${sPl(missing.length)}`, { fait: 'd\'établir', fem: false, plur: missing.length > 1,
          quoi: missing.length > 1 ? `les ${missing.length} bulletins ${deDit(`${MONTHS_LONG[m - 1]} ${y}`)} (${missing.map(e => e.name).join(', ')}), datés du ${C.fmtDate(dvEtab)} (net ${C.money(net, dev)})`
            : `le bulletin ${deDit(missing[0].name)} ${deDit(`${MONTHS_LONG[m - 1]} ${y}`)}, daté du ${C.fmtDate(dvEtab)} (net ${C.money(net, dev)})` });
      } else toast(`${pl(missing.length, 'bulletin')} établi${sPl(missing.length)}`);
    }
    // Remettre les bulletins payés : chacun en PDF, à donner ou envoyer ; la remise se garde sur le bulletin (un fait, avec
    // son jour), et « Annuler » la défait. SkanFact n'envoie rien tout seul : il prépare les PDF.
    function remettreBulletins() {
      const y = Number(s.year), m = Number(s.month);
      const L = C.payslipsOf(data, y, m).filter(x => x.paidDate && !x.remisLe);
      if (!L.length) return;
      // (1.248.1) Recette du 02/11 : « à envoyer à x » laissait croire que SkanFact envoyait ; on ne choisissait pas qui ;
      // « Voir » ne montrait que le premier. Une case et un « Voir » par salarié ; la phrase dit ce que fait SkanFact.
      const emailDe = x => String((employeeById(x.employeeId) || {}).email || '').trim();
      modal(`<h2>Remettre ${L.length > 1 ? `les ${L.length} bulletins` : 'le bulletin'} ${/^[aeiouh]/i.test(MONTHS_LONG[m - 1]) ? 'd’' : 'de '}${h(MONTHS_LONG[m - 1])}</h2>
        ${/* (1.257.0) La fenêtre de la maquette (O03) : une ligne par salarié, son moyen et le détail dessous, la règle en pied. */''}
        <div class="scroll-x"><table class="mini lu rm-t" id="rm-liste"><thead><tr><th class="nw"><input type="checkbox" id="rm-tous" checked aria-label="Tout cocher"></th><th>Salarié</th><th>Comment</th><th></th></tr></thead><tbody>${L.map(x => `<tr><td><input type="checkbox" data-rm="${h(x.id)}" checked aria-label="Remettre le bulletin de ${h(x.employeeName)}"></td><td><b>${h(x.employeeName)}</b></td><td>${emailDe(x) ? `par e-mail, par toi<small class="mono">${h(emailDe(x))}</small>` : 'imprimé, en main propre<small>pas d’e-mail sur sa fiche</small>'}</td><td class="r"><button type="button" class="btn btn-sm" data-rm-voir="${h(x.id)}">${lfIc('oeil', 14)} Voir</button></td></tr>`).join('')}</tbody></table></div>
        <p class="regle small">${lfIc('aide', 13, 2)} SkanFact prépare le PDF de chaque bulletin coché, celui de son salarié seulement, et note qu'il est remis, avec la date. Il n'envoie rien : tu le donnes en main propre, ou tu l'envoies toi-même. À VÉRIFIER : la remise électronique, et la signature du salarié sur un registre.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="rm-ok"></button></div>`, (root, fermer) => {
        const choisis = () => L.filter(x => $(`[data-rm="${x.id}"]`, root).checked);
        const maj = () => { const n = choisis().length; $('#rm-ok', root).disabled = !n; $('#rm-ok', root).innerHTML = `${lfIc('exporter', 15)} ${n ? `Préparer ${n > 1 ? `les ${n} PDF` : 'le PDF'} et marquer remis` : 'Coche au moins un bulletin'}`; $('#rm-tous', root).checked = n === L.length; $('#rm-tous', root).indeterminate = n > 0 && n < L.length; };
        $$('[data-rm]', root).forEach(c => c.onchange = maj);
        $('#rm-tous', root).onchange = () => { $$('[data-rm]', root).forEach(c => { c.checked = $('#rm-tous', root).checked; }); maj(); };
        $$('[data-rm-voir]', root).forEach(b => b.onclick = () => { const x = payslipById(b.dataset.rmVoir); if (x) apercuBulletin(x); });
        maj();
        $('#rm-ok', root).onclick = async () => {
          const C2 = choisis(); if (!C2.length) return;
          const jour = C.today();
          for (const x of C2) { const b = payslipById(x.id); if (b) b.remisLe = jour; }
          save(true); fermer(); draw();
          for (const x of C2) { const b = payslipById(x.id); if (b) await exportPayslip(b); }
          toastUndo(`${pl(C2.length, 'bulletin')} remis aujourd'hui`, () => { for (const x of C2) { const b = payslipById(x.id); if (b) delete b.remisLe; } save(true); draw(); });
        };
      });
    }
    // « L'année » : ce que la paie a coûté mois par mois, et ce que l'année a versé (les chiffres qui étaient en haut du mois).
    function drawAnnee() {
      const y = Number(s.year), sum = C.payrollSummary(data, y);
      const mois = Array.from({ length: 12 }, (_, i) => { const L = C.payslipsOf(data, y, i + 1); return { m: i + 1, n: L.length, brut: C.round3(L.reduce((a, x) => a + x.c.gross, 0)), cout: C.round3(L.reduce((a, x) => a + x.c.employerCost, 0)), payes: L.filter(x => x.paidDate).length }; });
      const max = Math.max(...mois.map(x => x.cout), 0.001), dernier = mois.reduce((a, x) => (x.n ? x.m : a), 0);
      $('#p-body').innerHTML = `<div class="pa-tuiles" id="p-annee-chiffres">
          <div class="pa-tuile"><span class="t">Coût de la paie ${h(s.year)} ${info('pay.employerCost')}</span><b class="m">${montantU(sum.cost, cur)}</b><span class="s">${sum.count ? `${pl(sum.count, 'bulletin')} pour ${pl(sum.employees, 'salarié')}` : `aucun bulletin établi en ${h(s.year)}`}</span></div>
          <div class="pa-tuile"><span class="t">Net versé ${info('pay.netVerse')}</span><b class="m">${montantU(sum.netPaid, cur)}</b><span class="s">${sum.net - sum.netPaid > 0.0005 ? `sur ${C.money(sum.net, cur)} de net dans l'année : ${C.money(C.round3(sum.net - sum.netPaid), cur)} encore à verser` : 'ce que touchent les salariés'}</span></div>
          <div class="pa-tuile"><span class="t">CNSS ${h(s.year)} ${info('pay.cnssTotal')}</span><b class="m">${montantU(C.round3(sum.cnssEmployee + sum.cnssEmployer + sum.accident), cur)}</b><span class="s">${(() => { const rr = C.cnssNonDeclaree(data, y); return !sum.count ? 'parts salarié et employeur' : rr > 0.0005 ? `dont ${C.money(rr, cur)} pas encore déclarés` : 'tout est déclaré'; })()}</span></div>
          <div class="pa-tuile"><span class="t">Impôt retenu ${info('pay.impot')}</span><b class="m">${montantU(C.round3(sum.irpp + sum.css), cur)}</b><span class="s">IRPP et solidarité, à reverser au Trésor</span></div></div>
        <section class="pa-carte" id="p-annee"><div class="pa-carte-t"><b>Le coût de la paie, mois par mois</b><span class="mu">brut et charges de l'employeur ; au survol, chaque mois</span></div>
          <div class="pa-graphe" role="img" aria-label="Coût de la paie de ${h(s.year)}, mois par mois">${mois.map(x => `<div class="pa-barre${x.m === dernier ? ' der' : ''}" title="${h(MONTHS_LONG[x.m - 1])} : ${x.n ? `${pl(x.n, 'bulletin')} · brut ${C.money(x.brut, cur)} · coût ${C.money(x.cout, cur)} · ${x.payes === x.n ? 'payé' : `${x.n - x.payes} à payer`}` : 'aucun bulletin'}"><span class="v">${x.m === dernier || (x.n && x.m === mois.find(z => z.n).m) ? C.money(x.cout, '') : ''}</span><i style="height:${Math.round(x.cout / max * 128)}px"></i><small>${h(['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][x.m - 1])}</small></div>`).join('')}</div>
          ${dernier ? (() => {
            // (plateforme) 1.227.0 — sous le graphique, ce qu'il additionne (la maquette) : le brut et le coût de l'année, mois faits.
            const premier = mois.find(z => z.n).m, brutAn = C.round3(mois.reduce((a, z) => a + z.brut, 0)), coutAn = C.round3(mois.reduce((a, z) => a + z.cout, 0));
            const de = premier === dernier ? MONTHS_LONG[dernier - 1] : `${MONTHS_LONG[premier - 1]} à ${MONTHS_LONG[dernier - 1]}`;
            return `<div class="pa-annee-w"><table class="list compact pa-annee-t"><tbody><tr><td>${h(de.charAt(0).toUpperCase() + de.slice(1))} : brut</td><td class="r nw">${C.money(brutAn, '')}</td></tr><tr><td>Coût (brut et charges de l'employeur)</td><td class="r nw"><b>${montantU(coutAn, cur)}</b></td></tr></tbody></table></div>`;
          })() : ''}</section>
        ${dernier ? (() => {
          // « Où va la paie du mois » : par poste (la fiche d'un salarié n'a pas d'équipe ; le poste en tient lieu), sa part du coût.
          // (1.253.0) Sur la page de l'année, l'année entière (elle disait « de novembre » sous « Coût de la paie 2026 ») ; un
          // salarié compte une fois par poste, même avec douze bulletins.
          const L = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap(mm => C.payslipsOf(data, y, mm)), tot = C.round3(L.reduce((a, x) => a + x.c.employerCost, 0)), G = {};
          // (1.257.0) Par ÉQUIPE quand il y en a (maquette « Où va la paie »), avec ce que le pointage de l'année en dit : les
          // heures sup payées, les jours sans solde, les retards ; sinon par poste, comme avant.
          const stA = C.payrollSettings(data), parEq = (stA.equipes || []).length > 0;
          const cle = e => { if (!parEq) return String(e.position || '').trim() || 'Sans poste'; const q = C.equipeDe(stA, e); return q ? q.nom : 'Sans équipe'; };
          L.forEach(x => { const k = cle(x.employee); (G[k] = G[k] || { n: new Set(), c: 0, hs: 0, abs: 0, ret: 0 }); G[k].n.add(x.employeeId); G[k].c = C.round3(G[k].c + x.c.employerCost); });
          // Les heures sup et les jours sans solde se lisent sur les bulletins (ce qui a été payé) ; les retards, sur le pointage.
          if (parEq) L.forEach(x => { const g = G[cle(x.employee)], e = employeeById(x.employeeId); g.abs = C.round3(g.abs + (Number(x.absentDays) || 0)); g.hs = C.round3(g.hs + (x.bonuses || []).filter(b => b.hs).reduce((a, b) => a + (Number(b.heures) || 0), 0)); if (e && C.pointageEnregistre(data, e.id, y, Number(x.month))) g.ret += C.pointageDuMois(data, e, y, Number(x.month)).jours.filter(j => j.retard).length; });
          const R = Object.entries(G).sort((a, b) => b[1].c - a[1].c);
          return `<section class="pa-carte" id="p-annee-postes"><div class="pa-carte-t"><b>Où va la paie de ${h(String(y))}</b><span class="mu">${parEq ? 'par équipe : son coût de l\'année, sa part, ce que ses bulletins ont payé et ses retards' : 'par poste, son coût de l\'année et sa part'}</span></div>
            <div class="scroll-x"><table class="list compact pa-liste"><thead><tr><th>${parEq ? 'Équipe' : 'Poste'}</th><th class="r">Salariés</th><th class="r">Coût en ${h(String(y))}</th><th class="r">Part</th>${parEq ? '<th class="r">Heures sup</th><th class="r">Sans solde</th><th class="r">Retards</th>' : ''}</tr></thead><tbody>
            ${R.map(([k, v]) => `<tr><td><b>${h(k)}</b></td><td class="r">${v.n.size}</td><td class="r nw">${C.money(v.c, '')}</td><td class="r">${tot ? Math.round(v.c / tot * 100) : 0} %</td>${parEq ? `<td class="r">${v.hs ? `${pct(v.hs)} h` : '—'}</td><td class="r">${v.abs ? `${pct(v.abs)} j` : '—'}</td><td class="r">${v.ret || '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
        })() : ''}${finDAnnee(y)}`;
      $$('#p-fa [data-fa]').forEach(b => b.onclick = () => {
        const k = b.dataset.fa;
        if (k === 'prime') variablesFenetre(y, 12, () => draw());
        else if (k === 'decl') { s.tab = 'declarations'; marquerVue(); draw(); }
        else if (k === 'conges') { s.tab = 'conges'; marquerVue(); draw(); }
        else if (k.startsWith('sal:')) location.hash = `#/salarie/${encodeURIComponent(k.slice(4))}`;
      });
    }
    // (1.256.0) LA FIN DE L'ANNÉE (la maquette, « L'année ») : ce que décembre et janvier demandent, daté, chacun avec son geste.
    // Rien ne se calcule tout seul : une prime de fin d'année, un report de congés, une régularisation de l'impôt dépendent de la
    // convention et de la loi (À VÉRIFIER) ; la carte les rappelle à temps.
    function finDAnnee(y) {
      const auj = C.today();
      if (y < Number(auj.slice(0, 4))) return '';
      const fin = `${y}-12-31`, emps = C.activeEmployees(data);
      const departs = emps.filter(e => e.endDate && e.endDate >= auj && e.endDate <= fin).sort((a, b) => a.endDate.localeCompare(b.endDate));
      const reste = C.round3(emps.reduce((a, e) => a + Math.max(0, Number(C.leaveBalance(data, e.id, y).remaining) || 0), 0));
      const L = [
        ['prime', 'Prime de fin d\'année', 'si ta convention en prévoit une : son montant et son mois (À VÉRIFIER) ; elle se pose dans les primes et retenues du mois', 'décembre', 'La poser…'],
        ...departs.map(e => [`sal:${e.id}`, `Le départ de ${e.name}`, 'son dernier bulletin, son solde de tout compte et son certificat de travail', `le ${C.fmtDate(e.endDate)}`, 'Sa fiche']),
        ['conges', 'Les congés qui restent', reste > 0 ? `${pct(reste)} jours à prendre avant la fin de l'année, ou à reporter (À VÉRIFIER : ta convention)` : 'aucun jour ne reste à prendre', 'décembre', 'Les congés'],
        ['', `Attestations de salaires ${y}`, `une par salarié (${pl(emps.length, 'salarié')}) : ce qu'il a gagné et ce qui a été retenu, pour sa déclaration d'impôt ; elles se préparent sur chaque fiche`, 'janvier', ''],
        ['decl', 'Déclaration annuelle d\'employeur', 'un salarié par ligne, ses salaires et ses retenues ; SkanFact la prépare depuis les bulletins', `février ${y + 1}`, 'Les déclarations'],
        ['', 'Régularisation de l\'impôt', 'si le salaire a changé dans l\'année, l\'impôt retenu chaque mois peut s\'écarter du barème annuel : à voir avec ton comptable (À VÉRIFIER)', 'décembre', '']
      ];
      return `<section class="pa-carte" id="p-fa"><div class="pa-carte-t"><b>La fin de l'année</b><span class="mu">ce que décembre et janvier demandent</span></div>
        <ul class="pa-fa">${L.map(([k, t, d, q, g]) => `<li><span class="pa-fa-q">${h(q)}</span><span class="pa-n"><b>${h(t)}</b><small>${h(d)}</small></span>${g ? `<button type="button" class="btn btn-sm" data-fa="${h(k)}">${h(g)}</button>` : '<span></span>'}</li>`).join('')}</ul></section>`;
    }

    // (plateforme) 1.224.0 — pointer à la main, sans pointeuse (la maquette de la paie, demande de Skander : « il faut pouvoir
    // faire le pointage manuellement si on n'a pas de pointeuse »). Chacun est présent par défaut ; on note ce qui change.
    const avPaie = e => `<span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}">${h(C.initialesDe(e.name || ''))}</span>`;
    const CODES_JOUR = [['P', 'Présent'], ['A', 'Absent'], ['C', 'Congé'], ['M', 'Malade'], ['D', 'Demi-journée']];
    const JOURS_SEM = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const enPosteLe = (iso) => data.employees.filter(e => e.active !== false && (!e.hireDate || e.hireDate <= iso) && (!e.endDate || e.endDate >= iso))
      .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    // (1.257.0) LE POINTAGE VALIDÉ (maquette E20) : une version figée du mois (ce que chaque bulletin en reprend), le mois
    // verrouillé ; « Corriger : une nouvelle version » le rouvre, et la version suivante dit ce qui a changé.
    const ymPt = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const versionsPt = ym => (data.pointageVersions || []).filter(v => v.ym === ym);
    const ptVerrouille = ym => versionsPt(ym).length > 0 && !(data.pointageOuverts || []).includes(ym);
    // (1.258.0) LA JOURNÉE VALIDÉE (demande de Skander, 02/11 : « valider un pointage du jour ») : le soir, d'un geste, la
    // journée se valide ; elle ne se change plus sans être rouverte (« Rouvrir la journée », avec la date de la réouverture).
    // On règle un oubli le jour même, tant qu'on s'en souvient. Le mois se valide toujours à part (c'est lui que les
    // bulletins reprennent) ; un réglage (« Le mois se valide quand chaque journée l'est ») le fait attendre les journées.
    const joursValides = () => (Array.isArray(data.joursValides) ? data.joursValides : []);
    const jourValide = iso => joursValides().find(x => x.iso === String(iso || '').slice(0, 10) && !x.rouvertLe);
    const heureDe = le => { const d = new Date(le); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`; };
    let ptRedessin = null;
    // Une période qui touche une journée validée se refuse, et dit lesquelles (une case de ce jour la rouvre).
    const refusJoursValides = isos => {
      const v = [...new Set(isos)].filter(i => jourValide(i)).sort();
      if (!v.length) return false;
      toast(`${v.length > 1 ? 'Les journées' : 'La journée'} du ${v.slice(0, 6).map(i => C.fmtDate(i).slice(0, 5)).join(', ')}${v.length > 6 ? '…' : ''} ${v.length > 1 ? 'sont validées' : 'est validée'} : un clic sur une de ses cases ${v.length > 1 ? 'les rouvre une à une' : 'la rouvre'}, puis recommence.`, true);
      return true;
    };
    // (plateforme, 03/11/2026 — 16 § 10.1, point 9) Toutes les journées validées se gardent (16 § 8) : la liste n'est plus
    // coupée aux 400 dernières (la plus ancienne redevenait « pas encore validée » et se changeait sans être rouverte).
    const validerJour = iso => { data.joursValides = [...joursValides().filter(x => x.iso !== iso), { iso, le: new Date().toISOString() }]; };
    const rouvrirJour = iso => { data.joursValides = joursValides().map(x => x.iso === iso && !x.rouvertLe ? { ...x, rouvertLe: new Date().toISOString() } : x); };
    const instantPt = (y, m) => {
      const st = C.payrollSettings(data), premier = `${ymPt(y, m)}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1);
      const out = {};
      data.employees.filter(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier)).forEach(e => {
        const p = C.pointageDuMois(data, e, y, m);
        out[e.id] = { nom: e.name, payes: p.payes, absences: p.absences, retards: p.jours.filter(j => j.retard).length, minRetard: p.retards || 0,
          hs: C.heuresSupDuMois(data, e, y, m).map(b => [b.hs, b.heures]), conges: p.jours.filter(j => j.code === 'C').length, maladie: p.jours.filter(j => j.code === 'M').length,
          jours: p.jours.filter(j => j.code !== 'P' && j.code !== 'R' && j.code !== '-').map(j => [j.jour, j.code]) };
      });
      void st;
      return out;
    };
    const peutPointerLe = (iso) => {
      if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return false; }
      if (iso && ptVerrouille(String(iso).slice(0, 7))) { const mm = MONTHS_LONG[Number(String(iso).slice(5, 7)) - 1]; toast(`Le pointage ${/^[aeiouyéè]/i.test(mm) ? 'd\'' : 'de '}${mm} est validé, donc verrouillé : « Corriger : une nouvelle version » le rouvre.`, true); return false; }
      const jv = iso && jourValide(iso);
      if (jv) {
        const j = String(iso).slice(0, 10);
        toastUndo(`La journée du ${C.fmtDate(j).slice(0, 5)} est validée (à ${heureDe(jv.le)}) : elle ne se change plus sans être rouverte.`, () => { rouvrirJour(j); save(true); if (ptRedessin) ptRedessin(); toast(`La journée du ${C.fmtDate(j).slice(0, 5)} est rouverte : tu peux la changer, puis la valider à nouveau.`); }, 'Rouvrir la journée');
        return false;
      }
      if (closedBlock(iso, 'Ce pointage')) return false;
      // (1.271.0) En Essentiel, le client dont le cabinet tient la paie pointe aussi (le serveur le permet : FAITS_DU_CLIENT).
      if (!(data.timesheets || []).length && faitBloque('Pointer les salariés')) return false;
      return true;
    };
    // (1.259.0) LA REFONTE DU POINTAGE (docs/maquettes/pointage.html, validée par Skander le 02/11/2026). Deux vues au lieu
    // de sept endroits : « La journée » (le soir, on note ce qui change et on la valide ; d'abord au téléphone) et « Le mois »
    // (on relit ses écarts, on règle « À régler », on le valide). UNE règle de validation, qui remplace le réglage « le mois
    // se valide quand chaque journée l'est » : ceux qui pointent à la main valident chaque journée ; ceux de la pointeuse
    // arrivent par leurs badges ; le mois est prêt quand « À régler » est vide et que sa dernière journée est passée.
    const ptALaMain = e => { const q = C.equipeDe(C.payrollSettings(data), e); return !q || q.pointe !== 'pointeuse'; };
    const isoDe = (y, m, d) => `${ymPt(y, m)}-${String(d).padStart(2, '0')}`;
    const jjmm = iso => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
    const jourDit = iso => `${JOURS_SEM[new Date(iso + 'T00:00:00Z').getUTCDay()]} ${jjmm(iso)}`;
    const capi = t => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
    const deMois = mm => (/^[aeiouyéè]/i.test(mm) ? `d'${mm}` : `de ${mm}`);
    const datesDites = (L, m) => L.length > 4 ? `du ${String(L[0]).padStart(2, '0')} au ${String(L[L.length - 1]).padStart(2, '0')}/${String(m).padStart(2, '0')}` : `le${L.length > 1 ? 's' : ''} ${L.map(d => String(d).padStart(2, '0')).join(', ').replace(/, ([^,]*)$/, ' et $1')}/${String(m).padStart(2, '0')}`;
    // Le mois de chacun de ceux qui pointent à la main, calculé une fois (un calcul qui lit tout se fait en lot).
    const moisALaMain = (y, m) => {
      const premier = `${ymPt(y, m)}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1);
      return data.employees.filter(e => e.active !== false && (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier) && ptALaMain(e)).map(e => C.pointageDuMois(data, e, y, m));
    };
    const travailleLe = (P, d) => P.some(p => { const j = p.jours[d - 1]; return j && j.code !== '-' && !j.repos; });
    // Les journées passées du mois (jusqu'à aujourd'hui) où quelqu'un qui pointe à la main travaille, pas encore validées.
    function joursNonValides(y, m) {
      const auj = C.today(), n = C.daysInMonth(y, m), P = moisALaMain(y, m), out = [];
      for (let d = 1; d <= n; d++) {
        const iso = isoDe(y, m, d);
        if (iso > auj) break;
        if (!jourValide(iso) && travailleLe(P, d)) out.push(iso);
      }
      return out;
    }
    // La fenêtre qui les montre, et les valide d'un geste (après relecture).
    function joursAValiderFenetre(y, m, apres) {
      const L = joursNonValides(y, m), mois = MONTHS_LONG[m - 1];
      if (!L.length) return;
      modal(`<h2>${pl(L.length, 'journée', 'journées')} pas encore ${L.length > 1 ? 'validées' : 'validée'}</h2>
        <p class="sous-f">Ceux qui pointent à la main valident chaque journée ; le pointage ${h(deMois(mois))} attend qu'elles le soient. ${L.length > 1 ? 'Relis-les (chacune s\'ouvre dans « La journée »), puis valide-les' : 'Relis-la, puis valide-la'}.</p>
        <ul class="jav-l" id="jav-l">${L.map(iso => `<li>${h(jourDit(iso))}</li>`).join('')}</ul>
        <p class="regle">${lfIc('aide', 14)} Une journée validée ne se change plus sans être rouverte.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="jav-ok">${lfIc('coche', 15, 2.4)} Valider ${L.length > 1 ? `ces ${L.length} journées` : 'cette journée'}</button></div>`, (root, fermer) => {
        $('#jav-ok', root).onclick = () => {
          if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
          const avant = JSON.stringify(joursValides());
          L.forEach(validerJour); save(true); fermer(); apres();
          toastUndo(`${pl(L.length, 'journée validée', 'journées validées')} ${deMois(mois)}`, () => { data.joursValides = JSON.parse(avant); save(true); apres(); });
        };
      });
    }
    // Le jour ouvert dans « La journée » : celui choisi s'il est dans le mois de la bande ; sinon aujourd'hui (le mois du
    // jour), le dernier jour (un mois passé) ou le 1er (un mois à venir).
    const ptJourOuvert = () => {
      const y = Number(s.ptY), m = Number(s.ptM), ym = ymPt(y, m), auj = C.today();
      if (s.ptJourIso && String(s.ptJourIso).startsWith(ym)) return s.ptJourIso;
      return auj.startsWith(ym) ? auj : ym < auj.slice(0, 7) ? isoDe(y, m, C.daysInMonth(y, m)) : `${ym}-01`;
    };
    // Ce que dit la journée d'un salarié (son code, son retard, ses heures sup du jour, ses badges) et ce que son bulletin en
    // fera, chiffré. `k` est le choix allumé de sa ligne.
    function etatJour(e, iso) {
      const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
      const st = C.payrollSettings(data), p = C.pointageDuMois(data, e, y, m), j = p.jours[d - 1];
      if (!j || j.code === '-') return null;
      const cur = company().currency, brut = C.brutDuMois(e, y, m) || Number(e.grossSalary) || 0;
      const unJour = C.round3(brut / (Number(p.total) || 26)), hm = C.heuresDuMoisDe(st, e);
      const b = C.journeeBadges(data, e, iso), hsj = C.heuresSupDuJour(data, e, y, m, d);
      const an = C.anomaliesPointage(data, y, m, null).find(a => a.employeeId === e.id && a.sorte === 'sortie' && a.jour === d) || null;
      const k = j.code === 'P' ? (hsj ? 'hs' : j.retard ? 'retard' : 'P') : j.code;
      const reste = () => { try { return Number(C.leaveBalance(data, e.id, y).remaining) || 0; } catch (_) { return null; } };
      let ton = '', dit = '';
      if (an) { ton = 'alerte'; dit = 'pas de sortie : à régler'; }
      else if (j.repos) dit = j.code === 'P' ? 'venu un jour de repos : ses heures se notent en heures sup' : 'jour de repos';
      else if (k === 'A') { ton = 'alerte'; dit = `− ${C.money(unJour, cur)} sur son brut`; }
      else if (k === 'D') { ton = 'alerte'; dit = `demi-journée : − ${C.money(C.round3(unJour / 2), cur)} sur son brut`; }
      else if (k === 'C') { const r = reste(); dit = `congé payé : son salaire ne bouge pas${r != null ? ` · il lui reste ${pct(r)} j` : ''}`; }
      else if (k === 'M') dit = 'malade : certificat à joindre (À VÉRIFIER : la CNAM)';
      else if (k === 'F') dit = `férié : payé${j.ferie ? ` (${j.ferie})` : ''}`;
      else if (k === 'hs') { ton = 'attire'; const mt = hm > 0 ? C.round3(brut * hsj.heures * (100 + hsj.majoration) / 100 / hm) : 0; dit = `+ ${pct(hsj.heures)} h à +${pct(hsj.majoration)} %${mt ? ` · + ${C.money(mt, cur)}` : ''}`; }
      else if (k === 'retard') { const mt = st.retenirRetards && hm > 0 ? C.round3(brut / hm * j.retard / 60) : 0; dit = `${j.retard} min · ${st.retenirRetards ? (mt ? `retenu : − ${C.money(mt, cur)}` : 'retenu (ton réglage)') : 'noté, pas retenu (ton réglage)'}`; }
      else if (b && b.auDela) dit = `${hDit(b.auDela)} au-delà de son horaire, sur ses badges : pas compté`;
      return { j, p, b, hsj, an, k, ton, dit, unJour, y, m, d };
    }
    // (1.267.0, morceau B) La journée de la maquette (16 § 2.2) : quatre choix qui se posent d'un clic, sans fenêtre (Là,
    // Absent, Congé, Malade) ; le retard et les heures sup s'AJOUTENT à « Là » (« + Retard », « + H. sup ») ; ce que le
    // bulletin en fera se lit sous la ligne, en dinars, avec ce qui se règle sur place (la demi-journée, les minutes, les
    // heures). Au clavier : ↑ ↓ d'un salarié à l'autre, puis L, A, C, M, R, H.
    const CHOIX_J = [['P', 'Là'], ['A', 'Absent'], ['C', 'Congé'], ['M', 'Malade']];
    const TOUCHE_J = { l: 'P', a: 'A', c: 'C', m: 'M', r: 'retard', h: 'hs' };
    // Le congé ou l'arrêt saisi d'avance qui couvre ce jour (celui que lit le pointage, source « conge »).
    const congePrevu = (e, iso) => (data.leaves || []).find(l => l.employeeId === e.id && l.from <= iso && iso <= l.to && (!l.statut || l.statut === 'accepte')) || null;
    const prenomDe = e => String((e && e.name) || '').split(' ')[0];
    // (1.271.0 ; Skander, 04/11/2026 : « décide pour moi et donne la liberté à l'utilisateur, faut pas le bloquer ») Pourquoi
    // une absence : une note du jour, facultative, jamais exigée ; elle ne change aucun montant. Vide, elle s'efface. Rangée
    // dans le pointage du mois (`motifs`), qu'une absence a toujours ; le moteur l'efface avec l'absence (poserPointage).
    const motifAbsence = (eId, y, m, d) => { const t = C.pointageEnregistre(data, eId, y, m); return (t && t.motifs && t.motifs[String(d)]) || ''; };
    const poserMotifAbsence = (e, y, m, d, texte) => {
      const t = C.pointageEnregistre(data, e.id, y, m), v = String(texte == null ? '' : texte).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!t) return !v;
      t.motifs = t.motifs || {};
      if (v) t.motifs[String(d)] = v; else delete t.motifs[String(d)];
      if (!Object.keys(t.motifs).length) delete t.motifs;
      return true;
    };
    function detailJourHtml(e, iso, x, fige, ouvre) {
      const st = C.payrollSettings(data), cur = company().currency, id = h(e.id), L = [], dis = fige ? ' disabled' : '';
      const hm = C.heuresDuMoisDe(st, e), brut = C.brutDuMois(e, x.y, x.m) || Number(e.grossSalary) || 0, c = x.j.code;
      const du = l => l.from === l.to ? `le ${jjmm(l.from)}` : `du ${jjmm(l.from)} au ${jjmm(l.to)}`;
      if (x.an) L.push(`<span class="ptj-ef alerte">pas de sortie : à régler</span>${fige ? '' : x.an.proposee
        ? `<button type="button" class="btn btn-sm" data-an-sortie="${id}" data-j="${x.d}" data-h="${h(x.an.proposee)}">${lfIc('coche', 13, 2.4)} Mettre la sortie à ${h(x.an.proposee)}</button>`
        : `<button type="button" class="btn btn-sm" data-ptj-sortie="${id}">Mettre sa sortie…</button>`}`);
      if (x.j.repos) L.push(`<span class="mu">${c === 'P' ? 'venu un jour de repos : ses heures se notent en heures sup' : 'jour de repos'}</span>`);
      else if (c === 'A' || c === 'D') {
        L.push(`<span class="ptj-mini" role="group" aria-label="${h(prenomDe(e))} : combien de temps">${[['A', 'Toute la journée'], ['D', 'Une demi-journée']].map(([k, t]) => `<button type="button" data-ptj-demi="${id}:${k}" aria-pressed="${c === k}"${dis}>${t}</button>`).join('')}</span>`);
        L.push(`<span class="ptj-ef alerte">− ${C.money(c === 'D' ? C.round3(x.unJour / 2) : x.unJour, cur)} sur son brut</span><span class="mu">(${c === 'D' ? 'la moitié d\'un jour' : 'un jour'} : son brut ÷ ${pct(Number(x.p.total) || 26)}${x.j.source === 'conge' ? ' · une absence sans solde saisie d\'avance' : ''})</span>`);
        // (1.271.0 ; Skander, 04/11/2026 : « donne la liberté à l'utilisateur ») Pourquoi : une note facultative, jamais exigée.
        if (x.j.source !== 'conge') L.push(`<label class="ptj-in ptj-pourquoi">Pourquoi ? <input type="text" class="ptj-txt" data-ptj-motif="${id}" maxlength="120" value="${h(motifAbsence(e.id, x.y, x.m, x.d))}" placeholder="si tu veux le noter" aria-label="Pourquoi ${h(prenomDe(e))} est absent (facultatif)"${dis}></label>`);
      } else if (c === 'C') {
        const l = x.j.source === 'conge' ? congePrevu(e, iso) : null;
        if (l) L.push(`<span>Prévu : congé ${du(l)}${l.note ? ` (${h(l.note)})` : ''}</span><span class="mu">tu n'as rien à faire</span>`);
        else {
          const r = (() => { try { return Number(C.leaveBalance(data, e.id, x.y).remaining) || 0; } catch (_) { return null; } })();
          L.push(`<span>Congé payé, pris sur ses jours${r != null ? ` : il lui en reste <b>${pct(r)}</b>` : ''}</span><span class="mu">son salaire ne bouge pas · plusieurs jours ?</span><button type="button" class="btn btn-sm btn-ghost" data-ptj-periode="${id}"${dis}>Une absence prévue…</button>`);
        }
      } else if (c === 'M') {
        const l = x.j.source === 'conge' ? congePrevu(e, iso) : null;
        if (l) L.push(`<span>Arrêt maladie ${du(l)}</span><span class="mu">${l.certificatLe ? 'certificat reçu' : 'certificat pas encore joint : il ne retient pas les bulletins'}</span>`);
        else L.push(`<span>Malade</span><button type="button" class="btn btn-sm" data-ptj-arret="${id}"${dis}>${lfIc('depot', 14)} Noter l'arrêt et son certificat…</button><span class="mu">ou plus tard : il ne retient pas les bulletins · payé ou non selon ta convention (À VÉRIFIER)</span>`);
      } else if (c === 'F') L.push(`<span>Férié : payé${x.j.ferie ? ` (${h(x.j.ferie)})` : ''}</span><span class="mu">la liste des fériés : À VÉRIFIER</span>`);
      if (c === 'P' && !x.j.repos && (x.j.retard || ouvre === 'retard')) {
        if (x.j.retardBadge) L.push(`<span>En retard de ${x.j.retard} minutes, lu sur ses badges${x.b ? ` (arrivé à ${h(x.b.arrivee)})` : ''}</span><span class="mu">${st.retenirRetards ? 'retenu (ton réglage)' : 'noté, rien ne se retient'}</span>`);
        else {
          const mt = st.retenirRetards && hm > 0 && x.j.retard ? C.round3(brut / hm * x.j.retard / 60) : 0;
          L.push(`<label class="ptj-in">En retard de <input type="number" class="num ptj-num" data-ptj-min="${id}" min="0" max="600" step="5" value="${x.j.retard || ''}" placeholder="15" aria-label="Minutes de retard de ${h(e.name)}"${dis}> minutes</label><span class="ptj-ef">${st.retenirRetards ? (mt ? `retenu : − ${C.money(mt, cur)}` : 'retenu sur son salaire (ton réglage)') : 'noté, rien ne se retient'}</span>${st.retenirRetards ? '' : '<span class="mu">(la retenue des retards est éteinte dans tes réglages)</span>'}`);
        }
      }
      if (c === 'P' && !x.j.repos && (x.hsj || ouvre === 'hs')) {
        const majs = C.majorationsHs(st), maj = x.hsj ? x.hsj.majoration : majs[0], hh = x.hsj ? x.hsj.heures : 0;
        const mt = hm > 0 && hh && maj != null ? C.round3(brut * hh * (100 + maj) / 100 / hm) : 0;
        L.push(`<label class="ptj-in"><input type="number" class="num ptj-num" data-ptj-hs="${id}" min="0" max="16" step="0.25" value="${hh || ''}" placeholder="2" aria-label="Heures sup de ${h(e.name)}"${dis}> heures sup</label><span class="ptj-ef attire">${mt ? `+ ${C.money(mt, cur)} sur son brut` : hm > 0 ? 'combien d\'heures ? elles s\'ajoutent à son brut' : 'le prix d\'une heure attend « Les horaires »'}</span>${maj != null ? `<span class="mu">à +${pct(maj)} % (À VÉRIFIER selon ton secteur)</span>` : ''}`);
      }
      if (c === 'P' && !x.j.repos && x.b && x.b.auDela && !x.hsj) L.push(`<span class="mu">${h(hDit(x.b.auDela))} au-delà de son horaire, sur ses badges : pas compté</span>`);
      return L.join('');
    }
    function ligneJourHtml(e, iso, fige) {
      const x = etatJour(e, iso); if (!x) return '';
      const st = C.payrollSettings(data), q = C.equipeDe(st, e), id = h(e.id);
      const src = x.b ? `<span class="ptj-badw"><span class="mono ptj-bad">${lfIc('importer', 12)} ${h(x.b.arrivee)} → ${x.b.depart ? h(x.b.depart) : '<b class="warn-text">?</b>'}</span>${x.b.sortieMain ? '<small class="mu">sortie mise par toi</small>' : ''}</span>`
        : `<span class="mu ptj-bad">${ptALaMain(e) ? `${lfIc('ecriture', 12)} à la main` : iso >= C.today() ? 'badges pas encore lus' : 'aucun badge ce jour'}</span>`;
      const fam = x.j.code === 'D' ? 'A' : x.j.code;
      const ouvre = s.ptjOuvre && s.ptjOuvre.id === e.id && s.ptjOuvre.iso === iso ? s.ptjOuvre.quoi : '';
      const fin = x.j.repos
        ? `<button type="button" class="btn btn-sm" data-ptj-repos="${id}"${fige ? ' disabled' : ''}>${x.j.code === 'P' ? 'Il était au repos…' : 'Il est venu travailler…'}</button>`
        : `<span class="ptj-fin"><span class="ptj-seg" role="group" aria-label="${h(e.name)}, ${h(jourDit(iso))}">${CHOIX_J.map(([c, l]) => `<button type="button" data-ptj="${id}:${c}" aria-pressed="${fam === c}"${fige ? ' disabled' : ''}>${l}</button>`).join('')}</span>${
          [['retard', x.j.retard ? `Retard ${x.j.retard} min` : '+ Retard', !!x.j.retard, 'Arrivé en retard : combien de minutes'], ['hs', x.hsj ? `${pct(x.hsj.heures)} h sup` : '+ H. sup', !!x.hsj, 'Resté plus tard : combien d\'heures en plus']]
            .map(([k, l, on, t]) => `<button type="button" class="ptj-aj${on || ouvre === k ? ' on' : ''}" data-ptj-plus="${id}:${k}" title="${h(t)}"${fige || x.j.code !== 'P' ? ' disabled' : ''}>${l}</button>`).join('')}</span>`;
      const pastille = { P: 'Là', A: 'Absent', C: 'Congé', M: 'Malade', D: '½ journée', F: 'Férié', R: 'Repos', retard: 'Retard', hs: '+ h sup' }[x.an ? '' : x.k] || (x.an ? 'À régler' : '');
      return `<li class="ptj-l${x.an ? ' a-regler' : ''}" data-ptj-e="${id}"${fige ? '' : ' tabindex="0"'}>${avPaie(e)}<span class="ptj-n"><b>${h(e.name)}</b><small>${h(q ? `${q.nom}${q.debut && q.fin ? ` · ${q.debut} – ${q.fin}` : ''}` : (e.position || 'les horaires de l\'entreprise'))}</small></span>${src}${fin}
        <div class="ptj-e">${detailJourHtml(e, iso, x, fige, ouvre)}</div>
        <button type="button" class="ptj-tel" data-ptj-tel="${id}"${fige || x.j.repos ? ' hidden' : ''} aria-label="${h(e.name)} : changer ce jour">${pastille ? `<span class="ptj-pas ${x.ton}">${h(pastille)}</span>` : ''}<span class="ptj-fl" aria-hidden="true">›</span></button></li>`;
    }
    function drawPtJour() {
      const iso = ptJourOuvert(), y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10)), auj = C.today();
      s.ptJourIso = iso;
      const st = C.payrollSettings(data), mois = MONTHS_LONG[m - 1], verrou = ptVerrouille(ymPt(y, m)), n = C.daysInMonth(y, m);
      const L = enPosteLe(iso), jv = jourValide(iso), fige = !!jv || verrou;
      // (1.267.0) La journée vit dans la colonne de gauche d'« Aujourd'hui » ; son bouton n'est vert que si rien d'autre ne l'est.
      const cible = $('#pj-jour') || $('#p-body'), vert = principalDuJour() ? 'btn' : 'btn btn-primary';
      if (!enPosteLe(isoDe(y, m, n)).length && !L.length) { cible.innerHTML = `<div class="empty">Aucun salarié en poste le ${h(C.fmtDate(iso))}.</div>`; return; }
      const P = moisALaMain(y, m);
      const Q = st.equipes || [];
      const groupes = [...Q.map(q => ({ q, L: L.filter(e => e.equipeId === q.id) })), { q: null, L: L.filter(e => !Q.some(q => q.id === e.equipeId)) }].filter(g => g.L.length);
      const im = dernierImport();
      const eqT = g => g.q ? `<b>${h(g.q.nom || 'Équipe')}</b><span class="mu">${g.q.debut && g.q.fin ? `${h(g.q.debut)} – ${h(g.q.fin)} · ` : ''}${g.q.pointe === 'pointeuse' ? `la pointeuse${im ? ` : badges lus le ${h(jjmm(C.jourDeLInstant(im.le)))} à ${h(heureDe(im.le))}` : ' : aucun badge importé'}` : 'à la main'}</span>`
        : `<b>${Q.length ? 'Sans équipe' : 'Toute l\'entreprise'}</b><span class="mu">les horaires de l'entreprise · à la main</span>`;
      const deb = Math.max(1, Math.min(d - 5, n - 6));
      const nav = Array.from({ length: Math.min(7, n) }, (_, k) => deb + k).map(dd => {
        const i2 = isoDe(y, m, dd), wd = new Date(i2 + 'T00:00:00Z').getUTCDay(), v = jourValide(i2);
        const repos = !enPosteLe(i2).some(e => { const j = C.pointageDuMois(data, e, y, m).jours[dd - 1]; return j && j.code !== '-' && !j.repos; });
        const t = v ? 'ok' : i2 > auj ? 'fu' : i2 === auj ? 'auj' : repos ? 'repos' : travailleLe(P, dd) ? 'nv' : '';
        const dit = v ? lfIc('coche', 11, 3) : t === 'auj' ? 'aujourd\'hui' : t === 'repos' ? 'repos' : t === 'nv' ? 'à valider' : '';
        return `<button type="button" class="ptj-d ${t}" data-ptj-d="${i2}" aria-pressed="${dd === d}" aria-label="${h(jourDit(i2))}${v ? ', validée' : t === 'nv' ? ', pas encore validée' : ''}"><small>${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][wd]}</small><b>${dd}</b><i>${dit}</i></button>`;
      }).join('');
      const passes = Array.from({ length: n }, (_, k) => k + 1).filter(dd => isoDe(y, m, dd) <= auj && travailleLe(P, dd));
      const nValides = passes.filter(dd => jourValide(isoDe(y, m, dd))).length;
      const navDit = !P.length ? 'tout le monde pointe à la pointeuse : les journées arrivent par les badges, rien à valider'
        : passes.length ? `${nValides ? pl(nValides, 'journée validée', 'journées validées') : 'aucune journée validée'} sur ${passes.length}, depuis le 1er${passes.includes(Number(auj.slice(8, 10))) && auj.startsWith(ymPt(y, m)) && !jourValide(auj) ? ' · celle d\'aujourd\'hui attend' : ''}` : 'aucune journée passée à valider ce mois-ci';
      const etats = L.map(e => etatJour(e, iso)).filter(Boolean);
      const change = etats.filter(x => x.dit && !(x.j.repos && x.j.code === 'R')).length;
      const attendus = etats.filter(x => !x.j.repos).length;
      const manque = L.filter(e => { const x = etatJour(e, iso); return x && x.an; });
      const aValider = travailleLe(P, d);
      const vuQ = (() => { try { return localStorage.getItem('skanfact.pt-q-vu') === '1'; } catch { return false; } })();
      // (1.267.0, morceau B) Le pied résume la journée comme la maquette : « 4 là · Karim : absent · Nadia : retard 15 min ».
      const libJ = x => ({ A: 'absent', D: 'demi-journée', C: 'congé', M: 'malade', F: 'férié', retard: `retard ${x.j.retard} min`, hs: `${pct(x.hsj ? x.hsj.heures : 0)} h sup` })[x.k] || '';
      const notes = L.map(e => [e, etatJour(e, iso)]).filter(([, x]) => x && !x.j.repos && libJ(x));
      const nLa = attendus - notes.filter(([, x]) => ['A', 'C', 'M', 'F'].includes(x.k)).length;
      const resume = `${nLa} là${notes.length ? ` · ${notes.slice(0, 3).map(([e, x]) => `${prenomDe(e)} : ${libJ(x)}`).join(' · ')}${notes.length > 3 ? ` · et ${notes.length - 3} autres` : ''}` : ' · rien de noté'}`;
      const pied = verrou ? `<span class="mu">Le pointage ${h(deMois(mois))} est validé, donc verrouillé : il se corrige depuis « Le mois ».</span>`
        : jv ? '' : iso > auj ? `<span class="mu">${lfIc('aide', 13)} Ce jour est à venir : un congé ou une absence se notent d'avance ; la journée se valide le soir venu.</span>`
          : !attendus ? `<span class="mu">${lfIc('aide', 13)} Jour de repos pour toute l'équipe : rien à valider.</span>`
            : !aValider ? `<span class="mu">${lfIc('aide', 13)} Ceux qui pointent à la pointeuse n'ont pas de journée à valider : leurs anomalies se règlent dans « Le mois ».</span>`
              : `<span class="ptj-resume" title="Valider fige la journée : elle part telle quelle dans le mois.">${h(resume)}</span>
                <button type="button" class="${vert}" id="ptj-valider"${manque.length ? ` aria-disabled="true" title="La sortie de ${h(manque.map(e => String(e.name || '').split(' ')[0]).join(', '))} manque : règle-la d'abord"` : ''}>${lfIc('coche', 15, 2.4)} ${manque.length ? `Régler la sortie de ${h(manque.map(e => String(e.name || '').split(' ')[0]).join(', '))}, puis valider` : `Valider la journée${iso === auj ? '' : ` du ${jjmm(iso)}`}`}</button>`;
      cible.innerHTML = `${ptValideHtml(y, m)}
        ${st.pointageRegle || vuQ ? '' : `<div class="bandeau info pa-bandeau" id="ptj-q">${lfIc('reglages', 18)}<span class="txt"><b>Le pointage se règle en 4 questions</b><span>Comment ton équipe pointe, tes jours de travail, les retards, la nuit : une seule fois ; tout se change ensuite dans « Les horaires ».</span></span><span class="pa-bandeau-g"><button type="button" class="btn btn-sm" id="ptj-q-go">Répondre aux 4 questions</button><button type="button" class="btn btn-sm btn-ghost" id="ptj-q-non">Plus tard</button></span></div>`}
        ${jv && !verrou ? `<div class="bandeau info pa-bandeau" id="ptj-valide">${lfIc('cadenas', 18)}<span class="txt"><b>Journée ${iso === auj ? 'd\'aujourd\'hui' : `du ${h(jourDit(iso))}`} validée à ${h(heureDe(jv.le))}</b><span>Elle ne bouge plus : un choix de ce jour refuse et propose « Rouvrir la journée ». Elle part dans le mois telle quelle.</span></span><button type="button" class="btn btn-sm" id="ptj-rouvrir">${lfIc('cadenas', 14)} Rouvrir la journée</button></div>` : ''}
        <div class="ptj-barre"><div class="ptj-nav" role="group" aria-label="Le jour"><button type="button" class="pt-nav-b" id="ptj-prec" aria-label="Le jour d'avant">${ICONE_CHEVRON}</button>${nav}<button type="button" class="pt-nav-b pt-nav-s" id="ptj-suiv" aria-label="Le jour d'après" ${C.addDays(iso, 1) <= C.addDays(auj, 62) ? '' : 'disabled'}>${ICONE_CHEVRON}</button></div>
          <span class="mu ptj-nav-t">${h(navDit)}</span>
          <span class="ptj-gestes">${iso !== auj ? '<button type="button" class="btn btn-sm" id="ptj-auj">Revenir à aujourd\'hui</button>' : ''}<button type="button" class="btn btn-sm" id="pt-periode" ${verrou ? 'disabled' : ''}>${lfIc('echeance', 14)} Une absence sur plusieurs jours</button>${aLaPointeuse().length && !verrou ? `<button type="button" class="btn btn-sm" id="pt-import">${lfIc('importer', 14)} ${im ? 'Importer à nouveau…' : 'Importer la pointeuse…'}</button>` : ''}</span></div>
        <section class="pa-carte ptj-c" id="ptj"><div class="pa-carte-t"><b>${iso === auj ? 'Qui est là aujourd\'hui ?' : iso > auj ? `Qui sera là ${h(jourDit(iso))} ?` : `Qui était là ${h(jourDit(iso))} ?`}</b><span class="mu">${attendus ? `${pl(attendus, 'salarié')} attendu${attendus > 1 ? 's' : ''}` : 'personne n\'est attendu'} · ${change ? `${pl(change, 'chose')} qui change${change > 1 ? 'nt' : ''} ce que dit le bulletin` : 'rien ne change le bulletin'}${fige ? ' · figée' : ''}</span></div>
          ${fige ? '' : '<p class="ptj-sous"><span>Tout le monde est là par défaut : note seulement ce qui change, c\'est enregistré aussitôt.</span><span class="ptj-kbd">au clavier : <kbd>↑</kbd> <kbd>↓</kbd> puis <kbd>L</kbd> là <kbd>A</kbd> absent <kbd>C</kbd> congé <kbd>M</kbd> malade <kbd>R</kbd> retard <kbd>H</kbd> h. sup</span></p>'}
          ${L.length >= 12 ? `<div class="ptj-cherche"><input type="search" id="ptj-q-s" placeholder="Chercher un salarié : nom, poste…" aria-label="Chercher un salarié" value="${h(s.ptjCherche || '')}" autocomplete="off"><span class="mu">${pl(L.length, 'salarié')}${Q.length ? ` · ${pl(Q.length, 'équipe')}` : ''}</span></div>` : ''}
          ${groupes.map(g => `<div class="ptj-eq"><div class="ptj-eq-t">${eqT(g)}</div><ul class="ptj-ll">${g.L.map(e => ligneJourHtml(e, iso, fige)).join('')}</ul></div>`).join('')}
          ${L.length >= 12 ? '<div class="pa-auj-vide" id="ptj-rien" hidden><span>Personne ne s\'appelle « <b></b> ».</span><button type="button" class="btn btn-sm btn-ghost" id="ptj-tout">Tout montrer</button></div>' : ''}
          ${pied ? `<div class="ptj-pied" id="ptj-pied">${pied}</div>` : ''}</section>`;
      const redessin = () => drawPtJour();
      ptRedessin = redessin;
      majNbSous();
      lierValide(y, m, redessin);
      lierPointeuse(y, m, redessin);
      // (1.267.0) ‹ › passent d'un mois à l'autre (la journée n'a plus la bande des mois) : un autre mois redessine la page.
      const aller = i2 => { s.ptJourIso = i2; s.ptjOuvre = null; if (i2.slice(0, 7) !== iso.slice(0, 7)) draw(); else drawPtJour(); const b = $(`#p-body [data-ptj-d="${i2}"]`); if (b) b.focus(); };
      $$('#p-body [data-ptj-d]').forEach(b => b.onclick = () => aller(b.dataset.ptjD));
      $('#ptj-prec').onclick = () => aller(C.addDays(iso, -1));
      $('#ptj-suiv').onclick = () => { if (C.addDays(iso, 1) <= C.addDays(auj, 62)) aller(C.addDays(iso, 1)); };
      if ($('#ptj-auj')) $('#ptj-auj').onclick = () => aller(auj);
      $('#pt-periode').onclick = () => ptPeriodeFenetre(null, redessin, iso);
      if ($('#ptj-q-go')) $('#ptj-q-go').onclick = () => premiereFenetre(redessin);
      if ($('#ptj-q-non')) $('#ptj-q-non').onclick = () => { try { localStorage.setItem('skanfact.pt-q-vu', '1'); } catch { /* poste sans stockage */ } $('#ptj-q').remove(); };
      $$('#ptj [data-ptj]').forEach(b => b.onclick = () => { const [id, c] = b.dataset.ptj.split(':'), e = employeeById(id); if (e) choisirJour(e, iso, c, redessin); });
      // (1.267.0, morceau B) Les ajouts, la demi-journée, les cases de la ligne, le clavier, la recherche.
      const poserEtDire = (e, faire, dit) => {
        const avant = JSON.stringify(data.timesheets || []);
        if (faire() === false) return;
        s.ptjOuvre = null; s.ptjFocus = e.id; save(); redessin();
        toastUndo(`${e.name}, ${jourDit(iso)} : ${dit}`, () => { data.timesheets = JSON.parse(avant); save(); redessin(); });
      };
      $$('#ptj [data-ptj-plus]').forEach(b => b.onclick = () => {
        const [id, k] = b.dataset.ptjPlus.split(':'), e = employeeById(id); if (!e) return;
        if (s.ptjOuvre && s.ptjOuvre.id === id && s.ptjOuvre.quoi === k) { const i = $(`#ptj [data-ptj-${k === 'retard' ? 'min' : 'hs'}="${CSS.escape(id)}"]`); if (i) i.focus(); return; }
        ouvrirAjout(e, iso, k, redessin);
      });
      $$('#ptj [data-ptj-demi]').forEach(b => b.onclick = () => {
        const [id, k] = b.dataset.ptjDemi.split(':'), e = employeeById(id);
        if (!e || b.getAttribute('aria-pressed') === 'true' || !peutPointerLe(iso)) return;
        poserEtDire(e, () => C.poserPointage(data, e, y, m, d, k), k === 'D' ? 'absent une demi-journée' : 'absent toute la journée');
      });
      const toucheCase = (i, id) => ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); s.ptjOuvre = null; s.ptjFocus = id; redessin(); }
      };
      const nombre = v => Number(String(v).replace(',', '.')) || 0;
      $$('#ptj [data-ptj-min]').forEach(i => {
        i.onkeydown = toucheCase(i, i.dataset.ptjMin);
        i.onchange = () => {
          const e = employeeById(i.dataset.ptjMin); if (!e || !peutPointerLe(iso)) return;
          const min = Math.max(0, Math.min(600, Math.round(nombre(i.value))));
          poserEtDire(e, () => C.poserRetard(data, e, y, m, d, min), min ? `${min} min de retard` : 'retard retiré');
        };
      });
      $$('#ptj [data-ptj-motif]').forEach(i => {
        i.onkeydown = toucheCase(i, i.dataset.ptjMotif);
        i.onchange = () => {
          const e = employeeById(i.dataset.ptjMotif); if (!e || !peutPointerLe(iso)) return;
          const v = String(i.value).replace(/\s+/g, ' ').trim().slice(0, 120);
          poserEtDire(e, () => poserMotifAbsence(e, y, m, d, v), v ? `noté : « ${v} »` : 'la note est retirée');
        };
      });
      $$('#ptj [data-ptj-hs]').forEach(i => {
        i.onkeydown = toucheCase(i, i.dataset.ptjHs);
        i.onchange = () => {
          const e = employeeById(i.dataset.ptjHs); if (!e || !peutPointerLe(iso)) return;
          const x = etatJour(e, iso), majs = C.majorationsHs(C.payrollSettings(data)), maj = x && x.hsj ? x.hsj.majoration : majs[0];
          if (maj == null) return;
          const hh = C.round3(Math.max(0, Math.min(16, nombre(i.value))));
          poserEtDire(e, () => !!C.poserHeuresSupDuJour(data, e, y, m, d, maj, hh), hh ? `${pct(hh)} h sup à +${pct(maj)} %` : 'heures sup du jour retirées');
        };
      });
      $$('#ptj [data-ptj-periode]').forEach(b => b.onclick = () => ptPeriodeFenetre(b.dataset.ptjPeriode, redessin, iso));
      $$('#ptj [data-ptj-arret]').forEach(b => b.onclick = () => {
        const e = employeeById(b.dataset.ptjArret); if (!e) return;
        leaveForm(null, e.id, redessin, iso);
        const k = $('#lf [name=kind]'); if (k) { k.value = 'maladie'; k.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      // Au clavier (la maquette) : ↑ ↓ d'un salarié à l'autre, puis une lettre pose son choix ; R et H ouvrent leur case.
      if ($('#ptj') && !fige) $('#ptj').addEventListener('keydown', ev => {
        const li = ev.target; if (!li.classList || !li.classList.contains('ptj-l')) return;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const R = $$('#ptj .ptj-l[tabindex]').filter(r => !r.closest('[hidden]'));
          const n = R[R.indexOf(li) + (ev.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus();
          return;
        }
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const c = TOUCHE_J[String(ev.key).toLowerCase()], e = c && employeeById(li.dataset.ptjE);
        if (!e) return;
        ev.preventDefault(); s.ptjFocus = e.id; choisirJour(e, iso, c, redessin);
      });
      // À partir de 12 salariés, une recherche (nom, poste) ; une équipe sans personne de trouvé se cache.
      const filtrer = () => {
        const q = String(s.ptjCherche || '').trim().toLowerCase();
        let vus = 0;
        $$('#ptj .ptj-eq').forEach(g => {
          let n = 0;
          $$('.ptj-l', g).forEach(li => { const e = employeeById(li.dataset.ptjE), ok = !q || `${e ? e.name : ''} ${e ? e.position || '' : ''}`.toLowerCase().includes(q); li.hidden = !ok; if (ok) n++; });
          g.hidden = !n; vus += n;
        });
        const r = $('#ptj-rien'); if (r) { r.hidden = !!vus; $('b', r).textContent = String(s.ptjCherche || '').trim(); }
      };
      if ($('#ptj-q-s')) { $('#ptj-q-s').oninput = ev => { s.ptjCherche = ev.target.value; filtrer(); }; filtrer(); }
      if ($('#ptj-tout')) $('#ptj-tout').onclick = () => { s.ptjCherche = ''; $('#ptj-q-s').value = ''; filtrer(); $('#ptj-q-s').focus(); };
      if (s.ptjOuvre && s.ptjOuvre.iso === iso) {
        const i = $(`#ptj [data-ptj-${s.ptjOuvre.quoi === 'retard' ? 'min' : 'hs'}="${CSS.escape(s.ptjOuvre.id)}"]`);
        if (i) { i.focus(); i.select(); }
      } else if (s.ptjFocus) { const r = $(`#ptj [data-ptj-e="${CSS.escape(s.ptjFocus)}"]`); if (r) r.focus({ preventScroll: true }); }
      s.ptjFocus = null;
      $$('#ptj [data-ptj-tel]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.ptjTel); if (e) jourChoixFenetre(e, iso, redessin); });
      // Au téléphone, toute la carte du salarié s'ouvre au doigt (ses choix en grand).
      $$('#ptj .ptj-l').forEach(li => li.addEventListener('click', ev => { if (fige || ev.target.closest('button, input, label') || !window.matchMedia('(max-width: 760px)').matches) return; const e = employeeById(li.dataset.ptjE), x = e && etatJour(e, iso); if (x && !x.j.repos) jourChoixFenetre(e, iso, redessin); }));
      $$('#ptj [data-ptj-repos]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.ptjRepos); if (e) caseFenetre(e, y, m, d, redessin); });
      $$('#ptj [data-ptj-sortie]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.ptjSortie); if (e) heureSortieFenetre(e, iso, redessin); });
      if ($('#ptj-valider')) $('#ptj-valider').onclick = () => {
        const b = $('#ptj-valider');
        if (b.getAttribute('aria-disabled') === 'true') { toast(`${b.title}.`, true); const c = $('#ptj [data-an-sortie], #ptj [data-ptj-sortie]'); if (c) c.focus(); return; }
        if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
        validerJour(iso); save(true); redessin();
        toastUndo(`Journée ${iso === auj ? 'd\'aujourd\'hui' : `du ${jjmm(iso)}`} validée : elle part telle quelle dans le mois`, () => { data.joursValides = joursValides().filter(x => x.iso !== iso || x.rouvertLe); save(true); redessin(); });
      };
      if ($('#ptj-rouvrir')) $('#ptj-rouvrir').onclick = () => {
        if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
        rouvrirJour(iso); save(true); redessin();
        toast(`La journée du ${jjmm(iso)} est rouverte : tu peux la changer, puis la valider à nouveau.`);
      };
    }
    // (1.267.0, morceau B) Un choix d'une ligne se pose d'un clic, sans fenêtre, et se défait d'« Annuler » : « Là » remet le
    // jour à la normale, Absent, Congé, Malade le notent ; le retard et les heures sup s'ouvrent sous la ligne. Un jour de
    // repos garde sa fenêtre (il ne passe que de « Repos » à « Présent »).
    function choisirJour(e, iso, c, apres) {
      const x = etatJour(e, iso); if (!x) return;
      const { y, m, d } = x;
      if (!peutPointerLe(iso)) return;
      if (c === 'retard' || c === 'hs') return ouvrirAjout(e, iso, c, apres);
      if (x.j.repos) return caseFenetre(e, y, m, d, apres);
      const fam = x.j.code === 'D' ? 'A' : x.j.code;
      if (fam === c) return;
      const avant = JSON.stringify(data.timesheets || []);
      if (!C.poserPointage(data, e, y, m, d, c)) return;
      if (c !== 'P') { C.poserRetard(data, e, y, m, d, 0); C.poserHeuresSupDuJour(data, e, y, m, d, 0, 0); }
      if (s.ptjOuvre && s.ptjOuvre.id === e.id) s.ptjOuvre = null;
      s.ptjFocus = e.id;
      save(); apres();
      const dit = { P: 'là, à ses horaires', A: `absent : − ${C.money(x.unJour, company().currency)} sur son brut`, C: 'en congé payé', M: 'malade' }[c] || C.libellePointage(c).toLowerCase();
      toastUndo(`${e.name}, ${jourDit(iso)} : ${dit}`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
    }
    // « + Retard », « + H. sup » : la ligne s'ouvre sur sa case (minutes, heures) ; rien ne s'écrit avant qu'un nombre soit tapé.
    function ouvrirAjout(e, iso, quoi, apres) {
      const x = etatJour(e, iso); if (!x || !peutPointerLe(iso)) return;
      if (x.j.code !== 'P' || x.j.repos) { toast(`${e.name} n'est pas noté « Là » ce jour-là : ${quoi === 'retard' ? 'un retard ne s\'ajoute' : 'des heures sup ne s\'ajoutent'} qu'à une journée de présence.`, true); return; }
      if (quoi === 'hs' && !C.majorationsHs(C.payrollSettings(data)).length) { toast('Pour noter des heures sup, règle d\'abord leur majoration dans « Les horaires » (À VÉRIFIER : le Code du travail et ta convention).', true); return; }
      if (quoi === 'retard' && x.j.retardBadge) { toast(`Le retard de ${e.name} vient de ses badges (arrivée à ${x.b ? x.b.arrivee : '—'}) : il reste noté ; il ne se retient que si ton réglage le dit.`, true); return; }
      s.ptjOuvre = { id: e.id, iso, quoi }; apres();
    }
    // Au téléphone : un nom touché ouvre sa feuille (la maquette, « feuilleTel ») : quatre gros boutons, puis le retard et les
    // heures sup, chacun avec ce qu'il fait sur le bulletin ; un choix se pose et la feuille se ferme, « C'est noté » la ferme.
    function jourChoixFenetre(e, iso, apres) {
      const x = etatJour(e, iso); if (!x) return;
      if (!peutPointerLe(iso)) return;
      const cur = company().currency, st = C.payrollSettings(data), fam = x.j.code === 'D' ? 'A' : x.j.code;
      const reste = (() => { try { return Number(C.leaveBalance(data, e.id, x.y).remaining) || 0; } catch (_) { return null; } })();
      const majs = C.majorationsHs(st);
      const sous = { P: 'à ses horaires', A: `− ${C.money(x.unJour, cur)} sur son brut`, C: reste != null ? `il lui reste ${pct(reste)} j` : 'son salaire ne bouge pas', M: 'certificat plus tard' };
      const q = C.equipeDe(st, e);
      modal(`<div class="ptj-feuille" id="ptjc"><div class="ptj-fq">${avPaie(e)}<div><b>${h(e.name)}</b><small>${h(jourDit(iso))} · ${h(q ? q.nom : (e.position || 'les horaires de l\'entreprise'))}</small></div></div>
        <div class="ptj-gros">${CHOIX_J.map(([c, l]) => `<button type="button" class="ptj-g${fam === c ? ' on' : ''}" data-ptjc="${c}"><b>${l}</b><small>${h(sous[c])}</small></button>`).join('')}</div>
        <div class="ptj-gros ptj-gros2"><button type="button" class="ptj-g${x.j.retard ? ' on' : ''}" data-ptjc="retard"${x.j.code !== 'P' ? ' disabled' : ''}><b>${x.j.retard ? `Retard ${x.j.retard} min` : '+ Retard'}</b><small>${st.retenirRetards ? 'retenu (ton réglage)' : 'noté, pas retenu'}</small></button><button type="button" class="ptj-g${x.hsj ? ' on' : ''}" data-ptjc="hs"${x.j.code !== 'P' ? ' disabled' : ''}><b>${x.hsj ? `${pct(x.hsj.heures)} h sup` : '+ Heures sup'}</b><small>${majs.length ? `à +${pct(x.hsj ? x.hsj.majoration : majs[0])} %` : 'leur majoration se règle d\'abord'}</small></button></div>
        ${fam === 'A' && x.j.source !== 'conge' ? `<label class="field ptj-pourquoi-f">${lbl('Pourquoi ? (facultatif)')}<input type="text" id="ptjc-motif" maxlength="120" value="${h(motifAbsence(e.id, x.y, x.m, x.d))}" placeholder="si tu veux le noter"></label>` : ''}
        <button type="button" class="btn btn-primary ptj-note" data-close>${lfIc('coche', 15, 2.4)} C'est noté</button></div>`, (root, fermer) => {
        $$('[data-ptjc]', root).forEach(b => b.onclick = () => { fermer(); choisirJour(e, iso, b.dataset.ptjc, apres); });
        // (1.271.0) La note de l'absence, au pouce : elle s'écrit en quittant la case, sans rien exiger.
        const mo = $('#ptjc-motif', root);
        if (mo) mo.onchange = () => { if (poserMotifAbsence(e, x.y, x.m, x.d, mo.value)) { save(); if (apres) apres(); } };
      });
    }
    // Une entrée sans sortie, sans horaire d'équipe pour la proposer : l'heure se tape. (plateforme, 03/11/2026, 16 § 10.1
    // point 11) Jamais « sortieFenetre » : ce nom, déclaré ici, cachait la fenêtre du départ dans toute la page Paie.
    function heureSortieFenetre(e, iso, apres) {
      const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
      modal(`<h2>${h(e.name)} · ${h(jourDit(iso))}</h2><p class="sous-f">une entrée badgée, pas de sortie : à quelle heure est-il parti ?</p>
        <form id="sof"><label class="field">${lbl('Sa sortie')}<input type="time" name="h" required></label></form>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="sof-ok">${lfIc('coche', 15, 2.4)} Mettre la sortie</button></div>`, (root, fermer) => {
        $('#sof-ok', root).onclick = () => {
          const v = String(formValues($('#sof', root)).h || '');
          if (!/^\d{2}:\d{2}$/.test(v)) { toast('L\'heure de sortie manque : par exemple 11:00.', true); $('#sof [name=h]', root).focus(); return; }
          if (!peutPointerLe(iso)) return;
          const avant = JSON.stringify(data.timesheets || []);
          if (!C.poserSortie(data, e, y, m, d, v)) return;
          save(); fermer(); apres();
          toastUndo(`${e.name} : sortie du ${jjmm(iso)} mise à ${v}`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
        };
      });
    }
    // « À régler » : TOUT ce qui bloque le mois, au même endroit, chacune avec son bouton — les anomalies de la pointeuse,
    // les journées à la main pas encore validées, les demandes de congé sans réponse. Un compteur et la liste qu'il annonce
    // se calculent avec cette fonction-là.
    function aReglerMois(y, m) {
      const auj = C.today(), ym = ymPt(y, m), premier = `${ym}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1), out = [];
      C.anomaliesPointage(data, y, m, auj).forEach(a => { const html = anomalieLigneHtml(a, y, m); if (html) out.push({ cle: `an:${a.employeeId}:${a.sorte}`, html }); });
      const J = joursNonValides(y, m);
      if (J.length) {
        const der = J[J.length - 1], seul = J.length === 1;
        out.push({ cle: 'jours', html: `<li><span class="pa-av ptj-av-j" aria-hidden="true">${lfIc('echeance', 15)}</span><span class="pt-an-n"><b>${seul ? `La journée ${der === auj ? `d'aujourd'hui, ${h(jourDit(der))},` : `du ${h(jourDit(der))}`} n'est pas encore validée` : `${J.length} journées pas encore validées : ${h(J.length > 6 ? `${J.slice(0, 5).map(jjmm).join(', ')}…` : J.map(jjmm).join(', ').replace(/, ([^,]*)$/, ' et $1'))}`}</b><small>ceux qui pointent à la main : le soir, on relit la journée et on la valide</small></span><span class="pa-dem-g"><button type="button" class="btn btn-sm" data-pt-ouvrir-j="${der}">Ouvrir la journée${seul ? '' : ` du ${jjmm(der)}`}</button>${seul ? '' : '<button type="button" class="btn btn-sm" id="pt-jav">Les relire et les valider…</button>'}</span></li>` });
      }
      const D = (data.leaves || []).filter(l => l.statut === 'demande' && l.from <= dernier && l.to >= premier);
      if (D.length) out.push({ cle: 'demandes', html: `<li><span class="pa-av ptj-av-j" aria-hidden="true">${lfIc('message', 15)}</span><span class="pt-an-n"><b>${pl(D.length, 'demande')} de congé sans réponse</b><small>${h(D.map(l => `${String((employeeById(l.employeeId) || {}).name || '').split(' ')[0]}, du ${jjmm(l.from)} au ${jjmm(l.to)}`).slice(0, 3).join(' ; '))}${D.length > 3 ? '…' : ''} : ta réponse pose le congé (ou pas) sur le pointage</small></span><button type="button" class="btn btn-sm" data-pt-conges>Y répondre</button></li>` });
      return out;
    }
    // Le chiffre de l'onglet « Le mois » suit la liste à chaque dessin (un compteur et la liste qu'il annonce disent le même chiffre).
    function majNbSous() {
      const b = $('#p-sous [data-sous="pointage"]'); if (!b) return;
      const n = ptVerrouille(ymPt(s.ptY, s.ptM)) ? 0 : aReglerMois(Number(s.ptY), Number(s.ptM)).length;
      let x = b.querySelector('.pm-nb');
      if (!n) { if (x) x.remove(); return; }
      if (!x) { x = document.createElement('span'); x.className = 'pm-nb'; b.appendChild(x); }
      x.textContent = String(n); x.title = `${pl(n, 'chose')} à régler`;
    }
    function lierARegler(y, m, apres) {
      $$('#p-body [data-pt-ouvrir-j]').forEach(b => b.onclick = () => { s.ptJourIso = b.dataset.ptOuvrirJ; allerVue('pt-jour'); });
      if ($('#pt-jav')) $('#pt-jav').onclick = () => joursAValiderFenetre(y, m, apres);
      $$('#p-body [data-pt-conges]').forEach(b => b.onclick = () => allerVue('conges'));
    }
    // (1.259.0) LA PREMIÈRE FOIS : le pointage se règle en 4 questions (comment l'équipe pointe, les jours de travail, les
    // retards, la nuit), une seule fois ; tout se change ensuite dans « Les horaires ». Rien n'est écrit avant « C'est réglé »,
    // et tout se défait d'un geste. Les valeurs proposées sont celles qui ne font rien (aucune plage de nuit inventée).
    function premiereFenetre(apres) {
      if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
      const st = C.payrollSettings(data), Q = st.equipes || [];
      const r = {
        pointe: !Q.length ? 'main' : Q.every(q => q.pointe === 'pointeuse') ? 'pointeuse' : Q.every(q => q.pointe !== 'pointeuse') ? 'main' : 'deux',
        jours: [1, 2, 3, 4, 5, 6, 0].filter(i => !(Array.isArray(st.offDays) ? st.offDays : [0]).includes(i)),
        retards: st.retenirRetards ? 'retenir' : 'noter', nuit: st.nuitDebut && st.nuitFin ? 'oui' : 'non', nuitDebut: st.nuitDebut || '', nuitFin: st.nuitFin || ''
      };
      let q = 0;
      const T = ['Comment ton équipe pointe ?', 'Tes jours de travail et tes équipes', 'Les retards', 'Le travail de nuit'];
      const R = (cle, L) => `<div class="pa-choix pc-choix">${L.map(([v, b, sm]) => `<label class="pa-choix-l"><input type="radio" name="${cle}" value="${v}" ${r[cle] === v ? 'checked' : ''}> <span><b>${b}</b><small>${sm}</small></span></label>`).join('')}</div>`;
      const corps = () => q === 0 ? R('pointe', [['main', 'À la main, le soir', 'tu notes ce qui change, chaque soir ; personne n\'a de badge'], ['pointeuse', 'À la pointeuse', 'tu importes son fichier ; tu règles ce qui manque'], ['deux', 'Les deux, selon l\'équipe', 'par exemple le fournil à la pointeuse, la boutique à la main : chaque équipe le dit dans « Les horaires »']])
        : q === 1 ? `<fieldset class="pt-h-jours"><legend>Les jours de travail de l'entreprise <span class="muted small">(les autres sont des jours de repos)</span></legend><div class="pt-h-js">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button type="button" class="pt-h-j" data-pqj="${i}" aria-pressed="${r.jours.includes(i)}">${capi(JOURS_SEM[i])}</button>`).join('')}</div></fieldset>
            <div class="ptj-eqs">${Q.map(x => `<div class="ptj-eqc"><b>${h(x.nom || 'Équipe')}</b><span class="mono">${x.debut && x.fin ? `${h(x.debut)} – ${h(x.fin)}` : '—'}</span><span class="mu">${h(joursDit(x.jours))} · ${x.pointe === 'pointeuse' ? 'la pointeuse' : 'à la main'}</span></div>`).join('') || '<p class="small muted">Une seule équipe pour l\'instant : tout le monde suit les jours de l\'entreprise. Des horaires différents (le fournil la nuit, la boutique le matin) ? Les équipes se créent dans « Les horaires », juste après.</p>'}</div>`
          : q === 2 ? R('retards', [['noter', 'Ils se notent, rien ne se retient', 'le plus courant ; tu en parles avec le salarié'], ['retenir', 'Ils se retiennent sur le salaire', 'au prix d\'une heure de sa fiche · À VÉRIFIER : ce qui peut se retenir, avec ton comptable']])
            : `${R('nuit', [['non', 'Personne ne travaille la nuit', 'rien ne se compte'], ['oui', 'Oui, la nuit se compte', 'sa plage ci-dessous ; sa majoration se règle ensuite dans « Les horaires » (À VÉRIFIER : la plage légale, la majoration)']])}
              <div class="grid-2" id="pq-nuit"${r.nuit === 'oui' ? '' : ' hidden'}><label class="field">${lbl('La nuit commence à')}<input type="time" name="nuitDebut" value="${h(r.nuitDebut)}"></label><label class="field">${lbl('Elle finit à')}<small class="muted">le lendemain matin si elle passe minuit</small><input type="time" name="nuitFin" value="${h(r.nuitFin)}"></label></div>`;
      modal(`<h2>Régler le pointage</h2><p class="sous-f">4 questions, une seule fois ; tout se change ensuite dans « Les horaires »</p>
        <ol class="ptj-et" id="pq-et"></ol><div class="ptj-qc" id="pq-c"></div>
        <div class="modal-actions"><button type="button" class="btn" id="pq-ret">Retour</button><button type="button" class="btn btn-primary" id="pq-ok"></button></div>`, (root, fermer) => {
        const lireEtape = () => {
          const v = formValues($('#pq-f', root) || document.createElement('form'));
          if (q === 0 && v.pointe) r.pointe = v.pointe;
          if (q === 2 && v.retards) r.retards = v.retards;
          if (q === 3) { if (v.nuit) r.nuit = v.nuit; r.nuitDebut = String(v.nuitDebut || '').trim(); r.nuitFin = String(v.nuitFin || '').trim(); }
        };
        const dessiner = () => {
          $('#pq-et', root).innerHTML = T.map((t, i) => `<li class="${i < q ? 'fait' : i === q ? 'ici' : ''}"${i === q ? ' aria-current="step"' : ''}><span>${i < q ? lfIc('coche', 12, 3) : i + 1}</span><b>${t}</b></li>`).join('');
          $('#pq-c', root).innerHTML = `<span class="pq-sur">Question ${q + 1} sur 4</span><h3>${T[q]}</h3><form id="pq-f">${corps()}</form>`;
          $('#pq-ret', root).disabled = q === 0;
          $('#pq-ok', root).innerHTML = q === 3 ? `${lfIc('coche', 15, 2.4)} C'est réglé : ouvrir la journée` : 'Suivant';
          $$('[data-pqj]', root).forEach(b => b.onclick = () => { const i = Number(b.dataset.pqj); r.jours = r.jours.includes(i) ? r.jours.filter(x => x !== i) : r.jours.concat([i]); b.setAttribute('aria-pressed', String(r.jours.includes(i))); });
          $('#pq-f', root).onchange = () => { lireEtape(); if ($('#pq-nuit', root)) $('#pq-nuit', root).hidden = r.nuit !== 'oui'; };
        };
        $('#pq-ret', root).onclick = () => { lireEtape(); if (q > 0) { q--; dessiner(); } };
        $('#pq-ok', root).onclick = () => {
          lireEtape();
          if (q === 1 && !r.jours.length) { toast('Choisis au moins un jour de travail.', true); return; }
          if (q < 3) { q++; dessiner(); return; }
          if (r.nuit === 'oui' && !(r.nuitDebut && r.nuitFin)) { toast('La plage de nuit va par deux : son début et sa fin.', true); const c = $(`#pq-f [name=${r.nuitDebut ? 'nuitFin' : 'nuitDebut'}]`, root); if (c) c.focus(); return; }
          const avant = { ps: deepCopy(data.payrollSettings || {}), eq: data.employees.map(e => [e.id, e.equipeId]) };
          const ps = data.payrollSettings = data.payrollSettings || {};
          ps.offDays = [0, 1, 2, 3, 4, 5, 6].filter(i => !r.jours.includes(i));
          ps.retenirRetards = r.retards === 'retenir';
          ps.nuitDebut = r.nuit === 'oui' ? r.nuitDebut : ''; ps.nuitFin = r.nuit === 'oui' ? r.nuitFin : '';
          if (r.pointe !== 'deux') {
            let L = Array.isArray(ps.equipes) ? ps.equipes : [];
            if (!L.length && r.pointe === 'pointeuse') {
              const nq = { id: C.uid(), nom: 'Toute l\'entreprise', debut: '', fin: '', jours: r.jours.slice(), pointe: 'pointeuse', minimum: 0 };
              L = [nq];
              data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today()) && !e.equipeId).forEach(e => { e.equipeId = nq.id; });
            } else L = L.map(x => ({ ...x, pointe: r.pointe }));
            ps.equipes = L;
          }
          ps.pointageRegle = C.today();
          save(true); fermer();
          s.ptJourIso = '';
          if (s.tab === 'pt-jour') apres(); else allerVue('pt-jour');
          toastUndo('Le pointage est réglé : tout se change ensuite dans « Les horaires »', () => {
            data.payrollSettings = avant.ps;
            avant.eq.forEach(([id, x]) => { const e = employeeById(id); if (e) { if (x) e.equipeId = x; else delete e.equipeId; } });
            save(true); draw();
          });
        };
        dessiner();
      });
    }
    // (1.259.0) « Une absence sur plusieurs jours » (la maquette) : un congé, une maladie, des jours d'absence, pour un ou
    // plusieurs salariés d'un coup, jours à venir compris ; ce que chacun en aura sur son bulletin se lit avant de noter
    // (le solde de congé, ce que coûte un jour sans solde, le minimum d'une équipe). Les jours de repos restent du repos.
    // (1.330.0) Le jour proposé quand on note depuis un mois : aujourd'hui dans le mois en cours, sinon son 1er (joué à la
    // souris : ouverte depuis octobre, la fenêtre proposait le 09/11, et l'absence d'octobre partait en novembre).
    const jourDuMoisRegarde = (y, m) => { const auj = C.today(), ym = ymPt(y, m); return auj.slice(0, 7) === ym ? auj : `${ym}-01`; };
    function ptPeriodeFenetre(employeeId, apres, du0) {
      const emps = data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today())).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      if (!emps.length) return;
      const choisis = new Set(employeeId ? [employeeId] : emps.length === 1 ? [emps[0].id] : []);
      const CODES_P = [['C', 'Congé', 'payé, sur son solde'], ['A', 'Absent', 'sans solde'], ['M', 'Malade', 'certificat à joindre'], ['D', 'Demi-journées', 'la moitié, sans solde']];
      const cur = company().currency;
      modal(`<h2>Une absence sur plusieurs jours</h2><p class="sous-f">un congé, une maladie, des jours d'absence : pour un ou plusieurs salariés, d'un coup, jours à venir compris ; les jours de repos restent du repos</p>
        <div class="ptj-qui" id="pp-qui" role="group" aria-label="Qui"><span class="mu">Qui</span>${emps.map(e => `<button type="button" class="ptj-pq" data-pp-e="${h(e.id)}" aria-pressed="${choisis.has(e.id)}">${avPaie(e)}${h(String(e.name || '').split(' ')[0])}</button>`).join('')}</div>
        <form id="pp" class="grid-2"><div class="span-2 ptj-grands" role="radiogroup" aria-label="Ce qui se note">${CODES_P.map(([c, l, d]) => `<label class="ptj-g"><input type="radio" name="code" value="${c}" ${c === 'C' ? 'checked' : ''}><b>${l}</b><small>${d}</small></label>`).join('')}</div>
          ${dateFieldHtml(lbl('Du'), 'du', du0 || C.today(), {})}
          ${dateFieldHtml(lbl('Au'), 'au', du0 || C.today(), {})}
        </form>
        <div class="ptj-res" id="pp-dit" role="status" aria-live="polite"></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="pp-ok">${lfIc('coche', 15, 2.4)} <span>Noter</span></button></div>`, (root, fermer) => {
        const joursDe = (e, v) => {
          const L = [];
          if (!v.du || !v.au || v.au < v.du) return L;
          for (let iso = v.du; iso <= v.au && L.length < 400; iso = C.addDays(iso, 1)) {
            const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
            const j = C.pointageDuMois(data, e, y, m).jours[d - 1];
            if (j && j.code !== '-' && !j.repos) L.push({ iso, y, m, d });
          }
          return L;
        };
        const lire = () => { const v = formValues($('#pp', root)); return { v, E: emps.filter(e => choisis.has(e.id)) }; };
        const dire = () => {
          const { v, E } = lire(), code = v.code || 'C';
          if (!v.du || !v.au || v.au < v.du) { $('#pp-dit', root).innerHTML = '<span class="warn-text">La date de fin vient avant la date de début.</span>'; $('#pp-ok', root).disabled = true; return; }
          if (!E.length) { $('#pp-dit', root).innerHTML = '<span class="mu">Choisis qui, ci-dessus : un ou plusieurs salariés.</span>'; $('#pp-ok', root).disabled = true; return; }
          let total = 0;
          $('#pp-dit', root).innerHTML = E.map(e => {
            const L = joursDe(e, v), n = L.length; total += n;
            const y = Number(v.du.slice(0, 4)), m = Number(v.du.slice(5, 7)), un = C.round3((C.brutDuMois(e, y, m) || Number(e.grossSalary) || 0) / (Number(C.payrollSettings(data).workedDays) || 26));
            const reste = (() => { try { return Number(C.leaveBalance(data, e.id, y).remaining) || 0; } catch (_) { return null; } })();
            const effet = code === 'C' ? `son salaire ne bouge pas${reste != null ? ` · il lui reste ${pct(reste)} jour${reste > 1 ? 's' : ''} ; après, ${pct(Math.max(0, C.round3(reste - n)))}` : ''}${reste != null && reste < n ? ' — son solde ne couvre pas tout (À VÉRIFIER : le reste, sans solde)' : ''}`
              : code === 'A' ? `− ${C.money(C.round3(un * n), cur)} sur son brut` : code === 'D' ? `− ${C.money(C.round3(un * n / 2), cur)} sur son brut` : 'un certificat à joindre ; la CNAM indemnise (À VÉRIFIER)';
            const mq = n ? manqueEquipe(e.id, L[0].iso, L[n - 1].iso) : null;
            return `<div><b>${h(String(e.name || '').split(' ')[0])} · ${h(C.libellePointage(code).toLowerCase())} ${v.du === v.au ? `le ${h(jjmm(v.du))}` : `du ${h(jjmm(v.du))} au ${h(jjmm(v.au))}`} : ${n ? pl(n, 'jour') : 'aucun jour de travail'}</b><span>${n ? h(effet) : 'que des jours de repos ou hors contrat'}${mq ? ` · <span class="warn-text">${h(manqueDit(mq))}</span>` : ''}</span></div>`;
          }).join('');
          $('#pp-ok', root).disabled = !total;
          $('#pp-ok span', root).textContent = total ? `Noter ${total > 1 ? `les ${total} jours` : 'le jour'}` : 'Noter';
        };
        $$('[data-pp-e]', root).forEach(b => b.onclick = () => { const id = b.dataset.ppE; if (choisis.has(id)) choisis.delete(id); else choisis.add(id); b.setAttribute('aria-pressed', String(choisis.has(id))); dire(); });
        $('#pp', root).onchange = dire; $('#pp', root).oninput = dire; dire();
        $('#pp-ok', root).onclick = () => {
          const { v, E } = lire(), code = v.code || 'C';
          if (!E.length || !peutPointerLe(v.au)) return;
          const tous = E.map(e => ({ e, L: joursDe(e, v) })).filter(x => x.L.length);
          if (refusJoursValides(tous.flatMap(x => x.L.map(j => j.iso)))) return;
          const avant = JSON.stringify(data.timesheets || []);
          let n = 0;
          tous.forEach(({ e, L }) => L.forEach(j => { if (C.poserPointage(data, e, j.y, j.m, j.d, code)) { n++; C.poserHeuresSupDuJour(data, e, j.y, j.m, j.d, 0, 0); } }));
          if (!n) return;
          save(); fermer(); apres();
          toastUndo(`${tous.map(x => String(x.e.name || '').split(' ')[0]).join(', ')} : ${pl(n, 'jour')} « ${C.libellePointage(code).toLowerCase()} »`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
        };
      });
    }
    // Le bouton qui valide le mois (1.259.0, une seule règle) : avant sa dernière journée, il attend ; tant que « À régler »
    // n'est pas vide, il dit combien de choses restent ; sinon il est le bouton principal.
    function ptValiderBoutonHtml(y, m) {
      const mois = MONTHS_LONG[m - 1], v = versionsPt(ymPt(y, m)).length, fin = isoDe(y, m, C.daysInMonth(y, m));
      if (fin > C.today()) return `<button type="button" class="btn btn-sm" id="pt-valider" aria-disabled="true" data-pas-fini="1" title="Ses journées jusqu'au ${jjmm(fin)} restent à vivre">${lfIc('cadenas', 14)} Valider le mois le ${Number(fin.slice(8, 10))}, après sa dernière journée</button>`;
      const n = aReglerMois(y, m).length;
      if (n) return `<button type="button" class="btn btn-sm" id="pt-valider" aria-disabled="true" title="Règle d'abord ${n > 1 ? `les ${n} choses` : 'la chose'} de « À régler »">${lfIc('cadenas', 14)} Régler ${n > 1 ? `les ${n} choses` : 'la dernière chose'}, puis valider le mois</button>`;
      const env = modeDuMois(y, m) === 'tenue' ? ' et l\'envoyer au cabinet' : '';
      return `<button type="button" class="btn btn-sm btn-primary" id="pt-valider">${lfIc(env ? 'envoi' : 'coche', 14, 2.4)} ${v ? `Valider la version ${v + 1}${env}` : `Valider le pointage ${h(deMois(mois))}${env}`}</button>`;
    }
    function ptValideHtml(y, m) {
      const ym = ymPt(y, m), V = versionsPt(ym); if (!V.length) return '';
      const v = V[V.length - 1], ouvert = !ptVerrouille(ym), mois = MONTHS_LONG[m - 1], cab = sansCabinetRelie() ? '' : 'Ton cabinet';
      const quand = `le ${C.fmtDate(C.jourDeLInstant(v.le)).slice(0, 5)} à ${new Date(v.le).toTimeString().slice(0, 5).replace(':', ' h ')}`;
      return ouvert
        ? `<div class="bandeau ambre pa-bandeau" id="pt-valide">${lfIc('ecriture', 18)}<span class="txt"><b>Correction en cours : la version ${V.length + 1} du pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)}</b><span>La version ${V.length} (validée ${quand}) reste gardée ; valide à nouveau quand c'est fait : SkanFact dira ce qui a changé.</span></span><button type="button" class="btn btn-sm" id="pt-voir-v">Voir la version ${V.length}</button></div>`
        : `<div class="bandeau info pa-bandeau" id="pt-valide">${lfIc('cadenas', 18)}<span class="txt"><b>Validé ${quand} : le pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)} est verrouillé</b><span>Version ${V.length}${v.note ? `, ${h(v.note)}` : ''}.${cab ? ` ${h(cab)} le lit tel quel.` : ''} Une correction fait une version ${V.length + 1}, avec ce qui a changé.</span></span><span class="pa-bandeau-g"><button type="button" class="btn btn-sm" id="pt-voir-v">Voir la version validée</button><button type="button" class="btn btn-sm" id="pt-corriger">${lfIc('ecriture', 14)} Corriger : une nouvelle version</button></span></div>`;
    }
    const diffPt = (a, b) => {
      const L = [];
      Object.keys({ ...a, ...b }).forEach(id => {
        const x = a[id], y2 = b[id]; if (!x || !y2) { L.push(`${(x || y2).nom} : ${x ? 'retiré' : 'ajouté'}`); return; }
        if (x.payes !== y2.payes) L.push(`${x.nom} : ${pct(x.payes)} → ${pct(y2.payes)} jours payés`);
        const hx = x.hs.reduce((s2, [, v2]) => s2 + v2, 0), hy = y2.hs.reduce((s2, [, v2]) => s2 + v2, 0);
        if (hx !== hy) L.push(`${x.nom} : ${pct(hx)} → ${pct(hy)} h sup`);
        if (x.conges !== y2.conges) L.push(`${x.nom} : ${x.conges} → ${y2.conges} jours de congé`);
      });
      return L;
    };
    function versionPtFenetre(y, m) {
      const V = versionsPt(ymPt(y, m)), v = V[V.length - 1]; if (!v) return;
      const maint = instantPt(y, m), d = diffPt(v.instant, maint), avant = V.length > 1 ? diffPt(V[V.length - 2].instant, v.instant) : [];
      modal(`<h2>Le pointage ${/^[aeiouyéè]/i.test(MONTHS_LONG[m - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[m - 1])} · version ${V.length}</h2>
        <p class="sous-f">validée le ${h(C.fmtDate(C.jourDeLInstant(v.le)))}${v.par ? ` par ${h(v.par)}` : ''} : ce que chaque bulletin en reprend</p>
        <table class="mini lu"><thead><tr><th>Salarié</th><th class="r">Payés</th><th class="r">H. sup</th><th class="r">Sans solde</th><th class="r">Retards</th></tr></thead><tbody>
          ${Object.values(v.instant).map(x => `<tr><td>${h(x.nom)}</td><td class="r">${pct(x.payes)} j</td><td class="r">${x.hs.length ? x.hs.map(([k, h2]) => `${pct(h2)} h (+${pct(k)} %)`).join(', ') : '—'}</td><td class="r">${x.absences ? `${pct(x.absences)} j` : '—'}</td><td class="r">${x.retards || '—'}</td></tr>`).join('')}</tbody></table>
        ${avant.length ? `<p class="small"><b>Ce qui a changé depuis la version ${V.length - 1}</b> : ${avant.map(h).join(' ; ')}.</p>` : ''}
        ${d.length ? `<p class="small warn-text"><b>Depuis cette version</b> : ${d.map(h).join(' ; ')}.</p>` : '<p class="small muted">Rien n\'a changé depuis.</p>'}
        <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Fermer</button></div>`);
    }
    function lierValide(y, m, apres) {
      const ym = ymPt(y, m), mois = MONTHS_LONG[m - 1];
      if ($('#pt-voir-v')) $('#pt-voir-v').onclick = () => versionPtFenetre(y, m);
      if ($('#pt-corriger')) $('#pt-corriger').onclick = () => {
        if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
        data.pointageOuverts = [...new Set([...(data.pointageOuverts || []), ym])]; save(true); apres();
        toastUndo(`Le pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${mois} est rouvert : la version ${versionsPt(ym).length + 1} se prépare`, () => { data.pointageOuverts = (data.pointageOuverts || []).filter(x => x !== ym); save(true); apres(); });
      };
      if ($('#pt-valider')) $('#pt-valider').onclick = () => {
        const fin = isoDe(y, m, C.daysInMonth(y, m));
        if ($('#pt-valider').dataset.pasFini) { toast(`Le mois n'est pas fini : ses journées jusqu'au ${jjmm(fin)} restent à vivre. Il se valide après la dernière.`, true); return; }
        const aR = aReglerMois(y, m);
        if (aR.length) { toast(`Règle d'abord ${aR.length > 1 ? `les ${aR.length} choses` : 'la chose'} de « À régler » : chacune a son bouton.`, true); const c = $('#pt-aregler'); if (c) { c.scrollIntoView({ block: 'center' }); const b = c.querySelector('button'); if (b) b.focus(); } return; }
        if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
        const V = versionsPt(ym), inst = instantPt(y, m);
        if (V.length && !diffPt(V[V.length - 1].instant, inst).length) { toast('Rien n\'a changé depuis la version validée : elle reste telle quelle.', true); return; }
        const avant = { v: JSON.stringify(data.pointageVersions || []), o: JSON.stringify(data.pointageOuverts || []) };
        const reglees = (data.badgeImports || []).length ? 'avec ses anomalies réglées' : '';
        data.pointageVersions = (data.pointageVersions || []).concat([{ id: C.uid(), ym, le: new Date().toISOString(), note: reglees, instant: inst }]);
        data.pointageOuverts = (data.pointageOuverts || []).filter(x => x !== ym);
        save(true); apres();
        toastUndo(`Pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${mois} validé : version ${V.length + 1}, verrouillé${modeDuMois(y, m) === 'tenue' ? ' ; ton cabinet le reçoit et prépare les bulletins' : ''}`, () => { data.pointageVersions = JSON.parse(avant.v); data.pointageOuverts = JSON.parse(avant.o); save(true); apres(); });
      };
    }
    // (maquette E20) Les totaux du mois, ce que les bulletins reprendront ; et les compteurs, pour ne pas découvrir un
    // dépassement en fin d'année. Rien n'est inventé : un plafond vide se dit vide.
    function ptTotauxHtml(y, m, seulCompteurs) {
      const inst = instantPt(y, m), st = C.payrollSettings(data), majs = C.majorationsHs(st), L = Object.entries(inst);
      if (!L.length) return '';
      const presents = id => { const e = employeeById(id); return e ? C.pointageDuMois(data, e, y, m).jours.filter(j => !j.repos && (j.code === 'P' || j.code === 'D')).length : 0; };
      const aSavoir = (id, x) => [x.retards ? `${pl(x.retards, 'retard')}${x.minRetard ? ` (${x.minRetard} min en tout)` : ''}` : '', x.conges ? `${pl(x.conges, 'jour')} de congé` : '', x.maladie ? `${pl(x.maladie, 'jour')} de maladie` : '',
        (() => { const e = employeeById(id); const t = e && C.pointageEnregistre(data, e.id, y, m); const n = t && t.badges ? Object.values(t.badges).filter(b => b.sortieMain).length : 0; return n ? `${pl(n, 'sortie posée', 'sorties posées')} à la main` : ''; })()].filter(Boolean).join(' · ');
      const anHs = id => { const e = employeeById(id); if (!e) return 0; let t = 0; for (let k = 1; k <= m; k++) t += C.heuresSupDuMois(data, e, y, k).reduce((a, b) => a + b.heures, 0); return C.round3(t); };
      const plafond = Number(st.hsPlafondAn) || 0;
      const topHs = L.map(([id, x]) => [x.nom, anHs(id)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const nbRetards = L.reduce((a, [, x]) => a + x.retards, 0);
      const nuit = L.reduce((a, [id]) => { const e = employeeById(id); if (!e) return a; const n = C.heuresDeNuitDuMois(data, e, y, m); return { reglee: n.reglee, minutes: a.minutes + n.minutes }; }, { reglee: false, minutes: 0 });
      return `${seulCompteurs ? '' : `<section class="pa-carte" id="pt-totaux"><div class="pa-carte-t"><b>Les totaux ${/^[aeiouyéè]/i.test(MONTHS_LONG[m - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[m - 1])}</b><span class="mu">ce que les bulletins reprendront</span></div>
        <div class="scroll-x"><table class="list compact pa-liste pt-tot-t"><thead><tr><th>Salarié</th><th class="r">Présent</th><th class="r">Payés</th>${majs.map(x => `<th class="r">H. sup +${pct(x)} %</th>`).join('')}<th class="r">Sans solde</th><th class="r">Retards</th><th>À savoir</th></tr></thead><tbody>
          ${L.map(([id, x]) => `<tr><td class="nw"><span class="pa-av" style="--c:${h(C.couleurDe(x.nom || ''))}" aria-hidden="true">${h(C.initialesDe(x.nom || ''))}</span> <b>${h(x.nom)}</b></td><td class="r">${presents(id)} j</td><td class="r">${pct(x.payes)} j</td>${majs.map(k => { const f = x.hs.find(([a]) => a === k); return `<td class="r">${f ? `${pct(f[1])} h` : '—'}</td>`; }).join('')}<td class="r">${x.absences ? `${pct(x.absences)} j` : '—'}</td><td class="r">${x.retards || '—'}</td><td class="small muted">${h(aSavoir(id, x)) || '—'}</td></tr>`).join('')}
        </tbody></table></div></section>`}
        <section class="pa-carte" id="pt-compteurs"><div class="pa-carte-t"><b>Les compteurs</b><span class="mu">pour ne pas découvrir un dépassement en fin d'année</span></div>
          <div class="pt-cpt-c"><table class="mini pt-cpt"><tbody>
            <tr><td>Heures sup de ${y}${topHs.length ? `, ${h(topHs[0][0])}` : ''}</td><td class="r">${topHs.length ? `${pct(topHs[0][1])} h` : '0'} <small>${plafond ? `plafond réglé : ${pct(plafond)} h par an${topHs.length && topHs[0][1] > plafond ? ' — dépassé' : ''}` : 'aucun plafond réglé (À VÉRIFIER : le Code du travail)'}</small></td></tr>
            <tr><td>Retards du mois</td><td class="r">${nbRetards} <small>${st.retenirRetards ? 'retenus sur le salaire (ton réglage)' : 'aucun n\'est retenu sur le salaire (À VÉRIFIER : ce qui peut l\'être)'}</small></td></tr>
            <tr><td>Heures de nuit du mois</td><td class="r">${nuit.reglee ? `${pct(C.round3(nuit.minutes / 60))} h <small>de ${h(st.nuitDebut)} à ${h(st.nuitFin)}${Number(st.nuitMajoration) > 0 ? `, majorées de ${pct(st.nuitMajoration)} % sur le bulletin` : ', comptées, sans majoration réglée'}</small>` : `— <small>leur plage n'est pas réglée (Les horaires) ; elle et la majoration : À VÉRIFIER</small>`}</td></tr>
          </tbody></table></div></section>`;
    }
    // (1.257.0) LA POINTEUSE (maquette O06 et E17). Le fichier de badges se lit chez toi (rien ne part ailleurs) ; ce qu'il
    // donnerait se dit avant d'importer : les badges lus, rattachés à une fiche par leur n°, déjà importés (ignorés), les
    // badges qu'aucune fiche ne porte, et les anomalies. Un import se défait d'un geste ; il ne touche jamais une case
    // pointée à la main.
    const aLaPointeuse = () => (C.payrollSettings(data).equipes || []).filter(q => q.pointe === 'pointeuse');
    function dernierImport() { return (data.badgeImports || []).slice(-1)[0] || null; }
    function importBadgesFenetre(apres) {
      if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return; }
      const Q = aLaPointeuse(), sansBadge = data.employees.filter(e => e.active !== false && Q.some(q => q.id === e.equipeId) && !String(e.badge || '').trim());
      let lu = null, fichier = '';
      modal(`<h2>Importer la pointeuse</h2>
        <div class="grid-2 ib-g">
          <label class="field">${lbl('Le fichier')}<small class="muted ib-aide">export de la pointeuse (texte ou tableur)</small><input type="file" id="ib-f" accept=".txt,.csv,.dat,.tsv,text/plain,text/csv"></label>
          <label class="field">${lbl('Période')}<small class="muted ib-aide">lue dans le fichier</small><input type="text" id="ib-per" readonly tabindex="-1" placeholder="—"></label>
        </div>
        <table class="mini lu ib-t" id="ib-t"><tbody><tr><td colspan="2" class="muted">Choisis le fichier : SkanFact dit ce qu'il contient avant d'importer.</td></tr></tbody></table>
        ${sansBadge.length ? `<p class="small warn-text">${sansBadge.map(e => h(e.name)).join(', ')} ${sansBadge.length > 1 ? 'n\'ont' : 'n\'a'} pas de n° de badge sur ${sansBadge.length > 1 ? 'leur' : 'sa'} fiche : leurs passages ne se rattacheront à personne.</p>` : ''}
        <p class="regle small">${lfIc('aide', 13, 2)} Un badge n'écrase jamais une case que tu as changée à la main : la case garde ta main, et le badge se montre à côté. Un import se défait d'un geste.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="ib-ok" disabled>${lfIc('coche', 15, 2.4)} <span>Importer</span></button></div>`, (root, fermer) => {
        const montrer = () => {
          const r = C.importerBadges(data, lu.passages, false);
          const copie = { ...data, timesheets: deepCopy(data.timesheets || []) };
          C.importerBadges(copie, lu.passages, true);
          const mois = new Set(lu.passages.map(p => p.iso.slice(0, 7)));
          const an = [...mois].flatMap(ym => C.anomaliesPointage(copie, Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), C.today()));
          const sorties = an.filter(a => a.sorte === 'sortie').length, sans = an.filter(a => a.sorte === 'sansBadge').reduce((x, a) => x + a.jours.length, 0);
          $('#ib-per', root).value = r.du ? `du ${C.fmtDate(r.du).slice(0, 5)} au ${C.fmtDate(r.au).slice(0, 5)}` : '—';
          $('#ib-t', root).innerHTML = `<tbody>
            <tr><td>Badges lus</td><td class="num">${lu.passages.length}${lu.illisibles ? ` <small class="warn-text">${pl(lu.illisibles, 'ligne illisible', 'lignes illisibles')}</small>` : ''}</td></tr>
            <tr><td>Rattachés à un salarié<small>par le n° de badge de sa fiche</small></td><td class="num">${r.rattaches}</td></tr>
            <tr><td>Déjà importés${dernierImport() ? `<small>le ${h(C.fmtDate(C.jourDeLInstant(dernierImport().le)))}</small>` : ''}, ignorés</td><td class="num">${r.deja}</td></tr>
            ${r.inconnus.length ? `<tr><td>Badges qu'aucune fiche ne porte<small>pose leur n° sur la fiche du salarié, puis importe à nouveau</small></td><td class="num warn-text">${h(r.inconnus.join(', '))}</td></tr>` : ''}
            <tr><td>Anomalies</td><td class="num"><b>${an.length}</b> <small>${[sorties ? pl(sorties, 'sortie manquante', 'sorties manquantes') : '', sans ? pl(sans, 'jour sans badge', 'jours sans badge') : ''].filter(Boolean).join(' · ') || 'aucune'}</small></td></tr></tbody>`;
          const neuf = r.rattaches - r.deja;
          $('#ib-ok', root).disabled = !(neuf > 0);
          $('#ib-ok span', root).textContent = neuf > 0 ? `Importer les ${neuf} badge${neuf > 1 ? 's' : ''}` : 'Rien de neuf à importer';
          return r;
        };
        $('#ib-f', root).onchange = async ev => {
          const f = ev.target.files && ev.target.files[0]; if (!f) return;
          if (f.size > 5 * 1024 * 1024) { toast('Ce fichier dépasse 5 Mo : est-ce bien l\'export de la pointeuse ?', true); return; }
          fichier = f.name; lu = C.lireBadges(await f.text());
          if (!lu.passages.length) { $('#ib-t', root).innerHTML = `<tbody><tr><td colspan="2" class="warn-text">Aucun passage lu dans ce fichier : une ligne s'écrit « badge ; date ; heure » (par exemple « 1001;19/10/2026;03:02 »).</td></tr></tbody>`; $('#ib-ok', root).disabled = true; return; }
          montrer();
        };
        $('#ib-ok', root).onclick = () => {
          if (!lu) return;
          // (16 § 10.1, point 7) Des badges neufs dans une période clôturée : le refus se dit avant le geste, pas à l'envoi.
          const clos = C.importerBadges(data, lu.passages.filter(p => C.isClosedDate(data, p.iso)), false);
          if (clos.rattaches - clos.deja > 0 && closedBlock(clos.du, 'Cet import de badges')) return;
          const avant = { ts: JSON.stringify(data.timesheets || []), im: JSON.stringify(data.badgeImports || []) };
          const r = C.importerBadges(data, lu.passages, true);
          data.badgeImports = (data.badgeImports || []).concat([{ id: C.uid(), le: new Date().toISOString(), fichier: fichier.slice(0, 120), du: r.du, au: r.au, lus: lu.passages.length, rattaches: r.rattaches, deja: r.deja, inconnus: r.inconnus.slice(0, 20) }]).slice(-24);
          save(true); fermer(); apres();
          toastUndo(`${r.rattaches - r.deja} badge${r.rattaches - r.deja > 1 ? 's' : ''} importé${r.rattaches - r.deja > 1 ? 's' : ''}, du ${C.fmtDate(r.du)} au ${C.fmtDate(r.au)}`, () => { data.timesheets = JSON.parse(avant.ts); data.badgeImports = JSON.parse(avant.im); save(true); apres(); });
        };
      });
    }
    // (1.259.0) Une anomalie de la pointeuse, une ligne de « À régler » avec son bouton.
    function anomalieLigneHtml(a, y, m) {
      const e = employeeById(a.employeeId); if (!e) return '';
      const av = `<span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}" aria-hidden="true">${h(C.initialesDe(e.name || ''))}</span>`;
      const prenom = h(String(e.name || '').split(' ')[0]);
      if (a.sorte === 'sortie') return `<li>${av}<span class="pt-an-n"><b>${prenom}, le ${String(a.jour).padStart(2, '0')}/${String(m).padStart(2, '0')} : une entrée à ${h(a.entree)}, pas de sortie</b><small>oubli de badge ?${a.proposee ? ` Sur le planning, il finit à ${h(a.proposee)}` : ''}</small></span>${a.proposee ? `<button type="button" class="btn btn-sm" data-an-sortie="${h(e.id)}" data-j="${a.jour}" data-h="${h(a.proposee)}">Mettre la sortie à ${h(a.proposee)}</button>` : `<button type="button" class="btn btn-sm" data-an-case="${h(e.id)}" data-j="${a.jour}">Voir la case…</button>`}</li>`;
      const cout = C.round3((C.brutDuMois(e, y, m) || 0) / 26 * a.jours.length);
      const bal = (() => { try { return C.leaveBalance(data, e.id, y); } catch (_) { return null; } })();
      const dits = a.jours.length > 3 ? `${a.jours.length} jours` : `les ${a.jours.map(d => String(d).padStart(2, '0')).join(', ').replace(/, ([^,]*)$/, ' et $1')}/${String(m).padStart(2, '0')}`;
      return `<li>${av}<span class="pt-an-n"><b>${prenom}, ${dits} : aucun badge, aucun justificatif</b><small>absence sans solde (${pl(a.jours.length, 'jour')}, − ${C.money(cout, company().currency)}), ou congé payé${bal ? ` (il lui reste ${pct(Number(bal.remaining) || 0)} jours)` : ''}</small></span><button type="button" class="btn btn-sm" data-an-sans="${h(e.id)}" data-j="${a.jours.join(',')}">Choisir…</button></li>`;
    }
    // Le bandeau de la pointeuse et « À régler avant d'envoyer » (maquette E17), au-dessus de la grille du mois.
    function ptPointeuseHtml(y, m) {
      const Q = aLaPointeuse(); if (!Q.length) return '';
      const im = dernierImport();
      return `<div class="bandeau gris pa-bandeau pa-gris" id="pt-pointeuse">${lfIc('importer', 18)}<span class="txt"><b>${im ? `La pointeuse, lue le ${h(C.fmtDate(C.jourDeLInstant(im.le)))} à ${h(new Date(im.le).toTimeString().slice(0, 5).replace(':', ' h '))} : ${pl(im.rattaches, 'badge')}` : `${h(Q.map(q => q.nom).join(', '))} : à la pointeuse`}</b><span>${im ? `Chaque badge va au salarié qui a ce n° de badge sur sa fiche ; les congés et absences saisis se posent d'eux-mêmes. Tu peux aussi pointer à la main, case par case.` : `Importe le fichier de la pointeuse : chaque badge va au salarié qui a ce n° sur sa fiche, et SkanFact dit ce qui manque.`}</span></span><button type="button" class="btn btn-sm" id="pt-import">${im ? 'Importer à nouveau…' : 'Importer la pointeuse…'}</button></div>
`;
    }
    function lierPointeuse(y, m, apres) {
      if ($('#pt-import')) $('#pt-import').onclick = () => importBadgesFenetre(apres);
      $$('[data-an-sortie]').forEach(b => b.onclick = () => {
        const e = employeeById(b.dataset.anSortie); if (!e || !peutPointerLe(`${y}-${String(m).padStart(2, '0')}-01`)) return;
        const avant = JSON.stringify(data.timesheets || []);
        if (!C.poserSortie(data, e, y, m, Number(b.dataset.j), b.dataset.h)) return;
        save(); apres();
        toastUndo(`${e.name} : sortie du ${String(b.dataset.j).padStart(2, '0')}/${String(m).padStart(2, '0')} mise à ${b.dataset.h}`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
      });
      $$('[data-an-case]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.anCase); if (e) caseFenetre(e, y, m, Number(b.dataset.j), apres); });
      $$('[data-an-sans]').forEach(b => b.onclick = () => { const e = employeeById(b.dataset.anSans); if (e) sansBadgeFenetre(e, y, m, b.dataset.j.split(',').map(Number), apres); });
    }
    // (maquette O26) Des jours sans badge ni justificatif : sans solde ou congé payé, ce que chacun fait sur son bulletin.
    function sansBadgeFenetre(e, y, m, jours, apres) {
      const cur = company().currency, unJour = C.round3((C.brutDuMois(e, y, m) || 0) / 26), n = jours.length;
      const bal = (() => { try { return C.leaveBalance(data, e.id, y); } catch (_) { return null; } })(), reste = bal ? Number(bal.remaining) || 0 : null;
      const dits = jours.map(d => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`).join(', ').replace(/, ([^,]*)$/, ' et $1');
      modal(`<h2>${h(e.name)} · ${h(dits)}</h2>
        <p class="sous-f">aucun badge, aucun justificatif : choisis ce que ${n > 1 ? 'ces jours deviennent' : 'ce jour devient'} ; c'est ce que son bulletin dira</p>
        <form id="sb"><div class="pa-choix pc-choix">
          <label class="pa-choix-l"><input type="radio" name="code" value="A" checked> <span><b>Absence sans solde</b><small>− ${C.money(C.round3(unJour * n), cur)} sur son brut (${pl(n, 'jour')})</small></span></label>
          <label class="pa-choix-l"><input type="radio" name="code" value="C"> <span><b>Congé payé</b><small>son salaire ne bouge pas${reste != null ? ` · il lui reste ${pct(reste)} jour${reste > 1 ? 's' : ''}, ${pct(Math.max(0, reste - n))} après` : ''}</small></span></label>
          <label class="pa-choix-l"><input type="radio" name="code" value="M"> <span><b>Malade</b><small>un certificat à joindre ; la CNAM indemnise (À VÉRIFIER)</small></span></label>
          <label class="pa-choix-l"><input type="radio" name="code" value="P"> <span><b>Il était là</b><small>la pointeuse l'a manqué : présent, payé normalement</small></span></label>
        </div></form>
        ${reste != null && reste < n ? `<p class="small warn-text">Son solde ne couvre pas ${pl(n, 'jour')} de congé : le reste serait une absence sans solde.</p>` : ''}
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="sb-ok">${lfIc('coche', 15, 2.4)} Noter</button></div>`, (root, fermer) => {
        $('#sb-ok', root).onclick = () => {
          const code = (formValues($('#sb', root)).code) || 'A';
          if (!peutPointerLe(`${y}-${String(m).padStart(2, '0')}-${String(jours[jours.length - 1]).padStart(2, '0')}`)) return;
          if (refusJoursValides(jours.map(d => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`))) return;
          const avant = JSON.stringify(data.timesheets || []);
          let k = 0;
          jours.forEach(d => { if (code === 'P') { const t = C.pointageEnregistre(data, e.id, y, m); if (t) { t.jours = t.jours || {}; t.jours[String(d)] = 'P'; k++; } } else if (C.poserPointage(data, e, y, m, d, code)) k++; });
          save(); fermer(); apres();
          toastUndo(`${e.name} : ${pl(k, 'jour')} « ${C.libellePointage(code).toLowerCase()} »`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
        };
      });
    }
    // (1.257.0) « Pointer une case » (maquette O20) : un clic sur une case de la grille ouvre ce que chaque choix fait,
    // sur la grille ET sur son bulletin (un jour sans solde se chiffre, un congé dit le solde qui reste), avec le retard du
    // jour et « Au » pour noter plusieurs jours d'un coup. Les lettres au clavier posent toujours le code sans fenêtre.
    function caseFenetre(e, y, m, jour, apres, opt = {}) {
      const st = C.payrollSettings(data), p = C.pointageDuMois(data, e, y, m), j = p.jours.find(x => x.jour === Number(jour));
      if (!j || j.code === '-') return;
      if (!peutPointerLe(j.iso)) return; // (1.258.0) une journée validée refuse avant d'ouvrir la fenêtre
      const cur = company().currency, iso = j.iso, q = C.equipeDe(st, e);
      const unJour = C.round3((C.brutDuMois(e, y, m) || Number(e.grossSalary) || 0) / (Number(p.total) || 26));
      const bal = (() => { try { return C.leaveBalance(data, e.id, y); } catch (_) { return null; } })();
      const reste = bal ? Number(bal.remaining) || 0 : null;
      const jourDit = `${JOURS_SEM[j.wd]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
      const planning = q ? `${h(q.nom || 'son équipe')}${q.debut && q.fin ? ` : ${h(q.debut)} – ${h(q.fin)}` : ''}` : j.repos ? 'son jour de repos' : 'selon ses jours de travail';
      const choix = j.repos
        ? [['R', 'Repos', 'son jour de repos de la semaine'], ['P', 'Présent', 'travaillé : ses heures se notent en heures sup, dans la colonne « HS » de la grille']]
        : [['P', 'Présent', q && q.debut ? 'ses horaires d\'équipe' : 'payé normalement'],
          ['A', 'Absent, sans solde', `− ${C.money(unJour, cur)} sur son brut`],
          ['D', 'Demi-journée', `− ${C.money(C.round3(unJour / 2), cur)} sur son brut`],
          ['C', 'Congé payé', `son salaire ne bouge pas${reste != null ? ` · il lui reste ${pct(reste)} jour${reste > 1 ? 's' : ''}` : ''}`],
          ['M', 'Malade', 'certificat à joindre ; la CNAM indemnise (À VÉRIFIER)'],
          ['F', 'Jour férié', `payé${j.ferie ? ` · ${h(j.ferie)}` : ''} ; la liste des fériés : À VÉRIFIER`]];
      modal(`<h2>${h(e.name)} · ${h(jourDit)}</h2>
        <p class="sous-f">planning : ${planning} · ce que tu choisis se voit dans la grille et sur son bulletin</p>
        <form id="pc">
          <div class="pa-choix pc-choix">${choix.map(([c, t, d]) => `<label class="pa-choix-l"><input type="radio" name="code" value="${c}" ${(opt.code && choix.some(x => x[0] === opt.code) ? opt.code : j.code) === c ? 'checked' : ''}> <span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
          <div class="grid-2 pc-g">
            <label class="field" id="pc-retard-l">${lbl('Retard')}<small class="muted pc-aide">${st.retenirRetards ? 'en minutes ; retenu sur son salaire (ton réglage)' : 'en minutes ; noté, il ne se retient pas (réglage : À VÉRIFIER)'}</small><input type="number" class="num" name="retard" min="0" max="600" step="5" value="${j.retard || ''}" placeholder="0"></label>
            <div>${dateFieldHtml(`Au <small class="muted pc-aide">pour une semaine de congé, d'un coup</small>`, 'au', '', { placeholder: 'un seul jour' })}</div>
          </div>
        </form>
        <p class="small muted" id="pc-dit" role="status" aria-live="polite"></p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="pc-ok">${lfIc('coche', 15, 2.4)} Noter</button></div>`, (root, fermer) => {
        const lire = () => { const v = formValues($('#pc', root)); return { code: v.code || j.code, retard: Number(v.retard) || 0, au: v.au && v.au > iso ? v.au : '' }; };
        const maj = () => {
          const o = lire();
          $('#pc-retard-l', root).style.visibility = o.code === 'P' && !o.au ? '' : 'hidden';
          $('#pc-dit', root).textContent = o.au ? `Du ${C.fmtDate(iso)} au ${C.fmtDate(o.au)} : les jours de travail seulement, les jours de repos restent du repos.` : '';
        };
        $('#pc', root).addEventListener('input', maj); $('#pc', root).addEventListener('change', maj); maj();
        if (opt.focus === 'retard') { const r = $('#pc [name=retard]', root); if (r) { r.focus(); r.select(); } }
        $('#pc-ok', root).onclick = () => {
          const o = lire(), fin = o.au || iso;
          if (!peutPointerLe(fin)) return;
          { const L = []; for (let d = iso; d <= fin && L.length < 400; d = C.addDays(d, 1)) L.push(d); if (refusJoursValides(L)) return; }
          const avant = JSON.stringify(data.timesheets || []);
          let n = 0;
          for (let d = iso; d <= fin && n < 400; d = C.addDays(d, 1)) {
            const yy = Number(d.slice(0, 4)), mm = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
            const jj = C.pointageDuMois(data, e, yy, mm).jours.find(x => x.jour === dd);
            if (!jj || jj.code === '-' || (d !== iso && jj.repos)) continue;
            if (C.poserPointage(data, e, yy, mm, dd, o.code)) { n++; if (o.code !== 'P') C.poserHeuresSupDuJour(data, e, yy, mm, dd, 0, 0); }
            if (d === iso) C.poserRetard(data, e, yy, mm, dd, o.code === 'P' && !o.au ? o.retard : 0);
          }
          if (!n) { toast(j.repos ? `Le ${jourDit} est un jour de repos : il se pointe « Repos », ou « Présent » s'il a été travaillé.` : 'Rien à noter sur ces jours.', true); return; }
          save(); fermer(); apres();
          const lib = C.libellePointage(o.code).toLowerCase();
          toastUndo(`${e.name} : ${n > 1 ? `${pl(n, 'jour')} « ${lib} »` : `${jourDit}, ${lib}`}${o.code === 'P' && o.retard && !o.au ? `, ${o.retard} min de retard` : ''}`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
        };
      });
    }
    // « Par salarié » : son mois en calendrier (recette du 02/11 : une liste de 30 menus déroulants « ne donne pas envie »).
    // Une case par jour, sa couleur dit le code ; on choisit un jour (clic, ou les flèches), et la barre dessous le change
    // d'un clic ou d'une lettre. D'où vient chaque code (le calendrier, un congé saisi, un pointage) se lit sous la case.
    function drawPtSalarie(garderFocus) {
      const y = Number(s.ptY), m = Number(s.ptM), mois = MONTHS_LONG[m - 1];
      const premier = `${y}-${String(m).padStart(2, '0')}-01`, dernier = C.addDays(premier, C.daysInMonth(y, m) - 1);
      const emps = data.employees.filter(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier)).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      if (!emps.length) { $('#p-body').innerHTML = `<div class="empty">Aucun salarié en poste en ${h(mois)} ${y}.</div>`; return; }
      if (!emps.some(e => e.id === s.ptSal)) s.ptSal = emps[0].id;
      const k = emps.findIndex(x => x.id === s.ptSal), e = emps[k], p = C.pointageDuMois(data, e, y, m), st = C.payrollSettings(data);
      const SOURCE = { calendrier: 'selon ses jours de travail', conge: 'un congé ou une absence saisis', pointe: 'pointé à la main' };
      const SOURCE_C = { conge: 'saisi', pointe: 'pointé' };
      const auj = C.today();
      if (!p.jours.some(j => j.jour === s.ptJour)) s.ptJour = auj.slice(0, 7) === premier.slice(0, 7) ? Number(auj.slice(8, 10)) : 1;
      const sel = p.jours.find(j => j.jour === s.ptJour) || p.jours[0];
      // (1.257.0) Les heures sup que le bulletin paiera : celles des majorations réglées (heuresSupDuMois), pas une autre.
      const hsL = C.heuresSupDuMois(data, e, y, m).map(b => [b.hs, b.heures]);
      const hsTot = hsL.reduce((a, [, v]) => a + Number(v || 0), 0);
      const conges = p.jours.filter(j => j.code === 'C' || j.code === 'M').length;
      const decal = (p.jours[0].wd + 6) % 7; // lundi en premier
      const court = c => ({ P: '', D: '½ journée', A: 'Absent', C: 'Congé', M: 'Maladie', F: 'Férié', R: 'Repos', '-': 'hors contrat' })[c] || c;
      const nomJour = j => `${JOURS_SEM[j.wd]} ${j.jour} ${mois}`;
      const tuile = (t, v, d, cls = '') => `<div class="pa-tuile${cls}"><span class="t">${t}</span><b class="m">${v}</b><span class="s">${d}</span></div>`;
      const codesDe = j => j.code === '-' ? [] : (j.repos ? C.CODES_REPOS : C.CODES_POINTAGE.map(x => x[0]).filter(c => c !== 'R'));
      $('#p-body').innerHTML = `<section class="pa-carte" id="pt-sal">
          <div class="pt-sal-tete">
            <div class="pt-sal-qui"><button type="button" class="pt-nav-b" id="pt-sal-prec" aria-label="Salarié précédent${k > 0 ? ` : ${h(emps[k - 1].name)}` : ''}" ${k > 0 ? '' : 'disabled'}>${ICONE_CHEVRON}</button>
              ${avPaie(e)}<span class="pt-sal-sel"><select id="pt-sal-e" aria-label="Le salarié">${emps.map(x => `<option value="${h(x.id)}" ${x.id === e.id ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select><small>${h(e.position || 'poste à préciser')} · ${k + 1} sur ${emps.length}</small></span>
              <button type="button" class="pt-nav-b pt-nav-s" id="pt-sal-suiv" aria-label="Salarié suivant${k < emps.length - 1 ? ` : ${h(emps[k + 1].name)}` : ''}" ${k < emps.length - 1 ? '' : 'disabled'}>${ICONE_CHEVRON}</button></div>
            <button type="button" class="btn btn-sm" id="pt-sal-periode">${lfIc('echeance', 14)} Noter une période…</button></div>
          <div class="pa-tuiles pt-sal-chiffres" id="pt-sal-tot">
            ${tuile('Jours payés', `${pct(p.payes)} <small>sur ${pct(p.total)}</small>`, 'ce que reprendra le bulletin')}
            ${tuile('Non payés', p.absences ? pct(p.absences) : '0', p.absences ? 'absences et demi-journées' : 'aucune absence non payée', p.absences ? ' pt-t-alerte' : '')}
            ${tuile('Congés et maladie', String(conges), conges ? `${pl(conges, 'jour')} payé${conges > 1 ? 's' : ''}` : 'aucun ce mois')}
            ${tuile('Heures sup', hsTot ? `${pct(hsTot)} h` : '0', hsTot ? hsL.map(([x, v]) => `${pct(v)} h à +${pct(x)} %`).join(', ') : 'elles se notent dans la grille du mois')}
          </div>
          <div class="pt-edit" id="pt-sal-edit" aria-live="polite">
            <div class="pt-edit-t"><b>${h(nomJour(sel).charAt(0).toUpperCase() + nomJour(sel).slice(1))}</b><span class="mu">${sel.code === '-' ? 'hors contrat : avant son entrée ou après sa sortie, rien ne se pointe' : `${h(C.libellePointage(sel.code))} · ${h(SOURCE[sel.source] || '')}${sel.repos ? ' · jour de repos' : ''}`}</span></div>
            ${codesDe(sel).length ? `<div class="pt-seg" role="group" aria-label="Ce jour-là">${codesDe(sel).map(c => `<button type="button" data-ptc="${c}" aria-pressed="${c === sel.code}" title="Touche ${c}">${h(C.libellePointage(c))}<kbd>${c}</kbd></button>`).join('')}</div>` : ''}
          </div>
          <div class="pt-cal" id="pt-sal-t" role="grid" aria-label="${h(e.name)}, ${h(mois)} ${y}">
            ${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(x => `<span class="pt-cal-h" role="columnheader">${x}</span>`).join('')}
            ${'<span class="pt-cal-v" aria-hidden="true"></span>'.repeat(decal)}
            ${p.jours.map(j => `<button type="button" role="gridcell" class="pt-jour pt-k-${j.code === '-' ? 'hors' : j.code}${j.repos ? ' pt-jour-repos' : ''}${`${premier.slice(0, 8)}${String(j.jour).padStart(2, '0')}` === auj ? ' pt-jour-auj' : ''}" data-ptj="${j.jour}" aria-selected="${j.jour === sel.jour}" tabindex="${j.jour === sel.jour ? 0 : -1}" aria-label="${h(nomJour(j))} : ${h(C.libellePointage(j.code))}${j.code !== '-' && SOURCE[j.source] ? `, ${h(SOURCE[j.source])}` : ''}"><span class="n">${j.jour}</span><span class="c">${j.code === 'P' || (j.code === 'R' && j.source !== 'pointe') ? '' : h(court(j.code))}</span>${SOURCE_C[j.source] && j.code !== '-' ? `<small>${SOURCE_C[j.source]}</small>` : ''}</button>`).join('')}
          </div>
          <p class="small muted pa-note">Les flèches passent d'un jour à l'autre, une lettre pose son code (P, D, A, C, M, F). Ses jours de travail : ${h([1, 2, 3, 4, 5, 6, 0].filter(i => !C.joursReposDe(st, e).includes(i)).map(i => JOURS_SEM[i]).join(', '))}${C.equipeDe(st, e) ? ` (${h(C.equipeDe(st, e).nom)})` : ''} ; un mois complet compte ${pct(Number(st.workedDays) || 26)} jours payés.</p></section>
        ${ptSemaineHtml(e, y, m, sel.jour, p)}`;
      const aller = id => { s.ptSal = id; drawPtSalarie(); };
      $('#pt-sal-e').onchange = ev => aller(ev.target.value);
      $('#pt-sal-prec').onclick = () => { if (k > 0) aller(emps[k - 1].id); };
      $('#pt-sal-suiv').onclick = () => { if (k < emps.length - 1) aller(emps[k + 1].id); };
      $('#pt-sal-periode').onclick = () => ptPeriodeFenetre(e.id, () => drawPtSalarie(), jourDuMoisRegarde(y, m));
      const choisir = (n, focus) => { s.ptJour = n; drawPtSalarie(focus); };
      const poser = code => {
        if (!codesDe(sel).includes(code) || code === sel.code) return;
        if (!peutPointerLe(dernier) || !peutPointerLe(`${ymPt(y, m)}-${String(sel.jour).padStart(2, '0')}`)) return;
        const avant = JSON.stringify(data.timesheets || []);
        if (!C.poserPointage(data, e, y, m, sel.jour, code)) return;
        save(); drawPtSalarie('jour');
        toastUndo(`${e.name}, ${nomJour(sel)} : ${C.libellePointage(code).toLowerCase()}`, () => { data.timesheets = JSON.parse(avant); save(); drawPtSalarie(); });
      };
      $$('#pt-sal-t [data-ptj]').forEach(b => {
        b.onclick = () => choisir(Number(b.dataset.ptj), 'jour');
        b.onkeydown = ev => {
          const pas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
          if (pas) { ev.preventDefault(); const n = Math.min(p.jours.length, Math.max(1, sel.jour + pas)); if (n !== sel.jour) choisir(n, 'jour'); return; }
          if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); choisir(ev.key === 'Home' ? 1 : p.jours.length, 'jour'); return; }
          const c = ev.key.length === 1 ? ev.key.toUpperCase() : '';
          if (c && !ev.ctrlKey && !ev.metaKey && !ev.altKey && codesDe(sel).includes(c)) { ev.preventDefault(); poser(c); }
        };
      });
      $$('#pt-sal-edit [data-ptc]').forEach(b => b.onclick = () => poser(b.dataset.ptc));
      if (garderFocus === 'jour') { const c = $(`#pt-sal-t [data-ptj="${s.ptJour}"]`); if (c) c.focus(); }
      lierSemaine(e, y, m, () => drawPtSalarie());
      majTeteDuMois();
    }
    // (1.257.0) « La semaine de Mourad, heure par heure » (maquette) : lue sur ses badges, la semaine du jour choisi —
    // l'arrivée, le départ, le temps passé, ce qui va au bulletin (au-delà du planning, un retard). Les heures sup des
    // badges se reprennent dans la grille d'un geste : jamais d'elles-mêmes (la main gagne).
    const hDit = mn => mn == null ? '—' : mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h${mn % 60 ? ` ${String(mn % 60).padStart(2, '0')}` : ''}`;
    function ptSemaineHtml(e, y, m, jour, p) {
      if (!p.jours.some(j => j.badge)) return '';
      const st = C.payrollSettings(data), q = C.equipeDe(st, e), j0 = p.jours.find(j => j.jour === jour) || p.jours[0];
      const lundi = j0.jour - ((j0.wd + 6) % 7), J = p.jours.filter(j => j.jour >= lundi && j.jour < lundi + 7);
      const L = J.map(j => ({ j, b: C.journeeBadges(data, e, j.iso) }));
      const tot = L.reduce((a, x) => a + ((x.b && x.b.travaille) || 0), 0), hs = L.reduce((a, x) => a + ((x.b && x.b.auDela) || 0), 0);
      const mois = p.jours.map(j => C.journeeBadges(data, e, j.iso)).filter(Boolean).reduce((a, b) => a + (b.auDela || 0), 0);
      const maj = C.majorationsHs(st)[0];
      const dejaHs = Number((p.hs || {})[String(maj)]) || 0, viseHs = C.round3(mois / 60);
      const jj = j => `${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][j.wd]} ${String(j.jour).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
      const auBul = ({ j, b }) => j.repos ? '<span class="mu">repos</span>' : j.code !== 'P' ? `<span class="statut">${h(C.libellePointage(j.code).toLowerCase())}</span>` : !b ? '<span class="statut alerte">aucun badge</span>'
        : [b.auDela ? `<span class="statut attire">+ ${hDit(b.auDela)}</span>` : '', b.retard ? `<span class="statut">retard ${b.retard} min, non retenu</span>` : '', b.sortieMain ? '<span class="mu">sortie posée à la main</span>' : ''].filter(Boolean).join(' ') || '<span class="mu">normal</span>';
      return `<section class="pa-carte" id="pt-sem"><div class="pa-carte-t"><b>${h(e.name)} · semaine du ${J[0].jour} au ${J[J.length - 1].jour} ${h(MONTHS_LONG[m - 1])}</b><span class="mu">${q && q.debut ? `planning : ${h(q.debut)} – ${h(q.fin)}, ${h(joursDitCourt(q.jours))}` : 'lue sur ses badges'}</span>
          <span class="pt-sem-nav"><button type="button" class="pt-nav-b" data-sem="${Math.max(1, lundi - 7)}" ${lundi > 1 ? '' : 'disabled'} aria-label="La semaine d'avant">${ICONE_CHEVRON}</button><button type="button" class="pt-nav-b pt-nav-s" data-sem="${lundi + 7}" ${lundi + 7 <= p.jours.length ? '' : 'disabled'} aria-label="La semaine d'après">${ICONE_CHEVRON}</button></span></div>
        <div class="pt-sem-c"><table class="mini pt-sem-t"><thead><tr><th>Jour</th><th>Arrivée</th><th>Départ</th><th class="r">Travaillé</th><th>Au bulletin</th></tr></thead><tbody>
          ${L.map(x => `<tr><td>${jj(x.j)}</td><td class="mono">${x.b ? h(x.b.arrivee) : '—'}</td><td class="mono">${x.b && x.b.depart ? h(x.b.depart) : '—'}</td><td class="r">${x.b ? hDit(x.b.travaille) : x.j.repos ? 'repos' : '—'}</td><td>${auBul(x)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="3">La semaine</td><td class="r">${hDit(tot)}</td><td>${hs ? `${hDit(hs)} au-delà du planning` : 'rien au-delà du planning'}</td></tr></tfoot></table></div>
        <div class="pt-sem-pied"><span class="mu">Les heures sup se comptent après la fin du planning de son équipe, ${Number(st.hsArrondi) > 0 ? `arrondies à ${Number(st.hsArrondi)} min inférieures (ton réglage)` : 'à la minute (aucun arrondi n\'est réglé)'} ; un retard se note, il ne se retient pas. Ces règles : À VÉRIFIER avec ton comptable.</span>
          ${mois ? (maj ? `<button type="button" class="btn btn-sm" id="pt-sem-hs" ${C.round3(dejaHs) === viseHs ? 'disabled' : ''}>${C.round3(dejaHs) === viseHs ? `${pct(viseHs)} h sup du mois déjà dans la grille` : `Mettre ses ${pct(viseHs)} h sup du mois dans la grille (+${pct(maj)} %)`}</button>` : '<span class="small warn-text">Ses badges donnent des heures sup : règle d\'abord leur majoration dans « Les horaires ».</span>') : ''}</div></section>`;
    }
    function lierSemaine(e, y, m, apres) {
      $$('#pt-sem [data-sem]').forEach(b => b.onclick = () => { s.ptJour = Number(b.dataset.sem); apres(); });
      if ($('#pt-sem-hs')) $('#pt-sem-hs').onclick = () => {
        if (!peutPointerLe(`${y}-${String(m).padStart(2, '0')}-01`)) return;
        const st = C.payrollSettings(data), maj = C.majorationsHs(st)[0], p = C.pointageDuMois(data, e, y, m);
        const mn = p.jours.map(j => C.journeeBadges(data, e, j.iso)).filter(Boolean).reduce((a, b) => a + (b.auDela || 0), 0);
        const avant = JSON.stringify(data.timesheets || []);
        C.poserHeuresSup(data, e, y, m, maj, C.round3(mn / 60)); save(); apres();
        toastUndo(`${e.name} : ${pct(C.round3(mn / 60))} h sup à +${pct(maj)} % dans la grille ${/^[aeiouyéè]/i.test(MONTHS_LONG[m - 1]) ? 'd\'' : 'de '}${MONTHS_LONG[m - 1]}`, () => { data.timesheets = JSON.parse(avant); save(); apres(); });
      };
    }
    // « Les horaires » : ce qui fait le pointage par défaut (les jours de travail, le mois complet, les heures du mois, les
    // majorations). (1.249.0) Ils se changent ICI (recette du 02/11 : le bandeau disait « Les horaires », la page ne
    // laissait rien changer et renvoyait aux Réglages) ; les Réglages de la paie lisent les mêmes cases. Rien n'est
    // inventé : une majoration vide ne paraît pas dans la grille. Les bulletins déjà établis ne bougent pas.
    // (1.257.0) Les jours d'une équipe, dits comme on les dit : « du lundi au samedi », « lundi, mercredi, vendredi ».
    const joursDit = L => {
      const o = [1, 2, 3, 4, 5, 6, 0].filter(i => (L || []).includes(i));
      if (!o.length) return '—';
      const idx = o.map(i => [1, 2, 3, 4, 5, 6, 0].indexOf(i)), suite = idx.every((v, k) => !k || v === idx[k - 1] + 1);
      return suite && o.length > 2 ? `du ${JOURS_SEM[o[0]]} au ${JOURS_SEM[o[o.length - 1]]}` : o.map(i => JOURS_SEM[i]).join(', ');
    };
    // Les fériés à date fixe du calendrier civil, proposés d'un geste (jamais posés d'eux-mêmes) : À VÉRIFIER chaque année.
    // Les fêtes religieuses changent de date chaque année : elles s'ajoutent une par une.
    const FERIES_FIXES = [['01-01', 'Jour de l\'an'], ['03-20', 'Fête de l\'Indépendance'], ['04-09', 'Journée des Martyrs'], ['05-01', 'Fête du Travail'],
      ['07-25', 'Fête de la République'], ['08-13', 'Fête de la Femme'], ['10-15', 'Fête de l\'Évacuation'], ['12-17', 'Fête de la Révolution']];
    function ptEquipesHtml(st) {
      const Q = st.equipes || [], an = Number(s.ptY) || Number(C.today().slice(0, 4));
      const membres = q => data.employees.filter(e => e.active !== false && e.equipeId === q.id && !(e.endDate && e.endDate < C.today()));
      const av = e => `<span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}" title="${h(e.name)}" aria-label="${h(e.name)}">${h(C.initialesDe(e.name || ''))}</span>`;
      const sansEq = data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today()) && !Q.some(q => q.id === e.equipeId));
      const F = (st.feries || []).filter(f => f && String(f.date).startsWith(String(an))).sort((x, y) => x.date.localeCompare(y.date));
      const manquent = FERIES_FIXES.filter(([md]) => !F.some(f => f.date === `${an}-${md}`)).length;
      return `<section class="pa-carte" id="pt-eq"><div class="pa-carte-t"><b>Les horaires d'équipe</b><span class="mu">ils servent à compter les jours de repos, les heures sup et les retards</span><button type="button" class="btn btn-sm" id="pt-eq-add">${lfIc('croix', 14, 2.4)} Une équipe…</button></div>
          ${Q.length ? `<table class="list compact pa-liste pt-eq-t"><thead><tr><th>Équipe</th><th>Horaires</th><th>Jours</th><th>Qui</th><th>Elle pointe</th><th></th></tr></thead><tbody>
            ${Q.map(q => `<tr data-eq="${h(q.id)}"><td><b>${h(q.nom || 'Équipe')}</b>${Number(q.minimum) > 0 ? `<small class="muted" style="display:block">tient à ${Number(q.minimum)} au moins</small>` : ''}</td><td class="mono">${q.debut && q.fin ? `${h(q.debut)} – ${h(q.fin)}` : '<span class="muted">—</span>'}</td><td>${h(joursDit(q.jours))}</td><td><span class="pt-eq-qui">${membres(q).map(av).join('') || '<span class="muted">personne</span>'}</span></td><td>${q.pointe === 'pointeuse' ? 'la pointeuse' : 'à la main'}</td><td class="r"><button type="button" class="btn btn-sm" data-eq-mod="${h(q.id)}">Modifier</button></td></tr>`).join('')}
          </tbody></table>${sansEq.length ? `<p class="small muted pa-note">Sans équipe, les horaires de l'entreprise : ${sansEq.map(e => h(e.name)).join(', ')}.</p>` : ''}`
          : `<div class="empty pt-eq-vide"><b>Une seule équipe pour l'instant</b><span>Tout le monde suit les horaires de l'entreprise, ci-dessus. Le fournil la nuit, la boutique le matin ? Crée une équipe par horaire : chacun y trouve ses jours de repos, et ses heures sup et ses retards se comptent sur son planning.</span></div>`}
        </section>
        <section class="pa-carte" id="pt-hor"><div class="pa-carte-t"><b>Comment chaque équipe pointe</b><span class="mu">une pointeuse n'est pas obligatoire : sans elle, tu notes seulement ce qui change</span></div>
          <div class="pj">${(Q.length ? Q : [{ nom: 'Toute l\'entreprise', pointe: 'main' }]).map(q => `<div class="pj-l"><span><b>${h(q.nom || 'Équipe')}</b> · ${q.pointe === 'pointeuse' ? 'la pointeuse' : 'à la main'}<small class="mu" style="display:block">${q.pointe === 'pointeuse' ? 'ses badges s\'importent (chaque salarié est reconnu par son n° de badge) ; tu règles les anomalies' : 'présent par défaut ; le soir, « La journée » note ce qui change et se valide ; « Une absence sur plusieurs jours » fait le reste'}</small></span></div>`).join('')}</div></section>
        <section class="pa-carte" id="pt-fer"><div class="pa-carte-t"><b>Les jours fériés de ${an}</b><span class="mu">posés d'eux-mêmes dans la grille, payés ; la liste des fériés chômés et payés : À VÉRIFIER chaque année</span>${manquent ? `<button type="button" class="btn btn-sm" id="pt-fer-fixes">Proposer les ${manquent} fériés à date fixe</button>` : ''}</div>
          ${F.length ? `<table class="list compact pa-liste"><tbody>${F.map(f => `<tr><td class="nw">${h(JOURS_SEM[new Date(f.date + 'T00:00:00Z').getUTCDay()])} ${h(C.fmtDate(f.date))}</td><td>${h(f.nom || '')}</td><td class="r"><button type="button" class="btn btn-sm btn-ghost" data-fer-x="${h(f.date)}" aria-label="Retirer le férié du ${h(C.fmtDate(f.date))}">Retirer</button></td></tr>`).join('')}</tbody></table>`
            : `<p class="small muted pa-note">Aucun férié n'est posé pour ${an} : rien ne s'invente. Propose ceux à date fixe, ou ajoute-les un par un ; les fêtes religieuses changent de date chaque année.</p>`}
          <form class="pt-fer-add" id="pt-fer-f">${dateFieldHtml(lbl('Un férié'), 'date', '', {})}<label class="field">${lbl('Son nom')}<input type="text" name="nom" maxlength="60" placeholder="Aïd el-Fitr"></label><button type="button" class="btn btn-sm" id="pt-fer-ok">Ajouter</button></form>
          <p class="small muted pa-note">Un férié travaillé se paie avec sa majoration, s'il y en a une : À VÉRIFIER (le Code du travail, ta convention).</p></section>`;
    }
    function lierEquipes(redessin) {
      const reglages = () => (data.payrollSettings = data.payrollSettings || {});
      const instant = () => ({ ps: deepCopy(data.payrollSettings || {}), eq: data.employees.map(e => [e.id, e.equipeId]) });
      const remettre = av => { data.payrollSettings = av.ps; av.eq.forEach(([id, q]) => { const e = employeeById(id); if (e) { if (q) e.equipeId = q; else delete e.equipeId; } }); save(true); redessin(); };
      if ($('#pt-eq-add')) $('#pt-eq-add').onclick = () => equipeFenetre(null, redessin);
      $$('[data-eq-mod]').forEach(b => b.onclick = () => equipeFenetre((C.payrollSettings(data).equipes || []).find(q => q.id === b.dataset.eqMod), redessin));
      const an = Number(s.ptY) || Number(C.today().slice(0, 4));
      if ($('#pt-fer-fixes')) $('#pt-fer-fixes').onclick = () => {
        const av = instant(), L = (reglages().feries || []).slice();
        FERIES_FIXES.forEach(([md, nom]) => { if (!L.some(f => f.date === `${an}-${md}`)) L.push({ date: `${an}-${md}`, nom }); });
        reglages().feries = L.sort((x, y) => x.date.localeCompare(y.date)); save(true); redessin();
        toastUndo(`Les fériés à date fixe de ${an} posés : relis la liste (À VÉRIFIER)`, () => remettre(av));
      };
      $$('[data-fer-x]').forEach(b => b.onclick = () => {
        const av = instant(); reglages().feries = (reglages().feries || []).filter(f => f.date !== b.dataset.ferX); save(true); redessin();
        toastUndo(`Férié du ${C.fmtDate(b.dataset.ferX)} retiré`, () => remettre(av));
      });
      if ($('#pt-fer-ok')) $('#pt-fer-ok').onclick = () => {
        const v = formValues($('#pt-fer-f')), nom = String(v.nom || '').trim();
        if (!v.date) { toast('La date du férié manque.', true); const f = $('#pt-fer-f .d-txt'); if (f) f.focus(); return; }
        if (!nom) { toast('Le nom du férié manque : il se lit dans la grille.', true); $('#pt-fer-f [name=nom]').focus(); return; }
        const av = instant(); reglages().feries = (reglages().feries || []).filter(f => f.date !== v.date).concat([{ date: v.date, nom: nom.slice(0, 60) }]).sort((x, y) => x.date.localeCompare(y.date));
        save(true); redessin(); toastUndo(`${nom} : férié le ${C.fmtDate(v.date)}`, () => remettre(av));
      };
    }
    // Une équipe : son nom, ses horaires, ses jours, comment elle pointe, son minimum, qui en est.
    function equipeFenetre(q0, redessin) {
      const q = q0 || { id: C.uid(), nom: '', debut: '', fin: '', jours: [1, 2, 3, 4, 5, 6], pointe: 'main', minimum: 0 };
      const emps = data.employees.filter(e => e.active !== false && !(e.endDate && e.endDate < C.today())).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      const Q = C.payrollSettings(data).equipes || [];
      modal(`<h2>${q0 ? `L'équipe ${h(q.nom)}` : 'Une équipe'}</h2>
        <p class="sous-f">ses horaires font le pointage par défaut de ceux qui en sont : leurs jours de repos, leurs heures sup, leurs retards</p>
        <form id="eq" class="grid-2">
          <label class="field span-2 obligatoire">${lbl('Son nom', 'pay.equipeNom')}<input type="text" name="nom" maxlength="60" value="${h(q.nom || '')}" placeholder="Le fournil, la nuit"></label>
          <label class="field">${lbl('Elle commence à')}<input type="text" name="debut" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="03:00" value="${h(q.debut || '')}"></label>
          <label class="field">${lbl('Elle finit à')}<input type="text" name="fin" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="11:00" value="${h(q.fin || '')}"></label>
          <fieldset class="span-2 pt-h-jours"><legend>Ses jours de travail <span class="muted small">(les autres sont ses jours de repos)</span></legend>
            <div class="pt-h-js">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button type="button" class="pt-h-j" data-eqj="${i}" aria-pressed="${(q.jours || []).includes(i)}">${JOURS_SEM[i].charAt(0).toUpperCase() + JOURS_SEM[i].slice(1)}</button>`).join('')}</div></fieldset>
          <div class="span-2 pa-choix eq-pointe"><label class="pa-choix-l"><input type="radio" name="pointe" value="main" ${q.pointe !== 'pointeuse' ? 'checked' : ''}> <span><b>À la main</b><small>présent par défaut, tu notes ce qui change</small></span></label><label class="pa-choix-l"><input type="radio" name="pointe" value="pointeuse" ${q.pointe === 'pointeuse' ? 'checked' : ''}> <span><b>À la pointeuse</b><small>ses badges s'importent, par n° de badge</small></span></label></div>
          <label class="field">${lbl('Elle tient à', 'pay.equipeMin')}<input type="number" class="num" name="minimum" min="0" max="50" step="1" value="${Number(q.minimum) > 0 ? Number(q.minimum) : ''}" placeholder="—"></label><span></span>
          <fieldset class="span-2 eq-qui"><legend>Qui en est</legend>${emps.map(e => { const autre = e.equipeId && e.equipeId !== q.id ? Q.find(x => x.id === e.equipeId) : null; return `<label class="check"><input type="checkbox" name="m_${h(e.id)}" ${e.equipeId === q.id ? 'checked' : ''}> ${h(e.name)}${autre ? ` <small class="muted">(aujourd'hui : ${h(autre.nom)})</small>` : ''}</label>`; }).join('') || '<span class="muted small">Aucun salarié en poste.</span>'}</fieldset>
        </form>
        <p class="small muted" id="eq-dit" role="status" aria-live="polite"></p>
        <div class="modal-actions">${q0 ? '<button type="button" class="btn btn-danger" id="eq-del" style="margin-inline-end:auto">Supprimer l\'équipe</button>' : ''}<button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="eq-ok">${lfIc('coche', 15, 2.4)} Enregistrer l'équipe</button></div>`, (root, fermer) => {
        const jours = () => $$('[data-eqj]', root).filter(b => b.getAttribute('aria-pressed') === 'true').map(b => Number(b.dataset.eqj));
        const dire = () => {
          const v = formValues($('#eq', root)), J = jours();
          const dur = /^\d{1,2}:\d{2}$/.test(v.debut || '') && /^\d{1,2}:\d{2}$/.test(v.fin || '') ? (() => { const [a1, a2] = v.debut.split(':').map(Number), [b1, b2] = v.fin.split(':').map(Number); let m = (b1 * 60 + b2) - (a1 * 60 + a2); if (m <= 0) m += 1440; return m; })() : 0;
          $('#eq-dit', root).textContent = !J.length ? 'Choisis au moins un jour de travail.' : `${joursDit(J)}${dur ? ` · ${Math.floor(dur / 60)} h${dur % 60 ? ` ${String(dur % 60).padStart(2, '0')}` : ''} par jour, ${Math.round(dur * J.length / 6) / 10} h par semaine` : ''} ; repos : ${[0, 1, 2, 3, 4, 5, 6].filter(i => !J.includes(i)).map(i => JOURS_SEM[i]).join(', ') || 'aucun'}.`;
        };
        $$('[data-eqj]', root).forEach(b => b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); dire(); });
        $('#eq', root).oninput = $('#eq', root).onchange = dire; dire();
        const av = { ps: deepCopy(data.payrollSettings || {}), eq: data.employees.map(e => [e.id, e.equipeId]) };
        const remettre = () => { data.payrollSettings = av.ps; av.eq.forEach(([id, x]) => { const e = employeeById(id); if (e) { if (x) e.equipeId = x; else delete e.equipeId; } }); save(true); redessin(); };
        if ($('#eq-del', root)) $('#eq-del', root).onclick = () => {
          data.payrollSettings = data.payrollSettings || {};
          data.payrollSettings.equipes = (data.payrollSettings.equipes || []).filter(x => x.id !== q.id);
          data.employees.forEach(e => { if (e.equipeId === q.id) delete e.equipeId; });
          save(true); fermer(); redessin(); toastUndo(`L'équipe ${q.nom} est supprimée : les siens suivent les horaires de l'entreprise`, remettre);
        };
        $('#eq-ok', root).onclick = () => {
          const v = formValues($('#eq', root)), J = jours(), nom = String(v.nom || '').trim();
          if (!nom) { toast('Le nom de l\'équipe manque.', true); $('#eq [name=nom]', root).focus(); return; }
          if (!J.length) { toast('Choisis au moins un jour de travail.', true); return; }
          const hh = x => { const m = /^(\d{1,2})[:h.]?(\d{2})$/.exec(String(x || '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
          for (const k of ['debut', 'fin']) { if (v[k] && !hh(v[k])) { toast('Une heure s\'écrit comme 03:00 ou 14:30.', true); $(`#eq [name=${k}]`, root).focus(); return; } v[k] = v[k] ? hh(v[k]) : ''; }
          if ((v.debut && !v.fin) || (!v.debut && v.fin)) { toast('Les horaires vont par deux : le début et la fin.', true); $(`#eq [name=${v.debut ? 'fin' : 'debut'}]`, root).focus(); return; }
          const nv = { id: q.id, nom: nom.slice(0, 60), debut: v.debut || '', fin: v.fin || '', jours: J, pointe: v.pointe === 'pointeuse' ? 'pointeuse' : 'main', minimum: Math.max(0, Math.round(Number(v.minimum) || 0)) };
          data.payrollSettings = data.payrollSettings || {};
          const L = (data.payrollSettings.equipes || []).filter(x => x.id !== q.id); L.push(nv);
          data.payrollSettings.equipes = q0 ? (data.payrollSettings.equipes || []).map(x => x.id === q.id ? nv : x) : L;
          emps.forEach(e => { const x = employeeById(e.id); if (!x) return; if (v[`m_${e.id}`]) x.equipeId = q.id; else if (x.equipeId === q.id) delete x.equipeId; });
          save(true); fermer(); redessin();
          const n = data.employees.filter(e => e.equipeId === q.id).length;
          toastUndo(`${nom} : ${n ? pl(n, 'salarié') : 'personne encore'}${nv.debut ? `, ${nv.debut} – ${nv.fin}` : ''}`, remettre);
        };
      });
    }
    function drawPtHoraires() {
      const st = C.payrollSettings(data), off = Array.isArray(st.offDays) ? st.offDays : [0];
      const ligne = (t, v, d) => `<tr><td><b>${t}</b></td><td>${v}</td><td class="small muted">${d}</td></tr>`;
      const val = k => (Number(st[k]) > 0 ? String(st[k]) : '');
      const champ = (k, t, aide, unite, attrs) => `<label class="field pt-h-f">${lbl(t)}<span class="pt-h-u"><input type="number" class="num" name="${k}" data-t="${h(t)}" value="${h(val(k))}" ${attrs} placeholder="—"><span>${unite}</span></span><small class="muted">${aide}</small></label>`;
      $('#p-body').innerHTML = `<section class="pa-carte" id="pt-hor-r"><div class="pa-carte-t"><b>Les horaires de l'entreprise</b><span class="mu">ils font le pointage par défaut, les jours payés et le prix d'une heure sup</span><button type="button" class="btn btn-sm" id="pt-h-q">${lfIc('reglages', 14)} Régler en 4 questions…</button></div>
          <form id="pt-h" class="pt-h">
            <fieldset class="pt-h-jours"><legend>Les jours de travail <span class="muted small">(les autres sont des jours de repos)</span></legend>
              <div class="pt-h-js">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button type="button" class="pt-h-j" data-jour="${i}" aria-pressed="${!off.includes(i)}">${JOURS_SEM[i].charAt(0).toUpperCase() + JOURS_SEM[i].slice(1)}</button>`).join('')}</div>
              <p class="small muted" id="pt-h-dit"></p></fieldset>
            <div class="pt-h-g pt-h-g3">
              ${champ('workedDays', 'Un mois complet', 'le salaire d\'un mois entier, sans absence', 'jours payés', 'min="1" max="31" step="0.5"')}
              ${champ('heuresMois', 'Heures d\'un mois complet', 'le prix d\'une heure sup se calcule sur elles', 'h', 'min="1" max="400" step="0.01"')}
              ${champ('retardMinimum', 'Un retard compte dès', `vide : dès la première minute ; ${st.retenirRetards ? 'retenu sur le salaire (la case ci-dessous)' : 'il se note, il ne se retient pas du salaire'}`, 'min', 'min="0" max="120" step="1"')}
              ${champ('hsArrondi', 'Heures sup des badges, arrondies à', 'vide : à la minute ; sinon au pas inférieur (15 : au quart d\'heure)', 'min', 'min="0" max="60" step="1"')}
            </div>
            <label class="pt-h-case" id="pt-h-ret"><input type="checkbox" name="retenirRetards" ${st.retenirRetards ? 'checked' : ''}><span><b>Retenir les retards sur le salaire</b><small class="muted">les minutes de retard du mois, au prix d'une heure de sa fiche (son brut divisé par les heures d'un mois complet), en une ligne du bulletin : le brut baisse, la CNSS et l'impôt suivent. Éteint : le retard se note, rien ne se retient. À VÉRIFIER : ce qui peut se retenir, avec ton comptable.</small></span></label>
            <fieldset class="pt-h-maj"><legend>Les majorations des heures sup <span class="muted small">À VÉRIFIER : le Code du travail et ta convention collective</span></legend>
              <div class="pt-h-g pt-h-g3">${[1, 2, 3].map(n => champ(`hsMaj${n}`, `Majoration ${n}`, n === 1 ? 'vide : pas d\'heures sup' : 'facultative', '%', 'min="0" max="300" step="1"')).join('')}</div></fieldset>
            ${/* (1.258.0) Les heures de nuit : vides, rien ne se compte ; la majoration à 0, elles se comptent sans rien ajouter. */''}
            <fieldset class="pt-h-maj" id="pt-h-nuit"><legend>Les heures de nuit <span class="muted small">À VÉRIFIER : la plage légale et la majoration (Code du travail, ta convention collective)</span></legend>
              <div class="pt-h-g pt-h-g3"><label class="field pt-h-f">${lbl('La nuit commence à')}<span class="pt-h-u"><input type="time" name="nuitDebut" data-t="La nuit commence à" value="${h(st.nuitDebut || '')}"></span><small class="muted">vide : les heures de nuit ne se comptent pas</small></label><label class="field pt-h-f">${lbl('Elle finit à')}<span class="pt-h-u"><input type="time" name="nuitFin" data-t="Elle finit à" value="${h(st.nuitFin || '')}"></span><small class="muted">le lendemain matin si elle passe minuit</small></label>
              ${champ('nuitMajoration', 'Leur majoration', 'vide : comptées, rien ne s\'ajoute au bulletin', '%', 'min="0" max="300" step="1"')}</div></fieldset>
            <div class="pt-h-pied"><span class="small muted" id="pt-h-etat">Les bulletins déjà établis ne changent pas ; ceux établis ensuite suivent ces horaires.</span><button type="button" class="btn" id="pt-h-annuler" disabled>Annuler</button><button type="button" class="btn btn-primary" id="pt-h-ok" disabled>${lfIc('coche', 15, 2.4)} Enregistrer les horaires</button></div>
          </form></section>
        ${ptEquipesHtml(st)}`;
      lierEquipes(() => drawPtHoraires());
      $('#pt-h-q').onclick = async () => { if (!await leaveOk()) return; clearGuard(); premiereFenetre(() => drawPtHoraires()); };
      const f = $('#pt-h');
      const lire = () => {
        const v = formValues(f), jours = $$('#pt-h [data-jour]').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => Number(b.dataset.jour));
        const out = { offDays: [0, 1, 2, 3, 4, 5, 6].filter(i => !jours.includes(i)) };
        ['workedDays', 'heuresMois', 'retardMinimum', 'hsArrondi', 'hsMaj1', 'hsMaj2', 'hsMaj3', 'nuitMajoration'].forEach(k => { out[k] = String(v[k] || '').trim() === '' ? 0 : Number(v[k]); });
        out.retenirRetards = !!($('#pt-h [name=retenirRetards]') || {}).checked;
        ['nuitDebut', 'nuitFin'].forEach(k => { out[k] = String(v[k] || '').trim(); });
        return { out, jours };
      };
      const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const initial = lire().out;
      const majDit = () => {
        const { out, jours } = lire(), change = !egal(out, initial);
        const bad = $$('#pt-h input').find(x => !x.checkValidity()) || (!(out.workedDays > 0) && $('#pt-h [name=workedDays]'));
        $('#pt-h-dit').textContent = !jours.length ? 'Choisis au moins un jour de travail.'
          : `${pl(jours.length, 'jour')} de travail par semaine ; repos : ${out.offDays.map(i => JOURS_SEM[i]).join(', ') || 'aucun'}.`;
        $('#pt-h-ok').disabled = !change || !jours.length || !!bad;
        $('#pt-h-annuler').disabled = !change;
        $('#pt-h-etat').textContent = bad ? (bad.name === 'workedDays' && !(out.workedDays > 0) ? 'Un mois complet compte au moins un jour.' : `${bad.dataset.t} : ${bad.validationMessage}`)
          : change ? 'Pas encore enregistré. Les bulletins déjà établis ne changeront pas.' : 'Les bulletins déjà établis ne changent pas ; ceux établis ensuite suivent ces horaires.';
        $('#pt-h-etat').classList.toggle('pt-h-mal', !!bad);
        if (change) reportDirty();
      };
      const garde = { dirty: () => !egal(lire().out, initial), what: 'les horaires', save: () => { enregistrer(); return true; } };
      setGuard(garde);
      const enregistrer = () => {
        const { out } = lire(), avant = data.payrollSettings ? JSON.parse(JSON.stringify(data.payrollSettings)) : undefined;
        data.payrollSettings = { ...(data.payrollSettings || {}), ...out };
        save(true); clearGuard(garde);
        return avant;
      };
      $$('#pt-h [data-jour]').forEach(b => b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); majDit(); });
      f.oninput = f.onchange = majDit;
      f.onsubmit = ev => ev.preventDefault();
      $('#pt-h-annuler').onclick = () => { clearGuard(garde); drawPtHoraires(); };
      $('#pt-h-ok').onclick = () => {
        if ($('#pt-h-ok').disabled) return;
        const avant = enregistrer();
        drawPtHoraires();
        toastUndo('Horaires enregistrés : le pointage les suit', () => { if (avant === undefined) delete data.payrollSettings; else data.payrollSettings = avant; save(true); drawPtHoraires(); });
      };
      majDit();
    }

    // (1.259.0) « Le mois » en relecture (la maquette) : où en est le mois, ce qui le bloque, ce qui change pour chacun.
    function ptProgresHtml(y, m) {
      const auj = C.today(), n = C.daysInMonth(y, m), st = C.payrollSettings(data), ym = ymPt(y, m), mois = MONTHS_LONG[m - 1];
      const off = Array.isArray(st.offDays) ? st.offDays : [0];
      const feries = (st.feries || []).filter(f => f && String(f.date).startsWith(ym));
      const ouvrables = Array.from({ length: n }, (_, k) => isoDe(y, m, k + 1)).filter(i => !off.includes(new Date(i + 'T00:00:00Z').getUTCDay()) && !feries.some(f => f.date === i)).length;
      const P = moisALaMain(y, m), J = Array.from({ length: n }, (_, k) => k + 1);
      const main = J.filter(d => travailleLe(P, d)), passes = main.filter(d => isoDe(y, m, d) <= auj), valides = passes.filter(d => jourValide(isoDe(y, m, d))).length;
      const avenir = (main.length ? main : J).filter(d => isoDe(y, m, d) > auj).length, nR = ptVerrouille(ym) ? 0 : aReglerMois(y, m).length;
      const ecoules = J.filter(d => isoDe(y, m, d) <= auj).length;
      const part = main.length ? Math.round(valides / main.length * 100) : Math.round(ecoules / n * 100);
      return `<section class="ptj-prog" id="pt-prog"><div class="ptj-prog-t"><b>${h(capi(mois))} ${y}</b><span class="mu">du 1er au ${n}${feries.length ? ` · ${h(feries.map(f => `le ${Number(f.date.slice(8, 10))} férié`).join(', '))}` : ''} · ${pl(ouvrables, 'jour ouvrable', 'jours ouvrables')}</span></div>
        <div class="ptj-barre-p" role="progressbar" aria-label="Journées du mois" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${part}"><i style="width:${part}%"></i></div>
        <span class="mu ptj-prog-d">${main.length ? `${valides ? pl(valides, 'journée validée', 'journées validées') : 'aucune journée validée'} sur ${main.length}` : 'à la pointeuse : les journées arrivent par les badges'}${avenir ? ` · ${avenir} à venir` : ''} · ${ptVerrouille(ym) ? 'validé' : nR ? `${pl(nR, 'chose')} à régler` : 'rien à régler'}</span>
        <span class="ptj-gestes"><button type="button" class="btn btn-sm" id="pt-periode" ${ptVerrouille(ym) ? 'disabled' : ''}>${lfIc('echeance', 14)} Une absence sur plusieurs jours</button>${ptVerrouille(ym) ? '' : ptValiderBoutonHtml(y, m)}</span></section>`;
    }
    function ptAReglerHtml(y, m) {
      const aR = aReglerMois(y, m), fin = isoDe(y, m, C.daysInMonth(y, m)), fini = fin <= C.today(), mois = MONTHS_LONG[m - 1];
      return aR.length ? `<section class="pa-carte" id="pt-aregler"><div class="pa-carte-t"><b>À régler</b><span class="mu">${pl(aR.length, 'chose')} · tout ce qui bloque le mois, au même endroit · chacune avec son bouton</span></div><ul class="apy-l pt-an">${aR.map(x => x.html).join('')}</ul></section>`
        : `<div class="bandeau ok pa-bandeau" id="pt-aregler-ok">${lfIc('coche', 18, 2.4)}<span class="txt"><b>${fini ? `Rien à régler : le pointage ${h(deMois(mois))} est prêt` : 'Rien à régler pour l\'instant'}</b><span>${fini ? 'Valider le mois fige ce que ses bulletins reprendront ; une correction fera une nouvelle version.' : `Les journées jusqu'au ${h(jjmm(fin))} restent à vivre, chaque soir ; le mois se valide après sa dernière journée.`}</span></span></div>`;
    }
    // Ce qui change en un mois, salarié par salarié : seulement les écarts (le reste est présent, à ses horaires), et ce
    // que le bulletin en fera. Une ligne ouvre son mois jour par jour (« Par salarié »).
    function ptEcartsHtml(y, m, lignes) {
      if (!lignes.length) return `<div class="empty">Aucun salarié en poste en ${h(MONTHS_LONG[m - 1])} ${y}.</div>`;
      const st = C.payrollSettings(data), cur = company().currency, ym = ymPt(y, m), an = C.anomaliesPointage(data, y, m, C.today());
      const puces = (e, p) => {
        const L = [], brut = C.brutDuMois(e, y, m) || Number(e.grossSalary) || 0, un = C.round3(brut / (Number(p.total) || 26));
        const de = c => p.jours.filter(j => !j.repos && j.code === c).map(j => j.jour);
        // (1.355.0) Entré le 1er (ou parti le dernier jour), le mois est payé en entier : « au prorata » disait le contraire.
        const entier = Number(p.payes) >= Number(p.total);
        if (e.hireDate && e.hireDate.startsWith(ym)) L.push(['', `entrée le ${jjmm(e.hireDate)}`, `${pct(p.payes)} jours payés sur ${pct(p.total)}`, entier ? 'mois entier' : 'au prorata']);
        if (e.endDate && e.endDate.startsWith(ym)) L.push(['', `départ le ${jjmm(e.endDate)}`, `${pct(p.payes)} jours payés sur ${pct(p.total)}`, entier ? 'mois entier' : 'au prorata']);
        an.filter(a => a.employeeId === e.id).forEach(a => L.push(['alerte', a.sorte === 'sortie' ? 'sortie oubliée' : 'jours sans badge', a.sorte === 'sortie' ? `le ${String(a.jour).padStart(2, '0')}/${String(m).padStart(2, '0')}` : datesDites(a.jours, m), 'à régler']));
        const A = de('A'), D = de('D'), Co = de('C'), Ma = de('M');
        if (A.length) L.push(['', `absent ${pl(A.length, 'jour')}`, datesDites(A, m), `− ${C.money(C.round3(un * A.length), cur)}`]);
        if (D.length) L.push(['', pl(D.length, 'demi-journée', 'demi-journées'), datesDites(D, m), `− ${C.money(C.round3(un * D.length / 2), cur)}`]);
        if (Co.length) L.push(['', `congé ${pl(Co.length, 'jour')}`, datesDites(Co, m), 'payé']);
        if (Ma.length) L.push(['', `malade ${pl(Ma.length, 'jour')}`, datesDites(Ma, m), 'certificat (À VÉRIFIER : la CNAM)']);
        const R = p.jours.filter(j => j.retard);
        if (R.length) { const rt = st.retenirRetards ? C.retardsDuMois(data, e, y, m, p) : []; L.push(['', `${pl(R.length, 'retard')} · ${R.reduce((a, j) => a + j.retard, 0)} min`, datesDites(R.map(j => j.jour), m), rt.length ? `− ${C.money(Math.abs(rt[0].amount), cur)}` : 'pas retenus']); }
        C.heuresSupDuMois(data, e, y, m).forEach(b => L.push(['attire', `+ ${pct(b.heures)} h sup`, `à +${pct(b.hs)} %`, `+ ${C.money(b.amount, cur)}`]));
        const nt = C.heuresDeNuitDuMois(data, e, y, m, p);
        if (nt.reglee && nt.minutes) L.push(['', `${pct(C.round3(nt.minutes / 60))} h de nuit`, `de ${st.nuitDebut} à ${st.nuitFin}`, nt.lignes.length ? `+ ${C.money(nt.lignes[0].amount, cur)}` : 'comptées']);
        const t = C.pointageEnregistre(data, e.id, y, m), sm = t && t.badges ? Object.values(t.badges).filter(b => b.sortieMain).length : 0;
        if (sm) L.push(['', `${pl(sm, 'sortie posée', 'sorties posées')} à la main`, 'un oubli de badge', '']);
        return L;
      };
      return `<section class="pa-carte" id="pt-exc"><div class="pa-carte-t"><b>Ce qui change en ${h(MONTHS_LONG[m - 1])}</b><span class="mu">seulement les écarts : le reste est présent, à ses horaires · ce que le bulletin en fera</span><button type="button" class="btn btn-sm" id="pt-vue-grille">${lfIc('grille', 14)} Vue grille</button></div>
        <ul class="ptj-ex">${lignes.map(({ e, p }) => { const L = puces(e, p), q = C.equipeDe(st, e); return `<li class="clickable" data-pt-son="${h(e.id)}" tabindex="0" title="Son mois, jour par jour">${avPaie(e)}<span class="ptj-n"><b>${h(e.name)}</b><small>${h(q ? q.nom : (e.position || '—'))}</small></span>
          <span class="ptj-chips">${L.length ? L.map(([tn, b, sm, i]) => `<span class="ptj-chip ${tn}"><b>${h(b)}</b><small>${h(sm)}</small>${i ? `<i>${h(i)}</i>` : ''}</span>`).join('') : '<span class="ptj-chip ghost"><b>présent, à ses horaires</b><small>rien ne change</small></span>'}</span>
          <span class="ptj-payes"><b>${pct(p.payes)} j</b><small>payés</small></span></li>`; }).join('')}</ul></section>`;
    }
    // (plateforme) 1.60.0 — le pointage du mois. Une case par salarié et par jour : un clic change le code (dans l'ordre
    // de la légende), une lettre le pose, les flèches passent d'une case à l'autre. Les jours payés et les absences se
    // recalculent à chaque geste ; un bulletin déjà établi qui ne suit plus le pointage le dit, et se met à jour d'un geste.
    function drawPointage(focus) {
      const y = Number(s.ptY), m = Number(s.ptM);
      const st = C.payrollSettings(data);
      const n = C.daysInMonth(y, m);
      const premier = `${y}-${String(m).padStart(2, '0')}-01`;
      const dernier = C.addDays(premier, n - 1);
      const emps = data.employees.filter(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier))
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      const majorations = C.majorationsHs(st);
      const INITIALES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
      const lignes = emps.map(e => ({ e, p: C.pointageDuMois(data, e, y, m) }));
      const affiche = c => c === 'D' ? '½' : c === '-' ? '·' : c;
      const ecarts = C.payslipsOf(data, y, m).map(x => ({ x, r: C.pointageSurBulletin(data, x) })).filter(o => o.r && o.r.change);
      const mois = MONTHS_LONG[m - 1];
      const estAuj = j => `${y}-${String(m).padStart(2, '0')}-${String(j.jour).padStart(2, '0')}` === C.today();
      // « Aujourd'hui : qui n'est pas là ? » ne vaut que sur le mois du jour : ailleurs, il parlait d'un autre mois.
      // Le mois du jour s'ouvre ; si la paie en cours est celle d'un autre mois (octobre, le 2 novembre), on y va d'un clic.
      const mp = C.moisDePaie(data), ymPaie = `${mp.year}-${String(mp.month).padStart(2, '0')}`;
      const versPaie = ymPaie !== ptYm() && (C.payslipsOf(data, mp.year, mp.month).some(x => !x.paidDate) || C.missingPayslips(data, mp.year, mp.month).length > 0)
        ? `<div class="bandeau gris pa-bandeau pa-gris pt-vers-paie" id="pt-paie">${lfIc('echeance', 18)}<span class="txt"><b>La paie en cours est celle ${/^[aeiouyéè]/i.test(MONTHS_LONG[mp.month - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[mp.month - 1])}</b><span>Ses bulletins reprennent son pointage : vérifie-le avant de les établir.</span></span><button type="button" class="btn btn-sm" id="pt-paie-go" data-ym="${ymPaie}">Voir le pointage ${/^[aeiouyéè]/i.test(MONTHS_LONG[mp.month - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[mp.month - 1])}</button></div>` : '';
      const verrou = ptVerrouille(ymPt(y, m));
      const ecartsBox = ecarts.length ? `<div class="warn-box" id="pt-ecarts">${ecarts.map(({ x, r }) => `<div class="ctrl-geste"><span>Le bulletin de <b>${h(x.employeeName)}</b> ne suit plus le pointage : ${ecartDit(r)}.${x.paidDate ? ' Il est déjà payé : son net changera.' : ''}</span><button type="button" class="btn btn-sm" data-pt-reprendre="${h(x.id)}">Reprendre le pointage dans le bulletin</button></div>`).join('')}</div>` : '';
      const grilleHtml = `<div class="bandeau gris pa-bandeau pa-gris" id="pt-grille-b">${lfIc('grille', 18)}<span class="txt"><b>La vue grille : pour relire d'un coup d'œil, ou pour ton cabinet</b><span>Le soir, on pointe dans « La journée » ; ici, une case ouvre ce jour-là pour ce salarié, et sa lettre au clavier le pose d'un coup.</span></span><button type="button" class="btn btn-sm" id="pt-vue-ecarts">Revenir aux écarts</button></div>
        <section class="pa-carte" id="pt-panneau"><div class="pa-carte-t"><b>Le pointage ${/^[aeiouyéè]/i.test(mois) ? 'd\'' : 'de '}${h(mois)} ${info('pay.pointage')}</b><span class="mu">un clic sur une case dit ce que chaque choix fait ; sa lettre au clavier la pose d'un coup ; les flèches passent d'une case à l'autre ; une case vide : présent</span>
</div>
          ${/* (plateforme) 1.234.0 — la grille comme sa maquette : une case vide est un jour de présence (la lettre reste, pour le
               clavier et les lecteurs d'écran), le repos en colonne grise, l'avatar devant le nom, les totaux à droite, la légende
               dessous. Les heures sup restent avant les jours : Tab y passe au 1er du mois, comme dans un tableur. */''}
          ${lignes.length ? `<div class="scroll-x"><table class="list compact pt-grille pt-grille-m" id="pt-grille"><thead><tr><th>Salarié</th>
            ${majorations.map(x => `<th class="r nw pt-hs-h">HS +${pct(x)} %</th>`).join('')}
            ${/* (1.251.0) Aujourd'hui se voit : sa colonne porte « auj. » et une teinte de haut en bas (Skander, 02/11 : « on ne sait
                 pas quel jour on est »). */''}${lignes[0].p.jours.map(j => estAuj(j) ? `<th class="pt-j pt-auj-j${j.repos ? ' pt-repos' : ''}${jourValide(`${ymPt(y, m)}-${String(j.jour).padStart(2, '0')}`) ? ' pt-jv' : ''}" aria-current="date" title="Aujourd'hui${jourValide(`${ymPt(y, m)}-${String(j.jour).padStart(2, '0')}`) ? ', journée validée' : ''}"><span>auj.</span><b>${j.jour}</b></th>` : `<th class="pt-j${j.repos ? ' pt-repos' : ''}${jourValide(`${ymPt(y, m)}-${String(j.jour).padStart(2, '0')}`) ? ' pt-jv' : ''}"${jourValide(`${ymPt(y, m)}-${String(j.jour).padStart(2, '0')}`) ? ' title="Journée validée"' : ''}><span>${INITIALES[j.wd]}</span>${j.jour}</th>`).join('')}
            <th class="r pt-tot" title="Le mois complet des barèmes, moins les jours hors contrat et les absences non payées : les jours du bulletin">Payés</th><th class="r nw">Non payés</th></tr></thead><tbody>
            ${lignes.map(({ e, p }) => `<tr data-pe="${h(e.id)}"><td class="nw pt-nom"><span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}" data-ini="${h(C.initialesDe(e.name || ''))}" aria-hidden="true"></span><strong>${h(e.name)}</strong></td>
              ${majorations.map(x => `<td class="r"><input type="number" class="num pt-hs" data-hs="${x}" value="${p.hs[String(x)] || ''}" min="0" step="0.5" placeholder="0" ${ptVerrouille(ymPt(y, m)) ? 'readonly title="Le pointage est validé : « Corriger : une nouvelle version » le rouvre"' : ''} aria-label="${h(e.name)} : heures supplémentaires à +${pct(x)} %"></td>`).join('')}
              ${p.jours.map(j => `<td class="pt-td${j.repos ? ' pt-rep' : ''}${estAuj(j) ? ' pt-auj-td' : ''}"><button type="button" class="pt-c pt-${j.code === '-' ? 'hors' : j.code}${j.source === 'pointe' ? ' pt-main' : ''}${j.retard ? ' pt-retard' : ''}" data-pt="${j.jour}"${j.repos ? ' data-repos="1"' : ''} ${j.code === '-' ? 'disabled' : ''} title="${h(libellePt(j))}" aria-label="${h(e.name)}, ${j.jour} ${h(mois)} : ${h(libellePt(j))}">${affiche(j.code)}</button></td>`).join('')}
              <td class="r nw pt-tot"><strong data-pt-payes>${pct(p.payes)}</strong> j</td><td class="r nw" data-pt-abs>${p.absences ? pct(p.absences) : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}</tbody></table></div>`
            : `<div class="empty">Aucun salarié en poste en ${h(mois)} ${y}.</div>`}
          ${lignes.length ? `<ul class="pt-tel" id="pt-tel">${lignes.map(({ e, p }) => `<li><span class="pa-av" style="--c:${h(C.couleurDe(e.name || ''))}" aria-hidden="true">${h(C.initialesDe(e.name || ''))}</span><span class="pt-tel-n"><b>${h(e.name)}</b><small>${pct(p.payes)} j payés${p.absences ? ` · ${pct(p.absences)} non payé${p.absences > 1 ? 's' : ''}` : ''}</small></span><button type="button" class="btn btn-sm" data-pt-tel="${h(e.id)}">Son mois</button></li>`).join('')}</ul>` : ''}
          <div class="pt-legende">${C.CODES_POINTAGE.filter(([c]) => c !== 'P').map(([c, l]) => `<span class="pt-cle"><span class="pt-c pt-${c}" aria-hidden="true">${affiche(c)}</span>${h(l)}</span>`).join('')}<span class="pt-cle"><span class="pt-c pt-P pt-vide" aria-hidden="true"></span>Présent (case vide)</span><span class="pt-cle"><span class="pt-c pt-hors" aria-hidden="true">·</span>Hors contrat</span><span class="pt-cle"><span class="pt-c pt-P pt-vide pt-retard" aria-hidden="true"></span>Un retard</span></div>
          ${/* Sous la grille : apparue au-dessus, l'alerte poussait toutes les cases sous la souris (vu à l'écran). */''}
          ${majorations.length ? '' : `<p class="small muted mt" id="pt-sans-hs">Pour pointer des heures supplémentaires, règle d'abord leurs majorations dans les horaires. <em>À VÉRIFIER : le Code du travail et ta convention collective.</em> <button type="button" class="btn btn-sm" id="pt-baremes">Régler les heures sup</button></p>`}
          <p class="small muted pa-note-c">Un bulletin établi après le pointage reprend ses absences non payées et ses heures supplémentaires ; les primes au jour suivent les jours payés.</p>
        </section>${ecartsBox}${ptTotauxHtml(y, m)}`;
      $('#p-body').innerHTML = `${versPaie}${ptValideHtml(y, m)}${verrou ? '' : ptPointeuseHtml(y, m)}${ptProgresHtml(y, m)}${verrou ? '' : ptAReglerHtml(y, m)}${s.ptGrille ? grilleHtml : `${ptEcartsHtml(y, m, lignes)}${ecartsBox}${ptTotauxHtml(y, m, true)}`}${variablesCarte(y, m)}`;
      lierValide(y, m, () => drawPointage());
      lierARegler(y, m, () => drawPointage());
      majNbSous();
      ptRedessin = () => drawPointage();
      if ($('#pt-vue-grille')) $('#pt-vue-grille').onclick = () => { s.ptGrille = true; drawPointage(); const c = $('#pt-grille .pt-c[data-pt]:not([disabled])'); if (c) c.focus(); };
      if ($('#pt-vue-ecarts')) $('#pt-vue-ecarts').onclick = () => { s.ptGrille = false; drawPointage(); };
      $$('#pt-exc [data-pt-son]').forEach(li => { const go = () => { s.ptSal = li.dataset.ptSon; allerVue('pt-salarie'); }; li.onclick = go; li.onkeydown = ev => { if (ev.key === 'Enter') go(); }; });
      $$('#pt-tel [data-pt-tel]').forEach(b2 => b2.onclick = () => { s.ptSal = b2.dataset.ptTel; allerVue('pt-salarie'); });
      if ($('#pv-carte-ouvrir')) $('#pv-carte-ouvrir').onclick = () => variablesFenetre(y, m, () => drawPointage());
      lierPointeuse(y, m, () => drawPointage());
      $('#pt-periode').onclick = () => ptPeriodeFenetre(null, () => drawPointage(), jourDuMoisRegarde(y, m));
      // « Ouvrir les Barèmes » amène à la case à remplir, pas en haut d'une longue page (vu à l'écran).
      // Le changement d'onglet attend (une saisie à garder ?) : le curseur se pose une fois les Barèmes dessinés.
      // (1.249.0) Les majorations se règlent dans « Les horaires », juste à côté : le curseur s'y pose.
      if ($('#pt-baremes')) $('#pt-baremes').onclick = async () => {
        await allerVue('pt-horaires');
        const c = $('#pt-h input[name="hsMaj1"]'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); c.select(); }
      };
      if ($('#pt-paie-go')) $('#pt-paie-go').onclick = () => { const ym = $('#pt-paie-go').dataset.ym; s.year = ym.slice(0, 4); s.month = String(Number(ym.slice(5, 7))); s.moisTouche = true; draw(); };
      const peutPointer = () => {
        // (1.259.0) Le mois verrouillé refuse ici ; la journée validée, chaque case la vérifie pour SON jour (cliquer le 01
        // disait « la journée du 31 est validée »).
        if (ptVerrouille(ymPt(y, m)) && !peutPointerLe(dernier)) return false;
        if (enLecture('timesheets')) { toast(refusLecture('timesheets'), true); return false; }
        if (closedBlock(dernier, 'Ce pointage')) return false;
        if (!(data.timesheets || []).length && faitBloque('Pointer les salariés')) return false;
        return true;
      };
      const poser = (b, code) => {
        const e = employeeById(b.closest('tr').dataset.pe);
        if (!e || !peutPointer() || !peutPointerLe(`${ymPt(y, m)}-${String(b.dataset.pt).padStart(2, '0')}`)) return;
        if (!C.poserPointage(data, e, y, m, Number(b.dataset.pt), code)) {
          if (b.dataset.repos) toast(`Le ${b.dataset.pt} ${mois} est un jour de repos : il se pointe « Repos », ou « Présent » s'il a été travaillé (ses heures vont en heures supplémentaires).`, true);
          return;
        }
        save();
        drawPointage({ e: e.id, d: Number(b.dataset.pt) });
      };
      const ORDRE = C.CODES_POINTAGE.map(x => x[0]);
      $$('#pt-grille .pt-c[data-pt]').forEach(b => {
        // Un jour de repos ne passe que de « Repos » à « Présent » et retour : sa case n'offre que ces deux-là, et une
        // lettre d'absence tapée dessus se refuse dans `poser`, qui le dit.
        // (1.257.0) Un clic ouvre la case (ce que chaque choix fait) ; les lettres au clavier posent le code d'un coup.
        b.onclick = () => { const e = employeeById(b.closest('tr').dataset.pe); if (!e || !peutPointer()) return; caseFenetre(e, y, m, Number(b.dataset.pt), () => drawPointage({ e: e.id, d: Number(b.dataset.pt) })); };
        b.onkeydown = ev => {
          const k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
          if (ORDRE.includes(k)) { ev.preventDefault(); poser(b, k); return; }
          const pas = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
          if (!pas) return;
          ev.preventDefault();
          const tr = b.closest('tr');
          const ligne = pas[0] ? (pas[0] < 0 ? tr.previousElementSibling : tr.nextElementSibling) : tr;
          if (!ligne) return;
          const cases = [...ligne.querySelectorAll('.pt-c[data-pt]')];
          let d = Number(b.dataset.pt) + pas[1];
          let cible = cases.find(x => Number(x.dataset.pt) === d);
          // Un jour hors contrat ne se pointe pas : on le saute.
          while (cible && cible.disabled) { d += pas[1] || 1; cible = cases.find(x => Number(x.dataset.pt) === d); }
          if (cible) cible.focus();
        };
      });
      $$('#pt-grille .pt-hs').forEach(i => i.onchange = () => {
        const e = employeeById(i.closest('tr').dataset.pe);
        if (!e || !peutPointer()) { drawPointage(); return; }
        if (i.value !== '' && !(Number(i.value) >= 0)) return refus(i, 'Un nombre d\'heures se tape en chiffres : 6, ou 7,5.');
        C.poserHeuresSup(data, e, y, m, Number(i.dataset.hs), i.value);
        save();
        // La grille se redessine APRÈS que Tab a posé le curseur, et le lui rend : sinon la case suivante disparaissait
        // sous les doigts, et ce qu'on tapait ensuite n'allait nulle part (vu à l'écran).
        setTimeout(() => drawPointage(ouEstLeCurseur()), 0);
      });
      // Comme dans un tableur : Entrée ou ↓ passe au salarié suivant, dans la même colonne ; ↑ au précédent.
      $$('#pt-grille .pt-hs').forEach(i => i.onkeydown = ev => {
        const pas = ev.key === 'ArrowDown' || ev.key === 'Enter' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
        if (!pas) return;
        ev.preventDefault();
        const tr = i.closest('tr'), autre = pas > 0 ? tr.nextElementSibling : tr.previousElementSibling;
        const c = autre && autre.querySelector(`.pt-hs[data-hs="${i.dataset.hs}"]`);
        if (c) { c.focus(); c.select(); } else i.blur();
      });
      $$('#p-body [data-pt-reprendre]').forEach(b => b.onclick = async () => {
        const x = payslipById(b.dataset.ptReprendre); if (!x) return;
        const emp = employeeById(x.employeeId); if (!emp) return;
        if (closedBlock(C.payslipDate(x), 'Ce bulletin')) return;
        if (enLecture('payslips')) { toast(refusLecture('payslips'), true); return; }
        if (x.paidDate && !await confirmDialog(`Le bulletin de ${emp.name} est déjà payé. Reprendre le pointage change son net : continuer ?`, 'Reprendre le pointage')) return;
        const r = C.pointageSurBulletin(data, x); if (!r) return;
        const input = { year: x.year, month: x.month, gross: x.gross, workedDays: x.workedDays, absentDays: r.absentDays, bonuses: r.bonuses, deductions: x.deductions || [] };
        const juge = C.saisiePaieValide(input, emp, st);
        if (!juge.ok) return toast(juge.motif, true);
        Object.assign(x, { absentDays: r.absentDays, bonuses: r.bonuses, computed: C.computePayslip(emp, input, st) });
        save(true);
        toast(`Bulletin de ${emp.name} mis à jour sur le pointage`);
        drawPointage();
      });
      if (focus) {
        const c = $(`#pt-grille tr[data-pe="${focus.e}"] ${focus.hs ? `.pt-hs[data-hs="${focus.hs}"]` : `.pt-c[data-pt="${focus.d}"]`}`);
        if (c) { c.focus(); if (focus.hs) c.select(); }
      }
      majTeteDuMois();
    }
    // La case de la grille où est le curseur, pour la lui rendre après un redessin.
    const ouEstLeCurseur = () => {
      const a = document.activeElement, tr = a && a.closest && a.closest('#pt-grille tr[data-pe]');
      if (!tr) return null;
      return a.dataset.hs ? { e: tr.dataset.pe, hs: a.dataset.hs } : a.dataset.pt ? { e: tr.dataset.pe, d: Number(a.dataset.pt) } : null;
    };
    const ecartDit = r => [r.absences ? `${pct(r.avant)} jour${sPl(r.avant)} non payé${sPl(r.avant)} au bulletin, ${pct(r.absentDays)} au pointage` : '',
      r.heures ? 'pas les mêmes heures supplémentaires' : '', !r.absences && !r.heures ? 'ses primes au jour ne suivent plus les jours payés' : ''].filter(Boolean).join(' ; ');
    const libellePt = j => C.libellePointage(j.code) + (j.source === 'conge' ? ' (Congés et absences)' : j.source === 'pointe' ? ' (pointé)' : j.source === 'ferie' ? ` (${j.ferie || 'la liste des fériés'})` : '') + (j.retard ? `, ${j.retard} min de retard` : '');

    // (plateforme) 1.225.0 — la liste des salariés telle que sa maquette : en poste ou partis, une recherche (nom, CIN, CNSS,
    // poste), ce qui manque dit sur la ligne (CNSS, RIB), le CDD qui finit en bandeau, la ligne ouvre la fiche.
    function drawEmployees() {
      const st = C.payrollSettings(data), auj = C.today();
      const parti = e => !!(e.endDate && e.endDate < auj) || e.active === false;
      const filtre = s.fsal || 'poste', q = (s.qsal || '').trim().toLowerCase();
      const tous = data.employees.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      const enPoste = tous.filter(e => !parti(e)), partis = tous.filter(parti);
      const txt = e => [e.name, e.cin, e.cnss, e.position].filter(Boolean).join(' ').toLowerCase();
      const list = (filtre === 'sortis' ? partis : enPoste).filter(e => !q || txt(e).includes(q));
      const salPage = paginate(list, s.salaries);
      const traiter = C.paieATraiter(data, auj).filter(x => x.vue === 'salaries');
      const cdd = traiter.find(x => /CDD/.test(x.titre));
      // Le net et le coût s'estiment avec les primes de la fiche (comme le bulletin qu'elle établirait).
      const estime = e => C.computePayslip(e, C.saisieDeLaFiche(e, st), st);
      const contrat = e => { const k = (C.contractLabel(e.contract || 'cdi') || '').split(' —')[0]; return e.contract === 'cdd' && e.endDate ? `${k} · jusqu'au ${C.fmtDate(e.endDate)}` : k; };
      const aDemander = '<span class="statut attire">à demander</span>';
      // (1.248.1) Le même n° CNSS ou le même RIB sur deux fiches en poste se voit dans la liste (recette du 02/11).
      const nu = v => String(v || '').replace(/[\s-]/g, '');
      const enDouble = (e, k) => nu(e[k]) && enPoste.filter(x => nu(x[k]) === nu(e[k]) && (k !== 'iban' || (x.method || 'virement') !== 'especes')).length > 1;
      const double = ' <span class="statut alerte" title="Le même numéro que sur une autre fiche : à vérifier">en double</span>';
      const lig = e => `<tr class="clickable" data-eid="${h(e.id)}" tabindex="0"><td class="pa-cl">${avPaie(e)}<span><b>${h(e.name)}</b><small>${h([e.position, e.hireDate ? `depuis le ${C.fmtDate(e.hireDate)}` : ''].filter(Boolean).join(' · ') || 'poste à préciser')}</small></span></td>
        <td>${h(contrat(e))}</td>
        <td class="nw mono">${e.cnss ? h(e.cnss) + (enDouble(e, 'cnss') ? double : '') : aDemander}</td>
        <td class="nw mono">${(e.method || 'virement') === 'especes' ? '<span class="muted">espèces</span>' : e.iban ? `··· ${h(String(e.iban).replace(/\s/g, '').slice(-4))}${enDouble(e, 'iban') ? double : ''}` : aDemander}</td>
        ${(c => `<td class="r nw">${C.money(e.grossSalary, '')}${c.bonuses.length ? `<small>+ ${C.money(C.round3(c.bonuses.reduce((a, b) => a + b.amount, 0)), '')} de primes</small>` : ''}</td><td class="r nw"><b>${C.money(c.employerCost, '')}</b><small>par mois · net ${C.money(c.net, '')}</small></td></tr>`)(estime(e))}`;
      const ligP = e => `<tr class="clickable" data-eid="${h(e.id)}" tabindex="0"><td class="pa-cl">${avPaie(e)}<span><b>${h(e.name)}</b><small>${h(e.position || '—')}</small></span></td>
        <td>${h(contrat(e))}</td><td class="nw">${e.endDate ? `parti le ${C.fmtDate(e.endDate)}` : 'n\'est plus en poste'}</td>
        <td class="small muted">${pl(C.payslipsOf(data).filter(x => x.employeeId === e.id).length, 'bulletin')} gardé${C.payslipsOf(data).filter(x => x.employeeId === e.id).length > 1 ? 's' : ''}, sans limite de durée</td></tr>`;
      $('#p-body').innerHTML = `
        <div class="pa-filtres"><div class="pa-seg filtre pa-seg-p" role="group" aria-label="Quels salariés">${[['poste', 'En poste', enPoste.length], ['sortis', 'Partis', partis.length]].map(([k, n, nb]) => `<button type="button" data-fsal="${k}" aria-pressed="${filtre === k}" class="${filtre === k ? 'active' : ''}">${n} <small>${nb}</small></button>`).join('')}</div>
          <label class="pa-rech">${lfIc('recherche', 15)}<input type="search" id="sal-q" value="${h(s.qsal || '')}" placeholder="Un nom, un CIN, un n° CNSS, un poste" aria-label="Chercher un salarié"></label></div>
        ${filtre === 'poste' && cdd ? `<div class="bandeau ambre pa-bandeau pa-ambre" id="sal-cdd">${lfIc('echeance', 18)}<span class="txt"><b>${h(cdd.titre)}</b><span>Le renouveler, ou préparer sa sortie : son solde de tout compte et son certificat de travail se font sur sa fiche.</span></span><button type="button" class="btn btn-sm" data-eid-go="${h(cdd.salarie)}">Ouvrir sa fiche</button></div>` : ''}
        <section class="pa-carte" id="sal-liste">${list.length ? `<div class="scroll-x"><table class="list compact pa-liste"><thead><tr>
          ${filtre === 'sortis' ? '<th>Salarié</th><th>Contrat</th><th>Son départ</th><th>Son dossier</th>'
            : `<th>Salarié</th><th>Contrat</th><th>N° CNSS</th><th>RIB</th><th class="r">Brut de base</th><th class="r">Coût ${info('pay.employerCost')}</th>`}</tr></thead><tbody>
          ${salPage.rows.map(filtre === 'sortis' ? ligP : lig).join('')}</tbody>
          ${filtre === 'sortis' ? '' : `<tfoot><tr class="total-row pa-pied"><td colspan="4"><b>${enPoste.length} en poste</b><span class="mu">${traiter.length ? `${pl(new Set(traiter.map(x => x.salarie)).size, 'fiche')} à compléter` : 'rien à compléter'} · ${(n => n ? `${pl(n, 'départ')} en ${auj.slice(0, 4)}` : `aucun départ en ${auj.slice(0, 4)}`)(partis.filter(e => (e.endDate || '').slice(0, 4) === auj.slice(0, 4)).length)}</span></td>
            <td class="r nw"><b>${C.money(C.round3(enPoste.reduce((a, e) => a + (Number(e.grossSalary) || 0), 0)), '')}</b></td><td class="r nw"><b>${montantU(C.round3(enPoste.reduce((a, e) => a + estime(e).employerCost, 0)), cur)}</b></td></tr></tfoot>`}</table></div>${pagerBar(salPage.pg, { noun: 'salarié' })}`
          : `<div class="empty">${q ? `Aucun salarié ne répond à « ${h(s.qsal)} ».` : filtre === 'sortis' ? 'Aucun salarié parti.' : 'Aucun salarié en poste.'}</div>`}</section>
        <p class="small muted pa-note">Le coût est ce que le salarié coûte vraiment : le brut plus les charges de l'employeur. Le registre du personnel (la liste que l'inspection du travail peut demander) est dans le menu ⋯, et les documents de chacun sur sa fiche.</p>`;
      $$('#p-body tr[data-eid]').forEach(tr => { tr.onclick = () => navigate('#/salarie/' + tr.dataset.eid); tr.onkeydown = ev => { if (ev.key === 'Enter') navigate('#/salarie/' + tr.dataset.eid); }; });
      $$('#p-body [data-eid-go]').forEach(b => b.onclick = () => navigate('#/salarie/' + b.dataset.eidGo));
      $$('#p-body [data-fsal]').forEach(b => b.onclick = () => { s.fsal = b.dataset.fsal; s.salaries.page = 1; drawEmployees(); });
      $('#sal-q').oninput = ev => { s.qsal = ev.target.value; s.salaries.page = 1; const pos = ev.target.selectionStart; drawEmployees(); const i2 = $('#sal-q'); i2.focus(); i2.setSelectionRange(pos, pos); };
      bindPager($('#p-body'), s.salaries, () => drawEmployees(), '#p-body');
    }

    // (plateforme) 1.226.0 — les demandes de congé à répondre, et le calendrier du mois : qui est absent, quel jour.
    function congesDemandes() {
      const D = (data.leaves || []).filter(l => l.statut === 'demande').sort((a, b) => (a.from || '').localeCompare(b.from || ''));
      if (!D.length) return '';
      const st = C.payrollSettings(data);
      return `<section class="pa-carte" id="cg-demandes"><div class="pa-carte-t"><b>${pl(D.length, 'demande')} de congé à répondre</b><span class="mu">ta réponse reste écrite ici, avec sa date ; rien ne compte avant</span></div>
        <ul class="pa-l">${D.map(l => { const e = employeeById(l.employeeId) || {}, j = C.workingDays(l.from, l.to, st.offDays), b = C.leaveBalance(data, l.employeeId, Number(String(l.from).slice(0, 4)));
          const sans = l.kind === 'conges' ? Math.max(0, C.round3(j - Math.max(0, b.remaining))) : 0;
          return `<li data-dem="${h(l.id)}">${avPaie(e)}<span class="pa-n"><b>${h(e.name || '')} : du ${C.fmtDate(l.from)} au ${C.fmtDate(l.to)} · ${pl(j, 'jour')}</b><small>${l.demandeLe ? `demandé le ${C.fmtDate(l.demandeLe)} · ` : ''}${(() => { const r = manqueEquipe(l.employeeId, l.from, l.to); return r ? `<span class="warn-text pa-dem-min">${h(manqueDit(r))}</span> · ` : ''; })()}${l.kind === 'conges' ? `il lui reste ${pct(b.remaining)} jour${sPl(b.remaining)}${sans > 0 ? ` : ${pct(sans)} jour${sPl(sans)} seraient sans solde, soit − ${C.money(C.round3((C.brutDuMois(e, Number(String(l.from).slice(0, 4)), Number(String(l.from).slice(5, 7))) || Number(e.grossSalary) || 0) / (Number(st.workedDays) || 26) * sans), cur)} sur son bulletin de ${h(MONTHS_LONG[Number(String(l.from).slice(5, 7)) - 1])}` : ''}` : h(l.note || '')}</small></span>
            <span class="pa-dem-g"><button type="button" class="btn btn-sm" data-dem-non="${h(l.id)}">Refuser…</button><button type="button" class="btn btn-sm" data-dem-mod="${h(l.id)}">D'autres dates…</button><button type="button" class="btn btn-sm pa-oui" data-dem-oui="${h(l.id)}">${lfIc('coche', 14, 2.4)} ${sans > 0 ? (sans >= j ? 'Accepter sans solde' : `Accepter : ${pct(C.round3(j - sans))} payés, ${pct(sans)} sans solde`) : 'Accepter'}</button></span></li>`; }).join('')}</ul></section>`;
    }
    function congesCalendrier(y, m) {
      const n = C.daysInMonth(y, m), premier = `${y}-${String(m).padStart(2, '0')}-01`, dernier = C.addDays(premier, n - 1);
      const emps = data.employees.filter(e => (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
      if (!emps.length) return '';
      const dem = (data.leaves || []).filter(l => l.statut === 'demande');
      const L = 'DLMMJVS';
      const cel = (e, j) => {
        if (j.code === '-') return '<td class="cg-h"></td>';
        const d = dem.find(l => l.employeeId === e.id && l.from <= j.iso && j.iso <= l.to);
        if (d && !j.repos) return '<td><i class="cg-d" title="demandé, pas encore accepté">D</i></td>';
        if (j.repos) return '<td class="cg-r"></td>';
        const t = { C: ['cg-c', 'congé payé'], M: ['cg-m', 'maladie'], A: ['cg-a', 'absent, non payé'], D: ['cg-a', 'demi-journée'], F: ['cg-c', 'jour férié'] }[j.code];
        // (1.250.0) Une case libre se clique : la fenêtre du congé s'ouvre à ce jour, pour ce salarié.
        return t ? `<td><i class="${t[0]}" title="${t[1]}">${j.code === 'D' ? '½' : j.code}</i></td>`
          : `<td class="cg-libre"><button type="button" data-cg-j="${h(e.id)}|${j.iso}" aria-label="${h(e.name)}, ${j.jour} ${h(MONTHS_LONG[m - 1])} : noter une absence" title="Noter une absence le ${C.fmtDate(j.iso)}"></button></td>`;
      };
      const rows = emps.map(e => ({ e, p: C.pointageDuMois(data, e, y, m) }));
      return `<section class="pa-carte" id="cg-cal"><div class="pa-carte-t"><b>${h(MONTHS_LONG[m - 1].charAt(0).toUpperCase() + MONTHS_LONG[m - 1].slice(1))} ${y} : qui est absent</b><span class="mu">congés et absences posés, demandes en attente</span>
          </div>
        <div class="scroll-x"><table class="cg-t"><thead><tr><th></th>${rows[0].p.jours.map(j => j.iso === C.today() ? `<th class="cg-auj${j.repos ? ' cg-r' : ''}" aria-current="date" title="Aujourd'hui"><small>auj.</small><b>${j.jour}</b></th>` : `<th class="${j.repos ? 'cg-r' : ''}"><small>${L[j.wd]}</small>${j.jour}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(({ e, p }) => `<tr><td class="nw cg-n">${avPaie(e)}<b>${h(e.name)}</b></td>${p.jours.map(j => j.iso === C.today() ? cel(e, j).replace('<td', '<td data-auj="1"') : cel(e, j)).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="cg-leg"><span><i class="cg-c">C</i>congé payé</span><span><i class="cg-m">M</i>maladie</span><span><i class="cg-a">A</i>absent, non payé</span><span><i class="cg-d">D</i>demandé</span><span class="muted">les jours fériés ne se posent pas d'eux-mêmes (À VÉRIFIER chaque année)</span></div></section>`;
    }
    function lierConges(apres) {

      $$('#cg-cal [data-cg-j]').forEach(b => b.onclick = () => { const [id, iso] = b.dataset.cgJ.split('|'); leaveForm(null, id, apres, iso); });
      const lv = id => (data.leaves || []).find(x => x.id === id);
      $$('#p-body [data-dem-oui]').forEach(b => b.onclick = () => {
        const l = lv(b.dataset.demOui); if (!l) return;
        // (16 § 10.1, point 7) Une demande d'une période clôturée : le refus se dit avant le geste, pas à l'envoi.
        if (closedBlock([l.from, l.to], 'Cette demande')) return;
        // (1.256.0) Une demande plus longue que le solde (la maquette, « Une demande de congé (solde trop court) ») : les jours
        // du solde restent un congé payé, la suite devient une absence sans solde, notée comme telle. Rien n'est perdu au défaire.
        const st = C.payrollSettings(data), jours = C.workingDays(l.from, l.to, st.offDays);
        const reste = l.kind === 'conges' ? Math.max(0, Math.floor(Number(C.leaveBalance(data, l.employeeId, Number(String(l.from).slice(0, 4))).remaining) || 0)) : jours;
        const avant = { ...l };
        let ajout = null;
        if (l.kind === 'conges' && reste < jours) {
          if (reste <= 0) { l.kind = 'sans-solde'; l.note = [l.note, 'au-delà du solde de congés'].filter(Boolean).join(' · '); }
          else {
            let d = l.from, n = 0;
            while (d <= l.to) { if (C.workingDays(d, d, st.offDays) > 0) { n++; if (n === reste) break; } d = C.addDays(d, 1); }
            ajout = { id: C.uid(), employeeId: l.employeeId, kind: 'sans-solde', from: C.addDays(d, 1), to: l.to, paid: false, statut: 'accepte', reponduLe: C.today(), note: 'au-delà du solde de congés', deDemande: l.id };
            l.to = d;
            data.leaves.push(ajout);
          }
        }
        l.statut = 'accepte'; l.reponduLe = C.today(); save(true); apres();
        toastUndo(ajout || l.kind !== avant.kind ? `Demande acceptée : ${ajout ? `${pct(reste)} jours payés, la suite sans solde` : 'en absence sans solde'}, sur le pointage et le bulletin` : 'Demande acceptée : le congé se pose sur le pointage et le bulletin', () => {
          Object.keys(l).forEach(k => delete l[k]); Object.assign(l, avant);
          if (ajout) data.leaves = data.leaves.filter(x => x.id !== ajout.id);
          save(true); apres();
        });
      });
      $$('#p-body [data-dem-mod]').forEach(b => b.onclick = () => { const l = lv(b.dataset.demMod); if (l) leaveForm(l, null, apres); });
      $$('#p-body [data-dem-non]').forEach(b => b.onclick = () => {
        const l = lv(b.dataset.demNon); if (!l) return;
        if (closedBlock([l.from, l.to], 'Cette demande')) return;
        modal(`<h2>Refuser la demande</h2><p class="small muted">Ta raison reste écrite avec la demande, et sa date.</p><form id="dr"><label class="field">${lbl('Pourquoi')}<input type="text" name="raison" placeholder="ex. le fournil ne tiendrait pas la nuit"></label></form>
          <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-danger" id="dr-ok">Refuser la demande</button></div>`, (root, fermer) => {
          $('#dr-ok', root).onclick = () => {
            const r = formValues($('#dr', root)).raison;
            l.statut = 'refuse'; l.reponduLe = C.today(); if (r) l.raisonRefus = r;
            save(true); fermer(); apres();
            toastUndo('Demande refusée : ta raison reste écrite', () => { l.statut = 'demande'; delete l.reponduLe; delete l.raisonRefus; save(true); apres(); });
          };
        });
      });
    }
    // (plateforme) 1.234.0 — « Les congés » comme la maquette : une carte, une ligne par salarié (avatar), Acquis, Pris, Reste,
    // Sans solde, et le total de ce qui reste à prendre (ou à payer au départ). Le report et la maladie se disent sous le chiffre.
    function congesCompteurs(y, emps, cptPage) {
      const st = C.payrollSettings(data), auj = C.today(), dj = Number(st.leaveDaysPerYear) || 0;
      const B = emps.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr')).map(e => ({ e, b: C.leaveBalance(data, e.id, y) }));
      const tot = k => C.round3(B.reduce((a, x) => a + (Number(x.b[k]) || 0), 0));
      const vide = '<span class="muted">—</span>', jj = n => `${pct(n)} j`;
      const lig = ({ e, b }) => {
        const futur = e.hireDate && e.hireDate > auj, ss = b.byKind['sans-solde'] || 0;
        return `<tr class="clickable ${b.remaining < 0 ? 'row-warn' : ''}" data-eid="${h(e.id)}" tabindex="0"><td class="pa-cl">${avPaie(e)}<span><b>${h(e.name)}</b></span></td>
          <td class="r nw">${b.acquired ? `<b>${jj(b.acquired)}</b>` : vide}${b.carry ? `<small>dont ${jj(b.carry)} reporté${sPl(b.carry)}</small>` : ''}</td>
          <td class="r nw">${b.taken ? `<b>${jj(b.taken)}</b>` : vide}${b.byKind.maladie ? `<small>+ ${jj(b.byKind.maladie)} de maladie</small>` : ''}</td>
          <td class="r nw">${futur ? `<b>dès ${h(MONTHS_LONG[Number(e.hireDate.slice(5, 7)) - 1])}</b>` : `<b class="${b.remaining < 0 ? 'warn-text' : ''}">${jj(b.remaining)}</b>${b.remaining < 0 ? '<small>pris en avance</small>' : ''}`}</td>
          <td class="r nw">${ss ? `<span class="statut alerte">${jj(ss)}</span>` : vide}</td></tr>`;
      };
      return `<section class="pa-carte" id="p-compteurs"><div class="pa-carte-t"><b>Les congés ${info('hr.balance')}</b><span class="mu">au ${C.fmtDate(auj)} · ${pct(dj)} ${dj > 1 ? 'jours ouvrables' : 'jour ouvrable'} par an, acquis chaque mois (À VÉRIFIER : ta convention collective) · le droit se règle dans les Réglages</span></div>
        ${emps.length ? `<div class="scroll-x"><table class="list compact pa-liste"><thead><tr><th>Salarié</th><th class="r">Acquis en ${y}</th><th class="r">Pris</th><th class="r">Reste</th><th class="r">Sans solde</th></tr></thead>
          <tbody>${cptPage.rows.map(e => lig(B.find(x => x.e.id === e.id))).join('')}</tbody>
          <tfoot><tr class="total-row"><td><b>${pct(tot('remaining'))} jour${sPl(tot('remaining'))} restant${sPl(tot('remaining'))}</b><small>à prendre, ou à payer au départ</small></td><td class="r nw"><b>${jj(tot('acquired'))}</b></td><td class="r nw"><b>${jj(tot('taken'))}</b></td><td class="r nw"><b>${jj(tot('remaining'))}</b></td><td></td></tr></tfoot></table></div>${pagerBar(cptPage.pg, { noun: 'salarié' })}`
          : '<div class="empty">Aucun salarié en poste.</div>'}</section>`;
    }
    // (1.256.0) Ce que chaque sorte d'absence fait au bulletin (la maquette, « Un arrêt maladie ») : la règle de SkanFact, et ce
    // qui reste À VÉRIFIER. Une carte qu'on replie : on la lit une fois.
    function absencesRegles() {
      const R = [['maladie', 'Arrêt maladie', 'payé par défaut ; la CNAM indemnise selon ses règles (jours de carence, montant), le certificat se garde'],
        ['maternite', 'Congé de maternité', 'payé par défaut ; indemnisé par la CNAM (sa durée : À VÉRIFIER)'],
        ['accident', 'Accident du travail', 'à déclarer à la CNSS dans un délai court (À VÉRIFIER) ; se note en arrêt maladie, avec sa note'],
        ['autorisation', 'Congés exceptionnels (mariage, naissance, décès)', 'payés ; leurs durées : celles du Code du travail et de ta convention (À VÉRIFIER)'],
        ['sans-solde', 'Absence sans solde', 'retirée du brut, au jour (brut ÷ jours ouvrables)'],
        ['abandon', 'Absence injustifiée', 'retirée du brut, comme une absence sans solde']];
      return `<details class="pa-carte pa-replie" id="cg-regles"><summary class="pa-carte-t"><b>Les autres absences et ce qu'elles font</b><span class="mu">chacune a sa règle, À VÉRIFIER avec ton comptable</span></summary>
        <ul class="pa-regles">${R.map(([k, t, d]) => `<li><b>${h(t)}</b><span>${h(d)}</span></li>`).join('')}</ul></details>`;
    }
    // Les avances et les prêts en cours, sous les congés (la maquette) : une barre par retenue, la dernière dite.
    function avancesEnCours() {
      const tout = C.advancesOf(data), open = tout.filter(a => !a.done);
      return `<section class="pa-carte" id="cg-avances"><div class="pa-carte-t"><b>Les avances et les prêts ${info('hr.advance')}</b><span class="mu">${open.length ? `${open.length} en cours · ${C.money(C.round3(open.reduce((x, a) => x + a.remaining, 0)), cur)} à récupérer` : 'aucune en cours'}</span>
          <button type="button" class="btn btn-sm" id="cg-new-av">Une avance ou un prêt…</button></div>
        ${open.length ? `<ul class="pa-av-l">${open.map(a => avanceLigneHtml(a, cur)).join('')}</ul>` : ''}
        <p class="small muted pa-note-c">Chaque retenue se pose toute seule sur son bulletin. Au départ, ce qui reste se règle avec le solde de tout compte (À VÉRIFIER avec ton comptable : ce qui peut se retenir).${tout.length > open.length ? ` <button type="button" class="lien" id="cg-av-tout">Toutes, avec les ${pl(tout.length - open.length, 'soldée')}…</button>` : tout.length ? ' <button type="button" class="lien" id="cg-av-tout">La liste…</button>' : ''}</p></section>`;
    }
    function drawLeaves() {
      const y = Number(s.year);
      const all = C.leavesOf(data, '', y);
      const emps = C.activeEmployees(data);
      const cptPage = paginate(emps.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr')), s.compteurs);
      const mc = Number(s.moisCal || (String(y) === C.today().slice(0, 4) ? Number(C.today().slice(5, 7)) : 1));
      $('#p-body').innerHTML = `${congesDemandes()}${congesCalendrier(y, mc)}
        ${congesCompteurs(y, emps, cptPage)}${absencesRegles()}
        <div class="panel"><h2>Congés et absences de ${h(s.year)}</h2>
          ${/* 10.12.0 — « 0 enregistrement » au-dessus d'un état vide qui dit déjà qu'il n'y a rien : un
               compte n'a rien à faire au-dessus du vide (7.0.0). */''}
          ${all.length ? `<div class="filters"><span class="small muted">${pl(all.length, 'enregistrement')}</span></div>` : ''}
          ${all.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Salarié</th><th>Nature</th><th>Du</th><th>Au</th><th class="r">Jours</th><th>Effet</th><th>Motif</th></tr></thead><tbody>
            ${/* 10.12.0 — la seule liste de la Paie dont la ligne ne s'ouvrait pas au clic : il fallait
                 viser un « Modifier » au bout de la ligne. Une absence s'ouvre comme une facture. */''}
            ${all.map(l => { const e = employeeById(l.employeeId) || {};
              return `<tr class="clickable" data-lv="${h(l.id)}" title="Modifier cette absence"><td><strong>${h(e.name || '')}</strong></td><td>${h(l.kindLabel)}</td>
                <td class="nw">${C.fmtDate(l.from)}</td><td class="nw">${C.fmtDate(l.to)}</td>
                <td class="r nw">${pct(l.days)}</td>
                <td>${l.statut === 'demande' ? '<span class="statut attire">demandée</span>' : l.statut === 'refuse' ? `<span class="statut">refusée${l.reponduLe ? ` le ${C.fmtDate(l.reponduLe)}` : ''}</span>${l.raisonRefus ? `<small class="muted"> ${h(l.raisonRefus)}</small>` : ''}` : l.paid ? '<span class="ok-text">payée</span>' : '<span class="warn-text">retirée du salaire</span>'}</td>
                <td>${h(l.note || '')}</td></tr>`;
            }).join('')}
          </tbody></table></div>`
            : '<div class="empty">Aucun congé ni absence enregistré cette année. Une absence non payée se retire toute seule du bulletin du mois concerné.</div>'}
        </div>`;
      $$('#p-body [data-lv]').forEach(b => b.onclick = () => leaveForm(data.leaves.find(x => x.id === b.dataset.lv), null, () => draw()));
      $$('#p-body tr[data-eid]').forEach(tr => tr.onclick = e2 => { if (e2.target.closest('button')) return; navigate('#/salarie/' + tr.dataset.eid); });
      if ($('#p-compteurs')) bindPager($('#p-compteurs'), s.compteurs, () => drawLeaves(), '#p-compteurs');
      lierConges(() => draw());
    }

    function drawAdvances() {
      const all = C.advancesOf(data);
      const open = all.filter(a => !a.done);
      const avPage = paginate(all, s.av);
      // (1.256.0) Les avances en cours (la frise des retenues) en tête, puis toutes : la sous-vue « Avances et prêts » des salariés.
      $('#p-body').innerHTML = `${avancesEnCours()}
        <div class="panel"><h2>Toutes les avances et les prêts ${info('hr.advance')}</h2>
          ${/* 10.12.0 — « 0 en cours sur 0 » au-dessus d'un état vide (même faute que les absences). */''}
          ${all.length ? `<div class="filters"><span class="small muted">${open.length} en cours sur ${all.length}${open.length ? ` · ${C.money(C.round3(open.reduce((a, x) => a + x.remaining, 0)), cur)} restant à récupérer` : ''}</span></div>` : ''}
          ${all.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Salarié</th><th>Date</th><th class="r">Avancé</th><th class="r">Par mois</th><th class="r">Remboursé</th><th class="r">Reste</th><th>Note</th></tr></thead><tbody>
            ${/* 10.12.0 — une avance EN COURS se peignait en orange : c'est son état normal, jusqu'à la
                 dernière retenue (8.0.1 : du rouge sur une situation normale apprend à ignorer le
                 rouge). La ligne s'ouvre au clic, comme toute liste ; l'explication vit dans la bulle
                 du titre — la phrase sous le tableau la recopiait mot pour mot (9.4.9). */''}
            ${avPage.rows.map(a => { const e = employeeById(a.employeeId) || {};
              return `<tr class="clickable" data-av="${h(a.id)}" title="Modifier cette avance">
                <td><strong>${h(e.name || '')}</strong><small class="muted"> ${a.kind === 'pret' ? 'prêt' : 'avance'}</small>${!a.done && a.monthly > 0 ? `<div class="pa-ech" title="${pl(Math.ceil(a.amount / a.monthly), 'retenue')} de ${C.money(a.monthly, cur)}">${Array.from({ length: Math.min(24, Math.ceil(a.amount / a.monthly)) }, (_, k) => `<i class="${k < Math.round(a.repaid / a.monthly) ? 'fait' : ''}"></i>`).join('')}</div>` : ''}</td><td class="nw">${C.fmtDate(a.date)}${a.debut ? `<small class="muted"> retenues dès ${h(MONTHS_LONG[Number(a.debut.slice(5, 7)) - 1])} ${h(a.debut.slice(0, 4))}</small>` : ''}</td>
                <td class="r nw">${C.money(a.amount, cur)}</td><td class="r nw">${C.money(a.monthly, cur)}</td>
                <td class="r nw">${C.money(a.repaid, cur)}</td>
                <td class="r nw">${a.done ? '<span class="ok-text">soldée</span>' : `<strong>${C.money(a.remaining, cur)}</strong>`}</td>
                <td>${h(a.note || '')}</td></tr>`;
            }).join('')}
          </tbody></table></div>${pagerBar(avPage.pg, { noun: 'avance' })}`
            : '<div class="empty">Aucune avance. Une avance sur salaire se rembourse par retenues mensuelles sur les bulletins suivants.</div>'}
        </div>`;
      $$('#p-body [data-av]').forEach(b => { b.onclick = () => advanceForm(data.advances.find(x => x.id === b.dataset.av), null, () => draw()); b.onkeydown = ev => { if (ev.key === 'Enter') b.click(); }; });
      if ($('#cg-new-av')) $('#cg-new-av').onclick = () => advanceForm(null, null, () => draw());
      if ($('#cg-av-tout')) $('#cg-av-tout').hidden = true;
      bindPager($('#p-body'), s.av, () => drawAdvances(), '#p-body');
    }

    function drawRegister() {
      const reg = C.staffRegister(data);
      const regPage = paginate(reg, s.reg), docsTous = data.employees.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')), docsPage = paginate(docsTous, s.regDocs);
      $('#p-body').innerHTML = `
        <div class="panel"><h2>Registre du personnel ${info('hr.register')}</h2>
          <p class="small muted mb">La liste que l'inspection du travail peut demander : qui a travaillé chez toi, à quel poste, sous quel contrat, et entre quelles dates. <em>À VÉRIFIER : la forme exacte du registre et son mode de tenue relèvent du code du travail.</em></p>
          ${reg.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>N°</th><th>Nom</th><th>CIN</th><th>CNSS</th><th>Emploi</th><th>Contrat</th><th>Entrée</th><th>Sortie</th><th class="r">Brut</th></tr></thead><tbody>
            ${regPage.rows.map(r => `<tr class="clickable${r.active ? '' : ' muted'}" data-eid="${h(r.id)}" title="Ouvrir la fiche de ${h(r.name)}">
              <td>${r.n}</td><td><strong>${h(r.name)}</strong></td><td class="nw">${h(r.cin) || '—'}</td><td class="nw">${h(r.cnss) || '—'}</td>
              <td>${h(r.position)}</td><td>${h(r.contract)}</td>
              <td class="nw">${r.hireDate ? C.fmtDate(r.hireDate) : '—'}</td>
              <td class="nw">${r.endDate ? C.fmtDate(r.endDate) : '<span class="ok-text">en poste</span>'}</td>
              <td class="r nw">${C.money(r.grossSalary, cur)}</td></tr>`).join('')}
          </tbody></table></div><div id="reg-pg">${pagerBar(regPage.pg, { noun: 'salarié' })}</div>
          <div class="inline mt"><button class="btn" id="reg-csv">Exporter en CSV</button></div>`
            : '<div class="empty">Aucun salarié.</div>'}
        </div>
        <div class="panel"><h2>Documents à remettre ${info('hr.doc')}</h2>
          <p class="small muted mb">Attestation de travail, certificat de travail, solde de tout compte : générés au même format que tes autres documents, et prêts à signer.</p>
          ${data.employees.length ? `<div>${docsPage.rows.map(e => `
            <div class="inline mb"><strong style="min-width:200px;display:inline-block">${h(e.name)}</strong>
              <button class="btn btn-sm" data-hr="${h(e.id)}">Établir un document…</button></div>`).join('')}</div><div id="reg-docs-pg">${pagerBar(docsPage.pg, { noun: 'salarié' })}</div>`
            : '<div class="empty">Aucun salarié.</div>'}
        </div>`;
      $$('#p-body [data-hr]').forEach(b => b.onclick = () => hrDocForm(employeeById(b.dataset.hr), () => draw()));
      if ($('#reg-pg')) bindPager($('#reg-pg'), s.reg, () => drawRegister(), '#p-body');
      if ($('#reg-docs-pg')) bindPager($('#reg-docs-pg'), s.regDocs, () => drawRegister(), '#reg-docs-pg');
      // Le registre NOMME des personnes : chaque ligne ouvre sa fiche, comme la liste des Salariés
      // (7.15.0 — un écran qui nomme un ensemble doit pouvoir l'ouvrir).
      $$('#p-body tr[data-eid]').forEach(tr => tr.onclick = () => navigate('#/salarie/' + tr.dataset.eid));
      if ($('#reg-csv')) $('#reg-csv').onclick = async () => {
        const cols = [{ key: 'n', label: 'N°' }, { key: 'name', label: 'Nom' }, { key: 'cin', label: 'CIN' },
          { key: 'cnss', label: 'N° CNSS' }, { key: 'position', label: 'Emploi' }, { key: 'contract', label: 'Contrat' },
          { key: 'hireDate', label: 'Entrée', type: 'date' }, { label: 'Sortie', get: r => r.endDate ? C.fmtDate(r.endDate) : '' },
          { key: 'grossSalary', label: 'Brut mensuel', type: 'money' }];
        const f = await bridge.saveText(`registre-personnel-${C.today()}.csv`, C.toCsv(reg, cols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
    }

    // Le fichier CNSS du trimestre : ce qui l'empêche de sortir, nommé case par case avec le geste qui
    // le lève (le matricule de l'entreprise se renseigne déjà par « Le renseigner » au-dessus) ; les
    // avertissements, une ligne par salarié ; puis le bouton. Même mise en page que le Cabinet.
    function blocFichierCnss(f, enCours) {
      if (!f) return '';
      const fiche = (id, champ, lab) => `<button type="button" class="btn btn-sm" data-cn-sal="${h(id)}" data-cn-champ="${h(champ)}">${h(lab)}</button>`;
      const champDe = { cnss: 'cnss', cin: 'cin', identite: 'cnssName' };
      // Le matricule VIDE est déjà dit par #cn-employeur, avec « Le renseigner » ; mal écrit, il se dit ici.
      const refus = f.refus.filter(r => !(r.champ === 'employeur' && !(company().cnss || '').trim()));
      const court = { identite: 'identité reprise du nom de la fiche', cin: 'CIN absent (la case part vide)' };
      const par = [];
      f.avertissements.forEach(a => { let g = par.find(x => x.id === a.salarieId); if (!g) par.push(g = { id: a.salarieId, nom: a.nom, champs: [] }); g.champs.push(a.champ); });
      return `<div class="mt" id="cn-fichier-bloc">
        ${refus.length ? `<div class="warn-box mb"><div><b>Le fichier CNSS attend ${h(pl(refus.length, 'correction'))}</b> — il ne sort pas tant qu'une ligne est fausse : le portail le refuserait.</div>
          ${refus.map(r => `<div class="ctrl-geste"><span>${r.nom ? `<b>${h(r.nom)}</b> — ` : ''}${h(r.motif)}</span>${r.salarieId && champDe[r.champ] ? fiche(r.salarieId, champDe[r.champ], `Ouvrir la fiche de ${r.nom}…`) : r.champ === 'code' || r.champ === 'employeur' ? `<button type="button" class="btn btn-sm" data-cn-regl="${r.champ === 'code' ? 'cnssCode' : 'cnss'}">${r.champ === 'code' ? 'Corriger le code d\'exploitation…' : 'Corriger le matricule CNSS…'}</button>` : ''}</div>`).join('')}</div>` : ''}
        ${/* (1.248.1) Les fiches au même manque se disent en UNE phrase, un bouton par personne : cinq lignes presque pareilles
              noyaient le refus qui, lui, bloque (recette du 02/11). */''}
        ${par.length ? `<div class="small mb" id="cn-avert">${[...new Set(par.map(g => g.champs.join('+')))].map(sig => {
          const gs = par.filter(g => g.champs.join('+') === sig), quoi = h(gs[0].champs.map(c => court[c] || c).join(' · '));
          return gs.length === 1 ? `<div class="ctrl-geste"><span><b>${h(gs[0].nom)}</b> — ${quoi}</span>${fiche(gs[0].id, gs[0].champs.includes('identite') ? 'cnssName' : 'cin', 'Compléter sa fiche…')}</div>`
            : `<div class="ctrl-geste cn-groupe"><span><b>${gs.length} fiches</b> — ${quoi} :</span>${gs.map(g => fiche(g.id, g.champs.includes('identite') ? 'cnssName' : 'cin', `${g.nom}…`)).join('')}</div>`;
        }).join('')}
          <div class="muted">Le fichier sort quand même. <b>À VÉRIFIER</b> : la CNSS demande l'identité « prénom, prénom du père, nom » comme sur la carte d'assuré (le nom de jeune fille pour une femme mariée), et le portail peut refuser un CIN vide.</div></div>` : ''}
        ${/* Un trimestre en cours n'a pas encore tous ses bulletins : le fichier se fabrique une fois le
              trimestre TERMINÉ, par la même règle que « Marquer déposée » (10.12.0) — la raison est dite
              juste au-dessus (#cn-en-cours). */''}
        <div class="ctrl-geste"><button type="button" class="btn btn-sm" id="cn-fichier" ${f.ok && !enCours ? '' : `disabled title="${h(enCours || 'Corrige d\'abord ce qui est signalé au-dessus.')}"`}>Fabriquer le fichier CNSS…</button>
          <span class="small muted">Au format ${h(f.format)} de la télédéclaration des salaires. <b>À VÉRIFIER</b> : contrôle-le sur le portail CNSS avant de valider le dépôt — SkanFact ne dépose rien.</span>${info('soc.fichierCnss')}</div>
      </div>`;
    }

    function drawDeclarations() {
      const y = Number(s.year);
      // 10.14.1 — sans trimestre choisi, la page s'ouvre sur celui qu'il FAUT déposer, pas sur le
      // trimestre en cours (qui ne se déclare qu'une fois terminé) : « À faire » disait « CNSS 2e
      // trimestre à déposer » et « Voir les déclarations » ouvrait le 3e, éteint (test humain).
      const aDeposer = !Number(s.quarter) ? C.socialDue(data).find(x => x.kind === 'cnss' && x.year === y) : null;
      const q = Number(s.quarter) || (aDeposer ? aDeposer.quarter : Math.ceil(Number(C.today().slice(5, 7)) / 3));
      s.quarter = String(q);
      const cn = C.cnssDeclaration(data, y, q);
      // (plateforme) 1.61.0 — l'état récapitulatif des salaires déclarés du trimestre, et ce que la paie du mois choisi
      // ajoute à la déclaration mensuelle.
      const etat = C.etatRecapitulatifCnss(data, company(), y, q);
      // La déclaration mensuelle s'ouvre sur le mois qu'on déclare maintenant (le mois écoulé, dû le 28 de ce mois-ci),
      // pas sur celui des bulletins : vu à l'écran le 19 octobre, elle s'ouvrait sur octobre, vide, quand celle de
      // septembre était à déposer.
      const auj = C.today(), ty = Number(auj.slice(0, 4)), tm = Number(auj.slice(5, 7));
      const dmChoisi = Number(s.moisDeclare) || (y === ty ? Math.max(1, tm - 1) : y < ty ? 12 : 1);
      // (1.257.0) La bande des douze mois choisit le mois en cours (novembre) : sans bulletin, il n'a rien à déclarer ;
      // la carte montre alors le mois qu'on déclare maintenant (octobre, dû le 28/11), et le dit.
      const dmRepli = dmChoisi > 1 && y === ty && dmChoisi >= tm && !C.payslipsOf(data, y, dmChoisi).length && C.payslipsOf(data, y, dmChoisi - 1).length > 0;
      const dmMois = dmRepli ? dmChoisi - 1 : dmChoisi;
      const dm = C.declarationMensuelleSalaires(data, y, dmMois);
      // 10.14.1 (DECL D2) — le fichier de télédéclaration du trimestre, par le moteur du Cabinet.
      // Ses refus se lisent AVANT le geste (9.4.2) et le bouton s'éteint par le même verdict (9.4.5).
      const fichier = cn.rows.length ? C.fichierCnssEntreprise(data, company(), y, q) : null;
      const an = C.employerAnnual(data, y, company());
      const due = C.socialDue(data);
      const filed = id => (data.socialFilings || []).find(f => f.id === id);
      // E-04 (rapport QA) — un trimestre qui compte un bulletin IMPOSSIBLE (net négatif, enregistré
      // avant la garde de la 10.10.0) additionnait ses cotisations négatives et proposait « Marquer
      // déposée » à côté de « − 168,970 DT ». Le bouton s'éteint en disant pourquoi, et le motif se lit
      // au-dessus des boutons (9.4.5), avec le nom du salarié et le mois à rouvrir.
      const impossibles = C.bulletinsImpossibles(data);
      const raisonCnss = (yy, qq) => {
        const l = impossibles.filter(b => Number(b.year) === yy && Math.ceil(Number(b.month) / 3) === qq);
        if (!l.length) return '';
        const qui = l.map(b => `${(employeeById(b.employeeId) || {}).name || 'un salarié'} (${C.monthLabel(`${b.year}-${String(b.month).padStart(2, '0')}-01`)})`).join(', ');
        return `Ce trimestre compte ${pl(l.length, 'bulletin')} au net négatif — ${qui} : ${l.length > 1 ? 'corrige-les' : 'corrige-le'} avant de déposer, sinon la déclaration porte des cotisations fausses.`;
      };
      const raisonDe = id => { const m = /^cnss-(\d{4})-T(\d)$/.exec(id || ''); return m ? raisonCnss(Number(m[1]), Number(m[2])) : ''; };
      // 10.12.0 — « Marquer déposée » en VERT sur le trimestre en cours et sur l'année en cours : on
      // déclare une période TERMINÉE (règle de la même version pour le rappel), sinon il manquerait ses
      // derniers bulletins — et la mention « déposée » figerait une déclaration incomplète. Le bouton
      // s'éteint en disant jusqu'à quand, et le motif se lit au-dessus des boutons (9.4.5).
      const finTrimestre = (yy, qq) => qq >= 4 ? `${yy}-12-31` : C.addDays(`${yy}-${String(qq * 3 + 1).padStart(2, '0')}-01`, -1);
      const pasFini = (fin, quoi, fem) => C.today() <= fin ? `${quoi} se termine le ${C.fmtDate(fin)} : on ${fem ? 'la' : 'le'} déclare une fois ${fem ? 'terminée' : 'terminé'}, sinon il manquerait ses derniers bulletins.` : '';
      const enCoursCnss = pasFini(finTrimestre(y, q), `Le ${C.quarterLabel(q)} ${y}`, false);
      const enCoursDm = pasFini(C.addDays(`${y}-${String(dmMois).padStart(2, '0')}-01`, C.daysInMonth(y, dmMois) - 1), `${MONTHS_LONG[dmMois - 1].charAt(0).toUpperCase()}${MONTHS_LONG[dmMois - 1].slice(1)} ${y}`, false);
      const enCoursAnnee = pasFini(`${y}-12-31`, `L'année ${y}`, true);
      // Noter une déclaration déposée est un clic sans question — et c'est bien ainsi, on le fait
      // douze fois par an. Mais la ligne quitte aussitôt le panneau « À déposer », donc le bouton
      // qui retire la mention n'est plus là où on vient de cliquer : il faut descendre au bon
      // panneau et retrouver le bon trimestre. D'où le « Annuler » sous la main.
      const mark = async (id, label) => {
        const f = filed(id);
        // (plateforme) 1.228.0 — la CNSS d'un trimestre et les retenues d'un mois se notent DÉPOSÉES ET PAYÉES : le montant
        // sort de la trésorerie et solde la dette du grand livre. La déclaration annuelle, elle, ne fait rien payer.
        if (!f && /^(cnss|dm)-/.test(id)) return payerDeclarationFenetre(id, label);
        if (f) return retirerDeclarationSociale(id, label, draw);
        data.socialFilings.push({ id, filedAt: C.today(), label });
        save(true); draw();
        toastUndo(`Noté : ${label} est déposée.`, () => {
          data.socialFilings = (data.socialFilings || []).filter(x => x.id !== id);
          save(true); draw();
        });
      };
      const modeD = paieMode();
      // (plateforme) 1.227.0 — « Ce que tu verses, et quand » (la maquette) : le trimestre CNSS passé, la déclaration du mois
      // écoulé, le trimestre en cours, la déclaration annuelle. Les montants viennent des mêmes fonctions que les panneaux
      // en dessous (deux écrans, un chiffre) ; les dates sont celles des réglages, À VÉRIFIER.
      const verses = (() => {
        const cq = Math.ceil(tm / 3), pq = cq === 1 ? 4 : cq - 1, py = cq === 1 ? ty - 1 : ty;
        const me = tm === 1 ? 12 : tm - 1, ye = tm === 1 ? ty - 1 : ty;
        const cP = C.cnssDeclaration(data, py, pq), cC = C.cnssDeclaration(data, ty, cq), dE = C.declarationMensuelleSalaires(data, ye, me), dC = C.declarationMensuelleSalaires(data, ty, tm);
        const fP = filed(`cnss-${py}-T${pq}`), fE = filed(`dm-${ye}-${String(me).padStart(2, '0')}`);
        const dit = f => f.paidDate ? `payée le ${C.fmtDate(f.paidDate)}` : `déposée le ${C.fmtDate(f.date || f.filedAt || '')}`.replace(/ le $/, '');
        const idP = `cnss-${py}-T${pq}`, idE = `dm-${ye}-${String(me).padStart(2, '0')}`;
        // (1.248.1) Une ligne notée payée garde sa référence et son geste de retour : le « Annuler » du message s'efface en
        // six secondes, et une date ou un compte faux ne se corrigeait plus que trois panneaux plus bas (recette du 02/11).
        const refDe = (f, d0) => f && f.reference ? `réf. ${f.reference}` : d0;
        const retirer = (id, lab) => `<button type="button" class="btn btn-sm btn-ghost" data-file-v="${h(id)}" data-lab="${h(lab)}">Retirer la mention…</button>`;
        // (plateforme) 1.234.0 — plus de panneau « À déposer » (la maquette) : le geste vit sur la ligne de ce qu'on verse.
        // Ce qui reste dû d'avant (un trimestre oublié, l'année passée) s'ajoute en tête, avec le même geste.
        const geste = (id, lab) => `<button type="button" class="btn btn-sm" data-file="${h(id)}" data-lab="${h(lab)}"${raisonDe(id) ? ` disabled title="${h(raisonDe(id))}"` : ''}>${/^employeur-/.test(id) ? 'Marquer déposée' : 'Marquer déposée et payée…'}</button>`;
        const avant = due.filter(x => x.id !== idP && x.id !== idE).map(x => ['echeance', x.label, x.kind === 'employeur' ? 'un salarié par ligne, ses salaires et ses retenues' : 'pas encore notée déposée', `avant le ${C.fmtDate(x.dueDate)}`, x.amount || null, !!x.late, geste(x.id, x.label)]);
        const L = avant.concat([
          // (1.248.0) Un trimestre sans aucun bulletin dans SkanFact n'est pas « 0,000 DT en retard » : la paie était tenue
          // ailleurs (ou pas encore saisie) ; on le dit, sans montant ni retard (recette du 02/11).
          ...(!fP && !cP.slips ? [['echeance', `CNSS du ${C.quarterLabel(pq)} ${py}`, 'aucun bulletin dans SkanFact pour ce trimestre : la paie était tenue ailleurs ?', `avant le ${C.fmtDate(cP.dueDate)}`, null, false, '']] : [[fP ? 'coche' : 'echeance', `CNSS du ${C.quarterLabel(pq)} ${py}`, refDe(fP, `${pl(cP.employees, 'salarié')} · ${pl(cP.slips, 'bulletin')}`), fP ? dit(fP) : `avant le ${C.fmtDate(cP.dueDate)}`, cP.total, !fP && cP.dueDate < auj, fP ? retirer(idP, `la déclaration CNSS du ${C.quarterLabel(pq)} ${py}`) : due.some(x => x.id === idP) ? geste(idP, `la déclaration CNSS du ${C.quarterLabel(pq)} ${py}`) : '']]),
          [fE ? 'coche' : 'echeance', `Déclaration ${/^[aeiouyéè]/i.test(MONTHS_LONG[me - 1]) ? 'd\'' : 'de '}${MONTHS_LONG[me - 1]} : retenues et taxes sur les salaires`, refDe(fE, modeD === 'sans' ? 'tu la déposes avec la TVA du mois' : 'ton cabinet la prépare · tu verses le montant'), fE ? dit(fE) : `avant le ${C.fmtDate(dE.dueDate)}`, dE.total, !fE && dE.dueDate < auj, fE ? retirer(idE, `les retenues et taxes sur les salaires de ${MONTHS_LONG[me - 1]} ${ye}`) : dE.salaries ? geste(idE, `les retenues et taxes sur les salaires de ${MONTHS_LONG[me - 1]} ${ye}`).replace(/ data-file=/, ' data-file-v=') : ''],
          // (1.251.0) Le mois en cours, comme le trimestre en cours : ce que ses bulletins déjà établis ajouteront.
          ['echeance', `Déclaration ${/^[aeiouyéè]/i.test(MONTHS_LONG[tm - 1]) ? 'd\'' : 'de '}${MONTHS_LONG[tm - 1]} : retenues et taxes sur les salaires`, `en cours : ${pl(dC.salaries, 'bulletin')} jusqu'ici`, `avant le ${C.fmtDate(dC.dueDate)}`, dC.salaries ? dC.total : null, false, ''],
          ['echeance', `CNSS du ${C.quarterLabel(cq)} ${ty}`, `en cours : ${pl(cC.slips, 'bulletin')} jusqu'ici`, `avant le ${C.fmtDate(cC.dueDate)}`, cC.total, false, ''],
          ['echeance', `Déclaration annuelle d'employeur ${ty}`, 'un salarié par ligne, ses salaires et ses retenues', `début ${ty + 1} (À VÉRIFIER)`, null, false, '']]);
        return `<section class="pa-carte" id="dc-verses"><div class="pa-carte-t"><b>Ce que tu verses, et quand ${info('soc.due')}</b><span class="mu">les dates : celles de tes réglages, À VÉRIFIER</span></div>
          <ul class="pa-ctl">${L.map(([ic, t2, d, q2, mt, tard, g]) => `<li class="${ic === 'coche' ? 'ok' : ''}${g ? ' pa-ctl-g' : ''}">${lfIc(ic, 16, 2)}<span><b>${h(t2)}</b><small>${h(d)}</small></span><span class="pa-q${tard ? ' ambre' : ''}">${h(q2)}</span><b class="pa-mt">${mt == null ? '—' : montantU(mt, cur)}</b>${g}</li>`).join('')}</ul>
          <p class="small muted pa-note-c">SkanFact ne dépose rien et ne se connecte à aucune administration : il prépare les chiffres et te rappelle la date. À VÉRIFIER avec ton comptable : les dates et les modalités de dépôt.</p></section>`;
      })();
      $('#p-body').innerHTML = `${modeD === 'sans' ? `<div class="bandeau info pa-bandeau" id="dc-qui">${lfIc('pages', 18)}<span class="txt"><b>Tu déclares toi-même : SkanFact prépare, tu déposes</b><span>Les montants, la déclaration du mois et l'état CNSS du trimestre se préparent ici. Tu les déposes sur les sites officiels et tu marques chaque dépôt : SkanFact ne se connecte à aucune administration. Les dates : À VÉRIFIER.</span></span><button type="button" class="btn btn-sm" id="dc-mode">Qui fait ma paie</button></div>`
        : `<div class="bandeau info pa-bandeau" id="dc-qui">${lfIc('comptable', 18)}<span class="txt"><b>Tes déclarations de paie sont faites par ton cabinet</b><span>Ici, tu vois ce que tu dois verser et quand ; le cabinet les dépose. SkanFact ne dépose rien et ne se connecte à aucune administration.</span></span><button type="button" class="btn btn-sm" id="dc-mode">Qui fait ma paie</button></div>`}
        ${verses}
        <section class="pa-carte" id="dm-panneau"><div class="pa-carte-t"><b>La déclaration ${/^[aeiouyéè]/i.test(MONTHS_LONG[dmMois - 1]) ? 'd\'' : 'de '}${h(MONTHS_LONG[dmMois - 1])}, sa part paie ${info('soc.mensuelle')}</b><span class="mu">${dmRepli ? `${h(MONTHS_LONG[dmChoisi - 1])} n'a pas encore de bulletin : voici celle à faire maintenant · ` : ''}${dm.salaries ? `ce que les ${pl(dm.salaries, 'bulletin')} y ajoute${dm.salaries > 1 ? 'nt' : ''} · ` : ''}taux et barème des réglages de ta paie, À VÉRIFIER</span>
            <div class="filters pa-dm-f">
            <span class="small muted">Échéance usuelle : ${C.fmtDate(dm.dueDate)}, avec la TVA du mois</span></div></div>
          ${dm.salaries ? `<div class="scroll-x"><table class="list compact pa-liste" id="dm-table"><thead><tr>
            <th>Impôt ou taxe</th><th class="r">Base</th><th class="r">Taux</th><th class="r">Montant</th></tr></thead><tbody>
            ${dm.lignes.map(l => `<tr data-dm="${l.cle}"><td>${h(l.libelle)}${l.cle === 'tfp' ? '<small>son taux dépend de ton activité</small>' : ''}</td><td class="r nw">${C.money(l.base, '')}</td>
              <td class="r nw">${l.bareme ? '<span class="muted">barème</span>' : l.taux === null ? '<span class="muted" title="Le taux n\'est pas le même sur tous les bulletins du mois">—</span>' : pct(l.taux) + ' %'}</td>
              <td class="r nw"><b>${C.money(l.montant, '')}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr class="total-row"><td colspan="3"><b>À verser au Trésor</b> <span class="small muted">&nbsp; avant le ${h(C.fmtDate(dm.dueDate).slice(0, 5))}</span></td><td class="r nw" id="dm-total"><b>${montantU(dm.total, cur)}</b></td></tr></tfoot></table></div>
          <p class="small muted pa-note-c">Les ${pl(dm.salaries, 'bulletin')} de ${h(MONTHS_LONG[dmMois - 1])} ${y}, à reporter sur la déclaration mensuelle d'employeur et de TVA. SkanFact ne dépose rien. À VÉRIFIER avec ton comptable : la base que le formulaire demande, et le mois où se déclare une paie versée le mois suivant.</p>
          <div class="inline pa-dm-g"><button type="button" class="btn btn-sm" id="dm-csv">Exporter en CSV</button>${(() => {
            const fm = filed(`dm-${y}-${String(dmMois).padStart(2, '0')}`);
            return fm ? `<span class="small muted" id="dm-paye">${fm.paidDate ? `déposée et payée le ${h(C.fmtDate(fm.paidDate))} · ${h(C.money(Number(fm.amount) || 0, cur))}` : 'déposée'}</span><button type="button" class="btn btn-sm" id="dm-file">Retirer la mention</button>`
              : `<button type="button" class="btn btn-sm" id="dm-file"${enCoursDm ? ` disabled title="${h(enCoursDm)}"` : ''}>${lfIc('coche', 15, 2.4)} Marquer déposée et payée…</button>${enCoursDm ? `<span class="small muted" id="dm-encours">${h(enCoursDm)}</span>` : ''}`;
          })()}</div>`
            : `<div class="empty" id="dm-vide">Aucun bulletin en ${h(MONTHS_LONG[dmMois - 1])} ${y} : la paie n'ajoute rien à la déclaration de ce mois-là.</div>`}
        </section>

        <div class="panel"><h2>Déclaration CNSS ${info('soc.cnss')}</h2>
          <div class="filters">
            <select id="d-quarter">${C.QUARTERS.map(([n2, lab]) => `<option value="${n2}" ${q === n2 ? 'selected' : ''}>${lab}</option>`).join('')}</select>
            <span class="small muted">Échéance usuelle : ${C.fmtDate(cn.dueDate)}${filed(`cnss-${y}-T${q}`) ? ` · <span class="ok-text">déposée le ${C.fmtDate(filed(`cnss-${y}-T${q}`).filedAt)}</span>` : ''}</span>
          </div>
          ${cn.rows.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Salarié</th><th>N° CNSS</th><th class="r">Mois</th><th class="r">Jours</th><th class="r">Assiette</th>
            <th class="r">Part salarié</th><th class="r">Part employeur</th><th class="r">Accident</th><th class="r">Total</th></tr></thead><tbody>
            ${cn.rows.map(r => `<tr><td><strong>${h(r.name)}</strong></td><td class="nw">${h(r.cnss) || '<span class="warn-text">manquant</span>'}</td>
              <td class="r nw">${r.months}</td><td class="r nw">${pct(r.days)}</td>
              <td class="r nw">${C.money(r.base, cur)}</td><td class="r nw">${C.money(r.employee, cur)}</td>
              <td class="r nw">${C.money(r.employer, cur)}</td><td class="r nw">${C.money(r.accident, cur)}</td>
              <td class="r nw"><strong>${C.money(r.total, cur)}</strong></td></tr>`).join('')}
            <tr class="total-row"><td colspan="4"><strong>${pl(cn.employees, 'salarié')}</strong></td>
              <td class="r"><strong>${C.money(cn.base, cur)}</strong></td>
              <td class="r"><strong>${C.money(cn.employee, cur)}</strong></td>
              <td class="r"><strong>${C.money(cn.employer, cur)}</strong></td>
              <td class="r"><strong>${C.money(cn.accident, cur)}</strong></td>
              <td class="r"><strong>${C.money(cn.total, cur)}</strong></td></tr>
          </tbody></table></div>
          ${raisonCnss(y, q) && !filed(`cnss-${y}-T${q}`) ? `<p class="small danger-text mt" id="cn-impossible">${h(raisonCnss(y, q))}</p>` : ''}
          ${enCoursCnss && !raisonCnss(y, q) && !filed(`cnss-${y}-T${q}`) ? `<p class="small muted mt" id="cn-en-cours">${h(enCoursCnss)}</p>` : ''}
          ${/* 10.12.0 — le matricule CNSS de l'ENTREPRISE manquait sans un mot : la déclaration le
               demande autant que celui de chaque salarié, et le bulletin l'imprime. Les deux manques
               se lisent AVANT les boutons (9.4.2), et nomment qui. */''}
          ${cn.rows.some(r => !r.cnss) ? `<p class="small warn-text mt" id="cn-sans-numero">Le matricule CNSS manque sur ${cn.rows.filter(r => !r.cnss).length > 1 ? 'les fiches de' : 'la fiche de'} ${h(cn.rows.filter(r => !r.cnss).map(r => r.name).join(', '))} : la déclaration ne peut pas être déposée sans lui.</p>` : ''}
          ${(company().cnss || '').trim() ? '' : `<p class="small warn-text mt" id="cn-employeur">Le matricule CNSS de l'entreprise n'est pas renseigné : la déclaration et les bulletins le portent. <a href="#" id="cn-mat" class="warn-link">Le renseigner</a></p>`}
          ${blocFichierCnss(fichier, enCoursCnss)}
          <div class="mt" id="cn-etat">
            <h3 class="sub-h">État récapitulatif des salaires déclarés ${info('soc.etatCnss')}</h3>
            <div class="scroll-x"><table class="list compact" style="max-width:760px"><thead><tr><th>Régime</th><th class="r">Taux</th><th class="r">Montant</th></tr></thead><tbody>
              <tr><td>Salaires déclarés</td><td></td><td class="r nw" data-etat="salaires"><strong>${C.money(etat.salaires, cur)}</strong></td></tr>
              ${etat.lignes.map(l => `<tr><td>${h(l.libelle)}</td><td class="r nw">${l.taux === null ? '<span class="muted" title="Le taux n\'est pas le même sur tous les bulletins du trimestre : le montant est leur somme">—</span>' : pct(l.taux) + ' %'}</td><td class="r nw" data-etat="${l.cle}">${C.money(l.montant, cur)}</td></tr>`).join('')}
              <tr class="total-row"><td colspan="2"><strong>Total des cotisations</strong></td><td class="r nw" data-etat="total"><strong>${C.money(etat.total, cur)}</strong></td></tr>
            </tbody></table></div>
            <p class="small mt">Arrêtée à la somme de : <em data-etat="lettres">${h(etat.enLettres)}</em>.</p>
            ${Math.abs(etat.ecart) > 0.0005 ? `<p class="small muted" id="cn-ecart">Les bulletins du trimestre retiennent ${C.money(etat.bulletins, cur)} : l'état, calculé sur le total des salaires, dit ${C.money(etat.total, cur)}. L'écart (${C.money(Math.abs(etat.ecart), cur)}) vient des arrondis de chaque bulletin.</p>` : ''}
          </div>
          <div class="inline mt">
            <button type="button" class="btn" id="cn-etat-pdf">Imprimer l'état récapitulatif</button>
            <button class="btn" id="cn-csv">Exporter en CSV</button>
            <button class="btn" id="cn-mail">Envoyer au comptable</button>
            <button class="btn ${filed(`cnss-${y}-T${q}`) || raisonCnss(y, q) || enCoursCnss ? '' : 'btn-primary'}" id="cn-file"${(raisonCnss(y, q) || enCoursCnss) && !filed(`cnss-${y}-T${q}`) ? ` disabled title="${h(raisonCnss(y, q) || enCoursCnss)}"` : ''}>${filed(`cnss-${y}-T${q}`) ? 'Retirer « déposée »' : 'Marquer déposée'}</button>
          </div>`
            : `<div class="empty">Aucun bulletin sur ce trimestre.</div>`}
        </div>

        <div class="panel"><h2>Déclaration annuelle d'employeur — ${y} ${info('soc.annual')}</h2>
          <p class="small muted mb">Le récapitulatif de ce que tu as versé et de ce que tu as retenu dans l'année. Il porte sur deux choses distinctes qu'on confond souvent : les <b>salaires</b>, et les <b>retenues à la source pratiquées sur des fournisseurs</b>. Échéance usuelle : ${C.fmtDate(an.dueDate)}${filed('employeur-' + y) ? ` · <span class="ok-text">déposée le ${C.fmtDate(filed('employeur-' + y).filedAt)}</span>` : ''}.</p>
          <h3 class="sub-h">Salaires versés</h3>
          ${an.rows.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Salarié</th><th>CIN</th><th class="r">Mois payés</th><th class="r">Brut annuel</th>
            <th class="r">CNSS retenue</th><th class="r">IRPP retenu</th><th class="r">Solidarité</th><th class="r">Net des bulletins</th></tr></thead><tbody>
            ${an.rows.map(r => `<tr><td><strong>${h(r.name)}</strong>${r.position ? `<div class="small muted">${h(r.position)}</div>` : ''}</td>
              <td class="nw">${h(r.cin) || '—'}</td><td class="r nw">${r.months}</td>
              <td class="r nw">${C.money(r.gross, cur)}</td><td class="r nw">${C.money(r.cnss_, cur)}</td>
              <td class="r nw">${C.money(r.irpp, cur)}</td><td class="r nw">${C.money(r.css, cur)}</td>
              <td class="r nw"><strong>${C.money(r.net, cur)}</strong></td></tr>`).join('')}
            <tr class="total-row"><td colspan="3"><strong>Total</strong></td>
              <td class="r"><strong>${C.money(an.gross, cur)}</strong></td>
              <td class="r"><strong>${C.money(an.cnss, cur)}</strong></td>
              <td class="r"><strong>${C.money(an.irpp, cur)}</strong></td>
              <td class="r"><strong>${C.money(an.css, cur)}</strong></td>
              <td class="r"><strong>${C.money(an.net, cur)}</strong></td></tr>
          </tbody></table></div>` : '<div class="empty">Aucun bulletin cette année.</div>'}

          <h3 class="sub-h mt">Retenues à la source sur fournisseurs ${info('soc.held')}</h3>
          ${an.heldBySupplier.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Fournisseur</th><th>Matricule</th><th class="r">Pièces</th><th class="r">Base</th><th class="r">Retenu</th><th>Attestations</th></tr></thead><tbody>
            ${an.heldBySupplier.map(r => `<tr class="${r.missing ? 'row-warn' : ''}">
              <td><strong>${h(r.supplier)}</strong></td><td class="nw">${h(r.matricule) || '<span class="warn-text">manquant</span>'}</td>
              <td class="r nw">${r.count}</td><td class="r nw">${C.money(r.base, cur)}</td>
              <td class="r nw"><strong>${C.money(r.amount, cur)}</strong></td>
              <td>${r.missing ? `<span class="warn-text">${r.missing} à remettre</span>` : '<span class="ok-text">toutes remises</span>'}</td></tr>`).join('')}
            <tr class="total-row"><td colspan="4"><strong>Total retenu</strong></td>
              <td class="r"><strong>${C.money(an.heldTotal, cur)}</strong></td><td></td></tr>
          </tbody></table></div>
          ${an.heldMissing ? `<p class="small warn-text mt">${pl(an.heldMissing, 'attestation')} de retenue ${an.heldMissing > 1 ? 'ne sont pas encore remises' : "n'est pas encore remise"} à tes fournisseurs. Sans elles, ils ne peuvent pas déduire ce que tu leur as retenu.</p>` : ''}`
            : '<p class="small muted">Aucune retenue à la source opérée sur un fournisseur cette année.</p>'}
          ${enCoursAnnee && !filed('employeur-' + y) ? `<p class="small muted mt" id="an-en-cours">${h(enCoursAnnee)}</p>` : ''}
          <div class="inline mt">
            <button class="btn" id="an-csv">Exporter en CSV</button>
            <button class="btn ${filed('employeur-' + y) || enCoursAnnee ? '' : 'btn-primary'}" id="an-file"${enCoursAnnee && !filed('employeur-' + y) ? ` disabled title="${h(enCoursAnnee)}"` : ''}>${filed('employeur-' + y) ? 'Retirer « déposée »' : 'Marquer déposée'}</button>
          </div>
          <p class="small muted mt"><em>À VÉRIFIER avec ton comptable : la forme exacte du formulaire, les dates et les modalités de dépôt. SkanFact prépare les chiffres, il ne dépose rien.</em></p>
        </div>`;
      if ($('#dc-mode')) $('#dc-mode').onclick = () => quiFaitLaPaie();
      $('#d-quarter').onchange = e2 => { s.quarter = e2.target.value; draw(); };
      // (plateforme) 1.61.0 — la déclaration mensuelle garde son mois ; elle s'exporte ; l'état CNSS s'imprime.

      if ($('#dm-file')) $('#dm-file').onclick = () => mark(`dm-${y}-${String(dmMois).padStart(2, '0')}`, `les retenues et taxes sur les salaires de ${MONTHS_LONG[dmMois - 1]} ${y}`);
      if ($('#dm-csv')) $('#dm-csv').onclick = async () => {
        const cols = [{ key: 'libelle', label: 'Impôt ou taxe' }, { key: 'base', label: 'Base', type: 'money' },
          { key: 'taux', label: 'Taux (%)', get: r => r.bareme ? 'barème' : r.taux == null ? '' : String(r.taux).replace('.', ',') },
          { key: 'montant', label: 'Montant', type: 'money' }];
        const f = await bridge.saveText(`declaration-mensuelle-salaires-${y}-${String(dmMois).padStart(2, '0')}.csv`,
          C.toCsv(dm.lignes.concat([{ libelle: 'À reverser au Trésor', base: '', taux: null, montant: dm.total }]), cols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      if ($('#cn-etat-pdf')) $('#cn-etat-pdf').onclick = async () => {
        try {
          const f = await bridge.exportPdf(C.etatRecapitulatifCnssHtml(data, company(), y, q), `Etat_recapitulatif_CNSS_${y}-T${q}.pdf`);
          if (f) toast('PDF enregistré : ' + f.split(/[\\/]/).pop());
        } catch (e) { toast(e.message || 'Export impossible', true); }
      };
      $$('#p-body [data-file]').forEach(b => b.onclick = () => mark(b.dataset.file, b.dataset.lab));
      $$('#p-body [data-file-v]').forEach(b => b.onclick = () => mark(b.dataset.fileV, b.dataset.lab));
      if ($('#cn-file')) $('#cn-file').onclick = () => mark(`cnss-${y}-T${q}`, `la déclaration CNSS ${C.quarterLabel(q)} ${y}`);
      if ($('#an-file')) $('#an-file').onclick = () => mark('employeur-' + y, `la déclaration d'employeur ${y}`);
      const cnCols = [
        { key: 'name', label: 'Salarié' }, { key: 'cnss', label: 'N° CNSS' }, { key: 'months', label: 'Mois' },
        { key: 'days', label: 'Jours' }, { key: 'base', label: 'Assiette', type: 'money' },
        { key: 'employee', label: 'Part salarié', type: 'money' }, { key: 'employer', label: 'Part employeur', type: 'money' },
        { key: 'accident', label: 'Accident du travail', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }
      ];
      if ($('#cn-mat')) $('#cn-mat').onclick = e => { e.preventDefault(); allerParametres('societe', 'p-identite:cnss'); };
      $$('[data-cn-regl]').forEach(b => { b.onclick = () => allerParametres('societe', 'p-identite:' + b.dataset.cnRegl); });
      $$('[data-cn-sal]').forEach(b => { b.onclick = () => {
        const emp = employeeById(b.dataset.cnSal);
        if (emp) employeeForm(emp, () => draw(), { focus: b.dataset.cnChamp });
      }; });
      if ($('#cn-fichier')) $('#cn-fichier').onclick = async () => {
        if (enCoursCnss) return toast(enCoursCnss, true);
        const f = C.fichierCnssEntreprise(data, company(), Number(s.year), Number(s.quarter));
        if (!f.ok) return toast((f.refus[0] || {}).motif || 'Le fichier n\'a pas pu être fabriqué.', true);
        const chemin = await bridge.saveText(f.nom, f.contenu);
        if (!chemin) return;
        const renomme = chemin.split(/[\\/]/).pop() !== f.nom;
        infoDialog('Fichier CNSS enregistré', `Le fichier ${f.nom} est prêt : ${pl(f.lignes, 'salarié')}, ${C.money(f.total, cur)} de salaires déclarés.\n\n${renomme ? `Tu l'as renommé : le portail CNSS refuse un fichier dont le nom n'est pas celui du format. Remets « ${f.nom} ».\n\n` : ''}Dépose-le sur le portail CNSS (télédéclaration des salaires), puis vérifie que le nombre de salariés et le total que le portail affiche sont ceux-ci.`);
      };
      if ($('#cn-csv')) $('#cn-csv').onclick = async () => {
        const f = await bridge.saveText(`cnss-${y}-T${q}.csv`, C.toCsv(cn.rows, cnCols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      if ($('#cn-mail')) $('#cn-mail').onclick = async () => {
        if (await demoBlock('Envoyer une déclaration au comptable')) return;
        if (!await messagerie()) return;
        const acc = (company().accountantEmail || '').trim();
        const name = `cnss-${y}-T${q}.csv`;
        const att = await bridge.saveTextSilent(name, C.toCsv(cn.rows, cnCols));
        const r = await bridge.composeMail({
          to: acc, subject: `Déclaration CNSS ${C.quarterLabel(q)} ${y} — ${company().name}`,
          body: `Bonjour,\n\nCi-joint le détail de la déclaration CNSS du ${C.quarterLabel(q).toLowerCase()} ${y} :\n`
            + `${pl(cn.employees, 'salarié')}, assiette ${C.money(cn.base, cur)}, part salarié ${C.money(cn.employee, cur)}, `
            + `part employeur ${C.money(cn.employer, cur)}, accident du travail ${C.money(cn.accident, cur)}.\n`
            + `Total dû : ${C.money(cn.total, cur)}. Échéance : ${C.fmtDate(cn.dueDate)}.\n\nMerci de vérifier avant dépôt.\n`,
          attachments: att ? [att] : [], mode: modeEnvoi()
        });
        emailComptablePret(acc, r, att ? 'le fichier CNSS' : null);
      };
      if ($('#an-csv')) $('#an-csv').onclick = async () => {
        // (plateforme) 1.73.0 — les colonnes du moteur commun (le Cabinet exporte le même état pour ses clients), et le total.
        const cols = C.COLONNES_SALAIRES_ANNEE.map(([key, label, montant]) => (montant ? { key, label, type: 'money' } : { key, label }));
        const total = { name: 'Total', cin: '', cnss: '', months: '', gross: an.gross, cnss_: an.cnss, irpp: an.irpp, css: an.css, net: an.net };
        const f = await bridge.saveText(`declaration-employeur-${y}.csv`, C.toCsv(an.rows.concat([total]), cols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
    }

    function drawRates() {
      const st = C.payrollSettings(data);
      // La TFP proposée par le métier (9.1.1). La ligne n'apparaît QUE si le métier en porte une :
      // écrire « Proposé : — » à côté d'un champ serait un bruit permanent pour quatorze métiers
      // sur quinze. Aujourd'hui aucun n'en porte, tant que le comptable n'a pas tranché.
      const tfpPropose = C.tfpSuggere(company().activity);
      // (1.248.1) Un montant s'écrit comme partout (« 2 000,000 »), pas « 2000 » d'une case numérique.
      const num = (k, lab, key, montant) => `<label class="field">${lbl(lab, key)}${montant ? `<input type="text" inputmode="decimal" data-montant autocomplete="off" name="${k}" value="${C.money(Number(st[k]) || 0, null, 3)}" class="num montant">` : `<input type="text" inputmode="decimal" data-montant autocomplete="off" name="${k}" value="${h(String(st[k] == null ? '' : st[k]).replace('.', ','))}" class="num">`}</label>`;
      // (1.253.0) Un taux s'écrit comme partout ailleurs, à la française (« 9,68 ») : la case du navigateur affichait « 9.68 »
      // à côté du tableau des contrats qui disait « 9,68 ».
      // Un montant porte son unité à côté de son libellé (9.4.8) : « Plafond annuel des frais : 2000 »
      // ne disait ni dinars ni par an, et « Déduction chef de famille (par an) » pas davantage.
      // (plateforme) 1.226.0 — ce qui est réglé et ce qui ne l'est pas, d'un coup d'œil (la maquette, « Réglages »).
      // (1.248.1) Chaque ligne mène à sa case (recette du 02/11 : « non réglé » sans geste ; il fallait chercher plus bas).
      const etatR = (t, v, ok, d, champ) => `<tr><td><b>${t}</b></td><td>${v}</td><td><span class="statut ${ok ? 'ok' : 'attire'}">${ok ? 'réglé' : 'non réglé'}</span>${d ? `<small class="muted"> ${d}</small>` : ''}</td><td class="r">${champ ? `<button type="button" class="btn btn-sm${ok ? ' btn-ghost' : ''}" data-rf-go="${champ}">${ok ? 'Voir' : 'Régler'}</button>` : ''}</td></tr>`;
      const majR = C.majorationsHs(st), offR = st.offDays || [0];
      const resumeR = `<section class="pa-carte" id="rf-etat"><div class="pa-carte-t"><b>Ta paie, réglage par réglage</b><span class="mu">ce qui sert au calcul ; ce qui n'est pas réglé le dit</span></div>
        <table class="list compact pa-liste"><thead><tr><th>Réglage</th><th>Dans ta paie</th><th>État</th><th></th></tr></thead><tbody>
          ${etatR('CNSS', `${pct(st.cnssEmployee)} % salarié · ${pct(st.cnssEmployer)} % employeur`, Number(st.cnssEmployee) > 0, 'À VÉRIFIER chaque année', 'cnssEmployee')}
          ${etatR('Accident du travail', `${pct(st.accidentRate)} %`, Number(st.accidentRate) > 0, 'il dépend de ton activité', 'accidentRate')}
          ${etatR('Impôt sur le revenu', 'barème annuel par tranches', true, 'À VÉRIFIER : la loi de finances', 'upTo')}
          ${etatR('Congés', `${pct(st.leaveDaysPerYear)} jours ouvrables par an`, Number(st.leaveDaysPerYear) > 0, 'ta convention peut en donner plus', 'leaveDaysPerYear')}
          ${etatR('Jours de travail', `repos : ${h(offR.map(i2 => ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][i2]).join(', ') || 'aucun')} · un mois complet : ${pct(Number(st.workedDays) || 26)} jours`, true, '', 'workedDays')}
          ${etatR('Heures sup', majR.length ? majR.map(x => `+${pct(x)} %`).join(', ') : '—', majR.length > 0, 'À VÉRIFIER : le Code du travail', 'hsMaj1')}
          ${(() => { const anc = (st.anciennete || []).filter(t => Number(t.ans) > 0 && Number(t.taux) > 0); return etatR('Prime d\'ancienneté', anc.length ? anc.map(t => `${pct(t.ans)} ans : ${pct(t.taux)} %`).join(' · ') : '—', anc.length > 0, 'ta convention collective', 'anc-add'); })()}
          ${etatR('Convention collective', st.convention ? h(st.convention) : '—', !!String(st.convention || '').trim(), 'elle peut fixer une prime d\'ancienneté, un minimum par catégorie, la nuit et le férié (À VÉRIFIER : son texte)', 'convention')}
          ${etatR('Préavis et licenciement', `${Number(st.preavisJours) > 0 ? `préavis ${pct(st.preavisJours)} jours` : 'préavis —'} · ${Number(st.indemniteJoursParAn) > 0 ? `${pct(st.indemniteJoursParAn)} jours par année` : 'indemnité —'}`, Number(st.preavisJours) > 0 && Number(st.indemniteJoursParAn) > 0, 'À VÉRIFIER : le Code du travail', 'preavisJours')}
        </tbody></table></section>`;
      // Les boutons du résumé : la case du réglage, à l'écran, le curseur dedans (posé une fois sur le conteneur).
      if (!$('#p-body').dataset.rfGo) { $('#p-body').dataset.rfGo = '1'; $('#p-body').addEventListener('click', ev => {
        const b = ev.target.closest('[data-rf-go]'); if (!b) return;
        const c = $(`#p-body [name="${b.dataset.rfGo}"], #p-body [data-b="${b.dataset.rfGo}"]`); if (!c) return;
        c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.focus({ preventScroll: true }); if (c.select) c.select();
      }); }
      // (1.257.0) Tant que la convention n'est pas écrite, la page le dit en tête (la maquette, « Réglages et convention »).
      const cab = (company().accountantName || '').trim();
      const convB = String(st.convention || '').trim() ? '' : `<div class="bandeau ambre pa-bandeau" id="rf-conv-b">${lfIc('aide', 18)}<span class="txt"><b>Ta convention collective n'est pas encore réglée dans ta paie</b>Elle peut demander une prime d'ancienneté, un minimum par catégorie, une majoration de nuit ou de férié. Tant qu'elle n'est pas saisie, tes bulletins appliquent seulement le Code du travail et tes réglages : vérifie-la${cab ? ` avec ${h(cab)}` : ' avec ton comptable'} (À VÉRIFIER : son nom et son texte).</span><button type="button" class="btn btn-sm" data-rf-go="convention">Écrire son nom</button></div>`;
      $('#p-body').innerHTML = `${convB}${resumeR}
        <div class="panel" style="border-inline-start:3px solid var(--warning)"><h2>Ces chiffres sont à toi ${info('pay.rates')}</h2>
          <p class="small">Aucun taux n'est écrit en dur dans SkanFact : tout ce que tu vois ici sert au calcul, et rien d'autre. Les valeurs livrées sont celles couramment appliquées en Tunisie <b>au moment où cette version a été écrite</b> — elles changent à chaque loi de finances.
          <em>À VÉRIFIER avec ton comptable, et à corriger ici dès qu'un taux bouge.</em></p>
        </div>
        ${(() => {
          // (plateforme) 1.59.0 — des barèmes enregistrés avant les taux de 2026 les gardent : on le dit.
          const vieux = C.tauxAvant2026(data);
          return vieux.length ? `<div class="warn-box mb" id="rf-2026"><div><b>Tes barèmes gardent des taux d'avant 2026</b> : ${vieux.map(x => `${h(x.libelle)} ${pct(x.garde)} % au lieu de ${pct(x.livre)} %`).join(', ')} (les taux des documents de paie de 2026). <em>À VÉRIFIER avec ton comptable.</em></div>
            <div class="mt"><button type="button" class="btn btn-sm" id="rf-2026-prendre">Prendre les taux de 2026</button> <span class="small muted">Ils s'écrivent dans les cases ci-dessous ; rien n'est gardé avant « Enregistrer les barèmes ».</span></div></div>` : '';
        })()}
        <form id="rf">
          <div class="panel"><h2>Cotisations sociales</h2>
            <div class="grid-3">
              ${num('cnssEmployee', 'CNSS part salarié (%)', 'pay.cnssEmployee')}
              ${num('cnssEmployer', 'CNSS part employeur (%)', 'pay.cnssEmployerRate')}
              ${num('accidentRate', 'Accident du travail (%)', 'pay.accident')}
              ${num('tfpRate', 'Taxe de formation professionnelle — TFP (%)', 'pay.tfp')}${tfpPropose !== null ? `<div class="small muted" style="grid-column:auto;margin-top:-8px">Proposé pour ton métier : ${pct(tfpPropose)} % <em>(À VÉRIFIER)</em></div>` : ''}
              ${num('foprolosRate', 'FOPROLOS (%)', 'pay.foprolos')}
            </div>
            <p class="small muted mt">La TFP et le FOPROLOS sont des taxes patronales sur la masse salariale, déclarées chaque mois avec la TVA. <em>À VÉRIFIER avec ton comptable : 1 % de TFP pour les industries manufacturières, 2 % ailleurs.</em></p>
          </div>
          ${/* H4 (10.15.0) — un CIVP, un contrat Karama, un saisonnier peuvent être exonérés d'une
                partie des charges ou de l'impôt. Aucune de ces règles n'est écrite : la table part
                vide, une case vide veut dire « le taux ci-dessus », et chaque bulletin du contrat
                suit ce qui est réglé ici — figé avec son calcul. */''}
          <div class="panel"><h2>Les contrats aux règles particulières ${info('pay.regimes')}</h2>
            <p class="small">Laisse une case <b>vide</b> pour appliquer le taux général ci-dessus ; mets <b>0</b> pour une exonération. Chaque bulletin d'un salarié sous ce contrat suivra la ligne. <em>À VÉRIFIER avec ton comptable : SkanFact ne connaît aucune de ces exonérations, elles changent d'un dispositif et d'une année à l'autre.</em></p>
            <div class="scroll-x"><table class="list compact" id="rf-rc"><thead><tr><th>Contrat</th>${C.REGIME_TAUX.map(([, lab]) => `<th class="r nw">${h(lab)} (%)</th>`).join('')}<th class="nw">Sans IRPP</th></tr></thead>
              <tbody>${C.CONTRACT_TYPES.filter(([k]) => k !== 'cdi').map(([k, lab]) => {
                const r = C.regimeDuContrat(st, k);
                const nom = lab.split(' —')[0];
                return `<tr><td class="nw" title="${h(lab)}">${h(nom)}</td>${C.REGIME_TAUX.map(([t, tl]) => `<td class="r"><input type="number" class="num" data-rc="${k}" data-k="${t}" value="${r[t] != null ? r[t] : ''}" placeholder="${h(pct(st[t]))}" step="0.01" min="0" max="100" style="width:78px" aria-label="${h(nom)} : ${h(tl)} (%)"></td>`).join('')}
                  <td><input type="checkbox" data-rc-irpp="${k}" ${r.sansIrpp ? 'checked' : ''} aria-label="${h(nom)} : exonéré d'IRPP"></td></tr>`;
              }).join('')}</tbody></table></div>
          </div>
          <div class="panel"><h2>Impôt sur le revenu</h2>
            <div class="grid-3">
              ${num('solidarity', 'Contribution de solidarité (%)', 'pay.solidarity')}
              ${num('proRate', 'Frais professionnels (%)', 'pay.pro')}
              ${num('proCap', `Plafond annuel des frais (${h(cur)})`, 'pay.proCap', true)}
              ${num('headOfFamily', `Déduction chef de famille (${h(cur)} par an)`, 'pay.family', true)}
              ${num('perChild', `Déduction par enfant (${h(cur)} par an)`, 'pay.children', true)}
              ${num('maxChildren', 'Nombre maximum d\'enfants comptés', 'pay.children')}
            </div>
          </div>
          <div class="panel"><h2>Congés et jours ouvrables</h2>
            <div class="grid-3">
              ${num('leaveDaysPerYear', 'Congés payés par an (jours ouvrables)', 'hr.perYear')}
              ${num('workedDays', 'Jours ouvrables d\'un mois complet', 'pay.workedDays')}
            </div>
            <p class="small muted mt">Ces deux chiffres servent au calcul des congés acquis et à la réduction d'une absence non payée. <em>À VÉRIFIER avec ton comptable : la convention collective de ton secteur peut prévoir davantage de congés.</em></p>
          </div>
          ${/* (plateforme) 1.60.0 — les heures supplémentaires du pointage. Aucune majoration n'est écrite d'avance. */''}
          <div class="panel" id="rf-hs"><h2>Heures supplémentaires ${info('pay.hs')}</h2>
            <div class="grid-2">
              ${num('heuresMois', 'Heures d\'un mois complet', 'pay.heuresMois')}
              ${num('hsMaj1', 'Majoration 1 (%)', 'pay.hs')}
              ${num('hsMaj2', 'Majoration 2 (%)', 'pay.hs')}
              ${num('hsMaj3', 'Majoration 3 (%)', 'pay.hs')}
            </div>
            <p class="small muted mt">Une heure supplémentaire vaut le brut de la fiche divisé par les heures d'un mois complet, majoré ; chaque majoration réglée a sa colonne dans le Pointage, une majoration à 0 n'y paraît pas. <em>À VÉRIFIER avec ton comptable : les majorations dépendent du régime horaire, du moment (nuit, repos, jour férié) et de ta convention collective.</em></p>
          </div>
          ${/* (1.256.0) La sortie et l'ancienneté : rien n'est écrit d'avance (0 et une liste vide ne font rien). */''}
          <div class="panel" id="rf-sortie"><h2>La convention, la sortie et l'ancienneté</h2>
            <label class="field">${lbl('Convention collective (son nom)', 'pay.convention')}<input type="text" name="convention" value="${h(st.convention || '')}" maxlength="120" placeholder="Convention collective de la boulangerie" autocomplete="off"></label>
            <div class="grid-2">
              ${num('preavisJours', 'Préavis d\'une démission ou d\'un licenciement (jours)', 'pay.preavis')}
              ${num('indemniteJoursParAn', 'Indemnité de licenciement (jours de salaire par année d\'ancienneté)', 'pay.indemnite')}
            </div>
            <h3 class="sub-h">Prime d'ancienneté ${info('pay.anciennete')}</h3>
            <table class="list compact rf-anc"><thead><tr><th class="r">Dès (années)</th><th class="r">Taux du salaire de base</th><th></th></tr></thead><tbody id="rf-anc"></tbody></table>
            <button type="button" class="btn btn-sm mt" id="anc-add" data-b="anc-add">+ Une tranche</button>
            <p class="small muted mt">0 jour, ou aucune tranche : rien ne se calcule. La prime d'ancienneté s'ajoute aux bulletins (au jour, imposable) dès la tranche atteinte ; le préavis propose le dernier jour d'une sortie ; l'indemnité entre au solde de tout compte d'un licenciement. <em>À VÉRIFIER avec ton comptable : le Code du travail et ta convention collective (la base de la prime, les tranches, le barème).</em></p>
          </div>
          <div class="panel"><h2>Barème progressif annuel ${info('pay.brackets')}</h2>
            <table class="list compact"><thead><tr><th class="r">De</th><th class="r">Jusqu'à (${h(cur)})</th><th class="r" style="width:140px">Taux</th><th></th></tr></thead>
              <tbody id="rf-br"></tbody></table>
            <button type="button" class="btn btn-sm mt" id="add-br">+ Tranche</button>
            <p class="small muted mt">La dernière tranche doit rester ouverte (« au-delà ») : c'est elle qui s'applique aux revenus les plus élevés.</p>
            <div class="mt" id="rf-demo"></div>
          </div>
          <div class="inline">
            <button type="button" class="btn" id="rf-reset">Revenir aux valeurs livrées</button>
          </div>
          <div class="save-bar" id="rf-bar" hidden>
            <span>Modifications non enregistrées</span>
            <button type="button" class="btn" id="rf-cancel">Abandonner les modifications</button>
            <button type="button" class="btn btn-primary" id="rf-save">Enregistrer les barèmes</button>
          </div>
        </form>`;
      const brackets = deepCopy(st.brackets);
      const anciennete = deepCopy(Array.isArray(st.anciennete) ? st.anciennete : []);
      const drawAnc = () => {
        $('#rf-anc').innerHTML = anciennete.length ? anciennete.map((t, i) => `<tr data-ai="${i}"><td class="r"><input type="number" class="num" data-anc="ans" value="${t.ans === '' || t.ans == null ? '' : t.ans}" min="1" max="50" step="1" style="width:90px" aria-label="Tranche ${i + 1} : dès combien d'années"></td>
          <td class="r"><input type="text" inputmode="decimal" data-montant class="num" data-anc="taux" value="${t.taux === '' || t.taux == null ? '' : pct(t.taux)}" style="width:90px" aria-label="Tranche ${i + 1} : taux en %"> %</td>
          <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-anc-x="${i}" aria-label="Retirer la tranche ${i + 1}">✕</button></td></tr>`).join('')
          : '<tr><td colspan="3" class="muted small">Aucune tranche : pas de prime d\'ancienneté.</td></tr>';
        $$('[data-anc-x]', $('#rf-anc')).forEach(b => b.onclick = () => { anciennete.splice(Number(b.dataset.ancX), 1); marquer(); drawAnc(); });
      };
      // 10.12.0 — une tranche ne se modifiait PAS. Le formulaire entier redessinait les lignes du
      // barème à chaque frappe (`#rf.oninput`), alors que la valeur tapée n'était lue qu'au `change` :
      // le premier chiffre détruisait le champ, le curseur tombait dans la page, et la ligne revenait
      // à son ancienne valeur. Les lignes ne se redessinent plus qu'à l'ajout ou au retrait d'une
      // tranche ; pendant la frappe, on met à jour la DONNÉE, la cellule « De » qui en dépend et
      // l'exemple — le remède de la 7.17.0 (le solde de tout compte), un écran plus loin.
      const drawRows = () => {
        $('#rf-br').innerHTML = brackets.map((b, i) => `<tr data-i="${i}"><td class="nw r" data-de="${i}"></td>
            <td class="r">${b.upTo == null ? '<span class="muted">au-delà</span>' : `<input type="text" inputmode="decimal" data-montant autocomplete="off" class="num montant" data-b="upTo" value="${C.money(b.upTo, null, 3)}" style="width:130px" aria-label="Tranche ${i + 1} : jusqu'à">`}</td>
            <td class="r"><input type="number" class="num" data-b="rate" value="${b.rate}" step="0.5" min="0" max="100" style="width:90px" aria-label="Tranche ${i + 1} : taux"> %</td>
            <td class="r">${brackets.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-brm="${i}" title="Retirer cette tranche" aria-label="Retirer la tranche ${i + 1}">✕</button>` : ''}</td></tr>`).join('');
        $$('[data-brm]', $('#rf-br')).forEach(b => b.onclick = () => { brackets.splice(Number(b.dataset.brm), 1); marquer(); drawRows(); });
        majDe(); drawDemo();
      };
      const majDe = () => {
        let from = 0;
        brackets.forEach((b, i) => { const c = $(`#rf-br [data-de="${i}"]`); if (c) c.textContent = C.money(from, cur); from = b.upTo == null ? from : b.upTo; });
      };
      // Un exemple vaut mieux qu'un barème : on montre ce que ça donne sur un salaire courant.
      const drawDemo = () => {
        const demo = [1000, 1500, 2500, 4000].map(g => {
          const c = C.computePayslip({ grossSalary: g, children: 0, headOfFamily: false }, {}, { ...readRates(), brackets });
          return `<tr><td>${C.money(g, cur)}</td><td class="r">${C.money(c.cnssEmployee, cur)}</td><td class="r">${C.money(C.round3(c.irpp + c.css), cur)}</td><td class="r"><strong>${C.money(c.net, cur)}</strong></td><td class="r">${C.money(c.employerCost, cur)}</td></tr>`;
        }).join('');
        $('#rf-demo').innerHTML = `<h3 class="sub-h">Ce que ça donne, pour un célibataire sans enfant</h3>
          <table class="list compact"><thead><tr><th>Brut</th><th class="r">CNSS</th><th class="r">Impôt</th><th class="r">Net</th><th class="r">Coût employeur</th></tr></thead><tbody>${demo}</tbody></table>`;
      };
      const readRates = () => {
        const v = formValues($('#rf'));
        const out = {};
        ['cnssEmployee', 'cnssEmployer', 'accidentRate', 'tfpRate', 'foprolosRate', 'solidarity', 'proRate', 'proCap', 'headOfFamily', 'perChild', 'maxChildren', 'leaveDaysPerYear', 'workedDays', 'heuresMois', 'hsMaj1', 'hsMaj2', 'hsMaj3', 'preavisJours', 'indemniteJoursParAn']
          .forEach(k => { out[k] = Number(v[k]) || 0; });
        out.convention = String(v.convention || '').trim().slice(0, 120);
        out.anciennete = anciennete.map(t => ({ ans: Number(t.ans) || 0, taux: Number(t.taux) || 0 })).filter(t => t.ans > 0 && t.taux > 0).sort((a, b) => a.ans - b.ans);
        // Les régimes des contrats (H4) : une case vide n'est pas un zéro — elle laisse le taux général.
        const rc = {};
        $$('#rf-rc [data-rc]').forEach(i => { if (i.value.trim() !== '' && !i.validity.badInput) (rc[i.dataset.rc] = rc[i.dataset.rc] || {})[i.dataset.k] = Number(i.value); });
        $$('#rf-rc [data-rc-irpp]').forEach(i => { if (i.checked) (rc[i.dataset.rcIrpp] = rc[i.dataset.rcIrpp] || {}).sansIrpp = true; });
        out.regimesContrat = C.normaliserRegimes(rc);
        return out;
      };
      // Le garde-fou des Paramètres (7.30.0), porté ici : le bouton « Enregistrer » vivait trois
      // écrans sous le premier taux, vert au repos (U-11), et changer d'onglet jetait en silence ce
      // qu'on venait de régler. La barre n'apparaît qu'après une modification, reste collée au bas
      // de l'écran, et quitter la page ou l'onglet pose la question.
      let modifie = false;
      const marquer = () => { if (modifie) return; modifie = true; $('#rf-bar').hidden = false; reportDirty(); };
      const enregistrer = () => {
        const b = brackets.filter(x => x.upTo == null || Number(x.upTo) > 0);
        if (!b.some(x => x.upTo == null)) b.push({ upTo: null, rate: b.length ? b[b.length - 1].rate : 0 });
        // `tfpTouche` (9.1.1) : enregistrer ces barèmes, c'est avoir décidé. Sans ce drapeau, la
        // proposition du métier reviendrait écraser le taux le jour où quelqu'un change d'activité
        // dans l'assistant — le défaut exact de `regimeTouche` en 7.30.0, qui n'était pas enregistré
        // et repartait à `undefined` au rejeu.
        // (1.249.0) Les jours de repos se règlent dans « Les horaires » du pointage : enregistrer les barèmes ne les gardait pas.
        data.payrollSettings = { ...(Array.isArray((data.payrollSettings || {}).offDays) ? { offDays: data.payrollSettings.offDays } : {}), ...readRates(), brackets: b, tfpTouche: true };
        save(true); modifie = false; clearGuard(garde);
        return true;
      };
      const garde = { dirty: () => modifie, what: 'les barèmes de paie', save: enregistrer };
      setGuard(garde);
      drawRows(); drawAnc();
      $('#anc-add').onclick = () => { const der = anciennete[anciennete.length - 1]; anciennete.push({ ans: der ? Number(der.ans) + 5 : 2, taux: '' }); marquer(); drawAnc(); const c = $$('#rf-anc [data-anc=taux]').pop(); if (c) c.focus(); };
      $('#rf').oninput = $('#rf').onchange = e => {
        const el = e.target;
        if (el && el.dataset && el.dataset.anc) {
          const i = Number(el.closest('tr').dataset.ai);
          if (anciennete[i]) anciennete[i][el.dataset.anc] = el.value.trim() === '' ? '' : (el.dataset.anc === 'taux' ? lireMontant(el.value) : Number(el.value));
        }
        if (el && el.dataset && el.dataset.b) {
          const i = Number(el.closest('tr').dataset.i);
          // Un champ vidé pour retaper n'est pas un zéro (7.19.0) : on n'écrit rien tant qu'il est vide.
          if (el.value.trim() !== '' && !el.validity.badInput) brackets[i][el.dataset.b] = 'montant' in el.dataset ? lireMontant(el.value) : Number(el.value);
          majDe();
        }
        marquer(); drawDemo();
      };
      $('#add-br').onclick = () => {
        const last = brackets[brackets.length - 1];
        const prev = brackets.length > 1 ? brackets[brackets.length - 2].upTo : 0;
        brackets.splice(brackets.length - 1, 0, { upTo: (Number(prev) || 0) + 10000, rate: last.rate });
        marquer(); drawRows();
      };
      if ($('#rf-2026-prendre')) $('#rf-2026-prendre').onclick = () => {
        C.tauxAvant2026(data).forEach(x => { const i = $(`#rf [name=${x.cle}]`); if (i) i.value = x.livre; });
        marquer(); drawDemo();
        toast('Les taux de 2026 sont dans leurs cases : « Enregistrer les barèmes » les garde.');
      };
      $('#rf-save').onclick = () => { enregistrer(); toast('Barèmes enregistrés — les bulletins déjà établis ne changent pas'); draw(); };
      $('#rf-cancel').onclick = async () => {
        if (!await confirmDialog('Abandonner les modifications des barèmes ?\n\nCe qui vient d\'être saisi et pas encore enregistré sera perdu.', 'Abandonner', true)) return;
        modifie = false; clearGuard(garde); draw();
      };
      $('#rf-reset').onclick = async () => {
        // Le bouton dit le geste, pas « Confirmer » : on REMPLACE des taux qu'on avait décidés.
        if (!await confirmDialog('Revenir aux valeurs livrées avec SkanFact ?\n\nLes taux et le barème réglés ici seront remplacés. Les bulletins déjà établis gardent leur propre calcul et ne changeront pas.', 'Revenir aux valeurs livrées', true)) return;
        modifie = false; clearGuard(garde);
        data.payrollSettings = {}; save(true); toast('Barèmes réinitialisés'); draw();
      };
    }

    // L'en-tête se redessine AVEC le corps : c'est ce qui manquait, et c'est pour ça que le bouton
    // vert contredisait l'onglet. `bindHead` rearme le bouton du moment — sans quoi il serait
    // visible et inerte, ce qui est pire qu'absent.
    // (1.267.0) Les quatre étapes du mois, en tête de « Le mois » (la maquette, « chemin-m ») : chacune dit où elle en est, la
    // première qui n'est pas faite est « en cours », celle qu'on regarde est ouverte. Un clic l'ouvre. « Pointer » porte ce qui
    // reste à régler, « Déclarer » les déclarations proches ; « Par salarié » et « Les horaires » sont sous « Pointer ».
    const etapesHtml = () => {
      const y = Number(s.year), m = Number(s.month), ouverte = ETAPE_DE[s.tab] || '';
      // Le compte de « À régler » se dit même sur une étape faite : un compteur dit le chiffre de sa liste (1.259.0).
      const ET = etapesDuMois(y, m), nbReg = ptVerrouille(ymPt(y, m)) ? 0 : aReglerMois(y, m).length;
      const dues = C.socialDue(data, C.today()).filter(x => x.late || x.dueDate <= C.addDays(C.today(), 31)).length;
      const nb = { pointage: nbReg ? [nbReg, `${pl(nbReg, 'chose')} à régler`] : null, declarations: dues ? [dues, `${pl(dues, 'déclaration')} à déposer bientôt`] : null };
      return `<div class="pa-chemin" role="tablist" aria-label="${h(capi(MONTHS_LONG[m - 1]))} ${y} en quatre étapes">${ET.map((e, i) =>
        `<button type="button" role="tab" class="pa-etape${e.etat === 'fait' ? ' fait' : e.etat === 'ici' ? ' cours' : ''}${ouverte === e.id ? ' ouverte' : ''}" data-sous="${e.id}" data-etat="${e.etat}" aria-selected="${ouverte === e.id}"><span class="n">${e.etat === 'fait' ? lfIc('coche', 13, 3) : i + 1}</span><b>${h(e.titre)}</b>${e.qui ? `<small class="pa-qui">${h(e.qui)}</small>` : ''}<span class="d">${h(e.dit)}</span>${nb[e.id] ? `<span class="pm-nb" title="${h(nb[e.id][1])}">${nb[e.id][0]}</span>` : ''}</button>`).join('')}</div>
        ${(() => { const ici = ET.find(e => e.etat === 'ici'), vue = ET.find(e => e.id === ouverte);
          // (1.330.0) L'étape affichée n'est pas celle du moment (une étape faite qu'on relit, une à venir) : la ligne le dit et
          // y mène — un seul repère dans la frise, et plus de doute sur « où j'en suis ».
          return ici && vue && ici.id !== vue.id ? `<p class="pa-ou" id="pa-ou">${lfIc(vue.etat === 'fait' ? 'coche' : 'aide', 14)}<span>Tu regardes <b>${h(vue.titre)}</b>${vue.etat === 'fait' ? ', fait' : ''}. L'étape du moment : <b>${h(ici.titre)}</b> — ${h(ici.dit)}.</span><button type="button" class="btn btn-sm" data-aller-sous="${h(ici.id)}">Aller à « ${h(ici.titre)} »</button></p>` : ''; })()}
        ${ouverte === 'pointage' ? `<div class="pa-sous-l" role="group" aria-label="Le pointage du mois"><button type="button" data-sous="pt-salarie" aria-pressed="${s.tab === 'pt-salarie'}">${lfIc('personne', 14)} Par salarié</button><button type="button" data-sous="pt-horaires" aria-pressed="${s.tab === 'pt-horaires'}">${lfIc('horloge', 14)} Les horaires</button></div>` : ''}`;
    };
    // (1.330.0) La frise du mois et l'en-tête suivent ce que le pointage vient de changer (mois validé, journées validées,
    // mois rouvert) : sous un mois validé, ils disaient encore « 1 chose à régler » jusqu'au clic suivant. Redessinés
    // seulement quand la frise a changé : le pointage se redessine à chaque case.
    let friseVue = '';
    const majTeteDuMois = () => { if (!$('#p-sous .pa-chemin') || etapesHtml() === friseVue) return; $('#p-head').innerHTML = pHead(); bindHead(); };
    const bindHead = () => {
      $('#p-mois').innerHTML = pMois(); $('#p-mois').hidden = (P_SANS_ANNEE.includes(s.tab) && s.tab !== 'pt-horaires') || !data.employees.length;
      $('#p-mois').classList.toggle('pa-mois-inerte', s.tab === 'pt-horaires'); $('#p-mois').inert = s.tab === 'pt-horaires';
      $('#p-mois').title = s.tab === 'pt-horaires' ? 'Les horaires valent pour tous les mois' : '';
      // Au téléphone, la bande défile au doigt : le mois choisi vient au milieu (sinon on voyait janvier).
      { const on = $('#p-mois .cp-mo.on'), rangee = on && on.parentElement; if (rangee && rangee.scrollWidth > rangee.clientWidth) rangee.scrollLeft = on.offsetLeft - (rangee.clientWidth - on.offsetWidth) / 2; }
      // (1.251.0) Un mois de la bande : toute la page passe à ce mois (le trimestre CNSS suit) ; « Toute l'année » ouvre l'année.
      $$('#p-mois [data-p-mois]').forEach(b2 => b2.onclick = () => {
        const m2 = b2.dataset.pMois;
        if (!m2) { s.tab = 'annee'; marquerVue(); draw(); return; }
        s.month = m2; s.quarter = String(Math.ceil(Number(m2) / 3)); s.moisTouche = true;
        if (s.tab === 'annee') s.tab = (etapesDuMois(Number(s.year), Number(m2)).find(e => e.etat === 'ici') || { id: 'bulletins' }).id;
        draw(); const f = $(`#p-mois [data-p-mois="${m2}"]`); if (f) f.focus();
      });
      $$('#p-an-prec, #p-an-suiv').forEach(b2 => b2.onclick = () => { const k = years.indexOf(s.year) + (b2.id === 'p-an-prec' ? 1 : -1); if (years[k]) { s.year = years[k]; s.moisTouche = true; draw(); const f = $(`#${b2.id}`); if (f && !f.disabled) f.focus(); } });


      if ($('#p-gen')) $('#p-gen').onclick = () => etablirBulletins();
      if ($('#p-regler')) $('#p-regler').onclick = () => allerVue('pointage');
      if ($('#p-envoyer')) $('#p-envoyer').onclick = () => allerVue('pointage');
      if ($('#p-ecrire')) $('#p-ecrire').onclick = () => navigate('#/comptable');
      if ($('#p-bap')) $('#p-bap').onclick = () => approuverBulletins(Number(s.year), Number(s.month));
      if ($('#p-corr-ok')) $('#p-corr-ok').onclick = () => { const x = C.payslipsOf(data, Number(s.year), Number(s.month)).find(b => correctionEnAttente(b)); if (x) accepterCorrection(x); };
      if ($('#p-payer')) $('#p-payer').onclick = () => payerSalairesFenetre(Number(s.year), Number(s.month), () => draw());
      if ($('#p-remettre')) $('#p-remettre').onclick = () => remettreBulletins();
      // (1.267.0) Le vert d'« Aujourd'hui » mène au mois et à l'étape de son geste ; « Embaucher » ouvre la fiche d'un salarié.
      if ($('#p-jour-go')) $('#p-jour-go').onclick = () => { const p = principalDuJour(); if (p) allerAuMois(p); };
      if ($('#p-embaucher')) $('#p-embaucher').onclick = () => employeeForm(null, () => { paieState.tab = 'salaries'; render(); });
      // (1.256.0) Le menu ⋯ de la maquette : quatre groupes (ce mois, les salariés, calculer, réglages).
      if ($('#p-plus')) $('#p-plus').onclick = ev => { const y0 = Number(s.year), m0 = Number(s.month), mo0 = MONTHS_LONG[m0 - 1], du = C.payslipsOf(data, y0, m0); RowMenu.ouvrir(ev.currentTarget, [
        { titre: 'Ce mois' },
        ...(du.length ? [{ icon: 'loupe', label: 'Journal de paie', hint: `${mo0} ${y0} : une ligne par salarié, les totaux · aperçu, PDF`, run: () => journalDePaieFenetre(y0, m0) },
          { icon: 'loupe', label: 'Ordre de virement', hint: `les salaires de ${mo0} payés par virement · aperçu, PDF`, run: () => ordreVirementApercu(y0, m0) }] : []),
        { icon: 'ecriture', label: 'Les primes et retenues du mois…', hint: `${mo0} : prime exceptionnelle, panier, commission, retenue ; ou collées d'un tableur`, run: () => variablesFenetre(y0, m0, () => draw()) },
        { titre: 'Les salariés' },
        { icon: 'dossier', label: 'Registre du personnel', hint: 'la liste que l\'inspection du travail peut demander', run: () => allerVue('registre') },
        { icon: 'pdf', label: 'Un document pour un salarié', hint: 'bulletin, attestations, contrat, avenant, certificat, solde', run: () => choisirSalarie('Un document pour qui ?', e => hrDocForm(e, () => draw())) },
        { icon: 'extraire', label: 'Importer des salariés', hint: 'depuis un tableur ou ton ancien logiciel de paie', run: () => importerTableau('salaries', () => { paieState.tab = 'salaries'; render(); }) },
        { titre: 'Calculer' },
        { icon: 'argent', label: 'Combien coûte une embauche ?', hint: 'le net et le coût d\'un salaire, à partir du brut ou du net', run: () => simulationEmbauche() },
        { icon: 'argent', label: 'Augmenter les salaires…', hint: 'plusieurs salariés d\'un coup, ou un seul depuis un mois passé : le rappel se calcule', run: () => augmentationLot(() => draw()) },
        { icon: 'pdf', label: 'Une saisie sur salaire reçue', hint: 'la retenue d\'un jugement, chaque mois', run: () => choisirSalarie('Une saisie sur le salaire de qui ?', e => saisieFenetre(e, null, () => draw())) },
        { icon: 'annuler', label: 'Un départ…', hint: 'démission, fin de contrat, licenciement, retraite', run: () => choisirSalarie('Qui part ?', e => sortieFenetre(e, () => draw())) },
        { titre: 'Réglages' },
        { icon: 'modifier', label: 'Réglages de la paie', hint: 'taux, horaires, convention : ce qui est réglé et ce qui ne l\'est pas', run: () => allerVue('baremes') },
        { icon: 'client', label: 'Qui fait ma paie', hint: `${(PAIE_MODES.find(x => x[0] === paieMode()) || [])[1] || ''} · changer…`, run: () => quiFaitLaPaie() }
      ], { titre: 'La paie', classe: 'gestes-menu', label: 'Autres gestes de la paie' }); };
      // (1.256.0) La pastille des présences : les demandes de congé qui attendent une réponse.
      const dem = (data.leaves || []).filter(l => l.statut === 'demande').length, bp = $('#p-tabs [data-af="pointage"]');
      // (1.267.0, morceau C) « Aujourd'hui » compte les demandes et « À ne pas oublier » (la maquette) ; « Le mois », ce qui
      // retient les bulletins du mois choisi (la même liste que l'étape « Pointer »).
      const rap = rappelsDuJour().length, nAuj = dem + rap;
      if (bp) { bp.hidden = !nAuj; bp.textContent = nAuj ? String(nAuj) : ''; bp.title = nAuj ? [dem ? `${pl(dem, 'demande')} de congé à répondre` : '', rap ? `${pl(rap, 'chose')} à ne pas oublier` : ''].filter(Boolean).join(' · ') : ''; }
      const nMo = C.missingPayslips(data, Number(s.year), Number(s.month)).length ? bloquantsDe(Number(s.year), Number(s.month)).length : 0, bmo = $('#p-tabs [data-af="bulletins"]');
      if (bmo) { bmo.hidden = !nMo; bmo.textContent = nMo ? String(nMo) : ''; bmo.title = nMo ? `${pl(nMo, 'chose')} à régler avant les bulletins` : ''; }
      const af = aFaireSalaries(), b = $('#p-tabs [data-af="salaries"]');
      if (b) { b.hidden = !af; b.textContent = af ? String(af) : ''; b.title = af ? `${pl(af, 'fiche')} à compléter` : ''; }
      // (plateforme) 1.234.0 — la pastille des déclarations (la maquette) : celles dont l'échéance est passée ou proche, pas encore déposées.
      // (1.256.0) Les sous-vues comme la maquette : une rangée d'onglets soulignés (l'icône, le nom ; ce qu'il montre au survol).
      const vueP = PAIE_VUE_DE[s.tab] || s.tab;
      // (1.355.0) Sans salarié, ni « La journée » ni « Congés et absences » : deux onglets sous l'état vide s'allumaient sur rien.
      $('#p-sous').innerHTML = (friseVue = vueP === 'bulletins' && data.employees.length ? etapesHtml() : '') || (PAIE_SOUS[vueP] && data.employees.length ? `<div class="onglets-f pa-sous pm-sous" role="tablist" aria-label="${h((PAIE_VUES.find(v => v[0] === (PAIE_VUE_DE[s.tab] || s.tab)) || [])[1] || '')}">${PAIE_SOUS[PAIE_VUE_DE[s.tab] || s.tab].map(([id, l, ic, d]) => `<button type="button" role="tab" data-sous="${id}" aria-selected="${s.tab === id}" title="${h(d || '')}">${ic ? lfIc(ic, 15) : ''}<b>${l}</b>${id === 'pointage' && !ptVerrouille(ymPt(s.ptY, s.ptM)) ? (n => n ? ` <span class="pm-nb" title="${pl(n, 'chose')} à régler">${n}</span>` : '')(aReglerMois(Number(s.ptY), Number(s.ptM)).length) : ''}</button>`).join('')}</div>` : '');
      $$('#p-sous [data-sous]').forEach(b2 => b2.onclick = async () => { if (b2.dataset.sous === s.tab || !await leaveOk()) return; clearGuard(); s.tab = b2.dataset.sous; draw(); });
      // (1.330.0) « Aller à « Bulletins » » : son propre attribut, pour qu'une étape de la frise reste UN élément.
      $$('#p-sous [data-aller-sous]').forEach(b2 => b2.onclick = async () => { if (!await leaveOk()) return; clearGuard(); s.tab = b2.dataset.allerSous; draw(); });
      const ouvrirSalarie = () => employeeForm(null, () => { paieState.tab = 'salaries'; render(); });
      if ($('#new-emp')) $('#new-emp').onclick = ouvrirSalarie;
      if ($('#emp-first')) $('#emp-first').onclick = ouvrirSalarie;
      if ($('#emp-imp')) $('#emp-imp').onclick = () => importerTableau('salaries', () => { paieState.tab = 'salaries'; render(); });
      if ($('#new-lv')) $('#new-lv').onclick = () => leaveForm(null, null, () => draw());
      if ($('#new-av')) $('#new-av').onclick = () => advanceForm(null, null, () => draw());
    };
    const draw = dansUnLot(() => {
      // (1.256.0) Un rôle à qui les salaires sont cachés (la maquette, « Une vendeuse sans le droit Paie ») : la page le dit,
      // et à qui demander son bulletin ; aucun montant ne s'affiche.
      const dr = bridge.droitsDossier ? bridge.droitsDossier() : null;
      if (dr && Array.isArray(dr.cachees) && (dr.cachees.includes('payslips') || dr.cachees.includes('employees'))) {
        const qui = company().managerName || 'la direction';
        $('#p-head').innerHTML = `<div class="ph-t"><h1>Paie</h1></div>`;
        $('#p-body').innerHTML = `<div class="empty pa-droit" id="p-droit">${lfIc('cadenas', 28)}<b>La paie se voit avec le droit « Paie »</b><span>Les salaires de chacun ne se montrent qu'à qui a ce droit : ${h(qui)} et, s'il y en a un, le cabinet qui tient la paie. Ton rôle ne l'a pas.</span><span>Ton bulletin, un congé, une attestation : demande-les à ${h(qui)}. Ton bulletin t'est remis chaque mois.</span></div>`;
        return;
      }
      syncMois(); // chaque dessin relit le mois de la bande (un clic sur la bande ne repasse pas par la route)
      $('#p-head').innerHTML = pHead(); bindHead(); poserGuideMoi();
      if (!data.employees.length) { $('#p-body').innerHTML = ''; return; }
      if (s.tab === 'salaries') return drawEmployees();
      if (s.tab === 'conges') return drawLeaves();
      if (s.tab === 'avances') return drawAdvances();
      if (s.tab === 'declarations') return drawDeclarations();
      if (s.tab === 'registre') return drawRegister();
      if (s.tab === 'baremes') return drawRates();
      if (s.tab === 'pt-jour') return drawAujourdhui();
      if (s.tab === 'payer') return drawPayer();
      if (s.tab === 'pointage') return drawPointage();
      if (s.tab === 'pt-salarie') return drawPtSalarie();
      if (s.tab === 'pt-horaires') return drawPtHoraires();
      if (s.tab === 'annee') return drawAnnee();
      drawSlips();
    });
    // Aller à une vue (ou sous-vue) depuis un geste : la question des réglages non enregistrés se pose ici aussi.
    async function allerVue(v) { if (v === s.tab || !await leaveOk()) return; clearGuard(); s.tab = v; marquerVue(); draw(); }
    const marquerVue = () => $$('#p-tabs [data-tab]').forEach(x => { const on = x.dataset.tab === (PAIE_VUE_DE[s.tab] || s.tab); x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
    // Changer d'onglet quitte les Barèmes : la question « modifications non enregistrées » se pose
    // ici comme à la sortie de la page (10.12.0), et le garde-fou des Barèmes ne survit pas à
    // l'onglet qu'il protégeait.
    $$('#p-tabs [data-tab]').forEach(b => b.onclick = async () => {
      // (1.267.0) Un clic sur ce qu'on regarde déjà ne fait rien : « Aujourd'hui » sur la journée, « Le mois » sur une de ses
      // quatre étapes. L'onglet « Aujourd'hui » porte le nom `pointage` ; la vue `pointage`, elle, est l'étape « Pointer ».
      const deja = b.dataset.tab === 'pointage' ? s.tab === 'pt-jour' : b.dataset.tab === 'bulletins' ? !!ETAPE_DE[s.tab] : b.dataset.tab === s.tab;
      if (deja) return;
      if (!await leaveOk()) return;
      clearGuard();
      // (1.259.0) « Présences » ouvre « La journée » : le geste du soir. (1.267.0) « Aujourd'hui » l'ouvre sur le jour même ;
      // « Le mois » s'ouvre sur l'étape en cours du mois à traiter (la maquette : « clique celle que tu veux faire »).
      s.tab = b.dataset.tab === 'pointage' ? 'pt-jour' : b.dataset.tab;
      if (s.tab === 'pt-jour') delete s.ptJourIso;
      // (1.251.0) Le mois par défaut se choisit en changeant de vue, jamais à chaque dessin : établir les bulletins du mois
      // fait avancer le « mois à traiter », et la page aurait sauté au mois suivant sous les yeux.
      moisParDefaut();
      // (1.267.0) L'étape qui attend un geste (payer, établir, régler), sinon la première qui n'est pas faite : un mois en cours
      // aux bulletins établis s'ouvrait sur « Pointer », qui dure jusqu'à son dernier jour.
      if (s.tab === 'bulletins') { const yy = Number(s.year), mo = Number(s.month), a = actionDuMois(yy, mo); s.tab = a ? a.etape : (etapesDuMois(yy, mo).find(e => e.etat === 'ici') || { id: 'bulletins' }).id; }
      marquerVue();
      draw();
    });
    draw();
    // (plateforme) 1.232.0 — un geste demandé depuis la recherche (Ctrl K) : le bouton principal du mois, s'il est celui-là.
    if (s.geste) {
      const g = s.geste; delete s.geste;
      const b = $({ payer: '#p-payer', etablir: '#p-gen', remettre: '#p-remettre', approuver: '#p-bap' }[g] || '#rien');
      if (b && !b.disabled) b.click();
      else toast({ payer: 'Rien à payer ce mois-ci', etablir: 'Tous les bulletins du mois sont établis', remettre: 'Rien à remettre ce mois-ci', approuver: 'Aucun bulletin à approuver ce mois-ci' }[g] || 'Rien à faire ici', false);
    }
    // Le réseau qui part ou revient redessine la paie : son bandeau « Pas de réseau » suit la vérité du moment.
    if (!pagePaie.ecoute) {
      pagePaie.ecoute = true;
      const suivre = () => { if (routeOf(location.hash) === 'paie' && !document.querySelector('#modal-root .modal-bg')) render(true); };
      window.addEventListener('online', suivre);
      window.addEventListener('offline', suivre);
    }
  };

  // (plateforme) 1.225.0 — la fiche d'un salarié telle que sa maquette : un en-tête (chemin, état, le geste principal
  // calculé), ce qui manque en bandeau, à gauche ses onglets (bulletins, congés, avances, documents, son départ,
  // l'historique), à droite son contrat, son identité, comment le payer.
  const ficheSal = { onglet: 'bulletins' };
  const ficheDuSalarie = (parts) => {
    const e = employeeById(parts[0]);
    if (!e) return navigate('#/paie');
    if (ficheSal.id !== e.id) { ficheSal.id = e.id; ficheSal.onglet = e.hireDate && !(e.endDate && e.endDate < C.today()) && e.hireDate >= C.addDays(C.today(), -62) ? 'arrivee' : 'bulletins'; }
    const cur = company().currency;
    const st = C.payrollSettings(data), auj = C.today();
    const c = C.computePayslip(e, C.saisieDeLaFiche(e, st), st);
    const slips = C.payslipsOf(data).filter(p => p.employeeId === e.id).sort((a, b) => (b.year - a.year) || (b.month - a.month));
    const year = auj.slice(0, 4);
    const parti = !!(e.endDate && e.endDate < auj);
    const virement = (e.method || 'virement') === 'virement';
    const nuF = v => String(v || '').replace(/[\s-]/g, ''), auF = C.today();
    const memeQue = k => nuF(e[k]) ? (data.employees || []).filter(x => x.id !== e.id && x.active !== false && !(x.endDate && x.endDate < auF) && nuF(x[k]) === nuF(e[k]) && (k !== 'iban' || (x.method || 'virement') !== 'especes')).map(x => x.name).join(', ') : '';
    const finCdd = e.contract === 'cdd' && e.endDate && !parti && C.addDays(auj, 60) >= e.endDate;
    const manques = [!e.cnss && 'son n° CNSS', virement && !e.iban && 'son RIB'].filter(Boolean);
    const av = (n, g) => `<span class="pa-av${g ? ' pa-av-g' : ''}" aria-hidden="true" style="--c:${h(C.couleurDe(n || ''))}">${h(C.initialesDe(n || ''))}</span>`;
    const pastille = parti ? `<span class="statut">parti le ${C.fmtDate(e.endDate)}</span>` : manques.length ? `<span class="statut attire" title="Ce qu'il faut pour le payer et le déclarer">${h((m0 => m0.charAt(0).toUpperCase() + m0.slice(1))(manques.join(' et ')))} manque${manques.length > 1 ? 'nt' : ''}</span>`
      : finCdd ? `<span class="statut attire">CDD · finit le ${C.fmtDate(e.endDate)}</span>` : '<span class="statut ok">en poste</span>';
    const prin = parti ? `<button type="button" class="btn btn-primary" data-fs="doc" data-kind="certificat">${lfIc('pages', 15)} Son certificat de travail</button>`
      : manques.length ? `<button type="button" class="btn btn-primary" data-fs="completer">${lfIc('ecriture', 15)} Compléter : ${h(manques.join(' et '))}</button>`
        : finCdd ? `<button type="button" class="btn btn-primary" data-fs="renouveler">${lfIc('pages', 15)} Renouveler son contrat…</button>`
          : `<button type="button" class="btn btn-primary" data-fs="conge">${lfIc('croix', 15, 2.4)} Un congé…</button>`;
    const bandeaux = [];
    if (!parti && !e.cnss) bandeaux.push(`<div class="bandeau ambre pa-bandeau pa-ambre">${lfIc('aide', 18)}<span class="txt"><b>Son n° CNSS manque</b><span>Son bulletin se fait sans lui ; la déclaration du trimestre l'attendra. L'affiliation se fait à la CNSS (À VÉRIFIER : le délai).</span></span><button type="button" class="btn btn-sm" data-fs="focus" data-focus="cnss">Le renseigner</button></div>`);
    if (!parti && virement && !e.iban) bandeaux.push(`<div class="bandeau ambre pa-bandeau pa-ambre">${lfIc('carte', 18)}<span class="txt"><b>Son RIB manque : son salaire ne peut pas partir par virement</b><span>Paie-le en espèces contre un reçu, ou ajoute son RIB : il passera dans l'ordre de virement.</span></span><button type="button" class="btn btn-sm" data-fs="focus" data-focus="iban">Ajouter son RIB</button></div>`);
    if (!parti && !virement && !e.iban) bandeaux.push(`<div class="bandeau info pa-bandeau" id="fs-especes">${lfIc('carte', 18)}<span class="txt"><b>Pas de RIB : son salaire se paie en espèces</b><span>Contre un reçu qu'il signe (il se prépare avec le paiement), pour que ta caisse se justifie. Avec son RIB, il passera dans l'ordre de virement.</span></span><button type="button" class="btn btn-sm" data-fs="focus" data-focus="iban">Ajouter son RIB</button></div>`);
    if (finCdd) bandeaux.push(`<div class="bandeau ambre pa-bandeau pa-ambre">${lfIc('echeance', 18)}<span class="txt"><b>Son CDD finit le ${C.fmtDate(e.endDate)}</b><span>Le renouveler (un avenant, une nouvelle date de fin), ou le laisser finir : son solde de tout compte et son certificat de travail se préparent dans « Son départ ». À VÉRIFIER : le délai de prévenance.</span></span></div>`);
    const b = C.leaveBalance(data, e.id, Number(year));
    const avs = C.advancesOf(data, e.id), ouvertes = avs.filter(x => !x.done);
    const lvs = C.leavesOf(data, e.id, Number(year));
    // L'historique : ce qui s'est passé, déduit de ce que la paie garde (aucune trace inventée).
    const histo = () => {
      const E = [];
      if (e.hireDate) E.push([e.hireDate, 'Entrée', `${(C.contractLabel(e.contract || 'cdi') || '').split(' —')[0]}, ${e.position || 'poste à préciser'}`]);
      const asc = slips.slice().reverse();
      // (1.253.0) Le salaire de BASE qui change, au premier jour de son mois : « Brut de novembre » (une absence retirée), daté
      // du 30/11, se lisait le 2 novembre comme une hausse ou une baisse à venir.
      const baseDe = x => C.round3(Number(x.prorata ? x.prorata.brutFiche : x.gross) || 0);
      asc.forEach((x, k) => { if (k && Math.abs(baseDe(x) - baseDe(asc[k - 1])) >= 0.0005) E.push([`${x.year}-${String(x.month).padStart(2, '0')}-01`, `Salaire de base dès ${MONTHS_LONG[x.month - 1]} ${x.year}`, `${C.money(baseDe(asc[k - 1]), cur)} → ${C.money(baseDe(x), cur)}`]); });
      asc.forEach(x => { if (x.paidDate) E.push([x.paidDate, `Salaire de ${MONTHS_LONG[x.month - 1]} ${x.year} payé`, C.money(x.c.net, cur)]); if (x.remisLe) E.push([x.remisLe, `Bulletin de ${MONTHS_LONG[x.month - 1]} remis`, '']); });
      (data.leaves || []).filter(l => l.employeeId === e.id).forEach(l => E.push([l.from, C.leaveKindLabel ? C.leaveKindLabel(l.kind) : 'Congé ou absence', `du ${C.fmtDate(l.from)} au ${C.fmtDate(l.to)}`]));
      avs.forEach(a => E.push([a.date, 'Avance versée', C.money(a.amount, cur)]));
      (e.regularisations || []).forEach(x => E.push([x.le || `${x.pourMois}-01`, x.rappel ? 'Rappel de salaire' : 'Régularisation', `${C.money(x.amount, cur)} sur le bulletin de ${MONTHS_LONG[Number(x.pourMois.slice(5, 7)) - 1]} ${x.pourMois.slice(0, 4)}${x.motif ? ` · ${x.motif}` : ''}`]));
      C.saisiesOf(data, e).forEach(x => (x.versements || []).forEach(v => E.push([v.date, `Saisie sur salaire versée à ${x.creancier || 'son créancier'}`, C.money(v.amount, cur)])));
      (e.salaires || []).forEach(x => E.push([`${x.des}-01`, `Salaire changé, à partir de ${MONTHS_LONG[Number(x.des.slice(5, 7)) - 1]} ${x.des.slice(0, 4)}`, `${C.money(x.avant, cur)} → ${C.money(x.brut, cur)}${x.le ? ` · noté le ${C.fmtDate(x.le)}` : ''}`]));
      slips.forEach(x => (x.paiementsAnnules || []).forEach(pa => E.push([pa.le, `Paiement de ${MONTHS_LONG[x.month - 1]} annulé`, pa.raison || ''])));
      (e.renouvellements || []).forEach(r => E.push([r.le, r.cdi ? 'Passé en CDI' : `CDD prolongé jusqu'au ${C.fmtDate(r.nouvelleFin)}`, `il finissait le ${C.fmtDate(r.ancienneFin)}`]));
      if (e.endDate) E.push([e.endDate, parti ? 'Sortie' : 'Fin de contrat prévue', '']);
      return E.sort((x, y) => String(y[0]).localeCompare(String(x[0])));
    };
    // (plateforme) 1.227.0 — « Son arrivée » (la maquette) : tant que l'entrée a moins de deux mois, ce qu'il faut avant et
    // autour de son premier bulletin, lu sur sa fiche ; deux points restent À VÉRIFIER (essai, visite médicale).
    const arrive = !!(e.hireDate && !parti && e.hireDate >= C.addDays(auj, -62));
    const premier = e.hireDate ? slips.find(x => Number(x.year) === Number(e.hireDate.slice(0, 4)) && Number(x.month) === Number(e.hireDate.slice(5, 7))) : null;
    const ARR = arrive ? [
      [true, 'Inscrit au registre du personnel', `entré le ${C.fmtDate(e.hireDate)}`],
      [!!e.contract, 'Son contrat', `${(C.contractLabel(e.contract || 'cdi') || '').split(' —')[0]}${e.contract === 'cdd' && e.endDate ? `, jusqu'au ${C.fmtDate(e.endDate)}` : ''} · le contrat se prépare dans « Documents »`],
      [!!e.cin, 'CIN', e.cin ? e.cin : 'à saisir sur sa fiche'],
      [Number(e.grossSalary) > 0, 'Salaire et primes', `${C.money(e.grossSalary, cur)} de base${(e.primes || []).length ? ` · ${e.primes.map(x => x.label).join(', ')}` : ''}`],
      [!!(premier && (premier.prorata || e.hireDate.slice(8, 10) === '01')), 'Premier bulletin au prorata', premier ? (premier.prorata || e.hireDate.slice(8, 10) === '01' ? `${MONTHS_LONG[premier.month - 1]} ${premier.year}` : `${MONTHS_LONG[premier.month - 1]} est au mois plein : à reprendre au prorata de son entrée`) : 'pas encore établi'],
      [!!e.cnss, 'N° CNSS', e.cnss ? e.cnss : 'si il n\u2019en a pas, son immatriculation se demande à la CNSS (le délai : À VÉRIFIER)'],
      [!!e.iban, 'RIB', e.iban ? 'virement' : 'sans lui, son salaire se paie en espèces, contre reçu'],
      [e.trialEnd ? true : null, 'Période d\u2019essai', e.trialEnd ? `jusqu'au ${C.fmtDate(e.trialEnd)}` : 'sa durée et sa fin : celles du contrat, à noter sur sa fiche (À VÉRIFIER : le Code du travail)'],
      [null, 'Visite médicale d\u2019embauche', 'À VÉRIFIER : l\u2019obligation pour ton activité']] : [];
    const ONG = [...(arrive ? [['arrivee', 'Son arrivée', ARR.filter(x => x[0] === false).length]] : []), ['bulletins', 'Bulletins', slips.length], ['conges', 'Congés', lvs.length], ['avances', 'Avances', ouvertes.length], ['documents', 'Documents', ((e.documentsFaits || []).length + (e.attachments || []).length) || ''], ['depart', 'Son départ', ''], ['historique', 'Historique', '']];
    const og = ficheSal.onglet;
    const szs = C.saisiesOf(data, e);
    // (1.249.0) Toute liste de la fiche se pagine (Skander, 02/11 : 50 bulletins, un historique sans fin) ; une page par onglet,
    // qui repart à la première quand on change d'onglet ou de salarié.
    if (ficheSal.pgDe !== `${e.id}:${og}`) { ficheSal.pgDe = `${e.id}:${og}`; ficheSal.pg = { page: 1 }; }
    const pag = (L, noun, pluriel) => { const r = paginate(L, ficheSal.pg); return { rows: r.rows, bar: pagerBar(r.pg, { noun, pluriel }) }; };
    const docsFaits = (e.documentsFaits || []).slice().reverse();
    const pjSal = e.attachments || [];
    const pjArrets = (data.leaves || []).filter(l => l.employeeId === e.id).flatMap(l => (l.attachments || []).map(a => ({ a, l })));
    // (1.253.0) Les jours « absent » posés à la main au pointage de l'année (un congé saisi se lit déjà dans le tableau).
    const pointesAn = og !== 'conges' ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap(mm => C.pointageEnregistre(data, e.id, Number(year), mm)
      ? C.pointageDuMois(data, e, Number(year), mm).jours.filter(j => j.code === 'A' && j.source === 'pointe').map(j => `${year}-${String(mm).padStart(2, '0')}-${String(j.jour).padStart(2, '0')}`) : []);
    const corps = og === 'conges' ? `<div class="pa-kv"><span>Acquis en ${h(year)}</span><b>${pct(b.acquired)} jour${sPl(b.acquired)}</b><span>Pris</span><b>${pct(b.taken)} jour${sPl(b.taken)}</b><span>Il lui reste</span><b class="${b.remaining < 0 ? 'warn-text' : ''}">${pct(b.remaining)} jour${sPl(b.remaining)}</b></div>
        ${lvs.length ? (P => `<table class="list compact pa-liste"><thead><tr><th>Nature</th><th>Du</th><th>Au</th><th class="r">Jours</th><th>Effet</th></tr></thead><tbody>${P.rows.map(l => `<tr class="clickable" data-lv="${h(l.id)}"><td>${h(l.kindLabel)}${(l.attachments || []).length ? ` <span class="small muted" title="${h(l.attachments.map(a => a.name).join(', '))}">· ${lfIc('piece', 12)} ${pl(l.attachments.length, 'fichier')}</span>` : l.kind === 'maladie' && !l.certificatLe ? ' <span class="statut attire">certificat ?</span>' : ''}</td><td class="nw">${C.fmtDate(l.from)}</td><td class="nw">${C.fmtDate(l.to)}</td><td class="r">${pct(l.days)}</td><td>${l.paid ? '<span class="ok-text">payée</span>' : '<span class="warn-text">retirée du salaire</span>'}</td></tr>`).join('')}</tbody></table>${P.bar}`)(pag(lvs, 'absence'))
          : `<div class="empty">Aucun congé ni absence ${pointesAn.length ? 'saisi' : ''} en ${h(year)}.</div>`}${pointesAn.length ? `<p class="small muted" id="fs-pointes">Au pointage de ${h(year)} : ${pl(pointesAn.length, 'jour')} d'absence non payée (${h(pointesAn.slice(0, 6).map(d => C.fmtDate(d).slice(0, 5)).join(', '))}${pointesAn.length > 6 ? '…' : ''}) ; ${pointesAn.length > 1 ? 'ils se retirent du bulletin de leur mois' : 'il se retire du bulletin de son mois'}.</p>` : ''}<div class="pa-pied-o"><button type="button" class="btn btn-sm" id="add-lv">${lfIc('croix', 14, 2.4)} Un congé ou une absence</button></div>`
      : og === 'avances' ? (avs.length ? `${ouvertes.length ? `<ul class="pa-av-l" id="fs-av-cours">${ouvertes.map(x => avanceLigneHtml(x, cur)).join('')}</ul>` : ''}${avs.some(x => x.done) ? `<table class="list compact pa-liste"><thead><tr><th>Soldée${avs.filter(x => x.done).length > 1 ? 's' : ''} · versée le</th><th class="r">Avancé</th><th class="r">Il reste</th></tr></thead><tbody>${avs.filter(x => x.done).map(x => `<tr class="clickable" data-av="${h(x.id)}"><td class="nw">${C.fmtDate(x.date)}</td><td class="r nw">${C.money(x.amount, cur)}</td><td class="r nw">${x.done ? '<span class="ok-text">soldée</span>' : `<b>${C.money(x.remaining, cur)}</b>`}</td></tr>`).join('')}</tbody></table>` : ''}${ouvertes.length ? `<p class="small muted pa-note">${C.money(C.round3(ouvertes.reduce((a2, x) => a2 + x.remaining, 0)), cur)} se retiennent d'eux-mêmes sur les prochains bulletins.</p>` : ''}`
          : '<div class="empty">Aucune avance ni aucun prêt. Une avance se retient toute seule, mois après mois, sur ses bulletins.</div>')
          + (szs.length ? `<h3 class="pa-h3">Saisies sur salaire</h3><table class="list compact pa-liste" id="fs-saisies"><thead><tr><th>Créancier</th><th class="r">Retenu</th><th class="r">À lui verser</th><th class="r">Reste</th></tr></thead><tbody>${szs.map(x => `<tr class="clickable" data-sz="${h(x.id)}"><td><b>${h(x.creancier || '')}</b><small class="muted"> ${C.money(x.monthly, cur)} par mois</small></td><td class="r nw">${C.money(x.retenu, cur)}</td><td class="r nw">${x.aVerser ? `<b class="warn-text">${C.money(x.aVerser, cur)}</b>` : '—'}</td><td class="r nw">${x.done ? '<span class="ok-text">soldée</span>' : C.money(x.reste, cur)}</td></tr>`).join('')}</tbody></table>` : '')
          + `<div class="pa-pied-o"><button type="button" class="btn btn-sm" id="add-av">${lfIc('croix', 14, 2.4)} Une avance</button><button type="button" class="btn btn-sm" id="add-sz">${lfIc('croix', 14, 2.4)} Une saisie sur salaire</button></div>`
      : og === 'documents' ? (() => {
          // (1.249.0) Tous SES documents au même endroit (Skander, 02/11 : « on ne voit pas tous ses documents ») : ses fichiers
          // (CIN, contrat signé, diplôme…) et les certificats de ses arrêts, ses bulletins, les documents faits, puis préparer.
          const P = pag(slips, 'bulletin');
          return `<section class="fs-doc-s" id="fs-pj-s"><div class="fs-doc-t"><b>Ses fichiers</b><span class="mu">la copie de sa CIN, son contrat signé, un diplôme, un certificat… gardés 10 ans</span></div><div id="fs-pj"></div>
            ${pjArrets.length ? `<ul class="fs-doc-l" id="fs-pj-arrets">${pjArrets.map(({ a, l }) => `<li><span class="pjp-ic">${lfIc('piece', 15)}</span><span><b>${h(a.name || a.file)}</b><small>certificat de l'arrêt du ${C.fmtDate(l.from)} au ${C.fmtDate(l.to)}</small></span><button type="button" class="btn btn-sm" data-pj-arret="${h(l.id)}:${h(a.file)}">${lfIc('oeil', 14)} Ouvrir</button></li>`).join('')}</ul>` : ''}</section>
          <section class="fs-doc-s" id="fs-bul-s"><div class="fs-doc-t"><b>Ses bulletins</b><span class="mu">${pl(slips.length, 'bulletin')} · chacun se voit et s'exporte en PDF</span></div>
            ${slips.length ? `<table class="list compact pa-liste" id="fs-docs-bul"><tbody>${P.rows.map(x => `<tr class="clickable" data-voir-l="${h(x.id)}"><td><b>Bulletin de ${h(MONTHS_LONG[x.month - 1])} ${x.year}</b><small>net ${C.money(x.c.net, cur)} · ${x.paidDate ? `payé le ${C.fmtDate(x.paidDate)}` : 'à payer'}${x.remisLe ? ` · remis le ${C.fmtDate(x.remisLe)}` : ''}</small></td><td class="r nw"><button type="button" class="btn btn-sm" data-voir="${h(x.id)}">${lfIc('oeil', 14)} Voir</button><button type="button" class="btn btn-sm btn-ghost" data-pdf-b="${h(x.id)}">${lfIc('exporter', 14)} PDF</button></td></tr>`).join('')}</tbody></table>${P.bar}` : '<div class="empty">Aucun bulletin encore.</div>'}</section>
          <section class="fs-doc-s" id="fs-faits-s"><div class="fs-doc-t"><b>Les documents faits</b><span class="mu">chaque PDF exporté depuis SkanFact, avec sa date</span></div>
            ${docsFaits.length ? `<table class="list compact pa-liste" id="fs-faits"><tbody>${docsFaits.slice(0, 20).map(x => `<tr><td><b>${h(C.hrDocLabel(x.kind))}</b><small>daté du ${C.fmtDate(x.date)} · exporté le ${C.fmtDate(x.le)}</small></td><td class="r"><button type="button" class="btn btn-sm" data-refaire="${h(x.id)}">${lfIc('oeil', 14)} Revoir…</button></td></tr>`).join('')}</tbody></table>${docsFaits.length > 20 ? `<p class="small muted">les 20 derniers sur ${docsFaits.length}</p>` : ''}` : '<p class="small muted fs-vide">Aucun document exporté encore : ceux que tu prépares ci-dessous s\'inscrivent ici.</p>'}</section>
          <section class="fs-doc-s" id="fs-prep-s"><div class="fs-doc-t"><b>Préparer un document</b><span class="mu">il se voit tel qu'il sortira, avant l'export · modèles et mentions : À VÉRIFIER avec ton comptable</span></div>
            <div class="fs-prep" id="fs-docs">${C.HR_DOCS.filter(([k]) => k !== 'essai' || (e.trialEnd && e.trialEnd >= C.addDays(auj, -31))).map(([k, n, d]) => `<button type="button" class="fs-prep-c" data-fs="doc" data-kind="${h(k)}"><b>${h(n)}</b><small>${h(d)}</small></button>`).join('')}</div></section>`;
        })()
      : og === 'depart' ? (e.endDate ? (() => {
          const L = C.lignesDuSolde(data, e.id, e.endDate);
          return `<div class="pa-kv" id="fs-dep-kv"><span>${parti ? 'Parti le' : 'Fin prévue le'}</span><b>${C.fmtDate(e.endDate)}</b>${e.sortieMotif ? `<span>Motif</span><b>${h(motifSortie(e.sortieMotif))}</b>` : ''}${e.hireDate ? `<span>Ancienneté</span><b>${h(ancienneteDe(e, e.endDate))}</b>` : ''}<span>Congés pas pris</span><b>${pct(C.indemniteConges(data, e.id, e.endDate).solde)} jour(s)</b>${ouvertes.length ? `<span>Avance qui reste</span><b>${C.money(C.round3(ouvertes.reduce((a2, x) => a2 + x.remaining, 0)), cur)}</b>` : ''}</div>
            ${ouvertes.length ? `<p class="small pa-note" id="fs-dep-avance">Le solde ne retient pas l'avance : ses bulletins la remboursent, et ce qu'ils ne peuvent pas retenir se règle avec lui. <em>À VÉRIFIER avec ton comptable : ce qui peut se retenir au départ.</em></p>` : ''}
            <table class="list compact pa-liste"><thead><tr><th>Son solde de tout compte, proposé</th><th class="r"></th></tr></thead><tbody>${L.map(l => `<tr><td>${h(l.label)}</td><td class="r nw">${l.amount || l.cle ? C.money(l.amount, cur) : '<span class="muted">à compléter dans le solde</span>'}</td></tr>`).join('')}</tbody></table>
            <div class="pa-pied-o">${/* (1.257.0) Une sortie notée par erreur, ou une démission reprise : tant que son dernier bulletin n'est pas payé, elle se retire. */''}${e.sortieMotif && e.contract !== 'cdd' && !slips.some(x => x.paidDate && `${x.year}-${String(x.month).padStart(2, '0')}` >= e.endDate.slice(0, 7)) ? `<button type="button" class="btn btn-sm" data-fs="reste" id="fs-reste">${lfIc('retour', 14)} Il reste finalement</button>` : ''}<button type="button" class="btn btn-sm" data-fs="sortie" id="fs-sortie-mod">${lfIc('modifier', 14)} ${e.sortieMotif ? 'Modifier sa sortie…' : 'Le motif de sa sortie…'}</button><button type="button" class="btn btn-sm" data-fs="doc" data-kind="solde">${lfIc('oeil', 14)} Le solde de tout compte</button><button type="button" class="btn btn-sm" data-fs="doc" data-kind="certificat">${lfIc('oeil', 14)} Le certificat de travail</button></div>
            <p class="small muted pa-note">À VÉRIFIER avec ton comptable : les indemnités de fin de contrat dépendent du motif de la rupture et de la convention collective.</p>`;
        })() : `<div class="empty"><b>Aucun départ prévu</b><br>Une démission, une fin de contrat, un licenciement : pose sa date de sortie, et le solde de tout compte et le certificat se préparent ici.</div><div class="pa-pied-o"><button type="button" class="btn btn-sm" data-fs="sortie">${lfIc('echeance', 14)} Préparer sa sortie…</button></div>`)
      : og === 'arrivee' && arrive ? `<div class="pa-carte-t"><b>L'arrivée de ${h(e.name.split(/\s+/)[0])}, le ${C.fmtDate(e.hireDate)}</b><span class="mu">${pl(ARR.filter(x => x[0]).length, 'fait')} · ${ARR.filter(x => x[0] === false).length} à demander · ${ARR.filter(x => x[0] === null).length} à vérifier</span></div>
          <ul class="pa-ctl" id="fs-arrivee">${ARR.map(([ok, t2, d]) => `<li class="${ok ? 'ok' : ok === false ? 'ko' : ''}">${lfIc(ok ? 'coche' : ok === false ? 'aide' : 'echeance', 16, 2.2)}<span><b>${h(t2)}</b><small>${h(d)}</small></span></li>`).join('')}</ul>
          <p class="small muted pa-note">Un jeune diplômé en premier emploi peut entrer par un contrat aidé (le CIVP) : ses règles (montants, CNSS, durée) sont À VÉRIFIER avec ton comptable avant de le choisir.</p>`
      : og === 'historique' ? (() => { const H = histo(), P = pag(H, 'événement'); return H.length ? `<ul class="pa-histo">${P.rows.map(([d, t, x]) => `<li><span class="nw muted small">${C.fmtDate(d)}</span><b>${h(t)}</b>${x ? `<span class="small muted">${h(x)}</span>` : ''}</li>`).join('')}</ul>${P.bar}` : '<div class="empty">Rien encore.</div>'; })()
      : (slips.length ? (P => `<table class="list compact pa-liste"><thead><tr><th>Mois</th><th class="r">Brut</th><th class="r">Net</th><th>Payé</th><th></th></tr></thead><tbody>
          ${P.rows.map(x => `<tr class="clickable" data-ed="${h(x.id)}"><td><b>${h(MONTHS_LONG[x.month - 1])} ${x.year}</b></td><td class="r nw">${C.money(x.c.gross, cur)}</td><td class="r nw"><b>${C.money(x.c.net, cur)}</b></td>
            <td class="nw">${x.paidDate ? `<span class="statut ok">le ${C.fmtDate(x.paidDate)}</span>` : '<span class="statut attire">à payer</span>'}</td><td class="r nw">${x.paidDate ? `<button type="button" class="btn btn-sm btn-ghost" data-regul="${h(x.id)}" title="Le bulletin payé ne change pas : l'écart passe sur un mois suivant">Régulariser…</button>` : ''}<button type="button" class="btn btn-sm" data-voir="${h(x.id)}">${lfIc('oeil', 14)} Voir</button></td></tr>`).join('')}</tbody></table>${P.bar}`)(pag(slips, 'bulletin'))
          : '<div class="empty">Aucun bulletin pour ce salarié.</div>') + `<div class="pa-pied-o"><button type="button" class="btn btn-sm" id="new-slip">${lfIc('croix', 14, 2.4)} Un bulletin</button></div>`;
    const dl = (t, v, sous) => `<dt>${t}</dt><dd>${v}${sous ? `<small>${sous}</small>` : ''}</dd>`;
    const manque = t => `<span class="manque">${t}</span>`;
    $('#view').innerHTML = `
      <div class="page-head lf-tete pa-tete" id="fs-head"><div class="titre"><div class="chemin"><a href="#/paie">Paie</a>${ICONE_CHEVRON}<a href="#/paie" id="fs-sal">Salariés</a>${ICONE_CHEVRON}<span>${h(e.name)}</span></div>
          <h1 class="pa-h1-av">${av(e.name, true)}${h(e.name)} ${pastille}</h1><p class="sous">${h([e.position, (C.contractLabel(e.contract || 'cdi') || '').split(' —')[0] + (e.hireDate ? ` depuis le ${C.fmtDate(e.hireDate)}` : ''), `coût ${C.money(c.employerCost, cur)} par mois`].filter(Boolean).join(' · '))}</p></div>
        <div class="actions">${finCdd ? `<button type="button" class="btn" data-fs="sortie">${lfIc('retour', 15)} Préparer sa sortie…</button>` : `<button type="button" class="btn" data-fs="doc">${lfIc('pages', 15)} Un document…</button>`}<button type="button" class="btn btn-ghost pa-plus" id="fs-plus" aria-haspopup="menu" aria-label="Autres gestes pour ce salarié" title="Autres gestes pour ce salarié">${lfIc('plus', 16)}</button>${prin}</div></div>
      ${bandeaux.join('')}
      <div class="pa-fiche"><div class="pa-fiche-g"><section class="pa-carte"><div class="pa-sous pa-sous-f" role="tablist" aria-label="Sa fiche">${ONG.map(([id, n, nb]) => `<button type="button" role="tab" data-onglet="${id}" aria-selected="${og === id}">${n}${nb ? ` <small>${nb}</small>` : ''}</button>`).join('')}</div><div class="pa-onglet-c" id="fs-corps">${corps}</div></section></div>
        <div class="pa-fiche-d">
          <section class="pa-carte pa-bloc"><div class="pa-carte-t"><b>Son contrat</b><button type="button" class="btn btn-sm" id="edit-emp">Modifier</button></div><dl class="pa-dl">
            ${dl('Contrat', `${h((C.contractLabel(e.contract || 'cdi') || '').split(' —')[0])}${e.contract === 'cdd' && e.endDate ? ` · fin le ${C.fmtDate(e.endDate)}` : ''}`)}
            ${dl('Poste', e.position ? h(e.position) : manque('à préciser'), e.categorie ? h(e.categorie) : '')}
            ${dl('Salaire de base', `${C.money(e.grossSalary, cur)} par mois`, (() => { const L = (e.salaires || []).slice().sort((a, b) => b.des.localeCompare(a.des)); return L.length ? `depuis ${h(MONTHS_LONG[Number(L[0].des.slice(5, 7)) - 1])} ${h(L[0].des.slice(0, 4))} (avant : ${h(C.money(L[0].avant, cur))})` : ''; })())}
            ${dl('Temps de travail', e.weeklyHours ? `${String(e.weeklyHours).replace('.', ',')} h par semaine` : 'temps plein', e.weeklyHours ? 'temps partiel : le brut de la fiche est déjà celui de ces heures' : '')}
            ${(() => { const q = C.equipeDe(C.payrollSettings(data), e); return q ? dl('Son équipe', h(q.nom), `${q.debut && q.fin ? `${h(q.debut)} – ${h(q.fin)}, ` : ''}${h(joursDitCourt(q.jours))}${e.badge ? ` · badge ${h(e.badge)}` : ''}`) : e.badge ? dl('Badge', h(e.badge), 'la pointeuse le reconnaît par ce numéro') : ''; })()}
            ${e.trialEnd ? dl('Période d\'essai', e.trialEnd >= auj ? `jusqu'au ${C.fmtDate(e.trialEnd)}` : `finie le ${C.fmtDate(e.trialEnd)}`) : ''}
            ${(e.primes || []).length ? dl('Primes de chaque mois', e.primes.map(x => `${h(x.label)} ${C.money(x.amount, cur)}${x.parJour ? ' au jour' : ''}`).join(' · ')) : ''}
            ${dl('Net estimé', C.money(c.net, cur), (e.primes || []).length ? 'primes de la fiche comprises, hors retenues du mois' : 'hors primes et retenues du mois')}
            ${dl('Situation', `${e.headOfFamily ? 'chef de famille' : 'célibataire'}${Number(e.children) ? ` · ${pl(e.children, 'enfant')}` : ''}`, 'elle compte dans son impôt')}
          </dl></section>
          ${/* (1.248.1) La fiche dit le doublon que la liste montre : « contrôlé, clé juste » rassurait sur un RIB qui était aussi
                celui de trois collègues (recette du 02/11). */''}
          <section class="pa-carte pa-bloc"><div class="pa-carte-t"><b>Identité</b></div><dl class="pa-dl">
            ${dl('CIN', e.cin ? `<span class="mono">${h(e.cin)}</span>` : manque('à saisir'))}
            ${dl('N° CNSS', e.cnss ? `<span class="mono">${h(e.cnss)}</span>` : manque('à demander'), e.cnss ? (memeQue('cnss') ? `<span class="warn-text" id="fs-cnss-double">le même que ${h(memeQue('cnss'))} : chacun a le sien</span>` : '') : 'la déclaration du trimestre l\'attend')}
            ${e.birthDate ? dl('Né le', C.fmtDate(e.birthDate)) : ''}
            ${e.address ? dl('Adresse', h(e.address)) : ''}
            ${e.phone ? dl('Téléphone', h(e.phone)) : ''}
            ${dl('E-mail', e.email ? h(e.email) : '<span class="muted">—</span>', e.email ? '' : 'pour lui envoyer ses bulletins')}
          </dl></section>
          <section class="pa-carte pa-bloc"><div class="pa-carte-t"><b>Pour le payer</b></div><dl class="pa-dl">
            ${dl('Mode', virement ? 'virement' : 'espèces, contre reçu')}
            ${dl('RIB', e.iban ? `<span class="mono">··· ${h(String(e.iban).replace(/\s/g, '').slice(-4))}</span>` : manque('à demander'), e.iban ? (virement && memeQue('iban') ? `<span class="warn-text" id="fs-rib-double">le même que ${h(memeQue('iban'))} : son salaire partirait sur un autre compte</span>` : `${lfIc('coche', 12, 2.6)} contrôlé (20 chiffres, clé juste)`) : virement ? '20 chiffres, contrôlés à la saisie' : 'sans lui, il est payé en espèces')}
          </dl></section>
          ${e.notes ? `<section class="pa-carte pa-bloc"><div class="pa-carte-t"><b>Notes</b></div><p class="small pa-note">${h(e.notes)}</p></section>` : ''}
        </div></div>`;
    bindBack('#/paie');
    // (plateforme) 1.232.0 — en lecture, la fiche se consulte : ses gestes d'écriture ne s'offrent pas (docs/revue-paie.md, P4).
    if (enLecture('employees')) $$('#edit-emp, #fs-head .actions .btn-primary, #fs-plus, #add-lv, #add-av, #add-sz, #new-slip, #view [data-regul], #view .pa-bandeau button').forEach(b => b.remove());
    const rouvrir = () => render();
    $('#fs-sal').onclick = ev => { ev.preventDefault(); paieState.tab = 'salaries'; navigate('#/paie'); };
    if ($('#edit-emp')) $('#edit-emp').onclick = () => employeeForm(e, rouvrir);
    $$('#fs-head [data-fs], #view [data-fs]').forEach(bt => bt.onclick = () => {
      const k = bt.dataset.fs;
      if (k === 'doc') hrDocForm(e, rouvrir, bt.dataset.kind);
      else if (k === 'completer') employeeForm(e, rouvrir, { focus: !e.cnss ? 'cnss' : 'iban' });
      else if (k === 'focus') employeeForm(e, rouvrir, { focus: bt.dataset.focus });
      // (1.248.0) Renouveler a sa fenêtre ; « Préparer sa sortie » mène à l'onglet « Son départ » (la date, le solde, le certificat).
      else if (k === 'renouveler') renouvelerCdd(e, rouvrir);
      else if (k === 'sortie') { ficheSal.onglet = 'depart'; sortieFenetre(e, rouvrir); }
      else if (k === 'reste') {
        const x = employeeById(e.id); if (!x) return;
        const avant = { endDate: x.endDate, sortieMotif: x.sortieMotif, sortieNote: x.sortieNote, sortieNotifieeLe: x.sortieNotifieeLe };
        ['endDate', 'sortieMotif', 'sortieNote', 'sortieNotifieeLe'].forEach(c => delete x[c]);
        save(true); rouvrir();
        toastUndo(`${x.name} reste en poste : sa sortie est retirée`, () => { const y = employeeById(e.id); if (y) { Object.assign(y, avant); save(true); rouvrir(); } });
      }
      else if (k === 'conge') leaveForm(null, e.id, rouvrir);
    });
    if ($('#fs-plus')) $('#fs-plus').onclick = ev => RowMenu.ouvrir(ev.currentTarget, [
      { icon: 'modifier', label: 'Modifier sa fiche', hint: 'contrat, salaire, identité, RIB', run: () => employeeForm(e, rouvrir) },
      { icon: 'modifier', label: 'Changer son salaire', hint: 'le nouveau brut dès un mois, le poste, la catégorie ; l\'avenant se prépare', run: () => changerSalaireFenetre(e, rouvrir) },
      ...(e.contract === 'cdd' ? [{ icon: 'modifier', label: 'Renouveler son CDD', hint: 'une nouvelle date de fin, et l\'avenant à signer', run: () => renouvelerCdd(e, rouvrir) }] : []),
      // (1.248.1) « oeil » n'est pas une icône du menu : trois lignes sans icône ni phrase, au milieu des autres (recette du 02/11).
      { icon: 'horloge', label: 'Un congé ou une absence', hint: 'payé ou non, il se reporte sur le bulletin du mois', run: () => leaveForm(null, e.id, rouvrir) },
      { icon: 'argent', label: 'Une avance', hint: 'ou un prêt, retenu mois après mois sur ses bulletins', run: () => advanceForm(null, e.id, rouvrir) },
      { icon: 'contrat', label: 'Une saisie sur salaire', hint: 'une décision de justice : la retenue se fait sur chaque bulletin', run: () => saisieFenetre(e, null, rouvrir) },
      { icon: 'pdf', label: 'Un document', hint: 'attestation, contrat, certificat…', run: () => hrDocForm(e, rouvrir) },
      { icon: 'dossier', label: parti ? 'Son départ' : 'Préparer sa sortie', hint: 'date de sortie, solde de tout compte, certificat', run: () => { ficheSal.onglet = 'depart'; rouvrir(); } }
    ], { titre: e.name, classe: 'gestes-menu', label: 'Autres gestes pour ce salarié' });
    $$('#view [data-onglet]').forEach(bt => bt.onclick = () => { ficheSal.onglet = bt.dataset.onglet; rouvrir(); });
    if ($('#new-slip')) $('#new-slip').onclick = () => { const t = C.addMonths(auj.slice(0, 7) + '-01', -1, 1); payslipForm(null, e, Number(t.slice(0, 4)), Number(t.slice(5, 7)), rouvrir); };
    $$('#view [data-voir]').forEach(bt => bt.onclick = ev => { ev.stopPropagation(); apercuBulletin(payslipById(bt.dataset.voir), rouvrir); });
    // (1.249.0) Les pièces de l'onglet Documents, et la pagination de chaque onglet.
    $$('#view [data-voir-l]').forEach(tr => tr.onclick = ev => { if (!ev.target.closest('button')) apercuBulletin(payslipById(tr.dataset.voirL), rouvrir); });
    $$('#view [data-pdf-b]').forEach(bt => bt.onclick = ev => { ev.stopPropagation(); exportPayslip(payslipById(bt.dataset.pdfB)); });
    $$('#view [data-refaire]').forEach(bt => bt.onclick = () => { const x = (e.documentsFaits || []).find(y => y.id === bt.dataset.refaire); if (x) hrDocForm(e, rouvrir, x.kind, x.date); });
    $$('#view [data-pj-arret]').forEach(bt => bt.onclick = () => { const [lid, f] = bt.dataset.pjArret.split(':'); const l = (data.leaves || []).find(y => y.id === lid); const a = l && (l.attachments || []).find(y => y.file === f); if (a) ouvrirJustificatif(lid, a, {}); });
    if ($('#fs-corps')) bindPager($('#fs-corps'), ficheSal.pg, rouvrir, '#fs-corps');
    if ($('#fs-pj')) {
      const etatPj = ficheSal.etatPj || (ficheSal.etatPj = {});
      const dessinerPj = () => {
        const x = employeeById(e.id) || e;
        panneauJustificatifs($('#fs-pj'), {
          ownerId: e.id, list: x.attachments || [], etat: etatPj, compteVide: 'gardés 10 ans',
          vide: `<button type="button" class="ed-zone" id="add-att">${lfIc('depot', 20)}<span>Glisse la copie de sa CIN, son contrat signé, un certificat… <b>ou clique</b></span><small>Une photo ou un PDF, 10 Mo au plus</small></button>`,
          joindre: async glisses => {
            try {
              const added = await bridge.addAttachments(e.id, glisses);
              if (!added.length) return;
              const y = employeeById(e.id); if (!y) return;
              y.attachments = (y.attachments || []).concat(added); save(true);
              justificatifsJoints(etatPj, added); dessinerPj();
              toast(added.length > 1 ? `${added.length} fichiers ajoutés à la fiche de ${e.name}` : `Ajouté à la fiche de ${e.name} : ${added[0].name || 'le fichier'}`);
            } catch (err) { toast(plainError(err), true); }
          },
          retirer: async a => {
            if (!await retirerJustificatif(e.id, a)) return;
            const y = employeeById(e.id); if (y) { y.attachments = (y.attachments || []).filter(z => z.file !== a.file); save(true); }
            dessinerPj();
          },
        });
      };
      dessinerPj();
    }
    $$('#view [data-regul]').forEach(bt => bt.onclick = ev => { ev.stopPropagation(); regularisationFenetre(payslipById(bt.dataset.regul), rouvrir); });
    // (1.249.0) Un clic sur un bulletin l'ouvre en lecture, avec ses gestes (Skander, 02/11 : il ouvrait le formulaire, même payé).
    $$('#view [data-ed]').forEach(tr => tr.onclick = ev => { if (ev.target.closest('button')) return; apercuBulletin(payslipById(tr.dataset.ed), rouvrir); });
    if ($('#add-lv')) $('#add-lv').onclick = () => leaveForm(null, e.id, rouvrir);
    if ($('#add-av')) $('#add-av').onclick = () => advanceForm(null, e.id, rouvrir);
    if ($('#add-sz')) $('#add-sz').onclick = () => saisieFenetre(e, null, rouvrir);
    $$('#view tr[data-sz]').forEach(tr => tr.onclick = () => saisieFenetre(e, (e.saisies || []).find(x => x.id === tr.dataset.sz), rouvrir));
    $$('#view [data-lv]').forEach(tr => tr.onclick = () => leaveForm(data.leaves.find(x => x.id === tr.dataset.lv), null, rouvrir));
    $$('#view [data-av]').forEach(tr => tr.onclick = () => advanceForm(data.advances.find(x => x.id === tr.dataset.av), null, rouvrir));
  };

  // (plateforme, 17 § 3.3, lot P1b) Ce que le Personnel pose chez le socle, chaque entrée à son rang d'aujourd'hui (sa
  // place dans la liste que le socle écrivait en dur), et les points qu'il remplit. Sa porte reste vide : aucun autre
  // module ne lit le Personnel à l'écran.
  // Ses deux pages (rangs 38 et 39 de `PAGE_LABELS`) ; la Paie donne ses onglets à la palette (au rang 1 de ses pages à onglets).
  // (1.334.1, L10 ; docs/leger.md) La maquette de la paie (`plateforme/paie-maquette.css`, toute sous `.pm`) ne part plus
  // avec la première ouverture : les deux pages du Personnel l'attendent (« Un instant… », puis la page), une fois. Sans
  // réseau et jamais chargée, la page le dit et se redessine seule au retour du réseau. Ses fenêtres ne s'ouvrent que
  // depuis ces deux pages : la feuille est là quand elles s'ouvrent.
  const MAQUETTE_PAIE = '../plateforme/paie-maquette.css';
  const SANS_RESEAU_PAIE = 'La paie n\'est pas encore sur ce poste, et le réseau manque : elle s\'ouvre dès qu\'il revient.';
  const avecMaquette = (titre, dessiner) => parts => attendreAvant(() => feuillePrete(MAQUETTE_PAIE),
    () => chargerFeuille(MAQUETTE_PAIE, '../plateforme/paie.css'), titre, SANS_RESEAU_PAIE, dessiner)(parts);
  Socle.poser('pages', 'personnel', { rang: 38, route: 'paie', libelle: 'Paie', ouvrir: avecMaquette('Paie', pagePaie), onglets: { rang: 1, liste: PAIE_TABS, ouvrir: v => { paieState.tab = v; } } });
  Socle.poser('pages', 'personnel', { rang: 39, route: 'salarie', ouvrir: avecMaquette('Un salarié', ficheDuSalarie) });
  // Ses lignes de « À faire » (leurs rangs dans `TODO_ACTIONS`).
  // E-04 : la ligne mène au MOIS du premier bulletin impossible, pas à la liste du mois courant —
  // un bulletin qu'on doit chercher mois par mois ne se corrige pas.
  Socle.poser('a-faire', 'personnel', { rang: 1, id: 'bulletins-impossibles', label: 'Voir le bulletin', run: vers('#/paie', () => {
    const b = C.bulletinsImpossibles(data)[0];
    paieState.tab = 'bulletins';
    if (b) { paieState.year = String(b.year); paieState.month = String(Number(b.month)); paieState.moisTouche = true; }
  }) });
  // (plateforme) 1.232.0 — la paie qui attend : le mois du premier bulletin concerné, ou les congés.
  Socle.poser('a-faire', 'personnel', { rang: 2, id: 'paie-correction', label: 'Voir la correction', run: vers('#/paie', () => { const t = (C.todoList(data, company(), C.today()).find(x => x.id === 'paie-correction') || {}).mois; paieState.tab = 'bulletins'; if (t) { paieState.year = t.slice(0, 4); paieState.month = String(Number(t.slice(5, 7))); paieState.moisTouche = true; } }) });
  Socle.poser('a-faire', 'personnel', { rang: 3, id: 'paie-bon-a-payer', label: 'Approuver', run: vers('#/paie', () => { const t = (C.todoList(data, company(), C.today()).find(x => x.id === 'paie-bon-a-payer') || {}).mois; paieState.tab = 'bulletins'; if (t) { paieState.year = t.slice(0, 4); paieState.month = String(Number(t.slice(5, 7))); paieState.moisTouche = true; } }) });
  Socle.poser('a-faire', 'personnel', { rang: 4, id: 'conges-demandes', label: 'Répondre', run: vers('#/paie', () => { paieState.tab = 'pt-jour'; }) });
  // Le lien ouvre la déclaration qu'il ANNONCE : la plus ancienne CNSS à déposer, son année et son
  // trimestre (10.14.1) — pas le trimestre en cours, éteint, qu'on trouvait à la place.
  Socle.poser('a-faire', 'personnel', { rang: 32, id: 'declarations-sociales', label: 'Voir les déclarations', run: vers('#/paie', () => {
    paieState.tab = 'declarations';
    const d = C.socialDue(data).find(x => x.kind === 'cnss');
    if (d) { paieState.year = String(d.year); paieState.quarter = String(d.quarter); }
  }) });
  // « Voir les bulletins », et le même bouton dans les contrôles avant clôture (`controle`, qui reçoit le contrôle) :
  // le PREMIER mois qui manque (10.14.1) ; « 44 bulletins de paie à établir » sur trois ans menait au
  // mois en cours, et laissait chercher, année par année, où l'oubli commençait.
  Socle.poser('a-faire', 'personnel', { rang: 33, id: 'bulletins', label: 'Voir les bulletins', run: vers('#/paie', () => { paieState.tab = 'bulletins'; }), controle: c => vers('#/paie', () => {
    paieState.tab = 'bulletins';
    if (c && /^\d{4}-\d{2}$/.test(c.mois || '')) { paieState.year = c.mois.slice(0, 4); paieState.month = String(Number(c.mois.slice(5, 7))); paieState.moisTouche = true; }
  })() });
  // Le pointage dans « Créer » (rang 9 de sa table).
  Socle.poser('creer', 'personnel', { rang: 9, cle: 'pointage', vue: 'paie', libelle: 'Pointage', sous: 'Les heures du jour', lettre: 'H', faire: vers('#/paie', () => { paieState.tab = 'pt-jour'; delete paieState.ptJourIso; }) });
  // Ses gestes dans la palette (rangs 15 et 41 à 47). (plateforme) 1.232.0 — les gestes de la paie (docs/revue-paie.md,
  // P2) : chacun ouvre « Le mois » et lance le sien ; ces quatre-là ne s'y trouvent qu'avec au moins un salarié.
  Socle.poser('palette', 'personnel', { rang: 15, libelle: 'Nouveau salarié', faire: () => employeeForm(null, () => render()) });
  const avecSalaries = () => !!data.employees.length;
  Socle.poser('palette', 'personnel', { rang: 41, libelle: 'Payer les salaires du mois', visible: avecSalaries, faire: vers('#/paie', () => { paieState.tab = 'payer'; paieState.geste = 'payer'; }) });
  Socle.poser('palette', 'personnel', { rang: 42, libelle: 'Établir les bulletins du mois', visible: avecSalaries, faire: vers('#/paie', () => { paieState.tab = 'bulletins'; paieState.geste = 'etablir'; }) });
  Socle.poser('palette', 'personnel', { rang: 43, libelle: 'Remettre les bulletins du mois', visible: avecSalaries, faire: vers('#/paie', () => { paieState.tab = 'payer'; paieState.geste = 'remettre'; }) });
  Socle.poser('palette', 'personnel', { rang: 44, libelle: 'Approuver les bulletins du mois', visible: avecSalaries, faire: vers('#/paie', () => { paieState.tab = 'bulletins'; paieState.geste = 'approuver'; }) });
  Socle.poser('palette', 'personnel', { rang: 45, libelle: 'Nouveau salarié', faire: () => employeeForm(null, () => { paieState.tab = 'salaries'; navigate('#/paie'); }) });
  Socle.poser('palette', 'personnel', { rang: 46, libelle: 'Importer mes salariés depuis un tableur', faire: () => importerTableau('salaries', () => { paieState.tab = 'salaries'; navigate('#/paie'); }) });
  Socle.poser('palette', 'personnel', { rang: 47, libelle: 'Combien coûte une embauche ?', faire: () => simulationEmbauche() });
  // Le point « sorties prévues » de la Trésorerie : les salaires et les avances de ses échéances, et comment ouvrir
  // chacun (le bulletin, l'avance, la paie pour un salaire seulement prévu). Leurs montants viennent encore du moteur.
  Socle.remplir('sorties-prevues', 'personnel', () => [
    { sorte: 'salaire', ouvre: e => e.kind === 'salaire' || e.source === 'paie', ouvrir: (e, apres) => { const sl = (data.payslips || []).find(x => x.id === e.id); if (sl) payslipForm(sl, (data.employees || []).find(x => x.id === sl.employeeId), sl.year, sl.month, apres); } },
    { sorte: 'salaire-prevu', ouvre: e => e.kind === 'salaire-prevu', ouvrir: () => navigate('#/paie') },
    { sorte: 'avance', ouvre: e => e.source === 'avance', ouvrir: (e, apres) => { const a = (data.advances || []).find(x => x.id === e.id); if (a) advanceForm(a, a.employeeId, apres); } }
  ]);
  // Le point « déclarations sociales » du calendrier fiscal : la CNSS et la déclaration d'employeur se préparent sur
  // l'onglet Déclarations de la paie, et leur mention « déposée » se retire par la même question (16 § 10.1-6).
  const versDeclarations = () => { paieState.tab = 'declarations'; navigate('#/paie'); };
  Socle.remplir('declarations-sociales', 'personnel', () => [
    { id: 'cnss', preparer: versDeclarations, retirer: retirerDeclarationSociale },
    { id: 'employeur', preparer: versDeclarations, retirer: retirerDeclarationSociale }
  ]);
  })(); // la boîte du Personnel se ferme ici

