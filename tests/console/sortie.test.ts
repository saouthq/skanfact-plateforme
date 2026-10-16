// La sortie d'un client et la conservation de ses données (1.38.0 ; base 0131 ; docs/console.md C54 ; la liste des
// fonctions qui manquent, 8 et 33), par l'API. Ce que le serveur garantit :
//   - la direction seule ouvre, règle et clôt une sortie ; une à la fois par client ; chaque geste au journal ;
//   - « ses données remises » se lit dans SON journal (le téléchargement complet qu'il a fait), après l'ouverture ;
//   - « il est parti » se refuse tant que son abonnement se renouvelle ou que le remboursement n'est pas réglé ; close,
//     elle garde le dernier jour du contrat et le terme de la conservation (dix ans après) ;
//   - « À décider » nomme une sortie en cours dont le contrat a pris fin, avec ce qui reste ; rien ne s'écrit chez lui.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { lireSortie, peutPartir, restantes, sortieADecider, type Sortie } from '../../serveur/console/sortie.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sortie-')), 'veille.json');
const jour = aujourdhuiATunis(horloge);
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support') {
  const email = `sortie-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const qui = await quiEst(ctx, String(c.corps.jeton));
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return String(k.corps.jeton);
}
// Une cliente, payée jusqu'à `payeDans` jours (un abonnement annuel qui se renouvellerait).
async function cliente(nom: string, payeDans: number) {
  const email = `sortie-proprio${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 300, paye_jusqu_au = $2::date + $3::int, offre = 'essentiel', periodicite = 'annuel'
    where entreprise = $1`, [id, jour, payeDans]);
  return { id, jeton };
}

let direction: string;
let support: string;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille })]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const fiche = async (id: string, jeton = direction) => (await appeler('GET', `/console/entreprises/${id}`, jeton)).corps as { sortie: unknown; attend: { sorte: string }[] };
const saSortie = async (id: string) => {
  const s = lireSortie((await fiche(id)).sortie);
  if (!s) throw new Error('une sortie attendue');
  return s;
};
const journal = async (geste: string, ent: string) => (await admin.query(
  'select role, motif, avant, apres from plateforme.geste_console where geste = $1 and entreprise = $2 order by le', [geste, ent])).rows;
const ouvrir = (id: string, jeton: string, cause = 'prix', dit = 'Trop cher pour nous cette année') => appeler('POST', `/console/entreprises/${id}/sorties`, jeton, { cause, dit });
const rembourser = (s: string, remboursement: string, reference: string | null, motif = 'vu avec le client', plus: Record<string, unknown> = {}) =>
  appeler('POST', `/console/sorties/${s}/remboursement`, direction, { remboursement, reference, motif, ...plus });
const clore = (s: string, issue: string, motif = 'sortie menée au bout') => appeler('POST', `/console/sorties/${s}/clore`, direction, { issue, motif });
const decider = async (id: string) => ((await appeler('GET', '/console/accueil', direction)).corps.decider as { sorte: string; entreprise?: { id: string }; restantes?: string[]; jours?: number }[])
  .filter((l) => l.sorte === 'sortie' && l.entreprise?.id === id);

describe('la sortie d\'un client (0131)', () => {
  it('la direction seule l\'ouvre, une à la fois ; elle dit ce qui reste ; « il est parti » attend le contrat arrêté et le remboursement', async () => {
    const c = await cliente('Partante Une SARL', 120);
    // Le support ne la voit ni ne l'ouvre : c'est un contrat et de l'argent.
    expect((await ouvrir(c.id, support)).statut).toBe(403);
    expect((await fiche(c.id, support)).sortie).toBeNull();
    // Une cause inconnue ou un mot vide ne s'enregistrent pas.
    expect((await ouvrir(c.id, direction, 'colere')).statut).toBe(400);
    const vide = await ouvrir(c.id, direction, 'prix', '  ');
    expect(vide.statut).toBe(403);
    expect(vide.corps.motif).toBe('Ce que le client dit de son départ : de trois à mille caractères.');
    expect((await ouvrir(c.id, direction, 'manque', 'Il lui faut la gestion des lots')).statut).toBe(201);
    const deux = await ouvrir(c.id, direction);
    expect(deux.statut).toBe(403);
    expect(deux.corps.motif).toBe('La sortie de ce client est déjà ouverte : elle se suit sur sa fiche.');

    let s = await saSortie(c.id);
    expect(s).toMatchObject({ cause: 'manque', dit: 'Il lui faut la gestion des lots', contrat: { arrete: false, fin: plusJours(jour, 120), offert: false }, export: null, remboursement: null, close: null });
    expect(restantes(s)).toEqual(['contrat', 'donnees', 'remboursement']);
    // Son abonnement se renouvelle encore : « il est parti » est refusé, et le refus dit le geste qui débloque.
    const tot = await clore(s.id, 'partie');
    expect(tot.statut).toBe(403);
    expect(tot.corps.motif).toBe('Son abonnement se renouvelle encore : résilie-le d\'abord, il ira au bout de ce qui est payé.');
    // Résilié : le contrat s'arrête au dernier jour payé ; le remboursement manque encore.
    await admin.query('update plateforme.abonnement set resilie_le = $2 where entreprise = $1', [c.id, jour]);
    s = await saSortie(c.id);
    expect(s.contrat).toEqual({ arrete: true, fin: plusJours(jour, 120), offert: false });
    const sansRemb = await clore(s.id, 'partie');
    expect(sansRemb.corps.motif).toBe('Le remboursement n\'est pas réglé : dis s\'il n\'y a rien à rendre, ou la référence de ce qui a été rendu.');
    // Un remboursement fait sans sa référence : refusé ; avec : noté, puis changé (le journal garde l'avant).
    const sansRef = await rembourser(s.id, 'fait', '  ');
    expect(sansRef.corps.motif).toBe('Un remboursement se retrouve par sa référence : le numéro de l\'avoir, la référence du virement.');
    // Rendu (0138, l'audit 1.42.0 A04) : son montant et son jour ; déclaré, il n'est pas rapproché tant que SkanFact ne l'a
    // pas noté sur ses factures — l'étape reste, et « il est parti » le refuse, en disant le geste qui débloque.
    expect((await rembourser(s.id, 'fait', 'VIR-2026-0042', 'quatre mois rendus', { le: jour })).corps.motif).toBe('Le montant remboursé : plus que zéro.');
    expect((await rembourser(s.id, 'fait', 'VIR-2026-0042', 'quatre mois rendus', { montant: '120,500', le: plusJours(jour, 1) })).corps.motif).toBe('Le jour du remboursement : aujourd\'hui ou avant.');
    expect((await rembourser(s.id, 'fait', 'VIR-2026-0042', 'quatre mois rendus', { montant: '120,500', le: jour })).statut).toBe(200);
    s = await saSortie(c.id);
    expect(s.remboursement).toMatchObject({ sorte: 'fait', reference: 'VIR-2026-0042', montant: '120.500', renduLe: jour, rapproche: false });
    expect(peutPartir(s)).toBe(false);
    expect((await clore(s.id, 'partie')).corps.motif).toBe('Le remboursement déclaré n\'est pas encore noté dans SkanFact : note-le sur sa facture (un règlement négatif, ou son avoir), puis clos la sortie.');
    // Finalement rien à rendre : réglé.
    expect((await rembourser(s.id, 'aucun', null, 'payé jusqu\'au bout, rien à rendre')).statut).toBe(200);
    s = await saSortie(c.id);
    expect(s.remboursement).toMatchObject({ sorte: 'aucun', montant: null, rapproche: null });
    expect(peutPartir(s)).toBe(true);
    // Ses données : c'est lui qui les télécharge ; la fiche lit la trace de son journal.
    expect(restantes(s)).toEqual(['donnees']);
    expect((await appeler('GET', `/entreprises/${c.id}/export`, c.jeton)).statut).toBe(200);
    s = await saSortie(c.id);
    expect(s.export).not.toBeNull();
    expect(restantes(s)).toEqual([]);
    // Il est parti : la sortie garde le dernier jour du contrat et le terme de la conservation, dix ans après.
    expect((await clore(s.id, 'partie', 'contrat fini, données remises, avoir émis')).statut).toBe(200);
    s = await saSortie(c.id);
    const fin = plusJours(jour, 120);
    expect(s.close).toMatchObject({ issue: 'partie', finContrat: fin, motif: 'contrat fini, données remises, avoir émis' });
    expect(s.conserverJusquAu).toBe(`${Number(fin.slice(0, 4)) + 10}${fin.slice(4)}`);
    // Close, elle ne bouge plus ; une nouvelle sortie peut s'ouvrir.
    expect((await rembourser(s.id, 'aucun', null)).corps.motif).toBe('Cette sortie est close.');
    expect((await clore(s.id, 'reste')).corps.motif).toBe('Cette sortie est close.');
    // Chaque geste au journal de la console, avec son rôle et son motif.
    expect((await journal('clients.sortie_ouverte', c.id)).map((g) => [g.role, g.motif, g.apres])).toEqual([['direction', 'Il lui faut la gestion des lots', { cause: 'manque' }]]);
    expect((await journal('clients.sortie_remboursement', c.id)).map((g) => [g.avant, g.apres])).toEqual([
      [null, { remboursement: 'fait', reference: 'VIR-2026-0042', montant: '120500', le: jour }],
      [{ remboursement: 'fait', reference: 'VIR-2026-0042', montant: '120500', le: jour }, { remboursement: 'aucun', reference: null, montant: null, le: null }],
    ]);
    expect((await journal('clients.sortie_close', c.id)).map((g) => g.apres)).toEqual([{ issue: 'partie', finContrat: fin, conserverJusquAu: s.conserverJusquAu }]);
  });

  it('un téléchargement d\'avant l\'ouverture ne compte pas ; « il reste » clôt sans rien toucher ; un abonnement offert ne s\'arrête pas', async () => {
    const c = await cliente('Hésitante SARL', 30);
    expect((await appeler('GET', `/entreprises/${c.id}/export`, c.jeton)).statut).toBe(200);
    // La sortie ouverte une heure après son téléchargement : le fichier d'avant ne contient pas ce qu'il fera ensuite.
    expect((await ouvrir(c.id, direction, 'concurrent', 'Un autre logiciel lui a fait une offre')).statut).toBe(201);
    await admin.query("update plateforme.sortie set ouverte_le = now() + interval '1 hour' where entreprise = $1", [c.id]);
    let s = await saSortie(c.id);
    expect(s.export).not.toBeNull();
    expect(restantes(s)).toContain('donnees');
    // Il reste : la sortie se clôt sans exiger ni contrat arrêté ni remboursement, et son abonnement ne bouge pas.
    const avant = (await admin.query('select paye_jusqu_au::text p, resilie_le from plateforme.abonnement where entreprise = $1', [c.id])).rows[0];
    expect((await clore(s.id, 'reste', 'on lui a montré la remise de groupe')).statut).toBe(200);
    s = await saSortie(c.id);
    expect(s.close).toMatchObject({ issue: 'reste', finContrat: null });
    expect((await admin.query('select paye_jusqu_au::text p, resilie_le from plateforme.abonnement where entreprise = $1', [c.id])).rows[0]).toEqual(avant);
    // Offert : jamais d'échéance (ni période payée, ni offre), le contrat ne s'arrête pas tout seul.
    const o = await cliente('Offerte SARL', 30);
    await admin.query('update plateforme.abonnement set offert = true, paye_jusqu_au = null, offre = null, periodicite = null where entreprise = $1', [o.id]);
    expect((await ouvrir(o.id, direction, 'fermeture', 'Il ferme sa boutique')).statut).toBe(201);
    const so = await saSortie(o.id);
    expect(so.contrat).toEqual({ arrete: false, fin: null, offert: true });
    expect(so.conserverJusquAu).toBeNull();
    expect((await clore(so.id, 'partie')).statut).toBe(403);
  });

  it('« À décider » nomme une sortie en cours dont le contrat a pris fin, avec ce qui reste ; pas avant, plus une fois close', async () => {
    const c = await cliente('Finissante SARL', 5);
    await admin.query('update plateforme.abonnement set resilie_le = $2 where entreprise = $1', [c.id, jour]);
    expect((await ouvrir(c.id, direction, 'prix', 'Il réduit ses dépenses')).statut).toBe(201);
    // Le contrat court encore cinq jours : rien à décider.
    expect(await decider(c.id)).toEqual([]);
    // Il a pris fin il y a trois jours : la ligne le dit, avec ce qui reste ; la fiche aussi.
    await admin.query('update plateforme.abonnement set paye_jusqu_au = $2::date - 3 where entreprise = $1', [c.id, jour]);
    expect((await decider(c.id)).map((l) => [l.jours, l.restantes])).toEqual([[3, ['donnees', 'remboursement']]]);
    // Sa sortie ouverte remplace les lignes de son échéance : ni « en lecture seule », ni « à facturer ».
    const toutes = async () => ((await appeler('GET', '/console/accueil', direction)).corps.decider as { sorte: string; entreprise?: { id: string } }[])
      .filter((l) => l.entreprise?.id === c.id).map((l) => l.sorte);
    expect(await toutes()).toEqual(['sortie']);
    expect((await fiche(c.id)).attend.map((x) => x.sorte)).toContain('sortie');
    const s = await saSortie(c.id);
    expect((await rembourser(s.id, 'aucun', null)).statut).toBe(200);
    expect((await clore(s.id, 'partie', 'parti sans prendre ses données')).statut).toBe(200);
    expect(await decider(c.id)).toEqual([]);
    expect(await toutes()).toEqual(['lecture_seule']);
    expect((await saSortie(c.id)).close?.finContrat).toBe(plusJours(jour, -3));
  });

  it('la lecture est prudente : une sortie illisible ne se devine pas ; la règle d\'« À décider » est la même que la fiche', () => {
    expect(lireSortie({ id: 'x', cause: 'colere', dit: 'oui', ouverteLe: '2026-10-01T10:00:00Z' })).toBeNull();
    expect(lireSortie(null)).toBeNull();
    const base: Sortie = { id: 'x', cause: 'prix', dit: 'trop cher', ouverteLe: '2026-10-01T10:00:00Z', ouvertePar: null,
      contrat: { arrete: true, fin: '2026-10-10', offert: false }, export: null, remboursement: null, conserverJusquAu: '2036-10-10', close: null };
    expect(sortieADecider(base, '2026-10-10')).toBe(false);
    expect(sortieADecider(base, '2026-10-11')).toBe(true);
    expect(sortieADecider({ ...base, contrat: { ...base.contrat, arrete: false } }, '2026-10-11')).toBe(false);
    expect(sortieADecider({ ...base, close: { le: '2026-10-11T09:00:00Z', issue: 'partie', motif: 'fini', par: null, finContrat: '2026-10-10' } }, '2026-10-12')).toBe(false);
    expect(restantes({ ...base, export: { le: '2026-09-30T10:00:00Z', par: null } })).toEqual(['donnees', 'remboursement']);
    expect(restantes({ ...base, export: { le: '2026-10-02T10:00:00Z', par: null } })).toEqual(['remboursement']);
  });
});
