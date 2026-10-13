// Les gestes de l'exploitation sur l'abonnement d'une entreprise (docs/abonnement.md ; skanfact docs/cadrage/10-console.md
// § 2.4) : prolonger un essai, noter un paiement reçu par virement ou par chèque, résilier (et l'annuler), suspendre
// (et reprendre), offrir (et le retirer). Avec un compte d'administration, jamais par le serveur web : la console
// appellera les mêmes fonctions. Chaque geste demande un MOTIF et laisse son événement (plateforme.evenement_abonnement :
// quoi, quand, avant, après, pourquoi), qui ne se modifie pas et ne s'efface pas.
//
//   PG_ADMIN=… node base/abonnement.ts <entreprise> voir
//   PG_ADMIN=… node base/abonnement.ts <entreprise> prolonger <jours> "<motif>"
//   PG_ADMIN=… node base/abonnement.ts <entreprise> payer <essentiel|complet> <annuel|mensuel> "<motif>"
//   PG_ADMIN=… node base/abonnement.ts <entreprise> resilier|annuler-resiliation|suspendre|reprendre|offrir|retirer-offert "<motif>"
//
// Sur un serveur : exploitation/abonnement.sh, avec les mêmes arguments.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { aujourdhuiATunis } from '../serveur/reglements.ts';
import { etatAbonnement, jourEnFrancais, lireFaits, type Etat, type Faits, type Offre, type Periodicite } from '../serveur/abonnement/etat.ts';
import { calculerGeste, type DemandeAbonnement, type GesteAbonnement, type LigneAbonnement } from '../serveur/abonnement/gestes.ts';

type Client = pg.Client | pg.PoolClient;
export type Geste = GesteAbonnement;
const NATURE: Record<Geste, string> = {
  prolonger: 'essai_prolonge', payer: 'paye', resilier: 'resilie', 'annuler-resiliation': 'resiliation_annulee',
  suspendre: 'suspendu', reprendre: 'repris', offrir: 'offert', 'retirer-offert': 'offert_retire',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Ligne = LigneAbonnement;

// La ligne d'abonnement (null : l'entreprise n'en a pas, posée sans lui par une restauration dans une autre base, qui
// ne déclenche rien) et les faits que l'état lit.
async function lire(client: Client, entreprise: string, pourModifier: boolean): Promise<{ ligne: Ligne | null; faits: Faits }> {
  if (!UUID.test(entreprise)) throw new Error('l\'entreprise se désigne par son identifiant (8-4-4-4-12)');
  const e = (await client.query('select essai, tenue_par is not null tenu from socle.entreprise where id = $1', [entreprise])).rows[0];
  if (!e) throw new Error('cette entreprise n\'est pas dans cette base');
  const r = (await client.query(`select essai_jusqu_au::text, paye_jusqu_au::text, offre, periodicite, resilie_le::text, suspendu_le::text, offert
      from plateforme.abonnement where entreprise = $1 ${pourModifier ? 'for update' : ''}`, [entreprise])).rows[0];
  const ligne: Ligne | null = r ? { essai_jusqu_au: r.essai_jusqu_au, paye_jusqu_au: r.paye_jusqu_au, offre: r.offre, periodicite: r.periodicite,
    resilie_le: r.resilie_le, suspendu_le: r.suspendu_le, offert: r.offert } : null;
  const faits = lireFaits({ connu: ligne !== null, essaiJusquAu: ligne?.essai_jusqu_au, payeJusquAu: ligne?.paye_jusqu_au, offre: ligne?.offre, periodicite: ligne?.periodicite,
    resilieLe: ligne?.resilie_le, suspenduLe: ligne?.suspendu_le, offert: ligne?.offert, bacASable: e.essai, tenuParCabinet: e.tenu });
  return { ligne, faits };
}

// Ce que l'exploitation voit : les faits, l'état d'aujourd'hui, et ce qui est arrivé (motif compris : c'est sa note).
export async function voir(client: Client, entreprise: string, jour = aujourdhuiATunis()): Promise<{ faits: Faits; etat: Etat; evenements: { le: string; nature: string; par: string; motif: string | null }[] }> {
  const { faits } = await lire(client, entreprise, false);
  // L'heure de Tunis, comme on la lit : 12/10/2026 18:34.
  const evenements = (await client.query(`select to_char(le at time zone 'Africa/Tunis', 'DD/MM/YYYY HH24:MI') as le, nature, par, motif
    from plateforme.evenement_abonnement where entreprise = $1 order by evenement_abonnement.le, id`, [entreprise])).rows;
  return { faits, etat: etatAbonnement(faits, jour), evenements };
}

// Ce qu'un événement a fait, en mots (l'histoire que `voir` affiche).
const NATURES: Record<string, string> = {
  essai_commence: 'essai commencé', essai_prolonge: 'essai prolongé', paye: 'paiement noté', resilie: 'résilié',
  resiliation_annulee: 'résiliation annulée', suspendu: 'suspendu', repris: 'repris', offert: 'offert', offert_retire: 'plus offert',
};

export type Demande = DemandeAbonnement;

// Un geste, dans une transaction : la ligne relue sous verrou, la nouvelle calculée par la règle commune
// (serveur/abonnement/gestes.ts, celle de la console), écrite, et l'événement posé. Rend l'état d'après.
export async function faire(client: Client, entreprise: string, d: Demande, jour = aujourdhuiATunis()): Promise<Etat> {
  if (d.motif.trim().length < 3) throw new Error('un geste sur un abonnement demande son motif (trois caractères au moins) : il reste dans son histoire');
  await client.query('begin');
  try {
    const lu = await lire(client, entreprise, true);
    const ligne: Ligne | null = lu.ligne;
    const { apres, details } = calculerGeste(ligne, lu.faits, d, jour);
    // Sans ligne, « prolonger » ouvre l'essai, à partir d'aujourd'hui.
    if (!ligne) await client.query('insert into plateforme.abonnement (entreprise, essai_jusqu_au) values ($1, $2)', [entreprise, apres.essai_jusqu_au]);
    await client.query(`update plateforme.abonnement set essai_jusqu_au = $2, paye_jusqu_au = $3, offre = $4, periodicite = $5, resilie_le = $6, suspendu_le = $7,
        offert = $8, modifie_le = now() where entreprise = $1`,
      [entreprise, apres.essai_jusqu_au, apres.paye_jusqu_au, apres.offre, apres.periodicite, apres.resilie_le, apres.suspendu_le, apres.offert]);
    await client.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres) values ($1, $2, 'exploitation', $3, $4, $5)`,
      [entreprise, lu.ligne ? NATURE[d.geste] : 'essai_commence', d.motif.trim(), lu.ligne ? JSON.stringify(ligne) : null, JSON.stringify({ ...apres, ...details })]);
    await client.query('commit');
    return (await voir(client, entreprise, jour)).etat;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const resteJours = (n: number) => (n <= 0 ? 'dernier jour' : `encore ${n} jour${n > 1 ? 's' : ''}`);
// L'état, en une phrase pour l'exploitation.
export function phrase(e: Etat): string {
  switch (e.etat) {
    case 'hors': return { bac_a_sable: 'Entreprise d\'essai d\'un développeur : jamais d\'échéance.', tenu_par_cabinet: 'Dossier tenu par un cabinet : c\'est le cabinet qui le paie.',
      offert: 'Abonnement offert : jamais d\'échéance.', inconnu: 'Pas d\'abonnement connu : rien ne se ferme.' }[e.raison];
    case 'essai': return `Essai jusqu'au ${jourEnFrancais(e.jusquAu)} (${resteJours(e.jours)}).`;
    case 'actif': return `${e.offre === 'complet' ? 'Complet' : 'Essentiel'} ${e.periodicite}, payé jusqu'au ${jourEnFrancais(e.jusquAu)} (${resteJours(e.jours)})${e.resilie ? ', résilié : il s\'arrêtera là' : ''}.`;
    case 'en_retard': return `Échéance passée (${jourEnFrancais(e.echeance)}) : en grâce, lecture seule le ${jourEnFrancais(e.lectureSeuleLe)}.`;
    case 'lecture_seule': return `Lecture seule depuis le ${jourEnFrancais(e.depuis)} (${{ essai_termine: 'essai terminé', non_renouvele: 'non renouvelé', resilie: 'résilié', suspendu: 'suspendu' }[e.raison]}).`;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [entreprise = '', geste = '', ...reste] = process.argv.slice(2);
  const adresse = process.env.PG_ADMIN;
  const USAGE = 'PG_ADMIN=… node base/abonnement.ts <entreprise> voir | prolonger <jours> "<motif>" | payer <essentiel|complet> <annuel|mensuel> "<motif>"'
    + ' | resilier | annuler-resiliation | suspendre | reprendre | offrir | retirer-offert "<motif>"';
  const simples = ['resilier', 'annuler-resiliation', 'suspendre', 'reprendre', 'offrir', 'retirer-offert'];
  const valable = geste === 'voir' ? reste.length === 0 : geste === 'prolonger' ? reste.length === 2 : geste === 'payer' ? reste.length === 3 : simples.includes(geste) && reste.length === 1;
  if (!adresse || !valable) { console.error(USAGE); process.exit(1); }
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  try {
    if (geste === 'voir') {
      const v = await voir(client, entreprise);
      console.log(phrase(v.etat));
      for (const e of v.evenements) console.log(`  ${e.le}  ${NATURES[e.nature] ?? e.nature} (${e.par === 'systeme' ? 'SkanFact' : 'exploitation'})${e.motif ? ` : ${e.motif}` : ''}`);
    } else {
      const d: Demande = geste === 'prolonger' ? { geste, jours: Number(reste[0]), motif: reste[1] ?? '' }
        : geste === 'payer' ? { geste, offre: reste[0] as Offre, periodicite: reste[1] as Periodicite, motif: reste[2] ?? '' }
          : { geste: geste as Geste, motif: reste[0] ?? '' };
      console.log(`Fait. ${phrase(await faire(client, entreprise, d))}`);
    }
  } catch (e) {
    console.error(`Refusé : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
