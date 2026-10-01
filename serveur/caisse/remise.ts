// La remise à la caisse (brique 125 ; 03 § 2.1 « Caisse » ; docs/caisse.md, M1 à M4). Le plafond de la caisse
// (`remiseCaisseAuDela`, en %, sur la fiche de l'entreprise) vaut 0 % par défaut : toute remise demande alors le code d'un
// responsable présent. Le serveur lit la remise sur le ticket lui-même (jamais ce que l'écran en dit).

import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Transaction } from '../base.ts';
import { nombreEnTexte } from '../v10/lecture.ts';

// En centièmes de pour cent ; une valeur illisible compte comme une remise entière (la plus prudente).
const centiemes = (v: unknown) => { try { return depuisTexte(nombreEnTexte(v ?? 0), 2); } catch { return 10000n; } };

// La remise du ticket quand elle dépasse le plafond, sinon null.
export async function remiseAuDelaDuPlafond(tx: Transaction, entreprise: string, doc: Record<string, unknown>) {
  const taux = centiemes(doc.discountRate);
  if (taux <= 0n) return null;
  const fiche = (await tx.query(`select contenu -> 'remiseCaisseAuDela' p from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'company'`, [entreprise])).rows[0]?.p;
  const plafond = fiche === null || fiche === undefined || fiche === '' ? 0n : centiemes(fiche);
  if (taux <= plafond) return null;
  return { taux: versTexte(taux, 2).replace(/\.?0+$/, ''), plafond: versTexte(plafond, 2).replace(/\.?0+$/, '') };
}
