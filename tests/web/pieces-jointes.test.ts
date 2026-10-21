// Les pièces jointes, à la souris (docs/pieces-jointes.md). Dans la v10 d'un navigateur, « Joindre un fichier » disait
// « pas encore dans la version en ligne ». Maintenant : le fichier choisi se joint au devis, s'ouvre dans un onglet, se
// télécharge, reste là après un rechargement (le serveur le garde), et se retire ; un fichier qui n'est ni une photo
// ni un PDF se refuse en disant pourquoi.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('les pièces jointes d\'un devis, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier_ = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pj-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier_, emptyOutDir: true } });
    const base = { SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' };
    serveur = await demarrer({ ...lireConfiguration(base), port: 0, web: dossier_, livreurMs: 60_000 });
    // Un nom de fichier accentué : Chromium le garde si sa langue est en UTF-8 (sans LANG, il le remplace par « download »).
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier_, { recursive: true, force: true }); });

  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  // Nadia, son entreprise, un client et un devis d'une ligne (3 × 416,667 à 19 %), ouvert sur le serveur donné.
  async function devisOuvert(adresse: string) {
    const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
      const r = await fetch(`${adresse}/v1${chemin}`, { method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000) });
      const t = await r.text();
      return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
    };
    const email = `nadia-pj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
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
    return { cx, p, erreurs, ent, nadia, api };
  }
  // Un PDF qui discrimine : son texte se relit dans l'onglet ouvert et dans le fichier téléchargé.
  const PDF = Buffer.from('%PDF-1.4\n% Devis signe DEV-2026-031\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const joindre = async (p: Page, fichiers: { name: string; mimeType: string; buffer: Buffer }[]) => {
    const [choix] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#add-att').click()]);
    await choix.setFiles(fichiers);
  };

  it('joint, ouvert, téléchargé, gardé après un rechargement, puis retiré', async () => {
    const { cx, p, erreurs, ent, nadia, api } = await devisOuvert(serveur.adresse);
    // Deux fichiers d'un coup : le devis signé et la photo du chantier.
    await joindre(p, [{ name: 'Devis signé DEV-2026-031.pdf', mimeType: 'application/pdf', buffer: PDF }, { name: 'Chantier.png', mimeType: 'image/png', buffer: PNG }]);
    const ligne = p.locator('#attachments tr', { hasText: 'Devis signé DEV-2026-031.pdf' });
    await ligne.waitFor({ timeout: 15_000 });
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain('2 pièces jointes ajoutées');
    // La pièce garde la fiche sur le serveur, et le fichier y est.
    const dossier = await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    const devis = (dossier.corps.objets as { cle: string; contenu: { attachments?: { name: string; file: string }[] } }[]).find((o) => o.cle === 'd1');
    const fiche = devis?.contenu.attachments?.[0];
    expect(fiche?.name).toBe('Devis signé DEV-2026-031.pdf');
    const lu = await api('GET', `/entreprises/${ent}/pieces-jointes/${String(fiche?.file)}`, nadia);
    expect(Buffer.from(String(lu.corps.contenu), 'base64').equals(PDF)).toBe(true);

    // Ouvrir : un onglet, avec le fichier (la photo : un Chromium sans écran télécharge un PDF au lieu de le montrer).
    const [onglet] = await Promise.all([p.waitForEvent('popup'), p.locator('#attachments tr', { hasText: 'Chantier.png' }).locator('[data-open]').click()]);
    await expect.poll(() => onglet.url()).toMatch(/^blob:/);
    await onglet.close();
    // « Télécharger le fichier », depuis le menu de sa ligne.
    await ligne.getByRole('button', { name: /Actions/ }).click();
    const [telechargement] = await Promise.all([p.waitForEvent('download'), p.locator('.row-menu').last().getByText('Télécharger le fichier').click()]);
    expect(telechargement.suggestedFilename()).toBe('Devis signé DEV-2026-031.pdf');
    const enregistre = path.join(dossier_, 'telecharge.pdf');
    await telechargement.saveAs(enregistre);
    expect(fs.readFileSync(enregistre).equals(PDF)).toBe(true);

    // Rechargé : toujours là.
    await p.reload();
    await p.locator('#attachments').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#attachments').innerText()).toContain('Devis signé DEV-2026-031.pdf');

    // Retirer : la question dit ce que le serveur garde ; joint à l'instant, il est effacé.
    await p.locator('#attachments tr', { hasText: 'Devis signé' }).getByRole('button', { name: /Actions/ }).click();
    await p.locator('.row-menu').last().getByText('Retirer ce justificatif').click();
    await expect.poll(() => p.locator('.modal').last().innerText()).toContain('Si tu l\'as joint il y a moins de 24 heures, il est effacé');
    await p.locator('.modal').last().getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(() => p.locator('#attachments').innerText()).not.toContain('Devis signé');
    expect(await p.locator('#attachments').innerText()).toContain('Chantier.png');
    expect((await api('GET', `/entreprises/${ent}/pieces-jointes/${String(fiche?.file)}`, nadia)).statut).toBe(404);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('un fichier qui n\'est ni une photo ni un PDF se refuse, et dit pourquoi', async () => {
    const { cx, p, erreurs } = await devisOuvert(serveur.adresse);
    await joindre(p, [{ name: 'Contrat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PK\u0003\u0004 un document Word renommé') }]);
    await expect.poll(() => p.locator('#toast').innerText().catch(() => ''), { timeout: 15_000 }).toContain('« Contrat.pdf » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF');
    expect(await p.locator('#attachments').innerText()).toContain('Aucune pièce jointe');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
