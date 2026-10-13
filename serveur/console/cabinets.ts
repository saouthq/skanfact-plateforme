// Les cabinets, pour la console (skanfact docs/cadrage/10-console.md § 2.3 ; docs/console.md ; 0084), pur. Un cabinet,
// ses collaborateurs et ses dossiers : ceux qu'il tient lui-même, ceux de ses clients abonnés (un mandat actif), et
// ceux qu'un client lui propose (un mandat qu'il n'a pas encore accepté). Ce que la console dit d'un dossier (son nom,
// son matricule, son abonnement, son état) vient de la MÊME liste que les clients (`lireEntreprises`) : une entreprise
// dit la même chose sur la fiche de son cabinet et dans la liste des clients, et la liste des cabinets compte ce que
// leur fiche montre, par la même règle (`placeDe`, C3). Jamais le contenu d'un dossier.

import type { Entreprise } from './decider.ts';

export type Collaborateur = { nom: string; email: string; roles: string[]; depuis: string; derniereConnexion: string | null };
export type Mandat = { statut: 'propose' | 'actif'; debut: string } | null;
export type DossierBrut = { entreprise: string; tenu: boolean; mandat: Mandat };
export type Cabinet = { id: string; nom: string; creeLe: string; collaborateurs: Collaborateur[]; dossiers: DossierBrut[] };

// Ce que la base rend (plateforme.console_cabinets), lu prudemment : un champ illisible vaut « rien ».
export function lireCabinets(brut: unknown): Cabinet[] {
  if (!Array.isArray(brut)) return [];
  return brut.map((x: Record<string, unknown>) => ({
    id: String(x.id), nom: String(x.nom ?? ''), creeLe: String(x.creeLe ?? ''),
    collaborateurs: (Array.isArray(x.collaborateurs) ? x.collaborateurs as Record<string, unknown>[] : []).map((c) => ({
      nom: String(c.nom ?? ''), email: String(c.email ?? ''), roles: Array.isArray(c.roles) ? c.roles.map(String) : [],
      depuis: String(c.depuis ?? ''), derniereConnexion: typeof c.derniereConnexion === 'string' ? c.derniereConnexion : null,
    })),
    dossiers: (Array.isArray(x.dossiers) ? x.dossiers as Record<string, unknown>[] : []).map((d) => {
      const m = d.mandat as Record<string, unknown> | null;
      return {
        entreprise: String(d.entreprise), tenu: d.tenu === true,
        mandat: m && (m.statut === 'propose' || m.statut === 'actif') && typeof m.debut === 'string' ? { statut: m.statut, debut: m.debut } : null,
      };
    }),
  }));
}

// La place d'un dossier pour le cabinet : un dossier qu'il tient, un client abonné qui lui a donné un mandat, ou un
// client qui le lui propose et attend son accord.
export type Place = 'client' | 'tenu' | 'en_attente';
export const PLACES: readonly Place[] = ['client', 'tenu', 'en_attente'];
export const placeDe = (d: DossierBrut): Place => (d.tenu ? 'tenu' : d.mandat?.statut === 'actif' ? 'client' : 'en_attente');
const compter = (dossiers: DossierBrut[]) => Object.fromEntries(PLACES.map((p) => [p, dossiers.filter((d) => placeDe(d) === p).length])) as Record<Place, number>;

// Un associé : ce que le cabinet appelle « supervision » (socle.suis_associe).
const estAssocie = (c: Collaborateur) => c.roles.includes('supervision');
const plusRecent = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

// ── La liste des cabinets ────────────────────────────────────────────────────────────────────────────────────────────
export type LigneCabinet = {
  id: string; nom: string; creeLe: string; associes: { nom: string; email: string }[]; collaborateurs: number;
  comptes: Record<Place, number>; derniereActivite: string | null;
};
// `connues` : les entreprises de la liste des clients. Un dossier qui n'y est pas ne se compte pas, et la fiche ne le
// montre pas : la liste et la fiche comptent les mêmes dossiers.
export function ligneCabinet(c: Cabinet, connues: ReadonlySet<string>): LigneCabinet {
  return {
    id: c.id, nom: c.nom, creeLe: c.creeLe, associes: c.collaborateurs.filter(estAssocie).map((a) => ({ nom: a.nom, email: a.email })),
    collaborateurs: c.collaborateurs.length, comptes: compter(c.dossiers.filter((d) => connues.has(d.entreprise))),
    derniereActivite: c.collaborateurs.reduce<string | null>((m, x) => plusRecent(m, x.derniereConnexion), null),
  };
}

// Chercher un cabinet : son nom, un associé (nom ou adresse). Sans les accents ni la casse.
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function chercherCabinets(liste: LigneCabinet[], texte: string): LigneCabinet[] {
  const mots = plier(texte).split(/\s+/).filter(Boolean);
  if (!mots.length) return liste;
  return liste.filter((c) => {
    const champ = plier([c.nom, ...c.associes.flatMap((a) => [a.nom, a.email])].join(' '));
    return mots.every((m) => champ.includes(m));
  });
}

// ── La fiche d'un cabinet ────────────────────────────────────────────────────────────────────────────────────────────
// Un dossier : l'entreprise telle que la liste des clients la dit (seulement ce que la fiche montre), et sa place.
export type Dossier = {
  place: Place; mandat: Mandat;
  entreprise: Pick<Entreprise, 'id' | 'raisonSociale' | 'matricule' | 'creeLe' | 'faits' | 'etat' | 'pieces' | 'derniereActivite'>;
};
export type FicheCabinet = Omit<Cabinet, 'dossiers'> & { dossiers: Dossier[]; comptes: Record<Place, number> };

const comparerDossiers = (a: Dossier, b: Dossier) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place)
  || a.entreprise.raisonSociale.localeCompare(b.entreprise.raisonSociale, 'fr', { sensitivity: 'base' }) || a.entreprise.id.localeCompare(b.entreprise.id);

export function ficheCabinet(c: Cabinet, entreprises: Entreprise[]): FicheCabinet {
  const parId = new Map(entreprises.map((e) => [e.id, e]));
  const dossiers = c.dossiers.flatMap((d): Dossier[] => {
    const e = parId.get(d.entreprise);
    if (!e) return [];
    const { id, raisonSociale, matricule, creeLe, faits, etat, pieces, derniereActivite } = e;
    return [{ place: placeDe(d), mandat: d.mandat, entreprise: { id, raisonSociale, matricule, creeLe, faits, etat, pieces, derniereActivite } }];
  }).sort(comparerDossiers);
  // Les comptes de la fiche sont ceux de ce qu'elle montre ; la liste des cabinets compte les mêmes dossiers, par la même
  // règle (`placeDe`).
  const comptes = Object.fromEntries(PLACES.map((p) => [p, dossiers.filter((d) => d.place === p).length])) as Record<Place, number>;
  return { id: c.id, nom: c.nom, creeLe: c.creeLe, collaborateurs: c.collaborateurs, dossiers, comptes };
}

// Les cabinets qui suivent une entreprise, pour sa fiche : celui qui la tient, ceux qui ont son mandat ou à qui elle le
// propose. La même liste que leur fiche à eux (C3).
export type CabinetDe = { id: string; nom: string; place: Place; mandat: Mandat };
export function cabinetsDe(entreprise: string, cabinets: Cabinet[]): CabinetDe[] {
  return cabinets.flatMap((c) => c.dossiers.filter((d) => d.entreprise === entreprise).map((d) => ({ id: c.id, nom: c.nom, place: placeDe(d), mandat: d.mandat })))
    .sort((a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place) || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
}
