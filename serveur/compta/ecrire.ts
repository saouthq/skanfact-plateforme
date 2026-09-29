// Écrire une famille d'écritures (docs/ecritures.md § 2) : ce que les ventes, les achats (et demain
// la paie) partagent. Le seul chemin d'écriture est `compta.ecrire_famille` (0015) : il remplace le
// brouillard de la famille d'un bloc, et refuse une famille qui a une écriture validée.

import { rendre, t, type Valeurs } from '../../textes/index.ts';
import type { Transaction } from '../base.ts';
import './textes.ts';

export type LigneAEcrire = { compte: string; libelle: string; debit: bigint; credit: bigint; tauxTva: bigint | null };
export type EcritureAEcrire = {
  journal: 'VT' | 'AC' | 'BQ' | 'CA' | 'OD' | 'PAIE'; date: string;
  origineType: 'vente' | 'encaissement' | 'achat' | 'imputation' | 'reglement_fournisseur' | 'paie' | 'salaires' | 'avance'; origine: string;
  piece: string | null; tiers: string | null; libelle: string; lignes: LigneAEcrire[];
};

// Un libellé, dans la langue de l'entreprise (le français, tant qu'aucune autre n'est choisie).
export const libelle = (cle: string, valeurs: Valeurs) => rendre(t(cle, valeurs), 'fr').slice(0, 500);

export async function ecrireFamille(tx: Transaction, entreprise: string, famille: string, ecritures: EcritureAEcrire[]): Promise<void> {
  const json = JSON.stringify(ecritures.map((e, rang) => ({
    journal: e.journal, date: e.date, origine_type: e.origineType, origine: e.origine, rang, piece: e.piece, tiers: e.tiers, libelle: e.libelle,
    lignes: e.lignes.map((l) => ({ compte: l.compte, libelle: l.libelle, debit: l.debit.toString(), credit: l.credit.toString(), taux_tva: l.tauxTva === null ? null : l.tauxTva.toString() })),
  })));
  await tx.query('select compta.ecrire_famille($1, $2, $3::jsonb)', [entreprise, famille, json]);
}
