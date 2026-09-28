// Le journal inaltérable (01 R9). Une pièce scellée devient un maillon de sa chaîne :
//   contenu   = sha256( forme canonique de la pièce )
//   empreinte = sha256( empreinte précédente || contenu )      (hexadécimal ; au départ, 64 « 0 »)
// La base garde la chaîne et refait le lien (socle.controler_chaine) ; le serveur refait le contenu
// à partir des pièces elles-mêmes (`controler`). Modifier une pièce, un maillon, ou retirer le
// dernier : le contrôle le voit.

import { createHash } from 'node:crypto';
import { reconnaitre, t, type Texte } from '../textes/index.ts';
import type { Transaction } from './base.ts';

export const DEPART = '0'.repeat(64);
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

// La forme canonique : clés triées, aucun espace, et AUCUN nombre à virgule (l'argent et les taux
// sont des entiers, 01 R3 ; un nombre à virgule s'écrit différemment selon la machine). Un champ
// `undefined` est refusé : « absent » et « vide » ne doivent pas donner la même empreinte par hasard.
export function canonique(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`nombre refusé dans une pièce scellée : ${v} (un entier est attendu, 01 R3)`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => {
      if (o[k] === undefined) throw new Error(`champ « ${k} » indéfini dans une pièce scellée`);
      return `${JSON.stringify(k)}:${canonique(o[k])}`;
    }).join(',')}}`;
  }
  throw new Error(`valeur refusée dans une pièce scellée : ${typeof v}`);
}

export const empreinteContenu = (piece: unknown) => sha256(canonique(piece));
export const empreinteMaillon = (precedente: string, contenu: string) => sha256(precedente + contenu);

export type Maillon = { rang: number; precedente: string; empreinte: string };

// Sceller une pièce, dans la transaction qui l'émet.
export async function sceller(tx: Transaction, entreprise: string, cle: string, objet: { type: string; id: string }, piece: unknown): Promise<Maillon> {
  const r = (await tx.query('select * from socle.sceller($1, $2, $3, $4, $5)', [entreprise, cle, objet.type, objet.id, empreinteContenu(piece)])).rows[0];
  return { rang: Number(r.rang), precedente: r.precedente, empreinte: r.empreinte };
}

export type Controle = { ok: true } | { ok: false; rang: number; motif: Texte | string };

// Le contrôle complet d'une chaîne : les liens (par la base), puis le contenu de chaque pièce,
// relue par le module qui la possède. `relire` rend la pièce telle qu'elle est AUJOURD'HUI, ou
// `null` si elle a disparu.
export async function controler(
  tx: Transaction, entreprise: string, cle: string,
  relire: (objet: { type: string; id: string }) => Promise<unknown>,
): Promise<Controle> {
  const liens = (await tx.query('select * from socle.controler_chaine($1, $2)', [entreprise, cle])).rows[0];
  if (!liens.ok) return { ok: false, rang: Number(liens.rang), motif: reconnaitre(liens.motif) ?? liens.motif };
  const maillons = await tx.query('select rang, objet_type, objet_id, contenu from socle.maillon where entreprise = $1 and cle = $2 order by rang', [entreprise, cle]);
  for (const m of maillons.rows) {
    const piece = await relire({ type: m.objet_type, id: m.objet_id });
    if (piece === null) return { ok: false, rang: Number(m.rang), motif: t('journal.piece_disparue') };
    if (empreinteContenu(piece) !== m.contenu) return { ok: false, rang: Number(m.rang), motif: t('journal.piece_modifiee') };
  }
  return { ok: true };
}
