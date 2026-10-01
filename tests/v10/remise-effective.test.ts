// La remise que fait vraiment une pièce (brique 104 ; 03 D11 « une remise » ; web/v10/accords.txt) : la remise
// globale, ou plus quand le prix d'une ligne est baissé sous celui que SkanFact proposerait à ce client (sa liste de
// prix, le palier de sa quantité, converti dans la devise de la pièce).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Core = { remiseEffective: (data: unknown, doc: unknown, company: unknown) => { taux: number; ligne: string } };
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const societe = { name: 'Matériaux Ben Youssef', currency: 'DT' };
const data = {
  company: societe,
  clients: [{ id: 'c1', name: 'Chantier Ennasr' }, { id: 'c2', name: 'Café El Walima' }],
  catalog: [{ id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 25, paliers: [{ min: 100, prix: 22 }] }],
  priceLists: [{ id: 'lp1', nom: 'Cafés', clientIds: ['c2'], lignes: [{ itemId: 'ciment', prix: 21 }] }],
};
const piece = (clientId: string, qty: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  type: 'facture', clientId, date: '2026-10-01', discountRate: 0, ...extra,
  lines: [{ label: 'Ciment gris 50 kg', qty, unitPrice, vatRate: 19, itemId: 'ciment' }, { label: 'Transport', qty: 1, unitPrice: 5, vatRate: 19 }],
});

describe('la remise effective d\'une pièce', () => {
  it('un prix baissé sous celui du client compte comme une remise ; sa liste et son palier sont sa référence', () => {
    expect(C.remiseEffective(data, piece('c1', 12, 20), societe)).toEqual({ taux: 20, ligne: 'Ciment gris 50 kg' });
    // 120 sacs : le palier (22) est la référence ; 20 en est 9,09 % dessous.
    expect(C.remiseEffective(data, piece('c1', 120, 20), societe)).toEqual({ taux: 9.09, ligne: 'Ciment gris 50 kg' });
    // Le Café a sa liste (21) : 20 en est 4,76 % dessous.
    expect(C.remiseEffective(data, piece('c2', 12, 20), societe)).toEqual({ taux: 4.76, ligne: 'Ciment gris 50 kg' });
    // Au prix du catalogue, seule la remise globale compte ; un prix baissé s'y ajoute.
    expect(C.remiseEffective(data, piece('c1', 12, 25, { discountRate: 5 }), societe)).toEqual({ taux: 5, ligne: '' });
    expect(C.remiseEffective(data, piece('c1', 12, 22, { discountRate: 5 }), societe)).toEqual({ taux: 16.4, ligne: 'Ciment gris 50 kg' });
    // Une ligne hors remise (un acompte déduit) ne compte pas.
    const horsRemise = piece('c1', 12, 20);
    (horsRemise.lines[0] as Record<string, unknown>).noDiscount = true;
    expect(C.remiseEffective(data, horsRemise, societe)).toEqual({ taux: 0, ligne: '' });
  });

  it('une pièce en euros compare au prix du catalogue converti à son taux', () => {
    // 25 DT à 3,4 DT l'euro : 7,35 € ; 7 € en est 4,76 % dessous.
    expect(C.remiseEffective(data, piece('c1', 12, 7, { currency: 'EUR', exchangeRate: 3.4 }), societe)).toEqual({ taux: 4.76, ligne: 'Ciment gris 50 kg' });
    // Sans taux, la référence ne se calcule pas : la ligne ne compte pas.
    expect(C.remiseEffective(data, piece('c1', 12, 7, { currency: 'EUR' }), societe)).toEqual({ taux: 0, ligne: '' });
  });
});
