// Les avis des règlements (brique 128 ; docs/api-situation.md, S6) : une console abonnée apprend chaque règlement
// nouveau d'une facture, et la facture qui ne doit plus rien (par des règlements, ou par un avoir). Ce que le serveur
// garantit :
//   - un avis par règlement NOUVEAU ; un règlement modifié ou renvoyé tel quel n'en refait pas ;
//   - « facture réglée » une seule fois, quand le reste passe à zéro, avec le jour du règlement le plus récent ;
//   - un avoir qui solde une facture l'annonce aussi (`par: "avoir"`) ;
//   - un ticket de caisse, payé dans son geste, n'annonce rien.

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

describe('les avis des règlements', () => {
  it('chaque règlement nouveau, puis la facture réglée une seule fois ; par un avoir aussi ; jamais pour un ticket', async () => {
    const email = `evenements-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
    entreprises.push(ent);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const objets = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const client = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    // La console s'abonne aux deux événements.
    expect((await appeler('POST', `/entreprises/${ent}/avis-abonnements`, jeton, { url: 'https://console.exemple.tn/avis', evenements: ['reglement.enregistre', 'facture.reglee'] })).statut).toBe(201);
    let lus = 0;
    const nouveaux = async () => {
      const r = (await admin.query('select evenement, corps from socle.avis where entreprise = $1 order by cree_le, id', [ent])).rows.slice(lus);
      lus += r.length;
      return r as { evenement: string; corps: Record<string, unknown> }[];
    };

    const emises: Record<string, { contenu: Record<string, unknown>; revision: number; numero: string; id: string }> = {};
    const emettre = async (cle: string) => {
      const doc = facture(cle, client.cle);
      await envoyer([{ collection: 'documents', cle, rang: 0, revision: null, contenu: doc }]);
      const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: client.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
      if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
      const id = String((await admin.query('select id from ventes.piece where entreprise = $1 and ref_v10 = $2', [ent, cle])).rows[0].id);
      emises[cle] = { contenu: r.corps.contenu as Record<string, unknown>, revision: Number(r.corps.revision), numero: String(r.corps.numero), id };
    };
    const payer = async (cle: string, payments: unknown[]) => {
      const f = emises[cle];
      if (!f) throw new Error(`${cle} n'est pas émise`);
      const r = await envoyer([{ collection: 'documents', cle, rang: 0, revision: f.revision, contenu: { ...f.contenu, payments } }]);
      expect(r.statut).toBe(200);
      f.revision = Number((r.corps.revisions as { revision: number }[])[0]?.revision);
    };
    await emettre('f1');
    await emettre('f2');
    await emettre('f3');
    const ecran = (ref: string) => `/v10/?e=${ent}#/doc/${ref}`;
    const leClient = { id: expect.any(String), raisonSociale: expect.stringMatching(/^Menuiserie du Lac/) };

    // f1 : 300,000 reçus. Un avis, qui dit ce qui reste ; la facture n'est pas réglée.
    const p1 = { id: 'p1', date: jour(-20), amount: 300, method: 'virement', reference: 'VIR 17' };
    await payer('f1', [p1]);
    const a1 = await nouveaux();
    expect(a1).toEqual([{ evenement: 'reglement.enregistre', corps: {
      id: expect.any(String), date: jour(-20), montant: '300.000', mode: 'virement', reference: 'VIR 17', devise: 'TND',
      facture: { id: emises.f1?.id, numero: emises.f1?.numero, ecran: ecran('f1') }, client: leClient, reste: '773.190',
    } }]);
    // Le même règlement renvoyé (sa note changée) : pas un règlement nouveau.
    await payer('f1', [{ ...p1, note: 'Reçu par la banque' }]);
    expect(await nouveaux()).toEqual([]);
    // Le second, qui solde : son avis, puis « réglée », au jour du règlement le plus récent (le premier, saisi après,
    // est plus récent que celui qui solde).
    await payer('f1', [p1, { id: 'p2', date: jour(-25), amount: { '~n': '773.19' }, method: 'cheque' }]);
    expect(await nouveaux()).toEqual([
      { evenement: 'reglement.enregistre', corps: expect.objectContaining({ montant: '773.190', mode: 'cheque', reference: null, reste: '0.000' }) },
      { evenement: 'facture.reglee', corps: {
        id: emises.f1?.id, numero: emises.f1?.numero, ecran: ecran('f1'), client: leClient, devise: 'TND', netAPayer: '1073.190', date: jour(-20), par: 'reglement',
      } },
    ]);
    // Déjà réglée : un règlement de plus (un trop-perçu) s'annonce, la facture ne se re-règle pas.
    await payer('f1', [p1, { id: 'p2', date: jour(-25), amount: { '~n': '773.19' }, method: 'cheque' }, { id: 'p3', date: jour(-1), amount: 5, method: 'especes' }]);
    expect((await nouveaux()).map((a) => a.evenement)).toEqual(['reglement.enregistre']);

    // f2 : un règlement MODIFIÉ qui solde (300 devenus 1 073,190) : pas d'avis de règlement, mais « réglée ».
    await payer('f2', [{ id: 'q1', date: jour(-3), amount: 300, method: 'virement' }]);
    expect((await nouveaux()).map((a) => a.evenement)).toEqual(['reglement.enregistre']);
    await payer('f2', [{ id: 'q1', date: jour(-2), amount: { '~n': '1073.19' }, method: 'virement' }]);
    expect(await nouveaux()).toEqual([{ evenement: 'facture.reglee', corps: expect.objectContaining({ numero: emises.f2?.numero, date: jour(-2), par: 'reglement' }) }]);

    // f3 : 537,095 reçus, puis un avoir d'une table (536,095) : elle ne doit plus rien, par l'avoir.
    await payer('f3', [{ id: 'r1', date: jour(-5), amount: { '~n': '537.095' }, method: 'virement' }]);
    expect((await nouveaux()).map((a) => [a.evenement, a.corps.reste])).toEqual([['reglement.enregistre', '536.095']]);
    const avoir = { id: 'a1', type: 'avoir', number: '', date: jour(-1), clientId: client.cle, creditOf: 'f3', creditReason: 'Une table rendue', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [] };
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, jeton, { document: avoir, client: client.contenu, revision: null, rang: 1, netAPayer: '536.095' })).statut).toBe(200);
    expect(await nouveaux()).toEqual([{ evenement: 'facture.reglee', corps: expect.objectContaining({ numero: emises.f3?.numero, date: jour(-1), par: 'avoir', netAPayer: '1073.190' }) }]);

    // Un ticket de caisse, payé dans son geste : rien à annoncer.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '0' })).statut).toBe(200);
    const ticket = { id: 't1', type: 'facture', ticket: true, number: '', date: jour(0), dueDate: jour(0), clientId: '', subject: '', reference: '',
      lines: [{ itemId: '', label: 'Pain', unit: '', qty: 1, unitPrice: { '~n': '1' }, vatRate: 7 }], discountRate: 0, applyStamp: false, stampFee: 0,
      status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '', createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: 2, rendu: null },
      payments: [{ id: 'pt1', date: jour(0), amount: { '~n': '1.07' }, method: 'especes', accountId: '', reference: '', note: '' }] };
    const encaisse = await appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: ticket, rang: 0, netAPayer: '1.070' });
    expect(encaisse.statut).toBe(200);
    expect((await admin.query(`select count(*)::int n from ventes.reglement r join ventes.piece p on p.id = r.piece where p.entreprise = $1 and p.ref_v10 = 't1'`, [ent])).rows[0].n).toBe(1);
    expect(await nouveaux()).toEqual([]);
  });
});
