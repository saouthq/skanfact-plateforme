// « Versions » du service, à la souris (Console 3e ; docs/console.md C27 ; serveur/console/versions.ts ;
// web/console/src/ecrans/Versions.tsx). L'état du suiveur s'écrit à côté de la veille, comme le suiveur l'écrit. Ce que
// le parcours vérifie :
//   - l'onglet allumé, les quatre chiffres, chaque version nommée par son numéro (« v1.1.0 »), l'identifiant au survol ;
//   - revenir à la version d'avant : un motif trop court se refuse, le bouton ne bouge pas quand on retape ; fait, la
//     consigne se lit, et la version quittée ne se propose plus pour un retour ;
//   - geler puis lever le gel, chacun avec son motif ;
//   - l'écran et ses fenêtres, un retour demandé et un gel levé dans les consignes, mesurés par l'instrument de la
//     console (en clair et en sombre, à l'ordinateur et au téléphone, et en langue factice) ;
//   - une fenêtre où l'on a tapé demande avant de jeter la saisie (Échap, la croix, « Annuler ») ;
//   - au téléphone : rien ne déborde, l'historique se lit sans défilement de côté.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const sha = (c: string) => c.repeat(40).slice(0, 40);
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(sha) as [string, string, string, string];

describe('les versions du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-versions-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-versions-veille-')), 'veille.json');
  const etat = path.join(path.dirname(veille), 'public', 'etat.json');
  const erreurs: string[] = [];
  let jD = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const ouvrir = async (largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jD);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/#/service/versions`);
    await expect.poll(() => p.locator('.c-ve-historique tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  // Un écran de l'instrument : à une largeur, un thème et une langue ; lu quand son historique est là.
  const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
    const cx = await navigateur.newContext({ viewport: { width: o.largeur, height: o.largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jD, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${e.hash}`);
    await expect.poll(() => p.locator('.c-ve-historique tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();

  beforeAll(async () => {
    await admin.connect();
    await admin.query('delete from plateforme.service_consigne');
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    fs.mkdirSync(path.dirname(etat), { recursive: true });
    // C en service (1.0.1), B avant elle (1.0.0), D la prochaine (1.1.0), A d'avant la numérotation.
    fs.writeFileSync(etat, JSON.stringify({
      version: C, installeeLe: t(60), regardeLe: t(1), derniere: D, verification: 'toutes', echec: null, taches: [],
      commits: [{ version: D, titre: 'La remise des avoirs', le: t(10), verification: 'vert', preuves: 'en_cours' },
        { version: C, titre: 'La sécurité du service', le: t(70) }, { version: B, titre: 'Les travaux du service', le: t(300) },
        { version: A, titre: 'Les incidents du service', le: t(900) }],
      installations: [{ version: C, debut: t(62), fin: t(60), ok: true, etape: null, retour: false },
        { version: B, debut: t(302), fin: t(300), ok: true, etape: null, retour: false },
        { version: A, debut: t(902), fin: t(900), ok: true, etape: null, retour: false }],
      consignes: null, numeros: { [B]: '1.0.0', [C]: '1.0.1', [D]: '1.1.0' },
    }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-versions-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai des versions à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jD = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
  }, 180_000);
  afterAll(async () => {
    await admin.query('delete from plateforme.service_consigne');
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'onglet allumé, les quatre chiffres ; chaque version se nomme par son numéro, son identifiant au survol', async () => {
    const p = await ouvrir();
    expect(net(await p.locator('.c-sv-onglets [aria-current="page"]').innerText())).toBe('Versions');
    expect(await p.locator('.c-tr-tuiles .c-sv-tuile').count()).toBe(4);
    const service = p.locator('.c-ve-service .c-ve-titre-version b');
    expect(net(await service.innerText())).toBe('v1.0.1');
    expect(await service.getAttribute('title')).toBe(C);
    expect(net(await p.locator('.c-ve-prochaine .c-ve-titre-version b').innerText())).toBe('v1.1.0');
    // Une version d'avant la numérotation se dit par son identifiant court.
    expect(net(await p.locator('.c-ve-historique tbody').innerText())).toContain(A.slice(0, 7));
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('l\'effet de chaque version (0140, C64) : une ligne par version qui a tourné ; celle qui a eu bien plus de pannes et un incident majeur le dit, en orange', async () => {
    // A a tourné de quinze à cinq heures avant : une panne sur mille. B, de cinq heures à une heure avant : presque toutes ses
    // requêtes en panne, et un incident majeur ouvert pendant. (D'autres essais écrivent leurs mesures dans les mêmes heures :
    // la ligne ne se lit pas au chiffre près, mais ce qu'elle juge, si.)
    const heureIlYa = (h: number) => new Date(Math.floor((Date.now() - h * 3_600_000) / 3_600_000) * 3_600_000).toISOString();
    const seaux = Array.from({ length: 47 }, (_, i) => (i === 12 ? 2000 : 0));
    for (const [h, pannes] of [[10, 2], [3, 1900]] as const) {
      await admin.query(`insert into plateforme.service_heure (heure, exemplaire, sorte, n, pannes, seaux) values ($1, 'effet-web', 'lecture', 2000, $2, $3)
        on conflict (heure, exemplaire, sorte) do update set n = 2000, pannes = $2`, [heureIlYa(h), pannes, seaux]);
    }
    const qui = (await admin.query('select id from socle.utilisateur where email like $1 order by cree_le desc limit 1', ['console-versions-%'])).rows[0].id;
    // Deux autres fichiers d'essai vident les incidents en même temps (console-incidents, console) : on repose le nôtre et on
    // rouvre l'écran tant qu'il n'y est pas, sans jamais desserrer ce que la ligne doit dire.
    const attendu = /v1\.0\.0 .*Du \d\d\/\d\d\/\d{4} au \d\d\/\d\d\/\d{4}.*Majeur 2026-978 · Des factures qui ne partent plus.*Plus de pannes.*Un incident majeur/;
    let p = await ouvrir();
    let lu = '';
    for (let essai = 0; essai < 5; essai += 1) {
      await admin.query(`insert into plateforme.service_incident (annee, numero, titre, gravite, ouvert_le, ouvert_par) values (2026, 978, 'Des factures qui ne partent plus', 'majeur', $1, $2)
        on conflict do nothing`, [new Date(Date.now() - 2 * 3_600_000).toISOString(), qui]);
      if (essai > 0) { await fermer(p); p = await ouvrir(); }
      await expect.poll(() => p.locator('.c-ve-effets tbody tr').count(), { timeout: 15_000 }).toBe(3);
      lu = net(await p.locator(`.c-ve-effets tbody tr[data-version="${B}"]`).innerText());
      if (attendu.test(lu)) break;
    }
    expect(lu).toMatch(attendu);
    const carte = p.locator('.c-ve-effets');
    // La plus ancienne n'a rien à quoi se comparer ; celle en service se dit « depuis ».
    expect(net(await carte.locator(`tbody tr[data-version="${A}"]`).innerText())).toContain('La plus ancienne mesurée : rien à comparer');
    expect(net(await carte.locator(`tbody tr[data-version="${C}"]`).innerText())).toMatch(/En service depuis le \d\d\/\d\d\/\d{4}/);
    // À l'ordinateur, ses sept colonnes tiennent dans la carte : rien ne se coupe à droite.
    expect(await carte.locator('table').evaluate((t) => t.scrollWidth - (t.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(0);
    // La direction lit la colonne des demandes au support.
    expect((await carte.locator('thead th').allTextContents()).map(net)).toContain('Demandes au support');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('revenir à la version d\'avant : un motif court se refuse, le bouton ne bouge pas ; fait, la consigne se lit', async () => {
    const p = await ouvrir();
    await cliquer(p.locator('.c-ve-service').getByRole('button', { name: /Revenir à v1\.0\.0/ }));
    const f = p.locator('[role="dialog"]');
    expect(net(await f.locator('h2, h1').first().innerText())).toBe('Revenir à v1.0.0');
    await f.locator('textarea').fill('ok');
    const bouton = f.getByRole('button', { name: 'Revenir à v1.0.0', exact: true });
    await cliquer(bouton);
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    const avant = await bouton.boundingBox();
    await f.locator('textarea').pressSequentially(' : la remise se trompe');
    expect((await bouton.boundingBox())?.y).toBe(avant?.y);
    await cliquer(bouton);
    await expect.poll(async () => net(await p.locator('.c-ve-consignes').innerText())).toContain('Retour à v1.0.0, en quittant v1.0.1');
    // La version quittée (retenue) ne se propose plus pour un retour.
    expect(await p.locator('.c-ve-historique').getByRole('button', { name: /Y revenir/ }).count()).toBe(0);
    const g = (await admin.query("select motif from plateforme.geste_console where geste = 'versions.revenir' order by le desc limit 1")).rows[0];
    expect(g?.motif).toBe('ok : la remise se trompe');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('geler les installations, puis lever le gel : chacun avec son motif', async () => {
    const p = await ouvrir();
    await cliquer(p.locator('.c-ve-prochaine').getByRole('button', { name: /Geler les installations/ }));
    const f = p.locator('[role="dialog"]');
    await f.locator('textarea').fill('les déclarations du mois');
    await cliquer(f.getByRole('button', { name: /^Geler jusqu/ }));
    await expect.poll(async () => net(await p.locator('main').innerText())).toMatch(/Les installations sont gelées jusqu.au .*« les déclarations du mois »/);
    await cliquer(p.getByRole('button', { name: /Lever le gel/ }).first());
    await f.locator('textarea').fill('elles sont parties');
    await cliquer(f.getByRole('button', { name: 'Lever le gel', exact: true }));
    await expect.poll(async () => net(await p.locator('main').innerText())).not.toMatch(/Les installations sont gelées/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('un retour demandé, un gel levé : en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    // Chaque geste trouve son bouton par la structure de l'écran : en langue factice, son texte change.
    const fen = async (p: Page) => { await p.getByRole('dialog').waitFor(); };
    const H = '#/service/versions';
    const ECRANS: EcranConsole[] = [
      { nom: 'versions-consignes', hash: H },
      { nom: 'version-geler', hash: H, geste: async (p) => { await cliquer(p.locator('.c-ve-prochaine .c-ve-geste button').last()); await fen(p); } },
      { nom: 'version-lever', hash: H, geste: async (p) => { await cliquer(p.locator('.c-ve-consignes .c-ve-geste button').first()); await fen(p); } },
    ];
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4);
    expect(erreurs).toEqual([]);
  }, 300_000);

  it('une fenêtre où l\'on a tapé demande avant de jeter la saisie ; sans rien taper, elle se ferme tout de suite', async () => {
    const p = await ouvrir();
    const f = p.locator('[role="dialog"]');
    const ouvrirGel = () => cliquer(p.locator('.c-ve-prochaine').getByRole('button', { name: /Geler les installations/ }));
    // Rien de tapé (la durée se CHOISIT dans une liste) : Échap ferme sans question.
    await ouvrirGel();
    await f.locator('select').selectOption({ index: 0 });
    await p.keyboard.press('Escape');
    await expect.poll(() => f.count()).toBe(0);
    // Un motif tapé : Échap demande ; Échap encore, ou « Reprendre la saisie », rend la saisie intacte.
    await ouvrirGel();
    await f.locator('textarea').pressSequentially('la paie du mois');
    await p.keyboard.press('Escape');
    await expect.poll(() => f.locator('.c-dialogue-question').count()).toBe(1);
    expect(net(await f.locator('.c-dialogue-question').innerText())).toMatch(/^Abandonner cette saisie \? Ce que tu viens de taper/);
    // Le curseur est sur « Reprendre » : Entrée ne jette rien par réflexe.
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Reprendre la saisie');
    await p.keyboard.press('Escape');
    await expect.poll(() => f.locator('.c-dialogue-question').count()).toBe(0);
    expect(await f.locator('textarea').inputValue()).toBe('la paie du mois');
    // « Annuler » passe par la même garde ; « Abandonner » referme pour de bon, sans geste ni consigne.
    await cliquer(f.getByRole('button', { name: 'Ne pas geler', exact: true }));
    await expect.poll(() => f.locator('.c-dialogue-question').count()).toBe(1);
    await cliquer(f.getByRole('button', { name: 'Abandonner', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
    expect((await admin.query("select count(*)::int n from plateforme.service_consigne where motif = 'la paie du mois'")).rows[0]?.n).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : rien ne déborde, l\'historique se lit sans défilement de côté', async () => {
    const p = await ouvrir(390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // L'historique et l'effet de chaque version : deux tableaux qui se lisent en blocs, sans défilement de côté.
    for (const t of await p.locator('.c-ve-table').all()) {
      expect(await t.evaluate((x) => x.scrollWidth - (x.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(0);
      expect(await t.locator('thead').isVisible()).toBe(false);
    }
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
  it('l\'audit C04 : le dernier tour n\'a pas pu lire les consignes — l\'écran le dit, et la prochaine attend', async () => {
    const avant = fs.readFileSync(etat, 'utf8');
    const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const e = JSON.parse(avant) as Record<string, unknown> & { commits: Record<string, unknown>[] };
    // La prochaine a toutes ses preuves : sans la panne de lecture, elle serait prête.
    fs.writeFileSync(etat, JSON.stringify({ ...e, commits: e.commits.map((c) => (c.version === D ? { ...c, preuves: 'vert' } : c)),
      consignes: { lues: t(30), gel: null, retenues: [], retour: null }, consignesIllisibles: t(1) }));
    try {
      const p = await ouvrir();
      await expect.poll(async () => net(await p.locator('.c-ve-consignes .c-alerte').innerText().catch(() => '')), { timeout: 10_000 })
        .toMatch(/^Le suiveur n'a pas pu les lire à \d\d:\d\d, à son dernier tour : il n'installe rien tant qu'il ne les relit pas\. Les dernières lues, à \d\d:\d\d, restent ci-dessous\.$/);
      expect(net(await p.locator('.c-ve-prochaine').innerText())).toContain('Prête, mais le suiveur n\'a pas pu lire les consignes à son dernier tour');
      expect(erreurs).toEqual([]);
      await fermer(p);
    } finally { fs.writeFileSync(etat, avant); }
  }, 60_000);
});
