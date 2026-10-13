// Les performances du service, rangées pour la console (serveur/console/performances.ts ; docs/console.md C15).
import { describe, expect, it } from 'vitest';
import {
  BUDGETS_VISION, budgets, comparable, etatDePart, exemplaires, GARDE_MS, laBase, LENTE_MS, lentes, periodeDAvant, routes, SILENCE_MIN,
} from '../../serveur/console/performances.ts';
import { BUDGETS, LECTURES_POUR_UN_CENTILE, NB_SEAUX, SEAUX_MS } from '../../serveur/service/mesures.ts';

const seaux = (parSeau: Record<number, number>) => Array.from({ length: NB_SEAUX }, (_, i) => parSeau[i] ?? 0);
const i = (ms: number) => SEAUX_MS.indexOf(ms);

describe('les budgets de la vision', () => {
  it('ceux du serveur viennent des budgets écrits une fois (mesures.ts) ; ceux du poste et ceux sans sorte disent pourquoi', () => {
    expect(BUDGETS_VISION.find((b) => b.id === 'liste')?.budget).toBe(BUDGETS.lecture);
    expect(BUDGETS_VISION.find((b) => b.id === 'caisse')?.budget).toBe(BUDGETS.caisse);
    expect(BUDGETS_VISION.find((b) => b.id === 'comptes')?.budget).toBe(BUDGETS.comptes);
    for (const b of BUDGETS_VISION) expect(b.sorte === null).toBe(b.raison !== null);
    expect(BUDGETS_VISION.filter((b) => b.ou === 'poste').every((b) => b.raison === 'poste')).toBe(true);
  });

  it('moins de 80 % du budget, bon ; jusqu\'au budget, à regarder ; au-delà, grave', () => {
    expect([0.5, 0.79, 0.8, 1, 1.01].map(etatDePart)).toEqual(['bon', 'bon', 'attention', 'attention', 'grave']);
  });

  it('rien n\'est vert sans une mesure : trop peu de requêtes pour un centile, ou aucune, se disent « non mesuré »', () => {
    const l = budgets({ lecture: { lectures: 400, p95: 240 }, caisse: { lectures: LECTURES_POUR_UN_CENTILE - 1, p95: 80 } });
    expect(l.find((b) => b.id === 'liste')).toMatchObject({ etat: 'attention', p95: 240, part: 0.8, lectures: 400 });
    // Dix-neuf requêtes : la mesure existe, elle ne se juge pas.
    expect(l.find((b) => b.id === 'caisse')).toMatchObject({ etat: 'nonmesure', p95: null, part: null, lectures: 19, trop: true });
    // Aucune : rien à dire, et aucune part inventée.
    expect(l.find((b) => b.id === 'comptes')).toMatchObject({ etat: 'nonmesure', p95: null, part: null, lectures: 0, trop: false });
    expect(l.find((b) => b.id === 'application')).toMatchObject({ etat: 'nonmesure', raison: 'poste' });
  });

  it('un centile au-delà de la dernière borne (une minute) est grave, sans part chiffrée', () => {
    expect(budgets({ comptes: { lectures: 50, p95: Infinity } }).find((b) => b.id === 'comptes')).toMatchObject({ etat: 'grave', part: Infinity });
  });
});

describe('les routes du serveur', () => {
  it('une ligne illisible tombe ; une route garde sa méthode, son chemin, ses centiles et ses lentes', () => {
    const l = routes([
      ['GET /entreprises/:entreprise/compta/balance', 'comptes', 30, 1, seaux({ [i(300)]: 25, [i(1500)]: 4, [i(1000)]: 1 })],
      ['GET /entreprises/:entreprise/ventes', 'lecture', 3, 0, seaux({ [i(50)]: 3 })],
      ['n\'importe quoi', 'lecture', 1, 0, []],
      ['GET /x', 'inconnue', 1, 0, []],
      'rien',
    ]);
    expect(l.map((r) => r.route)).toEqual(['GET /entreprises/:entreprise/compta/balance', 'GET /entreprises/:entreprise/ventes']);
    expect(l[0]).toMatchObject({ methode: 'GET', chemin: '/entreprises/:entreprise/compta/balance', sorte: 'comptes', n: 30, pannes: 1, p50: 300, p95: 1500, lentes: 4 });
    expect(l[0]?.partPannes).toBeCloseTo(1 / 30);
    // Trois requêtes : trop peu pour un centile ; ses lentes se comptent quand même.
    expect(l[1]).toMatchObject({ p50: null, p95: null, p99: null, lentes: 0 });
  });

  it('une lente a pris PLUS d\'une seconde : le seau d\'une seconde n\'en est pas', () => {
    expect(LENTE_MS).toBe(1000);
    expect(lentes(seaux({ [i(1000)]: 7 }))).toBe(0);
    expect(lentes(seaux({ [i(1200)]: 2, [i(60000)]: 1, [NB_SEAUX - 1]: 3 }))).toBe(6);
  });
});

describe('les exemplaires et la base', () => {
  const maintenant = new Date('2026-10-13T09:40:00Z');
  it('vu dans les cinq dernières minutes, un exemplaire sert ; plus loin, il s\'est tu', () => {
    const l = exemplaires([
      ['vps-1:8080', 600, 2, 60, '2026-10-13T09:39:00Z'],
      ['vps-2:8080', 120, 0, 20, `2026-10-13T09:${String(40 - SILENCE_MIN - 1).padStart(2, '0')}:00Z`],
      [42],
    ], maintenant);
    expect(l).toEqual([
      { nom: 'vps-1:8080', n: 600, pannes: 2, parMinute: 10, derniere: '2026-10-13T09:39:00Z', silence: 1, etat: 'bon' },
      { nom: 'vps-2:8080', n: 120, pannes: 0, parMinute: 2, derniere: '2026-10-13T09:34:00Z', silence: 6, etat: 'attention' },
    ]);
  });

  it('la base : des parts sans dénominateur valent null, jamais 0 %', () => {
    expect(laBase(null)).toBeNull();
    expect(laBase({ connexions: 3, maxConnexions: 100, lusEnMemoire: 0, lusSurDisque: 0, commits: 0, annulations: 0, taille: 1024, depuis: 'pas une date' }))
      .toMatchObject({ connexions: 3, maxConnexions: 100, enMemoire: null, annulations: null, depuis: null, taille: 1024 });
    expect(laBase({ lusEnMemoire: 990, lusSurDisque: 10, commits: 98, annulations: 2 })).toMatchObject({ enMemoire: 0.99, annulations: 0.02 });
  });
});

describe('la période d\'avant', () => {
  it('elle ne se compare que si sa table la garde encore : pas sur trente jours', () => {
    expect(comparable({ duree: 3_600_000, grain: 'minute' })).toBe(true);
    expect(comparable({ duree: 86_400_000, grain: 'minute' })).toBe(true);
    expect(comparable({ duree: 7 * 86_400_000, grain: 'heure' })).toBe(true);
    expect(comparable({ duree: 30 * 86_400_000, grain: 'heure' })).toBe(false);
    expect(GARDE_MS.minute).toBe(3 * 86_400_000);
  });

  it('ses totaux ne comptent que ses pas, et son débit se compte sur le pas entier', () => {
    // Trois pas de dix minutes : 100, 50 et 7 requêtes, dont une panne.
    const a = periodeDAvant([{ n: 100, pannes: 0 }, { n: 50, pannes: 1 }, { n: 7, pannes: 0 }], 600_000);
    expect(a.points.map((p) => p.parMinute)).toEqual([10, 5, 0.7]);
    expect(a.total).toEqual({ n: 157, pannes: 1, partPannes: 1 / 157 });
    expect(periodeDAvant([], 60_000).total).toEqual({ n: 0, pannes: 0, partPannes: null });
  });
});
