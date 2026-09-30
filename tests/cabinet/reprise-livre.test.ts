// L'essai à blanc de la reprise d'un livre du Cabinet v10 (brique 62 ; docs/cabinet.md, C52). Le livre
// est fabriqué par le moteur de la v10 lui-même (web/public/v10/compta.js) : écritures saisies,
// validées (numérotées) ou laissées au brouillard, à-nouveaux, une facture lettrée avec son règlement. Ce que le serveur
// garantit : rien n'est créé ; ce qui passe est compté ; la balance des validées est celle que la v10
// calcule elle-même (deux chemins, un chiffre) ; ce qui ne se reprendrait pas tel quel est nommé.

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
const EMPREINTE_AVRIL = 'a1'.repeat(32);
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => Livre;
  ajouterEcriture: (l: Livre, e: Record<string, unknown>, qui: string, quand: number) => { id: string };
  validerEcriture: (l: Livre, id: string, qui: string, quand: number) => { ok: boolean; motif?: string };
  lettrer: (l: Livre, compte: string, ids: string[], lettre: string, qui: string, jour: string) => { ok: boolean; lettre?: string; motif?: string };
  ajouterReleve: (l: Livre, r: Record<string, unknown>, qui: string, quand: number) => { ok: boolean; releve?: { id: string }; motif?: string };
  rapprocherAuto: (l: Livre, releve: string, o: Record<string, unknown>) => { ok: boolean; compte: Record<string, number> };
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
// (montants au millime qui discriminent un arrondi), un achat au brouillard, la facture et son
// encaissement lettrés « A » sur le 411 (par le geste de la v10 : les lignes du compte, sa lettre), et le
// relevé d'avril du 532 importé puis rapproché par la v10 : le virement de l'Hôtel du Lac en face de
// l'encaissement (certain), les frais de tenue de compte sans rien en face.
function livreDe2025() {
  const L = KC.livreVide('D', 2025, {});
  const poser = (e: Record<string, unknown>, valider: boolean) => {
    const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2025, 5, 1));
    if (valider) expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2025, 5, 2)).ok).toBe(true);
    return x;
  };
  poser({ date: '2025-01-01', journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '532', debit: 12500.125 }, { compte: '101', credit: 12500.125 }] }, true);
  const fac = poser({ date: '2025-03-14', journal: 'VT', piece: 'FAC-2025-014', libelle: 'Facture Hôtel du Lac', lignes: [{ compte: '411', tiers: 'Hôtel du Lac', debit: 1191.001 }, { compte: '707', credit: 1000.001 }, { compte: '4367', credit: 191 }] }, true);
  const enc = poser({ date: '2025-04-02', journal: 'BQ', piece: 'VIR-88', libelle: 'Encaissement Hôtel du Lac', lignes: [{ compte: '532', debit: 1191.001 }, { compte: '411', tiers: 'Hôtel du Lac', credit: 1191.001 }] }, true);
  poser({ date: '2025-05-20', journal: 'AC', piece: 'FF-77', libelle: 'Papeterie', lignes: [{ compte: '6064', debit: 84.034 }, { compte: '4366', debit: 15.966 }, { compte: '401', credit: 100 }] }, false);
  expect(KC.lettrer(L, '411', [fac.id, enc.id], '', 'Leila', '2025-06-03')).toEqual({ ok: true, lettre: 'A' });
  const rel = KC.ajouterReleve(L, { compte: '532', banque: 'BIAT', fichier: 'releve-avril.csv', empreinte: EMPREINTE_AVRIL, soldeDebut: 12500.125, soldeFin: 13678.626,
    lignes: [{ date: '2025-04-02', libelle: 'VIR HOTEL DU LAC', montant: 1191.001, reference: 'VIR-88' }, { date: '2025-04-30', libelle: 'FRAIS TENUE DE COMPTE', montant: -12.5, reference: '' }] }, 'Leila', Date.UTC(2025, 4, 5));
  expect(rel.ok).toBe(true);
  expect(KC.rapprocherAuto(L, rel.releve?.id ?? '', { date: '2025-05-05' }).compte).toMatchObject({ certain: 1, aucun: 1 });
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
      lettrages: 1,
      releves: { total: 1, lignes: 2, rapprochees: 1 },
      anomalies: [],
      autour: { questions: 2, immobilisations: 0 },
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
      // La facture changée d'un millime ne solde plus sa lettre.
      ['FAC-2025-014', 'La lettre A ne se solde pas : il reste 0.001.'],
    ]);
    const pasUnLivre = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: { dossiers: [] } });
    expect([pasUnLivre.statut, pasUnLivre.corps.motif]).toEqual([400, 'Ce fichier n\'est pas le livre d\'un exercice du Cabinet v10 (livre-AAAA.json) : rien n\'a été lu.']);
    const collaborateur = await personne('collaborateur');
    await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, '{revision}')`, [collaborateur.utilisateur, cabinet]);
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, collaborateur.jeton, { livre: L })).statut).toBe(403);
  });

  it('une lettre qui ne se reprendrait pas telle quelle est nommée : plusieurs comptes, un brouillard, une seule écriture, un reste, une forme illisible', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const L = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: { lignes: { compte: string; lettre: string }[] }[] };
    L.ecritures.push({ id: 'e-od', numero: 4, statut: 'validee', date: '2025-07-31', journal: 'OD', piece: 'OD-7', libelle: 'Loyer de juillet',
      lignes: [{ compte: '6132', debit: 850.5, credit: 0, lettre: '' }, { compte: '401', debit: 0, credit: 850.5, lettre: '' }] } as never);
    const [an, vt, bq, ac, od] = L.ecritures;
    if (!an || !vt || !bq || !ac || !od) throw new Error('livre incomplet');
    const lettrer = (e: typeof an, compte: string, lettre: string) => { const l = e.lignes.find((x) => x.compte === compte); if (l) l.lettre = lettre; };
    lettrer(an, '532', 'E'); lettrer(bq, '532', 'E');      // 12500.125 + 1191.001 au débit : il reste
    lettrer(an, '101', 'B'); lettrer(vt, '707', 'B');      // deux comptes
    lettrer(vt, '4367', 'b');                              // une lettre qui ne s'écrit pas
    lettrer(ac, '401', 'C');                               // l'achat au brouillard
    lettrer(od, '6132', 'D');                              // une seule écriture
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps.lettrages).toBe(6);
    expect((r.corps.anomalies as { piece: string; motif: string }[]).map((x) => [x.piece, x.motif])).toEqual([
      ['AN', 'La lettre E ne se solde pas : il reste 13691.126.'],
      ['AN', 'La lettre B relie plusieurs comptes (101, 707) : un lettrage tient sur un seul compte.'],
      ['FAC-2025-014', 'La lettre « b » ne s\'écrit pas de une à cinq lettres, de A à Z.'],
      ['FF-77', 'La lettre C touche une écriture au brouillard : on ne lettre que des écritures validées.'],
      ['OD-7', 'La lettre D ne relie qu\'une écriture : un lettrage en relie au moins deux.'],
    ]);
  });

  it('un relevé qui ne se reprendrait pas tel quel est nommé : ne se boucle pas, sans compte, une ligne illisible, deux fois le même fichier, un rapprochement faux ou pris deux fois', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    type R = { id: string; compte: string; fichier: string; empreinte: string; soldeDebut: number; soldeFin: number; du: string;
      lignes: { date: string; montant: number; rapprochement: { niveau: string; ecritureId: string; ligne: number } }[] };
    const L = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: { id: string; piece: string }[]; releves: R[] };
    const [bon] = L.releves;
    const vt = L.ecritures.find((e) => e.piece === 'FAC-2025-014');
    if (!bon || !vt) throw new Error('livre incomplet');
    const copie = (x: Partial<R>): R => ({ ...JSON.parse(JSON.stringify(bon)) as R, ...x });
    // Le même virement rapproché une seconde fois, et un solde de fin faux d'un millime.
    L.releves.push(copie({ id: 'r2', fichier: 'releve-avril-bis.csv', empreinte: 'b2'.repeat(32), soldeFin: 13678.627 }));
    // Sans compte, un solde de départ à quatre décimales ; une ligne aussi (le bouclage ne se juge pas sans elles).
    L.releves.push(copie({ id: 'r3', compte: '', fichier: 'releve-sans-compte.csv', empreinte: 'c3'.repeat(32), soldeDebut: 0.0001,
      lignes: [{ date: '2025-05-02', montant: 1.2345, rapprochement: { niveau: 'aucun', ecritureId: '', ligne: -1 } }] }));
    // Le fichier d'avril une seconde fois ; sa ligne rapprochée du 707 de la facture.
    L.releves.push(copie({ id: 'r4', fichier: 'releve-avril-copie.csv', soldeDebut: 0, soldeFin: 5,
      lignes: [{ date: '2025-03-14', montant: 5, rapprochement: { niveau: 'certain', ecritureId: vt.id, ligne: 1 } }] }));
    // Un relevé sans aucune ligne.
    L.releves.push(copie({ id: 'r5', fichier: 'releve-vide.csv', empreinte: 'd4'.repeat(32), soldeDebut: 10, soldeFin: 10, lignes: [] }));
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre/essai`, associe.jeton, { livre: L });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps.releves).toEqual({ total: 5, lignes: 5, rapprochees: 1 });   // la ligne illisible ne compte pas
    expect((r.corps.anomalies as { piece: string; motif: string }[]).map((x) => [x.piece, x.motif])).toEqual([
      ['releve-avril-bis.csv', 'La ligne 1 de ce relevé est rapprochée d\'une ligne d\'écriture qui répond déjà d\'une autre ligne de relevé.'],
      ['releve-avril-bis.csv', 'Ce relevé ne se boucle pas : 12500.125 au départ, 1178.501 de mouvements, et il annonce 13678.627.'],
      ['releve-sans-compte.csv', 'Un solde de ce relevé ne se lit pas au millime.'],
      ['releve-sans-compte.csv', 'Ce relevé n\'a pas de compte bancaire qui s\'écrive en chiffres.'],
      ['releve-sans-compte.csv', 'La ligne 1 de ce relevé n\'a pas de date ou de montant lisible au millime.'],
      ['releve-avril-copie.csv', 'Ce relevé est deux fois dans le livre (le même fichier).'],
      ['releve-avril-copie.csv', 'La ligne 1 de ce relevé est rapprochée d\'une ligne d\'écriture qui n\'est pas dans le livre sur le compte 532.'],
      ['releve-vide.csv', 'Ce relevé ne porte aucune ligne.'],
    ]);
  });
});

describe('la reprise d\'un livre du Cabinet v10 : l\'écriture dans un dossier tenu', () => {
  type Ecriture = { id: string; journal: string; date: string; piece: string; statut: string; numero: string | null };
  const livres = async (ent: string, jeton: string) => ((await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[])
    .map((e) => [e.piece, e.statut, e.numero]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const lettres = async (ent: string) => (await admin.query(`select g.lettre, l.compte, e.piece from compta.ligne_lettree t join compta.lettrage g on g.id = t.lettrage
      join compta.ligne l on l.id = t.ligne join compta.ecriture e on e.id = l.ecriture where t.entreprise = $1`, [ent])).rows
    .map((x) => [x.lettre, x.compte, x.piece]).sort((a, b) => `${a[0]}|${a[2]}`.localeCompare(`${b[0]}|${b[2]}`));

  it('les écritures s\'écrivent avec leur numéro de la v10 ; la période se valide jusqu\'au dernier jour tout validé ; chaque journal continue ; une seconde reprise, refusée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const livre = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: unknown[] };
    // Une validée APRÈS le brouillard de mai : la période ne se valide que jusqu'à la veille du brouillard.
    livre.ecritures.push({ id: 'e-od', numero: 4, statut: 'validee', date: '2025-07-31', journal: 'OD', piece: 'OD-7', libelle: 'Loyer de juillet',
      lignes: [{ compte: '6132', debit: 850.5, credit: 0 }, { compte: '401', debit: 0, credit: 850.5 }] });
    // Une ligne vide en tête de l'encaissement (la v10 en garde) : le rapprochement cite la place de la
    // ligne dans la v10 (la 2e), qui est la 1re écrite. Et un jugement « à confirmer » gardé sur les frais.
    const ecr = livre.ecritures as { piece: string; lignes: Record<string, unknown>[] }[];
    ecr.find((e) => e.piece === 'VIR-88')?.lignes.unshift({ compte: '', debit: 0, credit: 0 });
    const rel = (livre as unknown as { releves: { lignes: { rapprochement: { ligne: number; niveau: string } }[] }[] }).releves[0];
    if (!rel?.lignes[0] || !rel.lignes[1]) throw new Error('relevé incomplet');
    rel.lignes[0].rapprochement.ligne += 1;
    rel.lignes[1].rapprochement.niveau = 'a-confirmer';
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps).toMatchObject({ validees: 4, brouillard: 1, lettrages: 1, lettres: [], releves: 1, rapprochees: 1, jusqua: '2025-05-19' });
    expect(r.corps.ids).toBeUndefined();
    // Le relevé d'avril, tel que la banque de la plateforme le lit : ses soldes, ses lignes, le virement
    // rapproché de la ligne du 532 de l'encaissement (posé par l'automatique), les frais « à confirmer ».
    const rv = (await appeler('GET', `/entreprises/${dossier}/compta/releves?annee=2025`, associe.jeton)).corps.releves as {
      compte: string; banque: string; du: string; au: string; soldeDebut: string; soldeFin: string; fichier: string; empreinte: string;
      lignes: { rang: number; montant: string; niveau: string; rapprochement: { ecriture: string; rang: number; niveau: string; auto: boolean } | null }[] }[];
    expect(rv.map(({ lignes, ...x }) => ({ ...x, lignes: lignes.map((l) => ({ ...l, rapprochement: l.rapprochement && { ...l.rapprochement, ecriture: typeof l.rapprochement.ecriture } })) }))).toMatchObject([{
      compte: '532', banque: 'BIAT', du: '2025-04-02', au: '2025-04-30', soldeDebut: '12500.125', soldeFin: '13678.626', fichier: 'releve-avril.csv', empreinte: EMPREINTE_AVRIL,
      lignes: [{ rang: 1, montant: '1191.001', niveau: 'aucun', rapprochement: { ecriture: 'string', rang: 1, niveau: 'certain', auto: true } },
        { rang: 2, montant: '-12.500', niveau: 'a-confirmer', rapprochement: null }],
    }]);
    const vir = (await admin.query(`select id from compta.ecriture where entreprise = $1 and piece = 'VIR-88'`, [dossier])).rows[0].id;
    expect(rv[0]?.lignes[0]?.rapprochement?.ecriture).toBe(vir);
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
    expect(trace).toEqual([{ apres: { annee: 2025, validees: 4, brouillard: 1, lettrages: 1, empreinte: r.corps.empreinte, jusqua: '2025-05-19' } }]);
    // La facture et son encaissement restent lettrés « A » sur le 411 : la facture se relit payée.
    expect(await lettres(dossier)).toEqual([['A', '411', 'FAC-2025-014'], ['A', '411', 'VIR-88']]);
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

  it('l\'année suivante reprise à son tour : une lettre libre se garde, une lettre prise devient la suivante libre et le résultat le dit', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe2025())) })).statut).toBe(201);
    // 2026 dans la v10 : ses lettres recommencent à A. « A » est prise par 2025 ; « B » est libre, et
    // « A » ne doit pas la lui prendre : elle devient « C ».
    const L = KC.livreVide('D', 2026, {});
    const poser = (e: Record<string, unknown>) => { const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2026, 1, 1)); expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2026, 1, 2)).ok).toBe(true); return x.id; };
    const f1 = poser({ date: '2026-01-10', journal: 'VT', piece: 'FAC-2026-001', libelle: 'Facture', lignes: [{ compte: '411', debit: 238 }, { compte: '707', credit: 200 }, { compte: '4367', credit: 38 }] });
    const f2 = poser({ date: '2026-01-12', journal: 'AC', piece: 'FF-201', libelle: 'Farine', lignes: [{ compte: '6061', debit: 500.25 }, { compte: '401', credit: 500.25 }] });
    const r1 = poser({ date: '2026-01-20', journal: 'BQ', piece: 'VIR-101', libelle: 'Encaissement', lignes: [{ compte: '532', debit: 238 }, { compte: '411', credit: 238 }] });
    const r2 = poser({ date: '2026-01-25', journal: 'BQ', piece: 'VIR-102', libelle: 'Règlement Minoterie', lignes: [{ compte: '401', debit: 500.25 }, { compte: '532', credit: 500.25 }] });
    expect(KC.lettrer(L, '411', [f1, r1], '', 'Leila', '2026-02-03').lettre).toBe('A');
    expect(KC.lettrer(L, '401', [f2, r2], '', 'Leila', '2026-02-03').lettre).toBe('B');
    // Un relevé sans l'empreinte de son fichier (saisi sans fichier) : il prend celle de son contenu.
    expect(KC.ajouterReleve(L, { compte: '532', soldeDebut: 0, soldeFin: 238, lignes: [{ date: '2026-01-20', libelle: 'VIR CLIENT', montant: 238 }] }, 'Leila', Date.UTC(2026, 1, 3)).ok).toBe(true);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(L)) });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps).toMatchObject({ validees: 4, lettrages: 2, lettres: [{ v10: 'A', lettre: 'C' }], releves: 1 });
    const sansEmpreinte = (await appeler('GET', `/entreprises/${dossier}/compta/releves?annee=2026`, associe.jeton)).corps.releves as { empreinte: string }[];
    expect(sansEmpreinte.map((x) => x.empreinte)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(await lettres(dossier)).toEqual([
      ['A', '411', 'FAC-2025-014'], ['A', '411', 'VIR-88'], ['B', '401', 'FF-201'], ['B', '401', 'VIR-102'], ['C', '411', 'FAC-2026-001'], ['C', '411', 'VIR-101'],
    ]);
    // Un lettrage posé ensuite à la main prend la lettre libre suivante.
    const ecrire = async (e: Record<string, unknown>) => String((await appeler('POST', `/entreprises/${dossier}/compta/ecritures`, associe.jeton, e)).corps.id);
    const f3 = await ecrire({ date: '2026-02-10', journal: 'VT', piece: 'FAC-2026-002', libelle: 'Facture', lignes: [{ compte: '411', debit: '100,000' }, { compte: '707', credit: '100,000' }] });
    const r3 = await ecrire({ date: '2026-02-15', journal: 'BQ', piece: 'VIR-103', libelle: 'Encaissement', lignes: [{ compte: '532', debit: '100,000' }, { compte: '411', credit: '100,000' }] });
    expect((await appeler('POST', `/entreprises/${dossier}/compta/ecritures/valider`, associe.jeton, { ids: [f3, r3] })).statut).toBe(200);
    const lt = await appeler('POST', `/entreprises/${dossier}/compta/lettrages`, associe.jeton, { compte: '411', ecritures: [f3, r3] });
    expect([lt.statut, lt.corps.lettre], JSON.stringify(lt.corps)).toEqual([201, 'D']);
  });

  it('le relevé d\'une année déjà repris avec une autre : refusé en le disant, rien d\'écrit', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(livreDe2025())) })).statut).toBe(201);
    // Le livre de 2026 de la v10 a importé, lui aussi, le relevé d'avril 2025.
    const L = KC.livreVide('D', 2026, {});
    const x = KC.ajouterEcriture(L, { date: '2026-01-10', journal: 'OD', piece: 'OD-1', libelle: 'Loyer', lignes: [{ compte: '6132', debit: 850.5 }, { compte: '401', credit: 850.5 }] }, 'Leila', Date.UTC(2026, 1, 1));
    expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2026, 1, 2)).ok).toBe(true);
    expect(KC.ajouterReleve(L, { compte: '532', fichier: 'releve-avril.csv', empreinte: EMPREINTE_AVRIL, soldeDebut: 12500.125, soldeFin: 13678.626,
      lignes: [{ date: '2025-04-02', libelle: 'VIR HOTEL DU LAC', montant: 1191.001 }, { date: '2025-04-30', libelle: 'FRAIS', montant: -12.5 }] }, 'Leila', Date.UTC(2026, 1, 3)).ok).toBe(true);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: JSON.parse(JSON.stringify(L)) });
    expect([r.statut, r.corps.motif]).toMatchObject([403, expect.stringMatching(/^Ce fichier a déjà été importé le \d{2}\/\d{2}\/\d{4} \(02\/04\/2025 → 30\/04\/2025\)\.$/)]);
    expect((await admin.query(`select count(*)::int n from compta.ecriture where entreprise = $1 and date_ecriture >= '2026-01-01'`, [dossier])).rows[0].n).toBe(0);
  });

  it('la base refait les contrôles de chaque lettre : un livre envoyé sans l\'essai ne pose pas un lettrage faux', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const essayer = (ecritures: unknown[]) => enTantQue(pool, associe.utilisateur, (tx) => tx.query(`select compta.reprendre_livre_v10($1, 2025, '2025-01-01', '2025-12-31', $2::jsonb, 'x') r`, [dossier, JSON.stringify(ecritures)]))
      .then((x) => (x.rows[0].r as { lettrages: number }).lettrages, (e: Error) => e.message);
    const ecr = (numero: number | null, lignes: [string, number, number, string][]) => ({ date: '2025-03-01', journal: 'OD', statut: numero ? 'validee' : 'brouillard', numero: numero ? String(numero) : null,
      lignes: lignes.map(([compte, debit, credit, lettre]) => ({ compte, debit: String(debit), credit: String(credit), lettre })) });
    const refus = 'la lettre A de la reprise ne se reprend pas telle quelle';
    // Chaque cas ne manque qu'à UNE règle : les autres tiennent (une somme nulle, deux écritures validées…).
    expect(await essayer([ecr(1, [['411', 1000, 0, 'A'], ['707', 0, 1000, '']]), ecr(2, [['411', 1000, 0, ''], ['532', 0, 1000, 'A']])])).toBe(refus);   // deux comptes
    expect(await essayer([ecr(1, [['411', 1000, 0, 'A'], ['707', 0, 1000, '']]), ecr(null, [['532', 1000, 0, ''], ['411', 0, 1000, 'A']])])).toBe(refus);  // un brouillard
    expect(await essayer([ecr(1, [['411', 1000, 0, 'A'], ['411', 0, 1000, 'A']])])).toBe(refus);                                                        // une seule écriture
    expect(await essayer([ecr(1, [['411', 1000, 0, 'A'], ['707', 0, 1000, '']]), ecr(2, [['532', 999, 0, ''], ['411', 0, 999, 'A']])])).toBe(refus);     // un reste
    expect(await essayer([ecr(1, [['411', 1000, 0, 'a'], ['707', 0, 1000, '']]), ecr(2, [['532', 1000, 0, ''], ['411', 0, 1000, 'a']])])).toBe(refus.replace(' A ', ' a ')); // la forme
    expect(await essayer([ecr(1, [['411', 1000, 0, 'A'], ['707', 0, 1000, '']]), ecr(2, [['532', 1000, 0, ''], ['411', 0, 1000, 'A']])])).toBe(1);
  });

  it('un livre qui a une anomalie ne s\'écrit pas ; un client sur SkanFact ne reçoit pas de reprise ; un collaborateur non plus', async () => {
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    const dossier = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const abime = JSON.parse(JSON.stringify(livreDe2025())) as { ecritures: { journal: string }[] };
    if (abime.ecritures[3]) abime.ecritures[3].journal = 'BQ2';
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/livre`, associe.jeton, { dossier, livre: abime });
    expect([r.statut, r.corps.motif]).toEqual([400, 'Ce livre ne se reprend pas tel quel : le rapport nomme ce qui l\'empêche (1), un point après l\'autre ; rien n\'a été écrit.']);
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
