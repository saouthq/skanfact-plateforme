// L'abonnement des cabinets (1.120.0 ; 0172 ; docs/abonnement.md C22 ; docs/cadrage/07-offres-et-prix.md, décidé avec
// Skander le 23/10/2026). Le cabinet paie pour les dossiers qu'il TIENT lui-même au-delà des gratuits, jamais pour un
// client abonné ; une facture par an à son anniversaire, et un rattrapage au prorata pour un dossier ajouté en cours
// d'année. La facture se prépare ET s'émet par le serveur, au nom de la propriétaire de l'entreprise SkanFact, comme la
// facture au choix (serveur/abonnement/facturier.ts) : tout dans une transaction ; un refus garde son motif pour la
// console, et se retente le lendemain. Le calcul est celui de la base (plateforme.calcul_facture_cabinet), qui le
// revérifie en notant la facture : ici, on ne fait que l'écrire sur la pièce.
//
// Ce qui part chez la TTN avec cette facture, compté et décidé : le nom du cabinet et l'adresse d'un associé (la fiche du
// client), la période, le nombre de dossiers et les montants. Jamais le nom des clients du cabinet.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { motif as texteDe, rendre, t } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import { enTantQue, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { appliquer, dossierPret, emettreDepuisV10 } from '../v10/dossier.ts';
import { enNombreV10, type Json } from '../v10/lecture.ts';
import { demanderPaiementCabinet } from '../v10/paiement.ts';
import { nettoyerClient, nettoyerSociete, vueDePiece, type PieceLue } from '../ventes/espace.ts';
import { jourEnFrancais } from './etat.ts';
import { tvaDeLaFiche } from './factures.ts';
import './textes.ts';

// Ce que la base calcule pour une période (les montants en millimes, en texte).
export type CalculCabinet = {
  debut: string; fin: string; echeance: string; prixHt: string; plafondHt: string | null; gratuits: number | null;
  dossiers: { id: string; nom: string }[];
  rattrapages: { id: string; nom: string; du: string; au: string; jours: number; sur: number; montantHt: string }[];
  brutHt: string; totalHt: string; plafonne: boolean;
};
const millimes = (v: unknown): bigint => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : 0n);
const enFrancais = (cle: string, valeurs?: Record<string, string>) => rendre(t(cle, valeurs), 'fr');
const dt = (v: string) => enNombreV10(versTexte(millimes(v), 3));

// La pièce de la facture d'une période, dans le dossier de l'entreprise SkanFact. Plafonnée, une seule ligne : le plafond.
// Sinon les dossiers payants au premier jour (au prix du jour), et chaque rattrapage sur sa ligne. Les dossiers se
// comptent, ils ne se nomment pas.
export function pieceDuCabinet(o: { cle: string; client: Json; calcul: CalculCabinet; jour: string; societe: Json }): Json {
  const c = o.calcul;
  const tva = tvaDeLaFiche(o.societe);
  const du = jourEnFrancais(c.debut), au = jourEnFrancais(c.fin);
  const lignes = c.plafonne
    ? [{ label: enFrancais('abonnement.cabinet.facture.plafond'),
      description: enFrancais('abonnement.cabinet.facture.plafond_detail', { du, au, dossiers: String(c.dossiers.length), rattrapes: String(c.rattrapages.length) }),
      unit: '', qty: 1, unitPrice: dt(c.plafondHt ?? '0'), vatRate: tva }]
    : [
      ...(c.dossiers.length ? [{ label: enFrancais('abonnement.cabinet.facture.dossiers', { gratuits: String(c.gratuits ?? 0) }),
        description: enFrancais('abonnement.cabinet.facture.periode', { du, au }), unit: '', qty: c.dossiers.length, unitPrice: dt(c.prixHt), vatRate: tva }] : []),
      ...c.rattrapages.map((r) => ({ label: enFrancais('abonnement.cabinet.facture.rattrapage'),
        description: enFrancais('abonnement.cabinet.facture.rattrapage_detail', { du: jourEnFrancais(r.du), au: jourEnFrancais(r.au), jours: String(r.jours), sur: String(r.sur) }),
        unit: '', qty: 1, unitPrice: dt(r.montantHt), vatRate: tva })),
    ];
  return {
    id: o.cle, type: 'facture', number: '', status: 'brouillon', date: o.jour, dueDate: c.echeance,
    clientId: o.client.id, subject: enFrancais('abonnement.cabinet.facture.objet', { du, au }), reference: '',
    lines: lignes, discountRate: 0, withholdingRate: 0, applyStamp: !(o.client.stampExempt === true), notes: '', payments: [],
    lang: 'fr', currency: 'DT', exchangeRate: '', createdAt: Date.now(),
  };
}

const lire = async (tx: Transaction, entreprise: string, collection: string, cle: string) =>
  (await tx.query('select contenu, revision from socle.dossier_v10 where entreprise = $1 and collection = $2 and cle = $3 for update',
    [entreprise, collection, cle])).rows[0] as { contenu: Json; revision: string } | undefined;

// Facturer la période d'un cabinet, dans la transaction de la propriétaire de l'entreprise SkanFact. Rend le numéro de la
// facture émise, ou « vide » quand il n'y a rien à facturer (plus aucun dossier payant ni rattrapage).
export async function facturerUnCabinet(tx: Transaction, cabinet: string, debut: string, utilisateur: string, jour: string): Promise<string> {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`facture-cabinet:${cabinet}`]);
  const lu = (await tx.query('select plateforme.facture_cabinet_pour($1, $2::date, $3::date) v', [cabinet, debut, jour])).rows[0]?.v as
    { cabinet: { nom: string; email: string | null } | null; client: string | null; calcul: CalculCabinet | null };
  if (!lu.cabinet) throw new Refus('commun.introuvable');
  if (!lu.calcul) throw new Refus('abonnement.cabinet.sans_prix');
  if (millimes(lu.calcul.totalHt) === 0n) return 'vide';
  const editeur = String((await tx.query('select plateforme.editeur_de_mes_factures() v')).rows[0]?.v);
  await dossierPret(tx, editeur, utilisateur);
  const societe = (await lire(tx, editeur, '_racine', 'company'))?.contenu ?? {};
  const cle = `cabinet-${cabinet}-${debut}`;
  const deja = await lire(tx, editeur, 'documents', cle);
  if (deja) {
    const numero = typeof deja.contenu.number === 'string' ? deja.contenu.number : '';
    throw numero ? new Refus('abonnement.facture.deja_emise', { valeurs: { numero } }) : new Refus('abonnement.facture.deja_preparee');
  }
  // La fiche du client : celle de ses factures d'avant si elle est encore au dossier, sinon une fiche neuve.
  const fiche = lu.client ? await lire(tx, editeur, 'clients', lu.client) : undefined;
  const client: Json = fiche?.contenu ?? { id: randomUUID(), name: lu.cabinet.nom, matricule: '', address: '', email: lu.cabinet.email ?? '', phone: '', currency: '' };
  if (!fiche) {
    const { n } = (await tx.query("select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'clients'", [editeur])).rows[0] as { n: number };
    await appliquer(tx, editeur, utilisateur, [{ collection: 'clients', cle: String(client.id), rang: n, revision: null, contenu: client }], { serveur: true });
  }
  const piece = pieceDuCabinet({ cle, client, calcul: lu.calcul, jour, societe });
  await appliquer(tx, editeur, utilisateur, [{ collection: 'documents', cle, rang: null, revision: null, contenu: piece }], { serveur: true });
  await tx.query('select plateforme.noter_facture_cabinet($1, $2::date, $3::date, $4, $5, $6::bigint, $7::uuid[], $8::uuid[])',
    [cabinet, debut, jour, cle, String(client.id), lu.calcul.totalHt, lu.calcul.dossiers.map((d) => d.id), lu.calcul.rattrapages.map((r) => r.id)]);
  const ecrite = await lire(tx, editeur, 'documents', cle);
  if (!ecrite) throw new Refus('abonnement.facture.deja_preparee');
  const r = await emettreDepuisV10(tx, editeur, utilisateur, { document: ecrite.contenu, client, revision: Number(ecrite.revision), rang: null, netAPayer: null });
  return String(r.numero);
}

// Le tour : chaque période de cabinet à facturer (ou celle d'un cabinet, juste après un dossier créé), chacune dans sa
// transaction ; un refus n'arrête pas les autres.
type AFacturer = { cabinet: string; debut: string; proprietaire: string };
export async function facturerLesCabinets(ctx: Contexte, o: { cabinet?: string; maintenant?: Date } = {}): Promise<{ periodes: number; emises: number; vides: number; refusees: number }> {
  const jour = aujourdhuiATunis(o.maintenant ?? ctx.maintenant?.() ?? new Date());
  const liste = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select plateforme.cabinets_a_facturer($1, $2::date) v', [o.cabinet ?? null, jour])).rows[0].v as AFacturer[]);
  let emises = 0, vides = 0, refusees = 0;
  const noter = (a: AFacturer, vide: boolean, motif: string) => enTantQue(ctx.pool, null, async (tx) => {
    await tx.query('select plateforme.facture_cabinet_refus_noter($1, $2::date, $3, $4)', [a.cabinet, a.debut, vide, motif]);
  });
  for (const a of liste) {
    try {
      const r = await enTantQue(ctx.pool, a.proprietaire, (tx) => facturerUnCabinet(tx, a.cabinet, a.debut, a.proprietaire, jour));
      if (r === 'vide') { vides++; await noter(a, true, rendre(texteDe('abonnement.cabinet.rien_a_facturer'), 'fr')); } else emises++;
    } catch (e) {
      refusees++;
      const motif = e instanceof Refus ? e.message : rendre(texteDe('commun.erreur_serveur'), 'fr');
      if (!(e instanceof Refus)) console.error(e);
      await noter(a, false, motif);
    }
  }
  return { periodes: liste.length, emises, vides, refusees };
}

// Juste après un dossier tenu créé : le tour de CE cabinet part sans attendre la minute (là où la facture au choix est
// branchée ; sinon, rien ne se facture seul).
export function facturerCabinetBientot(ctx: Contexte, cabinet: string): void {
  if (!ctx.factureAuChoix) return;
  setTimeout(() => { facturerLesCabinets(ctx, { cabinet }).catch((e: unknown) => { console.error(`la facture du cabinet n'est pas partie : ${String(e)}`); }); }, 400);
}

// ── Ce que l'associé lit et règle (Réglages du Cabinet, « Ton abonnement ») ─────────────────────────────────────────
type Lu = {
  etat: Record<string, unknown>; depuis: string | null; payeJusquAu: string | null;
  regles: { prixHt: string | null; gratuits: number | null; plafondHt: string | null; delai: number | null; grace: number | null };
  dossiers: { id: string; nom: string; payant: boolean }[]; abonnes: number;
  prochaine: CalculCabinet | null; prochainDossier: { rang: number; payant: boolean; prixHt: string | null; abonne: boolean };
  factures: { entreprise: unknown; client: unknown; pieces: PieceLue[] } | null; paiement: boolean;
};
const enDinars = (v: string | null | undefined) => (v === null || v === undefined ? null : versTexte(millimes(v), 3));
const calculEnDinars = (c: CalculCabinet | null) => (c ? {
  debut: c.debut, fin: c.fin, echeance: c.echeance, prixHt: enDinars(c.prixHt), plafondHt: enDinars(c.plafondHt), gratuits: c.gratuits,
  dossiers: c.dossiers.length, dossiersHt: enDinars(String(millimes(c.prixHt) * BigInt(c.dossiers.length))), rattrapages: c.rattrapages.map((r) => ({ du: r.du, au: r.au, jours: r.jours, sur: r.sur, montantHt: enDinars(r.montantHt) })),
  brutHt: enDinars(c.brutHt), totalHt: enDinars(c.totalHt), plafonne: c.plafonne,
} : null);

export function routesAbonnementCabinet(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const uuid = z.string().uuid();

  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/abonnement', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.cabinet).success) return { statut: 404, corps: { motif: texteDe('commun.introuvable') } };
      const jour = aujourdhuiATunis();
      const lu = (await tx.query('select plateforme.mon_abonnement_cabinet($1, $2::date) v', [params.cabinet, jour])).rows[0].v as Lu;
      return { corps: {
        aujourdhui: jour, etat: lu.etat, depuis: lu.depuis, payeJusquAu: lu.payeJusquAu,
        regles: { ...lu.regles, prixHt: enDinars(lu.regles.prixHt), plafondHt: enDinars(lu.regles.plafondHt) },
        dossiers: lu.dossiers, abonnes: lu.abonnes, prochaine: calculEnDinars(lu.prochaine),
        prochainDossier: { ...lu.prochainDossier, prixHt: enDinars(lu.prochainDossier.prixHt) },
        factures: lu.factures ? {
          entreprise: nettoyerSociete(lu.factures.entreprise), client: nettoyerClient(lu.factures.client),
          pieces: lu.factures.pieces.map((p) => ({ ...vueDePiece(p, lu.paiement, jour), periode: (p as unknown as { periode?: unknown }).periode ?? null })),
        } : null,
        enLigne: lu.paiement,
      } };
    },
  });

  // Payer en ligne une facture du cabinet : le reste, par le prestataire de l'entreprise SkanFact (le même chemin que
  // celui d'une entreprise abonnée).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/abonnement/payer', geste: 'compte.cabinet.gerer',
    corps: z.object({ numero: z.string().min(1).max(60) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.cabinet).success) return { statut: 404, corps: { motif: texteDe('commun.introuvable') } };
      const r = await demanderPaiementCabinet(ctx, qui.utilisateur, params.cabinet ?? '', corps.numero);
      if (!r) return { statut: 404, corps: { motif: texteDe('abonnement.facture.inconnue') } };
      if ('refus' in r) return { statut: r.statut, corps: { motif: r.refus } };
      return { corps: { adresse: r.adresse } };
    },
  });

  return routes;
}
