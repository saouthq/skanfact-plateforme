// 1.325.0 — La facture électronique reçue, jusqu'au comptable, côté serveur (base 0203 ; serveur/cabinet/efacture.ts).
// Ce que le serveur garantit :
//   - le client joint à un message le fichier El Fatoora que son fournisseur lui a envoyé (il était refusé : « ni une photo
//     ni un PDF ») ; un XML qui n'est pas une facture électronique reste refusé ;
//   - le cabinet le lit SANS l'IA (ni sa clé, ni l'accord pour ce fichier, ni le réglage du client) : le fournisseur, le
//     numéro, la date et le total, et le détail que seule la facture électronique porte (chaque taux et sa base, le timbre,
//     les lignes et leur remise, la signature, l'avoir) ; deux chemins, un chiffre : le total est le hors taxes plus
//     chaque TVA plus le timbre ;
//   - une facture adressée à une autre société le dit ; un fichier incomplet se refuse en disant pourquoi ;
//   - le cabinet range au classeur un fichier El Fatoora reçu autrement, et le lit de même ; un autre cabinet ne lit rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesClasseur } from '../../serveur/cabinet/classeur.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { ReponseIA } from '../../serveur/achats/lecture-ia.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { routesMessagerie } from '../../serveur/messagerie/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { compact, teifDe } from '../teif-recu.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
// L'IA et le relais d'e-mails, simulés : ce qui leur part se garde ici, pour le compter.
const versIA: Buffer[] = [];
const envoyes: Courriel[] = [];
const LU: ReponseIA = { estUneFacture: true, fournisseur: 'STEG', matricules: [], numero: '0298 4471', date: '2026-09-30', echeance: null, objet: null, devise: 'TND',
  lignes: [], totalHT: '1000.000', totalTVA: '190.000', timbre: null, fodec: null, retenue: null, totalTTC: '1190.000', netAPayer: '1190.000', ou: [], doutes: [] };
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
// Les routes du classeur ont l'IA et le relais d'e-mails ; l'application des tests n'a pas de relais (l'inscription
// demanderait alors un code par e-mail), comme tests/messagerie.
const ctxClasseur: Contexte = { ...ctx,
  lecteurIA: { disponible: false, lire: async (f) => { versIA.push(f); return LU; } },
  courriel: { envoi: { envoyer: async (c) => { envoyes.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
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
// Une vraie photo PNG d'un pixel.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
  return { client, ent, associe, cab: String(cab.id), mandat, autre, cab2: String(cab2.id), ecriture, origine, envoyer };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesCompta(ctx), ...routesV10(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx), ...routesClasseur(ctxClasseur)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

// Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const millimes = (t: string) => BigInt(t.replace('.', ''));

describe('la facture électronique reçue, au cabinet', () => {
  const wafa = { mf: '1600836B/A/M/000', nom: 'GROSSISTE EL WAFA SARL' };
  const lignes = [
    { code: 'PER-850', nom: 'Perceuse à percussion 850 W', qte: 10, pu: 85, taux: 19, remise: 10 },
    { code: 'RAL-10', nom: 'Rallonge 10 m', qte: 4, pu: 12.5, taux: 19 },
    { code: 'LIV-BR', nom: 'Guide du bricolage (livre)', qte: 2, pu: 15, taux: 7 },
  ];
  const deposer = async (d: Awaited<ReturnType<typeof unDossier>>, nom: string, contenu: string) =>
    appeler('POST', `/entreprises/${d.ent}/messages/fichiers`, d.client.jeton, { cote: 'entreprise', nom, contenu });
  const envoyerAuCabinet = async (d: Awaited<ReturnType<typeof unDossier>>, nom: string, xml: string) => {
    const depot = await deposer(d, nom, b64(xml));
    expect(depot.statut, JSON.stringify(depot.corps)).toBe(201);
    expect(depot.corps.type).toBe('application/xml');
    return String((await appeler('POST', `/entreprises/${d.ent}/messages`, d.client.jeton, { cote: 'entreprise', texte: 'La facture du grossiste', fichier: depot.corps.id })).corps.id);
  };
  const lire = (d: Awaited<ReturnType<typeof unDossier>>, quoi: Record<string, string>, jeton = d.associe.jeton, cab = d.cab) =>
    appeler('POST', `/cabinets/${cab}/classeur/${d.ent}/lectures`, jeton, { ...quoi, ia: false });

  it('le client envoie le fichier de son grossiste ; le cabinet le lit sans l\'IA, au millime, taux par taux', async () => {
    const d = await unDossier();
    const MQ = matricule();
    await admin.query('update socle.entreprise set matricule_fiscal = $1 where id = $2', [MQ, d.ent]);
    const fa = teifDe({ numero: 'FA-2026-1187', date: '2026-11-01', echeance: '2026-12-08', fournisseur: wafa, acheteur: { mf: MQ, nom: 'Quincaillerie Ben Salah' }, timbre: 1, lignes });
    const m = await envoyerAuCabinet(d, 'TEIF_FA-2026-1187.xml', fa.xml);
    versIA.length = 0;
    const lu = await lire(d, { message: m });
    expect(lu.statut, JSON.stringify(lu.corps)).toBe(200);
    expect(versIA.length).toBe(0);
    expect(lu.corps).toEqual({
      fournisseur: 'GROSSISTE EL WAFA SARL', numero: 'FA-2026-1187', date: '2026-11-01', total: '1002.950', devise: 'TND', source: 'teif',
      detail: {
        avoir: false, refFacture: null, matricule: '1600836B/A/M/000', signe: true, refTtn: 'TTN-2026-FA-2026-1187', devise: 'TND',
        ht: '845.000', timbre: '1.000', echeance: '2026-12-08', objet: null, ailleurs: null, remarques: [],
        tva: [{ taux: '19', base: '815.000', montant: '154.850' }, { taux: '7', base: '30.000', montant: '2.100' }],
        lignes: [
          { libelle: 'Perceuse à percussion 850 W', quantite: '10', prix: '76.500', taux: '19', ht: '765.000', remise: '10', prixBrut: '85.000' },
          { libelle: 'Rallonge 10 m', quantite: '4', prix: '12.500', taux: '19', ht: '50.000' },
          { libelle: 'Guide du bricolage (livre)', quantite: '2', prix: '15.000', taux: '7', ht: '30.000' },
        ],
      },
    });
    // Deux chemins, un chiffre : le total est le hors taxes, plus chaque TVA, plus le timbre ; et chaque base, ses lignes.
    const det = lu.corps.detail as { ht: string; timbre: string; tva: { taux: string; base: string; montant: string }[]; lignes: { taux: string; ht: string }[] };
    expect(millimes(det.ht) + det.tva.reduce((a, t) => a + millimes(t.montant), 0n) + millimes(det.timbre)).toBe(millimes(String(lu.corps.total)));
    for (const t of det.tva) expect(det.lignes.filter((l) => l.taux === t.taux).reduce((a, l) => a + millimes(l.ht), 0n)).toBe(millimes(t.base));
    // La lecture se garde pour le cabinet, avec sa source et son détail ; une photo, elle, attend l'IA (pas branchée ici).
    const liste = (await appeler('GET', `/cabinets/${d.cab}/classeur/${d.ent}/lectures`, d.associe.jeton)).corps as { ia: boolean; lectures: Record<string, unknown>[] };
    expect(liste.ia).toBe(false);
    expect(liste.lectures).toEqual([expect.objectContaining({ message: m, total: '1002.950', source: 'teif', detail: lu.corps.detail })]);
    const photo = await appeler('POST', `/entreprises/${d.ent}/messages/fichiers`, d.client.jeton, { cote: 'entreprise', nom: 'ticket.png', contenu: PNG });
    const mp = String((await appeler('POST', `/entreprises/${d.ent}/messages`, d.client.jeton, { cote: 'entreprise', texte: 'Un ticket', fichier: photo.corps.id })).corps.id);
    expect((await lire(d, { message: mp })).statut).toBe(503);
    // L'autre cabinet ne lit rien.
    expect((await lire(d, { message: m }, d.autre.jeton, d.cab2)).statut).toBe(404);
  });

  it('l\'avoir, la facture adressée à une autre société, le fichier incomplet, le XML qui n\'est pas une facture ; le classeur', async () => {
    const d = await unDossier();
    const MQ = matricule();
    await admin.query('update socle.entreprise set matricule_fiscal = $1 where id = $2', [MQ, d.ent]);
    // L'avoir d'une perceuse rendue, qui dit la facture qu'il diminue.
    const av = teifDe({ numero: 'AV-2026-0042', avoir: 'FA-2026-1187', date: '2026-11-08', fournisseur: wafa, acheteur: { mf: MQ, nom: 'Quincaillerie Ben Salah' },
      lignes: [{ code: 'PER-850', nom: 'Perceuse (retour)', qte: 1, pu: 85, taux: 19, remise: 10 }] });
    const la = await lire(d, { message: await envoyerAuCabinet(d, 'AV.xml', av.xml) });
    expect(la.statut).toBe(200);
    expect([la.corps.total, (la.corps.detail as Record<string, unknown>).avoir, (la.corps.detail as Record<string, unknown>).refFacture]).toEqual(['91.035', true, 'FA-2026-1187']);
    // Adressée à une autre société (son matricule), et pas encore signée : le détail le dit.
    const autre = teifDe({ numero: 'FA-2026-1190', date: '2026-11-03', fournisseur: wafa, acheteur: { mf: '7654321B/A/M/000', nom: 'Clinique El Amen' }, signe: false, lignes: lignes.slice(1, 2) });
    const lo = await lire(d, { message: await envoyerAuCabinet(d, 'FA-1190.xml', autre.xml) });
    expect(lo.statut).toBe(200);
    expect(lo.corps.detail).toEqual(expect.objectContaining({ signe: false, refTtn: null, ailleurs: { nom: 'Clinique El Amen', identifiant: '7654321B/A/M/000' } }));
    // Un fichier TEIF sans corps : il se joint (c'est un fichier El Fatoora), mais ne se lit pas, et le refus dit pourquoi.
    const vide = `<?xml version="1.0" encoding="UTF-8"?><TEIF version="1.8.8"><InvoiceHeader><MessageSenderIdentifier type="I-01">${compact(wafa.mf)}</MessageSenderIdentifier></InvoiceHeader></TEIF>`;
    const lv = await lire(d, { message: await envoyerAuCabinet(d, 'TEIF_incomplet.xml', vide) });
    expect(lv.statut).toBe(422);
    expect(lv.corps.motif).toBe('« TEIF_incomplet.xml » ne se lit pas : Cette facture électronique n\'a pas de corps (InvoiceBody) : le fichier est incomplet.');
    // Un XML qui n'est pas une facture électronique ne se joint pas.
    const commande = await deposer(d, 'commande.xml', b64('<?xml version="1.0"?><Commande><Numero>12</Numero></Commande>'));
    expect(commande.statut).toBe(415);
    expect(commande.corps.motif).toBe('Le fichier « commande.xml » n\'est ni une photo (JPEG, PNG, WebP), ni un PDF, ni une facture électronique (XML El Fatoora) : il ne se joint pas.');
    // Le cabinet range au classeur un fichier reçu autrement, et le lit de même.
    const fb = teifDe({ numero: 'FA-2026-1203', date: '2026-11-01', fournisseur: wafa, acheteur: { mf: MQ, nom: 'Quincaillerie Ben Salah' }, timbre: 1, lignes: lignes.slice(0, 1) });
    const doc = await appeler('POST', `/cabinets/${d.cab}/classeur/${d.ent}/documents`, d.associe.jeton, { rubrique: 'piece', periode: '2026-11', titre: 'Facture El Wafa', nom: 'FA-1203.xml', contenu: b64(fb.xml) });
    expect(doc.statut, JSON.stringify(doc.corps)).toBe(201);
    const ld = await lire(d, { document: String(doc.corps.id) });
    expect([ld.statut, ld.corps.total, ld.corps.source]).toEqual([200, '911.350', 'teif']);
  });
});
