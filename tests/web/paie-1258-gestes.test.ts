// 1.258.0 — les fenêtres qui restaient de la maquette paie (docs/paie-ecarts-maquette.md, lot 1.258.0), à la souris, écran
// ET serveur :
//   - le rappel d'une augmentation (O05) : qui, combien par mois, le rappel, porté sur le mois qui n'est pas encore payé ;
//   - les documents (O08, O18, O19) : « Pour », la liste des documents, « Prêt », le numéro qui naît au document fait ; le
//     journal de paie posé en paysage ;
//   - la déclaration du mois sans cabinet (O17) : ce qu'elle reporte, ligne par ligne, et le total qui fait le montant ;
//   - « Le mois » avant ses bulletins (O28) : le pointage du mois en lecture, qui mène au pointage ;
//   - les réglages des retards retenus et des heures de nuit ; la demande de correction au cabinet (O25), sa ligne.

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

describe('la paie 1.258.0 : la journée validée, le rappel, les documents, la déclaration, le mois avant ses bulletins', () => {
  let nav: Browser; let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1258-'));
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
    await poser('_racine', 'payrollSettings', { equipes: [{ id: 'q1', nom: 'Le fournil, la nuit', debut: '03:00', fin: '11:00', jours: [1, 2, 3, 4, 5, 6], pointe: 'main' }] });
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
  // (1.267.0) La bande est sur « Le mois » (la page s'ouvre sur « Aujourd'hui ») ; l'étape ouverte ne change pas.
  const auMoisDernier = async (p: Page, x: { an: number; anA: number; moA: number }) => {
    if (await p.locator('#p-mois').isHidden()) await p.locator('#p-tabs [data-tab="bulletins"]').click();
    if (x.anA !== x.an) { await p.locator('#p-an-prec').click(); await p.waitForTimeout(300); }
    await p.locator(`#p-mois [data-p-mois="${x.moA}"]`).click();
    await p.waitForTimeout(400);
  };
  const toast = (p: Page) => p.locator('#toast').innerText().then(espace);

  // La journée validée et sa règle : depuis la 1.259.0 (une seule règle, le réglage retiré), tests/web/paie-1259-gestes.test.ts.

  it('le rappel d\'une augmentation (O05) : qui, combien par mois, le rappel du mois payé, porté sur le mois en cours', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.locator('#p-plus').click();
    await p.getByText('Augmenter les salaires…', { exact: true }).click();
    await p.locator('#al').waitFor();
    // Mourad seul, + 50 DT, depuis le mois dernier (déjà payé).
    await p.locator('#modal-root [data-al-c="nb"]').uncheck();
    await p.locator('#modal-root [name=sorte][value=dt]').check();
    await p.locator('#modal-root [name=valeur]').fill('50');
    await p.locator('#modal-root [name=des]').selectOption(`${x.anA}-${mm(x.moA)}`);
    await p.locator('#al-ok').click();
    await p.locator('#rp-t').waitFor();
    const ligne = espace(await p.locator('#rp-t tr[data-rp="mt"]').innerText());
    expect(ligne).toBe('Mourad Trabelsi 50,000 DT 1 50,000 DT'); // + par mois, le mois payé, le rappel
    expect(espace(await p.locator('#rp-t tfoot').innerText())).toMatch(new RegExp(`^Rappel ${/^[aeiouyéè]/.test(MOIS[x.mo - 1] ?? '') ? 'd\'' : 'de '}${MOIS[x.mo - 1]}, brut 50,000`));
    expect(espace(await p.locator('#rp-ok').innerText())).toBe(`Mettre le rappel sur ${MOIS[x.mo - 1]}`);
    await p.locator('#rp-ok').click();
    await expect.poll(() => toast(p)).toMatch(new RegExp(`^1 salaire augmenté à partir ${/^[aeiouyéè]/.test(MOIS[x.moA - 1] ?? '') ? 'd\'' : 'de '}${MOIS[x.moA - 1]} ${x.anA} · 1 rappel`));
    // Le rappel est sur le bulletin du mois en cours ; celui du mois payé n'a pas bougé.
    const B = async () => (await objets(x)).filter((o) => o.collection === 'payslips').map((o) => o.contenu);
    await expect.poll(async () => JSON.stringify((await B()).find((b) => b.id === `p-mt-${x.an}-${x.mo}`))).toMatch(/Rappel de salaire/);
    expect(JSON.stringify((await B()).find((b) => b.id === `p-mt-${x.anA}-${x.moA}`))).not.toMatch(/Rappel de salaire/);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('les documents (O08, O18, O19) : « Pour », la liste, « Prêt », le numéro qui naît au document fait ; le journal en paysage', async () => {
    const x = await monter();
    const p = await ouvrir(x);
    await p.route('**/v1/pdf', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ motif: { code: 'pdf.indisponible', texte: 'indisponible' }, bouton: null, indisponible: true }) }));
    await p.evaluate(() => { (window as unknown as { open: unknown }).open = () => ({ document: { write() {}, close() {} }, focus() {}, print() {} }); });
    await auMoisDernier(p, x);
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    // Le bulletin de Mourad, en document : à gauche « Pour » (les deux bulletins du mois), la liste des documents, « Prêt ».
    await p.locator(`#p-bulletins tr[data-bul="p-mt-${x.anA}-${x.moA}"]`).click();
    await p.locator('#bg-doc').click();
    await p.locator('#ad-apercu iframe').waitFor();
    expect(await p.locator('[data-ad-pour]').count()).toBe(2);
    expect(await p.locator('[data-ad-pour][aria-pressed="true"]').getAttribute('title')).toBe('Mourad Trabelsi');
    const docs = (await p.locator('.ad-doc b').allInnerTexts()).map(espace);
    expect(docs).toEqual(['Bulletin de paie', 'Attestation de travail', 'Attestation de salaire', 'Attestation de salaires et de retenues', 'Contrat de travail', 'Avenant au contrat', 'Fin de période d\'essai', 'Certificat de travail', 'Solde de tout compte']);
    expect(espace(await p.locator('.ad-doc.on').innerText())).toBe('Bulletin de paie');
    expect(espace(await p.locator('#ad-pret').innerText())).toMatch(/^Prêt les montants viennent du bulletin ; il ne se modifie pas ici /);
    // Payé et déjà remis : rien à remettre ; « Imprimer » est là.
    expect(await p.locator('#ad-remettre').count()).toBe(0);
    expect(await p.locator('#ad-imprimer').count()).toBe(1);
    // « Pour » Nadia : son bulletin du même mois.
    await p.locator('[data-ad-pour][title="Nadia Ben Salah"]').click();
    await expect.poll(() => p.locator('#modal-root .modal h2').last().innerText().then(espace)).toMatch(/^Nadia Ben Salah · bulletin de /);
    // De son bulletin à son attestation de travail : la fenêtre du document, le numéro dit avant, né au document fait.
    await p.locator('.ad-doc').filter({ hasText: 'Attestation de travail' }).click();
    await p.locator('#hf').waitFor();
    expect(await p.locator('[data-hf-kind="attestation"]').getAttribute('aria-checked')).toBe('true');
    expect(espace(await p.locator('#hf-pret').innerText())).toContain(`numéroté (n° ${x.an}-001)`);
    await p.locator('#hf-imprimer').click();
    await expect.poll(() => toast(p)).toMatch(/envoyée à l'impression · notée dans ses documents/);
    const faits = async () => ((await objets(x)).find((o) => o.collection === 'employees' && o.cle === 'nb')?.contenu.documentsFaits as { numero?: string; kind: string }[] | undefined) ?? [];
    await expect.poll(async () => (await faits()).map((d) => [d.kind, d.numero])).toEqual([['attestation', `${x.an}-001`]]);
    // Le journal de paie du mois : ses documents voisins, et la page posée en paysage (le journal est un A4 paysage). La vue du
    // bulletin, ouverte dessous, se ferme d'abord.
    for (let i = 0; i < 3 && await p.locator('#modal-root .modal').count(); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    await p.locator('#p-plus').click();
    await p.getByText('Journal de paie', { exact: true }).click();
    await p.locator('#jp-voir').click();
    await p.locator('#ad-apercu iframe').waitFor();
    expect((await p.locator('.ad-doc b').allInnerTexts()).map(espace)).toEqual(['Journal de paie', 'Ordre de virement', 'Reçu de salaire en espèces', 'Registre du personnel']);
    expect(await p.locator('#ad-apercu iframe').evaluate((f) => [(f as HTMLElement).style.width, (f as HTMLElement).style.height])).toEqual(['1123px', '794px']);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('la déclaration du mois (O17), le mois avant ses bulletins (O28), les réglages des retards et de la nuit', async () => {
    const x = await monter({ sansCeMois: true });
    const p = await ouvrir(x);
    // Le mois en cours n'a pas de bulletin : son étape « Bulletins » montre le pointage qu'ils reprendront, et mène au pointage.
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await p.locator('#mp-pointage').waitFor();
    expect(await p.locator('#mp-t tr').count()).toBe(2);
    expect(espace(await p.locator('#mp-t tr').first().innerText())).toMatch(/^MT Mourad Trabelsi \d+ j$/);
    expect(await p.locator('#pv-carte').count()).toBe(1);
    await p.locator('#mp-pointage .pa-carte-t [data-mp-pointage]').click();
    await p.locator('#pt-exc').waitFor(); // (1.259.0) « Le mois » du pointage, en relecture
    // Les réglages : retenir les retards, la nuit de 21:00 à 05:00 à +25 % ; le compteur dit les heures du mois.
    await p.locator('[data-sous="pt-horaires"]').click();
    await p.locator('#pt-h [name=retenirRetards]').check();
    await p.locator('#pt-h [name=nuitDebut]').fill('21:00');
    await p.locator('#pt-h [name=nuitFin]').fill('05:00');
    await p.locator('#pt-h [name=nuitMajoration]').fill('25');
    await p.locator('#pt-h-ok').click();
    await expect.poll(async () => { const s = (await racine(x, 'payrollSettings')) as Record<string, unknown>; return [s.retenirRetards, s.nuitDebut, s.nuitFin, Number(s.nuitMajoration)]; }).toEqual([true, '21:00', '05:00', 25]);
    await p.locator('[data-sous="pointage"]').click();
    await expect.poll(() => p.locator('#pt-compteurs').innerText().then(espace)).toMatch(/Heures de nuit du mois \d+(,\d+)? h de 21:00 à 05:00, majorées de 25 % sur le bulletin/);
    expect(espace(await p.locator('#pt-compteurs').innerText())).toContain('retenus sur le salaire (ton réglage)');
    // La déclaration du mois dernier, sans cabinet : ce qu'elle reporte, et le total qui fait le montant.
    await p.locator('#p-sous [data-sous="declarations"]').click();
    await auMoisDernier(p, x);
    await p.locator('#dm-file').click();
    await p.locator('#pd-t').waitFor();
    expect(espace(await p.locator('#modal-root .modal h2').innerText())).toBe(`Ta déclaration ${/^[aeiouyéè]/.test(MOIS[x.moA - 1] ?? '') ? 'd\'' : 'de '}${MOIS[x.moA - 1]}, la part paie`);
    const lignes = await p.locator('#pd-t tbody tr').allInnerTexts();
    expect(lignes.some((l) => espace(l).startsWith('Retenue à la source sur les salaires (IRPP) base '))).toBe(true);
    const montant = (t: string) => Number((/([\d\s\u202f\u00a0]+,\d{3})(?: DT)?\s*$/.exec(t)?.[1] ?? '0').replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'));
    const somme = Math.round(lignes.reduce((a, l) => a + montant(l), 0) * 1000);
    expect(somme).toBe(Math.round(montant(await p.locator('#pd-montant').innerText()) * 1000));
    expect(await p.locator('#pd-csv').count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('la correction demandée au cabinet (O25) : le bulletin, sa ligne, ce qui ne va pas, et la règle', async () => {
    const sonia = await personne('sonia', 'Sonia Ben Youssef');
    const cab = (await api('POST', '/cabinets', sonia, { nom: 'Fiduciaire Ennour' })).corps;
    const x = await monter();
    const mandat = String((await api('POST', `/entreprises/${x.ent}/mandat`, x.j, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.id)}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const p = await ouvrir(x);
    await p.locator('#foot-comptable').waitFor({ state: 'visible', timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.locator('#p-head').waitFor();
    await auMoisDernier(p, x);
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await p.locator(`#p-bulletins tr[data-bul="p-nb-${x.anA}-${x.moA}"]`).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Régulariser sur un mois suivant…', { exact: true }).click();
    await p.locator('#rg-rect').click();
    await p.locator('#dco').waitFor();
    expect(espace(await p.locator('#modal-root .modal .regle').innerText())).toBe('Ton comptable corrige et te renvoie le bulletin à approuver. Rien ne change sans que tu le voies.');
    // Les lignes de CE bulletin, le salaire de base d'abord, « Autre chose » en dernier.
    const L = (await p.locator('#dco-ligne option').allInnerTexts()).map(espace);
    expect([L[0], L[L.length - 1]]).toEqual(['Salaire de base', 'Autre chose']);
    expect(L).toContain('Impôt sur le revenu (IRPP)');
    await p.locator('#dco [name=bul]').selectOption({ label: `Nadia Ben Salah · ${MOIS[x.moA - 1]}` });
    await p.locator('#dco-ligne').selectOption('Salaire de base');
    // Sans texte, rien ne part : le refus le dit.
    await p.locator('#dco-ok').click();
    await expect.poll(() => toast(p)).toBe('Écris ce qui ne va pas : c’est ce que ton comptable lira.');
    await p.locator('#dco [name=texte]').fill('les 16 et 17 étaient des congés payés, pas sans solde');
    await p.screenshot({ path: path.join(os.tmpdir(), 'paie-1258-o25.png') });
    await p.locator('#dco-ok').click();
    // La conversation s'ouvre, le message prêt : le bulletin, la ligne, ce qui ne va pas.
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/comptable');
    await expect.poll(() => p.locator('textarea').first().inputValue().then(espace)).toMatch(new RegExp(`^Bulletin de Nadia Ben Salah, ${MOIS[x.moA - 1]} ${x.anA} \\(net .+\\), la ligne « Salaire de base » : les 16 et 17 étaient des congés payés, pas sans solde$`));
    expect(erreurs).toEqual([]);
  }, 150_000);
});
