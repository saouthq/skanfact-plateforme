// Les livres tenus par le serveur (brique 32 ; docs/ecritures.md), par le vrai chemin : l'écran de la
// v10 émet, encaisse, émet un avoir ; le serveur réécrit la famille à chaque geste, jamais en double ;
// le plan qui change réécrit le brouillard ; l'API lit le journal, la balance et le grand livre ; les
// droits de 03 § 2.1 ; et la base qui refuse elle-même une écriture fausse ou la retouche d'une
// écriture validée.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue, requetes } from '../../serveur/base.ts';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
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
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
async function essai() {
  const moi = await personne('livres');
  const ent = String((await appeler('POST', '/entreprises-essai', moi.jeton)).corps.id);
  await appeler('POST', '/moi/code', moi.jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, moi.jeton)).corps.objets as Objet[];
  await lire();   // le dossier naît au premier chargement
  // Envoie un objet du dossier avec la révision que le serveur en a (l'émission en change une).
  const envoyer = async (collection: string, cle: string, contenu: unknown, rang: number | null = 0) => {
    const revision = (await lire()).find((o) => o.collection === collection && o.cle === cle)?.revision ?? null;
    return appeler('POST', `/entreprises/${ent}/dossier-v10`, moi.jeton, { changements: [{ collection, cle, rang: contenu === null ? null : rang, revision, contenu }] });
  };
  const inviter = async (role: string) => {
    const p = await personne(role);
    const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, moi.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: invitation });
    await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    return p;
  };
  // Les écritures de l'entreprise, en clair : « journal date compte débit crédit » par ligne.
  const ecritures = async () => (await admin.query(`select e.origine_type, e.journal, e.date_ecriture::text date,
      string_agg(l.compte || ' ' || l.debit || ' ' || l.credit, ' | ' order by l.rang) lignes
    from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1
    group by e.id order by e.date_ecriture, e.rang`, [ent])).rows as { origine_type: string; journal: string; date: string; lignes: string }[];
  return { ...moi, ent, lire, envoyer, inviter, ecritures };
}
const clientDe = async (e: Awaited<ReturnType<typeof essai>>) => {
  const c = (await e.lire()).find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
  if (!c) throw new Error('client d\'exemple absent');
  return c;
};
// 2 × 450,500 à 19 % et le timbre ; retenue 1,5 % de 1 072,190 (hors timbre) = 16,083.
const facture = (id: string, clientId: string) => ({
  id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId, subject: 'Mobilier', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: true, withholdingRate: { '~n': '1.5' }, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
});
const avoir = (id: string, clientId: string, creditOf: string) => ({
  id, type: 'avoir', number: '', date: '2026-10-10', clientId, creditOf, creditReason: 'Une table rendue', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  declarerGestesCompta();
  declarerGestesAchats();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les livres tenus par le serveur', () => {
  it('chaque geste de l\'écran réécrit la famille, jamais en double : l\'émission, un encaissement, sa modification, un compte de banque, un avoir, le retrait', async () => {
    const e = await essai();
    const c = await clientDe(e);
    // L'émission : l'écriture de la facture, au journal des ventes (calculée à la main).
    await e.envoyer('documents', 'f1', facture('f1', c.cle));
    const emise = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: facture('f1', c.cle), client: c.contenu, revision: 1, rang: 0, netAPayer: '1057.107' });
    expect(emise.statut, JSON.stringify(emise.corps)).toBe(200);
    const VENTE = { origine_type: 'vente', journal: 'VT', date: '2026-10-01', lignes: '411 1073190 0 | 706 0 901000 | 4367 0 171190 | 4368 0 1000' };
    expect(await e.ecritures()).toEqual([VENTE]);
    // Un encaissement de 500,000 en espèces (l'entreprise n'a pas encore de compte de trésorerie :
    // la caisse). Sa part de retenue : 16,083 × 500 / 1 057,107 = 7,607 ; le client est soldé de
    // 507,607, et la retenue subie naît ici.
    const contenu = emise.corps.contenu as Record<string, unknown>;
    const payer = (montant: number | { '~n': string }, mode = 'especes') => e.envoyer('documents', 'f1', { ...contenu, payments: [{ id: 'p1', date: '2026-10-05', amount: montant, method: mode }] });
    expect((await payer(500)).statut).toBe(200);
    expect(await e.ecritures()).toEqual([VENTE, { origine_type: 'encaissement', journal: 'CA', date: '2026-10-05', lignes: '54 500000 0 | 411 0 507607 | 4358 7607 0' }]);
    // Un compte bancaire par défaut arrive : le plan change, l'encaissement passe au journal de banque.
    expect((await e.envoyer('accounts', 'b1', { id: 'b1', name: 'BIAT', kind: 'banque', isDefault: true })).statut).toBe(200);
    expect((await e.ecritures())[1]).toEqual({ origine_type: 'encaissement', journal: 'BQ', date: '2026-10-05', lignes: '532 500000 0 | 411 0 507607 | 4358 7607 0' });
    // Modifié à 600,000 : la même écriture, réécrite (16,083 × 600 / 1 057,107 = 9,128), une seule.
    expect((await payer(600)).statut).toBe(200);
    expect(await e.ecritures()).toEqual([VENTE, { origine_type: 'encaissement', journal: 'BQ', date: '2026-10-05', lignes: '532 600000 0 | 411 0 609128 | 4358 9128 0' }]);
    // L'avoir d'une table (450,500 + 85,595 = 536,095), après l'encaissement : il crédite le client et
    // reprend les ventes et la TVA ; la famille garde ses trois écritures, équilibrées.
    const a = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre-avoir`, e.jeton, { document: avoir('a1', c.cle, 'f1'), client: c.contenu, revision: null, rang: 1, netAPayer: '536.095' });
    expect(a.statut, JSON.stringify(a.corps)).toBe(200);
    const apresAvoir = await e.ecritures();
    expect(apresAvoir.map((x) => `${x.journal} ${x.date}`)).toEqual(['VT 2026-10-01', 'BQ 2026-10-05', 'VT 2026-10-10']);
    // L'avoir vient après un encaissement : il régularise la retenue que le client a déjà gardée, à sa
    // date. Ce montant, la lecture de la facture le dit par un autre chemin (serveur/ventes/reglements.ts).
    const piece = String((await admin.query(`select id from ventes.piece where entreprise = $1 and ref_v10 = 'f1'`, [e.ent])).rows[0].id);
    const suivi = (await appeler('GET', `/entreprises/${e.ent}/ventes/${piece}`, e.jeton)).corps.suivi as { avoirs: { regularisation: string }[] };
    const regul = BigInt((suivi.avoirs[0]?.regularisation ?? '0').replace('.', ''));
    expect(regul).not.toBe(0n);
    const [r1, r2] = regul > 0n ? [`4358 ${regul} 0`, `411 0 ${regul}`] : [`4358 0 ${-regul}`, `411 ${-regul} 0`];
    expect(apresAvoir[2]?.lignes).toBe(`411 0 536095 | ${r1} | ${r2} | 706 450500 0 | 4367 85595 0`);
    // Le règlement retiré : son écriture part avec lui.
    expect((await e.envoyer('documents', 'f1', { ...contenu, payments: [] })).statut).toBe(200);
    expect((await e.ecritures()).map((x) => x.journal)).toEqual(['VT', 'VT']);
    // Aucune écriture déséquilibrée, aucune en double.
    const origines = (await admin.query(`select origine, count(*)::int n from compta.ecriture where entreprise = $1 group by origine`, [e.ent])).rows;
    expect(origines.every((o) => o.n === 1)).toBe(true);
  });

  it('les achats : chaque enregistrement réécrit la famille (la facture, son acompte, son avoir, leurs règlements), jamais en double', async () => {
    const e = await essai();
    expect((await e.envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' })).statut).toBe(200);
    // 1 000,000 HT à 19 %, 1,000 de frais (le timbre du fournisseur), retenue 1,5 % de 1 190,000 = 17,850.
    const ligne = (prix: number, label = 'Papier') => ({ label, qty: 1, unitPrice: prix, vatRate: 19, destination: 'charge', deductible: true });
    const achat = (id: string, x: Record<string, unknown>) => ({
      id, supplierId: 's1', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0, tvaRecuperable: true, payments: [], ...x,
    });
    const facture = achat('a1', { kind: 'facture', number: 'FF-1', date: '2026-10-02', lines: [ligne(1000)], fees: 1, withholdingRate: { '~n': '1.5' } });
    expect((await e.envoyer('purchases', 'a1', facture)).statut).toBe(200);
    const ACHAT = { origine_type: 'achat', journal: 'AC', date: '2026-10-02', lignes: '606 1000000 0 | 608 1000 0 | 4366 190000 0 | 401 0 1191000' };
    expect(await e.ecritures()).toEqual([ACHAT]);
    // Un règlement de 600,000 en espèces : sa part de retenue, 17,850 × 600 / 1 173,150 = 9,129 ; le
    // fournisseur est débité de 609,129 et la retenue opérée naît ici.
    const paye = { ...facture, payments: [{ id: 'r1', date: '2026-10-05', amount: 600, method: 'especes' }] };
    expect((await e.envoyer('purchases', 'a1', paye)).statut).toBe(200);
    expect(await e.ecritures()).toEqual([ACHAT, { origine_type: 'reglement_fournisseur', journal: 'CA', date: '2026-10-05', lignes: '401 609129 0 | 54 0 600000 | 4352 0 9129' }]);
    // Un acompte de 238,000 (200,000 HT et sa TVA), versé par virement le 28/09, rattaché à la facture :
    // il pose une avance au 409, la facture l'impute à sa date (OD), et il couvre dès l'origine : la
    // part du règlement devient 17,850 × 600 / 935,150 = 11,453. La même écriture, réécrite.
    const acompte = achat('ac1', { kind: 'acompte', number: 'AC-1', date: '2026-09-28', lines: [ligne(200, 'Acompte')], achatLie: 'a1',
      payments: [{ id: 'r2', date: '2026-09-28', amount: 238, method: 'virement' }] });
    expect((await e.envoyer('purchases', 'ac1', acompte, 1)).statut).toBe(200);
    const AVANT_AVOIR = [
      { origine_type: 'achat', journal: 'AC', date: '2026-09-28', lignes: '409 200000 0 | 4366 38000 0 | 401 0 238000' },
      { origine_type: 'reglement_fournisseur', journal: 'BQ', date: '2026-09-28', lignes: '401 238000 0 | 532 0 238000' },
      ACHAT,
      { origine_type: 'imputation', journal: 'OD', date: '2026-10-02', lignes: '401 238000 0 | 409 0 200000 | 4366 0 38000' },
      { origine_type: 'reglement_fournisseur', journal: 'CA', date: '2026-10-05', lignes: '401 611453 0 | 54 0 600000 | 4352 0 11453' },
    ];
    expect(await e.ecritures()).toEqual(AVANT_AVOIR);
    // Un avoir de 119,000 (100,000 HT et sa TVA) le 10/10, APRÈS le règlement : il reprend la charge et
    // la TVA, et régularise à sa date la retenue déjà opérée : 16,065 × 600 / 817,935 = 11,785, moins
    // les 11,453 déjà nés, 0,332.
    const avoir = achat('av1', { kind: 'avoir', number: 'AV-1', date: '2026-10-10', lines: [ligne(100, 'Retour')], achatLie: 'a1', withholdingRate: { '~n': '1.5' } });
    expect((await e.envoyer('purchases', 'av1', avoir, 2)).statut).toBe(200);
    const AVOIR = { origine_type: 'achat', journal: 'AC', date: '2026-10-10', lignes: '606 0 100000 | 4366 0 19000 | 401 119000 0 | 4352 0 332 | 401 332 0' };
    expect(await e.ecritures()).toEqual([...AVANT_AVOIR, AVOIR]);
    // Deux chemins, un chiffre : la lecture de la facture (serveur/achats/etat.ts) dit la même part et
    // la même régularisation.
    const piece = String((await admin.query(`select id from achats.piece where entreprise = $1 and ref_v10 = 'a1'`, [e.ent])).rows[0].id);
    const suivi = (await appeler('GET', `/entreprises/${e.ent}/achats/${piece}`, e.jeton)).corps.suivi as { reglements: { retenue: string }[]; rattachees: { regularisation: string }[] };
    expect(suivi.reglements.map((r) => r.retenue)).toEqual(['11.453']);
    expect(suivi.rattachees.map((r) => r.regularisation).sort()).toEqual(['0.000', '0.332']);
    // Détaché, l'avoir devient sa propre famille : plus de régularisation, et la facture n'en porte plus rien.
    expect((await e.envoyer('purchases', 'av1', { ...avoir, achatLie: '' }, 2)).statut).toBe(200);
    expect(await e.ecritures()).toEqual([...AVANT_AVOIR, { ...AVOIR, lignes: '606 0 100000 | 4366 0 19000 | 401 119000 0' }]);
    // Le fournisseur renommé : le libellé de ses écritures suit.
    expect((await e.envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie de la Marsa' })).statut).toBe(200);
    const libelles = (await admin.query(`select libelle from compta.ecriture where entreprise = $1 and origine_type = 'achat'`, [e.ent])).rows.map((r) => String(r.libelle));
    expect(libelles.length).toBe(3);
    expect(libelles.every((l) => l.includes('Papeterie de la Marsa'))).toBe(true);
    // Retiré, l'avoir emporte son écriture ; aucune écriture en double.
    expect((await e.envoyer('purchases', 'av1', null)).statut).toBe(200);
    expect(await e.ecritures()).toEqual(AVANT_AVOIR);
    // (l'acompte a deux écritures : la sienne, et son imputation sur la facture)
    const origines = (await admin.query(`select origine_type, origine, count(*)::int n from compta.ecriture where entreprise = $1 group by origine_type, origine`, [e.ent])).rows;
    expect(origines.every((o) => o.n === 1)).toBe(true);
    // Les comptes auxiliaires : 401 + le code du fournisseur, partout.
    expect((await e.envoyer('_racine', 'auxiliaires', true, null)).statut).toBe(200);
    const comptes = (await admin.query(`select distinct l.compte from compta.ligne l join compta.ecriture e on e.id = l.ecriture
      where e.entreprise = $1 and e.origine_type <> 'vente' and e.origine_type <> 'encaissement' and l.compte like '401%'`, [e.ent])).rows.map((r) => r.compte);
    expect(comptes).toEqual(['401001']);
    // Une écriture validée (brique 35) : la famille ne se réécrit plus, l'enregistrement est refusé
    // et rien n'est écrit.
    await admin.query(`update compta.ecriture set statut = 'validee', numero = 'AC-000001' where entreprise = $1 and origine_type = 'achat' and date_ecriture = '2026-10-02'`, [e.ent]);
    const refuse = await e.envoyer('purchases', 'a1', { ...paye, number: 'FF-1 bis' });
    expect(refuse.statut, JSON.stringify(refuse.corps)).toBe(403);
    expect(String(refuse.corps.motif)).toContain('contre-passation');
    expect((await admin.query(`select numero_fournisseur from achats.piece where entreprise = $1 and ref_v10 = 'a1'`, [e.ent])).rows[0].numero_fournisseur).toBe('FF-1');
  });

  it('le plan de l\'entreprise : ses propres comptes et ses comptes auxiliaires réécrivent tout le brouillard', async () => {
    const e = await essai();
    const c = await clientDe(e);
    await e.envoyer('documents', 'f1', facture('f1', c.cle));
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: facture('f1', c.cle), client: c.contenu, revision: 1, rang: 0, netAPayer: '1057.107' })).statut).toBe(200);
    // Des marchandises plutôt que des services : 707.
    expect((await e.envoyer('_racine', 'chartAccounts', { ventes: '707' }, null)).statut).toBe(200);
    expect((await e.ecritures())[0]?.lignes).toBe('411 1073190 0 | 707 0 901000 | 4367 0 171190 | 4368 0 1000');
    // Les comptes auxiliaires : 411 + le code du client.
    expect((await e.envoyer('clients', c.cle, { ...c.contenu, compteAux: '007' }, c.rang)).statut).toBe(200);
    expect((await e.envoyer('_racine', 'auxiliaires', true, null)).statut).toBe(200);
    expect((await e.ecritures())[0]?.lignes).toBe('411007 1073190 0 | 707 0 901000 | 4367 0 171190 | 4368 0 1000');
  });

  it('l\'API lit le journal page après page, la balance équilibrée et le grand livre avec ses soldes', async () => {
    const e = await essai();
    const c = await clientDe(e);
    await e.envoyer('documents', 'f1', facture('f1', c.cle));
    const emise = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: facture('f1', c.cle), client: c.contenu, revision: 1, rang: 0, netAPayer: '1057.107' });
    await e.envoyer('documents', 'f1', { ...(emise.corps.contenu as Record<string, unknown>), payments: [{ id: 'p1', date: '2026-10-05', amount: 500, method: 'especes' }] });
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre-avoir`, e.jeton, { document: avoir('a1', c.cle, 'f1'), client: c.contenu, revision: null, rang: 1, netAPayer: '536.095' });
    // Le journal, une écriture par page : chacune vue une fois, dans l'ordre des dates.
    const vues: { date: string; journal: string; lignes: { compte: string; debit: string; credit: string }[] }[] = [];
    let suite: string | null = null;
    do {
      const r = await appeler('GET', `/entreprises/${e.ent}/compta/ecritures?limite=1${suite ? `&apres=${suite}` : ''}`, e.jeton);
      expect(r.statut).toBe(200);
      vues.push(...(r.corps.ecritures as typeof vues));
      suite = r.corps.suite as string | null;
    } while (suite);
    expect(vues.map((x) => `${x.journal} ${x.date}`)).toEqual(['VT 2026-10-01', 'CA 2026-10-05', 'VT 2026-10-10']);
    expect(vues[0]?.lignes[0]).toEqual({ compte: '411', libelle: 'Facture FAC-2026-001 — Menuiserie du Lac (exemple)', debit: '1073.190', credit: '0.000', tauxTva: null });
    // La balance : ses totaux sont égaux, et chaque compte dit la somme de ses lignes.
    const b = (await appeler('GET', `/entreprises/${e.ent}/compta/balance`, e.jeton)).corps as { comptes: { compte: string; debit: string; credit: string; solde: string }[]; totaux: { debit: string; credit: string } };
    expect(b.totaux.debit).toBe(b.totaux.credit);
    const somme = async (compte: string) => (await admin.query(`select (sum(debit) - sum(credit))::text s from compta.ligne where entreprise = $1 and compte = $2`, [e.ent, compte])).rows[0].s;
    for (const x of b.comptes) expect(String(BigInt(x.solde.replace('.', '')))).toBe(await somme(x.compte));
    // Le client : 1 073,190 − 507,607 (l'encaissement et sa retenue) − 536,095 (l'avoir) = 29,488,
    // moins la régularisation de retenue que l'avoir porte ; celle-ci, la lecture de la facture la
    // dit par un autre chemin (serveur/ventes/reglements.ts).
    const piece = String((await admin.query(`select id from ventes.piece where entreprise = $1 and ref_v10 = 'f1'`, [e.ent])).rows[0].id);
    const suivi = (await appeler('GET', `/entreprises/${e.ent}/ventes/${piece}`, e.jeton)).corps.suivi as { avoirs: { regularisation: string }[] };
    const regularisation = BigInt((suivi.avoirs[0]?.regularisation ?? '0').replace('.', ''));
    const client = b.comptes.find((x) => x.compte === '411');
    expect(BigInt((client?.solde ?? '').replace('.', ''))).toBe(29_488n - regularisation);
    // Le grand livre du 411 : le solde après chaque ligne ; depuis le 5 octobre, le solde d'avant.
    const gl = (await appeler('GET', `/entreprises/${e.ent}/compta/grand-livre?compte=411`, e.jeton)).corps as { soldeAvant: string; lignes: { debit: string; credit: string; solde: string }[] };
    expect(gl.soldeAvant).toBe('0.000');
    expect(gl.lignes[0]).toMatchObject({ debit: '1073.190', solde: '1073.190' });
    expect(gl.lignes.at(-1)?.solde).toBe(client?.solde);
    const depuis = (await appeler('GET', `/entreprises/${e.ent}/compta/grand-livre?compte=411&du=2026-10-05`, e.jeton)).corps as { soldeAvant: string; lignes: { solde: string }[] };
    expect(depuis.soldeAvant).toBe('1073.190');
    expect(depuis.lignes.at(-1)?.solde).toBe(client?.solde);
    // Le grand livre page après page garde le fil de son solde.
    const pages: { solde: string }[] = [];
    let s2: string | null = null;
    do {
      const r = (await appeler('GET', `/entreprises/${e.ent}/compta/grand-livre?compte=411&limite=1${s2 ? `&apres=${s2}` : ''}`, e.jeton)).corps as { lignes: { solde: string }[]; suite: string | null };
      pages.push(...r.lignes); s2 = r.suite;
    } while (s2);
    expect(pages.map((x) => x.solde)).toEqual(gl.lignes.map((x) => x.solde));
    expect((await appeler('GET', `/entreprises/${e.ent}/compta/balance?du=2026-10-10&au=2026-10-01`, e.jeton)).statut).toBe(400);
    expect((await appeler('GET', `/entreprises/${e.ent}/compta/grand-livre?compte=41x!`, e.jeton)).statut).toBe(400);
  });

  it('les livres : la comptabilité interne et la lecture les lisent, le commercial non, même dans la base ; son émission s\'écrit quand même', async () => {
    const e = await essai();
    const compta = await e.inviter('comptabilite_interne');
    const lecture = await e.inviter('lecture');
    const commercial = await e.inviter('commercial');
    // Le commercial émet une facture par l'API : son écriture s'écrit, sans qu'il lise les livres.
    const tiers = String((await admin.query(`select id from socle.tiers where entreprise = $1 order by raison_sociale limit 1`, [e.ent])).rows[0].id);
    const b = await appeler('POST', `/entreprises/${e.ent}/ventes`, commercial.jeton, {
      type: 'facture', tiers, datePiece: '2026-10-02', lignes: [{ designation: 'Chaise', quantite: '4', prixUnitaire: '100', tauxTva: '19' }],
    });
    expect(b.statut, JSON.stringify(b.corps)).toBe(201);
    expect((await appeler('POST', `/entreprises/${e.ent}/ventes/${String(b.corps.id)}/emettre`, commercial.jeton, {})).statut).toBe(200);
    expect((await e.ecritures()).length).toBe(1);
    expect((await appeler('GET', `/entreprises/${e.ent}/compta/balance`, commercial.jeton)).statut).toBe(403);
    expect((await appeler('GET', `/entreprises/${e.ent}/compta/balance`, compta.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${e.ent}/compta/ecritures`, lecture.jeton)).statut).toBe(200);
    const voit = (u: string) => enTantQue(pool, u, async (tx) => (await requetes(tx).selectFrom('compta.ligne').select('id').execute()).length);
    expect(await voit(commercial.utilisateur)).toBe(0);
    expect(await voit(compta.utilisateur)).toBe(4);
    // Et le commercial n'écrit pas dans les livres en direct : la table ne lui est pas ouverte.
    await expect(enTantQue(pool, commercial.utilisateur, (tx) => tx.query(`delete from compta.ecriture where entreprise = $1`, [e.ent]))).rejects.toThrow(/permission|droit/i);
  });

  it('la base refuse elle-même une écriture déséquilibrée, une ligne à zéro ou des deux côtés, et toute retouche d\'une écriture validée', async () => {
    const e = await essai();
    const c = await clientDe(e);
    await e.envoyer('documents', 'f1', facture('f1', c.cle));
    const emise = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: facture('f1', c.cle), client: c.contenu, revision: 1, rang: 0, netAPayer: '1057.107' });
    const ecriture = String((await admin.query(`select id from compta.ecriture where entreprise = $1`, [e.ent])).rows[0].id);
    const tx = async (sqls: [string, unknown[]][]) => {
      await admin.query('begin');
      try { for (const [q, v] of sqls) await admin.query(q, v); await admin.query('commit'); } catch (err) { await admin.query('rollback'); throw err; }
    };
    const nouvelle = `insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, libelle) values ('00000000-0000-7000-8000-000000000001', $1, 'OD', '2026-10-01', 'vente', $2, $2, 'Essai')`;
    const ligne = (rang: number, d: number, c2: number) => [`insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit) values ('00000000-0000-7000-8000-000000000001', $1, ${rang}, '471', 'Essai', ${d}, ${c2})`, [e.ent]] as [string, unknown[]];
    await expect(tx([[nouvelle, [e.ent, ecriture]], ligne(1, 100, 0), ligne(2, 0, 90)])).rejects.toThrow(/une écriture est équilibrée/);
    await expect(tx([[nouvelle, [e.ent, ecriture]], ligne(1, 100, 0)])).rejects.toThrow(/au moins deux lignes/);
    await expect(tx([[nouvelle, [e.ent, ecriture]], ligne(1, 100, 100), ligne(2, 0, 0)])).rejects.toThrow(/ligne_check/);
    await expect(tx([[nouvelle, [e.ent, ecriture]], ligne(1, 0, 0), ligne(2, 0, 0)])).rejects.toThrow(/ligne_check/);
    // Une ligne d'une autre entreprise sous cette écriture.
    const autre = await essai();
    await expect(admin.query(`insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit) values ($1, $2, 9, '471', 'Essai', 1)`, [ecriture, autre.ent])).rejects.toThrow(/une ligne appartient à l'entreprise de son écriture/);
    // Validée (comme la brique 35 le fera), elle ne bouge plus : ni elle, ni ses lignes ; et sa
    // famille ne se réécrit plus (elle se corrigera par une contre-passation).
    await admin.query(`update compta.ecriture set statut = 'validee', numero = 'VT-2026-0001' where id = $1`, [ecriture]);
    await expect(admin.query(`delete from compta.ecriture where id = $1`, [ecriture])).rejects.toThrow(/une écriture validée ne se modifie pas/);
    await expect(admin.query(`update compta.ecriture set libelle = 'autre' where id = $1`, [ecriture])).rejects.toThrow(/une écriture validée ne se modifie pas/);
    await expect(admin.query(`update compta.ligne set debit = debit + 1 where ecriture = $1 and rang = 1`, [ecriture])).rejects.toThrow(/une écriture validée ne se modifie pas/);
    await expect(admin.query(`delete from compta.ligne where ecriture = $1`, [ecriture])).rejects.toThrow(/une écriture validée ne se modifie pas/);
    const r = await e.envoyer('documents', 'f1', { ...(emise.corps.contenu as Record<string, unknown>), payments: [{ id: 'p1', date: '2026-10-05', amount: 500, method: 'especes' }] });
    expect(r.corps.motif).toBe('Cette pièce a une écriture validée : elle se corrige par une contre-passation.');
    expect((await admin.query(`select count(*)::int n from ventes.reglement where entreprise = $1`, [e.ent])).rows[0].n).toBe(0);
  });
});
