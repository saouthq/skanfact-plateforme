// Les déclarations du mois (cadrage 08 § 1.2), lues dans les ÉCRITURES : la TVA collectée est ce que
// le compte de TVA collectée a reçu dans le mois, la TVA déductible ce que le compte de TVA
// déductible a reçu, les retenues ce que les comptes de retenue ont reçu. La v10 les calculait par
// un autre chemin (en additionnant les pièces, `vatReturn`) ; son banc exige que les deux chemins
// disent le même chiffre, mois par mois : la déclaration ne peut pas dire autre chose que les livres.
//
// À VÉRIFIER avec le comptable, comme dans la v10 : ce sont des calculs exacts sur les données, pas
// une déclaration officielle.

import type { LigneEcriture } from './ecritures.ts';

export type EcritureDatee = { date: string; lignes: Pick<LigneEcriture, 'compte' | 'debit' | 'credit'>[] };
export type ComptesDeclaration = { tvaCollectee: string; tvaDeductible: string; timbre: string; retenueSubie: string; retenueOperee: string };

// Le mouvement d'un compte sur une période (débit moins crédit), bornes comprises. Une date est un
// jour du calendrier : « 2026-03-31 » se compare comme un texte.
export function mouvement(ecritures: EcritureDatee[], compte: string, du: string, au: string): bigint {
  let m = 0n;
  for (const e of ecritures) {
    if (e.date < du || e.date > au) continue;
    for (const l of e.lignes) if (l.compte === compte) m += l.debit - l.credit;
  }
  return m;
}

export type DeclarationTva = {
  collectee: bigint; deductible: bigint; reportRecu: bigint; aPayer: bigint; creditReporte: bigint;
  timbres: bigint; retenuesSubies: bigint; retenuesOperees: bigint;
};

// La TVA du mois : collectée, moins déductible, moins le crédit reporté du mois d'avant. Ce qui
// reste se paie ; un reste négatif est un crédit qui se reporte sur le mois suivant.
export function declarationTva(ecritures: EcritureDatee[], du: string, au: string, comptes: ComptesDeclaration, report: bigint): DeclarationTva {
  const collectee = -mouvement(ecritures, comptes.tvaCollectee, du, au);
  const deductible = mouvement(ecritures, comptes.tvaDeductible, du, au);
  const reportRecu = report > 0n ? report : 0n;
  const solde = collectee - deductible - reportRecu;
  return {
    collectee, deductible, reportRecu,
    aPayer: solde > 0n ? solde : 0n,
    creditReporte: solde < 0n ? -solde : 0n,
    // Les timbres se déclarent avec la TVA ; les retenues du mois sont celles des RÈGLEMENTS du mois
    // (et des régularisations des avoirs posés après), jamais celles des factures (10.14.0).
    timbres: -mouvement(ecritures, comptes.timbre, du, au),
    retenuesSubies: mouvement(ecritures, comptes.retenueSubie, du, au),
    retenuesOperees: -mouvement(ecritures, comptes.retenueOperee, du, au),
  };
}

// Le dernier jour d'un mois (« 2026-02-28 »), en UTC pur (une date est un jour, jamais un instant).
export function finDeMois(annee: number, mois: number): string {
  const j = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return `${annee}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

// Les douze déclarations d'une année, le crédit de chaque mois reporté sur le suivant.
export function chaineTva(ecritures: EcritureDatee[], annee: number, comptes: ComptesDeclaration, reportDebut: bigint): (DeclarationTva & { mois: string })[] {
  const out: (DeclarationTva & { mois: string })[] = [];
  let report = reportDebut;
  for (let m = 1; m <= 12; m++) {
    const d = declarationTva(ecritures, `${annee}-${String(m).padStart(2, '0')}-01`, finDeMois(annee, m), comptes, report);
    out.push({ ...d, mois: `${annee}-${String(m).padStart(2, '0')}` });
    report = d.creditReporte;
  }
  return out;
}
