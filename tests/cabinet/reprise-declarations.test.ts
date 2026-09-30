// Les déclarations et l'inventaire repris avec le livre du Cabinet v10 (brique 69 ; docs/cabinet.md, C59).
// Le livre est fabriqué par le moteur de la v10 : la déclaration de mars préparée (declarationMensuelle,
// poserDeclaration), son écriture passée, déposée puis payée (pointerDeclaration) ; l'inventaire du
// 31 décembre (poserInventaire) et sa variation de stock passée (variationDeStock). Ce que le serveur
// garantit : chacun repris tel quel (cases au millime, dépôt, paiement, lignes), relié à son écriture
// reprise — qui ne se repasse pas ; ce qui ne se reprendrait pas tel quel, nommé à l'essai.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
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
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
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
async function dossierTenu() {
  const associe = await personne('associe');
  const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
  const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
  return { associe, cabinet, dossier };
}

type Decl = { periode: string; ecritureId: string; deposee: { le: string }; payee: { le: string } };
type Inv = { date: string; ecritureId: string; lignes: Record<string, unknown>[] };
type Livre = { ecritures: { id: string; piece: string }[]; declarations: Decl[]; inventaires: Inv[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => Livre;
  ajouterEcriture: (l: Livre, e: Record<string, unknown>, qui: string, quand: number) => { id: string };
  validerEcriture: (l: Livre, id: string, qui: string, quand: number) => { ok: boolean; motif?: string };
  declarationMensuelle: (l: Livre, periode: string) => Record<string, unknown> & { ok: boolean };
  poserDeclaration: (l: Livre, d: unknown, qui: string, quand: number) => { ok: boolean; motif?: string };
  ecritureDeclaration: (l: Livre, d: unknown) => Record<string, unknown>;
  pointerDeclaration: (l: Livre, periode: string, quoi: string, valeur: unknown, qui: string, quand: number) => { ok: boolean; motif?: string };
  poserInventaire: (l: Livre, inv: Record<string, unknown>, qui: string, quand: number) => { ok: boolean; motif?: string };
  variationDeStock: (l: Livre, annee: number) => { ok: boolean; ecart: number; ecriture: Record<string, unknown> | null };
};

// Le livre de 2025 : le stock d'ouverture (500,000), la facture de mars (TVA 190,000), la déclaration
// de mars passée, déposée le 15 avril et payée le 20 ; l'inventaire du 31 décembre (632,515) et sa
// variation (132,515), passée.
function livreDe2025() {
  const L = KC.livreVide('D', 2025, {});
  const poser = (e: Record<string, unknown>) => {
    const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2025, 3, 10));
    expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2025, 3, 11))).toMatchObject({ ok: true });
    return x.id;
  };
  poser({ date: '2025-01-01', journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '31', debit: 500 }, { compte: '532', debit: 9500 }, { compte: '101', credit: 10000 }] });
  poser({ date: '2025-03-14', journal: 'VT', piece: 'FAC-2025-014', libelle: 'Facture Hôtel du Lac', lignes: [{ compte: '411', debit: 1190 }, { compte: '707', credit: 1000 }, { compte: '4367', credit: 190 }] });
  const decl = KC.declarationMensuelle(L, '2025-03');
  expect(KC.poserDeclaration(L, decl, 'Leila', Date.UTC(2025, 3, 5))).toMatchObject({ ok: true });
  const d = L.declarations[0];
  if (!d) throw new Error('déclaration absente');
  d.ecritureId = poser({ ...KC.ecritureDeclaration(L, decl), piece: 'DECL-2025-03' });
  expect(KC.pointerDeclaration(L, '2025-03', 'deposee', { le: '2025-04-15', reference: 'DEP-7781' }, 'Leila', Date.UTC(2025, 3, 15))).toMatchObject({ ok: true });
  expect(KC.pointerDeclaration(L, '2025-03', 'payee', { le: '2025-04-20' }, 'Leila', Date.UTC(2025, 3, 20))).toMatchObject({ ok: true });
  expect(KC.poserInventaire(L, { date: '2025-12-31', compte: '31', lignes: [{ ref: 'F1', libelle: 'Farine', quantite: 12.5, cout: 48.2 }, { ref: 'S1', libelle: 'Sucre', quantite: 3, cout: 10.005 }] },
    'Leila', Date.UTC(2025, 11, 31))).toMatchObject({ ok: true });
  const v = KC.variationDeStock(L, 2025);
  expect(v.ecart).toBe(132.515);
  const inv = L.inventaires[0];
  if (!inv || !v.ecriture) throw new Error('inventaire absent');
  inv.ecritureId = poser(v.ecriture);
  return L;
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const idDe = async (dossier: string, piece: string) => String((await admin.query('select id from compta.ecriture where entreprise = $1 and piece = $2', [dossier, piece])).rows[0]?.id);

describe('la reprise d\'un livre du Cabinet v10 : les déclarations et l\'inventaire', () => {
  it('la déclaration reprise avec ses cases, son dépôt, son paiement et son écriture ; l\'inventaire avec ses lignes et sa variation ; ni l\'une ni l\'autre ne se repasse', async () => {
    const { associe, cabinet, dossier } = await dossierTenu();
    const L = JSON.parse(JSON.stringify(livreDe2025())) as Livre;
    const essai = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect([essai.statut, essai.corps.anomalies, essai.corps.declarations, essai.corps.inventaire]).toEqual([200, [], { total: 1, deposees: 1 }, { lignes: 2 }]);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps).toMatchObject({ declarations: 1, inventaire: true });

    const decls = (await appeler('GET', `/entreprises/${dossier}/compta/declarations?annee=2025`, associe.jeton)).corps.declarations as {
      periode: string; cases: Record<string, string | null>; deposee: { le: string; reference: string }; payee: { le: string }; ecriture: string | null; prepareeLe: string }[];
    expect(decls.map((x) => [x.periode, x.cases.tvaCollectee, x.cases.netAPayer, x.deposee.le, x.deposee.reference, x.payee.le, x.prepareeLe.slice(0, 10)])).toEqual([
      ['2025-03', '190.000', '190.000', '2025-04-15', 'DEP-7781', '2025-04-20', '2025-04-05']]);
    expect(decls[0]?.ecriture).toBe(await idDe(dossier, 'DECL-2025-03'));
    const inv = (await appeler('GET', `/entreprises/${dossier}/compta/inventaires/2025`, associe.jeton)).corps.inventaire as {
      date: string; compte: string; total: string; ecriture: string | null; lignes: { libelle: string; quantite: string; cout: string }[] };
    expect([inv.date, inv.compte, inv.total, inv.lignes.map((l) => [l.libelle, l.quantite, l.cout])]).toEqual(['2025-12-31', '31', '632.515', [['Farine', '12.500', '48.200'], ['Sucre', '3.000', '10.005']]]);
    expect(inv.ecriture).toBe(await idDe(dossier, 'STK-2025'));
    // Ni la variation ni l'écriture de la déclaration ne se repassent.
    const encore = await appeler('POST', `/entreprises/${dossier}/compta/inventaires/2025/variation`, associe.jeton, {
      ecriture: { date: '2025-12-31', journal: 'OD', piece: 'STK-BIS', libelle: 'Variation', lignes: [{ compte: '31', debit: '132,515' }, { compte: '603', credit: '132,515' }] } });
    expect([encore.statut, encore.corps.motif]).toEqual([403, 'La variation de stock de cet exercice est déjà passée : la repasser compterait le stock deux fois.']);
  });

  it('une déclaration ou un inventaire qui ne se reprendrait pas tel quel est nommé ; la base refait ses contrôles', async () => {
    const { associe, cabinet, dossier } = await dossierTenu();
    const L = JSON.parse(JSON.stringify(livreDe2025())) as { declarations: Record<string, unknown>[]; inventaires: Record<string, unknown>[] };
    const [d] = L.declarations;
    const [inv] = L.inventaires;
    if (!d || !inv) throw new Error('livre incomplet');
    L.declarations.push({ ...d, periode: '2024-12' }, { ...d }, { ...d, periode: '2025-04', cases: { tvaCollectee: { montant: 1.2345 }, bonus: { montant: 1 } },
      deposee: { le: '', par: '', reference: '' }, payee: { le: '2025-05-20', par: '' }, ecritureId: 'e-inconnue' },
    { ...d, periode: '2025-05', deposee: { le: '2025-13-01', par: '', reference: '' }, payee: { le: '', par: '' } });
    L.inventaires.push({ ...inv });
    inv.date = '2024-12-31';
    inv.compte = '3 1';
    inv.lignes = [{ ref: '', libelle: '', quantite: 1, cout: 1 }, { ref: 'X', libelle: 'Sel', quantite: -1, cout: 1 }];
    inv.ecritureId = 'e-inconnue';
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((r.corps.anomalies as { piece: string; motif: string }[]).map((x) => [x.piece, x.motif])).toEqual([
      ['2024-12', 'Une déclaration de ce livre n\'est pas un mois de l\'exercice 2025.'],
      ['2025-03', 'La déclaration de ce mois est deux fois dans le livre.'],
      ['2025-04', 'La case « tvaCollectee » ne se lit pas au millime.'],
      ['2025-04', 'La case « bonus » n\'est pas une case de la déclaration.'],
      ['2025-04', 'Cette déclaration est payée sans être déposée.'],
      ['2025-04', 'L\'écriture du mois de cette déclaration n\'est pas dans le livre.'],
      ['2025-05', 'Le jour du dépôt ou du paiement de cette déclaration ne se lit pas.'],
      ['2025', 'Le livre porte plus d\'un inventaire pour l\'exercice.'],
      ['2025', 'L\'inventaire ne se date pas dans l\'exercice 2025.'],
      ['2025', 'Le compte de stock de l\'inventaire ne s\'écrit pas en chiffres.'],
      ['2025', 'La ligne 1 de l\'inventaire n\'a pas de désignation, ou sa quantité ou son coût ne se lit pas.'],
      ['2025', 'La ligne 2 de l\'inventaire n\'a pas de désignation, ou sa quantité ou son coût ne se lit pas.'],
      ['2025', 'L\'écriture de variation de l\'inventaire n\'est pas dans le livre.'],
    ]);
    // La base : l'écriture liée doit être une écriture reprise du dossier ; pas chez un client sur SkanFact.
    // (sans la déclaration, l'inventaire ni la variation du 31 décembre : l'année reste ouverte à la saisie)
    const L2 = livreDe2025() as unknown as { declarations: unknown[]; inventaires: unknown[]; ecritures: { piece: string }[] };
    L2.declarations = []; L2.inventaires = []; L2.ecritures = L2.ecritures.filter((e) => e.piece !== 'STK-2025');
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(L2)) })).statut).toBe(201);
    const saisie = await appeler('POST', `/entreprises/${dossier}/compta/ecritures`, associe.jeton, {
      date: '2025-12-31', journal: 'OD', piece: 'OD-9', libelle: 'Écart', lignes: [{ compte: '658', debit: '1,000' }, { compte: '532', credit: '1,000' }] });
    expect(saisie.statut, JSON.stringify(saisie.corps)).toBe(201);
    const reprise = await idDe(dossier, 'DECL-2025-03');
    const declarer = (ent: string, ecriture: string | null, u = associe.utilisateur) => enTantQue(pool, u, (tx) => tx.query('select compta.reprendre_declaration_v10($1, $2::jsonb) id',
      [ent, JSON.stringify({ periode: '2025-03', cases: { tvaCollectee: 190000 }, preparee: 0, deposee: null, payee: null, ecriture })])).then(() => 'écrit', (e: Error) => e.message);
    const inventorier = (ecriture: string | null, ent = dossier, u = associe.utilisateur) => enTantQue(pool, u, (tx) => tx.query('select compta.reprendre_inventaire_v10($1, 2025, $2::jsonb) t',
      [ent, JSON.stringify({ date: '2025-12-31', compte: '31', lignes: [{ ref: '', libelle: 'Farine', quantite: 1000, cout: 1000 }], ecriture })])).then(() => 'écrit', (e: Error) => e.message);
    const refus = 'l\'écriture liée à une déclaration ou à un inventaire repris n\'est pas une écriture reprise de ce dossier';
    expect(await declarer(dossier, String(saisie.corps.id))).toBe(refus);
    expect(await inventorier(String(saisie.corps.id))).toBe(refus);
    expect(await declarer(dossier, reprise)).toBe('écrit');
    expect(await inventorier(reprise)).toBe('écrit');
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    expect(await declarer(ent, null, client.utilisateur)).toBe('la reprise d\'un livre de la v10 s\'écrit dans un dossier que ton cabinet tient');
    expect(await inventorier(null, ent, client.utilisateur)).toBe('la reprise d\'un livre de la v10 s\'écrit dans un dossier que ton cabinet tient');
  });
});
