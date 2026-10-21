// « PDF » d'une pièce, à l'écran (docs/pdf.md). Dans un navigateur, la v10 ouvrait la fenêtre d'impression ; la
// plateforme fait le PDF sur le serveur, et il se télécharge sous le nom de la pièce, sans aucune fenêtre. Un serveur
// sans Chromium le dit, et la fenêtre d'impression revient, comme avant.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await sansChromium?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  // Nadia, son entreprise, un client et un devis d'une ligne (3 × 416,667 à 19 %), ouvert sur le serveur donné.
  async function devisOuvert(adresse: string) {
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
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, nadia);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/v10/?e=${ent}#/doc/d1`);
    await p.locator('#pdf').waitFor({ timeout: 20_000 });
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

  it('un serveur sans Chromium : la fenêtre d\'impression du navigateur revient, comme avant', async () => {
    const { cx, p, erreurs } = await devisOuvert(sansChromium.adresse);
    const [fenetre] = await Promise.all([p.waitForEvent('popup', { timeout: 30_000 }), cliquerPdf(p)]);
    await expect.poll(() => fenetre.locator('body').innerText().catch(() => '')).toContain('Cartons et palettes');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
