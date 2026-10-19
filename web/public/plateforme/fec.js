// @ts-check
// Lire un FEC dans le navigateur (docs/cabinet.md, C61 ; docs/etudes/FORMATS-REPRISE.md) : le « fichier des
// écritures comptables » que Sage, Ciel, EBP, Odoo, Hesabi et la plupart des logiciels comptables exportent, et
// que le Cabinet prend pour reprendre les soldes d'ouverture d'un client qui arrive d'ailleurs.
//
// Le format (article A47 A-1 du livre des procédures fiscales français, que ces logiciels suivent) : une ligne
// de titres, puis une ligne par ligne d'écriture ; le séparateur est la tabulation ou la barre « | » ; 18
// colonnes reconnues par leur NOM (JournalCode, EcritureNum, EcritureDate, CompteNum, CompAuxNum, Debit,
// Credit…), jamais par leur rang : Dolibarr en écrit 21, et le texte permet « Montant » et « Sens » à la place
// de « Debit » et « Credit ». Les dates s'écrivent AAAAMMJJ ; la décimale est la virgule ou le point.
//
// Les règles, écrites d'avance :
//   - tout se lit, ou rien n'est repris : une ligne illisible (sa date, son compte, son montant) refuse le
//     fichier, nommée avec son numéro — une reprise fausse fausse l'exercice entier ;
//   - les montants se comptent en millimes entiers ; plus de trois décimales qui ne sont pas des zéros se
//     refusent, jamais arrondies en silence ;
//   - les soldes d'ouverture au premier jour du livre sont les À-NOUVEAUX de la v10 (compta.js, `anouveauxDe` :
//     la règle de la clôture, les classes 1 à 5 reportées, le net des classes 6 et 7 au compte 13, un tiers par
//     ligne) joués sur les lignes du fichier d'AVANT ce jour ; puis ils se recomptent en millimes, compte par
//     compte, sur le fichier lui-même : deux calculs, un chiffre, ou rien n'est repris ;
//   - un fichier qui commence ce jour-là (l'exercice en cours) porte ses à-nouveaux dans son journal
//     d'ouverture (AN, RAN, OUV…) : ce sont eux qui font la balance, et le rapport dit lequel ;
//   - rien ne part au serveur ici : la balance remplit la fenêtre, et seule la fenêtre l'envoie.

(function () {
  // Les colonnes, par leur nom tel que `nom` le réduit (sans accent, sans espace, en minuscules).
  const COLONNES = /** @type {const} */ ({
    journal: 'journalcode', journalLib: 'journallib', numero: 'ecriturenum', date: 'ecrituredate',
    compte: 'comptenum', compteLib: 'comptelib', aux: 'compauxnum', auxLib: 'compauxlib', piece: 'pieceref',
    libelle: 'ecriturelib', debit: 'debit', credit: 'credit', lettre: 'ecriturelet', montant: 'montant', sens: 'sens',
    devise: 'idevise', montantDevise: 'montantdevise',
  });
  const SEPARATEURS = ['\t', '|', ';'];
  // Les journaux où un logiciel range ses à-nouveaux : par leur code, ou par leur libellé.
  const CODES_OUVERTURE = ['AN', 'ANO', 'AN0', 'ANX', 'RAN', 'RANO', 'OUV', 'OUVERTURE'];
  const FAUTES_MONTREES = 8;

  /** @param {unknown} s */
  const nom = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  /** @param {unknown} s */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  /** @param {string} iso */
  const fmtJour = (iso) => iso.split('-').reverse().join('/');
  // Un montant en millimes, écrit comme l'écran l'écrit (« 24 525,625 »), sans passer par un nombre à virgule.
  /** @param {number} m */
  const chiffre = (m) => {
    const n = Math.abs(m);
    const ent = String(Math.floor(n / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
    return `${m < 0 ? '−' : ''}${ent},${String(n % 1000).padStart(3, '0')}`;
  };
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n.toLocaleString('fr-FR')} ${n > 1 ? (plusieurs || `${un}s`) : un}`;

  // Les champs d'une ligne. Le texte ne met pas de guillemets, mais un FEC repassé par un tableur en met parfois
  // autour d'un libellé qui contient le séparateur : un champ qui COMMENCE par un guillemet va jusqu'au guillemet
  // qui le ferme (« "" » en vaut un) ; ailleurs, un guillemet est un caractère comme un autre (des pneus 15").
  /** @param {string} ligne @param {string} sep */
  function decouper(ligne, sep) {
    /** @type {string[]} */ const out = [];
    let i = 0;
    for (;;) {
      let v = '';
      if (ligne[i] === '"') {
        i++;
        while (i < ligne.length) {
          if (ligne[i] === '"') { if (ligne[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; }
          v += ligne[i++];
        }
      }
      const j = ligne.indexOf(sep, i);
      out.push(v + (j < 0 ? ligne.slice(i) : ligne.slice(i, j)));
      if (j < 0) return out;
      i = j + 1;
    }
  }

  // Les colonnes d'une ligne de titres, ou null si ce n'est pas celle d'un FEC.
  /** @param {string} ligne */
  function entete(ligne) {
    for (const sep of SEPARATEURS) {
      const noms = decouper(ligne, sep).map(nom);
      /** @type {Record<string, number>} */ const col = {};
      for (const [cle, n] of Object.entries(COLONNES)) { const i = noms.indexOf(n); if (i >= 0) col[cle] = i; }
      const montants = (col.debit !== undefined && col.credit !== undefined) || (col.montant !== undefined && col.sens !== undefined);
      if (col.journal !== undefined && col.numero !== undefined && col.date !== undefined && col.compte !== undefined && montants) return { sep, col };
    }
    return null;
  }

  /** @param {string} texte */
  const premiereLigne = (texte) => (String(texte || '').replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '');
  // Le texte est-il un FEC ? (Sa ligne de titres le dit.)
  /** @param {string} texte */
  const estFec = (texte) => entete(premiereLigne(texte)) !== null;

  // Un montant en millimes ; null s'il ne se lit pas, ou s'il a plus de trois décimales qui comptent.
  /** @param {string} brut */
  function millimes(brut) {
    const s = String(brut ?? '').replace(/[\s\u00a0\u202f]/g, '');
    if (!s) return 0;
    const m = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(s);
    if (!m) return null;
    const dec = m[3] ?? '';
    if (/[1-9]/.test(dec.slice(3))) return null;
    const v = Number(m[2] ?? '') * 1000 + Number(dec.slice(0, 3).padEnd(3, '0'));
    if (!Number.isSafeInteger(v)) return null;
    return m[1] === '-' ? -v : v;
  }

  // Un jour du calendrier (AAAA-MM-JJ) : AAAAMMJJ, comme le veut le texte, ou AAAA-MM-JJ, ou JJ/MM/AAAA (un FEC
  // repassé par un tableur) ; null pour un jour qui n'existe pas.
  /** @param {string} brut */
  function jour(brut) {
    const s = String(brut ?? '').trim();
    const iso = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
    const fr = iso ? null : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    const amj = iso ? [iso[1], iso[2], iso[3]] : fr ? [fr[3], fr[2], fr[1]] : null;
    if (!amj) return null;
    const [a = 0, mo = 0, j = 0] = amj.map(Number);
    const d = new Date(Date.UTC(a, mo - 1, j));
    return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j ? amj.join('-') : null;
  }

  /**
   * @typedef {{ no: number, journal: string, journalLib: string, numero: string, date: string, compte: string,
   *   compteLib: string, aux: string, tiers: string, piece: string, libelle: string, debit: number, credit: number,
   *   lettre: string, alpha: string }} LigneFec
   */

  // Tout le fichier : ses lignes (montants en millimes), sa période, ses journaux, son total ; ou son refus.
  /** @param {string} texte */
  function lire(texte) {
    const brutes = String(texte || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const h = brutes.findIndex((l) => l.trim());
    const tete = h >= 0 ? entete(brutes[h] ?? '') : null;
    if (!tete) return { ok: false, motif: 'Ce fichier n\'est pas un FEC : sa première ligne doit nommer ses colonnes (JournalCode, EcritureNum, EcritureDate, CompteNum, Debit, Credit…).' };
    const { sep, col } = tete;
    /** @type {LigneFec[]} */ const lignes = [];
    /** @type {{ ligne: number, motif: string }[]} */ const fautes = [];
    const champ = (/** @type {string[]} */ f, /** @type {string} */ cle) => { const k = col[cle]; return k === undefined ? '' : String(f[k] ?? '').trim(); };
    const largeur = Math.max(...Object.values(col)) + 1;
    for (let i = h + 1; i < brutes.length; i++) {
      const brute = brutes[i] ?? '';
      if (!brute.trim()) continue;
      const no = i + 1;
      const f = decouper(brute, sep);
      if (f.length < largeur) { fautes.push({ ligne: no, motif: `il manque des colonnes (${f.length} au lieu de ${largeur} au moins)` }); continue; }
      const date = jour(champ(f, 'date'));
      if (!date) { fautes.push({ ligne: no, motif: `la date « ${champ(f, 'date')} » ne se lit pas (AAAAMMJJ)` }); continue; }
      const journal = champ(f, 'journal');
      if (!journal) { fautes.push({ ligne: no, motif: 'elle n\'a pas de code journal' }); continue; }
      // Le compte : un numéro (au plus 12 chiffres, comme le livre) ; un compte de tiers écrit avec des lettres
      // (« 411DUPONT », un logiciel sans comptes auxiliaires) se range sur son numéro, au nom de son tiers.
      const brut = champ(f, 'compte');
      let compte = brut, alpha = '';
      if (!/^\d{1,12}$/.test(brut)) {
        const m = /^(\d{3,12})[^\d]/.exec(brut);
        if (!m) { fautes.push({ ligne: no, motif: `le compte « ${brut} » n'est pas un numéro` }); continue; }
        compte = m[1] ?? ''; alpha = brut;
      }
      /** @type {number | null} */ let debit, credit;
      if (col.debit !== undefined) { debit = millimes(champ(f, 'debit')); credit = millimes(champ(f, 'credit')); }
      else {
        const m = millimes(champ(f, 'montant'));
        const s = champ(f, 'sens').toUpperCase();
        const d = s === 'D' || s === '+1' || s === '1', c = s === 'C' || s === '-1';
        if (!d && !c) { fautes.push({ ligne: no, motif: `le sens « ${champ(f, 'sens')} » n'est ni D ni C` }); continue; }
        debit = d ? m : 0; credit = c ? m : 0;
      }
      if (debit === null || credit === null) {
        fautes.push({ ligne: no, motif: `le montant « ${debit === null ? champ(f, col.debit !== undefined ? 'debit' : 'montant') : champ(f, 'credit')} » ne se lit pas (au plus trois décimales)` });
        continue;
      }
      const aux = champ(f, 'aux');
      lignes.push({
        no, journal, journalLib: champ(f, 'journalLib'), numero: champ(f, 'numero'), date, compte,
        compteLib: alpha ? '' : champ(f, 'compteLib'), aux: aux || alpha,
        tiers: champ(f, 'auxLib') || aux || (alpha ? (champ(f, 'compteLib') || alpha) : ''),
        piece: champ(f, 'piece'), libelle: champ(f, 'libelle'), debit, credit, lettre: champ(f, 'lettre'), alpha,
      });
    }
    if (fautes.length) {
      const vues = fautes.slice(0, FAUTES_MONTREES).map((x) => `ligne ${x.ligne} : ${x.motif}`).join(' ; ');
      const reste = fautes.length > FAUTES_MONTREES ? ` ; et ${pl(fautes.length - FAUTES_MONTREES, 'autre')}` : '';
      return { ok: false, fautes, motif: `Ce FEC ne se lit pas en entier, rien n'est repris — ${vues}${reste}. Exporte-le de nouveau depuis ton ancien logiciel, sans le retoucher.` };
    }
    const premiere = lignes[0];
    if (!premiere) return { ok: false, motif: 'Ce FEC n\'a aucune écriture.' };
    let debit = 0, credit = 0, du = premiere.date, au = premiere.date;
    /** @type {Map<string, { code: string, lib: string, lignes: number }>} */ const journaux = new Map();
    const ecritures = new Set();
    for (const l of lignes) {
      debit += l.debit; credit += l.credit;
      if (l.date < du) du = l.date;
      if (l.date > au) au = l.date;
      const j = journaux.get(l.journal) || { code: l.journal, lib: l.journalLib, lignes: 0 };
      j.lignes++;
      journaux.set(l.journal, j);
      ecritures.add(`${l.journal}\u0000${l.numero}\u0000${l.numero ? '' : l.date}`);
    }
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) return { ok: false, motif: 'Ce FEC porte des montants trop grands pour être additionnés exactement.' };
    if (debit !== credit) return { ok: false, motif: `Ce FEC ne tombe pas juste : débit ${chiffre(debit)} ≠ crédit ${chiffre(credit)}. Rien n'est repris : exporte-le de nouveau depuis ton ancien logiciel.` };
    return { ok: true, separateur: sep, lignes, du, au, debit, credit, ecritures: ecritures.size, journaux: [...journaux.values()] };
  }

  /** @param {LigneFec} l */
  const dOuverture = (l) => CODES_OUVERTURE.includes(l.journal.toUpperCase()) || /nouveau|ouverture|report/.test(nom(l.journalLib));
  // Le jour d'un an avant (le 01/01/2026 → le 01/01/2025 ; un 29 février → le 1er mars).
  /** @param {string} iso */
  const unAnAvant = (iso) => { const [a = 0, m = 0, j = 0] = iso.split('-').map(Number); return new Date(Date.UTC(a - 1, m - 1, j)).toISOString().slice(0, 10); };

  // Les soldes d'ouverture au jour `du`, par la règle de la clôture de la v10 (`KC.anouveauxDe`), recomptés en
  // millimes sur le fichier ; ou le refus, avec ce qu'il faut choisir à la place.
  /** @param {any} lu ce que `lire` a rendu @param {string} du @param {any} KC le moteur de la v10 (compta.js) */
  function ouverture(lu, du, KC) {
    /** @type {LigneFec[]} */ const toutes = lu.lignes;
    const avant = toutes.filter((l) => l.date < du);
    const leJour = toutes.filter((l) => l.date === du && dOuverture(l));
    const source = avant.length ? 'cloture' : leJour.length ? 'journal' : '';
    if (!source) {
      return { ok: false, motif: `Ce FEC commence le ${fmtJour(lu.du)} : il ne dit pas ce que les comptes portaient avant le ${fmtJour(du)}, et il n'a pas de journal d'à-nouveaux ce jour-là. Choisis le FEC de l'exercice qui finit la veille, le ${fmtJour(new Date(Date.parse(`${du}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}.` };
    }
    const prises = source === 'cloture' ? avant : leJour;
    const debut = prises.reduce((m, l) => (l.date < m ? l.date : m), du);
    const fin = prises.reduce((m, l) => (l.date > m ? l.date : m), '0000-00-00');
    // Un seul exercice : additionner deux années compterait deux résultats au compte 13, dont l'un est déjà affecté.
    if (source === 'cloture' && debut < unAnAvant(du)) {
      return { ok: false, motif: `Ce FEC commence le ${fmtJour(debut)} : avant le ${fmtJour(du)}, il couvre plus d'un exercice. Exporte celui qui finit le ${fmtJour(fin)} seul.` };
    }
    let debit = 0, credit = 0;
    for (const l of prises) { debit += l.debit; credit += l.credit; }
    if (debit !== credit) {
      return { ok: false, motif: `Les lignes du FEC d'avant le ${fmtJour(du)} ne tombent pas juste : débit ${chiffre(debit)} ≠ crédit ${chiffre(credit)}. Rien n'est repris : exporte de nouveau l'exercice entier.` };
    }

    // Le livre que ces lignes feraient : une écriture validée par numéro de pièce, ses lignes en dinars.
    /** @type {Map<string, any>} */ const parEcriture = new Map();
    /** @type {Map<string, string>} */ const libelles = new Map();
    for (const l of prises) {
      const cle = `${l.journal}\u0000${l.numero}\u0000${l.numero ? '' : l.date}`;
      const e = parEcriture.get(cle) || { id: `fec-${parEcriture.size + 1}`, date: l.date, journal: 'OD', piece: l.piece || l.numero, libelle: l.libelle, statut: 'validee', lignes: [] };
      e.lignes.push({ compte: l.compte, libelle: l.compteLib, tiers: l.tiers, tiersId: l.aux, lettre: l.lettre, debit: l.debit / 1000, credit: l.credit / 1000 });
      parEcriture.set(cle, e);
      if (l.compteLib && !libelles.has(l.compte)) libelles.set(l.compte, l.compteLib);
    }
    const annee = Number(fin.slice(0, 4));
    const livre = { exercice: { annee, du: debut, au: fin }, ecritures: [...parEcriture.values()], plan: [], ouverture: { lignes: [] } };
    const an = KC.anouveauxDe(livre);

    // Deux calculs, un chiffre : le solde de chaque compte, compté en millimes sur le fichier (le net des classes
    // 6 et 7 au compte 13), contre ce que la règle de la clôture pose.
    /** @type {Map<string, number>} */ const attendu = new Map();
    let gestion = 0;
    for (const l of prises) {
      if (l.compte[0] === '6' || l.compte[0] === '7') gestion += l.debit - l.credit;
      else attendu.set(l.compte, (attendu.get(l.compte) || 0) + l.debit - l.credit);
    }
    if (gestion) attendu.set('13', (attendu.get('13') || 0) + gestion);
    /** @type {Map<string, number>} */ const pose = new Map();
    for (const l of an.lignes) pose.set(String(l.compte), (pose.get(String(l.compte)) || 0) + Math.round(Number(l.debit) * 1000) - Math.round(Number(l.credit) * 1000));
    for (const c of new Set([...attendu.keys(), ...pose.keys()])) {
      const a = attendu.get(c) || 0, p = pose.get(c) || 0;
      if (a !== p) return { ok: false, motif: `Les deux calculs de la balance d'ouverture ne donnent pas le même chiffre sur le compte ${c} (${chiffre(a)} dans le fichier, ${chiffre(p)} par la clôture) : rien n'est repris. Signale-le au support.` };
    }
    if (!an.equilibre) return { ok: false, motif: 'La balance d\'ouverture calculée ne tombe pas juste : rien n\'est repris. Signale-le au support.' };

    const lignes = an.lignes.map((/** @type {any} */ l) => ({
      compte: String(l.compte), tiers: l.tiers ? String(l.tiers) : '',
      libelle: l.tiers ? String(l.libelle || '') : (libelles.get(String(l.compte)) || String(l.libelle || '')),
      debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    }));
    const code = source === 'journal' ? (leJour[0]?.journal ?? '') : '';
    const journal = code ? (lu.journaux.find((/** @type {any} */ j) => j.code === code) || { code, lib: '' }) : null;
    return {
      ok: true, du, source, lignes,
      fichier: { du: lu.du, au: lu.au, lignes: toutes.length, ecritures: lu.ecritures, journaux: lu.journaux.length, total: lu.debit },
      prises: { du: debut, au: fin, lignes: prises.length },
      journal, annee,
      comptes: new Set(lignes.map((/** @type {{ compte: string }} */ l) => l.compte)).size,
      tiers: lignes.filter((/** @type {{ tiers: string }} */ l) => l.tiers).length,
      total: lignes.reduce((/** @type {number} */ s, /** @type {{ debit: number }} */ l) => s + Math.round(l.debit * 1000), 0),
      // Le résultat, signe du bénéfice : positif quand les produits passent les charges.
      resultat: gestion ? -gestion : 0,
      apres: toutes.length - prises.length,
      alpha: [...new Set(prises.filter((l) => l.alpha).map((l) => l.alpha))],
    };
  }

  // Le rapport, lu avant que la balance change : ce que le fichier porte, ce qui est repris, et ce qui ne l'est pas.
  /** @param {any} r ce que `ouverture` a rendu @param {string} fichier son nom */
  function rapport(r, fichier) {
    const ligne = (/** @type {string} */ a, /** @type {string} */ b) => `<tr><td>${a}</td><td class="r nw">${b}</td></tr>`;
    const res = r.resultat;
    const html = `<p class="small muted">« ${esc(fichier)} », lu sur cet ordinateur : <b>rien n'est encore repris</b>.</p>
      <table class="list compact" id="fec-rapport"><tbody>
        ${ligne('Le fichier', `du ${esc(fmtJour(r.fichier.du))} au ${esc(fmtJour(r.fichier.au))}`)}
        ${ligne('Ses écritures', esc(`${pl(r.fichier.ecritures, 'écriture')}, ${pl(r.fichier.lignes, 'ligne')}, ${pl(r.fichier.journaux, 'journal', 'journaux')}`))}
        ${ligne('Son total (débit = crédit)', esc(chiffre(r.fichier.total)))}
        ${ligne(`La balance d'ouverture au ${esc(fmtJour(r.du))}`, esc(`${pl(r.lignes.length, 'ligne')}, ${pl(r.comptes, 'compte')}`))}
        ${r.tiers ? ligne('dont clients et fournisseurs, une ligne par tiers', esc(String(r.tiers))) : ''}
        ${res ? ligne(`Le résultat de ${esc(String(r.annee))} (${res > 0 ? 'un bénéfice' : 'une perte'}), au compte 13`, esc(chiffre(Math.abs(res)))) : ''}
        ${ligne('Le total de la balance (débit = crédit)', esc(chiffre(r.total)))}
      </tbody></table>
      <p class="small ligne-ok mt" id="fec-deux-calculs"><span aria-hidden="true">✓</span> Deux calculs, un chiffre : ces soldes sont les à-nouveaux que SkanFact pose à la clôture d'un exercice, et ils redonnent, compte par compte, le solde du fichier au ${esc(fmtJour(r.prises.au))}.</p>
      ${r.journal ? `<p class="small muted">Ils viennent du journal ${esc(r.journal.code)}${r.journal.lib ? ` (« ${esc(r.journal.lib)} »)` : ''}, daté du ${esc(fmtJour(r.du))} : les à-nouveaux de ton ancien logiciel.</p>` : ''}
      ${r.apres ? `<p class="small muted" id="fec-apres">${esc(pl(r.apres, 'ligne'))} du ${esc(fmtJour(r.du))} ou après ${r.apres > 1 ? 'sont' : 'est'} des mouvements de l'exercice, pas ses soldes d'ouverture : la balance ne les prend pas.</p>` : ''}
      ${r.alpha.length ? `<p class="small muted">${esc(pl(r.alpha.length, 'compte'))} de tiers écrit${r.alpha.length > 1 ? 's' : ''} avec des lettres (« ${esc(r.alpha[0])} »${r.alpha.length > 1 ? '…' : ''}) ${r.alpha.length > 1 ? 'sont repris sur leur numéro' : 'est repris sur son numéro'}, au nom du tiers.</p>` : ''}
      <p class="small muted">Ces lignes remplacent la balance de la fenêtre : relis-les, corrige-les si besoin, puis ouvre l'exercice.</p>`;
    return { titre: 'Reprendre les soldes de ce FEC ?', html, bouton: 'Reprendre ces soldes' };
  }

  /** @type {any} */ (window).SkanFec = { estFec, lire, ouverture, rapport, millimes, jour, decouper };
})();
