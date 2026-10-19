// Le bulletin imprimé tient sur une page (1.62.0 ; docs/paie.md, « Le bulletin imprimé tient sur une page »).
// Mesuré là où il s'imprime : le bulletin de la plateforme (la v10 et ses adaptations) ouvert dans un vrai navigateur,
// le PDF qu'il en tire, ses pages COMPTÉES (une mesure de hauteur à l'écran dirait « tout va bien » sans avoir
// imprimé). Les bulletins d'essai :
//   - celui vu à l'impression le 19/10/2026 : entré le 15 du mois, absent deux jours ; il sortait sur deux pages, la
//     seconde ne portant que le pied ;
//   - un bulletin chargé : la fiche entière, l'adresse sur deux lignes, une entrée, une absence, six primes et deux
//     retenues (dix-huit lignes de rubriques), qui sortait lui aussi sur deux pages ;
//   - un bulletin hors du commun (quarante-deux lignes) : il passe sur une deuxième page, il ne se tronque pas.
// Sur une page, le pied se pose en bas (à 10 mm du bord), quelle que soit la longueur du bulletin.

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Reglages = Record<string, unknown>;
type Fiche = Record<string, unknown> & { id: string };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Fiche, i: Record<string, unknown>, s: Reglages) => Record<string, unknown>;
  baremesPaie: (r: Reglages) => Reglages;
};
const core = ecranDeLaPlateforme('core.js') as { payslipHtml: (slip: unknown, d: unknown, societe: unknown, o: unknown) => string };

const REGLAGES = compta.baremesPaie({ accidentRate: 0.5 });
const SOCIETE = { name: 'Entreprise d\'essai', address: '12 rue de l\'Essai\n2045 Tunis', matricule: '1234567ABM000', cnss: '1234567-01', currency: 'DT' };
const LIBELLES = ['Heures supplémentaires à 25 %', 'Heures supplémentaires à 50 %', 'Prime de présence', 'Prime de transport',
  'Prime de panier', 'Prime de rendement', 'Indemnité kilométrique', 'Prime d\'ancienneté'];
const primes = (n: number) => Array.from({ length: n }, (_, i) => ({
  label: LIBELLES[i % LIBELLES.length] + (i >= LIBELLES.length ? ` ${i + 1}` : ''), amount: 12.345 + i, taxable: i % 5 !== 4,
}));
const retenues = (n: number) => Array.from({ length: n }, (_, i) => ({ label: ['Avance sur salaire', 'Remboursement de prêt'][i % 2], amount: 20.5 + i }));
// Entré le 15 septembre pour 1 300 : quatorze jours sur vingt-six, 700 de brut (le prorata de la v10, 10.12.0).
const PRORATA = { jours: 14, sur: 26, motif: 'entrée le 15/09/2026', brutFiche: 1300, brut: 700 };
const SALARIE: Fiche = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1300, hireDate: '2026-09-15', contract: 'cdi' };
const FICHE_ENTIERE: Fiche = { ...SALARIE, position: 'Responsable de la production', cin: '01234567', cnss: '12345678-01', headOfFamily: true, children: 2 };

function bulletinHtml(fiche: Fiche, nPrimes: number, nRetenues: number): string {
  const saisie = { gross: 700, workedDays: 26, absentDays: 2, bonuses: primes(nPrimes), deductions: retenues(nRetenues), prorata: PRORATA };
  const slip = { id: 'b1', employeeId: fiche.id, year: 2026, month: 9, ...saisie, computed: compta.computePayslip(fiche, saisie, REGLAGES),
    issuedAt: '2026-09-30', paidDate: '2026-09-30', method: 'virement' };
  return core.payslipHtml(slip, { employees: [fiche], payslips: [slip], payrollSettings: REGLAGES }, SOCIETE, {});
}

// Le PDF que le navigateur tire du bulletin (à la taille de page du bulletin : A4), ses pages comptées ; et, à
// l'impression, le bas des signatures et celui du pied, en millimètres depuis le haut de la feuille (297 mm).
async function imprimer(page: Page, html: string) {
  await page.setContent(html);
  await page.emulateMedia({ media: 'print' });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
  const mesure = await page.evaluate(() => {
    const bas = (s: string) => (document.querySelector(s) as HTMLElement).getBoundingClientRect().bottom / (96 / 25.4);
    return { rubriques: document.querySelectorAll('table.pay tbody tr').length, signatures: bas('.sign'), pied: bas('.foot') };
  });
  return { pages: (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length, ...mesure };
}

describe('le bulletin imprimé', () => {
  let navigateur: Browser;
  let page: Page;
  beforeAll(async () => {
    navigateur = await chromium.launch();
    page = await navigateur.newPage();
  });
  afterAll(async () => { await navigateur?.close(); });

  it('tient sur une page, même chargé (une entrée, une absence, six primes, deux retenues) ; le pied en bas de la page ; plus long, il ne se tronque pas', async () => {
    // Celui vu à l'impression : le pied seul sur une deuxième page.
    const vu = await imprimer(page, bulletinHtml(SALARIE, 0, 0));
    expect(vu.rubriques).toBe(10);
    expect(vu.pages).toBe(1);
    expect(vu.pied).toBeCloseTo(297 - 10, 0);

    const charge = await imprimer(page, bulletinHtml(FICHE_ENTIERE, 6, 2));
    expect(charge.rubriques).toBe(18);
    expect(charge.pages).toBe(1);
    expect(charge.pied).toBeCloseTo(297 - 10, 0);
    // Et de la marge : les signatures finissent avant 275 mm. Le pied et l'air qui le précède en prennent 8 : il reste
    // 4 mm pour une police plus large que celle du navigateur d'essai.
    expect(charge.signatures).toBeLessThan(275);

    // Plus long qu'une page, la suite passe sur une deuxième : aucune rubrique n'est coupée de la feuille.
    const horsDuCommun = await imprimer(page, bulletinHtml(FICHE_ENTIERE, 30, 2));
    expect(horsDuCommun.rubriques).toBe(42);
    expect(horsDuCommun.pages).toBe(2);
  });
});
