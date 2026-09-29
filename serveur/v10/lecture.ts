// Lire ce que l'interface v10 a écrit dans son dossier : ses nombres, ses jours, ses paiements.
// Partagé par les ventes (0012), les achats (0013) et la paie (0014) : un paiement se lit de la même
// façon des deux côtés, et se refuse avec les mêmes phrases.

import { depuisTexte } from '../../moteur/argent.ts';
import { requetes, type Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import type { ReglementSaisi } from '../reglements.ts';
import './textes.ts';

export type Json = Record<string, unknown>;
export const estObjet = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// Deux contenus égaux, quel que soit l'ordre de leurs champs (la base range les champs d'un objet
// JSON à sa façon : comparer les textes tels quels verrait un changement là où il n'y en a pas).
export function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (estObjet(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonique(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Un objet du dossier dans un envoi : ce qu'il était, ce qu'il devient (null : retiré).
export type ChangementLu = { collection: string; cle: string; avant: unknown; apres: unknown };
// Seul ce qui a VRAIMENT changé compte : un objet qui n'a fait que changer de place dans sa liste (un
// autre ajouté avant lui) revient dans l'envoi, et ne doit ni se recalculer ni laisser de trace.
export const aVraimentChange = (c: ChangementLu) => c.apres === null || c.avant === null || canonique(c.avant) !== canonique(c.apres);

// L'objet du dossier tel qu'il est APRÈS l'envoi (tout l'envoi est déjà écrit).
export async function objetDuDossier(tx: Transaction, entreprise: string, collection: string, cle: string): Promise<Json | null> {
  const o = await requetes(tx).selectFrom('socle.dossier_v10').select('contenu')
    .where('entreprise', '=', entreprise).where('collection', '=', collection).where('cle', '=', cle).executeTakeFirst();
  return o && estObjet(o.contenu) ? o.contenu : null;
}

// Un nombre de la v10 à `dec` décimales au plus, ou `null` s'il en a trop.
export function exact(v: unknown, dec: number): bigint | null {
  try { return depuisTexte(nombreEnTexte(v), dec); } catch { return null; }
}

// Un nombre de la v10, tel que l'interface l'a écrit (un entier, ou { "~n": "450.5" }), en texte exact.
export function nombreEnTexte(v: unknown): string {
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  if (estObjet(v) && typeof v['~n'] === 'string') return v['~n'];
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
  return '0';
}
// Un nombre en texte exact, écrit comme l'interface l'écrit elle-même (sans zéro inutile : « 1.000 »
// devient 1, « 0.600 » devient { "~n": "0.6" }) : relu puis réécrit, il ne change pas d'un caractère.
export function enNombreV10(texte: string): number | { '~n': string } {
  const t = texte.includes('.') ? texte.replace(/0+$/, '').replace(/\.$/, '') : texte;
  return /^-?\d+$/.test(t) ? Number(t) : { '~n': t };
}

// Un jour du calendrier : « 2026-10-01 », et qui existe.
// (Un « 13e mois » donne une date invalide : elle se refuse, elle ne fait pas tomber le serveur.)
export const estJour = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const texteOuNul = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : null);

// La devise de la v10 (« DT », ou rien : celle de l'entreprise) et celle du serveur (« TND »).
export const deviseV10 = (c: unknown) => (!c || c === 'DT' || c === 'TND' ? 'TND' : String(c));

const DECIMALES_COURS = 6;

// Les paiements d'une pièce, tels que la v10 les a saisis (`payments`), lus et vérifiés : un seul
// illisible, et rien n'est enregistré. `numero` nomme la pièce dans le refus ; `refus`, ses phrases
// (celles d'une facture de vente ou d'un achat).
export type RefusPaiement = 'v10.reglement' | 'v10.achat_reglement';
export function lirePaiements(paiements: unknown, numero: string, decimales: number, devise: string, refus: RefusPaiement = 'v10.reglement'): ReglementSaisi[] {
  const liste = Array.isArray(paiements) ? paiements : [];
  const vus = new Set<string>();
  return liste.map((p, rang) => {
    if (!estObjet(p) || typeof p.id !== 'string' || p.id === '' || p.id.length > 200) throw new Refus(`${refus}_sans_identifiant`, { valeurs: { numero } });
    if (vus.has(p.id)) throw new Refus(`${refus}_double`, { valeurs: { numero } });
    vus.add(p.id);
    if (!estJour(p.date)) throw new Refus(`${refus}_date`, { valeurs: { numero } });
    const texte = nombreEnTexte(p.amount);
    let montant: bigint;
    try { montant = depuisTexte(texte, decimales); } catch { throw new Refus('v10.reglement_decimales', { valeurs: { devise, decimales: String(decimales), montant: texte } }); }
    if (montant === 0n) throw new Refus(`${refus}_montant`, { valeurs: { numero } });
    let cours: bigint | null = null;
    if (p.exchangeRate !== undefined && p.exchangeRate !== null && p.exchangeRate !== '') {
      try { cours = depuisTexte(nombreEnTexte(p.exchangeRate), DECIMALES_COURS); } catch { cours = 0n; }
      if (cours <= 0n) throw new Refus(`${refus}_cours`, { valeurs: { numero } });
    }
    return {
      ref: p.id, rang, date: p.date, montant, cours,
      mode: texteOuNul(p.method, 40) ?? 'inconnu', compte: texteOuNul(p.accountId, 200), reference: texteOuNul(p.reference, 200), note: texteOuNul(p.note, 1000),
    };
  });
}
