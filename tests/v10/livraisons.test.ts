// Les commandes livrées en plusieurs fois, et plusieurs bons de livraison en une facture, dans le code de la
// v10 (web/public/v10/core.js, adapté par web/v10/livraisons.txt ; brique 86, 14 § 3.2). Le moteur seul :
//   - le bon tiré d'une commande reprend ce qui RESTE à livrer, lignes rattachées ; un bon en brouillon est
//     « en préparation », un bon annulé ne compte pas, un bon émis ou signé a livré ;
//   - la commande se dit « livrée en partie », puis « livrée » ; « livrée » choisie à la main la clôt ;
//   - plusieurs bons d'un client font une facture : chaque ligne de commande en UNE ligne (la facture égale
//     la commande au millime quand tout est livré), les bons nommés ; un bon facturé ne se propose plus ;
//   - le stock sort par les bons, jamais une seconde fois par la facture.
// Les données discriminent : 2,5 t livrées 1,25 + 1,25 à 2 350,750 (une ligne par bon ferait un millime de plus).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Ligne = Record<string, unknown> & { label: string; qty: number; ligneCommande?: number };
type Doc = Record<string, unknown> & { id: string; type: string; status: string; lines: Ligne[]; number?: string };
type Suivi = { lignes: { i: number; commandee: number; livree: number; enPreparation: number; reste: number; enPlus: number; aProposer: number }[]; bons: Doc[]; livree: boolean; partielle: boolean; aProposer: boolean };
type Core = {
  livraisonDeCommande: (data: unknown, commande: Doc, company: unknown, today: string, client: unknown) => Doc | null;
  suiviCommande: (data: unknown, commande: Doc) => Suivi;
  resteALivrerDit: (s: Suivi) => string;
  effectiveStatus: (doc: Doc, data: unknown, company: unknown, today?: string) => string;
  statusLabel: (s: string, type: string) => string;
  bonsAFacturer: (data: unknown) => Doc[];
  factureDuBon: (data: unknown, bon: Doc) => Doc | null;
  factureDeBons: (bons: Doc[], company: unknown, today: string, client: unknown) => (Doc & { bonsLivraison: { id: string; number: string }[] }) | null;
  computeTotals: (doc: unknown, company: unknown) => { totalHT: number };
  stockMovements: (data: unknown, itemId: string | null) => { qty: number; source: string; ref: string }[];
  derivedDocs: (doc: Doc, data: unknown) => Doc[];
  convertDoc: (doc: Doc, type: string, company: unknown, today: string, client: unknown) => Doc;
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const company = { currency: 'DT', paymentTermsDays: 30, quoteValidityDays: 30, regime: 'reel' };
const client = { id: 'c1', name: 'Quincaillerie El Amen' };
const commande = (): Doc => ({
  id: 'bc1', type: 'commande', number: 'BC-2026-001', status: 'reçue', date: '2026-10-01', clientId: 'c1', currency: 'DT', subject: 'Chantier Lac 2',
  lines: [
    { label: 'Ciment gris 50 kg', description: '', qty: 100, unit: 'sac', unitPrice: 18.5, vatRate: 19 },
    { label: 'Fer à béton 12 mm', description: '', qty: 2.5, unit: 't', unitPrice: 2350.75, vatRate: 19 },
    { label: 'Transport', description: '', qty: 1, unit: 'course', unitPrice: 60, vatRate: 19 },
  ],
});
const numeroter = (d: Doc | null, number: string, status: string, date: string): Doc => {
  if (!d) throw new Error('aucun bon proposé');
  return { ...d, number, status, date };
};

describe('les commandes livrées en plusieurs fois, dans la v10', () => {
  it('le bon d\'une commande reprend ce qui reste ; livrée en partie, puis livrée ; un brouillon est en préparation, un bon annulé ne compte pas', () => {
    const bc = commande();
    const data = { company, catalog: [], documents: [bc] as Doc[] };
    const premier = C.livraisonDeCommande(data, bc, company, '2026-10-02', client);
    expect(premier?.lines.map((l) => [l.label, l.qty, l.ligneCommande])).toEqual([['Ciment gris 50 kg', 100, 0], ['Fer à béton 12 mm', 2.5, 1], ['Transport', 1, 2]]);
    expect(premier).toMatchObject({ type: 'livraison', status: 'brouillon', fromDocId: 'bc1', hidePrices: true });

    // Ce qui part vraiment : 60 sacs, 1,25 t, le transport. Tant que le bon est en brouillon, rien n'est livré,
    // et rien ne se propose une seconde fois.
    const bl1 = { ...premier as Doc, id: 'bl1', lines: (premier as Doc).lines.map((l, i) => ({ ...l, qty: [60, 1.25, 1][i] as number })) };
    data.documents.push(bl1);
    expect(C.effectiveStatus(bc, data, company)).toBe('reçue');
    expect(C.suiviCommande(data, bc).lignes.map((x) => [x.livree, x.enPreparation, x.aProposer])).toEqual([[0, 60, 40], [0, 1.25, 1.25], [0, 1, 0]]);

    // Émis : livrée en partie ; le reste se dit, et le bon suivant ne reprend que lui.
    data.documents[1] = numeroter(bl1, 'BL-2026-001', 'émis', '2026-10-02');
    const s = C.suiviCommande(data, bc);
    expect(s.lignes.map((x) => [x.livree, x.reste])).toEqual([[60, 40], [1.25, 1.25], [1, 0]]);
    expect(C.effectiveStatus(bc, data, company)).toBe('partielle');
    expect(C.statusLabel('partielle', 'commande')).toBe('livrée en partie');
    expect(C.statusLabel('partielle', 'facture')).toBe('partiellement payée');
    expect(C.resteALivrerDit(s)).toBe('Reste à livrer sur 2 lignes : Ciment gris 50 kg (40 sac), …');
    const second = C.livraisonDeCommande(data, bc, company, '2026-10-06', client);
    expect(second?.lines.map((l) => [l.label, l.qty, l.ligneCommande])).toEqual([['Ciment gris 50 kg', 40, 0], ['Fer à béton 12 mm', 1.25, 1]]);

    // Un bon annulé ne compte pas ; un bon signé a livré. Tout est parti : livrée, et plus rien à proposer.
    data.documents.push({ ...numeroter(second, 'BL-2026-002', 'annulé', '2026-10-05'), id: 'bl-annule' });
    expect(C.effectiveStatus(bc, data, company)).toBe('partielle');
    data.documents.push({ ...numeroter(second, 'BL-2026-003', 'signé', '2026-10-06'), id: 'bl2' });
    expect(C.effectiveStatus(bc, data, company)).toBe('livrée');
    expect(C.livraisonDeCommande(data, bc, company, '2026-10-07', client)).toBeNull();
    expect(C.suiviCommande(data, bc).bons.map((b) => b.number)).toEqual(['BL-2026-001', 'BL-2026-003']);

    // Livré en plus : dit, jamais compté comme un reste négatif.
    const trop = { ...numeroter(C.convertDoc(bc, 'livraison', company, '2026-10-08', client), 'BL-2026-004', 'émis', '2026-10-08'), id: 'bl3', lines: [{ label: 'Ciment gris 50 kg', qty: 5, unitPrice: 18.5, vatRate: 19, ligneCommande: 0 }] };
    data.documents.push(trop);
    expect(C.suiviCommande(data, bc).lignes[0]).toMatchObject({ commandee: 100, livree: 105, reste: 0, enPlus: 5 });
  });

  it('« livrée » choisie à la main clôt la commande ; un bon d\'avant le rattachement se lit ligne à ligne', () => {
    const bc = commande();
    const data = { company, catalog: [], documents: [bc] as Doc[] };
    data.documents.push(numeroter(C.livraisonDeCommande(data, bc, company, '2026-10-02', client), 'BL-2026-001', 'émis', '2026-10-02'));
    data.documents[1] = { ...data.documents[1] as Doc, id: 'bl1', lines: (data.documents[1] as Doc).lines.map((l, i) => ({ ...l, qty: [60, 2.5, 1][i] as number })) };
    expect(C.effectiveStatus({ ...bc, status: 'livrée' }, data, company)).toBe('livrée');
    expect(C.effectiveStatus({ ...bc, status: 'annulée' }, data, company)).toBe('annulée');
    // Un bon tiré de la commande par la v10 d'avant (sa copie entière, sans rattachement) : même rang, même désignation.
    const ancien = { ...C.convertDoc(bc, 'livraison', company, '2026-10-02', client), id: 'bl-ancien', number: 'BL-2025-090', status: 'signé' };
    const data2 = { company, catalog: [], documents: [bc, ancien] };
    expect(C.effectiveStatus(bc, data2, company)).toBe('livrée');
  });

  it('plusieurs bons d\'un client font une facture égale à la commande ; un bon facturé ne se propose plus ; le stock ne sort qu\'une fois', () => {
    const bc = commande();
    const data = { company, catalog: [{ id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', tracked: true }], documents: [bc] as Doc[] };
    const bl1 = { ...numeroter(C.livraisonDeCommande(data, bc, company, '2026-10-02', client), 'BL-2026-001', 'émis', '2026-10-02'), id: 'bl1' };
    bl1.lines = bl1.lines.map((l, i) => ({ ...l, qty: [60, 1.25, 1][i] as number }));
    data.documents.push(bl1);
    const bl2 = { ...numeroter(C.livraisonDeCommande(data, bc, company, '2026-10-06', client), 'BL-2026-002', 'signé', '2026-10-06'), id: 'bl2' };
    data.documents.push(bl2);
    const brouillon = { ...C.convertDoc(bc, 'livraison', company, '2026-10-07', client), id: 'bl-brouillon', number: 'BL-2026-003' };
    const autreClient = { ...bl2, id: 'bl-autre', number: 'BL-2026-004', clientId: 'c2', fromDocId: '', lines: [{ label: 'Sable de rivière', qty: 3, unit: 'm3', unitPrice: 45.5, vatRate: 19 }] };
    data.documents.push(brouillon, autreClient);
    expect(C.bonsAFacturer(data).map((b) => b.id)).toEqual(['bl1', 'bl2', 'bl-autre']);

    const inv = C.factureDeBons([bl1, bl2], company, '2026-10-08', client);
    if (!inv) throw new Error('facture refusée');
    expect(inv).toMatchObject({ type: 'facture', status: 'brouillon', number: '', clientId: 'c1', fromDocType: 'livraison', fromDocId: 'bl1', subject: 'Chantier Lac 2',
      bonsLivraison: [{ id: 'bl1', number: 'BL-2026-001' }, { id: 'bl2', number: 'BL-2026-002' }] });
    expect(inv.hidePrices).toBeUndefined();
    // Chaque ligne de commande en UNE ligne : la facture égale la commande, au millime (deux chemins, un chiffre).
    expect(inv.lines.map((l) => [l.label, l.qty, 'ligneCommande' in l])).toEqual([['Ciment gris 50 kg', 100, false], ['Fer à béton 12 mm', 2.5, false], ['Transport', 1, false]]);
    expect(C.computeTotals(inv, company).totalHT).toBe(C.computeTotals(bc, company).totalHT);
    expect(C.computeTotals(inv, company).totalHT).toBe(7786.875);
    // Des bons de deux clients, ou de deux devises, ne font pas une facture.
    expect(C.factureDeBons([bl1, autreClient], company, '2026-10-08', client)).toBeNull();
    expect(C.factureDeBons([bl1, { ...bl2, currency: 'EUR' }], company, '2026-10-08', client)).toBeNull();

    // La facture couvre ses deux bons, et eux seuls ; l'historique d'un bon la montre.
    data.documents.push({ ...inv, id: 'fac1' });
    expect(C.bonsAFacturer(data).map((b) => b.id)).toEqual(['bl-autre']);
    expect(C.factureDuBon(data, bl2)?.id).toBe('fac1');
    expect(C.derivedDocs(bl2, data).map((d) => d.id)).toEqual(['fac1']);
    // Une pièce tirée de cette facture (un bon de livraison, par « Transformer ») ne couvre aucun bon.
    expect(C.convertDoc({ ...inv, id: 'fac1' }, 'livraison', company, '2026-10-09', client).bonsLivraison).toBeUndefined();
    // Le stock : 60 puis 40 sacs sortis par les bons ; la facture n'en sort aucun.
    expect(C.stockMovements(data, 'ciment').map((m) => [m.source, m.ref, m.qty])).toEqual([['livraison', 'BL-2026-001', -60], ['livraison', 'BL-2026-002', -40]]);
  });

  it('chaque bon d\'une commande se facture à part : la facture d\'un bon ne couvre pas l\'autre ; une facture de toute la vente les couvre tous', () => {
    const bc = commande();
    const data = { company, catalog: [], documents: [bc] as Doc[] };
    const bl1 = { ...numeroter(C.livraisonDeCommande(data, bc, company, '2026-10-02', client), 'BL-2026-001', 'émis', '2026-10-02'), id: 'bl1' };
    bl1.lines = bl1.lines.map((l, i) => ({ ...l, qty: [60, 1.25, 1][i] as number }));
    data.documents.push(bl1);
    const bl2 = { ...numeroter(C.livraisonDeCommande(data, bc, company, '2026-10-06', client), 'BL-2026-002', 'émis', '2026-10-06'), id: 'bl2' };
    data.documents.push(bl2);
    // « Facturer » un seul bon (la conversion de la v10) : il est couvert, l'autre non.
    data.documents.push({ ...C.convertDoc(bl1, 'facture', company, '2026-10-07', client), id: 'fac-bl1' });
    expect(C.factureDuBon(data, bl1)?.id).toBe('fac-bl1');
    expect(C.factureDuBon(data, bl2)).toBeNull();
    expect(C.bonsAFacturer(data).map((b) => b.id)).toEqual(['bl2']);
    // Une facture d'acompte de la commande ne facture pas la marchandise ; une facture de la commande, si.
    data.documents.push({ ...C.convertDoc(bc, 'facture', company, '2026-10-07', client), id: 'acompte', deposit: { quoteId: 'bc1', percent: 30 } });
    expect(C.factureDuBon(data, bl2)).toBeNull();
    data.documents.push({ ...C.convertDoc(bc, 'facture', company, '2026-10-08', client), id: 'fac-commande' });
    expect(C.factureDuBon(data, bl2)?.id).toBe('fac-commande');
    expect(C.bonsAFacturer(data)).toEqual([]);
  });
});
