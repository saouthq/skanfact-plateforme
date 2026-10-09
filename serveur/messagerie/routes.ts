// La messagerie entre l'entreprise et son cabinet (lot messagerie, décidée par Skander le 09/10/2026 sur les maquettes
// « Mon comptable » et « Les messages de tes clients » ; docs/messagerie.md). Un fil par entreprise et par cabinet,
// qui appartient à l'entreprise. Les questions de la révision y paraissent à leur date d'envoi, lues là où elles sont
// (compta.question). La base refait chaque contrôle (0078) : ces routes ne font que lire et appeler ses fonctions.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { sorteDe } from '../achats/lecteur.ts';
import './textes.ts';

const uuid = z.string().uuid();
const COTE = z.enum(['entreprise', 'cabinet']);
type Cote = z.infer<typeof COTE>;
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
// Un fil se lit par pages de cinquante messages, du plus récent au plus ancien.
const PAGE = 50;
// Une photo de téléphone pèse quelques Mo ; au-delà de 10 Mo, ce n'est plus une pièce (la même limite que la lecture
// des factures d'achat, brique 84). Le corps porte le fichier en base 64 (un tiers de plus) : accepté jusqu'à 16 Mo,
// pour qu'un fichier un peu trop lourd reçoive sa phrase plutôt qu'un refus muet.
const LIMITE_FICHIER = 10 * 1_048_576;
const LIMITE_CORPS = 16 * 1_048_576;
const TYPE_DE = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' } as const;

const versCurseur = (quand: Date, id: string) => Buffer.from(JSON.stringify([quand.toISOString(), id])).toString('base64url');
function depuisCurseur(texte: string): [string, string] | null {
  try {
    const [quand, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof quand === 'string' && !Number.isNaN(Date.parse(quand)) && typeof id === 'string' && uuid.safeParse(id).success) return [quand, id];
  } catch { /* illisible */ }
  return null;
}

// Ce qui attend dans le fil. `nonLus` : ce que l'autre côté a écrit (ou, pour le cabinet, ce que le client a répondu à
// une question) depuis la dernière lecture de ce côté, sauf une pièce demandée encore attendue, que `demandes` compte
// déjà (la pastille la comptait deux fois : vu à la souris le 09/10/2026, « 3 » pour une question et une pièce).
// `questions` et `demandes` : les questions envoyées sans réponse et les pièces demandées pas encore reçues, les mêmes
// des deux côtés (elles attendent l'entreprise ; la boîte du cabinet les compte dans « Attend le client », avec la même
// règle). UNE fonction pour la pastille du menu, l'encart du fil et la boîte. `aLire` : il y a du neuf depuis la
// dernière lecture de ce côté (pièces demandées comprises) : l'écran ouvert le marque lu.
export async function attente(tx: Transaction, entreprise: string, cabinet: string, cote: Cote): Promise<{ nonLus: number; questions: number; demandes: number; aLire: boolean }> {
  const r = (await tx.query(`select
      (select count(*) from messagerie.message m where m.entreprise = $1 and m.cabinet = $2 and m.cote <> $3
          and m.ecrit_le > coalesce(case $3 when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity')
          and not (m.demande is not null and m.demande_recue_le is null))
      + case when $3 = 'cabinet' then (select count(*) from compta.question q where q.entreprise = $1 and q.cabinet = $2
          and q.repondu_le > coalesce(f.lu_cabinet, '-infinity')) else 0 end non_lus,
      exists (select 1 from messagerie.message m where m.entreprise = $1 and m.cabinet = $2 and m.cote <> $3
          and m.ecrit_le > coalesce(case $3 when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity'))
      or ($3 = 'cabinet' and exists (select 1 from compta.question q where q.entreprise = $1 and q.cabinet = $2
          and q.repondu_le > coalesce(f.lu_cabinet, '-infinity'))) a_lire,
      (select count(*) from compta.question q where q.entreprise = $1 and q.cabinet = $2 and q.statut = 'envoyee') questions,
      (select count(*) from messagerie.message m where m.entreprise = $1 and m.cabinet = $2
          and m.demande is not null and m.demande_recue_le is null) demandes
    from (select 1) x left join messagerie.fil f on f.entreprise = $1 and f.cabinet = $2`, [entreprise, cabinet, cote])).rows[0] as { non_lus: string; questions: string; demandes: string; a_lire: boolean };
  return { nonLus: Number(r.non_lus), questions: Number(r.questions), demandes: Number(r.demandes), aLire: r.a_lire };
}

// Le fil que lit ce côté : celui de mon cabinet (côté cabinet) ; celui du cabinet d'aujourd'hui, ou d'un ancien
// cabinet nommé (côté entreprise). Null : aucun cabinet ne tient le dossier.
async function filDe(tx: Transaction, entreprise: string, cote: Cote, nomme: string | undefined): Promise<{ cabinet: string | null } | { refus: ReturnType<typeof motif> }> {
  if (cote === 'cabinet') {
    const c = (await tx.query('select messagerie.mon_cabinet($1) c', [entreprise])).rows[0].c as string | null;
    return c ? { cabinet: c } : { refus: motif('base.messagerie.pas_ton_dossier') };
  }
  if (!(await tx.query('select messagerie.cote_entreprise($1) v', [entreprise])).rows[0].v) return { refus: motif('base.messagerie.role') };
  if (nomme) {
    const f = (await tx.query('select 1 from messagerie.fil where entreprise = $1 and cabinet = $2', [entreprise, nomme])).rowCount;
    return { cabinet: f ? nomme : null };
  }
  return { cabinet: (await tx.query('select messagerie.cabinet_actif($1) c', [entreprise])).rows[0].c as string | null };
}

type LigneMessage = {
  id: string; cote: Cote; auteur_nom: string; de_moi: boolean; texte: string; piece_genre: string | null; piece_id: string | null; piece_libelle: string | null;
  demande: string | null; demande_recue_le: Date | null; fichier: string | null; fichier_nom: string | null; fichier_type: string | null;
  fichier_taille: number | null; achat_id: string | null; achat_libelle: string | null; repond_a: string | null; ecrit_le: Date;
};
type LigneQuestion = {
  id: string; objet: string; texte: string; piece: string; montant: string; attendu: string; statut: string; envoyee_le: Date;
  reponse: string | null; repondu_le: Date | null; periode: string;
  pose_moi: boolean; pose_nom: string | null; reponse_moi: boolean; reponse_nom: string | null;
};

export function routesMessagerie(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Le fil, cinquante messages à la fois (« avant » : la suite, plus ancienne), avec les questions envoyées pendant la
  // même période et ce qui attend ce côté.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/messages', geste: 'messagerie.lire',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const cote = COTE.safeParse(query.cote ?? 'entreprise');
      if (!cote.success) return champInvalide('cote', t('messagerie.champ.cote'));
      if (query.cabinet !== undefined && !uuid.safeParse(query.cabinet).success) return introuvable;
      const avant = query.avant === undefined ? null : depuisCurseur(query.avant);
      if (query.avant !== undefined && !avant) return champInvalide('avant', t('messagerie.champ.curseur'));
      const fil = await filDe(tx, entreprise, cote.data, query.cabinet);
      if ('refus' in fil) return { statut: 403, corps: { motif: fil.refus, bouton: null } };
      // Les fils d'avant (un ancien cabinet), côté entreprise : ils restent lisibles.
      const anciens = cote.data === 'entreprise'
        ? (await tx.query(`select f.cabinet, (select c.nom from socle.mandat d, socle.cabinet_du_mandat(d.id) c
              where d.entreprise = f.entreprise and d.cabinet = f.cabinet order by d.debut desc limit 1) nom
            from messagerie.fil f where f.entreprise = $1 and f.cabinet is distinct from $2 order by f.cree_le`, [entreprise, fil.cabinet])).rows as { cabinet: string; nom: string | null }[]
        : [];
      if (!fil.cabinet) return { corps: { fil: null, messages: [], questions: [], suite: null, attente: { nonLus: 0, questions: 0, demandes: 0, aLire: false }, anciens } };
      const cabinet = fil.cabinet;

      const info = (await tx.query(`select
          (select c.nom from socle.mandat d, socle.cabinet_du_mandat(d.id) c where d.entreprise = $1 and d.cabinet = $2 order by d.debut desc limit 1) nom,
          (select d.debut from socle.mandat d where d.entreprise = $1 and d.cabinet = $2 and d.statut = 'actif' order by d.debut desc limit 1) depuis,
          f.lu_entreprise, f.lu_cabinet,
          (select a.active from messagerie.alerte a where a.utilisateur = socle.moi() and a.entreprise = $1 and a.cabinet = $2) alerte
        from (select 1) x left join messagerie.fil f on f.entreprise = $1 and f.cabinet = $2`, [entreprise, cabinet])).rows[0] as
        { nom: string | null; depuis: string | null; lu_entreprise: Date | null; lu_cabinet: Date | null; alerte: boolean | null };
      const luParLautre = cote.data === 'entreprise' ? info.lu_cabinet : info.lu_entreprise;

      const lignes = (await tx.query(`select m.id, m.cote, m.auteur_nom, m.auteur = socle.moi() de_moi, m.texte, m.piece_genre, m.piece_id, m.piece_libelle, m.demande,
          m.demande_recue_le, m.fichier, fi.nom fichier_nom, fi.type fichier_type, fi.taille fichier_taille, m.achat_id, m.achat_libelle,
          m.repond_a, m.ecrit_le
        from messagerie.message m left join messagerie.fichier fi on fi.id = m.fichier
        where m.entreprise = $1 and m.cabinet = $2 and ($3::timestamptz is null or (m.ecrit_le, m.id) < ($3::timestamptz, $4::uuid))
        order by m.ecrit_le desc, m.id desc limit $5`, [entreprise, cabinet, avant?.[0] ?? null, avant?.[1] ?? null, PAGE + 1])).rows as LigneMessage[];
      const suite = lignes.length > PAGE;
      const page = lignes.slice(0, PAGE);
      // Les questions envoyées pendant la période de cette page : depuis le plus ancien message de la page (ou depuis
      // toujours, à la dernière page), jusqu'au curseur (ou jusqu'à maintenant, à la première).
      const depuis = suite ? page.at(-1)?.ecrit_le ?? null : null;
      // Qui l'a posée, qui y a répondu : « Toi », sinon son nom quand on le voit (un collègue), sinon rien (l'écran dit « le
      // cabinet », « le client »).
      const questions = (await tx.query(`select q.id, q.objet, q.texte, q.piece, q.montant, q.attendu, q.statut, q.envois[1] envoyee_le, q.reponse,
          q.repondu_le, q.periode, coalesce(q.pose_par = socle.moi(), false) pose_moi, pu.nom pose_nom,
          coalesce(q.repondu_par = socle.moi(), false) reponse_moi, ru.nom reponse_nom
        from compta.question q
          left join socle.utilisateur pu on pu.id = q.pose_par
          left join socle.utilisateur ru on ru.id = q.repondu_par
        where q.entreprise = $1 and q.cabinet = $2 and cardinality(q.envois) > 0
          and ($3::timestamptz is null or q.envois[1] < $3::timestamptz) and ($4::timestamptz is null or q.envois[1] >= $4::timestamptz)
        order by q.envois[1], q.id`, [entreprise, cabinet, avant?.[0] ?? null, depuis])).rows as LigneQuestion[];

      return {
        corps: {
          fil: {
            cabinet, cabinetNom: info.nom, depuis: info.depuis, actif: info.depuis !== null,
            luParLautre: luParLautre?.toISOString() ?? null, alerte: info.alerte ?? true,
          },
          messages: page.map((m) => ({
            id: m.id, cote: m.cote, auteur: m.auteur_nom, texte: m.texte, ecritLe: m.ecrit_le.toISOString(),
            // `moi` : je l'ai écrit (« Toi ») ; `cote` dit de quel côté du fil il se range.
            moi: m.de_moi,
            lu: m.cote === cote.data ? !!luParLautre && m.ecrit_le <= luParLautre : true,
            piece: m.piece_genre ? { genre: m.piece_genre, id: m.piece_id, libelle: m.piece_libelle } : null,
            demande: m.demande ? { texte: m.demande, recueLe: m.demande_recue_le?.toISOString() ?? null } : null,
            fichier: m.fichier ? { id: m.fichier, nom: m.fichier_nom, type: m.fichier_type, taille: m.fichier_taille } : null,
            achat: m.achat_id ? { id: m.achat_id, libelle: m.achat_libelle } : null,
            repondA: m.repond_a,
          })),
          questions: questions.map((q) => ({
            id: q.id, objet: q.objet, texte: q.texte, piece: q.piece, montant: versTexte(BigInt(q.montant), 3), attendu: q.attendu,
            statut: q.statut, periode: q.periode, envoyeeLe: q.envoyee_le.toISOString(), reponse: q.reponse,
            reponduLe: q.repondu_le?.toISOString() ?? null,
            poseePar: q.pose_moi ? 'moi' : q.pose_nom, repondueePar: q.reponse_moi ? 'moi' : q.reponse_nom,
          })),
          suite: suite ? versCurseur(page.at(-1)?.ecrit_le ?? new Date(0), page.at(-1)?.id ?? '') : null,
          attente: await attente(tx, entreprise, cabinet, cote.data),
          anciens,
        },
      };
    },
  });

  // Ce qui attend l'entreprise (la pastille de « Mon comptable »), relu par l'écran toutes les 30 secondes : léger.
  // `anciens` : les fils d'un cabinet d'avant, qui se relisent (l'entrée du menu reste là pour eux).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/messages/attente', geste: 'messagerie.lire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const fil = await filDe(tx, entreprise, 'entreprise', undefined);
      if ('refus' in fil) return { statut: 403, corps: { motif: fil.refus, bouton: null } };
      const anciens = Number((await tx.query('select count(*) n from messagerie.fil where entreprise = $1 and cabinet is distinct from $2', [entreprise, fil.cabinet])).rows[0].n);
      if (!fil.cabinet) return { corps: { cabinet: null, nonLus: 0, questions: 0, demandes: 0, anciens } };
      return { corps: { cabinet: fil.cabinet, ...(await attente(tx, entreprise, fil.cabinet, 'entreprise')), anciens } };
    },
  });

  // Écrire. Ce qui part au serveur : le texte, la pièce dont on parle (son genre, son identifiant, son libellé), la
  // pièce demandée (le cabinet), le fichier déposé, la demande à laquelle on répond. Rien d'autre.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages', geste: 'messagerie.ecrire',
    corps: z.object({
      cote: COTE,
      texte: z.string().max(4000).default(''),
      piece: z.object({ genre: z.enum(['facture', 'avoir', 'devis', 'achat']), id: z.string().trim().min(1).max(100), libelle: z.string().trim().min(1).max(300) }).strict().nullable().default(null),
      demande: z.string().trim().max(300).nullable().default(null),
      fichier: uuid.nullable().default(null),
      repondA: uuid.nullable().default(null),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select messagerie.ecrire($1, $2, $3::jsonb) id', [params.entreprise ?? '', corps.cote, JSON.stringify({
        texte: corps.texte, piece: corps.piece, demande: corps.demande, fichier: corps.fichier, repondA: corps.repondA,
      })])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  // Déposer une photo ou un PDF, reconnu à ses premiers octets (jamais à son nom) ; il se joint ensuite à un message.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/fichiers', geste: 'messagerie.ecrire', limiteCorps: LIMITE_CORPS,
    corps: z.object({ cote: COTE, nom: z.string().trim().min(1).max(200), contenu: z.string().min(1).max(LIMITE_CORPS) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const fichier = /^[A-Za-z0-9+/]+={0,2}$/.test(corps.contenu) ? Buffer.from(corps.contenu, 'base64') : Buffer.alloc(0);
      if (fichier.length > LIMITE_FICHIER) {
        return { statut: 413, corps: { motif: motif('messagerie.fichier.trop_lourd', { nom: corps.nom, taille: (fichier.length / 1_048_576).toFixed(1).replace('.', ','), limite: LIMITE_FICHIER / 1_048_576 }), bouton: null } };
      }
      const sorte = sorteDe(fichier);
      if (!sorte) return { statut: 415, corps: { motif: motif('messagerie.fichier.format', { nom: corps.nom }), bouton: null } };
      const type = TYPE_DE[sorte];
      const id = (await tx.query('select messagerie.deposer($1, $2, $3, $4, $5, $6) id', [params.entreprise ?? '', corps.cote, corps.nom, type, fichier,
        createHash('sha256').update(fichier).digest('hex')])).rows[0].id as string;
      return { statut: 201, corps: { id, nom: corps.nom, type, taille: fichier.length } };
    },
  });

  // Un fichier du fil, en base 64 (l'écran le montre ou l'enregistre).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/messages/fichiers/:fichier', geste: 'messagerie.lire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.fichier).success) return introuvable;
      const f = (await tx.query('select nom, type, contenu from messagerie.fichier where id = $1 and entreprise = $2', [params.fichier, params.entreprise ?? ''])).rows[0] as
        { nom: string; type: string; contenu: Buffer } | undefined;
      if (!f) return introuvable;
      return { corps: { nom: f.nom, type: f.type, taille: f.contenu.length, contenu: f.contenu.toString('base64') } };
    },
  });

  // Ce côté a lu le fil jusqu'à maintenant.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/lu', geste: 'messagerie.lire',
    corps: z.object({ cote: COTE, cabinet: uuid.nullable().default(null) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select messagerie.lire($1, $2, $3)', [params.entreprise ?? '', corps.cote, corps.cabinet]);
      return { corps: {} };
    },
  });

  // Le cabinet dit le fil traité (« Rien à faire »), jusqu'au prochain message du client.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/traite', geste: 'messagerie.ecrire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select messagerie.traiter($1)', [params.entreprise ?? '']);
      return { corps: {} };
    },
  });

  // Le cabinet a reçu autrement la pièce qu'il demandait.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/:message/recue', geste: 'messagerie.ecrire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.message).success) return introuvable;
      await tx.query('select messagerie.demande_recue($1, $2)', [params.entreprise ?? '', params.message]);
      return { corps: {} };
    },
  });

  // Le fichier d'un message, rangé dans un achat que l'écran vient d'enregistrer.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/:message/achat', geste: 'messagerie.ecrire',
    corps: z.object({ achat: z.string().trim().min(1).max(100), libelle: z.string().trim().min(1).max(300) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.message).success) return introuvable;
      await tx.query('select messagerie.ranger_achat($1, $2, $3, $4)', [params.entreprise ?? '', params.message, corps.achat, corps.libelle]);
      return { corps: {} };
    },
  });

  // Mon alerte par e-mail pour ce fil.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/messages/alerte', geste: 'messagerie.lire',
    corps: z.object({ cote: COTE, active: z.boolean() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select messagerie.regler_alerte($1, $2, $3)', [params.entreprise ?? '', corps.cote, corps.active]);
      return { corps: { active: corps.active } };
    },
  });

  // La boîte du cabinet : ses dossiers en ligne (pas ceux qu'il tient seul), chacun avec son état — « À traiter » (le
  // client a écrit ou répondu depuis la dernière réponse du cabinet, ou depuis qu'il a dit le fil traité), « Attend le
  // client » (une question ou une pièce demandée sans réponse), « Rien à faire » —, le dernier échange, et combien sont
  // à lire. Les compteurs sortent de ces mêmes lignes.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/messages', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await tx.query(`with d as (
          select p.entreprise, p.raison_sociale from socle.portefeuille($1) p where p.statut = 'actif' and not p.tenu
        ),
        evenements as (
          select m.entreprise, m.ecrit_le quand, m.id, m.cote, m.auteur_nom auteur,
                 case when m.demande is not null then 'demande' when m.fichier is not null and m.texte = '' then 'fichier' else 'message' end sorte,
                 coalesce(nullif(m.texte, ''), m.demande, fi.nom, '') extrait
            from messagerie.message m left join messagerie.fichier fi on fi.id = m.fichier
           where m.cabinet = $1 and m.entreprise in (select entreprise from d)
          union all
          select q.entreprise, q.envois[cardinality(q.envois)], q.id, 'cabinet', '', 'question', coalesce(nullif(q.objet, ''), q.texte)
            from compta.question q where q.cabinet = $1 and cardinality(q.envois) > 0 and q.entreprise in (select entreprise from d)
          union all
          select q.entreprise, q.repondu_le, q.id, 'entreprise', '', 'reponse', q.reponse
            from compta.question q where q.cabinet = $1 and q.repondu_le is not null and q.entreprise in (select entreprise from d)
        ),
        dernier as (select distinct on (e.entreprise) e.* from evenements e order by e.entreprise, e.quand desc, e.id desc),
        client as (select entreprise, max(quand) quand from evenements where cote = 'entreprise' group by entreprise),
        cabinet as (select entreprise, max(quand) quand from evenements where cote = 'cabinet' and sorte = 'message' group by entreprise),
        attend as (
          select entreprise, count(*) n from (
            select q.entreprise from compta.question q where q.cabinet = $1 and q.statut = 'envoyee'
            union all
            select m.entreprise from messagerie.message m where m.cabinet = $1 and m.demande is not null and m.demande_recue_le is null
          ) x group by entreprise
        )
        select d.entreprise, d.raison_sociale,
               case when cl.quand is not null and cl.quand > greatest(coalesce(f.traite_le, '-infinity'), coalesce(ca.quand, '-infinity')) then 'a_traiter'
                    when coalesce(at.n, 0) > 0 then 'attend_client' else 'rien' end etat,
               (select count(*) from evenements e where e.entreprise = d.entreprise and e.cote = 'entreprise'
                  and e.quand > coalesce(f.lu_cabinet, '-infinity')) non_lus,
               coalesce(at.n, 0) attentes,
               dn.quand, dn.cote, dn.auteur, dn.sorte, dn.extrait
          from d
          left join messagerie.fil f on f.entreprise = d.entreprise and f.cabinet = $1
          left join client cl on cl.entreprise = d.entreprise
          left join cabinet ca on ca.entreprise = d.entreprise
          left join attend at on at.entreprise = d.entreprise
          left join dernier dn on dn.entreprise = d.entreprise
         order by case when cl.quand is not null and cl.quand > greatest(coalesce(f.traite_le, '-infinity'), coalesce(ca.quand, '-infinity')) then 0
                       when coalesce(at.n, 0) > 0 then 1 else 2 end, dn.quand desc nulls last, d.raison_sociale, d.entreprise`, [params.cabinet]);
      const dossiers = (r.rows as { entreprise: string; raison_sociale: string; etat: string; non_lus: string; attentes: string; quand: Date | null;
        cote: string | null; auteur: string | null; sorte: string | null; extrait: string | null }[]).map((x) => ({
        entreprise: x.entreprise, nom: x.raison_sociale, etat: x.etat, nonLus: Number(x.non_lus), attentes: Number(x.attentes),
        dernier: x.quand ? { quand: x.quand.toISOString(), cote: x.cote, auteur: x.auteur, sorte: x.sorte, extrait: (x.extrait ?? '').slice(0, 200) } : null,
      }));
      return {
        corps: {
          dossiers,
          compteurs: {
            aTraiter: dossiers.filter((x) => x.etat === 'a_traiter').length,
            attendClient: dossiers.filter((x) => x.etat === 'attend_client').length,
            tout: dossiers.length,
          },
        },
      };
    },
  });

  return routes;
}
