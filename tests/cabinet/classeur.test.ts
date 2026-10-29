// Le classeur d'un dossier au Cabinet, côté serveur (1.172.0, base 0180 ; serveur/cabinet/classeur.ts). Ce que le serveur
// garantit :
//   - une pièce reçue du client se JOINT à l'écriture de son achat saisi sans justificatif : elle est classée « jointe »,
//     l'écriture la porte comme justificatif, l'achat n'est plus « sans justificatif » ; la détacher défait les trois ;
//   - « jointe » ne s'obtient que par ce geste, qui nomme l'écriture (classer avec la raison « jointe » est refusé) ;
//   - la liste des pièces classées d'UN dossier porte l'écriture jointe ;
//   - un document déposé par le cabinet (une pièce d'un mois, le dossier permanent) se range, se lit octet pour octet, se
//     joint et se détache de même ; un format inconnu, une période absente ou une catégorie manquante sont refusés ;
//   - ni un autre cabinet ni un dossier hors du portefeuille ne lisent rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesClasseur } from '../../serveur/cabinet/classeur.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { routesMessagerie } from '../../serveur/messagerie/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown> & { id?: string; motif?: string; jeton?: string; code?: string; mandat?: string };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
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
// Une vraie photo PNG d'un pixel, un PDF minimal, et des octets qui ne sont ni l'un ni l'autre.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const TEXTE = Buffer.from('ceci n\'est pas une pièce').toString('base64');

// Un achat de 1 190,000 DT (1 000,000 HT, TVA 19 %), saisi par le client SANS justificatif.
const achat = { id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, tvaRecuperable: true,
  lines: [{ label: 'Électricité', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [] };

// Une entreprise qui saisit ses achats, confiée à un cabinet ; un second cabinet, qui n'a rien.
async function unDossier() {
  const client = await personne('client');
  const ent = String((await appeler('POST', '/entreprises-essai', client.jeton)).corps.id);
  await appeler('POST', '/moi/code', client.jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, client.jeton)).corps.objets as { collection: string; cle: string; revision: number }[];
  const envoyer = async (collection: string, cle: string, contenu: unknown) => {
    const revision = (await lire()).find((o) => o.collection === collection && o.cle === cle)?.revision ?? null;
    return appeler('POST', `/entreprises/${ent}/dossier-v10`, client.jeton, { changements: [{ collection, cle, rang: 0, revision, contenu }] });
  };
  expect((await envoyer('suppliers', 's1', { id: 's1', name: 'STEG' })).statut).toBe(200);
  expect((await envoyer('purchases', 'a1', achat)).statut).toBe(200);
  const associe = await personne('associe');
  const cab = (await appeler('POST', '/cabinets', associe.jeton, { nom: 'Jlassi Conseil' })).corps;
  const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(cab.code) })).corps.mandat);
  expect((await appeler('POST', `/cabinets/${String(cab.id)}/mandats/${mandat}/accepter`, associe.jeton)).statut).toBe(200);
  const autre = await personne('autre');
  const cab2 = (await appeler('POST', '/cabinets', autre.jeton, { nom: 'Cabinet Ennour' })).corps;
  const ecriture = String((await admin.query(`select id from compta.ecriture where entreprise = $1 and journal = 'AC'`, [ent])).rows[0].id);
  const origine = String((await admin.query(`select origine from compta.ecriture where id = $1`, [ecriture])).rows[0].origine);
  return { client, ent, associe, cab: String(cab.id), autre, cab2: String(cab2.id), ecriture, origine };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesCompta(ctx), ...routesV10(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx), ...routesClasseur()]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le classeur d\'un dossier', () => {
  it('une pièce reçue se joint à l\'achat saisi sans justificatif : classée « jointe », justificatif de l\'écriture, achat justifié ; détachée, tout se défait', async () => {
    const d = await unDossier();
    const justifie = async () => (await enTantQue(pool, d.client.utilisateur, (tx) => tx.query('select justifie from compta.achats_justifies($1, $2::uuid[])', [d.ent, [d.origine]]))).rows;
    const justificatifs = async () => ((await appeler('GET', `/entreprises/${d.ent}/compta/ecritures/${d.ecriture}/justificatifs`, d.associe.jeton)).corps.justificatifs as { nom: string }[]).map((x) => x.nom);
    expect(await justifie()).toEqual([{ justifie: false }]);
    // Le client envoie la photo de sa facture dans la conversation.
    const depot = await appeler('POST', `/entreprises/${d.ent}/messages/fichiers`, d.client.jeton, { cote: 'entreprise', nom: 'facture-electricite.png', contenu: PNG });
    const msg = String((await appeler('POST', `/entreprises/${d.ent}/messages`, d.client.jeton, { cote: 'entreprise', texte: '', fichier: depot.corps.id })).corps.id);
    // « jointe » ne se pose pas en classant : seulement en joignant, l'écriture nommée.
    expect((await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/classee`, d.associe.jeton, { classee: true, raison: 'jointe' })).statut).toBe(400);
    // Ni le client lui-même, ni l'autre cabinet ne joignent.
    expect((await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/jointe`, d.client.jeton, { ecriture: d.ecriture })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/jointe`, d.autre.jeton, { ecriture: d.ecriture })).statut).toBeGreaterThanOrEqual(403);
    // Le cabinet la joint.
    const j = await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/jointe`, d.associe.jeton, { ecriture: d.ecriture });
    expect(j.statut, JSON.stringify(j.corps)).toBe(200);
    expect(await justifie()).toEqual([{ justifie: true }]);
    expect(await justificatifs()).toEqual(['facture-electricite.png']);
    // La liste des pièces classées DE CE DOSSIER porte l'écriture jointe.
    const classees = (await appeler('GET', `/cabinets/${d.cab}/pieces?classees=1&entreprise=${d.ent}`, d.associe.jeton)).corps.pieces as { id: string; raison: string; jointe: string | null }[];
    expect(classees.map((x) => [x.id, x.raison, x.jointe])).toEqual([[msg, 'jointe', d.ecriture]]);
    // Joindre une seconde fois : la base refuse, la pièce est déjà classée, et le dit.
    const encore = await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/jointe`, d.associe.jeton, { ecriture: d.ecriture });
    expect([encore.statut, typeof encore.corps.motif]).toEqual([403, 'string']);
    expect((await admin.query('select count(*)::int n from messagerie.message where id = $1 and jointe_ecriture = $2', [msg, d.ecriture])).rows).toEqual([{ n: 1 }]);
    // Détacher : la remettre à classer.
    expect((await appeler('POST', `/entreprises/${d.ent}/messages/${msg}/classee`, d.associe.jeton, { classee: false })).statut).toBe(200);
    expect(await justifie()).toEqual([{ justifie: false }]);
    expect(await justificatifs()).toEqual([]);
    expect((await admin.query('select jointe_ecriture from messagerie.message where id = $1', [msg])).rows).toEqual([{ jointe_ecriture: null }]);
  });

  it('un document déposé par le cabinet : rangé, relu octet pour octet, joint puis détaché ; ce qui ne va pas est refusé ; personne d\'autre ne le lit', async () => {
    const d = await unDossier();
    const deposer = (corps: Record<string, unknown>, jeton = d.associe.jeton, cab = d.cab) => appeler('POST', `/cabinets/${cab}/classeur/${d.ent}/documents`, jeton, corps);
    // Les refus : un format inconnu, une pièce sans son mois, le dossier permanent sans sa catégorie.
    expect((await deposer({ rubrique: 'piece', periode: '2026-08', titre: 'Note', nom: 'note.txt', contenu: TEXTE })).statut).toBe(415);
    expect((await deposer({ rubrique: 'piece', titre: 'Facture', nom: 'f.pdf', contenu: PDF })).corps.champ).toBe('periode');
    expect((await deposer({ rubrique: 'permanent', titre: 'Statuts', nom: 's.pdf', contenu: PDF })).corps.champ).toBe('categorie');
    // L'autre cabinet n'a pas ce dossier : il ne range ni ne lit rien.
    expect((await deposer({ rubrique: 'piece', periode: '2026-08', titre: 'Facture', nom: 'f.pdf', contenu: PDF }, d.autre.jeton, d.cab2)).statut).toBe(404);
    // Une pièce d'août et les statuts, rangés.
    const piece = await deposer({ rubrique: 'piece', periode: '2026-08', titre: 'Facture STEG', provenance: 'WhatsApp de Sarra', nom: 'steg.pdf', contenu: PDF });
    expect(piece.statut, JSON.stringify(piece.corps)).toBe(201);
    expect(piece.corps.type).toBe('application/pdf');
    expect((await deposer({ rubrique: 'permanent', categorie: 'juridique', titre: 'Statuts', echeance: '2027-01-31', nom: 'statuts.png', contenu: PNG })).statut).toBe(201);
    const liste = async () => (await appeler('GET', `/cabinets/${d.cab}/classeur/${d.ent}/documents`, d.associe.jeton)).corps as { lectureSeule: unknown; documents: { id: string; rubrique: string; titre: string; raison: string | null; jointe: string | null; provenance: string | null }[] };
    expect((await liste()).lectureSeule).toBeNull();
    expect((await liste()).documents.map((x) => `${x.rubrique} ${x.titre}`).sort()).toEqual(['permanent Statuts', 'piece Facture STEG']);
    expect((await appeler('GET', `/cabinets/${d.cab2}/classeur/${d.ent}/documents`, d.autre.jeton)).statut).toBe(404);
    // Relu octet pour octet.
    const id = String(piece.corps.id);
    expect((await appeler('GET', `/cabinets/${d.cab}/classeur/${d.ent}/documents/${id}`, d.associe.jeton)).corps.contenu).toBe(PDF);
    expect((await appeler('GET', `/cabinets/${d.cab2}/classeur/${d.ent}/documents/${id}`, d.autre.jeton)).statut).toBe(404);
    // Joint à l'achat : l'écriture la porte, l'achat est justifié ; « jointe » sans écriture est refusé.
    const classer = (corps: Record<string, unknown>) => appeler('POST', `/cabinets/${d.cab}/classeur/${d.ent}/documents/${id}/classement`, d.associe.jeton, corps);
    expect((await classer({ classee: true, raison: 'jointe' })).statut).toBe(400);
    expect((await classer({ classee: true, raison: 'jointe', ecriture: d.ecriture })).statut).toBe(200);
    expect((await liste()).documents.find((x) => x.id === id)).toMatchObject({ raison: 'jointe', jointe: d.ecriture, provenance: 'WhatsApp de Sarra' });
    expect(((await appeler('GET', `/entreprises/${d.ent}/compta/ecritures/${d.ecriture}/justificatifs`, d.associe.jeton)).corps.justificatifs as { nom: string }[]).map((x) => x.nom)).toEqual(['steg.pdf']);
    expect((await enTantQue(pool, d.client.utilisateur, (tx) => tx.query('select justifie from compta.achats_justifies($1, $2::uuid[])', [d.ent, [d.origine]]))).rows).toEqual([{ justifie: true }]);
    // Détaché : plus rien.
    expect((await classer({ classee: false })).statut).toBe(200);
    expect((await liste()).documents.find((x) => x.id === id)).toMatchObject({ raison: null, jointe: null });
    expect((await enTantQue(pool, d.client.utilisateur, (tx) => tx.query('select justifie from compta.achats_justifies($1, $2::uuid[])', [d.ent, [d.origine]]))).rows).toEqual([{ justifie: false }]);
    // Un document ne s'efface pas : la base le refuse même au cabinet.
    await expect(enTantQue(pool, d.associe.utilisateur, (tx) => tx.query('delete from cabinet.document where id = $1', [id]))).rejects.toThrow();
  });
});
