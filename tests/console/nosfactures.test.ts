// Nos factures (docs/console.md C31 ; 0109), par l'API. Ce que le serveur garantit :
//   - les pièces d'un mois : les factures d'abonnement que l'entreprise SkanFact a émises, et les avoirs qui les
//     corrigent ; rien d'autre de son dossier ; la plus récente d'abord ;
//   - où chacune en est hors du dossier, dans l'ordre d'une facture : pas de fichier, à signer, signée à envoyer, déposée,
//     acceptée, refusée — et, refusée, ce que la TTN a répondu ;
//   - son paiement par la règle de toutes les factures ; un avoir n'en a pas, il corrige sa facture ;
//   - le résumé (combien, le montant émis, les avoirs, ce qui reste à encaisser) et les filtres, chacun compté par la
//     fonction qui filtre la liste qu'il ouvre ; le montant, aussi par un second chemin ;
//   - si la fiche de l'entreprise SkanFact la dit soumise à la facture électronique (l'écran dit où le régler) ;
//   - la direction seule : ni le support, ni la technique.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { dansLeFiltre, etatPaiement, etatTtn, FILTRES, ligne, resume, type PieceLue } from '../../serveur/console/nosfactures.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { versionTeif } from '../../serveur/v10/teif.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nosfactures-')), 'veille.json');
const jour = aujourdhuiATunis(horloge);
const mois = jour.slice(0, 7);
const moisVoisin = (m: string, pas: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + pas, 1)); return d.toISOString().slice(0, 7); };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const email = `nosfactures-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const appli = String(c.corps.jeton);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { email, appli, console: String(k.corps.jeton), id: qui.utilisateur };
}
async function abonnee(nom: string) {
  const email = `nosfactures-proprio${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 3 where entreprise = $1', [id, jour]);
  return id;
}
const dossier = async () =>
  (await appeler('GET', `/entreprises/${editeur}/dossier-v10`, direction.appli)).corps.objets as { collection: string; cle: string; rang: number | null; contenu: Corps; revision: number }[];

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;
let editeur: string;

type Facture = { ent: string; cle: string; piece: string; numero: string; client: Corps | undefined; clientId: unknown };
// Préparer puis émettre, dans SkanFact, la facture d'un abonnement mensuel Essentiel (47,410 : 39 HT, la TVA, le timbre).
async function factureEmise(nom: string): Promise<Facture> {
  const ent = await abonnee(nom);
  expect((await appeler('POST', `/console/entreprises/${ent}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
  const objets = await dossier();
  const brouillon = objets.find((o) => o.collection === 'documents' && o.cle.startsWith(`abonnement-${ent}-`));
  const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
  const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
  expect(e.statut, JSON.stringify(e.corps)).toBe(200);
  const cle = brouillon?.cle ?? '';
  const p = (await admin.query("select id, numero_texte from ventes.piece where entreprise = $1 and ref_v10 = $2 and type = 'facture'", [editeur, cle])).rows[0];
  return { ent, cle, piece: p.id, numero: p.numero_texte, client, clientId: brouillon?.contenu.clientId };
}
// L'avoir d'une facture, émis comme l'application de SkanFact l'émet (une ligne, au prix HT donné, timbre compris ou non).
async function avoirDe(f: Facture, ht: number, timbre: boolean, net: string) {
  const avoir = {
    id: `avoir-${f.ent}`, type: 'avoir', number: '', date: jour, clientId: f.clientId, creditOf: f.cle, creditReason: 'Un mois offert', status: 'brouillon',
    lines: [{ label: 'SkanFact Essentiel — un mois offert', description: '', qty: 1, unit: '', unitPrice: ht, vatRate: 19 }],
    discountRate: 0, applyStamp: timbre, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
  };
  expect((await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli, { changements: [{ collection: 'documents', cle: avoir.id, rang: null, revision: null, contenu: avoir }] })).statut).toBe(200);
  const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre-avoir`, direction.appli, { document: avoir, client: f.client, revision: 1, rang: null, netAPayer: net });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return (await admin.query("select numero_texte from ventes.piece where entreprise = $1 and ref_v10 = $2 and type = 'avoir'", [editeur, avoir.id])).rows[0].numero_texte as string;
}
async function regler(f: Facture, montant: string) {
  const d = (await dossier()).find((o) => o.collection === 'documents' && o.cle === f.cle);
  const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
    { changements: [{ collection: 'documents', cle: f.cle, rang: d?.rang ?? null, revision: d?.revision, contenu: { ...d?.contenu, payments: [{ id: `p-${f.ent}`, date: jour, amount: { '~n': montant }, method: 'virement' }] } }] });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
}
// Ce qui suit une pièce hors du dossier, posé par la base comme l'émission, la signature et le dépôt l'écrivent (0049 à
// 0051) : le fichier, puis la signature, puis l'envoi et ce que la TTN en dit.
const fichier = (f: Facture) => admin.query(`insert into ventes.efacture (piece, entreprise, nom, xml, empreinte, version, ecrit_le, ecrit_par)
  values ($1, $2, 'TEIF_essai.xml', '<TEIF/>', $3, $4, now(), $5)`, [f.piece, editeur, 'a'.repeat(64), versionTeif(), direction.id]);
async function signee(f: Facture) {
  const demande = (await admin.query(`insert into ventes.signature_demande (entreprise, pieces, identifiant, session, statut, cree_le, cree_par)
    values ($1, $2, 'essai', 'essai', 'signee', now(), $3) returning id`, [editeur, [f.piece], direction.id])).rows[0].id;
  await admin.query(`insert into ventes.efacture_signee (piece, entreprise, xml, empreinte, demande, signe_le, signe_par)
    values ($1, $2, '<TEIF/>', $3, $4, now(), $5)`, [f.piece, editeur, 'b'.repeat(64), demande, direction.id]);
}
const envoi = (f: Facture, statut: string, en: { motif?: unknown; acceptee?: boolean } = {}) => admin.query(`insert into ventes.envoi_ttn
  (piece, entreprise, statut, prochain_essai, depose_le, reference, xml_valide, accepte_le, motif, cree_le, cree_par)
  values ($1, $2, $3, now(), case when $3 = 'a_envoyer' then null else now() end, $4, $5, $6, $7, now(), $8)`,
  [f.piece, editeur, statut, en.acceptee ? 'TTN-REF-1' : null, en.acceptee ? '<TEIF/>' : null, en.acceptee ? new Date() : null, en.motif ? JSON.stringify(en.motif) : null, direction.id]);

type Ligne = {
  type: string; numero: string; date: string; entreprise: { id: string; nom: string }; offre: string | null; periodicite: string | null;
  debut: string | null; fin: string | null; corrige: { numero: string | null; ecran: string } | null; net: string; ttn: string; motif: string | null;
  paiement: string; reste: string; ecran: string;
};
type Ecran = {
  mois: string; courant: boolean; editeur: { entreprise: string; soumise: boolean } | null;
  resume: { factures: number; montant: string | null; avoirs: number; montantAvoirs: string | null; reste: string | null; ttn: Record<string, number> };
  filtre: string; comptes: Record<string, number>; refusees: Ligne[]; total: number; lignes: Ligne[];
};
const lire = async (q = '') => {
  const r = await appeler('GET', `/console/nos-factures${q}`, direction.console);
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return r.corps as unknown as Ecran;
};
const de = (e: Ecran, numero: string) => e.lignes.find((l) => l.numero === numero);
// Le second chemin : le net des factures d'abonnement émises du mois, compté à part, en millimes.
const montantParLaBase = async () => {
  const r = await admin.query(`select coalesce(sum(p.net_a_payer), 0)::text s from plateforme.facture_abonnement f
    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
   where to_char(p.date_piece, 'YYYY-MM') = $1`, [mois]);
  const s = String(r.rows[0].s).padStart(4, '0');
  return `${s.slice(0, -3)}.${s.slice(-3)}`;
};

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  support = await membre('Karim', 'support');
  technique = await membre('Sami', 'technique');
  editeur = String((await appeler('POST', '/entreprises', direction.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('nos factures', () => {
  it('la direction seule : ni le support, ni la technique', async () => {
    expect((await appeler('GET', '/console/nos-factures', support.console)).statut).toBe(403);
    expect((await appeler('GET', '/console/nos-factures', technique.console)).statut).toBe(403);
    // La base le refuse aussi, hors d'une session de la console de la direction.
    await expect(admin.query(`select set_config('app.session_console', '', false); select plateforme.console_nos_factures(current_date)`)).rejects.toThrow(/console/);
  });

  it('sans entreprise SkanFact : aucune pièce, et l\'écran le dit', async () => {
    const e = await lire();
    expect(e).toMatchObject({ editeur: null, mois, courant: true, total: 0, lignes: [], refusees: [] });
    expect(e.resume).toMatchObject({ factures: 0, avoirs: 0, montant: null, reste: null });
  });

  it('chaque pièce dit où elle en est hors du dossier, dans l\'ordre d\'une facture ; refusée, elle dit ce que la TTN a répondu', async () => {
    expect((await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    const [a, b, c, d, f] = [await factureEmise('Atelier Sans Fichier'), await factureEmise('Boutique À Signer'), await factureEmise('Café Signé'),
      await factureEmise('Droguerie Déposée'), await factureEmise('Épicerie Acceptée')];
    const r = await factureEmise('Fromagerie Refusée');
    await fichier(b);
    for (const x of [c, d, f, r]) { await fichier(x); await signee(x); }
    await envoi(d, 'deposee');
    await envoi(f, 'acceptee', { acceptee: true });
    await envoi(r, 'refusee', { motif: { cle: 'ttn.refusee', valeurs: { accuses: 'E12 : matricule fiscal de l\'acheteur non reconnu' } } });
    const e = await lire();
    expect(e.editeur).toMatchObject({ entreprise: editeur, soumise: false });
    expect([a, b, c, d, f, r].map((x) => de(e, x.numero)?.ttn)).toEqual(['sans_fichier', 'a_signer', 'a_envoyer', 'deposee', 'acceptee', 'refusee']);
    // Refusée : en tête, avec la réponse de la TTN telle quelle ; l'écran de la pièce dans l'application de SkanFact.
    expect(e.refusees).toMatchObject([{ numero: r.numero, motif: 'E12 : matricule fiscal de l\'acheteur non reconnu', entreprise: { id: r.ent }, ecran: `/v10/?e=${editeur}#/doc/${r.cle}` }]);
    // Ce que la pièce paie : l'offre, la périodicité, la période.
    expect(de(e, a.numero)).toMatchObject({ type: 'facture', offre: 'essentiel', periodicite: 'mensuel', net: '47.410', paiement: 'a_payer', reste: '47.410', corrige: null });
    expect(de(e, a.numero)?.debut).toEqual(expect.any(String));
    expect(e.resume.ttn).toEqual({ sans_fichier: 1, a_signer: 1, a_envoyer: 1, deposee: 1, acceptee: 1, refusee: 1 });
  });

  it('un avoir corrige sa facture : il ne se paie pas, il en déduit ; la facture dit ce qui lui reste', async () => {
    const g = await factureEmise('Garage Un Mois Offert');
    // Un avoir de 10 HT, sans timbre : 11,900 de moins sur 47,410.
    const numeroAvoir = await avoirDe(g, 10, false, '11.900');
    const e = await lire();
    expect(de(e, numeroAvoir)).toMatchObject({ type: 'avoir', net: '11.900', paiement: 'avoir', corrige: { numero: g.numero, ecran: `/v10/?e=${editeur}#/doc/${g.cle}` }, offre: 'essentiel' });
    // « En partie » se dit d'un règlement : corrigée par un avoir, sans rien de reçu, elle reste à payer, et le dit.
    expect(de(e, g.numero)).toMatchObject({ paiement: 'a_payer', reste: '35.510', avoirDeduit: true });
    // Réglée de ce qui reste : payée.
    await regler(g, '35.51');
    expect(de(await lire(), g.numero)).toMatchObject({ paiement: 'payee', reste: '0.000' });
  });

  it('le résumé et les filtres : chacun compté par la fonction qui filtre ; le montant, aussi par un second chemin', async () => {
    const e = await lire();
    const factures = e.lignes.filter((l) => l.type === 'facture');
    const avoirs = e.lignes.filter((l) => l.type === 'avoir');
    expect(e.resume.factures).toBe(factures.length);
    expect(e.resume.avoirs).toBe(avoirs.length);
    expect(e.resume.montant).toBe(await montantParLaBase());
    const millimes = (t: string) => Math.round(Number(t) * 1000);
    expect(millimes(e.resume.montantAvoirs ?? '0')).toBe(avoirs.reduce((s, l) => s + millimes(l.net), 0));
    expect(millimes(e.resume.reste ?? '0')).toBe(factures.reduce((s, l) => s + millimes(l.reste), 0));
    // La plus récente d'abord.
    expect(e.lignes.map((l) => l.date)).toEqual([...e.lignes.map((l) => l.date)].sort().reverse());
    for (const filtre of FILTRES) {
      const vu = await lire(`?filtre=${filtre}&limite=500`);
      expect(vu.filtre).toBe(filtre);
      expect(vu.total, filtre).toBe(e.comptes[filtre]);
      expect(vu.lignes.length, filtre).toBe(e.comptes[filtre]);
    }
    expect((await lire('?filtre=refusees')).lignes.map((l) => l.ttn)).toEqual(['refusee']);
    expect((await lire('?filtre=en_chemin&limite=500')).lignes.every((l) => l.ttn !== 'acceptee' && l.ttn !== 'refusee')).toBe(true);
    expect((await lire('?filtre=non_payees&limite=500')).lignes.every((l) => ['a_payer', 'en_retard', 'partielle'].includes(l.paiement))).toBe(true);
    // Un filtre inconnu : toutes.
    expect((await lire('?filtre=n_importe')).filtre).toBe('toutes');
  });

  it('la fiche de l\'entreprise SkanFact soumise à la facture électronique : l\'écran le sait', async () => {
    const fiche = (await dossier()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
      { changements: [{ collection: '_racine', cle: 'company', rang: fiche?.rang ?? null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, efacture: true } }] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect((await lire()).editeur?.soumise).toBe(true);
  });

  it('un mois passé ne montre que les siennes ; un mois à venir ou illisible, celui d\'aujourd\'hui', async () => {
    const passe = await lire(`?mois=${moisVoisin(mois, -1)}`);
    expect(passe).toMatchObject({ mois: moisVoisin(mois, -1), courant: false, total: 0 });
    expect((await lire(`?mois=${moisVoisin(mois, 2)}`)).mois).toBe(mois);
    expect((await lire('?mois=2026-13')).mois).toBe(mois);
  });
});

describe('les règles, pures', () => {
  const piece = (x: Partial<PieceLue>): PieceLue => ({ type: 'facture', numero: 'F', date: '2026-10-01', echeance: '2026-10-10', piece: 'p', ecran: '', devise: 'TND', decimales: 3,
    net: 47410n, entreprise: { id: 'e', nom: 'E' }, offre: 'essentiel', periodicite: 'mensuel', debut: null, fin: null, corrige: null, avoirs: [], reglements: [],
    efacture: false, signee: false, ttn: null, ...x });
  it('le dernier pas franchi : le dépôt dit le sien ; sans dépôt, la signature, puis le fichier', () => {
    expect(etatTtn(piece({}))).toBe('sans_fichier');
    expect(etatTtn(piece({ efacture: true }))).toBe('a_signer');
    expect(etatTtn(piece({ efacture: true, signee: true }))).toBe('a_envoyer');
    expect(etatTtn(piece({ efacture: true, signee: true, ttn: { statut: 'refusee', motif: null, deposeLe: null, accepteLe: null, reference: null } }))).toBe('refusee');
  });
  it('un avoir n\'a pas de paiement ; une facture en retard le dit ; en partie, elle dit son reste', () => {
    expect(etatPaiement(piece({ type: 'avoir' }), '2026-10-14')).toEqual({ etat: 'avoir', reste: 0n, credite: 0n });
    expect(etatPaiement(piece({}), '2026-10-14').etat).toBe('en_retard');
    expect(etatPaiement(piece({ reglements: [10000n] }), '2026-10-05')).toEqual({ etat: 'partielle', reste: 37410n, credite: 0n });
    expect(dansLeFiltre(piece({ type: 'avoir' }), 'non_payees', '2026-10-14')).toBe(false);
    // Un avoir n'est pas un règlement : sans rien de reçu, elle n'est pas « en partie ».
    expect(etatPaiement(piece({ avoirs: [11900n] }), '2026-10-05')).toEqual({ etat: 'a_payer', reste: 35510n, credite: 11900n });
    expect(etatPaiement(piece({ avoirs: [11900n] }), '2026-10-14').etat).toBe('en_retard');
  });
  it('une autre devise ne s\'additionne jamais au dinar ; ce qui reste ne compte que les factures', () => {
    const r = resume({ mois: '2026-10', editeur: { entreprise: 'x', raisonSociale: 'X', devise: 'TND', decimales: 3, soumise: false },
      pieces: [piece({}), piece({ devise: 'EUR', net: 50000n }), piece({ type: 'avoir', net: 11900n })] }, '2026-10-05');
    expect(r).toMatchObject({ factures: 2, avoirs: 1, montant: '47.410', montantAvoirs: '11.900', autresDevises: 1, reste: '47.410' });
  });
  it('la réponse de la TTN telle quelle ; un autre motif, en mots', () => {
    const refus = piece({ ttn: { statut: 'refusee', motif: { cle: 'ttn.refusee', valeurs: { accuses: 'E12 : refus' } }, deposeLe: null, accepteLe: null, reference: null } });
    expect(ligne(refus, '2026-10-05', () => 'en mots').motif).toBe('E12 : refus');
    const autre = piece({ ttn: { statut: 'a_envoyer', motif: { cle: 'efacture.ttn_sans_compte', valeurs: {} }, deposeLe: null, accepteLe: null, reference: null } });
    expect(ligne(autre, '2026-10-05', () => 'en mots').motif).toBe('en mots');
  });
});
