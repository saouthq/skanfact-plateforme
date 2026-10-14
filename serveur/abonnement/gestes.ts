// Un geste sur l'abonnement d'une entreprise (docs/abonnement.md, docs/console.md ; skanfact docs/cadrage/10-console.md
// § 2.4) : prolonger un essai, noter un paiement reçu, résilier (et l'annuler), suspendre (et reprendre), offrir (et le
// retirer), ouvrir et fermer un module acheté seul sur Essentiel (14c). La règle de chaque geste vit ICI, en un seul endroit, pure : l'outil de l'exploitation (base/abonnement.ts)
// et la console (serveur/console/) la jouent tous les deux, puis écrivent chacun par son chemin. Deux règles écrites deux
// fois divergent toujours.

import { t } from '../../textes/index.ts';
import { Refus } from '../erreurs.ts';
import { echeanceDe, etatAbonnement, jourEnFrancais, plusJours, plusMois, prochainePeriode, type Faits, type ModuleAchete, type Offre, type Periodicite } from './etat.ts';
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
};

export type DemandeAbonnement = { geste: GesteAbonnement; motif: string; jours?: number | undefined; offre?: Offre | undefined; periodicite?: Periodicite | undefined;
  module?: ModuleAchete | undefined };

// Ce que le geste fait : la ligne d'après, et ce qu'il faut en retenir dans son histoire (les jours ajoutés, la période
// payée). `ligne` vaut null quand l'entreprise n'a pas d'abonnement (une restauration dans une autre base) : seul
// « prolonger » a alors un sens, il ouvre l'essai à partir d'aujourd'hui.
export function calculerGeste(ligne: LigneAbonnement | null, faits: Faits, d: DemandeAbonnement, jour: string): { apres: LigneAbonnement; details: Record<string, unknown> } {
  if (!ligne && d.geste !== 'prolonger') throw new Refus('abonnement.geste.sans_ligne');
  const avant: LigneAbonnement = ligne ?? { essai_jusqu_au: jour, paye_jusqu_au: null, offre: null, periodicite: null, resilie_le: null, suspendu_le: null, offert: false, modules: [] };
  const apres: LigneAbonnement = { ...avant, modules: [...avant.modules] };
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
    case 'payer': {
      if (d.offre !== 'essentiel' && d.offre !== 'complet') throw new Refus('abonnement.geste.offre');
      if (d.periodicite !== 'annuel' && d.periodicite !== 'mensuel') throw new Refus('abonnement.geste.periodicite');
      const p = prochainePeriode(faits, d.periodicite, jour);
      Object.assign(apres, { paye_jusqu_au: p.fin, offre: d.offre, periodicite: d.periodicite, resilie_le: null });
      Object.assign(details, { debut: p.debut, fin: p.fin });
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
    // Un module acheté seul sur Essentiel (14c) : il s'ouvre à l'abonnement, et sa ligne vient sur la prochaine facture.
    // Complet le contient déjà : rien à acheter.
    case 'ouvrir-module': {
      if (d.module !== 'paie' && d.module !== 'compta') throw new Refus('abonnement.geste.module');
      if (avant.offre === 'complet') throw new Refus('abonnement.geste.module_complet');
      if (avant.modules.includes(d.module)) throw new Refus('abonnement.geste.module_deja', { valeurs: { module: t(`abonnement.module.${d.module}`) } });
      apres.modules = [...avant.modules, d.module].sort();
      details.module = d.module;
      break;
    }
    case 'fermer-module': {
      if (d.module !== 'paie' && d.module !== 'compta') throw new Refus('abonnement.geste.module');
      if (!avant.modules.includes(d.module)) throw new Refus('abonnement.geste.module_pas', { valeurs: { module: t(`abonnement.module.${d.module}`) } });
      apres.modules = avant.modules.filter((m) => m !== d.module);
      details.module = d.module;
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
    // Un mois offert : la période payée s'allonge d'un mois (sans facture ni avoir : rien n'est vendu pour ce mois).
    case 'offrir-mois': {
      const e = etatAbonnement(faits, jour);
      if (e.etat !== 'actif' || !avant.paye_jusqu_au) throw new Refus('abonnement.geste.mois_actif');
      if (avant.resilie_le) throw new Refus('abonnement.geste.mois_resilie');
      // Un mois de calendrier après la fin : du 24/10 au 23/11 payé, le 23/12 ; la fin d'un mois court reste juste.
      apres.paye_jusqu_au = plusJours(plusMois(plusJours(avant.paye_jusqu_au, 1), 1), -1);
      Object.assign(details, { de: avant.paye_jusqu_au, a: apres.paye_jusqu_au });
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
      const memes = d.offre === avant.offre && d.periodicite === avant.periodicite;
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
