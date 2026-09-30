// La facture électronique (brique 80 ; docs/facture-electronique.md ; 05 § 3.1), par l'API. Ce que le
// serveur garantit :
//   - à l'émission, le fichier TEIF de la facture (et de l'avoir) est écrit et gardé : il passe le schéma
//     officiel de la TTN (xmllint), il dit les montants que le serveur a scellés, et il ne se réécrit
//     jamais (le compte du serveur ne peut ni le changer ni l'effacer) ;
//   - une entreprise soumise n'émet pas une pièce dont le fichier serait refusé : c'est dit AVANT le
//     numéro (aucun numéro n'est pris) ;
//   - une entreprise non soumise émet quand même ; sa pièce n'a alors pas de fichier du serveur.

import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { ecartAvecLeServeur } from '../../serveur/v10/teif.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
const XSD = path.join(import.meta.dirname, '../donnees/teif/teif-1.8.8-withoutSig.xsd');

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
// Un nombre de la v10 tel que l'écran l'envoie (un non-entier en texte exact).
const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

let n = 0;
// Une entreprise d'essai, sa fiche (matricule complet ou non, soumise ou non), et la Menuiserie.
async function essai(o: { matricule?: string; soumise: boolean; client: string }) {
  const email = `efacture-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Facture ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const objets = await lire();
  const societe = objets.find((x) => x.collection === '_racine' && x.cle === 'company');
  const menuiserie = objets.find((x) => x.collection === 'clients' && String(x.contenu.name).startsWith('Menuiserie'));
  if (!menuiserie) throw new Error('client d\'exemple absent');
  const client = { ...menuiserie.contenu, matricule: o.client };
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
    { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, matricule: o.matricule ?? '', efacture: o.soumise } },
    { collection: 'clients', cle: menuiserie.cle, rang: menuiserie.rang, revision: menuiserie.revision, contenu: client },
  ] });
  const co = { ...(societe?.contenu ?? {}), currency: 'DT', stampFee: 1 } as { currency: string; stampFee: number };
  // Émettre une pièce : le net à payer est celui que l'écran de la v10 calcule (le banc de la v10).
  const emettre = async (doc: DocV10 & Record<string, unknown>, rang: number) => {
    await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: String(doc.id), rang, revision: null, contenu: enc(doc) }] });
    const net = v10.computeTotals(doc, co).netToPay.toFixed(3);
    return appeler('POST', `/entreprises/${ent}/dossier-v10/${doc.type === 'avoir' ? 'emettre-avoir' : 'emettre'}`, jeton, { document: enc(doc), client, revision: 1, rang, netAPayer: net });
  };
  return { jeton, ent, lire, emettre, client: menuiserie.cle, teif: (cle: string) => appeler('GET', `/entreprises/${ent}/dossier-v10/${cle}/teif`, jeton) };
}
// Deux lignes à deux taux, une remise globale et une ligne hors remise : des montants qui discriminent.
const facture = (id: string, client: string) => {
  const d: Record<string, unknown> = {
    id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: client, subject: 'Mobilier', status: 'brouillon',
    lines: [
      { label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: 450.5, vatRate: 19 },
      { label: 'Pose', description: 'Sur site', qty: 3, unit: 'h', unitPrice: 37.333, vatRate: 7 },
      { label: 'Livraison', description: '', qty: 1, unit: '', unitPrice: 25, vatRate: 19, noDiscount: true },
    ],
    discountRate: 5, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
  };
  return d as DocV10 & Record<string, unknown>;
};
// Le schéma officiel, relu par xmllint (il doit être là : un schéma non relu annoncerait « tout va bien »).
function valider(xml: string) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teif-')), 'piece.xml');
  fs.writeFileSync(f, xml);
  const r = cp.spawnSync('xmllint', ['--noout', '--schema', XSD, f], { encoding: 'utf8' });
  if (r.error) throw new Error('xmllint est introuvable : le schéma TEIF ne serait pas relu');
  return { ok: r.status === 0, sortie: `${r.stdout}${r.stderr}` };
}
// Les deux assertions XSD 1.1 que le schéma 1.0 a perdues : le matricule de l'émetteur et du fournisseur.
function matriculesXsd11(xml: string) {
  const mf = /^[0-9]{7}[ABCDEFGHJKLMNPQRSTVWXYZ][ABDNP][CMNP]000$/;
  expect(mf.test(/<MessageSenderIdentifier type="I-01">([^<]*)</.exec(xml)?.[1] ?? '')).toBe(true);
  expect(mf.test(/functionCode="I-62">\s*<Nad>\s*<PartnerIdentifier type="I-01">([^<]*)</.exec(xml)?.[1] ?? '')).toBe(true);
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la facture électronique', () => {
  it('à l\'émission, le fichier TEIF est écrit, passe le schéma, dit les montants scellés, et ne se réécrit jamais', async () => {
    const e = await essai({ matricule: '7654321B/A/M/000', soumise: true, client: '1234567A/A/M/000' });
    expect((await e.emettre(facture('f1', e.client), 0)).statut).toBe(200);
    const f = await e.teif('f1');
    expect(f.statut).toBe(200);
    const xml = String(f.corps.xml);
    expect(f.corps.nom).toBe('TEIF_7654321BAM000_FAC-2026-001.xml');
    const schema = valider(xml);
    expect(schema.ok, schema.sortie).toBe(true);
    matriculesXsd11(xml);
    expect(xml).toContain('<DocumentIdentifier>FAC-2026-001</DocumentIdentifier>');
    // Les montants du fichier sont ceux que le serveur a scellés (la liste des ventes les lit).
    const ventes = (await appeler('GET', `/entreprises/${e.ent}/ventes`, e.jeton)).corps.lignes as { id: string; numero: string }[];
    const piece = (await appeler('GET', `/entreprises/${e.ent}/ventes/${ventes.find((v) => v.numero === 'FAC-2026-001')?.id}`, e.jeton)).corps as { totaux: Record<string, string> };
    expect(ecartAvecLeServeur(xml, { ttc: piece.totaux.total_ttc ?? '', tva: piece.totaux.total_tva ?? '', ht: piece.totaux.net_ht ?? '' })).toBe(null);
    expect(piece.totaux.total_ttc).toBe(v10.computeTotals(facture('f1', e.client), { currency: 'DT', stampFee: 1 }).totalTTC.toFixed(3));
    // Un fichier qui dirait un autre montant se voit (le contrôle de l'émission).
    const fausse = xml.replace(/(amountTypeCode="I-181">\s*<Amount currencyIdentifier="TND">)([0-9.]+)/, (_t, a: string, m: string) => `${a}${(Number(m) + 0.001).toFixed(3)}`);
    expect(ecartAvecLeServeur(fausse, { ttc: piece.totaux.total_ttc ?? '', tva: piece.totaux.total_tva ?? '', ht: piece.totaux.net_ht ?? '' })).toMatchObject({ code: 'I-181' });
    // Gardé tel qu'écrit : son empreinte, et le compte du serveur ne peut ni le changer ni l'effacer.
    const garde = (await admin.query('select empreinte, version from ventes.efacture where entreprise = $1', [e.ent])).rows[0] as { empreinte: string; version: string };
    expect(garde).toEqual({ empreinte: createHash('sha256').update(xml, 'utf8').digest('hex'), version: '1.8.8' });
    await expect(pool.query('update ventes.efacture set xml = $1', ['<faux/>'])).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('delete from ventes.efacture')).rejects.toMatchObject({ code: '42501' });
    // Le même fichier chaque fois.
    expect((await e.teif('f1')).corps.xml).toBe(xml);

    // L'avoir : son fichier renvoie à la facture qu'il corrige (I-89), et passe le schéma.
    const avoir = { id: 'a1', type: 'avoir', number: '', date: '2026-10-10', clientId: e.client, creditOf: 'f1', creditOfNumber: 'FAC-2026-001', creditReason: 'Une table rendue', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: 450.5, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [] };
    expect((await e.emettre(avoir, 1)).statut).toBe(200);
    const fa = String((await e.teif('a1')).corps.xml);
    expect(fa).toMatch(/<DocumentType code="I-12">/);
    expect(fa).toMatch(/<Reference refID="I-89">FAC-2026-001<\/Reference>\s*<ReferenceDate>\s*<DateText format="ddMMyy" functionCode="I-31">011026<\/DateText>/);
    const schemaAvoir = valider(fa);
    expect(schemaAvoir.ok, schemaAvoir.sortie).toBe(true);
  });

  it('soumise, une pièce dont le fichier serait refusé ne s\'émet pas : c\'est dit avant le numéro', async () => {
    // Le matricule de la Menuiserie s'arrête à la lettre-clé.
    const e = await essai({ matricule: '7654321B/A/M/000', soumise: true, client: '1234567A' });
    const refus = await e.emettre(facture('f1', e.client), 0);
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif)).toMatch(/^Ton entreprise est soumise à la facture électronique, et le fichier El Fatoora de cette pièce serait refusé : L'identifiant de Menuiserie du Lac \(exemple\) ne va pas : le matricule « 1234567A » s'arrête à la lettre-clé.* Rien n'a été émis, aucun numéro n'a été pris\.$/);
    expect((await e.lire()).find((o) => o.collection === 'documents' && o.cle === 'f1')?.contenu).toMatchObject({ number: '', status: 'brouillon' });
    expect((await admin.query("select count(*)::int n from ventes.piece where entreprise = $1 and statut = 'emise'", [e.ent])).rows[0].n).toBe(0);
    // Le matricule complété : la pièce s'émet, et prend le PREMIER numéro (aucun n'a été perdu).
    const menuiserie = (await e.lire()).find((o) => o.collection === 'clients' && o.cle === e.client);
    if (!menuiserie) throw new Error('client absent');
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: 'clients', cle: e.client, rang: menuiserie.rang, revision: menuiserie.revision, contenu: { ...menuiserie.contenu, matricule: '1234567A/A/M/000' } }] });
    const document = { ...facture('f1', e.client) };
    const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
    const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: enc(document), client,
      revision: 1, rang: 0, netAPayer: v10.computeTotals(document, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) });
    expect(r).toMatchObject({ statut: 200, corps: { numero: 'FAC-2026-001' } });
    expect((await e.teif('f1')).statut).toBe(200);

    // Soumise sans matricule à elle : refusé aussi, et dit.
    const vide = await essai({ soumise: true, client: '1234567A/A/M/000' });
    expect(String((await vide.emettre(facture('f1', vide.client), 0)).corps.motif)).toContain('Ton matricule fiscal est vide : El Fatoora identifie l\'émetteur par lui.');
  });

  it('non soumise, la pièce s\'émet quand même ; elle n\'a pas de fichier du serveur', async () => {
    const e = await essai({ matricule: '7654321B/A/M/000', soumise: false, client: '1234567A' });
    expect(await e.emettre(facture('f1', e.client), 0)).toMatchObject({ statut: 200, corps: { numero: 'FAC-2026-001' } });
    expect(await e.teif('f1')).toMatchObject({ statut: 404, corps: { motif: 'Cette pièce n\'a pas de fichier El Fatoora écrit par le serveur.' } });
    // Sa fiche complète, la suivante a le sien, même non soumise.
    const menuiserie = (await e.lire()).find((o) => o.collection === 'clients' && o.cle === e.client);
    if (!menuiserie) throw new Error('client absent');
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: 'clients', cle: e.client, rang: menuiserie.rang, revision: menuiserie.revision, contenu: { ...menuiserie.contenu, matricule: '1234567A/A/M/000' } }] });
    const document = facture('f2', e.client);
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: 'documents', cle: 'f2', rang: 1, revision: null, contenu: enc(document) }] });
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: enc(document), client: { ...menuiserie.contenu, matricule: '1234567A/A/M/000' },
      revision: 1, rang: 1, netAPayer: v10.computeTotals(document, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) })).statut).toBe(200);
    expect((await e.teif('f2')).statut).toBe(200);
  });
});
