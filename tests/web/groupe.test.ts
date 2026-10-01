// Le tableau de bord du groupe, à la souris (brique 113 ; web/v10/groupe.txt ; serveur/groupe.ts). Nadia tient deux
// sociétés : depuis le menu des entreprises, « Le groupe » les montre côte à côte, avec leurs chiffres et leur total ;
// le nom d'une société l'ouvre. Au téléphone, la page se lit sans déborder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { problemes } from '../instrument-rendu.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le tableau de bord du groupe, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-groupe-'));
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
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('« Le groupe » montre les sociétés côte à côte, leur total, et ouvre une société d\'un clic ; au téléphone aussi', async () => {
    const email = `nadia-groupe-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const a = String((await api('POST', '/entreprises', premier, { raisonSociale: 'Atelier Nadia' })).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const defi = (await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi;
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const b = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Bois du Sahel' })).corps.id);
    const vendre = async (ent: string, id: string, qte: number, pu: string, netAPayer: string) => {
      await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
      const client = { id: `c-${id}`, name: 'Menuiserie El Amel', address: 'Route de Gabès, Sfax', matricule: '1234567A/A/M/000' };
      const r = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client.id, createdAt: 1,
        lines: [{ label: 'Table en chêne', qty: qte, unit: 'u', unitPrice: { '~n': pu }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client, revision: null, rang: 0, netAPayer });
      expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    };
    await vendre(a, 'fa1', 12, '25.125', '358.785');
    await vendre(b, 'fb1', 3, '33.333', '118.999');

    const erreurs: string[] = [];
    const ouvrir = async (largeur: number): Promise<Page> => {
      const doigt = largeur < 760;
      const cx = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, locale: 'fr-FR', isMobile: doigt, hasTouch: doigt });
      await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
      const p = await cx.newPage();
      p.on('pageerror', (e) => erreurs.push(e.message));
      await p.goto(`${serveur.adresse}/v10/?e=${a}#/dashboard`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
      return p;
    };

    // Le menu des entreprises : « Le groupe ».
    const p = await ouvrir(1440);
    await p.locator('#brand-btn').click();
    await p.locator('#dm-groupe').click();
    const tableau = p.locator('#groupe-tableau');
    await expect.poll(async () => net(await tableau.innerText().catch(() => '')), { timeout: 15_000 }).toContain('Bois du Sahel');
    const lignes = await tableau.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/[\s\u202f]+/g, ' ').trim())));
    expect(lignes).toEqual([
      ['Atelier Nadia', '301,500 DT', '301,500 DT', '358,785 DT', '0,000 DT', '0,000 DT'],
      ['Bois du Sahel', '99,999 DT', '99,999 DT', '118,999 DT', '0,000 DT', '0,000 DT'],
    ]);
    expect(net(await tableau.locator('tfoot').innerText())).toBe('Total du groupe 401,499 DT 401,499 DT 477,784 DT 0,000 DT 0,000 DT');
    await p.mouse.move(800, 600); await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'groupe-1-ordinateur.png') });
    // Un nom ouvre sa société.
    await tableau.getByRole('button', { name: 'Bois du Sahel', exact: true }).click();
    await expect.poll(() => p.url(), { timeout: 15_000 }).toContain(`e=${b}`);
    await expect.poll(async () => net(await p.locator('.sidebar').innerText().catch(() => '')), { timeout: 15_000 }).toContain('Bois du Sahel');
    await p.context().close();

    // Au téléphone : la page se lit, rien ne déborde.
    const t = await ouvrir(390);
    await t.evaluate(() => { location.hash = '#/groupe'; });
    await expect.poll(async () => net(await t.locator('#groupe-tableau').innerText().catch(() => '')), { timeout: 15_000 }).toContain('Total du groupe');
    expect(await t.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'groupe-2-telephone.png'), fullPage: true });
    await t.context().close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
