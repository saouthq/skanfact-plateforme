// Le livre d'un exercice du Cabinet v10, lu pour la reprise (brique 62 ; docs/cabinet.md, C52). Le
// Cabinet v10 écrit un fichier par dossier et par exercice (`livre-AAAA.json`, compta.js `livreVide`) :
// ses écritures, validées (numérotées) ou au brouillard, et ce qui vit autour (lettrages, relevés,
// immobilisations, révisions, questions, paie). Ici on le LIT, sans rien créer : l'essai à blanc de la
// reprise (08 § 2.1). Chaque montant se relit en millimes exacts ; ce qui ne se reprendrait pas tel quel
// est nommé, écriture par écriture, avec sa raison — jamais corrigé en silence.

import { createHash } from 'node:crypto';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { estJour } from '../v10/lecture.ts';
import { motif, type Texte } from '../../textes/index.ts';
import './textes.ts';

// Les journaux que la plateforme connaît (0015) : un autre ne se reprend pas tel quel.
export const JOURNAUX_REPRIS = ['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'] as const;
const COMPTE = /^\d{1,12}$/;

type Json = Record<string, unknown>;
const estObjet = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texte = (v: unknown, max = 500) => String(v ?? '').slice(0, max);
// Un montant du fichier de la v10 : un nombre JSON tel que la v10 l'a écrit (arrondi au millime,
// `round3`), relu au millime EXACT ; un nombre qui a plus de trois décimales (ou s'écrit en puissance de
// dix) ne se lit pas — il n'est jamais arrondi ici.
function montant(v: unknown): bigint | null {
  if (v === undefined || v === null || v === '') return 0n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const t = String(v);
  if (/e/i.test(t)) return null;
  try { return depuisTexte(t, 3); } catch { return null; }
}

// `rangV10` : la place de la ligne dans l'écriture de la v10 (lignes vides comprises) — c'est elle que
// citent les rapprochements des relevés.
export type LigneReprise = { compte: string; libelle: string; tiers: string; debit: bigint; credit: bigint; lettre: string; rangV10: number };
export type EcritureReprise = {
  refV10: string; date: string; journal: string; piece: string; libelle: string; source: string;
  statut: 'brouillard' | 'validee'; numeroV10: number | null; lignes: LigneReprise[];
};
export type Anomalie = { ecriture: string; piece: string; date: string; motif: Texte };
// Un relevé bancaire du livre (brique 66) : ses lignes au sens de la banque (positif : l'argent entre),
// et pour chacune ce qui lui répond dans le livre (une écriture de la v10 et la place de sa ligne) ou le
// jugement de l'automatique quand il n'a pas tranché.
export type LigneReleveReprise = {
  date: string; libelle: string; reference: string; montant: bigint;
  face: { ecriture: string; rangV10: number; niveau: 'certain' | 'probable' | 'a-confirmer'; auto: boolean } | null;
  niveau: 'aucun' | 'probable' | 'a-confirmer';
};
export type ReleveReprise = {
  refV10: string; compte: string; banque: string; fichier: string; empreinte: string; du: string; au: string;
  soldeDebut: bigint; soldeFin: bigint; lignes: LigneReleveReprise[];
};
export type LivreLu = {
  annee: number; du: string; au: string; clos: boolean;
  ecritures: EcritureReprise[]; anomalies: Anomalie[];
  // Ce que le livre porte en plus des écritures, compté : la reprise de chacun viendra à son tour.
  autour: Record<string, number>;
  // Les lettrages du livre (une lettre, ses lignes) : repris avec les écritures (brique 65).
  lettrages: number;
  // Les relevés bancaires et leurs rapprochements (brique 66).
  releves: ReleveReprise[];
};

// Lire un livre de la v10. Rend `null` si ce n'est pas un livre du tout (le rapport le dit).
export function lireLivreV10(o: unknown): LivreLu | null {
  if (!estObjet(o) || o.format !== 1 || !estObjet(o.exercice) || !Array.isArray(o.ecritures)) return null;
  const ex = o.exercice;
  const annee = Number(ex.annee);
  if (!Number.isInteger(annee) || annee < 1900 || annee > 2999) return null;
  const du = estJour(ex.du) ? ex.du : `${annee}-01-01`;
  const au = estJour(ex.au) ? ex.au : `${annee}-12-31`;
  const anomalies: Anomalie[] = [];
  const ecritures: EcritureReprise[] = [];
  const numeros = new Map<number, string>();
  for (const x of o.ecritures) {
    if (!estObjet(x)) continue;
    const e: EcritureReprise = {
      refV10: texte(x.id, 200), date: texte(x.date, 10), journal: texte(x.journal, 10), piece: texte(x.piece, 200),
      libelle: texte(x.libelle), source: texte(x.source, 20), statut: x.statut === 'validee' ? 'validee' : 'brouillard',
      numeroV10: x.statut === 'validee' && Number.isInteger(Number(x.numero)) && Number(x.numero) > 0 ? Number(x.numero) : null, lignes: [],
    };
    const nomme = (m: Texte) => anomalies.push({ ecriture: e.refV10, piece: e.piece, date: e.date, motif: m });
    let lisible = true, unCote = true;
    for (const [rangV10, l] of liste(x.lignes).entries()) {
      if (!estObjet(l)) continue;
      const debit = montant(l.debit), credit = montant(l.credit);
      if (debit === null || credit === null || debit < 0n || credit < 0n) { lisible = false; continue; }
      if (debit === 0n && credit === 0n && !String(l.compte ?? '').trim()) continue;   // une ligne vide
      if ((debit > 0n) === (credit > 0n)) unCote = false;
      e.lignes.push({ compte: String(l.compte ?? '').trim(), libelle: texte(l.libelle), tiers: texte(l.tiers, 200), debit, credit, lettre: texte(l.lettre, 20), rangV10 });
    }
    if (!lisible) nomme(motif('reprise.montant'));
    if (!unCote) nomme(motif('reprise.un_cote'));
    if (!estJour(e.date)) nomme(motif('reprise.date'));
    else if (e.date < du || e.date > au) nomme(motif('reprise.hors_exercice', { du, au }));
    if (!(JOURNAUX_REPRIS as readonly string[]).includes(e.journal)) nomme(motif('reprise.journal', { journal: e.journal }));
    if (e.lignes.length < 2) nomme(motif('reprise.deux_lignes'));
    const faux = e.lignes.filter((l) => !COMPTE.test(l.compte));
    if (faux.length) nomme(motif('reprise.compte', { compte: faux[0]?.compte ?? '' }));
    const d = e.lignes.reduce((s, l) => s + l.debit, 0n), c = e.lignes.reduce((s, l) => s + l.credit, 0n);
    if (d !== c) nomme(motif('reprise.desequilibre', { debit: versTexte(d, 3), credit: versTexte(c, 3) }));
    if (e.statut === 'validee') {
      if (e.numeroV10 === null) nomme(motif('reprise.sans_numero'));
      else if (numeros.has(e.numeroV10)) nomme(motif('reprise.numero_pris', { numero: String(e.numeroV10) }));
      else numeros.set(e.numeroV10, e.refV10);
    }
    ecritures.push(e);
  }
  // Les lettrages (brique 65) : chaque lettre relie des lignes d'un seul compte, d'au moins deux
  // écritures validées, dont la somme est nulle — la règle de la v10 (lettrer) et de la plateforme.
  const groupes = new Map<string, { comptes: Set<string>; solde: bigint; ecritures: Set<string>; brouillard: boolean; premiere: EcritureReprise }>();
  for (const e of ecritures) {
    for (const l of e.lignes) {
      if (!l.lettre) continue;
      const g = groupes.get(l.lettre) ?? { comptes: new Set<string>(), solde: 0n, ecritures: new Set<string>(), brouillard: false, premiere: e };
      g.comptes.add(l.compte); g.solde += l.debit - l.credit; g.ecritures.add(e.refV10);
      if (e.statut !== 'validee') g.brouillard = true;
      groupes.set(l.lettre, g);
    }
  }
  for (const [lettre, g] of groupes) {
    const e = g.premiere;
    const nomme = (m: Texte) => anomalies.push({ ecriture: e.refV10, piece: e.piece, date: e.date, motif: m });
    if (!/^[A-Z]{1,5}$/.test(lettre)) nomme(motif('reprise.lettre_forme', { lettre }));
    else if (g.comptes.size > 1) nomme(motif('reprise.lettre_comptes', { lettre, comptes: [...g.comptes].join(', ') }));
    else if (g.brouillard) nomme(motif('reprise.lettre_brouillard', { lettre }));
    else if (g.ecritures.size < 2) nomme(motif('reprise.lettre_seule', { lettre }));
    else if (g.solde !== 0n) nomme(motif('reprise.lettre_solde', { lettre, reste: versTexte(g.solde, 3) }));
  }
  const releves = lireReleves(liste(o.releves), ecritures, anomalies);
  const autour: Record<string, number> = {
    immobilisations: liste(o.immobilisations).length, declarations: liste(o.declarations).length,
    inventaires: liste(o.inventaires).length, revisions: liste(o.revisions).length, questions: liste(o.questions).length,
    salaries: liste(o.salaries).length, bulletins: liste(o.bulletins).length,
  };
  return { annee, du, au, clos: ex.clos === true, ecritures, anomalies, autour, lettrages: groupes.size, releves };
}

const NIVEAUX_POSES = ['certain', 'probable', 'a-confirmer'] as const;
const NIVEAUX_JUGES = ['probable', 'a-confirmer'] as const;

// Les relevés bancaires du livre (brique 66), lus comme la banque de la plateforme les importe (0023) :
// un compte, des lignes lisibles au millime, un relevé qui se BOUCLE (solde de début + mouvements =
// solde de fin), un fichier qui n'est pas deux fois dans le livre ; et chaque rapprochement vers une
// ligne d'écriture du livre qui touche le compte du relevé, jamais deux fois la même. Ce qui ne passe
// pas est nommé au relevé (son fichier, son premier jour).
function lireReleves(brut: unknown[], ecritures: EcritureReprise[], anomalies: Anomalie[]): ReleveReprise[] {
  const parRef = new Map(ecritures.map((e) => [e.refV10, e]));
  const empreintes = new Set<string>();
  const faces = new Set<string>();
  const releves: ReleveReprise[] = [];
  for (const x of brut) {
    if (!estObjet(x)) continue;
    const lignesV10 = liste(x.lignes).filter(estObjet);
    const empreinte = /^[0-9a-f]{64}$/.test(String(x.empreinte ?? '')) ? String(x.empreinte)
      // Un relevé sans l'empreinte de son fichier : celle de son contenu, pour qu'il ne s'importe pas deux fois.
      : createHash('sha256').update(JSON.stringify({ compte: x.compte, soldeDebut: x.soldeDebut, soldeFin: x.soldeFin, lignes: lignesV10.map((l) => [l.date, l.libelle, l.montant, l.reference]) })).digest('hex');
    const r: ReleveReprise = {
      refV10: texte(x.id, 200), compte: String(x.compte ?? '').trim(), banque: texte(x.banque, 60), fichier: texte(x.fichier, 200), empreinte,
      du: texte(x.du, 10), au: texte(x.au, 10), soldeDebut: 0n, soldeFin: 0n, lignes: [],
    };
    const nomme = (m: Texte) => anomalies.push({ ecriture: r.refV10, piece: r.fichier || r.compte, date: r.du, motif: m });
    const debut = montant(x.soldeDebut), fin = montant(x.soldeFin);
    if (debut === null || fin === null) nomme(motif('reprise.releve_solde'));
    r.soldeDebut = debut ?? 0n; r.soldeFin = fin ?? 0n;
    if (!COMPTE.test(r.compte)) nomme(motif('reprise.releve_compte'));
    if (!lignesV10.length) nomme(motif('reprise.releve_vide'));
    if (empreintes.has(empreinte)) nomme(motif('reprise.releve_double'));
    empreintes.add(empreinte);
    for (const [i, l] of lignesV10.entries()) {
      const m = montant(l.montant);
      if (m === null || !estJour(l.date)) { nomme(motif('reprise.releve_ligne', { n: String(i + 1) })); continue; }
      const ligne: LigneReleveReprise = { date: String(l.date), libelle: texte(l.libelle), reference: texte(l.reference, 100), montant: m, face: null, niveau: 'aucun' };
      const a = estObjet(l.rapprochement) ? l.rapprochement : {};
      const niveau = String(a.niveau ?? '');
      const cible = texte(a.ecritureId, 200);
      if (cible) {
        const rangV10 = Number(a.ligne);
        const e = parRef.get(cible);
        const face = e?.lignes.find((y) => y.rangV10 === rangV10);
        if (!face || face.compte !== r.compte) nomme(motif('reprise.releve_face', { n: String(i + 1), compte: r.compte }));
        else if (faces.has(`${cible}#${rangV10}`)) nomme(motif('reprise.releve_face_double', { n: String(i + 1) }));
        else {
          faces.add(`${cible}#${rangV10}`);
          ligne.face = { ecriture: cible, rangV10, niveau: (NIVEAUX_POSES as readonly string[]).includes(niveau) ? niveau as typeof NIVEAUX_POSES[number] : 'certain', auto: a.par === 'auto' };
        }
      } else if ((NIVEAUX_JUGES as readonly string[]).includes(niveau)) ligne.niveau = niveau as 'probable' | 'a-confirmer';
      r.lignes.push(ligne);
    }
    const somme = r.lignes.reduce((s, l) => s + l.montant, 0n);
    if (debut !== null && fin !== null && r.lignes.length === lignesV10.length && debut + somme !== fin) {
      nomme(motif('reprise.releve_boucle', { debut: versTexte(debut, 3), mouvements: versTexte(somme, 3), fin: versTexte(fin, 3) }));
    }
    releves.push(r);
  }
  return releves;
}

// Le rapport de l'essai à blanc : ce qui passe, compté ; la balance des écritures validées ; ce qui ne
// passe pas, écriture par écriture. Les montants en texte décimal.
export function rapportDuLivre(l: LivreLu) {
  const validees = l.ecritures.filter((e) => e.statut === 'validee');
  const journaux: Record<string, { ecritures: number; validees: number; dernierNumero: number | null }> = {};
  for (const e of l.ecritures) {
    const j = (journaux[e.journal] ??= { ecritures: 0, validees: 0, dernierNumero: null });
    j.ecritures++;
    if (e.statut === 'validee') { j.validees++; if (e.numeroV10 !== null) j.dernierNumero = Math.max(j.dernierNumero ?? 0, e.numeroV10); }
  }
  const comptes = new Map<string, { debit: bigint; credit: bigint }>();
  for (const e of validees) {
    for (const x of e.lignes) {
      const c = comptes.get(x.compte) ?? { debit: 0n, credit: 0n };
      c.debit += x.debit; c.credit += x.credit;
      comptes.set(x.compte, c);
    }
  }
  const balance = [...comptes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([compte, c]) => ({ compte, debit: versTexte(c.debit, 3), credit: versTexte(c.credit, 3), solde: versTexte(c.debit - c.credit, 3) }));
  const total = (k: 'debit' | 'credit') => versTexte([...comptes.values()].reduce((s, c) => s + c[k], 0n), 3);
  return {
    annee: l.annee, du: l.du, au: l.au, clos: l.clos,
    ecritures: { total: l.ecritures.length, validees: validees.length, brouillard: l.ecritures.length - validees.length, aNouveaux: l.ecritures.filter((e) => e.journal === 'AN').length },
    journaux, balance, totaux: { debit: total('debit'), credit: total('credit') },
    lettrages: l.lettrages,
    releves: { total: l.releves.length, lignes: l.releves.reduce((n, r) => n + r.lignes.length, 0), rapprochees: l.releves.reduce((n, r) => n + r.lignes.filter((x) => x.face).length, 0) },
    anomalies: l.anomalies, autour: l.autour,
  };
}
