// Le plancher des navigateurs (1.112.0 ; commun/navigateurs.ts ; VISION § 4.1). Ce que le test tient, sur les écrans tels
// qu'ils sont construits et servis :
//   - chaque script se lit dans la syntaxe du plancher (ES2022) : la v10 et ses adaptations partent sans transformation,
//     et Vite ne réécrit que la syntaxe de l'entrée et de la console, jamais les fonctions qu'elles appellent ;
//   - aucun script n'appelle une fonction plus jeune que le plancher (la liste ci-dessous, chacune avec le premier
//     navigateur qui l'a) ;
//   - aucune feuille de style n'emboîte ses règles ni n'use d'une règle plus jeune que le plancher : un navigateur qui ne
//     la lit pas laisse tomber la règle entière, sans rien dire.
// Ce qu'il ne tient pas : le rendu dans Firefox et Safari eux-mêmes (ni l'un ni l'autre n'est sur la machine des
// essais) ; il se voit sur un vrai appareil (docs/repetition-generale.md).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANCHER, SYNTAXE_DU_PLANCHER } from '../../commun/navigateurs.ts';

const RACINE = path.join(import.meta.dirname, '../..');

// Les fonctions plus jeunes que le plancher, avec le premier navigateur du plancher qui ne les a pas.
const FONCTIONS_TROP_JEUNES: [RegExp, string][] = [
  [/\bObject\.groupBy\b|\bMap\.groupBy\b/, 'Object.groupBy (Chrome 117, Safari 17.4)'],
  [/\bPromise\.withResolvers\b/, 'Promise.withResolvers (Chrome 119, Safari 17.4)'],
  [/\bArray\.fromAsync\b/, 'Array.fromAsync (Chrome 121)'],
  [/\.(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, 'les opérations des ensembles (Chrome 122, Safari 17)'],
  [/\bURL\.(?:canParse|parse)\b/, 'URL.canParse et URL.parse (Chrome 120, Safari 17)'],
  [/\bIntl\.DurationFormat\b/, 'Intl.DurationFormat (Chrome 129)'],
  [/\bIterator\.from\b/, 'les aides des itérateurs (Chrome 122, Safari 18.4)'],
  [/\bRegExp\.escape\b/, 'RegExp.escape (Chrome 136, Safari 18.2)'],
];

// Ce qu'une feuille de style ne peut pas écrire : ce qui, ignoré, CASSE la mise en page (des règles emboîtées, Chrome 112
// et Safari 16.5 ; une portée ; un ancrage). Ce qu'un navigateur plus ancien ignore sans dommage reste permis : un champ
// qui grandit avec son texte (field-sizing), un titre équilibré (text-wrap), une entrée animée (@starting-style).
const STYLES_TROP_JEUNES: [RegExp, string][] = [
  [/\{[^{}]*&[^{}]*\{/, 'des règles emboîtées « & » (Chrome 112, Safari 16.5)'],
  [/@scope\b/, '@scope (Firefox 128)'],
  [/\banchor-name\b|\bposition-anchor\b/, 'l\'ancrage des positions (Chrome 125, Firefox et Safari pas encore)'],
];

let dossier = '';
const fichiers = (ext: string) => (fs.readdirSync(dossier, { recursive: true }) as string[])
  .filter((f) => f.endsWith(ext) && !f.split(path.sep).includes('tiers')).sort();

describe('le plancher des navigateurs', () => {
  beforeAll(async () => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-navigateurs-'));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
  }, 180_000);
  afterAll(() => { fs.rmSync(dossier, { recursive: true, force: true }); });

  it('la construction vise le plancher déclaré, et les écrans servis y sont tous', () => {
    const config = fs.readFileSync(path.join(RACINE, 'web/vite.config.ts'), 'utf8');
    expect(config.match(/target: PLANCHER/g)).toHaveLength(2);
    expect(PLANCHER).toEqual(['chrome111', 'edge111', 'firefox121', 'safari16.4', 'ios16.4']);
    // L'entrée, la console, la v10 et ses deux applications, la plateforme, l'espace client : tous lus plus bas.
    const js = fichiers('.js');
    for (const d of ['assets', 'console/assets', 'v10', 'v10/cabinet', 'plateforme', 'espace']) {
      expect(js.some((f) => path.dirname(f) === d), d).toBe(true);
    }
  });

  it('chaque script se lit en ES2022 et n\'appelle aucune fonction plus jeune que le plancher', () => {
    const refus: string[] = [];
    for (const f of fichiers('.js')) {
      const code = fs.readFileSync(path.join(dossier, f), 'utf8');
      const lu = (sourceType: 'script' | 'module') => { try { parse(code, { ecmaVersion: SYNTAXE_DU_PLANCHER, sourceType }); return null; } catch (e) { return (e as Error).message; } };
      const faute = lu('script') && lu('module');
      if (faute) refus.push(`${f} : ${faute}`);
      for (const [motif, quoi] of FONCTIONS_TROP_JEUNES) if (motif.test(code)) refus.push(`${f} : ${quoi}`);
    }
    expect(refus).toEqual([]);
  });

  it('aucune feuille de style n\'emboîte ses règles ni n\'use d\'une règle plus jeune que le plancher', () => {
    const refus: string[] = [];
    for (const f of fichiers('.css')) {
      const css = fs.readFileSync(path.join(dossier, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [motif, quoi] of STYLES_TROP_JEUNES) if (motif.test(css)) refus.push(`${f} : ${quoi}`);
    }
    expect(refus).toEqual([]);
  });
});
