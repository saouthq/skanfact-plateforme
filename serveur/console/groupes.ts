// Les groupes et la remise d'une entreprise, vus de sa fiche (docs/abonnement.md C17 ; base 0106). Pur (testé :
// tests/console/groupes.test.ts) : la route lit la base (plateforme.console_groupe_de) ; ce module range, prudemment —
// une ligne illisible ne s'affiche pas, plutôt que de s'afficher fausse.

import { lireRemise, type Remise } from '../abonnement/remise.ts';

export type MembreGroupe = { entreprise: string; raisonSociale: string; depuis: string; premierePeriode: string | null };
// `membres` dans l'ordre de leur première période payée : la première paie le prix normal (celles qui n'ont jamais payé
// viennent après, dans l'ordre de leur création).
export type GroupeDe = {
  groupe: { id: string; nom: string; depuis: string; motif: string; membres: MembreGroupe[] } | null;
  // Les sociétés qui ont la même propriétaire et ne sont dans aucun groupe : la console les propose.
  voisines: { entreprise: string; raisonSociale: string }[];
  // Les groupes qui existent (au moins une société), pour en rejoindre un.
  groupes: { id: string; nom: string; membres: number }[];
  // Le taux de la remise de groupe au premier jour de sa prochaine période, et la remise de cette période.
  tauxGroupe: number;
  remise: Remise | null;
};
// L'aperçu d'un geste sur un groupe (plateforme.console_groupe_apercu) : les sociétés après lui, la première d'abord.
export type ApercuGroupe = { taux: number; membres: Omit<MembreGroupe, 'depuis'>[] };

const texte = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const jour = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.slice(0, 10)) ? x.slice(0, 10) : null);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const taux = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 90 ? x : 0);

export function lireGroupeDe(brut: unknown): GroupeDe {
  const b = objet(brut);
  const g = objet(b.groupe);
  const id = texte(g.id), nom = texte(g.nom), depuis = jour(g.depuis), motif = texte(g.motif);
  return {
    groupe: id && nom && depuis && motif ? {
      id, nom, depuis, motif,
      membres: tableau(g.membres).flatMap((m): MembreGroupe[] => {
        const entreprise = texte(m.entreprise), raisonSociale = texte(m.raisonSociale), d = jour(m.depuis);
        return entreprise && raisonSociale && d ? [{ entreprise, raisonSociale, depuis: d, premierePeriode: jour(m.premierePeriode) }] : [];
      }),
    } : null,
    voisines: tableau(b.voisines).flatMap((v) => {
      const entreprise = texte(v.entreprise), raisonSociale = texte(v.raisonSociale);
      return entreprise && raisonSociale ? [{ entreprise, raisonSociale }] : [];
    }),
    groupes: tableau(b.groupes).flatMap((x) => {
      const i = texte(x.id), n = texte(x.nom);
      const membres = typeof x.membres === 'number' && Number.isInteger(x.membres) && x.membres >= 0 ? x.membres : null;
      return i && n && membres !== null ? [{ id: i, nom: n, membres }] : [];
    }),
    tauxGroupe: taux(b.tauxGroupe),
    remise: lireRemise(b.remise),
  };
}

export function lireApercuGroupe(brut: unknown): ApercuGroupe {
  const b = objet(brut);
  return {
    taux: taux(b.taux),
    membres: tableau(b.membres).flatMap((m) => {
      const entreprise = texte(m.entreprise), raisonSociale = texte(m.raisonSociale);
      return entreprise && raisonSociale ? [{ entreprise, raisonSociale, premierePeriode: jour(m.premierePeriode) }] : [];
    }),
  };
}
