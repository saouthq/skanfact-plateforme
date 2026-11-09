// (1.330.0) La frise de la paie dit « la déclaration d'octobre », jamais « de octobre » (avril et août aussi) ; mars garde son « de ».
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type Etape = { titre: string; dit: string };
type Core = { paieDuMois: (d: unknown, y: number, m: number) => { etapes: Etape[]; etatDit?: string } };
const charger = (f: string, req: (n: string) => unknown) => {
  const m = { exports: {} as unknown };
  vm.runInNewContext(lireEcran(f), { module: m, exports: m.exports, require: req, console });
  return m.exports;
};
const compta = charger('v10/compta.js', () => { throw new Error('compta.js ne charge rien'); });
const core = charger('v10/core.js', () => compta) as Core;

describe('(1.330.0) la déclaration du mois, élidée devant une voyelle', () => {
  it('« d’octobre », « d’avril », « d’août », mais « de mars »', () => {
    const d = { company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees: [{ id: 'e1', name: 'Hédi Trabelsi', grossSalary: 1250, hireDate: '2023-03-01',
      contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'especes', iban: '', cnss: '', position: 'Boulanger' }],
    payslips: [], timesheets: [], leaves: [], advances: [] };
    const declarer = (m: number) => String(core.paieDuMois(d, 2026, m).etapes.find((e) => e.titre === 'Déclarer')?.dit);
    expect(declarer(10)).toBe('la retenue avec la déclaration d’octobre · la CNSS au trimestre');
    expect(declarer(4)).toContain('déclaration d’avril');
    expect(declarer(8)).toContain('déclaration d’août');
    expect(declarer(3)).toContain('déclaration de mars');
  });
});
