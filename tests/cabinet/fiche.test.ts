// La fiche et les réglages du cabinet (brique 47 ; docs/cabinet.md, C37), par l'API et dans la base.
// Ce que le serveur garantit :
//   - seul un associé change le nom du cabinet (un à deux cents caractères) ; le changement se trace ;
//   - l'adresse, le téléphone et les réglages de la v10 (jour de relance, échéances, saisie, thème,
//     régimes, échéances pointées) se gardent dans les réglages du cabinet, et rien d'autre : une
//     valeur hors de sa forme est refusée.


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

async function personneA(email: string, nom: string) {
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
const REGLAGES = {
  email: 'contact@cabinet-ennour.tn', phone: '+216 71 000 000', relanceDay: 12, deadlines: { tvaDay: 28, cnssDay: 15 },
  saisie: { journalParDefaut: 'ACH', dateComplete: false, validerParLot: true, touches: { ligneSuivante: 'Enter', solder: 'Tab', recopier: 'F2', dupliquer: 'F4', valider: 'Control+Enter' }, regleLe: '2026-09-29T10:00:00.000Z' },
  theme: 'dark', depots: ['tva-m@2026-05-28'], formatCopie: 'virgule',
  regimes: [{ id: 'forfait', label: 'Forfait', tva: 'trimestrielle', cnss: false, annuelles: [{ id: 'ir', label: 'Déclaration annuelle', mois: 4, jour: 25 }] }],
};

describe('la fiche du cabinet', () => {
  it('l\'associé renomme le cabinet ; un collaborateur ne le peut pas ; un nom vide est refusé ; le changement se trace', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const r = await appeler('PUT', `/cabinets/${cabinet}/nom`, associe.jeton, { nom: '  Cabinet Ennour & Associés  ' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toEqual({ nom: 'Cabinet Ennour & Associés' });
    expect(((await appeler('GET', '/cabinets', associe.jeton)).corps.cabinets as { id: string; nom: string }[]).find((c) => c.id === cabinet)?.nom).toBe('Cabinet Ennour & Associés');
    const vide = await appeler('PUT', `/cabinets/${cabinet}/nom`, associe.jeton, { nom: '   ' });
    expect([vide.statut, vide.corps.motif]).toEqual([403, 'Le nom du cabinet s\'écrit en un à deux cents caractères.']);
    // Un collaborateur (invité, entré par le lien) ne le change pas.
    const adresse = `amine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, associe.jeton, { email: adresse, role: 'revision' });
    const amine = await personneA(adresse, 'Amine');
    expect((await appeler('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    const refus = await appeler('PUT', `/cabinets/${cabinet}/nom`, amine.jeton, { nom: 'Cabinet Amine' });
    expect([refus.statut, refus.corps.motif]).toEqual([403, 'Seul un associé du cabinet change son nom.']);
    // Une personne hors du cabinet non plus.
    const autre = await personne('autre');
    expect((await appeler('PUT', `/cabinets/${cabinet}/nom`, autre.jeton, { nom: 'Cabinet Volé' })).statut).toBe(403);
    expect((await admin.query('select nom from socle.organisation where id = $1', [cabinet])).rows[0].nom).toBe('Cabinet Ennour & Associés');
    const traces = (await admin.query(`select avant, apres from socle.audit where objet_id = $1 and geste = 'cabinet.renommer' order by instant, id`, [cabinet])).rows;
    expect(traces).toEqual([{ avant: { nom: 'Cabinet Ennour' }, apres: { nom: 'Cabinet Ennour & Associés' } }]);
  });

  it('l\'adresse, le téléphone et les réglages de la v10 se gardent et se relisent ; une valeur hors de sa forme est refusée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const r = await appeler('PUT', `/cabinets/${cabinet}/reglages`, associe.jeton, { contenu: REGLAGES, revision: null });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((await appeler('GET', `/cabinets/${cabinet}/reglages`, associe.jeton)).corps).toEqual({ contenu: REGLAGES, revision: 1 });
    const refuse = async (contenu: Record<string, unknown>) => {
      const x = await appeler('PUT', `/cabinets/${cabinet}/reglages`, associe.jeton, { contenu: { ...REGLAGES, ...contenu }, revision: 1 });
      return x.statut;
    };
    expect(await refuse({ email: 'pas-une-adresse' })).toBe(400);
    expect(await refuse({ relanceDay: 29 })).toBe(400);
    expect(await refuse({ deadlines: { tvaDay: 32, cnssDay: 15 } })).toBe(400);
    expect(await refuse({ theme: 'rose' })).toBe(400);
    expect(await refuse({ depots: ['tva-m@2026-13-99'] })).toBe(400);
    expect(await refuse({ regimes: [{ ...REGLAGES.regimes[0], tva: 'annuelle' }] })).toBe(400);
    expect(await refuse({ saisie: { ...REGLAGES.saisie, journalParDefaut: 'achats' } })).toBe(400);
    expect(await refuse({ inconnu: 1 })).toBe(400);
    // Une adresse vide est permise (la v10 ne l'exige pas), et rien n'a bougé entre-temps.
    expect(await refuse({ email: '' })).toBe(200);
    expect(((await appeler('GET', `/cabinets/${cabinet}/reglages`, associe.jeton)).corps as { revision: number }).revision).toBe(2);
  });
});
