// Les données personnelles (0144 ; docs/conservation.md ; docs/console.md C68) : les demandes d'effacement, et ce que
// SkanFact garde, combien de temps. Pur (testé : tests/console/effacement.test.ts) : la base rend les demandes ; ces
// fonctions les lisent et disent où en est chacune.

// Ce qui se garde, et combien de temps : une ligne par sorte de données. `verifier` : la durée n'est pas encore confirmée
// par l'INPDP ou un juriste (05 § 4.3) — l'écran le dit. `efface` : comment elle part (d'ici, sur la machine, jamais).
export const CONSERVATION = [
  { cle: 'compte', efface: 'console', verifier: true },
  { cle: 'entreprise', efface: 'machine', verifier: true },
  { cle: 'adresses', efface: 'seul', verifier: true },
  { cle: 'sessions', efface: 'compte', verifier: true },
  { cle: 'support', efface: 'entreprise', verifier: true },
  { cle: 'journal', efface: 'jamais', verifier: true },
  { cle: 'secours', efface: 'seul', verifier: false },
] as const;
export type SorteConservation = typeof CONSERVATION[number]['cle'];

// Par où une demande arrive.
export const CANAUX_EFFACEMENT = ['courriel', 'courrier', 'telephone', 'support', 'autre'] as const;

export type Effacement = {
  id: string; ref: string; recueLe: string; echeance: string; canal: string; demandeur: string; sorte: 'personne' | 'entreprise';
  compte: { nom: string; email: string; efface: boolean } | null; entreprise: { id: string; nom: string; numero: string | null } | null;
  noteePar: string; noteeLe: string; decision: 'accordee' | 'refusee' | null; raison: string | null; decideeLe: string | null; decideePar: string | null;
  faiteLe: string | null; faitePar: string | null; preuve: Record<string, number> | null;
};

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const texte = (v: unknown) => (typeof v === 'string' ? v : null);
const jour = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const instant = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

export function lireEffacements(x: unknown): Effacement[] {
  return (Array.isArray(x) ? x : []).flatMap((v) => {
    const o = objet(v);
    const [id, ref, recueLe, echeance, noteeLe] = [texte(o.id), texte(o.ref), jour(o.recueLe), jour(o.echeance), instant(o.noteeLe)];
    if (!id || !ref || !recueLe || !echeance || !noteeLe || (o.sorte !== 'personne' && o.sorte !== 'entreprise')) return [];
    const c = objet(o.compte), e = objet(o.entreprise), p = objet(o.preuve);
    return [{
      id, ref, recueLe, echeance, canal: texte(o.canal) ?? '', demandeur: texte(o.demandeur) ?? '', sorte: o.sorte,
      compte: typeof c.nom === 'string' && typeof c.email === 'string' ? { nom: c.nom, email: c.email, efface: c.efface === true } : null,
      entreprise: typeof e.id === 'string' && typeof e.nom === 'string' ? { id: e.id, nom: e.nom, numero: texte(e.numero) } : null,
      noteePar: texte(o.noteePar) ?? '', noteeLe,
      decision: o.decision === 'accordee' || o.decision === 'refusee' ? o.decision : null, raison: texte(o.raison), decideeLe: instant(o.decideeLe), decideePar: texte(o.decideePar),
      faiteLe: instant(o.faiteLe), faitePar: texte(o.faitePar),
      preuve: o.preuve ? Object.fromEntries(Object.entries(p).filter(([, n]) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) as Record<string, number> : null,
    }];
  });
}

// Où en est une demande : à décider ; accordée et à faire d'ici (un compte) ; accordée et à faire sur la machine (une
// entreprise) ; refusée ; faite. Et si son échéance de réponse est passée, sans réponse.
export type EtatEffacement = 'a_decider' | 'a_faire' | 'a_faire_machine' | 'refusee' | 'faite';
export function etatEffacement(d: Pick<Effacement, 'decision' | 'faiteLe' | 'sorte'>): EtatEffacement {
  if (!d.decision) return 'a_decider';
  if (d.decision === 'refusee') return 'refusee';
  if (d.faiteLe) return 'faite';
  return d.sorte === 'personne' ? 'a_faire' : 'a_faire_machine';
}
// Sans réponse à son échéance : une demande pas encore décidée dont l'échéance est passée (le jour de Tunis).
export const enRetard = (d: Pick<Effacement, 'decision' | 'echeance'>, aujourdhui: string) => d.decision === null && d.echeance < aujourdhui;
