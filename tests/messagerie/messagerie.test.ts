// La messagerie entre l'entreprise et son cabinet (lot messagerie ; serveur/messagerie, 0078 ; docs/messagerie.md), par
// l'API. Ce que le serveur garantit :
//   - un fil par entreprise et par cabinet, qui appartient à l'entreprise : ses responsables (propriétaire,
//     administrateur, comptabilité interne) et les membres du cabinet qui voient le dossier s'écrivent ; personne
//     d'autre ne lit, ni la voisine, ni un autre rôle, ni une clé de l'API ;
//   - « lu » se dit à l'autre côté ; ce qui attend chaque côté se compte avec UNE fonction ;
//   - une pièce demandée par le cabinet se reçoit quand le client l'envoie ; une photo ou un PDF se reconnaît à ses
//     octets, pèse 10 Mo au plus, se joint à un seul message, et se range dans un achat ;
//   - la boîte du cabinet dit pour chaque client « À traiter », « Attend le client » ou « Rien à faire », et ses
//     compteurs sortent des mêmes lignes ;
//   - un mandat arrêté ferme le fil au cabinet ; l'entreprise le relit ; un nouveau cabinet ne le lit pas ;
//   - l'alerte par e-mail ne porte rien du message, part une fois cinq minutes après, à une adresse vérifiée, et se
//     décoche.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { prevenirParCourriel } from '../../serveur/messagerie/postier.ts';
import { routesMessagerie } from '../../serveur/messagerie/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const envoyes: Courriel[] = [];
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
// Le postier a son relais d'e-mails (qui garde ce qu'il reçoit) ; l'application des tests n'en a pas (l'inscription
// demanderait alors un code par e-mail).
const ctxPostier: Contexte = { ...ctx, courriel: { envoi: { envoyer: async (c) => { envoyes.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
let app: FastifyInstance;

// Ce que les réponses portent (ce que ces tests en lisent) : une forme pour toutes, chacune n'en a qu'une partie.
type Message = {
  id: string; texte: string; auteur: string; moi: boolean; cote: string; lu: boolean; piece: unknown; repondA: string | null;
  demande: { texte: string; recueLe: string | null } | null; fichier: unknown; achat: unknown;
};
type Dossier = { nom: string; etat: string; nonLus: number; attentes: number; dernier: unknown };
type Corps = {
  id: string; motif: string; jeton: string; code: string; mandat: string; contenu: string; envoyees: number;
  messages: Message[]; questions: { piece: string; montant: string; statut: string; poseePar: string | null; repondueePar: string | null }[]; suite: string | null; anciens: unknown[];
  attente: { nonLus: number; questions: number; demandes: number; aLire: boolean }; fil: { actif: boolean; alerte: boolean };
  dossiers: Dossier[]; compteurs: Record<'aTraiter' | 'attendClient' | 'tout', number>;
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
// Une vraie photo PNG d'un pixel : le serveur la reconnaît à ses premiers octets.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le fil entre l\'entreprise et son cabinet', () => {
  it('ils s\'écrivent ; chacun voit ce qui l\'attend, « lu » se dit à l\'autre ; ni la voisine, ni un autre rôle, ni un collaborateur sans le dossier', async () => {
    const cab = await cabinet();
    const { p: client, ent, mandat } = await cab.client('Menuiserie Ben Salah');
    const collaborateur = await cab.membre('revision', mandat);
    const horsDossier = await cab.membre('revision', null);

    const m1 = await ecrire(ent, client, 'entreprise', { texte: '  Bonjour, voici ma question.  ' });
    expect(m1.statut, JSON.stringify(m1.corps)).toBe(201);
    // Le cabinet lit : le message du client, non lu de son côté ; le texte sans ses blancs, l'auteur tel qu'il a écrit.
    const vu = await fil(ent, cab.associe, 'cabinet');
    expect(vu.statut, JSON.stringify(vu.corps)).toBe(200);
    expect(vu.corps.messages.map((m) => [m.texte, m.auteur, m.moi, m.cote])).toEqual([['Bonjour, voici ma question.', 'Leïla Mansour', false, 'entreprise']]);
    expect(vu.corps.attente).toEqual({ nonLus: 1, questions: 0, demandes: 0, aLire: true });
    // Écrire, c'est avoir lu ce qui précède : le client a lu le fil jusqu'à son message.
    expect(vu.corps.fil).toMatchObject({ cabinet: cab.id, cabinetNom: 'Cabinet Ennour', actif: true, luParLautre: expect.any(String), alerte: true });
    // Pas encore lu par le cabinet : le client ne voit pas « Lue ».
    expect((await fil(ent, client, 'entreprise')).corps.messages[0]?.lu).toBe(false);
    expect((await appeler('POST', `/entreprises/${ent}/messages/lu`, cab.associe.jeton, { cote: 'cabinet' })).statut).toBe(200);
    expect((await fil(ent, cab.associe, 'cabinet')).corps.attente).toMatchObject({ nonLus: 0, aLire: false });
    expect((await fil(ent, client, 'entreprise')).corps.messages[0]?.lu).toBe(true);
    // Le collaborateur à qui le dossier est confié répond ; le client a un message non lu. L'associé le voit de son côté
    // du fil, signé de son collègue (« Toi » n'est que pour ce qu'il a écrit lui-même).
    expect((await ecrire(ent, collaborateur, 'cabinet', { texte: 'Je regarde.' })).statut).toBe(201);
    expect((await fil(ent, cab.associe, 'cabinet')).corps.messages.map((m) => [m.texte, m.cote, m.moi, m.auteur])).toEqual([
      ['Je regarde.', 'cabinet', false, 'revision'], ['Bonjour, voici ma question.', 'entreprise', false, 'Leïla Mansour'],
    ]);
    expect((await fil(ent, collaborateur, 'cabinet')).corps.messages[0]?.moi).toBe(true);
    expect((await appeler('GET', `/entreprises/${ent}/messages/attente`, client.jeton)).corps).toEqual({ cabinet: cab.id, nonLus: 1, questions: 0, demandes: 0, aLire: true, anciens: 0 });

    // Personne d'autre : un membre du cabinet sans ce dossier (la porte ne le lui connaît pas), la voisine, un commercial
    // de l'entreprise.
    expect((await fil(ent, horsDossier, 'cabinet')).statut).toBe(404);
    expect((await ecrire(ent, horsDossier, 'cabinet', { texte: 'Intrus' })).statut).toBe(404);
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Voisine SARL' });
    expect((await fil(ent, voisine, 'entreprise')).statut).toBe(404);
    expect((await fil(ent, voisine, 'cabinet')).statut).toBe(404);
    const commercial = await personne('commercial');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, client.jeton, { email: commercial.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', commercial.jeton, { jeton: inv })).statut).toBe(200);
    const refus = await fil(ent, commercial, 'entreprise');
    expect(refus.statut).toBe(403);
    // Et dans la base : la voisine et le commercial ne lisent aucune ligne, même directement.
    for (const qui of [voisine, commercial, horsDossier]) {
      const n = await enTantQue(pool, qui.utilisateur, async (tx) => (await tx.query('select count(*)::int n from messagerie.message where entreprise = $1', [ent])).rows[0].n);
      expect(n).toBe(0);
    }
    await expect(enTantQue(pool, commercial.utilisateur, (tx) => tx.query('select messagerie.ecrire($1, $2, $3::jsonb)', [ent, 'entreprise', '{"texte":"x"}'])))
      .rejects.toThrow('seuls le propriétaire, un administrateur et la comptabilité interne écrivent au cabinet');
    // Un message vide, trop long, une pièce qui ne se reconnaît pas : refusés en le disant.
    expect((await ecrire(ent, client, 'entreprise', { texte: '   ' })).corps.motif).toBe('Un message vide n\'apprend rien : écris quelque chose, ou joins une photo ou un PDF.');
    expect((await ecrire(ent, client, 'entreprise', { texte: 'x'.repeat(4001) })).statut).toBe(400);
    expect((await ecrire(ent, client, 'entreprise', { texte: 'Celle-ci', piece: { genre: 'facture', id: 'd1', libelle: 'FAC-2026-014 · Société Atlas' } })).statut).toBe(201);
    expect((await fil(ent, cab.associe, 'cabinet')).corps.messages[0]?.piece).toEqual({ genre: 'facture', id: 'd1', libelle: 'FAC-2026-014 · Société Atlas' });
  });

  it('une pièce demandée : le cabinet la demande, le client l\'envoie en photo et elle est reçue ; rangée dans un achat, le message le dit', async () => {
    const cab = await cabinet();
    const { p: client, ent } = await cab.client('Boulangerie Ennour');
    const d = await ecrire(ent, cab.associe, 'cabinet', { texte: 'Il me manque une pièce.', demande: 'La facture STEG d\'août' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    // La pièce demandée se compte une fois : dans `demandes`, pas aussi comme message non lu (la pastille disait 2).
    expect((await appeler('GET', `/entreprises/${ent}/messages/attente`, client.jeton)).corps).toMatchObject({ nonLus: 0, demandes: 1, aLire: true });
    // Le client ne demande pas de pièce ; il ne répond à une demande qu'en envoyant la pièce.
    expect((await ecrire(ent, client, 'entreprise', { demande: 'Ton RIB' })).corps.motif).toBe('Seul le cabinet demande une pièce.');
    expect((await ecrire(ent, client, 'entreprise', { texte: 'La voilà', repondA: d.corps.id })).corps.motif).toBe('On répond à une pièce demandée en l\'envoyant : joins la photo ou le PDF.');

    // Le fichier : reconnu à ses octets (un texte nommé .png ne passe pas), 10 Mo au plus.
    const faux = await appeler('POST', `/entreprises/${ent}/messages/fichiers`, client.jeton, { cote: 'entreprise', nom: 'facture.png', contenu: Buffer.from('ceci n\'est pas une image').toString('base64') });
    expect(faux.statut).toBe(415);
    expect(faux.corps.motif).toBe('Le fichier « facture.png » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF : il ne se joint pas.');
    const lourd = await appeler('POST', `/entreprises/${ent}/messages/fichiers`, client.jeton, { cote: 'entreprise', nom: 'scan.pdf', contenu: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1_048_576)]).toString('base64') });
    expect(lourd.statut).toBe(413);
    expect(lourd.corps.motif).toBe('Le fichier « scan.pdf » pèse 11,0 Mo : un fichier joint pèse 10 Mo au plus.');
    const depot = await appeler('POST', `/entreprises/${ent}/messages/fichiers`, client.jeton, { cote: 'entreprise', nom: 'facture-steg-aout.png', contenu: PNG });
    expect(depot.statut, JSON.stringify(depot.corps)).toBe(201);
    expect(depot.corps).toMatchObject({ nom: 'facture-steg-aout.png', type: 'image/png', taille: Buffer.from(PNG, 'base64').length });
    // Pas encore joint : seul celui qui l'a déposé le lit.
    expect((await appeler('GET', `/entreprises/${ent}/messages/fichiers/${depot.corps.id}`, cab.associe.jeton)).statut).toBe(404);
    const envoi = await ecrire(ent, client, 'entreprise', { texte: 'La voilà !', fichier: depot.corps.id, repondA: d.corps.id });
    expect(envoi.statut, JSON.stringify(envoi.corps)).toBe(201);
    // Reçue : la demande ne compte plus ; le cabinet lit le fichier tel quel.
    expect((await appeler('GET', `/entreprises/${ent}/messages/attente`, client.jeton)).corps).toMatchObject({ demandes: 0 });
    const vu = (await fil(ent, cab.associe, 'cabinet')).corps.messages;
    expect(vu.find((m) => m.id === d.corps.id)?.demande?.recueLe).toEqual(expect.any(String));
    expect(vu.find((m) => m.id === envoi.corps.id)).toMatchObject({ repondA: d.corps.id, fichier: { id: depot.corps.id, nom: 'facture-steg-aout.png', type: 'image/png' } });
    expect((await appeler('GET', `/entreprises/${ent}/messages/fichiers/${depot.corps.id}`, cab.associe.jeton)).corps.contenu).toBe(PNG);
    // Un fichier se joint à un seul message ; une demande reçue n'attend plus rien.
    expect((await ecrire(ent, client, 'entreprise', { texte: 'Encore', fichier: depot.corps.id })).corps.motif).toBe('Ce fichier est déjà joint à un message.');
    expect((await appeler('POST', `/entreprises/${ent}/messages/${d.corps.id}/recue`, cab.associe.jeton)).corps.motif).toBe('Cette pièce demandée n\'attend plus rien.');

    // Rangée dans un achat (l'écran l'a enregistré) : le message le dit ; le cabinet ne range pas chez le client.
    expect((await appeler('POST', `/entreprises/${ent}/messages/${envoi.corps.id}/achat`, cab.associe.jeton, { achat: 'a1', libelle: 'STEG, 85,400 DT' })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${ent}/messages/${d.corps.id}/achat`, client.jeton, { achat: 'a1', libelle: 'STEG, 85,400 DT' })).corps.motif).toBe('Ce message n\'a pas de fichier à ranger.');
    expect((await appeler('POST', `/entreprises/${ent}/messages/${envoi.corps.id}/achat`, client.jeton, { achat: 'a1', libelle: 'STEG, 85,400 DT' })).statut).toBe(200);
    expect(((await fil(ent, client, 'entreprise')).corps.messages).find((m) => m.id === envoi.corps.id)?.achat).toEqual({ id: 'a1', libelle: 'STEG, 85,400 DT' });

    // Une demande reçue autrement : le cabinet la dit reçue.
    const d2 = await ecrire(ent, cab.associe, 'cabinet', { demande: 'Le contrat de location' });
    expect((await appeler('POST', `/entreprises/${ent}/messages/${d2.corps.id}/recue`, client.jeton)).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${ent}/messages/${d2.corps.id}/recue`, cab.associe.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/messages/attente`, client.jeton)).corps).toMatchObject({ demandes: 0 });
  });

  it('cinquante messages à la fois, du plus récent ; la suite donne les plus anciens, sans en perdre ni en doubler', async () => {
    const cab = await cabinet();
    const { p: client, ent } = await cab.client('Garage Mrad');
    for (let i = 1; i <= 53; i++) expect((await ecrire(ent, i % 2 ? client : cab.associe, i % 2 ? 'entreprise' : 'cabinet', { texte: `Message ${i}` })).statut).toBe(201);
    const p1 = (await fil(ent, client, 'entreprise')).corps;
    expect(p1.messages).toHaveLength(50);
    expect(p1.messages[0]?.texte).toBe('Message 53');
    expect(p1.suite).toEqual(expect.any(String));
    const p2 = (await fil(ent, client, 'entreprise', `&avant=${encodeURIComponent(String(p1.suite))}`)).corps;
    expect(p2.messages.map((m) => m.texte)).toEqual(['Message 3', 'Message 2', 'Message 1']);
    expect(p2.suite).toBeNull();
    expect((await fil(ent, client, 'entreprise', '&avant=nimporte')).statut).toBe(400);
  });
});

describe('la boîte du cabinet', () => {
  it('« À traiter », « Attend le client », « Rien à faire » : chaque client à sa place, et les compteurs sortent des mêmes lignes', async () => {
    const cab = await cabinet();
    const a = await cab.client('Atlas SARL');
    const b = await cab.client('Bakery Lina');
    const c = await cab.client('Clinique Amel');
    const boite = async () => (await appeler('GET', `/cabinets/${cab.id}/messages`, cab.associe.jeton)).corps;
    const etats = async () => Object.fromEntries((await boite()).dossiers.map((d) => [d.nom, d.etat]));
    expect(await etats()).toEqual({ 'Atlas SARL': 'rien', 'Bakery Lina': 'rien', 'Clinique Amel': 'rien' });

    // A écrit : à traiter, avec un message non lu.
    await ecrire(a.ent, a.p, 'entreprise', { texte: 'Une question sur ma TVA' });
    // B : le cabinet lui demande une pièce : il attend le client.
    await ecrire(b.ent, cab.associe, 'cabinet', { demande: 'Les relevés de septembre' });
    // C : une question de la révision envoyée, sans réponse : il attend le client ; répondue, elle est à traiter.
    const q = await appeler('POST', `/entreprises/${c.ent}/compta/questions`, cab.associe.jeton, { periode: '2026-03', compte: '471', piece: 'FF-12', montant: '1200.5', objet: 'Justificatif absent', texte: 'Peux-tu m\'envoyer la facture ?', attendu: 'piece' });
    expect(q.statut, JSON.stringify(q.corps)).toBe(201);
    expect((await appeler('POST', `/entreprises/${c.ent}/compta/questions/envoyer`, cab.associe.jeton, { annee: 2026 })).corps.envoyees).toBe(1);
    let lu = await boite();
    expect(Object.fromEntries(lu.dossiers.map((d) => [d.nom, [d.etat, d.nonLus, d.attentes]]))).toEqual({
      'Atlas SARL': ['a_traiter', 1, 0], 'Bakery Lina': ['attend_client', 0, 1], 'Clinique Amel': ['attend_client', 0, 1],
    });
    // L'ordre : à traiter d'abord.
    expect(lu.dossiers[0]?.nom).toBe('Atlas SARL');
    expect(lu.compteurs).toEqual({ aTraiter: 1, attendClient: 2, tout: 3 });
    // Le fil de C montre la question, et le client y répond : C passe à traiter.
    const filC = (await fil(c.ent, c.p, 'entreprise')).corps;
    expect(filC.questions.map((x) => [x.piece, x.montant, x.statut])).toEqual([['FF-12', '1200.500', 'envoyee']]);
    expect(filC.attente).toEqual({ nonLus: 0, questions: 1, demandes: 0, aLire: false });
    // Qui l'a posée : l'associé la lit comme la sienne ; chez le client, ni son nom ni son adresse ne passent.
    expect(filC.questions[0]?.poseePar).toBeNull();
    expect((await fil(c.ent, cab.associe, 'cabinet')).corps.questions[0]?.poseePar).toBe('moi');
    expect((await appeler('POST', `/entreprises/${c.ent}/compta/questions/${q.corps.id}/repondre`, c.p.jeton, { texte: 'Elle est jointe à l\'achat FF-12.' })).statut).toBe(200);
    expect((await fil(c.ent, c.p, 'entreprise')).corps.questions[0]?.repondueePar).toBe('moi');
    // Le cabinet a du neuf à lire : la réponse du client.
    expect((await fil(c.ent, cab.associe, 'cabinet')).corps.attente).toMatchObject({ nonLus: 1, aLire: true });
    // A : le cabinet répond (écrire, c'est avoir lu), rien à faire ; B : le client envoie la pièce, à traiter ; puis le
    // cabinet dit « traité ».
    await ecrire(a.ent, cab.associe, 'cabinet', { texte: 'C\'est noté.' });
    const depot = await appeler('POST', `/entreprises/${b.ent}/messages/fichiers`, b.p.jeton, { cote: 'entreprise', nom: 'releves.png', contenu: PNG });
    const demandeB = ((await fil(b.ent, b.p, 'entreprise')).corps.messages)[0];
    expect((await ecrire(b.ent, b.p, 'entreprise', { fichier: depot.corps.id, repondA: demandeB?.id })).statut).toBe(201);
    lu = await boite();
    expect(Object.fromEntries(lu.dossiers.map((d) => [d.nom, [d.etat, d.nonLus]]))).toEqual({
      'Atlas SARL': ['rien', 0], 'Bakery Lina': ['a_traiter', 1], 'Clinique Amel': ['a_traiter', 1],
    });
    expect(lu.compteurs).toEqual({ aTraiter: 2, attendClient: 0, tout: 3 });
    expect((await appeler('POST', `/entreprises/${b.ent}/messages/traite`, cab.associe.jeton)).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${b.ent}/messages/traite`, b.p.jeton)).statut).toBe(403);
    lu = await boite();
    expect(lu.compteurs).toEqual({ aTraiter: 1, attendClient: 0, tout: 3 });
    // Les compteurs sont ceux des lignes, filtre par filtre.
    for (const [etat, cle] of [['a_traiter', 'aTraiter'], ['attend_client', 'attendClient']] as const) {
      expect(lu.dossiers.filter((d) => d.etat === etat).length).toBe(lu.compteurs[cle]);
    }
    // Le dernier échange, dit sans contenu de trop : la réponse du client à la question.
    expect(lu.dossiers.find((d) => d.nom === 'Clinique Amel')?.dernier).toMatchObject({ cote: 'entreprise', sorte: 'reponse', extrait: 'Elle est jointe à l\'achat FF-12.' });
    // Un client du cabinet n'y lit aucun dossier (la boîte ne montre que le portefeuille de qui la lit).
    expect((await appeler('GET', `/cabinets/${cab.id}/messages`, a.p.jeton)).corps).toEqual({ dossiers: [], compteurs: { aTraiter: 0, attendClient: 0, tout: 0 } });
  });
});

describe('un mandat qui s\'arrête', () => {
  it('le cabinet ne lit plus ; l\'entreprise relit l\'ancien fil sans y écrire ; un nouveau cabinet ne le lit pas', async () => {
    const cab = await cabinet();
    const { p: client, ent } = await cab.client('Studio Lina');
    await ecrire(ent, client, 'entreprise', { texte: 'Avant le changement' });
    expect((await appeler('DELETE', `/entreprises/${ent}/mandat`, client.jeton)).statut).toBe(200);
    // Le dossier n'est plus du tout au cabinet : la porte ne le connaît plus.
    expect((await fil(ent, cab.associe, 'cabinet')).statut).toBe(404);
    expect((await ecrire(ent, cab.associe, 'cabinet', { texte: 'Encore là ?' })).statut).toBe(404);
    // Sans cabinet : pas de fil, l'ancien se relit à part.
    const sans = (await fil(ent, client, 'entreprise')).corps;
    expect(sans.fil).toBeNull();
    expect(sans.anciens).toEqual([{ cabinet: cab.id, nom: 'Cabinet Ennour' }]);
    expect((await ecrire(ent, client, 'entreprise', { texte: 'Allô ?' })).corps.motif).toBe('Aucun cabinet ne tient ce dossier : la messagerie s\'ouvre quand tu confies ton dossier à un cabinet.');
    const ancien = (await fil(ent, client, 'entreprise', `&cabinet=${cab.id}`)).corps;
    expect(ancien.fil.actif).toBe(false);
    expect(ancien.messages.map((m) => m.texte)).toEqual(['Avant le changement']);
    // Un nouveau cabinet : son fil est neuf.
    const autre = await personne('autre');
    const c2 = await appeler('POST', '/cabinets', autre.jeton, { nom: 'Cabinet Jaziri' });
    const m2 = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c2.corps.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${c2.corps.id}/mandats/${m2}/accepter`, autre.jeton)).statut).toBe(200);
    const neuf = (await fil(ent, autre, 'cabinet')).corps;
    expect(neuf.messages).toEqual([]);
    const n = await enTantQue(pool, autre.utilisateur, async (tx) => (await tx.query('select count(*)::int n from messagerie.message where entreprise = $1', [ent])).rows[0].n);
    expect(n).toBe(0);
    expect((await appeler('GET', `/entreprises/${ent}/messages/attente`, client.jeton)).corps).toMatchObject({ cabinet: c2.corps.id, anciens: 1 });
  });
});

describe('l\'alerte par e-mail', () => {
  const pour = (p: Personne) => envoyes.filter((c) => c.a === p.email);
  it('ne porte rien du message ; part une fois, cinq minutes après, à une adresse vérifiée ; se redit après lecture ; se décoche', async () => {
    const cab = await cabinet(true);
    const { p: client, ent, mandat } = await cab.client('Pharmacie El Amel');
    const pasVerifie = await cab.membre('revision', mandat);
    await ecrire(ent, client, 'entreprise', { texte: 'Mon chiffre secret : 4 242 DT' });
    // Avant cinq minutes : rien.
    await prevenirParCourriel(ctxPostier);
    expect(pour(cab.associe)).toEqual([]);
    // Cinq minutes passées : l'associé est prévenu, une fois ; le collaborateur à l'adresse non vérifiée, jamais.
    await admin.query('update messagerie.message set ecrit_le = ecrit_le - interval \'6 minutes\' where entreprise = $1', [ent]);
    await prevenirParCourriel(ctxPostier);
    await prevenirParCourriel(ctxPostier);
    expect(pour(cab.associe)).toHaveLength(1);
    expect(pour(pasVerifie)).toEqual([]);
    const e = pour(cab.associe)[0];
    expect(e?.objet).toBe('Un nouveau message t\'attend dans SkanFact');
    expect(e?.texte).toContain('https://app.exemple.tn/');
    // Rien du message, ni de l'entreprise, ni du cabinet, ni de l'auteur.
    for (const secret of ['4 242', 'chiffre', 'Pharmacie', 'Ennour', 'Leïla', 'Mansour', ent, cab.id]) expect(`${e?.objet}\n${e?.texte}`).not.toContain(secret);
    // Le cabinet a lu, le client réécrit (plus tard) : une nouvelle alerte.
    await appeler('POST', `/entreprises/${ent}/messages/lu`, cab.associe.jeton, { cote: 'cabinet' });
    await ecrire(ent, client, 'entreprise', { texte: 'Et encore une chose' });
    await prevenirParCourriel(ctxPostier, new Date(Date.now() + 6 * 60_000));
    expect(pour(cab.associe)).toHaveLength(2);
    // Le cabinet écrit : le client (vérifié) est prévenu, avec le texte de l'entreprise.
    await ecrire(ent, cab.associe, 'cabinet', { texte: 'Bien reçu' });
    await prevenirParCourriel(ctxPostier, new Date(Date.now() + 6 * 60_000));
    expect(pour(client)).toHaveLength(1);
    expect(pour(client)[0]?.texte).toContain('Ton cabinet comptable t\'a écrit');
    // Décochée : plus rien pour ce fil. (L'alerte d'avant est oubliée, pour que seule la case décide.)
    expect((await appeler('PUT', `/entreprises/${ent}/messages/alerte`, client.jeton, { cote: 'entreprise', active: false })).statut).toBe(200);
    await admin.query('update messagerie.alerte set prevenue_le = null where utilisateur = (select id from socle.utilisateur where email = $1)', [client.email]);
    expect((await fil(ent, client, 'entreprise')).corps.fil.alerte).toBe(false);
    await appeler('POST', `/entreprises/${ent}/messages/lu`, client.jeton, { cote: 'entreprise' });
    await ecrire(ent, cab.associe, 'cabinet', { texte: 'Autre chose' });
    await prevenirParCourriel(ctxPostier, new Date(Date.now() + 6 * 60_000));
    expect(pour(client)).toHaveLength(1);
    // Seul le serveur note une alerte partie.
    await expect(enTantQue(pool, client.utilisateur, (tx) => tx.query('select messagerie.alerte_partie($1, $2, $3, now())', [client.utilisateur, ent, cab.id])))
      .rejects.toThrow('seul le serveur note une alerte partie');
  });
});
