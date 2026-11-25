// 1.388.75 — La lecture seule générale (pilotage depuis la console, point 5 ; base 0230). Ce que le serveur garantit :
//   - le titulaire de la console seul la pose (tout de suite ou à une heure), avec son motif, douze heures au plus ;
//   - pendant qu'elle court, tout se lit et chaque geste qui écrit reçoit 503, avec l'heure du retour ;
//   - le bandeau de l'application la dit (en cours), ou l'annonce (dans les vingt-quatre heures) ;
//   - la lever (ou annuler une prévue) rouvre l'enregistrement tout de suite ; elle finit d'elle-même à son heure.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, titulaire as designerTitulaire } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { ecritPendantLectureSeule, routesLectureSeule } from '../../serveur/lecture-seule.ts';
import { routesMessageClients } from '../../serveur/console/message-clients.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-seule-')), 'veille.json');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `lecture-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const poser = (corps: Corps, jeton = amira.console) => appeler('POST', '/console/lecture-seule', jeton, corps);
const nettoyer = () => admin.query("delete from plateforme.lecture_seule where motif like 'Essai lecture%'");

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesMessageClients(), ...routesLectureSeule(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
  // Amira pilote les modules : c'est le titulaire (0226) ; une autre personne de la direction ne le peut pas.
  if (!(await admin.query('select titulaire from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1', [amira.email])).rows[0]?.titulaire) {
    await designerTitulaire(admin, amira.email, 'mise en place des essais');
  }
});
afterAll(async () => {
  await nettoyer();
  await app.close(); await admin.end(); await pool.end();
});
const dans = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe('ce qui écrit (pur)', () => {
  it('un geste d\'entreprise écrit selon sa déclaration ; une lecture, jamais', () => {
    expect(ecritPendantLectureSeule('socle.dossier.tout', 'PUT')).toBe(true);
    expect(ecritPendantLectureSeule('socle.dossier.tout', 'GET')).toBe(false);
    expect(ecritPendantLectureSeule('socle.accueil.voir', 'POST')).toBe(false);
  });
  it('se déconnecter, configurer son code et faire un PDF restent permis ; créer une entreprise, non', () => {
    expect(ecritPendantLectureSeule('compte.deconnecter', 'POST')).toBe(false);
    expect(ecritPendantLectureSeule('compte.code.configurer', 'POST')).toBe(false);
    expect(ecritPendantLectureSeule('compte.pdf.imprimer', 'POST')).toBe(false);
    expect(ecritPendantLectureSeule('compte.entreprise.creer', 'POST')).toBe(true);
    expect(ecritPendantLectureSeule('public', 'POST')).toBe(false);
  });
});

describe('la lecture seule générale (base et serveur)', () => {
  it('poser, refuser, annoncer, lever — et la console reste ouverte', async () => {
    const { jeton } = await inscrire('client');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie des essais lecture seule' })).corps.id);
    const ecrire = (v: boolean) => appeler('PUT', `/entreprises/${ent}/volontaire-beta`, jeton, { volontaire: v });
    expect((await ecrire(true)).statut).toBe(200);

    // Le support lit, ne pose pas ; un motif trop court, une fin trop lointaine, une fin avant le début sont refusés.
    expect((await appeler('GET', '/console/lecture-seule', karim.console)).statut).toBe(200);
    expect((await poser({ motif: 'Essai lecture support', fin: dans(60) }, karim.console)).statut).toBe(403);
    expect((await poser({ motif: 'ok', fin: dans(60) })).statut).toBeGreaterThanOrEqual(400);
    const trop = await poser({ motif: 'Essai lecture trop longue', fin: dans(13 * 60) });
    expect(trop.statut).toBeGreaterThanOrEqual(400);
    expect(String(trop.corps.motif)).toMatch(/douze heures/i);
    expect((await poser({ motif: 'Essai lecture passée', debut: dans(-5), fin: dans(60) })).statut).toBeGreaterThanOrEqual(400);

    // Prévue dans deux heures : le bandeau l'annonce, rien n'est encore refusé.
    const prevue = await poser({ motif: 'Essai lecture prévue', debut: dans(120), fin: dans(180), message: 'Nous changeons de serveur.' });
    expect(prevue.statut).toBe(200);
    const annonce = (await appeler('GET', `/entreprises/${ent}/message`, jeton)).corps.message as Corps;
    expect(annonce).toMatchObject({ sorte: 'lecture_prevue' });
    expect(String(annonce.texte)).toMatch(/^De .+ à .+ : pendant ce temps, tu pourras tout consulter, mais rien ne s'enregistrera\. Nous changeons de serveur\.$/);
    expect((await ecrire(false)).statut).toBe(200);
    // Une autre au même créneau est refusée ; l'annuler retire aussi l'annonce.
    expect((await poser({ motif: 'Essai lecture chevauche', debut: dans(150), fin: dans(200) })).statut).toBeGreaterThanOrEqual(400);
    expect((await appeler('POST', '/console/lecture-seule/lever', amira.console, { id: Number(prevue.corps.id), motif: 'Essai lecture annulée' })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/message`, jeton)).corps.message).toBeNull();

    // Tout de suite, une heure : l'écriture est refusée avec l'heure du retour, la lecture passe.
    const posee = await poser({ motif: 'Essai lecture en cours', fin: dans(60) });
    expect(posee.statut).toBe(200);
    const refus = await ecrire(true);
    expect(refus.statut).toBe(503);
    expect(String(refus.corps.motif)).toMatch(/^SkanFact est en lecture seule jusqu'à .+ : tu peux tout consulter, mais rien ne s'enregistre/);
    expect(refus.corps.lectureSeule).toMatchObject({ message: null });
    expect((await appeler('GET', '/moi', jeton)).statut).toBe(200);
    const bandeau = (await appeler('GET', `/entreprises/${ent}/message`, jeton)).corps.message as Corps;
    expect(bandeau).toMatchObject({ sorte: 'lecture' });
    expect(String(bandeau.texte)).toMatch(/^Jusqu'à .+ : tu peux tout consulter, mais rien ne s'enregistre pour l'instant\.$/);
    // La console, elle, écrit encore (une autre est refusée, mais par la base, pas par la lecture seule).
    const deux = await poser({ motif: 'Essai lecture doublon', fin: dans(30) });
    expect(deux.statut).not.toBe(503);
    expect(String(deux.corps.motif)).toMatch(/une autre lecture seule couvre déjà ce moment/i);
    // La console la montre en cours, avec qui l'a posée.
    const lu = (await appeler('GET', '/console/lecture-seule', karim.console)).corps as { titulaire: boolean; lignes: { id: number; motif: string; par: string | null; leveeLe: string | null }[] };
    expect(lu.titulaire).toBe(false);
    expect(lu.lignes.find((l) => l.id === Number(posee.corps.id))).toMatchObject({ motif: 'Essai lecture en cours', par: amira.nom, leveeLe: null });

    // La lever : l'écriture passe de nouveau, le bandeau disparaît, le journal la garde.
    expect((await appeler('POST', '/console/lecture-seule/lever', karim.console, { id: Number(posee.corps.id), motif: 'Essai lecture support' })).statut).toBe(403);
    expect((await appeler('POST', '/console/lecture-seule/lever', amira.console, { id: Number(posee.corps.id), motif: 'Essai lecture levée' })).statut).toBe(200);
    expect((await ecrire(true)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/message`, jeton)).corps.message).toBeNull();
    const journal = (await admin.query("select geste from plateforme.geste_console where geste like 'service.lecture_seule%' and motif like 'Essai lecture%' order by le")).rows.map((r) => r.geste);
    expect(journal).toEqual(expect.arrayContaining(['service.lecture_seule', 'service.lecture_seule_annulee', 'service.lecture_seule_levee']));
    // Une lecture seule déjà levée ne se lève plus.
    expect((await appeler('POST', '/console/lecture-seule/lever', amira.console, { id: Number(posee.corps.id), motif: 'Essai lecture encore' })).statut).toBeGreaterThanOrEqual(400);
  });

  it('elle finit d\'elle-même à son heure (la base compare à l\'heure demandée)', async () => {
    const r = (await admin.query(`insert into plateforme.lecture_seule (motif, debut, fin, posee_le, posee_par)
      select 'Essai lecture finie', now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours', u.id from socle.utilisateur u where u.email = $1 returning id`, [amira.email])).rows[0];
    expect((await admin.query('select plateforme.lecture_seule_en_cours(now()) v')).rows[0].v?.id).not.toBe(Number(r.id));
    expect((await admin.query("select plateforme.lecture_seule_en_cours(now() - interval '90 minutes') v")).rows[0].v).toMatchObject({ id: Number(r.id) });
  });
});
