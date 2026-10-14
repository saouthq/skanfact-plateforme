// L'essai, la grâce et les relances se règlent dans la console (docs/abonnement.md C15 ; 0104), par l'API. Ce que le
// serveur garantit :
//   - la direction pose une règle nouvelle, avec son motif, au journal ; le support ne le peut pas ; la base refuse ce qui
//     sort des bornes et ce qui ne changerait rien ;
//   - l'ESSAI d'une entreprise se fixe à sa création : une règle changée ne touche pas un essai commencé ;
//   - la GRÂCE d'une échéance est celle de son lendemain : une grâce commencée garde sa durée, une échéance d'après a la
//     nouvelle ; l'état, « Ton abonnement » et l'e-mail de relance disent la même ;
//   - les RELANCES qui partent un jour sont celles de la règle de ce jour-là.
// Les règles posées ici ne s'effacent pas (la base le refuse) : avant et après, les règles de départ sont reposées,
// datées d'aujourd'hui, quel que soit ce qu'un autre fichier de test a posé avant.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { relancerLesAbonnements } from '../../serveur/abonnement/relances.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { reposerLesReglesDeDepart } from '../regles-de-depart.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regles-')), 'veille.json');
const jour = aujourdhuiATunis();
type Parti = { a: string; objet: string; texte: string };
const partis: Parti[] = [];
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const ctxRelances: Contexte = { ...ctx, courriel: { envoi: { envoyer: async (c) => { partis.push(c as Parti); } }, adresse: () => 'https://app.exemple.tn' } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `regles-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
// Un membre de l'équipe SkanFact et sa session de la console.
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton } = await inscrire(prenom);
  const qui = await quiEst(ctx, jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
// Une entreprise de client, et son propriétaire (qui gère l'abonnement et reçoit les relances).
async function entreprise(nom: string) {
  const proprio = await inscrire('proprio');
  const cree = await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  return { ent: String(cree.corps.id), proprio };
}
const finEssai = (ent: string, j: string) => admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, j]);
const essaiDe = async (ent: string) => String((await admin.query('select essai_jusqu_au::text j from plateforme.abonnement where entreprise = $1', [ent])).rows[0]?.j);

let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const regler = (corps: Corps, jeton = amira.console) => appeler('POST', '/console/reglages/regle', jeton, corps);
const dernierGeste = async () => (await admin.query(`select avant, apres, motif from plateforme.geste_console where geste = 'reglages.regle_abonnement'
  order by le desc, id desc limit 1`)).rows[0] as { avant: Corps; apres: Corps; motif: string } | undefined;

beforeAll(async () => {
  await admin.connect();
  await reposerLesReglesDeDepart(admin, jour);
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
});
afterAll(async () => {
  await reposerLesReglesDeDepart(admin, jour);
  await app.close(); await admin.end(); await pool.end();
});

describe('l\'essai, la grâce et les relances, réglés dans la console', () => {
  it('la direction pose une règle, avec son motif et sa ligne au journal ; le support ne le peut pas ; la base tient les bornes', async () => {
    // Le support lit les règles, ne les change pas.
    const lu = (await appeler('GET', '/console/reglages', karim.console)).corps as { regles: Record<string, { jours: number[]; par: string | null } | null> };
    expect(lu.regles.grace?.jours).toEqual([7]);
    expect(lu.regles.grace?.par).toBeNull();
    expect((await regler({ code: 'grace', jours: [3], motif: 'Une grâce plus courte' }, karim.console)).statut).toBe(403);
    // La base le refuse aussi, à qui l'appellerait sans passer par la porte du serveur.
    const session = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
      where u.email = $1 and s.fermee_le is null order by s.ouverte_le desc limit 1`, [karim.email])).rows[0] as { id: string; utilisateur: string };
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_regler_abonnement($1, $2::integer[], $3, now(), $4::date)', ['grace', [3], 'Une grâce plus courte', jour]))
        .rejects.toThrow(/ton rôle dans l'équipe SkanFact ne permet pas ce geste/);
    } finally { await k.query('rollback'); k.release(); }
    // Hors des bornes, ou rien de neuf : refusé, avec la raison.
    const refus = async (corps: Corps) => { const r = await regler(corps); expect(r.statut).toBe(403); return String(r.corps.motif); };
    expect(await refus({ code: 'essai', jours: [5], motif: 'Un essai trop court' })).toBe('L\'essai dure de 7 à 90 jours.');
    expect(await refus({ code: 'grace', jours: [31], motif: 'Une grâce trop longue' })).toBe('La grâce compte de 0 à 30 jours.');
    expect(await refus({ code: 'relances', jours: [7, 7], motif: 'Deux fois la même' })).toContain('chacune un jour différent');
    expect(await refus({ code: 'relances', jours: [61, 3], motif: 'Trop tôt' })).toContain('de 1 à 60 jours');
    expect(await refus({ code: 'relances', jours: [0], motif: 'Le jour même' })).toContain('de 1 à 60 jours');
    expect(await refus({ code: 'grace', jours: [7], motif: 'La même grâce' })).toBe('C\'est déjà la règle en vigueur : rien ne changerait.');
    expect((await regler({ code: 'grace', jours: [3], motif: 'x' })).statut).toBe(400);
    // Posée : elle vaut dès aujourd'hui, la console dit qui l'a posée ; le journal garde avant et après.
    expect((await regler({ code: 'grace', jours: [3], motif: 'Une grâce plus courte pour la rentrée' })).statut).toBe(200);
    const apres = (await appeler('GET', '/console/reglages', amira.console)).corps as { regles: Record<string, { jours: number[]; par: string | null; motif: string } | null>; echeance: { grace: number | null } };
    expect(apres.regles.grace).toMatchObject({ jours: [3], par: amira.nom, motif: 'Une grâce plus courte pour la rentrée' });
    expect(apres.echeance.grace).toBe(3);
    expect(await dernierGeste()).toEqual({ avant: { code: 'grace', jours: [7] }, apres: { code: 'grace', jours: [3] }, motif: 'Une grâce plus courte pour la rentrée' });
    // Les relances se rangent du plus loin au plus près, quel que soit l'ordre tapé.
    expect((await regler({ code: 'relances', jours: [3, 10], motif: 'Dix jours, puis trois' })).statut).toBe(200);
    expect((await dernierGeste())?.apres).toEqual({ code: 'relances', jours: [10, 3] });
    // Une règle posée ne se réécrit ni ne s'efface, même par la base.
    await expect(admin.query(`delete from plateforme.regle_abonnement where code = 'grace'`)).rejects.toThrow(/ne se modifie pas et ne s'efface pas/);
  });

  it('la grâce d\'une échéance est celle de son lendemain : une grâce commencée garde la sienne', async () => {
    // A : échue avant-hier, sa grâce a commencé hier (sept jours). B : échue hier, sa grâce commence aujourd'hui (trois).
    const A = await entreprise('Atelier Grâce Ancienne');
    const B = await entreprise('Bureau Grâce Nouvelle');
    await finEssai(A.ent, plusJours(jour, -2));
    await finEssai(B.ent, plusJours(jour, -1));
    const etat = async (e: typeof A) => (await appeler('GET', `/entreprises/${e.ent}/abonnement/etat`, e.proprio.jeton)).corps;
    expect(await etat(A)).toMatchObject({ etat: 'en_retard', lectureSeuleLe: plusJours(jour, 6) });
    expect(await etat(B)).toMatchObject({ etat: 'en_retard', lectureSeuleLe: plusJours(jour, 3) });
    // « Ton abonnement » dit la grâce de son échéance.
    const regles = async (e: typeof A) => ((await appeler('GET', `/entreprises/${e.ent}/abonnement`, e.proprio.jeton)).corps.regles as Corps);
    expect(await regles(A)).toMatchObject({ grace: 7 });
    expect(await regles(B)).toMatchObject({ grace: 3 });
    // La console dit le même état que l'application (la grâce lue par le même chemin).
    const fiche = async (e: typeof A) => (await appeler('GET', `/console/entreprises/${e.ent}`, amira.console)).corps.etat;
    expect(await fiche(A)).toMatchObject({ etat: 'en_retard', lectureSeuleLe: plusJours(jour, 6) });
    expect(await fiche(B)).toMatchObject({ etat: 'en_retard', lectureSeuleLe: plusJours(jour, 3) });
  });

  it('les relances partent aux jours de la règle du jour ; l\'e-mail dit la grâce de l\'échéance', async () => {
    const C = await entreprise('Cave Relancée');
    // Dix jours avant l'échéance : la relance des dix jours, avec la grâce de trois jours (l'échéance passe après la règle).
    await finEssai(C.ent, plusJours(jour, 10));
    await relancerLesAbonnements(ctxRelances);
    const pourC = () => partis.filter((p) => p.a === C.proprio.email);
    expect(pourC()).toHaveLength(1);
    expect(pourC()[0]?.objet).toBe('Ton essai de SkanFact se termine dans 10 jours');
    expect(pourC()[0]?.texte).toContain('Après cette date, tout marche encore 3 jours.');
    expect((await admin.query('select rang from plateforme.relance_abonnement where entreprise = $1', [C.ent])).rows.map((r) => r.rang)).toEqual(['j10']);
    // Quinze jours avant : rien (la règle du jour n'en a plus).
    const D = await entreprise('Droguerie Sans Relance');
    await finEssai(D.ent, plusJours(jour, 15));
    await relancerLesAbonnements(ctxRelances);
    expect(partis.filter((p) => p.a === D.proprio.email)).toHaveLength(0);
    // Sans grâce : l'e-mail dit la lecture seule dès le lendemain.
    expect((await regler({ code: 'grace', jours: [0], motif: 'Plus de grâce pour essayer' })).statut).toBe(200);
    const E = await entreprise('Épicerie Sans Grâce');
    await finEssai(E.ent, plusJours(jour, 3));
    await relancerLesAbonnements(ctxRelances);
    expect(partis.filter((p) => p.a === E.proprio.email).at(-1)?.texte).toContain('Dès le lendemain, l\'entreprise passe en lecture seule');
  });

  it('l\'essai d\'une entreprise se fixe à sa création : une règle changée ne touche pas un essai commencé', async () => {
    const avant = await entreprise('Fromagerie Avant');
    expect(await essaiDe(avant.ent)).toBe(plusJours(jour, 30));
    expect((await regler({ code: 'essai', jours: [14], motif: 'Un essai de deux semaines' })).statut).toBe(200);
    const apres = await entreprise('Glacier Après');
    expect(await essaiDe(apres.ent)).toBe(plusJours(jour, 14));
    expect(await essaiDe(avant.ent)).toBe(plusJours(jour, 30));
    // « Ton abonnement » dit la durée de SON essai.
    const regles = async (e: typeof avant) => ((await appeler('GET', `/entreprises/${e.ent}/abonnement`, e.proprio.jeton)).corps.regles as Corps);
    expect(await regles(avant)).toMatchObject({ essai: 30 });
    expect(await regles(apres)).toMatchObject({ essai: 14 });
  });
});
