// Le calcul d'un bulletin de paie (porté de `computePayslip`, compta.js de la v10), en entiers.
// L'ORDRE est celui de la v10 : le brut (moins l'absence, plus les primes), la CNSS salariale sur
// l'assiette (les primes non imposables en sont hors), la base imposable annualisée, les frais
// professionnels plafonnés, les déductions de famille, l'IRPP au barème progressif annuel ramené au
// mois, la contribution sociale de solidarité, puis les charges patronales.
//
// Aucun taux n'est écrit ici (cadrage 01 R6) : le barème est donné, déjà lu à la date du bulletin
// (serveur/regles.ts) et déjà fusionné avec le régime du contrat ; un bulletin remis garde le barème
// qui l'a calculé (01 R7). Tous les montants sont en millimes ; les taux ont six décimales
// (9,18 % = 91 800) ; les jours sont en millièmes (une demi-journée = 500).
//
// À VÉRIFIER avec le comptable, comme dans la v10 : chaque règle de ce calcul peut changer d'une loi
// de finances à l'autre.

import { diviserArrondi, MILLION } from './argent.ts';

export type Tranche = { jusqua: bigint | null; taux: bigint };   // `jusqua` en millimes par an ; null : au-delà
export type BaremePaie = {
  cnssSalarie: bigint; cnssEmployeur: bigint; accidentTravail: bigint; tfp: bigint; foprolos: bigint;
  solidarite: bigint;           // contribution sociale de solidarité, sur la base imposable annuelle
  fraisPro: bigint;             // frais professionnels : un taux du salaire imposable annuel…
  plafondFraisPro: bigint;      // …plafonné à ce montant par an (millimes)
  chefDeFamille: bigint;        // déductions annuelles (millimes)
  parEnfant: bigint;
  enfantsMax: number;
  tranches: Tranche[];          // le barème annuel de l'IRPP
  sansIrpp?: boolean;           // un régime de contrat qui en dispense
};
export type Salarie = { chefDeFamille?: boolean; enfants?: number };
export type Prime = { montant: bigint; imposable: boolean };
export type SaisieMois = {
  brut: bigint;                 // le salaire de base du mois
  joursOuvrables: bigint;       // en millièmes
  joursAbsence?: bigint;        // en millièmes : une absence non payée réduit le brut au prorata
  primes?: Prime[];
  retenues?: bigint[];          // avances, oppositions…
};

export type Bulletin = {
  brutDeBase: bigint; retenueAbsence: bigint; primesImposables: bigint; primesNonImposables: bigint; brut: bigint;
  assietteCnss: bigint; cnssSalarie: bigint; apresCnss: bigint; imposableAnnuelAvantDeductions: bigint;
  fraisPro: bigint; deductionsFamille: bigint; enfants: number; imposableAnnuel: bigint;
  irppAnnuel: bigint; irpp: bigint; css: bigint; autresRetenues: bigint; net: bigint;
  cnssEmployeur: bigint; accidentTravail: bigint; tfp: bigint; foprolos: bigint; chargesPatronales: bigint; coutEmployeur: bigint;
};

const auTaux = (montant: bigint, taux: bigint) => diviserArrondi(montant * taux, MILLION);
const somme = (l: bigint[]) => l.reduce((a, b) => a + b, 0n);

// L'impôt annuel au barème progressif : chaque taux ne porte que sur la part du revenu comprise dans
// sa tranche (surtout pas sur toute la tranche quand le revenu s'arrête au milieu). Un seul arrondi,
// sur le total, comme la v10.
export function irppAnnuel(imposable: bigint, tranches: Tranche[]): bigint {
  const total = imposable > 0n ? imposable : 0n;
  let depuis = 0n, impot = 0n;
  for (const t of tranches) {
    const haut = t.jusqua === null ? total : (t.jusqua < total ? t.jusqua : total);
    if (haut > depuis) impot += (haut - depuis) * t.taux;
    if (t.jusqua === null || t.jusqua >= total) break;
    depuis = t.jusqua;
  }
  return diviserArrondi(impot, MILLION);
}

export function calculerBulletin(salarie: Salarie, saisie: SaisieMois, bareme: BaremePaie): Bulletin {
  const brutDeBase = saisie.brut;
  const absence = saisie.joursAbsence && saisie.joursAbsence > 0n ? saisie.joursAbsence : 0n;
  const retenueAbsence = absence > 0n && saisie.joursOuvrables > 0n ? diviserArrondi(brutDeBase * absence, saisie.joursOuvrables) : 0n;
  const primes = saisie.primes ?? [];
  const primesImposables = somme(primes.filter((p) => p.imposable).map((p) => p.montant));
  const primesNonImposables = somme(primes.filter((p) => !p.imposable).map((p) => p.montant));
  const brut = brutDeBase - retenueAbsence + primesImposables + primesNonImposables;
  // Les primes non imposables sont hors de l'assiette.
  const assietteCnss = brutDeBase - retenueAbsence + primesImposables;
  const cnssSalarie = auTaux(assietteCnss, bareme.cnssSalarie);

  // La base imposable du mois, annualisée pour le barème, puis l'impôt ramené au mois.
  const apresCnss = assietteCnss - cnssSalarie;
  const annuel = apresCnss * 12n;
  const pro = auTaux(annuel, bareme.fraisPro);
  const fraisPro = pro < bareme.plafondFraisPro ? pro : bareme.plafondFraisPro;
  const enfants = Math.min(salarie.enfants ?? 0, bareme.enfantsMax);
  const deductionsFamille = (salarie.chefDeFamille ? bareme.chefDeFamille : 0n) + BigInt(enfants) * bareme.parEnfant;
  const reste = annuel - fraisPro - deductionsFamille;
  const imposableAnnuel = reste > 0n ? reste : 0n;
  const irppAn = bareme.sansIrpp ? 0n : irppAnnuel(imposableAnnuel, bareme.tranches);
  const irpp = diviserArrondi(irppAn, 12n);
  const css = diviserArrondi(imposableAnnuel * bareme.solidarite, 12n * MILLION);

  const autresRetenues = somme(saisie.retenues ?? []);
  const net = brut - cnssSalarie - irpp - css - autresRetenues;
  // Les charges patronales (la TFP et le FOPROLOS sont des taxes sur la masse salariale) : elles
  // entrent dans le coût employeur, jamais dans le net.
  const cnssEmployeur = auTaux(assietteCnss, bareme.cnssEmployeur);
  const accidentTravail = auTaux(assietteCnss, bareme.accidentTravail);
  const tfp = auTaux(assietteCnss, bareme.tfp);
  const foprolos = auTaux(assietteCnss, bareme.foprolos);
  const chargesPatronales = cnssEmployeur + accidentTravail + tfp + foprolos;
  return {
    brutDeBase, retenueAbsence, primesImposables, primesNonImposables, brut,
    assietteCnss, cnssSalarie, apresCnss, imposableAnnuelAvantDeductions: annuel,
    fraisPro, deductionsFamille, enfants, imposableAnnuel,
    irppAnnuel: irppAn, irpp, css, autresRetenues, net,
    cnssEmployeur, accidentTravail, tfp, foprolos, chargesPatronales, coutEmployeur: brut + chargesPatronales,
  };
}

// ---------- les écritures de la paie ----------

export type ComptesPaie = {
  salairesBruts: string; chargesPatronales: string; taxesSalaires: string; tfpFoprolos: string;
  cnss: string; irpp: string; personnel: string;
};
export type LigneEcriturePaie = { compte: string; debit: bigint; credit: bigint };

// L'écriture d'un bulletin (la section « paie » de `journalEntries`, la même que le Cabinet écrit
// pour un dossier, 10.3.0) :
//   D salaires bruts         le brut
//   D charges patronales     CNSS employeur et accident du travail
//   D taxes sur salaires     TFP et FOPROLOS…
//   C TFP et FOPROLOS        …dues à l'État
//   C CNSS                   parts salariale et patronale, accident
//   C IRPP                   IRPP et contribution de solidarité retenus
//   C personnel              ce qui est dû au salarié : le net, plus les retenues (une avance qu'il
//                            rembourse solde le 425 qu'elle avait débité)
// Un bulletin au brut nul ou au net négatif ne s'écrit jamais : l'écriture inverserait ses colonnes
// et resterait plausible (la v10 le refuse au Cabinet depuis la 10.10.0).
export function ecritureDeBulletin(b: Bulletin, comptes: ComptesPaie): { journal: 'PAIE'; lignes: LigneEcriturePaie[] } {
  if (b.brut <= 0n || b.net < 0n) throw new Error('un bulletin au salaire nul ou négatif ne s\'écrit pas');
  const lignes: LigneEcriturePaie[] = [];
  const poser = (compte: string, montant: bigint, sens: 'debit' | 'credit') => {
    if (montant !== 0n) lignes.push({ compte, debit: sens === 'debit' ? montant : 0n, credit: sens === 'credit' ? montant : 0n });
  };
  poser(comptes.salairesBruts, b.brut, 'debit');
  poser(comptes.chargesPatronales, b.cnssEmployeur + b.accidentTravail, 'debit');
  poser(comptes.taxesSalaires, b.tfp + b.foprolos, 'debit');
  poser(comptes.tfpFoprolos, b.tfp + b.foprolos, 'credit');
  poser(comptes.cnss, b.cnssSalarie + b.cnssEmployeur + b.accidentTravail, 'credit');
  poser(comptes.irpp, b.irpp + b.css, 'credit');
  poser(comptes.personnel, b.net + b.autresRetenues, 'credit');
  const d = lignes.reduce((a, l) => a + l.debit - l.credit, 0n);
  if (d !== 0n) throw new Error(`écriture de paie déséquilibrée : ${d}`);
  return { journal: 'PAIE', lignes };
}

// Le salaire versé : la dette envers le salarié s'éteint, l'argent sort.
export function ecritureDePaiementSalaire(net: bigint, comptes: { personnel: string; tresorerie: string }): { lignes: LigneEcriturePaie[] } {
  if (net <= 0n) return { lignes: [] };
  return { lignes: [{ compte: comptes.personnel, debit: net, credit: 0n }, { compte: comptes.tresorerie, debit: 0n, credit: net }] };
}

// ---------- la déclaration CNSS du trimestre ----------

export type BulletinDuMois = { salarie: string; annee: number; mois: number; bulletin: Bulletin; joursOuvrables: bigint; joursAbsence?: bigint };
export type LigneCnss = {
  salarie: string; mois: number; jours: bigint;   // jours travaillés, en millièmes
  assiette: bigint; partSalarie: bigint; partEmployeur: bigint; accident: bigint; total: bigint;
};
export type DeclarationCnss = {
  annee: number; trimestre: number; lignes: LigneCnss[]; bulletins: number;
  assiette: bigint; partSalarie: bigint; partEmployeur: bigint; accident: bigint; total: bigint;
};

// Ce que la déclaration du trimestre porte (`cnssDeclaration`, core.js ; `cnssDuTrimestre`,
// compta.js) : pour chaque salarié, les mois déclarés, les jours travaillés, l'assiette et les
// cotisations de ses bulletins des trois mois ; puis les totaux. Les lignes suivent l'ordre où les
// salariés apparaissent ; l'écran les range par nom.
export function cnssDuTrimestre(bulletins: BulletinDuMois[], annee: number, trimestre: number): DeclarationCnss {
  if (!(trimestre >= 1 && trimestre <= 4)) throw new Error(`trimestre ${trimestre} : 1 à 4`);
  const premier = (trimestre - 1) * 3 + 1;
  const dans = bulletins.filter((b) => b.annee === annee && b.mois >= premier && b.mois < premier + 3);
  const par = new Map<string, LigneCnss>();
  for (const b of dans) {
    const l = par.get(b.salarie) ?? { salarie: b.salarie, mois: 0, jours: 0n, assiette: 0n, partSalarie: 0n, partEmployeur: 0n, accident: 0n, total: 0n };
    const jours = b.joursOuvrables - (b.joursAbsence ?? 0n);
    l.mois++;
    l.jours += jours > 0n ? jours : 0n;
    l.assiette += b.bulletin.assietteCnss;
    l.partSalarie += b.bulletin.cnssSalarie;
    l.partEmployeur += b.bulletin.cnssEmployeur;
    l.accident += b.bulletin.accidentTravail;
    l.total = l.partSalarie + l.partEmployeur + l.accident;
    par.set(b.salarie, l);
  }
  const lignes = [...par.values()];
  const s = (k: 'assiette' | 'partSalarie' | 'partEmployeur' | 'accident' | 'total') => lignes.reduce((a, l) => a + l[k], 0n);
  return {
    annee, trimestre, lignes, bulletins: dans.length,
    assiette: s('assiette'), partSalarie: s('partSalarie'), partEmployeur: s('partEmployeur'), accident: s('accident'), total: s('total'),
  };
}
