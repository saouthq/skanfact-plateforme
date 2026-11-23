// (issue 4, ENTREE-13) La bulle d'une visite nomme le bouton comme la personne le LIT : « Nouvelle facture », jamais
// « Nouvelle facture NF » (les touches de raccourci sont des <kbd aria-hidden>). Et au doigt, sans clavier, la bulle ne
// propose pas l'astuce des flèches.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = fs.readFileSync('web/public/v10/visite.js', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const corps = (nom: string) => { const i = code.indexOf(`function ${nom}(`); return code.slice(i, code.indexOf('\n  }\n', i)); };

describe('la bulle d\'une visite (issue 4, ENTREE-13)', () => {
  it('le bouton visé se nomme par le libellé lu, sans ses touches ; pas d\'astuce clavier au doigt', () => {
    const cible = corps('libelleCible');
    expect(cible.length).toBeGreaterThan(40);
    expect(cible).toMatch(/const t = libelleDe\(el\);/);
    expect(cible).not.toMatch(/el\.textContent/);
    // libelleDe retire ce qui n'est pas lu (les touches, la bulle « i »).
    expect(corps('libelleDe')).toMatch(/aria-hidden/);
    expect(code).toMatch(/const astuce = cur\.vues <= 1 && !faire && !cur\.perdu && !\(global\.matchMedia && global\.matchMedia\('\(pointer: coarse\)'\)\.matches\)/);
  });
});
