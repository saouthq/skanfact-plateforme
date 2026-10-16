// L'accès d'urgence de l'équipe (1.43.0 ; base 0135 ; docs/console.md C59 ; la liste des fonctions qui manquent, 31), pur :
// ce que la base rend, lu prudemment (une ligne illisible n'existe pas, jamais une valeur devinée), et ce qui en remonte
// à l'accueil de la direction. La base tient les règles (qui ouvre, pour qui, combien de temps, une fois).

export const ETATS_URGENCE = ['attend', 'servi', 'annule', 'passe'] as const;
export type EtatUrgence = typeof ETATS_URGENCE[number];
export type AccesUrgence = {
  id: string; membre: string; nom: string; ouvertLe: string; jusqua: string;
  // Qui l'a ouvert : un nom de la direction, ou la machine (l'outil de l'exploitation).
  par: string | null; machine: boolean; motif: string; serviLe: string | null; annuleLe: string | null; etat: EtatUrgence;
};
export type Urgences = { directions: number; acces: AccesUrgence[] };
// Un accès ouvert ou servi depuis moins d'une semaine se lit à l'accueil de la direction : un code a été remplacé sans
// le téléphone, quelqu'un doit savoir que c'était voulu.
export const URGENCE_ACCUEIL_JOURS = 7;

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

export function lireUrgences(brut: unknown): Urgences {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  const directions = typeof o.directions === 'number' && Number.isInteger(o.directions) && o.directions >= 0 ? o.directions : 0;
  const lignes = Array.isArray(o.acces) ? o.acces.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
  const acces = lignes.flatMap((x): AccesUrgence[] => {
    const id = texte(x.id), membre = texte(x.membre), nom = texte(x.nom), ouvertLe = instant(x.ouvertLe), jusqua = instant(x.jusqua), motif = texte(x.motif);
    const etat = ETATS_URGENCE.find((e) => e === x.etat);
    if (!id || !membre || !nom || !ouvertLe || !jusqua || !motif || !etat || typeof x.machine !== 'boolean') return [];
    const serviLe = instant(x.serviLe), annuleLe = instant(x.annuleLe);
    if ((etat === 'servi') !== (serviLe !== null) || (etat === 'annule') !== (annuleLe !== null)) return [];
    return [{ id, membre, nom, ouvertLe, jusqua, par: x.machine ? null : texte(x.par), machine: x.machine, motif, serviLe, annuleLe, etat }];
  });
  return { directions, acces };
}

// L'accès qui attend pour un membre (au plus un : la base le tient).
export const quiAttend = (u: Urgences, membre: string): AccesUrgence | null => u.acces.find((a) => a.membre === membre && a.etat === 'attend') ?? null;

// Ce qui remonte à l'accueil : un accès qui attend, ou qui a servi depuis moins d'une semaine (le plus récent d'abord).
export function aLAccueil(u: Urgences, maintenant: Date): AccesUrgence[] {
  const depuis = maintenant.getTime() - URGENCE_ACCUEIL_JOURS * 24 * 3600_000;
  return u.acces.filter((a) => a.etat === 'attend' || (a.etat === 'servi' && a.serviLe !== null && Date.parse(a.serviLe) > depuis));
}
