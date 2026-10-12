// L'état d'un abonnement, déduit des faits et du jour (serveur/abonnement/etat.ts ; docs/abonnement.md ; skanfact
// docs/cadrage/07-offres-et-prix.md) : l'essai de trente jours, la semaine de grâce, la lecture seule, la période payée,
// la résiliation, la suspension ; les relances (quinze jours, sept jours, la veille, puis la lecture seule) ; la période
// qu'un paiement couvre. Les dates des assertions sont comptées à la main sur le calendrier, jamais recopiées du code.

import { describe, expect, it } from 'vitest';
import { echeanceDe, estJour, etatAbonnement, jourEnFrancais, lireFaits, plusMois, prochainePeriode, relanceDue, type Faits } from '../../serveur/abonnement/etat.ts';

// Une entreprise créée le 12/10/2026 : trente jours d'essai, jusqu'au 11/11/2026.
const ESSAI: Faits = { connu: true, essaiJusquAu: '2026-11-11', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null,
  suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false };
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
