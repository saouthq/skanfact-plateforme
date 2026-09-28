// Les limites d'appels par clé de l'API (14 § 2.5) : une rafale courte passe, un débit soutenu
// au-delà de la recharge reçoit « trop d'appels » (429) avec l'attente ; chaque clé a son seau ; une
// personne connectée à l'écran n'est pas limitée.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { Limiteur, LIMITES_PAR_DEFAUT } from '../../serveur/limites.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

describe('le seau de jetons d\'une clé', () => {
  it('une rafale jusqu\'à la capacité, puis un appel par recharge ; l\'attente est dite en secondes entières', () => {
    let t = 1_000_000;
    const l = new Limiteur({ capacite: 3, parSeconde: 1, maintenant: () => t });
    expect([l.appel('k'), l.appel('k'), l.appel('k')].map((v) => v.restants)).toEqual([2, 1, 0]);
    expect(l.appel('k')).toEqual({ permis: false, restants: 0, attendreSecondes: 1 });
    t += 500;
    expect(l.appel('k').permis).toBe(false);
    t += 500;
    expect(l.appel('k').permis).toBe(true);
    expect(l.appel('k').permis).toBe(false);
  });

  it('un seau ne se remplit jamais au-delà de sa capacité ; une horloge qui recule ne le vide pas ; chaque clé a le sien', () => {
    let t = 0;
    const l = new Limiteur({ capacite: 2, parSeconde: 5, maintenant: () => t });
    // Un appel, puis une heure sans rien : le seau est plein, pas plus (18 000 jetons de recharge).
    l.appel('a');
    t = 3_600_000;
    expect([l.appel('a'), l.appel('a'), l.appel('a')].map((v) => v.permis)).toEqual([true, true, false]);
    expect(l.appel('b').permis).toBe(true);
    t -= 60_000;
    expect(l.appel('b').permis).toBe(true);
    // Recharge lente : 0,2 jeton par seconde, l'attente est de 5 secondes.
    const lent = new Limiteur({ capacite: 1, parSeconde: 0.2, maintenant: () => t });
    lent.appel('c');
    expect(lent.appel('c')).toMatchObject({ permis: false, attendreSecondes: 5 });
    expect(() => new Limiteur({ capacite: 0, parSeconde: 1 })).toThrow();
  });

  it('les chiffres par défaut : 600 appels par minute (10 par seconde), des rafales de 60', () => {
    expect(LIMITES_PAR_DEFAUT).toEqual({ capacite: 60, parSeconde: 10 });
  });
});

describe('les limites d\'appels dans le serveur', () => {
  const pool = creerPool(inject('pgApp'));
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
  let horloge = 5_000_000;
  let app: FastifyInstance;
  const appeler = async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() as Record<string, unknown>, entetes: r.headers };
  };
  let proprio = '';
  let ent = '';

  beforeAll(async () => {
    declarerGestesVentes();
    app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)], { limiteur: new Limiteur({ capacite: 2, parSeconde: 1, maintenant: () => horloge }) });
    await app.ready();
    await appeler('POST', '/inscription', undefined, { email: 'limites@exemple.tn', nom: 'Limites', motDePasse: 'Un-bon-mot-de-passe' });
    proprio = String((await appeler('POST', '/connexion', undefined, { email: 'limites@exemple.tn', motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    ent = String((await appeler('POST', '/entreprises', proprio, { raisonSociale: 'Atelier des limites' })).corps.id);
    await appeler('POST', '/moi/code', proprio, { methode: 'application' });
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  const cle = async () => String((await appeler('POST', `/entreprises/${ent}/cles-api`, proprio,
    { nom: 'Boutique', gestes: ['ventes.pieces.voir'], expireLe: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) })).corps.cle);

  it('au-delà de sa rafale, une clé reçoit 429, l\'attente, et une phrase lisible ; la seconde d\'après, elle repasse', async () => {
    const k = await cle();
    const a = await appeler('GET', `/entreprises/${ent}/clients`, k);
    expect(a.statut).toBe(200);
    expect([a.entetes['ratelimit-limit'], a.entetes['ratelimit-remaining']]).toEqual(['2', '1']);
    expect((await appeler('GET', `/entreprises/${ent}/clients`, k)).statut).toBe(200);
    const refus = await appeler('GET', `/entreprises/${ent}/clients`, k);
    expect(refus.statut).toBe(429);
    expect(refus.entetes['retry-after']).toBe('1');
    expect(refus.corps).toEqual({ motif: 'Trop d\'appels avec cette clé : réessaie dans une seconde.', attendreSecondes: 1 });
    // Une autre clé a son propre seau ; la personne connectée à l'écran n'est pas limitée.
    const autre = await cle();
    expect((await appeler('GET', `/entreprises/${ent}/clients`, autre)).statut).toBe(200);
    for (let i = 0; i < 5; i++) expect((await appeler('GET', `/entreprises/${ent}/clients`, proprio)).statut).toBe(200);
    horloge += 1000;
    expect((await appeler('GET', `/entreprises/${ent}/clients`, k)).statut).toBe(200);
  });
});
