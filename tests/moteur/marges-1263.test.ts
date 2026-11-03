// 1.263.0 — la marge d'une affaire juste (revue métier du 03/11 : « mets-toi à la place d'une entreprise »). Trois
// morceaux de coût, chacun compté une seule fois et chacun vérifié par un second chemin :
//   - les achats, ligne par ligne : un achat partagé entre deux affaires se coupe sans rien perdre ni compter deux fois ;
//   - la marchandise sortie du stock : ce qu'elle coûte à l'affaire est ce que la valeur du stock a perdu ;
//   - la main d'œuvre : les heures au coût employeur de l'heure, celui du bulletin (ou du contrat, « estimé »).
// Et l'année mois par mois : la somme des douze résultats est le résultat de l'année.
import { describe, expect, it } from 'vitest';
import { demo as demoV10, ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
// L'exemple de cinq ans : le même fichier d'exemple, ses données lues par le moteur de la plateforme.
const demo = demoV10 as unknown as Obj;
const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };

const ligne = (label: string, qty: number, unitPrice: number, extra: Obj = {}) => ({ label, qty, unitPrice, vatRate: 19, ...extra });
const base = (): Obj => ({
  company: co, clients: [{ id: 'c1', name: 'Hôtel Amilcar' }], suppliers: [{ id: 's1', name: 'Bois du Nord' }],
  projects: [{ id: 'A', name: 'Cuisine Amilcar', clientId: 'c1', status: 'en cours' }, { id: 'B', name: 'Bureau Lac', status: 'en cours' }],
  catalog: [{ id: 'pl', label: 'Plan de travail chêne', tracked: true, unit: 'u', initialQty: 10, initialCost: 50.125, initialDate: '2026-01-01' }],
  documents: [], purchases: [], stockAdjustments: [], employees: [], payslips: [], projectTime: [],
  payrollSettings: { heuresMois: 208 },
});
const achat = (id: string, lines: Obj[], extra: Obj = {}): Obj => ({ id, kind: 'facture', supplierId: 's1', date: '2026-03-10', currency: 'DT', lines, fees: 7.5, payments: [], ...extra });

describe('la marge d\'une affaire 1.263.0', () => {
  it('un achat entier rattaché coûte exactement `coutAchat` ; partagé, ses deux parts refont le tout', () => {
    const d = base();
    const p = achat('p1', [ligne('Quincaillerie', 3, 41.333), ligne('Peinture', 2, 77.777, { deductible: false })], { projectId: 'A' });
    d.purchases.push(p);
    const tout = C.coutAchat(C.purchaseTotals(p, co));
    expect(C.coutAchatPourAffaire(p, co, d, 'A').cout).toBe(tout);
    expect(C.projectMargin(d, co, 'A').achats).toBe(tout);
    // La peinture va au bureau du Lac : chaque affaire porte sa ligne, et les frais au prorata du HT.
    p.lines[1].projectId = 'B';
    const a = C.coutAchatPourAffaire(p, co, d, 'A').cout, b = C.coutAchatPourAffaire(p, co, d, 'B').cout;
    expect(a).not.toBe(tout);
    expect(Math.round((a + b) * 1000)).toBe(Math.round(tout * 1000));
    expect(C.achatDansAffaire(p, 'B')).toBe(true);
    // Une ligne sortie de toute affaire (`projectId: ''`) ne va plus nulle part, même si la pièce en a une.
    p.lines[1].projectId = '';
    expect(C.achatDansAffaire(p, 'B')).toBe(false);
    expect(C.projectMargin(d, co, 'A').achats).toBe(a);
  });

  it('un bien immobilisé et la marchandise entrée au stock ne sont pas consommés sur l\'affaire', () => {
    const d = base();
    const p = achat('p2', [ligne('Scie à format', 1, 2400, { destination: 'immobilisation' }), ligne('Plan de travail chêne', 5, 70, { destination: 'stock' }), ligne('Colle', 1, 12.4)], { projectId: 'A', fees: 6 });
    d.purchases.push(p);
    const m = C.projectMargin(d, co, 'A');
    // Les frais (6 DT de port) sont une charge, même au prorata d'une ligne partie au stock : la page Stock valorise la
    // marchandise sans eux, ils ne doivent donc pas attendre une sortie qui ne les emportera jamais.
    expect([m.immo, m.enStock, m.achats]).toEqual([2400, 350, 18.4]);
    expect(C.round3(m.immo + m.enStock + m.achats)).toBe(C.coutAchat(C.purchaseTotals(p, co)));
  });

  it('la marchandise vendue sur l\'affaire coûte ce que le stock a perdu, au coût moyen', () => {
    const d = base();
    d.purchases.push(achat('p3', [ligne('Plan de travail chêne', 10, 70.25, { destination: 'stock' })], { fees: 0, date: '2026-02-01' }));
    const avant = C.stockTotals(d).value;
    d.documents.push({ id: 'f1', type: 'facture', status: 'envoyée', number: 'F-1', date: '2026-04-02', clientId: 'c1', projectId: 'A', currency: 'DT', issuedTs: 2,
      lines: [{ label: 'Plan de travail chêne', itemId: 'pl', qty: 3, unitPrice: 180, vatRate: 19 }, { label: 'Pose', qty: 6, unitPrice: 35, vatRate: 19 }] });
    // Et la matière utilisée sur le chantier, notée pour l'affaire.
    d.stockAdjustments.push({ id: 'aj1', itemId: 'pl', date: '2026-04-05', qty: -1, source: 'consommation', projectId: 'A', createdAt: 3 });
    const perte = C.round3(avant - C.stockTotals(d).value);
    const m = C.projectMargin(d, co, 'A');
    expect(m.stockSorti).toBe(perte);
    // 4 plans au coût moyen de (10 × 50,125 + 10 × 70,25) / 20 = 60,1875, que la page Stock arrondit au millime
    // (60,188) : 240,752, exactement ce que le stock a perdu.
    expect(m.stockSorti).toBe(240.752);
    expect(m.cost).toBe(240.752);
    expect(m.margin).toBe(C.round3(3 * 180 + 6 * 35 - 240.752));
  });

  it('les heures coûtent le coût employeur de l\'heure : celui du bulletin, sinon celui du contrat (estimé)', () => {
    const d = base();
    const e = { id: 'mt', name: 'Mourad Trabelsi', grossSalary: 1450.375, contract: 'cdi', hireDate: '2019-04-01' };
    d.employees.push(e);
    d.projectTime.push({ id: 't1', projectId: 'A', employeeId: 'mt', date: '2026-03-12', hours: 7.5 }, { id: 't2', projectId: 'A', employeeId: 'mt', date: '2026-04-03', hours: 4 });
    const s = C.payrollSettings(d);
    const contrat = C.computePayslip(e, {}, s).employerCost;
    expect(contrat).toBeGreaterThan(1450.375);
    // Mars a son bulletin, avec une prime : c'est lui qui fait le coût de l'heure.
    d.payslips.push({ id: 'b3', employeeId: 'mt', year: 2026, month: 3, bonuses: [{ label: 'Prime de chantier', amount: 120, taxable: true }] });
    const mars = C.payslipsOf(d, 2026, 3)[0].c.employerCost;
    const h = C.heuresDeLAffaire(d, 'A');
    const t1 = h.find((x: Obj) => x.id === 't1'), t2 = h.find((x: Obj) => x.id === 't2');
    expect([t1.estime, t2.estime]).toEqual([false, true]);
    expect(t1.cout).toBe(C.round3(7.5 * mars / 208));
    expect(t2.cout).toBe(C.round3(4 * contrat / 208));
    const m = C.projectMargin(d, co, 'A');
    expect([m.hours, m.mainOeuvre, m.laborEstimated]).toEqual([11.5, C.round3(t1.cout + t2.cout), true]);
    // Sans réglage d'heures du mois, le coût est inconnu : zéro, et dit — jamais un nombre inventé.
    d.payrollSettings.heuresMois = 0;
    expect(C.heuresDeLAffaire(d, 'A').every((x: Obj) => x.inconnu && x.cout === 0)).toBe(true);
  });

  it('le prévu vient des devis non refusés ; sans devis, il n\'y a pas de prévu', () => {
    const d = base();
    expect(C.projectMargin(d, co, 'A').planned).toBe(null);
    d.documents.push({ id: 'q1', type: 'devis', status: 'accepté', number: 'D-1', date: '2026-02-01', projectId: 'A', currency: 'DT', lines: [{ label: 'Cuisine', qty: 1, unitPrice: 4200, unitCost: 2950.5, vatRate: 19 }] },
      { id: 'q2', type: 'devis', status: 'refusé', number: 'D-2', date: '2026-02-02', projectId: 'A', currency: 'DT', lines: [{ label: 'Option', qty: 1, unitPrice: 900, unitCost: 100, vatRate: 19 }] });
    const pl = C.projectMargin(d, co, 'A').planned;
    expect([pl.revenue, pl.cost, pl.margin, pl.quotes, pl.complete]).toEqual([4200, 2950.5, 1249.5, 1, true]);
  });

  it('l\'année mois par mois : la somme des douze résultats est le résultat de l\'année (exemple de cinq ans)', () => {
    const d = demo.buildDemoData({ ...C.DEFAULT_COMPANY }, '2026-09-28');
    for (const y of [2024, 2025, 2026]) {
      const r = C.margeMoisParMois(d, d.company, y, '2026-09-28');
      expect(r.mois.length).toBe(12);
      // Chaque mois s'arrondit au millime : douze arrondis peuvent faire quelques millimes d'écart avec l'année, jamais
      // plus d'un demi-millime par mois — et l'écran le dit quand il y en a (`ecart`).
      expect(Math.abs(r.ecart)).toBeLessThanOrEqual(0.006);
      expect(r.ecart).toBe(C.round3(r.mois.reduce((s: number, x: Obj) => s + x.result, 0) - r.annee.result));
      expect(Math.abs(r.annee.revenue - r.mois.reduce((s: number, x: Obj) => s + x.revenue, 0))).toBeLessThan(0.0015);
    }
    // Chaque affaire de l'exemple : achats + stock + main d'œuvre = coût, et le PDF porte sa marge.
    for (const p of d.projects || []) {
      const m = C.projectMargin(d, d.company, p.id);
      expect(C.round3(m.achats + m.stockSorti + m.mainOeuvre)).toBe(m.cost);
      expect(C.affaireHtml(d, d.company, p.id)).toContain(C.money(m.margin, null, 3, 'fr'));
    }
  });
});
