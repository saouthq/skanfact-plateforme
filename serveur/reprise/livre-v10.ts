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
import { PERIODE_REVISION, REVISION } from '../cabinet/revision.ts';
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
  // Les immobilisations et les écritures de l'année qui portent leur dotation ou leur sortie (brique 67).
  biens: BienReprise[];
  // La révision de chaque période et les questions au client (brique 68).
  revisions: RevisionReprise[];
  questions: QuestionReprise[];
  // Les déclarations préparées et l'inventaire de stock, chacun relié à son écriture (brique 69).
  declarations: DeclarationReprise[];
  inventaire: InventaireReprise | null;
};

// Une déclaration du mois préparée dans la v10 (brique 69) : ses cases en millimes (ou vides), ses
// deux pense-bêtes (déposée, payée), l'écriture du mois qui lui est liée.
export type DeclarationReprise = {
  periode: string; cases: Record<string, bigint | null>; preparee: number;
  deposee: { le: string; reference: string } | null; payee: string | null; ecriture: string;
};
// L'inventaire de stock de l'exercice (brique 69) : ses lignes (quantité en millièmes, coût en
// millimes), et l'écriture de variation qui lui est liée.
export type InventaireReprise = {
  date: string; compte: string; lignes: { ref: string; libelle: string; quantite: bigint; cout: bigint }[]; ecriture: string;
};

// Le dossier de révision d'une période (brique 68), dans la forme que la plateforme garde (0028).
export type RevisionReprise = { periode: string; contenu: ReturnType<typeof REVISION.parse> };
// Une question au client (brique 68) : son état tel que la v10 le tenait (ouverte, envoyée, répondue,
// close), ses envois, sa réponse ; la pièce en face de laquelle elle est née, à relier à l'écriture reprise.
export type QuestionReprise = {
  periode: string; cycle: string; compte: string; ecriture: string; piece: string; montant: bigint; objet: string; texte: string;
  attendu: 'piece' | 'explication' | 'confirmation'; statut: 'ouverte' | 'envoyee' | 'repondue' | 'close';
  envois: number[]; posee: number; reponse: string | null; repondue: number | null; close: number | null;
};

// Un bien du livre (brique 67) : sa fiche dans la forme de l'API (montants en texte exact, durée en
// années), l'écriture d'acquisition dont il est né (`docRef`, à relier à l'écriture reprise), et les
// écritures de l'exercice qui portent sa dotation ou sa sortie.
export type FicheBien = {
  libelle: string; compte: string; compteAmort: string; compteDotation: string; dateAcquisition: string; dateMiseEnService: string;
  valeur: string; residuelle: string; tva: string; methode: 'lineaire' | 'degressif'; duree: string; tauxDegressif: string | null; bascule: boolean;
  subvention: { montant: string; compte: string; compteReprise: string } | null;
  cession: { date: string; prix: string; motif: 'cession' | 'rebut' } | null;
  origine: { source: string; docId: string; mois: string };
};
export type BienReprise = {
  refV10: string; fiche: FicheBien; docRef: { ecriture: string; rangV10: number } | null;
  liens: { genre: 'dotation' | 'cession'; ecriture: string }[];
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
  const biens = lireBiens(liste(o.immobilisations), ecritures, annee, anomalies);
  const revisions = lireRevisions(liste(o.revisions), annee, anomalies);
  const questions = lireQuestions(liste(o.questions), ecritures, annee, anomalies);
  const declarations = lireDeclarations(liste(o.declarations), ecritures, annee, anomalies);
  const inventaire = lireInventaire(liste(o.inventaires), ecritures, annee, anomalies);
  const autour: Record<string, number> = {
    salaries: liste(o.salaries).length, bulletins: liste(o.bulletins).length,
  };
  return { annee, du, au, clos: ex.clos === true, ecritures, anomalies, autour, lettrages: groupes.size, releves, biens, revisions, questions, declarations, inventaire };
}

// Un nombre de la v10 à au plus `d` décimales (une durée, un taux), en texte ; null s'il ne se lit pas.
const decimal = (v: unknown, d: number) => {
  const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return new RegExp(`^\\d+(\\.\\d{1,${d}})?$`).test(t) ? t : null;
};

// Les immobilisations du livre (brique 67), lues pour la fiche de la plateforme (0026) : un libellé,
// des comptes en chiffres, une date de mise en service, des montants au millime, une durée au centième
// d'année, un taux dégressif à quatre décimales au plus. Les règles du plan (une résiduelle sous la
// valeur…) sont celles de la v10 et de la base, qui les refait. Pour l'exercice du livre, l'écriture
// qui porte la dotation ou la sortie du bien doit être dans le livre, et être l'une ou l'autre.
function lireBiens(brut: unknown[], ecritures: EcritureReprise[], annee: number, anomalies: Anomalie[]): BienReprise[] {
  const parRef = new Map(ecritures.map((e) => [e.refV10, e]));
  const biens: BienReprise[] = [];
  for (const x of brut) {
    if (!estObjet(x)) continue;
    const mes = texte(x.dateMiseEnService, 10) || texte(x.dateAcquisition, 10);
    const libelle = texte(x.libelle, 200).trim();
    const nomme = (m: Texte) => anomalies.push({ ecriture: texte(x.id, 200), piece: libelle, date: mes, motif: m });
    const argent = (v: unknown) => { const m = montant(v); return m === null ? null : versTexte(m, 3); };
    const sub = estObjet(x.subvention) && Number(x.subvention.montant) ? x.subvention : null;
    const ces = estObjet(x.cession) && x.cession.date ? x.cession : null;
    const valeurs = [argent(x.valeur), argent(x.residuelle), argent(x.tva), sub ? argent(sub.montant) : '0', ces ? argent(ces.prix) : '0'];
    const duree = decimal(x.duree, 2);
    const taux = x.tauxDegressif === null || x.tauxDegressif === undefined || x.tauxDegressif === '' ? null : decimal(x.tauxDegressif, 4);
    const comptes = [x.compte, x.compteAmort, x.compteDotation, ...(sub ? [sub.compte, sub.compteReprise] : [])].map((c) => String(c ?? '').trim());
    if (!libelle) nomme(motif('reprise.immo_libelle'));
    if (comptes.some((c) => !COMPTE.test(c))) nomme(motif('reprise.immo_compte'));
    if (!estJour(mes) || (ces && !estJour(ces.date))) nomme(motif('reprise.immo_date'));
    if (valeurs.some((v) => v === null)) nomme(motif('reprise.immo_montant'));
    if (duree === null) nomme(motif('reprise.immo_duree'));
    if (taux === null && x.tauxDegressif !== null && x.tauxDegressif !== undefined && x.tauxDegressif !== '') nomme(motif('reprise.immo_taux'));
    const [compte = '', compteAmort = '', compteDotation = ''] = comptes;
    const origine = estObjet(x.origine) ? x.origine : {};
    const doc = /^(.+)#(\d+)$/.exec(texte(origine.docId, 300));
    const bien: BienReprise = {
      refV10: texte(x.id, 200),
      fiche: {
        libelle, compte, compteAmort, compteDotation, dateAcquisition: texte(x.dateAcquisition, 10) || mes, dateMiseEnService: mes,
        valeur: valeurs[0] ?? '0', residuelle: valeurs[1] ?? '0', tva: valeurs[2] ?? '0', methode: x.methode === 'degressif' ? 'degressif' : 'lineaire',
        duree: duree ?? '0', tauxDegressif: taux, bascule: x.bascule === true,
        subvention: sub ? { montant: valeurs[3] ?? '0', compte: comptes[3] ?? '', compteReprise: comptes[4] ?? '' } : null,
        cession: ces ? { date: texte(ces.date, 10), prix: valeurs[4] ?? '0', motif: ces.motif === 'rebut' ? 'rebut' : 'cession' } : null,
        origine: { source: texte(origine.source, 20) || 'saisie', docId: texte(origine.docId, 100), mois: texte(origine.mois, 7) },
      },
      docRef: doc && parRef.has(doc[1] ?? '') ? { ecriture: doc[1] ?? '', rangV10: Number(doc[2]) } : null,
      liens: [],
    };
    for (const l of liste(x.plan)) {
      if (!estObjet(l) || Number(l.annee) !== annee || !texte(l.ecritureId, 200)) continue;
      const e = parRef.get(texte(l.ecritureId, 200));
      if (!e) { nomme(motif('reprise.immo_ecriture', { annee: String(annee) })); continue; }
      const genre = e.lignes.some((y) => y.compte === compteDotation && y.debit > 0n) ? 'dotation'
        : e.lignes.some((y) => y.compte === compte && y.credit > 0n) ? 'cession' : null;
      if (!genre) nomme(motif('reprise.immo_genre', { annee: String(annee), piece: e.piece }));
      else bien.liens.push({ genre, ecriture: e.refV10 });
    }
    biens.push(bien);
  }
  return biens;
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
    declarations: { total: l.declarations.length, deposees: l.declarations.filter((d) => d.deposee).length },
    inventaire: l.inventaire ? { lignes: l.inventaire.lignes.length } : null,
    revisions: { total: l.revisions.length, arretees: l.revisions.filter((r) => r.contenu.faite).length },
    questions: { total: l.questions.length, enAttente: l.questions.filter((q) => q.statut === 'ouverte' || q.statut === 'envoyee').length },
    immobilisations: { total: l.biens.length, liees: l.biens.reduce((n, b) => n + b.liens.length, 0) },
    releves: { total: l.releves.length, lignes: l.releves.reduce((n, r) => n + r.lignes.length, 0), rapprochees: l.releves.reduce((n, r) => n + r.lignes.filter((x) => x.face).length, 0) },
    anomalies: l.anomalies, autour: l.autour,
  };
}

// Un instant de la v10 (des millisecondes), ou null.
const instant = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8_640_000_000_000_000 ? v : null);
// Une période de la révision ou d'une question : l'année du livre, ou l'un de ses mois.
const periodeDuLivre = (p: string, annee: number) => PERIODE_REVISION.test(p) && p.slice(0, 4) === String(annee);

// La révision de chaque période (brique 68) : le dossier de travail du cabinet (comptes signés, notes
// de revue, questionnaire, révision arrêtée), relu dans la forme exacte que la plateforme garde. Ce qui
// n'y entre pas (un champ trop long, un instant illisible) est nommé à la période.
function lireRevisions(brut: unknown[], annee: number, anomalies: Anomalie[]): RevisionReprise[] {
  const revisions: RevisionReprise[] = [];
  const vues = new Set<string>();
  for (const x of brut) {
    if (!estObjet(x)) continue;
    const periode = texte(x.periode, 7);
    const nomme = (m: Texte) => anomalies.push({ ecriture: '', piece: periode, date: '', motif: m });
    if (!periodeDuLivre(periode, annee)) { nomme(motif('reprise.revision_periode', { annee: String(annee) })); continue; }
    if (vues.has(periode)) { nomme(motif('reprise.revision_double')); continue; }
    vues.add(periode);
    const lu = REVISION.safeParse({
      faite: x.faite === true, faiteLe: x.faite === true ? instant(x.faiteLe) : null, faitePar: texte(x.faitePar, 1000),
      comptes: liste(x.comptes).filter(estObjet).map((c) => ({ compte: String(c.compte ?? ''), revuLe: instant(c.revuLe) ?? 0, revuPar: texte(c.revuPar, 1000), note: texte(c.note, 5000) })),
      notes: liste(x.notes).filter(estObjet).map((n) => ({ id: texte(n.id, 100), texte: texte(n.texte, 5000), cycle: texte(n.cycle, 100), compte: String(n.compte ?? ''),
        par: texte(n.par, 1000), le: instant(n.le) ?? 0, levee: n.levee === true, leveeLe: n.levee === true ? instant(n.leveeLe) : null, leveePar: texte(n.leveePar, 1000) })),
      questionnaire: liste(x.questionnaire).filter(estObjet).map((q) => ({ id: texte(q.id, 100), question: texte(q.question, 1000), reponse: texte(q.reponse, 5000), par: texte(q.par, 1000), le: instant(q.le) })),
    });
    if (!lu.success) { nomme(motif('reprise.revision_forme', { champ: lu.error.issues[0]?.path.join('.') ?? '' })); continue; }
    revisions.push({ periode, contenu: lu.data });
  }
  return revisions;
}

const ATTENDUS = ['piece', 'explication', 'confirmation'] as const;
const STATUTS = ['ouverte', 'envoyee', 'repondue', 'close'] as const;

// Les questions au client (brique 68), telles que la v10 les tenait : leur texte, ce qu'elles
// attendent, leur état. Une question qui a sa réponse est « répondue » (ou close) ; une question
// jamais envoyée est « ouverte » (ou close) — les règles de la table (0028). Ce qui ne s'y plie pas
// est nommé à la pièce de la question.
function lireQuestions(brut: unknown[], ecritures: EcritureReprise[], annee: number, anomalies: Anomalie[]): QuestionReprise[] {
  const refs = new Set(ecritures.map((e) => e.refV10));
  const questions: QuestionReprise[] = [];
  for (const x of brut) {
    if (!estObjet(x)) continue;
    const r = estObjet(x.reponse) ? x.reponse : null;
    const q: QuestionReprise = {
      periode: texte(x.periode, 7), cycle: texte(x.cycle, 40), compte: String(x.compte ?? '').trim(), ecriture: refs.has(texte(x.ecritureId, 200)) ? texte(x.ecritureId, 200) : '',
      piece: texte(x.piece, 200), montant: montant(x.montant) ?? 0n, objet: texte(x.objet, 200).trim(), texte: texte(x.texte, 2000).trim(),
      attendu: (ATTENDUS as readonly string[]).includes(String(x.attendu)) ? x.attendu as QuestionReprise['attendu'] : 'explication',
      statut: (STATUTS as readonly string[]).includes(String(x.statut)) ? x.statut as QuestionReprise['statut'] : 'ouverte',
      envois: liste(x.envois).map(instant).filter((v): v is number => v !== null), posee: instant(x.creeLe) ?? 0,
      reponse: r && texte(r.texte, 4000).trim() ? texte(r.texte, 4000).trim() : null, repondue: r ? instant(r.le) : null, close: instant(x.closeLe),
    };
    const nomme = (m: Texte) => anomalies.push({ ecriture: texte(x.id, 200), piece: q.piece || q.compte || q.periode, date: '', motif: m });
    if (!periodeDuLivre(q.periode, annee)) nomme(motif('reprise.question_periode', { annee: String(annee) }));
    if (!q.texte) nomme(motif('reprise.question_texte'));
    if (q.compte && !COMPTE.test(q.compte)) nomme(motif('reprise.question_compte'));
    if (montant(x.montant) === null) nomme(motif('reprise.question_montant'));
    if (!(STATUTS as readonly string[]).includes(String(x.statut))) nomme(motif('reprise.question_statut'));
    else if ((q.statut === 'repondue') !== (q.reponse !== null) && q.statut !== 'close') nomme(motif('reprise.question_reponse'));
    else if ((q.statut === 'ouverte') !== (q.envois.length === 0) && q.statut !== 'close') nomme(motif('reprise.question_envois'));
    questions.push(q);
  }
  return questions;
}

// Les cases de la déclaration du mois : la liste de la v10 et de la base (compta.cases_declaration, 0024).
const CASES_DECLARATION = ['tvaCollectee', 'tvaDeductible', 'creditReporte', 'netAPayer', 'creditAReporter', 'timbre', 'retenuesOperees',
  'retenuesSubies', 'irpp', 'aDecaisser', 'tfp', 'foprolos', 'tcl', 'acomptes'];

// Les déclarations préparées du livre (brique 69) : une par mois de l'exercice, ses cases (un montant
// lisible au millime, ou vide), déposée un jour qui se lit, jamais payée sans être déposée, et
// l'écriture du mois (si elle est passée) dans le livre. Ce qui ne passe pas est nommé au mois.
function lireDeclarations(brut: unknown[], ecritures: EcritureReprise[], annee: number, anomalies: Anomalie[]): DeclarationReprise[] {
  const refs = new Set(ecritures.map((e) => e.refV10));
  const vues = new Set<string>();
  const declarations: DeclarationReprise[] = [];
  for (const x of brut) {
    if (!estObjet(x)) continue;
    const periode = texte(x.periode, 7);
    const nomme = (m: Texte) => anomalies.push({ ecriture: texte(x.id, 200), piece: periode, date: '', motif: m });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode) || periode.slice(0, 4) !== String(annee)) { nomme(motif('reprise.declaration_periode', { annee: String(annee) })); continue; }
    if (vues.has(periode)) { nomme(motif('reprise.declaration_double')); continue; }
    vues.add(periode);
    const cases: Record<string, bigint | null> = {};
    for (const [k, v] of Object.entries(estObjet(x.cases) ? x.cases : {})) {
      if (!CASES_DECLARATION.includes(k)) { nomme(motif('reprise.declaration_case', { case: k })); continue; }
      const brute = estObjet(v) ? v.montant : v;
      const m = brute === null || brute === undefined || brute === '' ? null : montant(brute);
      if (m === null && brute !== null && brute !== undefined && brute !== '') { nomme(motif('reprise.declaration_montant', { case: k })); continue; }
      cases[k] = m;
    }
    const dep = estObjet(x.deposee) && texte(x.deposee.le, 10) ? x.deposee : null;
    const pay = estObjet(x.payee) && texte(x.payee.le, 10) ? texte(x.payee.le, 10) : null;
    if ((dep && !estJour(dep.le)) || (pay && !estJour(pay))) nomme(motif('reprise.declaration_jour'));
    if (pay && !dep) nomme(motif('reprise.declaration_payee'));
    const ecriture = texte(x.ecritureId, 200);
    if (ecriture && !refs.has(ecriture)) nomme(motif('reprise.declaration_ecriture'));
    declarations.push({ periode, cases, preparee: instant(x.prepareeLe) ?? 0, deposee: dep ? { le: texte(dep.le, 10), reference: texte(dep.reference, 100) } : null,
      payee: pay, ecriture: refs.has(ecriture) ? ecriture : '' });
  }
  return declarations;
}

// L'inventaire de stock de l'exercice (brique 69) : un seul, daté dans l'année, un compte de stock,
// chaque ligne avec sa désignation (un inventaire sans ligne, la base le refuse en le disant), une quantité (trois décimales au plus) et un coût
// unitaire au millime, jamais négatifs ; l'écriture de variation (si elle est passée) dans le livre.
function lireInventaire(brut: unknown[], ecritures: EcritureReprise[], annee: number, anomalies: Anomalie[]): InventaireReprise | null {
  const refs = new Set(ecritures.map((e) => e.refV10));
  const tous = brut.filter(estObjet);
  const x = tous[0];
  if (!x) return null;
  const date = texte(x.date, 10);
  const nomme = (m: Texte) => anomalies.push({ ecriture: texte(x.id, 200), piece: String(annee), date, motif: m });
  if (tous.length > 1) nomme(motif('reprise.inventaire_double'));
  if (!estJour(date) || date.slice(0, 4) !== String(annee)) nomme(motif('reprise.inventaire_date', { annee: String(annee) }));
  const compte = String(x.compte ?? '').trim();
  if (!COMPTE.test(compte)) nomme(motif('reprise.inventaire_compte'));
  const lignes: InventaireReprise['lignes'] = [];
  for (const [i, l] of liste(x.lignes).entries()) {
    if (!estObjet(l)) continue;
    const quantite = montant(l.quantite), cout = montant(l.cout);
    if (!texte(l.libelle, 200).trim() || quantite === null || cout === null || quantite < 0n || cout < 0n) { nomme(motif('reprise.inventaire_ligne', { n: String(i + 1) })); continue; }
    lignes.push({ ref: texte(l.ref, 60), libelle: texte(l.libelle, 200).trim(), quantite, cout });
  }
  const ecriture = texte(x.ecritureId, 200);
  if (ecriture && !refs.has(ecriture)) nomme(motif('reprise.inventaire_ecriture'));
  return { date, compte, lignes, ecriture: refs.has(ecriture) ? ecriture : '' };
}
