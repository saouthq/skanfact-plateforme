// Une réception validée suppose une commande partie (lot achats, 05/10/2026 ; docs/achats.md, « Le parcours du
// 05/10/2026 », A18). Le parcours l'a montré : une commande en brouillon recevait (« Recevoir » ne la faisait pas partir),
// et une commande au-delà du montant permis se recevait sans l'accord qu'il lui fallait pour partir. Ce que le serveur
// garantit, quoi que l'écran lui envoie :
//   - une réception ne se valide pas sur une commande en brouillon, ni sur une demande de prix, pour personne ; le refus
//     dit la commande et le geste qui débloque, et rien n'est enregistré ;
//   - la commande qui part dans le même envoi que sa réception (le geste « Recevoir ») reçoit ; une commande partie
//     aussi ; une réception en brouillon, elle, se prépare sans contrôle.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
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
const aujourdhui = new Date().toISOString().slice(0, 10);

// La boulangerie de Nadia (propriétaire) : son fournisseur de farine, et la farine.
async function boulangerie() {
  const email = `reception-commande-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  await lire();
  const envoyer = async (changements: { collection: string; cle: string; contenu: Record<string, unknown> }[]) => {
    const objets = await lire();
    return appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: changements.map((c) => ({
      ...c, rang: 0, revision: objets.find((o) => o.collection === c.collection && o.cle === c.cle)?.revision ?? null })) });
  };
  expect((await envoyer([
    { collection: 'suppliers', cle: 's1', contenu: { id: 's1', name: 'Les Grands Moulins de Tunis' } },
    { collection: 'catalog', cle: 'farine', contenu: { id: 'farine', label: 'Farine T55, sac 25 kg', unit: 'sac', unitPrice: { '~n': '42.5' }, unitCost: { '~n': '38.75' }, vatRate: 7, tracked: true } },
  ])).statut).toBe(200);
  const surLeServeur = async (collection: string, cle: string) => (await lire()).find((o) => o.collection === collection && o.cle === cle)?.contenu;
  return { envoyer, surLeServeur };
}
// 12 sacs de farine à 38,750 : une commande, puis sa réception de 12 sacs.
const commande = (id: string, numero: string, statut: string) => ({ id, type: 'commandeFournisseur', number: numero, status: statut, date: aujourdhui, dueDate: '', supplierId: 's1',
  reference: '', currency: 'DT', exchangeRate: '', discountRate: 0, notes: '', createdAt: 1,
  lines: [{ label: 'Farine T55, sac 25 kg', description: '', qty: 12, unit: 'sac', unitPrice: { '~n': '38.75' }, vatRate: 7, itemId: 'farine' }] });
const reception = (id: string, commandeId: string, statut: string, numero = '') => ({ id, type: 'reception', orderId: commandeId, supplierId: 's1', number: numero, status: statut, date: aujourdhui,
  currency: 'DT', exchangeRate: '', notes: '', createdAt: 2, ...(statut === 'validée' ? { validatedTs: 3 } : {}),
  lines: [{ label: 'Farine T55, sac 25 kg', qty: 12, unit: 'sac', unitPrice: { '~n': '38.75' }, vatRate: 7, itemId: 'farine', ligneCommande: 0 }] });

beforeAll(async () => {
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('une réception validée suppose une commande partie', () => {
  it('une commande en brouillon ou une demande de prix ne reçoit rien, propriétaire compris ; partie, ou partant avec sa réception, elle reçoit', async () => {
    const b = await boulangerie();
    // Une commande en brouillon : sa réception se prépare (brouillon), mais ne se valide pas.
    expect((await b.envoyer([{ collection: 'supplierOrders', cle: 'o1', contenu: commande('o1', 'BCF-2026-001', 'brouillon') }])).statut).toBe(200);
    expect((await b.envoyer([{ collection: 'receptions', cle: 'r1', contenu: reception('r1', 'o1', 'brouillon') }])).statut).toBe(200);
    const refus = await b.envoyer([{ collection: 'receptions', cle: 'r1', contenu: reception('r1', 'o1', 'validée', 'BR-2026-001') }]);
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif).replace(/\s+/g, ' ')).toBe('La commande BCF-2026-001 est en brouillon : une commande ne reçoit rien tant qu\'elle n\'est pas partie. Passe-la « Envoyée » (avec l\'accord qu\'il lui faut au-delà du montant permis), puis valide la réception. Rien n\'a été enregistré.');
    expect((await b.surLeServeur('receptions', 'r1'))?.status).toBe('brouillon');

    // Une demande de prix non plus.
    expect((await b.envoyer([{ collection: 'supplierOrders', cle: 'o2', contenu: commande('o2', 'BCF-2026-002', 'demande') }])).statut).toBe(200);
    const refus2 = await b.envoyer([{ collection: 'receptions', cle: 'r2', contenu: reception('r2', 'o2', 'validée', 'BR-2026-002') }]);
    expect(refus2.statut).toBe(403);
    expect(String(refus2.corps.motif)).toMatch(/^La commande BCF-2026-002 est une demande de prix : une commande ne reçoit rien/);
    expect(await b.surLeServeur('receptions', 'r2')).toBeUndefined();

    // Le geste « Recevoir » de l'écran : la commande part dans le même envoi que sa réception ; elle reçoit.
    expect((await b.envoyer([
      { collection: 'supplierOrders', cle: 'o1', contenu: commande('o1', 'BCF-2026-001', 'envoyée') },
      { collection: 'receptions', cle: 'r1', contenu: reception('r1', 'o1', 'validée', 'BR-2026-001') },
    ])).statut).toBe(200);
    expect((await b.surLeServeur('receptions', 'r1'))?.status).toBe('validée');

    // Une commande déjà partie reçoit sa seconde réception.
    expect((await b.envoyer([{ collection: 'receptions', cle: 'r3', contenu: reception('r3', 'o1', 'validée', 'BR-2026-003') }])).statut).toBe(200);
  });
});
