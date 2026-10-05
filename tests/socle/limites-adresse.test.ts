// La limite d'appels par adresse sur les routes sans session (brique 142) : une rafale passe, puis un appel par
// seconde ; chaque adresse a son seau ; derrière le frontal déclaré, l'adresse vraie est celle qu'il a vue, et sans
// frontal déclaré, personne ne choisit son adresse en l'écrivant dans un en-tête ; la machine elle-même n'est pas
// limitée.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { Limiteur, LIMITES_PAR_ADRESSE } from '../../serveur/limites.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { ConfigurationFausse, demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
afterAll(async () => { await pool.end(); });

describe('la limite par adresse', () => {
  let horloge = 7_000_000;
  const appli = async (proxy?: number): Promise<FastifyInstance> => {
    declarerGestesVentes();
    const app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)],
      { limiteurPublic: new Limiteur({ capacite: 3, parSeconde: 1, maintenant: () => horloge }), ...(proxy ? { proxy } : {}) });
    await app.ready();
    return app;
  };
  // L'ouverture d'un espace client avec un lien inventé (404) : une route publique, comme la connexion.
  const espace = (app: FastifyInstance, adresse: string, entetes: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: `${VERSION}/espace`, remoteAddress: adresse, headers: entetes, payload: { jeton: 'un-lien-invente-de-trente-caracteres' } });

  it('une rafale passe, puis « trop d\'appels » avec l\'attente ; la seconde d\'après, un appel repasse ; chaque adresse a son seau', async () => {
    const app = await appli();
    try {
      for (let i = 0; i < 3; i++) expect((await espace(app, '41.230.1.1')).statusCode).toBe(404);
      const r = await espace(app, '41.230.1.1');
      expect(r.statusCode).toBe(429);
      expect(r.headers['retry-after']).toBe('1');
      expect(r.json()).toEqual({ motif: 'Trop de demandes depuis ta connexion : réessaie dans une seconde.', attendreSecondes: 1 });
      // Une autre adresse n'en souffre pas.
      expect((await espace(app, '41.230.2.2')).statusCode).toBe(404);
      // La connexion aussi est comptée.
      expect((await app.inject({ method: 'POST', url: `${VERSION}/connexion`, remoteAddress: '41.230.1.1',
        payload: { email: 'personne@exemple.tn', motDePasse: 'x', appareil: { nom: 'Poste', type: 'navigateur' } } })).statusCode).toBe(429);
      // Plus loin dans la rafale, l'attente se dit en secondes.
      const lent = new Limiteur({ capacite: 1, parSeconde: 0.25, maintenant: () => horloge });
      const app2 = creerApp(ctx, routesVentes(ctx), { limiteurPublic: lent });
      try {
        await espace(app2, '41.230.9.9');
        expect((await espace(app2, '41.230.9.9')).json()).toEqual({ motif: 'Trop de demandes depuis ta connexion : réessaie dans 4 secondes.', attendreSecondes: 4 });
      } finally { await app2.close(); }
      horloge += 1000;
      expect((await espace(app, '41.230.1.1')).statusCode).toBe(404);
      expect((await espace(app, '41.230.1.1')).statusCode).toBe(429);
    } finally { await app.close(); }
  });

  it('sans frontal déclaré, l\'adresse écrite dans un en-tête ne compte pas ; derrière le frontal, c\'est celle qu\'il a vue', async () => {
    horloge += 60_000;
    const direct = await appli();
    try {
      for (let i = 0; i < 3; i++) await espace(direct, '41.230.3.3', { 'x-forwarded-for': `10.0.0.${i}` });
      expect((await espace(direct, '41.230.3.3', { 'x-forwarded-for': '10.0.0.99' })).statusCode).toBe(429);
    } finally { await direct.close(); }
    // Derrière un frontal (son adresse : 10.1.1.1), deux clients différents ont chacun leur seau…
    const derriere = await appli(1);
    try {
      for (let i = 0; i < 3; i++) expect((await espace(derriere, '10.1.1.1', { 'x-forwarded-for': '41.230.4.4' })).statusCode).toBe(404);
      expect((await espace(derriere, '10.1.1.1', { 'x-forwarded-for': '41.230.4.4' })).statusCode).toBe(429);
      expect((await espace(derriere, '10.1.1.1', { 'x-forwarded-for': '41.230.5.5' })).statusCode).toBe(404);
      // … et un client qui écrit une fausse adresse devant la sienne ne change pas de seau (le frontal ajoute la vraie).
      expect((await espace(derriere, '10.1.1.1', { 'x-forwarded-for': '8.8.8.8, 41.230.4.4' })).statusCode).toBe(429);
    } finally { await derriere.close(); }
  });

  it('la machine elle-même (ses outils, ses tests) n\'est pas limitée', async () => {
    const app = await appli();
    try {
      for (const adresse of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        for (let i = 0; i < 5; i++) expect((await espace(app, adresse)).statusCode).toBe(404);
      }
    } finally { await app.close(); }
  });

  it('les chiffres : 60 appels d\'un coup, puis un par seconde ; le nombre de relais se règle, de 0 à 5', () => {
    expect(LIMITES_PAR_ADRESSE).toEqual({ capacite: 60, parSeconde: 1 });
    const env = { SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test' };
    expect(lireConfiguration(env).proxy).toBe(0);
    expect(lireConfiguration({ ...env, SKANFACT_PROXY: '1' }).proxy).toBe(1);
    for (const faux of ['un', '-1', '6', '1.5']) expect(() => lireConfiguration({ ...env, SKANFACT_PROXY: faux })).toThrow(ConfigurationFausse);
    // En production, il se dit toujours (même 0) : oublié derrière le frontal, chaque visiteur aurait l'adresse de la
    // machine, que la limite ne compte pas.
    const production = { SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'production', SKANFACT_COFFRE: Buffer.alloc(32, 7).toString('base64') };
    expect(() => lireConfiguration(production)).toThrow(/SKANFACT_PROXY manque/);
    expect(() => lireConfiguration({ ...production, SKANFACT_PROXY: '0' })).toThrow(/fournisseur de SMS/);
  });

  it('le programme serveur, derrière un frontal déclaré : 60 demandes d\'un visiteur passent, la suivante attend ; un autre visiteur passe', async () => {
    const s = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_PROXY: '1' }), port: 0, livreurMs: 60_000 });
    try {
      // Le frontal (ici, la machine elle-même) ajoute l'adresse du visiteur.
      const espace = (visiteur: string) => fetch(`${s.adresse}/v1/espace`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': visiteur },
        body: JSON.stringify({ jeton: 'un-lien-invente-de-trente-caracteres' }) }).then((r) => r.status);
      const statuts: number[] = [];
      for (let i = 0; i < 61; i++) statuts.push(await espace('41.230.8.8'));
      expect(statuts.slice(0, 60).every((x) => x === 404)).toBe(true);
      expect(statuts[60]).toBe(429);
      expect(await espace('41.230.9.9')).toBe(404);
    } finally { await s.arreter(); }
  }, 60_000);
});
