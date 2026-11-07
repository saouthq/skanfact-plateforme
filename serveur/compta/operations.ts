// Les opérations diverses que le client saisit lui-même, tenues par le serveur (1.303.0 ; 0194 ; docs/ecritures.md, « Les
// opérations diverses du client »). Un loyer sans facture, une charge avancée par le gérant, une régularisation : la v10
// les écrit dans son livre (`journalEntries`, partie « od », core.js), le serveur ne les écrivait nulle part — le cabinet,
// qui lit les livres du serveur, ne les voyait jamais, alors que l'onglet Écritures du client dit qu'il les lit en direct.
// Chaque opération est une FAMILLE (D2), comme un mouvement de trésorerie : elle s'écrit, se réécrit et s'efface seule ;
// une écriture validée qu'elle ne veut plus se contre-passe, et ce qu'elle veut dans une période validée s'écrit au
// premier jour encore ouvert (0018). Elle s'écrit telle que le client l'a tapée (ses comptes, ses libellés, ses montants),
// et seulement si elle tombe juste : l'écran la refuse déjà autrement (`odValide`), le serveur ne fait pas confiance.

import { createHash } from 'node:crypto';
import { requetes, type Transaction } from '../base.ts';
import { aVraimentChange, estJour, estObjet, exact, type ChangementLu } from '../v10/lecture.ts';
import { ecrireFamille, type EcritureAEcrire, type LigneAEcrire } from './ecrire.ts';

const JOURNAUX = ['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE'] as const;
type Journal = (typeof JOURNAUX)[number];

function identifiant(...parties: string[]): string {
  const h = createHash('sha256').update(parties.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export const familleDeLOperation = (entreprise: string, cle: string) => identifiant(entreprise, 'operation_diverse', cle);

const texte = (v: unknown) => (typeof v === 'string' ? v : '');

// L'écriture d'une opération (aucune si elle est illisible, sans libellé, sans deux lignes, ou si elle ne tombe pas juste).
// Les mêmes lignes que la v10 : une ligne au débit OU au crédit, son libellé, sinon celui de l'opération ; une ligne
// entièrement vide (ni compte ni montant) est ignorée, comme `odValide` l'ignore.
export function ecrituresDeLOperation(famille: string, o: unknown): EcritureAEcrire[] {
  if (!estObjet(o) || !estJour(o.date) || !Array.isArray(o.lignes)) return [];
  const intitule = texte(o.label);
  if (!intitule.trim()) return [];
  const lignes: LigneAEcrire[] = [];
  let debits = 0n, credits = 0n;
  for (const l of o.lignes) {
    if (!estObjet(l)) return [];
    const compte = texte(l.compte).trim();
    const debit = exact(l.debit ?? 0, 3), credit = exact(l.credit ?? 0, 3);
    if (debit === null || credit === null) return [];
    if (!compte && debit === 0n && credit === 0n) continue;
    if (!/^\d{1,12}$/.test(compte) || debit < 0n || credit < 0n || (debit > 0n) === (credit > 0n)) return [];
    lignes.push({ compte, libelle: (texte(l.label) || intitule).slice(0, 500), debit, credit, tauxTva: null });
    debits += debit; credits += credit;
  }
  if (lignes.length < 2 || debits !== credits) return [];
  const journal: Journal = (JOURNAUX as readonly string[]).includes(texte(o.journal)) ? (texte(o.journal) as Journal) : 'OD';
  return [{ journal, date: o.date as string, origineType: 'operation_diverse', origine: famille, piece: texte(o.piece) || null, tiers: null, libelle: intitule.slice(0, 500), lignes }];
}

async function ecrireLOperation(tx: Transaction, entreprise: string, cle: string, contenu: unknown) {
  const famille = familleDeLOperation(entreprise, cle);
  await ecrireFamille(tx, entreprise, famille, contenu === null ? [] : ecrituresDeLOperation(famille, contenu));
}

// Ce qu'un envoi change : les opérations touchées (ajoutées, modifiées, supprimées).
export async function suivreOperations(tx: Transaction, entreprise: string, changements: ChangementLu[]): Promise<void> {
  for (const c of changements) if (c.collection === 'ecrituresOD' && aVraimentChange(c)) await ecrireLOperation(tx, entreprise, c.cle, c.apres);
}

// Toutes les opérations du dossier : celles saisies avant 1.303.0 (le serveur ne les écrivait pas), ou une reprise.
export async function reecrireLesOperations(tx: Transaction, entreprise: string): Promise<number> {
  const toutes = await requetes(tx).selectFrom('socle.dossier_v10').select(['cle', 'contenu']).where('entreprise', '=', entreprise).where('collection', '=', 'ecrituresOD').execute();
  for (const o of toutes) await ecrireLOperation(tx, entreprise, o.cle, o.contenu);
  return toutes.length;
}
