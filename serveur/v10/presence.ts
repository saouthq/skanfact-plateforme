// La présence sur une pièce (maquette de la facture, « Karim l'ouvre aussi » ; décidé par Skander le 26/10/2026 :
// « oui je la veux »). Pendant qu'une pièce est ouverte, l'écran dit au serveur, toutes les 20 secondes : cette
// pièce, et si la personne y écrit. Ce qui part, compté et décidé : l'identifiant de la pièce et « j'écris » (oui
// ou non) ; le serveur y joint le nom de la personne. Il le garde EN MÉMOIRE seulement, jamais en base ni dans une
// sauvegarde, et l'oublie 45 secondes après le dernier signe (ou dès qu'on quitte la pièce). Chacun ne voit que
// les autres personnes de SON entreprise sur la MÊME pièce.

import type { Route } from '../app.ts';

export type Present = { nom: string; ecrit: boolean; depuis: number };
type Vu = Present & { vu: number };

export const DUREE_PRESENCE = 45_000;
const PLAFOND = 20_000;
const pieces = new Map<string, Map<string, Vu>>();
let total = 0;

function oublierLesVieux(maintenant: number) {
  for (const [k, gens] of pieces) {
    for (const [u, v] of gens) if (maintenant - v.vu > DUREE_PRESENCE) { gens.delete(u); total--; }
    if (!gens.size) pieces.delete(k);
  }
}

// Noter la personne sur la pièce (ou l'en retirer), et rendre les AUTRES qui y sont, du plus ancien au plus récent.
export function noterPresence(entreprise: string, piece: string, utilisateur: string, nom: string, ecrit: boolean, quitte: boolean, maintenant = Date.now()): Present[] {
  const k = `${entreprise}/${piece}`;
  let gens = pieces.get(k);
  if (quitte) {
    if (gens && gens.delete(utilisateur)) total--;
    if (gens && !gens.size) pieces.delete(k);
    return [];
  }
  if (total >= PLAFOND) oublierLesVieux(maintenant);
  if (!gens) { gens = new Map(); pieces.set(k, gens); }
  const avant = gens.get(utilisateur);
  if (!avant && total >= PLAFOND) return [];
  if (!avant) total++;
  gens.set(utilisateur, { nom, ecrit, depuis: avant ? avant.depuis : maintenant, vu: maintenant });
  return [...gens.entries()]
    .filter(([u, v]) => u !== utilisateur && maintenant - v.vu <= DUREE_PRESENCE)
    .map(([, v]) => ({ nom: v.nom, ecrit: v.ecrit, depuis: v.depuis }))
    .sort((a, b) => a.depuis - b.depuis);
}

export function routesPresence(): Route<never>[] {
  return [{
    // Une lecture (GET) : quelqu'un en lecture seule (l'abonnement, le rôle « Lecture ») voit aussi qui est là.
    methode: 'GET', chemin: '/entreprises/:entreprise/presence', geste: 'socle.dossier.voir',
    traiter: async ({ params, query, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const piece = String(query.piece ?? '');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(piece)) return { statut: 400, corps: { autres: [] } };
      const nom = String((await tx.query('select coalesce(nom, \'\') nom from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0]?.nom ?? '');
      const autres = noterPresence(params.entreprise ?? '', piece, qui.utilisateur, nom, query.ecrit === '1', query.quitte === '1');
      return { corps: { autres: autres.map((x) => ({ nom: x.nom, ecrit: x.ecrit, depuis: new Date(x.depuis).toISOString() })) } };
    },
  }];
}
