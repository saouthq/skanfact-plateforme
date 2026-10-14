// L'état d'un abonnement, déduit des faits et du jour (serveur/abonnement/etat.ts ; docs/abonnement.md ; skanfact
// docs/cadrage/07-offres-et-prix.md) : l'essai de trente jours, la semaine de grâce, la lecture seule, la période payée,
// la résiliation, la suspension ; les relances (quinze jours, sept jours, la veille, puis la lecture seule) ; la période
// qu'un paiement couvre. Les dates des assertions sont comptées à la main sur le calendrier, jamais recopiées du code.

import { describe, expect, it } from 'vitest';
import { echeanceDe, estJour, etatAbonnement, jourEnFrancais, lireFaits, lireRegles, plusMois, prochainePeriode, relanceDue, type Faits } from '../../serveur/abonnement/etat.ts';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';

// Une entreprise créée le 12/10/2026 : trente jours d'essai, jusqu'au 11/11/2026.
const ESSAI: Faits = { connu: true, essaiJusquAu: '2026-11-11', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null,
  suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, regles: REGLES_DE_DEPART };
const avec = (f: Partial<Faits>): Faits => ({ ...ESSAI, ...f });
// Payée à l'année avant la fin de l'essai : du 12/11/2026 au 11/11/2027.
const PAYEE = avec({ payeJusquAu: '2027-11-11', offre: 'essentiel', periodicite: 'annuel' });

describe('l\'état d\'un abonnement', () => {
  it('ce qui n\'a pas d\'échéance ne se ferme jamais, même expiré', () => {
    const tard = '2030-01-01';
    expect(etatAbonnement(avec({ bacASable: true }), tard)).toEqual({ etat: 'hors', raison: 'bac_a_sable' });
    expect(etatAbonnement(avec({ tenuParCabinet: true }), tard)).toEqual({ etat: 'hors', raison: 'tenu_par_cabinet' });
    expect(etatAbonnement(avec({ offert: true, suspenduLe: '2026-12-01' }), tard)).toEqual({ etat: 'hors', raison: 'offert' });
    expect(etatAbonnement(avec({ connu: false }), tard)).toEqual({ etat: 'hors', raison: 'inconnu' });
    expect(etatAbonnement(avec({ essaiJusquAu: null }), tard)).toEqual({ etat: 'hors', raison: 'inconnu' });
  });

  it('l\'essai : trente jours, le dernier compris', () => {
    expect(etatAbonnement(ESSAI, '2026-10-12')).toEqual({ etat: 'essai', jusquAu: '2026-11-11', jours: 30 });
    // Le 11/11 est le dernier jour de l'essai : il reste zéro jour après aujourd'hui, et tout marche encore.
    expect(etatAbonnement(ESSAI, '2026-11-11')).toEqual({ etat: 'essai', jusquAu: '2026-11-11', jours: 0 });
  });

  it('sept jours de grâce après l\'échéance, puis la lecture seule', () => {
    // Du 12/11 au 18/11 : la grâce (sept jours). Le 19/11 : la lecture seule.
    expect(etatAbonnement(ESSAI, '2026-11-12')).toEqual({ etat: 'en_retard', echeance: '2026-11-11', lectureSeuleLe: '2026-11-19', jours: 7, apresEssai: true });
    expect(etatAbonnement(ESSAI, '2026-11-18')).toEqual({ etat: 'en_retard', echeance: '2026-11-11', lectureSeuleLe: '2026-11-19', jours: 1, apresEssai: true });
    expect(etatAbonnement(ESSAI, '2026-11-19')).toEqual({ etat: 'lecture_seule', depuis: '2026-11-19', raison: 'essai_termine' });
    expect(etatAbonnement(ESSAI, '2027-03-01')).toEqual({ etat: 'lecture_seule', depuis: '2026-11-19', raison: 'essai_termine' });
  });

  it('une période payée : active jusqu\'au bout, puis la même grâce, puis « non renouvelé »', () => {
    // Du 01/12/2026 au 11/11/2027 : 30 (décembre) + 1 + 304 (du 01/01 au 01/11, 2027 n'est pas bissextile) + 10 = 345 jours.
    expect(etatAbonnement(PAYEE, '2026-12-01')).toEqual({ etat: 'actif', offre: 'essentiel', periodicite: 'annuel', jusquAu: '2027-11-11', jours: 345, resilie: false });
    // Payée pendant l'essai : la période payée se dit dès le paiement.
    expect(etatAbonnement(PAYEE, '2026-10-20').etat).toBe('actif');
    expect(etatAbonnement(PAYEE, '2027-11-12')).toEqual({ etat: 'en_retard', echeance: '2027-11-11', lectureSeuleLe: '2027-11-19', jours: 7, apresEssai: false });
    expect(etatAbonnement(PAYEE, '2027-11-19')).toEqual({ etat: 'lecture_seule', depuis: '2027-11-19', raison: 'non_renouvele' });
  });

  it('résilié : la période payée va au bout, puis la lecture seule sans grâce', () => {
    const resilie = { ...PAYEE, resilieLe: '2027-02-01' };
    expect(etatAbonnement(resilie, '2027-06-01')).toMatchObject({ etat: 'actif', resilie: true });
    expect(etatAbonnement(resilie, '2027-11-12')).toEqual({ etat: 'lecture_seule', depuis: '2027-11-12', raison: 'resilie' });
  });

  it('suspendu par SkanFact : la lecture seule le jour même, pas avant', () => {
    const suspendu = avec({ suspenduLe: '2026-10-20' });
    expect(etatAbonnement(suspendu, '2026-10-19').etat).toBe('essai');
    expect(etatAbonnement(suspendu, '2026-10-20')).toEqual({ etat: 'lecture_seule', depuis: '2026-10-20', raison: 'suspendu' });
  });

  it('l\'échéance est le plus tard de l\'essai et de la période payée', () => {
    expect(echeanceDe(ESSAI)).toBe('2026-11-11');
    expect(echeanceDe(PAYEE)).toBe('2027-11-11');
    // Un essai prolongé au-delà d'une période payée (geste de l'exploitant) : c'est lui qui court.
    expect(echeanceDe(avec({ essaiJusquAu: '2028-01-31', payeJusquAu: '2027-11-11' }))).toBe('2028-01-31');
  });
});

describe('les relances', () => {
  const parties = (...rangs: string[]) => rangs.map((rang) => ({ echeance: '2026-11-11', rang }));

  it('quinze jours, sept jours, la veille : la plus pressante que le jour atteint, une fois chacune', () => {
    expect(relanceDue(ESSAI, '2026-10-26', [])).toBeNull();                       // seize jours avant
    expect(relanceDue(ESSAI, '2026-10-27', [])).toEqual({ rang: 'j15', echeance: '2026-11-11', jours: 15 });
    expect(relanceDue(ESSAI, '2026-10-27', parties('j15'))).toBeNull();
    expect(relanceDue(ESSAI, '2026-10-30', parties('j15'))).toBeNull();          // douze jours avant : rien de neuf
    expect(relanceDue(ESSAI, '2026-11-04', parties('j15'))).toEqual({ rang: 'j7', echeance: '2026-11-11', jours: 7 });
    expect(relanceDue(ESSAI, '2026-11-10', parties('j15', 'j7'))).toEqual({ rang: 'j1', echeance: '2026-11-11', jours: 1 });
    expect(relanceDue(ESSAI, '2026-11-10', parties('j15', 'j7', 'j1'))).toBeNull();
  });

  it('un serveur arrêté ne rattrape pas les relances manquées : la plus pressante seulement', () => {
    // Rien n'est parti, et il reste trois jours : la relance des sept jours, pas celle des quinze.
    expect(relanceDue(ESSAI, '2026-11-08', [])).toEqual({ rang: 'j7', echeance: '2026-11-11', jours: 3 });
    // Le jour de l'échéance, sans la veille : elle part (« aujourd'hui »).
    expect(relanceDue(ESSAI, '2026-11-11', parties('j15', 'j7'))).toEqual({ rang: 'j1', echeance: '2026-11-11', jours: 0 });
    // Une relance plus pressante déjà partie couvre les moins pressantes.
    expect(relanceDue(ESSAI, '2026-11-08', parties('j1'))).toBeNull();
  });

  it('pendant la grâce, rien ; le jour de la lecture seule, une fois', () => {
    expect(relanceDue(ESSAI, '2026-11-15', parties('j15', 'j7', 'j1'))).toBeNull();
    expect(relanceDue(ESSAI, '2026-11-19', parties('j15', 'j7', 'j1'))).toEqual({ rang: 'lecture_seule', echeance: '2026-11-11', jours: -8 });
    expect(relanceDue(ESSAI, '2026-11-20', parties('j15', 'j7', 'j1', 'lecture_seule'))).toBeNull();
  });

  it('une échéance nouvelle a ses relances : celles de l\'ancienne ne comptent pas', () => {
    expect(relanceDue(PAYEE, '2027-10-27', parties('j15', 'j7', 'j1'))).toEqual({ rang: 'j15', echeance: '2027-11-11', jours: 15 });
  });

  it('ni pour qui a résilié, ni pour une suspension, ni pour ce qui n\'a pas d\'échéance', () => {
    expect(relanceDue({ ...PAYEE, resilieLe: '2027-01-10' }, '2027-11-10', [])).toBeNull();
    expect(relanceDue(avec({ suspenduLe: '2026-10-20' }), '2026-11-10', [])).toBeNull();
    expect(relanceDue(avec({ offert: true }), '2026-11-10', [])).toBeNull();
    expect(relanceDue(avec({ bacASable: true }), '2026-11-19', [])).toBeNull();
  });
});

describe('la période qu\'un paiement couvre', () => {
  it('payé pendant l\'essai : elle commence le lendemain de l\'échéance, aucun jour d\'essai ne se perd', () => {
    expect(prochainePeriode(ESSAI, 'annuel', '2026-10-20')).toEqual({ debut: '2026-11-12', fin: '2027-11-11' });
    expect(prochainePeriode(ESSAI, 'mensuel', '2026-10-20')).toEqual({ debut: '2026-11-12', fin: '2026-12-11' });
  });

  it('payé pendant la grâce : la même, sans interruption ; après : le jour du paiement', () => {
    expect(prochainePeriode(ESSAI, 'annuel', '2026-11-18')).toEqual({ debut: '2026-11-12', fin: '2027-11-11' });
    expect(prochainePeriode(ESSAI, 'annuel', '2026-11-19')).toEqual({ debut: '2026-11-19', fin: '2027-11-18' });
  });

  it('un renouvellement prend la suite de la période payée', () => {
    expect(prochainePeriode(PAYEE, 'annuel', '2027-10-30')).toEqual({ debut: '2027-11-12', fin: '2028-11-11' });
  });

  it('un mois de calendrier : le 31 janvier plus un mois est le dernier jour de février', () => {
    expect(plusMois('2027-01-31', 1)).toBe('2027-02-28');
    expect(plusMois('2028-01-31', 1)).toBe('2028-02-29');
    expect(plusMois('2028-02-29', 12)).toBe('2029-02-28');
    expect(plusMois('2026-12-15', 1)).toBe('2027-01-15');
    // Une période d'un mois qui commence le 31 janvier finit la veille du 28 février.
    expect(prochainePeriode(avec({ essaiJusquAu: '2027-01-30' }), 'mensuel', '2027-01-20')).toEqual({ debut: '2027-01-31', fin: '2027-02-27' });
  });
});

describe('les jours', () => {
  it('un jour illisible vaut « pas de jour », jamais une date devinée', () => {
    expect(estJour('2026-02-30')).toBe(false);
    expect(estJour('2026-13-01')).toBe(false);
    expect(estJour('2028-02-29')).toBe(true);
    expect(lireFaits({ connu: true, essaiJusquAu: '2026-02-30', offre: 'premium', periodicite: 'hebdo' }))
      .toMatchObject({ connu: true, essaiJusquAu: null, offre: null, periodicite: null });
    expect(jourEnFrancais('2026-11-19')).toBe('19/11/2026');
  });
});

// Les règles réglées dans la console (0104) : la grâce d'une échéance est celle de son lendemain, les relances d'un jour
// celles de ce jour-là ; une règle qu'on ne connaît pas ne ferme rien.
describe('les règles de l\'abonnement, datées', () => {
  // La grâce passe de sept à trois jours le 15/11/2026.
  const TROIS = { ...REGLES_DE_DEPART, grace: [...REGLES_DE_DEPART.grace, { aPartirDu: '2026-11-15', jours: [3] }] };
  const ZERO = { ...REGLES_DE_DEPART, grace: [{ aPartirDu: '2000-01-01', jours: [0] }] };
  const parties = (...rangs: string[]) => rangs.map((rang) => ({ echeance: '2026-11-11', rang }));

  it('une grâce commencée ne change plus ; une échéance d\'après a la nouvelle', () => {
    // L'échéance du 11/11 : sa grâce commence le 12/11, sous l'ancienne règle (sept jours) ; la lecture seule le 19/11.
    expect(etatAbonnement(avec({ regles: TROIS }), '2026-11-16'))
      .toEqual({ etat: 'en_retard', echeance: '2026-11-11', lectureSeuleLe: '2026-11-19', jours: 3, apresEssai: true });
    // L'échéance du 20/11 : sa grâce commence le 21/11, sous la nouvelle (trois jours) ; la lecture seule le 24/11.
    expect(etatAbonnement(avec({ essaiJusquAu: '2026-11-20', regles: TROIS }), '2026-11-22'))
      .toEqual({ etat: 'en_retard', echeance: '2026-11-20', lectureSeuleLe: '2026-11-24', jours: 2, apresEssai: true });
    expect(etatAbonnement(avec({ essaiJusquAu: '2026-11-20', regles: TROIS }), '2026-11-24'))
      .toEqual({ etat: 'lecture_seule', depuis: '2026-11-24', raison: 'essai_termine' });
  });

  it('une grâce de zéro jour : la lecture seule dès le lendemain de l\'échéance', () => {
    expect(etatAbonnement(avec({ regles: ZERO }), '2026-11-11')).toMatchObject({ etat: 'essai', jours: 0 });
    expect(etatAbonnement(avec({ regles: ZERO }), '2026-11-12')).toEqual({ etat: 'lecture_seule', depuis: '2026-11-12', raison: 'essai_termine' });
  });

  it('une grâce qu\'on ne connaît pas ne ferme rien ; l\'essai, lui, se dit', () => {
    expect(etatAbonnement(avec({ regles: lireRegles(null) }), '2027-01-01')).toEqual({ etat: 'hors', raison: 'inconnu' });
    expect(etatAbonnement(avec({ regles: lireRegles(null) }), '2026-11-01')).toMatchObject({ etat: 'essai', jours: 10 });
    // Une ligne illisible ne compte pas : ni un jour faux, ni des jours qui n'en sont pas.
    expect(lireRegles({ grace: [{ aPartirDu: '2026-02-30', jours: [7] }, { aPartirDu: '2026-01-01', jours: ['sept'] }, { aPartirDu: '2026-01-01', jours: [5] }] }))
      .toEqual({ grace: [{ aPartirDu: '2026-01-01', jours: [5] }], relances: [] });
  });

  it('les relances : celles de la règle du jour ; une relance partie sous une autre règle compte encore', () => {
    const f = avec({ regles: { ...REGLES_DE_DEPART, relances: [...REGLES_DE_DEPART.relances, { aPartirDu: '2026-10-28', jours: [10, 3] }] } });
    // Le 27/10, la règle de départ : quinze jours avant le 11/11.
    expect(relanceDue(f, '2026-10-27', [])).toEqual({ rang: 'j15', echeance: '2026-11-11', jours: 15 });
    // Dès le 28/10, dix jours et trois jours : celle des quinze jours, partie, n'empêche pas celle des dix (moins pressante
    // qu'elle n'est pas).
    expect(relanceDue(f, '2026-11-01', parties('j15'))).toEqual({ rang: 'j10', echeance: '2026-11-11', jours: 10 });
    expect(relanceDue(f, '2026-11-08', parties('j15', 'j10'))).toEqual({ rang: 'j3', echeance: '2026-11-11', jours: 3 });
    // Plus de relance la veille : la règle du jour n'en a plus.
    expect(relanceDue(f, '2026-11-10', parties('j15', 'j10', 'j3'))).toBeNull();
    // Aucune règle : aucune relance (une règle qu'on ne connaît pas ne fait rien).
    expect(relanceDue(avec({ regles: { ...REGLES_DE_DEPART, relances: [] } }), '2026-11-10', [])).toBeNull();
  });

  it('la période qu\'un paiement couvre suit la grâce de l\'échéance', () => {
    // Payé le 14/11, dans la grâce de sept jours : la période prend la suite de l'échéance (le 12/11).
    expect(prochainePeriode(avec({}), 'mensuel', '2026-11-14').debut).toBe('2026-11-12');
    // Sans grâce : elle commence le jour du paiement, sans faire payer les jours d'avant.
    expect(prochainePeriode(avec({ regles: ZERO }), 'mensuel', '2026-11-14').debut).toBe('2026-11-14');
  });
});
