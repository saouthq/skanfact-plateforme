// Les opérations diverses que le client saisit lui-même, tenues par le serveur (1.303.0 ; 0194 ; docs/ecritures.md, « Les
// opérations diverses du client »). Avant, le serveur ne les écrivait nulle part : le cabinet, qui lit ses livres, ne
// voyait ni l'assurance avancée par le gérant de l'exemple de cinq ans, ni un loyer sans facture. Deux chemins, un chiffre :
// la v10 les écrit (`journalEntries`, partie « od ») ; le serveur écrit les mêmes lignes, pièce, journal, compte, libellé et
// montant compris. Une opération qui ne tombe pas juste (l'écran la refuse déjà) n'entre pas ; corrigée, elle se réécrit ;
// supprimée, elle quitte le brouillard ; dans une période que le cabinet a validée, elle s'écrit au premier jour ouvert,
// et ce qui était validé se contre-passe.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { appliquer, type Changement } from '../../serveur/v10/dossier.ts';
import { demo, entier, exiger, v10, type Societe } from '../moteur/v10.ts';

type LigneJournal = { date: string; journal: string; piece: string; account: string; debit: number; credit: number; label?: string };
type Ligne10 = { compte: string; label?: string; debit: number; credit: number };
type Operation10 = { id: string; date: string; piece: string; journal?: string; label: string; lignes: Ligne10[] };
const core = exiger('../../banc/v10/core.js') as { journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneJournal[] };

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as { company: Societe; ecrituresOD: Operation10[] };
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
const nouveaux = (objets: Operation10[]): Changement[] => objets.map((o, rang) => ({ collection: 'ecrituresOD', cle: o.id, rang, revision: null, contenu: encoder(o) }));

// Celles que l'écran laisse passer (`odValide`), et qui piègent : trois lignes à trois décimales, une ligne sans libellé, une
// ligne entièrement vide au milieu, un autre journal que OD.
const justes: Operation10[] = [
  { id: 'od-loyer', date: '2026-09-05', piece: 'OD-2026-011', journal: 'OD', label: 'Loyer de septembre, sans facture', lignes: [
    { compte: '6132', label: 'Loyer du dépôt', debit: 1234.567, credit: 0 }, { compte: '4455', label: 'TVA déductible sur loyer', debit: 98.4, credit: 0 },
    { compte: '4011', debit: 0, credit: 1332.967 }] },
  { id: 'od-vide', date: '2026-09-07', piece: 'OD-2026-012', label: 'Charge avancée par le gérant', lignes: [
    { compte: '6256', label: 'Déplacement', debit: 85.125, credit: 0 }, { compte: '', label: '', debit: 0, credit: 0 },
    { compte: '4421', label: 'Compte courant du gérant', debit: 0, credit: 85.125 }] },
  { id: 'od-banque', date: '2026-09-09', piece: 'OD-2026-013', journal: 'BQ', label: 'Agios de septembre', lignes: [
    { compte: '6611', debit: 12.003, credit: 0 }, { compte: '532', debit: 0, credit: 12.003 }] },
];
// Celles qu'aucun écran ne laisse passer : le serveur ne les écrit pas.
const fausses: Operation10[] = [
  { id: 'od-boiteuse', date: '2026-09-10', piece: 'OD-2026-014', label: 'Ne tombe pas juste', lignes: [{ compte: '616', debit: 100, credit: 0 }, { compte: '4011', debit: 0, credit: 99.999 }] },
  { id: 'od-deux-cotes', date: '2026-09-11', piece: 'OD-2026-015', label: 'Une ligne des deux côtés', lignes: [{ compte: '616', debit: 50, credit: 50 }, { compte: '4011', debit: 0, credit: 0 }] },
  { id: 'od-compte-mot', date: '2026-09-12', piece: 'OD-2026-016', label: 'Un compte en lettres', lignes: [{ compte: 'banque', debit: 10, credit: 0 }, { compte: '4011', debit: 0, credit: 10 }] },
  { id: 'od-sans-libelle', date: '2026-09-13', piece: 'OD-2026-017', label: '   ', lignes: [{ compte: '616', debit: 10, credit: 0 }, { compte: '4011', debit: 0, credit: 10 }] },
  { id: 'od-une-ligne', date: '2026-09-14', piece: 'OD-2026-018', label: 'Une seule ligne', lignes: [{ compte: '616', debit: 0, credit: 0 }, { compte: '4011', debit: 0, credit: 0 }] },
];

let proprio = '';
let ent = '';
let ent2 = '';
beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-operations@exemple.tn', 'Compta') returning id`)).rows[0].id;
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Opérations diverses') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Exemple des opérations diverses') returning id`, [org])).rows[0].id;
  ent2 = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Période validée') returning id`, [org])).rows[0].id;
  for (const e of [ent, ent2]) await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, e]);
}, 240_000);
afterAll(async () => { await admin.end(); await pool.end(); });

const tenues = async (e: string) => (await admin.query(`select e.journal, e.date_ecriture::text date, e.piece, e.libelle, e.statut, e.origine_type, l.compte, l.debit::text debit, l.credit::text credit, l.libelle ligne
  from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1 and e.origine_type in ('operation_diverse', 'contre_passation')
  order by e.date_ecriture, e.piece, e.origine_type, l.compte`, [e])).rows as { journal: string; date: string; piece: string; libelle: string; statut: string; origine_type: string; compte: string; debit: string; credit: string; ligne: string }[];
const cleDe = (l: { date: string; journal: string; piece: string; compte: string; libelle: string; debit: bigint; credit: bigint }) =>
  `${l.date} ${l.journal} ${l.piece} ${l.compte} ${l.libelle} D${l.debit} C${l.credit}`;
const revision = async (e: string, cle: string) => Number((await admin.query(`select revision from socle.dossier_v10 where entreprise = $1 and collection = 'ecrituresOD' and cle = $2`, [e, cle])).rows[0].revision);

describe('les opérations diverses du client, tenues par le serveur, contre la v10', () => {
  it('chaque opération juste : le même journal, la même pièce, les mêmes comptes, libellés et montants que la v10 ; une fausse n\'entre pas', async () => {
    await enTantQue(pool, proprio, (tx) => appliquer(tx, ent, proprio, nouveaux([...donnees.ecrituresOD, ...justes, ...fausses])));
    const v = core.journalEntries({ ...donnees, ecrituresOD: [...donnees.ecrituresOD, ...justes] }, donnees.company, {}, { sections: ['od'] });
    const t = await tenues(ent);
    const attendu = v.map((l) => cleDe({ date: l.date, journal: l.journal, piece: l.piece, compte: l.account, libelle: l.label ?? '', debit: entier(l.debit, 3) ?? -1n, credit: entier(l.credit, 3) ?? -1n })).sort();
    const tenu = t.map((l) => cleDe({ date: l.date, journal: l.journal, piece: l.piece ?? '', compte: l.compte, libelle: l.ligne, debit: BigInt(l.debit), credit: BigInt(l.credit) })).sort();
    expect(tenu).toEqual(attendu);
    // Le banc a mesuré quelque chose : l'assurance de l'exemple, et chaque piège.
    expect(donnees.ecrituresOD.length).toBeGreaterThan(0);
    expect(t.filter((l) => l.libelle === 'Assurance annuelle du local, avancée par le gérant').map((l) => `${l.compte} ${l.debit}/${l.credit}`).sort()).toEqual(['4421 0/840000', '616 840000/0']);
    expect(t.filter((l) => l.piece === 'OD-2026-011').map((l) => `${l.journal} ${l.compte} ${l.debit}/${l.credit} ${l.ligne}`).sort()).toEqual([
      'OD 4011 0/1332967 Loyer de septembre, sans facture', 'OD 4455 98400/0 TVA déductible sur loyer', 'OD 6132 1234567/0 Loyer du dépôt']);
    expect(t.filter((l) => l.piece === 'OD-2026-012').map((l) => l.compte).sort()).toEqual(['4421', '6256']);
    expect(t.filter((l) => l.piece === 'OD-2026-013').map((l) => l.journal)).toEqual(['BQ', 'BQ']);
    for (const f of fausses) expect(t.filter((l) => l.piece === f.piece), f.id).toEqual([]);
    expect(t.every((l) => l.statut === 'brouillard' && l.origine_type === 'operation_diverse')).toBe(true);
  }, 240_000);

  it('une opération corrigée se réécrit ; supprimée, elle quitte le brouillard', async () => {
    const loyer = justes[0] as Operation10;
    const corrige = { ...loyer, lignes: [{ compte: '6132', label: 'Loyer du dépôt', debit: 1250, credit: 0 }, { compte: '4011', debit: 0, credit: 1250 }] };
    await enTantQue(pool, proprio, async (tx) => appliquer(tx, ent, proprio, [{ collection: 'ecrituresOD', cle: loyer.id, rang: 0, revision: await revision(ent, loyer.id), contenu: encoder(corrige) }]));
    expect((await tenues(ent)).filter((l) => l.piece === loyer.piece).map((l) => `${l.compte} ${l.debit}/${l.credit}`).sort()).toEqual(['4011 0/1250000', '6132 1250000/0']);
    await enTantQue(pool, proprio, async (tx) => appliquer(tx, ent, proprio, [{ collection: 'ecrituresOD', cle: loyer.id, rang: 0, revision: await revision(ent, loyer.id), contenu: null }]));
    expect((await tenues(ent)).filter((l) => l.piece === loyer.piece)).toEqual([]);
  }, 240_000);

  it('dans la période que le cabinet a validée : la nouvelle s\'écrit au premier jour ouvert, la corrigée se contre-passe à ce jour-là', async () => {
    const assurance: Operation10 = { id: 'od-assurance', date: '2026-09-20', piece: 'OD-2026-020', journal: 'OD', label: 'Assurance du véhicule', lignes: [
      { compte: '616', debit: 640.25, credit: 0 }, { compte: '4421', debit: 0, credit: 640.25 }] };
    await enTantQue(pool, proprio, (tx) => appliquer(tx, ent2, proprio, nouveaux([assurance])));
    await enTantQue(pool, proprio, (tx) => tx.query('select compta.valider($1, $2::date)', [ent2, '2026-09-30']));
    expect((await tenues(ent2)).map((l) => `${l.date} ${l.statut} ${l.compte}`)).toEqual(['2026-09-20 validee 4421', '2026-09-20 validee 616']);
    // Une opération de septembre saisie après la validation : au 1er octobre, au brouillard.
    const oubliee: Operation10 = { id: 'od-oubliee', date: '2026-09-25', piece: 'OD-2026-021', journal: 'OD', label: 'Frais de timbres oubliés', lignes: [
      { compte: '6371', debit: 31.5, credit: 0 }, { compte: '4421', debit: 0, credit: 31.5 }] };
    await enTantQue(pool, proprio, (tx) => appliquer(tx, ent2, proprio, nouveaux([oubliee])));
    expect((await tenues(ent2)).filter((l) => l.piece === oubliee.piece).map((l) => `${l.date} ${l.statut} ${l.compte} ${l.debit}/${l.credit}`)).toEqual([
      '2026-10-01 brouillard 4421 0/31500', '2026-10-01 brouillard 6371 31500/0']);
    // L'assurance corrigée : la validée reste, sa contre-passation et la nouvelle s'écrivent au 1er octobre.
    await enTantQue(pool, proprio, async (tx) => appliquer(tx, ent2, proprio, [{ collection: 'ecrituresOD', cle: assurance.id, rang: 0, revision: await revision(ent2, assurance.id),
      contenu: encoder({ ...assurance, lignes: [{ compte: '616', debit: 604.25, credit: 0 }, { compte: '4421', debit: 0, credit: 604.25 }] }) }]));
    expect((await tenues(ent2)).filter((l) => l.piece === assurance.piece).map((l) => `${l.date} ${l.statut} ${l.origine_type} ${l.compte} ${l.debit}/${l.credit}`)).toEqual([
      '2026-09-20 validee operation_diverse 4421 0/640250', '2026-09-20 validee operation_diverse 616 640250/0',
      '2026-10-01 brouillard contre_passation 4421 640250/0', '2026-10-01 brouillard contre_passation 616 0/640250',
      '2026-10-01 brouillard operation_diverse 4421 0/604250', '2026-10-01 brouillard operation_diverse 616 604250/0']);
  }, 240_000);
});
