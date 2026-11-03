// 1.259.0 — la refonte du pointage (docs/maquettes/pointage.html, validée par Skander le 02/11/2026), à la souris, écran ET
// serveur :
//   - « La journée » : un clic sur un choix de la ligne ; Absent, Retard ouvrent la case, « Heures sup » demande combien et
//     les ajoute au mois ; ce que le bulletin en fera se lit sur la ligne ; valider fige la journée, « Rouvrir » la rend ;
//   - « Le mois » : une seule liste « À régler » (les journées à la main pas validées), le même chiffre sur l'onglet, et UNE
//     règle : le mois attend sa dernière journée et une liste vide, puis se valide ;
//   - les 4 questions : écrites seulement à « C'est réglé », et défaites d'un geste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown };
const RIB = '08100123456789012359';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

describe('la paie 1.259.0 : la journée, le mois en relecture, une seule règle de validation, les 4 questions', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1259-'));
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
  const mm = (m: number) => String(m).padStart(2, '0');
  const personne = async (prefixe: string, nom: string) => {
    const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    return j;
  };
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
  const objets = async (x: { j: string; ent: string }) => (await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as Objet[];
  const racine = async (x: { j: string; ent: string }, cle: string) => (await objets(x)).find((o) => o.collection === '_racine' && o.cle === cle)?.contenu as unknown;

  // Deux salariés, l'équipe pointée à la main ; les bulletins du mois dernier payés, ceux du mois établis (sauf `sansCeMois`).
  const monter = async (o: { sansCeMois?: boolean } = {}) => {
    const j = await personne('g', 'Sarra');
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = new Date(), an = auj.getUTCFullYear(), mo = auj.getUTCMonth() + 1;
    const anA = mo === 1 ? an - 1 : an, moA = mo === 1 ? 12 : mo - 1;
    const sal = (id: string, name: string, grossSalary: number, x: Record<string, unknown> = {}) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', cin: '05118204', gender: 'm', equipeId: 'q1', ...x });
    const S = [sal('mt', 'Mourad Trabelsi', 1450.375, { headOfFamily: true, children: 2 }), sal('nb', 'Nadia Ben Salah', 880.125, { position: 'Vendeuse', gender: 'f', iban: '08100987654321098714' })];
    const bul = (e: (typeof S)[number], y: number, m: number, x: Record<string, unknown> = {}) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28`, ...x };
    };
    await poser('_racine', 'payrollSettings', { hsMaj1: 25, heuresMois: 208, equipes: [{ id: 'q1', nom: 'Le fournil, la nuit', debut: '03:00', fin: '11:00', jours: [0, 1, 2, 3, 4, 5, 6], pointe: 'main' }] });
    for (const e of S) await poser('employees', e.id, e);
    const B = [...S.map((e) => bul(e, anA, moA, { paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28` })), ...(o.sansCeMois ? [] : S.map((e) => bul(e, an, mo)))];
    for (const b of B) await poser('payslips', b.id, b);
    const f = (await objets({ j, ent })).find((x) => x.collection === '_racine' && x.cle === 'company');
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
  // Le mois dernier dans la bande des douze mois (l'année d'avant en janvier).
  const auMoisDernier = async (p: Page, x: { an: number; anA: number; moA: number }) => {
    if (x.anA !== x.an) { await p.locator('#p-an-prec').click(); await p.waitForTimeout(300); }
    await p.locator(`#p-mois [data-p-mois="${x.moA}"]`).click();
    await p.waitForTimeout(400);
  };
  const toast = (p: Page) => p.locator('#toast').innerText().then(espace);

  it('la journée : Absent, Retard et Heures sup disent ce que le bulletin en fera ; valider la fige, « Rouvrir » la rend', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#ptj').waitFor();
    expect(await p.locator('[data-sous="pt-jour"]').getAttribute('aria-selected')).toBe('true');
    const iso = new Date().toISOString().slice(0, 10), d = Number(iso.slice(8, 10)), ym = iso.slice(0, 7);
    const ligne = (id: string) => p.locator(`#ptj [data-ptj-e="${id}"]`);
    const tsDe = async (id: string) => (await objets(x)).find((o) => o.collection === 'timesheets' && o.contenu.employeeId === id && `${o.contenu.year}-${mm(Number(o.contenu.month))}` === ym)?.contenu as Record<string, Record<string, unknown>> | undefined;
    // Nadia absente : la case s'ouvre sur « Absent, sans solde » ; un jour de son brut (880,125 / 26 = 33,851) se lit sur sa ligne.
    await ligne('nb').getByRole('button', { name: 'Absent', exact: true }).click();
    expect(await p.locator('#pc input[name=code]:checked').getAttribute('value')).toBe('A');
    await p.locator('#pc-ok').click();
    await expect.poll(async () => (await tsDe('nb'))?.jours?.[String(d)], { timeout: 15_000 }).toBe('A');
    expect(espace(await ligne('nb').locator('.ptj-e').innerText())).toBe('− 33,851 DT sur son brut');
    // Mourad, 2 h sup : elles s'ajoutent au mois ; 1 450,375 × 2 × 1,25 / 208 = 17,432.
    await ligne('mt').getByRole('button', { name: 'Heures sup', exact: true }).click();
    await p.locator('#hsj [name=heures]').fill('2');
    await expect.poll(async () => espace(await p.locator('#hsj-dit').innerText())).toBe('+ 17,432 DT sur son brut du mois.');
    await p.locator('#hsj-ok').click();
    await expect.poll(async () => (await tsDe('mt'))?.hs?.['25'], { timeout: 15_000 }).toBe(2);
    expect(espace(await ligne('mt').locator('.ptj-e').innerText())).toBe('+ 2 h à +25 % · + 17,432 DT');
    expect(await ligne('mt').locator('[aria-pressed="true"]').innerText()).toBe('Heures sup');
    // Un retard de Mourad : la case s'ouvre, le curseur sur les minutes ; noté, pas retenu (le réglage est éteint).
    await ligne('mt').getByRole('button', { name: 'Retard', exact: true }).click();
    expect(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe('retard');
    await p.locator('#pc [name=retard]').fill('25');
    await p.locator('#pc-ok').click();
    await expect.poll(async () => (await tsDe('mt'))?.retards?.[String(d)], { timeout: 15_000 }).toBe(25);
    // « Présent » remet la journée à la normale : le retard et les heures sup du jour s'en vont, du jour et du mois.
    await ligne('mt').getByRole('button', { name: 'Présent', exact: true }).click();
    await expect.poll(async () => { const t = await tsDe('mt'); return [t?.retards?.[String(d)], t?.hs?.['25']]; }, { timeout: 15_000 }).toEqual([undefined, undefined]);
    expect(espace(await ligne('mt').locator('.ptj-e').innerText())).toBe('rien ne change');
    // Valider : la journée est figée (ses choix ne se cliquent plus), « Rouvrir la journée » la rend.
    const valides = async () => ((await racine(x, 'joursValides')) as { iso: string; rouvertLe?: string }[] | undefined) ?? [];
    expect(espace(await p.locator('#ptj-valider').innerText())).toBe('Tout le reste est là : valider la journée');
    await p.locator('#ptj-valider').click();
    await expect.poll(async () => (await valides()).filter((v) => v.iso === iso && !v.rouvertLe).length).toBe(1);
    await p.locator('#ptj-valide').waitFor();
    expect(await ligne('nb').getByRole('button', { name: 'Absent', exact: true }).isDisabled()).toBe(true);
    await p.locator('#ptj-rouvrir').click();
    await expect.poll(async () => (await valides()).filter((v) => v.iso === iso && !v.rouvertLe).length).toBe(0);
    expect(await ligne('nb').getByRole('button', { name: 'Présent', exact: true }).isDisabled()).toBe(false);
    // Au téléphone : les choix se cachent, un nom touché les ouvre en grand.
    await p.setViewportSize({ width: 390, height: 844 });
    expect(await ligne('mt').locator('.ptj-seg').isVisible()).toBe(false);
    await ligne('mt').locator('.ptj-tel').click();
    await p.locator('#ptjc').waitFor();
    expect(await p.locator('#ptjc [data-ptjc]').count()).toBe(6);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('le mois : « À régler » tient tout ce qui bloque, l\'onglet dit le même chiffre ; le mois se valide une fois la liste vide', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('[data-sous="pointage"]').click();
    await p.locator('#pt-prog').waitFor();
    // Le mois du jour attend sa dernière journée (sauf le dernier jour du mois, où la journée du jour reste à valider).
    const auj = new Date(), dernier = new Date(Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth() + 1, 0)).getUTCDate();
    if (auj.getUTCDate() < dernier) expect(espace(await p.locator('#pt-valider').innerText())).toBe(`Valider le mois le ${dernier}, après sa dernière journée`);
    // Le mois dernier : toutes ses journées pointées à la main attendent ; UNE chose à régler, et l'onglet dit 1.
    await auMoisDernier(p, x);
    const n = new Date(Date.UTC(x.anA, x.moA, 0)).getUTCDate();
    await expect.poll(async () => p.locator('#pt-aregler li').count()).toBe(1);
    expect(espace(await p.locator('#pt-aregler li b').first().innerText())).toMatch(new RegExp(`^${n} journées pas encore validées`));
    expect(espace(await p.locator('[data-sous="pointage"] .pm-nb').innerText())).toBe('1');
    const bouton = p.locator('#pt-valider');
    expect(espace(await bouton.innerText())).toBe('Régler la dernière chose, puis valider le mois');
    await bouton.click({ force: true });
    await expect.poll(() => toast(p)).toMatch(/^Règle d'abord la chose de « À régler »/);
    const versions = async () => (await objets(x)).filter((o) => o.collection === 'pointageVersions').map((o) => o.contenu.ym);
    expect(await versions()).toEqual([]);
    // « Les relire et les valider… » : les n journées d'un geste ; la liste se vide, l'onglet aussi, le bouton devient le principal.
    await p.locator('#pt-jav').click();
    expect(await p.locator('#jav-l li').count()).toBe(n);
    await p.locator('#jav-ok').click();
    await p.locator('#pt-aregler-ok').waitFor();
    // Une journée validée ne se change plus, même depuis la grille : la case le dit, sans s'ouvrir, et offre de la rouvrir.
    await p.locator('#pt-vue-grille').click();
    await p.locator('#pt-grille .pt-c[data-pt="1"]:not([disabled])').first().click();
    await expect.poll(() => toast(p)).toMatch(/^La journée du 01\/\d\d est validée/);
    expect(await p.locator('#pc').count()).toBe(0);
    expect(await p.locator('#toast-undo').innerText()).toBe('Rouvrir la journée');
    await p.locator('#pt-vue-ecarts').click();
    expect(await p.locator('[data-sous="pointage"] .pm-nb').count()).toBe(0);
    expect(espace(await bouton.innerText())).toBe(`Valider le pointage ${/^[aeiouyéè]/i.test(MOIS[x.moA - 1] ?? '') ? 'd\'' : 'de '}${MOIS[x.moA - 1]}`);
    expect(await bouton.getAttribute('class')).toContain('btn-primary');
    await bouton.click();
    await expect.poll(versions, { timeout: 15_000 }).toEqual([`${x.anA}-${mm(x.moA)}`]);
    // « Ce qui change » : les deux salariés, présents à leurs horaires ; la vue grille se lit à un clic et revient.
    await p.locator('#pt-valide').waitFor();
    expect(await p.locator('#pt-exc [data-pt-son]').count()).toBe(2);
    await p.locator('#pt-vue-grille').click();
    await p.locator('#pt-grille').waitFor();
    await p.locator('#pt-vue-ecarts').click();
    await p.locator('#pt-exc').waitFor();
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('les 4 questions : rien ne s\'écrit avant « C\'est réglé », et tout se défait d\'un geste', async () => {
    const x = await monter({ sansCeMois: true });
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#ptj').waitFor();
    // `ouvrir` a rangé les bandeaux (« Plus tard ») : les questions s'ouvrent aussi depuis « Les horaires ».
    await p.locator('[data-sous="pt-horaires"]').click();
    await p.locator('#pt-h-q').click();
    await p.locator('#pq-c').waitFor();
    await p.locator('#pq-f input[name=pointe][value=pointeuse]').check();
    await p.locator('#pq-ok').click();
    expect(await p.locator('#pq-c h3').innerText()).toBe('Tes jours de travail et tes équipes');
    await p.locator('#pq-ok').click();
    await p.locator('#pq-f input[name=retards][value=retenir]').check();
    await p.locator('#pq-ok').click();
    await p.locator('#pq-f input[name=nuit][value=oui]').check();
    // La plage va par deux : sans sa fin, c'est refusé et rien n'est écrit.
    await p.locator('#pq-f [name=nuitDebut]').fill('21:00');
    await p.locator('#pq-ok').click();
    await expect.poll(() => toast(p)).toBe('La plage de nuit va par deux : son début et sa fin.');
    const ps = async () => (await racine(x, 'payrollSettings')) as { pointageRegle?: string; retenirRetards?: boolean; nuitDebut?: string; nuitFin?: string; equipes: { pointe: string }[] };
    expect((await ps()).pointageRegle).toBeUndefined();
    await p.locator('#pq-f [name=nuitFin]').fill('05:00');
    await p.locator('#pq-ok').click();
    await expect.poll(async () => { const s = await ps(); return [Boolean(s.pointageRegle), s.retenirRetards, s.nuitDebut, s.nuitFin, s.equipes[0]?.pointe]; }, { timeout: 15_000 }).toEqual([true, true, '21:00', '05:00', 'pointeuse']);
    await p.locator('#ptj').waitFor();
    await p.locator('#toast-undo').click();
    await expect.poll(async () => { const s = await ps(); return [s.pointageRegle, s.retenirRetards, s.nuitDebut, s.equipes[0]?.pointe]; }, { timeout: 15_000 }).toEqual([undefined, undefined, undefined, 'main']);
    expect(erreurs).toEqual([]);
  }, 120_000);
  // 16 § 10.1, point 9 (03/11/2026) : `validerJour` ne gardait que les 400 dernières journées validées (`.slice(-400)`) :
  // après treize mois de soirs validés, la plus ancienne redevenait « pas encore validée » et se changeait sans être
  // rouverte. Le 16 § 8 : la validation se garde sans limite de nombre.
  it('une journée validée le reste, même après 400 autres', async () => {
    const x = await monter();
    const auj = new Date().toISOString().slice(0, 10);
    const avant = (k: number) => new Date(Date.parse(`${auj}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
    // 400 soirs déjà validés, du plus ancien (il y a 401 jours) à avant-hier : aujourd'hui n'en est pas.
    const anciens = Array.from({ length: 400 }, (_, i) => { const iso = avant(401 - i); return { iso, le: `${iso}T19:30:00.000Z` }; });
    expect((await api('POST', `/entreprises/${x.ent}/dossier-v10`, x.j, { changements: [{ collection: '_racine', cle: 'joursValides', rang: null, revision: null, contenu: anciens }] })).statut).toBe(200);
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#ptj').waitFor();
    const valides = async () => ((await racine(x, 'joursValides')) as { iso: string; le: string; rouvertLe?: string }[] | undefined) ?? [];
    await p.locator('#ptj-valider').click();
    await expect.poll(async () => (await valides()).some((v) => v.iso === auj && !v.rouvertLe), { timeout: 15_000 }).toBe(true);
    // La 401e s'ajoute ; la plus ancienne est toujours là, telle qu'elle a été validée.
    const L = await valides();
    expect(L.length).toBe(401);
    expect(L.find((v) => v.iso === avant(401))).toEqual({ iso: avant(401), le: `${avant(401)}T19:30:00.000Z` });
    expect(erreurs).toEqual([]);
  }, 120_000);
});
