// Les chaînes d'empreintes, relues seules (0115 ; l'audit F21 ; docs/console.md C38 ; 01 R9). Pur (testé :
// tests/console/suivi.test.ts) : la base relit et rend ; ces fonctions lisent ce qu'elle rend, et disent si la relecture
// tient son rythme. Ce qui est relu : chaque chaîne de la base (les factures par série, les écritures validées des
// livres), maillon par maillon — chaque maillon suit le précédent, chaque empreinte se recalcule, la fin de la chaîne est
// là. Depuis 0142 (docs/console.md C66), le contenu de chaque pièce aussi, recalculé et recomparé à son empreinte
// (serveur/service/contenus.ts) : une chaîne cassée dit ce qui casse (`quoi` : ses liens, ou le contenu d'une pièce). Une
// relecture se demande depuis la console (pour une entreprise, ou pour toutes) : `demande` dit où elle en est.

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
// `entreprise` : pour la direction seulement ; la technique ne reçoit aucun identifiant de client (03 § 5).
export type EntrepriseNommee = { id: string; nom: string; numero: string | null };
export type Cassee = { sorte: string; quoi: 'liens' | 'contenu'; rang: number | null; motif: string | null; le: string | null; entreprise: EntrepriseNommee | null };
export type JourDeRelecture = { jour: string; n: number; cassees: number };
export type ContenuLu = {
  dernier: { le: string; chaines: number; pieces: number; cassees: number; dureeMs: number } | null;
  jamais: number; plusAncien: string | null; nCassees: number; nonRelues: number; enAttente: number;
};
export type DemandeLue = {
  id: string; demandeeLe: string; par: string; toutes: boolean; entreprise: EntrepriseNommee | null;
  total: number | null; faites: number; pieces: number; cassees: number; commencee: boolean; nouvelleLe: string | null; finieLe: string | null;
};
export type ChainesLues = {
  dernier: Releve | null; total: number; maillons: number; jamais: number; plusAncien: string | null; nCassees: number; cassees: Cassee[];
  jours: JourDeRelecture[]; contenu: ContenuLu; demande: DemandeLue | null; incident: { id: string; annee: number; numero: number } | null;
};

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const date = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const nommee = (v: unknown): EntrepriseNommee | null => {
  const e = objet(v);
  return typeof e.id === 'string' && typeof e.nom === 'string' ? { id: e.id, nom: e.nom, numero: typeof e.numero === 'string' ? e.numero : null } : null;
};

function lireContenu(x: unknown): ContenuLu {
  const o = objet(x), d = objet(o.dernier);
  const le = date(d.le);
  return {
    dernier: le ? { le, chaines: entier(d.chaines) ?? 0, pieces: entier(d.pieces) ?? 0, cassees: entier(d.cassees) ?? 0, dureeMs: entier(d.dureeMs) ?? 0 } : null,
    jamais: entier(o.jamais) ?? 0, plusAncien: date(o.plusAncien), nCassees: entier(o.nCassees) ?? 0, nonRelues: entier(o.nonRelues) ?? 0, enAttente: entier(o.enAttente) ?? 0,
  };
}

function lireDemande(x: unknown): DemandeLue | null {
  const o = objet(x);
  const le = date(o.demandeeLe);
  if (typeof o.id !== 'string' || !le) return null;
  return {
    id: o.id, demandeeLe: le, par: typeof o.par === 'string' ? o.par : '', toutes: o.toutes === true, entreprise: nommee(o.entreprise),
    total: entier(o.total), faites: entier(o.faites) ?? 0, pieces: entier(o.pieces) ?? 0, cassees: entier(o.cassees) ?? 0, commencee: o.commencee === true,
    nouvelleLe: date(o.nouvelleLe), finieLe: date(o.finieLe),
  };
}

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
      const y = objet(c);
      return {
        sorte: typeof y.sorte === 'string' ? y.sorte : '', quoi: y.quoi === 'contenu' ? 'contenu' as const : 'liens' as const,
        rang: entier(y.rang), motif: typeof y.motif === 'string' ? y.motif : null, le: date(y.le), entreprise: nommee(y.entreprise),
      };
    }),
    contenu: lireContenu(o.contenu),
    demande: lireDemande(o.demande),
    incident: (() => {
      const i = objet(o.incident);
      return typeof i.id === 'string' && entier(i.annee) !== null && entier(i.numero) !== null ? { id: i.id, annee: entier(i.annee) ?? 0, numero: entier(i.numero) ?? 0 } : null;
    })(),
  };
}

// Une relecture demandée qui ne bouge plus : sans nouvelle du serveur depuis plus de cinq minutes (un serveur arrêté en
// route la laisse, un autre la reprend), ou jamais prise depuis plus de cinq minutes (aucun serveur ne la cherche).
export const DEMANDE_ARRETEE_MIN = 5;
export function demandeArretee(d: Pick<DemandeLue, 'demandeeLe' | 'nouvelleLe' | 'finieLe'>, maintenant: Date): boolean {
  if (d.finieLe) return false;
  return maintenant.getTime() - Date.parse(d.nouvelleLe ?? d.demandeeLe) > DEMANDE_ARRETEE_MIN * 60_000;
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
