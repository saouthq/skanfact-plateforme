// Les Immobilisations dans la nouvelle DA (1.279.0), comme le Stock et le Catalogue : l'en-tête (chemin, titre, phrase),
// les onglets en barre segmentée qui disent lequel est ouvert, le contenu dans une carte, les quatre chiffres du tableau
// des amortissements au dessin des autres pages (les mêmes chiffres qu'avant). Au téléphone, rien ne déborde.
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

describe('les Immobilisations dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-immos-da-'));
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

  it('l\'en-tête, les quatre chiffres du tableau, les onglets ; au téléphone rien ne déborde', async () => {
    const email = `immos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Leïla Ben Ammar', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Cabinet d\'architecture Ben Ammar' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Deux biens à l'actif : 3 617,250 + 12 480,500 = 16 097,750 de valeur d'acquisition.
    const bien = (id: string, label: string, category: string, amount: number, date: string, years: number) => ({ collection: 'assets', cle: id, rang: 0, revision: null,
      contenu: { id, label, category, amount: { '~n': String(amount) }, date, years } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      bien('pc', 'Station de travail CAO', 'informatique', 3617.25, '2025-07-01', 3), bien('mob', 'Mobilier de l\'agence', 'mobilier', 12480.5, '2024-03-15', 10)] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(2);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/immos`);
    await p.locator('#im-body .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    expect(net(await p.locator('#view .lf-tete .chemin').innerText())).toBe('Accueil Immobilisations');
    expect(net(await p.locator('#view .lf-tete .sous').innerText())).toBe('Ce que tu gardes plusieurs années, ce qu\'il coûte chaque année, ce qu\'il vaut encore');
    const annee = new Date().getFullYear();
    const chiffres = (await p.locator('#im-body .mg-chiffre').allInnerTexts()).map(net);
    expect(chiffres).toHaveLength(4);
    expect(chiffres[0]).toBe(`Valeur d'acquisition i 16 097,750 DT 2 biens à l'actif au 31/12/${annee}`);
    expect(chiffres.slice(1).map((c) => c.replace(/[\d\s,]+DT/, ' … DT'))).toEqual([`Dotation ${annee} i … DT la charge de l'exercice`,
      `Amortissement cumulé … DT au 31/12/${annee}, depuis l'origine`, `Valeur nette comptable i … DT au 31/12/${annee} : ce qu'il reste à amortir`]);
    // Les onglets : une barre segmentée, l'onglet ouvert le dit ; le contenu dans sa carte.
    expect(await p.locator('#im-tabs.pa-seg button[aria-selected=true]').innerText()).toBe('Tableau des amortissements');
    expect(await p.locator('.lf.mg .cf-carte #im-body tr[data-aid]').count()).toBe(2);
    await p.screenshot({ path: path.join(PHOTOS, 'immos-da-1.png') });
    await p.locator('#im-tabs button[data-tab=sorties]').click();
    expect(await p.locator('#im-tabs button[aria-selected=true]').innerText()).toBe('Sorties et cessions');
    expect(await p.locator('#im-tabs button[aria-selected=true]').count()).toBe(1);

    // Au téléphone : les onglets sur une ligne, rien ne sort de l'écran ni de sa carte.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#im-tabs button[data-tab=tableau]').click();
    await p.locator('#im-body .mg-chiffre').first().waitFor();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    const lignes = await p.locator('#im-tabs button').evaluateAll((bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(lignes).toBe(1);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#im-body .mg-chiffre, #im-body .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      return { page: document.documentElement.scrollWidth - largeur, hors };
    });
    expect(debord).toEqual({ page: 0, hors: 0 });
    await p.screenshot({ path: path.join(PHOTOS, 'immos-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
