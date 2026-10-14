// Les réglages de la plateforme, rangés sans la base (serveur/console/reglages.ts ; docs/console.md C28) : la grille du
// jour lue dans les prix datés, le registre des règles communes et ce que leur dernière relecture dit, ce que le journal
// garde d'un geste des réglages, et le message aux clients tel que l'application le lit (serveur/console/message-clients.ts).
import { describe, expect, it } from 'vitest';
import type { Etat } from '../../serveur/abonnement/etat.ts';
import type { Entreprise } from '../../serveur/console/decider.ts';
import { lireMessageClients } from '../../serveur/console/message-clients.ts';
import {
  essaisEnCours, grille, grilleAjouts, lireAjouts, lireReglages, registre, regleEnVigueur, sujetDesReglages, valeurDeRegle, type PrixLu, type RegleLue,
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
      { option: 'utilisateur', periodicite: 'annuel', aPartirDu: '2026-01-01', montantHt: '25000' },
      { option: 'utilisateur', periodicite: 'annuel', aPartirDu: '2026-09-28', montantHt: '30000' },
      { option: 'utilisateur', periodicite: 'mensuel', aPartirDu: '2026-09-28', montantHt: '3000' },
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

  it('chaque ajout, dans l\'ordre de l\'application, avec son prix en vigueur et ce qui est à venir ; une case sans prix reste vide', () => {
    const g = grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13');
    expect(g.map((l) => l.option)).toEqual(['utilisateur', 'caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta']);
    expect(g[0]).toMatchObject({ annuel: { ht: '30.000', depuis: '2026-09-28' }, mensuel: { ht: '3.000', depuis: '2026-09-28' }, achetes: null });
    expect(g[1]).toMatchObject({ annuel: null, mensuel: null, aVenir: [{ periodicite: 'annuel', ht: '130.000', aPartirDu: '2027-01-01' }] });
    expect(g[3]).toMatchObject({ annuel: null, mensuel: { ht: '1.200', depuis: '2026-09-28' } });
  });

  it('un module acheté seul : les abonnés Essentiel du jour qui l\'ont, jamais un retard ni Complet', () => {
    const g = grilleAjouts(lireAjouts(brut), entreprises, '2026-10-13');
    expect(g.find((l) => l.option === 'module_paie')?.achetes).toBe(2);
    expect(g.find((l) => l.option === 'module_compta')?.achetes).toBe(1);
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
  it('la règle relue et l\'avis ; le message écrit ou retiré par ses deux jours ; rien pour un autre geste', () => {
    expect(sujetDesReglages('reglages.relire', null, { regle: 'timbre.facture', debut: '2023-01-01', reluePar: 'Mehdi Gharbi', avis: 'a_corriger' }))
      .toEqual({ regle: 'timbre.facture', reluePar: 'Mehdi Gharbi', avis: 'a_corriger', du: null, au: null });
    expect(sujetDesReglages('reglages.message_affiche', null, { message: 'm', sorte: 'nouveaute', du: '2026-10-13', au: '2026-10-20' }))
      .toEqual({ regle: null, reluePar: null, avis: null, du: '2026-10-13', au: '2026-10-20' });
    // Retiré : les jours viennent de ce qu'il était (avant), pas du retrait.
    expect(sujetDesReglages('reglages.message_retire', { message: 'm', texte: 't', du: '2026-10-13', au: '2026-10-19' }, { retire: '2026-10-14T09:00:00Z' }))
      .toEqual({ regle: null, reluePar: null, avis: null, du: '2026-10-13', au: '2026-10-19' });
    expect(sujetDesReglages('versions.geler', null, { jusquAu: '2026-10-20' })).toBeNull();
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
