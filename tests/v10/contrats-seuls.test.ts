// Les factures périodiques émises seules (brique 129 ; docs/api-situation.md, S7). Ce que le serveur garantit :
//   - un contrat « émis seul », actif, dont la date est venue, a sa facture fabriquée comme la v10 la fabrique, puis
//     émise par le serveur (numéro, montants scellés, avis « facture émise ») ; les périodes manquées se rattrapent ;
//   - le contrat avance d'une période par facture ; un second tour le même jour n'émet rien de plus ;
//   - un contrat ordinaire, ou suspendu, n'est pas touché ;
//   - une émission refusée n'émet rien : son motif est noté sur le contrat, qui se retente le lendemain ;
//   - seuls le propriétaire et l'administrateur font d'un contrat un contrat émis seul.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { emettreLesContrats, emettreUnContrat } from '../../serveur/v10/contrats.ts';
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
let n = 0;
async function personne(prenom: string) {
  const email = `contrats-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
// Un contrat comme le formulaire de la v10 l'écrit : 89,000 HT par mois, TVA 19 %.
const contrat = (id: string, clientId: string, plus: Record<string, unknown> = {}) => ({
  id, clientId, every: 'month', day: 5, nextDate: '2026-08-05', active: true, subject: 'Abonnement de la boutique — {mois}',
  lines: [{ label: 'Hébergement {mois}', description: 'Période de {mois}', qty: 1, unit: 'mois', unitPrice: 89, vatRate: 19 }],
  discountRate: 0, withholdingRate: 0, notes: 'Merci pour {annee}', reference: 'ABO-7', currency: 'DT', exchangeRate: '', createdAt: 1, ...plus,
});
const le = (iso: string) => new Date(`${iso}T08:00:00Z`);

const entreprises: string[] = [];
beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  await plusSeuls('', []);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
// Le tour des contrats parcourt toute la base : ceux des autres tests n'y sont plus émis seuls (avant), ni ceux de
// celui-ci (après). Et la console de ce test n'existe pas : ses avis ne restent pas à livrer.
const plusSeuls = (filtre: string, valeurs: unknown[]) => admin.query(`update socle.dossier_v10 set contenu = contenu - 'emettreSeul' where collection = 'recurring' ${filtre}`, valeurs);
afterAll(async () => {
  await plusSeuls('and entreprise = any($1)', [entreprises]);
  await admin.query('update socle.avis set abandonne_le = now() where entreprise = any($1) and livre_le is null and abandonne_le is null', [entreprises]);
  await app.close(); await admin.end(); await pool.end();
});

describe('les factures périodiques émises seules', () => {
  it('le serveur émet les factures dues des contrats émis seuls, rattrape les périodes, n\'émet rien deux fois, note un refus', async () => {
    const nadia = await personne('nadia');
    const ent = String((await appeler('POST', '/entreprises-essai', nadia.jeton)).corps.id);
    entreprises.push(ent);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as Objet[];
    const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const objets = await lire();
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    const atelier = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Atelier'));
    if (!menuiserie || !atelier) throw new Error('clients d\'exemple absents');
    // L'Atelier est exonéré du timbre.
    expect((await envoyer(nadia.jeton, [{ collection: 'clients', cle: atelier.cle, rang: atelier.rang, revision: atelier.revision, contenu: { ...atelier.contenu, stampExempt: true } }])).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/avis-abonnements`, nadia.jeton, { url: 'https://console.exemple.tn/avis', evenements: ['facture.emise'] })).statut).toBe(201);

    expect((await envoyer(nadia.jeton, [
      { collection: 'recurring', cle: 'r1', rang: 0, revision: null, contenu: contrat('r1', menuiserie.cle, { emettreSeul: true, day: 31, nextDate: '2026-07-31' }) },
      { collection: 'recurring', cle: 'r2', rang: 1, revision: null, contenu: contrat('r2', menuiserie.cle) },
      { collection: 'recurring', cle: 'r3', rang: 2, revision: null, contenu: contrat('r3', menuiserie.cle, { emettreSeul: true, active: false }) },
      { collection: 'recurring', cle: 'r4', rang: 3, revision: null, contenu: contrat('r4', atelier.cle, { emettreSeul: true, nextDate: '2026-10-06', day: 6, every: 'quarter' }) },
      { collection: 'recurring', cle: 'r5', rang: 4, revision: null, contenu: contrat('r5', 'client-supprime', { emettreSeul: true, nextDate: '2026-10-01', day: 1, every: 'year' }) },
      // Une date mal écrite : ce contrat n'est jamais dû (et ne fait pas tomber le tour).
      { collection: 'recurring', cle: 'r6', rang: 5, revision: null, contenu: contrat('r6', menuiserie.cle, { emettreSeul: true, nextDate: '' }) },
    ])).statut).toBe(200);

    // Le 6 octobre, trois contrats dus : r1 (le 31 de chaque mois) rattrape juillet, août et septembre (le 30) ; r4 émet le
    // sien ; r5 est refusé.
    expect(await emettreLesContrats(ctx, le('2026-10-06'))).toEqual({ contrats: 3, emises: 4, refusees: 1 });
    const pieces = (await admin.query(`select ref_v10, numero_texte, date_piece, echeance, objet, net_a_payer, timbre, statut from ventes.piece
      where entreprise = $1 order by numero_texte`, [ent])).rows;
    expect(pieces).toEqual([
      { ref_v10: 'contrat-r1-2026-07-31', numero_texte: 'FAC-2026-001', date_piece: '2026-07-31', echeance: '2026-08-30', objet: 'Abonnement de la boutique — juillet 2026', net_a_payer: 106910n, timbre: 1000n, statut: 'emise' },
      { ref_v10: 'contrat-r1-2026-08-31', numero_texte: 'FAC-2026-002', date_piece: '2026-08-31', echeance: '2026-09-30', objet: 'Abonnement de la boutique — août 2026', net_a_payer: 106910n, timbre: 1000n, statut: 'emise' },
      { ref_v10: 'contrat-r1-2026-09-30', numero_texte: 'FAC-2026-003', date_piece: '2026-09-30', echeance: '2026-10-30', objet: 'Abonnement de la boutique — septembre 2026', net_a_payer: 106910n, timbre: 1000n, statut: 'emise' },
      { ref_v10: 'contrat-r4-2026-10-06', numero_texte: 'FAC-2026-004', date_piece: '2026-10-06', echeance: '2026-11-05', objet: 'Abonnement de la boutique — octobre 2026', net_a_payer: 105910n, timbre: 0n, statut: 'emise' },
    ]);
    const apres = await lire();
    const objet = (collection: string, cle: string) => apres.find((o) => o.collection === collection && o.cle === cle)?.contenu;
    // La facture du dossier, comme l'écran l'aurait émise : son numéro, son contrat, ses lignes remplies.
    expect(objet('documents', 'contrat-r1-2026-08-31')).toMatchObject({ number: 'FAC-2026-002', status: 'envoyée', recurringId: 'r1', clientId: menuiserie.cle,
      date: '2026-08-31', dueDate: '2026-09-30', subject: 'Abonnement de la boutique — août 2026', notes: 'Merci pour 2026', reference: 'ABO-7',
      discountRate: 0, withholdingRate: 0, applyStamp: true, lang: 'fr', currency: 'DT', exchangeRate: '', payments: [],
      lines: [{ label: 'Hébergement août 2026', description: 'Période de août 2026', unitPrice: 89, vatRate: 19 }] });
    // Les contrats : r1 avance de trois mois (et revient au 31) ; r4 d'un trimestre ; r2 (ordinaire) et r3 (suspendu) ne
    // bougent pas ; r5 dit pourquoi.
    expect(objet('recurring', 'r1')).toMatchObject({ lastIssued: '2026-09-30', nextDate: '2026-10-31' });
    expect(objet('recurring', 'r4')).toMatchObject({ lastIssued: '2026-10-06', nextDate: '2027-01-06' });
    expect(objet('recurring', 'r2')).toMatchObject({ nextDate: '2026-08-05' });
    expect(objet('recurring', 'r2')).not.toHaveProperty('lastIssued');
    expect(objet('recurring', 'r3')).toMatchObject({ nextDate: '2026-08-05' });
    expect(objet('recurring', 'r5')).toMatchObject({ nextDate: '2026-10-01', refusServeur: { le: '2026-10-06', echeance: '2026-10-01', motif: expect.stringMatching(/client/i) } });
    // Chaque facture est annoncée à la console.
    expect((await admin.query(`select count(*)::int n from socle.avis where entreprise = $1 and evenement = 'facture.emise'`, [ent])).rows[0].n).toBe(4);

    // Un second tour le même jour : rien de plus, et le refusé attend demain.
    expect(await emettreLesContrats(ctx, le('2026-10-06'))).toEqual({ contrats: 0, emises: 0, refusees: 0 });
    // Le lendemain, le refusé se retente (et se refuse encore).
    expect(await emettreLesContrats(ctx, le('2026-10-07'))).toEqual({ contrats: 1, emises: 0, refusees: 1 });
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1', [ent])).rows[0].n).toBe(4);

    const relire = async (cle: string) => (await lire()).find((o) => o.collection === 'recurring' && o.cle === cle) as Objet;
    // La date de r4 remise en arrière à la main : sa facture d'octobre existe déjà, elle ne se refait pas.
    const r4 = await relire('r4');
    expect((await envoyer(nadia.jeton, [{ collection: 'recurring', cle: 'r4', rang: r4.rang, revision: r4.revision, contenu: { ...r4.contenu, nextDate: '2026-10-06' } }])).statut).toBe(200);
    expect(await emettreLesContrats(ctx, le('2026-10-08'))).toEqual({ contrats: 2, emises: 0, refusees: 1 });
    expect((await relire('r4')).contenu).toMatchObject({ nextDate: '2027-01-06' });
    // r5 réparé (son client), et l'entreprise payée à 15 jours : sa facture part, le refus s'efface.
    const societe = (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company') as Objet;
    const r5 = await relire('r5');
    expect((await envoyer(nadia.jeton, [
      { collection: '_racine', cle: 'company', rang: societe.rang, revision: societe.revision, contenu: { ...societe.contenu, paymentTermsDays: 15 } },
      { collection: 'recurring', cle: 'r5', rang: r5.rang, revision: r5.revision, contenu: { ...r5.contenu, clientId: menuiserie.cle } },
    ])).statut).toBe(200);
    expect(await emettreLesContrats(ctx, le('2026-10-09'))).toEqual({ contrats: 1, emises: 1, refusees: 0 });
    expect((await admin.query(`select echeance from ventes.piece where entreprise = $1 and ref_v10 = 'contrat-r5-2026-10-01'`, [ent])).rows).toEqual([{ echeance: '2026-10-16' }]);
    expect((await relire('r5')).contenu).not.toHaveProperty('refusServeur');
    // r5 est annuel : la suivante dans un an.
    expect((await relire('r5')).contenu).toMatchObject({ nextDate: '2027-10-01' });
    // Relus sous verrou, un contrat ordinaire et un contrat suspendu n'émettent rien, même appelés directement.
    const proprietaire = String((await admin.query('select utilisateur from socle.membre where entreprise = $1', [ent])).rows[0].utilisateur);
    for (const cle of ['r2', 'r3']) {
      const avant = await relire(cle);
      expect(await enTantQue(pool, proprietaire, (tx) => emettreUnContrat(tx, ent, cle, proprietaire, '2026-10-09'))).toBe(0);
      expect((await relire(cle)).revision).toBe(avant.revision);
    }
    // Quatorze périodes en retard : douze par tour, comme la v10.
    expect((await envoyer(nadia.jeton, [{ collection: 'recurring', cle: 'r7', rang: 6, revision: null, contenu: contrat('r7', menuiserie.cle, { emettreSeul: true, nextDate: '2025-09-05' }) }])).statut).toBe(200);
    expect(await emettreLesContrats(ctx, le('2026-10-09'))).toEqual({ contrats: 1, emises: 12, refusees: 0 });
    expect((await relire('r7')).contenu).toMatchObject({ lastIssued: '2026-08-05', nextDate: '2026-09-05' });

    // Un commercial ne fait pas d'un contrat un contrat émis seul ; il modifie un contrat qui l'est déjà, sans y toucher.
    const sami = await personne('sami');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    const r2 = await relire('r2');
    const refus = await envoyer(sami.jeton, [{ collection: 'recurring', cle: 'r2', rang: 1, revision: r2.revision, contenu: { ...r2.contenu, emettreSeul: true } }]);
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif)).toContain('se fait par le propriétaire ou un administrateur');
    const r1 = await relire('r1');
    expect((await envoyer(sami.jeton, [{ collection: 'recurring', cle: 'r1', rang: 0, revision: r1.revision, contenu: { ...r1.contenu, notes: 'Merci pour votre confiance' } }])).statut).toBe(200);
  });
});
