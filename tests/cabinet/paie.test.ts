// La paie tenue par le cabinet (brique 43 ; docs/cabinet.md, C31), par l'API. Ce que le serveur
// garantit :
//   - le cabinet lit et écrit les salariés et les bulletins d'un client dans le MÊME dossier que le
//     client, s'il a le mandat de la paie, et seulement ces deux collections ;
//   - chaque bulletin y est recalculé par le moteur du serveur (un millime d'écart : refusé), la paie
//     du serveur le tient, et l'écriture de paie du mois suit ;
//   - qui peut : l'associé ou le collaborateur Paie du cabinet, si le mandat comprend la paie ; le
//     propriétaire ; pas le collaborateur comptable.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { appliquer, type Changement } from '../../serveur/v10/dossier.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';
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




type Reglages = Record<string, unknown>;
const ecran = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Record<string, unknown>, i: Record<string, unknown>, s: Reglages) => Record<string, unknown>; baremesPaie: (r: Reglages) => Reglages };
// Un nombre non entier part en texte exact, comme le point de contact l'écrit.
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const SALARIE = { id: 'sal-1', name: 'Amel Trabelsi', cin: '', cnss: '12345678', position: 'Serveuse', contract: 'cdi', hireDate: '2025-01-01', endDate: '',
  grossSalary: 1250.5, headOfFamily: true, children: 2, method: 'virement', iban: '', notes: '' };
function bulletin(mois: number, calcul?: (c: Record<string, unknown>) => Record<string, unknown>) {
  const saisie = { gross: 1250.5, workedDays: 26, absentDays: 0, bonuses: [{ label: 'Prime de rendement', amount: 100.25, taxable: true }], deductions: [] };
  const computed = ecran.computePayslip(SALARIE, saisie, ecran.baremesPaie({}));
  return { id: `bul-${mois}`, employeeId: 'sal-1', year: 2025, month: mois, ...saisie, computed: calcul ? calcul(computed) : computed,
    paidDate: '', accountId: '', method: 'virement', reference: '', issuedAt: '2025-12-31' };
}
const ecrire = (ent: string, p: Personne, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/paie/dossier`, p.jeton, { changements });
const objet = (collection: string, contenu: { id: string }) => ({ collection, cle: contenu.id, rang: null, revision: null, contenu: encoder(contenu) });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la paie tenue par le cabinet', () => {
  it('avec le mandat de la paie, l\'associé tient les salariés et les bulletins du client : recalculés au serveur, écrits au livre ; sans lui, rien', async () => {
    const d = await dossier();
    // Le mandat par défaut ne comprend pas la paie : ni lire, ni écrire.
    expect((await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, d.associe.jeton)).statut).toBe(403);
    // La porte le dit (et la base refuserait aussi : voir le test suivant).
    expect((await ecrire(d.ent, d.associe, [objet('employees', SALARIE)])).corps.motif)
      .toBe('Le mandat de ton cabinet ne comprend pas la paie : seul le propriétaire de l\'entreprise peut l\'ouvrir (ici, tenir les fiches des salariés et établir leurs bulletins).');
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(200);
    // Seulement les salariés et les bulletins.
    expect((await ecrire(d.ent, d.associe, [{ ...objet('documents', { id: 'f-1' }) }])).statut).toBe(400);
    // Un bulletin dont un montant ne tombe pas juste : refusé, et rien n'est écrit.
    const faux = await ecrire(d.ent, d.associe, [objet('employees', SALARIE), objet('payslips', bulletin(3, (c) => ({ ...c, net: Number(c.net) + 0.001 })))]);
    expect(faux.statut).toBe(403);
    expect(String(faux.corps.motif)).toMatch(/Amel Trabelsi/);
    expect((await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, d.associe.jeton)).corps.objets).toEqual([]);
    // Juste : le salarié et son bulletin entrent, la paie du serveur les tient.
    const r = await ecrire(d.ent, d.associe, [objet('employees', SALARIE), objet('payslips', bulletin(3))]);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const lus = (await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, d.associe.jeton)).corps.objets as { collection: string; cle: string; revision: number }[];
    expect(lus.map((o) => [o.collection, o.cle, o.revision])).toEqual([['employees', 'sal-1', 1], ['payslips', 'bul-3', 1]]);
    const bulletins = (await appeler('GET', `/entreprises/${d.ent}/paie/bulletins?annee=2025`, d.associe.jeton)).corps.lignes as { mois: number; net: string }[];
    expect(bulletins.map((b) => b.mois)).toEqual([3]);
    expect(bulletins[0]?.net).toBe(Number(bulletin(3).computed.net).toFixed(3));
    // L'écriture de paie du mois suit, au journal de la paie.
    const ecritures = (await appeler('GET', `/entreprises/${d.ent}/compta/ecritures?limite=500`, d.associe.jeton)).corps.ecritures as { journal: string; date: string }[];
    expect(ecritures.filter((e) => e.journal === 'PAIE').map((e) => e.date)).toEqual(['2025-03-31']);
    // Le client voit le même dossier : une seule paie.
    const client = (await appeler('GET', `/entreprises/${d.ent}/dossier-v10`, d.client.jeton)).corps.objets as { collection: string; cle: string }[];
    expect(client.filter((o) => ['employees', 'payslips'].includes(o.collection)).map((o) => o.cle).sort()).toEqual(['bul-3', 'sal-1']);
  });

  it('dans la base, le cabinet ne lit du dossier v10 du client que son plan et, sous un mandat de paie, sa paie ; le client lit tout', async () => {
    const d = await dossier();
    // Le dossier v10 du client : son plan, un client, une facture, les réglages de sa société, un salarié.
    const poser = async (collection: string, cle: string, contenu: unknown) => admin.query(
      `insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, $2, $3, $4)`, [d.ent, collection, cle, JSON.stringify(contenu)]);
    await admin.query('delete from socle.dossier_v10 where entreprise = $1', [d.ent]);
    await poser('_racine', 'chartAccounts', []);
    await poser('_racine', 'company', { name: 'Menuiserie Ben Salah', iban: 'TN59 1000 6035 1835 9847 8831' });
    await poser('accounts', 'bq1', { id: 'bq1', kind: 'banque' });
    await poser('clients', 'c1', { id: 'c1', name: 'Hôtel du Lac', email: 'achats@hotel.tn' });
    await poser('documents', 'f1', { id: 'f1', number: 'FAC-1' });
    await poser('employees', 'sal-1', { id: 'sal-1', name: 'Amel Trabelsi' });
    const lu = async (p: Personne) => (await enTantQue(pool, p.utilisateur, (tx) => tx.query('select collection, cle from socle.dossier_v10 where entreprise = $1', [d.ent])))
      .rows.map((r) => `${r.collection}/${r.cle}`).sort();  // l'ordre de JavaScript : la collation de la base varie d'un poste à l'autre
    const PLAN = ['_racine/chartAccounts', 'accounts/bq1', 'clients/c1'];
    // Le mandat de comptabilité : le plan seulement ; ni les pièces, ni la société, ni la paie.
    expect(await lu(d.associe)).toEqual(PLAN);
    expect(await lu(d.collaborateur)).toEqual(PLAN);
    // Rien ne s'écrit hors de ce qu'il lit.
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query(
      `update socle.dossier_v10 set contenu = '{"id":"f1","number":"FAC-9"}' where entreprise = $1 and collection = 'documents'`, [d.ent]))).resolves.toMatchObject({ rowCount: 0 });
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query(
      `insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, 'documents', 'f2', '{}')`, [d.ent]))).rejects.toThrow(/row-level security/);
    // Sous un mandat qui comprend la paie : la paie aussi.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(200);
    expect(await lu(d.associe)).toEqual([...PLAN, 'employees/sal-1']);
    // Le client lit tout.
    expect(await lu(d.client)).toEqual(['_racine/chartAccounts', '_racine/company', 'accounts/bq1', 'clients/c1', 'documents/f1', 'employees/sal-1']);
  });

  it('qui peut : l\'associé et le collaborateur Paie, le propriétaire ; pas le collaborateur comptable', async () => {
    const d = await dossier();
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(200);
    expect((await ecrire(d.ent, d.collaborateur, [objet('employees', SALARIE)])).statut).toBe(403);
    expect((await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, d.collaborateur.jeton)).statut).toBe(403);
    // Même par le chemin d'enregistrement, sans la porte : la base refuse la paie à qui ne la fait pas.
    await expect(enTantQue(pool, d.collaborateur.utilisateur, (tx) => appliquer(tx, d.ent, d.collaborateur.utilisateur,
      [objet('employees', SALARIE), objet('payslips', bulletin(4))] as Changement[]))).rejects.toThrow();
    expect(Number((await admin.query('select count(*) n from paie.bulletin where entreprise = $1', [d.ent])).rows[0].n)).toBe(0);
    const p = await personne('paie');
    const id = String((await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [p.utilisateur, d.cabinet, ['paie']])).rows[0].id);
    expect((await appeler('PUT', `/cabinets/${d.cabinet}/mandats/${d.mandat}/affectations/${id}`, d.associe.jeton, { role: 'paie' })).statut).toBe(200);
    expect((await ecrire(d.ent, p, [objet('employees', SALARIE)])).statut).toBe(200);
    expect((await ecrire(d.ent, d.client, [objet('payslips', bulletin(4))])).statut).toBe(200);
    expect(((await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, p.jeton)).corps.objets as unknown[]).length).toBe(2);
  });
});
