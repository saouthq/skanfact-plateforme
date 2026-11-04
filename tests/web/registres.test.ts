// Les registres du socle dans le navigateur (docs/cadrage/17-rangement.md § 3.3 ; lot B0, 04/11/2026). Rien ne s'en sert
// encore : un fichier absent, refusé par la politique de sécurité de la page ou chargé trop tard ne changerait aucun
// écran, et la comparaison des écrans ne le verrait pas. Ce test ouvre les deux pages construites et regarde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('les registres du socle, dans le navigateur', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-registres-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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

  it('servis et chargés avant tout autre script, sur la page de l\'entreprise comme au Cabinet, ils sont là et vides', async () => {
    // Comme un vrai compte : connecté, son code posé (il est exigé de qui tient un cabinet). Un compte pour l'entreprise,
    // un autre pour le cabinet.
    const personne = async (prenom: string) => {
      const email = `${prenom}-registres-${Date.now()}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
      const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', j, { methode: 'application' });
      return j;
    };
    const jeton = await personne('nadia'), associe = await personne('karim');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Nadia' })).corps.id);
    const cab = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Karim' })).corps.id);
    expect(ent).toMatch(/\S{8}/);
    expect(cab).toMatch(/\S{8}/);
    for (const [page, j] of [[`/v10/?e=${ent}#/dashboard`, jeton], [`/v10/cabinet/?c=${cab}#/dossiers`, associe]] as const) {
      const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cn.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const p = await cn.newPage();
      const erreurs: string[] = [];
      const servis: number[] = [];
      p.on('pageerror', (e) => erreurs.push(e.message));
      p.on('response', (r) => { if (/\/plateforme\/registres\.js/.test(r.url())) servis.push(r.status()); });
      await p.goto(`${serveur.adresse}${page}`);
      await p.locator('#view').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20_000 }).catch(async (e: unknown) => { await p.screenshot({ path: `${dossier}-echec.png` }); throw new Error(`${page} : ${String(e)} ; ${p.url()}`); });
      expect(servis, page).toEqual([200]);
      const lu = await p.evaluate(() => {
        const w = window as unknown as { Socle?: { etat: () => unknown; EMPLACEMENTS: string[] } };
        return { premier: [...document.scripts].findIndex((s) => /\/plateforme\/registres\.js/.test(s.src)), etat: w.Socle?.etat(), emplacements: w.Socle?.EMPLACEMENTS.length };
      });
      expect(lu.premier, page).toBe(0);
      expect(lu.emplacements, page).toBe(9);
      expect(lu.etat, page).toEqual({ portes: [], points: {}, emplacements: { 'a-faire': 0, palette: 0, creer: 0, pages: 0, 'parties-des-pages': 0, metiers: 0, imports: 0, 'onglets-compta': 0, 'parametres-cabinet': 0 } });
      expect(erreurs, page).toEqual([]);
      await cn.close();
    }
  }, 120_000);
});
