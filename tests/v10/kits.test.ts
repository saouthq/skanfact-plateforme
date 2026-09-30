// Les kits dans le moteur de la v10 (brique 96 ; 02 : « recettes et kits » ; web/v10/kits.txt) :
//   - vendre un kit sort ses composants, chacun à sa quantité par kit ; un avoir les rentre ;
//   - le kit n'a pas de stock à lui : il en reste ce que ses composants permettent d'en faire ;
//   - « stock insuffisant » regarde ses composants.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Mouvement = { itemId: string; qty: number; source: string; note: string; docId: string };
type Core = {
  estKit: (c: unknown) => boolean;
  kitsPossibles: (data: unknown, kit: unknown, date?: string) => number;
  coutDuKit: (data: unknown, kit: unknown) => number;
  stockMovements: (data: unknown, itemId?: string) => Mouvement[];
  stockOf: (data: unknown, itemId: string) => { qty: number; cmp: number };
  stockImpact: (doc: unknown, data: unknown) => { label: string; have: number; need: number; after: number }[];
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

// Un pack « chape » : 3 sacs de ciment et 0,5 m³ de sable. Ciment : 40 sacs à 17 ; sable : 7 m³ à 45.
const pack = { id: 'pack', label: 'Pack chape 10 m²', unitPrice: 95, vatRate: 19, tracked: false, composants: [{ itemId: 'ciment', qty: 3 }, { itemId: 'sable', qty: 0.5 }] };
const donnees = () => ({
  company: { name: 'Matériaux Ben Youssef', currency: 'DT' },
  catalog: [
    { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', tracked: true, unitPrice: 21, initialQty: 40, initialCost: 17, initialDate: '2026-09-01' },
    { id: 'sable', label: 'Sable de rivière', unit: 'm³', tracked: true, unitPrice: 60, initialQty: 7, initialCost: 45, initialDate: '2026-09-01' },
    pack,
  ],
  documents: [
    { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-09-10', clientId: 'c1', lines: [{ label: 'Pack chape 10 m²', qty: 4, unitPrice: 95, vatRate: 19, itemId: 'pack' }], issuedTs: 2 },
    { id: 'a1', type: 'avoir', number: 'AVO-2026-001', status: 'émis', date: '2026-09-12', clientId: 'c1', creditOf: 'f1', lines: [{ label: 'Pack chape 10 m²', qty: 1, unitPrice: 95, vatRate: 19, itemId: 'pack' }], issuedTs: 3 },
  ],
  purchases: [], receptions: [], stockAdjustments: [],
});

describe('les kits, dans la v10', () => {
  it('vendre un kit sort ses composants ; un avoir les rentre ; le kit se compte en kits possibles', () => {
    const data = donnees();
    expect(C.estKit(pack)).toBe(true);
    expect(C.estKit({ ...pack, tracked: true })).toBe(false);
    // 4 packs vendus, 1 rendu : 9 sacs et 1,5 m³ sortis en net.
    const ciment = C.stockMovements(data, 'ciment').filter((m) => m.docId);
    expect(ciment.map((m) => [m.source, m.qty, m.note])).toEqual([['vente', -12, 'kit « Pack chape 10 m² »'], ['avoir', 3, 'kit « Pack chape 10 m² »']]);
    expect(C.stockMovements(data, 'sable').filter((m) => m.docId).map((m) => m.qty)).toEqual([-2, 0.5]);
    expect([C.stockOf(data, 'ciment').qty, C.stockOf(data, 'sable').qty]).toEqual([31, 5.5]);
    // Le kit n'a pas de mouvement à lui.
    expect(C.stockMovements(data, 'pack')).toEqual([]);
    // 31 sacs font 10 packs, 5,5 m³ en font 11 : il y a de quoi en faire 10. Avant les ventes : 13 et 14 → 13.
    expect(C.kitsPossibles(data, pack)).toBe(10);
    expect(C.kitsPossibles(data, pack, '2026-09-05')).toBe(13);
    // Ce que coûtent les composants : 3 × 17 + 0,5 × 45.
    expect(C.coutDuKit(data, pack)).toBe(73.5);
  });

  it('« stock insuffisant » regarde les composants du kit', () => {
    const data = donnees();
    const brouillon = (qty: number) => ({ id: 'f9', type: 'facture', status: 'brouillon', date: '2026-09-20', lines: [{ label: 'Pack chape 10 m²', qty, unitPrice: 95, vatRate: 19, itemId: 'pack' }] });
    expect(C.stockImpact(brouillon(10), data)).toEqual([]);
    // 11 packs : 33 sacs sur 31, et 5,5 m³ sur 5,5 → seul le ciment manque.
    expect(C.stockImpact(brouillon(11), data).map((x) => [x.label, x.have, x.need, x.after])).toEqual([['Ciment gris 50 kg', 31, 33, -2]]);
  });
});
