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
  // (1.155.0, maquette de la facture) La remise de la ligne, à six décimales (10 % = 100 000) : elle se retire du
  // montant de la ligne, arrondi, AVANT la remise globale. Absente ou nulle : la ligne d'avant, au millime près.
  tauxRemise?: bigint;
  // (1.155.0, maquette de la facture) La ligne porte la FODEC : un produit que l'entreprise fabrique. Son montant est le
  // taux de la pièce (`tauxFodec`) sur la base remisée de la ligne ; il entre dans la base de la TVA. À VÉRIFIER avec
  // un comptable : l'assiette (le HT après remise) et l'entrée dans la base de la TVA.
  fodec?: boolean;
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
  // Au comptoir, le prix d'étiquette fait foi (lot caisse 3, 06/10/2026) : une pièce « prix TTC » (un ticket de caisse,
  // et l'avoir de son retour) se calcule TTC d'abord. Sinon 2 × 1,200 DT faisaient 2,399 DT (le HT gardé au millime).
  prixTtc?: boolean;
  // (1.155.0) Le seuil de la retenue à la source, en MILLIMES, lu à la date de la pièce (règle `retenue.seuil`) : une
  // pièce dont le TTC hors timbre, en dinars, reste sous ce seuil ne porte pas de retenue (elle naîtra au paiement si
  // le client en règle plusieurs pour ce montant). Absent ou nul : pas de seuil, la règle qui ne fait rien.
  seuilRetenue?: bigint;
  // (1.155.0) Le taux de la FODEC, à six décimales (1 % = 10 000), lu à la date de la pièce (règle `fodec.taux`). Absent
  // ou nul : aucune FODEC, la règle qui ne fait rien. Une pièce « prix TTC » (le comptoir) n'en porte jamais.
  tauxFodec?: bigint;
};

// `brut` : le montant de la ligne avant sa propre remise (le HT, ou le TTC d'une pièce « prix TTC »).
export type LigneCalculee = LignePiece & { brut: bigint; ht: bigint; tva: bigint; ttc: bigint };

export type TotauxPiece = {
  lignes: LigneCalculee[];
  totalHT: bigint;
  remise: bigint;
  netHT: bigint;
  // Par taux (clé : le taux à six décimales) : la base remisée et la TVA ; `fodec`, la part de la base qui est de la FODEC
  // (1.155.0), seulement quand ce taux en porte.
  tvaParTaux: Map<bigint, { base: bigint; tva: bigint; fodec?: bigint }>;
  totalTVA: bigint;
  fodec: bigint;            // (1.155.0) dans la devise de la pièce ; zéro sans ligne qui la porte
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
  if (p.prixTtc) return calculerPieceTtc(p);
  const s = echelle(p.devise);
  // HT d'une ligne : quantité (÷ 1 000) × prix (÷ 1 000 000), dans l'unité de la devise.
  const lignes: LigneCalculee[] = p.lignes.map((l) => {
    const brut = diviserArrondi(l.quantite * l.prixUnitaire * s, MILLE * MILLION);
    const ht = brut - auTaux(brut, l.tauxRemise ?? 0n);
    const tva = auTaux(ht, l.tauxTva);
    return { ...l, brut, ht, tva, ttc: ht + tva };
  });
  const totalHT = lignes.reduce((t, l) => t + l.ht, 0n);
  const remisable = lignes.filter((l) => !l.sansRemise).reduce((t, l) => t + l.ht, 0n);
  const remise = auTaux(remisable, p.tauxRemise ?? 0n);
  const netHT = totalHT - remise;

  // La remise se répartit sur les lignes remisables au prorata ; la TVA se calcule par taux sur la
  // base remisée. Comme la v10, le total de TVA d'un taux s'arrondit à chaque ligne ajoutée.
  // La FODEC d'une ligne (1.155.0) : le taux sur sa base remisée, arrondi à la ligne, ajouté à la base de son taux de TVA.
  const tvaParTaux = new Map<bigint, { base: bigint; tva: bigint; fodec?: bigint }>();
  let fodec = 0n;
  for (const l of lignes) {
    const remisee = l.sansRemise || remisable <= 0n ? l.ht : diviserArrondi(l.ht * (remisable - remise), remisable);
    const f = l.fodec ? auTaux(remisee, p.tauxFodec ?? 0n) : 0n;
    fodec += f;
    const base = remisee + f;
    const t = tvaParTaux.get(l.tauxTva) ?? { base: 0n, tva: 0n };
    t.base += base;
    t.tva = diviserArrondi(t.tva * MILLION + base * l.tauxTva, MILLION);
    if (f) t.fodec = (t.fodec ?? 0n) + f;
    tvaParTaux.set(l.tauxTva, t);
  }
  const totalTVA = [...tvaParTaux.values()].reduce((t, v) => t + v.tva, 0n);
  return finir(p, s, { lignes, totalHT, remise, netHT, tvaParTaux, totalTVA, fodec });
}

// La pièce « prix TTC » (porté de `computeTotals`, core.js, la même règle) : le TTC d'une ligne est la quantité × le prix
// unitaire TTC (le HT unitaire × (1 + taux), arrondi comme il s'affiche) ; la remise porte sur le TTC ; par taux, la TVA
// est extraite du TTC (TTC × t / (1 + t)) et le HT en est la différence. À VÉRIFIER avec un comptable : la TVA d'un
// ticket extraite du TTC, comme le fait le commerce de détail.
function calculerPieceTtc(p: Piece): TotauxPiece {
  const s = echelle(p.devise);
  const lignes: LigneCalculee[] = p.lignes.map((l) => {
    const unitaireTtc = diviserArrondi(l.prixUnitaire * s * (MILLION + l.tauxTva), MILLION * MILLION);
    const brut = diviserArrondi(l.quantite * unitaireTtc, MILLE);
    const ttc = brut - auTaux(brut, l.tauxRemise ?? 0n);
    const tva = diviserArrondi(ttc * l.tauxTva, MILLION + l.tauxTva);
    return { ...l, brut, ht: ttc - tva, tva, ttc };
  });
  // Le HT avant remise s'extrait par taux, comme le net : ligne à ligne, l'arrondi inventait une remise d'un millime sur
  // un ticket sans remise.
  const brutParTaux = new Map<bigint, bigint>();
  for (const l of lignes) brutParTaux.set(l.tauxTva, (brutParTaux.get(l.tauxTva) ?? 0n) + l.ttc);
  const totalHT = [...brutParTaux].reduce((t, [taux, ttc]) => t + ttc - diviserArrondi(ttc * taux, MILLION + taux), 0n);
  const remisable = lignes.filter((l) => !l.sansRemise).reduce((t, l) => t + l.ttc, 0n);
  const remiseTtc = auTaux(remisable, p.tauxRemise ?? 0n);
  // Le TTC remisé de chaque taux (la remise répartie au prorata, ligne à ligne, comme la v10), puis sa TVA et sa base.
  const ttcParTaux = new Map<bigint, bigint>();
  for (const l of lignes) {
    const ttc = l.sansRemise || remisable <= 0n ? l.ttc : diviserArrondi(l.ttc * (remisable - remiseTtc), remisable);
    ttcParTaux.set(l.tauxTva, (ttcParTaux.get(l.tauxTva) ?? 0n) + ttc);
  }
  const tvaParTaux = new Map<bigint, { base: bigint; tva: bigint }>();
  for (const [taux, ttc] of ttcParTaux) {
    const tva = diviserArrondi(ttc * taux, MILLION + taux);
    tvaParTaux.set(taux, { base: ttc - tva, tva });
  }
  const totalTVA = [...tvaParTaux.values()].reduce((t, v) => t + v.tva, 0n);
  const netHT = [...tvaParTaux.values()].reduce((t, v) => t + v.base, 0n);
  return finir(p, s, { lignes, totalHT, remise: totalHT - netHT, netHT, tvaParTaux, totalTVA, fodec: 0n });
}

type Corps = Pick<TotauxPiece, 'lignes' | 'totalHT' | 'remise' | 'netHT' | 'tvaParTaux' | 'totalTVA' | 'fodec'>;
function finir(p: Piece, s: bigint, c: Corps): TotauxPiece {
  const { netHT, totalTVA, fodec } = c;
  // Le timbre est en dinars : sur une pièce en devise, il se convertit au cours de la pièce.
  const applique = timbreApplique(p);
  const timbre = !applique ? 0n
    : p.cours ? diviserArrondi(p.timbre * MILLION * s, MILLE * p.cours)
    : diviserArrondi(p.timbre * s, MILLE);
  const totalTTC = netHT + fodec + totalTVA + timbre;
  // La retenue porte sur le TTC hors timbre, FODEC comprise (À VÉRIFIER avec un comptable, comme dans la v10).
  const tauxRetenue = RETENUE_POSSIBLE.includes(p.type) ? (p.tauxRetenue ?? 0n) : 0n;
  // Le seuil se compare en millimes : le TTC hors timbre d'une pièce en devise, converti au cours de la pièce.
  const horsTimbre = netHT + fodec + totalTVA;
  const enMillimes = p.cours ? diviserArrondi(horsTimbre * p.cours * MILLE, s * MILLION) : diviserArrondi(horsTimbre * MILLE, s);
  const sousLeSeuil = (p.seuilRetenue ?? 0n) > 0n && enMillimes < (p.seuilRetenue ?? 0n);
  const retenue = sousLeSeuil ? 0n : auTaux(horsTimbre, tauxRetenue);
  return {
    ...c, timbre,
    timbreBase: applique ? p.timbre : 0n,
    totalTTC, retenue, netAPayer: totalTTC - retenue,
  };
}
