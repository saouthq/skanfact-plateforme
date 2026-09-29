// L'exercice et sa balance d'ouverture (brique 39 ; docs/cabinet.md, C16 et C17), par l'API et dans
// la base. Ce que le serveur garantit :
//   - un exercice s'ouvre une fois : son année, son premier jour (le 1er janvier, ou plus tard pour un
//     premier exercice), le 31 décembre ; deux ouvertures au même instant, une seule passe ;
//   - sa balance d'ouverture est UNE écriture du journal AN, pièce OUVERTURE, au premier jour, posée
//     ET validée d'un geste avec l'exercice — ou rien : refusée (déséquilibrée, un compte qui n'est pas
//     un numéro, la période validée, un jour à venir), ni l'exercice ni l'écriture n'existent ;
//   - l'ouvrir revient à qui valide (avec un mandat de comptabilité, le cabinet), à la porte et dans la
//     base ; une voisine n'en lit rien ;
//   - fausse, elle se contre-passe comme toute écriture saisie ;
//   - les à-nouveaux ne sont l'activité d'aucun mois : le tableau du portefeuille ne les compte pas.

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

type EcritureLue = { id: string; journal: string; date: string; piece: string | null; libelle: string; statut: string; numero: string | null; chaine: number | null;
  origine: { type: string; id: string }; lignes: { compte: string; libelle: string; debit: string; credit: string }[] };
const livres = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, p.jeton)).corps.ecritures as EcritureLue[];
const exercices = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/exercices`, p.jeton)).corps.exercices;
const ouvrir = (ent: string, p: Personne, corps: unknown) => appeler('POST', `/entreprises/${ent}/compta/exercices`, p.jeton, corps);
// Une balance d'ouverture aux montants qui discriminent (des millimes, pas des nombres ronds).
const BALANCE = [
  { compte: '532', libelle: 'Banque', debit: '12500,250' },
  { compte: '411', libelle: 'Clients', debit: '3400,500' },
  { compte: '401', libelle: 'Fournisseurs', credit: '2890,125' },
  { compte: '101', libelle: 'Capital', credit: '13010,625' },
];

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'exercice et sa balance d\'ouverture', () => {
  it('la balance d\'ouverture : une écriture AN au premier jour, validée d\'un geste avec l\'exercice, ou rien ; l\'exercice s\'ouvre une fois ; fausse, elle se contre-passe', async () => {
    const d = await dossier();
    // Qui l'ouvre : qui valide. Ni l'assistant de saisie, ni le client quand le cabinet a le mandat.
    expect((await ouvrir(d.ent, d.assistant, { annee: 2026, ouverture: BALANCE })).corps.motif).toMatch(/^Ton rôle \(Assistant de saisie\) ne permet pas de valider/);
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select * from compta.ouvrir_exercice($1, 2026, $2::date, $3::jsonb)', [d.ent, '2026-01-01', '[]'])))
      .rejects.toThrow(/ne permet pas de valider/);
    expect((await ouvrir(d.ent, d.client, { annee: 2026, ouverture: BALANCE })).corps.motif).toBe('Avec un mandat de comptabilité, c\'est le cabinet qui valide les écritures.');
    // Les bornes de l'exercice : jamais avant le 1er janvier, jamais après le 31 décembre.
    expect((await ouvrir(d.ent, d.collaborateur, { annee: 2026, du: '2025-12-01' })).corps.motif)
      .toBe('L\'exercice 2026 ne peut pas commencer avant le 01/01/2026 : un premier exercice de plus de douze mois se reprend en deux, l\'un par année.');
    expect((await ouvrir(d.ent, d.collaborateur, { annee: 2026, du: '2027-01-01' })).corps.motif).toBe('L\'exercice 2026 finit le 31/12/2026 : il ne peut pas commencer après.');
    // Une balance déséquilibrée, un compte qui n'est pas un numéro, un montant illisible : refusés, et
    // RIEN n'est écrit — ni l'exercice, ni l'écriture.
    const desequilibree = [...BALANCE.slice(0, 3), { compte: '101', libelle: 'Capital', credit: '13010,000' }];
    expect((await ouvrir(d.ent, d.collaborateur, { annee: 2026, ouverture: desequilibree })).corps.motif).toBe('Débit 15 900,750 ≠ crédit 15 900,125 : l\'écriture ne tombe pas juste.');
    expect((await ouvrir(d.ent, d.collaborateur, { annee: 2026, ouverture: [BALANCE[0], { ...BALANCE[1], compte: '41A' }, ...BALANCE.slice(2)] })).corps.motif).toBe('Ligne 2 : le compte doit être un numéro.');
    const illisible = await ouvrir(d.ent, d.collaborateur, { annee: 2026, ouverture: [{ ...BALANCE[0], debit: '12 500,25x' }, ...BALANCE.slice(1)] });
    expect([illisible.statut, illisible.corps.champ]).toEqual([400, 'ouverture.0.debit']);
    expect(await exercices(d.ent, d.collaborateur)).toEqual([]);
    expect(await livres(d.ent, d.collaborateur)).toEqual([]);

    // L'ouverture : une seule écriture AN au 1er janvier, pièce OUVERTURE, validée (son numéro, son maillon).
    const o = await ouvrir(d.ent, d.collaborateur, { annee: 2026, ouverture: [...BALANCE, { compte: '', debit: '', credit: '' }] });
    expect(o.statut, JSON.stringify(o.corps)).toBe(201);
    expect(o.corps).toMatchObject({ annee: 2026, du: '2026-01-01', au: '2026-12-31', numero: 'AN-2026-000001' });
    const [an] = await livres(d.ent, d.collaborateur);
    expect(an).toMatchObject({ id: o.corps.ouverture, journal: 'AN', date: '2026-01-01', piece: 'OUVERTURE', libelle: 'Balance d\'ouverture', statut: 'validee', numero: 'AN-2026-000001' });
    expect(an?.chaine).toBeGreaterThan(0);
    expect(an?.lignes.map((l) => [l.compte, l.libelle, l.debit, l.credit])).toEqual([
      ['532', 'Banque', '12500.250', '0.000'], ['411', 'Clients', '3400.500', '0.000'], ['401', 'Fournisseurs', '0.000', '2890.125'], ['101', 'Capital', '0.000', '13010.625'],
    ]);
    expect(await exercices(d.ent, d.client)).toEqual([{ annee: 2026, du: '2026-01-01', au: '2026-12-31', ouverture: o.corps.ouverture }]);
    // Une voisine n'en lit rien, même dans la base.
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query('select count(*) n from compta.exercice where entreprise = $1', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([1, 0]);
    // Un exercice s'ouvre une fois.
    expect((await ouvrir(d.ent, d.associe, { annee: 2026 })).corps.motif)
      .toBe('L\'exercice 2026 est déjà ouvert : une balance d\'ouverture fausse se contre-passe, puis la bonne se saisit au journal AN.');
    // Fausse, elle se contre-passe comme toute écriture saisie ; la bonne se saisit au journal AN.
    const cp = await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${String(o.corps.ouverture)}/contrepasser`, d.collaborateur.jeton, { date: '2026-01-01' });
    expect(cp.statut, JSON.stringify(cp.corps)).toBe(201);
    expect(cp.corps).toMatchObject({ numero: 'AN-2026-000002', date: '2026-01-01' });
    // Les à-nouveaux ne sont l'activité d'aucun mois (C14) : le tableau du portefeuille ne compte pas
    // janvier pour sa balance d'ouverture ni pour sa contre-passation ; une pièce de mars, oui.
    await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, { date: '2026-03-10', journal: 'OD', libelle: 'Loyer de mars', lignes: [{ compte: '6132', debit: '700' }, { compte: '532', credit: '700' }] });
    const mois = (await appeler('GET', `/cabinets/${d.cabinet}/mois?depuis=2026-01-01`, d.associe.jeton)).corps.mois as { mois: string; ecritures: number }[];
    expect(mois.map((x) => [x.mois, x.ecritures])).toEqual([['2026-03', 1]]);
    const trace = (await admin.query(`select geste from socle.audit where entreprise = $1 and geste = 'compta.exercice.ouvrir'`, [d.ent])).rowCount;
    expect(trace).toBe(1);
  });

  it('un premier exercice qui commence en cours d\'année, sans balance ; une balance datée d\'un jour à venir, ou dans la période validée, ne s\'ouvre pas ; deux ouvertures au même instant, une seule passe', async () => {
    const d = await dossier();
    // Un client qui démarre le 1er juin : son exercice s'ouvre sans balance d'ouverture.
    const juin = await ouvrir(d.ent, d.collaborateur, { annee: 2025, du: '2025-06-01' });
    expect(juin.corps).toMatchObject({ annee: 2025, du: '2025-06-01', au: '2025-12-31', ouverture: null, numero: null });
    expect(await livres(d.ent, d.collaborateur)).toEqual([]);
    // L'an prochain : sa balance serait datée d'un jour à venir, qui ne se valide pas.
    const prochain = new Date().getUTCFullYear() + 1;
    expect((await ouvrir(d.ent, d.collaborateur, { annee: prochain, ouverture: BALANCE })).corps.motif)
      .toBe(`La balance d'ouverture ne se valide pas : elle est datée du 01/01/${prochain} : une écriture ne se valide pas avant son jour.`);
    expect(((await exercices(d.ent, d.collaborateur)) as { annee: number }[]).map((e) => e.annee)).toEqual([2025]);
    // La période validée jusqu'au 31 mars 2026 : une balance au 1er janvier ne s'y écrit plus.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.collaborateur.jeton, { jusqua: '2026-03-31' })).statut).toBe(200);
    expect((await ouvrir(d.ent, d.collaborateur, { annee: 2026, ouverture: BALANCE })).corps.motif).toBe('La période est validée jusqu\'au 31/03/2026 : une écriture ne s\'y écrit plus.');
    // Deux ouvertures au même instant : une seule passe, l'autre lit sa phrase (jamais une erreur).
    const autre = await dossier();
    const [a, b] = await Promise.all([ouvrir(autre.ent, autre.collaborateur, { annee: 2026, ouverture: BALANCE }), ouvrir(autre.ent, autre.associe, { annee: 2026, ouverture: BALANCE })]);
    expect([a.statut, b.statut].sort()).toEqual([201, 403]);
    expect((a.statut === 403 ? a : b).corps.motif).toMatch(/^L'exercice 2026 est déjà ouvert/);
    expect((await livres(autre.ent, autre.collaborateur)).filter((e) => e.journal === 'AN')).toHaveLength(1);
  });
});
