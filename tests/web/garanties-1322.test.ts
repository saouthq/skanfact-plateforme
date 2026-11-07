// Les garanties, 1.322.0, jouées par un installateur de climatisation (« Clim et Froid Jlassi », Walid) jusqu'au bilan de
// 2025 : deux climatiseurs garantis deux ans chez l'Hôtel Le Golfe et la Clinique Les Pins (le second remisé de 5 %), un
// onduleur garanti un an livré le 20 décembre (remise globale de 5 %), un vieux climatiseur dont la garantie a fini en
// novembre, un autre encore en stock. Walid envoie l'état de son parc au 31/12/2025 à sa comptable ; la Clinique rend son
// climatiseur, la carte le dit ; renvoyé, c'est l'état d'aujourd'hui. Inès, au Cabinet, lit les garanties en cours dans
// l'onglet Inventaire et passe 850,500 HT au 6815 et au 1512, au 31/12/2025, au brouillard.
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
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'garanties-1322.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les garanties 1.322.0 : le parc sous garantie part chez le comptable, qui le provisionne', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-garanties-1322-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'garanties-1322.txt'), '');
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);



  it('le parc sous garantie au 31/12 part chez la comptable, se renvoie quand un appareil est rendu, et se provisionne au Cabinet', async () => {
    const C = ecranDeLaPlateforme('core.js') as Obj;
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const walid = await personne('walid');
    const ent = String((await api('POST', `/entreprises-essai`, walid)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, walid, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, walid)).corps.objets as Obj[];
    await objets();
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Walid Jlassi', name: 'Clim et Froid Jlassi', city: 'Sousse', activity: 'services' };
    const ch = (collection: string, cle: string, rang: number, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: enc(contenu) });
    const clients = [{ id: 'c1', name: 'Hôtel Le Golfe' }, { id: 'c2', name: 'Clinique Les Pins' }];
    const catalogue = [
      { id: 'clim', label: 'Climatiseur 12 000 BTU', unit: 'pièce', unitPrice: 2450, vatRate: 19, tracked: true, serialized: true, warrantyMonths: 24 },
      { id: 'ond', label: 'Onduleur 3 kVA', unit: 'pièce', unitPrice: 1890.333, vatRate: 19, tracked: true, serialized: true, warrantyMonths: 12 },
    ];
    const facture = (id: string, date: string, clientId: string, itemId: string, unitPrice: number, extra: Obj = {}) => ({
      id, type: 'facture', number: '', status: 'brouillon', date, dueDate: date, clientId, currency: 'DT', exchangeRate: '', applyStamp: true, stampFee: 1, discountRate: 0, withholdingRate: 0,
      payments: [], notes: '', createdAt: Date.parse(date),
      lines: [{ label: catalogue.find((c) => c.id === itemId)?.label, itemId, qty: 1, unitPrice, vatRate: 19 }], ...extra });
    const factures = [
      facture('f1', '2024-03-15', 'c1', 'clim', 2450),
      facture('f2', '2025-06-10', 'c2', 'clim', 2380.5, { lines: [{ label: 'Climatiseur 12 000 BTU', itemId: 'clim', qty: 1, unitPrice: 2380.5, vatRate: 19, discount: 5 }] }),
      facture('f3', '2025-12-20', 'c1', 'ond', 1890.333, { discountRate: 5 }),
    ];
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, walid, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      ...clients.map((x, i) => ch('clients', x.id, i, x)),
      ...catalogue.map((x, i) => ch('catalog', x.id, i, x)),
      ...factures.map((x, i) => ch('documents', x.id, i, x)),
    ] });
    expect(ecrit.statut, JSON.stringify(ecrit.corps)).toBe(200);
    for (const [i, x] of factures.entries()) {
      const nap = C.computeTotals(x, societe).netToPay as number;
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, walid, { document: enc(x), client: enc(clients.find((y) => y.id === x.clientId)), revision: 1, rang: i,
        netAPayer: nap.toFixed(3) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    }
    // Les numéros de série : trois livrés avec leur facture, un vieux climatiseur de 2023 (garantie finie le 01/11/2025), un en stock.
    const serie = (id: string, itemId: string, serial: string, status: string, outDate: string, outDocId: string, clientId: string, warrantyMonths: number) =>
      ({ id, itemId, serial, status, inDate: '2023-01-10', inPurchaseId: '', outDate, outDocId, clientId, warrantyMonths, notes: '' });
    const series = [
      serie('s1', 'clim', 'CL-24-0091', 'vendu', '2024-03-15', 'f1', 'c1', 24),
      serie('s2', 'clim', 'CL-25-0412', 'vendu', '2025-06-10', 'f2', 'c2', 24),
      serie('s3', 'ond', 'ON-25-1107', 'vendu', '2025-12-20', 'f3', 'c1', 12),
      serie('s4', 'clim', 'CL-23-0017', 'vendu', '2023-11-02', '', 'c1', 24),
      serie('s5', 'clim', 'CL-25-0500', 'stock', '', '', '', 24),
    ];
    const s = await api('POST', `/entreprises/${ent}/dossier-v10`, walid, { changements: series.map((x, i) => ch('serials', x.id, i, x)) });
    expect(s.statut, JSON.stringify(s.corps)).toBe(200);

    const cx = await contexte(walid);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirGaranties = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/garanties`);
      await p.locator('#gar-wrap').waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#gc-carte').waitFor({ timeout: 15_000 });
    };
    const etatsEnvoyes = async () => (await objets()).filter((o) => o.collection === 'etatsGaranties').map((o) => o.contenu as Obj);
    const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Obj)['~n']) : Number(v));

    // A. Le 31 décembre passé est proposé : trois appareils garantis (le vieux climatiseur n'y est plus, celui en stock non plus).
    await ouvrirGaranties();
    expect(await p.locator('#gar-comptable input[name=garDate]').inputValue()).toBe('2025-12-31');
    expect(net(await p.locator('#gc-resume').innerText())).toBe('3 appareils sous garantie chez 2 clients, vendus 6 507,291 DT HT ; la plus longue garantie court jusqu\'au 09/06/2027. '
      + 'Vendus avec une garantie en 2025 : 2 appareils, 4 057,291 DT HT.');
    await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await p.screenshot({ path: path.join(PHOTOS, 'garanties-1322-a-carte.png'), fullPage: true });
    await p.locator('#gc-envoyer').click();
    await expect.poll(() => toast(p)).toContain('Le parc sous garantie au 31/12/2025 est chez ton comptable : 3 appareils, vendus 6 507,291 DT HT. Il juge s\'il faut une provision.');
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [e.date, nombre(e.nombre), nombre(e.ht), (e.articles as Obj[]).map((a) => [a.libelle, nombre(a.nombre), nombre(a.ht), a.fin])]))
      .toEqual([['2025-12-31', 3, 6507.291, [['Climatiseur 12 000 BTU', 2, 4711.475, '2027-06-09'], ['Onduleur 3 kVA', 1, 1795.816, '2026-12-19']]]]);
    // Ni client ni numéro de série ne partent.
    expect(JSON.stringify(await etatsEnvoyes())).not.toMatch(/Golfe|Clinique|CL-24|ON-25/);
    await expect.poll(async () => net(await p.locator('#gc-deja').innerText())).toMatch(/^✓ Envoyé le \d{2}\/\d{2}\/\d{4} : c'est l'état d'aujourd'hui\.$/);

    // B. La Clinique appelle : elle rend son climatiseur. Walid le trouve par la recherche et ouvre sa fiche.
    await p.locator('#g-q').fill('CL-25-0412');
    await p.locator('[data-ouvrir-ser="s2"]').click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('[name=status]').selectOption('retour');
    await f.locator('#ok').click();
    await f.waitFor({ state: 'detached' });
    await p.locator('#g-q').fill('');
    await expect.poll(async () => net(await p.locator('#gc-deja').innerText())).toContain('depuis, un appareil livré ou rendu, ou une garantie, l\'a changé. Renvoie-le');
    expect(net(await p.locator('#gc-resume').innerText())).toContain('2 appareils sous garantie chez 1 client, vendus 4 245,816 DT HT');
    expect(net(await p.locator('#gc-envoyer').innerText())).toBe('Renvoyer l\'état du 31/12/2025');
    await p.locator('#gc-envoyer').click();
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [e.date, nombre(e.nombre), nombre(e.ht)])).toEqual([['2025-12-31', 2, 4245.816]]);
    await expect.poll(async () => net(await p.locator('#gc-deja').innerText())).toContain('c\'est l\'état d\'aujourd\'hui');
    // Une autre date se choisit : au 31/03/2026, la garantie de l'hôtel a fini ; rien n'est encore envoyé pour ce jour-là.
    await p.locator('#gar-comptable .datefield input.d-txt').fill('31/03/2026');
    await p.locator('#gar-comptable .datefield input.d-txt').press('Tab');
    await expect.poll(async () => net(await p.locator('#gc-resume').innerText())).toContain('1 appareil sous garantie chez 1 client, vendus 1 795,816 DT HT');
    expect(await p.locator('#gc-deja').count()).toBe(0);
    expect(net(await p.locator('#gc-envoyer').innerText())).toBe('Envoyer l\'état du 31/03/2026');

    // Au téléphone, la page tient dans l'écran.
    const tel = await contexte(walid, 390, 844);
    await tel.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(`téléphone : ${e.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/garanties`);
    await t.locator('#gc-carte').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await t.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await t.screenshot({ path: path.join(PHOTOS, 'garanties-1322-b-telephone.png'), fullPage: true });
    await tel.close();

    // C. Au Cabinet, Inès lit les garanties en cours au 31/12/2025 et passe la provision qu'elle juge.
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/2025`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-garanties').waitFor({ timeout: 20_000 });
    expect(net(await c.locator('#iv-garanties p').first().innerText())).toMatch(/^2 appareils sous garantie au 31\/12\/2025, vendus 4 245,816 DT hors taxes · vendus avec une garantie dans l'année : 2 appareils, 4 057,291 DT HT · envoyé le \d{2}\/\d{2}\/\d{4}\.$/);
    expect((await c.locator('#iv-garanties-t tbody tr').allInnerTexts()).map(net)).toEqual([
      'Climatiseur 12 000 BTU 1 2 450,000 DT au plus tard le 14/03/2026', 'Onduleur 3 kVA 1 1 795,816 DT au plus tard le 19/12/2026']);
    await c.locator('#iv-gar-provision').click();
    const g = c.locator('#modal-root .modal').last();
    await g.locator('[name=montant]').waitFor({ timeout: 10_000 });
    // La case part vide : le montant, c'est la comptable qui le juge ; tant qu'il manque, le bouton est éteint et le dit.
    expect(await g.locator('[name=montant]').inputValue()).toBe('');
    expect(net(await g.locator('#pg-motif').innerText())).toBe('Le montant de la provision manque : écris ce que tu retiens.');
    expect(await g.locator('#ok').isDisabled()).toBe(true);
    await g.locator('[name=montant]').fill('5000');
    await expect.poll(async () => net(await g.locator('#pg-motif').innerText())).toBe('Une provision pour garanties ne dépasse pas ce que ces appareils ont été vendus hors taxes (4 245,816).');
    await g.locator('[name=montant]').fill('850,500');
    await expect.poll(async () => (await g.locator('#pg-lignes tbody tr').allInnerTexts()).map(net)).toEqual([
      '6815 Provision pour garanties au 31/12/2025 850,500 DT', '1512 Provision pour garanties au 31/12/2025 850,500 DT']);
    expect(await g.locator('#ok').isEnabled()).toBe(true);
    await c.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await c.screenshot({ path: path.join(PHOTOS, 'garanties-1322-c-provision.png'), fullPage: true });
    await g.locator('#ok').click();
    await expect.poll(() => toast(c)).toBe('Provision pour garanties passée au brouillard : 850,500 DT au 1512.');
    const ecrites = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, ines)).corps.ecritures as Obj[];
    expect(ecrites.filter((e) => e.piece === 'PROV-GAR-2025').map((e) => [e.date, e.journal, e.statut, e.lignes.map((l: Obj) => [l.compte, l.debit, l.credit])])).toEqual([
      ['2025-12-31', 'OD', 'brouillard', [['6815', '850.500', '0.000'], ['1512', '0.000', '850.500']]]]);
    await expect.poll(async () => net(await c.locator('#iv-gar-faite').innerText())).toBe('✓ Provision passée (PROV-GAR-2025) : la repasser compterait la charge deux fois.');
    expect(await c.locator('#iv-gar-provision').count()).toBe(0);
    await c.screenshot({ path: path.join(PHOTOS, 'garanties-1322-d-provisionnee.png'), fullPage: true });
    await cxC.close();
    await cx.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
