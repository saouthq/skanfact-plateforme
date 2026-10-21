// Les sauvegardes, vues de l'entreprise (lot Fonctions 3 ; serveur/sauvegardes.ts, base 0161 ; docs/sauvegardes-ecran.md),
// par l'API. Ce que le serveur garantit :
//   - le propriétaire et un administrateur lisent la dernière nuit (réussie ou non), la dernière réussie, l'essai de
//     restauration, la copie hors de la machine et le dernier passage de la veille ; un autre rôle, une voisine, non ;
//   - une veille qui se tait se dit (« recente » faux), au lieu d'un état d'il y a une heure lu comme celui de maintenant ;
//   - demander de revenir à une minute ouvre une demande au support qui porte la minute et le motif ; une minute à venir,
//     ou plus vieille que ce qu'on garde, se refuse et dit pourquoi ; un commercial ne le demande pas.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesSauvegardes } from '../../serveur/sauvegardes.ts';
import { declarerGestesSupport } from '../../serveur/support/gestes.ts';
import { routesSupport } from '../../serveur/support/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
// Le 21/10/2026 à 15:07, heure de Tunis.
const MAINTENANT = new Date('2026-10-21T14:07:00Z');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => MAINTENANT };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
const emails = new Map<string, string>();
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  emails.set(jeton, email);
  return jeton;
}
const entreprise = async (jeton: string, nom: string) => String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
const membre = (jeton: string, ent: string, role: string) => admin.query('insert into socle.membre (utilisateur, entreprise, roles) select u.id, $2, $3 from socle.utilisateur u where u.email = $1', [emails.get(jeton), ent, [role]]);

beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesSupport(ctx), ...routesSauvegardes(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les sauvegardes, vues de l\'entreprise', () => {
  it('le propriétaire et un administrateur lisent les copies ; un commercial et la voisine, non ; une veille muette se dit', async () => {
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit');
    // Trois nuits : le 19 réussie avec son essai de restauration, le 20 réussie, le 21 échouée.
    await admin.query(`insert into plateforme.service_nuit (jour, sauvegarde, copie_de_base, restauration) values
      ('2026-10-19', '{"le":"2026-10-19T02:31:12Z","ok":true}', '{"le":"2026-10-19T02:46:00Z","ok":true}', '{"le":"2026-10-19T04:02:30Z","ok":true}'),
      ('2026-10-20', '{"le":"2026-10-20T02:30:58Z","ok":true}', '{"le":"2026-10-20T02:45:40Z","ok":true}', null),
      ('2026-10-21', '{"le":"2026-10-21T02:32:05Z","ok":false}', null, null)`);
    // La veille est passée il y a 3 minutes : la copie hors de la machine réglée, en attente depuis 14:01.
    await admin.query(`insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, copies)
      values ('2026-10-21T14:04:00Z', true, 10, 40, 2, '[]', '{"archivage":{"enMarche":true},"horsMachine":{"regle":true,"attenteDepuis":"2026-10-21T14:01:00Z"}}')`);
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const r = await appeler('GET', `/entreprises/${ent}/sauvegardes`, nadia);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({
      calendrier: { sauvegarde: '03:30', exercice: { jourDuMois: 1, heure: '05:00' } }, garde: { nuits: 14, jours: 35 },
      nuit: { jour: '2026-10-21', sauvegarde: { ok: false } }, reussie: { jour: '2026-10-20', le: '2026-10-20T02:30:58Z' },
      exercice: { jour: '2026-10-19', ok: true }, archivage: { enMarche: true }, horsMachine: { regle: true, attenteDepuis: '2026-10-21T14:01:00Z' },
      veille: { recente: true }, remises: [],
    });
    const karim = await personne('karim');
    await membre(karim, ent, 'administrateur');
    expect((await appeler('GET', `/entreprises/${ent}/sauvegardes`, karim)).statut).toBe(200);
    const sami = await personne('sami');
    await membre(sami, ent, 'commercial');
    expect((await appeler('GET', `/entreprises/${ent}/sauvegardes`, sami)).statut).toBe(403);
    // La base le redit, sans la porte du serveur : un commercial qui appelle la fonction elle-même est refusé.
    const samiId = String((await admin.query('select id from socle.utilisateur where email = $1', [emails.get(sami)])).rows[0].id);
    await expect(enTantQue(pool, samiId, (tx) => tx.query('select plateforme.mes_sauvegardes($1, now())', [ent]))).rejects.toThrow(/propriétaire et ses administrateurs/);
    const voisine = await personne('voisine');
    await entreprise(voisine, 'Librairie du Lac');
    expect((await appeler('GET', `/entreprises/${ent}/sauvegardes`, voisine)).statut).toBe(404);
    // La veille se tait depuis 14:04 : à 14:20, l'état n'est plus celui de maintenant.
    await admin.query(`update plateforme.service_releve set minute = '2026-10-21T13:50:00Z'`);
    expect((await appeler('GET', `/entreprises/${ent}/sauvegardes`, nadia)).corps.veille).toMatchObject({ minute: expect.stringMatching(/^2026-10-21T13:50/), recente: false });
  });

  it('demander de revenir à une minute : une demande au support avec la minute et le motif ; à venir ou trop vieille, refusée', async () => {
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const r = await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, nadia, { minute: '2026-10-21 09:15', motif: 'Une importation de tableur a écrasé mes prix ce matin' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const d = (await admin.query(`select d.sujet, d.page, m.texte from plateforme.demande_support d join plateforme.message_support m on m.demande = d.id where d.id = $1`, [r.corps.id])).rows[0];
    expect(d.sujet).toBe('Revenir au 21/10/2026 à 09:15');
    expect(d.page).toBe('sauvegardes');
    expect(d.texte).toContain('Je demande de revenir au 21/10/2026 à 09:15 (heure de Tunis).');
    expect(d.texte).toContain('Pourquoi : Une importation de tableur a écrasé mes prix ce matin');
    // 15:08 n'est pas encore passé (il est 15:07 à Tunis) ; le 15/09 dépasse les 35 jours gardés.
    const avenir = await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, nadia, { minute: '2026-10-21 15:08', motif: 'essai' });
    expect([avenir.statut, avenir.corps.champ]).toEqual([400, 'minute']);
    expect(String(avenir.corps.motif)).toContain('Le 21/10/2026 à 15:08 n\'est pas encore passé');
    const vieux = await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, nadia, { minute: '2026-09-15 10:00', motif: 'essai' });
    expect(vieux.statut).toBe(400);
    expect(String(vieux.corps.motif)).toContain('SkanFact garde chaque minute des 35 derniers jours');
    // Le 16/09 à 15:08 est dans les 35 jours.
    expect((await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, nadia, { minute: '2026-09-16 15:08', motif: 'essai' })).statut).toBe(201);
    const sami = await personne('sami');
    await membre(sami, ent, 'commercial');
    expect((await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, sami, { minute: '2026-10-21 09:15', motif: 'essai' })).statut).toBe(403);
  });
});
