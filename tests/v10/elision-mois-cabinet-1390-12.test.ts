// (1.390.12, issue 9, CABDECLARER-39 / N3) « La déclaration de octobre 2026 est déposée ? », « Annuler le dépôt de octobre
// 2026 ? » : un mois qui commence par une voyelle s'élide (« d'octobre », « d'avril », « d'août »). Le Cabinet a sa règle
// (`K.de`) ; une phrase qui écrit « de ${K.monthLabel(…)} » à la main l'oublie pour trois mois sur douze.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ICI = path.join(import.meta.dirname, '../../modules/socle/ecrans/cabinet');

describe('les mois du Cabinet s\'élident', () => {
  it('aucune phrase n\'écrit « de » devant un mois à la main : elle passe par K.de', () => {
    const fautes = ['app-1.js', 'app-2.js'].flatMap((f) => fs.readFileSync(path.join(ICI, f), 'utf8').split('\n')
      .map((l, i) => [`${f}:${i + 1}`, l] as const)
      .filter(([, l]) => /\bde \$\{(esc\()?K\.monthLabel\(/.test(l)));
    expect(fautes.map(([o]) => o)).toEqual([]);
  });
});
