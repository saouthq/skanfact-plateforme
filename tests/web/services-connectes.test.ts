// Services connectés, à la souris (brique 134 ; docs/boutique.md, B0). Nadia a relié sa boutique SkanEcom ; une ancienne
// clé est coupée, une autre a expiré. Ce que le parcours vérifie, écran ET serveur :
//   - Paramètres → Données et sécurité → « Services connectés » : la boutique seule (ni la clé coupée, ni l'expirée),
//     avec ce qu'elle peut faire en mots, depuis quand et jusqu'à quand, et sa dernière action ;
//   - « Couper l'accès… » demande d'abord, puis coupe : la clé ne vaut plus rien, et le panneau le dit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('services connectés, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-services-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const dansUnAn = () => new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);

  it('la boutique reliée se voit avec ce qu\'elle peut faire ; « Couper l\'accès » demande, puis coupe, et la clé ne vaut plus rien', async () => {
    const email = `services-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Préparation', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const ent = String((await api('POST', '/entreprises', premier, { raisonSociale: 'Nadia Bijoux' })).corps.id);
    const cle = async (nom: string) => (await api('POST', `/entreprises/${ent}/cles-api`, premier, { nom, gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'], expireLe: dansUnAn() })).corps;
    const boutique = await cle('SkanEcom (connexion)');
    const coupee = await cle('Ancien outil');
    await api('DELETE', `/entreprises/${ent}/cles-api/${String(coupee.id)}`, premier);
    const expiree = await cle('Outil expiré');
    await admin.query(`update socle.cle_api set cree_le = now() - interval '2 days', expire_le = now() - interval '1 minute' where id = $1`, [expiree.id]);
    // La boutique a déjà agi une fois.
    expect((await api('GET', `/entreprises/${ent}/commandes-en-ligne/SK-1`, String(boutique.cle))).statut).toBe(404);

    // Un instant à 23 h 30 (UTC) est déjà le lendemain à Tunis : les écrans disent le jour de Tunis.
    await admin.query(`update socle.cle_api set cree_le = '2026-09-30T23:30:00Z', derniere_utilisation = '2026-09-30T23:40:00Z' where id = $1`, [boutique.id]);
    await admin.query(`update socle.session set derniere_activite = '2026-09-30T23:30:00Z'
      where appareil in (select a.id from socle.appareil a join socle.utilisateur u on u.id = a.utilisateur where u.email = $1 and a.nom = 'Préparation')`, [email]);
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // Un navigateur à l'heure UTC (un commerçant en voyage) : les jours se disent quand même à Tunis.
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'UTC' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.getByRole('tab', { name: 'Données et sécurité', exact: true }).click();
    const panneau = p.locator('#p-services');
    await expect.poll(() => panneau.innerText(), { timeout: 15_000 }).toContain('SkanEcom (connexion)');
    const texte = await panneau.innerText();
    expect(texte).toContain('Services connectés');
    expect(texte).toContain(`Peut : ${rendre(t('geste.ventes.boutique.facturer'), 'fr')} ; ${rendre(t('geste.ventes.pieces.voir'), 'fr')}.`);
    expect(texte).toContain('Relié le 01/10/2026, jusqu');
    expect(texte).toContain('dernière action le 01/10/2026 à 0 h 40.');
    expect(await p.locator('#p-appareils tr').filter({ hasText: 'Préparation' }).innerText()).toContain('Dernière activité le 01/10/2026');
    expect(texte).toMatch(/Relié le \d\d\/\d\d\/\d{4}, jusqu'au \d\d\/\d\d\/\d{4}\s?; dernière action le \d\d\/\d\d\/\d{4} à \d+ h \d\d\./);
    // Ni la clé coupée, ni l'expirée : elles ne peuvent plus rien.
    expect(texte).not.toContain('Ancien outil');
    expect(texte).not.toContain('Outil expiré');
    await p.screenshot({ path: path.join(PHOTOS, 'services-1-liste.png') });

    // « Couper l'accès… » demande d'abord ; rien n'est coupé tant qu'on n'a pas confirmé.
    await panneau.getByRole('button', { name: 'Couper l\'accès…', exact: true }).click();
    await expect.poll(() => panneau.getByRole('alert').innerText()).toBe('« SkanEcom (connexion) » ne pourra plus rien faire pour ton entreprise. Pour le relier de nouveau, il faudra le reconnecter depuis le service.');
    expect((await api('GET', `/entreprises/${ent}/commandes-en-ligne/SK-1`, String(boutique.cle))).statut).toBe(404);
    await panneau.getByRole('button', { name: 'Oui, couper l\'accès', exact: true }).click();
    await expect.poll(() => panneau.getByRole('alert').innerText(), { timeout: 15_000 }).toBe('« SkanEcom (connexion) » n\'a plus accès à ton entreprise.');
    expect(await panneau.innerText()).toContain('Aucun service n\'agit pour ton entreprise.');
    await p.screenshot({ path: path.join(PHOTOS, 'services-2-coupe.png') });
    // La clé ne vaut plus rien.
    expect((await api('GET', `/entreprises/${ent}/commandes-en-ligne/SK-1`, String(boutique.cle))).statut).toBe(401);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
