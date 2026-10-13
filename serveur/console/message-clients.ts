// Le message affiché en haut de l'application de tous les clients (docs/console.md C28 ; base 0093) : la direction
// l'écrit dans la console (Réglages, « Messages aux clients ») ; l'application le lit ici, au chargement et à chaque
// relecture de l'abonnement. Le même pour tout le monde : ni l'entreprise ni la personne n'y entrent, et la route ne rend
// que le texte, sa sorte et ses deux jours — jamais qui l'a écrit, ni son motif (une note de SkanFact).

import type { Route } from '../app.ts';
import { aujourdhuiATunis } from '../reglements.ts';

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

export function routesMessageClients(maintenant: () => Date = () => new Date()): Route<never>[] {
  return [{
    methode: 'GET', chemin: '/entreprises/:entreprise/message', geste: 'socle.accueil.voir',
    traiter: async (_r, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = aujourdhuiATunis(maintenant());
      const m = (await tx.query('select plateforme.message_du_jour($1::date) m', [jour])).rows[0]?.m;
      return { corps: { aujourdhui: jour, message: lireMessageClients(m) } };
    },
  } as Route<never>];
}
