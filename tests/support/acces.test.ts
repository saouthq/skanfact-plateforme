// L'accès du support au dossier d'un client (Support S2 ; serveur/support, serveur/console ; 0096 ; docs/support.md), par
// l'API. Ce que le serveur garantit :
//   - la console DEMANDE l'accès, avec son motif (la direction et le support ; jamais la technique) ; une seule demande en
//     cours ou un seul accès actif à la fois, par membre et par client ;
//   - seul le propriétaire ou un administrateur de l'entreprise l'accorde (une à quarante-huit heures), le refuse, ou le
//     retire ; ni un autre membre, ni la console ;
//   - pendant qu'il court, celui qui l'a demandé — lui seul — lit le dossier en LECTURE, ce que lit un membre « Lecture »
//     (jamais la paie), rien d'écrivable ; chaque page lue est tracée par son nom, et l'entreprise relit ces lectures ;
//   - refusé, retiré, rendu ou échu : la lecture suivante est refusée, et le refus dit pourquoi ;
//   - les gestes entrent aux deux journaux : celui de la console (demander, rendre), celui de l'entreprise (accorder,
//     refuser, retirer).

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
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { lireAcces, minutesRestantes, monAcces } from '../../serveur/support/acces.ts';
import { declarerGestesSupport } from '../../serveur/support/gestes.ts';
import { routesSupport } from '../../serveur/support/routes.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { filtrer } from '../../serveur/v10/droits.ts';
import { permet } from '../../serveur/v10/droits.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acces-')), 'veille.json');
let app: FastifyInstance;

type Corps = Record<string, unknown> & { id: string; motif: string };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `acces-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Essai${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  return { email, jeton };
}
type Personne = Awaited<ReturnType<typeof personne>>;
// Une entreprise et son dossier : sa fiche, un client, une pièce, et un bulletin de paie (que le support ne lit jamais).
async function entreprise(nom: string) {
  const p = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
  const objets: [string, string, number | null, unknown][] = [
    ['_racine', 'company', null, { name: nom }],
    ['clients', 'c1', 0, { id: 'c1', name: 'Hôtel Dar El Marsa' }],
    ['documents', 'd1', 0, { id: 'd1', type: 'devis', clientId: 'c1', number: 'DEV-2026-001' }],
    ['payslips', 'b1', 0, { id: 'b1', employeeId: 'e1', net: 1200 }],
  ];
  for (const [collection, cle, rang, contenu] of objets) {
    await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)', [ent, collection, cle, rang, JSON.stringify(contenu)]);
  }
  return { ent, p };
}
async function inviter(ent: string, p: Personne, roles: string[]) {
  const c = await personne('Walid');
  const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, p.jeton, { email: c.email, roles })).corps.jeton);
  expect((await appeler('POST', '/invitations/accepter', c.jeton, { jeton: inv })).statut).toBe(200);
  return c;
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `equipe-acces-${prenom.toLowerCase()}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const qui = await quiEst(ctx, String(c.corps.jeton));
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { jeton: String(k.corps.jeton) };
}
type Console = { jeton: string };
const demander = (m: Console, ent: string, motif = 'Vérifier la TVA de septembre avec toi', demande: string | null = null) =>
  appeler('POST', '/console/support/acces', m.jeton, { entreprise: ent, demande, motif });
const lireDossier = (m: Console, acces: string, page = 'factures') => appeler('GET', `/console/support/acces/${acces}/dossier?page=${page}`, m.jeton);
const duClient = async (ent: string, p: Personne) => lireAcces((await appeler('GET', `/entreprises/${ent}/acces-support`, p.jeton)).corps.acces);
const repondre = (ent: string, p: Personne, acces: string, accorder: boolean, heures: number | null = null) =>
  appeler('POST', `/entreprises/${ent}/acces-support/${acces}/repondre`, p.jeton, { accorder, heures });

let direction: Console;
let support: Console;
let technique: Console;

beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille }), ...routesSupport(ctx), ...routesAbonnement(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  technique = await membre('Sami', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('demander, accorder, lire en lecture', () => {
  it('la console demande avec son motif ; l\'entreprise accorde ; celui qui a demandé lit ce que lit un membre « Lecture », chaque page tracée', async () => {
    const { ent, p } = await entreprise('Menuiserie Ben Salah');
    const d = await demander(support, ent);
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    const id = d.corps.id;
    // Pas encore accordé : la lecture est refusée, et le refus le dit.
    const avant = await lireDossier(support, id);
    expect(avant.statut).toBe(403);
    expect(avant.corps.motif).toMatch(/n'a pas encore accordé/);
    // L'entreprise voit la demande : qui (son prénom), pourquoi, quand.
    const [vue] = await duClient(ent, p);
    expect(vue).toMatchObject({ id, etat: 'demande', demandeur: 'Karim', motif: 'Vérifier la TVA de septembre avec toi', aMoi: false, fin: null });
    // Accordé pour 24 heures : le support lit.
    expect((await repondre(ent, p, id, true, 24)).statut).toBe(200);
    const lu = await lireDossier(support, id, 'factures');
    expect(lu.statut, JSON.stringify(lu.corps)).toBe(200);
    const objets = lu.corps.objets as { collection: string; cle: string }[];
    // Ce que lit un membre « Lecture » : la fiche, les clients, les pièces — jamais la paie.
    expect(permet(['lecture'], 'paie.dossier.voir', false)).toBe(false);
    expect(objets.map((o) => `${o.collection}/${o.cle}`).sort()).toEqual(['_racine/company', 'clients/c1', 'documents/d1']);
    const tous = (await admin.query('select collection, cle from socle.dossier_v10 where entreprise = $1', [ent])).rows as { collection: string; cle: string }[];
    expect(objets.length).toBe(filtrer(['lecture'], tous).objets.length);
    // Rien d'écrivable : l'écran ne renvoie rien, quoi que le rôle « Lecture » permette un jour.
    expect(lu.corps.droits).toMatchObject({ ecrivables: [], tout: false, responsable: false, caisse: false });
    // Le nom que la console montre (la raison sociale), pour la bande de la lecture.
    expect(lu.corps).toMatchObject({ entreprise: ent, nom: 'Menuiserie Ben Salah', lecture: true });
    // Les pages lues : « factures » une fois (relue dans la minute : pas deux traces), puis « clients ».
    await lireDossier(support, id, 'factures');
    expect((await appeler('POST', `/console/support/acces/${id}/page`, support.jeton, { page: 'clients' })).statut).toBe(200);
    expect((await appeler('POST', `/console/support/acces/${id}/page`, support.jeton, { page: 'Clients/../x' })).statut).toBe(400);
    const [apres] = await duClient(ent, p);
    expect(apres).toMatchObject({ etat: 'actif', heures: 24, accordePar: expect.stringMatching(/^Nadia/) });
    expect(apres?.lectures.map((l) => l.page)).toEqual(['factures', 'clients']);
    expect(minutesRestantes(apres ?? { etat: 'demande', fin: null }, horloge)).toBeGreaterThan(23 * 60);
    // La console relit son accès : le sien, qui court.
    const cote = lireAcces((await appeler('GET', `/console/support/acces?client=${ent}`, support.jeton)).corps.acces);
    expect(monAcces(cote)).toMatchObject({ id, etat: 'actif', demandeur: 'Karim Équipe', aMoi: true });
    // Un autre membre de l'équipe ne lit pas par l'accès d'un collègue, même la direction.
    const autre = await lireDossier(direction, id);
    expect(autre.statut).toBe(403);
    expect(autre.corps.motif).toMatch(/n'est pas le tien/);
    expect(monAcces(lireAcces((await appeler('GET', `/console/support/acces?client=${ent}`, direction.jeton)).corps.acces))).toBeNull();
    // Échu : ses heures sont passées, personne n'a eu à le fermer.
    await admin.query(`update plateforme.acces_support set accorde_le = accorde_le - interval '25 hours', fin = fin - interval '25 hours' where id = $1`, [id]);
    const echu = await lireDossier(support, id);
    expect(echu.statut).toBe(403);
    expect(echu.corps.motif).toMatch(/ses heures sont passées/);
    expect((await duClient(ent, p))[0]?.etat).toBe('echu');
    // Les deux journaux : la console garde la demande et son motif ; l'entreprise, l'accord et ses heures.
    const jc = (await admin.query('select geste, motif from plateforme.geste_console where entreprise = $1 order by le, id', [ent])).rows;
    expect(jc).toEqual([{ geste: 'support.acces_demander', motif: 'Vérifier la TVA de septembre avec toi' }]);
    const je = (await admin.query(`select geste, objet_type, apres from socle.audit where entreprise = $1 and geste = 'socle.support.autoriser'`, [ent])).rows;
    expect(je).toEqual([{ geste: 'socle.support.autoriser', objet_type: 'acces_support', apres: { etat: 'accorde', heures: 24 } }]);
  });
});

describe('qui décide, et ce qui ferme l\'accès', () => {
  it('le propriétaire ou un administrateur ; ni un autre membre, ni la console ; la technique ne demande rien', async () => {
    const { ent, p } = await entreprise('Boulangerie Ennour');
    const id = (await demander(support, ent)).corps.id;
    const commercial = await inviter(ent, p, ['commercial']);
    expect((await appeler('GET', `/entreprises/${ent}/acces-support`, commercial.jeton)).statut).toBe(403);
    expect((await repondre(ent, commercial, id, true, 48)).statut).toBe(403);
    const administratrice = await inviter(ent, p, ['administrateur']);
    expect((await duClient(ent, administratrice)).map((a) => a.id)).toEqual([id]);
    // La console n'accorde rien : ces routes sont celles d'une personne de l'entreprise.
    expect((await appeler('POST', `/entreprises/${ent}/acces-support/${id}/repondre`, support.jeton, { accorder: true, heures: 2 })).statut).toBe(401);
    expect((await demander(technique, ent)).statut).toBe(403);
    expect((await appeler('GET', `/console/support/acces?client=${ent}`, technique.jeton)).statut).toBe(403);
    // Une durée hors des bornes, ou sans durée : refusé en le nommant.
    expect((await repondre(ent, administratrice, id, true, 49)).statut).toBe(400);
    const sans = await repondre(ent, administratrice, id, true, null);
    expect(sans.statut).toBe(400);
    expect(sans.corps.motif).toMatch(/une à quarante-huit/);
    // L'administratrice accorde : la trace est à son nom.
    expect((await repondre(ent, administratrice, id, true, 2)).statut).toBe(200);
    expect((await duClient(ent, p))[0]).toMatchObject({ etat: 'actif', heures: 2, accordePar: expect.stringMatching(/^Walid/) });
    // Déjà répondu : une seconde réponse est refusée.
    expect((await repondre(ent, p, id, false)).corps.motif).toMatch(/a déjà sa réponse/);
  });

  it('refusé, retiré, rendu : la lecture suivante est refusée en disant pourquoi ; une seule demande en cours à la fois', async () => {
    const { ent, p } = await entreprise('Garage du Lac');
    // Une demande de support d'une AUTRE entreprise ne l'explique pas.
    const ailleurs = await entreprise('Autre SARL');
    const sienne = String((await appeler('POST', `/entreprises/${ailleurs.ent}/support`, ailleurs.p.jeton, { sujet: 'Mon logo', texte: 'Il est flou.' })).corps.id);
    expect((await demander(support, ent, 'Voir le logo', sienne)).corps.motif).toMatch(/n'est pas celle de cette entreprise/);
    // Refusé.
    const a = (await demander(support, ent)).corps.id;
    expect((await demander(support, ent)).corps.motif).toMatch(/déjà une demande en cours/);
    expect((await repondre(ent, p, a, false)).statut).toBe(200);
    expect((await lireDossier(support, a)).corps.motif).toMatch(/a refusé/);
    // Retiré : accordé, puis retiré par l'entreprise.
    const b = (await demander(support, ent, 'Revoir le rapprochement')).corps.id;
    await repondre(ent, p, b, true, 48);
    expect((await lireDossier(support, b)).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/acces-support/${b}/retirer`, p.jeton)).statut).toBe(200);
    expect((await lireDossier(support, b)).corps.motif).toMatch(/a retiré/);
    expect((await appeler('POST', `/entreprises/${ent}/acces-support/${b}/retirer`, p.jeton)).corps.motif).toMatch(/ne court plus/);
    // Rendu par le support (« J'ai fini ») : fermé ; le rendre deux fois est refusé.
    const c = (await demander(support, ent, 'Un dernier regard')).corps.id;
    await repondre(ent, p, c, true, 2);
    expect((await appeler('POST', `/console/support/acces/${c}/clore`, direction.jeton)).statut).toBe(200);
    expect((await lireDossier(support, c)).corps.motif).toMatch(/est fermé/);
    expect((await appeler('POST', `/console/support/acces/${c}/clore`, support.jeton)).corps.motif).toMatch(/déjà fermé/);
    const etats = (await duClient(ent, p)).map((x) => [x.id, x.etat]);
    expect(etats).toEqual([[c, 'fini'], [b, 'retire'], [a, 'refuse']]);
    // Le journal de l'entreprise : le refus, l'accord, le retrait, l'accord — jamais le motif ni une page.
    const je = (await admin.query(`select apres from socle.audit where entreprise = $1 and geste = 'socle.support.autoriser' order by instant, id`, [ent])).rows.map((r) => r.apres);
    expect(je).toEqual([{ etat: 'refuse' }, { etat: 'accorde', heures: 48 }, { etat: 'retire' }, { etat: 'accorde', heures: 2 }]);
    // Le journal de la console : trois demandes, un rendu (par la direction).
    const jc = (await admin.query('select geste from plateforme.geste_console where entreprise = $1 order by le, id', [ent])).rows.map((r) => r.geste);
    expect(jc).toEqual(['support.acces_demander', 'support.acces_demander', 'support.acces_demander', 'support.acces_clore']);
  });

  it('une page lue ne se modifie pas et ne s\'efface pas : c\'est la trace que l\'entreprise relit', async () => {
    const { ent, p } = await entreprise('Pharmacie Centrale');
    const id = (await demander(support, ent)).corps.id;
    await repondre(ent, p, id, true, 2);
    await lireDossier(support, id, 'accueil');
    await expect(admin.query('update plateforme.lecture_support set page = $2 where acces = $1', [id, 'autre'])).rejects.toThrow(/ne se modifie pas/);
    await expect(admin.query('delete from plateforme.lecture_support where acces = $1', [id])).rejects.toThrow(/ne se modifie pas/);
  });
});

describe('ce que la base rend, lu prudemment', () => {
  it('une ligne illisible ne s\'affiche pas ; un accès « actif » sans sa fin n\'est pas un accès qui court', () => {
    const bon = { id: 'a', entreprise: 'e', etat: 'actif', demandeur: 'Karim', aMoi: true, motif: 'TVA', demandeLe: '2026-10-13T08:00:00Z',
      heures: 2, accordeLe: '2026-10-13T09:00:00Z', fin: '2026-10-13T11:00:00Z', lectures: [{ page: 'factures', le: '2026-10-13T09:05:00Z' }, { page: '../x', le: '2026-10-13T09:06:00Z' }] };
    const lus = lireAcces([bon, { ...bon, id: 'b', fin: null }, { ...bon, id: 'c', etat: 'ouvert' }, { ...bon, id: 'd', heures: 99, etat: 'demande' }, 'texte']);
    expect(lus.map((a) => a.id)).toEqual(['a', 'd']);
    expect(lus[0]?.lectures).toEqual([{ page: 'factures', le: '2026-10-13T09:05:00Z' }]);
    expect(lus[1]?.heures).toBeNull();
    expect(minutesRestantes(lus[0] ?? bon as never, new Date('2026-10-13T10:30:30Z'))).toBe(29);
    expect(minutesRestantes(lus[0] ?? bon as never, new Date('2026-10-13T12:00:00Z'))).toBe(0);
    expect(minutesRestantes({ etat: 'demande', fin: null }, new Date())).toBeNull();
    expect(lireAcces(null)).toEqual([]);
  });
});
