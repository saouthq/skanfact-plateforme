// « Sécurité » du service, à la souris (Console 3e ; docs/console.md C26 ; serveur/console/securite.ts ;
// web/console/src/ecrans/Securite.tsx). Les défis et les attentes se posent dans la base comme les règles de connexion
// les écrivent. Ce que le parcours vérifie :
//   - l'onglet allumé, les quatre chiffres ;
//   - un mot de passe connu (des codes faux après lui) passe avant un compte freiné, et se dit « à regarder d'abord » ;
//   - lever l'attente : un motif trop court se refuse, et le bouton ne bouge pas sous le curseur quand on retape ; levée,
//     la ligne s'en va et le geste entre au journal ;
//   - les règles disent leurs chiffres et ce qu'elles ne comptent pas ; les clés de commande, leur nom seul ;
//   - au téléphone : rien ne déborde, l'équipe se lit sans défilement de côté.

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

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

type Membre = { email: string; secret: string; id: string };

describe('la sécurité du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-securite-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-securite-veille-')), 'veille.json');
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
  const jetonConsole = async (m: Membre) => {
    const r = await api('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(m.secret), Date.now()) });
    return String(c.corps.jeton);
  };
  const ouvrir = async (jeton: string, largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/#/service/securite`);
    await expect.poll(() => p.locator('.c-se-regles-liste > li').count(), { timeout: 20_000 }).toBe(6);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  // Les lignes de CE parcours : les tables sont partagées avec d'autres tests.
  const regards = (p: Page) => p.locator('.c-se-regard').filter({ hasText: 'Sécurité Essai' });

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-securite-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai de la sécurité à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    jD = await jetonConsole({ email, secret, id });
    // Un client : quatre codes faux après un mot de passe bon (pas abouti) ; un autre, freiné par sept mots de passe faux.
    const connu = `securite-connu-${Date.now()}@exemple.tn`, freine = `securite-freine-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: connu, nom: 'Sécurité Essai Connu', motDePasse: MDP });
    await api('POST', '/inscription', undefined, { email: freine, nom: 'Sécurité Essai Freiné', motDePasse: MDP });
    const idConnu = String((await admin.query('select id from socle.utilisateur where email = $1', [connu])).rows[0]?.id);
    await admin.query(`insert into socle.defi_connexion (utilisateur, methode, cree_le, expire_le, erreurs) values ($1, 'sms', now(), now() + interval '10 minutes', 4)`, [idConnu]);
    await admin.query(`insert into socle.tentative (cle, erreurs, attente_jusqu_au, derniere) values ($1, 7, now() + interval '15 minutes', now())`, [freine]);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'onglet allumé, les quatre chiffres ; un mot de passe connu passe avant un compte freiné', async () => {
    const p = await ouvrir(jD);
    expect(net(await p.locator('.c-sv-onglets [aria-current="page"]').innerText())).toBe('Sécurité');
    expect(await p.locator('.c-tr-tuiles .c-sv-tuile').count()).toBe(4);
    await expect.poll(() => regards(p).count()).toBe(2);
    const premier = net(await regards(p).first().innerText());
    expect(premier).toContain('Sécurité Essai Connu');
    expect(premier).toMatch(/À regarder d.abord/);
    expect(premier).toMatch(/4 codes faux/);
    expect(net(await regards(p).last().innerText())).toMatch(/7 mots de passe faux/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('lever l\'attente : un motif court se refuse, le bouton ne bouge pas quand on retape ; levée, la ligne s\'en va', async () => {
    const p = await ouvrir(jD);
    await cliquer(regards(p).last().getByRole('button', { name: /Lever l.attente/ }));
    const f = p.locator('[role="dialog"]');
    await f.locator('textarea').fill('ok');
    const bouton = f.getByRole('button', { name: 'Lever l\'attente', exact: true });
    await cliquer(bouton);
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    const avant = await bouton.boundingBox();
    await f.locator('textarea').pressSequentially(' : elle a appelé');
    const apres = await bouton.boundingBox();
    expect(apres?.y).toBe(avant?.y);
    await cliquer(bouton);
    await expect.poll(() => regards(p).count()).toBe(1);
    expect(net(await regards(p).innerText())).toContain('Connu');
    const g = (await admin.query("select motif from plateforme.geste_console where geste = 'service.lever_attente' order by le desc limit 1")).rows[0];
    expect(g?.motif).toBe('ok : elle a appelé');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('les règles disent leurs chiffres et ce qu\'elles ne comptent pas ; les clés de commande, leur nom seul', async () => {
    const p = await ouvrir(jD);
    const regles = net(await p.locator('.c-se-regles').innerText());
    expect(regles).toMatch(/Après 5 erreurs sur un compte : attendre 1 minute, puis 5, puis 15, puis 60/);
    expect(regles).toContain('pas compté');
    expect(await p.locator('.c-se-cles-liste > li').count()).toBeGreaterThan(0);
    expect(net(await p.locator('.c-se-cles').innerText())).not.toMatch(/PUBLIC KEY/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('la chaîne d\'empreintes : relue par le serveur au démarrage, trente jours en cases ; ce qui n\'est pas encore relu le dit', async () => {
    const p = await ouvrir(jD);
    const carte = p.locator('.c-se-chaine');
    // Le serveur relit les chaînes à son démarrage : l'écran le dit (au besoin, après une relecture de la page).
    await expect.poll(async () => { await p.reload(); await carte.waitFor(); return net(await carte.innerText()); }, { timeout: 30_000 }).not.toMatch(/Pas encore relue/);
    const texte = net(await carte.innerText());
    expect(texte).toMatch(/Dernière relecture/i);
    expect(texte).toMatch(/le serveur relit 200 chaînes chaque heure/i);
    // Ce qui est relu, et ce qui ne l'est pas encore : jamais « tout va bien » sur ce qu'on ne mesure pas.
    expect(texte).toContain('Pas encore mesuré');
    expect(texte).toMatch(/le contenu de chaque pièce, recomparé à son empreinte/i);
    expect(await carte.locator('.c-se-jour').count()).toBe(30);
    expect(await carte.locator('.c-se-jour.c-ton-nonmesure').count()).toBeLessThan(30);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : rien ne déborde, l\'équipe se lit sans défilement de côté', async () => {
    const p = await ouvrir(jD, 390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await p.locator('.c-se-table').evaluate((t) => t.scrollWidth - (t.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(0);
    expect(await p.locator('.c-se-table thead').isVisible()).toBe(false);
    const petites = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a')]
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.className} « ${e.innerText.trim().slice(0, 30)} » ${Math.round(e.getBoundingClientRect().height)}`));
    expect(petites).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
