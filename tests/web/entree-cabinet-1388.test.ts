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
describe('ENT2-1 (1.388.48) : passer de son entreprise à son cabinet, et retour', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-entree-cabinet-1388-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'entree-cabinet-1388.txt'), '');
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
  it('Mourad tient sa société et son cabinet : chaque menu propose l\'autre, et le lien l\'ouvre', async () => {
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    const cab = (await api('POST', '/cabinets', mourad, { nom: 'Cabinet Gharbi Conseil' })).corps;
    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // Côté entreprise : « Tes entreprises » nomme le cabinet, et le bouton ouvre SkanFact Cabinet.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#brand-btn').click();
    const menu = p.locator('#dos-menu');
    const versCab = menu.locator(`[data-cab-ouvrir="${String(cab.id)}"]`);
    await versCab.waitFor({ timeout: 10_000 });
    expect(net(await menu.innerText())).toContain('Ton cabinet');
    expect(net(await versCab.innerText())).toContain('Cabinet Gharbi Conseil');
    await versCab.click();
    await p.waitForURL((u) => u.pathname === '/v10/cabinet/' && u.searchParams.get('c') === String(cab.id), { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // Côté cabinet : le menu du cabinet nomme l'entreprise, et le bouton la rouvre.
    await p.locator('#brand-btn').click();
    const pop = p.locator('.sb-cabinet');
    const versEnt = pop.locator('[data-cab-aller]');
    await versEnt.first().waitFor({ timeout: 10_000 });
    expect(await versEnt.count()).toBe(1);
    expect(await versEnt.first().getAttribute('data-cab-aller')).toBe(`/v10/?e=${ent}`);
    expect(net(await pop.innerText())).toContain('Ton entreprise');
    await versEnt.first().click();
    await p.waitForURL((u) => u.pathname === '/v10/' && u.searchParams.get('e') === ent, { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 90_000);
});
