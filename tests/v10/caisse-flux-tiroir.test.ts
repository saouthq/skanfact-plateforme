// Tout ce qui entre et sort du tiroir pendant la journée de caisse (1.357.6, bout en bout 15 ; 0209 ; docs/caisse.md).
// La paie était réglée depuis 0189 ; le même défaut vivait partout ailleurs : la boulangerie verse les espèces du comptoir
// à la BIAT, paie la farine « à la caisse », encaisse en espèces la facture de l'hôtel. Les livres et la Trésorerie le
// savaient, le Z non — il annonçait le soir un manque (ou un excédent) qu'il sortait une seconde fois contre le 658. Ce que
// le serveur garantit :
//   - chaque flux du tiroir noté ailleurs que sur un ticket, la caisse ouverte, se note dans la session (une sortie en
//     positif, une entrée en négatif) ; le Z les retire ou les ajoute à l'attendu, et les nomme à part de la paie ;
//   - un virement depuis le tiroir est une sortie, vers le tiroir une entrée ; un virement entre deux autres comptes, rien ;
//   - un règlement fournisseur payé du tiroir sort, un avoir remboursé en espèces entre ; une facture encaissée au comptoir
//     entre, son remboursement sort ; les tickets restent au Z (ils y sont déjà) ;
//   - une pièce changée remplace ce qu'elle avait noté, supprimée elle ne laisse rien ; l'ouverture du fond, l'écart d'un Z,
//     un autre compte de caisse, un jour avant la session : rien ;
//   - un fait n'est jamais refusé (04 § 5.1) : caisse fermée, rien n'est noté.

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
// Une facture de pains à l'hôtel, en brouillon (sans timbre), TVA à 7 %.
const brouillon = (id: string, ht: number) => ({ id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, dueDate: aujourdhui, clientId: 'c1', createdAt: 1,
  lines: [{ label: 'Pains', description: '', qty: 1, unit: '', unitPrice: ht, vatRate: 7 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] });

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

// Une boulangerie : la caisse (le tiroir), la banque par défaut, un coffre (un second compte de caisse), un fournisseur, un client.
async function cafe() {
  const nadia = await personne('Nadia', 'Caisse du comptoir');
  const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Café Essai' })).corps.id);
  await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
  const revisions = new Map<string, number>();
  const envoyer = async (objets: [string, string, unknown][]) => {
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: objets.map(([collection, cle, contenu], i) =>
      ({ collection, cle, rang: contenu === null ? null : i, revision: revisions.get(`${collection}/${cle}`) ?? null, contenu: contenu === null ? null : encoder(contenu) })) });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
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
    ['suppliers', 's1', { id: 's1', name: 'Minoterie Essai' }], ['clients', 'c1', { id: 'c1', name: 'Hôtel Essai' }],
  ]);
  const sql = async (q: string) => (await enTantQue(pool, nadia.id, (tx) => tx.query(q, [ent]))).rows;
  // Une facture s'émet par le serveur (son numéro) ; son encaissement s'enregistre ensuite, comme à l'écran.
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[];
  const emettre = async (doc: Record<string, unknown>, net: string) => {
    const client = (await lire()).find((o) => o.collection === 'clients' && o.cle === doc.clientId)?.contenu ?? null;
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia.jeton, { document: doc, client, revision: null, rang: 0, netAPayer: net });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const o = (await lire()).find((x) => x.collection === 'documents' && x.cle === doc.id);
    revisions.set(`documents/${String(doc.id)}`, o?.revision ?? 0);
    return o?.contenu ?? {};
  };
  return { nadia, ent, envoyer, sql, emettre };
}

describe('ce qui entre et sort du tiroir hors des tickets', () => {
  it('le versement à la BIAT, la farine payée à la caisse, la facture de l\'hôtel encaissée : le Z tombe juste', async () => {
    const { nadia, ent, envoyer, sql, emettre } = await cafe();
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '50.000' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, nadia.jeton, { document: ticket('t1', 2, '1.000', '2.380'), rang: 0, netAPayer: '2.380' })).statut).toBe(200);
    const facture = await emettre(brouillon('f1', 100), '107.000');
    const achat = { id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: aujourdhui, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Levure', qty: 1, unitPrice: 2.101, vatRate: 19, destination: 'charge', deductible: true }],
      payments: [{ id: 'pa1', date: aujourdhui, amount: 2.5, method: 'especes', accountId: 'k-caisse', reference: '' }] };
    // Un règlement à l'ancienne, en espèces sans compte nommé : les livres et la Trésorerie le passent au compte par défaut
    // (la BIAT, `compteDeTresorerie`) ; le tiroir ne le compte donc pas non plus (deux chemins, un chiffre).
    const ancien = { ...achat, id: 'a2', number: 'FF-2', payments: [{ id: 'pa2', date: aujourdhui, amount: 2.5, method: 'especes', accountId: '', reference: '' }] };
    await envoyer([
      // Du tiroir : 30 versés à la BIAT, la levure payée à la caisse (l'écran nomme le compte du mode, `compteDuMode`).
      ['movements', 'v1', { id: 'v1', date: aujourdhui, kind: 'virement', amount: 30, accountId: 'k-caisse', versAccountId: 'k-banque', method: 'especes', label: 'Versement des espèces', reference: '' }],
      ['purchases', 'a1', achat], ['purchases', 'a2', ancien],
      // Dans le tiroir : la facture de l'hôtel encaissée au comptoir, et 10 apportés de la banque pour la monnaie.
      ['documents', 'f1', { ...facture, payments: [{ id: 'pf1', date: aujourdhui, amount: 107, method: 'especes', accountId: 'k-caisse', reference: '', note: '' }] }],
      ['movements', 'v2', { id: 'v2', date: aujourdhui, kind: 'virement', amount: 10, accountId: 'k-banque', versAccountId: 'k-caisse', method: 'virement', label: 'Monnaie', reference: '' }],
      // Hors du tiroir : la banque vers le coffre, un retrait d'hier, l'ouverture du fond, l'écart d'un ancien Z.
      ['movements', 'v3', { id: 'v3', date: aujourdhui, kind: 'virement', amount: 40, accountId: 'k-banque', versAccountId: 'k-coffre', method: 'virement', label: '', reference: '' }],
      ['movements', 'm1', { id: 'm1', date: veille, kind: 'autre-sortie', amount: 5, accountId: 'k-caisse', method: 'especes', label: 'Hier', reference: '' }],
      ['movements', 'm2', { id: 'm2', date: aujourdhui, kind: 'apport', amount: 50, accountId: 'k-caisse', method: 'especes', label: '', reference: '', ouverture: true }],
      ['movements', 'ecart-z-1', { id: 'ecart-z-1', date: aujourdhui, kind: 'autre-sortie', amount: 0.1, accountId: 'k-caisse', method: 'especes', label: 'Écart', reference: 'Z', compte: '658' }],
    ]);
    // Le versement corrigé (25 au lieu de 30) remplace sa sortie ; un retrait saisi par erreur, supprimé, ne laisse rien.
    await envoyer([['movements', 'v1', { id: 'v1', date: aujourdhui, kind: 'virement', amount: 25, accountId: 'k-caisse', versAccountId: 'k-banque', method: 'especes', label: 'Versement des espèces', reference: '' }],
      ['movements', 'm3', { id: 'm3', date: aujourdhui, kind: 'autre-sortie', amount: 7, accountId: 'k-caisse', method: 'especes', label: 'Erreur', reference: '' }]]);
    await envoyer([['movements', 'm3', null]]);
    expect(await sql('select nature, montant::text from caisse.sortie where entreprise = $1 order by nature, montant')).toEqual([
      { nature: 'achat', montant: '2500' }, { nature: 'mouvement', montant: '-10000' }, { nature: 'mouvement', montant: '25000' }, { nature: 'vente', montant: '-107000' }]);
    // Le tiroir : 50 + 2,380 − 25 − 2,500 + 107 + 10 = 141,880. Compté juste, le Z tombe juste et nomme les deux sens.
    const z = (await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '141.880' })).corps.z as Record<string, unknown>;
    expect(z).toMatchObject({ fond: '50.000', parMode: { especes: '2.380' }, autresSorties: '27.500', autresEntrees: '117.000', attendu: '141.880', ecart: '0.000' });
    expect(z.sorties).toBe('0.000');
    // Aucun écart n'est sorti contre le 658 : seul celui de l'ancien Z, posé à la main ici, existe.
    expect(await sql(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'movements' and cle like 'ecart-z-%'`)).toEqual([{ n: 1 }]);
  });

  it('caisse fermée, rien n\'est noté ; un avoir remboursé en espèces entre, un remboursement au client sort', async () => {
    const { nadia, ent, envoyer, sql, emettre } = await cafe();
    await envoyer([['movements', 'v1', { id: 'v1', date: aujourdhui, kind: 'virement', amount: 30, accountId: 'k-caisse', versAccountId: 'k-banque', method: 'especes', label: '', reference: '' }]]);
    expect(await sql('select count(*)::int n from caisse.sortie where entreprise = $1')).toEqual([{ n: 0 }]);
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '100.000' })).statut).toBe(200);
    const f2 = await emettre(brouillon('f2', 50), '53.500');
    await envoyer([
      ['purchases', 'av1', { id: 'av1', kind: 'avoir', supplierId: 's1', number: 'AV-1', date: aujourdhui, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
        tvaRecuperable: true, lines: [{ label: 'Retour', qty: 1, unitPrice: 10, vatRate: 19, destination: 'charge', deductible: true }],
        payments: [{ id: 'pr1', date: aujourdhui, amount: 11.9, method: 'especes', accountId: 'k-caisse', reference: '' }] }],
      ['documents', 'f2', { ...f2,
        payments: [{ id: 'pf2', date: aujourdhui, amount: 60, method: 'especes', accountId: 'k-caisse', reference: '', note: '' },
          { id: 'pf3', date: aujourdhui, amount: -6.5, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Trop-perçu rendu' }] }],
    ]);
    // 100 + 11,900 (l'avoir remboursé) + 60 (la facture) − 6,500 (le trop-perçu rendu) = 165,400.
    const z = (await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '165.400' })).corps.z as Record<string, unknown>;
    expect(z).toMatchObject({ autresSorties: '6.500', autresEntrees: '71.900', attendu: '165.400', ecart: '0.000' });
  });

  it('0209 : seuls les flux du tiroir peuvent être des entrées ; la paie reste une sortie positive, et rien n\'est nul', async () => {
    const { nadia, ent, sql } = await cafe();
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '10.000' })).statut).toBe(200);
    const session = String((await sql('select id from caisse.session where entreprise = $1 and fermee_le is null'))[0]?.id);
    const noter = (nature: string, montant: string) => enTantQue(pool, nadia.id, (tx) => tx.query(`insert into caisse.sortie (entreprise, session, nature, origine, montant, cree_par)
      values ($1, $2, $3, $4, $5, socle.moi())`, [ent, session, nature, `essai/${nature}#${montant}`, montant])).then(() => 'noté', (e: { message: string }) => e.message);
    for (const nature of ['mouvement', 'achat', 'vente']) expect(await noter(nature, '-1000')).toBe('noté');
    for (const nature of ['salaire', 'avance']) expect(await noter(nature, '-1000')).toMatch(/sortie_montant_check/);
    expect(await noter('mouvement', '0')).toMatch(/sortie_montant_check/);
    expect(await noter('cadeau', '1000')).toMatch(/sortie_nature_check/);
  });
});
