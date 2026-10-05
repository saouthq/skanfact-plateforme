// Léger sur une connexion lente (brique 118 ; docs/leger.md). Les seuils sont écrits AVANT la mesure (journal du
// cadrage, 01/10/2026) ; une mesure qui dépasse change le plan, pas le seuil. La connexion lente de référence :
// 1 Mbit/s descendant (125 000 octets par seconde), 300 ms d'aller-retour, partagés par toutes les connexions du
// navigateur (tests/lien-lent.ts).
//   S1  première ouverture de l'entreprise (rien de gardé) : au plus 1 300 Ko par le fil, utilisable en moins de 15 s ;
//   S2  ouverture suivante : au plus 30 Ko par le fil, utilisable en moins de 2 s ;
//   S3  tout envoi de plus de 1 Ko (écrans et réponses de l'API) compressé quand le navigateur l'accepte.
// Le 05/10/2026, S1 mesurait 1 302 Ko (l'exemple rempli et la facture guidée) : le plan a changé, pas le seuil. L6, nos
// écrans partent sans leurs commentaires, et rien d'autre (web/alleger.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'lightningcss';
import { chromium, type Browser, type Page } from 'playwright-core';
import { parseSync } from 'rolldown/utils';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { DOSSIERS_ALLEGES, scriptSansCommentaires, styleSansCommentaires } from '../../web/alleger.ts';
import { lienLent } from '../lien-lent.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const KO = 1024;

// Deux arbres de syntaxe identiques, positions mises à part : le chemin du premier écart, sinon null.
const POSITIONS = new Set(['start', 'end', 'range', 'loc']);
function ecart(a: unknown, b: unknown, chemin = 'programme'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return chemin;
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b) ? null : chemin;
  const cles = Object.keys(a).filter((k) => !POSITIONS.has(k));
  if (cles.join() !== Object.keys(b).filter((k) => !POSITIONS.has(k)).join()) return `${chemin} (clés)`;
  for (const k of cles) {
    const d = ecart((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${chemin}.${k}`);
    if (d) return d;
  }
  return null;
}

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

  it('L6 : un commentaire part, rien d\'autre : ni deux mots collés, ni une ligne déplacée, ni ce qui lui ressemble dans une chaîne', () => {
    // Un script, joué avant et après : il doit rendre la même chose. Ce qui ressemble à un commentaire dans une chaîne,
    // une expression régulière ou un gabarit en reste ; « typeof/* */u » ne devient pas « typeofu » ; un « return »
    // suivi d'un bloc de deux lignes rend toujours « undefined ».
    const script = [
      '/* en-tête */ \'use strict\';',
      'const u = "http://exemple.tn/*pas un commentaire*/"; // la fin de la ligne',
      'const r = /\\/\\*.*?\\*\\//g, t = typeof/* collé */u;',
      'const g = `a // b ${u /* dans le gabarit */} c`, s = `fin   ` /* après le gabarit */;',
      'function f() {',
      '  return /* un saut',
      '  de ligne */ 1;',
      '}',
      'resultat = { u, r: r.source, t, g, s, f: f() };',
    ].join('\n');
    const jouer = (code: string) => { const ctx = { resultat: null as unknown }; vm.runInNewContext(code, ctx); return ctx.resultat; };
    const allege = scriptSansCommentaires('essai.js', script);
    // Le test mesure : l'essai a bien ses pièges.
    expect(jouer(script)).toEqual({ u: 'http://exemple.tn/*pas un commentaire*/', r: '\\/\\*.*?\\*\\/', t: 'string',
      g: 'a // b http://exemple.tn/*pas un commentaire*/ c', s: 'fin   ', f: undefined });
    expect(jouer(allege)).toEqual(jouer(script));
    expect(parseSync('essai.js', allege).comments).toEqual([]);
    expect(allege.split('\n').length).toBe(script.split('\n').length);
    // Un script que l'analyseur ne sait pas lire arrête la construction : il ne part pas à moitié.
    expect(() => scriptSansCommentaires('casse.js', 'const = 1; /* reste */')).toThrow(/casse\.js/);
    // Une feuille de style : une chaîne, une adresse sans guillemets et un caractère échappé gardent leur « /* ».
    const style = [
      '/* en-tête */',
      '.a::before { content: "/* pas un commentaire */"; } /* fin de ligne */',
      '.b { background: url(fond/*etoile*/.png); }',
      '.c { --motif: a\\/*b; }',
      '/* un bloc',
      'sur deux lignes */',
      '.d { color: red; }',
    ].join('\n');
    expect(styleSansCommentaires(style)).toBe([
      '',
      '.a::before { content: "/* pas un commentaire */"; }',
      '.b { background: url(fond/*etoile*/.png); }',
      '.c { --motif: a\\/*b; }',
      '',
      '',
      '.d { color: red; }',
    ].join('\n'));
  });

  it('L6 : nos écrans partent sans un commentaire, et c\'est le même programme que le dépôt, ligne pour ligne', () => {
    const depot = path.join(RACINE, 'web/public');
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.(js|css)$/.test(e.name)) fichiers.push(path.relative(depot, p));
      }
    };
    for (const d of DOSSIERS_ALLEGES) parcourir(path.join(depot, d));
    // Le test mesure : l'entreprise, le Cabinet, le point de contact et l'espace client en sont.
    expect(fichiers).toEqual(expect.arrayContaining(['v10/app.js', 'v10/core.js', 'v10/style.css', 'v10/cabinet/app.js', 'plateforme/pont.js', 'espace/espace.js']));
    let avant = 0;
    let apres = 0;
    for (const f of fichiers) {
      const source = fs.readFileSync(path.join(depot, f), 'utf8');
      const envoye = fs.readFileSync(path.join(dossier, f), 'utf8');
      avant += source.length;
      apres += envoye.length;
      // Chaque ligne à sa place : une erreur signalée depuis un poste pointe la ligne du dépôt.
      expect(envoye.split('\n').length, f).toBe(source.split('\n').length);
      if (f.endsWith('.js')) {
        // Relu par l'analyseur : plus un commentaire, et le même arbre que le dépôt, nœud pour nœud.
        const lu = parseSync(f, envoye);
        expect(lu.errors, f).toEqual([]);
        expect(lu.comments, f).toEqual([]);
        expect(ecart(parseSync(f, source).program, lu.program), f).toBeNull();
      } else {
        // Relue par un autre analyseur (lightningcss), la feuille dit la même chose ; hors des chaînes, plus un « /* ».
        const forme = (code: string) => transform({ filename: f, code: Buffer.from(code), minify: true }).code.toString();
        expect(forme(envoye), f).toBe(forme(source));
        expect(envoye.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""'), f).not.toContain('/*');
      }
    }
    // Le gain, avant compression : plus d'un cinquième.
    expect(apres).toBeLessThan(avant * 0.8);
    // Le code d'un tiers part tel quel, avec sa licence.
    expect(fs.readFileSync(path.join(dossier, 'tiers/qrcode.js')).equals(fs.readFileSync(path.join(depot, 'tiers/qrcode.js')))).toBe(true);
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
