// Les consignes que Claude relit à CHAQUE échange de chaque session (CLAUDE.md) restent courtes. Le 13/10/2026, les deux
// CLAUDE.md relus à chaque échange — celui-ci, et celui du dépôt skanfact, que la session avait repris de `main` —
// pesaient 860 Ko : la conversation se compactait toutes les dix minutes. Le catalogue des briques vit dans
// docs/carte.md ; ici, un plafond, et des renvois qui mènent quelque part.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const PLAFOND_CONSIGNES = 32_000;

describe('les consignes de Claude', () => {
  it('CLAUDE.md reste sous 32 000 octets : ce qu\'une brique a appris va dans docs/carte.md', () => {
    const octets = Buffer.byteLength(lire('CLAUDE.md'), 'utf8');
    expect(octets, `CLAUDE.md pèse ${octets} octets : le récit d'une brique va dans docs/carte.md, ici une règle en une ligne`)
      .toBeLessThanOrEqual(PLAFOND_CONSIGNES);
    // La carte existe, et les consignes y renvoient : sans elle, ce qu'on a retiré d'ici serait perdu.
    expect(lire('docs/carte.md')).toMatch(/^# La carte de la plateforme/);
    expect(lire('CLAUDE.md')).toContain('`docs/carte.md`');
  });

  it('chaque fichier que les consignes et la carte citent existe', () => {
    // Un renvoi mort est une phrase que rien ne tient (v10, 7.3.0) — pire ici : c'est Claude qui le suit. Un chemin de
    // l'autre dépôt s'écrit avec son nom (`skanfact/docs/…`) ; un modèle (`docs/<domaine>.md`) n'est pas un fichier.
    const morts: string[] = [];
    for (const doc of ['CLAUDE.md', 'docs/carte.md']) {
      for (const [, chemin] of lire(doc).matchAll(/`((?:docs|tests|serveur|web|base|exploitation|scripts|textes|moteur|banc)\/[^`\s]*)`/g)) {
        if (!chemin || /[<>*…]|NNNN/.test(chemin)) continue;
        if (!fs.existsSync(path.join(RACINE, chemin.replace(/[,.;:]+$/, '')))) morts.push(`${doc} : ${chemin}`);
      }
    }
    expect(morts).toEqual([]);
  });
});
