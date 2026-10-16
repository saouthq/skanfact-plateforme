// L'accès d'urgence, à la souris (1.43.0 ; docs/console.md C59 ; web/console/src/ecrans/Equipe.tsx, Entree.tsx,
// Accueil.tsx ; base 0135). Ce que le parcours vérifie :
//   - la direction ouvre un accès pour un membre, depuis le menu de sa ligne : la fenêtre dit ce qui va se passer ;
//     l'accès attend dans « À régler », sur sa ligne et à l'accueil ; « Retirer » l'éteint ;
//   - le membre entre avec son mot de passe et pose son NOUVEAU code (l'écran le dit) ; l'ancien ne vaut plus ;
//   - en clair et en sombre, à l'ordinateur et au téléphone, l'instrument ne trouve rien (l'équipe avec un accès qui
//     attend, la pose du nouveau code) ; en langue factice, tout vient du catalogue.

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
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('l\'accès d\'urgence, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-urgence-'));
  const erreurs: string[] = [];
  let direction = '';
  let n = 0;
  const adresse = (qui: string) => `console-urgence-${qui}-${Date.now()}-${++n}@exemple.tn`;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Un membre de l'équipe avec son code en place (une application) : son adresse, son nom, son identifiant, son secret.
  const membre = async (nom: string, role: 'direction' | 'support' | 'technique') => {
    const email = adresse(nom.split(' ')[0]?.toLowerCase() ?? 'x');
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de l\'accès d\'urgence à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
    return { email, nom, id, secret };
  };
  const ouvrirAvec = async (jeton: string | null, o: { largeur?: number; theme?: 'clair' | 'sombre'; factice?: boolean; hash?: string } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      if (j) sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/equipe'}`);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const menuDe = async (p: Page, nom: string) => {
    await cliquer(p.locator('tr', { hasText: nom }).getByRole('button', { name: new RegExp(echapper(nom)) }).last());
  };

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const d = await membre('Hela Urgence', 'direction');
    const r = await api('POST', '/console/connexion', undefined, { email: d.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    direction = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(d.secret) })).corps.jeton);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('la direction ouvre un accès : la fenêtre dit ce qui va ; il attend dans « À régler », sur sa ligne et à l\'accueil ; le retirer l\'éteint', async () => {
    const m = await membre('Sami Perdu', 'support');
    const p = await ouvrirAvec(direction);
    await p.locator('h1', { hasText: 'L\'équipe' }).waitFor({ timeout: 20_000 });
    await menuDe(p, m.nom);
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Ouvrir un accès d\'urgence' }));
    const f = p.getByRole('dialog');
    expect(net(await f.locator('h2').first().innerText())).toBe(`Un accès d'urgence pour ${m.nom}`);
    expect(await f.locator('.c-al-ce-qui-va li').count()).toBe(4);
    expect(net(await f.locator('.c-al-ce-qui-va').innerText())).toContain('Ses sessions de la console se ferment tout de suite');
    // Sans motif, rien ne part ; le champ le dit.
    await cliquer(f.getByRole('button', { name: 'Ouvrir l\'accès d\'urgence' }));
    await expect.poll(() => f.getByLabel('Motif', { exact: true }).getAttribute('aria-invalid')).toBe('true');
    expect((await admin.query('select count(*)::int n from plateforme.acces_urgence where membre = $1', [m.id])).rows[0].n).toBe(0);
    await f.getByLabel('Motif', { exact: true }).fill('Téléphone perdu, rappelé à son numéro habituel');
    await cliquer(f.getByRole('button', { name: 'Ouvrir l\'accès d\'urgence' }));
    await p.locator('.c-eq-regler', { hasText: `Un accès d'urgence attend ${m.nom}` }).waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.c-eq-regler li', { hasText: m.nom }).innerText())).toMatch(/^Un accès d'urgence attend Sami Perdu Ouvert par Hela Urgence le .+, il vaut jusqu'au .+ : à sa prochaine connexion, il pose un nouveau code\. Retirer…$/);
    expect(net(await p.locator('tr', { hasText: m.nom }).innerText())).toContain('accès d\'urgence ouvert');
    // L'accueil de la direction le dit, et mène à l'équipe.
    await p.goto(`${serveur.adresse}/console/#/`);
    const ligne = p.locator('.c-ligne-decision', { hasText: `Un accès d'urgence attend ${m.nom}` });
    await ligne.waitFor({ timeout: 20_000 });
    await cliquer(ligne.getByRole('link', { name: 'Ouvrir l\'équipe' }));
    await p.locator('h1', { hasText: 'L\'équipe' }).waitFor({ timeout: 20_000 });
    // Le retirer, depuis « À régler » : la fenêtre dit que rien ne change pour lui.
    await cliquer(p.locator('.c-eq-regler li', { hasText: m.nom }).getByRole('button', { name: 'Retirer…' }));
    expect(net(await p.getByRole('dialog').innerText())).toContain('Retiré, rien ne change pour lui');
    await p.getByRole('dialog').getByLabel('Motif', { exact: true }).fill('Il a retrouvé son téléphone');
    await cliquer(p.getByRole('dialog').getByRole('button', { name: 'Retirer l\'accès d\'urgence' }));
    await expect.poll(() => p.locator('.c-eq-regler li', { hasText: m.nom }).count()).toBe(0);
    expect((await admin.query('select annule_le is not null a from plateforme.acces_urgence where membre = $1', [m.id])).rows).toEqual([{ a: true }]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('le membre entre avec son mot de passe et pose son nouveau code ; l\'ancien ne vaut plus', async () => {
    const m = await membre('Ines Retrouvee', 'technique');
    expect((await api('POST', `/console/equipe/${m.id}/urgence`, direction, { motif: 'téléphone volé, appelée à son numéro' })).statut).toBe(200);
    const p = await ouvrirAvec(null, { hash: '#/' });
    await p.getByLabel('Ton adresse e-mail').fill(m.email);
    await p.getByLabel('Ton mot de passe', { exact: true }).fill(MDP);
    await cliquer(p.getByRole('button', { name: 'Continuer' }));
    await p.locator('h1', { hasText: 'Pose ton nouveau code' }).waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.c-forme-sous').first().innerText())).toMatch(/^Un accès d'urgence a été ouvert pour toi : ton ancien code et ses codes de secours cesseront de valoir/);
    const cle = (await p.locator('.c-cp-cle').innerText()).replace(/\s/g, '');
    expect(cle).not.toBe(m.secret);
    await p.getByRole('checkbox', { name: 'Je les ai mis de côté' }).check();
    await p.getByLabel('Le code que donne l\'application').fill(totp(cle));
    await cliquer(p.getByRole('button', { name: 'Activer le code et entrer' }));
    await p.locator('.c-nav').first().waitFor({ timeout: 20_000 });
    expect((await admin.query('select code_secret from socle.utilisateur where id = $1', [m.id])).rows[0].code_secret).toBe(cle);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    // Un accès qui attend dans l'équipe ; un autre membre, rejouable, sur la pose de son nouveau code (le secret attend).
    const attend = await membre('Rania Attend', 'support');
    await api('POST', `/console/equipe/${attend.id}/urgence`, direction, { motif: 'téléphone perdu en déplacement' });
    const pose = await membre('Walid Pose', 'support');
    await api('POST', `/console/equipe/${pose.id}/urgence`, direction, { motif: 'téléphone tombé en panne' });
    const ECRANS: EcranConsole[] = [
      { nom: 'equipe-urgence', hash: '#/equipe' },
      { nom: 'pose-urgence', hash: '#/', sansSession: true, geste: async (p) => {
        await p.locator('input[type=email]').fill(pose.email);
        await p.locator('input[type=password]').fill(MDP);
        await cliquer(p.locator('button[type=submit]'));
        await p.locator('.c-cp-secours').waitFor({ timeout: 20_000 });
      } },
    ];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
      const p = await ouvrirAvec(e.sansSession ? null : direction, { ...o, hash: e.hash });
      await p.locator(e.sansSession ? '.c-forme' : '.c-eq-regler').waitFor({ timeout: 20_000 });
      await p.waitForTimeout(400);
      return p;
    };
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: [], photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBeGreaterThanOrEqual(8);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
