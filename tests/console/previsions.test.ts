// Ce qui doit rentrer (1.39.0 ; docs/console.md C55 ; la liste des fonctions qui manquent, 14), pur. Ce que la prévision
// garantit :
//   - une facture due se range dans le mois de son échéance ; déjà échue, dans « en retard » ; au-delà des trois mois,
//     dans « plus tard » ; une autre devise n'entre pas dans les montants en dinars ;
//   - un renouvellement attendu se range dans le mois où sa période commence (ce mois-ci s'il aurait dû commencer avant),
//     au prix hors taxes de sa prochaine facture ; jamais si sa période est déjà facturée (émise ou préparée) ; sans prix,
//     compté sans montant ; un client qui part (sa sortie ouverte), écarté.
import { describe, expect, it } from 'vitest';
import { prevoir, PREVISION_MOIS } from '../../serveur/console/previsions.ts';
import type { Doit } from '../../serveur/console/paiements.ts';
import type { Renouvellement } from '../../serveur/console/renouvellements.ts';

const JOUR = '2026-10-15';
const doit = (id: string, echeance: string | null, reste: string, devise = 'TND'): Doit => ({
  entreprise: { id, nom: id }, numero: null, piece: `p-${id}`, ecran: '', debut: echeance ?? '2026-11-01', fin: '2026-11-30', echeance,
  devise, reste, net: reste, statut: 'a_payer', retard: null, abonnement: null, paye: '0.000', credite: '0.000',
});
const ren = (debut: string, periodeHt: bigint): Renouvellement => ({ offre: 'essentiel', periodicite: 'mensuel', debut, periodeHt, parAnHt: periodeHt * 12n, remise: null, attendu: false });

describe('ce qui doit rentrer (C55)', () => {
  it('les factures dues, par le mois de leur échéance ; en retard et plus tard à part ; une autre devise, jamais', () => {
    const p = prevoir([doit('a', '2026-10-20', '47.410'), doit('b', '2026-11-03', '35.510'), doit('c', '2026-10-01', '12.345'),
      doit('d', '2027-02-01', '9.000'), doit('e', JOUR, '1.001'), doit('f', '2026-11-10', '100.000', 'EUR')], new Map(), [], JOUR, 'TND', 3);
    expect(PREVISION_MOIS).toBe(3);
    expect(p.mois.map((m) => [m.mois, m.du])).toEqual([
      ['2026-10', { montant: '48.411', n: 2 }], ['2026-11', { montant: '35.510', n: 1 }], ['2026-12', { montant: '0.000', n: 0 }]]);
    expect(p.retard).toEqual({ montant: '12.345', n: 1 });
    expect(p.plusTard).toEqual({ montant: '9.000', n: 1 });
  });

  it('les renouvellements attendus, au prix de leur prochaine facture ; déjà facturés, jamais deux fois ; sans prix, comptés ; un client qui part, écarté', () => {
    const r = new Map<string, Renouvellement | null>([
      ['a', ren('2026-11-11', 39000n)], ['b', ren('2026-12-01', 69000n)], ['c', ren('2026-09-23', 390000n)],
      ['d', ren('2026-11-20', 39000n)], ['e', null], ['f', ren('2027-03-01', 39000n)], ['g', ren('2026-11-02', 69000n)]]);
    const p = prevoir([], r, [{ entreprise: { id: 'd' }, debut: '2026-11-20' }], JOUR, 'TND', 3, new Set(['g']));
    // c aurait dû commencer en septembre : il est encore attendu, ce mois-ci ; d est déjà facturé ; f tombe après.
    expect(p.mois.map((m) => [m.mois, m.attendu])).toEqual([
      ['2026-10', { montantHt: '390.000', n: 1 }], ['2026-11', { montantHt: '39.000', n: 1 }], ['2026-12', { montantHt: '69.000', n: 1 }]]);
    expect([p.sansPrix, p.partants]).toEqual([1, 1]);
    // Les factures et les renouvellements ne s'additionnent jamais : deux colonnes, deux unités (TTC, HT).
    expect(p.mois.every((m) => m.du.n === 0)).toBe(true);
  });
});
