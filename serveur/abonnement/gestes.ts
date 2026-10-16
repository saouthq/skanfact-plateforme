// Un geste sur l'abonnement d'une entreprise (docs/abonnement.md, docs/console.md ; skanfact docs/cadrage/10-console.md
// § 2.4) : prolonger un essai, noter un paiement reçu, résilier (et l'annuler), suspendre (et reprendre), offrir (et le
// retirer), ouvrir et fermer un module acheté seul sur Essentiel (14c). La règle de chaque geste vit ICI, en un seul endroit, pure : l'outil de l'exploitation (base/abonnement.ts)
// et la console (serveur/console/) la jouent tous les deux, puis écrivent chacun par son chemin. Deux règles écrites deux
// fois divergent toujours.

import { t } from '../../textes/index.ts';
import { Refus } from '../erreurs.ts';
import { echeanceDe, etatAbonnement, jourEnFrancais, plusJours, prochainePeriode, secondChangement, type Faits, type ModuleAchete, type Offre, type Periodicite } from './etat.ts';
import './textes.ts';

export type GesteAbonnement = 'prolonger' | 'payer' | 'resilier' | 'annuler-resiliation' | 'suspendre' | 'reprendre' | 'offrir' | 'retirer-offert'
  | 'ouvrir-module' | 'fermer-module' | 'accorder-delai' | 'offrir-mois' | 'changer-offre';
export const GESTES_ABONNEMENT: readonly GesteAbonnement[] = ['prolonger', 'payer', 'resilier', 'annuler-resiliation', 'suspendre', 'reprendre', 'offrir', 'retirer-offert',
  'ouvrir-module', 'fermer-module', 'accorder-delai', 'offrir-mois', 'changer-offre'];
// Un délai se donne en jours, de 1 à 60 : au-delà, c'est une autre conversation (un geste de plus, avec son motif).
export const DELAI_MAX_JOURS = 60;

// La ligne de plateforme.abonnement, telle que la base la rend (plateforme.ligne_abonnement) : des jours de calendrier.
export type LigneAbonnement = {
  essai_jusqu_au: string; paye_jusqu_au: string | null; offre: Offre | null; periodicite: Periodicite | null;
  resilie_le: string | null; suspendu_le: string | null; offert: boolean; modules: ModuleAchete[];
  // 0111 : le délai d'une échéance, et l'offre de la prochaine (absents d'une ligne d'avant : gardés tels quels).
  delai_echeance?: string | null; delai_jusqu_au?: string | null;
  suivante_offre?: Offre | null; suivante_periodicite?: Periodicite | null; suivante_a_partir_du?: string | null;
  // 0113 : le mois offert qui attend la prochaine facture, les modules qui partent au renouvellement.
  mois_offerts?: number; modules_a_retirer?: ModuleAchete[];
  // 0121 : une période payée avant son premier jour — ce qu'elle change attend ce jour-là (l'audit C01).
  a_venir_le?: string | null; a_venir_offre?: Offre | null; a_venir_periodicite?: Periodicite | null; a_venir_retraits?: ModuleAchete[];
};

// Un paiement reçu hors de la plateforme (0113) : la facture faite ailleurs, le montant reçu en millimes, son moyen, son
// jour. Sans eux, rien n'est payé.
export type MoyenRecu = 'virement' | 'cheque' | 'especes';
export const MOYENS_RECUS: readonly MoyenRecu[] = ['virement', 'cheque', 'especes'];
export type PaiementRecu = { facture: string; montant: bigint; moyen: MoyenRecu; le: string };

// `apercu` : l'aperçu d'un paiement se calcule avant que sa preuve soit tapée (la période ne dépend pas d'elle) ; le geste,
// jamais sans elle.
export type DemandeAbonnement = { geste: GesteAbonnement; motif: string; jours?: number | undefined; offre?: Offre | undefined; periodicite?: Periodicite | undefined;
  module?: ModuleAchete | undefined; paiement?: PaiementRecu | undefined; apercu?: boolean | undefined };

// Ce qu'un renouvellement payé applique (0113) : les modules retirés partent, l'offre changée (0111) ne se redit plus
// quand la période payée commence à son jour. La même règle que la base (plateforme.abonnement_paye_par_facture).
function auRenouvellement(apres: LigneAbonnement, debut: string): void {
  const partent = apres.modules_a_retirer ?? [];
  apres.modules = apres.modules.filter((m) => !partent.includes(m));
  apres.modules_a_retirer = [];
  if (apres.suivante_a_partir_du && debut >= apres.suivante_a_partir_du) Object.assign(apres, { suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null });
}

// Ce que le geste fait : la ligne d'après, et ce qu'il faut en retenir dans son histoire (les jours ajoutés, la période
// payée). `ligne` vaut null quand l'entreprise n'a pas d'abonnement (une restauration dans une autre base) : seul
// « prolonger » a alors un sens, il ouvre l'essai à partir d'aujourd'hui.
export function calculerGeste(ligne: LigneAbonnement | null, faits: Faits, d: DemandeAbonnement, jour: string): { apres: LigneAbonnement; details: Record<string, unknown> } {
  if (!ligne && d.geste !== 'prolonger') throw new Refus('abonnement.geste.sans_ligne');
  const avant: LigneAbonnement = ligne ?? { essai_jusqu_au: jour, paye_jusqu_au: null, offre: null, periodicite: null, resilie_le: null, suspendu_le: null, offert: false, modules: [] };
  const apres: LigneAbonnement = { ...avant, modules: [...avant.modules], ...(avant.modules_a_retirer ? { modules_a_retirer: [...avant.modules_a_retirer] } : {}) };
  const details: Record<string, unknown> = {};
  switch (d.geste) {
    case 'prolonger': {
      const jours = d.jours ?? 0;
      if (!Number.isInteger(jours) || jours < 1 || jours > 365) throw new Refus('abonnement.geste.jours');
      // À partir de la fin de l'essai, ou d'aujourd'hui s'il est déjà fini : un essai prolongé n'est jamais dans le passé.
      apres.essai_jusqu_au = plusJours(avant.essai_jusqu_au > jour ? avant.essai_jusqu_au : jour, jours);
      details.jours = jours;
      break;
    }
    // Un paiement reçu hors de la plateforme (une facture faite ailleurs) : il paie la période qui vient, comme une facture
    // de la plateforme — le mois offert qui l'attendait compris, et ce que le renouvellement applique.
    case 'payer': {
      if (d.offre !== 'essentiel' && d.offre !== 'complet') throw new Refus('abonnement.geste.offre');
      if (d.periodicite !== 'annuel' && d.periodicite !== 'mensuel') throw new Refus('abonnement.geste.periodicite');
      const r = d.paiement;
      if (!d.apercu && (!r || !r.facture.trim() || r.facture.trim().length > 40 || r.montant <= 0n || !MOYENS_RECUS.includes(r.moyen)
        || !/^\d{4}-\d{2}-\d{2}$/.test(r.le) || r.le > jour)) throw new Refus('abonnement.geste.paiement_preuve');
      const offert = (avant.mois_offerts ?? 0) > 0;
      const p = prochainePeriode(faits, d.periodicite, jour, offert);
      if (p.debut > jour && avant.offre) {
        // Payée avant son premier jour (0121, l'audit C01) : la période payée qui court va au bout avec ce qu'elle avait ;
        // l'offre payée et les modules qui partent attendent le premier jour de la nouvelle. La même règle que la base
        // (plateforme.abonnement_paye_par_facture). Un premier paiement pendant l'essai n'a rien de payé à protéger : il
        // s'applique tout de suite. Une autre période attend déjà (l'audit 1.42.0, A01) : secondChangement décide.
        const attend = avant.a_venir_le && avant.a_venir_offre && avant.a_venir_periodicite
          ? { le: avant.a_venir_le, offre: avant.a_venir_offre, periodicite: avant.a_venir_periodicite, retraits: avant.a_venir_retraits ?? [] } : null;
        const second = secondChangement({ offre: avant.offre, periodicite: avant.periodicite }, attend, avant.modules_a_retirer ?? [], p.debut, { offre: d.offre, periodicite: d.periodicite });
        if (second === 'conflit' && attend) {
          throw new Refus('abonnement.geste.deux_changements', { valeurs: { le: jourEnFrancais(attend.le), offre: t(`abonnement.facture.offre.${attend.offre}`) } });
        }
        Object.assign(apres, { paye_jusqu_au: p.fin, resilie_le: null, ...(offert ? { mois_offerts: 0 } : {}),
          a_venir_le: second === 'garder' && attend ? attend.le : p.debut, a_venir_offre: d.offre, a_venir_periodicite: d.periodicite,
          a_venir_retraits: [...new Set([...(avant.a_venir_retraits ?? []), ...(avant.modules_a_retirer ?? [])])].sort(), modules_a_retirer: [] });
        if (apres.suivante_a_partir_du && p.debut >= apres.suivante_a_partir_du) Object.assign(apres, { suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null });
        details.aVenir = true;
      } else {
        Object.assign(apres, { paye_jusqu_au: p.fin, offre: d.offre, periodicite: d.periodicite, resilie_le: null, ...(offert ? { mois_offerts: 0 } : {}) });
        auRenouvellement(apres, p.debut);
      }
      Object.assign(details, { debut: p.debut, fin: p.fin, ...(r ? { facture: r.facture.trim(), montant: r.montant.toString(), moyen: r.moyen, le: r.le } : {}),
        ...(offert ? { moisOffert: true } : {}) });
      break;
    }
    case 'resilier':
      if (avant.resilie_le) throw new Refus('abonnement.geste.deja_resilie', { valeurs: { le: jourEnFrancais(avant.resilie_le) } });
      apres.resilie_le = jour;
      break;
    case 'annuler-resiliation':
      if (!avant.resilie_le) throw new Refus('abonnement.geste.pas_resilie');
      apres.resilie_le = null;
      break;
    case 'suspendre':
      if (avant.suspendu_le) throw new Refus('abonnement.geste.deja_suspendu', { valeurs: { le: jourEnFrancais(avant.suspendu_le) } });
      apres.suspendu_le = jour;
      break;
    case 'reprendre':
      if (!avant.suspendu_le) throw new Refus('abonnement.geste.pas_suspendu');
      apres.suspendu_le = null;
      break;
    case 'offrir':
      if (avant.offert) throw new Refus('abonnement.geste.deja_offert');
      apres.offert = true;
      break;
    case 'retirer-offert':
      if (!avant.offert) throw new Refus('abonnement.geste.pas_offert');
      apres.offert = false;
      break;
    // Un module acheté seul sur Essentiel (14c) : il s'ouvre tout de suite ; sa ligne vient sur la prochaine facture, qui
    // rattrape au prorata les jours de la période payée qui court (0113, plateforme.rattrapage_modules). Complet le
    // contient déjà : rien à acheter. Rouvrir un module qui allait partir annule son retrait (ce n'est pas un achat).
    case 'ouvrir-module': {
      if (d.module !== 'paie' && d.module !== 'compta') throw new Refus('abonnement.geste.module');
      if (avant.offre === 'complet') throw new Refus('abonnement.geste.module_complet');
      // Il part avec la période déjà payée, que sa facture a comptée sans lui : il se rouvre une fois qu'elle a commencé.
      if (avant.a_venir_le && (avant.a_venir_retraits ?? []).includes(d.module)) {
        throw new Refus('abonnement.geste.module_part_avec_la_periode', { valeurs: { module: t(`abonnement.module.${d.module}`), le: jourEnFrancais(avant.a_venir_le) } });
      }
      const partent = avant.modules_a_retirer ?? [];
      if (avant.modules.includes(d.module) && partent.includes(d.module)) {
        apres.modules_a_retirer = partent.filter((m) => m !== d.module);
        Object.assign(details, { module: d.module, annuleRetrait: true });
        break;
      }
      if (avant.modules.includes(d.module)) throw new Refus('abonnement.geste.module_deja', { valeurs: { module: t(`abonnement.module.${d.module}`) } });
      apres.modules = [...avant.modules, d.module].sort();
      details.module = d.module;
      break;
    }
    // Retirer un module : pendant une période payée, il reste jusqu'au renouvellement (rien n'est perdu, rien n'est à
    // rembourser) et la facture suivante ne le compte plus ; sans période payée qui court, il part tout de suite.
    case 'fermer-module': {
      if (d.module !== 'paie' && d.module !== 'compta') throw new Refus('abonnement.geste.module');
      if (!avant.modules.includes(d.module)) throw new Refus('abonnement.geste.module_pas', { valeurs: { module: t(`abonnement.module.${d.module}`) } });
      const partent = avant.modules_a_retirer ?? [];
      if (partent.includes(d.module) || (avant.a_venir_retraits ?? []).includes(d.module)) throw new Refus('abonnement.geste.module_part_deja', { valeurs: { module: t(`abonnement.module.${d.module}`) } });
      const e = etatAbonnement(faits, jour);
      if (e.etat === 'actif') {
        apres.modules_a_retirer = [...partent, d.module].sort();
        // Il sert jusqu'au dernier jour payé, et part le lendemain.
        Object.assign(details, { module: d.module, jusquAu: e.jusquAu, auRenouvellement: plusJours(e.jusquAu, 1) });
      } else {
        apres.modules = avant.modules.filter((m) => m !== d.module);
        details.module = d.module;
      }
      break;
    }
    // Un délai (« Prolonger la grâce », « Réactiver ») : en grâce, la lecture seule recule de ces jours ; en lecture seule
    // après un essai ou une échéance manquée, tout se rouvre aujourd'hui, jusqu'au dernier de ces jours. Ni une
    // suspension, ni une résiliation : elles ont leur geste.
    case 'accorder-delai': {
      const jours = d.jours ?? 0;
      if (!Number.isInteger(jours) || jours < 1 || jours > DELAI_MAX_JOURS) throw new Refus('abonnement.geste.delai_jours', { valeurs: { max: DELAI_MAX_JOURS } });
      const e = etatAbonnement(faits, jour);
      const echeance = echeanceDe(faits);
      const ouvert = e.etat === 'en_retard' || (e.etat === 'lecture_seule' && (e.raison === 'essai_termine' || e.raison === 'non_renouvele'));
      if (!ouvert || !echeance) throw new Refus('abonnement.geste.delai_etat');
      const depuis = e.etat === 'en_retard' ? plusJours(e.lectureSeuleLe, -1) : plusJours(jour, -1);
      Object.assign(apres, { delai_echeance: echeance, delai_jusqu_au: plusJours(depuis, jours) });
      Object.assign(details, { jours, jusquAu: plusJours(depuis, jours) });
      break;
    }
    // Un mois offert (0113 ; skanfact docs/cadrage/10-console.md § 2.4) : SUR LA PROCHAINE FACTURE, qui couvre un mois de
    // plus au même prix et le dit. Rien ne s'allonge avant elle. À un abonné dont l'offre est choisie et qui se renouvelle
    // (ni une résiliation, ni une suspension) ; un seul mois attend à la fois.
    case 'offrir-mois': {
      const e = etatAbonnement(faits, jour);
      if (!avant.offre || !avant.periodicite || e.etat === 'hors' || e.etat === 'essai') throw new Refus('abonnement.geste.mois_actif');
      if (avant.resilie_le || avant.suspendu_le) throw new Refus('abonnement.geste.mois_resilie');
      if ((avant.mois_offerts ?? 0) > 0) throw new Refus('abonnement.geste.mois_deja');
      apres.mois_offerts = 1;
      // La période que cette prochaine facture couvrira : celle d'une facture préparée aujourd'hui, un mois de plus.
      const periodicite = avant.suivante_offre && avant.suivante_periodicite ? avant.suivante_periodicite : avant.a_venir_periodicite ?? avant.periodicite;
      const p = prochainePeriode(faits, periodicite, jour, true);
      Object.assign(details, { du: p.debut, au: p.fin });
      break;
    }
    // Changer d'offre : à la prochaine échéance (la période payée va au bout avec l'offre payée). Revenir à l'offre qui
    // court efface le changement prévu.
    case 'changer-offre': {
      if (d.offre !== 'essentiel' && d.offre !== 'complet') throw new Refus('abonnement.geste.offre');
      if (d.periodicite !== 'annuel' && d.periodicite !== 'mensuel') throw new Refus('abonnement.geste.periodicite');
      const echeance = echeanceDe(faits);
      if (!avant.offre || !avant.periodicite || !echeance) throw new Refus('abonnement.geste.changer_sans_offre');
      if (avant.resilie_le) throw new Refus('abonnement.geste.changer_resilie');
      // L'offre de la période payée d'avance (0121), si elle attend son jour : c'est elle qui ira jusqu'à l'échéance.
      const memes = d.offre === (avant.a_venir_offre ?? avant.offre) && d.periodicite === (avant.a_venir_periodicite ?? avant.periodicite);
      if (memes && !avant.suivante_offre) throw new Refus('abonnement.geste.changer_meme');
      const aPartirDu = plusJours(echeance, 1);
      Object.assign(apres, memes ? { suivante_offre: null, suivante_periodicite: null, suivante_a_partir_du: null }
        : { suivante_offre: d.offre, suivante_periodicite: d.periodicite, suivante_a_partir_du: aPartirDu });
      // Le jour du changement, seul : l'offre suivante est dans la ligne (« suivante_offre ») ; « offre » dirait, dans
      // l'histoire et au journal, que l'offre qui court a changé.
      details.aPartirDu = aPartirDu;
      break;
    }
    default:
      throw new Refus('abonnement.geste.inconnu');
  }
  return { apres, details };
}
