// La pagination dans toutes les listes de l'app entreprise (1.352.0 ; docs/revue-modules.md). Demande de Skander :
// « n'oublie pas la pagination dans toutes les listes ». Mesuré sur des données pleines : sept listes s'affichaient d'un
// seul tenant — les affaires, les ventes et les achats d'une affaire (seize écrans), les paiements d'un client, les
// règlements d'un fournisseur, les listes de prix et les prix d'une liste, le tableau des amortissements. Le parcours
// remplit une menuiserie et tourne les pages : une page à l'écran, « n–m sur N », et le pied de totaux de TOUTE la liste.

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

describe('la pagination dans toutes les listes de l\'app entreprise (1.352.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ent-pagination-'));
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

  it('une menuiserie pleine : les affaires, la fiche d\'une affaire, les règlements d\'un fournisseur, les listes de prix et leurs prix, les biens se feuillettent', async () => {
    const email = `hedi-pagination-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const Y = new Date().getFullYear();
    const N = Array.from({ length: 30 }, (_, i) => i);
    const ch = (collection: string, cle: string, rang: number, contenu: unknown) => ({ collection, cle, rang, revision: null, contenu });
    // Trente de chaque : une page de vingt-cinq et une de cinq. Des montants ronds, pour refaire les totaux de tête.
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      ch('clients', 'c1', 0, { id: 'c1', name: 'Hôtel Dar El Marsa' }),
      ch('suppliers', 's1', 0, { id: 's1', name: 'Bois du Sahel' }),
      ...N.map((i) => ch('catalog', `k${i}`, i, { id: `k${i}`, label: `Planche n° ${i + 1}`, unit: 'pièce', unitPrice: 10 + i, vatRate: 19 })),
      ...N.map((i) => ch('projects', `p${i}`, i, { id: `p${i}`, name: `Chantier ${String(i + 1).padStart(2, '0')}`, clientId: 'c1', status: 'en cours', createdAt: i + 1 })),
      // 30 achats de 100 DT HT (119 TTC), tous sur le chantier 01, tous réglés : 3 000 de coût, 3 570 versés.
      ...N.map((i) => ch('purchases', `a${i}`, i, { id: `a${i}`, kind: 'facture', number: `BS-${String(i + 1).padStart(3, '0')}`, date: `${Y}-01-${String(i % 28 + 1).padStart(2, '0')}`, supplierId: 's1', projectId: 'p0', currency: 'DT',
        lines: [{ label: 'Planches de hêtre', qty: 1, unitPrice: 100, vatRate: 19, destination: 'charge', deductible: true }], fees: 0, withholdingRate: 0,
        payments: [{ id: `r${i}`, date: `${Y}-02-${String(i % 28 + 1).padStart(2, '0')}`, amount: 119, method: 'Virement' }] })),
      ...N.map((i) => ch('assets', `i${i}`, i, { id: `i${i}`, label: `Machine n° ${String(i + 1).padStart(2, '0')}`, category: 'outillage', amount: 1000, date: `${Y}-01-01`, years: 5, residual: 0 })),
      ...N.map((i) => ch('priceLists', `lp${i}`, i, { id: `lp${i}`, nom: `Tarif ${String(i + 1).padStart(2, '0')}`, categorie: 'Revendeur', clientIds: [], depuis: `${Y}-01-${String(30 - i).padStart(2, '0')}`, jusquau: '',
        lignes: (i === 0 ? N : [0]).map((k) => ({ itemId: `k${k}`, prix: 9 })) })),
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator(attendre).first().waitFor({ timeout: 15_000 });
    };
    const info = (ou: string) => p.locator(`${ou} .pager .pg-info`).first().innerText().then(net);
    const suivant = (ou: string) => p.locator(`${ou} .pager [data-pg=next]`).first().click();

    // ── Les affaires (Marges) : vingt-cinq à l'écran, les trente au pied ─────────────────────────────
    await aller('marges', '#mg-body tbody tr');
    expect(await p.locator('#mg-body tbody tr').count()).toBe(25);
    expect(await info('#mg-body')).toBe('1–25 sur 30 affaires');
    expect(net(await p.locator('#mg-body tfoot').innerText())).toContain('30 affaires');
    await suivant('#mg-body');
    await expect.poll(() => p.locator('#mg-body tbody tr').count()).toBe(5);
    expect(await info('#mg-body')).toBe('26–30 sur 30 affaires');
    // Chercher repart de la première page.
    await p.locator('#mg-q').fill('Chantier');
    await expect.poll(() => info('#mg-body')).toBe('1–25 sur 30 affaires');
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-ent-1-affaires.png') });

    // ── La fiche d'une affaire : ses trente achats, et le coût de TOUS au pied ───────────────────────
    await aller('affaire/p0', '.mg-fiche-t');
    const ongletAchats = p.locator('#view [role=tab]').filter({ hasText: 'Achats' }).first();
    if (await ongletAchats.count()) await ongletAchats.click();
    await expect.poll(() => p.locator('#p-buys tbody tr').count()).toBe(25);
    expect(await info('#p-buys')).toBe('1–25 sur 30 achats');
    expect(net(await p.locator('#p-buys tfoot').innerText())).toMatch(/30 achats.*3\s000,000/);
    await suivant('#p-buys');
    await expect.poll(() => p.locator('#p-buys tbody tr').count()).toBe(5);
    expect(net(await p.locator('#p-buys tfoot').innerText())).toMatch(/30 achats.*3\s000,000/);

    // ── La fiche du fournisseur : ses trente règlements ──────────────────────────────────────────────
    await aller('fournisseur/s1', '#view [data-onglet="reglements"]');
    await p.locator('#view [data-onglet="reglements"]').click();
    await expect.poll(() => p.locator('#ff-onglet tbody tr').count()).toBe(25);
    expect(await info('#ff-onglet')).toBe('1–25 sur 30 règlements');
    expect(net(await p.locator('#ff-onglet .cf-o-t').first().innerText())).toMatch(/^30 règlements · 3\s570,000 DT versés/);
    await suivant('#ff-onglet');
    await expect.poll(() => p.locator('#ff-onglet tbody tr').count()).toBe(5);
    expect(await info('#ff-onglet')).toBe('26–30 sur 30 règlements');
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-ent-2-reglements.png') });

    // ── Les listes de prix, puis les prix d'une liste ────────────────────────────────────────────────
    await aller('listesprix', '#lp-list tbody tr');
    expect(await p.locator('#lp-list tbody tr').count()).toBe(25);
    expect(await info('#view')).toBe('1–25 sur 30 listes');
    await suivant('#view');
    await expect.poll(() => p.locator('#lp-list tbody tr').count()).toBe(5);
    await aller('listeprix/lp0', '#lp-lignes tr');
    expect(await p.locator('#lp-lignes tr').count()).toBe(25);
    expect(await info('#lp-pg')).toBe('1–25 sur 30 articles');
    await suivant('#lp-pg');
    await expect.poll(() => p.locator('#lp-lignes tr').count()).toBe(5);
    // Le rang d'une ligne est celui de TOUTE la liste : la première de la page 2 est la vingt-sixième, et c'est elle qu'on retire.
    expect(await p.locator('#lp-lignes tr select').first().getAttribute('data-i')).toBe('25');
    expect(await p.locator('#lp-lignes tr select').first().inputValue()).toBe('k25');
    await p.locator('#lp-lignes [data-lrm="25"]').click();
    await expect.poll(() => info('#lp-pg')).toBe('26–29 sur 29 articles');
    expect(await p.locator('#lp-lignes tr select').first().inputValue()).toBe('k26');
    // « + Article » amène à la dernière page, où la ligne neuve attend.
    await p.locator('#lp-pg [data-pg=prev]').click();
    await p.locator('#lp-add').click();
    await expect.poll(() => info('#lp-pg')).toBe('26–30 sur 30 articles');
    expect(await p.locator('#lp-lignes tr select').last().inputValue()).toBe('');

    // ── Les biens : vingt-cinq lignes et celle des totaux, qui porte les trente ──────────────────────
    await aller('immos', '#im-body tbody tr');
    await expect.poll(() => p.locator('#im-body tbody tr').count()).toBe(26);
    expect(await info('#im-body')).toBe('1–25 sur 30 biens');
    expect(net(await p.locator('#im-body tbody tr').last().innerText())).toMatch(/^Total.*30\s000,000 DT/);
    await suivant('#im-body');
    await expect.poll(() => p.locator('#im-body tbody tr').count()).toBe(6);
    expect(net(await p.locator('#im-body tbody tr').last().innerText())).toMatch(/^Total.*30\s000,000 DT/);
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-ent-3-biens.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
