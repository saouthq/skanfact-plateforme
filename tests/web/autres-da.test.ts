// Les Autres pièces (proformas, bons, contrats à signer) dans la nouvelle DA (1.281.0), comme le Catalogue : l'en-tête
// (chemin, titre, la phrase de l'onglet ouvert), quatre chiffres sur les pièces de l'onglet (combien, brouillons, ce qui
// attend la suite, le montant HT de l'année hors brouillons et annulées), les onglets en barre segmentée, la liste dans
// une carte. « Brouillons » filtre la liste ; « À facturer » ouvre la facturation des bons. Au téléphone, rien ne déborde.

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

describe('les Autres pièces dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-autres-'));
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

  it('l\'en-tête, les quatre chiffres de l\'onglet, les onglets ; « Brouillons » filtre, « À facturer » ouvre la facturation ; au téléphone rien ne déborde', async () => {
    const email = `autres-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Walid Chaabane', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Chaabane' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const annee = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric' }).format(new Date());
    // Cinq bons de livraison : deux de l'année émis ou signés et sans facture, un brouillon, un annulé, un signé de l'an
    // passé. À facturer : les trois émis ou signés. Montant de l'année, HT, hors brouillon et annulé :
    // 40 × 16,800 + 3 × 120,250 = 672 + 360,750 = 1 032,750 (le brouillon ferait 1 082,750, l'annulé 2 031,750).
    const bon = (id: string, number: string, status: string, date: string, qty: number, prix: number) => ({ collection: 'documents', cle: id, rang: 0, revision: null,
      contenu: { id, type: 'livraison', number, status, date, clientId: 'c1', createdAt: 1, currency: 'DT', payments: [], discountRate: 0, withholdingRate: 0,
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty, unit: 'sac', unitPrice: { '~n': String(prix) }, vatRate: 19 }] } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } },
      bon('bl1', `BL-${annee}-001`, 'émis', `${annee}-02-10`, 40, 16.8), bon('bl2', `BL-${annee}-002`, 'signé', `${annee}-03-04`, 3, 120.25),
      bon('bl3', '', 'brouillon', `${annee}-03-20`, 50, 1), bon('bl4', `BL-${annee}-003`, 'annulé', `${annee}-01-15`, 1, 999),
      bon('bl5', `BL-${Number(annee) - 1}-009`, 'signé', `${Number(annee) - 1}-12-18`, 2, 10)] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(6);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/autres/livraison`);
    await p.locator('#a-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // L'en-tête du modèle : le chemin, le titre (« Autres pièces »), la phrase de l'onglet ouvert.
    expect(net(await p.locator('#view .page-head.lf-tete .chemin').innerText())).toBe('Accueil Autres pièces');
    expect(net(await p.locator('#view h1').first().innerText())).toBe('Autres pièces');
    expect(net(await p.locator('#view .page-head .sous').innerText())).toMatch(/^Le bon de livraison accompagne la marchandise et se fait signer à la réception\. Il prouve que tu as livré\.( i)?$/);
    const chiffres = (await p.locator('#a-resume .mg-chiffre').allInnerTexts()).map(net);
    expect(chiffres).toEqual([
      `Bons de livraison 5 dont 4 en ${annee}`,
      'Brouillons 1 à finir et envoyer — voir lesquels',
      'À facturer 3 émis ou signés, sans facture — les facturer',
      `Montant ${annee} 1 032,750 DT HT, hors brouillons et annulées`,
    ]);
    expect(await p.locator('#a-resume b.ambre').count()).toBe(2);
    // Les onglets : une barre segmentée, l'onglet ouvert le dit ; la liste est dans sa carte.
    expect(net(await p.locator('#a-tabs.pa-seg button[aria-selected=true]').innerText())).toBe('Bons de livraison 5');
    expect(await p.locator('.lf.mg.ap .cf-carte #list-wrap table.list tbody tr').count()).toBe(5);
    await p.screenshot({ path: path.join(PHOTOS, 'autres-da-1.png') });

    // « Brouillons » filtre la liste, et le filtre le dit.
    await p.locator('#a-resume [data-aller=brouillon]').click();
    await expect.poll(() => p.locator('#list-wrap table.list tbody tr').count()).toBe(1);
    expect(await p.locator('select#st').inputValue()).toBe('brouillon');
    // (1.309.0) Au clavier, cette liste se nomme « Statut » : rien ne la nomme dans la page, c'est telephone.js
    // (`nommerFiltres`) qui le fait ; la Comptabilité nomme désormais ses listes elle-même.
    expect(await p.getByRole('combobox', { name: 'Statut', exact: true }).count()).toBe(1);
    // « À facturer » ouvre la facturation des bons, comme le bouton de l'en-tête.
    await p.locator('#a-resume [data-aller=facturer]').click();
    await expect.poll(async () => net(await p.locator('#modal-root').innerText())).toContain('Chantier Ennasr');
    await p.keyboard.press('Escape');

    // Un autre onglet : la sélection, la phrase et les chiffres le suivent ; sans proforma, rien n'est compté.
    await p.locator('#a-tabs button[data-tab=proforma]').click();
    await expect.poll(() => p.locator('#a-tabs button[aria-selected=true]').innerText().then(net)).toBe('Proformas');
    expect(await p.locator('#a-tabs button[aria-selected=true]').count()).toBe(1);
    expect(await p.locator('#a-resume').count()).toBe(0);
    expect(net(await p.locator('#view .page-head .sous').innerText())).toMatch(/^Une proforma annonce un prix ferme/);

    // Au téléphone : les onglets sur une ligne, rien ne déborde de la page, d'un chiffre ni de la carte.
    await p.locator('#a-tabs button[data-tab=livraison]').click();
    await p.locator('#a-resume .mg-chiffre').first().waitFor();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    const lignes = await p.locator('#a-tabs button').evaluateAll((bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(lignes).toBe(1);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#a-resume .mg-chiffre, #a-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      const carte = document.querySelector('.lf.mg.ap #list-wrap')?.closest('.cf-carte')?.getBoundingClientRect().right ?? 0;
      const coupes = [...document.querySelectorAll('#list-wrap table.list tbody tr')].filter((x) => x.getBoundingClientRect().right > carte + 0.5).length;
      return { page: document.documentElement.scrollWidth - largeur, hors, coupes };
    });
    expect(debord).toEqual({ page: 0, hors: 0, coupes: 0 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: path.join(PHOTOS, 'autres-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
