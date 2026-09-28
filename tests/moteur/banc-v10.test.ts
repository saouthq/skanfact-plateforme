// Le banc de comparaison (cadrage 08 § 1.2, point 2) : l'ancien moteur (v10, figé dans banc/v10) et
// le nouveau calculent les MÊMES pièces ; ils doivent tomber sur le même millime (ou centime), champ
// par champ. Un écart est soit un défaut du portage, soit un défaut de l'ancien moteur que les
// entiers révèlent : dans les deux cas il s'écrit ci-dessous et se tranche. Il ne se tolère jamais.
//
// Les pièces : celles de l'exemple de cinq ans de la v10, et des pièces tirées au hasard (toujours
// les mêmes : le tirage part d'une graine fixe).

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { TND, type Devise } from '../../moteur/argent.ts';
import { calculerPiece, type Piece, type TypePiece } from '../../moteur/piece.ts';

type LigneV10 = { qty?: number | string; unitPrice?: number | string; vatRate?: number | string; noDiscount?: boolean };
type DocV10 = {
  id?: string; type: string; currency?: string; exchangeRate?: number | string; lines?: LigneV10[];
  discountRate?: number | string; withholdingRate?: number | string; applyStamp?: boolean; stampFee?: number | string;
};
type ResultatV10 = {
  lines: { ht: number; vat: number; ttc: number }[]; totalHT: number; discount: number; netHT: number;
  vatByRate: Record<string, { base: number; vat: number }>; totalVAT: number; stamp: number; stampBase: number;
  totalTTC: number; withholding: number; netToPay: number;
};
type Societe = { currency: string; stampFee: number };

const exiger = createRequire(import.meta.url);
const v10 = exiger('../../banc/v10/core.js') as { computeTotals: (d: DocV10, c: Societe) => ResultatV10; DEFAULT_COMPANY: Societe };
const demo = exiger('../../banc/v10/demo.js') as { buildDemoData: (c: Societe, jour: string) => { company: Societe; documents: DocV10[] } };

// Un nombre de la v10 en entier à `dec` décimales ; `null` s'il en a davantage (une donnée que le
// nouveau format ne sait pas tenir exactement : elle se signale, elle ne s'arrondit pas en silence).
function entier(x: number | string | undefined, dec: number): bigint | null {
  const v = Number(x) || 0;
  const e = v * 10 ** dec;
  const r = Math.round(e);
  return Math.abs(e - r) > 1e-6 * Math.max(1, Math.abs(e)) ? null : BigInt(r);
}
const deviseDe = (code: string | undefined, societe: Societe): Devise => {
  const c = code || societe.currency || 'DT';
  return c === 'DT' || c === 'TND' ? TND : { code: c, decimales: 2 };
};

// La pièce v10 dans le nouveau format, ou la raison pour laquelle elle ne s'y écrit pas exactement.
function convertir(d: DocV10, societe: Societe): Piece | string {
  const devise = deviseDe(d.currency, societe);
  const enDevise = (d.currency || societe.currency) !== societe.currency;
  const taux = Number(d.exchangeRate);
  const lignes = [];
  for (const l of d.lines ?? []) {
    const quantite = entier(l.qty, 3), prixUnitaire = entier(l.unitPrice, 6), tauxTva = entier(l.vatRate, 4);
    if (quantite === null || prixUnitaire === null || tauxTva === null) return `ligne non représentable : ${JSON.stringify(l)}`;
    lignes.push({ quantite, prixUnitaire, tauxTva, ...(l.noDiscount ? { sansRemise: true } : {}) });
  }
  const timbreDu = d.stampFee === undefined || d.stampFee === null || d.stampFee === '' ? societe.stampFee : Number(d.stampFee) || 0;
  const timbre = entier(timbreDu, 3), tauxRemise = entier(d.discountRate, 4), tauxRetenue = entier(d.withholdingRate, 4);
  // La v10 prend un cours absent pour 1 (et le signale ailleurs) : le banc fait de même.
  const cours = enDevise ? (taux > 0 ? entier(taux, 6) : 1_000_000n) : undefined;
  if (timbre === null || tauxRemise === null || tauxRetenue === null || cours === null) return 'taux ou timbre non représentable';
  return {
    type: d.type as TypePiece, devise, cours, lignes, tauxRemise, tauxRetenue, timbre,
    ...(d.applyStamp === undefined ? {} : { appliquerTimbre: d.applyStamp }),
  };
}

// Compare les deux calculs d'une pièce ; rend la liste des champs qui diffèrent.
function ecarts(d: DocV10, societe: Societe): string[] {
  const p = convertir(d, societe);
  if (typeof p === 'string') return [p];
  const a = v10.computeTotals(d, societe);
  const n = calculerPiece(p);
  const s = 10 ** p.devise.decimales;
  const en = (x: number, echelle = s) => BigInt(Math.round(x * echelle));
  const faux: string[] = [];
  const cmp = (champ: string, ancien: bigint, nouveau: bigint) => { if (ancien !== nouveau) faux.push(`${champ} : v10 ${ancien}, nouveau ${nouveau}`); };
  a.lines.forEach((l, i) => {
    const m = n.lignes[i];
    if (!m) { faux.push(`ligne ${i} absente`); return; }
    cmp(`ligne ${i} HT`, en(l.ht), m.ht); cmp(`ligne ${i} TVA`, en(l.vat), m.tva); cmp(`ligne ${i} TTC`, en(l.ttc), m.ttc);
  });
  cmp('totalHT', en(a.totalHT), n.totalHT);
  cmp('remise', en(a.discount), n.remise);
  cmp('netHT', en(a.netHT), n.netHT);
  for (const [t, v] of Object.entries(a.vatByRate)) {
    const m = n.tvaParTaux.get(entier(t, 4) ?? -1n);
    cmp(`base ${t} %`, en(v.base), m?.base ?? -1n); cmp(`TVA ${t} %`, en(v.vat), m?.tva ?? -1n);
  }
  if (Object.keys(a.vatByRate).length !== n.tvaParTaux.size) faux.push('nombre de taux');
  cmp('totalTVA', en(a.totalVAT), n.totalTVA);
  cmp('timbre', en(a.stamp), n.timbre);
  cmp('timbre déclaré', en(a.stampBase, 1000), n.timbreBase);
  cmp('totalTTC', en(a.totalTTC), n.totalTTC);
  cmp('retenue', en(a.withholding), n.retenue);
  cmp('net à payer', en(a.netToPay), n.netAPayer);
  return faux;
}

// Un tirage reproductible (mulberry32).
function hasard(graine: number) {
  let s = graine >>> 0;
  const suivant = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const entre = (a: number, b: number) => a + Math.floor(suivant() * (b - a + 1));
  const parmi = <T>(l: T[]): T => l[Math.floor(suivant() * l.length)] as T;
  // Un décimal de `dec` décimales au plus, écrit comme un humain le saisirait.
  const decimal = (max: number, dec: number) => Number((suivant() * max).toFixed(entre(0, dec)));
  return { suivant, entre, parmi, decimal };
}

function pieceAuHasard(h: ReturnType<typeof hasard>): DocV10 {
  const currency = h.parmi(['DT', 'DT', 'DT', 'DT', 'DT', 'DT', 'DT', 'EUR', 'EUR', 'USD']);
  const lignes: LigneV10[] = Array.from({ length: h.entre(1, 8) }, () => {
    const acompte = h.suivant() < 0.07;
    const unitPrice = currency === 'DT'
      ? h.parmi([h.decimal(100000, 3), h.decimal(50, 3), h.decimal(5, 6), h.entre(1, 5000), h.parmi([2.525, 0.0045, 0.001, 1.123456, 19.99])])
      : h.parmi([h.decimal(10000, 2), h.decimal(20, 4), h.entre(1, 900)]);
    return {
      qty: h.parmi([1, 1, 2, 3, 10, 0.5, 1.25, 0.125, 2.333, 1000, 7.5, h.entre(1, 50), h.decimal(100, 3)]),
      unitPrice: acompte ? -unitPrice : unitPrice,
      vatRate: h.parmi([0, 7, 13, 19, 19, 19]),
      ...(acompte ? { noDiscount: true } : {}),
    };
  });
  const applyStamp = h.parmi([undefined, undefined, true, false]);
  return {
    type: h.parmi(['facture', 'facture', 'facture', 'avoir', 'proforma', 'devis', 'devis', 'commande', 'livraison']),
    currency, ...(currency === 'DT' ? {} : { exchangeRate: h.parmi([3.35, 3.4, 3.1234, 2.9876, 3.3517, 0]) }),
    lines: lignes,
    discountRate: h.parmi([0, 0, 0, 5, 10, 12.5, 15, 3.333, 33.33]),
    withholdingRate: h.parmi([0, 0, 0, 0.5, 1, 1.5, 3, 5, 10, 15, 25]),
    ...(applyStamp === undefined ? {} : { applyStamp }),
    ...(h.suivant() < 0.2 ? { stampFee: h.parmi([0.6, 1, 1.5]) } : {}),
  };
}

// Les écarts TRANCHÉS : chacun dit pourquoi le nouveau moteur a raison et l'ancien tort (sinon
// c'est le portage qu'on corrige, et la ligne disparaît). Vérifiés à la main en fractions exactes le
// 28/09/2026 ; chaque situation est aussi tenue par un test de tests/moteur/piece.test.ts.
const ECARTS_EXEMPLE = new Map<string, string>();
const ECARTS_TIRAGE = new Map<number, string>([
  [2811, 'TVA 19 % : 401,727 − 385,9375 = 15,7895 exactement, soit 15,790 ; la v10 calcule 15,78949999… en virgule flottante et écrit 15,789'],
  [9418, 'base 0 % : la base remisée vaut exactement 95 176,827 49999998…, soit 95 176,827 ; la correction « 1 + 4 ε » de la v10 la pousse à 95 176,828'],
  [10799, 'TVA 19 % : −0,137 + 0,850 × 19 % = 0,0245 exactement, soit 0,025 ; la v10 calcule 0,02449999… et écrit 0,024'],
]);

describe('le banc v10 → plateforme, au millime', () => {
  const societe = { ...v10.DEFAULT_COMPANY, stampFee: 1, currency: 'DT' };

  it('les pièces de l\'exemple de cinq ans tombent sur le même millime, champ par champ', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28');
    const docs = donnees.documents;
    expect(docs.length).toBeGreaterThan(400);
    const faux = docs.map((d) => ({ id: d.id ?? '', e: ecarts(d, donnees.company) })).filter((x) => x.e.length);
    expect(faux.filter((x) => !ECARTS_EXEMPLE.has(x.id)).slice(0, 10)).toEqual([]);
    // Un écart tranché qui a disparu se retire de la liste : elle dit toujours la vérité.
    expect(faux.map((x) => x.id).sort()).toEqual([...ECARTS_EXEMPLE.keys()].sort());
  });

  it('20 000 pièces tirées au hasard (devises, remises, acomptes, retenues, timbres) tombent sur le même millime', () => {
    const h = hasard(20260928);
    const faux: { n: number; doc: DocV10; e: string[] }[] = [];
    for (let n = 0; n < 20_000; n++) {
      const doc = pieceAuHasard(h);
      const e = ecarts(doc, societe);
      if (e.length) faux.push({ n, doc, e });
    }
    expect(faux.filter((x) => !ECARTS_TIRAGE.has(x.n)).slice(0, 5)).toEqual([]);
    expect(faux.map((x) => x.n)).toEqual([...ECARTS_TIRAGE.keys()]);
    // Chaque écart tranché est d'UNE unité (un millime ou un centime), jamais davantage.
    for (const x of faux) for (const e of x.e) {
      const m = /v10 (-?\d+), nouveau (-?\d+)/.exec(e);
      expect(m && Math.abs(Number(m[1]) - Number(m[2]))).toBe(1);
    }
  });
});
