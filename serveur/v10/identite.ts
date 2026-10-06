// L'identité de l'entreprise suit sa fiche société (lot facture, 05/10/2026 ; docs/facture-details.md, D6 ; 0071). La
// raison sociale et le matricule fiscal que porte la fiche (`_racine/company` du dossier) SONT ceux de l'entreprise :
// quand une écriture de la fiche les change, le serveur les porte à l'entreprise, dans la même transaction (la liste des
// entreprises, le portefeuille du cabinet, la copie figée des pièces suivantes). Ils restaient ceux de la création.
// Le matricule s'y garde sous sa forme lisible (1234567A/A/M/000), quelle que soit la façon de l'écrire. Un matricule
// mal formé ne se porte pas : l'entreprise garde le sien, et l'écran le dit avant d'émettre (« un matricule fiscal
// valide »). Un matricule déjà porté par une autre entreprise se refuse, et rien n'est écrit (la base le dit).

import type { Transaction } from '../base.ts';
// La forme gardée, la même à chaque entrée d'un matricule (serveur/matricule.ts) : mal formé, il ne se porte pas.
import { matriculeCanonique } from '../matricule.ts';
import { tracer } from '../trace.ts';
import { estObjet } from './lecture.ts';

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
