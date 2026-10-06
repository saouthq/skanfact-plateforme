// Le mot de passe oublié (lot entrée, 06/10/2026 ; migration 0075, docs/entree.md). Sans relais d'e-mails, rien ne se
// propose ni ne part. Avec lui : une demande répond la même chose qu'un compte existe ou non ; le lien part à l'adresse
// du compte, sans rien d'autre que lui ; il sert une fois, 30 minutes ; il ferme les sessions ouvertes ; et pour un
// compte protégé par le code du téléphone, le lien seul ne suffit pas.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { motif, rendre } from '../../textes/index.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date('2026-10-06T08:00:00Z');
const partis: Courriel[] = [];
const base = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), maintenant: () => horloge, sms: { envoyer: async () => {} } };
const ctx: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => { partis.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
const sansCourriel: Contexte = { ...base };
let app: FastifyInstance;
let appSans: FastifyInstance;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, routesSocle(ctx)); await app.ready();
  appSans = creerApp(sansCourriel, routesSocle(sansCourriel)); await appSans.ready();
});
afterAll(async () => { await app.close(); await appSans.close(); await pool.end(); await admin.end(); });

const appeler = async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown, a = app) => {
  const r = await a.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
    ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
};
const dire = (cle: string) => rendre(motif(cle), 'fr');
let n = 0;
async function personne(nom = 'Karim Testeur') {
  const email = `oubli-${++n}-${Date.now()}@exemple.tn`;
  expect((await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' })).statut).toBe(201);
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton) };
}
const connexion = (email: string, motDePasse: string) => appeler('POST', '/connexion', undefined, { email, motDePasse, appareil: { nom: 'Poste', type: 'navigateur' } });
// Le jeton du dernier e-mail parti pour cette adresse.
function lienPour(email: string) {
  const m = partis.filter((c) => c.a === email).at(-1);
  const jeton = m ? /\?reinitialiser=([A-Za-z0-9_-]+)/.exec(m.texte)?.[1] : undefined;
  if (!jeton) throw new Error(`aucun lien n'est parti pour ${email}`);
  return jeton;
}

describe('le mot de passe oublié', () => {
  it('sans relais d\'e-mails, l\'entrée ne le propose pas, et la demande se refuse en le disant', async () => {
    expect(await appeler('GET', '/connexion/options', undefined, undefined, appSans)).toEqual({ statut: 200, corps: { motDePasseOublie: false } });
    const r = await appeler('POST', '/mot-de-passe/oubli', undefined, { email: 'qui@exemple.tn' }, appSans);
    expect(r.statut).toBe(403);
    expect(r.corps.motif).toBe(dire('connexion.oubli_indisponible'));
    expect(await appeler('GET', '/connexion/options')).toEqual({ statut: 200, corps: { motDePasseOublie: true } });
  });

  it('la même réponse qu\'un compte existe ou non ; le lien part à l\'adresse du compte, avec lui seul ; trois demandes par heure au plus', async () => {
    const karim = await personne('Karim Ben Salah');
    const avant = partis.length;
    const inconnue = await appeler('POST', '/mot-de-passe/oubli', undefined, { email: `personne-${Date.now()}@exemple.tn` });
    const connue = await appeler('POST', '/mot-de-passe/oubli', undefined, { email: `  ${karim.email.toUpperCase()} ` });
    expect(inconnue).toEqual({ statut: 202, corps: { ok: true } });
    expect(connue).toEqual(inconnue);
    expect(partis.length).toBe(avant + 1);
    const m = partis.at(-1);
    expect(m?.a).toBe(karim.email);
    expect(m?.objet).toBe('Ton nouveau mot de passe SkanFact');
    expect(m?.texte).toContain(`https://app.exemple.tn/?reinitialiser=${lienPour(karim.email)}`);
    // Ce qui part chez le relais : l'adresse et le lien, jamais le nom de la personne.
    expect(m?.texte).not.toMatch(/Karim|Salah/);
    // Le jeton n'est gardé qu'en empreinte.
    expect((await admin.query('select count(*)::int n from socle.reinitialisation where jeton_empreinte = $1', [lienPour(karim.email)])).rows[0].n).toBe(0);
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: karim.email });
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: karim.email });
    expect(partis.length).toBe(avant + 3);
    expect(await appeler('POST', '/mot-de-passe/oubli', undefined, { email: karim.email })).toEqual({ statut: 202, corps: { ok: true } });
    expect(partis.length).toBe(avant + 3);
  });

  it('sans code du téléphone : le lien choisit un nouveau mot de passe (la règle des mots de passe tient), une fois, 30 minutes ; les sessions ouvertes se ferment', async () => {
    const sami = await personne();
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: sami.email });
    const jeton = lienPour(sami.email);
    expect(await appeler('POST', '/mot-de-passe/lien', undefined, { jeton })).toEqual({ statut: 200, corps: { valable: true, code: false } });
    const court = await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton, motDePasse: 'court' });
    expect(court.statut).toBe(400);
    expect(court.corps.champ).toBe('motDePasse');
    expect(await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton, motDePasse: 'Une-autre-phrase-sure' })).toEqual({ statut: 200, corps: { ok: true } });
    // L'ancienne session est fermée ; l'ancien mot de passe ne passe plus, le nouveau oui.
    expect((await appeler('GET', '/moi', sami.jeton)).statut).toBe(401);
    expect((await connexion(sami.email, 'Un-bon-mot-de-passe')).statut).toBe(401);
    expect((await connexion(sami.email, 'Une-autre-phrase-sure')).corps.etat).toBe('connecte');
    // Le lien a servi.
    const encore = await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton, motDePasse: 'Encore-une-phrase-sure' });
    expect(encore).toEqual({ statut: 400, corps: { motif: dire('connexion.oubli_lien_perime'), champ: 'jeton' } });
    // Un lien de plus de 30 minutes ne vaut plus rien.
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: sami.email });
    const vieux = lienPour(sami.email);
    horloge = new Date(horloge.getTime() + 31 * 60_000);
    expect(await appeler('POST', '/mot-de-passe/lien', undefined, { jeton: vieux })).toEqual({ statut: 200, corps: { valable: false, code: false } });
    expect((await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: vieux, motDePasse: 'Encore-une-phrase-sure' })).corps.champ).toBe('jeton');
  });

  it('avec le code du téléphone, le lien seul ne suffit pas : il faut le code, ou un code de secours (une fois) ; cinq codes faux, et le lien ne vaut plus rien', async () => {
    horloge = new Date(horloge.getTime() + 2 * 3_600_000);
    const leila = await personne();
    const pose = await appeler('POST', '/moi/code', leila.jeton, { methode: 'application' });
    const cle = String(pose.corps.cle);
    const secours = (pose.corps.codesDeSecours as string[])[0] ?? '';

    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: leila.email });
    const premier = lienPour(leila.email);
    expect(await appeler('POST', '/mot-de-passe/lien', undefined, { jeton: premier })).toEqual({ statut: 200, corps: { valable: true, code: true } });
    expect(await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: premier, motDePasse: 'Une-autre-phrase-sure' }))
      .toEqual({ statut: 400, corps: { motif: dire('connexion.oubli_code_manque'), champ: 'code' } });
    const faux = codeTotp(depuisBase32(cle), horloge.getTime() - 600_000);
    for (let i = 0; i < 5; i++) {
      expect(await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: premier, motDePasse: 'Une-autre-phrase-sure', code: faux }))
        .toEqual({ statut: 400, corps: { motif: dire('connexion.code_faux'), champ: 'code' } });
    }
    const juste = codeTotp(depuisBase32(cle), horloge.getTime());
    expect((await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: premier, motDePasse: 'Une-autre-phrase-sure', code: juste })).corps.champ).toBe('jeton');
    expect((await connexion(leila.email, 'Une-autre-phrase-sure')).statut).toBe(401);

    // Un nouveau lien et le code du moment : le mot de passe change.
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: leila.email });
    expect(await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: lienPour(leila.email), motDePasse: 'Une-autre-phrase-sure', code: juste }))
      .toEqual({ statut: 200, corps: { ok: true } });
    expect((await connexion(leila.email, 'Une-autre-phrase-sure')).corps.etat).toBe('code');

    // Le téléphone perdu : un code de secours remplace le code, une seule fois.
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: leila.email });
    expect(await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: lienPour(leila.email), motDePasse: 'Troisieme-phrase-sure', code: secours.toLowerCase() }))
      .toEqual({ statut: 200, corps: { ok: true } });
    horloge = new Date(horloge.getTime() + 2 * 3_600_000);
    await appeler('POST', '/mot-de-passe/oubli', undefined, { email: leila.email });
    expect((await appeler('POST', '/mot-de-passe/nouveau', undefined, { jeton: lienPour(leila.email), motDePasse: 'Quatrieme-phrase-sure', code: secours })).corps)
      .toEqual({ motif: dire('connexion.code_faux'), champ: 'code' });
  });
});
