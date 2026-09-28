// Le calcul d'une pièce de vente (porté de `computeTotals`, core.js de la v10), en entiers.
// L'ORDRE des arrondis est celui de la v10 (01 R3) : chaque ligne arrondie, puis la remise globale,
// puis la TVA par taux sur la base remisée, puis le timbre, puis la retenue. Un banc compare ce
// calcul à celui de la v10, au millime, sur l'exemple de cinq ans et sur des pièces tirées au
// hasard (tests/moteur/banc-v10.test.ts).
//
// Le moteur est PUR : il ne lit ni la base ni les règles. Le timbre et les taux lui sont donnés,
// déjà lus à la date de la pièce (serveur/regles.ts) ; une pièce émise garde ce qu'on lui a donné
// (01 R7).

import { diviserArrondi, echelle, MILLE, MILLION, type Devise } from './argent.ts';

export type TypePiece = 'facture' | 'avoir' | 'proforma' | 'devis' | 'commande' | 'livraison' | 'note_honoraires';

export type LignePiece = {
  quantite: bigint;         // en millièmes
  prixUnitaire: bigint;     // à six décimales, dans la devise de la pièce
  tauxTva: bigint;          // à six décimales (19 % = 190 000)
  // La remise globale ne porte pas sur cette ligne (la déduction d'un acompte déjà facturé).
  sansRemise?: boolean;
};

export type Piece = {
  type: TypePiece;
  devise: Devise;
  // « 1 unité de la devise = x dinars », à six décimales ; absent quand la pièce est en dinars.
  cours?: bigint | undefined;
  lignes: LignePiece[];
  tauxRemise?: bigint;      // à six décimales
  // Le timbre, en MILLIMES (fixé par l'État en dinars), déjà lu à la date de la pièce et gelé à
  // l'émission (7.1.1).
  timbre: bigint;
  // Le timbre d'une facture s'applique d'office ; sur un avoir ou une proforma, il se demande.
  appliquerTimbre?: boolean;
  tauxRetenue?: bigint;     // à six décimales
};

export type LigneCalculee = LignePiece & { ht: bigint; tva: bigint; ttc: bigint };

export type TotauxPiece = {
  lignes: LigneCalculee[];
  totalHT: bigint;
  remise: bigint;
  netHT: bigint;
  // Par taux (clé : le taux à six décimales) : la base remisée et la TVA.
  tvaParTaux: Map<bigint, { base: bigint; tva: bigint }>;
  totalTVA: bigint;
  timbre: bigint;           // dans la devise de la pièce
  timbreBase: bigint;       // en millimes : ce qui se déclare (10.14.0)
  totalTTC: bigint;
  retenue: bigint;
  netAPayer: bigint;
};

// Montant × taux (à six décimales), arrondi dans la même unité.
const auTaux = (montant: bigint, taux: bigint) => diviserArrondi(montant * taux, MILLION);

export function timbreApplique(p: Piece): boolean {
  return (p.type === 'facture' && p.appliquerTimbre !== false)
    || ((p.type === 'avoir' || p.type === 'proforma') && p.appliquerTimbre === true);
}

// La retenue à la source ne se pratique que sur ce qui est réellement payé.
const RETENUE_POSSIBLE: TypePiece[] = ['facture', 'avoir', 'proforma'];

export function calculerPiece(p: Piece): TotauxPiece {
  const s = echelle(p.devise);
  // HT d'une ligne : quantité (÷ 1 000) × prix (÷ 1 000 000), dans l'unité de la devise.
  const lignes: LigneCalculee[] = p.lignes.map((l) => {
    const ht = diviserArrondi(l.quantite * l.prixUnitaire * s, MILLE * MILLION);
    const tva = auTaux(ht, l.tauxTva);
    return { ...l, ht, tva, ttc: ht + tva };
  });
  const totalHT = lignes.reduce((t, l) => t + l.ht, 0n);
  const remisable = lignes.filter((l) => !l.sansRemise).reduce((t, l) => t + l.ht, 0n);
  const remise = auTaux(remisable, p.tauxRemise ?? 0n);
  const netHT = totalHT - remise;

  // La remise se répartit sur les lignes remisables au prorata ; la TVA se calcule par taux sur la
  // base remisée. Comme la v10, le total de TVA d'un taux s'arrondit à chaque ligne ajoutée.
  const tvaParTaux = new Map<bigint, { base: bigint; tva: bigint }>();
  for (const l of lignes) {
    const base = l.sansRemise || remisable <= 0n ? l.ht : diviserArrondi(l.ht * (remisable - remise), remisable);
    const t = tvaParTaux.get(l.tauxTva) ?? { base: 0n, tva: 0n };
    t.base += base;
    t.tva = diviserArrondi(t.tva * MILLION + base * l.tauxTva, MILLION);
    tvaParTaux.set(l.tauxTva, t);
  }
  const totalTVA = [...tvaParTaux.values()].reduce((t, v) => t + v.tva, 0n);

  // Le timbre est en dinars : sur une pièce en devise, il se convertit au cours de la pièce.
  const applique = timbreApplique(p);
  const timbre = !applique ? 0n
    : p.cours ? diviserArrondi(p.timbre * MILLION * s, MILLE * p.cours)
    : diviserArrondi(p.timbre * s, MILLE);
  const totalTTC = netHT + totalTVA + timbre;
  // La retenue porte sur le TTC hors timbre (À VÉRIFIER avec un comptable, comme dans la v10).
  const tauxRetenue = RETENUE_POSSIBLE.includes(p.type) ? (p.tauxRetenue ?? 0n) : 0n;
  const retenue = auTaux(netHT + totalTVA, tauxRetenue);
  return {
    lignes, totalHT, remise, netHT, tvaParTaux, totalTVA, timbre,
    timbreBase: applique ? p.timbre : 0n,
    totalTTC, retenue, netAPayer: totalTTC - retenue,
  };
}
