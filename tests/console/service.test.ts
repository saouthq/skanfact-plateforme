// Le service tel que la console le montre, pur (serveur/console/service.ts, exploitation/veille.ts ; docs/console.md C12) :
// chaque pas d'une période a son point, ceux où rien n'est arrivé compris ; le temps de réponse se dit par la borne de son
// seau, jamais sans requête ; la disponibilité ne compte que les minutes relevées ; un jour sans relevé est « non
// mesuré », jamais bon ; une alerte grave colore sa brique le jour où elle était ouverte ; chaque problème que la veille
// peut voir a sa brique ; la veille ne confie que les problèmes confirmés, et la nuit de sa sauvegarde. Les comptes sont
// faits à la main.

import { describe, expect, it } from 'vitest';
import { BRIQUES, briqueDe, memoireOccupee, pourLaConsole, problemes, type Copies, type Releve } from '../../exploitation/veille.ts';
import { bornes, briques, disponibilite, enLigne, ensemble, journal, joursDuService, lireVeilleDeLaBase, misesEnLigne, PERIODES, resume, serie, traficRecent, TUILES } from '../../serveur/console/service.ts';
import { ajouter, histogrammeVide } from '../../serveur/service/mesures.ts';

const MAINTENANT = new Date('2026-10-13T08:37:20Z'); // 09:37 à Tunis
const AUJOURDHUI = '2026-10-13';
const avec = (durees: number[]) => { const h = histogrammeVide(); for (const d of durees) ajouter(h, d); return h; };

describe('le service : la série d\'une période', () => {
  it('un point par pas, le dernier étant le pas en cours ; les bornes tombent sur le pas', () => {
    const b = bornes(PERIODES['24h'], MAINTENANT);
    expect(b.points).toBe(144);
    // Le pas en cours commence à 08:30 UTC ; la période remonte de 24 heures depuis la fin de ce pas (08:40).
    expect(b.depuis.toISOString()).toBe('2026-10-12T08:40:00.000Z');
    expect(bornes(PERIODES['30j'], MAINTENANT).depuis.toISOString()).toBe('2026-09-13T12:00:00.000Z');
  });

  it('un pas sans requête a son point, à zéro et sans temps de réponse ; deux exemplaires s\'additionnent', () => {
    const b = bornes(PERIODES['1h'], MAINTENANT);
    const t0 = b.depuis.toISOString();
    const t9 = new Date(b.depuis.getTime() + 9 * 60_000).toISOString();
    const p = serie([[t0, 100, 2, avec([...Array<number>(95).fill(40), ...Array<number>(5).fill(900)])], [t0, 20, 0, avec([10])], [t9, 6, 0, null]], PERIODES['1h'], MAINTENANT);
    expect(p).toHaveLength(60);
    expect(p[0]).toMatchObject({ n: 120, pannes: 2, p50: 40, p95: 40, lectures: 101, parMinute: 120 });
    expect(p[1]).toMatchObject({ n: 0, p50: null, p95: null, sousBudget: null });
    // Des requêtes sans lecture (des écritures) : un trafic, pas de temps de réponse des listes.
    expect(p[9]).toMatchObject({ n: 6, p95: null });
  });

  it('le pas en cours compte ses requêtes par minute sur ce qu\'il a duré', () => {
    const b = bornes(TUILES, MAINTENANT);
    const enCours = new Date(b.depuis.getTime() + (b.points - 1) * b.pas).toISOString(); // 08:00 UTC, 37 minutes passées
    const p = serie([[enCours, 74, 0, null]], TUILES, MAINTENANT);
    expect(p.at(-1)?.parMinute).toBe(2);
  });

  it('le trafic d\'en ce moment : les minutes FINIES de la dernière heure, jamais l\'heure de l\'horloge', () => {
    const b = bornes(PERIODES['1h'], MAINTENANT);
    const t = (i: number) => new Date(b.depuis.getTime() + i * 60_000).toISOString();
    // 08:37:20 UTC : la dernière heure va de 07:38 à 08:37, la minute en cours. Les 59 minutes finies : 30 à 4 requêtes,
    // 29 à 5, soit 265 ; 265 / 59 = 4,49 (sur 60, ce serait 4,42). La minute en cours (déjà 30) ne compte pas.
    const brut = [...Array.from({ length: 59 }, (_, i) => [t(i), i < 30 ? 4 : 5, 0, null]), [t(59), 30, 0, null]];
    expect(traficRecent(serie(brut, PERIODES['1h'], MAINTENANT), MAINTENANT)).toEqual({ parMinute: 4.5, minutes: 59 });
    // 08:00:30 UTC, une heure d'horloge qui commence : son pas n'a rien encore, la dernière heure en a 59 × 6.
    const a8h = new Date('2026-10-13T08:00:30Z');
    const b8 = bornes(PERIODES['1h'], a8h);
    const t8 = (i: number) => new Date(b8.depuis.getTime() + i * 60_000).toISOString();
    expect(traficRecent(serie(Array.from({ length: 59 }, (_, i) => [t8(i), 6, 0, null]), PERIODES['1h'], a8h), a8h)).toEqual({ parMinute: 6, minutes: 59 });
    expect(traficRecent([], MAINTENANT)).toEqual({ parMinute: 0, minutes: 0 });
  });

  it('le résumé : le plus lent, et les pas au-dessus du budget', () => {
    const b = bornes(PERIODES['1h'], MAINTENANT);
    const t = (i: number) => new Date(b.depuis.getTime() + i * 60_000).toISOString();
    const p = serie([[t(0), 20, 1, avec(Array<number>(20).fill(250))], [t(1), 20, 0, avec(Array<number>(20).fill(450))]], PERIODES['1h'], MAINTENANT);
    expect(resume(p)).toEqual({ n: 40, pannes: 1, partPannes: 0.025, lePlusLent: 500, auDessusDuBudget: 1 });
    expect(resume(serie([], PERIODES['1h'], MAINTENANT))).toMatchObject({ n: 0, partPannes: null, lePlusLent: null });
  });

  it('une série en un seul chiffre fusionne ses seaux : ce n\'est jamais la moyenne des centiles de ses pas', () => {
    const b = bornes(TUILES, MAINTENANT);
    const t = (i: number) => new Date(b.depuis.getTime() + i * 3_600_000).toISOString();
    // Une heure calme (180 lectures à 40 ms) et une heure lente (20 lectures à 900 ms) : chacune a son centile (40 et
    // 1 000), et sur la journée, 95 % des 200 lectures passent sous 1 000 ms — la 190e lecture est une lente.
    const brut = [[t(0), 200, 0, avec(Array<number>(180).fill(40))], [t(5), 24, 3, avec(Array<number>(20).fill(900))], ['pas une date', 5, 5, null]];
    expect(serie(brut, TUILES, MAINTENANT).filter((p) => p.p95 !== null).map((p) => p.p95)).toEqual([40, 1000]);
    expect(ensemble(brut)).toEqual({ n: 224, pannes: 3, partPannes: 3 / 224, lectures: 200, p50: 40, p95: 1000, sousBudget: 0.9 });
    expect(ensemble([])).toEqual({ n: 0, pannes: 0, partPannes: null, lectures: 0, p50: null, p95: null, sousBudget: null });
  });

  it('sous vingt lectures, un pas n\'a pas de centile : il dit combien il en a eu, et ne compte pas au-dessus du budget', () => {
    const b = bornes(PERIODES['24h'], MAINTENANT);
    const t = (i: number) => new Date(b.depuis.getTime() + i * 600_000).toISOString();
    // La nuit : 19 lectures, dont une lente — sans la règle, le « 95 % » serait cette lente-là, à 1 000 ms.
    const brut = [[t(0), 19, 0, avec([...Array<number>(18).fill(40), 900])], [t(1), 20, 0, avec([...Array<number>(19).fill(40), 900])]];
    const p = serie(brut, PERIODES['24h'], MAINTENANT);
    expect(p[0]).toMatchObject({ n: 19, lectures: 19, p50: null, p95: null, sousBudget: null });
    expect(p[1]).toMatchObject({ n: 20, lectures: 20, p50: 40, p95: 40, sousBudget: 0.95 });
    expect(resume(p)).toMatchObject({ lePlusLent: 40, auDessusDuBudget: 0 });
    // La période entière suit la même règle.
    expect(ensemble([brut[0] ?? []])).toMatchObject({ lectures: 19, p95: null, sousBudget: null });
    expect(ensemble(brut)).toMatchObject({ lectures: 39, p95: 1000 });
  });
});

const veille = (x: Record<string, unknown>) => lireVeilleDeLaBase({ jours: [], coupures: [], machine: [], alertes: [], nuits: [], versions: [], ...x });

describe('le service : ce que la veille a vu', () => {
  it('la disponibilité ne compte que les minutes relevées ; sans relevé, elle ne se dit pas', () => {
    const v = veille({ jours: [['2026-10-12', 1440, 38], ['2026-10-13', 577, 0]], coupures: [['2026-10-12T20:14:00Z', '2026-10-12T20:51:00Z', 38]] });
    expect(disponibilite(v)).toEqual({ mesurees: 2017, bas: 38, taux: 1979 / 2017, coupures: 1 });
    expect(disponibilite(veille({})).taux).toBeNull();
  });

  it('une mise en ligne est une suite de relevés d\'une version ; la plus ancienne tournait déjà, et un retour compte', () => {
    // Trois suites, rendues de la plus récente à la plus ancienne : c7b2e91 tournait au premier relevé, 564718c est arrivée
    // le 10, puis on est revenu à c7b2e91 le 12.
    const v = veille({
      versions: [['c7b2e91', '2026-10-12T21:03:00Z', '2026-10-13T08:37:00Z'], ['564718c', '2026-10-10T20:00:00Z', '2026-10-12T21:02:00Z'], ['c7b2e91', '2026-09-14T00:00:00Z', '2026-10-10T19:59:00Z']],
      dernier: { minute: '2026-10-13T08:37:00Z', version: 'c7b2e91', certificat: null, archiveLe: null },
    });
    // Le 12, c7b2e91 avait déjà tourné : c'est un retour (on est revenu à la précédente), pas une version nouvelle.
    expect(misesEnLigne(v)).toEqual([{ version: '564718c', le: '2026-10-10T20:00:00Z', retour: false }, { version: 'c7b2e91', le: '2026-10-12T21:03:00Z', retour: true }]);
    expect(enLigne(v)).toEqual({ version: 'c7b2e91', depuis: '2026-10-12T21:03:00Z', vueArriver: true });
    // Une seule suite : elle tournait au premier relevé, on ne l'a pas vue arriver.
    const seule = veille({ versions: [['c7b2e91', '2026-09-14T00:00:00Z', '2026-10-13T08:37:00Z']], dernier: { minute: '2026-10-13T08:37:00Z', version: 'c7b2e91', certificat: null, archiveLe: null } });
    expect(misesEnLigne(seule)).toEqual([]);
    expect(enLigne(seule)).toEqual({ version: 'c7b2e91', depuis: '2026-09-14T00:00:00Z', vueArriver: false });
    expect(enLigne(veille({}))).toBeNull();
  });

  it('un jour sans relevé est non mesuré ; une coupure l\'emporte ; une alerte grave le perturbe', () => {
    const v = veille({
      jours: [['2026-10-11', 1440, 0], ['2026-10-12', 1440, 3], ['2026-10-13', 577, 0]],
      alertes: [{ id: 'a', cle: 'hors-machine', titre: 'la copie hors de la machine est en retard de 70 minutes', grave: true, aEteGrave: true, faire: '', debut: '2026-10-13T02:40:00Z', fin: null }],
    });
    const j = joursDuService(v, AUJOURDHUI, MAINTENANT);
    expect(j).toHaveLength(30);
    expect(j[0]?.jour).toBe('2026-09-14');
    expect(j.at(-3)).toMatchObject({ jour: '2026-10-11', etat: 'bon' });
    expect(j.at(-2)).toMatchObject({ jour: '2026-10-12', etat: 'coupure', bas: 3 });
    expect(j.at(-1)).toMatchObject({ jour: '2026-10-13', etat: 'perturbe' });
    expect(j.at(-4)?.etat).toBe('nonmesure');
  });

  it('une alerte colore sa brique chaque jour où elle était ouverte, au jour de Tunis ; ouverte, elle fait son état', () => {
    const v = veille({
      jours: [['2026-10-11', 1440, 0], ['2026-10-12', 1440, 0], ['2026-10-13', 577, 0]],
      alertes: [
        // Ouverte le 11 à 23:30 heure de Tunis (22:30 UTC), réglée le 12 à 00:20 : deux jours de Tunis.
        { id: 'b', cle: 'disque:/', titre: 'le disque / est plein à 76 %', grave: false, aEteGrave: false, faire: '', debut: '2026-10-11T22:30:00Z', fin: '2026-10-11T23:20:00Z' },
        { id: 'c', cle: 'sauvegarde', titre: 'la dernière sauvegarde de la base a échoué', grave: true, aEteGrave: true, faire: 'Sur le serveur…', debut: '2026-10-13T01:20:00Z', fin: null },
      ],
    });
    const b = briques(v, AUJOURDHUI, MAINTENANT, true);
    expect(b.map((x) => x.id)).toEqual(BRIQUES.map((x) => x.id));
    const disques = b.find((x) => x.id === 'disques');
    expect(disques?.jours.at(-3)?.etat).toBe('attention');
    expect(disques?.jours.at(-2)?.etat).toBe('attention');
    expect(disques?.jours.at(-1)?.etat).toBe('bon');
    expect(disques?.etat).toBe('bon');
    const sauvegarde = b.find((x) => x.id === 'sauvegarde');
    expect(sauvegarde?.etat).toBe('grave');
    expect(sauvegarde?.ouvertes[0]?.faire).toBe('Sur le serveur…');
    // Sans veille en marche, rien ne se dit bon aujourd'hui.
    expect(briques(v, AUJOURDHUI, MAINTENANT, false).every((x) => x.etat === 'nonmesure')).toBe(true);
    expect(journal(v).map((e) => (e.type === 'alerte' ? e.sorte : e.type))).toEqual(['ouverte', 'reglee', 'ouverte']);
  });

  it('ce qui vient de se passer : les alertes, chaque mise en ligne (un retour se dit), chaque nuit en une seule ligne', () => {
    // Le 12 à 21:03 (UTC), 564718c arrive ; à 21:49 on revient à c7b2e91, qui tournait avant. La nuit du 13 : la copie de
    // base est faite, la sauvegarde échoue (rien à envoyer hors de la machine) ; celle du 12 a tout fait, exercice compris ;
    // celle du 11 n'a rien laissé : pas de ligne.
    const v = veille({
      versions: [['c7b2e91', '2026-10-12T21:49:00Z', '2026-10-13T08:37:00Z'], ['564718c', '2026-10-12T21:03:00Z', '2026-10-12T21:48:00Z'], ['c7b2e91', '2026-09-14T00:00:00Z', '2026-10-12T21:02:00Z']],
      nuits: [
        // La sauvegarde du 13 a échoué : rien n'est parti, la veille dit pourtant la copie « arrivée » (rien n'attend) — sans objet.
        { jour: '2026-10-13', copieDeBase: { le: '2026-10-12T23:31:00Z', ok: true }, sauvegarde: { le: '2026-10-13T01:19:00Z', ok: false, horsMachine: { le: '2026-10-13T01:40:00Z', ok: true } } },
        // La copie hors de la machine du 10 a été vérifiée à 08:30 : la nuit garde l'heure de sa sauvegarde (01:19).
        { jour: '2026-10-10', sauvegarde: { le: '2026-10-10T01:19:00Z', ok: true, horsMachine: { le: '2026-10-10T08:30:00Z', ok: true } } },
        { jour: '2026-10-12', copieDeBase: { le: '2026-10-11T23:31:00Z', ok: true }, sauvegarde: { le: '2026-10-12T01:19:00Z', ok: true, horsMachine: { le: '2026-10-12T01:40:00Z', ok: true } }, restauration: { le: '2026-10-12T03:05:00Z', ok: true } },
        { jour: '2026-10-11' },
      ],
      alertes: [{ id: 'c', cle: 'sauvegarde', titre: 'la dernière sauvegarde de la base a échoué', grave: true, aEteGrave: true, faire: '', debut: '2026-10-13T01:20:00Z', fin: null }],
    });
    expect(journal(v)).toEqual([
      { le: '2026-10-13T01:20:00Z', type: 'alerte', sorte: 'ouverte', titre: 'la dernière sauvegarde de la base a échoué', grave: true, brique: 'sauvegarde' },
      { le: '2026-10-13T01:19:00Z', type: 'nuit', jour: '2026-10-13', etapes: [{ quoi: 'copieDeBase', ok: true }, { quoi: 'sauvegarde', ok: false }] },
      { le: '2026-10-12T21:49:00Z', type: 'version', version: 'c7b2e91', retour: true },
      { le: '2026-10-12T21:03:00Z', type: 'version', version: '564718c', retour: false },
      { le: '2026-10-12T03:05:00Z', type: 'nuit', jour: '2026-10-12', etapes: [{ quoi: 'copieDeBase', ok: true }, { quoi: 'sauvegarde', ok: true }, { quoi: 'horsMachine', ok: true }, { quoi: 'restauration', ok: true }] },
      { le: '2026-10-10T01:19:00Z', type: 'nuit', jour: '2026-10-10', etapes: [{ quoi: 'sauvegarde', ok: true }, { quoi: 'horsMachine', ok: true }] },
    ]);
  });

  it('chaque problème que la veille peut voir a sa brique', () => {
    const tout: Releve = {
      maintenant: MAINTENANT, serviceRepond: false, production: true,
      etat: { regardeLe: '2026-10-12T00:00:00Z', version: 'abc1234', echec: { version: 'def5678', etape: 'migrer', le: '2026-10-12T00:00:00Z' }, taches: [{ nom: '0009-x.sh', ok: false }], sauvegarde: null },
      disques: [{ point: '/', pourcent: 95 }], certificat: { expireLe: '2026-10-14T00:00:00Z' },
      copies: { archivage: { enMarche: true, dernierReussi: null, dernierEchec: '2026-10-13T08:00:00Z' }, copieDeBase: null, restauration: null, horsMachine: { regle: true, plusVieuxEnAttente: '2026-10-13T01:00:00Z', dernierEchec: null } },
    };
    const sansReglage: Releve = { ...tout, copies: { archivage: { enMarche: false, dernierReussi: null, dernierEchec: null }, copieDeBase: null, restauration: null, horsMachine: { regle: false, plusVieuxEnAttente: null, dernierEchec: null } }, etat: null };
    const cles = new Set([...problemes(tout), ...problemes(sansReglage)].map((p) => p.cle));
    expect(cles.size).toBeGreaterThan(10);
    for (const c of cles) expect(briqueDe(c), c).not.toBeNull();
    expect(briqueDe('inconnue')).toBeNull();
  });
});

describe('ce que la veille confie à la base', () => {
  const copies: Copies = { archivage: { enMarche: true, dernierReussi: '2026-10-13T08:36:00Z', dernierEchec: null }, copieDeBase: { le: '2026-10-12T23:30:00Z', ok: true }, restauration: null,
    horsMachine: { regle: true, plusVieuxEnAttente: '2026-10-13T08:30:00Z', dernierEchec: null } };
  const releve: Releve = {
    maintenant: MAINTENANT, serviceRepond: true,
    etat: { regardeLe: '2026-10-13T08:30:00Z', version: '71061a0cee512e53', echec: null, taches: [], sauvegarde: { le: '2026-10-13T01:16:00Z', ok: true } },
    disques: [{ point: '/', pourcent: 41 }], certificat: { expireLe: '2026-12-01T10:00:00Z' },
    copies,
  };

  it('le relevé de la minute, et seulement les problèmes confirmés', () => {
    const x = pourLaConsole(releve, { problemes: {
      service: { titre: 'SkanFact ne répond plus', grave: true, faire: 'a', depuis: '2026-10-13T08:36:00Z', vus: 1, ditLe: null },
      certificat: { titre: 'le certificat https expire dans 20 jours', grave: false, faire: 'b', depuis: '2026-10-12T08:00:00Z', vus: 1440, ditLe: '2026-10-12T08:00:00Z' },
    } }, { charge: 0.42, memoire: 37, processeurs: 4 });
    expect(x.releve).toEqual({ minute: '2026-10-13T08:37:00.000Z', repond: true, charge: 0.42, memoire: 37, processeurs: 4, disques: [{ point: '/', pourcent: 41 }],
      version: '71061a0cee512e53', certificat: '2026-12-01', archiveLe: '2026-10-13T08:36:00Z' });
    // Le service n'a été vu qu'une fois sans réponse : ce n'est pas encore une alerte.
    expect(Object.keys(x.problemes)).toEqual(['certificat']);
  });

  it('chaque nuit à son jour de Tunis ; la sauvegarde est partie quand plus rien d\'aussi vieux n\'attend', () => {
    const x = pourLaConsole(releve, { problemes: {} }, { charge: null, memoire: null, processeurs: null });
    // La copie de base de 23:30 UTC le 12 est de 00:30 le 13 à Tunis : la même nuit que la sauvegarde de 02:16.
    expect(x.nuits).toEqual([{ jour: '2026-10-13', sauvegarde: { le: '2026-10-13T01:16:00Z', ok: true, horsMachine: { le: MAINTENANT.toISOString(), ok: true } }, copieDeBase: { le: '2026-10-12T23:30:00Z', ok: true } }]);
    const enRetard = pourLaConsole({ ...releve, copies: { ...copies, horsMachine: { regle: true, plusVieuxEnAttente: '2026-10-13T01:00:00Z', dernierEchec: null } } }, { problemes: {} }, { charge: null, memoire: null, processeurs: null });
    expect(enRetard.nuits[0]?.sauvegarde).toMatchObject({ horsMachine: { ok: false } });
    const pasReglee = pourLaConsole({ ...releve, copies: { ...copies, horsMachine: { regle: false, plusVieuxEnAttente: null, dernierEchec: null } } }, { problemes: {} }, { charge: null, memoire: null, processeurs: null });
    expect(pasReglee.nuits[0]?.sauvegarde).toEqual({ le: '2026-10-13T01:16:00Z', ok: true });
  });

  it('la mémoire occupée se lit dans /proc/meminfo, caches rendus compris', () => {
    expect(memoireOccupee('MemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    5000000 kB\n')).toBe(38);
    expect(memoireOccupee('MemTotal: 8000000 kB\n')).toBeNull();
  });
});
