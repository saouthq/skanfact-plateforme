// « À faire » sur l'accueil, pour les achats (brique 90 ; web/v10/commandes-fournisseurs.txt) : une commande
// fournisseur en retard de livraison et une réception qui attend la facture du fournisseur s'y annoncent ; chaque
// bouton mène à la liste qui les marque (« en retard », « à facturer »), comptées par les mêmes fonctions.

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

describe('« À faire » annonce les achats en attente, et chaque ligne mène à la liste qui les marque', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-a-faire-achats-'));
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
  it('Nadia voit sur son accueil la commande en retard et la réception sans facture, et chaque bouton l\'y mène', async () => {
    const email = `nadia-a-faire-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Une commande envoyée, attendue le 01/09/2026 et reçue en partie (60 sacs sur 100) ; la réception n'est pas facturée.
    const ligne = { label: 'Ciment gris 50 kg', qty: 100, unit: 'sac', unitPrice: { '~n': '17.25' }, vatRate: 19 };
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
      { collection: 'supplierOrders', cle: 'o1', rang: 0, revision: null, contenu: { id: 'o1', type: 'commandeFournisseur', number: 'BCF-2026-001', status: 'envoyée', date: '2026-08-25', dueDate: '2026-09-01', supplierId: 's1', currency: 'DT', lines: [ligne] } },
      { collection: 'receptions', cle: 'r1', rang: 0, revision: null, contenu: { id: 'r1', number: 'BR-2026-001', status: 'validée', date: '2026-09-02', supplierId: 's1', orderId: 'o1', orderNumber: 'BCF-2026-001', currency: 'DT', lines: [{ ...ligne, qty: 60, ligneCommande: 0 }] } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/`);
    await expect.poll(async () => net(await p.locator('#todo-list').innerText().catch(() => '')), { timeout: 20_000 })
      .toMatch(/1 commande fournisseur en retard de livraison La plus ancienne : BCF-2026-001 \(Ciments de Bizerte\), attendue le 01\/09\/2026\. Relance le fournisseur\. Voir les commandes/);
    await plusTard(p);
    expect(net(await p.locator('#todo-list').innerText())).toMatch(/1 réception attend la facture du fournisseur Ciments de Bizerte : la marchandise est en stock, sa facture n'est pas saisie\. Saisis-la depuis la réception\. Voir les réceptions/);
    await p.locator('#todo-list').scrollIntoViewIfNeeded();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'a-faire-achats-1-accueil.png') });

    // « Voir les commandes » : la liste marque la commande en retard.
    await p.locator('[data-todo="commandesf-retard"]').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toBe('Commandes fournisseurs i');
    await expect.poll(async () => net(await p.locator('#cf-list').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/BCF-2026-001 Ciments de Bizerte 25\/08\/2026 01\/09\/2026 reçue en partie en retard 1 725,000 DT/);
    // « Voir les réceptions » : la liste marque la réception à facturer.
    await p.evaluate(() => { location.hash = '#/'; });
    await p.locator('[data-todo="receptions-a-facturer"]').click();
    await expect.poll(async () => net(await p.locator('#cf-list').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/BR-2026-001 Ciments de Bizerte BCF-2026-001 02\/09\/2026 validée à facturer 1/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'a-faire-achats-2-receptions.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
