// Les fiches de l'entreprise reprises d'un autre logiciel (docs/reprise-fiches.md ; web/v10/reprise-fiches.txt) : le moteur
// de la v10, tel que la plateforme le sert. Ce que les règles tiennent :
//   - une liste de fournisseurs se lit comme une liste de clients, avec la banque et le RIB ; un doublon ne passe
//     pas deux fois ; une fiche qui existe se complète, rien de rempli ne change ; une ligne sans nom se refuse ;
//   - sans titres, un RIB se reconnaît à ses vingt chiffres ; un tarif collé chez les fournisseurs se dit ;
//   - un article garde sa référence : deux « T-shirt » aux références différentes sont deux articles, une même
//     référence est le même article, quelle que soit sa désignation ;
//   - les titres d'Odoo et de Sage se reconnaissent.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Ligne = { n: number; statut: string; motifs: string[]; avert: string[]; complete: string[]; objet: Record<string, unknown> };
type Plan = { type: string; entete: boolean; colonnes: string[]; lignes: Ligne[]; nouveaux: number; completes: number; inchanges: number; doublons: number; refus: number; autreListe: string };
type Donnees = { clients: Record<string, unknown>[]; suppliers?: Record<string, unknown>[]; catalog: Record<string, unknown>[]; company: Record<string, unknown> };
const C = ecranDeLaPlateforme('core.js') as {
  planImport: (type: string, texte: string, data: Donnees, company: unknown, choix?: unknown) => Plan;
  appliquerImport: (data: Donnees, plan: Plan, company: unknown) => { crees: string[]; completes: number };
  fournisseurVierge: (extra?: Record<string, unknown>) => Record<string, unknown>;
  IMPORT_CHAMPS: Record<string, { k: string }[]>;
};
const societe = { currency: 'DT', regimeTva: 'reel' };
const tab = (lignes: string[][]) => lignes.map((l) => l.join('\t')).join('\n');

describe('les fiches reprises d\'un autre logiciel', () => {
  it('une liste de fournisseurs : banque et RIB, doublon, fiche complétée sans rien changer de rempli, ligne sans nom refusée', () => {
    const data: Donnees = { clients: [], catalog: [], company: societe, suppliers: [
      { id: 'f-lac', name: 'Papeterie du Lac', contact: '', matricule: '', address: '', phone: '', email: 'achats@papeterie.tn', rib: '', bank: '', notes: '', paymentTermsDays: 30, withholdingRate: '' },
    ] };
    const texte = tab([
      ['Nom', 'Matricule fiscal', 'Téléphone', 'Courriel', 'Banque', 'RIB', 'Rue', 'Ville'],
      ['Papeterie du Lac', '', '71 234 567', 'compta@papeterie.tn', 'BIAT', '08 006 0123456789012 34', 'Rue du Lac', 'Tunis'],
      ['Transports Ben Ali', '1234567A/A/M/000', '74 000 111', 'transports-ben-ali', 'STB', '12345', 'Route de Gabès', 'Sfax'],
      ['Imprimerie Nour', '7654321B/P/M/000', '', '', 'Attijari', '04 018 0000123456789 01', '', 'Sousse'],
      ['Imprimerie Nour', '7654321B/P/M/000', '', '', '', '', '', ''],
      ['', '5555555C/A/M/000', '70 000 000', '', '', '', '', ''],
    ]);
    const p = C.planImport('fournisseurs', texte, data, societe);
    expect(p.colonnes).toEqual(['name', 'matricule', 'phone', 'email', 'bank', 'rib', 'address', 'complement']);
    expect([p.nouveaux, p.completes, p.doublons, p.refus]).toEqual([2, 1, 1, 1]);
    expect(p.lignes.map((l) => l.statut)).toEqual(['existe', 'nouveau', 'nouveau', 'doublon', 'refus']);
    expect(p.lignes[0]?.complete).toEqual(['phone', 'address', 'bank', 'rib']);
    expect(p.lignes[1]?.avert).toEqual([
      'l\'email « transports-ben-ali » n\'a pas la forme d\'une adresse : un envoi n\'arriverait pas.',
      'le RIB « 12345 » n\'a pas les vingt chiffres d\'un RIB tunisien : relis-le avant le premier virement.',
    ]);
    expect(p.lignes[3]?.motifs).toEqual(['même fournisseur que la ligne 4']);
    expect(p.lignes[4]?.motifs).toEqual(['Ligne 6 (5555555C/A/M/000, 70 000 000) : le nom manque — c\'est lui qui se lit sur chaque achat.']);

    const r = C.appliquerImport(data, p, societe);
    expect([r.crees.length, r.completes]).toEqual([2, 1]);
    const [lac, ben, nour] = data.suppliers ?? [];
    // Le rempli ne change pas (l'email, le délai) ; le vide se complète.
    expect(lac).toMatchObject({ id: 'f-lac', email: 'achats@papeterie.tn', paymentTermsDays: 30, phone: '71 234 567', address: 'Rue du Lac\nTunis', bank: 'BIAT', rib: '08 006 0123456789012 34' });
    // Un fournisseur importé naît du même modèle vierge que sa fiche.
    expect(Object.keys(ben ?? {}).sort()).toEqual(Object.keys(C.fournisseurVierge()).sort());
    expect(ben).toMatchObject({ name: 'Transports Ben Ali', matricule: '1234567A/A/M/000', bank: 'STB', rib: '12345', address: 'Route de Gabès\nSfax', paymentTermsDays: '', withholdingRate: '' });
    expect(nour).toMatchObject({ name: 'Imprimerie Nour', rib: '04 018 0000123456789 01', address: 'Sousse' });
    // Recollée, la même liste n'ajoute rien.
    const encore = C.planImport('fournisseurs', texte, data, societe);
    expect([encore.nouveaux, encore.completes]).toEqual([0, 0]);
  });

  it('sans titres, un RIB se reconnaît à ses vingt chiffres ; un tarif collé chez les fournisseurs se dit', () => {
    const data: Donnees = { clients: [], catalog: [], suppliers: [], company: societe };
    const p = C.planImport('fournisseurs', tab([
      ['Papeterie du Lac', 'contact@papeterie.tn', '08006012345678901234'],
      ['Imprimerie Nour', 'nour@imprimerie.tn', '04 018 0000123456789 01'],
    ]), data, societe);
    expect([p.entete, p.colonnes]).toEqual([false, ['name', 'email', 'rib']]);
    // Pour un client, la même colonne n'est pas un RIB : une liste de clients n'en porte pas.
    expect(C.planImport('clients', tab([['Papeterie du Lac', 'contact@papeterie.tn', '08006012345678901234']]), data, societe).colonnes[2]).not.toBe('rib');
    const tarif = C.planImport('fournisseurs', tab([['Désignation', 'Prix HT', 'TVA'], ['Ramette A4', '12,500', '19'], ['Toner', '95,000', '19']]), data, societe);
    expect(tarif.autreListe).toBe('catalogue');
  });

  it('un article garde sa référence : deux références, deux articles ; une même référence, le même article', () => {
    const data: Donnees = { clients: [], company: societe, catalog: [
      { id: 'a-casq', label: 'Casquette brodée', code: 'CQ-01', unitPrice: 15, unitCost: 6, vatRate: 19, unit: '', description: '' },
      { id: 'a-mug', label: 'Mug blanc', code: '', unitPrice: 8, unitCost: 3, vatRate: 19, unit: '', description: '' },
    ] };
    // Comme Odoo l'exporte : « Nom », « Référence interne », « Prix de vente », « Coût », « Unité de mesure », « Quantité en stock ».
    const p = C.planImport('catalogue', tab([
      ['Nom', 'Référence interne', 'Prix de vente', 'Coût', 'Unité de mesure', 'Quantité en stock'],
      ['T-shirt', 'TS-M', '25,000', '9,500', 'Unités', '12'],
      ['T-shirt', 'TS-L', '25,000', '9,500', 'Unités', '7'],
      ['T-shirt', 'TS-M', '25,000', '9,500', 'Unités', '12'],
      ['Casquette', 'CQ-01', '16,000', '6,000', 'Unités', '4'],
      ['Mug blanc', 'MG-01', '8,000', '3,000', 'Unités', ''],
    ]), data, societe);
    expect(p.colonnes).toEqual(['label', 'code', 'unitPrice', 'unitCost', 'unit', 'initialQty']);
    expect(p.lignes.map((l) => l.statut)).toEqual(['nouveau', 'nouveau', 'doublon', 'existe', 'existe']);
    expect(p.lignes[2]?.motifs).toEqual(['même prestation que la ligne 2']);
    // La casquette est la même par sa référence ; le mug, par sa désignation, et il prend la référence qui lui manquait.
    expect([p.lignes[3]?.complete, p.lignes[4]?.complete]).toEqual([['unit'], ['code', 'unit']]);
    const r = C.appliquerImport(data, p, societe);
    expect(r.crees.length).toBe(2);
    expect(data.catalog.map((a) => [a.label, a.code, a.unitPrice, a.unit, a.initialQty ?? 0])).toEqual([
      ['Casquette brodée', 'CQ-01', 15, 'u', 0], ['Mug blanc', 'MG-01', 8, 'u', 0], ['T-shirt', 'TS-M', 25, 'u', 12], ['T-shirt', 'TS-L', 25, 'u', 7],
    ]);
  });

  it('les titres d\'Odoo et de Sage se reconnaissent', () => {
    const data: Donnees = { clients: [], catalog: [], company: societe };
    // Odoo en anglais : « Display Name », « Street2 » ; Sage : « N° identifiant ».
    const p = C.planImport('clients', tab([['Display Name', 'N° identifiant', 'Street', 'Street2', 'City', 'Phone'], ['Hôtel du Lac', '1234567A/A/M/000', 'Rue du Lac', 'Bloc B', 'Tunis', '71 000 000']]), data, societe);
    expect(p.colonnes).toEqual(['name', 'matricule', 'address', 'address', 'complement', 'phone']);
    expect(p.lignes[0]?.objet).toMatchObject({ name: 'Hôtel du Lac', matricule: '1234567A/A/M/000', address: 'Rue du Lac\nBloc B\nTunis' });
    // En français, Odoo écrit « Nom affiché » et « Rue 2 » : leurs mots suffisaient déjà.
    expect(C.planImport('clients', tab([['Nom affiché', 'Rue', 'Rue 2'], ['Hôtel du Lac', 'Rue du Lac', 'Bloc B']]), data, societe).colonnes).toEqual(['name', 'address', 'address']);
    // « Code TVA » n'est pas une référence d'article, ni « Code client » le nom d'un client.
    expect(C.planImport('catalogue', tab([['Désignation', 'Code TVA', 'Prix HT'], ['Ramette', '19', '12,500']]), data, societe).colonnes[1]).not.toBe('code');
    expect(C.planImport('clients', tab([['Code client', 'Nom', 'Téléphone'], ['C-0042', 'Hôtel du Lac', '71 000 000']]), data, societe).colonnes).toEqual(['', 'name', 'phone']);
  });
});
