// Les adresses internet de l'entrée (0143 ; docs/console.md C67 ; l'audit 1.42.0 § 4) :
//   - l'entrée compte, par adresse et par heure, ce qu'elle refuse (un mot de passe faux) et ce qu'elle freine ; rien
//     d'autre de la demande ; la machine elle-même ne se compte pas ;
//   - bloquer ferme l'entrée seule à une adresse, une heure ou un jour : la personne déjà connectée depuis elle continue,
//     une autre adresse passe ; la phrase dit jusqu'à quand ; débloquer la rouvre ; chaque geste a son motif, au journal ;
//   - une adresse seule, jamais la machine ni une plage ; la direction et la technique, jamais le support.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { Adresses, ADRESSES_AU_PLUS } from '../../serveur/adresses.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue, type Transaction } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { lireAdresses } from '../../serveur/console/adresses.ts';
import { quiEstConsole } from '../../serveur/console/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { Limiteur } from '../../serveur/limites.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const adresses = new Adresses();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge, adresses };
let app: FastifyInstance;
// Des adresses de documentation (RFC 5737), propres à cet essai.
const ATTAQUE = `203.0.113.${10 + Math.floor(Math.random() * 200)}`;
const VOISINE = '198.51.100.77';

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown, depuis = '127.0.0.1'): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, remoteAddress: depuis, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `adresses-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton), nom: `${prenom} ${n}` };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { ...p, console: String(c.corps.jeton) };
}
const connexion = (email: string, motDePasse: string, depuis: string) =>
  appeler('POST', '/connexion', undefined, { email, motDePasse, appareil: { nom: 'Poste', type: 'navigateur' } }, depuis);
// La base revérifie elle-même ce que la route refuse : dans la vraie session de la console de la personne.
async function dansLaConsole<T>(jeton: string, faire: (tx: Transaction) => Promise<T>): Promise<T> {
  const qc = await quiEstConsole(ctx, jeton);
  if (!qc) throw new Error('session de la console attendue');
  return enTantQue(pool, qc.utilisateur, async (tx) => {
    await tx.query('select set_config(\'app.session_console\', $1, true)', [qc.session]);
    return faire(tx);
  });
}

let direction: Awaited<ReturnType<typeof membre>>, technique: Awaited<ReturnType<typeof membre>>, support: Awaited<ReturnType<typeof membre>>;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  technique = await membre('technique', 'technique');
  support = await membre('support', 'support');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les adresses internet de l\'entrée (0143)', () => {
  it('l\'entrée compte ce qu\'elle refuse, par adresse ; bloquer ferme l\'entrée seule, une autre adresse passe, une session continue', async () => {
    const cible = await personne('cible');
    // Connectée depuis l'adresse avant le blocage : elle continuera.
    const avant = await connexion(cible.email, MDP, ATTAQUE);
    expect(avant.statut).toBe(200);
    for (let i = 0; i < 3; i++) expect((await connexion(cible.email, `faux-${i}`, ATTAQUE)).statut).toBe(401);
    // La machine elle-même ne se compte pas.
    expect((await connexion(cible.email, 'faux-machine', '127.0.0.1')).statut).toBe(401);
    await adresses.passer(pool, horloge);
    const vue = (await admin.query('select echecs, freins from plateforme.adresse_vue where adresse = $1 and heure = date_trunc(\'hour\', $2::timestamptz)', [ATTAQUE, horloge])).rows;
    expect(vue).toEqual([{ echecs: 3, freins: 0 }]);
    expect((await admin.query('select count(*)::int n from plateforme.adresse_vue where adresse = \'127.0.0.1\'')).rows[0].n).toBe(0);
    // Ce que la table garde : l'adresse, l'heure, deux nombres ; ni le compte visé, ni ce qui a été tapé.
    expect(Object.keys((await admin.query('select * from plateforme.adresse_vue limit 1')).rows[0] ?? {}).sort()).toEqual(['adresse', 'echecs', 'freins', 'heure']);

    // La console la montre (la direction et la technique).
    const lu = lireAdresses((await appeler('GET', '/console/service/securite', technique.console)).corps.adresses);
    expect(lu.vues.find((v) => v.adresse === ATTAQUE)).toMatchObject({ echecs: 3, freins: 0, bloquee: null });

    // Bloquer : une heure, avec son motif. Le support, non.
    expect((await appeler('POST', '/console/service/securite/adresses', support.console, { adresse: ATTAQUE, heures: 1, motif: 'des mots de passe faux' })).statut).toBe(403);
    await expect(dansLaConsole(support.console, (tx) => tx.query('select plateforme.console_bloquer_adresse($1, 1, $2, $3)', [ATTAQUE, 'des mots de passe faux', horloge])))
      .rejects.toThrow(/ne permet pas ce geste/);
    const b =await appeler('POST', '/console/service/securite/adresses', direction.console, { adresse: ATTAQUE, heures: 1, motif: 'des mots de passe faux en rafale' });
    expect(b.statut, JSON.stringify(b.corps)).toBe(201);
    // L'entrée lui est fermée, tout de suite (le serveur a relu la liste après le geste) ; la phrase dit jusqu'à quand.
    const fermee = await connexion(cible.email, MDP, ATTAQUE);
    expect(fermee.statut).toBe(403);
    expect(String(fermee.corps.motif)).toMatch(/^L'entrée est fermée depuis ta connexion jusqu'au \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2} \(heure de Tunis\)\./);
    expect((await appeler('POST', '/inscription', undefined, { email: `adresses-nouveau${++n}@exemple.tn`, nom: 'Nouveau', motDePasse: MDP }, ATTAQUE)).statut).toBe(403);
    // Une autre adresse passe ; la session ouverte depuis l'adresse bloquée continue.
    expect((await connexion(cible.email, MDP, VOISINE)).statut).toBe(200);
    expect((await appeler('GET', '/moi', String(avant.corps.jeton), undefined, ATTAQUE)).statut).toBe(200);
    // Déjà bloquée : on la débloque d'abord.
    expect((await appeler('POST', '/console/service/securite/adresses', technique.console, { adresse: ATTAQUE, heures: 24, motif: 'plus longtemps' })).corps.motif)
      .toBe('Cette adresse est déjà bloquée : débloque-la d\'abord pour changer sa durée.');
    const s = lireAdresses((await appeler('GET', '/console/service/securite', direction.console)).corps.adresses);
    const blocage = s.bloquees.find((x) => x.adresse === ATTAQUE);
    expect(blocage).toMatchObject({ motif: 'des mots de passe faux en rafale', par: direction.nom });
    expect(Date.parse(blocage?.jusquAu ?? '') - horloge.getTime()).toBe(3_600_000);
    expect(s.vues.find((v) => v.adresse === ATTAQUE)?.bloquee?.id).toBe(blocage?.id);

    // Débloquer la rouvre ; deux fois, non.
    expect((await appeler('POST', `/console/service/securite/adresses/${blocage?.id ?? ''}/debloquer`, technique.console, { motif: 'le client a appelé' })).statut).toBe(200);
    expect((await connexion(cible.email, MDP, ATTAQUE)).statut).toBe(200);
    expect((await appeler('POST', `/console/service/securite/adresses/${blocage?.id ?? ''}/debloquer`, technique.console, { motif: 'encore' })).corps.motif)
      .toBe('Cette adresse n\'est plus bloquée.');
    const fini = lireAdresses((await appeler('GET', '/console/service/securite', direction.console)).corps.adresses).finies.find((f) => f.adresse === ATTAQUE);
    expect(fini).toMatchObject({ levee: true });
    // Chaque geste au journal, avec son motif.
    const gestes = (await admin.query(`select geste, motif from plateforme.geste_console where geste in ('service.adresse_bloquee', 'service.adresse_debloquee')
      and coalesce(apres->>'adresse', avant->>'adresse') = $1 order by le`, [ATTAQUE])).rows;
    expect(gestes).toEqual([{ geste: 'service.adresse_bloquee', motif: 'des mots de passe faux en rafale' }, { geste: 'service.adresse_debloquee', motif: 'le client a appelé' }]);
  });

  it('une adresse seule, jamais la machine ni une plage ; une heure ou un jour ; une personne ne note rien', async () => {
    const bloquer = (adresse: string, heures: number) => appeler('POST', '/console/service/securite/adresses', direction.console, { adresse, heures, motif: 'un essai de forme' });
    expect((await bloquer('127.0.0.1', 1)).corps.motif).toBe('C\'est l\'adresse de la machine elle-même : elle ne se bloque pas.');
    expect((await bloquer('::1', 1)).corps.motif).toBe('C\'est l\'adresse de la machine elle-même : elle ne se bloque pas.');
    expect((await bloquer('10.0.0.0/8', 1)).corps.motif).toBe('Une adresse seule se bloque, jamais une plage d\'adresses.');
    expect((await bloquer('pas-une-adresse', 1)).corps.motif).toMatch(/^Ce n'est pas une adresse internet/);
    expect((await bloquer('203.0.113.250', 2)).statut).toBe(400);
    // La base refuse aussi ce que la route laisserait passer : ni deux heures, ni une semaine.
    for (const h of [2, 168]) {
      await expect(dansLaConsole(direction.console, (tx) => tx.query('select plateforme.console_bloquer_adresse($1, $2, $3, $4)', ['203.0.113.250', h, 'un essai de forme', horloge])))
        .rejects.toThrow(/une heure ou un jour/);
    }
    const v6 = await bloquer('2001:db8::1234', 24);
    expect(v6.statut, JSON.stringify(v6.corps)).toBe(201);
    expect(Date.parse(String(v6.corps.jusquAu)) - horloge.getTime()).toBe(86_400_000);
    await appeler('POST', `/console/service/securite/adresses/${String(v6.corps.id)}/debloquer`, direction.console, { motif: 'fin de l\'essai' });
    // Une personne connectée ne note pas d'adresses et ne lit pas la liste du serveur.
    const cible = await personne('curieux');
    const qui = await quiEst(ctx, cible.jeton);
    await expect(enTantQue(pool, qui?.utilisateur ?? null, (tx) => tx.query('select plateforme.noter_adresses($1::jsonb, now())', [JSON.stringify({ '203.0.113.1': [1, 0] })])))
      .rejects.toThrow(/seul le serveur compte et applique les adresses/);
    await expect(enTantQue(pool, qui?.utilisateur ?? null, (tx) => tx.query('select * from plateforme.adresses_bloquees(now())'))).rejects.toThrow(/seul le serveur/);
  });

  it('ce que l\'entrée freine se compte aussi ; une clé qui n\'est pas une adresse n\'entre pas', async () => {
    const freinee = '203.0.113.5';
    const local = new Adresses();
    const ctxLocal: Contexte = { ...ctx, adresses: local };
    const app2 = creerApp(ctxLocal, routesSocle(ctxLocal), { limiteurPublic: new Limiteur({ capacite: 2, parSeconde: 0.001 }) });
    await app2.ready();
    const statuts: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuts.push((await app2.inject({ method: 'GET', url: `${VERSION}/connexion/options`, remoteAddress: freinee })).statusCode);
    }
    expect(statuts).toEqual([200, 200, 429, 429]);
    local.noter('pas-une-adresse', 'echec');
    const r = await local.passer(pool, horloge);
    expect(r.adresses).toBe(1);
    expect((await admin.query('select freins from plateforme.adresse_vue where adresse = $1 and heure = date_trunc(\'hour\', $2::timestamptz)', [freinee, horloge])).rows[0]?.freins).toBeGreaterThanOrEqual(2);
    await app2.close();
  });

  it('une attaque venue de partout n\'emplit pas la mémoire : au-delà de dix mille adresses, le reste se perd et se dit', () => {
    const a = new Adresses();
    for (let i = 0; i <= ADRESSES_AU_PLUS; i++) a.noter(`10.${Math.floor(i / 65_536)}.${Math.floor(i / 256) % 256}.${i % 256}`, 'echec');
    expect(a.perdues).toBe(1);
  });

  it('ce que la console lit : rien qui n\'ait sa forme', () => {
    expect(lireAdresses(null)).toEqual({ vues: [], bloquees: [], finies: [] });
    expect(lireAdresses({ vues: [{ adresse: '203.0.113.1', echecs: 2, freins: -1, derniere: 'hier', bloquee: { id: 'x', jusquAu: 'pas une date' } }, { echecs: 3 }] }).vues)
      .toEqual([{ adresse: '203.0.113.1', echecs: 2, freins: 0, derniere: null, bloquee: null }]);
  });
});
