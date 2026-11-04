// Le Stock dans la nouvelle DA (1.277.0), comme la Trésorerie : l'en-tête (chemin, titre, phrase), les quatre chiffres
// au-dessus des onglets (valeur, sous le seuil, négatifs, prix de vente), les onglets en barre segmentée, le contenu dans
// une carte. Un chiffre rouge qui nomme un ensemble ouvre les alertes ; le chiffre suit un mouvement saisi. Au téléphone,
// rien ne déborde.

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

describe('le Stock dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-stock-'));
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

  it('l\'en-tête, les quatre chiffres, les onglets ; un chiffre rouge ouvre les alertes ; au téléphone rien ne déborde', async () => {
    const email = `stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie Ben Salah' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Trois articles suivis : la colle sous son seuil (4 pour 10), les vis bien fournies, la planche sans prix de vente.
    const art = (id: string, label: string, prix: number, qte: number, seuil: number) => ({ collection: 'catalog', cle: id, rang: 0, revision: null,
      contenu: { id, label, unit: 'pièce', unitPrice: { '~n': String(prix) }, vatRate: 19, tracked: true, initialQty: { '~n': String(qte) }, minStock: { '~n': String(seuil) }, initialCost: { '~n': String(prix ? prix / 2 : 9.6) } } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      art('colle', 'Colle à bois 750 g', 18.5, 4, 10), art('vis', 'Vis inox 4×40 (boîte)', 12.75, 60, 10), art('planche', 'Planche de hêtre 2 m', 0, 12, 0)] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(3);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // L'en-tête du modèle : le chemin, le titre, la phrase.
    expect(net(await p.locator('#st-head .chemin').innerText())).toBe('Accueil Stock');
    expect(net(await p.locator('#st-head .sous').innerText())).toBe('Ce que tu as en rayon, ce qui entre et sort, ce qu\'il faut recommander');
    // Les quatre chiffres, au-dessus des onglets ; la planche sans prix ne compte pas dans le prix de vente.
    const chiffres = (await p.locator('#st-resume .mg-chiffre').allInnerTexts()).map(net);
    expect(chiffres).toHaveLength(4);
    // Au coût de départ : 4 × 9,250 + 60 × 6,375 + 12 × 9,600 = 37 + 382,5 + 115,2 = 534,700.
    expect(chiffres[0]).toBe('Valeur du stock i 534,700 DT 3 articles suivis, au coût moyen');
    expect(chiffres[1]).toBe('Sous le seuil i 1 à recommander — voir lesquels');
    expect(chiffres[2]).toBe('Stocks négatifs i 0 rien d\'impossible');
    // 4 × 18,500 + 60 × 12,750 = 839,000 ; la planche, sans prix, est dite à part.
    expect(chiffres[3]).toBe('Prix de vente du stock 839,000 DT ce qu\'il rapporterait vendu — 1 article sans prix, non compté');
    expect(await p.locator('#st-resume .mg-chiffre b.rouge').count()).toBe(1);
    // Les onglets : une barre segmentée, l'onglet ouvert le dit (aria-selected) ; le tableau est dans sa carte.
    expect(await p.locator('#st-tabs.pa-seg button[aria-selected=true]').innerText()).toBe('État du stock');
    expect(await p.locator('.lf.mg .cf-carte #st-body table.list tbody tr[data-iid]').count()).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'stock-da-1-etat.png') });

    // « Sous le seuil » ouvre les alertes, et l'onglet le dit.
    await p.locator('#st-resume [data-stat=low]').click();
    await expect.poll(() => p.locator('#st-tabs button[aria-selected=true]').innerText()).toMatch(/^Alertes/);
    expect(await p.locator('#st-body').innerText()).toContain('Colle à bois 750 g');
    // Un onglet choisi à la main prend la sélection.
    await p.locator('#st-tabs button[data-tab=mouvements]').click();
    expect(await p.locator('#st-tabs button[aria-selected=true]').innerText()).toBe('Mouvements');
    expect(await p.locator('#st-tabs button[aria-selected=true]').count()).toBe(1);

    // Au téléphone : rien ne déborde de la page ni d'un chiffre.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#st-tabs button[data-tab=etat]').click();
    await p.waitForTimeout(400);
    // La barre des onglets tient sur une ligne (elle défile).
    const lignes = await p.locator('#st-tabs button').evaluateAll((bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(lignes).toBe(1);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#st-resume .mg-chiffre, #st-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      return { page: document.documentElement.scrollWidth - largeur, hors };
    });
    expect(debord).toEqual({ page: 0, hors: 0 });
    await p.screenshot({ path: path.join(PHOTOS, 'stock-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
