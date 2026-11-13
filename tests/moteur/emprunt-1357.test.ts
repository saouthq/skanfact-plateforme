// Le prêt du four et sa première échéance (1.357.7 ; docs/revue-modules.md, bout en bout 16).
// Joué à la souris : la boulangerie note le prêt BIAT de 18 000 DT reçu le 02/11, alors que le solde de départ de la BIAT
// (48 250 DT) date du 11/11 — il le comprend déjà. La Trésorerie ne le comptait pas, la liste l'additionnait dans son pied,
// et les livres (les deux moteurs) l'écrivaient à la banque : le 532 à 66 250 DT pour 48 250. Puis la première échéance :
// 1 635 DT, dont 135 DT d'intérêts, que « Échéance d'emprunt » envoyait tout entière au 16.
// Ce que ce fichier tient (deux chemins, un chiffre) :
//   - un flux daté avant le solde de départ de son compte n'est écrit ni à la banque ni à la caisse : son côté trésorerie va
//     à la contrepartie du solde de départ (12 chez le client, 471 sur le serveur), en opération diverse ;
//   - un virement dont les deux côtés précèdent leurs soldes de départ n'écrit rien ;
//   - une échéance d'emprunt porte ses intérêts : le capital au 16, les intérêts au 651, la banque du montant entier — et le
//     résultat compte les intérêts ;
//   - les deux moteurs écrivent les mêmes lignes.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';
import { PLAN_PAR_DEFAUT } from '../../moteur/comptes.ts';
import { journalDeCompte, type PlanDuDossier } from '../../serveur/compta/plan.ts';
import { ecrituresDuMouvement } from '../../serveur/compta/mouvements.ts';

type Ligne = { account: string; debit: number; credit: number; journal: string; docId?: string; label?: string };
type Compte = { id: string; kind: string; isDefault: boolean; opening: number; openingDate: string; name: string };
type Mvt = Record<string, unknown>;
const core = ecranDeLaPlateforme('core.js') as {
  journalEntries: (d: unknown, c: unknown, p: object, o: object) => Ligne[];
  accountBalance: (d: unknown, c: unknown, id: string, au: string) => { balance: number };
  compteAvantDepart: (d: unknown, id: string, mode: string, date: string) => Compte | null;
  interetsDeLEcheance: (m: unknown) => number;
  simpleResult: (d: unknown, c: unknown, p: object) => { autres: number; resultat: number };
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const A = core.DEFAULT_ACCOUNTS as Record<'banque' | 'caisse' | 'emprunts' | 'reportANouveau' | 'interets', string>;
const biat: Compte = { id: 'bq', kind: 'banque', isDefault: true, opening: 48250, openingDate: '2026-11-11', name: 'BIAT compte courant' };
const caisse: Compte = { id: 'cs', kind: 'caisse', isDefault: false, opening: 300, openingDate: '2026-11-11', name: 'Caisse du comptoir' };
const company = { currency: 'TND', stampFee: 1, name: 'Boulangerie du test' };
const novembre = { from: '2026-11-01', to: '2026-11-30' };
const pret: Mvt = { id: 'm-pret', date: '2026-11-02', kind: 'pret', amount: 18000, accountId: 'bq', method: 'virement', label: 'Prêt BIAT pour le four', reference: 'Contrat 2026-114' };
const echeance: Mvt = { id: 'm-ech', date: '2026-11-12', kind: 'emprunt', amount: 1635, interets: 135, accountId: 'bq', method: 'virement', label: 'Échéance novembre', reference: 'ECH-2026-11' };

function dossier(movements: Mvt[], comptes: Compte[] = [biat]) {
  return { accounts: comptes, clients: [], suppliers: [], purchases: [], documents: [], payslips: [], employees: [], movements };
}
const millimes = (n: number) => Math.round(n * 1000);
const lignesDe = (d: unknown, id: string) => core.journalEntries(d, company, novembre, {}).filter((l) => l.docId === id)
  .map((l) => ({ journal: l.journal, compte: l.account, debit: millimes(l.debit), credit: millimes(l.credit) }));
const solde = (d: unknown, compte: string) => core.journalEntries(d, company, novembre, {}).filter((l) => l.account === compte)
  .reduce((s, l) => s + millimes(l.debit) - millimes(l.credit), 0);
const planServeur = (comptes: Compte[]) => ({ plan: { ...PLAN_PAR_DEFAUT }, auxiliaires: false, codesClients: new Map(), codesFournisseurs: new Map(),
  tresorerie: comptes.map((c) => ({ id: c.id, caisse: c.kind === 'caisse', parDefaut: c.isDefault, depart: c.openingDate })) }) as unknown as PlanDuDossier;
const ctx = { noms: new Map([['bq', biat.name], ['cs', caisse.name]]), moisAvecBulletin: new Set<string>() };
const duServeur = (m: Mvt, comptes: Compte[] = [biat]) => ecrituresDuMouvement('famille', m, planServeur(comptes), ctx)
  .flatMap((e) => e.lignes.map((l) => ({ journal: e.journal, compte: l.compte, debit: Number(l.debit), credit: Number(l.credit) })));

describe('un flux daté avant le solde de départ de son compte y est déjà compris', () => {
  it('la règle partagée : le compte dont le solde de départ suit le flux, sinon rien', () => {
    const d = dossier([pret]);
    expect(core.compteAvantDepart(d, 'bq', 'virement', '2026-11-02')?.id).toBe('bq');
    expect(core.compteAvantDepart(d, 'bq', 'virement', '2026-11-11')).toBeNull();
    expect(core.compteAvantDepart(d, 'bq', 'virement', '2026-11-12')).toBeNull();
    // Sans compte nommé : le compte par défaut, comme partout (`compteSansNom`).
    expect(core.compteAvantDepart(d, '', 'virement', '2026-11-02')?.id).toBe('bq');
  });

  it('le prêt du 02/11 : la banque ne bouge pas, le prêt entre au 16 contre le report à nouveau — chez le client', () => {
    const d = dossier([pret]);
    expect(lignesDe(d, 'm-pret')).toEqual([
      { journal: 'OD', compte: A.reportANouveau, debit: 18_000_000, credit: 0 },
      { journal: 'OD', compte: A.emprunts, debit: 0, credit: 18_000_000 },
    ]);
    // Deux chemins, un chiffre : la banque des livres est celle de la Trésorerie, le solde de départ seul.
    expect(solde(d, A.banque)).toBe(48_250_000);
    expect(millimes(core.accountBalance(d, company, 'bq', '2026-11-30').balance)).toBe(48_250_000);
  });

  it('… et sur le serveur, contre le compte d\'attente où arrive le solde de départ', () => {
    expect(duServeur(pret)).toEqual([
      { journal: 'OD', compte: '471', debit: 18_000_000, credit: 0 },
      { journal: 'OD', compte: '16', debit: 0, credit: 18_000_000 },
    ]);
    expect(journalDeCompte(planServeur([biat]), 'bq', 'virement', '2026-11-02')).toEqual({ journal: 'OD', compte: '471' });
    expect(journalDeCompte(planServeur([biat]), 'bq', 'virement', '2026-11-11')).toEqual({ journal: 'BQ', compte: '532' });
  });

  it('daté au jour du solde de départ ou après : à la banque, comme avant', () => {
    const apres = { ...pret, id: 'm-apres', date: '2026-11-11' };
    const d = dossier([apres]);
    expect(lignesDe(d, 'm-apres')).toEqual([
      { journal: 'BQ', compte: A.banque, debit: 18_000_000, credit: 0 },
      { journal: 'BQ', compte: A.emprunts, debit: 0, credit: 18_000_000 },
    ]);
    expect(duServeur(apres)[0]).toEqual({ journal: 'BQ', compte: '532', debit: 18_000_000, credit: 0 });
  });

  it('un virement dont les deux côtés précèdent leurs soldes de départ n\'écrit rien ; un seul côté, l\'autre seul bouge', () => {
    const v = { id: 'm-vir', date: '2026-11-05', kind: 'virement', amount: 200, accountId: 'cs', versAccountId: 'bq', method: 'especes', label: 'Versement' };
    expect(lignesDe(dossier([v], [biat, caisse]), 'm-vir')).toEqual([]);
    expect(duServeur(v, [biat, caisse])).toEqual([]);
    const caisseTot = { ...caisse, openingDate: '2026-11-01' };
    const lignes = lignesDe(dossier([v], [biat, caisseTot]), 'm-vir');
    expect(lignes).toEqual([
      { journal: 'CA', compte: A.reportANouveau, debit: 200_000, credit: 0 },
      { journal: 'CA', compte: A.caisse, debit: 0, credit: 200_000 },
    ]);
    expect(duServeur(v, [biat, caisseTot]).map((l) => [l.compte, l.debit, l.credit])).toEqual([['471', 200_000, 0], ['54', 0, 200_000]]);
  });
});

describe('une échéance d\'emprunt porte ses intérêts', () => {
  it('la part d\'intérêts : bornée à l\'échéance, rien pour une autre nature ni sans montant', () => {
    expect(core.interetsDeLEcheance(echeance)).toBe(135);
    expect(core.interetsDeLEcheance({ ...echeance, interets: 2000 })).toBe(1635);
    expect(core.interetsDeLEcheance({ ...echeance, interets: -5 })).toBe(0);
    expect(core.interetsDeLEcheance({ ...echeance, kind: 'banque' })).toBe(0);
    expect(core.interetsDeLEcheance({ ...echeance, interets: undefined })).toBe(0);
  });

  it('1 635 DT dont 135 d\'intérêts : 1 500 au 16, 135 au 651, la banque du tout — dans les deux moteurs', () => {
    const d = dossier([pret, echeance]);
    const attendu = [
      { journal: 'BQ', compte: '16', debit: 1_500_000, credit: 0 },
      { journal: 'BQ', compte: '651', debit: 135_000, credit: 0 },
      { journal: 'BQ', compte: '532', debit: 0, credit: 1_635_000 },
    ];
    expect(A.interets).toBe('651');
    expect(PLAN_PAR_DEFAUT.interets).toBe(A.interets);
    expect(lignesDe(d, 'm-ech')).toEqual(attendu);
    expect(duServeur(echeance)).toEqual(attendu);
    // La dette après la première échéance : 18 000 − 1 500, pas 18 000 − 1 635.
    expect(solde(d, A.emprunts)).toBe(-16_500_000);
  });

  it('le résultat compte les intérêts, jamais le capital', () => {
    const avec = core.simpleResult(dossier([pret, echeance]), company, novembre);
    const sans = core.simpleResult(dossier([pret]), company, novembre);
    expect(millimes(avec.autres - sans.autres)).toBe(135_000);
    expect(millimes(sans.resultat - avec.resultat)).toBe(135_000);
  });

  it('sans intérêts saisis, l\'échéance reste entière au 16 (comme avant)', () => {
    const brute = { ...echeance, id: 'm-brute', interets: undefined };
    expect(lignesDe(dossier([brute]), 'm-brute').map((l) => [l.compte, l.debit, l.credit])).toEqual([['16', 1_635_000, 0], ['532', 0, 1_635_000]]);
    expect(duServeur(brute).map((l) => [l.compte, l.debit, l.credit])).toEqual([['16', 1_635_000, 0], ['532', 0, 1_635_000]]);
  });
});
