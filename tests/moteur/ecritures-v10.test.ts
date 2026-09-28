// Le banc des écritures (cadrage 08 § 1.2) : la v10 (`journalEntries`, la partie « ventes ») et le
// nouveau moteur écrivent l'écriture de chaque facture. Même compte, même colonne, même millime,
// dans le même ordre ; un écart se tranche et s'écrit, il ne se tolère jamais.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { ecritureDeVente, versLaBase, type ComptesVente } from '../../moteur/ecritures.ts';
import { calculerPiece } from '../../moteur/piece.ts';
import { convertir, demo, exiger, hasard, pieceAuHasard, v10, type DocV10, type Societe } from './v10.ts';

type LigneEcritureV10 = { docId: string; account: string; debit: number; credit: number; ecartAbsorbe?: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneEcritureV10[];
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const P = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesVente = {
  clients: P.clients ?? '', ventes: P.ventes ?? '', tvaCollectee: P.tvaCollectee ?? '', timbre: P.timbre ?? '',
  gainsChange: P.gainsChange ?? '', pertesChange: P.pertesChange ?? '',
};

// L'écriture des deux moteurs, ligne à ligne (« compte débit crédit », en millimes) ; `null` si
// elles sont les mêmes.
function difference(d: DocV10, ancienne: LigneEcritureV10[], societe: Societe): string | null {
  const p = convertir(d, societe);
  if (typeof p === 'string') return p;
  const nouvelle = ecritureDeVente(calculerPiece(p), p, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
  const v10Lignes = ancienne.map((l) => `${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
  const absorbe = ancienne.find((l) => l.ecartAbsorbe)?.ecartAbsorbe;
  if (JSON.stringify(nouvelle) === JSON.stringify(v10Lignes)) return null;
  return `v10 [${v10Lignes.join(' | ')}]${absorbe ? ` (écart absorbé ${absorbe})` : ''} ; nouveau [${nouvelle.join(' | ')}]`;
}

// Les écarts TRANCHÉS (vérifiés en fractions exactes) : chacun dit pourquoi le nouveau moteur a
// raison. Le tirage est le même que celui du banc des pièces (même graine) : un écart du calcul de la
// pièce se retrouve dans son écriture.
const ECARTS_TIRAGE = new Map<number, string>([
  [2811, 'suite de l\'écart tranché au banc des pièces (2811) : TVA 19 % de 15,7895 exactement, soit 15,790 (la v10 écrit 15,789) ; le client est débité du TTC qui en découle'],
]);

describe('le banc des écritures de vente, contre la v10', () => {
  it('chaque facture de l\'exemple de cinq ans s\'écrit au même millime, compte par compte', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as { company: Societe; documents: (DocV10 & { id: string; status?: string })[] };
    const ecritures = core.journalEntries(donnees, donnees.company, {}, { sections: ['ventes'] });
    const factures = donnees.documents.filter((d) => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée');
    expect(factures.length).toBeGreaterThan(250);
    const faux: string[] = [];
    for (const d of factures) {
      const e = difference(d, ecritures.filter((l) => l.docId === d.id), donnees.company);
      if (e) faux.push(`${d.id} : ${e}`);
    }
    expect(faux).toEqual([]);
  });

  it('10 000 factures tirées au hasard (dinars et devises) s\'écrivent au même millime, sauf les écarts tranchés', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20260928);
    const faux: string[] = [];
    const tranches = new Set<number>();
    let ecrites = 0;
    let sansCours = 0;
    for (let i = 0; i < 10_000; i++) {
      const d = { ...pieceAuHasard(h), type: 'facture', id: `f${i}`, number: `FAC-${i}`, date: '2026-06-15', status: 'envoyée', clientId: 'c1', payments: [] };
      // Une pièce en devise SANS cours n'existe pas sur la plateforme (refusée à la saisie : « une
      // pièce en devise porte son cours ») ; la v10 la traite comme une pièce en dinars.
      if (d.currency && d.currency !== 'DT' && !(Number(d.exchangeRate) > 0)) { sansCours++; continue; }
      const ecriture = core.journalEntries({ documents: [d], clients: [{ id: 'c1', name: 'Client' }] }, societe, {}, { sections: ['ventes'] });
      const e = difference(d, ecriture, societe);
      if (e === null) { ecrites++; continue; }
      if (ECARTS_TIRAGE.has(i)) { tranches.add(i); continue; }
      faux.push(`${i} : ${e}`);
    }
    expect(faux.slice(0, 5)).toEqual([]);
    expect([...ECARTS_TIRAGE.keys()].filter((i) => !tranches.has(i))).toEqual([]);
    expect(ecrites).toBeGreaterThan(9_000 - sansCours);
    expect(sansCours).toBeLessThan(1_000);
  });

  it('la conversion d\'un montant en devise arrondit au millime le plus proche, la moitié loin de zéro', () => {
    const EUR = { code: 'EUR', decimales: 2 };
    expect(versLaBase(29n, EUR, 3_350_000n, TND)).toBe(972n);            // 0,29 € × 3,35 = 0,9715 DT → 0,972
    expect(versLaBase(-29n, EUR, 3_350_000n, TND)).toBe(-972n);
    expect(versLaBase(100n, EUR, 3_412_345n, TND)).toBe(3412n);          // 1 € × 3,412345 = 3,412345 DT → 3,412
    expect(versLaBase(1250n, TND, undefined, TND)).toBe(1250n);
    expect(() => versLaBase(100n, EUR, undefined, TND)).toThrow(/sans cours/);
  });
});
