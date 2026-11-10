// Un virement ne tombe jamais dans le tiroir (1.353.0 ; docs/revue-modules.md, « Bout en bout »).
// Joué à la souris : une épicerie neuve émet sa première facture (358,000 DT), note 200 DT reçus par virement alors
// qu'elle n'a encore aucun compte de trésorerie, puis crée sa caisse avec 50 DT de fond. La caisse, seul compte, devenait
// le compte par défaut : le virement y tombait, et l'ouverture de la caisse proposait 250 DT dans le tiroir.
// Ce que ce fichier tient (deux chemins, un chiffre) :
//   - sans compte nommé, un règlement qui n'est pas en espèces ne va jamais dans une caisse par défaut ;
//   - la Trésorerie (`cashMovements`), les écritures (`journalEntries`) et le serveur (`journalDeCompte`, plan.ts) disent
//     la même chose ;
//   - des espèces, ou un règlement sans mode connu, gardent la règle d'avant (le compte par défaut).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';
import { journalDeCompte, type PlanDuDossier } from '../../serveur/compta/plan.ts';

type Ligne = { account: string; debit: number; credit: number; journal?: string };
type Mouvement = { id: string; amount: number; accountId: string; source: string };
type Compte = { id: string; kind: string; isDefault: boolean; opening: number; name: string };
const core = ecranDeLaPlateforme('core.js') as {
  journalEntries: (d: unknown, c: unknown, p: object, o: object) => Ligne[];
  cashMovements: (d: unknown, c: unknown, p: object, a: string | null) => Mouvement[];
  compteSansNom: (comptes: Compte[], mode: string) => Compte | undefined;
  DEFAULT_ACCOUNTS: { banque: string; caisse: string };
};
const A = core.DEFAULT_ACCOUNTS;
const caisse: Compte = { id: 'cs', kind: 'caisse', isDefault: true, opening: 50, name: 'Caisse' };
const banque: Compte = { id: 'bq', kind: 'banque', isDefault: false, opening: 0, name: 'Compte courant' };
const company = { currency: 'TND', stampFee: 1, name: 'Épicerie fine du Lac' };
const annee = { from: '2026-01-01', to: '2026-12-31' };

// La facture du parcours : 12 bouteilles à 25,000 DT, TVA 19 %, timbre 1 DT ; 200 DT reçus le jour même.
function dossier(comptes: Compte[], mode: string | undefined, compteDuPaiement = '') {
  return {
    accounts: comptes, clients: [{ id: 'c1', name: 'Restaurant Dar Zitouna' }], suppliers: [], purchases: [], movements: [],
    documents: [{ id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-11-10', clientId: 'c1', currency: 'TND', stamp: true, stampFee: 1,
      lines: [{ label: 'Huile d\'olive extra vierge 75 cl', quantity: 12, unitPrice: 25, vatRate: 19 }],
      payments: [{ id: 'p1', date: '2026-11-10', amount: 200, ...(mode === undefined ? {} : { method: mode }), accountId: compteDuPaiement }] }],
  };
}
const duPaiement = (d: unknown) => {
  const m = core.cashMovements(d, company, annee, null).filter((x) => x.source === 'vente');
  expect(m).toHaveLength(1);
  return m[0] as Mouvement;
};
const millimes = (n: number) => Math.round(n * 1000);
const debit = (d: unknown, compte: string) => core.journalEntries(d, company, annee, {}).filter((l) => l.account === compte).reduce((s, l) => s + millimes(l.debit), 0);
const plan = (comptes: Compte[]) => ({ plan: { caisse: A.caisse, banque: A.banque }, auxiliaires: false, codesClients: new Map(), codesFournisseurs: new Map(),
  tresorerie: comptes.map((c) => ({ id: c.id, caisse: c.kind === 'caisse', parDefaut: c.isDefault })) }) as unknown as PlanDuDossier;

describe('sans compte nommé, un virement ne tombe pas dans la caisse', () => {
  it('une caisse pour seul compte : le virement reste sans compte, à la banque dans les écritures et sur le serveur', () => {
    const d = dossier([caisse], 'virement');
    expect(duPaiement(d).accountId).toBe('');
    // Le tiroir ne reçoit rien : aucune ligne de trésorerie dans la caisse.
    expect(core.cashMovements(d, company, annee, 'cs')).toEqual([]);
    expect(debit(d, A.banque)).toBe(200_000);
    expect(debit(d, A.caisse)).toBe(0);
    expect(journalDeCompte(plan([caisse]), null, 'virement')).toEqual({ journal: 'BQ', compte: A.banque });
  });

  it('chèque, carte, traite, paiement en ligne : pareil ; des espèces vont bien dans la caisse', () => {
    for (const mode of ['cheque', 'carte', 'traite', 'en-ligne', 'autre']) {
      expect(core.compteSansNom([caisse], mode), mode).toBeUndefined();
      expect(journalDeCompte(plan([caisse]), null, mode).journal, mode).toBe('BQ');
    }
    const d = dossier([caisse], 'especes');
    expect(duPaiement(d).accountId).toBe('cs');
    expect(debit(d, A.caisse)).toBe(200_000);
    expect(journalDeCompte(plan([caisse]), null, 'especes')).toEqual({ journal: 'CA', compte: A.caisse });
  });

  it('dès qu\'un compte bancaire existe, le virement sans compte y va, même si la caisse est restée le compte par défaut', () => {
    const d = dossier([caisse, banque], 'virement');
    expect(duPaiement(d).accountId).toBe('bq');
    expect(core.cashMovements(d, company, annee, 'bq').map((m) => m.amount)).toEqual([200]);
    expect(debit(d, A.banque)).toBe(200_000);
    expect(journalDeCompte(plan([caisse, banque]), null, 'virement').journal).toBe('BQ');
  });

  it('ce qui ne change pas : un compte nommé décide, un règlement sans mode garde le compte par défaut, une banque par défaut reçoit les espèces sans compte', () => {
    // Nommé : la caisse, même pour un virement (la personne l'a choisi).
    const nomme = dossier([caisse, banque], 'virement', 'cs');
    expect(duPaiement(nomme).accountId).toBe('cs');
    expect(debit(nomme, A.caisse)).toBe(200_000);
    expect(journalDeCompte(plan([caisse, banque]), 'cs', 'virement').journal).toBe('CA');
    // Sans mode connu : la règle d'avant.
    const sansMode = dossier([caisse], undefined);
    expect(duPaiement(sansMode).accountId).toBe('cs');
    expect(journalDeCompte(plan([caisse]), null, '').journal).toBe('CA');
    // La banque par défaut : rien ne bouge pour les entreprises d'aujourd'hui.
    const bqDefaut = [{ ...banque, isDefault: true }, { ...caisse, isDefault: false }];
    expect(duPaiement(dossier(bqDefaut, 'especes')).accountId).toBe('bq');
    expect(journalDeCompte(plan(bqDefaut), null, 'especes').journal).toBe('BQ');
    expect(duPaiement(dossier(bqDefaut, 'virement')).accountId).toBe('bq');
  });
});
