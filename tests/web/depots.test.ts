// Le stock par dépôt et les transferts, à la souris (brique 94 ; 14 § 3.2 ; web/v10/depots.txt) :
//   - les dépôts se nomment depuis la page Stock (le principal se renomme, un second s'ajoute) ;
//   - une réception entre dans le dépôt choisi ; la page de l'article dit son stock dépôt par dépôt ;
//   - « Transférer… » refuse ce que le dépôt n'a pas, puis fait passer la marchandise sans changer le total ;
//   - l'historique dit le dépôt de chaque mouvement, et la ligne d'une réception mène à la réception.

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

describe('le stock par dépôt et les transferts, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-depots-'));
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
  it('Nadia ouvre un second magasin, y reçoit du ciment, puis en transfère une partie', async () => {
    const email = `nadia-depots-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // 100 sacs au départ ; une commande de 60 sacs, et sa réception en préparation.
    const ligne = { label: 'Ciment gris 50 kg', qty: 60, unit: 'sac', unitPrice: { '~n': '17.25' }, vatRate: 19, itemId: 'ciment' };
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, tracked: true, initialQty: 100, initialCost: 17, initialDate: aujourdhui } },
      { collection: 'supplierOrders', cle: 'o1', rang: 0, revision: null, contenu: { id: 'o1', type: 'commandeFournisseur', number: 'BCF-2026-001', status: 'envoyée', date: aujourdhui, supplierId: 's1', currency: 'DT', lines: [ligne] } },
      { collection: 'receptions', cle: 'r1', rang: 0, revision: null, contenu: { id: 'r1', number: '', status: 'brouillon', date: aujourdhui, supplierId: 's1', orderId: 'o1', orderNumber: 'BCF-2026-001', currency: 'DT', lines: [{ ...ligne, ligneCommande: 0 }], createdAt: Date.now() } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const parDepot = async () => net(await p.locator('#art-depots').innerText().catch(() => ''));

    // 1. Les dépôts : le principal devient « Magasin de Tunis », « Magasin de Sfax » s'ajoute.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Stock/);
    await plusTard(p);
    await p.locator('#st-depots').click();
    await p.locator('[data-dep="0"]').fill('Magasin de Tunis');
    await p.locator('#dep-add').click();
    await p.locator('[data-dep="1"]').fill('Magasin de Sfax');
    await p.locator('#dep-ok').click();
    await expect.poll(() => p.locator('#dep-ok').count()).toBe(0);

    // 2. La réception entre à Sfax.
    await p.evaluate(() => { location.hash = '#/reception/r1'; });
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    await p.locator('#rec-head select[name=depotId]').selectOption({ label: 'Magasin de Sfax' });
    await p.locator('#rec-valider').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception BR-/);

    // 3. L'article, dépôt par dépôt ; un transfert trop grand se refuse, puis 25 sacs passent de Sfax à Tunis.
    await p.evaluate(() => { location.hash = '#/article/ciment'; });
    await expect.poll(parDepot, { timeout: 10_000 }).toBe('Par dépôt i : Magasin de Tunis 100 sacs · Magasin de Sfax 60 sacs');
    await p.locator('#transfert').click();
    await p.locator('#tr-form select[name=de]').selectOption({ label: 'Magasin de Sfax' });
    await p.locator('#tr-form select[name=vers]').selectOption({ label: 'Magasin de Tunis' });
    await p.locator('#tr-form input[name=qty]').fill('75');
    await p.locator('#tr-ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^Magasin de Sfax n'en a que 60 le \d\d\/\d\d\/\d{4} : on ne transfère pas ce qui n'y est pas\.$/);
    await p.locator('#tr-form input[name=qty]').fill('25');
    await p.locator('#tr-ok').click();
    await expect.poll(parDepot, { timeout: 10_000 }).toBe('Par dépôt i : Magasin de Tunis 125 sacs · Magasin de Sfax 35 sacs');
    const fiche = net(await p.locator('#view').innerText());
    expect(fiche).toMatch(/EN STOCK 160 sacs/);
    expect(fiche).toMatch(/Transfert entre dépôts depuis Magasin de Sfax — Magasin de Tunis \+25/);
    expect(fiche).toMatch(/Transfert entre dépôts vers Magasin de Tunis — Magasin de Sfax -25|Transfert entre dépôts vers Magasin de Tunis — Magasin de Sfax −25/);
    await plusTard(p);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'depots-1-article.png') });
    // Supprimer une moitié du transfert supprime le transfert entier : on revient à 100 et 60.
    await p.locator('#view tr', { hasText: 'vers Magasin de Tunis' }).locator('[data-rm]').click();
    await expect.poll(async () => net(await p.locator('#modal-root').innerText())).toContain('Supprimer ce transfert ? Ses deux mouvements (la sortie et l\'entrée) partent ensemble.');
    await p.locator('#modal-root .btn-danger, #modal-root .btn-primary').last().click();
    await expect.poll(parDepot, { timeout: 10_000 }).toBe('Par dépôt i : Magasin de Tunis 100 sacs · Magasin de Sfax 60 sacs');
    expect(net(await p.locator('#view').innerText())).not.toMatch(/Transfert entre dépôts/);
    // La ligne de la réception mène à la réception.
    await p.locator('#view a', { hasText: /^BR-/ }).first().click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception BR-/);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
