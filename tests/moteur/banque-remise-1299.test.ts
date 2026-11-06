// 1.299.0 — la remise de chèques au Cabinet (Menuiserie Ben Salah, Sousse, relevé BIAT d'octobre). L'entreprise a noté
// trois chèques un par un (le pont en a fait trois écritures au 532) ; la banque les crédite en UNE ligne. La Banque du
// Cabinet ne savait relier une ligne qu'à UNE écriture : la remise restait « Rien dans le livre en face », et l'écrire
// comptait l'encaissement deux fois. Les montants ne tombent pas ronds (un millime faux se verrait).
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KC = ecranDeLaPlateforme('compta.js') as Obj;

// Une écriture d'encaissement (532 au débit) ou de sortie (532 au crédit), comme le pont l'écrit.
const bq = (id: string, date: string, montant: number, piece = id, contre = '411') => ({
  id, journal: 'BQ', date, piece, libelle: `Chèque ${piece}`, statut: 'validee',
  lignes: montant > 0
    ? [{ compte: '532', libelle: `Chèque ${piece}`, debit: montant, credit: 0 }, { compte: contre, libelle: piece, debit: 0, credit: montant }]
    : [{ compte: contre, libelle: piece, debit: -montant, credit: 0 }, { compte: '532', libelle: piece, debit: 0, credit: -montant }],
});
const ligne = (id: string, date: string, montant: number, libelle = id) => ({ id, date, libelle, montant, rapprochement: { niveau: 'aucun', ecritureId: '', ligne: -1, le: '', par: '' } });
const livre = (ecritures: Obj[], lignes: Obj[], soldeFin = 0): Obj => ({
  ecritures, audit: [], plan: [{ compte: '532', libelle: 'Banque' }, { compte: '411', libelle: 'Clients' }, { compte: '627', libelle: 'Frais' }, { compte: '4111', libelle: 'Clients' }], releves: [{ id: 'R', compte: '532', du: '2026-10-01', au: '2026-10-31', soldeDebut: 0, soldeFin, lignes }],
});
const ids = (l: Obj[]) => l.map((c) => c.ecritureId);
const k3 = () => bq('k3', '2026-10-27', 728.578, 'CHQ-1180');
const cheques = () => [bq('k1', '2026-10-24', 1011.5, 'CHQ-4471'), bq('k2', '2026-10-25', 1755.845, 'CHQ-0932'), k3()];

describe('la remise se retrouve (remiseDeLigne)', () => {
  it('trois écritures des vingt jours qui font la ligne au millime, et seulement elles', () => {
    const L = livre([...cheques(), bq('v1', '2026-10-15', 3808), bq('loyer', '2026-10-05', -1234.567, 'LOYER', '613')],
      [ligne('l-rem', '2026-10-28', 3495.923, 'REMISE CHEQUES 3 CHQ'), ligne('l-vir', '2026-10-15', 3808)]);
    const r = KC.remiseDeLigne(L, 'R', 'l-rem');
    expect(ids(r.ecritures)).toEqual(['k1', 'k2', 'k3']);
    expect([r.possibles, r.combinaisons]).toEqual([[], 1]);
    // Une ligne qu'une écriture fait seule n'est pas une remise : jugerLigne la prend (certain), remiseDeLigne n'y touche pas.
    expect(KC.candidatsDeLigne(L, 'R', 'l-vir').niveau).toBe('certain');
    expect(KC.candidatsDeLigne(L, 'R', 'l-rem').niveau).toBe('aucun');
  });

  it('deux combinaisons qui font la ligne : rien ne se propose, les écritures en jeu se montrent à cocher', () => {
    const L = livre([bq('a', '2026-10-20', 100.125), bq('b', '2026-10-21', 200.125), bq('c', '2026-10-22', 150.125), bq('d', '2026-10-23', 150.125)],
      [ligne('l', '2026-10-28', 300.25)]);
    const r = KC.remiseDeLigne(L, 'R', 'l');
    expect(r.ecritures).toEqual([]);
    expect(r.combinaisons).toBe(2);
    expect(ids(r.possibles)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hors des vingt jours, d\'un autre sens, à plus de quatre, ou déjà prise par une autre ligne : pas de remise', () => {
    // 21 jours avant la ligne : hors de la fenêtre ; 20 : dedans.
    expect(KC.remiseDeLigne(livre([bq('vieux', '2026-10-07', 1011.5), k3()], [ligne('l', '2026-10-28', 1740.078)]), 'R', 'l').ecritures).toEqual([]);
    expect(ids(KC.remiseDeLigne(livre([bq('recent', '2026-10-08', 1011.5), k3()], [ligne('l', '2026-10-28', 1740.078)]), 'R', 'l').ecritures)).toEqual(['recent', 'k3']);
    // Une sortie ne se mêle pas aux encaissements, même quand les montants sans leur signe feraient la ligne.
    expect(KC.remiseDeLigne(livre([bq('in', '2026-10-24', 1011.5), bq('out', '2026-10-25', -728.578)], [ligne('l', '2026-10-28', 1740.078)]), 'R', 'l').ecritures).toEqual([]);
    // Cinq chèques : la somme ne prouve plus rien ; quatre, si.
    const cinq = [11.111, 22.222, 33.333, 44.444, 55.555].map((x, i) => bq(`q${i}`, `2026-10-2${i}`, x));
    expect(KC.remiseDeLigne(livre(cinq, [ligne('l', '2026-10-28', 166.665)]), 'R', 'l').ecritures).toEqual([]);
    expect(ids(KC.remiseDeLigne(livre(cinq.slice(0, 4), [ligne('l', '2026-10-28', 111.11)]), 'R', 'l').ecritures)).toEqual(['q0', 'q1', 'q2', 'q3']);
    // Le premier chèque répond déjà d'une autre ligne du relevé : il n'entre dans aucune remise.
    const L = livre(cheques(), [ligne('l-k1', '2026-10-24', 1011.5), ligne('l', '2026-10-28', 3495.923)]);
    expect(KC.rapprocherLigne(L, 'R', 'l-k1', { ecritureId: 'k1', ligne: 0 }, 'leila').ok).toBe(true);
    expect(KC.remiseDeLigne(L, 'R', 'l').ecritures).toEqual([]);
  });
});

describe('la remise se pose, se lit, se défait (rapprocherLigne et ce qui compte les écritures prises)', () => {
  const pose = () => {
    const L = livre([...cheques(), bq('frais', '2026-10-31', -18.5, 'FRAIS', '627')],
      [ligne('l-rem', '2026-10-28', 3495.923, 'REMISE CHEQUES 3 CHQ'), ligne('l-fr', '2026-10-31', -18.5, 'FRAIS TENUE DE COMPTE')], 3477.423);
    const r = KC.rapprocherLigne(L, 'R', 'l-rem', { ecritureId: 'k1', ligne: 0, autres: [{ ecritureId: 'k2', ligne: 0 }, { ecritureId: 'k3', ligne: 0 }] }, 'leila', '2026-11-06');
    return { L, r };
  };

  it('posée, la ligne porte les trois écritures ; aucune ne se propose plus ailleurs, aucune n\'est un suspens', () => {
    const { L, r } = pose();
    expect(r).toEqual({ ok: true, niveau: 'certain' });
    const l = L.releves[0].lignes[0];
    expect(KC.facesDuRapprochement(l.rapprochement)).toEqual([{ ecritureId: 'k1', ligne: 0 }, { ecritureId: 'k2', ligne: 0 }, { ecritureId: 'k3', ligne: 0 }]);
    // Le deuxième chèque ne se propose pas à la ligne des frais, même cherché parmi les « libres ».
    expect(ids(KC.candidatsDeLigne(L, 'R', 'l-fr').libres)).toEqual(['frais']);
    // Deux chemins, un chiffre : le livre ne garde en suspens que les frais, et l'écart vient d'eux seuls.
    const s = KC.suspens(L, 'R');
    expect(s.livre.map((c: Obj) => c.ecritureId)).toEqual(['frais']);
    expect(s.banque.map((x: Obj) => x.id)).toEqual(['l-fr']);
    expect(s.ecart).toBe(0);
    // L'automatique ne rejuge pas la ligne posée, et pose les frais.
    const a = KC.rapprocherAuto(L, 'R', { date: '2026-11-06' });
    expect(a.compte.certain).toBe(2);
    expect(KC.suspens(L, 'R').livre).toEqual([]);
  });

  it('une somme qui ne fait pas la ligne, une écriture deux fois, une hors du compte, une déjà prise : refusées en le disant', () => {
    const L = livre([...cheques(), bq('autre', '2026-10-26', 0.001)], [ligne('l', '2026-10-28', 3495.923), ligne('l2', '2026-10-26', 0.001)]);
    const essai = (autres: Obj[], k = 'k1') => KC.rapprocherLigne(L, 'R', 'l', { ecritureId: k, ligne: 0, autres }, 'leila');
    expect(essai([{ ecritureId: 'k2', ligne: 0 }]).motif.replace(/\s/g, ' ')).toBe('Les 2 écritures font 2 767,345, la ligne 3 495,923 : une remise se rapproche quand ses écritures font la ligne au millime.');
    expect(essai([{ ecritureId: 'k2', ligne: 0 }, { ecritureId: 'k2', ligne: 0 }]).motif).toBe('La même ligne d\'écriture est choisie deux fois.');
    expect(essai([{ ecritureId: 'k2', ligne: 1 }, { ecritureId: 'k3', ligne: 0 }]).motif).toBe('Une des écritures choisies ne touche pas le compte 532.');
    expect(KC.rapprocherLigne(L, 'R', 'l2', { ecritureId: 'autre', ligne: 0 }, 'leila').ok).toBe(true);
    expect(essai([{ ecritureId: 'k2', ligne: 0 }, { ecritureId: 'autre', ligne: 0 }]).motif).toBe('autre répond déjà d\'une autre ligne du relevé : défais ce rapprochement d\'abord.');
    // Rien n'a été posé par les refus.
    expect(L.releves[0].lignes[0].rapprochement.ecritureId).toBe('');
  });

  it('une écriture de la remise ne se supprime pas en douce ; son montant ne change pas sans défaire ; défaire rend les trois', () => {
    const { L } = pose();
    L.ecritures.find((e: Obj) => e.id === 'k3').statut = 'brouillard';
    expect(KC.supprimerEcriture(L, 'k3').motif).toMatch(/^Cette écriture est rapprochée d'une ligne de relevé/);
    const k3 = L.ecritures.find((e: Obj) => e.id === 'k3');
    const moins = KC.modifierEcriture(L, 'k3', { lignes: [{ ...k3.lignes[0], debit: 728.5 }, { ...k3.lignes[1], credit: 728.5 }] });
    expect(moins.motif).toMatch(/^Cette écriture est rapprochée d'une ligne de relevé : la ligne 532 de 728,578 change/);
    // Une ligne insérée au-dessus : le lien de la remise suit la ligne 532 à son nouveau rang.
    const ok = KC.modifierEcriture(L, 'k3', { lignes: [{ compte: '4111', libelle: 'ventilé', debit: 0, credit: 28.578 }, k3.lignes[0], { ...k3.lignes[1], credit: 700 }] });
    expect(ok.ok).toBe(true);
    expect(KC.facesDuRapprochement(L.releves[0].lignes[0].rapprochement).at(-1)).toEqual({ ecritureId: 'k3', ligne: 1 });
    expect(KC.derapprocherReleve(L, 'R', 'leila').defaits).toBe(1);
    expect(KC.facesDuRapprochement(L.releves[0].lignes[0].rapprochement)).toEqual([]);
    expect(ids(KC.remiseDeLigne(L, 'R', 'l-rem').ecritures)).toEqual(['k1', 'k2', 'k3']);
  });
});
