// Le banc des règlements (cadrage 08 § 1.2) : pour chaque facture, la v10 et le nouveau moteur
// disent la même retenue née à chaque encaissement, le même reste à payer, le même statut, et
// écrivent chaque encaissement au même millime, compte par compte. Un écart se tranche et s'écrit.

import { describe, expect, it } from 'vitest';
import { TND, type Devise } from '../../moteur/argent.ts';
import { calculerPiece } from '../../moteur/piece.ts';
import {
  dansLaDeviseDe, ecritureDEncaissement, retenueAuFil, soldeFacture, statutFacture,
  type ComptesEncaissement, type PieceLiee, type Reglement, type StatutFacture,
} from '../../moteur/reglements.ts';
import { convertir, demo, entier, exiger, hasard, pieceAuHasard, v10, type DocV10, type Societe } from './v10.ts';

type PaiementV10 = { id?: string; date?: string; amount: number | string; exchangeRate?: number | string; method?: string };
type FactureV10 = DocV10 & { id: string; number?: string; date?: string; dueDate?: string; status?: string; creditOf?: string; payments?: PaiementV10[] };
type Donnees = { documents: FactureV10[]; clients?: { id: string; name: string }[] };
type LigneV10 = { docId: string; account: string; debit: number; credit: number };
type RetenueV10 = { parts: Record<string, number>; ajustements: Record<string, number>; due: number; operee: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: Donnees, societe: Societe, periode: object, options: object) => LigneV10[];
  retenueSubie: (d: FactureV10, data: Donnees, societe: Societe) => RetenueV10;
  invoiceBalance: (d: FactureV10, data: Donnees, societe: Societe) => { credited: number; paid: number; remaining: number };
  effectiveStatus: (d: FactureV10, data: Donnees, societe: Societe, jour: string) => string;
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const P = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesEncaissement = {
  clients: P.clients ?? '', tresorerie: P.banque ?? '', retenueSubie: P.rsSubie ?? '', gainsChange: P.gainsChange ?? '', pertesChange: P.pertesChange ?? '',
};
const STATUTS: Record<string, StatutFacture> = { 'payée': 'payee', 'annulée': 'annulee', partielle: 'partielle', retard: 'en_retard', 'envoyée': 'a_payer' };
const cleDe = (p: PaiementV10, i: number) => p.id || `#${i}`;

// Ce que la v10 et le nouveau moteur disent d'une facture ; la liste des différences (vide : les
// mêmes). `centimes` recueille les parts de retenue en devise, que la v10 tient au millième d'euro
// (écart tranché ci-dessous).
function comparer(f: FactureV10, data: Donnees, societe: Societe, jour: string, centimes: string[]): string[] | string {
  const faux: string[] = [];
  const pf = convertir(f, societe);
  if (typeof pf === 'string') return pf;
  const devise = pf.devise;
  const enUnites = (x: number) => entier(x, devise.decimales);
  const t = calculerPiece(pf);
  const annulee = f.status === 'annulée';
  const avoirs = data.documents.filter((a) => a.type === 'avoir' && a.creditOf === f.id && a.status !== 'brouillon');
  const liees: PieceLiee[] = [];
  for (const a of avoirs) {
    const pa = convertir(a, societe);
    if (typeof pa === 'string') return `avoir ${a.id} : ${pa}`;
    const ta = calculerPiece(pa);
    const conv = (m: bigint) => dansLaDeviseDe(m, pa, pf, TND);
    liees.push({ cle: a.id, date: a.date ?? '', net: conv(ta.netAPayer), brut: conv(ta.netAPayer + ta.retenue) });
  }
  const reglements: Reglement[] = [];
  for (const [i, p] of (f.payments ?? []).entries()) {
    const montant = enUnites(Number(p.amount));
    const cours = Number(p.exchangeRate) > 0 ? entier(Number(p.exchangeRate), 6) : undefined;
    if (montant === null || cours === null) return `règlement non représentable : ${JSON.stringify(p)}`;
    reglements.push({ cle: cleDe(p, i), date: p.date ?? '', montant, cours });
  }

  // 1. La retenue née à chaque règlement.
  const rs = annulee ? retenueAuFil(0n, 0n, [], []) : retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, liees, reglements);
  const r10 = core.retenueSubie(f, data, societe);
  if (enUnites(r10.due) !== rs.due) faux.push(`retenue due : v10 ${r10.due}, nouveau ${rs.due}`);
  for (const [cle, part] of rs.parts) {
    const ancienne = r10.parts[cle] ?? 0;
    const exacte = enUnites(ancienne);
    if (exacte === part) continue;
    // La v10 tient la part d'un règlement en devise au MILLIÈME d'euro ; le nouveau moteur à l'unité
    // de la devise (le centime). La différence ne dépasse jamais un centime par règlement.
    const ecart = Math.abs(ancienne * 10 ** devise.decimales - Number(part));
    if (devise.code !== 'TND' && ecart < 1 + 1e-6) { centimes.push(`${f.id}/${cle}`); continue; }
    faux.push(`part de ${cle} : v10 ${ancienne}, nouveau ${part}`);
  }
  // Une régularisation absente vaut zéro (la v10 en garde une de 0,001 € que le centime efface).
  for (const cle of new Set([...Object.keys(r10.ajustements), ...rs.ajustements.keys()])) {
    const ancien = r10.ajustements[cle] ?? 0, d = rs.ajustements.get(cle) ?? 0n;
    if (enUnites(ancien) === d) continue;
    if (devise.code !== 'TND' && Math.abs(ancien * 10 ** devise.decimales - Number(d)) < 1 + 1e-6) { centimes.push(`${f.id}/${cle}`); continue; }
    faux.push(`régularisation par ${cle} : v10 ${ancien}, nouveau ${d}`);
  }

  // 2. Le reste à payer et le statut.
  const solde = soldeFacture(t.netAPayer, liees.map((l) => l.net), reglements.map((r) => r.montant), annulee);
  const b10 = core.invoiceBalance(f, data, societe);
  if (enUnites(b10.credited) !== solde.credite || enUnites(b10.paid) !== solde.paye || enUnites(b10.remaining) !== solde.reste) {
    faux.push(`solde : v10 ${b10.credited}/${b10.paid}/${b10.remaining}, nouveau ${solde.credite}/${solde.paye}/${solde.reste}`);
  }
  const s10 = STATUTS[core.effectiveStatus(f, data, societe, jour)];
  const statut = statutFacture(t.netAPayer, solde, f.dueDate, jour, annulee);
  if (s10 !== statut) faux.push(`statut : v10 ${s10}, nouveau ${statut}`);

  // 3. L'écriture de chaque encaissement, dans l'ordre des dates (la v10 les trie de même).
  const lignes10 = core.journalEntries(data, societe, {}, { sections: ['encaissements'] }).filter((l) => l.docId === f.id);
  const ecritures10: string[][] = [];
  for (const l of lignes10) {
    if (l.account === COMPTES.tresorerie || l.account === P.caisse) ecritures10.push([]);
    ecritures10.at(-1)?.push(`${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
  }
  const ordre = [...reglements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const nouvelles = ordre.map((r) => ecritureDEncaissement(pf, r, rs.parts.get(r.cle) ?? 0n, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`));
  if (ecritures10.length !== nouvelles.length) faux.push(`encaissements : v10 ${ecritures10.length}, nouveau ${nouvelles.length}`);
  nouvelles.forEach((n, i) => {
    const a = ecritures10[i] ?? [];
    if (JSON.stringify(a) === JSON.stringify(n)) return;
    // Seule une part de retenue tranchée (au centime) peut les séparer : alors la trésorerie et le
    // change sont les mêmes, et le client bouge exactement de ce que bouge la retenue.
    const r = ordre[i];
    if (r && centimes.includes(`${f.id}/${r.cle}`) && memeHorsRetenue(a, n)) return;
    faux.push(`encaissement ${r?.cle} : v10 [${a.join(' | ')}] ; nouveau [${n.join(' | ')}]`);
  });
  return faux;
}

function memeHorsRetenue(v10Lignes: string[], nouvelles: string[]): boolean {
  const solde = (lignes: string[], compte: string) => lignes.filter((l) => l.startsWith(`${compte} `))
    .reduce((s, l) => { const [, d, c] = l.split(' '); return s + Number(d) - Number(c); }, 0);
  const autres = (lignes: string[]) => lignes.filter((l) => !l.startsWith(`${COMPTES.clients} `) && !l.startsWith(`${COMPTES.retenueSubie} `));
  return JSON.stringify(autres(v10Lignes)) === JSON.stringify(autres(nouvelles))
    && solde(nouvelles, COMPTES.clients) - solde(v10Lignes, COMPTES.clients) === -(solde(nouvelles, COMPTES.retenueSubie) - solde(v10Lignes, COMPTES.retenueSubie));
}

// Un montant de la v10 tiré au hasard, écrit aux décimales de sa devise.
const auxDecimales = (x: number, d: Devise) => Number(x.toFixed(d.decimales));
const JOURS = ['2026-03-10', '2026-03-10', '2026-03-25', '2026-04-02', '2026-04-15', '2026-05-01', '2026-05-20', '2026-06-30', '2026-07-14'];

describe('le banc des règlements, contre la v10', () => {
  it('chaque facture de l\'exemple de cinq ans : même retenue par encaissement, même reste, même statut, mêmes écritures', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as Donnees & { company: Societe };
    const factures = donnees.documents.filter((d) => d.type === 'facture' && d.status !== 'brouillon');
    const centimes: string[] = [];
    const faux: string[] = [];
    let encaissements = 0, avecRetenue = 0;
    for (const f of factures) {
      const e = comparer(f, donnees, donnees.company, '2026-09-28', centimes);
      if (typeof e === 'string') faux.push(`${f.id} : ${e}`);
      else faux.push(...e.map((x) => `${f.id} : ${x}`));
      encaissements += f.payments?.length ?? 0;
      if (Number(f.withholdingRate) > 0 && f.payments?.length) avecRetenue++;
    }
    expect(faux).toEqual([]);
    expect(encaissements).toBeGreaterThan(200);
    expect(avecRetenue).toBeGreaterThan(20);
  });

  it('5 000 factures tirées au hasard, avec avoirs, acomptes, remboursements et cours du jour : les mêmes, sauf l\'écart tranché', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20260929);
    const centimes: string[] = [];
    const faux: string[] = [];
    const vus = { factures: 0, reglements: 0, retenues: 0, avoirs: 0, devises: 0, remboursements: 0, coursDuJour: 0, soldees: 0 };
    for (let i = 0; i < 5000 && faux.length < 5; i++) {
      const base = pieceAuHasard(h);
      if (base.currency && base.currency !== 'DT' && !(Number(base.exchangeRate) > 0)) continue;
      const f: FactureV10 = {
        ...base, type: 'facture', id: `f${i}`, number: `FAC-${i}`, date: '2026-03-10', clientId: 'c1',
        status: h.parmi(['envoyée', 'envoyée', 'envoyée', 'envoyée', 'envoyée', 'annulée']),
        ...(h.suivant() < 0.7 ? { dueDate: h.parmi(['2026-04-09', '2026-09-27', '2026-09-28', '2026-10-15']) } : {}),
      } as FactureV10;
      const pf = convertir(f, societe);
      if (typeof pf === 'string') continue;
      const devise = pf.devise;
      const net = Number(calculerPiece(pf).netAPayer) / 10 ** devise.decimales;
      const documents: FactureV10[] = [f];
      // Des avoirs sur la facture, parfois dans une autre devise, parfois avant tout règlement.
      if (h.suivant() < 0.3) {
        for (let k = 0; k < h.entre(1, 2); k++) {
          const a = pieceAuHasard(h);
          const memeDevise = h.suivant() < 0.8;
          documents.push({
            ...a, type: 'avoir', id: `a${i}-${k}`, number: `AVO-${i}-${k}`, date: h.parmi(JOURS), status: h.parmi(['émis', 'émis', 'brouillon']),
            creditOf: f.id, withholdingRate: f.withholdingRate, applyStamp: false,
            currency: memeDevise ? f.currency : (f.currency === 'DT' ? 'EUR' : 'DT'),
            exchangeRate: memeDevise ? f.exchangeRate : h.parmi([3.35, 3.2811]),
            lines: (a.lines ?? []).slice(0, 2).map((l) => ({ ...l, unitPrice: Number((Math.abs(Number(l.unitPrice) || 0) / h.entre(3, 40)).toFixed(3)) })),
          } as FactureV10);
        }
      }
      // Des règlements : une part du net, le reste exact, un trop-perçu rendu, au cours du jour.
      const payments: PaiementV10[] = [];
      const n = h.parmi([0, 1, 1, 2, 2, 3, 4]);
      let verse = 0;
      for (let k = 0; k < n; k++) {
        const dernier = k === n - 1 && h.suivant() < 0.6;
        let montant = dernier ? net - verse : auxDecimales(net * h.parmi([0.1, 0.25, 1 / 3, 0.5, 0.37, 0.9]), devise);
        if (h.suivant() < 0.08) montant = -auxDecimales(Math.abs(net) * 0.05, devise);
        montant = auxDecimales(montant, devise);
        if (!montant) continue;
        verse += montant;
        payments.push({
          id: `p${k}`, date: h.parmi(JOURS), amount: montant, method: 'virement',
          ...(devise.code !== 'TND' && h.suivant() < 0.5 ? { exchangeRate: h.parmi([3.3, 3.41, 3.3517, 3.123456]) } : {}),
        });
      }
      f.payments = payments;
      const data: Donnees = { documents, clients: [{ id: 'c1', name: 'Client' }] };
      const e = comparer(f, data, societe, '2026-09-28', centimes);
      if (typeof e === 'string') continue;
      faux.push(...e.map((x) => `${i} : ${x}`));
      vus.factures++;
      vus.reglements += payments.length;
      if (Number(f.withholdingRate) > 0 && payments.length) vus.retenues++;
      if (documents.length > 1) vus.avoirs++;
      if (devise.code !== 'TND') vus.devises++;
      if (payments.some((p) => Number(p.amount) < 0)) vus.remboursements++;
      if (payments.some((p) => p.exchangeRate)) vus.coursDuJour++;
      if (core.effectiveStatus(f, data, societe, '2026-09-28') === 'payée') vus.soldees++;
    }
    expect(faux).toEqual([]);
    // Le tirage atteint chaque cas : sinon il ne prouverait rien.
    expect(vus.factures).toBeGreaterThan(4000);
    expect(vus.retenues).toBeGreaterThan(2500);
    expect(vus.avoirs).toBeGreaterThan(1000);
    expect(vus.devises).toBeGreaterThan(1000);
    expect(vus.remboursements).toBeGreaterThan(800);
    expect(vus.coursDuJour).toBeGreaterThan(600);
    expect(vus.soldees).toBeGreaterThan(2000);
    // L'écart tranché existe bien dans le tirage (sinon sa règle n'a rien vérifié).
    expect(centimes.length).toBeGreaterThan(0);
  });
});


