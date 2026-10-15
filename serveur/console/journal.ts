// Le journal de la console, exploitable (docs/console.md C37 ; l'audit F33 ; la maquette Journal ; 0114,
// plateforme.console_journal). Pur (testé : tests/console/journal.test.ts) : la route lit la base ; ces fonctions disent
// ce qu'un geste du journal est, et ce que les filtres demandent.
//   - un geste du journal est permis par un geste de la console (`gesteDeLaConsole`) ; il est RÉSERVÉ À LA DIRECTION quand
//     ce geste-là n'est ouvert qu'à elle — lu dans la liste des gestes (serveur/console/gestes.ts), jamais recopié ;
//   - la période : aujourd'hui, sept jours, trente jours (par défaut, comme les chiffres), ou tout ;
//   - la sorte : celle que la base donne à chaque ligne (plateforme.sorte_du_geste), une seule règle.

import { GESTES_CONSOLE } from './gestes.ts';

// Le geste de la console qui permet chaque geste du journal, par son nom. Le premier qui convient l'emporte.
const PERMIS: readonly [RegExp, string][] = [
  [/^abonnement\.prolonger$/, 'console.abonnement.prolonger'],
  [/^abonnement\.offrir[-_]mois$/, 'console.abonnement.offrir_mois'],
  [/^(abonnement|groupes)\./, 'console.abonnement.gerer'],
  [/^clients\.appel$/, 'console.clients.appeler'],
  [/^clients\.ecrit$/, 'console.clients.ecrire'],
  [/^clients\.exporte$/, 'console.clients.exporter'],
  [/^clients\.reprise/, 'console.clients.reprise'],
  [/^clients\.sortie/, 'console.clients.sortie'],
  [/^journal\.exporte$/, 'console.journal.exporter'],
  // Fermer une session, oublier un appareil : chacun le fait pour lui-même (la direction, aussi pour les autres).
  [/^equipe\.(session_fermee|appareil_oublie)$/, 'console.session'],
  [/^equipe\./, 'console.equipe.gerer'],
  [/^factures\./, 'console.factures.preparer'],
  [/^paiements\.(contester|regulariser)$/, 'console.contestations'],
  [/^paiements\./, 'console.paiements.couts'],
  [/^reglages\./, 'console.reglages.gerer'],
  [/^service\.remise$/, 'console.service.remise'],
  [/^(service|versions)\./, 'console.service.gerer'],
  [/^support\.acces/, 'console.support.acces'],
  [/^support\.doc_(validee|retiree)$/, 'console.support.valider'],
  [/^support\./, 'console.support.repondre'],
];
export const gesteDeLaConsole = (geste: string): string | null => PERMIS.find(([r]) => r.test(geste))?.[1] ?? null;
export function reserveALaDirection(geste: string): boolean {
  const c = gesteDeLaConsole(geste);
  const g = c ? GESTES_CONSOLE.get(c) : undefined;
  return !!g && g.roles.length === 1 && g.roles[0] === 'direction';
}

export const PLAGES = ['1j', '7j', '30j', 'tout'] as const;
export type Plage = typeof PLAGES[number];
export const plageDe = (v: unknown): Plage => (PLAGES.includes(v as Plage) ? v as Plage : '30j');
// Le premier instant de la période, au jour de Tunis : « aujourd'hui » commence à minuit à Tunis (UTC+1, sans heure d'été).
export function depuisLa(plage: Plage, aujourdhui: string): Date | null {
  if (plage === 'tout') return null;
  const jours = plage === '1j' ? 0 : plage === '7j' ? 6 : 29;
  const t = Date.parse(`${aujourdhui}T00:00:00+01:00`) - jours * 86_400_000;
  return new Date(t);
}

export const SORTES = ['abonnements', 'clients', 'paiements', 'factures', 'support', 'acces', 'service', 'reglages', 'equipe', 'journal', 'systeme'] as const;
export type Sorte = typeof SORTES[number];
export const sorteDe = (v: unknown): Sorte | null => (SORTES.includes(v as Sorte) ? v as Sorte : null);
