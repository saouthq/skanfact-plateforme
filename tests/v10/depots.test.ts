// Le stock par dépôt et les transferts, dans le code de la v10 (web/public/v10/core.js, adapté par
// web/v10/depots.txt ; brique 94, 14 § 3.2 : « Stock par dépôt, transferts »). Le moteur seul :
//   - chaque mouvement appartient au dépôt de sa pièce, de son achat ou de son ajustement ; sinon au principal ;
//   - le stock d'un article, dépôt par dépôt ;
//   - un transfert fait passer la marchandise d'un dépôt à l'autre sans changer ni la quantité totale ni le coût
//     moyen ; on ne transfère pas ce que le dépôt n'a pas, ni vers lui-même.
// Les données discriminent : des coûts d'entrée différents (17 et 18,5), un coût moyen qui n'est pas rond.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Ajustement = Record<string, unknown> & { qty: number; depotId: string };
type Core = {
  depotsDe: (data: unknown) => { id: string; nom: string }[];
  stockParDepot: (data: unknown, itemId: string, date?: string) => { depotId: string; nom: string; qty: number }[];
  transfertStock: (data: unknown, t: Record<string, unknown>) => { erreur?: string; ajustements?: Ajustement[] };
  stockOf: (data: unknown, itemId: string, date?: string) => { qty: number; cmp: number; value: number };
  stockMovements: (data: unknown, itemId: string) => unknown[];
  stockImpact: (doc: unknown, data: unknown) => { depot: string; have: number; need: number; after: number; total: number }[];
  runningStock: (moves: unknown[]) => { rows: { source: string; qty: number; qtyAfter: number; unitApplied: number }[] };
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const ligne = (qty: number, unitPrice: number) => ({ label: 'Ciment gris 50 kg', qty, unitPrice, vatRate: 19, itemId: 'ciment', destination: 'stock' });
const donnees = () => ({
  company: { name: 'Matériaux Ben Youssef', currency: 'DT' },
  catalog: [{ id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', tracked: true, unitPrice: 21, initialQty: 10, initialCost: 17, initialDate: '2026-09-01' }],
  depots: [{ id: 'sfax', nom: 'Magasin de Sfax' }],
  purchases: [{ id: 'p1', kind: 'facture', number: 'F-1', date: '2026-09-05', depotId: 'sfax', lines: [ligne(50, 18.5)], createdAt: 1 }],
  documents: [
    { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-09-10', clientId: 'c1', lines: [ligne(5, 21)], issuedAt: 2 },
    { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: '2026-09-12', clientId: 'c1', depotId: 'sfax', lines: [ligne(8, 21)], issuedAt: 3 },
  ],
  // Une réception validée, entrée à Sfax.
  receptions: [{ id: 'r1', number: 'BR-2026-001', status: 'validée', date: '2026-09-06', depotId: 'sfax', lines: [{ label: 'Ciment gris 50 kg', qty: 4, unitPrice: 18, itemId: 'ciment', ligneCommande: 0 }], validatedTs: 1 }],
  stockAdjustments: [] as Ajustement[],
});

describe('le stock par dépôt, dans la v10', () => {
  it('chaque mouvement appartient au dépôt de sa pièce ; le stock se lit dépôt par dépôt', () => {
    const data = donnees();
    expect(C.depotsDe(data).map((d) => d.nom)).toEqual(['Dépôt principal', 'Magasin de Sfax']);
    // Principal : 10 au départ, 5 vendus ; Sfax : 50 achetés, 4 reçus, 8 livrés.
    expect(C.stockParDepot(data, 'ciment').map((x) => [x.nom, x.qty])).toEqual([['Dépôt principal', 5], ['Magasin de Sfax', 46]]);
    // Au 06/09 : rien n'est encore sorti.
    expect(C.stockParDepot(data, 'ciment', '2026-09-06').map((x) => x.qty)).toEqual([10, 54]);
    expect(C.depotsDe({ ...data, depotPrincipalNom: 'Magasin de Tunis' })[0]?.nom).toBe('Magasin de Tunis');
  });

  it('un transfert ne change ni la quantité totale ni le coût moyen ; on ne transfère pas ce qui n\'y est pas', () => {
    const data = donnees();
    const avant = C.stockOf(data, 'ciment');
    const t = C.transfertStock(data, { id: 't1', itemId: 'ciment', de: 'sfax', vers: 'principal', qty: '20', date: '2026-09-15', note: 'Réassort' });
    expect(t.ajustements?.map((a) => [a.qty, a.depotId, a.source, a.note])).toEqual([
      [-20, 'sfax', 'transfert', 'vers Dépôt principal · Réassort'], [20, 'principal', 'transfert', 'depuis Magasin de Sfax · Réassort'],
    ]);
    data.stockAdjustments.push(...(t.ajustements ?? []));
    expect(C.stockParDepot(data, 'ciment').map((x) => x.qty)).toEqual([25, 26]);
    const apres = C.stockOf(data, 'ciment');
    expect([apres.qty, apres.cmp, apres.value]).toEqual([avant.qty, avant.cmp, avant.value]);
    // L'historique passe la sortie AVANT l'entrée : le stock total n'y paraît jamais au-dessus de ce qu'il est.
    const lignes = C.runningStock(C.stockMovements(data, 'ciment')).rows.filter((m) => m.source === 'transfert');
    expect(lignes.map((m) => [m.qty, m.qtyAfter, m.unitApplied])).toEqual([[-20, avant.qty - 20, avant.cmp], [20, avant.qty, avant.cmp]]);
    // Sfax n'en a plus que 26 : 30 se refusent, en le disant.
    expect(C.transfertStock(data, { id: 't2', itemId: 'ciment', de: 'sfax', vers: 'principal', qty: 30, date: '2026-09-20' }).erreur)
      .toBe('Magasin de Sfax n\'en a que 26 le 20/09/2026 : on ne transfère pas ce qui n\'y est pas.');
    expect(C.transfertStock(data, { id: 't3', itemId: 'ciment', de: 'sfax', vers: 'sfax', qty: 1, date: '2026-09-20' }).erreur).toMatch(/^Choisis deux dépôts différents/);
    expect(C.transfertStock(data, { id: 't4', itemId: 'ciment', de: 'sfax', vers: 'principal', qty: 0, date: '2026-09-20' }).erreur).toBe('Saisis la quantité à transférer.');
  });

  it('le stock insuffisant se lit dans le dépôt de la pièce (brique 95)', () => {
    const data = donnees();
    const brouillon = (qty: number, depotId?: string) => ({ id: 'f9', type: 'facture', status: 'brouillon', date: '2026-09-20', lines: [ligne(qty, 21)], ...(depotId ? { depotId } : {}) });
    // Principal : 5 ; Sfax : 46 ; 51 en tout. 7 sacs manquent au principal (sans dépôt choisi, c'est lui), pas à Sfax.
    expect(C.stockImpact(brouillon(7), data).map((x) => [x.depot, x.have, x.need, x.after, x.total])).toEqual([['Dépôt principal', 5, 7, -2, 51]]);
    expect(C.stockImpact(brouillon(7, 'sfax'), data)).toEqual([]);
    expect(C.stockImpact(brouillon(48, 'sfax'), data).map((x) => [x.depot, x.have, x.after, x.total])).toEqual([['Magasin de Sfax', 46, -2, 51]]);
    // Un seul dépôt : rien ne change, le stock total fait foi.
    const seul = { ...data, depots: [] };
    expect(C.stockImpact(brouillon(48), seul)).toEqual([]);
    expect(C.stockImpact(brouillon(53), seul).map((x) => [x.depot, x.have, x.after])).toEqual([['', 51, -2]]);
  });
});
