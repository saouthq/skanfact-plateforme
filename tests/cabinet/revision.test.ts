// La révision et les questions au client (brique 44 ; docs/cabinet.md, C32 et C33), par l'API. Ce que
// le serveur garantit :
//   - la révision d'une période est le dossier de travail du cabinet : entière, avec sa révision (deux
//     postes ne s'écrasent pas), écrite par qui révise (l'associé, le collaborateur), jamais par
//     l'assistant ni par le client, qui ne la lit pas ;
//   - une question appartient à l'entreprise : (1.388.86) posée par qui valide, elle part aussitôt, avec sa date
//     « pour le » ; gardée, elle reste au cabinet et se retire ; partie, elle se ferme ; elle se relance, à la main
//     ou une fois par semaine passé sa date, trois fois au plus ; le client y répond, et une question qui a sa
//     réponse ne se réécrit plus ;
//   - « À faire » du cabinet compte, dossier par dossier, ce qui attend, ce qui est en retard, et depuis quand.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Personne = Awaited<ReturnType<typeof personne>>;

// Un client et son entreprise ; son cabinet, qui accepte le mandat de comptabilité ; un collaborateur
// et un assistant de saisie à qui le dossier est confié.
async function dossier() {
  const client = await personne('client');
  const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
  const associe = await personne('associe');
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
  const cabinet = String(c.corps.id);
  const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
  await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe.jeton);
  const membre = async (role: string) => {
    const p = await personne(role);
    const id = String((await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [p.utilisateur, cabinet, [role]])).rows[0].id);
    await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${id}`, associe.jeton, { role });
    return p;
  };
  const collaborateur = await membre('revision');
  const assistant = await membre('saisie');
  return { client, ent, associe, cabinet, mandat, collaborateur, assistant };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const REVISION = { faite: false, faiteLe: null, faitePar: '', comptes: [{ compte: '411', revuLe: 1759140000000, revuPar: 'associe', note: '' }],
  notes: [{ id: 'n1', texte: 'Rapprocher le 471', cycle: 'tresorerie', compte: '471', par: 'associe', le: 1759140000000, levee: false, leveeLe: null, leveePar: '' }],
  questionnaire: [{ id: 'q1', question: 'Des litiges en cours ?', reponse: '', par: '', le: null }] };

describe('la révision d\'un dossier', () => {
  it('se garde entière par période, avec sa révision ; changée ailleurs, jamais écrasée', async () => {
    const d = await dossier();
    const url = `/cabinets/${d.cabinet}/revisions/${d.ent}`;
    expect((await appeler('GET', `${url}?annee=2026`, d.associe.jeton)).corps.revisions).toEqual([]);
    const r1 = await appeler('PUT', `${url}/2026`, d.associe.jeton, { contenu: REVISION, revision: null });
    expect(r1.statut, JSON.stringify(r1.corps)).toBe(200);
    expect(r1.corps.revision).toBe(1);
    expect((await appeler('PUT', `${url}/2026-03`, d.collaborateur.jeton, { contenu: { ...REVISION, faite: true, faiteLe: 1759140000000, faitePar: 'revision' }, revision: null })).statut).toBe(200);
    // Un second poste qui écrit sur ce qu'il a lu avant : refusé, rien n'est écrasé.
    expect((await appeler('PUT', `${url}/2026`, d.collaborateur.jeton, { contenu: { ...REVISION, comptes: [] }, revision: 1 })).statut).toBe(200);
    const vieux = await appeler('PUT', `${url}/2026`, d.associe.jeton, { contenu: REVISION, revision: 1 });
    expect(vieux.statut).toBe(409);
    expect(vieux.corps.motif).toBe('La révision de ce dossier a été changée ailleurs entre-temps : recharge-la, rien n\'a été enregistré.');
    const lues = (await appeler('GET', `${url}?annee=2026`, d.associe.jeton)).corps.revisions as { periode: string; contenu: typeof REVISION; revision: number }[];
    expect(lues.map((x) => [x.periode, x.revision, x.contenu.comptes.length, x.contenu.faite])).toEqual([['2026', 2, 0, false], ['2026-03', 1, 1, true]]);
    // Une autre année ne les montre pas.
    expect((await appeler('GET', `${url}?annee=2025`, d.associe.jeton)).corps.revisions).toEqual([]);
    // La forme se garde : un champ de trop, un montant à virgule, une période qui n'en est pas une.
    expect((await appeler('PUT', `${url}/2027`, d.associe.jeton, { contenu: { ...REVISION, solde: 1 }, revision: null })).statut).toBe(400);
    expect((await appeler('PUT', `${url}/2026-13`, d.associe.jeton, { contenu: REVISION, revision: null })).statut).toBe(400);
  });

  it('qui révise : l\'associé et le collaborateur ; ni l\'assistant, ni le client (qui ne la lit pas), ni sans la comptabilité au mandat', async () => {
    const d = await dossier();
    const url = `/cabinets/${d.cabinet}/revisions/${d.ent}`;
    const refus = await appeler('PUT', `${url}/2026`, d.assistant.jeton, { contenu: REVISION, revision: null });
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toBe('Ton rôle ne permet pas de réviser ce dossier.');
    expect((await appeler('PUT', `${url}/2026`, d.client.jeton, { contenu: REVISION, revision: null })).statut).toBe(403);
    expect((await appeler('PUT', `${url}/2026`, d.associe.jeton, { contenu: REVISION, revision: null })).statut).toBe(200);
    expect((await appeler('GET', `${url}?annee=2026`, d.client.jeton)).corps.revisions).toEqual([]);
    // Sans la comptabilité au mandat, plus de révision.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['saisie_achats'] })).statut).toBe(200);
    expect((await appeler('PUT', `${url}/2026-01`, d.associe.jeton, { contenu: REVISION, revision: null })).statut).toBe(403);
    // Directement dans la base aussi.
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select cabinet.poser_revision($1, $2, $3, $4::jsonb, null)',
      [d.cabinet, d.ent, '2026-02', JSON.stringify(REVISION)]))).rejects.toThrow('ton rôle ne permet pas de réviser ce dossier');
  });

  it('le questionnaire et les cycles du cabinet sont des réglages du cabinet', async () => {
    const d = await dossier();
    const contenu = { questionnaire: [{ question: 'Des engagements hors bilan ?' }], cycles: [{ id: 'tresorerie', label: 'Trésorerie', prefixes: ['5'] }] };
    expect((await appeler('PUT', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton, { contenu, revision: null })).statut).toBe(200);
    expect((await appeler('GET', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton)).corps.contenu).toEqual(contenu);
    expect((await appeler('PUT', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton, { contenu: { cycles: [{ id: 'x', label: 'X', prefixes: ['5a'] }] }, revision: 1 })).statut).toBe(400);
  });
});

type Question = { id: string; statut: string; envoyeeLe: string | null; pourLe: string | null; relances: number; relanceLe: string | null; reponse: string | null; montant: string; texte: string; periode: string };
const QUESTION = { periode: '2026-03', compte: '471', piece: 'FF-12', montant: '1200.5', objet: 'Justificatif absent', texte: 'Peux-tu m\'envoyer la facture de ce virement ?', attendu: 'piece' };
// (1.388.86) Le jour de Tunis, décalé de n jours.
const jourDeTunis = (n = 0) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

describe('les questions au client', () => {
  it('(1.388.86) posée par qui valide, elle part aussitôt ; « Garder pour plus tard », ou posée par l\'assistant, elle attend ; le client y répond', async () => {
    const d = await dossier();
    const url = `/entreprises/${d.ent}/compta/questions`;
    const lire = async (p: Personne, annee = '2026') => (await appeler('GET', `${url}?annee=${annee}`, p.jeton)).corps.questions as Question[];
    // L'assistant pose (qui saisit, comme la v10) : il n'envoie pas, elle attend qu'un collaborateur qui valide la fasse partir.
    const r = await appeler('POST', url, d.assistant.jeton, QUESTION);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.statut).toBe('ouverte');
    const id = String(r.corps.id);
    expect((await lire(d.associe)).map((q) => [q.statut, q.montant, q.envoyeeLe, q.relances])).toEqual([['ouverte', '1200.500', null, 0]]);
    // Gardée : le client ne la voit pas, ni ne peut y répondre.
    expect(await lire(d.client)).toEqual([]);
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'Oui' })).corps.motif).toBe('Cette question n\'existe plus.');
    // L'associé pose : elle part tout de suite, avec sa date « pour le » ; une date passée se refuse.
    expect((await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-13', pour: jourDeTunis(-1) })).corps.motif)
      .toBe('Une réponse se demande pour aujourd\'hui ou plus tard : choisis la date dans le calendrier.');
    const partie = await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-13', pour: jourDeTunis(7) });
    expect(partie.corps.statut).toBe('envoyee');
    const b = String(partie.corps.id);
    // « Garder pour plus tard » : elle attend, et se retire sans laisser de trace chez le client.
    const gardee = await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-14', garder: true });
    expect(gardee.corps.statut).toBe('ouverte');
    expect((await appeler('DELETE', `${url}/${String(gardee.corps.id)}`, d.associe.jeton)).statut).toBe(200);
    expect((await lire(d.client)).map((q) => [q.id, q.statut, q.pourLe, !!q.envoyeeLe])).toEqual([[b, 'envoyee', jourDeTunis(7), true]]);
    // Envoyer : qui valide (l'assistant non) ; celles qui attendent ; plus rien ensuite — une partie se relance de sa ligne.
    // Gardée, elle ne se relance pas : elle n'est jamais partie.
    expect((await appeler('POST', `${url}/${id}/relancer`, d.associe.jeton, {})).corps.motif).toBe('Cette question n\'est pas encore partie : envoie-la d\'abord.');
    expect((await appeler('POST', `${url}/envoyer`, d.assistant.jeton, { annee: 2026 })).statut).toBe(403);
    expect((await appeler('POST', `${url}/envoyer`, d.collaborateur.jeton, { annee: 2026 })).corps.envoyees).toBe(1);
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { annee: 2026 })).corps.motif)
      .toBe('Aucune question n\'attend de partir : celles qui sont parties se relancent de leur ligne.');
    expect(await lire(d.client, '2025')).toEqual([]);
    // Partie, elle ne s'efface plus ; elle se précise encore, date « pour le » comprise.
    expect((await appeler('DELETE', `${url}/${id}`, d.associe.jeton)).corps.motif).toBe('Cette question est déjà partie chez le client : elle se ferme, elle ne s\'efface pas.');
    expect((await appeler('PUT', `${url}/${id}`, d.associe.jeton, { texte: 'Peux-tu m\'envoyer la facture du virement du 12 mars ?', pour: jourDeTunis(3) })).statut).toBe(200);
    // « À faire » du cabinet : deux qui attendent, aucune en retard — jusqu'à ce que la date passe.
    const aFaire = async () => (await appeler('GET', `/cabinets/${d.cabinet}/questions`, d.associe.jeton)).corps.dossiers as { entreprise: string; ouvertes: number; enRetard: number; repondues: number; attendDepuis: string | null }[];
    expect((await aFaire()).map((x) => [x.entreprise, x.ouvertes, x.enRetard, x.repondues, !!x.attendDepuis])).toEqual([[d.ent, 2, 0, 0, true]]);
    await admin.query(`update compta.question set pour_le = current_date - 2 where id = $1`, [id]);
    expect((await aFaire()).map((x) => x.enRetard)).toEqual([1]);
    // Relancer à la main : qui valide ; la base compte (trois au plus) ; une gardée ne se relance pas.
    expect((await appeler('POST', `${url}/${id}/relancer`, d.assistant.jeton, {})).statut).toBe(403);
    expect((await appeler('POST', `${url}/${id}/relancer`, d.associe.jeton, {})).corps.relances).toBe(1);
    for (let i = 0; i < 4; i += 1) await appeler('POST', `${url}/${b}/relancer`, d.associe.jeton, {});
    expect((await lire(d.associe)).find((q) => q.id === b)?.relances).toBe(3);
    // Le cabinet ne répond pas à la place du client ; le client répond, et la relance n'a plus lieu d'être.
    expect((await appeler('POST', `${url}/${id}/repondre`, d.associe.jeton, { texte: 'Oui' })).statut).toBe(403);
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.repondre_question($1, $2, $3)', [d.ent, id, 'Oui'])))
      .rejects.toThrow('seule l\'entreprise répond aux questions de son cabinet');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: '   ' })).corps.motif).toBe('Une réponse vide ne répond à rien.');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'Elle est jointe à l\'achat FF-12.' })).statut).toBe(200);
    const vue = (await lire(d.associe)).find((q) => q.id === id);
    expect([vue?.statut, vue?.reponse, vue?.texte]).toEqual(['repondue', 'Elle est jointe à l\'achat FF-12.', 'Peux-tu m\'envoyer la facture du virement du 12 mars ?']);
    expect((await appeler('POST', `${url}/${id}/relancer`, d.associe.jeton, {})).corps.motif).toBe('Cette question a reçu sa réponse : il n\'y a plus rien à relancer.');
    expect((await aFaire()).map((x) => [x.ouvertes, x.enRetard, x.repondues])).toEqual([[1, 0, 1]]);
    // Répondue, elle ne se réécrit plus ; fermée, le client n'y répond plus ; rouverte, elle retrouve sa réponse.
    expect((await appeler('PUT', `${url}/${id}`, d.associe.jeton, { texte: 'Autre' })).corps.motif).toBe('Cette question a reçu sa réponse : elle ne se réécrit plus.');
    expect((await appeler('POST', `${url}/${id}/fermer`, d.associe.jeton, {})).corps.statut).toBe('close');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'Encore' })).corps.motif).toBe('Cette question est fermée : ton cabinet n\'attend plus de réponse.');
    expect((await appeler('POST', `${url}/${id}/fermer`, d.associe.jeton, { rouvrir: true })).corps.statut).toBe('repondue');
  });

  it('(1.388.86) les relances automatiques : la question en retard part une fois par semaine, trois fois au plus, et seulement sous un mandat actif', async () => {
    const d = await dossier();
    await admin.query('update socle.utilisateur set adresse_verifiee_le = now() where id = $1', [d.client.utilisateur]);
    const url = `/entreprises/${d.ent}/compta/questions`;
    const id = String((await appeler('POST', url, d.associe.jeton, { ...QUESTION, pour: jourDeTunis(0) })).corps.id);
    const dues = async () => ((await admin.query('select messagerie.relances_dues(now()) r')).rows[0].r as { question?: string }[]).filter((x) => x.question === id);
    // Pour aujourd'hui : elle est due ; le postier la note — la base compte, et la semaine qui suit elle se tait.
    expect((await dues()).length).toBeGreaterThan(0);
    await admin.query('select compta.question_relancee($1, now())', [id]);
    expect(await dues()).toEqual([]);
    expect((await admin.query('select relances from compta.question where id = $1', [id])).rows[0].relances).toBe(1);
    // Personne ne note une relance à la place du serveur.
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.question_relancee($1, now())', [id]))).rejects.toThrow('seul le serveur note une relance partie');
    // Huit jours plus tard, elle repart ; trois relances, et elle se tait pour de bon.
    await admin.query(`update compta.question set relance_le = now() - interval '8 days' where id = $1`, [id]);
    expect((await dues()).length).toBeGreaterThan(0);
    await admin.query(`update compta.question set relances = 3 where id = $1`, [id]);
    expect(await dues()).toEqual([]);
    // Sans date « pour le », jamais de relance automatique.
    const sans = String((await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-20' })).corps.id);
    expect(((await admin.query('select messagerie.relances_dues(now()) r')).rows[0].r as { question?: string }[]).some((x) => x.question === sans)).toBe(false);
  });

  it('(1.187.0) on nomme celles qui partent : « Envoyer maintenant », les gardées de la conversation ; les mêmes règles', async () => {
    const d = await dossier();
    const url = `/entreprises/${d.ent}/compta/questions`;
    const lire = async (p: Personne) => (await appeler('GET', `${url}?annee=2026`, p.jeton)).corps.questions as Question[];
    const a = String((await appeler('POST', url, d.associe.jeton, { ...QUESTION, garder: true })).corps.id);
    const b = String((await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-13', texte: 'Et celle-ci ?', garder: true })).corps.id);
    // L'une ou l'autre, ou l'année : jamais les deux à la fois, ni une liste vide.
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { annee: 2026, ids: [a] })).statut).toBe(400);
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { ids: [] })).statut).toBe(400);
    // Qui valide envoie (l'assistant non) ; seule celle qu'on nomme part.
    expect((await appeler('POST', `${url}/envoyer`, d.assistant.jeton, { ids: [a] })).statut).toBe(403);
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { ids: [a] })).corps.envoyees).toBe(1);
    expect((await lire(d.client)).map((q) => q.id)).toEqual([a]);
    // La même : elle est partie, elle se relance de sa ligne ; avec une gardée, seule la gardée part.
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { ids: [a] })).corps.motif)
      .toBe('Aucune de ces questions n\'attend de partir : celles qui sont parties se relancent de leur ligne.');
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { ids: [a, b] })).corps.envoyees).toBe(1);
    expect((await lire(d.client)).map((q) => q.id).sort()).toEqual([a, b].sort());
    // Une question inconnue ne part pas ; le client n'envoie rien.
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { ids: ['00000000-0000-4000-8000-000000000000'] })).corps.motif)
      .toBe('Aucune de ces questions n\'attend de partir : celles qui sont parties se relancent de leur ligne.');
    expect((await appeler('POST', `${url}/envoyer`, d.client.jeton, { ids: [a] })).statut).toBe(403);
  });

  it('seul le cabinet pose ; une question sans texte, ou qui attend on ne sait quoi, se refuse — à la porte et dans la base', async () => {
    const d = await dossier();
    const url = `/entreprises/${d.ent}/compta/questions`;
    expect((await appeler('POST', url, d.client.jeton, QUESTION)).statut).toBe(403);
    await expect(enTantQue(pool, d.client.utilisateur, (tx) => tx.query('select compta.poser_question($1, $2::jsonb)', [d.ent, JSON.stringify({ ...QUESTION, montant: 0 })])))
      .rejects.toThrow('seul le cabinet de l\'entreprise lui pose des questions');
    const vide = await appeler('POST', url, d.associe.jeton, { ...QUESTION, texte: '  ' });
    expect(vide.corps.motif).toBe('Une question sans texte n\'apprend rien au client.');
    expect((await appeler('POST', url, d.associe.jeton, { ...QUESTION, attendu: 'correction' })).statut).toBe(400);
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.poser_question($1, $2::jsonb)', [d.ent, JSON.stringify({ ...QUESTION, montant: 0, attendu: 'correction' })])))
      .rejects.toThrow('ce que la question attend en retour n\'est pas connu');
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.poser_question($1, $2::jsonb)', [d.ent, JSON.stringify({ ...QUESTION, montant: 1.5 })])))
      .rejects.toThrow('un montant se donne en millimes');
    // Sans la comptabilité au mandat : plus de question.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['saisie_achats'] })).statut).toBe(200);
    expect((await appeler('POST', url, d.associe.jeton, QUESTION)).statut).toBe(403);
  });
});
