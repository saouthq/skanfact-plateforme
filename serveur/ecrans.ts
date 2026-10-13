// Les fichiers des écrans, tels que le serveur les envoie (brique 118 ; docs/leger.md). Sur une connexion lente :
//   - chaque fichier a son EMPREINTE (le début de son SHA-256) : c'est son « ETag », et une page déjà gardée se
//     revalide en une réponse vide (304) au lieu de repartir entière ;
//   - une page HTML porte, sur chaque fichier qu'elle charge, son empreinte (« app.js?v=3f9c… ») : l'adresse change
//     quand le fichier change, et seulement alors ; à cette adresse, le navigateur le garde un an sans redemander ;
//   - le fichier part compressé (brotli, sinon gzip), compressé une fois puis gardé.
// Une page HTML se refait à chaque demande (elle est petite) : elle suit toujours les empreintes du jour, et porte la
// version du code qui la sert.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compresser, type Encodage } from './compression.ts';
import { NUMERO } from './console/versions.ts';

type Fichier = { mtime: number; taille: number; contenu: Buffer; empreinte: string; variantes: Map<Encodage, Buffer> };

const empreinte = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

// La version du code qui sert les écrans : le numéro que son envoi déclare (« version » de son package.json, « 1.1.0 »,
// le nom que la console donne à la version en service) et le début de son empreinte : « 1.1.0 · 879fcb2 », lue une fois
// dans le dépôt. Le pied du menu dit « v1.1.0 », l'envoi au survol (05/10/2026 : on y lisait « vdev » ; 13/10/2026,
// Skander : « je veux le numérotage normal, Vx.x.x »). Le numéro est celui du COMMIT, comme le suiveur le lit
// (exploitation/suivre.ts), jamais celui d'un fichier retouché depuis. Un envoi sans numéro lisible : « dev · 879fcb2 » ;
// sans dépôt lisible, « dev ».
export function versionDuCode(dossier = import.meta.dirname): string {
  const git = (...a: string[]) => execFileSync('git', ['-C', dossier, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let court: string;
  try { court = git('log', '-1', '--format=%h'); } catch { return 'dev'; }
  if (!court) return 'dev';
  let numero: string | null = null;
  try {
    const v = (JSON.parse(git('show', 'HEAD:package.json')) as { version?: unknown } | null)?.version;
    numero = typeof v === 'string' && NUMERO.test(v) ? v : null;
  } catch { /* un envoi sans package.json lisible : sans numéro */ }
  return `${numero ?? 'dev'} · ${court}`;
}

export function fichiersDesEcrans(racine: string, version = 'dev') {
  const memoire = new Map<string, Fichier>();

  function lire(fichier: string): Fichier {
    const st = fs.statSync(fichier);
    if (fichier.endsWith('.html')) {
      const contenu = Buffer.from(versionner(fichier, fs.readFileSync(fichier, 'utf8')));
      return { mtime: st.mtimeMs, taille: st.size, contenu, empreinte: empreinte(contenu), variantes: new Map() };
    }
    const connu = memoire.get(fichier);
    if (connu && connu.mtime === st.mtimeMs && connu.taille === st.size) return connu;
    const contenu = fs.readFileSync(fichier);
    const f = { mtime: st.mtimeMs, taille: st.size, contenu, empreinte: empreinte(contenu), variantes: new Map<Encodage, Buffer>() };
    memoire.set(fichier, f);
    return f;
  }

  // Chaque fichier du dossier que la page charge (src="…", href="…", relatif à la page ou depuis la racine) reçoit
  // son empreinte. Une adresse ailleurs (« https: », « data: »), une ancre ou une adresse qui porte déjà « ? » : telle quelle.
  function versionner(fichier: string, html: string): string {
    const relatif = path.relative(racine, path.dirname(fichier)).split(path.sep).filter(Boolean).join('/');
    const base = `http://x/${relatif ? `${relatif}/` : ''}`;
    const versionnee = html.replace(/\b(src|href)="([^"#?:]+)"/g, (tout, attribut: string, adresse: string) => {
      if (adresse.startsWith('//')) return tout;
      const cible = path.resolve(racine, `.${decodeURIComponent(new URL(adresse, base).pathname)}`);
      if (!cible.startsWith(racine + path.sep) || !fs.existsSync(cible) || !fs.statSync(cible).isFile()) return tout;
      return `${attribut}="${adresse}?v=${lire(cible).empreinte}"`;
    });
    // Les scripts de la page s'annoncent dès le début de <head> (« preload ») : sans cela, Chrome ne les demande qu'un
    // par un tant que les précédents ne sont pas arrivés, et chaque script coûte un aller-retour de plus (mesuré le
    // 01/10/2026 sur la connexion lente de référence : docs/leger.md). Un script « module » garde sa façon de charger.
    const scripts = [...versionnee.matchAll(/<script src="([^"]+\?v=[0-9a-f]+)"><\/script>/g)].map((m) => m[1]);
    // Juste après la déclaration du jeu de caractères (elle reste dans les premiers octets), sinon après <head>.
    const tete = /<meta charset="[^"]*"\s*\/?>/i.exec(versionnee) ?? /<head[^>]*>/.exec(versionnee);
    if (!tete) return versionnee;
    // Des balises, pas des phrases (le catalogue des textes ne les compte pas) : assemblées de leurs attributs.
    const annonces = scripts.map((a) => `\n  ${['<link', 'rel="preload"', 'as="script"', `href="${a}">`].join(' ')}`).join('');
    const marque = `\n  ${['<meta', 'name="skanfact-code"', `content="${version.replace(/[&<>"]/g, '')}">`].join(' ')}`;
    const apres = tete.index + tete[0].length;
    return versionnee.slice(0, apres) + marque + annonces + versionnee.slice(apres);
  }

  // Le contenu compressé, fait une fois (une page HTML : à chaque fois, elle est petite).
  function compresse(f: Fichier, encodage: Encodage): Buffer {
    let v = f.variantes.get(encodage);
    if (!v) { v = compresser(f.contenu, encodage, true); f.variantes.set(encodage, v); }
    return v;
  }

  return { lire, compresse };
}

// « If-None-Match » : une ou plusieurs empreintes, faibles (« W/ ») ou non.
export const dejaGarde = (entete: string | string[] | undefined, etag: string) =>
  String(entete ?? '').split(',').map((e) => e.trim().replace(/^W\//, '')).includes(etag);
