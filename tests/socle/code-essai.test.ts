// Le code du téléphone mis en place (brique 145 ; docs/mise-en-ligne.md, D) : la clé rendue seule, la même que dans
// l'adresse du code QR ; et le premier code de l'application essayé avant de quitter l'écran : le bon passe, un faux
// est refusé avec sa raison, et l'essai ne change rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { motif, rendre } from '../../textes/index.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date('2026-10-05T08:00:00Z');
const ctx: Contexte = {
  pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')),
  maintenant: () => horloge, sms: { envoyer: async () => {} },
};
let app: FastifyInstance;
beforeAll(async () => { await admin.connect(); app = creerApp(ctx, routesSocle(ctx)); await app.ready(); });
afterAll(async () => { await app.close(); await pool.end(); await admin.end(); });

const appeler = async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) => {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
    ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
};
let n = 0;
async function personne() {
  const email = `essai-code-${++n}-${Date.now()}@exemple.tn`;
  expect((await appeler('POST', '/inscription', undefined, { email, nom: 'Karim Testeur', motDePasse: 'Un-bon-mot-de-passe' })).statut).toBe(201);
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton) };
}

describe('le code du téléphone, mis en place', () => {
  it('la clé seule est celle de l\'adresse du code QR ; le premier code juste passe, un faux est refusé avec sa raison ; l\'essai ne change rien', async () => {
    const karim = await personne();
    const r = await appeler('POST', '/moi/code', karim.jeton, { methode: 'application' });
    expect(r.statut).toBe(200);
    const cle = String(r.corps.cle);
    expect(cle).toMatch(/^[A-Z2-7]{32}$/);
    expect(new URL(String(r.corps.adresseApplication)).searchParams.get('secret')).toBe(cle);
    const avant = (await admin.query(`select u.code_methode, u.code_secret, (select count(*) from socle.code_secours s where s.utilisateur = u.id) secours
      from socle.utilisateur u where u.email = $1`, [karim.email])).rows[0];

    // Le code d'il y a cinq minutes, puis celui de dans cinq minutes : refusés, avec la raison qui aide.
    const instant = horloge.getTime();
    for (const decalage of [-300_000, 300_000]) {
      const faux = await appeler('POST', '/moi/code/essayer', karim.jeton, { code: codeTotp(depuisBase32(cle), instant + decalage) });
      expect(faux.statut).toBe(403);
      expect(faux.corps.motif).toBe(rendre(motif('compte.code_essai_faux'), 'fr'));
    }
    // Le code du moment, tel que le téléphone l'affiche (avec son espace) : il passe.
    const juste = codeTotp(depuisBase32(cle), instant);
    expect(await appeler('POST', '/moi/code/essayer', karim.jeton, { code: `${juste.slice(0, 3)} ${juste.slice(3)}` })).toEqual({ statut: 200, corps: { bon: true } });
    // Rien n'a changé : la méthode, le secret, les codes de secours.
    expect((await admin.query(`select u.code_methode, u.code_secret, (select count(*) from socle.code_secours s where s.utilisateur = u.id) secours
      from socle.utilisateur u where u.email = $1`, [karim.email])).rows[0]).toEqual(avant);
    horloge = new Date(horloge.getTime() + 60_000);
  });

  it('sans application posée, aucun code ne passe ; le code d\'un autre non plus', async () => {
    const sans = await personne();
    const avec = await personne();
    const cle = String((await appeler('POST', '/moi/code', avec.jeton, { methode: 'application' })).corps.cle);
    const code = codeTotp(depuisBase32(cle), horloge.getTime());
    // Le code de l'application d'un autre ne vaut rien chez qui n'en a pas.
    expect((await appeler('POST', '/moi/code/essayer', sans.jeton, { code })).statut).toBe(403);
    // Chez qui a choisi le SMS non plus (son secret n'existe pas).
    await admin.query(`update socle.utilisateur set code_methode = 'sms', code_secret = $2 where email = $1`, [sans.email, cle]);
    expect((await appeler('POST', '/moi/code/essayer', sans.jeton, { code })).statut).toBe(403);
    // Sans session : la porte.
    expect((await appeler('POST', '/moi/code/essayer', undefined, { code })).statut).toBe(401);
  });
});
