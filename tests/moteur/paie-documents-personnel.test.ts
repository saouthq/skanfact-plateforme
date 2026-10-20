// Les documents du personnel (1.72.0 ; docs/paie.md, « Les documents du personnel au Cabinet »). L'attestation de travail,
// le certificat de travail et le solde de tout compte de l'entreprise (5.1.0) s'impriment aussi au Cabinet : leur liste et ce
// que le solde propose vivent dans le moteur commun (compta.js), que core.js reprend. Deux chemins, un chiffre : l'indemnité
// de congés non pris que la fenêtre propose est celle que le document imprime (elle se comptait de deux façons). Les données
// discriminent : une sortie le 14 août (sept mois de congés acquis, 10,5 jours), un dernier bulletin à 1 301,250 de brut
// (50,048 par jour) qui n'est pas le plus gros de la liste (celui d'un autre salarié, ni le premier de l'année).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
type Ligne = { label: string; amount: number; cle?: string };
type Indemnite = { solde: number; jours: number; journalier: number; montant: number };
type Moteur = {
  HR_DOCS: [string, string, string][];
  CIVILITES: [string, string][];
  indemniteConges: (d: Objet, salarie: string, jour: string) => Indemnite;
  lignesDuSolde: (d: Objet, salarie: string, jour: string) => Ligne[];
  normaliserSalarie: (s: Objet, id: string) => Objet;
  hrDocumentHtml: (genre: string, salarie: Objet, d: Objet, societe: Objet, opts: Objet) => string;
};
const compta = ecranDeLaPlateforme('compta.js') as Moteur;
const core = ecranDeLaPlateforme('core.js') as Moteur;

const une = { id: 's1', name: 'Salariée Numéro Une', gender: 'f', cin: '07123456', cnss: '12345678-90', position: 'Comptable', contract: 'cdi',
  grossSalary: 1234.567, hireDate: '2025-03-10', endDate: '2026-08-14' };
const deux = { id: 's2', name: 'Salarié Numéro Deux', gender: 'm', grossSalary: 4000, hireDate: '2024-01-01', contract: 'cdi' };
const bulletin = (id: string, employeeId: string, year: number, month: number, gross: number) => ({ id, employeeId, year, month, computed: { gross } });
function donnees(): Objet {
  return {
    employees: [une, deux],
    // Son dernier bulletin (juillet 2026), entre un plus ancien et celui, plus gros et plus récent, d'un autre salarié.
    payslips: [bulletin('p1', 's1', 2026, 6, 1250), bulletin('p2', 's1', 2026, 7, 1301.25), bulletin('p3', 's2', 2026, 8, 9999.999), bulletin('p0', 's1', 2025, 12, 1500)],
    leaves: [], advances: [], payrollSettings: {},
  };
}
const societe = { name: 'Boulangerie du Port', address: 'Rue du Port\n2000 Le Bardo', matricule: '1234567A/A/M/000', managerName: 'Gérant Numéro Un', currency: 'DT' };
const texte = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');

describe('les documents du personnel, dans le moteur commun', () => {
  it('l\'indemnité de congés non pris : au jour de la sortie, au salaire d\'un jour du dernier bulletin de ce salarié', () => {
    // Sortie le 14 août : sept mois de 2026 (1,5 jour par mois), quel que soit le jour du document.
    const attendue = { solde: 10.5, jours: 10.5, journalier: 50.048, montant: 525.504 };
    expect(compta.indemniteConges(donnees(), 's1', '2026-06-30')).toEqual(attendue);
    expect(compta.indemniteConges(donnees(), 's1', '2026-12-31')).toEqual(attendue);
    // Sans sortie, la date donnée arrête le compte (trois mois, 4,5 jours) ; sans bulletin, le salaire de sa fiche.
    const d = donnees();
    d.employees = [{ ...une, endDate: '' }, deux];
    d.payslips = [];
    expect(compta.indemniteConges(d, 's1', '2026-03-31')).toEqual({ solde: 4.5, jours: 4.5, journalier: 47.483, montant: 213.674 });
    // Des congés pris d'avance : le solde est négatif, l'indemnité nulle.
    const e = donnees();
    e.leaves = [{ id: 'l1', employeeId: 's1', kind: 'conges', from: '2026-06-01', to: '2026-06-30', days: 25 }];
    const avance = compta.indemniteConges(e, 's1', '2026-08-14');
    expect(avance.solde).toBeLessThan(0);
    expect([avance.jours, avance.montant]).toEqual([0, 0]);
  });

  it('deux chemins, un chiffre : la ligne que la fenêtre propose est celle que le document imprime', () => {
    const lignes = compta.lignesDuSolde(donnees(), 's1', '2026-08-20');
    expect(lignes.map((l) => [l.label, l.amount])).toEqual([
      ['Salaire du mois en cours', 0], ['Indemnité de congés non pris (10,5 jours)', 525.504], ['Indemnité de préavis', 0], ['Indemnité de fin de contrat', 0]]);
    expect(lignes.find((l) => l.cle === 'conges')?.amount).toBe(525.504);
    // Le document, daté deux mois avant la sortie (préparé d'avance : au 15 juin, il compterait 7,5 jours), compte au jour
    // de la sortie, comme la fenêtre.
    const doc = texte(core.hrDocumentHtml('solde', une, donnees(), societe, { date: '2026-06-15', lines: lignes }));
    expect(doc).toContain('Indemnité de congés non pris (10,5 jours) 525,504');
    expect(doc).toContain('Solde de congés non pris au départ : 10,5 jours , soit 525,504 DT sur la base du dernier salaire');
    // core.js reprend la liste du moteur commun : une seule copie.
    expect(core.HR_DOCS).toEqual(compta.HR_DOCS);
    expect(compta.HR_DOCS.map((d) => d[0])).toEqual(['attestation', 'certificat', 'solde']);
  });

  it('la civilité : « Madame » et l\'accord, « Monsieur », rien quand elle manque', () => {
    const d = donnees();
    const attestation = texte(core.hrDocumentHtml('attestation', une, d, societe, { date: '2026-08-20' }));
    expect(attestation).toContain('Madame Salariée Numéro Une , titulaire de la carte d\'identité nationale n° 07123456, immatriculée à la CNSS');
    expect(attestation).toContain('Je soussigné, Gérant Numéro Un , agissant en qualité de représentant légal de la société Boulangerie du Port');
    expect(attestation).toContain('Le Bardo, le 20/08/2026');
    const certificat = texte(core.hrDocumentHtml('certificat', une, d, societe, { date: '2026-08-20' }));
    expect(certificat).toContain('Madame Salariée Numéro Une');
    expect(certificat).toContain('a été employée au sein de notre société');
    expect(certificat).toContain('L\'intéressée est libre');
    expect(texte(core.hrDocumentHtml('solde', une, d, societe, { date: '2026-08-20', lines: [] }))).toContain('et Madame Salariée Numéro Une');
    expect(texte(core.hrDocumentHtml('certificat', deux, d, societe, { date: '2026-08-20' }))).toMatch(/Monsieur Salarié Numéro Deux .*a été employé au sein/);
    const sans = texte(core.hrDocumentHtml('certificat', { ...une, gender: '' }, d, societe, { date: '2026-08-20' }));
    expect(sans).toContain(' Salariée Numéro Une ');
    expect(sans).not.toMatch(/Madame|Monsieur/);
    expect(sans).toContain('a été employé au sein');
  });

  it('la fiche d\'un salarié du Cabinet garde sa civilité ; ce que la liste ne connaît pas ne se garde pas', () => {
    expect(compta.CIVILITES).toEqual([['m', 'Monsieur'], ['f', 'Madame']]);
    expect(compta.normaliserSalarie({ nom: 'Une', genre: 'f' }, 's1').genre).toBe('f');
    expect(compta.normaliserSalarie({ nom: 'Deux', genre: 'm' }, 's2').genre).toBe('m');
    expect(compta.normaliserSalarie({ nom: 'Trois', genre: 'x' }, 's3').genre).toBe('');
    expect(compta.normaliserSalarie({ nom: 'Quatre' }, 's4').genre).toBe('');
  });
});
