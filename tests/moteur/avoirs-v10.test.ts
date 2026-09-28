// Le banc des avoirs (cadrage 08 § 1.2) : la v10 (`journalEntries`, partie « ventes ») et le nouveau
// moteur écrivent l'écriture de chaque avoir de vente. Même compte, même colonne, même millime,
// dans le même ordre : le client crédité, l'écart de change quand l'avoir n'est pas au cours de sa
// facture, la régularisation de la retenue déjà née, puis les ventes, la TVA et le timbre en retour.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { ecritureDeVente, type ComptesVente } from '../../moteur/ecritures.ts';
import { calculerPiece } from '../../moteur/piece.ts';
import { dansLaDeviseDe, retenueAuFil, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { convertir, demo, entier, exiger, hasard, pieceAuHasard, v10, type DocV10, type Societe } from './v10.ts';

type PaiementV10 = { id?: string; date?: string; amount: number | string; exchangeRate?: number | string };
type DocumentV10 = DocV10 & { id: string; number?: string; date?: string; status?: string; creditOf?: string; clientId?: string; payments?: PaiementV10[] };
type Donnees = { documents: DocumentV10[]; clients?: { id: string; name: string }[] };
type LigneV10 = { docId: string; account: string; debit: number; credit: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: Donnees, societe: Societe, periode: object, options: object) => LigneV10[];
  retenueSubie: (d: DocumentV10, data: Donnees, societe: Societe) => { ajustements: Record<string, number> };
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const P = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesVente & { retenueSubie: string } = {
  clients: P.clients ?? '', ventes: P.ventes ?? '', tvaCollectee: P.tvaCollectee ?? '', timbre: P.timbre ?? '',
  gainsChange: P.gainsChange ?? '', pertesChange: P.pertesChange ?? '', retenueSubie: P.rsSubie ?? '',
};

// L'écriture d'un avoir par les deux moteurs ; `null` si elles sont les mêmes. `regularise` recueille
// les avoirs qui portent une régularisation de retenue.
function difference(av: DocumentV10, data: Donnees, societe: Societe, regularise: string[] = [], centimes: string[] = []): string | null {
  const pa = convertir(av, societe);
  if (typeof pa === 'string') return pa;
  const f = av.creditOf ? data.documents.find((d) => d.id === av.creditOf) : undefined;
  let rattachement;
  if (f) {
    const pf = convertir(f, societe);
    if (typeof pf === 'string') return `facture : ${pf}`;
    // La régularisation que cet avoir porte sur la retenue déjà née de sa facture (moteur des règlements).
    let regularisation = 0n;
    if (f.status !== 'brouillon' && f.status !== 'annulée') {
      const tf = calculerPiece(pf);
      const liees: PieceLiee[] = [];
      for (const a of data.documents.filter((d) => d.type === 'avoir' && d.creditOf === f.id && d.status !== 'brouillon')) {
        const x = convertir(a, societe);
        if (typeof x === 'string') return `avoir lié : ${x}`;
        const tx = calculerPiece(x);
        liees.push({ cle: a.id, date: a.date ?? '', net: dansLaDeviseDe(tx.netAPayer, x, pf, TND), brut: dansLaDeviseDe(tx.netAPayer + tx.retenue, x, pf, TND) });
      }
      const reglements: Reglement[] = [];
      for (const [i, p] of (f.payments ?? []).entries()) {
        const montant = entier(Number(p.amount), pf.devise.decimales);
        if (montant === null) return 'règlement non représentable';
        reglements.push({ cle: p.id || `#${i}`, date: p.date ?? '', montant });
      }
      regularisation = retenueAuFil(tf.netAPayer, tf.netAPayer + tf.retenue, liees, reglements).ajustements.get(av.id) ?? 0n;
    }
    if (regularisation !== 0n) regularise.push(av.id);
    rattachement = { facture: pf, regularisationRetenue: regularisation };
  }
  const nouvelle = ecritureDeVente(calculerPiece(pa), pa, TND, COMPTES, rattachement).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
  const ancienne = core.journalEntries(data, societe, {}, { sections: ['ventes'] }).filter((l) => l.docId === av.id)
    .map((l) => `${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
  if (JSON.stringify(nouvelle) === JSON.stringify(ancienne)) return null;
  // L'écart tranché du banc des règlements : sur une facture en devise, la v10 tient la
  // régularisation au millième d'euro, le nouveau moteur au centime (au plus un centime d'écart).
  // Seules les deux lignes de la régularisation (retenue subie, puis client) peuvent alors différer.
  if (f && rattachement && rattachement.facture.devise.code !== 'TND') {
    const ancien = core.retenueSubie(f, data, societe).ajustements[av.id] ?? 0;
    const ecart = Math.abs(ancien * 10 ** rattachement.facture.devise.decimales - Number(rattachement.regularisationRetenue));
    const sansRegul = (l: string[]) => l.filter((x, i) => !x.startsWith(`${COMPTES.retenueSubie} `) && !(i > 0 && l[i - 1]?.startsWith(`${COMPTES.retenueSubie} `)));
    if (ecart > 0 && ecart < 1 + 1e-6 && JSON.stringify(sansRegul(nouvelle)) === JSON.stringify(sansRegul(ancienne))) { centimes.push(av.id); return null; }
  }
  return `v10 [${ancienne.join(' | ')}] ; nouveau [${nouvelle.join(' | ')}]`;
}

const JOURS = ['2026-03-10', '2026-03-10', '2026-03-25', '2026-04-02', '2026-04-15', '2026-05-01', '2026-05-20'];

describe('le banc des avoirs de vente, contre la v10', () => {
  it('chaque avoir de l\'exemple de cinq ans s\'écrit au même millime, compte par compte', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as Donnees & { company: Societe };
    const avoirs = donnees.documents.filter((d) => d.type === 'avoir' && d.status !== 'brouillon');
    expect(avoirs.length).toBeGreaterThan(5);
    const faux: string[] = [];
    for (const a of avoirs) {
      const e = difference(a, donnees, donnees.company);
      if (e) faux.push(`${a.id} : ${e}`);
    }
    expect(faux).toEqual([]);
  });

  it('5 000 avoirs tirés au hasard (libres ou rattachés, autre cours, autre devise, après un règlement) s\'écrivent au même millime', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20260930);
    const faux: string[] = [];
    const regularise: string[] = [];
    const centimes: string[] = [];
    const vus = { avoirs: 0, rattaches: 0, autreCours: 0, autreDevise: 0, timbre: 0 };
    for (let i = 0; i < 5000 && faux.length < 5; i++) {
      const base = pieceAuHasard(h);
      if (base.currency && base.currency !== 'DT' && !(Number(base.exchangeRate) > 0)) continue;
      const f: DocumentV10 = { ...base, type: 'facture', id: `f${i}`, number: `FAC-${i}`, date: '2026-03-01', status: 'envoyée', clientId: 'c1' };
      const pf = convertir(f, societe);
      if (typeof pf === 'string') continue;
      const net = Number(calculerPiece(pf).netAPayer) / 10 ** pf.devise.decimales;
      f.payments = Array.from({ length: h.parmi([0, 1, 1, 2]) }, (_, k) => ({
        id: `p${k}`, date: h.parmi(JOURS), amount: Number((net * h.parmi([0.3, 0.5, 1])).toFixed(pf.devise.decimales)),
      }));
      const a = pieceAuHasard(h);
      const rattache = h.suivant() < 0.8;
      const memeDevise = h.suivant() < 0.75;
      const devise = (memeDevise ? f.currency : h.parmi(['DT', 'EUR', 'USD'])) ?? 'DT';
      const avoir: DocumentV10 = {
        ...a, type: 'avoir', id: `a${i}`, number: `AVO-${i}`, date: h.parmi(JOURS), status: 'émis', clientId: 'c1',
        withholdingRate: (rattache ? f.withholdingRate : a.withholdingRate) ?? 0,
        currency: devise, exchangeRate: devise === 'DT' ? '' : h.parmi([f.exchangeRate ?? 3.35, 3.35, 3.2811, 3.4]),
        lines: (a.lines ?? []).slice(0, 3).map((l) => ({ ...l, unitPrice: Number((Math.abs(Number(l.unitPrice) || 0) / h.entre(2, 30)).toFixed(3)) })),
        ...(rattache ? { creditOf: f.id } : {}),
      };
      const data: Donnees = { documents: [f, avoir], clients: [{ id: 'c1', name: 'Client' }] };
      const e = difference(avoir, data, societe, regularise, centimes);
      if (e === null) {
        vus.avoirs++;
        if (rattache) vus.rattaches++;
        if (rattache && memeDevise && avoir.currency !== 'DT' && avoir.exchangeRate !== f.exchangeRate) vus.autreCours++;
        if (rattache && (avoir.currency || 'DT') !== (f.currency || 'DT')) vus.autreDevise++;
        if (avoir.applyStamp) vus.timbre++;
        continue;
      }
      if (/non représentable/.test(e)) continue;
      faux.push(`${i} : ${e}`);
    }
    expect(faux).toEqual([]);
    expect(vus.avoirs).toBeGreaterThan(4500);
    expect(vus.rattaches).toBeGreaterThan(3500);
    expect(vus.autreCours).toBeGreaterThan(400);
    expect(vus.autreDevise).toBeGreaterThan(500);
    expect(vus.timbre).toBeGreaterThan(1000);
    expect(regularise.length).toBeGreaterThan(500);
    // L'écart tranché existe bien dans le tirage (sinon sa règle n'a rien vérifié).
    expect(centimes.length).toBeGreaterThan(0);
  });
});
