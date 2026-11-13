// Bout en bout 19 (1.358.1) : des moules achetés en France, facturés en euros, payés par virement au taux du jour. Trois
// défauts trouvés à la souris : (1) la ligne neuve d'un fournisseur à l'étranger partait à 19 % « toute déductible » — sa
// facture ne porte pas de TVA tunisienne, et 79,80 € de TVA se récupéraient sur une pièce qui ne la montre pas ; (2) la
// fenêtre de règlement d'un achat en devise écrasait la case du montant à 11 px (la phrase du taux, classe « span-2 », créait
// une seconde colonne invisible) ; (3) le taux gardait le nom « combien de DT pour 1 DT » après le choix de l'euro. L'écart de
// change (taux de la pièce contre taux du jour) part au 655 ou au 755, le même des deux côtés du pont.

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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'achat-euros-13581.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('bout en bout 19 : un achat en euros chez un fournisseur à l\'étranger (1.358.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achat-euros-13581-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'achat-euros-13581.txt'), '');
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
  it('Sarra achète des moules en France : la ligne part à 0 %, l\'avertissement dit la TVA de trop, le règlement se lit en entier ; au Cabinet, la perte de change au 655', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);
    // La BIAT à 5 000 DT ; un fournisseur à Paris, qui facture en euros.
    await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('5000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Mallard Ferriere', address: 'Paris (France)', currency: 'EUR', paymentTermsDays: 30 } },
    ] });

    const erreurs: string[] = [];
    const cx = await contexte(sarra);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    // Ce que le pont envoie au serveur, pour l'étape 5 : la taille du corps, et s'il part en `keepalive`.
    await cx.addInitScript(() => {
      const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = window.fetch.bind(window);
      w.__envois = [];
      window.fetch = (u: RequestInfo | URL, o?: RequestInit) => {
        if (o && o.method && o.method !== 'GET' && /\/dossier-v10$/.test(String(u))) w.__envois.push({ keepalive: !!o.keepalive, taille: typeof o.body === 'string' ? new TextEncoder().encode(o.body).length : 0 });
        return f(u, o);
      };
    });
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `achat-euros-13581-${nom}.png`), fullPage: true });

    // 1. Une facture d'achat saisie à la main ; le fournisseur choisi : la pièce passe en euros, la ligne vide à 0 %.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/new`);
    await p.locator('#ac-main').click({ timeout: 30_000 });
    await plusTard(p);
    await p.locator('[data-combo=supplierId] .combo-btn').click();
    await p.locator('[data-combo=supplierId] .combo-q').fill('Mallard');
    await p.locator('[data-combo=supplierId] .combo-list [role=option]').first().click();
    await expect.poll(() => p.locator('select[name=currency]').inputValue(), { timeout: 10_000 }).toBe('EUR');
    const tva = (i: number) => p.locator('#b-lines [data-k=vatRate]').nth(i).inputValue();
    expect(await tva(0)).toBe('0');
    expect(await p.locator('[name=exchangeRate]').first().getAttribute('aria-label')).toBe('Taux de change : combien de DT pour 1 EUR');
    await p.locator('[name=exchangeRate]').first().fill('3,35');
    await p.locator('[name=number]').fill('MF-2611-07');
    await p.locator('input[data-k=label]').first().fill('Moules à entremets inox, lot de 12');
    await p.locator('input[data-k=unitPrice]').first().fill('420');
    // 2. Une ligne libre part à 0 % aussi ; remise à 19 % à la main, « Avant d'enregistrer » le dit, et la remet à 0 %.
    await p.locator('#add-line').click();
    expect(await tva(1)).toBe('0');
    await p.locator('input[data-k=label]').nth(1).fill('Frais de port');
    await p.locator('input[data-k=unitPrice]').nth(1).fill('20');
    await p.locator('#b-lines [data-k=vatRate]').nth(1).selectOption('19');
    await expect.poll(async () => net(await p.locator('#ac-avant').innerText()), { timeout: 10_000 }).toContain('TVA sur 1 ligne : un fournisseur à l\'étranger n\'en facture pas Passer à 0 %');
    await photo(p, '1-avertissement');
    await p.locator('[data-avant=tva0]').click();
    expect([await tva(0), await tva(1)]).toEqual(['0', '0']);
    await expect.poll(async () => net(await p.locator('#ac-avant').innerText())).not.toContain('TVA sur');
    await p.locator('#save').click();
    await p.getByRole('button', { name: 'Enregistrer un règlement' }).first().waitFor({ timeout: 20_000 });

    // 3. Le règlement : la case du montant se lit en entier, la date et le taux côte à côte ; 440 € à 3,40 contre 3,35 : perte
    // de 22 DT (440 × 3,40 = 1 496 ; 440 × 3,35 = 1 474 — calculé à la main).
    await p.getByRole('button', { name: 'Enregistrer un règlement' }).first().click();
    const f = p.locator('.modal').filter({ has: p.locator('#spf') });
    await f.waitFor({ timeout: 10_000 });
    expect(await f.locator('[name=amount]').inputValue()).toBe('440,00');
    expect((await f.locator('[name=amount]').boundingBox())?.width ?? 0).toBeGreaterThan(200);
    const ligne = async (sel: string) => Math.round((await f.locator(sel).first().boundingBox())?.y ?? -1);
    expect(await ligne('[name=exchangeRate]')).toBe(await ligne('.d-txt'));
    await f.locator('[name=exchangeRate]').fill('3,40');
    await expect.poll(async () => net(await f.locator('#rg-change').innerText()), { timeout: 10_000 })
      .toBe('Payé en dinars : 1 496,000 DT La facture le portait au taux de 3,35 (1 474,000 DT) : perte de change de 22,000 DT, que l\'écriture passe au 655.');
    expect(await f.locator('#rg-change').getAttribute('class')).toContain('pf-change');
    await photo(p, '2-reglement');
    await f.locator('#ok').click();
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);

    // 4. Deux chemins, un chiffre : le brouillard du Cabinet et les écritures de l'application.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { journal: string; libelle: string; lignes: Ligne[] };
    const ecr = async (journal: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?journal=${journal}&limite=50`, leila)).corps.ecritures as Ecriture[] ?? [])
      .map((x) => [x.libelle, ...x.lignes.map((l) => `${l.compte} ${Number(l.debit)} ${Number(l.credit)}`).sort()].join(' | ')).sort();
    await expect.poll(() => ecr('BQ'), { timeout: 20_000 }).toEqual([expect.stringMatching(/^Règlement fournisseur MF-2611-07 — Mallard Ferriere \| 401 1474 0 \| 5\d* 0 1496 \| 655 22 0$/)]);
    await expect.poll(async () => (await ecr('AC')).map((x) => x.replace(/ \| 6\d* 1474 0$/, '')), { timeout: 20_000 }).toEqual(['Achat MF-2611-07 — Mallard Ferriere | 401 0 1474']);
    const cote = await p.evaluate(() => {
      const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const K = w.SkanCore || w.C, d = w.__data;
      return K.journalEntries(d, d.company, { from: '2026-11-13', to: '2026-11-13' }).filter((x: Record<string, any>) => x.journal === 'BQ') // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((x: Record<string, any>) => `${x.account} ${x.debit} ${x.credit}`).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    expect(cote).toEqual(['401 1474 0', `${C.DEFAULT_ACCOUNTS.banque} 0 1496`, '655 22 0']);
    noter('ÉCRITURES', await ecr('AC'), await ecr('BQ'));

    // 5. (rouge GitHub de d5b77f0) « Enregistré » se dit avant que le serveur ait répondu : l'envoi part en `keepalive`, et
    // survit à la page qu'on ferme ou qu'on recharge. Trop gros pour la limite du navigateur (64 Ko, toutes requêtes en route
    // comprises), il part comme avant, et arrive.
    type Envoi = { keepalive: boolean; taille: number };
    const envois = () => p.evaluate(() => (window as unknown as { __envois: Envoi[] }).__envois.slice());
    expect((await envois()).length).toBeGreaterThan(0);
    expect((await envois()).every((x) => x.keepalive)).toBe(true);
    const lu = async () => JSON.stringify((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps);
    await p.locator('#ac-modifier').click();
    await p.locator('#b-notes').fill('Moules commandés au salon de Lyon, livrés par transporteur. '.repeat(1200));
    await p.locator('#save').click();
    await expect.poll(async () => (await envois()).some((x) => x.taille > 60_000), { timeout: 15_000 }).toBe(true);
    expect((await envois()).filter((x) => x.taille > 60_000).every((x) => !x.keepalive)).toBe(true);
    await expect.poll(async () => (await lu()).includes('salon de Lyon'), { timeout: 15_000 }).toBe(true);
    // Un petit enregistrement, et la page rechargée dans la foulée : le serveur l'a.
    await p.locator('#ac-modifier').click();
    await p.locator('#b-notes').fill('Moules livrés le 13/11, carton abîmé.');
    await p.locator('#save').click();
    await p.goto('about:blank');
    await expect.poll(async () => (await lu()).includes('carton abîmé'), { timeout: 15_000 }).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('le moteur : un fournisseur à l\'étranger, et le taux proposé sur une ligne d\'achat', () => {
    expect(C.fournisseurEtranger({ currency: 'EUR' }, co)).toBe(true);
    expect(C.fournisseurEtranger({ currency: 'TND' }, co)).toBe(false);
    expect(C.fournisseurEtranger({ currency: 'DT' }, co)).toBe(false);
    expect(C.fournisseurEtranger({}, co)).toBe(false);
    expect(C.fournisseurEtranger(null, co)).toBe(false);
    expect(C.tauxAchatPropose(co, null, { currency: 'EUR' })).toBe(0);
    expect(C.tauxAchatPropose(co, { vatRate: 7 }, { currency: 'EUR' })).toBe(0);
    expect(C.tauxAchatPropose(co, null, { currency: 'DT' })).toBe(19);
    expect(C.tauxAchatPropose(co, { vatRate: 7 }, null)).toBe(7);
    expect(C.tauxAchatPropose(co, null, null)).toBe(19);
  });
});
