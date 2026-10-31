// Les règles de la banque, fines (1.209.0, maquette « les règles ») : une règle peut se borner à un sens (débit : l'argent
// sort ; crédit : il entre) et à un montant au plus (en millimes), et séparer la TVA d'après son taux et son compte. La
// plus précise passe d'abord (le mot le plus long, puis le sens, puis le montant) ; une borne qu'on ne peut pas vérifier
// ne prend rien. Une règle sans ces champs reste ce qu'elle était.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Regle = { motif: string; compte: string; sens?: string; auPlusMillimes?: number; tva?: { taux: string; compte: string } };
type Ligne = { compte: string; debit: number; credit: number; libelle?: string };
const KC = ecranDeLaPlateforme('compta.js') as {
  compteDuLibelle: (table: Regle[], libelle: string, montant?: number) => { compte: string; motif: string; tva: { taux: number; compte: string } | null; regle: Regle } | null;
  ecritureProposee: (ligne: { date: string; libelle: string; montant: number; reference?: string }, table: Regle[], opts: { compte: string }) => { lignes: Ligne[]; regle: string; aChoisir: boolean };
};

describe('les règles de la banque, bornées et avec TVA', () => {
  it('le sens : une règle « débit » ne prend pas l\'argent qui entre, et sans montant connu une borne ne prend rien', () => {
    const t: Regle[] = [{ motif: 'VERS ESP', compte: '581', sens: 'credit' }];
    expect(KC.compteDuLibelle(t, 'VERS ESP AG ENNASR', 1650)?.compte).toBe('581');
    expect(KC.compteDuLibelle(t, 'VERS ESP AG ENNASR', -1650)).toBeNull();
    expect(KC.compteDuLibelle(t, 'VERS ESP AG ENNASR')).toBeNull();
    // Sans borne, une règle prend dans les deux sens, comme avant.
    expect(KC.compteDuLibelle([{ motif: 'STEG', compte: '6061' }], 'PRLV STEG 0298')?.compte).toBe('6061');
  });

  it('le montant au plus, au millime : 50,000 passe, 50,001 non', () => {
    const t: Regle[] = [{ motif: 'COM CARTE', compte: '6278', sens: 'debit', auPlusMillimes: 50000 }];
    expect(KC.compteDuLibelle(t, 'COM CARTE TPE', -50)?.compte).toBe('6278');
    expect(KC.compteDuLibelle(t, 'COM CARTE TPE', -50.001)).toBeNull();
  });

  it('la plus précise passe : le mot le plus long d\'abord, puis la règle bornée', () => {
    const large: Regle = { motif: 'FRAIS', compte: '6278' };
    const long: Regle = { motif: 'FRAIS TENUE', compte: '6270' };
    expect(KC.compteDuLibelle([long, large], 'FRAIS TENUE DE COMPTE', -11.9)?.regle).toBe(long);
    const borne: Regle = { motif: 'FRAIS', compte: '6271', sens: 'debit' };
    expect(KC.compteDuLibelle([large, borne], 'FRAIS DIVERS', -3)?.regle).toBe(borne);
    // L'ordre du tableau ne change rien.
    expect(KC.compteDuLibelle([borne, large], 'FRAIS DIVERS', -3)?.regle).toBe(borne);
  });

  it('la TVA se sépare d\'après la règle : hors taxe à son compte, la TVA au sien, l\'écriture tombe juste au millime', () => {
    const t: Regle[] = [{ motif: 'FRAIS TENUE', compte: '6278', sens: 'debit', tva: { taux: '19', compte: '4366' } }];
    const e = KC.ecritureProposee({ date: '2026-09-26', libelle: 'FRAIS TENUE DE COMPTE', montant: -11.9 }, t, { compte: '532' });
    expect(e.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', 0, 11.9], ['6278', 10, 0], ['4366', 1.9, 0]]);
    expect(e.regle).toBe('FRAIS TENUE');
    // Un montant qui ne se divise pas rond : la TVA est le reste, la somme reste nulle.
    const f = KC.ecritureProposee({ date: '2026-09-26', libelle: 'FRAIS TENUE DE COMPTE', montant: -12.347 }, t, { compte: '532' });
    expect(f.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', 0, 12.347], ['6278', 10.376, 0], ['4366', 1.971, 0]]);
    // Sans taux réglé dans la règle, rien ne se sépare : la règle inconnue ne fait rien.
    const g = KC.ecritureProposee({ date: '2026-09-26', libelle: 'FRAIS TENUE DE COMPTE', montant: -11.9 }, [{ motif: 'FRAIS TENUE', compte: '6278' }], { compte: '532' });
    expect(g.lignes.map((l) => l.compte)).toEqual(['532', '6278']);
  });
});
