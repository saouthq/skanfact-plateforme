// Les réglages à distance (pilotage depuis la console, point 7 ; base 0232). Quelques chiffres du serveur se changent depuis
// la console, sans nouvelle version. La LISTE de ce qui se règle vit ici, avec ses bornes et sa valeur d'origine : la base
// ne garde que ce que le titulaire a changé, et une clé qu'on n'a pas déclarée ici n'existe pas (la route la refuse).
//
// Chaque réglage est BRANCHÉ là où il sert (un réglage affiché qui ne changerait rien serait un mensonge) :
//   - les limites d'appels de l'entrée (routes sans session, par adresse) et de l'API (par clé) : serveur/app.ts ;
//   - la durée du lien « mot de passe oublié » et celle du code reçu par e-mail : serveur/connexion.ts.
// Relus au plus toutes les dix secondes ; les gestes de la console les oublient tout de suite. La base illisible : chaque
// réglage garde sa valeur d'origine.

import { z } from 'zod';
import type { Route } from './app.ts';
import { enTantQue, type Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';
import { LIMITES_PAR_ADRESSE, LIMITES_PAR_DEFAUT, type Limiteur } from './limites.ts';
import { motif } from '../textes/index.ts';
import './reglages-distants/textes.ts';

export type Famille = 'limites' | 'delais';
export type Unite = 'appels' | 'appels_par_seconde' | 'appels_par_minute' | 'minutes';
export type Reglage = { cle: string; famille: Famille; defaut: number; min: number; max: number; unite: Unite };

// Dans l'ordre de l'écran. Les valeurs d'origine sont celles du code (limites.ts, connexion.ts) : un test les confronte.
export const REGLAGES_DISTANTS: readonly Reglage[] = [
  { cle: 'entree.rafale', famille: 'limites', defaut: LIMITES_PAR_ADRESSE.capacite, min: 10, max: 600, unite: 'appels' },
  { cle: 'entree.par_seconde', famille: 'limites', defaut: LIMITES_PAR_ADRESSE.parSeconde, min: 1, max: 20, unite: 'appels_par_seconde' },
  { cle: 'api.par_minute', famille: 'limites', defaut: LIMITES_PAR_DEFAUT.parSeconde * 60, min: 60, max: 6000, unite: 'appels_par_minute' },
  { cle: 'api.rafale', famille: 'limites', defaut: LIMITES_PAR_DEFAUT.capacite, min: 10, max: 600, unite: 'appels' },
  { cle: 'connexion.lien_minutes', famille: 'delais', defaut: 30, min: 10, max: 240, unite: 'minutes' },
  { cle: 'connexion.code_minutes', famille: 'delais', defaut: 15, min: 5, max: 60, unite: 'minutes' },
];
const PAR_CLE = new Map(REGLAGES_DISTANTS.map((r) => [r.cle, r]));
export type CleReglage = 'entree.rafale' | 'entree.par_seconde' | 'api.par_minute' | 'api.rafale' | 'connexion.lien_minutes' | 'connexion.code_minutes';

const RELIRE_MS = 10_000;
let gardes: { le: number; valeurs: Map<string, number> } | null = null;
export const oublierLesReglagesDistants = () => { gardes = null; };

// Les réglages CHANGÉS (et eux seuls) : une clé absente garde sa valeur d'origine.
export async function reglagesChanges(ctx: Contexte): Promise<Map<string, number>> {
  const ici = Date.now();
  if (gardes && ici - gardes.le < RELIRE_MS) return gardes.valeurs;
  const valeurs = new Map<string, number>();
  try {
    const v = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.reglages_distants_en_vigueur() v')).rows[0]?.v) as Record<string, unknown> | null;
    for (const [cle, x] of Object.entries(v ?? {})) {
      const r = PAR_CLE.get(cle), n = Number(x);
      // Une valeur hors de ses bornes (les bornes ont changé depuis) ne s'applique pas : la valeur d'origine vaut.
      if (r && Number.isFinite(n) && n >= r.min && n <= r.max) valeurs.set(cle, n);
    }
  } catch { /* la base illisible : les valeurs d'origine */ }
  gardes = { le: ici, valeurs };
  return valeurs;
}

export async function valeurReglage(ctx: Contexte, cle: CleReglage): Promise<number> {
  return (await reglagesChanges(ctx)).get(cle) ?? (PAR_CLE.get(cle)?.defaut as number);
}

// Les limites d'appels, réglées avant chaque appel limité. Seules les valeurs CHANGÉES s'appliquent : un limiteur posé par
// un essai (ses propres chiffres) reste tel quel tant que rien n'est changé dans la console, et y revient quand on
// ramène le réglage à son origine.
export async function reglerLesLimites(ctx: Contexte, entree: Limiteur, api: Limiteur): Promise<void> {
  const v = await reglagesChanges(ctx);
  if (v.has('entree.rafale') || v.has('entree.par_seconde')) {
    entree.regler({ capacite: v.get('entree.rafale') ?? LIMITES_PAR_ADRESSE.capacite, parSeconde: v.get('entree.par_seconde') ?? LIMITES_PAR_ADRESSE.parSeconde });
  } else entree.revenir();
  if (v.has('api.rafale') || v.has('api.par_minute')) {
    api.regler({ capacite: v.get('api.rafale') ?? LIMITES_PAR_DEFAUT.capacite, parSeconde: (v.get('api.par_minute') ?? LIMITES_PAR_DEFAUT.parSeconde * 60) / 60 });
  } else api.revenir();
}

// Les routes de la console : lire (la liste, ce qui est changé, l'historique), changer, revenir à la valeur d'origine.
export function routesReglagesDistants(ctx: Contexte): Route<never>[] {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const transaction = (tx: Transaction | null): Transaction => { if (!tx) throw new Error('transaction attendue'); return tx; };
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'GET', chemin: '/console/reglages-distants', geste: 'console.reglages_distants.voir',
    traiter: async (_, tx) => ({ corps: { ...(await transaction(tx).query('select plateforme.console_reglages_distants() v')).rows[0]?.v, reglages: REGLAGES_DISTANTS } }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages-distants', geste: 'console.reglages_distants.poser',
    corps: z.object({ cle: z.string().max(80), valeur: z.number().int().nullable(), motif: z.string().max(500) }),
    traiter: async ({ corps }, tx) => {
      const r = PAR_CLE.get(corps.cle);
      if (!r) return { statut: 404, corps: { motif: motif('reglages_distants.inconnu') } };
      await transaction(tx).query('select plateforme.console_poser_reglage_distant($1, $2, $3, $4, $5, $6)', [r.cle, corps.valeur, r.min, r.max, corps.motif, maintenant()]);
      oublierLesReglagesDistants();
      return { corps: { cle: r.cle, valeur: corps.valeur ?? r.defaut, origine: corps.valeur === null } };
    },
  });
  return routes;
}
