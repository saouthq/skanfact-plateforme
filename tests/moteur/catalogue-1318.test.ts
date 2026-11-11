// 1.318.0 (le catalogue joué par une droguerie de l'Ariana) : ce qu'une ligne vend décide du compte de sa vente. La peinture
// et les brosses, revendues telles qu'achetées, vont aux ventes de marchandises (707) ; la pose, une prestation, au 706 ; le
// mastic que la droguerie fabrique, aux produits finis (701), sa FODEC à son compte. Deux chemins, un chiffre : le moteur de
// l'entreprise (core.js) et celui du serveur (moteur/piece.ts, moteur/ecritures.ts) ventilent au même millime, dans le même
// ordre. Les données discriminent : une remise de 5 % répartie sur quatre lignes et deux taux (18,1525 arrondi à 18,153), une
// FODEC d'un millime près (22,942 × 1 % = 0,229), un ticket au prix d'étiquette dont la base se ventile au prorata du TTC.
// Les montants attendus sont calculés à la main, en fractions exactes.
import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { PLAN_PAR_DEFAUT } from '../../moteur/comptes.ts';
import { ecritureDeVente, type ComptesVente } from '../../moteur/ecritures.ts';
import { calculerPiece, type LignePiece, type Piece } from '../../moteur/piece.ts';
import { natureDeLaLigne } from '../../serveur/v10/dossier.ts';
import { ecranDeLaPlateforme } from './v10.ts';

type Fiche = Record<string, unknown>;
type LigneJournal = { docId: string; account: string; debit: number; credit: number };
const C = ecranDeLaPlateforme('core.js') as {
  computeTotals: (doc: Fiche, company: Fiche) => { vatByRate: Record<string, { base: number; vat: number; marchandises?: number; produits?: number }> };
  journalEntries: (data: Fiche, company: Fiche, periode: object, options: object) => LigneJournal[];
  natureDeLArticle: (item: Fiche | null) => string;
  natureProposee: (company: Fiche, auComptoir: boolean) => string;
  ligneDePanier: (item: Fiche, company: Fiche) => Fiche;
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const SOCIETE = { currency: 'DT', stampFee: 1, regimeTVA: 'reel', fodec: true };
const COMPTES: ComptesVente = {
  clients: '411', ventes: '706', tvaCollectee: '4367', timbre: '4368', fodec: '4369', gainsChange: '756', pertesChange: '656',
  ventesMarchandises: '707', ventesProduits: '701',
};
const ligne = (qte: string, pu: string, tva: number, extra: Partial<LignePiece> = {}): LignePiece => ({
  quantite: BigInt(Math.round(Number(qte) * 1000)), prixUnitaire: BigInt(Math.round(Number(pu) * 1_000_000)), tauxTva: BigInt(tva * 10_000), ...extra,
});
// La facture de l'hôtel : trois pots de peinture, deux heures et demie de pose, sept tubes de mastic maison, quatre brosses.
const facture = {
  id: 'f1', type: 'facture', number: 'FAC-2026-041', status: 'émise', date: '2026-11-07', dueDate: '2026-12-07', clientId: 'hotel', currency: 'DT',
  discountRate: 5, calcul: 2, fodecRate: 1, applyStamp: true, stampFee: 1,
  lines: [
    { label: 'Peinture murale blanche 10 L', qty: 3, unitPrice: 89, vatRate: 19, nature: 'marchandises' },
    { label: 'Pose (heure)', qty: 2.5, unitPrice: 25, vatRate: 19 },
    { label: 'Mastic de la maison', qty: 7, unitPrice: 3.45, vatRate: 19, nature: 'produits', fodec: true },
    { label: 'Brosse plate 50 mm', qty: 4, unitPrice: 2.35, vatRate: 7, nature: 'marchandises' },
  ],
};
const pieceServeur: Piece = {
  type: 'facture', devise: TND, tauxRemise: 50_000n, timbre: 1000n, calcul: 2, tauxFodec: 10_000n,
  lignes: [ligne('3', '89', 19, { nature: 'marchandises' }), ligne('2.5', '25', 19), ligne('7', '3.45', 19, { nature: 'produits', fodec: true }),
    ligne('4', '2.35', 7, { nature: 'marchandises' })],
};
const millimes = (x: number | undefined) => Math.round((x ?? 0) * 1000);

describe('le compte de chaque vente (1.318.0)', () => {
  it('la facture de la droguerie : 707 pour ce qu\'elle revend, 706 pour la pose, 701 pour son mastic, au même millime des deux côtés', () => {
    const t = calculerPiece(pieceServeur);
    expect(t.tvaParTaux.get(190_000n)).toEqual({ base: 336_196n, tva: 63_877n, fodec: 229n, marchandises: 253_650n, produits: 22_942n });
    expect(t.tvaParTaux.get(70_000n)).toEqual({ base: 8930n, tva: 625n, marchandises: 8930n });
    const serveur = ecritureDeVente(t, { type: 'facture', devise: TND }, TND, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
    expect(serveur).toEqual(['411 410628 0', '707 0 8930', '4367 0 625', '706 0 59375', '707 0 253650', '701 0 22942', '4367 0 63877', '4368 0 1000', '4369 0 229']);
    // L'entreprise, par son moteur : les mêmes parts, la même écriture.
    const v = C.computeTotals(facture, SOCIETE).vatByRate;
    expect([millimes(v['19']?.marchandises), millimes(v['19']?.produits), millimes(v['7']?.marchandises)]).toEqual([253_650, 22_942, 8930]);
    const data = { documents: [facture], clients: [{ id: 'hotel', name: 'Hôtel Les Jasmins' }], payments: [], purchases: [], catalog: [] };
    const entreprise = C.journalEntries(data, SOCIETE, {}, { sections: ['ventes'] }).map((l) => `${l.account} ${millimes(l.debit)} ${millimes(l.credit)}`);
    expect(entreprise).toEqual(serveur);
  });

  it('une pièce d\'avant, sans nature sur ses lignes, garde tout au compte des ventes', () => {
    const avant = { ...pieceServeur, lignes: pieceServeur.lignes.map((l) => { const copie = { ...l }; delete copie.nature; return copie; }) };
    const lignes = ecritureDeVente(calculerPiece(avant), { type: 'facture', devise: TND }, TND, COMPTES).lignes.filter((l) => l.nature === 'ventes');
    expect(lignes.map((l) => `${l.compte} ${l.credit}`)).toEqual(['706 8930', '706 335967']);
  });

  it('le ticket au prix d\'étiquette : la base de son taux se ventile au prorata du TTC, la même des deux côtés', () => {
    // Trois pots de peinture et deux sachets de chevilles (« Article divers », sans fiche), à 19 %.
    const ticket = { id: 't1', type: 'facture', ticket: true, prixTtc: true, number: 'TIC-2026-0007', status: 'payée', date: '2026-11-07', clientId: '', currency: 'DT', calcul: 2,
      lines: [{ label: 'Peinture murale blanche 10 L', qty: 3, unitPrice: 89, vatRate: 19, nature: 'marchandises' }, { label: 'Article divers', qty: 2, unitPrice: 1.234, vatRate: 19 }] };
    const t = calculerPiece({ type: 'facture', devise: TND, prixTtc: true, calcul: 2, timbre: 0n, appliquerTimbre: false,
      lignes: [ligne('3', '89', 19, { nature: 'marchandises' }), ligne('2', '1.234', 19)] });
    // 3 × 105,910 + 2 × 1,468 = 320,666 TTC ; TVA 51,199 ; base 269,467, dont 267,000 de marchandises (317,730 × 269,467 / 320,666).
    expect(t.tvaParTaux.get(190_000n)).toEqual({ base: 269_467n, tva: 51_199n, marchandises: 267_000n });
    const v = C.computeTotals(ticket, SOCIETE).vatByRate['19'];
    expect([millimes(v?.base), millimes(v?.marchandises)]).toEqual([269_467, 267_000]);
  });

  it('la nature d\'une ligne : celle qu\'elle porte, sinon celle de son article ; la même règle chez l\'entreprise et au serveur', () => {
    const cas: [Fiche, Fiche | null, string][] = [
      [{ nature: 'produits' }, { tracked: true }, 'produits'],          // figée sur la ligne (l'avoir copié de sa facture)
      [{ nature: 'services' }, { tracked: true }, ''],                  // « une prestation », choisi au panier
      [{}, { nature: 'services', tracked: true }, ''],                   // dit sur la fiche : la fiche l'emporte sur le stock
      [{}, { tracked: true }, 'marchandises'],                           // suivi en stock : revendu tel qu'acheté
      [{}, { composants: [{ itemId: 'a', qty: 2 }] }, 'marchandises'],  // un kit
      [{}, { fodec: true, tracked: true }, 'produits'],                  // fabriqué (la FODEC)
      [{}, { unitPrice: 25 }, ''],                                       // une prestation du catalogue
      [{ fodec: true }, null, 'produits'],                               // une ligne sans article qui porte la FODEC
      [{}, null, ''],                                                    // « Article divers »
    ];
    expect(cas.map(([l, a]) => natureDeLaLigne(l, a) ?? '')).toEqual(cas.map(([, , n]) => n));
    expect(cas.filter(([l]) => !l.nature && !l.fodec).map(([, a]) => C.natureDeLArticle(a))).toEqual(cas.filter(([l]) => !l.nature && !l.fodec).map(([, , n]) => n));
    // Le panier de la caisse porte la nature de l'article dès qu'il y entre ; une prestation n'en porte pas.
    expect(C.ligneDePanier({ id: 'p', label: 'Peinture', unitPrice: 89, vatRate: 19, tracked: true }, SOCIETE).nature).toBe('marchandises');
    expect('nature' in C.ligneDePanier({ id: 's', label: 'Pose', unitPrice: 25, vatRate: 19 }, SOCIETE)).toBe(false);
  });

  it('la nature proposée à une fiche neuve (1.356.0) : le métier d\'abord, puis le comptoir ; une prestation sinon', () => {
    // La boulangerie crée « Croissant » depuis la recherche de sa caisse : sans métier dit, ce qu'on vend au comptoir se
    // revend (707) ; une fiche créée au catalogue reste une prestation (706), comme avant. Le métier tranche partout.
    const cas: [Fiche, boolean, string][] = [
      [{}, true, 'marchandises'],                          // au comptoir, sans métier
      [{}, false, 'services'],                             // au catalogue, sans métier : l'ancien défaut, inchangé
      [{ activity: 'commerce' }, false, 'marchandises'],   // un commerce revend, même au catalogue
      [{ activity: 'restauration' }, true, 'produits'],    // ce qu'un restaurant vend, il le fabrique
      [{ activity: 'artisanat' }, false, 'produits'],
      [{ activity: 'informatique' }, false, 'services'],   // un métier de service reste une prestation
      [{ activity: 'informatique' }, true, 'marchandises'],// sauf au comptoir, où l'on vend ce qu'on a sur l'étagère
    ];
    expect(cas.map(([c, comptoir]) => C.natureProposee(c, comptoir))).toEqual(cas.map(([, , n]) => n));
  });

  it('les comptes par défaut : 707 et 701 dans le plan du serveur comme dans celui de l\'entreprise', () => {
    expect([PLAN_PAR_DEFAUT.ventes, PLAN_PAR_DEFAUT.ventesMarchandises, PLAN_PAR_DEFAUT.ventesProduits]).toEqual(['706', '707', '701']);
    expect([C.DEFAULT_ACCOUNTS.ventes, C.DEFAULT_ACCOUNTS.ventesMarchandises, C.DEFAULT_ACCOUNTS.ventesProduits]).toEqual(['706', '707', '701']);
  });
});
