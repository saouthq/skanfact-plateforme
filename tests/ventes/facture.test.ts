// La facture de vente, par l'API, contre la vraie base : du brouillon à l'émission (01 § 6, § 7,
// R6, R7, R9, R11 ; 03 § 2.1 « Ventes »).

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { creerApp } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { controler } from '../../serveur/journal.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { relirePourChaine } from '../../serveur/ventes/pieces.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { t } from '../../textes/index.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `vente-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
// Une entreprise prête à facturer : son propriétaire (code en place), une série, un client.
async function entreprise(options: { serie?: boolean } = {}) {
  const proprio = await personne('proprio');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Menuiserie du Cap', matriculeFiscal: `${String(1_000_000 + n).slice(-7)}A/A/M/000` })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  let serie = '';
  if (options.serie !== false) serie = String((await appeler('POST', `/entreprises/${ent}/series`, proprio.jeton, { type: 'facture', prefixe: 'FAC', legale: true })).corps.id);
  const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio.jeton, { raisonSociale: 'Garage Nord', identifiant: '7654321B/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
  return { ent, proprio, serie, client };
}
async function membre(ent: string, proprio: { jeton: string }, role: string) {
  const p = await personne(role);
  const jeton = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: p.email, roles: [role] })).corps.jeton);
  await appeler('POST', '/invitations/accepter', p.jeton, { jeton });
  return p;
}
const FACTURE = (client: string, datePiece = '2026-10-01') => ({
  type: 'facture', tiers: client, datePiece,
  lignes: [{ designation: 'Porte en chêne', quantite: '2', prixUnitaire: '500', tauxTva: '19' }, { designation: 'Pose', quantite: '1', prixUnitaire: '100', tauxTva: '7' }],
});
async function brouillon(e: { ent: string; proprio: { jeton: string }; client: string }, corps: unknown = FACTURE(e.client)) {
  const r = await appeler('POST', `/entreprises/${e.ent}/ventes`, e.proprio.jeton, corps);
  expect(r).toMatchObject({ statut: 201 });
  return String(r.corps.id);
}

beforeAll(async () => {
  await admin.connect();
  // Le timbre, une règle commune d'essai : 1 DT depuis 2000 (une vraie règle a sa source légale).
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la facture, du brouillon à l\'émission', () => {
  it('J1 en petit : un brouillon se calcule à la volée, s\'émet avec son numéro, et se relit tel qu\'émis', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    const avant = (await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).corps;
    expect(avant).toMatchObject({ statut: 'brouillon', numero: null, totaux: { total_ht: '1100.000', total_tva: '197.000', timbre: '1.000', total_ttc: '1298.000', net_a_payer: '1298.000' } });
    const r = await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ statut: 'emise', numero: 'FAC-2026-001', totaux: avant.totaux });
    expect(r.corps.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).corps).toEqual(r.corps);
  });

  it('les montants sortent en texte exact, jamais en nombre à virgule', async () => {
    const e = await entreprise();
    const id = await brouillon(e, { ...FACTURE(e.client), lignes: [{ designation: 'Vis', quantite: '0.125', prixUnitaire: '2.525', tauxTva: '19' }] });
    const p = (await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).corps as { lignes: Record<string, unknown>[]; totaux: Record<string, unknown> };
    expect(p.lignes[0]).toMatchObject({ quantite: '0.125', prixUnitaire: '2.525000', ht: '0.316', tva: '0.060' });
    for (const v of Object.values(p.totaux)) expect(typeof v).toBe('string');
  });

  it('7.1.1 et R7 : une facture émise garde son timbre et sa copie quand la règle ou la fiche du client changent', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    const emise = (await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton)).corps;
    expect(emise.copie).toMatchObject({ client: { raisonSociale: 'Garage Nord' }, regles: { timbre: { valeur: 1000, origine: 'commune' } } });
    // Une règle de l'entreprise change le timbre pour toute l'année, et le client change de nom.
    expect((await appeler('POST', `/entreprises/${e.ent}/regles`, e.proprio.jeton, { code: 'timbre.facture', valeur: 600, debut: '2026-01-01', motif: 'Essai' })).statut).toBe(201);
    await admin.query(`update socle.tiers set raison_sociale = 'Garage Nord (nouveau nom)' where id = $1`, [e.client]);
    const relue = (await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).corps;
    expect(relue).toEqual(emise);
    // Un brouillon, lui, suit la règle du jour : il n'est encore rien.
    const nouveau = await brouillon(e);
    expect(((await appeler('GET', `/entreprises/${e.ent}/ventes/${nouveau}`, e.proprio.jeton)).corps.totaux as Record<string, string>).timbre).toBe('0.600');
  });

  it('une facture émise ne se modifie plus et ne s\'efface jamais, même par le propriétaire des tables', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton);
    const modif = await appeler('PUT', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton, { revision: 1, brouillon: FACTURE(e.client) });
    expect(modif).toMatchObject({ statut: 403, corps: { motif: 'Une pièce émise ne se modifie plus : on la corrige par un avoir.' } });
    expect((await appeler('DELETE', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).statut).toBe(403);
    await expect(admin.query(`update ventes.piece set net_a_payer = 1 where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`delete from ventes.piece where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`update ventes.ligne set prix_unitaire = 1 where piece = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`insert into ventes.ligne (piece, entreprise, rang, designation, quantite, prix_unitaire, taux_tva) values ($1, $2, 9, 'Ajout', 1000, 1, 0)`, [id, e.ent]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('le contrôle passe avant le numéro : un refus ne troue jamais la série', async () => {
    const e = await entreprise();
    const sansTimbre = await brouillon(e, FACTURE(e.client, '1999-12-31'));
    const lu = (await appeler('GET', `/entreprises/${e.ent}/ventes/${sansTimbre}`, e.proprio.jeton)).corps;
    expect(lu.avertissement).toMatch(/timbre fiscal n'est pas renseigné/);
    const refus = await appeler('POST', `/entreprises/${e.ent}/ventes/${sansTimbre}/emettre`, e.proprio.jeton);
    expect(refus).toMatchObject({ statut: 403, corps: { motif: 'Le timbre fiscal n\'est pas renseigné au 1999-12-31 : la facture ne s\'émet pas sans lui.' } });
    expect((await admin.query('select count(*) n from socle.compteur where serie = $1', [e.serie])).rows[0].n).toBe(0n);
    const bon = await brouillon(e, FACTURE(e.client, '2026-10-02'));
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${bon}/emettre`, e.proprio.jeton)).corps.numero).toBe('FAC-2026-001');
    // Une facture sans timbre demandé s'émet, elle, sans règle de timbre.
    const export_ = await brouillon(e, { ...FACTURE(e.client, '1999-12-31'), appliquerTimbre: false });
    // Le même numéro 1, une autre année : deux factures distinctes (FAC-2026-001 et FAC-1999-001).
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${export_}/emettre`, e.proprio.jeton)).corps.numero).toBe('FAC-1999-001');
  });

  it('une série qui repart à 1 chaque année écrit l\'année dans son numéro', async () => {
    const e = await entreprise({ serie: false });
    const r = await appeler('POST', `/entreprises/${e.ent}/series`, e.proprio.jeton, { type: 'facture', prefixe: 'FA', legale: true, format: '{P}-{N:4}' });
    expect(r).toMatchObject({ statut: 400, corps: { champ: 'format' } });
    // Et la base le refuse d'elle-même, si un chemin oubliait de le vérifier.
    await expect(enTantQue(pool, e.proprio.id, (tx) => tx.query(`select socle.creer_serie($1, 'facture', 'FB', true, 'annuelle', '{P}-{N:4}')`, [e.ent])))
      .rejects.toMatchObject({ code: '23514' });
    // Sans remise annuelle, l'année n'est pas obligatoire.
    expect((await appeler('POST', `/entreprises/${e.ent}/series`, e.proprio.jeton, { type: 'facture', prefixe: 'FC', legale: true, remise: 'jamais', format: '{P}{N:6}' })).statut).toBe(201);
  });

  it('sans série de factures, l\'émission est refusée et le refus dit où la créer', async () => {
    const e = await entreprise({ serie: false });
    const id = await brouillon(e);
    const r = await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton);
    expect(r).toMatchObject({ statut: 403, corps: { bouton: 'socle.reglages_fiscaux.modifier' } });
    expect(r.corps.motif).toMatch(/aucune série de factures/i);
  });

  it('une facture déjà émise ne s\'émet pas une seconde fois', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton);
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton)).corps.motif).toBe('Cette facture est déjà émise.');
  });

  it('les rôles : un caissier ne crée pas de brouillon de vente ; un commercial émet ; la lecture voit sans toucher', async () => {
    const e = await entreprise();
    const caissier = await membre(e.ent, e.proprio, 'caissier');
    const commercial = await membre(e.ent, e.proprio, 'commercial');
    const lecture = await membre(e.ent, e.proprio, 'lecture');
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes`, caissier.jeton, FACTURE(e.client))).statut).toBe(403);
    const id = String((await appeler('POST', `/entreprises/${e.ent}/ventes`, commercial.jeton, FACTURE(e.client))).corps.id);
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, lecture.jeton)).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, lecture.jeton)).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, commercial.jeton)).corps.numero).toBe('FAC-2026-001');
  });

  it('un brouillon modifié entre-temps n\'est pas écrasé (révision)', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    const premier = await appeler('PUT', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton, { revision: 1, brouillon: { ...FACTURE(e.client), objet: 'Première' } });
    expect(premier).toEqual({ statut: 200, corps: { revision: 2 } });
    const second = await appeler('PUT', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton, { revision: 1, brouillon: { ...FACTURE(e.client), objet: 'Seconde' } });
    expect(second).toMatchObject({ statut: 409, corps: { bouton: 'recharger' } });
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).corps.objet).toBe('Première');
  });

  it('supprimer un brouillon laisse sa trace', async () => {
    const e = await entreprise();
    const id = await brouillon(e);
    expect((await appeler('DELETE', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${id}`, e.proprio.jeton)).statut).toBe(404);
    const trace = (await admin.query(`select avant from socle.audit where objet_id = $1 and geste = 'ventes.brouillon.supprimer'`, [id])).rows;
    expect(trace).toEqual([{ avant: { type: 'facture', tiers: e.client, date: '2026-10-01' } }]);
  });

  it('le client d\'une autre entreprise ne sert pas ; une pièce en devise porte son cours ; une décimale de trop est refusée', async () => {
    const e = await entreprise();
    const autre = await entreprise();
    const ailleurs = await appeler('POST', `/entreprises/${e.ent}/ventes`, e.proprio.jeton, FACTURE(autre.client));
    expect(ailleurs.statut).toBe(403);
    expect(ailleurs.corps.motif).toMatch(/client appartient à l'entreprise de la pièce/);
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes`, e.proprio.jeton, { ...FACTURE(e.client), devise: 'EUR' })).corps.champ).toBe('cours');
    const decimale = await appeler('POST', `/entreprises/${e.ent}/ventes`, e.proprio.jeton,
      { ...FACTURE(e.client), lignes: [{ designation: 'x', quantite: '1.0005', prixUnitaire: '1', tauxTva: '19' }] });
    expect(decimale.corps.champ).toBe('lignes.0.quantite');
  });

  it('une facture en euros : au centime, le timbre converti au cours, déclaré 1,000 DT', async () => {
    const e = await entreprise();
    const id = await brouillon(e, { ...FACTURE(e.client), devise: 'EUR', cours: '3.4', lignes: [{ designation: 'Audit', quantite: '1', prixUnitaire: '1000', tauxTva: '19' }] });
    const r = (await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton)).corps;
    expect(r).toMatchObject({ devise: 'EUR', cours: '3.400000', totaux: { timbre: '0.29', timbre_base: '1.000', total_ttc: '1190.29' } });
  });
});

describe('le journal de la série, relu dans la base', () => {
  it('la chaîne des factures se contrôle en relisant les pièces ; une facture maquillée en base se voit', async () => {
    const e = await entreprise();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await brouillon(e);
      await appeler('POST', `/entreprises/${e.ent}/ventes/${id}/emettre`, e.proprio.jeton);
      ids.push(id);
    }
    const relire = (tx: pg.PoolClient) => (o: { id: string }) => relirePourChaine(tx, e.ent, o.id);
    const controle = () => enTantQue(pool, e.proprio.id, (tx) => controler(tx, e.ent, `serie:${e.serie}`, relire(tx)));
    expect(await controle()).toEqual({ ok: true });
    // L'état de la chaîne, lu par l'API : son rang (un entier de 64 bits) sort en texte.
    expect((await appeler('GET', `/entreprises/${e.ent}/chaines`, e.proprio.jeton)).corps.chaines)
      .toMatchObject([{ cle: `serie:${e.serie}`, rang: '3' }]);
    await admin.query('alter table ventes.piece disable trigger piece_scellee');
    try {
      await admin.query('update ventes.piece set net_a_payer = net_a_payer - 1000 where id = $1', [ids[1]]);
    } finally {
      await admin.query('alter table ventes.piece enable trigger piece_scellee');
    }
    expect(await controle()).toEqual({ ok: false, rang: 2, motif: t('journal.piece_modifiee') });
  });
});
