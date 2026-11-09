// (1.329.0) « Je facturais déjà » arrive jusqu'au serveur (serveur/v10/numerotation.ts ; base 0204). La boulangerie facturait
// sur un carnet jusqu'à FAC-2026-047 : sa première facture ici porte FAC-2026-048, celle que la fenêtre d'émission annonce,
// et plus FAC-2026-001 (deux factures « 001 » la même année, l'une dans le carnet, l'autre ici). Ce que le serveur garantit :
//   - la première pièce d'une année vierge part de la suite annoncée ; une année où un numéro a été donné ne bouge jamais ;
//   - écrire la suite d'une facture ou d'un avoir est un réglage fiscal (propriétaire, administrateur), jamais après un numéro ;
//   - le numéro annoncé avant d'émettre se lit au serveur, et c'est celui qu'il donne.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
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
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
async function personne(prenom: string) {
  const email = `numeros-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, nom: `${prenom} ${n}`, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}

const aujourdhui = new Date().toISOString().slice(0, 10);
const an = aujourdhui.slice(0, 4);
// Dix pains à 10 DT, TVA 7 % : 107 DT, sans timbre.
const piece = (id: string, type = 'facture', extra: Record<string, unknown> = {}) => ({ id, type, number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
  lines: [{ label: 'Pain de campagne', description: '', qty: 10, unit: 'pièce', unitPrice: 10, vatRate: 7 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [], ...extra });

async function boulangerie() {
  const proprio = await personne('Sarra');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const commercial = await personne('Karim');
  const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: commercial.email, roles: ['commercial'] })).corps.jeton);
  await appeler('POST', '/invitations/accepter', commercial.jeton, { jeton: invitation });
  const lire = async (jeton = proprio.jeton) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  const client = { id: 'c1', name: 'Hôtel Le Belvédère', address: 'Avenue Mohamed V, Tunis' };
  expect((await envoyer(proprio.jeton, [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client }])).statut).toBe(200);
  const objet = async (collection: string, cle: string) => (await lire()).find((o) => o.collection === collection && o.cle === cle);
  // La suite annoncée, comme l'écran l'écrit (`_racine/counters`, « facture-AAAA » : la dernière pièce émise ailleurs).
  const suite = async (jeton: string, compteurs: Record<string, unknown>) => {
    const avant = await objet('_racine', 'counters');
    return envoyer(jeton, [{ collection: '_racine', cle: 'counters', rang: null, revision: avant?.revision ?? null, contenu: { ...(avant?.contenu ?? {}), ...compteurs } }]);
  };
  const prochain = async (jeton: string, type = 'facture') =>
    (await appeler('GET', `/entreprises/${ent}/dossier-v10/prochain-numero?type=${type}&date=${aujourdhui}`, jeton)).corps;
  const emettre = async (jeton: string, doc: Record<string, unknown>, net: string, chemin = 'emettre') => {
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/${chemin}`, jeton, { document: doc, client, revision: null, rang: 1, netAPayer: net });
    return { statut: r.statut, corps: r.corps, numero: String((await objet('documents', String(doc.id)))?.contenu.number ?? '') };
  };
  return { ent, proprio, commercial, suite, prochain, emettre, objet };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('« Je facturais déjà », jusqu\'au serveur (1.329.0)', () => {
  it('la boulangerie continue son carnet : annoncée FAC-048, émise FAC-048, puis FAC-049 ; la suite ne se change plus', async () => {
    const b = await boulangerie();
    // Rien d'annoncé : la série part de 001, comme avant.
    expect((await b.prochain(b.proprio.jeton)).texte).toBe(`FAC-${an}-001`);
    expect((await b.suite(b.proprio.jeton, { [`facture-${an}`]: 47 })).statut).toBe(200);
    expect(await b.prochain(b.proprio.jeton)).toMatchObject({ numero: 48, texte: `FAC-${an}-048`, suite: true });
    // C'est un commercial qui émet la première : la suite vaut pour lui aussi.
    const f1 = await b.emettre(b.commercial.jeton, piece('f1'), '107.000');
    expect(f1.statut, JSON.stringify(f1.corps)).toBe(200);
    expect(f1.numero).toBe(`FAC-${an}-048`);
    expect(await b.prochain(b.commercial.jeton)).toMatchObject({ texte: `FAC-${an}-049`, suite: false });
    expect((await b.emettre(b.proprio.jeton, piece('f2'), '107.000')).numero).toBe(`FAC-${an}-049`);
    // La série est tenue : changer la suite de l'année se refuse, et dit pourquoi, même au propriétaire.
    const tenue = await b.suite(b.proprio.jeton, { [`facture-${an}`]: 30 });
    expect(tenue.statut).toBe(403);
    expect(JSON.stringify(tenue.corps)).toContain(`FAC-${an}-049`);
    // La reprise est tracée, avec le numéro de départ.
    const trace = (await admin.query(`select apres from socle.audit where entreprise = $1 and geste = 'socle.serie.reprendre'`, [b.ent])).rows;
    expect(trace.map((r) => r.apres)).toEqual([expect.objectContaining({ dernier: 47, par: 'emission' })]);
  });

  it('un commercial n\'écrit pas la suite d\'une facture (réglage fiscal) ; celle d\'un devis, si', async () => {
    const b = await boulangerie();
    const refus = await b.suite(b.commercial.jeton, { [`facture-${an}`]: 12 });
    expect(refus.statut).toBe(403);
    expect(JSON.stringify(refus.corps)).toContain('propriétaire ou un administrateur');
    expect((await b.suite(b.commercial.jeton, { [`avoir-${an}`]: 3 })).statut).toBe(403);
    // Un devis se numérote sur le poste (sans valeur légale) : la suite d'un devis n'est pas un réglage fiscal.
    expect((await b.suite(b.commercial.jeton, { [`devis-${an}`]: 12 })).statut).toBe(200);
    expect((await b.prochain(b.commercial.jeton)).texte).toBe(`FAC-${an}-001`);
  });

  it('les avoirs continuent leur propre suite, et la suite d\'une autre année ne touche pas celle-ci', async () => {
    const b = await boulangerie();
    expect((await b.suite(b.proprio.jeton, { [`avoir-${an}`]: 5, [`facture-${Number(an) - 1}`]: 300 })).statut).toBe(200);
    expect((await b.prochain(b.proprio.jeton, 'avoir')).texte).toBe(`AVO-${an}-006`);
    const f1 = await b.emettre(b.proprio.jeton, piece('f1'), '107.000');
    expect(f1.numero).toBe(`FAC-${an}-001`);
    const a1 = await b.emettre(b.proprio.jeton, piece('a1', 'avoir', { creditOf: 'f1', creditReason: 'Pains rendus',
      lines: [{ label: 'Pain de campagne', description: '', qty: 1, unit: 'pièce', unitPrice: 10, vatRate: 7 }] }), '10.700', 'emettre-avoir');
    expect(a1.statut, JSON.stringify(a1.corps)).toBe(200);
    expect(a1.numero).toBe(`AVO-${an}-006`);
  });

  it('une année où le serveur a déjà donné un numéro ne bouge jamais, même si le dossier dit autre chose', async () => {
    const b = await boulangerie();
    expect((await b.emettre(b.proprio.jeton, piece('f1'), '107.000')).numero).toBe(`FAC-${an}-001`);
    // Une suite posée avant la 1.329.0 (ou sans passer par l'écran) : le serveur l'ignore pour une année déjà commencée,
    // et l'annonce dit le numéro qu'il donnera, pas celui du dossier.
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, '_racine', 'counters', $2::jsonb)
      on conflict (entreprise, collection, cle) do update set contenu = excluded.contenu`, [b.ent, JSON.stringify({ [`facture-${an}`]: 47 })]);
    expect(await b.prochain(b.proprio.jeton)).toMatchObject({ texte: `FAC-${an}-002`, suite: false });
    expect((await b.emettre(b.proprio.jeton, piece('f2'), '107.000')).numero).toBe(`FAC-${an}-002`);
  });
});
