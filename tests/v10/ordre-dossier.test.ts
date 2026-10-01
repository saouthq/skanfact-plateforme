// L'ordre du dossier lu (01/10/2026 ; serveur/v10/dossier.ts, lireDossier). Une liste vide reste à la racine
// (`_racine/accounts` = [], écrite par un écran quand la liste était vide) ; le serveur ajoute ensuite un objet à la
// liste (le compte Konnect). La base des tests range comme une base « en_US » (la ponctuation ignorée : « _racine »
// après « accounts ») ; le serveur rend pourtant la racine d'abord, puis les listes : un écran qui assemble dans
// l'ordre reçu ne recouvre jamais les objets d'une liste par sa liste vide.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
beforeAll(async () => { app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx)]); await app.ready(); });
afterAll(async () => { await app.close(); await pool.end(); });

describe('l\'ordre du dossier lu', () => {
  it('la racine d\'abord, puis les listes, quelle que soit la langue de la base', async () => {
    const email = `ordre-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'accounts', rang: null, revision: null, contenu: [] },
      { collection: '_racine', cle: 'catalog', rang: null, revision: null, contenu: [] },
    ] })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k1', rang: 0, revision: null, contenu: { id: 'k1', name: 'Konnect', kind: 'autre', opening: 0 } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 25, vatRate: 19 } },
    ] })).statut).toBe(200);
    const objets = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string }[];
    const dernierRacine = objets.map((o) => o.collection).lastIndexOf('_racine');
    const premierObjet = objets.findIndex((o) => o.collection !== '_racine');
    expect(dernierRacine).toBeLessThan(premierObjet);
    expect(objets.filter((o) => o.collection !== '_racine').map((o) => `${o.collection}/${o.cle}`)).toEqual(['accounts/k1', 'catalog/ciment']);
  });
});
