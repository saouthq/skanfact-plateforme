// Léger sur une connexion lente (brique 118 ; docs/leger.md). Les seuils sont écrits AVANT la mesure (journal du
// cadrage, 01/10/2026) ; une mesure qui dépasse change le plan, pas le seuil. La connexion lente de référence :
// 1 Mbit/s descendant (125 000 octets par seconde), 300 ms d'aller-retour, partagés par toutes les connexions du
// navigateur (tests/lien-lent.ts).
//   S1  première ouverture de l'entreprise (rien de gardé) : au plus 1 300 Ko par le fil, utilisable en moins de 15 s ;
//   S2  ouverture suivante : au plus 30 Ko par le fil, utilisable en moins de 2 s ;
//   S3  tout envoi de plus de 1 Ko (écrans et réponses de l'API) compressé quand le navigateur l'accepte.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { lienLent } from '../lien-lent.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const KO = 1024;

describe('léger sur une connexion lente', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-leger-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };

  // Nadia, propriétaire avec son code (le dossier se lit après le code), et son entreprise neuve.
  const nadia = async () => {
    const email = `leger-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    return { jeton, ent };
  };

  it('S3 : les écrans et les réponses de l\'API partent compressés ; un petit envoi, tel quel ; un écran à empreinte se garde', async () => {
    const { jeton, ent } = await nadia();
    const entetes = async (chemin: string, encodage: string, autres: Record<string, string> = {}) => {
      const r = await fetch(`${serveur.adresse}${chemin}`, { headers: { 'accept-encoding': encodage, ...autres } });
      const taille = (await r.arrayBuffer()).byteLength;
      return { taille, statut: r.status, encodage: r.headers.get('content-encoding'), vary: r.headers.get('vary') ?? '', cache: r.headers.get('cache-control'), etag: r.headers.get('etag') };
    };
    // Un écran : brotli si le navigateur le connaît, sinon gzip, sinon tel quel.
    expect(await entetes('/v10/app.js', 'gzip, deflate, br')).toMatchObject({ statut: 200, encodage: 'br' });
    expect(await entetes('/v10/app.js', 'gzip')).toMatchObject({ statut: 200, encodage: 'gzip' });
    expect(await entetes('/v10/app.js', 'identity')).toMatchObject({ statut: 200, encodage: null });
    expect((await entetes('/v10/app.js', 'br')).vary).toMatch(/accept-encoding/i);
    // La page porte l'empreinte de chaque fichier qu'elle charge ; à cette adresse, le fichier se garde un an (un écran
    // de la v10 n'est pas une réponse de l'API, même si son adresse commence comme elle) ; sans elle, il se revalide :
    // une réponse vide s'il n'a pas changé.
    const html = await (await fetch(`${serveur.adresse}/v10/`)).text();
    const versionne = /src="(app\.js\?v=[0-9a-f]{16})"/.exec(html)?.[1] ?? '';
    expect(versionne).not.toBe('');
    // Ses scripts s'annoncent dès le début de la page : le navigateur les demande ensemble, pas un par un.
    expect(html.indexOf(`<link rel="preload" as="script" href="${versionne}">`)).toBeGreaterThan(-1);
    expect(html.indexOf(`<link rel="preload" as="script" href="${versionne}">`)).toBeLessThan(html.indexOf('<title>'));
    expect(await entetes(`/v10/${versionne}`, 'br')).toMatchObject({ statut: 200, cache: 'public, max-age=31536000, immutable' });
    const nu = await entetes('/v10/app.js', 'br');
    expect(nu).toMatchObject({ statut: 200, cache: 'no-cache', etag: `"${versionne.split('=')[1]}"` });
    expect(await entetes('/v10/app.js', 'br', { 'if-none-match': String(nu.etag) })).toMatchObject({ statut: 304 });
    // Une réponse de l'API de plus de 1 Ko (la documentation de l'API) : compressée.
    expect(await entetes('/v1/documentation', 'gzip, deflate, br')).toMatchObject({ statut: 200, encodage: 'br', cache: 'no-store' });
    expect(await entetes('/v1/documentation', 'gzip')).toMatchObject({ statut: 200, encodage: 'gzip' });
    // Un petit envoi (le dossier d'une entreprise neuve : moins de 1 Ko) part tel quel : le compresser coûterait plus
    // qu'il ne gagne ; jamais gardé.
    const auth = { authorization: `Bearer ${jeton}` };
    const petit = await entetes(`/v1/entreprises/${ent}/dossier-v10`, 'gzip, deflate, br', auth);
    expect(petit).toMatchObject({ statut: 200, encodage: null, cache: 'no-store' });
    expect(petit.taille).toBeLessThanOrEqual(1024);
  });

  it('S1 et S2 : la première ouverture et la suivante, sur une connexion lente', async () => {
    const { jeton, ent } = await nadia();
    const lien = await lienLent(serveur.adresse, 125_000, 300);
    // Un navigateur comme celui d'une personne : un profil sur le disque.
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'profil-leger-'));
    const cx = await chromium.launchPersistentContext(profil, { viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = cx.pages()[0] ?? await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async () => {
      lien.remettre();
      const debut = Date.now();
      await p.goto(`${lien.adresse}/v10/?e=${ent}`, { timeout: 120_000 });
      await p.locator('#view h1').first().waitFor({ state: 'visible', timeout: 120_000 });
      return { ms: Date.now() - debut, ko: Math.round(lien.octets() / KO) };
    };
    // Le fil se calme : plus un octet pendant une seconde (le service des écrans finit de garder sa copie).
    const calme = async () => {
      let avant = -1;
      for (let i = 0; i < 240 && lien.octets() !== avant; i++) { avant = lien.octets(); await new Promise((ok) => setTimeout(ok, 1000)); }
    };
    try {
      const s1 = await ouvrir();
      await p.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 120_000 });
      await calme();
      const s1complet = Math.round(lien.octets() / KO);
      // Ce que le poste garde, dès la première visite, pour s'ouvrir sans réseau : la page qu'il ouvre, jamais le Cabinet chez qui ne l'ouvre pas
      // (il pèserait 450 Ko de plus à la première visite ; le Cabinet ne s'ouvre pas encore sans réseau).
      const gardes = (pg: Page) => pg.evaluate(async () => (await (await caches.open('skanfact-ecrans-2')).keys()).map((r) => new URL(r.url).pathname));
      expect(await gardes(p)).toEqual(expect.arrayContaining(['/', '/v10/', '/v10/app.js']));
      expect(await gardes(p)).not.toContain('/v10/cabinet/');
      const s2 = await ouvrir();
      fs.mkdirSync(path.join(RACINE, 'dist/photos'), { recursive: true });
      await p.screenshot({ animations: 'disabled', path: path.join(RACINE, 'dist/photos/leger-2-ouverture-suivante.png') });
      // Les chiffres mesurés, gardés pour le journal (docs/leger.md, « Mesuré ») : dist/mesures/leger.txt.
      fs.mkdirSync(path.join(RACINE, 'dist/mesures'), { recursive: true });
      fs.writeFileSync(path.join(RACINE, 'dist/mesures/leger.txt'),
        `S1 : ${s1.ko} Ko en ${s1.ms} ms (avec la copie gardée : ${s1complet} Ko) ; S2 : ${s2.ko} Ko en ${s2.ms} ms\n`);
      expect(s1.ko).toBeLessThanOrEqual(1_300);
      expect(s1complet).toBeLessThanOrEqual(1_300);
      expect(s1.ms).toBeLessThan(15_000);
      expect(s2.ko).toBeLessThanOrEqual(30);
      expect(s2.ms).toBeLessThan(2_000);
      expect(erreurs).toEqual([]);
    } finally {
      await cx.close();
      await lien.fermer();
      fs.rmSync(profil, { recursive: true, force: true });
    }
  }, 600_000);
});
