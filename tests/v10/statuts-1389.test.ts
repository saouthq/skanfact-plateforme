// 1.389.10 (ENTSOCLE-17) — un statut de pièce se dit partout avec le mot des listes : la fiche d'une affaire et la page
// des licences écrivaient la VALEUR du moteur (« envoyée ») là où la liste des factures écrit « émise ».
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(racine, f), 'utf8');
// Le CODE seul : un commentaire qui cite la règle ne doit pas la satisfaire.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
const ECRANS = ['modules/socle/ecrans/entreprise/app-1.js', 'modules/socle/ecrans/entreprise/app-2.js'];

describe('le statut d\'une pièce se dit avec le mot des listes (ENTSOCLE-17)', () => {
  it('aucun badge n\'écrit la valeur brute de effStatus : il passe par statusBadge (ou statusLabel)', () => {
    for (const f of ECRANS) {
      const s = code(lire(f));
      // La valeur brute en TEXTE d'un badge : « >${h(effStatus(…)) ».
      const bruts = s.match(/class="badge[^"]*">\$\{h\(effStatus\(/g) || [];
      expect(bruts, f).toEqual([]);
    }
    const app1 = code(lire(ECRANS[0] as string));
    expect(app1).toMatch(/\{ label: 'Statut', cls: 'st', get: d => statusBadge\(d\) \}/);
    expect(code(lire(ECRANS[1] as string))).toMatch(/d\.status !== 'brouillon' \? ` \$\{statusBadge\(d\)\}` : ''/);
  });
  it('statusBadge dit « émise » d\'une facture émise, jamais « envoyée »', () => {
    const app1 = lire(ECRANS[0] as string);
    expect(app1).toMatch(/function badge\(status, type\) \{ return `<span class="badge \$\{h\(status\)\}">\$\{h\(C\.statusLabel\(status, type\)\)\}<\/span>`; \}/);
    expect(app1).toMatch(/function statusBadge\(doc\) \{ return badge\(etatAffichePiece\(doc\), doc && doc\.type\); \}/);
  });
});
