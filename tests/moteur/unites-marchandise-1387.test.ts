// (1.387.69, issue 13, ENTACHATS-20) Les unités de la marchandise. Les unités proposées étaient de service (heure, jour,
// licence, poste…) : ni pièce, ni carton, ni bouteille, et « pièce » importé d'un tableur devenait « u ».
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const C = ecranDeLaPlateforme('core.js') as {
  LINE_UNITS: [string, string][];
  UNITES_MARCHANDISE: string[];
  uniteImport: (v: unknown) => string;
  uniteAccordee: (n: number, u: string) => string;
};

describe('les unités de la marchandise (issue 13, ENTACHATS-20)', () => {
  it('pièce, carton, paquet, sac, boîte et bouteille sont proposées ; « pièce » importé reste « pièce » ; elles s\'accordent', () => {
    const codes = C.LINE_UNITS.map(([c]) => c);
    for (const u of ['pièce', 'carton', 'paquet', 'sac', 'boîte', 'bouteille']) expect(codes).toContain(u);
    for (const u of C.UNITES_MARCHANDISE) expect(codes).toContain(u);
    expect(new Set(codes).size).toBe(codes.length);
    expect(C.uniteImport('pièce')).toBe('pièce');
    expect(C.uniteImport('Piece')).toBe('pièce');
    expect(C.uniteImport('Carton')).toBe('carton');
    expect(C.uniteImport('pce')).toBe('u');
    expect(C.uniteImport('kilos')).toBe('kg');
    expect(C.uniteAccordee(3, 'pièce')).toBe('pièces');
    expect(C.uniteAccordee(1, 'pièce')).toBe('pièce');
    expect(C.uniteAccordee(12, 'boîte')).toBe('boîtes');
    expect(C.uniteAccordee(5, 'kg')).toBe('kg');
  });
});
