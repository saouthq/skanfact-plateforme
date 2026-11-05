// Les Commandes fournisseurs dans la nouvelle DA (1.279.0), comme le Stock et le Catalogue : l'en-tête (chemin, titre,
// phrase), quatre chiffres au-dessus des onglets (en cours et ce qu'elles engagent en dinars, en retard, reçu à facturer,
// brouillons), les onglets en barre segmentée, la liste dans une carte. « Reçu, à facturer » ouvre les réceptions. Au
// téléphone, rien ne déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les Commandes fournisseurs dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-commandes-da-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('l\'en-tête, les quatre chiffres, les onglets ; « Reçu, à facturer » ouvre les réceptions ; au téléphone rien ne déborde', async () => {
    const email = `commandes-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Bâtiment Gharbi' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Deux commandes envoyées : la première en retard (livraison souhaitée le 20/10/2026), la seconde reçue en partie ; un
    // brouillon ; une réception validée que rien ne facture. Engagé : 10 × 12,500 + 3 × 47,333 = 125,000 + 141,999.
    const ligne = (label: string, q: number, pu: number) => ({ label, qty: { '~n': String(q) }, unitPrice: { '~n': String(pu) }, vatRate: 19, unit: 'u' });
    const cmd = (id: string, number: string, status: string, dueDate: string, lines: unknown[]) => ({ collection: 'supplierOrders', cle: id, rang: 0, revision: null,
      contenu: { id, number, supplierId: 'cim', date: '2026-10-01', dueDate, status, currency: 'TND', lines } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 'cim', rang: 0, revision: null, contenu: { id: 'cim', name: 'Ciments de Bizerte' } },
      cmd('c1', 'BCF-2026-001', 'envoyée', '2026-10-20', [ligne('Ciment CPA 42,5 (sac)', 10, 12.5)]),
      cmd('c2', 'BCF-2026-002', 'envoyée', '2027-01-31', [ligne('Fer à béton Ø12 (barre)', 3, 47.333)]),
      cmd('c3', '', 'brouillon', '', [ligne('Sable lavé (m³)', 2, 35)]),
      { collection: 'receptions', cle: 'r1', rang: 0, revision: null, contenu: { id: 'r1', number: 'BR-2026-001', supplierId: 'cim', orderId: 'c2', orderNumber: 'BCF-2026-002',
        date: '2026-10-15', status: 'validée', lines: [{ ...ligne('Fer à béton Ø12 (barre)', 1, 47.333), ligneCommande: 0 }] } }] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(5);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/commandesf`);
    await p.locator('#cf-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    expect(net(await p.locator('#view .lf-tete .chemin').innerText())).toBe('Accueil Commandes fournisseurs');
    expect(net(await p.locator('#view h1').first().innerText())).toMatch(/^Commandes fournisseurs( i)?$/);
    expect(net(await p.locator('#view .lf-tete .sous').innerText())).toBe('Ce que tu commandes, ce qui est livré, ce qui reste à recevoir et à facturer');
    expect((await p.locator('#cf-resume .mg-chiffre').allInnerTexts()).map(net)).toEqual([
      'En cours 2 266,999 DT HT engagés',
      'En retard 1 livraison souhaitée dépassée — voir lesquelles',
      'Reçu, à facturer 1 la facture du fournisseur manque — voir lesquelles',
      'Brouillons 1 pas encore envoyées au fournisseur',
    ]);
    expect(await p.locator('#cf-resume b.rouge').count()).toBe(1);
    expect(await p.locator('#cf-resume b.ambre').count()).toBe(1);
    expect(net(await p.locator('#cf-tabs.pa-seg button[aria-selected=true]').innerText())).toBe('Commandes 3');
    expect(await p.locator('.lf.mg .cf-carte #cf-list table.list tbody tr').count()).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'commandes-da-1.png') });

    // « Reçu, à facturer » ouvre les réceptions, et l'onglet le dit.
    await p.locator('#cf-resume [data-aller=receptions]').click();
    await expect.poll(async () => net(await p.locator('#cf-tabs button[aria-selected=true]').innerText().catch(() => ''))).toBe('Réceptions 1');
    expect(await p.locator('#cf-tabs button[aria-selected=true]').count()).toBe(1);
    expect(await p.locator('#cf-list').innerText()).toContain('BR-2026-001');

    // Au téléphone : les onglets sur une ligne, rien ne sort de l'écran ni de sa carte.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#cf-tabs button[data-tab=commandes]').click();
    await p.locator('#cf-resume .mg-chiffre').first().waitFor();
    await p.waitForTimeout(400);
    const lignes = await p.locator('#cf-tabs button').evaluateAll((bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(lignes).toBe(1);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#cf-resume .mg-chiffre, #cf-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      const carte = document.querySelector('#cf-list')?.closest('.cf-carte')?.getBoundingClientRect().right ?? 0;
      const coupes = [...document.querySelectorAll('#cf-list table.list tbody tr')].filter((x) => x.getBoundingClientRect().right > carte + 0.5).length;
      return { page: document.documentElement.scrollWidth - largeur, hors, coupes };
    });
    expect(debord).toEqual({ page: 0, hors: 0, coupes: 0 });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(PHOTOS, 'commandes-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
