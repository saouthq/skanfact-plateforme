// 1.357.7 — la boulangerie emprunte à la BIAT pour le four (bout en bout 16), joué à la souris puis au Cabinet :
//   - un mouvement daté AVANT le solde de départ de son compte y est déjà compris : la fenêtre le dit avant d'enregistrer,
//     la liste le marque et son pied ne le compte pas, et la fenêtre du compte dit ce que la date du départ englobe et ce
//     que la changer ferait au solde ;
//   - une échéance d'emprunt porte ses intérêts : « Dont intérêts » n'existe que pour cette nature, le capital se calcule
//     pendant la frappe, la liste dit « dont … d'intérêts » ;
//   - au pont, le prêt arrive en opération diverse contre le 471, et l'échéance en trois lignes (16, 651, 532).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('le prêt du four 1.357.7 : ce qui précède le solde de départ, et les intérêts de l\'échéance', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tiroir-1357-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const plusTard = async (p: import('playwright-core').Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  it('le prêt d\'avant le départ se dit et ne compte pas deux fois ; l\'échéance porte ses intérêts, jusqu\'au pont', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const fr = auj.split('-').reverse().join('/');
    const jour = (n: number) => { const d = new Date(`${auj}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const avant = jour(-9);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT compte courant', kind: 'banque', bank: 'BIAT', opening: 48250, openingDate: auj, isDefault: true } },
      { collection: 'movements', cle: 'm-pret', rang: 1, revision: null, contenu: { id: 'm-pret', date: avant, kind: 'pret', amount: 18000, accountId: 'a-biat', method: 'virement', label: 'Prêt BIAT pour le four', reference: 'Contrat 2026-114' } },
    ] })).statut).toBe(200);

    const cx = await contexte(sarra);
    const erreurs: string[] = [];
    const page = async (ancre: string, attendre: string) => {
      const p = await cx.newPage();
      p.on('pageerror', (x) => erreurs.push(x.message));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${ancre}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
      return p;
    };

    // ── 1. La liste : le prêt est marqué, et le pied ne l'additionne pas.
    const t = await page('#/tresorerie', '#t-tabs');
    await t.locator('#t-tabs [data-tab="mouvements"]').click();
    const ligne = t.locator('#t-moves tbody tr', { hasText: 'Prêt BIAT pour le four' });
    await expect.poll(async () => net(await ligne.innerText())).toContain(`Déjà dans le solde de départ du ${fr}`);
    const pied = net(await t.locator('#t-moves tfoot').innerText());
    expect(pied).toContain('hors 1 mouvement déjà compris dans le solde de départ');
    expect(pied).toMatch(/Entrées\s*0,000/);

    // ── 2. La fenêtre du mouvement le dit avant d'enregistrer ; le jour du départ, plus rien.
    await ligne.click();
    const fen = t.locator('.modal').last();
    await expect.poll(async () => net(await fen.locator('#mf-avant').innerText())).toContain('Daté avant le solde de départ de « BIAT compte courant » (48 250,000 DT');
    expect(await fen.locator('#mf-avant').isVisible()).toBe(true);
    await fen.locator('[name=date]').evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, auj);
    await expect.poll(() => fen.locator('#mf-avant').isHidden()).toBe(true);
    await fen.getByRole('button', { name: 'Annuler' }).click();
    for (let i = 0; i < 2 && await t.getByRole('button', { name: /Abandonner|Ne pas enregistrer/ }).count(); i++) await t.getByRole('button', { name: /Abandonner|Ne pas enregistrer/ }).first().click();

    // ── 3. La fenêtre du compte : ce que la date du départ englobe, et ce que la déplacer ferait au solde.
    await t.locator('#t-tabs [data-tab="position"]').click();
    await t.locator('#tr-comptes .tr-compte [data-rowmenu]').first().click();
    await t.getByText('Modifier le compte', { exact: true }).click();
    const cpt = t.locator('.modal').last();
    await expect.poll(async () => net(await cpt.locator('#af-depart').innerText())).toContain(`Avant le ${fr} : 1 mouvement (+ 18 000,000 DT), déjà compris dans ce solde de départ`);
    await cpt.locator('[name=openingDate]').evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, avant);
    await expect.poll(async () => net(await cpt.locator('#af-depart').innerText())).toContain('Le solde d\'aujourd\'hui passera de 48 250,000 DT à 66 250,000 DT.');
    await cpt.getByRole('button', { name: 'Annuler' }).click();
    for (let i = 0; i < 2 && await t.getByRole('button', { name: /Abandonner|Ne pas enregistrer/ }).count(); i++) await t.getByRole('button', { name: /Abandonner|Ne pas enregistrer/ }).first().click();

    // ── 4. L'échéance : « Dont intérêts » n'existe que pour cette nature, et le capital se calcule pendant la frappe.
    await t.getByRole('button', { name: 'Mouvement', exact: true }).click();
    const ech = t.locator('.modal').last();
    expect(await ech.locator('#mf-int').isHidden()).toBe(true);
    await ech.locator('[name=kind]').selectOption('emprunt');
    expect(await ech.locator('#mf-int').isVisible()).toBe(true);
    await ech.locator('[name=amount]').fill('1635');
    await ech.locator('[name=interets]').fill('135');
    await expect.poll(async () => net(await ech.locator('#mf-int-cap').innerText())).toBe('Capital remboursé : 1 500,000 DT · les intérêts sont une charge.');
    await ech.locator('[name=interets]').fill('2000');
    await ech.locator('[name=label]').fill('Échéance du prêt');
    await ech.locator('[name=reference]').fill('ECH-1');
    await ech.locator('#ok').click();
    // Refusé, la case montrée : des intérêts plus grands que l'échéance feraient un capital négatif.
    await expect.poll(async () => net(await t.locator('#toast').innerText())).toContain('Les intérêts ne peuvent pas dépasser l\'échéance (1 635,000 DT)');
    expect(await ech.isVisible()).toBe(true);
    await ech.locator('[name=interets]').fill('135');
    await ech.locator('#ok').click();
    await expect.poll(() => ech.isVisible()).toBe(false);
    await t.locator('#t-tabs [data-tab="mouvements"]').click();
    await expect.poll(async () => net(await t.locator('#t-moves tbody tr', { hasText: 'Échéance du prêt' }).innerText())).toContain('dont 135,000 DT d\'intérêts');

    // ── 5. Le pont : le prêt en opération diverse contre le 471, l'échéance en trois lignes.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { journal: string; statut: string; lignes: Ligne[] };
    const auPont = async (piece: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=${encodeURIComponent(piece)}&limite=50`, leila)).corps.ecritures as Ecriture[] ?? [])
      .map((x) => [x.journal, x.statut, ...x.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`)].join(' | '));
    await expect.poll(() => auPont('Contrat 2026-114'), { timeout: 20_000 }).toEqual(['OD | brouillard | 471 18000.000 0.000 | 16 0.000 18000.000']);
    await expect.poll(() => auPont('ECH-1'), { timeout: 20_000 }).toEqual(['BQ | brouillard | 16 1500.000 0.000 | 651 135.000 0.000 | 532 0.000 1635.000']);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
