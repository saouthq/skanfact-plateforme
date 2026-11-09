// (1.334.0) Une pièce déjà demandée ne se redemande pas, et une relance partie dans la conversation se note ainsi, par
// l'API. Relancer deux fois un client pour ses relevés de septembre lui laissait deux demandes ouvertes pour la même pièce ;
// la fiche du dossier refusait le moyen « conversation » (la relance se notait « autre »). Ce que le serveur garantit :
//   - une demande du cabinet dont la pièce est déjà demandée et pas encore reçue (même texte, sans les majuscules ni les
//     espaces autour) ne se crée pas : le message part, la demande ouverte reste la seule, la réponse la nomme (`deja`) ;
//   - reçue, la pièce se redemande ; le fil d'un autre client n'est pas confondu ;
//   - la fiche garde une relance « conversation », et refuse toujours un moyen inconnu.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { routesMessagerie } from '../../serveur/messagerie/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

// Ce que les réponses portent (ce que ces tests en lisent) : une forme pour toutes, chacune n'en a qu'une partie.
type Message = {
  id: string; texte: string; auteur: string; moi: boolean; cote: string; lu: boolean; piece: unknown; repondA: string | null;
  demande: { texte: string; recueLe: string | null; pour?: string | null; enRetard?: boolean; relances?: number; relanceLe?: string | null } | null; fichier: unknown; achat: unknown;
};
type Dossier = { nom: string; etat: string; nonLus: number; attentes: number; retards?: number; dernier: unknown };
type Corps = {
  id: string; ids?: string[]; deja?: string[]; champ?: string; motif: string; jeton: string; code: string; mandat: string; contenu: string; envoyees: number;
  messages: Message[]; questions: { piece: string; montant: string; statut: string; poseePar: string | null; repondueePar: string | null }[]; suite: string | null; anciens: unknown[];
  attente: { nonLus: number; questions: number; demandes: number; enRetard?: number; aLire: boolean }; fil: { actif: boolean; alerte: boolean };
  dossiers: Dossier[]; compteurs: Record<'aTraiter' | 'attendClient' | 'tout', number>;
  modeles: { id: string; titre: string; texte: string }[]; trouves: unknown[];
};
type Reponse = { statut: number; corps: Corps };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string, verifiee = false, nom = prefixe) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  if (verifiee) await admin.query('update socle.utilisateur set adresse_verifiee_le = now() where id = $1', [utilisateur]);
  return { email, jeton, utilisateur };
}
type Personne = Awaited<ReturnType<typeof personne>>;

// Un cabinet (son associé), et un client qui lui confie son entreprise ; `client()` en ajoute d'autres au même cabinet.
async function cabinet(verifiees = false) {
  const associe = await personne('associe', verifiees);
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
  const id = String(c.corps.id);
  const client = async (nom: string) => {
    const p = await personne('client', verifiees, 'Leïla Mansour');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
    const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, p.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${id}/mandats/${mandat}/accepter`, associe.jeton)).statut).toBe(200);
    return { p, ent, mandat };
  };
  const membre = async (role: string, mandat: string | null) => {
    const p = await personne(role);
    const m = String((await admin.query('insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id', [p.utilisateur, id, [role]])).rows[0].id);
    if (mandat) await appeler('PUT', `/cabinets/${id}/mandats/${mandat}/affectations/${m}`, associe.jeton, { role });
    return p;
  };
  return { associe, id, client, membre };
}
const fil = (ent: string, p: Personne, cote: 'entreprise' | 'cabinet', q = '') => appeler('GET', `/entreprises/${ent}/messages?cote=${cote}${q}`, p.jeton);
const ecrire = (ent: string, p: Personne, cote: 'entreprise' | 'cabinet', corps: Record<string, unknown>) => appeler('POST', `/entreprises/${ent}/messages`, p.jeton, { cote, ...corps });

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('(1.334.0) une pièce déjà demandée ne se redemande pas', () => {
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
  it('relancer deux fois : la demande ouverte reste la seule, le message part, la réponse dit laquelle ; reçue, elle se redemande', async () => {
    const cab = await cabinet();
    const { p: client, ent } = await cab.client('Café des Nattes');
    const r1 = await ecrire(ent, cab.associe, 'cabinet', { texte: 'Il me manque vos pièces de septembre.', demandes: ['Vos relevés bancaires de septembre'], pour: jour(2) });
    expect(r1.statut, JSON.stringify(r1.corps)).toBe(201);
    expect(r1.corps.deja).toEqual([]);
    // La seconde relance : la même pièce (autrement écrite : majuscules, espaces autour) et une neuve.
    const r2 = await ecrire(ent, cab.associe, 'cabinet', { texte: 'Je vous relance pour septembre.', demandes: ['  vos relevés bancaires de SEPTEMBRE ', 'La facture STEG de septembre'], pour: jour(4) });
    expect(r2.statut, JSON.stringify(r2.corps)).toBe(201);
    // Le serveur range la pièce telle qu'elle est écrite, sans les espaces autour.
    expect(r2.corps.deja).toEqual(['vos relevés bancaires de SEPTEMBRE']);
    expect(r2.corps.ids).toHaveLength(2);
    const lus = (await fil(ent, client, 'entreprise')).corps.messages;
    expect(lus.filter((m) => m.demande && !m.demande.recueLe).map((m) => m.demande?.texte).sort()).toEqual(['La facture STEG de septembre', 'Vos relevés bancaires de septembre']);
    // Le mot de la seconde relance est parti, sans demande ; la demande ouverte garde sa date.
    expect(lus.find((m) => m.texte === 'Je vous relance pour septembre.')?.demande).toBeNull();
    expect(lus.find((m) => m.demande?.texte === 'Vos relevés bancaires de septembre')?.demande?.pour).toBe(jour(2));
    expect((await fil(ent, client, 'entreprise')).corps.attente.demandes).toBe(2);
    // Une demande seule, déjà ouverte, sans un mot : rien ne part, la réponse le dit.
    const avant = lus.length;
    const r3 = await ecrire(ent, cab.associe, 'cabinet', { demande: 'La facture STEG de septembre' });
    expect(r3.statut, JSON.stringify(r3.corps)).toBe(201);
    expect([r3.corps.ids, r3.corps.deja]).toEqual([[], ['La facture STEG de septembre']]);
    expect((await fil(ent, client, 'entreprise')).corps.messages).toHaveLength(avant);
    // Reçue (le client répond par une pièce de son dossier), elle se redemande : un autre relevé, une autre photo.
    const releves = lus.find((m) => m.demande?.texte === 'Vos relevés bancaires de septembre');
    expect((await ecrire(ent, client, 'entreprise', { piece: { genre: 'achat', id: 'a7', libelle: 'Relevé BIAT de septembre' }, repondA: releves?.id })).statut).toBe(201);
    const r4 = await ecrire(ent, cab.associe, 'cabinet', { demande: 'Vos relevés bancaires de septembre' });
    expect([r4.corps.ids?.length, r4.corps.deja]).toEqual([1, []]);
    // Un autre client du même cabinet : sa demande n'est pas confondue avec celle du café.
    const garage = await cab.client('Garage Ennasr');
    expect((await ecrire(garage.ent, cab.associe, 'cabinet', { demande: 'La facture STEG de septembre' })).corps.deja).toEqual([]);
    // Le client, lui, ne demande rien : la règle ne le touche pas.
    expect((await ecrire(ent, client, 'entreprise', { texte: 'Vos relevés bancaires de septembre' })).corps.deja).toEqual([]);
  });

  it('la fiche du dossier garde une relance partie dans la conversation ; un moyen inconnu reste refusé', async () => {
    const cab = await cabinet();
    const { ent } = await cab.client('Librairie Ennour');
    const relance = { at: Date.UTC(2026, 9, 29, 9), via: 'conversation', months: ['2026-09'], note: 'Relance envoyée dans la conversation SkanFact' };
    const poser = (contenu: unknown, revision: number | null) => appeler('PUT', `/cabinets/${cab.id}/fiches/${ent}`, cab.associe.jeton, { contenu, revision });
    expect((await poser({ relances: [{ ...relance, via: 'pigeon' }] }, null)).statut).toBe(400);
    const r = await poser({ relances: [relance] }, null);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const fiches = (await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps as unknown as { fiches: { entreprise: string; contenu: unknown }[] };
    expect(fiches.fiches.find((f) => f.entreprise === ent)?.contenu).toEqual({ relances: [relance] });
  });
});
