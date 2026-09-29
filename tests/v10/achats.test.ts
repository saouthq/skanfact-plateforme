// Les achats du dossier v10, tenus par le serveur (0013, brique 30 ; docs/achats.md). Ce que le
// serveur garantit, quel que soit ce que l'interface lui envoie :
//   - chaque achat se calcule au serveur au même millime que l'écran de la v10 (deux chemins, un
//     chiffre) : ses montants, ce qu'il doit encore, son statut, la retenue née de chaque règlement ;
//   - un achat se modifie et se supprime comme dans la v10, chaque geste avec sa trace, et seul ce
//     qui a vraiment changé se recalcule ;
//   - un avoir ou un acompte se rattache à une facture de sa devise, et la facture ne se supprime
//     pas tant qu'il y est rattaché ;
//   - un seul achat illisible, et rien de l'envoi n'est écrit ;
//   - la base refuse elle-même ce qui mélangerait deux entreprises.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { achatAuHasard, type AchatDonne } from '../moteur/v10-achats.ts';
import { demo, entier, exiger, hasard, type Societe } from '../moteur/v10.ts';

type Achat10 = AchatDonne & { payments?: { id: string; date?: string; amount: number | string }[] };
type Donnees = { company: Societe; suppliers: { id: string; name: string }[]; purchases: Achat10[] };
type Totaux10 = { totalHT: number; totalVAT: number; deductibleVAT: number; fees: number; totalTTC: number; withholding: number; netToPay: number; base: { totalHT: number; deductibleVAT: number; netToPay: number } };
const core = exiger('../../banc/v10/core.js') as {
  purchaseTotals: (p: Achat10, c: Societe) => Totaux10;
  purchaseBalance: (p: Achat10, c: Societe, d?: Donnees) => { remaining: number };
  purchaseStatus: (p: Achat10, c: Societe, jour: string, d?: Donnees) => string;
  retenueDesReglements: (p: Achat10, c: Societe, d?: Donnees) => { parts: Record<string, number> };
  DEFAULT_COMPANY: Societe;
};
const STATUTS: Record<string, string> = {
  'payée': 'payee', partiel: 'partiel', retard: 'en_retard', 'à payer': 'a_payer', 'imputé': 'impute', 'remboursé': 'rembourse', 'à imputer': 'a_imputer',
};

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
// Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
function encoder(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isInteger(v)) return { '~n': String(v) };
  if (Array.isArray(v)) return v.map(encoder);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)]));
  return v;
}
let n = 0;
async function essai() {
  const email = `achats-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Achats ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);   // le dossier naît au premier chargement
  const revisions = new Map<string, number>();
  // Envoie des objets du dossier (null : le retirer), avec la révision que l'interface en connaît.
  const envoyer = async (collection: string, objets: [string, unknown][], rang = 0) => {
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, {
      changements: objets.map(([cle, contenu], i) => ({ collection, cle, rang: contenu === null ? null : rang + i, revision: revisions.get(`${collection}/${cle}`) ?? null, contenu: contenu === null ? null : encoder(contenu) })),
    });
    if (r.statut === 200) {
      for (const [i, x] of (r.corps.revisions as { revision: number | null }[]).entries()) {
        const k = `${collection}/${objets[i]?.[0]}`;
        if (x.revision === null) revisions.delete(k); else revisions.set(k, x.revision);
      }
    }
    return r;
  };
  const idDe = async (ref: string) => String((await admin.query('select id from achats.piece where entreprise = $1 and ref_v10 = $2', [ent, ref])).rows[0]?.id ?? '');
  const lire = async (ref: string) => (await appeler('GET', `/entreprises/${ent}/achats/${await idDe(ref)}`, jeton)).corps;
  const trace = async () => (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'achats.%' order by instant, id`, [ent])).rows.map((x) => String(x.geste));
  return { jeton, ent, envoyer, idDe, lire, trace };
}
const fournisseur = (id: string, name = 'Bureau Plus SARL') => ({ id, name, matricule: '1234567/A/M/000', address: 'Rue de Marseille, Tunis', phone: '71 000 000', email: '', rib: '', notes: '' });
// Une facture fournisseur telle que l'éditeur de la v10 l'écrit.
const facture = (id: string, supplierId: string, x: Partial<Achat10> = {}): Achat10 => ({
  id, kind: 'facture', supplierId, number: `FA-${id}`, date: '2026-09-01', dueDate: '2026-10-01', subject: 'Fournitures', category: '', notes: '', fees: 1, achatLie: '',
  withholdingRate: 1.5, tvaRecuperable: true, currency: '',
  lines: [{ label: 'Ramettes de papier', qty: 40, unitPrice: 12.345, vatRate: 19, destination: 'charge', deductible: true }], payments: [], ...x,
} as Achat10);

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  declarerGestesAchats();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les achats du dossier v10, tenus par le serveur', () => {
  it('les 181 achats de l\'exemple de cinq ans se calculent au serveur au millime de l\'écran : montants, reste, statut, retenue de chaque règlement', async () => {
    const e = await essai();
    const d = demo.buildDemoData({ ...core.DEFAULT_COMPANY }, '2026-09-28') as unknown as Donnees;
    expect((await e.envoyer('suppliers', d.suppliers.map((s) => [s.id, s]))).statut).toBe(200);
    const envoi = await e.envoyer('purchases', d.purchases.map((p) => [p.id, p]));
    expect(envoi.statut, JSON.stringify(envoi.corps)).toBe(200);
    const jour = aujourdhuiATunis();
    const faux: string[] = [];
    let reglements = 0, retenues = 0;
    for (const p of d.purchases) {
      const v = core.purchaseTotals(p, d.company);
      const dec = p.currency && p.currency !== 'DT' ? 2 : 3;
      const s = (await admin.query('select total_ht, total_tva, tva_deductible, frais, total_ttc, retenue, net_a_payer from achats.piece where entreprise = $1 and ref_v10 = $2', [e.ent, p.id])).rows[0];
      const egal = (nom: string, ancien: number, nouveau: unknown, dc = dec) => { if (entier(ancien, dc) !== nouveau) faux.push(`${p.id} ${nom} : écran ${ancien}, serveur ${String(nouveau)}`); };
      egal('HT', v.totalHT, s.total_ht); egal('TVA', v.totalVAT, s.total_tva); egal('TVA déductible', v.deductibleVAT, s.tva_deductible);
      egal('frais', v.fees, s.frais); egal('TTC', v.totalTTC, s.total_ttc); egal('retenue', v.withholding, s.retenue); egal('net', v.netToPay, s.net_a_payer);
      const lu = await e.lire(p.id);
      const suivi = lu.suivi as { reste: string; statut: string; reglements: { id: string; retenue: string }[] };
      const texte = (x: number, dc: number) => (entier(x, dc) ?? 0n);
      if (texte(core.purchaseBalance(p, d.company, d).remaining, dec) !== entier(suivi.reste, dec)) faux.push(`${p.id} reste : écran ${core.purchaseBalance(p, d.company, d).remaining}, serveur ${suivi.reste}`);
      if (STATUTS[core.purchaseStatus(p, d.company, jour, d)] !== suivi.statut) faux.push(`${p.id} statut : écran ${core.purchaseStatus(p, d.company, jour, d)}, serveur ${suivi.statut}`);
      const enDinars = lu.enDinars as { netAPayer: string; totalHT: string; tvaDeductible: string };
      egal('net (dinars)', v.base.netToPay, entier(enDinars.netAPayer, 3), 3); egal('HT (dinars)', v.base.totalHT, entier(enDinars.totalHT, 3), 3);
      egal('TVA déductible (dinars)', v.base.deductibleVAT, entier(enDinars.tvaDeductible, 3), 3);
      // La retenue née de chaque règlement, telle que l'écran l'annonce avant d'enregistrer.
      const parts = core.retenueDesReglements(p, d.company, d).parts;
      for (const r of suivi.reglements) {
        const ref = String((await admin.query('select ref_v10 from achats.reglement where id = $1', [r.id])).rows[0].ref_v10);
        reglements++;
        if (Number(r.retenue) !== 0) retenues++;
        if (texte(parts[ref] ?? 0, dec) !== entier(r.retenue, dec)) faux.push(`${p.id}/${ref} retenue : écran ${parts[ref]}, serveur ${r.retenue}`);
      }
    }
    expect(faux).toEqual([]);
    // Le banc a mesuré quelque chose : tous les règlements, dont des retenues.
    expect(reglements).toBe(d.purchases.reduce((s, p) => s + (p.payments ?? []).length, 0));
    expect(retenues).toBeGreaterThan(5);
    // Chaque achat a laissé sa trace, une seule fois ; chaque fournisseur a sa fiche.
    expect((await e.trace()).filter((g) => g === 'achats.piece.enregistrer')).toHaveLength(d.purchases.length);
    expect((await admin.query(`select count(*)::int n from socle.tiers where entreprise = $1 and 'fournisseur' = any(roles)`, [e.ent])).rows[0].n).toBe(d.suppliers.length);
  });

  it('200 achats tirés au hasard (devises, TVA non déductible, destinations, frais, retenue) : les mêmes montants qu\'à l\'écran', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    const h = hasard(20260929);
    const achats = Array.from({ length: 200 }, (_, i) => {
      const p = achatAuHasard(h);
      // Comme l'éditeur de la v10 : une pièce en devise porte son taux de change.
      return { ...p, id: `h${i}`, number: `H-${i}`, date: '2026-09-15', supplierId: 's1', ...(p.currency !== 'DT' && !(Number(p.exchangeRate) > 0) ? { exchangeRate: 3.35 } : {}) } as Achat10;
    });
    const envoi = await e.envoyer('purchases', achats.map((p) => [p.id, p]));
    expect(envoi.statut, JSON.stringify(envoi.corps)).toBe(200);
    const serveur = new Map((await admin.query('select ref_v10, total_ht, total_tva, tva_deductible, total_ttc, retenue, net_a_payer from achats.piece where entreprise = $1', [e.ent])).rows.map((r) => [r.ref_v10, r]));
    const faux: string[] = [];
    for (const p of achats) {
      const v = core.purchaseTotals(p, core.DEFAULT_COMPANY);
      const s = serveur.get(p.id);
      const dec = p.currency && p.currency !== 'DT' ? 2 : 3;
      const paires: [string, number, unknown][] = [['HT', v.totalHT, s?.total_ht], ['TVA', v.totalVAT, s?.total_tva], ['TVA déductible', v.deductibleVAT, s?.tva_deductible], ['TTC', v.totalTTC, s?.total_ttc], ['retenue', v.withholding, s?.retenue], ['net', v.netToPay, s?.net_a_payer]];
      for (const [nom, a, b] of paires) if (entier(a, dec) !== b) faux.push(`${p.id} ${nom} : écran ${a}, serveur ${String(b)}`);
    }
    expect(faux).toEqual([]);
    expect(achats.filter((p) => p.currency !== 'DT').length).toBeGreaterThan(30);
  });

  it('un achat se modifie et se supprime comme dans la v10, chaque geste avec sa trace ; une pièce qui n\'a fait que changer de place ne se recalcule pas', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    // 40 × 12,345 = 493,800 ; TVA 19 % : 93,822 ; frais 1 : TTC 588,622 ; retenue 1,5 % de 587,622 : 8,814.
    expect((await e.envoyer('purchases', [['a1', facture('a1', 's1')]])).statut).toBe(200);
    expect((await e.lire('a1')).totaux).toEqual({ totalHT: '493.800', totalTVA: '93.822', tvaDeductible: '93.822', frais: '1.000', totalTTC: '588.622', retenue: '8.814', netAPayer: '579.808' });
    expect((await e.lire('a1')).fournisseur).toMatchObject({ raisonSociale: 'Bureau Plus SARL' });
    // Une deuxième pièce ajoutée AVANT : la première revient dans l'envoi à une autre place, inchangée.
    expect((await e.envoyer('purchases', [['a2', facture('a2', 's1')], ['a1', facture('a1', 's1')]])).statut).toBe(200);
    expect(await e.trace()).toEqual(['achats.piece.enregistrer', 'achats.piece.enregistrer']);
    // Modifiée : une ligne de plus, un règlement ; puis le règlement retiré.
    const modifiee = facture('a1', 's1', { lines: [...facture('a1', 's1').lines ?? [], { label: 'Toner', qty: 2, unitPrice: 85, vatRate: 19, destination: 'stock', deductible: false }] });
    expect((await e.envoyer('purchases', [['a1', { ...modifiee, payments: [{ id: 'r1', date: '2026-09-10', amount: 300 }] }]], 1)).statut).toBe(200);
    // 170,000 de plus au HT, 32,300 de TVA non déductible : net 579,808 + 202,300 − 3,035 (retenue de plus) = 779,073.
    expect(await e.lire('a1')).toMatchObject({ totaux: { totalHT: '663.800', tvaDeductible: '93.822', netAPayer: '779.073' }, suivi: { paye: '300.000', reste: '479.073', statut: 'partiel' } });
    expect((await admin.query('select destination, non_deductible, ttc from achats.ligne where piece = $1 order by rang', [await e.idDe('a1')])).rows)
      .toEqual([{ destination: 'charge', non_deductible: false, ttc: 587622n }, { destination: 'stock', non_deductible: true, ttc: 202300n }]);
    expect((await e.envoyer('purchases', [['a1', modifiee]], 1)).statut).toBe(200);
    // Supprimée : ses règlements, ses lignes et elle-même quittent le serveur.
    expect((await e.envoyer('purchases', [['a1', null]])).statut).toBe(200);
    expect((await admin.query('select count(*)::int n from achats.piece where entreprise = $1', [e.ent])).rows[0].n).toBe(1);
    expect(await e.trace()).toEqual(['achats.piece.enregistrer', 'achats.piece.enregistrer', 'achats.piece.modifier', 'achats.reglement.enregistrer',
      'achats.piece.modifier', 'achats.reglement.supprimer', 'achats.piece.supprimer']);
  });

  it('un avoir et un acompte rattachés se déduisent de leur facture ; elle ne se supprime pas tant qu\'ils y sont ; une autre devise est refusée', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    const avoir = facture('av1', 's1', { kind: 'avoir', number: 'AV-1', date: '2026-09-05', dueDate: '', fees: 0, achatLie: 'f1', lines: [{ label: 'Ramettes abîmées', qty: 4, unitPrice: 12.345, vatRate: 19, destination: 'charge', deductible: true }] });
    const acompte = facture('ac1', 's1', { kind: 'acompte', number: 'AC-1', date: '2026-08-20', fees: 0, withholdingRate: 0, achatLie: 'f1', lines: [{ label: 'Acompte', qty: 1, unitPrice: 100, vatRate: 0, destination: 'charge', deductible: true }], payments: [{ id: 'ra', date: '2026-08-20', amount: 100 }] });
    // La facture et ses pièces rattachées arrivent dans le même envoi, les rattachées d'abord.
    expect((await e.envoyer('purchases', [['av1', avoir], ['ac1', acompte], ['f1', facture('f1', 's1')]])).statut).toBe(200);
    // L'avoir : 4 × 12,345 = 49,380 + 9,382 de TVA = 58,762, moins 0,881 de retenue : 57,881.
    // Reste : 579,808 − 57,881 − 100,000 = 421,927.
    expect((await e.lire('f1')).suivi).toMatchObject({ impute: '157.881', reste: '421.927', statut: 'partiel', rattachees: [{ nature: 'acompte', impute: '100.000' }, { nature: 'avoir', impute: '57.881' }] });
    expect(await e.lire('av1')).toMatchObject({ rattacheA: { numero: 'FA-f1' }, suivi: { reste: '0.000', statut: 'impute' } });
    // La facture ne se supprime pas : son avoir y est rattaché. Rien n'est supprimé.
    expect((await e.envoyer('purchases', [['f1', null]])).corps.motif)
      .toBe('Un avoir ou un acompte est rattaché à cet achat : détache-le (ou supprime-le) d\'abord, puis supprime l\'achat. Rien n\'a été supprimé.');
    expect(await e.idDe('f1')).not.toBe('');
    // Un avoir en euros sur une facture en dinars : refusé.
    expect((await e.envoyer('purchases', [['av1', { ...avoir, currency: 'EUR', exchangeRate: 3.35 }]])).corps.motif)
      .toBe('L\'achat AV-1 se rattache à une pièce en TND : un avoir ou un acompte se rattache à une pièce de SA devise. Rien n\'a été enregistré.');
    // Détachés puis supprimés avec elle, dans le même envoi : tout part.
    expect((await e.envoyer('purchases', [['av1', { ...avoir, achatLie: '' }], ['ac1', null], ['f1', null]])).statut).toBe(200);
    expect(await e.lire('av1')).toMatchObject({ rattacheA: null, suivi: { reste: '-57.881', statut: 'a_imputer' } });
  });

  it('sans choix sur la pièce, récupérer la TVA suit le régime de l\'entreprise ce jour-là, et la pièce le garde', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    const regime = async (taxRegime: string) => {
      const societe = ((await appeler('GET', `/entreprises/${e.ent}/dossier-v10`, e.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown>; revision: number }[])
        .find((o) => o.collection === '_racine' && o.cle === 'company');
      const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, taxRegime } }] });
      expect(r.statut).toBe(200);
    };
    const sansChoix = (id: string) => { const f = facture(id, 's1'); delete f.tvaRecuperable; return f; };
    // Une entreprise au forfait ne récupère pas la TVA de ses achats : elle entre dans le coût.
    await regime('forfaitaire');
    await e.envoyer('purchases', [['f1', sansChoix('f1')]]);
    expect(await e.lire('f1')).toMatchObject({ tvaRecuperable: false, totaux: { totalTVA: '93.822', tvaDeductible: '0.000' } });
    // Passée au réel, ses nouveaux achats la récupèrent ; l'ancien garde ce qui l'a calculé.
    await regime('reel');
    await e.envoyer('purchases', [['f2', sansChoix('f2')]], 1);
    expect(await e.lire('f2')).toMatchObject({ tvaRecuperable: true, totaux: { tvaDeductible: '93.822' } });
    expect(await e.lire('f1')).toMatchObject({ tvaRecuperable: false, totaux: { tvaDeductible: '0.000' } });
  });

  it('un seul achat illisible, et rien de l\'envoi n\'est écrit', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    const refus = async (p: Achat10) => {
      const r = await e.envoyer('purchases', [['ok', facture('ok', 's1')], [p.id, p]]);
      expect(r.statut).toBe(403);
      return r.corps.motif;
    };
    expect(await refus(facture('x', 's1', { currency: 'EUR' }))).toBe('L\'achat FA-x est en EUR : indique son taux de change (combien vaut 1 EUR en dinars). Rien n\'a été enregistré.');
    expect(await refus(facture('x', 's1', { currency: 'EUR', exchangeRate: 3.35, fees: 1.255 }))).toBe('Les frais de l\'achat FA-x en EUR se comptent à 2 décimales au plus : rien n\'a été enregistré.');
    expect(await refus(facture('x', 's1', { lines: [{ label: 'Vis', qty: 1.2345, unitPrice: 1, vatRate: 19 }] }))).toMatch(/^La ligne 1 de l'achat FA-x/);
    expect(await refus(facture('x', 's1', { date: '2026-02-30' }))).toBe('L\'achat FA-x n\'a pas de date valable : rien n\'a été enregistré.');
    expect(await refus(facture('x', 's9'))).toBe('Le fournisseur de l\'achat FA-x n\'existe plus : choisis-en un autre. Rien n\'a été enregistré.');
    expect(await refus(facture('x', 's1', { currency: 'EUR', exchangeRate: 3.35, payments: [{ id: 'r1', date: '2026-09-10', amount: 10.005 }] })))
      .toBe('Un paiement en EUR se compte à 2 décimales au plus (10.005) : rien n\'a été enregistré.');
    expect(await refus(facture('x', 's1', { payments: [{ id: 'r1', date: '2026-09-10', amount: 0 }] }))).toBe('Un règlement de l\'achat FA-x n\'a pas de montant : rien n\'a été enregistré.');
    expect((await admin.query('select count(*)::int n from achats.piece where entreprise = $1', [e.ent])).rows[0].n).toBe(0);
    expect((await admin.query(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'purchases'`, [e.ent])).rows[0].n).toBe(0);
  });

  it('la liste des achats, page après page, dit le même reste que la lecture de chacun ; un commercial ne la voit pas', async () => {
    const e = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    const achats = Array.from({ length: 5 }, (_, i) => facture(`l${i}`, 's1', { date: `2026-09-0${1 + (i % 2)}`, payments: i % 2 ? [{ id: `r${i}`, date: '2026-09-10', amount: 100 * i }] : [] }));
    await e.envoyer('purchases', achats.map((p) => [p.id, p]));
    const vus: Record<string, unknown>[] = [];
    let suite: string | null = null;
    do {
      const r = await appeler('GET', `/entreprises/${e.ent}/achats?limite=2${suite ? `&avant=${suite}` : ''}`, e.jeton);
      vus.push(...(r.corps.lignes as Record<string, unknown>[]));
      expect(r.corps.total).toBe(5);
      suite = r.corps.suite as string | null;
    } while (suite);
    expect(vus.map((l) => l.numero).sort()).toEqual(achats.map((p) => p.number).sort());
    expect(vus.map((l) => l.date)).toEqual([...vus.map((l) => String(l.date))].sort().reverse());
    for (const l of vus) expect(l.reste).toBe(((await appeler('GET', `/entreprises/${e.ent}/achats/${String(l.id)}`, e.jeton)).corps.suivi as { reste: string }).reste);
    expect(vus.find((l) => l.numero === 'FA-l1')).toMatchObject({ reste: '479.808', statut: 'partiel', fournisseur: 'Bureau Plus SARL' });
    // Un commercial : les achats ne sont pas son module (03 § 2.1).
    const email = `commercial-achats-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Commercial', motDePasse: 'Un-bon-mot-de-passe' });
    const jc = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await appeler('POST', `/entreprises/${e.ent}/invitations`, e.jeton, { email, roles: ['commercial'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', jc, { jeton: invitation });
    expect((await appeler('GET', `/entreprises/${e.ent}/achats`, jc)).statut).toBe(403);
  });

  it('la base refuse elle-même un fournisseur ou une facture d\'une autre entreprise, et un rattachement à un avoir', async () => {
    const e = await essai();
    const autre = await essai();
    await e.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    await autre.envoyer('suppliers', [['s1', fournisseur('s1')]]);
    await e.envoyer('purchases', [['f1', facture('f1', 's1')], ['av1', facture('av1', 's1', { kind: 'avoir' })]]);
    await autre.envoyer('purchases', [['f1', facture('f1', 's1')]]);
    const chez = async (x: typeof e) => (await admin.query('select id from achats.piece where entreprise = $1 and ref_v10 = $2', [x.ent, 'f1'])).rows[0].id;
    const tiersAutre = (await admin.query('select id from socle.tiers where entreprise = $1 and ref_v10 = $2', [autre.ent, 's1'])).rows[0].id;
    await expect(admin.query('update achats.piece set fournisseur = $1 where id = $2', [tiersAutre, await chez(e)])).rejects.toThrow(/le fournisseur appartient à l'entreprise de l'achat/);
    await expect(admin.query('update achats.piece set lie = $1 where entreprise = $2 and ref_v10 = $3', [await chez(autre), e.ent, 'av1'])).rejects.toThrow(/se rattache à une facture ou une dépense de son entreprise/);
    await expect(admin.query('update achats.piece set lie = $1 where entreprise = $2 and ref_v10 = $3', [await e.idDe('av1'), e.ent, 'f1'])).rejects.toThrow(/piece_check|se rattache/);
    // Un règlement ne passe pas d'un achat à un autre.
    const proprietaire = (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur;
    const r = (await admin.query(`insert into achats.reglement (entreprise, piece, rang, date_reglement, montant, mode, cree_par) values ($1, $2, 0, '2026-09-10', 1000, 'virement', $3) returning id`, [e.ent, await chez(e), proprietaire])).rows[0].id;
    await expect(admin.query('update achats.reglement set piece = $1 where id = $2', [await e.idDe('av1'), r])).rejects.toThrow(/un règlement ne change pas de pièce/);
  });
});
