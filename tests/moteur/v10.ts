// Ce qui sert aux bancs contre la v10 (le calcul des pièces, les écritures) : la v10 figée et son
// exemple de cinq ans, la conversion d'une pièce v10 dans le nouveau format, et un tirage de pièces
// au hasard, toujours le même (la graine est fixe).

import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { TND, type Devise } from '../../moteur/argent.ts';
import type { Piece, TypePiece } from '../../moteur/piece.ts';

export type LigneV10 = { qty?: number | string; unitPrice?: number | string; vatRate?: number | string; noDiscount?: boolean };
export type DocV10 = {
  id?: string; type: string; currency?: string; exchangeRate?: number | string; lines?: LigneV10[];
  discountRate?: number | string; withholdingRate?: number | string; applyStamp?: boolean; stampFee?: number | string;
};
export type ResultatV10 = {
  lines: { ht: number; vat: number; ttc: number }[]; totalHT: number; discount: number; netHT: number;
  vatByRate: Record<string, { base: number; vat: number }>; totalVAT: number; stamp: number; stampBase: number;
  totalTTC: number; withholding: number; netToPay: number;
};
export type Societe = { currency: string; stampFee: number };

export const exiger = createRequire(import.meta.url);
export const v10 = exiger('../../banc/v10/core.js') as { computeTotals: (d: DocV10, c: Societe) => ResultatV10; DEFAULT_COMPANY: Societe };
export const demo = exiger('../../banc/v10/demo.js') as { buildDemoData: (c: Societe, jour: string) => { company: Societe; documents: DocV10[] } };

// Un fichier de l'écran de la PLATEFORME (web/public/v10 : la v10 et ses adaptations), dans Node. Le
// paquet de la plateforme est en modules ES : `require` ne lui donne pas l'objet `module` qu'il
// attend pour se rendre (il se poserait sur l'objet global) ; on le lui donne.
export function ecranDeLaPlateforme(fichier: string): unknown {
  const module = { exports: {} as unknown };
  const source = fs.readFileSync(new URL(`../../web/public/v10/${fichier}`, import.meta.url), 'utf8');
  (vm.runInThisContext(`(function (module, exports) {${source}\n})`, { filename: fichier }) as (m: unknown, e: unknown) => void)(module, module.exports);
  return module.exports;
}

// Un nombre de la v10 en entier à `dec` décimales ; `null` s'il en a davantage (une donnée que le
// nouveau format ne sait pas tenir exactement : elle se signale, elle ne s'arrondit pas en silence).
// On compte les décimales de son écriture la plus courte (celle que JavaScript affiche) : une
// tolérance relative laissait passer 0,3 centime sur 7 700 € (7 700,677 lu comme 7 700,68), et
// masquait l'écart même que le banc cherche.
export function entier(x: number | string | undefined, dec: number): bigint | null {
  const v = Number(x) || 0;
  const m = /^-?\d+(?:\.(\d+))?$/.exec(String(v));
  if (m) return (m[1]?.length ?? 0) > dec ? null : BigInt(Math.round(v * 10 ** dec));
  // Écriture scientifique (1e-7, 1e21) : exacte seulement si elle tombe sur l'unité.
  const e = v * 10 ** dec, r = Math.round(e);
  return Math.abs(e - r) > 1e-9 ? null : BigInt(r);
}
export const deviseDe = (code: string | undefined, societe: Societe): Devise => {
  const c = code || societe.currency || 'DT';
  return c === 'DT' || c === 'TND' ? TND : { code: c, decimales: 2 };
};

// La pièce v10 dans le nouveau format, ou la raison pour laquelle elle ne s'y écrit pas exactement.
export function convertir(d: DocV10, societe: Societe): Piece | string {
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

// Un tirage reproductible (mulberry32).
export function hasard(graine: number) {
  let s = graine >>> 0;
  const suivant = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const entre = (a: number, b: number) => a + Math.floor(suivant() * (b - a + 1));
  const parmi = <T>(l: T[]): T => l[Math.floor(suivant() * l.length)] as T;
  // Un décimal de `dec` décimales au plus, écrit comme un humain le saisirait.
  const decimal = (max: number, dec: number) => Number((suivant() * max).toFixed(entre(0, dec)));
  return { suivant, entre, parmi, decimal };
}

export function pieceAuHasard(h: ReturnType<typeof hasard>): DocV10 {
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

