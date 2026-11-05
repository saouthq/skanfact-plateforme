// Le Catalogue dans la nouvelle DA (1.278.0), comme le Stock et la Trésorerie : l'en-tête (chemin, titre de l'onglet,
// phrase), quatre chiffres au-dessus des onglets (ce qu'on vend, sans prix, marge moyenne, modèles ou exemples), les
// onglets en barre segmentée, la liste dans une carte. La marge ne se lit que sur ce qui a un prix ET un coût, et dit ce
// qui se vend sans marge. Le chiffre des modèles ouvre leur onglet. Au téléphone, rien ne déborde.

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

describe('le Catalogue dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-catalogue-'));
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

  it('l\'en-tête, les quatre chiffres, les onglets ; la marge sur ce qui a un coût ; les modèles s\'ouvrent ; au téléphone rien ne déborde', async () => {
    const email = `catalogue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Mehdi Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Trabelsi' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Quatre prestations : une avec sa marge (120,500 pour 72,300 de coût), une vendue sous son coût (45,250 pour 47,800),
    // une sans prix, une sans coût suivie en stock. La marge se lit sur les deux premières seulement :
    // (48,200 − 2,550) / (120,500 + 45,250) = 45,650 / 165,750 = 27,54… % → 27,5 %.
    const art = (id: string, label: string, prix: number, cout: number, suivi = false) => ({ collection: 'catalog', cle: id, rang: 0, revision: null,
      contenu: { id, label, unit: 'u', unitPrice: { '~n': String(prix) }, unitCost: { '~n': String(cout) }, vatRate: 19,
        ...(suivi ? { tracked: true, initialQty: { '~n': '5' }, initialCost: { '~n': '10' } } : {}) } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      art('pose', 'Pose de faïence (m²)', 120.5, 72.3), art('depl', 'Déplacement Grand Tunis', 45.25, 47.8),
      art('devis', 'Étude sur place', 0, 0), art('joint', 'Joint époxy (seau)', 33.75, 0, true)] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(4);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/catalogue`);
    await p.locator('#cat-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // L'en-tête du modèle : le chemin, le titre de l'onglet, la phrase.
    expect(net(await p.locator('#cat-head .chemin').innerText())).toBe('Accueil Catalogue');
    expect(net(await p.locator('#cat-head h1').innerText())).toMatch(/^Prestations( i)?$/);
    expect(net(await p.locator('#cat-head .sous').innerText())).toBe('Ce que tu vends, avec son prix, sa TVA et son unité : tes devis et tes factures le reprennent d\'un clic');
    const chiffres = (await p.locator('#cat-resume .mg-chiffre').allInnerTexts()).map(net);
    expect(chiffres).toEqual([
      'Prestations i 4 dont 1 suivie en stock',
      'Sans prix 1 à compléter avant de les vendre',
      'Marge moyenne 27,5 % 1 prestation sans marge (prix ≤ coût)',
      'Modèles de documents i 0 depuis un devis : Plus ▾',
    ]);
    expect(await p.locator('#cat-resume b.rouge').count()).toBe(1);
    expect(await p.locator('#cat-resume b.ambre').count()).toBe(1);
    // Les onglets : une barre segmentée, l'onglet ouvert le dit ; la liste est dans sa carte.
    expect(await p.locator('#cat-tabs.pa-seg button[aria-selected=true]').innerText()).toBe('Prestations');
    expect(await p.locator('.lf.mg .cf-carte #list-wrap table.list tbody tr').count()).toBe(4);
    await p.screenshot({ path: path.join(PHOTOS, 'catalogue-da-1.png') });

    // Le chiffre des modèles ouvre leur onglet : le titre, la phrase et la sélection suivent.
    await p.locator('#cat-resume [data-aller=modeles]').click();
    await expect.poll(() => p.locator('#cat-tabs button[aria-selected=true]').innerText()).toBe('Modèles de documents');
    expect(await p.locator('#cat-tabs button[aria-selected=true]').count()).toBe(1);
    expect(net(await p.locator('#cat-head .sous').innerText())).toBe('Des devis et des factures prêts à reprendre, enregistrés depuis une pièce');
    expect(await p.locator('[data-pane=modeles]').isVisible()).toBe(true);
    expect(await p.locator('[data-pane=presta]').isVisible()).toBe(false);

    // Une prestation reçoit son prix : « Sans prix » passe à 0, en vert, sans recharger la page.
    await p.locator('#cat-tabs button[data-tab=presta]').click();
    await p.locator('#list-wrap tr[data-ouvrir=devis]').click();
    await p.locator('#modal-root input[name=unitPrice]').fill('25');
    await p.locator('#modal-root .modal-actions .btn-primary').click();
    await expect.poll(async () => net(await p.locator('#cat-resume .mg-chiffre').nth(1).innerText())).toBe('Sans prix 0 tous ont un prix');
    expect(await p.locator('#cat-resume .mg-chiffre').nth(1).locator('b.vert').count()).toBe(1);

    // Au téléphone : les onglets sur une ligne, rien ne déborde de la page ni d'un chiffre.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    const lignes = await p.locator('#cat-tabs button').evaluateAll((bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(lignes).toBe(1);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#cat-resume .mg-chiffre, #cat-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      // Une fiche de la liste ne dépasse pas de sa carte (vu à l'essai : coupée à droite).
      const carte = document.querySelector('.lf.mg.ca #list-wrap')?.closest('.cf-carte')?.getBoundingClientRect().right ?? 0;
      const coupes = [...document.querySelectorAll('#list-wrap table.list tbody tr, #list-wrap table.list tfoot tr')]
        .filter((x) => x.getBoundingClientRect().right > carte + 0.5).map((x) => `${x.tagName}.${x.className}:${Math.round(x.getBoundingClientRect().right - carte)}`);
      return { page: document.documentElement.scrollWidth - largeur, hors, coupes };
    });
    expect(debord).toEqual({ page: 0, hors: 0, coupes: [] });
    await p.screenshot({ path: path.join(PHOTOS, 'catalogue-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
