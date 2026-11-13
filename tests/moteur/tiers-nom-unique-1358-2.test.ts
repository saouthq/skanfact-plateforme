// Le tiers d'une ligne connu par son seul nom (1.358.2) : les à-nouveaux d'un client écrits avant que la ligne ait sa case
// (0210) portent son nom ; son règlement de janvier porte son identifiant. Un nom que porte UN seul tiers le désigne ; deux
// tiers du même nom, et la ligne garde son nom seul (un rapprochement faux ferme la question, 9.5.0).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const KC = ecranDeLaPlateforme('compta.js') as {
  tiersParNomUnique: (paires: [unknown, unknown][]) => (nom: unknown) => string | null;
};

describe('le tiers connu par son seul nom', () => {
  it('un nom que porte un seul tiers le désigne ; deux homonymes, et le nom reste seul', () => {
    const parSonNom = KC.tiersParNomUnique([
      ['Hôtel Mouradi Gammarth', 'id-hotel'],
      [' Hôtel Mouradi Gammarth ', 'id-hotel'],
      ['Ben Salah', 'id-1'],
      ['Ben Salah', 'id-2'],
      ['', 'id-vide'],
      ['Sans identifiant', null],
    ]);
    expect(parSonNom('Hôtel Mouradi Gammarth')).toBe('id-hotel');
    expect(parSonNom(' Hôtel Mouradi Gammarth')).toBe('id-hotel');
    expect(parSonNom('Ben Salah')).toBeNull();
    expect(parSonNom('Sans identifiant')).toBeNull();
    expect(parSonNom('')).toBeNull();
    expect(parSonNom('Inconnu')).toBeNull();
  });
});
