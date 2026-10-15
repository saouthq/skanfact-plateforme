// La documentation interne du support (1.41.0 ; base 0133 ; docs/console.md C57 ; la liste des fonctions qui manquent,
// 20 : « documentation interne du support : procédures, notes privées et réponses validées »), pur : ce que la base rend,
// lu prudemment (une ligne illisible n'existe pas, jamais une valeur devinée), et la réponse validée posée pour une
// personne. La base tient les règles (qui écrit, qui valide, une reprise revient à valider).

export const SORTES_DOC = ['reponse', 'procedure'] as const;
export type SorteDoc = typeof SORTES_DOC[number];
export type NotePrivee = { id: string; texte: string; le: string; auteur: string | null };
export type FicheDoc = {
  id: string; sorte: SorteDoc; titre: string; texte: string; ecriteLe: string; ecritePar: string | null;
  validee: { le: string; par: string | null } | null;
};

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const objets = (brut: unknown): Record<string, unknown>[] =>
  (Array.isArray(brut) ? brut.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []);

export function lireNotes(brut: unknown): NotePrivee[] {
  return objets(brut).flatMap((x) => {
    const id = texte(x.id), t = texte(x.texte), le = instant(x.le);
    return id && t && le ? [{ id, texte: t, le, auteur: texte(x.auteur) }] : [];
  });
}

export function lireDocs(brut: unknown): FicheDoc[] {
  return objets(brut).flatMap((x): FicheDoc[] => {
    const id = texte(x.id), titre = texte(x.titre), t = texte(x.texte), ecriteLe = instant(x.ecriteLe);
    const sorte = SORTES_DOC.find((s) => s === x.sorte);
    if (!id || !titre || !t || !ecriteLe || !sorte) return [];
    const valideeLe = instant(x.valideeLe);
    return [{ id, sorte, titre, texte: t, ecriteLe, ecritePar: texte(x.ecritePar), validee: valideeLe ? { le: valideeLe, par: texte(x.valideePar) } : null }];
  });
}

// Les réponses que le champ de réponse propose : validées seulement (une réponse qui attend sa validation ne part pas
// chez un client).
export const reponsesOffertes = (docs: readonly FicheDoc[]): FicheDoc[] => docs.filter((f) => f.sorte === 'reponse' && f.validee !== null);

// Une réponse validée, posée pour une personne : « {prenom} » devient son prénom (rien d'autre ne se remplace).
export const poserReponse = (t: string, prenom: string): string => t.split('{prenom}').join(prenom);
