// Le support de SkanFact (Support S1 ; serveur/support, serveur/console ; 0095 ; docs/support.md), par l'API. Ce que le
// serveur garantit :
//   - une personne de l'entreprise écrit au support depuis son application : sa demande emporte la version de
//     l'application et le NOM de sa page, rien d'autre ; le même envoi dans les cinq minutes rend la même demande ;
//   - chacun ne lit que SES demandes, dans l'entreprise de la route : ni un collègue, ni la voisine, ni une autre
//     entreprise de la même personne ;
//   - l'équipe (direction, support) lit toutes les demandes, y répond en citant un article de l'Aide, note une demande
//     reçue ailleurs, clôt et rouvre avec un motif ; la technique ne lit rien ; chaque geste entre au journal de la
//     console, sans le texte des messages ;
//   - la personne lit la réponse dans l'application (ce qui attend, « lu »), y répond, dit que c'est réglé ; y réécrire
//     la rouvre ;
//   - l'alerte par e-mail ne porte rien de la réponse, part une fois cinq minutes après, à une adresse vérifiée d'une
//     personne encore dans l'entreprise ;
//   - une entreprise en lecture seule écrit quand même au support.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesSupport } from '../../serveur/support/gestes.ts';
import { prevenirDesReponses } from '../../serveur/support/postier.ts';
import { routesSupport } from '../../serveur/support/routes.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
// Le postier a son relais d'e-mails, qui garde ce qu'il reçoit.
const envoyes: Courriel[] = [];
const ctxPostier: Contexte = { ...ctx, courriel: { envoi: { envoyer: async (c) => { envoyes.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'support-')), 'veille.json');
let app: FastifyInstance;
const aujourdhui = aujourdhuiATunis();

type Message = { id: string; cote: string; texte: string; article: string | null; nom: string; note: boolean };
type Demande = { id: string; numero: number; sujet: string; canal: string; closeLe: string | null; closeCote: string | null; nonLu: boolean; dernierCote: string; messages: Message[] };
type Corps = Record<string, unknown> & { id: string; motif: string; demandes: Demande[] };
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
// Un membre de l'équipe SkanFact : son compte, son code d'application, son rôle (posé par l'outil de l'exploitation).
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `equipe-${prenom.toLowerCase()}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const qui = await quiEst(ctx, String(c.corps.jeton));
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { jeton: String(k.corps.jeton), prenom };
}
const ecrire = (ent: string, p: Personne, corps: Record<string, unknown>) => appeler('POST', `/entreprises/${ent}/support`, p.jeton, corps);
const mes = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/support`, p.jeton)).corps.demandes;
const attente = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/support/attente`, p.jeton)).corps;
type Console = { jeton: string };
const voir = async (m: Console, q = '') => (await appeler('GET', `/console/support${q}`, m.jeton)).corps as unknown as {
  comptes: { ouvertes: number; aRepondre: number; sansReponse: number }; ouvertes: { id: string; etat: { etat: string } }[];
  closes: { id: string; etat: { etat: string; cote?: string } }[];
  demande: { version: string | null; page: string | null; personne: { nom: string; email: string; roles: string[] }; suggestions: string[]; messages: { cote: string; texte: string; notePar: string | null }[]; etat: { etat: string } } | null;
  client: { id: string; nom: string } | null; articles: { id: string }[];
};
// Les e-mails partis à UNE adresse pendant un tour du postier : d'autres fichiers de tests partagent la base, le total du
// tour n'est pas à nous.
async function partisChez(email: string, a: Date) {
  envoyes.length = 0;
  await prevenirDesReponses(ctxPostier, a);
  return envoyes.filter((m) => m.a === email);
}
const journal = async (ent: string) => (await admin.query('select geste, motif, avant, apres from plateforme.geste_console where entreprise = $1 order by le, id', [ent])).rows as
  { geste: string; motif: string; avant: unknown; apres: unknown }[];

let direction: Console;
let support: Console;
let technique: Console;

beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille }), ...routesSupport(ctx), ...routesAbonnement(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  technique = await membre('Sami', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('écrire au support, et lire la réponse dans l\'application', () => {
  it('la demande emporte sa version et le nom de sa page ; le même envoi dans les cinq minutes rend la même demande', async () => {
    const { ent, p } = await entreprise('Menuiserie Ben Salah');
    const d = await ecrire(ent, p, { sujet: '  La facture ne part pas  ', texte: '  Quand je clique sur Émettre, rien ne se passe.  ', version: '1.3.0+abc1234', page: 'factures' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    // Un double clic, un envoi qui a semblé échouer : la même demande, pas une seconde.
    const encore = await ecrire(ent, p, { sujet: 'La facture ne part pas', texte: 'Quand je clique sur Émettre, rien ne se passe.', version: '1.3.0+abc1234', page: 'factures' });
    expect(encore.corps.id).toBe(d.corps.id);
    const lues = await mes(ent, p);
    expect(lues.map((x) => [x.sujet, x.canal, x.nonLu, x.dernierCote, x.closeLe])).toEqual([['La facture ne part pas', 'application', false, 'client', null]]);
    expect(lues[0]?.messages.map((m) => [m.cote, m.texte, m.note])).toEqual([['client', 'Quand je clique sur Émettre, rien ne se passe.', false]]);
    expect(await attente(ent, p)).toEqual({ demandes: 1, aLire: [] });
    // Six minutes plus tard, le même texte ouvre une seconde demande : ce n'est plus un double envoi.
    horloge = new Date(Date.now() + 6 * 60_000);
    try {
      const autre = await ecrire(ent, p, { sujet: 'La facture ne part pas', texte: 'Quand je clique sur Émettre, rien ne se passe.' });
      expect(autre.corps.id).not.toBe(d.corps.id);
    } finally { horloge = new Date(); }

    // La console lit la demande : sa version, sa page, la personne (nom, adresse, rôles), et les articles de l'Aide qui
    // y répondent, celui de la page d'abord.
    const v = await voir(support, `?demande=${d.corps.id}`);
    expect(v.demande?.version).toBe('1.3.0+abc1234');
    expect(v.demande?.page).toBe('factures');
    expect(v.demande?.personne).toEqual({ nom: p.nom, email: p.email, roles: ['proprietaire'] });
    expect(v.demande?.etat.etat).toBe('nouvelle');
    expect(v.demande?.suggestions[0]).toBe('facture');
    expect(v.client?.nom).toBe('Menuiserie Ben Salah');
    expect(v.articles.length).toBeGreaterThan(20);
  });

  it('un champ hors des bornes est refusé en le nommant ; ce qui part n\'est jamais qu\'un nom de page et une version', async () => {
    const { ent, p } = await entreprise('Boulangerie Ennour');
    expect((await ecrire(ent, p, { sujet: 'ab', texte: 'Ça ne marche pas.' })).statut).toBe(400);
    expect((await ecrire(ent, p, { sujet: 'Une <b>balise</b>', texte: 'Ça ne marche pas.' })).statut).toBe(400);
    expect((await ecrire(ent, p, { sujet: 'Un sujet', texte: 'x' })).statut).toBe(400);
    expect((await ecrire(ent, p, { sujet: 'Un sujet', texte: 'x'.repeat(4001) })).statut).toBe(400);
    // Une page qui n'est pas un nom de page, une version qui n'en est pas une, un champ de plus : refusés.
    expect((await ecrire(ent, p, { sujet: 'Un sujet', texte: 'Ça ne marche pas.', page: '#/doc/1234' })).statut).toBe(400);
    expect((await ecrire(ent, p, { sujet: 'Un sujet', texte: 'Ça ne marche pas.', version: '1.3.0 <script>' })).statut).toBe(400);
    expect((await ecrire(ent, p, { sujet: 'Un sujet', texte: 'Ça ne marche pas.', client: 'Société Atlas' })).statut).toBe(400);
    expect(await mes(ent, p)).toEqual([]);
  });

  it('l\'équipe répond en citant un article de l\'Aide ; la personne le lit, y répond, dit que c\'est réglé, et la rouvre en réécrivant', async () => {
    const { ent, p } = await entreprise('Garage Atlas');
    const id = (await ecrire(ent, p, { sujet: 'Où est la TVA ?', texte: 'Je ne trouve pas la déclaration de TVA du mois.', page: 'compta' })).corps.id;
    // Un article que l'Aide n'a pas est refusé ; une réponse trop courte aussi.
    expect((await appeler('POST', `/console/support/demandes/${id}/repondre`, direction.jeton, { texte: 'Regarde ici.', article: 'nexiste-pas' })).statut).toBe(400);
    expect((await appeler('POST', `/console/support/demandes/${id}/repondre`, direction.jeton, { texte: 'ok', article: null })).statut).toBe(400);
    const r = await appeler('POST', `/console/support/demandes/${id}/repondre`, direction.jeton, { texte: 'Bonjour, elle est dans Comptabilité, onglet TVA.', article: 'fiscal' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    // La personne : une réponse à lire, signée du prénom du membre de l'équipe, avec l'article cité.
    const [d] = await mes(ent, p);
    expect(d?.nonLu).toBe(true);
    expect(d?.dernierCote).toBe('equipe');
    expect(d?.messages.at(-1)).toMatchObject({ cote: 'equipe', texte: 'Bonjour, elle est dans Comptabilité, onglet TVA.', article: 'fiscal', nom: 'Amira' });
    expect(await attente(ent, p)).toEqual({ demandes: 1, aLire: [{ id, numero: d?.numero, sujet: 'Où est la TVA ?' }] });
    expect((await voir(support)).ouvertes.find((x) => x.id === id)?.etat.etat).toBe('attend_client');
    // Lue : plus rien n'attend.
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/lu`, p.jeton)).statut).toBe(200);
    expect(await attente(ent, p)).toEqual({ demandes: 1, aLire: [] });
    // Elle répond : la balle revient à l'équipe.
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/messages`, p.jeton, { texte: 'Trouvée, merci !' })).statut).toBe(201);
    expect((await voir(support)).ouvertes.find((x) => x.id === id)?.etat.etat).toBe('a_repondre');
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/messages`, p.jeton, { texte: '   ' })).statut).toBe(400);
    // « C'est réglé » : close de son côté ; l'équipe ne répond plus à une demande close, et le dit.
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/reglee`, p.jeton)).statut).toBe(200);
    expect((await mes(ent, p))[0]).toMatchObject({ closeCote: 'client' });
    expect((await voir(support)).closes.find((x) => x.id === id)?.etat).toMatchObject({ etat: 'close', cote: 'client' });
    const refus = await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Encore une chose.', article: null });
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toMatch(/close/i);
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/reglee`, p.jeton)).statut).toBe(403);
    // Elle y réécrit : la demande se rouvre, avec tout ce qui s'est déjà dit.
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/messages`, p.jeton, { texte: 'Finalement, le montant me paraît faux.' })).statut).toBe(201);
    const rouverte = (await mes(ent, p))[0];
    expect(rouverte?.closeLe).toBeNull();
    expect(rouverte?.messages).toHaveLength(4);
  });
});

describe('chacun ses demandes', () => {
  it('ni un collègue, ni la voisine, ni une autre entreprise de la même personne ; ni la console à la technique', async () => {
    const { ent, p } = await entreprise('Imprimerie Carthage');
    const id = (await ecrire(ent, p, { sujet: 'Le logo est flou', texte: 'Sur le PDF, mon logo est flou.' })).corps.id;
    // Un collègue de la même entreprise : il écrit au support, il ne lit pas les demandes de Nadia.
    const collegue = await personne('Walid');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, p.jeton, { email: collegue.email, roles: ['administrateur'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', collegue.jeton, { jeton: inv })).statut).toBe(200);
    expect(await mes(ent, collegue)).toEqual([]);
    expect(await attente(ent, collegue)).toEqual({ demandes: 0, aLire: [] });
    for (const geste of ['messages', 'lu', 'reglee']) {
      const r = await appeler('POST', `/entreprises/${ent}/support/${id}/${geste}`, collegue.jeton, geste === 'messages' ? { texte: 'Intrus' } : undefined);
      expect(r.statut, geste).toBe(403);
      expect(r.corps.motif).toMatch(/n'existe pas, ou n'est pas la tienne/);
    }
    // La voisine : la porte ne lui connaît pas cette entreprise.
    const voisine = await entreprise('Voisine SARL');
    expect((await appeler('GET', `/entreprises/${ent}/support`, voisine.p.jeton)).statut).toBe(404);
    expect((await ecrire(ent, voisine.p, { sujet: 'Bonjour', texte: 'Je passe par là.' })).statut).toBe(404);
    // Nadia, dans sa seconde entreprise : ses demandes de la première n'y sont pas, et ne s'y touchent pas.
    const seconde = await entreprise('Nadia Seconde SUARL', p);
    expect(await mes(seconde.ent, p)).toEqual([]);
    expect((await appeler('POST', `/entreprises/${seconde.ent}/support/${id}/messages`, p.jeton, { texte: 'Par l\'autre porte' })).statut).toBe(403);
    // La technique de l'équipe ne lit aucune demande ; la direction et le support, toutes.
    expect((await appeler('GET', '/console/support', technique.jeton)).statut).toBe(403);
    expect((await appeler('POST', `/console/support/demandes/${id}/repondre`, technique.jeton, { texte: 'Je regarde.', article: null })).statut).toBe(403);
    expect((await voir(direction)).ouvertes.some((x) => x.id === id)).toBe(true);
  });
});

describe('ce que l\'équipe note, clôt et rouvre, et ce que le journal en garde', () => {
  it('une demande reçue sur WhatsApp se range au nom d\'une personne de l\'entreprise, qui la lit ; clore et rouvrir demandent un motif', async () => {
    const { ent, p } = await entreprise('Pâtisserie Yasmine');
    const personnes = (await appeler('GET', `/console/support/personnes/${ent}`, support.jeton)).corps.personnes as { id: string; nom: string; roles: string[] }[];
    expect(personnes).toEqual([{ id: p.id, nom: p.nom, roles: ['proprietaire'] }]);
    // Une personne qui n'est pas de cette entreprise : refusé ; un canal « application » ne se note pas.
    const etranger = await personne('Inconnu');
    const refus = await appeler('POST', '/console/support/demandes', support.jeton, { entreprise: ent, demandeur: etranger.id, canal: 'telephone', sujet: 'Une question', texte: 'Il a appelé pour une question.' });
    expect(refus.statut).toBe(403);
    expect((await appeler('POST', '/console/support/demandes', support.jeton, { entreprise: ent, demandeur: p.id, canal: 'application', sujet: 'Une question', texte: 'x x x' })).statut).toBe(400);
    const notee = await appeler('POST', '/console/support/demandes', support.jeton, { entreprise: ent, demandeur: p.id, canal: 'whatsapp', sujet: 'Imprimer un ticket', texte: 'Elle demande sur WhatsApp comment imprimer un ticket de caisse.' });
    expect(notee.statut, JSON.stringify(notee.corps)).toBe(201);
    const id = notee.corps.id;
    // Elle la lit dans son application : reçue sur WhatsApp, ses mots notés par l'équipe.
    const [d] = await mes(ent, p);
    expect(d).toMatchObject({ id, canal: 'whatsapp', nonLu: false });
    expect(d?.messages.map((m) => [m.cote, m.note])).toEqual([['client', true]]);
    expect((await voir(support, `?demande=${id}`)).demande?.messages[0]?.notePar).toBe('Karim Équipe');
    // Clore sans motif : refusé ; avec, close par l'équipe ; rouvrir de même.
    expect((await appeler('POST', `/console/support/demandes/${id}/clore`, support.jeton, { motif: '' })).statut).toBe(400);
    expect((await appeler('POST', `/console/support/demandes/${id}/clore`, support.jeton, { motif: 'Réglé au téléphone' })).statut).toBe(200);
    expect((await mes(ent, p))[0]).toMatchObject({ closeCote: 'equipe' });
    expect((await appeler('POST', `/console/support/demandes/${id}/clore`, support.jeton, { motif: 'Encore une fois' })).statut).toBe(403);
    expect((await appeler('POST', `/console/support/demandes/${id}/rouvrir`, direction.jeton, { motif: 'Elle a rappelé' })).statut).toBe(200);
    expect((await mes(ent, p))[0]?.closeLe).toBeNull();
    // Le journal : chaque geste, avec le sujet ou le motif ; jamais le texte des messages.
    const j = await journal(ent);
    expect(j.map((x) => [x.geste, x.motif])).toEqual([['support.noter', 'Imprimer un ticket'], ['support.clore', 'Réglé au téléphone'], ['support.rouvrir', 'Elle a rappelé']]);
    expect(JSON.stringify(j)).not.toContain('comment imprimer un ticket de caisse');
  });

  it('une entreprise en lecture seule écrit quand même au support : c\'est souvent là qu\'on en a besoin', async () => {
    const { ent, p } = await entreprise('Lecture Seule SARL');
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, plusJours(aujourdhui, -10)]);
    expect((await appeler('GET', `/entreprises/${ent}/abonnement/etat`, p.jeton)).corps.etat).toBe('lecture_seule');
    const r = await ecrire(ent, p, { sujet: 'Mon abonnement', texte: 'Comment je repasse en écriture ?' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect((await appeler('POST', `/entreprises/${ent}/support/${r.corps.id}/messages`, p.jeton, { texte: 'J\'ai payé hier.' })).statut).toBe(201);
  });
});

describe('l\'alerte par e-mail d\'une réponse', () => {
  it('ne porte rien de la réponse, part une fois cinq minutes après, à une adresse vérifiée d\'une personne encore dans l\'entreprise', async () => {
    const p = await personne('Leila', true);
    const { ent } = await entreprise('Opticien Mansour', p);
    const id = (await ecrire(ent, p, { sujet: 'Un client en double', texte: 'Le même client apparaît deux fois.' })).corps.id;
    const t0 = new Date();
    horloge = t0;
    try {
      await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Fusionne-les depuis la fiche du second : Plus, puis Fusionner.', article: null });
      // Moins de cinq minutes : rien (la page ouverte l'aurait marquée lue).
      expect(await partisChez(p.email, new Date(t0.getTime() + 4 * 60_000))).toEqual([]);
      const partis = await partisChez(p.email, new Date(t0.getTime() + 6 * 60_000));
      expect(partis).toHaveLength(1);
      const mail = partis[0];
      expect(mail?.objet).toBe('Le support de SkanFact t\'a répondu');
      expect(mail?.texte).toContain('https://app.exemple.tn/');
      // Rien de la réponse, ni de la demande, ni de l'entreprise.
      for (const secret of ['Fusionne', 'client en double', 'Opticien', 'Karim']) expect(JSON.stringify(mail)).not.toContain(secret);
      // Une fois : le tour suivant ne la renvoie pas.
      expect(await partisChez(p.email, new Date(t0.getTime() + 8 * 60_000))).toEqual([]);
      // Une seconde réponse non lue : une seconde alerte, une seule.
      horloge = new Date(t0.getTime() + 9 * 60_000);
      await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Je reste joignable si besoin.', article: null });
      expect(await partisChez(p.email, new Date(t0.getTime() + 15 * 60_000))).toHaveLength(1);
      // Lue avant les cinq minutes : rien ne part.
      horloge = new Date(t0.getTime() + 16 * 60_000);
      await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Dernière précision.', article: null });
      await appeler('POST', `/entreprises/${ent}/support/${id}/lu`, p.jeton);
      expect(await partisChez(p.email, new Date(t0.getTime() + 25 * 60_000))).toEqual([]);
    } finally { horloge = new Date(); }
  });

  it('une adresse que personne n\'a vérifiée, ou une personne qui a quitté l\'entreprise, ne reçoit rien', async () => {
    const nonVerifiee = await personne('Hela');
    const a = await entreprise('Librairie Hela', nonVerifiee);
    const partie = await personne('Mourad', true);
    const b = await entreprise('Atelier Mourad', partie);
    const collegue = await personne('Ines', true);
    const inv = String((await appeler('POST', `/entreprises/${b.ent}/invitations`, partie.jeton, { email: collegue.email, roles: ['administrateur'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', collegue.jeton, { jeton: inv })).statut).toBe(200);
    const t0 = new Date();
    horloge = t0;
    try {
      const d1 = (await ecrire(a.ent, nonVerifiee, { sujet: 'Une question', texte: 'Comment ajouter un article ?' })).corps.id;
      const d2 = (await ecrire(b.ent, collegue, { sujet: 'Une autre question', texte: 'Comment exporter mes clients ?' })).corps.id;
      for (const d of [d1, d2]) await appeler('POST', `/console/support/demandes/${d}/repondre`, support.jeton, { texte: 'Voici la réponse.', article: null });
      // Ines quitte l'atelier : elle ne lirait plus la réponse, l'alerte ne part pas chez elle.
      await admin.query('update socle.membre set actif = false where utilisateur = $1 and entreprise = $2', [collegue.id, b.ent]);
      expect(await partisChez(nonVerifiee.email, new Date(t0.getTime() + 6 * 60_000))).toEqual([]);
      expect(await partisChez(collegue.email, new Date(t0.getTime() + 7 * 60_000))).toEqual([]);
      // Et la preuve que le tour aurait pu partir : vérifiée et encore là, Ines aurait été prévenue.
      await admin.query('update socle.membre set actif = true where utilisateur = $1 and entreprise = $2', [collegue.id, b.ent]);
      expect(await partisChez(collegue.email, new Date(t0.getTime() + 8 * 60_000))).toHaveLength(1);
    } finally { horloge = new Date(); }
  });
});

describe('l\'attente et la réponse, honnêtes (0124)', () => {
  it('l\'audit C08 : une relance du client ne remet pas l\'attente à zéro ; seule notre réponse le fait', async () => {
    const { ent, p } = await entreprise('Quincaillerie Relance');
    const id = (await ecrire(ent, p, { sujet: 'La facture ne part pas', texte: 'Le bouton Émettre ne fait rien.', page: 'ventes' })).corps.id;
    // Ouverte il y a vingt-six heures, sans réponse.
    // (Un message ne se réécrit pas : le recul se pose déclencheurs suspendus, le temps de l'essai.)
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`update plateforme.message_support set ecrit_le = ecrit_le - interval '26 hours' where demande = $1`, [id]);
    await admin.query(`update plateforme.demande_support set ouverte_le = ouverte_le - interval '26 hours' where id = $1`, [id]);
    await admin.query('commit');
    const etat = async () => (await voir(support)).ouvertes.find((x) => x.id === id)?.etat as { etat: string; heures?: number; sansReponse?: boolean } | undefined;
    expect(await etat()).toMatchObject({ etat: 'nouvelle', heures: 26, sansReponse: true });
    // « Vous avez vu mon message ? » : toujours vingt-six heures, toujours sans réponse.
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/messages`, p.jeton, { texte: 'Vous avez vu mon message ?' })).statut).toBe(201);
    expect(await etat()).toMatchObject({ etat: 'nouvelle', heures: 26, sansReponse: true });
    // Notre réponse remet le cycle à zéro ; sa nouvelle question attend depuis elle.
    expect((await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Bonjour, on regarde tout de suite.', article: null })).statut).toBe(201);
    expect((await etat())?.etat).toBe('attend_client');
    expect((await appeler('POST', `/entreprises/${ent}/support/${id}/messages`, p.jeton, { texte: 'Merci, et pour les avoirs ?' })).statut).toBe(201);
    expect(await etat()).toMatchObject({ etat: 'a_repondre', heures: 0, sansReponse: false });
  });

  it('l\'audit C09 : la même réponse renvoyée (après une coupure, ou deux fois au même moment) ne fait qu\'un message ; une autre en fait un second', async () => {
    const { ent, p } = await entreprise('Imprimerie Coupure');
    const id = (await ecrire(ent, p, { sujet: 'Le logo ne s\'imprime pas', texte: 'Mon logo manque sur la facture.', page: 'ventes' })).corps.id;
    const commande = '0192f3a4-0000-7000-8000-00000000c009';
    const repondre = (texte: string, c: string) => appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte, article: null, commande: c });
    const a = await repondre('Bonjour, ajoute-le dans Ton entreprise.', commande);
    expect(a.statut, JSON.stringify(a.corps)).toBe(201);
    // Renvoyée : la même réponse, rendue telle quelle.
    const b = await repondre('Bonjour, ajoute-le dans Ton entreprise.', commande);
    expect([b.statut, b.corps.id]).toEqual([201, a.corps.id]);
    // Deux fois au même moment, avec une autre commande : une seule réponse de plus.
    const autre = '0192f3a4-0000-7000-8000-00000000c010';
    const [c, d] = await Promise.all([repondre('Et vérifie sa taille.', autre), repondre('Et vérifie sa taille.', autre)]);
    expect([c.statut, d.statut, c.corps.id === d.corps.id]).toEqual([201, 201, true]);
    const equipe = (await admin.query(`select texte from plateforme.message_support where demande = $1 and cote = 'equipe' order by ecrit_le, id`, [id])).rows;
    expect(equipe).toEqual([{ texte: 'Bonjour, ajoute-le dans Ton entreprise.' }, { texte: 'Et vérifie sa taille.' }]);
    expect((await journal(ent)).filter((g) => g.geste === 'support.repondre')).toHaveLength(2);
  });

  it('l\'audit 1.42.0, A07 : la même commande avec un autre texte est refusée (409, la commande) ; rien ne s\'écrit, la première reste seule', async () => {
    const { ent, p } = await entreprise('Imprimerie Modifiée');
    const id = (await ecrire(ent, p, { sujet: 'Le cachet ne s\'imprime pas', texte: 'Mon cachet manque sur le devis.', page: 'ventes' })).corps.id;
    const commande = '0192f3a4-0000-7000-8000-00000000a007';
    const repondre = (texte: string, article: string | null = null) => appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte, article, commande });
    expect((await repondre('Bonjour, ajoute-le dans Ton entreprise.')).statut).toBe(201);
    const autre = await repondre('Bonjour, ajoute-le dans Ton entreprise, onglet Documents.');
    expect([autre.statut, autre.corps.champ, autre.corps.motif]).toEqual([409, 'commande', 'Cette réponse est déjà partie avec un autre texte : relis la conversation, ta modification n\'est pas envoyée.']);
    // Le même texte avec un autre article joint : autre chose aussi.
    expect((await repondre('Bonjour, ajoute-le dans Ton entreprise.', 'fiscal')).statut).toBe(409);
    // Le même texte, le même article : rendu tel quel, comme avant.
    expect((await repondre('Bonjour, ajoute-le dans Ton entreprise.')).statut).toBe(201);
    expect((await admin.query(`select texte from plateforme.message_support where demande = $1 and cote = 'equipe'`, [id])).rows).toEqual([{ texte: 'Bonjour, ajoute-le dans Ton entreprise.' }]);
  });
});
