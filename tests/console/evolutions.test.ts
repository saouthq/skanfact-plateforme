// Les retours des clients et les demandes d'évolution (1.42.0 ; base 0134 ; serveur/console/evolutions.ts ; docs/console.md
// C58). Ce qui est garanti :
//   - une évolution se range par le nombre de CLIENTS qui la demandent (deux demandes d'une même entreprise font un
//     client), puis de demandes ; une demande en réclame une au plus (la rattacher ailleurs la déplace) ;
//   - la direction et le support notent, rattachent et détachent ; la direction seule décide de l'état ; « faite » dit sa
//     version, « écartée » sa raison ; la technique ne lit rien ; chaque geste au journal.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { aEtudier, lireEvolutionDe, lireEvolutions } from '../../serveur/console/evolutions.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesSupport } from '../../serveur/support/gestes.ts';
import { routesSupport } from '../../serveur/support/routes.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

describe('les évolutions, pures', () => {
  it('une ligne illisible n\'existe pas ; une demande rattachée illisible non plus ; « à étudier » garde celles que des clients réclament', () => {
    const l = lireEvolutions([
      { id: 'a', titre: 'Export Excel', etat: 'a_etudier', noteeLe: '2026-10-16T08:00:00Z', clients: 2, demandes: 3, derniere: '2026-10-16T09:00:00Z',
        liste: [{ id: 'd', numero: 7, sujet: 'Excel', ouverteLe: '2026-10-16T09:00:00Z', entreprise: { id: 'e', nom: 'Atelier' } }, { id: 'x', numero: 'huit', sujet: 'Excel', ouverteLe: '2026-10-16T09:00:00Z', entreprise: { id: 'e', nom: 'Atelier' } }] },
      { id: 'b', titre: 'Sans client', etat: 'a_etudier', noteeLe: '2026-10-16T08:00:00Z', clients: 0 },
      { id: 'c', titre: 'Faite', etat: 'faite', version: '1.42.0', noteeLe: '2026-10-16T08:00:00Z', clients: 4 },
      { id: 'z', titre: 'État inconnu', etat: 'peut_etre', noteeLe: '2026-10-16T08:00:00Z' },
      { id: 'y', titre: '', etat: 'prevue', noteeLe: '2026-10-16T08:00:00Z' },
      null, 'x',
    ]);
    expect(l.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(l[0]?.liste.map((d) => d.numero)).toEqual([7]);
    expect(l[1]?.demandes).toBe(0);
    expect(aEtudier(l).map((x) => x.id)).toEqual(['a']);
    expect(lireEvolutionDe({ id: 'a', titre: 'Export Excel', etat: 'prevue', version: null })).toEqual({ id: 'a', titre: 'Export Excel', etat: 'prevue', version: null });
    expect(lireEvolutionDe(null)).toBeNull();
  });
});

// ── Par l'API ───────────────────────────────────────────────────────────────────────────────────────────────────────
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evolutions-')), 'veille.json');
let app: FastifyInstance;
type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `evolutions-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Évol${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  const u = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
  return { jeton: String(k.corps.jeton), id: u };
}
// Une cliente qui écrit au support : son entreprise et sa demande.
async function demande(nom: string, sujet: string) {
  const p = await personne('Cliente');
  const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
  const id = String((await appeler('POST', `/entreprises/${ent}/support`, p.jeton, { sujet, texte: `${sujet}, ce serait bien.` })).corps.id);
  return { ent, id, p };
}
const journal = async (qui: string[], prefixe: string) => (await admin.query(
  'select geste, motif, avant, apres from plateforme.geste_console where qui = any($1::uuid[]) and geste like $2 order by le, id', [qui, `${prefixe}%`])).rows as
  { geste: string; motif: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[];
type Lue = { id: string; titre: string; etat: string; version: string | null; raison: string | null; clients: number; demandes: number; liste: { id: string }[] };

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;
beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille }), ...routesSupport(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  technique = await membre('Sami', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); fs.rmSync(path.dirname(veille), { recursive: true, force: true }); });

describe('les évolutions, par l\'API (0134)', () => {
  it('les plus demandées d\'abord, comptées en clients : deux demandes d\'une même entreprise font un client ; une demande, une évolution', async () => {
    const cle = Math.random().toString(36).slice(2, 7);
    const a = await demande(`Atelier ${cle}`, 'Exporter en Excel');
    const a2 = String((await appeler('POST', `/entreprises/${a.ent}/support`, a.p.jeton, { sujet: 'Encore Excel', texte: 'Toujours pour Excel, merci.' })).corps.id);
    const b = await demande(`Boutique ${cle}`, 'Un export Excel');
    const c = await demande(`Café ${cle}`, 'Le mode sombre');
    const excel = await appeler('POST', '/console/support/evolutions', support.jeton, { titre: `Export Excel ${cle}`, description: 'Les factures du mois en fichier Excel.', demande: a.id });
    expect(excel.statut).toBe(201);
    const sombre = await appeler('POST', '/console/support/evolutions', support.jeton, { titre: `Mode sombre ${cle}`, description: null, demande: c.id });
    // Même titre, sans la casse : refusé par la base.
    expect((await appeler('POST', '/console/support/evolutions', support.jeton, { titre: `EXPORT EXCEL ${cle}`, description: null, demande: null })).statut).toBe(403);
    for (const d of [a2, b.id]) expect((await appeler('POST', `/console/support/demandes/${d}/evolution`, support.jeton, { evolution: excel.corps.id })).statut).toBe(200);
    const lues = ((await appeler('GET', '/console/support/evolutions', support.jeton)).corps.evolutions as Lue[]).filter((x) => x.titre.endsWith(cle));
    expect(lues.map((x) => [x.titre, x.clients, x.demandes])).toEqual([[`Export Excel ${cle}`, 2, 3], [`Mode sombre ${cle}`, 1, 1]]);
    // Rattacher ailleurs déplace la demande ; la détacher la retire.
    await appeler('POST', `/console/support/demandes/${b.id}/evolution`, support.jeton, { evolution: sombre.corps.id });
    await appeler('POST', `/console/support/demandes/${a2}/evolution`, direction.jeton, { evolution: null });
    const apres = ((await appeler('GET', '/console/support/evolutions', direction.jeton)).corps.evolutions as Lue[]).filter((x) => x.titre.endsWith(cle));
    expect(apres.map((x) => [x.titre, x.clients, x.demandes])).toEqual([[`Mode sombre ${cle}`, 2, 2], [`Export Excel ${cle}`, 1, 1]]);
    // La demande dit l'évolution qu'elle réclame.
    expect((await appeler('GET', `/console/support?demande=${b.id}`, support.jeton)).corps.evolution).toMatchObject({ titre: `Mode sombre ${cle}`, etat: 'a_etudier' });
    expect((await appeler('GET', `/console/support?demande=${a2}`, support.jeton)).corps.evolution).toBeNull();
    // La technique ne lit rien, ne rattache rien.
    expect((await appeler('GET', '/console/support/evolutions', technique.jeton)).statut).toBe(403);
    expect((await appeler('POST', `/console/support/demandes/${c.id}/evolution`, technique.jeton, { evolution: null })).statut).toBe(403);
    const j = (await journal([support.id, direction.id], 'support.evolution_')).filter((x) => JSON.stringify(x).includes(cle));
    // Noter et rattacher se font dans la même transaction, au même instant : on compte, sans exiger leur ordre.
    const compte = (g: string) => j.filter((x) => x.geste === g).length;
    expect([compte('support.evolution_notee'), compte('support.evolution_rattachee'), compte('support.evolution_detachee')]).toEqual([2, 5, 1]);
    expect(j.at(-1)?.geste).toBe('support.evolution_detachee');
    expect(JSON.stringify(j.filter((x) => x.geste === 'support.evolution_rattachee').map((x) => x.avant))).toContain(`Export Excel ${cle}`);
  });

  it('décider : la direction seule ; « faite » dit sa version, « écartée » sa raison ; au journal', async () => {
    const cle = Math.random().toString(36).slice(2, 7);
    const d = await demande(`Studio ${cle}`, 'Signer les devis');
    const id = String((await appeler('POST', '/console/support/evolutions', support.jeton, { titre: `Signature des devis ${cle}`, description: null, demande: d.id })).corps.id);
    const decider = (jeton: string, corps: Record<string, unknown>) => appeler('POST', `/console/support/evolutions/${id}/decider`, jeton, corps);
    expect((await decider(support.jeton, { etat: 'prevue', version: null, raison: null })).statut).toBe(403);
    expect((await decider(direction.jeton, { etat: 'faite', version: null, raison: null })).statut).toBe(403);
    expect((await decider(direction.jeton, { etat: 'faite', version: '1.42', raison: null })).statut).toBe(403);
    expect((await decider(direction.jeton, { etat: 'ecartee', version: null, raison: '' })).statut).toBe(403);
    expect((await decider(direction.jeton, { etat: 'prevue', version: null, raison: null })).statut).toBe(200);
    expect((await decider(direction.jeton, { etat: 'faite', version: '1.43.0', raison: null })).statut).toBe(200);
    const lue = ((await appeler('GET', '/console/support/evolutions', support.jeton)).corps.evolutions as Lue[]).find((x) => x.id === id);
    expect(lue).toMatchObject({ etat: 'faite', version: '1.43.0', raison: null });
    expect((await decider(direction.jeton, { etat: 'ecartee', version: '1.43.0', raison: 'pas pour cette année' })).statut).toBe(200);
    const ecartee = ((await appeler('GET', '/console/support/evolutions', support.jeton)).corps.evolutions as Lue[]).find((x) => x.id === id);
    expect(ecartee).toMatchObject({ etat: 'ecartee', version: null, raison: 'pas pour cette année' });
    const j = (await journal([direction.id], 'support.evolution_decidee')).filter((x) => JSON.stringify(x).includes(cle));
    expect(j.map((x) => [x.avant?.etat, x.apres?.etat])).toEqual([['a_etudier', 'prevue'], ['prevue', 'faite'], ['faite', 'ecartee']]);
    expect(j[2]?.motif).toBe('pas pour cette année');
  });
});
