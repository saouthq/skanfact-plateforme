// La liasse et le résultat fiscal de l'année (brique 41 ter ; docs/cabinet.md, C26 et C27). La liasse
// se calcule dans le navigateur, par la v10, sur le livre du serveur ; le serveur garde, par année, ce
// qui se saisit : les retraitements (montants en millimes, toujours positifs) et le taux d'impôt (un
// entier à six décimales, ou rien). La base refait chaque contrôle (compta.poser_annuel, 0025).

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';

const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const RETRAITEMENT = z.object({
  id: z.string().max(60).default(''),
  nature: z.enum(['reintegration', 'deduction', 'deficit', 'amortissement']),
  libelle: z.string().max(200),
  montant: z.string().max(30),
}).strict();
const POSER = z.object({
  retraitements: z.array(RETRAITEMENT).max(200).optional(),
  tauxImpot: z.string().max(12).nullable().optional(),
  revision: z.number().int().positive().nullable(),
}).strict();

// L'année d'une adresse, ou null.
const anneeDe = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1900 && n <= 2999 ? n : null; };
// 25 % ↔ 250000 : un taux est un entier à six décimales (0004), le pourcentage en a donc quatre.
const tauxEnTexte = (v: string | number | null) => (v === null ? null : versTexte(BigInt(v), 4).replace(/\.?0+$/, ''));

export function routesAnnuel(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const lire = async (tx: NonNullable<Parameters<Route['traiter']>[1]>, entreprise: string, annee: number) =>
    (await tx.query('select retraitements, taux_impot, revision from compta.annuel where entreprise = $1 and annee = $2', [entreprise, annee])).rows[0] as
      { retraitements: { id: string; nature: string; libelle: string; montant: number }[]; taux_impot: string | null; revision: string } | undefined;

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/annuel/:annee', geste: 'compta.livres.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const a = await lire(tx, params.entreprise ?? '', annee);
      return {
        corps: {
          retraitements: (a?.retraitements ?? []).map((r) => ({ id: r.id, nature: r.nature, libelle: r.libelle, montant: versTexte(BigInt(r.montant), 3) })),
          tauxImpot: tauxEnTexte(a?.taux_impot ?? null),
          revision: a ? Number(a.revision) : null,
        },
      };
    },
  });

  // Poser les retraitements, le taux, ou les deux (ce qui n'est pas envoyé ne change pas).
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/annuel/:annee', geste: 'compta.liasse.preparer', corps: POSER,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const avant = await lire(tx, params.entreprise ?? '', annee);
      let retraitements = avant?.retraitements ?? [];
      if (corps.retraitements) {
        retraitements = [];
        for (const [i, r] of corps.retraitements.entries()) {
          let m: bigint;
          try { m = depuisTexte(r.montant, 3); } catch { return champInvalide(`retraitements.${i}.montant`, t('compta.champ.montant')); }
          retraitements.push({ id: r.id, nature: r.nature, libelle: r.libelle.trim(), montant: Number(m) });
        }
      }
      let taux = avant?.taux_impot ?? null;
      if (corps.tauxImpot !== undefined) {
        const brut = (corps.tauxImpot ?? '').trim();
        if (!brut) taux = null;
        else {
          try { taux = depuisTexte(brut, 4).toString(); } catch { return champInvalide('tauxImpot', t('compta.champ.taux')); }
        }
      }
      const r = (await tx.query('select compta.poser_annuel($1, $2, $3::jsonb, $4::bigint, $5::bigint) revision',
        [params.entreprise ?? '', annee, JSON.stringify(retraitements), taux, corps.revision])).rows[0];
      return { corps: { revision: Number(r.revision) } };
    },
  });

  return routes;
}
