// La clôture de l'exercice et sa réouverture (brique 45 ; docs/cabinet.md, C35), par l'API et dans la
// base. Ce que le serveur garantit :
//   - clôturer valide la période jusqu'au dernier jour de l'exercice et le marque clos (qui, quand) ;
//     jamais un exercice qui court encore, jamais avec une écriture au brouillard jusque-là ;
//   - clos, plus rien ne s'y écrit ; le rouvrir exige un motif, remet la période close où elle était
//     avant la clôture, et se garde (quand, qui, pourquoi) ; jamais si des jours d'après sont validés ;
//   - qui : qui valide ; au cabinet, l'associé seulement — à la porte et dans la base.


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
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const exercice = async (ent: string, p: Personne, annee: number) =>
  ((await appeler('GET', `/entreprises/${ent}/compta/exercices`, p.jeton)).corps.exercices as { annee: number; closLe: string | null; closPar: string | null;
    reouvertures: { motif: string; par: string; le: string; closLe: string }[] }[]).find((x) => x.annee === annee);
const saisir = (ent: string, p: Personne, date: string) => appeler('POST', `/entreprises/${ent}/compta/ecritures`, p.jeton, {
  date, journal: 'OD', piece: `OD-${date}`, libelle: 'Honoraires à payer', lignes: [{ compte: '6226', debit: '300,125' }, { compte: '4286', credit: '300,125' }] });
const cloturer = (ent: string, p: Personne, annee: number) => appeler('POST', `/entreprises/${ent}/compta/exercices/${annee}/cloturer`, p.jeton, {});
const rouvrir = (ent: string, p: Personne, annee: number, motif: string) => appeler('POST', `/entreprises/${ent}/compta/exercices/${annee}/rouvrir`, p.jeton, { motif });
const jusqua = async (ent: string) => ((await admin.query('select to_char(jusqua, \'YYYY-MM-DD\') j from compta.cloture where entreprise = $1', [ent])).rows[0]?.j as string | undefined) ?? null;

describe('la clôture de l\'exercice', () => {
  it('se clôt fini et sans brouillard ; clos, plus rien ne s\'y écrit ; rouvert avec un motif, la période revient où elle était', async () => {
    const d = await dossier();
    const od = String((await saisir(d.ent, d.associe, '2025-03-10')).corps.id);
    // Une écriture au brouillard : la clôture ne la valide pas en silence.
    const brouillard = await cloturer(d.ent, d.associe, 2025);
    expect(brouillard.corps.motif).toBe('Il reste 1 écriture au brouillard jusqu\'au 31/12/2025 : valide-les ou supprime-les, puis clôture.');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.associe.jeton, { ids: [od] })).statut).toBe(200);
    // Un exercice qui court encore ne se clôture pas.
    const annee = new Date().getUTCFullYear();
    expect((await cloturer(d.ent, d.associe, annee)).corps.motif).toBe(`L'exercice ${annee} n'est pas fini : il se clôture à partir du 01/01/${annee + 1}.`);
    // Clôturé : la période validée jusqu'au 31 décembre, l'exercice clos au nom de l'associé.
    const r = await cloturer(d.ent, d.associe, 2025);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps.jusqua).toBe('2025-12-31');
    expect(await jusqua(d.ent)).toBe('2025-12-31');
    expect(await exercice(d.ent, d.associe, 2025)).toMatchObject({ closPar: 'associe', reouvertures: [] });
    expect((await cloturer(d.ent, d.associe, 2025)).corps.motif).toMatch(/^L'exercice 2025 est déjà clos depuis le \d{2}\/\d{2}\/\d{4}\.$/);
    // Clos, plus rien ne s'y écrit.
    expect((await saisir(d.ent, d.associe, '2025-06-01')).corps.motif).toBe('La période est validée jusqu\'au 31/12/2025 : une écriture ne s\'y écrit plus.');
    // Le rouvrir : un motif, sinon rien.
    expect((await rouvrir(d.ent, d.associe, 2025, 'oups')).corps.motif).toBe('Une réouverture demande un motif : c\'est la seule trace qui expliquera pourquoi un chiffre a changé après coup.');
    expect((await exercice(d.ent, d.associe, 2025))?.closLe).not.toBeNull();
    expect((await rouvrir(d.ent, d.associe, 2025, 'Facture d\'électricité de décembre reçue après la clôture')).statut).toBe(200);
    // Rien n'était validé avant la clôture : rien ne l'est plus comme période ; l'écriture validée, elle, le reste.
    expect(await jusqua(d.ent)).toBeNull();
    expect((await saisir(d.ent, d.associe, '2025-12-20')).statut).toBe(201);
    const lu = await exercice(d.ent, d.associe, 2025);
    expect(lu?.closLe).toBeNull();
    expect(lu?.reouvertures.map((x) => [x.motif, x.par])).toEqual([['Facture d\'électricité de décembre reçue après la clôture', 'associe']]);
    expect((await rouvrir(d.ent, d.associe, 2025, 'Encore une fois')).corps.motif).toBe('Cet exercice n\'est pas clos.');
    const traces = (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'compta.exercice.%' order by instant, id`, [d.ent])).rows.map((x) => x.geste);
    expect(traces).toEqual(['compta.exercice.cloturer', 'compta.exercice.rouvrir']);
  });

  it('rouvert, la période revient à ce qui était validé avant la clôture ; jamais si des jours d\'après sont validés', async () => {
    const d = await dossier();
    await saisir(d.ent, d.associe, '2025-03-10');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.associe.jeton, { jusqua: '2025-06-30' })).statut).toBe(200);
    await saisir(d.ent, d.associe, '2025-09-15');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.associe.jeton, { jusqua: '2025-09-30' })).statut).toBe(200);
    expect((await cloturer(d.ent, d.associe, 2025)).statut).toBe(200);
    expect((await rouvrir(d.ent, d.associe, 2025, 'Un avoir de novembre oublié')).statut).toBe(200);
    // Validé jusqu'au 30 septembre avant la clôture : c'est là que la période revient.
    expect(await jusqua(d.ent)).toBe('2025-09-30');
    expect((await saisir(d.ent, d.associe, '2025-09-20')).corps.motif).toBe('La période est validée jusqu\'au 30/09/2025 : une écriture ne s\'y écrit plus.');
    expect((await saisir(d.ent, d.associe, '2025-11-20')).statut).toBe(201);
    // Reclos, puis janvier 2026 validé : rouvrir 2025 rouvrirait aussi janvier.
    const nov = (await appeler('GET', `/entreprises/${d.ent}/compta/ecritures?limite=500`, d.associe.jeton)).corps.ecritures as { id: string; statut: string }[];
    await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.associe.jeton, { ids: nov.filter((e) => e.statut === 'brouillard').map((e) => e.id) });
    expect((await cloturer(d.ent, d.associe, 2025)).statut).toBe(200);
    await saisir(d.ent, d.associe, '2026-01-15');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.associe.jeton, { jusqua: '2026-01-31' })).statut).toBe(200);
    expect((await rouvrir(d.ent, d.associe, 2025, 'Une erreur de compte')).corps.motif)
      .toBe('La période est validée jusqu\'au 31/01/2026, après la fin de l\'exercice 2025 : le rouvrir rouvrirait aussi ces jours-là.');
    expect(await jusqua(d.ent)).toBe('2026-01-31');
  });

  it('qui clôture : l\'associé ; ni le collaborateur, ni l\'entreprise sous mandat — à la porte et dans la base', async () => {
    const d = await dossier();
    const refus = await cloturer(d.ent, d.collaborateur, 2025);
    expect(refus.statut).toBe(403);
    // La porte le dit (et la base refuse aussi, juste en dessous).
    expect(String(refus.corps.motif)).toMatch(/^Ton rôle \(Collaborateur\) ne permet pas de clôturer l'exercice/);
    await expect(enTantQue(pool, d.collaborateur.utilisateur, (tx) => tx.query('select compta.cloturer_exercice($1, 2025)', [d.ent])))
      .rejects.toThrow('au cabinet, clôturer ou rouvrir un exercice revient à l\'associé');
    expect((await cloturer(d.ent, d.assistant, 2025)).statut).toBe(403);
    expect((await cloturer(d.ent, d.client, 2025)).corps.motif).toBe('Avec un mandat de comptabilité, c\'est le cabinet qui valide les écritures.');
    expect((await cloturer(d.ent, d.associe, 2025)).statut).toBe(200);
    expect((await rouvrir(d.ent, d.collaborateur, 2025, 'Un motif suffisant')).statut).toBe(403);
    await expect(enTantQue(pool, d.collaborateur.utilisateur, (tx) => tx.query('select compta.rouvrir_exercice($1, 2025, $2)', [d.ent, 'Un motif suffisant'])))
      .rejects.toThrow('au cabinet, clôturer ou rouvrir un exercice revient à l\'associé');
  });
});
