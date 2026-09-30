// Le prix par quantité, à la souris (brique 92 ; 14 § 3.2 ; web/v10/prix-quantite.txt) :
//   - les paliers se saisissent sur la fiche de l'article ; un palier illisible se refuse en disant lequel ;
//   - sur une facture, la ligne de l'article suit le palier que sa quantité atteint ;
//   - un prix tapé à la main est une décision : la quantité ne le change plus ; une ligne d'avant les paliers,
//     à un autre prix que le leur, non plus.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le prix par quantité, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-prix-quantite-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  it('Nadia donne au ciment des prix dégressifs, et la ligne de sa facture les suit, jusqu\'au prix qu\'elle tape', async () => {
    const email = `nadia-paliers-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, unitCost: { '~n': '17.25' }, vatRate: 19 } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        // Une seconde ligne du même article, d'avant les paliers, à un prix choisi (19,900) : elle ne bougera pas.
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 1, unit: 'sac', unitPrice: 21, vatRate: 19, itemId: 'ciment' },
          { label: 'Ciment gris 50 kg', description: '', qty: 1, unit: 'sac', unitPrice: { '~n': '19.9' }, vatRate: 19, itemId: 'ciment' }], discountRate: 0, withholdingRate: 0, payments: [] } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // 1. Sur la fiche du ciment : un palier illisible se refuse en disant lequel, puis « 10 : 20,500 ; 100 : 19 ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/catalogue`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^(Catalogue|Prestations)/);
    await plusTard(p);
    await p.locator('#view').getByText('Ciment gris 50 kg', { exact: true }).first().click();
    await p.locator('#cat-paliers').fill('10 : 20,500 ; 100 dix-neuf');
    await p.locator('#modal-root .btn-primary').last().click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('« 100 dix-neuf » ne se lit pas');
    await p.locator('#cat-paliers').fill('100 : 19 ; 10 : 20,500');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'prix-quantite-1-article.png') });
    await p.locator('#modal-root .btn-primary').last().click();
    await expect.poll(() => p.locator('#cat-paliers').count()).toBe(0);

    // 2. La facture : la quantité choisit le palier ; 150 sacs à 19, soit 2 850 HT.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Facture/);
    await plusTard(p);
    const qte = p.locator('#lines tr[data-i="0"] input[data-k=qty]');
    const prix = p.locator('#lines tr[data-i="0"] input[data-k=unitPrice]');
    await qte.fill('12');
    await expect.poll(() => prix.inputValue()).toMatch(/^20\.5(00)?$/);
    await qte.fill('150');
    await expect.poll(() => prix.inputValue()).toMatch(/^19(\.000)?$/);
    expect(net(await p.locator('#lines [data-total="0"]').innerText())).toBe('2 850,000');
    await qte.fill('5');
    await expect.poll(() => prix.inputValue()).toMatch(/^21(\.000)?$/);
    // 3. Nadia confirme le prix en le tapant, 21 (celui-là même que donne la règle) : c'est sa décision, la
    // quantité ne le change plus.
    await prix.fill('21');
    await qte.fill('150');
    await p.waitForTimeout(300);
    expect(await prix.inputValue()).toMatch(/^21(\.000)?$/);
    expect(net(await p.locator('#lines [data-total="0"]').innerText())).toBe('3 150,000');
    // 4. La ligne d'avant les paliers, à 19,900 : un prix choisi, que la quantité ne change pas non plus.
    await p.locator('#lines tr[data-i="1"] input[data-k=qty]').fill('120');
    await p.waitForTimeout(300);
    expect(await p.locator('#lines tr[data-i="1"] input[data-k=unitPrice]').inputValue()).toMatch(/^19\.9(00)?$/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'prix-quantite-2-facture.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
