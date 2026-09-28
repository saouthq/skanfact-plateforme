// Les règlements d'une facture de vente (cadrage 08 § 1.2), portés de la v10 en entiers :
//   - la retenue à la source que le client garde sur chaque encaissement (`retenueSubie` et
//     `retenueChrono` de la v10, 10.14.0) : elle naît au règlement, jamais à l'émission ;
//   - ce qui reste à payer et le statut de la facture (`invoiceBalance`, `effectiveStatus`) ;
//   - l'écriture d'un encaissement (la partie « encaissements » de `journalEntries`).
// Tous les montants sont des entiers dans la plus petite unité de leur devise ; les cours ont six
// décimales, comme partout dans le moteur. Pur : il ne lit ni la base ni les règles.

import { diviserArrondi, type Devise } from './argent.ts';
import { versLaBase, type EnDevise, type LigneEcriture, type NatureLigne } from './ecritures.ts';

// La conversion d'une pièce dans la devise d'une autre vit avec les écritures (un avoir s'en sert).
export { dansLaDeviseDe, type EnDevise } from './ecritures.ts';

// Un règlement, dans la devise de la PIÈCE ; négatif, c'est un remboursement (la v10 l'écrit de même,
// 10.14.0 : le signe fait tout le reste). `cours` : le cours du jour où la banque a reçu, s'il diffère
// de celui de la pièce.
export type Reglement = { cle: string; date: string; montant: bigint; cours?: bigint | undefined };
// Une pièce rattachée qui diminue ce que la facture doit (un avoir) : son net et son brut (net plus
// retenue), dans la devise de la facture. `date` vide : elle couvre dès l'origine.
export type PieceLiee = { cle: string; date: string; net: bigint; brut: bigint };

export type RetenueAuFil = {
  parts: Map<string, bigint>;        // la retenue que chaque règlement opère
  ajustements: Map<string, bigint>;  // ce qu'une pièce liée posée après un règlement régularise, à SA date
  due: bigint;                       // la retenue que la facture porte encore, pièces liées déduites
  operee: bigint;                    // celle déjà née des règlements
};

// La retenue au fil des règlements. Chaque règlement opère la part qui porte la retenue reconnue au
// prorata de ce que le client a versé (arrondie à l'unité de la devise : une fraction de centime
// n'existe sur aucune attestation) ; celui qui solde la facture prend le reste. Une pièce liée
// change ce qui est dû à sa date, et régularise ce qui était déjà né, sans réécrire un règlement
// passé (un mois déjà déclaré ne se touche pas). Rien n'est retenu tant que rien n'est versé.
export function retenueAuFil(net: bigint, brut: bigint, liees: PieceLiee[], reglements: Reglement[]): RetenueAuFil {
  type Evenement = { lie: boolean; i: number; cle: string; date: string; net?: bigint; brut?: bigint; montant?: bigint };
  const evenements: Evenement[] = [
    ...liees.map((x, i) => ({ lie: true, i, cle: x.cle, date: x.date, net: x.net, brut: x.brut })),
    ...reglements.map((x, i) => ({ lie: false, i, cle: x.cle, date: x.date, montant: x.montant })),
  ];
  // Par date ; le même jour, les pièces liées d'abord ; puis dans l'ordre donné.
  evenements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.lie === b.lie ? a.i - b.i : a.lie ? -1 : 1));
  let netDu = net, brutDu = brut, cumul = 0n, reconnu = 0n;
  const parts = new Map<string, bigint>(), ajustements = new Map<string, bigint>();
  const cible = () => {
    const due = brutDu - netDu;
    if (due === 0n || cumul <= 0n) return 0n;
    return cumul >= netDu ? due : diviserArrondi(due * cumul, netDu);
  };
  for (const x of evenements) {
    if (x.lie) { netDu -= x.net ?? 0n; brutDu -= x.brut ?? 0n; } else cumul += x.montant ?? 0n;
    const c = cible(), d = c - reconnu;
    reconnu = c;
    if (!x.lie) parts.set(x.cle, d);
    else if (d !== 0n) ajustements.set(x.cle, (ajustements.get(x.cle) ?? 0n) + d);
  }
  return { parts, ajustements, due: brutDu - netDu, operee: reconnu };
}

export type SoldeFacture = { credite: bigint; paye: bigint; reste: bigint };
// Ce qui reste à payer : le net de la facture, moins ses avoirs (dans sa devise), moins ses
// règlements. Une facture annulée ne doit plus rien.
export function soldeFacture(netAPayer: bigint, avoirs: bigint[], reglements: bigint[], annulee = false): SoldeFacture {
  const credite = avoirs.reduce((a, b) => a + b, 0n);
  const paye = reglements.reduce((a, b) => a + b, 0n);
  return { credite, paye, reste: annulee ? 0n : netAPayer - credite - paye };
}

export type StatutFacture = 'payee' | 'annulee' | 'partielle' | 'en_retard' | 'a_payer';
// Le statut se DÉDUIT des règlements et des avoirs ; il ne s'enregistre pas. Une facture que ses
// avoirs couvrent en entier est annulée (toutes ses pièces restent dans la numérotation).
// `echeance` et `aujourdhui` sont des jours du calendrier (« 2026-09-28 »).
export function statutFacture(netAPayer: bigint, solde: SoldeFacture, echeance: string | undefined, aujourdhui: string, annulee = false): StatutFacture {
  if (annulee) return 'annulee';
  if (solde.reste <= 0n) return netAPayer > 0n && solde.credite >= netAPayer ? 'annulee' : 'payee';
  if (solde.paye > 0n || solde.credite > 0n) return 'partielle';
  if (echeance && echeance < aujourdhui) return 'en_retard';
  return 'a_payer';
}

export type ComptesEncaissement = { clients: string; tresorerie: string; retenueSubie: string; gainsChange: string; pertesChange: string };
export type EcritureReglement = { lignes: LigneEcriture[] };

// L'écriture d'un encaissement, dans la devise de la comptabilité :
//   D trésorerie       ce que la banque ou la caisse a vraiment reçu (au cours du jour du règlement)
//   C clients          ce que le client verse PLUS la retenue qu'il garde (au cours de la facture :
//                      le 411 se solde au cours auquel il a été débité)
//   D retenue subie    la part de retenue de ce règlement : c'est ici qu'elle naît (10.14.0)
//   C/D change         l'écart entre ce que la banque a reçu et ce que le client voit soldé
// Un remboursement (montant négatif) change chaque ligne de colonne.
export function ecritureDEncaissement(
  piece: EnDevise, reglement: Reglement, partRetenue: bigint, base: Devise, comptes: ComptesEncaissement,
): EcritureReglement {
  const coursDuJour = reglement.cours !== undefined && reglement.cours > 0n ? reglement.cours : piece.cours;
  const recu = versLaBase(reglement.montant, piece.devise, coursDuJour, base);
  const solde = versLaBase(reglement.montant, piece.devise, piece.cours, base);
  const retenue = versLaBase(partRetenue, piece.devise, piece.cours, base);
  const lignes: LigneEcriture[] = [];
  const poser = (compte: string, nature: NatureLigne, montant: bigint, sens: 'debit' | 'credit') => {
    if (montant === 0n) return;
    const auDebit = (sens === 'debit') === (montant > 0n);
    const m = montant < 0n ? -montant : montant;
    lignes.push({ compte, nature, debit: auDebit ? m : 0n, credit: auDebit ? 0n : m });
  };
  poser(comptes.tresorerie, 'tresorerie', recu, 'debit');
  poser(comptes.clients, 'client', solde + retenue, 'credit');
  poser(comptes.retenueSubie, 'retenue', retenue, 'debit');
  const ecart = recu - solde;
  if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'credit');
  else if (ecart < 0n) poser(comptes.pertesChange, 'change', -ecart, 'debit');
  const debit = lignes.reduce((a, l) => a + l.debit, 0n);
  const credit = lignes.reduce((a, l) => a + l.credit, 0n);
  if (debit !== credit) throw new Error(`écriture déséquilibrée : débit ${debit}, crédit ${credit}`);
  return { lignes };
}
