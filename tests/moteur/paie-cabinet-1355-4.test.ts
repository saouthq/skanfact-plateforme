// La Paie du Cabinet s'ouvre sur le mois TERMINÉ dont un salarié attend encore son bulletin (1.355.4 ; docs/revue-modules.md,
// « 1.355.4 »). Elle s'ouvrait sur le mois en cours : un salarié embauché le 1er octobre, lu le 11 novembre, laissait octobre
// sans bulletin derrière une page de novembre — la règle de l'app entreprise (`moisDePaie`), jamais portée au Cabinet.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Livre = { salaries?: unknown[]; bulletins?: unknown[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  moisPaieEnRetard: (livre: Livre, annee: number, aujourdhui: string) => number;
};

const hedi = { id: 's1', nom: 'Hédi Mansouri', embauche: '2026-10-01', actif: true };

describe('la paie du Cabinet s\'ouvre sur le mois qui attend son bulletin', () => {
  it('un salarié embauché le 1er octobre, sans bulletin, lu le 11 novembre : octobre', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.salaries = [hedi];
    expect(KC.moisPaieEnRetard(livre, 2026, '2026-11-11')).toBe(10);
  });

  it('son bulletin d\'octobre fait : rien n\'attend, l\'écran garde sa règle d\'avant', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.salaries = [hedi];
    livre.bulletins = [{ id: 'b10', salarieId: 's1', annee: 2026, mois: 10, calcul: { gross: 1000, net: 839.704 } }];
    expect(KC.moisPaieEnRetard(livre, 2026, '2026-11-11')).toBe(0);
  });

  it('le mois en cours n\'est jamais réclamé, ni un mois avant l\'embauche', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.salaries = [hedi];
    // Le 15 octobre : le mois terminé est septembre, et Hédi n'y était pas encore.
    expect(KC.moisPaieEnRetard(livre, 2026, '2026-10-15')).toBe(0);
    // En janvier : l'exercice regardé (2026) est fini, son dernier mois est décembre.
    expect(KC.moisPaieEnRetard(livre, 2026, '2027-01-08')).toBe(12);
    // Un exercice qui n'a pas commencé ne réclame rien.
    expect(KC.moisPaieEnRetard(livre, 2027, '2026-11-11')).toBe(0);
  });

  it('un salarié retiré du dossier n\'est plus attendu', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.salaries = [{ ...hedi, actif: false }];
    expect(KC.moisPaieEnRetard(livre, 2026, '2026-11-11')).toBe(0);
  });
});
