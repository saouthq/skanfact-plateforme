// Les guides d'écritures du cabinet et le journal retenu d'un dossier (brique 50 ; docs/cabinet.md,
// C40), par l'API. Ce que le serveur garantit : un guide se garde dans les réglages du cabinet, dans sa
// forme et rien d'autre — un montant ou un taux en texte décimal (jamais un nombre à virgule), un sens
// qui est débit ou crédit, deux lignes au moins ; le journal retenu se garde dans la fiche du dossier.


import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
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

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const GUIDE = { id: 'g1', nom: 'Loyer du garage', journal: 'OD', lignes: [
  { compte: '6132', libelle: 'Loyer', sens: 'debit', montant: '', taux: '', base: true, solde: false },
  { compte: '4366', libelle: 'TVA déductible', sens: 'debit', montant: '', taux: '19', base: false, solde: false },
  { compte: '401', libelle: '', sens: 'credit', montant: '', taux: '', base: false, solde: true },
] };

describe('les guides d\'écritures et le journal retenu', () => {
  it('un guide se garde dans sa forme et se relit ; une forme fausse est refusée ; le journal retenu se garde dans la fiche', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const fixe = { ...GUIDE, id: 'g2', nom: 'Honoraires', lignes: [{ ...GUIDE.lignes[0], montant: '300.125', base: false }, GUIDE.lignes[2]] };
    const r = await appeler('PUT', `/cabinets/${cabinet}/reglages`, associe.jeton, { contenu: { guides: [GUIDE, fixe] }, revision: null });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((await appeler('GET', `/cabinets/${cabinet}/reglages`, associe.jeton)).corps).toEqual({ contenu: { guides: [GUIDE, fixe] }, revision: 1 });
    const refuse = async (guide: unknown) => (await appeler('PUT', `/cabinets/${cabinet}/reglages`, associe.jeton, { contenu: { guides: [guide] }, revision: 1 })).statut;
    const ligne = (l: Record<string, unknown>) => ({ ...GUIDE, lignes: [{ ...GUIDE.lignes[0], ...l }, GUIDE.lignes[2]] });
    expect(await refuse(ligne({ montant: 850.5 }))).toBe(400);
    expect(await refuse(ligne({ montant: '850,500' }))).toBe(400);
    expect(await refuse(ligne({ taux: '-19' }))).toBe(400);
    expect(await refuse(ligne({ sens: 'autre' }))).toBe(400);
    expect(await refuse(ligne({ compte: '61a2' }))).toBe(400);
    expect(await refuse({ ...GUIDE, journal: 'od' })).toBe(400);
    expect(await refuse({ ...GUIDE, nom: '  ' })).toBe(400);
    expect(await refuse({ ...GUIDE, lignes: [GUIDE.lignes[0]] })).toBe(400);
    expect(await refuse({ ...GUIDE, inconnu: 1 })).toBe(400);
    // Le journal retenu : dans la fiche du dossier, en majuscules, cinq caractères au plus.
    const garage = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    expect((await appeler('PUT', `/cabinets/${cabinet}/fiches/${garage}`, associe.jeton, { contenu: { dernierJournal: 'AC' }, revision: null })).statut).toBe(200);
    expect(((await appeler('GET', `/cabinets/${cabinet}/fiches`, associe.jeton)).corps.fiches as { entreprise: string; contenu: unknown }[])
      .find((f) => f.entreprise === garage)?.contenu).toEqual({ dernierJournal: 'AC' });
    expect((await appeler('PUT', `/cabinets/${cabinet}/fiches/${garage}`, associe.jeton, { contenu: { dernierJournal: 'achats' }, revision: 1 })).statut).toBe(400);
  });

  it('un abonnement se garde dans la fiche du dossier, son montant en texte décimal ; une forme fausse est refusée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    const ABO = { id: 'a1', nom: 'Loyer du local', guideId: 'g1', actif: true, depuis: '2026-01-05', jusqua: '', tousLesMois: 1, montant: '850.500',
      piece: 'LOYER', libelle: 'Loyer', faites: ['2026-01', '2026-02'] };
    const ecrire = async (abonnements: unknown[], revision: number | null) => appeler('PUT', `/cabinets/${cabinet}/fiches/${garage}`, associe.jeton, { contenu: { abonnements }, revision });
    expect((await ecrire([ABO], null)).statut).toBe(200);
    expect(((await appeler('GET', `/cabinets/${cabinet}/fiches`, associe.jeton)).corps.fiches as { entreprise: string; contenu: unknown }[])
      .find((f) => f.entreprise === garage)?.contenu).toEqual({ abonnements: [ABO] });
    const refuse = async (a: Record<string, unknown>) => (await ecrire([{ ...ABO, ...a }], 1)).statut;
    expect(await refuse({ montant: 850.5 })).toBe(400);
    expect(await refuse({ montant: '850,500' })).toBe(400);
    expect(await refuse({ montant: '-10.000' })).toBe(400);
    expect(await refuse({ tousLesMois: 13 })).toBe(400);
    expect(await refuse({ depuis: '05/01/2026' })).toBe(400);
    expect(await refuse({ faites: ['2026-13'] })).toBe(400);
    expect(await refuse({ inconnu: 1 })).toBe(400);
  });

  it('les taux par contrat de la paie se gardent dans la fiche, en texte décimal à quatre décimales au plus ; une forme fausse est refusée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    const PAIE = { regimesContrat: { civp: { cnssEmployee: '0', cnssEmployer: '0', sansIrpp: true }, cdd: { cnssEmployer: '12.5' }, karama: { solidarity: '0.3755', accidentRate: '100' } } };
    const ecrire = async (paie: unknown, revision: number | null) => appeler('PUT', `/cabinets/${cabinet}/fiches/${garage}`, associe.jeton, { contenu: { paie }, revision });
    expect((await ecrire(PAIE, null)).statut).toBe(200);
    expect(((await appeler('GET', `/cabinets/${cabinet}/fiches`, associe.jeton)).corps.fiches as { entreprise: string; contenu: unknown }[])
      .find((f) => f.entreprise === garage)?.contenu).toEqual({ paie: PAIE });
    const refuse = async (regime: Record<string, unknown>, contrat = 'cdd') => (await ecrire({ regimesContrat: { [contrat]: regime } }, 1)).statut;
    expect(await refuse({ cnssEmployer: 12.5 })).toBe(400);
    expect(await refuse({ cnssEmployer: '12,5' })).toBe(400);
    expect(await refuse({ cnssEmployer: '12.56789' })).toBe(400);
    expect(await refuse({ cnssEmployer: '100.5' })).toBe(400);
    expect(await refuse({ cnssEmployer: '-1' })).toBe(400);
    expect(await refuse({ sansIrpp: false })).toBe(400);
    expect(await refuse({ proRate: '5' })).toBe(400);
    expect(await refuse({ cnssEmployer: '5' }, 'cdi')).toBe(400);
    expect(await refuse({ cnssEmployer: '5' }, 'inconnu')).toBe(400);
    expect((await ecrire({ regimesContrat: {}, autre: 1 }, 1)).statut).toBe(400);
  });
});
