// L'API du socle, jouée de bout en bout par des requêtes (sans réseau) contre la vraie base :
// chaque route déclare son geste (03 D2), l'équipe suit ses règles (D4 à D6), la trace se lit
// page par page et ne se modifie jamais.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { creerApp, RouteSansGeste, type Route } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date('2026-10-01T08:00:00Z');
const ctx: Contexte = {
  pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')),
  maintenant: () => horloge, sms: { envoyer: async () => {} },
};
const MDP = 'Un-bon-mot-de-passe';

// Une route de test qui lit une donnée sensible : sa lecture doit être tracée (D10).
const lectureSensible: Route<never> = {
  methode: 'GET', chemin: '/entreprises/:entreprise/export', geste: 'socle.export_complet',
  traiter: async () => ({ corps: { ok: true } }),
};
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({
    method: methode, url,
    headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
    ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }),
  });
  return { statut: r.statusCode, corps: r.json() };
}

let n = 0;
// Une personne neuve (adresse unique), inscrite et connectée par l'API.
async function personne(prenom: string) {
  const email = `${prenom}${++n}@exemple.tn`;
  expect((await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP })).statut).toBe(201);
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  expect(c.corps.etat).toBe('connecte');
  const jeton = String(c.corps.jeton);
  const id = String((await appeler('GET', '/moi', jeton)).corps.id);
  return { email, jeton, id };
}
const mettreLeCode = async (jeton: string) => expect((await appeler('POST', '/moi/code', jeton, { methode: 'application' })).statut).toBe(200);
async function entrepriseDe(p: { jeton: string }) {
  const r = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Menuiserie de l\'essai' });
  expect(r.statut).toBe(201);
  await mettreLeCode(p.jeton);
  return String(r.corps.id);
}
async function membreId(entreprise: string, utilisateur: string) {
  return (await admin.query('select id from socle.membre where entreprise = $1 and utilisateur = $2', [entreprise, utilisateur])).rows[0].id as string;
}
async function inviter(entreprise: string, jeton: string, email: string, roles: string[]) {
  const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, jeton, { email, roles });
  expect(r.statut).toBe(201);
  return String(r.corps.jeton);
}

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx, () => horloge), lectureSensible]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('chaque route déclare son geste (03 D2)', () => {
  const traiter = async () => ({ corps: {} });
  it('une route sans geste, ou avec un geste inconnu, empêche le serveur de démarrer', () => {
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/x', geste: '', traiter }])).toThrow(RouteSansGeste);
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/x', geste: 'socle.nimporte.quoi', traiter }])).toThrow(/geste inconnu/);
  });

  it('un geste d\'entreprise porte :entreprise dans son chemin, et lui seul', () => {
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/equipe', geste: 'socle.equipe.gerer', traiter }])).toThrow(RouteSansGeste);
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/entreprises/:entreprise/moi', geste: 'compte.voir', traiter }])).toThrow(RouteSansGeste);
  });

  it('sans session : 401 et le bouton qui mène à la connexion', async () => {
    const r = await appeler('GET', '/moi');
    expect(r).toEqual({ statut: 401, corps: { motif: 'Connecte-toi pour continuer.', bouton: 'connexion' } });
  });

  it('un corps qui ne va pas : 400, et le champ en cause', async () => {
    const r = await appeler('POST', '/inscription', undefined, { email: 'pas-une-adresse', nom: 'X', motDePasse: MDP });
    expect(r.statut).toBe(400);
    expect(r.corps.champ).toBe('email');
  });
});

describe('le code sur le téléphone se juge à chaque requête', () => {
  it('une session ouverte avant de devenir propriétaire doit mettre le code en place avant tout', async () => {
    const alice = await personne('alice');
    const r = await appeler('POST', '/entreprises', alice.jeton, { raisonSociale: 'Société sans code' });
    const ent = String(r.corps.id);
    const bloque = await appeler('GET', `/entreprises/${ent}/equipe`, alice.jeton);
    expect(bloque.statut).toBe(403);
    expect(bloque.corps.bouton).toBe('compte.code.configurer');
    await mettreLeCode(alice.jeton);
    expect((await appeler('GET', `/entreprises/${ent}/equipe`, alice.jeton)).statut).toBe(200);
  });
});

describe('l\'équipe (03 D4 à D6)', () => {
  it('inviter, accepter : l\'invité reçoit ce qu\'on lui donne, une seule fois, à sa propre adresse', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    const jeton = await inviter(ent, alice.jeton, bob.email.toUpperCase(), ['commercial']);
    // La base ne garde que l'empreinte du lien.
    const gardees = (await admin.query('select jeton_empreinte from socle.invitation where entreprise = $1', [ent])).rows;
    expect(gardees.map((g) => g.jeton_empreinte)).toEqual([createHash('sha256').update(jeton).digest('hex')]);

    const carla = await personne('carla');
    const refus = await appeler('POST', '/invitations/accepter', carla.jeton, { jeton });
    expect(refus).toMatchObject({ statut: 403, corps: { motif: 'Cette invitation a été envoyée à une autre adresse.' } });

    expect((await appeler('POST', '/invitations/accepter', bob.jeton, { jeton })).statut).toBe(200);
    const encore = await appeler('POST', '/invitations/accepter', bob.jeton, { jeton });
    expect(encore.statut).toBe(403);
    expect(encore.corps.motif).toMatch(/plus valable/);

    const equipe = (await appeler('GET', `/entreprises/${ent}/equipe`, bob.jeton)).corps.membres as { utilisateur: string; roles: string[] }[];
    expect(equipe.find((m) => m.utilisateur === bob.id)?.roles).toEqual(['commercial']);
  });

  it('une invitation expirée ne sert plus', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    const jeton = await inviter(ent, alice.jeton, bob.email, ['lecture']);
    await admin.query(`update socle.invitation set expire_le = $1 where entreprise = $2`, [new Date(horloge.getTime() - 1000), ent]);
    expect((await appeler('POST', '/invitations/accepter', bob.jeton, { jeton })).statut).toBe(403);
  });

  it('un refus de rôle nomme qui peut, et le bouton « demander »', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['commercial']) });
    const r = await appeler('POST', `/entreprises/${ent}/invitations`, bob.jeton, { email: 'x@exemple.tn', roles: ['lecture'] });
    expect(r.statut).toBe(403);
    expect(r.corps.bouton).toBe('demander');
    expect((r.corps.qui as { utilisateur: string }[]).map((q) => q.utilisateur)).toEqual([alice.id]);
    // La trace de toute l'entreprise est au propriétaire et à l'administrateur.
    expect((await appeler('GET', `/entreprises/${ent}/trace`, bob.jeton)).statut).toBe(403);
  });

  it('D3 : une entreprise dont on n\'est pas membre répond « introuvable »', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const etranger = await personne('etranger');
    expect(await appeler('GET', `/entreprises/${ent}/equipe`, etranger.jeton)).toEqual({ statut: 404, corps: { motif: 'Introuvable.', qui: [], bouton: null } });
    expect((await appeler('GET', `/entreprises/pas-un-uuid/equipe`, etranger.jeton)).statut).toBe(404);
  });

  it('D6 : personne ne se donne un droit ; l\'administrateur ne touche ni à son rôle ni au propriétaire', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['commercial']) });
    const mBob = await membreId(ent, bob.id);
    const mAlice = await membreId(ent, alice.id);

    // Alice fait de Bob un administrateur : il doit alors mettre son code en place.
    expect((await appeler('PUT', `/entreprises/${ent}/membres/${mBob}/roles`, alice.jeton, { roles: ['administrateur'] })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/equipe`, bob.jeton)).corps.bouton).toBe('compte.code.configurer');
    await mettreLeCode(bob.jeton);

    const soi = await appeler('PUT', `/entreprises/${ent}/membres/${mBob}/roles`, bob.jeton, { roles: ['administrateur', 'paie'] });
    expect(soi).toMatchObject({ statut: 403, corps: { motif: 'Personne ne change son propre rôle.' } });
    const proprio = await appeler('PUT', `/entreprises/${ent}/membres/${mAlice}/roles`, bob.jeton, { roles: ['lecture'] });
    expect(proprio.statut).toBe(403);
    expect(proprio.corps.motif).toMatch(/propriétaire ne se change pas/);
    const retirer = await appeler('DELETE', `/entreprises/${ent}/membres/${mAlice}`, bob.jeton);
    expect(retirer.statut).toBe(403);
    expect(retirer.corps.motif).toMatch(/ne retire pas le propriétaire/);
    // Le rôle de propriétaire ne se donne pas : il se transfère.
    expect((await appeler('POST', `/entreprises/${ent}/invitations`, bob.jeton, { email: 'z@exemple.tn', roles: ['proprietaire'] })).statut).toBe(400);
    // On ne s'invite pas soi-même (le propriétaire perdrait son rôle en acceptant).
    const moiMeme = await appeler('POST', `/entreprises/${ent}/invitations`, alice.jeton, { email: alice.email, roles: ['lecture'] });
    expect(moiMeme).toMatchObject({ statut: 403, corps: { motif: 'Personne ne s\'invite soi-même.' } });
    // Un membre d'une autre entreprise ne se touche pas depuis celle-ci.
    const autre = await entrepriseDe(await personne('dora'));
    expect((await appeler('PUT', `/entreprises/${autre}/membres/${mBob}/roles`, alice.jeton, { roles: ['lecture'] })).statut).toBe(404);
  });

  it('D4 : le transfert de propriété, accepté par le nouveau ; l\'ancien reste administrateur', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    const carla = await personne('carla');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['commercial']) });
    await appeler('POST', '/invitations/accepter', carla.jeton, { jeton: await inviter(ent, alice.jeton, carla.email, ['lecture']) });

    expect((await appeler('POST', `/entreprises/${ent}/transfert`, alice.jeton, { vers: alice.id })).statut).toBe(403);
    const t = await appeler('POST', `/entreprises/${ent}/transfert`, alice.jeton, { vers: bob.id });
    expect(t.statut).toBe(201);
    const transfert = String(t.corps.id);
    expect((await appeler('POST', `/transferts/${transfert}/accepter`, carla.jeton)).statut).toBe(403);
    expect((await appeler('POST', `/transferts/${transfert}/accepter`, bob.jeton)).statut).toBe(200);

    const roles = async (u: string) => (await admin.query('select roles from socle.membre where entreprise = $1 and utilisateur = $2', [ent, u])).rows[0].roles;
    expect(await roles(alice.id)).toEqual(['administrateur']);
    expect((await roles(bob.id)).sort()).toEqual(['commercial', 'proprietaire']);
    // Alice n'est plus propriétaire : la porte refuse le transfert.
    expect((await appeler('POST', `/entreprises/${ent}/transfert`, alice.jeton, { vers: carla.id })).statut).toBe(403);
  });

  it('D4 : un transfert vers quelqu\'un qui a quitté l\'équipe ne laisse pas l\'entreprise sans propriétaire', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['lecture']) });
    const transfert = String((await appeler('POST', `/entreprises/${ent}/transfert`, alice.jeton, { vers: bob.id })).corps.id);
    expect((await appeler('DELETE', `/entreprises/${ent}/membres/${await membreId(ent, bob.id)}`, alice.jeton)).statut).toBe(200);
    expect((await appeler('POST', `/transferts/${transfert}/accepter`, bob.jeton)).statut).toBe(403);
    const proprietaires = (await admin.query(`select utilisateur from socle.membre where entreprise = $1 and actif and 'proprietaire' = any(roles)`, [ent])).rows;
    expect(proprietaires.map((p) => p.utilisateur)).toEqual([alice.id]);
  });

  it('le propriétaire qui accepte une invitation dans sa propre entreprise garde son rôle', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['administrateur']) });
    await mettreLeCode(bob.jeton);
    const jeton = await inviter(ent, bob.jeton, alice.email, ['lecture']);
    expect((await appeler('POST', '/invitations/accepter', alice.jeton, { jeton })).statut).toBe(403);
    expect((await admin.query('select roles from socle.membre where entreprise = $1 and utilisateur = $2', [ent, alice.id])).rows[0].roles).toEqual(['proprietaire']);
  });

  it('retirer un membre : son accès tombe aussitôt', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['caissier']) });
    expect((await appeler('GET', `/entreprises/${ent}/equipe`, bob.jeton)).statut).toBe(200);
    expect((await appeler('DELETE', `/entreprises/${ent}/membres/${await membreId(ent, bob.id)}`, alice.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/equipe`, bob.jeton)).statut).toBe(404);
  });
});

describe('la trace (01 R10, 03 § 7)', () => {
  it('chaque geste de l\'équipe laisse sa trace, lue page par page sans ligne sautée ni doublon', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    for (const prenom of ['bob', 'carla', 'dan']) {
      const p = await personne(prenom);
      await appeler('POST', '/invitations/accepter', p.jeton, { jeton: await inviter(ent, alice.jeton, p.email, ['lecture']) });
    }
    // Plusieurs gestes d'une même transaction portent le même instant : la page ne doit pas les perdre.
    await admin.query(`insert into socle.audit (instant, entreprise, utilisateur, geste) select $1, $2, $3, 'essai.meme_instant' from generate_series(1, 3)`,
      [new Date(), ent, alice.id]);
    const vues: string[] = [];
    const gestes: string[] = [];
    let suite: string | null = null;
    let pages = 0;
    do {
      const r: Reponse = await appeler('GET', `/entreprises/${ent}/trace?limite=2${suite ? `&avant=${encodeURIComponent(suite)}` : ''}`, alice.jeton);
      expect(r.statut).toBe(200);
      const lignes = r.corps.lignes as { id: string; geste: string }[];
      vues.push(...lignes.map((l) => l.id));
      gestes.push(...lignes.map((l) => l.geste));
      suite = r.corps.suite as string | null;
      pages++;
    } while (suite && pages < 20);
    // 1 création + 3 invitations + 3 acceptations + 3 gestes au même instant.
    const enBase = (await admin.query('select id from socle.audit where entreprise = $1', [ent])).rows.map((x) => x.id);
    expect(vues.slice().sort()).toEqual(enBase.slice().sort());
    expect(new Set(vues).size).toBe(vues.length);
    expect(gestes.filter((g) => g === 'socle.equipe.inviter')).toHaveLength(3);
    expect(gestes.filter((g) => g === 'socle.equipe.accepter')).toHaveLength(3);
    expect(gestes).toContain('socle.entreprise.creer');
    expect(vues).toHaveLength(10);
  });

  it('chacun lit sa propre activité, et seulement la sienne', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['lecture']) });
    const lignes = (await appeler('GET', '/moi/trace', bob.jeton)).corps.lignes as { geste: string }[];
    expect(lignes.map((l) => l.geste)).toEqual(['socle.equipe.accepter']);
    // Et la base elle-même ne lui montre rien d'autre de l'entreprise (sa règle de lecture).
    const enDirect = await enTantQue(pool, bob.id, async (tx) => (await tx.query('select geste from socle.audit where entreprise = $1', [ent])).rows);
    expect(enDirect.map((l) => l.geste)).toEqual(['socle.equipe.accepter']);
  });

  it('une lecture de donnée sensible est tracée (D10)', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    expect((await appeler('GET', `/entreprises/${ent}/export`, alice.jeton)).statut).toBe(200);
    const l = (await admin.query(`select utilisateur, lecture from socle.audit where entreprise = $1 and geste = 'socle.export_complet'`, [ent])).rows;
    expect(l).toEqual([{ utilisateur: alice.id, lecture: true }]);
  });

  it('la trace ne se modifie pas et ne s\'efface pas, même par le propriétaire des tables', async () => {
    await expect(admin.query(`update socle.audit set geste = 'maquillé'`)).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`delete from socle.audit`)).rejects.toMatchObject({ code: '42501' });
  });

  it('on n\'écrit pas la trace d\'un autre, et on ne lit pas un mois en direct', async () => {
    const alice = await personne('alice');
    const bob = await personne('bob');
    await expect(enTantQue(pool, bob.id, (tx) => tx.query(`insert into socle.audit (utilisateur, geste) values ($1, 'faux')`, [alice.id])))
      .rejects.toMatchObject({ code: '42501' });
    await expect(enTantQue(pool, bob.id, (tx) => tx.query(`select * from socle.audit_2026_10`))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('les règles et les séries par l\'API', () => {
  it('le propriétaire crée une série, annonce où elle en était, et lit le prochain numéro sans le prendre', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const s = await appeler('POST', `/entreprises/${ent}/series`, alice.jeton, { type: 'facture', prefixe: 'FAC', legale: true });
    expect(s.statut).toBe(201);
    const serie = String(s.corps.id);
    const prochain = async () => (await appeler('GET', `/entreprises/${ent}/series/${serie}/prochain?date=2026-10-01`, alice.jeton)).corps;
    expect(await prochain()).toEqual({ numero: 1, texte: 'FAC-2026-001' });
    expect((await appeler('POST', `/entreprises/${ent}/series/${serie}/reprise`, alice.jeton, { periode: 2026, dernier: 41 })).statut).toBe(200);
    expect(await prochain()).toEqual({ numero: 42, texte: 'FAC-2026-042' });
    expect(await prochain()).toEqual({ numero: 42, texte: 'FAC-2026-042' });
    expect((await appeler('GET', `/entreprises/${ent}/series/${serie}/prochain`, alice.jeton)).statut).toBe(400);
  });

  it('une série se touche depuis son entreprise, jamais par le chemin d\'une autre', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const serie = String((await appeler('POST', `/entreprises/${ent}/series`, alice.jeton, { type: 'facture', prefixe: 'FAC', legale: true })).corps.id);
    const bob = await personne('bob');
    const autre = await entrepriseDe(bob);
    await appeler('POST', '/invitations/accepter', alice.jeton, { jeton: await inviter(autre, bob.jeton, alice.email, ['lecture']) });
    expect((await appeler('GET', `/entreprises/${autre}/series/${serie}/prochain?date=2026-10-01`, alice.jeton)).statut).toBe(404);
  });

  it('un commercial ne crée pas de série et ne pose pas de règle (la porte le dit)', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    const bob = await personne('bob');
    await appeler('POST', '/invitations/accepter', bob.jeton, { jeton: await inviter(ent, alice.jeton, bob.email, ['commercial']) });
    const serie = await appeler('POST', `/entreprises/${ent}/series`, bob.jeton, { type: 'facture', prefixe: 'FAC', legale: true });
    expect(serie.statut).toBe(403);
    expect(serie.corps.motif).toMatch(/modifier le régime fiscal, l'exercice ou les séries/);
    expect((await appeler('POST', `/entreprises/${ent}/regles`, bob.jeton, { code: 'essai.taux', valeur: 1, debut: '2026-01-01', motif: 'x' })).statut).toBe(403);
  });

  it('une règle inconnue se dit « non renseignée » ; une règle posée se relit ; une virgule est refusée', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    expect((await appeler('GET', `/entreprises/${ent}/regles/essai.absente?date=2026-10-01`, alice.jeton)).corps)
      .toEqual({ valeur: null, motif: 'Règle non renseignée à cette date.' });
    const virgule = await appeler('POST', `/entreprises/${ent}/regles`, alice.jeton, { code: 'essai.api', valeur: 0.5, debut: '2026-01-01', motif: 'x' });
    expect(virgule.statut).toBe(400);
    expect(virgule.corps.champ).toBe('valeur');
    expect((await appeler('POST', `/entreprises/${ent}/regles`, alice.jeton, { code: 'essai.api', valeur: { taux: 15000 }, debut: '2026-01-01', motif: 'Attestation d\'essai' })).statut).toBe(201);
    expect((await appeler('GET', `/entreprises/${ent}/regles/essai.api?date=2026-10-01`, alice.jeton)).corps)
      .toMatchObject({ valeur: { taux: 15000 }, origine: 'entreprise', source: 'Attestation d\'essai' });
  });

  it('l\'état des chaînes du journal se lit par le propriétaire', async () => {
    const alice = await personne('alice');
    const ent = await entrepriseDe(alice);
    expect(await appeler('GET', `/entreprises/${ent}/chaines`, alice.jeton)).toEqual({ statut: 200, corps: { chaines: [] } });
  });
});
