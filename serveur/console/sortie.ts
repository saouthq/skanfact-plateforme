// La sortie d'un client et la conservation de ses données (1.38.0 ; base 0131 ; docs/console.md C54 ; la liste des
// fonctions qui manquent, 8 et 33), pur. La base lit les faits (le contrat, la trace du téléchargement de ses données, le
// remboursement, le terme de la conservation) ; ici, les étapes qui restent, la même règle pour la fiche et « À décider ».

import { joursEntre } from '../abonnement/etat.ts';

export const CAUSES_SORTIE = ['prix', 'manque', 'fermeture', 'concurrent', 'autre'] as const;
export type CauseSortie = typeof CAUSES_SORTIE[number];
export type Sortie = {
  id: string; cause: CauseSortie; dit: string; ouverteLe: string; ouvertePar: string | null;
  contrat: { arrete: boolean; fin: string | null; offert: boolean };
  export: { le: string; par: string | null } | null;
  remboursement: { sorte: 'aucun' | 'fait'; reference: string | null; le: string; par: string | null } | null;
  conserverJusquAu: string | null;
  close: { le: string; issue: 'partie' | 'reste'; motif: string; par: string | null; finContrat: string | null } | null;
  entreprise?: { id: string; nom: string };
};

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const jour = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const objet = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

export function lireSortie(brut: unknown): Sortie | null {
  const x = objet(brut);
  if (!x) return null;
  const id = texte(x.id), dit = texte(x.dit), ouverteLe = texte(x.ouverteLe);
  const cause = CAUSES_SORTIE.find((c) => c === x.cause);
  if (!id || !dit || !ouverteLe || !cause) return null;
  const c = objet(x.contrat) ?? {};
  const ex = objet(x.export), r = objet(x.remboursement), cl = objet(x.close), e = objet(x.entreprise);
  const exLe = ex ? texte(ex.le) : null;
  const rLe = r ? texte(r.le) : null, rSorte = r?.sorte === 'aucun' || r?.sorte === 'fait' ? r.sorte : null;
  const clLe = cl ? texte(cl.le) : null, issue = cl?.issue === 'partie' || cl?.issue === 'reste' ? cl.issue : null;
  return {
    id, cause, dit, ouverteLe, ouvertePar: texte(x.ouvertePar),
    contrat: { arrete: c.arrete === true, fin: jour(c.fin), offert: c.offert === true },
    export: ex && exLe ? { le: exLe, par: texte(ex.par) } : null,
    remboursement: r && rLe && rSorte ? { sorte: rSorte, reference: texte(r.reference), le: rLe, par: texte(r.par) } : null,
    conserverJusquAu: jour(x.conserverJusquAu),
    close: cl && clLe && issue ? { le: clLe, issue, motif: texte(cl.motif) ?? '', par: texte(cl.par), finContrat: jour(cl.finContrat) } : null,
    ...(e && texte(e.id) && texte(e.nom) ? { entreprise: { id: e.id as string, nom: e.nom as string } } : {}),
  };
}
export const lireSorties = (brut: unknown): Sortie[] => (Array.isArray(brut) ? brut.map(lireSortie).filter((s): s is Sortie => s !== null) : []);

// Ses données sont remises quand il les a téléchargées APRÈS l'ouverture de la sortie : un fichier d'avant ne contient
// pas ce qu'il a fait depuis.
export const donneesRemises = (s: Pick<Sortie, 'export' | 'ouverteLe'>): boolean =>
  !!s.export && new Date(s.export.le).getTime() >= new Date(s.ouverteLe).getTime();

// Les étapes d'une sortie, dans l'ordre où on les règle ; « partie » ne se clôt qu'avec le contrat arrêté et le
// remboursement réglé (la base le revérifie) ; les données remises se lisent avant le geste, sans le bloquer : c'est son
// droit de ne pas les prendre.
export type Etape = 'contrat' | 'donnees' | 'remboursement';
export const ETAPES: readonly Etape[] = ['contrat', 'donnees', 'remboursement'];
export const etapeFaite = (s: Sortie, e: Etape): boolean =>
  e === 'contrat' ? s.contrat.arrete && s.contrat.fin !== null : e === 'donnees' ? donneesRemises(s) : s.remboursement !== null;
export const restantes = (s: Sortie): Etape[] => ETAPES.filter((e) => !etapeFaite(s, e));
export const peutPartir = (s: Sortie): boolean => etapeFaite(s, 'contrat') && etapeFaite(s, 'remboursement');

// « À décider » : une sortie en cours dont le contrat a pris fin (son dernier jour est passé) attend d'être menée au bout.
export const sortieADecider = (s: Sortie, aujourdhui: string): boolean =>
  !s.close && s.contrat.arrete && s.contrat.fin !== null && joursEntre(s.contrat.fin, aujourdhui) > 0;
