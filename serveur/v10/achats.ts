// Les achats du dossier v10, tenus par le serveur (0013, brique 30 ; docs/achats.md). La v10 saisit
// ses achats et ses fournisseurs dans son dossier ; à chaque enregistrement, une fois tout l'envoi
// écrit, le serveur :
//   - tient la fiche de chaque fournisseur (socle.tiers, rôle « fournisseur ») ;
//   - lit et vérifie chaque achat changé, le calcule en entiers par le moteur (moteur/achats.ts), et
//     tient sa pièce, ses lignes et ses règlements au même état (achats.*), avec leur trace ;
//   - refuse de supprimer un achat auquel un avoir ou un acompte est rattaché (D2), et un
//     rattachement à autre chose qu'une facture ou une dépense de la même devise (D3).
// Un seul refus, et rien de l'envoi n'est écrit (la transaction de l'enregistrement).

import { sql } from 'kysely';
import { calculerAchat, DESTINATIONS, type Achat, type Destination, type NatureAchat } from '../../moteur/achats.ts';
import { requetes, type Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { REGLEMENTS_ACHATS, tenirReglements } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { aVraimentChange, deviseV10, estJour, estObjet, exact, lirePaiements, objetDuDossier, texteOuNul, type ChangementLu, type Json } from './lecture.ts';
import './textes.ts';

const NATURES: NatureAchat[] = ['facture', 'depense', 'avoir', 'acompte'];
// Les régimes de la v10 qui ne récupèrent pas la TVA (REGIMES de core.js ; vide vaut « réel »).
const REGIMES_SANS_TVA = ['forfaitaire', 'exonere'];
const DEC = { quantite: 3, prix: 6, taux: 4, cours: 6 } as const;
const CENT_POUR_CENT = 1_000_000n;   // un taux à quatre décimales : 100 % = 1 000 000

// Le nom d'un achat dans un refus : le numéro du fournisseur, sinon sa date.
const nomDe = (p: Json) => (typeof p.number === 'string' && p.number.trim() !== '' ? p.number.trim() : `du ${String(p.date ?? '?')}`);

// ── Les fournisseurs ─────────────────────────────────────────────────────────────────────────────
// La fiche du serveur suit celle du dossier. Un fournisseur retiré du dossier garde sa fiche (D7) :
// la v10 ne retire qu'un fournisseur sans achat, et la trace peut encore le nommer.
async function ficheFournisseur(tx: Transaction, entreprise: string, ref: string, s: Json): Promise<string> {
  const db = requetes(tx);
  const identifiant = String(s.matricule ?? '').trim().slice(0, 40) || null;
  const fiche = {
    raison_sociale: String(s.name ?? '').trim().slice(0, 300) || '—', identifiant, type_identifiant: identifiant ? 'matricule' : null,
    adresse: texteOuNul(s.address, 1000), email: texteOuNul(s.email, 300), telephone: texteOuNul(s.phone, 40),
  };
  const deja = await db.selectFrom('socle.tiers').select(['id', 'roles']).where('entreprise', '=', entreprise).where('ref_v10', '=', ref).executeTakeFirst();
  if (deja) {
    const roles = deja.roles.includes('fournisseur') ? deja.roles : [...deja.roles, 'fournisseur'];
    await db.updateTable('socle.tiers').set({ ...fiche, roles, modifie_le: new Date() }).where('id', '=', deja.id).execute();
    return deja.id;
  }
  return (await db.insertInto('socle.tiers').values({ entreprise, nature: 'societe', ...fiche, pays: 'TN', roles: ['fournisseur'], ref_v10: ref })
    .returning('id').executeTakeFirstOrThrow()).id;
}

// ── Lire un achat de la v10 ──────────────────────────────────────────────────────────────────────
type AchatLu = {
  nature: NatureAchat; fournisseur: string | null; numero: string | null; date: string; echeance: string | null;
  devise: string; decimales: number; cours: bigint | null; tauxRetenue: bigint; frais: bigint; tvaRecuperable: boolean;
  objet: string | null; categorie: string | null; lie: string | null;
  lignes: { designation: string; quantite: bigint; prixUnitaire: bigint; tauxTva: bigint; destination: Destination; nonDeductible: boolean }[];
};

async function lireAchat(tx: Transaction, entreprise: string, p: Json, recuperableParDefaut: boolean): Promise<AchatLu> {
  const db = requetes(tx);
  const numero = nomDe(p);
  const nature = p.kind as NatureAchat;
  if (!NATURES.includes(nature)) throw new Refus('v10.achat_nature', { valeurs: { numero } });
  if (!estJour(p.date)) throw new Refus('v10.achat_date', { valeurs: { numero } });
  const echeance = p.dueDate === undefined || p.dueDate === null || p.dueDate === '' ? null : p.dueDate;
  if (echeance !== null && !estJour(echeance)) throw new Refus('v10.achat_echeance', { valeurs: { numero } });

  // La devise de la pièce (vide : celle de l'entreprise), et son cours (D5).
  const devise = deviseV10(p.currency);
  const d = await db.selectFrom('socle.devise').select('decimales').where('code', '=', devise).executeTakeFirst();
  if (!d) throw new Refus('v10.achat_devise', { valeurs: { numero, devise } });
  // Comme l'éditeur de la v10 (10.1.0) : sans lui, la TVA déductible et les charges compteraient
  // une unité de la devise pour un dinar.
  let cours: bigint | null = null;
  if (devise !== 'TND') {
    cours = exact(p.exchangeRate, DEC.cours);
    if (cours === null || cours <= 0n) throw new Refus('v10.achat_cours', { valeurs: { numero, devise } });
  }
  const frais = exact(p.fees ?? 0, d.decimales);
  if (frais === null) throw new Refus('v10.achat_frais', { valeurs: { numero, devise, decimales: String(d.decimales) } });
  const tauxRetenue = exact(p.withholdingRate ?? 0, DEC.taux);
  if (tauxRetenue === null || tauxRetenue < 0n || tauxRetenue > CENT_POUR_CENT) throw new Refus('v10.achat_retenue', { valeurs: { numero } });

  const lignes = (Array.isArray(p.lines) ? p.lines : []).map((l, i) => {
    const x = estObjet(l) ? l : {};
    const quantite = exact(x.qty ?? 0, DEC.quantite), prixUnitaire = exact(x.unitPrice ?? 0, DEC.prix), tauxTva = exact(x.vatRate ?? 0, DEC.taux);
    if (quantite === null || prixUnitaire === null || tauxTva === null || tauxTva < 0n || tauxTva > CENT_POUR_CENT) {
      throw new Refus('v10.achat_ligne', { valeurs: { numero, rang: String(i + 1) } });
    }
    const destination = (DESTINATIONS as unknown[]).includes(x.destination) ? x.destination as Destination : 'charge';
    return { designation: String(x.label ?? '').trim().slice(0, 500) || '—', quantite, prixUnitaire, tauxTva, destination, nonDeductible: x.deductible === false };
  });

  // Le fournisseur : sa fiche au serveur, créée depuis le dossier s'il n'en a pas encore.
  let fournisseur: string | null = null;
  const ref = typeof p.supplierId === 'string' ? p.supplierId : '';
  if (ref !== '') {
    fournisseur = (await db.selectFrom('socle.tiers').select('id').where('entreprise', '=', entreprise).where('ref_v10', '=', ref).executeTakeFirst())?.id ?? null;
    if (!fournisseur) {
      const s = await objetDuDossier(tx, entreprise, 'suppliers', ref);
      if (!s) throw new Refus('v10.achat_fournisseur', { valeurs: { numero } });
      fournisseur = await ficheFournisseur(tx, entreprise, ref, s);
    }
  }
  return {
    nature, fournisseur, numero: texteOuNul(p.number, 200), date: p.date as string, echeance,
    devise, decimales: d.decimales, cours, tauxRetenue, frais,
    // La valeur de la pièce, sinon le régime de l'entreprise ce jour-là, gardée sur la pièce (D6).
    tvaRecuperable: typeof p.tvaRecuperable === 'boolean' ? p.tvaRecuperable : recuperableParDefaut,
    objet: texteOuNul(p.subject, 500), categorie: texteOuNul(p.category, 200),
    lie: typeof p.achatLie === 'string' && p.achatLie !== '' ? p.achatLie : null,
    lignes,
  };
}

// Les montants d'un achat, dans SA devise : le moteur calcule sans cours quand on lui donne la
// devise de la pièce comme devise de la comptabilité (ses montants en dinars viennent à la lecture).
export function totauxDansSaDevise(a: Pick<AchatLu, 'nature' | 'devise' | 'decimales' | 'lignes' | 'frais' | 'tauxRetenue' | 'tvaRecuperable'>) {
  const devise = { code: a.devise, decimales: a.decimales };
  const achat: Achat = {
    nature: a.nature, devise, lignes: a.lignes.map((l) => ({ ...l })), frais: a.frais, tauxRetenue: a.tauxRetenue, tvaRecuperable: a.tvaRecuperable,
  };
  return calculerAchat(achat, devise);
}

// ── Tenir un achat au serveur ────────────────────────────────────────────────────────────────────
async function tenirAchat(tx: Transaction, entreprise: string, utilisateur: string, cle: string, p: Json, recuperable: boolean): Promise<string> {
  const db = requetes(tx);
  const a = await lireAchat(tx, entreprise, p, recuperable);
  const t = totauxDansSaDevise(a);
  const champs = {
    nature: a.nature, fournisseur: a.fournisseur, numero_fournisseur: a.numero, date_piece: a.date, echeance: a.echeance,
    devise: a.devise, cours: a.cours, taux_retenue: a.tauxRetenue, frais: a.frais, tva_recuperable: a.tvaRecuperable,
    objet: a.objet, categorie: a.categorie,
    // Le rattachement se pose ensuite, quand toutes les pièces de l'envoi existent.
    lie: null,
    total_ht: t.totalHT, total_tva: t.totalTVA, tva_deductible: t.tvaDeductible, total_ttc: t.totalTTC, retenue: t.retenue, net_a_payer: t.netAPayer,
  };
  const deja = await db.selectFrom('achats.piece').select(['id', 'revision']).where('entreprise', '=', entreprise).where('ref_v10', '=', cle).executeTakeFirst();
  let id: string;
  const pourTrace = { nature: a.nature, numero: a.numero, date: a.date, devise: a.devise, netAPayer: t.netAPayer.toString() };
  if (deja) {
    id = deja.id;
    await db.updateTable('achats.piece').set({ ...champs, modifie_par: utilisateur, modifie_le: new Date(), revision: deja.revision + 1n }).where('id', '=', id).execute();
    await db.deleteFrom('achats.ligne').where('piece', '=', id).execute();
    await tracer(tx, entreprise, 'achats.piece.modifier', { type: 'achat', id }, { revision: deja.revision.toString() }, pourTrace);
  } else {
    id = (await db.insertInto('achats.piece').values({ entreprise, ref_v10: cle, ...champs, cree_par: utilisateur }).returning('id').executeTakeFirstOrThrow()).id;
    await tracer(tx, entreprise, 'achats.piece.enregistrer', { type: 'achat', id }, null, pourTrace);
  }
  for (const [i, l] of t.lignes.entries()) {
    const brut = a.lignes[i];
    await db.insertInto('achats.ligne').values({
      piece: id, entreprise, rang: i + 1, designation: brut?.designation ?? '—', quantite: l.quantite, prix_unitaire: l.prixUnitaire, taux_tva: l.tauxTva,
      destination: l.destination, non_deductible: !!l.nonDeductible, ht: l.ht, tva: l.tva, ttc: l.ttc,
    }).execute();
  }
  await tenirReglements(tx, REGLEMENTS_ACHATS, entreprise, utilisateur, id, lirePaiements(p.payments, nomDe(p), a.decimales, a.devise, 'v10.achat_reglement'));
  return id;
}

export async function suivreAchats(tx: Transaction, entreprise: string, utilisateur: string, changements: ChangementLu[]): Promise<void> {
  // Seul ce qui a VRAIMENT changé : une pièce seulement déplacée ne se recalcule pas.
  const fournisseurs = changements.filter((c) => c.collection === 'suppliers' && estObjet(c.apres) && aVraimentChange(c));
  const achats = changements.filter((c) => c.collection === 'purchases' && aVraimentChange(c));
  if (!fournisseurs.length && !achats.length) return;
  const db = requetes(tx);

  // 1. Les fiches des fournisseurs changés.
  for (const c of fournisseurs) await ficheFournisseur(tx, entreprise, c.cle, c.apres as Json);

  // 2. Chaque achat changé : sa pièce, ses lignes, ses règlements. Récupérer la TVA suit, par défaut,
  //    le régime de l'entreprise tel que le dossier le dit maintenant.
  const societe = await objetDuDossier(tx, entreprise, '_racine', 'company');
  const recuperable = !REGIMES_SANS_TVA.includes(String(societe?.taxRegime ?? '').trim());
  const tenus = new Map<string, Json>();
  for (const c of achats) {
    if (!estObjet(c.apres)) continue;
    await tenirAchat(tx, entreprise, utilisateur, c.cle, c.apres, recuperable);
    tenus.set(c.cle, c.apres);
  }

  // 3. Les rattachements, maintenant que toutes les pièces de l'envoi existent.
  for (const [cle, p] of tenus) {
    const lie = typeof p.achatLie === 'string' && p.achatLie !== '' ? p.achatLie : null;
    if (!lie) continue;
    let cible = (await db.selectFrom('achats.piece').select('id').where('entreprise', '=', entreprise).where('ref_v10', '=', lie).executeTakeFirst())?.id;
    if (!cible) {
      // Une pièce du dossier que le serveur ne tient pas encore (saisie avant lui) : il la prend.
      const f = await objetDuDossier(tx, entreprise, 'purchases', lie);
      if (!f) throw new Refus('v10.achat_lie_introuvable', { valeurs: { numero: nomDe(p) } });
      cible = await tenirAchat(tx, entreprise, utilisateur, lie, f, recuperable);
    }
    await db.updateTable('achats.piece').set({ lie: cible }).where('entreprise', '=', entreprise).where('ref_v10', '=', cle).execute();
  }

  // 4. Les suppressions : jamais une pièce à laquelle une autre reste rattachée (D2). La v10 le
  //    permettait, et l'avoir restait « imputé » à une facture qui n'existait plus.
  const retires = achats.filter((c) => c.apres === null).map((c) => c.cle);
  // Deux pièces rattachées l'une à l'autre et retirées ensemble partent dans n'importe quel ordre.
  if (retires.length) await db.updateTable('achats.piece').set({ lie: null }).where('entreprise', '=', entreprise).where('ref_v10', 'in', retires).execute();
  for (const c of achats) {
    if (c.apres !== null) continue;
    const rattachee = await db.selectFrom('socle.dossier_v10').select('cle').where('entreprise', '=', entreprise).where('collection', '=', 'purchases')
      .where(sql<boolean>`contenu->>'achatLie' = ${c.cle}`).executeTakeFirst();
    if (rattachee) throw new Refus('v10.achat_rattache');
    const piece = await db.selectFrom('achats.piece').select(['id', 'nature', 'numero_fournisseur', 'date_piece', 'net_a_payer']).where('entreprise', '=', entreprise).where('ref_v10', '=', c.cle).executeTakeFirst();
    if (!piece) continue;
    await tenirReglements(tx, REGLEMENTS_ACHATS, entreprise, utilisateur, piece.id, []);
    await db.deleteFrom('achats.piece').where('id', '=', piece.id).execute();
    await tracer(tx, entreprise, 'achats.piece.supprimer', { type: 'achat', id: piece.id },
      { nature: piece.nature, numero: piece.numero_fournisseur, date: piece.date_piece, netAPayer: piece.net_a_payer.toString() }, null);
  }

  // 5. Chaque rattachement touché par l'envoi relie un avoir ou un acompte à une facture ou une
  //    dépense de la MÊME devise (D3) : une pièce rattachée se déduit dans la devise de sa facture.
  const touches = [...tenus.keys()];
  if (touches.length) {
    const faux = await db.selectFrom('achats.piece as p').innerJoin('achats.piece as f', 'f.id', 'p.lie')
      .select(['p.numero_fournisseur', 'p.date_piece', 'p.devise', 'f.devise as devise_facture', 'f.nature as nature_facture'])
      .where('p.entreprise', '=', entreprise)
      .where((eb) => eb.or([eb('p.ref_v10', 'in', touches), eb('f.ref_v10', 'in', touches)]))
      .where((eb) => eb.or([eb('f.devise', '<>', eb.ref('p.devise')), eb.not(eb('f.nature', 'in', ['facture', 'depense']))]))
      .executeTakeFirst();
    if (faux) {
      const numero = faux.numero_fournisseur ?? `du ${faux.date_piece}`;
      if (faux.devise_facture !== faux.devise) throw new Refus('v10.achat_lie_devise', { valeurs: { numero, devise: faux.devise_facture } });
      throw new Refus('v10.achat_lie_nature', { valeurs: { numero } });
    }
  }
}
