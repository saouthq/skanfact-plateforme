// Les gestes de l'exploitation sur l'abonnement d'une entreprise (docs/abonnement.md ; skanfact docs/cadrage/10-console.md
// § 2.4) : prolonger un essai, noter un paiement reçu hors de la plateforme (sa facture faite ailleurs, son montant, son
// moyen, son jour : 0113), résilier (et l'annuler), suspendre (et reprendre), offrir (et le retirer), offrir un mois sur la
// prochaine facture, ouvrir et fermer un module acheté seul sur Essentiel (14c). Avec un compte d'administration, jamais par le serveur web : la console
// appellera les mêmes fonctions. Chaque geste demande un MOTIF et laisse son événement (plateforme.evenement_abonnement :
// quoi, quand, avant, après, pourquoi), qui ne se modifie pas et ne s'efface pas.
//
//   PG_ADMIN=… node base/abonnement.ts <entreprise> voir
//   PG_ADMIN=… node base/abonnement.ts <entreprise> prolonger <jours> "<motif>"
//   PG_ADMIN=… node base/abonnement.ts <entreprise> payer <essentiel|complet> <annuel|mensuel> <facture> <montant en dinars> <virement|cheque|especes> <AAAA-MM-JJ> "<motif>"
//   PG_ADMIN=… node base/abonnement.ts <entreprise> resilier|annuler-resiliation|suspendre|reprendre|offrir|retirer-offert|offrir-mois "<motif>"
//   PG_ADMIN=… node base/abonnement.ts <entreprise> ouvrir-module|fermer-module <paie|compta> "<motif>"
//
// Sur un serveur : exploitation/abonnement.sh, avec les mêmes arguments.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { aujourdhuiATunis } from '../serveur/reglements.ts';
import { etatAbonnement, jourEnFrancais, lireFaits, lireModules, type Etat, type Faits, type ModuleAchete, type Offre, type Periodicite } from '../serveur/abonnement/etat.ts';
import { calculerGeste, type DemandeAbonnement, type GesteAbonnement, type LigneAbonnement, type MoyenRecu } from '../serveur/abonnement/gestes.ts';
import { depuisTexte } from '../moteur/argent.ts';

type Client = pg.Client | pg.PoolClient;
export type Geste = GesteAbonnement;
const NATURE: Record<Geste, string> = {
  prolonger: 'essai_prolonge', payer: 'paye', resilier: 'resilie', 'annuler-resiliation': 'resiliation_annulee',
  suspendre: 'suspendu', reprendre: 'repris', offrir: 'offert', 'retirer-offert': 'offert_retire',
  'ouvrir-module': 'module_ouvert', 'fermer-module': 'module_ferme',
  'accorder-delai': 'delai_accorde', 'offrir-mois': 'mois_offert', 'changer-offre': 'offre_changee',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Ligne = LigneAbonnement;

// La ligne d'abonnement (null : l'entreprise n'en a pas, posée sans lui par une restauration dans une autre base, qui
// ne déclenche rien) et les faits que l'état lit.
async function lire(client: Client, entreprise: string, pourModifier: boolean): Promise<{ ligne: Ligne | null; faits: Faits }> {
  if (!UUID.test(entreprise)) throw new Error('l\'entreprise se désigne par son identifiant (8-4-4-4-12)');
  const e = (await client.query('select essai, tenue_par is not null tenu from socle.entreprise where id = $1', [entreprise])).rows[0];
  if (!e) throw new Error('cette entreprise n\'est pas dans cette base');
  const r = (await client.query(`select essai_jusqu_au::text, paye_jusqu_au::text, offre, periodicite, resilie_le::text, suspendu_le::text, offert, modules,
        delai_echeance::text, delai_jusqu_au::text, suivante_offre, suivante_periodicite, suivante_a_partir_du::text, mois_offerts, modules_a_retirer,
        a_venir_le::text, a_venir_offre, a_venir_periodicite, a_venir_retraits
      from plateforme.abonnement where entreprise = $1 ${pourModifier ? 'for update' : ''}`, [entreprise])).rows[0];
  const ligne: Ligne | null = r ? { essai_jusqu_au: r.essai_jusqu_au, paye_jusqu_au: r.paye_jusqu_au, offre: r.offre, periodicite: r.periodicite,
    resilie_le: r.resilie_le, suspendu_le: r.suspendu_le, offert: r.offert, modules: lireModules(r.modules),
    delai_echeance: r.delai_echeance, delai_jusqu_au: r.delai_jusqu_au, suivante_offre: r.suivante_offre, suivante_periodicite: r.suivante_periodicite,
    suivante_a_partir_du: r.suivante_a_partir_du, mois_offerts: r.mois_offerts, modules_a_retirer: lireModules(r.modules_a_retirer),
    a_venir_le: r.a_venir_le, a_venir_offre: r.a_venir_offre, a_venir_periodicite: r.a_venir_periodicite, a_venir_retraits: lireModules(r.a_venir_retraits) } : null;
  // Les mêmes faits que la porte (plateforme.faits_abonnement) : le délai d'une échéance, l'offre de la prochaine (0111), le
  // mois offert qui attend, les modules qui partent (0113).
  const faits = lireFaits({ connu: ligne !== null, essaiJusquAu: ligne?.essai_jusqu_au, payeJusquAu: ligne?.paye_jusqu_au, offre: ligne?.offre, periodicite: ligne?.periodicite,
    resilieLe: ligne?.resilie_le, suspenduLe: ligne?.suspendu_le, offert: ligne?.offert, bacASable: e.essai, tenuParCabinet: e.tenu, modules: ligne?.modules,
    delai: r?.delai_jusqu_au ? { echeance: r.delai_echeance, jusquAu: r.delai_jusqu_au } : null,
    offreSuivante: r?.suivante_offre ? { offre: r.suivante_offre, periodicite: r.suivante_periodicite, aPartirDu: r.suivante_a_partir_du } : null,
    moisOffert: (r?.mois_offerts ?? 0) > 0, modulesARetirer: r?.modules_a_retirer,
    aVenir: r?.a_venir_le ? { le: r.a_venir_le, offre: r.a_venir_offre, periodicite: r.a_venir_periodicite, retraits: r.a_venir_retraits } : null });
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
  module_ouvert: 'module acheté', module_ferme: 'module retiré',
  delai_accorde: 'délai accordé', mois_offert: 'mois offert', offre_changee: 'offre changée à la prochaine échéance',
  periode_commencee: 'période payée d\'avance commencée',
};

export type Demande = DemandeAbonnement;

// Un geste, dans une transaction : la ligne relue sous verrou, la nouvelle calculée par la règle commune
// (serveur/abonnement/gestes.ts, celle de la console), écrite, et l'événement posé. Rend l'état d'après.
export async function faire(client: Client, entreprise: string, d: Demande, jour = aujourdhuiATunis()): Promise<Etat> {
  if (d.motif.trim().length < 3) throw new Error('un geste sur un abonnement demande son motif (trois caractères au moins) : il reste dans son histoire');
  await client.query('begin');
  try {
    // Ce qui attendait son jour, s'il est venu, d'abord (0121) : le geste porte sur la ligne d'aujourd'hui.
    await client.query('select plateforme.basculer_abonnement($1, $2::date)', [entreprise, jour]);
    const lu = await lire(client, entreprise, true);
    const ligne: Ligne | null = lu.ligne;
    const { apres, details } = calculerGeste(ligne, lu.faits, d, jour);
    // La même facture ne paie pas deux périodes (0121), ici comme par la console.
    if (d.geste === 'payer' && d.paiement && (await client.query(`select 1 from plateforme.evenement_abonnement where entreprise = $1 and nature = 'paye'
        and lower(btrim(apres->>'facture')) = lower(btrim($2))`, [entreprise, d.paiement.facture])).rowCount) {
      throw new Error('ce paiement est déjà noté : la même facture ne paie pas deux périodes');
    }
    // Sans ligne, « prolonger » ouvre l'essai, à partir d'aujourd'hui.
    if (!ligne) await client.query('insert into plateforme.abonnement (entreprise, essai_jusqu_au) values ($1, $2)', [entreprise, apres.essai_jusqu_au]);
    await client.query(`update plateforme.abonnement set essai_jusqu_au = $2, paye_jusqu_au = $3, offre = $4, periodicite = $5, resilie_le = $6, suspendu_le = $7,
        offert = $8, modules = $9, delai_echeance = $10, delai_jusqu_au = $11, suivante_offre = $12, suivante_periodicite = $13, suivante_a_partir_du = $14,
        mois_offerts = $15, modules_a_retirer = $16, a_venir_le = $17, a_venir_offre = $18, a_venir_periodicite = $19, a_venir_retraits = $20,
        modifie_le = now() where entreprise = $1`,
      [entreprise, apres.essai_jusqu_au, apres.paye_jusqu_au, apres.offre, apres.periodicite, apres.resilie_le, apres.suspendu_le, apres.offert, apres.modules,
        apres.delai_echeance ?? null, apres.delai_jusqu_au ?? null, apres.suivante_offre ?? null, apres.suivante_periodicite ?? null, apres.suivante_a_partir_du ?? null,
        apres.mois_offerts ?? 0, apres.modules_a_retirer ?? [], apres.a_venir_le ?? null, apres.a_venir_offre ?? null, apres.a_venir_periodicite ?? null,
        apres.a_venir_retraits ?? []]);
    // Un paiement reçu est à l'entreprise SkanFact du jour (0113) : Paiements le compte dans son encaissé.
    await client.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres) values ($1, $2, 'exploitation', $3, $4,
        $5::jsonb || case when $2 = 'paye' then jsonb_build_object('editeur', (select d.entreprise from plateforme.editeur d)) else '{}'::jsonb end)`,
      [entreprise, lu.ligne ? NATURE[d.geste] : 'essai_commence', d.motif.trim(), lu.ligne ? JSON.stringify(ligne) : null, JSON.stringify({ ...apres, ...details })]);
    await client.query('commit');
    return (await voir(client, entreprise, jour)).etat;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

// Un montant tapé en dinars (« 2380 », « 2380,500 ») en millimes ; illisible : zéro, que le geste refuse.
const montantTape = (v: string): bigint => { try { return depuisTexte(v.replace(/\s/g, '').replace(',', '.'), 3); } catch { return 0n; } };

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
  const USAGE = 'PG_ADMIN=… node base/abonnement.ts <entreprise> voir | prolonger <jours> "<motif>"'
    + ' | payer <essentiel|complet> <annuel|mensuel> <facture> <montant en dinars> <virement|cheque|especes> <AAAA-MM-JJ> "<motif>"'
    + ' | resilier | annuler-resiliation | suspendre | reprendre | offrir | retirer-offert | offrir-mois "<motif>" | ouvrir-module|fermer-module <paie|compta> "<motif>"';
  const simples = ['resilier', 'annuler-resiliation', 'suspendre', 'reprendre', 'offrir', 'retirer-offert', 'offrir-mois'];
  const modules = ['ouvrir-module', 'fermer-module'];
  const valable = geste === 'voir' ? reste.length === 0 : geste === 'prolonger' || modules.includes(geste) ? reste.length === 2 : geste === 'payer' ? reste.length === 7
    : simples.includes(geste) && reste.length === 1;
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
        : geste === 'payer' ? { geste, offre: reste[0] as Offre, periodicite: reste[1] as Periodicite, motif: reste[6] ?? '',
          paiement: { facture: reste[2] ?? '', montant: montantTape(reste[3] ?? ''), moyen: reste[4] as MoyenRecu, le: reste[5] ?? '' } }
          : modules.includes(geste) ? { geste: geste as Geste, module: reste[0] as ModuleAchete, motif: reste[1] ?? '' }
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
