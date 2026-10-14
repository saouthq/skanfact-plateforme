// Ce que l'offre compte (14c, deuxième partie ; docs/abonnement.md « 14c » ; 0099), par l'API. Ce que le serveur garantit :
//   - un module acheté SEUL sur Essentiel (la paie, la comptabilité complète) est un geste de la direction, avec son motif
//     et son histoire ; il s'ouvre aussitôt dans l'application du client, et se retire ; Complet le contient déjà ;
//   - la facture d'une période compte, le jour où elle se prépare, ce qui dépasse l'offre (les salariés au-delà de dix
//     avec la paie achetée, les caisses, les établissements) et chaque module acheté, au prix du jour de sa ligne ; jamais
//     les utilisateurs, sans limite dans toutes les offres (Skander, 14/10/2026 ; 0102) ; l'aperçu le dit avant le geste,
//     la pièce l'écrit, la base le rejoue ;
//   - ce que l'offre compte se lit AVANT (0100, 0102) par qui gère l'abonnement : ce que l'entreprise utilise, ce que
//     l'offre comprend — le même chiffre que la facture.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

// La preuve d'un paiement reçu hors de la plateforme (0113), telle que la console la tape.
const RECU_CONSOLE = { facture: 'F-2020-001', montant: '390', moyen: 'virement', le: '2020-01-01' };

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'offre-compte-')), 'veille.json');
const jour = aujourdhuiATunis();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
const adresse = (qui: string) => `offre-compte-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
async function inscrire(qui: string) {
  const email = adresse(qui);
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
// La direction : sa session de l'application (propriétaire de l'entreprise SkanFact) et de la console.
async function direction() {
  const { email, jeton: appli } = await inscrire('amira');
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, 'direction', 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), utilisateur: qui.utilisateur };
}
// Un membre de plus dans l'entreprise, par l'invitation acceptée.
async function membre(ent: string, jetonProprio: string, roles: string[]) {
  const p = await inscrire('membre');
  const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, jetonProprio, { email: p.email, roles })).corps.jeton);
  expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv })).statut).toBe(200);
  return p;
}
let amira: Awaited<ReturnType<typeof direction>>;
const ligneDe = async (ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, amira.console)).corps.ligne;
const geste = (ent: string, g: string, corps: Corps) => appeler('POST', `/console/entreprises/${ent}/abonnement/${g}`, amira.console, corps);
const fermes = async (ent: string, jeton: string) => (await appeler('GET', `/entreprises/${ent}/abonnement/etat`, jeton)).corps.fermes;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await direction();
  const editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
  expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
  await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli);
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('ce que l\'offre compte', () => {
  it('un module acheté seul sur Essentiel : la direction l\'ouvre avec son motif, il s\'ouvre chez le client, et se retire ; Complet le contient déjà', async () => {
    const p = await inscrire('nadia');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier Modules' })).corps.id);
    expect((await geste(ent, 'payer', { paiement: RECU_CONSOLE, motif: 'virement reçu', ligne: await ligneDe(ent), offre: 'essentiel', periodicite: 'annuel' })).statut).toBe(200);
    expect(await fermes(ent, p.jeton)).toEqual(['paie', 'compta']);
    // Sans motif, rien ; puis la paie, achetée seule.
    expect((await geste(ent, 'ouvrir-module', { motif: '', ligne: await ligneDe(ent), module: 'paie' })).statut).toBe(400);
    // L'aperçu dit les modules d'après (l'état, lui, ne change pas), sans rien ouvrir.
    const apercu = await geste(ent, 'ouvrir-module', { motif: '', ligne: await ligneDe(ent), module: 'paie', apercu: true });
    expect(apercu.corps).toMatchObject({ apercu: true, modules: ['paie'] });
    expect(await fermes(ent, p.jeton)).toEqual(['paie', 'compta']);
    const ouvert = await geste(ent, 'ouvrir-module', { motif: 'commande de la paie par e-mail', ligne: await ligneDe(ent), module: 'paie' });
    expect(ouvert.statut, JSON.stringify(ouvert.corps)).toBe(200);
    expect(await ligneDe(ent)).toMatchObject({ offre: 'essentiel', modules: ['paie'] });
    expect(await fermes(ent, p.jeton)).toEqual(['compta']);
    const salarie = { collection: 'employees', cle: 'sal-1', rang: null, revision: null, contenu: { id: 'sal-1', name: 'Amel Trabelsi', grossSalary: 1250 } };
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, p.jeton, { changements: [salarie] })).statut).toBe(200);
    // Deux fois la même : refusé, en le disant.
    const encore = await geste(ent, 'ouvrir-module', { motif: 'encore la paie', ligne: await ligneDe(ent), module: 'paie' });
    expect(encore.statut).toBe(403);
    expect(String(encore.corps.motif)).toBe('La paie est déjà achetée pour cet abonnement.');
    // L'histoire du client le dit, sans le motif ; le journal de la console, avec.
    const histoire = (await appeler('GET', `/entreprises/${ent}/abonnement`, p.jeton)).corps;
    expect((histoire.historique as { nature: string; apres: Corps }[])[0]).toMatchObject({ nature: 'module_ouvert', apres: { module: 'paie', modules: ['paie'] } });
    expect(histoire.modules).toEqual(['paie']);
    // Ce qui s'ajoute à l'offre, au prix du jour, se lit AVANT d'arriver sur une facture.
    const options = histoire.options as { option: string; periodicite: string; montantHt: string }[];
    expect(options).toHaveLength(10);
    expect(options).toContainEqual({ option: 'caisse', periodicite: 'annuel', montantHt: '120.000' });
    expect(options.map((o) => o.option)).not.toContain('utilisateur');
    expect(options).toContainEqual({ option: 'salarie', periodicite: 'mensuel', montantHt: '1.200' });
    expect(JSON.stringify(histoire)).not.toContain('commande de la paie');
    // Retirée pendant une période payée (0113) : la paie reste ouverte jusqu'à son renouvellement, puis part ; rien n'est
    // perdu, rien n'est à rembourser.
    expect((await geste(ent, 'fermer-module', { motif: 'paie arrêtée', ligne: await ligneDe(ent), module: 'paie' })).statut).toBe(200);
    expect(await fermes(ent, p.jeton)).toEqual(['compta']);
    expect(await ligneDe(ent)).toMatchObject({ modules: ['paie'], modules_a_retirer: ['paie'] });
    // Complet : rien à acheter.
    expect((await geste(ent, 'payer', { paiement: RECU_CONSOLE, motif: 'passe à Complet', ligne: await ligneDe(ent), offre: 'complet', periodicite: 'annuel' })).statut).toBe(200);
    const complet = await geste(ent, 'ouvrir-module', { motif: 'la compta', ligne: await ligneDe(ent), module: 'compta' });
    expect(complet.statut).toBe(403);
    expect(String(complet.corps.motif)).toMatch(/Complet contient déjà/);
  });

  it('la facture compte ce qui dépasse l\'offre et les modules achetés, au prix du jour de chaque ligne ; l\'aperçu le dit, la pièce l\'écrit, la base le rejoue', async () => {
    const p = await inscrire('karim');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Pressing Compté' })).corps.id);
    // Six personnes dans l'équipe : aucune ne se paie, quel que soit son rôle (0102).
    for (const roles of [['commercial'], ['magasinier'], ['lecture'], ['caissier', 'lecture'], ['caissier']]) await membre(ent, p.jeton, roles);
    // La paie achetée, et douze salariés : onze présents (l'un est sorti hier), dix compris dans la paie achetée.
    expect((await geste(ent, 'ouvrir-module', { motif: 'paie achetée seule', ligne: await ligneDe(ent), module: 'paie' })).statut).toBe(200);
    for (let i = 1; i <= 12; i++) {
      await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)',
        [ent, 'employees', `s${i}`, i, JSON.stringify({ id: `s${i}`, name: `Salarié ${i}`, endDate: i === 12 ? '2020-01-31' : '' })]);
    }
    const chemin = `/console/entreprises/${ent}/factures`;
    const apercu = await appeler('POST', chemin, amira.console, { offre: 'essentiel', periodicite: 'annuel', motif: '', apercu: true });
    expect(apercu.statut, JSON.stringify(apercu.corps)).toBe(200);
    const f = apercu.corps.facture as { montantHt: string; prixOffreHt: string; enPlus: Corps[]; ceQueDira: Corps };
    expect(f.prixOffreHt).toBe('390.000');
    expect(f.enPlus).toEqual([
      { option: 'module_paie', quantite: 1, compte: 1, inclus: 0, prixHt: '150.000', totalHt: '150.000' },
      { option: 'salarie', quantite: 1, compte: 11, inclus: 10, prixHt: '12.000', totalHt: '12.000' },
    ]);
    expect(f.montantHt).toBe('552.000');
    expect(f.ceQueDira).toMatchObject({ ht: '552.000' });
    // Au mois : le dixième de chaque prix.
    const mois = (await appeler('POST', chemin, amira.console, { offre: 'essentiel', periodicite: 'mensuel', motif: '', apercu: true })).corps.facture as { montantHt: string };
    expect(mois.montantHt).toBe('55.200');
    // Préparée : la pièce écrit chaque ligne, la base garde le total et le journal ce qui s'ajoute.
    expect((await appeler('POST', chemin, amira.console, { offre: 'essentiel', periodicite: 'annuel', motif: 'Facture annuelle' })).statut).toBe(201);
    const lu = (await admin.query('select f.montant_ht::text m, d.contenu from plateforme.facture_abonnement f join socle.dossier_v10 d on d.entreprise = f.editeur and d.collection = \'documents\' and d.cle = f.piece_v10 where f.entreprise = $1', [ent])).rows[0] as { m: string; contenu: { lines: Corps[] } };
    expect(lu.m).toBe('552000');
    expect(lu.contenu.lines.map((l) => [l.label, l.qty])).toEqual([
      ['SkanFact Essentiel — abonnement annuel', 1], ['Module Paie (acheté seul)', 1], ['Salarié au-delà de l\'offre', 1]]);
    expect(lu.contenu.lines[2]?.description).toMatch(/^11 au total, dont 10 dans l'offre ; du /);
    const g = (await admin.query("select apres from plateforme.geste_console where geste = 'factures.preparer' and entreprise = $1", [ent])).rows[0]?.apres as Corps;
    expect(g.enPlus).toEqual([{ option: 'module_paie', quantite: 1 }, { option: 'salarie', quantite: 1 }]);
    // La base rejoue le total : noter la même facture avec le seul prix de l'offre (les lignes en plus oubliées) est refusé.
    const fa = (await admin.query('select piece_v10, client_v10, debut::text, fin::text from plateforme.facture_abonnement where entreprise = $1', [ent])).rows[0] as
      { piece_v10: string; client_v10: string; debut: string; fin: string };
    const session = (await admin.query(`select id, utilisateur from plateforme.session_console where utilisateur = $1 and fermee_le is null
        order by ouverte_le desc limit 1`, [amira.utilisateur])).rows[0] as { id: string; utilisateur: string };
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_noter_facture($1, $2, $3, $4, $5, $6::date, $7::date, $8::bigint, $9, $10::date, false)',
        [ent, fa.piece_v10, fa.client_v10, 'essentiel', 'annuel', fa.debut, fa.fin, '390000', 'sans les lignes en plus', jour])).rejects.toThrow(/pas celui de la grille au premier jour de la période/);
    } finally { await k.query('rollback'); k.release(); }
  });

  it('ce que l\'offre compte se lit avant la facture, par qui gère l\'abonnement : ce que l\'entreprise utilise, ce que l\'offre comprend, le même chiffre que la facture ; l\'équipe ne se compte jamais', async () => {
    const p = await inscrire('leila');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Quincaillerie Comptée' })).corps.id);
    type Lu = { offre: string; comptes: Corps; inclus: Corps } | null;
    const compte = async () => (await appeler('GET', `/entreprises/${ent}/abonnement`, p.jeton)).corps.compte as Lu;
    const facture = async () => ((await appeler('POST', `/console/entreprises/${ent}/factures`, amira.console, { offre: 'essentiel', periodicite: 'annuel', motif: '', apercu: true })).corps.facture as { enPlus: Corps[] }).enPlus;
    // Pendant l'essai, rien ne se compte : rien ne se facture.
    expect(await compte()).toBeNull();
    expect((await geste(ent, 'payer', { paiement: RECU_CONSOLE, motif: 'virement reçu', ligne: await ligneDe(ent), offre: 'essentiel', periodicite: 'annuel' })).statut).toBe(200);
    // Une équipe qui grandit et des invitations qui attendent : rien ne s'en compte, ni à l'écran ni sur la facture (0102).
    const vendeur = await membre(ent, p.jeton, ['commercial']);
    for (const roles of [['magasinier'], ['lecture'], ['caissier']]) await membre(ent, p.jeton, roles);
    for (const roles of [['magasinier'], ['lecture']]) expect((await appeler('POST', `/entreprises/${ent}/invitations`, p.jeton, { email: adresse('attend'), roles })).statut).toBe(201);
    const lu = await compte();
    expect(lu).toMatchObject({ offre: 'essentiel', comptes: { salaries: 0 }, inclus: { caisses: 1, etablissements: 1, salaries: null } });
    expect(Object.keys(lu?.comptes ?? {}).sort()).toEqual(['caisses', 'etablissements', 'salaries']);
    expect(Object.keys(lu?.inclus ?? {}).sort()).toEqual(['caisses', 'etablissements', 'salaries']);
    expect(await facture()).toEqual([]);
    // Qui ne gère pas l'abonnement n'en lit rien : ni par l'écran, ni par la base (la propriétaire, elle, la lit).
    expect((await appeler('GET', `/entreprises/${ent}/abonnement`, vendeur.jeton)).statut).toBe(403);
    const k = await pool.connect();
    try {
      for (const [jeton, rien] of [[vendeur.jeton, true], [p.jeton, false]] as const) {
        await k.query('begin');
        await k.query("select set_config('app.utilisateur', $1, true)", [(await quiEst(ctx, jeton))?.utilisateur]);
        const v = (await k.query('select plateforme.ce_que_l_offre_compte($1, $2, $3::date) v', [ent, 'essentiel', jour])).rows[0].v as unknown;
        expect(v === null).toBe(rien);
        await k.query('rollback');
      }
    } finally { k.release(); }
    // La paie achetée, onze salariés présents : dix compris ; l'écran et la facture disent le même onze.
    expect((await geste(ent, 'ouvrir-module', { motif: 'paie achetée seule', ligne: await ligneDe(ent), module: 'paie' })).statut).toBe(200);
    for (let i = 1; i <= 11; i++) {
      await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)',
        [ent, 'employees', `s${i}`, i, JSON.stringify({ id: `s${i}`, name: `Salarié ${i}`, endDate: '' })]);
    }
    const apres = await compte();
    expect(apres).toMatchObject({ comptes: { salaries: 11 }, inclus: { salaries: 10 } });
    expect((await facture()).find((l) => l.option === 'salarie')).toMatchObject({ compte: apres?.comptes.salaries, inclus: 10, quantite: 1 });
    // Complet : deux caisses, deux établissements, vingt salariés.
    expect((await geste(ent, 'payer', { paiement: RECU_CONSOLE, motif: 'passe à Complet', ligne: await ligneDe(ent), offre: 'complet', periodicite: 'annuel' })).statut).toBe(200);
    expect((await compte())?.inclus).toEqual({ caisses: 2, etablissements: 2, salaries: 20 });
  });
});
