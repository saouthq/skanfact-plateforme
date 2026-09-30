// La relecture d'une facture lue, dans le code de la v10 (web/public/v10/core.js, `ocrToPurchase` ; brique 84) :
// un taux que la lecture n'a pas trouvé (null) n'est PAS une TVA à 0 % ; la ligne reçoit le taux d'une ligne
// neuve de la v10, et la fenêtre le dit (web/v10/lecture-photo.txt). Un taux lu est gardé tel quel.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Ligne = { label: string; qty: number; unitPrice: number; vatRate: number };
type Core = { ocrToPurchase: (read: unknown, data: unknown, today?: string) => { lines: Ligne[] } };
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

describe('la relecture d\'une facture lue, dans la v10', () => {
  it('un taux non lu n\'est pas une TVA à 0 % ; un taux lu se garde ; un taux que SkanFact ne propose pas passe au taux d\'une ligne neuve', () => {
    const lignes = (vatRate: unknown) => C.ocrToPurchase({ lines: [{ label: 'Papier', qty: '2', unitPrice: '12.5', vatRate }] }, { suppliers: [], company: { currency: 'DT' } }, '2026-10-01').lines;
    expect(lignes(null)[0]).toMatchObject({ qty: 2, unitPrice: 12.5, vatRate: 19 });
    expect(lignes('')[0]?.vatRate).toBe(19);
    expect(lignes('7')[0]?.vatRate).toBe(7);
    expect(lignes('0')[0]?.vatRate).toBe(0);
    expect(lignes('18')[0]?.vatRate).toBe(19);
  });
});
