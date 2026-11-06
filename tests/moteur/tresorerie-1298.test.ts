// 1.298.0 — la trésorerie jouée comme un vrai commerçant (Menuiserie Ben Salah, Sousse, relevé BIAT d'octobre, revue du
// 06/11/2026). Trois défauts vus à l'écran, chacun tenu ici sur des montants qui ne tombent pas ronds :
//   - T1 : une remise de chèques (une ligne du relevé pour trois chèques) passait pour « absente de SkanFact », et la
//     créer comptait l'encaissement deux fois ;
//   - T2 : le loyer du 5, lu le 6 et jamais noté, était cru payé : il n'était nulle part, ni dans la prévision ni dans
//     « À surveiller » ;
//   - T3 : une ligne de frais créée depuis le relevé tombait en « Autre sortie ».
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const JOUR = '2026-11-06';
const co = () => ({ ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 });
const base = (): Obj => ({
  company: co(), clients: [{ id: 'c1', name: 'Hôtel Marhaba' }], suppliers: [{ id: 's1', name: 'Quincaillerie Sousse' }],
  accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', opening: 8000, openingDate: '2026-01-01', isDefault: true }],
  documents: [], purchases: [], movements: [], employees: [], payslips: [], recurring: [], fiscalFilings: [], socialFilings: [],
  fiscalDeadlines: C.DEFAULT_FISCAL_DEADLINES.map((r: Obj) => ({ ...r, active: false })),
});
const mv = (id: string, date: string, amount: number, reconciled = false) => ({ id, date, amount, reconciled });
const ids = (l: Obj[]) => l.map((x) => x.id);

describe('la remise de chèques (T1)', () => {
  const cheques = [mv('k1', '2026-10-24', 1011.5), mv('k2', '2026-10-25', 1755.845), mv('k3', '2026-10-27', 728.578)];

  it('une ligne du relevé retrouve les trois chèques dont la somme la fait au millime, et seulement eux', () => {
    const r = C.apparierReleve([{ date: '2026-10-15', montant: 3808 }, { date: '2026-10-28', montant: 3495.923 }, { date: '2026-10-31', montant: -18.5 }],
      [mv('v1', '2026-10-15', 3808), ...cheques, mv('loyer', '2026-11-05', -1200)]);
    expect(r.paires.map((p: Obj) => p.mouvement.id)).toEqual(['v1']);
    expect(r.remises).toHaveLength(1);
    expect(r.remises[0].ligne.montant).toBe(3495.923);
    expect(ids(r.remises[0].mouvements)).toEqual(['k1', 'k2', 'k3']);
    // La ligne de la remise n'est plus « absente » : la créer en mouvement compterait les chèques deux fois.
    expect(r.absentes.map((l: Obj) => l.montant)).toEqual([-18.5]);
    expect(ids(r.restants)).toEqual(['loyer']);
  });

  it('deux combinaisons qui font la somme : rien ne se propose, la ligne reste à décider', () => {
    const r = C.apparierReleve([{ date: '2026-10-28', montant: 300.25 }],
      [mv('a', '2026-10-20', 100.125), mv('b', '2026-10-21', 200.125), mv('c', '2026-10-22', 150.125), mv('d', '2026-10-23', 150.125)]);
    expect(r.remises).toHaveLength(0);
    expect(r.absentes).toHaveLength(1);
    expect(ids(r.restants)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hors des vingt jours, d\'un autre sens, ou à plus de quatre chèques : pas de remise', () => {
    // Un chèque de 21 jours avant la ligne ne compte pas.
    let r = C.apparierReleve([{ date: '2026-10-28', montant: 1740.078 }], [mv('vieux', '2026-10-07', 1011.5), cheques[2]]);
    expect([r.remises.length, r.absentes.length]).toEqual([0, 1]);
    r = C.apparierReleve([{ date: '2026-10-28', montant: 1740.078 }], [mv('recent', '2026-10-08', 1011.5), cheques[2]]);
    expect(ids(r.remises[0]?.mouvements || [])).toEqual(['recent', 'k3']);
    // Une sortie ne se mêle pas aux encaissements, même quand les montants sans leur signe feraient la ligne.
    r = C.apparierReleve([{ date: '2026-10-28', montant: 1740.078 }], [mv('in', '2026-10-24', 1011.5), mv('out', '2026-10-25', -728.578)]);
    expect(r.remises).toHaveLength(0);
    // Cinq chèques : la somme ne prouve plus rien.
    const cinq = [11.111, 22.222, 33.333, 44.444, 55.555].map((x, i) => mv(`q${i}`, `2026-10-2${i}`, x));
    r = C.apparierReleve([{ date: '2026-10-28', montant: 166.665 }], cinq);
    expect(r.remises).toHaveLength(0);
    r = C.apparierReleve([{ date: '2026-10-28', montant: 111.11 }], cinq.slice(0, 4));
    expect(ids(r.remises[0]?.mouvements || [])).toEqual(['q0', 'q1', 'q2', 'q3']);
  });

  it('un chèque déjà apparié un pour un n\'entre pas dans une remise', () => {
    const r = C.apparierReleve([{ date: '2026-10-24', montant: 1011.5 }, { date: '2026-10-28', montant: 2767.345 }], cheques);
    expect(r.paires.map((p: Obj) => p.mouvement.id)).toEqual(['k1']);
    expect(r.remises).toHaveLength(0);
    expect(r.absentes.map((l: Obj) => l.montant)).toEqual([2767.345]);
  });
});

describe('la dépense qui revient, passée sans être notée (T2)', () => {
  const loyer = { id: 'loyer', date: '2026-09-05', kind: 'autre-sortie', amount: 1234.567, accountId: 'b1', label: 'Loyer de l\'atelier', repete: 'mois' };
  const options = { impots: false, salaires: false };

  it('le loyer d\'octobre et celui du 5 novembre, jamais notés, sortent aujourd\'hui « déjà échus » ; décembre reste à sa date', () => {
    const d = base();
    d.movements.push(loyer);
    const f = C.cashForecast(d, d.company, 40, JOUR, options);
    const rep = f.events.filter((e: Obj) => e.kind === 'repete');
    expect(rep.map((e: Obj) => [e.date, e.occurrence, e.late, e.amount])).toEqual([
      [JOUR, '2026-10-05', true, -1234.567], [JOUR, '2026-11-05', true, -1234.567], ['2026-12-05', '2026-12-05', false, -1234.567]]);
    expect(f.late.repetes.map((e: Obj) => e.occurrence)).toEqual(['2026-10-05', '2026-11-05']);
    // Deux chemins, un chiffre : la fin de la prévision baisse exactement de ces trois loyers.
    expect(C.round3(f.start - f.end)).toBe(C.round3(3 * 1234.567));
  });

  it('noté par « Noter comme payé » ou saisi à la main (même compte, même nature, même montant, à sept jours près) : il sort de la prévision', () => {
    const d = base();
    d.movements.push(loyer, { id: 'oct', date: '2026-10-05', kind: 'autre-sortie', amount: 1234.567, accountId: 'b1', repeteDe: 'loyer', occurrence: '2026-10-05' });
    d.movements.push({ id: 'main', date: '2026-11-03', kind: 'autre-sortie', amount: 1234.567, accountId: 'b1', label: 'Loyer novembre' });
    let f = C.cashForecast(d, d.company, 40, JOUR, options);
    expect(f.events.filter((e: Obj) => e.kind === 'repete').map((e: Obj) => e.occurrence)).toEqual(['2026-12-05']);
    expect(f.late.repetes).toHaveLength(0);
    // Saisi à la main une seule fois, il ne vaut que pour une occurrence : décembre reste attendu.
    // Un autre montant, ou un autre compte, ne vaut pas pour le loyer.
    d.movements = [loyer, { id: 'autre', date: '2026-11-04', kind: 'autre-sortie', amount: 1234.5, accountId: 'b1' },
      { id: 'caisse', date: '2026-11-04', kind: 'autre-sortie', amount: 1234.567, accountId: 'c9' }];
    f = C.cashForecast(d, d.company, 40, JOUR, options);
    expect(f.late.repetes.map((e: Obj) => e.occurrence)).toEqual(['2026-10-05', '2026-11-05']);
  });

  it('plus de trois mois en arrière, c\'est le relevé qui le dira : la prévision ne remonte pas au-delà', () => {
    const d = base();
    d.movements.push({ ...loyer, date: '2026-01-05' });
    const f = C.cashForecast(d, d.company, 10, JOUR, options);
    expect(f.late.repetes.map((e: Obj) => e.occurrence)).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
  });

  it('les retards se rangent par sorte : un achat en retard n\'est pas un loyer', () => {
    const d = base();
    d.movements.push(loyer);
    d.purchases.push({ id: 'a3', kind: 'facture', supplierId: 's1', date: '2026-09-22', dueDate: '2026-10-22', currency: 'DT',
      lines: [{ label: 'Quincaillerie', qty: 1, unitPrice: 380.25, vatRate: 19 }], fees: 0, payments: [] });
    const f = C.cashForecast(d, d.company, 40, JOUR, options);
    expect([f.late.suppliers.map((e: Obj) => e.kind), f.late.repetes.map((e: Obj) => e.kind)]).toEqual([['fournisseur'], ['repete', 'repete']]);
    expect(f.late.salaires).toEqual([]);
  });
});

describe('la nature d\'une ligne du relevé créée en mouvement (T3)', () => {
  it('se devine de son libellé, sans jamais classer une entrée en frais', () => {
    const cas: [string, number, string][] = [
      ['FRAIS TENUE DE COMPTE', -18.5, 'banque'], ['Commission virement', -2.36, 'banque'], ['AGIOS T3', -41.207, 'banque'],
      ['PRLV CNSS 3E TRIM', -812.44, 'impot'], ['VIR ACOMPTE PROVISIONNEL', -342.6, 'impot'], ['Recette des finances Sousse', -96.1, 'impot'],
      ['RETRAIT DAB', -200, 'autre-sortie'], ['RETOUR FRAIS', 18.5, 'autre-entree'], ['', -5, 'autre-sortie']];
    expect(cas.map(([l, m]) => C.natureDuReleve(l, m))).toEqual(cas.map((c) => c[2]));
  });
});
