// L'effet de chaque version, pur (serveur/console/impact.ts ; base 0140 ; docs/console.md C64) : les périodes où chaque
// version a tourné, ce que la base en dit (lu prudemment), et ce qui est pire qu'avec la version d'avant — rien jugé sur
// trop peu : un centile attend assez de requêtes, des pannes plus fréquentes doivent aussi être nombreuses.

import { describe, expect, it } from 'vitest';
import { DEMANDES_FOIS, DEMANDES_MIN, lireEffets, P95_FOIS, PANNES_FOIS, PANNES_PART_MIN, periodes, PERIODES_MAX, pire, type Effet } from '../../serveur/console/impact.ts';
import { LECTURES_POUR_UN_CENTILE } from '../../serveur/service/mesures.ts';

const ligne = (version: string, le: string, ok = true) => ({ version, le, ok, statut: ok ? 'remplacee' : 'echouee' });
const effet = (x: Partial<Effet>): Effet => ({ version: 'v', debut: '2026-10-01T00:00:00Z', fin: '2026-10-02T00:00:00Z', jours: 1, requetes: 1000, pannes: 0,
  part: 0, p95: 100, incidents: [], demandes: 0, clients: 0, pire: [], ...x });

describe('l\'effet de chaque version (0140, C64)', () => {
  it('chaque installation réussie tourne jusqu\'à la réussie suivante ; celle en service, jusqu\'à maintenant ; une ratée ne fait pas de période', () => {
    const maintenant = new Date('2026-10-16T12:00:00Z');
    expect(periodes([ligne('1.46.0', '2026-10-15T10:00:00Z'), ligne('1.46.1', '2026-10-16T09:00:00Z'), ligne('1.47.0', '2026-10-16T10:00:00Z', false)], maintenant)).toEqual([
      { version: '1.46.1', debut: '2026-10-16T09:00:00Z', fin: '2026-10-16T12:00:00.000Z' },
      { version: '1.46.0', debut: '2026-10-15T10:00:00Z', fin: '2026-10-16T09:00:00Z' },
    ]);
    const beaucoup = Array.from({ length: PERIODES_MAX + 3 }, (_, i) => ligne(`1.${i}.0`, new Date(Date.UTC(2026, 9, 1, i)).toISOString()));
    expect(periodes(beaucoup, maintenant)).toHaveLength(PERIODES_MAX);
  });

  it('ce que la base rend se lit prudemment : une période illisible n\'existe pas, des pannes au-delà des requêtes non plus', () => {
    const seaux = new Array(47).fill(0);
    seaux[10] = LECTURES_POUR_UN_CENTILE;
    const lus = lireEffets([
      { version: '1.47.0', debut: '2026-10-16T09:00:00Z', fin: '2026-10-16T12:00:00Z', requetes: '400', pannes: 4, seaux, incidents: [{ id: 'i', annee: 2026, numero: 3, titre: 'Lenteur', gravite: 'majeur', ouvertLe: '2026-10-16T10:00:00Z' }, { id: 'x', gravite: 'grave' }], demandes: 2, clients: 1 },
      { version: '1.46.0', debut: '2026-10-15T09:00:00Z', fin: '2026-10-16T09:00:00Z', requetes: 10, pannes: 0, seaux, incidents: [], demandes: null, clients: null },
      { version: '1.45.0', debut: '2026-10-14T09:00:00Z', fin: '2026-10-15T09:00:00Z', requetes: 3, pannes: 5 },
      { version: 'ratée', debut: 'hier', fin: '2026-10-15T09:00:00Z', requetes: 1, pannes: 0 },
    ]);
    expect(lus.map((e) => e.version)).toEqual(['1.47.0', '1.46.0']);
    expect(lus[0]).toMatchObject({ requetes: 400, pannes: 4, part: 0.01, incidents: [{ id: 'i', numero: 3 }], demandes: 2, clients: 1, jours: 0.125 });
    expect(lus[0]?.p95).not.toBeNull();
    // Dix requêtes : pas de centile, et la technique ne lit pas les demandes (null, jamais 0).
    expect(lus[1]).toMatchObject({ p95: null, demandes: null, clients: null, pire: [] });
    expect(lireEffets('rien')).toEqual([]);
  });

  it('pire qu\'avant : des pannes deux fois plus fréquentes ET nombreuses ; un centile plus lent d\'un quart ; un incident majeur ; deux fois plus de demandes par jour, trois au moins', () => {
    const avant = effet({ part: 0.004, p95: 200, demandes: 2, jours: 2 });
    expect(PANNES_FOIS).toBe(2); expect(PANNES_PART_MIN).toBe(0.005); expect(P95_FOIS).toBe(1.25); expect(DEMANDES_FOIS).toBe(2); expect(DEMANDES_MIN).toBe(3);
    expect(pire(effet({ part: 0.008, p95: 249, demandes: 2 }), avant)).toEqual(['pannes']);
    expect(pire(effet({ part: 0.0079, p95: 250 }), avant)).toEqual(['lenteur']);
    // Deux fois plus de pannes, mais si peu : rien.
    expect(pire(effet({ part: 0.004 }), effet({ part: 0.002 }))).toEqual([]);
    expect(pire(effet({ incidents: [{ id: 'm', annee: 2026, numero: 1, titre: 't', gravite: 'mineur', ouvertLe: '2026-10-01T01:00:00Z' }] }), avant)).toEqual([]);
    expect(pire(effet({ incidents: [{ id: 'c', annee: 2026, numero: 2, titre: 't', gravite: 'critique', ouvertLe: '2026-10-01T01:00:00Z' }] }), avant)).toEqual(['incidents']);
    // Trois demandes en un jour, contre deux en deux jours (une par jour) : plus de deux fois plus.
    expect(pire(effet({ demandes: 3, jours: 1 }), avant)).toEqual(['demandes']);
    expect(pire(effet({ demandes: 2, jours: 1 }), avant)).toEqual([]);
    expect(pire(effet({ part: 1 }), null)).toEqual([]);
  });
});
