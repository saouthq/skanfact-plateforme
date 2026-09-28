// Ce qui sert aux bancs des achats contre la v10 : la conversion d'un achat v10 dans le nouveau
// format, et un tirage d'achats au hasard, toujours le même (la graine est donnée).

import type { Achat, Destination, NatureAchat } from '../../moteur/achats.ts';
import { DESTINATIONS } from '../../moteur/achats.ts';
import { deviseDe, entier, exiger, type hasard, type Societe } from './v10.ts';

export type LigneAchatV10 = { qty?: number | string; unitPrice?: number | string; vatRate?: number | string; destination?: string | undefined; deductible?: boolean };
export type AchatV10 = {
  id?: string; kind?: string; currency?: string; exchangeRate?: number | string; lines?: LigneAchatV10[];
  fees?: number | string; withholdingRate?: number | string; tvaRecuperable?: boolean;
};
export type ParDest = Record<string, number>;
export type TotauxV10 = {
  totalHT: number; totalVAT: number; deductibleVAT: number; fees: number; totalTTC: number; withholding: number; netToPay: number;
  vatByRate: Record<string, { base: number; vat: number; deductible: number }>; byDestination: ParDest; nonDeductibleParDestination: ParDest;
  base: {
    totalHT: number; totalVAT: number; deductibleVAT: number; fees: number; totalTTC: number; withholding: number; netToPay: number;
    vatByRate: Record<string, { base: number; vat: number; deductible: number }>; byDestination: ParDest; nonDeductibleParDestination: ParDest;
    cout: ParDest; avance: number;
  };
};
export const coreAchats = exiger('../../banc/v10/core.js') as {
  purchaseTotals: (p: AchatV10, c: Societe) => TotauxV10;
  tvaRecuperable: (p: AchatV10, c: Societe) => boolean;
};

// L'achat v10 dans le nouveau format, ou la raison pour laquelle il ne s'y écrit pas exactement.
export function convertirAchat(p: AchatV10, societe: Societe): Achat | string {
  const devise = deviseDe(p.currency, societe);
  const enDevise = (p.currency || societe.currency) !== societe.currency;
  const taux = Number(p.exchangeRate);
  const lignes = [];
  for (const l of p.lines ?? []) {
    const quantite = entier(l.qty, 3), prixUnitaire = entier(l.unitPrice, 6), tauxTva = entier(l.vatRate, 4);
    if (quantite === null || prixUnitaire === null || tauxTva === null) return `ligne non représentable : ${JSON.stringify(l)}`;
    const destination = (DESTINATIONS as string[]).includes(l.destination ?? '') ? l.destination as Destination : 'charge';
    lignes.push({ quantite, prixUnitaire, tauxTva, destination, ...(l.deductible === false ? { nonDeductible: true } : {}) });
  }
  const frais = entier(p.fees, devise.decimales), tauxRetenue = entier(p.withholdingRate, 4);
  const cours = enDevise ? (taux > 0 ? entier(taux, 6) : 1_000_000n) : undefined;
  if (frais === null || tauxRetenue === null || cours === null) return 'frais, taux ou cours non représentable';
  const nature = (['facture', 'depense', 'avoir', 'acompte'].includes(p.kind ?? '') ? p.kind : 'facture') as NatureAchat;
  return { nature, devise, cours, lignes, frais, tauxRetenue, tvaRecuperable: coreAchats.tvaRecuperable(p, societe) };
}

export function achatAuHasard(h: ReturnType<typeof hasard>): AchatV10 {
  const currency = h.parmi(['DT', 'DT', 'DT', 'DT', 'DT', 'EUR', 'EUR', 'USD']);
  const lines = Array.from({ length: h.entre(1, 6) }, () => ({
    qty: h.parmi([1, 1, 2, 3, 10, 0.5, 1.25, 2.333, 12, h.decimal(50, 3)]),
    unitPrice: currency === 'DT' ? h.parmi([h.decimal(20000, 3), h.decimal(40, 3), h.decimal(3, 6), h.entre(1, 900)]) : h.parmi([h.decimal(5000, 2), h.decimal(15, 4), h.entre(1, 400)]),
    vatRate: h.parmi([0, 7, 13, 19, 19, 19]),
    destination: h.parmi(['charge', 'charge', 'stock', 'immobilisation', undefined]),
    ...(h.suivant() < 0.15 ? { deductible: false } : {}),
  }));
  const recuperable = h.parmi([true, true, false, undefined]);
  return {
    kind: h.parmi(['facture', 'facture', 'facture', 'depense', 'avoir', 'acompte']),
    currency, ...(currency === 'DT' ? {} : { exchangeRate: h.parmi([3.35, 3.38, 3.1234, 2.9876, 0]) }),
    lines,
    fees: currency === 'DT' ? h.parmi([0, 0, 1, 0.6, 7.5, 12.345]) : h.parmi([0, 0, 1.5, 12.35]),
    withholdingRate: h.parmi([0, 0, 0, 1, 1.5, 3, 5, 10, 15]),
    ...(recuperable === undefined ? {} : { tvaRecuperable: recuperable }),
  };
}

export type PaiementV10 = { id?: string; date?: string; amount: number | string; exchangeRate?: number | string };
export type AchatDonne = AchatV10 & { id: string; number?: string; date?: string; dueDate?: string; supplierId?: string; achatLie?: string; payments?: PaiementV10[] };
const JOURS = ['2026-03-10', '2026-03-10', '2026-03-25', '2026-04-02', '2026-04-15', '2026-05-01'];

// Une facture d'achat tirée au hasard, avec ses avoirs (parfois remboursés), ses acomptes et ses
// règlements : la facture d'abord, puis ses pièces rattachées.
export function factureDAchatAuHasard(h: ReturnType<typeof hasard>, i: number): AchatDonne[] {
  const f: AchatDonne = { ...achatAuHasard(h), kind: h.parmi(['facture', 'facture', 'depense']), id: `f${i}`, number: `F-${i}`, date: '2026-03-01', supplierId: 's1' };
  const dec = f.currency && f.currency !== 'DT' ? 2 : 3;
  const achats: AchatDonne[] = [f];
  for (let k = 0; k < h.parmi([0, 0, 1, 1, 2]); k++) {
    const x = achatAuHasard(h);
    const nature = h.parmi(['avoir', 'avoir', 'acompte']);
    const memeDevise = h.suivant() < 0.75;
    achats.push({
      ...x, kind: nature, id: `x${i}-${k}`, number: `X-${i}-${k}`, date: h.parmi(JOURS), supplierId: 's1', achatLie: f.id,
      withholdingRate: f.withholdingRate ?? 0, tvaRecuperable: f.tvaRecuperable ?? true,
      currency: memeDevise ? (f.currency ?? 'DT') : h.parmi(['DT', 'EUR']),
      exchangeRate: memeDevise ? (f.exchangeRate ?? '') : h.parmi([3.35, 3.2811]),
      lines: (x.lines ?? []).slice(0, 2).map((l) => ({ ...l, unitPrice: Number((Math.abs(Number(l.unitPrice) || 0) / h.entre(2, 20)).toFixed(2)) })),
      ...(nature === 'avoir' && h.suivant() < 0.3 ? { payments: [{ id: 'r0', date: h.parmi(JOURS), amount: 5 }] } : {}),
    });
  }
  f.payments = Array.from({ length: h.parmi([0, 1, 2]) }, (_, k) => ({ id: `p${k}`, date: h.parmi(JOURS), amount: Number((h.entre(1, 5000) + h.suivant()).toFixed(dec)) }));
  return achats;
}
