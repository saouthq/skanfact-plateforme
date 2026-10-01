// Qui lit et qui écrit chaque partie du dossier v10 (brique 99 ; 03 § 2.1 ; docs/droits-dossier.md).
//
// Le dossier de la v10 se découpe en parties : une liste (les pièces, les clients, les salariés…) ou un champ de
// la racine (la fiche société, les compteurs…). Chaque partie a un geste pour la lire et un pour l'écrire, pris
// dans les gestes déclarés des modules ; la porte les juge sur les rôles de la personne. Une partie sans règle
// n'est lue et écrite que par ceux qui voient toute l'entreprise (le propriétaire, l'administrateur) : la valeur
// par défaut qui ne donne rien de plus.

import { t } from '../../textes/index.ts';
import { Refus } from '../erreurs.ts';
import type { Transaction } from '../base.ts';
import { declarerGestes, GESTES, type Acces, type Geste } from '../porte/gestes.ts';
import { declarerGestesAchats } from '../achats/gestes.ts';
import { declarerGestesCaisse } from '../caisse/gestes.ts';
import { declarerGestesCompta } from '../compta/gestes.ts';
import { declarerGestesPaie } from '../paie/gestes.ts';
import { declarerGestesVentes } from '../ventes/gestes.ts';
import './textes.ts';


const P: Acces = 'oui';
const V: Acces = 'voir';
// Les gestes des parties du dossier qui n'ont pas encore de module à eux (03 § 2.1).
export const GESTES_DU_DOSSIER: Geste[] = [
  { code: 'ventes.prix.modifier', module: 'ventes', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P, commercial: V, caissier: V, magasinier: V, comptabilite_interne: V, lecture: V } },
  { code: 'stock.voir', module: 'stock', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P, commercial: V, caissier: V, magasinier: P, comptabilite_interne: V, lecture: V } },
  { code: 'stock.modifier', module: 'stock', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P, magasinier: P } },
  { code: 'achats.pieces.modifier', module: 'achats', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: P } },
  { code: 'tresorerie.voir', module: 'tresorerie', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: P, lecture: V } },
  // La liste des comptes (brique 121) : le caissier la lit, pour que les espèces aillent au compte de caisse et la carte
  // à la banque ; il ne lit ni les mouvements ni la page Trésorerie.
  { code: 'tresorerie.comptes.voir', module: 'tresorerie', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: P, lecture: V, caissier: V } },
  { code: 'tresorerie.modifier', module: 'tresorerie', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: P } },
  { code: 'tresorerie.comptes.modifier', module: 'tresorerie', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
];
declarerGestes(GESTES_DU_DOSSIER);
// Les règles s'appuient sur les gestes des modules : ils sont déclarés ici aussi (une seule fois chacun).
declarerGestesVentes(); declarerGestesCaisse(); declarerGestesAchats(); declarerGestesPaie(); declarerGestesCompta();

type Regle = { voir: string; ecrire: string };
const R = (voir: string, ecrire: string): Regle => ({ voir, ecrire });
const VENTES = R('ventes.pieces.voir', 'ventes.brouillon.modifier');
const ACHATS = R('achats.pieces.voir', 'achats.pieces.modifier');
const PAIE = R('paie.dossier.voir', 'paie.dossier.modifier');
const COMPTA = R('compta.livres.voir', 'compta.ecritures.saisir');
const STOCK = R('stock.voir', 'stock.modifier');
// Ce que l'écran tient pour lui-même en travaillant (les compteurs de ses numéros, les pièces supprimées, les
// versions écartées) : lu et écrit par quiconque écrit dans le dossier.
const TECHNIQUE = R('socle.dossier.voir', 'socle.dossier.modifier');
const TOUT = R('socle.dossier.tout', 'socle.dossier.tout');

export const LISTES: Record<string, Regle> = {
  documents: VENTES, recurring: VENTES, templates: VENTES, snippets: VENTES, projects: VENTES,
  clients: R('ventes.pieces.voir', 'ventes.client.modifier'),
  catalog: R('stock.voir', 'ventes.prix.modifier'), priceLists: R('ventes.pieces.voir', 'ventes.prix.modifier'),
  suppliers: ACHATS, purchases: ACHATS, supplierOrders: ACHATS, receptions: ACHATS,
  accounts: R('tresorerie.comptes.voir', 'tresorerie.comptes.modifier'), movements: R('tresorerie.voir', 'tresorerie.modifier'),
  stockAdjustments: STOCK, serials: STOCK, depots: STOCK,
  employees: PAIE, payslips: PAIE, leaves: PAIE, advances: PAIE, socialFilings: PAIE,
  assets: COMPTA, ecrituresOD: COMPTA, fiscalFilings: COMPTA, clotures: COMPTA, fiscalDeadlines: COMPTA,
  deleted: TECHNIQUE, conflictArchive: TECHNIQUE,
};
export const RACINE: Record<string, Regle> = {
  company: R('socle.accueil.voir', 'socle.fiche_societe.modifier'),
  version: TECHNIQUE, counters: TECHNIQUE, deleted: TECHNIQUE, conflictArchive: TECHNIQUE, demo: TECHNIQUE, exemple: TECHNIQUE,
  expenseCategories: ACHATS, fixedCategories: ACHATS, depotPrincipalNom: STOCK,
  payrollSettings: PAIE, vatCarryIn: COMPTA,
  // Tout le monde doit savoir jusqu'où c'est clôturé (l'écran refuse de modifier avant) ; seuls ceux qui clôturent l'écrivent.
  closedUntil: R('socle.accueil.voir', 'compta.exercice.cloturer'), closureLog: R('socle.accueil.voir', 'compta.exercice.cloturer'),
  auxiliaires: R('socle.accueil.voir', 'socle.reglages_fiscaux.modifier'),
};
// Une liste vide, l'écran l'écrit comme un champ de la racine (`_racine/recurring` = []) : c'est la même partie.
export function regleDe(collection: string, cle: string): Regle {
  return (collection === '_racine' ? RACINE[cle] ?? LISTES[cle] : LISTES[collection]) ?? TOUT;
}
// Le nom d'une partie, pour un refus (« les bulletins de paie ») : celui de la liste, ou du champ de la racine.
const NOMMEES = new Set([...Object.keys(LISTES), ...Object.keys(RACINE)]);
const partie = (collection: string, cle: string) => { const n = collection === '_racine' ? cle : collection; return t(`v10.partie.${NOMMEES.has(n) ? n : 'autre'}`); };

// Les rôles de la personne dans l'entreprise (l'union, 03 D7).
export async function mesRoles(tx: Transaction, entreprise: string): Promise<string[]> {
  return ((await tx.query('select socle.mes_roles($1) r', [entreprise])).rows[0]?.r ?? []) as string[];
}
export function permet(roles: string[], geste: string, ecrire: boolean): boolean {
  const g = GESTES.get(geste);
  if (!g) return false;
  return roles.some((r) => { const a = (g.roles as Record<string, string | undefined>)[r]; return a === 'oui' || (!ecrire && a === 'voir'); });
}

// Ce qu'une personne lit : les objets dont la partie lui est visible ; et, pour l'écran, les parties qu'il ne
// doit ni montrer ni renvoyer (`cachees`), et celles qu'il lit sans pouvoir les écrire (`lectureSeule`).
export function filtrer<O extends { collection: string; cle: string }>(roles: string[], objets: O[]) {
  const visibles = objets.filter((o) => permet(roles, regleDe(o.collection, o.cle).voir, false));
  const parties = [...Object.keys(LISTES).map((c) => ['', c] as const), ...Object.keys(RACINE).map((k) => ['_racine', k] as const)];
  const cachees = new Set<string>(), lectureSeule = new Set<string>(), ecrivables = new Set<string>();
  for (const [col, nom] of parties) {
    const r = col ? RACINE[nom] as Regle : LISTES[nom] as Regle;
    if (!permet(roles, r.voir, false)) cachees.add(nom);
    else if (!permet(roles, r.ecrire, true)) lectureSeule.add(nom);
    else ecrivables.add(nom);
  }
  // `ecrivables` : la liste blanche de ce que l'écran peut renvoyer ; `tout` : il peut tout renvoyer ; `responsable` : il
  // règle les seuils et décide des accords (brique 100 : l'écran grise ce que la base refuserait).
  return { objets: visibles, droits: { cachees: [...cachees].sort(), lectureSeule: [...lectureSeule].sort(), ecrivables: [...ecrivables].sort(),
    tout: permet(roles, TOUT.ecrire, true), responsable: permet(roles, 'ventes.accord.donner', true),
    // Il tient une caisse (brique 121) : la page Caisse s'ouvre, même sans lire les pièces de vente.
    caisse: permet(roles, 'caisse.ticket.encaisser', true) } };
}

// Avant d'écrire : chaque changement doit être permis ; sinon rien n'est écrit, et le refus nomme la partie.
export function verifierEcriture(roles: string[], changements: { collection: string; cle: string }[]) {
  for (const c of changements) {
    if (!permet(roles, regleDe(c.collection, c.cle).ecrire, true)) {
      throw new Refus('v10.partie_interdite', { valeurs: { partie: partie(c.collection, c.cle) } });
    }
  }
}

// Le caissier (brique 121 ; 03 § 2.1, « voir les sessions : la sienne ») : il ne lit pas les pièces de vente, mais ses
// propres tickets, ceux qu'il a encaissés. Pour qui lit les pièces de vente, rien ne change.
export async function avecSesTickets<O extends { collection: string; cle: string; contenu: unknown }>(tx: Transaction, entreprise: string,
  utilisateur: string, roles: string[], tous: O[], visibles: O[]): Promise<O[]> {
  if (permet(roles, 'ventes.pieces.voir', false) || !permet(roles, 'caisse.ticket.encaisser', true)) return visibles;
  const siens = new Set((await tx.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'documents'
    and cree_par = $2 and contenu ->> 'ticket' = 'true'`, [entreprise, utilisateur])).rows.map((r) => String(r.cle)));
  return [...visibles, ...tous.filter((o) => o.collection === 'documents' && siens.has(o.cle))];
}
