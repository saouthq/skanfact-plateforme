// Le Z relu (brique 126 ; docs/caisse.md, Z1 à Z3). Ce que le serveur garantit :
//   - le Z dit qui a fermé la caisse, et quand ;
//   - les Z passés se lisent, les plus récents d'abord, par pages de 20 ; un curseur illisible repart du début ;
//   - le propriétaire et l'administrateur lisent tous les Z ; un autre membre, ceux des sessions qu'il a ouvertes, aucun
//     autre.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
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
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `z-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('le Z relu', () => {
  it('le Z dit qui l\'a fermé ; les Z se lisent par pages, tous pour la propriétaire, les siens pour un caissier', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const sami = await personne('Sami', 'Caisse du comptoir');
    const leila = await personne('Leila', 'Téléphone de Leila');
    for (const qui of [sami, leila]) {
      const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: qui.email, roles: ['caissier'] })).corps.jeton);
      expect((await appeler('POST', '/invitations/accepter', qui.jeton, { jeton: inv })).statut).toBe(200);
    }
    const lire = async (jeton: string, avant?: string) => (await appeler('GET', `/entreprises/${ent}/caisse/z${avant ? `?avant=${encodeURIComponent(avant)}` : ''}`, jeton)).corps as
      { z: { fermePar: string; fermeeLe: string; ouvertePar: string; fond: string; compte: string }[]; suite: string | null };

    // 21 sessions de Sami : il ferme les 20 premières ; Nadia ferme la dernière, de son bureau. Le fond dit leur rang.
    for (let i = 1; i <= 21; i++) {
      expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: String(i) })).statut).toBe(200);
      const fermee = await appeler('POST', `/entreprises/${ent}/caisse/fermer`, i < 21 ? sami.jeton : nadia.jeton, { compte: String(i) });
      expect((fermee.corps.z as { fermePar: string }).fermePar).toBe(i < 21 ? 'Sami' : 'Nadia');
      expect(Date.parse(String((fermee.corps.z as { fermeeLe: string }).fermeeLe))).toBeGreaterThan(Date.now() - 60_000);
    }

    // Nadia : les 20 plus récents d'abord (le 21e, fermé par elle), puis le dernier, et la fin.
    const p1 = await lire(nadia.jeton);
    expect(p1.z.map((z) => z.fond)).toEqual(Array.from({ length: 20 }, (_, k) => `${21 - k}.000`));
    expect(p1.z[0]).toMatchObject({ ouvertePar: 'Sami', fermePar: 'Nadia', compte: '21.000' });
    expect(p1.z[1]).toMatchObject({ fermePar: 'Sami' });
    expect(p1.suite).not.toBeNull();
    const p2 = await lire(nadia.jeton, p1.suite ?? '');
    expect(p2.z.map((z) => z.fond)).toEqual(['1.000']);
    expect(p2.suite).toBeNull();
    // Un curseur illisible repart du début.
    expect((await lire(nadia.jeton, 'hier')).z.map((z) => z.fond)).toEqual(p1.z.map((z) => z.fond));

    // Sami : les sessions qu'il a ouvertes (toutes) ; Leila, qui n'en a ouvert aucune : rien.
    expect((await lire(sami.jeton)).z).toHaveLength(20);
    expect(await lire(leila.jeton)).toEqual({ z: [], suite: null });
  });
});
