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

import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { rendre, t } from '../../textes/index.ts';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { requetes, type Transaction } from '../base.ts';
import { Perimee, Refus } from '../erreurs.ts';
import { REGLEMENTS_VENTES, tenirReglements } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { creerBrouillon, DECIMALES, emettre, supprimerBrouillon, type BrouillonSaisi } from '../ventes/pieces.ts';
import { controlerCommandes, controlerEncours, controlerRemise } from './accords.ts';
import { mesRoles, verifierEcriture } from './droits.ts';
import { suivreAchats } from './achats.ts';
import { suivrePaie } from './paie.ts';
import { reecrireLesAchats } from '../compta/achats.ts';
import { reecrireLaPaie } from '../compta/paie.ts';
import { planChange } from '../compta/suivre.ts';
import { ecrireFamilleDeVente, reecrireLesVentes } from '../compta/ventes.ts';
import { canonique, deviseV10 as devise, enNombreV10, estObjet, lirePaiements, nombreEnTexte, type Json } from './lecture.ts';
import { commeLaV10, ecartAvecLeServeur, fichierTeif, manquesAvantNumero } from './teif.ts';
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
// facture émise ne s'annule pas : un avoir total la solde, et « annulée » se déduit (01 § 7). Les bons
// de livraison qu'une facture regroupe (brique 86) s'impriment sur elle et décident que le stock ne
// sort pas une seconde fois : ils sont scellés avec elle.
const PIECES_LEGALES = ['facture', 'avoir'];
const SCELLE = ['type', 'number', 'date', 'clientId', 'currency', 'exchangeRate', 'lines', 'discountRate', 'withholdingRate', 'applyStamp', 'bonsLivraison', 'stampFee', 'creditOf', 'creditReason'];
// Le statut d'une pièce émise, tel que la v10 l'écrit (STATUSES de core.js).
const STATUT_EMISE: Record<string, string> = { facture: 'envoyée', avoir: 'émis' };
const emise = (d: Json | null) => !!d && typeof d.number === 'string' && d.number !== '' && d.status !== 'brouillon';

function verifierPiece(avant: Json | null, apres: Json | null, serveur: boolean) {
  const type = String((apres ?? avant)?.type ?? '');
  if (!PIECES_LEGALES.includes(type)) return;
  // La référence de la TTN et son code QR (brique 83) : seul le serveur les pose, quand la TTN accepte la
  // pièce ; personne ne les écrit ni ne les change depuis un écran (une référence inventée s'imprimerait).
  if (!serveur && apres && canonique(avant?.ttn) !== canonique(apres.ttn)) {
    throw new Refus('v10.ttn_par_le_serveur', { valeurs: { numero: String(avant?.number ?? apres.number ?? '') } });
  }
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
  // Les écritures de sa famille (brique 32) : ses encaissements, et ses avoirs qui en dépendent.
  await ecrireFamilleDeVente(tx, entreprise, piece.id);
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
    await db.insertInto('socle.dossier_v10').values({ entreprise, collection: o.collection, cle: o.cle, rang: o.collection === '_racine' ? null : i - 1, contenu: JSON.stringify(o.contenu), modifie_par: utilisateur, cree_par: utilisateur }).execute();
  }
  // Un client amorcé est le même que sa fiche du serveur : son identifiant v10 est le sien.
  for (const t of tiers) await db.updateTable('socle.tiers').set({ ref_v10: t.id }).where('id', '=', t.id).execute();
}

// Les champs de la racine d'abord, puis les listes, dans un ordre qui ne dépend pas de la langue de la base : une
// base en « en_US » ignore le « _ » et rangeait « _racine » après « accounts » ou « catalog » ; la liste vide qu'un
// écran avait enregistrée là (`_racine/accounts` = []) passait alors après les objets de la liste, et la page ne les
// voyait plus (puis les supprimait en enregistrant : le compte Konnect du jalon J2).
export async function lireDossier(tx: Transaction, entreprise: string, utilisateur: string): Promise<Objet[]> {
  const lire = () => requetes(tx).selectFrom('socle.dossier_v10').select(['collection', 'cle', 'rang', 'contenu', 'revision'])
    .where('entreprise', '=', entreprise).orderBy(sql`collection <> '_racine'`).orderBy(sql`collection collate "C"`).orderBy('rang').orderBy(sql`cle collate "C"`).execute();
  let lignes = await lire();
  if (!lignes.length) { await amorcer(tx, entreprise, utilisateur); lignes = await lire(); }
  return lignes.map((l) => ({ collection: l.collection, cle: l.cle, rang: l.rang, contenu: l.contenu, revision: Number(l.revision) }));
}

// ── Relire par différence (brique 119 ; 0059 ; docs/leger.md, S4) ───────────────────────────────────────────────
// La marque d'une lecture : la plus petite transaction encore en cours (« xmin ») ; la base : l'identité de cette base.
// Prise AVANT de lire : ce qui s'écrit pendant la lecture a un numéro au moins égal, et sera relu la fois suivante.
export async function marqueDeLecture(tx: Transaction): Promise<{ marque: string; avenir: string; base: string }> {
  const r = (await tx.query(`select pg_snapshot_xmin(s)::text marque, pg_snapshot_xmax(s)::text avenir, (select id from socle.instance limit 1)::text base
    from pg_current_snapshot() s`)).rows[0];
  return { marque: String(r.marque), avenir: String(r.avenir), base: String(r.base) };
}
// Ce qui a changé depuis une marque : les objets écrits par une transaction au moins aussi récente, et ce qui a été
// retiré. Un numéro « de l'avenir » (une entreprise restaurée d'une autre base) n'entre pas dans une différence : le
// poste l'a reçu à sa lecture entière.
export async function lireDepuis(tx: Transaction, entreprise: string, depuis: string, avenir: string) {
  const objets = (await tx.query(`select collection, cle, rang, contenu, revision from socle.dossier_v10
     where entreprise = $1 and xid >= $2::xid8 and xid < $3::xid8`, [entreprise, depuis, avenir])).rows
    .map((l) => ({ collection: String(l.collection), cle: String(l.cle), rang: l.rang === null ? null : Number(l.rang), contenu: l.contenu as unknown, revision: Number(l.revision) }));
  const retires = (await tx.query(`select collection, cle from socle.dossier_v10_retire where entreprise = $1 and xid >= $2::xid8`, [entreprise, depuis])).rows
    .map((l) => ({ collection: String(l.collection), cle: String(l.cle) }));
  return { objets, retires };
}

// ── Enregistrer des changements ─────────────────────────────────────────────────────────────────
// `serveur` : l'écriture vient du serveur lui-même (la référence de la TTN posée à l'acceptation, brique 83).
export async function appliquer(tx: Transaction, entreprise: string, utilisateur: string, changements: Changement[], options: { serveur?: boolean } = {}): Promise<{ collection: string; cle: string; revision: number | null }[]> {
  const db = requetes(tx);
  // Chaque partie s'écrit selon le geste de son module (brique 99) ; le serveur lui-même n'a pas de rôle.
  if (!options.serveur) verifierEcriture(await mesRoles(tx, entreprise), changements);
  const actuels = new Map<string, { contenu: unknown; revision: number; creePar: string | null }>();
  const conflits: { collection: string; cle: string }[] = [];
  for (const c of changements) {
    const a = await db.selectFrom('socle.dossier_v10').select(['contenu', 'revision', 'cree_par'])
      .where('entreprise', '=', entreprise).where('collection', '=', c.collection).where('cle', '=', c.cle).forUpdate().executeTakeFirst();
    if ((a ? Number(a.revision) : null) !== c.revision) conflits.push({ collection: c.collection, cle: c.cle });
    if (a) actuels.set(`${c.collection}/${c.cle}`, { contenu: a.contenu, revision: Number(a.revision), creePar: a.cree_par });
  }
  // Rien n'est écrit tant qu'un seul objet a changé ailleurs : on ne mélange jamais deux versions.
  if (conflits.length) throw new Conflit(conflits);
  // Supprimer un brouillon : les siens (brique 117 ; 03 § 1). Dit avec le nom de l'auteur, avant que la base ne le refuse.
  if (!options.serveur) await verifierAuteurs(tx, entreprise, utilisateur, changements, actuels);
  // Une commande fournisseur qui part au-delà du seuil de l'entreprise : l'accord d'un responsable (brique 114).
  if (!options.serveur) {
    await controlerCommandes(tx, entreprise, changements.map((c) => ({ collection: c.collection, cle: c.cle, avant: actuels.get(`${c.collection}/${c.cle}`)?.contenu ?? null, apres: c.contenu })));
  }
  const resultat: { collection: string; cle: string; revision: number | null }[] = [];
  for (const c of changements) {
    const a = actuels.get(`${c.collection}/${c.cle}`);
    if (c.collection === 'documents') {
      verifierPiece(estObjet(a?.contenu) ? a.contenu : null, estObjet(c.contenu) ? c.contenu : null, options.serveur === true);
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
      await db.insertInto('socle.dossier_v10').values({ entreprise, collection: c.collection, cle: c.cle, rang: c.rang, contenu: JSON.stringify(c.contenu), modifie_par: utilisateur, cree_par: utilisateur }).execute();
      resultat.push({ collection: c.collection, cle: c.cle, revision: 1 });
    }
    // Une pièce qui change, ou qui disparaît, laisse sa trace ; le reste du dossier se relit par ses révisions.
    if (c.collection === 'documents') {
      await tracer(tx, entreprise, c.contenu === null ? 'v10.piece.supprimer' : 'v10.piece.modifier', { type: 'piece_v10', id: null }, a ? { cle: c.cle, revision: a.revision } : null, c.contenu === null ? null : { cle: c.cle });
    }
  }
  // Les achats et les fournisseurs, puis la paie, une fois TOUT l'envoi écrit : une pièce rattachée et
  // sa facture, un achat et son fournisseur, un bulletin et son salarié arrivent souvent ensemble
  // (0013, serveur/v10/achats.ts ; 0014, serveur/v10/paie.ts).
  const lus = changements.map((c) => ({ collection: c.collection, cle: c.cle, avant: actuels.get(`${c.collection}/${c.cle}`)?.contenu ?? null, apres: c.contenu }));
  await suivreAchats(tx, entreprise, utilisateur, lus);
  await suivrePaie(tx, entreprise, utilisateur, lus);
  // Le plan comptable changé (comptes, auxiliaires, trésorerie) : tout le brouillard le suit (D3).
  if (await planChange(tx, entreprise, lus)) {
    await reecrireLesVentes(tx, entreprise);
    await reecrireLesAchats(tx, entreprise);
    await reecrireLaPaie(tx, entreprise);
  }
  return resultat;
}

// ── Supprimer un brouillon : les siens (brique 117 ; 03 § 1 ; 0058) ─────────────────────────────────────────
// Une pièce de vente, une commande fournisseur ou une réception ne se supprime que par son auteur, le propriétaire ou
// un administrateur. Un objet sans auteur connu (d'avant cette règle) : seul un responsable le supprime.
export const PARTIES_A_AUTEUR = ['documents', 'supplierOrders', 'receptions'];
async function verifierAuteurs(tx: Transaction, entreprise: string, utilisateur: string, changements: Changement[],
  actuels: Map<string, { contenu: unknown; creePar: string | null }>) {
  const suppressions = changements.filter((c) => c.contenu === null && PARTIES_A_AUTEUR.includes(c.collection))
    .map((c) => ({ c, a: actuels.get(`${c.collection}/${c.cle}`) })).filter((x) => x.a && x.a.creePar !== utilisateur);
  if (!suppressions.length) return;
  if ((await tx.query(`select socle.mes_roles($1) && array['proprietaire', 'administrateur'] r`, [entreprise])).rows[0]?.r) return;
  const { a } = suppressions[0] as { a: { contenu: unknown; creePar: string | null } };
  const auteur = a.creePar ? String((await tx.query('select nom from socle.utilisateur where id = $1', [a.creePar])).rows[0]?.nom ?? '') : '';
  const contenu = estObjet(a.contenu) ? a.contenu : {};
  const numero = typeof contenu.number === 'string' && contenu.number ? contenu.number : '';
  throw new Refus(auteur ? 'v10.supprimer_le_sien' : 'v10.supprimer_sans_auteur', { valeurs: { piece: numero || rendre(t('v10.ce_brouillon'), 'fr'), auteur } });
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
// `ticket` (brique 115) : un ticket de caisse, par sa route à lui ; il a sa série (TIC) et peut se vendre à un passant
// (le client « Vente au comptoir »). Une facture marquée ticket ne passe pas par la route des factures, ni l'inverse.
export async function emettreDepuisV10(tx: Transaction, entreprise: string, utilisateur: string,
  demande: { document: Json; client: Json | null; revision: number | null; rang: number | null; netAPayer: string }, type: 'facture' | 'avoir' = 'facture',
  options: { ticket?: boolean; retour?: boolean } = {}) {
  const db = requetes(tx);
  const doc = demande.document;
  const cle = String(doc.id ?? '');
  if (!cle || doc.type !== type) throw new Refus('ventes.seule_facture');
  const ticket = options.ticket === true;
  if (ticket !== (doc.ticket === true)) throw new Refus(ticket ? 'caisse.pas_un_ticket' : 'v10.ticket_par_la_caisse');
  // Un paiement ne se saisit qu'une fois la facture émise.
  if (Array.isArray(doc.payments) && doc.payments.length) throw new Refus('v10.reglement_sur_brouillon');
  const stocke = await db.selectFrom('socle.dossier_v10').select(['contenu', 'revision'])
    .where('entreprise', '=', entreprise).where('collection', '=', 'documents').where('cle', '=', cle).forUpdate().executeTakeFirst();
  if ((stocke ? Number(stocke.revision) : null) !== demande.revision) throw new Conflit([{ collection: 'documents', cle }]);
  if (emise(estObjet(stocke?.contenu) ? stocke.contenu : null)) throw new Refus('ventes.deja_emise');
  // Un ticket sans client se vend « au comptoir » : une fiche à part, la même pour tous les passants. Le retour d'un tel
  // ticket (brique 124) aussi.
  const retour = options.retour === true && type === 'avoir';
  const comptoir = (ticket || retour) && !doc.clientId;
  const client: Json | null = comptoir ? { id: '__comptoir', name: rendre(t('caisse.comptoir'), 'fr') } : demande.client;
  if (!client || typeof client.id !== 'string' || (!comptoir && client.id !== doc.clientId)) throw new Refus('v10.client_manquant');
  // La facture électronique (brique 80) : la fiche de l'entreprise dit si elle y est soumise. Soumise, une
  // pièce dont le fichier TEIF serait refusé (un matricule, l'identifiant du client) ne s'émet pas : c'est
  // dit AVANT le numéro (un numéro pris ne se reprend pas).
  const societe = commeLaV10((await db.selectFrom('socle.dossier_v10').select('contenu')
    .where('entreprise', '=', entreprise).where('collection', '=', '_racine').where('cle', '=', 'company').executeTakeFirst())?.contenu ?? {}) as Json;
  if (societe.efacture === true && !doc.ticket && !retour) {
    const manques = manquesAvantNumero(commeLaV10(doc) as Json, commeLaV10(client) as Json, societe);
    if (manques.length) throw new Refus('efacture.manques', { valeurs: { manques: manques.map((m) => m.message).join(' ') } });
  }

  // L'encours autorisé du client (brique 98 ; 03 D11) : au-delà, une facture ne s'émet qu'avec l'accord d'un
  // responsable, quand l'entreprise le demande. Dit AVANT le numéro.
  // La remise au-delà du seuil de l'entreprise (brique 103) : de même, l'accord d'un responsable.
  // (Un ticket est payé dans le geste : pas d'encours ; sa remise relève de la caisse, 03 § 2.1.)
  const accordRemise = type === 'facture' && !ticket ? await controlerRemise(tx, entreprise, cle, doc) : null;
  const accord = type === 'facture' && !ticket ? await controlerEncours(tx, entreprise, cle, doc) : null;

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
  const prefixe = ticket ? 'TIC' : SERIE_V10[type] ?? 'FAC';
  // Créée au premier besoin par l'émission elle-même (brique 99) : un commercial n'a pas à créer la série.
  // Le retour à la caisse (brique 124) : la série des avoirs, que le caissier prend aussi pour ce geste-là.
  const serie = retour ? String((await tx.query('select caisse.serie_retour($1) id', [entreprise])).rows[0].id)
    : String((await tx.query('select ventes.serie_v10($1, $2, $3) id', [entreprise, type, prefixe])).rows[0].id);

  // 4. L'émission : les contrôles, le numéro, les montants en entiers, le maillon.
  const r = await emettre(tx, utilisateur, entreprise, piece, serie);
  // Deux chemins, un chiffre : le net à payer que l'écran de la v10 a montré doit être celui que le
  // serveur scelle. Sinon rien n'est émis (et aucun numéro n'est pris : tout s'annule).
  const serveur = versTexte(r.totaux.netAPayer, r.devise.decimales);
  if (serveur !== demande.netAPayer) throw new Refus('v10.ecart_montant', { valeurs: { ecran: demande.netAPayer, serveur } });

  // 5. La pièce du dossier devient émise, avec le numéro du serveur.
  // L'instant de l'émission (`issuedTs`), la v10 le pose elle-même juste après, comme avant.
  const contenu = { ...doc, number: r.numero, status: STATUT_EMISE[type], stampFee: enNombreV10(versTexte(r.totaux.timbreBase, 3)),
    // La pièce émise avec un accord porte les deux noms (03 D11).
    ...(accord ? { accordEncours: accord } : {}), ...(accordRemise ? { accordRemise } : {}) };
  // 6. Le fichier de la facture électronique, écrit maintenant et gardé (jamais réécrit) ; ses montants
  //    sont ceux que le serveur vient de sceller, sinon rien n'est émis. Une entreprise non soumise dont
  //    la fiche ne permet pas le fichier émet quand même : il s'écrira à la main, comme dans la v10.
  if (!doc.ticket && !retour) {
    const origine = corrige && typeof doc.creditOf === 'string' ? (await db.selectFrom('socle.dossier_v10').select('contenu')
      .where('entreprise', '=', entreprise).where('collection', '=', 'documents').where('cle', '=', doc.creditOf).executeTakeFirst())?.contenu ?? null : null;
    const f = fichierTeif(commeLaV10(contenu) as Json, commeLaV10(client) as Json, societe, origine ? commeLaV10(origine) as Json : null);
    if (f.ok) {
      const dec = r.devise.decimales;
      const ecart = ecartAvecLeServeur(f.xml, { ttc: versTexte(r.totaux.totalTTC, dec), tva: versTexte(r.totaux.totalTVA, dec), ht: versTexte(r.totaux.netHT, dec) });
      if (ecart) throw new Refus('efacture.ecart', { valeurs: ecart });
      await tx.query(`insert into ventes.efacture (piece, entreprise, nom, xml, empreinte, version, ecrit_le, ecrit_par)
        values ($1, $2, $3, $4, $5, $6, now(), $7)`, [piece, entreprise, f.nom, f.xml, createHash('sha256').update(f.xml, 'utf8').digest('hex'), f.version, utilisateur]);
    }
  }

  if (stocke) {
    await db.updateTable('socle.dossier_v10').set({ contenu: JSON.stringify(contenu), revision: BigInt(Number(stocke.revision) + 1), modifie_le: new Date(), modifie_par: utilisateur })
      .where('entreprise', '=', entreprise).where('collection', '=', 'documents').where('cle', '=', cle).execute();
  } else {
    await db.insertInto('socle.dossier_v10').values({ entreprise, collection: 'documents', cle, rang: demande.rang, contenu: JSON.stringify(contenu), modifie_par: utilisateur, cree_par: utilisateur }).execute();
  }
  return { contenu, revision: stocke ? Number(stocke.revision) + 1 : 1, numero: r.numero };
}
