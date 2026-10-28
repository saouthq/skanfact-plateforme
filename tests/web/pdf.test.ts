// « PDF » d'une pièce, à l'écran (docs/pdf.md). Dans un navigateur, la v10 ouvrait la fenêtre d'impression ; la
// plateforme fait le PDF sur le serveur, et il se télécharge sous le nom de la pièce, sans aucune fenêtre. Un serveur
// sans Chromium le dit, et la fenêtre d'impression revient, comme avant.

import { execFileSync } from 'node:child_process';
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

describe('« PDF » d\'une pièce, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let sansChromium: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pdf-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    const base = { SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' };
    serveur = await demarrer({ ...lireConfiguration(base), port: 0, web: dossier, livreurMs: 60_000 });
    sansChromium = await demarrer({ ...lireConfiguration({ ...base, SKANFACT_NAVIGATEUR: '/chemin/sans/chromium' }), port: 0, web: dossier, livreurMs: 60_000 });
    // Un nom de fichier accentué : Chromium le garde si sa langue est en UTF-8 (sans LANG, il le remplace par « download »).
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
    // Une facture ne s'émet pas sans le timbre de son jour : la règle des tests, si la base ne l'a pas encore.
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await admin.end();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await sansChromium?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  // Nadia, son entreprise, un client et un devis d'une ligne (3 × 416,667 à 19 %), ouvert sur le serveur donné.
  type Api = (methode: string, chemin: string, jeton?: string, corps?: unknown) => Promise<{ statut: number; corps: Record<string, unknown> }>;
  async function devisOuvert(adresse: string, avant?: (api: Api, jeton: string, ent: string) => Promise<void>, ecran = '#/doc/d1') {
    const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
      const r = await fetch(`${adresse}/v1${chemin}`, { method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000) });
      const t = await r.text();
      return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
    };
    const email = `nadia-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Transports Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Société des Transports du Sahel' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', status: 'brouillon', date: '2026-10-21', clientId: 'c1',
        lines: [{ id: 'l1', label: 'Cartons et palettes', qty: 3, unitPrice: { '~n': '416.667' }, vatRate: 19 }] } },
    ] })).statut).toBe(200);
    if (avant) await avant(api, nadia, ent);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, nadia);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/v10/?e=${ent}${ecran}`);
    await p.locator(ecran === '#/doc/d1' ? '#pdf' : '#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    return { cx, p, erreurs };
  }
  // « PDF » ; la fiche société incomplète demande d'abord (le premier envoi) : on exporte quand même.
  const cliquerPdf = async (p: Page) => {
    await p.locator('#pdf').click();
    const quandMeme = p.getByRole('button', { name: 'Exporter quand même' });
    await quandMeme.waitFor({ timeout: 5_000 }).then(() => quandMeme.click()).catch(() => undefined);
  };

  it('le PDF se télécharge sous le nom de la pièce, sans fenêtre d\'impression', async () => {
    const { cx, p, erreurs } = await devisOuvert(serveur.adresse);
    let fenetres = 0;
    p.on('popup', () => { fenetres++; });
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 30_000 }), cliquerPdf(p)]);
    const nom = telechargement.suggestedFilename();
    expect(nom).toMatch(/_Société_des_Transports_du_Sahel\.pdf$/);
    const fichier = path.join(dossier, 'telecharge.pdf');
    await telechargement.saveAs(fichier);
    expect(fs.readFileSync(fichier).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain(`PDF enregistré : ${nom}`);
    expect(fenetres).toBe(0);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  // (1.94.0, parcours du 21/10/2026) Ce test ouvre déjà un devis : il porte aussi les menus « ▾ » au clavier.
  it('au clavier, un menu « ▾ » d\'un devis : le curseur dans la liste, les flèches, Échap rend le curseur au bouton', async () => {
    const { cx, p, erreurs } = await devisOuvert(serveur.adresse);
    const bouton = p.locator('#view .more > .btn').first();
    await expect.poll(() => bouton.getAttribute('aria-expanded')).toBe('false');
    // Il ouvre le menu de la charte, qui naît à l'ouverture : il le dit (« aria-haspopup »), sans viser la liste cachée.
    expect(await bouton.getAttribute('aria-haspopup')).toBe('menu');
    await bouton.focus();
    await p.keyboard.press('Enter');
    await expect.poll(() => bouton.getAttribute('aria-expanded')).toBe('true');
    // (lot 4, maquette facture) « ⋯ » ouvre le menu de la charte (rowmenu.js), fait des gestes de la liste cachée : le
    // curseur va à sa première entrée.
    const entrees = '.row-menu:not([hidden]) [role="menuitem"]:not([disabled])';
    const dedans = () => p.evaluate((sel) => { const xs = [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length); return xs.indexOf(document.activeElement as Element); }, entrees);
    await expect.poll(dedans).toBe(0);
    const n = await p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length).length, entrees);
    expect(n).toBeGreaterThan(1);
    await p.keyboard.press('ArrowDown');
    expect(await dedans()).toBe(1);
    await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
    expect(await dedans()).toBe(n - 1);
    await p.keyboard.press('Home');
    expect(await dedans()).toBe(0);
    await p.keyboard.press('Escape');
    await expect.poll(() => bouton.getAttribute('aria-expanded')).toBe('false');
    expect(await bouton.evaluate((b) => document.activeElement === b)).toBe(true);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('« Exporter tous les PDF de la période » : un .zip des PDF du serveur, un par facture émise, sous leur nom', async () => {
    // Deux factures émises ce mois (3 × 416,667 à 19 %, timbre compris : 1 488,501 DT).
    const emettre = async (api: Api, jeton: string, ent: string) => {
      for (const id of ['f1', 'f2']) {
        const brouillon = { id, type: 'facture', status: 'brouillon', date: new Date().toISOString().slice(0, 10), clientId: 'c1',
          lines: [{ id: 'l1', label: 'Cartons et palettes', qty: 3, unitPrice: { '~n': '416.667' }, vatRate: 19 }] };
        const r = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: brouillon, client: { id: 'c1', name: 'Société des Transports du Sahel' }, revision: null, rang: null, netAPayer: '1488.501' });
        expect(r.statut, JSON.stringify(r.corps)).toBe(200);
      }
    };
    const { cx, p, erreurs } = await devisOuvert(serveur.adresse, emettre, '#/compta');
    await p.locator('#exp-pdfs').waitFor({ timeout: 20_000 });
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), p.locator('#exp-pdfs').click()]);
    const nom = telechargement.suggestedFilename();
    expect(nom).toMatch(/^SkanFact-.+\.zip$/);
    const fichier = path.join(dossier, 'lot.zip');
    await telechargement.saveAs(fichier);
    const zip = fs.readFileSync(fichier);
    // (1.94.0) Les noms se lisent dans le zip lui-même (son répertoire central), en UTF-8, le drapeau qui le dit posé :
    // « unzip -Z1 » les décodait selon la machine (sur celle de GitHub, « Soci├йt├й »). Chaque fichier est un PDF ;
    // l'outil du système vérifie le tout (« unzip -tq »).
    const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(fin).toBeGreaterThan(0);
    const entrees: { nom: string; utf8: boolean; contenu: Buffer }[] = [];
    for (let i = 0, o = zip.readUInt32LE(fin + 16); i < zip.readUInt16LE(fin + 10); i++) {
      expect(zip.readUInt32LE(o)).toBe(0x02014b50);
      const [drapeaux, taille, n, e, c, local] = [zip.readUInt16LE(o + 8), zip.readUInt32LE(o + 20), zip.readUInt16LE(o + 28), zip.readUInt16LE(o + 30), zip.readUInt16LE(o + 32), zip.readUInt32LE(o + 42)];
      const debut = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      entrees.push({ nom: zip.subarray(o + 46, o + 46 + n).toString('utf8'), utf8: (drapeaux & 0x0800) !== 0, contenu: zip.subarray(debut, debut + taille) });
      o += 46 + n + e + c;
    }
    expect(entrees).toHaveLength(2);
    for (const x of entrees) {
      expect(x.nom).toMatch(/_Société_des_Transports_du_Sahel\.pdf$/);
      expect(x.utf8).toBe(true);
      expect(x.contenu.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
    execFileSync('unzip', ['-tq', fichier]);
    expect(zip.length).toBeGreaterThan(2000);
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toBe(`2 PDF exportés dans ${nom}`);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  // (1.94.0) « Envoyer au comptable… » sans cabinet : le geste principal ; la fenêtre dit que le CSV se télécharge, au
  // singulier pour une facture.
  it('« Envoyer au comptable… » : le journal se télécharge, à joindre soi-même ; « 1 document »', async () => {
    const emettre = async (api: Api, jeton: string, ent: string) => {
      const brouillon = { id: 'f1', type: 'facture', status: 'brouillon', date: new Date().toISOString().slice(0, 10), clientId: 'c1',
        lines: [{ id: 'l1', label: 'Cartons et palettes', qty: 3, unitPrice: { '~n': '416.667' }, vatRate: 19 }] };
      const r = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: brouillon, client: { id: 'c1', name: 'Société des Transports du Sahel' }, revision: null, rang: null, netAPayer: '1488.501' });
      expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    };
    const { cx, p, erreurs } = await devisOuvert(serveur.adresse, emettre, '#/compta');
    await p.locator('#exp-comptable').waitFor({ timeout: 20_000 });
    expect(await p.locator('#exp-comptable').getAttribute('class')).toContain('btn-primary');
    expect(await p.locator('#exp-cabinet-lit').count()).toBe(0);
    await p.locator('#exp-comptable').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('textarea[name=body]').inputValue()).toMatch(/: 1 document, /);
    expect(await fenetre.innerText()).toMatch(/se télécharge en CSV\s:\sjoins-le au message/);
    expect(await fenetre.innerText()).not.toMatch(/est joint en CSV/);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('un serveur sans Chromium : la fenêtre d\'impression du navigateur revient, comme avant', async () => {
    const { cx, p, erreurs } = await devisOuvert(sansChromium.adresse);
    const [fenetre] = await Promise.all([p.waitForEvent('popup', { timeout: 30_000 }), cliquerPdf(p)]);
    await expect.poll(() => fenetre.locator('body').innerText().catch(() => '')).toContain('Cartons et palettes');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
