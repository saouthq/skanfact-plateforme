// Des chiffres et des accès justes (1.21.0 ; base 0114 ; docs/console.md C37 ; l'audit du 14/10/2026, deuxième partie) :
//   - « a servi » n'a qu'une définition : une pièce du dossier, ou une pièce faite par le serveur ou l'API ;
//   - la dernière activité se compte PAR ENTREPRISE, jamais celle d'une personne ailleurs ;
//   - une relecture automatique de la console ne prolonge pas la session ;
//   - la direction ferme la session ou oublie l'appareil d'un membre, sans le retirer ; chacun le fait pour lui-même ;
//   - les demandes closes du support se lisent par pages ;
//   - le journal se filtre par sorte, période, mot, gestes réservés à la direction ; il montre le système seul ; le support y
//     lit ses propres gestes ; ses chiffres comptent les listes qu'ils ouvrent.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { aServi } from '../../serveur/console/decider.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: { ...entetes, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) }, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0, matricules = 0;
async function personne(prenom: string) {
  const email = `justes-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id), nom: `${prenom} ${n}` };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  return { ...p, secret: secret ?? '', role };
}
const code = (secret: string) => codeTotp(depuisBase32(secret), horloge.getTime());
async function entrer(m: { email: string; secret: string }, nom = 'Bureau') {
  const r = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom, type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: code(m.secret) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { jeton: String(c.corps.jeton), appareil: String(c.corps.appareil) };
}
async function entreprise(nom: string, proprio?: Awaited<ReturnType<typeof personne>>) {
  const p = proprio ?? await personne('proprio');
  const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom, matriculeFiscal: `${String(5_300_000 + ++matricules).slice(-7)}C/A/M/000` });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  return { ent: String(cree.corps.id), proprio: p };
}
type Ligne = { id: string; raisonSociale: string; pieces: number; derniereActivite: string | null };
const laFiche = async (jeton: string, ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, jeton)).corps;

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let jD = '', jS = '';

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  jD = (await entrer(direction)).jeton;
  jS = (await entrer(support)).jeton;
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('« a servi » : une seule définition (0114)', () => {
  it('une pièce faite par le serveur ou l\'API compte comme une pièce du dossier ; la fiche et la liste disent le même nombre', async () => {
    const { ent, proprio } = await entreprise('Atelier Par L\'API');
    expect((await admin.query('select plateforme.pieces_creees($1)::int n', [ent])).rows[0].n).toBe(0);
    // Une vente faite par le serveur, sans pièce du dossier derrière (ref_v10 vide) : elle a servi.
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into ventes.piece (entreprise, type, statut, tiers, date_piece, cree_par) values ($1, 'facture', 'brouillon', gen_random_uuid(), current_date, $2)`, [ent, proprio.id]);
    await admin.query('commit');
    expect((await admin.query('select plateforme.pieces_creees($1)::int n', [ent])).rows[0].n).toBe(1);
    const f = await laFiche(jD, ent);
    expect((f.comptes as { piecesCreees: number }).piecesCreees).toBe(1);
    expect(aServi({ pieces: 1 })).toBe(true);
    expect(aServi({ pieces: 0 })).toBe(false);
  });
});

describe('la dernière activité, par entreprise (0114)', () => {
  it('travailler dans une entreprise la marque, elle seule ; la fiche dit qui y a travaillé, et quand', async () => {
    const p = await personne('deux-maisons');
    const a = await entreprise('Maison Active', p);
    const b = await entreprise('Maison Tranquille', p);
    // Rien encore : la création n'est pas une requête sur une route de l'entreprise.
    await admin.query('delete from socle.activite where entreprise in ($1, $2)', [a.ent, b.ent]);
    expect((await appeler('GET', `/entreprises/${a.ent}/equipe`, p.jeton)).statut).toBe(200);
    // La note part dans sa propre transaction : on l'attend.
    await expect.poll(async () => (await admin.query('select count(*)::int n from socle.activite where entreprise = $1', [a.ent])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int n from socle.activite where entreprise = $1', [b.ent])).rows[0].n).toBe(0);
    const fa = await laFiche(jD, a.ent), fb = await laFiche(jD, b.ent);
    expect(fa.derniereActivite).toBeTruthy();
    expect(fb.derniereActivite).toBeNull();
    // Sa dernière connexion, elle, est la même partout ; son dernier geste ICI ne l'est pas.
    const ma = (fa.membres as { email: string; derniereIci: string | null; derniereConnexion: string | null }[]).find((m) => m.email === p.email);
    const mb = (fb.membres as { email: string; derniereIci: string | null; derniereConnexion: string | null }[]).find((m) => m.email === p.email);
    expect(ma?.derniereIci).toBeTruthy();
    expect(mb?.derniereIci).toBeNull();
    expect(mb?.derniereConnexion).toBeTruthy();
    // La liste le dit pareil.
    const liste = (await appeler('GET', `/console/entreprises?q=${encodeURIComponent('Maison')}&limite=200`, jD)).corps.lignes as { societes: Ligne[] }[];
    const societes = liste.flatMap((o) => o.societes);
    expect(societes.find((s) => s.id === a.ent)?.derniereActivite).toBeTruthy();
    expect(societes.find((s) => s.id === b.ent)?.derniereActivite).toBeNull();
  });

  it('seul le serveur la note, au nom de la personne, dans une entreprise qu\'elle voit ; personne ne lit celle des autres', async () => {
    const intrus = await personne('intrus');
    const { ent } = await entreprise('Maison Gardée');
    const avant = (await admin.query('select count(*)::int n from socle.activite where entreprise = $1', [ent])).rows[0].n;
    // Une requête refusée (une entreprise qu'il ne voit pas) ne note rien.
    expect((await appeler('GET', `/entreprises/${ent}/equipe`, intrus.jeton)).statut).toBe(404);
    await new Promise((r) => setTimeout(r, 200));
    expect((await admin.query('select count(*)::int n from socle.activite where entreprise = $1', [ent])).rows[0].n).toBe(avant);
    // Une requête refusée dans une entreprise qu'on VOIT (les rôles d'un membre qui n'existe pas) : rien non plus.
    const { ent: sienne, proprio } = await entreprise('Maison Refusée');
    await admin.query('delete from socle.activite where entreprise = $1', [sienne]);
    expect((await appeler('PUT', `/entreprises/${sienne}/membres/${sienne}/roles`, proprio.jeton, { roles: ['lecture'] })).statut).toBe(404);
    await new Promise((r) => setTimeout(r, 200));
    expect((await admin.query('select count(*)::int n from socle.activite where entreprise = $1', [sienne])).rows[0].n).toBe(0);
    // La base elle-même refuse de noter une entreprise que la personne ne voit pas, même appelée directement.
    await enTantQue(pool, intrus.id, (tx) => tx.query('select socle.noter_activite($1, now())', [ent]));
    expect((await admin.query('select count(*)::int n from socle.activite where entreprise = $1 and utilisateur = $2', [ent, intrus.id])).rows[0].n).toBe(0);
  });
});

describe('une relecture automatique ne prolonge pas la session (0114)', () => {
  it('« x-console-auto » lit la session sans repousser son inaction ; un geste humain la repousse', async () => {
    const m = await membre('lecteur', 'support');
    const { jeton } = await entrer(m, 'Poste qui se relit');
    const derniere = async () => (await admin.query('select derniere_activite d from plateforme.session_console where utilisateur = $1 and fermee_le is null order by ouverte_le desc limit 1', [m.id])).rows[0].d as Date;
    const t0 = await derniere();
    horloge = new Date(horloge.getTime() + 20 * 60_000);
    expect((await appeler('GET', '/console/moi', jeton, undefined, { 'x-console-auto': '1' })).statut).toBe(200);
    expect((await derniere()).getTime()).toBe(t0.getTime());
    // Cinquante minutes plus tard, toujours sans geste : l'heure d'inaction est passée, la session est finie.
    horloge = new Date(horloge.getTime() + 45 * 60_000);
    expect((await appeler('GET', '/console/moi', jeton, undefined, { 'x-console-auto': '1' })).statut).toBe(401);
    // Une autre session : un geste humain la repousse.
    const s2 = await entrer(m, 'Poste qui se relit');
    const t1 = await derniere();
    horloge = new Date(horloge.getTime() + 20 * 60_000);
    expect((await appeler('GET', '/console/moi', s2.jeton)).statut).toBe(200);
    expect((await derniere()).getTime()).toBe(t1.getTime() + 20 * 60_000);
    horloge = new Date();
  });
});

describe('fermer une session, oublier un appareil (0114, l\'audit F09)', () => {
  it('la direction ferme la session d\'un membre sans le retirer ; le support ne ferme que les siennes ; tout va au journal', async () => {
    const m = await membre('eloigne', 'support');
    const s = await entrer(m, 'Ordinateur du bureau');
    const lu = (await appeler('GET', `/console/equipe/${m.id}/appareils`, jD)).corps as { appareils: { id: string; nom: string; sessions: { id: string }[] }[] };
    const app1 = lu.appareils.find((a) => a.nom === 'Ordinateur du bureau');
    const session = app1?.sessions[0]?.id ?? '';
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    // Le support ne lit ni ne ferme les sessions d'un autre.
    expect((await appeler('GET', `/console/equipe/${m.id}/appareils`, jS)).statut).toBe(403);
    expect((await appeler('POST', `/console/equipe/sessions/${session}/fermer`, jS, { motif: 'je ferme la sienne' })).statut).toBe(403);
    // Sans motif : refusé, le champ nommé.
    const sans = await appeler('POST', `/console/equipe/sessions/${session}/fermer`, jD, { motif: ' ' });
    expect(sans.statut).toBe(400);
    expect(sans.corps.champ).toBe('motif');
    expect((await appeler('POST', `/console/equipe/sessions/${session}/fermer`, jD, { motif: 'ordinateur prêté, session à fermer' })).statut).toBe(200);
    expect((await appeler('GET', '/console/moi', s.jeton)).statut).toBe(401);
    // Il reste dans l'équipe : il rentre.
    const s2 = await entrer(m, 'Ordinateur du bureau');
    expect((await appeler('GET', '/console/moi', s2.jeton)).statut).toBe(200);
    // Une session déjà fermée ne se referme pas : le refus le dit.
    const encore = await appeler('POST', `/console/equipe/sessions/${session}/fermer`, jD, { motif: 'encore' });
    expect(encore.statut).toBe(403);
    expect(String(encore.corps.motif)).toMatch(/déjà fermée/);
    const j = (await appeler('GET', `/console/journal?qui=${direction.id}&q=${encodeURIComponent('ordinateur prêté')}`, jD)).corps.lignes as { geste: string; membre: { id: string } | null }[];
    expect(j).toEqual([expect.objectContaining({ geste: 'equipe.session_fermee', membre: expect.objectContaining({ id: m.id }) })]);
  });

  it('oublier un appareil ferme toutes ses sessions, de la console comme de l\'application ; chacun oublie les siens', async () => {
    const m = await membre('perdu', 'support');
    const s = await entrer(m, 'Téléphone perdu');
    const jS2 = s.jeton;
    const lu = (await appeler('GET', `/console/equipe/${m.id}/appareils`, jS2)).corps as { appareils: { id: string; nom: string }[] };
    const perdu = lu.appareils.find((a) => a.nom === 'Téléphone perdu')?.id ?? '';
    // Chacun voit et oublie les siens (le support aussi) ; son geste va au journal, avec son nom.
    expect((await appeler('POST', `/console/equipe/appareils/${perdu}/oublier`, jS2, { motif: 'téléphone perdu dans le taxi' })).statut).toBe(200);
    expect((await appeler('GET', '/console/moi', jS2)).statut).toBe(401);
    expect((await admin.query('select revoque_le is not null r from socle.appareil where id = $1', [perdu])).rows[0].r).toBe(true);
    expect((await admin.query('select count(*)::int n from plateforme.session_console where appareil = $1 and fermee_le is null', [perdu])).rows[0].n).toBe(0);
    const j = (await appeler('GET', `/console/journal?q=${encodeURIComponent('téléphone perdu dans le taxi')}`, jD)).corps.lignes as { geste: string; qui: { id: string }; role: string }[];
    expect(j).toEqual([expect.objectContaining({ geste: 'equipe.appareil_oublie', qui: expect.objectContaining({ id: m.id }), role: 'support' })]);
    // Un appareil d'un autre : le support ne l'oublie pas.
    const autre = (await appeler('GET', `/console/equipe/${direction.id}/appareils`, jD)).corps as { appareils: { id: string }[] };
    expect((await appeler('POST', `/console/equipe/appareils/${autre.appareils[0]?.id}/oublier`, jS, { motif: 'pas le mien' })).statut).toBe(403);
    // L'équipe dit ses codes de secours, ses appareils reconnus, ses gestes des trente jours.
    const eq = (await appeler('GET', '/console/equipe', jD)).corps.membres as { utilisateur: string; secours: number; reconnus: number; gestes30: number }[];
    expect(eq.find((x) => x.utilisateur === m.id)).toMatchObject({ reconnus: 0, gestes30: 1 });
    expect(typeof eq.find((x) => x.utilisateur === m.id)?.secours).toBe('number');
  });
});

describe('les demandes closes, par pages (0114, l\'audit F14)', () => {
  it('cinquante par page, toutes comptées ; plus de limite à cent', async () => {
    const { ent, proprio } = await entreprise('Maison Bavarde');
    for (let i = 0; i < 60; i++) {
      await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le, close_le, close_cote, close_par)
        values ($1, $2, 'application', $3, now() - make_interval(days => 10), now() - make_interval(mins => $4), 'client', $2)`, [ent, proprio.id, `Question numéro ${i}`, i]);
    }
    const p1 = (await appeler('GET', `/console/support?entreprise=${ent}`, jS)).corps as { closes: { sujet: string }[]; pagesCloses: { debut: number; total: number; parPage: number } };
    expect(p1.pagesCloses).toEqual({ debut: 0, total: 60, parPage: 50 });
    expect(p1.closes).toHaveLength(50);
    expect(p1.closes[0]?.sujet).toBe('Question numéro 0');
    const p2 = (await appeler('GET', `/console/support?entreprise=${ent}&closes=50`, jS)).corps as { closes: { sujet: string }[] };
    expect(p2.closes.map((c) => c.sujet)).toEqual(Array.from({ length: 10 }, (_, i) => `Question numéro ${50 + i}`));
  });
});

describe('le journal, exploitable (0114, l\'audit F33)', () => {
  it('par sorte, par période, par mot ; les gestes réservés à la direction ; ses chiffres comptent les listes qu\'ils ouvrent', async () => {
    const { ent } = await entreprise('Maison Du Journal');
    expect((await appeler('POST', `/console/entreprises/${ent}/abonnement/prolonger`, jS, { jours: 7, motif: 'essai prolongé pour le journal', ligne: (await laFiche(jS, ent)).ligne })).statut).toBe(200);
    const lire = async (q: string, j = jD) => (await appeler('GET', `/console/journal?${q}`, j)).corps as { lignes: { geste: string; sorte: string; reserve: boolean; qui: { id: string } | null }[];
      chiffres: { gestes: number; reserves: number | null; systeme: number | null } };
    const parMot = await lire(`q=${encodeURIComponent('essai prolongé pour le journal')}`);
    expect(parMot.lignes).toEqual([expect.objectContaining({ geste: 'abonnement.prolonger', sorte: 'abonnements', reserve: false })]);
    expect((await lire(`q=${encodeURIComponent('essai prolongé pour le journal')}&sorte=equipe`)).lignes).toEqual([]);
    // Une période qui ne la contient pas : rien.
    // (Le journal ne se modifie pas : la donnée d'essai se pose déclencheurs suspendus, le temps de la poser.)
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update plateforme.geste_console set le = now() - interval \'40 days\' where motif = $1', ['essai prolongé pour le journal']);
    await admin.query('commit');
    expect((await lire(`q=${encodeURIComponent('essai prolongé pour le journal')}`)).lignes).toEqual([]);
    expect((await lire(`q=${encodeURIComponent('essai prolongé pour le journal')}&plage=tout`)).lignes).toHaveLength(1);
    // Réservés à la direction : chaque ligne l'est, et le chiffre compte la liste des trente jours — pas un geste réservé
    // plus ancien (posé ici à quarante jours ; le journal ne refuse que la modification et l'effacement).
    await admin.query(`insert into plateforme.geste_console (qui, role, geste, motif, le) values ($1, 'direction', 'journal.exporte', 'export d''il y a quarante jours', now() - interval '40 days')`, [direction.id]);
    const reserves = await lire('reserves=1&limite=200');
    expect(reserves.lignes.every((l) => l.reserve)).toBe(true);
    if (reserves.lignes.length < 200) expect(reserves.chiffres.reserves).toBe(reserves.lignes.length);
    // Le support : ses propres gestes, sans les chiffres de la direction.
    const s = await lire('limite=200', jS);
    expect(s.lignes.every((l) => l.qui?.id === support.id)).toBe(true);
    expect(s.chiffres.reserves).toBeNull();
    expect(s.chiffres.systeme).toBeNull();
    // Le système, seul : la direction seulement.
    expect((await lire('systeme=1&sorte=systeme', jS)).lignes).toEqual([]);
  });

  it('l\'export de la sélection : la direction seule, avec son motif, et il entre au journal à son tour', async () => {
    expect((await appeler('POST', '/console/journal/export', jS, { motif: 'je veux le fichier' })).statut).toBe(403);
    const sans = await appeler('POST', '/console/journal/export', jD, { motif: '' });
    expect(sans.statut).toBe(400);
    const r = await appeler('POST', '/console/journal/export', jD, { motif: 'contrôle du trimestre', filtres: { sorte: 'equipe', plage: 'tout' } });
    expect(r.statut).toBe(201);
    const lignes = r.corps.lignes as { sorte: string }[];
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes.every((l) => l.sorte === 'equipe')).toBe(true);
    const j = (await appeler('GET', `/console/journal?q=${encodeURIComponent('contrôle du trimestre')}`, jD)).corps.lignes as { geste: string; apres: { lignes: number; filtres: Record<string, string> } }[];
    expect(j).toEqual([expect.objectContaining({ geste: 'journal.exporte', apres: { lignes: lignes.length, filtres: { sorte: 'equipe', plage: 'tout' } } })]);
  });
});
