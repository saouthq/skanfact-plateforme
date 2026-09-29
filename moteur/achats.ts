// Le calcul d'un achat (porté de `purchaseTotals`, core.js de la v10), en entiers.
// Même moteur que les ventes, trois différences : pas de remise globale (elle est déjà dans le prix
// du fournisseur), la TVA peut être non déductible ligne par ligne, et des frais (timbre du
// fournisseur, port) s'ajoutent au TTC. Chaque ligne est arrondie à l'unité de la devise de la
// pièce, puis sa TVA ; les totaux sont des sommes de lignes.
//
// Deux jeux de montants (10.1.0) : ceux de la pièce, dans sa devise (ce que le fournisseur a écrit),
// et `base`, les mêmes dans la devise de la comptabilité, SIGNÉS (un avoir fournisseur retire), pour
// tout ce qui additionne plusieurs pièces. Un acompte n'est pas une charge (10.2.0) : ses
// destinations sont vides et son montant vit dans `base.avance`.
//
// Pur : il ne lit ni la base ni les règles.

import { diviserArrondi, echelle, MILLE, MILLION, type Devise } from './argent.ts';
import { dansLaDeviseDe, versLaBase, type EnDevise, type LigneEcriture, type NatureLigne } from './ecritures.ts';
import { retenueAuFil, type Reglement } from './reglements.ts';

export type NatureAchat = 'facture' | 'depense' | 'avoir' | 'acompte';
export type Destination = 'charge' | 'stock' | 'immobilisation';
export const DESTINATIONS: Destination[] = ['charge', 'stock', 'immobilisation'];

export type LigneAchat = {
  quantite: bigint;         // en millièmes
  prixUnitaire: bigint;     // à six décimales, dans la devise de la pièce
  tauxTva: bigint;          // à six décimales (19 % = 190 000)
  destination?: Destination; // par défaut : une charge
  // TVA non déductible (voiture de tourisme, réception…) : elle entre dans le coût. À VÉRIFIER.
  nonDeductible?: boolean;
};

export type Achat = {
  nature: NatureAchat;
  devise: Devise;
  cours?: bigint | undefined;   // « 1 unité de la devise = x dinars », à six décimales
  lignes: LigneAchat[];
  frais?: bigint;               // dans la devise de la pièce
  tauxRetenue?: bigint;         // à six décimales : la retenue que l'entreprise opère en payant
  // L'entreprise récupère-t-elle la TVA de cet achat ? (non, pour une entreprise non assujettie)
  tvaRecuperable: boolean;
};

type ParDestination = Record<Destination, bigint>;
export type TotauxAchat = {
  lignes: (LigneAchat & { ht: bigint; tva: bigint; ttc: bigint; destination: Destination; deductible: boolean })[];
  totalHT: bigint;
  tvaParTaux: Map<bigint, { base: bigint; tva: bigint; deductible: bigint }>;
  totalTVA: bigint;
  tvaDeductible: bigint;
  frais: bigint;
  totalTTC: bigint;
  retenue: bigint;
  netAPayer: bigint;
  parDestination: ParDestination;         // le HT
  nonDeductibleParDestination: ParDestination;
  base: {
    totalHT: bigint; totalTVA: bigint; tvaDeductible: bigint; frais: bigint; totalTTC: bigint; retenue: bigint; netAPayer: bigint;
    tvaParTaux: Map<bigint, { base: bigint; tva: bigint; deductible: bigint }>;
    parDestination: ParDestination; nonDeductibleParDestination: ParDestination;
    cout: ParDestination;                 // ce que chaque destination COÛTE : HT + TVA non déductible
    avance: bigint;                       // un acompte : l'avance posée chez le fournisseur
  };
};

const auTaux = (montant: bigint, taux: bigint) => diviserArrondi(montant * taux, MILLION);
const vide = (): ParDestination => ({ charge: 0n, stock: 0n, immobilisation: 0n });

export function calculerAchat(a: Achat, base: Devise): TotauxAchat {
  const s = echelle(a.devise);
  const lignes = a.lignes.map((l) => {
    const ht = diviserArrondi(l.quantite * l.prixUnitaire * s, MILLE * MILLION);
    const tva = auTaux(ht, l.tauxTva);
    return { ...l, ht, tva, ttc: ht + tva, destination: l.destination ?? 'charge', deductible: a.tvaRecuperable && !l.nonDeductible };
  });
  const somme = (f: (l: (typeof lignes)[number]) => bigint) => lignes.reduce((t, l) => t + f(l), 0n);
  const totalHT = somme((l) => l.ht);
  const totalTVA = somme((l) => l.tva);
  const tvaDeductible = somme((l) => (l.deductible ? l.tva : 0n));
  const tvaParTaux = new Map<bigint, { base: bigint; tva: bigint; deductible: bigint }>();
  for (const l of lignes) {
    const t = tvaParTaux.get(l.tauxTva) ?? { base: 0n, tva: 0n, deductible: 0n };
    t.base += l.ht; t.tva += l.tva; if (l.deductible) t.deductible += l.tva;
    tvaParTaux.set(l.tauxTva, t);
  }
  const frais = a.frais ?? 0n;
  const totalTTC = totalHT + totalTVA + frais;
  const retenue = auTaux(totalHT + totalTVA, a.tauxRetenue ?? 0n);
  const netAPayer = totalTTC - retenue;
  const parDestination = vide(), nonDeductibleParDestination = vide();
  for (const l of lignes) {
    parDestination[l.destination] += l.ht;
    if (!l.deductible) nonDeductibleParDestination[l.destination] += l.tva;
  }

  // Dans la devise de la comptabilité, signé : un avoir fournisseur retire.
  const sens = a.nature === 'avoir' ? -1n : 1n;
  const conv = (v: bigint) => sens * versLaBase(v, a.devise, a.cours, base);
  const avance = a.nature === 'acompte';
  const b = {
    parDestination: vide(), nonDeductibleParDestination: vide(), cout: vide(),
  };
  for (const k of DESTINATIONS) {
    b.parDestination[k] = avance ? 0n : conv(parDestination[k]);
    b.nonDeductibleParDestination[k] = avance ? 0n : conv(nonDeductibleParDestination[k]);
    b.cout[k] = b.parDestination[k] + b.nonDeductibleParDestination[k];
  }
  return {
    lignes, totalHT, tvaParTaux, totalTVA, tvaDeductible, frais, totalTTC, retenue, netAPayer, parDestination, nonDeductibleParDestination,
    base: {
      totalHT: conv(totalHT), totalTVA: conv(totalTVA), tvaDeductible: conv(tvaDeductible), frais: avance ? 0n : conv(frais),
      totalTTC: conv(totalTTC), retenue: conv(retenue), netAPayer: conv(netAPayer),
      tvaParTaux: new Map([...tvaParTaux].map(([k, v]) => [k, { base: conv(v.base), tva: conv(v.tva), deductible: conv(v.deductible) }])),
      ...b,
      avance: avance ? conv(totalHT + frais) : 0n,
    },
  };
}

// Ce qu'une pièce RATTACHÉE à une facture d'achat en couvre (`imputationAchat`, 10.14.0), dans sa
// propre devise : en net (ce que la facture ne versera pas) et en brut (ce que le compte du
// fournisseur ne portera plus). Un acompte couvre son montant entier (sa retenue a été opérée quand
// il a été versé) ; un avoir couvre ce que le fournisseur n'a pas remboursé.
export function imputationAchat(t: Pick<TotauxAchat, 'netAPayer' | 'retenue'>, nature: NatureAchat, remboursements: Reglement[] = []): { net: bigint; brut: bigint } {
  if (nature !== 'avoir') return { net: t.netAPayer, brut: t.netAPayer + t.retenue };
  const rendu = remboursements.reduce((s, r) => s + r.montant, 0n);
  const net = t.netAPayer - rendu;
  if (net <= 0n) return { net: 0n, brut: 0n };
  const operee = retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, [], remboursements).operee;
  return { net, brut: t.netAPayer + t.retenue - rendu - operee };
}

export type ComptesAchat = {
  fournisseurs: string; charges: string; achatsStock: string; immobilisations: string; fraisAccessoires: string;
  tvaDeductible: string; avancesFournisseurs: string; gainsChange: string; pertesChange: string;
  retenueOperee?: string;   // pour la régularisation de retenue d'un avoir
};
// La facture qu'un avoir fournisseur diminue : ce qu'il en couvre (`imputationAchat`, dans la devise
// de l'avoir) et la régularisation de retenue qu'il y porte (dans la devise de la facture).
export type RattachementAchat = { facture: EnDevise; brutImpute: bigint; regularisationRetenue: bigint };
export type EcritureAchat = { journal: 'AC' | 'OD'; lignes: LigneEcriture[] };

// Un montant négatif change de colonne ; un montant nul ne s'écrit pas.
function poseur(lignes: LigneEcriture[]) {
  return (compte: string, nature: NatureLigne, montant: bigint, sens: 'debit' | 'credit') => {
    if (montant === 0n) return;
    const auDebit = (sens === 'debit') === (montant > 0n);
    const m = montant < 0n ? -montant : montant;
    lignes.push({ compte, nature, debit: auDebit ? m : 0n, credit: auDebit ? 0n : m });
  };
}
const solde = (lignes: LigneEcriture[]) => lignes.reduce((a, l) => a + l.debit - l.credit, 0n);
// Ce qu'il faut AJOUTER au débit du tiers pour le régler au cours de la pièce cible, sur un montant
// `natif` de la pièce (`ecartDeTauxEntre`, 10.14.0) ; > 0, un gain.
function ecartDeCours(piece: EnDevise, cible: EnDevise, natif: bigint, base: Devise): bigint {
  if (natif === 0n || (piece.devise.code === cible.devise.code && piece.devise.code === base.code)) return 0n;
  return versLaBase(dansLaDeviseDe(natif, piece, cible, base), cible.devise, cible.cours, base) - versLaBase(natif, piece.devise, piece.cours, base);
}

// L'écriture d'un achat au journal des achats, dans la devise de la comptabilité :
//   D charges, stock ou immobilisations   le HT de chaque destination
//   D frais accessoires                     les frais
//   D TVA déductible                        la TVA récupérable
//   D la destination                        la TVA NON déductible, qui grossit le coût (10.14.0)
//   C fournisseur                           le brut : la retenue naît au règlement (10.14.0)
// Un acompte n'est pas une charge : tout va aux avances (409). Un avoir s'écrit à l'envers ;
// rattaché à sa facture, il règle le fournisseur au cours de la FACTURE (l'écart au change) et
// régularise la retenue déjà opérée, à SA date. En devise, les montants convertis un à un peuvent
// ne pas retomber sur le total converti : cet écart de CONVERSION va au change, jamais avalé par
// une autre ligne (la v10 le posait sur la plus grosse).
export function ecritureDAchat(t: TotauxAchat, achat: Achat, base: Devise, comptes: ComptesAchat, rattachement?: RattachementAchat): EcritureAchat {
  const lignes: LigneEcriture[] = [];
  const poser = poseur(lignes);
  const b = t.base;
  const compteDe: Record<Destination, string> = { charge: comptes.charges, stock: comptes.achatsStock, immobilisation: comptes.immobilisations };
  poser(comptes.avancesFournisseurs, 'avance', b.avance, 'debit');
  for (const k of DESTINATIONS) poser(compteDe[k], 'achat', b.parDestination[k], 'debit');
  poser(comptes.fraisAccessoires, 'frais', b.frais, 'debit');
  poser(comptes.tvaDeductible, 'tva', b.tvaDeductible, 'debit');
  if (achat.nature === 'acompte') poser(comptes.avancesFournisseurs, 'avance', b.totalTVA - b.tvaDeductible, 'debit');
  else for (const k of DESTINATIONS) poser(compteDe[k], 'achat', b.nonDeductibleParDestination[k], 'debit');
  const avoirRattache = achat.nature === 'avoir' && rattachement ? rattachement : undefined;
  const delta = avoirRattache ? ecartDeCours(achat, avoirRattache.facture, avoirRattache.brutImpute, base) : 0n;
  poser(comptes.fournisseurs, 'fournisseur', b.netAPayer + b.retenue - delta, 'credit');
  if (delta > 0n) poser(comptes.gainsChange, 'change', delta, 'credit');
  else if (delta < 0n) poser(comptes.pertesChange, 'change', -delta, 'debit');
  if (avoirRattache && avoirRattache.regularisationRetenue !== 0n) {
    if (!comptes.retenueOperee) throw new Error('un avoir qui régularise une retenue a besoin du compte de la retenue opérée');
    const r = versLaBase(avoirRattache.regularisationRetenue, avoirRattache.facture.devise, avoirRattache.facture.cours, base);
    poser(comptes.retenueOperee, 'retenue', r, 'credit');
    poser(comptes.fournisseurs, 'fournisseur', r, 'debit');
  }
  const ecart = solde(lignes);
  if (ecart !== 0n) {
    if (achat.devise.code === base.code) throw new Error(`écriture d'achat déséquilibrée : ${ecart}`);
    // Le débit dépasse : il manque un crédit, un gain ; l'inverse, une perte.
    if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'credit');
    else poser(comptes.pertesChange, 'change', -ecart, 'debit');
  }
  return { journal: 'AC', lignes };
}

// L'imputation d'un acompte sur sa facture (10.2.0), à la date de la facture : le fournisseur est
// débité du brut de l'acompte (au cours de la FACTURE, l'écart au change), l'avance et la TVA que
// l'acompte avait posées sont reprises. Sans elle, le 401 et le 409 resteraient ouverts pour toujours.
export function ecritureDImputationAcompte(ta: TotauxAchat, acompte: EnDevise, facture: EnDevise, base: Devise, comptes: ComptesAchat): EcritureAchat {
  const lignes: LigneEcriture[] = [];
  const poser = poseur(lignes);
  const delta = ecartDeCours(acompte, facture, ta.netAPayer + ta.retenue, base);
  poser(comptes.fournisseurs, 'fournisseur', ta.base.netAPayer + ta.base.retenue + delta, 'debit');
  if (delta > 0n) poser(comptes.gainsChange, 'change', delta, 'credit');
  else if (delta < 0n) poser(comptes.pertesChange, 'change', -delta, 'debit');
  poser(comptes.avancesFournisseurs, 'avance', ta.base.totalTTC - ta.base.tvaDeductible, 'credit');
  poser(comptes.tvaDeductible, 'tva', ta.base.tvaDeductible, 'credit');
  const ecart = solde(lignes);
  if (ecart !== 0n) {
    if (acompte.devise.code === base.code) throw new Error(`imputation déséquilibrée : ${ecart}`);
    if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'credit');
    else poser(comptes.pertesChange, 'change', -ecart, 'debit');
  }
  return { journal: 'OD', lignes };
}

export type SoldeAchat = { paye: bigint; impute: bigint; reste: bigint };
// Ce qui reste à payer sur un achat (`purchaseBalance`, 10.2.0), dans sa devise : le net, moins ce
// qui a été versé, moins ce que ses pièces rattachées couvrent (`imputes` : `imputationAchat(...).net`
// de chaque avoir et acompte, dans la devise de l'achat). Un avoir imputé est consommé par sa
// facture (il ne doit plus rien) ; un avoir libre est un crédit détenu : son reste est négatif, et
// il revient à zéro quand le fournisseur le rembourse.
export function soldeAchat(t: Pick<TotauxAchat, 'netAPayer'>, nature: NatureAchat, rattache: boolean, reglements: bigint[], imputes: bigint[] = []): SoldeAchat {
  const paye = reglements.reduce((a, b) => a + b, 0n);
  if (nature === 'avoir') return { paye, impute: 0n, reste: rattache ? 0n : paye - t.netAPayer };
  const impute = imputes.reduce((a, b) => a + b, 0n);
  return { paye, impute, reste: t.netAPayer - paye - impute };
}

export type StatutAchat = 'payee' | 'partiel' | 'en_retard' | 'a_payer' | 'impute' | 'rembourse' | 'a_imputer';
// Le statut se déduit ; il ne s'enregistre pas. `echeance` et `aujourdhui` sont des jours du calendrier.
export function statutAchat(nature: NatureAchat, rattache: boolean, solde: SoldeAchat, echeance: string | undefined, aujourdhui: string): StatutAchat {
  if (nature === 'avoir') return rattache ? 'impute' : solde.paye > 0n && solde.reste >= 0n ? 'rembourse' : 'a_imputer';
  if (solde.reste <= 0n) return 'payee';
  if (solde.paye > 0n || solde.impute > 0n) return 'partiel';
  if (echeance && echeance < aujourdhui) return 'en_retard';
  return 'a_payer';
}

export type ComptesReglementFournisseur = { fournisseurs: string; tresorerie: string; retenueOperee: string; gainsChange: string; pertesChange: string };
// L'écriture d'un règlement fournisseur (la partie « règlements » de `journalEntries`), dans la
// devise de la comptabilité :
//   D fournisseur     ce qu'on lui verse PLUS la retenue qu'on garde pour l'État (au cours de la
//                     pièce : le 401 se solde au cours auquel il a été crédité)
//   C trésorerie      ce qui sort vraiment de la banque ou de la caisse (au cours du jour)
//   C retenue opérée  la part de retenue de ce règlement : c'est ici qu'elle naît (10.14.0)
//   D/C change        payer plus de dinars que la pièce n'en porte est une perte, moins un gain
// Un règlement porté par un AVOIR est un remboursement : l'argent entre, chaque ligne change de colonne.
export function ecritureDeReglementFournisseur(
  achat: EnDevise & { nature: NatureAchat }, reglement: Reglement, partRetenue: bigint, base: Devise, comptes: ComptesReglementFournisseur,
): { lignes: LigneEcriture[] } {
  const sens = achat.nature === 'avoir' ? -1n : 1n;
  const coursDuJour = reglement.cours !== undefined && reglement.cours > 0n ? reglement.cours : achat.cours;
  const verse = sens * versLaBase(reglement.montant, achat.devise, coursDuJour, base);
  const soldeTiers = sens * versLaBase(reglement.montant, achat.devise, achat.cours, base);
  const retenue = sens * versLaBase(partRetenue, achat.devise, achat.cours, base);
  const lignes: LigneEcriture[] = [];
  const poser = poseur(lignes);
  poser(comptes.fournisseurs, 'fournisseur', soldeTiers + retenue, 'debit');
  poser(comptes.tresorerie, 'tresorerie', verse, 'credit');
  poser(comptes.retenueOperee, 'retenue', retenue, 'credit');
  const ecart = verse - soldeTiers;
  if (ecart > 0n) poser(comptes.pertesChange, 'change', ecart, 'debit');
  else if (ecart < 0n) poser(comptes.gainsChange, 'change', -ecart, 'credit');
  if (solde(lignes) !== 0n) throw new Error('écriture de règlement déséquilibrée');
  return { lignes };
}
