// 1.323.1 — Un instant (l'heure d'un geste, gardée en temps universel) se lit comme le jour de Tunis ; un jour de calendrier
// reste ce jour. Le rouge GitHub de 1.322.0 : à 23 h 30 en temps universel (0 h 30 le 8 novembre à Tunis), « Envoyé le
// 07/11/2026 ». Le fuseau du processus est changé le temps du test, puis rendu.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const C = ecranDeLaPlateforme('core.js') as { jourDeLInstant: (t: unknown) => string };
const KC = ecranDeLaPlateforme('compta.js') as { jourDeLInstant: (t: unknown) => string };

const dans = (fuseau: string, f: () => void) => {
  const avant = process.env.TZ;
  process.env.TZ = fuseau;
  try { f(); } finally { if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant; }
};

describe('le jour d\'un instant (1.323.1)', () => {
  it('0 h 30 le 8 novembre à Tunis est le 8, même si le temps universel dit encore le 7', () => {
    dans('Africa/Tunis', () => {
      expect(KC.jourDeLInstant('2026-11-07T23:30:00.000Z')).toBe('2026-11-08');
      expect(C.jourDeLInstant(Date.parse('2026-11-07T23:30:00Z'))).toBe('2026-11-08');
      expect(KC.jourDeLInstant('2026-11-07T22:59:59.000Z')).toBe('2026-11-07');
    });
  });

  it('un jour de calendrier reste ce jour, à l\'ouest comme à l\'est ; un instant vide ou illisible ne dit rien', () => {
    dans('America/Sao_Paulo', () => expect(KC.jourDeLInstant('2026-11-08')).toBe('2026-11-08'));
    dans('Asia/Tokyo', () => expect(KC.jourDeLInstant('2026-11-08')).toBe('2026-11-08'));
    expect([KC.jourDeLInstant(''), KC.jourDeLInstant(null), KC.jourDeLInstant('pas une date')]).toEqual(['', '', '']);
  });
});
