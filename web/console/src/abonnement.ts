// Ce que la console dit d'un abonnement, en un endroit : sa puce d'état, la phrase qui l'explique, son échéance. La liste
// des clients, la fiche, l'aperçu d'un geste et « À décider » disent la même chose de la même façon. L'état lui-même est
// DÉDUIT par le serveur (serveur/abonnement/etat.ts) : l'écran ne le recalcule jamais, il le dit.
import { dire } from './langue.ts';
import { dans, jourCourt } from './temps.ts';
import type { TonPuce } from './ui.tsx';

export type Offre = 'essentiel' | 'complet';
export type Periodicite = 'annuel' | 'mensuel';
export type Etat =
  | { etat: 'hors'; raison: 'bac_a_sable' | 'tenu_par_cabinet' | 'offert' | 'inconnu' }
  | { etat: 'essai'; jusquAu: string; jours: number }
  | { etat: 'actif'; offre: Offre; periodicite: Periodicite; jusquAu: string; jours: number; resilie: boolean }
  | { etat: 'en_retard'; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { etat: 'lecture_seule'; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' };
export type Faits = {
  connu: boolean; essaiJusquAu: string | null; payeJusquAu: string | null; offre: Offre | null; periodicite: Periodicite | null;
  resilieLe: string | null; suspenduLe: string | null; offert: boolean; bacASable: boolean; tenuParCabinet: boolean;
};
export type Categorie = Etat['etat'];
export const CATEGORIES: readonly Categorie[] = ['essai', 'actif', 'en_retard', 'lecture_seule', 'hors'];

export const puceDe = (e: Etat): { ton: TonPuce; texte: string } => ({ ton: e.etat, texte: dire(`console.ecran.etat.${e.etat}`) });

export const offreEtPeriode = (offre: Offre, periodicite: Periodicite) =>
  dire('console.ecran.abo.offre_periodicite', { offre: dire(`console.ecran.abo.offre.${offre}`), periodicite: dire(`console.ecran.abo.periodicite.${periodicite}`) });

// L'abonnement en quelques mots : « Complet, à l'année », « essai de 30 jours », « offert par SkanFact ».
export function abonnementEnMots(e: Etat, f: Faits): string {
  switch (e.etat) {
    case 'essai': return dire('console.ecran.abo.essai');
    case 'actif': return offreEtPeriode(e.offre, e.periodicite);
    case 'en_retard': return e.apresEssai || !f.offre || !f.periodicite ? dire('console.ecran.abo.essai_fini') : `${offreEtPeriode(f.offre, f.periodicite)} · ${dire('console.ecran.abo.non_renouvele')}`;
    case 'lecture_seule':
      if (e.raison === 'suspendu') return dire('console.ecran.abo.suspendu');
      if (e.raison === 'resilie') return dire('console.ecran.abo.resilie');
      return e.raison === 'essai_termine' || !f.offre || !f.periodicite ? dire('console.ecran.abo.essai_fini') : `${offreEtPeriode(f.offre, f.periodicite)} · ${dire('console.ecran.abo.non_renouvele')}`;
    default: return dire(`console.ecran.abo.hors.${e.raison}`);
  }
}

// La phrase sous la puce : jusqu'à quand, et dans combien de temps.
export function expliquer(e: Etat, aujourdhui: string): string {
  switch (e.etat) {
    case 'essai': return dire('console.ecran.expl.essai', { le: jourCourt(e.jusquAu), dans: dans(e.jusquAu, aujourdhui) });
    case 'actif': return dire(e.resilie ? 'console.ecran.expl.actif_resilie' : 'console.ecran.expl.actif', { le: jourCourt(e.jusquAu), dans: dans(e.jusquAu, aujourdhui) });
    case 'en_retard': return dire('console.ecran.expl.en_retard', { le: jourCourt(e.lectureSeuleLe), dans: dans(e.lectureSeuleLe, aujourdhui) });
    case 'lecture_seule': return dire('console.ecran.expl.lecture_seule', { le: jourCourt(e.depuis) });
    default: return dire(`console.ecran.abo.hors.${e.raison}`);
  }
}

// Le jour qui compte pour la liste (la colonne « échéance ») : la fin de l'essai ou de la période payée, le jour de la
// lecture seule, ou celui depuis lequel elle dure. Rien pour ce qui n'a pas d'échéance.
export function echeanceDe(e: Etat): string | null {
  switch (e.etat) {
    case 'essai': case 'actif': return e.jusquAu;
    case 'en_retard': return e.lectureSeuleLe;
    case 'lecture_seule': return e.depuis;
    default: return null;
  }
}
