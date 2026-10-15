// Ce qui doit rentrer (1.39.0 ; docs/console.md C55 ; la liste des fonctions qui manquent, 14 : « prévisions de revenus et
// de trésorerie : revenus attendus, impayés et échéances »), pur. Sur trois mois, le mois en cours compris, à partir
// d'aujourd'hui :
//   - ce qui reste dû sur nos factures émises, par le mois de leur échéance — par la liste « Qui doit encore » de
//     Paiements (la même fonction : `ouvertes`), jamais recomptée ; ce qui est déjà en retard, à part ;
//   - les renouvellements attendus qui n'ont pas encore leur facture, par le mois où leur période commence — au prix de
//     la prochaine facture (serveur/console/renouvellements.ts, la règle de la facture), HORS TAXES.
// Les deux ne s'additionnent jamais : une facture dit un montant taxes comprises, un renouvellement un hors-taxes (la
// facture y ajoutera la TVA et le timbre du jour). Un renouvellement dont un prix manque se compte à part, sans montant :
// rien ne s'invente. Ce n'est pas une promesse : un client peut partir, payer en retard ou changer d'offre.

import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { plusMois } from '../abonnement/etat.ts';
import type { Doit } from './paiements.ts';
import type { Renouvellements } from './renouvellements.ts';

export const PREVISION_MOIS = 3;
export type MoisPrevu = { mois: string; du: { montant: string; n: number }; attendu: { montantHt: string; n: number } };
export type Previsions = {
  devise: string; mois: MoisPrevu[];
  // Ce qui est déjà en retard (l'échéance passée), et ce qui tombe après les trois mois.
  retard: { montant: string; n: number }; plusTard: { montant: string; n: number };
  // Des renouvellements attendus sans prix (une grille qui manque) : comptés, sans montant. Ceux d'un client dont la sortie
  // est ouverte (0131) : écartés, il ne renouvellera pas — comptés à part.
  sansPrix: number; partants: number;
};
// Une période déjà facturée (émise, ou préparée qui attend d'être émise) n'est plus un renouvellement attendu.
export type DejaFacture = { entreprise: { id: string }; debut: string };

const moisDe = (jour: string) => jour.slice(0, 7);

export function prevoir(doivent: readonly Doit[], renouvellements: Renouvellements, dejaFactures: readonly DejaFacture[], aujourdhui: string,
  devise: string, decimales: number, partants: ReadonlySet<string> = new Set()): Previsions {
  const mois = Array.from({ length: PREVISION_MOIS }, (_, i) => moisDe(plusMois(`${moisDe(aujourdhui)}-01`, i)));
  const du = new Map(mois.map((m) => [m, { montant: 0n, n: 0 }]));
  const attendu = new Map(mois.map((m) => [m, { montant: 0n, n: 0 }]));
  const retard = { montant: 0n, n: 0 }, plusTard = { montant: 0n, n: 0 };
  let sansPrix = 0, ecartes = 0;
  for (const d of doivent) {
    if (d.devise !== devise) continue;
    const reste = depuisTexte(d.reste, decimales);
    // Sans échéance, une facture est due au premier jour de sa période (07 : payée d'avance).
    const echeance = d.echeance ?? d.debut;
    const case_ = echeance < aujourdhui ? retard : du.get(moisDe(echeance)) ?? (echeance > aujourdhui ? plusTard : retard);
    case_.montant += reste; case_.n += 1;
  }
  const factures = new Set(dejaFactures.map((f) => `${f.entreprise.id}|${f.debut}`));
  for (const [entreprise, r] of renouvellements) {
    if (partants.has(entreprise)) { ecartes += 1; continue; }
    if (!r) { sansPrix += 1; continue; }
    if (factures.has(`${entreprise}|${r.debut}`)) continue;
    // Une période qui aurait dû commencer avant ce mois (une grâce, une période non renouvelée) est encore attendue : ce
    // mois-ci.
    const m = r.debut < `${mois[0]}-01` ? mois[0] : moisDe(r.debut);
    const c = m ? attendu.get(m) : undefined;
    if (!c) continue;
    c.montant += r.periodeHt; c.n += 1;
  }
  const t = (v: bigint) => versTexte(v, decimales);
  return {
    devise,
    mois: mois.map((m) => {
      const a = du.get(m) ?? { montant: 0n, n: 0 }, b = attendu.get(m) ?? { montant: 0n, n: 0 };
      return { mois: m, du: { montant: t(a.montant), n: a.n }, attendu: { montantHt: versTexte(b.montant, 3), n: b.n } };
    }),
    retard: { montant: t(retard.montant), n: retard.n }, plusTard: { montant: t(plusTard.montant), n: plusTard.n }, sansPrix, partants: ecartes,
  };
}
