// L'accord d'un responsable au-delà de l'encours d'un client (brique 98 ; 03 D11 ; docs/accords.md). Ce que le
// serveur garantit, quoi que l'écran lui envoie :
//   - le dépassement se calcule au serveur, sur le dossier en base (le même code que l'écran) ;
//   - sans accord, un commercial n'émet pas au-delà ; le propriétaire, si ; sans le réglage, personne n'est bloqué ;
//   - un accord se demande, se donne ou se refuse par un responsable, jamais le sien ; il couvre un montant ;
//   - la pièce émise porte les deux noms ; le plafond et le réglage ne se changent que par un responsable.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
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
let n = 0;
async function personne(prenom: string) {
  const email = `accords-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, nom: `${prenom} ${n}`, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
const aujourdhui = new Date().toISOString().slice(0, 10);
// Une facture de 12 sacs à 25 (300 HT, 357 TTC, sans timbre), en brouillon.
const facture = (id: string, qty = 12) => ({ id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
  lines: [{ label: 'Ciment gris 50 kg', description: '', qty, unit: 'sac', unitPrice: 25, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] });

// Une entreprise qui demande l'accord : Chantier Ennasr a 1 000 DT d'encours autorisé et déjà 799,680 DT livrés.
async function magasin(accord = true) {
  const proprio = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const commercial = await personne('Karim');
  const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: commercial.email, roles: ['commercial'] })).corps.jeton);
  await appeler('POST', '/invitations/accepter', commercial.jeton, { jeton: invitation });
  const lire = async (jeton = proprio.jeton) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  const societe = (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company');
  const ecrit = await envoyer(proprio.jeton, [
    { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, encoursAccord: accord } },
    { collection: 'clients', cle: 'c1', rang: 9, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana', creditLimit: 1000 } },
    { collection: 'documents', cle: 'bl1', rang: 0, revision: null, contenu: { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: aujourdhui, clientId: 'c1', createdAt: 1,
      lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 40, unit: 'sac', unitPrice: { '~n': '16.8' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] } },
  ]);
  expect(ecrit.statut).toBe(200);
  const client = (await lire()).find((o) => o.collection === 'clients' && o.cle === 'c1')?.contenu ?? null;
  const brouillon = async (jeton: string, doc: Record<string, unknown>) => {
    const avant = (await lire()).find((o) => o.collection === 'documents' && o.cle === doc.id);
    expect((await envoyer(jeton, [{ collection: 'documents', cle: doc.id, rang: 1, revision: avant?.revision ?? null, contenu: doc }])).statut).toBe(200);
  };
  const emettre = async (jeton: string, doc: Record<string, unknown>, net: string) => {
    const avant = (await lire()).find((o) => o.collection === 'documents' && o.cle === doc.id);
    return appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client, revision: avant?.revision ?? null, rang: 1, netAPayer: net });
  };
  // La première facture de l'entreprise (celle qui crée la série de numéros) : par le propriétaire, à un autre client.
  expect((await envoyer(proprio.jeton, [{ collection: 'clients', cle: 'c2', rang: 10, revision: null, contenu: { id: 'c2', name: 'Café El Walima' } }])).statut).toBe(200);
  const c2 = (await lire()).find((o) => o.collection === 'clients' && o.cle === 'c2')?.contenu ?? null;
  const f0 = { ...facture('f0', 1), clientId: 'c2' };
  expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, proprio.jeton, { document: f0, client: c2, revision: null, rang: 0, netAPayer: '29.750' })).statut).toBe(200);
  return { ent, proprio, commercial, lire, envoyer, brouillon, emettre, client };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'accord d\'un responsable au-delà de l\'encours', () => {
  it('sans accord le commercial n\'émet pas au-delà ; refusé, il attend ; accordé pour ce montant, il émet, et la pièce porte les deux noms', async () => {
    const m = await magasin();
    const { ent, proprio, commercial } = m;
    // (Le brouillon s'écrit par le propriétaire : le commercial n'écrit pas encore dans le dossier, brique 99.)
    await m.brouillon(proprio.jeton, facture('f1'));
    const refus = await m.emettre(commercial.jeton, facture('f1'), '357.000');
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif).replace(/\s+/g, ' ')).toBe('Chantier Ennasr dépasserait son encours autorisé de 156,680 DT (799,680 DT déjà dus, 357,000 DT pour cette facture, 1 000,000 DT autorisés) : il faut l\'accord du propriétaire ou d\'un administrateur. Demande-le ; la facture s\'émettra une fois l\'accord donné.');
    expect(refus.corps.bouton).toBe('ventes.accord.demander');
    // La demande : le serveur garde ses propres chiffres, et nomme qui peut accorder.
    const d1 = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: facture('f1') });
    expect(d1).toMatchObject({ statut: 200, corps: { statut: 'en_attente', responsables: [proprio.nom] } });
    // Redemander le même montant ne double pas la demande.
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: facture('f1') })).corps.id).toBe(d1.corps.id);
    // Le commercial ne décide pas (ni la sienne, ni aucune).
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d1.corps.id)}/decider`, commercial.jeton, { decision: 'accorder' })).statut).toBe(403);
    const liste = await appeler('GET', `/entreprises/${ent}/accords`, proprio.jeton);
    expect(liste.corps.peutDecider).toBe(true);
    expect((liste.corps.accords as Record<string, unknown>[]).map((a) => [a.statut, a.montant, a.encours, a.plafond, a.demandeur]))
      .toEqual([['en_attente', 357000, 799680, 1000000, commercial.nom]]);
    expect((await appeler('GET', `/entreprises/${ent}/accords`, commercial.jeton)).corps.peutDecider).toBe(false);
    // Refusée : toujours pas d'émission ; une demande décidée ne se redécide pas.
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d1.corps.id)}/decider`, proprio.jeton, { decision: 'refuser', motif: 'Qu\'il règle d\'abord le bon' })).corps.statut).toBe('refuse');
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d1.corps.id)}/decider`, proprio.jeton, { decision: 'accorder' })).corps.motif)
      .toBe('Cette demande a déjà été décidée : rien n\'a changé.');
    expect((await m.emettre(commercial.jeton, facture('f1'), '357.000')).statut).toBe(403);
    // Redemandée puis accordée : elle s'émet ; mais pas pour un montant plus grand que celui accordé.
    const d2 = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: facture('f1') });
    expect(d2.corps.id).not.toBe(d1.corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d2.corps.id)}/decider`, proprio.jeton, { decision: 'accorder' })).corps.statut).toBe('accorde');
    await m.brouillon(proprio.jeton, facture('f1', 30));
    expect((await m.emettre(commercial.jeton, facture('f1', 30), '892.500')).statut).toBe(403);
    await m.brouillon(proprio.jeton, facture('f1'));
    const ok = await m.emettre(commercial.jeton, facture('f1'), '357.000');
    expect(ok.statut).toBe(200);
    expect((ok.corps.contenu as Record<string, unknown>).accordEncours).toMatchObject({ demandePar: commercial.nom, accordePar: proprio.nom });
    // La base elle-même : une demande décidée ne change plus, même en passant par-dessus les routes.
    await expect(enTantQue(pool, proprio.id, (tx) => tx.query(`update ventes.accord set montant = 1 where id = $1`, [d2.corps.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(enTantQue(pool, proprio.id, (tx) => tx.query(`update ventes.accord set statut = 'en_attente', decide_par = null, decide_le = null where id = $1`, [d2.corps.id])))
      .rejects.toMatchObject({ code: '42501', message: 'Une demande d\'accord déjà décidée ne change plus.' });
    await expect(enTantQue(pool, commercial.id, (tx) => tx.query(`insert into ventes.accord (entreprise, geste, piece_v10, client_v10, montant, encours, plafond, demande_par, statut, decide_par, decide_le)
      values ($1, 'encours', 'f9', 'c1', 1, 0, 1, $2, 'accorde', $3, now())`, [ent, commercial.id, proprio.id]))).rejects.toMatchObject({ code: '42501' });
  });

  it('le propriétaire émet au-delà sans accord ; sans le réglage, le commercial aussi ; seul un responsable règle les seuils', async () => {
    const m = await magasin();
    await m.brouillon(m.proprio.jeton, facture('f2'));
    expect((await m.emettre(m.proprio.jeton, facture('f2'), '357.000')).statut).toBe(200);
    // Un responsable qui demande quand même ne décide pas sa propre demande.
    const sienne = await appeler('POST', `/entreprises/${m.ent}/dossier-v10/accord`, m.proprio.jeton, { document: facture('f5') });
    expect((await appeler('POST', `/entreprises/${m.ent}/accords/${String(sienne.corps.id)}/decider`, m.proprio.jeton, { decision: 'accorder' })).corps.motif)
      .toBe('On ne décide pas sa propre demande : un autre responsable accorde ou refuse.');
    // Le commercial ne lève pas la barrière lui-même : ni le plafond du client, ni le réglage de l'entreprise — pas même
    // en écrivant dans la base par-dessus les routes (la base le refuse elle-même).
    const client = (await m.lire()).find((o) => o.collection === 'clients' && o.cle === 'c1');
    expect((await m.envoyer(m.commercial.jeton, [{ collection: 'clients', cle: 'c1', rang: 9, revision: client?.revision, contenu: { ...client?.contenu, creditLimit: 50000 } }])).statut).toBe(403);
    const ecrire = (qui: string, cle: string, champ: Record<string, unknown>) => enTantQue(pool, qui, (tx) => tx.query(
      `update socle.dossier_v10 set contenu = contenu || $3::jsonb where entreprise = $1 and cle = $2`, [m.ent, cle, JSON.stringify(champ)]));
    await expect(ecrire(m.commercial.id, 'c1', { creditLimit: 50000 })).rejects.toMatchObject({ code: '42501', message: 'L\'encours autorisé d\'un client se règle par le propriétaire ou un administrateur.' });
    await expect(ecrire(m.commercial.id, 'company', { encoursAccord: false })).rejects.toMatchObject({ code: '42501', message: 'L\'accord au-delà de l\'encours se règle par le propriétaire ou un administrateur.' });
    // Le reste de la fiche ne passe pas par ce garde-fou ; le propriétaire, lui, règle les seuils.
    await ecrire(m.commercial.id, 'c1', { phone: '71 000 000' });
    await ecrire(m.proprio.id, 'c1', { creditLimit: 50000 });
    expect((await m.lire()).find((o) => o.collection === 'clients' && o.cle === 'c1')?.contenu).toMatchObject({ phone: '71 000 000', creditLimit: 50000 });
    // Une entreprise qui ne demande pas l'accord : le commercial émet au-delà (l'écran l'a averti).
    const libre = await magasin(false);
    await libre.brouillon(libre.proprio.jeton, facture('f3'));
    expect((await libre.emettre(libre.commercial.jeton, facture('f3'), '357.000')).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${libre.ent}/dossier-v10/accord`, libre.commercial.jeton, { document: facture('f4') })).statut).toBe(403);
  });

  // La remise au-delà d'un seuil (brique 103 ; 03 D11 : « une remise »).
  it('au-delà de la remise permise, le commercial demande l\'accord ; il couvre ce taux, pas plus ; seul un responsable règle le seuil', async () => {
    const m = await magasin(false);
    const { ent, proprio, commercial } = m;
    const ecrire = (qui: string, champ: Record<string, unknown>) => enTantQue(pool, qui, (tx) => tx.query(
      `update socle.dossier_v10 set contenu = contenu || $2::jsonb where entreprise = $1 and collection = '_racine' and cle = 'company'`, [ent, JSON.stringify(champ)]));
    // Le seuil se règle par un responsable, jusque dans la base.
    await expect(ecrire(commercial.id, { remiseAccordAuDela: 50 })).rejects.toMatchObject({ code: '42501', message: 'La remise permise sans accord se règle par le propriétaire ou un administrateur.' });
    await ecrire(proprio.id, { remiseAccordAuDela: 10 });
    // Café El Walima, sans plafond d'encours : 12 sacs à 25, remise de 15 % (300 HT, 45 de remise, 303,450 TTC).
    const c2 = (await m.lire()).find((o) => o.collection === 'clients' && o.cle === 'c2')?.contenu ?? null;
    const remisee = (id: string, taux: number) => ({ ...facture(id), clientId: 'c2', discountRate: taux });
    const emettre = async (jeton: string, doc: Record<string, unknown>, net: string) => {
      const avant = (await m.lire()).find((o) => o.collection === 'documents' && o.cle === doc.id);
      return appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: c2, revision: avant?.revision ?? null, rang: 1, netAPayer: net });
    };
    await m.brouillon(proprio.jeton, remisee('r1', 15));
    const refus = await emettre(commercial.jeton, remisee('r1', 15), '303.450');
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif).replace(/\s+/g, ' ')).toBe('Café El Walima : la remise de 15 % dépasse les 10 % permis sans accord : il faut l\'accord du propriétaire ou d\'un administrateur. Demande-le ; la facture s\'émettra une fois l\'accord donné.');
    expect(refus.corps.bouton).toBe('ventes.accord.demander');
    // La demande porte sur la remise, avec les chiffres du serveur ; redemander ne la double pas.
    const d = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: remisee('r1', 15) });
    expect(d.corps).toMatchObject({ statut: 'en_attente', geste: 'remise' });
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: remisee('r1', 15) })).corps.id).toBe(d.corps.id);
    const liste = (await appeler('GET', `/entreprises/${ent}/accords`, proprio.jeton)).corps.accords as Record<string, unknown>[];
    expect(liste.map((a) => [a.geste, a.taux, a.seuil, a.montant, a.plafond])).toEqual([['remise', 1500, 1000, 45000, null]]);
    expect((await appeler('POST', `/entreprises/${ent}/accords/${String(d.corps.id)}/decider`, proprio.jeton, { decision: 'accorder' })).corps.statut).toBe('accorde');
    // Accordé pour 15 % : pas pour 20 %.
    await m.brouillon(proprio.jeton, remisee('r1', 20));
    expect((await emettre(commercial.jeton, remisee('r1', 20), '285.600')).statut).toBe(403);
    await m.brouillon(proprio.jeton, remisee('r1', 15));
    const ok = await emettre(commercial.jeton, remisee('r1', 15), '303.450');
    expect(ok.statut).toBe(200);
    expect((ok.corps.contenu as Record<string, unknown>).accordRemise).toMatchObject({ demandePar: commercial.nom, accordePar: proprio.nom, taux: 15 });
    // Le propriétaire remise au-delà sans accord.
    await m.brouillon(proprio.jeton, remisee('r4', 30));
    expect((await emettre(proprio.jeton, remisee('r4', 30), '249.900')).statut).toBe(200);
    // Au seuil même, pas d'accord à demander ; et la base ne laisse pas réécrire le taux d'une demande.
    await m.brouillon(proprio.jeton, remisee('r2', 10));
    expect((await emettre(commercial.jeton, remisee('r2', 10), '321.300')).statut).toBe(200);
    // Un prix de ligne baissé sous celui du client est une remise aussi (brique 104) : 20 au lieu de 25, c'est 20 %.
    expect((await m.envoyer(proprio.jeton, [{ collection: 'catalog', cle: 'ciment', rang: 0, revision: null,
      contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 25, vatRate: 19 } }])).statut).toBe(200);
    const baissee = (id: string) => ({ ...facture(id), clientId: 'c2', lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 12, unit: 'sac', unitPrice: 20, vatRate: 19, itemId: 'ciment' }] });
    await m.brouillon(proprio.jeton, baissee('r5'));
    const sous = await emettre(commercial.jeton, baissee('r5'), '285.600');
    expect(String(sous.corps.motif).replace(/\s+/g, ' ')).toBe('Café El Walima : « Ciment gris 50 kg » est vendu 20 % sous son prix, au-delà des 10 % permis sans accord : il faut l\'accord du propriétaire ou d\'un administrateur. Demande-le ; la facture s\'émettra une fois l\'accord donné.');
    // Mais le prix de sa liste (21) est la référence du client : 20, c'est 4,76 % sous elle, permis sans accord.
    expect((await m.envoyer(proprio.jeton, [{ collection: 'priceLists', cle: 'lp1', rang: 0, revision: null,
      contenu: { id: 'lp1', nom: 'Cafés', clientIds: ['c2'], lignes: [{ itemId: 'ciment', prix: 21 }] } }])).statut).toBe(200);
    expect((await emettre(commercial.jeton, baissee('r5'), '285.600')).statut).toBe(200);
    const d3 = await appeler('POST', `/entreprises/${ent}/dossier-v10/accord`, commercial.jeton, { document: remisee('r3', 25) });
    await expect(enTantQue(pool, proprio.id, (tx) => tx.query(`update ventes.accord set taux = 1600 where id = $1`, [d3.corps.id])))
      .rejects.toMatchObject({ code: '42501', message: 'Une demande d\'accord ne se réécrit pas : on en fait une autre.' });
  });
});
