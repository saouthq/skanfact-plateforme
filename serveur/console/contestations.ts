// Les contestations de nos factures (1.36.0 ; base 0129 ; docs/console.md C52 ; la liste des fonctions qui manquent, 13),
// pur : ce que la base rend, lu prudemment (une ligne illisible n'existe pas, jamais une valeur devinée). Paiements les
// montre, la fiche dit celles de son client, « À décider » nomme celles qui attendent leur régularisation depuis une
// semaine — par la même lecture.

import { versTexte } from '../../moteur/argent.ts';
import { joursEntre } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';

export const CANAUX_CONTESTATION = ['telephone', 'courriel', 'whatsapp', 'support', 'autre'] as const;
export type CanalContestation = typeof CANAUX_CONTESTATION[number];
export const ISSUES = ['avoir', 'remboursement', 'maintenue', 'retiree'] as const;
export type Issue = typeof ISSUES[number];
// Une contestation qui attend sa régularisation depuis une semaine entre dans « À décider » (À DÉCIDER : le délai).
export const CONTESTATION_JOURS = 7;

// Le rapprochement d'une régularisation (0138, l'audit 1.42.0 A04) : `montant` (l'avoir, ou le remboursement déclaré, en
// texte), `partiel` (il couvre moins que la facture), `rapproche` (un avoir l'est toujours : la base l'a trouvé, émis sur
// cette facture ; un remboursement l'est quand SkanFact a noté sur la facture des règlements négatifs qui le couvrent) ;
// tous vides pour une régularisation d'avant la 1.46.0, qui n'avait que sa référence.
export type Rapprochement = { montant: string; le: string | null; partiel: boolean; rapproche: boolean };
export type Contestation = {
  id: string; facture: string; piece: string; numero: string | null; entreprise: { id: string; nom: string };
  canal: CanalContestation; dit: string; ouverteLe: string; ouvertePar: string | null;
  close: { le: string; issue: Issue; reference: string | null; motif: string; par: string | null; rapprochement: Rapprochement | null } | null;
};

const texte = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const entier = (v: unknown): bigint | null => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null);
const jour = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Ce qu'une régularisation rapproche, lu de ce que la base rend : sans montant lisible, rien (jamais deviné).
function rapprochementDe(issue: Issue, c: Record<string, unknown>, x: Record<string, unknown>): Rapprochement | null {
  // Déjà mis en forme par une première lecture (la fiche, Paiements) : relu tel quel.
  const r = c.rapprochement && typeof c.rapprochement === 'object' ? c.rapprochement as Record<string, unknown> : null;
  if (r && typeof r.montant === 'string' && /^\d+\.\d{3}$/.test(r.montant)) {
    return { montant: r.montant, le: jour(r.le), partiel: r.partiel === true, rapproche: r.rapproche === true };
  }
  const montant = entier(c.montant);
  if (montant === null || (issue !== 'avoir' && issue !== 'remboursement')) return null;
  const net = entier(x.net), timbre = entier(x.timbre) ?? 0n;
  if (issue === 'avoir') return { montant: versTexte(montant, 3), le: null, partiel: net !== null && montant < net - timbre, rapproche: true };
  const note = entier(c.rembourseNote);
  return { montant: versTexte(montant, 3), le: jour(c.rembourseLe), partiel: net !== null && montant < net, rapproche: note !== null && note >= montant };
}

export function lireContestations(brut: unknown): Contestation[] {
  if (!Array.isArray(brut)) return [];
  const out: Contestation[] = [];
  for (const x of brut as Record<string, unknown>[]) {
    const e = (x.entreprise ?? {}) as Record<string, unknown>;
    const id = texte(x.id), facture = texte(x.facture), piece = texte(x.piece), dit = texte(x.dit), ouverteLe = instant(x.ouverteLe);
    const canal = CANAUX_CONTESTATION.find((c) => c === x.canal);
    if (!id || !facture || !piece || !dit || !ouverteLe || !canal || !texte(e.id)) continue;
    const c = x.close as Record<string, unknown> | null;
    const issue = c ? ISSUES.find((i) => i === c.issue) : undefined;
    const closeLe = c ? instant(c.le) : null;
    // Close, elle dit son issue et son jour ; une clôture illisible ne se devine pas : la ligne n'est pas lue.
    if (c && (!issue || !closeLe)) continue;
    out.push({
      id, facture, piece, numero: texte(x.numero), entreprise: { id: String(e.id), nom: texte(e.nom) ?? '—' }, canal, dit, ouverteLe, ouvertePar: texte(x.ouvertePar),
      close: c && issue && closeLe ? { le: closeLe, issue, reference: texte(c.reference), motif: texte(c.motif) ?? '', par: texte(c.par), rapprochement: rapprochementDe(issue, c, x) } : null,
    });
  }
  return out;
}

// Depuis combien de jours (de Tunis) une contestation attend.
export const joursDAttente = (c: Pick<Contestation, 'ouverteLe'>, jour: string) => Math.max(0, joursEntre(aujourdhuiATunis(new Date(c.ouverteLe)), jour));
export const enCours = (l: readonly Contestation[]) => l.filter((c) => c.close === null);
// Un remboursement déclaré que SkanFact n'a pas encore noté sur la facture : il attend son rapprochement (0138, A04).
export const aRapprocher = (l: readonly Contestation[]) => l.filter((c) => c.close?.issue === 'remboursement' && c.close.rapprochement?.rapproche === false);
