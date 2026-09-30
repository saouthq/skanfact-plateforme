// Les commandes fournisseurs et leurs réceptions, dans le code de la v10 (web/public/v10/core.js, adapté par
// web/v10/commandes-fournisseurs.txt ; brique 87, 14 § 3.2). Le moteur seul :
//   - la réception tirée d'une commande reprend ce qui RESTE à recevoir ; en brouillon, elle est « en
//     préparation » ; annulée, elle ne compte pas ; validée, elle a reçu ;
//   - la commande se dit « reçue en partie », puis « reçue » ; « soldée » ou « annulée » à la main la clôt ;
//   - une réception validée fait entrer la marchandise suivie en stock, au prix de la commande ramené en
//     dinars (une entrée, pas une charge du mois) ; la facture saisie depuis elle n'y fait pas entrer une
//     seconde fois ce qu'elle a reçu ;
//   - la facture reprend chaque ligne de commande en UNE ligne ; une réception facturée ne se propose plus ;
//   - la commande s'imprime pour le fournisseur.
// Les données discriminent : 1,25 + 1,25 t de fer, une commande en euros au cours 3,3715.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Ligne = Record<string, unknown> & { label: string; qty: number; ligneCommande?: number; recue?: boolean };
type Piece = Record<string, unknown> & { id: string; status: string; lines: Ligne[]; number?: string; supplierId?: string; orderId?: string };
type Suivi = { lignes: { commandee: number; recue: number; enPreparation: number; reste: number; enPlus: number; aProposer: number }[]; receptions: Piece[]; recue: boolean; partielle: boolean; aProposer: boolean };
type Core = {
  numeroSuivant: (data: unknown, liste: unknown[], prefixe: string, date?: string) => string;
  suiviCommandeFournisseur: (data: unknown, commande: Piece) => Suivi;
  statutCommandeFournisseur: (data: unknown, commande: Piece) => string;
  receptionDeCommande: (data: unknown, commande: Piece, today: string) => Piece | null;
  receptionsAFacturer: (data: unknown, supplierId?: string) => Piece[];
  lignesAchatDeReceptions: (data: unknown, receptions: Piece[]) => Ligne[];
  stockMovements: (data: unknown, itemId: string | null) => { qty: number; source: string; ref: string; unitCost: number | null }[];
  copieLigneAchat: (l: Ligne) => Ligne;
  ecartsAchatReceptions: (data: unknown, p: unknown) => Record<string, unknown>[];
  costOfGoodsSold: (data: unknown, period?: { from?: string; to?: string }) => number;
  documentHtml: (doc: unknown, client: unknown, company: unknown) => string;
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const company = { name: 'Matériaux Ben Youssef', currency: 'DT', regime: 'reel' };
const catalog = [{ id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', tracked: true }, { id: 'fer', label: 'Fer à béton 12 mm', unit: 't', tracked: true }];
const commande = (): Piece => ({
  id: 'cf1', type: 'commandeFournisseur', number: 'BCF-2026-001', status: 'envoyée', date: '2026-10-01', dueDate: '2026-10-08', supplierId: 's1', currency: 'DT',
  lines: [
    { label: 'Ciment gris 50 kg', qty: 100, unit: 'sac', unitPrice: 17.25, vatRate: 19, itemId: 'ciment' },
    { label: 'Fer à béton 12 mm', qty: 2.5, unit: 't', unitPrice: 2210.5, vatRate: 19, itemId: 'fer' },
    { label: 'Transport', qty: 1, unit: 'course', unitPrice: 60, vatRate: 19 },
  ],
});
const valider = (r: Piece | null, id: string, number: string, qtes?: number[]): Piece => {
  if (!r) throw new Error('aucune réception proposée');
  return { ...r, id, number, status: 'validée', lines: qtes ? r.lines.map((l, i) => ({ ...l, qty: qtes[i] as number })) : r.lines };
};

describe('les commandes fournisseurs et leurs réceptions, dans la v10', () => {
  it('la réception reprend ce qui reste ; reçue en partie, puis reçue ; un brouillon est en préparation, une réception annulée ne compte pas', () => {
    const cf = commande();
    const data = { company, catalog, purchases: [], supplierOrders: [cf], receptions: [] as Piece[] };
    const r1 = C.receptionDeCommande(data, cf, '2026-10-03');
    expect(r1?.lines.map((l) => [l.label, l.qty, l.ligneCommande])).toEqual([['Ciment gris 50 kg', 100, 0], ['Fer à béton 12 mm', 2.5, 1], ['Transport', 1, 2]]);
    expect(r1).toMatchObject({ status: 'brouillon', number: '', supplierId: 's1', orderId: 'cf1', orderNumber: 'BCF-2026-001' });
    // En brouillon : rien n'est reçu, mais rien ne se propose une seconde fois.
    data.receptions.push({ ...r1 as Piece, id: 'r1', lines: (r1 as Piece).lines.map((l, i) => ({ ...l, qty: [60, 1.25, 1][i] as number })) });
    expect(C.statutCommandeFournisseur(data, cf)).toBe('envoyée');
    expect(C.suiviCommandeFournisseur(data, cf).lignes.map((x) => [x.recue, x.enPreparation, x.aProposer])).toEqual([[0, 60, 40], [0, 1.25, 1.25], [0, 1, 0]]);
    // Validée : reçue en partie, et la réception suivante ne reprend que le reste.
    data.receptions[0] = { ...data.receptions[0] as Piece, status: 'validée', number: 'BR-2026-001' };
    expect(C.statutCommandeFournisseur(data, cf)).toBe('partielle');
    const r2 = C.receptionDeCommande(data, cf, '2026-10-06');
    expect(r2?.lines.map((l) => [l.label, l.qty, l.ligneCommande])).toEqual([['Ciment gris 50 kg', 40, 0], ['Fer à béton 12 mm', 1.25, 1]]);
    // Une réception annulée ne compte pas ; la dernière validée : reçue, plus rien à recevoir.
    data.receptions.push({ ...valider(r2, 'r-annulee', 'BR-2026-002'), status: 'annulée' });
    expect(C.statutCommandeFournisseur(data, cf)).toBe('partielle');
    data.receptions.push(valider(r2, 'r2', 'BR-2026-003'));
    expect(C.statutCommandeFournisseur(data, cf)).toBe('reçue');
    expect(C.receptionDeCommande(data, cf, '2026-10-07')).toBeNull();
    expect(C.suiviCommandeFournisseur(data, cf).receptions.map((r) => r.number)).toEqual(['BR-2026-001', 'BR-2026-003']);
  });

  it('« soldée » ou « annulée » à la main clôt la commande ; les numéros suivent leur propre série', () => {
    const cf = commande();
    const data = { company, catalog, purchases: [], supplierOrders: [cf], receptions: [] as Piece[], counters: {} as Record<string, number> };
    data.receptions.push(valider(C.receptionDeCommande(data, cf, '2026-10-03'), 'r1', 'BR-2026-001', [60, 1.25, 1]));
    expect(C.statutCommandeFournisseur(data, { ...cf, status: 'soldée' })).toBe('soldée');
    expect(C.statutCommandeFournisseur(data, { ...cf, status: 'annulée' })).toBe('annulée');
    expect(C.statutCommandeFournisseur(data, { ...cf, status: 'brouillon' })).toBe('partielle');
    // Le plus grand numéro déjà porté, ou le compteur : le plus grand des deux, plus un.
    expect(C.numeroSuivant(data, data.supplierOrders, 'BCF', '2026-10-09')).toBe('BCF-2026-002');
    expect(C.numeroSuivant(data, data.supplierOrders, 'BCF', '2026-10-09')).toBe('BCF-2026-003');
    expect(C.numeroSuivant(data, data.receptions, 'BR', '2027-01-04')).toBe('BR-2027-001');
  });

  it('une réception validée fait entrer la marchandise en stock, au prix de la commande en dinars ; la facture saisie depuis elle, non', () => {
    const cf = { ...commande(), currency: 'EUR', exchangeRate: 3.3715 };
    const data = { company, catalog, purchases: [] as Piece[], supplierOrders: [cf], receptions: [] as Piece[] };
    const brouillon = { ...C.receptionDeCommande(data, cf, '2026-10-03') as Piece, id: 'r0' };
    data.receptions.push(brouillon);
    expect(C.stockMovements(data, 'ciment')).toEqual([]);
    data.receptions[0] = valider(brouillon, 'r1', 'BR-2026-001', [60, 1.25, 1]);
    data.receptions.push(valider(C.receptionDeCommande(data, cf, '2026-10-06'), 'r2', 'BR-2026-002'));
    // 17,25 € × 3,3715 = 58,158375 DT le sac, arrondi au millime comme la ligne d'un achat (toBase) : 58,158.
    expect(C.stockMovements(data, 'ciment').map((m) => [m.source, m.ref, m.qty, m.unitCost])).toEqual([['reception', 'BR-2026-001', 60, 58.158], ['reception', 'BR-2026-002', 40, 58.158]]);
    // La facture des deux réceptions : chaque ligne de commande en UNE ligne ; ses lignes reçues ne rentrent pas.
    const lignes = C.lignesAchatDeReceptions(data, data.receptions);
    expect(lignes.map((l) => [l.label, l.qty, l.destination, l.recue])).toEqual([['Ciment gris 50 kg', 100, 'stock', true], ['Fer à béton 12 mm', 2.5, 'stock', true], ['Transport', 1, 'charge', true]]);
    data.purchases.push({ id: 'a1', kind: 'facture', status: '', supplierId: 's1', date: '2026-10-08', currency: 'EUR', exchangeRate: 3.3715, receptions: [{ id: 'r1' }, { id: 'r2' }],
      lines: [...lignes, { label: 'Ciment gris 50 kg', qty: 5, unitPrice: 17.25, vatRate: 19, destination: 'stock', deductible: true }] });
    // Seule la ligne ajoutée à la main (5 sacs) entre par la facture.
    expect(C.stockMovements(data, 'ciment').map((m) => [m.source, m.qty])).toEqual([['reception', 60], ['reception', 40], ['achat', 5]]);
    expect(C.receptionsAFacturer(data)).toEqual([]);
    // Une réception est une ENTRÉE, comme un achat : rien n'est vendu, le coût des sorties du mois est nul
    // (comptée comme une charge, la marchandise reçue ferait un gain de tout le stock).
    expect(C.costOfGoodsSold(data, { from: '2026-10-01', to: '2026-10-31' })).toBe(0);
    // La copie d'une ligne reçue (⧉, ou la copie de l'achat) n'a été reçue par aucune réception.
    const recue = lignes[0] as Ligne;
    expect(C.copieLigneAchat(recue)).toEqual({ label: 'Ciment gris 50 kg', qty: 100, unit: 'sac', unitPrice: 17.25, vatRate: 19, destination: 'stock', deductible: true, itemId: 'ciment' });
    expect(recue.recue).toBe(true);
  });

  it('une réception validée attend sa facture jusqu\'à ce qu\'un achat la couvre ; la commande s\'imprime pour le fournisseur', () => {
    const cf = commande();
    const data = { company, catalog, purchases: [] as Piece[], supplierOrders: [cf], receptions: [] as Piece[] };
    data.receptions.push(valider(C.receptionDeCommande(data, cf, '2026-10-03'), 'r1', 'BR-2026-001', [60, 1.25, 1]));
    data.receptions.push({ ...C.receptionDeCommande(data, cf, '2026-10-04') as Piece, id: 'r-brouillon' });
    expect(C.receptionsAFacturer(data).map((r) => r.id)).toEqual(['r1']);
    expect(C.receptionsAFacturer(data, 's2')).toEqual([]);
    data.purchases.push({ id: 'a1', kind: 'facture', status: '', lines: [], receptions: [{ id: 'r1', number: 'BR-2026-001' }] });
    expect(C.receptionsAFacturer(data)).toEqual([]);
    const html = C.documentHtml(cf, { name: 'Ciments de Bizerte', address: 'Zone industrielle, Bizerte' }, company);
    const texte = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(texte).toContain('Bon de commande');
    expect(texte).toContain('Fournisseur Ciments de Bizerte');
    expect(texte).toContain('Livraison souhaitée le 08/10/2026');
    expect(texte).toContain('Merci de nous confirmer cette commande, ses prix et sa date de livraison.');
  });

  it('la facture se compare à ce qui a été reçu : une quantité, un prix, une ligne oubliée ; la copie d\'une ligne ne compte pas', () => {
    const cf = commande();
    const data = { company, catalog, purchases: [] as Piece[], supplierOrders: [cf], receptions: [] as Piece[] };
    data.receptions.push(valider(C.receptionDeCommande(data, cf, '2026-10-03'), 'r1', 'BR-2026-001', [60, 1.25, 1]));
    data.receptions.push(valider(C.receptionDeCommande(data, cf, '2026-10-06'), 'r2', 'BR-2026-002'));
    const lignes = C.lignesAchatDeReceptions(data, data.receptions);
    const achat = (ls: Ligne[], devise = 'DT') => ({ id: 'a1', kind: 'facture', currency: devise, receptions: [{ id: 'r1' }, { id: 'r2' }], lines: ls });
    // Telle quelle : aucun écart.
    expect(C.ecartsAchatReceptions(data, achat(lignes))).toEqual([]);
    // 105 sacs facturés pour 100 reçus, le fer à 2 250,500 au lieu de 2 210,500, le transport oublié ; une
    // copie de la ligne du ciment (⧉) n'a été reçue par aucune réception : elle ne compte pas.
    const modifiees = [{ ...lignes[0], qty: 105 }, C.copieLigneAchat(lignes[0] as Ligne), { ...lignes[1], unitPrice: 2250.5 }] as Ligne[];
    expect(C.ecartsAchatReceptions(data, achat(modifiees))).toEqual([
      { label: 'Ciment gris 50 kg', unit: 'sac', genre: 'quantite', recu: 100, facture: 105 },
      { label: 'Fer à béton 12 mm', unit: 't', genre: 'prix', commande: 2210.5, facture: 2250.5 },
      { label: 'Transport', unit: 'course', genre: 'absente', recu: 1 },
    ]);
    // Dans une autre devise que la commande, les prix ne se comparent pas ; les quantités, si.
    expect(C.ecartsAchatReceptions(data, achat(modifiees, 'EUR')).map((e) => e.genre)).toEqual(['quantite', 'absente']);
    // Un achat qui ne vient d'aucune réception n'a pas d'écart.
    expect(C.ecartsAchatReceptions(data, { lines: lignes })).toEqual([]);
    // Deux lignes de commande du même nom (le même ciment, en promotion pour 20 sacs) : chaque ligne de la
    // facture se compare à SA ligne de commande, pas à la première qui porte son nom.
    const cf2 = { ...commande(), id: 'cf2', number: 'BCF-2026-002', lines: [
      { label: 'Ciment gris 50 kg', qty: 100, unit: 'sac', unitPrice: 17.25, vatRate: 19, itemId: 'ciment' },
      { label: 'Ciment gris 50 kg', qty: 20, unit: 'sac', unitPrice: 16.9, vatRate: 19, itemId: 'ciment' },
    ] };
    const d2 = { company, catalog, purchases: [] as Piece[], supplierOrders: [cf2], receptions: [] as Piece[] };
    d2.receptions.push(valider(C.receptionDeCommande(d2, cf2, '2026-10-03'), 'r3', 'BR-2026-003'));
    const [l100, l20] = C.lignesAchatDeReceptions(d2, d2.receptions);
    expect(C.ecartsAchatReceptions(d2, { receptions: [{ id: 'r3' }], lines: [l20, { ...l100, qty: 90 }] })).toEqual([
      { label: 'Ciment gris 50 kg', unit: 'sac', genre: 'quantite', recu: 100, facture: 90 },
    ]);
  });
});
