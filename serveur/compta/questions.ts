// Les questions du cabinet au client (brique 44 ; docs/cabinet.md, C33). Une question appartient à
// l'entreprise : elle se lit dans ses livres, en face de sa pièce. Le cabinet la pose, la précise, la
// ferme ou la retire tant qu'elle n'est jamais partie ; il l'ENVOIE (le client la voit alors, et
// chaque envoi se compte : deux envois sans réponse, elle remonte) ; le client y répond. Rien de ce
// qui passe ici ne touche aux chiffres du client. La base refait chaque contrôle (0028).

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';

const uuid = z.string().uuid();
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const PERIODE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const ATTENDU = z.enum(['piece', 'explication', 'confirmation']);
const COMPTE = z.string().regex(/^(\d{1,12})?$/);
// Ce qui part au serveur pour une question : cette liste, et rien d'autre.
const POSER = z.object({
  periode: z.string().regex(PERIODE, { message: 'compta.champ.periode_revision' }),
  cycle: z.string().max(40).default(''),
  compte: COMPTE.default(''),
  ecriture: uuid.nullable().default(null),
  piece: z.string().max(200).default(''),
  montant: z.string().max(30).default('0'),
  objet: z.string().max(200).default(''),
  texte: z.string().max(2000),
  attendu: ATTENDU.default('explication'),
}).strict();
const PRECISER = z.object({
  objet: z.string().max(200), texte: z.string().max(2000), attendu: ATTENDU, cycle: z.string().max(40), compte: COMPTE,
}).partial().strict();

type Ligne = {
  id: string; periode: string; cycle: string; compte: string; ecriture: string | null; piece: string; montant: string;
  objet: string; texte: string; attendu: string; statut: string; envois: Date[]; reponse: string | null;
  repondu_le: Date | null; pose_le: Date; close_le: Date | null;
};
const versQuestion = (q: Ligne) => ({
  id: q.id, periode: q.periode, cycle: q.cycle, compte: q.compte, ecriture: q.ecriture, piece: q.piece,
  montant: versTexte(BigInt(q.montant), 3), objet: q.objet, texte: q.texte, attendu: q.attendu, statut: q.statut,
  envois: q.envois.map((d) => d.toISOString()), reponse: q.reponse, reponduLe: q.repondu_le?.toISOString() ?? null,
  poseeLe: q.pose_le.toISOString(), closeLe: q.close_le?.toISOString() ?? null,
});

export function routesQuestions(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Les questions d'une année (celles dont la période y tombe), ou toutes. Le client ne lit que celles
  // qu'il a reçues (la sécurité par ligne le décide).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/questions', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = query.annee ?? '';
      if (annee && !/^\d{4}$/.test(annee)) return champInvalide('annee', t('compta.champ.annee'));
      const r = await tx.query(`select id, periode, cycle, compte, ecriture, piece, montant, objet, texte, attendu, statut, envois, reponse,
          repondu_le, pose_le, close_le from compta.question where entreprise = $1 and ($2 = '' or left(periode, 4) = $2) order by pose_le, id`,
      [params.entreprise ?? '', annee]);
      return { corps: { questions: (r.rows as Ligne[]).map(versQuestion) } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/questions', geste: 'compta.questions.poser', corps: POSER,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      let montant: bigint;
      try { montant = depuisTexte(corps.montant || '0', 3); } catch { return champInvalide('montant', t('compta.champ.montant_signe')); }
      const id = (await tx.query('select compta.poser_question($1, $2::jsonb) id', [params.entreprise ?? '', JSON.stringify({
        periode: corps.periode, cycle: corps.cycle.trim(), compte: corps.compte, ecriture: corps.ecriture, piece: corps.piece.trim(),
        montant: Number(montant), objet: corps.objet, texte: corps.texte, attendu: corps.attendu,
      })])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  // Préciser une question qui n'a pas encore sa réponse (ce qui n'est pas envoyé ne change pas).
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/questions/:question', geste: 'compta.questions.poser', corps: PRECISER,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.question).success) return introuvable;
      await tx.query('select compta.modifier_question($1, $2, $3::jsonb)', [params.entreprise ?? '', params.question, JSON.stringify(corps)]);
      return { corps: { id: params.question } };
    },
  });

  // Retirer une question jamais envoyée : le client ne l'a jamais vue.
  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/compta/questions/:question', geste: 'compta.questions.poser',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.question).success) return introuvable;
      await tx.query('select compta.retirer_question($1, $2)', [params.entreprise ?? '', params.question]);
      return { corps: { id: params.question } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/questions/:question/fermer', geste: 'compta.questions.poser',
    corps: z.object({ rouvrir: z.boolean().default(false) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.question).success) return introuvable;
      const r = (await tx.query('select compta.fermer_question($1, $2, $3) statut', [params.entreprise ?? '', params.question, corps.rouvrir])).rows[0];
      return { corps: { statut: r.statut as string } };
    },
  });

  // Envoyer au client les questions d'une année qui attendent leur réponse.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/questions/envoyer', geste: 'compta.questions.envoyer',
    corps: z.object({ annee: z.number().int().min(1900).max(2999) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = (await tx.query('select compta.envoyer_questions($1, $2) n', [params.entreprise ?? '', corps.annee])).rows[0];
      return { corps: { envoyees: Number(r.n) } };
    },
  });

  // Le client répond (ou complète sa réponse, tant que la question n'est pas fermée).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/questions/:question/repondre', geste: 'compta.questions.repondre',
    corps: z.object({ texte: z.string().max(4000) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.question).success) return introuvable;
      await tx.query('select compta.repondre_question($1, $2, $3)', [params.entreprise ?? '', params.question, corps.texte]);
      return { corps: { id: params.question } };
    },
  });

  // Ce que le cabinet attend, dossier par dossier (« À faire ») : les questions qui attendent leur
  // réponse, celles envoyées deux fois sans réponse, celles qui ont leur réponse.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/questions', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await tx.query(`select q.entreprise,
          count(*) filter (where q.statut in ('ouverte', 'envoyee')) ouvertes,
          count(*) filter (where q.statut in ('ouverte', 'envoyee') and cardinality(q.envois) >= 2) a_relancer,
          count(*) filter (where q.statut = 'repondue') repondues
        from compta.question q
        where q.entreprise in (select p.entreprise from socle.portefeuille($1) p where p.statut = 'actif')
        group by q.entreprise order by q.entreprise`, [params.cabinet]);
      return {
        corps: {
          dossiers: (r.rows as { entreprise: string; ouvertes: string; a_relancer: string; repondues: string }[]).map((x) => ({
            entreprise: x.entreprise, ouvertes: Number(x.ouvertes), aRelancer: Number(x.a_relancer), repondues: Number(x.repondues),
          })),
        },
      };
    },
  });

  return routes;
}
