// Ce qui doit rentrer (1.39.0 ; docs/console.md C55 ; la liste des fonctions qui manquent, 14), pur. Ce que la prévision
// garantit :
//   - une facture due se range dans le mois de son échéance ; déjà échue, dans « en retard » ; au-delà des trois mois,
//     dans « plus tard » ; une autre devise n'entre pas dans les montants en dinars ;
//   - un renouvellement attendu se range dans le mois où sa période commence (ce mois-ci s'il aurait dû commencer avant),
//     au prix hors taxes de sa prochaine facture ; jamais si sa période est déjà facturée (émise ou préparée) ; sans prix,
//     compté sans montant ; un client qui part (sa sortie ouverte), écarté ;
//   - une facture préparée, pas encore émise, se range dans sa propre colonne, au hors-taxes qu'elle porte : la préparer
//     fait passer son montant d'une colonne à l'autre, au même mois, jamais disparaître (l'audit 1.42.0 A05) ;
//   - un abonnement mensuel qui court compte chaque mois des trois ; un abonnement qui attend son paiement, sa seule
//     période attendue.
import { describe, expect, it } from 'vitest';
import { prevoir, PREVISION_MOIS } from '../../serveur/console/previsions.ts';
import type { Doit } from '../../serveur/console/paiements.ts';
import type { Renouvellement } from '../../serveur/console/renouvellements.ts';

const JOUR = '2026-10-15';
const doit = (id: string, echeance: string | null, reste: string, devise = 'TND'): Doit => ({
  entreprise: { id, nom: id }, numero: null, piece: `p-${id}`, ecran: '', debut: echeance ?? '2026-11-01', fin: '2026-11-30', echeance,
  devise, reste, net: reste, statut: 'a_payer', retard: null, abonnement: null, paye: '0.000', credite: '0.000',
});
const ren = (debut: string, periodeHt: bigint, periodicite: 'annuel' | 'mensuel' = 'annuel', attendu = false, unMois = periodeHt): Renouvellement =>
  ({ offre: 'essentiel', periodicite, debut, periodeHt, parAnHt: periodicite === 'mensuel' ? unMois * 12n : periodeHt, remise: null, attendu });

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
      ['a', ren('2026-11-11', 39000n)], ['b', ren('2026-12-01', 69000n)], ['c', ren('2026-09-23', 390000n, 'mensuel', true)],
      ['d', ren('2026-11-20', 39000n)], ['e', null], ['f', ren('2027-03-01', 39000n)], ['g', ren('2026-11-02', 69000n)]]);
    const p = prevoir([], r, [{ entreprise: { id: 'd' }, debut: '2026-11-20' }], JOUR, 'TND', 3, new Set(['g']));
    // c aurait dû commencer en septembre : il est encore attendu, ce mois-ci ; d est déjà facturé ; f tombe après.
    expect(p.mois.map((m) => [m.mois, m.attendu])).toEqual([
      ['2026-10', { montantHt: '390.000', n: 1 }], ['2026-11', { montantHt: '39.000', n: 1 }], ['2026-12', { montantHt: '69.000', n: 1 }]]);
    expect([p.sansPrix, p.partants]).toEqual([1, 1]);
    // Les factures et les renouvellements ne s'additionnent jamais : deux colonnes, deux unités (TTC, HT).
    expect(p.mois.every((m) => m.du.n === 0)).toBe(true);
  });

  it('une facture préparée passe d\'une colonne à l\'autre, au même mois et au même montant ; émise, elle est due', () => {
    const r = new Map<string, Renouvellement | null>([['a', ren('2026-11-11', 390417n)], ['b', ren('2026-12-02', 69123n)]]);
    const avant = prevoir([], r, [], JOUR, 'TND', 3);
    const preparee = { entreprise: { id: 'a' }, debut: '2026-11-11', montantHt: 390417n };
    const apres = prevoir([], r, [preparee], JOUR, 'TND', 3, new Set(), [preparee]);
    expect(avant.mois.map((m) => [m.mois, m.prepare.montantHt, m.attendu.montantHt])).toEqual([
      ['2026-10', '0.000', '0.000'], ['2026-11', '0.000', '390.417'], ['2026-12', '0.000', '69.123']]);
    expect(apres.mois.map((m) => [m.mois, m.prepare, m.attendu.montantHt])).toEqual([
      ['2026-10', { montantHt: '0.000', n: 0 }, '0.000'], ['2026-11', { montantHt: '390.417', n: 1 }, '0.000'], ['2026-12', { montantHt: '0.000', n: 0 }, '69.123']]);
    // Émise : elle quitte les préparées et devient due (taxes comprises) ; le renouvellement de b n'a pas bougé.
    const emise = prevoir([doit('a', '2026-11-11', '465.597')], r, [preparee], JOUR, 'TND', 3);
    expect(emise.mois.map((m) => [m.du.montant, m.prepare.n, m.attendu.montantHt])).toEqual([['0.000', 0, '0.000'], ['465.597', 0, '0.000'], ['0.000', 0, '69.123']]);
    // Un hors-taxes illisible ne s'invente pas : la facture n'est ni comptée ni attendue deux fois.
    expect(prevoir([], r, [preparee], JOUR, 'TND', 3, new Set(), [{ ...preparee, montantHt: null }]).mois[1]?.prepare).toEqual({ montantHt: '0.000', n: 0 });
  });

  it('un mensuel qui court compte chaque mois, le premier rattrapage compris ; celui qui attend son paiement, une fois', () => {
    // Sa prochaine facture (le 31/10) porte un rattrapage : 45,123 ; les mois suivants, un mois de 39,071.
    const r = new Map<string, Renouvellement | null>([['m', ren('2026-10-31', 45123n, 'mensuel', false, 39071n)], ['g', ren('2026-10-05', 39071n, 'mensuel', true)]]);
    const p = prevoir([], r, [], JOUR, 'TND', 3);
    expect(p.mois.map((m) => [m.mois, m.attendu])).toEqual([
      ['2026-10', { montantHt: '84.194', n: 2 }], ['2026-11', { montantHt: '39.071', n: 1 }], ['2026-12', { montantHt: '39.071', n: 1 }]]);
    // La période de novembre (le 30 : le 31 n'existe pas) déjà préparée ne s'attend plus.
    const q = prevoir([], r, [{ entreprise: { id: 'm' }, debut: '2026-11-30' }], JOUR, 'TND', 3);
    expect(q.mois[1]?.attendu).toEqual({ montantHt: '0.000', n: 0 });
  });
});
