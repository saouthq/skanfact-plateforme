// 1.301.0 — la Comptabilité de l'entreprise face aux livres de son cabinet. Le moteur (`declarationsDuCabinet`) :
//   - un mois terminé avec une activité ou une déclaration a sa ligne ; un mois pas fini, ou sans rien, n'en a pas ;
//   - la date limite suit la règle « tva » du calendrier, au mois suivant (le 28 par défaut, le jour réglé sinon) ;
//   - déposée par le cabinet : la date et la référence ; pas déposée après la date limite : en retard ;
//   - l'écart entre ce que le cabinet a déclaré et ce que les pièces disent aujourd'hui — un second chemin : la chaîne de
//     TVA du mois calculée à part ; une case que le cabinet n'a pas remplie ne fait pas d'écart.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };

const facture = (id: string, date: string, ht: number): Obj => ({ id, type: 'facture', number: `FAC-${id}`, status: 'envoyée', date, clientId: 'c1',
  lines: [{ label: 'Détergent', qty: 1, unitPrice: ht, vatRate: 19 }], discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', payments: [] });
const achat = (id: string, date: string, ht: number): Obj => ({ id, kind: 'facture', supplierId: 's1', date, currency: 'DT', fees: 0, payments: [],
  lines: [{ label: 'Bidons', qty: 1, unitPrice: ht, vatRate: 19, destination: 'charge' }] });
const base = (): Obj => ({
  company: co, clients: [{ id: 'c1', name: 'Hôtel Marhaba' }], suppliers: [{ id: 's1', name: 'Sahel Chimie' }],
  documents: [facture('f1', '2026-09-08', 4991.65), facture('f2', '2026-10-03', 11103.77)],
  purchases: [achat('a1', '2026-09-03', 21718.1), achat('a2', '2026-10-06', 1846.32)],
  stockAdjustments: [], employees: [], payslips: [], projectTime: [], catalog: [],
});
const declaration = (periode: string, cases: Obj, deposee?: [string, string]): Obj => ({ id: periode, type: 'mensuelle', periode, cases,
  deposee: { le: deposee ? deposee[0] : '', par: '', reference: deposee ? deposee[1] : '' }, payee: { le: '', par: '' }, ecriture: null });

describe('la Comptabilité 1.301.0 : les déclarations du cabinet', () => {
  it('septembre déposée par le cabinet, puis un achat oublié : l\'écart se dit au millime, octobre attend', () => {
    const d = base();
    const sept = C.vatChain(d, co, '2026', 12)[8];
    const decl = [declaration('2026-09', { tvaCollectee: String(sept.collected), tvaDeductible: String(sept.deductible) }, ['2026-10-27', 'TEJ-2026-0927'])];
    // Avant l'oubli : déposée, rien ne diffère.
    const avant = C.declarationsDuCabinet(d, co, 2026, decl, '2026-11-07');
    expect(avant.map((x: Obj) => x.periode)).toEqual(['2026-10', '2026-09']);
    expect(avant[1]).toMatchObject({ label: 'septembre 2026', limite: '2026-10-28', deposee: { le: '2026-10-27', reference: 'TEJ-2026-0927' }, retard: false, ecarts: [] });
    expect(avant[0]).toMatchObject({ label: 'octobre 2026', limite: '2026-11-28', deposee: null, preparee: false, retard: false });
    // L'achat de septembre arrive après le dépôt : la déductible change, la collectée non.
    d.purchases.push(achat('a3', '2026-09-15', 507));
    const apres = C.declarationsDuCabinet(d, co, 2026, decl, '2026-11-07');
    const maintenant = C.vatChain(d, co, '2026', 12)[8];
    expect(apres[1].ecarts).toEqual([{ cle: 'tvaDeductible', nom: 'déductible', declare: sept.deductible, maintenant: maintenant.deductible, ecart: 96.33 }]);
    expect(maintenant.deductible).toBe(Math.round((sept.deductible + 96.33) * 1000) / 1000);
  });

  it('la date limite suit la règle du calendrier ; passée sans dépôt, en retard ; un mois en cours ou vide n\'a pas de ligne', () => {
    const d = base();
    d.fiscalDeadlines = [{ id: 'tva', day: 15 }];
    const l = C.declarationsDuCabinet(d, co, 2026, [], '2026-10-20');
    // Octobre n'est pas fini le 20 : seul septembre, dû le 15 octobre, en retard.
    expect(l.map((x: Obj) => [x.periode, x.limite, x.retard, x.preparee])).toEqual([['2026-09', '2026-10-15', true, false]]);
    // Préparée mais pas déposée : toujours en retard, et elle le sait.
    expect(C.declarationsDuCabinet(d, co, 2026, [declaration('2026-09', {})], '2026-10-20')[0]).toMatchObject({ preparee: true, retard: true, deposee: null });
    // Décembre se déclare en janvier de l'année suivante ; un mois sans pièce ni déclaration n'a pas de ligne.
    d.documents.push(facture('f3', '2026-12-10', 100));
    const fin = C.declarationsDuCabinet(d, co, 2026, [], '2027-02-01');
    expect(fin.find((x: Obj) => x.periode === '2026-12')).toMatchObject({ limite: '2027-01-15' });
    expect(fin.some((x: Obj) => x.periode === '2026-11')).toBe(false);
  });

  it('une case vide ne fait pas d\'écart ; une déclaration d\'un mois sans pièce garde sa ligne', () => {
    const d = base();
    const l = C.declarationsDuCabinet(d, co, 2026, [declaration('2026-09', { tvaCollectee: null, tvaDeductible: '' }, ['2026-10-20', '']),
      declaration('2026-08', { tvaCollectee: '0' }, ['2026-09-25', 'AOU'])], '2026-11-07');
    expect(l.find((x: Obj) => x.periode === '2026-09').ecarts).toEqual([]);
    expect(l.find((x: Obj) => x.periode === '2026-08')).toMatchObject({ deposee: { le: '2026-09-25', reference: 'AOU' }, ecarts: [] });
  });
});
