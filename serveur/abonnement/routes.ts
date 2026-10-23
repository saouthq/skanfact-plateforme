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
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { peut } from '../porte/porte.ts';
import { tracer } from '../trace.ts';
import { demanderPaiementAbonnement } from '../v10/paiement.ts';
import { nettoyerClient, nettoyerSociete, vueDePiece, type PieceLue } from '../ventes/espace.ts';
import { echeanceDe, estJour, etatAbonnement, graceDe, joursEntre, relancesDu, type Etat, type Faits } from './etat.ts';
import { faitsDe } from './condition.ts';
import { ceQueLOffreCompte, modulesFermes, modulesFermesPourMoi } from './offre.ts';
import { htDeLaPeriode, lireLignesEnPlus, periodeDeLaFacture } from './factures.ts';
import { aRenouveler } from '../console/renouvellements.ts';
import { lireRemise } from './remise.ts';
import './textes.ts';

// Ce que la base rend des factures de l'abonné (plateforme.mes_factures_abonnement) : les pièces, et, s'il y en a, les
// deux fiches que la facture imprime et si l'entreprise SkanFact accepte le paiement en ligne.
type MesFactures = { entreprise?: unknown; client?: unknown; paiement?: boolean; pieces: (PieceLue & { periode: unknown })[] };
// Ce que chaque offre comprend (0105) : les nombres du jour, et chaque changement préparé avec sa date. Sans motif ni
// auteur : ce sont des notes de SkanFact.
// Un nombre manque (null) quand aucune ligne ne vaut encore : l'écran ne le dit pas.
type ContenuDuJourLu = { caisses: number | null; etablissements: number | null; salaries: number | null; paie: number | null; compta: number | null };
type ContenuPourAbonne = {
  duJour: { essentiel: ContenuDuJourLu; complet: ContenuDuJourLu };
  aVenir: { offre: string; quoi: string; nombre: number; aPartirDu: string }[];
};

// Ce qui s'ajoute à l'offre (14c), au prix du jour, en texte décimal : lu AVANT d'arriver sur une facture.
const prixDesAjouts = async (tx: Transaction, jour: string) =>
  ((await tx.query('select plateforme.prix_options_du_jour($1::date) p', [jour])).rows[0].p as { option: string; periodicite: string; montantHt: string }[])
    .map((p) => ({ ...p, montantHt: versTexte(BigInt(p.montantHt), 3) }));

// Les règles de l'abonnement telles qu'elles valent pour CETTE entreprise (0104) : les relances du jour, la grâce de son
// échéance, et la durée de son essai (du jour où il a commencé à celui où il finissait alors). Aucune : rien (l'écran ne
// dit pas un nombre qu'il ne connaît pas).
function reglesPourMoi(f: Faits | null, historique: { le: string; nature: string; apres: unknown }[], jour: string) {
  const echeance = f ? echeanceDe(f) : null;
  const debut = historique.filter((h) => h.nature === 'essai_commence').sort((a, b) => (a.le < b.le ? -1 : 1))[0];
  const jusquAu = (debut?.apres as Record<string, unknown> | null)?.essaiJusquAu;
  const commence = debut ? aujourdhuiATunis(new Date(debut.le)) : null;
  return {
    relances: f ? relancesDu(f, jour) : [],
    grace: f && echeance ? graceDe(f, echeance) : null,
    essai: commence && estJour(jusquAu) && jusquAu > commence ? joursEntre(commence, jusquAu) : null,
  };
}

export function routesAbonnement(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement/etat', geste: 'socle.accueil.voir',
    traiter: async ({ params, qui }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, params.entreprise ?? '');
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      // `aFaire` (1.118.0 ; le bandeau de l'accueil) : quand une échéance approche ou est passée, ce qui attend qui gère
      // l'abonnement — une facture à régler (« payer »), ou un choix dont la facture se prépare (« attendre »). Rien pour
      // un autre rôle (la base ne lui rend ni factures ni choix), ni quand l'échéance est loin.
      const proche = etat.etat === 'en_retard' || etat.etat === 'lecture_seule' || (etat.etat === 'essai' && etat.jours <= 7) || (etat.etat === 'actif' && etat.jours <= 15);
      let aFaire: 'payer' | 'attendre' | null = null;
      // Seul qui gère l'abonnement le lit (la base refuse les factures à tout autre rôle : on ne lui demande pas).
      if (proche && qui && (await peut(tx, qui, params.entreprise ?? '', 'socle.abonnement.voir')).ok) {
        const lu = (await tx.query('select plateforme.mes_factures_abonnement($1) v', [params.entreprise ?? ''])).rows[0].v as MesFactures | null;
        const doit = (lu?.pieces ?? []).some((p) => { const v = vueDePiece(p, lu?.paiement === true, jour); return v.statut === 'a_payer' || v.statut === 'en_retard' || v.statut === 'partielle'; });
        aFaire = doit ? 'payer' : lireChoix((await tx.query('select plateforme.mon_offre_choisie($1) c', [params.entreprise ?? ''])).rows[0]?.c) ? 'attendre' : null;
      }
      // Les modules que l'offre ne contient pas, pour la personne qui lit (14c) : l'écran les retient AVANT le geste.
      return { corps: { aujourdhui: jour, ...etat, aFaire, fermes: await modulesFermesPourMoi(tx, params.entreprise ?? '', jour) } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement', geste: 'socle.abonnement.voir',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, ent);
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      // Les prix hors taxes, en texte décimal (l'argent ne sort jamais en millimes bruts).
      const prix = ((await tx.query('select plateforme.prix_du_jour($1::date) p', [jour])).rows[0].p as { offre: string; periodicite: string; montantHt: string }[])
        .map((p) => ({ ...p, montantHt: versTexte(BigInt(p.montantHt), 3) }));
      const options = await prixDesAjouts(tx, jour);
      // Les prix à venir (0103), des offres et de ce qui s'ajoute : l'abonné les lit dès qu'ils sont préparés.
      const aVenir = ((await tx.query('select plateforme.prix_a_venir($1::date) p', [jour])).rows[0].p as { quoi: string; periodicite: string; aPartirDu: string; montantHt: string }[])
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
      // `modules` : ceux achetés seuls sur Essentiel (14c), que la carte de l'offre dit.
      // `compte` : ce que l'entreprise utilise sur ce que son offre comprend (14c, 0100), comme la facture le comptera.
      // `regles` : les relances, la grâce et la durée de l'essai qui valent pour elle (0104), que l'onglet dit.
      // `contenu` : ce que chaque offre comprend aujourd'hui, et ce qui changera à une date (0105), que les cartes disent.
      // `fermes` : les modules que son abonnement ne contient pas (la même fonction que la porte), que la carte de son
      // offre dit.
      const contenu = (await tx.query('select plateforme.contenu_offres_pour_abonne($1::date) c', [jour])).rows[0].c as ContenuPourAbonne;
      // `remise` : celle de sa prochaine période (0106 : son groupe, ou son cabinet la première année), la plus forte, que
      // l'onglet dit avec sa raison ; rien pour qui ne gère pas l'abonnement (la base ne rend rien).
      const prochaine = f ? periodeDeLaFacture(f, f.periodicite ?? 'annuel', jour).debut : null;
      const remise = prochaine ? lireRemise((await tx.query('select plateforme.ma_remise($1, $2::date) r', [ent, prochaine])).rows[0]?.r) : null;
      // `choix` (1.84.0, 0158) : l'offre qu'elle a choisie ici et dont la facture n'est pas encore préparée ;
      // `peutChoisir` : qui peut payer l'abonnement le choisit (la propriétaire, l'administratrice ; les textes des refus le
      // disent).
      const choix = lireChoix((await tx.query('select plateforme.mon_offre_choisie($1) c', [ent])).rows[0]?.c);
      const peutChoisir = (await peut(tx, qui, ent, 'socle.abonnement.payer')).ok;
      // `prochaine` (1.118.0, 0170) : ce que dira la prochaine facture d'un abonnement qui se renouvelle, par la règle de
      // la facture et de la console (aRenouveler, htDeLaPeriode) ; rien quand un prix manque (rien ne s'invente).
      const r = f ? aRenouveler({ id: ent, etat, faits: f }, jour) : null;
      const brutProchaine = r ? (await tx.query('select plateforme.ma_prochaine_facture($1, $2, $3, $4::date, $5::date) v', [ent, r.offre, r.periodicite, jour, r.debut])).rows[0]?.v as
        { prixHt?: unknown; enPlus?: unknown; remise?: unknown } | null : null;
      const prixProchaine = typeof brutProchaine?.prixHt === 'string' && /^\d+$/.test(brutProchaine.prixHt) ? BigInt(brutProchaine.prixHt) : null;
      const remiseProchaine = r ? lireRemise(brutProchaine?.remise) : null;
      const prochaineFacture = r && prixProchaine !== null ? { debut: r.debut, offre: r.offre, periodicite: r.periodicite,
        montantHt: versTexte(htDeLaPeriode(prixProchaine, lireLignesEnPlus(brutProchaine?.enPlus), remiseProchaine), 3), remise: remiseProchaine?.taux ?? null } : null;
      // `rappels` (1.118.0, 0170) : les rappels déjà partis pour l'échéance qui vient, avec leur jour.
      const echeance = f ? echeanceDe(f) : null;
      const rappels = echeance ? ((await tx.query('select plateforme.mes_rappels($1, $2::date) v', [ent, echeance])).rows[0]?.v as { rang: string; le: string }[] ?? [])
        .map((x) => ({ rang: x.rang, le: aujourdhuiATunis(new Date(x.le)) })) : [];
      return { corps: { aujourdhui: jour, etat, prix, options, aVenir, historique, factures, enLigne: lu.paiement === true, modules: f?.modules ?? [], choix, peutChoisir,
        prochaine: prochaineFacture, rappels,
        compte: await ceQueLOffreCompte(tx, ent, jour), regles: reglesPourMoi(f, historique, jour), contenu, fermes: modulesFermes(f, jour),
        remise: remise ? { nature: remise.nature, taux: remise.taux, groupe: remise.groupe, cabinet: remise.cabinet, jusquAu: remise.jusquAu } : null } };
    },
  });

  // Choisir son offre (1.84.0 ; docs/abonnement.md C19 ; 0158) : la propriétaire dit l'offre et la périodicité qu'elle
  // veut ; la console la voit dans « À décider » et prépare la facture sur elle. Rien n'est payé ni changé ici. Refusé
  // quand une facture de l'abonnement attend déjà son paiement (la régler d'abord), ou sans abonnement à choisir.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/abonnement/choisir', geste: 'socle.abonnement.payer',
    corps: z.object({ offre: z.enum(['essentiel', 'complet']), periodicite: z.enum(['annuel', 'mensuel']) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, ent);
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      if (etat.etat === 'hors') return { statut: 403, corps: { motif: motif('abonnement.choix.hors') } };
      const lu = (await tx.query('select plateforme.mes_factures_abonnement($1) v', [ent])).rows[0].v as MesFactures;
      const doit = lu.pieces.map((p) => vueDePiece(p, lu.paiement === true, jour)).find((p) => p.statut === 'a_payer' || p.statut === 'en_retard' || p.statut === 'partielle');
      if (doit) return { statut: 409, corps: { motif: motif('abonnement.choix.facture_a_payer', { numero: String(doit.numero ?? '') }) } };
      const choix = lireChoix((await tx.query('select plateforme.choisir_mon_offre($1, $2, $3) c', [ent, corps.offre, corps.periodicite])).rows[0]?.c);
      await tracer(tx, ent, 'socle.abonnement.payer', { type: 'abonnement', id: null }, null, { choix: true, offre: corps.offre, periodicite: corps.periodicite });
      return { statut: 201, corps: { choix } };
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

// Le choix qui attend sa facture (0158), lu prudemment : rien plutôt qu'un choix deviné.
export type Choix = { offre: 'essentiel' | 'complet'; periodicite: 'annuel' | 'mensuel'; le: string; par: string | null };
export function lireChoix(v: unknown): Choix | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if ((o.offre !== 'essentiel' && o.offre !== 'complet') || (o.periodicite !== 'annuel' && o.periodicite !== 'mensuel') || typeof o.le !== 'string') return null;
  return { offre: o.offre, periodicite: o.periodicite, le: o.le, par: typeof o.par === 'string' ? o.par : null };
}

// La période qu'une facture paie, lue prudemment (ce que la base rend).
function lirePeriode(v: unknown): { debut: string; fin: string; offre: string; periodicite: string } | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const texte = (x: unknown) => (typeof x === 'string' ? x : '');
  return texte(o.debut) && texte(o.fin) ? { debut: texte(o.debut), fin: texte(o.fin), offre: texte(o.offre), periodicite: texte(o.periodicite) } : null;
}
