// L'identité de l'entreprise suit sa fiche société (lot facture, 05/10/2026 ; docs/facture-details.md, D6 ; 0071). La
// raison sociale et le matricule fiscal que porte la fiche (`_racine/company` du dossier) SONT ceux de l'entreprise :
// quand une écriture de la fiche les change, le serveur les porte à l'entreprise, dans la même transaction (la liste des
// entreprises, le portefeuille du cabinet, la copie figée des pièces suivantes). Ils restaient ceux de la création.
// Le matricule s'y garde sous sa forme lisible (1234567A/A/M/000), quelle que soit la façon de l'écrire. Un matricule
// mal formé ne se porte pas : l'entreprise garde le sien, et l'écran le dit avant d'émettre (« un matricule fiscal
// valide »). Un matricule déjà porté par une autre entreprise se refuse, et rien n'est écrit (la base le dit).

import type { Transaction } from '../base.ts';
import { tracer } from '../trace.ts';
import { estObjet } from './lecture.ts';

// La forme gardée : sept chiffres, la lettre-clé, le code TVA, la catégorie et l'établissement (1234567A/A/M/000),
// comme la base l'accepte. Vide : null ; mal formé : undefined (ne se porte pas).
export function matriculeCanonique(v: unknown): string | null | undefined {
  const c = String(v ?? '').toUpperCase().replace(/[\s/.\-_]/g, '');
  if (!c) return null;
  return /^[0-9]{7}[A-Z]{3}[0-9]{3}$/.test(c) ? `${c.slice(0, 8)}/${c[8]}/${c[9]}/${c.slice(10)}` : undefined;
}

export async function suivreIdentite(tx: Transaction, entreprise: string, lus: { collection: string; cle: string; apres: unknown }[]) {
  const fiche = lus.find((l) => l.collection === '_racine' && l.cle === 'company')?.apres;
  if (!estObjet(fiche)) return;
  const lu = matriculeCanonique(fiche.matricule);
  const matricule = lu !== undefined ? lu
    : ((await tx.query('select matricule_fiscal m from socle.entreprise where id = $1', [entreprise])).rows[0]?.m as string | null | undefined) ?? null;
  const nom = String(fiche.name ?? '').trim();
  const avant = (await tx.query('select socle.porter_identite($1, $2, $3) avant', [entreprise, nom, matricule])).rows[0]?.avant as { raisonSociale: string } | null;
  if (avant) await tracer(tx, entreprise, 'socle.entreprise.identite', { type: 'entreprise', id: entreprise }, avant, { raisonSociale: nom || avant.raisonSociale, matriculeFiscal: matricule });
}
