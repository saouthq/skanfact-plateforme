// Les tours du serveur notent leur passage (Console 3e ; docs/console.md C25) : le facteur de la TTN, le filet des
// paiements, le livreur des avis, le postier, les contrats, les relances, le mesureur. Sans cette trace, un tour arrêté
// ne se voit nulle part : le serveur répond, et plus rien ne part.
//
// Un passage note son heure, sa durée, s'il a réussi, et ce qu'il a fait quand le tour le rend en nombres (jamais un
// contenu). Noter ne fait jamais échouer le tour : une base qui ne répond pas perd une trace, pas un envoi.

import type pg from 'pg';
import { enTantQue } from '../base.ts';

// Les nombres nommés d'un résultat ({ contrats: 3, emises: 2 }), rien d'autre.
export function compteDe(resultat: unknown): Record<string, number> {
  if (!resultat || typeof resultat !== 'object' || Array.isArray(resultat)) return {};
  return Object.fromEntries(Object.entries(resultat as Record<string, unknown>)
    .filter(([k, v]) => /^[A-Za-z]{1,40}$/.test(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0)) as Record<string, number>;
}

export async function noterTour(pool: pg.Pool, nom: string, debut: number, ok: boolean, resultat: unknown, echec: string | null): Promise<void> {
  try {
    await enTantQue(pool, null, async (tx) => {
      await tx.query('select plateforme.noter_tour($1, $2, $3, $4, $5::jsonb, $6)',
        [nom, new Date().toISOString(), Math.max(0, Date.now() - debut), ok, JSON.stringify(compteDe(resultat)), echec]);
    });
  } catch { /* la trace d'un tour ne fait jamais échouer le tour */ }
}

// La nature d'une erreur, jamais son message : un message peut citer une donnée de client, et la trace se lit dans la
// console par la technique. Son code (ECONNREFUSED, 57014) ou le nom de sa classe.
export function natureDe(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  return e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Erreur';
}

// Un tour suivi : le travail, puis sa trace ; l'erreur, elle, continue vers qui la notait déjà.
export function suivreTour<T>(pool: pg.Pool, nom: string, travail: () => Promise<T>): Promise<T> {
  const debut = Date.now();
  return travail().then(
    async (r) => { await noterTour(pool, nom, debut, true, r, null); return r; },
    async (e: unknown) => { await noterTour(pool, nom, debut, false, null, natureDe(e)); throw e; },
  );
}
