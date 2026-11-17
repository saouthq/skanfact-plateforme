// 1.379.3 (Skander, 17/11/2026) — Sur la production que le comptable va essayer, la caisse et la facture électronique
// (El Fatoora) ne sont pas encore branchées : elles se voient, grisées, avec une pastille « À venir », et ne s'ouvrent
// pas. C'est un réglage du serveur (SKANFACT_A_VENIR, serveur/a-venir.ts) ; les autres tests tournent avec tout ouvert.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown; round3: (n: number) => number };
const RIB = '08100123456789012359';

describe('1.379.3 : ce qui n\'est pas encore branché porte « À venir » (la caisse, la facture électronique)', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-a-venir-1379-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    nav = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
  }, 120_000);
  afterAll(async () => { await nav?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  const api = async (m: string, c: string, j?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${c}`, { method: m, headers: { ...(j ? { authorization: `Bearer ${j}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    const t = await r.text(); return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
  };
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const jourUTC = (decale: number) => new Date(Date.now() + decale * 86_400_000).toISOString().slice(0, 10);

  const monter = async () => {
    const email = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra', motDePasse: 'Un-bon-mot-de-passe' });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = new Date();
    const an = auj.getUTCFullYear(), mo = auj.getUTCMonth() + 1;
    const anA = mo === 1 ? an - 1 : an, moA = mo === 1 ? 12 : mo - 1;
    const mm = (m: number) => String(m).padStart(2, '0');
    const sal = (id: string, name: string, grossSalary: number, x: Record<string, unknown> = {}) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', ...x });
    // Nadia est entrée il y a un peu plus de deux mois : son essai finit dans cinq jours.
    const S = [sal('mt', 'Mourad Trabelsi', 1450.375, { headOfFamily: true, children: 2 }), sal('nb', 'Nadia Ben Salah', 880.125, { position: 'Vendeuse', hireDate: jourUTC(-70), trialEnd: jourUTC(5), cnss: '87654321-21', iban: '08100987654321098714' })];
    const bul = (e: (typeof S)[number], y: number, m: number, x: Record<string, unknown> = {}) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28`, ...x };
    };
    Object.assign(S[0] as object, { equipeId: 'q1', badge: '1001' }); Object.assign(S[1] as object, { equipeId: 'q1', badge: '1002' });
    await poser('_racine', 'payrollSettings', { equipes: [{ id: 'q1', nom: 'Le fournil, la nuit', debut: '03:00', fin: '11:00', jours: [1, 2, 3, 4, 5, 6], pointe: 'pointeuse', minimum: 2 }] });
    for (const e of S) await poser('employees', e.id, e);
    for (const b of [...S.map((e) => bul(e, an, mo)), ...S.map((e) => bul(e, anA, moA, { paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28` }))]) await poser('payslips', b.id, b);
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: 'sans' } }] });
    return { j, ent, an, mo, anA, moA };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string }) => {
    erreurs.length = 0;
    const p = await (await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}#/paie`);
    await p.locator('#p-head').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    await p.waitForTimeout(400);
    return p;
  };

  it('à venir : la ligne « Caisse » est grisée avec sa pastille, sa page dit qu\'elle arrive, « Créer » ne la propose pas, et les Paramètres le disent de la facture électronique', async () => {
    const x = await monter();
    process.env.SKANFACT_A_VENIR = 'caisse,efacture'; process.env.SKANFACT_BETA = 'paie';
    try {
      const p = await ouvrir(x);
      // (1.381.0) La paie est en bêta : son titre et sa ligne du menu le disent.
      expect(espace(await p.locator('#p-head h1').innerText())).toBe('Paie Bêta');
      expect(await p.locator('nav .pastille-beta').count()).toBeGreaterThan(0);
      const ligne = p.locator('.a-venir').first();
      await ligne.waitFor({ state: 'attached', timeout: 10_000 });
      expect(espace(String(await ligne.textContent()))).toMatch(/^Caisse ?À venir/);
      expect(await p.locator('a.lien[data-route="caisse"]:not(.a-venir)').count()).toBe(0);
      await p.evaluate(() => { location.hash = '#/caisse'; });
      await p.locator('#page-a-venir').waitFor({ timeout: 10_000 });
      expect(espace(await p.locator('#view h1').innerText())).toBe('Caisse À venir');
      expect(espace(await p.locator('#page-a-venir h2').innerText())).toBe('Caisse arrive bientôt');
      // (1.381.0) L'écran dit trois choses : où on en est, quoi faire en attendant, et que ça s'ouvrira tout seul.
      expect((await p.locator('#page-a-venir .avenir-points li b').allInnerTexts()).map((t) => espace(t).toLowerCase())).toEqual(['où on en est', 'en attendant', 'le jour où elle ouvre']);
      expect(await p.locator('#page-a-venir').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      const creer = await p.evaluate(() => (window as unknown as { __creer: () => { actions: [string, string][] } }).__creer().actions.map((a) => a[0]));
      expect(creer).not.toContain('caisse');
      await p.locator('#pi-accueil').click();
      await p.waitForURL(/#\/dashboard/);
      await p.evaluate(() => { location.hash = '#/parametres'; });
      await p.locator('#efacture-a-venir').waitFor({ state: 'attached', timeout: 8_000 }).catch(async () => { throw new Error(`pas de ligne : ${p.url()} · ${erreurs.join(' | ')} · ${await p.evaluate(() => [String((window as unknown as { __aVenir: unknown }).__aVenir), document.querySelector('#view h1')?.textContent, document.querySelectorAll('[data-pane]').length, !!document.querySelector('#p-efacture')].join(' · '))}`); });
      expect(espace(await p.locator('#efacture-a-venir').innerText().catch(async () => String(await p.locator('#efacture-a-venir').textContent())))).toMatch(/^À venir La facture électronique \(El Fatoora\) n'est pas encore branchée/);
      expect(await p.locator('input[name="efacture"]').isVisible()).toBe(false);
      // (1.381.0) « Ajouter un module » : la caisse ne se coche pas et ne s'ouvre pas, elle s'annonce.
      await p.evaluate(() => { location.hash = '#/modules'; });
      const rang = p.locator('.mod-row[data-a-venir]').first();
      await rang.waitFor({ timeout: 10_000 });
      expect(espace(await rang.locator('.mod-t').innerText())).toMatch(/À venir$/);
      expect(await rang.locator('input[type="checkbox"]').count()).toBe(0);
      expect(await rang.locator('button').count()).toBe(0);
      expect(await p.locator('.mod-row:not([data-a-venir]) .pastille-beta').count()).toBe(1);
      expect(erreurs).toEqual([]);
      await p.context().close();
    } finally { process.env.SKANFACT_A_VENIR = ''; process.env.SKANFACT_BETA = ''; }
  }, 120_000);

  it('tout ouvert (le réglage vide) : la caisse est une ligne ordinaire et sa page s\'ouvre', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('[data-route="caisse"], [data-aller="caisse"]').first().waitFor({ state: 'attached', timeout: 10_000 });
    expect(await p.locator('.a-venir, .pastille-avenir, .pastille-beta').count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/caisse'; });
    await p.locator('#cs-tabs, #cs-creer, #cs-body').first().waitFor({ timeout: 15_000 });
    expect(await p.locator('#page-a-venir').count()).toBe(0);
    await p.context().close();
  }, 120_000);
});
