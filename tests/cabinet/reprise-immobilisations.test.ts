// Les immobilisations reprises avec le livre du Cabinet v10 (brique 67 ; docs/cabinet.md, C57). Les biens
// sont posés par le moteur de la v10 lui-même (ajouterImmobilisation, ecrituresImmobilisations,
// noterEcritureImmo) : un four acheté en 2025 et né de sa facture, un pétrin mis en service en 2023 et
// reporté. Ce que le serveur garantit : une fiche par bien pour toute la vie du dossier (retrouvée d'une
// année reprise à l'autre, jamais recréée ni changée en silence) ; chaque dotation reprise reliée à son
// bien (elle ne se repasse pas) ; l'écriture d'acquisition reliée à l'écriture reprise ; ce qui ne se
// reprendrait pas tel quel, nommé à l'essai.

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

type Ligne = { compte: string; debit: number; credit: number };
type Ecriture = { id: string; piece: string; journal: string; lignes: Ligne[] };
type Bien = { id: string; libelle: string; plan: { annee: number; dotation: number; ecritureId: string }[]; origine: { docId: string } };
type Livre = { ecritures: Ecriture[]; immobilisations: Bien[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => Livre;
  ajouterEcriture: (l: Livre, e: Record<string, unknown>, qui: string, quand: number) => { id: string };
  validerEcriture: (l: Livre, id: string, qui: string, quand: number) => { ok: boolean; motif?: string };
  ajouterImmobilisation: (l: Livre, f: Record<string, unknown>, qui: string, quand: number) => { ok: boolean; fiche?: Bien; motif?: string };
  ecrituresImmobilisations: (l: Livre, annee: number) => (Record<string, unknown> & { immoId: string; genre: string })[];
  noterEcritureImmo: (l: Livre, immo: string, annee: number, ecriture: string) => { ok: boolean };
};

const FOUR = { libelle: 'Four à sole', compte: '2234', compteAmort: '28234', compteDotation: '6811', dateAcquisition: '2025-03-01', dateMiseEnService: '2025-03-01',
  valeur: 12000, residuelle: 0, tva: 2280, methode: 'lineaire', duree: 5 };
const PETRIN = { libelle: 'Pétrin', compte: '2234', compteAmort: '28234', compteDotation: '6811', dateAcquisition: '2023-06-01', dateMiseEnService: '2023-06-01',
  valeur: 6000.5, residuelle: 0, tva: 0, methode: 'lineaire', duree: 5 };

// Un livre d'une année tel que la v10 l'écrit : les à-nouveaux (le pétrin et son amortissement), la
// facture du four (en 2025) dont la fiche est née, et les dotations de l'année, passées et validées.
function livreDe(annee: number, o: { four?: Record<string, unknown>; acheter?: boolean; dotationsAuBrouillard?: boolean } = {}) {
  const L = KC.livreVide('D', annee, {});
  const poser = (e: Record<string, unknown>, valider = true) => {
    const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(annee, 11, 30));
    if (valider) expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(annee, 11, 31)).ok).toBe(true);
    return x.id;
  };
  poser({ date: `${annee}-01-01`, journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '2234', debit: 6000.5 }, { compte: '532', debit: 20000 }, { compte: '101', credit: 26000.5 }] });
  const t = Date.UTC(annee, 0, 2);
  expect(KC.ajouterImmobilisation(L, { ...PETRIN, id: 'i-petrin' }, 'Leila', t).ok).toBe(true);
  if (o.acheter) {
    const acq = poser({ date: '2025-03-01', journal: 'AC', piece: 'FAC-FOUR', libelle: 'Four à sole', lignes: [{ compte: '2234', debit: 12000 }, { compte: '4366', debit: 2280 }, { compte: '401', credit: 14280 }] });
    expect(KC.ajouterImmobilisation(L, { ...FOUR, id: 'i-four', origine: { source: 'ecriture', docId: `${acq}#0`, mois: '' }, ...o.four }, 'Leila', t).ok).toBe(true);
  } else {
    expect(KC.ajouterImmobilisation(L, { ...FOUR, id: 'i-four', ...o.four }, 'Leila', t).ok).toBe(true);
  }
  for (const p of KC.ecrituresImmobilisations(L, annee)) {
    const id = poser(p, !o.dotationsAuBrouillard);
    expect(KC.noterEcritureImmo(L, p.immoId, annee, id).ok).toBe(true);
  }
  return L;
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

type Fiche = { id: string; fiche: { libelle: string; valeur: string; duree: string; origine: { source: string; docId: string } }; ecritures: { annee: number; genre: string; ecriture: string }[] };
const biens = async (dossier: string, jeton: string) => ((await appeler('GET', `/entreprises/${dossier}/compta/immobilisations`, jeton)).corps.immobilisations as Fiche[])
  .sort((a, b) => a.fiche.libelle.localeCompare(b.fiche.libelle));
const piece = async (id: string) => String((await admin.query('select piece from compta.ecriture where id = $1', [id])).rows[0]?.piece);

describe('la reprise d\'un livre du Cabinet v10 : les immobilisations', () => {
  it('chaque bien est posé une fois, relié à la dotation reprise et à la facture dont il est né ; l\'année suivante le retrouve', async () => {
    const { associe, cabinet, dossier } = await dossierTenu();
    const L = JSON.parse(JSON.stringify(livreDe(2025, { acheter: true }))) as Livre;
    // Une ligne vide en tête de la facture (la v10 en garde) : la fiche cite la 2e place de la v10, qui
    // est la 1re ligne écrite.
    const fac = L.ecritures.find((e) => e.piece === 'FAC-FOUR');
    const bienFour = L.immobilisations.find((x) => x.libelle === 'Four à sole');
    if (!fac || !bienFour) throw new Error('livre incomplet');
    fac.lignes.unshift({ compte: '', debit: 0, credit: 0 });
    bienFour.origine.docId = `${fac.id}#1`;
    const essai = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect([essai.statut, essai.corps.anomalies, essai.corps.immobilisations]).toEqual([200, [], { total: 2, liees: 2 }]);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.immobilisations).toEqual({ creees: 2, retrouvees: 0, liees: 2 });
    let b = await biens(dossier, associe.jeton);
    expect(b.map((x) => [x.fiche.libelle, x.fiche.valeur, x.fiche.duree, x.ecritures.map((e) => [e.annee, e.genre])])).toEqual([
      ['Four à sole', '12000.000', '5', [[2025, 'dotation']]], ['Pétrin', '6000.500', '5', [[2025, 'dotation']]]]);
    expect(await Promise.all(b.map((x) => piece(x.ecritures[0]?.ecriture ?? '')))).toEqual(['DOT-2025-four', 'DOT-2025-trin']);
    // Le four est né de sa facture : l'écriture reprise, sa première ligne.
    const four = b[0];
    const facture = String((await admin.query(`select id from compta.ecriture where entreprise = $1 and piece = 'FAC-FOUR'`, [dossier])).rows[0].id);
    expect(four?.fiche.origine).toEqual({ source: 'ecriture', docId: `${facture}#0`, mois: '' });
    // Une dotation reprise ne se repasse pas.
    const encore = await appeler('POST', `/entreprises/${dossier}/compta/immobilisations/ecrire`, associe.jeton, { annee: 2025, pieces: [{ immobilisation: four?.id, genre: 'dotation',
      ecriture: { date: '2025-12-31', journal: 'OD', piece: 'DOT-BIS', libelle: 'Dotation', lignes: [{ compte: '6811', debit: '2000,000' }, { compte: '28234', credit: '2000,000' }] } }] });
    expect([encore.statut, encore.corps.motif]).toEqual([403, 'La dotation 2025 de « Four à sole » est déjà passée : la repasser la compterait deux fois.']);

    // 2026 : les deux biens reportés, retrouvés (pas recréés) ; leur dotation de 2026 reliée.
    // Le livre de 2026 : les biens reportés gardent, dans leur plan, l'écriture de 2025 (dans l'autre
    // livre) — elle n'est pas de cet exercice, elle ne se relie pas ici.
    const L2 = JSON.parse(JSON.stringify(livreDe(2026))) as Livre;
    L2.immobilisations.forEach((x) => x.plan.forEach((p) => { if (p.annee === 2025) p.ecritureId = 'e-dans-le-livre-2025'; }));
    const r2 = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: L2 });
    expect(r2.statut, JSON.stringify(r2.corps)).toBe(201);
    expect(r2.corps.immobilisations).toEqual({ creees: 0, retrouvees: 2, liees: 2 });
    b = await biens(dossier, associe.jeton);
    expect(b.map((x) => [x.fiche.libelle, x.ecritures.map((e) => [e.annee, e.genre])])).toEqual([
      ['Four à sole', [[2025, 'dotation'], [2026, 'dotation']]], ['Pétrin', [[2025, 'dotation'], [2026, 'dotation']]]]);
  });

  it('un bien déjà dans le dossier avec un autre plan : la reprise s\'arrête en le disant, rien n\'est écrit', async () => {
    const { associe, cabinet, dossier } = await dossierTenu();
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe(2025, { acheter: true }))) })).statut).toBe(201);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe(2026, { four: { duree: 4 } }))) });
    expect([r.statut, r.corps.motif]).toEqual([403, 'Le bien « Four à sole » est déjà dans ce dossier avec un autre plan d\'amortissement : la reprise ne le change pas. Mets les deux d\'accord, puis reprends le livre.']);
    expect((await admin.query(`select count(*)::int n from compta.ecriture where entreprise = $1 and date_ecriture >= '2026-01-01'`, [dossier])).rows[0].n).toBe(0);
  });

  it('un bien qui ne se reprendrait pas tel quel est nommé : sans libellé, un compte, une date, un montant, une durée, un taux illisibles, une écriture absente ou qui n\'est pas la sienne', async () => {
    const { associe, cabinet } = await dossierTenu();
    const L = JSON.parse(JSON.stringify(livreDe(2025, { acheter: true }))) as { ecritures: Ecriture[]; immobilisations: Record<string, unknown>[] };
    const facture = L.ecritures.find((e) => e.piece === 'FAC-FOUR');
    const [petrin, four] = L.immobilisations;
    if (!facture || !petrin || !four) throw new Error('livre incomplet');
    L.immobilisations.push({ ...petrin, id: 'i-abime', libelle: '', compteAmort: '28 234', dateMiseEnService: '2023-13-01', dateAcquisition: '', valeur: 6000.0001,
      duree: 2.555, methode: 'degressif', tauxDegressif: 0.12345, plan: [] });
    (petrin.plan as { annee: number; ecritureId: string }[]).forEach((p) => { if (p.annee === 2025) p.ecritureId = 'e-inconnue'; });
    (four.plan as { annee: number; ecritureId: string }[]).forEach((p) => { if (p.annee === 2025) p.ecritureId = facture.id; });
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((r.corps.anomalies as { piece: string; motif: string }[]).map((x) => [x.piece, x.motif])).toEqual([
      ['Pétrin', 'La dotation ou la sortie de 2025 de ce bien renvoie à une écriture qui n\'est pas dans le livre.'],
      ['Four à sole', 'L\'écriture FAC-FOUR, liée à ce bien en 2025, n\'est ni sa dotation ni sa sortie.'],
      ['', 'Un bien n\'a pas de libellé.'],
      ['', 'Un compte de ce bien (immobilisation, amortissement, dotation, subvention) ne s\'écrit pas en chiffres.'],
      ['', 'La date de mise en service ou de sortie de ce bien ne se lit pas.'],
      ['', 'Un montant de ce bien (valeur, résiduelle, TVA, subvention, prix de sortie) ne se lit pas au millime.'],
      ['', 'La durée de ce bien ne se lit pas (en années, au centième au plus).'],
      ['', 'Le taux dégressif de ce bien ne se lit pas (quatre décimales au plus).'],
    ]);
  });

  it('la base refait ses contrôles : une écriture qui n\'est pas reprise, un genre inconnu, une dotation reliée deux fois, un dossier qui n\'est pas tenu', async () => {
    const { associe, cabinet, dossier } = await dossierTenu();
    // Les dotations restées au brouillard : la période n'est validée que jusqu'au 30 décembre, et une
    // écriture se saisit encore le 31.
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe(2025, { acheter: true, dotationsAuBrouillard: true }))) })).statut).toBe(201);
    const saisie = await appeler('POST', `/entreprises/${dossier}/compta/ecritures`, associe.jeton, {
      date: '2025-12-31', journal: 'OD', piece: 'OD-9', libelle: 'Dotation', lignes: [{ compte: '6811', debit: '10,000' }, { compte: '28234', credit: '10,000' }] });
    expect(saisie.statut, JSON.stringify(saisie.corps)).toBe(201);
    const reprise = String((await admin.query(`select id from compta.ecriture where entreprise = $1 and piece = 'DOT-2025-four'`, [dossier])).rows[0].id);
    const fiche = { libelle: 'Presse', compte: '2234', compteAmort: '28234', compteDotation: '6811', dateAcquisition: '2025-01-01', dateMiseEnService: '2025-01-01',
      valeur: 1000000, residuelle: 0, tva: 0, methode: 'lineaire', dureeCentiemes: 500, tauxDegressif: null, bascule: false, subvention: null, cession: null, origine: { source: 'saisie', docId: '', mois: '' } };
    const essayer = (ent: string, liens: unknown[], f: unknown = fiche) => enTantQue(pool, associe.utilisateur, (tx) => tx.query('select compta.reprendre_immobilisation_v10($1, 2025, $2::jsonb, $3::jsonb) r', [ent, JSON.stringify(f), JSON.stringify(liens)]))
      .then((x) => (x.rows[0].r as { liees: number }).liees, (e: Error) => e.message);
    expect(await essayer(dossier, [{ genre: 'dotation', ecriture: saisie.corps.id }])).toBe('une écriture liée au bien « Presse » n\'est pas une écriture reprise de 2025');
    expect(await essayer(dossier, [{ genre: 'subvention', ecriture: reprise }])).toBe('une écriture liée au bien « Presse » n\'est pas une écriture reprise de 2025');
    expect(await essayer(dossier, [{ genre: 'dotation', ecriture: reprise }, { genre: 'dotation', ecriture: reprise }])).toBe('la dotation 2025 du bien « Presse » est déjà reliée à une écriture');
    expect(await essayer(dossier, [{ genre: 'dotation', ecriture: reprise }])).toBe(1);
    // Un client sur SkanFact (sa propre entreprise) : pas de reprise chez lui.
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    const chezLui = await enTantQue(pool, client.utilisateur, (tx) => tx.query('select compta.reprendre_immobilisation_v10($1, 2025, $2::jsonb, $3::jsonb) r', [ent, JSON.stringify(fiche), '[]'])).then(() => 'écrit', (e: Error) => e.message);
    expect(chezLui).toBe('la reprise d\'un livre de la v10 s\'écrit dans un dossier que ton cabinet tient');
  });
});
