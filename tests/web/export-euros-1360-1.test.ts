// Une vente en euros à un client étranger (1.360.1, bout en bout 23). La case « Vente à l'exportation » remettait à 0 % les
// lignes déjà posées, mais une ligne ajoutée APRÈS prenait 19 % : la facture « sans TVA » comptait 475 € de TVA sur 2 500,
// et la case grisée empêchait de la corriger. Le serveur reprenait le même taux. La règle vit maintenant dans le calcul,
// au serveur et dans l'éditeur. Au passage : un client à l'étranger ne se voit plus réclamer un matricule tunisien, un taux
// de règlement s'écrit à trois décimales, et l'annonce du change garde sa hauteur quand le taux change.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('une vente en euros à l\'export, réglée à un autre taux (1.360.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-export-euros-1360-1-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
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
  const n = (x: string) => ({ '~n': x });

  it('la facture d\'export ne porte aucune TVA, au serveur comme à l\'écran ; le règlement à un autre taux passe au change', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const olivier = { id: 'c1', name: 'Maison Olivier SARL', address: '12 rue Mercière, 69002', city: 'Lyon', email: 'compta@maison-olivier.fr', currency: 'EUR', paymentTermsDays: 30, withholdingRate: 0 };
    const lumiere = { id: 'c2', name: 'Atelier Lumière', city: 'Genève', email: '', currency: 'CHF', paymentTermsDays: 30, withholdingRate: 0 };
    // Un brouillon seul chez Atelier Lumière : la liste des clients le nomme.
    const brouillon = { id: 'b1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c2', createdAt: 5, subject: 'Lampes',
      lines: [{ label: 'Lampes de table', description: '', qty: n('2'), unit: '', unitPrice: n('150.00'), vatRate: 0 }], discountRate: 0, withholdingRate: 0, applyStamp: false,
      exchangeRate: n('3.300'), export: true, notes: '', currency: 'CHF', regimeTva: 'reel', payments: [] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('8000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: olivier },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: lumiere },
      { collection: 'documents', cle: 'b1', rang: 1, revision: null, contenu: brouillon },
    ] })).statut).toBe(200);
    // Le serveur : une facture d'export dont la ligne porte encore 19 % se compte SANS TVA (1 000,00 €, pas 1 190,00).
    const f0 = { id: 'f0', type: 'facture', number: '', status: 'brouillon', date: '2026-11-02', dueDate: '2026-12-02', clientId: 'c1', createdAt: 3, subject: 'Échantillons',
      lines: [{ label: 'Échantillons de petits-fours', description: '', qty: n('1'), unit: '', unitPrice: n('1000.00'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: n('3.412'), export: true, notes: '', currency: 'EUR', regimeTva: 'reel', payments: [] };
    const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: f0, client: olivier, revision: null, rang: 2, netAPayer: '1000.00' });
    expect(em.statut, JSON.stringify(em.corps)).toBe(200);
    // La pièce gardée dans le dossier porte le taux scellé (0 %) : sinon elle s'affichait 1 190,00 € TVA comprise.
    const garde = (await admin.query('select contenu from socle.dossier_v10 where entreprise = $1 and collection = \'documents\' and cle = \'f0\'', [ent])).rows[0].contenu as Obj;
    expect(garde.status).toBe('envoyée');
    expect(garde.lines.map((l: Obj) => Number(l.vatRate))).toEqual([0]);

    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    const fenetre = () => p.locator('#modal-root .modal').last();

    // La liste des clients : un client à l'étranger sans matricule n'est pas « à renseigner » ; un brouillon seul se nomme.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    const ligneLumiere = p.locator('tr').filter({ hasText: 'Atelier Lumière' }).first();
    await ligneLumiere.waitFor({ timeout: 30_000 });
    await plusTard(p);
    expect(net(await ligneLumiere.innerText())).toContain('1 brouillon à émettre');
    expect(net(await ligneLumiere.innerText())).not.toContain('0 facture');

    // La facture : le taux, la case « export », PUIS la ligne. Elle naît à 0 %.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture/client/c1`);
    await p.getByRole('button', { name: 'Indiquer le taux', exact: true }).click();
    await p.keyboard.type('3,412');
    await p.locator('#pop-export').check();
    await p.keyboard.press('Escape');
    await p.locator('#ed-ajout').fill('Plateaux de petits-fours, salon de Lyon');
    await p.locator('[data-aj-libre]').click();
    const prix = p.locator('[data-k=unitPrice]').first();
    await prix.click();
    await prix.fill('2500');
    await prix.press('Tab');
    await expect.poll(async () => net(await p.locator('#totals').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Total TTC 2 500,00');
    expect(net(await p.locator('#totals').innerText())).toMatch(/TVA · vente à l'exportation 0,00/);
    expect(await p.locator('[data-k=vatRate]').first().inputValue()).toBe('0');
    const avant = net(await p.locator('#ed-avant').innerText());
    expect(avant).toContain('Client à l\'étranger : sans matricule tunisien');
    expect(avant).toContain('Vente à l\'exportation : aucune TVA');
    expect(avant).not.toContain('Aucune ligne ne porte de TVA');
    expect(avant).not.toContain('obligatoire pour une entreprise');
    expect(net(await p.locator('#view').innerText())).toContain('à l\'étranger · 12 rue Mercière');
    // La facture d'échantillons, émise par le serveur : 1 000,00 € comme il l'a scellée, et la dette du client en suit.
    expect(net(await p.locator('#view').innerText())).toMatch(/FAC-2026-001 · 02\/11 · 1 000,00 EUR/);
    expect(net(await p.locator('#view').innerText())).toContain('doit 3 412,000 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'export-euros-1360-1-facture.png') });
    await p.getByRole('button', { name: /Émettre la facture/ }).first().click();
    await expect.poll(async () => net(await fenetre().innerText().catch(() => '')), { timeout: 10_000 }).toContain('2 500,00 EUR');
    const mail = fenetre().getByRole('checkbox', { name: /L'envoyer par e-mail/ });
    if (await mail.count() && await mail.isChecked()) await mail.uncheck();
    await fenetre().getByRole('button', { name: /^Émettre/ }).click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText().catch(() => '')), { timeout: 20_000 }).toMatch(/^FAC-2026-/);
    await expect.poll(async () => (await admin.query('select count(*)::int as n from ventes.piece where entreprise = $1 and statut = \'emise\'', [ent])).rows[0].n, { timeout: 20_000 }).toBe(2);

    // Le règlement au taux du jour (3,380) : l'annonce garde sa hauteur, « Enregistrer » ne bouge pas.
    await p.locator('#pay').click();
    const taux = fenetre().locator('[name=exchangeRate]');
    await taux.waitFor({ timeout: 10_000 });
    expect(await taux.inputValue()).toBe('3,412');
    const hauteur = async () => Math.round((await fenetre().locator('#ok').boundingBox())?.y ?? -1);
    const neutre = await hauteur();
    await taux.fill('3,380');
    await expect.poll(async () => net(await fenetre().locator('#rg-change').innerText().catch(() => '')), { timeout: 5_000 }).toContain('perte de change de 80,000 DT');
    expect(await hauteur()).toBe(neutre);
    await fenetre().locator('[name=reference]').fill('VIR SG 551902');
    await fenetre().locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#pay-body').innerText().catch(() => '')), { timeout: 10_000 }).toContain('8 450,000 DT au taux de 3,380');
    expect(erreurs).toEqual([]);
    await cx.close();

    // Chez le comptable : la vente sans TVA ni timbre, et la perte de change au 655.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { libelle: string; lignes: Ligne[] };
    const ecritures = async () => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[] ?? [];
    await expect.poll(async () => (await ecritures()).filter((e) => e.libelle.startsWith('Facture FAC-2026-')).length, { timeout: 20_000 }).toBe(2);
    for (const e of (await ecritures()).filter((x) => x.libelle.startsWith('Facture FAC-2026-'))) {
      expect(e.lignes.map((l) => l.compte.slice(0, 3)).sort()).toEqual(['411', '706']);
    }
    await expect.poll(async () => (await ecritures()).flatMap((e) => e.lignes).filter((l) => l.compte.startsWith('655')).map((l) => l.debit), { timeout: 20_000 }).toEqual(['80.000']);
  }, 180_000);
});
