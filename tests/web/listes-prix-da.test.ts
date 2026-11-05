// Les Listes de prix dans la nouvelle DA (1.282.0), comme le Catalogue : l'en-tête (chemin, titre, phrase), quatre
// chiffres sur toutes les listes (en vigueur, clients concernés, articles à prix négocié, prochaine fin), la liste dans
// une carte avec l'état de chaque liste. « En vigueur » et « clients concernés » suivent la règle du moteur qui pose le
// prix sur une pièce. Au téléphone, rien ne déborde.

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

describe('les Listes de prix dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-listesprix-'));
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

  it('l\'en-tête, les quatre chiffres sur les listes en vigueur, l\'état de chaque liste ; au téléphone rien ne déborde', async () => {
    const email = `listesprix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim Jaziri', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Jaziri' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Les dates se calculent du jour de Tunis : une liste finit dans 20 jours, une commence dans 30, une est finie.
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (n: number) => new Date(Date.parse(auj) + n * 86_400_000).toISOString().slice(0, 10);
    const fr = (iso: string) => iso.split('-').reverse().join('/');
    const o = (collection: string, cle: string, contenu: Record<string, unknown>) => ({ collection, cle, rang: 0, revision: null, contenu: { id: cle, ...contenu } });
    // Quatre clients : deux revendeurs, un client nommé par une liste, un dont la seule liste est finie. Trois articles.
    // En vigueur : « Revendeurs » (c1, c2 par leur catégorie) et « Chantier Ennasr » (c4) → 3 clients sur 4 ; le client
    // de la liste finie ne compte pas (sinon 4). Articles à prix négocié : a1 et a2 (a3 a un prix nul) → 2 sur 3.
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      o('clients', 'c1', { name: 'Quincaillerie du Lac', categorieTarif: 'Revendeur' }), o('clients', 'c2', { name: 'Bricolage Sfax', categorieTarif: 'Revendeur' }),
      o('clients', 'c3', { name: 'Monsieur Trabelsi' }), o('clients', 'c4', { name: 'Chantier Ennasr' }),
      o('catalog', 'a1', { label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: { '~n': '16.8' }, vatRate: 19 }),
      o('catalog', 'a2', { label: 'Sable lavé (m³)', unit: 'm³', unitPrice: { '~n': '45' }, vatRate: 19 }),
      o('catalog', 'a3', { label: 'Gravier 15/25 (m³)', unit: 'm³', unitPrice: { '~n': '52.5' }, vatRate: 19 }),
      o('priceLists', 'l1', { nom: 'Revendeurs 2026', categorie: 'Revendeur', clientIds: [], depuis: jour(-60), jusquau: jour(20), lignes: [{ itemId: 'a1', prix: '15.2' }, { itemId: 'a2', prix: '41' }] }),
      o('priceLists', 'l2', { nom: 'Chantier Ennasr', categorie: '', clientIds: ['c4'], depuis: jour(-10), jusquau: '', lignes: [{ itemId: 'a1', prix: '14.9' }, { itemId: 'a3', prix: '0' }] }),
      o('priceLists', 'l3', { nom: 'Promo printemps', categorie: 'Revendeur', clientIds: [], depuis: jour(30), jusquau: '', lignes: [{ itemId: 'a3', prix: '48' }] }),
      o('priceLists', 'l4', { nom: 'Soldes été', categorie: '', clientIds: ['c3'], depuis: jour(-200), jusquau: jour(-100), lignes: [{ itemId: 'a3', prix: '47' }] })] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(11);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/listesprix`);
    await p.locator('#lp-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    expect(net(await p.locator('#view .page-head.lf-tete .chemin').innerText())).toBe('Accueil Listes de prix');
    expect(net(await p.locator('#view .page-head h1').innerText())).toBe('Listes de prix i');
    expect(net(await p.locator('#view .page-head .sous').innerText())).toBe('Des prix à part pour une catégorie de clients ou des clients choisis, à partir d\'une date : leurs devis et factures les reprennent');
    expect((await p.locator('#lp-resume .mg-chiffre').allInnerTexts()).map(net)).toEqual([
      'Listes en vigueur 2 1 à venir · 1 terminée',
      'Clients concernés 3 sur 4 clients, aujourd\'hui',
      'Articles à prix négocié 2 sur 3 au catalogue',
      `Prochaine fin ${fr(jour(20))} Revendeurs 2026 — dans 20 jours`,
    ]);
    expect(await p.locator('#lp-resume b.ambre').count()).toBe(1);
    // La liste, dans sa carte, dit l'état de chaque liste.
    const etats = await p.locator('.lf.mg.lpx .cf-carte #lp-list tbody tr').evaluateAll((trs) => trs.map((tr) => `${tr.querySelector('b')?.textContent} : ${tr.lastElementChild?.textContent}`));
    expect(etats.sort()).toEqual(['Chantier Ennasr : en vigueur', 'Promo printemps : à venir', 'Revendeurs 2026 : en vigueur', 'Soldes été : terminée']);
    await p.screenshot({ path: path.join(PHOTOS, 'listes-prix-da-1.png') });

    // Au téléphone : rien ne déborde de la page, d'un chiffre ni de la carte.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#lp-resume .mg-chiffre, #lp-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      const carte = document.querySelector('.lf.mg.lpx #lp-list')?.closest('.cf-carte')?.getBoundingClientRect().right ?? 0;
      const coupes = [...document.querySelectorAll('#lp-list tbody tr')].filter((x) => x.getBoundingClientRect().right > carte + 0.5).length;
      return { page: document.documentElement.scrollWidth - largeur, hors, coupes };
    });
    expect(debord).toEqual({ page: 0, hors: 0, coupes: 0 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: path.join(PHOTOS, 'listes-prix-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
