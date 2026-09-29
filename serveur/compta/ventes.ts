// Les écritures des ventes, tenues par le serveur (brique 32 ; docs/ecritures.md). L'unité qui se
// réécrit est la FAMILLE d'une facture émise : la facture, ses avoirs, et tous leurs règlements (D2).
// Chaque geste sur l'un d'eux réécrit tout le brouillard de la famille, dans la même transaction, par
// le moteur (moteur/ecritures.ts, moteur/reglements.ts : comparés à la v10 depuis l'étape 1). Les
// montants viennent de la pièce SCELLÉE : une pièce émise ne se recalcule pas.

import { TND, versTexte, type Devise } from '../../moteur/argent.ts';
import { ecritureDeVente, type LigneEcriture } from '../../moteur/ecritures.ts';
import { ecritureDEncaissement, retenueAuFil, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { requetes, type Transaction } from '../base.ts';
import { lirePieceBrute, type PieceLue } from '../ventes/pieces.ts';
import { ecrireFamille, libelle, type EcritureAEcrire, type LigneAEcrire } from './ecrire.ts';
import { compteClient, journalDeCompte, lirePlan, type PlanDuDossier } from './plan.ts';
// Un taux à six décimales (19 % = 190 000), dit comme la v10 l'écrit : « 19 », « 13,5 ».
const tauxEnTexte = (taux: bigint) => versTexte(taux, 4).replace(/\.?0+$/, '');

// Les totaux scellés d'une pièce émise : ce que son écriture reprend.
function totauxScelles(p: PieceLue) {
  const tvaParTaux = new Map<bigint, { base: bigint; tva: bigint }>();
  for (const [taux, v] of Object.entries(p.tva_par_taux ?? {})) tvaParTaux.set(BigInt(taux), { base: BigInt(v.base), tva: BigInt(v.tva) });
  return { tvaParTaux, timbreBase: p.totaux?.timbre_base ?? 0n, totalTTC: p.totaux?.total_ttc ?? 0n };
}

const nomDuClient = (p: PieceLue) => {
  const c = (p.copie as { client?: { raisonSociale?: string } } | null)?.client;
  return typeof c?.raisonSociale === 'string' ? c.raisonSociale : '';
};

// Les lignes du moteur, avec leurs libellés.
function lignesDeVente(lignes: LigneEcriture[], l: { entree: string; numero: string; regularisation: string }): LigneAEcrire[] {
  let apresRetenue = false;
  return lignes.map((x) => {
    let texte = l.entree;
    if (x.nature === 'ventes') texte = libelle('compta.libelle.ventes', { libelle: l.entree, taux: tauxEnTexte(x.tauxTva ?? 0n) });
    else if (x.nature === 'tva') texte = libelle('compta.libelle.tva', { taux: tauxEnTexte(x.tauxTva ?? 0n), numero: l.numero });
    else if (x.nature === 'timbre') texte = libelle('compta.libelle.timbre', { numero: l.numero });
    else if (x.nature === 'change') texte = libelle('compta.libelle.change', { numero: l.numero });
    else if (x.nature === 'retenue' || (x.nature === 'client' && apresRetenue)) texte = l.regularisation;
    apresRetenue = x.nature === 'retenue';
    return { compte: x.compte, libelle: texte, debit: x.debit, credit: x.credit, tauxTva: x.nature === 'ventes' || x.nature === 'tva' ? (x.tauxTva ?? null) : null };
  });
}

function lignesDEncaissement(lignes: LigneEcriture[], entree: string, numero: string): LigneAEcrire[] {
  return lignes.map((x) => {
    let texte = entree;
    if (x.nature === 'retenue') texte = libelle('compta.libelle.retenue_subie', { numero });
    else if (x.nature === 'change') texte = libelle(x.credit > 0n ? 'compta.libelle.gain_change' : 'compta.libelle.perte_change', { libelle: entree });
    return { compte: x.compte, libelle: texte, debit: x.debit, credit: x.credit, tauxTva: null };
  });
}

// Les écritures d'une famille, sans rien écrire (ce que le test confronte à la v10).
export async function ecrituresDeLaFamille(tx: Transaction, entreprise: string, facture: string, plan: PlanDuDossier): Promise<EcritureAEcrire[]> {
  const db = requetes(tx);
  const f = await lirePieceBrute(tx, entreprise, facture);
  if (f.type !== 'facture' || f.statut !== 'emise' || !f.totaux) return [];
  const devises = new Map((await db.selectFrom('socle.devise').select(['code', 'decimales']).execute()).map((d) => [d.code, d]));
  const deviseDe = (code: string): Devise => devises.get(code) ?? { code, decimales: 3 };
  const enDevise = (p: PieceLue) => ({ devise: deviseDe(p.devise), cours: p.cours ?? undefined });
  const client = compteClient(plan, f.tiers);
  const comptesVente = {
    clients: client, ventes: plan.plan.ventes, tvaCollectee: plan.plan.tvaCollectee, timbre: plan.plan.timbre,
    gainsChange: plan.plan.gainsChange, pertesChange: plan.plan.pertesChange, retenueSubie: plan.plan.rsSubie,
  };
  const numeroF = f.numero_texte ?? '';
  const nomF = nomDuClient(f);

  const avoirs: PieceLue[] = [];
  for (const a of await db.selectFrom('ventes.piece').select('id').where('entreprise', '=', entreprise).where('corrige', '=', facture)
    .where('statut', '=', 'emise').orderBy('date_piece').orderBy('id').execute()) avoirs.push(await lirePieceBrute(tx, entreprise, a.id));
  const reglements = await db.selectFrom('ventes.reglement').selectAll().where('entreprise', '=', entreprise).where('piece', '=', facture).orderBy('rang').execute();

  // La retenue au fil (10.14.0) : la part de chaque règlement, et la régularisation de chaque avoir.
  const net = f.totaux.net_a_payer ?? 0n, retenue = f.totaux.retenue ?? 0n;
  const liees: PieceLiee[] = avoirs.map((a) => ({ cle: a.id, date: a.date_piece, net: a.totaux?.net_a_payer ?? 0n, brut: (a.totaux?.net_a_payer ?? 0n) + (a.totaux?.retenue ?? 0n) }));
  const regles: Reglement[] = reglements.map((r) => ({ cle: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours ?? undefined }));
  const fil = retenueAuFil(net, net + retenue, liees, regles);

  const ecritures: EcritureAEcrire[] = [];
  const entreeF = libelle('compta.libelle.facture', { numero: numeroF, client: nomF });
  ecritures.push({
    journal: 'VT', date: f.date_piece, origineType: 'vente', origine: f.id, piece: numeroF, tiers: f.tiers, libelle: entreeF,
    lignes: lignesDeVente(ecritureDeVente(totauxScelles(f), { type: 'facture', ...enDevise(f) }, TND, comptesVente).lignes, { entree: entreeF, numero: numeroF, regularisation: entreeF }),
  });
  for (const a of avoirs) {
    const numeroA = a.numero_texte ?? '';
    const entreeA = libelle('compta.libelle.avoir', { numero: numeroA, client: nomDuClient(a) || nomF });
    const e = ecritureDeVente(totauxScelles(a), { type: 'avoir', ...enDevise(a) }, TND, comptesVente,
      { facture: enDevise(f), regularisationRetenue: fil.ajustements.get(a.id) ?? 0n });
    ecritures.push({
      journal: 'VT', date: a.date_piece, origineType: 'vente', origine: a.id, piece: numeroA, tiers: a.tiers, libelle: entreeA,
      lignes: lignesDeVente(e.lignes, { entree: entreeA, numero: numeroA, regularisation: libelle('compta.libelle.regularisation', { facture: numeroF, numero: numeroA }) }),
    });
  }
  // Les encaissements, dans l'ordre des dates (à date égale, dans l'ordre où ils ont été saisis).
  const parDate = [...reglements].sort((x, y) => (x.date_reglement < y.date_reglement ? -1 : x.date_reglement > y.date_reglement ? 1 : x.rang - y.rang));
  for (const r of parDate) {
    const j = journalDeCompte(plan, r.compte, r.mode);
    const entree = libelle(r.montant < 0n ? 'compta.libelle.remboursement' : 'compta.libelle.reglement', { numero: numeroF, client: nomF });
    const e = ecritureDEncaissement(enDevise(f), { cle: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours ?? undefined }, fil.parts.get(r.id) ?? 0n, TND,
      { clients: client, tresorerie: j.compte, retenueSubie: plan.plan.rsSubie, gainsChange: plan.plan.gainsChange, pertesChange: plan.plan.pertesChange });
    ecritures.push({
      journal: j.journal, date: r.date_reglement, origineType: 'encaissement', origine: r.id, piece: numeroF, tiers: f.tiers, libelle: entree,
      lignes: lignesDEncaissement(e.lignes, entree, numeroF),
    });
  }
  return ecritures;
}

// Réécrit le brouillard d'une famille (compta.ecrire_famille : le seul chemin d'écriture). `plan` :
// le plan déjà lu, quand on réécrit plusieurs familles d'un coup.
export async function ecrireFamilleDeVente(tx: Transaction, entreprise: string, facture: string, plan?: PlanDuDossier): Promise<void> {
  await ecrireFamille(tx, entreprise, facture, await ecrituresDeLaFamille(tx, entreprise, facture, plan ?? await lirePlan(tx, entreprise)));
}

// Tout le brouillard des ventes de l'entreprise, réécrit (le plan a changé : D3).
export async function reecrireLesVentes(tx: Transaction, entreprise: string): Promise<number> {
  const plan = await lirePlan(tx, entreprise);
  const factures = await requetes(tx).selectFrom('ventes.piece').select('id').where('entreprise', '=', entreprise)
    .where('type', '=', 'facture').where('statut', '=', 'emise').orderBy('date_piece').orderBy('id').execute();
  for (const f of factures) await ecrireFamilleDeVente(tx, entreprise, f.id, plan);
  return factures.length;
}
