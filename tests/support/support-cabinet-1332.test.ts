// Le support du Cabinet (1.332.0 ; serveur/support/routes.ts ; 0206 ; docs/support.md), par l'API. Joué par Leïla, au
// Cabinet : « Signaler un problème… » montrait un rapport de l'application de bureau et n'envoyait rien. Ce que le serveur
// garantit maintenant :
//   - une personne du cabinet écrit au support depuis le Cabinet : sa demande emporte la version et le NOM de la page,
//     rien d'autre ; le même envoi dans les cinq minutes rend la même demande ;
//   - chacun ne lit que SES demandes, dans le cabinet de la route : ni un collègue, ni un autre cabinet de la même
//     personne, ni quelqu'un hors du cabinet ;
//   - la console la lit comme celle d'une entreprise, dit qu'elle vient d'un cabinet (son nom), et y répond ;
//   - la personne lit la réponse dans le Cabinet (ce qui attend, « lu »), y répond, dit que c'est réglé, la rouvre ;
//   - l'alerte par e-mail part à une personne encore dans le cabinet, et à elle seule ;
//   - les demandes des entreprises ne changent pas.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
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
let support: Console;

beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille }), ...routesSupport(ctx), ...routesAbonnement(ctx)]);
  await app.ready();
  support = await membre('Karim', 'support');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

type LigneConsole = { id: string; entreprise: { id: string; nom: string; cabinet: boolean } };
async function cabinet(nom: string, associe?: Personne) {
  const p = associe ?? await personne('Leila', true);
  const cab = String((await appeler('POST', '/cabinets', p.jeton, { nom })).corps.id);
  return { cab, p };
}
async function inviter(cab: string, associe: Personne, collegue: Personne) {
  const inv = await appeler('POST', `/cabinets/${cab}/invitations`, associe.jeton, { email: collegue.email, role: 'revision' });
  expect(inv.statut, JSON.stringify(inv.corps)).toBe(201);
  expect((await appeler('POST', '/invitations/accepter', collegue.jeton, { jeton: String(inv.corps.jeton) })).statut).toBe(200);
}
const ecrireCab = (cab: string, p: Personne, corps: Record<string, unknown>) => appeler('POST', `/cabinets/${cab}/support`, p.jeton, corps);
const mesCab = async (cab: string, p: Personne) => (await appeler('GET', `/cabinets/${cab}/support`, p.jeton)).corps.demandes;
const attenteCab = async (cab: string, p: Personne) => (await appeler('GET', `/cabinets/${cab}/support/attente`, p.jeton)).corps;
const ligneConsole = async (m: Console, id: string) => ((await voir(m)).ouvertes as unknown as LigneConsole[]).find((x) => x.id === id);

describe('le Cabinet écrit au support, et lit la réponse dans le Cabinet', () => {
  it('la demande emporte sa version et le nom de sa page ; la console dit qu\'elle vient d\'un cabinet', async () => {
    const { cab, p } = await cabinet('Cabinet Ennour');
    const d = await ecrireCab(cab, p, { sujet: '  La balance ne tombe pas juste  ', texte: '  Sur le dossier du garage, la balance du mois a un écart.  ', version: '1.332.0', page: 'dossier' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    // Un double clic : la même demande, pas une seconde.
    expect((await ecrireCab(cab, p, { sujet: 'La balance ne tombe pas juste', texte: 'Sur le dossier du garage, la balance du mois a un écart.', version: '1.332.0', page: 'dossier' })).corps.id).toBe(d.corps.id);
    const lues = await mesCab(cab, p);
    expect(lues.map((x) => [x.sujet, x.canal, x.nonLu, x.dernierCote, x.closeLe])).toEqual([['La balance ne tombe pas juste', 'application', false, 'client', null]]);
    expect(lues[0]?.messages.map((m) => [m.cote, m.texte, m.note])).toEqual([['client', 'Sur le dossier du garage, la balance du mois a un écart.', false]]);
    expect(await attenteCab(cab, p)).toEqual({ demandes: 1, aLire: [] });
    // Un champ de plus (un client, un dossier) : refusé. Rien d'autre que le sujet, le texte, la version et la page.
    expect((await ecrireCab(cab, p, { sujet: 'Un sujet', texte: 'Ça ne marche pas.', dossier: 'Garage Atlas' })).statut).toBe(400);
    expect((await ecrireCab(cab, p, { sujet: 'Un sujet', texte: 'Ça ne marche pas.', page: '#/dossier/123' })).statut).toBe(400);

    // La console : la demande, sa personne, sa version et sa page ; le cabinet nommé, et pas de fiche client.
    const v = await voir(support, `?demande=${d.corps.id}`);
    expect(v.demande?.version).toBe('1.332.0');
    expect(v.demande?.page).toBe('dossier');
    expect(v.demande?.personne.nom).toBe(p.nom);
    expect(v.demande?.personne.email).toBe(p.email);
    expect(v.demande?.personne.roles.length).toBeGreaterThan(0);
    expect(v.client).toBeNull();
    expect((await ligneConsole(support, d.corps.id))?.entreprise).toMatchObject({ id: cab, nom: 'Cabinet Ennour', cabinet: true });
    // L'Aide proposée est celle que lit le cabinet : « La tenue » pour la page d'un dossier, aucun article de l'entreprise.
    expect(v.demande?.suggestions[0]).toBe('tenue');
    const ids = v.articles.map((a) => a.id);
    expect(ids).toContain('banque');
    expect(ids).not.toContain('fiscal');
    // Ni ceux que le Cabinet en ligne n'affiche pas (le bureau : les sauvegardes, changer d'ordinateur, la licence, les mises à jour).
    for (const absent of ['filets', 'demenager', 'licence', 'maj']) expect(ids, absent).not.toContain(absent);
    expect((await appeler('POST', `/console/support/demandes/${d.corps.id}/repondre`, support.jeton, { texte: 'Voir cet article.', article: 'filets' })).statut).toBe(400);
    // Répondre en citant un article de l'Aide de l'entreprise : refusé (chez le cabinet, un lien vers rien).
    const refus = await appeler('POST', `/console/support/demandes/${d.corps.id}/repondre`, support.jeton, { texte: 'Voir l\'article sur la TVA.', article: 'fiscal' });
    expect(refus.statut).toBe(400);
    expect(refus.corps.champ).toBe('article');
    expect((await appeler('POST', `/console/support/demandes/${d.corps.id}/repondre`, support.jeton, { texte: 'Le rapprochement se règle dans la Banque du dossier.', article: 'banque' })).statut).toBe(201);
    expect((await mesCab(cab, p))[0]?.messages.at(-1)).toMatchObject({ cote: 'equipe', article: 'banque' });
  });

  it('l\'équipe répond ; la personne le lit, y répond, dit que c\'est réglé, et la rouvre en réécrivant', async () => {
    const { cab, p } = await cabinet('Cabinet Ksar');
    const id = (await ecrireCab(cab, p, { sujet: 'Lettrer un acompte', texte: 'Comment lettrer un acompte reçu avant la facture ?', page: 'aide' })).corps.id;
    const r = await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Lettre l\'acompte avec la facture une fois émise, dans le lettrage du 411.', article: null });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const [d] = await mesCab(cab, p);
    expect(d?.nonLu).toBe(true);
    expect(d?.messages.at(-1)).toMatchObject({ cote: 'equipe', nom: 'Karim' });
    expect(await attenteCab(cab, p)).toEqual({ demandes: 1, aLire: [{ id, numero: d?.numero, sujet: 'Lettrer un acompte' }] });
    expect((await appeler('POST', `/cabinets/${cab}/support/${id}/lu`, p.jeton)).statut).toBe(200);
    expect(await attenteCab(cab, p)).toEqual({ demandes: 1, aLire: [] });
    expect((await appeler('POST', `/cabinets/${cab}/support/${id}/messages`, p.jeton, { texte: 'Merci, c\'est fait.' })).statut).toBe(201);
    expect((await voir(support)).ouvertes.find((x) => x.id === id)?.etat.etat).toBe('a_repondre');
    expect((await appeler('POST', `/cabinets/${cab}/support/${id}/reglee`, p.jeton)).statut).toBe(200);
    expect((await mesCab(cab, p))[0]).toMatchObject({ closeCote: 'client' });
    // Réécrire la rouvre, avec tout ce qui s'est déjà dit.
    expect((await appeler('POST', `/cabinets/${cab}/support/${id}/messages`, p.jeton, { texte: 'Une dernière question sur ce point.' })).statut).toBe(201);
    const rouverte = (await mesCab(cab, p))[0];
    expect(rouverte?.closeLe).toBeNull();
    expect(rouverte?.messages.length).toBe(4);
  });
});

describe('chacun ses demandes, au Cabinet', () => {
  it('ni un collègue du cabinet, ni un autre cabinet de la même personne, ni quelqu\'un hors du cabinet', async () => {
    const { cab, p } = await cabinet('Cabinet Médina');
    const id = (await ecrireCab(cab, p, { sujet: 'Un export', texte: 'L\'export des écritures est vide.' })).corps.id;
    const collegue = await personne('Walid');
    await inviter(cab, p, collegue);
    // Le collègue écrit au support ; il ne lit pas la demande de Leïla et n'y touche pas.
    expect(await mesCab(cab, collegue)).toEqual([]);
    expect(await attenteCab(cab, collegue)).toEqual({ demandes: 0, aLire: [] });
    for (const geste of ['messages', 'lu', 'reglee']) {
      const r = await appeler('POST', `/cabinets/${cab}/support/${id}/${geste}`, collegue.jeton, geste === 'messages' ? { texte: 'Intrus' } : undefined);
      expect(r.statut, geste).toBe(403);
      expect(r.corps.motif).toMatch(/n'existe pas, ou n'est pas la tienne/);
    }
    expect((await ecrireCab(cab, collegue, { sujet: 'Ma question', texte: 'Où se règle la grille de saisie ?' })).statut).toBe(201);
    expect((await mesCab(cab, collegue)).map((x) => x.sujet)).toEqual(['Ma question']);
    // Leïla, dans un second cabinet : ses demandes du premier n'y sont pas, et ne s'y touchent pas.
    const second = await cabinet('Cabinet Leïla Bis', p);
    expect(await mesCab(second.cab, p)).toEqual([]);
    expect((await appeler('POST', `/cabinets/${second.cab}/support/${id}/messages`, p.jeton, { texte: 'Par l\'autre porte' })).statut).toBe(403);
    // Quelqu'un hors du cabinet : ni lire, ni écrire.
    const dehors = await personne('Sonia');
    expect([403, 404]).toContain((await appeler('GET', `/cabinets/${cab}/support`, dehors.jeton)).statut);
    expect([403, 404]).toContain((await ecrireCab(cab, dehors, { sujet: 'Bonjour', texte: 'Je passe par là.' })).statut);
    // Un collègue qui a quitté le cabinet : plus rien.
    await admin.query('update socle.membre set actif = false where utilisateur = $1 and organisation = $2', [collegue.id, cab]);
    expect([403, 404]).toContain((await appeler('GET', `/cabinets/${cab}/support`, collegue.jeton)).statut);
  });

  it('les demandes d\'une entreprise ne changent pas : la console les lit sans le drapeau du cabinet', async () => {
    const { ent, p } = await entreprise('Menuiserie Kairouan');
    const id = (await ecrire(ent, p, { sujet: 'Un devis', texte: 'Le devis ne s\'imprime pas.', page: 'devis' })).corps.id;
    expect((await ligneConsole(support, id))?.entreprise).toMatchObject({ id: ent, nom: 'Menuiserie Kairouan', cabinet: false });
    expect((await voir(support, `?demande=${id}`)).client?.nom).toBe('Menuiserie Kairouan');
  });
});

describe('l\'alerte par e-mail d\'une réponse, au Cabinet', () => {
  it('part une fois à la personne encore dans le cabinet, et plus quand elle l\'a quitté', async () => {
    const { cab, p } = await cabinet('Cabinet Sousse');
    const id = (await ecrireCab(cab, p, { sujet: 'Une question', texte: 'Comment ouvrir l\'exercice suivant ?' })).corps.id;
    const t0 = new Date();
    horloge = t0;
    try {
      await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Depuis l\'onglet Exercice : Ouvrir 2027.', article: null });
      const partis = await partisChez(p.email, new Date(t0.getTime() + 6 * 60_000));
      expect(partis).toHaveLength(1);
      expect(partis[0]?.objet).toBe('Le support de SkanFact t\'a répondu');
      for (const mot of ['Ouvrir 2027', 'Cabinet Sousse', 'exercice suivant']) expect(JSON.stringify(partis[0])).not.toContain(mot);
      expect(await partisChez(p.email, new Date(t0.getTime() + 8 * 60_000))).toEqual([]);
      // Partie du cabinet : la réponse suivante ne la prévient plus.
      horloge = new Date(t0.getTime() + 9 * 60_000);
      await appeler('POST', `/console/support/demandes/${id}/repondre`, support.jeton, { texte: 'Je reste joignable.', article: null });
      await admin.query('update socle.membre set actif = false where utilisateur = $1 and organisation = $2', [p.id, cab]);
      expect(await partisChez(p.email, new Date(t0.getTime() + 15 * 60_000))).toEqual([]);
      await admin.query('update socle.membre set actif = true where utilisateur = $1 and organisation = $2', [p.id, cab]);
      expect(await partisChez(p.email, new Date(t0.getTime() + 16 * 60_000))).toHaveLength(1);
    } finally { horloge = new Date(); }
  });
});
