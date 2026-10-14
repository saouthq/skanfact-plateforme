// Les remises (docs/abonnement.md C17 ; base 0106 ; skanfact docs/cadrage/07-offres-et-prix.md) : celle du groupe (la
// première abonnée d'un groupe déclaré paie le prix normal, les autres ont la remise) et celle du cabinet (la première
// année d'un client venu par son cabinet), jamais additionnées. La base décide laquelle s'applique à une période
// (plateforme.remise_de) ; ce module la lit, prudemment, et calcule son montant comme la base le rejoue.

// La remise d'une période, telle que la base la rend. `aussi` : l'autre, qui s'appliquait aussi et ne s'ajoute pas.
export type NatureRemise = 'groupe' | 'cabinet';
export type Remise = {
  nature: NatureRemise; taux: number;
  // Le groupe : son nom, et (pour la console seulement) la société qui y paie le prix normal.
  groupe: string | null; premiere: string | null;
  // Le cabinet : son nom, et le dernier jour où une période commence avec la remise.
  cabinet: string | null; jusquAu: string | null;
  aussi: Omit<Remise, 'aussi'> | null;
};

const texte = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const jour = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.slice(0, 10)) ? x.slice(0, 10) : null);
function lireUne(brut: unknown): Omit<Remise, 'aussi'> | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const r = brut as Record<string, unknown>;
  const nature = r.nature === 'groupe' || r.nature === 'cabinet' ? r.nature : null;
  const taux = typeof r.taux === 'number' && Number.isInteger(r.taux) && r.taux > 0 && r.taux <= 90 ? r.taux : null;
  if (!nature || taux === null) return null;
  return { nature, taux, groupe: texte(r.groupe), premiere: texte(r.premiere), cabinet: texte(r.cabinet), jusquAu: jour(r.jusquAu) };
}
// Une remise illisible ne s'applique pas : rien n'est deviné.
export function lireRemise(brut: unknown): Remise | null {
  const r = lireUne(brut);
  if (!r) return null;
  return { ...r, aussi: lireUne((brut as Record<string, unknown>).aussi) };
}

// Le montant de la remise sur un total hors taxes, en millimes : au millime le plus proche, comme la base le rejoue
// (plateforme.montant_remise) et comme la v10 calcule la remise globale d'une pièce.
export const montantRemise = (base: bigint, taux: number): bigint => (base * BigInt(taux) + 50n) / 100n;
