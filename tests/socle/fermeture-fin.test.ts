// L'heure du retour d'une maintenance (serveur/fermeture.ts, finDite ; 0164) : à Tunis, l'heure seule le jour même, et
// son jour quand la fin passe minuit (vu sur GitHub le 22/10/2026 : un essai lancé à 23 h 03, fini à 0 h 03).

import { describe, expect, it } from 'vitest';
import { finDite } from '../../serveur/fermeture.ts';

describe('l\'heure du retour d\'une maintenance', () => {
  it('le jour même, l\'heure seule ; passé minuit à Tunis, le jour et l\'heure', () => {
    // 21 h 03 UTC = 22 h 03 à Tunis (UTC+1, sans heure d'été).
    expect(finDite('2026-10-22T22:03:00Z', new Date('2026-10-22T21:03:00Z'))).toBe('23 h 03');
    // 22 h 03 UTC (23 h 03 à Tunis) → fin 23 h 03 UTC, 0 h 03 le 23 à Tunis.
    expect(finDite('2026-10-22T23:03:00Z', new Date('2026-10-22T22:03:00Z'))).toBe('23/10/2026 à 0 h 03');
    // Le même jour en UTC, mais pas à Tunis : c'est Tunis qui compte.
    expect(finDite('2026-10-22T23:30:00Z', new Date('2026-10-22T00:10:00Z'))).toBe('23/10/2026 à 0 h 30');
  });
});
