// La recette « alpha » du 20/10/2026 (1.79.0 ; docs/recette.md), à la souris, chez un commerçant :
//   - la caisse : la rangée des familles est là dès le premier ticket ; la première vente ne pousse pas les tuiles ;
//   - une facture d'achat réglée ne se supprime pas : le refus dit pourquoi et où retirer le règlement ;
//   - une fenêtre plus haute que l'écran garde « Enregistrer » à l'écran ;
//   - l'invitation « Première fois sur cette page ? » ne revient pas quand la page se redessine sur place ;
//   - une date tapée après un clic dans sa case remplace celle qui y était ;
//   - au Stock, « Choisir dans le Catalogue » mène au geste ; aux Relances, « Relancer » est sur la ligne (1.80.0) ;
//   - Ctrl+S enregistre dans le navigateur ; la liste des devis dit « facturé » ; l'Aide ne promet que les raccourcis qui marchent ;
//   - une commande fournisseur crée son fournisseur sans quitter la pièce ;
//   - « Payer les salaires » : chaque RIB manquant a son bouton, qui dit de qui ;
//   - un avoir négatif ne s'émet pas : le refus vient avant la fenêtre d'émission ;
//   - « Partir d'une pièce existante » ne propose pas un ticket, et sa liste s'ouvre en entier (1.81.0).

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

  it('au Stock, « Choisir dans le Catalogue » ouvre le choix, puis la fiche suivie en stock, le curseur dans le stock de départ', async () => {
    const { jeton, ent } = await commerce();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-pick').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#st-pick').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Quel article suivre en stock ?');
    expect(p.url()).toMatch(/#\/stock$/);
    await fenetre.locator('[data-combo=astocker] .combo-btn').click();
    await fenetre.locator('.combo-it').filter({ hasText: 'Colle à bois' }).click();
    await fenetre.locator('#astocker-ok').click();
    const fiche = p.locator('#modal-root .modal').last();
    await expect.poll(() => fiche.locator('h2').innerText()).toBe('Suivre « Colle à bois » en stock');
    expect(await fiche.locator('input[name=tracked]').isChecked()).toBe(true);
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe('initialQty');
    await p.keyboard.press('Control+A');
    await p.keyboard.type('12');
    await fiche.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#view tr').filter({ hasText: 'Colle à bois' }).innerText().then(net), { timeout: 15_000 }).toMatch(/Colle à bois .*12 u/);
    // Un achat neuf : l'article pris au catalogue remplace la ligne vide du départ (elle s'enregistrait avec la pièce).
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture d\'achat' }).waitFor({ timeout: 15_000 });
    const lignes = () => p.locator('#view input[data-k=label]').count();
    expect(await lignes()).toBe(1);
    await p.locator('#b-cat .combo-btn').click();
    await p.locator('#b-cat .combo-it').filter({ hasText: 'Colle à bois' }).click();
    await expect.poll(() => p.locator('#view input[data-k=label]').evaluateAll((l) => l.map((x) => (x as HTMLInputElement).value))).toEqual(['Colle à bois']);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('aux Relances, chaque facture échue porte « Relancer » à côté d\'« Actions », et son numéro ne se coupe pas ; payée en partie, elle reste en retard partout', async () => {
    const { jeton, ent } = await commerce();
    const echue = new Date(Date.now() - 20 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const avant = new Date(Date.now() - 25 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac', email: 'compta@lac.exemple.tn' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', date: avant, dueDate: echue, clientId: 'c1', subject: 'Échafaudage',
        status: 'brouillon', lines: [{ label: 'Location', description: '', qty: 1, unit: '', unitPrice: { '~n': '850.5' }, vatRate: 19 }], discountRate: 0, applyStamp: false,
        withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1100, height: 800 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^Facture FAC-\d{4}-\d{3}$/);
    const numero = (await p.locator('#view h1').first().innerText()).replace('Facture ', '');
    await p.evaluate(() => { location.hash = '#/relances'; });
    const ligne = p.locator('#r-wrap tbody tr').filter({ hasText: numero });
    await ligne.waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // Le numéro tient sur une ligne, à côté de « Relancer » et d'« Actions ».
    expect(await ligne.locator('td').first().locator('a').evaluate((a) => a.getClientRects().length)).toBe(1);
    expect(await ligne.locator('.row-menu-btn').count()).toBe(1);
    await ligne.getByRole('button', { name: 'Relancer', exact: true }).click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe(`Relance — ${numero}`);
    expect(await fenetre.locator('input').first().inputValue()).toBe('compta@lac.exemple.tn');
    // Un règlement partiel depuis la ligne : la facture reste en retard, et l'accueil le dit comme les Relances.
    await p.keyboard.press('Escape');
    await ligne.locator('.row-menu-btn').click();
    await p.getByRole('menuitem').filter({ hasText: 'Paiement reçu' }).click();
    const paiement = p.locator('#modal-root .modal').last();
    await paiement.locator('[name=amount]').fill('100');
    await paiement.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#r-wrap tbody tr').filter({ hasText: numero }).innerText().then(net)).toMatch(/912,095 DT/);
    await p.evaluate(() => { location.hash = '#/'; });
    await expect.poll(() => p.locator('[data-stat=encaisser]').innerText().then(net), { timeout: 15_000 }).toMatch(/1 facture, 1 en retard/);
    await p.evaluate(() => { location.hash = '#/client/c1'; });
    await expect.poll(() => p.locator('#view .banner').first().innerText().then(net).catch(() => ''), { timeout: 15_000 }).toMatch(/^1 facture en retard — 912,095 DT/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('Ctrl+S enregistre un devis, la liste dit « facturé », l\'Aide ne promet que les raccourcis qui marchent', async () => {
    const { jeton, ent } = await commerce();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', number: 'DEV-2026-041', date: aujourdhui, validUntil: aujourdhui, clientId: 'c1',
        subject: 'Rayonnages', status: 'accepté', lines: [{ label: 'Rayonnage', description: '', qty: 2, unit: '', unitPrice: { '~n': '312.25' }, vatRate: 19 }], discountRate: 0,
        applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    // 1. Un devis neuf, enregistré au clavier : le navigateur n'ouvre pas « Enregistrer la page », le devis prend son numéro.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/devis`);
    const objet = p.getByPlaceholder('Ce que couvre cette pièce, en une phrase');
    await objet.waitFor({ timeout: 20_000 });
    await objet.fill('Vitrine');
    await p.getByPlaceholder('Désignation').first().fill('Vitrine éclairée');
    await p.keyboard.press('Control+s');
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^Devis DEV-\d{4}-\d{3}$/);
    // 2. Le devis accepté devient une facture émise : la liste le dit « facturé », le devis neuf ne dit rien.
    await p.evaluate(() => { location.hash = '#/doc/d1'; });
    await p.getByRole('button', { name: /^Facturer/ }).first().click({ timeout: 15_000 });
    // (la base des tests n'a pas de timbre daté : la facture s'émet sans lui)
    await p.getByRole('checkbox', { name: /Timbre fiscal/ }).uncheck({ timeout: 15_000 });
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 15_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^Facture FAC-\d{4}-\d{3}$/);
    await p.evaluate(() => { location.hash = '#/devis'; });
    const ligne = p.locator('#view tbody tr').filter({ hasText: 'DEV-2026-041' });
    await expect.poll(() => ligne.innerText().then(net), { timeout: 15_000 }).toMatch(/accepté facturé/);
    expect(await p.locator('#view tbody tr').filter({ hasText: 'Vitrine' }).innerText().then(net)).not.toMatch(/facturé/);
    // 3. L'Aide ne promet plus Ctrl+N ni Ctrl+1 à 9 (le navigateur les garde) ; elle garde Ctrl+S.
    await p.evaluate(() => { location.hash = '#/aide/raccourcis'; });
    const aide = p.locator('#view table.keys');
    await aide.waitFor({ timeout: 15_000 });
    expect(await aide.innerText()).toMatch(/Enregistrer/);
    expect(await aide.innerText()).not.toMatch(/Nouveau devis\s/);
    expect(await aide.innerText()).not.toMatch(/Trésorerie/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('une commande fournisseur crée son fournisseur sans quitter la pièce, et le prend', async () => {
    const { jeton, ent } = await commerce();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/commandef/new`);
    const choix = p.locator('[data-combo=supplierId]');
    await choix.locator('.combo-btn').click({ timeout: 20_000 });
    await choix.locator('.combo-q').fill('Electro Sfax');
    await expect.poll(() => choix.locator('.combo-add').innerText().then(net)).toBe('+ Nouveau fournisseur « Electro Sfax »');
    await choix.locator('.combo-add').click();
    const fiche = p.locator('#modal-root .modal').last();
    await expect.poll(() => fiche.locator('h2').innerText()).toBe('Nouveau fournisseur');
    await fiche.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => choix.locator('.combo-val').innerText(), { timeout: 10_000 }).toBe('Electro Sfax');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('« Payer les salaires » : chaque RIB manquant a son bouton, qui dit de qui', async () => {
    const { jeton, ent } = await commerce();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Nadia Gharbi', contract: 'CDI', hireDate: '2026-01-01', grossSalary: { '~n': '1250.75' },
        method: 'virement', iban: '', headOfFamily: false, children: 0 } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-gen').click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await p.getByRole('button', { name: /^Payer les salaires/ }).click({ timeout: 15_000 });
    const fenetre = p.locator('#modal-root .modal').last();
    // Le salarié a son bouton sous sa phrase ; celui du compte dit qu'il est celui du compte.
    await expect.poll(() => fenetre.locator('#ps-hors').innerText().then(net)).toMatch(/Nadia Gharbi \(RIB à renseigner\)\. Renseigner le RIB de Nadia Gharbi…$/);
    expect(await fenetre.locator('#ps-compte-go').innerText()).toBe('Renseigner le RIB du compte…');
    await fenetre.getByRole('button', { name: 'Renseigner le RIB de Nadia Gharbi…', exact: true }).click();
    const fiche = p.locator('#modal-root .modal').last();
    await expect.poll(() => fiche.locator('h2').first().innerText()).toBe('Modifier le salarié');
    await fiche.locator('[name=iban]').fill('08006000000012345663');
    await fiche.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    // La fenêtre revient comme on l'a laissée, le salarié dans l'ordre de virement.
    await expect.poll(() => p.locator('#modal-root .modal').last().locator('h2').first().innerText(), { timeout: 10_000 }).toMatch(/^Payer les salaires/);
    expect(await p.locator('#modal-root .modal').last().locator('#ps-hors').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('un avoir négatif ne s\'émet pas : le refus vient avant la fenêtre d\'émission', async () => {
    const { jeton, ent } = await commerce();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', date: aujourdhui, dueDate: aujourdhui, clientId: 'c1', subject: 'Rayonnages',
        status: 'brouillon', lines: [{ label: 'Pose', description: '', qty: 1, unit: '', unitPrice: 100, vatRate: 19 }, { label: 'Remise accordée', description: '', qty: 1, unit: '', unitPrice: -30, vatRate: 19 }],
        discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^Facture FAC-\d{4}-\d{3}$/);
    await p.getByRole('button', { name: 'Corriger par un avoir…', exact: true }).click();
    const prix = p.locator('#lines [data-k=unitPrice]').first();
    await prix.waitFor({ timeout: 15_000 });
    await prix.fill('10');
    await prix.press('Tab');
    await p.getByRole('button', { name: 'Émettre l\'avoir', exact: true }).click();
    // Le refus dit le montant et la raison ; aucune fenêtre « Émettre l'avoir ? » ne s'ouvre, rien n'est numéroté.
    await expect.poll(() => p.locator('#toast').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toMatch(/^Cet avoir fait − ?23,800 DT : un avoir rend de l'argent, son montant est positif\./);
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(await p.locator('#view h1').first().innerText()).toMatch(/^Nouvel avoir/);
    // Deux phrases restent le temps de se lire : encore là après 3,5 s (un message court part à 2,6 s).
    await p.waitForTimeout(3500);
    expect(await p.locator('#toast').getAttribute('class')).toMatch(/\bshow\b/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('« Partir d\'une pièce existante » ne propose pas un ticket, et sa liste s\'ouvre en entier dans la fenêtre', async () => {
    const { jeton, ent } = await commerce();
    const devis = (id: string, n: number) => ({ collection: 'documents', cle: id, rang: n, revision: null, contenu: { id, type: 'devis', number: `DEV-2026-04${n}`, date: aujourdhui,
      validUntil: aujourdhui, clientId: 'c1', subject: `Lot ${n}`, status: 'accepté', lines: [{ label: 'Rayonnage', description: '', qty: n, unit: '', unitPrice: { '~n': '31.25' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac' } },
      devis('d1', 1), devis('d2', 2), devis('d3', 3), devis('d4', 4),
      { collection: 'documents', cle: 't1', rang: 9, revision: null, contenu: { id: 't1', type: 'facture', ticket: true, number: '', date: aujourdhui, clientId: '', status: 'brouillon',
        lines: [{ label: 'Vis', description: '', qty: 1, unit: '', unitPrice: 15, vatRate: 19 }], discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/autres/livraison`);
    await p.getByRole('button', { name: 'Partir d\'une pièce existante', exact: true }).click({ timeout: 20_000 });
    const choix = p.locator('#modal-root [data-combo=depuis]');
    await choix.locator('.combo-btn').click();
    const items = choix.locator('.combo-it');
    await expect.poll(() => items.count()).toBe(4);
    expect((await items.allInnerTexts()).every((t) => /^DEV-2026-04\d — Devis — Hôtel du Lac — /.test(net(t)))).toBe(true);
    // Le dernier article se voit et se clique : la fenêtre ne coupe pas la liste ouverte.
    const dernier = items.last();
    expect(await dernier.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el.querySelector('.ci-main') || document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.combo-it') === el; })).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
