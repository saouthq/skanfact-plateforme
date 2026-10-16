// La documentation interne du support (1.41.0 ; base 0133 ; serveur/console/docsupport.ts ; docs/console.md C57). Ce qui
// est garanti :
//   - une note privée se pose sur une demande par la direction ou le support, jamais la technique ; le client ne la lit
//     JAMAIS (ni dans ses demandes, ni dans ce qui l'attend) ; le journal dit qu'une note a été posée, jamais son texte ;
//   - une fiche s'écrit par la direction ou le support ; une réponse ne s'offre dans le champ de réponse qu'une fois
//     validée par la direction ; la reprendre la renvoie à valider ; la direction seule valide et retire (avec son
//     motif) ; un titre ne sert qu'une fois par sorte ; chaque geste au journal.

import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { lireDocs, lireNotes, poserReponse, reponsesOffertes } from '../../serveur/console/docsupport.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesSupport } from '../../serveur/support/gestes.ts';
import { routesSupport } from '../../serveur/support/routes.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

describe('la documentation du support, pure', () => {
  it('une ligne illisible n\'existe pas ; seules les réponses validées s\'offrent ; « {prenom} » devient le prénom, partout', () => {
    const docs = lireDocs([
      { id: 'a', sorte: 'reponse', titre: 'Mot de passe', texte: 'Bonjour {prenom}, voici…', ecriteLe: '2026-10-16T08:00:00Z', ecritePar: 'Karim', valideeLe: '2026-10-16T09:00:00Z', valideePar: 'Amira' },
      { id: 'b', sorte: 'reponse', titre: 'Pas validée', texte: 'Bonjour {prenom}', ecriteLe: '2026-10-16T08:00:00Z', ecritePar: 'Karim', valideeLe: null },
      { id: 'c', sorte: 'procedure', titre: 'Compte bloqué', texte: 'Étape 1…', ecriteLe: '2026-10-16T08:00:00Z', valideeLe: '2026-10-16T09:00:00Z' },
      { id: 'd', sorte: 'note', titre: 'Autre', texte: 'xxxxxxxxxx', ecriteLe: '2026-10-16T08:00:00Z' },
      { id: 'e', sorte: 'reponse', titre: '', texte: 'xxxxxxxxxx', ecriteLe: '2026-10-16T08:00:00Z' },
      { id: 'f', sorte: 'reponse', titre: 'Sans date', texte: 'xxxxxxxxxx', ecriteLe: 'hier' },
      'x', null,
    ]);
    expect(docs.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(docs[0]?.validee).toEqual({ le: '2026-10-16T09:00:00Z', par: 'Amira' });
    expect(reponsesOffertes(docs).map((f) => f.id)).toEqual(['a']);
    expect(poserReponse('Bonjour {prenom}, {prenom} !', 'Lina')).toBe('Bonjour Lina, Lina !');
    expect(lireNotes([{ id: 'n', texte: 'Essayé', le: '2026-10-16T08:00:00Z', auteur: 'Karim' }, { id: 'm', texte: '', le: '2026-10-16T08:00:00Z' }]).map((x) => x.id)).toEqual(['n']);
  });
});

// ── Par l'API ───────────────────────────────────────────────────────────────────────────────────────────────────────
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docsupport-')), 'veille.json');
let app: FastifyInstance;
type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `docsupport-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Doc${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  const u = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
  return { jeton: String(k.corps.jeton), id: u };
}
// Le journal de NOS membres seulement : d'autres fichiers de tests partagent la base.
const journal = async (qui: string[], prefixe: string) => (await admin.query(
  'select geste, motif, avant, apres from plateforme.geste_console where qui = any($1::uuid[]) and geste like $2 order by le, id', [qui, `${prefixe}%`])).rows as
  { geste: string; motif: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[];

// L'instant de la version d'une fiche, telle que la console la lit (l'audit 1.42.0, A03) : on le rend à la validation.
const lue = async (id: string) => ((await appeler('GET', '/console/support/documentation', direction.jeton)).corps.fiches as { id: string; ecriteLe: string }[]).find((f) => f.id === id)?.ecriteLe ?? null;

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;
beforeAll(async () => {
  await admin.connect();
  declarerGestesSupport();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille }), ...routesSupport(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  technique = await membre('Sami', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); fs.rmSync(path.dirname(veille), { recursive: true, force: true }); });

describe('la documentation du support, par l\'API (0133)', () => {
  it('une note privée : posée par le support, lue par l\'équipe, jamais par le client ; refusée à la technique ; au journal sans son texte', async () => {
    const p = await personne('Lina');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Librairie des Notes' })).corps.id);
    const demande = String((await appeler('POST', `/entreprises/${ent}/support`, p.jeton, { sujet: 'Imprimer un ticket', texte: 'Comment imprimer un ticket de caisse ?' })).corps.id);
    const SECRET = 'Elle a déjà essayé de réinstaller le pilote ; voir avec Sami';
    expect((await appeler('POST', `/console/support/demandes/${demande}/notes`, technique.jeton, { texte: SECRET })).statut).toBe(403);
    const courte = await appeler('POST', `/console/support/demandes/${demande}/notes`, support.jeton, { texte: 'ok' });
    expect(courte.statut).toBe(400);
    expect(courte.corps.champ).toBe('texte');
    expect((await appeler('POST', `/console/support/demandes/${demande}/notes`, support.jeton, { texte: SECRET })).statut).toBe(201);
    expect((await appeler('POST', `/console/support/demandes/${demande}/notes`, direction.jeton, { texte: 'Vu, je rappelle demain' })).statut).toBe(201);
    const lu = (await appeler('GET', `/console/support?demande=${demande}`, direction.jeton)).corps.notes as { texte: string; auteur: string }[];
    expect(lu.map((x) => x.texte)).toEqual([SECRET, 'Vu, je rappelle demain']);
    expect(lu[0]?.auteur).toMatch(/^Karim/);
    // Le client : ni dans ses demandes, ni dans ce qui l'attend.
    expect(JSON.stringify((await appeler('GET', `/entreprises/${ent}/support`, p.jeton)).corps)).not.toContain('réinstaller');
    expect(JSON.stringify((await appeler('GET', `/entreprises/${ent}/support/attente`, p.jeton)).corps)).not.toContain('réinstaller');
    const j = await journal([support.id, direction.id], 'support.note_privee');
    expect(j).toHaveLength(2);
    expect(JSON.stringify(j)).not.toContain('réinstaller');
  });

  it('une réponse : écrite par le support, offerte une fois validée par la direction ; reprise, elle revient à valider ; retirée avec un motif', async () => {
    const titre = `Mot de passe oublié ${Math.random().toString(36).slice(2, 7)}`;
    const offertes = async () => {
      const p = await personne('Hela');
      const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier des Réponses' })).corps.id);
      const demande = String((await appeler('POST', `/entreprises/${ent}/support`, p.jeton, { sujet: 'Mot de passe', texte: 'Je ne retrouve plus mon mot de passe.' })).corps.id);
      return ((await appeler('GET', `/console/support?demande=${demande}`, support.jeton)).corps.reponses as { titre: string; texte: string }[]).filter((f) => f.titre === titre);
    };
    expect((await appeler('POST', '/console/support/documentation', technique.jeton, { id: null, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, voici comment faire.' })).statut).toBe(403);
    const e = await appeler('POST', '/console/support/documentation', support.jeton, { id: null, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, voici comment faire.' });
    expect(e.statut).toBe(201);
    const id = String(e.corps.id);
    // Un même titre, une seule fiche de sa sorte (sans la casse) : la base refuse (403).
    const double = await appeler('POST', '/console/support/documentation', direction.jeton, { id: null, sorte: 'reponse', titre: titre.toUpperCase(), texte: 'Un autre texte assez long.' });
    expect(double.statut).toBe(403);
    expect(await offertes()).toEqual([]);
    // Le support ne valide pas ; la direction, si.
    expect((await appeler('POST', `/console/support/documentation/${id}/valider`, support.jeton, { lue: await lue(id) })).statut).toBe(403);
    expect((await appeler('POST', `/console/support/documentation/${id}/valider`, direction.jeton, { lue: await lue(id) })).statut).toBe(200);
    expect((await appeler('POST', `/console/support/documentation/${id}/valider`, direction.jeton, { lue: await lue(id) })).statut).toBe(403);
    expect((await offertes()).map((f) => f.texte)).toEqual(['Bonjour {prenom}, voici comment faire.']);
    // La reprendre la renvoie à valider : elle ne s'offre plus.
    expect((await appeler('POST', '/console/support/documentation', support.jeton, { id, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, voici comment faire, pas à pas.', lue: await lue(id) })).statut).toBe(200);
    expect(await offertes()).toEqual([]);
    const fiche = ((await appeler('GET', '/console/support/documentation', support.jeton)).corps.fiches as { id: string; validee: unknown }[]).find((f) => f.id === id);
    expect(fiche?.validee).toBeNull();
    // Retirer : la direction seule, avec son motif ; elle quitte la documentation.
    expect((await appeler('POST', `/console/support/documentation/${id}/retirer`, support.jeton, { motif: 'ne vaut plus' })).statut).toBe(403);
    expect((await appeler('POST', `/console/support/documentation/${id}/retirer`, direction.jeton, { motif: '' })).statut).toBe(400);
    expect((await appeler('POST', `/console/support/documentation/${id}/retirer`, direction.jeton, { motif: 'la page a changé' })).statut).toBe(200);
    expect(((await appeler('GET', '/console/support/documentation', direction.jeton)).corps.fiches as { id: string }[]).some((f) => f.id === id)).toBe(false);
    expect((await appeler('GET', '/console/support/documentation', technique.jeton)).statut).toBe(403);
    const j = (await journal([support.id, direction.id], 'support.doc_')).filter((x) => JSON.stringify(x).includes(titre));
    expect(j.map((x) => x.geste)).toEqual(['support.doc_ecrite', 'support.doc_validee', 'support.doc_reprise', 'support.doc_retiree']);
    expect(j[2]?.avant).toEqual({ titre, validee: true });
    expect(j[3]?.motif).toBe('la page a changé');
  });

  it('l\'audit 1.42.0, A03 : la validation et la reprise portent sur la version lue ; reprise entre-temps, rien n\'est validé ni écrasé', async () => {
    const titre = `Facture en double ${Math.random().toString(36).slice(2, 7)}`;
    const id = String((await appeler('POST', '/console/support/documentation', support.jeton, { id: null, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, texte A relu par la direction.' })).corps.id);
    // La direction ouvre le texte A ; le support le reprend en B ; la direction valide depuis sa fenêtre restée sur A.
    const versionA = await lue(id);
    expect((await appeler('POST', '/console/support/documentation', support.jeton, { id, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, texte B que personne n\'a relu.', lue: versionA })).statut).toBe(200);
    const perime = await appeler('POST', `/console/support/documentation/${id}/valider`, direction.jeton, { lue: versionA });
    expect([perime.statut, perime.corps.motif]).toEqual([403, 'Cette fiche a été reprise depuis que tu l\'as lue : relis-la avant de la valider (rien n\'est validé).']);
    expect(((await appeler('GET', '/console/support/documentation', direction.jeton)).corps.fiches as { id: string; validee: unknown }[]).find((f) => f.id === id)?.validee).toBeNull();
    // Une seconde reprise depuis la version A (une autre fenêtre) n'écrase pas B.
    const ecrase = await appeler('POST', '/console/support/documentation', direction.jeton, { id, sorte: 'reponse', titre, texte: 'Bonjour {prenom}, texte C écrit sur A.', lue: versionA });
    expect([ecrase.statut, ecrase.corps.motif]).toEqual([403, 'Cette fiche a été reprise depuis que tu l\'as ouverte : relis-la, puis refais ta reprise (rien n\'est écrit).']);
    // Relue (B), elle se valide ; le texte validé est gardé, et le journal en garde l'empreinte.
    expect((await appeler('POST', `/console/support/documentation/${id}/valider`, direction.jeton, { lue: await lue(id) })).statut).toBe(200);
    expect((await admin.query('select texte from plateforme.doc_support_validee where doc = $1', [id])).rows).toEqual([{ texte: 'Bonjour {prenom}, texte B que personne n\'a relu.' }]);
    const j = (await journal([direction.id], 'support.doc_validee')).filter((x) => JSON.stringify(x).includes(titre));
    expect(j.map((x) => (x.apres as { empreinte?: string } | null)?.empreinte)).toEqual([createHash('sha256').update('Bonjour {prenom}, texte B que personne n\'a relu.', 'utf8').digest('hex')]);
    // Sans la version lue : la route refuse.
    expect((await appeler('POST', `/console/support/documentation/${id}/valider`, direction.jeton, {})).statut).toBe(400);
  });

  it('une procédure garde sa sorte ; une fiche retirée ne se reprend plus', async () => {
    const titre = `Compte bloqué ${Math.random().toString(36).slice(2, 7)}`;
    const id = String((await appeler('POST', '/console/support/documentation', support.jeton, { id: null, sorte: 'procedure', titre, texte: '1. Vérifier son adresse. 2. Lui renvoyer le lien.' })).corps.id);
    expect((await appeler('POST', '/console/support/documentation', support.jeton, { id, sorte: 'reponse', titre, texte: '1. Vérifier son adresse. 2. Lui renvoyer le lien.', lue: await lue(id) })).statut).toBe(403);
    // La version lue avant le retrait : c'est le retrait qui refuse, pas une version oubliée.
    const avant = await lue(id);
    await appeler('POST', `/console/support/documentation/${id}/retirer`, direction.jeton, { motif: 'doublon' });
    const r = await appeler('POST', '/console/support/documentation', support.jeton, { id, sorte: 'procedure', titre, texte: 'Une nouvelle version du texte.', lue: avant });
    expect(r.statut).toBe(403);
    expect(String(r.corps.motif)).toMatch(/a été retirée/);
  });
});
