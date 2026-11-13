// Ce qu'un avoir laisse sur la facture qu'il corrige (1.362.2, bout en bout 26). La pâtisserie a émis deux fois la facture
// de l'hôtel (1 200 HT + 228 de TVA + 1 de timbre = 1 429) ; AVO-2026-002 annule la seconde. Un second brouillon d'avoir
// resté sur la même facture annonçait « 1 429,000 DT à rendre au client » d'une facture jamais payée. La règle :
// « à rendre » ne compte que ce que le client a PAYÉ ; ce qui dépasse ce que la facture porte encore se dit à part. Les
// montants attendus sont comptés à la main.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const societe = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
const ligne = { label: 'Forfait viennoiseries', qty: 1, unitPrice: 1200, vatRate: 19 };
const facture = (extra: Obj = {}) => ({ id: 'f6', type: 'facture', number: 'FAC-2026-006', status: 'envoyée', date: '2026-11-13', clientId: 'h1', currency: 'DT', applyStamp: true, lines: [ligne], payments: [], ...extra });
const avoir = (id: string, extra: Obj = {}) => ({ id, type: 'avoir', number: '', status: 'brouillon', date: '2026-11-13', clientId: 'h1', currency: 'DT', creditOf: 'f6', applyStamp: true, lines: [ligne], ...extra });
const donnees = (f: Obj, avoirs: Obj[] = []) => ({ documents: [f, ...avoirs], company: societe });

describe('ce qu\'un avoir laisse sur sa facture : à rendre, ou de trop', () => {
  it('la facture porte bien 1 429 : 1 200 + 228 de TVA + 1 de timbre', () => {
    expect(C.computeTotals(facture(), societe).netToPay).toBe(1429);
  });
  const cas: [string, Obj, Obj[], number, { reste: number; aRendre: number; depasse: number }][] = [
    ['l\'avoir d\'annulation totale (timbre repris) solde une facture impayée : rien à rendre, rien de trop', facture(), [], 1429, { reste: 0, aRendre: 0, depasse: 0 }],
    ['un avoir de 300 laisse 1 129 à payer', facture(), [], 300, { reste: 1129, aRendre: 0, depasse: 0 }],
    ['le second avoir d\'une facture impayée déjà annulée par AVO-2026-002 : rien à rendre, 1 429 de trop',
      facture(), [avoir('a2', { number: 'AVO-2026-002', status: 'émis' })], 1429, { reste: -1429, aRendre: 0, depasse: 1429 }],
    ['la facture payée en entier, puis annulée : 1 429 à rendre', facture({ payments: [{ id: 'p1', date: '2026-11-13', amount: 1429 }] }), [], 1429, { reste: -1429, aRendre: 1429, depasse: 0 }],
    ['payée de 500 seulement, puis annulée : 500 à rendre, rien de trop', facture({ payments: [{ id: 'p1', date: '2026-11-13', amount: 500 }] }), [], 1429, { reste: -500, aRendre: 500, depasse: 0 }],
    ['payée de 500, déjà corrigée de 929 par un avoir, puis un avoir de 1 429 : 500 à rendre et 929 de trop',
      facture({ payments: [{ id: 'p1', date: '2026-11-13', amount: 500 }] }), [avoir('a1', { number: 'AVO-2026-001', status: 'émis', applyStamp: false, lines: [{ ...ligne, unitPrice: 780.672 }] })], 1429,
      { reste: -1429, aRendre: 500, depasse: 929 }],
  ];
  it.each(cas)('%s', (_titre, f, avoirs, net, attendu) => {
    const a = C.apresAvoir(f, net, donnees(f, avoirs), societe);
    expect({ reste: a.reste, aRendre: a.aRendre, depasse: a.depasse }).toEqual(attendu);
    // Ce qui manque sous zéro est soit à rendre, soit de trop : jamais rien d'autre.
    if (a.reste < 0) expect(C.round3(a.aRendre + a.depasse)).toBe(C.round3(-a.reste));
  });
  it('un brouillon d\'avoir ne compte pas encore : seul l\'avoir émis corrige la facture', () => {
    const f = facture();
    const a = C.apresAvoir(f, 1429, donnees(f, [avoir('a2')]), societe);
    expect([a.depasse, a.credits.length]).toEqual([0, 0]);
  });
  it('l\'avoir de 929 corrige bien 929 (780,672 HT + 19 %)', () => {
    expect(C.computeTotals(avoir('a1', { applyStamp: false, lines: [{ ...ligne, unitPrice: 780.672 }] }), societe).netToPay).toBe(929);
  });
  it('une facture marquée annulée ne porte plus rien : tout avoir dessus est de trop', () => {
    const f = facture({ status: 'annulée' });
    const a = C.apresAvoir(f, 1429, donnees(f), societe);
    expect([a.aRendre, a.depasse]).toEqual([0, 1429]);
  });
});
