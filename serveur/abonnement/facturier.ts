// La facture au choix (1.119.0 ; 0171 ; docs/abonnement.md C21 ; docs/revue-abonnement.md, P1 4). Quand qui gère
// l'abonnement choisit son offre dans « Ton abonnement », sa facture se prépare ET s'émet d'elle-même, dans la minute
// (Skander, 22/10/2026 : sans attendre un humain) : au nom du propriétaire de l'entreprise SkanFact, comme une facture
// périodique émise seule (brique 129, serveur/v10/contrats.ts). Elle se prépare par la MÊME fonction que la console
// (preparerFacture : la période, le prix au premier jour, ce qui s'ajoute, la remise, le mois offert), se note par la
// jumelle de console_noter_facture (0113), qui revérifie les chiffres, puis s'émet par le serveur (le numéro de la série,
// les montants scellés) ; la signature et l'envoi à la TTN restent à une personne. Le tout dans UNE transaction : une
// émission refusée ne laisse ni brouillon ni facture notée.
//
// Un choix qui ne se facture pas (aucun prix pour l'offre, la fiche du client incomplète pour la facture électronique,
// une autre période déjà payée d'avance…) garde son motif : la console le lit dans « À décider », où sa facture se
// prépare à la main comme avant ; il se retente le lendemain.

import { motif as texteDe, rendre } from '../../textes/index.ts';
import { enTantQue, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { emettreDepuisV10 } from '../v10/dossier.ts';
import type { Json } from '../v10/lecture.ts';
import { lireFaits, type Offre, type Periodicite } from './etat.ts';
import { lireLignesEnPlus, periodeDeLaFacture, preparerFacture } from './factures.ts';
import { lireRemise } from './remise.ts';

type AFacturer = { entreprise: string; choix: string; proprietaire: string };
type PourFacture = {
  choix: { id: string; offre: Offre; periodicite: Periodicite };
  faits: Record<string, unknown>;
  abonne: { raisonSociale: string; matricule: string | null; email: string | null };
  factures: { client?: string; editeur?: string; piece?: string; moisOffert?: boolean }[];
};

// Facturer le choix qui attend d'UNE entreprise, dans la transaction du propriétaire de l'entreprise SkanFact. Rend le
// numéro de la facture émise, ou null quand aucun choix n'attend (facturé entre-temps : deux tours n'en font pas deux).
export async function facturerUnChoix(tx: Transaction, entreprise: string, utilisateur: string, jour: string): Promise<string | null> {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`facture-au-choix:${entreprise}`]);
  const lu = (await tx.query('select plateforme.choix_pour_facture($1) v', [entreprise])).rows[0]?.v as PourFacture | null;
  if (!lu) return null;
  const faits = lireFaits(lu.faits);
  const voulue = { offre: lu.choix.offre, periodicite: lu.choix.periodicite };
  const { debut } = periodeDeLaFacture(faits, voulue.periodicite, jour);
  const d = (await tx.query('select plateforme.choix_donnees($1, $2, $3, $4::date, $5::date) v', [entreprise, voulue.offre, voulue.periodicite, jour, debut])).rows[0]?.v as
    { prixHt?: unknown; enPlus?: unknown; remise?: unknown };
  const prix = typeof d.prixHt === 'string' && /^\d+$/.test(d.prixHt) ? BigInt(d.prixHt) : null;
  // Le motif ne sert qu'au geste de la console : la facture au choix n'en a pas (`au_choix` le dit).
  const facture = await preparerFacture(tx, utilisateur, { id: entreprise, ...lu.abonne }, faits, voulue, prix, jour,
    { apercu: false, motif: '' }, lireLignesEnPlus(d.enPlus), lireRemise(d.remise), {
      factures: lu.factures,
      noter: async (n) => {
        await tx.query('select plateforme.noter_facture_au_choix($1, $2, $3, $4, $5, $6::date, $7::date, $8::bigint, $9::date, $10)',
          [entreprise, n.cle, n.client, voulue.offre, voulue.periodicite, n.debut, n.fin, n.totalHt.toString(), jour, n.moisOffert]);
      },
    });
  const piece = (await tx.query("select contenu, revision from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2",
    [facture.editeur, facture.cle])).rows[0] as { contenu: Json; revision: string } | undefined;
  const client = (await tx.query("select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and cle = $2",
    [facture.editeur, facture.client])).rows[0]?.contenu as Json | undefined;
  if (!piece) throw new Refus('abonnement.facture.deja_preparee');
  const r = await emettreDepuisV10(tx, facture.editeur, utilisateur, { document: piece.contenu, client: client ?? null, revision: Number(piece.revision), rang: null, netAPayer: null });
  return String(r.numero);
}

// Le tour : chaque choix qui attend (ou celui d'une entreprise, juste après son choix), chacun dans sa transaction (un
// refus n'arrête pas les autres) ; le verrou de chaque entreprise garde deux tours de faire la même facture.
export async function facturerLesChoix(ctx: Contexte, o: { entreprise?: string; maintenant?: Date } = {}): Promise<{ choix: number; emises: number; refusees: number }> {
  const jour = aujourdhuiATunis(o.maintenant ?? ctx.maintenant?.() ?? new Date());
  const liste = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.choix_a_facturer($1) v', [o.entreprise ?? null])).rows[0].v as AFacturer[]);
  let emises = 0, refusees = 0;
  for (const a of liste) {
    try {
      if (await enTantQue(ctx.pool, a.proprietaire, (tx) => facturerUnChoix(tx, a.entreprise, a.proprietaire, jour))) emises++;
    } catch (e) {
      refusees++;
      // Un refus se dit tel quel à la console ; autre chose, sans détail (il se lit dans le journal du serveur).
      const motif = e instanceof Refus ? e.message : rendre(texteDe('commun.erreur_serveur'), 'fr');
      if (!(e instanceof Refus)) console.error(e);
      await enTantQue(ctx.pool, null, async (tx) => { await tx.query('select plateforme.choix_refus_noter($1, $2)', [a.choix, motif]); });
    }
  }
  return { choix: liste.length, emises, refusees };
}

// Juste après un choix, pour CETTE entreprise : le tour part sans attendre la minute (la transaction du choix est validée
// d'ici là ; sinon, le tour de la minute le prend). Seulement là où la facture au choix est branchée.
export function facturerBientot(ctx: Contexte, entreprise: string): void {
  if (!ctx.factureAuChoix) return;
  setTimeout(() => { facturerLesChoix(ctx, { entreprise }).catch((e: unknown) => { console.error(`la facture au choix n'est pas partie : ${String(e)}`); }); }, 400);
}
