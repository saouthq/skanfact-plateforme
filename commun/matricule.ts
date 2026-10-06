// La forme d'un matricule fiscal tunisien, la même pour le serveur (serveur/matricule.ts) et pour l'écran qui la dit
// pendant la frappe (la porte, lot entrée) : sept chiffres, la lettre-clé (jamais I, O ni U : la règle du fichier El
// Fatoora), le code TVA, la catégorie et l'établissement, gardé sous sa forme lisible (1234567A/A/M/000) quelle que soit
// la façon de l'écrire (1234567 a a m 000, 1234567AAM000).
const nettoyer = (v: unknown) => String(v ?? '').toUpperCase().replace(/[\s/.\-_]/g, '');

// Vide : null ; mal formé : undefined.
export function matriculeCanonique(v: unknown): string | null | undefined {
  const c = nettoyer(v);
  if (!c) return null;
  return /^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c) ? `${c.slice(0, 8)}/${c[8]}/${c[9]}/${c.slice(10)}` : undefined;
}

// Le début d'un matricule (sept chiffres et la lettre-clé), la suite pas encore écrite : l'écran dit ce qui manque.
export const matriculeSansSuite = (v: unknown) => /^[0-9]{7}[A-HJ-NP-TV-Z]$/.test(nettoyer(v));
