// Les avis d'événement (14 § 2.5) : un abonnement ne se montre qu'une fois ; une facture émise est
// annoncée, dans la transaction de son émission ; l'avis est signé ; un échec se renvoie à
// intervalles croissants puis s'abandonne ; un abonnement arrêté n'envoie plus rien ; le livreur
// n'atteint jamais une adresse privée ; une clé de l'API ne gère pas les abonnements.

import { createHmac } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adressePrivee, envoyerHttps, livrerAvis, signer, type Envoi } from '../../serveur/avis.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

describe('la signature et les adresses', () => {
  it('la signature est le HMAC-SHA256 de « t.corps » avec le secret (vecteur calculé par openssl)', () => {
    expect(signer('whsec_essai', 1_790_000_000, '{"a":1}')).toBe('t=1790000000,v1=a76ee7959eec3c315ae98ef184da2c450b6c2101f59955cd30f8272167a0cf2e');
  });

  it('une adresse privée, locale ou réservée n\'est jamais atteinte', async () => {
    for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'pas-une-ip']) {
      expect(adressePrivee(ip), ip).toBe(true);
    }
    for (const ip of ['41.226.1.1', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) expect(adressePrivee(ip), ip).toBe(false);
    const envoi = (url: string) => envoyerHttps({ url, entetes: {}, corps: '{}' });
    await expect(envoi('http://exemple.tn/avis')).rejects.toThrow('https_requis');
    await expect(envoi('https://127.0.0.1/avis')).rejects.toThrow('adresse_privee');
    await expect(envoi('https://[::1]/avis')).rejects.toThrow('adresse_privee');
  });
});

describe('les avis d\'événement', () => {
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const pool = creerPool(inject('pgApp'));
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
  let app: FastifyInstance;
  const appeler = async (methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown) => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
  };
  let n = 0;
  const personne = async (prenom: string) => {
    const email = `avis-${prenom}${++n}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
    return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  const entreprise = async (proprio: string, nom: string) => {
    const ent = String((await appeler('POST', '/entreprises', proprio, { raisonSociale: nom })).corps.id);
    await appeler('POST', '/moi/code', proprio, { methode: 'application' });
    await admin.query(`insert into socle.serie (entreprise, type, prefixe, legale) values ($1, 'facture', 'FAC', true)`, [ent]);
    const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio, { raisonSociale: `Client de ${nom}` })).corps.id);
    return { ent, client };
  };
  const facture = async (jeton: string, e: { ent: string; client: string }) => {
    const id = String((await appeler('POST', `/entreprises/${e.ent}/ventes`, jeton, { type: 'facture', tiers: e.client, datePiece: '2026-10-01',
      lignes: [{ designation: 'Porte', quantite: '2', prixUnitaire: '100.125', tauxTva: '19' }] })).corps.id);
    return { id, emise: await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, jeton) };
  };
  // Un destinataire d'essai : il note chaque envoi et répond ce qu'on lui dit.
  const recus: Envoi[] = [];
  let reponse: number | Error = 200;
  const destinataire = async (e: Envoi) => { recus.push(e); if (reponse instanceof Error) throw reponse; return { statut: reponse }; };
  const aLivrer = async () => Number((await admin.query('select count(*) n from socle.avis where livre_le is null and abandonne_le is null')).rows[0].n);

  let proprio: { jeton: string };
  let voisin: { jeton: string };
  let A: { ent: string; client: string };
  let B: { ent: string; client: string };
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    declarerGestesVentes();
    app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
    await app.ready();
    proprio = await personne('proprio');
    A = await entreprise(proprio.jeton, 'Menuiserie des avis');
    voisin = await personne('voisin');
    B = await entreprise(voisin.jeton, 'La voisine');
  });
  afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

  it('une facture émise est annoncée, signée, avec l\'argent en texte ; la voisine n\'en sait rien ; le secret ne se relit jamais', async () => {
    const ab = await appeler('POST', `/entreprises/${A.ent}/avis-abonnements`, proprio.jeton, { url: 'https://boutique.exemple.tn/avis', evenements: ['facture.emise'] });
    expect(ab.statut).toBe(201);
    const secret = String(ab.corps.secret);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const liste = await appeler('GET', `/entreprises/${A.ent}/avis-abonnements`, proprio.jeton);
    expect(JSON.stringify(liste.corps)).not.toContain(secret);
    await expect(pool.query('select secret from socle.abonnement_avis')).rejects.toThrow(/permission denied/);
    // Une émission qui échoue n'annonce rien ; une facture émise est annoncée une fois.
    const avant = await aLivrer();
    await admin.query(`update socle.serie set active = false where entreprise = $1`, [A.ent]);
    expect((await facture(proprio.jeton, A)).emise.statut).toBe(403);
    expect(await aLivrer()).toBe(avant);
    await admin.query(`update socle.serie set active = true where entreprise = $1`, [A.ent]);
    const f = await facture(proprio.jeton, A);
    expect(f.emise.statut).toBe(200);
    // La voisine émet aussi : ce n'est pas l'affaire de l'abonnement de A.
    expect((await facture(voisin.jeton, B)).emise.statut).toBe(200);
    expect(await aLivrer()).toBe(avant + 1);

    recus.length = 0;
    reponse = 200;
    // Un instant à venir, jamais une date écrite en dur : un avis posé « maintenant » ne serait plus dû le lendemain
    // de cette date (défaut trouvé le 01/10/2026 à 10 h 30).
    const t = new Date(Date.now() + 60_000);
    expect(await livrerAvis(pool, destinataire, t)).toEqual({ livres: 1, echecs: 0 });
    const e = recus[0] as Envoi;
    expect(e.url).toBe('https://boutique.exemple.tn/avis');
    expect(e.entetes['skanfact-evenement']).toBe('facture.emise');
    const h = Math.floor(t.getTime() / 1000);
    expect(e.entetes['skanfact-signature']).toBe(`t=${h},v1=${createHmac('sha256', secret).update(`${h}.${e.corps}`).digest('hex')}`);
    const corps = JSON.parse(e.corps) as { id: string; evenement: string; entreprise: string; donnees: Record<string, unknown> };
    expect(corps).toMatchObject({ id: e.entetes['skanfact-avis'], evenement: 'facture.emise', entreprise: A.ent });
    // 2 × 100,125 = 200,250 HT ; TVA 38,048 ; timbre 1,000 : 239,298.
    expect(corps.donnees).toMatchObject({ id: f.id, numero: f.emise.corps.numero, devise: 'TND', totalHT: '200.250', totalTVA: '38.048', totalTTC: '239.298', netAPayer: '239.298' });
    expect(await livrerAvis(pool, destinataire, t)).toEqual({ livres: 0, echecs: 0 });
    const historique = (await appeler('GET', `/entreprises/${A.ent}/avis`, proprio.jeton)).corps.avis as Record<string, unknown>[];
    expect(historique[0]).toMatchObject({ evenement: 'facture.emise', essais: 1, dernier_statut: 200, derniere_erreur: null });
    expect(historique[0]?.livre_le).not.toBeNull();
  });

  it('un échec se renvoie à 1 min, 5 min, 30 min… et, après le 8e, l\'avis est abandonné ; deux livreurs ne l\'envoient pas deux fois', async () => {
    await facture(proprio.jeton, A);
    reponse = 500;
    recus.length = 0;
    let t = new Date(Date.now() + 86_400_000);
    const plus = (ms: number) => new Date(t.getTime() + ms);
    expect(await livrerAvis(pool, destinataire, t)).toEqual({ livres: 0, echecs: 1 });
    const ligne = async () => (await admin.query(`select essais, prochain_essai, abandonne_le, dernier_statut, derniere_erreur from socle.avis
      where livre_le is null order by cree_le desc limit 1`)).rows[0];
    expect(await ligne()).toMatchObject({ essais: 1, prochain_essai: plus(60_000), dernier_statut: 500, derniere_erreur: 'reponse_500' });
    // Trente secondes plus tard, rien n'est dû ; à la minute, il repart.
    expect(await livrerAvis(pool, destinataire, plus(30_000))).toEqual({ livres: 0, echecs: 0 });
    t = plus(60_000);
    reponse = new Error('ECONNREFUSED');
    expect(await livrerAvis(pool, destinataire, t)).toEqual({ livres: 0, echecs: 1 });
    expect(await ligne()).toMatchObject({ essais: 2, prochain_essai: plus(300_000), dernier_statut: null, derniere_erreur: 'ECONNREFUSED' });
    // Deux livreurs au même instant : le premier réserve, le second ne trouve rien.
    t = plus(300_000);
    const [premier, second] = [(await pool.query('select id from socle.avis_a_livrer($1, 10)', [t])).rows, (await pool.query('select id from socle.avis_a_livrer($1, 10)', [t])).rows];
    expect([premier.length, second.length]).toEqual([1, 0]);
    // Les essais suivants, chacun au délai que la base a noté, jusqu'à l'abandon au 8e.
    await admin.query(`update socle.avis set prochain_essai = $1 where livre_le is null and abandonne_le is null`, [t]);
    reponse = 503;
    const delais: number[] = [];
    for (let k = 0; k < 5; k++) {
      expect((await livrerAvis(pool, destinataire, t)).echecs).toBe(1);
      const prochain = (await ligne()).prochain_essai as Date;
      delais.push(prochain.getTime() - t.getTime());
      t = prochain;
    }
    expect(delais).toEqual([30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000]);
    expect((await livrerAvis(pool, destinataire, t)).echecs).toBe(1);
    expect(await ligne()).toMatchObject({ essais: 8, dernier_statut: 503 });
    expect((await ligne()).abandonne_le).not.toBeNull();
    expect(await livrerAvis(pool, destinataire, plus(365 * 86_400_000))).toEqual({ livres: 0, echecs: 0 });
  });

  it('un abonnement arrêté n\'envoie plus rien, même ce qui attendait ; une clé de l\'API et un commercial ne gèrent pas les abonnements ; une adresse http est refusée', async () => {
    const abonnements = (await appeler('GET', `/entreprises/${A.ent}/avis-abonnements`, proprio.jeton)).corps.abonnements as { id: string }[];
    await facture(proprio.jeton, A);
    expect(await aLivrer()).toBe(1);
    for (const a of abonnements) expect((await appeler('DELETE', `/entreprises/${A.ent}/avis-abonnements/${a.id}`, proprio.jeton)).statut).toBe(200);
    expect(await aLivrer()).toBe(0);
    expect((await admin.query(`select derniere_erreur from socle.avis order by cree_le desc limit 1`)).rows[0].derniere_erreur).toBe('abonnement_arrete');
    await facture(proprio.jeton, A);
    expect(await aLivrer()).toBe(0);
    expect((await appeler('DELETE', `/entreprises/${A.ent}/avis-abonnements/${abonnements[0]?.id}`, proprio.jeton)).corps.motif).toBe('Cet abonnement est déjà arrêté.');

    const cle = String((await appeler('POST', `/entreprises/${A.ent}/cles-api`, proprio.jeton,
      { nom: 'Boutique', gestes: ['ventes.pieces.voir'], expireLe: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) })).corps.cle);
    expect((await appeler('POST', `/entreprises/${A.ent}/avis-abonnements`, cle, { url: 'https://x.exemple.tn/', evenements: ['facture.emise'] })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${A.ent}/cles-api`, proprio.jeton,
      { nom: 'Avis', gestes: ['socle.avis.gerer'], expireLe: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) })).statut).toBe(403);
    const commercial = await personne('commercial');
    await admin.query(`insert into socle.membre (entreprise, utilisateur, roles, actif) select $1, id, array['commercial'], true from socle.utilisateur where email = $2`, [A.ent, commercial.email]);
    expect((await appeler('POST', `/entreprises/${A.ent}/avis-abonnements`, commercial.jeton, { url: 'https://x.exemple.tn/', evenements: ['facture.emise'] })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${A.ent}/avis-abonnements`, proprio.jeton, { url: 'http://x.exemple.tn/', evenements: ['facture.emise'] })).statut).toBe(400);
    expect((await appeler('POST', `/entreprises/${A.ent}/avis-abonnements`, proprio.jeton, { url: 'https://x.exemple.tn/', evenements: ['facture.inventee'] })).statut).toBe(400);
  });
});
