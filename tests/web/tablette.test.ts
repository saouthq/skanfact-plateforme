// La tablette debout (1.87.16 ; recette du 21/10/2026). À 768 px (820 jusqu'à la 1.154.0 : la barre en rail de la
// 1.151.0 y laisse assez de place, le test ne voyait plus rien), le menu de gauche reste, et une liste plus large que
// la place restante faisait défiler toute la page de côté, titre et boutons compris ; la rangée d'export de la
// Comptabilité poussait « Envoyer au comptable… » hors de l'écran. Un seul client suffit : les colonnes de la liste
// des Clients dépassaient déjà.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la tablette debout', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tablette-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  // Ce que la zone centrale défile de côté (0 : rien), et le bord droit d'un élément par rapport au sien.
  const deCote = (p: Page) => p.evaluate(() => { const v = document.querySelector('#view') as HTMLElement; return v.scrollWidth - v.clientWidth; });

  it('à 768 px : ni la liste des Clients ni la Comptabilité ne font défiler la page de côté', async () => {
    const email = `nadia-tab-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Tablette de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Transports Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Société des Transports du Sahel', address: 'Route de Monastir, Sousse' } },
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 768, height: 1024 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, nadia);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.locator('#view table.list tbody tr', { hasText: 'Société des Transports du Sahel' }).count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    expect(await deCote(p)).toBe(0);
    // La liste, elle, défile dans son cadre : ses colonnes restent toutes lisibles.
    expect(await p.locator('#view #list-wrap').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tablette-1-clients.png') });

    await p.evaluate(() => { location.hash = '#/compta'; });
    await p.locator('#exp-comptable').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await deCote(p)).toBe(0);
    const bord = await p.evaluate(() => ({ bouton: (document.querySelector('#exp-comptable') as HTMLElement).getBoundingClientRect().right,
      vue: (document.querySelector('#view') as HTMLElement).getBoundingClientRect().right }));
    expect(bord.bouton).toBeLessThanOrEqual(bord.vue);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tablette-2-compta.png') });
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
