// Les chaînes d'empreintes, relues seules (0115 ; l'audit F21 ; docs/console.md C38 ; 01 R9). Pur (testé :
// tests/console/suivi.test.ts) : la base relit et rend ; ces fonctions lisent ce qu'elle rend, et disent si la relecture
// tient son rythme. Ce qui est relu : chaque chaîne de la base (les factures par série, les écritures validées des
// livres), maillon par maillon — chaque maillon suit le précédent, chaque empreinte se recalcule, la fin de la chaîne est
// là. Ce qui ne l'est pas encore : le contenu de chaque pièce recomparé à son empreinte (serveur/journal.ts, `controler`,
// qui demande au module de relire sa pièce) ; l'écran le dit « pas encore mesuré », jamais « tout va bien ».

import { trenteJours } from './service.ts';

// Un tour par heure, deux cents chaînes par tour : les moins récemment relues d'abord. À VÉRIFIER à la mesure de charge
// (npm run charge) : le temps d'un lot sur une grande chaîne de caisse.
export const CHAINES_PAS_MS = 3_600_000;
export const CHAINES_PAR_LOT = 200;
// La relecture s'est arrêtée quand la dernière a plus d'un jour (et deux heures de marge).
export const RELECTURE_ARRETEE_H = 26;
// Les sortes de chaînes : le début de leur clé (« serie:<id> »).
export const SORTES_CHAINE = ['serie', 'livres', 'caisse'] as const;

export type Releve = { le: string; chaines: number; maillons: number; cassees: number; dureeMs: number };
export type Cassee = { sorte: string; rang: number | null; motif: string | null; le: string | null; entreprise: { id: string; nom: string } | null };
export type JourDeRelecture = { jour: string; n: number; cassees: number };
export type ChainesLues = {
  dernier: Releve | null; total: number; maillons: number; jamais: number; plusAncien: string | null; nCassees: number; cassees: Cassee[];
  jours: JourDeRelecture[];
};

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const date = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

export function lireChaines(x: unknown): ChainesLues {
  const o = objet(x), d = objet(o.dernier);
  const le = date(d.le);
  return {
    dernier: le ? { le, chaines: entier(d.chaines) ?? 0, maillons: entier(d.maillons) ?? 0, cassees: entier(d.cassees) ?? 0, dureeMs: entier(d.dureeMs) ?? 0 } : null,
    total: entier(o.total) ?? 0, maillons: entier(o.maillons) ?? 0, jamais: entier(o.jamais) ?? 0, plusAncien: date(o.plusAncien),
    nCassees: entier(o.nCassees) ?? 0,
    jours: (Array.isArray(o.jours) ? o.jours : []).flatMap((j) => {
      const y = objet(j);
      return typeof y.jour === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(y.jour) ? [{ jour: y.jour, n: entier(y.n) ?? 0, cassees: entier(y.cassees) ?? 0 }] : [];
    }),
    cassees: (Array.isArray(o.cassees) ? o.cassees : []).map((c) => {
      const y = objet(c), e = objet(y.entreprise);
      return {
        sorte: typeof y.sorte === 'string' ? y.sorte : '', rang: entier(y.rang), motif: typeof y.motif === 'string' ? y.motif : null, le: date(y.le),
        entreprise: typeof e.id === 'string' && typeof e.nom === 'string' ? { id: e.id, nom: e.nom } : null,
      };
    }),
  };
}

// Les trente jours d'une frise (les mêmes que ceux des briques du service : serveur/console/service.ts, `trenteJours`) :
// un jour sans relecture n'est pas « bon » (rien n'a été relu).
export type EtatJour = 'bon' | 'casse' | 'rien';
export function joursDeRelecture(jours: readonly JourDeRelecture[], aujourdhui: string): { jour: string; etat: EtatJour }[] {
  return trenteJours(aujourdhui).map((d) => {
    const j = jours.find((x) => x.jour === d);
    return { jour: d, etat: !j || j.n === 0 ? 'rien' : j.cassees > 0 ? 'casse' : 'bon' };
  });
}

// L'état de la relecture : `casse` (une chaîne au moins), `arretee` (la dernière relecture a plus de vingt-six heures),
// `jamais` (aucune relecture encore : un serveur d'avant cette version), ou `bonne`. Une base sans aucune chaîne n'a rien
// à relire : la relecture est bonne si elle tourne.
export type EtatRelecture = 'casse' | 'arretee' | 'jamais' | 'bonne';
export function etatRelecture(c: Pick<ChainesLues, 'dernier' | 'nCassees'>, maintenant: Date): EtatRelecture {
  if (c.nCassees > 0) return 'casse';
  if (!c.dernier) return 'jamais';
  return maintenant.getTime() - Date.parse(c.dernier.le) > RELECTURE_ARRETEE_H * 3_600_000 ? 'arretee' : 'bonne';
}
