// (1.357.9, L11 ; docs/leger.md) La feuille de la caisse tactile (`plateforme/caisse.css`, toute sous `body.mode-caisse`)
// ne part plus avec la première ouverture : ce que la 1.357.9 ajoute faisait passer S1 à 1 301 Ko pour un seuil de 1 300.
// La Caisse l'attend (« Un instant… », puis la page) ; sans réseau et jamais chargée, elle le dit en gardant ses barres
// (le mode caisse, qui les efface, attend la feuille : sans elle, la page d'attente n'aurait pas de sortie) et s'ouvre
// seule au retour du réseau ; posée, la feuille reprend sa place dans la cascade (juste après telephone.css).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { poserMouchard, retirerMouchard } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la feuille de la caisse à la demande (1.357.9, L11)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-caisse-1359-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await retirerMouchard(admin).catch(() => undefined); await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('la première ouverture n\'emporte pas la feuille de la caisse ; la Caisse l\'attend, le dit sans réseau en gardant ses barres, et s\'ouvre au retour', async () => {
    const email = `nadia-caisse-1359-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 100, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'huile', rang: 1, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const demandes: string[] = [];
    p.on('request', (r) => demandes.push(new URL(r.url()).pathname));
    const caisseLiee = () => p.locator('link[href*="plateforme/caisse.css"]').count();
    const modeCaisse = () => p.evaluate(() => document.body.classList.contains('mode-caisse'));
    // 1. La première ouverture : pas un octet de la feuille de la caisse, et pas de lien vers elle dans la page.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(demandes.filter((d) => d.endsWith('/caisse.css'))).toEqual([]);
    expect(await caisseLiee()).toBe(0);
    // 2. La Caisse, sans réseau pour sa feuille : elle le dit sous son titre, sans dessiner une caisse sans style, et
    // garde la barre de gauche (le mode caisse attend la feuille) : on peut en sortir.
    await p.route('**/plateforme/caisse.css*', (r) => r.abort());
    await p.evaluate(() => { location.hash = '#/caisse'; });
    await expect.poll(() => p.locator('[data-attente-page]').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('La caisse n\'est pas encore sur ce poste, et le réseau manque : elle s\'ouvre dès qu\'il revient.');
    expect(net(await p.locator('#view h1').first().innerText())).toBe('Caisse');
    expect(await p.locator('#cs-fermee').count()).toBe(0);
    expect(await caisseLiee()).toBe(0);
    expect(await modeCaisse()).toBe(false);
    expect(await p.locator('#barre').isVisible()).toBe(true);
    // 3. Le réseau revient : la caisse s'ouvre seule (fermée, elle le dit en grand), la feuille posée juste après
    // telephone.css (sa place dans la cascade), le mode caisse posé : la barre de gauche s'efface, la caisse a sa sortie.
    await p.unroute('**/plateforme/caisse.css*');
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(/^La caisse est fermée\./);
    expect(await p.evaluate(() => { const l = document.querySelector('link[href*="plateforme/caisse.css"]')?.previousElementSibling; return l instanceof HTMLLinkElement ? new URL(l.href).pathname : null; })).toBe('/plateforme/telephone.css');
    expect(await caisseLiee()).toBe(1);
    expect(await modeCaisse()).toBe(true);
    expect(await p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--ct-encre').trim())).toBe('#0e1726');
    expect(await p.locator('#barre').isVisible()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'caisse-feuille-1359.png') });
    // 4. Quitter la Caisse rend la barre ; y revenir ne recharge pas la feuille : un seul lien, la caisse tout de suite.
    await p.evaluate(() => { location.hash = '#/clients'; });
    await expect.poll(modeCaisse, { timeout: 10_000 }).toBe(false);
    expect(await p.locator('#barre').isVisible()).toBe(true);
    await p.evaluate(() => { location.hash = '#/caisse'; });
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(/^La caisse est fermée\./);
    expect(await caisseLiee()).toBe(1);
    expect(await p.locator('[data-attente-page]').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
