// La Comptabilité de l'entreprise, 1.303.0 : l'avertissement « période validée par ton cabinet » dans les autres saisies, et
// l'opération diverse du client qui arrive enfin chez son cabinet. Joué comme le grossiste de 1.301.0 et 1.302.0 (« Hygiène
// Plus Sahel », Sousse) et sa comptable au Cabinet Ennour, septembre validé : fin octobre, on découvre ce que septembre a
// oublié. Une facture restée en brouillon, émise à la souris ; le paiement d'une facture noté à sa vraie date ; le règlement
// d'un achat, puis deux autres réglés d'un seul virement ; l'assurance du local avancée par le gérant, saisie en opération diverse. Chaque fois la phrase avant, « Le dire
// à mon comptable » après, et chez la comptable l'écriture au 1er octobre, le premier jour encore ouvert. Un paiement rouvert
// sans rien changer ne redit rien ; une entreprise sans cabinet n'en voit rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'compta-1303.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('la Comptabilité 1.303.0 : la période validée par le cabinet dite partout où l\'on saisit, l\'opération diverse jusqu\'au cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compta-1303-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'compta-1303.txt'), '');
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  // La date d'un formulaire (le champ à la française, puis Tab) : celle de la fenêtre ou de la page qu'on nomme.
  const dater = async (p: Page, conteneur: string, jour: string) => {
    const champ = p.locator(`${conteneur} .datefield`).filter({ has: p.locator('input[name=date]') }).locator('.d-txt');
    await champ.fill(jour);
    await champ.press('Tab');
  };
  const n = (x: string) => ({ '~n': x });
  const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
  const facture = (id: string, date: string, clientId: string, lignes: [string, number, number][]) => ({
    id, type: 'facture', number: '', status: 'brouillon', date, dueDate: date, clientId, createdAt: 10,
    subject: 'Produits d\'entretien', lines: lignes.map(([label, qty, prix]) => ({ label, description: '', qty: n(String(qty)), unit: '', unitPrice: n(prix.toFixed(3)), vatRate: 19 })),
    discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [],
  });
  const netAPayer = (lignes: [string, number, number][]) => C.computeTotals({ type: 'facture', discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, currency: 'DT',
    lines: lignes.map(([label, qty, prix]) => ({ label, qty, unitPrice: prix, vatRate: 19 })) }, co).netToPay as number;
  // Ce que la comptable lit d'une pièce dans ses livres (sa page de journal filtrée par le numéro).
  const ecrituresDe = async (ent: string, jeton: string, piece: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=${encodeURIComponent(piece)}`, jeton)).corps.ecritures as Obj[] ?? [])
    .map((e) => ({ journal: e.journal, date: e.date, statut: e.statut, type: e.origine.type, lignes: (e.lignes as Obj[]).map((l) => `${l.compte} ${l.debit} ${l.credit}`) }));
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const message = async (p: Page) => {
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/comptable');
    await expect.poll(async () => net(await p.locator('#msg-racine textarea').first().inputValue().catch(() => '')), { timeout: 15_000 }).not.toBe('');
    return net(await p.locator('#msg-racine textarea').first().inputValue());
  };

  it('fin octobre, le grossiste rattrape septembre : chaque saisie le dit, et la comptable lit tout au 1er octobre', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, mourad);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // Septembre : un achat non réglé, une facture émise non payée, une facture restée en brouillon.
    const lignesA4: [string, number, number][] = [['Cartons et film', 1, 1000]];
    const achat = (id: string, number: string, date: string, dueDate: string, lignes: [string, number, number][]) => ({ id, kind: 'facture', number, date, dueDate, supplierId: 's2', currency: 'DT', fees: 0, withholdingRate: 0,
      category: 'Emballages', createdAt: 5, attachments: [], payments: [], lines: lignes.map(([label, qty, prix]) => ({ label, qty: n(String(qty)), unitPrice: n(prix.toFixed(3)), vatRate: 19, destination: 'charge' })) });
    const achatA4 = achat('a4', 'EC-4410', '2026-09-22', '2026-10-22', lignesA4);
    // Deux autres achats du même fournisseur, réglés ensemble d'un seul virement le 30/09.
    const achatA5 = achat('a5', 'EC-4418', '2026-09-25', '2026-10-25', [['Film étirable, 20 rouleaux', 20, 12.375]]);
    const achatA6 = achat('a6', 'EC-4423', '2026-09-28', '2026-10-28', [['Étiquettes adhésives', 3, 48.125]]);
    const resteAchat = (a: Obj) => C.purchaseTotals({ ...a, lines: (a.lines as Obj[]).map((l) => ({ ...l, qty: Number(l.qty['~n']), unitPrice: Number(l.unitPrice['~n']) })) }, co).netToPay as number;
    const lignesF5: [string, number, number][] = [['Produits d\'entretien, lot café', 1, 412.5]];
    const lignesD6: [string, number, number][] = [['Gants nitrile, boîte de 100', 40, 14.65]];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Emballages du Centre', paymentTermsDays: 30 } },
      ...[['c1', 'Hôtel Marhaba Palace'], ['c2', 'Clinique Les Oliviers'], ['c3', 'Café des Arts']].map(([id, name]) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: { id, name, city: 'Sousse' } })),
      { collection: 'purchases', cle: 'a4', rang: 0, revision: null, contenu: achatA4 },
      { collection: 'purchases', cle: 'a5', rang: 0, revision: null, contenu: achatA5 },
      { collection: 'purchases', cle: 'a6', rang: 0, revision: null, contenu: achatA6 },
    ] })).statut).toBe(200);
    const e5 = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: facture('f5', '2026-09-24', 'c3', lignesF5), client: { id: 'c3', name: 'Café des Arts', city: 'Sousse' }, revision: null, rang: 30, netAPayer: netAPayer(lignesF5).toFixed(3) })).corps;
    const numF5 = String((e5.contenu as Obj | undefined)?.number ?? JSON.stringify(e5));
    expect(numF5).toMatch(/^FAC-/);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: 'documents', cle: 'd6', rang: 31, revision: null, contenu: facture('d6', '2026-09-29', 'c2', lignesD6) }] })).statut).toBe(200);
    // La comptable valide septembre dans ses livres.
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: '2026-09-30' })).statut).toBe(200);

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `compta-1303-${nom}.png`), fullPage: true });
    const fenetre = '#modal-root';

    // ── A. La facture restée en brouillon, émise : la fenêtre d'émission le dit, le message après offre de le lui dire ──
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d6`);
    await p.locator('#issue').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Le temps de lire jusqu'où le cabinet a validé (la conversation, puis ses livres) : rien ne se bloque en attendant.
    await p.waitForTimeout(1500);
    await p.locator('#issue').click();
    await p.locator(`${fenetre} #em-avert`).waitFor({ timeout: 10_000 });
    const avertEmission = net(await p.locator(`${fenetre} #em-avert`).innerText());
    noter('EMISSION', avertEmission);
    expect(avertEmission).toContain('Cette facture est datée du 29/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, elle s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'émettant, tu pourras le lui dire.');
    await photo(p, 'emission');
    for (const c of await p.locator(`${fenetre} [data-apres]:checked`).all()) await c.uncheck();
    await p.locator(`${fenetre} #ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toMatch(/^Facture FAC-\S+ émise — dans la période que ton cabinet a validée Le dire à mon comptable$/);
    const numD6 = (await toast(p)).split(' ')[1] ?? '';
    await p.locator('#toast-undo').click();
    const texteEmission = await message(p);
    noter('MESSAGE EMISSION', texteEmission);
    expect(texteEmission).toBe(`Bonjour, je viens d'émettre la facture ${numD6} datée du 29/09/2026 (Clinique Les Oliviers, ${net(C.money(netAPayer(lignesD6), 'DT'))}) : elle tombe dans la période que tu as validée jusqu'au 30/09/2026, elle s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    // Chez la comptable : la vente au 1er octobre, au brouillard, jamais dans le mois validé.
    await expect.poll(() => ecrituresDe(ent, leila, numD6), { timeout: 10_000 }).toEqual([expect.objectContaining({ journal: 'VT', date: '2026-10-01', statut: 'brouillard', type: 'vente' })]);

    // ── B. Le paiement de la facture de septembre, noté à sa vraie date ──
    await p.evaluate(() => { location.hash = '#/doc/f5'; });
    await p.locator('#pay').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #pf2`).waitFor({ timeout: 10_000 });
    // Daté d'aujourd'hui : rien à dire.
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #pf-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #pf2`, '29/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #pf-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #pf-valide`).innerText())).toBe('Ce paiement est daté du 29/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, il s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'paiement');
    expect(await p.locator(`${fenetre} #ok`).isEnabled()).toBe(true);
    await p.locator(`${fenetre} #ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`${numF5} payée intégralement — dans la période que ton cabinet a validée Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const textePaiement = await message(p);
    noter('MESSAGE PAIEMENT', textePaiement);
    expect(textePaiement).toBe(`Bonjour, je viens d'enregistrer un paiement daté du 29/09/2026 (facture ${numF5}, Café des Arts, ${net(C.money(netAPayer(lignesF5), 'DT'))}) : il tombe dans la période que tu as validée jusqu'au 30/09/2026, il s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    // Celui-là, on l'envoie : il arrive dans la conversation du cabinet.
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).includes(textePaiement),
      { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await ecrituresDe(ent, leila, numF5)).filter((e) => e.type === 'encaissement'), { timeout: 10_000 })
      .toEqual([expect.objectContaining({ date: '2026-10-01', statut: 'brouillard' })]);

    // ── E. Le même paiement rouvert sans rien changer : rien à redire ; sa date touchée, la correction se dit ──
    await p.evaluate(() => { location.hash = '#/doc/f5'; });
    await p.locator('tr', { hasText: '29/09/2026' }).locator('.row-menu-btn').first().click({ timeout: 15_000 });
    await p.getByRole('menuitem', { name: /Modifier ce paiement/ }).click();
    await p.locator(`${fenetre} #pf2`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #pf-valide`).isVisible()).toBe(false);
    // La référence ne change rien chez le comptable : toujours rien.
    await p.locator(`${fenetre} #pf2 input[name=reference]`).fill('VIR-0929');
    await p.waitForTimeout(300);
    expect(await p.locator(`${fenetre} #pf-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #pf2`, '28/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #pf-valide`).isVisible(), { timeout: 5_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #pf-valide`).innerText())).toBe('Ce paiement est daté du 28/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, la correction s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await dater(p, `${fenetre} #pf2`, '29/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #pf-valide`).isVisible(), { timeout: 5_000 }).toBe(false);
    // On renonce : la fenêtre demande avant de jeter la référence tapée.
    await p.locator(`${fenetre} [data-close]`).first().click();
    await p.getByRole('button', { name: 'Abandonner la saisie', exact: true }).click({ timeout: 5_000 });
    await expect.poll(async () => p.locator(`${fenetre} #pf2`).count(), { timeout: 5_000 }).toBe(0);

    // ── C. Le règlement de l'achat de septembre ──
    await p.evaluate(() => { location.hash = '#/achat/a4'; });
    await p.locator('#pay').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #spf`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #spf-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #spf`, '25/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #spf-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #spf-valide`).innerText())).toBe('Ce règlement est daté du 25/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, il s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'reglement');
    await p.locator(`${fenetre} #ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe('Règlement enregistré — dans la période que ton cabinet a validée Le dire à mon comptable');
    await expect.poll(async () => (await ecrituresDe(ent, leila, 'EC-4410')).filter((e) => e.type === 'reglement_fournisseur'), { timeout: 10_000 })
      .toEqual([expect.objectContaining({ date: '2026-10-01', statut: 'brouillard' })]);

    // ── C bis. Les deux autres achats du même fournisseur, réglés ensemble d'un seul virement le 30/09 ──
    await p.evaluate(() => { location.hash = '#/achats'; });
    for (const id of ['a5', 'a6']) await p.locator(`#list-wrap tr[data-id="${id}"] input[data-x]`).click({ timeout: 15_000 });
    await expect.poll(() => p.locator('#bc-regler').isDisabled(), { timeout: 10_000 }).toBe(false);
    await p.locator('#bc-regler').click();
    await p.locator(`${fenetre} #rge`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #rge-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #rge`, '30/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #rge-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #rge-valide`).innerText())).toBe('Ce virement est daté du 30/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, il s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'virement-groupe');
    await p.locator(`${fenetre} #ok`).click();
    const virement = net(C.money(resteAchat(achatA5) + resteAchat(achatA6), 'DT'));
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Règlement de ${virement} enregistré sur 2 pièces — dans la période que ton cabinet a validée Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteVirement = await message(p);
    noter('MESSAGE VIREMENT', texteVirement);
    expect(texteVirement).toBe(`Bonjour, je viens d'enregistrer un virement daté du 30/09/2026 (Emballages du Centre, EC-4418, EC-4423, ${virement}) : il tombe dans la période que tu as validée jusqu'au 30/09/2026, il s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    for (const piece of ['EC-4418', 'EC-4423']) {
      await expect.poll(async () => (await ecrituresDe(ent, leila, piece)).filter((e) => e.type === 'reglement_fournisseur'), { timeout: 10_000 })
        .toEqual([expect.objectContaining({ date: '2026-10-01', statut: 'brouillard' })]);
    }

    // ── D. L'assurance du local avancée par le gérant, en opération diverse ──
    await p.evaluate(() => { location.hash = '#/compta'; });
    await p.locator('#c-tabs [data-tab="ecritures"]').click({ timeout: 15_000 });
    await p.locator('#ecr-od').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #odf`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #od-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #odf`, '30/09/2026');
    await p.locator(`${fenetre} #odf input[name=label]`).fill('Assurance du local, avancée par le gérant');
    const lignesOd = p.locator(`${fenetre} #od-lignes tbody tr`);
    await lignesOd.nth(0).locator('.od-compte').fill('616');
    await lignesOd.nth(0).locator('.od-debit').fill('845.300');
    await lignesOd.nth(1).locator('.od-compte').fill('4421');
    await lignesOd.nth(1).locator('.od-credit').fill('845.300');
    await expect.poll(async () => p.locator(`${fenetre} #od-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #od-valide`).innerText())).toBe('Cette opération est datée du 30/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, elle s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    expect(net(await p.locator(`${fenetre} #od-ecart`).innerText())).toBe('Débit = crédit : l\'écriture tombe juste.');
    await photo(p, 'operation-diverse');
    await p.locator(`${fenetre} #od-ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toMatch(/^OD-2026-\d{3} enregistrée — dans la période que ton cabinet a validée Le dire à mon comptable$/);
    const numOd = (await toast(p)).split(' ')[0] ?? '';
    await p.locator('#toast-undo').click();
    const texteOd = await message(p);
    noter('MESSAGE OD', texteOd);
    expect(texteOd).toBe(`Bonjour, je viens d'enregistrer l'opération diverse ${numOd} « Assurance du local, avancée par le gérant » datée du 30/09/2026 (845,300 DT) : elle tombe dans la période que tu as validée jusqu'au 30/09/2026, elle s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    await photo(p, 'operation-diverse-dite');
    // Le pont : avant 1.303.0, l'opération restait dans le livre du client et le cabinet ne la voyait jamais.
    await expect.poll(() => ecrituresDe(ent, leila, numOd), { timeout: 10_000 })
      .toEqual([{ journal: 'OD', date: '2026-10-01', statut: 'brouillard', type: 'operation_diverse', lignes: ['616 845.300 0.000', '4421 0.000 845.300'] }]);

    // ── Au Cabinet : la comptable lit l'opération du client dans son journal, au 1er octobre ──
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/2026`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check();
    // Le journal écrit la date et la pièce sur la première ligne d'une écriture : on lit celle-là et la suivante.
    const lirePiece = () => c.evaluate((piece) => {
      const tr = [...document.querySelectorAll('#c-livres tbody tr')];
      const i = tr.findIndex((x) => (x.textContent ?? '').includes(piece));
      return i < 0 ? [] : tr.slice(i, i + 2).map((x) => [...x.children].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
    }, numOd);
    await expect.poll(async () => (await lirePiece()).length, { timeout: 15_000 }).toBe(2);
    const vuesCabinet = await lirePiece();
    noter('CABINET OD', vuesCabinet);
    expect(vuesCabinet[0]).toMatch(/01\/10\/2026/);
    expect(vuesCabinet[0]).toMatch(/\b616\b/);
    expect(vuesCabinet[0]).toMatch(/845,300/);
    expect(vuesCabinet[1]).toMatch(/\b4421\b/);
    expect(vuesCabinet[1]).toMatch(/845,300/);
    await c.screenshot({ path: path.join(PHOTOS, 'compta-1303-cabinet-journal.png'), fullPage: true });

    // ── F. Une entreprise sans cabinet : l'opération de septembre ne dit rien ──
    const sami = await personne('sami');
    const ent2 = String((await api('POST', '/entreprises-essai', sami)).corps.id);
    await api('GET', `/entreprises/${ent2}/dossier-v10`, sami);
    const sx = await contexte(sami);
    const s = await sx.newPage();
    s.on('pageerror', (x) => erreurs.push(`sans cabinet : ${x.message}`));
    await s.goto(`${serveur.adresse}/v10/?e=${ent2}#/compta`);
    await s.locator('#c-tabs').waitFor({ timeout: 30_000 });
    await plusTard(s);
    await s.locator('#c-tabs [data-tab="ecritures"]').click();
    await s.locator('#ecr-od').click({ timeout: 15_000 });
    await dater(s, `${fenetre} #odf`, '15/09/2026');
    await s.waitForTimeout(800);
    expect(await s.locator(`${fenetre} #od-valide`).count()).toBe(1);
    expect(await s.locator(`${fenetre} #od-valide`).isVisible()).toBe(false);

    expect(erreurs).toEqual([]);
    await cx.close(); await cxC.close(); await sx.close();
  }, 300_000);
});
