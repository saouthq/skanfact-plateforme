// L'effet de chaque version (1.48.0 ; base 0140 ; docs/console.md C64 ; la liste des fonctions qui manquent, 38), pur :
// les périodes où chaque version a tourné (lues dans l'histoire des installations, serveur/console/versions.ts), ce que la
// base en dit (lu prudemment), et la comparaison avec la version d'avant. Rien n'est inventé : une période sans
// requêtes ne juge rien ; un centile ne se lit que sur assez de requêtes (LECTURES_POUR_UN_CENTILE).

import { histogrammeVide, fusionner, LECTURES_POUR_UN_CENTILE, quantile } from '../service/mesures.ts';

// Les dix dernières versions qui ont tourné : au-delà, la base n'a plus leurs heures (service_heure se garde 35 jours).
export const PERIODES_MAX = 10;
// « À regarder » (décidé par délégation le 16/10/2026) : des pannes au moins deux fois plus fréquentes qu'avant et au-delà
// d'une sur deux cents ; un 95e centile plus lent d'un quart ; deux fois plus de demandes au support par jour, trois au
// moins.
export const PANNES_FOIS = 2;
export const PANNES_PART_MIN = 0.005;
export const P95_FOIS = 1.25;
export const DEMANDES_FOIS = 2;
export const DEMANDES_MIN = 3;

export type Periode = { version: string; debut: string; fin: string };
export type Incident = { id: string; annee: number; numero: number; titre: string; gravite: 'mineur' | 'majeur' | 'critique'; ouvertLe: string };
export type Effet = {
  version: string; debut: string; fin: string; jours: number;
  requetes: number; pannes: number; part: number | null; p95: number | null;
  incidents: Incident[]; demandes: number | null; clients: number | null;
  // Ce qui est pire qu'avec la version d'avant (vide : rien, ou rien à comparer).
  pire: ('pannes' | 'lenteur' | 'incidents' | 'demandes')[];
};

// Les périodes : chaque installation réussie tourne jusqu'à la réussie qui la suit ; celle en service, jusqu'à maintenant.
export function periodes(lignes: readonly { version: string; le: string; ok: boolean; statut: string }[], maintenant: Date): Periode[] {
  const ok = lignes.filter((l) => l.ok && Number.isFinite(Date.parse(l.le))).sort((a, b) => Date.parse(b.le) - Date.parse(a.le));
  return ok.slice(0, PERIODES_MAX).map((l, i) => ({ version: l.version, debut: l.le, fin: i === 0 ? maintenant.toISOString() : (ok[i - 1] as { le: string }).le }))
    .filter((p) => Date.parse(p.fin) > Date.parse(p.debut));
}

const entier = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const GRAVITES = ['mineur', 'majeur', 'critique'] as const;

export function lireEffets(brut: unknown): Effet[] {
  if (!Array.isArray(brut)) return [];
  const lus = brut.flatMap((x): Effet[] => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const debut = instant(o.debut), fin = instant(o.fin), requetes = entier(o.requetes), pannes = entier(o.pannes);
    if (typeof o.version !== 'string' || !debut || !fin || requetes === null || pannes === null || pannes > requetes) return [];
    const h = fusionner(histogrammeVide(), Array.isArray(o.seaux) ? o.seaux.map((n) => Number(n) || 0) : []);
    const incidents = Array.isArray(o.incidents) ? o.incidents.flatMap((i): Incident[] => {
      const r = (i ?? {}) as Record<string, unknown>;
      const g = GRAVITES.find((x) => x === r.gravite), le = instant(r.ouvertLe), annee = entier(r.annee), numero = entier(r.numero);
      return typeof r.id === 'string' && typeof r.titre === 'string' && g && le && annee !== null && numero !== null ? [{ id: r.id, annee, numero, titre: r.titre, gravite: g, ouvertLe: le }] : [];
    }) : [];
    return [{ version: o.version, debut, fin, jours: Math.max((Date.parse(fin) - Date.parse(debut)) / 86_400_000, 1 / 24),
      requetes, pannes, part: requetes > 0 ? pannes / requetes : null, p95: requetes >= LECTURES_POUR_UN_CENTILE ? quantile(h, 0.95) : null,
      incidents, demandes: entier(o.demandes), clients: entier(o.clients), pire: [] }];
  });
  // La plus récente d'abord ; chacune se compare à celle qui la précède dans le temps.
  lus.sort((a, b) => Date.parse(b.debut) - Date.parse(a.debut));
  return lus.map((e, i) => ({ ...e, pire: pire(e, lus[i + 1] ?? null) }));
}

export function pire(e: Effet, avant: Effet | null): Effet['pire'] {
  if (!avant) return [];
  const p: Effet['pire'] = [];
  if (e.part !== null && avant.part !== null && e.part >= PANNES_PART_MIN && e.part >= PANNES_FOIS * avant.part) p.push('pannes');
  if (e.p95 !== null && avant.p95 !== null && e.p95 >= P95_FOIS * avant.p95) p.push('lenteur');
  if (e.incidents.some((i) => i.gravite !== 'mineur')) p.push('incidents');
  if (e.demandes !== null && avant.demandes !== null && e.demandes >= DEMANDES_MIN && e.demandes / e.jours >= DEMANDES_FOIS * (avant.demandes / avant.jours)) p.push('demandes');
  return p;
}
