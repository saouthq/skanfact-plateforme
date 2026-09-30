// L'encours autorisé d'un client, dans le code de la v10 (web/public/v10/core.js, adapté par
// web/v10/commandes-fournisseurs.txt ; brique 91, 14 § 3.2 : « Encours autorisé par client : au-delà,
// SkanFact avertit »). Le moteur seul :
//   - l'encours : le reste à payer de ses factures émises (en dinars), plus ses bons livrés à facturer (TTC) ;
//   - une pièce qui le ferait dépasser son plafond se dit, avec ses chiffres ; sous le plafond, rien ;
//   - une facture tirée de bons déjà comptés comme livrés ne les compte pas deux fois.
// Les données discriminent : un règlement partiel, une facture en euros au cours 3,3715.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Doc = Record<string, unknown> & { id: string };
type Core = {
  encoursClient: (data: unknown, clientId: string, company: unknown) => { du: number; livre: number; total: number };
  depassementEncours: (data: unknown, doc: Doc, company: unknown) => null | { plafond: number; encours: number; piece: number; apres: number; depasse: number };
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

const company = { name: 'Matériaux Ben Youssef', currency: 'DT', regime: 'reel' };
const ligne = (qty: number, unitPrice: number) => ({ label: 'Ciment gris 50 kg', qty, unit: 'sac', unitPrice, vatRate: 19 });
// 500 HT → 595 TTC à payer (aucun timbre réglé ici), dont 96 réglés : 499 dus.
const f1: Doc = { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-09-01', clientId: 'c1', currency: 'DT', lines: [ligne(20, 25)], payments: [{ date: '2026-09-10', amount: 96 }] };
// En euros : 100 € HT → 119 € TTC, au cours 3,3715 = 401,209 DT.
const f2: Doc = { id: 'f2', type: 'facture', number: 'FAC-2026-002', status: 'envoyée', date: '2026-09-05', clientId: 'c1', currency: 'EUR', exchangeRate: 3.3715, lines: [ligne(4, 25)], payments: [] };
// Un bon livré, pas facturé : 10 sacs à 21,5 = 215 HT, 255,850 TTC.
const bl: Doc = { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: '2026-09-20', clientId: 'c1', currency: 'DT', lines: [ligne(10, 21.5)] };
const autre: Doc = { ...f1, id: 'f9', clientId: 'c2' };
const brouillon: Doc = { ...f1, id: 'f8', status: 'brouillon', number: '' };

describe('l\'encours autorisé d\'un client, dans la v10', () => {
  it('l\'encours : les factures non réglées en dinars, plus les bons livrés à facturer ; ni brouillon ni autre client', () => {
    const data = { company, clients: [{ id: 'c1', name: 'Chantier Ennasr', creditLimit: 1500 }], documents: [f1, f2, bl, autre, brouillon] };
    expect(C.encoursClient(data, 'c1', company)).toMatchObject({ du: 900.209, livre: 255.85, total: 1156.059 });
  });

  it('une pièce qui ferait dépasser le plafond se dit avec ses chiffres ; sous le plafond, rien ; les bons déjà comptés ne comptent pas deux fois', () => {
    const data = { company, clients: [{ id: 'c1', name: 'Chantier Ennasr', creditLimit: 1500 }, { id: 'c2', name: 'Sans plafond' }], documents: [f1, f2, bl] };
    // 1 156,059 dus ou livrés + 300 HT (357 TTC) = 1 513,059 : 13,059 de trop.
    const nouvelle: Doc = { id: 'f3', type: 'facture', status: 'brouillon', clientId: 'c1', currency: 'DT', lines: [ligne(12, 25)] };
    expect(C.depassementEncours(data, nouvelle, company)).toEqual({ plafond: 1500, encours: 1156.059, piece: 357, apres: 1513.059, depasse: 13.059 });
    // 240 HT (285,600 TTC) : 1 441,659, sous le plafond.
    expect(C.depassementEncours(data, { ...nouvelle, lines: [ligne(12, 20)] }, company)).toBeNull();
    // La facture du bon : le bon quitte « livré » en même temps qu'elle entre. Plafonné à 1 200 : 1 156,059 − 255,850
    // + 255,850 reste dessous ; compté deux fois, le bon ferait 1 411,909.
    const serre = { ...data, clients: [{ id: 'c1', name: 'Chantier Ennasr', creditLimit: 1200 }] };
    expect(C.depassementEncours(serre, { ...nouvelle, fromDocId: 'bl1', lines: bl.lines }, company)).toBeNull();
    expect(C.depassementEncours(serre, { ...nouvelle, bonsLivraison: [{ id: 'bl1', number: 'BL-2026-001' }], lines: bl.lines }, company)).toBeNull();
    // Une autre facture du même montant, elle, dépasse.
    expect(C.depassementEncours(serre, { ...nouvelle, lines: bl.lines }, company)?.depasse).toBe(211.909);
    // Un client sans plafond : jamais d'avertissement.
    expect(C.depassementEncours(data, { ...nouvelle, clientId: 'c2', lines: [ligne(1000, 25)] }, company)).toBeNull();
  });
});
