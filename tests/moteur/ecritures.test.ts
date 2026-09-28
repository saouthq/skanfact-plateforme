// Les règles de l'écriture d'une facture de vente (moteur/ecritures.ts), vérifiées sur des pièces
// tirées au hasard : ce qui doit tenir pour CHAQUE pièce, et pas seulement pour celles du banc.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { ecritureDeVente, versLaBase, type ComptesVente, type LigneEcriture } from '../../moteur/ecritures.ts';
import { calculerPiece } from '../../moteur/piece.ts';
import { convertir, hasard, pieceAuHasard, v10 } from './v10.ts';

const COMPTES: ComptesVente = { clients: '411', ventes: '706', tvaCollectee: '4367', timbre: '4368', gainsChange: '755', pertesChange: '655', retenueSubie: '4358' };
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

  it('seules une facture et un avoir s\'écrivent au journal des ventes ; une pièce en devise sans cours ne se convertit pas', () => {
    const p = { type: 'proforma' as const, devise: TND, tauxRemise: 0n, tauxRetenue: 0n, timbre: 0n, lignes: [{ quantite: 1000n, prixUnitaire: 1_000_000n, tauxTva: 0n }] };
    expect(() => ecritureDeVente(calculerPiece(p), p, TND, COMPTES)).toThrow(/ne s'écrit pas au journal des ventes/);
    expect(() => versLaBase(100n, { code: 'EUR', decimales: 2 }, 0n, TND)).toThrow(/sans cours/);
  });
});

describe('l\'écriture d\'un avoir de vente', () => {
  const EUR = { code: 'EUR', decimales: 2 };
  const avoir = (devise: typeof TND, cours: bigint | undefined, prix: bigint, tva: bigint) =>
    ({ type: 'avoir' as const, devise, ...(cours ? { cours } : {}), tauxRemise: 0n, tauxRetenue: 0n, timbre: 1000n, lignes: [{ quantite: 1000n, prixUnitaire: prix, tauxTva: tva }] });
  const ecrire = (p: ReturnType<typeof avoir>, r?: Parameters<typeof ecritureDeVente>[4]) =>
    ecritureDeVente(calculerPiece(p), p, TND, COMPTES, r).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);

  it('un avoir libre s\'écrit à l\'envers : le client au crédit, les ventes et la TVA au débit', () => {
    expect(ecrire(avoir(TND, undefined, 100_000_000n, 190_000n))).toEqual(['411 0 119000', '706 100000 0', '4367 19000 0']);
  });

  it('rattaché à une facture d\'un autre cours, il crédite le client au cours de la facture ; l\'écart est du change', () => {
    // 100 € HT à 19 % à 3,40 ; la facture était à 3,35. Au cours de l'avoir : 404,600 DT ; au cours
    // de la facture, le client doit 119 € × 3,35 = 398,650 DT de moins : un gain de 5,950.
    const facture = { devise: EUR, cours: 3_350_000n };
    expect(ecrire(avoir(EUR, 3_400_000n, 100_000_000n, 190_000n), { facture, regularisationRetenue: 0n }))
      .toEqual(['411 0 398650', '755 0 5950', '706 340000 0', '4367 64600 0']);
    // Au même cours que sa facture : pas de change.
    expect(ecrire(avoir(EUR, 3_350_000n, 100_000_000n, 190_000n), { facture, regularisationRetenue: 0n }))
      .toEqual(['411 0 398650', '706 335000 0', '4367 63650 0']);
  });

  it('posé après un règlement, il régularise la retenue que le client a déjà gardée', () => {
    const facture = { devise: TND };
    expect(ecrire(avoir(TND, undefined, 200_000_000n, 0n), { facture, regularisationRetenue: 1_250n }))
      .toEqual(['411 0 200000', '4358 1250 0', '411 0 1250', '706 200000 0']);
    expect(() => ecritureDeVente(calculerPiece(avoir(TND, undefined, 1_000_000n, 0n)), avoir(TND, undefined, 1_000_000n, 0n), TND,
      { clients: '411', ventes: '706', tvaCollectee: '4367', timbre: '4368', gainsChange: '755', pertesChange: '655' }, { facture, regularisationRetenue: 5n })).toThrow(/retenue subie/);
  });

  // Le change fait exception : un écart se range selon son SENS (un gain au crédit du 755, une perte
  // au débit du 655, comme la v10), jamais en contre-passant le compte de la facture : la perte de
  // conversion d'une facture devient un gain sur l'avoir identique, du même montant.
  it('pour chaque pièce tirée au hasard : l\'avoir libre est le miroir exact de la facture identique, le change rangé selon son sens', () => {
    const h = hasard(99);
    let vues = 0, change = 0;
    for (let i = 0; i < 3000; i++) {
      const d = { ...pieceAuHasard(h), type: 'facture', applyStamp: true };
      if (d.currency && d.currency !== 'DT' && !(Number(d.exchangeRate) > 0)) continue;
      const p = convertir(d, { ...v10.DEFAULT_COMPANY });
      if (typeof p === 'string') continue;
      const pa = { ...p, type: 'avoir' as const };
      const f = ecritureDeVente(calculerPiece(p), p, TND, COMPTES).lignes;
      const a = ecritureDeVente(calculerPiece(pa), pa, TND, COMPTES).lignes;
      const horsChange = (l: typeof f) => l.filter((x) => x.nature !== 'change');
      expect(horsChange(a).map((l) => `${l.compte} ${l.credit} ${l.debit}`), `pièce ${i}`).toEqual(horsChange(f).map((l) => `${l.compte} ${l.debit} ${l.credit}`));
      const resultat = (l: typeof f) => l.filter((x) => x.nature === 'change').reduce((s, x) => s + x.credit - x.debit, 0n);
      expect(resultat(a), `pièce ${i}`).toBe(-resultat(f));
      for (const x of [...a, ...f].filter((l) => l.nature === 'change')) expect(x.compte === '755' ? x.credit > 0n : x.debit > 0n, `pièce ${i}`).toBe(true);
      if (resultat(f) !== 0n) change++;
      vues++;
    }
    expect(vues).toBeGreaterThan(2000);
    expect(change).toBeGreaterThan(100);
  });
});
