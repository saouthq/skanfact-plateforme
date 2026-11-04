// L'assemblage des écrans (docs/cadrage/17-rangement.md § 3.1 et § 4.1 ; lot R0a, 03/11/2026). Un fichier servi est la
// suite de ses morceaux, octet pour octet ; la construction et le serveur de développement le servent assemblé ; Node
// le lit par un seul chargeur ; au lot R0a, chaque fichier est son unique morceau, et rien ne change d'un octet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import { AssemblageRefuse, assemblerOctets, ecrireLesAssembles, lireEcran, lireTable, morceauxDuModule, origine, RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { scriptSansCommentaires } from '../../web/alleger.ts';
import config from '../../web/vite.config.ts';

// Un petit dépôt à part : sa table et ses morceaux.
function depot(fichiers: Record<string, string>, table: Record<string, string[]>) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'assemblage-'));
  for (const [f, texte] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(racine, f)), { recursive: true });
    fs.writeFileSync(path.join(racine, f), texte);
  }
  fs.mkdirSync(path.join(racine, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'modules/assemblage.json'), JSON.stringify({ fichiers: table }));
  return racine;
}
const A = 'modules/socle/ecrans/entreprise/debut.js', B = 'modules/personnel/ecrans/entreprise/paie.js', C = 'modules/socle/ecrans/entreprise/fin.js';
const TEXTES = { [A]: 'const a = 1; // é\n', [B]: 'function paie() {\n  return a;\n}\n', [C]: 'paie();' };

// Les gros fichiers que la règle du CLAUDE.md nomme (« Le code : un dossier par module ») : tous passent par l'assemblage.
const GROS = ['v10/app.js', 'v10/core.js', 'v10/compta.js', 'v10/guide.js', 'v10/visites.js', 'v10/cabinet/app.js', 'v10/cabinet/cabguide.js',
  'v10/cabinet/cabvisites.js', 'plateforme/pont.js', 'plateforme/pont-cabinet.js'];

describe('l\'assemblage des écrans', () => {
  it('un fichier servi est la suite de ses morceaux ; une ligne retrouve son morceau ; un module retrouve les siens', () => {
    const r = depot(TEXTES, { 'v10/app.js': [A, B, C] });
    expect(assemblerOctets('v10/app.js', r).equals(Buffer.from(TEXTES[A] + TEXTES[B] + TEXTES[C]))).toBe(true);
    expect(lireEcran('v10/app.js', r)).toBe(TEXTES[A] + TEXTES[B] + TEXTES[C]);
    expect(origine('v10/app.js', 1, r)).toEqual({ morceau: A, ligne: 1 });
    expect(origine('v10/app.js', 2, r)).toEqual({ morceau: B, ligne: 1 });
    expect(origine('v10/app.js', 4, r)).toEqual({ morceau: B, ligne: 3 });
    expect(origine('v10/app.js', 5, r)).toEqual({ morceau: C, ligne: 1 });
    expect(origine('v10/app.js', 6, r)).toBeNull();
    expect(morceauxDuModule('personnel', r)).toEqual([{ servi: 'v10/app.js', morceau: B }]);
    expect(morceauxDuModule('socle', r).map((m) => m.morceau)).toEqual([A, C]);
    // Un écran qui ne s'assemble pas est lu à son adresse sous web/public.
    fs.mkdirSync(path.join(r, 'web/public/v10'), { recursive: true });
    fs.writeFileSync(path.join(r, 'web/public/v10/listes.js'), 'listes();\n');
    expect(lireEcran('v10/listes.js', r)).toBe('listes();\n');
    // Écrits dans les écrans construits : un fichier dont les morceaux ont quitté web/public y est écrit.
    const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'assemblage-sortie-'));
    expect(ecrireLesAssembles(sortie, r)).toEqual(['v10/app.js']);
    expect(fs.readFileSync(path.join(sortie, 'v10/app.js'), 'utf8')).toBe(TEXTES[A] + TEXTES[B] + TEXTES[C]);
  });

  it('l\'assemblage refuse une coupe au milieu d\'une ligne, un morceau en double, absent, vide ou hors des dossiers, et une copie morte', () => {
    const refus = (fichiers: Record<string, string>, table: Record<string, string[]>, servi = 'v10/app.js') => {
      const r = depot(fichiers, table);
      try { assemblerOctets(servi, r); } catch (e) { expect(e).toBeInstanceOf(AssemblageRefuse); return (e as Error).message; }
      return null;
    };
    expect(refus({ [A]: 'const a = 1;', [C]: 'paie();' }, { 'v10/app.js': [A, C] })).toMatch(/ne finit pas par un saut de ligne/);
    expect(refus(TEXTES, { 'v10/app.js': [A, B], 'v10/core.js': [B] })).toMatch(/déclaré deux fois/);
    expect(refus(TEXTES, { 'v10/app.js': [A, 'modules/personnel/absent.js'] })).toMatch(/introuvable/);
    expect(refus({ ...TEXTES, [B]: '' }, { 'v10/app.js': [A, B, C] })).toMatch(/est vide/);
    expect(refus({ ...TEXTES, 'ailleurs/x.js': 'x;\n' }, { 'v10/app.js': ['ailleurs/x.js'] })).toMatch(/doit vivre sous web\/public\/ ou sous modules\//);
    expect(refus({ ...TEXTES, 'modules/x.js': 'x;\n' }, { 'v10/../app.js': ['modules/x.js'] }, 'v10/../app.js')).toMatch(/chemin relatif/);
    // Le fichier servi encore gardé sous web/public alors qu'il s'assemble d'ailleurs : une copie morte.
    expect(refus({ ...TEXTES, 'web/public/v10/app.js': 'ancien();\n' }, { 'v10/app.js': [A, B, C] })).toMatch(/copie morte/);
    // Le même fichier, s'il est lui-même l'unique morceau (le lot R0a) : accepté.
    expect(refus({ 'web/public/v10/app.js': 'ancien();\n' }, { 'v10/app.js': ['web/public/v10/app.js'] })).toBeNull();
  });

  it('au lot R0a, chaque gros fichier passe par l\'assemblage, et il est son unique morceau, à l\'octet', () => {
    const table = lireTable();
    for (const f of GROS) expect(Object.keys(table), f).toContain(f);
    for (const [servi, liste] of Object.entries(table)) {
      expect(liste, servi).toEqual([`web/public/${servi}`]);
      expect(assemblerOctets(servi).equals(fs.readFileSync(path.join(RACINE_DU_DEPOT, 'web/public', servi))), servi).toBe(true);
    }
  });

  it('la construction écrit chaque fichier assemblé avant de l\'alléger, même absent de web/public ; le développement le sert assemblé', async () => {
    const plugins = (config as { plugins: Plugin[] }).plugins.flat() as Plugin[];
    const construction = plugins.find((p) => p?.name === 'skanfact-ecrans-sans-commentaires');
    const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'assemblage-construit-'));
    // Une sortie vide : rien n'y a été copié de web/public ; l'étape doit y écrire les fichiers assemblés, allégés.
    (construction?.writeBundle as (s: { dir: string }) => void).call({}, { dir: sortie });
    for (const servi of ['v10/app.js', 'v10/cabinet/app.js', 'plateforme/pont.js']) {
      expect(fs.readFileSync(path.join(sortie, servi), 'utf8'), servi).toBe(scriptSansCommentaires(servi, lireEcran(servi)));
    }
    // Le serveur de développement : un intermédiaire sert le fichier assemblé à la volée, relu à chaque demande.
    const dev = plugins.find((p) => p?.name === 'skanfact-assemblage-a-la-volee');
    let intermediaire: ((d: IncomingMessage, r: ServerResponse, s: () => void) => void) | undefined;
    (dev?.configureServer as (s: unknown) => void)({ middlewares: { use: (f: typeof intermediaire) => { intermediaire = f; } } });
    const servir = (url: string) => {
      const reponse: { entetes: Record<string, string>; corps?: Buffer; suite: boolean } = { entetes: {}, suite: false };
      intermediaire?.({ url } as IncomingMessage, { setHeader: (k: string, v: string) => { reponse.entetes[k] = v; }, end: (b: Buffer) => { reponse.corps = b; } } as unknown as ServerResponse, () => { reponse.suite = true; });
      return reponse;
    };
    const core = servir('/v10/core.js?v=1');
    expect(core.suite).toBe(false);
    expect(core.entetes['Content-Type']).toMatch(/javascript/);
    expect(core.corps?.toString('utf8')).toBe(lireEcran('v10/core.js'));
    expect(servir('/plateforme/paie.css').entetes['Content-Type']).toMatch(/text\/css/);
    // Ce qui ne s'assemble pas passe à Vite, qui le sert de web/public.
    expect(servir('/v10/listes.js').suite).toBe(true);
  });

  it('aucun code de Node ne lit un fichier assemblé en direct sous web/public : il passe par lireEcran', () => {
    const servis = Object.keys(lireTable());
    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const e of fs.readdirSync(path.join(RACINE_DU_DEPOT, dossier), { withFileTypes: true })) {
        const rel = `${dossier}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== 'node_modules') parcourir(rel); continue; }
        // L'assembleur lui-même, et les tests dont les petits dépôts à part ont leur propre web/public.
        if (!/\.ts$/.test(e.name) || ['commun/assemblage.ts', 'tests/commun/assemblage.test.ts', 'tests/commun/frontieres.test.ts', 'tests/commun/preuves-suivent.test.ts'].includes(rel)) continue;
        // Le code seul : un commentaire qui cite le fichier n'est pas une lecture.
        const code = scriptSansCommentaires(rel, fs.readFileSync(path.join(RACINE_DU_DEPOT, rel), 'utf8'));
        if (/web\/public\/(v10|plateforme)(['`]|\/\$\{)/.test(code)) fautifs.push(`${rel} : un dossier des écrans lu en entier (web/public/v10 ou plateforme)`);
        for (const s of servis) if (code.includes(`web/public/${s}`)) fautifs.push(`${rel} : ${s}`);
      }
    };
    for (const d of ['serveur', 'commun', 'moteur', 'outils', 'tests', 'exploitation']) if (fs.existsSync(path.join(RACINE_DU_DEPOT, d))) parcourir(d);
    expect(fautifs).toEqual([]);
  });
});
