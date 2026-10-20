// Les mouvements libres de la trésorerie tenus par le serveur (1.79.0 ; docs/ecritures.md, « Les mouvements de
// trésorerie »). Deux chemins, un chiffre : les mouvements de l'exemple de cinq ans, et ceux qui piègent (chaque nature,
// une contrepartie choisie, un virement banque → caisse, un virement dont le départ a disparu, un virement d'un compte
// vers lui-même, un salaire d'un mois avec et sans bulletin, un montant à trois décimales, un montant négatif), enregistrés
// comme l'écran les envoie : la v10 les écrit (`journalEntries`, partie « tresorerie ») ; le serveur écrit les mêmes
// lignes, pièce, journal, compte et libellé compris. Un mouvement supprimé quitte le brouillard.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { appliquer, type Changement } from '../../serveur/v10/dossier.ts';
import { demo, ecranDeLaPlateforme, entier, exiger, v10, type Societe } from '../moteur/v10.ts';

type LigneJournal = { date: string; journal: string; piece: string; account: string; debit: number; credit: number; label?: string };
type Mouvement10 = { id: string; date: string; kind: string; amount: number; accountId?: string; versAccountId?: string; compte?: string; label?: string; reference?: string; method?: string };
type Reglages = Record<string, unknown>;
type Salarie10 = { id: string; [k: string]: unknown };
type Bulletin10 = { id: string; employeeId: string; year: number; month: number; computed?: Record<string, unknown>; [k: string]: unknown };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneJournal[];
  payrollSettings: (d: unknown) => Reglages;
};
const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: Salarie10, i: unknown, s: Reglages) => Record<string, unknown> };

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as {
  company: Societe; accounts: { id: string; name: string; kind: string; isDefault?: boolean }[]; movements: Mouvement10[];
  employees: Salarie10[]; payslips: Bulletin10[];
};
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const nouveaux = <T extends { id: string }>(collection: string, objets: T[]): Changement[] =>
  objets.map((o, rang) => ({ collection, cle: o.id, rang, revision: null, contenu: encoder(o) }));

// Les comptes de l'exemple, et ceux qui piègent.
const banque = donnees.accounts.find((a) => a.kind !== 'caisse')?.id ?? '';
const caisse = { id: 'caisse-test', name: 'Caisse du comptoir', kind: 'caisse', opening: 0 };
const moisAvecBulletin = donnees.payslips.map((b) => `${b.year}-${String(b.month).padStart(2, '0')}`).sort()[0] ?? '2022-01';
const pieges: Mouvement10[] = [
  { id: 'p-banque', date: '2026-09-03', kind: 'banque', amount: 7.125, accountId: banque, method: 'virement' },
  { id: 'p-impot', date: '2026-09-04', kind: 'impot', amount: 410.05, accountId: banque, reference: 'QUIT-77', method: 'virement' },
  { id: 'p-tva', date: '2026-09-05', kind: 'impot', amount: 1234.567, accountId: banque, compte: '4365', label: 'TVA d\'août', method: 'virement' },
  { id: 'p-retrait', date: '2026-09-06', kind: 'retrait', amount: 300, accountId: caisse.id, method: 'especes' },
  { id: 'p-emprunt', date: '2026-09-07', kind: 'emprunt', amount: 875.5, accountId: banque, method: 'virement' },
  { id: 'p-sortie', date: '2026-09-08', kind: 'autre-sortie', amount: 0.1, accountId: caisse.id, compte: '658', method: 'especes' },
  { id: 'p-apport', date: '2026-09-09', kind: 'apport', amount: 2500, accountId: banque, method: 'virement' },
  { id: 'p-pret', date: '2026-09-10', kind: 'pret', amount: 10000, accountId: banque, method: 'virement' },
  { id: 'p-entree', date: '2026-09-11', kind: 'autre-entree', amount: 0.05, accountId: caisse.id, compte: '758', method: 'especes' },
  { id: 'p-negatif', date: '2026-09-12', kind: 'banque', amount: -3.2, accountId: banque, method: 'virement' },
  { id: 'p-vers-caisse', date: '2026-09-13', kind: 'virement', amount: 600, accountId: banque, versAccountId: caisse.id, method: 'virement' },
  { id: 'p-sans-depart', date: '2026-09-14', kind: 'virement', amount: 150, accountId: 'compte-supprime', versAccountId: caisse.id, method: 'virement' },
  { id: 'p-vers-soi', date: '2026-09-15', kind: 'virement', amount: 99, accountId: banque, versAccountId: banque, method: 'virement' },
  { id: 'p-salaire-sans', date: '2019-03-28', kind: 'salaire', amount: 1450.75, accountId: banque, method: 'virement' },
  { id: 'p-salaire-avec', date: `${moisAvecBulletin}-28`, kind: 'salaire', amount: 980, accountId: banque, method: 'virement' },
  { id: 'p-nul', date: '2026-09-16', kind: 'banque', amount: 0, accountId: banque, method: 'virement' },
];
const tousLesMouvements = [...donnees.movements, ...pieges];

let proprio = '';
let ent = '';
beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-mouvements@exemple.tn', 'Compta') returning id`)).rows[0].id;
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Exemple v10') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Exemple des mouvements') returning id`, [org])).rows[0].id;
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, ent]);
  // Les bulletins de l'exemple, figés comme l'écran de la plateforme les fige (leurs mois disent le compte d'un salaire).
  const reglages = core.payrollSettings(donnees);
  for (const p of donnees.payslips) p.computed = ecran.computePayslip(donnees.employees.find((x) => x.id === p.employeeId) as Salarie10, p, reglages);
}, 240_000);
let enregistre: Promise<unknown> | null = null;
const exemple = () => (enregistre ??= enTantQue(pool, proprio, (tx) => appliquer(tx, ent, proprio, [
  ...nouveaux('accounts', [...donnees.accounts, caisse]), ...nouveaux('employees', donnees.employees), ...nouveaux('payslips', donnees.payslips),
  ...nouveaux('movements', tousLesMouvements),
])));
afterAll(async () => { await admin.end(); await pool.end(); });

const tenues = async () => (await admin.query(`select e.journal, e.date_ecriture::text date, e.piece, e.libelle, e.statut, l.compte, l.debit::text debit, l.credit::text credit, l.libelle ligne
  from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1 and e.origine_type = 'mouvement' order by e.date_ecriture, e.piece, l.compte`, [ent])).rows;
const cleDe = (l: { date: string; journal: string; piece: string; compte: string; libelle: string; debit: bigint; credit: bigint }) =>
  `${l.date} ${l.journal} ${l.piece} ${l.compte} ${l.libelle} D${l.debit} C${l.credit}`;

describe('les mouvements de trésorerie, tenus par le serveur, contre la v10', () => {
  it('chaque mouvement : le même journal, la même pièce, les mêmes comptes, libellés et montants que la v10', async () => {
    await exemple();
    const donneesV10 = { ...donnees, accounts: [...donnees.accounts, caisse], movements: tousLesMouvements };
    const v = core.journalEntries(donneesV10, donnees.company, {}, { sections: ['tresorerie'] });
    const t = await tenues();
    const attendu = v.map((l) => cleDe({ date: l.date, journal: l.journal, piece: l.piece, compte: l.account, libelle: l.label ?? '', debit: entier(l.debit, 3) ?? -1n, credit: entier(l.credit, 3) ?? -1n })).sort();
    const tenu = t.map((l) => cleDe({ date: l.date, journal: l.journal, piece: l.piece ?? '', compte: l.compte, libelle: l.ligne, debit: BigInt(l.debit), credit: BigInt(l.credit) })).sort();
    expect(tenu).toEqual(attendu);
    // Le banc a mesuré quelque chose : l'exemple, et chaque piège.
    expect(t.length).toBeGreaterThan(100);
    const lignes = (piece: string) => t.filter((l) => l.piece === piece).map((l) => `${l.journal} ${l.compte} ${l.debit}/${l.credit}`).sort();
    expect(lignes('QUIT-77')).toEqual(['BQ 434 410050/0', 'BQ 532 0/410050']);
    expect(t.filter((l) => l.ligne === 'TVA d\'août').map((l) => `${l.compte} ${l.debit}/${l.credit}`).sort()).toEqual(['4365 1234567/0', '532 0/1234567']);
    expect(t.some((l) => l.compte === '658' && l.debit === '100') && t.some((l) => l.compte === '758' && l.credit === '50')).toBe(true);
    // Le virement vers la caisse : 54 au débit, 532 au crédit, au journal de la banque ; le départ disparu : 471.
    expect(t.filter((l) => l.ligne === 'Virement vers Caisse du comptoir').map((l) => `${l.journal} ${l.compte} ${l.debit}/${l.credit}`).sort()).toEqual(['BQ 532 0/600000', 'BQ 54 600000/0']);
    expect(t.filter((l) => l.ligne.includes('compte de départ supprimé')).map((l) => `${l.journal} ${l.compte} ${l.debit}/${l.credit}`).sort()).toEqual(['CA 471 0/150000', 'CA 54 150000/0']);
    expect(t.some((l) => l.debit === '99000' || l.credit === '99000')).toBe(false);
    // Le salaire d'un mois sans bulletin : 640 ; avec un bulletin : 425 ; le montant négatif garde son sens.
    expect(t.some((l) => l.date === '2019-03-28' && l.compte === '640' && l.debit === '1450750')).toBe(true);
    expect(t.some((l) => l.date === `${moisAvecBulletin}-28` && l.compte === '425' && l.debit === '980000')).toBe(true);
    expect(t.some((l) => l.date === '2026-09-12' && l.compte === '627' && l.debit === '3200')).toBe(true);
    expect(t.every((l) => l.statut === 'brouillard')).toBe(true);
  }, 240_000);

  it('un mouvement corrigé se réécrit ; supprimé, il quitte le brouillard', async () => {
    await exemple();
    const rev = async (cle: string) => Number((await admin.query(`select revision from socle.dossier_v10 where entreprise = $1 and collection = 'movements' and cle = $2`, [ent, cle])).rows[0].revision);
    const frais = pieges[0];
    await enTantQue(pool, proprio, async (tx) => appliquer(tx, ent, proprio, [{ collection: 'movements', cle: frais.id, rang: 0, revision: await rev(frais.id), contenu: encoder({ ...frais, amount: 8.5 }) }]));
    expect((await tenues()).filter((l) => l.date === frais.date && l.compte === '627').map((l) => l.debit)).toEqual(['8500']);
    await enTantQue(pool, proprio, async (tx) => appliquer(tx, ent, proprio, [{ collection: 'movements', cle: frais.id, rang: 0, revision: await rev(frais.id), contenu: null }]));
    expect((await tenues()).filter((l) => l.date === frais.date && l.compte === '627')).toEqual([]);
  }, 240_000);
});
