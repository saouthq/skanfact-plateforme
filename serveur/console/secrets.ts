// Les secrets et leur échéance (1.37.0 ; base 0130 ; docs/console.md C53 ; la liste des fonctions qui manquent, 32), pur.
// Le registre ne garde jamais la valeur d'un secret : son nom, à quoi il sert, où il vit, et ses dates. Son échéance est
// le premier de deux jours : celui où il expire (une clé datée), et celui où son rythme de renouvellement le rappelle
// (« tous les 365 jours ») ; ni l'un ni l'autre, il n'a pas d'échéance — et l'écran le dit, sans rien inventer.

import { joursEntre, plusJours } from '../abonnement/etat.ts';

// À renouveler bientôt : trente jours avant son échéance ; il entre alors dans « À décider » (À DÉCIDER : le délai).
export const SECRET_BIENTOT_JOURS = 30;

export type Secret = {
  id: string; nom: string; role: string; ou: string; renouveleLe: string; expireLe: string | null; rotationJours: number | null;
  noteLe: string; notePar: string | null;
};
export type EtatSecret = 'a_jour' | 'bientot' | 'en_retard' | 'sans_echeance';
export type SecretLu = Secret & { echeance: string | null; jours: number | null; etat: EtatSecret };

const jourValide = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);

export function lireSecrets(brut: unknown): Secret[] {
  if (!Array.isArray(brut)) return [];
  const out: Secret[] = [];
  for (const x of brut as Record<string, unknown>[]) {
    const id = texte(x.id), nom = texte(x.nom), role = texte(x.role), ou = texte(x.ou), renouveleLe = jourValide(x.renouveleLe), noteLe = texte(x.noteLe);
    if (!id || !nom || !role || !ou || !renouveleLe || !noteLe) continue;
    const r = typeof x.rotationJours === 'number' && Number.isInteger(x.rotationJours) && x.rotationJours > 0 ? x.rotationJours : null;
    out.push({ id, nom, role, ou, renouveleLe, expireLe: jourValide(x.expireLe), rotationJours: r, noteLe, notePar: texte(x.notePar) });
  }
  return out;
}

// Son échéance : le premier des deux jours qu'il a ; aucun, aucune.
export function echeanceDu(s: Pick<Secret, 'renouveleLe' | 'expireLe' | 'rotationJours'>): string | null {
  const jours = [s.expireLe, s.rotationJours ? plusJours(s.renouveleLe, s.rotationJours) : null].filter((j): j is string => j !== null);
  return jours.length ? jours.reduce((a, b) => (a < b ? a : b)) : null;
}
export function lu(s: Secret, jour: string): SecretLu {
  const echeance = echeanceDu(s);
  if (!echeance) return { ...s, echeance: null, jours: null, etat: 'sans_echeance' };
  const jours = joursEntre(jour, echeance);
  return { ...s, echeance, jours, etat: jours < 0 ? 'en_retard' : jours <= SECRET_BIENTOT_JOURS ? 'bientot' : 'a_jour' };
}
// Le registre, le plus pressé d'abord : en retard, puis bientôt, puis à jour, puis sans échéance ; à égalité, le nom.
const RANG: Record<EtatSecret, number> = { en_retard: 0, bientot: 1, a_jour: 2, sans_echeance: 3 };
export const ranger = (l: readonly Secret[], jour: string): SecretLu[] =>
  l.map((s) => lu(s, jour)).sort((a, b) => RANG[a.etat] - RANG[b.etat] || (a.jours ?? 0) - (b.jours ?? 0) || a.nom.localeCompare(b.nom));
