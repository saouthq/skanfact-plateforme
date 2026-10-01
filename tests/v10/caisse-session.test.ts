// La session de caisse (brique 116 ; 01 § 10 ; 03 § 2.1 « Caisse » ; 04 § 3.1 ; docs/caisse.md). Ce que le serveur
// garantit :
//   - caisse fermée, rien ne s'encaisse ; elle s'ouvre avec le fond de caisse sur UN appareil, qui la tient seul :
//     ni une seconde ouverture, ni un ticket depuis un autre appareil ;
//   - la fermeture compte le tiroir : le serveur dit l'attendu (le fond plus les espèces de la session), l'écart, et
//     fige le Z sur ses propres tickets (nombre, du premier au dernier, total, TVA, paiements par mode) ;
//   - un Z figé ne change plus, même en base ; après la fermeture, la caisse se rouvre sur un autre appareil.

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
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `session-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const annee = aujourdhui.slice(0, 4);
const ticket = (id: string, qty: number, pu: string, paye: string, mode: string) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ itemId: '', label: 'Article', unit: '', qty, unitPrice: { '~n': pu }, vatRate: 19 }], discountRate: 0,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode, recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: mode, accountId: mode === 'especes' ? 'k-caisse' : 'k-banque', reference: '', note: 'Encaissé en caisse' }],
});

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('la session de caisse', () => {
  it('fermée rien ne s\'encaisse ; ouverte sur un appareil, lui seul la tient ; fermée, le Z dit l\'attendu et l\'écart, et ne change plus', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const sami = await personne('Sami', 'Caisse du comptoir');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['caissier'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[];
    const societe = (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, name: 'Épicerie Ben Youssef', currency: 'DT' } },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', opening: 0, openingDate: aujourdhui } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', opening: 0, openingDate: aujourdhui, isDefault: true } },
    ] })).statut).toBe(200);
    const encaisser = (jeton: string, doc: Record<string, unknown>, net: string) =>
      appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: doc, rang: 0, netAPayer: net });
    const etat = async (jeton: string) => (await appeler('GET', `/entreprises/${ent}/caisse`, jeton)).corps;

    // Fermée : rien ne s'encaisse, et le refus porte le geste qui débloque.
    const ferme = await encaisser(sami.jeton, ticket('t0', 3, '2.35', '8.39', 'especes'), '8.390');
    expect(ferme.statut).toBe(403);
    expect(ferme.corps).toMatchObject({ motif: 'La caisse est fermée : ouvre-la avec ton fond de caisse avant d\'encaisser. Rien n\'a été vendu.', bouton: 'caisse.session.ouvrir' });
    expect((await etat(sami.jeton)).session).toBeNull();

    // Sami ouvre sur la caisse du comptoir, avec 150,500 DT de fond.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '150,500' })).corps).toMatchObject({ fond: '150.500' });
    expect((await etat(sami.jeton)).session).toMatchObject({ fond: '150.500', qui: 'Sami', appareil: 'Caisse du comptoir', ici: true });
    expect((await etat(nadia.jeton)).session).toMatchObject({ ici: false });
    // Personne ne la rouvre, et Nadia n'encaisse pas depuis son bureau : la caisse est tenue par un seul appareil.
    expect(String((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '0' })).corps.motif)).toMatch(/^La caisse est déjà ouverte \(Caisse du comptoir, par Sami, depuis /);
    expect((await encaisser(nadia.jeton, ticket('tn', 1, '10', '11.9', 'especes'), '11.900')).corps.motif)
      .toBe('La caisse est ouverte sur un autre appareil (Caisse du comptoir, par Sami) : une caisse n\'est tenue que par un appareil à la fois. Ferme-la là-bas, puis ouvre-la ici. Rien n\'a été vendu.');
    // Un montant illisible se dit.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, sami.jeton, { compte: 'cent' })).corps.motif).toBe('Le montant « cent » ne se lit pas : tape-le comme 150 ou 150,500.');

    // Deux tickets : 8,390 en espèces, 29,750 par carte.
    expect((await encaisser(sami.jeton, ticket('t1', 3, '2.35', '8.39', 'especes'), '8.390')).corps.numero).toBe(`TIC-${annee}-001`);
    expect((await encaisser(sami.jeton, ticket('t2', 2, '12.5', '29.75', 'carte'), '29.750')).corps.numero).toBe(`TIC-${annee}-002`);

    // Nadia (le propriétaire) peut fermer depuis son bureau ; un caissier, seulement sur l'appareil qui tient la caisse.
    // Sami ferme : 157,500 comptés ; le tiroir devait contenir 150,500 + 8,390 = 158,890 ; il manque 1,390.
    const z = (await appeler('POST', `/entreprises/${ent}/caisse/fermer`, sami.jeton, { compte: '157.5' })).corps.z as Record<string, unknown>;
    expect(z).toMatchObject({ nombre: 2, premier: `TIC-${annee}-001`, dernier: `TIC-${annee}-002`, total: '38.140', tva: '6.090',
      parMode: { carte: '29.750', especes: '8.390' }, fond: '150.500', attendu: '158.890', compte: '157.500', ecart: '-1.390', ouvertePar: 'Sami', appareil: 'Caisse du comptoir' });
    const apres = await etat(nadia.jeton);
    expect(apres.session).toBeNull();
    expect(apres.dernierZ).toMatchObject({ attendu: '158.890', ecart: '-1.390' });
    // Fermée : rien ne s'encaisse plus, et le Z ne change plus, même en base.
    expect((await encaisser(sami.jeton, ticket('t3', 1, '10', '11.9', 'especes'), '11.900')).statut).toBe(403);
    await expect(enTantQue(pool, nadia.id, (tx) => tx.query(`update caisse.session set ecart = 0 where entreprise = $1`, [ent])))
      .rejects.toMatchObject({ code: '42501', message: 'Une session de caisse fermée ne change plus.' });

    // Changer d'appareil après la fermeture : Nadia ouvre depuis son bureau, et y encaisse.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia.jeton, { fond: '0' })).statut).toBe(200);
    expect((await encaisser(nadia.jeton, ticket('t4', 1, '10', '11.9', 'especes'), '11.900')).corps.numero).toBe(`TIC-${annee}-003`);
    // Sami, caissier, ne la ferme pas depuis la caisse du comptoir : elle est tenue par le bureau de Nadia.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, sami.jeton, { compte: '11.9' })).corps.motif)
      .toBe('La caisse se ferme sur l\'appareil qui la tient (Bureau de Nadia), ou par le propriétaire ou un administrateur.');
    // Le Z de la seconde session ne compte que ses tickets.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '11.9' })).corps.z).toMatchObject({ nombre: 1, total: '11.900', attendu: '11.900', ecart: '0.000' });
  });
});
