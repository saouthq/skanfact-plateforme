// 1.388.69 — Les modules pilotés depuis la console (0226) : l'écran prend les listes de L'ENTREPRISE ouverte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown; round3: (n: number) => number };
const RIB = '08100123456789012359';

describe('1.388.69 : un module posé depuis la console, pour une entreprise', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-modules-1388-69-'));
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

  it('« fermé » pour CETTE entreprise : Stock quitte le menu et sa page le dit ; le paiement « à venir » cache son panneau ; une autre entreprise ne voit rien', async () => {
    const x = await monter();
    const autre = await monter();
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try {
      const par = String((await admin.query('select id from socle.utilisateur limit 1')).rows[0]?.id);
      await admin.query(`insert into plateforme.module_etat (module, entreprise, etat, motif, le, par) values ('stock', $1, 'ferme', 'Un défaut grave', now(), $2), ('paiement', $1, 'a_venir', 'Pas encore essayé', now(), $2)`, [x.ent, par]);
      const p = await ouvrir(x);
      expect(await p.evaluate(() => (window as unknown as { __ferme: string[] }).__ferme)).toEqual(['stock', 'garanties']);
      expect(await p.locator('nav [data-route="stock"]').count()).toBe(0);
      await p.evaluate(() => { location.hash = '#/stock'; });
      await p.locator('#page-fermee').waitFor({ timeout: 10_000 });
      expect(espace(await p.locator('#page-fermee h2').innerText())).toBe('Cette partie est fermée pour l\'instant');
      await p.locator('#pi-accueil').click();
      await p.waitForURL(/#\/dashboard/);
      await p.evaluate(() => { location.hash = '#/parametres'; });
      await p.locator('[data-pane]').first().waitFor({ state: 'attached', timeout: 10_000 });
      expect(await p.locator('#p-paiement').count()).toBe(0);
      expect(erreurs).toEqual([]);
      await p.context().close();
      // L'autre entreprise : rien de posé pour elle, tout reste ouvert.
      const q = await ouvrir(autre);
      expect(await q.evaluate(() => (window as unknown as { __ferme: string[] }).__ferme)).toEqual([]);
      await q.evaluate(() => { location.hash = '#/stock'; });
      await q.locator('#page-fermee').waitFor({ state: 'detached', timeout: 3_000 }).catch(() => undefined);
      expect(await q.locator('#page-fermee').count()).toBe(0);
      await q.context().close();
    } finally {
      await admin.query('delete from plateforme.module_etat where entreprise = $1', [x.ent]);
      await admin.end();
    }
  }, 120_000);

  it('1.388.70 : fermée chez une entreprise qui a des salariés, la paie passe EN PAUSE — la page reste, tout se lit, seule la création attend', async () => {
    const x = await monter();
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try {
      const par = String((await admin.query('select id from socle.utilisateur limit 1')).rows[0]?.id);
      await admin.query(`insert into plateforme.module_etat (module, entreprise, etat, motif, le, par, message) values ('paie', $1, 'ferme', 'Un défaut grave', now(), $2, 'La paie revient demain matin, après une correction.')`, [x.ent, par]);
      const p = await ouvrir(x);
      expect(await p.evaluate(() => (window as unknown as { __pause: string[] }).__pause)).toEqual(expect.arrayContaining(['paie']));
      expect(await p.evaluate(() => (window as unknown as { __ferme: string[] }).__ferme)).not.toContain('paie');
      // La page est là, avec ses salariés, et le bandeau le dit.
      expect(await p.locator('#page-fermee').count()).toBe(0);
      await p.locator('#pause-banner').waitFor({ timeout: 10_000 });
      expect(espace(await p.locator('#pause-banner').innerText())).toContain('Tout ce que tu y as saisi reste là');
      expect(espace(await p.locator('#pause-banner').innerText())).toContain('La paie revient demain matin, après une correction.');
      expect(espace(await p.locator('#view').innerText())).toContain('Mourad Trabelsi');
      await p.screenshot({ animations: 'disabled', path: path.join(RACINE, 'dist/photos', 'v10-module-en-pause.png') });
      // Créer un salarié : refusé, avec la même phrase rassurante.
      const b = p.locator('#p-embaucher, #new-emp').first();
      if (await b.count()) {
        await b.click();
        await p.getByRole('heading', { name: 'Cette partie est en pause' }).waitFor({ timeout: 5_000 });
        expect(espace(await p.locator('.modal').last().innerText())).toContain('Rien de ce que tu y as saisi n\'est perdu');
        await p.screenshot({ animations: 'disabled', path: path.join(RACINE, 'dist/photos', 'v10-module-en-pause-creer.png') });
      }
      expect(erreurs).toEqual([]);
      await p.context().close();
    } finally {
      await admin.query('delete from plateforme.module_etat where entreprise = $1', [x.ent]);
      await admin.end();
    }
  }, 120_000);
});
