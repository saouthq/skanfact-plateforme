// 1.256.0 — les gestes de la paie que le métier demandait (docs/etudes/paie-concurrents.md ; docs/paie-ecarts-maquette.md),
// à la souris, écran ET serveur :
//   - la fin de la période d'essai arrive dans « À traiter » ; « Le confirmer dans son poste » note la date sur la fiche,
//     ouvre le courrier, et la ligne s'en va ;
//   - « Les primes et retenues du mois » : une case de la grille (un salarié, une rubrique) entre au bulletin établi du mois,
//     qui se refait ; le total de la colonne se lit avant d'enregistrer ;
//   - « Augmenter les salaires » : + 10 % pour ceux qu'on coche, dès le mois ; la fiche garde l'ancien salaire, celui qu'on
//     a décoché ne bouge pas.
//   - (03/11/2026, 16 § 10.1 point 1) en février 2027, « Barèmes de 2027 pas encore relus » se lit sur la page et dans la
//     fenêtre « Établir », avant le geste ; les bulletins de janvier partent sans CSS, et le serveur les accepte ;
//   - (03/11/2026, 16 § 10.1 point 11) « Un départ… » du menu ⋯ ouvre la sortie du salarié, et « Mettre sa sortie… » de la
//     journée, son heure de sortie : chacun sa fenêtre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown; round3: (n: number) => number };
const RIB = '08100123456789012359';

describe('la paie 1.256.0 : fin d\'essai, primes du mois, augmentation en lot', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1256-'));
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
  const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Record<string, unknown>)['~n']) : Number(v));
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
    for (const e of S) await poser('employees', e.id, e);
    for (const b of [...S.map((e) => bul(e, an, mo)), ...S.map((e) => bul(e, anA, moA, { paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28` }))]) await poser('payslips', b.id, b);
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: 'sans' } }] });
    return { j, ent, an, mo };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string }, heure?: Date) => {
    erreurs.length = 0;
    const cx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    if (heure) await cx.clock.setFixedTime(heure);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}#/paie`);
    await p.locator('#p-head').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    await p.waitForTimeout(400);
    return p;
  };
  const auServeur = async (x: { j: string; ent: string }, collection: string, cle: string) => {
    const o = (await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    return o.find((y) => y.collection === collection && y.cle === cle)?.contenu;
  };
  const fermerTout = async (p: Page) => { for (let i = 0; i < 4 && await p.locator('#modal-root .modal').count(); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); } };

  it('la fin d\'essai : « À traiter » la dit, « Le confirmer dans son poste » la note et ouvre le courrier', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    const ligne = p.locator('#p-traiter li').filter({ hasText: 'La période d\'essai de Nadia Ben Salah finit le' }).locator('[data-traiter]');
    await expect.poll(() => ligne.count()).toBe(1);
    await ligne.click();
    await p.locator('#fe-ok').click();
    // Le courrier de fin de période d'essai s'ouvre, prêt à signer.
    await expect.poll(() => p.locator('#modal-root').innerText().then(espace)).toMatch(/période d'essai/i);
    await expect.poll(async () => (await auServeur(x, 'employees', 'nb'))?.essaiConfirmeLe).toBe(new Date().toISOString().slice(0, 10));
    await fermerTout(p);
    await expect.poll(() => p.locator('#p-body li').filter({ hasText: 'La période d\'essai de Nadia' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('les primes et retenues du mois : une case de la grille entre au bulletin établi, qui se refait', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    // 1.259.0 : les primes du mois vivent dans « Le mois », l'onglet ouvre « La journée ».
    await p.locator('#p-sous [data-sous="pointage"]').click();
    await p.locator('#pv-carte-ouvrir').click();
    const caseP = p.locator('#pv-t tr[data-pv="mt"] [data-pv-r="panier"]');
    await caseP.fill('45,575');
    await expect.poll(() => p.locator('[data-pv-tot="panier"]').innerText().then(espace)).toBe('45,575 DT');
    await p.locator('#pv-ok').click();
    const id = `p-mt-${x.an}-${x.mo}`;
    await expect.poll(async () => ((await auServeur(x, 'payslips', id))?.bonuses as { label: string; amount: unknown }[] | undefined)?.map((b) => [b.label, nombre(b.amount)])).toEqual([['Indemnité de panier', 45.575]]);
    const b = await auServeur(x, 'payslips', id);
    expect(nombre((b?.computed as Record<string, unknown>).gross)).toBe(compta.round3(1450.375 + 45.575));
    // La fiche garde le montant du mois, pour un bulletin qui serait refait plus tard.
    expect(((await auServeur(x, 'employees', 'mt'))?.variables as { mois: string; amount: unknown }[]).map((v) => [v.mois, nombre(v.amount)])).toEqual([[`${x.an}-${String(x.mo).padStart(2, '0')}`, 45.575]]);
    // Nadia n'a rien : son bulletin ne bouge pas.
    expect((await auServeur(x, 'payslips', `p-nb-${x.an}-${x.mo}`))?.bonuses).toEqual([]);
    expect(erreurs).toEqual([]);
  }, 120_000);

  // 16 § 10.1, point 7 (03/11/2026) : le serveur refuse ce qui touche la paie d'une période close ; l'écran le dit avant le
  // geste. Un bulletin d'un mois clos se tient comme un bulletin payé : ses primes ne s'y écrivent pas, une augmentation y
  // porte un rappel sur le premier mois ouvert, une demande de congé ne s'y accepte pas.
  it('une période clôturée tient comme un mois payé : primes du mois fermées, rappel sur le mois ouvert, demande refusée avant le geste', async () => {
    const x = await monter();
    const mm = String(x.mo).padStart(2, '0');
    // Clos jusqu'à la fin du mois PROCHAIN : le rappel saute aussi ce mois-là (pas de bulletin, mais clos) et va au suivant.
    const fin = new Date(Date.UTC(x.an, x.mo + 1, 0)).toISOString().slice(0, 10);
    const suivant = x.mo >= 11 ? { an: x.an + 1, mo: x.mo - 10 } : { an: x.an, mo: x.mo + 2 };
    await api('POST', `/entreprises/${x.ent}/dossier-v10`, x.j, { changements: [
      { collection: 'leaves', cle: 'l9', rang: null, revision: null, contenu: { id: 'l9', employeeId: 'nb', kind: 'conges', from: `${x.an}-${mm}-10`, to: `${x.an}-${mm}-11`, paid: null, note: '', statut: 'demande', demandeLe: `${x.an}-${mm}-02` } },
      { collection: '_racine', cle: 'closedUntil', rang: null, revision: null, contenu: fin }] });
    const p = await ouvrir(x);
    // Les primes du mois : la case de Mourad se lit, sans s'écrire.
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#p-sous [data-sous="pointage"]').click();
    await p.locator('#pv-carte-ouvrir').click();
    const ligne = p.locator('#pv-t tr[data-pv="mt"]');
    expect(espace(await ligne.innerText())).toContain('bulletin d\'une période clôturée : il ne change plus');
    expect(await ligne.locator('[data-pv-r="panier"]').isDisabled()).toBe(true);
    await fermerTout(p);
    // L'augmentation dès ce mois : le bulletin du mois clos ne se refait pas, le rappel va sur le mois suivant.
    await p.locator('#p-plus').click();
    await p.locator('.row-menu').last().getByText('Augmenter les salaires…', { exact: true }).click();
    await p.locator('#al [name=valeur]').fill('10');
    await p.locator('[data-al-c="nb"]').uncheck();
    await p.locator('#al-ok').click();
    await expect.poll(() => p.locator('#modal-root .rp-intro').innerText().then(espace).catch(() => '')).toContain('Les bulletins déjà payés ou d\'une période clôturée');
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][suivant.mo - 1] ?? '';
    expect(espace(await p.locator('#rp-ok').innerText())).toBe(`Mettre le rappel sur ${mois}`);
    await p.locator('#rp-ok').click();
    const rappel = compta.round3(compta.round3(1450.375 * 1.1) - 1450.375);
    await expect.poll(async () => ((await auServeur(x, 'employees', 'mt'))?.regularisations as { pourMois: string; amount: unknown }[] | undefined)?.map((r) => [r.pourMois, nombre(r.amount)])).toEqual([[`${suivant.an}-${String(suivant.mo).padStart(2, '0')}`, rappel]]);
    expect(nombre(((await auServeur(x, 'payslips', `p-mt-${x.an}-${x.mo}`))?.computed as Record<string, unknown>).gross)).toBe(1450.375);
    // La demande de congé du mois clos : la période clôturée le dit, la demande reste à répondre.
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#p-sous [data-sous="conges"]').click();
    await p.locator('[data-dem-oui="l9"]').click();
    await expect.poll(() => p.locator('#modal-root .modal h2').last().innerText().then(espace).catch(() => '')).toBe('Période clôturée');
    expect(espace(await p.locator('#modal-root .modal').last().innerText())).toContain('Cette demande porte la date du 10/');
    await fermerTout(p);
    await p.waitForTimeout(500);
    expect((await auServeur(x, 'leaves', 'l9'))?.statut).toBe('demande');
    expect(erreurs).toEqual([]);
  }, 150_000);

  it('augmenter les salaires : + 10 % pour Mourad seul, dès ce mois ; sa fiche garde l\'ancien salaire', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-plus').click();
    await p.locator('.row-menu').last().getByText('Augmenter les salaires…', { exact: true }).click();
    await p.locator('#al [name=valeur]').fill('10');
    await p.locator('[data-al-c="nb"]').uncheck();
    const attendu = compta.round3(1450.375 * 1.1);
    await expect.poll(() => p.locator('tr[data-al="mt"] [data-al-ap]').innerText().then(espace)).toBe(`${attendu.toFixed(3).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/, ' ')} DT`);
    expect(await p.locator('tr[data-al="nb"] [data-al-ap]').innerText()).toBe('—');
    expect(espace(await p.locator('#al-ok').innerText())).toBe('Augmenter 1 salarié');
    await p.locator('#al-ok').click();
    await expect.poll(async () => nombre((await auServeur(x, 'employees', 'mt'))?.grossSalary)).toBe(attendu);
    const h = ((await auServeur(x, 'employees', 'mt'))?.salaires as { des: string; brut: unknown; avant: unknown }[]).map((s) => [s.des, nombre(s.brut), nombre(s.avant)]);
    expect(h).toEqual([[`${x.an}-${String(x.mo).padStart(2, '0')}`, attendu, 1450.375]]);
    expect(nombre((await auServeur(x, 'employees', 'nb'))?.grossSalary)).toBe(880.125);
    expect(erreurs).toEqual([]);
  }, 120_000);
  // 16 § 10.1, point 11 (03/11/2026) : « Un départ… » du menu ⋯ appelait la fonction de l'heure de sortie du pointage
  // (1.259.0 lui avait donné le même nom que la fenêtre du départ, et la page Paie la cachait) : le choix du salarié
  // fermait sa fenêtre et rien ne s'ouvrait (« iso.slice is not a function »). Les deux chemins, chacun sa fenêtre.
  it('« Un départ… » du menu ⋯ ouvre la sortie du salarié choisi ; « Mettre sa sortie… » de la journée, son heure de sortie', async () => {
    const x = await monter();
    // Nadia a badgé son entrée aujourd'hui, pas sa sortie ; sans équipe, aucune heure n'est proposée : « Mettre sa sortie… ».
    const d = new Date(), jj = d.getDate();
    await api('POST', `/entreprises/${x.ent}/dossier-v10`, x.j, { changements: [{ collection: 'timesheets', cle: 'ts-nb-badge', rang: null, revision: null,
      contenu: enc({ id: 'ts-nb-badge', employeeId: 'nb', year: d.getFullYear(), month: d.getMonth() + 1, jours: {}, hs: {}, badges: { [String(jj)]: { h: ['08:05'] } } }) }] });
    const p = await ouvrir(x);
    // Le départ, depuis le menu ⋯ de la page : la fenêtre de la sortie de Mourad, pas celle d'une heure.
    await p.locator('#p-plus').click();
    await p.locator('.row-menu').last().getByText('Un départ…', { exact: true }).click();
    await p.locator('#cs-l [data-cs="mt"]').click();
    await expect.poll(() => p.locator('#so').count()).toBe(1);
    expect(espace(await p.locator('.modal h2').last().innerText())).toBe('La sortie de Mourad Trabelsi');
    expect(await p.locator('#sof').count()).toBe(0);
    await p.locator('#so .datefield:has(input[name=endDate]) input.d-txt').fill('31/10/2026');
    await p.locator('#so .datefield:has(input[name=endDate]) input.d-txt').press('Tab');
    await p.locator('#so input[name=motif][value=demission]').check();
    // Embauché le 10/03/2023, parti le 31/10/2026 : 3 ans et 7 mois.
    expect(espace(await p.locator('#so-anc').innerText())).toBe('Ancienneté au dernier jour : 3 ans et 7 mois.');
    await p.locator('#so-ok').click();
    await expect.poll(async () => (await auServeur(x, 'employees', 'mt'))?.sortieMotif).toBe('demission');
    expect((await auServeur(x, 'employees', 'mt'))?.endDate).toBe('2026-10-31');
    // L'heure de sortie, depuis la journée : sa fenêtre à elle, et la sortie se note sur le badge du jour.
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#ptj [data-ptj-sortie="nb"]').click();
    await expect.poll(() => p.locator('#sof').count()).toBe(1);
    expect(await p.locator('#so').count()).toBe(0);
    await p.locator('#sof [name=h]').fill('17:35');
    await p.locator('#sof-ok').click();
    await expect.poll(async () => ((await auServeur(x, 'timesheets', 'ts-nb-badge'))?.badges as Record<string, { sortieMain?: string }> | undefined)?.[String(jj)]?.sortieMain).toBe('17:35');
    expect(erreurs).toEqual([]);
  }, 120_000);
  // 16 § 10.1, point 1 (03/11/2026) : la CSS de 0,5 % ne vaut que pour 2026 (À VÉRIFIER) ; en 2027, sans loi de finances
  // relue, la page le dit avant d'établir, et les bulletins n'en retiennent aucune (le serveur refuserait le contraire).
  it('janvier 2027 à la souris : « Barèmes de 2027 pas encore relus » lu avant d\'établir, les bulletins sans CSS au serveur', async () => {
    const x = await monter();
    const p = await ouvrir(x, new Date('2027-02-10T10:00:00+01:00'));
    await expect.poll(() => p.locator('#p-relus').innerText().then(espace).catch(() => '')).toContain('Barèmes de 2027 pas encore relus.');
    expect(espace(await p.locator('#p-relus').innerText())).toBe('Barèmes de 2027 pas encore relus. SkanFact n\'a pas encore lu la loi de finances 2027 : les bulletins de janvier ne retiennent aucune contribution sociale de solidarité (sa règle s\'arrête le 31/12/2026) et gardent les autres taux de tes réglages. À VÉRIFIER avec ton comptable avant de payer.');
    await p.locator('#p-gen').click();
    await expect.poll(() => p.locator('#p-etab-relus').count()).toBe(1);
    expect(espace(await p.locator('#p-etab-relus').innerText())).toContain('Barèmes de 2027 pas encore relus.');
    await p.locator('.modal:has(#p-etab-relus) #ok').click();
    const deJanvier = async () => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'payslips' && o.contenu.year === 2027 && o.contenu.month === 1).map((o) => o.contenu);
    await expect.poll(async () => (await deJanvier()).length, { timeout: 20_000 }).toBe(2);
    const mt = (await deJanvier()).find((b) => b.employeeId === 'mt') as { computed: Record<string, unknown> };
    expect([nombre(mt.computed.css), mt.computed.cssFinie, nombre((mt.computed.bareme as Record<string, unknown>).solidarity)]).toEqual([0, '2026-12-31', 0]);
    // Le même calcul que le moteur, au millime : sans CSS, le net de Mourad (1 450,375, chef de famille, deux enfants).
    const attendu = compta.computePayslip({ ...{ grossSalary: 1450.375, headOfFamily: true, children: 2 } }, { gross: 1450.375, workedDays: 26, absentDays: 0, bonuses: [], deductions: [], year: 2027, month: 1 }, compta.baremesPaie({}));
    expect(nombre(mt.computed.net)).toBe(attendu.net);
    expect(attendu.css).toBe(0);
    expect(erreurs).toEqual([]);
  }, 120_000);
});
