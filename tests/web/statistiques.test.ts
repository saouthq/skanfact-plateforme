// 1.296.0 — Les statistiques jouées comme une quincaillerie (docs/revue-modules.md, « Les statistiques ») : Youssef facture
// des chantiers et vend au comptoir. La page dit en quatre chiffres ce qui est vendu, entré, gagné et acheté ; les ventes se
// coupent entre factures et tickets ; les refus de devis se rangent par motif ; les achats se répartissent par fournisseur
// et par catégorie (un avoir en moins, un acompte dehors) ; l'export dit ce que la page dit ; tout tient au téléphone.
// Une entreprise neuve lit, onglet par onglet, ce qui remplira la page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('les statistiques : vendu, encaissé, gagné, acheté', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-stats-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const net = (t: string) => t.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const entreprise = async (nom: string) => {
    const email = `stats-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Youssef Ben Youssef', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    return { jeton, ent };
  };
  const ouvrir = async (jeton: string, ent: string, largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stats`);
    await expect.poll(() => p.locator('#s-resume .mg-chiffre').count(), { timeout: 20_000 }).toBe(4);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    return { cx, p, erreurs };
  };
  const onglet = async (p: Page, t: string) => { await p.locator(`#s-tabs [data-tab="${t}"]`).click(); await expect.poll(() => p.locator(`#s-tabs [data-tab="${t}"]`).getAttribute('aria-selected')).toBe('true'); };
  const chiffre = async (p: Page, id: string) => net(await p.locator(`#${id}`).innerText());
  const lignes = (p: Page, sel: string) => p.locator(`${sel} tbody tr`).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')]
    .filter((td) => getComputedStyle(td).display !== 'none').map((td) => (td.textContent ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim())));

  it('une quincaillerie : quatre chiffres, factures et comptoir, les refus par motif, les achats répartis, l\'export, le téléphone', async () => {
    const { jeton, ent } = await entreprise('Quincaillerie Ben Youssef');
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const an = Number(auj.slice(0, 4));
    // Le même jour l'an dernier : la même période, pour la comparaison (un 29 février devient le 28).
    const avant = `${an - 1}${auj.slice(4) === '-02-29' ? '-02-28' : auj.slice(4)}`;
    const n = (x: number) => (Number.isInteger(x) ? x : { '~n': String(x) });
    const plat = (d: Obj): Obj => JSON.parse(JSON.stringify(d), (_k, v) => (v && typeof v === 'object' && '~n' in v ? Number(v['~n']) : v));
    const co = { ...C.DEFAULT_COMPANY, currency: 'DT' };
    const aPayer = (d: Obj) => C.computeTotals(plat(d), co).netToPay.toFixed(3);
    const prix: Record<string, [string, number, number]> = { ciment: ['Ciment CPJ45 sac 50 kg', 18.5, 14.2], fer: ['Fer à béton 12 mm (barre)', 32.75, 27.1], robinet: ['Robinet mélangeur', 89, 55.4], cadenas: ['Cadenas 40 mm', 12.345, 7.8] };
    const ligne = (id: string, qty: number) => { const [label, p0, c0] = prix[id] as [string, number, number]; return { itemId: id, label, description: '', qty, unit: 'u', unitPrice: n(p0), unitCost: n(c0), vatRate: 19 }; };
    const base = { discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, regimeTva: 'reel' };
    const o = (collection: string, cle: string, rang: number | null, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: { id: cle, ...contenu } });
    const clients: [string, string][] = [['sotub', 'Société Sotub'], ['kallel', 'Mme Kallel']];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      ...clients.map(([id, name], i) => o('clients', id, i, { name })),
      ...Object.entries(prix).map(([id, [label, p0, c0]], i) => o('catalog', id, 10 + i, { label, unit: 'u', unitPrice: n(p0), unitCost: n(c0), vatRate: 19 })),
      o('suppliers', 'sahel', 20, { name: 'Grossiste Quincaillerie du Sahel' }), o('suppliers', 'steg', 21, { name: 'STEG' }), o('suppliers', 'fer-tn', 22, { name: 'Fer de Tunisie' }),
      o('accounts', 'k-caisse', 30, { name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 50, openingDate: `${an - 1}-01-01`, isDefault: false, statementBalance: '', notes: '' }),
      o('accounts', 'biat', 31, { name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: 1000, openingDate: `${an - 1}-01-01`, isDefault: true, statementBalance: '', notes: '' }),
    ] })).statut).toBe(200);
    let rang = 40;
    const emettre = async (id: string, type: string, date: string, clientId: string, ls: [string, number][], extra: Obj = {}) => {
      const doc = { id, type, number: '', date, dueDate: date, clientId, subject: 'Fournitures', status: 'brouillon', lines: ls.map(([a, q]) => ligne(a, q)), ...base, createdAt: Date.parse(date), ...extra };
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [o('documents', id, rang, doc)] })).statut).toBe(200);
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/${type === 'avoir' ? 'emettre-avoir' : 'emettre'}`, jeton, { document: doc, client: { id: clientId, name: clients.find((c) => c[0] === clientId)?.[1] }, revision: 1, rang, netAPayer: aPayer(doc) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      return { doc, e, rang: rang++ };
    };
    // L'an dernier, le même jour : une facture de fer à béton (327,500 HT), réglée le jour même.
    const f0 = await emettre('f0', 'facture', avant, 'sotub', [['fer', 10]]);
    // Aujourd'hui : le chantier de la Sotub (5 722,500 HT), réglé ; Mme Kallel (227,380 HT), un robinet rendu (89 HT).
    const f1 = await emettre('f1', 'facture', auj, 'sotub', [['ciment', 150], ['fer', 90]]);
    await emettre('f2', 'facture', auj, 'kallel', [['robinet', 2], ['cadenas', 4]]);
    await emettre('a1', 'avoir', auj, 'kallel', [['robinet', 1]], { creditOf: 'f2', creditReason: 'Un robinet rendu' });
    for (const f of [f0, f1]) {
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: f.doc.id, rang: f.rang, revision: Number(f.e.corps.revision),
        contenu: { ...f.e.corps.contenu, payments: [{ id: 'p-' + f.doc.id, date: f.doc.date, amount: n(Number(aPayer(f.doc))), method: 'virement', reference: '', accountId: 'biat' }] } }] })).statut).toBe(200);
    }
    // Le comptoir : deux tickets (24,690 et 55,500 HT).
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '50' })).statut).toBe(200);
    for (const [i, ls] of ([[['cadenas', 2]], [['ciment', 3]]] as [string, number][][]).entries()) {
      const doc: Obj = { id: 'tk' + i, type: 'facture', ticket: true, number: '', date: auj, clientId: '', lines: ls.map(([a, q]) => ligne(a, q)), ...base, status: 'envoyée', caisse: { mode: 'especes', recu: null, rendu: null } };
      doc.payments = [{ id: 'pk' + i, date: auj, amount: n(Number(aPayer(doc))), method: 'especes', accountId: 'k-caisse', reference: '', note: '' }];
      const t = await api('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: doc, rang: rang++, netAPayer: aPayer(doc) });
      expect(t.statut, JSON.stringify(t.corps)).toBe(200);
    }
    // Les devis du jour : deux « trop cher » écrits différemment, un concurrent, un accepté, un qui attend.
    const devis: [string, string, string][] = [['d1', 'refusé', 'Trop cher'], ['d2', 'refusé', ' trop cher'], ['d3', 'refusé', 'Un concurrent'], ['d4', 'accepté', ''], ['d5', 'envoyé', '']];
    // Les achats : le grossiste (une facture, un avoir dont la catégorie est écrite en minuscules), la STEG, une dépense sans
    // fournisseur ni catégorie, et un acompte versé à Fer de Tunisie, qui n'est pas un achat. L'an dernier, une facture du grossiste.
    const achat = (id: string, kind: string, date: string, supplierId: string, category: string, ht: number) => o('purchases', id, null, {
      kind, number: id.toUpperCase(), date, dueDate: '', supplierId, category, subject: category || 'Divers', lines: [{ label: category || 'Divers', qty: 1, unitPrice: n(ht), vatRate: 19, destination: 'charge' }], payments: [], currency: 'DT' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      ...devis.map(([id, status, motif], i) => o('documents', id, rang + i, { type: 'devis', number: `DEV-${an}-00${i + 1}`, date: auj, dueDate: `${an + 1}-12-31`, clientId: 'sotub', subject: 'Proposition', status,
        lines: [ligne('fer', 20 + i)], ...base, createdAt: Date.now(), ...(status === 'refusé' ? { reponse: { statut: 'refusé', le: auj, motif } } : {}) })),
      achat('a0', 'facture', avant, 'sahel', 'Marchandises', 2350.6), achat('a1', 'facture', auj, 'sahel', 'Marchandises', 4120.35), achat('a2', 'avoir', auj, 'sahel', 'marchandises', 212.4),
      achat('a3', 'facture', auj, 'steg', 'Électricité', 186.732), achat('a4', 'depense', auj, '', '', 38), achat('a5', 'acompte', auj, 'fer-tn', 'Marchandises', 1500),
    ] })).statut).toBe(200);

    const { cx, p, erreurs } = await ouvrir(jeton, ent);
    // 1. Les quatre chiffres de l'année : 5 860,880 de factures et 80,190 de tickets ; l'encaissé (le chantier et les deux
    // tickets, TTC), avec ce que Mme Kallel doit encore ; la marge du calcul des Marges (5 941,070 vendus moins 4 713,800 de
    // coût) ; les achats, l'acompte dehors.
    await expect.poll(() => chiffre(p, 's-c-ventes')).toBe(`Vendu HT i 5 941,070 DT ▲ 1714 % sur la même période de ${an - 1}`);
    expect(await chiffre(p, 's-c-encaisse')).toBe('Encaissé i 6 905,201 DT 3 règlements · 164,672 DT encore dus');
    expect(await chiffre(p, 's-c-marge')).toBe('Marge estimée i 1 227,270 DT 20,7 % de ce qui est vendu · voir les marges');
    expect(await chiffre(p, 's-c-achats')).toBe(`Acheté HT i 4 132,682 DT ▲ 76 % sur la même période de ${an - 1}`);
    // Acheter plus n'est ni bien ni mal : la flèche des achats reste grise.
    expect(await p.locator('#s-c-achats .delta').getAttribute('class')).toBe('delta ');
    expect(await p.locator('#s-c-ventes .delta').getAttribute('class')).toBe('delta up');

    // 2. Factures et comptoir : deux paniers moyens qui ne se mélangent pas ; la TVA de toutes les ventes, sous le tableau.
    expect(await lignes(p, '#s-canaux')).toEqual([['Factures', '2et 1 avoir', '5 860,880', '2 930,440'], ['Tickets de caisse', '2', '80,190', '40,095']]);
    expect(net(await p.locator('#s-tva').innerText())).toBe('TVA collectée sur la période : 1 128,803 DT, à reverser, avoirs déduits. i');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'statistiques-1-ventes.png') });

    // 3. Les devis : un sur quatre tranchés accepté ; « trop cher » deux fois, quelle que soit la façon de l'écrire.
    await onglet(p, 'devis');
    await expect.poll(async () => net(await p.locator('#s-taux').innerText())).toMatch(/^Taux d'acceptation : 25 % \(sur les devis tranchés/);
    expect(await lignes(p, '#s-refus')).toEqual([['Trop cher', '2', '1 597,873'], ['Un concurrent', '1', '857,395']]);
    expect(net(await p.locator('#s-refus .sx-note').innerText())).toBe('« Trop cher » revient dans 2 refus sur 3.');

    // 4. Les achats : par fournisseur et par catégorie, l'avoir en moins, l'acompte nulle part ; le même total des deux côtés.
    await onglet(p, 'achats');
    // (La pastille du fournisseur porte ses initiales ; la dernière colonne est la barre de la part.)
    await expect.poll(() => lignes(p, '#s-sx-f')).toEqual([['GQGrossiste Quincaillerie du Sahel', '2', '3 907,950', '94,6 %', ''], ['SSTEG', '1', '186,732', '4,5 %', ''], ['Sans fournisseur', '1', '38,000', '0,9 %', '']]);
    expect(await lignes(p, '#s-sx-c')).toEqual([['Marchandises', '2', '3 907,950', '94,6 %', ''], ['Électricité', '1', '186,732', '4,5 %', ''], ['Sans catégorie', '1', '38,000', '0,9 %', '']]);
    expect(net(await p.locator('#s-sx-f tfoot').innerText())).toBe(net(await p.locator('#s-sx-c tfoot').innerText()).replace('3 catégories', '3 fournisseurs'));
    expect(net(await p.locator('#s-body').innerText())).not.toContain('Fer de Tunisie');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'statistiques-2-achats.png') });

    // 5. L'export dit ce que la page dit : le comptoir, l'encaissé, les achats répartis, les motifs de refus.
    const [fichier] = await Promise.all([p.waitForEvent('download'), p.locator('#s-export').click()]);
    expect(fichier.suggestedFilename()).toBe(`statistiques-${an}.csv`);
    const csv = net(fs.readFileSync(await fichier.path(), 'utf8'));
    for (const attendu of ['Dont tickets de caisse;80,190 DT (2 tickets)', 'Encaissé sur la période;6 905,201 DT (3 règlements)',
      'Achats par fournisseur;Grossiste Quincaillerie du Sahel;3 907,950 DT (2 pièces)', 'Achats par catégorie;Sans catégorie;38,000 DT (1 pièce)', 'Devis refusés;Trop cher;2 (1 597,873 DT)']) expect(csv).toContain(attendu);

    // 6. Une ligne de fournisseur ouvre sa fiche.
    await p.locator('#s-sx-f tr[data-fournisseur="sahel"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/fournisseur/sahel');
    expect(erreurs).toEqual([]);
    await cx.close();

    // 7. Au téléphone : rien ne déborde, chaque tableau tient dans sa carte, onglet après onglet.
    const tel = await ouvrir(jeton, ent, 390);
    for (const t of ['ventes', 'devis', 'clients', 'achats']) {
      await onglet(tel.p, t);
      expect(await tel.p.evaluate(() => document.documentElement.scrollWidth), t).toBeLessThanOrEqual(390);
      expect(await tel.p.locator('#s-body table').evaluateAll((ts) => ts.filter((x) => x.getBoundingClientRect().right > (x.closest('.sx-s, .sx-deux > div') as HTMLElement).getBoundingClientRect().right + 1).length), t).toBe(0);
    }
    await tel.p.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'statistiques-3-telephone.png') });
    expect(tel.erreurs).toEqual([]);
    await tel.cx.close();
  }, 180_000);

  it('une entreprise neuve : chaque onglet dit ce qui le remplira, aucune phrase rassurante sur un univers vide', async () => {
    const { jeton, ent } = await entreprise('Droguerie Neuve');
    const { cx, p, erreurs } = await ouvrir(jeton, ent);
    const an = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date()).slice(0, 4);
    expect(await chiffre(p, 's-c-marge')).toBe('Marge estimée i — aucune vente sur la période');
    expect(await chiffre(p, 's-c-ventes')).toBe(`Vendu HT i 0,000 DT rien à comparer en ${Number(an) - 1}`);
    expect(net(await p.locator('#s-items').innerText())).toContain('Aucune vente sur cette période');
    await onglet(p, 'devis');
    expect(net(await p.locator('#s-body').innerText())).toBe('Aucun devis émis sur cette période Le taux d\'acceptation se lit dès qu\'un devis envoyé a reçu sa réponse.');
    await onglet(p, 'clients');
    expect(net(await p.locator('#s-dus').innerText())).toContain('Aucune facture émise pour l\'instant');
    expect(net(await p.locator('#s-dus').innerText())).not.toContain('Tout est encaissé');
    await onglet(p, 'achats');
    expect(net(await p.locator('#s-body').innerText())).toBe(`Aucun achat en ${an} La répartition se remplit dès la première facture d'achat ou dépense enregistrée.`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
