// Les pièces de vente : le brouillon (créer, modifier, supprimer), la lecture avec ses totaux, et
// l'ÉMISSION d'une facture ou d'un avoir (01 § 6, § 7, R6, R7, R9, R11) :
//   1. tous les contrôles d'abord (brouillon, lignes, client, série, règles connues à la date) ;
//   2. puis, dans la même transaction : le numéro, les totaux en entiers (moteur/piece.ts), la copie
//      figée de ce qui a servi au calcul, et le maillon dans la chaîne de la série.
// Un refus à l'étape 1 ne prend aucun numéro ; une erreur à l'étape 2 annule tout, numéro compris.

import { sql, type Selectable } from 'kysely';
import type { BaseDeDonnees } from '../../base/types.ts';
import { depuisTexte, versTexte, type Devise } from '../../moteur/argent.ts';
import { calculerPiece, timbreApplique, type Piece, type TotauxPiece, type TypePiece } from '../../moteur/piece.ts';
import { requetes, type Transaction } from '../base.ts';
import { Introuvable, Perimee, Refus } from '../erreurs.ts';
import { annoncerReglements, resteAvant } from './annonces.ts';
import { emettreAvis } from '../avis.ts';
import { sceller } from '../journal.ts';
import { prendreNumero } from '../numeros.ts';
import { regle, type RegleLue } from '../regles.ts';
import { tracer } from '../trace.ts';
import { motif } from '../../textes/index.ts';
import { etatDeFacture } from './reglements.ts';
import { ecrireFamilleDeVente } from '../compta/ventes.ts';
import './textes.ts';

// ── Ce qu'on saisit (les nombres arrivent en TEXTE, jamais en nombre à virgule) ─────────────────
export type LigneSaisie = {
  designation: string; description?: string | undefined;
  quantite: string; prixUnitaire: string; tauxTva: string; sansRemise?: boolean | undefined;
};
export type BrouillonSaisi = {
  type: TypePiece; tiers: string; datePiece: string; echeance?: string | undefined;
  devise?: string | undefined; cours?: string | undefined; tauxRemise?: string | undefined; tauxRetenue?: string | undefined;
  appliquerTimbre?: boolean | undefined; objet?: string | undefined; notes?: string | undefined;
  // La facture qu'un avoir corrige (0012) : seul un avoir en a une.
  corrige?: string | undefined;
  lignes: LigneSaisie[];
};
// Les décimales de chaque nombre saisi (01 R3).
export const DECIMALES = { quantite: 3, prix: 6, taux: 4, cours: 6 } as const;

// ── Ce qu'on lit dans la base ───────────────────────────────────────────────────────────────────
type LignePieceLue = Pick<Selectable<BaseDeDonnees['ventes.ligne']>,
  'rang' | 'designation' | 'description' | 'quantite' | 'prix_unitaire' | 'taux_tva' | 'sans_remise' | 'ht' | 'tva' | 'ttc'>;
export type PieceLue = {
  id: string; entreprise: string; type: TypePiece; statut: string; tiers: string; date_piece: string; echeance: string | null;
  corrige: string | null;
  devise: string; cours: bigint | null; taux_remise: bigint; taux_retenue: bigint; appliquer_timbre: boolean | null;
  objet: string | null; notes: string | null; serie: string | null; numero_texte: string | null; revision: number;
  totaux: Record<string, bigint> | null; tva_par_taux: Record<string, { base: string; tva: string }> | null;
  copie: unknown; empreinte: string | null;
};

const MONTANTS = ['total_ht', 'remise', 'net_ht', 'total_tva', 'timbre', 'timbre_base', 'total_ttc', 'retenue', 'net_a_payer'] as const;

async function lireLignes(tx: Transaction, piece: string): Promise<LignePieceLue[]> {
  return requetes(tx).selectFrom('ventes.ligne')
    .select(['rang', 'designation', 'description', 'quantite', 'prix_unitaire', 'taux_tva', 'sans_remise', 'ht', 'tva', 'ttc'])
    .where('piece', '=', piece).orderBy('rang').execute();
}

export async function lirePieceBrute(tx: Transaction, entreprise: string, id: string, verrou = false): Promise<PieceLue> {
  const r = await requetes(tx).selectFrom('ventes.piece').selectAll()
    .where('id', '=', id).where('entreprise', '=', entreprise)
    .$if(verrou, (q) => q.forUpdate()).executeTakeFirst();
  if (!r) throw new Introuvable();
  let totaux: Record<string, bigint> | null = null;
  if (r.statut === 'emise') {
    totaux = {};
    for (const m of MONTANTS) {
      const v = r[m];
      if (v === null) throw new Error(`facture émise sans ${m} : ${id}`);
      totaux[m] = v;
    }
  }
  return {
    id: r.id, entreprise: r.entreprise, type: r.type as TypePiece, statut: r.statut, tiers: r.tiers, date_piece: r.date_piece, echeance: r.echeance,
    corrige: r.corrige,
    devise: r.devise, cours: r.cours, taux_remise: r.taux_remise, taux_retenue: r.taux_retenue,
    appliquer_timbre: r.appliquer_timbre, objet: r.objet, notes: r.notes, serie: r.serie, numero_texte: r.numero_texte,
    revision: Number(r.revision), totaux,
    tva_par_taux: r.tva_par_taux as PieceLue['tva_par_taux'], copie: r.copie, empreinte: r.empreinte,
  };
}

async function deviseDe(tx: Transaction, code: string): Promise<Devise> {
  const r = await requetes(tx).selectFrom('socle.devise').select(['code', 'decimales']).where('code', '=', code).executeTakeFirst();
  if (!r) throw new Refus('ventes.devise_inconnue', { valeurs: { devise: code } });
  return r;
}

// ── Le brouillon ────────────────────────────────────────────────────────────────────────────────
function valeurs(b: BrouillonSaisi) {
  return {
    type: b.type, tiers: b.tiers, date_piece: b.datePiece, echeance: b.echeance ?? null, devise: b.devise ?? 'TND',
    cours: b.cours === undefined ? null : depuisTexte(b.cours, DECIMALES.cours),
    taux_remise: b.tauxRemise === undefined ? 0n : depuisTexte(b.tauxRemise, DECIMALES.taux),
    taux_retenue: b.tauxRetenue === undefined ? 0n : depuisTexte(b.tauxRetenue, DECIMALES.taux),
    appliquer_timbre: b.appliquerTimbre ?? null, objet: b.objet ?? null, notes: b.notes ?? null,
    corrige: b.corrige ?? null,
  };
}

async function ecrireLignes(tx: Transaction, entreprise: string, piece: string, lignes: LigneSaisie[]) {
  await requetes(tx).insertInto('ventes.ligne').values(lignes.map((l, i) => ({
    piece, entreprise, rang: i + 1, designation: l.designation, description: l.description ?? null,
    quantite: depuisTexte(l.quantite, DECIMALES.quantite), prix_unitaire: depuisTexte(l.prixUnitaire, DECIMALES.prix),
    taux_tva: depuisTexte(l.tauxTva, DECIMALES.taux), sans_remise: l.sansRemise ?? false,
  }))).execute();
}

export async function creerBrouillon(tx: Transaction, utilisateur: string, entreprise: string, b: BrouillonSaisi): Promise<string> {
  const { id } = await requetes(tx).insertInto('ventes.piece')
    .values({ entreprise, ...valeurs(b), cree_par: utilisateur }).returning('id').executeTakeFirstOrThrow();
  await ecrireLignes(tx, entreprise, id, b.lignes);
  await tracer(tx, entreprise, 'ventes.brouillon.creer', { type: 'piece_vente', id }, null, { type: b.type, tiers: b.tiers });
  return id;
}

export async function modifierBrouillon(tx: Transaction, entreprise: string, id: string, revisionVue: number, b: BrouillonSaisi): Promise<number> {
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('ventes.emise_ne_se_modifie_plus');
  if (p.revision !== revisionVue) throw new Perimee();
  const db = requetes(tx);
  await db.updateTable('ventes.piece')
    .set((eb) => ({ ...valeurs(b), revision: eb('revision', '+', 1n), modifie_le: sql<Date>`now()` }))
    .where('id', '=', id).where('entreprise', '=', entreprise).execute();
  await db.deleteFrom('ventes.ligne').where('piece', '=', id).execute();
  await ecrireLignes(tx, entreprise, id, b.lignes);
  await tracer(tx, entreprise, 'ventes.brouillon.modifier', { type: 'piece_vente', id }, { revision: p.revision }, { revision: p.revision + 1 });
  return p.revision + 1;
}

// Seul un brouillon se supprime, et la suppression laisse sa trace (01 R6).
export async function supprimerBrouillon(tx: Transaction, entreprise: string, id: string): Promise<void> {
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('ventes.emise_ne_s_efface_pas');
  await requetes(tx).deleteFrom('ventes.piece').where('id', '=', id).execute();
  await tracer(tx, entreprise, 'ventes.brouillon.supprimer', { type: 'piece_vente', id }, { type: p.type, tiers: p.tiers, date: p.date_piece }, null);
}

// ── Le calcul ───────────────────────────────────────────────────────────────────────────────────
// `timbreManquant` : le timbre s'applique à cette pièce mais aucune règle ne le dit à sa date.
type Calcul = { devise: Devise; totaux: TotauxPiece; timbre: RegleLue | null; timbreManquant: boolean };

// Le calcul d'un brouillon, avec les règles valables à SA date (01 R11). Le timbre inconnu à cette
// date se dit « non renseigné » : il n'est jamais inventé (R12).
async function calculer(tx: Transaction, p: PieceLue, lignes: LignePieceLue[]): Promise<Calcul> {
  const devise = await deviseDe(tx, p.devise);
  const piece: Piece = {
    type: p.type, devise, cours: p.cours ?? undefined, tauxRemise: p.taux_remise, tauxRetenue: p.taux_retenue,
    ...(p.appliquer_timbre === null ? {} : { appliquerTimbre: p.appliquer_timbre }),
    timbre: 0n,
    lignes: lignes.map((l) => ({ quantite: l.quantite, prixUnitaire: l.prix_unitaire, tauxTva: l.taux_tva, ...(l.sans_remise ? { sansRemise: true } : {}) })),
  };
  const applique = timbreApplique(piece);
  const timbre = applique ? await regle(tx, p.entreprise, 'timbre.facture', p.date_piece) : null;
  if (timbre) piece.timbre = BigInt(timbre.valeur as string | number);
  return { devise, totaux: calculerPiece(piece), timbre, timbreManquant: applique && !timbre };
}

const tvaParTauxJson = (t: TotauxPiece) => Object.fromEntries([...t.tvaParTaux.entries()].map(([taux, v]) => [taux.toString(), { base: v.base.toString(), tva: v.tva.toString() }]));

// Ce que la chaîne scelle : la pièce telle qu'émise, avec ses lignes et sa copie figée. La MÊME
// fonction sert à l'émission et au contrôle (relire), pour que les deux chemins donnent un chiffre.
export function contenuScelle(p: PieceLue, lignes: LignePieceLue[]) {
  return {
    id: p.id, entreprise: p.entreprise, type: p.type, numero: p.numero_texte, serie: p.serie,
    date: p.date_piece, echeance: p.echeance, tiers: p.tiers, devise: p.devise, cours: p.cours,
    tauxRemise: p.taux_remise, tauxRetenue: p.taux_retenue, appliquerTimbre: p.appliquer_timbre,
    lignes: lignes.map((l) => ({
      rang: l.rang, designation: l.designation, description: l.description, quantite: l.quantite, prixUnitaire: l.prix_unitaire,
      tauxTva: l.taux_tva, sansRemise: l.sans_remise, ht: l.ht, tva: l.tva, ttc: l.ttc,
    })),
    totaux: p.totaux, tvaParTaux: p.tva_par_taux, copie: p.copie,
    // La facture qu'un avoir corrige, scellée avec lui. Pour un avoir seulement : l'empreinte des
    // factures déjà émises ne change pas.
    ...(p.type === 'avoir' ? { corrige: p.corrige } : {}),
  };
}

// Pour le contrôle de la chaîne (serveur/journal.ts, `controler`) : la pièce relue telle qu'elle est.
export async function relirePourChaine(tx: Transaction, entreprise: string, id: string) {
  try {
    const p = await lirePieceBrute(tx, entreprise, id);
    return contenuScelle(p, await lireLignes(tx, id));
  } catch (e) {
    if (e instanceof Introuvable) return null;
    throw e;
  }
}

// ── L'émission ──────────────────────────────────────────────────────────────────────────────────
// `serieVoulue` : la série où numéroter (celle de la v10, « FAC ») ; sans elle, la première série légale.
export async function emettre(tx: Transaction, utilisateur: string, entreprise: string, id: string, serieVoulue?: string) {
  const db = requetes(tx);
  // 1. Les contrôles, tous, avant de prendre quoi que ce soit.
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('ventes.deja_emise');
  if (p.type !== 'facture' && p.type !== 'avoir') throw new Refus('ventes.seule_facture');
  // Un avoir corrige une facture émise de son client, dans sa devise (01 § 7).
  if (p.type === 'avoir') {
    if (!p.corrige) throw new Refus('ventes.avoir_sans_facture');
    const f = await lirePieceBrute(tx, entreprise, p.corrige);
    if (f.statut !== 'emise') throw new Refus('ventes.avoir_facture_non_emise');
    if (f.tiers !== p.tiers) throw new Refus('ventes.avoir_autre_client');
    if (f.devise !== p.devise) throw new Refus('ventes.avoir_autre_devise', { valeurs: { devise: f.devise } });
  }
  const lignes = await lireLignes(tx, id);
  if (!lignes.length) throw new Refus('ventes.sans_ligne');
  const calcul = await calculer(tx, p, lignes);
  const t = calcul.totaux;
  if (calcul.timbreManquant) {
    throw new Refus('ventes.timbre_manquant', { valeurs: { date: p.date_piece } });
  }
  // Chaque pièce se numérote dans une série de SON type : un avoir ne prend jamais un numéro de facture. Sans série
  // voulue, jamais celle des tickets (brique 115) : une facture ne prend pas un numéro de ticket.
  const serie = (await db.selectFrom('socle.serie').select('id')
    .where('entreprise', '=', entreprise).where('type', '=', p.type).where('legale', '=', true).where('active', '=', true)
    .$if(serieVoulue !== undefined, (q) => q.where('id', '=', serieVoulue ?? ''))
    .$if(serieVoulue === undefined, (q) => q.where('prefixe', '<>', 'TIC'))
    .orderBy('cree_le').limit(1).executeTakeFirst())?.id;
  if (!serie) throw new Refus('ventes.sans_serie', { bouton: 'socle.reglages_fiscaux.modifier' });
  const societe = await db.selectFrom('socle.entreprise').select(['raison_sociale', 'matricule_fiscal']).where('id', '=', entreprise).executeTakeFirstOrThrow();
  const client = await db.selectFrom('socle.tiers').select(['raison_sociale', 'identifiant', 'type_identifiant', 'adresse', 'pays'])
    .where('id', '=', p.tiers).executeTakeFirstOrThrow();

  // Ce que doit la facture qu'un avoir corrige, avant lui : s'il la solde, c'est annoncé (brique 128).
  const avantAvoir = p.type === 'avoir' && p.corrige ? await resteAvant(tx, entreprise, p.corrige) : null;
  // 2. Le numéro, les montants, la copie figée, le maillon.
  const numero = await prendreNumero(tx, serie, p.date_piece);
  const copie = {
    societe: { raisonSociale: societe.raison_sociale, matriculeFiscal: societe.matricule_fiscal },
    client: { raisonSociale: client.raison_sociale, identifiant: client.identifiant, typeIdentifiant: client.type_identifiant, adresse: client.adresse, pays: client.pays },
    regles: { timbre: calcul.timbre ? { regle: calcul.timbre.regle, valeur: calcul.timbre.valeur, origine: calcul.timbre.origine } : null },
  };
  for (const [i, l] of t.lignes.entries()) {
    await db.updateTable('ventes.ligne').set({ ht: l.ht, tva: l.tva, ttc: l.ttc }).where('piece', '=', id).where('rang', '=', i + 1).execute();
  }
  const emise: PieceLue = {
    ...p, statut: 'emise', serie, numero_texte: numero.texte,
    totaux: {
      total_ht: t.totalHT, remise: t.remise, net_ht: t.netHT, total_tva: t.totalTVA, timbre: t.timbre, timbre_base: t.timbreBase,
      total_ttc: t.totalTTC, retenue: t.retenue, net_a_payer: t.netAPayer,
    },
    tva_par_taux: tvaParTauxJson(t), copie,
  };
  const lignesEmises = lignes.map((l, i) => ({ ...l, ht: t.lignes[i]?.ht ?? null, tva: t.lignes[i]?.tva ?? null, ttc: t.lignes[i]?.ttc ?? null }));
  const maillon = await sceller(tx, entreprise, `serie:${serie}`, { type: 'piece_vente', id }, contenuScelle(emise, lignesEmises));
  await db.updateTable('ventes.piece').set({
    statut: 'emise', serie, numero: BigInt(numero.numero), numero_texte: numero.texte,
    total_ht: t.totalHT, remise: t.remise, net_ht: t.netHT, total_tva: t.totalTVA, timbre: t.timbre, timbre_base: t.timbreBase,
    total_ttc: t.totalTTC, retenue: t.retenue, net_a_payer: t.netAPayer,
    tva_par_taux: JSON.stringify(emise.tva_par_taux), copie: JSON.stringify(copie), chaine_rang: BigInt(maillon.rang), empreinte: maillon.empreinte,
    emise_le: sql<Date>`now()`, emise_par: utilisateur, modifie_le: sql<Date>`now()`,
  }).where('id', '=', id).where('entreprise', '=', entreprise).execute();
  await tracer(tx, entreprise, `ventes.${p.type}.emettre`, { type: 'piece_vente', id }, null, { numero: numero.texte, netAPayer: t.netAPayer });
  // L'avis aux adresses abonnées naît dans la MÊME transaction : une émission qui échoue n'annonce
  // rien, une facture émise est toujours annoncée (14 § 2.5). L'argent en texte décimal, jamais en
  // nombre à virgule. L'avoir n'a pas encore son événement (docs/avoirs-reglements.md, D5).
  const d = calcul.devise.decimales;
  if (p.type === 'facture') {
    await emettreAvis(tx, entreprise, 'facture.emise', {
      id, numero: numero.texte, datePiece: p.date_piece, client: { id: p.tiers, raisonSociale: client.raison_sociale },
      devise: calcul.devise.code, totalHT: versTexte(t.netHT, d), totalTVA: versTexte(t.totalTVA, d), totalTTC: versTexte(t.totalTTC, d),
      retenue: versTexte(t.retenue, d), netAPayer: versTexte(t.netAPayer, d),
    });
  }
  if (avantAvoir !== null && p.corrige) await annoncerReglements(tx, entreprise, p.corrige, avantAvoir, [], { par: 'avoir', date: p.date_piece });
  // Ses écritures (brique 32) : la famille de la facture se réécrit, dans la même transaction.
  await ecrireFamilleDeVente(tx, entreprise, p.type === 'avoir' ? (p.corrige ?? id) : id);
  return { numero: numero.texte, totaux: t, devise: calcul.devise, empreinte: maillon.empreinte };
}

// ── La lecture (pour l'API) ─────────────────────────────────────────────────────────────────────
// Une pièce émise se lit telle qu'elle a été émise (R7) : jamais recalculée. Un brouillon se calcule
// à la volée, avec les règles de sa date.
export async function lirePiece(tx: Transaction, entreprise: string, id: string) {
  const p = await lirePieceBrute(tx, entreprise, id);
  const lignes = await lireLignes(tx, id);
  const devise = await deviseDe(tx, p.devise);
  const m = (v: bigint | null) => (v === null ? null : versTexte(v, devise.decimales));
  let totaux: Record<string, string | null>;
  let tvaParTaux: { taux: string; base: string | null; tva: string | null }[];
  let lignesSortie = lignes;
  let timbreNonRenseigne = false;
  if (p.totaux && p.tva_par_taux) {
    totaux = Object.fromEntries(Object.entries(p.totaux).map(([k, v]) => [k, k === 'timbre_base' ? versTexte(v, 3) : m(v)]));
    tvaParTaux = Object.entries(p.tva_par_taux).map(([taux, v]) => ({ taux: versTexte(BigInt(taux), DECIMALES.taux), base: m(BigInt(v.base)), tva: m(BigInt(v.tva)) }));
  } else {
    const c = await calculer(tx, p, lignes);
    const t = c.totaux;
    timbreNonRenseigne = c.timbreManquant;
    totaux = {
      total_ht: m(t.totalHT), remise: m(t.remise), net_ht: m(t.netHT), total_tva: m(t.totalTVA), timbre: m(t.timbre),
      timbre_base: versTexte(t.timbreBase, 3), total_ttc: m(t.totalTTC), retenue: m(t.retenue), net_a_payer: m(t.netAPayer),
    };
    tvaParTaux = [...t.tvaParTaux.entries()].map(([taux, v]) => ({ taux: versTexte(taux, DECIMALES.taux), base: m(v.base), tva: m(v.tva) }));
    lignesSortie = lignes.map((l, i) => ({ ...l, ht: t.lignes[i]?.ht ?? null, tva: t.lignes[i]?.tva ?? null, ttc: t.lignes[i]?.ttc ?? null }));
  }
  // Pour l'affichage : le symbole de la devise, et le nom du client (celui de la copie figée pour
  // une pièce émise, R7 ; celui de sa fiche pour un brouillon).
  const db = requetes(tx);
  const fiche = await db.selectFrom('socle.tiers').select('raison_sociale').where('id', '=', p.tiers).executeTakeFirstOrThrow();
  const { symbole } = await db.selectFrom('socle.devise').select('symbole').where('code', '=', p.devise).executeTakeFirstOrThrow();
  const figee = (p.copie as { client?: { raisonSociale?: string } } | null)?.client?.raisonSociale;
  return {
    id: p.id, type: p.type, statut: p.statut, numero: p.numero_texte, tiers: p.tiers, datePiece: p.date_piece, echeance: p.echeance,
    client: figee ?? fiche.raison_sociale,
    devise: p.devise, deviseSymbole: symbole, cours: p.cours === null ? null : versTexte(p.cours, DECIMALES.cours),
    tauxRemise: versTexte(p.taux_remise, DECIMALES.taux), tauxRetenue: versTexte(p.taux_retenue, DECIMALES.taux),
    appliquerTimbre: p.appliquer_timbre, objet: p.objet, notes: p.notes, revision: p.revision, empreinte: p.empreinte,
    // Ce qui a servi à la calculer, figé à l'émission (R7) ; rien pour un brouillon.
    copie: p.copie ?? null,
    lignes: lignesSortie.map((l) => ({
      rang: l.rang, designation: l.designation, description: l.description,
      quantite: versTexte(l.quantite, DECIMALES.quantite), prixUnitaire: versTexte(l.prix_unitaire, DECIMALES.prix),
      tauxTva: versTexte(l.taux_tva, DECIMALES.taux), sansRemise: l.sans_remise, ht: m(l.ht), tva: m(l.tva), ttc: m(l.ttc),
    })),
    totaux, tvaParTaux,
    ...(timbreNonRenseigne ? { avertissement: motif('ventes.avertissement_timbre') } : {}),
    // Un avoir : la facture qu'il corrige. Une facture émise : ce qu'elle doit encore, son statut, ses
    // règlements et la retenue née de chacun, ses avoirs (déduits à chaque lecture, R8).
    ...(p.corrige ? { corrige: p.corrige } : {}),
    ...(p.type === 'facture' && p.statut === 'emise' ? { suivi: await etatDeFacture(tx, entreprise, p, devise.decimales) } : {}),
  };
}
