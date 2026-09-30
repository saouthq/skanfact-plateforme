// Les lots, à la souris (brique 97 ; 02 : Stock, « lots » ; web/v10/lots.txt) :
//   - la ligne d'achat d'un article suivi par lot dit son numéro de lot et sa péremption ;
//   - la page de l'article dit son stock lot par lot ; « À faire » dit les lots qui périment dans les 30 jours ;
//   - la facture avertit d'une ligne sans lot en conseillant le plus ancien, puis sort du lot choisi.

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

describe('les lots, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lots-'));
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
  const jourPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const fr = (iso: string) => iso.split('-').reverse().join('/');
  it('Samia saisit ses yaourts par lot, voit ceux qui périment, et vend le plus ancien', async () => {
    const email = `samia-lots-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Samia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Salah' })).corps.id);
    const aujourdhui = jourPlus(0), dans5 = jourPlus(5), dans20 = jourPlus(20);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // 20 pots du lot L-0901 (périme dans 5 jours) ; un achat de 50 pots pas encore numéroté ; une facture de 12 pots.
    const ligne = { label: 'Yaourt nature 125 g', description: '', unit: 'pot', vatRate: 7, itemId: 'yaourt' };
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Laiterie du Cap Bon' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima', address: 'Rue de Marseille, Tunis' } },
      { collection: 'catalog', cle: 'yaourt', rang: 0, revision: null, contenu: { id: 'yaourt', label: 'Yaourt nature 125 g', unit: 'pot', unitPrice: { '~n': '0.6' }, vatRate: 7, tracked: true, parLot: true,
        initialQty: 20, initialCost: { '~n': '0.4' }, initialDate: aujourdhui, initialLot: 'L-0901', initialPeremption: dans5 } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'F-77', date: aujourdhui, supplierId: 's1', currency: 'DT', category: 'Achats de marchandises', fees: 0, withholdingRate: 0, createdAt: Date.now(),
        lines: [{ ...ligne, qty: 50, unitPrice: { '~n': '0.42' }, destination: 'stock' }] } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        lines: [{ ...ligne, qty: 12, unitPrice: { '~n': '0.6' } }], discountRate: 0, withholdingRate: 0, applyStamp: false, payments: [] } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const parLot = async () => net(await p.locator('#art-lots').innerText().catch(() => ''));
    const avertissement = async () => net(await p.locator('#modal-root .warn-box').innerText().catch(() => ''));

    // 1. L'achat : le lot et sa péremption se saisissent sous la désignation.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/p1`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/F-77/);
    await plusTard(p);
    await p.locator('#b-lines input[data-k=lot]').fill('L-0910');
    await p.locator('#b-lines input[data-k=peremption]').fill(dans20);
    await p.locator('#save').click();
    await p.evaluate(() => { location.hash = '#/article/yaourt'; });
    await expect.poll(parLot, { timeout: 10_000 }).toBe(`Par lot i : L-0901 20 pots (périme le ${fr(dans5)}) · L-0910 50 pots (périme le ${fr(dans20)})`);

    // 2. « À faire » : les deux lots périment dans les 30 jours.
    await p.evaluate(() => { location.hash = '#/'; });
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toContain('2 lots périment dans les 30 jours');

    // 3. La facture : sans lot, l'émission le dit et conseille le plus ancien ; le lot choisi, elle sort de lui.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Facture/);
    await plusTard(p);
    await p.locator('#issue').click();
    await expect.poll(avertissement, { timeout: 10_000 }).toContain(`La ligne « Yaourt nature 125 g » ne dit pas de quel lot elle sort : le plus ancien est le lot L-0901, qui périme le ${fr(dans5)}. Choisis-le sous la ligne, sinon elle sortira « sans lot ».`);
    await p.locator('#modal-root [data-close]').first().click();
    await p.locator('#lines select[data-k=lot], [data-k=lot]').first().selectOption('L-0901');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'lots-1-facture.png') });
    await p.locator('#issue').click();
    await expect.poll(() => p.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    expect(await avertissement()).not.toMatch(/lot/);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await p.evaluate(() => { location.hash = '#/article/yaourt'; });
    await expect.poll(parLot, { timeout: 10_000 }).toBe(`Par lot i : L-0901 8 pots (périme le ${fr(dans5)}) · L-0910 50 pots (périme le ${fr(dans20)})`);
    const historique = net(await p.locator('#view').innerText());
    expect(historique).toMatch(/Vente lot L-0901 FAC-\d{4}-001 [-−]12/);
    expect(historique).toMatch(/Achat lot L-0910 F-77 \+50/);
    await plusTard(p);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'lots-2-article.png') });

    // 4. Un nouvel article « suivi par lot » : la case coche « suivi en stock », le départ dit son lot.
    await p.evaluate(() => { location.hash = '#/catalogue'; });
    await expect.poll(() => p.locator('#new').count(), { timeout: 10_000 }).toBe(1);
    await p.locator('#new').click();
    await p.locator('#kf input[name=label]').fill('Lait demi-écrémé 1 L');
    await p.locator('#kf input[name=parLot]').check();
    expect(await p.locator('#kf input[name=tracked]').isChecked()).toBe(true);
    await p.locator('#kf input[name=initialQty]').fill('12');
    await p.locator('#kf input[name=initialLot]').fill('L-0920');
    await p.locator('#kf input[name=initialPeremption]').fill(dans20);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#kf').count()).toBe(0);
    // La fiche rouverte garde le suivi par lot et le lot du départ.
    await p.locator('#view tr', { hasText: 'Lait demi-écrémé 1 L' }).locator('td').first().click();
    await expect.poll(() => p.locator('#kf input[name=parLot]').isChecked(), { timeout: 10_000 }).toBe(true);
    expect(await p.locator('#kf input[name=initialLot]').inputValue()).toBe('L-0920');
    await p.locator('#modal-root [data-close]').first().click();
    await p.evaluate(() => { location.hash = '#/stock'; });
    await p.locator('#view tr', { hasText: 'Lait demi-écrémé 1 L' }).first().click();
    await expect.poll(parLot, { timeout: 10_000 }).toBe(`Par lot i : L-0920 12 (périme le ${fr(dans20)})`);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
