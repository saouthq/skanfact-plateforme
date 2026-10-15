// L'invitation envoyée par SkanFact (1.26.0 ; base 0119 ; serveur/invitation-courriel.ts ; docs/console.md C42). Les trois
// portes — l'équipe d'une entreprise, celle d'un cabinet, l'équipe SkanFact — envoient l'e-mail elles-mêmes quand le
// serveur a un relais, et le disent (`courriel`) ; le lien reste rendu une fois, en secours. Ce qui part chez le relais :
// l'adresse invitée, qui invite, où, le rôle, le lien et jusqu'à quand — rien d'autre. Sans relais, rien ne part.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const partis: Courriel[] = [];
const base = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const ctx: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => { partis.push(c); } }, adresse: () => 'https://app.exemple.tn', console: () => 'https://console.exemple.tn/console' } };
const sansRelais: Contexte = { ...base };
let app: FastifyInstance;
let appSansRelais: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown, a = app) {
  const r = await a.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
let k = 0;
const adresse = (qui: string) => `courriel-${qui}${++k}-${Date.now() % 100000}@exemple.tn`;
async function personne(nom: string) {
  const email = adresse(nom.split(' ')[0]?.toLowerCase() ?? 'x');
  // Par le serveur sans relais : avec un relais, la connexion demanderait le code reçu par e-mail. La session vaut pour les deux.
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP }, appSansRelais);
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } }, appSansRelais)).corps.jeton);
  return { email, jeton };
}
const pourQui = (email: string) => partis.filter((c) => c.a === email);
const jetonDu = (texte: string, motif: RegExp) => motif.exec(texte)?.[1] ?? '';

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille: null })]);
  appSansRelais = creerApp(sansRelais, [...routesSocle(sansRelais), ...routesConsole(sansRelais, { veille: null })]);
  await app.ready(); await appSansRelais.ready();
});
afterAll(async () => { await app.close(); await appSansRelais.close(); await admin.end(); await pool.end(); });

describe('l\'invitation envoyée par SkanFact (0119)', () => {
  it('l\'équipe d\'une entreprise : qui invite, l\'entreprise, ses rôles et le lien, à cette adresse seule ; le lien est celui que l\'écran reçoit', async () => {
    const p = await personne('Lina Patronne');
    const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Quincaillerie Courriel', matriculeFiscal: '5400993C/A/M/000' });
    const entreprise = String(cree.corps.id);
    const invite = adresse('vendeur');
    const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: invite, roles: ['commercial', 'caissier'] });
    expect(r.statut).toBe(201);
    expect(r.corps.courriel).toBe(true);
    const [m, ...autres] = pourQui(invite);
    expect(autres).toEqual([]);
    expect(m?.objet).toBe('Lina Patronne t\'invite à rejoindre Quincaillerie Courriel sur SkanFact');
    expect(m?.texte).toContain('comme commercial, caissier');
    expect(jetonDu(m?.texte ?? '', /https:\/\/app\.exemple\.tn\/\?invitation=(\S+)/)).toBe(encodeURIComponent(String(r.corps.jeton)));
    // Rien d'autre de l'entreprise : ni son matricule, ni l'adresse de qui invite.
    expect(m?.texte).not.toContain('5400993C');
    expect(m?.texte).not.toContain(p.email);
  });

  it('l\'équipe d\'un cabinet : le cabinet et le rôle dits dans la phrase', async () => {
    const associe = await personne('Sonia Associée');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Courriel' });
    // Le geste du cabinet demande le code du téléphone de l'associé.
    const q = await quiEst(ctx, associe.jeton);
    if (!q) throw new Error('session attendue');
    await mettreEnPlaceCode(ctx, q, 'application');
    const invite = adresse('collaborateur');
    const r = await appeler('POST', `/cabinets/${String(c.corps.id)}/invitations`, associe.jeton, { email: invite, role: 'revision' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.courriel).toBe(true);
    const m = pourQui(invite)[0];
    expect(m?.objet).toBe('Sonia Associée t\'invite à rejoindre Cabinet Courriel sur SkanFact');
    expect(m?.texte).toContain('comme collaborateur');
    expect(m?.texte).toContain(`/?invitation=${encodeURIComponent(String(r.corps.jeton))}`);
  });

  it('l\'équipe SkanFact : le lien mène à la console ; renvoyer envoie un lien neuf, annuler n\'envoie rien ; sans relais, rien ne part et l\'écran le sait', async () => {
    const d = await personne('Hela Direction');
    const q = await quiEst(ctx, d.jeton);
    if (!q) throw new Error('session attendue');
    const { secret } = await mettreEnPlaceCode(ctx, q, 'application');
    await ajouterALEquipe(admin, d.email, 'direction', 'essai des invitations par e-mail');
    const e = await appeler('POST', '/console/connexion', undefined, { email: d.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const direction = String((await appeler('POST', '/console/connexion/code', undefined, { defi: e.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) })).corps.jeton);
    const invite = adresse('equipe');
    const r = await appeler('POST', '/console/equipe/invitations', direction, { email: invite, role: 'support', motif: 'renfort du support' });
    expect(r.corps.courriel).toBe(true);
    const premier = pourQui(invite)[0];
    expect(premier?.objet).toBe('Hela Direction t\'invite dans l\'équipe SkanFact');
    expect(premier?.texte).toContain('comme support');
    expect(jetonDu(premier?.texte ?? '', /https:\/\/console\.exemple\.tn\/console\/#\/invitation\/(\S+)/)).toBe(String(r.corps.jeton));
    const neuf = await appeler('POST', `/console/equipe/invitations/${String(r.corps.id)}/renvoyer`, direction, { motif: 'elle ne l\'a pas reçu' });
    expect(pourQui(invite)).toHaveLength(2);
    expect(pourQui(invite)[1]?.texte).toContain(String(neuf.corps.jeton));
    await appeler('POST', `/console/equipe/invitations/${String(neuf.corps.id)}/annuler`, direction, { motif: 'adresse fausse' });
    expect(pourQui(invite)).toHaveLength(2);
    // Sans relais : la même invitation, aucun e-mail, et la réponse le dit.
    const autre = adresse('sansrelais');
    const s = await appeler('POST', '/console/equipe/invitations', direction, { email: autre, role: 'technique', motif: 'sans relais' }, appSansRelais);
    expect([s.statut, s.corps.courriel]).toEqual([201, false]);
    expect(pourQui(autre)).toEqual([]);
  });
});
