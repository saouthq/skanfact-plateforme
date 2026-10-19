// Les demandes d'effacement (0144 ; docs/console.md C68 ; docs/conservation.md ; l'audit 1.42.0 § 4, point 8) :
//   - la direction ou le support note une demande reçue (le jour, le canal, qui la fait, ce qu'elle vise) ; elle prend
//     son numéro et son échéance de réponse ; la direction seule décide, avec sa raison, et efface ;
//   - effacer le compte d'une personne : son nom, son adresse e-mail, son téléphone, ses secrets, ses adresses internet
//     partent de PARTOUT dans la base (un balayage de chaque colonne le vérifie), ce qu'elle a fait reste et se lit
//     « Personne effacée » ; elle ne se connecte plus ; la preuve compte ce qui a été fait ;
//   - une personne encore membre d'une entreprise, ou de l'équipe SkanFact, ne s'efface pas ; les données d'une
//     entreprise ne s'effacent pas d'ici ; une demande refusée ne s'efface pas.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { enRetard, etatEffacement, lireEffacements } from '../../serveur/console/donnees.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, remoteAddress: '192.0.2.41', headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string, nom = `${prenom} ${n + 1}`) {
  const email = `effacement-${prenom}${++n}-${Math.random().toString(36).slice(2, 8)}@exemple.tn`;
  expect((await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP })).statut).toBe(201);
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: `Le téléphone de ${nom}`, type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, nom, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
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
const jour = (decalage = 0) => new Date(horloge.getTime() + decalage * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const noter = (jeton: string, corps: Record<string, unknown>) =>
  appeler('POST', '/console/donnees/effacements', jeton, { canal: 'courriel', demandeur: 'La personne elle-même', recueLe: jour(-2), sorte: 'personne', motif: 'Demande reçue par courriel', ...corps });
const lire = async (jeton: string) => lireEffacements((await appeler('GET', '/console/donnees', jeton)).corps.demandes);

// Chaque colonne de texte de la base (hors catalogues de PostgreSQL) qui contient encore l'une de ces chaînes.
async function ouApparait(...chaines: string[]): Promise<string[]> {
  const colonnes = (await admin.query(`
    select c.table_schema s, c.table_name t, c.column_name col from information_schema.columns c
      join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.table_schema not in ('pg_catalog', 'information_schema') and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'inet', 'USER-DEFINED')
       and c.table_schema not like 'pg_%'`)).rows as { s: string; t: string; col: string }[];
  const trouvees: string[] = [];
  for (const { s, t, col } of colonnes) {
    const r = await admin.query(`select count(*)::int n from "${s}"."${t}" where ${chaines.map((_c, i) => `strpos(lower("${col}"::text), $${i + 1}) > 0`).join(' or ')}`, chaines.map((c) => c.toLowerCase()));
    if (r.rows[0].n > 0) trouvees.push(`${s}.${t}.${col}`);
  }
  return trouvees;
}

let direction: Awaited<ReturnType<typeof membre>>, support: Awaited<ReturnType<typeof membre>>, technique: Awaited<ReturnType<typeof membre>>;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx, () => horloge), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les demandes d\'effacement (0144)', () => {
  it('le compte d\'une personne : noté, décidé, effacé de partout ; ce qu\'elle a fait reste ; elle ne se connecte plus', async () => {
    // Une personne qui a vécu : un code, une entreprise rejointe, un mot de passe faux, un mot de passe oublié.
    const nomUnique = `Zoubeida Trabelsi-${Math.random().toString(36).slice(2, 7)}`;
    const z = await personne('zoubeida', nomUnique);
    expect((await appeler('POST', '/moi/code', z.jeton, { methode: 'application' })).statut).toBe(200);
    const alice = await personne('alice');
    const ent = String((await appeler('POST', '/entreprises', alice.jeton, { raisonSociale: 'Menuiserie de l\'effacement' })).corps.id);
    expect((await appeler('POST', '/moi/code', alice.jeton, { methode: 'application' })).statut).toBe(200);
    const inv = await appeler('POST', `/entreprises/${ent}/invitations`, alice.jeton, { email: z.email, roles: ['commercial'] });
    expect(inv.statut).toBe(201);
    expect((await appeler('POST', '/invitations/accepter', z.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    expect((await appeler('POST', '/connexion', undefined, { email: z.email, motDePasse: 'pas-le-bon', appareil: { nom: 'Poste', type: 'navigateur' } })).statut).toBe(401);
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: z.email });
    expect(await ouApparait(z.email, nomUnique)).not.toEqual([]);

    // Le support note la demande : un numéro, une échéance ; il ne décide pas.
    expect((await noter(support.console, { cible: 'personne-inconnue@exemple.tn' })).corps.motif).toMatch(/aucun compte ne porte cette adresse/i);
    expect((await noter(support.console, { cible: z.email, recueLe: jour(2) })).corps.motif).toMatch(/jamais plus tard qu'aujourd'hui/i);
    expect((await noter(support.console, { cible: z.email, canal: 'pigeon' })).statut).toBe(400);
    expect((await noter(technique.console, { cible: z.email })).statut).toBe(403);
    const notee = await noter(support.console, { cible: z.email.toUpperCase() });
    expect(notee.statut, JSON.stringify(notee.corps)).toBe(201);
    const ref = String(notee.corps.ref), id = String(notee.corps.id);
    expect(ref).toMatch(new RegExp(`^EFF-${horloge.getUTCFullYear()}-\\d{3}$`));
    let d = (await lire(support.console)).find((x) => x.id === id);
    expect(d).toMatchObject({ ref, sorte: 'personne', recueLe: jour(-2), compte: { nom: nomUnique, email: z.email, efface: false } });
    expect(d && etatEffacement(d)).toBe('a_decider');
    expect(d?.echeance).toBe(new Date(Date.parse(`${jour(-2)}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
    expect((await appeler('POST', `/console/donnees/effacements/${id}/decider`, support.console, { decision: 'accordee', raison: 'Rien ne la retient' })).statut).toBe(403);

    // La direction l'accorde ; tant qu'elle est membre de l'entreprise, rien ne s'efface.
    expect((await appeler('POST', `/console/donnees/effacements/${id}/decider`, direction.console, { decision: 'accordee', raison: 'Rien ne la retient' })).statut).toBe(200);
    expect((await appeler('POST', `/console/donnees/effacements/${id}/decider`, direction.console, { decision: 'refusee', raison: 'Changement d\'avis' })).corps.motif).toMatch(/déjà sa décision/i);
    const encoreMembre = await appeler('POST', `/console/donnees/effacements/${id}/faire`, direction.console, { motif: 'Demande accordée' });
    expect(encoreMembre.statut).toBe(403);
    expect(encoreMembre.corps.motif).toMatch(/encore membre d'une entreprise/i);
    const mZ = (await admin.query('select id from socle.membre where entreprise = $1 and utilisateur = $2', [ent, z.id])).rows[0].id as string;
    expect((await appeler('DELETE', `/entreprises/${ent}/membres/${mZ}`, alice.jeton)).statut).toBe(200);

    // Effacé : la preuve compte ce qui a été fait ; plus rien ne la nomme, nulle part.
    const fait = await appeler('POST', `/console/donnees/effacements/${id}/faire`, direction.console, { motif: 'Demande accordée' });
    expect(fait.statut, JSON.stringify(fait.corps)).toBe(200);
    const preuve = fait.corps.preuve as Record<string, number>;
    expect(preuve).toMatchObject({ identite: 1, invitations: 1, tentatives: 1 });
    expect(preuve.sessions).toBeGreaterThanOrEqual(1);
    expect(preuve.codesDeSecours).toBeGreaterThan(0);
    expect(await ouApparait(z.email, nomUnique)).toEqual([]);
    // La trace de l'entreprise garde l'invitation, qui la désigne sans la recopier (0144).
    expect((await admin.query(`select count(*)::int n from socle.audit where entreprise = $1 and geste = 'socle.equipe.inviter' and objet_id = $2`, [ent, inv.corps.id])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int n from socle.session where utilisateur = $1 and ip is not null', [z.id])).rows[0].n).toBe(0);
    // Ce qu'elle a fait reste, à son identifiant : son passage dans l'entreprise.
    expect((await admin.query('select count(*)::int n from socle.membre where utilisateur = $1', [z.id])).rows[0].n).toBe(1);
    expect((await admin.query('select nom from socle.utilisateur where id = $1', [z.id])).rows[0].nom).toBe('Personne effacée');
    // Elle ne se connecte plus : ni sa session d'avant, ni son adresse et son mot de passe.
    expect((await appeler('GET', '/moi', z.jeton)).statut).toBe(401);
    expect((await appeler('POST', '/connexion', undefined, { email: z.email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).statut).toBe(401);
    // L'adresse est libre : elle peut revenir, comme une inconnue.
    expect((await appeler('POST', '/inscription', undefined, { email: z.email, nom: 'Nouvelle venue', motDePasse: MDP })).statut).toBe(201);

    d = (await lire(direction.console)).find((x) => x.id === id);
    expect(d && etatEffacement(d)).toBe('faite');
    expect(d?.compte).toMatchObject({ nom: 'Personne effacée', efface: true });
    expect(d?.demandeur).toBe('Personne effacée');
    expect(d?.preuve).toEqual(preuve);
    expect((await appeler('POST', `/console/donnees/effacements/${id}/faire`, direction.console, { motif: 'Encore' })).corps.motif).toMatch(/déjà fait/i);
    // Chaque geste est au journal de la console, avec son motif ; la preuve, jamais ce qui a été effacé.
    const gestes = (await admin.query(`select geste, motif, apres from plateforme.geste_console where apres->>'demande' = $1 order by le`, [id])).rows;
    expect(gestes.map((g) => g.geste)).toEqual(['donnees.effacement_note', 'donnees.effacement_decide', 'donnees.effacement_fait']);
    expect(gestes[2].apres.preuve).toEqual(preuve);
  });

  it('une personne de l\'équipe SkanFact ne s\'efface pas ; une demande refusée non plus ; une entreprise, jamais d\'ici', async () => {
    const equipe = await noter(direction.console, { cible: technique.email });
    await appeler('POST', `/console/donnees/effacements/${equipe.corps.id}/decider`, direction.console, { decision: 'accordee', raison: 'Accordée' });
    expect((await appeler('POST', `/console/donnees/effacements/${equipe.corps.id}/faire`, direction.console, { motif: 'Essai' })).corps.motif).toMatch(/équipe SkanFact/i);

    const refusee = await noter(direction.console, { cible: support.email, demandeur: 'Quelqu\'un qui se dit le support' });
    expect((await appeler('POST', `/console/donnees/effacements/${refusee.corps.id}/decider`, direction.console, { decision: 'refusee', raison: '' })).statut).toBe(400);
    expect((await appeler('POST', `/console/donnees/effacements/${refusee.corps.id}/decider`, direction.console, { decision: 'refusee', raison: 'Son identité n\'est pas prouvée' })).statut).toBe(200);
    expect((await appeler('POST', `/console/donnees/effacements/${refusee.corps.id}/faire`, direction.console, { motif: 'Essai' })).corps.motif).toMatch(/une fois accordée/i);
    const lue = (await lire(direction.console)).find((x) => x.id === refusee.corps.id);
    expect(lue && etatEffacement(lue)).toBe('refusee');
    expect(lue?.raison).toBe('Son identité n\'est pas prouvée');

    const proprio = await personne('proprietaire');
    const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Société qui s\'en va' })).corps.id);
    const numero = (await admin.query('select plateforme.numero_texte($1) n', [ent])).rows[0].n as string;
    expect((await noter(direction.console, { sorte: 'entreprise', cible: 'E-99999' })).corps.motif).toMatch(/aucune entreprise ne porte ce numéro/i);
    const sortie = await noter(direction.console, { sorte: 'entreprise', cible: numero.toLowerCase(), demandeur: 'Son propriétaire, par lettre' });
    expect(sortie.statut).toBe(201);
    await appeler('POST', `/console/donnees/effacements/${sortie.corps.id}/decider`, direction.console, { decision: 'accordee', raison: 'Elle a téléchargé ses données' });
    expect((await appeler('POST', `/console/donnees/effacements/${sortie.corps.id}/faire`, direction.console, { motif: 'Essai' })).corps.motif).toMatch(/sur la machine/i);
    const e = (await lire(direction.console)).find((x) => x.id === sortie.corps.id);
    expect(e && etatEffacement(e)).toBe('a_faire_machine');
    expect(e?.entreprise).toMatchObject({ id: ent, numero });
    expect((await admin.query('select count(*)::int n from socle.entreprise where id = $1', [ent])).rows[0].n).toBe(1);
    // La technique ne lit pas ce registre.
    expect((await appeler('GET', '/console/donnees', technique.console)).statut).toBe(403);
  });

  it('la lecture ne laisse passer que ce qui a sa forme ; une demande sans décision passée son échéance est en retard', () => {
    const bonne = { id: 'a', ref: 'EFF-2026-001', recueLe: '2026-10-01', echeance: '2026-10-31', noteeLe: '2026-10-01T09:00:00Z', sorte: 'personne', decision: null };
    const lues = lireEffacements([bonne, { ...bonne, sorte: 'autre' }, { ...bonne, recueLe: 'hier' }, null, { ...bonne, preuve: { identite: 1, faux: -2, x: 'y' } }]);
    expect(lues.map((l) => l.id)).toEqual(['a', 'a']);
    expect(lues[1]?.preuve).toEqual({ identite: 1 });
    const d = lues[0];
    if (!d) throw new Error('lue');
    expect(enRetard(d, '2026-10-31')).toBe(false);
    expect(enRetard(d, '2026-11-01')).toBe(true);
    expect(enRetard({ ...d, decision: 'refusee' }, '2026-11-01')).toBe(false);
    expect(etatEffacement({ decision: 'accordee', faiteLe: null, sorte: 'personne' })).toBe('a_faire');
  });
});
