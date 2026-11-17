// « D'où ça vient » : les pièces d'une case de la déclaration, avec leurs montants (1.378.7 ; issue 9, CABDECLARER-23).
// La liste donnait la date, le journal, la pièce et le libellé — pas de base ni de taxe : on ne pouvait pas recompter
// la TVA due. Chaque pièce dit ce qu'elle met dans la case ; le total ne se rend que s'il retombe sur la case.

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number };
type Ecr = { id: string; numero: number; date: string; journal: string; piece: string; libelle: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[] };
type Case = { montant: number | null; ecritures: string[] };
type Detail = { lignes: { id: string; piece: string; base: number | null; montant: number | null }[]; base: number | null; montant: number | null; juste: boolean };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  declarationMensuelle: (l: Livre, p: string) => { cases: Record<string, Case> };
  piecesDeCase: (l: Livre, cle: string, c: Case) => Detail;
};
const piece = (id: string, numero: number, date: string, journal: string, lignes: [string, number, number][]): Ecr =>
  ({ id, numero, date, journal, piece: `P-${numero}`, libelle: `Pièce ${numero}`, statut: 'validee', lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });

describe('les pièces d\'une case de la déclaration disent leurs montants', () => {
  const livre = KC.livreVide('d1', 2026);
  livre.ecritures.push(
    piece('v1', 1, '2026-10-05', 'VT', [['411', 119, 0], ['706', 0, 100], ['4367', 0, 19]]),
    piece('v2', 2, '2026-10-20', 'VT', [['411', 238, 0], ['706', 0, 200], ['4367', 0, 38]]),
    piece('a1', 3, '2026-10-22', 'AC', [['606', 50, 0], ['4366', 9.5, 0], ['401', 0, 59.5]]),
  );
  const cases = KC.declarationMensuelle(livre, '2026-10').cases;

  it('la TVA collectée : la base et la taxe de chaque pièce, et un total qui retombe sur la case', () => {
    const d = KC.piecesDeCase(livre, 'tvaCollectee', cases.tvaCollectee as Case);
    expect(d.lignes.map((l) => [l.piece, l.base, l.montant])).toEqual([['P-1', 100, 19], ['P-2', 200, 38]]);
    expect([d.base, d.montant, d.juste]).toEqual([300, 57, true]);
    expect((cases.tvaCollectee as Case).montant).toBe(57);
  });

  it('la TVA déductible : la base de l\'achat et sa taxe', () => {
    const d = KC.piecesDeCase(livre, 'tvaDeductible', cases.tvaDeductible as Case);
    expect(d.lignes.map((l) => [l.piece, l.base, l.montant])).toEqual([['P-3', 50, 9.5]]);
    expect([d.base, d.montant]).toEqual([50, 9.5]);
  });

  it('un total qui ne retombe pas sur la case ne s\'affiche pas', () => {
    const d = KC.piecesDeCase(livre, 'tvaCollectee', { montant: 60, ecritures: ['v1', 'v2'] });
    expect([d.base, d.montant, d.juste]).toEqual([null, null, false]);
    expect(d.lignes.length).toBe(2);
  });

  it('l\'écran pose les colonnes et le pied, et le vieil écran « Les paquets reçus » a quitté le menu', () => {
    const app = fs.readFileSync('modules/socle/ecrans/cabinet/app-1.js', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(app).toContain('KC.piecesDeCase(livresState.livre, cle, c)');
    expect(app).toContain('<th class="r nw">Base HT</th>');
    expect(app).not.toContain('label: \'Les paquets reçus\'');
  });
});
