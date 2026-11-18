// (1.387.14, issue 10, CABPAIE-30) Le fichier CNSS : un salarié dont le n° CNSS et le CIN sont faux paraissait DEUX fois
// dans la liste des corrections, avec deux boutons qui ouvrent la même fiche. Le moteur range les refus par salarié ;
// un refus qui ne vise personne (le code d'exploitation) reste seul.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Groupe = { salarieId: string; nom: string; champ: string; champs: string[]; motifs: string[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  fichierCnss: (o: unknown) => { ok: boolean; refus: { champ: string }[]; refusParSalarie: Groupe[] };
};

describe('le fichier CNSS range ses refus par salarié', () => {
  it('deux refus du même salarié font UNE ligne, dans leur ordre ; un autre salarié et le code restent à part', () => {
    const f = KC.fichierCnss({
      employeur: '12345678-90', code: 'AB', annee: 2026, trimestre: 4,
      lignes: [
        { salarieId: 's1', nom: 'Hédi Ben Salem', identite: 'Hedi Ali Ben Salem', cnss: 'abc', cin: '12', salaire: 4950 },
        { salarieId: 's2', nom: 'Amel Trabelsi', identite: 'Amel Mohamed Trabelsi', cnss: '87654321-01', cin: '99', salaire: 2940 }
      ]
    });
    expect(f.ok).toBe(false);
    expect(f.refus.length).toBe(4);
    expect(f.refusParSalarie.map(g => [g.salarieId, g.champs.join('+')])).toEqual([['', 'code'], ['s1', 'cnss+cin'], ['s2', 'cin']]);
    expect(f.refusParSalarie[1]?.motifs.length).toBe(2);
    expect(f.refusParSalarie[1]?.nom).toBe('Hédi Ben Salem');
  });
});
