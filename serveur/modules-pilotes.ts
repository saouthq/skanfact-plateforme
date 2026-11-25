// Les modules pilotés depuis la console (0226 ; Skander, 25/11/2026). Le catalogue vit ici, une fois : la console le
// liste, `/moi` le déplie en identifiants que les écrans connaissent déjà (`aVenir(id)`, `enBeta(id)` : une page, ou une
// fonction comme la facture électronique). Pur : la base ne fait que garder l'état posé.
//
// L'ordre de décision, du plus fort au plus faible : l'état posé pour CETTE entreprise, puis l'état posé pour tout le
// serveur, puis les variables du serveur (SKANFACT_A_VENIR, SKANFACT_BETA, a-venir.ts), puis « ouvert ».

import { aVenir, enBeta } from './a-venir.ts';
import { t } from '../textes/index.ts';

export const ETATS_MODULE = ['ouvert', 'beta', 'a_venir', 'ferme'] as const;
export type EtatModule = (typeof ETATS_MODULE)[number];

// Ce qu'un module allume dans les écrans : ses pages (la barre latérale) ou sa fonction (un réglage, un bouton).
// Les ventes et les fiches (clients, catalogue) n'y sont pas : sans elles, il n'y a plus d'application.
export const MODULES_PILOTES: readonly { id: string; ids: readonly string[] }[] = [
  { id: 'caisse', ids: ['caisse'] },
  { id: 'efacture', ids: ['efacture'] },
  { id: 'paiement', ids: ['paiement'] },
  { id: 'ia', ids: ['ia'] },
  { id: 'paie', ids: ['paie'] },
  { id: 'achats', ids: ['achats', 'fournisseurs'] },
  { id: 'stock', ids: ['stock', 'garanties'] },
  { id: 'immos', ids: ['immos'] },
  { id: 'pieces', ids: ['autres', 'contrats'] },
  { id: 'pilotage', ids: ['tresorerie', 'marges', 'stats'] },
  { id: 'compta', ids: ['compta'] },
];
// Leur nom et ce qu'ils font : au catalogue des textes (serveur/console/textes.ts, la console les lit).
export const nomModule = (id: string) => ({ nom: t(`modules.${id}.nom`), quoi: t(`modules.${id}.quoi`) });
export const moduleConnu = (id: string) => MODULES_PILOTES.some((m) => m.id === id);

export type LigneEtat = { module: string; entreprise: string | null; etat: EtatModule };

// L'état d'un module par les variables du serveur (ce qui valait avant la console).
export function etatServeur(module: string, env: Record<string, string | undefined> = process.env): EtatModule {
  if (aVenir(env).includes(module)) return 'a_venir';
  if (enBeta(env).includes(module)) return 'beta';
  return 'ouvert';
}

// L'état qui vaut pour une entreprise (ou pour tout le serveur, entreprise null).
export function etatModule(lignes: readonly LigneEtat[], module: string, entreprise: string | null, env: Record<string, string | undefined> = process.env): EtatModule {
  const propre = entreprise ? lignes.find((l) => l.module === module && l.entreprise === entreprise) : undefined;
  if (propre) return propre.etat;
  const general = lignes.find((l) => l.module === module && l.entreprise === null);
  return general ? general.etat : etatServeur(module, env);
}

// Ce que les écrans reçoivent : trois listes d'identifiants (pages ou fonctions).
export function listesModules(lignes: readonly LigneEtat[], entreprise: string | null, env: Record<string, string | undefined> = process.env) {
  const out = { aVenir: [] as string[], beta: [] as string[], ferme: [] as string[] };
  for (const m of MODULES_PILOTES) {
    const e = etatModule(lignes, m.id, entreprise, env);
    if (e === 'a_venir') out.aVenir.push(...m.ids);
    else if (e === 'beta') out.beta.push(...m.ids);
    else if (e === 'ferme') out.ferme.push(...m.ids);
  }
  return out;
}

// Une fonction refusée côté serveur quand elle n'est pas ouverte (à venir ou fermée) : l'écran la cache, mais un appel
// direct ne doit pas la servir non plus.
export const moduleUtilisable = (e: EtatModule) => e === 'ouvert' || e === 'beta';

export function lireLignes(brut: unknown): LigneEtat[] {
  if (!Array.isArray(brut)) return [];
  return (brut as Record<string, unknown>[]).flatMap((x) => {
    const etat = String(x.etat) as EtatModule;
    return typeof x.module === 'string' && (ETATS_MODULE as readonly string[]).includes(etat)
      ? [{ module: x.module, entreprise: typeof x.entreprise === 'string' ? x.entreprise : null, etat }] : [];
  });
}

// Le geste d'un module qui n'est pas ouvert (à venir, fermé) se refuse aussi côté serveur : l'écran le cache, mais un
// appel direct ne doit pas le servir. `requete` lit l'état posé (socle.etat_module) ; rien de posé : la variable du serveur.
export async function moduleOuvertPour(requete: (sql: string, v: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>, module: string, entreprise: string): Promise<boolean> {
  const pose = (await requete('select socle.etat_module($1, $2) v', [module, entreprise])).rows[0]?.v;
  const etat = typeof pose === 'string' && (ETATS_MODULE as readonly string[]).includes(pose) ? pose as EtatModule : etatServeur(module);
  return moduleUtilisable(etat);
}
