// La pause d'un partenaire et la suite des travaux (0145 ; docs/console.md C69) :
//   - la direction ou la technique met en pause ce que le serveur envoie seul (la TTN, les relances), une heure, quatre
//     heures ou un jour, avec son motif ; jamais deux à la fois, jamais un autre partenaire ; le support, jamais ;
//   - elle se lit dans Travaux et dans « À décider » de qui tient le service, se reprend avant son heure, et chaque geste
//     entre au journal ;
//   - le débit de chaque partenaire se lit aussi sur vingt-quatre heures, une barre par heure ;
//   - des envois à la TTN en panne depuis des heures passent en tête d'« À décider ».

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { aDecider } from '../../serveur/console/decider.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { lireSuite, pauseEnCours, vingtQuatreHeures } from '../../serveur/console/travaux.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { enPause } from '../../serveur/service/pauses.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `pauses-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const qui = await quiEst(ctx, String(c.corps.jeton));
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return String(k.corps.jeton);
}
const pauser = (jeton: string, corps: Record<string, unknown>) => appeler('POST', '/console/service/travaux/pauses', jeton, { partenaire: 'ttn', heures: 4, motif: 'Maintenance annoncée par la TTN', ...corps });

let direction = '', technique = '', support = '';
beforeAll(async () => {
  await admin.connect();
  // Les pauses laissées par d'autres essais changeraient ce que celui-ci attend.
  await admin.query('delete from plateforme.pause_partenaire');
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  technique = await membre('technique', 'technique');
  support = await membre('support', 'support');
});
afterAll(async () => { await admin.query('delete from plateforme.pause_partenaire'); await app.close(); await admin.end(); await pool.end(); });

describe('la pause d\'un partenaire (0145)', () => {
  it('la technique met la TTN en pause quatre heures ; le serveur la lit ; elle se dit dans Travaux et dans « À décider » ; reprise, tout repart', async () => {
    expect(await enPause(pool, 'ttn', horloge)).toBeNull();
    const r = await pauser(technique, {});
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(Date.parse(String(r.corps.jusquAu)) - horloge.getTime()).toBe(4 * 3_600_000);
    // Le serveur la lit : en pause, jusqu'à son heure, et plus après.
    expect((await enPause(pool, 'ttn', horloge))?.toISOString()).toBe(new Date(String(r.corps.jusquAu)).toISOString());
    expect(await enPause(pool, 'relances', horloge)).toBeNull();
    expect(await enPause(pool, 'ttn', new Date(horloge.getTime() + 4 * 3_600_000))).toBeNull();
    // Jamais deux à la fois : reprendre d'abord pour changer de durée.
    expect((await pauser(direction, { heures: 1 })).corps.motif).toMatch(/déjà en pause/i);

    const travaux = (await appeler('GET', '/console/service/travaux', direction)).corps;
    const pauses = travaux.pauses as { id: string; partenaire: string; enCours: boolean; motif: string }[];
    expect(pauses.filter((p) => p.enCours)).toEqual([expect.objectContaining({ partenaire: 'ttn', motif: 'Maintenance annoncée par la TTN' })]);
    const partenaires = travaux.partenaires as { nom: string; heures: unknown[]; jours: unknown[] }[];
    expect(partenaires.every((p) => p.heures.length === 24 && p.jours.length === 14)).toBe(true);
    expect(travaux.pausables).toEqual(['ttn', 'relances']);

    const accueil = (await appeler('GET', '/console/accueil', technique)).corps;
    expect((accueil.decider as { sorte: string; partenaire?: string }[]).filter((l) => l.sorte === 'pause')).toEqual([expect.objectContaining({ partenaire: 'ttn' })]);
    // Le support ne tient pas le service : il ne lit pas la pause à l'accueil.
    expect(((await appeler('GET', '/console/accueil', support)).corps.decider as { sorte: string }[]).some((l) => l.sorte === 'pause')).toBe(false);

    const id = pauses.find((p) => p.enCours)?.id ?? '';
    expect((await appeler('POST', `/console/service/travaux/pauses/${id}/reprendre`, direction, { motif: 'ok' })).statut).toBe(400);
    expect((await appeler('POST', `/console/service/travaux/pauses/${id}/reprendre`, direction, { motif: 'Maintenance finie plus tôt' })).statut).toBe(200);
    expect(await enPause(pool, 'ttn', horloge)).toBeNull();
    expect((await appeler('POST', `/console/service/travaux/pauses/${id}/reprendre`, direction, { motif: 'Encore une fois' })).corps.motif).toMatch(/n'est plus en pause/i);
    // Reprise, une nouvelle pause se pose.
    expect((await pauser(direction, { partenaire: 'relances', heures: 1, motif: 'Incident en cours sur les paiements' })).statut).toBe(201);
    const gestes = (await admin.query(`select geste, apres from plateforme.geste_console where geste like 'service.partenaire_%' order by le desc limit 3`)).rows;
    expect(gestes.map((g) => g.geste)).toEqual(['service.partenaire_pause', 'service.partenaire_repris', 'service.partenaire_pause']);
    expect(gestes[0].apres).toEqual({ partenaire: 'relances', heures: 1 });
  });

  it('une heure, quatre heures ou un jour ; la TTN et les relances seules ; jamais le support', async () => {
    await admin.query('delete from plateforme.pause_partenaire');
    expect((await pauser(direction, { heures: 2 })).statut).toBe(400);
    expect((await pauser(direction, { heures: 48 })).statut).toBe(400);
    expect((await pauser(direction, { partenaire: 'sms' })).statut).toBe(400);
    expect((await pauser(direction, { motif: 'ok' })).statut).toBe(400);
    expect((await pauser(support, {})).statut).toBe(403);
    expect((await appeler('GET', '/console/service/travaux', support)).statut).toBe(403);
    // La base refuse aussi ce que le serveur laisserait passer.
    await expect(admin.query(`insert into plateforme.pause_partenaire (partenaire, le, jusqu_au, motif, par)
      select 'ttn', now(), now() + interval '25 hours', 'trop longue', id from socle.utilisateur limit 1`)).rejects.toThrow(/check/);
    expect((await pauser(direction, { heures: 24 })).statut).toBe(201);
  });
});

describe('la suite des travaux, lue (0145)', () => {
  it('vingt-quatre heures, l\'heure en cours comprise ; une heure sans envoi vaut zéro ; rien sans sa forme', () => {
    const lu = lireSuite({
      pauses: [{ id: 'p', partenaire: 'ttn', le: '2026-10-19T10:00:00Z', jusquAu: '2026-10-19T14:00:00Z', motif: 'm', par: 'X', leveeLe: null, enCours: true },
        { id: 'q', partenaire: 'sms', le: '2026-10-19T10:00:00Z', jusquAu: '2026-10-19T14:00:00Z' }],
      heures: { ttn: [{ heure: '2026-10-19T12:00:00+00:00', n: 3, bons: 2, refus: 1 }, { heure: 'midi', n: 1 }] },
      enPanne: { n: 2, depuis: '2026-10-19T06:00:00Z' },
    });
    expect(lu.pauses.map((p) => p.id)).toEqual(['p']);
    expect(lu.enPanne).toEqual({ n: 2, depuis: '2026-10-19T06:00:00Z' });
    const h = vingtQuatreHeures(lu.heures.ttn, new Date('2026-10-19T12:34:00Z'));
    expect(h).toHaveLength(24);
    expect(h.at(-1)).toEqual({ heure: '2026-10-19T12:00:00.000Z', n: 3, bons: 2, refus: 1 });
    expect(h[0]?.heure).toBe('2026-10-18T13:00:00.000Z');
    expect(h.slice(0, -1).every((x) => x.n === 0)).toBe(true);
    expect(pauseEnCours(lu.pauses, 'ttn', new Date('2026-10-19T13:59:00Z'))?.id).toBe('p');
    expect(pauseEnCours(lu.pauses, 'ttn', new Date('2026-10-19T14:00:00Z'))).toBeNull();
  });

  it('des envois à la TTN qui ne partent plus passent en tête d\'« À décider » de qui tient le service ; une pause s\'y rappelle', () => {
    const maintenant = new Date('2026-10-19T12:00:00Z');
    const travaux = { pauses: [{ id: 'p', partenaire: 'relances' as const, le: '2026-10-19T11:00:00Z', jusquAu: '2026-10-19T13:00:00Z', motif: 'incident', par: 'X', leveeLe: null, enCours: true }],
      enPanne: { n: 3, depuis: '2026-10-19T05:00:00Z', heures: 4 } };
    const lignes = aDecider([], { etat: 'absente' }, '2026-10-19', 'technique', [], maintenant, null, [], [], [], travaux);
    expect(lignes.map((l) => l.sorte)).toEqual(['envois_en_panne', 'pause']);
    expect(lignes[0]).toMatchObject({ n: 3, heures: 4 });
    expect(aDecider([], { etat: 'absente' }, '2026-10-19', 'support', [], maintenant, null, [], [], [], travaux)).toEqual([]);
    expect(aDecider([], { etat: 'absente' }, '2026-10-19', 'technique', [], maintenant, null, [], [], [], { ...travaux, enPanne: { n: 0, depuis: null, heures: 4 } })
      .map((l) => l.sorte)).toEqual(['pause']);
  });
});
