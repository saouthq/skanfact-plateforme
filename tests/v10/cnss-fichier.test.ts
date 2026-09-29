// Le fichier de télédéclaration CNSS du trimestre (brique 49 ; docs/cabinet.md, C39), tel que l'écran
// de la PLATEFORME le fabrique (web/public/v10/compta.js, le moteur de la v10). Les tests du moteur de
// la v10 (test/suites/cnss-fichier.js), portés : le format est celui du document « Trace
// d'enregistrement du support magnétique des télédéclarations de salaires (nouvelle version 2012) » —
// 122 caractères par salarié, 12 lignes par page, le salaire en millimes. Chaque champ est à SA place
// et de SA longueur (les positions sont écrites ici à la main, depuis le document, jamais recopiées de
// la sortie), et AUCUN fichier ne sort tant qu'une ligne est fausse.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Ligne = { salarieId: string; nom: string; identite: string; cnss: string; cin: string; salaire: number };
type Fichier = { ok: boolean; nom: string; format: string; contenu: string; total: number; refus: { salarieId?: string; nom?: string; champ: string; motif: string }[]; avertissements: { champ: string; motif: string }[] };
const K = ecranDeLaPlateforme('compta.js') as {
  fichierCnss: (o: { employeur: string; code?: string; annee: number; trimestre: number; lignes: Ligne[] }) => Fichier;
  fichierCnssDuLivre: (livre: unknown, e: { matricule: string; code?: string }, annee: number, trimestre: number) => Fichier;
  lireMatriculeCnss: (s: string) => { ok: boolean; texte?: string; motif?: string };
  livreVide: (id: string, annee: number, o: Record<string, unknown>) => { salaries: unknown[]; bulletins: unknown[] };
  normaliserSalarie: (s: Record<string, unknown>, id: string) => unknown;
};

// Les positions du document, champ par champ (début, longueur).
const CHAMPS: [string, number, number][] = [
  ['employeur', 0, 8], ['cleEmployeur', 8, 2], ['code', 10, 4], ['trimestre', 14, 1], ['annee', 15, 4],
  ['page', 19, 3], ['ligne', 22, 2], ['assure', 24, 8], ['cleAssure', 32, 2], ['identite', 34, 60],
  ['cin', 94, 8], ['salaire', 102, 10], ['vierge', 112, 10],
];
const lire = (rec: string) => Object.fromEntries(CHAMPS.map(([k, d, n]) => [k, rec.slice(d, d + n)]));
const enregistrements = (r: Fichier) => r.contenu.split('\r\n').slice(0, -1);
const ligne = (n: number, o: Partial<Ligne> = {}): Ligne => ({ salarieId: `s${n}`, nom: `Salarié ${n}`, identite: `Prenom Pere Nom${String.fromCharCode(65 + (n % 26))}`,
  cnss: `1234567${n % 10}-0${n % 10}`, cin: `0${1000000 + n}`, salaire: 1000, ...o });

describe('le fichier CNSS du trimestre, fabriqué par l\'écran de la plateforme', () => {
  it('l\'exemple du document donne son nom de fichier, et chaque champ tombe à sa place', () => {
    const r = K.fichierCnss({ employeur: '123456-72', code: '06', annee: 2010, trimestre: 1,
      lignes: [{ salarieId: 'a', nom: 'Sonia', identite: 'Sonia Mohamed Khélifi', cnss: '12345678-90', cin: '01234567', salaire: 3600.5 }] });
    expect(r.ok, JSON.stringify(r.refus)).toBe(true);
    expect(r.nom).toBe('DS00123456720006.12010');
    expect(r.format).toBe('CNSS 2012');
    const recs = enregistrements(r);
    expect(recs.map((x) => x.length)).toEqual([122]);
    expect(lire(recs[0] ?? '')).toEqual({
      employeur: '00123456', cleEmployeur: '72', code: '0006', trimestre: '1', annee: '2010', page: '001', ligne: '01', assure: '12345678', cleAssure: '90',
      identite: 'SONIA MOHAMED KHELIFI'.padEnd(60, ' '), cin: '01234567', salaire: '0003600500', vierge: ' '.repeat(10),
    });
    expect(r.total).toBe(3600.5);
    expect(r.avertissements).toEqual([]);
  });

  it('exactement 12 lignes par page, pages et lignes consécutives, chaque ligne finie par un retour chariot, en ASCII', () => {
    const r = K.fichierCnss({ employeur: '7654321-01', annee: 2026, trimestre: 3, lignes: Array.from({ length: 25 }, (_, i) => ligne(i + 1)) });
    expect(r.ok, JSON.stringify(r.refus)).toBe(true);
    expect(r.contenu.endsWith('\r\n') && !/[^\r]\n/.test(r.contenu)).toBe(true);
    const pl = enregistrements(r).map((x) => { const c = lire(x); return `${c.page}/${c.ligne}`; });
    expect(pl.slice(0, 13)).toEqual(['001/01', '001/02', '001/03', '001/04', '001/05', '001/06', '001/07', '001/08', '001/09', '001/10', '001/11', '001/12', '002/01']);
    expect([pl[23], pl[24], new Set(pl).size]).toEqual(['002/12', '003/01', 25]);
    expect(enregistrements(r).every((x) => x.length === 122 && lire(x).code === '0000')).toBe(true);
    expect([...r.contenu].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(r.total).toBe(25000);
  });

  it('le salaire en millimes entiers, sans virgule, arrondi au millime', () => {
    const r = K.fichierCnss({ employeur: '123456-72', annee: 2026, trimestre: 2, lignes: [ligne(1, { salaire: 1234.5675 }), ligne(2, { salaire: 0.1 + 0.2 })] });
    expect(enregistrements(r).map((x) => lire(x).salaire)).toEqual(['0001234568', '0000000300']);
  });

  it('un matricule se lit « 123456-72 » ou en chiffres collés, et sa forme se vérifie', () => {
    expect(K.lireMatriculeCnss('123456-72').texte).toBe('0012345672');
    expect(K.lireMatriculeCnss('1234567290').texte).toBe('1234567290');
    expect(K.lireMatriculeCnss('12345672').texte).toBe('0012345672');
    expect(K.lireMatriculeCnss('').ok).toBe(false);
    expect(K.lireMatriculeCnss('123456789-01').ok).toBe(false);
    expect(K.lireMatriculeCnss('12A456-72').ok).toBe(false);
  });

  it('aucun fichier tant qu\'une ligne est fausse, et chaque refus nomme le salarié et sa case ; sans matricule, le refus le nomme', () => {
    const r = K.fichierCnss({ employeur: '123456-72', annee: 2026, trimestre: 3, lignes: [
      ligne(1), ligne(2, { nom: 'Karim', cnss: '' }), ligne(3, { nom: 'Sonia', identite: 'سنية الخليفي' }), ligne(4, { nom: 'Amine', cin: '1234567' }), ligne(5, { nom: 'Leila', salaire: -10 }),
    ] });
    expect([r.ok, r.contenu, r.nom]).toEqual([false, '', '']);
    expect(r.refus.map((x) => [x.salarieId, x.champ])).toEqual([['s2', 'cnss'], ['s3', 'identite'], ['s4', 'cin'], ['s5', 'salaire']]);
    const sans = K.fichierCnss({ employeur: '', code: 'AB', annee: 2026, trimestre: 1, lignes: [ligne(1)] });
    expect(sans.refus.map((x) => x.champ)).toEqual(['employeur', 'code']);
    expect(sans.refus[0]?.motif).toMatch(/matricule CNSS de l'employeur manque/);
    expect(K.fichierCnss({ employeur: '123456-72', annee: 2026, trimestre: 1, lignes: [] }).refus[0]?.champ).toBe('lignes');
  });

  it('le fichier se tire du livre : l\'assiette du trimestre, l\'identité et le CIN de la fiche du salarié', () => {
    const L = K.livreVide('D', 2026, {});
    L.salaries.push(K.normaliserSalarie({ nom: 'Sonia Khelifi', identiteCnss: 'Sonia Ali Khelifi', cin: '07654321', cnss: '12345678-90', embauche: '2026-01-01', brut: 1000 }, 'S1'));
    L.bulletins.push({ id: 'b7', salarieId: 'S1', annee: 2026, mois: 7, calcul: { cnssBase: 1000 } },
      { id: 'b8', salarieId: 'S1', annee: 2026, mois: 8, calcul: { cnssBase: 1200 } },
      { id: 'b4', salarieId: 'S1', annee: 2026, mois: 4, calcul: { cnssBase: 999 } });
    const r = K.fichierCnssDuLivre(L, { matricule: '123456-72', code: '' }, 2026, 3);
    expect(r.ok, JSON.stringify(r.refus)).toBe(true);
    expect(r.nom).toBe('DS00123456720000.32026');
    const c = lire(enregistrements(r)[0] ?? '');
    expect([c.salaire, c.identite?.trim(), c.cin]).toEqual(['0002200000', 'SONIA ALI KHELIFI', '07654321']);
    expect(K.fichierCnssDuLivre(L, { matricule: '' }, 2026, 3).refus[0]?.champ).toBe('employeur');
  });
});
