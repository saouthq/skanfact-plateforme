// L'accès du support au dossier d'un client (Support S2 ; docs/support.md ; 0096), pur : ce que la base rend, relu
// prudemment, des deux côtés (la console, l'application). Trois règles :
//   - un fait se garde, l'état se déduit (`etat`, calculé par la base à l'instant de la lecture) : une fin passée n'a
//     besoin de personne pour fermer l'accès ;
//   - l'accès s'accorde pour quelques heures, quarante-huit au plus (la base le refuse au-delà) : l'écran ne PROPOSE
//     que les durées de `DUREES_PROPOSEES`, À VÉRIFIER avec Skander ;
//   - chaque page lue est tracée par son NOM (« factures »), jamais un identifiant ni un contenu : c'est ce que
//     l'entreprise relit dans « Qui a regardé mes données ».

export const ETATS_ACCES = ['demande', 'actif', 'echu', 'refuse', 'retire', 'fini'] as const;
export type EtatAcces = (typeof ETATS_ACCES)[number];
export const HEURES_MAX = 48;
export const DUREES_PROPOSEES = [2, 24, 48] as const;
// Le nom d'une page, tel que la base l'accepte (0096 : lecture_support.page).
export const PAGE = /^[a-z][a-z0-9_-]{0,39}$/;

export type Acces = {
  id: string; entreprise: string; etat: EtatAcces;
  // Le demandeur, par son nom (son prénom côté entreprise) ; `aMoi` : c'est moi (la console) qui l'ai demandé.
  demandeur: string | null; aMoi: boolean; demande: { id: string; numero: number; sujet: string } | null;
  motif: string; demandeLe: string; heures: number | null; accordeLe: string | null; fin: string | null; accordePar: string | null;
  refuseLe: string | null; refusePar: string | null; retireLe: string | null; retirePar: string | null; closLe: string | null;
  lectures: { page: string; le: string }[];
};

const texte = (v: unknown) => (typeof v === 'string' ? v : null);
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const instant = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

// Une ligne qu'on ne sait pas lire ne s'affiche pas ; un champ illisible vaut « rien », jamais une valeur devinée.
export function lireUnAcces(x: unknown): Acces | null {
  const a = objet(x);
  const id = texte(a.id), entreprise = texte(a.entreprise), motif = texte(a.motif), demandeLe = instant(a.demandeLe);
  const etat = ETATS_ACCES.find((e) => e === a.etat);
  if (!id || !entreprise || !motif || !demandeLe || !etat) return null;
  const d = objet(a.demande);
  const demande = texte(d.id) && typeof d.numero === 'number' && texte(d.sujet) ? { id: d.id as string, numero: d.numero, sujet: d.sujet as string } : null;
  const heures = typeof a.heures === 'number' && Number.isInteger(a.heures) && a.heures >= 1 && a.heures <= HEURES_MAX ? a.heures : null;
  const lectures = (Array.isArray(a.lectures) ? a.lectures : []).map(objet)
    .flatMap((l) => (texte(l.page) && PAGE.test(l.page as string) && instant(l.le) ? [{ page: l.page as string, le: l.le as string }] : []));
  // Un accès qui court sans sa fin lisible n'est pas un accès qui court : on ne dit jamais « actif » sans « jusqu'à quand ».
  const fin = instant(a.fin);
  if (etat === 'actif' && !fin) return null;
  return {
    id, entreprise, etat, demandeur: texte(a.demandeur), aMoi: a.aMoi === true, demande, motif, demandeLe, heures,
    accordeLe: instant(a.accordeLe), fin, accordePar: texte(a.accordePar),
    refuseLe: instant(a.refuseLe), refusePar: texte(a.refusePar), retireLe: instant(a.retireLe), retirePar: texte(a.retirePar),
    closLe: instant(a.closLe), lectures,
  };
}
export const lireAcces = (x: unknown): Acces[] => (Array.isArray(x) ? x : []).flatMap((a) => { const l = lireUnAcces(a); return l ? [l] : []; });

// Ce qui reste d'un accès qui court, en minutes entières (jamais négatif) ; rien pour un accès qui ne court pas.
export function minutesRestantes(a: Pick<Acces, 'etat' | 'fin'>, maintenant: Date): number | null {
  if (a.etat !== 'actif' || !a.fin) return null;
  return Math.max(0, Math.floor((Date.parse(a.fin) - maintenant.getTime()) / 60_000));
}

// Mon accès à un client (la console) : celui qui court, sinon ma demande en attente, sinon le plus récent. La base n'en
// laisse qu'un en cours par membre et par client.
export function monAcces(acces: Acces[]): Acces | null {
  const siens = acces.filter((a) => a.aMoi);
  return siens.find((a) => a.etat === 'actif') ?? siens.find((a) => a.etat === 'demande') ?? siens[0] ?? null;
}
