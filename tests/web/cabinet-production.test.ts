// La page Production, à la souris (brique 48 ; docs/cabinet.md, C38). L'écran est celui du Cabinet v10
// (le tableau de production) ; ce qu'il lit, le serveur le compte pour tout le portefeuille. Ce que le
// parcours vérifie, écran ET serveur :
//   - chaque case dit l'étape du mois : déclaré, saisi à réviser, à saisir, hors mission ; son détail se
//     lit au survol (écritures, brouillards, révisé, déclaré, dernier geste) ;
//   - « à saisir » compte les mois d'un dossier tenu où rien n'est écrit ; il se relit en revenant sur
//     la page ;
//   - le même index nourrit les Échéances : un dossier tenu y entre avec ses mois à saisir ;
//   - la ligne ouvre la comptabilité du client ; la visite « Suivre la production » se joue.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la production du cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-prod-'));
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

  const saisir = async (jeton: string, ent: string, date: string, piece: string) => String((await api('POST', `/entreprises/${ent}/compta/ecritures`, jeton, {
    date, journal: 'OD', piece, libelle: 'Honoraires à payer', lignes: [{ compte: '6226', debit: '300,125' }, { compte: '4286', credit: '300,125' }] })).corps.id);

  it('les étapes de chaque mois, « à saisir » relu en revenant, la ligne qui ouvre le client, la visite', async () => {
    const associe = await personne('Karim');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' });
    // Février : une écriture au brouillard, déclaration préparée, révision ouverte. Mars : validée,
    // déclarée et déposée, révisée.
    await saisir(associe, garage, '2026-02-12', 'OD-1');
    const mars = await saisir(associe, garage, '2026-03-18', 'OD-2');
    expect((await api('POST', `/entreprises/${garage}/compta/ecritures/valider`, associe, { ids: [mars] })).statut).toBe(200);
    expect((await api('PUT', `/entreprises/${garage}/compta/declarations/2026-03`, associe, { cases: { tvaCollectee: '190,125' } })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${garage}/compta/declarations/2026-03/pointer`, associe, { quoi: 'deposee', le: '2026-04-20' })).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cabinet}/revisions/${garage}/2026-03`, associe, {
      contenu: { faite: true, faiteLe: 1759140000000, faitePar: 'Karim', comptes: [], notes: [], questionnaire: [] }, revision: null })).statut).toBe(200);
    // Les mois dus de l'exercice 2026 : de janvier au mois qui vient de finir (le mois en cours n'est jamais dû).
    const courant = new Date().toISOString().slice(0, 7);
    const dus = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`).filter((m) => m < courant);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (h: string) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${h}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const ligne = (nom: string) => p.locator('#view tr[data-id]').filter({ hasText: nom });
    const caseDu = (nom: string, mois: string) => ligne(nom).locator(`td.prod-c .prod-p[title^="${mois}"]`);

    // ── Chaque case dit l'étape de son mois ────────────────────────────────────────────────────
    await aller('#/production');
    await p.locator('#pr-mois').selectOption('24');
    await expect.poll(() => ligne('Garage du Port').count()).toBe(1);
    expect(await ligne('Café des Arts').count()).toBe(1);
    const mars26 = caseDu('Garage du Port', 'mars 2026');
    expect(await mars26.getAttribute('class')).toMatch(/prod-fini/);
    expect(await mars26.getAttribute('title')).toMatch(/^mars 2026 — tenu au cabinet · 1 écriture dont 0 au brouillard · révisé : oui · déclaré : oui · dernier geste : Karim$/);
    const fev26 = caseDu('Garage du Port', 'février 2026');
    expect(await fev26.getAttribute('class')).toMatch(/prod-revise/);
    expect(await fev26.getAttribute('title')).toMatch(/1 écriture dont 1 au brouillard · révisé : non · déclaré : non/);
    const janv26 = caseDu('Garage du Port', 'janvier 2026');
    expect(await janv26.getAttribute('class')).toMatch(/prod-saisi/);
    expect(await janv26.getAttribute('title')).toMatch(/rien de saisi/);
    // Le café n'a aucun livre : aucun mois n'est attendu de lui.
    expect(await ligne('Café des Arts').locator('.prod-p:not(.prod-hors)').count()).toBe(0);
    const aSaisir = dus.length - 2;
    await expect.poll(() => p.locator('#view .warn-box').first().innerText()).toBe(`${aSaisir} mois attendent leur saisie.`);
    expect(await ligne('Garage du Port').locator('td').last().innerText()).toBe(String(aSaisir));
    expect(await p.locator('.prod-leg').innerText()).toMatch(/manquant/);
    expect(await p.locator('#view').innerText()).not.toMatch(/paquet|reçu/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-production-1.png') });

    // ── Un mois saisi ailleurs : « à saisir » se relit en revenant sur la page ────────────────────
    await saisir(associe, garage, '2026-01-20', 'OD-3');
    await p.locator('.sidebar nav a[data-route="dossiers"]').click();
    await p.locator('#view h1').first().waitFor();
    await p.locator('.sidebar nav a[data-route="production"]').click();
    await expect.poll(() => p.locator('#view .warn-box, #view .ok-box').first().innerText()).toBe(aSaisir - 1 > 0 ? `${aSaisir - 1} mois attendent leur saisie.` : 'Aucun mois n\'attend de saisie.');
    expect(await caseDu('Garage du Port', 'janvier 2026').getAttribute('class')).toMatch(/prod-revise/);

    // ── Le même index nourrit les Échéances : le dossier tenu y entre, avec ses mois à saisir ─────────
    await p.locator('.sidebar nav a[data-route="echeances"]').click();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/à saisir au cabinet/);
    expect(await p.locator('#view').innerText()).toMatch(/Garage du Port/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-production-echeances.png') });

    // ── La ligne ouvre la comptabilité du client ────────────────────────────────────────────────
    await p.locator('.sidebar nav a[data-route="production"]').click();
    await expect.poll(() => ligne('Garage du Port').count()).toBe(1);
    await ligne('Garage du Port').locator('td').first().click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${garage}/comptabilite`);

    // ── La visite « Suivre la production du cabinet » ───────────────────────────────────────────
    await p.goto('about:blank');
    await aller('#/guide');
    const visite = p.locator('li.g-ligne, .g-carte').filter({ hasText: 'Suivre la production du cabinet' });
    await expect.poll(() => visite.count()).toBe(1);
    // Son bouton la lance (un dossier a son livre : rien ne manque).
    const lancer = visite.locator('button[data-visite="suivre-production"]');
    expect(await lancer.isEnabled()).toBe(true);
    await lancer.click();
    const bulle = p.locator('#visite-bulle');
    await expect.poll(() => bulle.innerText()).toMatch(/Ce qui attend/);
    expect(await bulle.innerText()).not.toMatch(/paquet|reçu/);
    for (const titre of [/Un dossier par ligne/, /Resserrer/, /Ouvre un dossier/]) {
      await bulle.getByRole('button', { name: 'Suivant' }).click();
      await expect.poll(() => bulle.innerText()).toMatch(titre);
    }
    await ligne('Garage du Port').locator('td').first().click();
    await expect.poll(() => bulle.innerText()).toMatch(/Tu suis la production/);
    expect(await bulle.innerText()).toMatch(/Le tableau lit les livres\s:\sun dossier apparaît dès que sa comptabilité a des écritures/);
    expect(await bulle.innerText()).not.toMatch(/paquet|reçu/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-production-2-visite.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
