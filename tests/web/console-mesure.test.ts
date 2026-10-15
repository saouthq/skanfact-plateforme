// La mesure, à la souris (1.23.0 ; docs/console.md C39 ; serveur/console/mesure.ts ; web/console/src/ecrans/Mesure.tsx).
// Ce que le parcours vérifie :
//   - l'entrée « Mesure » sous « La plateforme », pour la direction ; le support ne la voit pas ;
//   - les chiffres que la base sait (l'entonnoir, les inscriptions, les départs, les offres, ce qu'on promet), et la
//     période qui change les inscriptions ;
//   - ce qui ne se mesure pas encore le dit, jamais un zéro : les écrans, les parcours, les refus, le motif d'un départ,
//     la satisfaction, l'accord ; la liste des événements, « à décider » ;
//   - en clair et en sombre, à l'ordinateur et au téléphone, et en langue factice, l'instrument de la console ne trouve
//     rien ; au téléphone, rien ne déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('la mesure, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-mesure-'));
  const erreurs: string[] = [];
  let jD = '', jS = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (prenom: string, role: 'direction' | 'support') => {
    const email = `console-mesure-${prenom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `${prenom === 'amira' ? 'Dorra' : 'Sami'} Mesure`, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de la mesure à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
  };
  const ouvrirAvec = async (jeton: string, o: { largeur?: number; theme?: 'clair' | 'sombre'; factice?: boolean; hash?: string } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/mesure'}`);
    return p;
  };
  const ouvrir = async (o: { largeur?: number } = {}) => {
    const p = await ouvrirAvec(jD, o);
    await p.locator('.c-me-bandeau').waitFor({ timeout: 20_000 });
    return p;
  };
  const fermer = (p: Page) => p.context().close();

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    jD = await membre('amira', 'direction');
    jS = await membre('karim', 'support');
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('la direction l\'ouvre depuis « La plateforme » ; le support ne la voit pas', async () => {
    const p = await ouvrirAvec(jD, { hash: '#/' });
    await cliquer(p.locator('nav a[href="#/mesure"]'));
    await p.locator('.c-me-bandeau').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('h1').innerText())).toBe('La mesure');
    await fermer(p);
    const s = await ouvrirAvec(jS, { hash: '#/' });
    await s.locator('nav a[href="#/support"]').waitFor({ timeout: 20_000 });
    expect(await s.locator('nav a[href="#/mesure"]').count()).toBe(0);
    await fermer(s);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('les chiffres que la base sait ; la période change les inscriptions ; ce qui ne se mesure pas encore le dit', async () => {
    const p = await ouvrir();
    const inscriptions = p.locator('.c-me-inscriptions');
    expect(net(await inscriptions.innerText())).toMatch(/\d+ cette semaine/);
    expect(net(await inscriptions.innerText())).toMatch(/\d+ la semaine dernière/);
    // La période se demande au serveur (les inscriptions se recomptent), pas seulement son nom à l'écran.
    const demande = p.waitForRequest((r) => r.url().includes('/console/mesure?periode=mois'));
    await cliquer(p.getByRole('button', { name: 'Ce mois-ci' }));
    await demande;
    await expect.poll(async () => net(await inscriptions.innerText())).toMatch(/\d+ ce mois-ci/);
    expect(net(await inscriptions.innerText())).toMatch(/\d+ le mois dernier/);
    expect(await p.getByRole('button', { name: 'Ce mois-ci' }).getAttribute('aria-pressed')).toBe('true');
    // Ce qui ne se mesure pas encore : six fois « Pas encore mesuré » (les écrans, les parcours, les refus, le motif d'un
    // départ, la satisfaction, l'accord), et la liste des événements « à décider ».
    expect(await p.locator('.c-puce', { hasText: 'Pas encore mesuré' }).count()).toBe(6);
    expect(net(await p.locator('.c-me-liste').innerText())).toMatch(/à décider avant la première mesure/i);
    expect(await p.locator('.c-me-evenements li').count()).toBe(14);
    // Par offre, trois cases ; ce qu'on promet, « Proposé » deux fois.
    expect(await p.locator('.c-me-offre').count()).toBe(3);
    expect(await p.locator('#me-promesses ~ * .c-puce, .c-me-promesse .c-puce', { hasText: 'Proposé' }).count()).toBe(2);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : rien ne déborde ; les trois périodes tiennent sur une ligne', async () => {
    const p = await ouvrir({ largeur: 390 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const hauts = await p.locator('.c-me-periodes .c-pilule').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(hauts).size).toBe(1);
    await fermer(p);
  }, 60_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    const ECRANS: EcranConsole[] = [{ nom: 'mesure', hash: '#/mesure' }];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
      const p = await ouvrirAvec(jD, { ...o, hash: e.hash });
      await p.locator('.c-me-bandeau').waitFor({ timeout: 20_000 });
      return p;
    };
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: ECRANS, photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBeGreaterThanOrEqual(4);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
