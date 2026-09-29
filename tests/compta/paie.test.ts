// Les écritures de la paie tenues par le serveur, EN TOTAUX DU MOIS (brique 34 ; docs/ecritures.md ;
// 03 § 2.1). Deux chemins, un chiffre : les bulletins, les salaires versés et les avances de l'exemple
// de cinq ans, enregistrés par le dossier comme l'écran les envoie ; la v10 écrit une écriture par
// bulletin, au nom du salarié (`journalEntries`, partie « paie ») ; le serveur écrit le total du mois :
// chaque compte, chaque jour, chaque journal porte la même somme. Et aucun nom de salarié n'entre dans
// les livres.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { reecrireLesMois } from '../../serveur/compta/paie.ts';
import { appliquer, type Changement } from '../../serveur/v10/dossier.ts';
import { demo, ecranDeLaPlateforme, entier, exiger, v10, type Societe } from '../moteur/v10.ts';

type Reglages = Record<string, unknown>;
type Salarie10 = { id: string; name: string; grossSalary?: number; [k: string]: unknown };
type Bulletin10 = { id: string; employeeId: string; year: number; month: number; computed: Record<string, unknown>; [k: string]: unknown };
type LigneJournal = { date: string; journal: string; source: string; docId: string; account: string; debit: number; credit: number; label?: string; tiers?: string };
const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: Salarie10, i: unknown, s: Reglages) => Record<string, unknown> };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneJournal[];
  payrollSettings: (d: unknown) => Reglages;
};

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as {
  company: Societe; employees: Salarie10[]; payslips: Bulletin10[]; advances: { id: string; employeeId: string; date: string; amount: number }[]; accounts: { id: string }[];
};
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const nouveaux = <T extends { id: string }>(collection: string, objets: T[]): Changement[] =>
  objets.map((o, rang) => ({ collection, cle: o.id, rang, revision: null, contenu: encoder(o) }));

let proprio = '';
let ent = '';

beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-paie@exemple.tn', 'Compta') returning id`)).rows[0].id;
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Exemple v10') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Exemple de cinq ans') returning id`, [org])).rows[0].id;
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, ent]);
  // L'écran de la plateforme fige le barème de chaque bulletin (ses montants sont ceux de la v10).
  const reglages = core.payrollSettings(donnees);
  for (const p of donnees.payslips) p.computed = ecran.computePayslip(donnees.employees.find((x) => x.id === p.employeeId) as Salarie10, p, reglages);
}, 240_000);
// L'exemple s'enregistre au premier test qui le lit, et non avant les tests : un refus de la base
// fait tomber chaque test qui en dépend.
let enregistre: Promise<unknown> | null = null;
const exemple = () => (enregistre ??= enTantQue(pool, proprio, (tx) => appliquer(tx, ent, proprio, [
  ...nouveaux('accounts', donnees.accounts), ...nouveaux('employees', donnees.employees),
  ...nouveaux('payslips', donnees.payslips), ...nouveaux('advances', donnees.advances ?? []),
])));
afterAll(async () => { await admin.end(); await pool.end(); });

// Les sommes par jour, journal, compte et côté.
function sommes(lignes: { date: string; journal: string; compte: string; debit: bigint; credit: bigint }[]) {
  const s = new Map<string, bigint>();
  for (const l of lignes) {
    if (l.debit) s.set(`${l.date} ${l.journal} ${l.compte} D`, (s.get(`${l.date} ${l.journal} ${l.compte} D`) ?? 0n) + l.debit);
    if (l.credit) s.set(`${l.date} ${l.journal} ${l.compte} C`, (s.get(`${l.date} ${l.journal} ${l.compte} C`) ?? 0n) + l.credit);
  }
  return [...s].map(([k, v]) => `${k} ${v}`).sort();
}
const tenues = async () => (await admin.query(`select e.origine_type, e.journal, e.date_ecriture::text date, e.piece, e.tiers, e.libelle, l.compte, l.debit::text debit, l.credit::text credit, l.libelle ligne
  from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1 and e.origine_type in ('paie', 'salaires', 'avance') order by e.date_ecriture, e.rang, l.rang`, [ent])).rows;

describe('les écritures de la paie, en totaux du mois, contre la v10', () => {
  it('chaque mois : la paie, les salaires versés et les avances, compte par compte et jour par jour, sont les sommes des écritures de la v10', async () => {
    await exemple();
    const v = core.journalEntries(donnees, donnees.company, {}, { sections: ['paie'] });
    const t = await tenues();
    const faux = { v10: sommes(v.map((l) => ({ date: l.date, journal: l.journal, compte: l.account, debit: entier(l.debit, 3) ?? -1n, credit: entier(l.credit, 3) ?? -1n }))),
      serveur: sommes(t.map((l) => ({ date: l.date, journal: l.journal, compte: l.compte, debit: BigInt(l.debit), credit: BigInt(l.credit) }))) };
    expect(faux.serveur).toEqual(faux.v10);
    // Le banc a mesuré quelque chose : des mois, des salaires versés, des avances.
    expect(new Set(t.filter((l) => l.origine_type === 'paie').map((l) => l.date)).size).toBeGreaterThan(20);
    expect(t.filter((l) => l.origine_type === 'salaires').length).toBeGreaterThan(20);
    expect(t.filter((l) => l.origine_type === 'avance').length).toBeGreaterThan(0);
    // Une écriture par mois, pas une par bulletin.
    const parMois = (await admin.query(`select count(*)::int n from compta.ecriture where entreprise = $1 and origine_type = 'paie'`, [ent])).rows[0].n;
    expect(parMois).toBe(new Set(donnees.payslips.map((p) => `${p.year}-${p.month}`)).size);
    expect(parMois).toBeLessThan(donnees.payslips.length);
  });

  it('aucun nom de salarié n\'entre dans les livres : ni libellé, ni tiers, ni pièce', async () => {
    await exemple();
    const t = await tenues();
    const noms = donnees.employees.map((e) => e.name).filter(Boolean);
    expect(noms.length).toBeGreaterThan(1);
    const avecNom = t.filter((l) => noms.some((n) => [l.libelle, l.ligne, l.piece].some((x) => String(x ?? '').includes(n)) || l.tiers !== null));
    expect(avecNom).toEqual([]);
    // Le témoin : la v10, elle, les nomme.
    expect(core.journalEntries(donnees, donnees.company, {}, { sections: ['paie'] }).some((l) => noms.some((n) => String(l.label ?? '').includes(n)))).toBe(true);
  });

  it('un mois se réécrit à chaque geste : deux bulletins, l\'un déplacé, le salaire versé, une avance ; une avance illisible est refusée', async () => {
    const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Parcours paie') returning id`)).rows[0].id;
    const e2 = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Parcours paie') returning id`, [org])).rows[0].id;
    await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, e2]);
    const revisions = new Map<string, number>();
    const envoyer = (collection: string, cle: string, contenu: unknown) => enTantQue(pool, proprio, async (tx) => {
      const r = await appliquer(tx, e2, proprio, [{ collection, cle, rang: contenu === null ? null : 0, revision: revisions.get(`${collection}/${cle}`) ?? null, contenu: contenu === null ? null : encoder(contenu) }]);
      for (const x of r) if (x.revision === null) revisions.delete(`${x.collection}/${x.cle}`); else revisions.set(`${x.collection}/${x.cle}`, x.revision);
    });
    const reglages = core.payrollSettings(donnees);
    const [s1, s2] = donnees.employees as [Salarie10, Salarie10];
    await envoyer('employees', s1.id, s1);
    await envoyer('employees', s2.id, s2);
    const saisie = (s: Salarie10) => ({ gross: s.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] });
    const bulletin = (id: string, s: Salarie10, mois: number, x: Record<string, unknown> = {}) =>
      ({ id, employeeId: s.id, year: 2026, month: mois, ...saisie(s), computed: ecran.computePayslip(s, saisie(s), reglages), paidDate: '', accountId: '', method: 'virement', ...x });
    const b1 = bulletin('b1', s1, 9), b2 = bulletin('b2', s2, 9);
    await envoyer('payslips', 'b1', b1);
    await envoyer('payslips', 'b2', b2);
    const lignes = async () => (await admin.query(`select e.journal, e.date_ecriture::text date, string_agg(l.compte || ' ' || l.debit || ' ' || l.credit, ' | ' order by l.rang) lignes
      from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1 group by e.id order by e.date_ecriture, e.rang`, [e2])).rows as { journal: string; date: string; lignes: string }[];
    // Une seule écriture pour septembre : la somme des deux bulletins, compte par compte (deux chemins :
    // les calculs de l'écran, bulletin par bulletin, additionnés ici).
    const m = (b: { computed: Record<string, unknown> }, k: string) => entier(Number(b.computed[k] ?? 0), 3) ?? 0n;
    const somme = (...k: string[]) => [b1, b2].reduce((t, b) => t + k.reduce((u, x) => u + m(b, x), 0n), 0n);
    const paie = (date: string, bs: typeof b1[]) => {
      const s = (...k: string[]) => bs.reduce((t, b) => t + k.reduce((u, x) => u + m(b, x), 0n), 0n);
      const l = [['640', s('gross'), 0n], ['645', s('cnssEmployer', 'accident'), 0n], ['661', s('tfp', 'foprolos'), 0n], ['4335', 0n, s('tfp', 'foprolos')],
        ['4531', 0n, s('cnssEmployee', 'cnssEmployer', 'accident')], ['4321', 0n, s('irpp', 'css')], ['425', 0n, s('net', 'otherDeductions')]] as const;
      return { journal: 'PAIE', date, lignes: l.filter(([, d, c]) => d !== 0n || c !== 0n).map(([k, d, c]) => `${k} ${d} ${c}`).join(' | ') };
    };
    expect(somme('gross')).toBeGreaterThan(m(b1, 'gross'));
    expect(await lignes()).toEqual([paie('2026-09-30', [b1, b2])]);
    // Le bulletin de la seconde salariée passe en octobre : septembre se réécrit, octobre naît.
    await envoyer('payslips', 'b2', { ...b2, month: 10 });
    expect(await lignes()).toEqual([paie('2026-09-30', [b1]), paie('2026-10-31', [b2])]);
    // Le salaire de septembre versé le 2 octobre, en espèces (aucun compte de trésorerie : la caisse).
    await envoyer('payslips', 'b1', { ...b1, paidDate: '2026-10-02', method: 'especes' });
    const net1 = m(b1, 'net');
    expect(await lignes()).toEqual([paie('2026-09-30', [b1]), { journal: 'CA', date: '2026-10-02', lignes: `425 ${net1} 0 | 54 0 ${net1}` }, paie('2026-10-31', [b2])]);
    // Une avance de 150,500 par virement le 15 octobre : elle débite le 425, la banque paie.
    await envoyer('advances', 'a1', { id: 'a1', employeeId: s2.id, date: '2026-10-15', amount: 150.5, method: 'virement' });
    expect((await lignes()).map((x) => `${x.journal} ${x.date} ${x.lignes}`)).toContain('BQ 2026-10-15 425 150500 0 | 532 0 150500');
    // Une avance illisible : refusée, rien n'est écrit.
    await expect(envoyer('advances', 'a2', { id: 'a2', employeeId: s2.id, date: '2026-10-16', amount: 10.1234 })).rejects.toThrow();
    expect((await admin.query(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and cle = 'a2'`, [e2])).rows[0].n).toBe(0);
    // Le bulletin d'octobre retiré : octobre ne garde que l'avance.
    await envoyer('payslips', 'b2', null);
    expect((await lignes()).map((x) => `${x.journal} ${x.date}`)).toEqual(['PAIE 2026-09-30', 'CA 2026-10-02', 'BQ 2026-10-15']);
    // Le plan changé (les salaires bruts au 6401) : la paie le suit.
    await envoyer('_racine', 'chartAccounts', { salairesBruts: '6401' });
    expect((await lignes())[0]?.lignes.startsWith(`6401 ${m(b1, 'gross')} 0 | `)).toBe(true);
  });

  it('qui ne voit pas la paie ne peut pas en réécrire le brouillard (il l\'effacerait)', async () => {
    const commercial = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-paie-commercial@exemple.tn', 'Commercial') returning id`)).rows[0].id;
    await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{commercial}')`, [commercial, ent]);
    await exemple();
    const avant = (await tenues()).length;
    await expect(enTantQue(pool, commercial, (tx) => reecrireLesMois(tx, ent, [{ annee: 2025, mois: 3 }]))).rejects.toThrow(/voit la paie/);
    expect((await tenues()).length).toBe(avant);
    // La comptabilité interne, elle, lit la paie dans les livres (en totaux), jamais un bulletin.
    const compta = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-paie-interne@exemple.tn', 'Interne') returning id`)).rows[0].id;
    await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{comptabilite_interne}')`, [compta, ent]);
    const vu = await enTantQue(pool, compta, async (tx) => ({
      lignes: (await tx.query(`select count(*)::int n from compta.ecriture where entreprise = $1 and journal = 'PAIE'`, [ent])).rows[0].n,
      bulletins: (await tx.query(`select count(*)::int n from paie.bulletin where entreprise = $1`, [ent])).rows[0].n,
    }));
    expect(vu.lignes).toBeGreaterThan(20);
    expect(vu.bulletins).toBe(0);
  });
});
