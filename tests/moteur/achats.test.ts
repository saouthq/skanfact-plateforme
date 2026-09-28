// Les règles du calcul d'un achat (moteur/achats.ts), sur des exemples calculés à la main.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import {
  calculerAchat, ecritureDAchat, ecritureDeReglementFournisseur, ecritureDImputationAcompte, soldeAchat, statutAchat,
  type Achat, type ComptesAchat, type LigneAchat, type RattachementAchat,
} from '../../moteur/achats.ts';

const EUR = { code: 'EUR', decimales: 2 };
const achat = (lignes: LigneAchat[], autre: Partial<Achat> = {}): Achat => ({ nature: 'facture', devise: TND, lignes, tvaRecuperable: true, ...autre });
// 3 × 12,345 DT à 19 % : HT 37,035 ; TVA 7,036 65 → 7,037.
const LIGNE: LigneAchat = { quantite: 3_000n, prixUnitaire: 12_345_000n, tauxTva: 190_000n };

describe('le calcul d\'un achat', () => {
  it('chaque ligne s\'arrondit au millime, les frais s\'ajoutent au TTC, la retenue porte sur le TTC hors frais', () => {
    const t = calculerAchat(achat([LIGNE], { frais: 1_000n, tauxRetenue: 15_000n }), TND);
    expect([t.totalHT, t.totalTVA, t.tvaDeductible, t.totalTTC]).toEqual([37_035n, 7_037n, 7_037n, 45_072n]);
    // 1,5 % de 44,072 = 0,661 08 → 0,661 ; net 45,072 − 0,661.
    expect([t.retenue, t.netAPayer]).toEqual([661n, 44_411n]);
    expect(t.parDestination).toEqual({ charge: 37_035n, stock: 0n, immobilisation: 0n });
  });

  it('une TVA non déductible entre dans le coût de ce qu\'elle a payé ; une entreprise non assujettie n\'en déduit aucune', () => {
    const voiture: LigneAchat = { quantite: 1_000n, prixUnitaire: 30_000_000_000n, tauxTva: 190_000n, destination: 'immobilisation', nonDeductible: true };
    const t = calculerAchat(achat([voiture, LIGNE]), TND);
    expect(t.tvaDeductible).toBe(7_037n);
    expect(t.base.cout).toEqual({ charge: 37_035n, stock: 0n, immobilisation: 35_700_000n });
    const nonAssujettie = calculerAchat(achat([LIGNE], { tvaRecuperable: false }), TND);
    expect(nonAssujettie.tvaDeductible).toBe(0n);
    expect(nonAssujettie.base.cout.charge).toBe(44_072n);
  });

  it('en dinars de la comptabilité, un avoir retire et un acompte n\'est pas une charge mais une avance', () => {
    const avoir = calculerAchat(achat([LIGNE], { nature: 'avoir', frais: 1_000n }), TND);
    expect([avoir.base.totalHT, avoir.base.totalTTC, avoir.base.parDestination.charge]).toEqual([-37_035n, -45_072n, -37_035n]);
    const acompte = calculerAchat(achat([LIGNE], { nature: 'acompte', frais: 1_000n }), TND);
    expect(acompte.base.parDestination).toEqual({ charge: 0n, stock: 0n, immobilisation: 0n });
    expect(acompte.base.frais).toBe(0n);
    expect(acompte.base.avance).toBe(38_035n);
    // Un achat en euros se convertit au cours de la pièce : 99,99 € à 3,38 = 337,966 2 → 337,966 DT.
    const euros = calculerAchat(achat([{ quantite: 1_000n, prixUnitaire: 99_990_000n, tauxTva: 0n }], { devise: EUR, cours: 3_380_000n }), TND);
    expect([euros.totalHT, euros.base.totalHT]).toEqual([9_999n, 337_966n]);
  });
});

const COMPTES: ComptesAchat = {
  fournisseurs: '401', charges: '606', achatsStock: '607', immobilisations: '22', fraisAccessoires: '608',
  tvaDeductible: '4366', avancesFournisseurs: '409', gainsChange: '755', pertesChange: '655', retenueOperee: '4352',
};
const ecrire = (a: Achat, r?: RattachementAchat) => ecritureDAchat(calculerAchat(a, TND), a, TND, COMPTES, r).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);

describe('l\'écriture d\'un achat', () => {
  it('une facture : la charge au HT, les frais, la TVA déductible ; le fournisseur crédité du brut (la retenue naît au règlement)', () => {
    expect(ecrire(achat([LIGNE], { frais: 1_000n, tauxRetenue: 15_000n }))).toEqual(['606 37035 0', '608 1000 0', '4366 7037 0', '401 0 45072']);
  });

  it('la TVA non déductible grossit le coût de ce qu\'elle a payé, jusqu\'à l\'immobilisation', () => {
    const voiture: LigneAchat = { quantite: 1_000n, prixUnitaire: 30_000_000_000n, tauxTva: 190_000n, destination: 'immobilisation', nonDeductible: true };
    expect(ecrire(achat([voiture]))).toEqual(['22 30000000 0', '22 5700000 0', '401 0 35700000']);
  });

  it('un acompte va aux avances, sa TVA non récupérable aussi ; son imputation les reprend à la facture', () => {
    expect(ecrire(achat([LIGNE], { nature: 'acompte', frais: 1_000n }))).toEqual(['409 38035 0', '4366 7037 0', '401 0 45072']);
    expect(ecrire(achat([LIGNE], { nature: 'acompte', frais: 1_000n, tvaRecuperable: false }))).toEqual(['409 38035 0', '409 7037 0', '401 0 45072']);
    const acompte = achat([LIGNE], { nature: 'acompte', frais: 1_000n });
    expect(ecritureDImputationAcompte(calculerAchat(acompte, TND), acompte, { devise: TND }, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`))
      .toEqual(['401 45072 0', '409 0 38035', '4366 0 7037']);
  });

  it('un avoir s\'écrit à l\'envers ; rattaché, il règle le fournisseur au cours de la facture et régularise la retenue', () => {
    expect(ecrire(achat([LIGNE], { nature: 'avoir' }))).toEqual(['606 0 37035', '4366 0 7037', '401 44072 0']);
    // 100 € d'avoir à 3,40 sur une facture à 3,35 : la charge baisse de 340 DT, la dette de 335 : une perte de 5.
    const avoir = achat([{ quantite: 1_000n, prixUnitaire: 100_000_000n, tauxTva: 0n }], { nature: 'avoir', devise: EUR, cours: 3_400_000n });
    expect(ecrire(avoir, { facture: { devise: EUR, cours: 3_350_000n }, brutImpute: 10_000n, regularisationRetenue: 0n }))
      .toEqual(['606 0 340000', '401 335000 0', '655 5000 0']);
    expect(ecrire(achat([LIGNE], { nature: 'avoir' }), { facture: { devise: TND }, brutImpute: 44_072n, regularisationRetenue: 1_250n }))
      .toEqual(['606 0 37035', '4366 0 7037', '401 44072 0', '4352 0 1250', '401 1250 0']);
  });

  it('en devise, l\'écart de conversion va au change, jamais avalé par une autre ligne', () => {
    // 1 € en charge à 19 % et 1 € en stock, à 3,3517 : 3,352 + 3,352 + 0,637 = 7,341 ; le TTC, 2,19 € × 3,3517 = 7,340.
    const a = achat([{ quantite: 1_000n, prixUnitaire: 1_000_000n, tauxTva: 190_000n }, { quantite: 1_000n, prixUnitaire: 1_000_000n, tauxTva: 0n, destination: 'stock' }],
      { devise: EUR, cours: 3_351_700n });
    expect(ecrire(a)).toEqual(['606 3352 0', '607 3352 0', '4366 637 0', '401 0 7340', '755 0 1']);
  });
});

describe('les règlements d\'un achat', () => {
  const C = { fournisseurs: '401', tresorerie: '532', retenueOperee: '4352', gainsChange: '755', pertesChange: '655' };
  const regler = (piece: Parameters<typeof ecritureDeReglementFournisseur>[0], montant: bigint, part: bigint, cours?: bigint) =>
    ecritureDeReglementFournisseur(piece, { cle: 'p', date: '2026-03-01', montant, cours }, part, TND, C).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);

  it('le fournisseur est soldé de ce qu\'on lui verse et de la retenue qu\'on garde : c\'est ici qu\'elle naît', () => {
    expect(regler({ nature: 'facture', devise: TND }, 985_000n, 15_000n)).toEqual(['401 1000000 0', '532 0 985000', '4352 0 15000']);
  });

  it('en devise, la banque paie au cours du jour et le fournisseur se solde au cours de sa facture : l\'écart est du change', () => {
    // 1 000 € payés à 3,40 sur une facture à 3,35 : 3 400 DT sortent, la dette baisse de 3 350 : une perte.
    expect(regler({ nature: 'facture', devise: EUR, cours: 3_350_000n }, 100_000n, 0n, 3_400_000n)).toEqual(['401 3350000 0', '532 0 3400000', '655 50000 0']);
    expect(regler({ nature: 'facture', devise: EUR, cours: 3_350_000n }, 100_000n, 0n, 3_300_000n)).toEqual(['401 3350000 0', '532 0 3300000', '755 0 50000']);
  });

  it('le remboursement d\'un avoir fournisseur fait entrer l\'argent : chaque ligne change de colonne', () => {
    expect(regler({ nature: 'avoir', devise: TND }, 100_000n, 0n)).toEqual(['401 0 100000', '532 100000 0']);
  });

  it('le reste d\'un achat et son statut', () => {
    const t = calculerAchat(achat([{ quantite: 1_000n, prixUnitaire: 1_000_000_000n, tauxTva: 0n }]), TND);
    const partiel = soldeAchat(t, 'facture', false, [300_000n], [200_000n]);
    expect(partiel).toEqual({ paye: 300_000n, impute: 200_000n, reste: 500_000n });
    expect(statutAchat('facture', false, partiel, '2026-01-01', '2026-09-28')).toBe('partiel');
    const rien = soldeAchat(t, 'facture', false, []);
    expect(statutAchat('facture', false, rien, '2026-09-27', '2026-09-28')).toBe('en_retard');
    expect(statutAchat('facture', false, rien, '2026-09-28', '2026-09-28')).toBe('a_payer');
    expect(statutAchat('facture', false, soldeAchat(t, 'facture', false, [1_000_000n]), undefined, '2026-09-28')).toBe('payee');
    // Un avoir : imputé quand il est rattaché ; libre, un crédit détenu jusqu'à ce qu'il soit remboursé en entier.
    expect(soldeAchat(t, 'avoir', true, [400_000n]).reste).toBe(0n);
    expect(statutAchat('avoir', true, soldeAchat(t, 'avoir', true, []), undefined, '2026-09-28')).toBe('impute');
    expect(soldeAchat(t, 'avoir', false, [400_000n]).reste).toBe(-600_000n);
    expect(statutAchat('avoir', false, soldeAchat(t, 'avoir', false, [400_000n]), undefined, '2026-09-28')).toBe('a_imputer');
    expect(statutAchat('avoir', false, soldeAchat(t, 'avoir', false, [1_000_000n]), undefined, '2026-09-28')).toBe('rembourse');
  });
});

