// La Comptabilité de l'entreprise, 1.304.0 : la période validée par le cabinet dite aussi dans la trésorerie, et quand on
// SUPPRIME ce qui y tombait. Joué comme le grossiste de 1.301.0 à 1.303.0 (« Hygiène Plus Sahel », Sousse) et sa comptable au
// Cabinet Ennour, septembre validé jusqu'au 30/09 : début novembre, on fait le ménage. Un impôt payé le 20/09 et jamais noté,
// saisi dans la trésorerie puis corrigé ; des frais bancaires saisis deux fois, supprimés ; un paiement noté par erreur sur une
// facture, un règlement de fournisseur, un achat saisi à tort, une opération diverse en double : supprimés. Chaque fois la
// phrase avant (« son annulation s'écrira au 01/10/2026 »), « Le dire à mon comptable » après, et chez la comptable la
// contre-passation au 1er octobre, jamais dans le mois validé. Ce qui tombe en octobre, et une entreprise sans cabinet, n'en
// disent rien.

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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'compta-1304.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('la Comptabilité 1.304.0 : la période validée par le cabinet dite dans la trésorerie et quand on supprime', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compta-1304-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'compta-1304.txt'), '');
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

  // La fenêtre du dessus (une question posée par-dessus la fenêtre d'un mouvement).
  const dessus = (q: Page) => q.locator('#modal-root > .modal-bg').last();
  const PHRASE = 'dans la période que ton cabinet a validée';
  const annulation = (jour: string, sujet: string, fem = false) => `${sujet} est daté${fem ? 'e' : ''} du ${jour}, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : chez lui, son annulation s'écrira au 01/10/2026, le premier jour encore ouvert.`;
  const dit = (quoi: string, fem = false) => `Bonjour, je viens de supprimer ${quoi} : ${fem ? 'elle' : 'il'} tombait dans la période que tu as validée jusqu'au 30/09/2026, son annulation s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`;
  // Ce que la comptable lit après une suppression : l'écriture validée reste à sa date, sa contre-passation vient au 1er octobre.
  const annuleeChezLeCabinet = (date: string, type: string) => [
    expect.objectContaining({ date, statut: 'validee', type }),
    expect.objectContaining({ date: '2026-10-01', statut: 'brouillard', type: 'contre_passation' }),
  ];
  const parDate = (l: Obj[]) => [...l].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  it('début novembre, le grossiste fait le ménage dans septembre : chaque geste le dit avant, et la comptable lit chaque annulation au 1er octobre', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, mourad);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // Septembre, tel que le cabinet l'a validé : la banque, des frais saisis deux fois (le 10, l'un des deux est de trop), une
    // assurance passée deux fois en opération diverse, un achat réglé, un achat saisi à tort, une facture payée.
    const achat = (id: string, number: string, date: string, dueDate: string, lignes: [string, number, number][]) => ({ id, kind: 'facture', number, date, dueDate, supplierId: 's2', currency: 'DT', fees: 0, withholdingRate: 0,
      category: 'Emballages', createdAt: 5, attachments: [], payments: [] as Obj[], lines: lignes.map(([label, qty, prix]) => ({ label, qty: n(String(qty)), unitPrice: n(prix.toFixed(3)), vatRate: 19, destination: 'charge' })) });
    const resteAchat = (a: Obj) => C.purchaseTotals({ ...a, lines: (a.lines as Obj[]).map((l) => ({ ...l, qty: Number(l.qty['~n']), unitPrice: Number(l.unitPrice['~n']) })) }, co).netToPay as number;
    const achatA4 = achat('a4', 'EC-4410', '2026-09-22', '2026-10-22', [['Cartons et film', 1, 1000]]);
    const regleA4 = resteAchat(achatA4);
    achatA4.payments = [{ id: 'r-a4', date: '2026-09-25', amount: n(regleA4.toFixed(3)), method: 'virement', reference: 'VIR-0925' }];
    const achatA7 = achat('a7', 'EC-4402', '2026-09-18', '2026-10-18', [['Cartons, saisis à tort (c\'était le devis)', 50, 3.875]]);
    const mouvement = (id: string, date: string, montant: string, label: string, reference: string) => ({ id, date, kind: 'banque', amount: n(montant), accountId: 'k-banque', method: 'virement', label, reference });
    const od = { id: 'o1', date: '2026-09-12', piece: 'OD-2026-001', journal: 'OD', label: 'Assurance du véhicule, saisie deux fois',
      lignes: [{ compte: '616', label: 'Assurance du véhicule', debit: n('612.500'), credit: 0 }, { compte: '4421', label: 'Avancée par le gérant', debit: 0, credit: n('612.500') }] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT Sousse', kind: 'banque', bank: 'BIAT', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Emballages du Centre', paymentTermsDays: 30 } },
      { collection: 'clients', cle: 'c3', rang: 0, revision: null, contenu: { id: 'c3', name: 'Café des Arts', city: 'Sousse' } },
      { collection: 'purchases', cle: 'a4', rang: 0, revision: null, contenu: achatA4 },
      { collection: 'purchases', cle: 'a7', rang: 0, revision: null, contenu: achatA7 },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null, contenu: mouvement('m1', '2026-09-10', '18.450', 'Frais de tenue de compte, saisis deux fois', 'FRAIS-0910') },
      { collection: 'movements', cle: 'm2', rang: 0, revision: null, contenu: mouvement('m2', '2026-10-15', '9.200', 'Frais d\'octobre, saisis deux fois', 'FRAIS-1015') },
      { collection: 'ecrituresOD', cle: 'o1', rang: 0, revision: null, contenu: od },
    ] })).statut).toBe(200);
    const lignesF5: [string, number, number][] = [['Produits d\'entretien, lot café', 1, 412.5]];
    const netF5 = netAPayer(lignesF5);
    const e5 = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: facture('f5', '2026-09-24', 'c3', lignesF5), client: { id: 'c3', name: 'Café des Arts', city: 'Sousse' }, revision: null, rang: 30, netAPayer: netF5.toFixed(3) })).corps;
    const numF5 = String((e5.contenu as Obj | undefined)?.number ?? JSON.stringify(e5));
    expect(numF5).toMatch(/^FAC-/);
    // Le 26/09, un paiement noté par erreur : c'était un autre client qui avait payé.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: 'documents', cle: 'f5', rang: 30, revision: Number(e5.revision),
      contenu: { ...(e5.contenu as Obj), payments: [{ id: 'p-f5', date: '2026-09-26', amount: n(netF5.toFixed(3)), method: 'virement', reference: 'VIR-0926' }] } }] })).statut).toBe(200);
    // La comptable valide septembre dans ses livres : tout ce qui précède y est validé.
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: '2026-09-30' })).statut).toBe(200);
    expect(await ecrituresDe(ent, leila, 'FRAIS-0910')).toEqual([expect.objectContaining({ date: '2026-09-10', statut: 'validee', type: 'mouvement' })]);
    expect(await ecrituresDe(ent, leila, 'OD-2026-001')).toEqual([expect.objectContaining({ date: '2026-09-12', statut: 'validee', type: 'operation_diverse' })]);

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `compta-1304-${nom}.png`), fullPage: true });
    const fenetre = '#modal-root';
    const mouvements = async () => {
      await p.evaluate(() => { location.hash = '#/tresorerie'; });
      await p.locator('#t-tabs [data-tab="mouvements"]').click({ timeout: 20_000 });
      if (await p.locator('#t-year').count()) await p.locator('#t-year').selectOption('2026');
    };
    const ligneMouvement = (texte: string) => p.locator('#t-body tr[data-mv]').filter({ hasText: texte }).first();

    // ── A. L'impôt payé le 20/09 et jamais noté : la trésorerie le dit pendant la saisie, le message après ──
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await p.locator('#new-move').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Le temps de lire jusqu'où le cabinet a validé : rien ne se bloque en attendant.
    await p.waitForTimeout(1500);
    await p.locator('#new-move').click();
    await p.locator(`${fenetre} #mf2`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    // Daté d'aujourd'hui : rien à dire.
    expect(await p.locator(`${fenetre} #mf-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #mf2`, '20/09/2026');
    await p.locator(`${fenetre} #mf2 select[name=kind]`).selectOption('impot');
    await p.locator(`${fenetre} #mf2 input[name=amount]`).fill('1286.400');
    await p.locator(`${fenetre} #mf2 input[name=label]`).fill('Retenues à la source d\'août');
    await p.locator(`${fenetre} #mf2 input[name=reference]`).fill('RS-0826');
    await expect.poll(async () => p.locator(`${fenetre} #mf-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    const avertMouvement = net(await p.locator(`${fenetre} #mf-valide`).innerText());
    noter('MOUVEMENT', avertMouvement);
    expect(avertMouvement).toBe('Ce mouvement est daté du 20/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, il s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'mouvement');
    await p.locator(`${fenetre} #ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Mouvement enregistré — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteMouvement = await message(p);
    noter('MESSAGE MOUVEMENT', texteMouvement);
    expect(texteMouvement).toBe(`Bonjour, je viens d'enregistrer un mouvement daté du 20/09/2026 (Retenues à la source d'août, ${net(C.money(1286.4, 'DT'))}) : il tombe dans la période que tu as validée jusqu'au 30/09/2026, il s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    await expect.poll(() => ecrituresDe(ent, leila, 'RS-0826'), { timeout: 10_000 }).toEqual([expect.objectContaining({ journal: 'BQ', date: '2026-10-01', statut: 'brouillard', type: 'mouvement' })]);

    // ── A bis. Rouvert sans rien changer : rien ; le libellé touché : rien ; le montant corrigé : la correction se dit ──
    await mouvements();
    await ligneMouvement('Retenues à la source').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #mf2`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #mf-valide`).isVisible()).toBe(false);
    await p.locator(`${fenetre} #mf2 input[name=label]`).fill('Retenues à la source d\'août 2026');
    await p.waitForTimeout(300);
    expect(await p.locator(`${fenetre} #mf-valide`).isVisible()).toBe(false);
    await p.locator(`${fenetre} #mf2 input[name=amount]`).fill('1312.600');
    await expect.poll(async () => p.locator(`${fenetre} #mf-valide`).isVisible(), { timeout: 5_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #mf-valide`).innerText())).toBe('Ce mouvement est daté du 20/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, la correction s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await p.locator(`${fenetre} #ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Mouvement modifié — ${PHRASE} Le dire à mon comptable`);
    await expect.poll(async () => JSON.stringify(await ecrituresDe(ent, leila, 'RS-0826')), { timeout: 10_000 }).toContain('1312.600');
    expect(await ecrituresDe(ent, leila, 'RS-0826')).toEqual([expect.objectContaining({ date: '2026-10-01', statut: 'brouillard' })]);

    // ── B. Les frais du 10/09 saisis deux fois : la question dit l'annulation chez le cabinet, le message part ──
    await mouvements();
    await ligneMouvement('Frais de tenue de compte').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #mf2`).waitFor({ timeout: 10_000 });
    await p.locator(`${fenetre} #del-mv`).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('10/09/2026', 'Il'));
    await photo(p, 'suppression-mouvement');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Mouvement supprimé — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteFrais = await message(p);
    noter('MESSAGE FRAIS', texteFrais);
    expect(texteFrais).toBe(dit(`un mouvement daté du 10/09/2026 (Frais de tenue de compte, saisis deux fois, ${net(C.money(18.45, 'DT'))})`));
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).includes(texteFrais),
      { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => parDate(await ecrituresDe(ent, leila, 'FRAIS-0910')), { timeout: 10_000 }).toEqual(annuleeChezLeCabinet('2026-09-10', 'mouvement'));

    // ── B bis. Les frais d'octobre, saisis deux fois aussi : octobre est ouvert, la question n'en dit rien ──
    await mouvements();
    await ligneMouvement('Frais d\'octobre').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #mf2`).waitFor({ timeout: 10_000 });
    await p.locator(`${fenetre} #del-mv`).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toMatch(/^Supprimer ce mouvement/);
    expect(net(await dessus(p).innerText())).not.toContain('période que ton cabinet');
    await dessus(p).locator('#ok').click();
    await p.waitForTimeout(500);
    expect(await toast(p)).not.toContain(PHRASE);
    await expect.poll(() => ecrituresDe(ent, leila, 'FRAIS-1015'), { timeout: 10_000 }).toEqual([]);

    // ── C. Le paiement noté par erreur le 26/09 sur la facture du café ──
    await p.evaluate(() => { location.hash = '#/doc/f5'; });
    await p.locator('tr', { hasText: '26/09/2026' }).locator('.row-menu-btn').first().click({ timeout: 15_000 });
    await p.getByRole('menuitem', { name: /Supprimer ce paiement/ }).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('26/09/2026', 'Il'));
    await photo(p, 'suppression-paiement');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Paiement supprimé — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const textePaiement = await message(p);
    noter('MESSAGE PAIEMENT', textePaiement);
    expect(textePaiement).toBe(dit(`un paiement daté du 26/09/2026 (facture ${numF5}, Café des Arts, ${net(C.money(netF5, 'DT'))})`));
    await expect.poll(async () => parDate((await ecrituresDe(ent, leila, numF5)).filter((e) => e.type !== 'vente')), { timeout: 10_000 }).toEqual(annuleeChezLeCabinet('2026-09-26', 'encaissement'));

    // ── D. Le règlement du 25/09 à Emballages du Centre, puis l'achat saisi à tort le 18/09 ──
    await p.evaluate(() => { location.hash = '#/achat/a4'; });
    await p.locator('tr', { hasText: '25/09/2026' }).locator('.row-menu-btn').first().click({ timeout: 15_000 });
    await p.getByRole('menuitem', { name: /Supprimer ce règlement/ }).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('25/09/2026', 'Il'));
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Règlement supprimé — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    expect(await message(p)).toBe(dit(`un règlement daté du 25/09/2026 (Emballages du Centre, n° EC-4410, ${net(C.money(regleA4, 'DT'))})`));
    await expect.poll(async () => parDate((await ecrituresDe(ent, leila, 'EC-4410')).filter((e) => e.type !== 'achat')), { timeout: 10_000 }).toEqual(annuleeChezLeCabinet('2026-09-25', 'reglement_fournisseur'));

    await p.evaluate(() => { location.hash = '#/achat/a7'; });
    await p.locator('#more-btn').click({ timeout: 15_000 });
    await p.getByRole('menuitem', { name: /Supprimer.*elle et son justificatif/ }).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('18/09/2026', 'Il'));
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`EC-4402 supprimée — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    expect(await message(p)).toBe(dit(`un achat daté du 18/09/2026 (Emballages du Centre, n° EC-4402, ${net(C.money(resteAchat(achatA7), 'DT'))})`));
    await expect.poll(async () => parDate(await ecrituresDe(ent, leila, 'EC-4402')), { timeout: 10_000 }).toEqual(annuleeChezLeCabinet('2026-09-18', 'achat'));

    // ── E. L'assurance passée deux fois en opération diverse le 12/09 ──
    await p.evaluate(() => { location.hash = '#/compta'; });
    await p.locator('#c-tabs [data-tab="ecritures"]').click({ timeout: 15_000 });
    // Les opérations de la période qu'on regarde : septembre.
    await p.locator('#c-year').selectOption('2026');
    await p.locator('#c-month').selectOption('09');
    await p.locator('#ecr-ods tr', { hasText: 'OD-2026-001' }).locator('.row-menu-btn').first().click({ timeout: 15_000 });
    await p.getByRole('menuitem', { name: /Supprimer l'opération/ }).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('12/09/2026', 'Elle', true));
    await photo(p, 'suppression-operation');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`OD-2026-001 supprimée — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteOd = await message(p);
    noter('MESSAGE OD', texteOd);
    expect(texteOd).toBe(dit(`l'opération diverse OD-2026-001 « Assurance du véhicule, saisie deux fois » datée du 12/09/2026 (${net(C.money(612.5, 'DT'))})`, true));
    await expect.poll(async () => parDate(await ecrituresDe(ent, leila, 'OD-2026-001')), { timeout: 10_000 }).toEqual(annuleeChezLeCabinet('2026-09-12', 'operation_diverse'));

    // ── Au Cabinet : septembre reste tel qu'elle l'a validé, l'annulation des frais se lit au 1er octobre ──
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/2026`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check();
    const lignesDe = (piece: string) => c.evaluate((x) => [...document.querySelectorAll('#c-livres tbody tr')]
      .filter((tr) => (tr.textContent ?? '').includes(x)).map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()), piece);
    await expect.poll(async () => (await lignesDe('FRAIS-0910')).length, { timeout: 15_000 }).toBe(2);
    const vues = await lignesDe('FRAIS-0910');
    noter('CABINET FRAIS', vues);
    expect(vues.some((x) => x.includes('10/09/2026'))).toBe(true);
    expect(vues.some((x) => x.includes('01/10/2026'))).toBe(true);
    await c.screenshot({ path: path.join(PHOTOS, 'compta-1304-cabinet-journal.png'), fullPage: true });

    // ── F. Une entreprise sans cabinet : le mouvement de septembre et sa suppression ne disent rien ──
    const sami = await personne('sami');
    const ent2 = String((await api('POST', '/entreprises-essai', sami)).corps.id);
    await api('GET', `/entreprises/${ent2}/dossier-v10`, sami);
    expect((await api('POST', `/entreprises/${ent2}/dossier-v10`, sami, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'STB', kind: 'banque', bank: 'STB', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null, contenu: mouvement('m1', '2026-09-10', '18.450', 'Frais de tenue de compte, saisis deux fois', 'FRAIS-0910') },
    ] })).statut).toBe(200);
    const sx = await contexte(sami);
    const s = await sx.newPage();
    s.on('pageerror', (x) => erreurs.push(`sans cabinet : ${x.message}`));
    await s.goto(`${serveur.adresse}/v10/?e=${ent2}#/tresorerie`);
    await s.locator('#new-move').waitFor({ timeout: 30_000 });
    await plusTard(s);
    await s.locator('#new-move').click();
    await dater(s, `${fenetre} #mf2`, '15/09/2026');
    await s.waitForTimeout(800);
    expect(await s.locator(`${fenetre} #mf-valide`).count()).toBe(1);
    expect(await s.locator(`${fenetre} #mf-valide`).isVisible()).toBe(false);
    await s.locator(`${fenetre} [data-close]`).first().click();
    const abandon = s.getByRole('button', { name: 'Abandonner la saisie', exact: true });
    if (await abandon.count()) await abandon.click();
    await s.locator('#t-tabs [data-tab="mouvements"]').click({ timeout: 15_000 });
    if (await s.locator('#t-year').count()) await s.locator('#t-year').selectOption('2026');
    await s.locator('#t-body tr[data-mv]').filter({ hasText: 'Frais de tenue de compte' }).first().click({ timeout: 15_000 });
    await s.locator(`${fenetre} #del-mv`).click({ timeout: 10_000 });
    await expect.poll(async () => net(await dessus(s).innerText()), { timeout: 10_000 }).toMatch(/^Supprimer ce mouvement/);
    expect(net(await dessus(s).innerText())).not.toContain('période que ton cabinet');

    expect(erreurs).toEqual([]);
    await cx.close(); await cxC.close(); await sx.close();
  }, 300_000);
});
