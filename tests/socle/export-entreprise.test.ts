// Exporter UNE entreprise et la restaurer à l'identique (vision § 4.2, 01 R14, 06 § 4.4 ; jalon J1 :
// « une entreprise est exportée puis restaurée à l'identique »).

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CLASSEMENT, exporter, restaurer, tablesNonClassees } from '../../base/entreprise.ts';
import { creerApp } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { controler } from '../../serveur/journal.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { lirePiece, relirePourChaine } from '../../serveur/ventes/pieces.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { baseNeuve } from '../base-neuve.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `export-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
// Une entreprise vivante : deux personnes, une série, une règle, un client, deux factures émises
// (dont une en euros), un brouillon.
async function entreprise(nom: string) {
  const proprio = await personne('proprio');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom, matriculeFiscal: `${String(2_000_000 + n).slice(-7)}A/A/M/000` })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const serie = String((await appeler('POST', `/entreprises/${ent}/series`, proprio.jeton, { type: 'facture', prefixe: 'FAC', legale: true })).corps.id);
  await appeler('POST', `/entreprises/${ent}/regles`, proprio.jeton, { code: 'timbre.facture', valeur: 1000, debut: '2026-01-01', motif: 'Essai' });
  const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio.jeton, { raisonSociale: 'Garage Nord', identifiant: '7654321B/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
  const commercial = await personne('commercial');
  const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: commercial.email, roles: ['commercial'] })).corps.jeton);
  await appeler('POST', '/invitations/accepter', commercial.jeton, { jeton: invitation });
  const factures: string[] = [];
  for (const b of [
    { type: 'facture', tiers: client, datePiece: '2026-10-01', lignes: [{ designation: 'Porte', quantite: '2', prixUnitaire: '500.125', tauxTva: '19' }] },
    { type: 'facture', tiers: client, datePiece: '2026-10-02', devise: 'EUR', cours: '3.412345', lignes: [{ designation: 'Pose', quantite: '1', prixUnitaire: '99.99', tauxTva: '7' }] },
  ]) {
    const id = String((await appeler('POST', `/entreprises/${ent}/ventes`, proprio.jeton, b)).corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/ventes/${id}/emettre`, proprio.jeton)).statut).toBe(200);
    factures.push(id);
  }
  const brouillon = String((await appeler('POST', `/entreprises/${ent}/ventes`, commercial.jeton, { type: 'facture', tiers: client, datePiece: '2026-10-03', lignes: [{ designation: 'Vis', quantite: '0.125', prixUnitaire: '2.525', tauxTva: '19' }] })).corps.id);
  return { ent, proprio, commercial, serie, client, factures, brouillon };
}
// Un cabinet qui tient le dossier : son organisation, un collaborateur, un mandat actif, l'affectation.
async function cabinetSur(ent: string, accordePar: string) {
  const collab = await personne('collaborateur');
  const cab = (await admin.query(`insert into socle.organisation (type, nom, code_cabinet) values ('cabinet', 'Cabinet Essai', $1) returning id`, [`CAB${String(100000 + n)}`])).rows[0].id;
  const membre = (await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, '{saisie}') returning id`, [collab.id, cab])).rows[0].id;
  const mandat = (await admin.query(`insert into socle.mandat (cabinet, entreprise, accorde_par, debut, statut) values ($1, $2, $3, '2026-01-01', 'actif') returning id`, [cab, ent, accordePar])).rows[0].id;
  await admin.query(`insert into socle.mandat_affectation (mandat, membre, role) values ($1, $2, 'saisie')`, [mandat, membre]);
  return { collab, cab };
}
// Refaire l'empreinte de fin d'un fichier retouché (pour essayer un défaut que l'empreinte ne suffit pas à voir).
function resigner(lignes: string[]): string[] {
  const corps = lignes.slice(0, -1);
  return [...corps, JSON.stringify({ fin: true, empreinte: createHash('sha256').update(corps.join('\n'), 'utf8').digest('hex') })];
}
const donnees = (lignes: string[], table: string, role = 'entreprise') => {
  const i = lignes.findIndex((l) => l.startsWith('{"table":') && JSON.parse(l).table === table && JSON.parse(l).role === role);
  return i;
};

let A: Awaited<ReturnType<typeof entreprise>>;
let B: Awaited<ReturnType<typeof entreprise>>;
let cabinet: Awaited<ReturnType<typeof cabinetSur>>;
let fichier: string[] = [];

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  await app.ready();
  A = await entreprise('Menuiserie du Cap');
  B = await entreprise('La voisine');
  cabinet = await cabinetSur(A.ent, A.proprio.id);
  // Un entier au-delà de 2^53 : lu en JavaScript, il perdrait son dernier chiffre.
  await admin.query('update socle.tiers set revision = 9007199254740993 where id = $1', [A.client]);
  fichier = await exporter(admin, A.ent);
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('exporter et restaurer UNE entreprise', () => {
  it('chaque table de la base a sa place dans l\'export, et une table qui porte une entreprise part avec elle ou dit pourquoi', async () => {
    expect(await tablesNonClassees(admin)).toEqual([]);
    const avecEntreprise = (await admin.query(`select distinct n.nspname || '.' || c.relname t from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where a.attname = 'entreprise' and c.relkind in ('r', 'p') and not c.relispartition and n.nspname !~ '^pg_'`)).rows.map((r) => r.t as string);
    for (const t of avecEntreprise) expect(['entreprise', 'hors'], t).toContain(CLASSEMENT[t]?.classe);
  });

  it('J1 : le propriétaire de la voisine ne lit rien de l\'entreprise, par aucune table qui porte une entreprise', async () => {
    const tables = (await admin.query(`select distinct n.nspname || '.' || c.relname t from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where a.attname = 'entreprise' and c.relkind in ('r', 'p') and not c.relispartition and n.nspname !~ '^pg_' order by 1`)).rows.map((r) => r.t as string);
    let remplies = 0;
    for (const t of tables) {
      const chezA = (await admin.query(`select count(*)::int n from ${t} where entreprise = $1`, [A.ent])).rows[0].n as number;
      if (chezA > 0) remplies++;
      // Une table que le serveur n'a pas le droit de lire ne montre rien non plus.
      const parB = await enTantQue(pool, B.proprio.id, async (tx) => {
        await tx.query('savepoint lecture');
        try {
          return (await tx.query(`select count(*)::int n from ${t} where entreprise = $1`, [A.ent])).rows[0].n as number;
        } catch (e) {
          if ((e as { code?: string }).code !== '42501') throw e;
          await tx.query('rollback to savepoint lecture');
          return 0;
        }
      });
      expect(parB, t).toBe(0);
    }
    // Une phrase rassurante se vérifie sur un univers non vide : l'entreprise a des lignes dans la
    // plupart de ces tables.
    expect(remplies).toBeGreaterThanOrEqual(10);
  });

  it('une table nouvelle que personne n\'a rangée arrête l\'export', async () => {
    await admin.query('create schema essai_export; create table essai_export.t (entreprise uuid)');
    try {
      await expect(exporter(admin, A.ent)).rejects.toThrow(/table non classée pour l'export : essai_export\.t/);
    } finally {
      await admin.query('drop schema essai_export cascade');
    }
  });

  it('l\'export ne porte rien de la voisine, et aucun secret de connexion', () => {
    const texte = fichier.join('\n');
    for (const id of [B.ent, B.client, ...B.factures, B.proprio.id]) expect(texte).not.toContain(id);
    for (const secret of ['empreinte_mot_de_passe', 'cle_publique', 'reconnu_jusqu_au', 'code_cabinet', 'telephone_verifie_le', '$argon2']) expect(texte).not.toContain(secret);
    expect(JSON.parse(fichier[0] ?? '')).toMatchObject({ format: 'skanfact-entreprise', entreprise: A.ent, raisonSociale: 'Menuiserie du Cap' });
  });

  it('restaurée dans une base vide, l\'entreprise se ré-exporte à l\'identique, se relit, et sa chaîne se contrôle', async () => {
    const base = await baseNeuve('skanfact_test_restauration');
    const cible = new pg.Client({ connectionString: base.admin });
    await cible.connect();
    const poolCible = creerPool(base.app);
    try {
      const bilan = await restaurer(cible, fichier);
      expect(bilan.tables.find((t) => t.table === 'ventes.piece')?.lignes).toBe(3);
      const encore = await exporter(cible, A.ent);
      // Tout est identique, sauf l'en-tête (l'heure de l'export) et la trace, qui porte une ligne
      // de plus : la restauration elle-même.
      const iAudit = donnees(fichier, 'socle.audit');
      expect(encore.length).toBe(fichier.length);
      for (let i = 1; i < fichier.length - 1; i++) {
        if (i === iAudit || i === iAudit + 1) continue;
        expect(encore[i], `ligne ${i} : ${fichier[i]?.slice(0, 60)}`).toBe(fichier[i]);
      }
      const traceAvant = JSON.parse(fichier[iAudit + 1] ?? '') as { geste: string }[];
      const traceApres = JSON.parse(encore[iAudit + 1] ?? '') as { geste: string }[];
      expect(traceApres.filter((t) => t.geste !== 'socle.entreprise.restaurer')).toEqual(traceAvant);
      expect(traceApres.filter((t) => t.geste === 'socle.entreprise.restaurer')).toHaveLength(1);
      // Le propriétaire relit ses factures comme avant, et la chaîne de la série se contrôle.
      for (const id of [...A.factures, A.brouillon]) {
        const avant = await enTantQue(pool, A.proprio.id, (tx) => lirePiece(tx, A.ent, id));
        const apres = await enTantQue(poolCible, A.proprio.id, (tx) => lirePiece(tx, A.ent, id));
        expect(apres).toEqual(avant);
      }
      expect(await enTantQue(poolCible, A.proprio.id, (tx) => controler(tx, A.ent, `serie:${A.serie}`, (o) => relirePourChaine(tx, A.ent, o.id))))
        .toEqual({ ok: true });
      // Le collaborateur du cabinet voit toujours le dossier ; la personne recréée n'a pas de mot de passe.
      expect((await enTantQue(poolCible, cabinet.collab.id, (tx) => tx.query('select id from socle.entreprise'))).rows).toEqual([{ id: A.ent }]);
      expect((await cible.query('select empreinte_mot_de_passe from socle.utilisateur where id = $1', [A.proprio.id])).rows).toEqual([{ empreinte_mot_de_passe: null }]);
      // Un entier de 64 bits traverse l'export et la restauration sans perdre un chiffre.
      expect((await cible.query('select revision::text from socle.tiers where id = $1', [A.client])).rows).toEqual([{ revision: '9007199254740993' }]);
      // Une seconde restauration n'écrase rien.
      await expect(restaurer(cible, fichier)).rejects.toThrow(/existe déjà/);
    } finally {
      await cible.end();
      await poolCible.end();
      await base.jeter();
    }
  });

  it('un fichier coupé ou abîmé est refusé ; une base aux migrations différentes aussi ; un lien qui mène nulle part annule tout', async () => {
    const base = await baseNeuve('skanfact_test_restauration');
    const cible = new pg.Client({ connectionString: base.admin });
    await cible.connect();
    try {
      await expect(restaurer(cible, fichier.slice(0, -3).concat(fichier.at(-1) ?? ''))).rejects.toThrow(/coupé ou abîmé/);
      const abime = [...fichier];
      const i = donnees(abime, 'ventes.piece') + 1;
      abime[i] = (abime[i] ?? '').replace('"net_a_payer": 1', '"net_a_payer": 2');
      expect(abime[i]).not.toBe(fichier[i]);
      await expect(restaurer(cible, abime)).rejects.toThrow(/coupé ou abîmé/);

      const autreNiveau = [...fichier];
      const entete = JSON.parse(autreNiveau[0] ?? '');
      entete.migrations[0].empreinte = '0'.repeat(64);
      autreNiveau[0] = JSON.stringify(entete);
      await expect(restaurer(cible, resigner(autreNiveau))).rejects.toThrow(/pas les mêmes migrations/);

      const sansPersonnes = [...fichier];
      sansPersonnes[donnees(sansPersonnes, 'socle.utilisateur', 'reference') + 1] = '[]';
      await expect(restaurer(cible, resigner(sansPersonnes))).rejects.toThrow(/désignent une ligne absente/);
      expect((await cible.query('select count(*)::int n from socle.entreprise')).rows).toEqual([{ n: 0 }]);
    } finally {
      await cible.end();
      await base.jeter();
    }
  });
});
