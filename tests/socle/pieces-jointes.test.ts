// Les pièces jointes du dossier (lot Fonctions 3 ; serveur/v10/pieces-jointes.ts, base 0160 ; docs/pieces-jointes.md),
// par l'API. Ce que le serveur garantit :
//   - une photo ou un PDF revient octet pour octet, avec la fiche que la pièce garde (nom, identifiant, taille, date), et
//     son empreinte ; il est gardé dix ans ;
//   - ce qui n'est ni une photo ni un PDF (reconnu aux octets, jamais au nom) et ce qui dépasse 10 Mo se refusent ;
//   - ni la voisine, ni le cabinet qui tient l'entreprise ne le lisent ; le cabinet n'en dépose pas ;
//   - qui l'a déposé l'efface le jour même ; après vingt-quatre heures, ou déposé par un autre, il reste jusqu'à sa date
//     et la réponse le dit ; il ne se réécrit jamais.

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { LIMITE_PIECE, routesPiecesJointes } from '../../serveur/v10/pieces-jointes.ts';

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
  emails.set(jeton, email);
  return jeton;
}
const emails = new Map<string, string>();
const entreprise = async (jeton: string, nom: string) => String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
const deposer = (ent: string, jeton: string, nom: string, octets: Buffer) => appeler('POST', `/entreprises/${ent}/pieces-jointes`, jeton, { nom, contenu: octets.toString('base64') });
// Un PDF qui discrimine : ses octets ne sont pas ceux d'un autre fichier du test, et son texte se relit.
const pdf = (texte: string) => Buffer.from(`%PDF-1.4\n% ${texte}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const aTunis = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx), ...routesPiecesJointes()]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les pièces jointes du dossier', () => {
  it('un PDF revient octet pour octet, avec sa fiche et son empreinte, gardé dix ans', async () => {
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const octets = pdf('Devis signe DEV-2026-031, 1 488,501 DT');
    const r = await deposer(ent, nadia, 'Devis signé DEV-2026-031.pdf', octets);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const aujourdhui = aTunis(new Date());
    expect(r.corps).toMatchObject({ name: 'Devis signé DEV-2026-031.pdf', size: octets.length, date: aujourdhui, type: 'application/pdf' });
    const dixAns = `${Number(aujourdhui.slice(0, 4)) + 10}${aujourdhui.slice(4)}`;
    expect(r.corps.conserverJusquAu).toBe(dixAns);
    const lu = await appeler('GET', `/entreprises/${ent}/pieces-jointes/${String(r.corps.file)}`, nadia);
    expect(lu.statut).toBe(200);
    expect(Buffer.from(String(lu.corps.contenu), 'base64').equals(octets)).toBe(true);
    expect(lu.corps).toMatchObject({ nom: 'Devis signé DEV-2026-031.pdf', type: 'application/pdf', taille: octets.length });
    const enBase = (await admin.query('select empreinte, conserver_jusqu_au::text c from socle.piece_jointe where id = $1', [r.corps.file])).rows[0];
    expect(enBase).toEqual({ empreinte: createHash('sha256').update(octets).digest('hex'), c: dixAns });
    // Jamais réécrit : le compte de l'application ne peut pas le changer.
    await expect(pool.query('update socle.piece_jointe set nom = $2 where id = $1', [r.corps.file, 'autre'])).rejects.toThrow(/permission/);
  });

  it('ni photo ni PDF (aux octets, pas au nom), ou plus de 10 Mo : refusé, rien de gardé', async () => {
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const faux = await deposer(ent, nadia, 'facture.pdf', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(faux.statut).toBe(415);
    expect(String(faux.corps.motif)).toContain('« facture.pdf » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF');
    const lourd = Buffer.concat([pdf('lourd'), Buffer.alloc(LIMITE_PIECE + 1 - pdf('lourd').length, 0x20)]);
    const trop = await deposer(ent, nadia, 'Scan.pdf', lourd);
    expect(trop.statut).toBe(413);
    expect(String(trop.corps.motif)).toContain('« Scan.pdf » pèse 10,0 Mo');
    expect((await admin.query('select count(*)::int n from socle.piece_jointe where entreprise = $1', [ent])).rows[0].n).toBe(0);
  });

  it('ni la voisine ni le cabinet qui tient l\'entreprise ne le lisent ; le cabinet n\'en dépose pas', async () => {
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const r = await deposer(ent, nadia, 'Photo du chantier.png', PNG);
    expect(r.statut).toBe(201);
    const voisine = await personne('voisine');
    await entreprise(voisine, 'Librairie du Lac');
    expect((await appeler('GET', `/entreprises/${ent}/pieces-jointes/${String(r.corps.file)}`, voisine)).statut).toBe(404);
    // Le cabinet de Nadia, avec un mandat accepté.
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, nadia, { codeCabinet: String(c.corps.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${String(c.corps.id)}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/pieces-jointes/${String(r.corps.file)}`, associe)).statut).toBe(403);
    const parLeCabinet = await deposer(ent, associe, 'Relevé.pdf', pdf('releve'));
    expect(parLeCabinet.statut).toBe(403);
    expect((await admin.query('select count(*)::int n from socle.piece_jointe where entreprise = $1', [ent])).rows[0].n).toBe(1);
  });

  it('qui l\'a déposé l\'efface le jour même ; après 24 heures, ou déposé par un autre, il reste jusqu\'à sa date', async () => {
    const nadia = await personne('nadia');
    const ent = await entreprise(nadia, 'Transports Ben Youssef');
    const erreur = await deposer(ent, nadia, 'Mauvais fichier.png', PNG);
    const retire = await appeler('DELETE', `/entreprises/${ent}/pieces-jointes/${String(erreur.corps.file)}`, nadia);
    expect(retire.corps).toEqual({ efface: true });
    expect((await admin.query('select count(*)::int n from socle.piece_jointe where id = $1', [erreur.corps.file])).rows[0].n).toBe(0);

    const ancien = await deposer(ent, nadia, 'Facture fournisseur.pdf', pdf('fournisseur'));
    await admin.query(`update socle.piece_jointe set depose_le = now() - interval '25 hours' where id = $1`, [ancien.corps.file]);
    const garde = await appeler('DELETE', `/entreprises/${ent}/pieces-jointes/${String(ancien.corps.file)}`, nadia);
    expect(garde.corps).toEqual({ efface: false, conserverJusquAu: ancien.corps.conserverJusquAu });
    expect((await admin.query('select count(*)::int n from socle.piece_jointe where id = $1', [ancien.corps.file])).rows[0].n).toBe(1);

    // Un administrateur de l'entreprise ne retire pas, même le jour même, ce que Nadia a déposé.
    const karim = await personne('karim');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) select u.id, $2, $3 from socle.utilisateur u where u.email = $1', [emails.get(karim), ent, ['administrateur']]);
    const recent = await deposer(ent, nadia, 'Bon de commande.png', PNG);
    const parKarim = await appeler('DELETE', `/entreprises/${ent}/pieces-jointes/${String(recent.corps.file)}`, karim);
    expect(parKarim.corps).toMatchObject({ efface: false });
  });
});
