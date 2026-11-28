// Un code pour chaque comptable du cabinet, à la souris (1.390.1, tâche 107 ; migration 0245). L'écran est le panneau
// « L'équipe » des réglages (Mon cabinet). Ce que le parcours vérifie : l'associé coche « Demander un code de connexion
// à chaque comptable », le serveur le garde, la trace le dit en une phrase, et il décoche ; une collaboratrice voit la
// case fermée, avec la raison.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('un code pour chaque comptable du cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-code-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };

  const personneA = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { email, jeton };
  };

  it('l\'associé demande un code à chaque comptable, puis ne le demande plus ; la collaboratrice voit la case fermée', async () => {
    const hana = await personneA('Hana');
    const cabinet = String((await api('POST', '/cabinets', hana.jeton, { nom: 'Cabinet Hana' })).corps.id);
    const rim = await personneA('Rim');
    const inv = await api('POST', `/cabinets/${cabinet}/invitations`, hana.jeton, { email: rim.email, role: 'saisie' });
    expect((await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    const exige = async () => ((await api('GET', '/cabinets', hana.jeton)).corps.cabinets as { id: string; codeExige: boolean }[]).find((c) => c.id === cabinet)?.codeExige;

    const erreurs: string[] = [];
    const ouvrirEquipe = async (jeton: string) => {
      const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
      p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
      await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/reglages`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await expect.poll(async () => {
        if (!await p.locator('#eq-add').count()) await p.locator('#set-tabs [data-tab="cabinet"], #set-tabs button:has-text("Mon cabinet")').first().click({ timeout: 2_000 }).catch(() => {});
        return p.locator('#eq-add').count();
      }, { timeout: 30_000 }).toBe(1);
      return p;
    };

    const p = await ouvrirEquipe(hana.jeton);
    const caseCode = p.locator('#eq-code');
    await caseCode.waitFor({ timeout: 15_000 });
    expect([await caseCode.isChecked(), await caseCode.isDisabled()]).toEqual([false, false]);
    await p.locator('#eq-code-l').click();
    await expect.poll(exige, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await p.locator('#eq-trace tr td:nth-child(2)').allInnerTexts()).map((x) => x.trim())[0], { timeout: 15_000 })
      .toBe('Hana a demandé un code de connexion à chaque comptable du cabinet.');
    expect(await p.locator('#eq-code').isChecked()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-code-exige.png'), fullPage: true });

    // La collaboratrice : la case fermée, cochée, et la raison au-dessus du bouton.
    const q = await ouvrirEquipe(rim.jeton);
    await q.locator('#eq-code').waitFor({ timeout: 15_000 });
    expect([await q.locator('#eq-code').isChecked(), await q.locator('#eq-code').isDisabled()]).toEqual([true, true]);
    expect((await q.locator('#eq-panel').innerText()).replace(/\s+/g, ' ')).toContain('ou demande un code aux comptables.');

    // L'associé décoche : le serveur le garde, et la trace le dit.
    await p.locator('#eq-code-l').click();
    await expect.poll(exige, { timeout: 15_000 }).toBe(false);
    await expect.poll(async () => (await p.locator('#eq-trace tr td:nth-child(2)').allInnerTexts()).map((x) => x.trim())[0], { timeout: 15_000 })
      .toBe('Hana ne demande plus de code de connexion aux comptables du cabinet.');
    expect(erreurs).toEqual([]);
  }, 120_000);
});
