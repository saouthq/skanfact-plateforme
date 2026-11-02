// Le bon à payer, la correction proposée par le cabinet, les contrôles, l'arrivée, ce qu'on verse et quand, l'année par poste
// (1.227.0 ; docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée — lot 6 »). Ce que le parcours vérifie, écran ET serveur :
//   - le cabinet tient la paie (un choix écrit) : l'en-tête dit « J'approuve les 5 bulletins », aucune ligne n'offre « Marquer payé »,
//     la fenêtre « Payer » refuse avant l'accord ; approuver écrit `bonAPayerLe` au serveur, puis « Payer » revient ; « Annuler » défait ;
//   - les contrôles nomment ce qui demande un geste d'abord (une avance pas retenue, une entrée payée au mois plein) ;
//   - une correction proposée : le bandeau rouge, avant/après, « Accepter » change le net au serveur et garde la trace ; « Refuser »
//     garde la raison et laisse le bulletin tel quel ;
//   - la fiche d'une arrivée s'ouvre sur « Son arrivée » ; « Ce que tu verses, et quand » ; l'année par poste.

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

describe('la paie : le bon à payer et la correction proposée', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-bap-'));
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

  const monter = async (variante: string) => {
    const email = `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra', motDePasse: 'Un-bon-mot-de-passe' });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = new Date();
    const an = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mo = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const anA = mo === 1 ? an - 1 : an, moA = mo === 1 ? 12 : mo - 1;
    const mm = (m: number) => String(m).padStart(2, '0');
    const fin = new Date(Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth() + 1, 30)).toISOString().slice(0, 10);
    const sal = (id: string, name: string, grossSalary: number, x: Record<string, unknown>) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', ...x });
    const S = [sal('mt', 'Mourad Trabelsi', 1450, { headOfFamily: true, children: 2, position: 'Chef boulanger' }), sal('hm', 'Hamza Mejri', 820, { contract: 'cdd', endDate: fin, position: 'Aide boulanger' }),
      sal('nb', 'Nadia Ben Salah', 880, { position: 'Vendeuse' }), sal('kr', 'Karim Riahi', 1100, { position: 'Pâtissier' }),
      sal('sa', 'Salma Ayari', 700, { hireDate: `${an}-${mm(mo)}-12`, cnss: '', iban: '', method: 'especes', position: 'Vendeuse' }),
      sal('ys', 'Yassine Sassi', 900, { hireDate: '2022-01-03', endDate: `${anA}-${mm(moA)}-15`, active: false, position: 'Livreur' })];
    const bul = (e: (typeof S)[number], y: number, m: number, brut: number, x: Record<string, unknown> = {}) => {
      const saisie = { gross: brut, workedDays: 26, absentDays: 0, bonuses: [], deductions: [], ...(x.saisie as object || {}) };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28`, ...x, saisie: undefined };
    };
    const enPoste = S.filter((e) => e.active);
    const ceMois = enPoste.map((e) => {
      // 1.235.0 — les bulletins d'une paie tenue arrivent chez l'entreprise quand le cabinet les envoie (`pourAccordLe`) ;
      // la variante « prepa » les garde au cabinet.
      const b0 = bul(e, an, mo, e.grossSalary);
      const b = variante === 'prepa' || variante === 'sans' ? b0 : { ...b0, pourAccordLe: `${an}-${mm(mo)}-27` };
      if (variante === 'payer') return { ...b, bonAPayerLe: `${an}-${mm(mo)}-28` };
      if (variante === 'signal' && e.id === 'hm') return { ...b, correction: { par: 'Anis', le: `${an}-${mm(mo)}-28T10:05:00Z`, titre: 'l\'avance d\'Hamza n\'est pas retenue', motif: 'Tu lui as versé 300,000 le 05, à rendre en 3 fois ; le mois dernier a retenu 100,000, ce mois rien.',
        lignes: [{ libelle: 'Avance, 2e retenue sur 3', avant: 0, apres: -100 }, { libelle: 'Reste de l\'avance', avant: 200, apres: 100 }], net: Math.round((Number(b.computed.net) - 100) * 1000) / 1000,
        champs: { deductions: [{ label: 'Avance, 2e retenue sur 3', amount: 100 }] } } };
      if (variante === 'accepte' && e.id === 'hm') return { ...b, correction: { par: 'Anis', le: `${an}-${mm(mo)}-28T10:05:00Z`, reponse: 'acceptee', reponduLe: `${an}-${mm(mo)}-28T11:20:00Z` } };
      return b;
    });
    const avant = S.filter((e) => e.id !== 'sa').map((e) => ({ ...bul(e, anA, moA, e.id === 'nb' ? 820 : e.grossSalary), paidDate: `${anA}-${mm(moA)}-28`, remisLe: `${anA}-${mm(moA)}-28`,
      // (1.248.0) Une paie tenue a un cabinet : le mois d'avant est venu de lui (sans trace de cabinet, la paie se dit « seule »).
      ...(variante === 'prepa' ? { pourAccordLe: `${anA}-${mm(moA)}-27`, bonAPayerLe: `${anA}-${mm(moA)}-28` } : {}) }));
    for (const e of S) await poser('employees', e.id, e);
    for (const b of [...ceMois, ...avant]) await poser('payslips', b.id, b);
    const d = (n: number) => new Date(Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth(), auj.getUTCDate() + n)).toISOString().slice(0, 10);
    await poser('leaves', 'l1', { id: 'l1', employeeId: 'kr', kind: 'conges', from: d(8), to: d(13), paid: null, note: '', statut: 'demande', demandeLe: d(-1) });
    await poser('leaves', 'l2', { id: 'l2', employeeId: 'mt', kind: 'conges', from: `${an}-${mm(mo)}-05`, to: `${an}-${mm(mo)}-07`, paid: null, note: '' });
    await poser('advances', 'a1', { id: 'a1', employeeId: 'hm', date: `${anA}-${mm(moA)}-05`, amount: 300, monthly: 100, note: 'Avance', kind: 'avance' });
    await poser('advances', 'a2', { id: 'a2', employeeId: 'mt', date: `${anA}-${mm(moA)}-01`, amount: 1200, monthly: 200, note: 'Prêt voiture', kind: 'pret', debut: `${an}-${mm(mo)}` });
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', address: 'Rue de Marseille\n1000 Tunis', ...(variante === 'sans' ? { paieMode: 'sans' } : { paieMode: 'tenue', paieModeDes: '2020-01' }) } }] });
    return { j, ent, an, mo, ceMois };
  };
  const erreurs: string[] = [];
  const ouvrir = async (x: { j: string; ent: string; an: number; mo: number }, o: { w?: number; h?: number; sombre?: boolean; hash?: string } = {}) => {
    const p = await (await nav.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light', isMobile: (o.w || 1440) < 500, hasTouch: (o.w || 1440) < 500 })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, x.j);
    await p.goto(`${serveur.adresse}/v10/?e=${x.ent}${o.hash || '#/paie'}`);
    await p.locator(o.hash && o.hash.startsWith('#/salarie') ? '#fs-head' : '#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    if (!(o.hash && o.hash.startsWith('#/salarie'))) { for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== Number(x.an); i++) await p.locator(Number(await p.locator('#p-an').innerText()) > Number(x.an) ? '#p-an-prec' : '#p-an-suiv').click(); await p.locator(`#p-mois [data-p-mois="${x.mo}"]`).click(); }
    if (o.sombre) await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await p.waitForTimeout(500);
    return p;
  };
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const montant = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/[\u00a0\u202f]/g, ' ');
  const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Record<string, unknown>)['~n']) : Number(v));
  const bulletins = async (x: { j: string; ent: string }) => ((await api('GET', `/entreprises/${x.ent}/dossier-v10`, x.j)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
    .filter((o) => o.collection === 'payslips').map((o) => o.contenu);

  it('approuver avant de payer ; les contrôles ; « Annuler »', async () => {
    const A = await monter('bap');
    const p = await ouvrir(A);
    await expect.poll(() => p.locator('#p-bap').count()).toBe(1);
    expect(espace(await p.locator('#p-bap').innerText())).toBe('J\'approuve les 5 bulletins');
    expect(await p.locator('#p-head .btn-primary').count()).toBe(1);
    // « Marquer payé » vit dans le menu de la ligne (1.234.0) : avant le bon à payer, il n'y est pas.
    await p.locator('#p-bulletins tr[data-bul]').first().getByRole('button', { name: /Actions/ }).click();
    // (1.248.1) Le menu ne répète plus « Voir le bulletin » (le bouton de la ligne) : il s'ouvre sur l'export.
    await expect.poll(() => p.getByText('Exporter le bulletin en PDF', { exact: true }).count()).toBe(1);
    expect(await p.getByText('Marquer payé', { exact: true }).count()).toBe(0);
    await p.keyboard.press('Escape');
    expect(espace(await p.locator('#p-head .sous').innerText())).toContain('tenue par ton cabinet');
    expect(espace(await p.locator('#p-frise li:nth-child(2)').innerText())).toContain('5 à approuver');
    // Le bandeau du bon à payer passe avant la frise.
    expect(await p.locator('#p-body > #p-bap-b + #p-frise').count()).toBe(1);
    // Les contrôles : ce qui demande un geste d'abord, chacun nommé.
    const ko = (await p.locator('#p-ctrl li.ko b').allInnerTexts()).map(espace);
    // (1.248.0) Le jeu d'essai donne le même RIB et le même n° CNSS à tous : les deux contrôles des doublons le disent.
    expect(ko).toEqual(['Pas deux salariés sur le même RIB', 'Une avance pas retenue', 'L\'entrée de Salma au prorata', 'N° CNSS de chaque salarié', 'Pas deux salariés sur le même n° CNSS']);
    expect(espace(await p.locator('#p-ctrl li.ko').nth(1).innerText())).toContain('Hamza Mejri, Mourad Trabelsi');
    // (1.253.0) « À traiter » : quatre fiches sur le même n° CNSS et le même RIB tiennent sur deux lignes, pas six ; la
    // pastille de « Salariés » compte les fiches à reprendre, pas les choses : la première fiche du dossier (Hamza, rangé par
    // clé) garde son numéro et se compte par son CDD ; les trois autres doublons ; Salma sans n° CNSS. Cinq fiches, pas huit.
    const lignesT = (await p.locator('#p-traiter li b').allInnerTexts()).map(espace);
    expect(lignesT.filter((x) => /^Le même (n° CNSS|RIB) sur 4 fiches$/.test(x)).sort()).toEqual(['Le même RIB sur 4 fiches', 'Le même n° CNSS sur 4 fiches']);
    expect(lignesT.filter((x) => / : le même /.test(x))).toEqual([]);
    expect(espace(await p.locator('#p-traiter li[data-double="cnss"] small').innerText())).toMatch(/ et .+ : la déclaration du trimestre mettrait leurs salaires sur un seul assuré$/);
    expect(await p.locator('#p-tabs [data-af="salaries"]').innerText()).toBe('5');
    await p.locator('#p-ctrl-tout').click();
    expect(await p.locator('#p-ctrl li').count()).toBe(11);
    // Tout voir garde l'ordre : ceux qui demandent un geste d'abord.
    expect(await p.locator('#p-ctrl li').evaluateAll((l) => l.map((x) => x.className))).toEqual(['ko', 'ko', 'ko', 'ko', 'ko', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-bon-a-payer.png'), fullPage: true });
    // Approuver : le serveur garde la date sur chaque bulletin ; « Payer » revient.
    await p.locator('#p-bap').click();
    await expect.poll(async () => (await bulletins(A)).filter((b) => Number(b.month) === A.mo && b.bonAPayerLe).length).toBe(5);
    await expect.poll(() => p.locator('#p-payer').count()).toBe(1);
    await p.locator('#p-bulletins tr[data-bul]').first().getByRole('button', { name: /Actions/ }).click();
    await expect.poll(() => p.getByText('Marquer payé', { exact: true }).count()).toBe(1);
    await p.keyboard.press('Escape');
    // « Annuler » : les bulletins redeviennent à approuver.
    await p.locator('#toast-undo').click();
    await expect.poll(async () => (await bulletins(A)).filter((b) => Number(b.month) === A.mo && b.bonAPayerLe).length).toBe(0);
    await expect.poll(() => p.locator('#p-bap').count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('1.235.0 — tant que le cabinet prépare (pas envoyés), rien ne s\'approuve ni ne se paie', async () => {
    const A = await monter('prepa');
    const p = await ouvrir(A);
    await expect.poll(() => p.locator('#p-prep').count()).toBe(1);
    expect(await p.locator('#p-bap').count()).toBe(0);
    expect(await p.locator('#p-prep').isDisabled()).toBe(true);
    expect(espace(await p.locator('#p-prep').innerText())).toBe('Ton cabinet prépare les 5 bulletins');
    expect(espace(await p.locator('#p-prep-b').innerText())).toContain('Il te les envoie quand ils sont prêts');
    expect(await p.locator('#p-payer').count()).toBe(0);
    await p.close();
  });

  it('une correction proposée : accepter change le net et garde la trace ; refuser garde la raison', async () => {
    const B = await monter('signal');
    const hm = B.ceMois.find((b) => b.employeeId === 'hm');
    if (!hm) throw new Error('pas de bulletin d\'Hamza');
    const net0 = Number(hm.computed.net);
    let p = await ouvrir(B);
    await expect.poll(() => p.locator('#p-corr').count()).toBe(1);
    expect(espace(await p.locator('#p-corr-ok').innerText())).toBe('Accepter la correction de Anis');
    expect(espace(await p.locator('#p-frise li:nth-child(2)').innerText())).toContain('1 correction proposée');
    expect(espace(await p.locator('#p-corr-detail').innerText())).toContain(`Net à verser ${montant(net0)} DT ${montant(Math.round((net0 - 100) * 1000) / 1000)} DT`);
    expect(espace(await p.locator('#p-bulletins tr[data-bul="' + hm.id + '"]').innerText())).toContain('correction proposée');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-correction.png'), fullPage: true });
    await p.locator('#p-corr-ok').click();
    await expect.poll(async () => { const b = (await bulletins(B)).find((x) => x.id === hm.id); return b && (b.correction as Record<string, unknown>).reponse; }).toBe('acceptee');
    const apres = (await bulletins(B)).find((x) => x.id === hm.id);
    expect(Math.round(nombre((apres?.computed as Record<string, unknown>).net) * 1000) / 1000).toBe(Math.round((net0 - 100) * 1000) / 1000);
    // La correction acceptée, le bulletin attend encore le bon à payer : c'est lui, maintenant, le geste du mois.
    await expect.poll(() => p.locator('#p-corr').count()).toBe(0);
    await expect.poll(() => p.locator('#p-bap').count()).toBe(1);
    await p.close();
    // Refuser, sur une autre entreprise : la raison reste écrite, le net ne bouge pas.
    const C2 = await monter('signal');
    const hm2 = C2.ceMois.find((b) => b.employeeId === 'hm');
    if (!hm2) throw new Error('pas de bulletin d\'Hamza');
    p = await ouvrir(C2);
    await p.locator('#p-corr-non').click();
    await p.locator('#rc textarea[name=raison]').fill('Retenue déjà faite en espèces.');
    await p.locator('#rc-ok').click();
    await expect.poll(async () => { const b = (await bulletins(C2)).find((x) => x.id === hm2.id); return b && (b.correction as Record<string, unknown>).raison; }).toBe('Retenue déjà faite en espèces.');
    const garde = (await bulletins(C2)).find((x) => x.id === hm2.id);
    expect(nombre((garde?.computed as Record<string, unknown>).net)).toBe(Number(hm2.computed.net));
    await expect.poll(() => p.locator('#p-corr').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('la retenue du mois déposée et payée ; un virement de salaire rejeté redevient à payer', async () => {
    const A = await monter('payer');
    const p = await ouvrir(A);
    const declarations = async () => ((await api('GET', `/entreprises/${A.ent}/dossier-v10`, A.j)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'socialFilings').map((o) => o.contenu);
    // Un salaire payé, puis son virement rejeté : le bulletin redevient à payer, la raison reste écrite.
    const ligne = p.locator('#p-bulletins tr[data-bul]').first();
    const id = String(await ligne.getAttribute('data-bul'));
    await ligne.getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Marquer payé', { exact: true }).click();
    await expect.poll(async () => (await bulletins(A)).find((b) => b.id === id)?.paidDate).toBeTruthy();
    await p.waitForTimeout(6500);
    await p.locator(`#p-bulletins tr[data-bul="${id}"]`).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Annuler le paiement…', { exact: true }).click();
    await p.locator('#ap-ok').click();
    await expect.poll(async () => (await bulletins(A)).find((b) => b.id === id)?.paidDate).toBe('');
    const annules = (await bulletins(A)).find((b) => b.id === id)?.paiementsAnnules as { raison: string }[];
    expect(annules.map((x) => x.raison)).toEqual(['Virement rejeté par la banque']);
    // La retenue du mois : déposée ET payée, du montant de la déclaration.
    await p.locator('#p-tabs button[data-tab="declarations"]').click();
    await p.locator('#dm-file').click();
    await p.locator('#pd-ok').click();
    await expect.poll(async () => (await declarations()).find((f) => String(f.id).startsWith('dm-'))?.paidDate).toBeTruthy();
    const f = (await declarations()).find((x) => String(x.id).startsWith('dm-'));
    expect(nombre(f?.amount)).toBeGreaterThan(0);
    await expect.poll(() => p.locator('#dm-paye').innerText()).toMatch(/^déposée et payée le /);
    expect(espace(await p.locator('#dc-verses li').nth(1).innerText())).toMatch(/payée le /);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('la fiche d\'une arrivée, ce que tu verses et quand, l\'année par poste', async () => {
    const A = await monter('bap');
    let p = await ouvrir(A, { hash: '#/salarie/sa' });
    await expect.poll(() => p.locator('#fs-arrivee').count()).toBe(1);
    expect(await p.locator('#fs-head .pa-sous button[aria-selected="true"], .pa-sous-f button[aria-selected="true"]').first().innerText()).toContain('Son arrivée');
    const ko = (await p.locator('#fs-arrivee li.ko b').allInnerTexts()).map(espace);
    expect(ko).toEqual(['CIN', 'Premier bulletin au prorata', 'N° CNSS', 'RIB']);
    expect(await p.locator('#fs-especes').count()).toBe(1);
    // La pastille est une étiquette, pas un titre.
    const taille = await p.locator('.pa-h1-av .statut').evaluate((el) => Number(getComputedStyle(el).fontSize.replace('px', '')));
    expect(taille).toBeLessThan(14);
    // (1.252.0) Elle dit ce qui manque pour le payer et le déclarer, comme le bandeau de la fiche.
    expect(espace(await p.locator('.pa-h1-av .statut').innerText())).toBe('Son n° CNSS manque'); // payé en espèces : son RIB n'est pas exigé
    await p.close();
    p = await ouvrir(A);
    await p.locator('#p-tabs button[data-tab="declarations"]').click();
    // (1.251.0) Cinq lignes : le trimestre passé, le mois écoulé, le mois en cours, le trimestre en cours, l'année.
    await expect.poll(() => p.locator('#dc-verses li').count()).toBe(5);
    expect(espace(await p.locator('#dc-verses li').nth(1).innerText())).toMatch(/^Déclaration (de |d')\S+ : retenues et taxes sur les salaires/);
    expect(espace(await p.locator('#dc-verses li').nth(2).innerText())).toMatch(/^Déclaration (de |d')\S+ : retenues et taxes sur les salaires en cours : /);
    // 1.234.0 (la maquette) : plus de panneau « À déposer » ; le geste vit sur la ligne de ce qu'on verse.
    expect(await p.locator('#p-body h2', { hasText: 'À déposer' }).count()).toBe(0);
    expect(await p.locator('#dc-verses li').first().locator('[data-file]').count()).toBe(1);
    expect(await p.locator('#dm-panneau .pa-carte-t b').first().innerText()).toMatch(/^La déclaration d.\S+, sa part paie/);
    await p.locator('#p-tabs button[data-tab="annee"]').click();
    await expect.poll(() => p.locator('#p-annee-postes tbody tr').count()).toBe(4);
    const postes = (await p.locator('#p-annee-postes tbody tr td:first-child').allInnerTexts()).map(espace);
    expect(postes).toContain('Vendeuse');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
