// 1.324.0 (le groupe jusqu'au comptable ; serveur/groupe.ts). Hédi tient trois sociétés à Sfax : la Huilerie Ben Salah
// presse l'huile et la vend à sa sœur, la Distribution Ben Salah, qui la revend aux épiceries ; le Transport Ben Salah
// livre la Huilerie. Additionner leurs livres comptait deux fois l'huile vendue de l'une à l'autre, et ce que la
// Distribution doit à la Huilerie était à la fois « à encaisser » et « à payer » du groupe :
//   - chaque société garde les chiffres de ses livres ; ce qu'elle vend et doit à ses sœurs se dit à part, et se retire du
//     total : le chiffre d'affaires du groupe est celui des clients du dehors (1 655,000 + 3 562,500) ;
//   - une sœur se reconnaît à son matricule (sept chiffres et la lettre-clé : la Distribution a noté la Huilerie sous son
//     établissement 001, sans barres), ou, sans matricule, à son nom (« TRANSPORT BEN SALAH ») ; un client du dehors, non ;
//   - les deux livres d'une même dette se comparent : la Huilerie dit 7 762,181, la Distribution 5 310,239 ; l'écart
//     (2 451,942) s'explique par une facture absente des achats de la Distribution (2 449,631) et une autre notée avec un
//     prix mal recopié (2,311) ; le Transport n'a pas facturé ce que la Huilerie a noté comme acheté chez lui ;
//   - le comptable lit la même chose dans l'onglet Inventaire d'un dossier.
// Les montants sont calculés à la main, sur des prix qui discriminent un arrondi (152,625 × 15 à 7 % : 160,256).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { routesGroupe } from '../../serveur/groupe.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `groupe-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

type Ligne = { label: string; qty: number; pu: string; tva: number };
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;
const MH = matricule(), MD = matricule();

// Les fournisseurs et les achats d'un dossier, écrits comme l'écran les écrit.
async function noterAchats(jeton: string, ent: string, fournisseurs: Obj[], achats: Obj[]) {
  const r = await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
    ...fournisseurs.map((s, i) => ({ collection: 'suppliers', cle: s.id, rang: i, revision: null, contenu: s })),
    ...achats.map((x, i) => ({ collection: 'purchases', cle: x.id, rang: i, revision: null, contenu: x }))] });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
}
const achat = (id: string, supplierId: string, number: string, label: string, qty: number, pu: string, vatRate: number) => ({
  id, kind: 'facture', date: aujourdhui, dueDate: aujourdhui, number, supplierId, category: 'Marchandises', payments: [],
  lines: [{ label, qty, unitPrice: { '~n': pu }, vatRate, destination: 'charge' }],
});

async function vendre(jeton: string, ent: string, id: string, client: Record<string, string>, lignes: Ligne[], netAPayer: string): Promise<string> {
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);
  const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client.id, createdAt: 1,
    lines: lignes.map((l) => ({ label: l.label, qty: l.qty, unit: 'u', unitPrice: { '~n': l.pu }, vatRate: l.tva })), discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client, revision: null, rang: 0, netAPayer });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return String(r.corps.numero);
}

beforeAll(async () => {
  app = await creerApp(ctx, [...routesSocle(ctx), ...routesGroupe(ctx), ...routesVentes(ctx), ...routesCompta(ctx), ...routesV10(ctx)]);
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('le groupe jusqu\'au comptable (1.324.0)', () => {
  it('ce que les sociétés se vendent et se doivent se dit à part et sort du total ; les deux livres d\'une dette se comparent, pièce par pièce', async () => {
    const hedi = await personne('Hedi');
    const h = String((await appeler('POST', '/entreprises', hedi.jeton, { raisonSociale: 'Huilerie Ben Salah', matriculeFiscal: MH })).corps.id);
    // Le code du téléphone, que son rôle de propriétaire exige avant une deuxième société.
    await appeler('POST', '/moi/code', hedi.jeton, { methode: 'application' });
    const d = String((await appeler('POST', '/entreprises', hedi.jeton, { raisonSociale: 'Distribution Ben Salah', matriculeFiscal: MD })).corps.id);
    const t = String((await appeler('POST', '/entreprises', hedi.jeton, { raisonSociale: 'Transport Ben Salah' })).corps.id);
    await appeler('POST', '/entreprises-essai', hedi.jeton);

    // La Huilerie vend à sa sœur (deux factures) et à une épicerie du dehors.
    const distribution = { id: 'c-dist', name: 'Distribution Ben Salah', address: 'Route de Tunis, Sfax', matricule: MD };
    const ennour = { id: 'c-ennour', name: 'Épicerie Ennour', address: 'Rue de Marseille, Sfax', matricule: matricule() };
    const hf1 = await vendre(hedi.jeton, h, 'hf1', distribution, [{ label: 'Huile d\'olive extra vierge, bidon 5 L', qty: 120, pu: '41.375', tva: 7 }], '5312.550');
    const hf2 = await vendre(hedi.jeton, h, 'hf2', distribution, [{ label: 'Huile d\'olive vierge, bidon 20 L', qty: 15, pu: '152.625', tva: 7 }], '2449.631');
    await vendre(hedi.jeton, h, 'hf3', ennour, [{ label: 'Huile d\'olive extra vierge, bidon 5 L', qty: 40, pu: '41.375', tva: 7 }], '1770.850');
    // La Distribution revend au dehors, et n'a noté que la première facture de la Huilerie, avec un prix mal recopié.
    await vendre(hedi.jeton, d, 'df1', { id: 'c-lafayette', name: 'Supérette Lafayette', address: 'Avenue Habib Bourguiba, Tunis', matricule: matricule() },
      [{ label: 'Huile d\'olive extra vierge, bouteille 1 L', qty: 300, pu: '11.875', tva: 7 }], '3811.875');
    await noterAchats(hedi.jeton, d, [{ id: 's-huilerie', name: 'Huilerie Ben Salah', matricule: `${MH.slice(0, 8)}AM001` }],
      [achat('pa1', 's-huilerie', hf1, 'Huile d\'olive extra vierge, bidon 5 L', 120, '41.357', 7)]);
    // La Huilerie a noté la livraison du Transport (sans matricule sur la fiche) ; le Transport ne l'a pas facturée.
    await noterAchats(hedi.jeton, h, [{ id: 's-transport', name: 'TRANSPORT BEN SALAH' }],
      [achat('pa2', 's-transport', 'TR-118', 'Transport de l\'huile Sfax → Tunis, 2 rotations', 1, '350', 19)]);

    const r = await appeler('GET', '/moi/groupe', hedi.jeton);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const societes = r.corps.societes as Obj[];
    expect(societes.map((s) => s.raisonSociale)).toEqual(['Distribution Ben Salah', 'Huilerie Ben Salah', 'Transport Ben Salah']);
    const [sd, sh, st] = societes;
    // Chaque société garde les chiffres de ses livres ; la part de ses sœurs se dit à côté.
    expect(sh?.chiffres).toEqual({ caMois: '8909.375', caExercice: '8909.375', aEncaisser: '9533.031', aPayer: '416.500', tresorerie: '0.000' });
    expect(sh?.entreSocietes).toEqual({ caMois: '7254.375', caExercice: '7254.375', aEncaisser: '7762.181', aPayer: '416.500', tresorerie: '0.000' });
    expect(sd?.chiffres).toEqual({ caMois: '3562.500', caExercice: '3562.500', aEncaisser: '3811.875', aPayer: '5310.239', tresorerie: '0.000' });
    expect(sd?.entreSocietes).toEqual({ caMois: '0.000', caExercice: '0.000', aEncaisser: '0.000', aPayer: '5310.239', tresorerie: '0.000' });
    expect(st?.chiffres).toEqual({ caMois: '0.000', caExercice: '0.000', aEncaisser: '0.000', aPayer: '0.000', tresorerie: '0.000' });
    expect(st?.entreSocietes).toBeUndefined();
    // Le total des livres, ce qui reste entre les sociétés, et le groupe sans compter deux fois : ce que vendent les clients
    // du dehors (1 655,000 + 3 562,500), ce qu'ils doivent (1 770,850 + 3 811,875), et rien à payer au dehors.
    expect(r.corps.totaux).toEqual([{ devise: 'TND',
      chiffres: { caMois: '12471.875', caExercice: '12471.875', aEncaisser: '13344.906', aPayer: '5726.739', tresorerie: '0.000' },
      entreSocietes: { caMois: '7254.375', caExercice: '7254.375', aEncaisser: '7762.181', aPayer: '5726.739', tresorerie: '0.000' },
      groupe: { caMois: '5217.500', caExercice: '5217.500', aEncaisser: '5582.725', aPayer: '0.000', tresorerie: '0.000' } }]);
    expect(r.corps.ventes).toEqual([{ de: h, vers: d, deNom: 'Huilerie Ben Salah', versNom: 'Distribution Ben Salah', caExercice: '7254.375' }]);
    // Les deux livres d'une même dette.
    const paireHD = { creancier: h, debiteur: d, devise: 'TND', creancierNom: 'Huilerie Ben Salah', debiteurNom: 'Distribution Ben Salah',
      selonCreancier: '7762.181', selonDebiteur: '5310.239', ecart: '2451.942', reste: '0.000', autres: 0, pieces: [
        { numero: hf1, date: aujourdhui, type: 'facture', vendeur: h, acheteur: d, chezVendeur: '5312.550', chezAcheteur: '5310.239', manque: null },
        { numero: hf2, date: aujourdhui, type: 'facture', vendeur: h, acheteur: d, chezVendeur: '2449.631', chezAcheteur: null, manque: 'achats' }].sort((x, y) => x.numero.localeCompare(y.numero)) };
    const paireTH = { creancier: t, debiteur: h, devise: 'TND', creancierNom: 'Transport Ben Salah', debiteurNom: 'Huilerie Ben Salah',
      selonCreancier: '0.000', selonDebiteur: '416.500', ecart: '-416.500', reste: '0.000', autres: 0, pieces: [
        { numero: 'TR-118', date: aujourdhui, type: 'facture', vendeur: t, acheteur: h, chezVendeur: null, chezAcheteur: '416.500', manque: 'ventes' }] };
    expect(r.corps.paires).toEqual([paireHD, paireTH]);

    // Deux chemins, un chiffre : le groupe sans compter deux fois est la somme des ventes aux clients du dehors, lues pièce par pièce.
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    const dehors = (await admin.query(`select coalesce(sum(p.net_ht), 0)::text ht from ventes.piece p join socle.tiers x on x.id = p.tiers
       where p.entreprise = any($1::uuid[]) and p.statut = 'emise' and p.type = 'facture' and x.raison_sociale not like '%Ben Salah'`, [[h, d, t]])).rows[0];
    expect((Number(dehors?.ht) / 1000).toFixed(3)).toBe('5217.500');
    await admin.end();

    // Le comptable lit la même chose dans l'onglet Inventaire : le dossier de la Distribution, puis celui de la Huilerie.
    const an = aujourdhui.slice(0, 4);
    const invD = await appeler('GET', `/entreprises/${d}/compta/inventaires/${an}`, hedi.jeton);
    expect(invD.statut, JSON.stringify(invD.corps)).toBe(200);
    expect(invD.corps.groupe).toEqual({ jour: aujourdhui, societes: [{ id: h, raisonSociale: 'Huilerie Ben Salah' }],
      ventes: [{ de: h, vers: d, deNom: 'Huilerie Ben Salah', versNom: 'Distribution Ben Salah', caExercice: '7254.375' }], paires: [paireHD] });
    const invH = await appeler('GET', `/entreprises/${h}/compta/inventaires/${an}`, hedi.jeton);
    expect((invH.corps.groupe as Obj).societes.map((s: Obj) => s.raisonSociale)).toEqual(['Distribution Ben Salah', 'Transport Ben Salah']);
    expect((invH.corps.groupe as Obj).paires).toEqual([paireHD, paireTH]);
    // Une société sans sœur : rien.
    const invT = await appeler('GET', `/entreprises/${t}/compta/inventaires/${an}`, hedi.jeton);
    expect((invT.corps.groupe as Obj).paires).toEqual([paireTH]);
  }, 120_000);
});
