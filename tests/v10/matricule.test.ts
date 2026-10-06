// La forme d'un matricule fiscal, jugée par l'écran et par le serveur (lot facture, 05/10/2026 ; docs/facture-details.md,
// D6). La fiche société porte le matricule à l'entreprise quand il est bien formé (serveur/v10/identite.ts) ; l'écran dit
// avant d'émettre qu'il manque « un matricule fiscal valide » (web/public/v10/core.js, `companyGaps`). Deux chemins, un
// verdict : un matricule que l'écran laisse passer et que le serveur ne porte pas resterait faux sans que rien ne le dise.
// Vu ensuite sur le serveur d'essai (E2, E3) : la lettre-clé n'est jamais I, O ni U (la règle du fichier El Fatoora), et
// la pièce imprime le matricule sous la forme que le serveur garde, pas tel qu'il a été tapé.

import { describe, expect, it } from 'vitest';
import { matriculeCanonique } from '../../serveur/matricule.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Objet = Record<string, unknown>;
type Core = {
  matriculeBienForme: (v: unknown) => boolean; matriculeLisible: (v: unknown) => string; companyGaps: (c: Objet) => string[];
  documentHtml: (doc: Objet, client: Objet, company: Objet, opts: Objet) => string;
  ticketHtml: (doc: Objet, company: Objet, opts: Objet) => string;
  payslipHtml: (slip: Objet, data: Objet, company: Objet, opts: Objet) => string;
  hrDocumentHtml: (kind: string, employee: Objet, data: Objet, company: Objet, opts: Objet) => string;
  releveHtml: (releve: Objet, company: Objet, opts: Objet) => string;
  packCoverHtml: (plan: Objet, company: Objet, opts: Objet) => string;
};
const C = ecranDeLaPlateforme('core.js') as Core;

describe('la forme d\'un matricule fiscal, à l\'écran et au serveur', () => {
  // Comme on les recopie d'une carte d'identification fiscale, d'un cachet ou d'une facture reçue.
  const ecrits = ['1234567A/A/M/000', '1234567a/a/m/000', ' 1234567 A A M 000 ', '1234567/A/A/M/000', '1234567-A-A-M-000', '1234567AAM000',
    '1234567A', '1234567', '1234567A/A/M', '123456A/A/M/000', 'A234567A/A/M/000', '1234567A/A/M/0000', '12345678', 'MF 1234567A/A/M/000', '', '   ',
    // La lettre-clé n'est jamais I, O ni U (teif.js) : un O tapé pour un 0, un I pour un 1.
    '1234567I/A/M/000', '1234567o/a/m/000', '1234567U/A/M/000'];

  it('l\'écran et le serveur disent la même chose de chaque matricule écrit, et l\'écrivent pareil sous sa forme lisible', () => {
    const bienFormes = ecrits.filter((m) => C.matriculeBienForme(m));
    // Le test mesure : il y a des deux.
    expect(bienFormes.length).toBeGreaterThan(3);
    expect(bienFormes.length).toBeLessThan(ecrits.length - 3);
    for (const m of ecrits) {
      const garde = matriculeCanonique(m);
      expect(typeof garde === 'string', m).toBe(C.matriculeBienForme(m));
      // Ce que l'écran imprime : la forme que le serveur garde ; ce qui n'est pas un matricule, tel quel.
      expect(C.matriculeLisible(m), m).toBe(garde ?? m.trim());
    }
    expect(bienFormes.map(matriculeCanonique)).toEqual(Array(bienFormes.length).fill('1234567A/A/M/000'));
    expect(matriculeCanonique('   ')).toBeNull();
  });

  it('la fiche société nomme un matricule mal formé comme un matricule absent, et laisse en paix un matricule juste', () => {
    const fiche = (matricule: string) => C.companyGaps({ name: 'Pâtisserie Les Délices de Sfax', matricule, activity: 'boulangerie', rib: '' })
      .filter((g) => !/RIB/.test(g));
    expect(fiche('')).toEqual(['le matricule fiscal']);
    expect(fiche('1234567A')).toEqual(['un matricule fiscal valide (sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement : 1234567A/A/M/000)']);
    expect(fiche('1234567O/A/M/000')).toEqual(fiche('1234567A'));
    expect(fiche('1234567A/A/M/000')).toEqual([]);
  });

  it('chaque pièce imprimée porte les matricules sous leur forme lisible, en tête comme au pied ; une carte d\'identité, telle quelle', () => {
    // Tapés comme on les recopie : la pièce les imprimait ainsi (vu sur le serveur d'essai, E2).
    const societe = { name: 'Pâtisserie Les Délices de Sfax', address: 'Route de Tunis, Sfax', matricule: '1357913 b / a / m / 000', currency: 'DT' };
    const hotel = { id: 'c1', name: 'Hôtel Les Oliviers', matricule: ' 7654321 b a m 000 ' };
    const amine = { id: 'e1', name: 'Amine Trabelsi', startDate: '2024-01-01', endDate: '2026-09-30', position: 'Pâtissier', salary: 1200 };
    const donnees = { company: societe, employees: [amine], payslips: [], clients: [hotel], documents: [] };
    const facture = { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'émise', date: '2026-10-05', dueDate: '2026-11-04', clientId: 'c1',
      lines: [{ label: 'Gâteau d\'anniversaire', qty: 2, unitPrice: 42.5, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [], currency: 'DT' };
    const ticket = { id: 't1', type: 'facture', ticket: true, number: 'T-0001', date: '2026-10-05', lines: [{ label: 'Pain', qty: 1, unitPrice: 0.2, vatRate: 0 }], payments: [], currency: 'DT' };
    const pieces: Record<string, string> = {
      facture: C.documentHtml(facture, hotel, societe, { preview: true }),
      ticket: C.ticketHtml(ticket, societe, {}),
      bulletin: C.payslipHtml({ id: 's1', employeeId: 'e1', year: 2026, month: 9 }, donnees, societe, {}),
      attestation: C.hrDocumentHtml('attestation', amine, donnees, societe, {}),
      certificat: C.hrDocumentHtml('certificat', amine, donnees, societe, {}),
      solde: C.hrDocumentHtml('solde', amine, donnees, societe, {}),
      releve: C.releveHtml({ client: hotel, date: '2026-10-05', lignes: [], solde: 0 }, societe, {}),
      paquet: C.packCoverHtml({ period: { label: 'Septembre 2026', from: '2026-09-01', to: '2026-09-30' }, totaux: {}, checklist: [], manifest: {}, balance: {} }, societe, {}),
    };
    for (const [nom, html] of Object.entries(pieces)) {
      const texte = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      expect(texte, nom).toContain('1357913B/A/M/000');
      // Ni en tête, ni dans le texte, ni au pied : nulle part tel qu'il a été tapé.
      expect(texte, nom).not.toMatch(/1357913 b|7654321 b/);
    }
    expect(pieces.facture).toMatch(/MF \/ CIN 7654321B\/A\/M\/000/);
    expect(pieces.releve).toContain('7654321B/A/M/000');
    expect(C.documentHtml(facture, { ...hotel, matricule: '01234567' }, societe, { preview: true }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('MF / CIN 01234567');
  });
});
