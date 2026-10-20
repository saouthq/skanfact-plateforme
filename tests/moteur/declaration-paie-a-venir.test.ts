// La TFP et le FOPROLOS d'un mois dont la paie n'est pas encore faite (1.82.0 ; docs/recette.md, « 1.82.0 »). La déclaration
// d'octobre disait « aucun compte du plan ne la porte » d'un dossier dont septembre la donnait au millime : ce qui manque,
// c'est la paie du mois, et l'écran mène à la paie (`attente`). Un dossier sans paie tenue garde la règle à vérifier.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Case = { montant: number | null; motif?: string; attente?: string };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => { bulletins?: unknown[] };
  declarationMensuelle: (livre: unknown, periode: string) => { cases: Record<string, Case> };
};

describe('la TFP et le FOPROLOS d\'un mois sans paie encore', () => {
  it('une paie tenue, rien sur ce mois : la case attend la paie, sans prétendre qu\'aucun compte ne la porte', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.bulletins = [{ annee: 2026, mois: 9, ecritureId: 'e9', calcul: { tfp: 25.015, foprolos: 12.508 } }];
    const { cases } = KC.declarationMensuelle(livre, '2026-10');
    expect(cases.tfp).toEqual({ montant: null, ecritures: [], motif: 'Pas encore de paie sur ce mois : la TFP se lira sur ses bulletins dès qu\'elle sera faite.', attente: 'paie' });
    expect(cases.foprolos?.motif).toBe('Pas encore de paie sur ce mois : le FOPROLOS se lira sur ses bulletins dès qu\'elle sera faite.');
  });

  it('un dossier sans aucune paie tenue garde la règle à vérifier', () => {
    const { cases } = KC.declarationMensuelle(KC.livreVide('d2', 2026), '2026-10');
    expect(cases.tfp?.motif).toMatch(/À VÉRIFIER avec le comptable\.$/);
    expect(cases.tfp?.attente).toBeUndefined();
  });
});
