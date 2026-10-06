// Le portefeuille du Cabinet v10 repris (brique 70 ; docs/cabinet.md, C60). Le fichier du cabinet est
// fabriqué par la v10 elle-même (cabcore.js, migrate) ; de chaque dossier ne part que la liste comptée
// (la même que le point de contact, `portefeuilleAEnvoyer`), jamais la clé privée du cabinet ni celles
// des clients. Ce que le serveur garantit : les dossiers tenus créés avec leur fiche, une fois (une
// seconde reprise les retrouve) ; les clients sur SkanFact et les exemples laissés, et dits ; ce qui ne
// se reprendrait pas tel quel, nommé, et rien de créé ; un champ de plus, refusé.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
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

type Etat = { cabinet: Record<string, unknown>; dossiers: Record<string, unknown>[] };
const CC = ecranDeLaPlateforme('cabinet/cabcore.js') as { migrate: (s: unknown) => Etat };
// Ce qui part du poste, de chaque dossier : la liste comptée (le point de contact fait la même).
const CHAMPS = ['id', 'name', 'matricule', 'manual', 'demo', 'archived', 'email', 'phone', 'contact', 'note', 'from', 'regime', 'tvaPeriod', 'fees',
  'cnssEmployeur', 'cnssCode', 'relances', 'abonnements'];
const envoyer = (e: Etat) => ({ dossiers: e.dossiers.map((d) => Object.fromEntries(CHAMPS.map((k) => [k, d[k]]))) });

// Un matricule fiscal propre à chaque passage (il est unique dans toute la base).
const MAT = String(1_000_000 + Math.floor(Math.random() * 8_999_999));
// Le fichier d'un cabinet de la v10 : sa clé privée, deux dossiers tenus (l'un archivé), un client sur
// SkanFact (sa clé épinglée), un dossier d'exemple.
function cabinetV10() {
  return CC.migrate({
    cabinet: { name: 'Cabinet Ennour', email: 'contact@ennour.tn', publicKey: 'CLE-PUBLIQUE', privateKey: 'CLE-PRIVEE-DU-CABINET' },
    dossiers: [
      { id: 'd1', name: 'Boulangerie Ennour', matricule: `${MAT}a.p.m.000`, manual: true, email: 'gerant@ennour.tn', phone: '71 000 000', regime: 'reel',
        tvaPeriod: 'mensuelle', fees: 350.5, from: '2025-01', relances: [{ at: Date.UTC(2025, 1, 10), months: ['2025-01'], via: 'tel', note: 'Rappelé' }],
        abonnements: [{ id: 'ab1', nom: 'Loyer', guideId: 'g-loyer', actif: true, depuis: '2025-01-01', jusqua: '', tousLesMois: 1, montant: 850.5, piece: 'LOY', libelle: 'Loyer du local', faites: ['2025-01'] }] },
      { id: 'd2', name: 'Café des Arts', matricule: '', manual: true, archived: true, note: 'Ancien client' },
      { id: 'd3', name: 'Menuiserie Ben Salah', matricule: '7654321B/A/M/000', manual: false, clePublique: 'CLE-DU-CLIENT' },
      { id: 'd4', name: 'Exemple — Épicerie', manual: true, demo: true },
    ],
  });
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la reprise du portefeuille du Cabinet v10', () => {
  it('les dossiers tenus créés avec leur fiche ; les clients sur SkanFact et les exemples dits ; une seconde reprise les retrouve', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const corps = envoyer(cabinetV10());
    expect(JSON.stringify(corps)).not.toMatch(/CLE-PRIVEE|CLE-DU-CLIENT|CLE-PUBLIQUE/);
    const essai = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille/essai`, associe.jeton, corps);
    expect(essai.statut, JSON.stringify(essai.corps)).toBe(200);
    expect(essai.corps).toEqual({ aCreer: [{ nom: 'Boulangerie Ennour', matricule: `${MAT}A/P/M/000` }, { nom: 'Café des Arts', matricule: null }],
      retrouves: [], surSkanfact: ['Menuiserie Ben Salah'], exemples: 1, anomalies: [] });
    expect(Number((await admin.query('select count(*)::int n from socle.entreprise where tenue_par = $1', [cabinet])).rows[0].n)).toBe(0);

    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille`, associe.jeton, corps);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect((r.corps.crees as { v10: string }[]).map((x) => x.v10)).toEqual(['d1', 'd2']);
    const porte = ((await appeler('GET', `/cabinets/${cabinet}/portefeuille`, associe.jeton)).corps.dossiers as { entreprise: string; raisonSociale: string; matriculeFiscal: string | null; tenu: boolean }[])
      .map((d) => [d.raisonSociale, d.matriculeFiscal, d.tenu]).sort();
    expect(porte).toEqual([['Boulangerie Ennour', `${MAT}A/P/M/000`, true], ['Café des Arts', null, true]]);
    const fiches = (await appeler('GET', `/cabinets/${cabinet}/fiches`, associe.jeton)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[];
    const ficheDe = (v10: string) => fiches.find((f) => f.entreprise === (r.corps.crees as { v10: string; entreprise: string }[]).find((x) => x.v10 === v10)?.entreprise)?.contenu;
    expect(ficheDe('d1')).toMatchObject({ email: 'gerant@ennour.tn', phone: '71 000 000', regime: 'reel', tvaPeriod: 'mensuelle', fees: 350500, from: '2025-01', archived: false,
      relances: [{ at: Date.UTC(2025, 1, 10), months: ['2025-01'], via: 'tel', note: 'Rappelé' }],
      abonnements: [{ id: 'ab1', nom: 'Loyer', guideId: 'g-loyer', actif: true, depuis: '2025-01-01', jusqua: '', tousLesMois: 1, montant: '850.500', piece: 'LOY', libelle: 'Loyer du local', faites: ['2025-01'] }] });
    expect(ficheDe('d2')).toMatchObject({ archived: true, note: 'Ancien client' });

    // Une seconde reprise du même fichier : rien de recréé.
    const encore = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille`, associe.jeton, corps);
    expect([encore.statut, encore.corps.crees, (encore.corps.rapport as { retrouves: string[] }).retrouves]).toEqual([201, [], ['Boulangerie Ennour', 'Café des Arts']]);
  });

  it('ce qui ne se reprendrait pas tel quel est nommé et rien ne se crée ; un champ de plus (la clé privée) refusé ; un collaborateur refusé', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const e = cabinetV10();
    e.dossiers.push(
      { ...e.dossiers[1], id: 'd5', name: '  ' },
      { ...e.dossiers[1], id: 'd6', name: 'Pharmacie Nour', matricule: '12345' },
      // Le matricule de d1, écrit autrement (sans barres) : le même (E4).
      { ...e.dossiers[1], id: 'd7', name: 'Garage Salah', matricule: `${MAT}APM000` },
      // La lettre-clé n'est jamais I, O ni U (la règle du fichier El Fatoora).
      { ...e.dossiers[1], id: 'd10', name: 'Épicerie Ennasr', matricule: `${MAT.slice(1)}9O/P/M/000` },
      { ...e.dossiers[1], id: 'd8', name: 'Librairie Amal', fees: 12.3456 },
      { ...e.dossiers[1], id: 'd9', name: 'Hammam El Bey', relances: [{ at: 1, months: [], via: 'pigeon', note: '' }] },
    );
    const corps = envoyer(e);
    const r = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille`, associe.jeton, corps);
    expect([r.statut, r.corps.motif]).toEqual([400, 'Ce portefeuille ne se reprend pas tel quel : le rapport nomme ce qui l\'empêche (6), dossier par dossier ; aucun dossier n\'a été créé.']);
    expect((r.corps.rapport as { anomalies: { nom: string; motif: string }[] }).anomalies.map((x) => [x.nom, x.motif])).toEqual([
      ['', 'Un dossier n\'a pas de nom (ou un nom de plus de deux cents caractères).'],
      ['Pharmacie Nour', 'Le matricule fiscal « 12345 » ne se lit pas : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000).'],
      ['Garage Salah', `Le matricule fiscal ${MAT}A/P/M/000 est celui de deux dossiers du fichier.`],
      ['Épicerie Ennasr', `Le matricule fiscal « ${MAT.slice(1)}9O/P/M/000 » ne se lit pas : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000).`],
      ['Librairie Amal', 'Les honoraires de ce dossier ne se lisent pas au millime.'],
      ['Hammam El Bey', 'La fiche de ce dossier ne se reprend pas telle quelle (relances.0.via).'],
    ]);
    expect(Number((await admin.query('select count(*)::int n from socle.entreprise where tenue_par = $1', [cabinet])).rows[0].n)).toBe(0);
    // La clé privée du cabinet, ou celle d'un client, ne passe pas.
    const avecCle = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille/essai`, associe.jeton, { ...envoyer(cabinetV10()), cabinet: { privateKey: 'CLE-PRIVEE-DU-CABINET' } });
    expect(avecCle.statut).toBe(400);
    const sansTri = { dossiers: cabinetV10().dossiers };
    expect((await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille/essai`, associe.jeton, sansTri)).statut).toBe(400);
    const collaborateur = await personne('collaborateur');
    await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, '{revision}')`, [collaborateur.utilisateur, cabinet]);
    const refus = [403, 'Seul un associé du cabinet reprend son portefeuille de la v10.'];
    const c1 = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille`, collaborateur.jeton, envoyer(cabinetV10()));
    const c2 = await appeler('POST', `/cabinets/${cabinet}/reprise/portefeuille/essai`, collaborateur.jeton, envoyer(cabinetV10()));
    expect([[c1.statut, c1.corps.motif], [c2.statut, c2.corps.motif]]).toEqual([refus, refus]);
  });
});
