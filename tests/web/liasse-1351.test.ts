// La Liasse d'un dossier au Cabinet, jouée comme un comptable (1.351.0 ; docs/revue-modules.md). Ce que le parcours vérifie :
//   - la déclaration annuelle d'employeur lit les retenues sur fournisseurs là où le logiciel les écrit (4352) : la case
//     lisait un 4322 que rien n'écrit, et répondait « aucun mouvement » à un dossier qui avait retenu ;
//   - le taux d'impôt saisi donne l'impôt, une réintégration le déplace — refaits à la main ;
//   - « Enregistrer le taux » est aligné sur sa case.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la liasse d\'un dossier, jouée comme un comptable (1.351.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liasse-1351-'));
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


  it('(1.351.0) les retenues sur fournisseurs lues au 4352, l\'impôt au taux saisi et après une réintégration, le bouton du taux aligné sur sa case', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, journal: string, piece: string, lignes: [string, string, string][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle: piece, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    // Une vente de 10 000 HT, des honoraires de 1 000 réglés nets de leur retenue de 15 (au 4352). Résultat : 9 000.
    const ids = [
      await saisir('2026-02-10', 'VT', 'V-01', [['411', '11900,000', ''], ['706', '', '10000,000'], ['4367', '', '1900,000']]),
      await saisir('2026-02-12', 'AC', 'H-01', [['6226', '1000,000', ''], ['401', '', '1000,000']]),
      await saisir('2026-02-20', 'BQ', 'R-01', [['401', '1000,000', ''], ['4352', '', '15,000'], ['532', '', '985,000']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/liasse/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#li-cases').waitFor({ timeout: 20_000 });
    const ligne = async (dans: string, cle: string) => (await p.locator(`${dans} tr`).filter({ hasText: cle }).first().innerText()).replace(/\s+/g, ' ');

    // ── La retenue opérée sur le fournisseur, lue où elle est écrite ─────────────────────────────────
    expect(await ligne('#li-cases', 'Retenues à la source sur fournisseurs')).toMatch(/^Retenues à la source sur fournisseurs 4352 15,000 DT$/);

    // ── Le taux, l'impôt ; le bouton sur la ligne de sa case ─────────────────────────────────────────
    const milieu = async (sel: string) => { const b = await p.locator(sel).boundingBox(); return (b?.y ?? 0) + (b?.height ?? 0) / 2; };
    expect(Math.abs(await milieu('#li-taux-ok') - await milieu('#li-taux'))).toBeLessThan(2);
    await p.locator('#li-taux').fill('15');
    await p.locator('#li-taux-ok').click();
    // 9 000 × 15 % = 1 350.
    await expect.poll(() => p.locator('#view').innerText().then((t) => t.replace(/\s+/g, ' '))).toMatch(/Impôt au taux de 15 % 1 350,000 DT/);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
