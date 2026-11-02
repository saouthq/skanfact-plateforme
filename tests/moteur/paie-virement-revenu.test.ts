// Le virement d'un salaire revenu sur le compte (1.247.0 ; docs/paie.md, « le virement rejeté »). Le relevé le dit : une
// ligne au CRÉDIT, du net exact d'un bulletin payé, dans les 60 jours, et un libellé de rejet. Les données discriminent :
// deux salariés au même net (le nommé l'emporte), un net qui diffère d'un millime, un crédit du même montant sans mot de
// rejet, un rejet avant le paiement, un rejet trop tard, un débit, un bulletin pas payé.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Revenu = { bulletin: string; salarieId: string; net: number; payeLe: string; date: string; libelle: string; releve: string; ligne: string };
const compta = ecranDeLaPlateforme('compta.js') as {
  virementsRevenus: (releves: unknown[], bulletins: unknown[], nomDe?: (id: string) => string) => Revenu[];
};
const bul = (id: string, salarieId: string, net: number, payeLe: string) => ({ id, salarieId, calcul: { net }, payeLe });
const NOMS: Record<string, string> = { kr: 'Karim Riahi', hm: 'Hamza Mejri', nb: 'Nadia Ben Salah', mt: 'Mourad Trabelsi', ys: 'Yassine Sassi' };
const nomDe = (id: string) => NOMS[id] ?? '';
const bulletins = [
  bul('b-kr', 'kr', 1234.567, '2026-10-31'), bul('b-hm', 'hm', 1234.567, '2026-10-31'),
  bul('b-nb', 'nb', 987.654, '2026-10-31'), bul('b-mt', 'mt', 812.003, '2026-10-31'), bul('b-ys', 'ys', 640.5, ''),
];
const releve = (lignes: { date: string; libelle: string; montant: number }[]) => [{ id: 'r1', lignes: lignes.map((l, i) => ({ id: `r1-L${i + 1}`, reference: '', ...l })) }];

describe('le virement de salaire revenu', () => {
  it('une ligne de rejet au crédit, du net exact, après le paiement : le bulletin dont le salarié est nommé', () => {
    const r = compta.virementsRevenus(releve([{ date: '2026-11-04', libelle: 'REJET VIR SAL HAMZA MEJRI RIB INVALIDE', montant: 1234.567 }]), bulletins, nomDe);
    expect(r).toEqual([{ bulletin: 'b-hm', salarieId: 'hm', net: 1234.567, payeLe: '2026-10-31', date: '2026-11-04', libelle: 'REJET VIR SAL HAMZA MEJRI RIB INVALIDE', releve: 'r1', ligne: 'r1-L1' }]);
  });
  it('sans nom, le plus ancien des deux au même net ; deux rejets du même net : les deux bulletins, pas deux fois le même', () => {
    const r = compta.virementsRevenus(releve([
      { date: '2026-11-04', libelle: 'Retour virement', montant: 1234.567 },
      { date: '2026-11-05', libelle: 'RETOUR VIREMENT', montant: 1234.567 },
    ]), bulletins, nomDe);
    expect(r.map((x) => x.bulletin)).toEqual(['b-hm', 'b-kr']);
  });
  it('ce qui n\'est pas un rejet ne se dit pas', () => {
    expect(compta.virementsRevenus(releve([
      { date: '2026-11-04', libelle: 'REJET VIR', montant: 987.653 },         // un millime d'écart
      { date: '2026-11-04', libelle: 'VIR RECU CLIENT', montant: 987.654 },   // même montant, pas de mot de rejet
      { date: '2026-10-20', libelle: 'REJET VIR', montant: 812.003 },         // avant le paiement
      { date: '2027-01-15', libelle: 'REJET VIR', montant: 812.003 },         // plus de 60 jours après
      { date: '2026-11-04', libelle: 'REJET VIR', montant: -987.654 },        // un débit
      { date: '2026-11-04', libelle: 'IMPAYE VIR', montant: 640.5 },          // un bulletin pas payé
    ]), bulletins, nomDe)).toEqual([]);
  });
  it('les mots du rejet, accents compris ; le soixantième jour compte encore', () => {
    const r = compta.virementsRevenus(releve([
      { date: '2026-11-03', libelle: 'Virement impayé', montant: 987.654 },
      { date: '2026-12-30', libelle: 'Vir. annulé par la banque', montant: 812.003 },
    ]), bulletins, nomDe);
    expect(r.map((x) => [x.bulletin, x.date])).toEqual([['b-nb', '2026-11-03'], ['b-mt', '2026-12-30']]);
  });
});
