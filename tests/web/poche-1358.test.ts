// Bout en bout 18 (1.358.0) : la gérante paie une dépense avec sa carte personnelle. Les choix de la dépense étaient « à la
// caisse », « par carte » et « pas encore » : « par carte » sortait les 59,500 DT de la BIAT, qui ne les avait jamais payés,
// et l'entreprise ne disait nulle part qu'elle les devait à sa gérante. « De ta poche » règle le fournisseur sans toucher la
// banque ni la caisse ; l'écriture va au compte courant d'associé (D 401 / C 4421, en opérations diverses) des deux côtés
// du pont ; la Trésorerie dit ce que l'entreprise doit, et « Te rembourser… » note le jour où elle le rend (D 4421 / C banque).

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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'poche-1358.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('bout en bout 18 : un achat payé de la poche du gérant (1.358.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-poche-1358-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'poche-1358.txt'), '');
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
  const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
  it('Sarra paie une dépense puis une facture de sa poche : rien ne sort de la BIAT, l\'entreprise lui doit, elle se rembourse ; au Cabinet, D 401 / C 4421 puis D 4421 / C banque', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);
    // La BIAT à 5 000 DT ; une facture de papeterie impayée de 101,150 DT (85 HT + 19 %).
    await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('5000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Papeterie El Manar', paymentTermsDays: 0 } },
      { collection: 'purchases', cle: 'a2', rang: 0, revision: null, contenu: { id: 'a2', kind: 'facture', number: 'PEM-2611-17', date: '2026-11-12', dueDate: '2026-11-12', supplierId: 's2', currency: 'DT', fees: 0, withholdingRate: 0,
        category: 'Fournitures de bureau', createdAt: Date.parse('2026-11-12T09:00:00Z'), attachments: [], payments: [], lines: [{ label: 'Papier thermique (carton de 50)', qty: n('1'), unitPrice: n('85.000'), vatRate: 19, destination: 'charge' }] } },
    ] });

    const erreurs: string[] = [];
    const cx = await contexte(sarra);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `poche-1358-${nom}.png`), fullPage: true });

    // 1. La dépense : « de ta poche », 59,500 DT TTC. Elle s'enregistre réglée, et le dit.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/new/-/depense`);
    await p.locator('#ac-dep-paye').waitFor({ timeout: 30_000 });
    await plusTard(p);
    expect(await p.locator('#ac-dep-paye option[value="poche"]').innerText()).toBe('de ta poche : l\'entreprise te le doit');
    await p.locator('#ac-dep-paye').selectOption('poche');
    expect(net(await p.locator('#view .ed-net .k').innerText())).toBe('Payé');
    if (!(await p.locator('[data-k=label]').count()) && await p.locator('#ed-ajout').count()) await p.locator('#ed-ajout').press('Enter');
    await p.locator('input[data-k=label]').first().fill('Cartouches d\'encre, imprimante du comptoir');
    await p.locator('#b-ttc').fill('59.5');
    await expect.poll(() => p.locator('input[data-k=unitPrice]').first().inputValue()).toBe('50,000');
    await p.locator('#save').click();
    await expect.poll(() => p.locator('#ac-dep-paye-lu').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await p.locator('#ac-dep-paye-lu').innerText())).toBe('le 13/11 · de ta poche');
    await photo(p, '1-depense');

    // 2. La facture de papeterie : « De ta poche » parmi les comptes (même avec une seule banque), payée par carte.
    await p.evaluate(() => { location.hash = '#/achat/a2'; });
    await p.getByRole('button', { name: 'Enregistrer un règlement' }).first().click({ timeout: 20_000 });
    const f = p.locator('.modal').filter({ has: p.locator('#spf') });
    await f.waitFor({ timeout: 10_000 });
    expect((await f.locator('[name=accountId] option').allInnerTexts()).map(net)).toEqual(['BIAT', 'De ta poche : l\'entreprise te le doit']);
    await f.locator('[name=accountId]').selectOption('@poche');
    await f.locator('[data-mode=carte]').click();
    expect(await f.locator('[name=accountId]').inputValue()).toBe('@poche');
    await photo(p, '2-reglement');
    await f.locator('#ok').click();
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toMatch(/13\/11\/2026 Carte De ta poche — 101,150/);

    // 3. La Trésorerie : la BIAT n'a rien payé, et l'entreprise doit 160,650 DT à Sarra (59,500 + 101,150, calculé à la main).
    await p.evaluate(() => { location.hash = '#/tresorerie'; });
    await p.locator('#tr-s-avances-l').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('#tr-resume .mg-chiffre b').first().innerText())).toMatch(/^5 000,000 ?DT$/);
    expect(net(await p.locator('#tr-s-avances-l').innerText())).toBe('160,650 DT avancés de ta poche 2 achats payés avec ton argent : l\'entreprise te les doit Te rembourser…');
    await photo(p, '3-tresorerie');

    // 4. « Te rembourser… » : le mouvement prérempli, depuis la BIAT ; la ligne disparaît, la BIAT baisse de 160,650.
    await p.locator('#tr-s-avances').click();
    const m = p.locator('.modal').filter({ has: p.locator('#mf2') });
    await m.waitFor({ timeout: 10_000 });
    expect(await m.locator('[name=kind]').inputValue()).toBe('avances');
    expect(await m.locator('[name=amount]').inputValue()).toMatch(/^160[,.]650?$/);
    expect(await m.locator('[name=label]').inputValue()).toBe('Remboursement de mes avances');
    await m.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Remboursement noté : 160,650 DT rendus le 13/11/2026.');
    await expect.poll(() => p.locator('#tr-s-avances-l').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => net(await p.locator('#tr-resume .mg-chiffre b').first().innerText()), { timeout: 10_000 }).toMatch(/^4 839,350 ?DT$/);

    // 5. Deux chemins, un chiffre : les écritures de l'application et celles du brouillard du Cabinet.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { journal: string; libelle: string; lignes: Ligne[] };
    const ecr = async (journal: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?journal=${journal}&limite=50`, leila)).corps.ecritures as Ecriture[] ?? [])
      .map((x) => [x.libelle, ...x.lignes.map((l) => `${l.compte} ${Number(l.debit)} ${Number(l.credit)}`).sort()].join(' | ')).sort();
    await expect.poll(() => ecr('OD'), { timeout: 20_000 }).toEqual([
      'Règlement fournisseur (sans numéro) — Dépenses diverses (avancé par le gérant) | 401 59.5 0 | 4421 0 59.5',
      'Règlement fournisseur PEM-2611-17 — Papeterie El Manar (avancé par le gérant) | 401 101.15 0 | 4421 0 101.15',
    ]);
    await expect.poll(async () => (await ecr('BQ')).filter((x) => x.startsWith('Remboursement de mes avances')), { timeout: 20_000 })
      .toEqual([expect.stringMatching(/^Remboursement de mes avances \| 4421 160\.65 0 \| 5\d* 0 160\.65$/)]);
    const cote = await p.evaluate(() => {
      const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const K = w.SkanCore || w.C, d = w.__data;
      return K.journalEntries(d, d.company, { from: '2026-11-13', to: '2026-11-13' }).filter((x: Record<string, any>) => String(x.account) === '4421') // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((x: Record<string, any>) => `${x.journal} ${x.debit} ${x.credit}`).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    expect(cote).toEqual(['BQ 160.65 0', 'OD 0 101.15', 'OD 0 59.5']);
    noter('ÉCRITURES', await ecr('OD'), await ecr('BQ'));
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('le moteur : la poche ne touche aucun compte de trésorerie, s\'écrit au 4421, et se rembourse', () => {
    const data: Obj = {
      accounts: [{ id: 'biat', name: 'BIAT', kind: 'banque', opening: 1000, openingDate: '2026-06-01', isDefault: true }],
      suppliers: [{ id: 's', name: 'Papeterie' }],
      purchases: [{ id: 'a', kind: 'facture', number: 'P-1', date: '2026-03-10', supplierId: 's', currency: 'DT', lines: [{ label: 'Encre', qty: 1, unitPrice: 100, vatRate: 19, destination: 'charge' }],
        payments: [{ id: 'r', date: '2026-03-10', amount: 119, method: 'carte', accountId: C.POCHE }] }],
      movements: [{ id: 'm', kind: 'avances', amount: 50, date: '2026-07-01', accountId: 'biat', label: 'Remboursement de mes avances' }],
      documents: [], clients: [],
    };
    // Le règlement n'est pas un mouvement de trésorerie : seul le remboursement en est un.
    expect(C.cashMovements(data, co).map((x: Obj) => x.id)).toEqual(['m']);
    // Payé en mars, AVANT le solde de départ de juin de la BIAT : la règle du solde de départ ne s'applique pas à la poche.
    expect(C.compteAvantDepart(data, C.POCHE, 'carte', '2026-03-10')).toBeNull();
    expect(C.purchaseBalance(data.purchases[0], co, data).remaining).toBe(0);
    const av = C.avancesDuGerant(data, co);
    expect([av.avance, av.rembourse, av.reste, av.avances.length]).toEqual([119, 50, 69, 1]);
    const e = C.journalEntries(data, co, { from: '2026-03-10', to: '2026-03-10' }).filter((x: Obj) => x.journal === 'OD');
    expect(e.map((x: Obj) => `${x.account} ${x.debit} ${x.credit}`).sort()).toEqual(['401 119 0', '4421 0 119']);
    expect(e.every((x: Obj) => / \(avancé par le gérant\)$/.test(x.label))).toBe(true);
    // Le remboursement : D 4421 / C banque, au journal de banque.
    const r = C.journalEntries(data, co, { from: '2026-07-01', to: '2026-07-01' });
    expect(r.map((x: Obj) => `${x.journal} ${x.account} ${x.debit} ${x.credit}`).sort()).toEqual(['BQ 4421 50 0', `BQ ${C.DEFAULT_ACCOUNTS.banque} 0 50`]);
    // Rien d'avancé : rien à rendre, même après un remboursement plus grand.
    expect(C.avancesDuGerant({ purchases: [], movements: data.movements }, co).reste).toBe(0);
  });
});
