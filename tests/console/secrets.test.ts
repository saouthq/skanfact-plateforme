// Les secrets et leur échéance (1.37.0 ; base 0130 ; docs/console.md C53 ; la liste des fonctions qui manquent, 32) :
//   - pur : l'échéance est le premier de deux jours (l'expiration, le rythme) ; bientôt à trente jours, en retard passé ;
//   - par l'API : la direction et la technique tiennent le registre, le support ne le lit pas ; jamais une valeur (une
//     phrase qui ressemble à une clé est refusée) ; un nom suivi une fois ; un renouvellement vient après le précédent ;
//     « À décider » nomme le secret bientôt dû ou en retard ; chaque geste au journal ; le motif aussi passe le contrôle
//     d'une valeur (1.45.0, l'audit 1.42.0 A10) : refusé, rien n'est écrit, ni au registre ni au journal.

import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { echeanceDu, lu, ranger, SECRET_BIENTOT_JOURS } from '../../serveur/console/secrets.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

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
async function personne(prenom: string) {
  const email = `secrets-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id), nom: `${prenom} ${n}` };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { ...p, console: String(c.corps.jeton) };
}
let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: path.join(os.tmpdir(), `secrets-${process.pid}.json`) })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const JOUR = '2026-10-15';
const s = (renouveleLe: string, expireLe: string | null, rotationJours: number | null) =>
  ({ id: 'x', nom: 'Clé', role: 'r', ou: 'o', renouveleLe, expireLe, rotationJours, noteLe: '2026-01-01T00:00:00Z', notePar: null });

describe('l\'échéance d\'un secret (pur)', () => {
  it('le premier de deux jours ; aucun, aucune ; bientôt à trente jours, pas à trente et un ; en retard le lendemain', () => {
    expect(echeanceDu(s('2026-01-10', '2026-12-31', 365))).toBe('2026-12-31');
    expect(echeanceDu(s('2026-01-10', '2027-06-30', 365))).toBe('2027-01-10');
    expect(echeanceDu(s('2026-01-10', null, null))).toBeNull();
    expect(lu(s('2026-01-10', null, null), JOUR)).toMatchObject({ etat: 'sans_echeance', jours: null });
    expect(SECRET_BIENTOT_JOURS).toBe(30);
    expect(lu(s('2026-01-01', '2026-11-14', null), JOUR)).toMatchObject({ etat: 'bientot', jours: 30 });
    expect(lu(s('2026-01-01', '2026-11-15', null), JOUR)).toMatchObject({ etat: 'a_jour', jours: 31 });
    expect(lu(s('2026-01-01', JOUR, null), JOUR)).toMatchObject({ etat: 'bientot', jours: 0 });
    expect(lu(s('2026-01-01', '2026-10-14', null), JOUR)).toMatchObject({ etat: 'en_retard', jours: -1 });
    expect(ranger([{ ...s('2026-01-01', '2027-01-01', null), nom: 'B' }, { ...s('2026-01-01', null, null), nom: 'A' }, { ...s('2026-01-01', '2026-10-01', null), nom: 'C' }], JOUR)
      .map((x) => x.nom)).toEqual(['C', 'B', 'A']);
  });
});

describe('le registre des secrets (0130)', () => {
  const noter = (jeton: string, corps: Record<string, unknown>) => appeler('POST', '/console/service/secrets', jeton,
    { nom: 'Clé du relais d\'e-mails', role: 'les e-mails de connexion', ou: 'le serveur, SKANFACT_RESEND', renouveleLe: aujourdhuiATunis(), expireLe: null, rotationJours: 365, motif: 'mise en route', ...corps });
  const lire = async (jeton = technique.console) => ((await appeler('GET', '/console/service/securite', jeton)).corps.secrets ?? []) as { id: string; nom: string; etat: string; jours: number | null; echeance: string | null; renouveleLe: string }[];
  // Les gestes de CE parcours seulement (ses trois membres, nés pour lui) : la base des essais garde ceux des autres parcours
  // et des passages d'avant (vu le 15/10/2026 : le parcours d'écran de Sécurité note le même secret dans la même base).
  const journal = async (geste: string) => (await admin.query("select role, motif, avant, apres from plateforme.geste_console where geste = $1 and qui = any($2::uuid[]) order by le",
    [geste, [direction.id, support.id, technique.id]])).rows;

  it('la technique note un secret, jamais sa valeur ; un nom suivi une fois ; le support ne lit ni n\'écrit rien', async () => {
    await admin.query('delete from plateforme.secret_suivi');
    expect((await noter(support.console, {})).statut).toBe(403);
    expect((await appeler('GET', '/console/service/securite', support.console)).statut).toBe(403);
    // Une phrase qui ressemble à une clé : refusée, et le refus le dit.
    const valeur = await noter(technique.console, { ou: 're_8Kf2xQmZ9pLwT4vN7bY1cR6sH3jD0aE5' });
    expect(valeur.statut).toBe(403);
    expect(valeur.corps.motif).toBe('Cela ressemble à la valeur d\'un secret : on n\'écrit ici que son nom, à quoi il sert, où il vit et ses dates.');
    expect((await noter(technique.console, {})).statut).toBe(201);
    const deux = await noter(direction.console, { nom: 'clé du relais d\'e-mails' });
    expect(deux.statut).toBe(403);
    expect(deux.corps.motif).toBe('Ce secret est déjà suivi : note son renouvellement sur sa ligne.');
    // Renouvelé demain : refusé.
    expect((await noter(technique.console, { nom: 'Une autre clé', renouveleLe: plusJours(aujourdhuiATunis(), 1) })).statut).toBe(403);
    const l = await lire();
    expect(l.map((x) => [x.nom, x.etat, x.jours])).toEqual([['Clé du relais d\'e-mails', 'a_jour', 365]]);
    expect((await journal('service.secret_note')).map((g) => [g.role, g.motif, g.apres.nom, g.apres.rotationJours])).toEqual([['technique', 'mise en route', 'Clé du relais d\'e-mails', 365]]);
  });

  it('bientôt dû : « À décider » le nomme pour qui tient le service ; renouvelé, il n\'y est plus ; retiré, il quitte le registre', async () => {
    await admin.query('delete from plateforme.secret_suivi');
    const jour = aujourdhuiATunis();
    expect((await noter(direction.console, { nom: 'Clé SMS', role: 'les codes par SMS', ou: 'le serveur, SKANFACT_SMS', renouveleLe: plusJours(jour, -350), rotationJours: 365 })).statut).toBe(201);
    const [c] = await lire();
    if (!c) throw new Error('un secret attendu');
    expect([c.etat, c.jours]).toEqual(['bientot', 15]);
    const decider = async (jeton: string) => ((await appeler('GET', '/console/accueil', jeton)).corps.decider as { sorte: string; nom?: string; jours?: number }[]).filter((x) => x.sorte === 'secret');
    expect(await decider(technique.console)).toEqual([{ sorte: 'secret', ouvre: 'service', nom: 'Clé SMS', echeance: plusJours(jour, 15), jours: 15 }]);
    expect(await decider(support.console)).toEqual([]);
    // Un renouvellement avant le précédent : refusé ; le jour même : l'échéance repart, « À décider » ne le dit plus.
    expect((await appeler('POST', `/console/service/secrets/${c.id}/renouvele`, technique.console, { le: plusJours(jour, -351), expireLe: null, motif: 'nouvelle clé' })).statut).toBe(403);
    expect((await appeler('POST', `/console/service/secrets/${c.id}/renouvele`, technique.console, { le: jour, expireLe: null, motif: 'nouvelle clé' })).statut).toBe(200);
    expect((await lire()).map((x) => [x.etat, x.jours])).toEqual([['a_jour', 365]]);
    expect(await decider(technique.console)).toEqual([]);
    expect((await journal('service.secret_renouvele')).map((g) => [g.avant.renouveleLe, g.apres.renouveleLe])).toEqual([[plusJours(jour, -350), jour]]);
    expect((await appeler('POST', `/console/service/secrets/${c.id}/retirer`, direction.console, { motif: 'le prestataire SMS a changé' })).statut).toBe(200);
    expect(await lire()).toEqual([]);
    expect((await appeler('POST', `/console/service/secrets/${c.id}/retirer`, direction.console, { motif: 'encore' })).statut).toBe(403);
  });

  it('une clé collée dans le motif d\'un des trois gestes : refusée, et rien n\'est écrit, ni au registre ni au journal (A10)', async () => {
    await admin.query('delete from plateforme.secret_suivi');
    // Un marqueur synthétique, jamais une vraie clé.
    const cle = 'motif re_FAUSSE0cle0de0test0Zq9Lw4vN7bY1cR6sH3jD';
    const traces = async () => Number((await admin.query("select count(*)::int n from plateforme.geste_console where geste like 'service.secret_%' and motif like '%FAUSSE0cle%'")).rows[0]?.n);
    const refuse = 'Ce motif ressemble à la valeur d\'un secret : il reste au journal, on n\'y colle jamais une clé ; dis ce que tu as fait (« clé changée dans le coffre »).';
    const a = await noter(technique.console, { motif: cle });
    expect([a.statut, a.corps.motif]).toEqual([403, refuse]);
    expect(await lire()).toEqual([]);
    expect((await noter(technique.console, {})).statut).toBe(201);
    const [c] = await lire();
    if (!c) throw new Error('un secret attendu');
    const r = await appeler('POST', `/console/service/secrets/${c.id}/renouvele`, technique.console, { le: aujourdhuiATunis(), expireLe: null, motif: cle });
    expect([r.statut, r.corps.motif]).toEqual([403, refuse]);
    const x = await appeler('POST', `/console/service/secrets/${c.id}/retirer`, direction.console, { motif: cle });
    expect([x.statut, x.corps.motif]).toEqual([403, refuse]);
    expect((await lire()).map((l) => l.nom)).toEqual([c.nom]);
    expect(await traces()).toBe(0);
  });
});
