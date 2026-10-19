// Le Cabinet ne perd rien d'un bulletin (1.63.0 ; docs/paie.md, « Le Cabinet ne perd rien d'un bulletin »). Le bulletin
// que le Cabinet réécrit est celui du SkanFact de son client : le moteur du Cabinet (`ajouterBulletin`, compta.js) garde
// chaque prime avec ses marques (une prime d'heures supplémentaires, une prime au jour), chaque retenue, et le prorata
// d'une entrée tant que le brut est le sien ; il calcule alors comme l'entreprise, au millime, et le journal de paie
// range toujours les heures supplémentaires dans leur colonne.
//
// Et un bulletin MODIFIÉ au Cabinet garde le barème figé avec son calcul (1.64.0 ; docs/paie.md, « Un bulletin modifié
// au Cabinet garde son barème ») : les taux du client ce mois-là, et le régime de son contrat.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Reglages = Record<string, unknown>;
type Ligne = Record<string, unknown>;
type Bulletin = { id: string; brut: number; primes: Ligne[]; retenues: Ligne[]; prorata: Ligne | null; calcul: Record<string, number> };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Ligne, i: Ligne, s: Reglages) => Record<string, number>;
  baremesPaie: (r: Reglages) => Reglages;
  livreVide: (dossier: string, annee: number) => Record<string, unknown> & { salaries: Ligne[]; bulletins: Bulletin[] };
  ajouterBulletin: (livre: unknown, b: unknown, baremes: Reglages, qui: string, quand: number) => { ok: boolean; motif?: string; bulletin: Bulletin };
  bulletinValide: (b: unknown, livre: unknown, baremes: Reglages) => { ok: boolean; motif: string };
  baremesDuBulletin: (livre: unknown, b: unknown, baremes: Reglages) => Reglages;
};
const core = ecranDeLaPlateforme('core.js') as {
  journalDePaie: (d: unknown, annee: number, mois: number) => { lignes: Record<string, number>[] };
};

// Entré le 15 septembre 2026 pour 1 300 : quatorze jours sur vingt-six, 700 de brut (le prorata de l'entreprise).
const PRORATA = { jours: 14, sur: 26, motif: 'entrée le 15/09/2026', brutFiche: 1300, brut: 700 };
// Ce que l'entreprise a mis dans le bulletin : une prime au jour (12 jours payés : 14 moins 2 d'absence), une prime
// d'heures supplémentaires (le pointage), une prime non imposable ; deux retenues.
const PRIMES = [
  { label: 'Prime de présence', amount: 32.308, taxable: true, parJour: true, mensuel: 70, jours: 12, sur: 26 },
  { label: 'Heures supplémentaires : 8 h à +25 %', amount: 75.012, taxable: true, hs: 25, heures: 8 },
  { label: 'Prime de panier', amount: 20.5, taxable: false },
];
const RETENUES = [{ label: 'Avance sur salaire', amount: 50 }, { label: 'Remboursement de prêt', amount: 25.5 }];
const EMPLOYE = { grossSalary: 1300, headOfFamily: false, children: 0, contrat: 'cdi' };

function livre() {
  const l = compta.livreVide('cafe', 2026);
  l.salaries = [{ id: 's1', nom: 'Salarié Numéro Un', brut: 1300, chefDeFamille: false, enfants: 0, contrat: 'cdi', embauche: '2026-09-15', actif: true }];
  l.bulletins = [];
  return l;
}
const saisie = (brut: number) => ({ id: 'b1', salarieId: 's1', annee: 2026, mois: 9, brut, joursTravailles: 26, joursAbsence: 2,
  primes: PRIMES.map((p) => ({ ...p })), retenues: RETENUES.map((r) => ({ ...r })), prorata: PRORATA });

describe('le bulletin que le Cabinet réécrit', () => {
  it('garde chaque prime avec ses marques, chaque retenue et le prorata du mois, et se calcule comme dans l\'entreprise', () => {
    const l = livre();
    expect(compta.bulletinValide(saisie(700), l, {})).toEqual({ ok: true, motif: '' });
    const r = compta.ajouterBulletin(l, saisie(700), {}, 'cabinet', 1);
    expect(r.ok, r.motif).toBe(true);
    expect(r.bulletin.primes).toEqual(PRIMES);
    expect(r.bulletin.retenues).toEqual(RETENUES);
    expect(r.bulletin.prorata).toEqual(PRORATA);
    // Le calcul de l'entreprise (son formulaire appelle le même moteur avec le prorata du mois) : l'absence se retire
    // au taux du salaire du contrat, 1 300 × 2 / 26 = 100, et pas 700 × 2 / 26.
    const entreprise = compta.computePayslip(EMPLOYE, { gross: 700, workedDays: 26, absentDays: 2, bonuses: PRIMES, deductions: RETENUES, prorata: PRORATA }, compta.baremesPaie({}));
    expect(r.bulletin.calcul).toEqual(entreprise);
    expect([r.bulletin.calcul.absenceCut, r.bulletin.calcul.brutDuMois]).toEqual([100, 1300]);

    // Le journal de paie du mois lit le bulletin tel que le dossier le garde : les heures supplémentaires restent dans
    // leur colonne (sans sa marque, la prime passait dans les indemnités).
    const d = {
      employees: [{ id: 's1', name: 'Salarié Numéro Un', grossSalary: 1300, hireDate: '2026-09-15' }],
      payslips: [{ id: 'b1', employeeId: 's1', year: 2026, month: 9, gross: 700, workedDays: 26, absentDays: 2, prorata: r.bulletin.prorata,
        bonuses: r.bulletin.primes, deductions: r.bulletin.retenues, computed: r.bulletin.calcul }],
    };
    const [ligne] = core.journalDePaie(d, 2026, 9).lignes;
    expect([ligne?.hs, ligne?.indemnites]).toEqual([75.012, 52.808]);
    expect(ligne?.jours).toBe(12);
  });

  it('un brut retouché au Cabinet n\'est plus proratisé : le bulletin perd son prorata, l\'absence se retire de ce brut', () => {
    const r = compta.ajouterBulletin(livre(), saisie(750), {}, 'cabinet', 1);
    expect(r.ok, r.motif).toBe(true);
    expect(r.bulletin.prorata).toBeNull();
    expect([r.bulletin.calcul.absenceCut, r.bulletin.calcul.brutDuMois]).toEqual([57.692, 750]);
    // Ses primes gardent leurs marques quand même.
    expect(r.bulletin.primes).toEqual(PRIMES);
  });

  it('un bulletin modifié au Cabinet garde le barème figé avec son calcul : les taux du client (accident du travail, TFP) et le régime de son contrat ; un nouveau prend ceux du dossier', () => {
    // Le barème du client : un accident du travail à 2 %, une TFP à 1 % (ils dépendent de l'activité de l'entreprise) ;
    // le CIVP sans charge patronale CNSS ni IRPP.
    const client = compta.baremesPaie({ accidentRate: 2, tfpRate: 1, regimesContrat: { civp: { cnssEmployer: 0, sansIrpp: true } } });
    const defaut = compta.baremesPaie({});
    expect([defaut.accidentRate, defaut.tfpRate]).not.toEqual([2, 1]);
    const saisieDe = (id: string, absence: number) => ({ id, salarieId: 's1', annee: 2026, mois: 9, brut: 1300, joursTravailles: 26, joursAbsence: absence,
      primes: [], retenues: [], prorata: null });
    const entreeEntreprise = (absence: number) => ({ gross: 1300, workedDays: 26, absentDays: absence, bonuses: [], deductions: [], prorata: null });
    for (const contrat of ['cdi', 'civp']) {
      const l = livre();
      l.salaries = l.salaries.map((x) => ({ ...x, contrat, brut: 1300 }));
      const employe = { ...EMPLOYE, contrat };
      // Le bulletin que le client a établi dans son SkanFact, avec SON barème.
      l.bulletins = [{ ...saisieDe('b1', 2), calcul: compta.computePayslip(employe, entreeEntreprise(2), client) } as unknown as Bulletin];
      // Modifié au Cabinet (un jour d'absence de plus), avec les réglages du dossier au Cabinet (le barème par défaut).
      const r = compta.ajouterBulletin(l, saisieDe('b1', 3), {}, 'cabinet', 1);
      expect(r.ok, r.motif).toBe(true);
      expect(r.bulletin.calcul, contrat).toEqual(compta.computePayslip(employe, entreeEntreprise(3), client));
      const taux = r.bulletin.calcul.rates as unknown as Record<string, number>;
      expect([taux.accidentRate, taux.tfpRate, taux.cnssEmployer], contrat).toEqual([2, 1, contrat === 'civp' ? 0 : client.cnssEmployer]);
      if (contrat === 'civp') expect(r.bulletin.calcul.irpp).toBe(0);
      // L'écran du Cabinet calcule avec le même barème (son aperçu, son juge).
      expect(compta.baremesDuBulletin(l, { id: 'b1' }, {})).toMatchObject({ accidentRate: 2, tfpRate: 1 });
      // Un bulletin nouveau prend les réglages du dossier.
      const nouveau = compta.ajouterBulletin(l, { ...saisieDe('', 0), mois: 10 }, {}, 'cabinet', 2);
      expect(nouveau.ok, nouveau.motif).toBe(true);
      expect((nouveau.bulletin.calcul.rates as unknown as Record<string, number>).accidentRate).toBe(defaut.accidentRate);
    }

    // Le contrat a changé depuis (CIVP → CDI) : le régime figé ne s'applique plus, les taux du client restent.
    const l = livre();
    l.salaries = l.salaries.map((x) => ({ ...x, contrat: 'cdi', brut: 1300 }));
    l.bulletins = [{ ...saisieDe('b1', 2), calcul: compta.computePayslip({ ...EMPLOYE, contrat: 'civp' }, entreeEntreprise(2), client) } as unknown as Bulletin];
    const r = compta.ajouterBulletin(l, saisieDe('b1', 2), {}, 'cabinet', 1);
    expect(r.ok, r.motif).toBe(true);
    const taux = r.bulletin.calcul.rates as unknown as Record<string, number>;
    expect([taux.accidentRate, taux.tfpRate, taux.cnssEmployer]).toEqual([2, 1, defaut.cnssEmployer]);
    expect(r.bulletin.calcul.irpp).toBeGreaterThan(0);
  });
});
