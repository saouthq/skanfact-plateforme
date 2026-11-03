// La CIN et le RIB des salariés (16 § 10.1, point 13, lot A ; 03/11/2026, 1.266.7 ; à sortir avec le Personnel, A1) : ce
// qu'en reçoivent ceux qui n'y ont pas droit. Le cabinet lit la CIN, jamais le RIB entier (ses 4 derniers chiffres, ce que
// son écran montre déjà depuis la 1.237.0) ; ce qu'il renvoie d'un salarié garde le RIB du serveur ; une version écartée
// d'une fiche de salarié (`conflictArchive`, que la fusion de la v10 écrit et qu'aucun écran ne lit) ne garde ni l'un ni
// l'autre. Le scellement au repos (lot B) attend la décision de la clé.

import { estObjet, type Json } from '../v10/lecture.ts';

// Le RIB tel que le cabinet le reçoit : ses 4 derniers chiffres derrière un masque, jamais le reste.
export function ribMasque(contenu: unknown): unknown {
  if (!estObjet(contenu) || typeof contenu.iban !== 'string' || contenu.iban.trim() === '') return contenu;
  return { ...contenu, iban: `•••• ${contenu.iban.replace(/\D/g, '').slice(-4)}` };
}

// Ce qu'un cabinet renvoie d'un salarié garde le RIB du serveur : il ne l'a pas lu, il ne l'écrit pas (son écran renvoie
// le masque qu'il a lu, ou rien pour un salarié qu'il crée).
export function ribGarde(avant: unknown, apres: unknown): unknown {
  if (!estObjet(apres)) return apres;
  const garde: Json = { ...apres };
  delete garde.iban;
  if (estObjet(avant) && typeof avant.iban === 'string') garde.iban = avant.iban;
  return garde;
}

function sansIdentite(e: unknown): unknown {
  if (!estObjet(e) || e.kind !== 'employees' || !estObjet(e.record)) return e;
  const record: Json = { ...e.record };
  delete record.cin;
  delete record.iban;
  return { ...e, record };
}

// Une version écartée d'une fiche de salarié ne garde ni CIN ni RIB : à l'écriture, et à la lecture pour les archives
// d'avant, déjà en base.
export function archiveSansIdentite(collection: string, cle: string, contenu: unknown): unknown {
  if (collection === 'conflictArchive') return sansIdentite(contenu);
  if (collection === '_racine' && cle === 'conflictArchive' && Array.isArray(contenu)) return contenu.map(sansIdentite);
  return contenu;
}

// La réponse rend-elle une CIN ou un RIB en clair ? (Sa lecture se trace alors, une fois par réponse.)
export const rendUneIdentite = (objets: { collection: string; contenu?: unknown }[]) =>
  objets.some((o) => o.collection === 'employees' && estObjet(o.contenu) && Boolean(o.contenu.cin || o.contenu.iban));
