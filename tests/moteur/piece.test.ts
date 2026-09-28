// Le calcul d'une pièce, porté de la v10 (`computeTotals`). Chaque test garde la version où la
// règle est née (cadrage 08 § 1.2, point 4) : le nouveau moteur retombe sur les mêmes pièges au même
// endroit, et le test le dit. Les montants attendus sont écrits en unités de la devise (millimes,
// centimes) : 1 191 DT s'écrit 1_191_000n.

import { describe, expect, it } from 'vitest';
import { depuisTexte, diviserArrondi, TND, type Devise } from '../../moteur/argent.ts';
import { calculerPiece, type LignePiece, type Piece } from '../../moteur/piece.ts';

const EUR: Devise = { code: 'EUR', decimales: 2 };
const TIMBRE = 1_000n; // 1 DT, en millimes (une règle d'essai : la vraie se lit à la date de la pièce)
const ligne = (qte: string, prix: string, tva: string, sansRemise = false): LignePiece =>
  ({ quantite: depuisTexte(qte, 3), prixUnitaire: depuisTexte(prix, 6), tauxTva: depuisTexte(tva, 4), ...(sansRemise ? { sansRemise } : {}) });
const piece = (p: Partial<Piece> & { lignes: LignePiece[] }): Piece => ({ type: 'facture', devise: TND, timbre: TIMBRE, ...p });
const taux = (t: string) => depuisTexte(t, 4); // « 19 » (%) → 190 000

describe('l\'arrondi et les nombres', () => {
  it('au plus proche, la moitié s\'éloigne de zéro (la règle de round3)', () => {
    expect([diviserArrondi(5n, 2n), diviserArrondi(-5n, 2n), diviserArrondi(4n, 3n), diviserArrondi(-4n, 3n), diviserArrondi(7n, -2n)])
      .toEqual([3n, -3n, 1n, -1n, -4n]);
  });

  it('un nombre écrit se lit exactement, et n\'est jamais tronqué en silence', () => {
    expect(depuisTexte('2,525', 6)).toBe(2_525_000n);
    expect(depuisTexte('-0.5', 3)).toBe(-500n);
    expect(depuisTexte('19', 4)).toBe(190_000n);
    expect(() => depuisTexte('0,0000001', 6)).toThrow(/plus de 6 décimales/);
    expect(() => depuisTexte('1 000', 3)).toThrow(/illisible/);
  });

  it('9.1.1 : 100,35 × 19 % vaut 19,067 (la virgule flottante disait 19,0664999…)', () => {
    expect(calculerPiece(piece({ lignes: [ligne('1', '100.35', '19')] })).totalTVA).toBe(19_067n);
  });

  it('les grands montants restent exacts (un prix à six décimales × une quantité dépasse 2^53)', () => {
    const r = calculerPiece(piece({ type: 'devis', lignes: [ligne('100000', '999999.999999', '19')] }));
    expect(r.totalHT).toBe(99_999_999_999_900n); // 99 999 999 999,900 DT
  });
});

describe('là où les entiers corrigent la v10 (écarts tranchés du banc, 28/09/2026)', () => {
  it('un demi-millime EXACT s\'arrondit loin de zéro, même quand la virgule flottante le manquait (15,7895 → 15,790)', () => {
    // TVA 19 % cumulée : 401,727 puis une déduction d'acompte de −2 031,25 × 19 % = −385,9375.
    const r = calculerPiece(piece({ type: 'commande', tauxRemise: taux('15'), lignes: [
      ligne('0.125', '1209', '19'), ligne('1', '2166', '19'), ligne('1', '942', '13'), ligne('7.5', '-0.2', '19', true),
      ligne('73.24', '2.35', '19'), ligne('2', '15073.9', '13'), ligne('3', '56773', '7'), ligne('1.25', '-1625', '19', true)] }));
    expect(r.tvaParTaux.get(taux('19'))?.tva).toBe(15_790n);
  });

  it('une valeur JUSTE sous la moitié s\'arrondit en dessous (la correction « 1 + 4 ε » de la v10 la poussait au-dessus)', () => {
    const r = calculerPiece(piece({ type: 'devis', tauxRemise: taux('15'), lignes: [
      ligne('1.25', '89578.19', '0'), ligne('7.5', '0.001', '7'), ligne('0.5', '0.0045', '7'), ligne('3', '-4', '19', true)] }));
    expect(r.tvaParTaux.get(0n)?.base).toBe(95_176_827n);
  });

  it('0,0245 exactement devient 0,025', () => {
    const r = calculerPiece(piece({ tauxRemise: taux('15'), tauxRetenue: taux('0.5'), lignes: [
      ligne('0.5', '0.0045', '7'), ligne('1', '-0.718896', '19', true), ligne('1', '1', '19'), ligne('3', '3.211546', '7')] }));
    expect(r.tvaParTaux.get(taux('19'))?.tva).toBe(25n);
  });
});

describe('le calcul d\'une pièce (computeTotals)', () => {
  it('1.4.0 : facture avec TVA 19 % et 7 %, et timbre', () => {
    const r = calculerPiece(piece({ lignes: [ligne('2', '500', '19'), ligne('1', '100', '7')] }));
    expect(r.totalHT).toBe(1_100_000n);
    expect(r.tvaParTaux.get(taux('19'))?.tva).toBe(190_000n);
    expect(r.tvaParTaux.get(taux('7'))?.tva).toBe(7_000n);
    expect(r.totalTVA).toBe(197_000n);
    expect(r.timbre).toBe(1_000n);
    expect(r.totalTTC).toBe(1_298_000n);
  });

  it('1.4.0 : un devis n\'a pas de timbre ; la remise globale réduit la base de TVA', () => {
    const r = calculerPiece(piece({ type: 'devis', tauxRemise: taux('10'), lignes: [ligne('1', '1000', '19')] }));
    expect([r.remise, r.netHT, r.totalTVA, r.timbre, r.totalTTC]).toEqual([100_000n, 900_000n, 171_000n, 0n, 1_071_000n]);
  });

  it('1.4.0 : la retenue à la source porte sur le TTC hors timbre ; jamais sur un devis', () => {
    const r = calculerPiece(piece({ tauxRetenue: taux('1.5'), lignes: [ligne('1', '1000', '19')] }));
    expect([r.totalTTC, r.retenue, r.netAPayer]).toEqual([1_191_000n, 17_850n, 1_173_150n]);
    expect(calculerPiece(piece({ type: 'devis', tauxRetenue: taux('5'), lignes: [ligne('1', '1000', '19')] })).retenue).toBe(0n);
  });

  it('1.4.0 : la remise globale ne porte pas sur la déduction d\'un acompte déjà facturé', () => {
    const r = calculerPiece(piece({ appliquerTimbre: false, tauxRemise: taux('10'),
      lignes: [ligne('1', '1000', '19'), ligne('1', '-300', '19', true)] }));
    expect([r.remise, r.netHT, r.tvaParTaux.get(taux('19'))?.base, r.totalTVA]).toEqual([100_000n, 600_000n, 600_000n, 114_000n]);
  });

  it('la remise se répartit au prorata sur plusieurs taux, et chaque taux garde sa part', () => {
    const r = calculerPiece(piece({ type: 'devis', tauxRemise: taux('12.5'), lignes: [ligne('3', '333.333', '19'), ligne('7', '12.345', '7')] }));
    // 999,999 + 86,415 = 1 086,414 ; remise 135,802 ; bases 874,999 et 75,613 (au prorata, arrondies)
    expect(r.totalHT).toBe(1_086_414n);
    expect(r.remise).toBe(135_802n);
    expect(r.tvaParTaux.get(taux('19'))).toEqual({ base: 874_999n, tva: 166_250n });
    expect(r.tvaParTaux.get(taux('7'))).toEqual({ base: 75_613n, tva: 5_293n });
  });

  it('le timbre : d\'office sur une facture (sauf si on le retire), seulement s\'il est demandé sur un avoir ou une proforma', () => {
    const l = [ligne('1', '100', '19')];
    expect(calculerPiece(piece({ lignes: l })).timbre).toBe(1_000n);
    expect(calculerPiece(piece({ lignes: l, appliquerTimbre: false })).timbre).toBe(0n);
    expect(calculerPiece(piece({ type: 'avoir', lignes: l })).timbre).toBe(0n);
    expect(calculerPiece(piece({ type: 'avoir', lignes: l, appliquerTimbre: true })).timbre).toBe(1_000n);
    expect(calculerPiece(piece({ type: 'proforma', lignes: l, appliquerTimbre: true })).timbre).toBe(1_000n);
    expect(calculerPiece(piece({ type: 'commande', lignes: l, appliquerTimbre: true })).timbre).toBe(0n);
  });

  it('7.1.1 : le timbre est celui qu\'on donne à la pièce (gelé à l\'émission), pas un réglage relu', () => {
    expect(calculerPiece(piece({ timbre: 600n, lignes: [ligne('1', '100', '19')] })).totalTTC).toBe(119_600n);
  });

  it('10.14.1 : une pièce en euros se calcule au centime ; le timbre vaut un dinar converti, et se déclare 1,000 DT', () => {
    const r = calculerPiece(piece({ devise: EUR, cours: depuisTexte('3.4', 6), lignes: [ligne('1', '1000', '19')] }));
    expect(r.timbre).toBe(29n);          // 0,29 €
    expect(r.timbreBase).toBe(1_000n);   // 1,000 DT
    expect(r.totalTTC).toBe(119_029n);   // 1 190,29 €
    // Au centime, jamais au millime : 3 × 312,671 € = 938,01 €, pas 938,013.
    const c = calculerPiece(piece({ type: 'devis', devise: EUR, cours: depuisTexte('3.35', 6), lignes: [ligne('3', '312.671', '0')] }));
    expect(c.totalHT).toBe(93_801n);
  });

  it('un avoir se calcule comme une facture, avec la même retenue', () => {
    const r = calculerPiece(piece({ type: 'avoir', tauxRetenue: taux('1.5'), lignes: [ligne('1', '1000', '19')] }));
    expect([r.totalTTC, r.retenue]).toEqual([1_190_000n, 17_850n]);
  });
});
