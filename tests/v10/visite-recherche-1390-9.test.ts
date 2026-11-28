// (1.390.9, issue 12, CP-24) Une étape « à regarder » posée sur une barre de filtres disait « Remplis la case éclairée si
// tu as l'information » : la seule case de la barre était la recherche, qui n'est pas une information à donner. Le moteur
// ne déduit plus de consigne d'une case de recherche ; une vraie case, si.
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const code = fs.readFileSync('web/public/v10/visite.js', 'utf8');
const corps = (nom: string) => { const i = code.indexOf(`function ${nom}(`); return code.slice(i, code.indexOf('\n  }\n', i) + 4); };
const caseDe = vm.runInNewContext(`${corps('caseDe')}; caseDe`) as (el: unknown) => unknown;
type Faux = { tagName: string; type?: string; matches: (s: string) => boolean; closest: () => null; querySelectorAll?: () => Faux[] };
const champ = (type: string): Faux => ({ tagName: 'INPUT', type, matches: () => false, closest: () => null });
const barre = (cases: Faux[]): Faux => ({ tagName: 'DIV', matches: () => false, closest: () => null, querySelectorAll: () => cases });

describe('la consigne d\'une case, dans une visite', () => {
  it('une barre de filtres dont la seule case est la recherche n\'a pas de case à remplir ; une vraie case en a une', () => {
    const recherche = champ('search');
    expect(caseDe(recherche)).toBeNull();
    expect(caseDe(barre([recherche]))).toBeNull();
    const texte = champ('text');
    expect(caseDe(texte)).toBe(texte);
    expect(caseDe(barre([texte]))).toBe(texte);
  });
});

// (1.390.9, CP-24) Deux étapes des visites du Cabinet parlaient de ce que l'écran ne montrait pas.
const visites = fs.readFileSync('modules/socle/visites/cabvisites.js', 'utf8');
const etape = (titre: string) => {
  const i = visites.indexOf(`titre: '${titre}'`);
  expect(i, titre).toBeGreaterThan(0);
  const debut = visites.lastIndexOf('{ page:', i);
  return visites.slice(debut, visites.indexOf('},', i) + 2);
};
describe('les visites du Cabinet ne parlent que de ce qui est à l\'écran', () => {
  it('« Ce qui attend » éclaire les trois visages du haut de la fiche, jamais les quatre chiffres', () => {
    const e = etape('Ce qui attend');
    for (const id of ['#fd-at', '#fd-bv', '#fd-ok']) expect(e).toContain(`'${id}'`);
    expect(e).not.toContain('.fd-ch');
  });
  it('« Le travail de qui » ne paraît que si la production montre le choix de l\'équipe', () => {
    const e = etape('Le travail de qui');
    expect(e).toMatch(/si: \(\) => !!document\.querySelector\('\.tb-qui'\)/);
    expect(etape('Resserrer')).not.toMatch(/équipe|Tout le cabinet/);
  });
});
