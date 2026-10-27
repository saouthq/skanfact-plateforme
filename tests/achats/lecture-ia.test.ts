// La lecture d'une facture d'achat par l'IA de Claude (Anthropic), hors de Tunisie (décision du 24/10/2026, branchée le
// 27/10/2026 ; serveur/achats/lecture-ia.ts). Aucun appel réel ne part d'un test : l'IA est jouée par un essai. Ce que le
// serveur garantit :
//   - ce qui part est compté : la pièce et la consigne, rien d'autre (ni le nom ni le matricule de l'entreprise) ;
//   - la réponse de l'IA n'est crue qu'à sa forme ; un refus, une panne, une réponse hors forme ne se devinent pas ;
//   - deux chemins, un chiffre : le total se recompte ici, et un doute sur une quantité se départage par ce recomptage ;
//   - l'IA ne sert que si la personne a dit oui pour ce fichier, que le serveur a sa clé et que l'entreprise ne l'a
//     pas coupée ; c'est la seule lecture (27/10/2026, Skander : celle de nos serveurs se trompait trop) : sans elle,
//     ou si elle ne répond pas, rien n'est lu et la phrase dit pourquoi ;
//   - ce qui n'est ni une photo ni un PDF, ou trop lourd, se refuse sans rien envoyer ; seuls ceux qui préparent un
//     achat lisent (03 § 2.3 : propriétaire, administrateur, comptabilité).

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { appelAnthropic, CONSIGNE, creerLecteurIA, enEntier, IAIndisponible, IARefuse, propositionDeLIA, type AppelIA, type ReponseIA } from '../../serveur/achats/lecture-ia.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { libererMatricule } from '../matricule-libre.ts';
import { rendreTout } from '../../textes/index.ts';

const NOUS = '7654321B/A/M/000';
// La facture de Bureau Plus Sfax (celle de la maquette) : 20 ramettes à 12,500 et des cartouches à 48,900, dont la
// quantité est floue (6 ou 8) ; 543,400 HT, 103,246 de TVA à 19 %, 1,000 de timbre : 647,646 TTC.
const bureauPlus = (o: Partial<ReponseIA> = {}): ReponseIA => ({
  estUneFacture: true, fournisseur: 'Bureau Plus Sfax',
  matricules: [{ valeur: NOUS, de: 'client' }, { valeur: '1390022T/A/M/000', de: 'emetteur' }],
  numero: 'BP-8812', date: '2026-10-23', echeance: null, objet: null, devise: 'TND',
  lignes: [
    { designation: 'Ramettes A4', quantite: '20', prixUnitaire: '12.500', remise: null, tauxTva: '19', totalHT: '250.000' },
    { designation: 'Cartouches d\'encre', quantite: '6', prixUnitaire: '48.900', remise: null, tauxTva: '19', totalHT: null },
  ],
  totalHT: '543.400', totalTVA: '103.246', timbre: '1.000', fodec: null, retenue: null, totalTTC: '647.646', netAPayer: '647.646',
  ou: [{ champ: 'numero', texte: 'Facture n° BP-881?' }, { champ: 'matricule', texte: 'MF 1390022T/A/M/000' }],
  doutes: [
    { champ: 'numero', ligne: null, valeurs: ['BP-8812', 'BP-8813'], raison: 'le dernier chiffre est flou' },
    { champ: 'quantite', ligne: 2, valeurs: ['6', '8'], raison: 'quantité tachée', zone: [80, 520, 840, 60] },
  ],
  ...o,
});
const texte = (x: unknown) => String(typeof x === 'string' ? x : rendreTout(x, 'fr')).replace(/[\u00a0\u202f]/g, ' ');

describe('la réponse de l\'IA, relue et recomptée', () => {
  it('rend la proposition attendue par la relecture, avec le fournisseur pris à l\'émetteur, jamais à nous', () => {
    const p = propositionDeLIA(bureauPlus(), { notreMatricule: NOUS });
    expect(p.lecture).toEqual({
      supplier: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000', number: 'BP-8812', date: '2026-10-23', dueDate: null, subject: null, currency: 'TND',
      fees: '1.000', totalHT: '543.400', totalTTC: '647.646',
      lines: [{ label: 'Ramettes A4', qty: '20', unitPrice: '12.5', vatRate: '19' }, { label: 'Cartouches d\'encre', qty: '6', unitPrice: '48.9', vatRate: '19' }],
    });
    expect(p.ou).toMatchObject({ number: 'Facture n° BP-881?', matricule: 'MF 1390022T/A/M/000' });
    expect(p.controle).toEqual({ recompte: 647_646n, lu: 647_646n, juste: true });
    expect(texte(p.remarques[0])).toContain('647,646 DT');
    // Un matricule « inconnu » qui est le nôtre ne devient jamais celui du fournisseur.
    const seul = propositionDeLIA(bureauPlus({ matricules: [{ valeur: '7654321 B/A/M/000', de: 'inconnu' }] }), { notreMatricule: NOUS });
    expect(seul.lecture.matricule).toBeNull();
  });

  it('départage un doute sur une quantité par le recomptage : avec 8 cartouches, les lignes ne tombent pas sur le hors-taxes', () => {
    const p = propositionDeLIA(bureauPlus(), { notreMatricule: NOUS });
    expect(p.doutes).toEqual([
      { champ: 'numero', ligne: null, valeurs: [{ valeur: 'BP-8812', juste: null }, { valeur: 'BP-8813', juste: null }], raison: 'le dernier chiffre est flou', zone: null },
      { champ: 'quantite', ligne: 1, valeurs: [{ valeur: '6', juste: true }, { valeur: '8', juste: false }], raison: 'quantité tachée', zone: [80, 520, 840, 60] },
    ]);
  });

  it('la zone d\'un doute ne passe que si elle tient dans l\'image, en millièmes', () => {
    const zone = (z: number[]) => propositionDeLIA(bureauPlus({ doutes: [{ champ: 'numero', ligne: null, valeurs: ['BP-8812', 'BP-8813'], raison: 'flou', zone: z }] })).doutes[0]?.zone;
    expect(zone([100, 40, 300, 30])).toEqual([100, 40, 300, 30]);
    expect([zone([]), zone([100, 40, 300]), zone([800, 40, 300, 30]), zone([100, 40, 0, 30]), zone([-5, 40, 300, 30]), zone([10.5, 40, 300, 30])]).toEqual([null, null, null, null, null, null]);
  });

  it('dit l\'écart quand le total recompté ne tombe pas sur celui de la pièce, sans rien choisir', () => {
    const p = propositionDeLIA(bureauPlus({ totalTVA: '103.264' }), { notreMatricule: NOUS });
    expect(p.controle).toEqual({ recompte: 647_664n, lu: 647_646n, juste: false });
    expect(texte(p.remarques[0])).toMatch(/647,664 DT.*647,646 DT/);
  });

  it('ne devine aucun nombre ni aucune date hors de la forme demandée', () => {
    expect(enEntier('1 234,567', 3)).toBe(1_234_567n);
    expect(enEntier('12.5', 3)).toBe(12_500n);
    expect(enEntier('environ 12', 3)).toBeNull();
    expect(enEntier('1.2345', 3)).toBeNull();
    const p = propositionDeLIA(bureauPlus({ date: '23/10/2026', totalTTC: 'illisible', netAPayer: null }), {});
    expect(p.lecture.date).toBeNull();
    expect(p.lecture.totalTTC).toBeNull();
  });

  it('déduit la remise imprimée du prix, comme la v10 attend une ligne', () => {
    const p = propositionDeLIA(bureauPlus({
      lignes: [{ designation: 'Toner', quantite: '3', prixUnitaire: '80.000', remise: '10', tauxTva: '19', totalHT: '216.000' }],
      totalHT: '216.000', totalTVA: '41.040', totalTTC: '258.040', netAPayer: null, doutes: [],
    }), {});
    expect(p.lecture.lines).toEqual([{ label: 'Toner', qty: '3', unitPrice: '72', vatRate: '19' }]);
    expect(p.controle.juste).toBe(true);
  });
});

describe('l\'appel à l\'IA', () => {
  const pieceJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  it('n\'envoie que la pièce et la consigne : ni le nom ni le matricule de l\'entreprise', async () => {
    const partis: { url: string; entetes: Record<string, string>; corps: Record<string, unknown> }[] = [];
    const faux: typeof fetch = async (url, init) => {
      partis.push({ url: String(url), entetes: Object.fromEntries(new Headers(init?.headers).entries()), corps: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: 'msg_essai', type: 'message', role: 'assistant', model: 'essai', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(bureauPlus()) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const lu = await creerLecteurIA(appelAnthropic('cle-essai', 'modele-essai', { fetch: faux })).lire(pieceJpeg, 'jpeg');
    expect(lu.fournisseur).toBe('Bureau Plus Sfax');
    expect(partis).toHaveLength(1);
    const [p] = partis;
    expect(p?.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(p?.entetes['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(p?.entetes.authorization).toBe('Bearer cle-essai');
    // Les en-têtes : la clé, la version de l'API, et ce que la bibliothèque dit d'elle-même et de notre serveur (rien du client).
    expect(Object.keys(p?.entetes ?? {}).filter((k) => !k.startsWith('x-stainless-')).sort()).toEqual(['accept', 'anthropic-beta', 'anthropic-version', 'authorization', 'content-type', 'user-agent']);
    // La liste comptée de ce qui part : ces clés-là, et rien d'autre.
    expect(Object.keys(p?.corps ?? {}).sort()).toEqual(['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system']);
    expect(p?.corps).toMatchObject({ model: 'modele-essai', fallbacks: 'default', system: CONSIGNE, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(p?.corps.messages).toEqual([{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pieceJpeg.toString('base64') } },
      { type: 'text', text: 'Lis cette pièce d\'achat.' }] }]);
    expect(JSON.stringify(p?.corps)).not.toMatch(/7654321|Atelier/);
  });

  it('un PDF part en document', async () => {
    let corps: Record<string, unknown> = {};
    const faux: typeof fetch = async (_url, init) => {
      corps = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'essai', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(bureauPlus()) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await creerLecteurIA(appelAnthropic('cle', undefined, { fetch: faux })).lire(Buffer.from('%PDF-1.4'), 'pdf');
    expect(JSON.stringify(corps.messages)).toContain('"type":"document","source":{"type":"base64","media_type":"application/pdf"');
  });

  // Les limites de la sortie structurée (platform.claude.com, « Structured outputs », lues le 27/10/2026) : au plus 16
  // champs « union » (anyOf, ou un type en liste comme ["string", "null"]) et 24 facultatifs par requête, sinon 400.
  // Le 27/10/2026, 19 champs « texte ou rien » : chaque lecture par l'IA partait en erreur, sans qu'on le voie.
  it('la forme imposée à l\'IA reste dans ce que l\'API admet : au plus 16 unions, 24 facultatifs, aucune contrainte refusée', async () => {
    let corps: { output_config?: { format?: { schema?: unknown } } } = {};
    const faux: typeof fetch = async (_url, init) => {
      corps = JSON.parse(String(init?.body)) as typeof corps;
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'essai', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(bureauPlus()) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await creerLecteurIA(appelAnthropic('cle', undefined, { fetch: faux })).lire(pieceJpeg, 'jpeg');
    let unions = 0, facultatifs = 0;
    const refuses: string[] = [];
    const parcourir = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.type) || 'anyOf' in o) unions++;
      if (o.properties && typeof o.properties === 'object') {
        const exiges = new Set(Array.isArray(o.required) ? o.required : []);
        facultatifs += Object.keys(o.properties).filter((k) => !exiges.has(k)).length;
        Object.values(o.properties).forEach(parcourir);
      }
      for (const k of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems']) if (k in o) refuses.push(k);
      if ('additionalProperties' in o && o.additionalProperties !== false) refuses.push('additionalProperties');
      if (Array.isArray(o.anyOf)) o.anyOf.forEach(parcourir);
      parcourir(o.items);
    };
    expect(corps.output_config?.format?.schema).toBeTruthy();
    parcourir(corps.output_config?.format?.schema);
    expect(unions).toBeLessThanOrEqual(16);
    expect(facultatifs).toBeLessThanOrEqual(24);
    expect(refuses).toEqual([]);
  });

  it('une case vide de la réponse (et le rang 0 d\'un doute) se relit « rien », jamais « » ni la ligne 0', async () => {
    const vide = { ...bureauPlus(), echeance: '', objet: ' ', devise: '', fodec: '', doutes: [{ champ: 'numero', ligne: 0, valeurs: ['BP-8812', 'BP-8813'], raison: 'flou' }] };
    const lu = await creerLecteurIA(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(vide) }] })).lire(Buffer.alloc(4), 'png');
    expect([lu.echeance, lu.objet, lu.devise, lu.fodec, lu.doutes[0]?.ligne]).toEqual([null, null, null, null, null]);
    expect(lu.numero).toBe('BP-8812');
  });

  it('un refus, une panne, une réponse hors forme ne rendent jamais une lecture', async () => {
    const avec = (r: Awaited<ReturnType<AppelIA>> | Error) => creerLecteurIA(async () => { if (r instanceof Error) throw r; return r; }).lire(Buffer.alloc(4), 'png');
    await expect(avec({ stop_reason: 'refusal', content: [] })).rejects.toBeInstanceOf(IARefuse);
    await expect(avec({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Voici la facture : …' }] })).rejects.toBeInstanceOf(IAIndisponible);
    await expect(avec({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...bureauPlus(), lignes: 'deux' }) }] })).rejects.toBeInstanceOf(IAIndisponible);
    await expect(avec({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })).rejects.toBeInstanceOf(IAIndisponible);
    await expect(avec(new Error('réseau'))).rejects.toBeInstanceOf(IAIndisponible);
    await expect(creerLecteurIA(null).lire(Buffer.alloc(4), 'png')).rejects.toBeInstanceOf(IAIndisponible);
  });
});

// ── Le serveur : quand l'IA sert, et quand elle ne sert pas ──────────────────────────────────────────────────────────

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const PHOTO = fs.readFileSync(path.join(import.meta.dirname, '../donnees/lecture/quincaillerie-photo.jpg')).toString('base64');
type Reponse = { statut: number; corps: Record<string, unknown> };
const apps: FastifyInstance[] = [];
async function serveur(appel: AppelIA | null) {
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    lecteurIA: creerLecteurIA(appel) };
  const app = creerApp(ctx, [...routesSocle(ctx), ...routesAchats(ctx), ...routesV10(ctx)]);
  await app.ready();
  apps.push(app);
  return async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() };
  };
}
async function personne(appeler: Awaited<ReturnType<typeof serveur>>, prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { jeton, utilisateur };
}
async function atelier(appeler: Awaited<ReturnType<typeof serveur>>, reglage: Record<string, unknown> = {}) {
  const { jeton } = await personne(appeler, 'nadia');
  const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
  const fiche = ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown>; revision: number }[])
    .find((x) => x.collection === '_racine' && x.cle === 'company');
  await libererMatricule(inject('pgAdmin'), NOUS);
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
    { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, matricule: NOUS, ...reglage } }] });
  return {
    ent,
    etat: () => appeler('GET', `/entreprises/${ent}/achats/lecture`, jeton),
    lire: (ia?: boolean, fichier = { nom: 'photo-facture.jpg', contenu: PHOTO }, qui = jeton) => appeler('POST', `/entreprises/${ent}/achats/lecture`, qui, { ...fichier, ...(ia === undefined ? {} : { ia }) }),
  };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesAchats();
  declarerGestesVentes();
});
afterAll(async () => { for (const a of apps) await a.close(); await admin.end(); await pool.end(); });

describe('la lecture par l\'IA, sur le serveur', () => {
  const repond = (n = { appels: 0 }): AppelIA => async () => { n.appels++; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(bureauPlus()) }] }; };
  it('ne part chez l\'IA que si la personne a dit oui pour ce fichier ; sans ce oui, rien n\'est lu', async () => {
    const envois: string[] = [];
    const appeler = await serveur(async ({ fichier }) => { envois.push(fichier.toString('base64')); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(bureauPlus()) }] }; });
    const a = await atelier(appeler);
    expect((await a.etat()).corps).toMatchObject({ disponible: true, ia: true, iaServeur: true });
    const sans = await a.lire();
    expect(sans.statut).toBe(409);
    expect(texte(sans.corps.motif)).toMatch(/^La pièce ne part chez l'IA qu'avec ton accord pour ce fichier : rien n'a été lu/);
    expect(envois).toHaveLength(0);
    const avec = await a.lire(true);
    expect(avec.statut).toBe(200);
    expect(envois).toEqual([PHOTO]);
    expect(avec.corps).toMatchObject({ moteur: 'ia', lecture: { supplier: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000', number: 'BP-8812' } });
    expect((avec.corps.doutes as unknown[])).toHaveLength(2);
  });

  it('l\'entreprise qui a coupé l\'IA ne lit rien, même si on la demande : la phrase dit où la rallumer', async () => {
    const n = { appels: 0 };
    const a = await atelier(await serveur(repond(n)), { lectureIA: false });
    expect((await a.etat()).corps).toMatchObject({ disponible: false, ia: false, iaServeur: true });
    const r = await a.lire(true);
    expect(r.statut).toBe(409);
    expect(texte(r.corps.motif)).toMatch(/coupée dans les paramètres de l'entreprise : rien n'a été lu\. Rallume-la dans Paramètres › Lecture des factures d'achat/);
    expect(n.appels).toBe(0);
  });

  it('un serveur sans clé ne lit rien, et le dit', async () => {
    const a = await atelier(await serveur(null));
    expect((await a.etat()).corps).toMatchObject({ disponible: false, ia: false, iaServeur: false });
    const r = await a.lire(true);
    expect(r.statut).toBe(503);
    expect(texte(r.corps.motif)).toMatch(/^La lecture par l'IA n'est pas branchée sur ce serveur : rien n'a été lu/);
  });

  it('si l\'IA ne répond pas ou refuse, rien n\'est lu (aucune lecture de repli), et la phrase le dit', async () => {
    const r = await (await atelier(await serveur(async () => { throw new Error('surcharge'); }))).lire(true);
    expect(r.statut).toBe(503);
    expect(texte(r.corps.motif)).toMatch(/^L'IA n'a pas pu lire « photo-facture\.jpg » : rien n'a été lu/);
    const refus = await (await atelier(await serveur(async () => ({ stop_reason: 'refusal', content: [] })))).lire(true);
    expect(refus.statut).toBe(422);
    expect(texte(refus.corps.motif)).toMatch(/^L'IA a refusé/);
  });

  it('ce qui n\'est ni une photo ni un PDF, ou trop lourd, se refuse sans rien envoyer', async () => {
    const n = { appels: 0 };
    const a = await atelier(await serveur(repond(n)));
    // Le nom ne compte pas : ce sont les premiers octets du fichier qui disent ce qu'il est.
    const faux = await a.lire(true, { nom: 'facture.jpg', contenu: Buffer.from('Facture N° 12 : 100,000 DT').toString('base64') });
    expect(faux).toEqual({ statut: 415, corps: { motif: 'Le fichier « facture.jpg » n\'est ni une photo (JPEG, PNG, WEBP) ni un PDF : rien n\'a été lu.', bouton: null } });
    const photo = Buffer.from(PHOTO, 'base64');
    const lourd = Buffer.concat([photo, Buffer.alloc(11 * 1_048_576 - photo.length)]);
    const r = await a.lire(true, { nom: 'photo-geante.jpg', contenu: lourd.toString('base64') });
    expect(r.statut).toBe(413);
    expect(texte(r.corps.motif)).toBe('Le fichier « photo-geante.jpg » fait 11,0 Mo : au-delà de 10 Mo, il ne se lit pas. Prends une photo moins lourde.');
    expect(n.appels).toBe(0);
  });

  it('seuls ceux qui préparent un achat lisent : un commercial ne lit pas (03 § 2.3)', async () => {
    const appeler = await serveur(repond());
    const a = await atelier(appeler);
    const karim = await personne(appeler, 'karim');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, \'{commercial}\')', [karim.utilisateur, a.ent]);
    const r = await a.lire(true, undefined, karim.jeton);
    expect(r.statut).toBe(403);
    expect(texte(r.corps.motif)).toMatch(/lire une facture d'achat en photo ou en PDF/);
    const samia = await personne(appeler, 'samia');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, \'{comptabilite_interne}\')', [samia.utilisateur, a.ent]);
    expect((await a.lire(true, undefined, samia.jeton)).statut).toBe(200);
  });

  it('ce qui n\'est pas une facture se dit, sans rien proposer', async () => {
    const r = await (await atelier(await serveur(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(bureauPlus({ estUneFacture: false })) }] })))).lire(true);
    expect(r.statut).toBe(422);
    expect(texte(r.corps.motif)).toMatch(/^L'IA ne voit pas de facture d'achat/);
  });
});
