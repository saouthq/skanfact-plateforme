// L'inventaire de stock (brique 42 bis ; docs/cabinet.md, C30), par l'API et dans la base. Ce que le
// serveur garantit :
//   - l'inventaire d'une année se pose, ses lignes au millième et au millime, son TOTAL calculé au
//     serveur (chaque ligne arrondie au millime, puis la somme) ; ce qui ne tient pas se refuse ; une
//     voisine n'en lit rien ;
//   - la variation de stock entre au brouillard, datée dans l'année, liée ; repassée, refusée ; sous
//     elle, l'inventaire ne se refait pas ; supprimée ou contre-passée, le lien tombe ;
//   - qui peut : qui saisit pose l'inventaire, qui valide écrit la variation.

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




type Inventaire = { annee: number; date: string; compte: string; total: string; ecriture: string | null; lignes: { ref: string; libelle: string; quantite: string; cout: string }[] };
const inventaire = async (ent: string, p: Personne, annee = 2025) => (await appeler('GET', `/entreprises/${ent}/compta/inventaires/${annee}`, p.jeton)).corps.inventaire as Inventaire | null;
const LIGNES = [{ ref: 'REF-01', libelle: 'Câble HDMI 2 m', quantite: '24', cout: '7,555' }, { ref: '', libelle: 'Farine (kg)', quantite: '12,345', cout: '1,779' }];
const poser = (ent: string, p: Personne, corps: Record<string, unknown>, annee = 2025) =>
  appeler('PUT', `/entreprises/${ent}/compta/inventaires/${annee}`, p.jeton, { date: `${annee}-12-31`, compte: '37', lignes: LIGNES, ...corps });
const variation = (ent: string, p: Personne, date = '2025-12-31', annee = 2025) => appeler('POST', `/entreprises/${ent}/compta/inventaires/${annee}/variation`, p.jeton, {
  ecriture: { date, journal: 'OD', piece: `STK-${annee}`, libelle: `Variation de stock ${annee}`, lignes: [{ compte: '37', debit: '203,257' }, { compte: '603', credit: '203,257' }] } });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'inventaire de stock', () => {
  it('un inventaire : posé, son total calculé au serveur au millime ; ce qui ne tient pas se refuse ; une voisine n\'en lit rien', async () => {
    const d = await dossier();
    expect(await inventaire(d.ent, d.collaborateur)).toBeNull();
    // 24 × 7,555 = 181,320 ; 12,345 × 1,779 = 21,961755 → 21,962 (arrondi au millime, pas tronqué) ; le total : 203,282.
    const r = await poser(d.ent, d.assistant, {});
    expect([r.statut, r.corps]).toEqual([200, { total: '203.282' }]);
    expect(await inventaire(d.ent, d.collaborateur)).toEqual({ annee: 2025, date: '2025-12-31', compte: '37', total: '203.282', ecriture: null, lignes: [
      { ref: 'REF-01', libelle: 'Câble HDMI 2 m', quantite: '24.000', cout: '7.555' }, { ref: '', libelle: 'Farine (kg)', quantite: '12.345', cout: '1.779' }] });
    const motif = async (corps: Record<string, unknown>, annee = 2025) => (await poser(d.ent, d.assistant, corps, annee)).corps.motif;
    expect(await motif({ date: '2025-12-31' }, 2026)).toBe('L\'inventaire de 2026 se date dans cette année.');
    expect(await motif({ lignes: [] })).toBe('Un inventaire sans une seule ligne ne dit pas « le stock est vide », il dit « rien n\'a été compté ».');
    expect(await motif({ lignes: [LIGNES[0], { ...LIGNES[1], libelle: ' ' }] })).toBe('Ligne 2 : la désignation manque.');
    expect(await motif({ lignes: [{ ...LIGNES[0], quantite: '-1' }] })).toBe('Ligne 1 : une quantité négative ne s\'inventorie pas.');
    expect(await motif({ lignes: [{ ...LIGNES[0], cout: '-7' }] })).toBe('Ligne 1 : un coût unitaire négatif n\'existe pas.');
    expect(await motif({ compte: '3a' })).toBe('Le compte de stock de l\'inventaire manque.');
    expect((await poser(d.ent, d.assistant, { lignes: [{ ...LIGNES[0], quantite: 'douze' }] })).corps.champ).toBe('lignes.0.quantite');
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.poser_inventaire($1, 2025, $2::jsonb)',
      [d.ent, JSON.stringify({ date: '2025-12-31', compte: '37', lignes: [{ ref: '', libelle: 'Farine', quantite: 1.5, cout: 1777 }] })])))
      .rejects.toThrow('ligne 1 : une quantité négative ne s\'inventorie pas');
    expect((await inventaire(d.ent, d.collaborateur))?.total).toBe('203.282');
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query('select count(*) n from compta.inventaire where entreprise = $1', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([1, 0]);
  });

  it('la variation : au brouillard, liée ; repassée, refusée ; l\'inventaire ne se refait pas sous elle ; supprimée ou contre-passée, le lien tombe', async () => {
    const d = await dossier();
    expect((await variation(d.ent, d.collaborateur, '2024-12-31', 2024)).corps.motif).toBe('Aucun inventaire saisi pour 2024.');
    await poser(d.ent, d.assistant, {});
    expect((await variation(d.ent, d.assistant)).statut).toBe(403);
    expect((await variation(d.ent, d.collaborateur, '2026-01-01')).corps.motif).toBe('La variation de stock de 2025 se date dans cette année.');
    const r = await variation(d.ent, d.collaborateur);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect((await inventaire(d.ent, d.collaborateur))?.ecriture).toBe(r.corps.id);
    expect((await variation(d.ent, d.collaborateur)).corps.motif).toBe('La variation de stock de cet exercice est déjà passée : la repasser compterait le stock deux fois.');
    expect((await poser(d.ent, d.assistant, {})).corps.motif)
      .toBe('L\'inventaire de 2025 est déjà passé en écriture (la variation de stock) : contre-passe-la ou supprime-la, puis refais-le.');
    // Le brouillard supprimé : le lien tombe, l'inventaire se refait.
    const rev = (await appeler('GET', `/entreprises/${d.ent}/compta/ecritures?limite=500`, d.collaborateur.jeton)).corps.ecritures as { id: string; revision: number }[];
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${r.corps.id}?revision=${rev.find((e) => e.id === r.corps.id)?.revision}`, d.collaborateur.jeton)).statut).toBe(200);
    expect((await inventaire(d.ent, d.collaborateur))?.ecriture).toBeNull();
    expect((await poser(d.ent, d.assistant, {})).statut).toBe(200);
    // Validée puis contre-passée : le lien ne vaut plus.
    const id2 = String((await variation(d.ent, d.collaborateur)).corps.id);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [id2] })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${id2}/contrepasser`, d.collaborateur.jeton, {})).statut).toBe(201);
    expect((await inventaire(d.ent, d.collaborateur))?.ecriture).toBeNull();
    expect((await poser(d.ent, d.assistant, {})).statut).toBe(200);
    // Qui ne valide pas n'écrit pas la variation, même dans la base.
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.ecrire_variation_stock($1, 2025, $2::jsonb)', [d.ent, JSON.stringify({
      date: '2025-12-31', journal: 'OD', piece: 'STK', libelle: 'V', lignes: [{ compte: '37', libelle: '', tiers: '', debit: '1', credit: '0' }, { compte: '603', libelle: '', tiers: '', debit: '0', credit: '1' }] })])))
      .rejects.toThrow('ton rôle ne permet pas de valider ces écritures');
  });
});
