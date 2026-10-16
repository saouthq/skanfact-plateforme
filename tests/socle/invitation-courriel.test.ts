// L'invitation envoyée par SkanFact (1.26.0 ; base 0119 ; serveur/invitation-courriel.ts ; docs/console.md C42). Les trois
// portes — l'équipe d'une entreprise, celle d'un cabinet, l'équipe SkanFact — envoient l'e-mail elles-mêmes quand le
// serveur a un relais, et le disent (`courriel`) ; le lien reste rendu une fois, en secours. Ce qui part chez le relais :
// l'adresse invitée, qui invite, où, le rôle, le lien et jusqu'à quand — rien d'autre. Sans relais, rien ne part.
// Depuis 0138 (l'audit 1.42.0 A08) : « à envoyer » s'écrit dans la transaction de l'invitation, AVANT l'envoi ; un e-mail
// resté à envoyer ou en attente du relais plus de dix minutes se lit « sans réponse ».

import { createHash } from 'node:crypto';
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
import { envoyerInvitation, etatVu, SANS_REPONSE_MS } from '../../serveur/invitation-courriel.ts';
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
    // La liste de l'équipe le dit (0124) : l'e-mail a été accepté par le relais.
    const liste = (await appeler('GET', '/console/equipe', direction)).corps.invitations as { email: string; courriel: string | null }[];
    expect(liste.find((i) => i.email === invite)?.courriel).toBe('parti');
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

describe('l\'e-mail d\'une invitation dit la vérité (0124, l\'audit C07)', () => {
  const empreinte = (jeton: unknown) => createHash('sha256').update(String(jeton)).digest('hex');
  const etatEnBase = async (jeton: unknown) => (await admin.query('select courriel from socle.invitation where jeton_empreinte = $1', [empreinte(jeton)])).rows[0]?.courriel as string | null;

  it('un relais qui refuse : rien ne se dit « parti », l\'invitation garde « refusé » ; une invitation que la base refuse n\'envoie rien', async () => {
    const tentes: string[] = [];
    const refusant: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => { tentes.push(c.a); throw new Error('550 adresse refusée'); } }, adresse: () => 'https://app.exemple.tn' } };
    const appRefus = creerApp(refusant, [...routesSocle(refusant)]);
    await appRefus.ready();
    try {
      const p = await personne('Sonia Refus');
      const entreprise = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Librairie Refusée' })).corps.id);
      const invite = adresse('refuse');
      const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: invite, roles: ['commercial'] }, appRefus);
      expect([r.statut, r.corps.courriel, r.corps.courrielEtat]).toEqual([201, false, 'refuse']);
      expect(r.corps.jeton).toBeTruthy();
      expect(await etatEnBase(r.corps.jeton)).toBe('refuse');
      // Sa propre adresse (elle est déjà de l'équipe) : l'invitation est refusée, aucun e-mail n'est tenté.
      const n = tentes.length;
      expect((await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: p.email, roles: ['commercial'] }, appRefus)).statut).not.toBe(201);
      expect(tentes).toHaveLength(n);
    } finally { await appRefus.close(); }
  });

  it('un relais lent : « en attente » sans attendre plus ; sa réponse tardive se note sur l\'invitation', async () => {
    const p = await personne('Walid Lent');
    const entreprise = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier Lent' })).corps.id);
    const invite = adresse('lent');
    // L'invitation, posée par le serveur sans relais : « sans relais ».
    const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: invite, roles: ['commercial'] }, appSansRelais);
    expect([r.corps.courriel, r.corps.courrielEtat]).toEqual([false, 'sans_relais']);
    expect(await etatEnBase(r.corps.jeton)).toBe('sans_relais');
    // Comme après un arrêt : « à envoyer », noté par sa transaction ; la réponse lente le remplace.
    await admin.query("update socle.invitation set courriel = 'a_envoyer', courriel_le = now() where jeton_empreinte = $1", [empreinte(r.corps.jeton)]);
    let accepter = () => {};
    const lent: Contexte = { ...base, courriel: { envoi: { envoyer: () => new Promise<void>((ok) => { accepter = ok; }) }, adresse: () => 'https://app.exemple.tn' } };
    const etat = await envoyerInvitation(lent, { a: invite, qui: 'Walid Lent', ou: 'Atelier Lent', role: 'commercial', lien: 'https://app.exemple.tn/?invitation=x', expire: new Date() },
      empreinte(r.corps.jeton), 50);
    expect(etat).toBe('en_attente');
    expect(await etatEnBase(r.corps.jeton)).toBe('en_attente');
    accepter();
    await expect.poll(() => etatEnBase(r.corps.jeton), { timeout: 5_000 }).toBe('parti');
  });

  it('« à envoyer » est déjà écrit quand l\'e-mail part : un arrêt entre les deux en laisse la trace (A08)', async () => {
    const vus: (string | null)[] = [];
    const temoin: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => {
      const jeton = decodeURIComponent(jetonDu(c.texte, /\?invitation=(\S+)/));
      vus.push(await etatEnBase(jeton));
    } }, adresse: () => 'https://app.exemple.tn' } };
    const appTemoin = creerApp(temoin, [...routesSocle(temoin)]);
    await appTemoin.ready();
    try {
      const p = await personne('Nour Témoin');
      const entreprise = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Épicerie Témoin' })).corps.id);
      const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: adresse('temoin'), roles: ['commercial'] }, appTemoin);
      expect(r.statut).toBe(201);
      expect(vus).toEqual(['a_envoyer']);
      expect(await etatEnBase(r.corps.jeton)).toBe('parti');
    } finally { await appTemoin.close(); }
  });

  it('resté « à envoyer » ou « en attente » plus de dix minutes : la liste de l\'équipe dit « sans réponse » (A08)', async () => {
    const maintenant = new Date('2026-10-16T10:00:00Z');
    const il = (ms: number) => new Date(maintenant.getTime() - ms).toISOString();
    expect(SANS_REPONSE_MS).toBe(600_000);
    expect(etatVu('a_envoyer', il(SANS_REPONSE_MS), maintenant)).toBe('a_envoyer');
    expect(etatVu('a_envoyer', il(SANS_REPONSE_MS + 1000), maintenant)).toBe('sans_reponse');
    expect(etatVu('en_attente', il(SANS_REPONSE_MS + 1000), maintenant)).toBe('sans_reponse');
    expect(etatVu('parti', il(86_400_000), maintenant)).toBe('parti');
    expect(etatVu('a_envoyer', null, maintenant)).toBe('sans_reponse');
    expect(etatVu('perdu', il(0), maintenant)).toBeNull();
    // Par la route de l'équipe d'une entreprise.
    const p = await personne('Rim Liste');
    const entreprise = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Bazar Liste' })).corps.id);
    const r = await appeler('POST', `/entreprises/${entreprise}/invitations`, p.jeton, { email: adresse('liste'), roles: ['commercial'] }, appSansRelais);
    const lue = async () => ((await appeler('GET', `/entreprises/${entreprise}/equipe`, p.jeton, undefined, appSansRelais)).corps.invitations as { courriel: string | null }[])[0]?.courriel;
    expect(await lue()).toBe('sans_relais');
    await admin.query("update socle.invitation set courriel = 'a_envoyer', courriel_le = now() - interval '5 minutes' where jeton_empreinte = $1", [empreinte(r.corps.jeton)]);
    expect(await lue()).toBe('a_envoyer');
    await admin.query("update socle.invitation set courriel_le = now() - interval '11 minutes' where jeton_empreinte = $1", [empreinte(r.corps.jeton)]);
    expect(await lue()).toBe('sans_reponse');
  });
});
