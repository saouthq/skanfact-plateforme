// (1.388.97) Un fichier joint se lit avec les droits de la pièce qui le porte. Le commercial ne lit pas la paie : le contrat
// scanné rangé sur la fiche d'un salarié ne s'ouvre pas pour lui, même s'il en connaît l'identifiant ; la photo d'une
// facture d'achat, que le magasinier ne lit pas non plus, pareil. Ce qu'il lit (le catalogue) s'ouvre. Un fichier qu'aucune
// pièce ne porte encore ne s'ouvre que pour qui l'a déposé ; le propriétaire ouvre tout.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesPiecesJointes } from '../../serveur/v10/pieces-jointes.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
async function personne(prenom: string) {
  const email = `droits-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toISOString().slice(0, 10);

// Une entreprise avec un peu de tout, et une personne par rôle.
async function entreprise() {
  const proprio = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const membres: Record<string, { jeton: string }> = {};
  for (const role of ['magasinier', 'comptabilite_interne', 'commercial']) {
    const p = await personne(role);
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv });
    // La paie demande le code du téléphone.
    if (role === 'paie') await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    membres[role] = p;
  }
  const lire = async (jeton: string, depuis = '') => (await appeler('GET', `/entreprises/${ent}/dossier-v10${depuis}`, jeton)).corps as { objets: Objet[]; droits: { cachees: string[]; lectureSeule: string[]; ecrivables: string[]; tout: boolean; responsable: boolean }; marque: string; profil: string; partiel?: boolean };
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  await lire(proprio.jeton);
  expect((await envoyer(proprio.jeton, [
    { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 21 } },
    { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', cin: '01234567' } },
    { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
    { collection: '_racine', cle: 'payrollSettings', rang: null, revision: null, contenu: { smig: 528 } },
    { collection: '_racine', cle: 'counters', rang: null, revision: null, contenu: {} },
  ])).statut).toBe(200);
  return { ent, proprio, membres, lire, envoyer };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesPiecesJointes()]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const PDF = (texte: string) => Buffer.from(`%PDF-1.4\n% ${texte}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');

describe('(1.388.97) un fichier joint se lit avec les droits de sa pièce', () => {
  it('le contrat d\'un salarié ne s\'ouvre pas pour le commercial ; la fiche d\'un article, si ; un fichier sans pièce, pour qui l\'a déposé', async () => {
    const e = await entreprise();
    const deposer = async (jeton: string, nom: string) => {
      const r = await appeler('POST', `/entreprises/${e.ent}/pieces-jointes`, jeton, { nom, contenu: PDF(nom).toString('base64') });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return r.corps as { name: string; file: string; size: number; date: string };
    };
    const lire = (jeton: string, file: string) => appeler('GET', `/entreprises/${e.ent}/pieces-jointes/${file}`, jeton);
    const contrat = await deposer(e.proprio.jeton, 'Contrat Sami Trabelsi.pdf');
    const facture = await deposer(e.proprio.jeton, 'Facture Ciments de Bizerte.pdf');
    const fiche = await deposer(e.proprio.jeton, 'Fiche technique ciment.pdf');
    const etat = await e.lire(e.proprio.jeton);
    const rev = (c: string, k: string) => etat.objets.find((o) => o.collection === c && o.cle === k)?.revision ?? null;
    const ecrit = await e.envoyer(e.proprio.jeton, [
      { collection: 'employees', cle: 'e1', rang: 0, revision: rev('employees', 'e1'), contenu: { id: 'e1', name: 'Sami Trabelsi', cin: '01234567', attachments: [contrat] } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', supplierId: 's1', number: 'CB-118', date: aujourdhui, lines: [], attachments: [facture] } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: rev('catalog', 'ciment'), contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 21, attachments: [fiche] } },
    ]);
    expect(ecrit.statut, JSON.stringify(ecrit.corps)).toBe(200);
    const commercial = e.membres.commercial?.jeton ?? '', magasinier = e.membres.magasinier?.jeton ?? '';
    // Le commercial ne lit pas la paie : le contrat est refusé, en le disant.
    const refus = await lire(commercial, contrat.file);
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif)).toContain('« Contrat Sami Trabelsi.pdf » est joint à une pièce que ton rôle ne lit pas');
    expect(refus.corps.contenu).toBeUndefined();
    // Le magasinier ne lit ni la paie ni les achats.
    expect((await lire(magasinier, contrat.file)).statut).toBe(403);
    expect((await lire(magasinier, facture.file)).statut).toBe(403);
    // Ce qu'ils lisent s'ouvre : la fiche de l'article (le catalogue), octet pour octet.
    const ok = await lire(commercial, fiche.file);
    expect(ok.statut).toBe(200);
    expect(Buffer.from(String(ok.corps.contenu), 'base64').equals(PDF('Fiche technique ciment.pdf'))).toBe(true);
    expect((await lire(magasinier, fiche.file)).statut).toBe(200);
    // La comptabilité interne lit les achats : la facture s'ouvre.
    expect((await lire(e.membres.comptabilite_interne?.jeton ?? '', facture.file)).statut).toBe(200);
    // Le propriétaire ouvre tout.
    for (const f of [contrat, facture, fiche]) expect((await lire(e.proprio.jeton, f.file)).statut).toBe(200);
    // Un fichier qu'aucune pièce ne porte encore (déposé, pièce pas enregistrée) : son déposant l'ouvre, un autre non.
    const brouillon = await deposer(commercial, 'Photo du chantier.pdf');
    expect((await lire(commercial, brouillon.file)).statut).toBe(200);
    expect((await lire(magasinier, brouillon.file)).statut).toBe(403);
  });
});
