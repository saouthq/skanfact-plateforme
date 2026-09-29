// Le dossier v10 d'une entreprise, tenu par le serveur (0011 ; décision de Skander, 28/09/2026 : la
// plateforme reprend le CODE de l'interface v10). L'interface de la v10 travaille sur le dossier
// entier ; son point de contact (web/public/plateforme/pont.js) le charge d'ici et y renvoie chaque
// objet qui change. Le serveur :
//   - garde chaque objet avec sa révision, et refuse un changement fait sur une version dépassée ;
//   - n'accepte jamais qu'une facture devienne émise par un simple enregistrement : l'émission passe
//     par `emettreDepuisV10`, qui numérote, calcule en entiers, scelle (ventes.piece) ;
//   - refuse qu'une facture émise change ce qui a été scellé, ou disparaisse ;
//   - tient les règlements d'une facture émise au même état que le dossier (0012, `tenirReglements`).
// Un nombre non entier arrive en texte exact ({ "~n": "450.5" }) : jamais de nombre à virgule en base.

import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { requetes, type Transaction } from '../base.ts';
import { Perimee, Refus } from '../erreurs.ts';
import { REGLEMENTS_VENTES, tenirReglements } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { creerBrouillon, DECIMALES, emettre, supprimerBrouillon, type BrouillonSaisi } from '../ventes/pieces.ts';
import { suivreAchats } from './achats.ts';
import { canonique, deviseV10 as devise, enNombreV10, estObjet, lirePaiements, nombreEnTexte, type Json } from './lecture.ts';
import './textes.ts';

export { enNombreV10, nombreEnTexte };

export type Objet = { collection: string; cle: string; rang: number | null; contenu: unknown; revision: number };
export type Changement = { collection: string; cle: string; rang: number | null; revision: number | null; contenu: unknown };

// Un objet a changé ailleurs depuis que l'interface l'a chargé (01 R15) : rien n'est écrasé, on recharge.
export class Conflit extends Perimee {
  readonly objets: { collection: string; cle: string }[];
  constructor(objets: { collection: string; cle: string }[]) { super('v10.conflit'); this.objets = objets; }
}

// ── Les pièces : ce qu'une facture émise ne change plus ─────────────────────────────────────────
// Tout ce qui a servi à la calculer et à la numéroter, et pour un avoir la facture qu'il corrige et
// son motif imprimé (le reste, ses règlements, ses relances, ses justificatifs, suit sa vie). Une
// facture émise ne s'annule pas : un avoir total la solde, et « annulée » se déduit (01 § 7).
const PIECES_LEGALES = ['facture', 'avoir'];
const SCELLE = ['type', 'number', 'date', 'clientId', 'currency', 'exchangeRate', 'lines', 'discountRate', 'withholdingRate', 'applyStamp', 'stampFee', 'creditOf', 'creditReason'];
// Le statut d'une pièce émise, tel que la v10 l'écrit (STATUSES de core.js).
const STATUT_EMISE: Record<string, string> = { facture: 'envoyée', avoir: 'émis' };
const emise = (d: Json | null) => !!d && typeof d.number === 'string' && d.number !== '' && d.status !== 'brouillon';

function verifierPiece(avant: Json | null, apres: Json | null) {
  const type = String((apres ?? avant)?.type ?? '');
  if (!PIECES_LEGALES.includes(type)) return;
  if (emise(avant)) {
    const numero = { valeurs: { numero: String(avant?.number ?? '') } };
    const av = type === 'avoir';
    if (!apres) throw new Refus(av ? 'v10.avoir_ne_s_efface_pas' : 'v10.emise_ne_s_efface_pas', numero);
    for (const champ of SCELLE) {
      if (canonique(avant?.[champ]) !== canonique(apres[champ])) throw new Refus(av ? 'v10.avoir_ne_se_modifie_plus' : 'v10.emise_ne_se_modifie_plus', numero);
    }
    if (apres.status === 'annulée') throw new Refus('v10.annulee', numero);
    if (apres.status !== STATUT_EMISE[type]) throw new Refus(av ? 'v10.avoir_ne_se_modifie_plus' : 'v10.emise_ne_se_modifie_plus', numero);
    return;
  }
  // Un brouillon ne devient émis QUE par le serveur (la numérotation légale, 01 R9).
  if (emise(apres) || (apres && typeof apres.number === 'string' && apres.number !== '')) throw new Refus('v10.emission_par_le_serveur');
}

// ── Les règlements d'une facture (0012) ─────────────────────────────────────────────────────────
// Après l'enregistrement d'une pièce du dossier : une facture émise voit ses règlements tenus par le
// serveur ; une pièce légale qui n'est pas une facture émise n'en a aucun.
async function suivreReglements(tx: Transaction, entreprise: string, utilisateur: string, cle: string, apres: Json | null) {
  if (!apres || !PIECES_LEGALES.includes(String(apres.type))) return;
  const paiements = Array.isArray(apres.payments) ? apres.payments : [];
  if (apres.type !== 'facture' || !emise(apres)) {
    if (paiements.length) throw new Refus('v10.reglement_sur_brouillon');
    return;
  }
  const db = requetes(tx);
  const piece = await db.selectFrom('ventes.piece').select(['id', 'devise']).where('entreprise', '=', entreprise).where('ref_v10', '=', cle).where('statut', '=', 'emise').executeTakeFirst();
  if (!piece) throw new Error(`facture émise du dossier sans sa pièce au serveur : ${cle}`);
  const { decimales } = await db.selectFrom('socle.devise').select('decimales').where('code', '=', piece.devise).executeTakeFirstOrThrow();
  await tenirReglements(tx, REGLEMENTS_VENTES, entreprise, utilisateur, piece.id, lirePaiements(apres.payments, String(apres.number ?? ''), decimales, piece.devise));
}

// ── Lire le dossier ─────────────────────────────────────────────────────────────────────────────
// La première fois, le dossier naît de ce que le serveur sait déjà : la fiche de l'entreprise et ses
// clients (ceux de l'entreprise d'essai, par exemple).
async function amorcer(tx: Transaction, entreprise: string, utilisateur: string) {
  const db = requetes(tx);
  const e = await db.selectFrom('socle.entreprise').select(['raison_sociale', 'matricule_fiscal']).where('id', '=', entreprise).executeTakeFirstOrThrow();
  const tiers = await db.selectFrom('socle.tiers').select(['id', 'raison_sociale', 'identifiant', 'adresse', 'email', 'telephone', 'devise'])
    .where('entreprise', '=', entreprise).where('ref_v10', 'is', null).execute();
  const objets: { collection: string; cle: string; contenu: unknown }[] = [
    { collection: '_racine', cle: 'company', contenu: { name: e.raison_sociale, matricule: e.matricule_fiscal ?? '' } },
    ...tiers.map((t) => ({
      collection: 'clients', cle: t.id, contenu: {
        id: t.id, name: t.raison_sociale, matricule: t.identifiant ?? '', address: t.adresse ?? '', email: t.email ?? '', phone: t.telephone ?? '',
        currency: t.devise === 'TND' ? '' : t.devise,
      },
    })),
  ];
  for (const [i, o] of objets.entries()) {
    await db.insertInto('socle.dossier_v10').values({ entreprise, collection: o.collection, cle: o.cle, rang: o.collection === '_racine' ? null : i - 1, contenu: JSON.stringify(o.contenu), modifie_par: utilisateur }).execute();
  }
  // Un client amorcé est le même que sa fiche du serveur : son identifiant v10 est le sien.
  for (const t of tiers) await db.updateTable('socle.tiers').set({ ref_v10: t.id }).where('id', '=', t.id).execute();
}

export async function lireDossier(tx: Transaction, entreprise: string, utilisateur: string): Promise<Objet[]> {
  const lire = () => requetes(tx).selectFrom('socle.dossier_v10').select(['collection', 'cle', 'rang', 'contenu', 'revision'])
    .where('entreprise', '=', entreprise).orderBy('collection').orderBy('rang').orderBy('cle').execute();
  let lignes = await lire();
  if (!lignes.length) { await amorcer(tx, entreprise, utilisateur); lignes = await lire(); }
  return lignes.map((l) => ({ collection: l.collection, cle: l.cle, rang: l.rang, contenu: l.contenu, revision: Number(l.revision) }));
}

// ── Enregistrer des changements ─────────────────────────────────────────────────────────────────
export async function appliquer(tx: Transaction, entreprise: string, utilisateur: string, changements: Changement[]): Promise<{ collection: string; cle: string; revision: number | null }[]> {
  const db = requetes(tx);
  const actuels = new Map<string, { contenu: unknown; revision: number }>();
  const conflits: { collection: string; cle: string }[] = [];
  for (const c of changements) {
    const a = await db.selectFrom('socle.dossier_v10').select(['contenu', 'revision'])
      .where('entreprise', '=', entreprise).where('collection', '=', c.collection).where('cle', '=', c.cle).forUpdate().executeTakeFirst();
    if ((a ? Number(a.revision) : null) !== c.revision) conflits.push({ collection: c.collection, cle: c.cle });
    if (a) actuels.set(`${c.collection}/${c.cle}`, { contenu: a.contenu, revision: Number(a.revision) });
  }
  // Rien n'est écrit tant qu'un seul objet a changé ailleurs : on ne mélange jamais deux versions.
  if (conflits.length) throw new Conflit(conflits);
  const resultat: { collection: string; cle: string; revision: number | null }[] = [];
  for (const c of changements) {
    const a = actuels.get(`${c.collection}/${c.cle}`);
    if (c.collection === 'documents') {
      verifierPiece(estObjet(a?.contenu) ? a.contenu : null, estObjet(c.contenu) ? c.contenu : null);
      await suivreReglements(tx, entreprise, utilisateur, c.cle, estObjet(c.contenu) ? c.contenu : null);
    }
    if (c.contenu === null) {
      await db.deleteFrom('socle.dossier_v10').where('entreprise', '=', entreprise).where('collection', '=', c.collection).where('cle', '=', c.cle).execute();
      resultat.push({ collection: c.collection, cle: c.cle, revision: null });
    } else if (a) {
      await db.updateTable('socle.dossier_v10').set({ contenu: JSON.stringify(c.contenu), rang: c.rang, revision: BigInt(a.revision + 1), modifie_le: new Date(), modifie_par: utilisateur })
        .where('entreprise', '=', entreprise).where('collection', '=', c.collection).where('cle', '=', c.cle).execute();
      resultat.push({ collection: c.collection, cle: c.cle, revision: a.revision + 1 });
    } else {
      await db.insertInto('socle.dossier_v10').values({ entreprise, collection: c.collection, cle: c.cle, rang: c.rang, contenu: JSON.stringify(c.contenu), modifie_par: utilisateur }).execute();
      resultat.push({ collection: c.collection, cle: c.cle, revision: 1 });
    }
    // Une pièce qui change, ou qui disparaît, laisse sa trace ; le reste du dossier se relit par ses révisions.
    if (c.collection === 'documents') {
      await tracer(tx, entreprise, c.contenu === null ? 'v10.piece.supprimer' : 'v10.piece.modifier', { type: 'piece_v10', id: null }, a ? { cle: c.cle, revision: a.revision } : null, c.contenu === null ? null : { cle: c.cle });
    }
  }
  // Les achats et les fournisseurs, une fois TOUT l'envoi écrit : une pièce rattachée et sa facture,
  // un achat et son fournisseur, arrivent souvent ensemble (0013, serveur/v10/achats.ts).
  await suivreAchats(tx, entreprise, utilisateur, changements.map((c) => ({ collection: c.collection, cle: c.cle, avant: actuels.get(`${c.collection}/${c.cle}`)?.contenu ?? null, apres: c.contenu })));
  return resultat;
}

// ── Émettre une facture ou un avoir du dossier ──────────────────────────────────────────────────
// La série de la v10 de chaque pièce (« FAC-2026-001 », « AVO-2026-001 ») : core.js, PREFIXES.
const SERIE_V10: Record<string, string> = { facture: 'FAC', avoir: 'AVO' };
type LigneV10 = { label?: unknown; description?: unknown; qty?: unknown; unitPrice?: unknown; vatRate?: unknown; noDiscount?: unknown };
// Un nombre de la v10 à `dec` décimales au plus : lu exactement, jamais arrondi en silence (un nombre
// qui en a trop est refusé par le calcul, sur la pièce).
const decimal = (v: unknown, dec: number) => { const t = nombreEnTexte(v); depuisTexte(t, dec); return t; };

// `type` : la pièce que la route émet (chacune a son geste : un commercial émet une facture, pas un
// avoir, 03 § 2.1). Une pièce d'un autre type ne passe pas par cette route.
export async function emettreDepuisV10(tx: Transaction, entreprise: string, utilisateur: string,
  demande: { document: Json; client: Json | null; revision: number | null; rang: number | null; netAPayer: string }, type: 'facture' | 'avoir' = 'facture') {
  const db = requetes(tx);
  const doc = demande.document;
  const cle = String(doc.id ?? '');
  if (!cle || doc.type !== type) throw new Refus('ventes.seule_facture');
  // Un paiement ne se saisit qu'une fois la facture émise.
  if (Array.isArray(doc.payments) && doc.payments.length) throw new Refus('v10.reglement_sur_brouillon');
  const stocke = await db.selectFrom('socle.dossier_v10').select(['contenu', 'revision'])
    .where('entreprise', '=', entreprise).where('collection', '=', 'documents').where('cle', '=', cle).forUpdate().executeTakeFirst();
  if ((stocke ? Number(stocke.revision) : null) !== demande.revision) throw new Conflit([{ collection: 'documents', cle }]);
  if (emise(estObjet(stocke?.contenu) ? stocke.contenu : null)) throw new Refus('ventes.deja_emise');
  const client = demande.client;
  if (!client || typeof client.id !== 'string' || client.id !== doc.clientId) throw new Refus('v10.client_manquant');

  // 1. Le client, tel qu'il est aujourd'hui dans le dossier : sa fiche du serveur le suit.
  const fiche = {
    raison_sociale: String(client.name ?? '').trim() || '—', identifiant: String(client.matricule ?? '').trim() || null,
    adresse: String(client.address ?? '') || null, email: String(client.email ?? '') || null, telephone: String(client.phone ?? '') || null,
    devise: devise(client.currency),
  };
  const deja = await db.selectFrom('socle.tiers').select('id').where('entreprise', '=', entreprise).where('ref_v10', '=', client.id).executeTakeFirst();
  let tiers = deja?.id;
  if (tiers) {
    await db.updateTable('socle.tiers').set({ ...fiche, type_identifiant: fiche.identifiant ? 'matricule' : null }).where('id', '=', tiers).execute();
  } else {
    tiers = (await db.insertInto('socle.tiers').values({ entreprise, nature: 'societe', ...fiche, type_identifiant: fiche.identifiant ? 'matricule' : null, pays: 'TN', roles: ['client'], ref_v10: client.id })
      .returning('id').executeTakeFirstOrThrow()).id;
  }

  // Un avoir : la facture qu'il corrige, émise dans le dossier ET au serveur.
  let corrige: string | undefined;
  if (type === 'avoir') {
    const f = typeof doc.creditOf === 'string' && doc.creditOf !== '' ? doc.creditOf : null;
    if (!f) throw new Refus('ventes.avoir_sans_facture');
    const piece = await db.selectFrom('ventes.piece').select(['id', 'statut']).where('entreprise', '=', entreprise).where('ref_v10', '=', f).where('type', '=', 'facture').executeTakeFirst();
    if (piece?.statut !== 'emise') throw new Refus('ventes.avoir_facture_non_emise');
    corrige = piece.id;
  }

  // 2. Le brouillon du serveur, refait à partir de la pièce du dossier.
  const ancien = await db.selectFrom('ventes.piece').select(['id', 'statut']).where('entreprise', '=', entreprise).where('ref_v10', '=', cle).executeTakeFirst();
  if (ancien?.statut === 'emise') throw new Refus('ventes.deja_emise');
  if (ancien) await supprimerBrouillon(tx, entreprise, ancien.id);
  const dev = devise(doc.currency);
  const b: BrouillonSaisi = {
    type, tiers, datePiece: String(doc.date ?? ''), ...(doc.dueDate ? { echeance: String(doc.dueDate) } : {}), ...(corrige ? { corrige } : {}),
    ...(dev === 'TND' ? {} : { devise: dev, cours: decimal(doc.exchangeRate, DECIMALES.cours) }),
    tauxRemise: decimal(doc.discountRate ?? 0, DECIMALES.taux), tauxRetenue: decimal(doc.withholdingRate ?? 0, DECIMALES.taux),
    ...(doc.applyStamp === undefined ? {} : { appliquerTimbre: doc.applyStamp !== false }),
    ...(doc.subject ? { objet: String(doc.subject) } : {}), ...(doc.notes ? { notes: String(doc.notes).slice(0, 4000) } : {}),
    lignes: (Array.isArray(doc.lines) ? doc.lines as LigneV10[] : []).map((l) => ({
      designation: String(l.label ?? '').trim() || '—', ...(l.description ? { description: String(l.description) } : {}),
      quantite: decimal(l.qty ?? 0, DECIMALES.quantite), prixUnitaire: decimal(l.unitPrice ?? 0, DECIMALES.prix), tauxTva: decimal(l.vatRate ?? 0, DECIMALES.taux),
      ...(l.noDiscount ? { sansRemise: true } : {}),
    })),
  };
  const piece = await creerBrouillon(tx, utilisateur, entreprise, b);
  await db.updateTable('ventes.piece').set({ ref_v10: cle }).where('id', '=', piece).execute();

  // 3. La série de la v10 (« FAC-2026-001 », « AVO-2026-001 ») : créée au premier besoin, comme la
  //    v10 numérotait dès la première pièce.
  const prefixe = SERIE_V10[type] ?? 'FAC';
  let serie = (await db.selectFrom('socle.serie').select('id').where('entreprise', '=', entreprise).where('prefixe', '=', prefixe)
    .where('type', '=', type).where('legale', '=', true).where('active', '=', true).executeTakeFirst())?.id;
  if (!serie) serie = String((await tx.query(`select socle.creer_serie($1, $2, $3, true, null, null) id`, [entreprise, type, prefixe])).rows[0].id);

  // 4. L'émission : les contrôles, le numéro, les montants en entiers, le maillon.
  const r = await emettre(tx, utilisateur, entreprise, piece, serie);
  // Deux chemins, un chiffre : le net à payer que l'écran de la v10 a montré doit être celui que le
  // serveur scelle. Sinon rien n'est émis (et aucun numéro n'est pris : tout s'annule).
  const serveur = versTexte(r.totaux.netAPayer, r.devise.decimales);
  if (serveur !== demande.netAPayer) throw new Refus('v10.ecart_montant', { valeurs: { ecran: demande.netAPayer, serveur } });

  // 5. La pièce du dossier devient émise, avec le numéro du serveur.
  // L'instant de l'émission (`issuedTs`), la v10 le pose elle-même juste après, comme avant.
  const contenu = { ...doc, number: r.numero, status: STATUT_EMISE[type], stampFee: enNombreV10(versTexte(r.totaux.timbreBase, 3)) };
  if (stocke) {
    await db.updateTable('socle.dossier_v10').set({ contenu: JSON.stringify(contenu), revision: BigInt(Number(stocke.revision) + 1), modifie_le: new Date(), modifie_par: utilisateur })
      .where('entreprise', '=', entreprise).where('collection', '=', 'documents').where('cle', '=', cle).execute();
  } else {
    await db.insertInto('socle.dossier_v10').values({ entreprise, collection: 'documents', cle, rang: demande.rang, contenu: JSON.stringify(contenu), modifie_par: utilisateur }).execute();
  }
  return { contenu, revision: stocke ? Number(stocke.revision) + 1 : 1, numero: r.numero };
}
