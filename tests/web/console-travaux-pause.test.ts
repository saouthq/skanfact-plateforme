// La suite des travaux, à la souris (0145 ; docs/console.md C69 ; web/console/src/ecrans/Travaux.tsx). La TTN est
// branchée (une adresse qui ne répond pas : son facteur ne passe pas pendant l'essai). Ce que le parcours vérifie :
//   - « 24 heures » montre une barre par heure dans chaque carte, et revient à quatorze jours ;
//   - « Mettre en pause… » sur la TTN : un motif court se refuse ; la durée se choisit, l'avertissement se lit avant le
//     geste ; en pause, la carte et la tuile du facteur le disent, avec l'heure de reprise ; « À décider » le rappelle ;
//   - « Reprendre… » la lève : la carte redevient comme avant ;
//   - des envois en panne depuis plus de quatre heures se disent en tête, avec l'incident qu'on peut ouvrir ;
//   - en clair et en sombre, à l'ordinateur et au téléphone : l'instrument ne trouve rien ; en langue factice, tout
//     vient du catalogue.

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
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('la pause d\'un partenaire, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-pause-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-pause-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '';
  // Les envois en panne laissés par d'autres essais (tests/v10/ttn.test.ts, sur son horloge du 01/10) se comptent aussi :
  // celui-ci en ajoute un, et c'est ce « un de plus » qu'on lit.
  let avantPanne = 0;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const ouvrir = async (o: { largeur?: number; hash?: string; theme?: 'clair' | 'sombre'; factice?: boolean } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jD, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/service/travaux'}`);
    if ((o.hash ?? '#/service/travaux') === '#/service/travaux') await expect.poll(() => p.locator('.c-tr-tache').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const carte = (p: Page) => p.locator('.c-tr-partenaire').filter({ has: p.locator('h3', { hasText: /^La TTN$/ }) });
  const fenetre = (p: Page) => p.locator('[role="dialog"]');

  beforeAll(async () => {
    await admin.connect();
    await admin.query('delete from plateforme.pause_partenaire');
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille,
      SKANFACT_TTN: 'http://127.0.0.1:9', SKANFACT_TTN_MS: '3600000' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-pause-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai de la pause à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jD = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    avantPanne = Number(((await api('GET', '/console/service/travaux', jD)).corps.enPanne as { n?: number } | undefined)?.n ?? 0);
    // Un envoi à la TTN, sans sa pièce, en panne depuis six heures.
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Ébénisterie de la Pause', matriculeFiscal: `${String(Date.now()).slice(-7)}D/A/M/000` })).corps.id);
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into ventes.envoi_ttn(piece, entreprise, statut, essais, prochain_essai, motif, cree_le, cree_par) values
      (gen_random_uuid(), $1, 'a_envoyer', 6, now() + interval '1 hour', '{"cle":"ttn.panne","valeurs":{"statut":503}}', now() - interval '6 hours', $2)`, [ent, id]);
    await admin.query('commit');
  }, 180_000);
  afterAll(async () => {
    await admin.query('delete from plateforme.pause_partenaire');
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('« 24 heures » : une barre par heure ; des envois en panne depuis des heures se disent en tête', async () => {
    // Le serveur compte l'envoi en panne avant que l'écran le dise.
    const lu = await api('GET', '/console/service/travaux', jD);
    expect(lu.corps.enPanne, JSON.stringify(lu.corps.enPanne)).toMatchObject({ n: avantPanne + 1, heures: 4 });
    const p = await ouvrir();
    expect(await carte(p).locator('.c-tr-barre').count()).toBe(14);
    await cliquer(p.getByRole('button', { name: '24 heures' }));
    await expect.poll(() => carte(p).locator('.c-tr-barre').count()).toBe(24);
    expect(net(await carte(p).locator('.c-tr-stats').innerText())).toMatch(/Sur 24 heures/);
    await cliquer(p.getByRole('button', { name: '14 jours' }));
    await expect.poll(() => carte(p).locator('.c-tr-barre').count()).toBe(14);
    const alerte = p.locator('.c-alerte').filter({ hasText: /ne part(ent)? plus depuis plus de 4\sheures/ });
    await expect.poll(() => alerte.count()).toBe(1);
    expect(await alerte.getByRole('link', { name: 'Ouvrir un incident' }).getAttribute('href')).toBe('#/service/incidents?ouvrir=partenaire');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('mettre la TTN en pause : un motif court se refuse ; en pause, la carte, la tuile et « À décider » le disent ; reprendre la lève', async () => {
    const p = await ouvrir();
    await cliquer(carte(p).getByRole('button', { name: /Mettre la TTN en pause/i }));
    const f = fenetre(p);
    // L'avertissement se lit avant le geste ; le curseur attend dans le motif.
    expect(net(await f.innerText())).toMatch(/délai que la loi donne/);
    expect(await f.locator('textarea').evaluate((el) => el === document.activeElement)).toBe(true);
    await cliquer(f.getByRole('button', { name: '4 heures' }));
    await f.locator('textarea').fill('ok');
    await cliquer(f.getByRole('button', { name: 'Mettre en pause', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    await f.locator('textarea').fill('Maintenance annoncée par la TTN de 22 h à 2 h');
    await cliquer(f.getByRole('button', { name: 'Mettre en pause', exact: true }));
    await expect.poll(() => fenetre(p).count()).toBe(0);
    await expect.poll(async () => net(await carte(p).innerText())).toMatch(/En pause jusqu'(à|au)/);
    expect(net(await carte(p).innerText())).toContain('Maintenance annoncée par la TTN de 22 h à 2 h');
    expect(net(await p.locator('.c-tr-tuiles .c-sv-tuile').nth(3).innerText())).toMatch(/En pause/);
    const fin = (await admin.query(`select extract(epoch from jusqu_au - le)::int s from plateforme.pause_partenaire where levee_le is null`)).rows;
    expect(fin.map((x) => x.s)).toEqual([4 * 3600]);
    await p.screenshot({ path: path.join(PHOTOS, 'console-travaux-pause-1.png'), fullPage: true });
    await fermer(p);

    const a = await ouvrir({ hash: '#/' });
    const ligne = a.locator('.c-ligne-decision').filter({ hasText: /La TTN\s:\sen pause/ });
    await expect.poll(() => ligne.count(), { timeout: 20_000 }).toBe(1);
    expect(net(await ligne.innerText())).toMatch(/Maintenance annoncée/);
    await fermer(a);

    const q = await ouvrir();
    await cliquer(carte(q).getByRole('button', { name: /Reprendre la TTN/i }));
    const r = fenetre(q);
    await r.locator('textarea').fill('Maintenance finie plus tôt');
    await cliquer(r.getByRole('button', { name: 'Reprendre maintenant' }));
    await expect.poll(() => fenetre(q).count()).toBe(0);
    await expect.poll(async () => net(await carte(q).innerText())).not.toMatch(/En pause/);
    expect(await carte(q).getByRole('button', { name: /Mettre la TTN en pause/i }).count()).toBe(1);
    expect(erreurs).toEqual([]);
    await fermer(q);
  }, 90_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    await api('POST', '/console/service/travaux/pauses', jD, { partenaire: 'relances', heures: 24, motif: 'Incident en cours sur les paiements' });
    const ECRANS: EcranConsole[] = [
      { nom: 'travaux-suite', hash: '#/service/travaux' },
      { nom: 'travaux-24h', hash: '#/service/travaux', geste: async (p) => { await cliquer(p.locator('.c-tr-partenaires .c-al-section-tete .c-pilule').nth(1)); } },
      { nom: 'travaux-pause', hash: '#/service/travaux', geste: async (p) => { await cliquer(p.locator('.c-tr-partenaire .c-tr-partenaire-pied .c-btn-discret').first()); await fenetre(p).waitFor(); } },
    ];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => ouvrir({ ...o, hash: e.hash });
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: [], photos: PHOTOS });
    expect(faux).toEqual([]);
    expect(vus).toBe(12);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
