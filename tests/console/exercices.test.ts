// Les exercices de crise (1.113.0 ; base 0166 ; docs/console.md C24 quater) : une fiche réflexe jouée à blanc, chronométrée,
// close par son compte rendu.
//   - la direction et la technique les notent ; le support ne les lit ni ne les note ;
//   - la base tient la règle : commencé il y a moins de douze heures, chaque temps fait l'est à la minute entre le début et
//     la fin, dans l'ordre de la fiche ; réussi seulement si les quatre temps ont été faits ;
//   - chaque exercice a sa ligne au journal de la console ;
//   - le lancement (J5) compte les fiches RÉUSSIES dans les douze derniers mois ; un exercice à refaire ne compte pas.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { exercicesDuLancement, FICHES, lireExercices, type ExerciceLu } from '../../serveur/console/incidents.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

describe('le lancement compte les fiches réussies dans l\'année (pur)', () => {
  const ex = (x: Partial<ExerciceLu>): ExerciceLu => ({
    id: 'e', fiche: 'service', debut: '2026-10-01T08:00:00Z', fin: '2026-10-01T08:40:00Z', temps: [2, 9, 31, 40], participants: 'A et B',
    marche: 'xxx', coince: 'yyy', change: 'zzz', reussi: true, par: 'A', ...x,
  });
  const t = new Date('2026-10-22T12:00:00Z');

  it('une fiche réussie depuis un an compte ; à refaire, ou réussie il y a plus d\'un an, elle manque', () => {
    const l = exercicesDuLancement([
      ex({ fiche: 'service' }),
      ex({ fiche: 'base', reussi: false }),
      // 366 jours avant : l'an passé, il faut la rejouer.
      ex({ fiche: 'fuite', fin: '2025-10-21T11:00:00Z' }),
      // 364 jours avant : elle tient encore.
      ex({ fiche: 'rancon', fin: '2025-10-23T13:00:00Z' }),
      ex({ fiche: 'service', reussi: false, fin: '2026-10-20T08:00:00Z' }),
    ], t);
    // Ranger dans l'ordre des fiches, jamais dans celui des exercices ; une fiche rejouée à refaire garde sa réussite.
    expect(l.reussies).toEqual(['service', 'rancon']);
    expect(l.manquent).toEqual(FICHES.filter((f) => f !== 'service' && f !== 'rancon'));
    expect(l.total).toBe(10);
    expect(exercicesDuLancement([], t)).toEqual({ reussies: [], manquent: [...FICHES], total: 10 });
  });

  it('la lecture garde les quatre temps à leur place, un temps illisible n\'est pas fait ; une ligne sans fiche connue ne compte pas', () => {
    const lu = lireExercices([
      { id: 'a', fiche: 'service', debut: '2026-10-01T08:00:00Z', fin: '2026-10-01T08:40:00Z', temps: [0, null, 3.5, -1], participants: 'A', reussi: true },
      { id: 'b', fiche: 'inventee', debut: '2026-10-01T08:00:00Z', fin: '2026-10-01T08:40:00Z', temps: [] },
      { id: 'c', fiche: 'base', debut: 'jamais', fin: '2026-10-01T08:40:00Z' },
    ]);
    expect(lu.map((e) => [e.id, e.temps, e.reussi])).toEqual([['a', [0, null, null, null], true]]);
    expect(lireExercices(null)).toEqual([]);
  });
});

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `exercices-${prenom}${++n}-${horloge.getTime()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const j = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const qui = await quiEst(ctx, j);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return String(c.corps.jeton);
}

let direction: string, technique: string, support: string;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  [direction, technique, support] = [await membre('direction', 'direction'), await membre('technique', 'technique'), await membre('support', 'support')];
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

// Un exercice commencé il y a `minutes` minutes ; chaque appel a ses propres participants, pour le retrouver parmi ceux
// qu'un autre essai a pu noter dans la même base.
let k = 0;
const exercice = (minutes: number, x: Record<string, unknown> = {}) => ({
  fiche: 'sauvegarde', debut: new Date(horloge.getTime() - minutes * 60_000).toISOString(), temps: [1, 4, 22, 37],
  participants: `Equipe d'essai ${++k} ${horloge.getTime()}`, marche: 'La fiche se lit vite.', coince: 'Le mot de passe du coffre.', change: 'Noter le coffre au carnet.',
  reussi: true, ...x,
});
const noter = (jeton: string, corps: Record<string, unknown>) => appeler('POST', '/console/service/exercices', jeton, corps);
const lus = async (jeton = technique) => (await appeler('GET', '/console/service/incidents', jeton)).corps as { exercices: ExerciceLu[]; lancement: { reussies: string[]; manquent: string[]; total: number } };

describe('noter un exercice (0166)', () => {
  it('fini, il se lit avec ses temps et son compte rendu ; il a sa ligne au journal', async () => {
    const corps = exercice(40);
    const r = await noter(technique, corps);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const id = String(r.corps.id);
    const e = (await lus(direction)).exercices.find((x) => x.id === id);
    expect(e).toMatchObject({ fiche: 'sauvegarde', temps: [1, 4, 22, 37], participants: corps.participants, coince: 'Le mot de passe du coffre.', reussi: true });
    // Il finit quand on le note : à l'heure du serveur, jamais à celle que dirait la page.
    expect(Date.parse(e?.fin ?? '')).toBe(horloge.getTime());
    const j = (await admin.query(`select role, motif, apres from plateforme.geste_console where geste = 'service.exercice_crise' and apres->>'exercice' = $1`, [id])).rows;
    expect(j).toEqual([{ role: 'technique', motif: 'exercice : sauvegarde', apres: { exercice: id, fiche: 'sauvegarde', minutes: 40, reussi: true } }]);
  });

  it('le support ne les note ni ne les lit', async () => {
    expect((await noter(support, exercice(10))).statut).toBe(403);
    expect((await appeler('GET', '/console/service/incidents', support)).statut).toBe(403);
  });

  it('la base refuse ce qui ne s\'est pas joué ainsi, et dit pourquoi', async () => {
    const refus = async (corps: Record<string, unknown>) => { const r = await noter(direction, corps); expect(r.statut, JSON.stringify(r.corps)).toBe(403); return r.corps.motif; };
    expect(await refus(exercice(13 * 60))).toBe('Un exercice se note le jour où il est joué : commencé il y a moins de douze heures.');
    expect(await refus(exercice(-5))).toBe('Un exercice se note le jour où il est joué : commencé il y a moins de douze heures.');
    // Un temps après la fin (l'exercice a duré 30 minutes, l'écrit serait à la 37e).
    expect(await refus(exercice(30))).toBe('Chaque temps fait l\'est entre le début et la fin de l\'exercice, à la minute.');
    expect(await refus(exercice(40, { temps: [1, 22, 4, 37] }))).toBe('Les temps se font dans l\'ordre de la fiche : contenir, dire, réparer, écrire.');
    // Un temps sauté ne casse pas l'ordre des autres ; il interdit seulement de dire l'exercice réussi.
    expect(await refus(exercice(40, { temps: [1, null, 22, 37] }))).toBe('Un exercice n\'est réussi que si ses quatre temps ont été faits.');
    expect((await noter(direction, exercice(40, { temps: [1, null, 22, 37], reussi: false }))).statut).toBe(201);
    // Ce que la route refuse avant la base : une fiche inconnue, trois temps, un compte rendu vide.
    expect((await noter(direction, exercice(40, { fiche: 'inventee' }))).statut).toBe(400);
    expect((await noter(direction, exercice(40, { temps: [1, 4, 22] }))).statut).toBe(400);
    expect((await noter(direction, exercice(40, { coince: '  ' }))).statut).toBe(400);
  });

  it('le lancement compte une fiche réussie, pas une fiche à refaire', async () => {
    // La base est commune aux essais : on lit ce que le lancement disait avant, puis ce qu'ajoute chaque exercice.
    await admin.query(`delete from plateforme.exercice_crise where fiche in ('chiffre', 'empreinte')`);
    expect((await lus()).lancement.manquent).toEqual(expect.arrayContaining(['chiffre', 'empreinte']));
    expect((await noter(technique, exercice(50, { fiche: 'chiffre', temps: [1, 4, 22, null], reussi: false }))).statut).toBe(201);
    expect((await noter(technique, exercice(50, { fiche: 'empreinte' }))).statut).toBe(201);
    const l = (await lus()).lancement;
    expect(l.manquent).toContain('chiffre');
    expect(l.reussies).toContain('empreinte');
    expect(l.total).toBe(10);
  });
});
