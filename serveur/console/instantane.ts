// Un calcul que toute l'équipe partage (l'audit 1.42.0 A09 ; docs/console.md C65) : la liste des clients calcule chaque
// entreprise (son état, ses vues, son risque, ce qu'elle rapportera) avant de chercher, filtrer et paginer. Ce calcul se
// fait UNE fois et sert tout le monde pendant une minute, au lieu d'être refait à chaque page, par chaque personne.
//
// Les règles, écrites d'avance :
//   - frais (moins de FRAIS_MS) : il sert tel quel ;
//   - passé (moins de PERIME_MS) : il sert tel quel, et un nouveau se calcule à côté (la réponse n'attend pas) ;
//   - périmé, d'un autre jour, ou effacé par un geste de la console : la réponse attend le nouveau ;
//   - un geste de la console qui écrit l'efface une fois sa transaction validée (`oublier`) : qui vient d'agir voit son
//     geste ; ce que les clients font de leur côté (une facture émise, une inscription) se voit à la minute suivante, et
//     l'écran dit de quand date ce qu'il montre (`calculeLe`) ;
//   - deux demandes en même temps attendent le MÊME calcul (jamais deux à la fois) ;
//   - un calcul commencé avant un geste ne sert pas après lui.
// Il ne vit que dans ce programme : le serveur tourne en un seul (exploitation/installer.sh) ; plusieurs, un jour, et il
// passerait dans la base.

export const FRAIS_MS = 60_000;
export const PERIME_MS = 10 * 60_000;

export type Lu<T> = { valeur: T; calculeLe: number };

export function instantane<T>(o: { fraisMs?: number; perimeMs?: number; maintenant?: () => number } = {}) {
  const fraisMs = o.fraisMs ?? FRAIS_MS;
  const perimeMs = o.perimeMs ?? PERIME_MS;
  const maintenant = o.maintenant ?? (() => Date.now());
  let generation = 0;
  let courant: (Lu<T> & { cle: string; generation: number }) | null = null;
  let enCours: { cle: string; generation: number; promesse: Promise<Lu<T>> } | null = null;

  const calculer = (cle: string, faire: () => Promise<T>): Promise<Lu<T>> => {
    if (enCours && enCours.cle === cle && enCours.generation === generation) return enCours.promesse;
    const g = generation;
    const debut = maintenant();
    const promesse = faire().then((valeur) => {
      const lu = { valeur, calculeLe: debut };
      // Un geste venu pendant le calcul l'a rendu ancien : il sert à qui l'attendait, il ne se garde pas.
      if (g === generation && (!courant || courant.calculeLe <= debut)) courant = { ...lu, cle, generation: g };
      return lu;
    }).finally(() => { if (enCours?.promesse === promesse) enCours = null; });
    enCours = { cle, generation: g, promesse };
    return promesse;
  };

  return {
    // `faire` : le calcul, dans la transaction de la demande ; `aCote` : le même, dans une transaction à lui (la demande
    // n'attend pas : la sienne se ferme avec elle) ; `frais` : « Actualiser », la réponse attend un calcul neuf.
    async lire(cle: string, faire: () => Promise<T>, aCote: (() => Promise<T>) | null = null, frais = false): Promise<Lu<T>> {
      const c = courant;
      if (!frais && c && c.cle === cle && c.generation === generation) {
        const age = maintenant() - c.calculeLe;
        if (age < fraisMs) return { valeur: c.valeur, calculeLe: c.calculeLe };
        if (age < perimeMs && aCote) {
          calculer(cle, aCote).catch(() => {});
          return { valeur: c.valeur, calculeLe: c.calculeLe };
        }
      }
      return calculer(cle, faire);
    },
    // Un geste de la console a écrit : ce qui a été calculé avant ne sert plus.
    oublier(): void { generation += 1; courant = null; },
  };
}
