// La liasse d'un exercice clos, à la souris (brique 59 ; docs/cabinet.md, C49). L'écran est l'onglet
// Liasse du Cabinet v10. Ce que le parcours vérifie, écran ET serveur :
//   - l'exercice ouvert : le taux s'enregistre, un retraitement s'ajoute et se retire ;
//   - l'exercice clos : ni case de taux, ni ligne à ajouter ou retirer ; la phrase dit comment rouvrir ;
//     les retraitements gardés se lisent toujours.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la liasse d\'un exercice clos, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-liasse-close-'));
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
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('un exercice clos montre sa liasse sans rien laisser changer, et dit comment rouvrir', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    expect((await api('PUT', `/entreprises/${cafe}/compta/annuel/2025`, associe, {
      retraitements: [{ id: 'rt1', nature: 'reintegration', libelle: 'Amende fiscale non déductible', montant: '1250,125' }], tauxImpot: '25', revision: null })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const liasse = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/liasse/2025`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await expect.poll(() => p.locator('#view').innerText(), { timeout: 20_000 }).toMatch(/Amende fiscale non déductible/);
    };

    // Ouvert : le taux, l'ajout et le retrait sont là.
    await liasse();
    expect([await p.locator('#li-taux').count(), await p.locator('#li-rt-add').count(), await p.locator('[data-rtx]').count(), await p.locator('#li-close').count()]).toEqual([1, 1, 1, 0]);
    expect(await p.locator('#view .badge', { hasText: /^(clos|ouvert)$/ }).allInnerTexts()).toEqual(['ouvert']);

    // Clos : plus rien ne change, et l'onglet dit comment rouvrir.
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices/2025/cloturer`, associe, {})).statut).toBe(200);
    await liasse();
    expect([await p.locator('#li-taux').count(), await p.locator('#li-rt-add').count(), await p.locator('[data-rtx]').count()]).toEqual([0, 0, 0]);
    // L'en-tête de la liasse dit « clos », comme l'onglet Exercice.
    expect(await p.locator('#view .badge', { hasText: /^(clos|ouvert)$/ }).allInnerTexts()).toEqual(['clos', 'clos']);
    expect(await p.locator('#li-close').innerText()).toMatch(/L'exercice 2025 est clos\s:\ssa liasse ne change plus\. Pour changer un retraitement ou le taux, rouvre-le dans l'onglet Exercice \(avec un motif\)\./);
    expect(await p.locator('#view').innerText()).toMatch(/Amende fiscale non déductible/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-liasse-close.png') });
    await p.locator('#li-close').locator('xpath=ancestor::div[contains(@class, "panel")][1]').screenshot({ path: path.join(PHOTOS, 'cabinet-liasse-close-fiscal.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
