// Les règles des déclarations lues dans les écritures (moteur/declarations.ts).

import { describe, expect, it } from 'vitest';
import { chaineTva, declarationTva, finDeMois, mouvement, type EcritureDatee } from '../../moteur/declarations.ts';

const C = { tvaCollectee: '4367', tvaDeductible: '4366', timbre: '4368', retenueSubie: '4358', retenueOperee: '4352' };
const l = (compte: string, debit: bigint, credit: bigint) => ({ compte, debit, credit });
const JOURNAL: EcritureDatee[] = [
  { date: '2026-01-31', lignes: [l('411', 1_191_000n, 0n), l('706', 0n, 1_000_000n), l('4367', 0n, 190_000n), l('4368', 0n, 1_000n)] },
  { date: '2026-02-01', lignes: [l('606', 2_000_000n, 0n), l('4366', 380_000n, 0n), l('401', 0n, 2_380_000n)] },
  { date: '2026-02-15', lignes: [l('532', 985_000n, 0n), l('411', 0n, 1_000_000n), l('4358', 15_000n, 0n)] },
  { date: '2026-03-10', lignes: [l('411', 595_500n, 0n), l('706', 0n, 500_000n), l('4367', 0n, 95_000n), l('4368', 0n, 500n)] },
  { date: '2026-03-20', lignes: [l('401', 1_000_000n, 0n), l('532', 0n, 985_000n), l('4352', 0n, 15_000n)] },
];

describe('les déclarations lues dans les écritures', () => {
  it('le mouvement d\'un compte ne compte que les écritures de la période, bornes comprises', () => {
    expect(mouvement(JOURNAL, '4367', '2026-01-01', '2026-01-31')).toBe(-190_000n);
    expect(mouvement(JOURNAL, '4367', '2026-02-01', '2026-02-28')).toBe(0n);
    expect(finDeMois(2028, 2)).toBe('2028-02-29');
  });

  it('un crédit de TVA se reporte sur le mois suivant, jusqu\'à épuisement', () => {
    const [janvier, fevrier, mars] = chaineTva(JOURNAL, 2026, C, 10_000n);
    // Janvier : 190 collectés, moins 10 reportés : 180 à payer, et le timbre.
    expect([janvier?.collectee, janvier?.reportRecu, janvier?.aPayer, janvier?.creditReporte, janvier?.timbres]).toEqual([190_000n, 10_000n, 180_000n, 0n, 1_000n]);
    // Février : 380 déductibles, rien de collecté : un crédit de 380, et 15 de retenue subie.
    expect([fevrier?.deductible, fevrier?.aPayer, fevrier?.creditReporte, fevrier?.retenuesSubies]).toEqual([380_000n, 0n, 380_000n, 15_000n]);
    // Mars : 95 collectés, moins le crédit de 380 : il en reste 285 ; 15 de retenue opérée.
    expect([mars?.reportRecu, mars?.aPayer, mars?.creditReporte, mars?.retenuesOperees]).toEqual([380_000n, 0n, 285_000n, 15_000n]);
  });

  it('un report négatif ne se reçoit pas', () => {
    expect(declarationTva(JOURNAL, '2026-01-01', '2026-01-31', C, -5n).reportRecu).toBe(0n);
  });
});
