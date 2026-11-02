// Les écrans de la revue de la paie (1.229.0 à 1.233.0 ; docs/revue-paie.md, lots R2 à R6 ; docs/paie.md, « Revue R2 » et
// suivantes). Ce que le parcours vérifie, écran ET serveur :
//   - un bulletin payé se RÉGULARISE sur le mois suivant : il ne change pas, le bulletin du mois suivant reçoit la somme et se
//     recalcule, la fiche garde la régularisation ;
//   - une saisie sur salaire se note sur la fiche (le créancier, le total, la retenue du mois) et s'y lit ;
//   - « Combien coûte une embauche ? » donne le net et le coût par le calcul des bulletins, sans rien enregistrer ;
//   - les salariés s'importent d'un tableur collé, depuis la page vide ;
//   - un arrêt maladie montre ses papiers, et « À traiter » rappelle son certificat ;
//   - la recherche (Ctrl K) trouve un salarié par son nom et ouvre sa fiche ;
//   - le pointage n'a plus qu'un sélecteur de mois ; sans réseau, la paie le dit et son geste attend.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown };
const RIB = '08100123456789012359';

describe('la paie : les écrans de la revue', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-revue-'));
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

  const monter = async (vide = false) => {
    const email = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
    const S = vide ? [] : [sal('mt', 'Mourad Trabelsi', 1450.375, { headOfFamily: true, children: 2 }), sal('nb', 'Nadia Ben Salah', 880.125, { position: 'Vendeuse' })];
    const bul = (e: (typeof S)[number], y: number, m: number, x: Record<string, unknown> = {}) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28`, ...x };
    };
    for (const e of S) await poser('employees', e.id, e);
    const ceMois = S.map((e) => bul(e, an, mo)), avant = S.map((e) => bul(e, anA, moA, { paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28` }));
    for (const b of [...ceMois, ...avant]) await poser('payslips', b.id, b);
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: 'sans' } }] });
    return { j, ent, an, mo, anA, moA, ceMois, avant, poser };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string }, hash = '#/paie', an?: number, mo?: number) => {
    const p = await (await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}${hash}`);
    await p.locator(hash.startsWith('#/salarie') ? '#fs-head' : '#p-head').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    if (an && mo) { for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== Number(an); i++) await p.locator(Number(await p.locator('#p-an').innerText()) > Number(an) ? '#p-an-prec' : '#p-an-suiv').click(); await p.locator(`#p-mois [data-p-mois="${mo}"]`).click(); }
    await p.waitForTimeout(400);
    return p;
  };
  const objets = async (x: { j: string; ent: string }, collection: string) => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
    .filter((o) => o.collection === collection).map((o) => o.contenu);

  it('un bulletin payé se régularise sur le mois suivant, sans changer', async () => {
    const A = await monter();
    const p = await ouvrir(A, '#/paie', A.anA, A.moA);
    const paye = A.avant.find((b) => b.employeeId === 'mt');
    if (!paye) throw new Error('pas de bulletin payé');
    await p.locator(`#p-bulletins tr[data-bul="${paye.id}"]`).getByRole('button', { name: /Actions/ }).click();
    // Un bulletin payé n'offre plus « Modifier le bulletin » tout court : « Régulariser » d'abord.
    expect(await p.getByText('Modifier le bulletin', { exact: true }).count()).toBe(0);
    await p.getByText('Régulariser sur un mois suivant…', { exact: true }).click();
    expect(espace(await p.locator('.modal').innerText())).toContain('ne change plus');
    await p.locator('#rg-ok').click();
    expect(await p.locator('#rg-refus').isVisible()).toBe(true);
    await p.locator('#rg [name=amount]').fill('45.125');
    await p.locator('#rg [name=motif]').fill('heures oubliées');
    await p.locator('#rg-ok').click();
    const suivant = A.ceMois.find((b) => b.employeeId === 'mt');
    await expect.poll(async () => ((await objets(A, 'payslips')).find((b) => b.id === suivant?.id)?.bonuses as { regulId?: string }[] | undefined)?.some((x) => x.regulId)).toBe(true);
    const B = await objets(A, 'payslips');
    const apres = B.find((b) => b.id === suivant?.id), avant = B.find((b) => b.id === paye.id);
    expect(nombre((apres?.computed as Record<string, unknown>).gross)).toBeCloseTo(1450.375 + 45.125, 3);
    expect(nombre((avant?.computed as Record<string, unknown>).net)).toBeCloseTo(Number(paye.computed.net), 3);
    const e = (await objets(A, 'employees')).find((x) => x.id === 'mt');
    expect((e?.regularisations as { motif: string; amount: unknown }[]).map((r) => [r.motif, nombre(r.amount)])).toEqual([['heures oubliées', 45.125]]);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-regularisation.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('une saisie sur salaire se note et se lit sur la fiche ; la simulation d\'une embauche ; la recherche d\'un salarié', async () => {
    const A = await monter();
    let p = await ouvrir(A, '#/salarie/mt');
    await p.locator('[data-onglet="avances"]').click();
    await p.locator('#add-sz').click();
    await p.locator('#sz-ok').click();
    expect(espace(await p.locator('#sz-refus').innerText())).toContain('Le créancier manque');
    await p.locator('#sz [name=creancier]').fill('Tribunal de Sfax');
    await p.locator('#sz [name=total]').fill('600.45');
    await p.locator('#sz [name=monthly]').fill('200.15');
    await p.locator('#sz-ok').click();
    await expect.poll(async () => ((await objets(A, 'employees')).find((x) => x.id === 'mt')?.saisies as unknown[] | undefined)?.length).toBe(1);
    await p.locator('[data-onglet="avances"]').click();
    expect(espace(await p.locator('#fs-saisies').innerText())).toContain('Tribunal de Sfax');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-saisie-fiche.png') });
    await p.close();
    // Combien coûte une embauche : le calcul des bulletins, rien d'enregistré.
    p = await ouvrir(A);
    const avant = (await objets(A, 'employees')).length;
    await p.locator('#p-plus').click();
    await p.getByText('Combien coûte une embauche ?', { exact: true }).click();
    await p.locator('#se [name=gross]').fill('1234.567');
    const attendu = compta.computePayslip({ grossSalary: 1234.567, contract: 'cdi', headOfFamily: false, children: 0 }, { gross: 1234.567, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] }, compta.baremesPaie({}));
    await expect.poll(async () => espace(await p.locator('#se-calc').innerText())).toContain(Number(attendu.employerCost).toLocaleString('fr-FR', { minimumFractionDigits: 3 }).replace(/[\u00a0\u202f]/g, ' '));
    await p.screenshot({ path: path.join(PHOTOS, 'paie-simulation.png') });
    await p.keyboard.press('Escape');
    expect((await objets(A, 'employees')).length).toBe(avant);
    // La recherche trouve un salarié par son nom et ouvre sa fiche.
    await p.keyboard.press('Control+k');
    await p.locator('#pal-q').fill('nadia');
    await expect.poll(async () => espace(await p.locator('#pal-res').innerText())).toContain('Nadia Ben Salah');
    await p.keyboard.press('Enter');
    await p.locator('#fs-head').waitFor({ timeout: 10_000 });
    expect(espace(await p.locator('#fs-head h1').innerText())).toContain('Nadia Ben Salah');
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('importer ses salariés depuis la page vide ; un arrêt maladie et son certificat ; un seul mois au pointage', async () => {
    const V = await monter(true);
    let p = await ouvrir(V);
    await p.locator('#emp-imp').click();
    await p.locator('#imp-texte').fill('Nom et prénom\tCIN\tDate d\'embauche\tSalaire brut\nMourad Trabelsi\t01234567\t02/01/2024\t1 450,375\nNadia Ben Salah\t07654321\t15/03/2025\t880,125');
    await expect.poll(async () => espace(await p.locator('#imp-ok').innerText())).toBe('Importer 2 salariés');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-import-salaries.png') });
    await p.locator('#imp-ok').click();
    await expect.poll(async () => (await objets(V, 'employees')).length).toBe(2);
    expect((await objets(V, 'employees')).map((e) => [e.name, e.hireDate, nombre(e.grossSalary)]).sort()).toEqual([['Mourad Trabelsi', '2024-01-02', 1450.375], ['Nadia Ben Salah', '2025-03-15', 880.125]]);
    await p.close();
    // Un arrêt maladie : ses papiers, et le rappel du certificat.
    const A = await monter();
    const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await A.poser('leaves', 'lm', { id: 'lm', employeeId: 'nb', kind: 'maladie', from: d(-3), to: d(-2), paid: null, note: '' });
    p = await ouvrir(A, '#/paie', A.an, A.mo);
    await expect.poll(async () => espace(await p.locator('#p-traiter').innerText())).toContain('Nadia Ben Salah : le certificat de son arrêt');
    await p.locator('#p-traiter li', { hasText: 'le certificat de son arrêt' }).locator('[data-traiter]').click();
    expect(await p.locator('#lf-maladie').isVisible()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-arret-maladie.png') });
    await p.locator('#lf [name=kind]').selectOption('conges');
    expect(await p.locator('#lf-maladie').isVisible()).toBe(false);
    // La fenêtre a changé : elle demande avant de jeter la saisie.
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Abandonner la saisie', exact: true }).click();
    await expect.poll(() => p.locator('#lf').count()).toBe(0);
    // Le pointage : (1.251.0) le mois est celui de la bande des douze mois, commune à toute la page ; tant qu'on n'en a pas
    // choisi, le pointage s'ouvre sur le mois du jour (recette du 02/11 : il s'ouvrait sur le mois de paie, octobre, le 2
    // novembre). Un autre mois de la bande : la grille passe à ce mois, la bande garde sa place (rien ne glisse).
    await p.locator('#p-tabs button[data-tab="pointage"]').click();
    await p.locator('#pt-panneau').waitFor();
    expect(await p.locator('#pt-panneau select').count()).toBe(0);
    const auj = new Date(), moisJour = auj.getUTCMonth() + 1;
    expect(await p.locator('#p-mois .cp-mo.on').getAttribute('data-p-mois')).toBe(String(moisJour));
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const titrePt = async () => (await p.locator('#pt-panneau .pa-carte-t b, #pt-panneau h2, #pt-panneau b').first().innerText()).toLowerCase();
    expect(await titrePt()).toContain(MOIS[moisJour - 1]);
    // Aujourd'hui se voit dans la grille : « auj. » au-dessus du numéro du jour, une seule colonne, et sur le mois du jour
    // seulement (Skander, 02/11 : « on ne sait pas quel jour on est »).
    expect(espace(await p.locator('#pt-grille th[aria-current="date"]').innerText())).toBe(`auj. ${auj.getUTCDate()}`);
    expect(await p.locator('#pt-grille td.pt-auj-td').count()).toBe(await p.locator('#pt-grille tbody tr').count());
    const place = await p.locator('#p-mois').boundingBox();
    const autre = moisJour === 1 ? 2 : moisJour - 1;
    await p.locator(`#p-mois [data-p-mois="${autre}"]`).click();
    await expect.poll(titrePt).toContain(MOIS[autre - 1]);
    expect(await p.locator('#pt-grille th[aria-current="date"]').count()).toBe(0);
    expect(await p.locator('#p-mois .cp-mo.on').getAttribute('data-p-mois')).toBe(String(autre));
    expect(await p.locator('#p-mois').boundingBox()).toEqual(place);
    await p.locator(`#p-mois [data-p-mois="${moisJour}"]`).click();
    await expect.poll(titrePt).toContain(MOIS[moisJour - 1]);
    // 1.234.0 (la maquette) : une case « présent » se lit vide ; sa lettre reste pour le clavier et les lecteurs d'écran.
    const present = p.locator('#pt-grille .pt-c.pt-P').first();
    expect(await present.textContent()).toBe('P');
    expect(await present.evaluate((el) => getComputedStyle(el).color)).toBe('rgba(0, 0, 0, 0)');
    // Sans réseau, la paie se consulte et le dit ; son geste principal attend la connexion.
    await p.locator('#p-tabs button[data-tab="bulletins"]').click();
    await expect.poll(() => p.locator('#p-payer').count()).toBe(1);
    await p.context().setOffline(true);
    await expect.poll(() => p.locator('#p-hors-ligne').count()).toBe(1);
    expect(await p.locator('#p-payer').isDisabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-hors-ligne.png') });
    await p.context().setOffline(false);
    await expect.poll(() => p.locator('#p-hors-ligne').count()).toBe(0);
    expect(await p.locator('#p-payer').isDisabled()).toBe(false);
    // Au téléphone, un bulletin du mois est une carte simple : ni brut, ni « Marquer payé » sur la ligne (il est dans son menu).
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    expect(await p.locator('#p-bulletins [data-payer]').count()).toBe(0);
    expect(await p.locator('#p-bulletins tr[data-bul] td:nth-child(2)').first().isVisible()).toBe(false);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 240_000);

  // (1.253.0, revue du 02/11/2026) L'historique de la fiche dit le salaire de BASE qui change, au premier jour de son mois
  // (pas « Brut de … » daté de la fin du mois, absences comprises) ; l'onglet Congés dit les absences notées au pointage.
  it('la fiche : le salaire de base qui change, au 1er du mois ; les absences du pointage sous les congés', async () => {
    const A = await monter();
    const mm = (m: number) => String(m).padStart(2, '0');
    // Mourad : sa base passe de 1 450,375 à 1 500,500 ce mois-ci. Nadia : une absence le mois d'avant (le brut du mois
    // baisse, sa base ne change pas).
    const mt = A.ceMois.find((b) => b.employeeId === 'mt')!, nbAvant = A.avant.find((b) => b.employeeId === 'nb')!;
    // Un objet déjà posé se remplace à sa révision.
    const remplacer = async (cle: string, contenu: unknown) => {
      const o = (await api('GET', `/entreprises/${A.ent}/dossier-v10`, A.j)).corps.objets as { collection: string; cle: string; revision: number }[];
      const r = o.find((x) => x.collection === 'payslips' && x.cle === cle);
      const rep = await api('POST', `/entreprises/${A.ent}/dossier-v10`, A.j, { changements: [{ collection: 'payslips', cle, rang: null, revision: r ? r.revision : null, contenu: enc(contenu) }] });
      expect(rep.statut).toBeLessThan(300);
    };
    const saisieMt = { gross: 1500.5, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const eMt = { grossSalary: 1500.5, contract: 'cdi', headOfFamily: true, children: 2 };
    await remplacer(mt.id, { ...mt, ...saisieMt, computed: compta.computePayslip(eMt, saisieMt, compta.baremesPaie({})) });
    const saisieNb = { gross: 880.125, workedDays: 26, absentDays: 1, bonuses: [], deductions: [] };
    await remplacer(nbAvant.id, { ...nbAvant, ...saisieNb, computed: compta.computePayslip({ grossSalary: 880.125, contract: 'cdi', headOfFamily: false, children: 0 }, saisieNb, compta.baremesPaie({})) });
    // Le pointage de Nadia, le mois d'avant : un jour ouvré « absent ».
    let jour = 3; while (new Date(Date.UTC(A.anA, A.moA - 1, jour)).getUTCDay() === 0) jour++;
    await A.poser('timesheets', 'ts-nb', { id: 'ts-nb', employeeId: 'nb', year: A.anA, month: A.moA, jours: { [String(jour)]: 'A' }, hs: {} });
    let p = await ouvrir(A, '#/salarie/mt');
    await p.locator('[data-onglet="historique"]').click();
    await expect.poll(async () => p.locator('.pa-histo li').count()).toBeGreaterThan(1);
    const lignes = (await p.locator('.pa-histo li').allInnerTexts()).map(espace);
    expect(lignes.filter((l) => /Salaire de base dès/.test(l))).toEqual([`01/${mm(A.mo)}/${A.an} Salaire de base dès ${new Date(Date.UTC(A.an, A.mo - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })} ${A.an} 1 450,375 DT → 1 500,500 DT`]);
    expect(lignes.filter((l) => /^\S+ Brut de /.test(l))).toEqual([]);
    await p.close();
    p = await ouvrir(A, '#/salarie/nb');
    await p.locator('[data-onglet="historique"]').click();
    await expect.poll(async () => p.locator('.pa-histo li').count()).toBeGreaterThan(1);
    expect((await p.locator('.pa-histo li').allInnerTexts()).map(espace).filter((l) => /Salaire de base|Brut de/.test(l))).toEqual([]);
    if (A.anA === A.an) {
      await p.locator('[data-onglet="conges"]').click();
      await expect.poll(async () => p.locator('#fs-pointes').count()).toBe(1);
      expect(espace(await p.locator('#fs-pointes').innerText())).toBe(`Au pointage de ${A.an} : 1 jour d'absence non payée (${mm(jour)}/${mm(A.moA)}) ; il se retire du bulletin de son mois.`);
    }
    expect(erreurs).toEqual([]);
  }, 180_000);
});
