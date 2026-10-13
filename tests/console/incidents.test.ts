// Les incidents du service et la page d'état, rangés sans la base (serveur/console/incidents.ts ; docs/console.md C24).
import { describe, expect, it } from 'vitest';
import { fichesServies, FICHES, lireIncidents, lirePageEtat, maintenances, ouverts, passes, refIncident, suites } from '../../serveur/console/incidents.ts';

const incident = (x: Record<string, unknown>) => ({
  id: 'i', annee: 2026, numero: 1, titre: 'SkanFact ne répondait plus', gravite: 'mineur', fiche: null, ouvertLe: '2026-10-02T20:14:00Z', ouvertPar: 'Walid',
  public: null, publicLe: null, fin: null, closLe: null, closPar: null, effet: null, cause: null, change: null, points: [], suites: [], ...x,
});
const clos = (x: Record<string, unknown>) => incident({
  fin: '2026-10-02T20:52:00Z', closLe: '2026-10-03T09:00:00Z', closPar: 'Walid', effet: 'Personne ne pouvait ouvrir', cause: 'Une migration trop longue', change: 'Un délai', ...x,
});

describe('les incidents, relus prudemment', () => {
  it('un numéro se lit comme on le cite ; une ligne sans date, sans gravité connue ou sans numéro ne compte pas', () => {
    expect(refIncident(2026, 6)).toBe('INC-2026-006');
    const lu = lireIncidents({
      incidents: [
        incident({ numero: 6, fiche: 'service', points: [{ le: '2026-10-02T20:20:00Z', par: 'W', texte: 'Retour à la version précédente', public: true, gravite: 'majeur' }, { le: 'hier', texte: 'x' }] }),
        incident({ id: 'x', gravite: 'grave' }), incident({ id: 'y', ouvertLe: 'jamais' }), incident({ id: 'z', numero: '7' }),
        incident({ id: 'f', fiche: 'inventee' }),
      ],
      maintenances: [{ id: 'm', titre: 'Disque', texte: 'Agrandi', debut: '2026-09-23T05:00:00Z', fin: '2026-09-23T05:20:00Z', par: 'S', annuleeLe: null }, { id: 'n', debut: 'x' }],
      equipe: [{ id: 'u', nom: 'Skander' }, { id: 3 }],
    });
    expect(lu.incidents.map((i) => i.id)).toEqual(['i', 'f']);
    expect(lu.incidents[0]?.ref).toBe('INC-2026-006');
    expect(lu.incidents[0]?.points).toEqual([{ le: '2026-10-02T20:20:00Z', par: 'W', texte: 'Retour à la version précédente', public: true, gravite: 'majeur' }]);
    // Une fiche que la console ne connaît pas ne se dit pas.
    expect(lu.incidents[1]?.fiche).toBeNull();
    expect(lu.maintenances.map((m) => m.id)).toEqual(['m']);
    expect(lu.equipe).toEqual([{ id: 'u', nom: 'Skander' }]);
    expect(lireIncidents(null)).toEqual({ incidents: [], maintenances: [], equipe: [] });
  });

  it('les ouverts : le plus grave d\'abord, puis le plus ancien ; un clos n\'en est pas', () => {
    const lu = lireIncidents({ incidents: [
      incident({ id: 'a', gravite: 'mineur', ouvertLe: '2026-10-01T08:00:00Z' }),
      incident({ id: 'b', gravite: 'majeur', ouvertLe: '2026-10-02T08:00:00Z' }),
      incident({ id: 'c', gravite: 'majeur', ouvertLe: '2026-10-01T09:00:00Z' }),
      clos({ id: 'd', gravite: 'critique' }),
    ] });
    expect(ouverts(lu).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('les suites à tenir', () => {
  it('en retard d\'abord (une suite due aujourd\'hui ne l\'est pas), puis par date ; les faites se comptent', () => {
    const lu = lireIncidents({ incidents: [
      clos({ id: 'i3', numero: 3, titre: 'Des PDF sans cachet', suites: [
        { id: 's1', titre: 'Un PDF de contrôle', responsable: 'Walid', due: '2026-09-30', faiteLe: null, repoussee: 1 },
        { id: 's2', titre: 'Fait', responsable: 'Walid', due: '2026-09-01', faiteLe: '2026-09-02T10:00:00Z', repoussee: 0 },
      ] }),
      clos({ id: 'i4', numero: 4, suites: [
        { id: 's3', titre: 'Un second relais', responsable: 'Skander', due: '2026-10-31', faiteLe: null, repoussee: 0 },
        { id: 's4', titre: 'Aujourd\'hui', responsable: 'Skander', due: '2026-10-12', faiteLe: null, repoussee: 0 },
      ] }),
    ] });
    const s = suites(lu, '2026-10-12');
    expect(s.aTenir.map((x) => [x.id, x.retard])).toEqual([['s1', 12], ['s4', 0], ['s3', 0]]);
    expect(s.aTenir[0]?.incident).toEqual({ id: 'i3', ref: 'INC-2026-003', titre: 'Des PDF sans cachet' });
    expect(s.enRetard).toBe(1);
    expect(s.faites).toBe(1);
  });
});

describe('les incidents passés', () => {
  it('ceux clos ouverts dans la période, avec leur durée (jamais négative) ; l\'arrêt et la disponibilité viennent de la veille seule', () => {
    const lu = lireIncidents({ incidents: [
      clos({ id: 'a', numero: 6, gravite: 'majeur', ouvertLe: '2026-10-02T20:14:00Z', fin: '2026-10-02T20:52:00Z', suites: [
        { id: 's', titre: 'x', responsable: 'W', due: '2026-10-20', faiteLe: '2026-10-05T08:00:00Z', repoussee: 0 },
        { id: 't', titre: 'y', responsable: 'W', due: '2026-10-20', faiteLe: null, repoussee: 0 }] }),
      // La fin du problème peut précéder l'ouverture de l'incident (on l'ouvre après coup) : sa durée n'est jamais négative.
      clos({ id: 'b', numero: 5, gravite: 'mineur', ouvertLe: '2026-09-18T09:05:00Z', fin: '2026-09-18T09:00:00Z' }),
      clos({ id: 'c', numero: 2, ouvertLe: '2026-03-01T09:00:00Z' }),
      incident({ id: 'd', numero: 7, ouvertLe: '2026-10-10T09:00:00Z' }),
    ] });
    const p = passes(lu, '2026-09-13T00:00:00+01:00', { mesurees: 43_200, bas: 38 });
    expect(p.lignes.map((l) => [l.id, l.minutes])).toEqual([['a', 38], ['b', 0]]);
    expect(p.lignes[0]?.suites).toEqual({ faites: 1, total: 2 });
    expect([p.n, p.graves, p.arret]).toEqual([2, 1, 38]);
    expect(p.disponibilite).toBeCloseTo((43_200 - 38) / 43_200, 10);
    // Sans relevé, ni arrêt ni disponibilité : jamais un zéro qui passerait pour une mesure.
    const sans = passes(lu, '2026-01-01T00:00:00+01:00', { mesurees: 0, bas: 0 });
    expect([sans.n, sans.arret, sans.disponibilite]).toEqual([3, null, null]);
  });
});

describe('les maintenances', () => {
  const t = new Date('2026-10-12T10:00:00Z');
  it('les annoncées à venir d\'abord, puis le reste du plus récent au plus ancien ; leur état se lit sur l\'heure', () => {
    const lu = lireIncidents({ maintenances: [
      { id: 'futur-loin', titre: 'B', texte: 't', debut: '2026-10-20T01:00:00Z', fin: '2026-10-20T02:00:00Z', par: 'S', annuleeLe: null },
      { id: 'futur-pres', titre: 'A', texte: 't', debut: '2026-10-14T01:00:00Z', fin: '2026-10-14T02:00:00Z', par: 'S', annuleeLe: null },
      { id: 'en-cours', titre: 'C', texte: 't', debut: '2026-10-12T09:30:00Z', fin: '2026-10-12T10:30:00Z', par: 'S', annuleeLe: null },
      { id: 'annulee', titre: 'D', texte: 't', debut: '2026-10-13T01:00:00Z', fin: '2026-10-13T02:00:00Z', par: 'S', annuleeLe: '2026-10-11T08:00:00Z' },
      { id: 'faite', titre: 'E', texte: 't', debut: '2026-09-23T05:00:00Z', fin: '2026-09-23T05:20:00Z', par: 'S', annuleeLe: null },
    ] });
    const l = maintenances(lu, [{ version: '564718c', le: '2026-10-12T06:13:00Z', retour: false }], [], t);
    expect(l.map((m) => (m.sorte === 'annoncee' ? `${m.id}:${m.etat}` : `v:${m.version}`))).toEqual([
      'futur-pres:a_venir', 'futur-loin:a_venir', 'annulee:annulee', 'en-cours:en_cours', 'v:564718c', 'faite:faite',
    ]);
  });
  it('une mise en ligne dit les minutes sans réponse vues autour d\'elle (dix minutes de part et d\'autre), pas plus loin', () => {
    const v = [{ version: 'a', le: '2026-10-12T06:13:00Z', retour: false }, { version: 'b', le: '2026-10-08T14:04:00Z', retour: true }];
    const coupures = [
      { debut: '2026-10-12T06:20:00Z', fin: '2026-10-12T06:22:00Z', minutes: 3 }, // 7 minutes après : la sienne
      { debut: '2026-10-08T13:40:00Z', fin: '2026-10-08T13:50:00Z', minutes: 11 }, // finie 14 minutes avant : pas la sienne
    ];
    const l = maintenances(lireIncidents({}), v, coupures, t);
    expect(l.map((m) => (m.sorte === 'version' ? [m.version, m.coupure, m.retour] : null))).toEqual([['a', 3, false], ['b', 0, true]]);
  });
});

describe('les fiches réflexes : quand chacune a servi', () => {
  it('le dernier incident qui la suivait, ou rien ; chaque fiche connue a sa ligne', () => {
    const lu = lireIncidents({ incidents: [
      clos({ id: 'a', numero: 4, fiche: 'service', ouvertLe: '2026-09-01T08:00:00Z' }),
      clos({ id: 'b', numero: 6, fiche: 'service', ouvertLe: '2026-10-02T20:14:00Z' }),
      clos({ id: 'c', numero: 5, fiche: 'partenaire', ouvertLe: '2026-09-18T09:05:00Z' }),
    ] });
    const f = fichesServies(lu);
    expect(Object.keys(f)).toEqual([...FICHES]);
    expect(f.service).toEqual({ le: '2026-10-02T20:14:00Z', ref: 'INC-2026-006' });
    expect(f.partenaire?.ref).toBe('INC-2026-005');
    expect(f.rancon).toBeNull();
  });
});

describe('la page d\'état que la console montre', () => {
  it('ce que la veille a écrit, ligne pour ligne ; rien d\'illisible ne passe, et une page sans résumé n\'en est pas une', () => {
    const p = lirePageEtat({
      le: '2026-10-12T09:20:00Z', tout: { couleur: 'orange', dit: 'Un incident en cours' },
      lignes: [{ nom: 'Le service', couleur: 'vert', dit: 'Fonctionne' }, { nom: 'La sauvegarde', couleur: 'bleu', dit: 'x' }],
      annonce: { incident: { gravite: 'mineur', texte: 'Les e-mails arrivent en retard', le: '2026-10-12T09:00:00Z' }, maintenance: { titre: 'x', debut: 'demain' } },
    });
    expect(p?.lignes).toEqual([{ nom: 'Le service', couleur: 'vert', dit: 'Fonctionne' }]);
    expect(p?.annonce).toEqual({ incident: { gravite: 'mineur', texte: 'Les e-mails arrivent en retard', le: '2026-10-12T09:00:00Z' }, maintenance: null });
    expect(lirePageEtat({ le: '2026-10-12T09:20:00Z', lignes: [] })).toBeNull();
    expect(lirePageEtat(null)).toBeNull();
  });
});
