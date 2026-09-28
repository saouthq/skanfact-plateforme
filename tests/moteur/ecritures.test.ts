// Les règles de l'écriture d'une facture de vente (moteur/ecritures.ts), vérifiées sur des pièces
// tirées au hasard : ce qui doit tenir pour CHAQUE pièce, et pas seulement pour celles du banc.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { ecritureDeVente, versLaBase, type ComptesVente, type LigneEcriture } from '../../moteur/ecritures.ts';
import { calculerPiece } from '../../moteur/piece.ts';
import { convertir, hasard, pieceAuHasard, v10 } from './v10.ts';

const COMPTES: ComptesVente = { clients: '411', ventes: '706', tvaCollectee: '4367', timbre: '4368', gainsChange: '755', pertesChange: '655' };
const somme = (lignes: LigneEcriture[], nature: string, sens: 'debit' | 'credit') =>
  lignes.filter((l) => l.nature === nature).reduce((a, l) => a + l[sens], 0n);

describe('l\'écriture d\'une facture de vente', () => {
  it('pour chaque facture : équilibrée, jamais une ligne à zéro ni à deux colonnes ; en dinars, le chiffre d\'affaires est le net HT', () => {
    const h = hasard(424242);
    let enDinars = 0;
    let enDevise = 0;
    for (let i = 0; i < 3000; i++) {
      const d = { ...pieceAuHasard(h), type: 'facture' };
      if (d.currency && d.currency !== 'DT' && !(Number(d.exchangeRate) > 0)) continue;
      const p = convertir(d, { ...v10.DEFAULT_COMPANY });
      if (typeof p === 'string') continue;
      const t = calculerPiece(p);
      const { lignes } = ecritureDeVente(t, p, TND, COMPTES);
      const debit = lignes.reduce((a, l) => a + l.debit, 0n);
      const credit = lignes.reduce((a, l) => a + l.credit, 0n);
      expect(debit, `pièce ${i}`).toBe(credit);
      for (const l of lignes) {
        expect(l.debit === 0n || l.credit === 0n, `pièce ${i} : ${l.compte}`).toBe(true);
        expect(l.debit + l.credit > 0n, `pièce ${i} : ${l.compte}`).toBe(true);
      }
      const client = somme(lignes, 'client', 'debit') - somme(lignes, 'client', 'credit');
      expect(client, `pièce ${i}`).toBe(versLaBase(t.totalTTC, p.devise, p.cours, TND));
      expect(somme(lignes, 'timbre', 'credit') - somme(lignes, 'timbre', 'debit'), `pièce ${i}`).toBe(t.timbreBase);
      if (p.devise.code === 'TND') {
        enDinars++;
        expect(somme(lignes, 'ventes', 'credit') - somme(lignes, 'ventes', 'debit'), `pièce ${i}`).toBe(t.netHT);
        expect(somme(lignes, 'tva', 'credit') - somme(lignes, 'tva', 'debit'), `pièce ${i}`).toBe(t.totalTVA);
        expect(lignes.some((l) => l.nature === 'change'), `pièce ${i}`).toBe(false);
      } else enDevise++;
    }
    expect(enDinars).toBeGreaterThan(1500);
    expect(enDevise).toBeGreaterThan(300);
  });

  it('en devise, l\'écart de conversion va au change : un gain au crédit, une perte au débit, jamais dans le chiffre d\'affaires', () => {
    const EUR = { code: 'EUR', decimales: 2 };
    // 1,00 € à 19 %, et le timbre de 1 DT (la loi le fixe en dinars), converti en euros sur la pièce.
    const ecriture = (cours: bigint) => {
      const p = { type: 'facture' as const, devise: EUR, cours, tauxRemise: 0n, tauxRetenue: 0n, timbre: 1000n, lignes: [{ quantite: 1000n, prixUnitaire: 1_000_000n, tauxTva: 190_000n }] };
      return ecritureDeVente(calculerPiece(p), p, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
    };
    // Au cours de 3,3517 : le timbre vaut 0,298 36… € → 0,30 € ; TTC 1,49 € × 3,3517 = 4,994 033 → 4,994 DT.
    // Base 3,3517 → 3,352 ; TVA 0,19 € × 3,3517 = 0,636 823 → 0,637 ; timbre 1,000 : 4,989. Reste +0,005 : un gain.
    expect(ecriture(3_351_700n)).toEqual(['411 4994 0', '706 0 3352', '4367 0 637', '4368 0 1000', '755 0 5']);
    // Au cours de 3,40 : le timbre vaut 0,294 1… € → 0,29 € ; TTC 1,48 € × 3,40 = 5,032 DT.
    // Base 3,400 ; TVA 0,646 ; timbre 1,000 : 5,046. Reste −0,014 : une perte.
    expect(ecriture(3_400_000n)).toEqual(['411 5032 0', '706 0 3400', '4367 0 646', '4368 0 1000', '655 14 0']);
  });

  it('seule une facture s\'écrit pour l\'instant ; une pièce en devise sans cours ne se convertit pas', () => {
    const p = { type: 'avoir' as const, devise: TND, tauxRemise: 0n, tauxRetenue: 0n, timbre: 0n, lignes: [{ quantite: 1000n, prixUnitaire: 1_000_000n, tauxTva: 0n }] };
    expect(() => ecritureDeVente(calculerPiece(p), p, TND, COMPTES)).toThrow(/pas encore portée/);
    expect(() => versLaBase(100n, { code: 'EUR', decimales: 2 }, 0n, TND)).toThrow(/sans cours/);
  });
});
