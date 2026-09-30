// L'essai à blanc de la reprise d'un livre du Cabinet v10 (brique 62 ; docs/cabinet.md, C52). Le livre
// est fabriqué par le moteur de la v10 lui-même (web/public/v10/compta.js) : écritures saisies,
// validées (numérotées) ou laissées au brouillard, à-nouveaux, une ligne lettrée. Ce que le serveur
// garantit : rien n'est créé ; ce qui passe est compté ; la balance des validées est celle que la v10
// calcule elle-même (deux chemins, un chiffre) ; ce qui ne se reprendrait pas tel quel est nommé.

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
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

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

type Livre = { ecritures: { id: string; lignes: { lettre: string }[] }[]; releves: unknown[]; questions: unknown[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => Livre;
  ajouterEcriture: (l: Livre, e: Record<string, unknown>, qui: string, quand: number) => { id: string };
  validerEcriture: (l: Livre, id: string, qui: string, quand: number) => { ok: boolean; motif?: string };
  lignesDuLivre: (l: Livre, o?: Record<string, unknown>) => unknown[];
  balanceDepuisLignes: (lignes: unknown[], ouverture: unknown, libelle?: unknown) => { rows: { account: string; debit: number; credit: number }[] } | { account: string; debit: number; credit: number }[];
};

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

// Un livre de 2025 tel que la v10 l'écrit : des à-nouveaux, une facture et son encaissement validés
// (montants au millime qui discriminent un arrondi), un achat au brouillard, une ligne lettrée.
function livreDe2025() {
  const L = KC.livreVide('D', 2025, {});
  const poser = (e: Record<string, unknown>, valider: boolean) => {
    const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2025, 5, 1));
    if (valider) expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2025, 5, 2)).ok).toBe(true);
    return x;
  };
  poser({ date: '2025-01-01', journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '532', debit: 12500.125 }, { compte: '101', credit: 12500.125 }] }, true);
  poser({ date: '2025-03-14', journal: 'VT', piece: 'FAC-2025-014', libelle: 'Facture Hôtel du Lac', lignes: [{ compte: '411', tiers: 'Hôtel du Lac', debit: 1191.001 }, { compte: '707', credit: 1000.001 }, { compte: '4367', credit: 191 }] }, true);
  const enc = poser({ date: '2025-04-02', journal: 'BQ', piece: 'VIR-88', libelle: 'Encaissement Hôtel du Lac', lignes: [{ compte: '532', debit: 1191.001 }, { compte: '411', tiers: 'Hôtel du Lac', credit: 1191.001 }] }, true);
  poser({ date: '2025-05-20', journal: 'AC', piece: 'FF-77', libelle: 'Papeterie', lignes: [{ compte: '6064', debit: 84.034 }, { compte: '4366', debit: 15.966 }, { compte: '401', credit: 100 }] }, false);
  const e = L.ecritures.find((x) => x.id === enc.id);
  if (e && e.lignes[1]) e.lignes[1].lettre = 'A';
  L.releves.push({ id: 'r1' });
  L.questions.push({ id: 'q1' }, { id: 'q2' });
  return L;
}

describe('la reprise d\'un livre du Cabinet v10 : l\'essai à blanc', () => {
  it('le livre se lit : ce qui passe compté, la balance des validées égale à celle de la v10, rien de créé', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const avant = Number((await admin.query('select count(*)::int n from compta.ecriture')).rows[0].n);
    const L = livreDe2025();
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: JSON.parse(JSON.stringify(L)) });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({
      annee: 2025, du: '2025-01-01', au: '2025-12-31', clos: false,
      ecritures: { total: 4, validees: 3, brouillard: 1, aNouveaux: 1 },
      journaux: { AN: { ecritures: 1, validees: 1, dernierNumero: 1 }, VT: { ecritures: 1, validees: 1, dernierNumero: 2 }, BQ: { ecritures: 1, validees: 1, dernierNumero: 3 }, AC: { ecritures: 1, validees: 0, dernierNumero: null } },
      totaux: { debit: '14882.127', credit: '14882.127' },
      anomalies: [],
      autour: { lettrages: 1, releves: 1, questions: 2, immobilisations: 0 },
    });
    // Deux chemins, un chiffre : la balance du serveur est celle que la v10 calcule sur le même livre.
    const b = KC.balanceDepuisLignes(KC.lignesDuLivre(L), {});
    const lignesV10 = (Array.isArray(b) ? b : b.rows).map((x) => [x.account, x.debit.toFixed(3), x.credit.toFixed(3)]);
    expect((r.corps.balance as { compte: string; debit: string; credit: string }[]).map((x) => [x.compte, x.debit, x.credit])).toEqual(lignesV10);
    // Rien n'a été créé.
    expect(Number((await admin.query('select count(*)::int n from compta.ecriture')).rows[0].n)).toBe(avant);
  });

  it('un livre de plusieurs mégaoctets se lit en une fois', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const L = JSON.parse(JSON.stringify(KC.livreVide('D', 2025, {}))) as { ecritures: unknown[] };
    for (let i = 1; i <= 8000; i++) {
      L.ecritures.push({ id: `e${i}`, numero: i, statut: 'validee', date: '2025-06-30', journal: 'OD', piece: `OD-${i}`, libelle: `Opération diverse numéro ${i} du mois de juin`,
        lignes: [{ compte: '6132', libelle: 'Loyer du local commercial', debit: 850.5, credit: 0 }, { compte: '401', libelle: 'Propriétaire', debit: 0, credit: 850.5 }] });
    }
    expect(JSON.stringify(L).length).toBeGreaterThan(2_000_000);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect([r.statut, (r.corps.ecritures as { validees: number } | undefined)?.validees, (r.corps.totaux as { debit: string } | undefined)?.debit]).toEqual([200, 8000, '6804000.000']);
  });

  it('ce qui ne se reprendrait pas tel quel est nommé, écriture par écriture ; un fichier qui n\'est pas un livre, refusé ; un collaborateur, refusé', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const L = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: Record<string, unknown>[] };
    const [an, vt, bq, ac] = L.ecritures as { journal: string; date: string; numero: number; lignes: { compte: string; debit: number; credit: number }[]; piece: string }[];
    if (!an || !vt || !bq || !ac) throw new Error('livre incomplet');
    ac.journal = 'BQ2';                                  // un journal que la plateforme ne connaît pas
    vt.lignes[0] = { ...vt.lignes[0], debit: 1191.002 } as never;  // déséquilibrée d'un millime
    vt.lignes.push({ compte: '471', debit: 0, credit: 0 });        // une ligne sans montant
    bq.date = '2026-01-03';                              // hors de l'exercice
    bq.numero = 2;                                       // le numéro de la facture
    an.lignes[0] = { ...an.lignes[0], debit: 12500.1255 } as never;  // quatre décimales : jamais arrondi en silence
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((r.corps.anomalies as { piece: string; motif: string }[]).map((x) => [x.piece, x.motif])).toEqual([
      ['AN', 'Un montant ne se lit pas au millime.'],
      ['AN', 'Une écriture a au moins deux lignes.'],
      ['AN', 'Elle n\'est pas équilibrée : 0.000 au débit, 12500.125 au crédit.'],
      ['FAC-2025-014', 'Une ligne va au débit ou au crédit, jamais aux deux ni à aucun.'],
      ['FAC-2025-014', 'Elle n\'est pas équilibrée : 1191.002 au débit, 1191.001 au crédit.'],
      ['VIR-88', 'La date tombe hors de l\'exercice (2025-01-01 au 2025-12-31).'],
      ['VIR-88', 'Le numéro 2 est déjà celui d\'une autre écriture.'],
      ['FF-77', 'Le journal « BQ2 » n\'existe pas sur la plateforme (VT, AC, BQ, CA, OD, PAIE, AN).'],
    ]);
    const pasUnLivre = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: { dossiers: [] } });
    expect([pasUnLivre.statut, pasUnLivre.corps.motif]).toEqual([400, 'Ce fichier n\'est pas le livre d\'un exercice du Cabinet v10 (livre-AAAA.json) : rien n\'a été lu.']);
    const collaborateur = await personne('collaborateur');
    await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, '{revision}')`, [collaborateur.utilisateur, cabinet]);
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, collaborateur.jeton, { livre: L })).statut).toBe(403);
  });
});

describe('la reprise d\'un livre du Cabinet v10 : l\'écriture dans un dossier tenu', () => {
  type Ecriture = { id: string; journal: string; date: string; piece: string; statut: string; numero: string | null };
  const livres = async (ent: string, jeton: string) => ((await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[])
    .map((e) => [e.piece, e.statut, e.numero]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it('les écritures s\'écrivent avec leur numéro de la v10 ; la période se valide jusqu\'au dernier jour tout validé ; chaque journal continue ; une seconde reprise, refusée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const livre = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: unknown[] };
    // Une validée APRÈS le brouillard de mai : la période ne se valide que jusqu'à la veille du brouillard.
    livre.ecritures.push({ id: 'e-od', numero: 4, statut: 'validee', date: '2025-07-31', journal: 'OD', piece: 'OD-7', libelle: 'Loyer de juillet',
      lignes: [{ compte: '6132', debit: 850.5, credit: 0 }, { compte: '401', debit: 0, credit: 850.5 }] });
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps).toMatchObject({ validees: 4, brouillard: 1, jusqua: '2025-05-19' });
    expect(await livres(dossier, associe.jeton)).toEqual([
      ['AN', 'validee', 'AN-2025-000001'], ['FAC-2025-014', 'validee', 'VT-2025-000002'], ['FF-77', 'brouillard', null], ['OD-7', 'validee', 'OD-2025-000004'],
      ['VIR-88', 'validee', 'BQ-2025-000003'],
    ]);
    // La chaîne des livres scelle les validées dans l'ordre de leurs numéros.
    const chaine = (await admin.query(`select numero from compta.ecriture where entreprise = $1 and statut = 'validee' order by chaine_rang`, [dossier])).rows.map((x) => x.numero);
    expect(chaine).toEqual(['AN-2025-000001', 'VT-2025-000002', 'BQ-2025-000003', 'OD-2025-000004']);
    expect((await admin.query('select jusqua::text j from compta.cloture where entreprise = $1', [dossier])).rows[0].j).toBe('2025-05-19');
    // La trace de la reprise porte l'empreinte du fichier envoyé.
    const trace = (await admin.query(`select apres from socle.audit where entreprise = $1 and geste = 'compta.reprise.livre_v10'`, [dossier])).rows;
    expect(trace).toEqual([{ apres: { annee: 2025, validees: 4, brouillard: 1, empreinte: r.corps.empreinte, jusqua: '2025-05-19' } }]);
    expect(String(r.corps.empreinte)).toMatch(/^[0-9a-f]{64}$/);
    // Le journal des ventes continue au plus grand numéro repris.
    const vt = await appeler('POST', `/entreprises/${dossier}/compta/ecritures`, associe.jeton, {
      date: '2025-08-10', journal: 'VT', piece: 'FAC-2025-015', libelle: 'Facture', lignes: [{ compte: '411', debit: '500,000' }, { compte: '707', credit: '500,000' }] });
    expect(vt.statut, JSON.stringify(vt.corps)).toBe(201);
    const v = await appeler('POST', `/entreprises/${dossier}/compta/ecritures/valider`, associe.jeton, { ids: [vt.corps.id] });
    expect((v.corps.validees as { numero: string }[]).map((x) => x.numero)).toEqual(['VT-2025-000003']);
    // Une seconde reprise du même exercice : refusée, rien ne change.
    const encore = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre });
    expect([encore.statut, encore.corps.motif]).toEqual([403, 'Le livre de 2025 de ce dossier a déjà des écritures : une reprise ne s\'écrit que dans un exercice vide.']);
  });

  it('un livre qui a une anomalie ne s\'écrit pas ; un client sur SkanFact ne reçoit pas de reprise ; un collaborateur non plus', async () => {
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const abime = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: { journal: string }[] };
    if (abime.ecritures[3]) abime.ecritures[3].journal = 'BQ2';
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: abime });
    expect([r.statut, r.corps.motif]).toEqual([400, 'Des écritures de ce livre ne se reprendraient pas telles quelles (1) : le rapport les nomme, écriture par écriture ; rien n\'a été écrit.']);
    expect(((r.corps.rapport as { anomalies: unknown[] }).anomalies).length).toBe(1);
    expect(await livres(dossier, associe.jeton)).toEqual([]);
    // Un client sur SkanFact : la reprise ne s'écrit pas dans ses livres.
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe.jeton)).statut).toBe(200);
    const surSkanfact = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier: ent, livre: JSON.parse(JSON.stringify(livreDe2025())) });
    expect([surSkanfact.statut, surSkanfact.corps.motif]).toEqual([403, 'La reprise d\'un livre de la v10 s\'écrit dans un dossier que ton cabinet tient.']);
    // Un collaborateur : refusé.
    const collaborateur = await personne('collaborateur');
    await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, '{revision}')`, [collaborateur.utilisateur, cabinet]);
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, collaborateur.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe2025())) })).statut).toBe(403);
  });
});
