// Ce qui doit rentrer (1.39.0 ; docs/console.md C55 ; la liste des fonctions qui manquent, 14 : « prévisions de revenus et
// de trésorerie : revenus attendus, impayés et échéances »), pur. Sur trois mois, le mois en cours compris, à partir
// d'aujourd'hui :
//   - ce qui reste dû sur nos factures émises, par le mois de leur échéance — par la liste « Qui doit encore » de
//     Paiements (la même fonction : `ouvertes`), jamais recomptée ; ce qui est déjà en retard, à part ;
//   - nos factures préparées, pas encore émises (1.45.0, l'audit 1.42.0 A05), par le mois où leur période commence — au
//     montant hors taxes qu'elles portent (celui de la règle de la facture, noté à leur préparation) : préparer une
//     facture la fait passer d'une colonne à l'autre, jamais disparaître ;
//   - les renouvellements attendus qui n'ont pas encore leur facture, par le mois où leur période commence — au prix de
//     la prochaine facture (serveur/console/renouvellements.ts, la règle de la facture), HORS TAXES. Un abonnement
//     mensuel se renouvelle chaque mois des trois (1.45.0, A05) : la première période au prix de la prochaine facture
//     (rattrapage compris), les suivantes au prix d'un mois ; un abonnement qui attend déjà son paiement, sa seule
//     période attendue.
// Le dû ne s'additionne jamais au reste : une facture émise dit un montant taxes comprises, une préparée et un
// renouvellement un hors-taxes (la facture y ajoutera la TVA et le timbre du jour). Un renouvellement dont un prix manque
// se compte à part, sans montant : rien ne s'invente. Ce n'est pas une promesse : un client peut partir, payer en retard ou
// changer d'offre.

import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { plusMois } from '../abonnement/etat.ts';
import type { Doit } from './paiements.ts';
import type { Renouvellements } from './renouvellements.ts';

export const PREVISION_MOIS = 3;
type Compte = { montantHt: string; n: number };
export type MoisPrevu = { mois: string; du: { montant: string; n: number }; prepare: Compte; attendu: Compte };
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
// Une facture préparée, pas encore émise : sa période et son hors-taxes (0137), vide s'il est illisible.
export type Preparee = DejaFacture & { montantHt: bigint | null };

const moisDe = (jour: string) => jour.slice(0, 7);

export function prevoir(doivent: readonly Doit[], renouvellements: Renouvellements, dejaFactures: readonly DejaFacture[], aujourdhui: string,
  devise: string, decimales: number, partants: ReadonlySet<string> = new Set(), preparees: readonly Preparee[] = []): Previsions {
  const mois = Array.from({ length: PREVISION_MOIS }, (_, i) => moisDe(plusMois(`${moisDe(aujourdhui)}-01`, i)));
  const premier = moisDe(aujourdhui), fin = mois[mois.length - 1] ?? premier;
  const du = new Map(mois.map((m) => [m, { montant: 0n, n: 0 }]));
  const prepare = new Map(mois.map((m) => [m, { montant: 0n, n: 0 }]));
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
  // Le mois d'une période : celle qui aurait dû commencer avant ce mois (une grâce, une période non renouvelée) est encore
  // attendue ce mois-ci.
  const moisDeLaPeriode = (debut: string) => (debut < `${premier}-01` ? premier : moisDe(debut));
  for (const p of preparees) {
    const c = prepare.get(moisDeLaPeriode(p.debut));
    if (!c || p.montantHt === null) continue;
    c.montant += p.montantHt; c.n += 1;
  }
  const factures = new Set(dejaFactures.map((f) => `${f.entreprise.id}|${f.debut}`));
  for (const [entreprise, r] of renouvellements) {
    if (partants.has(entreprise)) { ecartes += 1; continue; }
    if (!r) { sansPrix += 1; continue; }
    // Chaque période qui commence dans les trois mois : une seule pour un abonnement annuel ; chaque mois pour un mensuel,
    // comptée depuis le premier jour de la prochaine (un 31 tombe au dernier jour d'un mois plus court). Un abonnement qui
    // attend déjà son paiement (une grâce, une période non renouvelée) ne compte que celle-là : les suivantes viendront
    // s'il paie.
    for (let k = 0; k === 0 || !r.attendu; k += 1) {
      const debut = k === 0 ? r.debut : plusMois(r.debut, k * (r.periodicite === 'annuel' ? 12 : 1));
      if (moisDe(debut) > fin) break;
      // Une période suivante qui serait déjà passée n'est pas attendue : seule la première se rattrape.
      if (k > 0 && moisDe(debut) < premier) continue;
      if (factures.has(`${entreprise}|${debut}`)) continue;
      const c = attendu.get(moisDeLaPeriode(debut));
      if (!c) continue;
      c.montant += k === 0 ? r.periodeHt : r.periodicite === 'mensuel' ? r.parAnHt / 12n : r.parAnHt;
      c.n += 1;
    }
  }
  const t = (v: bigint) => versTexte(v, decimales);
  const ht = (x: { montant: bigint; n: number } | undefined) => ({ montantHt: versTexte(x?.montant ?? 0n, 3), n: x?.n ?? 0 });
  return {
    devise,
    mois: mois.map((m) => {
      const a = du.get(m) ?? { montant: 0n, n: 0 };
      return { mois: m, du: { montant: t(a.montant), n: a.n }, prepare: ht(prepare.get(m)), attendu: ht(attendu.get(m)) };
    }),
    retard: { montant: t(retard.montant), n: retard.n }, plusTard: { montant: t(plusTard.montant), n: plusTard.n }, sansPrix, partants: ecartes,
  };
}
