// La présence sur une pièce (serveur/v10/presence.ts) : qui d'autre a la même pièce ouverte, s'il y écrit, depuis
// quand ; jamais soi-même, jamais une autre entreprise, oublié 45 s après le dernier signe ou dès qu'on quitte.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { DUREE_PRESENCE, noterPresence } from '../../serveur/v10/presence.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

describe('la présence, en mémoire', () => {
  it('rend les autres de la même pièce, du plus ancien au plus récent, puis les oublie', () => {
    const t = 1_000_000;
    expect(noterPresence('e1', 'p1', 'sarra', 'Sarra Mansour', true, false, t)).toEqual([]);
    expect(noterPresence('e1', 'p1', 'karim', 'Karim Haddad', false, false, t + 5_000)).toEqual([{ nom: 'Sarra Mansour', ecrit: true, depuis: t }]);
    // Sarra revient : son « depuis » ne bouge pas, son « écrit » suit le dernier signe.
    expect(noterPresence('e1', 'p1', 'sarra', 'Sarra Mansour', false, false, t + 20_000)).toEqual([{ nom: 'Karim Haddad', ecrit: false, depuis: t + 5_000 }]);
    // Une autre pièce, une autre entreprise : personne.
    expect(noterPresence('e1', 'p2', 'leila', 'Leïla', false, false, t + 21_000)).toEqual([]);
    expect(noterPresence('e2', 'p1', 'leila', 'Leïla', false, false, t + 21_000)).toEqual([]);
    // Karim se tait plus de 45 s : Sarra ne le voit plus.
    expect(noterPresence('e1', 'p1', 'sarra', 'Sarra Mansour', false, false, t + 5_000 + DUREE_PRESENCE + 1)).toEqual([]);
    // Quitter retire tout de suite.
    noterPresence('e1', 'p3', 'karim', 'Karim Haddad', false, false, t);
    noterPresence('e1', 'p3', 'karim', 'Karim Haddad', false, true, t + 1);
    expect(noterPresence('e1', 'p3', 'sarra', 'Sarra Mansour', false, false, t + 2)).toEqual([]);
  });
});

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
const appeler = async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) => {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
};
let n = 0;
async function personne(nom: string) {
  const email = `presence-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}

describe('la présence, par le serveur', () => {
  beforeAll(async () => { declarerGestesVentes(); app = await creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx)]); });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('dit le nom de l\'autre personne de l\'entreprise, pas celui d\'une inconnue', async () => {
    const sarra = await personne('Sarra Mansour');
    const ent = String((await appeler('POST', '/entreprises', sarra.jeton, { raisonSociale: 'Atelier Numérique Sfax' })).corps.id);
    await appeler('POST', '/moi/code', sarra.jeton, { methode: 'application' });
    const karim = await personne('Karim Haddad');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, sarra.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', karim.jeton, { jeton: inv });
    const voir = (jeton: string, q: string) => appeler('GET', `/entreprises/${ent}/presence?${q}`, jeton);

    expect((await voir(sarra.jeton, 'piece=fac1&ecrit=1')).corps.autres).toEqual([]);
    const k = await voir(karim.jeton, 'piece=fac1');
    expect(k.statut).toBe(200);
    expect((k.corps.autres as { nom: string; ecrit: boolean }[]).map((x) => [x.nom, x.ecrit])).toEqual([['Sarra Mansour', true]]);
    expect(((await voir(sarra.jeton, 'piece=fac1')).corps.autres as { nom: string }[]).map((x) => x.nom)).toEqual(['Karim Haddad']);
    // Une identité de pièce qui n'en est pas une est refusée ; une inconnue n'entre pas dans l'entreprise.
    expect((await voir(sarra.jeton, 'piece=../x')).statut).toBe(400);
    const inconnue = await personne('Inconnue');
    expect((await voir(inconnue.jeton, 'piece=fac1')).statut).toBeGreaterThanOrEqual(403);
  });
});
