// La lecture d'une facture d'achat, du texte à la proposition (brique 84 ; 14 § 2.3 ; docs/achats.md) :
// serveur/achats/lecture-facture.ts. Sans moteur ni base : le texte que le moteur a tiré des pièces
// d'essai (tests/donnees/lecture, fabriquées par fabriquer.mjs), et des textes écrits pour une règle.
//   - chaque pièce d'essai se lit JUSTE : fournisseur, matricule, numéro, dates, lignes, taux, montants ;
//   - chaque champ proposé dit où il a été lu ;
//   - deux chemins, un chiffre : le total se recompte ; s'il ne tombe pas, c'est dit, et rien n'est choisi ;
//   - notre matricule n'est jamais pris pour celui du fournisseur ; aucun taux n'est supposé.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireFacture, type Proposition } from '../../serveur/achats/lecture-facture.ts';
import { rendreTout } from '../../textes/index.ts';

const NOUS = '7654321B/A/M/000';
const lu = (nom: string) => fs.readFileSync(path.join(import.meta.dirname, '../donnees/lecture', `${nom}.lu.txt`), 'utf8');
// Ce qu'une personne lit : les textes rendus en français.
const vue = (p: Proposition) => rendreTout({ lecture: p.lecture, ou: p.ou, remarques: p.remarques }, 'fr') as {
  lecture: Record<string, unknown> & { lines: { label: string; qty: string; unitPrice: string; vatRate: string | null }[] };
  ou: Record<string, string>; remarques: string[];
};
const net = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('les pièces d\'essai se lisent juste', () => {
  it('la facture écrite par la v10, en PDF (son texte) : tout, au millime, et le total recompté tombe juste', () => {
    const p = lireFacture(lu('quincaillerie'), { notreMatricule: NOUS });
    const v = vue(p);
    expect(v.lecture).toMatchObject({ supplier: 'Quincaillerie Ben Salem', matricule: '1234567A/B/M/000', number: 'FV-2026-0412', date: '2026-10-03', dueDate: '2026-11-02',
      currency: 'TND', fees: '1.000', totalHT: '279.850', totalTTC: '332.222' });
    expect(v.lecture.lines).toEqual([
      { label: 'Vis inox 6x40 (boîte de 200)', qty: '3', unitPrice: '42.35', vatRate: '19' },
      { label: 'Colle à bois 5 kg', qty: '2', unitPrice: '68.9', vatRate: '19' },
      { label: 'Livraison', qty: '1', unitPrice: '15', vatRate: '7' },
    ]);
    expect(p.controle).toEqual({ recompte: 332_222n, lu: 332_222n, juste: true, lignes: 'detail' });
    expect(v.remarques.map(net)).toEqual(['Recompté depuis les montants lus, le total fait 332,222 DT : c\'est celui de la pièce.']);
    // Chaque champ proposé dit où il a été lu : la ligne de la pièce.
    expect(v.ou).toMatchObject({ matricule: 'MF 1234567A/B/M/000 FV-2026-0412', totalHT: 'Banque BIAT Total HT 279,850', fees: 'Timbre fiscal 1,000' });
    expect(v.ou.totalTTC).toMatch(/332,222 DT$/);
    expect(v.ou.date).toMatch(/03\/10\/2026/);
  });

  it('la même, photographiée (penchée, floue) : les quantités perdues se retrouvent (le prix divise le total), les taux perdus aussi (les bases lues)', () => {
    // Le moteur n'a lu ni la colonne TVA, ni deux quantités sur trois (voir le texte).
    expect(lu('quincaillerie-photo')).toMatch(/^Colle à bois 5 kg 68,900 137,800$/m);
    expect(lu('quincaillerie-photo')).toMatch(/^Livraison 15,000 15,000$/m);
    const p = lireFacture(lu('quincaillerie-photo'), { notreMatricule: NOUS });
    expect(vue(p).lecture.lines).toEqual([
      { label: 'Vis inox 6x40 (boîte de 200)', qty: '3', unitPrice: '42.35', vatRate: '19' },
      { label: 'Colle à bois 5 kg', qty: '2', unitPrice: '68.9', vatRate: '19' },
      { label: 'Livraison', qty: '1', unitPrice: '15', vatRate: '7' },
    ]);
    expect(p.controle).toMatchObject({ juste: true, lignes: 'detail' });
    expect(p.lecture).toMatchObject({ matricule: '1234567A/B/M/000', number: 'FV-2026-0412', date: '2026-10-03', totalTTC: '332.222' });
  });

  it('un fournisseur de matériaux : les traits du tableau, une remise par ligne (le prix net), une remise de 0 % qui n\'est pas une TVA, le tableau récapitulatif', () => {
    const p = lireFacture(lu('materiaux'), { notreMatricule: NOUS });
    const v = vue(p);
    expect(v.lecture).toMatchObject({ supplier: 'STE MATERIAUX DU SAHEL SARL', matricule: '0876543K/A/M/000', number: '2026/0158', date: '2026-09-12', dueDate: '2026-10-12',
      totalHT: '766.500', totalTTC: '913.135', fees: '1.000' });
    expect(v.lecture.lines.map((l) => [l.qty, l.unitPrice, l.vatRate])).toEqual([['20', '11.875', '19'], ['40', '9.85', '19'], ['3', '45', '19']]);
    expect(v.lecture.lines[0]?.label).toBe('C425 Ciment gris 42.5 sac 50 kg');
    expect(p.controle).toMatchObject({ recompte: 913_135n, juste: true });
  });

  it('un bureau d\'études : des prestations sans quantité (« 1 500,000 » est mille cinq cents), l\'objet, la date en toutes lettres, une retenue à la source', () => {
    const p = lireFacture(lu('bureau-etudes'), { notreMatricule: NOUS });
    const v = vue(p);
    expect(v.lecture).toMatchObject({ supplier: 'CABINET D\'ÉTUDES TECHNIQUES EL AMEN', matricule: '1112223P/A/P/000', number: 'FA-26-0093', date: '2026-09-25',
      subject: 'Étude de l\'installation électrique de l\'atelier', totalHT: '2000.000', totalTTC: '2381.000' });
    expect(v.lecture.lines).toEqual([
      { label: 'Étude et plans (forfait)', qty: '1', unitPrice: '1500', vatRate: '19' },
      { label: 'Suivi de chantier (5 visites)', qty: '1', unitPrice: '500', vatRate: '19' },
    ]);
    // Le total de la pièce est son TTC (le net à payer en déduit la retenue).
    expect(p.controle).toMatchObject({ recompte: 2_381_000n, lu: 2_381_000n, juste: true });
    expect(v.remarques.map(net)).toContain('La pièce déduit une retenue à la source de 35,700 DT : SkanFact la compte au règlement, pas sur la facture.');
  });

  it('un fournisseur étranger : des euros (deux décimales), une TVA à 0 %, pas de matricule', () => {
    const p = lireFacture(lu('fournisseur-eur'), { notreMatricule: NOUS });
    const v = vue(p);
    expect(v.lecture).toMatchObject({ supplier: 'FOURNITURES PRO SAS', matricule: null, number: 'F-2026-1187', date: '2026-09-02', dueDate: '2026-10-02', currency: 'EUR', totalTTC: '1090.000' });
    expect(v.lecture.lines).toEqual([
      { label: 'Scie circulaire pro', qty: '1', unitPrice: '850', vatRate: '0' },
      { label: 'Lames carbure (lot de 3)', qty: '2', unitPrice: '120', vatRate: '0' },
    ]);
    expect(v.remarques.map(net)).toEqual([
      'Recompté depuis les montants lus, le total fait 1 090,00 EUR : c\'est celui de la pièce.',
      'La pièce est en EUR : saisis le taux de change sur l\'achat avant de l\'enregistrer.',
    ]);
  });
});

describe('les règles de la lecture', () => {
  it('notre matricule n\'est jamais pris pour celui du fournisseur, même lu le premier', () => {
    const texte = ['Client : Atelier Nadia — MF 7654321B/A/M/000', 'Fournisseur : Librairie El Manar — MF 2223334C/A/M/000', 'Facture N° LM-77 du 10/09/2026',
      'Total HT 100,000', 'TVA 19% 19,000', 'Timbre fiscal 1,000', 'Total TTC 120,000'].join('\n');
    expect(lireFacture(texte, { notreMatricule: '7654321 B A M 000' }).lecture.matricule).toBe('2223334C/A/M/000');
    // Sans le connaître, le premier lu serait pris : c'est bien la règle qui choisit.
    expect(lireFacture(texte).lecture.matricule).toBe('7654321B/A/M/000');
  });

  it('un total qui ne tombe pas se dit, avec les deux chiffres, et rien n\'est choisi à la place de la personne', () => {
    const texte = ['Facture N° 12 du 01/09/2026', 'Total HT 100,000', 'TVA 19% 19,000', 'Timbre fiscal 1,000', 'Total TTC 125,000'].join('\n');
    const p = lireFacture(texte);
    expect(p.controle).toMatchObject({ recompte: 120_000n, lu: 125_000n, juste: false });
    // Le total lu reste celui de la pièce, le hors-taxes celui lu : rien n'est « corrigé ».
    expect(p.lecture).toMatchObject({ totalTTC: '125.000', totalHT: '100.000', fees: '1.000' });
    expect(vue(p).remarques.map(net)[0]).toBe('Recompté depuis les montants lus (hors taxes 100,000 DT, TVA 19,000 DT, timbre 1,000 DT), le total fait 120,000 DT ; '
      + 'la pièce annonce 125,000 DT. SkanFact ne choisit pas : vérifie ces montants sur la pièce.');
  });

  it('une TVA qui ne fait pas son taux sur sa base se dit ; le total seul lu, ou le total illisible, se disent aussi', () => {
    const faux = lireFacture(['Total HT 100,000', 'TVA 19% sur 100,000 20,000', 'Total TTC 120,000'].join('\n'));
    expect(vue(faux).remarques.map(net)).toContain('La TVA à 19 % se lit 20,000 DT ; 19 % de 100,000 DT font 19,000 DT.');
    expect(vue(lireFacture('Facture 7\nNet à payer 250,000')).remarques.map(net)[0]).toMatch(/^Le total de la pièce se lit \(250,000 DT\), mais pas assez de ses montants/);
    expect(vue(lireFacture('Total HT 100,000\nTVA 19% 19,000')).remarques.map(net)[0])
      .toBe('Le total de la pièce ne se lit pas : recompté depuis les montants lus, il fait 119,000 DT. Vérifie-le sur la pièce.');
  });

  it('des lignes illisibles : une ligne par taux, depuis les bases lues ; un taux se déduit de la TVA lue s\'il tombe juste, sinon rien n\'est supposé', () => {
    const illisible = ['Désignation Qté P.U. Total', 'Vis 3 42,350 999,999', 'Colle 2 68,900 1,111', 'Total HT 279,850',
      'TVA 7% sur 15,000 1,050', 'TVA 19% sur 264,850 50,322', 'Timbre fiscal 1,000', 'Net à payer 332,222'].join('\n');
    const p = lireFacture(illisible);
    expect(p.controle).toMatchObject({ lignes: 'par_taux', juste: true });
    expect(vue(p).lecture.lines).toEqual([
      { label: 'montant hors taxes soumis à la TVA à 7 %', qty: '1', unitPrice: '15', vatRate: '7' },
      { label: 'montant hors taxes soumis à la TVA à 19 %', qty: '1', unitPrice: '264.85', vatRate: '19' },
    ]);
    const deduit = lireFacture('Total HT 1 000,000\nMontant TVA 70,000\nTotal TTC 1 070,000');
    expect(vue(deduit).lecture.lines).toEqual([{ label: 'montant hors taxes soumis à la TVA à 7 %', qty: '1', unitPrice: '1000', vatRate: '7' }]);
    expect(vue(deduit).remarques.map(net)).toContain('Le taux de TVA ne se lit pas : 70,000 DT de TVA sur 1 000,000 DT hors taxes font 7 %. Vérifie-le.');
    // 71,500 sur 1 000 ne fait pas un nombre entier de pour-cent : aucune ligne, aucun taux inventé.
    expect(lireFacture('Total HT 1 000,000\nMontant TVA 71,500\nTotal TTC 1 071,500').lecture.lines).toEqual([]);
  });

  it('une ligne sans taux lisible ne reçoit aucun taux, et la remarque dit ce que la pièce annonce', () => {
    const texte = ['Désignation Qté Prix Total', 'Papier A4 (ramette) 10 12,000 120,000', 'Encre noire 2 45,000 90,000', 'Total HT 210,000',
      'TVA 7% sur 90,000 6,300', 'TVA 19% sur 100,000 19,000', 'Total TTC 235,300'].join('\n');
    const p = lireFacture(texte);
    // Aucune répartition des lignes ne refait les bases (120 et 90 contre 90 et 100) : les taux restent à dire.
    expect(vue(p).lecture.lines.map((l) => l.vatRate)).toEqual([null, null]);
    expect(vue(p).remarques.map(net)).toContain('Le taux de TVA de 2 lignes ne se lit pas : vérifie-les avant de valider (la pièce annonce 90,000 DT à 7 %, 100,000 DT à 19 %).');
    // Deux répartitions refont les bases (100 à 7 % et 100 à 19 %, deux lignes de 100) : aucune n'est choisie.
    const ambigu = ['Désignation Qté Prix Total', 'Article A 1 100,000 100,000', 'Article B 1 100,000 100,000', 'Total HT 200,000',
      'TVA 7% sur 100,000 7,000', 'TVA 19% sur 100,000 19,000', 'Total TTC 226,000'].join('\n');
    expect(vue(lireFacture(ambigu)).lecture.lines.map((l) => l.vatRate)).toEqual([null, null]);
    // Une seule répartition : elle est proposée.
    const seule = ambigu.replace('Article B 1 100,000 100,000', 'Article B 2 50,000 100,000').replace('Article A 1 100,000 100,000', 'Article A 1 80,000 80,000')
      .replace('Total HT 200,000', 'Total HT 180,000').replace('TVA 7% sur 100,000 7,000', 'TVA 7% sur 80,000 5,600').replace('Total TTC 226,000', 'Total TTC 204,600');
    expect(vue(lireFacture(seule)).lecture.lines.map((l) => l.vatRate)).toEqual(['7', '19']);
  });

  it('les étiquettes au-dessus de leurs valeurs, et une date de livraison qui n\'est pas celle de la pièce', () => {
    const texte = ['Bon de livraison du 01/09/2026', 'Date : 05/09/2026', 'Total HT', '279,850', 'TVA 19%', '53,172', 'Total TTC', '333,022'].join('\n');
    const p = lireFacture(texte);
    expect(p.lecture).toMatchObject({ date: '2026-09-05', totalHT: '279.850', totalTTC: '333.022' });
    expect(p.controle).toMatchObject({ recompte: 333_022n, juste: true });
  });

  it('une pièce adressée à un autre que nous se dit ; la nôtre, non', () => {
    const autre = 'Fournisseur SARL — MF 2223334C/A/M/000\nClient : Garage Sfax — MF 9998887D/A/M/000\nTotal TTC 10,000';
    expect(vue(lireFacture(autre, { notreMatricule: NOUS })).remarques.map(net))
      .toContain('La pièce porte le matricule 9998887D/A/M/000, et pas celui de ta société : vérifie qu\'elle t\'est bien adressée.');
    const nous = 'Fournisseur SARL — MF 2223334C/A/M/000\nClient : Atelier Nadia — MF 7654321B/A/M/000\nTotal TTC 10,000';
    expect(vue(lireFacture(nous, { notreMatricule: NOUS })).remarques.join(' ')).not.toMatch(/adressée/);
  });

  it('le FODEC compte dans le total recompté, et va avec le timbre dans « Timbre et frais »', () => {
    const texte = ['Total HT 1 000,000', 'FODEC 1% 10,000', 'TVA 19% sur 1 010,000 191,900', 'Timbre fiscal 1,000', 'Total TTC 1 202,900'].join('\n');
    const p = lireFacture(texte);
    expect(p.controle).toMatchObject({ recompte: 1_202_900n, juste: true });
    expect(p.lecture.fees).toBe('11.000');
    expect(vue(p).remarques.map(net)).toContain('La pièce porte un FODEC de 10,000 DT : il est compté avec le timbre, dans « Timbre et frais ». À VÉRIFIER avec ton comptable.');
  });

  it('un texte qui n\'est pas une facture : presque rien, et c\'est dit', () => {
    const p = lireFacture('Menu du jour\nCouscous au poisson\nSalade méchouia');
    expect(p.lecture).toMatchObject({ matricule: null, number: null, date: null, totalHT: null, totalTTC: null, lines: [] });
    expect(vue(p).remarques.map(net)).toEqual(['Presque rien ne se lit sur ce fichier (ni matricule, ni date, ni total) : vérifie que la photo est nette, droite et bien éclairée, ou saisis la facture à la main.']);
  });
});
