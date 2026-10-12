// « Télécharger toutes mes données », à la souris (0080, docs/export-complet.md). Le panneau « Toutes les données de
// l'entreprise » ouvre l'onglet « Données et sécurité » des Paramètres, pour le propriétaire et un administrateur.
// Ce que le parcours vérifie, écran ET fichier :
//   - le bouton télécharge un fichier nommé d'après l'entreprise, complet (son en-tête, sa fin scellée), que le
//     navigateur enregistre ; la ligne d'état dit son nom et son poids, sans pousser le panneau du dessous ;
//   - un commercial ne voit pas le panneau, et le serveur lui refuse le fichier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('toutes les données de l\'entreprise, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-export-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
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
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const personne = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${unique()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    let c = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
    if (c.corps.etat === 'code') {
      const code = /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
      c = await api('POST', '/connexion/code', undefined, { defi: c.corps.defi, code });
    }
    return { email, jeton: String(c.corps.jeton) };
  };
  const erreurs: string[] = [];
  const page = async (jeton: string) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return p;
  };
  const donnees = async (p: Page, ent: string) => {
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p.locator('#view h1').first().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#set-tabs [data-tab="donnees"]').click();
  };

  it('le propriétaire télécharge le fichier complet ; un commercial ne voit pas le panneau', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie de l\'essai' })).corps.id);
    await api('POST', `/entreprises/${ent}/clients`, nadia.jeton, { raisonSociale: 'Café du Port', identifiant: '1234567A/A/M/000', typeIdentifiant: 'matricule' });

    const p = await page(nadia.jeton);
    await donnees(p, ent);
    const bouton = p.locator('#export-telecharger');
    await bouton.waitFor({ timeout: 15_000 });
    await p.screenshot({ path: path.join(PHOTOS, 'export-complet-panneau.png') });
    const dessous = async () => (await p.locator('#services-panel').boundingBox())?.y ?? -1;
    const avant = await dessous();
    const [telechargement] = await Promise.all([p.waitForEvent('download'), bouton.click()]);
    expect(telechargement.suggestedFilename()).toMatch(/^skanfact-boulangerie-de-l-essai-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const lignes = fs.readFileSync(await telechargement.path(), 'utf8').replace(/\n$/, '').split('\n');
    expect(JSON.parse(lignes[0] ?? '{}')).toMatchObject({ format: 'skanfact-entreprise', entreprise: ent, raisonSociale: 'Boulangerie de l\'essai' });
    expect(JSON.parse(lignes.at(-1) ?? '{}')).toMatchObject({ fin: true });
    expect(lignes.join('\n')).toContain('Café du Port');
    // (La typographie de la v10 pose une espace fine avant les deux points : le texte se compare aplati.)
    await expect.poll(async () => (await p.locator('#export-etat').innerText()).replace(/[\s\u202f\u00a0]+/g, ' ')).toMatch(/^Téléchargé : skanfact-boulangerie-de-l-essai-.+\.jsonl \(\d+ Ko\)\.$/);
    // Le résultat s'écrit dans une place réservée : le panneau du dessous n'a pas bougé.
    expect(await dessous()).toBe(avant);
    expect(await bouton.isEnabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'export-complet-telecharge.png') });

    // Un commercial : ni le panneau, ni sa place dans le sommaire de l'onglet ; et le serveur refuse.
    const yassine = await personne('Yassine');
    const lien = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: yassine.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', yassine.jeton, { jeton: lien })).statut).toBe(200);
    const q = await page(yassine.jeton);
    await donnees(q, ent);
    await q.locator('[data-pane="donnees"]').waitFor({ timeout: 15_000 });
    expect(await q.locator('#export-panel').count()).toBe(0);
    expect(await q.locator('#export-telecharger').count()).toBe(0);
    expect((await api('GET', `/entreprises/${ent}/export`, yassine.jeton)).statut).toBe(403);
    expect(erreurs).toEqual([]);
  }, 120_000);
});
