// Les immobilisations (brique 42 ; docs/cabinet.md, C28 et C29), par l'API et dans la base. Ce que le
// serveur garantit :
//   - une fiche de bien se pose et se relit au millime ; ce qui ne tient pas se refuse, nommé ;
//     changée ailleurs, jamais écrasée ; une voisine n'en lit rien ;
//   - les dotations et les sorties d'une année entrent au brouillard, liées à leur bien ; repassées,
//     elles se refusent ; tant qu'une dotation est écrite, ce qui fait le plan ne change pas et la
//     fiche ne se supprime pas ; supprimée ou contre-passée, le lien tombe ;
//   - qui peut : qui saisit pose une fiche ; qui valide écrit les dotations ; la porte et la base.

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




type Bien = { id: string; revision: number; fiche: Record<string, unknown>; ecritures: { annee: number; genre: string; ecriture: string }[] };
const biens = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/immobilisations`, p.jeton)).corps.immobilisations as Bien[];
const CAMIONNETTE = {
  libelle: 'Camionnette de livraison', compte: '2182', compteAmort: '28182', compteDotation: '6811',
  dateAcquisition: '2026-03-01', dateMiseEnService: '2026-03-01', valeur: '36000,600', residuelle: '0', tva: '6840,114',
  methode: 'lineaire', duree: '5', tauxDegressif: null, bascule: false, subvention: null, cession: null,
  origine: { source: 'saisie', docId: '', mois: '' },
};
const poser = (ent: string, p: Personne, fiche: unknown) => appeler('POST', `/entreprises/${ent}/compta/immobilisations`, p.jeton, { fiche });
const modifier = (ent: string, p: Personne, id: string, fiche: unknown, revision: number) => appeler('PUT', `/entreprises/${ent}/compta/immobilisations/${id}`, p.jeton, { fiche, revision });
const dotation = (id: string, montant: string, date = '2026-12-31') => ({ immobilisation: id, genre: 'dotation', ecriture: {
  date, journal: 'OD', piece: `DOT-2026-${id.slice(-4)}`, libelle: 'Dotation 2026 — Camionnette de livraison',
  lignes: [{ compte: '6811', debit: montant }, { compte: '28182', credit: montant }] } });
const ecrire = (ent: string, p: Personne, pieces: unknown[], annee = 2026) => appeler('POST', `/entreprises/${ent}/compta/immobilisations/ecrire`, p.jeton, { annee, pieces });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les immobilisations', () => {
  it('une fiche : posée et relue au millime ; ce qui ne tient pas se refuse ; changée ailleurs, jamais écrasée ; une voisine n\'en lit rien', async () => {
    const d = await dossier();
    const r = await poser(d.ent, d.assistant, CAMIONNETTE);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const [lu] = await biens(d.ent, d.collaborateur);
    expect(lu).toEqual({ id: r.corps.id, revision: 1, ecritures: [], fiche: { ...CAMIONNETTE, valeur: '36000.600', residuelle: '0.000', tva: '6840.114' } });
    // Ce qui ne tient pas se refuse, nommé.
    const refus = async (f: Record<string, unknown>) => (await poser(d.ent, d.assistant, { ...CAMIONNETTE, ...f })).corps.motif;
    expect(await refus({ libelle: '  ' })).toBe('Le bien n\'a pas de libellé : une ligne sans nom ne se retrouve jamais.');
    expect(await refus({ valeur: '0' })).toBe('La valeur d\'acquisition doit être positive.');
    expect(await refus({ residuelle: '36000,600' })).toBe('La valeur résiduelle ne peut pas atteindre la valeur d\'acquisition : il n\'y aurait rien à amortir.');
    expect(await refus({ duree: '0' })).toBe('La durée d\'amortissement doit être positive.');
    expect(await refus({ methode: 'degressif' })).toBe('Un amortissement dégressif demande son taux : il dépend de la durée et du régime, et l\'application ne le devine pas.');
    expect(await refus({ cession: { date: '2026-01-15', prix: '0', motif: 'rebut' } })).toBe('Un bien ne se cède pas avant d\'être mis en service.');
    expect((await poser(d.ent, d.assistant, { ...CAMIONNETTE, duree: 'cinq' })).corps.champ).toBe('fiche.duree');
    expect((await poser(d.ent, d.assistant, { ...CAMIONNETTE, valeur: '12a' })).corps.champ).toBe('fiche.valeur');
    expect((await poser(d.ent, d.assistant, { ...CAMIONNETTE, formule: '=1' })).statut).toBe(400);
    // Dans la base aussi : des millimes entiers.
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select * from compta.poser_immobilisation($1, null, $2::jsonb, null)',
      [d.ent, JSON.stringify({ ...CAMIONNETTE, valeur: 36000.6, residuelle: 0, tva: 0, dureeCentiemes: 500 })]))).rejects.toThrow();
    // Modifiée dans sa révision ; changée ailleurs, jamais écrasée.
    const id = String(r.corps.id);
    expect((await modifier(d.ent, d.assistant, id, { ...CAMIONNETTE, duree: '6,5', libelle: 'Camionnette Isuzu' }, 1)).corps).toEqual({ id, revision: 2 });
    expect((await biens(d.ent, d.collaborateur))[0]?.fiche).toMatchObject({ libelle: 'Camionnette Isuzu', duree: '6.5' });
    const vieux = await modifier(d.ent, d.assistant, id, CAMIONNETTE, 1);
    expect([vieux.statut, vieux.corps.motif]).toEqual([409, 'Cette fiche a été changée ailleurs entre-temps : recharge-la, rien n\'a été enregistré.']);
    // Une voisine n'en lit rien, même dans la base.
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query('select count(*) n from compta.immobilisation where entreprise = $1', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([1, 0]);
  });

  it('les dotations : au brouillard, liées ; repassées, refusées ; écrite, le plan ne change pas et la fiche ne se supprime pas ; supprimée ou contre-passée, le lien tombe', async () => {
    const d = await dossier();
    const FICHE = { ...CAMIONNETTE, dateAcquisition: '2025-03-01', dateMiseEnService: '2025-03-01' };
    const id = String((await poser(d.ent, d.assistant, FICHE)).corps.id);
    expect((await ecrire(d.ent, d.assistant, [dotation(id, '6000,100', '2025-12-31')], 2025)).statut).toBe(403);
    expect((await ecrire(d.ent, d.collaborateur, [dotation(id, '6000,100', '2026-01-01')], 2025)).corps.motif).toBe('Les écritures d\'immobilisation de 2025 se datent dans cette année.');
    const r = await ecrire(d.ent, d.collaborateur, [dotation(id, '6000,100', '2025-12-31')], 2025);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const [e1] = r.corps.ids as string[];
    expect((await biens(d.ent, d.collaborateur))[0]?.ecritures).toEqual([{ annee: 2025, genre: 'dotation', ecriture: e1 }]);
    const lues = (await appeler('GET', `/entreprises/${d.ent}/compta/ecritures?limite=500`, d.collaborateur.jeton)).corps.ecritures as { id: string; statut: string; revision: number }[];
    expect(lues.find((e) => e.id === e1)?.statut).toBe('brouillard');
    expect((await ecrire(d.ent, d.collaborateur, [dotation(id, '6000,100', '2025-12-31')], 2025)).corps.motif).toBe('La dotation 2025 de « Camionnette de livraison » est déjà passée : la repasser la compterait deux fois.');
    // Écrite : ce qui fait le plan ne change pas, la fiche ne se supprime pas ; le libellé, lui, se change.
    expect((await modifier(d.ent, d.assistant, id, { ...FICHE, duree: '4' }, 1)).corps.motif)
      .toBe('La dotation de 2025 est déjà passée en écriture : ce changement la rendrait fausse. Contre-passe-la (ou supprime-la si elle est au brouillard), puis recommence.');
    expect((await modifier(d.ent, d.assistant, id, { ...FICHE, cession: { date: '2025-11-30', prix: '30000', motif: 'cession' } }, 1)).corps.motif)
      .toMatch(/^La dotation de 2025 est déjà passée en écriture/);
    expect((await modifier(d.ent, d.assistant, id, { ...FICHE, libelle: 'Camionnette Isuzu' }, 1)).corps).toEqual({ id, revision: 2 });
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/immobilisations/${id}?revision=2`, d.assistant.jeton)).corps.motif)
      .toBe('La dotation de 2025 est passée en écriture : supprimer la fiche laisserait une dotation sans bien. Contre-passe-la d\'abord (ou supprime-la si elle est au brouillard).');
    // Le brouillard supprimé : le lien tombe, la dotation se repasse.
    const rev = (await appeler('GET', `/entreprises/${d.ent}/compta/ecritures?limite=500`, d.collaborateur.jeton)).corps.ecritures as { id: string; revision: number }[];
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${e1}?revision=${rev.find((e) => e.id === e1)?.revision}`, d.collaborateur.jeton)).statut).toBe(200);
    expect((await biens(d.ent, d.collaborateur))[0]?.ecritures).toEqual([]);
    const [e2] = (await ecrire(d.ent, d.collaborateur, [dotation(id, '6000,100', '2025-12-31')], 2025)).corps.ids as string[];
    // Validée puis contre-passée : le lien ne vaut plus ; la fiche se change à nouveau, et se supprime.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [e2] })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${e2}/contrepasser`, d.collaborateur.jeton, {})).statut).toBe(201);
    expect((await biens(d.ent, d.collaborateur))[0]?.ecritures).toEqual([]);
    expect((await modifier(d.ent, d.assistant, id, { ...FICHE, duree: '4' }, 2)).corps).toEqual({ id, revision: 3 });
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/immobilisations/${id}?revision=3`, d.assistant.jeton)).statut).toBe(200);
    expect(await biens(d.ent, d.collaborateur)).toEqual([]);
  });

  it('qui peut : qui saisit pose une fiche, qui valide écrit les dotations ; la base aussi', async () => {
    const d = await dossier();
    const id = String((await poser(d.ent, d.assistant, CAMIONNETTE)).corps.id);
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.ecrire_immobilisations($1, 2026, $2::jsonb)',
      [d.ent, JSON.stringify([{ ...dotation(id, '6000100'), ecriture: { date: '2026-12-31', journal: 'OD', piece: 'D', libelle: 'D', lignes: [
        { compte: '6811', libelle: '', tiers: '', debit: '6000100', credit: '0' }, { compte: '28182', libelle: '', tiers: '', debit: '0', credit: '6000100' }] } }])])))
      .rejects.toThrow('ton rôle ne permet pas de valider ces écritures');
    const voisine = await personne('voisine');
    await expect(enTantQue(pool, voisine.utilisateur, (tx) => tx.query('select * from compta.poser_immobilisation($1, null, $2::jsonb, null)',
      [d.ent, JSON.stringify({ ...CAMIONNETTE, valeur: 36000600, residuelle: 0, tva: 0, dureeCentiemes: 500 })]))).rejects.toThrow('entreprise introuvable');
  });
});
