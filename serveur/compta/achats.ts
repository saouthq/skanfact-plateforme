// Les écritures des achats, tenues par le serveur (brique 33 ; docs/ecritures.md). L'unité qui se
// réécrit est la FAMILLE d'un achat : la facture (ou la dépense), les avoirs et acomptes qui y sont
// rattachés, et tous leurs règlements ; un avoir ou un acompte libre est sa propre famille (D2).
// Chaque enregistrement qui touche l'un d'eux réécrit tout le brouillard de la famille, dans la même
// transaction, par le moteur (moteur/achats.ts : comparé à la v10 depuis l'étape 1). Les montants
// sont recalculés depuis la pièce tenue (achats.piece, achats.ligne), en dinars au cours de la pièce.

import { TND, type Devise } from '../../moteur/argent.ts';
import {
  calculerAchat, ecritureDAchat, ecritureDeReglementFournisseur, ecritureDImputationAcompte, imputationAchat,
  type Achat, type ComptesAchat, type Destination, type NatureAchat, type TotauxAchat,
} from '../../moteur/achats.ts';
import type { LigneEcriture } from '../../moteur/ecritures.ts';
import { retenueAuFil, type PieceLiee, type Reglement, type RetenueAuFil } from '../../moteur/reglements.ts';
import { requetes, type Transaction } from '../base.ts';
import { ecrireFamille, libelle, type EcritureAEcrire, type LigneAEcrire } from './ecrire.ts';
import { compteFournisseur, journalDeCompte, lirePlan, type PlanDuDossier } from './plan.ts';

type Membre = {
  id: string; nature: NatureAchat; fournisseur: string | null; numero: string | null; date: string; nom: string;
  achat: Achat; totaux: TotauxAchat; reglements: { id: string; date: string; montant: bigint; cours: bigint | null; mode: string; compte: string | null; rang: number }[];
};

const regles = (m: Membre): Reglement[] => m.reglements.map((r) => ({ cle: r.id, date: r.date, montant: r.montant, cours: r.cours ?? undefined }));

// Les pièces d'une famille, recalculées par le moteur : la racine d'abord, puis ses rattachées.
async function lireMembres(tx: Transaction, entreprise: string, racine: string): Promise<Membre[]> {
  const db = requetes(tx);
  const pieces = await db.selectFrom('achats.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .leftJoin('socle.tiers as t', 't.id', 'p.fournisseur')
    .select(['p.id', 'p.nature', 'p.lie', 'p.fournisseur', 'p.numero_fournisseur', 'p.date_piece', 'p.devise', 'd.decimales', 'p.cours',
      'p.frais', 'p.taux_retenue', 'p.tva_recuperable', 't.raison_sociale'])
    .where('p.entreprise', '=', entreprise).where((eb) => eb.or([eb('p.id', '=', racine), eb('p.lie', '=', racine)]))
    .orderBy('p.date_piece').orderBy('p.id').execute();
  const tete = pieces.find((p) => p.id === racine);
  if (!tete || tete.lie !== null) return [];
  const ids = pieces.map((p) => p.id);
  const lignes = await db.selectFrom('achats.ligne').select(['piece', 'quantite', 'prix_unitaire', 'taux_tva', 'destination', 'non_deductible'])
    .where('piece', 'in', ids).orderBy('piece').orderBy('rang').execute();
  const reglements = await db.selectFrom('achats.reglement').select(['id', 'piece', 'date_reglement', 'montant', 'cours', 'mode', 'compte', 'rang'])
    .where('entreprise', '=', entreprise).where('piece', 'in', ids).orderBy('rang').execute();
  const membres = pieces.map((p): Membre => {
    const devise: Devise = { code: p.devise, decimales: p.decimales };
    const achat: Achat = {
      nature: p.nature as NatureAchat, devise, cours: p.cours ?? undefined, frais: p.frais, tauxRetenue: p.taux_retenue, tvaRecuperable: p.tva_recuperable,
      lignes: lignes.filter((l) => l.piece === p.id).map((l) => ({
        quantite: l.quantite, prixUnitaire: l.prix_unitaire, tauxTva: l.taux_tva, destination: l.destination as Destination, nonDeductible: l.non_deductible,
      })),
    };
    return {
      id: p.id, nature: achat.nature, fournisseur: p.fournisseur, numero: p.numero_fournisseur, date: p.date_piece, nom: p.raison_sociale ?? '—',
      achat, totaux: calculerAchat(achat, TND),
      reglements: reglements.filter((r) => r.piece === p.id).map((r) => ({ id: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours, mode: r.mode, compte: r.compte, rang: r.rang })),
    };
  });
  return [membres.find((m) => m.id === racine) as Membre, ...membres.filter((m) => m.id !== racine)];
}

const ENTREE: Record<NatureAchat, string> = {
  facture: 'compta.libelle.achat.facture', depense: 'compta.libelle.achat.depense', avoir: 'compta.libelle.achat.avoir', acompte: 'compta.libelle.achat.acompte',
};

// Les lignes du moteur, avec leurs libellés.
function lignesDAchat(lignes: LigneEcriture[], l: { entree: string; numero: string; regularisation: string }): LigneAEcrire[] {
  let apresRetenue = false;
  return lignes.map((x) => {
    let texte = l.entree;
    if (x.nature === 'frais') texte = libelle('compta.libelle.frais', { numero: l.numero });
    else if (x.nature === 'tva') texte = libelle('compta.libelle.tva_deductible', { numero: l.numero });
    else if (x.nature === 'change') texte = libelle('compta.libelle.change', { numero: l.numero });
    else if (x.nature === 'retenue' || (x.nature === 'fournisseur' && apresRetenue)) texte = l.regularisation;
    apresRetenue = x.nature === 'retenue';
    return { compte: x.compte, libelle: texte, debit: x.debit, credit: x.credit, tauxTva: null };
  });
}

function lignesDeReglement(lignes: LigneEcriture[], entree: string, numero: string): LigneAEcrire[] {
  return lignes.map((x) => {
    let texte = entree;
    if (x.nature === 'retenue') texte = libelle('compta.libelle.retenue_operee', { numero });
    else if (x.nature === 'change') texte = libelle(x.debit > 0n ? 'compta.libelle.perte_change' : 'compta.libelle.gain_change', { libelle: entree });
    return { compte: x.compte, libelle: texte, debit: x.debit, credit: x.credit, tauxTva: null };
  });
}

// Les écritures d'une famille, sans rien écrire (ce que le test confronte à la v10). Vide quand
// `racine` n'est plus la tête d'une famille (retirée, ou rattachée à une facture).
export async function ecrituresDeLaFamilleDAchat(tx: Transaction, entreprise: string, racine: string, plan: PlanDuDossier): Promise<EcritureAEcrire[]> {
  const membres = await lireMembres(tx, entreprise, racine);
  const tete = membres[0];
  if (!tete) return [];
  const P = plan.plan;
  const comptes = (m: Membre): ComptesAchat => ({
    fournisseurs: compteFournisseur(plan, m.fournisseur), charges: P.charges, achatsStock: P.achatsStock, immobilisations: P.immobilisations,
    fraisAccessoires: P.fraisAccessoires, tvaDeductible: P.tvaDeductible, avancesFournisseurs: P.avancesFournisseurs,
    gainsChange: P.gainsChange, pertesChange: P.pertesChange, retenueOperee: P.rsOperee,
  });
  const numeroDe = (m: Membre) => m.numero ?? libelle('compta.libelle.sans_numero', {});
  const entreeDe = (m: Membre) => libelle(ENTREE[m.nature], { numero: numeroDe(m), fournisseur: m.nom });
  const rattachees = membres.slice(1);

  // La retenue au fil (10.14.0) : sur la tête, ce que ses pièces rattachées couvrent (un acompte dès
  // l'origine, un avoir à SA date) ; chaque pièce rattachée a aussi ses propres règlements.
  const t = tete.totaux;
  const liees: PieceLiee[] = rattachees.map((m) => {
    const im = imputationAchat(m.totaux, m.nature, regles(m));
    return { cle: m.id, date: m.nature === 'acompte' ? '' : m.date, net: im.net, brut: im.brut };
  });
  const fils = new Map<string, RetenueAuFil>([[tete.id, retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, liees, regles(tete))]]);
  for (const m of rattachees) fils.set(m.id, retenueAuFil(m.totaux.netAPayer, m.totaux.netAPayer + m.totaux.retenue, [], regles(m)));
  const filTete = fils.get(tete.id) as RetenueAuFil;

  // Chaque écriture avec sa date et son ordre dans la famille : les pièces, l'imputation des
  // acomptes (à la date de la facture), puis les règlements.
  const datees: { date: string; ordre: number; e: EcritureAEcrire }[] = [];
  let ordre = 0;
  for (const m of membres) {
    const numero = numeroDe(m), entree = entreeDe(m);
    const rattachement = m.nature === 'avoir' && m !== tete
      ? { facture: tete.achat, brutImpute: imputationAchat(m.totaux, 'avoir', regles(m)).brut, regularisationRetenue: filTete.ajustements.get(m.id) ?? 0n }
      : undefined;
    const e = ecritureDAchat(m.totaux, m.achat, TND, comptes(m), rattachement);
    const regularisation = libelle('compta.libelle.regularisation', { facture: numeroDe(tete), numero });
    datees.push({ date: m.date, ordre: ordre++, e: {
      journal: 'AC', date: m.date, origineType: 'achat', origine: m.id, piece: m.numero, tiers: m.fournisseur, libelle: entree,
      lignes: lignesDAchat(e.lignes, { entree, numero, regularisation }),
    } });
  }
  if (tete.nature === 'facture' || tete.nature === 'depense') {
    for (const a of rattachees.filter((m) => m.nature === 'acompte')) {
      const entree = libelle('compta.libelle.imputation', { acompte: numeroDe(a), numero: numeroDe(tete) });
      const e = ecritureDImputationAcompte(a.totaux, a.achat, tete.achat, TND, comptes(tete));
      datees.push({ date: tete.date, ordre: ordre++, e: {
        journal: 'OD', date: tete.date, origineType: 'imputation', origine: a.id, piece: tete.numero, tiers: tete.fournisseur, libelle: entree,
        lignes: e.lignes.map((x) => ({
          compte: x.compte, debit: x.debit, credit: x.credit, tauxTva: null,
          libelle: x.nature === 'change' ? libelle('compta.libelle.change', { numero: numeroDe(a) }) : entree,
        })),
      } });
    }
  }
  for (const m of membres) {
    const fil = fils.get(m.id) as RetenueAuFil;
    const numero = numeroDe(m);
    // À date égale, dans l'ordre où ils ont été saisis.
    for (const r of [...m.reglements].sort((x, y) => x.rang - y.rang)) {
      const j = journalDeCompte(plan, r.compte, r.mode);
      // Un règlement porté par un avoir est un remboursement : l'argent entre.
      const cle = m.nature === 'avoir' || r.montant < 0n ? 'compta.libelle.remboursement_fournisseur' : 'compta.libelle.reglement_fournisseur';
      const entree = libelle(cle, { numero, fournisseur: m.nom });
      const e = ecritureDeReglementFournisseur({ devise: m.achat.devise, cours: m.achat.cours, nature: m.nature },
        { cle: r.id, date: r.date, montant: r.montant, cours: r.cours ?? undefined }, fil.parts.get(r.id) ?? 0n, TND,
        { fournisseurs: compteFournisseur(plan, m.fournisseur), tresorerie: j.compte, retenueOperee: P.rsOperee, gainsChange: P.gainsChange, pertesChange: P.pertesChange });
      datees.push({ date: r.date, ordre: ordre++, e: {
        journal: j.journal, date: r.date, origineType: 'reglement_fournisseur', origine: r.id, piece: m.numero, tiers: m.fournisseur, libelle: entree,
        lignes: lignesDeReglement(e.lignes, entree, numero),
      } });
    }
  }
  // Une pièce dont tous les montants sont nuls n'écrit rien (comme la v10 : une ligne nulle ne s'écrit pas).
  return datees.filter((x) => x.e.lignes.length > 0)
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.ordre - y.ordre)).map((x) => x.e);
}

// Réécrit le brouillard d'une famille d'achat (compta.ecrire_famille : le seul chemin d'écriture).
export async function ecrireFamilleDAchat(tx: Transaction, entreprise: string, racine: string, plan?: PlanDuDossier): Promise<void> {
  await ecrireFamille(tx, entreprise, racine, await ecrituresDeLaFamilleDAchat(tx, entreprise, racine, plan ?? await lirePlan(tx, entreprise)));
}

// Les familles que touche un changement d'achats : celle de chaque pièce avant, et après. Une
// famille qui n'a plus de tête (pièce retirée, ou rattachée ailleurs) se vide d'abord ; puis chaque
// famille qui a encore sa tête se réécrit (une écriture ne peut vivre que dans UNE famille).
export async function reecrireFamillesDAchat(tx: Transaction, entreprise: string, familles: Iterable<string>): Promise<void> {
  const liste = [...new Set(familles)];
  if (!liste.length) return;
  const tetes = new Set((await requetes(tx).selectFrom('achats.piece').select('id').where('entreprise', '=', entreprise)
    .where('id', 'in', liste).where('lie', 'is', null).execute()).map((p) => p.id));
  for (const f of liste) await ecrireFamille(tx, entreprise, f, []);
  const plan = await lirePlan(tx, entreprise);
  for (const f of liste) if (tetes.has(f)) await ecrireFamilleDAchat(tx, entreprise, f, plan);
}

// La famille de chaque pièce nommée (par son identifiant v10) : la facture à laquelle elle est
// rattachée, sinon elle-même.
export async function famillesDesAchats(tx: Transaction, entreprise: string, refs: string[]): Promise<string[]> {
  if (!refs.length) return [];
  return (await requetes(tx).selectFrom('achats.piece').select(['id', 'lie']).where('entreprise', '=', entreprise).where('ref_v10', 'in', refs).execute())
    .map((p) => p.lie ?? p.id);
}

// Tout le brouillard des achats de l'entreprise, réécrit (le plan a changé : D3).
export async function reecrireLesAchats(tx: Transaction, entreprise: string): Promise<number> {
  const plan = await lirePlan(tx, entreprise);
  const tetes = await requetes(tx).selectFrom('achats.piece').select('id').where('entreprise', '=', entreprise)
    .where('lie', 'is', null).orderBy('date_piece').orderBy('id').execute();
  for (const p of tetes) await ecrireFamilleDAchat(tx, entreprise, p.id, plan);
  return tetes.length;
}
