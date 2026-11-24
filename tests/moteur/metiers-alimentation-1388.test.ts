// (1.388.54, rapport #21 MET1-10) L'épicier et la boulangère ont leur métier dans l'assistant : un départ qui leur
// ressemble (catalogue du métier, bons de livraison et achats proposés), aucun prix de produit deviné, aucun taux écrit.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Activite = { id: string; label: string; catalog: [string, string, number, string][]; vat?: number };
const core = ecranDeLaPlateforme('core.js') as { ACTIVITIES: Activite[]; modulesSuggeres: (id: string) => string[] };

describe('MET1-10 : l\'alimentation et la boulangerie, deux métiers de l\'assistant', () => {
  it('chacun a son catalogue, sans prix de produit inventé ni taux, et ses modules', () => {
    for (const [id, nom, attendus] of [
      ['alimentation', 'Alimentation et épicerie', ['achats', 'stock', 'pieces']],
      ['boulangerie', 'Boulangerie et pâtisserie', ['achats', 'stock', 'pieces', 'paie']],
    ] as const) {
      const a = core.ACTIVITIES.find((x) => x.id === id);
      expect(a?.label).toBe(nom);
      expect('vat' in (a ?? {})).toBe(false);
      expect(a?.catalog.some(([l]) => /Installation|mise en service/.test(l))).toBe(false);
      // Les produits du métier restent « prix à fixer » : seul un service (la livraison) porte un prix d'exemple.
      expect(a?.catalog.filter(([l]) => !/Livraison/.test(l)).every(([, , prix]) => prix === 0)).toBe(true);
      for (const m of attendus) expect(core.modulesSuggeres(id)).toContain(m);
    }
  });
});
