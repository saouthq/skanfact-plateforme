// 1.257.0 — le pointage tel que la maquette (docs/paie-ecarts-maquette.md), à la souris, écran ET serveur :
//   - la case de la grille (O20) : ce que chaque choix fait sur le bulletin, le retard du jour, « Au » pour plusieurs jours ;
//   - la pointeuse (O06, E17) : le fichier lu avant d'importer (rattachés, inconnus, illisibles, anomalies), rien d'écrit
//     avant le geste ; l'anomalie « pas de sortie » réglée d'un geste ;
//   - le pointage validé (E20) : verrouillé, une case le refuse avec sa raison, « Corriger » prépare la version 2.

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

describe('la paie 1.257.0 : la case, la pointeuse, ses anomalies, le pointage validé', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1257-'));
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


  // Les six premiers jours de travail du mois dernier (du lundi au samedi), et un fichier de badges pour le fournil : Nadia
  // (Nadia, badge 1002) oublie de badger sa sortie le troisième ; un badge qu'aucune fiche ne porte ; une ligne illisible.
  const joursDeTravail = (y: number, m: number) => Array.from({ length: 28 }, (_, i) => i + 1).filter((d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0).slice(0, 6) as [number, number, number, number, number, number];
  const fichier = (y: number, m: number) => {
    const J = joursDeTravail(y, m), dd = (d: number) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    const L = ['Badge;Date;Heure'];
    J.forEach((d, k) => { L.push(`1001;${dd(d)};03:0${k}`, `1001;${dd(d)};${k === 1 ? '13:07' : '11:02'}`); L.push(`1002;${dd(d)};02:5${k}`); if (k !== 2) L.push(`1002;${dd(d)};11:0${k}`); });
    L.push(`1009;${dd(J[0])};06:30`, 'pas une ligne');
    const f = path.join(dossier, `badges-${y}-${m}.txt`); fs.writeFileSync(f, L.join('\n')); return { f, J, n: L.length - 3 };
  };

  it('la case du pointage : ce que chaque choix fait, le retard du jour, « Au » pour plusieurs jours, « Annuler »', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    // (1.259.0) La grille du mois : « Le mois », puis « Vue grille ».
    await p.locator('[data-sous="pointage"]').click();
    await p.locator('#pt-vue-grille').click();
    await p.locator('#pt-grille').waitFor();
    const J = joursDeTravail(x.an, x.mo), d = J[5];
    const kase = (j: number) => p.locator(`#pt-grille tr[data-pe="nb"] .pt-c[data-pt="${j}"]`);
    await kase(d).click();
    await p.locator('#pc').waitFor();
    // Sans solde se chiffre sur son brut (880,125 sur 26 jours) ; le planning est celui de son équipe.
    expect(espace(await p.locator('#pc label:has(input[value=A])').innerText())).toBe(`Absent, sans solde − ${compta.round3(880.125 / 26).toFixed(3).replace('.', ',')} DT sur son brut`);
    expect(espace(await p.locator('#modal-root .sous-f').innerText())).toMatch(/^planning : Le fournil, la nuit : 03:00 – 11:00 · /);
    await p.locator('#pc [name=retard]').fill('17');
    await p.locator('#pc-ok').click();
    const ts = async () => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'timesheets').map((o) => o.contenu).find((t) => t.employeeId === 'nb' && Number(t.month) === x.mo);
    await expect.poll(async () => ((await ts())?.retards as Record<string, unknown> | undefined)?.[String(d)]).toBe(17);
    expect(await kase(d).getAttribute('class')).toContain('pt-retard');
    // « Au » : trois jours de congé d'un coup ; « Annuler » les remet.
    await kase(J[0]).click();
    await p.locator('#pc input[value=C]').check();
    await p.locator('#pc [name=au]').evaluate((i, v) => { (i as HTMLInputElement).value = v; const t = i.parentElement?.querySelector('.d-txt') as HTMLInputElement | null; if (t) t.value = v.split('-').reverse().join('/'); i.dispatchEvent(new Event('change', { bubbles: true })); }, `${x.an}-${String(x.mo).padStart(2, '0')}-${String(J[2]).padStart(2, '0')}`);
    await p.locator('#pc-ok').click();
    await expect.poll(() => Promise.all([J[0], J[1], J[2]].map((j) => kase(j).innerText()))).toEqual(['C', 'C', 'C']);
    await p.locator('.toast-undo').click();
    await expect.poll(() => Promise.all([J[0], J[1], J[2]].map((j) => kase(j).innerText()))).toEqual(['P', 'P', 'P']);
    expect(erreurs).toEqual([]);
  }, 120_000);

  // 16 § 10.1, point 7 (03/11/2026) : des badges neufs dans une période clôturée, le serveur les refuse ; l'écran le dit avant
  // d'importer, et rien ne s'écrit.
  it('la pointeuse dans une période clôturée : le refus se dit avant d\'importer, rien ne s\'écrit', async () => {
    const x = await monter();
    const finA = new Date(Date.UTC(x.anA, x.moA, 0)).toISOString().slice(0, 10);
    expect((await api('POST', `/entreprises/${x.ent}/dossier-v10`, x.j, { changements: [{ collection: '_racine', cle: 'closedUntil', rang: null, revision: null, contenu: finA }] })).statut).toBe(200);
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('[data-sous="pointage"]').click();
    await p.locator('#pt-vue-grille').click();
    await p.locator('#pt-grille').waitFor();
    const { f, n } = fichier(x.anA, x.moA);
    await p.locator('#pt-import').click();
    await p.locator('#ib-f').setInputFiles(f);
    await expect.poll(() => p.locator('#ib-ok').innerText().then(espace)).toBe(`Importer les ${n} badges`);
    await p.locator('#ib-ok').click();
    await expect.poll(() => p.locator('#modal-root .modal h2').last().innerText().then(espace).catch(() => '')).toBe('Période clôturée');
    expect(espace(await p.locator('#modal-root .modal').last().innerText())).toContain('Cet import de badges porte la date du');
    await p.waitForTimeout(500);
    const o = (await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[];
    expect(o.some((z) => z.collection === 'timesheets' && z.contenu.badges)).toBe(false);
    expect(o.some((z) => z.collection === 'badgeImports')).toBe(false);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('la pointeuse : ce que le fichier donnerait, l\'import, l\'anomalie réglée, puis le mois validé et verrouillé', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    // (1.259.0) La grille du mois : « Le mois », puis « Vue grille ».
    await p.locator('[data-sous="pointage"]').click();
    await p.locator('#pt-vue-grille').click();
    await p.locator('#pt-grille').waitFor();
    // Le mois dernier : la bande des mois y mène.
    await p.locator('#p-mois [data-ym="' + `${x.anA}-${String(x.moA).padStart(2, '0')}` + '"]').first().click().catch(async () => { await p.locator('#p-mois button').filter({ hasText: new RegExp(['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'][x.moA - 1] ?? '') }).first().click(); });
    await expect.poll(() => p.locator('#pt-panneau .pa-carte-t b').innerText()).toMatch(new RegExp(['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][x.moA - 1] ?? ''));
    const { f, J, n } = fichier(x.anA, x.moA);
    await p.locator('#pt-import').click();
    await p.locator('#ib-f').setInputFiles(f);
    await expect.poll(() => p.locator('#ib-t').innerText().then(espace)).toContain(`Badges lus ${n + 1} 1 ligne illisible`);
    const t = espace(await p.locator('#ib-t').innerText());
    expect(t).toContain(`Rattachés à un salarié par le n° de badge de sa fiche ${n}`);
    expect(t).toContain('1009');
    expect(t).toMatch(/Anomalies 1 1 sortie manquante/);
    // Rien n'est écrit avant le geste.
    expect(((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[]).some((o) => o.collection === 'timesheets' && o.contenu.badges)).toBe(false);
    expect(espace(await p.locator('#ib-ok').innerText())).toBe(`Importer les ${n} badges`);
    await p.locator('#ib-ok').click();
    await expect.poll(() => p.locator('#toast').innerText().then(espace)).toMatch(new RegExp(`^${n} badges importés, du `));
    const tsK = async () => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'timesheets').map((o) => o.contenu).find((z) => z.employeeId === 'nb' && Number(z.month) === x.moA);
    await expect.poll(async () => Object.keys(((await tsK())?.badges as Record<string, unknown>) || {}).length).toBe(6);
    // L'anomalie : la sortie oubliée de Nadia, réglée d'un geste à la fin de son planning.
    const ligne = p.locator('#pt-aregler li').filter({ hasText: 'pas de sortie' }); // (1.259.0) dans « À régler »
    expect(espace(await ligne.innerText())).toContain(`Nadia, le ${String(J[2]).padStart(2, '0')}/${String(x.moA).padStart(2, '0')} : une entrée à 02:52, pas de sortie`);
    await ligne.getByRole('button', { name: 'Mettre la sortie à 11:00' }).click();
    await expect.poll(async () => ((await tsK())?.badges as Record<string, { sortieMain?: string }>)[String(J[2])]?.sortieMain).toBe('11:00');
    await expect.poll(() => p.locator('#pt-aregler').count()).toBe(0);
    // Valider : le mois est verrouillé, une case le refuse et dit comment le rouvrir.
    await p.locator('#pt-valider').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string }[]).filter((o) => o.collection === 'pointageVersions').length).toBe(1);
    await p.locator(`#pt-grille tr[data-pe="mt"] .pt-c[data-pt="${J[0]}"]`).click();
    await expect.poll(() => p.locator('#toast').innerText().then(espace)).toMatch(/est validé, donc verrouillé : « Corriger : une nouvelle version » le rouvre\./);
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await p.locator('#pt-corriger').click();
    await expect.poll(() => p.locator('#pt-valide b').innerText().then(espace)).toMatch(/^Correction en cours : la version 2/);
    expect(erreurs).toEqual([]);
  }, 120_000);

  // 1.257.1 — vu par Skander sur dev.skanfact.tn le 02/11 : « j'ai exporté le document et rien n'a été pris en compte ». Le
  // serveur sans son outil de PDF rend la main à la fenêtre d'impression : le document n'était pas noté, la fenêtre restait
  // ouverte ; une fenêtre d'impression bloquée par le navigateur ne disait rien.
  it('un document du salarié exporté se note dans ses documents, même quand le serveur ne fait pas le PDF', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.route('**/v1/pdf', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ motif: { code: 'pdf.indisponible', texte: 'indisponible' }, bouton: null, indisponible: true }) }));
    await p.evaluate(() => { (window as unknown as { open: unknown }).open = () => ({ document: { write() {}, close() {} }, print() {} }); });
    const faits = async () => (((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === 'employees' && o.cle === 'nb')?.contenu.documentsFaits as unknown[] | undefined ?? []).length;
    const exporter = async () => {
      await p.evaluate(() => { location.hash = '#/salarie/nb'; });
      await p.getByRole('button', { name: /Un document/ }).first().click();
      await p.locator('#hf').waitFor();
      await p.locator('#hf').getByText('Attestation de travail', { exact: true }).first().click();
      await p.locator('#ok').click();
    };
    await exporter();
    await expect.poll(() => p.locator('#toast').innerText().then(espace)).toMatch(/^Le document s'ouvre pour l'impression : choisis « Enregistrer en PDF » dans la fenêtre du navigateur\. Il est noté dans ses documents\./);
    expect(await p.locator('#hf').count()).toBe(0);
    await expect.poll(faits).toBe(1);
    // Le navigateur bloque la fenêtre d'impression : le refus le dit, et rien ne se note.
    await p.evaluate(() => { (window as unknown as { open: unknown }).open = () => null; });
    await exporter();
    await expect.poll(() => p.locator('#toast').innerText().then(espace)).toMatch(/ton navigateur a bloqué la fenêtre d'impression : autorise les fenêtres de ce site, puis recommence\./);
    expect(await faits()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 120_000);
});
