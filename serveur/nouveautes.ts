// Les nouveautés qu'on allume (1.27.0 ; base 0120 ; docs/console.md C43 ; skanfact docs/cadrage/02-modules.md § 7). Une
// nouveauté s'allume d'abord pour des entreprises volontaires, avant tout le monde : c'est l'essai sans installation.
//
// Elle n'existe que si la version en service la porte : c'est CETTE liste, dans le code, qui le dit. Une nouveauté y entre
// avec le code qui la sert, et en sort quand elle est devenue la règle pour tous (son code ne demande plus rien). La base
// ne tient que pour qui elle est allumée ; une ligne dont le code n'est plus ici, le serveur la tait.
//
// Le code qui sert une nouveauté demande `nouveauteAllumee(tx, entreprise, code)` : vrai si elle est allumée pour cette
// entreprise ou ouverte à toutes. Aucune nouveauté en service aujourd'hui (15/10/2026) : l'onglet le dit.

import type { Route } from './app.ts';
import type { Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';

// `nom` et `quoi` : ce que la console en dit à l'équipe (« La caisse en salle », « Les tables, les commandes en cuisine,
// l'addition… »), écrits avec le code qui la sert — une note de l'équipe, comme le nom d'une version.
export type Nouveaute = { code: string; nom: string; quoi: string };

export const NOUVEAUTES: readonly Nouveaute[] = [];

const CODE = /^[a-z][a-z0-9_]{1,40}$/;

// La liste d'un serveur (celle du code, ou celle qu'un essai lui donne), vérifiée une fois : un code bien formé, jamais
// deux fois.
export function listeDesNouveautes(liste: readonly Nouveaute[]): readonly Nouveaute[] {
  const vus = new Set<string>();
  for (const n of liste) {
    if (!CODE.test(n.code)) throw new Error(`nouveauté au code invalide : ${n.code}`);
    if (vus.has(n.code)) throw new Error(`la nouveauté ${n.code} est déclarée deux fois`);
    vus.add(n.code);
  }
  return liste;
}

// Les nouveautés allumées pour une entreprise, parmi celles que ce serveur porte. La base refuse qui n'est pas de
// l'entreprise.
export async function nouveautesDe(tx: Transaction, entreprise: string, liste: readonly Nouveaute[]): Promise<string[]> {
  const r = await tx.query('select plateforme.nouveautes_de($1) n', [entreprise]);
  const allumees = new Set((r.rows[0] as { n: string[] | null } | undefined)?.n ?? []);
  return liste.filter((n) => allumees.has(n.code)).map((n) => n.code);
}

export async function nouveauteAllumee(tx: Transaction, entreprise: string, code: string, liste: readonly Nouveaute[] = NOUVEAUTES): Promise<boolean> {
  return (await nouveautesDe(tx, entreprise, liste)).includes(code);
}

// Ce que la console montre (Réglages, « Nouveautés allumées ») : chaque nouveauté que ce serveur porte, son ouverture à
// tous, et les entreprises pour qui elle est allumée. Ce que la base dit d'un code que la liste ne porte plus, tu.
export type Allumee = { entreprise: string; numero: string | null; nom: string; le: string; par: string; motif: string };
export type Ouverture = { le: string; par: string; motif: string };
export type EtatNouveaute = Nouveaute & { ouverte: Ouverture | null; allumees: Allumee[] };

const texte = (x: unknown) => (typeof x === 'string' ? x : '');
const objets = (x: unknown): Record<string, unknown>[] =>
  Array.isArray(x) ? x.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)) : [];

export function etatDesNouveautes(liste: readonly Nouveaute[], brut: unknown): EtatNouveaute[] {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  const allumees = objets(b.allumees), ouvertes = objets(b.ouvertes);
  return liste.map((n) => {
    const o = ouvertes.find((x) => x.code === n.code);
    return {
      ...n,
      ouverte: o ? { le: texte(o.le), par: texte(o.par), motif: texte(o.motif) } : null,
      allumees: allumees.filter((a) => a.code === n.code).map((a) => ({
        entreprise: texte(a.entreprise), numero: typeof a.numero === 'string' ? a.numero : null, nom: texte(a.nom),
        le: texte(a.le), par: texte(a.par), motif: texte(a.motif),
      })),
    };
  });
}

// Les nouveautés allumées pour une entreprise, telles que l'écran qui en sert une les lira : la liste des codes, rien
// d'autre — ni qui les a allumées, ni pourquoi.
export function routesNouveautes(ctx: Contexte): Route<never>[] {
  const liste = listeDesNouveautes(ctx.nouveautes ?? NOUVEAUTES);
  return [{
    methode: 'GET', chemin: '/entreprises/:entreprise/nouveautes', geste: 'socle.accueil.voir',
    traiter: async ({ params }: { params: Record<string, string> }, tx: Transaction | null) => {
      if (!tx) throw new Error('transaction attendue');
      return { corps: { nouveautes: await nouveautesDe(tx, String(params.entreprise), liste) } };
    },
  } as unknown as Route<never>];
}
