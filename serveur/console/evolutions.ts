// Les retours des clients et les demandes d'évolution (1.42.0 ; base 0134 ; docs/console.md C58 ; la liste des fonctions
// qui manquent, 35 : « gestion des retours clients et des demandes d'évolution »), pur : ce que la base rend, lu
// prudemment (une ligne illisible n'existe pas, jamais une valeur devinée). La base range les évolutions (le nombre de
// clients qui les demandent d'abord) et tient les règles (qui décide, ce que « faite » ou « écartée » doit dire).

export const ETATS_EVOLUTION = ['a_etudier', 'prevue', 'faite', 'ecartee'] as const;
export type EtatEvolution = typeof ETATS_EVOLUTION[number];
export type DemandeRattachee = { id: string; numero: number; sujet: string; ouverteLe: string; entreprise: { id: string; nom: string } };
export type Evolution = {
  id: string; titre: string; description: string | null; etat: EtatEvolution; version: string | null; raison: string | null;
  noteeLe: string; noteePar: string | null; decideeLe: string | null; decideePar: string | null;
  clients: number; demandes: number; derniere: string | null; liste: DemandeRattachee[];
};
export type EvolutionDe = { id: string; titre: string; etat: EtatEvolution; version: string | null };

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const entier = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const objet = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

function lireRattachee(v: unknown): DemandeRattachee | null {
  const x = objet(v), e = objet(x?.entreprise);
  const id = texte(x?.id), sujet = texte(x?.sujet), ouverteLe = instant(x?.ouverteLe), eid = texte(e?.id);
  const numero = typeof x?.numero === 'number' && Number.isInteger(x.numero) ? x.numero : null;
  return id && sujet && ouverteLe && eid && numero !== null ? { id, numero, sujet, ouverteLe, entreprise: { id: eid, nom: texte(e?.nom) ?? '—' } } : null;
}

export function lireEvolutions(brut: unknown): Evolution[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((v): Evolution[] => {
    const x = objet(v);
    const id = texte(x?.id), titre = texte(x?.titre), noteeLe = instant(x?.noteeLe);
    const etat = ETATS_EVOLUTION.find((s) => s === x?.etat);
    if (!x || !id || !titre || !noteeLe || !etat) return [];
    return [{
      id, titre, description: texte(x.description), etat, version: texte(x.version), raison: texte(x.raison),
      noteeLe, noteePar: texte(x.noteePar), decideeLe: instant(x.decideeLe), decideePar: texte(x.decideePar),
      clients: entier(x.clients), demandes: entier(x.demandes), derniere: instant(x.derniere),
      liste: Array.isArray(x.liste) ? x.liste.map(lireRattachee).filter((d): d is DemandeRattachee => d !== null) : [],
    }];
  });
}

export function lireEvolutionDe(brut: unknown): EvolutionDe | null {
  const x = objet(brut);
  const id = texte(x?.id), titre = texte(x?.titre), etat = ETATS_EVOLUTION.find((s) => s === x?.etat);
  return x && id && titre && etat ? { id, titre, etat, version: texte(x.version) } : null;
}

// Ce que l'équipe a encore à décider : les évolutions à étudier que des clients réclament.
export const aEtudier = (l: readonly Evolution[]): Evolution[] => l.filter((e) => e.etat === 'a_etudier' && e.clients > 0);
