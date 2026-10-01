// L'accord d'un responsable au-delà d'une commande fournisseur (brique 114 ; 03 D11 : « une commande fournisseur » ;
// docs/accords.md). Ce que le serveur garantit, quoi que l'écran lui envoie :
//   - le montant permis sans accord (hors taxes, dans la devise de l'entreprise) se règle par un responsable, jusque
//     dans la base ; sans lui, rien ne change ;
//   - au-delà, la comptable interne n'envoie pas la commande sans accord (une commande en devise se compte à son
//     taux) ; le propriétaire, si ; une commande déjà partie qui ne grossit pas passe ; qui grossit redemande ;
//   - l'accord se demande (le serveur recalcule le montant), se refuse, se donne, et couvre ce montant.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
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
let n = 0;
async function personne(prenom: string) {
  const email = `accord-commande-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, nom: `${prenom} ${n}`, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const aujourdhui = new Date().toISOString().slice(0, 10);
// 40 sacs à 16,875 (675,000) et le transport (350,750) : 1 025,750 DT hors taxes. Des montants qui discriminent.
const commande = (id: string, numero: string, statut: string, plus: Record<string, unknown> = {}) => ({
  id, type: 'commandeFournisseur', number: numero, status: statut, date: aujourdhui, dueDate: '', supplierId: 's1', reference: '', currency: 'DT', exchangeRate: '', discountRate: 0,
  lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 40, unit: 'sac', unitPrice: { '~n': '16.875' }, vatRate: 19 }, { label: 'Transport', description: '', qty: 1, unit: '', unitPrice: { '~n': '350.75' }, vatRate: 7 }],
  notes: '', createdAt: 1, ...plus });

// Matériaux Ben Youssef : Nadia (propriétaire) et Ines (comptabilité interne : elle écrit les commandes fournisseurs).
async function magasin() {
  const proprio = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const comptable = await personne('Ines');
  const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: comptable.email, roles: ['comptabilite_interne'] })).corps.jeton);
  expect((await appeler('POST', '/invitations/accepter', comptable.jeton, { jeton: invitation })).statut).toBe(200);
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, proprio.jeton)).corps.objets as Objet[];
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  const societe = (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company');
  expect((await envoyer(proprio.jeton, [
    { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, name: 'Matériaux Ben Youssef', currency: 'DT' } },
    { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Béton du Nord', address: 'Zone industrielle, Bizerte' } },
  ])).statut).toBe(200);
  // Écrire une commande comme l'écran : avec la révision que le serveur lui connaît.
  const ecrire = async (jeton: string, o: Record<string, unknown>) => {
    const avant = (await lire()).find((x) => x.collection === 'supplierOrders' && x.cle === o.id);
    return envoyer(jeton, [{ collection: 'supplierOrders', cle: o.id, rang: 0, revision: avant?.revision ?? null, contenu: o }]);
  };
  const surLeServeur = async (id: string) => (await lire()).find((x) => x.collection === 'supplierOrders' && x.cle === id)?.contenu;
  const regler = (qui: string, champ: Record<string, unknown>) => enTantQue(pool, qui, (tx) => tx.query(
    `update socle.dossier_v10 set contenu = contenu || $2::jsonb where entreprise = $1 and collection = '_racine' and cle = 'company'`, [ent, JSON.stringify(champ)]));
  return { ent, proprio, comptable, ecrire, surLeServeur, regler };
}

beforeAll(async () => {
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('l\'accord d\'un responsable au-delà d\'une commande fournisseur', () => {
  it('au-delà du montant permis, la comptable demande l\'accord ; refusé, la commande ne part pas ; accordé, elle part ; grossie, elle redemande', async () => {
    const m = await magasin();
    const { ent, proprio, comptable } = m;
    // Sans seuil, rien ne change : une commande de 1 025,750 part (la valeur par défaut qui ne fait rien).
    expect((await m.ecrire(comptable.jeton, commande('o0', 'BCF-2026-001', 'envoyée'))).statut).toBe(200);
    // Le seuil se règle par un responsable, jusque dans la base.
    await expect(m.regler(comptable.id, { commandeAccordAuDela: 5000 })).rejects.toMatchObject({ code: '42501',
      message: 'Le montant d\'une commande fournisseur permis sans accord se règle par le propriétaire ou un administrateur.' });
    await m.regler(proprio.id, { commandeAccordAuDela: 1000 });
    // La commande partie avant le seuil, qui ne grossit pas, se modifie encore (une note).
    expect((await m.ecrire(comptable.jeton, commande('o0', 'BCF-2026-001', 'envoyée', { notes: 'Livrer par l\'arrière' }))).statut).toBe(200);

    // En brouillon, rien à demander ; envoyée, refusée avec ses chiffres et le geste qui débloque.
    expect((await m.ecrire(comptable.jeton, commande('o1', 'BCF-2026-002', 'brouillon'))).statut).toBe(200);
    const refus = await m.ecrire(comptable.jeton, commande('o1', 'BCF-2026-002', 'envoyée'));
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif).replace(/\s+/g, ' ')).toBe('La commande BCF-2026-002 chez Béton du Nord fait 1 025,750 DT hors taxes, au-delà des 1 000,000 DT permis sans accord : elle part avec l\'accord du propriétaire ou d\'un administrateur. Enregistre-la en brouillon et demande l\'accord ; elle partira une fois l\'accord donné.');
    expect(refus.corps.bouton).toBe('achats.accord.demander');
    expect((await m.surLeServeur('o1'))?.status).toBe('brouillon');

    // La demande : le serveur garde ses propres chiffres ; redemander le même montant ne la double pas.
    const d1 = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord-commande`, comptable.jeton, { commande: commande('o1', 'BCF-2026-002', 'brouillon') });
    expect(d1).toMatchObject({ statut: 200, corps: { statut: 'en_attente', geste: 'commande', responsables: [proprio.nom] } });
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/accord-commande`, comptable.jeton, { commande: commande('o1', 'BCF-2026-002', 'brouillon') })).corps.id).toBe(d1.corps.id);
    const liste = (await appeler('GET', `/entreprises/${ent}/accords`, proprio.jeton)).corps.accords as Record<string, unknown>[];
    expect(liste.find((a) => a.id === d1.corps.id)).toMatchObject({ geste: 'commande', piece: 'o1', client: 's1', montant: 1025750, plafond: 1000000, encours: 0, statut: 'en_attente' });

    // Refusée : la commande ne part toujours pas.
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d1.corps.id)}/decider`, proprio.jeton, { decision: 'refuser', motif: 'Attends la fin du mois' })).corps.statut).toBe('refuse');
    expect((await m.ecrire(comptable.jeton, commande('o1', 'BCF-2026-002', 'envoyée'))).statut).toBe(403);
    // Redemandée, accordée : elle part, et elle se modifie ensuite sans grossir.
    const d2 = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord-commande`, comptable.jeton, { commande: commande('o1', 'BCF-2026-002', 'brouillon') });
    expect(d2.corps.id).not.toBe(d1.corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d2.corps.id)}/decider`, proprio.jeton, { decision: 'accorder' })).corps.statut).toBe('accorde');
    expect((await m.ecrire(comptable.jeton, commande('o1', 'BCF-2026-002', 'envoyée'))).statut).toBe(200);
    expect((await m.ecrire(comptable.jeton, commande('o1', 'BCF-2026-002', 'envoyée', { reference: 'Chantier Ennasr' }))).statut).toBe(200);
    // Grossie d'un sac (1 042,625) : l'accord donné pour 1 025,750 ne la couvre pas.
    const grossie = commande('o1', 'BCF-2026-002', 'envoyée');
    (grossie.lines[0] as Record<string, unknown>).qty = 41;
    const refus2 = await m.ecrire(comptable.jeton, grossie);
    expect(refus2.statut).toBe(403);
    expect(String(refus2.corps.motif).replace(/\s+/g, ' ')).toContain('1 042,625 DT hors taxes');
  });

  it('une commande en devise se compte à son taux ; sous le seuil, rien à demander ; le propriétaire commande sans accord', async () => {
    const m = await magasin();
    const { ent, proprio, comptable } = m;
    await m.regler(proprio.id, { commandeAccordAuDela: 1000 });
    // 300 € à 3,4 = 1 020 DT : au-delà. 290 € à 3,4 = 986 DT : dessous (en dinars, 300 n'aurait rien dépassé).
    const enEuros = (id: string, pu: string) => commande(id, '', 'envoyée', { currency: 'EUR', exchangeRate: { '~n': '3.4' },
      lines: [{ label: 'Adjuvant', description: '', qty: 1, unit: '', unitPrice: { '~n': pu }, vatRate: 19 }] });
    const refus = await m.ecrire(comptable.jeton, enEuros('e1', '300'));
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif).replace(/\s+/g, ' ')).toContain('1 020,000 DT hors taxes');
    expect((await m.ecrire(comptable.jeton, enEuros('e2', '290'))).statut).toBe(200);
    // Une demande sous le seuil n'a pas lieu d'être.
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/accord-commande`, comptable.jeton, { commande: enEuros('e2', '290') })).corps.motif)
      .toBe('Cette commande reste sous le montant permis sans accord : elle part sans accord.');
    // Le propriétaire commande au-delà sans accord.
    expect((await m.ecrire(proprio.jeton, commande('p1', 'BCF-2026-001', 'envoyée'))).statut).toBe(200);
  });
});
