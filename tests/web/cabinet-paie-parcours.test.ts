// La paie d'un dossier au Cabinet, telle que sa maquette et la revue (1.235.0 ; docs/revue-paie-cabinet.md, lots C1 à C3). Le
// parcours, écran ET serveur, sur trois choix écrits par le client (« Qui fait ma paie ») :
//   - « tenue » : l'en-tête le dit ; le seul bouton est l'étape suivante, « Envoyer à Sarra pour accord » (écrit `pourAccordLe`) ;
//     on attend son accord (le bon à payer, écrit chez elle) ; « Valider les 5 bulletins » les fige (`valideLe`) : plus de
//     « Modifier » ni de « Supprimer », et le pont refuse de les réécrire ;
//   - « seule » : faite par Sarra, vérifiée au cabinet ; aucun « Modifier » (D3) ; le bulletin s'ouvre à droite (d'où vient chaque
//     ligne, « Pourquoi cet IRPP ? ») ; « Proposer une correction… » écrit la proposition SUR le bulletin sans le changer (avant,
//     après, le net qu'il aurait, les champs dans les termes de l'entreprise) ; « Retirer la proposition » l'efface ;
//   - « sans » : le Cabinet la lit, aucun geste de paie ;
//   - une demande de congé que Sarra n'a pas acceptée ne se dit pas « payée » (D1) ; plus de « Passer l'écriture de paie » (D2).

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

describe('la paie d\'un dossier au Cabinet : qui la fait, l\'accord, la vérification, la correction proposée', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-paie-parcours-'));
  beforeAll(async () => {
    fs.mkdirSync(PHOTOS, { recursive: true });
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

  // Une boulangerie (Sarra) et son cabinet (Anis), le mandat de paie accepté ; cinq salariés en poste, leurs bulletins du mois
  // (et du mois d'avant), une demande de congé pas encore acceptée ; le choix écrit de Sarra : `mode`.
  const monter = async (mode: 'tenue' | 'seule' | 'sans', options: { avance?: boolean } = {}) => {
    const email = `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra', motDePasse: 'Un-bon-mot-de-passe' });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', j, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection, cle, rang: null, revision: null, contenu: enc(contenu) }] });
    const auj = new Date();
    const an = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mo = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const anA = mo === 1 ? an - 1 : an, moA = mo === 1 ? 12 : mo - 1;
    const mm = (m: number) => String(m).padStart(2, '0');
    const sal = (id: string, name: string, grossSalary: number, x: Record<string, unknown> = {}) => ({ id, name, grossSalary, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', ...x });
    // Le CDD de Karim finit dans 20 jours (19 si c'est un dernier jour de mois) : jamais en fin de mois, son dernier salaire
    // est toujours au prorata (1.241.0).
    const fin20 = new Date(Date.now() + 20 * 86400000);
    const finCdd = new Date(fin20.getTime() - (new Date(fin20.getTime() + 86400000).getUTCDate() === 1 ? 86400000 : 0)).toISOString().slice(0, 10);
    const S = [sal('mt', 'Mourad Trabelsi', 1450.25, { headOfFamily: true, children: 2 }), sal('hm', 'Hamza Mejri', 820.5), sal('nb', 'Nadia Ben Salah', 880.75), sal('kr', 'Karim Riahi', 1100.125, { contract: 'cdd', endDate: finCdd }), sal('ys', 'Yassine Sassi', 990.375)];
    const bul = (e: (typeof S)[number], y: number, m: number, brut: number) => {
      const saisie = { gross: brut, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})), paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${mm(m)}-28` };
    };
    const ceMois = S.map((e) => bul(e, an, mo, e.grossSalary));
    for (const e of S) await poser('employees', e.id, e);
    for (const b of [...ceMois, ...S.map((e) => ({ ...bul(e, anA, moA, e.grossSalary), paidDate: `${anA}-${mm(moA)}-28` }))]) await poser('payslips', b.id, b);
    if (options.avance) {
      // 1.237.0 — une avance versée le mois d'avant, à rendre 100,000 par mois, que le bulletin du mois ne retient pas ; et
      // un congé demandé pour les semaines qui viennent.
      await poser('advances', 'av1', { id: 'av1', employeeId: 'hm', date: `${anA}-${mm(moA)}-05`, amount: 300, monthly: 100, note: 'Avance' });
      const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      await poser('leaves', 'l2', { id: 'l2', employeeId: 'nb', kind: 'conges', from: j(10), to: j(12), paid: null, note: '', statut: 'demande', demandeLe: j(0) });
    }
    await poser('leaves', 'l1', { id: 'l1', employeeId: 'kr', kind: 'conges', from: `${an}-${mm(mo)}-20`, to: `${an}-${mm(mo)}-22`, paid: null, note: '', statut: 'demande', demandeLe: `${an}-${mm(mo)}-10` });
    const o = (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f = o.find((x) => x.collection === '_racine' && x.cle === 'company');
    await api('POST', `/entreprises/${ent}/dossier-v10`, j, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f ? f.revision : null,
      contenu: { ...(f ? f.contenu : {}), setupDone: true, managerName: 'Sarra Ayed', paieMode: mode, paieModeDes: '2020-01' } }] });
    const em2 = `anis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: em2, nom: 'Anis', motDePasse: 'Un-bon-mot-de-passe' });
    const ja = String((await api('POST', '/connexion', undefined, { email: em2, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', ja, { methode: 'application' });
    const cb = (await api('POST', '/cabinets', ja, { nom: 'Jlassi Conseil' })).corps;
    const cab = String(cb.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cb.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab}/mandats/${mandat}/accepter`, ja)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, ja, { annee: an, ouverture: [] })).statut).toBe(201);
    // La fiche du dossier au Cabinet : le prénom du contact (« Sarra ») est celui que les boutons nomment.
    const lire = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[]);
    const bulletins = async () => (await lire()).filter((x) => x.collection === 'payslips' && Number(x.contenu.month) === mo && Number(x.contenu.year) === an);
    return { j, ja, ent, cab, an, mo, ceMois, bulletins, poserPatron: poser, lire };
  };
  const ouvrir = async (A: { ja: string; ent: string; cab: string; an: number; mo: number }, largeur = 1440) => {
    const p = await (await nav.newContext({ viewport: { width: largeur, height: largeur > 500 ? 900 : 844 }, locale: 'fr-FR' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((jj) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', jj); }, A.ja);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${A.cab}#/dossier/${A.ent}/comptabilite/paie/${A.an}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption(String(A.mo));
    await p.locator('#pa-frise').waitFor({ timeout: 15_000 });
    return { p, erreurs };
  };
  const menuDe = async (p: Page, id: string) => {
    await p.locator(`[data-rowmenu="PAIE:${id}"]`).first().click();
    await p.getByRole('menuitem').first().waitFor({ timeout: 5_000 });
    const items = await p.getByRole('menuitem').allInnerTexts();
    await p.keyboard.press('Escape');
    return items.map(espace);
  };

  it('tenue au cabinet : envoyer pour accord, attendre le bon à payer, valider (figés)', async () => {
    const A = await monter('tenue');
    const { p, erreurs } = await ouvrir(A);
    expect(espace(await p.locator('#pa-qui').innerText())).toBe('5 salariés · tenue au cabinet, avec l\'accord de Sarra');
    expect(await p.locator('[data-pa-vue]').evaluateAll((els) => els.filter((e) => e.closest('.pa-so')).map((e) => (e.firstChild?.textContent ?? '').trim()))).toEqual(['Le mois', 'Salariés', 'Congés et avances', 'CNSS du trimestre', 'L\'année']);
    // Un seul bouton principal : l'étape suivante.
    expect(await p.locator('#view .btn-primary').count()).toBe(1);
    expect(espace(await p.locator('#pa-envoyer').innerText())).toBe('Envoyer à Sarra pour accord');
    expect(await p.locator('#pa-ecrire').count()).toBe(0);
    // Les bulletins rangés par ce qui change : ici, aucun écart sur le mois d'avant.
    expect(espace(await p.locator('#pa-bulletins tr.cp-pa-groupe').first().innerText())).toMatch(/^Comme \S+ · 5$/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-1-tenue.png') });

    // ── Envoyer : `pourAccordLe` au serveur ; on attend Sarra ───────────────────────────────────────────
    await p.locator('#pa-envoyer').click();
    await expect.poll(async () => (await A.bulletins()).filter((b) => b.contenu.pourAccordLe).length).toBe(5);
    await expect.poll(() => p.locator('#pa-attente').count()).toBe(1);
    expect(await p.locator('#pa-attente').isDisabled()).toBe(true);
    expect(espace(await p.locator('#pa-attente').innerText())).toBe('En attente de l\'accord de Sarra');
    expect(espace(await p.locator('#pa-attend-accord').innerText())).toContain('Les bulletins sont chez Sarra depuis le');

    // ── Sarra approuve chez elle (son bon à payer) : le Cabinet le lit, puis valide ─────────────────────
    const jour = new Date().toISOString().slice(0, 10);
    const lus = await A.bulletins();
    expect((await api('POST', `/entreprises/${A.ent}/dossier-v10`, A.j, { changements: lus.map((b) => ({ collection: 'payslips', cle: b.cle, rang: null, revision: b.revision, contenu: { ...b.contenu, bonAPayerLe: jour } })) })).statut).toBe(200);
    await p.reload();
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption(String(A.mo));
    await expect.poll(() => p.locator('#pa-accord').count()).toBe(1);
    expect(espace(await p.locator('#pa-accord').innerText())).toMatch(/^Sarra a approuvé les 5 bulletins le /);
    expect(espace(await p.locator('#pa-valider-bul').innerText())).toBe('Valider les 5 bulletins');
    // (1.240.0) Au clavier : Ctrl + Entrée sur une ligne fait l'étape suivante (la fenêtre de validation demande encore).
    expect(espace(await p.locator('#pa-touche-geste').innerText())).toBe('· Ctrl Entrée valider les 5 bulletins');
    await p.locator('#pa-bulletins tr[data-bul]').first().focus();
    await p.keyboard.press('Control+Enter');
    await p.getByRole('button', { name: 'Valider', exact: true }).last().click();
    await expect.poll(async () => (await A.bulletins()).filter((b) => b.contenu.valideLe === jour).length).toBe(5);
    // (1.242.0) Le toast dit ce qui est fait, et « Annuler » efface la validation du jour (la maquette « paieapres ») ;
    // validés de nouveau, ils ne changent plus.
    expect(espace(await p.locator('#toast .toast-txt').innerText())).toMatch(/^5 bulletins validés : ils ne changent plus\. L'écriture de paie d.\S+ reste au brouillard\.$/);
    await p.locator('#toast .toast-undo').click();
    await expect.poll(async () => (await A.bulletins()).filter((b) => b.contenu.valideLe).length).toBe(0);
    await expect.poll(() => p.locator('#pa-valider-bul').count()).toBe(1);
    await p.locator('#pa-valider-bul').click();
    await p.getByRole('button', { name: 'Valider', exact: true }).last().click();
    await expect.poll(async () => (await A.bulletins()).filter((b) => b.contenu.valideLe === jour).length).toBe(5);
    await expect.poll(() => p.locator('#pa-valides').count()).toBe(1);
    // Validés, le seul bouton principal est l'étape suivante : les remettre aux salariés.
    expect(await p.locator('#view .btn-primary').evaluateAll((els) => els.map((e) => e.id))).toEqual(['pa-remettre']);
    // Figés : leur menu n'offre plus ni « Modifier » ni « Supprimer » ; le pont refuse de les réécrire.
    const items = await menuDe(p, A.ceMois[0]?.id ?? '');
    expect(items.some((t) => /Modifier|Supprimer/.test(t))).toBe(false);
    const refus = await p.evaluate(async ([ent, an, id]) => {
      const api = (window as unknown as { cabinet: { saveBulletin: (o: unknown) => Promise<unknown> } }).cabinet;
      try { await api.saveBulletin({ dossierId: ent, annee: an, bulletin: { id, salarieId: 'mt', annee: an, mois: 1, brut: 1, joursTravailles: 26, joursAbsence: 0, primes: [], retenues: [] } }); return ''; } catch (e) { return (e as Error).message; }
    }, [A.ent, A.an, A.ceMois[0]?.id ?? ''] as const);
    expect(refus).toBe('Ce bulletin est validé : il ne change plus. Une correction passe par une régularisation sur un mois suivant.');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-2-valides.png') });

    // ── 1.236.0 (C4) — « Les bulletins sont faits » : les remettre, les salaires, les déclarer ; l'écriture compte par compte ─
    expect(espace(await p.locator('#pa-faits h3').innerText())).toMatch(/^Les bulletins d.\S+ sont faits$/);
    expect(await p.locator('#pa-faits li').count()).toBe(3);
    expect(espace(await p.locator('#pa-faits li').nth(1).innerText())).toContain('0 sur 5 payés · par Sarra');
    expect(await p.locator('#pa-rappel').count()).toBe(1);
    // 1.238.0 — le rappel dit le jour où les salaires sont dus (s'il n'est pas passé), et le message dit combien sont payés.
    expect(espace(await p.locator('#pa-rappel').innerText())).toMatch(/^Lui rappeler(, pour le \d\d\/\d\d)?$/);
    await p.locator('#pa-rappel').click();
    await expect.poll(() => p.locator('#modal-root .modal #dm-texte').count()).toBe(1);
    expect(await p.locator('#modal-root .modal #dm-texte').inputValue()).toMatch(/^Bonjour Sarra, les salaires d.\S+ ne sont pas tous marqués payés dans SkanFact \(0 sur 5\)\./);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    expect(await p.locator('#pa-declarer').count()).toBe(1);
    expect(espace(await p.locator('#pa-ecriture summary').innerText())).toMatch(/^L'écriture de paie, compte par compte/);
    expect(espace(await p.locator('#pa-ecriture tr.dc-total').innerText())).toContain('équilibrée');
    expect(espace(await p.locator('#pa-remettre').innerText())).toBe('Marquer les 5 bulletins remis aux salariés');
    await p.locator('#pa-remettre').click();
    await expect.poll(async () => (await A.bulletins()).filter((b) => b.contenu.remisLe === jour).length).toBe(5);
    await expect.poll(() => p.locator('#view .btn-primary').count()).toBe(0);
    expect(await p.locator('#pa-faits li.fait').count()).toBe(1);
    // 1.245.0 — « Les envoyer » : les 5 bulletins validés, en PDF, dans les documents de Sarra (elle les lit de son côté).
    expect(espace(await p.locator('#pa-envoyer-pdf').innerText())).toBe('Les envoyer à Sarra');
    await p.locator('#pa-envoyer-pdf').click();
    const rangesChezSarra = async () => ((await api('GET', `/entreprises/${A.ent}/cabinet/range`, A.j)).corps.pieces as { titre: string; fichier: { type: string } }[])
      .filter((x) => /^Bulletin de paie · /.test(x.titre));
    await expect.poll(async () => (await rangesChezSarra()).length, { timeout: 30_000 }).toBe(5);
    expect((await rangesChezSarra()).every((x) => x.fichier.type === 'application/pdf')).toBe(true);
    await expect.poll(() => p.locator('#pa-faits li').first().innerText().then(espace), { timeout: 15_000 }).toMatch(/les 5 dans les documents de Sarra \(le \d\d\/\d\d\/\d{4}\)/);
    // Les renvoyer remplace (l'ancien reste, marqué remplacé) : le classeur garde 5 bulletins en cours, pas 10.
    expect(espace(await p.locator('#pa-envoyer-pdf').innerText())).toBe('Les renvoyer');
    await p.locator('#pa-envoyer-pdf').click();
    const enCours = async () => ((await api('GET', `/cabinets/${A.cab}/classeur/${A.ent}/documents`, A.ja)).corps.documents as { titre: string; remplacePar: string | null; paie: boolean }[])
      .filter((x) => /^Bulletin de paie · /.test(x.titre));
    await expect.poll(async () => (await enCours()).length, { timeout: 30_000 }).toBe(10);
    expect((await enCours()).filter((x) => !x.remplacePar).length).toBe(5);
    // (16 § 10.1, point 12) Chacun porte la marque de la paie : seuls le rôle Paie et l'associé, sous un mandat Paie, le lisent.
    expect((await enCours()).every((x) => x.paie === true)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-6-faits.png'), fullPage: true });
    // Le classeur du dossier les range en Paie, « envoyé au client », sans rien à saisir.
    const ici = p.url();
    await p.goto(`${ici.split('#')[0]}#/dossier/${A.ent}/classeur`);
    const moisCl = `${A.an}-${String(A.mo).padStart(2, '0')}`;
    await p.locator(`[data-cl-m="${moisCl}"]`).first().click({ timeout: 20_000 });
    await p.locator('[data-cl-rub="paie"]').first().click();
    await expect.poll(() => p.locator('body').innerText().then(espace), { timeout: 20_000 }).toMatch(/Bulletin de paie · .* envoyé au client/);
    // Les 5 en cours, pas les 5 remplacés.
    expect(((await p.locator('body').innerText()).match(/Bulletin de paie · /g) ?? []).length).toBe(5);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-6b-classeur.png') });
    await p.goto(ici);
    await expect.poll(() => p.locator('#pa-faits').count(), { timeout: 20_000 }).toBe(1);
    // 1.247.0 — le virement du salaire de Karim (le mois d'avant, payé le 28) revient sur le compte : le relevé le dit, la
    // Paie de ce mois-là le dit, et « Le dire à Sarra » prépare le message. (En janvier, le mois d'avant est sur l'année
    // d'avant : le livre ouvert ne le porte pas, l'étape ne se joue pas.)
    if (A.mo !== 1) {
      const moA = A.mo - 1, mmA = String(moA).padStart(2, '0');
      const nb = (x: unknown) => Number(typeof x === 'object' && x ? (x as Record<string, string>)['~n'] : x);
      const kr = (await A.lire()).find((x) => x.collection === 'payslips' && x.contenu.employeeId === 'kr' && Number(x.contenu.month) === moA);
      const netKr = nb((kr?.contenu.computed as Record<string, unknown>).net);
      const revenuLe = new Date(Date.UTC(A.an, moA - 1, 28 + 4)).toISOString().slice(0, 10);
      const ok = await p.evaluate(async ([ent, an, net, le]) => {
        const api = (window as unknown as { cabinet: { ajouterReleve: (o: unknown) => Promise<{ ok: boolean }> } }).cabinet;
        return (await api.ajouterReleve({ dossierId: ent, annee: an, releve: { compte: '532', banque: 'BIAT', fichier: 'releve.csv', empreinte: 'a'.repeat(64), soldeDebut: 0, soldeFin: Math.round(net * 2000) / 1000,
          lignes: [{ date: le, libelle: 'REJET VIR SAL RIAHI KARIM COMPTE CLOS', reference: '', montant: net }, { date: le, libelle: 'VIR RECU CLIENT', reference: '', montant: net }] } })).ok;
      }, [A.ent, A.an, netKr, revenuLe] as const);
      expect(ok).toBe(true);
      await p.goto('about:blank'); await p.goto(ici);
      await p.locator('#pa-mois').waitFor({ timeout: 20_000 });
      await p.locator('#pa-mois').selectOption(String(moA));
      await expect.poll(() => p.locator('#pa-revenus').innerText().then(espace).catch(() => ''), { timeout: 20_000 })
        .toMatch(new RegExp(`^Un virement de salaire est revenu sur le compte\\. Karim Riahi : .*, payé le 28/${mmA}, revenu le \\d\\d/\\d\\d \\(« REJET VIR SAL RIAHI KARIM COMPTE CLOS »\\) Le dire à Sarra`));
      expect(await p.locator('[data-pa-revenu]').count()).toBe(1);
      expect(espace(await p.locator('.cp-pa-frise, #pa-frise').first().innerText().catch(() => ''))).toContain('1 virement revenu');
      await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-virement-revenu.png') });
      await p.locator('[data-pa-revenu-dire]').click();
      await expect.poll(() => p.locator('#modal-root .modal #dm-texte').count()).toBe(1);
      expect(await p.locator('#modal-root .modal #dm-texte').inputValue()).toMatch(/^Bonjour Sarra, le virement du salaire de Karim Riahi \(.*\) est revenu sur le compte le .* : le relevé dit « REJET VIR SAL RIAHI KARIM COMPTE CLOS »\./);
      await p.keyboard.press('Escape');
      await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
      await p.locator('#pa-mois').selectOption(String(A.mo));
      await expect.poll(() => p.locator('#pa-faits').count(), { timeout: 20_000 }).toBe(1);
    }

    // ── L'année, mois par mois : les douze mois additionnés font l'année (deux chemins, un chiffre) ─────────────
    await p.locator('.pa-so [data-pa-vue="annee"]').click();
    await expect.poll(() => p.locator('#pa-annee-juste').innerText()).toBe('✓ Les douze mois additionnés font l\'année, au millime.');
    expect(await p.locator('#pa-annee-mois tbody tr').count()).toBe(13);
    // ── La vue Salariés dit le CDD qui finit (et ce qui reste À VÉRIFIER) ───────────────────────────────────────
    await p.locator('.pa-so [data-pa-vue="salaries"]').click();
    expect(espace(await p.locator('#pa-cdd').innerText())).toMatch(/^Karim Riahi : son CDD finit le \d\d\/\d\d\/\d{4}\..*À VÉRIFIER/);
    // 1.238.0 — « Me le rappeler » : MON rappel sur le dossier (quinze jours avant la fin), et une note pour l'équipe.
    const rap = p.locator('#pa-cdd [data-pa-me-rappeler="kr"]');
    expect(espace(await rap.innerText())).toMatch(/^Me le rappeler le \d\d\/\d\d$/);
    const le = String(await rap.getAttribute('data-le'));
    await rap.click();
    await expect.poll(() => rap.innerText()).toMatch(/^Rappel le \d\d\/\d\d ✓$/);
    const suivi = (await api('GET', `/cabinets/${A.cab}/suivi/${A.ent}`, A.ja)).corps as { rappel: string | null; notes: { texte: string }[] };
    expect(String(suivi.rappel).slice(0, 10)).toBe(le);
    expect(suivi.notes.map((n) => n.texte).join(' | ')).toContain('Le contrat de Karim Riahi finit le');
    // 1.238.0 — la CNSS du trimestre face au compte du livre (écritures validées), et ce qui a été versé.
    await p.locator('.pa-so [data-pa-vue="cnss"]').click();
    expect(espace(await p.locator('#pa-cnss-livre').innerText())).toMatch(/^Le compte 4531 du livre \(écritures validées du trimestre\) : .* · la déclaration : .*/);
    // 1.243.0 — l'accusé de dépôt du trimestre : rangé au classeur depuis la Paie, puis « l'accusé est dans le classeur ».
    await expect.poll(() => p.locator('#pa-cnss-accuse-ranger').count(), { timeout: 15_000 }).toBe(1);
    await p.locator('#pa-cnss-accuse-ranger').click();
    await p.locator('#dp-f').setInputFiles({ name: 'accuse-cnss.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') });
    expect(await p.locator('#dp-titre').inputValue()).toMatch(/^L'accusé CNSS du (1er|\de) trimestre \d{4}$/);
    await p.locator('.modal #ok').click();
    await expect.poll(() => p.locator('#pa-cnss-accuse').innerText().then(espace).catch(() => ''), { timeout: 15_000 }).toMatch(/^Déposée · l'accusé est dans le classeur \(rangé le \d\d\/\d\d\/\d{4}\)\. Ouvrir l'accusé$/);
    // « Ouvrir l'accusé » l'ouvre en grand, ici, sans quitter la Paie.
    await p.locator('#pa-cnss-accuse-voir').click();
    await expect.poll(() => p.locator('.cl-gr-t').innerText().then(espace).catch(() => ''), { timeout: 15_000 }).toMatch(/^accuse-cnss\.pdf/);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('.cl-gr-t').count()).toBe(0);
    // 1.244.0 — la paie de tous mes dossiers (depuis L'année) : une ligne par dossier, ses bulletins et où ils en sont.
    await p.locator('.pa-so [data-pa-vue="annee"]').click();
    await p.locator('#pa-vers-tous [data-pa-vue="tous"]').click();
    await expect.poll(() => p.locator('#pa-tous-liste tbody tr').count(), { timeout: 15_000 }).toBe(1);
    expect(espace(await p.locator('#pa-tous-resume').innerText())).toBe('1 dossier avec une paie · 5 bulletins ce mois');
    expect(espace(await p.locator('#pa-tous-liste tbody tr').first().innerText())).toMatch(/^Boulangerie El Amal 5 \/ 5 .* validés/);
    expect(await p.locator('.pa-so [data-pa-vue="annee"]').getAttribute('aria-pressed')).toBe('true');
    await p.locator('#pa-tous-liste tbody tr').first().click();
    await expect.poll(() => p.locator('#pa-bulletins').count()).toBe(1);
    // 1.238.0 — un mois validé, et le pointage changé après : le bulletin ne bouge pas, l'écran le dit.
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await p.locator('#pa-frise li[data-pa-vue="pointage"]').click();
    await p.locator('#pt-panneau').waitFor({ timeout: 10_000 });
    const ouvre = Array.from({ length: 28 }, (_, i) => i + 1).find((d) => { const w = new Date(Date.UTC(A.an, A.mo - 1, d)).getUTCDay(); return w >= 1 && w <= 5; }) ?? 2;
    await p.locator('#pt-grille tr', { hasText: 'Hamza Mejri' }).locator(`.pt-c[data-pt="${ouvre}"]`).focus();
    await p.keyboard.press('a');
    await expect.poll(() => p.locator('#pt-ecarts').innerText()).toContain('Il est validé depuis le');
    expect(await p.locator('#pt-ecarts [data-pt-reprendre]').count()).toBe(0);
    expect(espace(await p.locator('#pt-resume').innerText())).toMatch(/salarié.* pointé.* · .*1 différence avec un mois complet : Hamza Mejri \(1 j non payé\)/);
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await expect.poll(() => p.locator('#pa-depuis-val').count()).toBe(1);
    expect(espace(await p.locator('#pa-depuis-val').innerText())).toMatch(/^Depuis la validation, le pointage a changé\. Hamza Mejri : .*se régularise sur \S+/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-8-depuis-validation.png'), fullPage: true });

    // ── C6 — un mois sans bulletin ni pointage : « Le demander à Sarra », « Le saisir moi-même » ───────────────────
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await p.locator('#pa-mois').selectOption(String(A.mo % 12 + 1));
    await expect.poll(() => p.locator('#pa-pt-attendu').count()).toBe(1);
    expect(espace(await p.locator('#pa-demander-pt').innerText())).toBe('Le demander à Sarra');
    await p.locator('#pa-demander-pt').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(1);
    expect(espace(await p.locator('#modal-root .modal').last().innerText())).toContain('pointage');
    await p.keyboard.press('Escape');
    await p.locator('#pa-saisir-pt').click();
    await p.locator('#pt-panneau').waitFor({ timeout: 10_000 });
    expect(erreurs).toEqual([]);
    await p.close();
  }, 240_000);

  it('faite par le client, vérifiée : pas de « Modifier », le bulletin à droite, une correction proposée puis retirée', async () => {
    const A = await monter('seule');
    const { p, erreurs } = await ouvrir(A);
    expect(espace(await p.locator('#pa-qui').innerText())).toBe('5 salariés · faite par Sarra dans SkanFact · le cabinet la vérifie, et la corrige avec son accord');
    expect(espace(await p.locator('#pa-seule').innerText())).toContain('Le cabinet ne change un bulletin fait par Sarra qu\'avec son accord');
    expect(espace(await p.locator('#pa-verifier-tout').innerText())).toBe('Marquer les 5 bulletins vérifiés');
    expect(await p.locator('#pa-bulletin').count()).toBe(0);
    // D3 : le menu d'un bulletin du client ne le réécrit pas.
    const hamza = A.ceMois.find((b) => b.employeeId === 'hm');
    const items = await menuDe(p, hamza?.id ?? '');
    expect(items.some((t) => /Modifier|Supprimer/.test(t))).toBe(false);
    expect(items.some((t) => t.startsWith('Proposer une correction…'))).toBe(true);

    // ── Le bulletin ouvert à droite, au clavier comme à la souris ──────────────────────────────────────
    await p.locator(`#pa-bulletins tr[data-bul="${hamza?.id}"] td`).first().click();
    await expect.poll(() => p.locator('#pa-volet').count()).toBe(1);
    expect(espace(await p.locator('#pa-volet h4').first().textContent() ?? '')).toBe('Ce qu\'il gagne');
    expect(espace(await p.locator('#pa-volet').innerText())).toContain('Salaire de base fiche');
    expect(espace(await p.locator('#pa-irpp').innerText())).toMatch(/^(Pourquoi .+ d'IRPP \?|Pas d'IRPP ce mois)/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-3-volet.png') });
    await p.locator('#pa-volet-x').click();
    await expect.poll(() => p.locator('#pa-volet').count()).toBe(0);
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.bul ?? '')).toBe(hamza?.id);
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#pa-volet').count()).toBe(1);

    // ── Proposer une correction : la retenue d'avance oubliée ; rien ne change du bulletin ──────────────
    await p.locator(`[data-pa-proposer="${hamza?.id}"]`).click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(() => fen.locator('h2').innerText()).toBe('Proposer une correction à Sarra');
    expect(await fen.locator('#pc-ok').isDisabled()).toBe(true);
    expect(espace(await fen.locator('#pc-refus').innerText())).toBe('Écris le montant de ce qui manque.');
    await fen.locator('[name=montant]').fill('100,250');
    expect(espace(await fen.locator('#pc-refus').innerText())).toBe('Dis à Sarra pourquoi : c\'est ce qu\'il lit avant d\'accepter.');
    await fen.locator('[name=motif]').fill('L\'échéance du mois de son avance n\'est pas retenue.');
    const netAvant = Number(hamza?.computed.net);
    await expect.poll(async () => espace(await fen.locator('#pc-apercu').innerText())).toContain('→');
    await fen.locator('#pc-ok').click();
    await expect.poll(async () => (await A.bulletins()).find((b) => b.cle === hamza?.id)?.contenu.correction != null).toBe(true);
    const b = (await A.bulletins()).find((x) => x.cle === hamza?.id)?.contenu as unknown as { computed: { net: unknown }; deductions: unknown[]; correction: { par: string; motif: string; lignes: Record<string, unknown>[]; net: unknown; champs: { deductions: Record<string, unknown>[] } } };
    // Le bulletin de Sarra n'a pas bougé : son net, ses retenues.
    expect(nombre(b.computed.net)).toBeCloseTo(netAvant, 3);
    expect(b.deductions).toEqual([]);
    // La proposition : qui, pourquoi, avant/après, le net qu'il aurait (100,250 de moins), et les champs de l'entreprise.
    expect(b.correction.par).toBe('Anis');
    expect(b.correction.motif).toBe('L\'échéance du mois de son avance n\'est pas retenue.');
    expect(b.correction.lignes.map((l: Record<string, unknown>) => [l.libelle, nombre(l.avant), nombre(l.apres)])).toEqual([['Remboursement d\'avance', 0, 100.25]]);
    expect(nombre(b.correction.net)).toBeCloseTo(netAvant - 100.25, 3);
    expect(b.correction.champs.deductions.map((d: Record<string, unknown>) => [d.label, nombre(d.amount)])).toEqual([['Remboursement d\'avance', 100.25]]);
    // L'écran : la carte avant/après, et l'attente de Sarra.
    await expect.poll(() => p.locator(`[data-pa-corr="${hamza?.id}"]`).count()).toBe(1);
    expect(espace(await p.locator('#pa-attente').innerText())).toBe('En attente de Sarra');
    expect(espace(await p.locator(`#pa-bulletins tr[data-bul="${hamza?.id}"]`).innerText())).toContain('correction proposée');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-4-proposee.png') });

    // ── La retirer : la proposition disparaît de sa paie ──────────────────────────────────────────────
    await p.locator(`[data-pa-retirer="${hamza?.id}"]`).click();
    await p.getByRole('button', { name: 'Retirer', exact: true }).last().click();
    await expect.poll(async () => (await A.bulletins()).find((x) => x.cle === hamza?.id)?.contenu.correction ?? null).toBe(null);
    await expect.poll(() => p.locator(`[data-pa-corr="${hamza?.id}"]`).count()).toBe(0);

    // ── Marquer vérifiés : `verifieLe` sur les cinq ────────────────────────────────────────────────────
    await p.locator('#pa-verifier-tout').click();
    await expect.poll(async () => (await A.bulletins()).filter((x) => x.contenu.verifieLe).length).toBe(5);
    await expect.poll(() => p.locator('#view .btn-primary').count()).toBe(0);

    // ── D1 : la demande de congé de Karim, pas acceptée, ne se dit pas « payée » ─────────────────────────
    await p.locator('.pa-so [data-pa-vue="conges"]').click();
    await p.locator('#cg-liste').waitFor({ timeout: 10_000 });
    expect(espace(await p.locator('#cg-liste tbody tr', { hasText: 'Karim' }).innerText())).toContain('demandée, pas encore acceptée');
    expect(espace(await p.locator('#cg-liste tbody tr', { hasText: 'Karim' }).innerText())).not.toContain('payée');
    expect(erreurs).toEqual([]);
    await p.close();
  }, 240_000);

  it('1.237.0 — l\'inventaire de la maquette : l\'avance oubliée trouvée et proposée, les contrôles, le volet, les écarts, le paramétrage, l\'année, les salariés, les absences à venir', async () => {
    const A = await monter('seule', { avance: true });
    const { p, erreurs } = await ouvrir(A);
    const hamza = A.ceMois.find((b) => b.employeeId === 'hm');
    // Les nombres sur les vues.
    expect(espace(await p.locator('.pa-so [data-pa-vue="salaries"] .cp-pa-nb').innerText())).toBe('5');
    // L'avance oubliée, trouvée d'elle-même : le bandeau, et le bouton principal la propose.
    expect(espace(await p.locator(`[data-pa-oubli="${hamza?.id}"]`).innerText())).toMatch(/^Hamza Mejri : l'avance n'est pas retenue\..*100,000/);
    expect(espace(await p.locator('#pa-proposer-oubli').innerText())).toBe('Proposer la correction à Sarra');
    // Les contrôles : ce qui demande un geste d'abord, les justes ensuite, avec les règles À VÉRIFIER.
    const ctl = espace(await p.locator('#pa-controles').innerText());
    for (const morceau of ['Une avance pas retenue', 'Aucun net négatif ni nul', 'Taux du dossier', 'Le SMIG', 'À VÉRIFIER']) expect(ctl).toContain(morceau);
    expect(await p.locator('#pa-controles [data-ctl="ko"]').count()).toBeGreaterThanOrEqual(1);
    expect(ctl).toMatch(/\d+ contrôles · \d+ justes · \d+ à savoir/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-7-inventaire.png'), fullPage: true });
    // La correction préremplie : la retenue, son montant, sa raison ; acceptée, elle remboursera l'avance (advanceId).
    await p.locator('#pa-proposer-oubli').click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(() => fen.locator('[name=montant]').inputValue()).toBe('100,000');
    expect(await fen.locator('[name=motif]').inputValue()).toContain('n\'est pas retenue');
    await fen.locator('#pc-ok').click();
    await expect.poll(async () => (await A.bulletins()).find((b) => b.cle === hamza?.id)?.contenu.correction != null).toBe(true);
    const corr = ((await A.bulletins()).find((x) => x.cle === hamza?.id)?.contenu as unknown as { correction: { champs: { deductions: Record<string, unknown>[] } } }).correction;
    expect(corr.champs.deductions.map((d) => [nombre(d.amount), d.advanceId])).toEqual([[100, 'av1']]);
    // Le volet : le PDF et « Vérifié », pas de « Modifier » sur la paie du client ; le RIB masqué.
    const nadia = A.ceMois.find((b) => b.employeeId === 'nb');
    await p.locator(`#pa-bulletins tr[data-bul="${nadia?.id}"] td`).first().click();
    await expect.poll(() => p.locator('#pa-volet').count()).toBe(1);
    expect(await p.locator(`#pa-volet [data-pa-pdf="${nadia?.id}"]`).count()).toBe(1);
    expect(await p.locator(`#pa-volet [data-pa-verifie="${nadia?.id}"]`).count()).toBe(1);
    expect(await p.locator('#pa-volet [data-pa-modifier]').count()).toBe(0);
    expect(espace(await p.locator('#pa-volet').innerText())).toContain('par virement · ··· 2359');
    // 1.238.0 — « Contrôlé : … » sur le bulletin : ce que les contrôles du mois disent de lui.
    expect(espace(await p.locator('#pa-volet-ctl').innerText())).toBe('Contrôlé : ✓ net positif');
    await p.locator(`#pa-bulletins tr[data-bul="${hamza?.id}"] td`).first().click();
    await expect.poll(() => p.locator('#pa-volet-ctl').innerText()).toMatch(/✓ net positif · ! avance pas retenue$/);
    // L'écriture regroupée par compte, et le mois d'avant.
    expect(await p.locator('#pa-ecriture tr[data-compte="640"]').count()).toBe(1);
    expect(espace(await p.locator('#pa-mois-avant').innerText())).toMatch(/^\S+ : 5 bulletins.*Ouvrir/);
    // Les écarts, ligne à ligne : la somme des écarts fait l'écart du brut (deux chemins, un chiffre).
    await p.locator('#pa-controles [data-pa-vue="ecarts"]').first().click();
    await expect.poll(() => p.locator('#pa-ecarts-juste').innerText()).toMatch(/^✓ Brut .* égal au millime\.$/);
    // Le paramétrage du dossier : ce qui est réglé, ce qui ne l'est pas, la convention d'abord.
    await p.locator('#pa-ecarts [data-pa-vue="mois"]').click();
    await p.locator('#pa-controles [data-pa-vue="param"]').click();
    await expect.poll(() => p.locator('#pa-param-conv').count()).toBe(1);
    expect(espace(await p.locator('#pa-param').innerText())).toMatch(/\d+ réglés · \d+ à régler/);
    // L'année : les bulletins et le livre ; la fin de l'année.
    await p.locator('.pa-so [data-pa-vue="annee"]').click();
    expect(espace(await p.locator('#pa-livre-640').innerText())).toContain('égaux au millime');
    expect(await p.locator('#pa-fin-annee li').count()).toBe(5);
    // Les salariés : le résumé, l'ancienneté, le RIB masqué, le CDD qui finit et ses documents de sortie.
    await p.locator('.pa-so [data-pa-vue="salaries"]').click();
    expect(espace(await p.locator('#pa-sal-resume').innerText())).toMatch(/^5 en poste · 1 contrat qui finit · aucun sorti$/);
    expect(espace(await p.locator('#pa-salaries tr[data-sal="mt"]').innerText())).toMatch(/depuis 03\/2023.*··· 2359/);
    expect(await p.locator('#pa-cdd [data-pa-docs="kr"]').count()).toBe(1);
    // 1.240.0 — la fiche du salarié, à droite : un clic l'ouvre, la croix la ferme ; rien d'inventé.
    await p.locator('#pa-salaries tr[data-sal="mt"] td').first().click();
    const fiche = espace(await p.locator('#pa-sal-fiche').innerText());
    expect(fiche).toMatch(/^Mourad Trabelsi Boulanger · entrée le 10\/03\/2023 complète/);
    expect(fiche).toContain('Salaire de base 1 450,250 DT par mois');
    expect(fiche).toContain('Situation chef de famille, 2 enfants à charge');
    expect(fiche).toContain('CIN à renseigner');
    expect(fiche).toContain('RIB ··· 2359');
    expect(fiche).toMatch(/Congés [\d,]+ j acquis en \d{4} · [\d,]+ j pris · reste [\d,]+ j/);
    expect(await p.locator('#pa-sal-fiche-demander').count()).toBe(0);
    await p.locator('#pa-sal-x').click();
    expect(await p.locator('#pa-sal-fiche').count()).toBe(0);
    // 1.241.0 — le départ du CDD qui finit : son dernier bulletin en projet (le salaire + les congés pas pris = le brut), ce
    // que le départ demande, et ses gestes ; l'indemnité de fin de contrat reste vide (À VÉRIFIER).
    await p.locator('#pa-cdd [data-pa-depart="kr"]').click();
    const dep = espace(await p.locator('#pa-depart').innerText());
    expect(dep).toMatch(/^Le départ de Karim Riahi, le \d\d\/\d\d\/\d{4} CDD qui arrive à son terme/);
    expect(dep).toMatch(/Indemnité de fin de contrat selon son contrat et la convention collective \(À VÉRIFIER\) —/);
    expect(dep).toMatch(/CNSS sa sortie dans la déclaration du (1er|\de) trimestre \d{4}/);
    const dt = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    const cells = await p.locator('#pa-depart-bul tbody td.r').allInnerTexts();
    // Il part avant la fin du mois : son salaire du mois est au prorata (le calcul du bulletin), pas un mois complet.
    expect(dep).toMatch(/au prorata : [\d,]+ j sur [\d,]+ \(sortie le \d\d\/\d\d\/\d{4}\) · 1 100,125 DT pour un mois complet/);
    expect(dt(cells[0] ?? '')).toBeLessThan(1100.125);
    expect(dt(await p.locator('#pa-depart-brut').innerText())).toBeCloseTo(dt(cells[0] ?? '') + dt(cells[1] ?? ''), 3);
    expect(await p.locator('#pa-depart-envoyer').count()).toBe(1);
    await p.locator('#pa-depart-cert').click();
    await expect.poll(() => p.locator('#dp-form select[name=kind]').inputValue()).toBe('certificat');
    await p.keyboard.press('Escape');
    await p.locator('#pa-depart-x').click();
    expect(await p.locator('#pa-depart').count()).toBe(0);
    // Congés et avances : l'absence à venir, et qui décide.
    await p.locator('.pa-so [data-pa-vue="conges"]').click();
    expect(espace(await p.locator('#pa-absences').innerText())).toContain('la décision est à Sarra');
    // 1.238.0 — l'échéancier de l'avance : mois par mois, ce qui est retenu, ce qui ne l'est pas (son bulletin est fait), à venir.
    const ech = espace(await p.locator('#av-echeancier [data-av-ech="av1"]').innerText());
    expect(ech).toMatch(/^Hamza Mejri · 300,000 DT versés le \d\d\/\d\d\/\d{4} · 100,000 DT par mois/);
    expect(await p.locator('#av-echeancier [data-av-ech="av1"] .oubli').count()).toBe(2);
    expect(await p.locator('#av-echeancier [data-av-ech="av1"] .cp-pa-ech > span').count()).toBe(3);
    expect(erreurs).toEqual([]);
    await p.close();
  }, 300_000);

  it('faite par le client seul : le Cabinet la lit, sans geste de paie ; au téléphone, rien ne déborde', async () => {
    const A = await monter('sans');
    const { p, erreurs } = await ouvrir(A, 390);
    expect(espace(await p.locator('#pa-sans').innerText())).toContain('Sarra fait sa paie seul dans SkanFact : le Cabinet la lit et la passe en comptabilité.');
    expect(await p.locator('#view .btn-primary, #pa-attente, #pa-bulletin').count()).toBe(0);
    const items = await menuDe(p, A.ceMois[0]?.id ?? '');
    expect(items.some((t) => /Modifier|Supprimer|Proposer/.test(t))).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-parcours-5-sans-390.png'), fullPage: true });
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(erreurs).toEqual([]);
    await p.close();
  }, 180_000);
});
