// 1.379.1 (issue 16, GEST-1) — « Un bulletin », sur la fiche d'un salarié entré CE mois-ci, proposait le mois dernier : un
// bulletin plein pour un mois où il n'était pas là. Le mois proposé est son premier mois ; un salarié qui n'est pas encore
// entré n'a pas de bulletin du tout, et le dit.

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

describe('la paie 1.379.1 : « Un bulletin » reste dans le contrat du salarié', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1379-'));
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

  it('un salarié entré ce mois-ci reçoit le bulletin de ce mois, pas celui du mois dernier ; un futur salarié, aucun', async () => {
    const x = await monter();
    const mm = (m: number) => String(m).padStart(2, '0');
    const fiche = (id: string, name: string, hireDate: string) => ({ id, name, grossSalary: 900, hireDate, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', position: 'Vendeur' });
    const anS = x.mo === 12 ? x.an + 1 : x.an, moS = x.mo === 12 ? 1 : x.mo + 1;
    for (const e of [fiche('ne', 'Karim Jlassi', `${x.an}-${mm(x.mo)}-01`), fiche('fu', 'Ines Mrad', `${anS}-${mm(moS)}-15`)])
      await api('POST', `/entreprises/${x.ent}/dossier-v10`, x.j, { changements: [{ collection: 'employees', cle: e.id, rang: null, revision: null, contenu: enc(e) }] });
    const p = await ouvrir(x);
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    try {
      await p.evaluate(() => { location.hash = '#/salarie/ne'; });
      await p.locator('#view [data-onglet="bulletins"]').click({ timeout: 15_000 });
      await p.locator('#new-slip').waitFor({ timeout: 15_000 });
      await p.locator('#new-slip').click();
      await p.locator('.modal h2').first().waitFor({ timeout: 10_000 });
      expect(espace(await p.locator('.modal h2').first().innerText())).toBe(`Bulletin de Karim Jlassi — ${MOIS[x.mo - 1]} ${x.an}`);
      await p.keyboard.press('Escape');
      for (let i = 0; i < 2 && await p.locator('.modal').count(); i++) await p.locator('.modal #ok, .modal #a').first().click({ timeout: 2000 }).catch(() => undefined);

      await p.evaluate(() => { location.hash = '#/salarie/fu'; });
      await expect.poll(() => p.locator('h1').first().innerText().then(espace).catch(() => ''), { timeout: 15_000 }).toMatch(/Ines Mrad/);
      await p.locator('#view [data-onglet="bulletins"]').click({ timeout: 15_000 });
      await p.locator('#new-slip').click();
      await expect.poll(() => p.locator('#toast').innerText().then(espace).catch(() => ''), { timeout: 5_000 }).toMatch(/Ines Mrad entre le .* : son premier bulletin sera celui de ce mois-là/);
      expect(await p.locator('.modal h2').count()).toBe(0);
      expect(erreurs).toEqual([]);
    } finally { await p.context().close(); }
  }, 120_000);
});
