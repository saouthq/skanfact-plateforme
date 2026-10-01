// Supprimer un brouillon : les siens (brique 117 ; 03 § 1 ; docs/droits-dossier.md). Karim et Lina, commerciaux,
// préparent chacun un devis :
//   - Lina ne supprime pas celui de Karim (le refus nomme l'auteur, rien n'est supprimé) ; Karim supprime le sien ;
//   - Nadia, propriétaire, supprime celui de Lina ;
//   - l'écran apprend, à la lecture du dossier, quelles pièces un autre a faites (rien pour un responsable) ;
//   - une pièce d'avant la règle (sans auteur connu) ne se supprime que par un responsable ;
//   - la base refuse aussi, même en écrivant par-dessus les routes.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

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
  const email = `auteur-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const devis = (id: string, numero = '') => ({ id, type: 'devis', number: numero, status: 'brouillon', date: '2026-10-01', clientId: 'c1', createdAt: 1,
  lines: [{ label: 'Table en chêne', qty: 2, unit: 'u', unitPrice: { '~n': '450.5' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('supprimer un brouillon : les siens', () => {
  it('un commercial ne supprime que ses brouillons ; la propriétaire, tous ; une pièce sans auteur connu, un responsable seulement', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Meubles Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const commercial = async (prenom: string) => {
      const p = await personne(prenom);
      const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: p.email, roles: ['commercial'] })).corps.jeton);
      expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv })).statut).toBe(200);
      return p;
    };
    const karim = await commercial('Karim');
    const lina = await commercial('Lina');
    const lire = async (jeton = nadia.jeton) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps;
    const objet = async (cle: string) => ((await lire()).objets as Objet[]).find((o) => o.cle === cle);
    const ecrire = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const supprimer = async (jeton: string, cle: string) => ecrire(jeton, [{ collection: 'documents', cle, rang: null, revision: (await objet(cle))?.revision ?? null, contenu: null }]);
    expect((await ecrire(nadia.jeton, [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima' } }])).statut).toBe(200);
    expect((await ecrire(karim.jeton, [{ collection: 'documents', cle: 'dk', rang: 0, revision: null, contenu: devis('dk') }, { collection: 'documents', cle: 'dk2', rang: 1, revision: null, contenu: devis('dk2') }])).statut).toBe(200);
    expect((await ecrire(lina.jeton, [{ collection: 'documents', cle: 'dl', rang: 2, revision: null, contenu: devis('dl') }])).statut).toBe(200);

    // L'écran de Lina apprend que dk et dk2 sont de Karim (pas dl, le sien) ; celui de Nadia, rien.
    expect((await lire(lina.jeton)).autrui).toEqual({ 'documents/dk': 'Karim', 'documents/dk2': 'Karim' });
    expect((await lire(nadia.jeton)).autrui).toEqual({});

    // Lina ne supprime pas le devis de Karim : le refus le nomme, et rien n'est supprimé.
    const refus = await supprimer(lina.jeton, 'dk');
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toBe('Ce brouillon a été fait par Karim : seul son auteur, le propriétaire ou un administrateur le supprime. Rien n\'a été supprimé.');
    expect(await objet('dk')).toBeDefined();
    // Karim supprime le sien ; Nadia supprime celui de Lina.
    expect((await supprimer(karim.jeton, 'dk')).statut).toBe(200);
    expect(await objet('dk')).toBeUndefined();
    expect((await supprimer(nadia.jeton, 'dl')).statut).toBe(200);
    expect(await objet('dl')).toBeUndefined();

    // Une pièce d'avant la règle (sans auteur connu) : ni Karim ni Lina, la propriétaire seulement.
    await admin.query(`update socle.dossier_v10 set cree_par = null where entreprise = $1 and cle = 'dk2'`, [ent]);
    expect((await supprimer(karim.jeton, 'dk2')).corps.motif)
      .toBe('Ce brouillon date d\'avant que SkanFact retienne qui fait chaque pièce : seul le propriétaire ou un administrateur le supprime. Rien n\'a été supprimé.');

    // La base refuse aussi, même en écrivant par-dessus les routes.
    expect((await ecrire(karim.jeton, [{ collection: 'documents', cle: 'dk3', rang: 3, revision: null, contenu: devis('dk3') }])).statut).toBe(200);
    await expect(enTantQue(pool, lina.id, (tx) => tx.query(`delete from socle.dossier_v10 where entreprise = $1 and cle = 'dk3'`, [ent])))
      .rejects.toMatchObject({ code: '42501', message: 'Un brouillon se supprime par son auteur, le propriétaire ou un administrateur.' });
    expect((await supprimer(nadia.jeton, 'dk2')).statut).toBe(200);
  });
});
