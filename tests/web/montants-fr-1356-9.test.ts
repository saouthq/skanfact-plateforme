// 1.356.9 : les cases de montant, de quantité, de taux et de pourcentage s'écrivent en français, quelle que soit la langue du
// navigateur. Une case numérique montrait la valeur à la façon du NAVIGATEUR : réglé en anglais, il écrivait « 2400.000 » pour
// le prix d'une ligne d'achat et « 1.000 » pour le timbre — qu'un lecteur tunisien lit deux mille quatre cents mille, et mille.
// Le test tourne donc sur un navigateur en ANGLAIS (en-US), là où le défaut se voyait.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('1.356.9 : les cases chiffrées s\'écrivent en français, même sur un navigateur en anglais', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-montants-fr-1356-9-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
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
    // Un navigateur réglé en anglais : c'est là qu'une case numérique écrivait « 2400.000 ».
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'en-US', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('l\'achat, le catalogue et les cases de la paie s\'écrivent et se relisent en français sur un navigateur en anglais', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const n = (x: string) => ({ '~n': x });
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'suppliers', cle: 's-peintre', rang: 0, revision: null, contenu: { id: 's-peintre', name: 'Peinture Ksibi', matricule: '0912345B/A/M/000', paymentTermsDays: 30 } },
      { collection: 'purchases', cle: 'a-1', rang: 0, revision: null, contenu: { id: 'a-1', kind: 'facture', number: 'PK-2611-07', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 1, withholdingRate: 0, createdAt: Date.now(), lines: [{ label: 'Peinture de la boutique', qty: 1, unitPrice: 2400, vatRate: 19, destination: 'charge' }] } },
      { collection: 'catalog', cle: 'c-croissant', rang: 0, revision: null, contenu: { id: 'c-croissant', label: 'Croissant', unitPrice: n('0.84'), vatRate: 19, unit: 'pièce' } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const surLeServeur = async (col: string, cle: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[]).find((o) => o.collection === col && o.cle === cle)?.contenu;

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    // Le navigateur est bien en anglais : c'est la condition du défaut (sans elle, le test mesurerait l'égalité de deux défauts).
    expect(await p.evaluate(() => navigator.language)).toBe('en-US');

    // 1. La facture d'achat : le prix d'une ligne, sa quantité et le timbre s'écrivent comme sur la pièce.
    // (1.357.0) Une pièce enregistrée s'ouvre en résumé : son formulaire est à « Modifier la pièce ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a-1/modifier`);
    const pu = p.locator('#b-lines input[data-k=unitPrice]').first(), qte = p.locator('#b-lines input[data-k=qty]').first();
    await pu.waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => pu.inputValue()).toBe('2 400,000');
    expect(await p.locator('input[name=fees]').inputValue()).toBe('1,000');
    expect(await pu.getAttribute('type')).toBe('text');
    // Taper comme un humain, touche par touche : « 2,5 » de quantité, et un prix écrit à l'anglaise (« 2400.5 ») qui s'écrit
    // en français en sortant de la case.
    await qte.click();
    await p.keyboard.type('2,5');
    await p.keyboard.press('Tab');
    await p.keyboard.type('2400.5');
    await p.keyboard.press('Tab');
    expect(await qte.inputValue()).toBe('2,5');
    expect(await pu.inputValue()).toBe('2 400,500');
    expect(net(await p.locator('#b-lines [data-total]').first().innerText())).toBe('6 001,250');
    // Des milliers groupés à la française (« 1.200,5 ») se lisent aussi.
    await pu.click();
    await p.keyboard.type('1.200,5');
    await p.keyboard.press('Tab');
    expect(await pu.inputValue()).toBe('1 200,500');
    expect(net(await p.locator('#b-lines [data-total]').first().innerText())).toBe('3 001,250');
    await p.keyboard.press('Control+s');
    await expect.poll(async () => JSON.stringify((await surLeServeur('purchases', 'a-1'))?.lines?.map((l: Obj) => [l.qty, l.unitPrice])), { timeout: 15_000 })
      .toBe(JSON.stringify([[n('2.5'), n('1200.5')]]));

    // 2. Le catalogue : le prix TTC tapé avec ses milliers (« 1 190 ») donne un hors taxes de 1 000,000 à 19 %.
    await p.evaluate(() => { location.hash = '#/catalogue'; });
    await p.locator('#view table.list tbody tr', { hasText: 'Croissant' }).first().click({ timeout: 20_000 });
    const ttc = p.locator('#cat-ttc');
    await ttc.waitFor({ timeout: 10_000 });
    expect(await p.locator('#kf input[name=unitPrice]').inputValue()).toBe('0,840');
    await ttc.click();
    await p.keyboard.press('Control+a');
    await p.keyboard.type('1 190');
    await p.keyboard.press('Tab');
    expect(await p.locator('#kf input[name=unitPrice]').inputValue()).toBe('1\u00a0000,000');
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => JSON.stringify((await surLeServeur('catalog', 'c-croissant'))?.unitPrice), { timeout: 15_000 }).toBe('1000');

    expect(erreurs).toEqual([]);
  }, 120_000);

  it('aucune case à virgule ne reste numérique dans les écrans de l\'entreprise et de la paie, hors la grille de la pièce', () => {
    // La grille des lignes d'une facture et d'un devis (`dessinerLignesCharte`) garde ses cases numériques : une vue en français
    // est posée par-dessus quand on n'y est pas (1.155.3). C'est la seule exception, nommée ici.
    const sources = ['modules/socle/ecrans/entreprise/app-1.js', 'modules/socle/ecrans/entreprise/app-2.js',
      'modules/personnel/ecrans/entreprise/paie.js', 'modules/personnel/ecrans/cabinet/paie.js'];
    const fautes: string[] = [];
    for (const f of sources) {
      const s = fs.readFileSync(path.join(RACINE, f), 'utf8');
      const debut = f.endsWith('app-1.js') ? s.indexOf('function dessinerLignesCharte()') : -1;
      const fin = debut >= 0 ? s.indexOf('\n    function ', debut + 10) : -1;
      for (const m of s.matchAll(/<input\b[^>]*type="number"[^>]*>/g)) {
        if (debut >= 0 && m.index > debut && m.index < fin) continue;
        const pas = (m[0].match(/\bstep="([^"]*)"/) || [])[1];
        // Un pas de 1 (ou de 5 minutes) est un nombre entier : un jour, une année, un numéro. Sans pas, le navigateur prend 1,
        // sauf quand le champ porte une virgule de lui-même (`step="any"`, un pas décimal).
        if (pas === undefined || /^\d+$/.test(pas)) continue;
        fautes.push(`${f} : ${m[0].slice(0, 120)}`);
      }
      // Les cases fabriquées par `field(…, 'number', …)` passent par la même règle dans `field()` lui-même.
    }
    expect(fautes).toEqual([]);
    const app = fs.readFileSync(path.join(RACINE, 'modules/socle/ecrans/entreprise/app-1.js'), 'utf8');
    const fld = app.slice(app.indexOf('  function field(label, name, value, type, extra) {'), app.indexOf('  function field(label, name, value, type, extra) {') + 2000);
    expect(fld).toMatch(/if \(type === 'number' && \/\\bstep="\(\?!1"\)/);
  });
});
