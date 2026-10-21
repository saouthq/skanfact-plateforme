// « Signaler un problème », à la souris (docs/signaler.md). Dans Paramètres › L'application, « Aide et dépannage » revient
// en ligne. Ce que le parcours vérifie :
//   - une erreur de l'écran se note, et « Voir le journal de cet écran » la montre ;
//   - « Signaler un problème… » propose de joindre ce journal (coché, avec de quoi le lire avant) : coché, il part sous le
//     texte de la demande ; décoché, rien n'en part.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('signaler un problème, à la souris', () => {
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-signaler-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
    await admin.connect();
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await admin.end(); await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

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

  it('l\'erreur de l\'écran se lit, part avec la demande si on le coche, et pas sinon', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie du signalement' })).corps.id);
    const p = await page(nadia.jeton);
    await donnees(p, ent);
    // Une erreur de l'écran, comme une vraie : levée hors de tout appel.
    await p.evaluate(() => { setTimeout(() => { throw new Error('Essai du journal de l\'écran'); }, 0); });
    await expect.poll(() => erreurs.length).toBe(1);
    await p.locator('#set-tabs [data-tab="app"]').click();
    await p.locator('#p-depannage').waitFor({ timeout: 10_000 });
    await p.locator('#set-log').click();
    await expect.poll(() => p.locator('#journal-ecran').innerText()).toContain('Essai du journal de l\'écran');
    await p.locator('.modal').last().getByRole('button', { name: 'Fermer' }).click();

    // « Signaler un problème… » : la case du journal, cochée, et de quoi le lire avant.
    await p.locator('#set-support').click();
    const fenetre = p.locator('.modal', { has: p.locator('#sup-sujet') });
    await fenetre.locator('#sup-journal').waitFor({ timeout: 10_000 });
    expect(await fenetre.locator('#sup-journal').isChecked()).toBe(true);
    expect((await fenetre.innerText()).replace(/\s+/g, ' ')).toContain('Et le journal de cet écran : 1 erreur depuis son ouverture');
    await fenetre.locator('#sup-voir-journal').click();
    await expect.poll(() => p.locator('#journal-ecran').innerText()).toContain('Essai du journal de l\'écran');
    await p.locator('.modal', { has: p.locator('#journal-ecran') }).getByRole('button', { name: 'Fermer' }).click();
    await expect.poll(() => p.locator('#journal-ecran').count()).toBe(0);
    await fenetre.locator('#sup-sujet').fill('La page des paramètres affiche une erreur');
    await fenetre.locator('#sup-texte-demande').fill('En ouvrant les paramètres, un message d\'erreur est apparu.');
    await fenetre.locator('#sup-send').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain('Envoyé');
    const demande = async (sujet: string) => String((await admin.query(`select m.texte from plateforme.demande_support d join plateforme.message_support m on m.demande = d.id
       where d.entreprise = $1 and d.sujet = $2`, [ent, sujet])).rows[0]?.texte ?? '');
    const texte = await demande('La page des paramètres affiche une erreur');
    expect(texte).toMatch(/^En ouvrant les paramètres, un message d'erreur est apparu\.\n\n--- journal de cet écran \(1 erreur\) ---\n\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} Uncaught Error: Essai du journal de l'écran$/);

    // Décochée : la demande part sans le journal.
    await donnees(p, ent);
    await p.evaluate(() => { setTimeout(() => { throw new Error('Une seconde erreur'); }, 0); });
    await expect.poll(() => erreurs.length).toBe(2);
    await p.locator('#set-tabs [data-tab="app"]').click();
    await p.locator('#set-support').click();
    const seconde = p.locator('.modal').last();
    await seconde.locator('#sup-journal').uncheck();
    await seconde.locator('#sup-sujet').fill('Sans le journal');
    await seconde.locator('#sup-texte-demande').fill('Rien à joindre cette fois.');
    await seconde.locator('#sup-send').click();
    await expect.poll(() => demande('Sans le journal')).toBe('Rien à joindre cette fois.');
    expect(erreurs).toEqual(['Essai du journal de l\'écran', 'Une seconde erreur']);
  }, 180_000);
});
