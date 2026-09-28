// Deux chemins, un chiffre (cadrage 08 § 1.2 ; la leçon de `verite-comptable.js`) : la v10 calcule
// la déclaration de TVA de chaque mois en additionnant les PIÈCES (`vatChain`) ; le nouveau moteur la
// lit dans les ÉCRITURES qu'il a produites lui-même. Sur les cinq ans de l'exemple, mois par mois,
// les deux disent le même millime : la TVA collectée et déductible, le crédit reporté, ce qui se
// paie, les timbres, les retenues subies et opérées.

import { describe, expect, it } from 'vitest';
import { chaineTva } from '../../moteur/declarations.ts';
import { COMPTES, journalDuNouveauMoteur, type EntrepriseV10 } from './journal-v10.ts';
import { demo, entier, exiger, v10, type Societe } from './v10.ts';

type MoisV10 = { month: string; collected: number; deductible: number; carryIn: number; toPay: number; carryOut: number; stamps: number; withheldBySale: number; withheldOnBuys: number };
const core = exiger('../../banc/v10/core.js') as { vatChain: (data: unknown, c: Societe, annee: string, jusqua: number) => MoisV10[] };

describe('les déclarations de TVA lues dans les écritures, contre la v10', () => {
  it('chaque mois des cinq ans de l\'exemple : même TVA, même crédit reporté, mêmes timbres, mêmes retenues', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as EntrepriseV10 & { company: Societe; vatCarryIn?: Record<string, number> };
    const journal = journalDuNouveauMoteur(donnees, donnees.company);
    const annees = [...new Set(journal.map((e) => Number(e.date.slice(0, 4))))].sort();
    expect(annees.length).toBeGreaterThanOrEqual(5);
    const faux: string[] = [];
    let report = entier(donnees.vatCarryIn?.[String(annees[0])] ?? 0, 3) ?? 0n;
    let mois = 0, avecTva = 0, avecRetenues = 0;
    for (const a of annees) {
      const nouvelle = chaineTva(journal, a, COMPTES.declaration, report);
      const ancienne = core.vatChain(donnees, donnees.company, String(a), 12);
      nouvelle.forEach((n, i) => {
        const v = ancienne[i] as MoisV10;
        const paires: [string, number, bigint][] = [
          ['collectée', v.collected, n.collectee], ['déductible', v.deductible, n.deductible], ['report reçu', v.carryIn, n.reportRecu],
          ['à payer', v.toPay, n.aPayer], ['crédit reporté', v.carryOut, n.creditReporte], ['timbres', v.stamps, n.timbres],
          ['retenues subies', v.withheldBySale, n.retenuesSubies], ['retenues opérées', v.withheldOnBuys, n.retenuesOperees],
        ];
        for (const [nom, x, y] of paires) if (entier(x, 3) !== y) faux.push(`${n.mois} ${nom} : v10 ${x}, écritures ${y}`);
        mois++;
        if (n.collectee || n.deductible) avecTva++;
        if (n.retenuesSubies || n.retenuesOperees) avecRetenues++;
      });
      report = nouvelle[11]?.creditReporte ?? 0n;
    }
    expect(faux).toEqual([]);
    expect(mois).toBeGreaterThanOrEqual(60);
    expect(avecTva).toBeGreaterThan(50);
    expect(avecRetenues).toBeGreaterThan(20);
  });
});
