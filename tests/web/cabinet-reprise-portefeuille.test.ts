// Reprendre le portefeuille du Cabinet v10, à la souris (brique 70 ; docs/cabinet.md, C60). Un cabinet neuf
// (la page Dossiers vide) choisit le fichier de son cabinet v10 dans la fenêtre du navigateur. Ce que le
// parcours vérifie, écran ET serveur :
//   - un fichier qui a une anomalie : le rapport la nomme, aucun bouton pour créer, rien de créé ;
//   - le bon fichier : le rapport compte ce qui se crée et ce qui ne se crée pas ; « Créer 2 dossiers »
//     les crée, la page les montre ; la clé privée du cabinet n'est jamais partie.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('reprendre le portefeuille du Cabinet v10, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reprise-portefeuille-'));
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

  // Un matricule fiscal propre à chaque passage (il est unique dans toute la base).
  const MAT = String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  // Le fichier d'un cabinet de la v10, tel qu'elle l'écrit : sa clé privée, deux dossiers tenus, un
  // client sur SkanFact, un dossier d'exemple.
  const fichierDuCabinet = (en: Record<string, unknown> = {}) => ({
    format: 1, cabinet: { name: 'Cabinet Ennour', email: 'contact@ennour.tn', publicKey: 'CLE-PUBLIQUE', privateKey: 'CLE-PRIVEE-DU-CABINET' },
    dossiers: [
      { id: 'd1', name: 'Boulangerie Ennour', matricule: `${MAT}A/P/M/000`, manual: true, email: 'gerant@ennour.tn', fees: 350.5, ...en },
      { id: 'd2', name: 'Café des Arts', matricule: '', manual: true },
      { id: 'd3', name: 'Menuiserie Ben Salah', matricule: '7654321B/A/M/000', manual: false, clePublique: 'CLE-DU-CLIENT' },
      { id: 'd4', name: 'Exemple — Épicerie', manual: true, demo: true },
    ],
  });

  it('le rapport se lit avant que rien ne se crée ; une anomalie bloque ; le bon fichier crée les dossiers tenus, sans que la clé parte', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabinet-v10-'));
    const abime = path.join(tmp, 'cabinet.json');
    fs.writeFileSync(abime, JSON.stringify(fichierDuCabinet({ matricule: '12345' })));
    const bon = path.join(tmp, 'cabinet-bon.json');
    fs.writeFileSync(bon, JSON.stringify(fichierDuCabinet()));
    const tenus = async () => ((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as { raisonSociale: string; tenu: boolean }[])
      .filter((d) => d.tenu).map((d) => d.raisonSociale).sort();

    const erreurs: string[] = [];
    const envois: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    p.on('request', (r) => { const d = r.postData(); if (d) envois.push(d); });
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const choisir = async (fichier: string) => {
      await p.locator('#rp-v10').waitFor({ timeout: 20_000 });
      const [fenetre] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#rp-v10').click()]);
      await fenetre.setFiles(fichier);
      await p.locator('#modal-root #rpv-rapport').waitFor({ timeout: 15_000 });
      return p.locator('#modal-root .modal').last();
    };

    // ── Le fichier abîmé : l'anomalie nommée, aucun bouton pour créer, rien de créé ─────────────────
    let m = await choisir(abime);
    expect(await m.locator('#rpv-anomalies').innerText()).toMatch(/Un point empêche la reprise\s:\scorrige-le dans la v10[\s\S]*Boulangerie Ennour\s:\sLe matricule fiscal «\s12345\s» ne se lit pas/);
    expect(await m.locator('#ok').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-portefeuille-anomalie.png') });
    await m.locator('[data-close]').click();
    expect(await tenus()).toEqual([]);

    // ── Le bon fichier : le rapport, puis « Créer 2 dossiers » ───────────────────────────────────────
    m = await choisir(bon);
    const rapport = await m.locator('#rpv-rapport').innerText();
    expect(rapport).toMatch(/Dossiers tenus à créer, avec leur fiche\s+2/);
    expect(rapport).toMatch(/Clients sur SkanFact — ils te rejoignent par leur mandat \(ton code de cabinet\)\s+1/);
    expect(rapport).toMatch(/Dossiers d'exemple — laissés\s+1/);
    expect(await m.locator('#rpv-ok').innerText()).toMatch(/Boulangerie Ennour, Café des Arts/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-portefeuille-rapport.png') });
    await m.getByRole('button', { name: 'Créer 2 dossiers', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toBe('2 dossiers repris de SkanFact Cabinet v10.');
    expect(await tenus()).toEqual(['Boulangerie Ennour', 'Café des Arts']);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie Ennour[\s\S]*Café des Arts|Café des Arts[\s\S]*Boulangerie Ennour/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-portefeuille-fait.png') });
    // La clé privée du cabinet, et celle du client, ne sont jamais parties du poste.
    expect(envois.filter((x) => /CLE-PRIVEE|CLE-DU-CLIENT|CLE-PUBLIQUE/.test(x))).toEqual([]);
    expect(envois.some((x) => x.includes('Boulangerie Ennour'))).toBe(true);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
