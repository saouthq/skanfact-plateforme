// La sortie de caisse de la paie (16 § 3.8 et § 10.1, urgence 5 ; docs/caisse.md). Un salaire ou une avance payés en
// espèces depuis le tiroir pendant que la caisse est ouverte comptaient deux fois : la paie les sortait de la caisse dans
// les livres, et le Z, qui ne les connaissait pas, en faisait un manque qu'il sortait encore contre le 658. Ce que le
// serveur garantit :
//   - la Paie note la sortie dans la session ouverte (le Personnel appelle la Caisse, jamais l'inverse), et le Z la retire
//     de ce que le tiroir devait contenir : il tombe juste, sans écart, et la caisse ne sort l'argent qu'une fois ;
//   - seulement le compte du tiroir (pas la banque, pas un second compte de caisse), un jour de la session, un paiement
//     reçu pendant qu'elle est ouverte ; un paiement annulé ou supprimé retire sa sortie ;
//   - un fait n'est jamais refusé (04 § 5.1) : caisse fermée, le paiement passe et rien n'est noté ; un Z figé ne change pas ;
//   - le Z ne nomme personne : une somme, jamais un salarié.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { routesCaisse } from '../../serveur/caisse/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, unknown>; baremesPaie: (r: unknown) => unknown };
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
// Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `sortie-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const veille = new Date(Date.parse(`${aujourdhui}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const ticket = (id: string, qty: number, pu: string, paye: string) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ itemId: '', label: 'Article', unit: '', qty, unitPrice: { '~n': pu }, vatRate: 19 }], discountRate: 0,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
});
// Deux salariés et leurs bulletins d'octobre 2026, tels que l'écran de la plateforme les établit (barème figé).
const karim = { id: 'e1', name: 'Karim Essai', grossSalary: 912.345, contract: 'cdi', hireDate: '2025-01-01', headOfFamily: false, children: 0, method: 'especes' };
const sonia = { id: 'e2', name: 'Sonia Essai', grossSalary: 1234.567, contract: 'cdi', hireDate: '2025-01-01', headOfFamily: true, children: 2, method: 'virement' };
const bulletin = (id: string, e: typeof karim, paye: { paidDate: string; accountId: string; method: string }) => ({
  id, employeeId: e.id, year: 2026, month: 10, computed: ecran.computePayslip(e, { year: 2026, month: 10 }, ecran.baremesPaie({})), reference: '', issuedAt: '2026-10-31', ...paye,
});
const millimes = (v: unknown) => BigInt(Math.round(Number(typeof v === 'object' && v ? (v as { '~n': string })['~n'] : v) * 1000));
const texte = (m: bigint) => `${m / 1000n}.${String(m % 1000n).padStart(3, '0')}`;

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

// Un café : la caisse (le tiroir), la banque par défaut, un coffre (un second compte de caisse) et deux salariés.
async function cafe() {
  const nadia = await personne('Nadia', 'Caisse du comptoir');
  const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Café Essai' })).corps.id);
  await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
  const revisions = new Map<string, number>();
  const envoyer = async (objets: [string, string, unknown][]) => {
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: objets.map(([collection, cle, contenu], i) =>
      ({ collection, cle, rang: contenu === null ? null : i, revision: revisions.get(`${collection}/${cle}`) ?? null, contenu: contenu === null ? null : encoder(contenu) })) });
    expect(r.statut).toBe(200);
    for (const [i, x] of (r.corps.revisions as { revision: number | null }[]).entries()) {
      const k = `${objets[i]?.[0]}/${objets[i]?.[1]}`;
      if (x.revision === null) revisions.delete(k); else revisions.set(k, x.revision);
    }
  };
  const societe = ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
  revisions.set('_racine/company', societe?.revision ?? 0);
  await envoyer([
    ['_racine', 'company', { ...societe?.contenu, name: 'Café Essai', currency: 'DT' }],
    ['accounts', 'k-caisse', { id: 'k-caisse', name: 'Caisse', kind: 'caisse', opening: 0, openingDate: aujourdhui }],
    ['accounts', 'k-banque', { id: 'k-banque', name: 'BIAT', kind: 'banque', opening: 0, openingDate: aujourdhui, isDefault: true }],
    ['accounts', 'k-coffre', { id: 'k-coffre', name: 'Coffre', kind: 'caisse', opening: 0, openingDate: aujourdhui }],
    ['employees', 'e1', karim], ['employees', 'e2', sonia],
  ]);
  const sql = async (q: string) => (await enTantQue(pool, nadia.id, (tx) => tx.query(q, [ent]))).rows;
  return { nadia, ent, envoyer, sql };
}

describe('la sortie de caisse de la paie', () => {
  it('un salaire et une avance payés du tiroir, caisse ouverte : le Z les retire de l\'attendu, la caisse ne les sort qu\'une fois', async () => {
    const { nadia, ent, envoyer, sql } = await cafe();
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '900' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, nadia.jeton, { document: ticket('t1', 3, '2.35', '8.39'), rang: 0, netAPayer: '8.390' })).statut).toBe(200);
    const b1 = bulletin('b1', karim, { paidDate: aujourdhui, accountId: 'k-caisse', method: 'especes' });
    const net = millimes(b1.computed.net);
    // Du tiroir : l'avance du soir de Karim (37,250) et son salaire. Hors du tiroir : le salaire de Sonia (banque), une
    // avance d'hier (avant l'ouverture), une avance prise au coffre (un autre compte de caisse).
    await envoyer([
      ['advances', 'a1', { id: 'a1', employeeId: 'e1', date: aujourdhui, amount: 37.25, monthly: 10, accountId: 'k-caisse', method: 'especes' }],
      ['advances', 'a2', { id: 'a2', employeeId: 'e1', date: veille, amount: 12.345, monthly: 10, accountId: 'k-caisse', method: 'especes' }],
      ['advances', 'a3', { id: 'a3', employeeId: 'e2', date: aujourdhui, amount: 45.678, monthly: 10, accountId: 'k-coffre', method: 'especes' }],
      ['advances', 'a4', { id: 'a4', employeeId: 'e2', date: aujourdhui, amount: 14.141, monthly: 10, accountId: 'k-caisse', method: 'especes' }],
      ['payslips', 'b1', b1], ['payslips', 'b2', bulletin('b2', sonia, { paidDate: aujourdhui, accountId: 'k-banque', method: 'virement' })],
    ]);
    // L'avance de Sonia, saisie par erreur, est supprimée : sa sortie part avec elle. Le salaire annulé rend la sienne ;
    // repayé, elle revient (une fois).
    await envoyer([['advances', 'a4', null]]);
    await envoyer([['payslips', 'b1', { ...b1, paidDate: '', accountId: '' }]]);
    await envoyer([['payslips', 'b1', b1]]);
    // Le tiroir : 900 + 8,390 − 37,250 − le net de Karim. Compté juste, le Z tombe juste.
    const tiroir = 900_000n + 8_390n - 37_250n - net;
    const z = (await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: texte(tiroir) })).corps.z as Record<string, unknown>;
    expect(z).toMatchObject({ fond: '900.000', parMode: { especes: '8.390' }, sorties: texte(37_250n + net), attendu: texte(tiroir), ecart: '0.000' });
    expect(JSON.stringify(z)).not.toMatch(/Karim|Sonia/);
    // Aucun manque sorti contre le 658 ; la caisse (54) n'est créditée qu'une fois de chaque paiement.
    expect(await sql(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'movements'`)).toEqual([{ n: 0 }]);
    expect(await sql(`select e.origine_type o, sum(l.credit)::text c from compta.ecriture e join compta.ligne l on l.ecriture = e.id
      where e.entreprise = $1 and l.compte = '54' and l.credit > 0 group by e.origine_type order by 1`)).toEqual([{ o: 'avance', c: String(37_250n + 45_678n) }, { o: 'salaires', c: String(net) }]);
    // L'avance d'hier précède le solde de départ de la caisse (posé aujourd'hui) : elle y est déjà comprise, et passe au compte
    // d'attente, en opération diverse (1.357.7).
    expect(await sql(`select e.journal j, sum(l.credit)::text c from compta.ecriture e join compta.ligne l on l.ecriture = e.id
      where e.entreprise = $1 and e.origine_type = 'avance' and l.compte = '471' and l.credit > 0 group by 1`)).toEqual([{ j: 'OD', c: String(12_345n) }]);
  });

  it('caisse fermée, le paiement passe et rien n\'est noté ; le Z figé ne change pas, la session suivante ne le compte pas', async () => {
    const { nadia, ent, envoyer, sql } = await cafe();
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '150.5' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '150.5' })).corps.z).toMatchObject({ attendu: '150.500', sorties: '0.000', ecart: '0.000' });
    // Après le Z, l'avance du soir arrive (le gérant la note plus tard) : un fait, jamais refusé, et rien n'est noté.
    await envoyer([['advances', 'a1', { id: 'a1', employeeId: 'e1', date: aujourdhui, amount: 37.25, monthly: 10, accountId: 'k-caisse', method: 'especes' }]]);
    expect(await sql('select count(*)::int n from caisse.sortie where entreprise = $1')).toEqual([{ n: 0 }]);
    expect((await appeler('GET', `/entreprises/${ent}/caisse`, nadia.jeton)).corps.dernierZ).toMatchObject({ attendu: '150.500', ecart: '0.000' });
    // La caisse rouvre avec ce qui reste : l'avance n'est pas une sortie de CETTE session.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '113.25' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '113.25' })).corps.z).toMatchObject({ attendu: '113.250', sorties: '0.000', ecart: '0.000' });
  });
});
