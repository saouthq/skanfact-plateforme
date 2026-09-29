// Les écritures des achats tenues par le serveur (brique 33 ; docs/ecritures.md). Deux chemins, un
// chiffre : les achats de l'exemple de cinq ans de la v10 (et des familles tirées au hasard) sont
// enregistrés par le dossier, comme l'interface les envoie ; chaque écriture que le serveur TIENT est
// celle que la v10 CALCULE (`journalEntries`, parties « achats » et « règlements ») : même journal,
// même date, même compte, même millime, dans le même ordre. Puis la TVA déductible et les retenues
// opérées de chaque mois, lues dans les écritures du serveur, sont celles que la v10 déclare.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { declarationTva, finDeMois, type EcritureDatee } from '../../moteur/declarations.ts';
import { PLAN_PAR_DEFAUT } from '../../moteur/comptes.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { appliquer, type Changement } from '../../serveur/v10/dossier.ts';
import { factureDAchatAuHasard, type AchatDonne } from '../moteur/v10-achats.ts';
import { demo, entier, exiger, hasard, v10, type Societe } from '../moteur/v10.ts';

type Achat10 = AchatDonne & { payments?: { id: string; date?: string; amount: number | string }[] };
type Donnees = { company: Societe; suppliers: { id: string; name: string }[]; purchases: Achat10[]; accounts?: { id: string }[] };
type LigneJournal = { date: string; journal: string; source: string; docId: string; account: string; debit: number; credit: number };
type MoisV10 = { deductible: number; withheldOnBuys: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneJournal[];
  vatChain: (data: unknown, c: Societe, annee: string, jusqua: number) => MoisV10[];
};

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as Donnees;
// Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const nouveaux = <T extends { id: string }>(collection: string, objets: T[]): Changement[] =>
  objets.map((o, rang) => ({ collection, cle: o.id, rang, revision: null, contenu: encoder(o) }));

let proprio = '';
async function entreprise(nom: string): Promise<string> {
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', $1) returning id`, [nom])).rows[0].id;
  const ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, $2) returning id`, [org, nom])).rows[0].id;
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, ent]);
  return ent;
}

// Les écritures d'achat du serveur, avec la pièce v10 de chacune, dans l'ordre de leur famille.
type Tenue = { origine_type: string; piece_v10: string; famille_v10: string; journal: string; date: string; lignes: { compte: string; debit: string; credit: string }[] };
async function ecrituresDuServeur(ent: string): Promise<Tenue[]> {
  return (await admin.query(`select e.origine_type, coalesce(p.ref_v10, rp.ref_v10, ap.ref_v10) piece_v10, f.ref_v10 famille_v10, e.journal, e.date_ecriture::text date,
      json_agg(json_build_object('compte', l.compte, 'debit', l.debit::text, 'credit', l.credit::text) order by l.rang) lignes
    from compta.ecriture e join compta.ligne l on l.ecriture = e.id
    join achats.piece f on f.id = e.famille
    left join achats.piece p on p.id = e.origine and e.origine_type = 'achat'
    left join achats.piece ap on ap.id = e.origine and e.origine_type = 'imputation'
    left join achats.reglement r on r.id = e.origine and e.origine_type = 'reglement_fournisseur'
    left join achats.piece rp on rp.id = r.piece
    where e.entreprise = $1 group by e.id, p.ref_v10, rp.ref_v10, ap.ref_v10, f.ref_v10 order by e.famille, e.rang`, [ent])).rows as Tenue[];
}
const enLigne = (date: string, journal: string, compte: string, debit: bigint, credit: bigint) => `${date} ${journal} ${compte} ${debit} ${credit}`;
const deLaV10 = (l: LigneJournal) => enLigne(l.date, l.journal, l.account, entier(l.debit, 3) ?? -1n, entier(l.credit, 3) ?? -1n);
const duServeur = (liste: Tenue[]) => liste.flatMap((e) => e.lignes.map((l) => enLigne(e.date, e.journal, l.compte, BigInt(l.debit), BigInt(l.credit))));

type Vus = { achats: number; imputations: number; reglements: number; avecRetenue: number; enDevise: number };
// Chaque pièce : son écriture d'achat, les imputations de ses acomptes, ses règlements.
function comparer(data: Donnees, tenues: Tenue[], vus: Vus): string[] {
  const v10Lignes = core.journalEntries(data, data.company, {}, { sections: ['achats', 'reglements'] });
  const faux: string[] = [];
  for (const p of data.purchases) {
    const nom = `${p.number ?? p.id} (${p.kind})`;
    const achat = [v10Lignes.filter((l) => l.docId === p.id && l.journal === 'AC').map(deLaV10), duServeur(tenues.filter((e) => e.origine_type === 'achat' && e.piece_v10 === p.id))];
    const imputations = [v10Lignes.filter((l) => l.docId === p.id && l.journal === 'OD').map(deLaV10), duServeur(tenues.filter((e) => e.origine_type === 'imputation' && e.famille_v10 === p.id))];
    const reglements = [v10Lignes.filter((l) => l.docId === p.id && l.source === 'règlement').map(deLaV10), duServeur(tenues.filter((e) => e.origine_type === 'reglement_fournisseur' && e.piece_v10 === p.id))];
    for (const [quoi, [attendu, tenu]] of [['achat', achat], ['imputations', imputations], ['règlements', reglements]] as const) {
      if (JSON.stringify(attendu) !== JSON.stringify(tenu)) faux.push(`${nom} ${quoi} : v10 [${(attendu ?? []).join(' | ')}] ; serveur [${(tenu ?? []).join(' | ')}]`);
    }
    vus.achats += tenues.filter((e) => e.origine_type === 'achat' && e.piece_v10 === p.id).length;
    vus.imputations += tenues.filter((e) => e.origine_type === 'imputation' && e.famille_v10 === p.id).length;
    const siens = tenues.filter((e) => e.origine_type === 'reglement_fournisseur' && e.piece_v10 === p.id);
    vus.reglements += siens.length;
    if (siens.some((e) => e.lignes.some((l) => l.compte === PLAN_PAR_DEFAUT.rsOperee))) vus.avecRetenue++;
    if (p.currency && p.currency !== 'DT') vus.enDevise++;
  }
  return faux;
}

let exemple = '';
let auHasard = '';
const familles: Achat10[][] = [];

beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-achats@exemple.tn', 'Compta') returning id`)).rows[0].id;
  exemple = await entreprise('Exemple de cinq ans');
  // Tout l'exemple en un envoi : les comptes de trésorerie (ils décident du journal de chaque
  // règlement), les fournisseurs, les achats.
  await enTantQue(pool, proprio, (tx) => appliquer(tx, exemple, proprio, [
    ...nouveaux('accounts', donnees.accounts ?? []), ...nouveaux('suppliers', donnees.suppliers), ...nouveaux('purchases', donnees.purchases),
  ]));

  // Des familles tirées au hasard : une facture (ou une dépense) en dinars, ses avoirs et acomptes,
  // leurs règlements. Les familles en devise ont leur banc au moteur (leurs écarts tranchés y sont
  // vérifiés un à un) ; le serveur refuse un rattachement entre deux devises (0013, D3).
  auHasard = await entreprise('Familles au hasard');
  const h = hasard(20260929);
  for (let i = 0; familles.length < 150 && i < 2000; i++) {
    const f = factureDAchatAuHasard(h, i) as Achat10[];
    if (f.some((p) => p.currency && p.currency !== 'DT')) continue;
    // Un identifiant de règlement est unique dans l'entreprise.
    for (const p of f) p.payments = (p.payments ?? []).map((r) => ({ ...r, id: `${p.id}-${r.id}` }));
    familles.push(f);
  }
}, 240_000);
afterAll(async () => { await admin.end(); await pool.end(); });

describe('les écritures des achats, tenues par le serveur, contre la v10', () => {
  it('chaque achat, chaque imputation d\'acompte et chaque règlement fournisseur de l\'exemple s\'écrit au serveur comme la v10 l\'écrit : journal, date, compte, millime, ordre', async () => {
    const tenues = await ecrituresDuServeur(exemple);
    const vus: Vus = { achats: 0, imputations: 0, reglements: 0, avecRetenue: 0, enDevise: 0 };
    expect(comparer(donnees, tenues, vus).slice(0, 5)).toEqual([]);
    // Le banc a mesuré quelque chose : chaque achat, chaque règlement, une imputation, des retenues, une devise.
    expect(vus.achats).toBe(donnees.purchases.length);
    expect(vus.reglements).toBe(donnees.purchases.reduce((s, p) => s + (p.payments ?? []).length, 0));
    expect(vus.reglements).toBeGreaterThan(150);
    expect(vus.imputations).toBeGreaterThanOrEqual(1);
    expect(vus.avecRetenue).toBeGreaterThan(5);
    expect(vus.enDevise).toBeGreaterThanOrEqual(1);
    const balance = (await admin.query('select sum(debit)::text d, sum(credit)::text c from compta.ligne where entreprise = $1', [exemple])).rows[0];
    expect(balance.d).toBe(balance.c);
  });

  it('150 familles tirées au hasard (avoirs imputés après règlement, acomptes, remboursements, pièces toutes nulles) : les mêmes écritures', async () => {
    // Enregistrées ici, et non avant le test : un refus de la base fait tomber CE test.
    await enTantQue(pool, proprio, (tx) => appliquer(tx, auHasard, proprio, [
      ...nouveaux('suppliers', [{ id: 's1', name: 'Fournisseur' }]), ...nouveaux('purchases', familles.flat()),
    ]));
    const tenues = await ecrituresDuServeur(auHasard);
    const vus: Vus = { achats: 0, imputations: 0, reglements: 0, avecRetenue: 0, enDevise: 0 };
    const faux = comparer({ company: { ...v10.DEFAULT_COMPANY }, suppliers: [{ id: 's1', name: 'Fournisseur' }], purchases: familles.flat() }, tenues, vus);
    expect(faux.slice(0, 5)).toEqual([]);
    expect(familles.length).toBe(150);
    expect(vus.imputations).toBeGreaterThan(20);
    expect(vus.avecRetenue).toBeGreaterThan(20);
    // Des avoirs rattachés qui régularisent une retenue déjà opérée : le cas le plus fin de la famille.
    const regularises = tenues.filter((e) => e.origine_type === 'achat' && e.lignes.some((l) => l.compte === PLAN_PAR_DEFAUT.rsOperee));
    expect(regularises.length).toBeGreaterThan(5);
    // Des pièces dont tout est nul : ni la v10 ni le serveur ne les écrivent.
    const v10Lignes = core.journalEntries({ company: { ...v10.DEFAULT_COMPANY }, suppliers: [], purchases: familles.flat() }, { ...v10.DEFAULT_COMPANY }, {}, { sections: ['achats'] });
    const nulles = familles.flat().filter((p) => !v10Lignes.some((l) => l.docId === p.id && l.journal === 'AC'));
    expect(nulles.length).toBeGreaterThan(0);
    expect(tenues.filter((e) => e.origine_type === 'achat' && nulles.some((p) => p.id === e.piece_v10))).toEqual([]);
  });

  it('la TVA déductible de chaque mois et les retenues opérées, lues dans les écritures du serveur, sont celles que la v10 déclare', async () => {
    const tenues = await ecrituresDuServeur(exemple);
    const journal: EcritureDatee[] = tenues.map((e) => ({ date: e.date, lignes: e.lignes.map((l) => ({ compte: l.compte, debit: BigInt(l.debit), credit: BigInt(l.credit) })) }));
    const P = PLAN_PAR_DEFAUT;
    const comptes = { tvaCollectee: P.tvaCollectee, tvaDeductible: P.tvaDeductible, timbre: P.timbre, retenueSubie: P.rsSubie, retenueOperee: P.rsOperee };
    const annees = [...new Set(donnees.purchases.map((p) => String(p.date).slice(0, 4)))].sort();
    const faux: string[] = [];
    let mois = 0, avecRetenue = 0;
    for (const a of annees) {
      const v = core.vatChain({ ...donnees, documents: [] }, donnees.company, a, 12);
      for (let m = 1; m <= 12; m++) {
        const n = declarationTva(journal, `${a}-${String(m).padStart(2, '0')}-01`, finDeMois(Number(a), m), comptes, 0n);
        const x = v[m - 1] as MoisV10;
        if (entier(x.deductible, 3) !== n.deductible) faux.push(`${a}-${m} déductible : v10 ${x.deductible}, serveur ${n.deductible}`);
        if (entier(x.withheldOnBuys, 3) !== n.retenuesOperees) faux.push(`${a}-${m} retenues opérées : v10 ${x.withheldOnBuys}, serveur ${n.retenuesOperees}`);
        if (n.deductible) mois++;
        if (n.retenuesOperees) avecRetenue++;
      }
    }
    expect(faux).toEqual([]);
    expect(mois).toBeGreaterThan(40);
    expect(avecRetenue).toBeGreaterThan(5);
  });
});
