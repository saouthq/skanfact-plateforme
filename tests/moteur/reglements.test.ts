// Les règles des règlements (moteur/reglements.ts) : des exemples calculés à la main, avec des
// montants qui ne tombent pas ronds, et ce qui doit tenir pour chaque facture tirée au hasard.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import {
  dansLaDeviseDe, ecritureDEncaissement, retenueAuFil, soldeFacture, statutFacture, type ComptesEncaissement, type Reglement,
} from '../../moteur/reglements.ts';
import { hasard } from './v10.ts';

const EUR = { code: 'EUR', decimales: 2 };
const USD = { code: 'USD', decimales: 2 };
const COMPTES: ComptesEncaissement = { clients: '411', tresorerie: '532', retenueSubie: '4358', gainsChange: '755', pertesChange: '655' };
const r = (cle: string, date: string, montant: bigint, cours?: bigint): Reglement => ({ cle, date, montant, cours });
const parts = (x: ReturnType<typeof retenueAuFil>) => Object.fromEntries(x.parts);
const lignes = (piece: Parameters<typeof ecritureDEncaissement>[0], reglement: Reglement, part: bigint) =>
  ecritureDEncaissement(piece, reglement, part, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);

describe('la retenue que le client garde, au fil des règlements', () => {
  it('chaque règlement opère sa part au prorata, arrondie au millime ; celui qui solde prend le reste, dans l\'ordre des dates', () => {
    // Net 985,000 DT, retenue 15,000. 700,000 versés : 15 × 700 / 985 = 10,659 898… → 10,660.
    const x = retenueAuFil(985_000n, 1_000_000n, [], [r('b', '2026-04-01', 285_000n), r('a', '2026-03-01', 700_000n)]);
    expect(parts(x)).toEqual({ a: 10_660n, b: 4_340n });
    expect(x.operee).toBe(15_000n);
    expect(x.due).toBe(15_000n);
    // L'ordre des dates compte : 300 le 1er mars (15 × 300 / 985 = 4,568 5… → 4,569), puis 100 le
    // 1er avril (15 × 400 / 985 = 6,091 3… → 6,091, soit 1,522). Dans l'ordre de saisie : 1,523 et 4,568.
    const y = retenueAuFil(985_000n, 1_000_000n, [], [r('b', '2026-04-01', 100_000n), r('a', '2026-03-01', 300_000n)]);
    expect(parts(y)).toEqual({ a: 4_569n, b: 1_522n });
  });

  it('rien n\'est retenu tant que rien n\'est versé ; un remboursement reprend sa part', () => {
    expect(retenueAuFil(985_000n, 1_000_000n, [], []).operee).toBe(0n);
    // Tout versé (15,000 retenus), puis 100,000 rendus : 15 × 900 / 1 000 = 13,500, soit −1,500.
    const x = retenueAuFil(1_000_000n, 1_015_000n, [], [r('p', '2026-03-01', 1_000_000n), r('rendu', '2026-03-20', -100_000n)]);
    expect(parts(x)).toEqual({ p: 15_000n, rendu: -1_500n });
  });

  it('un avoir posé après un règlement régularise à SA date, sans réécrire le règlement passé', () => {
    // Net 1 000, retenue 10. 500 versés : 5,000. Un avoir de 200 sans retenue : il reste 800 dus et
    // 10 de retenue ; 500 versés en portent 6,250, soit +1,250 à la date de l'avoir. Puis 300 soldent.
    const x = retenueAuFil(1_000_000n, 1_010_000n, [{ cle: 'avoir', date: '2026-04-01', net: 200_000n, brut: 200_000n }],
      [r('p1', '2026-03-01', 500_000n), r('p2', '2026-05-01', 300_000n)]);
    expect(parts(x)).toEqual({ p1: 5_000n, p2: 3_750n });
    expect(Object.fromEntries(x.ajustements)).toEqual({ avoir: 1_250n });
    expect(x.operee).toBe(10_000n);
    // Le même jour que le règlement, l'avoir passe d'abord : pas de régularisation, la part est juste.
    const meme = retenueAuFil(1_000_000n, 1_010_000n, [{ cle: 'avoir', date: '2026-03-01', net: 200_000n, brut: 200_000n }], [r('p1', '2026-03-01', 500_000n)]);
    expect(parts(meme)).toEqual({ p1: 6_250n });
    expect(meme.ajustements.size).toBe(0);
  });

  it('en devise, la part s\'arrondit au centime : une fraction de centime n\'existe sur aucune attestation', () => {
    // Net 100,00 €, retenue 1,50 €. 33,37 € versés : 1,50 × 33,37 / 100 = 0,500 55 € → 0,50 € (la v10 : 0,501 €).
    const x = retenueAuFil(10_000n, 10_150n, [], [r('a', '2026-03-01', 3_337n), r('b', '2026-03-02', 6_663n)]);
    expect(parts(x)).toEqual({ a: 50n, b: 100n });
  });

  it('pour chaque facture tirée au hasard : parts et régularisations font la retenue née, et une facture soldée la porte entière', () => {
    const h = hasard(7);
    for (let i = 0; i < 3000; i++) {
      const net = BigInt(h.entre(1, 5_000_000));
      const brut = net + BigInt(h.entre(0, 200_000));
      const jours = ['2026-01-05', '2026-02-10', '2026-02-10', '2026-03-15', '2026-04-20'];
      const liees = Array.from({ length: h.entre(0, 2) }, (_, k) => {
        const n = BigInt(h.entre(0, Number(net) / 3));
        return { cle: `a${k}`, date: h.parmi(['', ...jours]), net: n, brut: n + BigInt(h.entre(0, 5_000)) };
      });
      const reglements = Array.from({ length: h.entre(0, 4) }, (_, k) => r(`p${k}`, h.parmi(jours), BigInt(h.entre(-50_000, Number(net)))));
      const x = retenueAuFil(net, brut, liees, reglements);
      const somme = [...x.parts.values(), ...x.ajustements.values()].reduce((a, b) => a + b, 0n);
      expect(somme, `tirage ${i}`).toBe(x.operee);
      const verse = reglements.reduce((a, b) => a + b.montant, 0n);
      const netDu = net - liees.reduce((a, b) => a + b.net, 0n);
      if (verse > 0n && verse >= netDu) expect(x.operee, `tirage ${i}`).toBe(x.due);
      if (verse <= 0n) expect(x.operee, `tirage ${i}`).toBe(0n);
    }
  });
});

describe('le reste à payer et le statut d\'une facture', () => {
  it('le reste : le net, moins les avoirs, moins les règlements ; le statut s\'en déduit', () => {
    const net = 1_000_000n;
    const partielle = soldeFacture(net, [200_000n], [300_000n]);
    expect(partielle).toEqual({ credite: 200_000n, paye: 300_000n, reste: 500_000n });
    expect(statutFacture(net, partielle, '2026-01-01', '2026-09-28')).toBe('partielle');
    expect(statutFacture(net, soldeFacture(net, [], [1_000_000n]), undefined, '2026-09-28')).toBe('payee');
    // Un trop-perçu est payé (le remboursement se fait à part).
    expect(statutFacture(net, soldeFacture(net, [], [1_200_000n]), undefined, '2026-09-28')).toBe('payee');
    // Des avoirs qui couvrent toute la facture l'annulent.
    expect(statutFacture(net, soldeFacture(net, [600_000n, 400_000n], []), undefined, '2026-09-28')).toBe('annulee');
    // Rien reçu : en retard le lendemain de l'échéance, pas le jour même.
    const rien = soldeFacture(net, [], []);
    expect(statutFacture(net, rien, '2026-09-27', '2026-09-28')).toBe('en_retard');
    expect(statutFacture(net, rien, '2026-09-28', '2026-09-28')).toBe('a_payer');
    expect(statutFacture(net, rien, undefined, '2026-09-28')).toBe('a_payer');
    // Une facture marquée annulée ne doit plus rien.
    expect(soldeFacture(net, [], [], true).reste).toBe(0n);
    expect(statutFacture(net, soldeFacture(net, [], [], true), '2026-01-01', '2026-09-28', true)).toBe('annulee');
  });

  it('un montant d\'une autre devise passe par le dinar et s\'arrondit à l\'unité de la devise de la facture', () => {
    // 300 DT sur une facture en euros à 3,35 : 89,552… € → 89,55 €.
    expect(dansLaDeviseDe(300_000n, { devise: TND }, { devise: EUR, cours: 3_350_000n }, TND)).toBe(8_955n);
    // 100 € à 3,35 sur une facture en dinars : 335,000 DT.
    expect(dansLaDeviseDe(10_000n, { devise: EUR, cours: 3_350_000n }, { devise: TND }, TND)).toBe(335_000n);
    // 100 € à 3,35 sur une facture en dollars à 3,10 : 335 / 3,10 = 108,064… $ → 108,06 $.
    expect(dansLaDeviseDe(10_000n, { devise: EUR, cours: 3_350_000n }, { devise: USD, cours: 3_100_000n }, TND)).toBe(10_806n);
    // La même devise : tel quel, quel que soit le cours (l'écart de cours est du change).
    expect(dansLaDeviseDe(10_000n, { devise: EUR, cours: 3_400_000n }, { devise: EUR, cours: 3_350_000n }, TND)).toBe(10_000n);
    expect(() => dansLaDeviseDe(300_000n, { devise: TND }, { devise: EUR }, TND)).toThrow(/sans cours/);
  });
});

describe('l\'écriture d\'un encaissement', () => {
  it('la banque reçoit le versé, le client est soldé du versé et de la retenue, et la retenue naît ici', () => {
    expect(lignes({ devise: TND }, r('p', '2026-03-01', 985_000n), 15_000n)).toEqual(['532 985000 0', '411 0 1000000', '4358 15000 0']);
  });

  it('en devise, la banque bouge au cours du jour, le client au cours de sa facture : l\'écart est du change', () => {
    const facture = { devise: EUR, cours: 3_350_000n };
    // 1 000 € reçus à 3,40 : la banque reçoit 3 400 DT, le client est soldé de 3 350 : gain de 50.
    expect(lignes(facture, r('p', '2026-04-01', 100_000n, 3_400_000n), 0n)).toEqual(['532 3400000 0', '411 0 3350000', '755 0 50000']);
    // À 3,30 : une perte de 50.
    expect(lignes(facture, r('p', '2026-04-01', 100_000n, 3_300_000n), 0n)).toEqual(['532 3300000 0', '411 0 3350000', '655 50000 0']);
    // Sans cours du jour : celui de la facture, et pas de change. 0,50 € de retenue valent 1,675 → 1,675 DT.
    expect(lignes(facture, r('p', '2026-04-01', 3_337n), 50n)).toEqual(['532 111790 0', '411 0 113465', '4358 1675 0']);
  });

  it('un remboursement change chaque ligne de colonne', () => {
    expect(lignes({ devise: TND }, r('rendu', '2026-03-20', -100_000n), -1_500n)).toEqual(['532 0 100000', '411 101500 0', '4358 0 1500']);
  });

  it('pour chaque règlement tiré au hasard : équilibrée, jamais une ligne à zéro ni à deux colonnes', () => {
    const h = hasard(11);
    for (let i = 0; i < 3000; i++) {
      const piece = h.suivant() < 0.5 ? { devise: TND } : { devise: h.parmi([EUR, USD]), cours: BigInt(h.entre(2_000_000, 4_000_000)) };
      const reglement = r('p', '2026-03-01', BigInt(h.entre(-100_000, 10_000_000)), h.suivant() < 0.5 ? BigInt(h.entre(2_000_000, 4_000_000)) : undefined);
      const part = BigInt(h.entre(-1_000, 100_000));
      const { lignes: l } = ecritureDEncaissement(piece, reglement, part, TND, COMPTES);
      expect(l.reduce((a, x) => a + x.debit - x.credit, 0n), `tirage ${i}`).toBe(0n);
      for (const x of l) expect((x.debit === 0n) !== (x.credit === 0n), `tirage ${i} : ${x.compte}`).toBe(true);
    }
  });
});
