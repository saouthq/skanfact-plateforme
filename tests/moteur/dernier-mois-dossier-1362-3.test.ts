// Le dernier mois d'un dossier (1.362.3, bout en bout 27). Une écriture datée de janvier prochain, laissée au brouillard,
// faisait dire « janvier au brouillard » à la carte du dossier ouvert du Cabinet, le 13 novembre : un mois qui n'existe pas
// encore. Le dernier mois est le dernier qui a COMMENCÉ (règle U-12) ; sans mois commencé, le premier à venir.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Paquet = { month: string; label: string; definitive: boolean };
type Ligne = { lastMonth: string; lastLabel: string; lastDefinitive: boolean };
function cabcore() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
  return bac.CabCore as { dossierRow: (d: unknown, aujourdhui?: string, grace?: number) => Ligne };
}
const K = cabcore();
const paquet = (month: string, definitive: boolean): Paquet => ({ month, label: month, definitive });
const ligne = (packs: Paquet[]) => K.dossierRow({ id: 'd1', name: 'Pâtisserie Nour', packs }, '2026-11-13', 10);

describe('le dernier mois d\'un dossier', () => {
  it('une écriture de janvier prochain ne l\'emporte pas sur octobre, validé', () => {
    const r = ligne([paquet('2026-10', true), paquet('2027-01', false), paquet('2026-09', true)]);
    expect([r.lastMonth, r.lastDefinitive]).toEqual(['2026-10', true]);
  });
  it('le mois en cours compte : il a commencé', () => {
    expect(ligne([paquet('2026-10', true), paquet('2026-11', false), paquet('2027-01', false)]).lastMonth).toBe('2026-11');
  });
  it('rien que des mois à venir : le premier d\'entre eux', () => {
    expect(ligne([paquet('2027-03', false), paquet('2027-01', false)]).lastMonth).toBe('2027-01');
  });
  it('aucun paquet : aucun mois', () => {
    expect(ligne([]).lastMonth).toBe('');
  });
});
