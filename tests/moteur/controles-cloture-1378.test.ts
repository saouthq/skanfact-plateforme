// Les contrôles avant clôture et les déclarations (1.378.5 ; issue 9, CABDECLARER-24). Le 16 novembre, l'écran de
// l'exercice réclamait « 1 mois sans déclaration préparée (novembre) » — un mois qui n'est pas fini — et disait
// « rien à signaler » d'octobre, déposé sans que son écriture de TVA soit au livre. Ce que la règle tient :
//   - le mois en cours (et les suivants) ne se réclame pas ; un mois fini sans déclaration, si ;
//   - un mois déposé dont l'écriture de déclaration manque au livre est nommé ;
//   - un mois déposé qui n'a rien à écrire (aucune TVA) ne l'est pas.

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiers?: string };
type Ecr = { id: string; numero: number; date: string; journal: string; piece: string; libelle: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[]; declarations: unknown[] };
type Controle = { id: string; ok: boolean; detail: string };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  controlesCloture: (livre: Livre, o?: Record<string, unknown>) => Controle[];
};

const vente = (id: string, numero: number, date: string): Ecr => ({
  id, numero, date, journal: 'VT', piece: `FAC-${numero}`, libelle: 'Vente', statut: 'validee',
  lignes: [{ compte: '411', debit: 119, credit: 0, tiers: 'Café Jasmin' }, { compte: '706', debit: 0, credit: 100 }, { compte: '4367', debit: 0, credit: 19 }],
});
const de = (cs: Controle[], id: string) => cs.find((c) => c.id === id) as Controle;

describe('les contrôles avant clôture regardent les déclarations comme un comptable', () => {
  it('le mois en cours ne se réclame pas ; un mois fini sans déclaration, si', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(vente('v1', 1, '2026-10-12'), vente('v2', 2, '2026-11-05'));
    const tva = de(KC.controlesCloture(livre, { aujourdhui: '2026-11-16' }), 'tva');
    expect(tva.ok).toBe(false);
    expect(tva.detail).toBe('1 mois sans déclaration préparée (octobre 2026). Prépare-les dans l\'onglet Déclaration.');
    // Décembre venu, novembre est fini : il se réclame à son tour.
    expect(de(KC.controlesCloture(livre, { aujourdhui: '2026-12-02' }), 'tva').detail).toContain('2 mois sans déclaration préparée (octobre 2026, novembre 2026)');
  });

  it('un mois déposé sans son écriture de déclaration est nommé ; un mois déposé sans TVA ne l\'est pas', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(vente('v1', 1, '2026-10-12'));
    livre.declarations.push(
      { type: 'mensuelle', periode: '2026-09', deposee: { le: '2026-10-20' } },
      { type: 'mensuelle', periode: '2026-10', deposee: { le: '2026-11-16' } },
    );
    const d = de(KC.controlesCloture(livre, { aujourdhui: '2026-11-16' }), 'declarations');
    expect(d.ok).toBe(false);
    expect(d.detail).toBe('1 mois déposé n\'a pas son écriture de déclaration au livre : octobre 2026. Écris-la dans l\'onglet Déclaration.');
    // Sans octobre déposé, rien à dire.
    livre.declarations.pop();
    expect(de(KC.controlesCloture(livre, { aujourdhui: '2026-11-16' }), 'declarations').ok).toBe(true);
  });

  it('l\'écran donne la date du jour au contrôle (sans elle, le mois en cours se réclame encore)', () => {
    const pont = fs.readFileSync('web/public/plateforme/pont-cabinet.js', 'utf8');
    expect(pont).toMatch(/controlesCloture\(livre, \{ aujourdhui: .*CabCore\.today\(\) \}\)/);
  });
});
