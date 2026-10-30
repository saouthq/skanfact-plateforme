// Imputer depuis la réponse d'une question (1.180.0, base 0184 ; maquette « Messages » : « Imputer le virement »). Ce que
// le serveur garantit :
//   - la conversation du cabinet dit ce que l'imputation sortirait du compte de la question : le montant et son sens, lus
//     dans le livre (la ligne de la question), jamais envoyés par l'écran ; le client n'en lit rien ;
//   - imputer pose UNE écriture au brouillard : le compte de la question soldé, la contrepartie choisie, le libellé de la
//     réponse ; une seconde imputation est refusée tant que la première existe ; effacée, la question redevient imputable ;
//   - pas d'imputation sans la réponse du client, vers le même compte, ni par le client.

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

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.body ? r.json() : {} };
}
async function personne(nom: string) {
  const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  return { email, jeton };
}
type Imputation = { compte: string; montant: string; sens: string; banque: boolean; faite: string | null } | null;

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('imputer depuis la réponse d\'une question', () => {
  it('le virement en attente sort du 471 vers le compte du client, au brouillard, une seule fois', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await appeler('POST', '/cabinets', leila.jeton, { nom: 'Jlassi Conseil' })).corps;
    const sarra = await personne('Sarra Ben Amor');
    const ent = String((await appeler('POST', '/entreprises', sarra.jeton, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, sarra.jeton, { codeCabinet: String(cab.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${String(cab.id)}/mandats/${mandat}/accepter`, leila.jeton)).statut).toBe(200);

    // Un virement reçu le 14/09 que personne ne sait expliquer : au compte d'attente. 1 250,375 DT (un montant qui
    // discrimine : rien d'arrondi).
    const vir = await appeler('POST', `/entreprises/${ent}/compta/ecritures`, leila.jeton, { date: '2026-09-14', journal: 'BQ', piece: 'VIR 14/09', libelle: 'Virement reçu',
      lignes: [{ compte: '532', debit: '1250,375' }, { compte: '471', credit: '1250,375' }] });
    expect(vir.statut).toBe(201);
    const q = await appeler('POST', `/entreprises/${ent}/compta/questions`, leila.jeton, { periode: '2026-09', compte: '471', ecriture: vir.corps.id, piece: 'VIR 14/09',
      montant: '1250,375', objet: 'Un virement reçu le 14/09', texte: 'À quoi correspond ce virement ?', attendu: 'explication' });
    expect(q.statut).toBe(201);
    const question = String(q.corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/compta/questions/envoyer`, leila.jeton, { annee: 2026 })).statut).toBe(200);

    // Sans réponse du client : rien à imputer.
    const imputer = (j: string, corps: Record<string, unknown>) => appeler('POST', `/entreprises/${ent}/compta/questions/${question}/imputer`, j, corps);
    expect((await imputer(leila.jeton, { contrepartie: '411', date: '2026-10-30' })).corps.motif).toBe('Cette question attend la réponse du client : l\'imputation vient après.');
    expect((await appeler('POST', `/entreprises/${ent}/compta/questions/${question}/repondre`, sarra.jeton, { texte: 'C\'est l\'acompte de la Clinique Les Jasmins pour les gâteaux du 30/09.' })).statut).toBe(200);

    // La conversation du cabinet dit ce que l'imputation sortirait ; celle du client n'en dit rien.
    const imputation = async (cote: 'cabinet' | 'entreprise', j: string) => ((await appeler('GET', `/entreprises/${ent}/messages?cote=${cote}`, j)).corps.questions as { id: string; imputation: Imputation }[])
      .find((x) => x.id === question)?.imputation;
    expect(await imputation('cabinet', leila.jeton)).toEqual({ compte: '471', montant: '1250.375', sens: 'credit', banque: true, faite: null });
    expect(await imputation('entreprise', sarra.jeton)).toBeNull();

    // Vers le même compte, ou par le client : refusé.
    expect((await imputer(leila.jeton, { contrepartie: '471', date: '2026-10-30' })).corps.motif).toBe('Le montant sort de ce compte : il va vers un autre.');
    expect((await imputer(sarra.jeton, { contrepartie: '411', date: '2026-10-30' })).statut).toBeGreaterThanOrEqual(400);

    // Imputer : une écriture au brouillard, 471 débité, 411 crédité, du montant du livre, la réponse en libellé.
    const fait = await imputer(leila.jeton, { contrepartie: '411', date: '2026-10-30' });
    expect(fait.statut).toBe(201);
    const ecriture = String(fait.corps.ecriture);
    const lignes = (await admin.query('select compte, debit::text, credit::text, libelle from compta.ligne where ecriture = $1 order by rang', [ecriture])).rows;
    expect(lignes).toEqual([
      { compte: '471', debit: '1250375', credit: '0', libelle: 'Imputation : C\'est l\'acompte de la Clinique Les Jasmins pour les gâteaux du 30/09.' },
      { compte: '411', debit: '0', credit: '1250375', libelle: 'Imputation : C\'est l\'acompte de la Clinique Les Jasmins pour les gâteaux du 30/09.' },
    ]);
    const e = (await admin.query('select journal, date_ecriture::text jour, numero, piece from compta.ecriture where id = $1', [ecriture])).rows[0];
    expect([e.journal, e.jour, e.numero, e.piece]).toEqual(['OD', '2026-10-30', null, 'VIR 14/09']);
    expect((await imputation('cabinet', leila.jeton))?.faite).toBe(ecriture);

    // Une seconde fois : refusé. Le brouillard effacé, la question redevient imputable.
    expect((await imputer(leila.jeton, { contrepartie: '411', date: '2026-10-30' })).corps.motif).toBe('Cette question est déjà imputée : son écriture est au brouillard.');
    expect((await appeler('DELETE', `/entreprises/${ent}/compta/ecritures/${ecriture}?revision=1`, leila.jeton)).statut).toBe(200);
    expect((await imputation('cabinet', leila.jeton))?.faite).toBeNull();
    expect((await imputer(leila.jeton, { contrepartie: '4111', date: '2026-10-30', libelle: 'Acompte Clinique Les Jasmins' })).statut).toBe(201);
  });
});
