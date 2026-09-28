// Les règles du bulletin de paie (moteur/paie.ts), sur un bulletin calculé entièrement à la main.
// Les taux ci-dessous sont des DONNÉES de test (ceux de la v10), jamais des valeurs du moteur.

import { describe, expect, it } from 'vitest';
import { calculerBulletin, ecritureDeBulletin, ecritureDePaiementSalaire, irppAnnuel, type BaremePaie } from '../../moteur/paie.ts';

const TRANCHES = [
  { jusqua: 5_000_000n, taux: 0n }, { jusqua: 10_000_000n, taux: 150_000n }, { jusqua: 20_000_000n, taux: 250_000n },
  { jusqua: 30_000_000n, taux: 300_000n }, { jusqua: null, taux: 400_000n },
];
const BAREME: BaremePaie = {
  cnssSalarie: 91_800n, cnssEmployeur: 165_700n, accidentTravail: 4_000n, tfp: 20_000n, foprolos: 10_000n, solidarite: 10_000n,
  fraisPro: 100_000n, plafondFraisPro: 2_000_000n, chefDeFamille: 300_000n, parEnfant: 100_000n, enfantsMax: 4, tranches: TRANCHES,
};

describe('le bulletin de paie', () => {
  it('un bulletin complet, ligne par ligne', () => {
    const b = calculerBulletin({ chefDeFamille: true, enfants: 2 }, {
      brut: 1_234_567n, joursOuvrables: 26_000n, joursAbsence: 500n,
      primes: [{ montant: 100_000n, imposable: true }, { montant: 50_000n, imposable: false }], retenues: [20_000n],
    }, BAREME);
    // Une demi-journée d'absence : 1 234,567 × 0,5 / 26 = 23,741 67 → 23,742.
    expect(b.retenueAbsence).toBe(23_742n);
    expect([b.brut, b.assietteCnss]).toEqual([1_360_825n, 1_310_825n]);
    // CNSS 9,18 % de 1 310,825 = 120,333 7 → 120,334 ; reste 1 190,491, soit 14 285,892 par an.
    expect([b.cnssSalarie, b.apresCnss, b.imposableAnnuelAvantDeductions]).toEqual([120_334n, 1_190_491n, 14_285_892n]);
    // Frais professionnels 10 % (sous le plafond) : 1 428,589 ; famille 300 + 2 × 100.
    expect([b.fraisPro, b.deductionsFamille, b.imposableAnnuel]).toEqual([1_428_589n, 500_000n, 12_357_303n]);
    // IRPP : 5 000 × 15 % + 2 357,303 × 25 % = 1 339,325 75 → 1 339,326 ; par mois 111,610 5 → 111,611.
    expect([b.irppAnnuel, b.irpp]).toEqual([1_339_326n, 111_611n]);
    // Solidarité 1 % de 12 357,303, par mois : 10,297 75 → 10,298.
    expect(b.css).toBe(10_298n);
    expect(b.net).toBe(1_098_582n);
    // Charges patronales : 217,204 + 5,243 + 26,217 + 13,108.
    expect([b.cnssEmployeur, b.accidentTravail, b.tfp, b.foprolos, b.chargesPatronales, b.coutEmployeur])
      .toEqual([217_204n, 5_243n, 26_217n, 13_108n, 261_772n, 1_622_597n]);
  });

  it('le barème progressif ne taxe chaque tranche que sur la part du revenu qu\'elle contient', () => {
    expect(irppAnnuel(4_999_999n, TRANCHES)).toBe(0n);
    expect(irppAnnuel(7_000_000n, TRANCHES)).toBe(300_000n);               // 2 000 × 15 %
    expect(irppAnnuel(35_000_000n, TRANCHES)).toBe(8_250_000n);            // 750 + 2 500 + 3 000 + 2 000
    expect(irppAnnuel(-1n, TRANCHES)).toBe(0n);
  });

  it('un régime sans IRPP n\'en retient pas ; les enfants au-delà du plafond ne comptent pas', () => {
    const saisie = { brut: 3_000_000n, joursOuvrables: 26_000n };
    expect(calculerBulletin({}, saisie, { ...BAREME, sansIrpp: true }).irpp).toBe(0n);
    expect(calculerBulletin({ enfants: 6 }, saisie, BAREME).deductionsFamille).toBe(400_000n);
  });

  it('l\'écriture du bulletin : le brut et les charges au débit ; l\'État, la CNSS et le salarié au crédit', () => {
    const b = calculerBulletin({ chefDeFamille: true, enfants: 2 }, {
      brut: 1_234_567n, joursOuvrables: 26_000n, joursAbsence: 500n,
      primes: [{ montant: 100_000n, imposable: true }, { montant: 50_000n, imposable: false }], retenues: [20_000n],
    }, BAREME);
    const C = { salairesBruts: '640', chargesPatronales: '645', taxesSalaires: '661', tfpFoprolos: '4335', cnss: '4531', irpp: '4321', personnel: '425' };
    expect(ecritureDeBulletin(b, C).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`)).toEqual([
      '640 1360825 0', '645 222447 0', '661 39325 0',
      '4335 0 39325', '4531 0 342781', '4321 0 121909', '425 0 1118582',   // le net 1 098,582 et la retenue 20,000
    ]);
    expect(ecritureDePaiementSalaire(b.net, { personnel: '425', tresorerie: '532' }).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`))
      .toEqual(['425 1098582 0', '532 0 1098582']);
    // Un bulletin au net négatif ne s'écrit jamais.
    expect(() => ecritureDeBulletin({ ...b, net: -1n }, C)).toThrow(/ne s'écrit pas/);
  });
});

