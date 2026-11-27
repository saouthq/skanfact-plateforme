// (1.388.95, 03 § 2.1) « Celui qui compte n'est pas celui qui valide l'écart » : le magasinier enregistre son inventaire
// EN ATTENTE ; il ne peut ni l'écrire validé, ni valider ou effacer un écart déjà dans le stock. Le propriétaire, un
// administrateur ou la comptabilité interne (qui lit le stock sans l'écrire) le valide ou le refuse, par un geste du serveur.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

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
  const email = `droits-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toISOString().slice(0, 10);

// Une entreprise avec un peu de tout, et une personne par rôle.
async function entreprise() {
  const proprio = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const membres: Record<string, { jeton: string }> = {};
  for (const role of ['magasinier', 'comptabilite_interne', 'commercial']) {
    const p = await personne(role);
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv });
    // La paie demande le code du téléphone.
    if (role === 'paie') await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    membres[role] = p;
  }
  const lire = async (jeton: string, depuis = '') => (await appeler('GET', `/entreprises/${ent}/dossier-v10${depuis}`, jeton)).corps as { objets: Objet[]; droits: { cachees: string[]; lectureSeule: string[]; ecrivables: string[]; tout: boolean; responsable: boolean }; marque: string; profil: string; partiel?: boolean };
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  await lire(proprio.jeton);
  expect((await envoyer(proprio.jeton, [
    { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 21 } },
    { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', cin: '01234567' } },
    { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
    { collection: '_racine', cle: 'payrollSettings', rang: null, revision: null, contenu: { smig: 528 } },
    { collection: '_racine', cle: 'counters', rang: null, revision: null, contenu: {} },
  ])).statut).toBe(200);
  return { ent, proprio, membres, lire, envoyer };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('(1.388.95) un inventaire compté par le magasinier attend sa validation', () => {
  it('le magasinier l\'enregistre en attente, pas validé ; la comptabilité interne le valide ; un écart validé ne se touche plus', async () => {
    const e = await entreprise();
    const mag = e.membres.magasinier?.jeton ?? '', ci = e.membres.comptabilite_interne?.jeton ?? '', com = e.membres.commercial?.jeton ?? '';
    const ecart = (id: string, inv: string, attend: boolean) => ({ id, itemId: 'ciment', qty: -3, date: aujourdhui, source: 'inventaire', inventaireId: inv,
      valeurInventaire: -63, ...(attend ? { aValider: true } : {}) });
    expect((await e.lire(mag)).droits).toMatchObject({ validerInventaire: false });
    expect((await e.lire(ci)).droits).toMatchObject({ validerInventaire: true });
    // Validé d'office par le magasinier : refusé, rien n'est écrit.
    const r1 = await e.envoyer(mag, [{ collection: 'stockAdjustments', cle: 'a1', rang: 0, revision: null, contenu: ecart('a1', 'inv1', false) }]);
    expect(r1.statut).toBe(403);
    expect(String(r1.corps.motif)).toMatch(/validé par le propriétaire, un administrateur ou la comptabilité interne/);
    // En attente : accepté.
    expect((await e.envoyer(mag, [{ collection: 'stockAdjustments', cle: 'a1', rang: 0, revision: null, contenu: ecart('a1', 'inv1', true) }])).statut).toBe(200);
    // Il ne se valide pas lui-même, ni par le dossier ni par le geste.
    expect((await e.envoyer(mag, [{ collection: 'stockAdjustments', cle: 'a1', rang: 0, revision: 1, contenu: ecart('a1', 'inv1', false) }])).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/inventaires/inv1/decision`, mag, { decision: 'valider' })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/inventaires/inv1/decision`, com, { decision: 'valider' })).statut).toBe(403);
    // La comptabilité interne valide : l'écart entre dans le stock, avec qui l'a validé.
    const v = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/inventaires/inv1/decision`, ci, { decision: 'valider' });
    expect(v.statut, JSON.stringify(v.corps)).toBe(200);
    expect(v.corps.ecarts).toBe(1);
    const lu = (await e.lire(e.proprio.jeton)).objets.find((o) => o.collection === 'stockAdjustments' && o.cle === 'a1');
    expect(lu?.contenu.aValider).toBeUndefined();
    expect(lu?.contenu.validePar).toBeTruthy();
    // Une seconde décision n'a plus rien à décider ; le magasinier n'efface pas un écart validé.
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/inventaires/inv1/decision`, ci, { decision: 'refuser' })).statut).toBe(403);
    expect((await e.envoyer(mag, [{ collection: 'stockAdjustments', cle: 'a1', rang: 0, revision: lu?.revision ?? 2, contenu: null }])).statut).toBe(403);
    // Refuser efface ce qui attendait ; le propriétaire, lui, enregistre son inventaire validé.
    expect((await e.envoyer(mag, [{ collection: 'stockAdjustments', cle: 'a2', rang: 1, revision: null, contenu: ecart('a2', 'inv2', true) }])).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/inventaires/inv2/decision`, e.proprio.jeton, { decision: 'refuser' })).statut).toBe(200);
    expect((await e.lire(e.proprio.jeton)).objets.some((o) => o.collection === 'stockAdjustments' && o.cle === 'a2')).toBe(false);
    expect((await e.envoyer(e.proprio.jeton, [{ collection: 'stockAdjustments', cle: 'a3', rang: 2, revision: null, contenu: ecart('a3', 'inv3', false) }])).statut).toBe(200);
  });
});
