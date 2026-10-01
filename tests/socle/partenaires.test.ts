// « Connecter ma boutique » (brique 133 ; docs/boutique.md, B0). Ce que le serveur garantit :
//   - seul un partenaire déclaré, vers une adresse de retour déclarée, reçoit quelque chose ;
//   - seuls le propriétaire et l'administrateur autorisent ; la clé créée a les gestes du partenaire, et vaut dix
//     minutes tant qu'elle n'est pas échangée ;
//   - l'échange demande le secret du partenaire et le code, une seule fois, avant son expiration, pour CE partenaire ;
//     il porte la clé à un an et ne remet que la liste décidée (clé, entreprise, nom, gestes, fin) ;
//   - une clé révoquée avant l'échange ne revit pas ; le code n'est pas une clé.

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI } from '../../serveur/coffre.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { lirePartenaires, routesPartenaires } from '../../serveur/partenaires.ts';
import { ConfigurationFausse, lireConfiguration } from '../../serveur/principal.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const sha256 = (x: string) => createHash('sha256').update(x, 'utf8').digest('hex');
const SECRET = 'le-secret-de-skanecom-pour-les-tests';
const RETOUR = 'https://boutique.exemple.tn/skanfact/retour';
const partenaires = lirePartenaires(JSON.stringify([
  { code: 'skanecom', nom: 'SkanEcom', retours: [RETOUR], empreinteSecret: sha256(SECRET), gestes: ['ventes.pieces.voir', 'ventes.boutique.facturer'] },
  { code: 'autre', nom: 'Autre service', retours: ['https://autre.exemple.tn/retour'], empreinteSecret: sha256('autre-secret'), gestes: ['ventes.pieces.voir'] },
]));
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
  partenaires: { liste: partenaires, cle: CLE_DU_COFFRE_D_ESSAI } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
const personne = async (nom: string) => {
  const email = `partenaire-${nom}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  return { email, jeton };
};
const codeDe = (adresse: string) => new URL(adresse).searchParams.get('code') ?? '';

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesPartenaires(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('connecter une boutique (un partenaire déclaré)', () => {
  it('autoriser, échanger le code une fois contre la clé ; rien pour un inconnu, un faux secret, un code usé, expiré ou révoqué', async () => {
    const yasmine = await personne('yasmine');
    const ent = String((await appeler('POST', '/entreprises', yasmine.jeton, { raisonSociale: 'Yasmine Bijoux' })).corps.id);

    // Ce que la page montre : qui demande, et pour faire quoi. Un inconnu, une autre adresse de retour : rien.
    const info = await appeler('GET', `/partenaires/skanecom?retour=${encodeURIComponent(`${RETOUR}?boutique=12`)}`);
    expect(info).toEqual({ statut: 200, corps: { code: 'skanecom', nom: 'SkanEcom', gestes: [
      { code: 'ventes.pieces.voir', libelle: expect.any(String) }, { code: 'ventes.boutique.facturer', libelle: expect.any(String) }] } });
    expect((await appeler('GET', '/partenaires/pirate?retour=x')).statut).toBe(404);
    expect(await appeler('GET', `/partenaires/skanecom?retour=${encodeURIComponent('https://pirate.exemple.tn/vol')}`))
      .toMatchObject({ statut: 400, corps: { motif: 'L\'adresse de retour n\'est pas celle que SkanEcom a déclarée : par prudence, rien n\'est autorisé.' } });
    expect((await appeler('GET', `/partenaires/skanecom?retour=${encodeURIComponent(`${RETOUR}#x`)}`)).statut).toBe(400);
    // Une ancre après les paramètres : le code partirait dans l'ancre, que le navigateur garde pour lui.
    expect((await appeler('GET', `/partenaires/skanecom?retour=${encodeURIComponent(`${RETOUR}?a=1#x`)}`)).statut).toBe(400);
    expect((await appeler('GET', `/partenaires/skanecom?retour=${encodeURIComponent(`${RETOUR}/plus`)}`)).statut).toBe(400);

    // « Autoriser » : l'adresse de retour avec le code et l'état ; une clé de dix minutes, aux gestes du partenaire.
    const autoriser = (jeton: string, corps: { retour: string; etat: string }, partenaire = 'skanecom') =>
      appeler('POST', `/entreprises/${ent}/partenaires/${partenaire}/autoriser`, jeton, corps);
    expect((await autoriser(yasmine.jeton, { retour: 'https://pirate.exemple.tn/vol', etat: 'e' })).statut).toBe(400);
    expect((await autoriser(yasmine.jeton, { retour: RETOUR, etat: 'e' }, 'pirate')).statut).toBe(404);
    const a = await autoriser(yasmine.jeton, { retour: `${RETOUR}?boutique=12`, etat: 'etat-77' });
    expect(a.statut).toBe(201);
    const adresse = new URL(String(a.corps.adresse));
    expect(`${adresse.origin}${adresse.pathname}`).toBe(RETOUR);
    expect([...adresse.searchParams.keys()]).toEqual(['boutique', 'code', 'etat']);
    expect(adresse.searchParams.get('etat')).toBe('etat-77');
    const code = codeDe(String(a.corps.adresse));
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cles = async () => (await admin.query(`select id, nom, gestes, extract(epoch from expire_le - cree_le)::int duree, revoquee_le from socle.cle_api where entreprise = $1 order by cree_le, id`, [ent])).rows;
    expect(await cles()).toEqual([{ id: expect.any(String), nom: 'SkanEcom (connexion)', gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'], duree: expect.any(Number), revoquee_le: null }]);
    expect((await cles())[0].duree).toBeLessThanOrEqual(600);
    expect((await cles())[0].duree).toBeGreaterThan(590);
    // Le code n'est pas une clé.
    expect((await appeler('GET', `/entreprises/${ent}/commandes-en-ligne/SK-1`, code)).statut).toBe(401);

    // L'échange : le secret du partenaire, puis le code, une seule fois, pour CE partenaire.
    const echanger = (secret: string | null, c: string, partenaire = 'skanecom') => app.inject({ method: 'POST', url: `${VERSION}/partenaires/${partenaire}/echanger`,
      headers: secret === null ? {} : { authorization: `Bearer ${secret}` }, payload: { code: c } }).then((r) => ({ statut: r.statusCode, corps: r.json() as Record<string, unknown> }));
    expect(await echanger(null, code)).toMatchObject({ statut: 401, corps: { motif: 'Le secret du partenaire est faux.' } });
    expect((await echanger('mauvais-secret', code)).statut).toBe(401);
    expect(await echanger('autre-secret', code, 'autre')).toMatchObject({ statut: 400, corps: { motif: 'Ce code ne vaut rien : il a déjà servi, il a expiré (il vaut dix minutes), ou il n\'a pas été donné à ce partenaire.' } });
    const e = await echanger(SECRET, code);
    expect(e).toEqual({ statut: 200, corps: { cle: expect.stringMatching(/^skf_[A-Za-z0-9_-]{43}$/), entreprise: ent, nom: 'Yasmine Bijoux',
      gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'], expireLe: expect.any(String) } });
    // La clé ne se lit pas dans le code : seul le serveur la calcule.
    expect(String(e.corps.cle)).not.toContain(code);
    const jours = (Date.parse(String(e.corps.expireLe)) - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(364.9);
    expect(jours).toBeLessThan(365.1);
    expect((await cles())[0].duree).toBeGreaterThan(364 * 86_400);
    // La clé remise marche : une commande de la boutique se facture.
    const commande = await appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, String(e.corps.cle), { reference: 'SK-1', date: '2026-10-01',
      client: { nom: 'Amel Ben Salah', email: 'amel@exemple.tn' }, timbre: true, lignes: [{ designation: 'Bague', quantite: '1', prixUnitaireTTC: '8.000', tauxTva: '19' }] });
    expect(commande).toMatchObject({ statut: 201, corps: { facture: { netAPayer: '9.000' } } });
    // Une seule fois.
    expect((await echanger(SECRET, code)).statut).toBe(400);

    // Un code expiré : rien, et sa clé reste à dix minutes.
    const b = codeDe(String((await autoriser(yasmine.jeton, { retour: RETOUR, etat: 'b' })).corps.adresse));
    await admin.query(`update socle.autorisation_partenaire set cree_le = now() - interval '20 minutes', expire_le = now() - interval '1 second' where code_empreinte = $1`, [sha256(b)]);
    expect((await echanger(SECRET, b)).statut).toBe(400);
    expect((await cles())[1].duree).toBeLessThanOrEqual(600);
    // Une clé révoquée avant l'échange : rien, et elle ne revit pas.
    const c = codeDe(String((await autoriser(yasmine.jeton, { retour: RETOUR, etat: 'c' })).corps.adresse));
    const idC = String((await cles())[2].id);
    expect((await appeler('DELETE', `/entreprises/${ent}/cles-api/${idC}`, yasmine.jeton)).statut).toBe(200);
    expect((await echanger(SECRET, c)).statut).toBe(400);
    expect((await cles())[2].duree).toBeLessThanOrEqual(600);

    // La trace : l'autorisation (par qui) et l'échange (par le partenaire).
    const trace = (await admin.query(`select geste, utilisateur is not null par_quelqu_un, apres->>'partenaire' partenaire from socle.audit
      where entreprise = $1 and geste like 'socle.partenaire.%' order by instant, geste`, [ent])).rows;
    expect(trace.slice(0, 2)).toEqual([{ geste: 'socle.partenaire.autoriser', par_quelqu_un: true, partenaire: 'skanecom' }, { geste: 'socle.partenaire.echanger', par_quelqu_un: false, partenaire: 'skanecom' }]);

    // Un commercial n'autorise rien : seuls le propriétaire et l'administrateur gèrent les clés.
    const karim = await personne('karim');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, yasmine.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', karim.jeton, { jeton: inv })).statut).toBe(200);
    expect((await autoriser(karim.jeton, { retour: RETOUR, etat: 'k' })).statut).toBe(403);
    expect((await cles())).toHaveLength(3);
    // La base elle-même : seul le propriétaire (ou l'administrateur) autorise, et seulement pour une clé qu'il vient de
    // créer dans CETTE entreprise.
    const idDe = async (jeton: string) => String((await appeler('GET', '/moi', jeton)).corps.id);
    const autoriserEnBase = (qui: string, entreprise: string, cle: string) => enTantQue(pool, qui, (tx) =>
      tx.query('select socle.autoriser_partenaire($1, $2, $3, $4, now() + interval \'10 minutes\')', [entreprise, 'skanecom', cle, sha256(`${qui}${cle}${entreprise}`)]));
    const cleA = String((await cles())[0].id);
    await expect(autoriserEnBase(await idDe(karim.jeton), ent, cleA)).rejects.toThrow(/ton rôle ne permet pas/);
    const autre = String((await appeler('POST', '/entreprises', yasmine.jeton, { raisonSociale: 'Autre boutique' })).corps.id);
    await expect(autoriserEnBase(await idDe(yasmine.jeton), autre, cleA)).rejects.toThrow(/clé introuvable/);
  });

  it('la liste des partenaires se lit de l\'environnement, et une liste fausse arrête le serveur', () => {
    expect(lirePartenaires(undefined)).toEqual([]);
    expect(() => lirePartenaires(JSON.stringify([{ code: 'x1', nom: 'X', retours: ['http://non-chiffre.exemple.tn/r'], empreinteSecret: sha256('s'), gestes: ['ventes.pieces.voir'] }]))).toThrow();
    expect(() => lirePartenaires(JSON.stringify([{ code: 'x1', nom: 'X', retours: ['https://x.exemple.tn/r?a=1'], empreinteSecret: sha256('s'), gestes: ['ventes.pieces.voir'] }]))).toThrow();
    expect(() => lirePartenaires(JSON.stringify([{ code: 'x1', nom: 'X', retours: ['https://x.exemple.tn/r'], empreinteSecret: 's', gestes: ['ventes.pieces.voir'] }]))).toThrow();
    expect(() => lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_PARTENAIRES: '[{' })).toThrow(ConfigurationFausse);
    expect(lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_PARTENAIRES: JSON.stringify([{ code: 'skanecom', nom: 'SkanEcom', retours: [RETOUR],
      empreinteSecret: sha256(SECRET), gestes: ['ventes.pieces.voir'] }]) }).partenaires).toHaveLength(1);
  });
});
