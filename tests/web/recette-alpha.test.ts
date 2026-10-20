// La recette « alpha » du 20/10/2026 (1.79.0 ; docs/recette.md), à la souris, chez un commerçant :
//   - la caisse : la rangée des familles est là dès le premier ticket ; la première vente ne pousse pas les tuiles ;
//   - une facture d'achat réglée ne se supprime pas : le refus dit pourquoi et où retirer le règlement ;
//   - une fenêtre plus haute que l'écran garde « Enregistrer » à l'écran ;
//   - l'invitation « Première fois sur cette page ? » ne revient pas quand la page se redessine sur place ;
//   - une date tapée après un clic dans sa case remplace celle qui y était.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la recette alpha, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-alpha-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  // Le commerce de Rania : sa caisse, sa banque, deux articles sans famille, un fournisseur et un achat réglé.
  async function commerce() {
    const email = `rania-alpha-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Rania', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie Ennasr' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const compte = (id: string, nom: string, kind: string, defaut: boolean) => ({ collection: 'accounts', cle: id, rang: defaut ? 1 : 0, revision: null,
      contenu: { id, name: nom, kind, bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: defaut, statementBalance: '', notes: '' } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      compte('k-caisse', 'Caisse', 'caisse', false), compte('k-banque', 'BIAT', 'banque', true),
      { collection: 'catalog', cle: 'vis', rang: 0, revision: null, contenu: { id: 'vis', label: 'Vis à bois 4×40', unit: 'u', unitPrice: { '~n': '0.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'colle', rang: 1, revision: null, contenu: { id: 'colle', label: 'Colle à bois', unit: 'u', unitPrice: { '~n': '6.8' }, vatRate: 19 } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Grossiste du Sahel' } },
      { collection: 'purchases', cle: 'a1', rang: 0, revision: null, contenu: {
        id: 'a1', kind: 'facture', supplierId: 's1', number: 'GS-118', date: aujourdhui, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0, tvaRecuperable: true,
        lines: [{ label: 'Clous', qty: 3, unitPrice: { '~n': '41.735' }, vatRate: 19, destination: 'charge', deductible: true }],
        payments: [{ id: 'r1', date: aujourdhui, amount: { '~n': '148.994' }, method: 'virement', accountId: 'k-banque', reference: '', note: '' }] } },
    ] })).statut).toBe(200);
    return { jeton, ent };
  }

  it('la caisse ne pousse pas ses tuiles, un achat réglé ne se supprime pas, la fenêtre garde son bouton, l\'invitation ne revient pas, la date se remplace', async () => {
    const { jeton, ent } = await commerce();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // 1. L'invitation de la page des clients : posée en entrant ; refermée d'un clic ailleurs, un redessin sur place ne la
    //    repose pas.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#guide-appel').waitFor({ timeout: 20_000 });
    await p.locator('#view h1').first().click();
    await expect.poll(() => p.locator('#guide-appel').count()).toBe(0);
    await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    await p.waitForTimeout(800);
    expect(await p.locator('#guide-appel').count()).toBe(0);

    // 2. La facture d'achat réglée : « Supprimer » refuse, dit pourquoi et où défaire le règlement ; l'achat reste.
    await p.evaluate(() => { location.hash = '#/achat/a1'; });
    await p.locator('#view h1').filter({ hasText: 'GS-118' }).waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#more-btn').click();
    await p.locator('#del').click();
    await expect.poll(() => p.locator('#toast').innerText().then(net)).toBe('GS-118 porte un règlement : retire-le d\'abord (« Actions » sur sa ligne, dans « Règlements »). Rien n\'a été supprimé.');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets).toEqual(expect.arrayContaining([expect.objectContaining({ collection: 'purchases', cle: 'a1' })]));

    // 3. La fiche d'un nouveau fournisseur, plus haute que l'écran (un portable de 700 px) : « Enregistrer » est à l'écran,
    //    sans défiler.
    await p.setViewportSize({ width: 1440, height: 700 });
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture d\'achat' }).waitFor({ timeout: 15_000 });
    await p.locator('[data-combo=supplierId] .combo-btn').click();
    await p.locator('[data-combo=supplierId] .combo-add').click();
    const enregistrer = p.locator('#modal-root .modal').last().getByRole('button', { name: 'Enregistrer', exact: true });
    await enregistrer.waitFor({ timeout: 10_000 });
    expect(await p.locator('#modal-root .modal').last().evaluate((m) => m.scrollHeight > m.clientHeight)).toBe(true);
    expect(await enregistrer.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom <= window.innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
    })).toBe(true);
    await p.keyboard.press('Escape');
    await p.setViewportSize({ width: 1440, height: 900 });

    // 4. La caisse, sans famille au Catalogue : la rangée « Tout » est là dès le premier ticket ; vendue une fois, « Favoris »
    //    s'y ajoute sans pousser les tuiles.
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '20' })).statut).toBe(200);
    await p.evaluate(() => { location.hash = '#/caisse'; });
    await expect.poll(() => p.locator('#cs-ouverte').count(), { timeout: 20_000 }).toBe(1);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    expect((await p.locator('#cs-familles [data-famille]').allInnerTexts()).map(net)).toEqual(['Tout']);
    const haut = () => p.locator('#cs-articles').evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const avant = await haut();
    await p.locator('#cs-articles .cs-art').filter({ hasText: 'Colle à bois' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=carte]').click();
    await p.locator('#cs-valider').click();
    await p.locator('#cs-nouvelle').click();
    await expect.poll(() => p.locator('#cs-familles [data-famille]').allInnerTexts().then((t) => t.map(net))).toEqual(['Favoris', 'Tout']);
    expect(await haut()).toBe(avant);
    await p.screenshot({ path: path.join(PHOTOS, 'recette-alpha-caisse.png') });
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture d\'achat' }).waitFor({ timeout: 15_000 });
    // 5. Une nouvelle facture d'achat, la date d'un clic puis au clavier : la frappe remplace la date du jour (elle s'y ajoutait : « Date incomprise »).
    const date = p.locator('#view .datefield .d-txt').first();
    const box = await date.boundingBox();
    await p.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.6, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await p.keyboard.type('01092026');
    await p.keyboard.press('Tab');
    expect(await date.inputValue()).toBe('01/09/2026');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
