// L'abonnement, lu par l'entreprise (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md) :
//   - son état, pour tous ceux qui y travaillent : la pastille de la barre, la carte de l'essai, et la création que
//     l'écran retient AVANT le geste quand l'entreprise est en lecture seule (la porte de la v10, `licenceBlock`) ;
//   - le détail, pour qui gère l'abonnement (le propriétaire, un administrateur) : l'état, les prix du jour, ce qui
//     est arrivé à l'abonnement (jamais le motif, qui est une note de SkanFact), et ses factures (14b, B5) : celles que
//     l'entreprise SkanFact lui a émises, telles qu'elles s'impriment, et « Payer en ligne » pour celle qui doit encore.
// Le serveur ne fait que LIRE ici, sauf la demande de paiement : l'état se déduit des faits et du jour
// (serveur/abonnement/etat.ts) ; le reste d'une facture, par les fonctions de toutes les factures.

import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { motif } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { demanderPaiementAbonnement } from '../v10/paiement.ts';
import { nettoyerClient, nettoyerSociete, vueDePiece, type PieceLue } from '../ventes/espace.ts';
import { etatAbonnement, type Etat } from './etat.ts';
import { faitsDe } from './condition.ts';
import { modulesFermesPourMoi } from './offre.ts';
import './textes.ts';

// Ce que la base rend des factures de l'abonné (plateforme.mes_factures_abonnement) : les pièces, et, s'il y en a, les
// deux fiches que la facture imprime et si l'entreprise SkanFact accepte le paiement en ligne.
type MesFactures = { entreprise?: unknown; client?: unknown; paiement?: boolean; pieces: (PieceLue & { periode: unknown })[] };

export function routesAbonnement(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement/etat', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, params.entreprise ?? '');
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      // Les modules que l'offre ne contient pas, pour la personne qui lit (14c) : l'écran les retient AVANT le geste.
      return { corps: { aujourdhui: jour, ...etat, fermes: await modulesFermesPourMoi(tx, params.entreprise ?? '', jour) } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement', geste: 'socle.abonnement.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, ent);
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      // Les prix hors taxes, en texte décimal (l'argent ne sort jamais en millimes bruts).
      const prix = ((await tx.query('select plateforme.prix_du_jour($1::date) p', [jour])).rows[0].p as { offre: string; periodicite: string; montantHt: string }[])
        .map((p) => ({ ...p, montantHt: versTexte(BigInt(p.montantHt), 3) }));
      const historique = (await tx.query('select plateforme.historique_abonnement($1) h', [ent])).rows[0].h as { le: string; nature: string; apres: unknown }[];
      // Ses factures : chaque pièce telle que son client la lit (les listes fermées de l'espace client), et la période
      // qu'elle paie. Sans facture émise, rien d'autre ne part (ni la fiche de l'entreprise SkanFact, ni la sienne).
      const lu = (await tx.query('select plateforme.mes_factures_abonnement($1) v', [ent])).rows[0].v as MesFactures;
      const factures = lu.pieces.length === 0 ? null : {
        entreprise: nettoyerSociete(lu.entreprise), client: nettoyerClient(lu.client),
        pieces: lu.pieces.map((p) => ({ ...vueDePiece(p, lu.paiement === true, jour), periode: lirePeriode(p.periode) })),
      };
      // `enLigne` : une facture de SkanFact se règle-t-elle en ligne (ce que dit « T'abonner », avant toute facture).
      return { corps: { aujourdhui: jour, etat, prix, historique, factures, enLigne: lu.paiement === true } };
    },
  });

  // Payer en ligne une facture de l'abonnement (14b, B5) : le reste, par le prestataire de l'entreprise SkanFact. Rend
  // l'adresse où l'on paie ; la page de retour de l'espace client dit ensuite ce que le prestataire a confirmé.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/abonnement/payer', geste: 'socle.abonnement.payer',
    corps: z.object({ numero: z.string().min(1).max(60) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const r = await demanderPaiementAbonnement(ctx, qui.utilisateur, ent, corps.numero);
      if (!r) return { statut: 404, corps: { motif: motif('abonnement.facture.inconnue') } };
      if ('refus' in r) return { statut: r.statut, corps: { motif: r.refus } };
      await tracer(tx, ent, 'socle.abonnement.payer', { type: 'facture_abonnement', id: null }, null, { numero: corps.numero });
      return { corps: { adresse: r.adresse } };
    },
  });

  return routes;
}

// La période qu'une facture paie, lue prudemment (ce que la base rend).
function lirePeriode(v: unknown): { debut: string; fin: string; offre: string; periodicite: string } | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const texte = (x: unknown) => (typeof x === 'string' ? x : '');
  return texte(o.debut) && texte(o.fin) ? { debut: texte(o.debut), fin: texte(o.fin), offre: texte(o.offre), periodicite: texte(o.periodicite) } : null;
}
