// Les gestes de 0111 sur l'abonnement (serveur/abonnement/gestes.ts ; serveur/abonnement/etat.ts ; la maquette Clients) :
//   - accorder un délai (« Prolonger la grâce », « Réactiver ») : la lecture seule recule, pour SON échéance seulement ;
//   - offrir un mois : la période payée s'allonge d'un mois de calendrier, sans facture ;
//   - changer d'offre : à la prochaine échéance, la période payée allant au bout avec l'offre payée.
// Les dates des assertions sont comptées à la main sur le calendrier, jamais recopiées du code.

import { describe, expect, it } from 'vitest';
import { etatAbonnement, type Faits } from '../../serveur/abonnement/etat.ts';
import { calculerGeste, DELAI_MAX_JOURS, type DemandeAbonnement, type LigneAbonnement } from '../../serveur/abonnement/gestes.ts';
import { motif, rendre, type Valeurs } from '../../textes/index.ts';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';

// Une entreprise créée le 12/10/2026 : trente jours d'essai, jusqu'au 11/11/2026 ; sept jours de grâce, la lecture seule
// le 19/11.
const ESSAI: Faits = { connu: true, essaiJusquAu: '2026-11-11', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null,
  suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, regles: REGLES_DE_DEPART };
const avec = (f: Partial<Faits>): Faits => ({ ...ESSAI, ...f });
// Payée à l'année : jusqu'au 11/11/2027.
const PAYEE = avec({ payeJusquAu: '2027-11-11', offre: 'essentiel', periodicite: 'annuel' });
const ligneDe = (f: Faits): LigneAbonnement => ({ essai_jusqu_au: f.essaiJusquAu ?? '', paye_jusqu_au: f.payeJusquAu, offre: f.offre, periodicite: f.periodicite,
  resilie_le: f.resilieLe, suspendu_le: f.suspenduLe, offert: f.offert, modules: [] });
const geste = (f: Faits, d: Omit<DemandeAbonnement, 'motif'>, jour: string) => calculerGeste(ligneDe(f), f, { motif: 'essai', ...d }, jour);
// Le refus d'un geste, tel que la console le dit.
const refus = (cle: string, valeurs?: Valeurs) => rendre(motif(cle, valeurs), 'fr');

describe('accorder un délai', () => {
  it('en grâce : la lecture seule recule de ces jours, à partir de son jour prévu', () => {
    // Le 14/11, en grâce : la lecture seule tombe le 19/11. Dix jours de délai : elle tombe le 29/11 (dernier jour ouvert
    // le 28/11).
    const { apres, details } = geste(ESSAI, { geste: 'accorder-delai', jours: 10 }, '2026-11-14');
    expect(apres).toMatchObject({ delai_echeance: '2026-11-11', delai_jusqu_au: '2026-11-28' });
    expect(details).toEqual({ jours: 10, jusquAu: '2026-11-28' });
    const f = avec({ delai: { echeance: '2026-11-11', jusquAu: '2026-11-28' } });
    expect(etatAbonnement(f, '2026-11-20')).toMatchObject({ etat: 'en_retard', echeance: '2026-11-11', lectureSeuleLe: '2026-11-29' });
    expect(etatAbonnement(f, '2026-11-28')).toMatchObject({ etat: 'en_retard', jours: 1 });
    expect(etatAbonnement(f, '2026-11-29')).toEqual({ etat: 'lecture_seule', depuis: '2026-11-29', raison: 'essai_termine' });
  });

  it('en lecture seule après l\'essai : tout se rouvre aujourd\'hui, jusqu\'au dernier de ces jours', () => {
    // Le 01/12, en lecture seule depuis le 19/11. Sept jours : ouvert du 01/12 au 07/12, la lecture seule revient le 08/12.
    const { apres } = geste(ESSAI, { geste: 'accorder-delai', jours: 7 }, '2026-12-01');
    expect(apres).toMatchObject({ delai_echeance: '2026-11-11', delai_jusqu_au: '2026-12-07' });
    const f = avec({ delai: { echeance: '2026-11-11', jusquAu: '2026-12-07' } });
    expect(etatAbonnement(f, '2026-12-01')).toMatchObject({ etat: 'en_retard', lectureSeuleLe: '2026-12-08', jours: 7 });
    expect(etatAbonnement(f, '2026-12-08')).toEqual({ etat: 'lecture_seule', depuis: '2026-12-08', raison: 'essai_termine' });
  });

  it('un délai ne vaut que pour son échéance, et jamais pour raccourcir la grâce', () => {
    // Le délai d'une autre échéance ne rouvre rien : le 20/11, la lecture seule tombée le 19/11 reste.
    expect(etatAbonnement(avec({ delai: { echeance: '2026-10-01', jusquAu: '2026-12-31' } }), '2026-11-20'))
      .toEqual({ etat: 'lecture_seule', depuis: '2026-11-19', raison: 'essai_termine' });
    // Un délai plus court que la grâce ne l'avance pas : la lecture seule tombe toujours le 19/11.
    expect(etatAbonnement(avec({ delai: { echeance: '2026-11-11', jusquAu: '2026-11-14' } }), '2026-11-16')).toMatchObject({ etat: 'en_retard', lectureSeuleLe: '2026-11-19' });
  });

  it('de 1 à 60 jours, en grâce ou en lecture seule après une échéance manquée ; jamais sur un abonné qui court ni une suspension', () => {
    expect(() => geste(ESSAI, { geste: 'accorder-delai', jours: 0 }, '2026-11-14')).toThrow(refus('abonnement.geste.delai_jours', { max: DELAI_MAX_JOURS }));
    expect(() => geste(ESSAI, { geste: 'accorder-delai', jours: DELAI_MAX_JOURS + 1 }, '2026-11-14')).toThrow(refus('abonnement.geste.delai_jours', { max: DELAI_MAX_JOURS }));
    expect(geste(ESSAI, { geste: 'accorder-delai', jours: DELAI_MAX_JOURS }, '2026-11-14').apres.delai_jusqu_au).toBe('2027-01-17');
    expect(() => geste(PAYEE, { geste: 'accorder-delai', jours: 7 }, '2026-12-01')).toThrow(refus('abonnement.geste.delai_etat'));
    expect(() => geste(ESSAI, { geste: 'accorder-delai', jours: 7 }, '2026-11-01')).toThrow(refus('abonnement.geste.delai_etat'));
    expect(() => geste(avec({ suspenduLe: '2026-11-15' }), { geste: 'accorder-delai', jours: 7 }, '2026-11-16')).toThrow(refus('abonnement.geste.delai_etat'));
  });
});

describe('offrir un mois', () => {
  it('la période payée court un mois de calendrier de plus, la fin d\'un mois court comprise', () => {
    // Payé jusqu'au 11/11/2027 : un mois offert, jusqu'au 11/12/2027.
    expect(geste(PAYEE, { geste: 'offrir-mois' }, '2026-12-01')).toEqual({
      apres: { ...ligneDe(PAYEE), paye_jusqu_au: '2027-12-11' }, details: { de: '2027-11-11', a: '2027-12-11' } });
    // Payé jusqu'au 31/01/2027 (le mois de janvier) : le mois offert est février, jusqu'au 28/02/2027.
    const janvier = avec({ payeJusquAu: '2027-01-31', offre: 'complet', periodicite: 'mensuel' });
    expect(geste(janvier, { geste: 'offrir-mois' }, '2027-01-15').apres.paye_jusqu_au).toBe('2027-02-28');
  });

  it('à un abonné qui court seulement : ni un essai, ni une résiliation qui court à sa fin', () => {
    expect(() => geste(ESSAI, { geste: 'offrir-mois' }, '2026-10-20')).toThrow(refus('abonnement.geste.mois_actif'));
    expect(() => geste(avec({ ...PAYEE, resilieLe: '2026-11-30' }), { geste: 'offrir-mois' }, '2026-12-01')).toThrow(refus('abonnement.geste.mois_resilie'));
  });
});

describe('changer d\'offre', () => {
  it('à la prochaine échéance ; revenir à l\'offre qui court efface le changement prévu', () => {
    // Essentiel à l'année jusqu'au 11/11/2027 : Complet à partir du 12/11/2027 ; rien d'autre ne change.
    const { apres, details } = geste(PAYEE, { geste: 'changer-offre', offre: 'complet', periodicite: 'annuel' }, '2026-12-01');
    expect(apres).toEqual({ ...ligneDe(PAYEE), suivante_offre: 'complet', suivante_periodicite: 'annuel', suivante_a_partir_du: '2027-11-12' });
    // Le détail ne dit que le jour : jamais « offre », qui dirait que l'offre qui court a changé.
    expect(details).toEqual({ aPartirDu: '2027-11-12' });
    // L'offre qui court, alors qu'un changement est prévu : il s'efface.
    const prevu = { ...ligneDe(PAYEE), suivante_offre: 'complet' as const, suivante_periodicite: 'annuel' as const, suivante_a_partir_du: '2027-11-12' };
    expect(calculerGeste(prevu, PAYEE, { motif: 'essai', geste: 'changer-offre', offre: 'essentiel', periodicite: 'annuel' }, '2026-12-01').apres)
      .toMatchObject({ suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null });
  });

  it('jamais sans offre, ni sur une résiliation, ni pour l\'offre qui court déjà', () => {
    expect(() => geste(ESSAI, { geste: 'changer-offre', offre: 'complet', periodicite: 'annuel' }, '2026-10-20')).toThrow(refus('abonnement.geste.changer_sans_offre'));
    expect(() => geste(avec({ ...PAYEE, resilieLe: '2026-11-30' }), { geste: 'changer-offre', offre: 'complet', periodicite: 'annuel' }, '2026-12-01'))
      .toThrow(refus('abonnement.geste.changer_resilie'));
    expect(() => geste(PAYEE, { geste: 'changer-offre', offre: 'essentiel', periodicite: 'annuel' }, '2026-12-01')).toThrow(refus('abonnement.geste.changer_meme'));
  });
});
