// Ton compte, à la souris (1.24.0 ; docs/console.md C40 ; web/console/src/ecrans/TonCompte.tsx ; base 0117).
// Ce que le parcours vérifie :
//   - le support qui ouvre « Équipe » arrive sur SON compte (l'équipe et ses rôles restent à la direction) : ses faits,
//     ses appareils dans la page, ce que son rôle ouvre ;
//   - changer de code, de bout en bout : sans le code actuel, le champ se montre ; le code QR et la clé ; un code faux
//     ne change rien ; le bon montre les dix codes de secours, puis le journal le garde ;
//   - un mot de passe actuel faux se refuse sur son champ ;
//   - la direction passe de l'équipe à son compte et revient ;
//   - en clair et en sombre, à l'ordinateur et au téléphone, l'instrument de la console ne trouve rien.

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
const totp = (secret: string) => codeTotp(depuisBase32(secret), Date.now());

describe('ton compte, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-compte-'));
  const erreurs: string[] = [];
  let direction = { jeton: '', email: '', secret: '' };
  let support = { jeton: '', email: '', secret: '' };

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (prenom: string, role: 'direction' | 'support') => {
    const email = `console-compte-${prenom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `${prenom === 'olfa' ? 'Olfa' : 'Zied'} Moncompte`, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de Ton compte à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return { jeton: String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret) })).corps.jeton), email, secret };
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
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/equipe'}`);
    return p;
  };
  const fermer = (p: Page) => p.context().close();

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    direction = await membre('olfa', 'direction');
    support = await membre('zied', 'support');
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('le support qui ouvre « Équipe » arrive sur son compte : ses faits, ses appareils dans la page, ce que son rôle ouvre', async () => {
    // Quatre autres appareils ont ouvert sa console avant celui-ci (chaque connexion sans appareil reconnu en est un).
    for (let i = 0; i < 4; i++) {
      const r = await api('POST', '/console/connexion', undefined, { email: support.email, motDePasse: MDP, appareil: { nom: `Ancien ${i}`, type: 'navigateur' } });
      await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(support.secret) });
    }
    const r = await api('POST', '/console/connexion', undefined, { email: support.email, motDePasse: MDP, appareil: { nom: 'Celui-ci', type: 'navigateur' } });
    support.jeton = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(support.secret) })).corps.jeton);
    const p = await ouvrirAvec(support.jeton, { hash: '#/' });
    await cliquer(p.locator('nav a[href="#/equipe"]'));
    await p.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('h1').innerText())).toBe('Ton compte');
    // Les faits se lisent par leur nom, pas par leur rang.
    const fait = async (nom: string) => net(await p.locator('.c-cp-faits > div', { has: p.locator('dt', { hasText: nom }) }).locator('dd').innerText());
    expect(await fait('Ton rôle')).toBe('Support · donné par la direction');
    expect(await fait('Ton code')).toBe('Une application d\'authentification');
    expect(await fait('Codes de secours')).toBe('10 sur 10');
    expect(await fait('Mot de passe')).toMatch(/^Jamais changé · posé /);
    // Ses appareils, dans la page : celui de cette session-ci d'abord ; trois au plus, les autres s'ouvrent d'un clic.
    expect(net(await p.locator('.c-cp-appareils .c-eq-appareils > li').first().innerText())).toMatch(/Cette session-ci/);
    expect(await p.locator('.c-cp-appareils .c-eq-appareils > li').count()).toBe(3);
    await cliquer(p.getByRole('button', { name: 'Voir les 3 autres appareils' }));
    expect(await p.locator('.c-cp-appareils .c-eq-appareils > li').count()).toBe(6);
    // Ce que son rôle ouvre : le support, pas la mesure ni l'équipe.
    const role = net(await p.locator('.c-cp-role').innerText());
    expect(role).toMatch(/Les demandes de support/);
    expect(role).not.toMatch(/Voir la mesure/);
    // Aucun lien vers l'équipe : elle est à la direction.
    expect(await p.locator('a[href="#/equipe"]', { hasText: 'L\'équipe' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('changer de code : sans le code actuel, son champ ; le code QR ; un faux ne change rien ; le bon montre les codes de secours, et le journal le garde', async () => {
    const p = await ouvrirAvec(support.jeton);
    await p.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
    await cliquer(p.getByRole('button', { name: 'Changer de code…' }));
    const fenetre = p.getByRole('dialog');
    await cliquer(fenetre.getByRole('radio', { name: 'Une application' }));
    await cliquer(fenetre.getByRole('button', { name: 'Continuer' }));
    await expect.poll(async () => fenetre.getByLabel('Ton code actuel').getAttribute('aria-invalid')).toBe('true');
    expect(net(await fenetre.locator('.c-alerte').innerText())).toMatch(/code que donne ton téléphone actuel/);
    await fenetre.getByLabel('Ton code actuel').fill(totp(support.secret));
    await cliquer(fenetre.getByRole('button', { name: 'Continuer' }));
    await fenetre.locator('.c-cp-qr-image svg').waitFor({ timeout: 20_000 });
    const cle = (await fenetre.locator('.c-cp-cle').innerText()).replace(/\s/g, '');
    expect(cle).toMatch(/^[A-Z2-7]{16,}$/);
    await fenetre.getByLabel('Le code que donne l\'application').fill('000000');
    await cliquer(fenetre.getByRole('button', { name: 'Activer ce code' }));
    await expect.poll(async () => fenetre.getByLabel('Le code que donne l\'application').getAttribute('aria-invalid')).toBe('true');
    expect(await admin.query(`select 1 from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where u.email = $1 and g.geste = 'equipe.mon_code'`, [support.email]).then((r) => r.rowCount)).toBe(0);
    await fenetre.getByLabel('Le code que donne l\'application').fill(totp(cle));
    await cliquer(fenetre.getByRole('button', { name: 'Activer ce code' }));
    await fenetre.locator('.c-cp-secours li').first().waitFor({ timeout: 20_000 });
    expect(await fenetre.locator('.c-cp-secours li').count()).toBe(10);
    await cliquer(fenetre.getByRole('button', { name: 'Je les ai notés' }));
    await expect.poll(async () => p.getByRole('dialog').count()).toBe(0);
    // Le geste se lit dans « Tes gestes, les plus récents », et le journal le garde.
    await expect.poll(async () => net(await p.locator('.c-cp-recents').innerText())).toMatch(/Son code changé/);
    expect(await admin.query(`select 1 from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where u.email = $1 and g.geste = 'equipe.mon_code'`, [support.email]).then((r) => r.rowCount)).toBe(1);
    support.secret = cle;
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('un mot de passe actuel faux se refuse sur son champ ; rien n\'est changé', async () => {
    const p = await ouvrirAvec(support.jeton);
    await p.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
    await cliquer(p.getByRole('button', { name: 'Changer mon mot de passe…' }));
    const fenetre = p.getByRole('dialog');
    await fenetre.getByLabel('Ton mot de passe actuel').fill('pas-le-bon-mot');
    await fenetre.getByLabel('Le nouveau').fill('Un-autre-bon-mot-de-passe');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(async () => fenetre.getByLabel('Ton mot de passe actuel').getAttribute('aria-invalid')).toBe('true');
    expect(await fenetre.getByLabel('Le nouveau').getAttribute('aria-invalid')).toBeNull();
    expect((await api('POST', '/console/connexion', undefined, { email: support.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } })).statut).toBe(200);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('la direction passe de l\'équipe à son compte, et revient', async () => {
    const p = await ouvrirAvec(direction.jeton);
    await p.locator('h1', { hasText: 'L\'équipe' }).waitFor({ timeout: 20_000 });
    await cliquer(p.locator('a[href="#/equipe?vue=moi"]'));
    await p.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('h1').innerText())).toBe('Ton compte');
    expect(net(await p.locator('.c-cp-role').innerText())).toMatch(/Voir la mesure/);
    await cliquer(p.locator('.c-entete-actions a[href="#/equipe"]'));
    await p.locator('h1', { hasText: 'L\'équipe' }).waitFor({ timeout: 20_000 });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone, rien ne déborde ; en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    const t = await ouvrirAvec(support.jeton, { largeur: 390 });
    await t.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
    expect(await t.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await fermer(t);
    const ECRANS: EcranConsole[] = [{ nom: 'ton-compte', hash: '#/equipe' }];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
      const p = await ouvrirAvec(support.jeton, { ...o, hash: e.hash });
      await p.locator('.c-cp-toi').waitFor({ timeout: 20_000 });
      return p;
    };
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: ECRANS, photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBeGreaterThanOrEqual(4);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
