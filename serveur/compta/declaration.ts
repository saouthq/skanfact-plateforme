// La déclaration du mois (brique 41 ; docs/cabinet.md, C22 à C24). Le calcul est celui de la v10, sur
// le livre du serveur, dans le navigateur ; ici, ce que le serveur garde : la déclaration préparée
// (ses cases en millimes, ou vides quand elles ne se savent pas), ses deux pense-bêtes (déposée,
// payée), et l'écriture du mois, qui entre au brouillard par la saisie. Chaque route lit le corps et
// appelle la base, qui refait chaque contrôle (compta.poser_declaration…, migration 0024).

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { ECRITURE, estJour, versLaBase } from './saisie.ts';
import './textes.ts';

const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const estPeriode = (v: string | undefined) => v !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// Les cases de la v10 (compta.js, LIBELLES_CASES_DECL) : la base refuse toute autre.
const CASES = ['tvaCollectee', 'tvaDeductible', 'creditReporte', 'netAPayer', 'creditAReporter', 'timbre', 'retenuesOperees',
  'retenuesSubies', 'irpp', 'aDecaisser', 'tfp', 'foprolos', 'tcl', 'acomptes'] as const;
const PREPARER = z.object({
  cases: z.partialRecord(z.enum(CASES), z.string().max(30).nullable()),
}).strict();
const POINTER = z.object({
  quoi: z.enum(['deposee', 'payee']),
  le: z.string().refine(estJour, { message: 'champ.jour' }).nullable(),
  reference: z.string().max(100).default(''),
}).strict();
const ECRIRE = z.object({ ecriture: ECRITURE, complement: z.boolean().default(false) }).strict();

export function routesDeclaration(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Les déclarations préparées d'une année : leurs cases, qui, quand, leurs pointages, leur écriture
  // (tant qu'elle existe et n'est pas contre-passée).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/declarations', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = Number(query.annee);
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2999) return champInvalide('annee', t('compta.champ.annee'));
      const lignes = (await tx.query(`select d.id, d.type, d.periode, d.cases, d.preparee_le, coalesce(u.nom, '') par,
          to_char(d.deposee_le, 'YYYY-MM-DD') deposee_le, coalesce(ud.nom, '') deposee_par, d.deposee_reference,
          to_char(d.payee_le, 'YYYY-MM-DD') payee_le, coalesce(up.nom, '') payee_par,
          case when compta.ecriture_vivante(d.ecriture) then d.ecriture end ecriture
          from compta.declaration d left join socle.utilisateur u on u.id = d.preparee_par
          left join socle.utilisateur ud on ud.id = d.deposee_par left join socle.utilisateur up on up.id = d.payee_par
          where d.entreprise = $1 and d.periode like $2 order by d.periode`, [params.entreprise ?? '', `${annee}-%`])).rows;
      return {
        corps: {
          declarations: lignes.map((d) => ({
            id: d.id, type: d.type, periode: d.periode,
            cases: Object.fromEntries(Object.entries(d.cases as Record<string, number | null>).map(([k, v]) => [k, v === null ? null : versTexte(BigInt(v), 3)])),
            prepareeLe: d.preparee_le, par: d.par,
            deposee: { le: d.deposee_le ?? '', par: d.deposee_le ? d.deposee_par : '', reference: d.deposee_reference },
            payee: { le: d.payee_le ?? '', par: d.payee_le ? d.payee_par : '' },
            ecriture: d.ecriture ?? null,
          })),
        },
      };
    },
  });

  // Préparer (ou refaire) la déclaration d'un mois : ses cases, en texte exact (« 190,000 »), ou null.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/declarations/:periode', geste: 'compta.declarations.preparer', corps: PREPARER,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!estPeriode(params.periode)) return champInvalide('periode', t('compta.champ.periode'));
      const cases: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(corps.cases)) {
        if (v === null || v === undefined) { cases[k] = null; continue; }
        let n: bigint;
        try { n = depuisTexte(v, 3); } catch { return champInvalide(`cases.${k}`, t('compta.champ.montant_signe')); }
        cases[k] = Number(n);
      }
      const id = (await tx.query('select compta.poser_declaration($1, $2, $3::jsonb) id', [params.entreprise ?? '', params.periode, JSON.stringify(cases)])).rows[0].id as string;
      return { corps: { id } };
    },
  });

  // Pointer ou dé-pointer le dépôt ou le paiement (`le` : null pour dé-pointer).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/declarations/:periode/pointer', geste: 'compta.declarations.preparer', corps: POINTER,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!estPeriode(params.periode)) return champInvalide('periode', t('compta.champ.periode'));
      const r = (await tx.query('select compta.pointer_declaration($1, $2, $3, $4::date, $5) aussi', [params.entreprise ?? '', params.periode, corps.quoi, corps.le, corps.reference])).rows[0];
      return { corps: { aussiPayee: r.aussi === true } };
    },
  });

  // L'écriture du mois (ou son complément), au brouillard, liée à sa déclaration.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/declarations/:periode/ecriture', geste: 'compta.declarations.preparer', corps: ECRIRE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!estPeriode(params.periode)) return champInvalide('periode', t('compta.champ.periode'));
      const e = versLaBase(corps.ecriture);
      if ('statut' in e) return e;
      const id = (await tx.query('select compta.ecrire_declaration($1, $2, $3::jsonb, $4) id', [params.entreprise ?? '', params.periode, e.json, corps.complement])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  return routes;
}
