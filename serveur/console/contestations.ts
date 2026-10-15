// Les contestations de nos factures (1.36.0 ; base 0129 ; docs/console.md C52 ; la liste des fonctions qui manquent, 13),
// pur : ce que la base rend, lu prudemment (une ligne illisible n'existe pas, jamais une valeur devinée). Paiements les
// montre, la fiche dit celles de son client, « À décider » nomme celles qui attendent leur régularisation depuis une
// semaine — par la même lecture.

import { joursEntre } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';

export const CANAUX_CONTESTATION = ['telephone', 'courriel', 'whatsapp', 'support', 'autre'] as const;
export type CanalContestation = typeof CANAUX_CONTESTATION[number];
export const ISSUES = ['avoir', 'remboursement', 'maintenue', 'retiree'] as const;
export type Issue = typeof ISSUES[number];
// Une contestation qui attend sa régularisation depuis une semaine entre dans « À décider » (À DÉCIDER : le délai).
export const CONTESTATION_JOURS = 7;

export type Contestation = {
  id: string; facture: string; piece: string; numero: string | null; entreprise: { id: string; nom: string };
  canal: CanalContestation; dit: string; ouverteLe: string; ouvertePar: string | null;
  close: { le: string; issue: Issue; reference: string | null; motif: string; par: string | null } | null;
};

const texte = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const instant = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

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
      close: c && issue && closeLe ? { le: closeLe, issue, reference: texte(c.reference), motif: texte(c.motif) ?? '', par: texte(c.par) } : null,
    });
  }
  return out;
}

// Depuis combien de jours (de Tunis) une contestation attend.
export const joursDAttente = (c: Pick<Contestation, 'ouverteLe'>, jour: string) => Math.max(0, joursEntre(aujourdhuiATunis(new Date(c.ouverteLe)), jour));
export const enCours = (l: readonly Contestation[]) => l.filter((c) => c.close === null);
