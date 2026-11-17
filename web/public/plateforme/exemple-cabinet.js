// Le dossier d'exemple d'un cabinet (1.370.0). Un comptable qui essaie SkanFact Cabinet n'a, le premier jour, aucun
// client à ouvrir. Le serveur crée UN dossier tenu marqué « exemple » (0214 : hors abonnement, retiré d'un geste) ; ce
// fichier le REMPLIT, par les gestes mêmes du Cabinet (la reprise, la saisie, la validation, la paie, la banque, les
// déclarations, la clôture) : ce que l'exemple montre est donc ce que l'outil fait, jamais une écriture posée à part.
//
// Ce qu'il raconte : une pâtisserie tenue de A à Z. L'exercice d'avant est complet et clôturé ; l'exercice en cours est
// tenu jusqu'au mois dernier, déclaré jusqu'à l'avant-dernier. Il reste donc au comptable ce qu'il ferait un vrai matin :
// la déclaration du mois dernier à préparer, le brouillard du mois en cours à valider, un relevé à rapprocher.
// Les dates suivent le jour où on le charge : un exemple daté montrerait des retards qui n'existent pas.
(function () {
  'use strict';
  /** @type {any} */ const w = window;
  const deux = (/** @type {number} */ n) => String(n).padStart(2, '0');
  // Les montants : en millimes ici (jamais de virgule flottante dans un total), en dinars à trois décimales au serveur.
  const dt = (/** @type {number} */ m) => (Math.round(m) / 1000).toFixed(3);
  const finDuMois = (/** @type {number} */ a, /** @type {number} */ m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  const jour = (/** @type {number} */ a, /** @type {number} */ m, /** @type {number} */ j) => `${a}-${deux(m)}-${deux(Math.min(j, finDuMois(a, m)))}`;
  const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const deMois = (/** @type {number} */ m) => { const n = NOMS_MOIS[m - 1] || ''; return /^[aeiouéèêàâîôûh]/i.test(n) ? `d'${n}` : `de ${n}`; }; // (1.378.4) « loyer d'octobre »
  const HOTEL = 'Hôtel Dar Jerba', CAFE = 'Café Jasmin', MINOTERIE = 'Minoterie du Cap Bon', BAILLEUR = 'SCI El Menzah', STEG = 'STEG';
  // Les taux sont ceux d'un exemple (19 % partout) : ils montrent une TVA à payer chaque mois, pas une règle fiscale.
  const TVA = 0.19;

  /** Les pièces d'un mois : ce qu'une pâtisserie vit chaque mois, un peu plus chaque mois.
   * @param {number} a @param {number} m @param {number} rang le rang du mois depuis le début de l'exemple
   * @param {number} [jusquau] le dernier jour à écrire (le mois en cours s'arrête à aujourd'hui) */
  function piecesDuMois(a, m, rang, jusquau) {
    const mm = deux(m), fin = jusquau || finDuMois(a, m);
    /** @type {any[]} */ const p = [];
    const piece = (/** @type {number} */ j, /** @type {string} */ journal, /** @type {string} */ ref, /** @type {string} */ libelle, /** @type {any[]} */ lignes) => {
      if (j <= fin) p.push({ date: jour(a, m, j), journal, piece: ref, libelle, lignes: lignes.map((l) => ({ compte: l.c, tiers: l.t || '', libelle: '', debit: l.d ? dt(l.d) : '', credit: l.k ? dt(l.k) : '' })) });
    };
    const ht = (/** @type {number} */ ttc, /** @type {number} */ taux) => Math.round(ttc / (1 + taux));
    // Les ventes : le comptoir (deux quinzaines), l'hôtel et le café livrés à crédit.
    for (const [j, part] of /** @type {[number, number][]} */ ([[15, 0.48], [finDuMois(a, m), 0.52]])) {
      const ttc = Math.round((13_800_000 + rang * 190_000) * part / 1000) * 1000, h = ht(ttc, TVA);
      piece(j, 'VT', `Z-${mm}${deux(j)}`, `Ventes au comptoir · ${j === 15 ? 'du 1er au 15' : `du 16 au ${j}`}`, [{ c: '54', d: ttc }, { c: '701', k: h }, { c: '4367', k: ttc - h }]);
    }
    const hotel = 2_140_000 + rang * 38_000, cafe = 486_000 + rang * 9_000;
    piece(20, 'VT', `FV-${a}-${mm}1`, `${HOTEL} · gâteaux et viennoiseries ${deMois(m)}`, [{ c: '411', t: HOTEL, d: hotel }, { c: '701', k: ht(hotel, TVA) }, { c: '4367', k: hotel - ht(hotel, TVA) }]);
    piece(25, 'VT', `FV-${a}-${mm}2`, `${CAFE} · livraisons ${deMois(m)}`, [{ c: '411', t: CAFE, d: cafe }, { c: '701', k: ht(cafe, TVA) }, { c: '4367', k: cafe - ht(cafe, TVA) }]);
    // Les achats : la farine (payée le mois d'après), le loyer et l'électricité (payés dans le mois).
    const farine = 8_330_000 + rang * 95_200, loyer = 1_428_000, steg = 618_800 + (m % 4) * 35_700;
    piece(6, 'AC', `FA-${mm}06`, `${MINOTERIE} · farine, beurre et sucre`, [{ c: '601', d: ht(farine, TVA) }, { c: '4366', d: farine - ht(farine, TVA) }, { c: '401', t: MINOTERIE, k: farine }]);
    piece(2, 'AC', `LOY-${mm}`, `${BAILLEUR} · loyer ${deMois(m)}`, [{ c: '613', d: ht(loyer, TVA) }, { c: '4366', d: loyer - ht(loyer, TVA) }, { c: '401', t: BAILLEUR, k: loyer }]);
    piece(18, 'AC', `STEG-${mm}`, `${STEG} · électricité et gaz`, [{ c: '606', d: ht(steg, TVA) }, { c: '4366', d: steg - ht(steg, TVA) }, { c: '401', t: STEG, k: steg }]);
    // La banque : les espèces versées, le loyer et l'électricité payés, l'échéance de l'emprunt, les frais.
    const comptoir = 13_800_000 + rang * 190_000;
    piece(16, 'BQ', `VERS-${mm}16`, 'Versement espèces', [{ c: '532', d: Math.round(comptoir * 0.48 / 1000) * 1000 }, { c: '54', k: Math.round(comptoir * 0.48 / 1000) * 1000 }]);
    piece(28, 'BQ', `VERS-${mm}28`, 'Versement espèces', [{ c: '532', d: Math.round(comptoir * 0.52 / 1000) * 1000 }, { c: '54', k: Math.round(comptoir * 0.52 / 1000) * 1000 }]);
    piece(3, 'BQ', `VIR-LOY-${mm}`, `VIR ${BAILLEUR}`, [{ c: '401', t: BAILLEUR, d: loyer }, { c: '532', k: loyer }]);
    piece(22, 'BQ', `PRLV-STEG-${mm}`, 'PRLV STEG', [{ c: '401', t: STEG, d: steg }, { c: '532', k: steg }]);
    piece(5, 'BQ', `ECH-${mm}`, 'Échéance emprunt BIAT', [{ c: '16', d: 400_000 }, { c: '651', d: 62_500 }, { c: '532', k: 462_500 }]);
    piece(26, 'BQ', `FRAIS-${mm}`, 'Frais de tenue de compte', [{ c: '627', d: 11_900 }, { c: '532', k: 11_900 }]);
    return { pieces: p, hotel, cafe, farine };
  }
  // Ce qu'un mois règle des mois d'avant : l'hôtel paie à trente jours, la farine se paie ; le café, lui, paie avec un
  // mois de retard de plus (il reste donc toujours une facture ouverte à lettrer et à relancer).
  /** @param {number} a @param {number} m @param {{ hotel: number, cafe: number, farine: number }} avant @param {number} [jusquau] @param {{ cafe: number } | null} [ancien] */
  function reglementsDuMois(a, m, avant, jusquau, ancien) {
    const mm = deux(m), fin = jusquau || 31;
    /** @type {any[]} */ const p = [];
    const piece = (/** @type {number} */ j, /** @type {string} */ ref, /** @type {string} */ libelle, /** @type {any[]} */ lignes) => { if (j <= fin) p.push({ date: jour(a, m, j), journal: 'BQ', piece: ref, libelle, lignes }); };
    piece(10, `VIR-${mm}10`, `VIR RECU ${HOTEL}`, [{ compte: '532', tiers: '', libelle: '', debit: dt(avant.hotel), credit: '' }, { compte: '411', tiers: HOTEL, libelle: '', debit: '', credit: dt(avant.hotel) }]);
    if (ancien) piece(12, `CHQ-${mm}12`, `Remise chèque ${CAFE}`, [{ compte: '532', tiers: '', libelle: '', debit: dt(ancien.cafe), credit: '' }, { compte: '411', tiers: CAFE, libelle: '', debit: '', credit: dt(ancien.cafe) }]);
    piece(8, `CHQ-${mm}08`, `CHQ ${MINOTERIE}`, [{ compte: '401', tiers: MINOTERIE, libelle: '', debit: dt(avant.farine), credit: '' }, { compte: '532', tiers: '', libelle: '', debit: '', credit: dt(avant.farine) }]);
    return p;
  }

  /** @param {{ api: any, appel: (m: string, c: string, corps?: unknown) => Promise<any>, cabinet: string, suivi?: (t: string) => void, jour?: string }} o */
  async function charger(o) {
    const { api, appel } = o;
    const dire = (/** @type {string} */ t) => { try { if (o.suivi) o.suivi(t); } catch { /* le suivi n'arrête pas le chargement */ } };
    const K = w.CabCore;
    const aujourdhui = String(o.jour || (K && K.today ? K.today() : new Date().toISOString().slice(0, 10)));
    const A = Number(aujourdhui.slice(0, 4)), M = Number(aujourdhui.slice(5, 7)), J = Number(aujourdhui.slice(8, 10));
    const Y1 = A - 1;
    dire('Création du dossier d\'exemple…');
    const cree = await appel('POST', `/cabinets/${o.cabinet}/exemple`, {});
    const id = String(cree.entreprise);
    try {
      await api.state();
      const base = `/entreprises/${id}/compta`;
      /** @param {any[]} pieces */
      const ecrire = async (pieces) => {
        for (let i = 0; i < pieces.length; i += 400) {
          const r = await appel('POST', `${base}/ecritures/lot`, { pieces: pieces.slice(i, i + 400).map((e) => ({ ecriture: e })) });
          const refus = (r.resultats || []).find((/** @type {any} */ x) => x.statut !== 'ajoutee');
          if (refus) throw new Error(`L'exemple n'a pas pu s'écrire : ${refus.motif || 'une pièce refusée'}`);
        }
      };
      // Valider : les pièces du mois d'abord (une à une, comme « Valider le lot »), puis la période, une fois le mois fini.
      const validerLeMois = (/** @type {number} */ a, /** @type {number} */ m) => api.validerLot({ dossierId: id, annee: a, mois: `${a}-${deux(m)}` });
      const valider = (/** @type {string} */ jusqua) => appel('POST', `${base}/valider`, { jusqua });
      // La déclaration d'un mois, comme le comptable la fait : préparée, son écriture passée et validée, déposée, payée.
      /** @param {number} a @param {number} m */
      const declarer = async (a, m) => {
        const periode = `${a}-${deux(m)}`, sa = m === 12 ? a + 1 : a, sm = m === 12 ? 1 : m + 1;
        await api.poserDeclaration({ dossierId: id, annee: a, periode });
        const e = await api.ecrireDeclaration({ dossierId: id, annee: a, periode }).catch(() => null);
        await valider(jour(a, m, 31));
        await api.pointerDeclaration({ dossierId: id, annee: a, periode, quoi: 'deposee', valeur: { le: jour(sa, sm, 24), reference: `TEJ-${a}${deux(m)}-0417` } });
        await api.pointerDeclaration({ dossierId: id, annee: a, periode, quoi: 'payee', valeur: { le: jour(sa, sm, 25) } });
        // Ce que l'écriture du mois laisse à payer à l'État part de la banque le 25 du mois d'après.
        const ligne = e && e.livre ? ((e.livre.ecritures || []).find((/** @type {any} */ x) => x.id === e.id) || { lignes: [] }).lignes.find((/** @type {any} */ l) => l.compte === '4365' && Number(l.credit) > 0) : null;
        return ligne ? { date: jour(sa, sm, 25), journal: 'BQ', piece: `TVA-${deux(m)}`, libelle: `Télépaiement TVA ${deMois(m)}`,
          lignes: [{ compte: '4365', tiers: '', libelle: '', debit: dt(Number(ligne.credit) * 1000), credit: '' }, { compte: '532', tiers: '', libelle: '', debit: '', credit: dt(Number(ligne.credit) * 1000) }] } : null;
      };

      // ── L'exercice d'avant : repris sur ses soldes, tenu douze mois, inventorié, amorti, clôturé ──
      dire(`L'exercice ${Y1} : la reprise des soldes…`);
      await api.reprendre({ dossierId: id, annee: Y1, ouverture: [
        { compte: '223', libelle: 'Four rotatif et pétrin', debit: 36000 }, { compte: '28', libelle: 'Amortissements du matériel', credit: 3600 },
        { compte: '31', libelle: 'Farine et levure en stock', debit: 1850 }, { compte: '532', libelle: 'BIAT · compte courant', debit: 14200 }, { compte: '54', libelle: 'Caisse', debit: 650 },
        { compte: '101', libelle: 'Capital social', credit: 30000 }, { compte: '12', libelle: 'Résultats reportés', credit: 4700 }, { compte: '16', libelle: 'Emprunt BIAT', credit: 14400 },
      ] });
      await api.saveImmobilisation({ dossierId: id, annee: Y1, fiche: { libelle: 'Four rotatif et pétrin', dateAcquisition: `${Y1 - 1}-01-02`, dateMiseEnService: `${Y1 - 1}-01-02`,
        valeur: 36000, residuelle: 0, duree: 10, methode: 'lineaire', compte: '223' } });
      /** @type {{ hotel: number, cafe: number, farine: number } | null} */ let avant = null;
      /** @type {{ hotel: number, cafe: number, farine: number } | null} */ let ancien = null;
      /** @type {any} */ let tva = null;
      let rang = 0;
      const salairesY1 = 4_320_000;
      for (let m = 1; m <= 12; m++, rang++) {
        dire(`L'exercice ${Y1} : ${NOMS_MOIS[m - 1]}…`);
        const mois = piecesDuMois(Y1, m, rang);
        const pieces = [...mois.pieces, ...(avant ? reglementsDuMois(Y1, m, avant, undefined, ancien) : []), ...(tva ? [tva] : []),
          { date: jour(Y1, m, 31), journal: 'PAIE', piece: `PAIE-${deux(m)}`, libelle: `Salaires ${deMois(m)} · 3 salariés`, lignes: [{ compte: '640', tiers: '', libelle: '', debit: dt(salairesY1), credit: '' }, { compte: '425', tiers: '', libelle: '', debit: '', credit: dt(salairesY1) }] },
          { date: jour(Y1, m, 31), journal: 'BQ', piece: `VIR-SAL-${deux(m)}`, libelle: 'VIR salaires', lignes: [{ compte: '425', tiers: '', libelle: '', debit: dt(salairesY1), credit: '' }, { compte: '532', tiers: '', libelle: '', debit: '', credit: dt(salairesY1) }] }];
        await ecrire(pieces);
        await validerLeMois(Y1, m);
        if (m === 12) {
          // Les écritures d'inventaire, avant que décembre ne se ferme : le stock compté, les dotations de l'année.
          dire(`L'exercice ${Y1} : l'inventaire et les amortissements…`);
          await api.saveInventaire({ dossierId: id, annee: Y1, inventaire: { date: `${Y1}-12-31`, compte: '31', lignes: [
            { ref: 'FAR-T55', libelle: 'Farine T55 (sacs de 50 kg)', quantite: 38, cout: 52.5 }, { ref: 'LEV', libelle: 'Levure fraîche (cartons)', quantite: 12, cout: 18.4 },
            { ref: 'BEU', libelle: 'Beurre de tourage (plaques)', quantite: 45, cout: 9.8 }] } });
          await api.ecrireVariationStock({ dossierId: id, annee: Y1 });
          await api.ecrireDotations({ dossierId: id, annee: Y1 });
          await api.validerLot({ dossierId: id, annee: Y1 });
        }
        tva = await declarer(Y1, m);
        ancien = avant; avant = mois;
      }
      dire(`L'exercice ${Y1} : la clôture, les à-nouveaux…`);
      await api.cloturer({ dossierId: id, annee: Y1 });
      await api.ouvrirSuivant({ dossierId: id, annee: Y1 });
      await api.validerLot({ dossierId: id, annee: A });

      // ── L'exercice en cours : tenu jusqu'au mois dernier, déclaré jusqu'à l'avant-dernier ──
      /** @type {{ id: string, brut: number }[]} */ const salaries = [];
      for (const sal of [{ nom: 'Hédi Ben Salem', emploi: 'Boulanger', brut: 1650, embauche: `${Y1 - 2}-03-01` }, { nom: 'Amel Trabelsi', emploi: 'Vendeuse', brut: 980, embauche: `${Y1 - 1}-09-01` },
        { nom: 'Youssef Mejri', emploi: 'Apprenti pâtissier', brut: 780, embauche: `${Y1}-02-01` }]) {
        const r = await api.saveSalarie({ dossierId: id, annee: A, salarie: sal });
        salaries.push({ id: String(r.salarie.id), brut: sal.brut });
      }
      // Ce qu'un mois laisse à payer le mois d'après : la TVA, les retenues sur salaires ; la CNSS, chaque trimestre.
      /** @type {any[]} */ let aPayer = tva ? [tva] : [];
      let cnssDuTrimestre = 0;
      /** @type {any} */ let livre = null;
      const bq = (/** @type {string} */ date, /** @type {string} */ ref, /** @type {string} */ libelle, /** @type {string} */ compte, /** @type {number} */ millimes) => ({ date, journal: 'BQ', piece: ref, libelle,
        lignes: [{ compte, tiers: '', libelle: '', debit: dt(millimes), credit: '' }, { compte: '532', tiers: '', libelle: '', debit: '', credit: dt(millimes) }] });
      for (let m = 1; m <= M; m++, rang++) {
        const enCours = m === M, limite = enCours ? J : 31;
        dire(`L'exercice ${A} : ${NOMS_MOIS[m - 1]}…`);
        const mois = piecesDuMois(A, m, rang, enCours ? J : undefined);
        const duMois = aPayer.filter((x) => x.date.slice(0, 7) === `${A}-${deux(m)}` && Number(x.date.slice(8)) <= limite);
        aPayer = aPayer.filter((x) => !duMois.includes(x) && x.date.slice(0, 7) > `${A}-${deux(m)}`);
        await ecrire([...mois.pieces, ...(avant ? reglementsDuMois(A, m, avant, enCours ? J : undefined, ancien) : []), ...duMois]);
        if (enCours) break;
        // La paie du mois, par la porte de la paie : un bulletin par salarié (une prime en juin, une absence en mars),
        // validés puis payés le dernier jour ; le serveur tient l'écriture de paie et le virement des salaires.
        /** @type {string[]} */ const bulletins = [];
        for (const [k, sal] of salaries.entries()) {
          const r = await api.saveBulletin({ dossierId: id, annee: A, bulletin: { salarieId: sal.id, annee: A, mois: m, brut: sal.brut, joursTravailles: 26, joursAbsence: m === 3 && k === 1 ? 2 : 0,
            primes: m === 6 ? [{ label: 'Prime de l\'Aïd', amount: 150, taxable: true }] : [], retenues: [] } });
          bulletins.push(String(r.bulletin.id));
        }
        const dernier = jour(A, m, 31), sa = m === 12 ? A + 1 : A, sm = m === 12 ? 1 : m + 1;
        await api.marquerBulletins({ dossierId: id, annee: A, ids: bulletins, champs: { valideLe: dernier } });
        // Payés le dernier jour ; remis aux salariés, sauf ceux du mois dernier (un geste laissé au comptable).
        await api.marquerBulletins({ dossierId: id, annee: A, ids: bulletins, champs: { paidDate: dernier, ...(m < M - 1 ? { remisLe: dernier } : {}) } });
        livre = (await validerLeMois(A, m)).livre;
        // Les dettes de la paie, lues sur son écriture : les retenues et les taxes se paient le 25, la CNSS chaque trimestre.
        const credits = (/** @type {RegExp} */ comptes) => Math.round(1000 * (livre.ecritures || []).filter((/** @type {any} */ e) => e.journal === 'PAIE' && String(e.date).slice(0, 7) === `${A}-${deux(m)}`)
          .reduce((/** @type {number} */ t, /** @type {any} */ e) => t + e.lignes.filter((/** @type {any} */ l) => comptes.test(String(l.compte))).reduce((/** @type {number} */ u, /** @type {any} */ l) => u + (Number(l.credit) || 0), 0), 0));
        const comptesDe = (/** @type {RegExp} */ comptes) => [...new Set((livre.ecritures || []).filter((/** @type {any} */ e) => e.journal === 'PAIE').flatMap((/** @type {any} */ e) => e.lignes.map((/** @type {any} */ l) => String(l.compte))).filter((/** @type {string} */ c) => comptes.test(c)))];
        for (const c of comptesDe(/^43[23]/)) { const n = credits(new RegExp(`^${c}$`)); if (n > 0) aPayer.push(bq(jour(sa, sm, 25), `${/^432/.test(c) ? 'IRPP' : 'TFP'}-${deux(m)}`, `Télépaiement ${/^432/.test(c) ? 'retenues sur salaires' : 'TFP et FOPROLOS'} ${deMois(m)}`, c, n)); }
        cnssDuTrimestre += credits(/^453/);
        if (m % 3 === 0 && cnssDuTrimestre > 0) { aPayer.push(bq(jour(sa, sm, 15), `CNSS-T${m / 3}`, `CNSS du ${m / 3}${m === 3 ? 'er' : 'e'} trimestre`, comptesDe(/^453/)[0] || '4531', cnssDuTrimestre)); cnssDuTrimestre = 0; }
        if (m < M - 1) { const t = await declarer(A, m); if (t) aPayer.push(t); } else await valider(dernier);
        ancien = avant; avant = mois;
      }
      // ── La banque : le relevé de l'avant-dernier mois, rapproché ; celui du mois dernier, à rapprocher ──
      if (livre) {
        const mouvements = (/** @type {number} */ m) => (livre.ecritures || []).filter((/** @type {any} */ e) => String(e.date).slice(0, 7) === `${A}-${deux(m)}` && e.journal !== 'AN')
          .flatMap((/** @type {any} */ e) => e.lignes.filter((/** @type {any} */ l) => String(l.compte) === '532').map((/** @type {any} */ l) => ({ date: e.date, libelle: String(e.libelle || e.piece).toUpperCase(), reference: '', montant: Math.round(1000 * ((Number(l.debit) || 0) - (Number(l.credit) || 0))) })))
          .sort((/** @type {any} */ x, /** @type {any} */ y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
        const soldeAu = (/** @type {string} */ avantLe) => Math.round(1000 * (livre.ecritures || []).filter((/** @type {any} */ e) => String(e.date) < avantLe)
          .reduce((/** @type {number} */ t, /** @type {any} */ e) => t + e.lignes.filter((/** @type {any} */ l) => String(l.compte) === '532').reduce((/** @type {number} */ u, /** @type {any} */ l) => u + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0), 0));
        for (const [m, rapproche] of /** @type {[number, boolean][]} */ ([[M - 2, true], [M - 1, false]])) {
          if (m < 1) continue;
          dire(`La banque : le relevé ${deMois(m)}…`);
          const lignes = mouvements(m);
          // Le relevé du mois dernier porte ce que le livre n'a pas encore : des agios, à écrire depuis la ligne.
          if (!rapproche) lignes.push({ date: jour(A, m, 30), libelle: 'AGIOS DEBITEURS 3E TRIMESTRE', reference: '', montant: -18_400 });
          const debut = soldeAu(`${A}-${deux(m)}-01`), fin = lignes.reduce((/** @type {number} */ t, /** @type {any} */ l) => t + l.montant, debut);
          const texte = JSON.stringify([id, A, m, lignes]);
          const empreinte = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)))].map((x) => x.toString(16).padStart(2, '0')).join('');
          const r = await api.ajouterReleve({ dossierId: id, annee: A, releve: { compte: '532', banque: 'BIAT', fichier: `Releve_BIAT_${deux(m)}-${A}.pdf`, empreinte,
            soldeDebut: debut / 1000, soldeFin: fin / 1000, lignes: lignes.map((/** @type {any} */ l) => ({ ...l, montant: l.montant / 1000 })) } });
          if (rapproche && r.releve) await api.rapprocherAuto({ dossierId: id, annee: A, releveId: r.releve.id, jours: 3 });
        }
      }
      // ── La fiche du dossier : qui c'est, comment le joindre, ce que le cabinet fait pour lui ──
      await api.saveDossier(id, { contact: 'Nadia El Amal', gerant: 'Nadia El Amal', fonction: 'Gérante', email: 'nadia@patisserie-elamal.example', phone: '71 000 000', forme: 'SARL', tvaPeriod: 'mensuelle',
        activite: 'Pâtisserie', adresse: '12 rue du Pain', ville: 'Tunis', fees: 250, banque: { compte: '532', banque: 'BIAT' },
        note: 'Dossier d\'exemple : une pâtisserie inventée, pour essayer le Cabinet. Rien de ce que tu fais ici ne compte.' });
      dire('Le dossier d\'exemple est prêt.');
      return { entreprise: id };
    } catch (e) {
      // Un exemple à moitié rempli montrerait des livres faux : il repart, et l'erreur se dit.
      await appel('DELETE', `/cabinets/${o.cabinet}/exemple`).catch(() => null);
      throw e;
    }
  }

  w.SkanExempleCabinet = { charger, piecesDuMois, reglementsDuMois };
})();
