// L'exercice et sa balance d'ouverture (brique 39 ; docs/cabinet.md, C16 et C17). Un exercice
// s'ouvre une fois, avec — ou sans, pour un client qui démarre — sa balance d'ouverture : une
// écriture du journal AN, posée et validée d'un geste dans la même transaction. La base refait
// chaque contrôle (compta.ouvrir_exercice, migration 0022) et garde qui peut : qui valide.

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { estJour, LIGNE, lignesVersLaBase } from './saisie.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';

const OUVRIR = z.object({
  annee: z.number().int().min(1900).max(2999),
  du: z.string().refine(estJour, { message: 'champ.jour' }).optional(),
  ouverture: z.array(LIGNE).max(5000).default([]),
}).strict();

export function routesExercice(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/exercices', geste: 'compta.livres.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // La clôture (brique 45) : quand, par qui (son nom), et chaque réouverture avec son motif.
      const lus = (await tx.query(`select x.annee, to_char(x.du, 'YYYY-MM-DD') du, to_char(x.au, 'YYYY-MM-DD') au, x.ouverture, x.clos_le,
          (select u.nom from socle.utilisateur u where u.id = x.clos_par) clos_par,
          coalesce((select jsonb_agg(jsonb_build_object('closLe', r.clos_le, 'le', r.rouvert_le, 'motif', r.motif,
              'par', (select u.nom from socle.utilisateur u where u.id = r.rouvert_par)) order by r.rouvert_le)
            from compta.reouverture r where r.entreprise = x.entreprise and r.annee = x.annee), '[]') reouvertures
        from compta.exercice x where x.entreprise = $1 order by x.annee`, [params.entreprise ?? ''])).rows;
      return {
        corps: {
          exercices: lus.map((x) => ({
            annee: Number(x.annee), du: x.du, au: x.au, ouverture: x.ouverture ?? null,
            closLe: x.clos_le ? (x.clos_le as Date).toISOString() : null, closPar: x.clos_par ?? null, reouvertures: x.reouvertures,
          })),
        },
      };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/exercices', geste: 'compta.ecritures.valider', corps: OUVRIR,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // Une ligne entièrement vide (ni compte ni montant) est une rangée laissée blanche à l'écran.
      const pleines = corps.ouverture.filter((l) => l.compte.trim() || (l.debit ?? '').trim() || (l.credit ?? '').trim());
      const r = lignesVersLaBase(pleines, 'ouverture');
      if ('statut' in r) return r;
      const du = corps.du ?? `${corps.annee}-01-01`;
      const o = (await tx.query('select * from compta.ouvrir_exercice($1, $2, $3::date, $4::jsonb)',
        [params.entreprise ?? '', corps.annee, du, JSON.stringify(r.lignes)])).rows[0] as { r_du: string; r_au: string; r_ouverture: string | null; r_numero: string | null };
      const jour = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
      return { statut: 201, corps: { annee: corps.annee, du: jour(o.r_du), au: jour(o.r_au), ouverture: o.r_ouverture, numero: o.r_numero } };
    },
  });
  // Clôturer l'exercice d'une année (brique 45, 0029) : la période validée jusqu'à son dernier jour.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/exercices/:annee/cloturer', geste: 'compta.exercice.cloturer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = Number(params.annee);
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2999) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'annee', raison: t('compta.champ.annee') }), champ: 'annee' } };
      const r = (await tx.query(`select to_char(compta.cloturer_exercice($1, $2), 'YYYY-MM-DD') jusqua`, [params.entreprise ?? '', annee])).rows[0];
      return { corps: { annee, jusqua: String(r.jusqua) } };
    },
  });
  // Le rouvrir, avec son motif.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/exercices/:annee/rouvrir', geste: 'compta.exercice.cloturer',
    corps: z.object({ motif: z.string().max(500) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = Number(params.annee);
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2999) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'annee', raison: t('compta.champ.annee') }), champ: 'annee' } };
      await tx.query('select compta.rouvrir_exercice($1, $2, $3)', [params.entreprise ?? '', annee, corps.motif]);
      return { corps: { annee } };
    },
  });
  return routes;
}
