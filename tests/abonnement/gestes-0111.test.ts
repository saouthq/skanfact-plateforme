// Les gestes de 0111 sur l'abonnement (serveur/abonnement/gestes.ts ; serveur/abonnement/etat.ts ; la maquette Clients) :
//   - accorder un délai (« Prolonger la grâce », « Réactiver ») : la lecture seule recule, pour SON échéance seulement ;
//   - offrir un mois (0113) : sur la prochaine facture, qui couvre un mois de plus au même prix ; rien ne s'allonge avant ;
//   - changer d'offre : à la prochaine échéance, la période payée allant au bout avec l'offre payée ;
//   - un paiement reçu (0113) : sa preuve, le mois offert qu'il consomme, ce que le renouvellement applique ;
//   - un module (0113) : retiré pendant une période payée, il part au renouvellement ; rouvert, le retrait s'annule.
// Les dates des assertions sont comptées à la main sur le calendrier, jamais recopiées du code.

import { describe, expect, it } from 'vitest';
import { etatAbonnement, type Faits } from '../../serveur/abonnement/etat.ts';
import { calculerGeste, DELAI_MAX_JOURS, type DemandeAbonnement, type LigneAbonnement } from '../../serveur/abonnement/gestes.ts';
import { motif, rendre, t, type Valeurs } from '../../textes/index.ts';
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
  it('sur la prochaine facture, qui couvre un mois de calendrier de plus au même prix ; rien ne s\'allonge avant elle', () => {
    // Payé jusqu'au 11/11/2027, à l'année : la facture suivante couvrira du 12/11/2027 au 11/12/2028 (treize mois) ; la
    // période payée ne bouge pas.
    expect(geste(PAYEE, { geste: 'offrir-mois' }, '2026-12-01')).toEqual({
      apres: { ...ligneDe(PAYEE), mois_offerts: 1 }, details: { du: '2027-11-12', au: '2028-12-11' } });
    // Payé jusqu'au 31/01/2027, au mois : la facture de février couvrira février et mars, jusqu'au 31/03/2027.
    const janvier = avec({ payeJusquAu: '2027-01-31', offre: 'complet', periodicite: 'mensuel' });
    expect(geste(janvier, { geste: 'offrir-mois' }, '2027-01-15').details).toEqual({ du: '2027-02-01', au: '2027-03-31' });
  });

  it('un seul mois attend à la fois ; ni un essai, ni une résiliation, ni une suspension', () => {
    expect(() => calculerGeste({ ...ligneDe(PAYEE), mois_offerts: 1 }, PAYEE, { motif: 'essai', geste: 'offrir-mois' }, '2026-12-01')).toThrow(refus('abonnement.geste.mois_deja'));
    expect(() => geste(ESSAI, { geste: 'offrir-mois' }, '2026-10-20')).toThrow(refus('abonnement.geste.mois_actif'));
    expect(() => geste(avec({ ...PAYEE, resilieLe: '2026-11-30' }), { geste: 'offrir-mois' }, '2026-12-01')).toThrow(refus('abonnement.geste.mois_resilie'));
    expect(() => geste(avec({ ...PAYEE, suspenduLe: '2026-11-30' }), { geste: 'offrir-mois' }, '2026-12-01')).toThrow(refus('abonnement.geste.mois_resilie'));
  });
});

describe('un paiement reçu hors de la plateforme', () => {
  // La facture faite ailleurs, le montant reçu (2 380,500 DT), son moyen, son jour.
  const RECU = { facture: 'F-2026-118', montant: 2380500n, moyen: 'cheque' as const, le: '2026-11-30' };

  it('dit sa preuve, et la garde dans son histoire ; sans elle, rien n\'est payé', () => {
    const { apres, details } = geste(PAYEE, { geste: 'payer', offre: 'essentiel', periodicite: 'annuel', paiement: RECU }, '2026-12-01');
    expect(apres.paye_jusqu_au).toBe('2028-11-11');
    // Payée le 01/12/2026 pour une période qui commence le 12/11/2027 : ce qu'elle change attend ce jour-là (0121).
    expect(details).toEqual({ debut: '2027-11-12', fin: '2028-11-11', facture: 'F-2026-118', montant: '2380500', moyen: 'cheque', le: '2026-11-30', aVenir: true });
    const sans = (p: Partial<typeof RECU> | undefined) => () => geste(PAYEE, { geste: 'payer', offre: 'essentiel', periodicite: 'annuel',
      ...(p ? { paiement: { ...RECU, ...p } } : {}) }, '2026-12-01');
    for (const p of [undefined, { facture: '  ' }, { facture: 'F'.repeat(41) }, { montant: 0n }, { moyen: 'traite' as never }, { le: '2026-12-02' }, { le: '30/11/2026' }]) {
      expect(sans(p)).toThrow(refus('abonnement.geste.paiement_preuve'));
    }
    // L'aperçu se calcule avant que la preuve soit tapée : la période ne dépend pas d'elle.
    expect(calculerGeste(ligneDe(PAYEE), PAYEE, { motif: '', geste: 'payer', offre: 'essentiel', periodicite: 'annuel', apercu: true }, '2026-12-01').apres.paye_jusqu_au)
      .toBe('2028-11-11');
  });

  it('consomme le mois offert qui l\'attendait : la période couvre un mois de plus', () => {
    const { apres, details } = calculerGeste({ ...ligneDe(PAYEE), mois_offerts: 1 }, PAYEE,
      { motif: 'essai', geste: 'payer', offre: 'essentiel', periodicite: 'annuel', paiement: RECU }, '2026-12-01');
    expect(apres).toMatchObject({ paye_jusqu_au: '2028-12-11', mois_offerts: 0 });
    expect(details).toMatchObject({ debut: '2027-11-12', fin: '2028-12-11', moisOffert: true });
  });

  it('payée en retard (en grâce) : le renouvellement s\'applique tout de suite — le module qui partait part, l\'offre changée ne se redit plus', () => {
    const ligne: LigneAbonnement = { ...ligneDe(PAYEE), modules: ['compta', 'paie'], modules_a_retirer: ['paie'],
      suivante_offre: 'complet', suivante_periodicite: 'annuel', suivante_a_partir_du: '2027-11-12' };
    // Le 14/11/2027, la période payée a fini le 11/11 : la nouvelle a commencé le 12, rien n'attend.
    const { apres } = calculerGeste(ligne, PAYEE, { motif: 'essai', geste: 'payer', offre: 'complet', periodicite: 'annuel', paiement: { ...RECU, le: '2027-11-14' } }, '2027-11-14');
    expect(apres).toMatchObject({ offre: 'complet', modules: ['compta'], modules_a_retirer: [], suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null });
    expect(apres.a_venir_le ?? null).toBeNull();
  });

  it('payée avant son premier jour (l\'audit C01) : la période qui court va au bout avec ce qu\'elle avait ; l\'offre payée et le module qui part attendent leur jour', () => {
    const ligne: LigneAbonnement = { ...ligneDe(PAYEE), modules: ['compta', 'paie'], modules_a_retirer: ['paie'],
      suivante_offre: 'complet', suivante_periodicite: 'annuel', suivante_a_partir_du: '2027-11-12' };
    const { apres } = calculerGeste(ligne, PAYEE, { motif: 'essai', geste: 'payer', offre: 'complet', periodicite: 'annuel', paiement: RECU }, '2026-12-01');
    expect(apres).toMatchObject({ offre: 'essentiel', modules: ['compta', 'paie'], modules_a_retirer: [], paye_jusqu_au: '2028-11-11',
      a_venir_le: '2027-11-12', a_venir_offre: 'complet', a_venir_periodicite: 'annuel', a_venir_retraits: ['paie'],
      suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null });
    // Le module qui part avec elle ne se retire pas une seconde fois, et ne se rouvre pas avant son jour.
    expect(() => calculerGeste(apres, PAYEE, { motif: 'essai', geste: 'fermer-module', module: 'paie' }, '2026-12-01'))
      .toThrow(refus('abonnement.geste.module_part_deja', { module: t('abonnement.module.paie') }));
    expect(() => calculerGeste({ ...apres, offre: 'essentiel' }, PAYEE, { motif: 'essai', geste: 'ouvrir-module', module: 'paie' }, '2026-12-01'))
      .toThrow(refus('abonnement.geste.module_part_avec_la_periode', { module: t('abonnement.module.paie'), le: '12/11/2027' }));
  });
});

describe('deux périodes payées d\'avance (l\'audit 1.42.0, A01)', () => {
  // Complet au mois, payé jusqu'au 31/10/2026 ; le 16/10, on paie novembre, puis décembre.
  const COMPLET: Faits = avec({ essaiJusquAu: '2026-09-01', payeJusquAu: '2026-10-31', offre: 'complet', periodicite: 'mensuel' });
  const RECU2 = { facture: 'F-2026-301', montant: 100_000n, moyen: 'virement' as const, le: '2026-10-16' };
  // Paie la période qui vient, puis rend la ligne et les faits d'après (ce que la base relirait).
  const payer = (ligne: LigneAbonnement, offre: 'essentiel' | 'complet', facture: string) => {
    const f = avec({ ...COMPLET, payeJusquAu: ligne.paye_jusqu_au, offre: ligne.offre, periodicite: ligne.periodicite });
    return calculerGeste(ligne, f, { motif: 'essai', geste: 'payer', offre, periodicite: 'mensuel', paiement: { ...RECU2, facture } }, '2026-10-16').apres;
  };

  it('novembre dans l\'offre qui court, puis décembre en Essentiel : Essentiel attend le 1er décembre, jamais le 1er novembre', () => {
    const novembre = payer(ligneDe(COMPLET), 'complet', 'F-1');
    expect(novembre).toMatchObject({ offre: 'complet', paye_jusqu_au: '2026-11-30', a_venir_le: '2026-11-01', a_venir_offre: 'complet' });
    const decembre = payer(novembre, 'essentiel', 'F-2');
    expect(decembre).toMatchObject({ offre: 'complet', paye_jusqu_au: '2026-12-31', a_venir_le: '2026-12-01', a_venir_offre: 'essentiel', a_venir_periodicite: 'mensuel' });
  });

  it('deux changements à deux dates : refusés avant tout argent ; le même changement deux fois : rien ne bouge', () => {
    const ESSENTIEL: LigneAbonnement = { ...ligneDe(COMPLET), offre: 'essentiel' };
    const novembre = payer(ESSENTIEL, 'complet', 'F-1');
    expect(novembre).toMatchObject({ offre: 'essentiel', a_venir_le: '2026-11-01', a_venir_offre: 'complet' });
    expect(() => payer(novembre, 'essentiel', 'F-2')).toThrow(refus('abonnement.geste.deux_changements', { le: '01/11/2026', offre: 'Complet' }));
    // Décembre aussi en Complet : le passage à Complet garde son jour, le 1er novembre.
    expect(payer(novembre, 'complet', 'F-2')).toMatchObject({ paye_jusqu_au: '2026-12-31', a_venir_le: '2026-11-01', a_venir_offre: 'complet' });
    // Un module de plus qui partirait : c'est un second changement, refusé aussi.
    expect(() => payer({ ...novembre, modules: ['paie'], modules_a_retirer: ['paie'] }, 'complet', 'F-2')).toThrow(refus('abonnement.geste.deux_changements', { le: '01/11/2026', offre: 'Complet' }));
  });
});

describe('un module acheté seul', () => {
  const AVEC_PAIE: LigneAbonnement = { ...ligneDe(PAYEE), modules: ['paie'] };

  it('retiré pendant une période payée, il reste jusqu\'à sa fin et part le lendemain ; sans période payée, tout de suite', () => {
    const { apres, details } = calculerGeste(AVEC_PAIE, PAYEE, { motif: 'essai', geste: 'fermer-module', module: 'paie' }, '2026-12-01');
    expect(apres).toMatchObject({ modules: ['paie'], modules_a_retirer: ['paie'] });
    expect(details).toEqual({ module: 'paie', jusquAu: '2027-11-11', auRenouvellement: '2027-11-12' });
    expect(() => calculerGeste(apres, PAYEE, { motif: 'essai', geste: 'fermer-module', module: 'paie' }, '2026-12-01'))
      .toThrow(refus('abonnement.geste.module_part_deja', { module: t('abonnement.module.paie') }));
    // À l'essai, rien n'est payé : il part tout de suite.
    expect(calculerGeste({ ...ligneDe(ESSAI), modules: ['paie'] }, ESSAI, { motif: 'essai', geste: 'fermer-module', module: 'paie' }, '2026-10-20').apres.modules).toEqual([]);
  });

  it('rouvert avant de partir : le retrait prévu s\'annule, ce n\'est pas un achat', () => {
    const { apres, details } = calculerGeste({ ...AVEC_PAIE, modules_a_retirer: ['paie'] }, PAYEE, { motif: 'essai', geste: 'ouvrir-module', module: 'paie' }, '2026-12-01');
    expect(apres).toMatchObject({ modules: ['paie'], modules_a_retirer: [] });
    expect(details).toEqual({ module: 'paie', annuleRetrait: true });
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
