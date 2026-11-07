// 1.317.0 (les listes de prix jouées par une droguerie de l'Ariana) : le client d'une liste ne paie jamais plus cher qu'un
// passant (un palier de l'article plus bas que sa liste l'emporte, décidé par délégation le 07/11/2026) ; et le panier de
// la caisse prend le prix d'une facture au même client — sa liste, le palier de la quantité —, une ligne sans article
// gardant le sien. Les données discriminent : une catégorie écrite « artisans » sur la fiche et « Artisans » sur la liste,
// une liste à venir et une liste finie qui ne valent pas aujourd'hui, une quantité sous le palier et une au-dessus.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Fiche = Record<string, unknown>;
type Ligne = { itemId: string; label: string; qty: number; unitPrice: number; vatRate: number; prixSource?: string; prixListe?: string };
const C = ecranDeLaPlateforme('core.js') as {
  prixArticlePour: (data: Fiche, item: Fiche, clientId: string, date: string, qty: number) => { prix: number; source: string; liste: string };
  prixDuPanier: (data: Fiche, panier: Ligne[], clientId: string, jour: string) => Ligne[];
  remiseEffective: (data: Fiche, doc: Fiche, company: Fiche) => { taux: number; ligne: string };
};
const peinture = { id: 'peint', label: 'Peinture murale blanche 10 L', unitPrice: 89, vatRate: 19 };
const vis = { id: 'vis', label: 'Vis à bois 4×40 (boîte de 200)', unitPrice: 4.9, vatRate: 19, paliers: [{ min: 10, prix: 4.2 }, { min: 50, prix: 3.9 }] };
const data: Fiche = {
  catalog: [peinture, vis],
  clients: [{ id: 'chedly', name: 'Chedly Plomberie', categorieTarif: 'artisans' }, { id: 'samia', name: 'Samia Ben Ali' }],
  priceLists: [
    { id: 'art', nom: 'Artisans 2026', categorie: 'Artisans', depuis: '2026-04-21', lignes: [{ itemId: 'peint', prix: 78 }, { itemId: 'vis', prix: 4.6 }] },
    { id: 'hausse', nom: 'Artisans (hausse)', categorie: 'Artisans', depuis: '2027-01-01', lignes: [{ itemId: 'peint', prix: 81 }] },
    { id: 'promo', nom: 'Promotion de l\'été', categorie: 'Artisans', depuis: '2026-06-01', jusquau: '2026-08-31', lignes: [{ itemId: 'peint', prix: 70 }] },
  ],
};
const JOUR = '2026-11-07';

describe('les listes de prix jouées (1.317.0)', () => {
  it('le client d\'une liste ne paie jamais plus qu\'un passant : au-delà d\'un palier plus bas que sa liste, c\'est le palier', () => {
    // Sous le palier : le prix de sa liste (4,600, moins que les 4,900 du catalogue).
    expect(C.prixArticlePour(data, vis, 'chedly', JOUR, 5)).toEqual({ prix: 4.6, source: 'liste', liste: 'Artisans 2026' });
    // Douze boîtes : le palier de 10 (4,200) est plus bas que sa liste ; un passant les paie 4,200, lui aussi.
    expect(C.prixArticlePour(data, vis, 'chedly', JOUR, 12)).toEqual({ prix: 4.2, source: 'palier', liste: '' });
    expect(C.prixArticlePour(data, vis, 'samia', JOUR, 12)).toEqual({ prix: 4.2, source: 'palier', liste: '' });
    // Un article sans palier garde le prix de sa liste en vigueur (ni la hausse à venir, ni la promotion finie).
    expect(C.prixArticlePour(data, peinture, 'chedly', JOUR, 30)).toEqual({ prix: 78, source: 'liste', liste: 'Artisans 2026' });
    // La remise que fait la facture des douze boîtes à 4,200 : aucune, c'est le prix que SkanFact lui propose.
    expect(C.remiseEffective(data, { clientId: 'chedly', date: JOUR, discountRate: 0, lines: [{ itemId: 'vis', label: vis.label, qty: 12, unitPrice: 4.2 }] }, { currency: 'DT' }).taux).toBe(0);
  });

  it('le panier de la caisse prend le prix d\'une facture au même client, et le reprend quand le client change', () => {
    const panier: Ligne[] = [
      { itemId: 'peint', label: peinture.label, qty: 2, unitPrice: 89, vatRate: 19 },
      { itemId: 'vis', label: vis.label, qty: 12, unitPrice: 4.9, vatRate: 19 },
      { itemId: '', label: 'Article divers', qty: 1, unitPrice: 3.5, vatRate: 19 },
    ];
    const prix = () => panier.map((l) => [l.unitPrice, l.prixSource ?? null, l.prixListe ?? null]);
    expect(C.prixDuPanier(data, panier, 'chedly', JOUR)).toBe(panier);
    expect(prix()).toEqual([[78, 'liste', 'Artisans 2026'], [4.2, 'palier', ''], [3.5, null, null]]);
    // Le plombier repart : la vente revient au comptoir, au prix du catalogue ; le palier vaut pour tout le monde.
    C.prixDuPanier(data, panier, '', JOUR);
    expect(prix()).toEqual([[89, '', ''], [4.2, 'palier', ''], [3.5, null, null]]);
    // Une boîte de moins sous le palier : le prix du catalogue revient.
    const boites = panier[1] as Ligne;
    boites.qty = 9;
    C.prixDuPanier(data, panier, '', JOUR);
    expect(boites.unitPrice).toBe(4.9);
  });
});
