// La liasse et le résultat fiscal de l'année (brique 41 ter ; docs/cabinet.md, C26 et C27), par l'API
// et dans la base. Ce que le serveur garantit :
//   - les retraitements d'une année (nature connue, libellé, montant positif en millimes) et son taux
//     d'impôt (un entier à six décimales, ou rien) se posent et se relisent au millime ; ce qui n'est
//     pas envoyé ne change pas ; changés ailleurs, jamais écrasés ; une voisine n'en lit rien ;
//   - qui peut : le propriétaire ; au cabinet, l'associé seul (03 § 3.1) ; la porte et la base ;
//   - le modèle de liasse du cabinet : ses rubriques, rien d'autre.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Personne = Awaited<ReturnType<typeof personne>>;

// Un client et son entreprise ; son cabinet, qui accepte le mandat de comptabilité ; un collaborateur
// et un assistant de saisie à qui le dossier est confié.
async function dossier() {
  const client = await personne('client');
  const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
  const associe = await personne('associe');
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
  const cabinet = String(c.corps.id);
  const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
  await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe.jeton);
  const membre = async (role: string) => {
    const p = await personne(role);
    const id = String((await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [p.utilisateur, cabinet, [role]])).rows[0].id);
    await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${id}`, associe.jeton, { role });
    return p;
  };
  const collaborateur = await membre('revision');
  const assistant = await membre('saisie');
  return { client, ent, associe, cabinet, mandat, collaborateur, assistant };
}




type Annuel = { retraitements: { id: string; nature: string; libelle: string; montant: string }[]; tauxImpot: string | null; revision: number | null };
const annuel = async (ent: string, p: Personne, annee = 2026) => (await appeler('GET', `/entreprises/${ent}/compta/annuel/${annee}`, p.jeton)).corps as Annuel;
const poser = (ent: string, p: Personne, corps: Record<string, unknown>, annee = 2026) => appeler('PUT', `/entreprises/${ent}/compta/annuel/${annee}`, p.jeton, corps);
const AMENDE = { id: 'rt1', nature: 'reintegration', libelle: 'Amende fiscale non déductible', montant: '1250,125' };

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la liasse et l\'annuel', () => {
  it('retraitements et taux : posés et relus au millime ; ce qui n\'est pas envoyé ne change pas ; ce qui ne se lit pas se refuse ; changés ailleurs, jamais écrasés ; une voisine n\'en lit rien', async () => {
    const d = await dossier();
    expect(await annuel(d.ent, d.collaborateur)).toEqual({ retraitements: [], tauxImpot: null, revision: null });
    const r = await poser(d.ent, d.associe, { retraitements: [AMENDE], tauxImpot: '22,5', revision: null });
    expect([r.statut, r.corps]).toEqual([200, { revision: 1 }]);
    expect(await annuel(d.ent, d.collaborateur)).toEqual({ retraitements: [{ ...AMENDE, montant: '1250.125' }], tauxImpot: '22.5', revision: 1 });
    // Le taux seul : les retraitements restent.
    expect((await poser(d.ent, d.associe, { tauxImpot: null, revision: 1 })).corps).toEqual({ revision: 2 });
    expect(await annuel(d.ent, d.collaborateur)).toMatchObject({ retraitements: [{ montant: '1250.125' }], tauxImpot: null, revision: 2 });
    // Changé ailleurs : jamais écrasé.
    const vieux = await poser(d.ent, d.associe, { tauxImpot: '25', revision: 1 });
    expect([vieux.statut, vieux.corps.motif]).toEqual([409, 'La liasse de cette année a été changée ailleurs entre-temps : recharge-la, rien n\'a été enregistré.']);
    // Ce qui ne se lit pas, ce qui ne se permet pas.
    expect((await poser(d.ent, d.associe, { retraitements: [{ ...AMENDE, montant: '12a' }], revision: 2 })).corps.champ).toBe('retraitements.0.montant');
    expect((await poser(d.ent, d.associe, { tauxImpot: 'vingt', revision: 2 })).corps.champ).toBe('tauxImpot');
    expect((await poser(d.ent, d.associe, { retraitements: [{ ...AMENDE, nature: 'autre' }], revision: 2 })).statut).toBe(400);
    expect((await poser(d.ent, d.associe, { tauxImpot: '150', revision: 2 })).corps.motif).toBe('Le taux d\'impôt se donne en pourcentage, entre 0 et 100.');
    expect((await poser(d.ent, d.associe, { retraitements: [{ ...AMENDE, montant: '0' }], revision: 2 })).corps.motif)
      .toBe('Le montant d\'un retraitement est positif, en millimes : c\'est la nature qui dit dans quel sens il joue.');
    expect((await poser(d.ent, d.associe, { retraitements: [{ ...AMENDE, libelle: '   ' }], revision: 2 })).corps.motif).toBe('Un retraitement sans libellé ne s\'explique pas devant un contrôle.');
    const enBase = (retraitements: unknown) => enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.poser_annuel($1, 2026, $2::jsonb, null, 2)', [d.ent, JSON.stringify(retraitements)]));
    await expect(enBase([{ ...AMENDE, montant: 1250125, nature: 'autre' }])).rejects.toThrow('la nature de ce retraitement n\'est pas connue');
    await expect(enBase([{ ...AMENDE, montant: 1.5 }])).rejects.toThrow('le montant d\'un retraitement est positif');
    await expect(enBase([{ ...AMENDE, montant: '1250125' }])).rejects.toThrow('le montant d\'un retraitement est positif');
    expect(await annuel(d.ent, d.collaborateur)).toMatchObject({ tauxImpot: null, revision: 2 });
    // Une autre année est une autre liasse ; une voisine n'en lit rien, même dans la base.
    expect(await annuel(d.ent, d.collaborateur, 2025)).toEqual({ retraitements: [], tauxImpot: null, revision: null });
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query('select count(*) n from compta.annuel where entreprise = $1', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([1, 0]);
  });

  it('qui peut : le propriétaire et l\'associé ; ni le collaborateur ni l\'assistant ; la porte et la base', async () => {
    const d = await dossier();
    const refus = await poser(d.ent, d.collaborateur, { tauxImpot: '25', revision: null });
    expect([refus.statut, refus.corps.motif]).toEqual([403, 'Ton rôle (Collaborateur) ne permet pas de préparer la liasse de l\'année : ses retraitements et son taux d\'impôt. Peuvent le faire : client.']);
    expect((await poser(d.ent, d.assistant, { tauxImpot: '25', revision: null })).statut).toBe(403);
    await expect(enTantQue(pool, d.collaborateur.utilisateur, (tx) => tx.query('select compta.poser_annuel($1, 2026, \'[]\'::jsonb, 250000, null)', [d.ent])))
      .rejects.toThrow('ton rôle ne permet pas de préparer la liasse de ce dossier');
    expect((await poser(d.ent, d.client, { tauxImpot: '25', revision: null })).corps).toEqual({ revision: 1 });
    expect((await poser(d.ent, d.associe, { tauxImpot: '15', revision: 1 })).corps).toEqual({ revision: 2 });
    expect((await annuel(d.ent, d.collaborateur)).tauxImpot).toBe('15');
    // Sans la comptabilité dans le mandat, l'associé non plus.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['declarations'] })).statut).toBe(200);
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('select compta.poser_annuel($1, 2026, \'[]\'::jsonb, 250000, 2)', [d.ent])))
      .rejects.toThrow(/entreprise introuvable|ne permet pas de préparer la liasse/);
  });

  it('le modèle de liasse du cabinet : ses rubriques, rien d\'autre', async () => {
    const d = await dossier();
    const rubrique = { id: 'AC1', etat: 'bilan-actif', label: 'Immobilisations incorporelles', comptes: ['20'], signe: 1, deduit: false, charge: false, resultat: false, deuxSens: false };
    const reglages = (liasse: unknown) => appeler('PUT', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton, { contenu: { liasse }, revision: null });
    expect((await reglages([{ ...rubrique, etat: 'annexe' }])).statut).toBe(400);
    expect((await reglages([{ ...rubrique, comptes: ['2O'] }])).statut).toBe(400);
    expect((await reglages([{ ...rubrique, formule: '=1+1' }])).statut).toBe(400);
    expect((await reglages([rubrique])).statut).toBe(200);
    expect(((await appeler('GET', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton)).corps.contenu as { liasse: unknown }).liasse).toEqual([rubrique]);
  });
});
