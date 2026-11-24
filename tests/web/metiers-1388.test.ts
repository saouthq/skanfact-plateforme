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
describe('MET1 (1.388.51) : l\'épicier, le boulanger et le menuisier retrouvent ce qu\'ils cherchent', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-metiers-1388-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'metiers-1388.txt'), '');
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
  it('Hichem retrouve ses quinze Karim, ses boissons par famille, son chantier par Ctrl K, et le statut du bon se dit bien', async () => {
    const hichem = await personne('hichem');
    const ent = String((await api('POST', '/entreprises-essai', hichem)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, hichem);
    const karims = ['Ben Ali', 'Trabelsi', 'Gharbi', 'Jebali', 'Mansour', 'Haddad', 'Ferchichi', 'Sassi'].map((n, i) => ({ collection: 'clients', cle: `k${i}`, rang: i, revision: null, contenu: { id: `k${i}`, name: `Karim ${n}` } }));
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hichem, { changements: [...karims,
      { collection: 'catalog', cle: 'eau', rang: 0, revision: null, contenu: { id: 'eau', label: 'Eau minérale 1,5 L', unit: 'u', unitPrice: 1, vatRate: 7, famille: 'Boissons' } },
      { collection: 'projects', cle: 'b12', rang: 0, revision: null, contenu: { id: 'b12', name: 'Chantier B12 Résidence du Lac', clientId: 'k0' } },
      { collection: 'documents', cle: 'bl1', rang: 0, revision: null, contenu: { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'brouillon', date: new Date().toISOString().slice(0, 10), clientId: 'k0', createdAt: 1,
        lines: [{ label: 'Eau minérale 1,5 L', description: '', qty: 6, unit: 'u', unitPrice: 1, vatRate: 7 }], discountRate: 0, withholdingRate: 0, payments: [] } },
    ] })).statut).toBe(200);
    const cx = await contexte(hichem);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // MET1-6 : six Karim montrés, et les deux autres comptés.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#ed-pq-q').waitFor({ timeout: 20_000 });
    await p.locator('#ed-pq-q').fill('Karim');
    await expect.poll(() => p.locator('#ed-pq-liste [data-cl]').count(), { timeout: 10_000 }).toBe(6);
    expect((await p.locator('#ed-pq-plus').innerText()).replace(/[\u00a0\u202f]/g, ' ')).toContain('2 autres clients « Karim » : tape la suite du nom');

    // MET1-9 : Ctrl K trouve le chantier.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.keyboard.press('Control+k');
    await p.locator('#pal-q').fill('Chantier B12');
    await expect.poll(async () => (await p.locator('#palette-root').innerText().catch(() => '')).includes('Chantier B12 Résidence du Lac'), { timeout: 10_000 }).toBe(true);
    await p.keyboard.press('Escape');

    // MET1-8 : la famille se cherche au Catalogue.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/catalogue`);
    const cherche = p.locator('#view input[placeholder^="Rechercher"]').first();
    await cherche.waitFor({ timeout: 20_000 });
    await cherche.fill('Boissons');
    await expect.poll(async () => (await p.locator('#view').innerText()).includes('Eau minérale 1,5 L'), { timeout: 10_000 }).toBe(true);

    // MET1-11 : « Statut du bon de livraison », jamais « de le ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/bl1`);
    await p.locator('[data-etq=statut]').first().click({ timeout: 20_000 });
    await expect.poll(async () => (await p.locator('.pop-t').first().innerText().catch(() => '')).replace(/[\u00a0\u202f]/g, ' '), { timeout: 10_000 }).toBe('Statut du bon de livraison');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
