// Payer les salaires du mois (1.74.0 ; docs/paie.md, « Payer les salaires du mois »). Les salaires d'un mois qui restent à
// payer : un bulletin non payé par ligne, son mode, le RIB de son salarié et son net ; ce qui manque à un virement se dit sur
// sa ligne (pas de RIB, un RIB que sa clé refuse). L'ordre de virement à remettre à la banque : une ligne par bénéficiaire,
// le total en chiffres et en lettres — la somme des nets qu'il porte. Les données discriminent : des nets au millime, un
// bulletin déjà payé et un d'un autre mois qui n'y sont pas, un mode de bulletin qui l'emporte sur celui de la fiche.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
type Ligne = { id: string; employeeId: string; name: string; mode: string; rib: string; net: number; manque: string; raison: string };
const core = ecranDeLaPlateforme('core.js') as {
  salairesAPayer: (d: Objet, annee: number, mois: number) => Ligne[];
  ordreDeVirementHtml: (societe: Objet, o: Objet) => string;
  amountToWords: (n: number, devise: string) => string;
};

const RIB_UN = '08100123456789012359';
const RIB_DEUX = '10045000001234567883';
const salarie = (id: string, name: string, method: string, iban: string) => ({ id, name, method, iban, grossSalary: 1000, contract: 'cdi' });
const bulletin = (id: string, employeeId: string, month: number, net: number, plus: Objet = {}) =>
  ({ id, employeeId, year: 2026, month, computed: { gross: net + 100, net }, paidDate: '', method: '', ...plus });
const donnees = (): Objet => ({
  employees: [salarie('s1', 'Salariée Numéro Une', 'virement', RIB_UN), salarie('s2', 'Salarié Numéro Deux', 'virement', ''),
    salarie('s3', 'Salarié Numéro Trois', 'virement', '08100123456789012358'), salarie('s4', 'Salarié Numéro Quatre', 'especes', ''),
    salarie('s5', 'Salarié Numéro Cinq', 'especes', RIB_DEUX), salarie('s6', 'Salarié Numéro Six', 'virement', RIB_DEUX)],
  payslips: [bulletin('b1', 's1', 9, 1234.567), bulletin('b2', 's2', 9, 987.654), bulletin('b3', 's3', 9, 1500.001),
    bulletin('b4', 's4', 9, 800.5), bulletin('b5', 's5', 9, 1111.111, { method: 'virement' }),
    // Payé, ou d'un autre mois : pas à payer en septembre.
    bulletin('b6', 's6', 9, 999.999, { paidDate: '2026-09-30' }), bulletin('b7', 's1', 8, 1234.567)],
  accounts: [],
});

describe('payer les salaires du mois, dans le moteur', () => {
  it('les salaires à payer : les bulletins non payés du mois, le mode, le RIB et ce qui manque à un virement', () => {
    expect(core.salairesAPayer(donnees(), 2026, 9).map((l) => [l.id, l.name, l.mode, l.rib, l.net, l.manque])).toEqual([
      ['b5', 'Salarié Numéro Cinq', 'virement', RIB_DEUX, 1111.111, ''],
      ['b2', 'Salarié Numéro Deux', 'virement', '', 987.654, 'rib'],
      ['b4', 'Salarié Numéro Quatre', 'especes', '', 800.5, ''],
      ['b3', 'Salarié Numéro Trois', 'virement', '08100123456789012358', 1500.001, 'rib-douteux'],
      ['b1', 'Salariée Numéro Une', 'virement', RIB_UN, 1234.567, ''],
    ]);
    const trois = core.salairesAPayer(donnees(), 2026, 9).find((l) => l.id === 'b3');
    expect(trois?.raison).toBe('Les deux derniers chiffres du RIB (sa clé) ne correspondent pas aux dix-huit premiers : une faute de frappe, probablement.');
    expect(core.salairesAPayer(donnees(), 2026, 10)).toEqual([]);
  });

  it('l\'ordre de virement : une ligne par bénéficiaire, le compte à débiter, le total en chiffres et en lettres, la ville et le jour', () => {
    const lignes = core.salairesAPayer(donnees(), 2026, 9).filter((l) => l.mode === 'virement' && !l.manque);
    const html = core.ordreDeVirementHtml({ name: 'Boulangerie du Port', address: 'Rue du Port\n2000 Le Bardo', matricule: '1234567A/A/M/000', managerName: 'Gérant Numéro Un', currency: 'DT' },
      { year: 2026, month: 9, date: '2026-10-02', compte: { bank: 'Banque Numéro Une', rib: RIB_DEUX }, lignes });
    const texte = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');
    // Le total : la somme des nets qu'il porte (1 111,111 + 1 234,567).
    expect(texte).toContain('N° Bénéficiaire RIB / IBAN Montant (DT)');
    expect(texte).toContain('Total (2 virements) 2 345,678 Arrêté');
    expect(texte).toContain(`Arrêté le présent ordre à la somme de : ${core.amountToWords(2345.678, 'DT').replace(/[\u00a0\u202f]/g, ' ')}`);
    expect(texte).toContain(`1 Salarié Numéro Cinq ${RIB_DEUX} 1 111,111 2 Salariée Numéro Une ${RIB_UN} 1 234,567 Total`);
    expect(texte).toContain(`par le débit de notre compte n° ${RIB_DEUX}`);
    expect(texte).toContain('À l\'attention de Banque Numéro Une');
    expect(texte).toContain('Objet : virement des salaires de septembre 2026');
    expect(texte).toContain('Le Bardo, le 02/10/2026 Pour la société Gérant Numéro Un');
    expect(texte).not.toContain('Salarié Numéro Deux');
  });
});
