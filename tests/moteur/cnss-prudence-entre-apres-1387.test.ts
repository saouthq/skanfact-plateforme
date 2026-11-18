// (1.387.18, issue 10, CABPAIE-34) Les Échéances comptaient un dossier créé le jour même « CNSS du 3ᵉ trimestre, en retard
// de 32 jours · compté par prudence ». Un dossier dont rien ne dit s'il emploie, et entré au cabinet APRÈS la date limite,
// n'est pas réclamé pour ce trimestre ; dès que sa Paie dit qu'il emploie, il est compté comme les autres.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Ech = { id: string; mois: string[]; restants?: string[]; manquants: string[]; aSaisir?: string[]; deposes?: string[]; provisoires: string[] };
function cabcore() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
  return bac.CabCore as { echeances: (state: unknown, aujourdhui?: string, opts?: unknown) => Ech[]; migrate: (s: unknown) => unknown };
}
const K = cabcore();
const vise = (e: Ech) => [...(e.manquants || []), ...(e.aSaisir || []), ...(e.restants || []), ...(e.provisoires || []), ...(e.deposes || [])];

describe('la CNSS du trimestre ne compte pas par prudence un dossier entré après sa date', () => {
  const dossier = (id: string, name: string, createdAt: string) => ({ id, name, manual: true, from: '2026-01', createdAt, packs: [] });
  const cnssT3 = (st: unknown, opts?: unknown) => K.echeances(st, '2026-11-16', opts).find(e => e.id === 'cnss' && e.mois.includes('2026-09'));

  it('créé le 16/11 sans rien de saisi : pas dans le 3ᵉ trimestre ; créé en mars, oui ; employeur connu, oui', () => {
    const st = K.migrate({ cabinet: { name: 'Cabinet' }, dossiers: [dossier('a', 'Atelier Couture Vide', '2026-11-16T09:00:00Z'), dossier('b', 'Garage Ancien', '2026-03-01T09:00:00Z')] });
    const e = cnssT3(st);
    expect(e && vise(e)).toEqual(expect.arrayContaining(['Garage Ancien']));
    expect(e ? vise(e) : []).not.toContain('Atelier Couture Vide');
    const connu = cnssT3(st, { employeurs: { a: { '2026-07': true } } });
    expect(connu && vise(connu)).toContain('Atelier Couture Vide');
  });
});
