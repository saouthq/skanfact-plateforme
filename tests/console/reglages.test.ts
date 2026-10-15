// Les réglages de la plateforme, rangés sans la base (serveur/console/reglages.ts ; docs/console.md C28) : la grille du
// jour lue dans les prix datés, le registre des règles communes et ce que leur dernière relecture dit, ce que le journal
// garde d'un geste des réglages, et le message aux clients tel que l'application le lit (serveur/console/message-clients.ts).
import { describe, expect, it } from 'vitest';
import type { Etat } from '../../serveur/abonnement/etat.ts';
import type { Entreprise } from '../../serveur/console/decider.ts';
import { lireMessageClients } from '../../serveur/console/message-clients.ts';
import {
  ecartDePrix, essaisEnCours, grille, grilleAjouts, lireAjouts, lirePrixPrepares, lireReglages, lireRemises, preparesPar, registre, regleEnVigueur, sujetDesReglages,
  valeurDeRegle, type PrixLu, type RegleLue,
} from '../../serveur/console/reglages.ts';

const entreprise = (etat: Etat, id = '') => ({ etat, id }) as unknown as Entreprise;
const actif = (offre: 'essentiel' | 'complet', periodicite: 'annuel' | 'mensuel'): Etat =>
  ({ etat: 'actif', offre, periodicite, jusquAu: '2027-01-01', jours: 80, resilie: false });

describe('ce que la base rend, lu prudemment', () => {
  it('une ligne illisible ne s\'affiche pas, plutôt que de s\'afficher fausse', () => {
    const lu = lireReglages({
      prix: [{ offre: 'essentiel', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '390000' },
        { offre: 'premium', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '1' },
        { offre: 'complet', periodicite: 'mensuel', aPartirDu: '2026-09-28', montantHt: '69,5' }],
      regles: [{ id: 'r1', code: 'timbre.facture', valeur: 1000, debut: '2023-01-01', fin: null, source: 'Loi de finances', poseeLe: '2026-10-13T08:00:00Z',
        relectures: [{ reluePar: 'Mehdi Gharbi', avis: 'juste', dit: null, motif: 'au téléphone', par: 'Amira', le: '2026-10-13T09:00:00Z' },
          { reluePar: 'X', avis: 'peut-être', motif: 'm', par: 'Amira', le: '2026-10-13T09:00:00Z' }] },
      { id: 'r2', code: 'sans.source', valeur: 1, debut: '2023-01-01', source: '', poseeLe: '2026-10-13T08:00:00Z' }],
      messages: [{ id: 'm1', sorte: 'maintenance', texte: 'Maintenance dimanche soir.', du: '2026-10-13', au: '2026-10-19', motif: 'annonce', par: 'Amira',
        le: '2026-10-13T09:00:00Z', enCours: true }, { id: 'm2', sorte: 'incident', texte: 'x', du: '2026-10-13', au: '2026-10-19' }],
    });
    // Le prix d'une offre inconnue et un montant à virgule ne passent pas : l'argent est en millimes, en entier.
    expect(lu.prix).toEqual([{ offre: 'essentiel', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: 390000n }]);
    expect(lu.regles).toHaveLength(1);
    expect(lu.regles[0]?.relectures).toEqual([{ reluePar: 'Mehdi Gharbi', avis: 'juste', dit: null, motif: 'au téléphone', par: 'Amira', le: '2026-10-13T09:00:00Z' }]);
    expect(lu.messages.map((m) => m.id)).toEqual(['m1']);
    expect(lu.messages[0]).toMatchObject({ enCours: true, retireLe: null, remplace: false });
    expect(lireReglages(null)).toEqual({ prix: [], regles: [], messages: [] });
  });
});

describe('la grille du jour', () => {
  const prix: PrixLu[] = [
    // L'ancien prix d'abord : sans tri, c'est lui qu'on prendrait (des données qui ne discriminent pas ne prouvent rien).
    { offre: 'essentiel', periodicite: 'annuel', aPartirDu: '2026-01-01', montantHt: 350_000n },
    { offre: 'essentiel', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: 390_000n },
    { offre: 'essentiel', periodicite: 'mensuel', aPartirDu: '2026-09-28', montantHt: 39_000n },
    { offre: 'complet', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: 690_000n },
    // Datés après aujourd'hui : à venir, jamais en vigueur.
    { offre: 'essentiel', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: 420_000n },
    { offre: 'essentiel', periodicite: 'mensuel', aPartirDu: '2026-12-01', montantHt: 42_000n },
  ];
  const entreprises = [entreprise(actif('essentiel', 'annuel')), entreprise(actif('essentiel', 'annuel')), entreprise(actif('complet', 'mensuel')),
    entreprise({ etat: 'essai', jusquAu: '2026-10-20', jours: 7 }),
    entreprise({ etat: 'en_retard', echeance: '2026-10-01', lectureSeuleLe: '2026-10-15', jours: 2, apresEssai: false }),
    entreprise({ etat: 'hors', raison: 'offert' })];

  it('le prix en vigueur est le dernier posé à cette date, avec son jour ; une case sans prix reste vide', () => {
    const g = grille(prix, entreprises, '2026-10-13');
    expect(g.map((l) => l.offre)).toEqual(['essentiel', 'complet']);
    expect(g[0]).toMatchObject({ annuel: { ht: '390.000', depuis: '2026-09-28' }, mensuel: { ht: '39.000', depuis: '2026-09-28' } });
    // Le complet au mois n'a jamais été posé : sa case est vide, jamais un prix deviné.
    expect(g[1]).toMatchObject({ annuel: { ht: '690.000', depuis: '2026-09-28' }, mensuel: null });
    // Le jour même où un nouveau prix commence, c'est lui.
    expect(grille(prix, [], '2027-01-01')[0]?.annuel).toEqual({ ht: '420.000', depuis: '2027-01-01' });
  });

  it('ce qui est à venir se range par date, et ne se compte pas dans la grille du jour', () => {
    expect(grille(prix, [], '2026-10-13')[0]?.aVenir).toEqual([
      { periodicite: 'mensuel', ht: '42.000', aPartirDu: '2026-12-01' }, { periodicite: 'annuel', ht: '420.000', aPartirDu: '2027-01-01' }]);
    expect(grille(prix, [], '2026-10-13')[1]?.aVenir).toEqual([]);
  });

  it('les abonnés : seulement ceux dont une période payée court, par offre et périodicité ; un retard ne compte pas', () => {
    const g = grille(prix, entreprises, '2026-10-13');
    expect(g[0]?.abonnes).toEqual({ annuel: 2, mensuel: 0 });
    expect(g[1]?.abonnes).toEqual({ annuel: 0, mensuel: 1 });
    expect(essaisEnCours(entreprises)).toBe(1);
  });
});

describe('ce qui s\'ajoute à l\'offre (14c)', () => {
  const brut = {
    options: [
      // L'ancien prix d'abord : sans tri, c'est lui qu'on prendrait.
      { option: 'etablissement', periodicite: 'annuel', aPartirDu: '2026-01-01', montantHt: '95000' },
      { option: 'etablissement', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '120000' },
      { option: 'etablissement', periodicite: 'mensuel', aPartirDu: '2026-09-28', montantHt: '12000' },
      // Une option retirée (l'utilisateur de plus, 0102) : la grille ne la montre plus.
      { option: 'utilisateur', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '30000' },
      { option: 'module_paie', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '150000' },
      { option: 'salarie', periodicite: 'mensuel', aPartirDu: '2026-09-28', montantHt: '1200' },
      // À venir ; puis des lignes illisibles, qui ne s'affichent pas.
      { option: 'caisse', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '130000' },
      { option: 'imprimante', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '1000' },
      { option: 'caisse', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '120.5' },
    ],
    modules: [{ entreprise: 'e1', modules: ['paie'] }, { entreprise: 'e2', modules: ['paie', 'compta'] }, { entreprise: 'e3', modules: ['paie'] },
      { entreprise: 'e4', modules: ['compta'] }, { entreprise: null, modules: ['paie'] }],
  };
  // e1 et e2 : Essentiel, une période court ; e3 : en retard ; e4 : passée à Complet (le module ne s'y achète pas).
  const entreprises = [entreprise(actif('essentiel', 'annuel'), 'e1'), entreprise(actif('essentiel', 'mensuel'), 'e2'),
    entreprise({ etat: 'en_retard', echeance: '2026-10-01', lectureSeuleLe: '2026-10-15', jours: 2, apresEssai: false }, 'e3'),
    entreprise(actif('complet', 'annuel'), 'e4')];

  // Le contenu de départ (0105) : Essentiel sans la paie ni la comptabilité complète, Complet avec.
  const depart = { essentiel: { caisses: 1, etablissements: 1, salaries: 10, paie: 0, compta: 0 }, complet: { caisses: 2, etablissements: 2, salaries: 20, paie: 1, compta: 1 } };

  it('chaque ajout, dans l\'ordre de l\'application, avec son prix en vigueur et ce qui est à venir ; une case sans prix reste vide', () => {
    const g = grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13', depart);
    expect(g.map((l) => l.option)).toEqual(['caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta']);
    expect(g[0]).toMatchObject({ annuel: null, mensuel: null, aVenir: [{ periodicite: 'annuel', ht: '130.000', aPartirDu: '2027-01-01' }] });
    expect(g[1]).toMatchObject({ annuel: { ht: '120.000', depuis: '2026-09-28' }, mensuel: { ht: '12.000', depuis: '2026-09-28' }, achetes: null });
    expect(g[2]).toMatchObject({ annuel: null, mensuel: { ht: '1.200', depuis: '2026-09-28' } });
  });

  it('un module acheté seul : les abonnés du jour dont l\'offre ne le contient pas et qui l\'ont, jamais un retard', () => {
    const g = grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13', depart);
    expect(g.find((l) => l.option === 'module_paie')?.achetes).toBe(2);
    expect(g.find((l) => l.option === 'module_compta')?.achetes).toBe(1);
    // Complet ne contient plus la comptabilité complète (0105) : e4, qui l'a achetée seule, compte ; un contenu inconnu
    // ne compte personne.
    const sansCompta = { ...depart, complet: { ...depart.complet, compta: 0 } };
    expect(grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13', sansCompta).find((l) => l.option === 'module_compta')?.achetes).toBe(2);
    expect(grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13', null).find((l) => l.option === 'module_paie')?.achetes).toBe(0);
  });
});

describe('le registre des règles communes', () => {
  const regle = (r: Partial<RegleLue>): RegleLue => ({ id: 'r', code: 'timbre.facture', valeur: 1000, debut: '2023-01-01', fin: null, source: 'Loi de finances 2023',
    poseeLe: '2026-10-13T08:00:00Z', relectures: [], ...r });
  const relue = (avis: 'juste' | 'a_corriger', le: string) => ({ reluePar: 'Mehdi Gharbi', avis, dit: null, motif: 'au téléphone', par: 'Amira', le });

  it('une règle connue se lit dans son unité ; une inconnue, par sa valeur brute, jamais avec une unité devinée', () => {
    expect(valeurDeRegle('timbre.facture', 1000)).toEqual({ connue: true, texte: '1.000' });
    expect(valeurDeRegle('timbre.facture', '1000')).toEqual({ connue: true, texte: '1.000' });
    expect(valeurDeRegle('timbre.facture', 1.5)).toEqual({ connue: false, texte: '1.5' });
    expect(valeurDeRegle('tva.taux_normal', 19)).toEqual({ connue: false, texte: '19' });
  });

  it('en vigueur : commencée, et pas finie (la fin est le dernier jour où elle vaut)', () => {
    expect(regleEnVigueur({ debut: '2023-01-01', fin: null }, '2026-10-13')).toBe(true);
    expect(regleEnVigueur({ debut: '2026-10-14', fin: null }, '2026-10-13')).toBe(false);
    expect(regleEnVigueur({ debut: '2023-01-01', fin: '2026-10-13' }, '2026-10-13')).toBe(true);
    expect(regleEnVigueur({ debut: '2023-01-01', fin: '2026-10-12' }, '2026-10-13')).toBe(false);
  });

  it('à relire : jamais relue, ou relue « à corriger » la dernière fois ; une règle finie ou à venir ne l\'est pas', () => {
    const [jamais, corriger, juste, finie] = registre([
      regle({ id: 'a' }),
      regle({ id: 'b', relectures: [relue('a_corriger', '2026-10-13T10:00:00Z'), relue('juste', '2026-10-01T10:00:00Z')] }),
      regle({ id: 'c', relectures: [relue('juste', '2026-10-13T10:00:00Z'), relue('a_corriger', '2026-10-01T10:00:00Z')] }),
      regle({ id: 'd', fin: '2025-12-31' }),
    ], '2026-10-13');
    expect([jamais?.aRelire, corriger?.aRelire, juste?.aRelire, finie?.aRelire]).toEqual([true, true, false, false]);
    expect(jamais?.valeurLue).toEqual({ connue: true, texte: '1.000' });
    expect(finie?.enVigueur).toBe(false);
  });
});

describe('au journal, un geste des réglages dit sur quoi il porte', () => {
  it('la règle relue et l\'avis ; le message écrit ou retiré par ses deux jours ; le prix préparé ou retiré, et le préavis ; rien pour un autre geste', () => {
    expect(sujetDesReglages('reglages.relire', null, { regle: 'timbre.facture', debut: '2023-01-01', reluePar: 'Mehdi Gharbi', avis: 'a_corriger' }))
      .toEqual({ regle: 'timbre.facture', reluePar: 'Mehdi Gharbi', avis: 'a_corriger', du: null, au: null, prix: null, preavis: null, regleAbonnement: null, contenu: null, remise: null, nouveaute: null });
    expect(sujetDesReglages('reglages.message_affiche', null, { message: 'm', sorte: 'nouveaute', du: '2026-10-13', au: '2026-10-20' }))
      .toEqual({ regle: null, reluePar: null, avis: null, du: '2026-10-13', au: '2026-10-20', prix: null, preavis: null, regleAbonnement: null, contenu: null, remise: null, nouveaute: null });
    // Retiré : les jours viennent de ce qu'il était (avant), pas du retrait.
    expect(sujetDesReglages('reglages.message_retire', { message: 'm', texte: 't', du: '2026-10-13', au: '2026-10-19' }, { retire: '2026-10-14T09:00:00Z' }))
      .toEqual({ regle: null, reluePar: null, avis: null, du: '2026-10-13', au: '2026-10-19', prix: null, preavis: null, regleAbonnement: null, contenu: null, remise: null, nouveaute: null });
    expect(sujetDesReglages('versions.geler', null, { jusquAu: '2026-10-20' })).toBeNull();
    // Un prix préparé : de l'ancien au nouveau, à sa date (celle de l'après). Retiré : la date est celle du prix retiré.
    expect(sujetDesReglages('reglages.prix_prepare', { quoi: 'essentiel', periodicite: 'annuel', montantHt: '390.000' },
      { quoi: 'essentiel', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '420.000' })?.prix)
      .toEqual({ quoi: 'essentiel', periodicite: 'annuel', aPartirDu: '2027-01-01', avant: '390.000', apres: '420.000' });
    expect(sujetDesReglages('reglages.prix_retire', { quoi: 'caisse', periodicite: 'mensuel', aPartirDu: '2027-02-01', montantHt: '13.000', motif: 'm' },
      { quoi: 'caisse', periodicite: 'mensuel', montantHt: '12.000' })?.prix)
      .toEqual({ quoi: 'caisse', periodicite: 'mensuel', aPartirDu: '2027-02-01', avant: '13.000', apres: '12.000' });
    // Ce qui n'a pas de prix, ou un montant illisible, ne se dit pas.
    expect(sujetDesReglages('reglages.prix_prepare', null, { quoi: 'imprimante', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '1.000' })?.prix).toBeNull();
    expect(sujetDesReglages('reglages.prix_prepare', { quoi: 'complet', periodicite: 'mensuel', montantHt: 69 },
      { quoi: 'complet', periodicite: 'mensuel', aPartirDu: '2027-01-01', montantHt: '75.000' })?.prix).toMatchObject({ avant: null, apres: '75.000' });
    expect(sujetDesReglages('reglages.preavis', { jours: 30 }, { jours: 10 })).toMatchObject({ preavis: { avant: 30, apres: 10 }, prix: null });
    expect(sujetDesReglages('reglages.relire', null, { regle: 'timbre.facture', reluePar: 'X', avis: 'juste' })?.preavis).toBeNull();
    // Une règle de l'abonnement (0104) : laquelle, ses jours d'avant et d'après ; un code inconnu ne se dit pas.
    expect(sujetDesReglages('reglages.regle_abonnement', { code: 'relances', jours: [15, 7, 1] }, { code: 'relances', jours: [10, 3] }))
      .toMatchObject({ regleAbonnement: { code: 'relances', avant: [15, 7, 1], apres: [10, 3] }, preavis: null, prix: null });
    expect(sujetDesReglages('reglages.regle_abonnement', { code: 'grace', jours: null }, { code: 'grace', jours: [0] })?.regleAbonnement)
      .toEqual({ code: 'grace', avant: null, apres: [0] });
    expect(sujetDesReglages('reglages.regle_abonnement', null, { code: 'remise', jours: [20] })?.regleAbonnement).toBeNull();
    // Ce qu'une offre comprend (0105) : préparé, de ce qu'elle comprenait au nouveau, à sa date ; retiré, le changement
    // retiré à sa date, et ce qui reste ; une ligne inconnue ne se dit pas.
    expect(sujetDesReglages('reglages.contenu_prepare', { offre: 'essentiel', quoi: 'caisses', nombre: 1 },
      { offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: '2026-11-13' })?.contenu)
      .toEqual({ offre: 'essentiel', quoi: 'caisses', aPartirDu: '2026-11-13', avant: 1, apres: 2 });
    expect(sujetDesReglages('reglages.contenu_retire', { offre: 'complet', quoi: 'paie', nombre: 0, aPartirDu: '2026-12-01' },
      { offre: 'complet', quoi: 'paie', nombre: 1 })?.contenu)
      .toEqual({ offre: 'complet', quoi: 'paie', aPartirDu: '2026-12-01', avant: 0, apres: 1 });
    expect(sujetDesReglages('reglages.contenu_prepare', null, { offre: 'essentiel', quoi: 'utilisateurs', nombre: 3 })?.contenu).toBeNull();
    expect(sujetDesReglages('reglages.preavis', { jours: 30 }, { jours: 10 })?.contenu).toBeNull();
    // Une remise (0106) : préparée, de celle d'aujourd'hui à la nouvelle, à sa date ; retirée, celle qui est retirée à sa
    // date, et celle qui reste ; une remise inconnue ne se dit pas.
    expect(sujetDesReglages('reglages.remise_preparee', { code: 'cabinet', taux: 20, mois: 12 }, { code: 'cabinet', taux: 25, mois: 6, aPartirDu: '2026-11-13' })?.remise)
      .toEqual({ code: 'cabinet', aPartirDu: '2026-11-13', avant: { taux: 20, mois: 12 }, apres: { taux: 25, mois: 6 } });
    expect(sujetDesReglages('reglages.remise_retiree', { code: 'groupe', taux: 15, mois: null, aPartirDu: '2026-12-01' }, { code: 'groupe', taux: 20, mois: null })?.remise)
      .toEqual({ code: 'groupe', aPartirDu: '2026-12-01', avant: { taux: 15, mois: null }, apres: { taux: 20, mois: null } });
    expect(sujetDesReglages('reglages.remise_preparee', null, { code: 'parrainage', taux: 10, aPartirDu: '2026-11-13' })?.remise).toBeNull();
    expect(sujetDesReglages('reglages.contenu_prepare', null, { offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: '2026-11-13' })?.remise).toBeNull();
  });
});

describe('les remises lues', () => {
  it('celle du jour pour chacune, ce qui est préparé, combien de sociétés en groupe ; une ligne illisible ne se lit pas', () => {
    const lues = lireRemises({
      duJour: { groupe: { taux: 20, mois: null, aPartirDu: '2000-01-01', motif: 'La remise de départ', par: null, le: '2026-10-14T08:00:00Z' },
        cabinet: { taux: 95, mois: 12, aPartirDu: '2000-01-01', motif: 'Illisible' } },
      aVenir: [{ code: 'cabinet', taux: 25, mois: 6, aPartirDu: '2026-11-13', motif: 'Plus forte', par: 'Amira', le: '2026-10-14T09:00:00Z' },
        { code: 'parrainage', taux: 10, mois: null, aPartirDu: '2026-11-13', motif: 'Inconnue' }],
      groupes: 2, enGroupe: 5,
    });
    expect(lues).toEqual({
      duJour: { groupe: { taux: 20, mois: null, aPartirDu: '2000-01-01', motif: 'La remise de départ', par: null, le: '2026-10-14T08:00:00Z' }, cabinet: null },
      aVenir: [{ code: 'cabinet', taux: 25, mois: 6, aPartirDu: '2026-11-13', motif: 'Plus forte', par: 'Amira', le: '2026-10-14T09:00:00Z' }],
      groupes: 2, enGroupe: 5,
    });
    expect(lireRemises(null)).toEqual({ duJour: { groupe: null, cabinet: null }, aVenir: [], groupes: 0, enGroupe: 0 });
  });
});

describe('le message tel que l\'application des clients le lit', () => {
  it('le texte, sa sorte et ses deux jours ; jamais qui l\'a écrit ni son motif ; rien de lisible, rien', () => {
    expect(lireMessageClients({ id: 'm', sorte: 'maintenance', texte: 'Maintenance dimanche soir.', du: '2026-10-13', au: '2026-10-19', motif: 'note', par: 'Amira' }))
      .toEqual({ id: 'm', sorte: 'maintenance', texte: 'Maintenance dimanche soir.', du: '2026-10-13', au: '2026-10-19' });
    expect(lireMessageClients({ id: 'm', sorte: 'incident', texte: 'x', du: '2026-10-13', au: '2026-10-19' })).toBeNull();
    expect(lireMessageClients({ id: 'm', sorte: 'nouveaute', texte: '  ', du: '2026-10-13', au: '2026-10-19' })).toBeNull();
    expect(lireMessageClients(null)).toBeNull();
  });
});

describe('les prix préparés dans la console (0103)', () => {
  it('le préavis et les prix à venir, lus prudemment ; chaque prix à venir d\'une grille dit qui l\'a préparé et pourquoi', () => {
    const lu = lirePrixPrepares({
      preavis: { jours: 30, aPartirDu: '2026-10-14', motif: 'Décidé par Skander', par: null, le: '2026-10-14T10:00:00Z' },
      aVenir: [
        { quoi: 'essentiel', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '420000', motif: 'hausse', par: 'Amira', le: '2026-10-14T11:00:00Z' },
        { quoi: 'caisse', periodicite: 'mensuel', aPartirDu: '2026-12-01', montantHt: '13000', motif: null, par: null, le: null },
        { quoi: 'imprimante', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '1000' },
        { quoi: 'complet', periodicite: 'annuel', aPartirDu: '2027-01-01', montantHt: '690,5' },
      ],
    });
    expect(lu.preavis).toEqual({ jours: 30, aPartirDu: '2026-10-14', motif: 'Décidé par Skander', par: null, le: '2026-10-14T10:00:00Z' });
    expect(lu.aVenir.map((p) => p.quoi)).toEqual(['essentiel', 'caisse']);
    expect(lirePrixPrepares({ preavis: { jours: -1, aPartirDu: '2026-10-14', motif: 'm', le: '2026-10-14T10:00:00Z' } }).preavis).toBeNull();
    const lignes = preparesPar([{ offre: 'essentiel', aVenir: [{ periodicite: 'annuel' as const, ht: '420.000', aPartirDu: '2027-01-01' },
      { periodicite: 'mensuel' as const, ht: '42.000', aPartirDu: '2027-01-01' }] }], (l) => l.offre as 'essentiel', lu.aVenir);
    // Le même choix ET la même date : le prix mensuel, que personne n'a préparé ici, reste sans auteur.
    expect(lignes[0]?.aVenir).toEqual([
      { periodicite: 'annuel', ht: '420.000', aPartirDu: '2027-01-01', motif: 'hausse', par: 'Amira', le: '2026-10-14T11:00:00Z' },
      { periodicite: 'mensuel', ht: '42.000', aPartirDu: '2027-01-01', motif: null, par: null, le: null }]);
  });

  it('l\'écart d\'un nouveau prix se dit en dixièmes de pour cent arrondis, en hausse ou en baisse ; rien sans prix d\'aujourd\'hui', () => {
    expect(ecartDePrix(390_000n, 420_000n)).toEqual({ sens: 'hausse', dixiemes: 77 });
    expect(ecartDePrix(390_000n, 375_000n)).toEqual({ sens: 'baisse', dixiemes: 38 });
    expect(ecartDePrix(12_000n, 12_015n)).toEqual({ sens: 'hausse', dixiemes: 1 });
    expect(ecartDePrix(null, 420_000n)).toBeNull();
    expect(ecartDePrix(0n, 420_000n)).toBeNull();
  });
});
