// Le contenu des pièces scellées, relu contre son empreinte (0142 ; docs/console.md C66 ; l'audit 1.42.0 § 4 ; 01 R9).
// La relecture des liens (./chaines.ts, 0115) ne voit pas une pièce retouchée par-dessous la base : son maillon n'a pas
// bougé. Ici, chaque pièce scellée est relue telle qu'elle est aujourd'hui, son contenu recalculé par la fonction qui l'a
// scellée (deux chemins, un chiffre), et comparé à celui de son maillon :
//   - une écriture validée : la base le recalcule (compta.contenu_ecriture) ;
//   - une pièce de vente : `contenuScelle` (serveur/ventes/pieces.ts), sur la pièce et ses lignes que la base rend au
//     serveur seul.
// Une chaîne se relit par pas (chaque pas dans sa transaction : une grande chaîne ne tient pas une transaction ouverte),
// jusqu'au rang qu'elle avait au départ ; la première pièce qui ne va pas arrête sa relecture, avec son rang et pourquoi.

import type { Selectable } from 'kysely';
import type pg from 'pg';
import type { BaseDeDonnees } from '../../base/types.ts';
import { enTantQue } from '../base.ts';
import { empreinteContenu } from '../journal.ts';
import { contenuScelle, pieceDeLaLigne, type LignePieceLue } from '../ventes/pieces.ts';

// Le tour de chaque heure relit le contenu de cinquante chaînes au plus, les moins récemment relues d'abord, et ne commence
// plus de chaîne après deux minutes (le tour suivant reprend là). À VÉRIFIER à la mesure de charge (npm run charge).
export const CONTENUS_PAR_LOT = 50;
export const CONTENUS_BUDGET_MS = 120_000;
export const MAILLONS_PAR_PAS = 500;
// Une relecture demandée depuis la console se cherche chaque minute.
export const DEMANDES_PAS_MS = 60_000;
// Ce que la relecture note d'une pièce qui ne va pas : un code, que la console dit en mots (web/console/src/textes.ts) ;
// une sorte de pièce qu'elle ne sait pas lire porte son nom après le code (« inconnue:ticket »).
export const MOTIFS = { modifiee: 'modifiee', disparue: 'disparue', inconnue: 'inconnue' } as const;

export type ContenuRelu =
  | { ok: true; pieces: number }
  | { ok: false | null; pieces: number; rang: number; motif: string };

type Maillon = { rang: bigint; objet_type: string; objet_id: string; contenu: string; recalcule: string | null };
type PieceBrute = Selectable<BaseDeDonnees['ventes.piece']>;
type LigneBrute = LignePieceLue & { piece: string };

// Le contenu d'aujourd'hui d'un maillon : son empreinte, `null` si la pièce a disparu, `undefined` pour une sorte de pièce
// que la relecture ne sait pas lire.
function contenuDuJour(m: Maillon, pieces: Map<string, PieceBrute>, lignes: Map<string, LigneBrute[]>): string | null | undefined {
  if (m.objet_type === 'ecriture') return m.recalcule;
  if (m.objet_type !== 'piece_vente') return undefined;
  const p = pieces.get(m.objet_id);
  if (!p) return null;
  try {
    return empreinteContenu(contenuScelle(pieceDeLaLigne(p), lignes.get(m.objet_id) ?? []));
  } catch {
    // Une pièce émise qui ne se lit plus (un montant effacé) a changé.
    return '';
  }
}

// Relire le contenu d'UNE chaîne jusqu'au rang `jusqua`, et noter ce qu'on a trouvé. `apresChaquePas` : une relecture
// demandée donne de ses nouvelles à chaque pas (une grande chaîne prend du temps).
export async function relireLeContenu(pool: pg.Pool, entreprise: string, cle: string, jusqua: number, maintenant: Date,
  apresChaquePas: () => Promise<unknown> = async () => undefined): Promise<ContenuRelu> {
  let apres = 0, pieces = 0;
  let verdict: ContenuRelu | null = null;
  while (verdict === null && apres < jusqua) {
    verdict = await enTantQue(pool, null, async (tx) => {
      const lot = (await tx.query('select * from plateforme.maillons_a_relire($1, $2, $3, $4, $5)', [entreprise, cle, apres, jusqua, MAILLONS_PAR_PAS])).rows as Maillon[];
      // Des maillons manquent : la relecture des liens le dit (« maillon manquant ») ; le contenu s'arrête là.
      if (!lot.length) { apres = jusqua; return null; }
      const ids = lot.filter((m) => m.objet_type === 'piece_vente').map((m) => m.objet_id);
      const lues = new Map<string, PieceBrute>(), lignes = new Map<string, LigneBrute[]>();
      if (ids.length) {
        for (const p of (await tx.query('select * from plateforme.pieces_a_relire($1, $2)', [entreprise, ids])).rows as PieceBrute[]) lues.set(p.id, p);
        for (const l of (await tx.query('select * from plateforme.lignes_a_relire($1, $2)', [entreprise, ids])).rows as LigneBrute[]) {
          const deLaPiece = lignes.get(l.piece) ?? [];
          deLaPiece.push(l);
          lignes.set(l.piece, deLaPiece);
        }
      }
      for (const m of lot) {
        const rang = Number(m.rang);
        const c = contenuDuJour(m, lues, lignes);
        if (c === undefined) return { ok: null, pieces, rang, motif: `${MOTIFS.inconnue}:${m.objet_type}` };
        // Une pièce qui ne va pas a été relue (on l'a cherchée, comparée) : elle compte.
        if (c === null) return { ok: false, pieces: pieces + 1, rang, motif: MOTIFS.disparue };
        if (c !== m.contenu) return { ok: false, pieces: pieces + 1, rang, motif: MOTIFS.modifiee };
        pieces += 1;
        apres = rang;
      }
      return null;
    });
    if (verdict === null) await apresChaquePas();
  }
  const fin: ContenuRelu = verdict ?? { ok: true, pieces };
  await enTantQue(pool, null, (tx) => tx.query('select plateforme.noter_contenu($1, $2, $3, $4, $5, $6, $7)',
    [entreprise, cle, maintenant, fin.ok, fin.ok === true ? null : fin.rang, fin.ok === true ? null : fin.motif, jusqua]));
  return fin;
}

type ChaineARelire = { entreprise: string; cle: string; rang: bigint };
const chainesARelire = (pool: pg.Pool, lot: number, entreprise: string | null) =>
  enTantQue(pool, null, async (tx) => (await tx.query('select * from plateforme.contenus_a_relire($1, $2)', [lot, entreprise])).rows as ChaineARelire[]);

// Le tour de chaque heure (après celui des liens) : un lot des chaînes les moins récemment relues, dans le temps donné.
export async function relireLesContenus(pool: pg.Pool, maintenant: Date = new Date(), o: { lot?: number; budgetMs?: number } = {}): Promise<{ chaines: number; pieces: number; cassees: number }> {
  const debut = Date.now();
  let chaines = 0, pieces = 0;
  for (const c of await chainesARelire(pool, o.lot ?? CONTENUS_PAR_LOT, null)) {
    if (Date.now() - debut > (o.budgetMs ?? CONTENUS_BUDGET_MS)) break;
    pieces += (await relireLeContenu(pool, c.entreprise, c.cle, Number(c.rang), maintenant)).pieces;
    chaines += 1;
  }
  const cassees = await enTantQue(pool, null, async (tx) =>
    Number((await tx.query('select plateforme.noter_releve_contenus($1, $2, $3, $4) v', [maintenant, chaines, pieces, Date.now() - debut])).rows[0].v));
  return { chaines, pieces, cassees };
}

// Une relecture demandée depuis la console (0142) : toutes les chaînes d'une entreprise, ou toutes celles de la base ;
// pour chacune, ses liens puis son contenu. Le serveur dit où il en est après chaque chaîne. Un serveur qui s'arrête
// (`arret`) la laisse entre deux chaînes : la demande reste ouverte, un serveur la reprend cinq minutes après.
export async function faireLaRelectureDemandee(pool: pg.Pool, horloge: () => Date = () => new Date(), arret: () => boolean = () => false): Promise<{ demandes: number; chaines: number; pieces: number; cassees: number }> {
  const d = await enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.relecture_prendre($1) v', [horloge()])).rows[0].v) as { id: string; entreprise: string | null } | null;
  if (!d) return { demandes: 0, chaines: 0, pieces: 0, cassees: 0 };
  const debut = Date.now(), maintenant = horloge();
  const chaines = await chainesARelire(pool, 2_147_483_647, d.entreprise);
  let faites = 0, pieces = 0, cassees = 0, maillons = 0;
  const avance = (finie: boolean) => enTantQue(pool, null, (tx) => tx.query('select plateforme.relecture_avance($1, $2, $3, $4, $5, $6, $7)',
    [d.id, chaines.length, faites, pieces, cassees, finie, horloge()]));
  await avance(false);
  for (const c of chaines) {
    if (arret()) return { demandes: 1, chaines: faites, pieces, cassees };
    const liens = await enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.relire_liens($1, $2, $3) v', [c.entreprise, c.cle, maintenant])).rows[0].v as boolean);
    const contenu = await relireLeContenu(pool, c.entreprise, c.cle, Number(c.rang), maintenant, () => avance(false));
    faites += 1;
    maillons += Number(c.rang);
    pieces += contenu.pieces;
    if (!liens || contenu.ok === false) cassees += 1;
    await avance(false);
  }
  // Elle compte comme une relecture des liens (0115) et comme une relecture du contenu.
  await enTantQue(pool, null, async (tx) => {
    await tx.query('select plateforme.noter_releve_liens($1, $2, $3, $4)', [maintenant, faites, maillons, Date.now() - debut]);
    await tx.query('select plateforme.noter_releve_contenus($1, $2, $3, $4)', [maintenant, faites, pieces, Date.now() - debut]);
  });
  await avance(true);
  return { demandes: 1, chaines: faites, pieces, cassees };
}
