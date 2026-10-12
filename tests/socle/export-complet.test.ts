// « Télécharger toutes mes données » (03, « Export complet » ; 0080, docs/export-complet.md). Deux chemins, un fichier : ce
// que l'entreprise télécharge, fabriqué au nom de la personne et sous la sécurité par ligne, est le fichier de l'outil
// d'exploitation au caractère près. Il se restaure ; seuls le propriétaire et l'administrateur l'obtiennent ; ce qu'il
// désigne ailleurs (le cabinet, ses collaborateurs, les appareils d'autrui, le support) ne sort que s'il touche
// l'entreprise ; et la demande est tracée, dans le fichier même.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { exporter, nomDExport, restaurer, type EnTete } from '../../base/entreprise.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { baseNeuve } from '../base-neuve.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `complet-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
async function inviter(ent: string, par: string, roles: string[], prenom: string) {
  const p = await personne(prenom);
  const jeton = String((await appeler('POST', `/entreprises/${ent}/invitations`, par, { email: p.email, roles })).corps.jeton);
  expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton })).statut).toBe(200);
  return p;
}
const appareil = async (utilisateur: string, nom: string) =>
  (await admin.query(`insert into socle.appareil (utilisateur, nom, type) values ($1, $2, 'navigateur') returning id`, [utilisateur, nom])).rows[0].id as string;
const trace = (ent: string, utilisateur: string, appareilId: string | null) =>
  admin.query(`insert into socle.audit (entreprise, utilisateur, appareil, geste, objet_type, objet_id) values ($1, $2, $3, 'essai.geste', 'entreprise', $1)`, [ent, utilisateur, appareilId]);
const cabinet = async (nom: string) =>
  (await admin.query(`insert into socle.organisation (type, nom, code_cabinet) values ('cabinet', $1, $2) returning id`, [nom, `CX${String(100000 + ++n)}`])).rows[0].id as string;
const membreDe = async (cab: string, utilisateur: string, roles: string[]) =>
  (await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [utilisateur, cab, roles])).rows[0].id as string;

// Une entreprise où tout ce qui se désigne ailleurs existe : un administrateur, un commercial, une personne retirée, un
// transfert de propriété annulé, le cabinet qui la tient (un collaborateur affecté, un associé), un ancien cabinet (mandat
// terminé), le support qui y a agi, les appareils de chacun dans la trace, un fil de messages avec un fichier joint, une
// question envoyée ; et deux brouillons du cabinet qui ne partent pas (une question non envoyée, un fichier non joint).
async function entreprise(nom: string) {
  const proprio = await personne('proprio');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom, matriculeFiscal: `${String(3_000_000 + n).slice(-7)}B/A/M/000` })).corps.id);
  const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio.jeton, { raisonSociale: 'Garage Sud', identifiant: '7654322B/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
  await appeler('POST', `/entreprises/${ent}/series`, proprio.jeton, { type: 'facture', prefixe: 'FAC', legale: true });
  await appeler('POST', `/entreprises/${ent}/regles`, proprio.jeton, { code: 'timbre.facture', valeur: 1000, debut: '2026-01-01', motif: 'Essai' });
  const facture = String((await appeler('POST', `/entreprises/${ent}/ventes`, proprio.jeton, { type: 'facture', tiers: client, datePiece: '2026-10-01', lignes: [{ designation: 'Porte', quantite: '1', prixUnitaire: '300', tauxTva: '19' }] })).corps.id);
  const emise = await appeler('POST', `/entreprises/${ent}/ventes/${facture}/emettre`, proprio.jeton);
  expect(emise.statut, JSON.stringify(emise.corps)).toBe(200);
  return { ent, proprio, client };
}

let A: Awaited<ReturnType<typeof entreprise>>;
let B: Awaited<ReturnType<typeof entreprise>>;
let administrateur: Awaited<ReturnType<typeof personne>>;
let commercial: Awaited<ReturnType<typeof personne>>;
let retire: Awaited<ReturnType<typeof personne>>;
let collab: Awaited<ReturnType<typeof personne>>;
let associe: Awaited<ReturnType<typeof personne>>;
let ancien: Awaited<ReturnType<typeof personne>>;
let support: Awaited<ReturnType<typeof personne>>;
const id: Record<string, string> = {};
let telecharge: { nom: string; contenu: string; octets: number };
let statut = 0;
let fichier: string[];

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  await app.ready();
  A = await entreprise('Épicerie Fine & Fils');
  B = await entreprise('La voisine');
  administrateur = await inviter(A.ent, A.proprio.jeton, ['administrateur'], 'admin');
  commercial = await inviter(A.ent, A.proprio.jeton, ['commercial'], 'commercial');
  retire = await inviter(A.ent, A.proprio.jeton, ['lecture'], 'retire');
  const equipe = (await appeler('GET', `/entreprises/${A.ent}/equipe`, A.proprio.jeton)).corps.membres as { id: string; utilisateur: string }[];
  const membreRetire = equipe.find((m) => m.utilisateur === retire.id)?.id ?? '';
  expect((await appeler('DELETE', `/entreprises/${A.ent}/membres/${membreRetire}`, A.proprio.jeton)).statut).toBe(200);
  // Un transfert de propriété demandé au commercial, puis annulé : ni l'administrateur n'y figure.
  await admin.query(`insert into socle.transfert_propriete (entreprise, de, vers, annule_le) values ($1, $2, $3, now())`, [A.ent, A.proprio.id, commercial.id]);
  // Le cabinet qui tient le dossier : un collaborateur affecté, un associé ; et l'ancien cabinet, mandat terminé.
  collab = await personne('collaborateur');
  associe = await personne('associe');
  ancien = await personne('ancien');
  support = await personne('support');
  id.cab = await cabinet('Cabinet Essai');
  id.cab2 = await cabinet('Ancien Cabinet');
  id.membreCollab = await membreDe(id.cab, collab.id, ['saisie']);
  id.membreAssocie = await membreDe(id.cab, associe.id, ['supervision']);
  id.membreAncien = await membreDe(id.cab2, ancien.id, ['saisie']);
  const mandat = (await admin.query(`insert into socle.mandat (cabinet, entreprise, accorde_par, debut, statut) values ($1, $2, $3, '2026-01-01', 'actif') returning id`, [id.cab, A.ent, A.proprio.id])).rows[0].id as string;
  await admin.query(`insert into socle.mandat_affectation (mandat, membre, role) values ($1, $2, 'saisie')`, [mandat, id.membreCollab]);
  await admin.query(`insert into socle.mandat (cabinet, entreprise, accorde_par, debut, fin, statut) values ($1, $2, $3, '2025-01-01', '2025-12-31', 'termine')`, [id.cab2, A.ent, A.proprio.id]);
  // Les appareils de chacun, nommés par la trace de l'entreprise (le propriétaire ne voit que les siens).
  id.devCommercial = await appareil(commercial.id, 'PC du comptoir');
  id.devCollab = await appareil(collab.id, 'Portable du cabinet');
  id.devSupport = await appareil(support.id, 'Poste du support');
  await trace(A.ent, commercial.id, id.devCommercial);
  await trace(A.ent, collab.id, id.devCollab);
  await trace(A.ent, support.id, id.devSupport);
  await trace(A.ent, ancien.id, null);
  // Le fil avec le cabinet : un message du collaborateur, son fichier joint ; un autre fichier déposé, jamais joint.
  await admin.query(`insert into messagerie.fil (entreprise, cabinet) values ($1, $2)`, [A.ent, id.cab]);
  const pdf = Buffer.from('%PDF-1.4 essai');
  const joint = (await admin.query(`insert into messagerie.fichier (entreprise, cabinet, nom, type, taille, contenu, empreinte, depose_par)
    values ($1, $2, 'releve.pdf', 'application/pdf', $3, $4, repeat('a', 64), $5) returning id`, [A.ent, id.cab, pdf.length, pdf, collab.id])).rows[0].id as string;
  id.fichierBrouillon = (await admin.query(`insert into messagerie.fichier (entreprise, cabinet, nom, type, taille, contenu, empreinte, depose_par)
    values ($1, $2, 'brouillon.pdf', 'application/pdf', $3, $4, repeat('b', 64), $5) returning id`, [A.ent, id.cab, pdf.length, pdf, collab.id])).rows[0].id as string;
  await admin.query(`insert into messagerie.message (entreprise, cabinet, cote, auteur, auteur_nom, texte, fichier) values ($1, $2, 'cabinet', $3, 'Collaborateur', 'Voici le relevé', $4)`,
    [A.ent, id.cab, collab.id, joint]);
  // Les questions du cabinet : une envoyée (dans les livres du client), une en brouillon (avec la révision du cabinet).
  await admin.query(`insert into compta.question (entreprise, cabinet, periode, texte, statut, envois, pose_par) values ($1, $2, '2026-09', 'Quelle est cette dépense ?', 'envoyee', array[now()], $3)`, [A.ent, id.cab, collab.id]);
  id.questionBrouillon = (await admin.query(`insert into compta.question (entreprise, cabinet, periode, texte, pose_par) values ($1, $2, '2026-09', 'Brouillon du cabinet', $3) returning id`, [A.ent, id.cab, associe.id])).rows[0].id as string;

  // L'administrateur télécharge ; l'exploitation exporte juste après (la trace du téléchargement est alors dans les deux).
  // Le statut se vérifie dans le premier test, pas ici : une préparation qui tombe fait « sauter » les tests au lieu de
  // les faire tomber, et une preuve par réintroduction n'y verrait rien.
  const r = await appeler('GET', `/entreprises/${A.ent}/export`, administrateur.jeton);
  statut = r.statut;
  telecharge = r.corps as typeof telecharge;
  fichier = String(telecharge.contenu ?? '').replace(/\n$/, '').split('\n');
}, 60_000);
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const partie = (lignes: string[], table: string, role = 'entreprise') => {
  const i = lignes.findIndex((l) => l.startsWith('{"table":') && JSON.parse(l).table === table && JSON.parse(l).role === role);
  return JSON.parse(lignes[i + 1] ?? '[]') as Record<string, unknown>[];
};

describe('télécharger toutes les données de l\'entreprise', () => {
  it('le fichier téléchargé est celui de l\'exploitation, au caractère près (deux chemins, un fichier)', async () => {
    expect(statut, JSON.stringify(telecharge).slice(0, 300)).toBe(200);
    const exploitation = await exporter(admin, A.ent);
    expect(fichier.length).toBe(exploitation.length);
    // L'en-tête : le même, à l'heure près.
    const sansHeure = (l: string | undefined) => ({ ...(JSON.parse(l ?? '{}') as EnTete), exporteLe: '' });
    expect(sansHeure(fichier[0])).toEqual(sansHeure(exploitation[0]));
    for (let i = 1; i < exploitation.length - 1; i++) expect(fichier[i], `ligne ${i} : ${exploitation[i]?.slice(0, 80)}`).toBe(exploitation[i]);
    expect(telecharge.octets).toBe(Buffer.byteLength(telecharge.contenu, 'utf8'));
    expect(telecharge.nom).toMatch(/^skanfact-épicerie-fine-fils-\d{4}-\d{2}-\d{2}\.jsonl$/);
  });

  it('ce que l\'entreprise ne lit pas d\'elle-même y est : le cabinet, ses collaborateurs, les appareils d\'autrui, le support, les transferts', async () => {
    const emails = partie(fichier, 'socle.utilisateur', 'reference').map((u) => u.email);
    for (const p of [collab, ancien, support]) expect(emails).toContain(p.email);
    // L'associé du cabinet n'a rien fait dans l'entreprise : rien ne le désigne, il n'y est pas.
    expect(emails).not.toContain(associe.email);
    // Plus le poste de l'administrateur qui a téléchargé : la trace du téléchargement le nomme.
    const poste = (await admin.query(`select appareil from socle.audit where entreprise = $1 and geste = 'socle.export_complet'`, [A.ent])).rows[0].appareil as string;
    expect(partie(fichier, 'socle.appareil', 'reference').map((a) => a.id).sort()).toEqual([id.devCommercial, id.devCollab, id.devSupport, poste].sort());
    expect(partie(fichier, 'socle.organisation', 'reference').map((o) => o.nom)).toEqual(expect.arrayContaining(['Cabinet Essai', 'Ancien Cabinet']));
    expect(partie(fichier, 'socle.membre', 'reference').map((m) => m.id)).toEqual([id.membreCollab]);
    expect(partie(fichier, 'socle.transfert_propriete')).toHaveLength(1);
    // Les deux brouillons du cabinet ne partent pas, ni dans ce que l'entreprise télécharge ni dans l'export de
    // l'exploitation ; ce qu'il a envoyé, si.
    for (const lignes of [fichier, await exporter(admin, A.ent)]) {
      expect(partie(lignes, 'compta.question').map((q) => q.texte)).toEqual(['Quelle est cette dépense ?']);
      expect(partie(lignes, 'messagerie.fichier').map((f) => f.nom)).toEqual(['releve.pdf']);
      expect(lignes.join('\n')).not.toContain(id.fichierBrouillon);
      expect(lignes.join('\n')).not.toContain(id.questionBrouillon);
    }
  });

  it('rien de la voisine, et aucun secret : ni mot de passe, ni clé d\'appareil, ni code de cabinet', () => {
    const texte = fichier.join('\n');
    for (const x of [B.ent, B.client, B.proprio.id, B.proprio.email]) expect(texte).not.toContain(x);
    for (const secret of ['empreinte_mot_de_passe', 'cle_publique', 'reconnu_jusqu_au', 'code_cabinet', 'code_secret', 'telephone_verifie_le', '$argon2']) expect(texte).not.toContain(secret);
  });

  it('il se restaure dans une base vide, et s\'y ré-exporte à l\'identique', async () => {
    const base = await baseNeuve('skanfact_test_export_complet');
    const cible = new pg.Client({ connectionString: base.admin });
    await cible.connect();
    try {
      const bilan = await restaurer(cible, fichier);
      expect(bilan.tables.find((t) => t.table === 'ventes.piece')?.lignes).toBe(1);
      const encore = await exporter(cible, A.ent);
      // Tout est identique, sauf la trace, qui porte une ligne de plus : la restauration elle-même.
      const audit = fichier.findIndex((l) => l.startsWith('{"table":"socle.audit"'));
      expect(encore.length).toBe(fichier.length);
      for (let i = 1; i < fichier.length - 1; i++) {
        if (i === audit || i === audit + 1) continue;
        expect(encore[i], `ligne ${i}`).toBe(fichier[i]);
      }
      const avant = JSON.parse(fichier[audit + 1] ?? '[]') as { geste: string }[];
      const apres = JSON.parse(encore[audit + 1] ?? '[]') as { geste: string }[];
      expect(apres.filter((t) => t.geste !== 'socle.entreprise.restaurer')).toEqual(avant);
    } finally {
      await cible.end();
      await base.jeter();
    }
  });

  it('seuls le propriétaire et l\'administrateur l\'obtiennent : ni le commercial, ni le collaborateur du cabinet, ni la voisine', async () => {
    expect((await appeler('GET', `/entreprises/${A.ent}/export`, A.proprio.jeton)).statut).toBe(200);
    // Le commercial est arrêté par la porte, qui nomme qui peut le faire (la base, derrière, refuse aussi).
    const refus = await appeler('GET', `/entreprises/${A.ent}/export`, commercial.jeton);
    expect(refus.statut).toBe(403);
    expect((refus.corps.qui as { utilisateur: string }[]).map((q) => q.utilisateur).sort()).toEqual([A.proprio.id, administrateur.id].sort());
    expect([403, 404]).toContain((await appeler('GET', `/entreprises/${A.ent}/export`, collab.jeton)).statut);
    expect((await appeler('GET', `/entreprises/${A.ent}/export`, B.proprio.jeton)).statut).toBe(404);
    expect((await appeler('GET', `/entreprises/${A.ent}/export`, retire.jeton)).statut).toBe(404);
  });

  it('les fonctions de la base ne rendent que ce qui touche l\'entreprise, et à son propriétaire ou son administrateur seulement', async () => {
    const devB = await appareil(B.proprio.id, 'Poste de la voisine');
    const orgB = (await admin.query('select organisation from socle.entreprise where id = $1', [B.ent])).rows[0].organisation as string | null;
    const membreB = (await admin.query('select id from socle.membre where entreprise = $1', [B.ent])).rows[0].id as string;
    const lire = (qui: string, texte: string, params: unknown[]) => enTantQue(pool, qui, async (tx) => (await tx.query(texte, params)).rows);
    const utilisateurs = await lire(A.proprio.id, 'select id from socle.export_utilisateurs($1, $2)', [A.ent, [collab.id, B.proprio.id, associe.id]]);
    // L'associé touche l'entreprise (membre du cabinet qui la tient) : la fonction le rendrait si l'export le désignait.
    expect(utilisateurs.map((u) => u.id).sort()).toEqual([collab.id, associe.id].sort());
    expect(await lire(A.proprio.id, 'select id from socle.export_appareils($1, $2)', [A.ent, [devB, id.devCollab]])).toEqual([{ id: id.devCollab }]);
    expect(await lire(A.proprio.id, 'select id from socle.export_membres($1, $2)', [A.ent, [membreB, id.membreAncien]])).toEqual([{ id: id.membreAncien }]);
    if (orgB) expect(await lire(A.proprio.id, 'select id from socle.export_organisations($1, $2)', [A.ent, [orgB]])).toEqual([]);
    // Le propriétaire de A ne lit rien de B par elles, même en le demandant.
    await expect(lire(A.proprio.id, 'select id from socle.export_utilisateurs($1, $2)', [B.ent, [B.proprio.id]])).rejects.toMatchObject({ code: '42501' });
    for (const [fonction, params] of [['export_utilisateurs', [A.ent, [collab.id]]], ['export_appareils', [A.ent, [id.devCollab]]], ['export_membres', [A.ent, [id.membreCollab]]], ['export_organisations', [A.ent, [id.cab]]]] as const) {
      await expect(lire(commercial.id, `select * from socle.${fonction}($1, $2)`, [...params]), fonction).rejects.toMatchObject({ code: '42501' });
    }
    await expect(lire(commercial.id, 'select * from socle.export_migrations($1)', [A.ent])).rejects.toMatchObject({ code: '42501' });
    await expect(lire(collab.id, 'select * from socle.export_migrations($1)', [A.ent])).rejects.toMatchObject({ code: '42501' });
  });

  it('la demande est tracée (une lecture sensible, au nom de qui la fait) et sa trace part dans le fichier', async () => {
    const traces = (await admin.query(`select utilisateur, lecture from socle.audit where entreprise = $1 and geste = 'socle.export_complet' order by instant`, [A.ent])).rows;
    expect(traces[0]).toEqual({ utilisateur: administrateur.id, lecture: true });
    expect(partie(fichier, 'socle.audit').some((t) => t.geste === 'socle.export_complet' && t.utilisateur === administrateur.id)).toBe(true);
  });

  it('une photographie : la transaction de l\'export voit la base à un seul instant', async () => {
    const route = routesSocle(ctx).find((r) => r.chemin === '/entreprises/:entreprise/export');
    expect(route?.instantane).toBe(true);
    expect(await enTantQue(pool, A.proprio.id, async (tx) => (await tx.query('show transaction_isolation')).rows[0].transaction_isolation, null, { instantane: true })).toBe('repeatable read');
    expect(await enTantQue(pool, A.proprio.id, async (tx) => (await tx.query('show transaction_isolation')).rows[0].transaction_isolation)).toBe('read committed');
  });

  it('le nom du fichier garde la raison sociale, en toutes écritures, et un nom sûr quand il n\'en reste rien', () => {
    expect(nomDExport('Épicerie Fine & Fils', '2026-10-12')).toBe('skanfact-épicerie-fine-fils-2026-10-12.jsonl');
    expect(nomDExport('مخبزة الياسمين', '2026-10-12')).toBe('skanfact-مخبزة-الياسمين-2026-10-12.jsonl');
    expect(nomDExport('***', '2026-10-12')).toBe('skanfact-entreprise-2026-10-12.jsonl');
  });
});
