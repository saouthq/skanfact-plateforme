// La balance d'ouverture lue dans un FEC (docs/cabinet.md, C61 ; web/public/plateforme/fec.js). Le même exercice
// 2025 d'un client, exporté par trois logiciels : comme Odoo (barres, virgule décimale, CRLF), comme Dolibarr
// (tabulations, 21 colonnes, point décimal, ISO-8859-15) et avec « Montant » et « Sens ». Ce que les règles
// tiennent :
//   - trois fichiers, une balance : les à-nouveaux de la clôture de la v10, au millime, un par tiers non soldé ;
//   - deux calculs, un chiffre : un moteur qui se tromperait d'un millime sur un compte fait refuser la reprise ;
//   - tout se lit, ou rien n'est repris : une date, un compte, un montant illisibles refusent le fichier, nommés ;
//   - un seul exercice avant le premier jour ; un fichier de l'exercice en cours prend son journal d'à-nouveaux ;
//   - l'historique (C62) : les écritures d'une année, ses journaux devenus ceux de SkanFact, au millime, que l'analyse
//     du tableur de la v10 lit pièce par pièce ; les à-nouveaux et les autres années n'entrent pas.

import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Ligne = { compte: string; libelle: string; tiers: string; debit: number; credit: number };
type Ouverture = {
  ok: boolean; motif?: string; source?: string; lignes: Ligne[]; resultat: number; tiers: number; comptes: number; total: number; apres: number;
  journal: { code: string; lib: string } | null; alpha: string[]; annee: number; du: string;
  fichier: { du: string; au: string; lignes: number; ecritures: number; journaux: number; total: number };
};
type Lu = { ok: boolean; motif?: string; separateur?: string; lignes: unknown[]; du: string; au: string; debit: number; ecritures: number };
type Fec = {
  estFec: (t: string) => boolean; lire: (t: string) => Lu; ouverture: (lu: Lu, du: string, kc: unknown) => Ouverture;
  rapport: (r: Ouverture, nom: string) => { titre: string; html: string; bouton: string };
  millimes: (s: string) => number | null; jour: (s: string) => string | null; decouper: (l: string, sep: string) => string[];
  versLeLivre: (lu: Lu, ex: { du: string; au: string }) => { texte: string; lignes: number; ouverture: number; dehors: number; dehorsDu: string; dehorsAu: string;
    journaux: { code: string; lib: string; journal: string; par: string; lignes: number }[] };
  rapportLivre: (conv: unknown, ex: { du: string; au: string }) => string;
  journalDuLivre: (code: string, lib: string) => { journal: string; par: string };
};

const KC = ecranDeLaPlateforme('compta.js') as {
  anouveauxDe: (livre: unknown) => { lignes: Ligne[]; equilibre: boolean }; lireFichierTexte: (o: Uint8Array, n: string) => { ok: boolean; texte: string };
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => unknown;
  analyserImportEcritures: (livre: unknown, texte: string) => { ok: boolean; motif: string; compte: Record<string, number>;
    pieces: { action: string; journal: string; piece: string; date: string; ecart: number; lignes: { compte: string; tiers: string; debit: number; credit: number }[] }[] };
};
const fenetre: { SkanFec?: Fec } = {};
(vm.runInThisContext(`(function (window) {${fs.readFileSync(new URL('../../web/public/plateforme/fec.js', import.meta.url), 'utf8')}\n})`) as (w: unknown) => void)(fenetre);
const FEC = fenetre.SkanFec as Fec;

const TETE = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate',
  'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
// [journal, libellé du journal, numéro, date, compte, libellé du compte, aux, nom du tiers, pièce, libellé, débit, crédit, lettre]
type L = [string, string, string, string, string, string, string, string, string, string, string, string, string];
const EXERCICE_2025: L[] = [
  ['OUV', 'Ouverture', 'OUVERTURE/2025', '20250101', '532', 'Banque BIAT', '', '', 'OUV-2025', 'Ouverture 2025', '12500,125', '0,000', ''],
  ['OUV', 'Ouverture', 'OUVERTURE/2025', '20250101', '101', 'Capital social', '', '', 'OUV-2025', 'Ouverture 2025', '0,000', '12500,125', ''],
  ['VT', 'Ventes', 'INV/2025/0001', '20250314', '411', 'Clients', 'C001', 'Hôtel du Lac', 'FAC-2025-014', 'Facture Hôtel du Lac', '1191,001', '0,000', 'A'],
  ['VT', 'Ventes', 'INV/2025/0001', '20250314', '707', 'Ventes de marchandises', '', '', 'FAC-2025-014', 'Facture Hôtel du Lac', '0,000', '1000,001', ''],
  ['VT', 'Ventes', 'INV/2025/0001', '20250314', '4367', 'TVA collectée', '', '', 'FAC-2025-014', 'Facture Hôtel du Lac', '0,000', '191,000', ''],
  ['BQ', 'Banque', 'BNK/2025/0007', '20250402', '532', 'Banque BIAT', '', '', 'VIR-88', 'Encaissement Hôtel du Lac', '1191,001', '0,000', ''],
  ['BQ', 'Banque', 'BNK/2025/0007', '20250402', '411', 'Clients', 'C001', 'Hôtel du Lac', 'VIR-88', 'Encaissement Hôtel du Lac', '0,000', '1191,001', 'A'],
  ['AC', 'Achats', 'BILL/2025/0003', '20251105', '6064', 'Fournitures de bureau', '', '', 'FF-77', 'Papeterie', '84,034', '0,000', ''],
  ['AC', 'Achats', 'BILL/2025/0003', '20251105', '4366', 'TVA déductible', '', '', 'FF-77', 'Papeterie', '15,966', '0,000', ''],
  ['AC', 'Achats', 'BILL/2025/0003', '20251105', '401', 'Fournisseurs', 'F001', 'Papeterie du Lac', 'FF-77', 'Papeterie', '0,000', '100,000', ''],
  ['BQ', 'Banque', 'BNK/2025/0031', '20251130', '6278', 'Frais bancaires', '', '', 'REL-11', 'Frais de tenue de compte', '12,500', '0,000', ''],
  ['BQ', 'Banque', 'BNK/2025/0031', '20251130', '532', 'Banque BIAT', '', '', 'REL-11', 'Frais de tenue de compte', '0,000', '12,500', ''],
  ['VT', 'Ventes', 'INV/2025/0002', '20251220', '411', 'Clients', 'C002', 'Société Alpha', 'FAC-2025-102', 'Facture Société Alpha', '2380,250', '0,000', ''],
  ['VT', 'Ventes', 'INV/2025/0002', '20251220', '707', 'Ventes de marchandises', '', '', 'FAC-2025-102', 'Facture Société Alpha', '0,000', '2000,210', ''],
  ['VT', 'Ventes', 'INV/2025/0002', '20251220', '4367', 'TVA collectée', '', '', 'FAC-2025-102', 'Facture Société Alpha', '0,000', '380,040', ''],
  // L'exercice d'après a commencé dans l'ancien logiciel : ses mouvements ne sont pas des soldes d'ouverture.
  ['VT', 'Ventes', 'INV/2026/0001', '20260105', '411', 'Clients', 'C002', 'Société Alpha', 'FAC-2026-001', 'Facture Société Alpha', '119,000', '0,000', ''],
  ['VT', 'Ventes', 'INV/2026/0001', '20260105', '707', 'Ventes de marchandises', '', '', 'FAC-2026-001', 'Facture Société Alpha', '0,000', '100,000', ''],
  ['VT', 'Ventes', 'INV/2026/0001', '20260105', '4367', 'TVA collectée', '', '', 'FAC-2026-001', 'Facture Société Alpha', '0,000', '19,000', ''],
];
// Comme Odoo : des barres, la virgule décimale, CRLF.
const commeOdoo = (lignes: L[]) => [TETE.join('|'), ...lignes.map((l) => [...l.slice(0, 9), l[3], ...l.slice(9), l[12] ? l[3] : '', l[3], '', ''].join('|'))].join('\r\n') + '\r\n';
// Comme Dolibarr : des tabulations, 21 colonnes, le point décimal, sans les zéros d'un côté vide.
const commeDolibarr = (lignes: L[]) => [[...TETE, 'DateLimitReglmt', 'NumFacture', 'FichierFacture'].join('\t'),
  ...lignes.map((l) => [...l.slice(0, 9), l[3], l[9], l[10] === '0,000' ? '0' : l[10].replace(',', '.'), l[11] === '0,000' ? '0' : l[11].replace(',', '.'), l[12], '', l[3], '', '', '', l[8], ''].join('\t'))].join('\n');
// Avec « Montant » et « Sens » à la place de « Debit » et « Credit ».
const avecSens = (lignes: L[]) => [[...TETE.slice(0, 11), 'Montant', 'Sens', ...TETE.slice(13)].join('\t'),
  ...lignes.map((l) => [...l.slice(0, 9), l[3], l[9], l[10] !== '0,000' ? l[10] : l[11], l[10] !== '0,000' ? 'D' : 'C', l[12], '', '', '', ''].join('\t'))].join('\n');

const OUVERTURE_2026: [string, string, string, number, number][] = [
  ['101', 'Capital social', '', 0, 12500.125],
  ['4366', 'TVA déductible', '', 15.966, 0],
  ['4367', 'TVA collectée', '', 0, 571.04],
  ['532', 'Banque BIAT', '', 13678.626, 0],
  ['401', 'Papeterie du Lac — non lettré', 'Papeterie du Lac', 0, 100],
  ['411', 'Société Alpha — non lettré', 'Société Alpha', 2380.25, 0],
  ['13', 'Résultat de l\'exercice 2025', '', 0, 2903.677],
];
const vue = (r: Ouverture) => r.lignes.map((l) => [l.compte, l.libelle, l.tiers, l.debit, l.credit]);

describe('la balance d\'ouverture lue dans un FEC', () => {
  it('trois logiciels, une balance : les à-nouveaux de la clôture, au millime, un par tiers non soldé', () => {
    const iso = KC.lireFichierTexte(Uint8Array.from(Buffer.from(commeDolibarr(EXERCICE_2025), 'latin1')), 'FEC.txt');
    expect(iso.ok).toBe(true);
    for (const [texte, sep] of [[commeOdoo(EXERCICE_2025), '|'], [iso.texte, '\t'], [avecSens(EXERCICE_2025), '\t']] as const) {
      expect(FEC.estFec(texte)).toBe(true);
      const lu = FEC.lire(texte);
      expect(lu).toMatchObject({ ok: true, separateur: sep, du: '2025-01-01', au: '2026-01-05', debit: 17_493_877, ecritures: 7 });
      const r = FEC.ouverture(lu, '2026-01-01', KC);
      expect(r).toMatchObject({ ok: true, source: 'cloture', du: '2026-01-01', annee: 2025, comptes: 7, tiers: 2, apres: 3, resultat: 2_903_677, total: 16_074_842, journal: null, alpha: [] });
      expect(vue(r)).toEqual(OUVERTURE_2026);
    }
    // Le rapport dit ce que le fichier porte, ce qui est repris et ce qui ne l'est pas.
    const r = FEC.ouverture(FEC.lire(commeOdoo(EXERCICE_2025)), '2026-01-01', KC);
    const { titre, html, bouton } = FEC.rapport(r, 'FEC <2025>.txt');
    const texte = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect([titre, bouton]).toEqual(['Reprendre les soldes de ce FEC ?', 'Reprendre ces soldes']);
    expect(html).toContain('« FEC &lt;2025&gt;.txt »');
    expect(texte).toMatch(/Le fichier du 01\/01\/2025 au 05\/01\/2026 Ses écritures 7 écritures, 18 lignes, 4 journaux Son total \(débit = crédit\) 17\s493,877/);
    expect(texte).toMatch(/La balance d'ouverture au 01\/01\/2026 7 lignes, 7 comptes dont clients et fournisseurs, une ligne par tiers 2 Le résultat de 2025 \(un bénéfice\), au compte 13 2\s903,677 Le total de la balance \(débit = crédit\) 16\s074,842/);
    expect(texte).toContain('Deux calculs, un chiffre : ces soldes sont les à-nouveaux que SkanFact pose à la clôture d\'un exercice, et ils redonnent, compte par compte, le solde du fichier au 20/12/2025.');
    expect(texte).toContain('3 lignes du 01/01/2026 ou après sont des mouvements de l\'exercice, pas ses soldes d\'ouverture : la balance ne les prend pas.');
  });

  it('deux calculs, un chiffre : un moteur qui se tromperait d\'un millime fait refuser la reprise', () => {
    const faux = { anouveauxDe: (livre: unknown) => {
      const an = KC.anouveauxDe(livre);
      return { ...an, lignes: an.lignes.map((l) => (l.compte === '4367' ? { ...l, credit: l.credit + 0.001 } : l.compte === '532' ? { ...l, debit: l.debit + 0.001 } : l)) };
    } };
    expect(FEC.ouverture(FEC.lire(commeOdoo(EXERCICE_2025)), '2026-01-01', faux)).toMatchObject({ ok: false,
      motif: 'Les deux calculs de la balance d\'ouverture ne donnent pas le même chiffre sur le compte 532 (13\u202f678,626 dans le fichier, 13\u202f678,627 par la clôture) : rien n\'est repris. Signale-le au support.' });
  });

  it('tout se lit, ou rien n\'est repris : chaque ligne illisible se nomme, avec son numéro dans le fichier', () => {
    const abime = EXERCICE_2025.map((l) => [...l] as L);
    (abime[2] as L)[3] = '20251332';
    (abime[7] as L)[10] = '84,0345';
    (abime[11] as L)[4] = 'BANQUE';
    const r = FEC.lire(commeOdoo(abime));
    expect(r).toMatchObject({ ok: false, motif: 'Ce FEC ne se lit pas en entier, rien n\'est repris — ligne 4 : la date « 20251332 » ne se lit pas (AAAAMMJJ) ; '
      + 'ligne 9 : le montant « 84,0345 » ne se lit pas (au plus trois décimales) ; ligne 13 : le compte « BANQUE » n\'est pas un numéro. '
      + 'Exporte-le de nouveau depuis ton ancien logiciel, sans le retoucher.' });
    // Des zéros au-delà du millime ne changent rien : ils se lisent.
    expect([FEC.millimes('84,0340'), FEC.millimes('1 234,5'), FEC.millimes('-5,1'), FEC.millimes(''), FEC.millimes('1.234,56'), FEC.millimes('12,3456')])
      .toEqual([84_034, 1_234_500, -5_100, 0, null, null]);
    expect([FEC.jour('20250229'), FEC.jour('20240229'), FEC.jour('2025-03-14'), FEC.jour('14/03/2025'), FEC.jour('45000')]).toEqual([null, '2024-02-29', '2025-03-14', '2025-03-14', null]);
    // Un fichier qui ne tombe pas juste.
    const boiteux = EXERCICE_2025.map((l) => [...l] as L);
    (boiteux[3] as L)[11] = '1000,010';
    expect(FEC.lire(commeOdoo(boiteux))).toMatchObject({ ok: false, motif: 'Ce FEC ne tombe pas juste : débit 17\u202f493,877 ≠ crédit 17\u202f493,886. Rien n\'est repris : exporte-le de nouveau depuis ton ancien logiciel.' });
    // Ce qui n'est pas un FEC n'en est pas un.
    expect(FEC.estFec('Compte;Intitulé;Débit;Crédit\r\n101;Capital;;20 000,000')).toBe(false);
  });

  it('un seul exercice avant le premier jour ; un fichier qui commence ce jour-là prend son journal d\'à-nouveaux', () => {
    // 2024 et 2025 dans le même fichier : deux résultats, dont l'un est déjà affecté.
    const deuxAns: L[] = [['OD', 'Opérations diverses', 'OD/2024/0001', '20240315', '532', 'Banque BIAT', '', '', 'OD-1', 'Apport', '500,000', '0,000', ''],
      ['OD', 'Opérations diverses', 'OD/2024/0001', '20240315', '101', 'Capital social', '', '', 'OD-1', 'Apport', '0,000', '500,000', ''], ...EXERCICE_2025];
    expect(FEC.ouverture(FEC.lire(commeOdoo(deuxAns)), '2026-01-01', KC)).toMatchObject({ ok: false,
      motif: 'Ce FEC commence le 15/03/2024 : avant le 01/01/2026, il couvre plus d\'un exercice. Exporte celui qui finit le 20/12/2025 seul.' });
    // Un fichier de 2026 sans journal d'à-nouveaux : il ne dit rien de ce qu'il y avait avant.
    const sans = FEC.lire(commeOdoo(EXERCICE_2025.filter((l) => l[3] >= '2026')));
    expect(FEC.ouverture(sans, '2026-01-01', KC)).toMatchObject({ ok: false,
      motif: 'Ce FEC commence le 05/01/2026 : il ne dit pas ce que les comptes portaient avant le 01/01/2026, et il n\'a pas de journal d\'à-nouveaux ce jour-là. Choisis le FEC de l\'exercice qui finit la veille, le 31/12/2025.' });
    // Un fichier de 2026 qui porte ses à-nouveaux (« RAN », « Reports à nouveau ») : ce sont eux, et le rapport le dit.
    const ran: L[] = [
      ['RAN', 'Reports à nouveau', 'RAN/2026', '20260101', '532', 'Banque BIAT', '', '', 'RAN-2026', 'Reports', '13678,626', '0,000', ''],
      ['RAN', 'Reports à nouveau', 'RAN/2026', '20260101', '411', 'Clients', 'C002', 'Société Alpha', 'RAN-2026', 'Reports', '2380,250', '0,000', ''],
      ['RAN', 'Reports à nouveau', 'RAN/2026', '20260101', '101', 'Capital social', '', '', 'RAN-2026', 'Reports', '0,000', '16058,876', ''],
      ['VT', 'Ventes', 'INV/2026/0001', '20260101', '532', 'Banque BIAT', '', '', 'FAC-2026-001', 'Vente du jour', '59,500', '0,000', ''],
      ['VT', 'Ventes', 'INV/2026/0001', '20260101', '707', 'Ventes de marchandises', '', '', 'FAC-2026-001', 'Vente du jour', '0,000', '59,500', ''],
    ];
    const r = FEC.ouverture(FEC.lire(commeOdoo(ran)), '2026-01-01', KC);
    expect(r).toMatchObject({ ok: true, source: 'journal', journal: { code: 'RAN', lib: 'Reports à nouveau' }, apres: 2, resultat: 0 });
    expect(vue(r)).toEqual([['101', 'Capital social', '', 0, 16058.876], ['532', 'Banque BIAT', '', 13678.626, 0], ['411', 'Société Alpha — non lettré', 'Société Alpha', 2380.25, 0]]);
    expect(FEC.rapport(r, 'FEC2026.txt').html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      .toContain('Ils viennent du journal RAN (« Reports à nouveau »), daté du 01/01/2026 : les à-nouveaux de ton ancien logiciel.');
  });

  it('un compte de tiers écrit avec des lettres se range sur son numéro ; un libellé entre guillemets garde son séparateur', () => {
    // Un logiciel sans comptes auxiliaires, repassé par un tableur (points-virgules, guillemets).
    const texte = [TETE.join(';'),
      'VT;Ventes;12;20251220;411DUPONT;Dupont SARL;;;F-12;20251220;"Facture; Dupont";238,000;0,000;;;20251220;;',
      'VT;Ventes;12;20251220;707;Ventes;;;F-12;20251220;"Facture; Dupont";0,000;200,000;;;20251220;;',
      'VT;Ventes;12;20251220;4367;TVA collectée;;;F-12;20251220;"Facture; Dupont";0,000;38,000;;;20251220;;'].join('\r\n');
    expect(FEC.decouper('VT;"Facture; ""Dupont""";15";', ';')).toEqual(['VT', 'Facture; "Dupont"', '15"', '']);
    const r = FEC.ouverture(FEC.lire(texte), '2026-01-01', KC);
    expect(r).toMatchObject({ ok: true, alpha: ['411DUPONT'], resultat: 200_000 });
    expect(vue(r)).toEqual([['4367', 'TVA collectée', '', 0, 38], ['411', 'Dupont SARL — non lettré', 'Dupont SARL', 238, 0], ['13', 'Résultat de l\'exercice 2025', '', 0, 200]]);
    expect(FEC.rapport(r, 'FEC.csv').html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      .toContain('1 compte de tiers écrit avec des lettres (« 411DUPONT ») est repris sur son numéro, au nom du tiers.');
  });

  it('l\'historique d\'une année : ses journaux devenus ceux de SkanFact, au millime ; les à-nouveaux et les autres années n\'entrent pas', () => {
    // Les codes d'Odoo : INV (ventes), BNK1 (banque), BILL (achats) ; OUV, ses à-nouveaux ; et un journal que rien ne dit.
    const odoo: L[] = EXERCICE_2025.map((l) => [...l] as L).map((l) => {
      l[0] = ({ OUV: 'OUV', VT: 'INV', BQ: 'BNK1', AC: 'BILL' } as Record<string, string>)[l[0]] ?? l[0];
      return l;
    });
    odoo.push(['XG', 'Journal du gérant', 'XG/2025/0004', '20251231', '6278', 'Frais bancaires', '', '', 'OD-4', 'Agios', '3,333', '0,000', ''],
      ['XG', 'Journal du gérant', 'XG/2025/0004', '20251231', '532', 'Banque BIAT', '', '', 'OD-4', 'Agios', '0,000', '3,333', '']);
    const conv = FEC.versLeLivre(FEC.lire(commeOdoo(odoo)), { du: '2025-01-01', au: '2025-12-31' });
    expect([conv.lignes, conv.ouverture, conv.dehors, conv.dehorsDu, conv.dehorsAu]).toEqual([15, 2, 3, '2026-01-05', '2026-01-05']);
    // « Opérations diverses » (MISC chez Odoo) est OD par son code, une banque par son seul libellé l'est aussi.
    expect(['MISC', 'BQ7', 'J12'].map((c, i) => FEC.journalDuLivre(c, ['', '', 'Banque Zitouna'][i] ?? ''))).toEqual([{ journal: 'OD', par: 'code' }, { journal: 'BQ', par: 'code' }, { journal: 'BQ', par: 'libelle' }]);
    expect(conv.journaux.map((j) => [j.code, j.journal, j.par, j.lignes])).toEqual([['INV', 'VT', 'code', 6], ['BNK1', 'BQ', 'code', 4], ['BILL', 'AC', 'code', 3], ['XG', 'OD', '', 2]]);
    // Le même texte que le tableur du livre : ses pièces, au millime, chacune juste, le client avec son nom.
    const a = KC.analyserImportEcritures(KC.livreVide('D', 2025, {}), conv.texte);
    expect(a.compte.nouvelles).toBe(6);
    expect(a.pieces.map((p) => [p.journal, p.piece, p.date, p.ecart])).toEqual([
      ['VT', 'FAC-2025-014', '2025-03-14', 0], ['BQ', 'VIR-88', '2025-04-02', 0], ['AC', 'FF-77', '2025-11-05', 0],
      ['BQ', 'REL-11', '2025-11-30', 0], ['VT', 'FAC-2025-102', '2025-12-20', 0], ['OD', 'OD-4', '2025-12-31', 0],
    ]);
    expect(a.pieces[0]?.lignes.map((l) => [l.compte, l.tiers, l.debit, l.credit])).toEqual([['411', 'Hôtel du Lac', 1191.001, 0], ['707', '', 0, 1000.001], ['4367', '', 0, 191]]);
    const html = FEC.rapportLivre(conv, { du: '2025-01-01', au: '2025-12-31' }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('Un FEC : 15 lignes du 01/01/2025 au 31/12/2025 entrent dans ce livre. Ses journaux deviennent ceux de SkanFact : INV « Ventes » → VT BNK1 « Banque » → BQ BILL « Achats » → AC XG « Journal du gérant » → OD (non reconnu : opérations diverses)');
    expect(html).toContain('2 lignes d\'à-nouveaux ne sont pas reprises ici : elles font la balance d\'ouverture (« Reprendre les soldes d\'ouverture »).');
    expect(html).toContain('3 lignes hors de l\'exercice (du 05/01/2026 au 05/01/2026) n\'entrent pas : ouvre le livre de leur année pour les reprendre.');
  });
});
