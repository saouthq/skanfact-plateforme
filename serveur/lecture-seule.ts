// La lecture seule générale (pilotage depuis la console, point 5 ; base 0230). Le titulaire de la console met le site en
// lecture seule pendant une grosse opération sur la base : les clients lisent tout (leurs pièces, leurs comptes, leurs PDF),
// et chaque geste qui ÉCRIT reçoit 503 avec une phrase qui dit jusqu'à quand. La console reste ouverte, l'entrée aussi
// (se connecter ne change aucune donnée d'une entreprise), se déconnecter et configurer son code aussi.
//
// Comme la fermeture (fermeture.ts), elle se relit au plus toutes les cinq secondes ; les gestes de la console l'oublient
// tout de suite. La base illisible : rien n'est refusé (une panne de la lecture ne bloque personne).

import { z } from 'zod';
import type { Route } from './app.ts';
import { enTantQue, type Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';
import { GESTES, GESTES_PERSONNELS } from './porte/gestes.ts';
import { finDite } from './fermeture.ts';
import { motif, rendre, t, type Texte } from '../textes/index.ts';
import './lecture-seule/textes.ts';


export type LectureSeule = { id: number; message: string | null; fin: string } | null;
const RELIRE_MS = 5_000;
let gardee: { le: number; valeur: LectureSeule } | null = null;
// Les gestes de la console (poser, lever) : la prochaine requête relit la base.
export const oublierLaLectureSeule = () => { gardee = null; };

export async function lireLectureSeule(ctx: Contexte, maintenant: Date): Promise<LectureSeule> {
  const t = Date.now();
  if (gardee && t - gardee.le < RELIRE_MS) return gardee.valeur;
  let valeur: LectureSeule;
  try {
    const v = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.lecture_seule_en_cours($1) v', [maintenant.toISOString()])).rows[0]?.v);
    valeur = v && typeof v.fin === 'string' ? { id: Number(v.id), message: typeof v.message === 'string' ? v.message : null, fin: v.fin } : null;
  } catch { valeur = null; }
  gardee = { le: t, valeur };
  return valeur;
}

// Ce qui reste permis pendant la lecture seule : se déconnecter, configurer son code (sans lui, la personne n'entre nulle
// part), faire le PDF de ce qu'on voit (rien n'est écrit). Tout le reste qui écrit est refusé.
const PERMIS = new Set(['compte.deconnecter', 'compte.code.configurer', 'compte.pdf.imprimer', 'compte.voir']);
const PERSONNELS = new Set<string>(GESTES_PERSONNELS);

// Ce geste, avec cette méthode, écrit-il ? Un geste d'entreprise le dit (`ecrit`) ; un geste personnel écrit dès qu'il
// n'est pas une lecture (GET), sauf ceux qui restent permis.
export function ecritPendantLectureSeule(geste: string, methode: string): boolean {
  if (methode === 'GET' || PERMIS.has(geste)) return false;
  const g = GESTES.get(geste);
  if (g) return g.ecrit;
  return PERSONNELS.has(geste) && geste !== 'public';
}

export function refusLectureSeule(l: NonNullable<LectureSeule>, maintenant: Date): { motif: Texte; lectureSeule: { fin: string; message: string | null }; attendreSecondes: number } {
  const fin = finDite(l.fin, maintenant);
  return {
    motif: l.message ? motif('lecture_seule.motif_message', { fin, message: l.message }) : motif('lecture_seule.motif', { fin }),
    lectureSeule: { fin: l.fin, message: l.message },
    attendreSecondes: Math.max(60, Math.round((Date.parse(l.fin) - maintenant.getTime()) / 1000)),
  };
}

// Le bandeau que l'application pose en haut de chaque page (message.js, sorte « lecture ») : la lecture seule en cours, ou
// celle prévue dans les vingt-quatre heures. Il prend la place du message du jour, plus urgent que lui.
export type BandeauLecture = { id: string; sorte: 'lecture' | 'lecture_prevue'; texte: string; du: string; au: string };
export async function bandeauLectureSeule(tx: Transaction, maintenant: Date): Promise<BandeauLecture | null> {
  const r = (await tx.query('select plateforme.lecture_seule_en_cours($1) c, plateforme.lecture_seule_prevue($1) p', [maintenant.toISOString()])).rows[0] as { c: Record<string, unknown> | null; p: Record<string, unknown> | null } | undefined;
  const jour = (iso: string) => iso.slice(0, 10);
  const ajoute = (base: string, m: unknown) => (typeof m === 'string' && m.trim() ? `${base} ${m.trim()}` : base);
  if (r?.c && typeof r.c.fin === 'string') {
    return { id: `lecture-${String(r.c.id)}`, sorte: 'lecture', texte: ajoute(rendre(t('lecture_seule.bandeau', { fin: finDite(r.c.fin, maintenant) }), 'fr'), r.c.message), du: jour(maintenant.toISOString()), au: jour(r.c.fin) };
  }
  if (r?.p && typeof r.p.debut === 'string' && typeof r.p.fin === 'string') {
    return { id: `lecture-prevue-${String(r.p.id)}`, sorte: 'lecture_prevue', texte: ajoute(rendre(t('lecture_seule.bandeau_prevu', { debut: finDite(r.p.debut, maintenant), fin: finDite(r.p.fin, maintenant) }), 'fr'), r.p.message), du: jour(maintenant.toISOString()), au: jour(r.p.fin) };
  }
  return null;
}

// Les routes de la console : lire, poser (tout de suite ou à une heure donnée), lever ou annuler.
export function routesLectureSeule(ctx: Contexte): Route<never>[] {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const transaction = (tx: Transaction | null): Transaction => { if (!tx) throw new Error('transaction attendue'); return tx; };
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'GET', chemin: '/console/lecture-seule', geste: 'console.lecture_seule.voir',
    traiter: async (_, tx) => ({ corps: (await transaction(tx).query('select plateforme.console_lectures_seules($1) v', [maintenant()])).rows[0]?.v }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/lecture-seule', geste: 'console.lecture_seule.poser',
    corps: z.object({ motif: z.string().max(500), message: z.string().max(300).nullable().optional(), debut: z.string().datetime({ offset: true }).nullable().optional(), fin: z.string().datetime({ offset: true }) }),
    traiter: async ({ corps }, tx) => {
      const id = (await transaction(tx).query('select plateforme.console_poser_lecture_seule($1, $2, $3, $4, $5) v', [corps.message ?? null, corps.debut ?? null, corps.fin, corps.motif, maintenant()])).rows[0]?.v;
      oublierLaLectureSeule();
      return { corps: { id: Number(id) } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/lecture-seule/lever', geste: 'console.lecture_seule.poser',
    corps: z.object({ id: z.number().int().positive(), motif: z.string().max(500) }),
    traiter: async ({ corps }, tx) => {
      await transaction(tx).query('select plateforme.console_lever_lecture_seule($1, $2, $3)', [corps.id, corps.motif, maintenant()]);
      oublierLaLectureSeule();
      return { corps: { ok: true } };
    },
  });
  return routes;
}
