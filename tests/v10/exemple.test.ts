// L'exemple de la v10, versé par le serveur dans l'entreprise d'essai (retour de Skander, 05/10/2026 ; docs/exemple.md ;
// serveur/v10/exemple.ts). Skander, sur un compte neuf : « il me dit tu es déjà dans l'exemple mais il n'y a rien
// dessus ». Ce que le serveur garantit :
//   - versé, l'exemple est le jeu de la v10 entier (clients, devis, factures, avoirs, achats, paie…), et l'entreprise
//     d'essai se dit exemple (la marque de la v10, que lisent le bandeau et la découverte) ;
//   - ses factures et ses avoirs sont émis PAR LE SERVEUR : numérotés sans trou dans chaque année et chaque série, au
//     millime de la v10 (deux chemins, un chiffre), chaînés ; leurs règlements tenus comme ceux d'une vraie facture ;
//   - ses achats et ses bulletins suivent comme ceux qu'on enregistre à l'écran ;
//   - il ne se verse qu'une fois ; jamais dans une vraie entreprise, ni dans une entreprise d'essai qui a ses propres
//     pièces, ni dans celle d'un autre — et un refus n'écrit rien.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const pool = creerPool(inject('pgApp'));
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; contenu: Record<string, unknown> };

// Le moteur de la v10 que servent les écrans : le second chemin des montants.
const v10 = (() => {
  const charger = (f: string, exiger: (n: string) => unknown) => {
    const module = { exports: {} as unknown };
    (vm.runInThisContext(`(function (module, exports, require) {${fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10', f), 'utf8')}\n})`, { filename: f }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, exiger);
    return module.exports;
  };
  const compta = charger('compta.js', () => ({}));
  return charger('core.js', (n) => (n.includes('compta') ? compta : {})) as { computeTotals: (d: unknown, c: unknown) => { netToPay: number } };
})();
const decoder = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(decoder);
  if (v && typeof v === 'object') {
    const cles = Object.keys(v);
    if (cles.length === 1 && cles[0] === '~n') return Number((v as Record<string, string>)['~n']);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]));
  }
  return v;
};

// Une personne inscrite, avec son code de téléphone en place, et son entreprise d'essai (trois clients d'exemple).
async function personne(nom: string) {
  const email = `exemple-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const essai = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const dossier = async (ent: string) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  return { jeton, essai, dossier };
}
const compter = async (table: string, ent: string) => Number((await admin.query(`select count(*)::int n from ${table} where entreprise = $1`, [ent])).rows[0].n);

beforeAll(async () => {
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
  await admin.connect();
});
afterAll(async () => { await app.close(); await pool.end(); await admin.end(); });

describe('l\'exemple de la v10, versé par le serveur dans l\'entreprise d\'essai', () => {
  it('l\'entreprise d\'essai reçoit le jeu entier, ses factures émises par le serveur au millime de la v10, une seule fois', async () => {
    const s = await personne('Skander');
    const r = await appeler('POST', `/entreprises/${s.essai}/exemple`, s.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps.deja).toBe(false);
    const objets = await s.dossier(s.essai);
    const partie = (c: string) => objets.filter((o) => o.collection === c);
    // Le jeu entier : les trois clients de l'entreprise d'essai restent, ceux de l'exemple s'y ajoutent.
    expect(objets.find((o) => o.collection === '_racine' && o.cle === 'demo')?.contenu).toBe(true);
    expect(partie('clients').length).toBeGreaterThan(30);
    for (const [c, min] of [['documents', 400], ['purchases', 150], ['payslips', 50], ['suppliers', 5], ['employees', 2], ['catalog', 10], ['movements', 100]] as const) {
      expect(partie(c).length, c).toBeGreaterThanOrEqual(min);
    }
    // Les factures et les avoirs émis le sont par le serveur : chacun a sa pièce scellée, sous le numéro du dossier.
    const docs = partie('documents').map((o) => decoder(o.contenu) as Record<string, unknown> & { id: string; type: string; status: string; number: string });
    const emis = docs.filter((x) => (x.type === 'facture' || x.type === 'avoir') && x.status !== 'brouillon');
    expect(emis.length).toBeGreaterThan(250);
    const pieces = (await admin.query(`select ref_v10, numero_texte, statut, type, net_a_payer::text net, extract(year from date_piece)::int an, serie, numero::int numero
      from ventes.piece where entreprise = $1`, [s.essai])).rows as { ref_v10: string; numero_texte: string; statut: string; type: string; net: string; an: number; serie: string; numero: number }[];
    expect(pieces.length).toBe(emis.length);
    expect(pieces.every((p) => p.statut === 'emise')).toBe(true);
    const parRef = new Map(pieces.map((p) => [p.ref_v10, p]));
    // Deux chemins, un chiffre : le net à payer du serveur est celui que la v10 calcule de la pièce du dossier.
    const societe = decoder(objets.find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu);
    const ecarts = emis.filter((x) => {
      const p = parRef.get(x.id);
      const s1000 = String(Math.round(v10.computeTotals(x, societe).netToPay * (x.currency && x.currency !== 'DT' ? 100 : 1000)));
      return !p || p.numero_texte !== x.number || p.net !== s1000;
    }).map((x) => `${x.number} ${parRef.get(x.id)?.numero_texte} ${parRef.get(x.id)?.net}`);
    expect(ecarts).toEqual([]);
    // Numérotés sans trou, dans chaque série et chaque année.
    const groupes = new Map<string, number[]>();
    for (const p of pieces) groupes.set(`${p.serie}/${p.an}`, [...(groupes.get(`${p.serie}/${p.an}`) ?? []), p.numero]);
    for (const [g, n] of groupes) expect([...n].sort((a, b) => a - b), g).toEqual(n.map((_, i) => i + 1));
    // Les règlements des factures sont tenus par le serveur : autant que dans le dossier.
    const paiements = emis.reduce((n, x) => n + (Array.isArray(x.payments) ? x.payments.length : 0), 0);
    expect(paiements).toBeGreaterThan(200);
    expect(await compter('ventes.reglement', s.essai)).toBe(paiements);
    // Les achats et les bulletins suivent comme ceux de l'écran.
    expect(await compter('achats.piece', s.essai)).toBe(partie('purchases').length);
    expect(await compter('paie.bulletin', s.essai)).toBeGreaterThan(0);

    // Une seconde fois : rien de neuf.
    const encore = await appeler('POST', `/entreprises/${s.essai}/exemple`, s.jeton);
    expect(encore.statut).toBe(200);
    expect(encore.corps.deja).toBe(true);
    expect(await compter('ventes.piece', s.essai)).toBe(pieces.length);
    expect((await s.dossier(s.essai)).length).toBe(objets.length);
  }, 300_000);

  it('jamais dans une vraie entreprise, ni dans une entreprise d\'essai qui a ses propres pièces, ni chez un autre ; un refus n\'écrit rien', async () => {
    const s = await personne('Nadia');
    // Une vraie entreprise.
    const vraie = String((await appeler('POST', '/entreprises', s.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    const avant = (await s.dossier(vraie)).length;
    const refus = await appeler('POST', `/entreprises/${vraie}/exemple`, s.jeton);
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toBe('L\'exemple ne se verse que dans ton entreprise d\'essai : jamais une pièce inventée dans une vraie entreprise. Rien n\'a été fait.');
    expect((await s.dossier(vraie)).length).toBe(avant);
    expect(await compter('ventes.piece', vraie)).toBe(0);

    // L'entreprise d'essai où Nadia a déjà fait un devis à elle.
    const objets = await s.dossier(s.essai);
    const client = objets.find((o) => o.collection === 'clients')?.cle ?? '';
    expect((await appeler('POST', `/entreprises/${s.essai}/dossier-v10`, s.jeton, { changements: [{ collection: 'documents', cle: 'devis-nadia', rang: 0, revision: null, contenu: {
      id: 'devis-nadia', type: 'devis', number: 'DEV-2026-001', status: 'brouillon', date: '2026-10-01', clientId: client, currency: 'DT', discountRate: 0,
      lines: [{ label: 'Gâteau d\'anniversaire', qty: 1, unitPrice: { '~n': '45.5' }, vatRate: 19 }] } }] })).statut).toBe(200);
    const refus2 = await appeler('POST', `/entreprises/${s.essai}/exemple`, s.jeton);
    expect(refus2.statut).toBe(403);
    expect(String(refus2.corps.motif)).toMatch(/^Ton entreprise d'essai a déjà tes propres pièces : l'exemple ne s'y ajoute pas/);
    const apres = await s.dossier(s.essai);
    expect(apres.length).toBe(objets.length + 1);
    expect(apres.some((o) => o.collection === '_racine' && o.cle === 'demo')).toBe(false);
    expect(await compter('ventes.piece', s.essai)).toBe(0);

    // L'entreprise d'essai d'un autre : elle ne la voit pas.
    const autre = await personne('Sami');
    const refus3 = await appeler('POST', `/entreprises/${autre.essai}/exemple`, s.jeton);
    expect([403, 404]).toContain(refus3.statut);
    expect((await autre.dossier(autre.essai)).some((o) => o.collection === '_racine' && o.cle === 'demo')).toBe(false);
  }, 120_000);
});
