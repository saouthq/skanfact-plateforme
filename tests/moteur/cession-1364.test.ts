// 1.364.0 — bout en bout 31 : Nour a clôturé jusqu'au 31/10/2026, puis enregistre sa camionnette, en service depuis le
// 01/07/2026 (30 000 DT, 5 ans), et la revend le 16/11/2026 28 500 DT. Montants calculés à la main, en base 360 :
// dotation 2026 jusqu'au 16/11 = 30 000 / 5 × 136 / 360 = 2 266,667 ; valeur comptable = 27 733,333 ; plus-value 766,667.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const KC = ecranDeLaPlateforme('compta.js') as Obj;

const donnees = (assets: Obj[]): Obj => ({ ...C.migrateData({}), assets, closedUntil: '2026-10-31' });
const ecrituresDe = (assets: Obj[], today = '2026-11-20') => {
  const d = donnees(assets);
  return C.journalEntries(d, d.company, null, { todayIso: today }).filter((l: Obj) => ['immobilisation', 'amortissement', 'cession'].includes(l.source));
};
const ligne = (l: Obj) => `${l.date} ${l.piece} ${l.account} ${Number(l.debit || 0).toFixed(3)} ${Number(l.credit || 0).toFixed(3)}`;
const camionnette = (plus: Obj = {}) => ({ id: 'cam', label: 'Camionnette', date: '2026-07-01', amount: 30000, residual: 0, years: 5, ...plus });

describe('un bien en service depuis un mois clôturé (app entreprise)', () => {
  it('le jour d\'entrée est la mise en service, sauf un jour d\'entrée figé plus tard', () => {
    expect(C.entreeDuBien({ date: '2026-07-01' })).toBe('2026-07-01');
    expect(C.entreeDuBien({ date: '2026-07-01', entreeLe: '2026-11-01' })).toBe('2026-11-01');
    expect(C.entreeDuBien({ date: '2026-12-01', entreeLe: '2026-11-01' })).toBe('2026-12-01');
  });

  it('son entrée se date au premier jour ouvert : rien ne s\'écrit dans le mois clôturé', () => {
    const l = ecrituresDe([camionnette({ entreeLe: '2026-11-01' })]).map(ligne);
    expect(l).toEqual(['2026-11-01 IMMO 22 30000.000 0.000', '2026-11-01 IMMO 12 0.000 30000.000']);
    expect(l.some((x: string) => x < '2026-11-01')).toBe(false);
  });

  it('sans jour d\'entrée figé, rien ne change : l\'entrée reste au jour de la mise en service', () => {
    expect(ecrituresDe([camionnette()]).map(ligne)).toEqual(['2026-07-01 IMMO 22 30000.000 0.000', '2026-07-01 IMMO 12 0.000 30000.000']);
  });

  it('revendue le 16/11 : la dotation court depuis le 01/07, la sortie reprend tout', () => {
    const l = ecrituresDe([camionnette({ entreeLe: '2026-11-01', disposal: { date: '2026-11-16', amount: 28500 } })]).map(ligne);
    expect(l).toEqual([
      '2026-11-01 IMMO 22 30000.000 0.000', '2026-11-01 IMMO 12 0.000 30000.000',
      '2026-11-16 AMORT-2026 681 2266.667 0.000', '2026-11-16 AMORT-2026 28 0.000 2266.667',
      '2026-11-16 CESSION 28 2266.667 0.000', '2026-11-16 CESSION 675 27733.333 0.000', '2026-11-16 CESSION 22 0.000 30000.000',
    ]);
  });

  it('un bien de 2024 : les dotations des exercices finis entrent avec lui, contre le report à nouveau', () => {
    // 10 000 DT sur 5 ans depuis le 01/03/2024 : 2024 = 2 000 × 300 / 360 = 1 666,667 ; 2025 = 2 000 ; ensemble 3 666,667.
    const l = ecrituresDe([{ id: 'four', label: 'Four', date: '2024-03-01', amount: 10000, residual: 0, years: 5, entreeLe: '2026-11-01' }]).map(ligne);
    expect(l).toEqual(['2026-11-01 IMMO 22 10000.000 0.000', '2026-11-01 IMMO 28 0.000 3666.667', '2026-11-01 IMMO 12 0.000 6333.333']);
  });

  it('un bien né d\'un achat : seules ses dotations passées entrent, la valeur vient de l\'achat', () => {
    const l = ecrituresDe([{ id: 'four', label: 'Four', date: '2024-03-01', amount: 10000, residual: 0, years: 5, entreeLe: '2026-11-01', purchaseId: 'a1' }]).map(ligne);
    expect(l).toEqual(['2026-11-01 IMMO 28 0.000 3666.667', '2026-11-01 IMMO 12 3666.667 0.000']);
  });
});

// ── Au Cabinet : la fiche reprise d'un bien que le client a saisi à la main n'a aucune ligne d'entrée dans le livre.
const fiche = (plus: Obj = {}): Obj => ({ id: 'f-0000-3195', libelle: 'Camionnette', compte: '224', compteAmort: '28', compteDotation: '681', valeur: 30000, residuelle: 0, duree: 5,
  methode: 'lineaire', dateMiseEnService: '2026-07-01', dateAcquisition: '2026-07-01', origine: { source: 'client', docId: 'cam' }, plan: [], ...plus });
const livre = (immobilisations: Obj[], ecritures: Obj[] = []): Obj => ({ ecritures, immobilisations, audit: [], plan: [{ compte: '224', libelle: 'Matériel de transport' }] });
const bien = (plus: Obj = {}) => ({ id: 'cam', libelle: 'Camionnette', date: '2026-07-01', valeur: '30000', residuelle: '0', duree: '5', achat: '', entree: '2026-11-01', sortie: null, ...plus });

describe('le bien que rien n\'a fait entrer au livre (Cabinet)', () => {
  it('son entrée se propose au jour où le client l\'a fait entrer : la valeur au 224, le report à nouveau en face', () => {
    const r = KC.entreesManquantes(livre([fiche()]), 2026, [bien()]);
    expect(r.length).toBe(1);
    expect([r[0].date, r[0].piece, r[0].journal]).toEqual(['2026-11-01', 'ENT-3195', 'OD']);
    expect(r[0].lignes.map((l: Obj) => `${l.compte} ${l.debit} ${l.credit}`)).toEqual(['224 30000 0', '12 0 30000']);
  });

  it('un bien né d\'un achat chez le client ne se propose pas : sa facture le fait entrer', () => {
    expect(KC.entreesManquantes(livre([fiche()]), 2026, [bien({ achat: 'ACH-2026-004' })])).toEqual([]);
  });

  it('rien ne se propose deux fois : l\'entrée passée, ou une ligne qui débite déjà le compte de cette valeur', () => {
    const passee = { id: 'e1', journal: 'OD', date: '2026-11-01', piece: 'ENT-3195', statut: 'brouillard', lignes: [{ compte: '224', debit: 30000, credit: 0 }, { compte: '11', debit: 0, credit: 30000 }] };
    expect(KC.entreesManquantes(livre([fiche()], [passee]), 2026, [bien()])).toEqual([]);
    // L'entrée passée puis rangée par le comptable dans un sous-compte : la pièce suffit, elle ne se repropose pas.
    expect(KC.entreesManquantes(livre([fiche()], [{ ...passee, lignes: [{ compte: '2241', debit: 30000, credit: 0 }, { compte: '12', debit: 0, credit: 30000 }] }]), 2026, [bien()])).toEqual([]);
    const main = { ...passee, piece: 'OD-12' };
    expect(KC.entreesManquantes(livre([fiche()], [main]), 2026, [bien()])).toEqual([]);
    // Une entrée contre-passée ne compte plus : elle se repropose.
    expect(KC.entreesManquantes(livre([fiche()], [{ ...passee, statut: 'contrepassee' }]), 2026, [bien()]).length).toBe(1);
  });

  it('l\'entrée passée n\'est pas une « ligne sans fiche » : le bien ne s\'amortirait pas deux fois', () => {
    const passee = { id: 'e1', journal: 'OD', date: '2026-11-01', piece: 'ENT-3195', statut: 'brouillard', lignes: [{ compte: '224', libelle: 'Entrée', debit: 30000, credit: 0 }, { compte: '11', debit: 0, credit: 30000 }] };
    const L = livre([fiche()], [passee]);
    L.plan.push({ compte: '22', role: 'immobilisations' });
    expect(KC.immobilisationsACreer(L, 2026)).toEqual([]);
    // La même ligne sous une autre pièce reste une acquisition à ficher.
    expect(KC.immobilisationsACreer(livre([fiche()], [{ ...passee, piece: 'ACH-9' }]), 2026).length).toBe(1);
  });

  it('une fiche saisie au Cabinet pour un bien de 2024 : l\'entrée au 1er janvier, avec ses amortissements passés', () => {
    // 10 000 DT sur 5 ans depuis le 01/03/2024 : amorti au 31/12/2025 = 1 666,667 + 2 000 = 3 666,667.
    const f = fiche({ id: 'f-0000-0042', libelle: 'Four', valeur: 10000, dateMiseEnService: '2024-03-01', dateAcquisition: '2024-03-01', origine: null });
    const r = KC.entreesManquantes(livre([f]), 2026, []);
    expect(r[0].date).toBe('2026-01-01');
    expect(r[0].lignes.map((l: Obj) => `${l.compte} ${l.debit} ${l.credit}`)).toEqual(['224 10000 0', '28 0 3666.667', '12 0 6333.333']);
  });
});
