// Les listes de prix, à la souris (brique 93 ; 14 § 3.2, 01 § 5 ; web/v10/listes-prix.txt) :
//   - une liste « Revendeurs » se crée pour une catégorie de clients, à partir d'aujourd'hui ;
//   - sur la facture d'un revendeur, l'article choisi prend le prix de la liste ; sur celle d'un particulier,
//     le prix du catalogue ;
//   - le particulier devenu revendeur (sa fiche) a désormais le prix de la liste sur ses nouvelles lignes, et sa
//     ligne déjà faite garde le sien.

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

describe('les listes de prix, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-listes-prix-'));
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
  const choisir = async (p: Page, conteneur: string, cherche: string) => {
    await p.locator(`${conteneur} .combo-btn`).click();
    await p.locator(`${conteneur} .combo-q`).fill(cherche);
    await p.locator(`${conteneur} .combo-list [role=option]`).first().click();
  };
  it('Nadia fait une liste de prix pour ses revendeurs, et leurs factures la suivent', async () => {
    const email = `nadia-listes-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const brouillon = (id: string, client: string) => ({ id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client, createdAt: Date.now(),
      lines: [{ label: '', description: '', qty: 1, unit: '', unitPrice: 0, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Quincaillerie du Lac', categorieTarif: 'Revendeur' } },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Monsieur Trabelsi' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, vatRate: 19 } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: brouillon('f1', 'c1') },
      { collection: 'documents', cle: 'f2', rang: 1, revision: null, contenu: brouillon('f2', 'c2') },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const prixLigne = (i: number) => p.locator(`#lines tr[data-i="${i}"] input[data-k=unitPrice]`).inputValue();
    const choisirArticle = async () => { await choisir(p, '#cat-pick', 'Ciment'); };
    const ouvrir = async (hash: string, titreAttendu: RegExp) => {
      await p.evaluate((h) => { location.hash = h; }, hash);
      await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(titreAttendu);
      await plusTard(p);
    };

    // 1. La liste « Revendeurs » : la catégorie « Revendeur », à partir d'aujourd'hui, le ciment à 19,500.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/listesprix`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toBe('Listes de prix i');
    await plusTard(p);
    await p.locator('#lp-new').click();
    await expect.poll(() => titre(p)).toMatch(/^Nouvelle liste de prix/);
    await p.locator('#lp-head input[name=nom]').fill('Revendeurs');
    await p.locator('#lp-head input[name=categorie]').fill('Revendeur');
    await p.locator('#lp-lignes select[data-lk=itemId]').first().selectOption('ciment');
    await p.locator('#lp-lignes input[data-lk=prix]').first().fill('19.5');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'listes-prix-1-liste.png') });
    await p.locator('#save').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Revendeurs/);
    expect(net(await p.locator('nav a.active').innerText())).toBe('Listes de prix');

    // 2. La facture du revendeur : le ciment à 19,500 ; celle du particulier : 21.
    await ouvrir('#/doc/f1', /^Facture/);
    await choisirArticle();
    await expect.poll(() => prixLigne(0)).toMatch(/^19\.5(00)?$/);
    await p.locator('#save').click();
    await ouvrir('#/doc/f2', /^Facture/);
    await choisirArticle();
    await expect.poll(() => prixLigne(0)).toMatch(/^21(\.000)?$/);
    await p.locator('#save').click();

    // 3. Monsieur Trabelsi devient revendeur (sa fiche) : sa nouvelle ligne prend 19,500, l'ancienne garde 21.
    await ouvrir('#/client/c2', /^Monsieur Trabelsi/);
    await p.locator('#view .page-head').getByRole('button', { name: 'Actions' }).click();
    await p.getByText('Modifier la fiche', { exact: true }).click();
    await p.locator('#cf input[name=categorieTarif]').fill('Revendeur');
    await p.locator('#modal-root .btn-primary').last().click();
    await expect.poll(() => p.locator('#cf').count()).toBe(0);
    await ouvrir('#/doc/f2', /^Facture/);
    await choisirArticle();
    await expect.poll(() => prixLigne(1)).toMatch(/^19\.5(00)?$/);
    expect(await prixLigne(0)).toMatch(/^21(\.000)?$/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'listes-prix-2-facture.png') });
    await p.locator('#save').click();

    await ouvrir('#/listesprix', /^Listes de prix/);
    expect(net(await p.locator('#lp-list').innerText())).toMatch(/Revendeurs la catégorie « Revendeur » \d\d\/\d\d\/\d{4} — 1/);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
