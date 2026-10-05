// Les dates des champs du navigateur, dans un navigateur réglé en anglais (vu sur le serveur d'essai le 05/10/2026 : la
// péremption d'un article s'affichait « mm/dd/yyyy », où le 05/10 se lit le 10 mai). Sur la plateforme, un champ
// `type=date` devient un champ JJ/MM/AAAA, quelle que soit la langue du navigateur ; sa valeur pour le code reste le
// jour ISO. Hichem, épicier, tient ses yaourts par lot.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Locator } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('les dates, dans un navigateur réglé en anglais', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dates-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch({ args: ['--lang=en-US'] });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Ce que le champ AFFICHE (la valeur du champ lui-même, pas celle que le code lit).
  const affiche = (champ: Locator) => champ.evaluate((el) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(el) as string);
  // Ce que le CODE de l'écran lit (dans la page ; `inputValue` de Playwright lit, lui, ce que le champ affiche).
  const valeur = (champ: Locator) => champ.evaluate((el) => (el as HTMLInputElement).value);

  it('la péremption s\'affiche et se tape JJ/MM/AAAA ; une date impossible se voit ; le jour enregistré est le bon', async () => {
    const email = `hichem-dates-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hichem', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Hichem' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Le 5 novembre : un jour qui, lu à l'américaine, serait le 11 mai.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'catalog', cle: 'yaourt', rang: 0, revision: null, contenu: { id: 'yaourt', label: 'Yaourt nature 125 g', unit: 'pot', unitPrice: { '~n': '0.6' }, vatRate: 7, tracked: true, parLot: true,
        initialQty: 20, initialCost: { '~n': '0.4' }, initialDate: '2026-10-01', initialLot: 'L-0901', initialPeremption: '2026-11-05' } },
    ] })).statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/article/yaourt`);
    await p.locator('#edit-item').waitFor({ timeout: 20_000 });
    for (const b of await p.getByRole('button', { name: 'Plus tard', exact: true }).all()) await b.click().catch(() => undefined);
    await p.locator('#edit-item').click();
    const champ = p.locator('#modal-root [name=initialPeremption]');
    await champ.waitFor();
    // Le jour enregistré s'affiche jour/mois/année, et le champ dit sa forme.
    expect(await champ.getAttribute('type')).toBe('text');
    expect(await champ.getAttribute('placeholder')).toBe('JJ/MM/AAAA');
    expect(await affiche(champ)).toBe('05/11/2026');
    expect(await valeur(champ)).toBe('2026-11-05');
    // Un jour qui n'existe pas : le champ le dit en quittant la saisie, et le code ne lit aucune date.
    await champ.click();
    await p.keyboard.press('Control+A');
    await p.keyboard.type('31/02/2027');
    await p.keyboard.press('Tab');
    await expect.poll(() => champ.getAttribute('aria-invalid')).toBe('true');
    expect(await champ.getAttribute('title')).toBe('Une date s\'écrit jour/mois/année : 05/10/2026.');
    expect(await valeur(champ)).toBe('');
    // Tapé sans barres, le jour se lit et se réécrit JJ/MM/AAAA.
    await champ.click();
    await p.keyboard.press('Control+A');
    await p.keyboard.type('31122027');
    await p.keyboard.press('Tab');
    await expect.poll(() => affiche(champ)).toBe('31/12/2027');
    expect(await champ.getAttribute('aria-invalid')).toBeNull();
    expect(await valeur(champ)).toBe('2027-12-31');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    // Le serveur garde le jour ISO ; la page de l'article dit « périme le 31/12/2027 ».
    const lire = async () => ((((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: { initialPeremption?: string } }[])
      .find((o) => o.cle === 'yaourt')?.contenu.initialPeremption) ?? '');
    await expect.poll(lire, { timeout: 10_000 }).toBe('2027-12-31');
    await expect.poll(async () => (await p.locator('#art-lots').innerText().catch(() => '')).replace(/\s+/g, ' '), { timeout: 10_000 }).toContain('périme le 31/12/2027');
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
