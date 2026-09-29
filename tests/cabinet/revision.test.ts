// La révision et les questions au client (brique 44 ; docs/cabinet.md, C32 et C33), par l'API. Ce que
// le serveur garantit :
//   - la révision d'une période est le dossier de travail du cabinet : entière, avec sa révision (deux
//     postes ne s'écrasent pas), écrite par qui révise (l'associé, le collaborateur), jamais par
//     l'assistant ni par le client, qui ne la lit pas ;
//   - une question appartient à l'entreprise : le client ne la voit qu'une fois envoyée ; jamais
//     envoyée, elle se retire ; envoyée, elle se ferme ; chaque envoi se compte ; le client y répond,
//     et une question qui a sa réponse ne se réécrit plus ;
//   - « À faire » du cabinet compte, dossier par dossier, ce qui attend et ce qui est à relancer.

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
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['declarations'] })).statut).toBe(200);
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

type Question = { id: string; statut: string; envois: string[]; reponse: string | null; montant: string; texte: string; periode: string };
const QUESTION = { periode: '2026-03', compte: '471', piece: 'FF-12', montant: '1200.5', objet: 'Justificatif absent', texte: 'Peux-tu m\'envoyer la facture de ce virement ?', attendu: 'piece' };

describe('les questions au client', () => {
  it('posée, elle reste au cabinet ; envoyée, le client la lit et y répond ; chaque envoi se compte', async () => {
    const d = await dossier();
    const url = `/entreprises/${d.ent}/compta/questions`;
    const lire = async (p: Personne, annee = '2026') => (await appeler('GET', `${url}?annee=${annee}`, p.jeton)).corps.questions as Question[];
    // L'assistant pose (qui saisit, comme la v10) ; le montant se garde au millime.
    const r = await appeler('POST', url, d.assistant.jeton, QUESTION);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const id = String(r.corps.id);
    expect((await lire(d.associe)).map((q) => [q.statut, q.montant, q.envois.length])).toEqual([['ouverte', '1200.500', 0]]);
    // Jamais envoyée : le client ne la voit pas, ni ne peut y répondre.
    expect(await lire(d.client)).toEqual([]);
    const pasVue = await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'La voici' });
    expect(pasVue.corps.motif).toBe('Cette question n\'existe plus.');
    // Une seconde, retirée avant tout envoi : elle s'efface.
    const autre = String((await appeler('POST', url, d.associe.jeton, { ...QUESTION, piece: 'FF-13' })).corps.id);
    expect((await appeler('DELETE', `${url}/${autre}`, d.associe.jeton)).statut).toBe(200);
    // Envoyer : qui valide (l'assistant non), les questions de l'année.
    expect((await appeler('POST', `${url}/envoyer`, d.assistant.jeton, { annee: 2026 })).statut).toBe(403);
    expect((await appeler('POST', `${url}/envoyer`, d.associe.jeton, { annee: 2025 })).corps.motif).toBe('Aucune question n\'attend de réponse : il n\'y aurait rien à envoyer.');
    expect((await appeler('POST', `${url}/envoyer`, d.collaborateur.jeton, { annee: 2026 })).corps.envoyees).toBe(1);
    expect((await lire(d.client)).map((q) => [q.id, q.statut, q.envois.length])).toEqual([[id, 'envoyee', 1]]);
    expect(await lire(d.client, '2025')).toEqual([]);
    // Un seul envoi sans réponse : elle attend, elle n'est pas encore à relancer.
    expect((await appeler('GET', `/cabinets/${d.cabinet}/questions`, d.associe.jeton)).corps.dossiers).toEqual([{ entreprise: d.ent, ouvertes: 1, aRelancer: 0, repondues: 0 }]);
    // Envoyée, elle ne s'efface plus ; elle se précise encore.
    expect((await appeler('DELETE', `${url}/${id}`, d.associe.jeton)).corps.motif).toBe('Cette question est déjà partie chez le client : elle se ferme, elle ne s\'efface pas.');
    expect((await appeler('PUT', `${url}/${id}`, d.associe.jeton, { texte: 'Peux-tu m\'envoyer la facture du virement du 12 mars ?' })).statut).toBe(200);
    // Deux envois sans réponse : « À faire » la compte à relancer.
    await appeler('POST', `${url}/envoyer`, d.associe.jeton, { annee: 2026 });
    const aFaire = async () => (await appeler('GET', `/cabinets/${d.cabinet}/questions`, d.associe.jeton)).corps.dossiers;
    expect(await aFaire()).toEqual([{ entreprise: d.ent, ouvertes: 1, aRelancer: 1, repondues: 0 }]);
    // Le cabinet ne répond pas à la place du client ; le client répond.
    expect((await appeler('POST', `${url}/${id}/repondre`, d.associe.jeton, { texte: 'Oui' })).statut).toBe(403);
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.repondre_question($1, $2, $3)', [d.ent, id, 'Oui'])))
      .rejects.toThrow('seule l\'entreprise répond aux questions de son cabinet');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: '   ' })).corps.motif).toBe('Une réponse vide ne répond à rien.');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'Elle est jointe à l\'achat FF-12.' })).statut).toBe(200);
    const vue = (await lire(d.associe))[0];
    expect([vue?.statut, vue?.reponse, vue?.texte]).toEqual(['repondue', 'Elle est jointe à l\'achat FF-12.', 'Peux-tu m\'envoyer la facture du virement du 12 mars ?']);
    expect(await aFaire()).toEqual([{ entreprise: d.ent, ouvertes: 0, aRelancer: 0, repondues: 1 }]);
    // Répondue, elle ne se réécrit plus ; elle se ferme, et fermée le client n'y répond plus ; rouverte, elle retrouve sa réponse.
    expect((await appeler('PUT', `${url}/${id}`, d.associe.jeton, { texte: 'Autre chose' })).corps.motif).toBe('Cette question a reçu sa réponse : elle ne se réécrit plus.');
    expect((await appeler('POST', `${url}/${id}/fermer`, d.associe.jeton, {})).corps.statut).toBe('close');
    expect((await appeler('POST', `${url}/${id}/repondre`, d.client.jeton, { texte: 'Encore' })).corps.motif).toBe('Cette question est fermée : ton cabinet n\'attend plus de réponse.');
    expect((await appeler('POST', `${url}/${id}/fermer`, d.associe.jeton, { rouvrir: true })).corps.statut).toBe('repondue');
    // Ce que le client a vu, le journal du client le dit.
    const traces = (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'compta.question%' order by instant, id`, [d.ent])).rows.map((x) => x.geste);
    expect(traces).toEqual(['compta.question.poser', 'compta.question.poser', 'compta.question.retirer', 'compta.questions.envoyer', 'compta.question.modifier',
      'compta.questions.envoyer', 'compta.question.repondre', 'compta.question.fermer', 'compta.question.rouvrir']);
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
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['declarations'] })).statut).toBe(200);
    expect((await appeler('POST', url, d.associe.jeton, QUESTION)).statut).toBe(403);
  });
});
