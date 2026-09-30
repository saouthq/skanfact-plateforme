// Les listes de prix, dans le code de la v10 (web/public/v10/core.js, adapté par web/v10/listes-prix.txt ; brique
// 93, 14 § 3.2 et 01 § 5 `liste_prix` : « prix par client ou par catégorie de client, avec dates d'effet »). Le
// moteur seul :
//   - valent pour un client à une date : les listes qui le nomment, puis celles de sa catégorie ; à égalité, la
//     plus récente ; une liste pas encore commencée ou finie ne vaut pas ;
//   - le prix d'un article : celui de la première liste qui le porte, sinon le palier de sa quantité, sinon
//     le prix de l'article.
// Les données discriminent : une catégorie écrite « revendeur » sur la fiche et « Revendeur » sur la liste.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Core = {
  listesPrixApplicables: (data: unknown, clientId: string, date: string) => { id: string }[];
  prixArticlePour: (data: unknown, item: unknown, clientId: string, date: string, qty: number) => { prix: number; source: string; liste: string };
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const ciment = { id: 'ciment', unitPrice: 21, paliers: [{ min: 100, prix: 19.8 }] };
const fer = { id: 'fer', unitPrice: 2600 };
const sable = { id: 'sable', unitPrice: 35 };
const data = {
  clients: [{ id: 'c1', name: 'Lac Bâtiment', categorieTarif: ' revendeur ' }, { id: 'c2', name: 'Particulier' }, { id: 'c3', name: 'Autre revendeur', categorieTarif: 'Revendeur' }],
  priceLists: [
    { id: 'rev25', nom: 'Revendeurs 2025', categorie: 'Revendeur', depuis: '2025-01-01', lignes: [{ itemId: 'ciment', prix: 20 }, { itemId: 'sable', prix: 33 }] },
    { id: 'rev26', nom: 'Revendeurs 2026', categorie: 'Revendeur', depuis: '2026-01-01', lignes: [{ itemId: 'ciment', prix: 19.5 }, { itemId: 'fer', prix: 2150 }] },
    { id: 'lac', nom: 'Chantier Lac', clientIds: ['c1'], depuis: '2026-06-01', lignes: [{ itemId: 'ciment', prix: 19 }] },
    { id: 'finie', nom: 'Promotion de printemps', categorie: 'Revendeur', depuis: '2026-03-01', jusquau: '2026-05-31', lignes: [{ itemId: 'ciment', prix: 15 }] },
    // Une liste qui nomme « Autre revendeur », plus ancienne que celle de sa catégorie : elle l'emporte quand même.
    { id: 'vieux', nom: 'Prix de Sfax', clientIds: ['c3'], depuis: '2025-06-01', lignes: [{ itemId: 'ciment', prix: 18 }] },
    { id: 'future', nom: 'Revendeurs 2027', categorie: 'Revendeur', depuis: '2027-01-01', lignes: [{ itemId: 'ciment', prix: 22 }] },
  ],
};

describe('les listes de prix, dans la v10', () => {
  it('valent pour un client à une date : celles qui le nomment, puis celles de sa catégorie, la plus récente d\'abord', () => {
    expect(C.listesPrixApplicables(data, 'c1', '2026-09-30').map((l) => l.id)).toEqual(['lac', 'rev26', 'rev25']);
    expect(C.listesPrixApplicables(data, 'c1', '2026-04-15').map((l) => l.id)).toEqual(['finie', 'rev26', 'rev25']);
    expect(C.listesPrixApplicables(data, 'c3', '2026-09-30').map((l) => l.id)).toEqual(['vieux', 'rev26', 'rev25']);
    expect(C.listesPrixApplicables(data, 'c2', '2026-09-30')).toEqual([]);
  });

  it('le prix d\'un article : la première liste qui le porte, sinon le palier de sa quantité, sinon le prix de l\'article', () => {
    expect(C.prixArticlePour(data, ciment, 'c1', '2026-09-30', 1)).toEqual({ prix: 19, source: 'liste', liste: 'Chantier Lac' });
    expect(C.prixArticlePour(data, fer, 'c1', '2026-09-30', 1)).toEqual({ prix: 2150, source: 'liste', liste: 'Revendeurs 2026' });
    expect(C.prixArticlePour(data, sable, 'c1', '2026-09-30', 1)).toEqual({ prix: 33, source: 'liste', liste: 'Revendeurs 2025' });
    expect(C.prixArticlePour(data, ciment, 'c3', '2026-09-30', 1).prix).toBe(18);
    expect(C.prixArticlePour(data, fer, 'c3', '2026-09-30', 1).prix).toBe(2150);
    // Sans liste : le palier de la quantité, sinon le prix de l'article.
    expect(C.prixArticlePour(data, ciment, 'c2', '2026-09-30', 150)).toEqual({ prix: 19.8, source: 'palier', liste: '' });
    expect(C.prixArticlePour(data, ciment, 'c2', '2026-09-30', 1)).toEqual({ prix: 21, source: 'article', liste: '' });
  });
});
