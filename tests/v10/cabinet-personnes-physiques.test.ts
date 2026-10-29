// (1.175.0, maquette des Échéances) Les personnes physiques déposent leur déclaration mensuelle à leur jour — le 15, dit
// l'usage (À VÉRIFIER), réglable —, les sociétés au leur (le 28). Le moteur du Cabinet (cabcore.js) en fait deux échéances
// à leur date, la Déclaration d'un dossier dit la même date que le calendrier, et un même jour réglé pour tous n'en fait
// qu'une. Le moteur est lu tel que le navigateur le reçoit, dans un bac à sable.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ICI = path.dirname(new URL(import.meta.url).pathname);
type Echeance = { id: string; label: string; date: string; restants: string[]; physiques?: boolean };
type Moteur = {
  echeances: (etat: object, jour: string, opts: object) => Echeance[];
  dateLimiteDeclaration: (etat: object, mois: string, sorte: string, dossier?: object) => string;
  personnePhysique: (etat: object, dossier: object) => boolean;
  migrate: (etat: object) => { settings: { deadlines: Record<string, number> } };
};
const bac: { CabCore?: Moteur } = {};
vm.createContext(bac);
vm.runInContext(fs.readFileSync(path.join(ICI, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
const K = bac.CabCore as Moteur;

describe('les personnes physiques à leur jour de dépôt', () => {
  // Trois dossiers tenus depuis mai : une SARL, un médecin (personne physique par sa forme), un artisan (par son régime).
  const dossiers = [
    { id: 's', name: 'SARL Mansour', manual: true, from: '2026-05', forme: 'SARL' },
    { id: 'm', name: 'Dr Yasmine', manual: true, from: '2026-05', forme: 'Personne physique' },
    { id: 'a', name: 'Atelier Hédi', manual: true, from: '2026-05', regime: 'pp' },
  ];
  const regimes = [{ id: 'pp', label: 'Réel, personne physique', tva: 'mensuelle' }];
  const opts = { tenus: {}, declares: {} };
  const septembre = (l: Echeance[]) => l.filter((e) => e.id === 'tva-m' && /septembre/.test(e.label));

  it('deux échéances pour septembre : les personnes physiques le 15/10, les autres le 28/10 ; chacune ses dossiers', () => {
    const etat = { dossiers, settings: { regimes } };
    const l = septembre(K.echeances(etat, '2026-10-29', opts));
    expect(l.map((e) => [e.date, e.restants.slice().sort()])).toEqual([
      ['2026-10-15', ['Atelier Hédi', 'Dr Yasmine']],
      ['2026-10-28', ['SARL Mansour']],
    ]);
    expect(l[0]?.physiques).toBe(true);
    expect(l[0]?.label).toMatch(/personnes physiques/);
    expect(l[1]?.physiques).toBeUndefined();
    // La Déclaration d'un dossier dit la même date que le calendrier.
    expect(K.dateLimiteDeclaration(etat, '2026-09', 'tva', dossiers[1])).toBe('2026-10-15');
    expect(K.dateLimiteDeclaration(etat, '2026-09', 'tva', dossiers[0])).toBe('2026-10-28');
  });

  it('le jour se règle ; réglé comme celui de tous, il n\'y a plus qu\'une échéance', () => {
    const vingt = septembre(K.echeances({ dossiers, settings: { regimes, deadlines: { tvaDay: 28, cnssDay: 15, tvaDayPP: 20 } } }, '2026-10-29', opts));
    expect(vingt.map((e) => e.date)).toEqual(['2026-10-20', '2026-10-28']);
    const une = septembre(K.echeances({ dossiers, settings: { regimes, deadlines: { tvaDay: 28, cnssDay: 15, tvaDayPP: 28 } } }, '2026-10-29', opts));
    expect(une.map((e) => [e.date, e.restants.length])).toEqual([['2026-10-28', 3]]);
  });

  it('une forme qui n\'est pas « personne physique » ne l\'est pas ; un réglage aberrant retombe sur le 15', () => {
    expect(K.personnePhysique({ settings: {} }, { forme: 'SUARL' })).toBe(false);
    expect(K.personnePhysique({ settings: {} }, { forme: 'personne  physique' })).toBe(true);
    expect(K.migrate({ settings: { deadlines: { tvaDay: 28, cnssDay: 15, tvaDayPP: 40 } } }).settings.deadlines.tvaDayPP).toBe(15);
  });
});
