// Le lot Clients dans la base et au serveur (0110, 0112 ; serveur/console/routes.ts ; docs/console.md C32–C34) :
//   - chaque client a son numéro, donné à sa création ; sa ville, facultative, se dit à la création, jamais devinée ;
//   - nos échanges : un appel se note (comment, ce qui s'est dit), il ne part jamais chez le client et ne se réécrit pas ;
//     un message au contact s'ouvre dans son application comme une demande que SkanFact commence ;
//   - la fiche d'un groupe dit ses sociétés comme la liste ;
//   - la reprise : la direction l'ouvre, la propriétaire est prévenue (quinze jours pour s'opposer), les trois pièces se
//     notent vues, l'AUTRE membre de la direction confirme ; le repreneur devient propriétaire, l'ancienne quitte l'équipe.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'console-echanges-')), 'veille.json');
let app: FastifyInstance;
const aujourdhui = aujourdhuiATunis(horloge);
const enFrancais = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;

type Reponse = { statut: number; corps: Record<string, unknown> };
// Un refus du métier (de la base ou du serveur) répond 403 avec son motif ; un corps mal formé, 400.
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
const marque = Date.now().toString(36);
async function personne(prenom: string, email = `echanges-${prenom}${++n}-${marque}@exemple.tn`) {
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
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { ...p, console: String(c.corps.jeton) };
}
async function entreprise(nom: string, autre: Record<string, unknown> = {}, proprio?: Awaited<ReturnType<typeof personne>>) {
  const p = proprio ?? await personne('proprio');
  const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom, ...autre });
  expect(cree.statut, JSON.stringify(cree.corps)).toBe(201);
  return { ent: String(cree.corps.id), proprio: p };
}
const fiche = async (jeton: string, ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, jeton)).corps;
const dernierGeste = async (geste: string, ent: string) =>
  (await admin.query('select motif, role, avant, apres from plateforme.geste_console where geste = $1 and entreprise = $2 order by le desc limit 1', [geste, ent])).rows[0];

let amira: Awaited<ReturnType<typeof membre>>, sami: Awaited<ReturnType<typeof membre>>, karim: Awaited<ReturnType<typeof membre>>, tarek: Awaited<ReturnType<typeof membre>>;

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille })]);
  await app.ready();
  amira = await membre('amira', 'direction');
  sami = await membre('sami', 'direction');
  karim = await membre('karim', 'support');
  tarek = await membre('tarek', 'technique');
}, 120_000);
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le numéro et la ville d\'un client (0110)', () => {
  it('un numéro donné à la création, qui croît ; une ville facultative, dite à la création ; jamais une balise', async () => {
    const a = await entreprise('Librairie Numéro Un', { ville: '  Sfax ' });
    const b = await entreprise('Librairie Numéro Deux');
    const fa = await fiche(karim.console, a.ent), fb = await fiche(karim.console, b.ent);
    const ia = fa.identite as { numero: string; ville: string | null }, ib = fb.identite as { numero: string; ville: string | null };
    expect(ia.numero).toMatch(/^E-\d{4,}$/);
    expect(Number(ib.numero.slice(2))).toBeGreaterThan(Number(ia.numero.slice(2)));
    expect(ia.ville).toBe('Sfax');
    expect(ib.ville).toBeNull();
    // Une ville refusée ne laisse pas d'entreprise à moitié créée.
    const p = await personne('balise');
    expect((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Librairie Balise', ville: '<b>Sfax</b>' })).statut).toBe(403);
    expect((await admin.query('select count(*)::int n from socle.entreprise where raison_sociale = $1', ['Librairie Balise'])).rows[0].n).toBe(0);
    expect((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Librairie Longue', ville: 'S'.repeat(61) })).statut).toBe(400);
  });
});

describe('nos échanges avec un client (0110)', () => {
  it('un appel se note par la direction ou le support, se range sur sa fiche, entre au journal sans ce qui s\'est dit, et ne se réécrit pas', async () => {
    const { ent } = await entreprise('Épicerie Des Appels');
    expect((await appeler('POST', `/console/entreprises/${ent}/appels`, tarek.console, { resultat: 'parle', resume: 'rien' })).statut).toBe(403);
    // On s'est parlé : ce qui s'est dit, en deux lignes ; sans réponse, la note peut rester courte.
    const sans = await appeler('POST', `/console/entreprises/${ent}/appels`, karim.console, { resultat: 'parle' });
    expect(sans.statut).toBe(403);
    expect(String(sans.corps.motif)).toMatch(/deux lignes/);
    expect((await appeler('POST', `/console/entreprises/${ent}/appels`, karim.console, { resultat: 'sans_reponse' })).statut).toBe(201);
    horloge.setTime(horloge.getTime() + 60_000);
    expect((await appeler('POST', `/console/entreprises/${ent}/appels`, amira.console, { resultat: 'parle', resume: 'Il attend sa clé USB pour signer' })).statut).toBe(201);
    const f = await fiche(karim.console, ent);
    expect((f.notes as { resultat: string; resume: string | null; qui: string }[]).map((x) => [x.resultat, x.resume, x.qui]))
      .toEqual([['parle', 'Il attend sa clé USB pour signer', amira.nom], ['sans_reponse', null, karim.nom]]);
    expect((f.identite as { dernierAppel: unknown }).dernierAppel).toMatchObject({ resultat: 'parle', qui: amira.nom });
    // Le journal dit comment l'appel s'est passé, jamais ce qui s'est dit.
    expect(await dernierGeste('clients.appel', ent)).toMatchObject({ motif: 'appel : on s\'est parlé', role: 'direction' });
    await expect(admin.query('update plateforme.note_appel set resume = $2 where entreprise = $1', [ent, 'réécrit'])).rejects.toThrow(/ne se modifie pas/);
  });

  it('un message au contact s\'ouvre dans son application, à une personne de son équipe, comme une demande que SkanFact commence', async () => {
    const { ent, proprio } = await entreprise('Atelier Du Message');
    const autre = await personne('inconnu');
    const corps = { destinataire: proprio.id, sujet: 'Ton essai de SkanFact', texte: 'Bonjour, as-tu trouvé ce que tu cherchais ?' };
    expect((await appeler('POST', `/console/entreprises/${ent}/ecrire`, karim.console, { ...corps, destinataire: autre.id })).statut).toBe(403);
    expect((await appeler('POST', `/console/entreprises/${ent}/ecrire`, karim.console, { ...corps, sujet: 'Un <b>objet</b>' })).statut).toBe(403);
    const r = await appeler('POST', `/console/entreprises/${ent}/ecrire`, karim.console, corps);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const d = (await admin.query(`select d.canal, d.demandeur, d.sujet, m.cote, m.texte from plateforme.demande_support d join plateforme.message_support m on m.demande = d.id
                                   where d.id = $1`, [r.corps.demande])).rows;
    expect(d).toEqual([{ canal: 'skanfact', demandeur: proprio.id, sujet: corps.sujet, cote: 'equipe', texte: corps.texte }]);
    expect(await dernierGeste('clients.ecrit', ent)).toMatchObject({ motif: corps.sujet, role: 'support' });
  });
});

describe('la fiche d\'un groupe (0110)', () => {
  it('ses sociétés comme la liste les dit, chacune avec son numéro ; rien pour ce qui n\'est pas un groupe', async () => {
    const proprio = await personne('famille');
    const a = await entreprise('Boulangerie Du Groupe', { ville: 'Sousse' }, proprio);
    const b = await entreprise('Pâtisserie Du Groupe', { ville: 'Sousse' }, proprio);
    const g = await appeler('POST', '/console/groupes', amira.console, { nom: `Famille ${marque}`, entreprises: [a.ent, b.ent], motif: 'même propriétaire, même famille' });
    expect(g.statut, JSON.stringify(g.corps)).toBe(201);
    const r = await appeler('GET', `/console/groupes/${g.corps.id}`, karim.console);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ id: g.corps.id, nom: `Famille ${marque}`, ville: 'Sousse', numero: expect.stringMatching(/^G-\d{2,}$/) });
    const societes = r.corps.societes as { id: string; numero: string; ville: string; etat: { etat: string } }[];
    expect(societes.map((s) => s.id).sort()).toEqual([a.ent, b.ent].sort());
    expect(societes.every((s) => /^E-\d{4,}$/.test(s.numero) && s.ville === 'Sousse' && s.etat.etat === 'essai')).toBe(true);
    // La liste dit le groupe en une ligne, avec les mêmes sociétés.
    const liste = (await appeler('GET', `/console/entreprises?q=${encodeURIComponent(`Famille ${marque}`)}&limite=50`, karim.console)).corps.lignes as { id: string; sorte: string; societes: { id: string }[] }[];
    expect(liste.map((o) => [o.id, o.sorte, o.societes.length])).toEqual([[g.corps.id, 'groupe', 2]]);
    expect((await appeler('GET', `/console/groupes/${a.ent}`, karim.console)).statut).toBe(404);
    expect((await appeler('GET', '/console/groupes/pas-un-id', karim.console)).statut).toBe(404);
    expect((await appeler('GET', `/console/groupes/${g.corps.id}`, tarek.console)).statut).toBe(403);
  });
});

describe('la procédure de reprise (0112)', () => {
  it('ouverte par la direction, la propriétaire prévenue, les pièces vues, le délai passé, confirmée par l\'autre : le repreneur devient propriétaire', async () => {
    const { ent, proprio } = await entreprise('Quincaillerie Reprise');
    const repreneur = `repreneur-${marque}@exemple.tn`;
    const ouvrir = { cause: 'deces', nom: 'Youssef Repreneur', email: repreneur, motif: 'décès du gérant, acte reçu par courrier' };
    expect((await appeler('POST', `/console/entreprises/${ent}/reprises`, karim.console, ouvrir)).statut).toBe(403);
    expect((await appeler('POST', `/console/entreprises/${ent}/reprises`, amira.console, { ...ouvrir, email: 'pas-une-adresse' })).statut).toBe(403);
    const o = await appeler('POST', `/console/entreprises/${ent}/reprises`, amira.console, ouvrir);
    expect(o.statut, JSON.stringify(o.corps)).toBe(201);
    const id = String(o.corps.id);
    expect((await appeler('POST', `/console/entreprises/${ent}/reprises`, sami.console, ouvrir)).statut).toBe(403);
    // Ce que la fiche en dit, à la direction seule ; quinze jours pour s'opposer.
    const r = (await fiche(amira.console, ent)).reprise as Record<string, unknown>;
    expect(r).toMatchObject({ id, cause: 'deces', repreneur: { nom: 'Youssef Repreneur', email: repreneur, aUnCompte: false }, prevenue: proprio.nom,
      oppositionJusquAu: plusJours(aujourdhui, 15), delaiPasse: false, pieces: {}, appliqueeLe: null, closeLe: null });
    expect((await fiche(karim.console, ent)).reprise).toBeNull();
    // La propriétaire est prévenue dans son application : le nom du repreneur, la date limite que la base a posée.
    const message = (await admin.query(`select d.canal, d.demandeur, m.texte from plateforme.demande_support d join plateforme.message_support m on m.demande = d.id
                                         where d.id = $1`, [r.demande])).rows[0];
    expect(message).toMatchObject({ canal: 'skanfact', demandeur: proprio.id });
    expect(message.texte).toContain('Youssef Repreneur');
    expect(message.texte).toContain(`avant le ${enFrancais(plusJours(aujourdhui, 15))} inclus`);
    expect(message.texte).not.toContain('%JUSQU_AU%');

    const confirmer = (jeton: string) => appeler('POST', `/console/reprises/${id}/confirmer`, jeton, {});
    const refusDe = async (jeton: string) => String((await confirmer(jeton)).corps.motif);
    // Celui qui l'a ouverte ne la confirme pas ; l'autre, pas avant les trois pièces, le délai, et le compte du repreneur.
    expect(await refusDe(amira.console)).toMatch(/^L'autre membre de la direction/);
    expect(await refusDe(sami.console)).toMatch(/trois pièces/);
    expect((await appeler('POST', `/console/reprises/${id}/pieces`, sami.console, { piece: 'acte' })).statut).toBe(200);
    expect(await refusDe(sami.console)).toMatch(/trois pièces/);
    expect((await appeler('POST', `/console/reprises/${id}/pieces`, amira.console, { piece: 'acte' })).statut).toBe(403);
    expect((await appeler('POST', `/console/reprises/${id}/pieces`, amira.console, { piece: 'photo' })).statut).toBe(400);
    for (const piece of ['registre', 'identite']) expect((await appeler('POST', `/console/reprises/${id}/pieces`, amira.console, { piece })).statut).toBe(200);
    expect(await refusDe(sami.console)).toMatch(new RegExp(`jusqu'au ${enFrancais(plusJours(aujourdhui, 15))} inclus`));
    // Quinze jours passés (la date se recule dans la base, comme le temps).
    await admin.query('update plateforme.reprise set opposition_jusqu_au = $2 where id = $1', [id, plusJours(aujourdhui, -1)]);
    expect(await refusDe(sami.console)).toMatch(/pas encore de compte SkanFact/);
    const y = await personne('youssef', repreneur);
    const c = await confirmer(sami.console);
    expect(c.statut, JSON.stringify(c.corps)).toBe(200);

    // Le repreneur est propriétaire ; l'ancienne propriétaire a quitté l'équipe ; rien d'autre n'a bougé.
    const membres = (await admin.query('select utilisateur, roles, actif from socle.membre where entreprise = $1 order by actif, depuis', [ent])).rows;
    expect(membres).toEqual([{ utilisateur: proprio.id, roles: ['proprietaire'], actif: false }, { utilisateur: y.id, roles: ['proprietaire'], actif: true }]);
    expect(await dernierGeste('clients.reprise_appliquee', ent)).toMatchObject({ role: 'direction', avant: { proprietaires: [proprio.id] }, apres: { proprietaire: y.id } });
    expect((await admin.query("select utilisateur, avant, apres from socle.audit where entreprise = $1 and geste = 'socle.propriete.reprise'", [ent])).rows)
      .toEqual([{ utilisateur: sami.id, avant: { proprietaires: [proprio.id] }, apres: { proprietaire: y.id, cause: 'deces' } }]);
    expect((await fiche(amira.console, ent)).reprise).toMatchObject({ id, appliqueePar: sami.nom });
    expect((await confirmer(sami.console)).statut).toBe(403);
    // Le repreneur ouvre son entreprise.
    expect((await appeler('GET', '/moi', y.jeton)).statut).toBe(200);
    expect((await admin.query('select count(*)::int n from socle.membre where entreprise = $1 and utilisateur = $2 and actif', [ent, y.id])).rows[0].n).toBe(1);
  });

  it('une opposition notée clôt la procédure ; une autre peut s\'ouvrir', async () => {
    const { ent } = await entreprise('Droguerie Opposée');
    const ouvrir = { cause: 'conflit', nom: 'Associé Pressé', email: `associe-${marque}@exemple.tn`, motif: 'conflit d\'associés, l\'un demande la main' };
    const id = String((await appeler('POST', `/console/entreprises/${ent}/reprises`, amira.console, ouvrir)).corps.id);
    expect((await appeler('POST', `/console/reprises/${id}/clore`, amira.console, { opposition: true, motif: ' ' })).statut).toBe(403);
    expect((await appeler('POST', `/console/reprises/${id}/clore`, amira.console, { opposition: true, motif: 'la propriétaire a répondu : elle s\'y oppose' })).statut).toBe(200);
    expect(await dernierGeste('clients.reprise_opposee', ent)).toMatchObject({ motif: 'la propriétaire a répondu : elle s\'y oppose' });
    expect((await fiche(amira.console, ent)).reprise).toMatchObject({ id, opposeeLe: expect.any(String), closeMotif: 'la propriétaire a répondu : elle s\'y oppose' });
    expect(String((await appeler('POST', `/console/reprises/${id}/confirmer`, sami.console, {})).corps.motif)).toMatch(/close/);
    expect((await appeler('POST', `/console/entreprises/${ent}/reprises`, amira.console, ouvrir)).statut).toBe(201);
  });
});
