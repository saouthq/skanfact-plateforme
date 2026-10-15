// Une demande du support liée à son incident et à sa correction (1.32.0 ; base 0126 ; docs/console.md C48 ; la liste des
// fonctions qui manquent, 19) :
//   - la direction et le support lient une demande à un incident (ouvert, ou clos depuis trente jours), l'en délient ;
//     l'incident compte les demandes liées, sans les nommer — la technique lit ce compte ;
//   - ils notent la version qui corrige une demande ; quand la version en service l'atteint, la demande le dit ;
//   - chaque geste a son motif et sa ligne au journal ; chaque refus dit pourquoi.

import fs from 'node:fs';
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
import { versionAtteinte } from '../../serveur/console/support.ts';
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
let n = 0, matricules = 0;
async function personne(prenom: string) {
  const email = `liens-${prenom}${++n}@exemple.tn`;
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
async function entreprise(nom: string) {
  const p = await personne('proprio');
  const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom, matriculeFiscal: `${String(5_500_000 + ++matricules).slice(-7)}C/A/M/000` });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  return { ent: String(cree.corps.id), proprio: p };
}
// Une demande écrite depuis l'application, il y a `heures` heures.
async function demande(ent: string, demandeur: string, sujet: string, heures: number) {
  const le = new Date(horloge.getTime() - heures * 3_600_000);
  const id = (await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le) values ($1, $2, 'application', $3, $4) returning id`,
    [ent, demandeur, sujet, le])).rows[0].id as string;
  await admin.query(`insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values ($1, 'client', $2, 'Bonjour, ça ne marche pas.', $3)`, [id, demandeur, le]);
  return id;
}

// La version en service : ce que le suiveur écrit à chaque tour (public/etat.json, à côté du fichier de la veille).
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liens-'));
const SHA = 'a'.repeat(40);
const enService = (numero: string | null) => {
  fs.mkdirSync(path.join(dossier, 'public'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'public', 'etat.json'), JSON.stringify({ version: SHA, numeros: numero ? { [SHA]: numero } : {} }));
};

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;

beforeAll(async () => {
  await admin.connect();
  enService('1.31.0');
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: path.join(dossier, 'veille.json') })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

type Lien = { incident: { id: string; ref: string; titre: string; closLe: string | null } | null; correction: { version: string; enService: boolean } | null };
const laLigne = async (jeton: string, ent: string) => ((await appeler('GET', `/console/support?entreprise=${ent}`, jeton)).corps as { ouvertes: (Lien & { id: string })[] }).ouvertes[0];
const ouvrirIncident = async (titre: string) => {
  const r = await appeler('POST', '/console/service/incidents', technique.console, { titre, gravite: 'majeur', fiche: null, public: null, motif: 'la veille crie' });
  expect(r.statut, JSON.stringify(r.corps)).toBeLessThan(300);
  const lus = (await appeler('GET', '/console/support/incidents', support.console)).corps.incidents as { id: string; ref: string; titre: string }[];
  const i = lus.find((x) => x.titre === titre);
  if (!i) throw new Error('incident attendu');
  return i;
};
const demandesDe = async (incident: string, jeton = technique.console) => {
  const lus = (await appeler('GET', '/console/service/incidents', jeton)).corps as { ouverts: { id: string; demandes: { n: number; ouvertes: number } }[] };
  return lus.ouverts.find((i) => i.id === incident)?.demandes;
};
const journal = async (geste: string, ent: string) => (await admin.query(
  'select role, motif, avant, apres from plateforme.geste_console where geste = $1 and entreprise = $2 order by le', [geste, ent])).rows;

describe('une demande liée à son incident (0126)', () => {
  it('le support la lie à un incident ouvert : la demande le dit, l\'incident la compte sans la nommer ; délier la retire ; chaque geste au journal', async () => {
    const { ent, proprio } = await entreprise('Épicerie Liée');
    const id = await demande(ent, proprio.id, 'La caisse ne répond plus', 1);
    const inc = await ouvrirIncident('La caisse ne répond plus nulle part');
    expect(await demandesDe(inc.id)).toEqual({ n: 0, ouvertes: 0 });
    // Sans motif : refusé, rien ne change.
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: inc.id, motif: 'x' })).statut).toBe(400);
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: inc.id, motif: 'la même panne que la veille' })).statut).toBe(200);
    expect((await laLigne(support.console, ent))?.incident).toMatchObject({ id: inc.id, ref: inc.ref, titre: 'La caisse ne répond plus nulle part', closLe: null });
    // L'incident la compte ; la technique lit le compte, jamais la demande ni son client.
    expect(await demandesDe(inc.id)).toEqual({ n: 1, ouvertes: 1 });
    const lu = JSON.stringify((await appeler('GET', '/console/service/incidents', technique.console)).corps);
    expect(lu).not.toContain('Épicerie Liée');
    expect(lu).not.toContain('La caisse ne répond plus"');
    // La même chose deux fois : refusé, et le refus le dit.
    const deux = await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: inc.id, motif: 'encore' });
    expect(deux.statut).toBe(403);
    expect(deux.corps.motif).toBe('Cette demande est déjà liée à cet incident.');
    // Close, elle compte encore, mais plus comme ouverte.
    await admin.query('update plateforme.demande_support set close_le = now(), close_cote = $2, close_par = $3 where id = $1', [id, 'client', proprio.id]);
    expect(await demandesDe(inc.id)).toEqual({ n: 1, ouvertes: 0 });
    await admin.query('update plateforme.demande_support set close_le = null, close_cote = null, close_par = null where id = $1', [id]);
    // Délier : la demande ne le dit plus, l'incident ne la compte plus.
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, direction.console, { incident: null, motif: 'une autre cause' })).statut).toBe(200);
    expect((await laLigne(support.console, ent))?.incident).toBeNull();
    expect(await demandesDe(inc.id)).toEqual({ n: 0, ouvertes: 0 });
    const rien = await appeler('POST', `/console/support/demandes/${id}/incident`, direction.console, { incident: null, motif: 'encore' });
    expect(rien.corps.motif).toBe('Cette demande n\'est liée à aucun incident.');
    expect(await journal('support.incident', ent)).toEqual([
      { role: 'support', motif: 'la même panne que la veille', avant: { demande: id, numero: expect.any(Number), incident: null }, apres: { demande: id, numero: expect.any(Number), incident: inc.ref } },
      { role: 'direction', motif: 'une autre cause', avant: { demande: id, numero: expect.any(Number), incident: inc.ref }, apres: { demande: id, numero: expect.any(Number), incident: null } },
    ]);
  });

  it('un incident clos depuis plus de trente jours, ou qui n\'existe pas, ne se lie pas ; la technique ne lie rien', async () => {
    const { ent, proprio } = await entreprise('Librairie Liée');
    const id = await demande(ent, proprio.id, 'Les factures sont lentes', 1);
    const vieux = await ouvrirIncident('Une lenteur ancienne');
    await admin.query(`update plateforme.service_incident set fin = now() - interval '40 days', clos_le = now() - interval '31 days', clos_par = ouvert_par,
      ouvert_le = now() - interval '41 days', effet = 'des factures lentes', cause = 'un index manquant', change = 'un index est posé' where id = $1`, [vieux.id]);
    expect(((await appeler('GET', '/console/support/incidents', support.console)).corps.incidents as { id: string }[]).some((i) => i.id === vieux.id)).toBe(false);
    const r = await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: vieux.id, motif: 'la même lenteur' });
    expect(r.corps.motif).toBe('Cet incident n\'existe pas, ou il est clos depuis plus de trente jours.');
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: '01a133c0-b805-7a3e-a711-7b49e8e43224', motif: 'la même lenteur' })).statut).toBe(403);
    // Clos depuis vingt-neuf jours : encore proposé, et il se lie.
    await admin.query(`update plateforme.service_incident set clos_le = now() - interval '29 days' where id = $1`, [vieux.id]);
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, support.console, { incident: vieux.id, motif: 'la même lenteur' })).statut).toBe(200);
    expect((await laLigne(support.console, ent))?.incident?.closLe).not.toBeNull();
    // La technique ne lit pas les demandes : ni la liste des incidents à lier, ni les gestes.
    expect((await appeler('GET', '/console/support/incidents', technique.console)).statut).toBe(403);
    expect((await appeler('POST', `/console/support/demandes/${id}/incident`, technique.console, { incident: null, motif: 'je délie' })).statut).toBe(403);
  });
});

describe('une demande et la version qui la corrige (0126)', () => {
  it('notée « 1.32.0 » : attendue tant que la version en service est avant elle, corrigée quand elle l\'atteint ; retirée, elle n\'attend plus rien', async () => {
    const { ent, proprio } = await entreprise('Pharmacie Corrigée');
    const id = await demande(ent, proprio.id, 'Le total de la facture est faux', 2);
    for (const v of ['1.32', 'v1.32.0', '1.32.0-beta.1']) {
      expect((await appeler('POST', `/console/support/demandes/${id}/correction`, support.console, { version: v, motif: 'un arrondi faux' })).statut, v).toBe(400);
    }
    expect((await appeler('POST', `/console/support/demandes/${id}/correction`, support.console, { version: '1.32.0', motif: 'un arrondi faux' })).statut).toBe(200);
    expect((await laLigne(support.console, ent))?.correction).toMatchObject({ version: '1.32.0', enService: false });
    // La préversion n'est pas encore la version ; la version, et toute suivante, l'atteignent.
    enService('1.32.0-beta.2');
    expect((await laLigne(support.console, ent))?.correction?.enService).toBe(false);
    enService('1.32.0');
    expect((await laLigne(support.console, ent))?.correction?.enService).toBe(true);
    enService('1.40.1');
    expect((await laLigne(support.console, ent))?.correction?.enService).toBe(true);
    // Rien d'installé de lisible : pas encore.
    enService(null);
    expect((await laLigne(support.console, ent))?.correction?.enService).toBe(false);
    enService('1.31.0');
    const deux = await appeler('POST', `/console/support/demandes/${id}/correction`, support.console, { version: '1.32.0', motif: 'encore' });
    expect(deux.corps.motif).toBe('Cette demande attend déjà cette version.');
    expect((await appeler('POST', `/console/support/demandes/${id}/correction`, direction.console, { version: null, motif: 'pas un défaut' })).statut).toBe(200);
    expect((await laLigne(support.console, ent))?.correction).toBeNull();
    expect((await appeler('POST', `/console/support/demandes/${id}/correction`, direction.console, { version: null, motif: 'encore' })).corps.motif)
      .toBe('Cette demande n\'attend aucune correction.');
    expect((await journal('support.correction', ent)).map((g) => [g.role, g.motif, g.avant.correction, g.apres.correction]))
      .toEqual([['support', 'un arrondi faux', null, '1.32.0'], ['direction', 'pas un défaut', '1.32.0', null]]);
    expect((await appeler('POST', `/console/support/demandes/${id}/correction`, technique.console, { version: '1.33.0', motif: 'un arrondi faux' })).statut).toBe(403);
  });

  it('la version atteinte se compare nombre par nombre, jamais comme un texte', () => {
    expect(versionAtteinte('1.10.0', '1.9.9')).toBe(false);
    expect(versionAtteinte('1.9.0', '1.10.0')).toBe(true);
    expect(versionAtteinte('2.0.0', '1.99.99')).toBe(false);
    expect(versionAtteinte('1.32.0', '1.32.0-beta.1')).toBe(false);
    expect(versionAtteinte('1.31.0', '1.32.0-beta.1')).toBe(true);
    expect(versionAtteinte('1.32.0', null)).toBe(false);
  });
});

describe('prévenir d\'un coup les clients d\'un incident (0128)', () => {
  const messages = async (demandeId: string) => (await admin.query(
    "select texte from plateforme.message_support where demande = $1 and cote = 'equipe' order by ecrit_le", [demandeId])).rows.map((r) => r.texte as string);
  const prevenir = (incident: string, jeton: string, texte: string, commande: string) =>
    appeler('POST', `/console/support/incidents/${incident}/repondre`, jeton, { texte, commande });

  it('chaque demande ouverte liée reçoit le même mot, une fois ; ni la close, ni celle d\'à côté ; un renvoi n\'écrit rien deux fois', async () => {
    const a = await entreprise('Boulangerie Prévenue'), b = await entreprise('Librairie Prévenue'), c = await entreprise('Garage Prévenu');
    const inc = await ouvrirIncident('Les PDF ne partent plus du tout');
    const da = await demande(a.ent, a.proprio.id, 'Mon PDF ne part pas', 2);
    const db = await demande(b.ent, b.proprio.id, 'Impossible d\'envoyer la facture', 1);
    const close = await demande(c.ent, c.proprio.id, 'PDF bloqué', 3);
    const aCote = await demande(c.ent, c.proprio.id, 'Une autre question', 1);
    for (const d of [da, db, close]) {
      expect((await appeler('POST', `/console/support/demandes/${d}/incident`, support.console, { incident: inc.id, motif: 'la même panne' })).statut).toBe(200);
    }
    await admin.query('update plateforme.demande_support set close_le = now(), close_cote = $2, close_par = $3 where id = $1', [close, 'client', c.proprio.id]);
    expect(await demandesDe(inc.id)).toEqual({ n: 3, ouvertes: 2 });
    const commande = crypto.randomUUID();
    // La technique lit les incidents, pas les demandes : elle ne prévient personne. Un mot vide ne part pas.
    expect((await prevenir(inc.id, technique.console, 'C\'est réparé.', commande)).statut).toBe(403);
    expect((await prevenir(inc.id, support.console, '  ', commande)).statut).toBe(400);
    const mot = 'Les PDF repartent depuis 10 h 20 : renvoyez ceux qui étaient restés bloqués.';
    const r = await prevenir(inc.id, support.console, mot, commande);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.demandes).toBe(2);
    expect(await messages(da)).toEqual([mot]);
    expect(await messages(db)).toEqual([mot]);
    expect(await messages(close)).toEqual([]);
    expect(await messages(aCote)).toEqual([]);
    // Renvoyé après une coupure (la même commande) : rien de plus, ni message ni ligne au journal.
    const encore = await prevenir(inc.id, support.console, mot, commande);
    expect(encore.statut).toBe(201);
    expect(await messages(da)).toEqual([mot]);
    const geste = await admin.query("select role, motif, apres from plateforme.geste_console where geste = 'support.prevenir' and apres ->> 'incident' = $1", [inc.ref]);
    expect(geste.rows).toEqual([{ role: 'support', motif: inc.ref, apres: { incident: inc.ref, demandes: 2 } }]);
    // Chaque réponse est aussi celle d'une demande, dans son propre journal.
    expect((await journal('support.repondre', a.ent)).map((g) => g.motif)).toEqual(['Mon PDF ne part pas']);
    // Plus aucune demande ouverte : il n'y a personne à prévenir, et le refus le dit.
    await admin.query('update plateforme.demande_support set close_le = now(), close_cote = $2, close_par = $3 where id = any($1)', [[da, db], 'equipe', direction.id]);
    const vide = await prevenir(inc.id, direction.console, 'C\'est réparé.', crypto.randomUUID());
    expect(vide.statut).toBe(403);
    expect(vide.corps.motif).toBe('Aucune demande ouverte n\'est liée à cet incident : il n\'y a personne à prévenir.');
  });
});
