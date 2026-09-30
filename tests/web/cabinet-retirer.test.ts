// Retirer un dossier du portefeuille, à la souris (brique 56 ; docs/cabinet.md, C46). L'écran est celui
// du Cabinet v10 (la fiche du dossier, « Retirer du portefeuille… ») ; retirer un dossier arrête son
// mandat, rien ne s'efface. Ce que le parcours vérifie, écran ET serveur :
//   - un dossier tenu créé par erreur (aucune écriture) sort du portefeuille et de la liste ;
//   - un dossier tenu qui a des écritures ne se retire pas : le refus le dit, et dit d'archiver ; il reste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('retirer un dossier du portefeuille, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-retirer-'));
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

  it('un dossier tenu sans écriture sort du portefeuille ; celui qui a des écritures reste, et le refus dit d\'archiver', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cree = async (nom: string) => String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: nom })).corps.entreprise);
    const vide = await cree('Créé par erreur'), tenu = await cree('Boulangerie Ennour');
    expect((await api('POST', `/entreprises/${tenu}/compta/ecritures`, associe, {
      date: '2026-03-20', journal: 'OD', piece: 'OD-1', libelle: 'Loyer', lignes: [{ compte: '6132', debit: '850,500' }, { compte: '401', credit: '850,500' }] })).statut).toBe(201);
    const auPortefeuille = async () => ((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as { entreprise: string }[]).map((d) => d.entreprise).sort();

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const toast = () => p.locator('#toast').innerText();
    const retirer = async (ent: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await expect.poll(async () => {
        if (!await p.locator('#modal-root #del').count()) await p.locator('#edit').first().click({ timeout: 2_000 }).catch(() => {});
        return p.locator('#modal-root #del').count();
      }, { timeout: 20_000 }).toBe(1);
      expect(await p.locator('#modal-root #del').innerText()).toBe('Retirer du portefeuille…');
      await p.locator('#modal-root #del').click();
      const confirmer = p.locator('#modal-root .modal').last();
      await expect.poll(() => confirmer.innerText()).toMatch(/Retirer ce dossier du portefeuille \?/);
      expect(await confirmer.innerText()).toMatch(/il ne se retire que s'il n'a aucune écriture/);
      expect(await confirmer.locator('#ok').innerText()).toBe('Retirer');
      await confirmer.locator('#w').fill('RETIRER');
      await confirmer.locator('#ok').click();
    };

    // Le dossier qui a des écritures : refusé, le refus dit d'archiver ; il reste au portefeuille.
    await retirer(tenu);
    await expect.poll(toast, { timeout: 15_000 }).toMatch(/a 1 écriture dans ses livres.*Archive-le plutôt/);
    expect(await auPortefeuille()).toEqual([tenu, vide].sort());
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-retirer-refus.png') });

    // Le dossier créé par erreur : il sort du portefeuille, et de la liste.
    await retirer(vide);
    await expect.poll(toast, { timeout: 15_000 }).toBe('Dossier retiré du portefeuille.');
    expect(await auPortefeuille()).toEqual([tenu]);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Boulangerie Ennour/);
    expect(await p.locator('#view').innerText()).not.toMatch(/Créé par erreur/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-retirer-fait.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
