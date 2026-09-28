// Les clés de l'API (03 § 8, 14 § 2.5). Une clé agit comme une personne, au nom de son entreprise :
//   - elle porte une liste de gestes, chacun permis à celui qui l'a créée (personne ne se donne un
//     droit, et personne n'en donne un qu'il n'a pas) ; certains gestes ne se donnent jamais à une
//     clé (l'équipe, la propriété, les clés elles-mêmes…) ;
//   - elle ne se montre qu'une fois : la base n'en garde que l'empreinte ;
//   - elle expire (un an au plus) et se révoque.

import { createHash, randomBytes } from 'node:crypto';
import { Refus } from './erreurs.ts';
import { enTantQue, type Transaction } from './base.ts';
import type { Contexte, Qui } from './connexion.ts';
import { GESTES } from './porte/gestes.ts';
import { peut } from './porte/porte.ts';

export const PREFIXE_CLE = 'skf_';
const DUREE_MAX_JOURS = 366;
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export type CleQuiAgit = { id: string; entreprise: string; gestes: string[] };

export async function creerCle(tx: Transaction, qui: Qui, entreprise: string, demande: { nom: string; gestes: string[]; expireLe: Date }, maintenant = new Date()) {
  const gestes = [...new Set(demande.gestes)].sort();
  for (const code of gestes) {
    const g = GESTES.get(code);
    if (!g) throw new Refus('cles.geste_inconnu', { valeurs: { geste: code } });
    if (g.horsCle) throw new Refus('cles.geste_ferme', { valeurs: { geste: code } });
    // Personne ne donne un droit qu'il n'a pas : chaque geste passe la porte au nom du créateur.
    const d = await peut(tx, qui, entreprise, code, g.ecrit);
    if (!d.ok || (g.ecrit && d.lectureSeule)) throw new Refus('cles.geste_non_permis', { valeurs: { geste: code } });
  }
  const jours = (demande.expireLe.getTime() - maintenant.getTime()) / 86_400_000;
  if (jours <= 0 || jours > DUREE_MAX_JOURS) throw new Refus('cles.expiration', { valeurs: { jours: DUREE_MAX_JOURS } });
  const cle = PREFIXE_CLE + randomBytes(32).toString('base64url');
  const prefixe = cle.slice(0, PREFIXE_CLE.length + 6);
  const id = (await tx.query('select socle.creer_cle_api($1, $2, $3, $4, $5, $6) id',
    [entreprise, demande.nom, prefixe, sha256(cle), gestes, demande.expireLe])).rows[0].id as string;
  return { id, cle, prefixe, gestes, expireLe: demande.expireLe };
}

// La clé derrière ce jeton, si elle est valable (ni révoquée ni expirée).
export async function cleValable(ctx: Contexte, jeton: string): Promise<CleQuiAgit & { creePar: string } | null> {
  if (!jeton.startsWith(PREFIXE_CLE)) return null;
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.cle_api_valable($1)', [sha256(jeton)])).rows[0]);
  return r ? { id: r.id, entreprise: r.entreprise, gestes: r.gestes, creePar: r.cree_par } : null;
}
