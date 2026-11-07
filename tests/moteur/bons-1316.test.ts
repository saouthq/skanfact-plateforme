// 1.316.0 (les autres pièces jouées) : la facture d'un bon de livraison ne ressort pas ce que le bon a sorti, mais une
// ligne qu'on y ajoute sort le stock comme toute vente ; chaque ligne venue d'un bon le dit (`fromBon`). Une facture
// d'avant 1.316 (tirée d'un bon sans marquer ses lignes) reste entière au bon. Et la fusion de deux postes ne voit pas
// de conflit dans deux fiches identiques dont seul l'ordre des champs diffère (le serveur rend le sien).
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Fiche = Record<string, unknown>;
type Ligne = Fiche & { fromBon?: string };
type Piece = Fiche & { lines: Ligne[] };
const C = ecranDeLaPlateforme('core.js') as {
  convertDoc: (doc: Piece, type: string, company: Fiche, jour: string, client?: Fiche) => Piece;
  stockOf: (data: Fiche, id: string) => { qty: number };
  stockImpact: (doc: Piece, data: Fiche) => { itemId: string }[];
  mergeData: (mine: Fiche, theirs: Fiche, anc?: Fiche) => { counts: { conflicts: number } };
};
const societe = { name: 'Matériaux du Sahel SARL', currency: 'DT', paymentTermsDays: 30 };
const article = (id: string, label: string, qte: number) => ({ id, label, unit: 'sac', unitPrice: 10, vatRate: 19, tracked: true, initialQty: qte, initialCost: 6, initialDate: '2026-01-01' });
const ligne = (itemId: string, label: string, qty: number): Ligne => ({ itemId, label, qty, unit: 'sac', unitPrice: 10, vatRate: 19 });
const bon: Piece = { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: '2026-11-07', clientId: 'c1', lines: [ligne('ciment', 'Ciment gris 50 kg', 100)] };
const dossier = (pieces: Piece[]): Fiche => ({ catalog: [article('ciment', 'Ciment gris 50 kg', 100), article('platre', 'Plâtre 25 kg', 30)], documents: pieces, clients: [{ id: 'c1', name: 'Société Bâtir Plus' }] });

describe('la facture d\'un bon de livraison et le stock (1.316.0)', () => {
  it('« Facturer ce bon » : ses lignes disent leur bon et ne ressortent pas ; dix sacs ajoutés sortent ; sa copie est une autre vente', () => {
    const facture = C.convertDoc(bon, 'facture', societe, '2026-11-07');
    expect(facture.lines.map((l) => l.fromBon)).toEqual(['BL-2026-001']);
    facture.lines.push(ligne('platre', 'Plâtre 25 kg', 10));
    // Avant l'émission : le bon a vidé le ciment, la facture n'en demande pas ; le plâtre, lui, est là.
    expect(C.stockImpact(facture, dossier([bon]))).toEqual([]);
    const emise = { ...facture, number: 'FAC-2026-001', status: 'envoyée' };
    const d = dossier([bon, emise]);
    expect(C.stockOf(d, 'ciment').qty).toBe(0);
    expect(C.stockOf(d, 'platre').qty).toBe(20);
    // Un avoir ou une copie ne reprennent pas la marque : ce qu'ils font du stock est le leur.
    expect(C.convertDoc(emise, 'avoir', societe, '2026-11-08').lines.map((l) => l.fromBon)).toEqual([undefined, undefined]);
  });
  it('une facture d\'avant 1.316 tirée d\'un bon, sans marque sur ses lignes, reste entière au bon', () => {
    const ancienne: Piece = { id: 'f0', type: 'facture', number: 'FAC-2026-000', status: 'envoyée', date: '2026-11-07', clientId: 'c1', fromDocType: 'livraison', fromDocId: 'bl1',
      lines: [ligne('ciment', 'Ciment gris 50 kg', 100), ligne('platre', 'Plâtre 25 kg', 10)] };
    const d = dossier([bon, ancienne]);
    expect(C.stockOf(d, 'ciment').qty).toBe(0);
    expect(C.stockOf(d, 'platre').qty).toBe(30);
    expect(C.stockImpact(ancienne, dossier([bon]))).toEqual([]);
  });
  it('deux fiches identiques, champs dans un autre ordre (le serveur rend le sien) : aucune « modifiée des deux côtés »', () => {
    const ici = { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', tracked: true, minStock: 0, serialized: false };
    const serveur = { id: 'ciment', unit: 'sac', label: 'Ciment gris 50 kg', tracked: true, minStock: 0, serialized: false };
    expect(C.mergeData({ catalog: [ici], syncWrittenAt: 1 }, { catalog: [serveur], syncWrittenAt: 2 }).counts.conflicts).toBe(0);
    expect(C.mergeData({ catalog: [ici], syncWrittenAt: 1 }, { catalog: [{ ...serveur, minStock: 5 }], syncWrittenAt: 2 }).counts.conflicts).toBe(1);
  });
});
