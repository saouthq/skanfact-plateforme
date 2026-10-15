// Les contestations de nos factures (1.36.0 ; base 0129 ; docs/console.md C52 ; la liste des fonctions qui manquent, 13),
// par l'API. Ce que le serveur garantit :
//   - une facture ÉMISE se conteste, une fois à la fois ; la direction et le support la notent, la technique non ;
//   - le support ne régularise que par « retirée » ; un avoir, un remboursement, la facture maintenue sont à la direction,
//     et l'avoir et le remboursement disent leur référence ;
//   - la fiche dit la contestation de chaque facture, Paiements les liste, « À décider » nomme celle qui attend sa
//     régularisation depuis une semaine ; chaque geste au journal.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { CONTESTATION_JOURS, lireContestations } from '../../serveur/console/contestations.ts';
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
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'contestations-')), 'veille.json');
const jour = aujourdhuiATunis(horloge);
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `contest-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const appli = String(c.corps.jeton);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { email, appli, console: String(k.corps.jeton) };
}
async function abonnee(nom: string, essaiDans: number) {
  const email = `contest-proprio${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + $3::int where entreprise = $1', [id, jour, essaiDans]);
  return { id, email };
}
const dossier = async (ent: string, jeton: string) =>
  (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; rang: number | null; contenu: Corps; revision: number }[];

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let editeur: string;

// Préparer puis émettre, dans SkanFact, la facture d'un abonnement mensuel Essentiel (47,410 : 39 HT, la TVA, le timbre).
async function factureEmise(nom: string): Promise<{ id: string; cle: string }> {
  const b = await abonnee(nom, 3);
  expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
  const objets = await dossier(editeur, direction.appli);
  const brouillon = objets.find((o) => o.collection === 'documents' && o.cle.startsWith(`abonnement-${b.id}-`));
  const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
  const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
  expect(e.statut, JSON.stringify(e.corps)).toBe(200);
  return { id: b.id, cle: brouillon?.cle ?? '' };
}
beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  editeur = String((await appeler('POST', '/entreprises', direction.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
  expect((await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

let technique: Awaited<ReturnType<typeof membre>>;
const fiche = async (id: string, jeton = direction.console) => (await appeler('GET', `/console/entreprises/${id}`, jeton)).corps as {
  factures: { lignes: { id: string; numero: string | null; etat: string }[] }; contestations: unknown[]; attend: { sorte: string }[] };
const journal = async (geste: string, ent: string) => (await admin.query(
  'select role, motif, avant, apres from plateforme.geste_console where geste = $1 and entreprise = $2 order by le', [geste, ent])).rows;
const contester = (facture: string, jeton: string, dit: string, canal = 'telephone') => appeler('POST', `/console/factures-abonnement/${facture}/contester`, jeton, { canal, dit });
const regulariser = (c: string, jeton: string, issue: string, reference: string | null, motif = 'vu avec le client') =>
  appeler('POST', `/console/contestations/${c}/regulariser`, jeton, { issue, reference, motif });

describe('les contestations de nos factures (0129)', () => {
  it('une facture émise se conteste, une fois à la fois ; le support la note et la dit retirée, jamais plus ; chaque geste au journal', async () => {
    technique = await membre('Tarek', 'technique');
    const a = await factureEmise('Contestée Une SARL');
    const ligne = (await fiche(a.id)).factures.lignes[0];
    if (!ligne?.numero) throw new Error('une facture émise attendue');
    // La technique ne lit aucune donnée de client : elle ne conteste rien. Un mot vide ne se note pas.
    expect((await contester(ligne.id, technique.console, 'Je n\'ai pas choisi Essentiel')).statut).toBe(403);
    expect((await contester(ligne.id, support.console, ' ')).statut).toBe(400);
    const r = await contester(ligne.id, support.console, 'Je n\'ai pas choisi Essentiel', 'whatsapp');
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const c = lireContestations((await fiche(a.id, support.console)).contestations);
    expect(c).toMatchObject([{ facture: ligne.id, numero: ligne.numero, canal: 'whatsapp', dit: 'Je n\'ai pas choisi Essentiel', close: null, entreprise: { id: a.id } }]);
    // Une seconde, tant que la première court : refusée, et le refus le dit.
    const deux = await contester(ligne.id, direction.console, 'Encore');
    expect(deux.statut).toBe(403);
    expect(deux.corps.motif).toBe('Cette facture est déjà contestée : la contestation en cours attend sa régularisation.');
    // Le support ne régularise pas avec de l'argent ; il la dit retirée.
    const id = c[0]?.id ?? '';
    const avoir = await regulariser(id, support.console, 'avoir', 'AV-2026-0001');
    expect(avoir.statut).toBe(403);
    expect(avoir.corps.motif).toBe('La direction seule régularise une contestation par un avoir, un remboursement ou en maintenant la facture.');
    expect((await regulariser(id, support.console, 'retiree', null, 'il a relu son devis')).statut).toBe(200);
    expect(lireContestations((await fiche(a.id)).contestations)[0]?.close).toMatchObject({ issue: 'retiree', reference: null, motif: 'il a relu son devis' });
    expect((await regulariser(id, direction.console, 'maintenue', null)).statut).toBe(403);
    expect((await journal('paiements.contester', a.id)).map((g) => [g.role, g.motif, g.apres])).toEqual([['support', 'Je n\'ai pas choisi Essentiel', { facture: ligne.numero, canal: 'whatsapp' }]]);
    expect((await journal('paiements.regulariser', a.id)).map((g) => [g.role, g.apres])).toEqual([['support', { facture: ligne.numero, issue: 'retiree', reference: null }]]);
  });

  it('la direction régularise par un avoir avec sa référence ; Paiements la liste ; « À décider » la nomme après une semaine, pas avant', async () => {
    const b = await factureEmise('Contestée Deux SARL');
    const ligne = (await fiche(b.id)).factures.lignes[0];
    if (!ligne?.numero) throw new Error('une facture émise attendue');
    expect((await contester(ligne.id, direction.console, 'Le mois de septembre facturé deux fois')).statut).toBe(201);
    const enCours = lireContestations((await appeler('GET', '/console/paiements', direction.console)).corps.contestations);
    const c = enCours.find((x) => x.facture === ligne.id);
    if (!c) throw new Error('la contestation attendue dans Paiements');
    expect(c.close).toBeNull();
    // Six jours : pas encore dans « À décider » ; huit : oui, avec ses jours d'attente.
    const decider = async () => ((await appeler('GET', '/console/accueil', direction.console)).corps.decider as { sorte: string; entreprise?: { id: string }; jours?: number }[])
      .filter((l) => l.sorte === 'contestation' && l.entreprise?.id === b.id);
    await admin.query("update plateforme.contestation set ouverte_le = now() - interval '6 days' where id = $1", [c.id]);
    expect(await decider()).toEqual([]);
    await admin.query("update plateforme.contestation set ouverte_le = now() - interval '8 days' where id = $1", [c.id]);
    expect((await decider()).map((l) => l.jours)).toEqual([8]);
    expect(CONTESTATION_JOURS).toBe(7);
    // La fiche le dit dans « ce qui attend ».
    expect((await fiche(b.id)).attend.map((x) => x.sorte)).toContain('contestation');
    // Un avoir sans sa référence : refusé ; avec : close, et « À décider » ne la nomme plus.
    const sans = await regulariser(c.id, direction.console, 'avoir', null);
    expect(sans.statut).toBe(403);
    expect(sans.corps.motif).toBe('Un avoir ou un remboursement se retrouve par sa référence : le numéro de l\'avoir, la référence du virement.');
    expect((await regulariser(c.id, direction.console, 'avoir', 'AV-2026-0007', 'septembre facturé deux fois : avoir émis')).statut).toBe(200);
    expect(lireContestations((await fiche(b.id)).contestations)[0]?.close).toMatchObject({ issue: 'avoir', reference: 'AV-2026-0007' });
    expect(await decider()).toEqual([]);
    // Régularisée, elle ne se régularise plus ; une nouvelle contestation de la même facture se note.
    const encore = await regulariser(c.id, direction.console, 'maintenue', null);
    expect(encore.statut).toBe(403);
    expect(encore.corps.motif).toBe('Cette contestation est déjà régularisée.');
    expect((await contester(ligne.id, direction.console, 'Et octobre aussi')).statut).toBe(201);
  });

  it('une facture préparée, pas encore émise, ne se conteste pas ; une contestation illisible ne se devine pas', async () => {
    const p = await abonnee('Préparée SARL', 3);
    expect((await appeler('POST', `/console/entreprises/${p.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const ligne = (await fiche(p.id)).factures.lignes[0];
    if (!ligne) throw new Error('une facture préparée attendue');
    const r = await contester(ligne.id, direction.console, 'Pas d\'accord');
    expect(r.statut).toBe(403);
    expect(r.corps.motif).toBe('Seule une facture émise se conteste : une facture préparée se corrige avant d\'être émise.');
    expect(lireContestations([{ id: 'x', facture: 'f', piece: 'p', dit: 'oui', ouverteLe: 'hier', canal: 'telephone', entreprise: { id: 'e' } }])).toEqual([]);
    expect(lireContestations([{ id: 'x', facture: 'f', piece: 'p', dit: 'oui', ouverteLe: '2026-10-01T10:00:00Z', canal: 'telephone', entreprise: { id: 'e' }, close: { issue: 'oublie', le: '2026-10-02T10:00:00Z' } }])).toEqual([]);
  });
});
