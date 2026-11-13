// 1.357.8, demandé par Skander (deux captures : l'achat PK-2611-07 en formulaire, la facture de vente en résumé au téléphone) :
// « pourquoi la facture d'achat reste comme ça, et pas comme la facture avec le nouveau résumé ? ». La première capture datait
// d'avant la 1.357.0 ; ce qui restait différent de la vente, il l'aligne : la ligne « Comptabilité · voir l'écriture », la ligne
// « Affaire » toujours là avec son geste, et les lignes en liste au téléphone (le tableau y coupait le prix).
// Et en le jouant : l'écriture d'un achat ne se retrouvait JAMAIS (son origine est l'identifiant SERVEUR de la pièce, l'écran
// cherchait le sien) — la frise « Au cabinet » ne disait donc jamais « vue » ni « validée » depuis la 1.155.12 ; et quand le
// cabinet est appris après la page, l'étape naissait sans la réponse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('1.357.8 : le résumé de l\'achat dit ce qu\'en a fait le cabinet, range la pièce dans une affaire, et montre ses lignes au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achat-resume-1358-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('Sarra relit PK-2611-07 : l\'écriture au brouillard puis validée par Leila, la frise qui le suit, l\'affaire rangée et retirée, et les lignes au téléphone', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fr = auj.split('-').reverse().join('/');
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'suppliers', cle: 's-peintre', rang: 0, revision: null, contenu: { id: 's-peintre', name: 'Peinture Ksibi', matricule: '0912345B/A/M/000', paymentTermsDays: 30 } },
      { collection: 'purchases', cle: 'a-1', rang: 0, revision: null, contenu: { id: 'a-1', kind: 'facture', number: 'PK-2611-07', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 1, withholdingRate: 0, category: 'Entretien et réparations', subject: 'Peinture de la boutique', createdAt: Date.now(),
        lines: [{ label: 'Peinture de la boutique', qty: 1, unitPrice: 2400, vatRate: 19, destination: 'charge' }] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const surLeServeur = async (col: string, cle: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[]).find((o) => o.collection === col && o.cle === cle)?.contenu;
    // L'écriture d'achat existe côté serveur, au brouillard : son origine est l'identifiant SERVEUR de la pièce, pas « a-1 ».
    const lireAchat = async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?journal=AC&piece=PK-2611-07`, leila)).corps.ecritures as Obj[]).filter((e) => e.origine && e.origine.type === 'achat');
    await expect.poll(async () => (await lireAchat()).length, { timeout: 20_000 }).toBe(1);
    expect((await lireAchat())[0]?.origine.id).not.toBe('a-1');

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const erreurs: string[] = [];
    const ouvrir = async (retarderLeCabinet = false) => {
      const p = await cx.newPage();
      p.on('pageerror', (x) => erreurs.push(x.message));
      // Le cabinet appris APRÈS la page : la réponse qui le dit arrive deux secondes et demie plus tard. L'étape « Au cabinet »
      // naît alors au redessin de la frise ; sans la relecture partagée, elle disait « attend le justificatif ».
      if (retarderLeCabinet) await p.route('**/messages/attente**', async (r) => { await new Promise((ok) => setTimeout(ok, 2_500)); await r.continue(); });
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a-1`);
      await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
      await plusTard(p);
      return p;
    };
    const compta = (p: Page) => p.locator('#lp-compta').innerText().then(net).catch(() => '');
    const etape = (p: Page) => p.locator('#ed-fr-cabinet').innerText().then(net).catch(() => '');

    // 1. Au brouillard : le résumé le dit, la frise aussi (« vue », plus « attend le justificatif ») — même le cabinet appris tard.
    const p = await ouvrir(true);
    await expect.poll(() => compta(p), { timeout: 15_000 }).toMatch(/^Comptabilité Au journal des achats, au brouillard : (ton cabinet la validera|pas encore validée)\. · voir l'écriture$/);
    await expect.poll(() => etape(p), { timeout: 15_000 }).toBe('vue, pas encore validée');
    expect(await p.locator('#ed-fr-cab').getAttribute('class')).not.toMatch(/\bfait\b/);

    // 2. « voir l'écriture » ouvre la MÊME fenêtre que celle d'une vente, au journal des achats : 2 400 HT + 19 % (456) + 1 DT de
    // frais = 2 857,000 au crédit du fournisseur, et la pièce tombe juste.
    await p.locator('#lp-ecriture').click();
    const fen = p.locator('.modal').last();
    await fen.waitFor({ timeout: 10_000 });
    expect(net(await fen.locator('h2').innerText())).toBe('L\'écriture de PK-2611-07');
    expect(net(await fen.locator('p.small').first().innerText())).toBe(`Journal des achats · ${fr} · au brouillard`);
    const lignes = await fen.locator('table.ecr tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    expect(lignes.filter((l) => l[0] === 'AC').length).toBeGreaterThanOrEqual(3);
    expect(lignes.find((l) => l[2] === '4366')?.[4]).toBe('456,000');
    expect(lignes.find((l) => l[2] === '401')?.[5]).toBe('2 857,000');
    expect(lignes.at(-1)?.slice(-3)).toEqual(['Total · équilibrée', '2 857,000', '2 857,000']);
    await fen.getByRole('button', { name: 'Fermer', exact: true }).click();

    // 3. Leila valide l'écriture au Cabinet : la page relue le dit, avec son numéro, et l'étape de la frise se coche.
    const ecr = (await lireAchat())[0];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: [ecr?.id] })).statut).toBe(200);
    const numero = String((await lireAchat())[0]?.numero);
    await p.reload();
    await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
    await expect.poll(() => compta(p), { timeout: 15_000 }).toMatch(new RegExp(`^Comptabilité Validée( par ton cabinet)? le ${fr.replace(/\//g, '\\/')}, écriture n° ${numero}\\. · voir l'écriture$`));
    await expect.poll(() => etape(p), { timeout: 15_000 }).toBe(`validée le ${fr.slice(0, 5)}`);
    expect(await p.locator('#ed-fr-cab').getAttribute('class')).toMatch(/\bfait\b/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achat-resume-1358-1-validee.png') });

    // 4. L'affaire : toujours sa ligne, et son geste. Sans affaire, la bulle ne s'arrête pas sur « Aucune » : elle crée la
    // première, avec le nom qu'on vient de taper ; la pièce s'enregistre avec, et la ligne le dit.
    const affaire = () => p.locator('#lp-affaire').innerText().then(net);
    expect(await affaire()).toBe('Affaire Aucune · Ranger dans une affaire');
    await p.locator('#lp-aff-b').click();
    const bulle = p.locator('.ed-pop[aria-label="Affaire"]');
    await bulle.waitFor({ timeout: 10_000 });
    expect(net(await bulle.locator('.pop-vide').innerText())).toBe('Aucune affaire pour l\'instant : crée la première ci-dessous.');
    await bulle.locator('#pop-aff-q').fill('Rénovation boutique');
    await bulle.locator('#pop-aff-nv').click();
    const nom = p.locator('.modal').last().locator('input[name=name]');
    await nom.waitFor({ timeout: 10_000 });
    expect(await nom.inputValue()).toBe('Rénovation boutique');
    await p.locator('.modal').last().getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(affaire, { timeout: 10_000 }).toBe('Affaire Rénovation boutique · Changer');
    const projet = await p.evaluate(() => ((window as unknown as { __data: Obj }).__data.projects || []).find((x: Obj) => x.name === 'Rénovation boutique')?.id);
    expect(projet).toBeTruthy();
    await expect.poll(async () => (await surLeServeur('purchases', 'a-1'))?.projectId, { timeout: 15_000 }).toBe(projet);
    // « Changer » : l'affaire est cochée, et « Aucune affaire » la retire — la pièce aussi, sur le serveur.
    await p.locator('#lp-aff-b').click();
    await bulle.waitFor({ timeout: 10_000 });
    expect(await bulle.locator('.pop-o.on').innerText().then(net)).toBe('Rénovation boutique en cours');
    await bulle.locator('[data-pr=""]').click();
    await expect.poll(affaire, { timeout: 10_000 }).toBe('Affaire Aucune · Ranger dans une affaire');
    await expect.poll(async () => (await surLeServeur('purchases', 'a-1'))?.projectId || '', { timeout: 15_000 }).toBe('');
    // Ranger ne touche ni un montant ni l'écriture : elle reste celle que Leila a validée.
    expect((await lireAchat())[0]?.statut).toBe('validee');

    // 5. Au téléphone : les lignes en liste (la désignation, son montant, ce qui le fait), le tableau caché ; à l'ordinateur, le
    // tableau, et pas la liste.
    expect(await p.locator('#ac-tel-l').isVisible()).toBe(false);
    expect(await p.locator('#view table.buy-lines').isVisible()).toBe(true);
    const tel = await contexte(sarra, 390, 844);
    await tel.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const t = await tel.newPage();
    t.on('pageerror', (x) => erreurs.push(x.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a-1`);
    await t.locator('#lecture-piece').waitFor({ timeout: 20_000 });
    await plusTard(t);
    await t.locator('#ac-tel-l').scrollIntoViewIfNeeded();
    expect(await t.locator('#ac-tel-l').isVisible()).toBe(true);
    expect(await t.locator('#view table.buy-lines').isVisible()).toBe(false);
    expect(net(await t.locator('#ac-tel-l .t-l').first().innerText())).toBe('Peinture de la boutique 2 400,000 1 × 2 400,000 · TVA 19 %');
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await t.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'achat-resume-1358-2-telephone.png') });
    await tel.close();

    expect(erreurs).toEqual([]);
  }, 180_000);
});
