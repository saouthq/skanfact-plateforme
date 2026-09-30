// L'encours autorisé d'un client, à la souris (brique 91 ; 14 § 3.2 : « au-delà, SkanFact avertit » ;
// web/v10/commandes-fournisseurs.txt). Ce que le parcours vérifie :
//   - le plafond se saisit sur la fiche du client, et sa page dit l'encours face au plafond ;
//   - émettre une facture qui le ferait dépasser le dit AVANT, dans la fenêtre d'émission, avec ses chiffres ;
//   - la personne décide : « Émettre quand même » émet, par le serveur ; la page du client dit « dépassé ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'encours autorisé d\'un client, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-encours-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  it('Nadia plafonne l\'encours de son client, puis émet quand même la facture qui le dépasse, prévenue avant', async () => {
    const email = `nadia-encours-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Un bon livré, pas facturé : 40 sacs à 16,800 = 672 HT, 799,680 TTC. Une facture en brouillon : 12 sacs à 25 = 300 HT.
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', matricule: '1234567A/A/M/000', address: 'Ennasr 2, Ariana' } },
      { collection: 'documents', cle: 'bl1', rang: 0, revision: null, contenu: { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 40, unit: 'sac', unitPrice: { '~n': '16.8' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] } },
      { collection: 'documents', cle: 'f1', rang: 1, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 12, unit: 'sac', unitPrice: 25, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // 1. Le plafond, sur la fiche du client : 1 000 DT.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c1`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Chantier Ennasr/);
    await plusTard(p);
    expect(await p.locator('#cl-encours').count()).toBe(0);
    await p.locator('#view .page-head').getByRole('button', { name: 'Actions' }).click();
    await p.getByText('Modifier la fiche', { exact: true }).click();
    await p.locator('#cf input[name=creditLimit]').fill('1000');
    await p.locator('#modal-root .btn-primary').last().click();
    await expect.poll(async () => net(await p.locator('#cl-encours').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Encours i : 799,680 DT sur 1 000,000 DT autorisés, dont 799,680 DT livrés à facturer.');

    // 2. La facture de 300 HT le ferait dépasser : la fenêtre d'émission le dit, avec ses chiffres.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Facture/);
    await p.locator('#issue').click();
    await expect.poll(async () => net(await p.locator('#modal-root .warn-box').innerText().catch(() => '')), { timeout: 10_000 })
      .toMatch(/Chantier Ennasr dépasserait son encours autorisé de 157,680 DT : il doit déjà 799,680 DT \(factures non réglées et bons livrés à facturer\), cette pièce en ajoute 358,000 DT, pour 1 000,000 DT autorisés\. Fais-le régler avant, ou émets quand même\./);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'encours-1-avertissement.png') });

    // 3. Nadia décide d'émettre quand même : le serveur émet ; la page du client dit « dépassé ».
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await p.evaluate(() => { location.hash = '#/client/c1'; });
    await expect.poll(async () => net(await p.locator('#cl-encours').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Encours i : 1 157,680 DT sur 1 000,000 DT autorisés, dont 799,680 DT livrés à facturer : dépassé de 157,680 DT.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'encours-2-client.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
