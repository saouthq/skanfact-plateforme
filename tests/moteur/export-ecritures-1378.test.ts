// L'export des écritures du cabinet (1.378.6 ; issue 9, CABDECLARER-17). Vu : « Clients : 11 » pour un client et onze
// mois ; la balance d'ouverture d'un client sans mouvement oubliée, quand les à-nouveaux d'un autre partaient ; le
// dossier d'exemple dans le fichier destiné au logiciel du cabinet.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type Pack = { id: string; name: string; month: string; ouverture?: boolean };
type Plan = { packs: Pack[]; sansPaquet: string[]; sans: { id: string; name: string }[]; exempleExclu: boolean; mois: string[] };
function cabcore() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
  return bac.CabCore as {
    ecrituresPlan: (etat: unknown, o: unknown) => Plan;
    packsAvecOuvertures: (plan: Plan, livres: Map<string, { date: string }[]>) => Pack[];
    mergeEcritures: (s: { name: string; matricule?: string; month: string; csv: string }[]) => { dossiers: number; lignes: number };
  };
}
const K = cabcore();
const mois = (...ms: string[]) => ms.map((month) => ({ month, definitive: true }));
const csv = 'Date;Compte;Débit;Crédit\r\n12/03/2026;401;0,000;10,000';

describe('l\'export des écritures du cabinet dit vrai', () => {
  it('le compte rendu compte des clients, pas des mois de livres', () => {
    const r = K.mergeEcritures(['2026-01', '2026-02', '2026-03'].map((month) => ({ name: 'Pâtisserie', matricule: '1', month, csv })));
    expect(r.lignes).toBe(3);
    expect(r.dossiers).toBe(1);
  });

  it('le dossier d\'exemple sort du fichier dès qu\'un vrai client a des écritures ; seul, il part', () => {
    const exemple = { id: 'x', name: 'Exemple', demo: true, packs: mois('2026-03') };
    const vrai = { id: 'a', name: 'Café', packs: mois('2026-03') };
    const avec = K.ecrituresPlan({ dossiers: [exemple, vrai] }, { from: '2026-03', to: '2026-03' });
    expect(avec.packs.map((p) => p.name)).toEqual(['Café']);
    expect(avec.exempleExclu).toBe(true);
    const seul = K.ecrituresPlan({ dossiers: [exemple] }, { from: '2026-03', to: '2026-03' });
    expect(seul.packs.map((p) => p.name)).toEqual(['Exemple']);
    expect(seul.exempleExclu).toBe(false);
    // Un vrai client sans écriture sur la période ne chasse pas l'exemple.
    const horsPeriode = K.ecrituresPlan({ dossiers: [exemple, { id: 'b', name: 'Garage', packs: mois('2026-05') }] }, { from: '2026-03', to: '2026-03' });
    expect(horsPeriode.packs.map((p) => p.name)).toEqual(['Exemple']);
  });

  it('la balance d\'ouverture d\'un client sans mouvement part dans le fichier, à son mois', () => {
    const plan = K.ecrituresPlan({ dossiers: [{ id: 'a', name: 'Pâtisserie', packs: mois('2026-01', '2026-02') }, { id: 'q', name: 'Quincaillerie', packs: [] }] }, { from: '2026-01', to: '2026-02' });
    expect(plan.sansPaquet).toEqual(['Quincaillerie']);
    const lus = K.packsAvecOuvertures(plan, new Map([['q', [{ date: '2026-01-01' }, { date: '2026-01-01' }]], ['a', [{ date: '2026-01-05' }]]]));
    expect(lus.map((p) => `${p.month} ${p.name}${p.ouverture ? ' (ouverture)' : ''}`)).toEqual(['2026-01 Pâtisserie', '2026-01 Quincaillerie (ouverture)', '2026-02 Pâtisserie']);
    // Sans rien dans son livre, rien ne s'ajoute.
    expect(K.packsAvecOuvertures(plan, new Map()).length).toBe(2);
  });

  it('le pont lit aussi le livre des clients sans mouvement', () => {
    const pont = lireEcran('plateforme/pont-cabinet.js');
    expect(pont).toContain('K.packsAvecOuvertures(plan, livres).map(');
    expect(pont).toContain('[...plan.packs, ...(plan.sans || [])]');
  });
});
