// L'inventaire de stock (brique 42 bis ; docs/cabinet.md, C30). La variation se calcule dans le
// navigateur, par la v10, sur le livre du serveur ; le serveur garde l'inventaire d'une année (ses
// lignes, et son total qu'il calcule lui-même) et le lien vers l'écriture de variation. La base refait
// chaque contrôle (compta.poser_inventaire, compta.ecrire_variation_stock, migration 0027).

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { ECRITURE, estJour, versLaBase } from './saisie.ts';
import './textes.ts';

const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const anneeDe = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1900 && n <= 2999 ? n : null; };
const INVENTAIRE = z.object({
  date: z.string().refine(estJour, { message: 'champ.jour' }),
  compte: z.string().max(12),
  lignes: z.array(z.object({ ref: z.string().max(60).default(''), libelle: z.string().max(200), quantite: z.string().max(30), cout: z.string().max(30) }).strict()).max(10000),
}).strict();

export function routesInventaire(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/inventaires/:annee', geste: 'compta.livres.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const x = (await tx.query(`select to_char(date_inventaire, 'YYYY-MM-DD') date, compte, lignes, total,
          case when compta.ecriture_vivante(ecriture) then ecriture end ecriture from compta.inventaire where entreprise = $1 and annee = $2`,
      [params.entreprise ?? '', annee])).rows[0];
      return {
        corps: {
          inventaire: x ? {
            annee, date: x.date, compte: x.compte, total: versTexte(BigInt(x.total), 3), ecriture: x.ecriture ?? null,
            lignes: (x.lignes as { ref: string; libelle: string; quantite: number; cout: number }[]).map((l) => ({
              ref: l.ref, libelle: l.libelle, quantite: versTexte(BigInt(l.quantite), 3), cout: versTexte(BigInt(l.cout), 3),
            })),
          } : null,
        },
      };
    },
  });

  // Saisir (ou refaire) l'inventaire d'une année : ses lignes, la quantité et le coût en texte exact.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/inventaires/:annee', geste: 'compta.ecritures.saisir', corps: INVENTAIRE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const lignes = [];
      for (const [i, l] of corps.lignes.entries()) {
        let quantite: bigint, cout: bigint;
        try { quantite = depuisTexte(l.quantite, 3); } catch { return champInvalide(`lignes.${i}.quantite`, t('compta.champ.quantite')); }
        try { cout = depuisTexte(l.cout, 3); } catch { return champInvalide(`lignes.${i}.cout`, t('compta.champ.montant')); }
        lignes.push({ ref: l.ref, libelle: l.libelle.trim(), quantite: Number(quantite), cout: Number(cout) });
      }
      const total = (await tx.query('select compta.poser_inventaire($1, $2, $3::jsonb) total', [params.entreprise ?? '', annee,
        JSON.stringify({ date: corps.date, compte: corps.compte.trim(), lignes })])).rows[0].total;
      return { corps: { total: versTexte(BigInt(total), 3) } };
    },
  });

  // La variation de stock de l'année, au brouillard, liée à l'inventaire.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/inventaires/:annee/variation', geste: 'compta.ecritures.valider',
    corps: z.object({ ecriture: ECRITURE }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const e = versLaBase(corps.ecriture);
      if ('statut' in e) return e;
      const id = (await tx.query('select compta.ecrire_variation_stock($1, $2, $3::jsonb) id', [params.entreprise ?? '', annee, e.json])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  return routes;
}
