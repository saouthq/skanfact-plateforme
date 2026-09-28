// Les pièces de vente : le brouillon (créer, modifier, supprimer), la lecture avec ses totaux, et
// l'ÉMISSION d'une facture (01 § 6, § 7, R6, R7, R9, R11) :
//   1. tous les contrôles d'abord (brouillon, lignes, client, série, règles connues à la date) ;
//   2. puis, dans la même transaction : le numéro, les totaux en entiers (moteur/piece.ts), la copie
//      figée de ce qui a servi au calcul, et le maillon dans la chaîne de la série.
// Un refus à l'étape 1 ne prend aucun numéro ; une erreur à l'étape 2 annule tout, numéro compris.

import { depuisTexte, versTexte, type Devise } from '../../moteur/argent.ts';
import { calculerPiece, timbreApplique, type Piece, type TotauxPiece, type TypePiece } from '../../moteur/piece.ts';
import type { Transaction } from '../base.ts';
import { Introuvable, Perimee, Refus } from '../erreurs.ts';
import { sceller } from '../journal.ts';
import { prendreNumero } from '../numeros.ts';
import { regle, type RegleLue } from '../regles.ts';

// ── Ce qu'on saisit (les nombres arrivent en TEXTE, jamais en nombre à virgule) ─────────────────
export type LigneSaisie = {
  designation: string; description?: string | undefined;
  quantite: string; prixUnitaire: string; tauxTva: string; sansRemise?: boolean | undefined;
};
export type BrouillonSaisi = {
  type: TypePiece; tiers: string; datePiece: string; echeance?: string | undefined;
  devise?: string | undefined; cours?: string | undefined; tauxRemise?: string | undefined; tauxRetenue?: string | undefined;
  appliquerTimbre?: boolean | undefined; objet?: string | undefined; notes?: string | undefined;
  lignes: LigneSaisie[];
};
// Les décimales de chaque nombre saisi (01 R3).
export const DECIMALES = { quantite: 3, prix: 6, taux: 4, cours: 6 } as const;

// ── Ce qu'on lit dans la base ───────────────────────────────────────────────────────────────────
type LignePieceLue = {
  rang: number; designation: string; description: string | null;
  quantite: bigint; prix_unitaire: bigint; taux_tva: bigint; sans_remise: boolean;
  ht: bigint | null; tva: bigint | null; ttc: bigint | null;
};
type PieceLue = {
  id: string; entreprise: string; type: TypePiece; statut: string; tiers: string; date_piece: string; echeance: string | null;
  devise: string; cours: bigint | null; taux_remise: bigint; taux_retenue: bigint; appliquer_timbre: boolean | null;
  objet: string | null; notes: string | null; serie: string | null; numero_texte: string | null; revision: number;
  totaux: Record<string, bigint> | null; tva_par_taux: Record<string, { base: string; tva: string }> | null;
  copie: unknown; empreinte: string | null;
};

const MONTANTS = ['total_ht', 'remise', 'net_ht', 'total_tva', 'timbre', 'timbre_base', 'total_ttc', 'retenue', 'net_a_payer'] as const;
const big = (v: unknown): bigint => BigInt(v as string | number);
const bigOuNull = (v: unknown): bigint | null => (v === null || v === undefined ? null : big(v));

async function lireLignes(tx: Transaction, piece: string): Promise<LignePieceLue[]> {
  const r = await tx.query(`select rang, designation, description, quantite, prix_unitaire, taux_tva, sans_remise, ht, tva, ttc
    from ventes.ligne where piece = $1 order by rang`, [piece]);
  return r.rows.map((l) => ({
    rang: l.rang, designation: l.designation, description: l.description,
    quantite: big(l.quantite), prix_unitaire: big(l.prix_unitaire), taux_tva: big(l.taux_tva), sans_remise: l.sans_remise,
    ht: bigOuNull(l.ht), tva: bigOuNull(l.tva), ttc: bigOuNull(l.ttc),
  }));
}

async function lirePieceBrute(tx: Transaction, entreprise: string, id: string, verrou = false): Promise<PieceLue> {
  const r = (await tx.query(`select * from ventes.piece where id = $1 and entreprise = $2 ${verrou ? 'for update' : ''}`, [id, entreprise])).rows[0];
  if (!r) throw new Introuvable();
  return {
    id: r.id, entreprise: r.entreprise, type: r.type, statut: r.statut, tiers: r.tiers, date_piece: r.date_piece, echeance: r.echeance,
    devise: r.devise, cours: bigOuNull(r.cours), taux_remise: big(r.taux_remise), taux_retenue: big(r.taux_retenue),
    appliquer_timbre: r.appliquer_timbre, objet: r.objet, notes: r.notes, serie: r.serie, numero_texte: r.numero_texte,
    revision: Number(r.revision),
    totaux: r.statut === 'emise' ? Object.fromEntries(MONTANTS.map((m) => [m, big(r[m])])) : null,
    tva_par_taux: r.tva_par_taux, copie: r.copie, empreinte: r.empreinte,
  };
}

async function deviseDe(tx: Transaction, code: string): Promise<Devise> {
  const r = (await tx.query('select code, decimales from socle.devise where code = $1', [code])).rows[0];
  if (!r) throw new Refus(`la devise ${code} n'est pas connue`);
  return { code: r.code, decimales: r.decimales };
}

// ── Le brouillon ────────────────────────────────────────────────────────────────────────────────
function valeurs(b: BrouillonSaisi) {
  return {
    cours: b.cours === undefined ? null : depuisTexte(b.cours, DECIMALES.cours),
    tauxRemise: b.tauxRemise === undefined ? 0n : depuisTexte(b.tauxRemise, DECIMALES.taux),
    tauxRetenue: b.tauxRetenue === undefined ? 0n : depuisTexte(b.tauxRetenue, DECIMALES.taux),
  };
}

async function ecrireLignes(tx: Transaction, entreprise: string, piece: string, lignes: LigneSaisie[]) {
  for (const [i, l] of lignes.entries()) {
    await tx.query(`insert into ventes.ligne (piece, entreprise, rang, designation, description, quantite, prix_unitaire, taux_tva, sans_remise)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [piece, entreprise, i + 1, l.designation, l.description ?? null,
      depuisTexte(l.quantite, DECIMALES.quantite), depuisTexte(l.prixUnitaire, DECIMALES.prix), depuisTexte(l.tauxTva, DECIMALES.taux), l.sansRemise ?? false]);
  }
}

export async function creerBrouillon(tx: Transaction, utilisateur: string, entreprise: string, b: BrouillonSaisi): Promise<string> {
  const v = valeurs(b);
  const id = (await tx.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, echeance, devise, cours, taux_remise, taux_retenue,
      appliquer_timbre, objet, notes, cree_par)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
  [entreprise, b.type, b.tiers, b.datePiece, b.echeance ?? null, b.devise ?? 'TND', v.cours, v.tauxRemise, v.tauxRetenue,
    b.appliquerTimbre ?? null, b.objet ?? null, b.notes ?? null, utilisateur])).rows[0].id as string;
  await ecrireLignes(tx, entreprise, id, b.lignes);
  await tx.query(`select socle.tracer($1, 'ventes.brouillon.creer', 'piece_vente', $2, null, $3)`, [entreprise, id, JSON.stringify({ type: b.type, tiers: b.tiers })]);
  return id;
}

export async function modifierBrouillon(tx: Transaction, entreprise: string, id: string, revisionVue: number, b: BrouillonSaisi): Promise<number> {
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('une pièce émise ne se modifie plus : on la corrige par un avoir');
  if (p.revision !== revisionVue) throw new Perimee();
  const v = valeurs(b);
  await tx.query(`update ventes.piece set type = $3, tiers = $4, date_piece = $5, echeance = $6, devise = $7, cours = $8, taux_remise = $9,
      taux_retenue = $10, appliquer_timbre = $11, objet = $12, notes = $13, revision = revision + 1, modifie_le = now()
    where id = $1 and entreprise = $2`,
  [id, entreprise, b.type, b.tiers, b.datePiece, b.echeance ?? null, b.devise ?? 'TND', v.cours, v.tauxRemise, v.tauxRetenue,
    b.appliquerTimbre ?? null, b.objet ?? null, b.notes ?? null]);
  await tx.query('delete from ventes.ligne where piece = $1', [id]);
  await ecrireLignes(tx, entreprise, id, b.lignes);
  await tx.query(`select socle.tracer($1, 'ventes.brouillon.modifier', 'piece_vente', $2, $3, $4)`,
    [entreprise, id, JSON.stringify({ revision: p.revision }), JSON.stringify({ revision: p.revision + 1 })]);
  return p.revision + 1;
}

// Seul un brouillon se supprime, et la suppression laisse sa trace (01 R6).
export async function supprimerBrouillon(tx: Transaction, entreprise: string, id: string): Promise<void> {
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('une pièce émise ne s\'efface jamais : on la corrige par un avoir');
  await tx.query('delete from ventes.piece where id = $1', [id]);
  await tx.query(`select socle.tracer($1, 'ventes.brouillon.supprimer', 'piece_vente', $2, $3, null)`,
    [entreprise, id, JSON.stringify({ type: p.type, tiers: p.tiers, date: p.date_piece })]);
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
  if (timbre) piece.timbre = big(timbre.valeur);
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
export async function emettre(tx: Transaction, utilisateur: string, entreprise: string, id: string) {
  // 1. Les contrôles, tous, avant de prendre quoi que ce soit.
  const p = await lirePieceBrute(tx, entreprise, id, true);
  if (p.statut !== 'brouillon') throw new Refus('cette facture est déjà émise');
  if (p.type !== 'facture') throw new Refus('seule une facture s\'émet pour l\'instant');
  const lignes = await lireLignes(tx, id);
  if (!lignes.length) throw new Refus('une facture sans ligne ne s\'émet pas');
  const calcul = await calculer(tx, p, lignes);
  const t = calcul.totaux;
  if (calcul.timbreManquant) {
    throw new Refus(`le timbre fiscal n'est pas renseigné au ${p.date_piece} : la facture ne s'émet pas sans lui`);
  }
  const serie = (await tx.query(`select id from socle.serie where entreprise = $1 and type = 'facture' and legale and active
    order by cree_le limit 1`, [entreprise])).rows[0]?.id as string | undefined;
  if (!serie) throw new Refus('aucune série de factures n\'existe encore : crée-la dans les réglages', 'socle.reglages_fiscaux.modifier');
  const societe = (await tx.query('select raison_sociale, matricule_fiscal from socle.entreprise where id = $1', [entreprise])).rows[0];
  const client = (await tx.query('select raison_sociale, identifiant, type_identifiant, adresse, pays from socle.tiers where id = $1', [p.tiers])).rows[0];

  // 2. Le numéro, les montants, la copie figée, le maillon.
  const numero = await prendreNumero(tx, serie, p.date_piece);
  const copie = {
    societe: { raisonSociale: societe.raison_sociale, matriculeFiscal: societe.matricule_fiscal },
    client: { raisonSociale: client.raison_sociale, identifiant: client.identifiant, typeIdentifiant: client.type_identifiant, adresse: client.adresse, pays: client.pays },
    regles: { timbre: calcul.timbre ? { regle: calcul.timbre.regle, valeur: calcul.timbre.valeur, origine: calcul.timbre.origine } : null },
  };
  for (const [i, l] of t.lignes.entries()) {
    await tx.query('update ventes.ligne set ht = $3, tva = $4, ttc = $5 where piece = $1 and rang = $2', [id, i + 1, l.ht, l.tva, l.ttc]);
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
  await tx.query(`update ventes.piece set statut = 'emise', serie = $3, numero = $4, numero_texte = $5,
      total_ht = $6, remise = $7, net_ht = $8, total_tva = $9, timbre = $10, timbre_base = $11, total_ttc = $12, retenue = $13, net_a_payer = $14,
      tva_par_taux = $15, copie = $16, chaine_rang = $17, empreinte = $18, emise_le = now(), emise_par = $19, modifie_le = now()
    where id = $1 and entreprise = $2`,
  [id, entreprise, serie, numero.numero, numero.texte, t.totalHT, t.remise, t.netHT, t.totalTVA, t.timbre, t.timbreBase, t.totalTTC,
    t.retenue, t.netAPayer, JSON.stringify(emise.tva_par_taux), JSON.stringify(copie), maillon.rang, maillon.empreinte, utilisateur]);
  await tx.query(`select socle.tracer($1, 'ventes.facture.emettre', 'piece_vente', $2, null, $3)`,
    [entreprise, id, JSON.stringify({ numero: numero.texte, netAPayer: t.netAPayer.toString() })]);
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
  return {
    id: p.id, type: p.type, statut: p.statut, numero: p.numero_texte, tiers: p.tiers, datePiece: p.date_piece, echeance: p.echeance,
    devise: p.devise, cours: p.cours === null ? null : versTexte(p.cours, DECIMALES.cours),
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
    ...(timbreNonRenseigne ? { avertissement: 'Le timbre fiscal n\'est pas renseigné à cette date : la facture ne pourra pas être émise.' } : {}),
  };
}
