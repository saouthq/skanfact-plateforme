// 1.300.0 — la revue des Marges jouée par un électricien (trois chantiers, un contrat d'entretien). Le moteur :
//   - un chantier en cours se lit à l'avancement (`avancementAffaire`) : sa marge attendue n'est négative que s'il va
//     vraiment perdre de l'argent ;
//   - l'état des chantiers à une date (`etatDesChantiers`) prend les chiffres de la fiche sur les seules pièces datées au
//     plus tard ce jour — un second chemin : la même affaire calculée sur un dossier qu'on a coupé à la main ;
//   - « Où est la marge » ne donne pas 100 % à un client qui n'a reçu qu'un acompte.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };

const devis = (id: string, projectId: string, date: string, prix: number, cout: number): Obj => ({ id, type: 'devis', number: `DEV-${id}`, status: 'accepté', date, clientId: 'c1', projectId,
  lines: [{ label: 'Installation', qty: 1, unitPrice: prix, unitCost: cout, vatRate: 19 }], discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', payments: [] });
const facture = (id: string, projectId: string, date: string, ht: number, extra: Obj = {}): Obj => ({ id, type: 'facture', number: `FAC-${id}`, status: 'envoyée', date, clientId: 'c1', projectId,
  lines: [{ label: 'Installation', qty: 1, unitPrice: ht, vatRate: 19, ...(extra.acompte ? { noDiscount: true } : {}) }], discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', payments: [] });
const achat = (id: string, projectId: string, date: string, ht: number): Obj => ({ id, kind: 'facture', supplierId: 's1', date, projectId, currency: 'DT', fees: 0, payments: [],
  lines: [{ label: 'Câbles', qty: 1, unitPrice: ht, vatRate: 19, destination: 'charge' }] });
const base = (): Obj => ({
  company: co, clients: [{ id: 'c1', name: 'Lac Services' }], suppliers: [{ id: 's1', name: 'Comptoir Électrique du Sahel' }],
  projects: [
    { id: 'L', name: 'Bureaux Lac 2', clientId: 'c1', status: 'en cours', startDate: '2026-10-12' },
    { id: 'E', name: 'Immeuble Ennasr', clientId: 'c1', status: 'terminée', startDate: '2026-09-01', endDate: '2026-10-25' },
    { id: 'S', name: 'Sans devis', clientId: 'c1', status: 'en cours', startDate: '2026-10-01' },
  ],
  documents: [devis('qL', 'L', '2026-10-05', 26300, 17850.4), facture('fL', 'L', '2026-10-14', 7890, { acompte: true }),
    devis('qE', 'E', '2026-08-20', 16900, 13200), facture('fE', 'E', '2026-10-26', 17540)],
  purchases: [achat('aL', 'L', '2026-10-20', 9874.415), achat('aE1', 'E', '2026-09-05', 11846.3), achat('aE2', 'E', '2026-10-02', 5912.65), achat('aS', 'S', '2026-10-03', 1200.125),
    achat('aL2', 'L', '2026-11-04', 2000.5)],
  stockAdjustments: [], employees: [], payslips: [], projectTime: [], catalog: [], payrollSettings: { heuresMois: 208 },
});

describe('les marges 1.300.0', () => {
  it('un chantier en cours se lit à l\'avancement : sa marge à ce jour est négative, sa marge attendue ne l\'est pas', () => {
    const d = base();
    const m = C.projectMargin(d, co, 'L');
    expect(m.margin).toBe(-3984.915); // 7 890 facturés, 11 874,915 engagés
    const av = C.avancementAffaire(m);
    // 11 874,915 sur 17 850,400 prévus : 66,5 % ; 66,52 % de 26 300 = 17 495,981 de travaux faits.
    expect(av).toMatchObject({ pourcent: 66.5, faits: 17495.981, ecart: 9605.981, attendue: 8449.6, taux: 32.1, prevuVendu: 26300, prevuCout: 17850.4 });
    // La liste porte le même avancement, et seulement pour un chantier en cours.
    const l = C.projectList(d, co);
    expect(l.find((x: Obj) => x.id === 'L').av).toEqual(av);
    expect(l.find((x: Obj) => x.id === 'E').av).toBeNull();
    // Sans devis chiffré, rien ne se calcule : pas un pourcentage inventé.
    expect(C.avancementAffaire(C.projectMargin(d, co, 'S'))).toBeNull();
    // Un coût engagé qui dépasse le prévu : avancement plafonné à 100 %, perte attendue.
    const e = C.avancementAffaire(C.projectMargin(d, co, 'E'));
    expect(e).toMatchObject({ pourcent: 100, faits: 16900, attendue: -858.95 });
  });

  it('l\'état des chantiers au 20 octobre : les seules pièces d\'avant, l\'immeuble encore en cours avec sa perte ; deux chemins, un chiffre', () => {
    const d = base();
    const e = C.etatDesChantiers(d, co, '2026-10-20');
    // En cours d'abord, puis par nom.
    expect(e.chantiers.map((c: Obj) => [c.id, c.fini])).toEqual([['L', false], ['E', false], ['S', false]]);
    const par = Object.fromEntries(e.chantiers.map((c: Obj) => [c.id, c]));
    // Second chemin : le dossier coupé à la main au 20 octobre, et la fiche de l'affaire calculée dessus.
    const coupe = base();
    coupe.documents = coupe.documents.filter((x: Obj) => x.date <= '2026-10-20');
    coupe.purchases = coupe.purchases.filter((x: Obj) => x.date <= '2026-10-20');
    for (const id of ['L', 'E', 'S']) {
      const m = C.projectMargin(coupe, co, id);
      expect([par[id].vendu, par[id].cout]).toEqual([m.revenue, m.cost]);
      expect(par[id].av).toEqual(C.avancementAffaire(m));
    }
    // L'immeuble : la facture du 26 octobre ne compte pas ; 17 758,950 engagés pour 13 200 prévus, perte attendue.
    expect(par.E).toMatchObject({ fini: false, vendu: 0, cout: 17758.95, perte: -858.95 });
    expect(par.L).toMatchObject({ vendu: 7890, cout: 9874.415 });
    expect(par.S.av).toBeNull();
    expect(e).toMatchObject({ enCours: 3, finis: 0, sansDevis: 1, pertes: -858.95 });
    expect(e.resteAFacturer).toBe(Math.round((par.E.av.ecart + par.L.av.ecart) * 1000) / 1000);
    // Au 31 octobre, l'immeuble est fini (fin le 25) : rien à reporter pour lui.
    const fin = C.etatDesChantiers(d, co, '2026-10-31');
    expect(fin.chantiers.find((c: Obj) => c.id === 'E')).toMatchObject({ fini: true, av: null, perte: 0 });
    // Avant le début d'un chantier, il n'est pas dans l'état.
    expect(C.etatDesChantiers(d, co, '2026-10-11').chantiers.map((c: Obj) => c.id)).not.toContain('L');
  });

  it('« Où est la marge » : un client qui n\'a reçu qu\'un acompte n\'a pas de taux ; avec ses prestations, il en a un', () => {
    const d = base();
    const acompte = C.marginBy(d, co, '2026-10-01', '2026-10-20', 'client', 0).find((r: Obj) => r.key === 'c1');
    expect(acompte).toMatchObject({ revenue: 7890, cost: 0, rate: null });
    const tout = C.marginBy(d, co, '2026-10-01', '2026-10-31', 'client', 0).find((r: Obj) => r.key === 'c1');
    expect(tout.rate).toBe(Math.round((tout.revenue - tout.cost) / tout.revenue * 1000) / 10);
  });
});
