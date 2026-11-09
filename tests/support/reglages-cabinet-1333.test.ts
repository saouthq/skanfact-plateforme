// Les Réglages du Cabinet en ligne (1.333.0 ; serveur/sauvegardes.ts ; 0207 ; docs/sauvegardes-ecran.md), par l'API et le
// moteur. Joué par Leïla (associée) et Rim (Saisie) : l'onglet « Données et sécurité » ne gardait que « Se déconnecter »,
// et la grille de saisie acceptait la même touche pour deux gestes. Ce que ce fichier garantit :
//   - un cabinet lit ce que la veille du serveur a vu des copies : les MÊMES faits que l'entreprise, sans remise à lui ;
//     un membre actif (un collaborateur aussi), jamais quelqu'un hors du cabinet ;
//   - une touche ne fait qu'un geste : la règle du moteur (CabCore.toucheEnDouble) voit le double, sans majuscule.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesSauvegardes } from '../../serveur/sauvegardes.ts';

// Le 21/10/2026 à 15:07, heure de Tunis : la veille est passée trois minutes plus tôt.
const MAINTENANT = new Date('2026-10-21T14:07:00Z');
// L'horloge ne se fige qu'une fois l'équipe faite : une invitation se date au vrai jour, et se périmerait sous une horloge d'octobre.
let horloge: Date | undefined;
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge ?? new Date() };
let app: FastifyInstance;

type Corps = Record<string, unknown> & { id: string; motif: string };
type Reponse = { statut: number; corps: Corps };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string, verifiee = false) {
  const email = `support-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  const nom = `${prenom} Essai${n}`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  if (verifiee) await admin.query('update socle.utilisateur set adresse_verifiee_le = now() where id = $1', [id]);
  return { email, jeton, id, nom };
}
type Personne = Awaited<ReturnType<typeof personne>>;
async function entreprise(nom: string, proprio?: Personne) {
  const p = proprio ?? await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
  return { ent, p };
}
async function cabinet(nom: string, associe?: Personne) {
  const p = associe ?? await personne('Leila', true);
  const cab = String((await appeler('POST', '/cabinets', p.jeton, { nom })).corps.id);
  return { cab, p };
}
async function inviter(cab: string, associe: Personne, collegue: Personne, role = 'saisie') {
  const inv = await appeler('POST', `/cabinets/${cab}/invitations`, associe.jeton, { email: collegue.email, role });
  expect(inv.statut, JSON.stringify(inv.corps)).toBe(201);
  const acc = await appeler('POST', '/invitations/accepter', collegue.jeton, { jeton: String(inv.corps.jeton) });
  expect(acc.statut, String(acc.corps.motif)).toBe(200);
}

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesSauvegardes(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

// Le moteur de la grille, lu tel que l'écran le charge (un UMD, sans module).
function cabcore() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
  return bac.CabCore as { toucheEnDouble: (t: unknown) => { touche: string; deja: string; geste: string } | null; DEFAULT_SAISIE: { touches: Record<string, string> }; GESTES_DE_SAISIE: Record<string, string> };
}

describe('les sauvegardes, vues du cabinet (0207)', () => {
  it('le cabinet lit les MÊMES faits que l\'entreprise, sans remise à lui ; un collaborateur aussi ; un inconnu, non', async () => {
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit');
    // Trois nuits : le 19 réussie avec son essai, le 20 réussie, le 21 échouée — le cas qui ne doit jamais se lire « réussie ».
    await admin.query(`insert into plateforme.service_nuit (jour, sauvegarde, copie_de_base, restauration) values
      ('2026-10-19', '{"le":"2026-10-19T02:31:12Z","ok":true}', '{"le":"2026-10-19T02:46:00Z","ok":true}', '{"le":"2026-10-19T04:02:30Z","ok":true}'),
      ('2026-10-20', '{"le":"2026-10-20T02:30:58Z","ok":true}', '{"le":"2026-10-20T02:45:40Z","ok":true}', null),
      ('2026-10-21', '{"le":"2026-10-21T02:32:05Z","ok":false}', null, null)`);
    await admin.query(`insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, copies)
      values ('2026-10-21T14:04:00Z', true, 10, 40, 2, '[]', '{"archivage":{"enMarche":true},"horsMachine":{"regle":true,"attenteDepuis":"2026-10-21T14:01:00Z"}}')`);
    const { cab, p: leila } = await cabinet('Cabinet Ben Salah');
    const { ent, p: nadia } = await entreprise('Boulangerie du Lac');
    // Rim, en Saisie : savoir que ses écritures sont copiées n'est pas un droit d'associé.
    const rim = await personne('Rim');
    await inviter(cab, leila, rim, 'saisie');
    horloge = MAINTENANT;
    const vuDuCabinet = await appeler('GET', `/cabinets/${cab}/sauvegardes`, leila.jeton);
    expect(vuDuCabinet.statut, JSON.stringify(vuDuCabinet.corps)).toBe(200);
    const vuDeLEntreprise = await appeler('GET', `/entreprises/${ent}/sauvegardes`, nadia.jeton);
    expect(vuDeLEntreprise.statut).toBe(200);
    // Deux chemins, un état : ce sont les copies du serveur qui garde les livres de tous.
    expect(vuDuCabinet.corps).toEqual(vuDeLEntreprise.corps);
    expect(vuDuCabinet.corps).toMatchObject({
      nuit: { jour: '2026-10-21', sauvegarde: { ok: false } }, reussie: { jour: '2026-10-20' }, exercice: { jour: '2026-10-19', ok: true },
      horsMachine: { regle: true, attenteDepuis: '2026-10-21T14:01:00Z' }, veille: { recente: true }, remises: [],
    });
    // Une demande de revenir en arrière, posée par l'entreprise, ne se lit pas chez le cabinet : il n'a pas de remise à lui.
    expect((await appeler('POST', `/entreprises/${ent}/sauvegardes/revenir`, nadia.jeton, { minute: '2026-10-21 09:15', motif: 'essai' })).statut).toBe(201);
    expect((await appeler('GET', `/cabinets/${cab}/sauvegardes`, leila.jeton)).corps.remises).toEqual([]);
    // Rim lit aussi.
    expect((await appeler('GET', `/cabinets/${cab}/sauvegardes`, rim.jeton)).statut).toBe(200);
    // Nadia n'est pas du cabinet : refusée, et la base le redit sans la porte du serveur.
    const refus = await appeler('GET', `/cabinets/${cab}/sauvegardes`, nadia.jeton);
    expect([403, 404]).toContain(refus.statut);
    await expect(enTantQue(pool, nadia.id, (tx) => tx.query('select plateforme.mes_sauvegardes_cabinet($1, now())', [cab]))).rejects.toThrow(/personne du cabinet/);
    // Une entreprise n'est pas un cabinet : son identifiant ne se lit pas par la route du cabinet.
    expect([403, 404]).toContain((await appeler('GET', `/cabinets/${ent}/sauvegardes`, nadia.jeton)).statut);
    // Un groupe de sociétés est aussi une organisation, dont Nadia est membre : il ne se lit pas comme un cabinet.
    const groupe = String((await admin.query(`insert into socle.organisation (type, nom) values ('groupe', 'Groupe du Lac') returning id`)).rows[0].id);
    await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, array['proprietaire'])`, [nadia.id, groupe]);
    await expect(enTantQue(pool, nadia.id, (tx) => tx.query('select plateforme.mes_sauvegardes_cabinet($1, now())', [groupe]))).rejects.toThrow(/personne du cabinet/);
    // Un identifiant qui n'en est pas un : introuvable, jamais une panne.
    expect((await appeler('GET', '/cabinets/pas-un-cabinet/sauvegardes', leila.jeton)).statut).toBe(404);
  });

  it('sans relevé ni nuit, le cabinet lit « rien encore », jamais une réussite', async () => {
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit');
    const { cab, p: leila } = await cabinet('Cabinet Gharbi');
    const r = await appeler('GET', `/cabinets/${cab}/sauvegardes`, leila.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ nuit: null, reussie: null, exercice: null, veille: null, horsMachine: null, remises: [] });
  });
});

describe('la grille de saisie : une touche ne fait qu\'un geste (CabCore.toucheEnDouble)', () => {
  it('les touches proposées ne se doublent pas ; un double se nomme, majuscules ou non ; les gestes ont tous un nom', () => {
    const K = cabcore();
    expect(K.toucheEnDouble(K.DEFAULT_SAISIE.touches)).toBeNull();
    expect(K.toucheEnDouble(undefined)).toBeNull();
    // Chaque geste de la grille a son nom en français : c'est lui que le refus cite.
    for (const g of Object.keys(K.DEFAULT_SAISIE.touches)) expect(K.GESTES_DE_SAISIE[g], g).toMatch(/\S/);
    // F2 posé sur « Solder », alors que « Recopier » l'a déjà : le double se dit, avec les deux gestes.
    const double = K.toucheEnDouble({ ...K.DEFAULT_SAISIE.touches, solder: 'F2' });
    expect(double).not.toBeNull();
    expect(double?.touche).toBe('F2');
    expect([double?.deja, double?.geste].sort()).toEqual(['recopier', 'solder']);
    // La casse ne distingue pas deux touches : « control+enter » est « Control+Enter ».
    const valider = K.DEFAULT_SAISIE.touches.valider ?? '';
    expect(K.toucheEnDouble({ ...K.DEFAULT_SAISIE.touches, dupliquer: valider.toLowerCase() })).not.toBeNull();
    // Un geste laissé vide reprend la touche proposée : il ne se double pas avec elle.
    expect(K.toucheEnDouble({ ...K.DEFAULT_SAISIE.touches, solder: '' })).toBeNull();
  });
});
