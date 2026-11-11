// Bout en bout 9 (1.356.6) : la boulangerie a facturé l'Hôtel Les Palmiers SA (retenue 1 %) 1 200 croissants et 150 pains de
// mie (1 260 HT, 1 499,400 TTC hors timbre : au-dessus du seuil de 1 000 DT, la retenue s'applique, 14,994 DT). 200 croissants
// n'ont pas été livrés : un avoir partiel de 154,700 TTC. Le seuil (règle `retenue.seuil`) se juge sur la FACTURE : l'avoir
// reprend sa part de retenue (1,547), à l'écran comme au serveur — avant, il tombait « sous le seuil » et ne reprenait rien,
// et l'émission tombait sur le désaccord. Une facture sous le seuil n'en portait pas : son avoir non plus, et « Avant
// d'émettre » le dit sans parler d'un paiement groupé (un avoir ne se règle pas).
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'avoir-1356.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('bout en bout 1.356.6 : l\'avoir partiel sur une facture qui porte sa retenue', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-avoir-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'avoir-1356.txt'), '');
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

  it('l\'avoir suit la retenue de sa facture, à l\'écran et au serveur', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const hotel = { id: 'c-hotel', name: 'Hôtel Les Palmiers SA', matricule: '1472583B/A/M/000', city: 'Hammamet', withholdingRate: 1 };
    const n = (x: string) => ({ '~n': x });
    // La grande facture (au-dessus du seuil) et une petite (dessous), en brouillon : elles s'émettent à l'écran.
    const facture = (id: string, lignes: Obj[]) => ({ id, type: 'facture', date: auj, dueDate: jourDe(30), clientId: 'c-hotel', subject: 'Viennoiseries livrées',
      status: 'brouillon', lines: lignes, discountRate: 0, applyStamp: true, withholdingRate: 1, currency: 'DT', exchangeRate: '', payments: [], regimeTva: 'reel' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hotel', rang: 0, revision: null, contenu: hotel },
      { collection: 'documents', cle: 'f-grande', rang: 0, revision: null, contenu: facture('f-grande', [
        { label: 'Croissants au beurre', description: '', qty: 1200, unit: '', unitPrice: n('0.65'), vatRate: 19 },
        { label: 'Pain de mie tranché', description: '', qty: 150, unit: '', unitPrice: n('3.2'), vatRate: 19 }]) },
      { collection: 'documents', cle: 'f-petite', rang: 1, revision: null, contenu: facture('f-petite', [
        { label: 'Croissants au beurre', description: '', qty: 100, unit: '', unitPrice: n('0.65'), vatRate: 19 }]) },
    ] })).statut).toBe(200);
    // Le seuil de la retenue (1 000 DT, en millimes), règle de cette seule entreprise : l'écran le lit, le serveur l'applique.
    const proprio = String((await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [ent])).rows[0].utilisateur);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'retenue.seuil', '1000000', '2000-01-01', 'Seuil de l''essai', $2)`, [ent, proprio]);

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const emettre = async () => {
      await p.locator('#ed-geste #issue').click();
      await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
      await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
      await p.locator('#modal-root #ok').click();
      await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 20_000 }).toMatch(/^(FAC|AVO)-/);
      return net(await p.locator('#view h1').first().innerText()).split(' ')[0] ?? '';
    };
    const totaux = async () => net(await p.locator('#totals').innerText().catch(() => ''));
    // 1. La grande facture s'émet avec sa retenue : 1 499,400 TTC, 14,994 retenus.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f-grande`);
    await p.locator('#ed-geste #issue').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(totaux, { timeout: 10_000 }).toContain('Retenue à la source 1 % −14,994');
    const numGrande = await emettre();
    // L'hôtel la règle en entier : 1 485,406 DT par virement (il garde ses 14,994 de retenue).
    await p.locator('#ed-geste #pay').click();
    const fen = () => p.locator('#modal-root .modal').last();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    await expect.poll(async () => net(await fen().locator('[name=amount]').inputValue())).toBe('1 485,406');
    await fen().locator('#ok').click();
    await expect.poll(() => fen().count(), { timeout: 10_000 }).toBe(0);
    // 2. L'avoir partiel : 200 croissants non livrés. Il reprend sa part de retenue (1 % de 154,700 : 1,547), et le serveur
    //    l'émet (avant : « sous le seuil », aucune retenue, et l'émission tombait sur un net différent du serveur).
    await p.evaluate(() => { location.hash = '#/doc/new/avoir/f-grande'; });
    const qte = p.locator('#lines tr[data-i="0"] input[data-k=qty]');
    await qte.waitFor({ timeout: 20_000 });
    await qte.fill('200');
    await qte.press('Tab');
    await p.locator('#lines tr').nth(1).locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /^Supprimer la ligne/ }).click();
    await expect.poll(totaux, { timeout: 10_000 }).toContain('Total TTC 154,700 Retenue à la source 1 % −1,547');
    expect(net(await p.locator('#ed-puces [data-etq="rs"]').innerText())).toBe('Retenue 1 % · du client');
    await p.screenshot({ path: path.join(PHOTOS, 'avoir-1356-1-avoir.png') });
    const numAvoir = await emettre();
    expect(numAvoir).toMatch(/^AVO-/);
    await expect.poll(totaux).toContain('153,153');
    noter('grande', numGrande, numAvoir);
    // Le trop-perçu se rend d'un geste ; la fiche de l'hôtel compte à part ce qu'il a versé et ce qu'on lui a rendu (avant :
    // « 2 paiements · 1 332,253 DT reçus », le remboursement retranché comme s'il n'y avait rien eu à rendre).
    await p.locator('#rembourser-avoir').first().click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    await expect.poll(async () => net(await fen().locator('[name=amount]').inputValue())).toBe('153,153');
    await fen().locator('#ok').click();
    await expect.poll(() => fen().count(), { timeout: 10_000 }).toBe(0);
    await p.evaluate(() => { location.hash = '#/client/c-hotel'; });
    await p.locator('#view .cf-onglets [data-onglet="paiements"]').click();
    await expect.poll(async () => net(await p.locator('#cf-onglet').innerText().catch(() => ''))).toMatch(/^1 paiement · 1 485,406 DT reçus · 1 remboursement · 153,153 DT rendus /);
    // 3. La petite facture (77,350 TTC) est sous le seuil : pas de retenue, et son avoir non plus — « Avant d'émettre » le dit
    //    sans promettre de paiement groupé (un avoir ne se règle pas).
    await p.evaluate(() => { location.hash = '#/doc/f-petite'; });
    await p.locator('#ed-geste #issue').waitFor({ timeout: 20_000 });
    await expect.poll(totaux, { timeout: 10_000 }).not.toContain('Retenue à la source');
    await emettre();
    await p.evaluate(() => { location.hash = '#/doc/new/avoir/f-petite'; });
    await p.locator('#ed-avant').waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#ed-avant').innerText().catch(() => ''))).toContain('pas de retenue sur l\'avoir, comme sur sa facture');
    expect(net(await p.locator('#ed-avant').innerText())).not.toContain('paiement groupé');
    expect(await totaux()).not.toContain('Retenue à la source');
    await p.screenshot({ path: path.join(PHOTOS, 'avoir-1356-2-petite.png') });
    noter('fin', { erreurs });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
