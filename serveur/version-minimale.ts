// La version minimale imposée (pilotage depuis la console, point 6 ; base 0231). Après une correction importante, le
// titulaire de la console impose la version EN LIGNE : un écran ouvert avant (son code est plus ancien) voit un bandeau
// « recharge la page », et le serveur refuse ses enregistrements (426) — un vieux code n'écrit plus de travers.
//
// L'écran dit sa version dans l'en-tête `x-skanfact-code` (la marque de la page, serveur/ecrans.ts). Une requête qui ne la
// donne pas (une intégration par l'API, un outil) n'est jamais refusée : seul un écran qui se dit plus ancien l'est.
// Comme la lecture seule, elle se relit au plus toutes les cinq secondes ; les gestes de la console l'oublient tout de
// suite. La base illisible : rien n'est refusé.

import { z } from 'zod';
import type { Route } from './app.ts';
import { enTantQue, type Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';
import { motif, rendre, t, type Texte } from '../textes/index.ts';
import './version-minimale/textes.ts';

export type VersionMinimale = { id: number; version: string; message: string | null } | null;
const RELIRE_MS = 5_000;
let gardee: { le: number; valeur: VersionMinimale } | null = null;
export const oublierLaVersionMinimale = () => { gardee = null; };

// Le numéro d'une version (« 1.388.76 », ou la marque entière « 1.388.76 · abc1234 ») : trois nombres, sinon rien.
export function numeroDe(code: unknown): [number, number, number] | null {
  if (typeof code !== 'string') return null;
  const m = /^\s*(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:\s|$|-)/.exec(code);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export const texteDuNumero = (n: [number, number, number]) => n.join('.');

// Cet écran est-il plus ancien que le minimum ? Un écran qui ne se dit pas, ou dont la version ne se lit pas, ne l'est
// jamais (une intégration par l'API, ou « dev » : rien à comparer).
export function plusAncien(code: unknown, minimale: string): boolean {
  const a = numeroDe(code), b = numeroDe(minimale);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export async function lireVersionMinimale(ctx: Contexte): Promise<VersionMinimale> {
  const ici = Date.now();
  if (gardee && ici - gardee.le < RELIRE_MS) return gardee.valeur;
  let valeur: VersionMinimale;
  try {
    const v = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.version_minimale_en_vigueur() v')).rows[0]?.v);
    valeur = v && typeof v.version === 'string' ? { id: Number(v.id), version: v.version, message: typeof v.message === 'string' ? v.message : null } : null;
  } catch { valeur = null; }
  gardee = { le: ici, valeur };
  return valeur;
}

export type RefusVersion = { motif: Texte; versionTropAncienne: { minimale: string; message: string | null } };
export async function refusVersionMinimale(ctx: Contexte, code: unknown): Promise<RefusVersion | null> {
  if (!numeroDe(code)) return null;
  const v = await lireVersionMinimale(ctx);
  if (!v || !plusAncien(code, v.version)) return null;
  return {
    motif: v.message ? motif('version_minimale.motif_message', { message: v.message }) : motif('version_minimale.motif'),
    versionTropAncienne: { minimale: v.version, message: v.message },
  };
}

// Le bandeau que l'application pose en haut de chaque page (message.js, sorte « version ») : il passe devant tout autre
// message, et il ne se cache pas.
export async function bandeauVersionMinimale(tx: Transaction, code: unknown, jour: string): Promise<{ id: string; sorte: 'version'; texte: string; du: string; au: string } | null> {
  if (!numeroDe(code)) return null;
  const v = (await tx.query('select plateforme.version_minimale_en_vigueur() v')).rows[0]?.v as { id?: unknown; version?: unknown; message?: unknown } | null | undefined;
  if (!v || typeof v.version !== 'string' || !plusAncien(code, v.version)) return null;
  const texte = rendre(t('version_minimale.bandeau'), 'fr');
  return { id: `version-${String(v.id)}`, sorte: 'version', texte: typeof v.message === 'string' && v.message ? `${texte} ${v.message}` : texte, du: jour, au: jour };
}

// Les routes de la console : lire, imposer la version en ligne, retirer.
export function routesVersionMinimale(ctx: Contexte): Route<never>[] {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const transaction = (tx: Transaction | null): Transaction => { if (!tx) throw new Error('transaction attendue'); return tx; };
  const enLigne = () => { const n = numeroDe(ctx.version); return n ? texteDuNumero(n) : null; };
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'GET', chemin: '/console/version-minimale', geste: 'console.version_minimale.voir',
    traiter: async (_, tx) => ({ corps: { ...(await transaction(tx).query('select plateforme.console_version_minimale() v')).rows[0]?.v, enLigne: enLigne() } }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/version-minimale', geste: 'console.version_minimale.poser',
    corps: z.object({ motif: z.string().max(500), message: z.string().max(300).nullable().optional(), retirer: z.boolean().optional() }),
    traiter: async ({ corps }, tx) => {
      const version = corps.retirer ? null : enLigne();
      if (!corps.retirer && !version) return { statut: 409, corps: { motif: motif('version_minimale.sans_numero') } };
      const id = (await transaction(tx).query('select plateforme.console_poser_version_minimale($1, $2, $3, $4) v', [version, corps.retirer ? null : (corps.message ?? null), corps.motif, maintenant()])).rows[0]?.v;
      oublierLaVersionMinimale();
      return { corps: { id: Number(id), version } };
    },
  });
  return routes;
}
