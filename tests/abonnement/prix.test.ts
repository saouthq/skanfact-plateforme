// Un nouveau prix se prépare dans la console (docs/abonnement.md C14 ; 0103), par l'API. Ce que le serveur garantit :
//   - la direction prépare un prix (d'une offre ou de ce qui s'ajoute), avec son motif, au plus tôt après le préavis ;
//     l'aperçu dit le prix d'aujourd'hui et l'écart ; un seul prix à venir par choix ; jamais le prix déjà en vigueur ;
//   - le client le lit à venir dans « Ton abonnement » dès qu'il est préparé (sans le motif, une note de SkanFact) ;
//   - il se retire avant sa date ; un prix en vigueur ou passé ne change ni ne disparaît, quoi qu'on demande à la base ;
//   - le préavis se règle dans la console, au journal comme le reste ;
//   - la facture d'une période se prend au prix de son PREMIER JOUR : un nouveau prix vaut pour les périodes qui
//     commencent à sa date ou après, jamais pour une période commencée ; la base le rejoue.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
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

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prix-')), 'veille.json');
const jour = aujourdhuiATunis();
const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `prix-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
  return { appli, console: String(k.corps.jeton), nom: `amira ${n}` };
}
let amira: Awaited<ReturnType<typeof direction>>;
const prix = (corps: Corps) => appeler('POST', '/console/reglages/prix', amira.console, corps);
const retirer = (corps: Corps) => appeler('POST', '/console/reglages/prix/retirer', amira.console, corps);
const reglages = async () => (await appeler('GET', '/console/reglages', amira.console)).corps as {
  grille: { offre: string; aVenir: Corps[] }[]; ajouts: { option: string; aVenir: Corps[] }[]; preavis: Corps | null };
const dernierGeste = async (geste: string) => (await admin.query('select avant, apres, motif from plateforme.geste_console where geste = $1 order by le desc, id desc limit 1', [geste])).rows[0] as
  { avant: Corps; apres: Corps; motif: string } | undefined;
const ligneDe = async (ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, amira.console)).corps.ligne;
const geste = (ent: string, g: string, corps: Corps) => appeler('POST', `/console/entreprises/${ent}/abonnement/${g}`, amira.console, corps);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await direction();
});
// Les prix à venir que les tests ont préparés ne restent pas : la base les laisse effacer tant qu'ils sont à venir.
afterAll(async () => {
  await admin.query('delete from plateforme.prix where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
  await admin.query('delete from plateforme.prix_option where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
  await app.close(); await admin.end(); await pool.end();
});

describe('un nouveau prix, préparé dans la console', () => {
  it('la direction le prépare au plus tôt après le préavis, le client le lit à venir ; il se retire avant sa date, et un prix en vigueur ne bouge jamais', async () => {
    const plusTot = plusJours(jour, 30);
    // L'aperçu : le prix d'aujourd'hui, le nouveau, l'écart (arrondi au dixième), le premier jour possible.
    const apercu = await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '420', aPartirDu: plusTot, motif: '', apercu: true });
    expect(apercu.statut, JSON.stringify(apercu.corps)).toBe(200);
    expect(apercu.corps).toMatchObject({ avant: '390.000', apres: '420.000', ecart: { sens: 'hausse', dixiemes: 77 }, plusTot, abonnes: expect.any(Number), dejaAVenir: null });
    // Un prix illisible se refuse en nommant sa case ; un jour trop tôt, en disant le premier jour possible.
    expect((await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '42O', aPartirDu: plusTot, motif: 'hausse' })).corps).toMatchObject({ champ: 'montant' });
    const tot = await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '420', aPartirDu: plusJours(jour, 29), motif: 'hausse annoncée' });
    expect(tot.statut).toBe(403);
    expect(String(tot.corps.motif)).toBe(`Un nouveau prix commence au plus tôt le ${enFrancais(plusTot)} : c'est le préavis en vigueur.`);
    // Préparé : au journal, de l'ancien prix au nouveau, avec sa date et le motif.
    expect((await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '420,000', aPartirDu: plusTot, motif: 'hausse annoncée aux pilotes' })).statut).toBe(201);
    expect(await dernierGeste('reglages.prix_prepare')).toMatchObject({ motif: 'hausse annoncée aux pilotes',
      avant: { quoi: 'essentiel', periodicite: 'annuel', montantHt: '390.000' }, apres: { quoi: 'essentiel', periodicite: 'annuel', aPartirDu: plusTot, montantHt: '420.000' } });
    // Un seul à venir par choix ; jamais le prix déjà en vigueur.
    const encore = await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '450', aPartirDu: plusJours(jour, 60), motif: 'une autre hausse' });
    expect(String(encore.corps.motif)).toMatch(/^Un prix est déjà préparé pour ce choix/);
    expect((await prix({ quoi: 'essentiel', periodicite: 'annuel', montant: '450', aPartirDu: plusTot, motif: '', apercu: true })).corps).toMatchObject({ dejaAVenir: plusTot });
    expect(String((await prix({ quoi: 'complet', periodicite: 'annuel', montant: '690', aPartirDu: plusTot, motif: 'le même' })).corps.motif)).toMatch(/^C'est déjà le prix en vigueur/);
    // La console le montre à venir, avec qui l'a préparé et pourquoi.
    const r = await reglages();
    expect(r.grille.find((l) => l.offre === 'essentiel')?.aVenir).toEqual([
      { periodicite: 'annuel', ht: '420.000', aPartirDu: plusTot, motif: 'hausse annoncée aux pilotes', par: amira.nom, le: expect.any(String) }]);
    expect(r.preavis).toMatchObject({ jours: 30 });
    // Le client le lit dès maintenant, sans le motif.
    const client = await inscrire('karim');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Épicerie Prévenue' })).corps.id);
    const abo = (await appeler('GET', `/entreprises/${ent}/abonnement`, client.jeton)).corps;
    expect(abo.aVenir).toEqual([{ quoi: 'essentiel', periodicite: 'annuel', aPartirDu: plusTot, montantHt: '420.000' }]);
    expect(abo.prix).toContainEqual({ offre: 'essentiel', periodicite: 'annuel', montantHt: '390.000' });
    // Retiré avant sa date : la grille d'aujourd'hui reste, le client ne le lit plus, le journal garde le prix retiré.
    expect((await retirer({ quoi: 'essentiel', periodicite: 'annuel', aPartirDu: plusTot, motif: 'erreur de saisie' })).statut).toBe(200);
    expect((await reglages()).grille.find((l) => l.offre === 'essentiel')?.aVenir).toEqual([]);
    expect((await appeler('GET', `/entreprises/${ent}/abonnement`, client.jeton)).corps.aVenir).toEqual([]);
    expect(await dernierGeste('reglages.prix_retire')).toMatchObject({ avant: { aPartirDu: plusTot, montantHt: '420.000', motif: 'hausse annoncée aux pilotes' }, apres: { montantHt: '390.000' } });
    // Un prix en vigueur ne se retire pas ; la base refuse de l'effacer ou de le changer, quoi qu'on lui demande.
    expect(String((await retirer({ quoi: 'essentiel', periodicite: 'annuel', aPartirDu: '2026-09-28', motif: 'essai' })).corps.motif)).toMatch(/^Ce prix est déjà en vigueur/);
    await expect(admin.query("delete from plateforme.prix where offre = 'essentiel' and periodicite = 'annuel' and a_partir_du = '2026-09-28'")).rejects.toThrow(/ne s'efface jamais/);
    await expect(admin.query("update plateforme.prix_option set montant_ht = 1 where option = 'caisse'")).rejects.toThrow(/ne se modifie pas/);
  });

  it('le préavis se règle dans la console : il vaut dès aujourd\'hui, au journal avec le préavis d\'avant', async () => {
    expect((await appeler('POST', '/console/reglages/preavis', amira.console, { jours: 10, motif: 'une baisse pressée' })).statut).toBe(200);
    expect((await reglages()).preavis).toMatchObject({ jours: 10, aPartirDu: jour, motif: 'une baisse pressée', par: amira.nom });
    expect(await dernierGeste('reglages.preavis')).toMatchObject({ avant: { jours: 30 }, apres: { jours: 10 } });
    expect(String((await appeler('POST', '/console/reglages/preavis', amira.console, { jours: 10, motif: 'encore' })).corps.motif)).toMatch(/^C'est déjà le préavis en vigueur/);
    // Une règle posée ne se réécrit pas : on en pose une nouvelle.
    await expect(admin.query("update plateforme.regle_abonnement set jours = '{1}' where code = 'preavis_prix'")).rejects.toThrow(/ne se modifie pas et ne s'efface pas/);
    // Dix jours suffisent maintenant, pour ce qui s'ajoute comme pour les offres.
    expect((await prix({ quoi: 'caisse', periodicite: 'mensuel', montant: '11', aPartirDu: plusJours(jour, 10), motif: 'baisse de la caisse' })).statut).toBe(201);
    expect((await reglages()).ajouts.find((l) => l.option === 'caisse')?.aVenir).toMatchObject([{ periodicite: 'mensuel', ht: '11.000', aPartirDu: plusJours(jour, 10) }]);
    expect((await retirer({ quoi: 'caisse', periodicite: 'mensuel', aPartirDu: plusJours(jour, 10), motif: 'essai fini' })).statut).toBe(200);
    expect((await appeler('POST', '/console/reglages/preavis', amira.console, { jours: 30, motif: 'retour aux trente jours' })).statut).toBe(200);
  });

  it('la facture d\'une période se prend au prix de son premier jour : un nouveau prix ne touche jamais une période commencée', async () => {
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    const editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli);
    // Loin : payée deux ans d'avance, sa prochaine période commence après le nouveau prix. Proche : au mois, avant.
    const p = await inscrire('ines');
    const loin = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Clinique Loin' })).corps.id);
    for (const motif of ['première année', 'deuxième année']) {
      expect((await geste(loin, 'payer', { motif, ligne: await ligneDe(loin), offre: 'complet', periodicite: 'annuel' })).statut).toBe(200);
    }
    // Vingt et un salariés présents : un au-delà des vingt de Complet, sur la facture de la troisième année.
    for (let i = 1; i <= 21; i++) {
      await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)',
        [loin, 'employees', `s${i}`, i, JSON.stringify({ id: `s${i}`, name: `Salarié ${i}`, endDate: '' })]);
    }
    const proche = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Clinique Proche' })).corps.id);
    expect((await geste(proche, 'payer', { motif: 'le mois', ligne: await ligneDe(proche), offre: 'complet', periodicite: 'mensuel' })).statut).toBe(200);
    const date = plusJours(jour, 400);
    for (const [quoi, periodicite, montant] of [['complet', 'annuel', '750'], ['complet', 'mensuel', '75'], ['salarie', 'annuel', '15']] as const) {
      expect((await prix({ quoi, periodicite, montant, aPartirDu: date, motif: 'nouvelle grille' })).statut).toBe(201);
    }
    const corpsDe = async (ent: string, periodicite: string) => (await appeler('POST', `/console/entreprises/${ent}/factures`, amira.console,
      { offre: 'complet', periodicite, motif: '', apercu: true })).corps;
    const apercu = async (ent: string, periodicite: string) => (await corpsDe(ent, periodicite)).facture as { debut: string; prixOffreHt: string; montantHt: string; enPlus: Corps[] };
    // L'aperçu dit le prix d'aujourd'hui quand la période se facture à un autre : sinon, rien.
    expect((await corpsDe(loin, 'annuel')).prixAujourdhuiHt).toBe('690.000');
    expect((await corpsDe(proche, 'mensuel')).prixAujourdhuiHt).toBeNull();
    const l = await apercu(loin, 'annuel');
    expect(l.debut > date).toBe(true);
    // L'offre ET ce qui dépasse, au prix du premier jour de la période ; compté aujourd'hui (vingt et un salariés).
    expect(l).toMatchObject({ prixOffreHt: '750.000', montantHt: '765.000',
      enPlus: [{ option: 'salarie', quantite: 1, compte: 21, inclus: 20, prixHt: '15.000', totalHt: '15.000' }] });
    const pr = await apercu(proche, 'mensuel');
    expect(pr.debut < date).toBe(true);
    expect(pr).toMatchObject({ prixOffreHt: '69.000', montantHt: '69.000' });
    // Préparée : la base rejoue le total au premier jour de la période, et refuse l'ancien prix.
    expect((await appeler('POST', `/console/entreprises/${loin}/factures`, amira.console, { offre: 'complet', periodicite: 'annuel', motif: 'Facture de la troisième année' })).statut).toBe(201);
    expect((await admin.query('select montant_ht::text m from plateforme.facture_abonnement where entreprise = $1', [loin])).rows).toEqual([{ m: '765000' }]);
    const fa = (await admin.query('select piece_v10, client_v10, debut::text, fin::text from plateforme.facture_abonnement where entreprise = $1', [loin])).rows[0] as
      { piece_v10: string; client_v10: string; debut: string; fin: string };
    const qui = await quiEst(ctx, amira.appli);
    const session = (await admin.query('select id from plateforme.session_console where utilisateur = $1 and fermee_le is null order by ouverte_le desc limit 1', [qui?.utilisateur])).rows[0] as { id: string };
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [qui?.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_noter_facture($1, $2, $3, $4, $5, $6::date, $7::date, $8::bigint, $9, $10::date)',
        [loin, fa.piece_v10, fa.client_v10, 'complet', 'annuel', fa.debut, fa.fin, '702000', 'au prix d\'aujourd\'hui', jour])).rejects.toThrow(/premier jour de la période/);
    } finally { await k.query('rollback'); k.release(); }
  });
});
