// La Banque du Cabinet, ce qu'une ligne du relevé PAIE quand le livre n'a pas encore son écriture de banque (1.208.0,
// maquette B7, B12, B13) : une facture ouverte du même montant, une facture payée au net de sa retenue à la source (à un
// taux réglé par le cabinet, au millime), plusieurs factures dont la somme fait la remise. Seule une réponse UNIQUE se
// propose, et l'écriture de règlement solde chaque pièce (pour que le lettrage la referme).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiers?: string; libelle?: string; lettre?: string };
type Ecriture = { id: string; date: string; journal: string; piece: string; libelle: string; statut: string; lignes: Ligne[] };
type LigneReleve = { id: string; date: string; libelle: string; reference: string; montant: number };
type Livre = { ecritures: Ecriture[]; releves: { id: string; compte: string; lignes: LigneReleve[] }[] };
type Piece = { ecritureId: string; piece: string; tiers: string; compte: string; reste: number; entiere: boolean; seule: boolean; statut: string };
type Reponses = { ouvertes: Piece[]; proposees: Piece[]; pourquoi: string; retenue: { taux: number; montant: number } | null; remise: Piece[] | null };
const KC = ecranDeLaPlateforme('compta.js') as {
  piecesOuvertes: (livre: Livre, sens: number, opts?: unknown) => Piece[];
  reponsesDeLigne: (livre: Livre, releve: string, ligne: string, opts?: unknown) => Reponses;
  retenueDeReglement: (pieces: Piece[], montant: number, taux: number[]) => { taux: number; montant: number } | null;
  ecritureDeReglement: (ligne: LigneReleve, pieces: Piece[], opts: unknown) => { lignes: Ligne[]; piece: string };
};

const vente = (id: string, date: string, piece: string, tiers: string, ttc: number, statut = 'validee'): Ecriture => ({ id, date, journal: 'VT', piece, libelle: `Facture ${tiers}`, statut,
  lignes: [{ compte: '411', tiers, debit: ttc, credit: 0 }, { compte: '7071', debit: 0, credit: ttc }] });
const achat = (id: string, date: string, piece: string, tiers: string, ttc: number, statut = 'brouillard'): Ecriture => ({ id, date, journal: 'AC', piece, libelle: `Facture ${tiers}`, statut,
  lignes: [{ compte: '6022', debit: ttc, credit: 0 }, { compte: '401', tiers, debit: 0, credit: ttc }] });
// La première ligne du relevé d'un livre d'essai.
const ligne1 = (L: Livre): LigneReleve => { const r = L.releves[0]?.lignes[0]; if (!r) throw new Error('relevé vide'); return r; };
const livre = (ecritures: Ecriture[], lignes: Omit<LigneReleve, 'reference'>[]): Livre => ({ ecritures, releves: [{ id: 'r', compte: '532', lignes: lignes.map((l) => ({ reference: '', ...l })) }] });

describe('ce qu\'une ligne du relevé paie', () => {
  it('une facture ouverte du même montant se propose, avec le mot de la banque et « la seule non réglée »', () => {
    const L = livre([achat('a1', '2026-09-30', 'FA-0919', 'STEG', 186.419), achat('a2', '2026-09-12', 'FA-0913', 'Levures du Sahel', 407.197)],
      [{ id: 'l1', date: '2026-10-02', libelle: 'PRLV STEG 0298 4471', montant: -186.419 }]);
    const r = KC.reponsesDeLigne(L, 'r', 'l1');
    expect(r.proposees.map((p) => p.piece)).toEqual(['FA-0919']);
    expect(r.pourquoi).toBe('même montant · « STEG » · la seule non réglée');
    // Un virement reçu ne paie jamais une facture de fournisseur : le sens choisit le compte.
    expect(KC.piecesOuvertes(L, 1)).toEqual([]);
  });

  it('une facture déjà couverte par un règlement non lettré du même tiers ne se propose plus (on la paierait deux fois)', () => {
    const regle: Ecriture = { id: 'b1', date: '2026-09-20', journal: 'BQ', piece: '', libelle: 'VIR RECU CAFE JASMIN', statut: 'brouillard',
      lignes: [{ compte: '532', debit: 512, credit: 0 }, { compte: '411', tiers: 'Café Jasmin', debit: 0, credit: 512 }] };
    const L = livre([vente('v1', '2026-07-20', 'FV-0379', 'Café Jasmin', 512), vente('v2', '2026-08-20', 'FV-0386', 'Café Jasmin', 512), regle],
      [{ id: 'l1', date: '2026-09-25', libelle: 'VIR RECU CAFE JASMIN', montant: 512 }]);
    // La plus ancienne est payée : seule FV-0386 reste ouverte, et c'est elle qui se propose.
    expect(KC.piecesOuvertes(L, 1).map((p) => p.piece)).toEqual(['FV-0386']);
    expect(KC.reponsesDeLigne(L, 'r', 'l1').proposees.map((p) => p.piece)).toEqual(['FV-0386']);
  });

  it('deux factures du même montant : le tiers que la banque nomme départage, sinon rien ne se propose', () => {
    const L = livre([vente('v1', '2026-09-02', 'FV-01', 'Hôtel Dar Jerba', 610.5), vente('v2', '2026-09-03', 'FV-02', 'Épicerie Ennour', 610.5)],
      [{ id: 'l1', date: '2026-09-25', libelle: 'VIR RECU HOTEL DAR JERBA', montant: 610.5 }, { id: 'l2', date: '2026-09-25', libelle: 'VIR RECU 0042', montant: 610.5 }]);
    expect(KC.reponsesDeLigne(L, 'r', 'l1').proposees.map((p) => p.piece)).toEqual(['FV-01']);
    expect(KC.reponsesDeLigne(L, 'r', 'l2').proposees).toEqual([]);
  });

  it('au net de sa retenue : reconnue au millime à un taux du cabinet, jamais sans taux réglé', () => {
    const L = livre([achat('a1', '2026-09-03', 'FA-0914', 'Minoterie du Cap Bon', 1846.2)],
      [{ id: 'l1', date: '2026-09-08', libelle: 'VIR Minoterie du Cap Bon', montant: -1818.507 }]);
    // Aucun taux : la ligne paie moins que la facture, c'est un écart, rien ne se propose (la règle inconnue ne fait rien).
    expect(KC.reponsesDeLigne(L, 'r', 'l1').proposees).toEqual([]);
    const r = KC.reponsesDeLigne(L, 'r', 'l1', { taux: [3, 1.5] });
    expect(r.proposees.map((p) => p.piece)).toEqual(['FA-0914']);
    expect(r.retenue).toEqual({ taux: 1.5, montant: 27.693 });
    expect(r.pourquoi).toBe('net de sa retenue 27,693 · certificat à remettre');
    // Un millime de trop et ce n'est plus une retenue : un paiement partiel ne se déguise pas en retenue.
    expect(KC.retenueDeReglement(r.proposees, -1818.506, [1.5])).toBeNull();
    // L'écriture : 401 au débit pour toute la facture, la banque pour le net, la retenue opérée (une dette) pour le reste.
    const ec = KC.ecritureDeReglement(ligne1(L), r.proposees, { compte: '532', retenue: r.retenue });
    expect(ec.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', 0, 1818.507], ['401', 1846.2, 0], ['4352', 0, 27.693]]);
    expect(ec.lignes[1]?.tiers).toBe('Minoterie du Cap Bon');
  });

  it('une retenue subie par un client va au 4358 (une créance), au débit', () => {
    const L = livre([vente('v1', '2026-09-15', 'FV-0388', 'Hôtel Dar Jerba', 2446)],
      [{ id: 'l1', date: '2026-09-20', libelle: 'VIR RECU Hotel Dar Jerba', montant: 2409.31 }]);
    const r = KC.reponsesDeLigne(L, 'r', 'l1', { taux: [1.5] });
    expect(r.pourquoi).toBe('net de sa retenue 36,690 · certificat à demander');
    const ec = KC.ecritureDeReglement(ligne1(L), r.proposees, { compte: '532', retenue: r.retenue });
    expect(ec.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', 2409.31, 0], ['411', 0, 2446], ['4358', 36.69, 0]]);
  });

  it('une remise de chèques : trois factures dont la somme fait la ligne, ventilées une par une', () => {
    const L = livre([vente('v1', '2026-07-20', 'FV-0379', 'Café Jasmin', 512), vente('v2', '2026-07-24', 'FV-0391', 'Hôtel Dar Jerba', 610.5),
      vente('v3', '2026-07-28', 'FV-0398', 'Épicerie Ennour', 220), vente('v4', '2026-07-29', 'FV-0399', 'Épicerie Ennour', 97.25)],
    [{ id: 'l1', date: '2026-09-25', libelle: 'REMISE CHQ 3 CHEQUES', montant: 1342.5 }]);
    const r = KC.reponsesDeLigne(L, 'r', 'l1');
    expect(r.proposees.map((p) => p.piece).sort()).toEqual(['FV-0379', 'FV-0391', 'FV-0398']);
    expect(r.pourquoi).toBe('3 pièces : leur somme fait la ligne');
    const ec = KC.ecritureDeReglement(ligne1(L), r.proposees, { compte: '532' });
    expect(ec.lignes.reduce((s, l) => s + l.debit - l.credit, 0)).toBeCloseTo(0, 6);
    expect(ec.lignes.filter((l) => l.compte === '411').map((l) => l.libelle).sort()).toEqual(['Café Jasmin · lettre FV-0379', 'Hôtel Dar Jerba · lettre FV-0391', 'Épicerie Ennour · lettre FV-0398']);
    // Deux combinaisons qui tombent juste : on ne choisit pas à la place du comptable.
    const L2 = livre([...L.ecritures, vente('v5', '2026-07-30', 'FV-0400', 'Café Jasmin', 732)], L.releves[0]?.lignes ?? []);
    expect(KC.reponsesDeLigne(L2, 'r', 'l1').proposees).toEqual([]);
  });

  it('une pièce lettrée ou au brouillard le dit : lettrable seulement validée, entière et seule sur son compte', () => {
    const v = vente('v1', '2026-09-02', 'FV-01', 'Café Jasmin', 100);
    const b = vente('v2', '2026-09-03', 'FV-02', 'Café Jasmin', 50, 'brouillard');
    const lettree = vente('v3', '2026-09-04', 'FV-03', 'Café Jasmin', 70);
    const l0 = lettree.lignes[0];
    if (l0) l0.lettre = 'A';
    const p = KC.piecesOuvertes(livre([v, b, lettree], []), 1);
    expect(p.map((x) => [x.piece, x.statut, x.entiere, x.seule])).toEqual([['FV-02', 'brouillard', true, true], ['FV-01', 'validee', true, true]]);
  });
});
