// Tes appareils (brique 74 ; docs/hors-ligne.md, H9 ; 03 § 6, 04 § 7), par l'API. Ce que le serveur
// garantit :
//   - la liste : ses appareils seulement, celui qui demande marqué, un appareil retiré dit ;
//   - retirer un appareil ferme ses sessions ; son jeton, présenté ensuite, reçoit l'ordre d'effacer
//     ce que le poste garde (`effacer`) ; une session simplement fermée, jamais cet ordre.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
beforeAll(async () => { app = creerApp(ctx, routesSocle(ctx)); await app.ready(); });
afterAll(async () => { await app.close(); await pool.end(); });

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
// Une personne, et une session par appareil (sans code : aucun rôle ne l'exige encore).
async function personne() {
  const email = `appareils-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
  const session = async (nom: string) => {
    const r = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom, type: 'navigateur' } });
    return { jeton: String(r.corps.jeton), appareil: String(r.corps.appareil) };
  };
  return { session };
}
type Appareil = { id: string; nom: string; retireLe: string | null; celuiCi: boolean };

describe('tes appareils', () => {
  it('la liste : les siens seulement, celui-ci marqué ; retiré, il le dit, et son jeton reçoit l\'ordre d\'effacer', async () => {
    const nadia = await personne();
    const bureau = await nadia.session('PC du bureau');
    const portable = await nadia.session('Portable perdu');
    const autre = await (await personne()).session('Chez un autre');

    const liste = async (jeton: string) => (await appeler('GET', '/moi/appareils', jeton)).corps.appareils as Appareil[];
    const vus = await liste(bureau.jeton);
    expect(vus.map((a) => [a.nom, a.celuiCi, a.retireLe]).sort()).toEqual([['PC du bureau', true, null], ['Portable perdu', false, null]]);
    expect(vus.some((a) => a.id === autre.appareil)).toBe(false);

    // Retirer le portable : sa session se ferme, et son jeton, présenté ensuite, reçoit l'ordre d'effacer.
    expect((await appeler('DELETE', `/moi/appareils/${portable.appareil}`, bureau.jeton)).statut).toBe(200);
    const retire = await appeler('GET', '/moi', portable.jeton);
    expect(retire).toEqual({ statut: 401, corps: { motif: 'Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé ; reconnecte-toi pour continuer.', bouton: 'connexion', effacer: true } });
    expect((await liste(bureau.jeton)).find((a) => a.id === portable.appareil)?.retireLe).not.toBe(null);

    // Une session simplement fermée : se reconnecter, jamais effacer.
    expect((await appeler('POST', '/deconnexion', bureau.jeton)).statut).toBe(200);
    const fermee = await appeler('GET', '/moi', bureau.jeton);
    expect([fermee.statut, fermee.corps.effacer]).toEqual([401, undefined]);
    // Un jeton inventé non plus.
    expect((await appeler('GET', '/moi', 'jeton-invente')).corps.effacer).toBe(undefined);
  });
});
