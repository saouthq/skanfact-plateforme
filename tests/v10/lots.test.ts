// Les lots dans le moteur de la v10 (brique 97 ; 02 : Stock, « lots » ; web/v10/lots.txt) :
//   - chaque mouvement d'un article suivi par lot dit son lot, et la péremption que l'entrée du lot a dite ;
//   - le stock se lit lot par lot, le lot conseillé est celui qui périme le plus tôt sans être périmé ;
//   - « À faire » dit les lots qui périment dans les 30 jours ; une pièce dit ses lots manquants, périmés, courts.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Lot = { lot: string; peremption: string; qty: number };
type Core = {
  stockMovements: (data: unknown, itemId?: string) => { id: string; qty: number; lot: string; peremption: string }[];
  stockParLot: (data: unknown, itemId: string, date?: string) => Lot[];
  lotConseille: (data: unknown, itemId: string, date?: string) => Lot | null;
  lotsAPerimer: (data: unknown, date: string, jours?: number) => (Lot & { label: string; perime: boolean })[];
  lotsDeLaPiece: (doc: unknown, data: unknown) => Record<string, unknown>[];
  todoList: (data: unknown, company: unknown, date: string) => { id: string; level: string; label: string; detail: string }[];
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const ligne = (qty: number, extra: Record<string, unknown> = {}) => ({ label: 'Yaourt nature 125 g', qty, unitPrice: 0.45, vatRate: 7, itemId: 'yaourt', ...extra });
const donnees = () => ({
  company: { name: 'Épicerie Ben Salah', currency: 'DT' },
  catalog: [{ id: 'yaourt', label: 'Yaourt nature 125 g', unit: 'pot', tracked: true, parLot: true, unitPrice: 0.6, initialQty: 20, initialCost: 0.4, initialDate: '2026-09-01', initialLot: 'L-0901', initialPeremption: '2026-10-05' }],
  purchases: [{ id: 'p1', kind: 'facture', number: 'F-77', date: '2026-09-10', createdAt: 1,
    lines: [ligne(50, { destination: 'stock', lot: 'L-0910', peremption: '2026-10-20' }), ligne(30, { destination: 'stock', lot: 'L-0915', peremption: '2026-11-15' })] }],
  documents: [
    { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-09-20', clientId: 'c1', lines: [ligne(12, { lot: 'L-0901' })], issuedTs: 2 },
    // Un bon sans lot choisi : sa sortie est « sans lot ».
    { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: '2026-09-22', clientId: 'c1', lines: [ligne(5)], issuedTs: 3 },
  ],
  receptions: [], stockAdjustments: [],
});

describe('les lots, dans la v10', () => {
  it('chaque mouvement dit son lot ; le stock se lit lot par lot ; le lot conseillé périme le premier', () => {
    const data = donnees();
    const vente = C.stockMovements(data, 'yaourt').find((m) => m.id === 'doc-f1-0');
    expect([vente?.qty, vente?.lot, vente?.peremption]).toEqual([-12, 'L-0901', '2026-10-05']);
    expect(C.stockParLot(data, 'yaourt', '2026-09-30').map((x) => [x.lot, x.qty, x.peremption])).toEqual([
      ['L-0901', 8, '2026-10-05'], ['L-0910', 50, '2026-10-20'], ['L-0915', 30, '2026-11-15'], ['', -5, ''],
    ]);
    // Avant l'achat, seul le lot du départ est là.
    expect(C.stockParLot(data, 'yaourt', '2026-09-05').map((x) => [x.lot, x.qty])).toEqual([['L-0901', 20]]);
    expect(C.lotConseille(data, 'yaourt', '2026-09-30')?.lot).toBe('L-0901');
    // Le 6 octobre, L-0901 est périmé : on conseille L-0910.
    expect(C.lotConseille(data, 'yaourt', '2026-10-06')?.lot).toBe('L-0910');
  });

  it('« À faire » dit les lots qui périment ; une pièce dit ses lots manquants, périmés, courts', () => {
    const data = donnees();
    expect(C.lotsAPerimer(data, '2026-09-30', 30).map((x) => [x.lot, x.qty, x.perime])).toEqual([['L-0901', 8, false], ['L-0910', 50, false]]);
    expect(C.lotsAPerimer(data, '2026-10-06', 30).map((x) => [x.lot, x.perime])).toEqual([['L-0901', true], ['L-0910', false]]);
    const a = C.todoList(data, data.company, '2026-09-30').find((x) => x.id === 'lots-peremption');
    expect([a?.level, a?.label, a?.detail]).toEqual(['info', '2 lots périment dans les 30 jours',
      'Le premier : Yaourt nature 125 g, lot L-0901 (8), périme le 05/10/2026. Vends-le d\'abord, ou sors-le du stock (casse).']);
    expect(C.todoList(data, data.company, '2026-10-06').find((x) => x.id === 'lots-peremption')?.level).toBe('warn');
    const piece = (date: string, lignes: unknown[]) => ({ id: 'f9', type: 'facture', status: 'brouillon', date, lines: lignes });
    expect(C.lotsDeLaPiece(piece('2026-09-30', [ligne(4)]), data).map((x) => [x.genre, (x.conseil as Lot | null)?.lot])).toEqual([['sans', 'L-0901']]);
    expect(C.lotsDeLaPiece(piece('2026-09-30', [ligne(10, { lot: 'L-0901' })]), data).map((x) => [x.genre, x.have, x.need])).toEqual([['court', 8, 10]]);
    expect(C.lotsDeLaPiece(piece('2026-10-06', [ligne(3, { lot: 'L-0901' })]), data).map((x) => [x.genre, x.peremption])).toEqual([['perime', '2026-10-05']]);
    expect(C.lotsDeLaPiece(piece('2026-09-30', [ligne(3, { lot: 'L-0910' })]), data)).toEqual([]);
  });
});
