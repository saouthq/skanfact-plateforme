// (1.379.6, issue 15 V-1) Le seuil de retenue que le serveur applique à l'émission est gardé sur la pièce du dossier quand
// l'écran ne l'y a pas posé : sans lui, l'écran prêtait à la facture une retenue que le serveur n'avait pas scellée, et
// l'avoir de cette facture était refusé (« 210,987 à l'écran, 214,200 au serveur »). Et le refus d'écart parle en français.

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { routesCaisse } from '../../serveur/caisse/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
const jour = (decalage: number) => aujourdhuiATunis(new Date(Date.now() + decalage * 86_400_000));
// 2 × 450,500 ; TVA 19 % ; timbre 1,000 : 1 073,190.
const facture = (id: string, clientId: string) => ({
  id, type: 'facture', number: '', date: jour(-30), dueDate: jour(0), clientId, subject: 'Abonnement de la boutique', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
// La console de ce test n'existe pas : ses avis ne restent pas à livrer pour les tests qui suivent (le livreur, lui,
// prend tous les avis dus de la base).
const entreprises: string[] = [];
afterAll(async () => {
  await admin.query('update socle.avis set abandonne_le = now() where entreprise = any($1) and livre_le is null and abandonne_le is null', [entreprises]);
  await app.close(); await admin.end(); await pool.end();
});

describe('le seuil de retenue scellé sur la pièce', () => {
  it('une facture sous le seuil, émise sans seuil posé par l\'écran, le garde ; le refus d\'écart écrit « 1073,190 »', async () => {
    const email = `retenue-seuil-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
    entreprises.push(ent);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const objets = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const client = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    const proprio = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'retenue.seuil', '5000000', '2000-01-01', 'Seuil de l''essai', $2)`, [ent, proprio]);
    // 901,000 HT + 19 % = 1 072,190 hors timbre : sous les 5 000 DT, la retenue de 1,5 % ne s'applique pas.
    const doc = { ...facture('fs1', client.cle), withholdingRate: { '~n': '1.5' } };
    await envoyer([{ collection: 'documents', cle: 'fs1', rang: 0, revision: null, contenu: doc }]);
    // L'écran qui n'a pas lu le seuil annonce la retenue : refusé, et les deux montants se lisent en français.
    const refus = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: client.contenu, revision: 1, rang: 0, netAPayer: '1057.107' });
    expect(refus.statut).not.toBe(200);
    expect(JSON.stringify(refus.corps)).toContain('1057,107 DT');
    expect(JSON.stringify(refus.corps)).toContain('1073,190 DT');
    expect(JSON.stringify(refus.corps)).not.toContain('1057.107');
    // Émise au montant du serveur, sans seuil sur la pièce : le serveur scelle sans retenue, et pose son seuil sur la pièce.
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: client.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    if (r.statut !== 200) throw new Error(JSON.stringify(r.corps));
    expect((r.corps.contenu as Record<string, unknown>).seuilRetenue).toBe(5000);
    // Une facture sans retenue ne reçoit rien : le seuil ne la concerne pas.
    const sans = facture('fs2', client.cle);
    await envoyer([{ collection: 'documents', cle: 'fs2', rang: 0, revision: null, contenu: sans }]);
    const r2 = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: sans, client: client.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    expect(r2.statut).toBe(200);
    expect((r2.corps.contenu as Record<string, unknown>).seuilRetenue).toBeUndefined();
  });
  it('(1.387.88, migration 0222) une facture d\'avant la 1.379.6, sous le seuil, reçoit le seuil que le serveur a appliqué ; rien d\'autre ne bouge', async () => {
    const email = `retenue-0222-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
    entreprises.push(ent);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const objets = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const client = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    const proprio = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'retenue.seuil', '5000000', '2000-01-01', 'Seuil de l''essai', $2)`, [ent, proprio]);
    const doc = { ...facture('fs1', client.cle), withholdingRate: { '~n': '1.5' } };
    await envoyer([{ collection: 'documents', cle: 'fs1', rang: 0, revision: null, contenu: doc }]);
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: client.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    if (r.statut !== 200) throw new Error(JSON.stringify(r.corps));
    // Au-dessus du seuil : 10 000 HT + 19 % = 11 900 hors timbre, retenue 1,5 % = 178,500 scellée ; net 11 722,500.
    const haut = { ...facture('fs3', client.cle), withholdingRate: { '~n': '1.5' }, lines: [{ label: 'Salle à manger complète', description: '', qty: 1, unit: '', unitPrice: { '~n': '10000' }, vatRate: 19 }] };
    await envoyer([{ collection: 'documents', cle: 'fs3', rang: 1, revision: null, contenu: haut }]);
    const r3 = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: haut, client: client.contenu, revision: 1, rang: 1, netAPayer: '11722.500' });
    if (r3.statut !== 200) throw new Error(JSON.stringify(r3.corps));
    expect(String((await admin.query('select retenue from ventes.piece where entreprise = $1 and ref_v10 = $2', [ent, 'fs3'])).rows[0].retenue)).toBe('178500');
    // Une pièce d'avant la 1.379.6 : scellée sans retenue, mais sans le seuil sur la pièce du dossier.
    await admin.query("update socle.dossier_v10 set contenu = contenu - 'seuilRetenue' where entreprise = $1 and collection = 'documents' and cle = 'fs1'", [ent]);
    const etat = async () => Object.fromEntries((await admin.query("select cle, revision, contenu ->> 'seuilRetenue' as seuil from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle in ('fs1', 'fs3')", [ent])).rows.map((x: { cle: string; revision: string; seuil: string | null }) => [x.cle, { revision: Number(x.revision), seuil: x.seuil }]));
    const avant = await etat();
    expect(avant.fs1?.seuil).toBeNull();
    const migration = fs.readFileSync(path.join(import.meta.dirname, '../../base/migrations/0222_seuil_retenue_pieces_anciennes.sql'), 'utf8');
    await admin.query(migration);
    const apres = await etat();
    expect(apres.fs1).toEqual({ revision: (avant.fs1?.revision ?? 0) + 1, seuil: '5000' });
    expect(apres.fs3).toEqual(avant.fs3);
    // Rejouée : rien ne bouge plus.
    await admin.query(migration);
    expect(await etat()).toEqual(apres);
  });
});
