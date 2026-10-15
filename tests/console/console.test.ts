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
import { joursEntre, plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, RouteSansGeste, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { quiEstConsole } from '../../serveur/console/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { routesMessageClients } from '../../serveur/console/message-clients.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { Collecte, envoyerMesures } from '../../serveur/service/collecte.ts';
import { noterTour } from '../../serveur/service/tours.ts';
import { versionTeif } from '../../serveur/v10/teif.ts';

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
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille }), ...routesMessageClients(() => horloge)]);
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
    // Un membre sans code du téléphone, arrivé depuis plus de sept jours (avant, il le pose à sa première connexion :
    // 0118, tests/console/invitations.test.ts) : le bon mot de passe ne suffit pas, et la console dit où le mettre en place.
    const p = await personne('sanscode');
    await ajouterALEquipe(admin, p.email, 'support', 'essai sans code');
    await admin.query(`update plateforme.equipe set ajoute_le = now() - interval '8 days' where utilisateur = (select id from socle.utilisateur where email = $1)`, [p.email]);
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
    expect((await appeler('GET', '/console/abonnements', jT)).statut).toBe(403);
    expect((await appeler('GET', '/console/cabinets', jT)).statut).toBe(403);
    const accueil = await appeler('GET', '/console/accueil', jT);
    expect(accueil.statut).toBe(200);
    expect(accueil.corps.tableau).toEqual({ service: { etat: 'non_mesure', raison: 'pas_de_veille' } });
    // Ni les relances parties : elles nomment des clients.
    expect(accueil.corps.relances).toEqual([]);
    expect((await appeler('GET', '/console/service', jT)).statut).toBe(200);
    expect((await appeler('GET', '/console/equipe', jS)).statut).toBe(403);
    // Le support lit le journal (0114) : ses propres gestes seulement, jamais ceux des autres.
    const lu = await appeler('GET', '/console/journal?qui=' + direction.id, jS);
    expect(lu.statut).toBe(200);
    expect((lu.corps.lignes as { qui: { id: string } | null }[]).every((l) => l.qui?.id === support.id)).toBe(true);
    expect((await appeler('GET', '/console/journal', jT)).statut).toBe(403);
  });

  it('la base refuse chaque fonction de la console hors d\'une session de la console, même au nom d\'un membre', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_entreprises()'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_cabinets()'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_echeances()'))).rejects.toThrow(/session de la console/);
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
    // Une ligne par organisation (0110) : une entreprise seule porte son id, et sa société dit son état.
    const lignes = r.corps.lignes as { id: string; sorte: string; societes: { id: string; etat: { etat: string }; echeance: string | null; parAn: unknown }[] }[];
    expect(lignes.some((l) => l.id === exemple)).toBe(false);
    expect(lignes.some((l) => l.id === retard.ent)).toBe(true);
    // Une entreprise d'exemple n'a pas de fiche dans la console.
    expect((await appeler('GET', `/console/entreprises/${exemple}`, jD)).statut).toBe(404);
    expect(lignes[0]?.societes[0]?.etat.etat).toBe('en_retard');
    expect(lignes.find((l) => l.id === retard.ent)?.sorte).toBe('entreprise');
    const comptes = r.corps.comptes as Record<string, number>;
    const filtre = await appeler('GET', '/console/entreprises?etat=en_retard&limite=200', jD);
    expect(filtre.corps.total).toBe(comptes.en_retard);
    expect((filtre.corps.lignes as { id: string }[]).map((l) => l.id)).toContain(retard.ent);
    // Les cartes du métier comptent la liste qu'elles ouvrent (C3) : l'essai fini sans offre choisie est « à appeler »,
    // et les puces d'état comptent cette vue-là.
    const vues = r.corps.vues as Record<string, number>;
    expect(vues.tout).toBe(r.corps.total);
    const aAppeler = await appeler('GET', '/console/entreprises?vue=a_appeler&limite=200', jD);
    expect(aAppeler.corps.total).toBe(vues.a_appeler);
    expect((aAppeler.corps.lignes as { id: string }[]).map((l) => l.id)).toContain(retard.ent);
    expect(Object.values(aAppeler.corps.comptes as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(vues.a_appeler);
    // Chaque ligne dit son échéance — la fin de la grâce : l'essai fini il y a deux jours, sept jours de grâce, la lecture
    // seule le lendemain — et rien par an tant qu'aucune offre n'est choisie.
    const ligne = lignes.find((l) => l.id === retard.ent)?.societes[0] as { echeance: string | null; parAn: unknown };
    expect(ligne.echeance).toBe(plusJours(aujourdhui, 6));
    expect(ligne.parAn).toBeNull();
    // Un tri inconnu vaut l'urgence ; un tri connu est rendu tel quel.
    expect((await appeler('GET', '/console/entreprises?tri=nimporte&limite=1', jD)).corps.tri).toBe('urgence');
    expect((await appeler('GET', '/console/entreprises?tri=echeance&limite=1', jD)).corps.tri).toBe('echeance');
  });

  it('la tuile des inscriptions ouvre sa liste, du même compte : les sept derniers jours, aujourd\'hui compris', async () => {
    // Inscrite il y a six jours : dans la semaine ; il y a sept : hors de la semaine. Les autres entreprises des tests sont
    // d'aujourd'hui : sans ces deux-là, une règle décalée d'un jour passerait inaperçue.
    const dedans = await entreprise('Inscrite Il Y A Six Jours');
    const dehors = await entreprise('Inscrite Il Y A Sept Jours');
    await admin.query('update socle.entreprise set cree_le = cree_le - make_interval(days => $2) where id = $1', [dedans.ent, 6]);
    await admin.query('update socle.entreprise set cree_le = cree_le - make_interval(days => $2) where id = $1', [dehors.ent, 7]);
    // Deux sociétés nouvelles dans un groupe déclaré : UNE ligne de la liste, et la tuile la compte une fois (0114 ; avant,
    // elle comptait les entreprises et disait une de plus que la liste qu'elle ouvre).
    const g1 = await entreprise('Inscrite En Groupe Une'), g2 = await entreprise('Inscrite En Groupe Deux');
    expect((await appeler('POST', '/console/groupes', jD, { nom: 'Groupe Des Inscrites', entreprises: [g1.ent, g2.ent], motif: 'même famille' })).statut).toBe(201);
    const tableau = (await appeler('GET', '/console/accueil', jD)).corps.tableau as { entreprisesDeLaSemaine: number };
    const r = await appeler('GET', '/console/entreprises?nouvelles=1&limite=1', jD);
    expect(r.statut).toBe(200);
    expect(r.corps.total).toBe(tableau.entreprisesDeLaSemaine);
    // Chacune se cherche par son nom : la base des essais en a bien plus qu'une page.
    const cherche = async (nom: string) => ((await appeler('GET', `/console/entreprises?nouvelles=1&limite=200&q=${encodeURIComponent(nom)}`, jD)).corps.lignes as { id: string }[]).map((l) => l.id);
    expect(await cherche('Inscrite Il Y A Six Jours')).toEqual([dedans.ent]);
    expect(await cherche('Inscrite Il Y A Sept Jours')).toEqual([]);
    expect(await cherche('Inscrite En Groupe')).toHaveLength(1);
    // Les comptes des états portent sur les seules nouvelles : celle d'il y a sept jours n'y compte pas, et leurs puces
    // refont le total de la liste.
    const toutes = await appeler('GET', '/console/entreprises?limite=1', jD);
    expect(r.corps.tous).toBe(tableau.entreprisesDeLaSemaine);
    expect(Number(toutes.corps.tous)).toBeGreaterThan(Number(r.corps.tous));
    const comptes = r.corps.comptes as Record<string, number>;
    expect(Object.values(comptes).reduce((a, b) => a + b, 0)).toBe(r.corps.tous);
  });

  it('chaque ligne dit la durée de son essai, ce qui l\'a prolongé, ses vues et les gestes de son menu ; l\'export est à la direction, motif au journal', async () => {
    const { ent } = await entreprise('Menuiserie Du Menu');
    type S = { id: string; raisonSociale: string; enPlus: Record<string, unknown>; vues: string[]; gestes: string[] };
    type L = { id: string; societes: S[] };
    const ligneDe = async (jeton: string) => ((await appeler('GET', '/console/entreprises?q=menuiserie%20du%20menu&limite=50', jeton)).corps.lignes as L[]).find((l) => l.id === ent)?.societes[0];
    const f = await fiche(jS, ent);
    const fin = String((f.faits as { essaiJusquAu: string }).essaiJusquAu);
    // Un essai qui commence aujourd'hui (0110) : sa durée telle qu'il a commencé, rien de prolongé, aucune pièce émise ce
    // mois, aucune facture qui attend ; il n'est dans aucune vue du métier.
    expect((await ligneDe(jS))?.enPlus).toEqual({ piecesMois: 0, essaiJours: joursEntre(aujourdhui, fin), prolonge: 0, prolongeUneFois: false, moisOffertRecent: false, attend: null });
    expect((await ligneDe(jS))?.vues).toEqual([]);
    // Le menu « … » : les gestes de sa fiche, par la même règle — le support prolonge (une fois) ; la direction prolonge
    // et passe en lecture seule. Payer, offrir, un module restent sur la fiche.
    expect((await ligneDe(jS))?.gestes).toEqual(['prolonger']);
    expect((await ligneDe(jD))?.gestes).toEqual(['prolonger', 'suspendre']);
    expect((await appeler('POST', `/console/entreprises/${ent}/abonnement/prolonger`, jS, { motif: 'il finit sa saisie', ligne: f.ligne, jours: 10 })).statut).toBe(200);
    // Prolongé : la ligne le dit, sa durée de départ ne bouge pas, et le support n'a plus rien à proposer dans le menu.
    const apres = await ligneDe(jS);
    expect(apres?.enPlus).toMatchObject({ essaiJours: joursEntre(aujourdhui, fin), prolonge: 10, prolongeUneFois: true });
    expect(apres?.gestes).toEqual([]);

    // Exporter la sélection : jamais le support ; jamais sans motif ; ce qui s'exporte est ce que la liste montre, et le
    // journal garde le motif, le nombre de lignes et les filtres — jamais les lignes.
    const filtres = { q: 'menuiserie du menu', etat: 'essai' };
    expect((await appeler('POST', '/console/entreprises/export', jS, { motif: 'pour voir', filtres })).statut).toBe(403);
    const sans = await appeler('POST', '/console/entreprises/export', jD, { motif: ' ', filtres });
    expect(sans.statut).toBe(400);
    expect(sans.corps.champ).toBe('motif');
    const ex = await appeler('POST', '/console/entreprises/export', jD, { motif: 'liste pour la réunion', filtres });
    expect(ex.statut, JSON.stringify(ex.corps)).toBe(201);
    const vue = (await appeler('GET', '/console/entreprises?q=menuiserie%20du%20menu&etat=essai&limite=50', jD)).corps.lignes as L[];
    const lignes = ex.corps.lignes as { entreprise: string; pieces: number; email: string | null }[];
    expect(lignes.map((l) => l.entreprise)).toEqual(vue.flatMap((l) => l.societes.map((x) => x.raisonSociale)));
    expect(lignes.length).toBeGreaterThan(0);
    const { rows } = await admin.query("select g.motif, g.apres, g.role from plateforme.geste_console g where g.geste = 'clients.exporte' order by g.le desc limit 1");
    expect(rows[0]).toEqual({ motif: 'liste pour la réunion', role: 'direction', apres: { lignes: lignes.length, filtres } });
  });

  it('la fiche dit la liste fermée : qui, l\'abonnement et son histoire, les membres, des comptes ; jamais le contenu d\'un dossier', async () => {
    const { ent, proprio } = await entreprise('Quincaillerie Fiche');
    const f = await fiche(jS, ent);
    expect(Object.keys(f).sort()).toEqual(['active', 'attend', 'aujourdhui', 'comptes', 'creeLe', 'devise', 'etat', 'evenements', 'faits', 'formeJuridique', 'gestes',
      'id', 'ligne', 'matricule', 'membres', 'organisation', 'prolongeDejaUneFois', 'raisonSociale', 'tenuePar', 'cabinets', 'support', 'factures', 'groupe',
      // 0110–0112 : son numéro et sa ville, nos notes d'appel, ce que la liste dit en plus, l'offre suivante, le délai, la
      // procédure de reprise (la direction seule ; au support : rien). 0113 : ce que sa prochaine facture coûtera. 0114 : le
      // dernier instant où quelqu'un y a travaillé (10 § 4).
      'identite', 'notes', 'enPlus', 'offreSuivante', 'delai', 'reprise', 'prochaineFacture', 'derniereActivite'].sort());
    expect(f.reprise).toBeNull();
    // Son groupe et sa remise (0106) : aucun groupe, aucune société de la même propriétaire, aucune remise ; la règle du
    // groupe et le premier jour de sa prochaine période (le lendemain de son essai).
    expect(f.groupe).toMatchObject({ groupe: null, voisines: [], tauxGroupe: 20, remise: null, prochaine: plusJours((f.ligne as { essai_jusqu_au: string }).essai_jusqu_au, 1) });
    expect(Object.keys(f.groupe as object).sort()).toEqual(['groupe', 'groupes', 'prochaine', 'remise', 'tauxGroupe', 'voisines']);
    // Nos factures (14b) : celles que SkanFact lui adresse, jamais une pièce de son dossier ; aucune pour un essai qui
    // commence (le détail d'une ligne : tests/console/factures.test.ts).
    const fa = f.factures as { lignes: unknown[]; editeur: unknown };
    expect(Object.keys(fa).sort()).toEqual(['editeur', 'lignes']);
    expect(fa.lignes).toEqual([]);
    // Aucun cabinet ne la suit : la liste est vide, pas absente. Un essai qui commence n'attend rien de la console.
    expect(f.cabinets).toEqual([]);
    // Ses demandes au support (Support S1) : les lignes de la liste, jamais le texte des messages ; aucune, des zéros mesurés.
    expect(f.support).toEqual({ comptes: { ouvertes: 0, aRepondre: 0, sansReponse: 0, attenteMax: null }, ouvertes: [], closes: [] });
    expect(f.attend).toEqual([]);
    expect(Object.keys(f.comptes as object).sort()).toEqual(['caisses', 'etablissements', 'piecesCreees', 'piecesEmises', 'salaries']);
    expect(f.membres).toEqual([expect.objectContaining({ nom: proprio.nom, email: proprio.email, roles: ['proprietaire'] })]);
    expect(Object.keys((f.membres as object[])[0] ?? {}).sort()).toEqual(['depuis', 'derniereConnexion', 'derniereIci', 'email', 'nom', 'roles']);
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

describe('les échéances des abonnements', () => {
  it('chaque carte compte sa liste, comme le tableau du matin ; la grâce porte ses relances parties, la prolongation son auteur', async () => {
    // Un essai prolongé par le support (le vrai geste), une entreprise en grâce relancée (les relances posées comme le
    // serveur les pose), une entreprise qui paie l'Essentiel à l'année.
    const prolonge = await entreprise('Essai Prolongé Par Le Support');
    await finEssai(prolonge.ent, plusJours(aujourdhui, 3));
    const avant = await fiche(jS, prolonge.ent);
    expect((await appeler('POST', `/console/entreprises/${prolonge.ent}/abonnement/prolonger`, jS, { motif: 'il attend son comptable', ligne: avant.ligne, jours: 10 })).statut).toBe(200);
    const grace = await entreprise('Négoce En Grâce');
    const echeance = plusJours(aujourdhui, -2);
    await finEssai(grace.ent, echeance);
    await admin.query(`insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le)
      values ($1, $2, 'j15', now() - interval '17 days'), ($1, $2, 'j7', now() - interval '9 days'), ($1, $2, 'j1', now() - interval '3 days')`, [grace.ent, echeance]);
    // Une relance d'une échéance plus ancienne ne compte pas pour celle d'aujourd'hui.
    const relancee = await entreprise('Relancée Pour Une Ancienne Échéance');
    await finEssai(relancee.ent, plusJours(aujourdhui, 5));
    await admin.query(`insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le) values ($1, $2, 'j7', now() - interval '20 days')`, [relancee.ent, plusJours(aujourdhui, -13)]);
    const payeur = await entreprise('Atelier Qui Paie');
    await admin.query(`update plateforme.abonnement set paye_jusqu_au = $2, offre = 'essentiel', periodicite = 'annuel' where entreprise = $1`, [payeur.ent, plusJours(aujourdhui, 100)]);

    const r = await appeler('GET', '/console/abonnements?limite=200', jD);
    expect(r.statut).toBe(200);
    expect(r.corps.vue).toBe('avenir');
    const cartes = r.corps.cartes as Record<string, { n: number }>;
    // Chaque carte ouvre sa liste, du même compte (C3).
    for (const v of ['avenir', 'essai', 'actif', 'en_retard', 'lecture_seule', 'hors']) {
      expect((await appeler('GET', `/console/abonnements?vue=${v}&limite=1`, jD)).corps.total, v).toBe(cartes[v]?.n);
    }
    // Et le tableau du matin compte les mêmes états, sur la même liste.
    const tableau = (await appeler('GET', '/console/accueil', jD)).corps.tableau as { essais: number; enRetard: number; lectureSeule: number; actifs: { total: number } };
    expect([cartes.essai?.n, cartes.en_retard?.n, cartes.lecture_seule?.n, cartes.actif?.n]).toEqual([tableau.essais, tableau.enRetard, tableau.lectureSeule, tableau.actifs.total]);

    type L = { entreprise: { id: string }; relances: { rang: string; partieLe: string | null; etat: string }[]; prolongation: { jours: number; motif: string; qui: { nom: string; role: string } } | null; montantHt: string | null };
    const lire = async (v: string, ent: string) => ((await appeler('GET', `/console/abonnements?vue=${v}&limite=200`, jD)).corps.lignes as L[]).find((l) => l.entreprise.id === ent);
    expect((await lire('en_retard', grace.ent))?.relances.map((x) => [x.rang, x.partieLe !== null, x.etat])).toEqual([
      ['j15', true, 'partie'], ['j7', true, 'partie'], ['j1', true, 'partie'], ['lecture_seule', false, 'prevue'],
    ]);
    // Rien n'est parti pour l'échéance d'aujourd'hui, à cinq jours : celle des sept jours part au prochain passage, celle
    // des quinze jours est sautée, la veille viendra.
    expect((await lire('essai', relancee.ent))?.relances.map((x) => [x.rang, x.partieLe, x.etat])).toEqual([['j15', null, 'sautee'], ['j7', null, 'a_partir'], ['j1', null, 'prevue']]);
    expect((await lire('essai', prolonge.ent))?.prolongation).toMatchObject({ jours: 10, motif: 'il attend son comptable', qui: { nom: support.nom, role: 'support' } });
    expect((await lire('actif', payeur.ent))?.montantHt).toBe('390.000');
    // Le support lit les échéances.
    expect((await appeler('GET', '/console/abonnements?vue=en_retard', jS)).statut).toBe(200);
  });
});

describe('les cabinets', () => {
  it('la liste compte ce que la fiche montre ; un dossier s\'y dit comme dans la liste des clients ; la fiche du client nomme son cabinet', async () => {
    // Un associé gère son cabinet avec le code du téléphone en place (son rôle l'exige).
    const associe = await personne('associe');
    expect((await appeler('POST', '/moi/code', associe.jeton, { methode: 'application' })).statut).toBeLessThan(300);
    const cab = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour Console' });
    expect(cab.statut, JSON.stringify(cab.corps)).toBe(201);
    const cabinet = String(cab.corps.id);
    // Un dossier qu'il tient, un client qui lui a donné son mandat (accepté), un autre qui le lui propose.
    const tenu = await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Cordonnerie El Bey Console' });
    expect(tenu.statut, JSON.stringify(tenu.corps)).toBe(201);
    const client = await entreprise('Boulangerie Essalem Console');
    const m = await appeler('POST', `/entreprises/${client.ent}/mandat`, client.proprio.jeton, { codeCabinet: String(cab.corps.code) });
    expect(m.statut, JSON.stringify(m.corps)).toBe(201);
    expect((await appeler('POST', `/cabinets/${cabinet}/mandats/${String(m.corps.mandat)}/accepter`, associe.jeton)).statut).toBe(200);
    const attente = await entreprise('Pharmacie En Attente Console');
    expect((await appeler('POST', `/entreprises/${attente.ent}/mandat`, attente.proprio.jeton, { codeCabinet: String(cab.corps.code) })).statut).toBe(201);

    const liste = await appeler('GET', '/console/cabinets?limite=200', jS);
    expect(liste.statut).toBe(200);
    const ligne = (liste.corps.lignes as { id: string; comptes: Record<string, number>; associes: { email: string }[]; collaborateurs: number }[]).find((c) => c.id === cabinet);
    expect(ligne).toMatchObject({ comptes: { client: 1, tenu: 1, en_attente: 1 }, associes: [{ email: associe.email }], collaborateurs: 1 });
    // La recherche trouve un cabinet par son associé.
    expect(((await appeler('GET', `/console/cabinets?q=${encodeURIComponent(associe.email)}`, jS)).corps.lignes as { id: string }[]).map((c) => c.id)).toEqual([cabinet]);

    const f = await appeler('GET', `/console/cabinets/${cabinet}`, jS);
    expect(f.statut).toBe(200);
    // La liste fermée (10 § 4) : son nom, ses collaborateurs, ses dossiers et leurs comptes ; rien d'autre.
    expect(Object.keys(f.corps).sort()).toEqual(['aujourdhui', 'collaborateurs', 'comptes', 'creeLe', 'dossiers', 'id', 'nom']);
    expect(Object.keys((f.corps.collaborateurs as object[])[0] ?? {}).sort()).toEqual(['depuis', 'derniereConnexion', 'email', 'nom', 'roles']);
    expect(f.corps.comptes).toEqual(ligne?.comptes);
    const dossiers = f.corps.dossiers as { place: string; mandat: { statut: string } | null; entreprise: { id: string; raisonSociale: string; etat: unknown } }[];
    expect(dossiers.map((d) => [d.place, d.entreprise.raisonSociale, d.mandat?.statut])).toEqual([
      ['client', 'Boulangerie Essalem Console', 'actif'], ['tenu', 'Cordonnerie El Bey Console', 'actif'], ['en_attente', 'Pharmacie En Attente Console', 'propose'],
    ]);
    // Une entreprise dit la même chose ici et dans la liste des clients (cherchée par son nom : la liste d'une base de
    // tests passe deux cents lignes, et la première page ne la montre pas forcément).
    for (const d of dossiers) {
      const trouvees = ((await appeler('GET', `/console/entreprises?q=${encodeURIComponent(d.entreprise.raisonSociale)}&limite=50`, jS)).corps.lignes as { societes: { id: string; etat: unknown }[] }[])
        .flatMap((o) => o.societes);
      expect(d.entreprise.etat).toEqual(trouvees.find((c) => c.id === d.entreprise.id)?.etat);
    }
    // La fiche du client nomme son cabinet ; celle du dossier tenu, celui qui le tient.
    expect((await fiche(jS, client.ent)).cabinets).toEqual([{ id: cabinet, nom: 'Cabinet Ennour Console', place: 'client', mandat: { statut: 'actif', debut: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } }]);
    expect(((await fiche(jS, String(tenu.corps.entreprise))).cabinets as { id: string; place: string }[]).map((c) => [c.id, c.place])).toEqual([[cabinet, 'tenu']]);
    // Un identifiant qui n'est pas celui d'un cabinet : rien.
    expect((await appeler('GET', `/console/cabinets/${client.ent}`, jS)).statut).toBe(404);
    expect((await appeler('GET', '/console/cabinets/pas-un-id', jS)).statut).toBe(404);
    expect((await appeler('GET', `/console/cabinets/${cabinet}`, jT)).statut).toBe(403);
  });
});

describe('le service', () => {
  // Les tables du service sont communes à toute la base de test : l'écran du service (tests/web/console-service.test.ts)
  // y laisse ses mesures et ses versions. Ces cas partent de tables vides, sinon ils comptent celles des autres.
  beforeAll(async () => {
    await admin.query('truncate plateforme.service_minute, plateforme.service_heure, plateforme.service_route, plateforme.service_releve, plateforme.service_alerte, plateforme.service_nuit');
  });

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

  // Ce que le serveur et la veille confient à la base (0085), au nom du compte du serveur, hors de toute session.
  const noterRequetes = (exemplaire: string, envoi: unknown) => enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_requetes($1, $2::jsonb)', [exemplaire, JSON.stringify(envoi)]));
  const noterVeille = (releve: unknown, problemes: unknown, nuits: unknown = []) =>
    enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(releve), JSON.stringify(problemes), JSON.stringify(nuits)]));
  const seaux = (i: number, n: number) => { const h = new Array<number>(47).fill(0); h[i] = n; return h; };

  it('chaque envoi du serveur s\'additionne à ce que la base a déjà : deux exemplaires, deux envois, une seule minute', async () => {
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 5 * 60_000).toISOString();
    const heure = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const jour = heure.slice(0, 10);
    // Le seau 12 est celui de 30 ms, le seau 25 celui de 600 ms (serveur/service/mesures.ts).
    const envoi = (n: number, pannes: number, i: number) => ({
      minutes: [{ minute, sorte: 'lecture', n, pannes, h: seaux(i, n) }],
      heures: [{ heure, sorte: 'lecture', n, pannes, h: seaux(i, n) }],
      jours: [{ jour, route: 'GET /entreprises/:entreprise/ventes/factures', sorte: 'lecture', n, pannes, h: seaux(i, n) }],
    });
    await noterRequetes('machine-1:8080', envoi(40, 1, 12));
    await noterRequetes('machine-1:8080', envoi(10, 0, 12));
    await noterRequetes('machine-2:8080', envoi(50, 0, 25));
    const lignes = (await admin.query('select exemplaire, n, pannes, seaux from plateforme.service_minute where minute = $1 order by exemplaire', [minute])).rows;
    expect(lignes.map((l) => [l.exemplaire, l.n, l.pannes, l.seaux[12], l.seaux[25]])).toEqual([['machine-1:8080', 50, 1, 50, 0], ['machine-2:8080', 50, 0, 0, 50]]);
    // La console additionne les exemplaires : cent requêtes, une panne, la moitié en 30 ms, l'autre en 600.
    const r = await appeler('GET', '/console/service?periode=1h', jD);
    expect(r.statut).toBe(200);
    const point = (r.corps.points as { debut: string; n: number; pannes: number; p50: number | null; p95: number | null }[]).find((p) => p.debut === minute);
    expect(point).toMatchObject({ n: 100, pannes: 1, p50: 30, p95: 600 });
    expect(r.corps.budget).toBe(300);
  });

  it('une route se garde par son modèle : une valeur dans un chemin, la base la refuse', async () => {
    const jour = new Date().toISOString().slice(0, 10);
    const une = (route: string) => noterRequetes('machine-1:8080', { jours: [{ jour, route, sorte: 'lecture', n: 1, pannes: 0, h: seaux(1, 1) }] });
    await expect(une('GET /entreprises/0192e8f0-1c2d-7e3f-8a9b-0c1d2e3f4a5b/ventes/factures')).rejects.toThrow(/service_route/);
    await expect(une('GET /entreprises/:entreprise/compta/annuel/2026')).rejects.toThrow(/service_route/);
    await expect(une('GET /entreprises/:entreprise/compta/annuel/:annee')).resolves.toBeDefined();
  });

  it('la veille : son relevé ; les alertes rapprochées de ce qu\'elle voit, ouvertes, devenues graves, réglées ; la dernière nouvelle d\'une nuit l\'emporte', async () => {
    // Une seule heure, lue au début : relue à chaque appel, elle changeait de minute en route (vu le 14/10/2026 : la
    // minute attendue, comptée après le relevé, avait une minute d'avance sur celle du relevé).
    const maintenant = Date.now();
    const t = (min: number) => new Date(Math.floor(maintenant / 60_000) * 60_000 - min * 60_000).toISOString();
    const releve = (min: number, repond = true) => ({ minute: t(min), repond, charge: 0.5, memoire: 40, processeurs: 2, disques: [{ point: '/', pourcent: 41 }], version: 'abcdef1', certificat: null, archiveLe: null });
    const disque = (grave: boolean) => ({ 'disque:/': { titre: 'le disque / est plein à 80 %', grave, faire: 'Libère de la place.', depuis: t(4) } });
    await noterVeille(releve(4), disque(false));
    await noterVeille(releve(3), disque(true));
    await noterVeille(releve(2, false), {}, [{ jour: '2026-10-13', sauvegarde: { le: '2026-10-13T01:16:00Z', ok: true, horsMachine: { le: t(2), ok: false } } }]);
    await noterVeille(releve(1), disque(false), [{ jour: '2026-10-13', sauvegarde: { le: '2026-10-13T01:16:00Z', ok: true, horsMachine: { le: t(1), ok: true } } }]);
    const alertes = (await admin.query('select grave, a_ete_grave, debut, fin from plateforme.service_alerte where cle = $1 order by debut', ['disque:/'])).rows;
    // La première s'est ouverte à son début, est devenue grave, puis s'est réglée quand la veille ne la voyait plus ; la
    // seconde vient de s'ouvrir, et n'a pas été grave.
    expect(alertes.map((a) => [a.grave, a.a_ete_grave, a.fin === null])).toEqual([[true, true, false], [false, false, true]]);
    expect(new Date(alertes[0].debut).toISOString()).toBe(t(4));
    expect(new Date(alertes[0].fin).toISOString()).toBe(t(2));
    const nuit = (await admin.query('select sauvegarde from plateforme.service_nuit where jour = $1', ['2026-10-13'])).rows[0];
    expect(nuit.sauvegarde.horsMachine.ok).toBe(true);
    const r = await appeler('GET', '/console/service', jT);
    expect(r.corps.disponibilite).toMatchObject({ bas: 1 });
    expect((r.corps.journal as { sorte: string }[]).length).toBeGreaterThanOrEqual(3);
    expect(r.corps.dernier).toMatchObject({ version: 'abcdef1' });
  });

  it('une nouvelle plus ancienne que la dernière garde son relevé sans rien régler ; une version qui revient est une seconde mise en ligne', async () => {
    // Une seule heure, lue au début : relue à chaque appel, elle changeait de minute en route (vu le 14/10/2026 : la
    // minute attendue, comptée après le relevé, avait une minute d'avance sur celle du relevé).
    const maintenant = Date.now();
    const t = (min: number) => new Date(Math.floor(maintenant / 60_000) * 60_000 - min * 60_000).toISOString();
    const releve = (min: number, version: string) => ({ minute: t(min), repond: true, charge: null, memoire: null, processeurs: null, disques: [], version, certificat: null, archiveLe: null });
    await noterVeille(releve(0, 'ccccccc'), { certificat: { titre: 'le certificat https expire dans 20 jours', grave: false, faire: 'Renouvelle-le.', depuis: t(0) } });
    // Une horloge revenue en arrière : trois relevés d'il y a deux heures, sans problème. Ils se gardent ; l'alerte du
    // certificat, ouverte par la dernière nouvelle, reste ouverte (la fermer à leur minute la fermerait avant son début).
    await noterVeille(releve(120, 'aaaaaaa'), {});
    await noterVeille(releve(119, 'bbbbbbb'), {});
    await noterVeille(releve(118, 'aaaaaaa'), {});
    const certificat = (await admin.query('select fin from plateforme.service_alerte where cle = $1', ['certificat'])).rows;
    expect(certificat.map((a) => a.fin)).toEqual([null]);
    expect((await admin.query('select count(*)::int n from plateforme.service_releve where minute = $1', [t(119)])).rows[0].n).toBe(1);
    const r = await appeler('GET', '/console/service', jT);
    const mises = (r.corps.misesEnLigne as { version: string; le: string }[]).map((m) => [m.version, new Date(m.le).toISOString()]);
    // La plus ancienne suite (aaaaaaa, il y a deux heures) tournait déjà : seules les suivantes sont des mises en ligne.
    expect(mises.slice(0, 2)).toEqual([['bbbbbbb', t(119)], ['aaaaaaa', t(118)]]);
    // aaaaaaa avait déjà tourné : la route le dit retour.
    expect((r.corps.misesEnLigne as { retour: boolean }[]).slice(0, 2).map((m) => m.retour)).toEqual([false, true]);
    expect(r.corps.enLigne).toMatchObject({ version: 'ccccccc', vueArriver: true });
  });

  it('seules la direction et la technique lisent le service ; la base le refuse hors de la console ; le compte du serveur n\'en lit aucune table', async () => {
    expect((await appeler('GET', '/console/service', jS)).statut).toBe(403);
    expect((await appeler('GET', '/console/service', jD)).statut).toBe(200);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_veille(now())'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, null, (tx) => tx.query('select * from plateforme.service_minute'))).rejects.toThrow(/permission/);
    await expect(enTantQue(pool, null, (tx) => tx.query('select * from plateforme.service_alerte'))).rejects.toThrow(/permission/);
  });
});

describe('les alertes du service (0086)', () => {
  // Les alertes partent de tables vides : l'écran (tests/web/console-alertes.test.ts) y laisse les siennes.
  beforeAll(async () => {
    await admin.query('truncate plateforme.service_releve, plateforme.service_alerte, plateforme.service_envoi, plateforme.service_sourdine, plateforme.service_demande, plateforme.service_minute');
  });
  const t = (min: number) => new Date(Math.floor(horloge.getTime() / 60_000) * 60_000 - min * 60_000).toISOString();
  const releve = (min: number) => ({ minute: t(min), repond: true, charge: null, memoire: null, processeurs: null, disques: [], version: 'abcdef1', certificat: null, archiveLe: null,
    destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: { a: '+216 •• ••• 456', pret: false } },
    regles: { pannes: { etat: 'calme', part: 0, n: 252 }, temps: { etat: 'trop_peu', p95: null, lectures: 4 } } });
  const noter = (min: number, problemes: unknown, envois: unknown[] = []) =>
    enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)', [JSON.stringify(releve(min)), JSON.stringify(problemes), '[]', JSON.stringify(envois)]));
  const lire = async () => (await enTantQue(pool, null, (tx) => tx.query('select plateforme.veille_lire($1, 15) v', [horloge]))).rows[0].v as { sourdines: { regle: string }[]; demandes: { id: string; sorte: string }[]; minutes: unknown[] };
  const disque = (grave: boolean) => ({ 'disque:/var': { titre: `le disque /var est plein à ${grave ? 92 : 80} %`, grave, faire: 'Libère de la place.', regle: 'disques',
    etapes: [{ texte: 'Libère de la place. Ce qui le remplit :', code: 'sudo du -xhd1 /var | sort -h | tail -n 8' }], depuis: t(30) } });
  const envoi = (min: number, x: Record<string, unknown>) => ({ le: t(min), sorte: 'nouveau', cle: 'disque:/var', titre: 'le disque /var est plein à 80 %', depuis: t(30), grave: false, courriel: true, sms: true, ...x });
  // Les gestes de CE fichier : l'écran (tests/web/console-alertes.test.ts) écrit les siens, en même temps, avec ses comptes.
  const gestes = async () => (await admin.query("select geste, motif, role, qui from plateforme.geste_console where geste like 'service.%' and qui = any($1) order by le, id",
    [[direction.id, technique.id]])).rows;
  let alerteId = '';

  it('la veille écrit ce qui est parti, une fois ; un « réglé » d\'une alerte jamais vue s\'écrit fini ; la console lit tout', async () => {
    await noter(30, disque(false), [envoi(30, {})]);
    // La veille rejoue ce que la base n'avait pas pris : rien ne double.
    await noter(29, disque(false), [envoi(30, {}), envoi(29, { sorte: 'rappel', grave: true, courriel: false, sms: false })]);
    // Une panne de la base elle-même : la veille n'a pu dire que son retour (le relevé d'il y a trois minutes le porte).
    await noter(3, disque(false), [{ le: t(20), sorte: 'regle', cle: 'base', titre: 'la base ne répond plus', depuis: t(25), grave: true, courriel: true, sms: true }]);
    expect((await admin.query('select count(*)::int n from plateforme.service_envoi')).rows[0].n).toBe(3);
    const base = (await admin.query("select debut, fin, a_ete_grave from plateforme.service_alerte where cle = 'base'")).rows;
    expect(base.map((a) => [new Date(a.debut).toISOString(), new Date(a.fin).toISOString(), a.a_ete_grave])).toEqual([[t(25), t(20), true]]);
    const r = await appeler('GET', '/console/service/alertes', jT);
    expect(r.statut).toBe(200);
    const enCours = r.corps.enCours as { id: string; regle: string; etapes: unknown[]; prochainRappel: string | null; chronologie: { sorte: string }[] }[];
    expect(enCours).toHaveLength(1);
    alerteId = enCours[0]?.id ?? '';
    expect(enCours[0]).toMatchObject({ regle: 'disques', etapes: [{ texte: 'Libère de la place. Ce qui le remplit :', code: 'sudo du -xhd1 /var | sort -h | tail -n 8' }] });
    // Le prochain rappel : six heures après le seul message REMIS (le rappel de 29 n'est parti par aucun moyen).
    expect(enCours[0]?.prochainRappel).toBe(new Date(Date.parse(t(30)) + 6 * 3_600_000).toISOString());
    expect(r.corps.prevenus).toMatchObject({ destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: { a: '+216 •• ••• 456', pret: false } } });
    expect((r.corps.histoire as { cle: string; reglee: string }[]).map((h) => [h.cle, h.reglee])).toEqual([['base', 'seule'], ['disque:/var', 'en_cours']]);
    // Ce que les règles des requêtes ont lu au dernier relevé, récent ; sans relevé depuis cinq minutes, rien n'est lu.
    expect((r.corps.regles as { id: string; etat: string }[]).find((x) => x.id === 'temps')?.etat).toBe('trop_peu');
    horloge = new Date(horloge.getTime() + 6 * 60_000);
    try {
      expect(((await appeler('GET', '/console/service/alertes', jT)).corps.regles as { id: string; etat: string }[]).find((x) => x.id === 'temps')?.etat).toBe('non_lu');
    } finally { horloge = new Date(horloge.getTime() - 6 * 60_000); }
    // Le compte de l'onglet, et l'alerte que le bandeau d'une ligne nomme : la seule ouverte (la grave de la base est
    // réglée : elle ne passe pas devant), avec son début.
    expect(r.corps.alertesEnCours).toEqual({ n: 1, graves: 0, cles: ['disque:/var'], premiere: { titre: 'le disque /var est plein à 80 %', grave: false, debut: t(30) } });
  });

  it('prendre en charge : avec son motif, une fois, jamais une alerte réglée ; le journal dit qui', async () => {
    const sans = await appeler('POST', `/console/service/alertes/${alerteId}/prendre`, jT, { motif: ' ' });
    expect([sans.statut, sans.corps.champ]).toEqual([400, 'motif']);
    expect((await appeler('POST', `/console/service/alertes/${alerteId}/prendre`, jS, { motif: 'je regarde' })).statut).toBe(403);
    expect((await appeler('POST', `/console/service/alertes/${alerteId}/prendre`, jT, { motif: 'je libère /var' })).statut).toBe(200);
    const deux = await appeler('POST', `/console/service/alertes/${alerteId}/prendre`, jT, { motif: 'encore moi' });
    expect(deux.statut).toBe(403);
    expect(String(deux.corps.motif)).toMatch(/déjà pris cette alerte/);
    // Quelqu'un d'autre la reprend : le journal dit qui l'avait.
    expect((await appeler('POST', `/console/service/alertes/${alerteId}/prendre`, jD, { motif: 'je prends la suite' })).statut).toBe(200);
    const r = await appeler('GET', '/console/service/alertes', jD);
    expect((r.corps.enCours as { prise: unknown }[])[0]?.prise).toMatchObject({ par: direction.nom, motif: 'je prends la suite', moi: true });
    expect((await appeler('POST', '/console/service/alertes/pas-un-id/prendre', jT, { motif: 'je regarde' })).statut).toBe(404);
    const reglee = (await admin.query("select id from plateforme.service_alerte where cle = 'base'")).rows[0].id as string;
    expect(String((await appeler('POST', `/console/service/alertes/${reglee}/prendre`, jT, { motif: 'trop tard' })).corps.motif)).toMatch(/déjà réglée/);
    expect((await gestes()).map((g) => [g.geste, g.motif, g.role])).toEqual([['service.prendre', 'je libère /var', 'technique'], ['service.prendre', 'je prends la suite', 'direction']]);
  });

  it('la sourdine : d\'une règle qui prévient, un quart d\'heure à un jour, quatre heures au plus sur une alerte grave, une à la fois ; la veille la lit', async () => {
    expect((await appeler('POST', '/console/service/sourdines', jT, { regle: 'replique', minutes: 60, motif: 'pas branchée' })).statut).toBe(404);
    expect((await appeler('POST', '/console/service/sourdines', jT, { regle: 'disques', minutes: 10, motif: 'trop court' })).statut).toBe(400);
    expect((await appeler('POST', '/console/service/sourdines', jS, { regle: 'disques', minutes: 60, motif: 'le support' })).statut).toBe(403);
    // L'alerte devient grave : plus de quatre heures, refusé.
    await noter(2, disque(true));
    const long = await appeler('POST', '/console/service/sourdines', jT, { regle: 'disques', minutes: 480, motif: 'nettoyage de nuit' });
    expect(long.statut).toBe(403);
    expect(String(long.corps.motif)).toMatch(/plus de quatre heures/);
    const ok = await appeler('POST', '/console/service/sourdines', jT, { regle: 'disques', minutes: 120, motif: 'nettoyage en cours' });
    expect(ok.statut).toBe(201);
    // La fin dite est celle que la base a posée, comptée sur la même heure.
    const posee = (await admin.query('select id, fin from plateforme.service_sourdine')).rows;
    expect(posee.map((x) => [x.id, new Date(x.fin).toISOString()])).toEqual([[ok.corps.id, ok.corps.fin]]);
    expect(String((await appeler('POST', '/console/service/sourdines', jT, { regle: 'disques', minutes: 60, motif: 'encore' })).corps.motif)).toMatch(/déjà en sourdine/);
    expect((await lire()).sourdines.map((x) => x.regle)).toEqual(['disques']);
    const r = await appeler('GET', '/console/service/alertes', jT);
    expect((r.corps.enCours as { sourdine: unknown }[])[0]?.sourdine).toMatchObject({ id: ok.corps.id, par: technique.nom, motif: 'nettoyage en cours' });
    // La lever : la veille ne la lit plus ; la lever deux fois, refusé.
    expect((await appeler('POST', `/console/service/sourdines/${String(ok.corps.id)}/lever`, jD, { motif: 'nettoyage fini' })).statut).toBe(200);
    expect((await lire()).sourdines).toEqual([]);
    expect(String((await appeler('POST', `/console/service/sourdines/${String(ok.corps.id)}/lever`, jD, { motif: 'encore' })).corps.motif)).toMatch(/déjà finie/);
    expect((await gestes()).slice(2).map((g) => [g.geste, g.motif])).toEqual([['service.sourdine', 'nettoyage en cours'], ['service.sourdine_levee', 'nettoyage fini']]);
  });

  it('l\'essai : demandé une fois, lu par la veille, fait quand elle dit ce qui est parti', async () => {
    const d = await appeler('POST', '/console/service/essai', jD, { motif: 'nouveau téléphone' });
    expect(d.statut).toBe(201);
    expect(String((await appeler('POST', '/console/service/essai', jD, { motif: 'encore' })).corps.motif)).toMatch(/attend déjà son tour/);
    expect((await lire()).demandes).toEqual([{ id: d.corps.id, sorte: 'essai' }]);
    // La veille la prend à sa minute suivante.
    await noter(-1, disque(true), [{ le: t(-1), sorte: 'essai', cle: null, titre: null, depuis: null, grave: false, courriel: true, sms: false, demande: d.corps.id }]);
    expect((await lire()).demandes).toEqual([]);
    const r = await appeler('GET', '/console/service/alertes', jD);
    const p = r.corps.prevenus as { dernierEssai: { le: string; courriel: boolean; sms: boolean }; essaiEnAttente: unknown };
    expect([Date.parse(p.dernierEssai.le), p.dernierEssai.courriel, p.dernierEssai.sms, p.essaiEnAttente]).toEqual([Date.parse(t(-1)), true, false, null]);
    expect((await gestes()).at(-1)).toMatchObject({ geste: 'service.essai', motif: 'nouveau téléphone', role: 'direction', qui: direction.id });
  });

  it('la base refuse chaque geste hors d\'une session de la console ; le compte du serveur ne lit aucune de ces tables', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_sourdine($1, 60, $2, now())', ['disques', 'hors console']))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_demander_essai($1, now())', ['hors console']))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_alertes(now())'))).rejects.toThrow(/session de la console/);
    for (const table of ['service_envoi', 'service_sourdine', 'service_demande']) {
      await expect(enTantQue(pool, null, (tx) => tx.query(`select * from plateforme.${table}`)), table).rejects.toThrow(/permission/);
    }
  });
});

describe('les mesures du serveur', () => {
  it('chaque réponse de l\'API se note par le modèle de sa route, jamais par l\'adresse appelée ; un refus n\'est pas une panne', async () => {
    const collecte = new Collecte();
    const a = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille })], { collecte });
    await a.ready();
    try {
      await a.inject({ method: 'GET', url: `${VERSION}/moi` });
      await a.inject({ method: 'GET', url: `${VERSION}/entreprises/0192e8f0-1c2d-7e3f-8a9b-0c1d2e3f4a5b/equipe` });
      await a.inject({ method: 'GET', url: `${VERSION}/documentation` });
      await a.inject({ method: 'GET', url: `${VERSION}/route-qui-n-existe-pas` });
      const e = collecte.prendre();
      expect(e.jours.map((j) => j.route).sort()).toEqual(['GET /entreprises/:entreprise/equipe', 'GET /moi']);
      expect(e.jours.every((j) => j.pannes === 0 && j.sorte === 'lecture')).toBe(true);
      expect(e.minutes.reduce((s, m) => s + m.n, 0)).toBe(2);
      expect(JSON.stringify(e)).not.toContain('0192e8f0');
      expect(await envoyerMesures(pool, 'machine-1:8080', collecte)).toBe(true);
    } finally { await a.close(); }
  });
});

describe('les sauvegardes du service (0087, docs/console.md C14)', () => {
  beforeAll(async () => {
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit, plateforme.service_minute');
  });
  const t = (min: number) => new Date(Math.floor(horloge.getTime() / 60_000) * 60_000 - min * 60_000).toISOString();
  const noter = (min: number, attente: string | null, nuits: unknown[] = []) => enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb)', [
    JSON.stringify({ minute: t(min), repond: true, charge: null, memoire: null, processeurs: null, disques: [], version: 'abcdef1', certificat: null, archiveLe: t(min + 1),
      destinataires: null, regles: null, copies: { archivage: { enMarche: true }, horsMachine: { regle: true, attenteDepuis: attente } } }), '{}', JSON.stringify(nuits)]));
  const nuit = (min: number, ok: boolean) => ({ jour: t(0).slice(0, 10), sauvegarde: { le: t(600), ok: true, lignes: 1200, migrations: 87, horsMachine: { le: t(min), ok } },
    copieDeBase: { le: t(580), ok: true } });

  it('la base garde l\'état des copies de chaque relevé, et la minute où une copie est arrivée hors de la machine', async () => {
    await noter(3, t(40), [nuit(3, false)]);
    await noter(2, null, [nuit(2, true)]);
    await noter(1, null, [nuit(1, true)]);
    const r = await appeler('GET', '/console/service/sauvegardes', jT);
    expect(r.statut).toBe(200);
    const nuits = r.corps.nuits as { horsMachine: { le: string; ok: boolean } | null; sauvegarde: { lignes: number | null } }[];
    // Arrivée à la deuxième minute, et pas à la troisième : la veille repose la nuit chaque minute, l'arrivée reste.
    expect(nuits[0]?.horsMachine?.ok).toBe(true);
    expect(Date.parse(nuits[0]?.horsMachine?.le ?? '')).toBe(Date.parse(t(2)));
    expect(nuits[0]?.sauvegarde.lignes).toBe(1200);
    // Le pire retard de l'heure : celui de la troisième minute (37 minutes, en secondes rangées, en minutes rendues).
    const retards = r.corps.retards as { plusLong: number | null }[];
    expect(Math.max(...retards.map((x) => x.plusLong ?? 0))).toBe(37);
  });

  it('la technique lit tout, sauf le détail des remises (il nomme le client) ; elle ne prépare pas une remise', async () => {
    const r = await appeler('GET', '/console/service/sauvegardes', jT);
    expect(r.corps.remises).toBeNull();
    const { ent } = await entreprise('Atelier Remis');
    expect((await appeler('POST', '/console/service/remise', jT, { entreprise: ent, minute: '2026-10-12 14:03', motif: 'un import' })).statut).toBe(403);
  });

  it('la direction prépare une remise : chaque refus nomme sa case ; faite, elle rend les deux commandes et entre au journal', async () => {
    const { ent } = await entreprise('Atelier À Remettre');
    const minute = (min: number) => new Date(Date.parse(t(min)) + 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    const refus = await appeler('POST', '/console/service/remise', jD, { entreprise: ent, minute: '2026-02-31 14:03', motif: 'un import' });
    expect(refus).toMatchObject({ statut: 400, corps: { champ: 'minute' } });
    expect((await appeler('POST', '/console/service/remise', jD, { entreprise: ent, minute: minute(10), motif: 'un' })).corps.champ).toBe('motif');
    const autre = '01a133c0-b805-7a3e-a711-7b49e8e43224';
    // Un client que la base ne connaît pas (ou d'exemple) : c'est la base qui refuse, et le refus le dit.
    const inconnu = await appeler('POST', '/console/service/remise', jD, { entreprise: autre, minute: minute(10), motif: 'un import' });
    expect(inconnu.statut).toBe(403);
    expect(inconnu.corps.motif).toBe('Cette entreprise n\'existe pas, ou c\'est une entreprise d\'exemple.');
    const r = await appeler('POST', '/console/service/remise', jD, { entreprise: ent, minute: minute(10), motif: 'un import a doublé les factures' });
    expect(r.statut).toBe(201);
    expect(r.corps.essai).toBe(`sudo bash /opt/skanfact/depot/exploitation/remettre-entreprise.sh ${ent} "${minute(10)}" 'un import a doublé les factures'`);
    expect(r.corps.remise).toBe(`${String(r.corps.essai)} --remettre`);
    const g = (await admin.query("select role, entreprise, motif, apres from plateforme.geste_console where geste = 'service.remise' and entreprise = $1", [ent])).rows;
    expect(g).toEqual([{ role: 'direction', entreprise: ent, motif: 'un import a doublé les factures', apres: { minute: minute(10) } }]);
    // La remise faite sur le serveur (sa trace dans la piste d'audit de l'entreprise) se dit préparée par qui l'a préparée.
    await admin.query(`insert into socle.audit (entreprise, geste, objet_type, objet_id, avant, apres) values ($1, 'socle.entreprise.remettre', 'entreprise', $1, '{}', $2)`,
      [ent, JSON.stringify({ motif: 'un import a doublé les factures', minute: minute(10), numerosRetires: ['FAC-1', 'FAC-2'] })]);
    const lu = await appeler('GET', '/console/service/sauvegardes', jD);
    const remises = lu.corps.remises as { entreprise: string; nom: string; minute: string; numerosRetires: number; preparee: { par: string } | null }[];
    expect(remises.find((x) => x.entreprise === ent)).toMatchObject({ nom: 'Atelier À Remettre', minute: minute(10), numerosRetires: 2, preparee: { par: direction.nom } });
  });

  it('l\'audit C11 : seule une remise qui a mesuré sa durée prouve la promesse ; une remise d\'après, sans durée, ne l\'efface pas', async () => {
    const { ent } = await entreprise('Atelier Remis Mesuré');
    const remettre = (apres: Record<string, unknown>) => admin.query(`insert into socle.audit (entreprise, geste, objet_type, objet_id, avant, apres)
      values ($1, 'socle.entreprise.remettre', 'entreprise', $1, '{}', $2)`, [ent, JSON.stringify({ motif: 'un import', numerosRetires: [], ...apres })]);
    await remettre({ minute: '2026-10-12 14:03', secondes: 2537 });
    await remettre({ minute: '2026-10-12 14:20', secondes: null });
    const lu = await appeler('GET', '/console/service/sauvegardes', jD);
    expect(lu.corps.remisesFaites).toMatchObject({ mesuree: { secondes: 2537, minute: '2026-10-12 14:03' } });
    const promesse = (lu.corps.promesses as { id: string; etat: string; preuve: unknown }[]).find((x) => x.id === 'entreprise');
    expect(promesse).toMatchObject({ etat: 'tenue', preuve: { minutes: 43, vieille: false } });
    const miennes = (lu.corps.remises as { entreprise: string; secondes: number | null }[]).filter((x) => x.entreprise === ent);
    expect(miennes.map((x) => x.secondes)).toEqual([null, 2537]);
    // La technique lit la preuve (pas le détail des remises, qui nomme le client).
    expect((await appeler('GET', '/console/service/sauvegardes', jT)).corps.remisesFaites).toMatchObject({ mesuree: { secondes: 2537 } });
  });

  it('l\'audit C10 : passé cinq minutes sans relevé, l\'archivage et la copie hors de la machine ne se disent plus « en marche » ni « à jour »', async () => {
    await noter(0, null);
    const sit = async () => (await appeler('GET', '/console/service/sauvegardes', jT)).corps as { situation: Record<string, Record<string, unknown>>; copies: { liste: { id: string; etat: string }[] } };
    const frais = await sit();
    expect(frais.situation.archivage).toMatchObject({ etat: 'bon', enMarche: true, perime: false });
    expect(frais.situation.hors).toMatchObject({ etat: 'bon', perime: false });
    const releve = frais.situation.archivage?.releveLe;
    horloge = new Date(horloge.getTime() + 6 * 60_000);
    try {
      const vieux = await sit();
      expect(vieux.situation.archivage).toMatchObject({ etat: 'nonmesure', enMarche: null, perime: true, releveLe: releve });
      expect(vieux.situation.hors).toMatchObject({ etat: 'nonmesure', regle: null, perime: true });
      expect(vieux.copies.liste.filter((c) => c.id === 'serveur' || c.id === 'hors_machine').map((c) => c.etat)).toEqual(['nonmesure', 'nonmesure']);
    } finally { horloge = new Date(); }
  });
});

describe('les performances du service (0088, docs/console.md C15)', () => {
  beforeAll(async () => {
    await admin.query('truncate plateforme.service_minute, plateforme.service_heure, plateforme.service_route');
  });
  const noterRequetes = (exemplaire: string, envoi: unknown) => enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_requetes($1, $2::jsonb)', [exemplaire, JSON.stringify(envoi)]));
  const seaux = (parSeau: Record<number, number>) => Array.from({ length: 47 }, (_, i) => parSeau[i] ?? 0);
  const minute = (min: number) => new Date(Math.floor(horloge.getTime() / 60_000) * 60_000 - min * 60_000).toISOString();
  const jour = (j: number) => new Date(horloge.getTime() - j * 86_400_000).toISOString().slice(0, 10);

  it('les routes de sept jours, les exemplaires de l\'heure, la base ; la période d\'avant ne compte que la sienne', async () => {
    // Le seau 22 est celui de 300 ms, le seau 29 celui de 1,5 s : une lente (serveur/service/mesures.ts).
    await noterRequetes('vps-1:8080', {
      minutes: [{ minute: minute(4), sorte: 'lecture', n: 40, pannes: 1, h: seaux({ 22: 40 }) }, { minute: minute(90), sorte: 'lecture', n: 25, pannes: 0, h: seaux({ 22: 25 }) }],
      jours: [
        { jour: jour(0), route: 'GET /entreprises/:entreprise/compta/balance', sorte: 'comptes', n: 30, pannes: 1, h: seaux({ 22: 27, 29: 3 }) },
        { jour: jour(2), route: 'GET /entreprises/:entreprise/compta/balance', sorte: 'comptes', n: 10, pannes: 0, h: seaux({ 22: 10 }) },
        // Dix jours : hors des sept que l'écran regarde.
        { jour: jour(10), route: 'GET /entreprises/:entreprise/ventes', sorte: 'lecture', n: 500, pannes: 0, h: seaux({ 22: 500 }) },
      ],
    });
    await noterRequetes('vps-2:8080', { minutes: [{ minute: minute(3), sorte: 'lecture', n: 10, pannes: 0, h: seaux({ 22: 10 }) }] });
    const r = await appeler('GET', '/console/service/performances?periode=1h', jT);
    expect(r.statut).toBe(200);
    const routes = r.corps.routes as { route: string; n: number; pannes: number; lentes: number; p95: number | null }[];
    expect(routes).toEqual([expect.objectContaining({ route: 'GET /entreprises/:entreprise/compta/balance', n: 40, pannes: 1, lentes: 3, p95: 1500 })]);
    const ex = r.corps.exemplaires as { nom: string; n: number; etat: string }[];
    expect(ex.map((x) => [x.nom, x.n, x.etat])).toEqual([['vps-1:8080', 40, 'bon'], ['vps-2:8080', 10, 'bon']]);
    expect(r.corps.base).toMatchObject({ connexions: expect.any(Number), maxConnexions: expect.any(Number), taille: expect.any(Number) });
    const trafic = r.corps.trafic as { total: { n: number }; totalAvant: { n: number } | null; avant: unknown[] | null };
    // L'heure du moment : cinquante requêtes ; celle d'avant : les vingt-cinq d'il y a 90 minutes, jamais les deux heures.
    expect(trafic.total.n).toBe(50);
    expect(trafic.totalAvant?.n).toBe(25);
    expect(trafic.avant).toHaveLength(60);
    // Trente jours : la période d'avant n'est plus gardée.
    const mois = await appeler('GET', '/console/service/performances?periode=30j', jD);
    expect((mois.corps.trafic as { avant: unknown; totalAvant: unknown })).toMatchObject({ avant: null, totalAvant: null });
    expect((mois.corps.budgets as unknown[]).length).toBe(7);
  });

  it('le support ne lit pas les performances : c\'est la direction et la technique', async () => {
    expect((await appeler('GET', '/console/service/performances', jS)).statut).toBe(403);
    await expect(enTantQue(pool, null, (tx) => tx.query('select plateforme.console_service_performances(current_date, now())'))).rejects.toThrow();
  });
});

describe('les incidents du service et la page d\'état (0089, docs/console.md C24)', () => {
  // Les incidents partent de tables vides : l'écran (tests/web/console-incidents.test.ts) y laisse les siens.
  beforeAll(async () => {
    // Les demandes du support peuvent désigner un incident (0126) : on les en délie d'abord ; un « truncate … cascade »
    // viderait aussi les demandes des autres essais.
    await admin.query('update plateforme.demande_support set incident = null where incident is not null');
    await admin.query('delete from plateforme.service_suite; delete from plateforme.service_incident_point; delete from plateforme.service_incident');
    await admin.query('truncate plateforme.service_maintenance');
  });
  // Les gestes de CE fichier : l'écran (tests/web/console-incidents.test.ts) écrit les siens, en même temps.
  const gestes = async () => (await admin.query("select geste, motif, apres from plateforme.geste_console where (geste like 'service.incident%' or geste like 'service.suite%' or geste like 'service.maintenance%') and qui = any($1) order by le, id",
    [[direction.id, technique.id]])).rows;
  const annonce = async () => ((await enTantQue(pool, null, (tx) => tx.query('select plateforme.veille_lire($1, 15) v', [horloge]))).rows[0].v as { annonce: Record<string, unknown> }).annonce;
  const lire = async (j = jT) => (await appeler('GET', '/console/service/incidents', j)).corps as {
    ouverts: { id: string; ref: string; gravite: string; public: string | null; points: { texte: string }[] }[]; suites: { id: string; titre: string; retard: number }[];
    suitesFaites: number; page: unknown; passes: { trente: { n: number; lignes: { ref: string; minutes: number }[] } }; maintenances: { sorte: string; etat?: string; id?: string }[];
    fiches: Record<string, { ref: string } | null>; equipe: { id: string; nom: string }[];
  };
  let id = '';

  it('ouvrir : un numéro par année, sans trou ; la page d\'état dit le message public, le plus grave d\'abord', async () => {
    expect((await appeler('POST', '/console/service/incidents', jS, { titre: 'SkanFact ne répondait plus', gravite: 'majeur', fiche: 'service', public: null, motif: 'la veille crie' })).statut).toBe(403);
    expect((await appeler('POST', '/console/service/incidents', jT, { titre: 'x', gravite: 'majeur', fiche: null, public: null, motif: 'la veille crie' })).statut).toBe(400);
    expect((await appeler('POST', '/console/service/incidents', jT, { titre: 'Un titre', gravite: 'majeur', fiche: 'inventee', public: null, motif: 'la veille crie' })).statut).toBe(400);
    expect((await appeler('POST', '/console/service/incidents', jT, { titre: 'Un titre', gravite: 'majeur', fiche: null, public: '<script>', motif: 'la veille crie' })).statut).toBe(400);
    const a = await appeler('POST', '/console/service/incidents', jT, { titre: 'Les e-mails de connexion arrivent en retard', gravite: 'mineur', fiche: 'partenaire', public: 'Les e-mails de connexion arrivent avec du retard.', motif: 'trois appels' });
    expect(a.statut).toBe(201);
    // Un numéro par incident et par année, sans trou : le suivant est le suivant (l'écran ouvre les siens dans la même base).
    const [, annee, n] = /^INC-(\d{4})-(\d{3})$/.exec(String(a.corps.ref)) ?? [];
    const b = await appeler('POST', '/console/service/incidents', jD, { titre: 'SkanFact ne répondait plus', gravite: 'majeur', fiche: 'service', public: null, motif: 'la veille crie' });
    const suivant = `INC-${annee}-${String(Number(n) + 1).padStart(3, '0')}`;
    expect(b.corps.ref).toBe(suivant);
    id = String(b.corps.id);
    let l = await lire();
    expect(l.ouverts.filter((i) => [a.corps.ref, suivant].includes(i.ref)).map((i) => [i.ref, i.gravite])).toEqual([[suivant, 'majeur'], [a.corps.ref, 'mineur']]);
    expect((await annonce()).incident).toMatchObject({ gravite: 'mineur', texte: 'Les e-mails de connexion arrivent avec du retard.' });
    // Un point public sur le majeur : il remplace son message, et la page dit le plus grave.
    expect((await appeler('POST', `/console/service/incidents/${id}/points`, jT, { texte: 'SkanFact ne répond plus ; nous y travaillons.', public: true, gravite: null })).statut).toBe(201);
    expect((await annonce()).incident).toMatchObject({ gravite: 'majeur', texte: 'SkanFact ne répond plus ; nous y travaillons.' });
    l = await lire();
    expect(l.ouverts[0]?.public).toBe('SkanFact ne répond plus ; nous y travaillons.');
    expect(l.fiches.service).toMatchObject({ ref: suivant });
  });

  it('une gravité monte, elle ne descend pas ; retirer le message rend la page à la veille ; le journal garde le numéro', async () => {
    const baisse = await appeler('POST', `/console/service/incidents/${id}/points`, jT, { texte: 'ça va mieux', public: false, gravite: 'mineur' });
    expect(baisse.statut).toBe(403);
    // La gravité se dit comme une valeur (0092 : format(), reconnu au catalogue), jamais collée au texte.
    expect(baisse.corps.motif).toBe('Une gravité monte, elle ne descend pas : l\'incident reste au moins majeur.');
    // Reconnue au catalogue, elle se traduit : dans la langue d'essai, plus un mot n'est celui de la base.
    const factice = await app.inject({ method: 'POST', url: `${VERSION}/console/service/incidents/${id}/points`,
      headers: { authorization: `Bearer ${jT}`, 'x-langue': 'factice' }, payload: { texte: 'ça va mieux', public: false, gravite: 'mineur' } });
    expect(String(factice.json().motif)).not.toContain('descend pas');
    expect((await appeler('POST', `/console/service/incidents/${id}/points`, jT, { texte: 'La base aussi', public: false, gravite: 'critique' })).statut).toBe(201);
    expect((await lire()).ouverts[0]).toMatchObject({ gravite: 'critique' });
    expect((await appeler('POST', `/console/service/incidents/${id}/retirer`, jT, { motif: ' ' })).statut).toBe(400);
    expect((await appeler('POST', `/console/service/incidents/${id}/retirer`, jT, { motif: 'tout répond' })).statut).toBe(200);
    expect(String((await appeler('POST', `/console/service/incidents/${id}/retirer`, jT, { motif: 'encore' })).corps.motif)).toMatch(/ne dit rien/);
    // Le mineur reste annoncé.
    expect((await annonce()).incident).toMatchObject({ gravite: 'mineur' });
    const g = await gestes();
    expect(g.map((x) => x.geste)).toEqual(['service.incident_ouvert', 'service.incident_ouvert', 'service.incident_point', 'service.incident_point', 'service.incident_public_retire']);
    expect(g.every((x) => /^INC-\d{4}-\d{3}$/.test(String(x.apres?.ref)))).toBe(true);
  });

  it('clore : son compte rendu, ses suites avec une personne et une date ; puis la suite faite, la suite repoussée', async () => {
    const qui = (await lire()).equipe.find((x) => x.nom.length > 0)?.id ?? '';
    const fin = new Date(horloge.getTime() - 60_000).toISOString();
    const corps = { fin, effet: 'Personne ne pouvait ouvrir l\'application.', cause: 'Une migration trop longue.', change: 'Une migration a un délai.', motif: 'compte rendu écrit' };
    expect((await appeler('POST', `/console/service/incidents/${id}/clore`, jT, { ...corps, effet: 'court', suites: [] })).statut).toBe(400);
    const passe = new Date(horloge.getTime() - 86_400_000).toISOString().slice(0, 10);
    expect(String((await appeler('POST', `/console/service/incidents/${id}/clore`, jT, { ...corps, suites: [{ titre: 'Un délai', responsable: qui, due: passe }] })).corps.motif)).toMatch(/aujourd'hui ou plus tard/);
    const loin = new Date(horloge.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await appeler('POST', `/console/service/incidents/${id}/clore`, jT, { ...corps, suites: [{ titre: 'Une migration a un délai', responsable: qui, due: loin }, { titre: 'Un second relais', responsable: qui, due: loin }] })).statut).toBe(200);
    expect(String((await appeler('POST', `/console/service/incidents/${id}/points`, jT, { texte: 'trop tard', public: false, gravite: null })).corps.motif)).toMatch(/clos/);
    let l = await lire();
    expect(l.ouverts.map((i) => i.gravite)).toEqual(['mineur']);
    expect(l.passes.trente.lignes.map((x) => x.ref)).toHaveLength(1);
    expect(l.suites.map((s) => s.titre)).toEqual(['Un second relais', 'Une migration a un délai']);
    const [s1, s2] = l.suites;
    expect((await appeler('POST', `/console/service/suites/${s1?.id}/faite`, jT, { motif: 'en place' })).statut).toBe(200);
    expect(String((await appeler('POST', `/console/service/suites/${s1?.id}/faite`, jT, { motif: 'encore' })).corps.motif)).toMatch(/déjà faite/);
    expect(String((await appeler('POST', `/console/service/suites/${s2?.id}/repousser`, jT, { due: loin, motif: 'plus tard' })).corps.motif)).toMatch(/plus tard que/);
    const plusLoin = new Date(horloge.getTime() + 20 * 86_400_000).toISOString().slice(0, 10);
    expect((await appeler('POST', `/console/service/suites/${s2?.id}/repousser`, jT, { due: plusLoin, motif: 'le relais attend son contrat' })).statut).toBe(200);
    l = await lire();
    expect(l.suites.map((s) => s.titre)).toEqual(['Une migration a un délai']);
    expect(l.suitesFaites).toBe(1);
  });

  it('une maintenance : annoncée avant de commencer, douze heures au plus ; la page l\'annonce quarante-huit heures avant ; annulée, elle se tait', async () => {
    const dans = (h: number) => new Date(horloge.getTime() + h * 3_600_000).toISOString();
    const m = { titre: 'Le disque de la base agrandi', texte: 'Tout reste lisible ; les envois partent après.', motif: 'prévu avec l\'hébergeur' };
    expect(String((await appeler('POST', '/console/service/maintenances', jT, { ...m, debut: dans(-1), fin: dans(1) })).corps.motif)).toMatch(/avant de commencer/);
    expect(String((await appeler('POST', '/console/service/maintenances', jT, { ...m, debut: dans(1), fin: dans(14) })).corps.motif)).toMatch(/douze heures/);
    const loin = await appeler('POST', '/console/service/maintenances', jT, { ...m, debut: dans(72), fin: dans(73) });
    expect(loin.statut).toBe(201);
    expect((await annonce()).maintenance).toBeNull();
    const pres = await appeler('POST', '/console/service/maintenances', jT, { ...m, debut: dans(24), fin: dans(25) });
    expect((await annonce()).maintenance).toMatchObject({ titre: 'Le disque de la base agrandi' });
    expect((await appeler('POST', `/console/service/maintenances/${String(pres.corps.id)}/annuler`, jT, { motif: 'reporté' })).statut).toBe(200);
    expect((await annonce()).maintenance).toBeNull();
    const l = await lire();
    expect(l.maintenances.filter((x) => x.sorte === 'annoncee').map((x) => x.etat)).toEqual(['a_venir', 'annulee']);
  });

  it('la page d\'état : ce que la veille a écrit à côté d\'elle ; rien tant qu\'elle n\'a rien écrit', async () => {
    const f = path.join(path.dirname(veille), 'page-etat.json');
    fs.rmSync(f, { force: true });
    expect((await lire()).page).toBeNull();
    fs.writeFileSync(f, JSON.stringify({ le: horloge.toISOString(), tout: { couleur: 'vert', dit: 'Tout fonctionne' }, lignes: [{ nom: 'Le service', couleur: 'vert', dit: 'Fonctionne' }], annonce: { incident: null, maintenance: null } }));
    expect((await lire()).page).toMatchObject({ tout: { couleur: 'vert', dit: 'Tout fonctionne' } });
    fs.rmSync(f, { force: true });
  });

  it('seules la direction et la technique ; la base refuse hors d\'une session de la console ; le compte du serveur ne lit aucune de ces tables', async () => {
    expect((await appeler('GET', '/console/service/incidents', jS)).statut).toBe(403);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_incidents(now())'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query("select plateforme.console_ouvrir_incident('Un titre', 'mineur', null, null, 'hors console', now())"))).rejects.toThrow(/session de la console/);
    for (const table of ['service_incident', 'service_incident_point', 'service_suite', 'service_maintenance']) {
      await expect(enTantQue(pool, null, (tx) => tx.query(`select * from plateforme.${table}`)), table).rejects.toThrow(/permission/);
    }
  });
});

describe('les travaux et les envois du service (0090, docs/console.md C25)', () => {
  // Les envois se posent sans leur pièce (les liens sont suspendus le temps de l'écriture) : on ne lit ici que ce que la
  // console en dit. Les entreprises sont celles de CE test : la table est partagée avec d'autres.
  async function poser(lignes: { piece: string; ent: string; statut: string; essais: number; motif: unknown; par: string }[]) {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    for (const l of lignes) {
      await admin.query(`insert into ventes.envoi_ttn(piece, entreprise, statut, essais, prochain_essai, depose_le, motif, cree_le, cree_par)
        values ($1, $2, $3, $4, $5, null, $6, $7, $8)`, [l.piece, l.ent, l.statut, l.essais, new Date(horloge.getTime() + 600_000), l.motif, horloge, l.par]);
    }
    await admin.query('commit');
  }
  type Lu = { aRegarder: { cle: string; entreprise: { id: string; nom: string } | null; statut: string; attente: string; motifCle: string | null; motifTexte: string | null }[];
    tours: { nom: string; etat: string; tour: { echec: string | null } | null }[]; branches: { ttn: boolean; courriel: boolean }; sansTrace: string[] };
  const lire = async (j: string) => (await appeler('GET', '/console/service/travaux', j)).corps as Lu;

  it('ce qui reste à regarder : une clé courte prise à la FIN de l\'identifiant, qui attend quoi ; le nom et le motif pour la direction seule', async () => {
    const { ent, proprio } = await entreprise('Atelier Envois');
    const dev = await personne('developpeur');
    const essai = { ent: String((await appeler('POST', '/entreprises-essai', dev.jeton)).corps.id), proprio: dev };
    // Deux pièces nées la même milliseconde (le début d'un uuidv7 est son heure) : deux clés différentes.
    const a = '01a1d000-0000-7000-8000-00000000aaa1', b = '01a1d000-0000-7000-8000-00000000bbb2', c = '01a1d000-0000-7000-8000-00000000ccc3';
    await poser([
      { piece: a, ent, statut: 'deposee', essais: 2, motif: null, par: proprio.id },
      { piece: b, ent, statut: 'a_envoyer', essais: 0, motif: { cle: 'ttn.compte_refuse', valeurs: { message: 'identifiant inconnu' } }, par: proprio.id },
      // Un motif rangé par une version plus ancienne, qui n'est plus au catalogue : la page ne tombe pas pour lui.
      { piece: c, ent, statut: 'refusee', essais: 1, motif: { cle: 'ttn.motif_disparu', valeurs: {} }, par: proprio.id },
      { piece: '01a1d000-0000-7000-8000-00000000ddd4', ent: essai.ent, statut: 'deposee', essais: 3, motif: null, par: essai.proprio.id },
    ]);
    const d = await lire(jD);
    const miens = d.aRegarder.filter((r) => r.entreprise?.id === ent);
    expect(miens.map((r) => r.cle).sort()).toEqual(['0000AAA1', '0000BBB2', '0000CCC3']);
    expect(new Set(miens.map((r) => r.cle)).size).toBe(3);
    const de = (cle: string) => miens.find((r) => r.cle.endsWith(cle));
    expect(de('AAA1')).toMatchObject({ statut: 'deposee', attente: 'seul', motifTexte: null });
    expect(de('BBB2')).toMatchObject({ attente: 'entreprise', motifCle: 'ttn.compte_refuse', entreprise: { nom: 'Atelier Envois' } });
    expect(de('BBB2')?.motifTexte).toMatch(/identifiant inconnu/);
    expect(de('CCC3')).toMatchObject({ statut: 'refusee', attente: 'entreprise', motifCle: 'ttn.motif_disparu', motifTexte: null });
    // Une entreprise d'essai n'envoie rien : elle n'est jamais à regarder.
    expect(d.aRegarder.some((r) => r.entreprise?.id === essai.ent)).toBe(false);
    // La technique (0114) : ni le nom de l'entreprise, ni son identifiant, ni le texte du motif ; la clé de l'envoi lui suffit.
    const t = (await lire(jT)).aRegarder.filter((r) => ['0000AAA1', '0000BBB2', '0000CCC3'].includes(r.cle));
    expect(t).toHaveLength(3);
    expect(t.every((r) => r.entreprise === null && r.motifTexte === null)).toBe(true);
    expect(JSON.stringify(await lire(jT))).not.toContain(ent);
    expect(t.find((r) => r.cle.endsWith('BBB2'))?.motifCle).toBe('ttn.compte_refuse');
  });

  it('les tours se notent par le serveur, leur échec par sa nature seule ; une TTN sans adresse n\'est pas branchée', async () => {
    await noterTour(pool, 'contrats', Date.now() - 50, true, { emises: 2, texte: 'jamais' }, null);
    await noterTour(pool, 'paiements', Date.now(), false, null, 'ECONNREFUSED');
    const d = await lire(jT);
    expect(d.tours.find((x) => x.nom === 'contrats')).toMatchObject({ etat: 'bon' });
    expect(d.tours.find((x) => x.nom === 'paiements')).toMatchObject({ etat: 'echec', tour: { echec: 'ECONNREFUSED' } });
    const brut = (await admin.query("select compte from plateforme.service_tour where nom = 'contrats'")).rows[0].compte;
    expect(brut).toEqual({ emises: 2 });
    expect(d.branches).toEqual({ ttn: false, courriel: false });
    // Le serveur porte toujours le coffre de la TTN, même sans son adresse : ce n'est pas un accès.
    const sansAdresse: Contexte = { ...ctx, ttn: { adresse: null, coffre: Buffer.alloc(32) } };
    const autre = creerApp(sansAdresse, routesConsole(sansAdresse, { veille }));
    await autre.ready();
    try {
      const r = await autre.inject({ method: 'GET', url: `${VERSION}/console/service/travaux`, headers: { authorization: `Bearer ${jT}` } });
      expect((r.json() as Lu).branches.ttn).toBe(false);
    } finally { await autre.close(); }
    expect(d.sansTrace).toEqual(['tej', 'cnss']);
  });

  it('seules la direction et la technique ; la base refuse hors d\'une session de la console ; le compte du serveur ne lit pas les tours', async () => {
    expect((await appeler('GET', '/console/service/travaux', jS)).statut).toBe(403);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_travaux(now())'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, null, (tx) => tx.query('select * from plateforme.service_tour'))).rejects.toThrow(/permission/);
  });
});

describe('la sécurité du service (0091, docs/console.md C26)', () => {
  type Lu = { aRegarder: { sorte: string; id: string; qui: string | null; adresse: string | null; role: string | null; erreurs: number; resolu: boolean | null }[];
    regles: { nom: string; compte: number | null }[]; cles: { id: string; retiree: boolean }[] | null; equipe: { nom: string; role: string; secours: number }[] };
  const lire = async (j: string) => (await appeler('GET', '/console/service/securite', j)).corps as Lu;
  let client: Awaited<ReturnType<typeof personne>>;
  let compte = '';

  beforeAll(async () => {
    client = await personne('securite');
    // Un mot de passe bon puis quatre codes faux ; puis le même compte freiné par sept mots de passe faux.
    await admin.query(`insert into socle.defi_connexion (utilisateur, methode, cree_le, expire_le, erreurs) values ($1, 'sms', $2, $2::timestamptz + interval '10 minutes', 4)`,
      [client.id, horloge]);
    await admin.query(`insert into socle.tentative (cle, erreurs, attente_jusqu_au, derniere) values (lower($1), 7, $2::timestamptz + interval '15 minutes', $2)
      on conflict (cle) do update set erreurs = 7, attente_jusqu_au = excluded.attente_jusqu_au, derniere = excluded.derniere`, [client.email, horloge]);
    compte = String((await admin.query('select md5(lower($1)) h', [client.email])).rows[0].h);
  });

  it('la direction lit le compte en entier ; la technique, une adresse masquée ; un mot de passe connu passe avant un compte freiné', async () => {
    const d = (await lire(jD)).aRegarder.filter((r) => r.adresse === client.email.toLowerCase() || r.qui === client.nom);
    expect(d.map((r) => r.sorte)).toEqual(['code', 'attente']);
    expect(d[0]).toMatchObject({ qui: client.nom, erreurs: 4, resolu: false });
    expect(d[1]).toMatchObject({ id: compte, erreurs: 7 });
    const masque = `${client.email[0]}…@exemple.tn`;
    const t = (await lire(jT)).aRegarder.filter((r) => r.id === compte || r.adresse === masque);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.every((r) => r.qui === null && r.adresse === masque)).toBe(true);
    // L'équipe se nomme pour tous : la technique lit qui de l'équipe a un code, des appareils, des codes de secours.
    expect((await lire(jT)).equipe.map((m) => m.nom)).toEqual(expect.arrayContaining([direction.nom, technique.nom]));
  });

  it('les règles disent leur compte quand la base le garde ; les clés de commande, leur nom seul', async () => {
    const d = await lire(jT);
    expect(d.regles.map((r) => r.nom)).toEqual(['mot_de_passe', 'sans_session', 'sms', 'api', 'appareil', 'session']);
    expect(d.regles.find((r) => r.nom === 'mot_de_passe')?.compte).toBeGreaterThanOrEqual(1);
    expect(d.regles.filter((r) => r.nom !== 'mot_de_passe').every((r) => r.compte === null)).toBe(true);
    expect(d.cles?.length).toBeGreaterThan(0);
    expect(JSON.stringify(d.cles)).not.toMatch(/PUBLIC KEY|publique/);
  });

  it('lever une attente : son motif, une fois, au journal sans l\'adresse ; le support ne lit ni ne lève', async () => {
    expect((await appeler('GET', '/console/service/securite', jS)).statut).toBe(403);
    expect((await appeler('POST', `/console/service/securite/attentes/${compte}/lever`, jS, { motif: 'elle a appelé' })).statut).toBe(403);
    expect((await appeler('POST', '/console/service/securite/attentes/pas-une-empreinte/lever', jT, { motif: 'elle a appelé' })).statut).toBe(404);
    expect((await appeler('POST', `/console/service/securite/attentes/${compte}/lever`, jT, { motif: 'ok' })).statut).toBe(400);
    expect((await appeler('POST', `/console/service/securite/attentes/${compte}/lever`, jT, { motif: 'elle a appelé, numéro de sa fiche' })).statut).toBe(200);
    expect((await admin.query('select count(*)::int n from socle.tentative where cle = lower($1)', [client.email])).rows[0].n).toBe(0);
    const geste = (await admin.query("select geste, motif, avant, apres from plateforme.geste_console where geste = 'service.lever_attente' and qui = $1 order by le desc limit 1", [technique.id])).rows[0];
    expect(geste).toMatchObject({ motif: 'elle a appelé, numéro de sa fiche', avant: { compte, erreurs: 7 } });
    expect(JSON.stringify(geste)).not.toContain(client.email.toLowerCase());
    // Une seconde fois : il n'y a plus rien à lever, et la phrase le dit.
    const r = await appeler('POST', `/console/service/securite/attentes/${compte}/lever`, jT, { motif: 'encore elle' });
    // Un refus de la base (socle.refus) répond 403, avec sa phrase.
    expect(r.statut).toBe(403);
    expect(String(r.corps.motif)).toMatch(/rien à lever/);
  });

  it('la base refuse hors d\'une session de la console', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_securite(now())'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query("select plateforme.console_lever_attente('x', 'hors console', now())"))).rejects.toThrow(/session de la console/);
  });
});

describe('les versions du service (0092, docs/console.md C27)', () => {
  const sha = (c: string) => c.repeat(40).slice(0, 40);
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(sha) as [string, string, string, string];
  const etat = path.join(path.dirname(veille), 'public', 'etat.json');
  const consignes = async () => JSON.parse(String((await admin.query('select plateforme.suiveur_consignes()::text j')).rows[0].j)) as { gel: unknown; retenues: string[]; retour: { id: string; version: string } | null };

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(etat), { recursive: true });
    fs.writeFileSync(etat, JSON.stringify({
      version: C, installeeLe: horloge.toISOString(), regardeLe: horloge.toISOString(), derniere: D, verification: 'toutes', echec: null, taches: [],
      commits: [{ version: D, titre: 'La suivante', le: horloge.toISOString(), verification: 'vert', preuves: 'en_cours' },
        { version: C, titre: 'En service', le: horloge.toISOString() }, { version: B, titre: 'D\'avant', le: horloge.toISOString() }],
      installations: [{ version: C, debut: horloge.toISOString(), fin: horloge.toISOString(), ok: true, etape: null, retour: false }],
      consignes: null, numeros: { [C]: '1.0.0', [D]: '1.1.0', [B]: 'pas-un-numero' },
    }));
    await admin.query('delete from plateforme.service_consigne');
  });
  afterAll(() => { fs.rmSync(etat, { force: true }); });

  it('la direction et la technique lisent la version en service, la prochaine, la base et la machine ; le support non', async () => {
    expect((await appeler('GET', '/console/service/versions', jS)).statut).toBe(403);
    const r = await appeler('GET', '/console/service/versions', jT);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ suiveur: { version: C, verification: 'toutes' }, prochaine: { version: D, etat: 'attend_preuves' }, titres: { [C]: 'En service' } });
    // Le numéro que chaque version déclare (package.json), relu prudemment : ce qui n'en est pas un ne passe pas.
    expect(r.corps.numeros).toEqual({ [C]: '1.0.0', [D]: '1.1.0' });
    expect((r.corps.migrations as { numero: number }[])[0]?.numero).toBeGreaterThanOrEqual(92);
    expect((r.corps.machine as { node: string; postgres: string | null })).toMatchObject({ node: process.version });
    expect((r.corps.machine as { postgres: string | null }).postgres).toMatch(/^\d+/);
    // Les tâches du dépôt, avec leur titre.
    expect((r.corps.taches as { numero: string; titre: string | null }[]).every((t) => t.titre)).toBe(true);
  });

  it('retenir, geler, revenir : chaque consigne a son motif, entre au journal, et le suiveur la lit', async () => {
    expect((await appeler('POST', '/console/service/versions/retenir', jS, { version: D, motif: 'la remise se trompe' })).statut).toBe(403);
    expect((await appeler('POST', '/console/service/versions/retenir', jT, { version: D, motif: 'ok' })).statut).toBe(400);
    // Retenir la version en service n'a pas de sens : on revient en arrière.
    expect((await appeler('POST', '/console/service/versions/retenir', jT, { version: C, motif: 'elle se trompe' })).corps.champ).toBe('version');
    expect((await appeler('POST', '/console/service/versions/retenir', jT, { version: D, motif: 'la remise se trompe' })).statut).toBe(201);
    expect((await appeler('POST', '/console/service/versions/retenir', jT, { version: D, motif: 'encore' })).statut).toBe(403);
    expect((await consignes()).retenues).toEqual([D]);
    const jusquAu = new Date(horloge.getTime() + 24 * 3_600_000).toISOString();
    expect((await appeler('POST', '/console/service/versions/geler', jD, { jusquAu, motif: 'les déclarations du mois' })).statut).toBe(201);
    expect((await appeler('POST', '/console/service/versions/geler', jD, { jusquAu, motif: 'un second gel' })).statut).toBe(403);
    const trop = new Date(horloge.getTime() + 15 * 86_400_000).toISOString();
    expect((await appeler('POST', '/console/service/versions/geler', jD, { jusquAu: trop, motif: 'trop long' })).statut).toBe(403);
    expect((await consignes()).gel).toMatchObject({ motif: 'les déclarations du mois' });
    // Revenir : à une version que le suiveur connaît, en quittant celle qu'il dit en service.
    expect((await appeler('POST', '/console/service/versions/revenir', jT, { version: A, motif: 'C casse les remises' })).corps.champ).toBe('version');
    expect((await appeler('POST', '/console/service/versions/revenir', jT, { version: B, motif: 'C casse les remises' })).statut).toBe(201);
    expect((await appeler('POST', '/console/service/versions/revenir', jT, { version: B, motif: 'deux fois' })).statut).toBe(403);
    const c = await consignes();
    expect(c.retour?.version).toBe(B);
    expect(c.retenues.sort()).toEqual([C, D].sort());
    // Les gestes de CE fichier : l'écran (tests/web/console-versions.test.ts) écrit les siens, avec ses comptes.
    const gestes = (await admin.query("select geste, motif from plateforme.geste_console where geste like 'versions.%' and qui = any($1) order by le, id",
      [[direction.id, technique.id]])).rows;
    expect(gestes.map((g) => g.geste)).toEqual(['versions.retenir', 'versions.geler', 'versions.revenir']);
    // Le suiveur note le retour fait : il ne le refait pas, et C reste retenue.
    await admin.query('select plateforme.suiveur_noter_retour($1, true, $2)', [c.retour?.id, 'installee']);
    expect((await consignes()).retour).toBeNull();
    expect((await consignes()).retenues).toContain(C);
  });

  it('lever une consigne : son motif, au journal ; une consigne levée ne se lève plus', async () => {
    const lu = (await appeler('GET', '/console/service/versions', jD)).corps.consignes as { id: string; sorte: string; enVigueur: boolean }[];
    const gel = lu.find((x) => x.sorte === 'gel' && x.enVigueur);
    expect(gel).toBeTruthy();
    expect((await appeler('POST', `/console/service/versions/consignes/${gel?.id}/lever`, jD, { motif: 'les déclarations sont parties' })).statut).toBe(200);
    expect((await consignes()).gel).toBeNull();
    expect((await appeler('POST', `/console/service/versions/consignes/${gel?.id}/lever`, jD, { motif: 'encore' })).statut).toBe(403);
    expect((await appeler('POST', '/console/service/versions/consignes/pas-un-id/lever', jD, { motif: 'encore' })).statut).toBe(404);
    expect((await admin.query("select count(*)::int n from plateforme.geste_console where geste = 'versions.lever' and qui = any($1)",
      [[direction.id, technique.id]])).rows[0].n).toBe(1);
  });

  it('le serveur ne lit pas les consignes du suiveur, et la base refuse hors d\'une session de la console', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.suiveur_consignes()'))).rejects.toThrow(/permission/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_service_versions(now())'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query(`select plateforme.console_versions_retenir('${D}', 'hors console', now())`))).rejects.toThrow(/session de la console/);
  });
});

describe('les réglages de la plateforme (0093, docs/console.md C28)', () => {
  const jour = () => aujourdhuiATunis(horloge);
  let regle = '';
  beforeAll(async () => {
    regle = String((await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      values ('essai.reglages', '1000', '2023-01-01', 'Une source d''essai : à vérifier avec un comptable') returning id`)).rows[0]?.id);
    await admin.query('delete from plateforme.message_clients');
  });
  const registreDe = async (jeton: string) => ((await appeler('GET', '/console/reglages', jeton)).corps.registre as
    { id: string; code: string; aRelire: boolean; enVigueur: boolean; relectures: Record<string, unknown>[] }[]).find((r) => r.id === regle);

  it('la direction et le support lisent la grille, le registre et le message ; la technique non', async () => {
    expect((await appeler('GET', '/console/reglages', jT)).statut).toBe(403);
    const r = await appeler('GET', '/console/reglages', jS);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ aujourdhui: jour(), role: 'support', message: null, passes: [] });
    // La grille du jour : les deux offres, leurs prix posés en 0082, hors taxes en texte décimal (jamais des millimes).
    expect(r.corps.grille).toEqual([
      expect.objectContaining({ offre: 'essentiel', annuel: { ht: '390.000', depuis: '2026-09-28' }, mensuel: { ht: '39.000', depuis: '2026-09-28' } }),
      expect.objectContaining({ offre: 'complet', annuel: { ht: '690.000', depuis: '2026-09-28' }, mensuel: { ht: '69.000', depuis: '2026-09-28' } }),
    ]);
    // La frise : l'essai et les relances viennent du code qui les applique (serveur/abonnement), jamais d'un chiffre recopié.
    expect(r.corps.essai).toMatchObject({ jours: 30 });
    expect((r.corps.echeance as { grace: number }).grace).toBeGreaterThan(0);
    expect(await registreDe(jS)).toMatchObject({ code: 'essai.reglages', enVigueur: true, aRelire: true, relectures: [] });
  });

  it('noter la relecture d\'une règle : la direction seule, avec son motif ; elle se lit à côté de la règle et ne s\'efface pas', async () => {
    const corps = { reluePar: 'Mehdi Gharbi, cabinet pilote', avis: 'a_corriger', dit: 'Vérifie l\'article cité.', motif: 'relue au téléphone' };
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jS, corps)).statut).toBe(403);
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jD, { ...corps, reluePar: 'MG' })).corps.champ).toBe('reluePar');
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jD, { ...corps, avis: 'peut-être' })).corps.champ).toBe('avis');
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jD, { ...corps, motif: 'ok' })).corps.champ).toBe('motif');
    const inconnue = await appeler('POST', '/console/reglages/regles/01890000-0000-7000-8000-000000000000/relire', jD, corps);
    expect(inconnue.statut).toBe(403);
    expect(inconnue.corps.motif).toMatch(/n'est pas au registre/);
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jD, corps)).statut).toBe(201);
    expect(await registreDe(jD)).toMatchObject({ aRelire: true, relectures: [{ reluePar: corps.reluePar, avis: 'a_corriger', dit: corps.dit, motif: corps.motif, par: direction.nom }] });
    // Relue juste ensuite : la plus récente décide, elle n'est plus à relire ; la précédente reste.
    expect((await appeler('POST', `/console/reglages/regles/${regle}/relire`, jD, { ...corps, avis: 'juste', dit: null, motif: 'corrigée et relue' })).statut).toBe(201);
    const lu = await registreDe(jD);
    expect(lu?.aRelire).toBe(false);
    expect(lu?.relectures.map((l) => l.avis)).toEqual(['juste', 'a_corriger']);
    await expect(admin.query('delete from plateforme.relecture_regle')).rejects.toThrow(/ne se modifie pas/);
    await expect(admin.query('update plateforme.relecture_regle set avis = \'juste\'')).rejects.toThrow(/ne se modifie pas/);
    // Au journal : la règle par son code, et l'avis.
    const journal = (await appeler('GET', '/console/journal', jD)).corps.lignes as { geste: string; motif: string; reglages?: Record<string, unknown> }[];
    expect(journal.find((l) => l.geste === 'reglages.relire' && l.motif === 'relue au téléphone')?.reglages)
      .toEqual({ regle: 'essai.reglages', reluePar: corps.reluePar, avis: 'a_corriger', du: null, au: null, prix: null, preavis: null, regleAbonnement: null, contenu: null, remise: null, nouveaute: null });
  });

  it('un message aux clients : la direction l\'écrit, daté, trente jours au plus ; chaque refus nomme sa raison', async () => {
    const j = jour();
    const corps = { sorte: 'nouveaute', texte: 'La relance automatique des devis arrive.', du: j, au: plusJours(j, 7), motif: 'annonce de la relance' };
    const refus = async (c: Record<string, unknown>) => (await appeler('POST', '/console/reglages/messages', jD, { ...corps, ...c })).corps;
    expect((await appeler('POST', '/console/reglages/messages', jS, corps)).statut).toBe(403);
    expect((await refus({ texte: 'Court' })).champ).toBe('texte');
    expect((await refus({ sorte: 'incident' })).champ).toBe('sorte');
    expect((await refus({ texte: 'Un <b>message</b> avec une balise' })).motif).toMatch(/sans balise/);
    expect((await refus({ du: plusJours(j, -1) })).motif).toMatch(/ne paraît pas dans le passé/);
    expect((await refus({ au: plusJours(j, -1) })).motif).toMatch(/disparaît après le jour où il paraît/);
    expect((await refus({ au: plusJours(j, 31) })).motif).toMatch(/trente jours au plus/);
    expect((await admin.query('select count(*)::int n from plateforme.message_clients')).rows[0]?.n).toBe(0);
    // Trente jours pile : accepté.
    const r = await appeler('POST', '/console/reglages/messages', jD, { ...corps, au: plusJours(j, 30) });
    expect(r.statut).toBe(201);
    const lu = await appeler('GET', '/console/reglages', jS);
    expect(lu.corps.message).toMatchObject({ id: r.corps.id, sorte: 'nouveaute', texte: corps.texte, du: j, au: plusJours(j, 30), enCours: true, par: direction.nom, motif: corps.motif });
  });

  it('jamais deux à la fois : un nouveau remplace celui qui s\'affiche ou qui attend ; l\'application lit celui du jour, sans qui ni pourquoi', async () => {
    const j = jour();
    const { ent, proprio } = await entreprise('Lit Le Message');
    const lire = async () => (await appeler('GET', `/entreprises/${ent}/message`, proprio.jeton)).corps.message;
    const enCours = (await appeler('GET', '/console/reglages', jD)).corps.message as { id: string };
    expect(await lire()).toEqual({ id: enCours.id, sorte: 'nouveaute', texte: 'La relance automatique des devis arrive.', du: j, au: plusJours(j, 30) });
    // Un autre compte, hors de l'entreprise, ne passe pas par elle.
    const autre = await personne('curieux');
    expect((await appeler('GET', `/entreprises/${ent}/message`, autre.jeton)).statut).toBeGreaterThanOrEqual(403);
    // Une maintenance qui paraîtra dans deux jours : elle remplace tout de suite celle d'aujourd'hui.
    const futur = await appeler('POST', '/console/reglages/messages', jD,
      { sorte: 'maintenance', texte: 'Maintenance dimanche de 22 h à 23 h.', du: plusJours(j, 2), au: plusJours(j, 4), motif: 'la maintenance' });
    expect(futur.statut).toBe(201);
    expect(await lire()).toBeNull();
    const du2 = (await admin.query('select plateforme.message_du_jour($1::date) m', [plusJours(j, 2)])).rows[0]?.m;
    expect(du2).toEqual({ id: futur.corps.id, sorte: 'maintenance', texte: 'Maintenance dimanche de 22 h à 23 h.', du: plusJours(j, 2), au: plusJours(j, 4) });
    // Après son dernier jour, plus rien ; un message fini ne se retire plus.
    expect((await admin.query('select plateforme.message_du_jour($1::date) m', [plusJours(j, 5)])).rows[0]?.m).toBeNull();
    const lu = (await appeler('GET', '/console/reglages', jD)).corps;
    expect(lu.message).toMatchObject({ id: futur.corps.id, enCours: true });
    expect(lu.passes).toEqual([expect.objectContaining({ id: enCours.id, enCours: false, remplace: true, retirePar: direction.nom })]);
    expect((await admin.query('select count(*)::int n from plateforme.message_clients where plateforme.message_en_cours(message_clients, $1::date)', [j])).rows[0]?.n).toBe(1);
  });

  it('retirer le message : la direction, avec son motif, une fois ; un message passé ne se retire pas', async () => {
    const m = (await appeler('GET', '/console/reglages', jD)).corps.message as { id: string; du: string; au: string };
    expect((await appeler('POST', `/console/reglages/messages/${m.id}/retirer`, jS, { motif: 'reportée' })).statut).toBe(403);
    expect((await appeler('POST', `/console/reglages/messages/${m.id}/retirer`, jD, { motif: 'ok' })).corps.champ).toBe('motif');
    expect((await appeler('POST', `/console/reglages/messages/${m.id}/retirer`, jD, { motif: 'maintenance reportée' })).statut).toBe(200);
    const encore = await appeler('POST', `/console/reglages/messages/${m.id}/retirer`, jD, { motif: 'encore une fois' });
    expect(encore.statut).toBe(403);
    expect(encore.corps.motif).toMatch(/n'est plus affiché/);
    expect((await appeler('POST', '/console/reglages/messages/01890000-0000-7000-8000-000000000000/retirer', jD, { motif: 'inconnu' })).corps.motif).toMatch(/n'existe pas/);
    const lu = (await appeler('GET', '/console/reglages', jD)).corps;
    expect(lu.message).toBeNull();
    expect((lu.passes as Record<string, unknown>[])[0]).toMatchObject({ id: m.id, retirePar: direction.nom, retireMotif: 'maintenance reportée', remplace: false });
    // Au journal : trois messages affichés, un retiré, chacun par ses deux jours.
    // Les gestes de CE fichier : l'écran (tests/web/console-reglages.test.ts) écrit les siens, avec ses comptes.
    const gestes = (await admin.query("select geste from plateforme.geste_console where geste like 'reglages.message%' and qui = $1 order by le, id",
      [direction.id])).rows.map((g) => g.geste);
    expect(gestes).toEqual(['reglages.message_affiche', 'reglages.message_affiche', 'reglages.message_retire']);
    const journal = (await appeler('GET', '/console/journal', jD)).corps.lignes as { geste: string; reglages?: Record<string, unknown> }[];
    expect(journal.find((l) => l.geste === 'reglages.message_retire')?.reglages).toMatchObject({ du: m.du, au: m.au });
  });

  it('la base refuse hors d\'une session de la console ; le message du jour se lit sans elle', async () => {
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_reglages(current_date)'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query(`select plateforme.console_relire_regle('${regle}', 'Quelqu''un', 'juste', null, 'hors console', now())`))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_ecrire_message(\'nouveaute\', \'Hors de la console, refusé.\', current_date, current_date, \'hors console\', now(), current_date)'))).rejects.toThrow(/session de la console/);
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.message_du_jour(current_date)'))).resolves.toBeTruthy();
  });
});

describe('les formats officiels (0094, docs/console.md C28)', () => {
  type Format = { code: string; version: string | null; branche: boolean | null; alerte: boolean; chiffres: Record<string, number | string | null> | null };
  const formats = async (jeton = jS) => {
    const r = await appeler('GET', '/console/reglages', jeton);
    expect(r.statut).toBe(200);
    return Object.fromEntries((r.corps.formats as Format[]).map((f) => [f.code, f])) as Record<string, Format>;
  };
  // Des factures électroniques posées par la base comme le serveur les écrit à l'émission (0049 à 0051) : le fichier, sa
  // signature, son envoi à la TTN. Le reste de la pièce n'importe pas ici.
  const soumise = (ent: string) => admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, '_racine', 'company', '{"efacture": true}')
    on conflict (entreprise, collection, cle) do update set contenu = socle.dossier_v10.contenu || excluded.contenu`, [ent]);
  const poser = async (ent: string, uid: string, pieces: { version: string; signee?: boolean; envoi?: { statut: string; retenue?: boolean } }[]) => {
    const tiers = (await admin.query('insert into socle.tiers (entreprise, raison_sociale) values ($1, \'Client des formats\') returning id', [ent])).rows[0].id;
    for (const [i, p] of pieces.entries()) {
      const piece = (await admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, echeance, net_a_payer, cree_par)
        values ($1, 'facture', $2, current_date, current_date, 100, $3) returning id`, [ent, tiers, uid])).rows[0].id;
      await admin.query(`insert into ventes.efacture (piece, entreprise, nom, xml, empreinte, version, ecrit_le, ecrit_par)
        values ($1, $2, $3, '<TEIF/>', $4, $5, now(), $6)`, [piece, ent, `TEIF_${i}.xml`, 'a'.repeat(64), p.version, uid]);
      if (!p.signee) continue;
      const demande = (await admin.query(`insert into ventes.signature_demande (entreprise, pieces, identifiant, session, statut, cree_le, cree_par)
        values ($1, $2, 'essai', 'essai', 'signee', now(), $3) returning id`, [ent, [piece], uid])).rows[0].id;
      await admin.query(`insert into ventes.efacture_signee (piece, entreprise, xml, empreinte, demande, signe_le, signe_par)
        values ($1, $2, '<TEIF/>', $3, $4, now(), $5)`, [piece, ent, 'b'.repeat(64), demande, uid]);
      if (!p.envoi) continue;
      const acceptee = p.envoi.statut === 'acceptee';
      await admin.query(`insert into ventes.envoi_ttn (piece, entreprise, statut, prochain_essai, reference, xml_valide, accepte_le, motif, cree_le, cree_par)
        values ($1, $2, $3, now(), $4, $5, $6, $7, now(), $8)`, [piece, ent, p.envoi.statut, acceptee ? 'REF-ESSAI' : null, acceptee ? '<TEIF/>' : null,
        acceptee ? new Date() : null, p.envoi.retenue ? JSON.stringify({ cle: 'efacture.ttn_sans_compte', valeurs: {} }) : null, uid]);
    }
  };

  it('ce que la plateforme a fait des formats, toutes entreprises mêlées ; une entreprise d\'essai n\'y compte pas', async () => {
    // Des comptes : d'autres fichiers de tests écrivent des factures électroniques dans la même base. On lit l'écart.
    const avant = await formats();
    const { ent, proprio } = await entreprise('Formats Une');
    await soumise(ent);
    await poser(ent, proprio.id, [
      { version: versionTeif(), signee: true, envoi: { statut: 'acceptee' } },
      { version: versionTeif(), signee: true, envoi: { statut: 'a_envoyer', retenue: true } },
      { version: versionTeif(), signee: true },
      // Un fichier écrit sous une version d'avant : il reste tel quel, et se compte à part.
      { version: '1.0.0' },
    ]);
    // Le bac à sable d'un développeur : soumis, signé, refusé par la TTN — rien de tout cela ne compte.
    const dev = await personne('developpeur');
    const essai = String((await appeler('POST', '/entreprises-essai', dev.jeton)).corps.id);
    await soumise(essai);
    await poser(essai, dev.id, [{ version: versionTeif(), signee: true, envoi: { statut: 'refusee' } }, { version: versionTeif() }]);
    const apres = await formats();
    const ecart = (code: string, k: string) => Number(apres[code]?.chiffres?.[k]) - Number(avant[code]?.chiffres?.[k]);
    expect(apres.teif).toMatchObject({ version: versionTeif(), branche: null, alerte: avant.teif?.alerte });
    expect(['fichiers', 'entreprises', 'soumises', 'autres'].map((k) => ecart('teif', k))).toEqual([4, 1, 1, 1]);
    expect(apres.teif?.chiffres?.dernier).toBeTruthy();
    expect(['signees', 'aSigner'].map((k) => ecart('signature', k))).toEqual([3, 1]);
    expect(['acceptees', 'retenues', 'sansEnvoi', 'refusees', 'enRoute', 'deposees'].map((k) => ecart('ttn', k))).toEqual([1, 1, 1, 0, 0, 0]);
    // Une pièce retenue demande un geste chez le client : la ligne de la TTN le dit. Ce serveur n'a ni l'adresse de la TTN
    // ni celle de DigiGo : les deux le disent, leurs pièces attendent.
    expect(apres.ttn).toMatchObject({ alerte: true, branche: false });
    expect(apres.signature?.branche).toBe(false);
    expect(apres.ttn?.chiffres?.derniereAcceptee).toBeTruthy();
  });

  it('la technique ne lit pas les formats, ni par la route ni dans la base ; hors d\'une session de la console, personne', async () => {
    expect((await appeler('GET', '/console/reglages', jT)).statut).toBe(403);
    expect((await formats(jD)).ttn).toBeTruthy();
    // La base revérifie le rôle elle-même : dans la vraie session de la console de chacun.
    const dans = async (jeton: string, qui: string) => {
      const qc = await quiEstConsole(ctx, jeton);
      return enTantQue(pool, qui, async (tx) => {
        await tx.query('select set_config(\'app.session_console\', $1, true)', [qc?.session]);
        return (await tx.query('select plateforme.console_formats() v')).rows[0]?.v;
      });
    };
    await expect(dans(jT, technique.id)).rejects.toThrow(/ne permet pas ce geste/);
    await expect(dans(jS, support.id)).resolves.toMatchObject({ ttn: expect.any(Object) });
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.console_formats()'))).rejects.toThrow(/session de la console/);
  });
});
