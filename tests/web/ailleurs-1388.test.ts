// 1.388.46 (audit #30, ROB-3) : un poste resté ouvert dit ce qu'un autre poste a fait depuis son ouverture, et se met à jour.
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
describe('1.388.46 (ROB-3) : un poste resté ouvert voit ce que l\'autre a fait', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ailleurs-1388-'));
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


  it('Rania garde Factures ouvert : la facture faite ailleurs se dit, « Mettre à jour » la montre ; ce que le poste fait lui-même ne se dit pas', async () => {
    const rania = await personne('rania');
    const ent = String((await api('POST', `/entreprises-essai`, rania)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, rania)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Rania Bouslama', name: 'Atelier Robusta Deux', city: 'Tunis', paymentTermsDays: 30 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, rania, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-ph', rang: 0, revision: null, contenu: { id: 'c-ph', name: 'Pharmacie Ennasr', city: 'Ariana' } },
    ] })).statut).toBe(200);

    const cx = await contexte(rania);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    // Le retour sur l'onglet relit (comme les deux minutes) : on le provoque.
    const revenir = () => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    // 1. Ce que ce poste fait lui-même (un client créé ici) ne se dit pas.
    await p.evaluate(() => { const w = window as unknown as { __data: Obj; __enregistrerMaintenant?: () => void }; (w.__data.clients as Obj[]).push({ id: 'c-ici', name: 'Client du poste' }); w.__enregistrerMaintenant?.(); });
    await expect.poll(async () => (await objets()).some((o) => o.collection === 'clients' && o.cle === 'c-ici'), { timeout: 15_000 }).toBe(true);
    await p.waitForTimeout(1500);
    await revenir();
    await p.waitForTimeout(3000);
    expect(await p.locator('#maj-ailleurs').count()).toBe(0);

    // 2. Un autre poste (la même personne, une autre session) écrit un brouillon de facture : ce poste le dit.
    const lu = (await objets());
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, rania, { changements: [
      { collection: 'documents', cle: 'f-ailleurs', rang: lu.filter((o) => o.collection === 'documents').length, revision: null, contenu: { id: 'f-ailleurs', type: 'facture', status: 'brouillon', date: jourDe(0), clientId: 'c-ph',
        subject: 'Faite sur le poste 2', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [], lines: [{ label: 'Article', description: '', qty: 2, unit: 'u', unitPrice: 50, vatRate: 19 }] } },
    ] })).statut).toBe(200);
    expect(await p.locator('#view').innerText()).not.toContain('Faite sur le poste 2');
    await revenir();
    await expect.poll(async () => net(await p.locator('#maj-ailleurs').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('1 pièce faite ou changée sur un autre poste depuis ton ouverture. Cette page ne le montre pas encore : ses listes et ses totaux datent de ton ouverture. Mettre à jour');
    await p.screenshot({ path: path.join(PHOTOS, 'ailleurs-1388.png'), fullPage: true });

    // 3. « Mettre à jour » : la facture faite ailleurs est là.
    await p.locator('#maj-ailleurs-ok').click();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(async () => p.evaluate(() => ((window as unknown as { __data: Obj }).__data.documents as Obj[]).some((d) => d.id === 'f-ailleurs')), { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#maj-ailleurs').count()).toBe(0);

    // 4. Une facture émise sur CE poste (le serveur écrit son numéro) ne se dit pas comme faite ailleurs.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f-ailleurs`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await objets()).find((o) => o.collection === 'documents' && o.cle === 'f-ailleurs')?.contenu.number) ?? '', { timeout: 20_000 }).toMatch(/^FAC-/);
    await p.waitForTimeout(2000);
    await revenir();
    await p.waitForTimeout(3000);
    expect(await p.locator('#maj-ailleurs').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
