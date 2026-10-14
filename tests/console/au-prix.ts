// Ce que la base rendrait (plateforme.console_renouvellements) pour une liste, d'après une grille de prix fixe, des
// remises et des lignes en plus données : les tests de la liste et des échéances comptent par la MÊME règle que le
// serveur (aRenouveler, lireRenouvellements, la règle de la facture) ; seule la base est remplacée.

import type { Entreprise } from '../../serveur/console/decider.ts';
import type { Prix, Remises } from '../../serveur/console/echeances.ts';
import { aRenouveler, lireRenouvellements, type Renouvellements } from '../../serveur/console/renouvellements.ts';

export function auPrix(liste: readonly Entreprise[], jour: string, prix: Prix, remises: Remises = new Map(), enPlus: Record<string, unknown[]> = {}): Renouvellements {
  const demandes = liste.flatMap((e) => aRenouveler(e, jour) ?? []);
  return lireRenouvellements(demandes, Object.fromEntries(demandes.map((d) => {
    const p = prix.get(`${d.offre}/${d.periodicite}`);
    return [d.entreprise, p === undefined ? { incalculable: true } : { prixHt: p.toString(), enPlus: enPlus[d.entreprise] ?? [], remise: remises.get(d.entreprise) ?? null }];
  })));
}
