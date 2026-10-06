// Le ticket de caisse encaissé en ligne (brique 115 ; 03 § 2.1 « Caisse » ; docs/caisse.md). Ce que le serveur
// garantit, quoi que l'écran lui envoie :
//   - le caissier encaisse (il n'émet pas de facture), le commercial non ;
//   - le ticket prend un numéro de SA série (TIC), dans l'ordre ; la série des factures n'en perd aucun ;
//   - il est scellé comme une facture (montants du serveur, pièce émise) et payé en entier dans le même geste ;
//     un paiement qui ne fait pas le total ne vend rien et ne prend aucun numéro ;
//   - un passant achète « au comptoir » ; un ticket ne passe pas par la route des factures ;
//   - un ticket n'a pas de fichier de facture électronique ;
//   - au comptoir, le prix d'étiquette fait foi (lot caisse 3) : un ticket « prix TTC » se calcule TTC d'abord
//     (2 × 1,200 = 2,400, jamais 2,399), l'avoir de son retour aussi ; un ticket d'avant et une facture, non.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesCaisse } from '../../serveur/caisse/routes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

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
  const email = `ticket-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse 1', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const annee = aujourdhui.slice(0, 4);
// Un ticket comme la caisse de la v10 le fait (`ticketDeCaisse`), sans numéro : le serveur le donne.
const ticket = (id: string, lignes: { label: string; qty: number; pu: string; tva: number }[], paye: string, plus: Record<string, unknown> = {}) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: lignes.map((l) => ({ itemId: '', label: l.label, unit: '', qty: l.qty, unitPrice: { '~n': l.pu }, vatRate: l.tva })), discountRate: 0,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: 50, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
  ...plus,
});

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('le ticket de caisse encaissé en ligne', () => {
  it('le caissier encaisse dans la série des tickets, payé en entier ; le commercial non ; la série des factures ne perd rien', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const inviter = async (role: string) => {
      const p = await personne(role);
      const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: p.email, roles: [role] })).corps.jeton);
      expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv })).statut).toBe(200);
      return p;
    };
    const sami = await inviter('caissier');
    const karim = await inviter('commercial');
    const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[];
    const societe = (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, name: 'Épicerie Ben Youssef', currency: 'DT' } },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', opening: 100, openingDate: aujourdhui } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima', address: 'Sfax' } },
    ] })).statut).toBe(200);
    // La caisse s'ouvre sur l'appareil de Sami (brique 116) : il y encaisse.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '100' })).statut).toBe(200);
    const encaisser = (jeton: string, doc: Record<string, unknown>, net: string) =>
      appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: doc, rang: 0, netAPayer: net });

    // 3 × 2,350 = 7,050 HT, TVA 19 % 1,340 → 8,390 (un arrondi qui discrimine) ; puis 2 × 12,500 → 29,750.
    const t1 = await encaisser(sami.jeton, ticket('t1', [{ label: 'Lait demi-écrémé 1 L', qty: 3, pu: '2.35', tva: 19 }], '8.39'), '8.390');
    expect(t1.statut, JSON.stringify(t1.corps)).toBe(200);
    expect(t1.corps.numero).toBe(`TIC-${annee}-001`);
    // Un paiement qui ne fait pas le total ne vend rien, et ne prend aucun numéro.
    const court = await encaisser(sami.jeton, ticket('tx', [{ label: 'Huile d\'olive 1 L', qty: 2, pu: '12.5', tva: 19 }], '20'), '29.750');
    expect(court.statut).toBe(403);
    expect(String(court.corps.motif)).toBe('Le paiement du ticket (20.000) n\'est pas son total (29.750) : rien n\'a été vendu.');
    const t2 = await encaisser(sami.jeton, ticket('t2', [{ label: 'Huile d\'olive 1 L', qty: 2, pu: '12.5', tva: 19 }], '29.75', { clientId: 'c1' }), '29.750');
    expect(t2.corps.numero).toBe(`TIC-${annee}-002`);
    // Le commercial n'encaisse pas (03 § 2.1).
    const parKarim = await encaisser(karim.jeton, ticket('t3', [{ label: 'Sucre 1 kg', qty: 1, pu: '1.8', tva: 7 }], '1.926'), '1.926');
    expect(parKarim.statut).toBe(403);
    expect(String(parKarim.corps.motif)).toContain('ne permet pas d\'encaisser un ticket de caisse');

    // Dans le dossier : émis, scellé, payé ; le passant et le client.
    const objets = await lire();
    const d1 = objets.find((o) => o.cle === 't1')?.contenu;
    expect(d1).toMatchObject({ number: `TIC-${annee}-001`, ticket: true, status: 'envoyée' });
    expect((d1?.payments as unknown[]).length).toBe(1);
    expect(objets.some((o) => o.cle === 'tx')).toBe(false);
    // Au serveur : deux pièces émises, leurs règlements au millime, le passant « au comptoir », aucun fichier TEIF.
    const r = await enTantQue(pool, nadia.id, async (tx) => (await tx.query(`select p.numero_texte numero, p.statut, t.raison_sociale tiers,
        (select coalesce(sum(r.montant), 0)::text from ventes.reglement r where r.piece = p.id) paye,
        (select count(*)::int from ventes.efacture e where e.piece = p.id) teif
      from ventes.piece p join socle.tiers t on t.id = p.tiers where p.entreprise = $1 and p.ref_v10 in ('t1', 't2') order by p.numero_texte`, [ent])).rows);
    expect(r).toEqual([
      { numero: `TIC-${annee}-001`, statut: 'emise', tiers: 'Vente au comptoir', paye: '8390', teif: 0 },
      { numero: `TIC-${annee}-002`, statut: 'emise', tiers: 'Café El Walima', paye: '29750', teif: 0 },
    ]);

    // Une facture de l'API ne prend jamais un numéro de ticket : sans série de factures, elle ne s'émet pas.
    const cafe = await enTantQue(pool, nadia.id, async (tx) => String((await tx.query(`select id from socle.tiers where entreprise = $1 and ref_v10 = 'c1'`, [ent])).rows[0]?.id));
    const brouillon = await appeler('POST', `/entreprises/${ent}/ventes`, nadia.jeton, { type: 'facture', tiers: cafe, datePiece: aujourdhui, appliquerTimbre: false,
      lignes: [{ designation: 'Huile d\'olive 1 L', quantite: '4', prixUnitaire: '12.5', tauxTva: '19' }] });
    expect(brouillon.corps.id, JSON.stringify(brouillon.corps)).toBeTruthy();
    const parLApi = await appeler('POST', `/entreprises/${ent}/ventes/${String(brouillon.corps.id)}/emettre`, nadia.jeton);
    expect(parLApi.statut, JSON.stringify(parLApi.corps)).not.toBe(200);
    expect(JSON.stringify(parLApi.corps)).not.toContain('TIC-');
    expect(parLApi.corps.motif).toBe('Aucune série de factures n\'existe encore : crée-la dans les réglages.');
    // Un ticket ne passe pas par la route des factures ; une facture ne prend pas de numéro de ticket.
    const c1 = objets.find((o) => o.cle === 'c1')?.contenu;
    const parLaFacture = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia.jeton, { document: { ...ticket('t4', [{ label: 'Sucre 1 kg', qty: 1, pu: '1.8', tva: 7 }], '1.926', { clientId: 'c1' }), payments: [] }, client: c1, revision: null, rang: 3, netAPayer: '1.926' });
    expect(parLaFacture.corps.motif).toBe('Un ticket de caisse s\'encaisse depuis la caisse, avec sa série : rien n\'a été émis.');
    const facture = { ...ticket('f1', [{ label: 'Huile d\'olive 1 L', qty: 10, pu: '12.5', tva: 19 }], '0', { clientId: 'c1', ticket: undefined }), payments: [] };
    const f1 = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia.jeton, { document: facture, client: c1, revision: null, rang: 4, netAPayer: '148.750' });
    expect(f1.statut, JSON.stringify(f1.corps)).toBe(200);
    expect(f1.corps.numero).toBe(`FAC-${annee}-001`);
  });

  it('au comptoir, le prix d\'étiquette fait foi : 2 biscuits à 1,200 font 2,400, et leur retour rend 2,400', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Supérette Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', opening: 0, openingDate: aujourdhui } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima', address: 'Sfax' } },
    ] })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '50' })).statut).toBe(200);
    const encaisser = (doc: Record<string, unknown>, net: string) => appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, nadia.jeton, { document: doc, rang: 0, netAPayer: net });
    // L'étiquette dit 1,200 TTC ; la caisse garde le HT au millime (1,008, TVA 19 %), qui redonne 1,200.
    const biscuits = { label: 'Biscuits Saïd', qty: 2, pu: '1.008', tva: 19 };

    // Prix TTC : 2 × 1,200 = 2,400 au serveur ; l'écran qui dirait 2,399 se trompe, rien n'est vendu.
    const faux = await encaisser(ticket('t0', [biscuits], '2.399', { prixTtc: true }), '2.399');
    expect(faux.statut).toBe(403);
    expect(String(faux.corps.motif)).toContain('(2.399 à l\'écran, 2.400 au serveur)');
    const t1 = await encaisser(ticket('t1', [biscuits], '2.4', { prixTtc: true }), '2.400');
    expect(t1.statut, JSON.stringify(t1.corps)).toBe(200);
    expect(t1.corps.numero).toBe(`TIC-${annee}-001`);
    // Un ticket d'avant (sans le drapeau) se calcule comme avant : HT d'abord, 2,399.
    const t2 = await encaisser(ticket('t2', [biscuits], '2.399'), '2.399');
    expect(t2.statut, JSON.stringify(t2.corps)).toBe(200);
    // Une facture se calcule toujours HT d'abord, même si un écran y met le drapeau.
    const c1 = ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[]).find((o) => o.cle === 'c1')?.contenu;
    const facture = { ...ticket('f1', [biscuits], '0', { clientId: 'c1', ticket: undefined, prixTtc: true }), payments: [] };
    const f1 = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia.jeton, { document: facture, client: c1, revision: null, rang: 1, netAPayer: '2.399' });
    expect(f1.statut, JSON.stringify(f1.corps)).toBe(200);

    // Le retour des deux paquets rend 2,400 : l'avoir se calcule comme son ticket, même si l'écran oublie le drapeau.
    const avoir = { id: 'a1', type: 'avoir', number: '', status: 'émis', date: aujourdhui, dueDate: '', clientId: '', subject: 'Retour sur le ticket', reference: '',
      creditOf: 't1', creditReason: 'Paquets abîmés', lines: [{ itemId: '', label: 'Biscuits Saïd', unit: '', qty: 2, unitPrice: { '~n': '1.008' }, vatRate: 19, ligneTicket: 0 }],
      discountRate: 0, applyStamp: false, stampFee: 0, notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '', payments: [], createdAt: 1, issuedTs: Date.now() };
    const rendu = await appeler('POST', `/entreprises/${ent}/dossier-v10/rendre`, nadia.jeton, { ticket: 't1', rang: null, netAPayer: '2.400', avoir,
      paiement: { id: 'p-a1', date: aujourdhui, amount: { '~n': '-2.4' }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Rendu sur le ticket' } });
    expect(rendu.statut, JSON.stringify(rendu.corps)).toBe(200);
    expect(rendu.corps).toMatchObject({ numero: `AVO-${annee}-001`, avoir: { contenu: { prixTtc: true } } });

    // Scellés au serveur : HT + TVA = TTC, au millime ; le drapeau gardé avec la pièce.
    const r = await enTantQue(pool, nadia.id, async (tx) => (await tx.query(`select ref_v10 ref, prix_ttc, total_ht::text ht, total_tva::text tva, total_ttc::text ttc, net_a_payer::text net
      from ventes.piece where entreprise = $1 and ref_v10 in ('t1', 't2', 'f1', 'a1') order by ref_v10`, [ent])).rows);
    expect(r).toEqual([
      { ref: 'a1', prix_ttc: true, ht: '2017', tva: '383', ttc: '2400', net: '2400' },
      { ref: 'f1', prix_ttc: false, ht: '2016', tva: '383', ttc: '2399', net: '2399' },
      { ref: 't1', prix_ttc: true, ht: '2017', tva: '383', ttc: '2400', net: '2400' },
      { ref: 't2', prix_ttc: false, ht: '2016', tva: '383', ttc: '2399', net: '2399' },
    ]);
  });
});
