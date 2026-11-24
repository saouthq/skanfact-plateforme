// 1.388.42 (audit #30, FISC-1) : un produit fabriqué porte la FODEC sur le devis, et la facture tirée du devis la garde.
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
describe('1.388.42 (FISC-1) : la FODEC d\'un produit fabriqué suit le devis jusqu\'à la facture', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fodec-devis-1388-'));
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });


  it('Hédi chiffre dix poutrelles : le devis porte la FODEC, la facture tirée du devis la garde, comme une facture directe', async () => {
    const hedi = await personne('hedi');
    const ent = String((await api('POST', `/entreprises-essai`, hedi)).corps.id);
    expect((await api('POST', `/entreprises/${ent}/regles`, hedi, { code: 'fodec.taux', valeur: 10000, debut: '2026-01-01', motif: 'Essai' })).statut).toBe(201);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Ferchichi', name: 'Atelier Métal Sfax', city: 'Sfax', fodec: true, paymentTermsDays: 30 };
    const ligne = { itemId: 'a-poutre', label: 'Poutrelle acier fabriquée', description: '', qty: 10, unit: 'u', unitPrice: 250, vatRate: 19, fodec: true };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-alpha', rang: 0, revision: null, contenu: { id: 'c-alpha', name: 'Société Alpha', city: 'Sfax' } },
      { collection: 'catalog', cle: 'a-poutre', rang: 0, revision: null, contenu: { id: 'a-poutre', label: 'Poutrelle acier fabriquée', unit: 'u', unitPrice: 250, vatRate: 19, fodec: true } },
      { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: { id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'envoyé', date: jourDe(-2), clientId: 'c-alpha',
        subject: 'Poutrelles du hangar', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [], lines: [ligne] } },
    ] })).statut).toBe(200);

    const cx = await contexte(hedi);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const totaux = async () => net(await p.locator('#totals').innerText().catch(() => ''));
    const caseFodec = () => p.locator('#lines tr[data-i] [data-fodec]').first();

    // 1. Le devis : la colonne FODEC, la case cochée, et le total qui la compte (2 500 + 25 de FODEC + 19 % de 2 525).
    await aller('#/doc/dv1');
    await expect.poll(async () => caseFodec().count(), { timeout: 15_000 }).toBe(1);
    expect(await caseFodec().isChecked()).toBe(true);
    await expect.poll(totaux, { timeout: 10_000 }).toContain('FODEC 1 %');
    expect(await totaux()).toContain('25,000');
    expect(await totaux()).toContain('479,750');
    await p.screenshot({ path: path.join(PHOTOS, 'fodec-devis-1388-devis.png'), fullPage: true });

    // 2. Facturé : la facture garde la ligne FODEC, et le même total qu'une facture directe (3 004,750 + 1 de timbre).
    if (await p.locator('#bill-btn').isVisible()) await p.locator('#bill-btn').click();
    await p.locator('#convert:visible').first().click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toBe('Nouvelle facture');
    await expect.poll(async () => caseFodec().count(), { timeout: 15_000 }).toBe(1);
    expect(await caseFodec().isChecked()).toBe(true);
    await expect.poll(totaux, { timeout: 10_000 }).toContain('25,000');
    expect(await totaux()).toContain('3 005,750');
    await p.screenshot({ path: path.join(PHOTOS, 'fodec-devis-1388-facture.png'), fullPage: true });

    // 3. (FISC-2) Émise, la facture est vue par la comptabilité : la FODEC se dit dans « Ventes » (carte, tableau par taux avec
    // sa base imposable, colonne du journal) et dans « TVA à payer », parmi ce qui se déclare aussi.
    await p.locator('#save').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe('Brouillon enregistré');
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await objets()).find((o) => o.collection === 'documents' && o.contenu.type === 'facture')?.contenu.number) ?? '', { timeout: 20_000 }).toMatch(/^FAC-/);
    await aller('#/compta');
    await p.locator('#c-tabs [data-tab="ventes"]').click();
    const corps = async () => net(await p.locator('#c-body').innerText().catch(() => ''));
    await expect.poll(corps, { timeout: 15_000 }).toContain('FODEC collectée : 25,000 DT (dans la base de la TVA)');
    const ligne19 = net(await p.locator('#c-body tr', { hasText: 'TVA 19 %' }).first().innerText());
    expect(ligne19).toBe('TVA 19 % 2 500,000 DT 25,000 DT 2 525,000 DT 479,750 DT');
    expect(await p.locator('#c-body th', { hasText: 'FODEC' }).count()).toBeGreaterThanOrEqual(2);
    await p.screenshot({ path: path.join(PHOTOS, 'fodec-devis-1388-ventes.png'), fullPage: true });
    await p.locator('#c-tabs [data-tab="tva"]').click();
    await expect.poll(async () => net(await p.locator('#vat-autres').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Se déclarent aussi : timbres des factures de la période 1,000 DT · FODEC collectée 25,000 DT · retenues que tu as opérées 0,000 DT, à reverser. Les retenues subies (0,000 DT) ne se versent pas : elles s\'imputent sur ton impôt, avec leurs attestations. À VÉRIFIER avec ton comptable.');
    await p.screenshot({ path: path.join(PHOTOS, 'fodec-devis-1388-tva.png'), fullPage: true });

    expect(erreurs).toEqual([]);
  }, 180_000);
});
