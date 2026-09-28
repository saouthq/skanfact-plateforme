// Le banc des règlements fournisseurs (cadrage 08 § 1.2) : pour chaque achat, la v10 et le nouveau
// moteur disent la même retenue opérée à chaque règlement, le même reste, le même statut, et
// écrivent chaque règlement au même millime, compte par compte. Un écart se tranche et s'écrit.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import {
  calculerAchat, ecritureDeReglementFournisseur, imputationAchat, soldeAchat, statutAchat,
  type Achat, type ComptesReglementFournisseur, type StatutAchat,
} from '../../moteur/achats.ts';
import { dansLaDeviseDe } from '../../moteur/ecritures.ts';
import { retenueAuFil, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { convertirAchat, factureDAchatAuHasard, type AchatDonne } from './v10-achats.ts';
import { demo, entier, exiger, hasard, v10, type Societe } from './v10.ts';

type Donnees = { purchases: AchatDonne[]; suppliers?: { id: string; name: string }[] };
type LigneV10 = { docId: string; account: string; debit: number; credit: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: Donnees, societe: Societe, periode: object, options: object) => LigneV10[];
  retenueDesReglements: (p: AchatDonne, c: Societe, data?: Donnees) => { parts: Record<string, number>; due: number };
  purchaseBalance: (p: AchatDonne, c: Societe, data?: Donnees) => { paid: number; impute: number; remaining: number };
  purchaseStatus: (p: AchatDonne, c: Societe, jour: string, data?: Donnees) => string;
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const P = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesReglementFournisseur = {
  fournisseurs: P.fournisseurs ?? '', tresorerie: P.banque ?? '', retenueOperee: P.rsOperee ?? '', gainsChange: P.gainsChange ?? '', pertesChange: P.pertesChange ?? '',
};
const STATUTS: Record<string, StatutAchat> = {
  'payée': 'payee', partiel: 'partiel', retard: 'en_retard', 'à payer': 'a_payer', 'imputé': 'impute', 'remboursé': 'rembourse', 'à imputer': 'a_imputer',
};
const JOUR = '2026-09-28';
type Vus = { achats: number; reglements: number; retenues: number; centimes: number; coursDuJour: number };

function comparer(data: Donnees, societe: Societe, vus: Vus): string[] {
  const faux: string[] = [];
  const convertis = new Map<string, Achat>();
  for (const p of data.purchases) {
    const a = convertirAchat(p, societe);
    if (typeof a === 'string') return [];
    convertis.set(p.id, a);
  }
  const reglements = (p: AchatDonne, dec: number): Reglement[] | null => {
    const r: Reglement[] = [];
    for (const [i, y] of (p.payments ?? []).entries()) {
      const montant = entier(Number(y.amount), dec), cours = Number(y.exchangeRate) > 0 ? entier(Number(y.exchangeRate), 6) : undefined;
      if (montant === null || cours === null) return null;
      r.push({ cle: y.id || `#${i}`, date: y.date ?? '', montant, cours });
    }
    return r;
  };
  const lignes10 = core.journalEntries(data, societe, {}, { sections: ['reglements'] });
  for (const p of data.purchases) {
    const a = convertis.get(p.id) as Achat;
    const t = calculerAchat(a, TND);
    const regs = reglements(p, a.devise.decimales);
    if (!regs) return [];
    // Les pièces rattachées : ce qu'elles couvrent, dans la devise de cet achat.
    const liees: PieceLiee[] = [];
    if (a.nature !== 'avoir' && a.nature !== 'acompte') {
      for (const x of data.purchases.filter((y) => y.achatLie === p.id)) {
        const ax = convertis.get(x.id) as Achat;
        const im = imputationAchat(calculerAchat(ax, TND), ax.nature, reglements(x, ax.devise.decimales) ?? []);
        liees.push({ cle: x.id, date: ax.nature === 'acompte' ? '' : (x.date ?? ''), net: dansLaDeviseDe(im.net, ax, a, TND), brut: dansLaDeviseDe(im.brut, ax, a, TND) });
      }
    }
    const rs = retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, liees, regs);
    const rs10 = core.retenueDesReglements(p, societe, data);
    vus.achats++;
    // 1. La retenue de chaque règlement ; en devise, la v10 la tient au millième (écart tranché).
    // Par ricochet : un avoir en devise rattaché, remboursé et soumis à la retenue, couvre de sa
    // facture un brut qui dépend de SA retenue au centime ; la part de la facture en bouge d'au plus
    // un centime converti (50 millimes, au cours le plus haut du tirage).
    const parRicochet = data.purchases.some((x) => x.achatLie === p.id && x.kind === 'avoir' && x.currency && x.currency !== 'DT' && (x.payments ?? []).length && Number(x.withholdingRate) > 0);
    const centimes = new Set<string>();
    for (const [cle, part] of rs.parts) {
      const ancienne = rs10.parts[cle] ?? 0;
      if (entier(ancienne, a.devise.decimales) === part) continue;
      const ecart = Math.abs(ancienne * 10 ** a.devise.decimales - Number(part));
      if ((a.devise.code !== 'TND' && ecart < 1 + 1e-6) || (parRicochet && ecart <= 50 + 1e-6)) { centimes.add(cle); vus.centimes++; continue; }
      faux.push(`${p.id} part de ${cle} : v10 ${ancienne}, nouveau ${part}`);
    }
    // 2. Le reste et le statut.
    const solde = soldeAchat(t, a.nature, !!p.achatLie, regs.map((r) => r.montant), liees.map((l) => l.net));
    const b10 = core.purchaseBalance(p, societe, data);
    const d = a.devise.decimales;
    if (entier(b10.paid, d) !== solde.paye || entier(b10.impute ?? 0, d) !== solde.impute || entier(b10.remaining, d) !== solde.reste) {
      faux.push(`${p.id} solde : v10 ${b10.paid}/${b10.impute}/${b10.remaining}, nouveau ${solde.paye}/${solde.impute}/${solde.reste}`);
    }
    const s10 = STATUTS[core.purchaseStatus(p, societe, JOUR, data)];
    const statut = statutAchat(a.nature, !!p.achatLie, solde, p.dueDate, JOUR);
    if (s10 !== statut) faux.push(`${p.id} statut : v10 ${s10}, nouveau ${statut}`);
    // 3. L'écriture de chaque règlement, dans l'ordre des dates (chacune commence par le fournisseur).
    const ecritures10: string[][] = [];
    for (const l of lignes10.filter((x) => x.docId === p.id)) {
      if (l.account === COMPTES.fournisseurs) ecritures10.push([]);
      ecritures10.at(-1)?.push(`${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
    }
    const ordre = [...regs].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    if (ordre.length !== ecritures10.length) faux.push(`${p.id} : ${ecritures10.length} règlements écrits par la v10, ${ordre.length} par le nouveau`);
    ordre.forEach((r, i) => {
      vus.reglements++;
      if (rs.parts.get(r.cle)) vus.retenues++;
      if (r.cours) vus.coursDuJour++;
      const n = ecritureDeReglementFournisseur(a, r, rs.parts.get(r.cle) ?? 0n, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
      const v = ecritures10[i] ?? [];
      if (JSON.stringify(n) === JSON.stringify(v)) return;
      // Une part tranchée au centime ne bouge que le fournisseur et la retenue, du même montant.
      const hors = (x: string[]) => x.filter((l) => !l.startsWith(`${COMPTES.fournisseurs} `) && !l.startsWith(`${COMPTES.retenueOperee} `));
      if (centimes.has(r.cle) && JSON.stringify(hors(n)) === JSON.stringify(hors(v))) return;
      faux.push(`${p.id} règlement ${r.cle} : v10 [${v.join(' | ')}] ; nouveau [${n.join(' | ')}]`);
    });
  }
  return faux;
}

describe('le banc des règlements fournisseurs, contre la v10', () => {
  it('chaque achat de l\'exemple de cinq ans : même retenue par règlement, même reste, même statut, mêmes écritures', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, JOUR) as unknown as Donnees & { company: Societe };
    const vus: Vus = { achats: 0, reglements: 0, retenues: 0, centimes: 0, coursDuJour: 0 };
    expect(comparer(donnees, donnees.company, vus)).toEqual([]);
    expect(vus.reglements).toBeGreaterThan(100);
    expect(vus.retenues).toBeGreaterThan(5);
  });

  it('3 000 factures d\'achat tirées au hasard, avec avoirs remboursés, acomptes payés et cours du jour : les mêmes, sauf l\'écart tranché', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20261003);
    const faux: string[] = [];
    const vus: Vus = { achats: 0, reglements: 0, retenues: 0, centimes: 0, coursDuJour: 0 };
    for (let i = 0; i < 3000 && faux.length < 5; i++) {
      const achats = factureDAchatAuHasard(h, i);
      const f = achats[0] as AchatDonne;
      f.dueDate = h.parmi(['2026-04-01', '2026-09-27', '2026-09-28', '2026-12-31']);
      for (const x of achats) {
        const dec = x.currency && x.currency !== 'DT' ? 2 : 3;
        // Un acompte se paie ; un règlement en devise porte parfois son cours du jour.
        if (x.kind === 'acompte' && h.suivant() < 0.7) x.payments = [{ id: 'a0', date: '2026-02-20', amount: Number((h.entre(1, 900) + h.suivant()).toFixed(dec)) }];
        for (const y of x.payments ?? []) if (dec === 2 && h.suivant() < 0.5) y.exchangeRate = h.parmi([3.3, 3.41, 3.3517]);
      }
      faux.push(...comparer({ purchases: achats, suppliers: [{ id: 's1', name: 'Fournisseur' }] }, societe, vus).map((x) => `${i} : ${x}`));
    }
    expect(faux).toEqual([]);
    // Le tirage atteint chaque cas, et l'écart tranché existe bien (sinon sa règle n'a rien vérifié).
    expect(vus.achats).toBeGreaterThan(4500);
    expect(vus.reglements).toBeGreaterThan(3000);
    expect(vus.retenues).toBeGreaterThan(1800);
    expect(vus.coursDuJour).toBeGreaterThan(500);
    expect(vus.centimes).toBeGreaterThan(0);
  });
});
