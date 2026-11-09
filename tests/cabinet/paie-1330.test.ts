// (1.330.0) Le pointage VALIDÉ par le client, lu au Cabinet (docs/paie.md, 1.330.0). Joué à la souris : la boulangerie a
// validé octobre (chacun présent à ses horaires : aucune grille), et le Cabinet disait « 1 sur 2 salariés pointés », « Un
// mois sans pointage ». Le cabinet lit les versions validées et les mois rouverts (migration 0205), sans pouvoir les
// écrire ; la paie de ses dossiers compte le mois validé ; un mois rouvert ne l'est plus.
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




const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const SALARIE = { id: 'sal-1', name: 'Amel Trabelsi', cin: '', cnss: '12345678', position: 'Serveuse', contract: 'cdi', hireDate: '2025-01-01', endDate: '',
  grossSalary: 1250.5, headOfFamily: true, children: 2, method: 'virement', iban: '', notes: '' };
const ecrire = (ent: string, p: Personne, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/paie/dossier`, p.jeton, { changements });
const objet = (collection: string, contenu: { id: string } & Record<string, unknown>) => ({ collection, cle: contenu.id, rang: null, revision: null, contenu: encoder(contenu) });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('(1.330.0) le pointage validé par le client, lu au Cabinet', () => {
  it('lu sans être écrit : la version validée compte chacun pointé, la paie de mes dossiers le dit ; rouvert, plus rien', async () => {
    const d = await dossier();
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(200);
    // Deux salariés, aucune grille : pointer à la main, c'est noter ce qui change.
    expect((await ecrire(d.ent, d.associe, [objet('employees', SALARIE), objet('employees', { ...SALARIE, id: 'sal-2', name: 'Hédi Ben Ali' })])).statut).toBe(200);
    const lire = (mois = '2025-03') => appeler('GET', `/cabinets/${d.cabinet}/paie?mois=${mois}`, d.associe.jeton);
    expect((await lire()).corps.dossiers).toEqual([expect.objectContaining({ salaries: 2, pointes: 0 })]);
    // Le client valide mars : sa version figée nomme les deux.
    const version = { id: 'v1', ym: '2025-03', le: '2025-04-01T09:00:00.000Z', note: '',
      instant: { 'sal-1': { nom: 'Amel Trabelsi', jours: {} }, 'sal-2': { nom: 'Hédi Ben Ali', jours: {} } } };
    const client = (changements: unknown[]) => appeler('POST', `/entreprises/${d.ent}/dossier-v10`, d.client.jeton, { changements });
    expect((await client([{ collection: 'pointageVersions', cle: 'v1', rang: null, revision: null, contenu: encoder(version) }])).statut).toBe(200);
    const lus = async () => ((await appeler('GET', `/entreprises/${d.ent}/paie/dossier`, d.associe.jeton)).corps.objets as { collection: string; cle: string; contenu: unknown }[]);
    expect((await lus()).find((o) => o.collection === 'pointageVersions')?.contenu).toEqual(encoder(version));
    expect((await lire()).corps.dossiers).toEqual([expect.objectContaining({ salaries: 2, pointes: 2 })]);
    // Un autre mois n'en profite pas.
    expect((await lire('2025-04')).corps.dossiers).toEqual([expect.objectContaining({ salaries: 2, pointes: 0 })]);
    // Une validation reste le geste du client : le cabinet ne l'écrit pas, ni ne rouvre un mois.
    expect((await ecrire(d.ent, d.associe, [{ collection: 'pointageVersions', cle: 'v2', rang: null, revision: null, contenu: encoder({ ...version, id: 'v2' }) }])).statut).toBe(400);
    expect((await ecrire(d.ent, d.associe, [{ collection: '_racine', cle: 'pointageOuverts', rang: null, revision: null, contenu: ['2025-03'] }])).statut).toBe(400);
    // Le client rouvre mars (« Corriger : une nouvelle version ») : le mois n'est plus validé.
    expect((await client([{ collection: '_racine', cle: 'pointageOuverts', rang: null, revision: null, contenu: ['2025-03'] }])).statut).toBe(200);
    expect((await lus()).map((o) => `${o.collection}/${o.cle}`)).toContain('_racine/pointageOuverts');
    expect((await lire()).corps.dossiers).toEqual([expect.objectContaining({ salaries: 2, pointes: 0 })]);
    // Dans la base : le cabinet lit ces deux-là, jamais une autre clé de la racine du client (ses compteurs ici).
    expect((await client([{ collection: '_racine', cle: 'counters', rang: null, revision: null, contenu: { 'devis-2025': 3 } }])).statut).toBe(200);
    const parLeCabinet = await enTantQue(pool, d.associe.utilisateur, (tx) => tx.query(
      `select collection, cle from socle.dossier_v10 where entreprise = $1 and collection in ('pointageVersions', '_racine') order by collection, cle`, [d.ent]));
    const vus = parLeCabinet.rows.map((x) => `${x.collection}/${x.cle}`);
    expect(vus).toEqual(expect.arrayContaining(['_racine/pointageOuverts', 'pointageVersions/v1']));
    expect(vus).not.toContain('_racine/counters');
  });
});
