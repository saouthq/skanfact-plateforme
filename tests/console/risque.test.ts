// Le risque de départ d'un client (1.40.0 ; base 0132 ; serveur/console/risque.ts ; docs/console.md C56). Ce qui est
// garanti :
//   - seul un client qui paie montre des signes (un essai ne « part » pas) ; chaque signe a sa règle, ses seuils écrits ;
//   - la vue « à risque » et sa carte comptent la même liste (C3), et la fiche dit les mêmes signes que la liste ;
//   - l'usage se compte dans la base sur deux fois trente jours, au jour du fuseau, les seules pièces émises, jamais une
//     entreprise d'exemple ; la direction et le support le lisent, la technique jamais.
// Les jours sont comptés à la main.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { comptesDesVues, dansLaVue } from '../../serveur/console/clients.ts';
import { lireEntreprises, type Entreprise } from '../../serveur/console/decider.ts';
import { avecRisque, lireUsages, risqueDe, USAGE_AVANT_MIN, DEMANDES_OUVERTES_MIN } from '../../serveur/console/risque.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const JOUR = '2026-10-15';
let k = 0;
// Une entreprise telle que la base la rend : abonnée jusqu'en 2027, ouverte hier, sauf mention contraire.
function cliente(faits: Record<string, unknown> = {}, autre: Record<string, unknown> = {}): Entreprise {
  k++;
  const [e] = lireEntreprises([{
    id: `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`, raisonSociale: `Cliente ${k}`, matricule: null, active: true, creeLe: '2026-01-10T08:00:00Z',
    organisation: { id: 'o', type: 'independant', nom: 'x' }, tenuePar: null, proprietaire: null, membres: 1, derniereActivite: '2026-10-14T09:00:00Z', pieces: 40,
    faits: { connu: true, essaiJusquAu: '2026-02-09', payeJusquAu: '2027-02-09', offre: 'essentiel', periodicite: 'annuel', resilieLe: null, suspenduLe: null, offert: false,
      bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  }], JOUR, REGLES_DE_DEPART);
  if (!e) throw new Error('une entreprise attendue');
  return e;
}
const rien = new Set<string>(), aucune = new Map<string, number>();

describe('le risque de départ, pur', () => {
  it('seul un client qui paie montre des signes : un essai silencieux, sans usage, n\'en a aucun', () => {
    const essai = cliente({ essaiJusquAu: '2026-10-30', payeJusquAu: null, offre: null, periodicite: null }, { derniereActivite: null, creeLe: '2026-09-01T08:00:00Z' });
    expect(essai.etat.etat).toBe('essai');
    expect(risqueDe(essai, JOUR, { trente: 0, avant: 9 }, new Set([essai.id]), new Map([[essai.id, 5]])).signes).toEqual([]);
    // Après l'essai, sans offre payée : « à appeler », pas un départ.
    const grace = cliente({ essaiJusquAu: '2026-10-10', payeJusquAu: null, offre: null, periodicite: null });
    expect(grace.etat).toMatchObject({ etat: 'en_retard', apresEssai: true });
    expect(risqueDe(grace, JOUR, null, rien, aucune).signes).toEqual([]);
  });

  it('chaque signe a sa règle : la résiliation, le retard d\'un abonné, la contestation ouverte, les demandes ouvertes', () => {
    const resilie = cliente({ resilieLe: '2026-10-01' });
    expect(risqueDe(resilie, JOUR, null, rien, aucune).signes).toEqual(['resiliation']);
    const retard = cliente({ payeJusquAu: '2026-10-10' });
    expect(retard.etat).toMatchObject({ etat: 'en_retard', apresEssai: false });
    expect(risqueDe(retard, JOUR, null, rien, aucune).signes).toEqual(['retard']);
    const c = cliente();
    expect(risqueDe(c, JOUR, null, new Set([c.id]), aucune).signes).toEqual(['contestation']);
    expect(DEMANDES_OUVERTES_MIN).toBe(2);
    expect(risqueDe(c, JOUR, null, rien, new Map([[c.id, 1]])).signes).toEqual([]);
    expect(risqueDe(c, JOUR, null, rien, new Map([[c.id, 2]])).signes).toEqual(['demandes']);
    expect(risqueDe(c, JOUR, null, rien, aucune).signes).toEqual([]);
  });

  it('l\'usage en baisse : au moins deux fois moins, sur au moins quatre pièces d\'avant ; le silence de dix jours', () => {
    const c = cliente();
    expect(USAGE_AVANT_MIN).toBe(4);
    const baisse = (trente: number, avant: number) => risqueDe(c, JOUR, { trente, avant }, rien, aucune).signes.includes('usage_en_baisse');
    expect([baisse(2, 4), baisse(0, 4), baisse(3, 5), baisse(1, 3), baisse(5, 9), baisse(6, 11)]).toEqual([true, true, false, false, false, false]);
    expect(baisse(5, 10)).toBe(true);
    // Ouverte le 5 (dix jours) : silencieuse ; le 6 (neuf) : non.
    expect(risqueDe(cliente({}, { derniereActivite: '2026-10-05T10:00:00Z' }), JOUR, null, rien, aucune).signes).toEqual(['silencieux']);
    expect(risqueDe(cliente({}, { derniereActivite: '2026-10-06T10:00:00Z' }), JOUR, null, rien, aucune).signes).toEqual([]);
  });

  it('les signes viennent dans un ordre fixe ; la vue « à risque » et sa carte comptent la même liste (C3) ; un usage illisible vaut « rien »', () => {
    const a = cliente({ resilieLe: '2026-10-01' }, { derniereActivite: '2026-09-01T10:00:00Z' }), b = cliente(), d = cliente({ payeJusquAu: '2026-10-10' });
    const usages = lireUsages({ [a.id]: { trente: 1, avant: 8 }, [b.id]: { trente: 'x', avant: 3 }, [d.id]: { trente: 2, avant: -1 } });
    expect([...usages.keys()]).toEqual([a.id]);
    const liste = avecRisque([a, b, d], JOUR, usages, rien, aucune);
    expect(liste[0]?.risque?.signes).toEqual(['resiliation', 'usage_en_baisse', 'silencieux']);
    expect(liste.map((e) => dansLaVue(e, 'a_risque', JOUR))).toEqual([true, false, true]);
    expect(comptesDesVues(liste, JOUR).a_risque).toBe(2);
    // Sans risque posé (ailleurs que la liste), personne n'est « à risque » : jamais un signe deviné.
    expect(dansLaVue(a, 'a_risque', JOUR)).toBe(false);
  });
});

// ── Par la base et par l'API ────────────────────────────────────────────────────────────────────────────────────────
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `risque-${prenom}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  const s = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
     where u.email = $1 and s.fermee_le is null`, [p.email])).rows[0] as { id: string; utilisateur: string };
  return { jeton: String(c.corps.jeton), session: s.id, utilisateur: s.utilisateur };
}
const laBase = (m: { session: string; utilisateur: string }, jour: string) => enTantQue(pool, m.utilisateur, async (tx) => {
  await tx.query(`select set_config('app.session_console', $1, true)`, [m.session]);
  return (await tx.query('select plateforme.console_usage_trente($1::date) v', [jour])).rows[0].v as Record<string, { trente: number; avant: number }>;
});
// Des pièces posées sans le parcours (déclencheurs suspendus), comme le test de la mesure : émises il y a tant de jours,
// à 0 h 30 au jour de Tunis ; un brouillon n'a pas de jour d'émission ; une pièce abandonnée peut garder le sien.
async function pieces(entreprise: string, proprio: string, jour: string, liste: readonly (readonly ['emise' | 'brouillon' | 'abandonnee', number])[]) {
  await admin.query('begin');
  await admin.query('set local session_replication_role = replica');
  for (const [statut, ilYA] of liste) {
    // Une pièce abandonnée garde son jour d'émission, sans numéro (la base l'admet : seule une émise a tout).
    const emise = statut === 'emise', date = statut !== 'brouillon';
    await admin.query(`insert into ventes.piece (entreprise, type, statut, tiers, date_piece, emise_le, numero, numero_texte, copie, empreinte, net_a_payer, cree_par)
      values ($1, 'facture', $2, gen_random_uuid(), $3::date - $4::int, case when $7 then (($3::date - $4::int) + time '00:30') at time zone 'Africa/Tunis' end,
              case when $5 then $4 end, case when $5 then 'F-' || $4 end, case when $5 then '{}'::jsonb end, case when $5 then repeat('a', 64) end,
              case when $5 then 1000 end, $6)`, [entreprise, statut, jour, ilYA, emise, proprio, date]);
  }
  await admin.query('commit');
}
async function entreprise(nom: string, payee: boolean) {
  const p = await personne('proprio');
  const id = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
  const proprio = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
  if (payee) await admin.query(`update plateforme.abonnement set essai_jusqu_au = current_date - 300, paye_jusqu_au = current_date + 200, offre = 'essentiel', periodicite = 'annuel'
    where entreprise = $1`, [id]);
  return { id, proprio };
}

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le risque de départ, par la base et par l\'API (0132)', () => {
  it('l\'usage sur deux fois trente jours : au jour de Tunis, les seules pièces émises ; la direction et le support, jamais la technique', async () => {
    const direction = await membre('direction', 'direction');
    const support = await membre('support', 'support');
    const technique = await membre('technique', 'technique');
    const jour = (await admin.query(`select (now() at time zone 'Africa/Tunis')::date::text j`)).rows[0].j as string;
    const e = await entreprise('Usage Compté', true);
    // 0 et 29 jours : les trente derniers ; 30 et 59 : ceux d'avant ; 60 : dehors ; un brouillon d'hier et une pièce émise
    // puis abandonnée avant-hier : rien.
    await pieces(e.id, e.proprio, jour, [['emise', 0], ['emise', 29], ['emise', 30], ['emise', 59], ['emise', 60], ['brouillon', 1], ['abandonnee', 2]]);
    expect((await laBase(direction, jour))[e.id]).toEqual({ trente: 2, avant: 2 });
    expect((await laBase(support, jour))[e.id]).toEqual({ trente: 2, avant: 2 });
    await expect(laBase(technique, jour)).rejects.toThrow();
    // Une entreprise d'exemple ne se compte pas (posée telle, le garde-fou de la base suspendu).
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update socle.entreprise set essai = true where id = $1', [e.id]);
    await admin.query('commit');
    expect((await laBase(direction, jour))[e.id]).toBeUndefined();
  });

  it('un abonné dont l\'usage s\'effondre est « à risque » : la liste, sa carte et sa fiche disent les mêmes signes ; un essai au même usage n\'y est pas', async () => {
    const direction = await membre('direction', 'direction');
    const support = await membre('support', 'support');
    const jour = (await admin.query(`select (now() at time zone 'Africa/Tunis')::date::text j`)).rows[0].j as string;
    const nom = `Risque ${Math.random().toString(36).slice(2, 8)}`;
    const abonne = await entreprise(`${nom} Abonné`, true);
    const essai = await entreprise(`${nom} Essai`, false);
    for (const x of [abonne, essai]) await pieces(x.id, x.proprio, jour, [['emise', 31], ['emise', 35], ['emise', 40], ['emise', 52], ['emise', 3]]);
    type LigneLue = { societes: { id: string; risque?: { signes: string[]; usage: unknown } }[] };
    const r = await appeler('GET', `/console/entreprises?vue=a_risque&q=${encodeURIComponent(nom)}`, support.jeton);
    expect(r.statut).toBe(200);
    const ids = (r.corps.lignes as LigneLue[]).flatMap((l) => l.societes.map((s) => s.id));
    expect(ids).toEqual([abonne.id]);
    const s = (r.corps.lignes as LigneLue[])[0]?.societes[0];
    expect(s?.risque).toEqual({ signes: ['usage_en_baisse'], usage: { trente: 1, avant: 4 } });
    // C3 : la carte compte la liste qu'elle ouvre.
    expect((r.corps.vues as Record<string, number>).a_risque).toBe(r.corps.tous);
    const tout = await appeler('GET', '/console/entreprises?vue=a_risque', direction.jeton);
    expect((tout.corps.vues as Record<string, number>).a_risque).toBe(tout.corps.tous);
    // La fiche : les mêmes signes, et s'il paie.
    const f = (await appeler('GET', `/console/entreprises/${abonne.id}`, direction.jeton)).corps.risque;
    expect(f).toEqual({ signes: ['usage_en_baisse'], usage: { trente: 1, avant: 4 }, payant: true });
    const g = (await appeler('GET', `/console/entreprises/${essai.id}`, support.jeton)).corps.risque;
    expect(g).toEqual({ signes: [], usage: { trente: 1, avant: 4 }, payant: false });
  });
});
