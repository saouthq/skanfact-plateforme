// L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1) : ce que le client d'une entreprise
// voit par son lien. La base choisit les pièces (0046, `ventes.espace` : ses factures et avoirs émis,
// jamais un brouillon ni le client d'à côté) ; ici, on dit ce qu'il en doit (la même fonction que la
// liste des ventes : un seul chiffre) et on ne laisse partir que ce qu'une pièce imprime.
//
// Ce qui part vers le client, compté et décidé (30/09/2026, par délégation) : des LISTES FERMÉES, tirées
// de ce que lit le gabarit d'impression de la v10 (`documentHtml`) pour une facture ou un avoir. Un champ
// ajouté demain à une pièce, une fiche société ou une fiche client reste dans l'entreprise tant qu'il
// n'est pas ajouté ici. Restent donc dans l'entreprise, entre autres : le prix de revient et l'article
// d'une ligne, les paiements (seul leur total compte, et le serveur le calcule), les e-mails envoyés,
// les relances, les pièces jointes, l'affaire, la caisse ; l'adresse du comptable, l'objectif de chiffre
// d'affaires et les réglages de l'application ; les notes et le plafond de crédit d'un client.

import { versTexte } from '../../moteur/argent.ts';
import { soldeFacture, statutFacture } from '../../moteur/reglements.ts';
import { enTantQue } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { aujourdhuiATunis } from '../reglements.ts';

export const CHAMPS_SOCIETE = [
  'name', 'matricule', 'rc', 'capital', 'address', 'phone', 'email', 'website', 'rib', 'bank', 'logo', 'footer', 'tagline',
  'stampImage', 'stampFee', 'primaryColor', 'accentColor', 'currency', 'defaultLang', 'paymentTerms', 'paymentTermsEn',
  'activity', 'taxRegime',
  // Les conditions d'un devis (« Pour accepter ce devis… ») : il les imprime (le devis par son lien, 06/10/2026).
  'quoteTerms', 'quoteTermsEn',
] as const;
export const CHAMPS_CLIENT = ['name', 'matricule', 'address', 'email', 'phone', 'contact'] as const;
export const CHAMPS_PIECE = [
  'type', 'number', 'date', 'dueDate', 'status', 'lang', 'currency', 'exchangeRate', 'subject', 'reference', 'notes',
  'deposit', 'settles', 'fromQuoteNumber', 'creditOfNumber', 'creditReason', 'regimeTva', 'exonerationRS',
  'discountRate', 'applyStamp', 'stampFee', 'withholdingRate', 'lines', 'ttn',
] as const;
export const CHAMPS_LIGNE = ['label', 'description', 'qty', 'unit', 'unitPrice', 'vatRate', 'noDiscount'] as const;
// Ce qu'une pièce imprime de l'acompte, du solde d'un devis, de l'exonération de retenue figée, et de la
// facture électronique acceptée par la TTN (sa référence et le contenu de son code QR, brique 83).
export const SOUS_CHAMPS = { deposit: ['percent', 'montant', 'quoteNumber'], settles: ['quoteNumber'], exonerationRS: ['numero', 'au'], ttn: ['reference', 'qr'] } as const;

type Objet = Record<string, unknown>;
const objet = (o: unknown): o is Objet => !!o && typeof o === 'object' && !Array.isArray(o);
const garder = (o: unknown, champs: readonly string[]): Objet => {
  const source = objet(o) ? o : {};
  return Object.fromEntries(champs.filter((k) => k in source).map((k) => [k, source[k]]));
};
export const nettoyerSociete = (societe: unknown) => garder(societe, CHAMPS_SOCIETE);
export const nettoyerClient = (client: unknown) => garder(client, CHAMPS_CLIENT);
// Une pièce, réduite à ce qu'elle imprime. Un sous-objet vide ou absent (une exonération figée à
// « aucune ») garde sa valeur : le gabarit la lit comme telle.
export function nettoyerPiece(document: unknown): Objet {
  const d = garder(document, CHAMPS_PIECE);
  for (const [cle, champs] of Object.entries(SOUS_CHAMPS)) if (objet(d[cle])) d[cle] = garder(d[cle], champs);
  if (Array.isArray(d.lines)) d.lines = d.lines.map((l) => garder(l, CHAMPS_LIGNE));
  return d;
}

type PieceLue = {
  id: string; type: 'facture' | 'avoir'; numero: string; date: string; echeance: string | null; devise: string; decimales: number;
  net: string; avoirs: string[]; reglements: string[]; document: unknown;
};
type DevisLu = { id: string; numero: string | null; document: unknown };
type Lu = { lien: 'piece' | 'compte'; entreprise: unknown; client: unknown; paiement: boolean; pieces: PieceLue[]; devis: DevisLu[] };

// L'état d'un devis tel que le client le lit : la règle de la v10 (`effectiveStatus`) — un devis envoyé dont la
// date de validité est passée sans réponse est expiré.
export function etatDevis(document: unknown, aujourdhui: string): 'en_attente' | 'expire' | 'accepte' | 'refuse' {
  const d = objet(document) ? document : {};
  if (d.status === 'accepté') return 'accepte';
  if (d.status === 'refusé') return 'refuse';
  return typeof d.dueDate === 'string' && d.dueDate !== '' && d.dueDate < aujourdhui ? 'expire' : 'en_attente';
}

// « Payer en ligne » (brique 78) : une facture qui doit encore, en dinars, chez une entreprise qui l'accepte.
// UNE définition : l'espace du client, et la phrase du lien qu'un envoi lui porte (brique 79).
export function payableEnLigne(type: string, devise: string, reste: bigint | null, paiement: boolean): boolean {
  return type === 'facture' && reste !== null && reste > 0n && devise === 'TND' && paiement;
}

// Ce que le lien montre, ou null (lien inconnu ou révoqué). Chaque ouverture est notée (« vue le … »).
export async function vueEspace(ctx: Contexte, jetonEmpreinte: string) {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const lu = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select ventes.espace($1, $2) v', [jetonEmpreinte, maintenant])).rows[0].v as Lu | null);
  if (!lu) return null;
  const aujourdhui = aujourdhuiATunis(maintenant);
  const pieces = lu.pieces.map((p) => {
    const net = BigInt(p.net);
    const m = (v: bigint) => versTexte(v, p.decimales);
    // Ce qu'une facture doit encore : ses avoirs et ses règlements retranchés (la même fonction que les
    // ventes au serveur). Un avoir ne se paie pas : il se lit.
    const solde = p.type === 'facture' ? soldeFacture(net, p.avoirs.map(BigInt), p.reglements.map(BigInt)) : null;
    // Ce qu'il en a payé, et ce que ses avoirs en ont retiré : de quoi relire le reste (net − avoirs − payé).
    return {
      type: p.type, numero: p.numero, date: p.date, echeance: p.echeance, devise: p.devise, net: m(net),
      paye: solde ? m(solde.paye) : null, credite: solde ? m(solde.credite) : null,
      reste: solde ? m(solde.reste) : null, statut: solde ? statutFacture(net, solde, p.echeance ?? undefined, aujourdhui) : null,
      payable: payableEnLigne(p.type, p.devise, solde ? solde.reste : null, lu.paiement === true),
      document: nettoyerPiece(p.document),
    };
  });
  // Le total dû, par devise, en entiers (jamais additionné en nombre à virgule).
  const dus = new Map<string, { du: bigint; decimales: number }>();
  for (const p of lu.pieces) {
    if (p.type !== 'facture') continue;
    const reste = soldeFacture(BigInt(p.net), p.avoirs.map(BigInt), p.reglements.map(BigInt)).reste;
    const d = dus.get(p.devise) ?? { du: 0n, decimales: p.decimales };
    dus.set(p.devise, { du: d.du + reste, decimales: d.decimales });
  }
  const totaux = [...dus].map(([devise, d]) => ({ devise, du: versTexte(d.du, d.decimales) }));
  // Les devis (le devis par son lien) : à part des factures, ils ne comptent jamais dans ce que le client doit.
  const devis = (lu.devis ?? []).map((d) => {
    const doc = objet(d.document) ? d.document : {};
    return { numero: d.numero ?? '', date: typeof doc.date === 'string' ? doc.date : null, validite: typeof doc.dueDate === 'string' && doc.dueDate ? doc.dueDate : null,
      statut: etatDevis(doc, aujourdhui), document: nettoyerPiece(d.document) };
  });
  return { lien: lu.lien, entreprise: nettoyerSociete(lu.entreprise), client: nettoyerClient(lu.client), pieces, devis, totaux };
}
