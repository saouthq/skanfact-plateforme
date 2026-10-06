// La caisse dans l'application de bureau, à la souris (brique 138 ; docs/bureau.md, C) : la vraie coque Electron sur
// le vrai serveur, une fausse imprimante de tickets sur le réseau. Nadia règle l'imprimante de son comptoir dans les
// Paramètres (une adresse oubliée est refusée et montrée), imprime un essai, ouvre le tiroir ; puis elle encaisse :
//   - en espèces : le ticket sort tout seul, et le tiroir s'ouvre ;
//   - par carte : le ticket sort, le tiroir reste fermé ;
//   - « Imprimer » un ticket déjà encaissé le ressort, sans ouvrir le tiroir ;
//   - l'imprimante éteinte : le ticket est encaissé, et la phrase dit qu'il n'est pas imprimé, et quoi vérifier.
// Le ticket imprimé est le dessin de la v10 (son image se garde dans dist/photos pour être regardée).
// Dans un navigateur, rien de cela : pas de panneau, la caisse de la v10.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
import { build } from 'vite';
import { fermerCoque } from './fermer.ts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { COUPE, INIT, TIROIR } from '../../bureau/agent/escpos.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const electron = (await import('electron')).default as unknown as string;

async function ecran(): Promise<{ display: string; fermer: () => void }> {
  if (process.env.DISPLAY) return { display: process.env.DISPLAY, fermer: () => {} };
  const n = 80 + Math.floor(Math.random() * 9);
  const x: ChildProcess = spawn('Xvfb', [`:${n}`, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  await new Promise((ok) => setTimeout(ok, 800));
  return { display: `:${n}`, fermer: () => x.kill() };
}
// Une fausse imprimante réseau : un envoi compte quand l'agent a fini de l'envoyer (connexion fermée).
const imprimante = async () => {
  const recus: Buffer[][] = [];
  const s = net.createServer((c) => { const r: Buffer[] = []; c.on('data', (d) => r.push(d)); c.on('end', () => recus.push(r)); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { port: (s.address() as net.AddressInfo).port, envoi: (i: number) => Buffer.concat(recus[i] ?? []), combien: () => recus.length, fermer: () => s.close() };
};
// Le raster reçu, relu en lignes de points (pour le regarder, et vérifier qu'il n'est pas blanc).
function lignes(b: Buffer): { largeur: number; noir: boolean[][] } {
  let o = INIT.length;
  const noir: boolean[][] = [];
  let largeur = 0;
  while (b[o] === 0x1d && b[o + 1] === 0x76) {
    const parLigne = b.readUInt16LE(o + 4);
    const n = b.readUInt16LE(o + 6);
    largeur = parLigne * 8;
    for (let y = 0; y < n; y++) {
      const l: boolean[] = [];
      for (let x = 0; x < largeur; x++) l.push(((b[o + 8 + y * parLigne + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0);
      noir.push(l);
    }
    o += 8 + parLigne * n;
  }
  return { largeur, noir };
}
// L'image du ticket en PBM (un format d'image tout simple), pour la regarder.
const enPbm = (t: ReturnType<typeof lignes>) => `P1\n${t.largeur} ${t.noir.length}\n${t.noir.map((l) => l.map((x) => (x ? '1' : '0')).join(' ')).join('\n')}\n`;

describe('la caisse dans l\'application de bureau', () => {
  let app: ElectronApplication;
  let page: Page;
  let e: Awaited<ReturnType<typeof ecran>>;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let papier: Awaited<ReturnType<typeof imprimante>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-caisse-'));
  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-poste-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    e = await ecran();
    papier = await imprimante();
    app = await _electron.launch({ executablePath: electron, args: ['--no-sandbox', '--disable-gpu', path.join(RACINE, 'bureau/coque/principal.ts')],
      env: { ...process.env, DISPLAY: e.display, TZ: 'Africa/Tunis', SKANFACT_ADRESSE: serveur.adresse, SKANFACT_BUREAU_DONNEES: donnees } });
    page = await app.firstWindow();
    await page.waitForLoadState();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 180_000);
  afterAll(async () => { await fermerCoque(app); await serveur?.arreter(); papier?.fermer(); e?.fermer(); fs.rmSync(dossier, { recursive: true, force: true }); }, 60_000);

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net2 = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const annee = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);

  it('Nadia règle l\'imprimante de son comptoir, encaisse en espèces (ticket et tiroir) puis par carte (ticket seul)', async () => {
    const email = `nadia-bureau-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    // Le rouleau de son imprimante fait 58 mm (le réglage « Caisse et tickets » de l'entreprise).
    const societe = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, caisseLargeur: 58 } },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 100, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'Banque', kind: 'banque', bank: 'BIAT', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
    ] })).statut).toBe(200);

    const erreurs: string[] = [];
    page.on('pageerror', (x) => erreurs.push(x.message));
    await page.evaluate((j) => sessionStorage.setItem('skanfact.jeton', j), jeton);
    const plusTard = async () => { for (let i = 0; i < 3 && await page.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await page.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
    const toast = async () => net2(await page.locator('#toast').innerText().catch(() => ''));

    // 1. Les Paramètres → Documents : le panneau « Imprimante de tickets » (de ce poste).
    await page.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await page.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard();
    await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    const panneau = page.locator('#p-imprimante');
    const dit = async () => net2(await panneau.locator('[role=alert]').innerText());
    await expect.poll(() => dit(), { timeout: 15_000 })
      .toBe('Aucune imprimante de tickets n\'est réglée sur ce poste : les tickets s\'impriment par la fenêtre d\'impression.');
    // L'adresse oubliée : refusée, et le champ est montré.
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => dit()).toBe('L\'adresse de l\'imprimante manque, ou le port réseau n\'est pas un nombre de 1 à 65535.');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('imp-hote');
    await panneau.locator('#imp-hote').fill('127.0.0.1');
    await panneau.locator('#imp-port').fill(String(papier.port));
    // Un réglage du poste, pas des Paramètres de l'entreprise : rien à « Enregistrer » dans la barre du bas.
    expect(await page.locator('#save-bar').isHidden()).toBe(true);
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => dit()).toBe('Imprimante enregistrée sur ce poste. Imprime un essai pour vérifier qu\'elle répond.');
    await page.screenshot({ path: path.join(PHOTOS, 'bureau-1-imprimante.png') });
    // L'essai, puis le tiroir seul.
    await panneau.getByRole('button', { name: 'Imprimer un essai', exact: true }).click();
    await expect.poll(() => dit(), { timeout: 15_000 })
      .toBe('L\'essai est parti à l\'imprimante (rouleau de 58 mm) : s\'il est sorti entier, de bord à bord, c\'est réglé.');
    await expect.poll(() => papier.combien()).toBe(1);
    expect(papier.envoi(0).readUInt16LE(6)).toBe(48);
    expect(papier.envoi(0).subarray(papier.envoi(0).length - COUPE.length).equals(Buffer.from(COUPE))).toBe(true);
    await panneau.getByRole('button', { name: 'Ouvrir le tiroir', exact: true }).click();
    await expect.poll(() => dit()).toBe('L\'impulsion du tiroir est partie à l\'imprimante.');
    await expect.poll(() => papier.combien()).toBe(2);
    expect(papier.envoi(1).toString('hex')).toBe(Buffer.concat([INIT, TIROIR]).toString('hex'));

    // 2. La caisse : ouverte avec 100 DT ; trois laits en espèces, 10 DT reçus.
    await page.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => page.locator('#cs-fond').count(), { timeout: 20_000 }).toBe(1);
    await plusTard();
    await page.locator('#cs-fond').fill('100');
    await page.locator('#cs-ouvrir').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Caisse ouverte, fond de caisse 100,000 DT');
    const lait = page.locator('#cs-articles .cs-art', { hasText: 'Lait demi-écrémé' });
    for (let i = 0; i < 3; i++) await lait.click();
    await page.locator('#cs-encaisser').click();
    await page.locator('#cs-recu').fill('10');
    await page.locator('#cs-valider').click();
    // 3 laits affichés 2,797 DT : 8,391 DT, le prix d'étiquette fait foi (lot caisse 3).
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé — à rendre 1,609 DT`);
    // Le ticket sort tout seul, et le tiroir s'ouvre (des espèces).
    await expect.poll(() => papier.combien(), { timeout: 15_000 }).toBe(3);
    const especes = papier.envoi(2);
    expect(especes.subarray(especes.length - COUPE.length - TIROIR.length).equals(Buffer.concat([COUPE, TIROIR]))).toBe(true);
    const image = lignes(especes);
    expect(image.largeur).toBe(384);
    // Un vrai ticket : de l'encre, sur une bonne longueur de papier.
    expect(image.noir.flat().filter(Boolean).length).toBeGreaterThan(3000);
    expect(image.noir.length).toBeGreaterThan(400);
    fs.writeFileSync(path.join(PHOTOS, 'bureau-ticket-especes.pbm'), enPbm(image));

    // 3. Par carte : le ticket sort, le tiroir reste fermé.
    await page.locator('#cs-nouvelle').click();
    await lait.click();
    await page.locator('#cs-encaisser').click();
    await page.locator('#cs-paiement [data-mode=carte]').click();
    await page.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);
    await expect.poll(() => papier.combien(), { timeout: 15_000 }).toBe(4);
    const carte = papier.envoi(3);
    expect(carte.subarray(carte.length - COUPE.length).equals(Buffer.from(COUPE))).toBe(true);
    expect(carte.readUInt16LE(6)).toBe(48);

    // 4. « Imprimer le dernier » : il ressort, sans tiroir.
    await page.locator('#cs-print-last').click();
    await expect.poll(() => papier.combien(), { timeout: 15_000 }).toBe(5);
    expect(papier.envoi(4).subarray(papier.envoi(4).length - COUPE.length).equals(Buffer.from(COUPE))).toBe(true);

    // 5. L'imprimante éteinte : le ticket est encaissé quand même, et la phrase dit quoi vérifier.
    fs.writeFileSync(path.join(donnees, 'bureau.json'), JSON.stringify({ imprimante: { branchement: 'reseau', hote: '127.0.0.1', port: 1 } }));
    await page.locator('#cs-nouvelle').click();
    await lait.click();
    await page.locator('#cs-encaisser').click();
    await page.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 15_000 }).toBe('Ticket encaissé, mais pas imprimé : l\'imprimante de tickets ne répond pas : vérifie qu\'elle est allumée et branchée, et son adresse (Paramètres → Documents → Imprimante de tickets).');
    expect(papier.combien()).toBe(5);
    await page.screenshot({ path: path.join(PHOTOS, 'bureau-2-eteinte.png') });

    // 6. « Ne plus imprimer depuis ce poste » : l'encaissement ne tente plus rien, et ne se plaint de rien.
    await page.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await page.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard();
    await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    await panneau.getByRole('button', { name: 'Ne plus imprimer depuis ce poste', exact: true }).click();
    await expect.poll(dit).toBe('Aucune imprimante de tickets n\'est réglée sur ce poste : les tickets s\'impriment par la fenêtre d\'impression.');
    // (Revenue d'une autre page, la caisse reprend la vente : la monnaie de la dernière a été rendue.)
    await page.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => page.locator('#cs-articles .cs-art').count(), { timeout: 20_000 }).toBe(1);
    await plusTard();
    await lait.click();
    await page.locator('#cs-encaisser').click();
    await page.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-004 encaissé`);
    await page.waitForTimeout(1500);
    expect(await toast()).toBe(`Ticket TIC-${annee}-004 encaissé`);
    expect(papier.combien()).toBe(5);
    expect(erreurs).toEqual([]);

    // 7. Dans un navigateur, la même entreprise : pas de panneau d'imprimante, la caisse de la v10.
    const nav = await chromium.launch();
    const cx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    await p.getByRole('tab', { name: 'Documents', exact: true }).click();
    await p.locator('#p-caisse').waitFor();
    expect(await p.locator('#p-imprimante').count()).toBe(0);
    await nav.close();
  }, 300_000);
});
