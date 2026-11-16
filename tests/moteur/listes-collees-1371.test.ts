// Les listes collées du premier jour (1.371.0) : les salariés d'un client et le tableau de ses immobilisations, copiés
// d'un tableur. La ligne de titres décide des colonnes, dans n'importe quel ordre ; une ligne illisible est refusée avec
// son numéro et sa raison, les autres entrent ; rien ne se devine en silence.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Salarie = { nom: string; cin: string; cnss: string; poste: string; contrat: string; brut: number; embauche: string; embaucheSupposee: boolean; enfants: number; chefDeFamille: boolean; genre: string };
type Bien = { libelle: string; famille: string; dateMiseEnService: string; valeur: number; duree: number; dureeProposee: boolean; compte: string };
type Refus = { ligne: number; nom?: string; motif: string };
function cabcore() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
  return bac.CabCore as {
    parseSalariesLines: (t: string, o?: unknown) => { salaries: Salarie[]; refus: Refus[]; ignores: string[]; colonnesIgnorees: string[]; avecTitres: boolean };
    parseBiensLines: (t: string, o?: unknown) => { biens: Bien[]; refus: Refus[]; ignores: string[]; colonnesIgnorees: string[]; avecTitres: boolean };
  };
}
const K = cabcore();
const FAMILLES = [['informatique', 'Matériel informatique', 3], ['bureau', 'Matériel de bureau', 5], ['transport', 'Matériel de transport', 5], ['autre', 'Autre immobilisation', 5]];
const tsv = (...l: string[][]) => l.map((c) => c.join('\t')).join('\n');

describe('une liste de salariés collée', () => {
  it('les titres décident des colonnes, dans le désordre ; prénom et nom se réunissent ; une colonne inconnue est nommée', () => {
    const r = K.parseSalariesLines(tsv(
      ['Fonction', 'Prénom', 'Nom', 'Matricule CNSS', 'Nature du contrat', 'Salaire de base', 'Date d\'entrée', 'Nombre d\'enfants', 'Civilité', 'Ville'],
      ['Menuisier', 'Amine', 'Ben Salah', '12345678-90', 'Durée indéterminée', '1250,500', '01/03/2022', '2', 'M', 'Tunis'],
      ['Secrétaire', 'Sonia', 'Khelifi', '', 'CDD', '900', '15/09/2024', '', 'Mme', 'Ariana']), { annee: 2026 });
    expect(r.avecTitres).toBe(true);
    expect(r.colonnesIgnorees).toEqual(['Ville']);
    expect(r.refus).toEqual([]);
    expect(r.salaries.map((s) => [s.nom, s.poste, s.cnss, s.contrat, s.brut, s.embauche, s.enfants, s.chefDeFamille, s.genre])).toEqual([
      ['Amine Ben Salah', 'Menuisier', '12345678-90', 'cdi', 1250.5, '2022-03-01', 2, true, 'm'],
      ['Sonia Khelifi', 'Secrétaire', '', 'cdd', 900, '2024-09-15', 0, false, 'f']]);
  });
  it('une ligne illisible est refusée avec son numéro et sa raison ; les autres entrent', () => {
    const r = K.parseSalariesLines(tsv(['Nom', 'Salaire brut', 'Date d\'embauche'], ['Amine', '1200', '01/03/2022'], ['Sans Brut', '', '01/01/2024'],
      ['Brut Faux', 'mille', '01/01/2024'], ['Date Fausse', '900', '31/02/2024'], ['', '700', '']), { annee: 2026 });
    expect(r.salaries.map((s) => s.nom)).toEqual(['Amine']);
    expect(r.refus).toEqual([
      { ligne: 3, nom: 'Sans Brut', motif: 'le salaire brut manque' },
      { ligne: 4, nom: 'Brut Faux', motif: 'le salaire brut « mille » ne se lit pas' },
      { ligne: 5, nom: 'Date Fausse', motif: 'la date d\'embauche « 31/02/2024 » ne se lit pas (JJ/MM/AAAA)' },
      { ligne: 6, motif: 'le nom manque' }]);
  });
  it('sans date d\'embauche, le 1er janvier de l\'exercice est posé et marqué ; sans exercice connu, la ligne est refusée', () => {
    expect(K.parseSalariesLines('Nom;Brut\nKarim Jaziri;650', { annee: 2026 }).salaries.map((s) => [s.embauche, s.embaucheSupposee])).toEqual([['2026-01-01', true]]);
    expect(K.parseSalariesLines('Nom;Brut\nKarim Jaziri;650').refus).toEqual([{ ligne: 2, nom: 'Karim Jaziri', motif: 'la date d\'embauche manque' }]);
  });
  it('un salarié déjà au dossier, ou collé deux fois, est ignoré et nommé', () => {
    const r = K.parseSalariesLines('Nom;Brut;Embauche\nAmine Ben Salah;1200;01/03/2022\nSONIA khélifi;900;15/09/2024\nAmine  Ben  Salah;1200;01/03/2022',
      { annee: 2026, existants: [{ nom: 'Sonia Khelifi' }] });
    expect(r.salaries.map((s) => s.nom)).toEqual(['Amine Ben Salah']);
    expect(r.ignores).toEqual(['SONIA khélifi', 'Amine Ben Salah']);
  });
  it('sans ligne de titres, chaque cellule se reconnaît à sa forme', () => {
    const r = K.parseSalariesLines('Amine Ben Salah;Menuisier;01234567;12345678-90;1250,5;01/03/2022;CDD', { annee: 2026 });
    expect(r.avecTitres).toBe(false);
    expect(r.salaries.map((s) => [s.nom, s.poste, s.cin, s.cnss, s.brut, s.embauche, s.contrat])).toEqual([['Amine Ben Salah', 'Menuisier', '01234567', '12345678-90', 1250.5, '2022-03-01', 'cdd']]);
  });
});

describe('un tableau d\'immobilisations collé', () => {
  it('la durée se lit, ou se déduit du taux ; le compte se garde ; une colonne inconnue est nommée', () => {
    const r = K.parseBiensLines(tsv(
      ['Compte', 'Désignation', 'Date de mise en service', 'Valeur d\'acquisition HT', 'Taux d\'amortissement', 'Durée', 'Fournisseur'],
      ['2231', 'Scie à format', '15/03/2023', '18500,000', '10 %', '', 'SCM'],
      ['', 'Camionnette Partner', '01/06/2024', '62000', '20%', '', 'Stafim'],
      ['', 'Ordinateur portable', '10/01/2026', '2400,000', '', '3', 'Mytek']), { annee: 2026, familles: FAMILLES });
    expect(r.colonnesIgnorees).toEqual(['Fournisseur']);
    expect(r.refus).toEqual([]);
    expect(r.biens.map((b) => [b.libelle, b.dateMiseEnService, b.valeur, b.duree, b.dureeProposee, b.compte])).toEqual([
      ['Scie à format', '2023-03-15', 18500, 10, false, '2231'], ['Camionnette Partner', '2024-06-01', 62000, 5, false, ''], ['Ordinateur portable', '2026-01-10', 2400, 3, false, '']]);
  });
  it('sans durée ni taux, la famille reconnue propose la sienne (tous ses mots, pas « matériel » seul) ; sinon la ligne est refusée', () => {
    const r = K.parseBiensLines(tsv(['Désignation', 'Date de mise en service', 'Valeur'],
      ['Matériel de bureau divers', '01/02/2025', '1500'], ['Matériel de transport Kangoo', '02/02/2025', '30000'], ['Enseigne lumineuse', '03/03/2025', '900']), { annee: 2026, familles: FAMILLES });
    expect(r.biens.map((b) => [b.libelle, b.famille, b.duree, b.dureeProposee])).toEqual([['Matériel de bureau divers', 'bureau', 5, true], ['Matériel de transport Kangoo', 'transport', 5, true]]);
    expect(r.refus).toEqual([{ ligne: 4, nom: 'Enseigne lumineuse', motif: 'ni durée ni taux d\'amortissement : la durée ne se devine pas' }]);
  });
  it('une valeur ou une date manquante ou illisible refuse la ligne en la nommant ; un bien déjà au tableau est ignoré', () => {
    const r = K.parseBiensLines(tsv(['Désignation', 'Mise en service', 'Valeur', 'Durée'], ['Four', '15/03/2023', '45000', '10'], ['Vitrine', '', '3000', '5'],
      ['Comptoir', '01/01/2024', 'cher', '5'], ['Caisse', '01/01/2024', '', '5'], ['Four', '15/03/2023', '45000', '10']),
    { annee: 2026, familles: FAMILLES, existants: [] });
    expect(r.biens.map((b) => b.libelle)).toEqual(['Four']);
    expect(r.ignores).toEqual(['Four']);
    expect(r.refus.map((x) => [x.ligne, x.nom, x.motif.split(' :')[0]])).toEqual([
      [3, 'Vitrine', 'la date de mise en service manque'], [4, 'Comptoir', 'la valeur « cher » ne se lit pas'], [5, 'Caisse', 'la valeur d\'acquisition manque']]);
  });
});
