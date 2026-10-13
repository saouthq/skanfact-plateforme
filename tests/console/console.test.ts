// La console de SkanFact, dans la base et au serveur (0083 ; serveur/console ; docs/console.md ; skanfact
// docs/cadrage/10-console.md, 03 § 5, 06 § 3) : une connexion à part, réservée à l'équipe, avec le code du téléphone à
// chaque fois ; chaque rôle ne lit que ce qu'il lui faut (la technique, aucun client) ; la base refuse toute fonction de
// la console hors d'une session de la console ; la fiche d'un client ne dit que la liste fermée ; chaque geste demande
// son motif, ne s'écrase pas sur un abonnement changé, et laisse son événement et sa ligne au journal, qu'on ne réécrit
// pas ; le support prolonge un essai de 7 à 30 jours, une fois ; l'équipe garde toujours quelqu'un à la direction.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, retirer as retirerDeLEquipe, voir as voirLEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, RouteSansGeste, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'console-')), 'veille.json');
let app: FastifyInstance;
const aujourdhui = aujourdhuiATunis();

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
// Une personne avec son compte SkanFact, et sa session de l'application.
async function personne(prenom: string) {
  const email = `console-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id), nom: `${prenom} ${n}` };
}
// Un membre de l'équipe : son compte, son code d'application, son rôle (posé par l'outil de l'exploitation).
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  return { ...p, secret: secret ?? '', role };
}
const code = (secret: string) => codeTotp(depuisBase32(secret), horloge.getTime());
// Entrer dans la console : le mot de passe, puis le code de l'application. Rend le jeton de la console.
async function entrer(m: { email: string; secret: string }, appareil?: string) {
  const r = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur', ...(appareil ? { id: appareil } : {}) } });
  expect(r.corps.etat, JSON.stringify(r.corps)).toBe('code');
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: code(m.secret) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { jeton: String(c.corps.jeton), appareil: String(c.corps.appareil) };
}
async function entreprise(nom: string) {
  const proprio = await personne('proprio');
  const cree = await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom, matriculeFiscal: `${String(5_200_000 + n).slice(-7)}C/A/M/000` });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  return { ent: String(cree.corps.id), proprio };
}
const finEssai = (ent: string, jour: string) => admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, jour]);
const fiche = async (jeton: string, ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, jeton)).corps;

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;
let jD = '', jS = '', jT = '';

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
  jD = (await entrer(direction)).jeton;
  jS = (await entrer(support)).jeton;
  jT = (await entrer(technique)).jeton;
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'entrée de la console', () => {
  it('seul un membre de l\'équipe entre ; un autre compte reçoit la même réponse qu\'un mot de passe faux', async () => {
    const p = await personne('visiteur');
    const horsEquipe = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const mauvais = await appeler('POST', '/console/connexion', undefined, { email: direction.email, motDePasse: 'pas-le-bon-mot-de-passe', appareil: { nom: 'Bureau', type: 'navigateur' } });
    expect(horsEquipe.statut).toBe(401);
    expect(horsEquipe.corps).toEqual(mauvais.corps);
    expect(horsEquipe.corps.motif).toBe('L\'adresse ou le mot de passe ne correspond pas.');
    // Le champ à revoir est nommé : le mot de passe, pour les deux (la réponse reste la même).
    expect(horsEquipe.corps.champ).toBe('motDePasse');
  });

  it('le code du téléphone à chaque connexion, même sur un appareil reconnu ; sans code en place, la console le dit', async () => {
    // Un membre sans code du téléphone : le bon mot de passe ne suffit pas, et la console dit où le mettre en place.
    const p = await personne('sanscode');
    await ajouterALEquipe(admin, p.email, 'support', 'essai sans code');
    const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    expect(r.statut).toBe(401);
    expect(String(r.corps.motif)).toMatch(/code du téléphone.*Ton compte/);
    // Le mot de passe était bon : aucun champ n'est montré comme faux.
    expect(r.corps.champ).toBeUndefined();
    // Un appareil déjà reconnu redemande le code : la console ne se contente jamais du mot de passe.
    const premiere = await entrer(direction);
    const encore = await appeler('POST', '/console/connexion', undefined, { email: direction.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur', id: premiere.appareil } });
    expect(encore.corps).toMatchObject({ etat: 'code', methode: 'application', appareil: premiere.appareil });
    const faux = code(direction.secret) === '000000' ? '111111' : '000000';
    expect((await appeler('POST', '/console/connexion/code', undefined, { defi: encore.corps.defi, code: faux })).corps.etat).toBe('refuse');
    expect((await appeler('GET', '/console/moi', premiere.jeton)).corps).toMatchObject({ role: 'direction', email: direction.email, aujourdhui });
  });

  it('un jeton de la console n\'ouvre pas l\'application, un jeton de l\'application n\'ouvre pas la console', async () => {
    expect((await appeler('GET', '/moi', jD)).statut).toBe(401);
    const r = await appeler('GET', '/console/moi', direction.jeton);
    expect(r.statut).toBe(401);
    expect(r.corps.motif).toBe('Connecte-toi à la console.');
  });

  it('une session de la console tombe après une heure sans geste, et à la déconnexion', async () => {
    const s = await entrer(support);
    horloge = new Date(horloge.getTime() + 61 * 60_000);
    try {
      expect((await appeler('GET', '/console/moi', s.jeton)).statut).toBe(401);
    } finally { horloge = new Date(); }
    const t = await entrer(support);
    expect((await appeler('POST', '/console/deconnexion', t.jeton)).statut).toBe(200);
    expect((await appeler('GET', '/console/moi', t.jeton)).statut).toBe(401);
  });

  it('une route de la console vit sous /console/, et rien d\'autre n\'y vit', () => {
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/ailleurs', geste: 'console.clients.voir', traiter: async () => ({ corps: {} }) }])).toThrow(RouteSansGeste);
    expect(() => creerApp(ctx, [{ methode: 'GET', chemin: '/console/compte', geste: 'compte.voir', traiter: async () => ({ corps: {} }) }])).toThrow(RouteSansGeste);
  });
});

describe('ce que chaque rôle lit', () => {
  it('la technique ne lit aucun client : ni la liste, ni une fiche, ni leurs chiffres', async () => {
    const { ent } = await entreprise('Atelier Technique');
    expect((await appeler('GET', '/console/entreprises', jT)).statut).toBe(403);
    expect((await appeler('GET', `/console/entreprises/${ent}`, jT)).statut).toBe(403);
    const accueil = await appeler('GET', '/console/accueil', jT);
    expect(accueil.statut).toBe(200);
    expect(accueil.corps.tableau).toEqual({ service: { etat: 'non_mesure', raison: 'pas_de_veille' } });
    expect((await appeler('GET', '/console/service', jT)).statut).toBe(200);
    expect((await appeler('GET', '/console/equipe', jS)).statut).toBe(403);
    expect((await appeler('GET', '/console/journal', jS)).statut).toBe(403);
  });

  it('la base refuse chaque fonction de la console hors d\'une session de la console, même au nom d\'un membre', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_entreprises()'))).rejects.toThrow(/session de la console/);
    // Avec la session de l'application de ce membre, pas davantage.
    const qui = await quiEst(ctx, direction.jeton);
    await expect(enTantQue(pool, direction.id, async (tx) => {
      await tx.query('select set_config(\'app.session_console\', $1, true)', [qui?.session]);
      return tx.query('select plateforme.console_entreprises()');
    })).rejects.toThrow(/session de la console/);
  });
});

describe('les clients', () => {
  it('la liste range par urgence, compte chaque état comme son filtre, et ne montre pas les entreprises d\'exemple', async () => {
    // L'entreprise d'exemple d'une personne (« Voir un exemple »), créée comme l'application la crée.
    const curieux = await personne('curieux');
    const exemple = String((await appeler('POST', '/entreprises-essai', curieux.jeton)).corps.id);
    const retard = await entreprise('Négoce En Retard');
    await finEssai(retard.ent, plusJours(aujourdhui, -2));
    // Une entreprise plus récente, à l'essai : la base rend la plus récente d'abord, et sans le rangement par urgence,
    // c'est elle qui serait en tête.
    await entreprise('Atelier Plus Récent');
    const r = await appeler('GET', '/console/entreprises?limite=200', jD);
    expect(r.statut).toBe(200);
    const lignes = r.corps.lignes as { id: string; etat: { etat: string } }[];
    expect(lignes.some((l) => l.id === exemple)).toBe(false);
    expect(lignes.some((l) => l.id === retard.ent)).toBe(true);
    // Une entreprise d'exemple n'a pas de fiche dans la console.
    expect((await appeler('GET', `/console/entreprises/${exemple}`, jD)).statut).toBe(404);
    expect(lignes[0]?.etat.etat).toBe('en_retard');
    const comptes = r.corps.comptes as Record<string, number>;
    const filtre = await appeler('GET', '/console/entreprises?etat=en_retard&limite=200', jD);
    expect(filtre.corps.total).toBe(comptes.en_retard);
    expect((filtre.corps.lignes as { id: string }[]).map((l) => l.id)).toContain(retard.ent);
  });

  it('la tuile des inscriptions ouvre sa liste, du même compte : les sept derniers jours, aujourd\'hui compris', async () => {
    // Inscrite il y a six jours : dans la semaine ; il y a sept : hors de la semaine. Les autres entreprises des tests sont
    // d'aujourd'hui : sans ces deux-là, une règle décalée d'un jour passerait inaperçue.
    const dedans = await entreprise('Inscrite Il Y A Six Jours');
    const dehors = await entreprise('Inscrite Il Y A Sept Jours');
    await admin.query('update socle.entreprise set cree_le = cree_le - make_interval(days => $2) where id = $1', [dedans.ent, 6]);
    await admin.query('update socle.entreprise set cree_le = cree_le - make_interval(days => $2) where id = $1', [dehors.ent, 7]);
    const tableau = (await appeler('GET', '/console/accueil', jD)).corps.tableau as { entreprisesDeLaSemaine: number };
    const r = await appeler('GET', '/console/entreprises?nouvelles=1&limite=200', jD);
    expect(r.statut).toBe(200);
    expect(r.corps.total).toBe(tableau.entreprisesDeLaSemaine);
    const ids = (r.corps.lignes as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(dedans.ent);
    expect(ids).not.toContain(dehors.ent);
    // Les comptes des états portent sur les seules nouvelles : celle d'il y a sept jours n'y compte pas, et leurs puces
    // refont le total de la liste.
    const toutes = await appeler('GET', '/console/entreprises?limite=1', jD);
    expect(r.corps.tous).toBe(tableau.entreprisesDeLaSemaine);
    expect(Number(toutes.corps.tous)).toBeGreaterThan(Number(r.corps.tous));
    const comptes = r.corps.comptes as Record<string, number>;
    expect(Object.values(comptes).reduce((a, b) => a + b, 0)).toBe(r.corps.tous);
  });

  it('la fiche dit la liste fermée : qui, l\'abonnement et son histoire, les membres, des comptes ; jamais le contenu d\'un dossier', async () => {
    const { ent, proprio } = await entreprise('Quincaillerie Fiche');
    const f = await fiche(jS, ent);
    expect(Object.keys(f).sort()).toEqual(['active', 'aujourdhui', 'comptes', 'creeLe', 'devise', 'etat', 'evenements', 'faits', 'formeJuridique', 'gestes',
      'id', 'ligne', 'matricule', 'membres', 'organisation', 'prolongeDejaUneFois', 'raisonSociale', 'tenuePar'].sort());
    expect(Object.keys(f.comptes as object).sort()).toEqual(['caisses', 'etablissements', 'piecesCreees', 'piecesEmises', 'salaries']);
    expect(f.membres).toEqual([expect.objectContaining({ nom: proprio.nom, email: proprio.email, roles: ['proprietaire'] })]);
    expect(Object.keys((f.membres as object[])[0] ?? {}).sort()).toEqual(['depuis', 'derniereConnexion', 'email', 'nom', 'roles']);
    expect(f.etat).toMatchObject({ etat: 'essai' });
  });
});

describe('les gestes sur un abonnement', () => {
  it('l\'aperçu dit l\'état d\'après, sans rien écrire', async () => {
    const { ent } = await entreprise('Atelier Aperçu');
    const avant = await fiche(jD, ent);
    const a = await appeler('POST', `/console/entreprises/${ent}/abonnement/payer`, jD, { motif: '', ligne: avant.ligne, apercu: true, offre: 'complet', periodicite: 'annuel' });
    expect(a.statut).toBe(200);
    expect(a.corps).toMatchObject({ apercu: true, avant: { etat: 'essai' }, apres: { etat: 'actif', offre: 'complet', periodicite: 'annuel' } });
    expect((await fiche(jD, ent)).ligne).toEqual(avant.ligne);
  });

  it('le support prolonge un essai de 7 à 30 jours, une fois ; le reste est à la direction', async () => {
    const { ent } = await entreprise('Épicerie Support');
    let f = await fiche(jS, ent);
    expect(f.gestes).toEqual(['prolonger']);
    const prolonger = (jeton: string, jours: number, ligne: unknown) => appeler('POST', `/console/entreprises/${ent}/abonnement/prolonger`, jeton, { motif: 'salon de Sfax', ligne, jours });
    expect((await prolonger(jS, 31, f.ligne)).corps.motif).toMatch(/de 7 à 30 jours/);
    expect((await prolonger(jS, 6, f.ligne)).corps.motif).toMatch(/de 7 à 30 jours/);
    const ok = await prolonger(jS, 10, f.ligne);
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    expect(ok.corps.etat).toMatchObject({ etat: 'essai', jusquAu: plusJours(String((f.faits as { essaiJusquAu: string }).essaiJusquAu), 10) });
    f = await fiche(jS, ent);
    expect(f.gestes).toEqual([]);
    expect((await prolonger(jS, 10, f.ligne)).corps.motif).toMatch(/déjà été prolongé une fois/);
    expect((await appeler('POST', `/console/entreprises/${ent}/abonnement/suspendre`, jS, { motif: 'essai', ligne: f.ligne })).statut).toBe(403);
    // La direction, elle, prolonge encore.
    expect((await prolonger(jD, 45, (await fiche(jD, ent)).ligne)).statut).toBe(200);
  });

  it('un geste sans motif est refusé ; un geste fait laisse son événement et sa ligne au journal, avec son auteur', async () => {
    const { ent } = await entreprise('Garage Journal');
    const f = await fiche(jD, ent);
    const sans = await appeler('POST', `/console/entreprises/${ent}/abonnement/suspendre`, jD, { motif: ' ', ligne: f.ligne });
    expect(sans.statut).toBe(400);
    expect(sans.corps.champ).toBe('motif');
    expect((await appeler('POST', `/console/entreprises/${ent}/abonnement/suspendre`, jD, { motif: 'impayé depuis deux mois', ligne: f.ligne })).statut).toBe(200);
    const apres = await fiche(jD, ent);
    expect(apres.etat).toMatchObject({ etat: 'lecture_seule', raison: 'suspendu' });
    expect((apres.evenements as Record<string, unknown>[])[0]).toMatchObject({ nature: 'suspendu', par: 'exploitation', motif: 'impayé depuis deux mois', qui: { nom: direction.nom, role: 'direction' } });
    const journal = await appeler('GET', `/console/journal?entreprise=${ent}`, jD);
    expect(journal.corps.lignes).toEqual([expect.objectContaining({ geste: 'abonnement.suspendre', motif: 'impayé depuis deux mois', role: 'direction',
      qui: { id: direction.id, nom: direction.nom }, entreprise: { id: ent, raisonSociale: 'Garage Journal' } })]);
  });

  it('un abonnement changé depuis la lecture ne s\'écrase pas', async () => {
    const { ent } = await entreprise('Imprimerie Concurrente');
    const f = await fiche(jD, ent);
    expect((await appeler('POST', `/console/entreprises/${ent}/abonnement/offrir`, jD, { motif: 'partenaire fondateur', ligne: f.ligne })).statut).toBe(200);
    const r = await appeler('POST', `/console/entreprises/${ent}/abonnement/suspendre`, jD, { motif: 'erreur de manipulation', ligne: f.ligne });
    expect(r.statut).toBe(409);
    expect(r.corps.motif).toMatch(/a changé depuis que tu l'as ouvert/);
  });

  it('un geste de la console ne se modifie pas et ne s\'efface pas', async () => {
    await expect(admin.query('update plateforme.geste_console set motif = \'réécrit\'')).rejects.toThrow(/ne se modifie pas/);
    await expect(admin.query('delete from plateforme.geste_console')).rejects.toThrow(/ne se modifie pas/);
  });
});

describe('l\'équipe', () => {
  it('la direction ajoute, change et retire ; jamais sur soi-même, et toujours quelqu\'un à la direction', async () => {
    const p = await personne('recrue');
    expect((await appeler('POST', '/console/equipe', jD, { email: 'personne-ici@exemple.tn', role: 'support', motif: 'nouvelle recrue' })).corps.motif).toMatch(/crée d'abord son compte/);
    expect((await appeler('POST', '/console/equipe', jD, { email: p.email, role: 'support', motif: 'nouvelle recrue' })).statut).toBe(201);
    expect((await appeler('POST', '/console/equipe', jD, { email: p.email, role: 'technique', motif: 'encore' })).corps.motif).toMatch(/déjà partie de l'équipe/);
    const equipe = (await appeler('GET', '/console/equipe', jD)).corps.membres as { utilisateur: string; role: string; code: string | null; moi: boolean }[];
    expect(equipe.find((m) => m.utilisateur === p.id)).toMatchObject({ role: 'support', code: null, moi: false });
    expect((await appeler('PUT', `/console/equipe/${p.id}`, jD, { role: 'technique', motif: 'rejoint la technique' })).statut).toBe(200);
    expect((await appeler('PUT', `/console/equipe/${direction.id}`, jD, { role: 'support', motif: 'moi-même' })).corps.motif).toMatch(/propre rôle/);
    expect((await appeler('POST', `/console/equipe/${direction.id}/retirer`, jD, { motif: 'moi-même' })).corps.motif).toMatch(/soi-même/);
    expect((await appeler('POST', `/console/equipe/${p.id}/retirer`, jD, { motif: 'fin de mission' })).statut).toBe(200);
    // La dernière personne à la direction ne quitte pas la direction.
    const autre = await membre('direction2', 'direction');
    const jA = (await entrer(autre)).jeton;
    const directions = Number((await admin.query(`select count(*) n from plateforme.equipe where role = 'direction' and actif`)).rows[0].n);
    expect(directions).toBeGreaterThanOrEqual(2);
    await admin.query(`update plateforme.equipe set actif = false, retire_le = now() where role = 'direction' and actif and utilisateur not in ($1, $2)`, [direction.id, autre.id]);
    expect((await appeler('POST', `/console/equipe/${direction.id}/retirer`, jA, { motif: 'passage de témoin' })).statut).toBe(200);
    expect((await appeler('PUT', `/console/equipe/${autre.id}`, jA, { role: 'support', motif: 'moi' })).corps.motif).toMatch(/propre rôle/);
    await ajouterALEquipe(admin, direction.email, 'direction', 'retour de la direction');
    jD = (await entrer(direction)).jeton;
    expect((await appeler('POST', `/console/equipe/${autre.id}/retirer`, jD, { motif: 'fin de l\'essai' })).statut).toBe(200);
    expect((await appeler('POST', `/console/equipe/${direction.id}/retirer`, jA, { motif: 'encore' })).statut).toBe(401);
  });

  it('un membre retiré ne se connecte plus, et ses sessions tombent', async () => {
    const m = await membre('partant', 'support');
    const s = await entrer(m);
    expect((await appeler('POST', `/console/equipe/${m.id}/retirer`, jD, { motif: 'départ' })).statut).toBe(200);
    expect((await appeler('GET', '/console/moi', s.jeton)).statut).toBe(401);
    const r = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    expect(r.corps.motif).toBe('L\'adresse ou le mot de passe ne correspond pas.');
  });

  it('le premier membre se pose par l\'outil de l\'exploitation, avec son motif ; l\'équipe garde toujours quelqu\'un à la direction', async () => {
    const p = await personne('fondateur');
    await expect(ajouterALEquipe(admin, p.email, 'direction', '  ')).rejects.toThrow(/motif/);
    await expect(ajouterALEquipe(admin, p.email, 'patron', 'fondateur')).rejects.toThrow(/direction/);
    await ajouterALEquipe(admin, p.email, 'direction', 'fondateur');
    expect((await voirLEquipe(admin)).find((x) => x.email === p.email)).toMatchObject({ role: 'direction', actif: true, code: null });
    const ligne = (await admin.query('select qui, role, geste, motif from plateforme.geste_console where membre = $1', [p.id])).rows;
    expect(ligne).toEqual([{ qui: null, role: null, geste: 'equipe.ajouter', motif: 'fondateur' }]);
    await retirerDeLEquipe(admin, p.email, 'essai terminé');
    // Seule à la direction, une personne ne se retire pas par l'outil non plus.
    const seule = await admin.query(`select u.email from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where e.role = 'direction' and e.actif`);
    if (seule.rows.length === 1) await expect(retirerDeLEquipe(admin, String(seule.rows[0].email), 'dernier')).rejects.toThrow(/toujours une personne à la direction/);
  });
});

describe('le service', () => {
  it('la veille absente se dit « non mesuré » ; présente, ses problèmes ; silencieuse, elle le dit', async () => {
    expect((await appeler('GET', '/console/service', jT)).corps.veille).toEqual({ etat: 'absente' });
    fs.writeFileSync(veille, JSON.stringify({ problemes: { sauvegarde: { titre: 'La sauvegarde de la nuit manque', grave: true, faire: 'Relance-la.', depuis: new Date().toISOString(), vus: 3, ditLe: null } } }));
    const r = await appeler('GET', '/console/service', jT);
    expect(r.corps.veille).toMatchObject({ etat: 'ok', problemes: [{ cle: 'sauvegarde', grave: true, titre: 'La sauvegarde de la nuit manque' }] });
    const accueil = await appeler('GET', '/console/accueil', jT);
    expect(accueil.corps.decider).toEqual([expect.objectContaining({ sorte: 'service', cle: 'sauvegarde', ouvre: 'service' })]);
    const vieux = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(veille, vieux, vieux);
    expect((await appeler('GET', '/console/service', jT)).corps.veille).toMatchObject({ etat: 'silencieuse' });
    fs.rmSync(veille);
  });
});
