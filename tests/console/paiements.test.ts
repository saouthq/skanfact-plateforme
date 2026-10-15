// Les paiements de nos factures et les coûts du mois (docs/console.md C30 ; 0108), par l'API. Ce que le serveur garantit :
//   - l'encaissé d'un mois : les règlements notés sur nos factures, à leur date, par moyen (Konnect seulement avec la
//     preuve du prestataire), les remboursements déduits ; le même chiffre que la tuile de l'accueil (la même fonction),
//     et que la somme des règlements comptée par un second chemin ; sans entreprise SkanFact, « non mesuré », jamais 0 ;
//   - qui doit encore (le reste, l'échéance, ce qui est déjà venu en déduction), qui a trop payé, ce qui attend d'être
//     émis ; par la règle du solde de toutes les factures ;
//   - les coûts du mois : la direction les saisit d'après la facture reçue (le motif du journal), les retire avec un
//     motif, ne les modifie jamais ; ce qui reste ne se dit qu'avec des coûts saisis ;
//   - la direction seule : le support ne lit ni l'écran ni la tuile.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { annuleeParSesAvoirs, couts, encaisse, moisAvantDe, moisDemande, moyenDe, ouvertes, type Ouverte, type Recu } from '../../serveur/console/paiements.ts';
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
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paiements-')), 'veille.json');
const jour = aujourdhuiATunis(horloge);
const mois = jour.slice(0, 7);
const moisVoisin = (m: string, pas: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + pas, 1)); return d.toISOString().slice(0, 7); };
const moisAvant = moisVoisin(mois, -1);
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support') {
  const email = `paiements-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
  const email = `paiements-proprio${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
// Les règlements d'une facture, comme l'application de SkanFact les note (la pièce entière, ses paiements).
async function regler(cle: string, paiements: unknown[]) {
  const d = (await dossier(editeur, direction.appli)).find((o) => o.collection === 'documents' && o.cle === cle);
  const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
    { changements: [{ collection: 'documents', cle, rang: d?.rang ?? null, revision: d?.revision, contenu: { ...d?.contenu, payments: paiements } }] });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
}
type Ecran = {
  editeur: { entreprise: string } | null; mois: string; courant: boolean;
  encaisse: { total: string; rembourse: string; reglements: number; parMoyen: Record<string, string> } | null;
  recus: { total: number; lignes: { moyen: string; montant: string; entreprise: { id: string }; konnect: unknown; ecran: string }[] };
  doivent: { entreprise: { id: string }; reste: string; paye: string; credite: string; statut: string; retard: number | null; ecran: string }[];
  trop: { entreprise: { id: string }; trop: string; annulee: boolean }[];
  aEmettre: { entreprise: { id: string } }[];
  previsions: { mois: { mois: string; du: { montant: string; n: number } }[]; retard: { montant: string; n: number }; plusTard: { montant: string; n: number } } | null;
  couts: { lignes: { id: string; libelle: string; montant: string; dApres: string; retireLe: string | null }[]; total: string; reste: string | null };
};
const lire = async (m = mois) => {
  const r = await appeler('GET', `/console/paiements?mois=${m}`, direction.console);
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return r.corps as unknown as Ecran;
};
const tuile = async (jeton = direction.console) => ((await appeler('GET', '/console/accueil', jeton)).corps.tableau as { revenusDuMois?: unknown }).revenusDuMois;
// Le second chemin : la somme des règlements des factures d'abonnement du mois, comptée à part, en millimes.
const encaisseParLaBase = async (m: string) => {
  const r = await admin.query(`select coalesce(sum(r.montant), 0)::text s from plateforme.facture_abonnement f
    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
    join ventes.reglement r on r.entreprise = p.entreprise and r.piece = p.id
   where to_char(r.date_reglement, 'YYYY-MM') = $1`, [m]);
  const s = String(r.rows[0].s).padStart(4, '0');
  return `${s.slice(0, -3)}.${s.slice(-3)}`;
};

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
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les paiements de nos factures', () => {
  it('sans entreprise SkanFact, rien ne s\'encaisse : la tuile dit « non mesuré », jamais zéro ; l\'écran le dit aussi', async () => {
    expect(await tuile()).toEqual({ mesure: false, raison: 'editeur_absent' });
    const e = await lire();
    expect(e).toMatchObject({ editeur: null, encaisse: null, mois, courant: true, doivent: [], trop: [], aEmettre: [], previsions: null });
    expect(e.recus.total).toBe(0);
  });

  it('la direction seule : le support ne lit ni l\'écran, ni la tuile, ni ne saisit un coût', async () => {
    expect((await appeler('GET', '/console/paiements', support.console)).statut).toBe(403);
    expect((await appeler('POST', '/console/paiements/couts', support.console, { mois, libelle: 'SMS', montant: '10', dApres: 'Facture WinSMS 12' })).statut).toBe(403);
    expect(await tuile(support.console)).toBeUndefined();
    // La tuile de la direction existe (même « non mesurée ») : c'est le rôle qui la retire, pas l'absence de chiffre.
    expect(await tuile()).toBeDefined();
  });

  it('l\'encaissé du mois, par moyen ; qui doit encore ; le même chiffre à l\'accueil et par un second chemin', async () => {
    expect((await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    // Un paiement reçu hors de la plateforme sous une AUTRE entreprise SkanFact (un autre essai de la même base) : l'argent
    // est à elle, il n'entre pas dans cet encaissé (0113 ; vu le 14/10/2026, les paiements des autres fichiers de tests).
    await admin.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres) values ($1, 'paye', 'exploitation', 'reçu ailleurs', null, $2)`,
      [editeur, JSON.stringify({ facture: 'F-AILLEURS', montant: '999000', moyen: 'virement', le: jour, editeur: '01890000-0000-7000-8000-000000000000' })]);
    expect(await tuile()).toEqual({ mesure: true, montant: '0.000', devise: 'TND', reglements: 0 });
    const a = await factureEmise('Atelier Paiements');
    // Émise, pas réglée : elle doit tout, à payer avant son échéance (la veille de sa période).
    let e = await lire();
    expect(e.doivent).toMatchObject([{ entreprise: { id: a.id }, reste: '47.410', paye: '0.000', credite: '0.000', statut: 'a_payer', retard: null, ecran: `/v10/?e=${editeur}#/doc/${a.cle}` }]);
    // Ce qui doit rentrer (C55) : la même facture, dans le mois de son échéance — deux chemins, un chiffre (la liste
    // « Qui doit encore », et la somme de la prévision).
    const somme = (p: NonNullable<Ecran['previsions']>) => [...p.mois.map((m) => m.du), p.retard, p.plusTard]
      .reduce((t, x) => ({ montant: t.montant + Math.round(Number(x.montant) * 1000), n: t.n + x.n }), { montant: 0, n: 0 });
    if (!e.previsions) throw new Error('des prévisions attendues');
    expect(somme(e.previsions)).toEqual({ montant: 47410, n: 1 });
    expect(e.previsions.retard.n).toBe(0);
    expect(e.encaisse).toMatchObject({ total: '0.000', reglements: 0 });
    // Un virement de 20, puis un chèque de 27,410 : réglée.
    await regler(a.cle, [{ id: 'v1', date: jour, amount: 20, method: 'virement' }]);
    e = await lire();
    expect(e.doivent).toMatchObject([{ reste: '27.410', paye: '20.000', statut: 'partielle' }]);
    await regler(a.cle, [{ id: 'v1', date: jour, amount: 20, method: 'virement' }, { id: 'c1', date: jour, amount: { '~n': '27.41' }, method: 'cheque' }]);
    e = await lire();
    expect(e.doivent).toEqual([]);
    expect(e.previsions && somme(e.previsions)).toEqual({ montant: 0, n: 0 });
    expect(e.encaisse).toMatchObject({ total: '47.410', reglements: 2, rembourse: '0.000', parMoyen: { konnect: '0.000', virement: '20.000', cheque: '27.410', autre: '0.000' } });
    expect(e.recus.lignes.map((r) => [r.moyen, r.montant])).toEqual(expect.arrayContaining([['virement', '20.000'], ['cheque', '27.410']]));
    // Deux chemins, un chiffre : l'écran, la tuile de l'accueil, la somme comptée à part.
    expect(await tuile()).toEqual({ mesure: true, montant: '47.410', devise: 'TND', reglements: 2 });
    expect(e.encaisse?.total).toBe(await encaisseParLaBase(mois));
  });

  it('Konnect seulement avec la preuve du prestataire ; un règlement d\'un autre mois n\'entre pas dans celui-ci', async () => {
    const b = await factureEmise('Salon Konnect');
    const avant = (await lire()).encaisse?.total;
    // Le paiement en ligne que le serveur a prouvé (0047) : le règlement porte son identifiant, la demande sa preuve.
    const idLigne = randomUUID();
    await regler(b.cle, [{ id: `en-ligne-${idLigne}`, date: jour, amount: { '~n': '47.41' }, method: 'en_ligne', reference: 'Konnect ref-1' }]);
    const piece = (await admin.query("select id from ventes.piece where entreprise = $1 and ref_v10 = $2 and type = 'facture'", [editeur, b.cle])).rows[0].id;
    let e = await lire();
    // Sans la preuve, ce n'est pas Konnect : un « en ligne » qu'on ne peut pas croire.
    expect(e.recus.lignes.find((r) => r.entreprise.id === b.id)).toMatchObject({ moyen: 'autre', konnect: null });
    await admin.query(`insert into ventes.paiement_en_ligne (id, entreprise, piece, prestataire, montant, devise, retour_empreinte, cree_le, ref, statut, prouve_le, encaisse_le, reglement_v10)
      values ($1, $2, $3, 'konnect', 47410, 'TND', 'empreinte', now(), $4, 'encaisse', now(), now(), $5)`, [idLigne, editeur, piece, `ref-${idLigne}`, `en-ligne-${idLigne}`]);
    e = await lire();
    expect(e.recus.lignes.find((r) => r.entreprise.id === b.id)).toMatchObject({ moyen: 'konnect', konnect: { prouveLe: expect.any(String) } });
    expect(e.encaisse?.parMoyen.konnect).toBe('47.410');
    // La preuve d'un paiement en ligne ne vaut que pour SON règlement : jamais un virement « confirmé par Konnect ».
    expect(e.recus.lignes.filter((r) => r.moyen !== 'konnect').map((r) => r.konnect)).toEqual(e.recus.lignes.filter((r) => r.moyen !== 'konnect').map(() => null));
    expect(e.recus.lignes.filter((r) => r.moyen !== 'konnect').length).toBeGreaterThan(0);
    // Un règlement daté du mois d'avant : il compte dans SON mois, pas dans celui-ci.
    const c = await factureEmise('Garage Mois Passé');
    await regler(c.cle, [{ id: 'm1', date: `${moisAvant}-15`, amount: { '~n': '47.41' }, method: 'virement' }]);
    e = await lire();
    expect(e.recus.lignes.some((r) => r.entreprise.id === c.id)).toBe(false);
    expect(e.encaisse?.total).toBe((Number(avant) + 47.41).toFixed(3));
    const passe = await lire(moisAvant);
    expect(passe).toMatchObject({ mois: moisAvant, courant: false });
    expect(passe.recus.lignes.map((r) => r.entreprise.id)).toContain(c.id);
    expect(passe.encaisse?.total).toBe(await encaisseParLaBase(moisAvant));
    // Un mois à venir, ou illisible : celui d'aujourd'hui.
    expect((await lire(moisVoisin(mois, 2))).mois).toBe(mois);
    expect((await lire('2026-13')).mois).toBe(mois);
  });

  it('trop payé : il se dit, jusqu\'au remboursement ; le remboursement se déduit de l\'encaissé et se dit à part', async () => {
    const d = await factureEmise('Pharmacie Trop Payé');
    await regler(d.cle, [{ id: 't1', date: jour, amount: { '~n': '52.41' }, method: 'virement' }]);
    let e = await lire();
    expect(e.trop).toMatchObject([{ entreprise: { id: d.id }, trop: '5.000', annulee: false }]);
    const avant = Number(e.encaisse?.total);
    await regler(d.cle, [{ id: 't1', date: jour, amount: { '~n': '52.41' }, method: 'virement' }, { id: 't2', date: jour, amount: -5, method: 'virement' }]);
    e = await lire();
    expect(e.trop).toEqual([]);
    expect(e.encaisse?.rembourse).toBe('5.000');
    expect(Number(e.encaisse?.total)).toBeCloseTo(avant - 5, 3);
    expect(e.encaisse?.total).toBe(await encaisseParLaBase(mois));
  });

  it('une facture préparée et pas encore émise attend dans SkanFact : elle ne doit rien encore', async () => {
    const b = await abonnee('Librairie Brouillon', 4);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const e = await lire();
    expect(e.aEmettre.map((x) => x.entreprise.id)).toContain(b.id);
    expect(e.doivent.map((x) => x.entreprise.id)).not.toContain(b.id);
  });
});

describe('les coûts du mois', () => {
  // Deux mois en arrière : un mois que les autres essais (l'écran, à la souris) ne touchent pas.
  const m = moisVoisin(mois, -2);
  it('chaque case refusée se nomme ; la base revérifie', async () => {
    const poser = (corps: Record<string, unknown>) => appeler('POST', '/console/paiements/couts', direction.console, { mois: m, libelle: 'Serveurs en Tunisie', montant: '1450,500', dApres: 'Facture Hébergeur 118', ...corps });
    expect((await poser({ libelle: 'S' })).corps).toMatchObject({ champ: 'libelle' });
    expect((await poser({ montant: '12,3456' })).corps).toMatchObject({ champ: 'montant' });
    expect((await poser({ montant: '0' })).corps).toMatchObject({ champ: 'montant' });
    expect((await poser({ montant: '-4' })).corps).toMatchObject({ champ: 'montant' });
    expect((await poser({ dApres: 'F' })).corps).toMatchObject({ champ: 'dApres' });
    expect((await poser({ mois: moisVoisin(mois, 1) })).corps).toMatchObject({ champ: 'mois' });
    expect((await poser({ mois: '2026-13' })).corps).toMatchObject({ champ: 'mois' });
    // La base, appelée sans le serveur : un mois à venir, un montant nul, sans facture reçue.
    const base = (sql: string) => admin.query(`select set_config('app.session_console', '', false); ${sql}`).then(() => null, (x: Error) => x.message);
    expect(await base(`select plateforme.console_ajouter_cout('${m}-01', 'SMS', 10, 'Facture', '${jour}')`)).toMatch(/console/);
    expect((await lire(m)).couts.lignes).toEqual([]);
  });

  it('saisi d\'après la facture reçue (le motif du journal), retiré avec un motif, jamais modifié ; ce qui reste suit', async () => {
    const vide = await lire(m);
    // Sans coût saisi, « ce qui reste » ne se dit pas : ce serait l'encaissé, un zéro qui passerait pour une mesure.
    expect(vide.couts).toMatchObject({ lignes: [], total: '0.000', reste: null });
    const r = await appeler('POST', '/console/paiements/couts', direction.console, { mois: m, libelle: '  Serveurs en Tunisie ', montant: '1 450,5', dApres: 'Facture Hébergeur TN n° 118' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect((await appeler('POST', '/console/paiements/couts', direction.console, { mois: m, libelle: 'SMS', montant: '186', dApres: 'Facture WinSMS 2026-77' })).statut).toBe(201);
    let e = await lire(m);
    expect(e.couts.lignes.map((c) => [c.libelle, c.montant, c.dApres])).toEqual([['Serveurs en Tunisie', '1450.500', 'Facture Hébergeur TN n° 118'], ['SMS', '186.000', 'Facture WinSMS 2026-77']]);
    expect(e.couts.total).toBe('1636.500');
    const encaisse = Math.round(Number(e.encaisse?.total) * 1000);
    expect(e.couts.reste).toBe(((encaisse - 1636500) / 1000).toFixed(3));
    const g = (await admin.query("select motif, apres from plateforme.geste_console where geste = 'paiements.cout_ajoute' and apres->>'libelle' = 'Serveurs en Tunisie' and apres->>'mois' = $1", [m])).rows;
    expect(g).toEqual([{ motif: 'Facture Hébergeur TN n° 118', apres: { mois: m, libelle: 'Serveurs en Tunisie', montant: '1450.500' } }]);
    // Jamais modifié, jamais effacé : la base le refuse, même à qui la tient.
    const id = e.couts.lignes[0]?.id ?? '';
    await expect(admin.query('update plateforme.cout_du_mois set montant = 1 where id = $1', [id])).rejects.toThrow(/ne se modifie pas/);
    await expect(admin.query('delete from plateforme.cout_du_mois where id = $1', [id])).rejects.toThrow(/ne se modifie pas/);
    // Retirer : avec un motif, une fois.
    expect((await appeler('POST', `/console/paiements/couts/${id}/retirer`, direction.console, { motif: '' })).statut).toBe(400);
    expect((await appeler('POST', `/console/paiements/couts/${id}/retirer`, support.console, { motif: 'Mauvais montant' })).statut).toBe(403);
    expect((await appeler('POST', `/console/paiements/couts/${id}/retirer`, direction.console, { motif: 'Mauvais montant' })).statut).toBe(200);
    const encore = await appeler('POST', `/console/paiements/couts/${id}/retirer`, direction.console, { motif: 'Mauvais montant' });
    expect(encore.statut).toBe(403);
    expect(String(encore.corps.motif)).toMatch(/déjà retiré/);
    e = await lire(m);
    expect(e.couts.total).toBe('186.000');
    expect(e.couts.lignes.find((c) => c.id === id)?.retireLe).toEqual(expect.any(String));
    const gr = (await admin.query("select motif, avant, apres from plateforme.geste_console where geste = 'paiements.cout_retire' and avant->>'mois' = $1", [m])).rows;
    expect(gr).toEqual([{ motif: 'Mauvais montant', avant: { mois: m, libelle: 'Serveurs en Tunisie', montant: '1450.500' }, apres: null }]);
  });
});

describe('les règles, pures', () => {
  const recu = (montant: bigint, moyen: Recu['moyen'], devise = 'TND'): Recu => ({ id: String(montant), date: '2026-10-01', montant, devise, decimales: 3, mode: moyen, moyen,
    reference: null, numero: null, entreprise: { id: 'e', nom: 'E' }, noteLe: '', konnect: null, ecran: '' });
  it('une autre devise ne s\'additionne jamais au dinar : elle se dit à part', () => {
    const e = encaisse([recu(1000n, 'virement'), recu(2500n, 'cheque', 'EUR'), recu(-300n, 'virement')], { entreprise: 'x', raisonSociale: 'X', devise: 'TND', decimales: 3 });
    expect(e).toMatchObject({ total: 700n, rembourse: 300n, reglements: 1, autresDevises: [{ devise: 'EUR', total: 2500n }] });
  });
  it('« en ligne » sans preuve n\'est pas Konnect ; les autres moyens de la v10 se rangent dans « autrement »', () => {
    expect(moyenDe('en_ligne', true)).toBe('konnect');
    expect(moyenDe('en_ligne', false)).toBe('autre');
    expect(['virement', 'cheque', 'especes', 'traite', 'carte', 'autre'].map((m) => moyenDe(m, false))).toEqual(['virement', 'cheque', 'autre', 'autre', 'autre', 'autre']);
  });
  it('trop payé, et annulée réglée quand même ; une facture soldée n\'est nulle part', () => {
    const o = (net: bigint, avoirs: bigint[], reglements: bigint[], echeance = '2026-10-10', timbre = 0n): Ouverte => ({ piece: `p${net}${reglements.join()}`, numero: null, echeance, debut: '2026-10-01',
      fin: '2026-10-31', devise: 'TND', decimales: 3, net, avoirs, reglements, entreprise: { id: 'e', nom: 'E' }, ecran: '', timbre });
    const r = ouvertes([o(47410n, [], [50000n]), o(47410n, [47410n], [47410n]), o(47410n, [], [47410n]), o(47410n, [11900n], [], '2026-10-12')], [], '2026-10-14');
    expect(r.trop.map((t) => [t.trop, t.annulee])).toEqual([['2.590', false], ['47.410', true]]);
    expect(r.doivent).toMatchObject([{ reste: '35.510', credite: '11.900', retard: 2 }]);
    // Un avoir qui annule tout, sauf le timbre d'un dinar (0114) : la facture réglée en entier est annulée, et le trop est
    // tout sauf le timbre. Il manquerait un millime de plus à l'avoir : elle ne l'est pas.
    const t = ouvertes([o(48410n, [47410n], [48410n], '2026-10-10', 1000n), o(48410n, [47409n], [48410n], '2026-10-10', 1000n)], [], '2026-10-14');
    expect(t.trop.map((x) => [x.trop, x.annulee])).toEqual([['47.410', true], ['47.409', false]]);
    expect(annuleeParSesAvoirs(48410n, 47410n, 1000n)).toBe(true);
    expect(annuleeParSesAvoirs(48410n, 0n, 48410n)).toBe(false);
  });
  it('ce qui reste ne se dit qu\'avec des coûts saisis, et en dinars', () => {
    const c = { id: 'c', libelle: 'SMS', montant: 186000n, dApres: 'F', saisiLe: '', saisiPar: null, retireLe: null, retirePar: null };
    const e = encaisse([recu(1000000n, 'virement')], { entreprise: 'x', raisonSociale: 'X', devise: 'TND', decimales: 3 });
    expect(couts([], e).reste).toBeNull();
    expect(couts([{ ...c, retireLe: 'hier' }], e).reste).toBeNull();
    expect(couts([c], e).reste).toBe('814.000');
    expect(couts([c], { ...e, devise: 'EUR' }).reste).toBeNull();
    // Provisoire (0114) : le mois court encore, ou un coût du mois d'avant n'est pas saisi ce mois-ci (par son nom, sans les
    // accents ni la casse) ; un coût retiré le mois d'avant ne manque pas.
    expect(couts([c], e).provisoire).toBe(false);
    expect(couts([c], e, { courant: true }).provisoire).toBe(true);
    const avant = [{ ...c, id: 'a', libelle: 'sms ' }, { ...c, id: 'b', libelle: 'Hébergement' }, { ...c, id: 'r', libelle: 'Bureau', retireLe: 'x' }];
    expect(couts([c], e, { moisAvant: avant })).toMatchObject({ provisoire: true, absents: ['Hébergement'], n: 1 });
    expect(couts([c, { ...c, id: 'h', libelle: 'hebergement' }], e, { moisAvant: avant })).toMatchObject({ provisoire: false, absents: [] });
    expect(couts([], e, { courant: true }).provisoire).toBe(false);
    expect(moisAvantDe('2026-01')).toBe('2025-12');
    expect(moisAvantDe('2026-10')).toBe('2026-09');
  });
  it('un mois demandé : réel, pas à venir', () => {
    expect(moisDemande('2026-09', '2026-10-14')).toBe('2026-09');
    expect(moisDemande('2026-11', '2026-10-14')).toBe('2026-10');
    expect(moisDemande('2026-00', '2026-10-14')).toBe('2026-10');
    expect(moisDemande(undefined, '2026-10-14')).toBe('2026-10');
  });
});
