// La paie avec un cabinet dans les écrans du quotidien (1.268.0 ; Skander, 04/11/2026 ; docs/paie.md, « La paie et son
// cabinet »). Ce que le parcours vérifie, à l'écran et au serveur :
//   - paie TENUE par le cabinet : chaque étape du mois dit qui la fait (toi, ton comptable) ; le bouton vert ne propose que
//     les gestes du gérant : « Envoyer le pointage d'octobre au cabinet » (valider le mois, c'est l'envoyer), jamais
//     « Établir les bulletins » ; une fois envoyé, l'étape des bulletins dit que le cabinet les prépare, et rien n'attend le
//     gérant ;
//   - paie VÉRIFIÉE par le cabinet : les étapes le disent ; payer avant sa relecture se peut, et la fenêtre le dit avant
//     le geste, en comptant les bulletins qu'il n'a pas encore vérifiés.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown };
const RIB = '08100123456789012359';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

describe('la paie 1.268.0 : avec un cabinet, chaque étape dit qui la fait', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-268-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    nav = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
    await admin.connect();
  }, 120_000);
  afterAll(async () => { await admin.end(); await nav?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  const api = async (m: string, c: string, j?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${c}`, { method: m, headers: { ...(j ? { authorization: `Bearer ${j}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    const t = await r.text(); return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
  };
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const mm = (m: number) => String(m).padStart(2, '0');

  // Deux salariés ; le mois d'avant (`mo`) est fini. Le mois d'encore avant (`moA`) a été payé, et il garde la trace du
  // cabinet (son accord en paie tenue, une correction répondue en paie vérifiée) : sans trace, la paie se dit « seule ».
  const monter = async (mode: 'tenue' | 'seule') => {
    const email = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra', motDePasse: 'Un-bon-mot-de-passe' });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = new Date();
    const an = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mo = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const anA = mo === 1 ? an - 1 : an, moA = mo === 1 ? 12 : mo - 1;
    const sal = (id: string, name: string, grossSalary: number) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger' });
    const S = [sal('mt', 'Mourad Trabelsi', 1450.375), sal('nb', 'Nadia Ben Salah', 880.125)];
    const bul = (e: (typeof S)[number], y: number, m: number, x: Record<string, unknown> = {}) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28`, ...x };
    };
    for (const e of S) await poser('employees', e.id, e);
    for (const e of S) {
      const trace = mode === 'tenue' ? { pourAccordLe: `${anA}-${mm(moA)}-26`, bonAPayerLe: `${anA}-${mm(moA)}-27` }
        : { verifieLe: `${anA}-${mm(moA)}-27`, ...(e.id === 'mt' ? { correction: { par: 'Anis', le: `${anA}-${mm(moA)}-27T10:00:00Z`, titre: 'la prime de Mourad', reponse: 'acceptee', reponduLe: `${anA}-${mm(moA)}-27T11:00:00Z` } } : {}) };
      await poser('payslips', `p-${e.id}-${anA}-${moA}`, bul(e, anA, moA, { ...trace, paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28` }));
      // (1.274.0, audit G05) La validation ne vient que du cabinet : le jeu d'essai la pose comme son envoi la pose, en base.
      if (mode === 'tenue') {
        await admin.query(`update socle.dossier_v10 set contenu = contenu || jsonb_build_object('valideLe', $3::text) where entreprise = $1 and collection = 'payslips' and cle = $2`,
          [ent, `p-${e.id}-${anA}-${moA}`, `${anA}-${mm(moA)}-27`]);
      }
      // En paie vérifiée, le gérant a établi le mois d'avant ; le cabinet n'en a relu qu'un (celui de Mourad).
      if (mode === 'seule') await poser('payslips', `p-${e.id}-${an}-${mo}`, bul(e, an, mo, e.id === 'mt' ? { verifieLe: `${an}-${mm(mo)}-29` } : {}));
    }
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: mode, paieModeDes: '2020-01' } }] });
    return { j, ent, an, mo, nom: MOIS[mo - 1] ?? '' };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string }) => {
    erreurs.length = 0;
    const p = await (await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    return p;
  };
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const leMois = async (p: Page, x: { an: number; mo: number }) => {
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== x.an; i++) await p.locator(Number(await p.locator('#p-an').innerText()) > x.an ? '#p-an-prec' : '#p-an-suiv').click();
    await p.locator(`#p-mois [data-p-mois="${x.mo}"]`).click();
  };
  const qui = (p: Page) => p.locator('#p-sous .pa-etape').evaluateAll((l) => l.map((e) => (e.querySelector('.pa-qui') as HTMLElement | null)?.innerText || ''));
  const etape = (p: Page, id: string) => p.locator(`#p-sous [data-sous="${id}"] .d`).innerText().then(espace);

  it('paie tenue : tu pointes et tu paies, ton comptable prépare ; le vert ne propose que tes gestes', async () => {
    const x = await monter('tenue'), de = /^[aeiouyéè]/i.test(x.nom) ? `d'${x.nom}` : `de ${x.nom}`;
    const p = await ouvrir(x);
    // « Aujourd'hui » : le mois d'avant a encore une journée à valider ; puis il s'envoie au cabinet (pas « établir »).
    await p.locator('#pj-avant').waitFor();
    expect(espace(await p.locator('#pj-avant').innerText())).toContain('à régler dans le pointage (elle change un montant), puis tu l\'envoies à ton cabinet, qui prépare les bulletins');
    expect(espace(await p.locator('#pj-avant-go').innerText())).toBe(`Régler le pointage ${de}`);
    // « Le mois » : qui fait chaque étape ; l'étape des bulletins attend ton envoi, et n'offre pas « Établir ».
    await leMois(p, x);
    expect(await qui(p)).toEqual(['toi', 'ton comptable', 'toi', 'ton comptable']);
    expect(await etape(p, 'bulletins')).toBe('après l\'envoi de ton pointage');
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await p.locator('#p-envoyer').waitFor();
    expect(await p.locator('#p-gen').count()).toBe(0);
    expect(await p.locator('#p-gen-vide').count()).toBe(0);
    expect(espace(await p.locator('#p-vide').innerText())).toBe(`Aucun bulletin pour ${x.nom} ${x.an} : ton cabinet prépare les 2 bulletins dès que tu lui envoies le pointage.`);
    expect(espace(await p.locator('#p-envoyer').innerText())).toBe('Envoyer d\'abord le pointage au cabinet');
    await p.locator('#p-envoyer').click();
    await expect.poll(() => p.locator('#p-sous .pa-etape.ouverte').getAttribute('data-sous')).toBe('pointage');
    // Les journées du mois validées, « Aujourd'hui » dit le geste qui reste : envoyer le pointage, qui mène à son bouton.
    await p.locator('#pt-jav').click();
    await p.locator('#modal-root #jav-ok').click();
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await expect.poll(async () => espace(await p.locator('#pj-avant').innerText())).toContain('Son pointage attend d\'être validé : c\'est l\'envoyer à ton cabinet, qui prépare les bulletins');
    expect(espace(await p.locator('#pj-avant-go').innerText())).toBe(`Envoyer le pointage ${de} au cabinet`);
    await p.locator('#pj-avant-go').click();
    await expect.poll(() => p.locator('#p-sous .pa-etape.ouverte').getAttribute('data-sous')).toBe('pointage');
    // Valider le mois, c'est l'envoyer : le bouton le dit, le toast aussi.
    await expect.poll(async () => espace(await p.locator('#pt-valider').innerText())).toBe(`Valider le pointage ${de} et l'envoyer au cabinet`);
    await p.locator('#pt-valider').click();
    await expect.poll(async () => espace(await p.locator('#toast').innerText())).toMatch(/verrouillé ; ton cabinet le reçoit et prépare les bulletins/);
    // Son tour : l'étape le dit, le vert attend (il n'est pas à toi), et « Aujourd'hui » n'a plus rien de ce mois à te demander.
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await expect.poll(async () => espace(await p.locator('#p-prep').innerText())).toBe('Ton cabinet prépare les 2 bulletins');
    expect(await p.locator('#p-prep').isDisabled()).toBe(true);
    expect(await p.locator('#p-gen').count()).toBe(0);
    expect(await etape(p, 'bulletins')).toBe('il les prépare, puis te les envoie');
    expect(espace(await p.locator('#p-vide').innerText())).toBe(`Aucun bulletin pour ${x.nom} ${x.an} : ton cabinet prépare les 2 bulletins et te les envoie.`);
    expect(await p.locator('#p-gen-vide').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-268-tenue.png'), fullPage: true });
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#ptj').waitFor();
    expect(await p.locator('#pj-avant').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('paie vérifiée : tu fais tout, ton comptable relit ; payer avant sa relecture se peut, la fenêtre le dit avant', async () => {
    const x = await monter('seule');
    const p = await ouvrir(x);
    await leMois(p, x);
    expect(await qui(p)).toEqual(['toi', 'toi, ton comptable vérifie', 'toi', 'toi']);
    await p.locator('#p-sous [data-sous="payer"]').click();
    await p.locator('#p-payer').click();
    await p.locator('#modal-root #ps-pas-verifie').waitFor();
    expect(espace(await p.locator('#modal-root #ps-pas-verifie').innerText())).toBe('Ton cabinet n\'a pas encore vérifié un de ces bulletins Tu peux payer quand même. S\'il trouve une erreur, elle se corrige sur le bulletin suivant.');
    // L'avertissement est avant le geste : « Marquer payés » reste offert.
    expect(await p.locator('#modal-root #ps-payer').isEnabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-268-verifiee.png') });
    expect(erreurs).toEqual([]);
  }, 120_000);

  // (1.270.0) Skander, 04/11 : « es ce que t'as pensé aux personnes qui n'ont pas un comptable sur SkanFact ». Une
  // entreprise en paie tenue quitte son cabinet : ses anciens bulletins portent encore l'accord du cabinet, mais plus
  // personne ne prépare ses bulletins. La paie redevient la sienne : « Établir », sans « ton comptable » ni envoi.
  it('le cabinet parti : la paie tenue redevient la tienne, malgré les anciens bulletins du cabinet', async () => {
    const x = await monter('tenue');
    const email = `cab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Anis', motDePasse: 'Un-bon-mot-de-passe' });
    const ja = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', ja, { methode: 'application' });
    const c = await api('POST', '/cabinets', ja, { nom: 'Cabinet Ennour' });
    const mandat = String((await api('POST', `/entreprises/${x.ent}/mandat`, x.j, { codeCabinet: String(c.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(c.corps.id)}/mandats/${mandat}/accepter`, ja)).statut).toBe(200);
    expect((await api('GET', `/entreprises/${x.ent}/messages/attente`, x.j)).corps).toMatchObject({ cabinet: c.corps.id });
    expect((await api('DELETE', `/entreprises/${x.ent}/mandat`, x.j)).statut).toBe(200);
    expect((await api('GET', `/entreprises/${x.ent}/messages/attente`, x.j)).corps).toMatchObject({ cabinet: null, cabinetQuitte: true });
    const p = await ouvrir(x);
    await leMois(p, x);
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await expect.poll(async () => espace(await p.locator('#p-gen, #p-regler').first().innerText().catch(() => ''))).toMatch(/^(Établir les 2 bulletins|Régler d'abord)/);
    expect(await p.locator('#p-sous .pa-qui').count()).toBe(0);
    expect(await p.locator('#p-envoyer, #p-prep').count()).toBe(0);
    expect(espace(await p.locator('#p-body').innerText())).not.toMatch(/ton cabinet|ton comptable/i);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-270-cabinet-parti.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 120_000);
});
