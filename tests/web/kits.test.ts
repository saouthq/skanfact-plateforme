// Les kits, à la souris (brique 96 ; 02 : « recettes et kits » ; web/v10/kits.txt) :
//   - la fiche d'un article compose un kit : ses composants suivis, et combien il en faut par kit ;
//   - un composant sans article se refuse ; la fiche dit ce que coûtent les composants et combien on peut en faire ;
//   - le catalogue dit combien de kits on peut faire ; vendre le kit sort ses composants du stock.

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

describe('les kits, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-kits-'));
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
  it('Nadia compose un pack chape, le vend, et ses composants sortent du stock', async () => {
    const email = `nadia-kits-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Ciment : 40 sacs à 17 ; sable : 7 m³ à 45 ; une facture de 4 packs en brouillon (la ligne porte le nom du pack).
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, vatRate: 19, tracked: true, initialQty: 40, initialCost: 17, initialDate: aujourdhui } },
      { collection: 'catalog', cle: 'sable', rang: 1, revision: null, contenu: { id: 'sable', label: 'Sable de rivière', unit: 'm³', unitPrice: 60, vatRate: 19, tracked: true, initialQty: 7, initialCost: 45, initialDate: aujourdhui } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        lines: [{ label: 'Pack chape 10 m²', description: '', qty: 4, unitPrice: 95, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, payments: [] } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const indice = async () => net(await p.locator('#kit-hint').innerText().catch(() => ''));
    const possibles = async () => net(await p.locator('#view tr', { hasText: 'Pack chape 10 m²' }).locator('[data-kit-possibles]').innerText().catch(() => ''));

    // 1. Le pack se compose sur sa fiche : 3 sacs de ciment et 0,5 m³ de sable.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/catalogue`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Catalogue|^Prestations|^Articles/);
    await plusTard(p);
    await p.locator('#new').click();
    await p.locator('#kf input[name=label]').fill('Pack chape 10 m²');
    await p.locator('#kf input[name=unitPrice]').fill('95');
    expect(await indice()).toBe('Un pack, un coffret, un lot : le vendre sortira ses composants du stock.');
    await p.locator('#kit-add').click();
    await p.locator('#kit-add').click();
    // Un composant sans article se refuse, en montrant la ligne.
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toBe('Choisis l\'article de chaque composant, ou retire sa ligne.');
    await p.locator('[data-kit="0"] [data-kit-art]').selectOption({ label: 'Ciment gris 50 kg' });
    await p.locator('[data-kit="0"] [data-kit-qte]').fill('3');
    await p.locator('[data-kit="0"] [data-kit-qte]').dispatchEvent('change');
    await p.locator('[data-kit="1"] [data-kit-art]').selectOption({ label: 'Sable de rivière' });
    await p.locator('[data-kit="1"] [data-kit-qte]').fill('0.5');
    await p.locator('[data-kit="1"] [data-kit-qte]').dispatchEvent('change');
    await expect.poll(indice).toBe('Les composants coûtent aujourd\'hui 73,500 DT ; il y a de quoi en faire 13.');
    // Le coût de revient du kit est celui de ses composants : la marge se lit tout de suite.
    expect(await p.locator('#kf input[name=unitCost]').inputValue()).toBe('73.5');
    expect(net(await p.locator('#marge-hint').innerText())).toBe('Marge : 21,500 DT par unité, soit 22,6 %');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'kits-1-fiche.png') });
    // Le même article deux fois se refuse ; un kit suivi lui-même en stock aussi.
    await p.locator('#kit-add').click();
    await p.locator('[data-kit="2"] [data-kit-art]').selectOption({ label: 'Ciment gris 50 kg' });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toBe('Un même article est deux fois dans le kit : mets toute sa quantité sur une seule ligne.');
    await p.locator('[data-kit="2"] [data-kit-rm]').click();
    await p.locator('#kf input[name=tracked]').check();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toBe('Un kit ne se suit pas en stock : ce sont ses composants qui sortent. Décoche « Suivi en stock », ou retire ses composants.');
    await p.locator('#kf input[name=tracked]').uncheck();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#kf').count()).toBe(0);
    // 40 sacs font 13 packs, 7 m³ en font 14 : le catalogue dit 13.
    await expect.poll(possibles, { timeout: 10_000 }).toBe('13 possibles');

    // 2. La facture de 4 packs s'émet : 12 sacs et 2 m³ sortent, le catalogue n'en permet plus que 9.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Facture/);
    await plusTard(p);
    await p.locator('#issue').click();
    await expect.poll(() => p.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await p.locator('#modal-root').innerText())).not.toContain('Stock insuffisant');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await p.evaluate(() => { location.hash = '#/article/ciment'; });
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toMatch(/EN STOCK 28 sacs/);
    expect(net(await p.locator('#view').innerText())).toMatch(/Vente kit « Pack chape 10 m² » FAC-\d{4}-001 [-−]12/);
    await p.evaluate(() => { location.hash = '#/catalogue'; });
    await expect.poll(possibles, { timeout: 10_000 }).toBe('9 possibles');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'kits-2-catalogue.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
