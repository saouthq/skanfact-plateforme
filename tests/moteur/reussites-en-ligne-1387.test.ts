// (1.387.76, issue 14, ENTSOCLE-21) « Tes réussites » parlait d'un autre produit : « une copie automatique vit hors de
// cet ordinateur », « premier paquet au comptable ». En ligne, rien ne vit sur l'ordinateur et aucun paquet ne part :
// le cabinet lit les écritures sur place. Les deux lignes disent ce qui est vrai ici.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { id: string; titre: string; quoi: string; fait: boolean };
const C = ecranDeLaPlateforme('core.js') as { reussites: (d: Record<string, unknown>, c: Record<string, unknown>, o?: Record<string, unknown>) => { liste: Ligne[] } };
const lignes = (o: Record<string, unknown>): Ligne[] => {
  const r = C.reussites({ documents: [], clients: [], packs: [] }, { name: 'Meubles du Sahel', currency: 'DT' }, o);
  return r.liste;
};
const ligne = (o: Record<string, unknown>, id: string): Ligne => {
  const l = lignes(o).find(x => x.id === id);
  if (!l) throw new Error(`ligne ${id} absente`);
  return l;
};

describe('les réussites en ligne (issue 14, ENTSOCLE-21)', () => {
  it('en ligne, les données sont à l’abri sans copie ni dossier partagé, et la phrase ne parle plus de « cet ordinateur » comme d’un coffre', () => {
    const l = ligne({ enLigne: true }, 'abri');
    expect(l.fait).toBe(true);
    expect(l.quoi).toContain('en ligne');
    expect(l.quoi).not.toContain('copie automatique');
  });
  it('en ligne, la ligne du comptable s’appelle « Ton comptable relié » et se coche quand un cabinet est relié, pas à un paquet', () => {
    expect(ligne({ enLigne: true, comptable: false }, 'comptable').titre).toBe('Ton comptable relié');
    expect(ligne({ enLigne: true, comptable: false }, 'comptable').fait).toBe(false);
    expect(ligne({ enLigne: true, comptable: true }, 'comptable').fait).toBe(true);
    expect(ligne({ enLigne: true, comptable: true }, 'comptable').quoi).not.toContain('paquet');
  });
  it('hors ligne, rien ne change : la copie externe et le premier paquet', () => {
    expect(ligne({}, 'abri').fait).toBe(false);
    expect(ligne({ copieExterne: true }, 'abri').quoi).toContain('copie automatique');
    expect(ligne({}, 'comptable').titre).toBe('Premier paquet au comptable');
  });
});
