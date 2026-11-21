// Le FEC ne perd plus les tiers (1.378.3, issue 9 CABDECLARER-10). Un cabinet qui reprend ce fichier dans un autre
// logiciel a besoin du client de chaque ligne du 411 et du fournisseur de chaque ligne du 401. Sur un collectif nu
// (411, sans sous-compte), « CompAuxNum » et « CompAuxLib » partaient vides ; et « DateLet » restait vide même pour
// une ligne lettrée. Ce que la règle tient :
//   - un sous-compte (411001) est son propre auxiliaire ;
//   - sur un collectif nu, le code se tire du nom du tiers, et ne change pas d'un export à l'autre ;
//   - deux tiers au même début de nom ne se confondent pas ; un nom sans lettre latine prend son identifiant ;
//   - une ligne lettrée porte sa lettre ET sa date ; une ligne sans lettre ne porte ni l'une ni l'autre ;
//   - une ligne qui n'est pas un tiers (banque, ventes) garde ses deux colonnes vides.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiers?: string; tiersId?: string; lettre?: string; lettreLe?: string; libelle?: string };
type Ecr = { id: string; numero: number; date: string; journal: string; piece: string; libelle: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[] };
type LigneLue = Record<string, unknown>;
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  lignesDuLivre: (livre: Livre, o?: Record<string, unknown>) => LigneLue[];
  fecAuxDeTiers: () => (l: LigneLue) => { num: string; lib: string } | null;
  fichierFec: (lignes: LigneLue[], o: Record<string, unknown>) => { ok: boolean; texte: string };
  fecNom: (identifiant: string, fin: string) => string;
};

const ecr = (id: string, numero: number, date: string, journal: string, piece: string, lignes: Ligne[]): Ecr =>
  ({ id, numero, date, journal, piece, libelle: piece, statut: 'validee', lignes });

describe('le FEC porte le tiers et la date du lettrage', () => {
  it('le compte auxiliaire : un sous-compte tel quel, un collectif nu d\'après le nom, jamais deux tiers sous un code', () => {
    const aux = KC.fecAuxDeTiers();
    expect(aux({ account: '411001', tiers: 'Hôtel Dar Jerba' })).toEqual({ num: '411001', lib: 'Hôtel Dar Jerba' });
    expect(aux({ account: '411', tiers: 'Café Jasmin' })).toEqual({ num: '411CAFEJASMIN', lib: 'Café Jasmin' });
    // Le même tiers, la même réponse (majuscules et espaces près).
    expect(aux({ account: '411', tiers: ' café jasmin ' })?.num).toBe('411CAFEJASMIN');
    // Deux tiers au même début de nom (douze caractères gardés) : le second prend un chiffre.
    expect(aux({ account: '401', tiers: 'Minoterie du Cap Bon' })?.num).toBe('401MINOTERIEDUC');
    expect(aux({ account: '401', tiers: 'Minoterie du Centre' })?.num).toBe('401MINOTERIEDUC2');
    expect(aux({ account: '401', tiers: 'Minoterie du Cap Bon' })?.num).toBe('401MINOTERIEDUC');
    // Un nom sans lettre latine : son identifiant, sinon « TIERS ».
    expect(aux({ account: '411', tiers: 'مخبزة', tiersId: '0193-ab12-cd34ef56' })?.num).toBe('411CD34EF56');
    // Pas un compte de tiers, ou pas de tiers : rien.
    expect(aux({ account: '532', tiers: 'BIAT' })).toBeNull();
    expect(aux({ account: '411', tiers: '' })).toBeNull();
  });

  it('dans le fichier : le tiers dans ses deux colonnes, la lettre et sa date ensemble', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(
      ecr('f1', 1, '2026-10-02', 'VT', 'FAC-2026-001', [
        { compte: '411', debit: 600, credit: 0, tiers: 'Café Jasmin', lettre: 'A', lettreLe: '2026-11-03' }, { compte: '706', debit: 0, credit: 600 }]),
      ecr('r1', 2, '2026-10-20', 'BQ', 'VIR-1', [
        { compte: '532', debit: 600, credit: 0 }, { compte: '411', debit: 0, credit: 600, tiers: 'Café Jasmin', lettre: 'A', lettreLe: '2026-11-03' }]),
      ecr('f2', 3, '2026-10-25', 'VT', 'FAC-2026-002', [
        { compte: '411', debit: 80, credit: 0, tiers: 'Hôtel Dar Jerba' }, { compte: '706', debit: 0, credit: 80 }]),
    );
    const r = KC.fichierFec(KC.lignesDuLivre(livre), { identifiant: '1234567A', fin: '2026-12-31', aux: KC.fecAuxDeTiers(), nomCompte: (c: string) => (c === '411' ? 'Clients' : '') });
    expect(r.ok).toBe(true);
    const rangs = r.texte.trim().split('\r\n').map((x) => x.split('\t'));
    const tete = rangs[0] ?? [];
    const col = (n: string) => tete.indexOf(n);
    const vus = rangs.slice(1).map((x) => [x[col('CompteNum')], x[col('CompteLib')], x[col('CompAuxNum')], x[col('CompAuxLib')], x[col('EcritureLet')], x[col('DateLet')]].join('|'));
    expect(vus).toEqual([
      '411|Clients|411CAFEJASMIN|Café Jasmin|A|20261103',
      '706|||||',
      '532|||||',
      '411|Clients|411CAFEJASMIN|Café Jasmin|A|20261103',
      '411|Clients|411HOTELDARJERB|Hôtel Dar Jerba||',
      '706|||||',
    ]);
  });
  it('(issue 12, CABPORTEFEUILLE-18) le nom du fichier FEC garde les lettres accentuées d\'un nom sans matricule', () => {
    expect(KC.fecNom('Pâtisserie El Amal', '2026-12-31')).toBe('PATISSERIEELAMALFEC20261231.txt');
    expect(KC.fecNom('1234567A/M/000', '2026-12-31')).toBe('1234567AM000FEC20261231.txt');
  });
});
