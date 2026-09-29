// La saisie dans les livres du serveur (brique 38 ; docs/cabinet.md) : les gestes du comptable, le
// cabinet ou la comptabilité de l'entreprise. Chaque route ne fait que lire le corps et appeler la
// base, qui refait chaque contrôle et garde qui peut quoi (compta.peut, migration 0021) :
//   - saisir une écriture au brouillard, la modifier, la supprimer (avec la révision vue : un
//     brouillard changé ailleurs n'est jamais écrasé) ;
//   - valider des écritures (une, ou un lot) ; contre-passer, extourner une écriture saisie ;
//   - lettrer des écritures validées d'un compte, délettrer.
// Les montants entrent en texte exact (« 1191,000 ») et vont à la base en millimes.

import { z } from 'zod';
import { depuisTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { texteDuRefus } from '../erreurs.ts';
import { motif, t } from '../../textes/index.ts';
import { libelle } from './ecrire.ts';
import './textes.ts';

const uuid = z.string().uuid();
const JOURNAUX = ['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'] as const;
const estJour = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };

// Une ligne : ce que la grille de saisie envoie. Le compte, l'équilibre et le reste se contrôlent
// dans la base, avec la phrase de la v10 et le numéro de la ligne fautive.
const LIGNE = z.object({
  compte: z.string().max(20),
  libelle: z.string().max(500).optional(),
  tiers: z.string().max(200).optional(),
  debit: z.string().max(20).optional(),
  credit: z.string().max(20).optional(),
}).strict();
const ECRITURE = z.object({
  date: z.string().refine(estJour, { message: 'champ.jour' }),
  journal: z.enum(JOURNAUX, { message: 'compta.champ.journal' }),
  piece: z.string().max(200).optional(),
  libelle: z.string().max(500).optional(),
  lignes: z.array(LIGNE).max(500),
}).strict();
type Ecriture = z.infer<typeof ECRITURE>;

// L'écriture pour la base (les montants en millimes, en texte), ou le champ qui ne va pas.
function versLaBase(e: Ecriture): { json: string } | ReturnType<typeof champInvalide> {
  const lignes = [];
  for (const [i, l] of e.lignes.entries()) {
    const montants: Record<'debit' | 'credit', string> = { debit: '0', credit: '0' };
    for (const cote of ['debit', 'credit'] as const) {
      const brut = (l[cote] ?? '').trim();
      if (!brut) continue;
      let v: bigint;
      try { v = depuisTexte(brut, 3); } catch { return champInvalide(`lignes.${i}.${cote}`, t('compta.champ.montant')); }
      if (v < 0n) return champInvalide(`lignes.${i}.${cote}`, t('compta.champ.montant'));
      montants[cote] = v.toString();
    }
    lignes.push({ compte: l.compte.trim(), libelle: l.libelle ?? '', tiers: l.tiers ?? '', ...montants });
  }
  return { json: JSON.stringify({ date: e.date, journal: e.journal, piece: e.piece ?? '', libelle: e.libelle ?? '', lignes }) };
}

// Le miroir posé (contre-passation, extourne) : son identifiant, son numéro, son rang, son jour.
type Miroir = { r_id: string; r_numero: string; r_chaine: string; r_date: string };
const miroir = (m: Miroir | undefined) => ({ id: m?.r_id, numero: m?.r_numero, chaine: Number(m?.r_chaine), date: m?.r_date });

export function routesSaisie(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures', geste: 'compta.ecritures.saisir', corps: ECRITURE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const e = versLaBase(corps);
      if ('statut' in e) return e;
      const id = (await tx.query('select compta.saisir($1, $2::jsonb) id', [params.entreprise ?? '', e.json])).rows[0].id as string;
      return { statut: 201, corps: { id, revision: 1 } };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture', geste: 'compta.ecritures.saisir',
    corps: ECRITURE.extend({ revision: z.number().int().positive({ message: 'compta.champ.revision' }) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.ecriture).success) return introuvable;
      const { revision, ...ecriture } = corps;
      const e = versLaBase(ecriture);
      if ('statut' in e) return e;
      const r = (await tx.query('select compta.modifier_saisie($1, $2, $3, $4::jsonb) revision', [params.entreprise ?? '', params.ecriture, revision, e.json])).rows[0];
      return { corps: { id: params.ecriture, revision: Number(r.revision) } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture', geste: 'compta.ecritures.saisir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !uuid.safeParse(params.ecriture).success) return introuvable;
      const revision = Number(query.revision);
      if (!Number.isInteger(revision) || revision < 1) return champInvalide('revision', t('compta.champ.revision'));
      await tx.query('select compta.supprimer_saisie($1, $2, $3)', [params.entreprise ?? '', params.ecriture, revision]);
      return { corps: { ok: true } };
    },
  });

  // Valider des écritures : chacune prend son numéro, ou est nommée avec la raison de son refus.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/valider', geste: 'compta.ecritures.valider',
    corps: z.object({ ids: z.array(uuid).min(1).max(500, { message: 'compta.champ.ids' }) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query('select * from compta.valider_ecritures($1, $2::uuid[])', [params.entreprise ?? '', corps.ids]);
      const rangees = r.rows as { r_id: string; r_numero: string | null; r_chaine: string | null; r_motif: string | null }[];
      return {
        corps: {
          validees: rangees.filter((x) => x.r_numero).map((x) => ({ id: x.r_id, numero: x.r_numero, chaine: Number(x.r_chaine) })),
          refusees: rangees.filter((x) => !x.r_numero).map((x) => ({ id: x.r_id, motif: texteDuRefus({ message: x.r_motif ?? '' }) })),
        },
      };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture/contrepasser', geste: 'compta.ecritures.valider',
    corps: z.object({ date: z.string().refine(estJour, { message: 'champ.jour' }).optional() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.ecriture).success) return introuvable;
      const r = await tx.query('select * from compta.contrepasser($1, $2, $3::date, $4)',
        [params.entreprise ?? '', params.ecriture, corps.date ?? null, libelle('compta.libelle.contre_passation', { numero: '{numero}' })]);
      return { statut: 201, corps: miroir(r.rows[0] as Miroir | undefined) };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture/extourner', geste: 'compta.ecritures.valider',
    corps: z.object({}).strict(),
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.ecriture).success) return introuvable;
      const r = await tx.query('select * from compta.extourner($1, $2, $3)',
        [params.entreprise ?? '', params.ecriture, libelle('compta.libelle.extourne', { numero: '{numero}' })]);
      return { statut: 201, corps: miroir(r.rows[0] as Miroir | undefined) };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/lettrages', geste: 'compta.lettrage.poser',
    corps: z.object({
      compte: z.string().regex(/^[0-9]{1,12}$/, { message: 'compta.champ.compte' }),
      ecritures: z.array(uuid).max(500, { message: 'compta.champ.ids' }),
      lettre: z.string().regex(/^[A-Za-z]{1,5}$/, { message: 'compta.champ.lettre' }).optional(),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query('select compta.lettrer($1, $2, $3::uuid[], $4) lettre', [params.entreprise ?? '', corps.compte, corps.ecritures, corps.lettre ?? null]);
      return { statut: 201, corps: { lettre: r.rows[0].lettre as string } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/compta/lettrages/:lettre', geste: 'compta.lettrage.poser',
    traiter: async ({ params }, tx) => {
      if (!tx || !/^[A-Za-z]{1,5}$/.test(params.lettre ?? '')) return introuvable;
      await tx.query('select compta.delettrer($1, $2)', [params.entreprise ?? '', params.lettre]);
      return { corps: { ok: true } };
    },
  });

  return routes;
}
