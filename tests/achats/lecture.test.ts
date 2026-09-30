// La lecture d'une facture d'achat par le serveur (brique 84 ; 14 § 2.3 ; docs/achats.md), avec le VRAI
// moteur (Tesseract et Poppler, installés sur la machine des tests comme sur le serveur) et les pièces
// d'essai du dépôt (tests/donnees/lecture). Ce que le serveur garantit :
//   - une photo, un PDF écrit par un logiciel, un PDF scanné se lisent : une PROPOSITION, rien d'enregistré ;
//   - le fichier n'est pas gardé : rien ne reste sur le serveur après la lecture ;
//   - ce qui n'est ni une photo ni un PDF, ou trop lourd, se refuse sans rien lire ; un serveur sans moteur
//     le dit ; au-delà de sa file, le lecteur dit qu'il est occupé ;
//   - seuls ceux qui préparent un achat lisent (03 § 2.3 : propriétaire, administrateur, comptabilité).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { creerLecteur, lecteurDuServeur, type Lecteur } from '../../serveur/achats/lecteur.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const DONNEES = path.join(import.meta.dirname, '../donnees/lecture');
const piece = (nom: string) => fs.readFileSync(path.join(DONNEES, nom)).toString('base64');
const net = (s: unknown) => String(s).replace(/[\u00a0\u202f]/g, ' ');

type Reponse = { statut: number; corps: Record<string, unknown> };
const apps: FastifyInstance[] = [];
async function serveur(lecteur: Lecteur | undefined) {
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    ...(lecteur ? { lecteur } : {}) };
  const app = creerApp(ctx, [...routesSocle(ctx), ...routesAchats(ctx), ...routesV10(ctx)]);
  await app.ready();
  apps.push(app);
  return async (methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() };
  };
}
let appeler: Awaited<ReturnType<typeof serveur>>;

async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { jeton, utilisateur };
}
// Nadia et son atelier : l'acheteur, dont le matricule est sur chaque pièce d'essai.
async function atelier() {
  const nadia = await personne('nadia');
  const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
  const fiche = ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown>; revision: number }[])
    .find((x) => x.collection === '_racine' && x.cle === 'company');
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
    { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, matricule: '7654321B/A/M/000' } }] });
  return { ...nadia, ent, lire: (nom: string, contenu: string, jeton = nadia.jeton) => appeler('POST', `/entreprises/${ent}/achats/lecture`, jeton, { nom, contenu }) };
}
const restes = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('skanfact-lecture-'));

beforeAll(async () => {
  await admin.connect();
  declarerGestesAchats();
  declarerGestesVentes();
  appeler = await serveur(await lecteurDuServeur());
});
afterAll(async () => { for (const a of apps) await a.close(); await admin.end(); await pool.end(); });

describe('la lecture d\'une facture d\'achat par le serveur', () => {
  it('une photo se lit : la proposition, où chaque champ a été lu, le total recompté ; rien n\'est gardé sur le serveur', async () => {
    const a = await atelier();
    expect((await appeler('GET', `/entreprises/${a.ent}/achats/lecture`, a.jeton)).corps).toEqual({ disponible: true, limite: String(10 * 1_048_576) });
    const avant = restes();
    const r = await a.lire('facture-fournisseur.jpg', piece('quincaillerie-photo.jpg'));
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({ moteur: 'photo', pages: 1 });
    expect(r.corps.lecture).toMatchObject({ supplier: 'Quincaillerie Ben Salem', matricule: '1234567A/B/M/000', number: 'FV-2026-0412', date: '2026-10-03', dueDate: '2026-11-02',
      fees: '1.000', totalHT: '279.850', totalTTC: '332.222',
      lines: [{ label: 'Vis inox 6x40 (boîte de 200)', qty: '3', unitPrice: '42.35', vatRate: '19' }, { label: 'Colle à bois 5 kg', qty: '2', unitPrice: '68.9', vatRate: '19' },
        { label: 'Livraison', qty: '1', unitPrice: '15', vatRate: '7' }] });
    expect((r.corps.remarques as string[]).map(net)).toEqual(['Recompté depuis les montants lus, le total fait 332,222 DT : c\'est celui de la pièce.']);
    expect(r.corps.ou).toMatchObject({ matricule: 'MF 1234567A/B/M/000 FV-2026-0412', fees: 'Timbre fiscal 1,000' });
    // Le fichier a vécu le temps de la lecture, dans un dossier à part, puis s'est effacé.
    expect(restes()).toEqual(avant);
    // Une proposition n'enregistre rien : aucun achat, aucun fournisseur.
    expect((await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection in (\'purchases\', \'suppliers\')', [a.ent])).rows[0].n).toBe(0);
  });

  it('un PDF écrit par un logiciel se lit tel quel (son texte) ; un PDF scanné se lit page par page, comme une photo', async () => {
    const a = await atelier();
    const pdf = await a.lire('FV-2026-0412.pdf', piece('quincaillerie.pdf'));
    expect(pdf.statut, JSON.stringify(pdf.corps)).toBe(200);
    expect(pdf.corps).toMatchObject({ moteur: 'pdf', pages: 1, lecture: { matricule: '1234567A/B/M/000', number: 'FV-2026-0412', totalTTC: '332.222' } });
    const scan = await a.lire('scan.pdf', piece('quincaillerie-scan.pdf'));
    expect(scan.statut, JSON.stringify(scan.corps)).toBe(200);
    expect(scan.corps).toMatchObject({ moteur: 'photo', pages: 1, lecture: { matricule: '1234567A/B/M/000', number: 'FV-2026-0412', date: '2026-10-03', totalTTC: '332.222' } });
    expect((scan.corps.remarques as string[]).map(net)[0]).toBe('Recompté depuis les montants lus, le total fait 332,222 DT : c\'est celui de la pièce.');
  });

  it('l\'acheteur, c\'est la fiche de l\'entreprise : son matricule n\'est jamais pris pour celui du fournisseur', async () => {
    // Une entreprise dont la fiche porte le matricule que la pièce imprime EN PREMIER : l'autre est le fournisseur.
    const a = await atelier();
    const fiche = ((await appeler('GET', `/entreprises/${a.ent}/dossier-v10`, a.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown>; revision: number }[])
      .find((x) => x.collection === '_racine' && x.cle === 'company');
    await appeler('POST', `/entreprises/${a.ent}/dossier-v10`, a.jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, matricule: '1234567A/B/M/000' } }] });
    const r = await a.lire('FV-2026-0412.pdf', piece('quincaillerie.pdf'));
    expect(r.corps.lecture).toMatchObject({ matricule: '7654321B/A/M/000' });
  });

  it('ce qui n\'est ni une photo ni un PDF, ou trop lourd, se refuse sans rien lire', async () => {
    const a = await atelier();
    // Le nom ne compte pas : ce sont les premiers octets du fichier qui disent ce qu'il est.
    const texte = await a.lire('facture.jpg', Buffer.from('Facture N° 12 : 100,000 DT').toString('base64'));
    expect(texte).toEqual({ statut: 415, corps: { motif: 'Le fichier « facture.jpg » n\'est ni une photo (JPEG, PNG, WEBP) ni un PDF : rien n\'a été lu.', bouton: null } });
    const lourd = Buffer.concat([fs.readFileSync(path.join(DONNEES, 'materiaux.png')), Buffer.alloc(11 * 1_048_576 - 177_168)]);
    const r = await a.lire('photo-geante.png', lourd.toString('base64'));
    expect(r.statut).toBe(413);
    expect(net(r.corps.motif)).toBe('Le fichier « photo-geante.png » fait 11,0 Mo : au-delà de 10 Mo, il ne se lit pas. Prends une photo moins lourde.');
  });

  it('un serveur sans moteur le dit ; au-delà de sa file, le lecteur dit qu\'il est occupé', async () => {
    const principal = appeler;
    try {
      appeler = await serveur(undefined);
      const a = await atelier();
      expect((await appeler('GET', `/entreprises/${a.ent}/achats/lecture`, a.jeton)).corps).toMatchObject({ disponible: false });
      expect(await a.lire('facture.pdf', piece('quincaillerie.pdf'))).toEqual({ statut: 503,
        corps: { motif: 'La lecture des factures n\'est pas branchée sur ce serveur : rien n\'a été lu. Saisis la facture à la main.', bouton: null } });

      // Un lecteur qui ne lit qu'une pièce à la fois, sans file : la seconde demande est « occupé ».
      let liberer = () => {};
      const lent = creerLecteur(async () => { await new Promise<void>((ok) => { liberer = ok; }); return { texte: 'Total TTC 10,000', moteur: 'photo', pages: 1 }; }, { simultanees: 1, attente: 0 });
      appeler = await serveur(lent);
      const b = await atelier();
      const premiere = b.lire('a.png', piece('materiaux.png'));
      await new Promise((ok) => setTimeout(ok, 200));
      const seconde = await b.lire('b.png', piece('materiaux.png'));
      expect(seconde).toEqual({ statut: 503, corps: { motif: 'Le lecteur de factures est occupé : réessaie dans une minute.', bouton: null } });
      liberer();
      expect((await premiere).statut).toBe(200);
      // Le créneau rendu, la lecture suivante passe.
      const suivante = b.lire('c.png', piece('materiaux.png'));
      await new Promise((ok) => setTimeout(ok, 200));
      liberer();
      expect((await suivante).statut).toBe(200);
    } finally { appeler = principal; }
  });

  it('seuls ceux qui préparent un achat lisent : un commercial ne lit pas (03 § 2.3)', async () => {
    const a = await atelier();
    const karim = await personne('karim');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, \'{commercial}\')', [karim.utilisateur, a.ent]);
    const r = await a.lire('facture.jpg', piece('quincaillerie-photo.jpg'), karim.jeton);
    expect(r.statut).toBe(403);
    expect(net(r.corps.motif)).toMatch(/lire une facture d'achat en photo ou en PDF/);
    const comptable = await personne('samia');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, \'{comptabilite_interne}\')', [comptable.utilisateur, a.ent]);
    expect((await a.lire('facture.pdf', piece('quincaillerie.pdf'), comptable.jeton)).statut).toBe(200);
  });
});
