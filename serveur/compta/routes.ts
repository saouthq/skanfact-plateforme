// Les routes du module Comptabilité : les livres que le serveur tient (docs/ecritures.md § 5).
//   - le journal : les écritures dans l'ordre des dates, page après page, chacune avec ses lignes ;
//   - la balance : chaque compte, ses débits, ses crédits, son solde, et les totaux ;
//   - le grand livre d'un compte (et de ses sous-comptes) : le solde avant, chaque ligne et le solde
//     après elle, page après page.
// Les nombres sortent en TEXTE exact (« 1191.000 ») : jamais en nombre à virgule (01 R3).

import { sql } from 'kysely';
import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { NUMERO_DE_COMPTE } from '../../moteur/comptes.ts';
import type { Route } from '../app.ts';
import { requetes, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { routesSaisie } from './saisie.ts';
import './textes.ts';

const LIMITE_MAX = 500;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 100) || 100, 1), LIMITE_MAX);
const uuid = z.string().uuid();
const JOURNAUX = ['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'];
const m = (v: bigint) => versTexte(v, 3);
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const estJour = (v: string | undefined) => v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// La période demandée (`du`, `au`, l'une ou l'autre, ou aucune), ou le refus qui dit ce qui ne va pas.
function periode(q: Record<string, string>): { du: string | null; au: string | null } | ReturnType<typeof champInvalide> {
  if (q.du !== undefined && !estJour(q.du)) return champInvalide('du', t('champ.jour'));
  if (q.au !== undefined && !estJour(q.au)) return champInvalide('au', t('champ.jour'));
  const du = q.du ?? null, au = q.au ?? null;
  if (du && au && au < du) return champInvalide('au', t('compta.champ.fin_avant_debut'));
  return { du, au };
}
// Le curseur d'une page : la date et l'identifiant de la dernière écriture (ou ligne) vue.
const versCurseur = (date: string, id: string) => Buffer.from(JSON.stringify([date, id])).toString('base64url');
function depuisCurseur(texte: string | undefined): [string, string] | null {
  if (!texte) return null;
  try {
    const [d, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof d === 'string' && estJour(d) && typeof id === 'string' && uuid.safeParse(id).success) return [d, id];
  } catch { /* illisible : on repart du début */ }
  return null;
}

// Le solde d'un compte (et de ses sous-comptes) avant une date, ou avant une ligne de cette date.
async function soldeAvant(tx: Transaction, entreprise: string, compte: string, date: string | null, apres: [string, string] | null): Promise<bigint> {
  if (!date && !apres) return 0n;
  const borne = apres ? sql`(e.date_ecriture, l.id) <= (${apres[0]}::date, ${apres[1]}::uuid)` : sql`e.date_ecriture < ${date}::date`;
  const prefixe = `${compte}%`;
  const r = (await sql<{ solde: string | null }>`
    select sum(l.debit - l.credit)::text solde from compta.ligne l join compta.ecriture e on e.id = l.ecriture
     where l.entreprise = ${entreprise} and l.compte like ${prefixe} and ${borne}`.execute(requetes(tx))).rows[0];
  return BigInt(r?.solde ?? '0');
}

export function routesCompta(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Le journal, dans l'ordre des dates ; `journal` le restreint à un journal (VT, BQ…).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/ecritures', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const p = periode(query);
      if ('statut' in p) return p;
      if (query.journal !== undefined && !JOURNAUX.includes(query.journal)) return champInvalide('journal', t('compta.champ.journal'));
      const entreprise = params.entreprise ?? '';
      const n = limite(query);
      const apres = depuisCurseur(query.apres);
      const db = requetes(tx);
      const ecritures = await db.selectFrom('compta.ecriture').selectAll().where('entreprise', '=', entreprise)
        .$if(p.du !== null, (q) => q.where('date_ecriture', '>=', p.du ?? ''))
        .$if(p.au !== null, (q) => q.where('date_ecriture', '<=', p.au ?? ''))
        .$if(query.journal !== undefined, (q) => q.where('journal', '=', query.journal ?? ''))
        .$if(apres !== null, (q) => q.where(sql<boolean>`(date_ecriture, id) > (${apres?.[0] ?? ''}::date, ${apres?.[1] ?? ''}::uuid)`))
        .orderBy('date_ecriture').orderBy('id').limit(n).execute();
      const lignes = ecritures.length
        ? await db.selectFrom('compta.ligne').selectAll().where('ecriture', 'in', ecritures.map((e) => e.id)).orderBy('ecriture').orderBy('rang').execute()
        : [];
      // Les écritures déjà corrigées par un miroir validé : contre-passées, extournées (brique 38).
      const miroirs = ecritures.length
        ? await db.selectFrom('compta.ecriture').select(['origine', 'origine_type']).where('entreprise', '=', entreprise).where('statut', '=', 'validee')
          .where('origine_type', 'in', ['contre_passation', 'extourne']).where('origine', 'in', ecritures.map((e) => e.id)).execute()
        : [];
      const corrigee = (id: string, type: string) => miroirs.some((x) => x.origine === id && x.origine_type === type);
      // La lettre de chaque ligne lettrée (brique 38).
      const lettres = new Map(lignes.length
        ? (await db.selectFrom('compta.ligne_lettree as t').innerJoin('compta.lettrage as g', 'g.id', 't.lettrage')
          .select(['t.ligne', 'g.lettre']).where('t.ligne', 'in', lignes.map((l) => l.id)).execute()).map((x) => [x.ligne, x.lettre])
        : []);
      const dernier = ecritures.at(-1);
      return {
        corps: {
          ecritures: ecritures.map((e) => ({
            id: e.id, journal: e.journal, date: e.date_ecriture, piece: e.piece, libelle: e.libelle, statut: e.statut, numero: e.numero,
            // Son rang dans la chaîne des livres (validée) : l'ordre unique de validation, tous journaux confondus.
            chaine: e.chaine_rang === null ? null : Number(e.chaine_rang),
            origine: { type: e.origine_type, id: e.origine }, tiers: e.tiers,
            // La révision d'un brouillard saisi : on la renvoie pour le modifier (01 R15).
            revision: e.revision, valideeLe: e.validee_le,
            contrepassee: corrigee(e.id, 'contre_passation'), extournee: corrigee(e.id, 'extourne'),
            lignes: lignes.filter((l) => l.ecriture === e.id).map((l) => ({
              compte: l.compte, libelle: l.libelle, debit: m(l.debit), credit: m(l.credit), tauxTva: l.taux_tva === null ? null : versTexte(l.taux_tva, 4),
              tiers: l.tiers_libelle, lettre: lettres.get(l.id) ?? null,
            })),
          })),
          suite: ecritures.length === n && dernier ? versCurseur(dernier.date_ecriture, dernier.id) : null,
        },
      };
    },
  });

  // La balance : chaque compte mouvementé sur la période, et les totaux (ils sont égaux).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/balance', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const p = periode(query);
      if ('statut' in p) return p;
      const depuis = p.du ? sql`and e.date_ecriture >= ${p.du}::date` : sql``;
      const jusqua = p.au ? sql`and e.date_ecriture <= ${p.au}::date` : sql``;
      const lignes = (await sql<{ compte: string; debit: string; credit: string }>`
        select l.compte, sum(l.debit)::text debit, sum(l.credit)::text credit
          from compta.ligne l join compta.ecriture e on e.id = l.ecriture
         where l.entreprise = ${params.entreprise ?? ''} ${depuis} ${jusqua}
         group by l.compte order by l.compte`.execute(requetes(tx))).rows;
      let debit = 0n, credit = 0n;
      const comptes = lignes.map((l) => {
        const d = BigInt(l.debit), c = BigInt(l.credit);
        debit += d; credit += c;
        return { compte: l.compte, debit: m(d), credit: m(c), solde: m(d - c) };
      });
      return { corps: { du: p.du, au: p.au, comptes, totaux: { debit: m(debit), credit: m(credit) } } };
    },
  });

  // Le grand livre d'un compte et de ses sous-comptes (411 : 411, 411001…).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/grand-livre', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const p = periode(query);
      if ('statut' in p) return p;
      const compte = query.compte ?? '';
      if (!NUMERO_DE_COMPTE.test(compte)) return champInvalide('compte', t('compta.champ.compte'));
      const entreprise = params.entreprise ?? '';
      const n = limite(query);
      const apres = depuisCurseur(query.apres);
      const depuis = p.du ? sql`and e.date_ecriture >= ${p.du}::date` : sql``;
      const jusqua = p.au ? sql`and e.date_ecriture <= ${p.au}::date` : sql``;
      const apresLa = apres ? sql`and (e.date_ecriture, l.id) > (${apres[0]}::date, ${apres[1]}::uuid)` : sql``;
      const prefixe = `${compte}%`;
      const lignes = (await sql<{ id: string; date: string; journal: string; piece: string | null; compte: string; libelle: string; debit: string; credit: string }>`
        select l.id, e.date_ecriture::text date, e.journal, e.piece, l.compte, l.libelle, l.debit::text debit, l.credit::text credit
          from compta.ligne l join compta.ecriture e on e.id = l.ecriture
         where l.entreprise = ${entreprise} and l.compte like ${prefixe} ${depuis} ${jusqua} ${apresLa}
         order by e.date_ecriture, l.id limit ${n}`.execute(requetes(tx))).rows;
      // Le solde au début de la page : tout ce que le compte a porté avant elle (avant la période pour
      // la première page ; jusqu'à la dernière ligne vue pour les suivantes).
      let solde = await soldeAvant(tx, entreprise, compte, p.du, apres);
      const soldeDebut = solde;
      const dernier = lignes.at(-1);
      return {
        corps: {
          compte, du: p.du, au: p.au, soldeAvant: m(soldeDebut),
          lignes: lignes.map((l) => {
            solde += BigInt(l.debit) - BigInt(l.credit);
            return { date: l.date, journal: l.journal, piece: l.piece, compte: l.compte, libelle: l.libelle, debit: m(BigInt(l.debit)), credit: m(BigInt(l.credit)), solde: m(solde) };
          }),
          suite: lignes.length === n && dernier ? versCurseur(dernier.date, dernier.id) : null,
        },
      };
    },
  });

  // Valider une période (brique 35) : jusqu'à un jour passé, chaque brouillard prend son numéro et son
  // maillon, et la période se ferme. La base refait elle-même chaque contrôle (compta.valider).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/valider', geste: 'compta.ecritures.valider',
    corps: z.object({ jusqua: z.string().refine((v) => estJour(v), { message: 'compta.champ.jusqua' }) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query('select compta.valider($1, $2::date) n', [params.entreprise ?? '', corps.jusqua]);
      return { corps: { validees: Number(r.rows[0]?.n ?? 0), jusqua: corps.jusqua } };
    },
  });

  // La période close, et le contrôle des livres : la chaîne, et chaque écriture validée recalculée.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/cloture', geste: 'compta.livres.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const c = await requetes(tx).selectFrom('compta.cloture').select(['jusqua', 'le']).where('entreprise', '=', entreprise).executeTakeFirst();
      const controle = (await tx.query('select * from compta.controler($1)', [entreprise])).rows[0] as { ok: boolean; numero: string | null; motif: string | null };
      return { corps: { jusqua: c?.jusqua ?? null, le: c?.le ?? null, controle } };
    },
  });

  routes.push(...routesSaisie(ctx));
  return routes;
}
