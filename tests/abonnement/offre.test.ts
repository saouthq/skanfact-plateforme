// Ce que l'offre ouvre (14c ; docs/abonnement.md, « 14c » ; serveur/abonnement/offre.ts), par l'API. Ce que le serveur
// garantit :
//   - en Essentiel (payé, et pendant la grâce qui suit), la paie et la comptabilité complète sont FERMÉES : un salarié,
//     un bulletin, une absence, une avance ou une immobilisation NOUVEAUX sont refusés, quoi que l'écran envoie, en
//     disant ce qui reste et qui l'ouvre ; ce qui existe se corrige et se supprime toujours (02 § 6) ;
//   - ce que la loi demande n'est dans aucun module fermé (les déclarations, 07) ; l'essai et Complet ouvrent tout ;
//   - le cabinet qui a le mandat de la paie la fait toujours, quelle que soit l'offre du client (02 § 8) ;
//   - l'état le dit à l'écran (`fermes`), pour qu'il retienne la création AVANT le geste.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { faire } from '../../base/abonnement.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

// La preuve d'un paiement reçu hors de la plateforme (0113) : sans elle, rien n'est payé.
const RECU = { facture: 'F-2020-001', montant: 390000n, moyen: 'virement' as const, le: '2020-01-01' };

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const exploitant = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const jour = aujourdhuiATunis();
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `offre-${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  return { email, jeton };
}
type Objet = { collection: string; cle: string; revision: number };
const nouveau = (collection: string, id: string, contenu: Record<string, unknown> = {}) => ({ collection, cle: id, rang: null, revision: null, contenu: { id, ...contenu } });
const ecrire = (ent: string, jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
const lire = async (ent: string, jeton: string) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
const fermes = async (ent: string, jeton: string) => (await appeler('GET', `/entreprises/${ent}/abonnement/etat`, jeton)).corps.fermes;
const SALARIE = { name: 'Amel Trabelsi', cnss: '12345678', position: 'Serveuse', contract: 'cdi', hireDate: '2025-01-01', grossSalary: 1250, headOfFamily: true, children: 2 };

beforeAll(async () => {
  await admin.connect(); await exploitant.connect();
  declarerGestesVentes(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesPaie(ctx), ...routesCabinet(ctx), ...routesV10(ctx), ...routesAbonnement(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await exploitant.end(); await pool.end(); });

describe('ce que l\'offre ouvre', () => {
  it('en Essentiel, rien de NEUF ne se crée dans la paie ni les immobilisations ; ce qui existe se corrige et se supprime ; les déclarations restent', async () => {
    const p = await personne('nadia');
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier Essentiel' })).corps.id);
    // Pendant l'essai, tout est ouvert : un salarié et une immobilisation entrent.
    expect(await fermes(ent, p.jeton)).toEqual([]);
    expect((await ecrire(ent, p.jeton, [nouveau('employees', 'sal-1', SALARIE), nouveau('assets', 'immo-1', { label: 'Four', amount: 4200 })])).statut).toBe(200);
    // Essentiel payé : la paie et la comptabilité complète se ferment.
    await faire(exploitant, ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'annuel', motif: 'virement reçu' });
    expect(await fermes(ent, p.jeton)).toEqual(['paie', 'compta']);
    for (const [collection, module] of [['employees', 'paie'], ['payslips', 'paie'], ['leaves', 'paie'], ['advances', 'paie'], ['socialFilings', 'paie'], ['assets', 'compta']]) {
      const r = await ecrire(ent, p.jeton, [nouveau(collection ?? '', `${collection}-neuf`)]);
      expect(r.statut, collection).toBe(403);
      expect(r.corps.bouton).toBe('socle.abonnement.voir');
      expect(String(r.corps.motif)).toMatch(module === 'paie' ? /La paie n'est pas dans l'offre Essentiel/ : /La comptabilité complète n'est pas dans l'offre Essentiel/);
    }
    // Avec un objet permis dans le même envoi : rien n'est écrit.
    expect((await ecrire(ent, p.jeton, [nouveau('clients', 'cl-1', { name: 'Hôtel Dar El Marsa' }), nouveau('employees', 'sal-2', SALARIE)])).statut).toBe(403);
    const lus = await lire(ent, p.jeton);
    expect(lus.filter((o) => ['cl-1', 'sal-2'].includes(o.cle) || o.cle.endsWith('-neuf'))).toEqual([]);
    // Ce qui existe se corrige, et se supprime.
    const sal = lus.find((o) => o.collection === 'employees' && o.cle === 'sal-1');
    const immo = lus.find((o) => o.collection === 'assets' && o.cle === 'immo-1');
    expect((await ecrire(ent, p.jeton, [{ collection: 'employees', cle: 'sal-1', rang: null, revision: sal?.revision, contenu: { id: 'sal-1', ...SALARIE, position: 'Cheffe de salle' } },
      { collection: 'assets', cle: 'immo-1', rang: null, revision: immo?.revision, contenu: null }])).statut).toBe(200);
    // Ce que la loi demande n'est dans aucun module fermé : une déclaration se prépare toujours.
    expect((await ecrire(ent, p.jeton, [nouveau('fiscalFilings', 'tva-2026-09', { period: '2026-09' })])).statut).toBe(200);
    // Pendant la grâce qui suit l'échéance, l'offre payée décide encore.
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2, paye_jusqu_au = $3 where entreprise = $1', [ent, plusJours(jour, -60), plusJours(jour, -2)]);
    expect((await appeler('GET', `/entreprises/${ent}/abonnement/etat`, p.jeton)).corps).toMatchObject({ etat: 'en_retard', fermes: ['paie', 'compta'] });
    expect((await ecrire(ent, p.jeton, [nouveau('employees', 'sal-3', SALARIE)])).statut).toBe(403);
    // Complet ouvre tout.
    await faire(exploitant, ent, { geste: 'payer', paiement: { ...RECU, facture: 'F-2020-002' }, offre: 'complet', periodicite: 'mensuel', motif: 'passe à Complet' });
    expect(await fermes(ent, p.jeton)).toEqual([]);
    expect((await ecrire(ent, p.jeton, [nouveau('employees', 'sal-3', SALARIE), nouveau('assets', 'immo-2', { label: 'Camion', amount: 38000 })])).statut).toBe(200);
  });

  it('le cabinet qui a le mandat de la paie la fait toujours, quelle que soit l\'offre du client ; le client, lui, ne crée plus', async () => {
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Essentiel' })).corps.id);
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
    await appeler('POST', `/cabinets/${String(c.corps.id)}/mandats/${mandat}/accepter`, associe.jeton);
    expect((await appeler('PUT', `/entreprises/${ent}/mandat/perimetre`, client.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(200);
    await faire(exploitant, ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'annuel', motif: 'virement reçu' });
    expect(await fermes(ent, client.jeton)).toEqual(['paie', 'compta']);
    const r = await appeler('POST', `/entreprises/${ent}/paie/dossier`, associe.jeton, { changements: [nouveau('employees', 'sal-1', SALARIE)] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((await ecrire(ent, client.jeton, [nouveau('employees', 'sal-2', SALARIE)])).statut).toBe(403);
  });
});
