// 1.267.0 — la paie refaite, morceaux B à D (docs/maquettes/paie-v2.html ; docs/paie.md, « La paie refaite, morceaux B à
// D »), à la souris, au clavier et au doigt, écran ET serveur :
//   - la journée : quatre choix qui se posent d'un clic, sans fenêtre ; « + Retard » et « + H. sup » s'ajoutent à « Là » ;
//     ce que le bulletin en fera se lit sous la ligne, en dinars ; le congé saisi d'avance se dit ;
//   - au clavier (↑ ↓ puis une lettre) et, dès 12 salariés, la recherche ;
//   - le mois : ce qui change un montant retient les bulletins (« Régler d'abord »), les régler les débloque ; « Plus tard »
//     remet un rappel à lundi, « Annuler » le rend ;
//   - au téléphone : la feuille à gros boutons, « Valider la journée » sous le pouce.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown };
const RIB = '08100123456789012359';

describe('la paie 1.267.0 : la journée de la maquette, le mois qui attend le pointage, le téléphone', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1267-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    nav = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
    fs.mkdirSync(PHOTOS, { recursive: true });
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
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (base: string, n: number) => iso(new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1, Number(base.slice(8, 10)) + n)));
  const jjmm = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}`;

  // Une boulangerie, l'équipe pointée à la main sept jours sur sept (aujourd'hui se pointe, quel que soit le jour) ;
  // `moisPaye` : le dernier mois aux bulletins payés et remis (par défaut le mois d'avant : rien n'y reste à faire).
  const monter = async (o: { n?: number; moisPaye?: number; nbSansRib?: boolean; congeNb?: boolean } = {}) => {
    const j = await personne('g', 'Sarra');
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = iso(new Date()), an = Number(auj.slice(0, 4)), mo = Number(auj.slice(5, 7));
    const recul = o.moisPaye ?? 1, mP = ((mo - 1 - recul) % 12 + 12) % 12 + 1, aP = mo - recul < 1 ? an - 1 : an;
    const sal = (id: string, name: string, grossSalary: number, x: Record<string, unknown> = {}) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', cin: '05118204', gender: 'm', equipeId: 'q1', ...x });
    const S = o.n ? Array.from({ length: o.n }, (_, i) => sal(`e${mm(i + 1)}`, `Salarié ${mm(i + 1)}`, 1000 + i, { position: i % 2 ? 'Vendeur' : 'Boulanger', iban: `0810012345678901${String(2300 + i).padStart(4, '0')}` }))
      : [sal('mt', 'Mourad Trabelsi', 1450.375), sal('nb', 'Nadia Ben Salah', 880.125, { position: 'Vendeuse', gender: 'f', iban: o.nbSansRib ? '' : '08100987654321098714' })];
    await poser('_racine', 'payrollSettings', { hsMaj1: 25, heuresMois: 208, pointageRegle: true, equipes: [{ id: 'q1', nom: 'Le fournil', debut: '06:00', fin: '14:00', jours: [0, 1, 2, 3, 4, 5, 6], pointe: 'main' }] });
    for (const e of S) await poser('employees', e.id, e);
    for (const e of S) {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      await poser('payslips', `p-${e.id}`, { id: `p-${e.id}`, employeeId: e.id, year: aP, month: mP, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: `${aP}-${mm(mP)}-28`, remisLe: `${aP}-${mm(mP)}-28`, accountId: '', method: e.method, reference: '', issuedAt: `${aP}-${mm(mP)}-28` });
    }
    if (o.congeNb) await poser('leaves', 'l-nb', { id: 'l-nb', employeeId: 'nb', kind: 'conges', from: auj, to: plus(auj, 2), paid: null, note: 'mariage de sa sœur' });
    const f = (await objets({ j, ent })).find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: 'sans' } }] });
    return { j, ent, auj, an, mo, d: Number(auj.slice(8, 10)) };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string }, tel = false, heure?: Date) => {
    erreurs.length = 0;
    const cx = await nav.newContext(tel ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' } : { viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    if (heure) await cx.clock.setFixedTime(heure);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}#/paie`);
    await p.locator('#ptj').waitFor({ timeout: 20_000 });
    return p;
  };
  const jourDe = async (x: { j: string; ent: string; auj: string }, id: string) => {
    const t = (await objets(x)).find((o) => o.collection === 'timesheets' && o.contenu.employeeId === id && `${o.contenu.year}-${mm(Number(o.contenu.month))}` === x.auj.slice(0, 7))?.contenu as Record<string, Record<string, unknown>> | undefined;
    const d = String(Number(x.auj.slice(8, 10)));
    return { code: t?.jours?.[d], retard: t?.retards?.[d], hs: t?.hs?.['25'] };
  };
  const toast = (p: Page) => p.locator('#toast').innerText().then(espace);

  it('la journée : quatre choix d\'un clic, « + Retard » et « + H. sup » sur la ligne, l\'effet en dinars, le congé prévu', async () => {
    const x = await monter({ congeNb: true });
    const p = await ouvrir(x);
    const ligne = (id: string) => p.locator(`#ptj [data-ptj-e="${id}"]`);
    const effet = async (id: string) => espace(await ligne(id).locator('.ptj-e').innerText());
    expect(espace(await p.locator('#ptj .pa-carte-t b').innerText())).toBe('Qui est là aujourd\'hui ?');
    expect(await ligne('mt').locator('.ptj-seg button').allInnerTexts()).toEqual(['Là', 'Absent', 'Congé', 'Malade']);
    expect(await ligne('mt').locator('.ptj-seg [aria-pressed="true"]').innerText()).toBe('Là');
    // Nadia : son congé saisi d'avance se dit, et elle n'a rien à faire.
    expect(await ligne('nb').locator('.ptj-seg [aria-pressed="true"]').innerText()).toBe('Congé');
    expect(await effet('nb')).toBe(`Prévu : congé du ${jjmm(x.auj)} au ${jjmm(plus(x.auj, 2))} (mariage de sa sœur) tu n'as rien à faire`);
    // Mourad absent, d'un clic, sans fenêtre : un jour de son brut (1 450,375 / 26 = 55,784), puis la moitié.
    await ligne('mt').getByRole('button', { name: 'Absent', exact: true }).click();
    await expect.poll(async () => (await jourDe(x, 'mt')).code, { timeout: 15_000 }).toBe('A');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(await effet('mt')).toBe('Toute la journée Une demi-journée − 55,784 DT sur son brut (un jour : son brut ÷ 26)');
    expect(await toast(p)).toContain('Mourad Trabelsi, ');
    await ligne('mt').getByRole('button', { name: 'Une demi-journée', exact: true }).click();
    await expect.poll(async () => (await jourDe(x, 'mt')).code, { timeout: 15_000 }).toBe('D');
    expect(await effet('mt')).toContain('− 27,892 DT sur son brut (la moitié d\'un jour');
    // « Là » le remet à la normale ; « + Retard » et « + H. sup » ne s'offrent qu'à un jour de présence.
    await ligne('mt').getByRole('button', { name: 'Là', exact: true }).click();
    await expect.poll(async () => (await jourDe(x, 'mt')).code, { timeout: 15_000 }).toBeUndefined();
    expect(await effet('mt')).toBe('');
    // « + Retard » : la ligne s'ouvre sur ses minutes, le curseur dedans ; rien ne s'écrit avant le nombre.
    await ligne('mt').locator('[data-ptj-plus="mt:retard"]').click();
    expect(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ptjMin)).toBe('mt');
    // Lu dans la page même (le serveur, lui, ne l'aurait pas encore reçu) : aucun retard n'est posé avant la frappe.
    expect(await p.evaluate((d) => ((window as unknown as { __data: { timesheets?: { employeeId: string; retards?: Record<string, number> }[] } }).__data.timesheets || [])
      .filter((t) => t.employeeId === 'mt').map((t) => t.retards?.[d]).filter((v) => v !== undefined), String(x.d))).toEqual([]);
    await p.keyboard.type('25'); await p.keyboard.press('Enter');
    await expect.poll(async () => (await jourDe(x, 'mt')).retard, { timeout: 15_000 }).toBe(25);
    expect(await ligne('mt').locator('[data-ptj-plus="mt:retard"]').innerText()).toBe('Retard 25 min');
    expect(await effet('mt')).toBe('En retard de minutes noté, rien ne se retient (la retenue des retards est éteinte dans tes réglages)');
    // « + H. sup » : 2 heures à +25 % : 1 450,375 × 2 × 1,25 / 208 = 17,432 sur son brut, lu sous la ligne.
    await ligne('mt').locator('[data-ptj-plus="mt:hs"]').click();
    expect(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ptjHs)).toBe('mt');
    await p.keyboard.type('2'); await p.keyboard.press('Enter');
    await expect.poll(async () => (await jourDe(x, 'mt')).hs, { timeout: 15_000 }).toBe(2);
    expect(await ligne('mt').locator('[data-ptj-plus="mt:hs"]').innerText()).toBe('2 h sup');
    expect(await effet('mt')).toContain('heures sup + 17,432 DT sur son brut à +25 % (À VÉRIFIER selon ton secteur)');
    // Le pied résume la journée ; le bouton dit ce qu'il fait.
    expect(espace(await p.locator('#ptj .ptj-resume').innerText())).toBe('1 là · Mourad : 2 h sup · Nadia : congé');
    expect(espace(await p.locator('#ptj-valider').innerText())).toBe('Valider la journée');
    // Absent efface le retard et les heures du jour ; « Annuler » rend tout.
    await ligne('mt').getByRole('button', { name: 'Absent', exact: true }).click();
    await expect.poll(async () => jourDe(x, 'mt'), { timeout: 15_000 }).toEqual({ code: 'A', retard: undefined, hs: undefined });
    expect(await ligne('mt').locator('[data-ptj-plus="mt:retard"]').isDisabled()).toBe(true);
    await p.locator('#toast-undo').click();
    await expect.poll(async () => jourDe(x, 'mt'), { timeout: 15_000 }).toEqual({ code: undefined, retard: 25, hs: 2 });
    await p.screenshot({ path: path.join(PHOTOS, 'paie-journee-maquette.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('au clavier, à 13 salariés : ↑ ↓ puis une lettre ; la recherche cache ce qui ne répond pas', async () => {
    const x = await monter({ n: 13 });
    const p = await ouvrir(x);
    expect(await p.locator('#ptj .ptj-kbd').innerText()).toContain('au clavier');
    const actif = () => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ptjE ?? (document.activeElement as HTMLElement | null)?.dataset.ptjHs ?? '');
    await p.locator('#ptj [data-ptj-e="e01"]').focus();
    await p.keyboard.press('ArrowDown');
    expect(await actif()).toBe('e02');
    await p.keyboard.press('a');
    await expect.poll(async () => (await jourDe(x, 'e02')).code, { timeout: 15_000 }).toBe('A');
    // Le curseur reste sur sa ligne : la suivante se fait sans la souris.
    expect(await actif()).toBe('e02');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('c');
    await expect.poll(async () => (await jourDe(x, 'e03')).code, { timeout: 15_000 }).toBe('C');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('h');
    expect(await actif()).toBe('e04');
    expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await p.keyboard.type('2'); await p.keyboard.press('Enter');
    await expect.poll(async () => (await jourDe(x, 'e04')).hs, { timeout: 15_000 }).toBe(2);
    // Un absent n'a pas de retard : R le dit, et rien ne s'écrit.
    await p.locator('#ptj [data-ptj-e="e02"]').focus();
    await p.keyboard.press('r');
    expect(await toast(p)).toBe('Salarié 02 n\'est pas noté « Là » ce jour-là : un retard ne s\'ajoute qu\'à une journée de présence.');
    // La recherche, à partir de 12 salariés : par le nom ou le poste.
    const vues = () => p.locator('#ptj .ptj-l:visible').count();
    expect(await vues()).toBe(13);
    await p.locator('#ptj-q-s').fill('salarié 07');
    await expect.poll(vues).toBe(1);
    await p.locator('#ptj-q-s').fill('vendeur');
    await expect.poll(vues).toBe(6);
    await p.locator('#ptj-q-s').fill('zzz');
    await expect.poll(vues).toBe(0);
    expect(espace(await p.locator('#ptj-rien').innerText())).toBe('Personne ne s\'appelle « zzz ». Tout montrer');
    await p.locator('#ptj-tout').click();
    await expect.poll(vues).toBe(13);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('le mois : ce qui change un montant retient les bulletins, « Régler d\'abord » mène au pointage ; « Plus tard » remet un rappel à lundi', async () => {
    // Le dernier mois payé est l'avant-dernier : le mois d'avant attend ses bulletins, ses journées ne sont pas validées.
    const x = await monter({ moisPaye: 2, nbSansRib: true });
    const p = await ouvrir(x);
    const moP = x.mo === 1 ? 12 : x.mo - 1;
    await p.locator('#pj-avant').waitFor();
    expect(espace(await p.locator('#pj-avant-go').innerText())).toMatch(/^Régler le pointage (d'|de )/);
    expect(espace(await p.locator('#pj-avant').innerText())).toContain('1 chose à régler dans le pointage (elle change un montant), puis 2 bulletins à établir');
    await p.locator('#pj-avant-go').click();
    await expect.poll(() => p.locator('#p-sous .pa-etape.ouverte').getAttribute('data-sous')).toBe('pointage');
    expect(await p.locator(`#p-mois [data-p-mois="${moP}"]`).getAttribute('aria-pressed')).toBe('true');
    expect(await p.locator('#p-tabs [data-af="bulletins"]').innerText()).toBe('1');
    // L'étape des bulletins le dit, et son bouton vert est le geste qui débloque.
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await p.locator('#p-regler-b').waitFor();
    // Vue d'une autre étape, « Pointer » porte toujours le chiffre de sa liste « À régler ».
    expect(await p.locator('#p-sous [data-sous="pointage"] .pm-nb').innerText()).toBe('1');
    expect(espace(await p.locator('#p-regler').innerText())).toBe('Régler d\'abord 1 chose du pointage');
    expect(await p.locator('#p-gen').count()).toBe(0);
    await p.locator('#p-regler').click();
    await expect.poll(() => p.locator('#p-sous .pa-etape.ouverte').getAttribute('data-sous')).toBe('pointage');
    await p.locator('#pt-jav').click();
    await p.locator('#modal-root #jav-ok').click();
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await expect.poll(async () => espace(await p.locator('#p-gen').innerText().catch(() => ''))).toBe('Établir les 2 bulletins');
    expect(await p.locator('#p-tabs [data-af="bulletins"]').isHidden()).toBe(true);
    expect(await p.locator('#p-regler, #p-regler-b').count()).toBe(0);
    // Le mois en cours, la page au 10 puis au 26 : ses bulletins se préparent à partir du 25, jamais avant.
    for (const [jour, attendu] of [[10, true], [26, false]] as const) {
      const q = await ouvrir(x, false, new Date(`${x.an}-${mm(x.mo)}-${jour}T10:00:00+01:00`));
      await q.locator('#p-tabs [data-tab="bulletins"]').click();
      await q.locator(`#p-mois [data-p-mois="${x.mo}"]`).click();
      await q.locator('#p-sous [data-sous="bulletins"]').click();
      await expect.poll(() => q.locator('#p-25-b, #p-regler').count()).toBeGreaterThan(0);
      expect(await q.locator('#p-25-b').count()).toBe(attendu ? 1 : 0);
      if (attendu) {
        expect(espace(await q.locator('#p-25-b b').innerText())).toMatch(/se préparent à partir du 25\/\d\d$/);
        expect(await q.locator('#p-gen, #p-regler').count()).toBe(0);
      } else expect(await q.locator('#p-regler').count()).toBe(1);
      await q.context().close();
    }
    // En janvier, décembre encore à payer : les congés d'« Aujourd'hui » vivent dans l'année du jour, pas dans celle du
    // mois de paie (1.233 a, 1.249 : le calendrier montrait janvier de l'année passée).
    {
      const q = await ouvrir(x, false, new Date(`${x.an + 1}-01-12T10:00:00+01:00`));
      await q.locator('#p-sous [data-sous="conges"]').click();
      await expect.poll(() => q.locator('#cg-cal .pa-carte-t > b').innerText()).toBe(`Janvier ${x.an + 1} : qui est absent`);
      await q.context().close();
    }
    // « Plus tard » sur le RIB de Nadia : il revient lundi ; « Annuler » le rend ; la pastille suit la même liste.
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    const rib = p.locator('#p-traiter li', { hasText: 'Nadia Ben Salah' });
    await rib.first().waitFor();
    const pastille = async () => Number((await p.locator('#p-tabs [data-af="pointage"]').innerText().catch(() => '')) || 0);
    const avant = await pastille(), n = await rib.count();
    await rib.first().getByRole('button', { name: /^Plus tard/ }).click();
    await expect.poll(() => rib.count()).toBe(n - 1);
    expect(await toast(p)).toMatch(/« Nadia Ben Salah : RIB à demander » revient le lundi \d\d\/\d\d Annuler$/);
    expect(await pastille()).toBe(avant - 1);
    await p.locator('#toast-undo').click();
    await expect.poll(() => rib.count()).toBe(n);
    expect(await pastille()).toBe(avant);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('au téléphone : la feuille à gros boutons, chacun avec ce qu\'il fait ; « Valider la journée » sous le pouce', async () => {
    const x0 = await monter(), dix = `${x0.an}-${mm(x0.mo)}-10`, x = { ...x0, auj: dix, d: 10 };
    const p = await ouvrir(x, true, new Date(`${dix}T10:00:00+01:00`));
    const ligne = p.locator('#ptj [data-ptj-e="mt"]');
    expect(await ligne.locator('.ptj-fin').isVisible()).toBe(false);
    expect(await ligne.locator('.ptj-pas').innerText()).toBe('Là');
    await ligne.locator('.ptj-n').tap();
    await p.locator('#ptjc').waitFor();
    expect(await p.locator('#ptjc .ptj-gros').first().locator('.ptj-g b').allInnerTexts()).toEqual(['Là', 'Absent', 'Congé', 'Malade']);
    expect(espace(await p.locator('#ptjc [data-ptjc="A"] small').innerText())).toBe('− 55,784 DT sur son brut');
    for (const b of await p.locator('#ptjc button').all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-feuille-telephone.png') });
    await p.locator('#ptjc [data-ptjc="A"]').tap();
    await expect.poll(async () => (await jourDe(x, 'mt')).code, { timeout: 15_000 }).toBe('A');
    expect(await p.locator('#ptjc').count()).toBe(0);
    expect(await ligne.locator('.ptj-pas').innerText()).toBe('Absent');
    // Sans autre geste du jour (le 10, le mois d'avant fini), le bouton vert est la journée, sous le pouce.
    expect(await p.locator('#ptj-valider').evaluate((b) => getComputedStyle(b).position)).toBe('fixed');
    expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(erreurs).toEqual([]);
  }, 120_000);
});
