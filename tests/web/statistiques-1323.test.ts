// 1.323.0 — Les Statistiques jusqu'au comptable, jouées par la Boulangerie El Amen (Monastir) : Amel livre l'hôtel et le
// restaurant, vend au comptoir, revend son vieux four depuis sa fiche et achète un four neuf. « Vendu HT » est le chiffre
// d'affaires que le Cabinet lit dans les livres (les comptes 70) ; la revente est dite à part, sa TVA reste collectée ; le four
// neuf est un achat, mais au bilan. Le comptable, dans le dossier, lit le même chiffre.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('les statistiques 1.323.0 : le chiffre d\'affaires de la boulangerie, le même chez le comptable', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-stats-1323-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'statistiques-1323.txt'), '');
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  it('la boulangerie revend son vieux four : « Vendu HT » est le chiffre d\'affaires du comptable, la revente est dite à part', async () => {
    const hichem = await personne('hichem');
    const cab = await api('POST', '/cabinets', hichem, { nom: 'Cabinet Monastir Conseil' });
    const cabinet = String(cab.corps.id);
    const amel = await personne('amel');
    const ent = String((await api('POST', '/entreprises-essai', amel)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, amel, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, hichem)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, amel)).corps.objets as Obj[];
    // Tout se passe aujourd'hui : l'exercice joué est l'année en cours, quel que soit le jour où le test tourne.
    const auj = jourDe(0);
    const an = auj.slice(0, 4);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Amel Gharbi', name: 'Boulangerie El Amen', city: 'Monastir' };
    const o = (collection: string, cle: string, rang: number | null, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: enc({ id: cle, ...contenu }) });
    const la = (label: string, qty: number, prix: number, vatRate: number, destination: string) => ({ label, description: '', qty, unit: 'u', unitPrice: prix, vatRate, destination });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, amel, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      o('accounts', 'k-caisse', 0, { name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 50, openingDate: `${an}-01-01`, isDefault: false, statementBalance: '', notes: '' }),
      o('accounts', 'k-stb', 1, { name: 'STB', kind: 'banque', bank: 'STB', rib: '', opening: 0, openingDate: `${an}-01-01`, isDefault: true, statementBalance: '', notes: '' }),
      o('clients', 'dunes', 0, { name: 'Hôtel Les Dunes', matricule: '1287654T/A/M/000', city: 'Monastir' }),
      o('clients', 'marina', 1, { name: 'Restaurant La Marina', matricule: '1376543M/A/M/000', city: 'Monastir' }),
      o('clients', 'jaziri', 2, { name: 'Boulangerie Jaziri', matricule: '1465432B/A/M/000', city: 'Ksar Hellal' }),
      o('suppliers', 'equip', 0, { name: 'Équipements Boulangers du Centre', matricule: '1554321E/A/M/000', city: 'Sousse' }),
      o('suppliers', 'moulins', 1, { name: 'Grands Moulins du Sahel', matricule: '1643210G/A/M/000', city: 'Sousse' }),
      // Le vieux four, acheté en 2016, revendu aujourd'hui à la boulangerie voisine : sa sortie est notée, sa facture reste à faire.
      o('assets', 'four1', 0, { label: 'Four à sole 6 bouches', category: 'outillage', amount: 42000, date: '2016-06-01', years: 10, residual: 0, disposal: { date: auj, amount: 9450.5, reason: 'Revendu à la boulangerie Jaziri' } }),
      o('purchases', 'pa1', 0, { kind: 'facture', number: 'EBC-77', date: auj, dueDate: auj, supplierId: 'equip', category: 'Matériel', currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, attachments: [], payments: [],
        lines: [la('Four rotatif neuf', 1, 38500.75, 19, 'immobilisation'), la('Installation du four', 1, 650.4, 19, 'charge')] }),
      o('purchases', 'pa2', 1, { kind: 'facture', number: 'GMS-412', date: auj, dueDate: auj, supplierId: 'moulins', category: 'Farine', currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, attachments: [], payments: [],
        lines: [la('Farine T55 (sac de 50 kg)', 30, 46.375, 7, 'charge')] }),
    ] })).statut).toBe(200);

    // Les ventes du métier, émises par le serveur : l'hôtel (un avoir de 40 croissants rendus), le restaurant (une remise de
    // 3 %), un ticket au comptoir.
    const co = { ...C.DEFAULT_COMPANY, currency: 'DT' };
    const lv = (label: string, qty: number, unitPrice: number, vatRate = 7) => ({ label, description: '', qty, unit: 'u', unitPrice, vatRate });
    const base = { discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, regimeTva: 'reel' };
    const noms: Record<string, string> = { dunes: 'Hôtel Les Dunes', marina: 'Restaurant La Marina' };
    let rang = 10;
    const emettre = async (id: string, type: string, clientId: string, lines: Obj[], extra: Obj = {}) => {
      const doc = { id, type, number: '', date: auj, dueDate: auj, clientId, subject: 'Livraison', status: 'brouillon', lines, ...base, createdAt: Date.now(), ...extra };
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, amel, { changements: [o('documents', id, rang, doc)] })).statut).toBe(200);
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/${type === 'avoir' ? 'emettre-avoir' : 'emettre'}`, amel, { document: enc(doc), client: { id: clientId, name: noms[clientId] }, revision: 1, rang: rang++, netAPayer: C.computeTotals(doc, co).netToPay.toFixed(3) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    };
    await emettre('f1', 'facture', 'dunes', [lv('Pain de campagne', 420, 0.875), lv('Croissant', 600, 0.655)]);
    await emettre('a1', 'avoir', 'dunes', [lv('Croissant', 40, 0.655)], { creditOf: 'f1', creditReason: '40 croissants rendus' });
    await emettre('f2', 'facture', 'marina', [lv('Gâteau d\'anniversaire', 3, 48.333, 19)], { discountRate: 3 });
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, amel, { fond: '50' })).statut).toBe(200);
    const ticket: Obj = { id: 'tk1', type: 'facture', ticket: true, number: '', date: auj, clientId: '', lines: [lv('Baguette', 40, 0.19), lv('Millefeuille', 12, 1.875)], ...base, status: 'envoyée', caisse: { mode: 'especes', recu: null, rendu: null } };
    ticket.payments = [{ id: 'pk1', date: auj, amount: Number(C.computeTotals(ticket, co).netToPay.toFixed(3)), method: 'especes', accountId: 'k-caisse', reference: '', note: '' }];
    const tk = await api('POST', `/entreprises/${ent}/dossier-v10/ticket`, amel, { document: enc(ticket), rang: rang++, netAPayer: C.computeTotals(ticket, co).netToPay.toFixed(3) });
    expect(tk.statut, JSON.stringify(tk.corps)).toBe(200);

    const sansVisite = () => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); };
    const cx = await contexte(amel);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const calme = (x: Page) => x.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const photo = async (x: Page, nom: string) => { await calme(x); await x.screenshot({ path: path.join(PHOTOS, `statistiques-1323-${nom}.png`), fullPage: true }); };

    // A. La facture de la revente naît de la fiche du four, comme Amel la ferait : « Facturer la cession », la boulangerie
    // Jaziri, émise.
    await aller('#/immo/four1');
    await p.locator('#im-facturer').click();
    await p.getByRole('button', { name: 'Garder le brouillon' }).waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#ed-pq-q').fill('Jaziri');
    await p.locator('#ed-pq-liste [role=option][data-cl]').filter({ hasText: 'Boulangerie Jaziri' }).first().click();
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^FAC-\d{4}-\d{3}$/);
    const facture = (await p.locator('#view h1').first().innerText()).trim();

    // B. Les Statistiques de l'année : 760,500 − 26,200 + 140,649 de factures, 30,100 au comptoir ; la revente, 9 450,500 HT,
    // n'y est pas, la carte le dit. La TVA collectée la garde (80,231 des ventes et 1 795,595 du four).
    await aller('#/stats', '#s-resume .mg-chiffre');
    const chiffre = async (id: string) => net(await p.locator(`#${id}`).innerText());
    await expect.poll(() => chiffre('s-c-ventes'), { timeout: 15_000 }).toBe(`Vendu HT i 905,049 DT rien à comparer en ${Number(an) - 1} hors revente d'un bien : 9 450,500 DT`);
    expect(await chiffre('s-c-marge')).toMatch(/^Marge estimée i 905,049 DT ≈ 100 % de ce qui est vendu/);
    expect(await chiffre('s-c-achats')).toBe(`Acheté HT i 40 542,400 DT rien à comparer en ${Number(an) - 1}`);
    const lignes = (sel: string) => p.locator(`${sel} tbody tr`).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')]
      .filter((td) => getComputedStyle(td).display !== 'none').map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 3)));
    expect(await lignes('#s-canaux')).toEqual([['Factures', '2et 1 avoir', '874,949'], ['Tickets de caisse', '1', '30,100']]);
    expect(net(await p.locator('#s-canaux tfoot').innerText())).toContain('905,049');
    expect(net(await p.locator('#s-tva').innerText())).toBe('TVA collectée sur la période : 1 875,826 DT, à reverser, avoirs déduits, dont 1 795,595 DT sur la revente d\'un bien. i');
    expect(net(await p.locator('#s-cession').innerText())).toBe(`Cette revente n'est pas une vente de ton métier : Four à sole 6 bouches (${facture}), 9 450,500 DT HT. Ton comptable la passe à part, aux produits des cessions (775) : elle n'est dans aucun chiffre de cette page, sauf la TVA collectée. i`);
    // Le voisin qui rachète le four n'est pas le meilleur client ; le four n'est pas « ce qui se vend le mieux ».
    expect(await p.locator('#s-clients .rank .name').allInnerTexts()).toEqual(['Hôtel Les Dunes', 'Restaurant La Marina', 'Vente au comptoir']);
    expect(await p.locator('#s-items .rank .name').allInnerTexts()).toEqual(['Pain de campagne', 'Croissant', 'Gâteau d\'anniversaire', 'Millefeuille', 'Baguette']);
    expect(net(await p.locator('#s-clients').innerText())).toContain('Hôtel Les Dunes pèse 81 % du chiffre d\'affaires.');
    await photo(p, 'a-ventes');

    // C. Les achats : le four neuf en est, mais il est au bilan chez le comptable ; la page le dit à côté.
    await p.locator('#s-tabs [data-tab="achats"]').click();
    await expect.poll(async () => net(await p.locator('#s-immo').innerText().catch(() => ''))).toBe(`Dont 38 500,750 DT de matériel gardé dans l'entreprise : ton comptable le met au bilan et le déduit un peu chaque année (l'amortissement), ce n'est pas une charge de ${an}. Voir les immobilisations`);
    await photo(p, 'b-achats');

    // D. L'export dit ce que la page dit.
    const [fichier] = await Promise.all([p.waitForEvent('download'), p.locator('#s-export').click()]);
    const csv = net(fs.readFileSync(await fichier.path(), 'utf8'));
    for (const attendu of ['Chiffre d\'affaires HT;905,049 DT', 'TVA collectée;1 875,826 DT', 'Dont TVA sur la revente d\'un bien;1 795,595 DT',
      `Revente d'un bien (hors chiffre d'affaires, 775);Four à sole 6 bouches;9 450,500 DT HT (${facture})`, 'Achats;Dont matériel immobilisé (au bilan);38 500,750 DT']) expect(csv).toContain(attendu);

    // E. Le bien s'ouvre depuis la phrase : sa fiche dit ce que la revente a laissé.
    await p.locator('#s-tabs [data-tab="ventes"]').click();
    await p.locator('#s-cession a[href="#/immo/four1"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/immo/four1');
    expect(erreurs).toEqual([]);

    // F. Au téléphone, la carte qui dit « hors revente » tient dans l'écran.
    const tel = await contexte(amel, 390, 844);
    await tel.addInitScript(sansVisite);
    const pt = await tel.newPage();
    await pt.goto(`${serveur.adresse}/v10/?e=${ent}#/stats`);
    await pt.locator('#s-c-hors').waitFor({ timeout: 20_000 });
    await plusTard(pt);
    expect(await pt.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await photo(pt, 'c-telephone');
    await tel.close();

    // G. Le pont : le comptable lit, dans les livres du dossier, le même chiffre d'affaires que la carte « Vendu HT ».
    const cxC = await contexte(hichem);
    const c = await cxC.newPage();
    const ce: string[] = [];
    c.on('pageerror', (e) => ce.push(e.message));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/paquets`);
    const paquets = c.locator('section[data-onglet="paquets"]');
    await expect.poll(async () => net(await paquets.locator('tbody tr').first().innerText().catch(() => '')), { timeout: 30_000 }).toMatch(/ provisoire 905,049 DT /);
    expect(net(await paquets.locator('tfoot').innerText())).toBe('1 mois 905,049 DT');
    // Le mois vient des livres du client : il s'ouvre sur ses écritures (il se disait « exemple »). La revente y est au 775.
    expect(net(await paquets.locator('tbody tr .row-actions').first().innerText())).toBe('Voir les écritures');
    await photo(c, 'd-cabinet');
    await paquets.locator('tbody tr .row-actions a').first().click();
    await expect.poll(() => c.evaluate(() => location.hash)).toBe(`#/dossier/${ent}/comptabilite/journal/${an}`);
    // Les écritures nées des pièces du client attendent au brouillard : le comptable les montre.
    await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
    await c.locator('#lv-brouillard').check();
    await expect.poll(async () => net(await c.locator('#c-livres').innerText().catch(() => '')), { timeout: 30_000 }).toContain(`775 Boulangerie Jaziri Facture ${facture} — Boulangerie Jaziri (HT 19 %) 9 450,500 DT`);
    expect(net(await c.locator('#c-livres').innerText())).toContain('706 Hôtel Les Dunes Facture FAC-');
    await photo(c, 'e-journal');
    expect(ce).toEqual([]);
    await cxC.close();
    await cx.close();
  }, 240_000);
});
