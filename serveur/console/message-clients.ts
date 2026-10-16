// Le message affiché en haut de l'application des clients (docs/console.md C28 ; base 0093) : la direction l'écrit dans la
// console (Réglages, « Messages aux clients ») ; l'application le lit ici, au chargement et à chaque relecture de
// l'abonnement. La route ne rend que le texte, sa sorte et ses deux jours — jamais qui l'a écrit, ni son motif (une note
// de SkanFact), ni son public.
// Depuis 0139 (C63) : un message peut viser un public (en essai, Essentiel, Complet, en retard, en lecture seule) ; le
// serveur compare à l'état de l'abonnement de l'entreprise de la page, et ne rend rien à celle qu'il ne vise pas. Et
// l'application dit qu'elle l'a montré, puis caché : le message et l'entreprise seuls (la liste comptée et décidée), la
// base y ajoute l'instant ; jamais la personne ni l'appareil.

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import { faitsDe } from '../abonnement/condition.ts';
import { etatAbonnement } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { lireCible, publicsDe, vise as viseLesPublics } from './diffusion.ts';

export type MessageClients = { id: string; sorte: 'nouveaute' | 'maintenance'; texte: string; du: string; au: string };

export function lireMessageClients(brut: unknown): MessageClients | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const m = brut as Record<string, unknown>;
  const jour = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const sorte = m.sorte === 'nouveaute' || m.sorte === 'maintenance' ? m.sorte : null;
  const du = jour(m.du), au = jour(m.au);
  if (typeof m.id !== 'string' || typeof m.texte !== 'string' || !m.texte.trim() || !sorte || !du || !au) return null;
  return { id: m.id, sorte, texte: m.texte, du, au };
}

// Ce message vise-t-il cette entreprise aujourd'hui ? Son public, comparé à l'état de son abonnement (la même fonction que
// son onglet « Ton abonnement ») ; sans public, il vise tout le monde. La lecture et la diffusion passent par ici : une
// entreprise que le message ne vise pas ne le lit pas, et ne compte pas dans ceux qui l'ont vu.
async function vise(tx: Transaction, entreprise: string, message: string, jour: string): Promise<boolean> {
  const cible = lireCible((await tx.query('select plateforme.cible_du_message($1) c', [message])).rows[0]?.c);
  if (!cible.length) return true;
  const f = await faitsDe(tx, entreprise);
  return viseLesPublics(cible, f ? publicsDe(etatAbonnement(f, jour), f.offre) : []);
}

export function routesMessageClients(maintenant: () => Date = () => new Date()): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/message', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = aujourdhuiATunis(maintenant());
      const m = lireMessageClients((await tx.query('select plateforme.message_du_jour($1::date) m', [jour])).rows[0]?.m);
      return { corps: { aujourdhui: jour, message: m && await vise(tx, params.entreprise ?? '', m.id, jour) ? m : null } };
    },
  });
  // Montré, puis caché (« Plus tard ») : la base note l'entreprise et l'instant, une fois chacun.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/message/:message/diffusion', geste: 'socle.accueil.voir',
    corps: z.object({ cache: z.boolean() }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!/^[0-9a-f-]{36}$/.test(params.message ?? '')) return { corps: { note: false } };
      const ici = maintenant(), jour = aujourdhuiATunis(ici);
      if (!await vise(tx, params.entreprise ?? '', params.message ?? '', jour)) return { corps: { note: false } };
      const r = await tx.query('select plateforme.noter_diffusion($1::uuid, $2::uuid, $3, $4, $5::date) v',
        [params.message, params.entreprise, corps.cache, ici, jour]);
      return { corps: { note: r.rows[0]?.v === true } };
    },
  });
  return routes;
}
