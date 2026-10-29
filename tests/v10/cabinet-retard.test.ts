// Le chiffre des Échéances dans la barre du Cabinet (1.167.0 ; maquettes de « Mon cabinet », 28/10/2026) : les
// déclarations EN RETARD, dossier par dossier — une date passée dont la déclaration n'est pas déposée. Une déclaration
// déposée ne compte plus, une date à venir pas encore. Le moteur du Cabinet (cabcore.js) est lu tel que le navigateur
// le reçoit, dans un bac à sable.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ICI = path.dirname(new URL(import.meta.url).pathname);
type Retard = { label: string; dossier: string; jours: number };
const bac: { CabCore?: { echeances: (etat: object, jour: string, opts: object) => unknown[]; enRetard: (l: unknown[]) => Retard[] } } = {};
vm.createContext(bac);
vm.runInContext(fs.readFileSync(path.join(ICI, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
const K = bac.CabCore as NonNullable<typeof bac.CabCore>;

describe('les déclarations en retard (le chiffre des Échéances)', () => {
  // Deux dossiers tenus au cabinet depuis mai : le garage a déposé août et septembre, le café septembre seulement.
  const etat = { dossiers: [{ id: 'a', name: 'Garage A', manual: true, from: '2026-05' }, { id: 'b', name: 'Café B', manual: true, from: '2026-05' }], settings: {} };
  const opts = { tenus: {}, declares: { a: ['2026-08', '2026-09'], b: ['2026-09'] } };

  it('une date passée sans dépôt compte, dossier par dossier ; une déclaration déposée ou à venir, jamais', () => {
    const retard = K.enRetard(K.echeances(etat, '2026-10-29', opts));
    const ligne = (label: string) => retard.filter((x) => x.label === label).map((x) => x.dossier);
    expect(ligne('TVA d\'août 2026')).toEqual(['Café B']);
    expect(ligne('TVA de septembre 2026')).toEqual([]);
    expect(ligne('TVA de juillet 2026')).toEqual(['Garage A', 'Café B']);
    expect(retard.every((x) => x.jours > 0)).toBe(true);
    expect(retard.find((x) => x.label === 'TVA d\'août 2026' && x.dossier === 'Café B')?.jours).toBe(31);
    // Le 10 octobre, la CNSS du 3e trimestre (le 15) n'est pas encore en retard ; la TVA d'août (le 28/09) l'est.
    const avant = K.enRetard(K.echeances(etat, '2026-10-10', opts));
    expect(avant.some((x) => /3ᵉ trimestre/.test(x.label))).toBe(false);
    expect(avant.filter((x) => x.label === 'TVA d\'août 2026').map((x) => x.dossier)).toEqual(['Café B']);
  });
});
