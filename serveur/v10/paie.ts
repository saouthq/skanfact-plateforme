// La paie du dossier v10, tenue par le serveur (0014, brique 31 ; docs/paie.md). La v10 saisit ses
// salariés et leurs bulletins dans son dossier ; à chaque enregistrement, une fois tout l'envoi
// écrit, le serveur :
//   - tient la fiche de chaque salarié changé (paie.salarie) ;
//   - relit chaque bulletin changé et le RECALCULE en entiers (moteur/paie.ts) avec le barème et la
//     situation du salarié que le bulletin a figés ; il refuse s'il ne trouve pas, au millime, chaque
//     montant que l'écran a calculé (deux chemins, un chiffre) ;
//   - tient le bulletin au même état (paie.bulletin), chaque geste avec sa trace.
// Un seul refus, et rien de l'envoi n'est écrit (la transaction de l'enregistrement).

import { versTexte } from '../../moteur/argent.ts';
import { calculerBulletin, type BaremePaie, type Bulletin } from '../../moteur/paie.ts';
import { t } from '../../textes/index.ts';
import { requetes, type Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import '../paie/textes.ts';
import { tracer } from '../trace.ts';
import { aVraimentChange, canonique, estJour, estObjet, exact, nombreEnTexte, objetDuDossier, texteOuNul, type ChangementLu, type Json } from './lecture.ts';
import './textes.ts';

const TAUX_MAX = 1_000_000n;          // un taux à quatre décimales : 100 % = 1 000 000
// Un montant plus grand ne tiendrait plus exactement dans un nombre JSON (la base garde le barème en JSON).
const MONTANT_MAX = 10n ** 15n;

// Chaque montant du bulletin : son nom au moteur, et celui que la v10 lui donne (`computePayslip`).
export const MONTANTS: [keyof Bulletin, string][] = [
  ['brutDeBase', 'baseGross'], ['retenueAbsence', 'absenceCut'], ['primesImposables', 'taxableBonus'], ['primesNonImposables', 'freeBonus'],
  ['brut', 'gross'], ['assietteCnss', 'cnssBase'], ['cnssSalarie', 'cnssEmployee'], ['apresCnss', 'afterCnss'], ['fraisPro', 'pro'],
  ['deductionsFamille', 'family'], ['imposableAnnuel', 'annualTaxable'], ['irppAnnuel', 'irppYear'], ['irpp', 'irpp'], ['css', 'css'],
  ['autresRetenues', 'otherDeductions'], ['net', 'net'], ['cnssEmployeur', 'cnssEmployer'], ['accidentTravail', 'accident'],
  ['tfp', 'tfp'], ['foprolos', 'foprolos'], ['chargesPatronales', 'employerCharges'], ['coutEmployeur', 'employerCost'],
];

// ── Les salariés ─────────────────────────────────────────────────────────────────────────────────
// La fiche du serveur suit celle du dossier, sans la CIN ni le RIB (ils restent dans le dossier). Un
// salarié retiré du dossier garde sa fiche : ses bulletins la nomment.
async function ficheSalarie(tx: Transaction, entreprise: string, utilisateur: string, ref: string, e: Json): Promise<{ id: string; nom: string }> {
  const db = requetes(tx);
  const nom = String(e.name ?? '').trim().slice(0, 300) || '—';
  const enfants = exact(e.children ?? 0, 0);
  if (enfants === null || enfants < 0n || enfants > 99n) throw new Refus('v10.salarie_enfants', { valeurs: { salarie: nom } });
  const jour = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
  const entree = jour(e.hireDate), sortie = jour(e.endDate);
  if ((entree !== null && !estJour(entree)) || (sortie !== null && !estJour(sortie))) throw new Refus('v10.salarie_date', { valeurs: { salarie: nom } });
  const fiche = {
    nom, numero_cnss: texteOuNul(e.cnss, 40), poste: texteOuNul(e.position, 200), contrat: texteOuNul(e.contract, 40),
    chef_de_famille: e.headOfFamily === true, enfants: Number(enfants), date_entree: entree as string | null, date_sortie: sortie as string | null,
  };
  const deja = await db.selectFrom('paie.salarie').select(['id', 'nom', 'numero_cnss', 'poste', 'contrat', 'chef_de_famille', 'enfants', 'date_entree', 'date_sortie', 'revision'])
    .where('entreprise', '=', entreprise).where('ref_v10', '=', ref).executeTakeFirst();
  if (!deja) {
    const id = (await db.insertInto('paie.salarie').values({ entreprise, ref_v10: ref, ...fiche, cree_par: utilisateur }).returning('id').executeTakeFirstOrThrow()).id;
    await tracer(tx, entreprise, 'paie.salarie.enregistrer', { type: 'salarie', id }, null, { nom, contrat: fiche.contrat });
    return { id, nom };
  }
  // Seul un changement de ce que la fiche garde la touche (la v10 réécrit le salarié pour un RIB, une note…).
  const { id, revision, ...avant } = deja;
  if (canonique(avant) !== canonique(fiche)) {
    await db.updateTable('paie.salarie').set({ ...fiche, modifie_le: new Date(), revision: revision + 1n }).where('id', '=', id).execute();
    await tracer(tx, entreprise, 'paie.salarie.modifier', { type: 'salarie', id }, avant, fiche);
  }
  return { id, nom };
}

// ── Lire un bulletin de la v10 ───────────────────────────────────────────────────────────────────
// Le barème figé avec le calcul (adaptation de `computePayslip`, web/v10/adaptations.mjs), en entiers :
// les taux de la v10 sont en pour cent (9,18 → 91 800 millionièmes), les montants en dinars.
function lireBareme(b: Json): BaremePaie | null {
  const taux = (v: unknown) => { const x = exact(v ?? 0, 4); return x !== null && x >= 0n && x <= TAUX_MAX ? x : null; };
  const montant = (v: unknown) => { const x = exact(v ?? 0, 3); return x !== null && x >= 0n && x <= MONTANT_MAX ? x : null; };
  const tranches = Array.isArray(b.brackets)
    ? b.brackets.map((x) => (estObjet(x) ? { jusqua: x.upTo === null ? null : montant(x.upTo), taux: taux(x.rate), infinie: x.upTo === null } : null))
    : [];
  const enfantsMax = exact(b.maxChildren ?? 0, 0);
  const lu = {
    cnssSalarie: taux(b.cnssEmployee), cnssEmployeur: taux(b.cnssEmployer), accidentTravail: taux(b.accidentRate),
    tfp: taux(b.tfpRate), foprolos: taux(b.foprolosRate), solidarite: taux(b.solidarity), fraisPro: taux(b.proRate),
    plafondFraisPro: montant(b.proCap), chefDeFamille: montant(b.headOfFamily), parEnfant: montant(b.perChild),
  };
  if (Object.values(lu).some((x) => x === null) || enfantsMax === null || enfantsMax < 0n || enfantsMax > 99n) return null;
  if (tranches.some((x) => x === null || x.taux === null || (!x.infinie && x.jusqua === null))) return null;
  return {
    ...(lu as { [k in keyof typeof lu]: bigint }), enfantsMax: Number(enfantsMax),
    tranches: tranches.map((x) => ({ jusqua: x?.jusqua ?? null, taux: x?.taux ?? 0n })),
    ...(b.sansIrpp === true ? { sansIrpp: true } : {}),
  };
}

// Le barème tel que la base le garde : des entiers JSON (jamais un nombre à virgule).
export const baremeEnJson = (b: BaremePaie) => JSON.stringify(b, (_cle, x: unknown) => (typeof x === 'bigint' ? Number(x) : x));

type Element = { libelle: string; montant: bigint };
type BulletinLu = {
  salarie: { id: string; nom: string }; annee: number; mois: number;
  saisie: { brutDeBase: bigint; joursOuvrables: bigint; joursAbsence: bigint; primes: (Element & { imposable: boolean })[]; retenues: Element[] };
  situation: { contrat: string | null; chefDeFamille: boolean; enfants: number };
  bareme: BaremePaie;
  calcul: Bulletin;
  paye: { le: string | null; mode: string | null; compte: string | null; reference: string | null };
};

async function lireBulletin(tx: Transaction, entreprise: string, utilisateur: string, p: Json): Promise<BulletinLu> {
  const db = requetes(tx);
  const annee = Number(p.year), mois = Number(p.month);
  const periode = `${String(p.month ?? '?').padStart(2, '0')}/${String(p.year ?? '?')}`;
  // Le salarié : sa fiche au serveur, créée depuis le dossier s'il n'en a pas encore.
  const ref = typeof p.employeeId === 'string' ? p.employeeId : '';
  let salarie = ref === '' ? undefined : await db.selectFrom('paie.salarie').select(['id', 'nom']).where('entreprise', '=', entreprise).where('ref_v10', '=', ref).executeTakeFirst();
  if (!salarie) {
    const e = ref === '' ? null : await objetDuDossier(tx, entreprise, 'employees', ref);
    if (!e) throw new Refus('v10.bulletin_salarie', { valeurs: { periode } });
    salarie = await ficheSalarie(tx, entreprise, utilisateur, ref, e);
  }
  const nom = salarie.nom;
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2200 || !Number.isInteger(mois) || mois < 1 || mois > 12) throw new Refus('v10.bulletin_periode', { valeurs: { salarie: nom } });

  const c = estObjet(p.computed) ? p.computed : {};
  const fige = c.bareme, sit = c.situation;
  if (!estObjet(fige) || !estObjet(sit)) throw new Refus('v10.bulletin_sans_bareme', { valeurs: { salarie: nom, periode } });
  const bareme = lireBareme(fige);
  if (!bareme) throw new Refus('v10.bulletin_bareme', { valeurs: { salarie: nom, periode } });

  // La saisie telle que le calcul l'a prise (arrondie au millime par la v10).
  const elements = (liste: unknown) => (Array.isArray(liste) ? liste : []).map((x) => {
    const o = estObjet(x) ? x : {};
    const montant = exact(o.amount ?? 0, 3);
    return { libelle: String(o.label ?? '').slice(0, 200), montant: montant !== null && montant >= 0n && montant <= MONTANT_MAX ? montant : null, imposable: o.taxable !== false };
  });
  const primes = elements(c.bonuses), retenues = elements(c.deductions);
  const brutDeBase = exact(c.baseGross ?? 0, 3), joursOuvrables = exact(c.workedDays ?? 0, 3), joursAbsence = exact(c.absentDays ?? 0, 3);
  if (brutDeBase === null || brutDeBase > MONTANT_MAX || joursOuvrables === null || joursOuvrables <= 0n || joursAbsence === null || joursAbsence < 0n
    || [...primes, ...retenues].some((x) => x.montant === null)) {
    throw new Refus('v10.bulletin_saisie', { valeurs: { salarie: nom, periode } });
  }
  const enfants = exact(sit.children ?? 0, 0);
  if (enfants === null || enfants < 0n || enfants > 99n) throw new Refus('v10.bulletin_situation', { valeurs: { salarie: nom, periode } });
  const situation = { contrat: texteOuNul(c.contrat, 40), chefDeFamille: sit.headOfFamily === true, enfants: Number(enfants) };
  const saisie = {
    brutDeBase, joursOuvrables, joursAbsence,
    primes: primes.map((x) => ({ libelle: x.libelle, montant: x.montant ?? 0n, imposable: x.imposable })),
    retenues: retenues.map((x) => ({ libelle: x.libelle, montant: x.montant ?? 0n })),
  };

  // Deux chemins, un chiffre : le moteur du serveur recalcule, chaque montant doit tomber juste.
  const calcul = calculerBulletin(
    { chefDeFamille: situation.chefDeFamille, enfants: situation.enfants },
    { brut: brutDeBase, joursOuvrables, joursAbsence, primes: saisie.primes, retenues: saisie.retenues.map((x) => x.montant) },
    bareme,
  );
  for (const [n, a] of MONTANTS) {
    const ecran = exact(c[a] ?? 0, 3);
    if (ecran !== calcul[n]) {
      throw new Refus('v10.bulletin_ecart', { valeurs: { salarie: nom, periode, montant: t(`paie.montant.${n}`), ecran: nombreEnTexte(c[a]), serveur: versTexte(calcul[n] as bigint, 3) } });
    }
  }
  // Ce que le formulaire de la v10 refuse (10.10.0), le serveur le refuse aussi, quel que soit le chemin.
  if (calcul.brut <= 0n) throw new Refus('v10.bulletin_brut', { valeurs: { salarie: nom, periode } });
  if (calcul.net < 0n) throw new Refus('v10.bulletin_net', { valeurs: { salarie: nom, periode } });

  const payeLe = p.paidDate === undefined || p.paidDate === null || p.paidDate === '' ? null : p.paidDate;
  if (payeLe !== null && !estJour(payeLe)) throw new Refus('v10.bulletin_paye_le', { valeurs: { salarie: nom, periode } });
  return {
    salarie, annee, mois, saisie, situation, bareme, calcul,
    paye: { le: payeLe, mode: texteOuNul(p.method, 40), compte: texteOuNul(p.accountId, 200), reference: texteOuNul(p.reference, 200) },
  };
}

// ── Tenir un bulletin au serveur ─────────────────────────────────────────────────────────────────
async function tenirBulletin(tx: Transaction, entreprise: string, utilisateur: string, cle: string, p: Json): Promise<void> {
  const db = requetes(tx);
  const b = await lireBulletin(tx, entreprise, utilisateur, p);
  const k = b.calcul;
  const champs = {
    salarie: b.salarie.id, annee: b.annee, mois: b.mois,
    brut_de_base: b.saisie.brutDeBase, jours_ouvrables: b.saisie.joursOuvrables, jours_absence: b.saisie.joursAbsence,
    primes: JSON.stringify(b.saisie.primes.map((x) => ({ libelle: x.libelle, montant: Number(x.montant), imposable: x.imposable }))),
    retenues: JSON.stringify(b.saisie.retenues.map((x) => ({ libelle: x.libelle, montant: Number(x.montant) }))),
    contrat: b.situation.contrat, chef_de_famille: b.situation.chefDeFamille, enfants: b.situation.enfants, bareme: baremeEnJson(b.bareme),
    retenue_absence: k.retenueAbsence, primes_imposables: k.primesImposables, primes_non_imposables: k.primesNonImposables,
    brut: k.brut, assiette_cnss: k.assietteCnss, cnss_salarie: k.cnssSalarie, frais_pro: k.fraisPro, deductions_famille: k.deductionsFamille,
    imposable_annuel: k.imposableAnnuel, irpp_annuel: k.irppAnnuel, irpp: k.irpp, css: k.css, autres_retenues: k.autresRetenues, net: k.net,
    cnss_employeur: k.cnssEmployeur, accident_travail: k.accidentTravail, tfp: k.tfp, foprolos: k.foprolos,
    charges_patronales: k.chargesPatronales, cout_employeur: k.coutEmployeur,
    paye_le: b.paye.le, mode: b.paye.mode, compte: b.paye.compte, reference: b.paye.reference,
  };
  const pourTrace = { annee: b.annee, mois: b.mois, net: k.net, coutEmployeur: k.coutEmployeur, payeLe: b.paye.le };
  const deja = await db.selectFrom('paie.bulletin').select(['id', 'revision', 'annee', 'mois', 'net', 'cout_employeur', 'paye_le'])
    .where('entreprise', '=', entreprise).where('ref_v10', '=', cle).executeTakeFirst();
  if (deja) {
    await db.updateTable('paie.bulletin').set({ ...champs, modifie_par: utilisateur, modifie_le: new Date(), revision: deja.revision + 1n }).where('id', '=', deja.id).execute();
    await tracer(tx, entreprise, 'paie.bulletin.modifier', { type: 'bulletin', id: deja.id },
      { annee: deja.annee, mois: deja.mois, net: deja.net, coutEmployeur: deja.cout_employeur, payeLe: deja.paye_le, revision: deja.revision }, pourTrace);
  } else {
    const id = (await db.insertInto('paie.bulletin').values({ entreprise, ref_v10: cle, ...champs, cree_par: utilisateur }).returning('id').executeTakeFirstOrThrow()).id;
    await tracer(tx, entreprise, 'paie.bulletin.etablir', { type: 'bulletin', id }, null, pourTrace);
  }
}

export async function suivrePaie(tx: Transaction, entreprise: string, utilisateur: string, changements: ChangementLu[]): Promise<void> {
  const salaries = changements.filter((c) => c.collection === 'employees' && estObjet(c.apres) && aVraimentChange(c));
  const bulletins = changements.filter((c) => c.collection === 'payslips' && aVraimentChange(c));
  if (!salaries.length && !bulletins.length) return;
  const db = requetes(tx);

  // 1. Les fiches des salariés changés (avant leurs bulletins : un bulletin et son salarié arrivent souvent ensemble).
  for (const c of salaries) await ficheSalarie(tx, entreprise, utilisateur, c.cle, c.apres as Json);

  // 2. Chaque bulletin changé, recalculé et tenu.
  for (const c of bulletins) if (estObjet(c.apres)) await tenirBulletin(tx, entreprise, utilisateur, c.cle, c.apres);

  // 3. Les bulletins retirés (la v10 le permet, en prévenant : « mieux vaut le corriger »), chacun avec sa trace.
  for (const c of bulletins) {
    if (c.apres !== null) continue;
    const b = await db.selectFrom('paie.bulletin').select(['id', 'annee', 'mois', 'net', 'cout_employeur', 'paye_le']).where('entreprise', '=', entreprise).where('ref_v10', '=', c.cle).executeTakeFirst();
    if (!b) continue;
    await db.deleteFrom('paie.bulletin').where('id', '=', b.id).execute();
    await tracer(tx, entreprise, 'paie.bulletin.supprimer', { type: 'bulletin', id: b.id }, { annee: b.annee, mois: b.mois, net: b.net, coutEmployeur: b.cout_employeur, payeLe: b.paye_le }, null);
  }
}
