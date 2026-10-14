// Les repères gardés sous un graphique (graphes.tsx, `Abscisses`), à part de l'écran pour se vérifier sur des largeurs
// données : selon l'heure, les étiquettes du jour peuvent avoir toutes la même largeur, et un axe éclairci au plus
// pressé y paraîtrait régulier par hasard.
//
// On garde un repère sur k, en partant du plus récent, avec le plus petit k qui les sépare tous d'au moins `ecart`
// pixels : l'axe reste RÉGULIER (« mer. 7, ven. 9, dim. 11 », jamais trois serrés puis un trou). Un repère calé sur un
// bord (le premier, le dernier) ne compte pas dans ce choix : s'il touche son voisin gardé, lui seul se tait.
export type Boite = { left: number; right: number };
export function reperesGardes(boites: readonly Boite[], bord: readonly boolean[], ecart: number): number[] {
  const n = boites.length;
  if (n < 2) return boites.map((_, j) => j);
  const touche = (a: number, b: number) => (boites[a]?.right ?? 0) + ecart > (boites[b]?.left ?? 0);
  let gardes: number[] = [];
  for (let k = 1; k <= n; k++) {
    gardes = [];
    for (let j = n - 1; j >= 0; j -= k) gardes.unshift(j);
    if (gardes.every((j, m) => m === 0 || bord[j] || bord[gardes[m - 1] ?? j] || !touche(gardes[m - 1] ?? j, j))) break;
  }
  const premier = gardes[0], second = gardes[1], dernier = gardes.at(-1), avant = gardes.at(-2);
  if (premier !== undefined && second !== undefined && bord[premier] && touche(premier, second)) gardes.shift();
  if (dernier !== undefined && avant !== undefined && bord[dernier] && touche(avant, dernier)) gardes.pop();
  return gardes;
}
