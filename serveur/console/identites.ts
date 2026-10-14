// Ce que la console sait de plus d'un client (base 0110, plateforme.console_identites), lu prudemment : son numéro
// (« E-0088 »), sa ville, le téléphone vérifié de sa propriétaire et son dernier appel noté ; les groupes de la console
// ce jour-là, avec leur numéro et leurs sociétés ; le numéro de chaque cabinet. Une valeur illisible vaut « rien ».

import type { GroupeConsole, Identite } from './organisations.ts';

export type DernierAppel = { le: string; resultat: 'parle' | 'sans_reponse' | 'message_laisse'; qui: string | null };
export type IdentiteEntreprise = Identite & { telephone: string | null; dernierAppel: DernierAppel | null };

const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const texte = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : null);
const numero = (x: unknown) => (typeof x === 'string' && /^[EGC]-\d{2,}$/.test(x) ? x : null);
const RESULTATS = ['parle', 'sans_reponse', 'message_laisse'] as const;

export function lireDernierAppel(x: unknown): DernierAppel | null {
  const a = objet(x);
  const le = texte(a.le);
  return le && RESULTATS.includes(a.resultat as never) ? { le, resultat: a.resultat as DernierAppel['resultat'], qui: texte(a.qui) } : null;
}

export function lireIdentites(brut: unknown): { entreprises: Map<string, IdentiteEntreprise>; groupes: Map<string, GroupeConsole>; cabinets: Map<string, string> } {
  const b = objet(brut);
  const entreprises = new Map(Object.entries(objet(b.entreprises)).map(([id, v]) => {
    const e = objet(v);
    return [id, { numero: numero(e.numero), ville: texte(e.ville), telephone: texte(e.telephone), dernierAppel: lireDernierAppel(e.dernierAppel) }];
  }));
  const groupes = new Map(Object.entries(objet(b.groupes)).flatMap(([id, v]): [string, GroupeConsole][] => {
    const g = objet(v);
    const nom = texte(g.nom);
    return nom ? [[id, { numero: numero(g.numero), nom, membres: (Array.isArray(g.membres) ? g.membres : []).filter((m): m is string => typeof m === 'string') }]] : [];
  }));
  const cabinets = new Map(Object.entries(objet(b.cabinets)).flatMap(([id, v]): [string, string][] => { const n = numero(v); return n ? [[id, n]] : []; }));
  return { entreprises, groupes, cabinets };
}

// Les notes d'appel d'une entreprise (plateforme.console_notes_appel), la plus récente d'abord.
export type NoteAppel = DernierAppel & { id: string; resume: string | null };
export function lireNotesAppel(brut: unknown): NoteAppel[] {
  return (Array.isArray(brut) ? brut : []).flatMap((x): NoteAppel[] => {
    const a = lireDernierAppel(x);
    const o = objet(x);
    const id = texte(o.id);
    return a && id ? [{ ...a, id, resume: texte(o.resume) }] : [];
  });
}
