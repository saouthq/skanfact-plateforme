// Le moteur d'écritures (cadrage 08 § 1.2) : une pièce de vente émise → son écriture au journal des
// ventes, porté de la v10 (`salesJournal` et la partie « ventes » de `journalEntries`), en entiers.
//
// L'écriture d'une facture, dans la devise de la COMPTABILITÉ (le dinar, au millime) :
//   D clients        le TTC (le brut : la retenue naît au règlement, pas ici — 10.14.0)
//   C ventes         la base remisée de chaque taux
//   C TVA collectée  la TVA de chaque taux
//   C timbre         le timbre, tel que la loi le fixe en dinars (10.14.1)
//   C/D change       l'écart de conversion d'une pièce en devise
// Une pièce en devise se convertit composante par composante, au cours de la pièce. Ce qui ne
// tombe pas juste au millime :
//   - en dinars, seule une remise répartie entre deux taux peut laisser un millime : il va dans la
//     plus grosse base (le chiffre d'affaires reste le net HT de la pièce) ;
//   - en devise, l'écart est un écart de CONVERSION : il va au change (gain ou perte), jamais dans le
//     chiffre d'affaires ni sur le timbre.
// L'écriture s'équilibre exactement ; elle n'avale jamais un écart (la v10 en « absorbait » un sur
// sa plus grosse ligne, 10.1.0) : un déséquilibre est un défaut, et il s'arrête ici.
//
// Pur : les comptes lui sont donnés (le plan de l'entreprise), comme le timbre au calcul d'une pièce.

import { diviserArrondi, type Devise } from './argent.ts';
import type { TotauxPiece } from './piece.ts';

export type ComptesVente = { clients: string; ventes: string; tvaCollectee: string; timbre: string; gainsChange: string; pertesChange: string };
export type NatureLigne = 'client' | 'ventes' | 'tva' | 'timbre' | 'change' | 'tresorerie' | 'retenue';
export type LigneEcriture = { compte: string; nature: NatureLigne; debit: bigint; credit: bigint; tauxTva?: bigint };
export type Ecriture = { journal: 'VT'; lignes: LigneEcriture[] };

// Un montant de la pièce (dans la plus petite unité de sa devise) dans la devise de la comptabilité,
// au cours de la pièce (six décimales), arrondi au plus proche.
export function versLaBase(montant: bigint, devise: Devise, cours: bigint | undefined, base: Devise): bigint {
  if (devise.code === base.code) return montant;
  if (cours === undefined || cours <= 0n) throw new Error(`pièce en ${devise.code} sans cours : elle ne se convertit pas`);
  const exposant = devise.decimales + 6 - base.decimales;
  return exposant >= 0 ? diviserArrondi(montant * cours, 10n ** BigInt(exposant)) : montant * cours * 10n ** BigInt(-exposant);
}

export function ecritureDeVente(
  t: TotauxPiece, piece: { type: string; devise: Devise; cours?: bigint | undefined }, base: Devise, comptes: ComptesVente,
): Ecriture {
  if (piece.type !== 'facture') throw new Error(`l'écriture d'une pièce « ${piece.type} » n'est pas encore portée`);
  const conv = (m: bigint) => versLaBase(m, piece.devise, piece.cours, base);
  const taux = [...t.tvaParTaux.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const bases = new Map(taux.map((r) => [r, conv(t.tvaParTaux.get(r)?.base ?? 0n)]));
  const tvas = new Map(taux.map((r) => [r, conv(t.tvaParTaux.get(r)?.tva ?? 0n)]));
  const timbre = t.timbreBase;
  const ttc = conv(t.totalTTC);
  const somme = (m: Map<bigint, bigint>) => [...m.values()].reduce((a, b) => a + b, 0n);
  const ecart = ttc - somme(bases) - somme(tvas) - timbre;
  let ecartConversion = 0n;
  if (ecart !== 0n) {
    if (piece.devise.code === base.code) {
      // La plus grosse base (en valeur absolue) ; à égalité, le premier taux.
      const abs = (x: bigint) => (x < 0n ? -x : x);
      const plusGrosse = taux.reduce((m, r) => (abs(bases.get(r) ?? 0n) > abs(bases.get(m) ?? 0n) ? r : m), taux[0] ?? 0n);
      bases.set(plusGrosse, (bases.get(plusGrosse) ?? 0n) + ecart);
    } else ecartConversion = ecart;
  }

  const lignes: LigneEcriture[] = [];
  // Un montant négatif change de colonne, il ne garde pas son signe ; un montant nul ne s'écrit pas.
  const poser = (compte: string, nature: NatureLigne, montant: bigint, sens: 'debit' | 'credit', tauxTva?: bigint) => {
    if (montant === 0n) return;
    const auDebit = (sens === 'debit') === (montant > 0n);
    const m = montant < 0n ? -montant : montant;
    lignes.push({ compte, nature, debit: auDebit ? m : 0n, credit: auDebit ? 0n : m, ...(tauxTva === undefined ? {} : { tauxTva }) });
  };
  poser(comptes.clients, 'client', ttc, 'debit');
  for (const r of taux) {
    poser(comptes.ventes, 'ventes', bases.get(r) ?? 0n, 'credit', r);
    poser(comptes.tvaCollectee, 'tva', tvas.get(r) ?? 0n, 'credit', r);
  }
  poser(comptes.timbre, 'timbre', timbre, 'credit');
  // L'écart de conversion : ce que le client doit en plus (> 0) est un gain, en moins une perte.
  if (ecartConversion > 0n) poser(comptes.gainsChange, 'change', ecartConversion, 'credit');
  else if (ecartConversion < 0n) poser(comptes.pertesChange, 'change', -ecartConversion, 'debit');

  const debit = lignes.reduce((a, l) => a + l.debit, 0n);
  const credit = lignes.reduce((a, l) => a + l.credit, 0n);
  if (debit !== credit) throw new Error(`écriture déséquilibrée : débit ${debit}, crédit ${credit}`);
  return { journal: 'VT', lignes };
}
