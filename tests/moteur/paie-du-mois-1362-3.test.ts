// Les salariés qu'un mois attend (1.362.3, bout en bout 27). Le contrôle des bulletins manquants jugeait sur le 28 du mois
// seul : une entrée le 30 ou une sortie le 15 n'avaient pas leur bulletin réclamé ce mois-là. Et l'écran du Cabinet, quand
// rien ne manquait, retombait sur « tous les salariés en poste » : janvier réclamait le bulletin d'une embauche d'octobre.
// `salariesDuMois` est la règle unique : le contrat couvre au moins un jour du mois.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Livre = { salaries?: unknown[]; bulletins?: unknown[] };
type Controle = { id: string; count?: number; detail?: string };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  salariesDuMois: (livre: Livre, annee: number, mois: number) => { id: string }[];
  controlesPaie: (livre: Livre, annee: number, mois: number) => Controle[];
};

const sal = (id: string, extra: Record<string, unknown>) => ({ id, nom: id, actif: true, ...extra });
const manquants = (livre: Livre, m: number) => (KC.controlesPaie(livre, 2026, m).find((c) => c.id === 'bulletins-manquants') || {}).count || 0;

describe('les salariés qu\'un mois attend', () => {
  const livre = KC.livreVide('d1', 2026);
  livre.salaries = [
    sal('yassine', { embauche: '2026-10-01' }),      // entré le 1er octobre
    sal('fin-mois', { embauche: '2026-11-30' }),     // entré le 30 novembre : un jour, un bulletin
    sal('part', { embauche: '2025-03-01', sortie: '2026-11-15' }), // sorti le 15 novembre : son dernier bulletin
    sal('retire', { embauche: '2025-01-01', actif: false }),
  ];
  const ids = (m: number) => KC.salariesDuMois(livre, 2026, m).map((s) => s.id).sort();

  it('janvier n\'attend pas une embauche d\'octobre', () => {
    expect(ids(1)).toEqual(['part']);
  });
  it('novembre attend l\'entrée du 30 et la sortie du 15', () => {
    expect(ids(11)).toEqual(['fin-mois', 'part', 'yassine']);
  });
  it('décembre n\'attend plus celui qui est sorti le 15 novembre', () => {
    expect(ids(12)).toEqual(['fin-mois', 'yassine']);
  });
  it('février : le dernier jour est le 28, pas le 31', () => {
    const l = KC.livreVide('d2', 2026);
    l.salaries = [sal('mars', { embauche: '2026-03-01' })];
    expect(KC.salariesDuMois(l, 2026, 2)).toEqual([]);
  });
  it('le contrôle réclame les bulletins de ces salariés-là, et eux seuls', () => {
    expect([manquants(livre, 1), manquants(livre, 11), manquants(livre, 12)]).toEqual([1, 3, 2]);
  });
});
