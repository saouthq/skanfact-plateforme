// (1.387.21) Le bulletin imprimé au Cabinet disait « Établi le 16/11/2026 » pour un bulletin validé le 31/10 : la fiche
// envoyée au client prenait la date du jour de l'envoi. Un bulletin validé est établi le jour de sa validation.
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { lireEcran } from '../../commun/assemblage.ts';

const source = lireEcran('plateforme/pont-cabinet.js');
const debut = source.indexOf('const fichePayeDe = ');
const fin = source.indexOf('\n  });', debut);
const corps = source.slice(debut, fin + 6);

type Fiche = (b: Record<string, unknown>, avant: Record<string, unknown>) => { issuedAt: string };
const fichePayeDe = (): Fiche => {
  // Le jour de Tunis du pont (vérification du Cabinet, 25/11/2026), lu dans la même source.
  const i = source.indexOf('const jourDeTunis = ');
  const jourDeTunis = vm.runInNewContext(`(${source.slice(i + 'const jourDeTunis = '.length, source.indexOf(';\n', i))})`) as (q?: unknown) => string;
  const ctx: { sansAccordSiChange: () => object; jourDeTunis: typeof jourDeTunis; f?: Fiche } = { sansAccordSiChange: () => ({}), jourDeTunis };
  vm.runInNewContext(`${corps}; this.f = fichePayeDe;`, ctx);
  return ctx.f as Fiche;
};

describe('le bulletin du Cabinet porte la date de sa validation (1.387.21)', () => {
  it('validé le 31/10 : établi le 31/10, quel que soit le jour de l\'envoi', () => {
    expect(corps.length).toBeGreaterThan(200);
    expect(corps.length).toBeLessThan(1200);
    const f = fichePayeDe();
    const b = { id: 'b1', salarieId: 's1', annee: 2026, mois: 10, calcul: { net: 1 }, valideLe: '2026-10-31T17:02:00Z' };
    expect(f(b, { issuedAt: '2026-11-16' }).issuedAt).toBe('2026-10-31');
  });
  it('validé le 31/10 à 23 h 30 UTC : c\'est le 1er novembre à Tunis, le jour qu\'il porte', () => {
    const f = fichePayeDe();
    expect(f({ id: 'b1', calcul: {}, valideLe: '2026-10-31T23:30:00Z' }, {}).issuedAt).toBe('2026-11-01');
  });
  it('pas encore validé : la date déjà connue reste', () => {
    const f = fichePayeDe();
    expect(f({ id: 'b1', calcul: {} }, { issuedAt: '2026-10-28' }).issuedAt).toBe('2026-10-28');
  });
});
