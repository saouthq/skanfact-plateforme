// « À VÉRIFIER avec le comptable »… affiché au comptable (1.378.6 ; issue 9, CABDECLARER-28). Le moteur comptable sert
// les deux applications : dans le Cabinet la mention renvoie aux textes, dans l'application du client à son comptable.

import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Cases = Record<string, { motif?: string }>;
type KC = { livreVide: (id: string, a: number) => unknown; declarationMensuelle: (l: unknown, p: string) => { cases: Cases } };
const motifTcl = () => {
  const kc = ecranDeLaPlateforme('compta.js') as KC;
  return String(kc.declarationMensuelle(kc.livreVide('d1', 2026), '2026-10').cases.acomptes?.motif);
};
const monde = globalThis as { location?: unknown };

describe('la mention « À VÉRIFIER » suit celui qui la lit', () => {
  afterEach(() => { delete monde.location; });

  it('dans le Cabinet, elle renvoie aux textes — jamais « avec le comptable »', () => {
    monde.location = { pathname: '/v10/cabinet/' };
    expect(motifTcl()).toContain('À VÉRIFIER dans les textes en vigueur.');
    expect(motifTcl()).not.toContain('avec le comptable');
  });

  it('dans l\'application du client, elle renvoie à son comptable', () => {
    monde.location = { pathname: '/v10/' };
    expect(motifTcl()).toContain('À VÉRIFIER avec le comptable.');
  });

  it('les écrans du Cabinet ne disent plus « avec le comptable »', () => {
    for (const f of ['modules/socle/ecrans/cabinet/app-1.js', 'modules/socle/ecrans/cabinet/app-2.js', 'modules/personnel/ecrans/cabinet/paie.js']) {
      const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, f).not.toMatch(/VÉRIFIER(<\/b>)? avec (le|ton) comptable/);
    }
  });
});
